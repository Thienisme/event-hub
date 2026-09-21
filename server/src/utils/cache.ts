import { randomUUID } from 'crypto';
import { cacheClient } from '../config/redis';

/**
 * Cache đọc cho EventHub.
 *
 * Module này giữ 4 quyết định thiết kế, mỗi cái đều có số đo đứng sau:
 *
 *  1. KHOÁ THEO VERSION thay cho `KEYS ...` (xem LIST_VERSION_KEY).
 *  2. SINGLE-FLIGHT: cache vừa hết hạn thì chỉ một request đi tính lại
 *     (xem cacheGetOrLoad).
 *  3. FAIL-OPEN: Redis hỏng thì đọc thẳng database, không làm treo request.
 *  4. Không cache giá trị "không tìm thấy" (xem cacheGetOrLoad).
 */

/** TTL của mọi entry cache đọc. Giữ khớp với giá trị đang dùng ở event.controller.ts. */
const READ_TTL_SECONDS = 60;

/**
 * Khoá giữ "version" của cache DANH SÁCH sự kiện.
 *
 * ĐÂY LÀ CÁCH THAY THẾ `KEYS events:list:*`.
 *
 * `KEYS` phải quét TOÀN BỘ keyspace và chặn Redis (đơn luồng) suốt thời gian đó.
 * Đo trên máy này với 50.000 key `events:list:*`:
 *
 *     KEYS events:list:*   111,0 ms   (một lệnh bình thường mất 0,10 ms)
 *     INCR                 0,206 ms
 *
 * Và invalidation chạy sau MỖI đơn đặt vé — tức là mỗi đơn hàng chặn toàn bộ
 * Redis 111 ms, làm chậm mọi request khác của mọi người dùng.
 *
 * Cách mới: cache danh sách được đặt tên kèm version. Khi cần vô hiệu, ta chỉ
 * TĂNG một con số (O(1)). Mọi key cũ trở nên vô hình ngay lập tức và tự hết hạn
 * theo TTL — không cần đi xoá cái nào.
 *
 * Đánh đổi: mỗi request đọc phải đọc thêm version (thêm 1 round-trip ~0,1 ms).
 * Rẻ hơn rất nhiều so với một lượt đọc database (~40 ms trên máy này).
 */
const LIST_VERSION_KEY = 'events:list:v';

/** Version dùng khi không đọc được Redis. Bất kỳ giá trị nào cũng được, miễn là ổn định. */
const VERSION_FALLBACK = '0';

/** Giữ lock single-flight tối đa bao lâu (ms). */
const LOCK_TTL_MS = 5_000;

/** Số vòng và bước chờ khi phải đợi request khác điền cache. */
const WAIT_ROUNDS = 20;
const WAIT_STEP_MS = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Nhả lock chỉ khi mình vẫn là chủ.
 *
 * Không dùng `DEL` trần: nếu lệnh của ta chậm hơn TTL, lock đã thuộc về người
 * khác, và `DEL` trần sẽ xoá lock của họ -> mở đường cho stampede trở lại.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

// ---------------------------------------------------------------------------
// Khoá cache
// ---------------------------------------------------------------------------

export function listCacheKey(
  version: string,
  page: number,
  limit: number,
  search: string
): string {
  return `events:list:v${version}:page=${page}:limit=${limit}:search=${search}`;
}

export function detailCacheKey(eventId: string): string {
  return `event:detail:${eventId}`;
}

