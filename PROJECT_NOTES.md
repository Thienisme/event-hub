# 📘 EventHub — Tài Liệu Học Tập & Giải Thích Kiến Trúc

> Tài liệu này viết để **học**: không chỉ nói "đã làm gì", mà giải thích
> **vấn đề là gì → tại sao cách cũ sai → cách đúng hoạt động ra sao → đánh đổi**.
> Mọi số dòng trích dẫn đều trỏ tới source thật tại thời điểm viết.

---

## 1. Dự Án Này Là Gì?

EventHub là một hệ thống bán vé sự kiện cho phép:

- Người tổ chức (ORGANIZER/ADMIN) tạo sự kiện kèm nhiều loại vé (VIP, Standard...), mỗi loại có số lượng giới hạn.
- Người dùng (CUSTOMER) xem sự kiện, chọn loại vé, đặt vé.
- Đơn đặt vé ở trạng thái `PENDING` được **giữ chỗ 10 phút**. Không thanh toán kịp thì job nền chuyển sang `EXPIRED` và trả vé về kho.

Điểm khó của bài toán không nằm ở CRUD, mà nằm ở **tranh chấp tồn kho khi hàng nghìn người cùng mua chiếc vé cuối**. Đây là lý do tồn tại của phần lớn code trong repo.

### Năm mục tiêu kỹ thuật

| # | Mục tiêu | Bài toán con | Giải pháp chính |
|---|----------|--------------|-----------------|
| 1 | Không bán quá số lượng | Race condition khi trừ kho | Redlock + CAS ở DB + CHECK constraint |
| 2 | Giảm tải database | Cache stampede / invalidate | Versioned key + Single-flight + Fail-open |
| 3 | Bảo mật production-ready | Giả mạo JWT, leo quyền, brute-force | Fail-fast secret, pin algorithm, RBAC, rate limit |
| 4 | Chịu tải cao | Nhiều request đồng thời | Xử lý lock ở Redis, CAS ở MySQL |
| 5 | Dữ liệu nhất quán | Đơn hết hạn, tồn kho ảo | Transaction + job nền + cache invalidation |

---

## 2. Tech Stack & Sơ Đồ Thư Mục

| Tầng | Công nghệ | Vai trò |
|------|-----------|---------|
| Frontend | Vue 3 + TypeScript + Pinia + Tailwind v4 + Vue Router | SPA |
| Backend | Node.js 22 + Express 4 + TypeScript | REST API |
| Database | MySQL 8 + Prisma ORM 5 | Lưu trữ bền vững |
| Cache / Lock | Redis 7 (2 client riêng biệt) | Distributed lock + cache |
| Validation | Zod | Kiểm tra input |
| Test | k6 + script Node thuần | Load test + security test |
| Dev | ts-node-dev | Hot reload |

```
event-hub/
├── package.json                    # Root: ioredis + redlock dùng chung
├── README.md/                      # (thư mục) tài liệu phụ
├── PROJECT_NOTES.md                # ← file này
├── client/                         # Frontend Vue 3
│   └── src/
│       ├── api/axios.ts            # Axios + interceptor gắn token / xử lý 401
│       ├── stores/                 # Pinia: auth.ts, event.ts, order.ts
│       ├── router/index.ts         # Route guard (requiresAuth, organizerOnly)
│       ├── views/                  # Home, EventDetail, EventForm, Login, Register, MyOrders, NotFound
│       └── components/             # AppAlert, EventBanner, EventCard
└── server/                         # Backend Express
    ├── src/
    │   ├── app.ts                  # Entry point, middleware, fail-fast config
    │   ├── config/
    │   │   ├── auth.ts             # getJwtSecret() + assertAuthConfig()
    │   │   ├── redis.ts            # redisClient (lock) + cacheClient (cache) + redlock
    │   │   └── order.ts            # ORDER_HOLD_MINUTES + buildExpiresAt()
    │   ├── controllers/            # auth / event / order
    │   ├── middlewares/            # auth.middleware.ts, rateLimit.middleware.ts
    │   ├── routes/                 # auth / event / order
    │   ├── jobs/expireOrders.job.ts# Job trả vé về kho
    │   ├── utils/                  # cache.ts, errors.ts, prisma.ts, validation.ts
    │   └── types/                  # express.d.ts, redlock.d.ts
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/             # có migration thêm CHECK constraint viết tay
    ├── load-test.js                # 100 VUs (đường ghi)
    ├── load-test-concurrent.js     # 200 VUs, 1 loại vé 10 vé
    ├── load-test-read.js           # đo cache hit/miss ở đường đọc
    ├── oversell-natural.cjs        # lock hết hạn tự nhiên
    ├── oversell-repro.cjs          # xoá lock giữa transaction (mô phỏng lỗi hạ tầng)
    └── test-jwt-security.cjs       # bộ test bảo mật JWT
```

---

## 3. Mô Hình Dữ Liệu (Prisma)

`server/prisma/schema.prisma`:

```
User 1─n Event        (OrganizerEvents)
User 1─n Order
Event 1─n TicketType  (cascade delete)
Order 1─n Ticket
TicketType 1─n Ticket
```

Bốn điều cần nhớ:

1. **`TicketType` là nơi chứa tồn kho**: `totalQuantity` (tổng) và `availableQuantity` (còn lại). Mọi cuộc tranh chấp mua vé đều xoay quanh `availableQuantity`.
2. **Một `Ticket` = một vé vật lý**. Đặt `quantity = 3` tạo ra 3 record `Ticket`, không phải 1 record kèm cột số lượng. Nhờ vậy job hết hạn chỉ cần đếm số `Ticket` để biết trả bao nhiêu vé.
3. **`Order.expiresAt`** là mốc giữ chỗ. `PENDING` + quá `expiresAt` = sẽ bị job nền dọn.
4. **`@@map(...)`** đặt tên bảng snake_case trong MySQL (`ticket_types`), trong khi model Prisma vẫn PascalCase.

### CHECK constraint — "lưới an toàn cuối cùng"

Prisma **không diễn đạt được** CHECK constraint, nên nó nằm trong migration viết tay
`server/prisma/migrations/20260918100000_add_check_available_quantity_non_negative/migration.sql`:

```sql
ALTER TABLE `ticket_types`
  ADD CONSTRAINT `ticket_types_availableQuantity_non_negative`
  CHECK (`availableQuantity` >= 0);
```

Tác dụng: **kể cả khi toàn bộ logic chống oversell ở tầng ứng dụng bị vô hiệu**
(Redis mất dữ liệu, lock hết TTL giữa chừng, một câu UPDATE viết sai trong tương lai),
MySQL vẫn từ chối ghi số âm. Đây là ví dụ của nguyên tắc **defense in depth**: mỗi lớp giả định lớp trên đã thất bại.

---

## 4. Bài Toán #1 — Chống Oversell (Race Condition)

### 4.1 Vấn đề

Giả sử còn đúng **1 vé**. Hai request A và B đến cùng lúc. Cách viết ngây thơ:

