# Phỏng Vấn — EventHub

Bản dịch sẵn: *"Đây là hệ thống bán vé sự kiện. Bài toán khó không nằm ở CRUD, mà nằm ở tranh chấp tồn kho khi hàng nghìn người cùng mua chiếc vé cuối."*

---

## 1. Bài toán đặt ra

Một hệ thống bán vé sự kiện có:

- **ORGANIZER/ADMIN** tạo sự kiện, kèm nhiều loại vé (VIP, Standard…), mỗi loại có số lượng giới hạn.
- **CUSTOMER** xem sự kiện, chọn loại vé, đặt vé.
- Đơn đặt vé ở trạng thái `PENDING` được **giữ chỗ 10 phút**. Không thanh toán kịp thì job nền chuyển sang `EXPIRED` và trả vé về kho.

Điểm khó của bài toán không nằm ở CRUD, mà nằm ở **tranh chấp tồn kho khi hàng nghìn người cùng mua chiếc vé cuối**. Đây là lý do tồn tại của phần lớn code trong repo.

### Năm mục tiêu kỹ thuật của dự án

| # | Mục tiêu | Bài toán con | Giải pháp chính |
|---|----------|--------------|-----------------|
| 1 | Không bán quá số lượng | Race condition khi trừ kho | Redlock + CAS ở DB + CHECK constraint |
| 2 | Giảm tải database | Cache stampede / invalidate | Versioned key + Single-flight + Fail-open |
| 3 | Bảo mật production-ready | Giả mạo JWT, leo quyền, brute-force | Fail-fast secret, pin algorithm, RBAC, rate limit |
| 4 | Chịu tải cao | Nhiều request đồng thời | Xử lý lock ở Redis, CAS ở MySQL |
| 5 | Dữ liệu nhất quán | Đơn hết hạn, tồn kho ảo | Transaction + job nền + cache invalidation |

---

## 2. Thứ tự học (đừng học hết một lúc)

| # | Chủ đề | File | Thời lượng | Ưu tiên |
|---|--------|------|-----------|---------|
| 1 | Race condition + 3 lớp bảo vệ | `server/src/controllers/order.controller.ts` | 2 ngày | **Cao nhất** |
| 2 | Cache Redis: stampede, versioned key, fail-open | `server/src/utils/cache.ts` | 3 ngày | **Cao nhất** |
| 3 | JWT + RBAC + rate limit | `server/src/middlewares/auth.middleware.ts`, `config/auth.ts` | 2 ngày | Cao |
| 4 | Job nền trả vé (CAS không cần lock) | `server/src/jobs/expireOrders.job.ts` | 1 ngày | Cao |
| 5 | Race hành trị (FOR UPDATE) | `server/src/controllers/admin.controller.ts` | 1 ngày | Trung bình |
| 6 | Phân loại lỗi 400/409/429/500 | `server/src/utils/errors.ts` | 1 ngày | Trung bình |
| 7 | Double booking phía client | `client/src/views/EventDetailView.vue` | 0,5 ngày | Trung bình |
| 8 | Sửa sự kiện + quy đổi tồn kho | `server/src/controllers/event.controller.ts` | 1 ngày | Trung bình |

> **Mục tiêu của buổi phỏng vấn: 80% thời gian nằm ở chủ đề 1–4.** Câu hỏi về Vue/Tailwind/Prisma là câu hỏi "biết dùng" — trả lời nhanh rồi quay về bài toán chính.

---

## 3. Chủ đề 1 — Chống oversell (phỏng vấn hay hỏi nhất)

### 3.1. Vấn đề

`server/src/controllers/order.controller.ts:42-49` — code **sai** trước đây:

```ts
// READ-THEN-WRITE — có lỗ hổng
const t = await tx.ticketType.findUnique({ where: { id } });
if (t.availableQuantity < quantity) throw new Error('Hết vé');
await tx.ticketType.update({ data: { availableQuantity: t.availableQuantity - quantity } });
```

Hai request A và B cùng `findUnique` → cùng thấy `availableQuantity = 1` → cùng vượt qua `if` → cùng ghi `1 - 1 = 0`. Kết quả: **bán 2 vé trong khi chỉ có 1**.

**Diễn giải hay:** khoảng thời gian giữa **đọc** và **ghi** là nơi kẻ khác chen vào. Câu `if` kiểm tra một giá trị *đã cũ*, chứ không phải điều kiện của hành động.

### 3.2. Giải pháp — 3 lớp bảo vệ

**Lớp 1 — Distributed Lock (Redlock)** — `order.controller.ts:21-27`

```ts
const lockKey = `locks:ticketType:${ticketTypeId}`;
const ttl = 5000;
lock = await redlock.acquire([lockKey], ttl);
```

Khóa theo `ticketTypeId` để vé VIP và vé Standard không chặn nhau.

**Lớp 2 — Compare-And-Swap ở tầng DB (CHỐT CHẶN THẬT)** — `order.controller.ts:42-53`

```ts
const reserved = await tx.ticketType.updateMany({
  where: { id: ticketTypeId, availableQuantity: { gte: quantity } },
  data: { availableQuantity: { decrement: quantity } },
});
if (reserved.count === 0) { /* hết vé → ném lỗi */ }
```

Điều kiện "còn đủ vé" được đưa **thẳng xuống câu UPDATE**, không tách thành bước đọc riêng. MySQL khóa row khi UPDATE: request B bị block cho tới khi A commit, và **điều kiện WHERE được đánh giá lại** trên dữ liệu A vừa ghi.

`count === 0` nghĩa là "không đủ vé **tại thời điểm ghi**", chứ không phải tại thời điểm đọc. **Đây là toàn bộ khác biệt giữa read-then-write và CAS.**

**Lớp 3 — CHECK constraint ở MySQL** — `server/prisma/migrations/20260918100000_add_check_available_quantity_non_negative/migration.sql`