/** Version hiện tại của cache danh sách. Lỗi Redis -> version dự phòng (sẽ MISS). */
export async function getListVersion(): Promise<string> {
  try {
    return (await cacheClient.get(LIST_VERSION_KEY)) ?? VERSION_FALLBACK;
  } catch {
    return VERSION_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Đọc / ghi cache
// ---------------------------------------------------------------------------

/**
 * Kết quả đọc cache. Phân biệt được MISS với LỖI là điều kiện để single-flight
 * không tự biến thành một vòng chờ vô ích khi Redis chết.
 */
type CacheRead<T> =
  | { state: 'hit'; value: T }
  | { state: 'miss' }
  | { state: 'error' };

async function readCache<T>(key: string): Promise<CacheRead<T>> {
  try {
    const raw = await cacheClient.get(key);
    if (raw === null) return { state: 'miss' };
    return { state: 'hit', value: JSON.parse(raw) as T };
  } catch {
    // Gồm cả Redis chết, timeout, và dữ liệu cache hỏng (JSON.parse lỗi).
    // Cache hỏng không được phép làm hỏng request -> coi như lỗi để đi thẳng DB.
    return { state: 'error' };
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await cacheClient.set(key, JSON.stringify(value), 'EX', READ_TTL_SECONDS);
  } catch {
    /* Ghi cache hỏng không phải lỗi của request */
  }
}

async function releaseLock(lockKey: string, token: string): Promise<void> {
  try {
    await cacheClient.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
  } catch {
    /* Lock sẽ tự hết hạn theo PX */
  }
}

/**
 * Đọc cache; nếu MISS thì chỉ MỘT request đi tính lại, các request khác dùng
 * chung kết quả đó.
 *
 * VÌ SAO CẦN (đo được): khi cache vừa hết hạn, toàn bộ request đang bay đều thấy
 * MISS và cùng lao vào database. Số lượt đọc DB cho một lần cache lạnh:
 *
 *     100 request đồng thời -> 6 / 18 / 38 lượt đọc DB
 *     500 request đồng thời -> 38 / 98 / 130 lượt đọc DB
 *
 * Đúng ra chỉ cần 1. Và stampede tự khuếch đại: database càng chậm thì cửa sổ
 * MISS càng rộng, càng nhiều request lọt vào — đúng lúc database yếu nhất.
 *
 * @param loader hàm đọc dữ liệu thật. Khi dữ liệu có thể không tồn tại, khai báo
 *               `T` là `Something | null` (xem getEventById); giá trị null sẽ
 *               KHÔNG được ghi vào cache.
 */
export async function cacheGetOrLoad<T>(
  key: string,
  loader: () => Promise<T>
): Promise<{ value: T; source: 'cache' | 'database' }> {
  const first = await readCache<T>(key);

  if (first.state === 'hit') {
    return { value: first.value, source: 'cache' };
  }

  // Redis lỗi: KHÔNG thử giành lock và KHÔNG chờ ai. Redis đang chết thì lock
  // cũng chết theo, chờ chỉ tổ làm request chậm vô ích.
  if (first.state === 'error') {
    return { value: await loader(), source: 'database' };
  }

  const lockKey = `cache:lock:${key}`;
  const token = randomUUID();
  let holdsLock = false;

  try {
    const acquired = await cacheClient.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    holdsLock = acquired === 'OK';
  } catch {
    holdsLock = false;
  }

  if (holdsLock) {
    try {
      // Kiểm tra lại: trong lúc ta giành lock, người khác có thể đã điền cache.
      const second = await readCache<T>(key);
      if (second.state === 'hit') {
        return { value: second.value, source: 'cache' };
      }

      const value = await loader();
      // Không ghi null/undefined vào cache: cache "không tìm thấy" cần một sentinel
      // riêng để phân biệt với cache MISS, hiện chưa cần thiết.
      if (value !== null && value !== undefined) await writeCache(key, value);
      return { value, source: 'database' };
    } finally {
      await releaseLock(lockKey, token);
    }
  }

  // Có người khác đang tính. Chờ họ điền cache thay vì cùng đập vào database.
  for (let round = 0; round < WAIT_ROUNDS; round += 1) {
    await sleep(WAIT_STEP_MS);
    const retry = await readCache<T>(key);
    if (retry.state === 'hit') {
      return { value: retry.value, source: 'cache' };
    }
  }

  // Chờ hoài mà vẫn không có (người giữ lock gặp sự cố chẳng hạn).
  // Ưu tiên TÍNH SẴN SÀNG hơn là chống stampede: thà đọc database còn hơn treo request.
  return { value: await loader(), source: 'database' };
}

// ---------------------------------------------------------------------------
// Vô hiệu cache
// ---------------------------------------------------------------------------

/**
 * Vô hiệu cache danh sách: chỉ tăng version. O(1), không chặn Redis.
 *
 * Fail-open: nếu Redis lỗi, ta không vô hiệu được — nhưng entry cũ cũng sẽ tự hết
 * hạn theo TTL 60 giây, nên dữ liệu không sai vĩnh viễn.
 */
export async function invalidateEventList(): Promise<void> {
  try {
    await cacheClient.incr(LIST_VERSION_KEY);
  } catch {
    /* Entry cũ tự hết hạn theo TTL */
  }
}

/** Vô hiệu cache chi tiết của một hoặc nhiều event. */
export async function invalidateEventDetails(
  eventIds: string | string[]
): Promise<void> {
  const ids = Array.isArray(eventIds) ? eventIds : [eventIds];
  if (ids.length === 0) return;

  try {
    await cacheClient.del(ids.map(detailCacheKey));
  } catch {
    /* Entry cũ tự hết hạn theo TTL */
  }
}

/**
 * Vô hiệu cả cache danh sách lẫn cache chi tiết.
 *
 * Cần cả hai vì response của danh sách CÓ kèm `ticketTypes` (nên nó cũng chứa số
 * vé còn lại), giống response chi tiết.
 */
export async function invalidateEventCache(
  eventIds: string | string[]
): Promise<void> {
  await Promise.all([invalidateEventList(), invalidateEventDetails(eventIds)]);
}