```ts
// ❌ READ-THEN-WRITE — có lỗ hổng
const t = await tx.ticketType.findUnique({ where: { id } });
if (t.availableQuantity < quantity) throw new Error('Hết vé');
await tx.ticketType.update({ data: { availableQuantity: t.availableQuantity - quantity } });
```

Cả A và B cùng `findUnique` và cùng thấy `availableQuantity = 1`, cùng vượt qua `if`,
rồi cùng ghi `1 - 1 = 0`. Kết quả: **bán 2 vé trong khi chỉ có 1** (hoặc âm kho).
Đây gọi là **race condition**: kết quả phụ thuộc vào thứ tự thực thi mà ta không kiểm soát.

Điểm mấu chốt: khoảng thời gian giữa **đọc** và **ghi** là nơi kẻ khác chen vào.

### 4.2 Giải pháp — 3 lớp bảo vệ

#### Lớp 1 — Distributed Lock (Redlock)

`server/src/controllers/order.controller.ts:20-26`:

```ts
const lockKey = `locks:ticketType:${ticketTypeId}`;
const ttl = 5000; // giữ lock tối đa 5 giây
lock = await redlock.acquire([lockKey], ttl);
```

Ý tưởng: trước khi ai đó chạm vào tồn kho của một loại vé, họ phải giành được "chìa khoá" trên Redis. Chỉ **một** request giữ khoá tại một thời điểm, các request khác chờ. Khoá theo `ticketTypeId` để vé VIP và vé Standard không chặn nhau.

#### Lớp 2 — Compare-And-Swap (CAS) ở tầng Database

Đây mới là **chốt chặn thật**, nằm trong transaction.
`server/src/controllers/order.controller.ts:41-65`:

```ts
const reserved = await tx.ticketType.updateMany({
  where: { id: ticketTypeId, availableQuantity: { gte: quantity } },
  data: { availableQuantity: { decrement: quantity } },
});

if (reserved.count === 0) {
  const current = await tx.ticketType.findUnique({ ... });
  throw new AppError(`Rất tiếc, chỉ còn lại ${current.availableQuantity} vé!`);
}
```

Tại sao an toàn?

- Điều kiện "còn đủ vé" (`availableQuantity >= quantity`) được đưa **xuống thẳng câu UPDATE**, không tách thành bước đọc riêng.
- MySQL khoá row khi UPDATE. Request B bị block cho tới khi A commit, và **điều kiện WHERE được đánh giá lại** trên dữ liệu A vừa ghi.
- Nếu không còn đủ, `updateMany` trả `count = 0` → ném lỗi, không ghi gì cả.

`count === 0` nghĩa là "không đủ vé **tại thời điểm ghi**", chứ không phải tại thời điểm đọc. Đây là toàn bộ khác biệt giữa read-then-write và CAS.

> Tên gọi khác: **atomic conditional update**. Không cần `SELECT ... FOR UPDATE` thủ công, không cần đọc trước.

#### Lớp 3 — CHECK constraint ở MySQL

Mô tả ở mục 3. Kể cả hai lớp trên thất bại, DB vẫn không cho `availableQuantity` xuống âm.

### 4.3 Vì sao có lock mà vẫn cần CAS (và ngược lại)?

- **Lock là tối ưu, CAS là tính đúng đắn.** Lock giúp giảm tranh chấp (request vào hàng đợi ở Redis thay vì quay cuồng ở MySQL), nhưng lock có thể mất: key bị eviction do `maxmemory`, Redis failover làm mất write, TTL bị hết giữa transaction. Khi đó CAS vẫn cứu được.
- **CAS không thể bị "hết hạn giữa chừng"** như lock, vì nó là một câu lệnh gắn liền với transaction của DB.

### 4.4 Nhả lock sớm — chi tiết dễ làm sai

`server/src/controllers/order.controller.ts:106-110`:

```ts
// Nhả lock NGAY khi transaction đã commit.
await lock.release().catch(() => {});
lock = undefined;

// Vô hiệu cache KHÔNG cần lock vì nó không đọc/ghi tồn kho.
await invalidateEventCache(result.eventId);
```

Tại sao không giữ lock tới hết hàm? Vì `invalidateEventCache` chỉ gọi Redis (O(1)), giữ lock thêm chỉ làm dài hàng đợi của mọi người đang mua cùng loại vé. Lock bảo vệ vùng ghi tồn kho — hết vùng đó là nhả.

Còn `finally` (`order.controller.ts:138-143`) là chốt an toàn: nếu đi vào nhánh lỗi mà lock chưa nhả, nhả nốt.

### 4.5 Phân loại lỗi trả về (rất quan trọng để vận hành)

`order.controller.ts:116-137`:

| Tình huống | Status | Vì sao |
|-----------|--------|--------|
| Redlock không lấy được lock (`ExecutionError`) | **429** | Quá tải, client thử lại được |
| Hết vé / loại vé không tồn tại (`AppError`) | **400** | Lỗi thuộc về request, thử lại y nguyên là vô ích |
| Mọi lỗi còn lại (Prisma timeout, mất DB...) | **500** | Lỗi server |

Nếu gộp 500 vào 400 như code cũ, khi DB quá tải client sẽ được báo "request của bạn sai" → không thử lại, và monitoring đếm hụt lỗi server. **Phân loại sai làm chẩn đoán sai.**

### 4.6 Job nền trả vé — vì sao KHÔNG cần Redlock

`server/src/jobs/expireOrders.job.ts:22-90`:

```ts
const result = await prisma.$transaction(async (tx) => {
  // CAS: chỉ một worker đổi được PENDING -> EXPIRED
  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  if (claimed.count === 0) return null; // worker khác đã xử lý

  // ... cộng trả vé theo từng loại (đếm từ order.tickets)
});
```

Ba điểm học được:

1. **CAS ở đây thay cho lock**: job không đọc giá trị cũ để quyết định (khác `createOrder`), nó chỉ đổi trạng thái có điều kiện. MySQL khoá row, worker thua nhận `count = 0` và bỏ qua.
2. **Đổi trạng thái và trả vé phải cùng một transaction**: nếu tách rời mà bước cộng vé lỗi, ta có đơn `EXPIRED` nhưng vé biến mất vĩnh viễn (không còn `PENDING` để job bắt lần sau).
3. **Một đơn lỗi không làm chết cả lượt quét**: mỗi đơn bọc trong `try/catch` riêng.
4. Trả vé xong **phải xoá cache** (`job:85`), nếu không UI còn hiển thị số vé cũ tới 60 giây.

`startExpireOrdersJob` (`job:96-123`) quét ngay 1 lượt lúc khởi động (bắt các đơn hết hạn trong lúc server tắt) rồi lặp mỗi `ORDER_SWEEP_INTERVAL_MS` (mặc định 60s). `.unref()` để job không giữ process sống.

---

## 5. Bài Toán #2 — Chiến Lược Cache Redis

### 5.1 Ba vấn đề thường gặp của cache

| Vấn đề | Mô tả |
|--------|-------|
| **Cache stampede** (thundering herd) | Cache vừa hết hạn, hàng nghìn request cùng MISS và cùng lao vào DB |
| **Stale data** | Data đổi nhưng cache chưa cập nhật |
| **Redis downtime** | Redis chết kéo sập cả API dù cache chỉ là tối ưu |