```sql
ALTER TABLE `ticket_types`
  ADD CONSTRAINT `ticket_types_availableQuantity_non_negative`
  CHECK (`availableQuantity` >= 0);
```

Prisma **không diễn đạt được** CHECK constraint, nên nó nằm trong migration viết tay.

### 3.3. Câu hỏi PV + cách trả lời

**"Vì sao có lock rồi mà vẫn cần CAS?"**

> Lock là **tối ưu**, CAS là **tính đúng đắn**. Lock có thể mất: key bị eviction do `maxmemory`, Redis failover làm mất write, TTL hết giữa transaction. Khi đó CAS vẫn cứu được. Ngược lại, CAS không thể bị "hết hạn giữa chừng" như lock, vì nó là một câu lệnh gắn liền với transaction của DB.

**"Tại sao không dùng `SELECT ... FOR UPDATE`?"**

> Nó giữ row lock suốt transaction; hàng trăm request cùng một `ticket_type` sẽ xếp hàng dài và timeout. Redis xử lý lock ở bộ nhớ (micro giây) và giảm tải cho MySQL. Tuy vậy tầng DB vẫn có CAS + CHECK constraint làm lưới an toàn.

**"Nếu lock mất giữa transaction thì sao?"**

> CAS vẫn bảo vệ: request thứ hai khi được chạy sẽ đánh giá lại `WHERE availableQuantity >= quantity` trên dữ liệu đã commit, thấy không đủ thì `count = 0`. Kể cả CAS bị vượt, CHECK constraint chặn số âm.

**"Tại sao job hết hạn không cần Redlock?"** — `server/src/jobs/expireOrders.job.ts:40-43`

> Nó không "đọc rồi ghi" — nó dùng `updateMany` có điều kiện `status='PENDING'` như một phép CAS; MySQL khóa row, chỉ MỘT worker thắng. CAS mạnh hơn lock vì không thể "hết hạn giữa chừng".

### 3.4. Số liệu phải nhớ

| Số liệu | Ý nghĩa |
|-----------|---------|
| TTL lock = **5000 ms** | `order.controller.ts:22` |
| `count === 0` | Không đủ vé **tại thời điểm ghi** |
| 200 VU, 10 vé | 10 đơn thành công, `availableQuantity = 0`, **zero oversell**, zero 5xx |

### 3.5. Câu hỏi BẪM — đừng trả lời sai

| Bẫy | Sai | Đúng |
|------|-----|------|
| "Lock đã đủ chống race rồi" | "Đúng, lock là đủ" | Lock có thể mất, CAS mới là chốt chặn thật |
| "Có `if` kiểm tra số vé nên an toàn" | "Đúng" | `if` kiểm tra giá trị **đã cũ**, không phải điều kiện của hành động |
| "Dùng `SELECT ... FOR UPDATE` an toàn hơn" | "Đúng" | Giữ row lock lâu, xếp hàng dài; Redis + CAS tốt hơn |
| "Transaction đã lo được race rồi" | "Đúng" | Isolation level mặc định không chặn **write skew** trên read-then-write |

---

## 4. Chủ đề 2 — Cache Redis

### 4.1. Ba vấn đề thường gặp

| Vấn đề | Mô tả |
|--------|-------|
| **Cache stampede** (thundering herd) | Cache vừa hết hạn, hàng nghìn request cùng MISS và cùng lao vào DB |
| **Stale data** | Dữ liệu đổi nhưng cache chưa cập nhật |
| **Redis downtime** | Redis chết kéo sập cả API dù cache chỉ là tối ưu |

Tất cả đều được xử lý trong `server/src/utils/cache.ts`.

### 4.2. Versioned key — thay `KEYS` bằng `INCR` (O(1))

Vô hiệu cache danh sách thường được làm bằng `KEYS events:list:*` rồi `DEL`. `KEYS` phải quét **toàn bộ keyspace** và **chặn Redis** (đơn luồng) suốt thời gian đó.

**Đo được trên máy này với 50.000 key:**

- `KEYS`: **111 ms** (một lệnh bình thường ~0,1 ms)
- `INCR`: **0,206 ms**

Vì invalidation chạy **sau mỗi đơn đặt vé**, cách cũ biến mỗi đơn hàng thành một cú chặn 111 ms lên toàn bộ Redis.

`server/src/utils/cache.ts:40, 71-78, 220-224`:

```ts
const LIST_VERSION_KEY = 'events:list:v';

export function listCacheKey(version, page, limit, search) {
  return `events:list:v${version}:page=${page}:limit=${limit}:search=${search}`;
}

export async function invalidateEventList() {
  try { await cacheClient.incr(LIST_VERSION_KEY); }  // O(1)
  catch { /* entry cũ tự hết hạn theo TTL */ }
}
```

Khi cần vô hiệu, chỉ **tăng một con số**. Mọi key cũ mang version cũ trở nên **vô hình ngay lập tức**, và tự hết hạn theo TTL 60s — không cần đi xóa cái nào.

- **Đánh đổi:** mỗi request đọc phải đọc thêm version (~0,1 ms) — vẫn rẻ hơn nhiều so với đọc DB (~40 ms).
- **Lỗi Redis khi đọc version** → dùng `VERSION_FALLBACK = '0'` (sẽ MISS, an toàn).

### 4.3. Single-flight — chống stampede

Khi cache MISS, nếu để mọi request cùng đọc DB thì stampede. Hàm `cacheGetOrLoad` (`cache.ts:151-208`) chỉ cho **một** request đi tính lại:

```ts
// 1. Thử giành lock bằng SET NX (chỉ người đầu tiên thành công)
const acquired = await cacheClient.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');

if (holdsLock) {
  // 2. Kiểm tra lại: có thể người khác đã điền cache lúc ta giành lock
  const second = await readCache(key);
  if (second.state === 'hit') return { value: second.value, source: 'cache' };

  const value = await loader();
  if (value !== null && value !== undefined) await writeCache(key, value); // không cache null
  return { value, source: 'database' };
}

// 3. Người thua chờ (polling) cho tới khi cache được điền
for (let round = 0; round < WAIT_ROUNDS; round++) {
  await sleep(WAIT_STEP_MS);
  const retry = await readCache(key);
  if (retry.state === 'hit') return { value: retry.value, source: 'cache' };
}
// 4. Chờ vô ích → thà đọc DB còn hơn treo request
return { value: await loader(), source: 'database' };
```

**Số liệu tại sao cần** (cache lạnh):

- 100 request đồng thời → **6/18/38 lượt đọc DB**
- 500 request → **38/98/130 lượt**

Đúng ra chỉ cần 1. Và stampede tự khuếch đại: DB càng chậm, cửa sổ MISS càng rộng, càng nhiều request lọt vào — **đúng lúc DB yếu nhất**.

> **Ví dụ đời thường:** chỉ **một** thực khách được vào bếp gọi món, 99 người còn lại ngồi chờ. Món ra, ai cũng nhận được.

**Hai chi tiết tinh tế:**

- **Phân biệt MISS với ERROR** (`cache.ts:101-116`). Nếu gộp chung, khi Redis chết mọi request sẽ thử giành lock rồi chờ nhau vô ích. Code xử lý: Redis lỗi → đi thẳng DB, **không giành lock, không chờ ai** (`cache.ts:163-165`).
- **Nhả lock an toàn bằng Lua script** (`cache.ts:57-65, 128`). Chỉ `DEL` nếu giá trị lock vẫn đúng token của mình. Nếu dùng `DEL` trần mà lệnh của ta chậm hơn TTL, lock đã thuộc về người khác → ta xóa oan lock của họ, mở đường cho stampede quay lại.

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

### 4.4. Fail-open — Redis chết thì vẫn sống

`server/src/config/redis.ts:36-49`:

```ts
export const cacheClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  enableOfflineQueue: false,  // Redis chết → báo lỗi ngay, không xếp hàng chờ
  maxRetriesPerRequest: 1,    // không thử lại, thà đọc DB
  commandTimeout: 200,        // chặn trên mỗi lệnh (độ trễ thực ~0,1 ms)
});
```

**Với cấu hình mặc định** (offline queue bật, retry 20 lần), khi Redis chết thì `GET /api/events` **treo 63,09 giây** rồi mới trả 500 — cache trở thành điểm chết duy nhất của hệ thống, đúng thứ nó sinh ra để tránh.

### 4.5. Vì sao có HAI Redis client?

`server/src/config/redis.ts:11` và `:36`

| | `redisClient` | `cacheClient` |
|---|---|---|
| Dùng cho | Redlock (lock) | Cache đọc |
| Tính cách | **Kiên nhẫn**: chờ & thử lại khi tải cao | **Fail-fast**: thất bại nhanh, không giữ request |
| Cấu hình | Mặc định ioredis | `enableOfflineQueue:false`, `maxRetriesPerRequest:1` |

Hai bên có yêu cầu **trái ngược nhau**:

- Nếu dùng chung một client cấu hình fail-fast → Redlock sẽ không chờ nổi khi tải cao → không đặt được vé.
- Nếu dùng chung cấu hình kiên nhẫn → cache làm treo request khi Redis chết.

Tách ra thì Redis chết **chỉ ảnh hưởng lock**, còn đọc dữ liệu vẫn chạy qua DB.

### 4.6. Không cache giá trị null

`cache.ts:186-189`: chỉ ghi cache khi `value !== null && value !== undefined`.

Nếu cache null, mọi request sau nhận "not found" **ngay cả khi data đã được tạo ra** — nhưng phải chờ hết TTL mới thấy. Muốn cache "không tìm thấy" thì cần một sentinel riêng để phân biệt với MISS.

### 4.7. Invalidate list vs detail

`cache.ts:220-252`:

- `invalidateEventList()` — chỉ `INCR` version.
- `invalidateEventDetails(ids)` — `DEL` key chi tiết (số lượng nhỏ, xóa trực tiếp rẻ).
- `invalidateEventCache(ids)` — làm **cả hai**, vì response danh sách **cũng chứa `ticketTypes`** (tức là có luôn số vé còn lại), giống response chi tiết.

TTL cache = 60 giây (`cache.ts:17`).

### 4.8. Câu hỏi PV

**"Làm sao tránh cache stampede?"**

> Single-flight: khi MISS chỉ một request giành được lock Redis (SET NX) và đi tính lại; các request khác polling chờ cache được điền thay vì cùng đập DB. Có kiểm tra lại cache sau khi giành lock, và fallback đọc DB nếu chờ quá lâu.

**"Tại sao không cache null/missing?"**

> Vì sẽ "cache poisoned": data thực sự chưa tồn tại bị ghi nhớ là không tồn tại, mọi request sau nhận "not found" ngay cả khi data đã được tạo, cho tới khi hết TTL. Muốn cache missing phải dùng sentinel riêng để phân biệt với MISS.

**"Đo cache hit/miss thế nào cho đúng?"**

> Chỉ số `cache_hit_rate`, `db_reads`. **Phải làm cache lạnh trước** khi đo — nếu cache đang ấm thì mọi request đều hit và test không nói lên gì. Cách xóa: `redis-cli --scan --pattern 'events:list:*' | xargs -r redis-cli del`.

**"Có bao giờ cache bị xóa toàn bộ không?"**

> Không, dùng versioned key. Version tăng lên → mọi key cũ "vô hình" ngay lập tức và tự hết hạn theo TTL 60s. Không tồn tại thao tác xóa hàng loạt key.

---

## 5. Chủ đề 3 — Bảo mật

### 5.1. JWT — không bao giờ có secret mặc định

`server/src/config/auth.ts:34-60`:

```ts
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Thiếu biến môi trường JWT_SECRET...');
  if (secret === OLD_LEAKED_DEFAULT) throw new Error('JWT_SECRET đang dùng giá trị mặc định cũ đã bị lộ...');
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`JWT_SECRET quá ngắn (${secret.length}, cần ít nhất ${MIN_SECRET_LENGTH})...`);
  return secret;
}
```

`MIN_SECRET_LENGTH = 32` (`auth.ts:13`).

**Điểm hay:** fail fast ngay lúc **khởi động** (`assertAuthConfig()` gọi ở `app.ts:80`), thay vì chạy với secret mặc định mà cả thế giới biết. Bộ test có 4 case chạy `getJwtSecret()` trong **process con** để kiểm tra từng trường hợp.

### 5.2. Algorithm pinning — chống algorithm confusion

`server/src/middlewares/auth.middleware.ts:46`:

```ts
decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
```

Nếu để trống, thư viện tự chọn thuật toán theo header của token → kẻ tấn công ký token bằng `alg: none` hoặc đổi HS256 sang RS256. **Ghim `algorithms` là chống thuốc.**

### 5.3. Không tin role trong JWT — đọc từ DB

JWT sống **1 ngày**. Nếu tin token, sau khi admin hạ quyền, người đó vẫn giữ quyền cũ tới hết hạn — đúng thứ mà tính năng "hạ quyền" sinh ra để chặn.

`auth.middleware.ts:24-70`:

```ts
// verify token → đọc trạng thái tài khoản (có cache Redis) → gán currentRole
req.user.currentRole = state.role;
```

`server/src/utils/userState.ts`: cache trạng thái trong Redis, **TTL 30 giây** (`userState.ts:49`), đọc DB theo PK mất **0,32 ms**, đọc cache **~0,1 ms**. Khi đổi quyền thì `invalidateUserState` chạy ngay trong request → hiệu lực **tức thời**, không cần chờ TTL.

**Controller chỉ đọc `currentRole`, không đọc `req.user.role`.**

### 5.4. Rate limit — 4 bộ, 4 mục đích

`server/src/middlewares/rateLimit.middleware.ts`

| Limiter | Hạn mức | Khoá theo | Mục đích |
|---------|----------|-----------|----------|
| `apiRateLimiter` | 100/phút | IP | Chống abuse/DDoS nhẹ, bảo vệ cả khi chưa biết client là ai |
| `authRateLimiter` | 5 **thất bại**/phút | IP | Chống brute-force mật khẩu |
| `registerRateLimiter` | 10/phút (kể cả thành công) | IP | Chống spam account |
| `orderRateLimiter` | 15/5 phút | **`userId`** | Chống đặt vé liên tục |

**Điểm đặc biệt — `orderRateLimiter` khoá theo TÀI KHOẢN chứ không phải IP** (`rateLimit.middleware.ts:48-55`):

```ts
keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'unknown',
```

Lý do: trong thực tế rất nhiều người dùng chung một IP (văn phòng, trường đại học, WiFi nhà, mạng di động). Khoá theo IP nghĩa là họ bị chặn oan chỉ vì người khác trong cùng mạng đã đặt nhiều vé. Ngược lại, khoá theo tài khoản không bị bot đánh lách bằng cách đổi IP.

Điều kiện để làm được là limiter phải chạy **SAU `authenticate`** — đó là lý do thứ tự middleware trong `order.routes.ts` quan trọng, không phải ngẫu nhiên:

```ts
router.post('/', authenticate, orderRateLimiter, validateBody(createOrderSchema), createOrder);
```

`authRateLimiter` dùng `skipSuccessfulRequests: true` → chỉ request **thất bại** mới bị đếm, người gõ sai 4 lần rồi nhập đúng vẫn dùng bình thường.

### 5.5. RBAC — 2 tầng, và vì sao role trong token bị bỏ qua

`auth.middleware.ts:96-130` (`authorize`): so sánh `currentRole` (từ DB) với danh sách cho phép. `authenticate` đã đọc trạng thái rồi nên `authorize` không cần hỏi DB lần nữa (nếu cache còn hiệu lực).

**Vì sao không tách bảng `roles`/`permissions`/`role_user`/`permission_role`:**

- Hệ thống chỉ có 3 vai trò cố định và quyền gắn với từng route.
- Policy nằm cạnh endpoint, đọc role là 1 lượt đọc theo PK (~0,32 ms, cache ~0,1 ms).
- `Role` là enum Prisma nên sai chính tả là **lỗi compile**, chứ không phải lỗi runtime.
- Đổi sang RBAC động chỉ khi cần role tuỳ biến, multi-tenant, hay một người mang nhiều vai trò.

### 5.6. Không rò rỉ lỗi ra client

`server/src/utils/errors.ts:11`:

```ts
export class AppError extends Error {}
```

Chỉ `AppError` mới được ra client nguyên văn. Mọi lỗi khác → `logUnexpectedError` ghi log ở server, client nhận thông báo chung. Server không được lộ chi tiết lỗi (host, port, tên database…).

### 5.7. Câu hỏi PV

**"Tại sao không tin role trong JWT?"**

> JWT sống tới 1 ngày. Tin token → sau khi admin hạ quyền, người đó vẫn giữ quyền cũ tới hết hạn. `authenticate` luôn hỏi DB và gán `currentRole`; controller chỉ đọc `currentRole`. Cache Redis 30 giây giữ đường đặt vé không phải đọc DB mỗi request, nhưng khi đổi quyền thì `invalidateUserState` chạy ngay trong request nên hiệu lực tức thời.

**"Vì sao rate limit đặt vé theo tài khoản chứ không theo IP?"**

> Vì thực tế nhiều người dùng chung một IP. Khoá theo IP nghĩa là bị chặn oan. Ngược lại khoá theo tài khoản không bị bot đánh lách bằng cách đổi IP. Điều kiện để làm được là limiter phải chạy **sau `authenticate`**.