Code xử lý cả ba trong `server/src/utils/cache.ts`.

### 5.2 Versioned key — thay `KEYS` bằng `INCR` (O(1))

Vô hiệu cache danh sách thường được làm bằng `KEYS events:list:*` rồi `DEL`. `KEYS` phải quét **toàn bộ keyspace** và **chặn Redis** (đơn luồng) suốt thời gian đó. Đo trên máy này với 50.000 key: `KEYS` mất **111 ms** (một lệnh bình thường ~0,1 ms), còn `INCR` mất **0,206 ms**.

Vì invalidation chạy **sau mỗi đơn đặt vé**, cách cũ biến mỗi đơn hàng thành một cú chặn 111 ms lên toàn bộ Redis.

Cách mới (`cache.ts:40-91`):

```ts
const LIST_VERSION_KEY = 'events:list:v';

export function listCacheKey(version, page, limit, search) {
  return `events:list:v${version}:page=${page}:limit=${limit}:search=${search}`;
}

export async function invalidateEventList() {
  try { await cacheClient.incr(LIST_VERSION_KEY); } // O(1)
  catch { /* entry cũ tự hết hạn theo TTL */ }
}
```

Khi cần vô hiệu chỉ **tăng một con số**. Mọi key cũ mang version cũ trở nên vô hình ngay lập tức, và tự hết hạn theo TTL 60s — không cần đi xoá cái nào.

- Đánh đổi: mỗi request đọc phải đọc thêm version (~0,1 ms) — vẫn rẻ hơn nhiều so với đọc DB (~40 ms).
- Lỗi Redis khi đọc version → dùng `VERSION_FALLBACK = '0'` (sẽ MISS, an toàn).

### 5.3 Single-flight — chống stampede

Khi cache MISS, nếu để mọi request cùng đọc DB thì stampede. `cacheGetOrLoad` (`cache.ts:151-208`) chỉ cho **một** request đi tính lại:

```ts
// 1. Thử giành lock bằng SET NX (chỉ người đầu tiên thành công)
const acquired = await cacheClient.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');

if (holdsLock) {
  // 2. Kiểm tra lại: có thể người khác đã điền cache trong lúc ta giành lock
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
// 4. Chờ hoài không có -> thà đọc DB còn hơn treo request
return { value: await loader(), source: 'database' };
```

Số liệu tại sao cần: với cache lạnh, **100 request đồng thời → 6/18/38 lượt đọc DB**; **500 request → 38/98/130 lượt**. Đúng ra chỉ cần 1. Và stampede tự khuếch đại: DB càng chậm, cửa sổ MISS càng rộng, càng nhiều request lọt vào — đúng lúc DB yếu nhất.

**Ví dụ đời thường:** chỉ **một** thực khách được vào bếp gọi món, 99 người còn lại ngồi chờ. Món ra, ai cũng nhận được.

Hai chi tiết tinh tế:

- **Phân biệt MISS với ERROR** (`cache.ts:101-116`). Nếu gộp chung, khi Redis chết mọi request sẽ thử giành lock rồi chờ nhau vô ích. Code xử lý: Redis lỗi → đi thẳng DB, **không giành lock, không chờ ai** (`cache.ts:163-165`).
- **Nhả lock an toàn** bằng Lua script (`cache.ts:60-65`): chỉ `DEL` nếu giá trị lock vẫn đúng token của mình. Nếu dùng `DEL` trần mà lệnh của ta chậm hơn TTL, lock đã thuộc người khác → ta xoá oan lock của họ, mở đường cho stampede.

### 5.4 Fail-open — Redis chết thì vẫn sống

`redis.ts:36-49`:

```ts
export const cacheClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  enableOfflineQueue: false, // Redis chết -> báo lỗi ngay, không xếp hàng chờ
  maxRetriesPerRequest: 1,   // không thử lại, thà đọc DB
  commandTimeout: 200,       // chặn trên mỗi lệnh (độ trễ thật ~0,1ms)
});
```

Với cấu hình mặc định (offline queue bật, retry 20 lần), khi Redis chết thì `GET /api/events` **treo 63,09 giây** rồi mới trả 500 — cache trở thành điểm chết duy nhất của hệ thống, đúng thứ nó sinh ra để tránh.

### 5.5 Vì sao có HAI Redis client?

`redis.ts:11-14` và `redis.ts:36-49`:

| | `redisClient` | `cacheClient` |
|---|---|---|
| Dùng cho | Redlock (lock) | Cache đọc |
| Tính cách | **Kiên nhẫn**: chờ & thử lại khi tải cao | **Fail-fast**: thất bại nhanh, không giữ request |
| Cấu hình | Mặc định ioredis | `enableOfflineQueue:false`, `maxRetriesPerRequest:1` |

Hai bên có yêu cầu **trái nhau**. Nếu dùng chung một client cấu hình fail-fast, Redlock sẽ không chờ nổi khi tải cao → không đặt được vé. Nếu dùng chung cấu hình kiên nhẫn, cache làm treo request khi Redis chết. Tách ra thì Redis chết **chỉ ảnh hưởng lock**, còn đọc dữ liệu vẫn chạy qua DB.

### 5.6 Không cache giá trị null

`cache.ts:186-189`: chỉ ghi cache khi `value !== null && value !== undefined`.

Nếu cache null, mọi request sau nhận "not found" **ngay cả khi data đã được tạo ra** — nhưng phải chờ hết TTL mới thấy. Muốn cache "không tìm thấy" thì cần sentinel riêng để phân biệt với MISS; hiện chưa cần.

### 5.7 Invalidate list vs detail

`cache.ts:220-252`:

- `invalidateEventList()` — chỉ `INCR` version.
- `invalidateEventDetails(ids)` — `DEL` key chi tiết (số lượng nhỏ, xoá trực tiếp rẻ).
- `invalidateEventCache(ids)` — làm **cả hai**, vì response danh sách **cũng chứa `ticketTypes`** (tức chứa luôn số vé còn lại), giống response chi tiết.

Event cache TTL = 60 giây (`cache.ts:17`).

---

## 6. Bài Toán #3 — Bảo Mật

### 6.1 JWT — không bao giờ có secret mặc định

`server/src/config/auth.ts:34-60`:

```ts
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('Thiếu biến môi trường JWT_SECRET...');
  if (FORBIDDEN_SECRETS.has(secret)) throw new Error('JWT_SECRET đang dùng giá trị mặc định cũ...');
  if (secret.length < 32) throw new Error(`JWT_SECRET quá ngắn...`);
  return secret;
}
```

**Lỗ hổng nếu có secret mặc định trong source:** ai đọc được source cũng ký được token hợp lệ cho **bất kỳ user nào**, kể cả `ADMIN`, rồi gọi endpoint quản trị để xoá/xáo dữ liệu. Vì vậy:

- `assertAuthConfig()` (`auth.ts:69-72`) gọi trong `app.ts:55` **trước `app.listen`** → server chết ngay nếu thiếu secret, thay vì khởi động rồi vỡ ở request đầu.
- `FORBIDDEN_SECRETS` chứa `supersecret_eventhub_key` — secret cũ từng nằm trong git. Đổi sang một secret mới nhưng trùng giá trị cũ thì lỗ hổng vẫn còn (vì nó công khai trong lịch sử git).
- Tối thiểu 32 ký tự: HMAC-SHA256 dùng khoá 256-bit = 32 byte.

### 6.2 Algorithm pinning — chống algorithm confusion

`auth.middleware.ts:20-28`:

```ts
const secret = getJwtSecret(); // lấy NGOÀI try: thiếu secret là lỗi SERVER, không phải "token sai"
try {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
  req.user = decoded;
  next();
} catch {
  return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn!' });
}
```

Nếu **bỏ trống `algorithms`**, thư viện tự suy thuật toán từ header client gửi lên. Kẻ tấn công gửi token với `alg: none` (không cần chữ ký) hoặc `alg: HS256` ký bằng public key (nếu hệ thống dùng RS256) → giả mạo thành công. Ghim `['HS256']` chặn hết.

Chi tiết tinh tế: `getJwtSecret()` đặt **ngoài `try`**. Nếu để trong `try`, lỗi thiếu secret của server sẽ bị `catch` biến thành 403 "token không hợp lệ" → ta đi chẩn đoán nhầm phía client.

### 6.3 Chống leo thang đặc quyền khi đăng ký

`auth.controller.ts:8-22`:

```ts
const SELF_REGISTER_ROLE = 'CUSTOMER';
// ...
const finalRole = SELF_REGISTER_ROLE; // bỏ qua role client gửi lên
```

Nếu tin tưởng `req.body.role`, kẻ tấn công chỉ cần gửi `{ role: 'ADMIN' }` là thành admin. Role ORGANIZER/ADMIN chỉ thay đổi qua kênh nội bộ.

Lưu ý: `registerSchema` (`validation.ts:15`) có khai báo `role: z.enum(['CUSTOMER','ORGANIZER']).optional()` nhưng controller **cố tình bỏ qua** giá trị đó — đây là lớp bảo vệ thứ hai. (Bản thân schema cũng đã chặn `ADMIN`.)

### 6.4 Mật khẩu

`auth.controller.ts:29`: `bcrypt.hash(password, 10)` — hash one-way với salt; `login` dùng `bcrypt.compare` (`auth.controller.ts:69`). Không bao giờ lưu plaintext. JWT sống 1 ngày, ký HS256 (`auth.controller.ts:74-81`).

### 6.5 Validation bằng Zod

`validation.ts:11-51` định nghĩa schema, `validateBody` (`validation.ts:58-70`) là middleware parse `req.body` và trả 400 kèm message nếu sai. Ví dụ:

```ts
export const createOrderSchema = z.object({
  ticketTypeId: z.string().uuid('ID loại vé không hợp lệ!'),
  quantity: z.number().int().min(1, 'Số lượng phải lớn hơn 0!'),
});
```

Lợi ích: chặn input rác/injection từ sớm, và message lỗi đã viết cho người dùng cuối. Route áp dụng: `order.routes.ts:10`, `event.routes.ts:13-14`, `auth.routes.ts:9-10`.

### 6.6 Rate limiting

`server/src/middlewares/rateLimit.middleware.ts`:

| Limiter | Cửa sổ | Max | Áp dụng | Mục đích |
|---------|--------|-----|---------|----------|
| `apiRateLimiter` | 60s | 100 | Toàn bộ `/api/` (`app.ts:27`) | Chống abuse/DDoS nhẹ |
| `orderRateLimiter` | 5 phút | 15 | `POST /orders` (`order.routes.ts:10`) | Cho phép burst nhưng chặn bot spam |

15 lần/5 phút vì người thật thường đặt 1–3 lần/sự kiện; đủ cho nhu cầu mua nhiều vé nhưng chặn bot.

> **Điểm chưa làm (nêu thẳng):** hiện **chưa có** limiter riêng cho `/auth/login` và `/auth/register`. Chúng chỉ được bảo vệ bởi `apiRateLimiter` chung (100/phút), nên brute-force mật khẩu vẫn có không gian. Đây là hạng mục nên bổ sung — ví dụ 5 lần/15 phút cho auth.

### 6.7 RBAC — phân quyền theo role

`auth.middleware.ts:32-44`:

```ts
export const authorize = (...roles: string[]) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Chưa được xác thực!' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Bạn không có quyền...' });
  next();
};
```

Áp dụng: `event.routes.ts:13-15` yêu cầu `ORGANIZER`/`ADMIN` cho tạo/sửa/xoá sự kiện. Ở tầng controller còn kiểm tra **quyền sở hữu**: chỉ organizer tạo ra event hoặc ADMIN mới sửa/xoá được event đó (`event.controller.ts:179-181`, `243-245`). Đây là điểm nhiều dự án bỏ sót — RBAC thô ("có role ORGANIZER") không đủ, phải kiểm tra "có phải chủ sở hữu".

### 6.8 Không rò rỉ chi tiết lỗi ra client

`utils/errors.ts`:

- `AppError` (`errors.ts:11-19`): message viết cho người dùng, an toàn để trả nguyên văn.
- `logUnexpectedError` (`errors.ts:27-32`): log đầy đủ `name`, `message`, `stack` ở server.
- `handleControllerError` (`errors.ts:43-59`): `AppError` → trả đúng status/message; mọi lỗi khác → log server, trả câu chung.

Mọi controller đi qua hàm này, nên không còn chỗ nào tự nối `error.message` (có thể chứa tên bảng, câu SQL, host, stack) vào response. Ngay cả `/api/health` (`app.ts:35-51`) cũng chỉ trả `"Database connection failed"` chung chung.

### 6.9 Vấn đề .env timing (bài học kinh điển)

`app.ts:8` và `auth.ts:10` đều có:

```ts
import 'dotenv/config';
```

Tại sao không dùng `dotenv.config()` ở thân module? Trong CommonJS, mọi `import` biến thành `require()` và chạy **TRƯỚC thân module**. Nếu `app.ts` gọi `dotenv.config()` trong thân nó, thì khi `config/redis.ts`, `config/order.ts`... được nạp, `.env` vẫn chưa được đọc → biến đều `undefined` và **âm thầm rơi vào giá trị mặc định**. `import 'dotenv/config'` là side-effect import, tự chạy `dotenv.config()` ngay khi bị require, nên nạp `.env` trước phần còn lại.

Tương tự, `getJwtSecret()` cố tình đọc `process.env` **tại thời điểm gọi** chứ không cache ở cấp module, để không phụ thuộc thứ tự nạp module.

---

## 7. Bài Toán #4 — Chống Double Booking Phía Client

### Tình huống
Mạng lag → user nhấn "Đặt vé", không thấy phản hồi → nhấn lần nữa → gửi 2 request đồng thời.

### Cách xử lý

**Frontend** — `client/src/views/EventDetailView.vue:76-121`:

```ts
const submittingId = ref<string | null>(null);

const handleBook = async (ticket: TicketType) => {
  if (!authStore.isAuthenticated) { router.push({ name: 'Login', query: { redirect: route.fullPath } }); return; }

  const quantity = quantities.value[ticket.id] ?? 1;
  if (quantity > ticket.availableQuantity) { errorMessage.value = `Chỉ còn ${ticket.availableQuantity} vé...`; return; }

  submittingId.value = ticket.id;  // nút bị disabled ngay
  try {
    await orderStore.createOrder(ticket.id, quantity);
    router.push({ name: 'MyOrders' });
  } catch (error) {
    // 401/403 -> logout + login lại; 400/429 -> hiện message tiếng Việt từ BE
  } finally {
    submittingId.value = null;      // mở lại nút
  }
};
```

Template disable nút theo 2 điều kiện (`EventDetailView.vue:292`):
`:disabled="ticket.availableQuantity <= 0 || submittingId === ticket.id"`.

Ngoài ra ô số lượng được chuẩn hoá khi blur (`normalizeQuantity`, dòng 68-74): xoá trắng → về 1; vượt tồn kho → kẹp về `availableQuantity`.

**Backend** (lớp thứ 2, vì client có thể bị bỏ qua): Redlock chặn request thứ hai; nếu lock mất, CAS ở DB vẫn bảo đảm không bán quá; rate limit là lớp thứ 3.

### Axios interceptor

`client/src/api/axios.ts`:
- Request (`:12-21`): tự gắn `Authorization: Bearer <token>` từ `localStorage`.
- Response (`:24-36`): gặp 401 → xoá token và chuyển về `/login`.

`router/index.ts:60-79`: guard `requiresAuth` (chưa đăng nhập → login kèm `redirect`), `guestOnly` (đã đăng nhập vào `/login` → về Home), `organizerOnly` (CUSTOMER → về Home).

> Lưu ý: frontend disable nút chỉ là **UX**. Kẻ tấn công bỏ qua UI và gọi API trực tiếp, nên đảm bảo thật nằm ở backend. Đây là lý do phải có đủ cả redlock + CAS + rate limit.

---

## 8. Test & Kết Quả

### 8.1 Load test đường ghi — `load-test.js` (100 VUs) / `load-test-concurrent.js` (200 VUs)

Kịch bản 200 VU cùng mua 1 loại vé chỉ có 10 vé. Điểm đáng học trong thiết kế test:

- **Tách `server_errors` (5xx) khỏi 4xx**. Hết vé (400) và lock bận (429) là kết quả **mong đợi**, không phải lỗi. Gộp chung sẽ làm chỉ số vô nghĩa.
- Có threshold `server_errors: ['rate==0']` — nếu BE trả 500 do Prisma timeout, test **FAIL thật sự**, không còn "xanh giả".
- Token truyền qua biến môi trường (`__ENV.TOKEN`), **không dán cứng** vào file vì đó là credential.

Kết quả tham chiếu (200 VUs, 10 vé): 10 đơn tạo thành công, `availableQuantity = 0`, **zero oversell**, zero 5xx, phần còn lại bị từ chối do hết vé/rate limit.

### 8.2 Load test đường đọc — `load-test-read.js`

Đo hiệu quả cache: `cache_hits`, `db_reads`, `cache_hit_rate`.

**Cách đo stampede đúng (quan trọng):** phải làm cache **lạnh** trước, nếu cache đang ấm thì mọi request đều hit và test không nói lên gì:

```bash
redis-cli --scan --pattern 'events:list:*' | xargs -r redis-cli del
k6 run load-test-read.js
k6 run -e VUS=500 -e BASE_URL=http://localhost:5055/api load-test-read.js
```

### 8.3 Oversell tests

- `oversell-natural.cjs`: để lock TTL (5000ms) **hết hạn tự nhiên** giữa transaction A, kiểm tra xem có oversell không. Không can thiệp gì.
- `oversell-repro.cjs`: **chủ động xoá lock Redis giữa transaction** (mô phỏng key bị eviction / Redis failover mất write / TTL bị chỉnh ngắn). Nếu sau đó DB vẫn bảo vệ được số vé → chứng minh có lưới an toàn ở tầng DB; nếu `availableQuantity = -1` → hệ thống phụ thuộc hoàn toàn vào Redis.

### 8.4 JWT security — `test-jwt-security.cjs`

Chạy `npm run test:security` (cần server đang chạy + `.env` có secret). Gồm 13 case:

**Phần A — cấu hình (chạy `getJwtSecret()` trong process con):**

| # | Case | Kỳ vọng |
|---|------|---------|
| 1 | Thiếu `JWT_SECRET` | ném lỗi |
| 2 | Là secret mặc định cũ đã lộ | ném lỗi |
| 3 | Quá ngắn (`abc123`) | ném lỗi |
| 4 | Mạnh (64 ký tự) | chấp nhận |

**Phần B — API từ chối token giả mạo:**

| # | Case | Kỳ vọng |
|---|------|---------|
| 5 | Không gửi `Authorization` | 401 |
| 6 | Header sai định dạng | 401 |
| 7 | Token ký bằng secret cũ đã lộ (role ADMIN) | 403 |
| 8 | Token ký bằng secret khác | 403 |
| 9 | Token `alg: none` | 403 |
| 10 | Token hết hạn (ký bằng secret đúng) | 403 |
| 11 | Sửa `role` trong payload, giữ chữ ký cũ | 403 |
| 12 | Token hợp lệ | **200** (chứng minh 403 trên là do chữ ký, không phải chặn hết) |
| 13 | CUSTOMER gọi endpoint ORGANIZER/ADMIN | 403 (phân quyền, message chứa "quyền") |

Chi tiết hay: `probeSecret` trỏ `DOTENV_CONFIG_PATH` vào file không tồn tại để `.env` không "hồi sinh" secret — nếu không, test luôn thấy secret hợp lệ và không kiểm tra được gì.

---

## 9. Các Vấn Đề Đã Gặp & Cách Xử Lý