**"Algorithm confusion là gì?"**

> Nếu để trống `algorithms`, thư viện tự chọn thuật toán theo header của token. Kẻ tấn công ký token bằng `alg: none` → token được coi là hợp lệ mà không cần biết secret. Ghim `algorithms: ['HS256']` là chống thuốc.

**"Token hết hạn rồi phải đăng nhập lại? Refresh token có cần không?"**

> **Đây là gap của project** (xem mục 12). Trả lời thẳng: *"Chưa làm refresh token. Hiện tại JWT sống 1 ngày, hết hạn phải đăng nhập lại. Với production, tôi sẽ thêm refresh token lưu trong httpOnly cookie + access token ngắn hạn (15–30 phút) — đây là thay đổi khá nhỏ, không đụng lại phần tranh chấp tồn kho."*

---

## 6. Chủ đề 4 — Job nền trả vé (bài toán con: đơn hết hạn)

`server/src/jobs/expireOrders.job.ts:22-90`

```ts
const result = await prisma.$transaction(async (tx) => {
  // CAS: chỉ một worker đổi được PENDING → EXPIRED
  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  if (claimed.count === 0) return null; // worker khác đã xử lý
  // ... cộng trả vé theo từng loại (đếm từ order.tickets)
});
```

**Bốn bài học:**

1. **CAS ở đây thay cho lock**: job không đọc giá trị cũ để quyết định (khác `createOrder`), nó chỉ đổi trạng thái có điều kiện. MySQL khóa row, worker thua nhận `count = 0` và bỏ qua.
2. **Đổi trạng thái và trả vé phải cùng MỘT transaction**: nếu tách rời mà bước cộng vé lỗi, ta có đơn `EXPIRED` nhưng vé biến mất vĩnh viễn (không còn `PENDING` để job bắt lần sau).
3. **Một đơn lỗi không làm chết cả lượt quét**: mỗi đơn bọc trong `try/catch` riêng.
4. **Trả vé xong phải xoá cache** (`job:86`), nếu không UI còn hiển thị số vé cũ tới 60 giây.

`startExpireOrdersJob` (`job:96-115`) quét ngay 1 lượt lúc khởi động (bắt các đơn hết hạn trong lúc server tắt) rồi lặp mỗi `ORDER_SWEEP_INTERVAL_MS` (mặc định 60s). `.unref()` để job không giữ process sống.

---

## 7. Chủ đề 5 — Race hành trị (ba câu hỏi hay)

`server/src/controllers/admin.controller.ts:50`:

```sql
SELECT id FROM `users` WHERE `role` = 'ADMIN' AND `isActive` = 1 FOR UPDATE
```

Tình huống: hệ thống chỉ còn đúng 2 admin (A và B). A gọi "hạ quyền B" và B gọi "hạ quyền A" **cùng lúc**. Nếu cả hai cùng thấy "còn admin khác" thì cả hai đều được phép → hệ thống không còn admin nào quản trị được.

**Điểm hay — KHÔNG dùng `count()`:** trong MySQL, `count()` là **consistent read theo snapshot** của transaction, nên nó có thể đọc trạng thái **CŨ HƠN** trạng thái mà một locking read vừa khoá, mở lại đúng lỗ hổng đang cố chặn. Cách đúng: locking read để chặn, rồi **đếm kết quả trả về trong JS** (`rows.length`) chứ không `count()` lần nữa trong cùng transaction.

Test: `npm run test:race` — 2 admin cùng hạ quyền nhau → chỉ 1 thắng, "Không thể hạ quyền admin cuối cùng của hệ thống!" (400).

---

## 8. Chủ đề 6 — Phân loại lỗi (dễ bị hỏi, dễ bị trượt)

`server/src/utils/errors.ts:51-100` — hàm `mapPrismaError`:

| Mã lỗi Prisma | Ý nghĩa | HTTP |
|---------------|---------|------|
| `P2000` | Giá trị quá dài cho cột ("too long for the column's type") | 400 |
| `P2002` | Vi phạm ràng buộc UNIQUE | 409 |
| `P2003` | Vi phạm ràng buộc FOREIGN KEY | 400 |
| `P2020` | Giá trị nằm ngoài khoảng của kiểu (vượt DECIMAL/INTEGER) | 400 |
| Lỗi MySQL thô | Không có mã Prisma | 400 |
| Lỗi lạ | Không xác định được | `null` → 500 |

**Với `createOrder`** (`order.controller.ts:127-148`):

| Tình huống | Status | Vì sao |
|-----------|--------|--------|
| Redlock không lấy được lock (`ExecutionError`) | **429** | Quá tải, client thử lại được |
| Hết vé / loại vé không tồn tại (`AppError`) | **400** | Lỗi thuộc về request, thử lại y nguyên là vô ích |
| Mọi lỗi còn lại (Prisma timeout, mất DB…) | **500** | Lỗi server |

**Nếu gộp 500 vào 400** như code cũ, khi DB quá tải client sẽ được báo "request của bạn sai" → không thử lại, và monitoring đếm hụt lỗi server. **Phân loại sai làm chẩn đoán sai.**

---

## 9. Chủ đề 7 — Các bug thực tế đã gặp (đáng giá nhất khi phỏng vấn)

Đây là phần **đáng giá nhất** khi PV, vì nó chứng minh bạn đọc code thật chứ không đọc Wikipedia. Mỗi mục đều là bug **đã xảy ra trong chính project này** và **đã được sửa + có test**.

### 9.1. Oversell: read-then-write (mục 3.1)

### 9.2. `VARCHAR(191)` làm mọi thao tác tạo sự kiện chết với 500

**Triệu chứng:** tạo sự kiện với mô tả dài hơn 191 ký tự → API trả **500 `{"message":"Lỗi máy chủ"}`**. Người dùng không biết mình sai ở đâu.