| # | Vấn đề | Nguyên nhân gốc | Cách xử lý |
|---|--------|----------------|-----------|
| 1 | Env đọc ra `undefined` | Trong CommonJS, `import` chạy trước thân module, nên `dotenv.config()` trong thân chạy quá muộn | Side-effect `import 'dotenv/config'` ở đầu file; đọc env tại thời điểm gọi, không cache cấp module |
| 2 | Algorithm confusion | `jwt.verify` tự suy thuật toán từ header client | Ghim `{ algorithms: ['HS256'] }` |
| 3 | Cache stampede lúc cache lạnh | N request cùng MISS, cùng đập DB | Single-flight (SET NX + polling), kiểm tra lại cache sau khi giành lock |
| 4 | Redis chết treo request 63s | Cấu hình mặc định queue offline + retry 20 lần | `enableOfflineQueue:false`, `maxRetriesPerRequest:1`, `commandTimeout:200` |
| 5 | `KEYS` chặn Redis 111ms mỗi đơn | Quét toàn keyspace trên Redis đơn luồng | Versioned key + `INCR` (O(1)) |
| 6 | Double click khi mạng lag | Không disable nút ngay | `submittingId` disable nút + backend redlock/CAS/rate limit |
| 7 | Lỗi DB bị báo thành lỗi client | Gộp 5xx vào 400 | Phân loại `AppError`→400, `ExecutionError`→429, còn lại→500, log đầy đủ |
| 8 | UI "nháy" báo không có dữ liệu | Lần render đầu `events=[]` trước khi `onMounted` chạy xong | Cờ `loaded` phân biệt "chưa gọi API" với "gọi xong, rỗng" (`HomeView.vue:18-21`, `MyOrdersView.vue:16-18`) |
| 9 | Search bắn API mỗi ký tự | Không debounce | Debounce 400ms (`HomeView.vue:47-55`) |
| 10 | Open redirect sau khi login | Nhận thẳng `?redirect=` từ URL | Chỉ nhận path nội bộ, chặn `//evil.com` (`LoginView.vue:12-17`) |
| 11 | Token hỏng vẫn "đăng nhập ma" sau F5 | `token` ở localStorage sống dai, `user` chỉ ở RAM | `main.ts:19-22` gọi lại `/auth/me`; lỗi thì `logout()` |
| 12 | Edit event làm mất/oversell kho đã bán | `deleteMany` rồi tạo lại toàn bộ ticketType | Reconcile theo `id` + transaction + `increment delta`; FE gửi kèm id — xem mục 15.1 |
| 13 | FE bỏ `id` khi submit edit | Map ticketTypes chỉ lấy `name/price/totalQuantity` | Giữ `id` trong `TicketTypeForm` và payload (`EventFormView.vue`) |

---

## 10. Câu Hỏi Phỏng Vấn & Trả Lời

**1. Tại sao có 2 Redis client?**
Hai bên yêu cầu trái nhau. `redisClient` cho Redlock cần kiên nhẫn (chờ/thử lại khi tải cao). `cacheClient` cho cache cần fail-fast (không giữ request của user). Tách ra thì Redis chết chỉ ảnh hưởng lock, đọc dữ liệu vẫn chạy qua DB.

**2. Làm sao tránh cache stampede?**
Single-flight: khi MISS chỉ một request giành được lock Redis (SET NX) và đi tính lại; các request khác polling chờ cache được điền thay vì cùng đập DB. Có kiểm tra lại cache sau khi giành lock, và fallback đọc DB nếu chờ quá lâu.

**3. Tại sao không dùng `SELECT ... FOR UPDATE`?**
Nó giữ row lock suốt transaction; hàng trăm request cùng một `ticket_type` sẽ xếp hàng dài và timeout. Redis xử lý lock ở bộ nhớ (micro giây) và giảm tải cho MySQL. Tuy vậy tầng DB vẫn có CAS + CHECK constraint làm lưới an toàn.

**4. Tại sao Redlock thay vì SETNX đơn giản?**
Redlock có retry + backoff, tự gia hạn lock nếu TTL sắp hết (automatic renewal), và release an toàn bằng Lua script để không xoá nhầm lock của người khác.

**5. Tại sao không cache null/missing?**
Vì sẽ "cache poisoned": data thật sự chưa tồn tại bị ghi nhớ là không tồn tại, mọi request sau nhận "not found" ngay cả khi data đã được tạo, cho tới khi hết TTL. Muốn cache missing phải dùng sentinel riêng để phân biệt với MISS.

**6. Tại sao 15 lần / 5 phút cho order?**
Người thật đặt 1–3 lần/sự kiện; 15 lần cho phép burst (mua cho nhiều người) nhưng chặn bot spam. Đây là con số cân bằng giữa trải nghiệm và chống lạm dụng.

**7. Điều gì xảy ra nếu lock mất giữa transaction?**
CAS ở DB vẫn bảo vệ: request thứ hai khi được chạy sẽ đánh giá lại `WHERE availableQuantity >= quantity` trên dữ liệu đã commit, thấy không đủ thì `count = 0`. Kể cả CAS bị vượt, CHECK constraint chặn số âm.

**8. Tại sao job hết hạn không cần Redlock?**
Vì nó không "đọc rồi ghi" — nó dùng `updateMany` có điều kiện `status='PENDING'` như một phép CAS; MySQL khoá row, chỉ một worker thắng. CAS mạnh hơn lock vì không thể "hết hạn giữa chừng".

---

## 11. Hướng Phát Triển Tiếp

**Production ready:** Dockerfile + docker-compose; secret management thay `.env`; structured logging (Winston/Pino); `/ready` + `/live` endpoints.

**Observability:** Prometheus metrics; OpenTelemetry tracing; alerting theo ngưỡng; Grafana dashboard.

**Scale:** queue-based booking thay vì real-time; event-driven (Kafka/RabbitMQ) cho order processing; tách microservices (auth/event/order); CDN cho static asset.

**Bảo mật còn thiếu:** rate limiter riêng cho `/auth/*`; refresh token; HTTPS/HSTS; thêm `helmet` cho secure headers.

**Tính năng:** tích hợp VNPay/MoMo; email/SMS xác nhận & nhắc hết hạn; WebSocket cập nhật tồn kho real-time; admin dashboard.

---

## 12. Quick Start

**Yêu cầu:** Node.js 22+, MySQL 8+, Redis 7+.

```bash
# 1. Server
cd server
npm install
cp .env.example .env      # sửa DATABASE_URL, JWT_SECRET, Redis nếu khác mặc định
npx prisma migrate dev    # chạy cả migration CHECK constraint
npm run dev               # http://localhost:5000

# 2. Client (terminal khác)
cd client
npm install
npm run dev               # Vite dev server

# 3. Test
cd server
npm run test:security                      # bộ test JWT
npx k6 run load-test.js                    # 100 VUs đường ghi
npx k6 run load-test-concurrent.js         # 200 VUs, 10 vé
npx k6 run load-test-read.js               # cache hit/miss (nhớ xoá cache trước)
node oversell-natural.cjs                  # lock hết hạn tự nhiên
node oversell-repro.cjs                    # mô phỏng mất lock
```

### Biến môi trường

```env
DATABASE_URL="mysql://user:password@localhost:3306/eventhub_db"
PORT=5000
JWT_SECRET="<64 ký tự hex>"                       # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"
ORDER_HOLD_MINUTES=10                              # giữ chỗ bao nhiêu phút
ORDER_SWEEP_INTERVAL_MS=60000                      # job quét mỗi bao lâu
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"  # origin frontend được phép
NODE_ENV=development                               # production -> Prisma chỉ log warn/error
```

---

## 13. Từ Điển Thuật Ngữ