**Nguyên nhân:** Prisma mặc định mọi cột `String` thành `VARCHAR(191)`. Con số 191 đến từ **giới hạn index utf8mb4** (191 × 4 byte = 764 < 767 byte), **không phải quyết định thiết kế**. Zod không giới hạn độ dài, form không có `maxlength` → mô tả đi thẳng tới MySQL → MySQL từ chối → Prisma ném `P2000` → controller trả 500.

**Sửa 3 tầng** (migration `20261020120000_widen_content_columns`):

| Cột | Trước | Sau |
|-----|-------|-----|
| `events.title` | VARCHAR(191) | VARCHAR(255) |
| `events.description` | VARCHAR(191) | **TEXT** |
| `events.location` | VARCHAR(191) | VARCHAR(255) |
| `events.bannerUrl` | VARCHAR(191) | VARCHAR(500) |
| `ticket_types.name` | VARCHAR(191) | VARCHAR(100) |
| `ticket_types.price` | DECIMAL(10,2) | DECIMAL(12,2) |
| `orders.totalAmount` | DECIMAL(10,2) | DECIMAL(12,2) |

+ `.max()` trong Zod + `maxlength` trên form → **3 tầng cùng một con số**.

**Bài học:** giới hạn độ dài phải **khớp** với bảng DB. Nếu không, dữ liệu quá dài đi thẳng tới MySQL rồi mới chết, và lỗi quay về là 500 chung chung thay vì 400 nói rõ "trường nào vượt, vượt bao nhiêu".

### 9.3. Sự kiện tạo được nhưng không ai đặt vé được

`price` và `totalQuantity` đều hợp lệ riêng lẻ, nhưng `orders.totalAmount` lưu `price × quantity` → **tích** của chúng phải vừa biên `DECIMAL(12,2)`.

```
tạo sự kiện: giá 9.999.999.999,99 × 2 vé  ->  201 (thành công, lên kệ)
đặt vé:      tổng = 19.999.999.999,98      ->  400 (vượt biên cột)
```

Sự kiện lên kệ thành công nhưng **không ai mua được** — lỗi chỉ lộ ra ở bước thanh toán, xa hơn nhiều so với lúc tạo sự kiện.

**Sửa:** `superRefine` kiểm tra tích lúc tạo/sửa sự kiện + **kiểm tra lại trong `order.controller.ts`** (vì giá vé có thể được sửa sau khi sự kiện đã tạo — `order.controller.ts:85-87`).

**Chi tiết kỹ thuật:** khi so sánh ở biên phải **làm tròn về 2 chữ số thập phân trước**: `3333333333.33 × 3` trong JS ra `9999999999.9899997711181640625`, so thẳng với `9999999999.99` sẽ **chặn oan** một đơn hợp lệ.

### 9.4. Một request có thể làm sập server (DoS)

`order.controller.ts:98`:

```ts
tickets: { create: Array.from({ length: quantity }).map(() => ({ ticketTypeId })) }
```

Tạo N bản ghi `Ticket` trong RAM bằng `Array.from` — đo thực tế **~46 byte/phần tử**:

| quantity | RAM cần |
|----------|---------|
| 1.000.000 | ~46 MB |
| 5.000.000 | ~233 MB |
| 2.147.483.647 | **~100 GB → sập tiến trình Node** |

Một request có `quantity` không trần (chỉ cần `availableQuantity` đủ lớn) là đủ để làm sập cả server. **Loại lỗi này chỉ lộ ra khi đọc code, không lộ ra khi chạy test bình thường** (ai cũng đặt 1–2 vé).

**Sửa:** `LIMITS.MAX_ORDER_QUANTITY = 100`.

### 9.5. CORS: toán tử comma làm mất `CORS_ORIGINS`

**Triệu chứng:** client chạy ở cổng **5174** báo lỗi CORS, dù đã khai báo cổng. Thực tế **chỉ 5175** hoạt động.

**Nguyên nhân** (`server/src/app.ts`, code cũ):

```ts
const allowedOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,...',
  'http://localhost:5174,...',
  'http://localhost:5176,...',
  'http://localhost:5175,...'      // <- chỉ phần tử CUỐI được giữ lại
).split(',')
```

**Dấu phẩy trong JavaScript là TOÁN TỬ COMMA** (ưu tiên thấp nhất), không phải phần tử mảng. Biểu thức được parse thành `(a ?? 'b'), 'c', 'd'` → **chỉ trả về phần tử cuối cùng**. `CORS_ORIGINS` trong `.env` bị bỏ qua hoàn toàn.

**Bài học (rất dễ gặp, rất dễ nói trong PV):**

- `??` ràng hơn `||` nhưng **không cứu được toán tử comma** — toán tử comma có ưu tiên thấp hơn mọi toán tử khác, nên nó nuốt toàn bộ biểu thức bên trái.
- Muốn nhiều giá trị mặc định thì dùng `.join(',')` trong MỘT chuỗi, hoặc mảng thật.
- **Tại sao lỗi này lọt qua toàn bộ test?** Vì các script test gọi API bằng `fetch` của Node — Node **không** tự gửi header `Origin`, nên nhánh "không có Origin → cho qua" luôn đúng và whitelist chưa bao giờ được kiểm tra. Cách sửa: tách `parseAllowedOrigins` ra `server/src/utils/cors.ts` để unit-test được, và thêm `test-cors.cjs` sinh header `Origin` thật.

### 9.6. Script test lỗi giữa chừng → để lại tài khoản rác có mật khẩu đã biết

Rà DB phát hiện **10 tài khoản ADMIN rác**, tất cả đều có mật khẩu `MatKhauDaiHon8KyTu`.

Ba nguyên nhân (đều là lỗi trong chính bộ test):