| Thuật ngữ | Nghĩa ngắn |
|-----------|-----------|
| **Race condition** | Kết quả phụ thuộc thứ tự thực thi không kiểm soát; ở đây: cùng đọc rồi cùng trừ kho |
| **Read-then-write** | Đọc giá trị, quyết định, rồi ghi — có khe hở cho kẻ khác chen vào |
| **CAS** (Compare-And-Swap) | Ghi có điều kiện: chỉ ghi nếu giá trị hiện tại thỏa điều kiện, thực hiện atomic trong 1 câu lệnh |
| **Distributed lock** | Khoá dùng chung giữa nhiều process/instance (qua Redis) |
| **Redlock** | Thuật toán distributed lock trên (nhiều) node Redis, có retry/renew/release an toàn |
| **Oversell** | Bán quá số vé có thật |
| **Cache stampede** | Nhiều request cùng MISS và cùng đập vào DB khi cache vừa hết hạn |
| **Single-flight** | Chỉ một request đi tính/lấy dữ liệu, các request khác dùng chung kết quả |
| **Fail-open** | Khi thành phần phụ (cache) chết, hệ thống vẫn phục vụ (đọc DB) thay vì sập |
| **Fail-fast** | Cấu hình sai thì dừng ngay lúc khởi động, thay vì lỗi mơ hồ về sau |
| **Algorithm confusion** | Lợi dụng việc thư viện tự suy thuật toán JWT từ header để giả mạo token |
| **Idempotent** | Gọi nhiều lần cho cùng kết quả (rate limit / CAS giúp nhiều thao tác an toàn hơn) |

---

## 14. File Quan Trọng Nhất

| File | Vì sao nên đọc |
|------|----------------|
| `server/src/controllers/order.controller.ts` | Logic đặt vé: redlock + CAS + phân loại lỗi |
| `server/src/utils/cache.ts` | Versioned key, single-flight, fail-open, release lock bằng Lua |
| `server/src/config/redis.ts` | Vì sao 2 client, cấu hình fail-fast |
| `server/src/jobs/expireOrders.job.ts` | CAS + transaction + cache invalidation ở job nền |
| `server/src/config/auth.ts` | Fail-fast JWT secret, chống algorithm confusion (gián tiếp) |
| `server/src/middlewares/auth.middleware.ts` | Verify + authorize |
| `server/src/utils/errors.ts` | AppError vs lỗi nội bộ, không rò rỉ chi tiết |
| `server/src/utils/validation.ts` | Zod schema + middleware |
| `server/prisma/migrations/*add_check*/migration.sql` | Lưới an toàn cuối cùng ở DB |
| `client/src/views/EventDetailView.vue` | Chống double-click + phối hợp thông báo lỗi |
| `client/src/api/axios.ts` | Interceptor token/401 |
| `server/test-jwt-security.cjs` | 13 case bảo mật, cách test token giả |

---

## 15. Case Bổ Sung — Vòng Đời Đơn Hàng & CRUD Sự Kiện

Phần này gom những case **không nằm trong 4 bài toán chính** nhưng rất đáng học, kể cả các lỗ hổng/gap còn tồn tại.

### 15.1 Sửa sự kiện — bài học từ bug reset/oversell kho (đã sửa)

**Code cũ** (`deleteMany` rồi tạo lại toàn bộ `TicketType`) có 3 hệ quả:

1. **Lỗi khoá ngoại**: `Ticket` tham chiếu `TicketType` với `ON DELETE RESTRICT` (migration `tickets_ticketTypeId_fkey`). Đã có vé bán → `deleteMany` vi phạm FK → `P2003` → **500**.
2. **Nếu xoá được**: `availableQuantity` bị đặt lại bằng `totalQuantity`, **bỏ qua vé đã bán** → oversell. 10 vé, bán 7 (còn 3), sửa tên vé → còn 10 → bán thêm 10 = 17.
3. **Đổi ID loại vé**: vé cũ trỏ tới `ticketTypeId` không còn tồn tại.

**Cách sửa (đang chạy)** — `event.controller.ts:159-351` + `EventFormView.vue`: reconcile theo **ID**, không theo index.

- `ticketTypes: undefined` (client không gửi) = **không đụng** loại vé; `[]` = xoá hết loại chưa bán. Phân biệt hai ý này để sửa mỗi tiêu đề không xoá oan.
- Phân 3 nhóm: `updates` (có id thuộc event này), `creates` (không id), `deletes` (id cũ không còn trong input **và chưa bán**).
- ID không thuộc event → 400 (`Loại vé không thuộc sự kiện này!`) — chặn sửa chéo event.
- `totalQuantity < sold` → 400 (không giảm dưới số đã bán); xoá loại đã bán → 400.
- Ghi trong **một transaction**, cập nhật kho bằng `availableQuantity: { increment: delta }` (delta = newTotal − oldTotal) thay vì gán tuyệt đối. Nếu có người mua chen giữa đọc và ghi, phép cộng vẫn đúng `available = total − sold`; gán tuyệt đối sẽ ghi đè mất lượt mua.
- CAS phụ: `where: { id, eventId, totalQuantity: oldTotal, ...(delta<0 ? { availableQuantity: { gte: -delta } } : {}) }`. `count === 0` → có thao tác khác chen vào → 400, không ghi mù.
- `deleteEvent` cũng bắt `P2003` → 400 (`Không thể xóa sự kiện vì đã có vé được bán!`).

> Bài học: frontend **phải gửi kèm `ticketType.id`** lên khi edit (`EventFormView.vue:53-58,112-117`). Thiếu id thì backend tưởng là loại vé mới → tạo trùng. Zod (`validation.ts:38`) chỉ kiểm tra `totalQuantity >= 1`, **không đủ** cho ràng buộc nghiệp vụ xuyên bảng — phần cross-check phải nằm ở controller.

### 15.2 Đơn `CONFIRMED` / `CANCELLED` là trạng thái "chết" ⚠️

`schema.prisma:16-21` định nghĩa 4 trạng thái `PENDING | CONFIRMED | CANCELLED | EXPIRED`, và UI `MyOrdersView.vue:44-49` có nhãn cho cả 4. Nhưng grep toàn bộ `server/src` cho thấy:

- **Chỉ** `PENDING` được set khi tạo đơn (`order.controller.ts:82`).
- **Chỉ** `EXPIRED` được set bởi job nền (`expireOrders.job.ts:42`).
- **Không có chỗ nào** set `CONFIRMED` hay `CANCELLED`.

Hệ quả: **không có endpoint thanh toán/xác nhận**, nên mọi đơn rồi cũng sẽ hết hạn sau 10 phút. Nhãn "Đã xác nhận"/"Đã huỷ" trong UI hiện không bao giờ xuất hiện. Tương tự, `Ticket.qrCode` (`schema.prisma:90`) **chưa bao giờ được sinh** — luôn `NULL`.

Đây là điều nên nói rõ khi review: đây là bản demo luồng giữ chỗ, chưa có payment. Khi bổ sung thanh toán cần: endpoint `POST /orders/:id/confirm` (đổi PENDING→CONFIRMED trong transaction), endpoint huỷ, và sinh `qrCode` khi confirm.

### 15.3 Case frontend đáng học

| Case | File | Điểm học |
|------|------|----------|
| Phân biệt "chưa tải" vs "rỗng" | `HomeView.vue:18-21`, `MyOrdersView.vue:18` | Dùng cờ `loaded`; nếu chỉ dựa vào `events.length === 0`, lần render đầu (trước `onMounted`) sẽ nháy "Không tìm thấy sự kiện" |
| Debounce tìm kiếm | `HomeView.vue:61-69` | Đợi user gõ xong 400ms mới gọi API, tránh bắn request mỗi ký tự; reset về trang 1 |
| Chống race khi search/đổi trang | `HomeView.vue:23-59,83-88`, `event.ts:72-87` | Gõ nhanh "a" rồi "ab": response của "a" có thể về **sau** và ghi đè kết quả "ab". Dùng `AbortController` huỷ request cũ; bỏ qua lỗi `ERR_CANCELED`. `onUnmounted` clear timer + abort để không có request "mồ côi" |
| Chống race khi đổi route chi tiết | `EventDetailView.vue:29-66,73-76` | `/events/a` → `/events/b` tái dùng component; abort request cũ trước khi load mới |
| Loading đúng khi có request bị huỷ | `event.ts:59-70` | Bật/tắt `loading` theo từng request sẽ tắt sớm khi request cũ bị abort; dùng **đếm `activeRequests`**, chỉ tắt khi về 0 |
| Chống open-redirect | `LoginView.vue:11-22` | Chỉ nhận `redirect` bắt đầu bằng `/`, **không** bắt đầu bằng `//`, và **không chứa `\`** (trình duyệt có thể hiểu `/\evil.com` như `//evil.com`) |
| Refresh vẫn đúng trạng thái | `main.ts:19-22`, `auth.ts:36-45` | `token` nằm ở localStorage sống qua F5, còn `user` chỉ trong RAM → gọi lại `/auth/me`, lỗi thì dọn state tránh "đăng nhập ma" |
| Xử lý 403 tay ở view | `MyOrdersView.vue:27-33` | Axios interceptor chỉ logout khi **401**; BE trả **403** cho token hỏng, nên view phải tự bắt cả 401 lẫn 403 |
| Decimal serialize thành chuỗi | `format.ts:1-6`, `event.ts:16-19` | Prisma `Decimal` → JSON là **string** (`"150000"`), phải `Number()` trước khi tính/format |

### 15.4 Ba điểm không nhất quán — đã tối ưu

- **Gom hết về axios (`apiClient`)**. Trước đây `EventFormView.vue` và `EventDetailView.vue` gọi thẳng `fetch(...)` kèm `authStore.token`, nên lặp logic auth ở 3 nơi và **không** được hưởng interceptor. Nay cả hai dùng `apiClient.put/post/delete`, nhận lại:
  - tự gắn `Authorization: Bearer ...` (`api/axios.ts:12-21`);
  - tự logout + redirect khi 401 (`api/axios.ts:24-36`);
  - message lỗi lấy từ `error.response.data.message`.
  Client giờ **không còn lời gọi `fetch` trần** nào.
- **Prisma chỉ log query ngoài production**. `utils/prisma.ts` đọc `NODE_ENV`: production chỉ `['warn','error']`, ngược lại `['query','info','warn','error']`. Tránh ồn và tránh lộ dữ liệu truy vấn vào log.
- **CORS whitelist**. `app.ts` thay `cors()` (mọi origin) bằng whitelist đọc từ `CORS_ORIGINS` (mặc định `http://localhost:5173,http://127.0.0.1:5173`). Request không có `Origin` (curl, k6, server-to-server) vẫn qua; origin lạ bị bỏ header CORS để trình duyệt chặn (không ném lỗi, tránh 500 gây nhiễu log). Đã bổ sung biến vào `.env.example`.

---

## 16. Khoảng Trống Đã Biết (Known Gaps) — Tổng Hợp

| # | Gap | Mức độ | Ghi chú |
|---|-----|--------|---------|
| 1 | Update event reset kho đã bán / lỗi FK | ✅ Đã sửa | Mục 15.1 — reconcile theo id + transaction + atomic inventory |
| 1b | Delete event đã bán vé vẫn lỗi FK | ✅ Đã sửa | Bắt `P2003` → 400 (`event.controller.ts`) |
| 2 | Không có thanh toán → `CONFIRMED`/`CANCELLED`/`qrCode` không dùng | Trung bình | Mục 15.2 |
| 3 | Không có rate limit riêng cho `/auth/login`, `/auth/register` | **Cao** | Brute-force mật khẩu; mục 6.6 |
| 4 | CORS mở mọi origin | ✅ Đã sửa | Whitelist qua `CORS_ORIGINS`; mục 15.4 |
| 5 | Frontend bypass axios ở 3 chỗ | ✅ Đã sửa | Gom về `apiClient`; mục 15.4 |
| 6 | Prisma log query mọi môi trường | ✅ Đã sửa | Chỉ log `query/info` ngoài production; mục 15.4 |
| 7 | Không có refresh token (JWT 1 ngày, hết là đăng nhập lại) | Thấp | Chấp nhận được cho demo |
| 8 | `registerSchema` cho phép gửi `role: ORGANIZER` rồi controller bỏ qua | Thấp | Không phải lỗ hổng, nhưng gây hiểu nhầm; nên bỏ field khỏi schema |
| 9 | Không validate `endTime > startTime` | Thấp | `createEventSchema` chỉ kiểm tra parse được ngày |
| 10 | Không có test tự động (unit/integration), chỉ có script thủ công | Trung bình | `test-jwt-security.cjs` + k6 là script rời, không chạy trong CI |

### Câu hỏi phỏng vấn bổ sung

**9. Chuyện gì xảy ra nếu organizer sửa sự kiện đã bán vé?**
Code cũ `deleteMany` rồi tạo lại `TicketType` nên hoặc lỗi FK (`Ticket` giữ `Restrict`), hoặc reset `availableQuantity = totalQuantity` → oversell. Bản hiện tại reconcile theo `id`: update tại chỗ giữ số đã bán, chỉ xoá loại chưa bán, chặn giảm `totalQuantity` dưới số đã bán, và ghi kho bằng `increment delta` trong transaction (chống race với luồng mua).

**10. Vì sao đơn không bao giờ ở trạng thái `CONFIRMED`?**
Vì chưa có endpoint thanh toán/xác nhận — chỉ có job chuyển `PENDING → EXPIRED`. `CONFIRMED`/`CANCELLED` mới chỉ là enum dự trù. Đây là giới hạn phạm vi của demo, không phải bug logic lock/CAS.

**11. Vì sao phải có cờ `loaded` ở frontend?**
Vì `onMounted` chạy **sau** lần render đầu. Nếu chỉ kiểm tra `events.length === 0`, lần render đầu sẽ hiện "Không có sự kiện" trong tích tắc dù đang tải. Cờ `loaded` phân biệt "chưa gọi API" với "gọi xong và rỗng".

**12. Vì sao axios interceptor chỉ logout khi 401 mà view còn bắt 403?**
Vì backend phân biệt: **401** = thiếu/sai định dạng token, **403** = token không hợp lệ/hết hạn/hết quyền (`auth.middleware.ts:9-27`). Interceptor chỉ xử lý 401, nên các view cần tự dọn state khi gặp 403 để tránh trạng thái đăng nhập sai.

---

*Tài liệu học tập — cập nhật 21/09/2026. Khi code thay đổi, hãy cập nhật lại số dòng và số liệu tương ứng.*