1. Script tạo tài khoản rồi xoá ở cuối happy path, còn `main().catch()` chỉ in lỗi rồi thoát → lỗi giữa chừng là để lại tài khoản.
2. `Order.userId` là FK **Restrict** → phải xoá **order trước** rồi mới xoá user. `prisma.user.delete(...).catch(() => {})` **nuốt mất lỗi FK**, nên nhìn tưởng đã xoá.
3. `test-admin-race.cjs`: `updateMany` hạ quyền **toàn bộ admin** nằm **ngoài** khối `try` → lỗi ngay sau đó sẽ để lại hệ thống **không còn admin nào**.

**Sửa:** `cleanup()` gọi ở **cả** đường thành công lẫn đường lỗi, và thứ tự xoá đúng: `order → event → audit log → user`.

### 9.7. Chạy cả bộ test liên tiếp vượt rate limit, báo lỗi sai

`apiRateLimiter` giới hạn **100 request/phút**. Mỗi bộ test riêng lẻ dùng chưa tới 40 request, nhưng cả 7 bộ cộng lại vượt 100.

Triệu chứng **rất dễ hiểu nhầm**:

| Bộ test | Thông báo lỗi | Thực tế |
|---------|---------------|---------|
| `test-cors` | "không kết nối được server" | Server vẫn chạy, chỉ là 429 |
| `test-validation` | `SyntaxError: Unexpected token 'Q'` | Body 429 của express-rate-limit là **plain text**, không phải JSON |

**Sửa:** `server/run-all-tests.cjs` đọc header `RateLimit-Remaining` / `RateLimit-Reset` (server bật `standardHeaders: true`) để chờ đúng số giây còn thiếu, thay vì ngủ cứng 60s. Các script báo rõ nguyên nhân khi gặp 429.

### 9.8. Kỹ năng nhỏ nhưng ấn tượng: đọc `RateLimit-Reset`

`standardHeaders: true` của `express-rate-limit` giúp server tự gửi header:

```
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 42
```

Dùng header này để **tự điều chỉnh** (ví dụ: client tự chậm lại khi còn ít quota) thay vì hardcode.

---

## 10. Chủ đề 8 — Client: chống double-booking (chỉ là UX!)

`client/src/views/EventDetailView.vue`

```vue
:disabled="ticket.availableQuantity <= 0 || submittingId === ticket.id"
```

- `submittingId` (dòng 21) — chỉ một loại vé được gửi một lúc, các loại khác bị disable.
- `normalizeQuantity` (dòng 109) — chuẩn hoá khi blur: xoá trắng → về 1; vượt tồn kho → kẹp về `availableQuantity`.
- Comment ở dòng 81–82: *"Chỉ tắt loading nếu đây vẫn là request mới nhất"* — request bị huỷ vẫn chạy tới `finally` và không được tắt loading của request đang bay.

**Điểm quan trọng nhất:** frontend disable nút chỉ là **UX**. Kẻ tấn công bỏ qua UI và gọi API trực tiếp. **Đây là lý do phải có đủ cả redlock + CAS + rate limit.**

Nếu interviewer hỏi *"Ứng dụng đã khoá nút rồi thì cần khoá ở backend nữa không?"* — đây là câu hỏi dễ vang: trả lời *"Có, và đây là lý do tôi có 3 lớp bảo vệ."*

---

## 11. Bảng số liệu PHẢI NHỚ (PV hay hỏi "con số nào?")

| Số liệu | Ý nghĩa | Ở đâu |
|---------|---------|-------|
| 111 ms vs 0,206 ms | `KEYS` vs `INCR` với 50.000 key | mục 4.2 |
| 63,09 giây | `GET /api/events` treo khi Redis chết với cấu hình mặc định | mục 4.4 |
| 6/18/38 lượt | 100 request đồng thời, cache lạnh | mục 4.3 |
| 38/98/130 lượt | 500 request đồng thời, cache lạnh | mục 4.3 |
| ~46 byte/phần tử | RAM cho một `Ticket` trong `Array.from` | mục 9.4 |
| ~100 GB | RAM khi `quantity` = 2.147.483.647 | mục 9.4 |
| 0,32 ms vs ~0,1 ms | đọc DB theo PK vs đọc cache Redis | mục 5.3 |
| 191 × 4 = 764 < 767 byte | giới hạn index utf8mb4 | mục 9.2 |
| TTL lock 5000 ms | độ giữ lock tối đa | mục 3.2 |
| 10 vé / 200 VU | load test: 10 đơn, zero oversell, zero 5xx | mục 3.4 |
| 100 req/phút | `apiRateLimiter` | mục 5.4 |
| 15 lần / 5 phút | `orderRateLimiter` (theo tài khoản) | mục 5.4 |
| 5 lần thất bại / phút | `authRateLimiter` | mục 5.4 |
| TTL cache 60 s | `READ_TTL_SECONDS` (`cache.ts:17`) | mục 4.2 |
| TTL user state 30 s | `USER_STATE_TTL_SECONDS` (`userState.ts:49`) | mục 5.3 |
| JWT 1 ngày | hạn token | mục 5.3 |

---

## 12. Gap của project — BIẾT TRƯỚC, trả lời trung thực

Interviewer **sẽ** hỏi về cái còn thiếu. Nếu biết, bạn được cộng điểm; nếu giấu, họ sẽ hỏi tiếp và bạn không trả lời được.

| Gap | Mức độ | Trả lời như thế nào |
|-----|--------|-------------------|
| **Chưa có thanh toán** | Trung bình | *"Chưa làm VNPay/MoMo. Đó là ranh giới của project. Anh/chị sẽ làm được ở bước nào?"* — bước: thêm bảng trạng thái thanh toán, webhook xác nhận, `updateMany` đổi trạng thái `PENDING → CONFIRMED` có điều kiện (CAS, đúng pattern job hết hạn). **Ghi chú quan trọng:** vì vậy `CONFIRMED`/`CANCELLED` chưa bao giờ được set, nên **doanh thu trong admin/organizer stats luôn = 0**. Nói thẳng điều này. |
| **Chưa có refresh token** | Thấp | xem mục 5.7 |
| **Chưa có CI** | Trung bình | *"Chạy 7 bộ test bằng script (`npm run test:all`) và k6, chưa có CI. Nếu có thời gian, tôi sẽ đưa vào GitHub Actions: service MySQL + Redis, chạy test, k6 smoke test."* |
| **Chưa có Docker / HTTPS / helmet / structured logging** | Thấp | *"Chưa làm. Đây là danh sách việc production-ready, nằm trong roadmap."* |
| **Chưa có email xác nhận / quên mật khẩu** | Thấp | *"Chưa làm, sẽ thêm luồng OTP và bảng token tạm."* |
| **RBAC tĩnh, chưa có bảng `permissions`** | Thấp | xem mục 5.5 — có lý do rõ ràng |

**Câu hỏi kiểm tra bạn có thật không:**

> *"Anh/chị nói project này chạy production chưa?"*
>
> Trả lời: *"Chưa. Hiện tại là project học tập và mới chạy ở môi trường dev với MySQL/Redis local. Phần còn thiếu để lên production đã được nằm trong roadmap: Docker, secret management, structured logging, refresh token, và tích hợp thanh toán."*

---

## 13. Câu hỏi đảo ngược — hỏi được thì nên hỏi

- *"Dự án này của anh/chị hay làm nhóm?"* → **Hỏi**: quy mô, phần nào bạn làm, deadline
- *"Máy test chạy theo kiểu nào?"* → **Hỏi**: có CI không, deploy thế nào, có cảnh báo gì không
- *"Có bao giờ cần rollback không?"* → **Hỏi**: quy trình release
- *"Team bao nhiêu người, ai làm phần nào?"* → **Hỏi** để biết môi trường xử lý
- *"Hệ thống chạy trên máy số bao nhiêu người đồng thời?"* → **Hỏi** để biết target scale

---

## 14. Checklist tự kiểm tra trước PV

### 14.1. Code phải đọc thuộc (không tìm trong file lúc PV)

- [ ] `server/src/controllers/order.controller.ts` — 183 dòng, đọc hết
- [ ] `server/src/utils/cache.ts` — đọc hết, đặc biệt `cacheGetOrLoad` và `parseAllowedOrigins`
- [ ] `server/src/middlewares/auth.middleware.ts` — đọc hết
- [ ] `server/src/jobs/expireOrders.job.ts` — đọc hết
- [ ] `server/src/config/redis.ts` và `config/auth.ts`
- [ ] `server/src/utils/errors.ts` và `utils/validation.ts`
- [ ] `server/prisma/schema.prisma` — 139 dòng
- [ ] `server/src/controllers/admin.controller.ts` — phần `FOR UPDATE`
- [ ] `client/src/views/EventDetailView.vue` — phần double-booking

### 14.2. Phải chạy được không cần tìm

- [ ] `npm run seed` — tạo admin
- [ ] `npm run test:all` — 7 bộ test
- [ ] `npm run test:security` — 17 case bảo mật
- [ ] `npx k6 run load-test-concurrent.js` — 200 VU
- [ ] `node oversell-repro.cjs` — mô phỏng mất lock

### 14.3. Câu hỏi bắt buộc tự trả lời được (không hỏi lại)

1. Bài toán chính là gì? → **Tranh chấp tồn kho**
2. Vì sao không dùng read-then-write? → **Khoảng thời gian giữa đọc và ghi**
3. Lock và CAS khác nhau thế nào? → **Lock = tối ưu, CAS = tính đúng đắn**
4. Vì sao job không cần lock? → **Nó là CAS, không phải read-then-write**
5. Stampede là gì, sửa thế nào? → **Single-flight với SET NX**
6. Vì sao có 2 Redis client? → **2 yêu cầu trái ngược**
7. Vì sao không tin role trong JWT? → **JWT sống 1 ngày**
8. Rate limit theo IP hay tài khoản? → **Tùy use case** (đặt vé: theo tài khoản)
9. Vì sao có 3 lớp bảo vệ? → **Defense in depth**
10. Làm gì khi Redis chết? → **Fail-open, đọc DB**

### 14.4. Lỗi thường gặp khi bị hỏi "anh/chị làm gì thêm được"

Nếu câu hỏi nằm ngoài kiến thức của project (ví dụ "implement bằng Kafka"), **nói rõ là bạn chưa làm** rồi **nói bạn sẽ làm theo hướng nào**. Đó là câu trả lời chuẩn nghiệp hơn là "em chưa nghĩ tới".

---

## 15. Đề xuất luyện tập

| Cách | Thời gian | Dùng để |
|------|-----------|---------|
| **Kể lại 3 bug** (mục 9.2, 9.3, 9.5) theo **STAR**: Situation → Task → Action → Result | 10 phút | Thay vì "em dùng Zod và Prisma", kể bằng 3 câu chuyện có triệu chứng, số liệu và kết quả |
| **Vẽ lại 3 lớp bảo vệ** trên giấy | 5 phút | Nếu vẽ sai, interviewer sẽ biết mình hiểu |
| **Phân biệt `updateMany` có điều kiện** với `SELECT ... FOR UPDATE` | 5 phút | Phân biệt thường gặp nhất |
| **Mở code tìm bằng mắt** (VD: "tìm chỗ đang giữ lock sau khi commit") | 5 phút | Chứng minh thuộc codebase |
| **Tự viết lại `parseAllowedOrigins` và `cacheGetOrLoad`** không xem code | 15 phút | Kiểm tra hiểu bài |
| **Diễn giải `mapPrismaError`** | 5 phút | Phân loại lỗi — dễ bị hỏi |

---

*Tài liệu học tập — cập nhật 21/10/2026. Đọc kèm `PROJECT_NOTES.md` (giải thích chi tiết từng cơ chế, kèm số dòng) và `README.md`.*
