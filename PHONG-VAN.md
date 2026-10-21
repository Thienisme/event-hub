# Phong Van - EventHub

Ban dich san: "Day la he thong ban ve su kien. Bai toan kho khong nam o CRUD, ma nam o tranh chap ton kho khi hang nghin nguoi cung mua chiec ve cuoi."

## 1. Bai toan dat ra

Mot he thong ban ve co:
- ORGANIZER/ADMIN tao su kien, nhieu loai ve, moi loai co so luong gioi han
- CUSTOMER dat ve, don o trang thai PENDING giu cho 10 phut
- Job nen chuyen PENDING -> EXPIRED va tra ve ve kho

Diem kho: **tranh chap ton kho**. Mot chiec ve cuoi, hang nghin request den cung luc.

## 2. Thu tu hoc (khong nen hoc het mot luc)

| # | Chu de | File | De | Uu tien |
|---|--------|------|----|--------|
| 1 | Race condition + 3 lop bao ve | `server/src/controllers/order.controller.ts` | 2 ngay | **Cao nhat** |
| 2 | Cache Redis: stampede, versioned key, fail-open | `server/src/utils/cache.ts` | 3 ngay | **Cao nhat** |
| 3 | JWT + RBAC + rate limit | `server/src/middlewares/auth.middleware.ts`, `config/auth.ts` | 2 ngay | Cao |
| 4 | Job nen tra ve (CAS khong can lock) | `server/src/jobs/expireOrders.job.ts` | 1 ngay | Cao |
| 5 | Race hanh tri (FOR UPDATE) | `server/src/controllers/admin.controller.ts` | 1 ngay | Trung binh |
| 6 | Loai loi 400/409/429/500 | `server/src/utils/errors.ts` | 1 ngay | Trung binh |
| 7 | Double booking phia client | `client/src/views/EventDetailView.vue` | 0.5 ngay | Trung binh |
| 8 | Tu doi su kien + quy doi ton kho | `server/src/controllers/event.controller.ts` | 1 ngay | Trung binh |

> **Muc tieu cua buoi PV: 80% thoi gian nam o chu de 1-4.** Cau hoi ve Vue/Tailwind/Prisma la cau hoi "biết dùng", tra loi nhanh roi quay ve bai toan chinh.

---

## 3. Chu de 1 - Chong oversell (PHONG VAN HAY HOI NHAT)

### 3.1 Van de

`server/src/controllers/order.controller.ts:42-49` - code **SAI** truoc day:

```ts
// READ-THEN-WRITE - co lo hong
const t = await tx.ticketType.findUnique({ where: { id } });
if (t.availableQuantity < quantity) throw new Error('Het ve');
await tx.ticketType.update({ data: { availableQuantity: t.availableQuantity - quantity } });
```

Hai request A va B cung `findUnique` -> cung thay `availableQuantity = 1` -> cung vuot qua `if` -> cung ghi `1 - 1 = 0`. Ket qua: **ban 2 ve khi chi co 1**.

Dien giai hay: khoang thoi gian giua **doc** va **ghi** la noi ke khac chen vao. `if` kiem tra mot gia tri da cu, khong phai dieu kien cua hanh dong.

### 3.2 Giai phap - 3 lop bao ve

**Lop 1 - Distributed Lock (Redlock)** - `order.controller.ts:21-27`

```ts
const lockKey = `locks:ticketType:${ticketTypeId}`;
const ttl = 5000;
lock = await redlock.acquire([lockKey], ttl);
```

Khoa theo `ticketTypeId` de ve VIP va ve Standard khong chan nhau.

**Lop 2 - Compare-And-Swap o tang DB (CHOT CHAN THAT)** - `order.controller.ts:42-53`

```ts
const reserved = await tx.ticketType.updateMany({
  where: { id: ticketTypeId, availableQuantity: { gte: quantity } },
  data: { availableQuantity: { decrement: quantity } },
});
if (reserved.count === 0) { /* het ve -> nem loi */ }
```

Dieu kien "con du ve" duoc dua **thang xuong cau UPDATE**, khong tach thanh buoc doc rieng. MySQL khoa row khi UPDATE: request B bi block cho toi khi A commit, va **dieu kien WHERE duoc danh gia lai** tren du lieu A vua ghi.

`count === 0` nghia la "khong du ve **tai thoi diem ghi**", chu khong phai tai thoi diem doc. **Day la toan bo khac biet giua read-then-write va CAS.**

**Lop 3 - CHECK constraint o MySQL** - `server/prisma/migrations/20260918100000_add_check_available_quantity_non_negative/migration.sql`

```sql
ALTER TABLE `ticket_types`
  ADD CONSTRAINT `ticket_types_availableQuantity_non_negative`
  CHECK (`availableQuantity` >= 0);
```

Prisma **khong dien dat duoc** CHECK constraint, nen no nam trong migration viet tay.

### 3.3 Cau hoi PV + cach tra loi

**"Vi sao co lock roi ma van can CAS?"**
> Lock la **toi uu**, CAS la **tinh dung dan**. Lock co the mat: key bi eviction do `maxmemory`, Redis failover lam mat write, TTL het giua transaction. Khi do CAS van cuu duoc. Nguoc lai, CAS khong the bi "het han giua chung" nhu lock, vi no la mot cau lenh gan lien voi transaction cua DB.

**"Tai sao khong dung `SELECT ... FOR UPDATE`?"**
> No giu row lock suot transaction; hang tram request cung mot `ticket_type` se xep hang dai va timeout. Redis xu ly lock o bo nho (micro giay) va giam tai cho MySQL. Tuy vay tang DB van co CAS + CHECK constraint lam luoi an toan.

**"Neu lock mat giua transaction thi sao?"**
> CAS van bao ve: request thu hai khi duoc chay se danh gia lai `WHERE availableQuantity >= quantity` tren du lieu da commit, thay khong du thi `count = 0`. Ke ca CAS bi vuot, CHECK constraint chan so am.

**"Tai sao job het han khong can Redlock?"** - `server/src/jobs/expireOrders.job.ts:40-43`
> No khong "doc roi ghi" - no dung `updateMany` co dieu kien `status='PENDING'` nhu mot phep CAS; MySQL khoa row, chi MOT worker thang. CAS manh hon lock vi khong the "het han giua chung".

### 3.4 So lieu phai nho

| So lieu | Nghia la |
|--------|---------|
| TTL lock = **5000ms** | `order.controller.ts:22` |
| `count === 0` | khong du ve tai thoi diem ghi |
| 200 VU, 10 ve | 10 don thanh cong, `availableQuantity = 0`, **zero oversell**, zero 5xx |

### 3.5 Câu hoi BAM - dung tra loi sai

| Bai | Sai | Dung |
|-----|-----|------|
| "Lock da duoc dung race roi" | "Dung, lock la du" | Lock co the mat, CAS moi la chot chan that |
| "Co `if` kiem tra so ve nen an toan" | "Dung" | `if` kiem tragia tri **da cu**, khong phai dieu kien cua hanh dong |
| "Dung `SELECT ... FOR UPDATE` de an toan hon" | "Dung" | Giu row lock lau, xep hang dai; Redis + CAS tot hon |
| "Transaction da lo duoc race roi" | "Dung" | Isolation level mac dinh khong chan **write skew** tren read-then-write |

---

## 4. Chu de 2 - Cache Redis

### 4.1 Ba van de thuong gap

| Van de | Mo ta |
|--------|-------|
| **Cache stampede** (thundering herd) | Cache vua het han, hang nghin request cung MISS va cung lao vao DB |
| **Stale data** | Data doi nhung cache chua cap nhat |
| **Redis downtime** | Redis chet keo sap ca API du cache chi la toi uu |

Tat ca deu xu ly trong `server/src/utils/cache.ts`.

### 4.2 Versioned key - thay `KEYS` bang `INCR` (O(1))

Vohieu cache danh sach thuong duoc lam bang `KEYS events:list:*` roi `DEL`. `KEYS` phai quet **toan bo keyspace** va **chan Redis** (don luong) suot thoi gian do.

**Do duoc tren may nay voi 50.000 key:**
- `KEYS`: **111 ms** (mot lenh binh thuong ~0,1 ms)
- `INCR`: **0,206 ms**

Vi invalidation chay **sau moi don dat ve**, cach cu bien moi don hang thanh mot cu chan 111 ms len toan bo Redis.

`server/src/utils/cache.ts:40, 71-78, 220-224`:

```ts
const LIST_VERSION_KEY = 'events:list:v';

export function listCacheKey(version, page, limit, search) {
  return `events:list:v${version}:page=${page}:limit=${limit}:search=${search}`;
}

export async function invalidateEventList() {
  try { await cacheClient.incr(LIST_VERSION_KEY); }  // O(1)
  catch { /* entry cu tu het han theo TTL */ }
}
```

Khi can vohieu chi **tang mot con so**. Moi key cu mang version cu tro nen **vo hinh ngay lap tuc**, va tu het han theo TTL 60s - khong can di xoa cai nao.

- Danh doi: moi request doc phai doc them version (~0,1 ms) - van re hon nhieu so voi doc DB (~40 ms).
- Loi Redis khi doc version -> dung `VERSION_FALLBACK = '0'` (se MISS, an toan).

### 4.3 Single-flight - chong stampede

Khi cache MISS, de moi request cung doc DB thi stampede. `cacheGetOrLoad` (`cache.ts:151-208`) chi cho **mot** request di tinh lai:

```ts
// 1. Thu gianh lock bang SET NX (chi nguoi dau tien thanh cong)
const acquired = await cacheClient.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');

if (holdsLock) {
  // 2. Kiem tra lai: co the nguoi khac da dien cache trong luc ta gianh lock
  const second = await readCache(key);
  if (second.state === 'hit') return { value: second.value, source: 'cache' };

  const value = await loader();
  if (value !== null && value !== undefined) await writeCache(key, value); // khong cache null
  return { value, source: 'database' };
}

// 3. Nguoi thua cho (polling) cho toi khi cache duoc dien
for (let round = 0; round < WAIT_ROUNDS; round++) {
  await sleep(WAIT_STEP_MS);
  const retry = await readCache(key);
  if (retry.state === 'hit') return { value: retry.value, source: 'cache' };
}
// 4. Cho vo hieu -> thay doc DB con hon treo request
return { value: await loader(), source: 'database' };
```

**So lieu tai sao can** (cache lanh):
- 100 request dong thoi -> **6/18/38 luot doc DB**
- 500 request -> **38/98/130 luot**

Dung ra chi can 1. Va stampede tu khuech dai: DB cang cham, cua so MISS cang rong, cang nhieu request lot vao - **dung luc DB yeu nhat**.

> **Vi du doi thuong:** chi **mot** thuc khach duoc vao bep goi mon, 99 nguoi con lai ngoi cho. Mon ra, ai cung nhan duoc.

**Hai chi tiet tinh te:**
- **Phan biet MISS voi ERROR** (`cache.ts:101-116`). Neu gop chung, khi Redis chet moi request se thu gianh lock roi cho nhau vo ich. Redis loi -> di thang DB, **khong gianh lock, khong cho ai**.
- **Nha lock an toan bang Lua script** (`cache.ts:57-65, 128`). Chi `DEL` neu gia tri lock van dung token cua minh. Neu dung `DEL` tran ma lenh cua ta cham hon TTL, lock da thuoc nguoi khac -> ta xoa oan lock cua ho, mo duong cho stampede.

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
```

### 4.4 Fail-open - Redis chet thi van song

`server/src/config/redis.ts:36-49`:

```ts
export const cacheClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  enableOfflineQueue: false,  // Redis chet -> bao loi ngay, khong xep hang cho
  maxRetriesPerRequest: 1,    // khong thu lai, thanh doc DB
  commandTimeout: 200,        // chan tren moi lenh (do tre thuc ~0,1ms)
});
```

**Voi cau hinh mac dinh** (offline queue bat, retry 20 lan), khi Redis chet thi `GET /api/events` **treo 63,09 giay** roi moi tra 500 - cache tro thanh diem chet duy nhat cua he thong, dung thu no sinh ra de tranh.

### 4.5 Vi sao co HAI Redis client?

`server/src/config/redis.ts:11` va `:36`

| | `redisClient` | `cacheClient` |
|---|---|---|
| Dung cho | Redlock (lock) | Cache doc |
| Tinh cach | **Kien nhan**: cho & thu lai khi tai cao | **Fail-fast**: that bai nhanh, khong giu request |
| Cau hinh | Mac dinh ioredis | `enableOfflineQueue:false`, `maxRetriesPerRequest:1` |

Hai ben co yeu cau **trai nhau**. Neu dung chung mot client cau hinh fail-fast, Redlock se khong cho noi khi tai cao -> khong dat duoc ve. Neu dung chung cau hinh kien nhan, cache lam treo request khi Redis chet. Tach ra thi Redis chet **chi anh huong lock**, doc du lieu van chay qua DB.

### 4.6 Khong cache gia tri null

`cache.ts:186-189`: chi ghi cache khi `value !== null && value !== undefined`.

Neu cache null, moi request sau nhan "not found" **ngay ca khi data da duoc tao ra** - nhung phai cho het TTL moi thay. Muon cache "khong tim thay" thi can sentinel rieng de phan biet voi MISS.

### 4.7 Cau hoi PV

**"Lam sao tranh cache stampede?"**
> Single-flight: khi MISS chi mot request gianh duoc lock Redis (SET NX) va di tinh lai; cac request khac polling cho cache duoc dien thay vi cung dap DB. Co kiem tra lai cache sau khi gianh lock, va fallback doc DB neu cho qua lau.

**"Tai sao khong cache null/missing?"**
> Vi se "cache poisoned": data thuc su chua ton tai bi ghi nho la khong ton tai, moi request sau nhan "not found" ngay ca khi data da duoc tao, cho toi het TTL. Muon cache missing phai dung sentinel rieng de phan biet voi MISS.

**"Khac giua cache hit va cache miss, lam sao do?"**
> Chi so `cache_hit_rate`, `db_reads`. **Phai lam cache LANH truoc** khi do - neu cache dang am thi moi request deu hit va test khong noi len gi. Cach xoa: `redis-cli --scan --pattern 'events:list:*' | xargs -r redis-cli del`.

**"Co bao gio cache bi xoa toan bo khong?"**
> Khong, dung versioned key. Version tang len -> moi key cu "vo hinh" ngay lap tuc va tu het han theo TTL 60s. Khong ton tai thao tac xoa hang loat key.

---

## 5. Chu de 3 - Bao mat

### 5.1 JWT - fail fast, khong bao gio co secret mac dinh

`server/src/config/auth.ts:34-60`:

```ts
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Thieu bien moi truong JWT_SECRET...');
  if (secret === OLD_LEAKED_DEFAULT) throw new Error('JWT_SECRET dang dung gia tri mac dinh cu da bi lo...');
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`JWT_SECRET qua ngan (${secret.length}, can it nhat ${MIN_SECRET_LENGTH})...`);
  return secret;
}
```

`MIN_SECRET_LENGTH = 32` (`auth.ts:13`).

**Diem hay:** fail fast tai **khoi dong** (`assertAuthConfig()` goi o `app.ts:80`), thay vi chay voi secret mac dinh ma ca the gioi biet. Test 4 case trong `test-jwt-security.cjs` chay `getJwtSecret()` trong **process con** de kiem tra tung truong hop.

### 5.2 Algorithm pinning - chong algorithm confusion

`server/src/middlewares/auth.middleware.ts:46`:

```ts
decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
```

Neu de trong, thu vien tu chon thuat toan theo header cua token -> kẻ tan cong ky token bang `alg: none` hoac doi HS256 sang RS256. **Ghim `algorithms` la chong thuoc**.

### 5.3 Khong tin role trong JWT - doc tu DB

JWT song **1 ngay**. Neu tin token, sau khi admin ha quyen, nguoi do van giu quyen cu toi het han - dung thu ma tinh nang "ha quyen" sinh ra de chan.

`auth.middleware.ts:24-70`:

```ts
// verify token -> doc trang thai tai khoan (co cache Redis) -> gan currentRole
req.user.currentRole = state.role;
```

`server/src/utils/userState.ts`: cache trang thai trong Redis, **TTL 30 giay**, doc DB theo PK mat **0,32 ms**, doc cache **~0,1 ms**. Khi doi quyen thi `invalidateUserState` chay ngay trong request -> hieu luc **tuc thoi**, khong can cho TTL.

**Controller chi doc `currentRole`, khong doc `req.user.role`.**

### 5.4 Rate limit - 3 bo, 3 muc dich

`server/src/middlewares/rateLimit.middleware.ts`

| Limiter | Han muc | Khoa theo | Muc dich |
|---------|---------|-----------|---------|
| `apiRateLimiter` | 100/phut | IP | Chong abuse/DDoS nhe, bao ve ca khi chua biet client la ai |
| `authRateLimiter` | 5 **that bai**/phut | IP | Chong brute-force mat khau |
| `registerRateLimiter` | 10/phut (ke ca thanh cong) | IP | Chong spam account |
| `orderRateLimiter` | 15/5 phut | **`userId`** | Chong dat ve lien tuc |

**Diem dac biet - `orderRateLimiter` khoa theo TAI KHOAN khong phai IP** (`rateLimit.middleware.ts:48-55`):

```ts
keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'unknown',
```

Ly do: trong thuc te rat nhieu nguoi dung chung mot IP (van phong, truong dai hoc, WiFi nha, mang di dong). Khoa theo IP nghia la ho bi chan oan chi vi nguoi khac trong cung mang da dat nhieu ve. Dieu kien de lam duoc la limiter phai chay **SAU `authenticate`** - do la ly do thu tu middleware trong `order.routes.ts` quan trong:

```ts
router.post('/', authenticate, orderRateLimiter, validateBody(createOrderSchema), createOrder);
```

`authRateLimiter` dung `skipSuccessfulRequests: true` -> chi request **that bai** moi bi dem, nguoi go sai 4 lan roi nhap dung van dung binh thuong.

### 5.5 RBAC - 2 tang, va tai sao role trong token bi bo qua

`auth.middleware.ts:96-130` (`authorize`): so sanh `currentRole` (tu DB) voi danh sach cho phep. `authenticate` da doc trang thai roi nen `authorize` khong can hoi DB lai (neu cache con hieu luc).

**Khong tach bang `roles`/`permissions`/`role_user`/`permission_role`:**
- Hien su chi co 3 vai tro co dinh va quyen gan voi tung route
- Policy nam canh endpoint, doc role la 1 luot doc theo PK (~0,32 ms, cache ~0,1 ms)
- `Role` la enum Prisma nen **sai chinh ta la loi compile**, khong phai loi runtime
- Doi sang RBAC dong chi khi can role tuy bien, multi-tenant, hay mot nguoi mang nhieu vai tro

### 5.6 Leaking loi - chi AppError duoc ra client nguyen van

`server/src/utils/errors.ts:11`:

```ts
export class AppError extends Error {}
```

Chi `AppError` moi duoc ra client nguyen van. Moi loi khac -> `logUnexpectedError` ghi log server, client nhan thong bao chung. Server khong duoc lo loi chi tiet (host, port, ten database...).

### 5.7 Cau hoi PV

**"Tai sao khong tin role trong JWT?"**
> JWT song toi 1 ngay. Tin token -> sau khi admin ha quyen, nguoi do van giu quyen cu toi het han. `authenticate` luon hoi DB va gan `currentRole`; controller chi doc `currentRole`. Cache Redis 30s giu duong dat ve khong phai doc DB moi request, nhung khi doi quyen thi `invalidateUserState` chay ngay trong request nen hieu luc tuc thoi.

**"Vi sao rate limit dat ve theo tai khoan khong theo IP?"**
> Vi thuc te nhieu nguoi dung chung mot IP. Khoa theo IP nghia la bi chan oan. Nguoc lai khoa theo tai khoan khong bi bot danh lach doi IP. Dieu kien de lam duoc la limiter phai chay **sau `authenticate`**.

**"Algorithm confusion la gi?"**
> Neu de trong `algorithms`, thu vien tu chon thuat toan theo header cua token. Ke tan cong ky token bang `alg: none` -> token duoc coi la hop le ma khong can biet secret. Ghim `algorithms: ['HS256']` la chong thuoc.

**"Tai sao token het han roi phai dang nhap lai? Refresh token co can khong?"**
> **Day la gap cua project** (xem muc 9). Tra loi thang: "Chua lam refresh token. Hien tai JWT song 1 ngay, het han phai dang nhap lai. Voi production, toi se them refresh token luu trong httpOnly cookie + access token ngan han (15-30 phut) - day la thay doi kha nho, khong dung lai phan tranh chap ton kho."

---

## 6. Chu de 4 - Job nen tra ve (CAC PHAM ON KHAC)

`server/src/jobs/expireOrders.job.ts:22-90`

```ts
const result = await prisma.$transaction(async (tx) => {
  // CAS: chi mot worker doi duoc PENDING -> EXPIRED
  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  if (claimed.count === 0) return null; // worker khac da xu ly
  // ... cong tra ve theo tung loai (dem tu order.tickets)
});
```

**Ba bai hoc:**
1. **CAS o day thay cho lock**: job khong doc gia tri cu de quyet dinh (khac `createOrder`), no chi doi trang thai co dieu kien. MySQL khoa row, worker thua nhan `count = 0` va bo qua.
2. **Doi trang thai va tra ve phai cung MOT transaction**: neu tach roi ma buoc cong ve loi, ta co don `EXPIRED` nhung ve bien mat vinh vien (khong con `PENDING` de job bat lan sau).
3. **Mot don loi khong lam chet ca luot quet**: moi don boc trong `try/catch` rieng.
4. Tra ve xong **phai xoa cache** (`job:86`), neu khong UI con hien thi so ve cu toi 60 giay.

`startExpireOrdersJob` (`job:96-115`) quet ngay 1 luot luc khoi dong (bat cac don het han trong luc server tat) roi lap moi `ORDER_SWEEP_INTERVAL_MS` (mac dinh 60s). `.unref()` de job khong giu process song.

**Cau hoi PV:** "Tai sao job het han khong can Redlock?" -> xem muc 3.3.

---

## 7. Chu de 5 - Race hanh tri (BA CAU HOI HAY)

`server/src/controllers/admin.controller.ts:50`:

```sql
SELECT id FROM `users` WHERE `role` = 'ADMIN' AND `isActive` = 1 FOR UPDATE
```

Tinh huong: he thong chi con 2 admin (A va B). A go "ha quyen B" va B go "ha quyen A" **cung luc**. Neu ca hai cung thay "con admin khac" -> ca hai deu duoc phep -> he thong khong con admin nao quan tri duoc.

**Diem hay - KHONG dung `count()`:** trong MySQL, `count()` la **consistent read theo snapshot** cua transaction, nen no co the doc trang thai **CU HON** trang thai ma mot locking read vua khoa, mo lai dung lo hong dang co gang chan. Cach dung: locking read de chan, roi **dem ket qua tra ve trong JS** (`rows.length`) chu khong `count()` lai trong cung transaction.

Test: `npm run test:race` - 2 admin cung ha quyen nhau -> chi 1 thang, "Khong the ha quyen admin cuoi cung cua he thong!" (400).

---

## 8. Chu de 6 - Phan loai loi (DE BI HOI, DE BI TRUONG)

`server/src/utils/errors.ts:51-100` - `mapPrismaError`:

| Ma loi Prisma | Y nghia | HTTP |
|---------------|---------|------|
| `P2000` | Gia tri qua dai cho cot ("too long for the column's type") | 400 |
| `P2002` | Vi pham rang buoc UNIQUE | 409 |
| `P2003` | Vi pham rang buoc FOREIGN KEY | 400 |
| `P2020` | Gia tri ngoai khoang cua kieu (vuot DECIMAL/INTEGER) | 400 |
| Loi MySQL tho | Khong co ma Prisma | 400 |
| Loi la | Khong xac dinh duoc | `null` -> 500 |

**Voi `createOrder`** (`order.controller.ts:127-148`):

| Tinh huong | Status | Vi sao |
|-----------|--------|--------|
| Redlock khong lay duoc lock (`ExecutionError`) | **429** | Qua tai, client thu lai duoc |
| Het ve / loai ve khong ton tai (`AppError`) | **400** | Loi thuoc ve request, thu lai y nguyen vo ich |
| Moi loi con lai (Prisma timeout, mat DB) | **500** | Loi server |

**Neu gop 500 vao 400** nhu code cu, khi DB qua tai client se duoc bao "request cua ban sai" -> khong thu lai, va monitoring dem hut loi server. **Phan loai sai lam chan doan sai.**

---

## 9. Chu de 7 - Cac bug thu te da gap (KHOI NGHIEP NHIU HON LY THUYET)

Day la phan **dat gia tri nhat** khi PV, vi chung minh ban doc code that, khong phai doc Wikipedia. Moi muc deu la bug **da xay ra trong chinh project nay** va **da duoc sua + co test**.

### 9.1 Oversell: read-then-write (muc 3.1)

### 9.2 `VARCHAR(191)` lam moi thao tac tao su kien chet voi 500

**Trieu chung:** tao su kien voi mo ta dai hon 191 ky tu -> API tra **500 `{"message":"Lo may chu"}`**. Nguoi dung khong biet sai o dau.

**Nguyen nhan:** Prisma mac dinh moi cot `String` thanh `VARCHAR(191)`. Con so 191 **den tu gioi han index utf8mb4** (191 x 4 byte = 764 < 767 byte), **khong phai quyet dinh thiet ke**. Zod khong gioi han do dai, form khong co `maxlength` -> mo ta di thang toi MySQL -> MySQL tu choi -> Prisma nem `P2000`.

**Sua 3 tang** (migration `20261020120000_widen_content_columns`):

| Cot | Truoc | Sau |
|-----|-------|-----|
| `events.title` | VARCHAR(191) | VARCHAR(255) |
| `events.description` | VARCHAR(191) | **TEXT** |
| `events.location` | VARCHAR(191) | VARCHAR(255) |
| `events.bannerUrl` | VARCHAR(191) | VARCHAR(500) |
| `ticket_types.name` | VARCHAR(191) | VARCHAR(100) |
| `ticket_types.price` | DECIMAL(10,2) | DECIMAL(12,2) |
| `orders.totalAmount` | DECIMAL(10,2) | DECIMAL(12,2) |

+ `.max()` trong Zod + `maxlength` tren form -> **3 tang cung mot con so**.

**Bai hoc:** gioi han do dai phai **khop** voi bang DB. Neu khong, du lieu qua dai di thang toi MySQL roi moi chet, va loi quay ve la 500 chung chung thay vi 400 noi ro "truong nao vuot, vuot bao nhieu".

### 9.3 Su kien tao duoc nhung khong ai dat ve duoc

`price` va `totalQuantity` deu hop le rieng le, nhung `orders.totalAmount` luu `price x quantity` -> **tich** cua chung phai vua bien `DECIMAL(12,2)`.

```
tao su kien: gia 9.999.999.999,99 x 2 ve  ->  201 (thanh cong, len ke)
dat ve:      tong = 19.999.999.999,98      ->  400 (vuot bien cot)
```

Su kien len ke thanh cong nhung **khong ai mua duoc** - loi chi lo ra o buoc thanh toan, xa hon nhieu so voi luc tao su kien.

**Sua:** `superRefine` kiem tra tich luc tao/sua su kien + **kiem tra lai trong `order.controller.ts`** (vi gia ve co the duoc sua sau khi su kien da tao - `order.controller.ts:85-87`).

**Chi tiet kien thuc:** khi so sanh o bien phai **lam tron ve 2 chu so thap phan truoc**: `3333333333.33 x 3` trong JS ra `9999999999.9899997711181640625`, so thang voi `9999999999.99` se **chan oan** mot don hop le.

### 9.4 Mot request co the lam sap server (DoS)

`order.controller.ts:98`:

```ts
tickets: { create: Array.from({ length: quantity }).map(() => ({ ticketTypeId })) }
```

Tao N ban ghi `Ticket` trong RAM bang `Array.from` - do thuc te **~46 byte/phan tu**:

| quantity | RAM can |
|----------|---------|
| 1.000.000 | ~46 MB |
| 5.000.000 | ~233 MB |
| 2.147.483.647 | **~100 GB -> sap tien trinh Node** |

Mot request co `quantity` khong tran (chi can `availableQuantity` du lon) la du de lam sap ca server. **Loai loi nay chi lo ra khi doc code, khong lo ra khi chay test binh thuong** (ai cung dat 1-2 ve).

**Sua:** `LIMITS.MAX_ORDER_QUANTITY = 100`.

### 9.5 CORS: toan tu comma lam mat `CORS_ORIGINS`

**Trieu chung:** client chay o cang **5174** bao loi CORS, du da khai bai cang. Thuc te **chi 5175** hoat dong.

**Nguyen nhan** (`server/src/app.ts`, code cu):

```ts
const allowedOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,...',
  'http://localhost:5174,...',
  'http://localhost:5176,...',
  'http://localhost:5175,...'      // <- chi phan tu CUOI duoc giu lai
).split(',')
```

**Dau phay trong JavaScript la TOAN TU COMMA** (uu tien thap nhat), khong phai phan tu mang. Bieu thuc duoc parse thanh `(a ?? 'b'), 'c', 'd'` -> **chi tra ve phan tu cuoi cung**. `CORS_ORIGINS` trong `.env` bi bo qua hoan toan.

**Bai hoc (rat de gap, rat de noi trong PV):**
- `??` rang hon `||` nhung **khong cuu duoc toan tu comma** - toan tu comma co uu tien thap hon moi toan tu khac, nen no nuot toan bo bieu thuc ben trai.
- Muon nhieu gia tri mac dinh thi dung `.join(',')` trong MOT chuoi, hoac mang that.
- **Tai sao loi nay loc qua toan bo test?** Vi cac script test goi API bang `fetch` cua Node - Node **khong** tu gui header `Origin`, nen nhanh "khong co Origin -> cho qua" luon dung va whitelist chua bao gio duoc kiem tra. Fix: tach `parseAllowedOrigins` ra `server/src/utils/cors.ts` de unit-test duoc, va them `test-cors.cjs` sinh header `Origin` that.

### 9.6 Script test loi giua chung -> de lai tai khoan rac co mat khau da biet

Rà DB phat hien **10 tai khoan ADMIN rac**, tat ca deu co mat khau `MatKhauDaiHon8KyTu`.

Ba nguyen nhan (deu la loi trong chinh bo test):
1. Script tao tai khoan roi xoa o cuoi happy path, con `main().catch()` chi in loi roi thoat -> loi giua chung la de lai tai khoan.
2. `Order.userId` la FK **Restrict** -> phai xoa **order truoc** roi moi xoa user. `prisma.user.delete(...).catch(() => {})` **nuot mat loi FK**, nen nhin tuong da xoa.
3. `test-admin-race.cjs`: `updateMany` ha quyen **toan bo admin** nam **ngoai** khoi `try` -> loi ngay sau do se de lai he thong **khong con admin nao**.

**Sua:** `cleanup()` goi o **ca** duong thanh cong lan duong loi, va thu tu xoa dung: `order -> event -> audit log -> user`.

### 9.7 Chay ca bo test lien tiep vuot rate limit, bao loi sai

`apiRateLimiter` gioi han **100 request/phut**. Moi bo test rieng le dung chua toi 40 request, nhung ca 7 bo cong lai vuot 100.

Trieu chung **rat de hieu nham**:

| Bo test | Thong bao loi | Thuc te |
|---------|---------------|---------|
| `test-cors` | "khong ket noi duoc server" | Server van chay, chi la 429 |
| `test-validation` | `SyntaxError: Unexpected token 'Q'` | Body 429 cua express-rate-limit la **plain text**, khong phai JSON |

**Sua:** `server/run-all-tests.cjs` doc header `RateLimit-Remaining` / `RateLimit-Reset` (server bat `standardHeaders: true`) de cho dung so giay con thieu, thay vi ngu cung 60s. Cac script bao ro nguyen nhan khi gap 429.

### 9.8 Chay nhanh hon: cach doc `RateLimit-Reset`

Ky nang nho cho PV: **`standardHeaders: true`** cua `express-rate-limit` giup server tu gui header:

```
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 42
```

Dung header nay de **tu dieu chinh** (vi du: client tu cham lai khi con it quota) thay vi hardcode.

---

## 10. Chu de 8 - Client: chong double-booking (chi la UX!)

`client/src/views/EventDetailView.vue`

```vue
:disabled="ticket.availableQuantity <= 0 || submittingId === ticket.id"
```

- `submittingId` (dong 21) - chi mot loai ve duoc gui mot luc, con lai disable
- `normalizeQuantity` (dong 109) - chuan hoa khi blur: xoa trang -> ve 1; vuot ton kho -> kep ve `availableQuantity`
- Comment o dong 81-82: "Chi tat loading neu day van la request moi nhat" - request bi huy van chay toi `finally` va khong duoc tat loading cua request dang bay

**Diem quan trong nhat:** frontend disable nut chi la **UX**. Ke tan cong bo qua UI va goi API truc tiep. **Day la ly do phai co du ca redlock + CAS + rate limit.** Neu interviewer hoi "ua co khoa nut roi co can khoa o backend khong?" - day la cau hoi de vang: tra loi "Co, va day la vi sao toi co 3 lop bao ve".

---

## 11. Bang so lieu PHAI NHO (PV hay hoi "con so gi?")

| So lieu | Nghia la | O dau |
|---------|---------|-------|
| 111 ms vs 0,206 ms | `KEYS` vs `INCR` voi 50.000 key | muc 4.2 |
| 63,09 giay | `GET /api/events` treo khi Redis chet voi cau hinh mac dinh | muc 4.4 |
| 6/18/38 luot | 100 request dong thoi, cache lanh | muc 4.3 |
| 38/98/130 luot | 500 request dong thoi, cache lanh | muc 4.3 |
| ~46 byte/phan tu | RAM mot `Ticket` trong `Array.from` | muc 9.4 |
| ~100 GB | RAM khi `quantity` = 2.147.483.647 | muc 9.4 |
| 0,32 ms vs ~0,1 ms | doc DB theo PK vs doc cache Redis | muc 5.3 |
| 191 x 4 = 764 < 767 byte | gioi han index utf8mb4 | muc 9.2 |
| TTL lock 5000ms | do giu lock toi da | muc 3.2 |
| 10 ve / 200 VU | load test: 10 don, zero oversell, zero 5xx | muc 3.4 |
| 100 req/phut | `apiRateLimiter` | muc 5.4 |
| 15 lan / 5 phut | `orderRateLimiter` (theo tai khoan) | muc 5.4 |
| 5 lan that bai / phut | `authRateLimiter` | muc 5.4 |
| TTL cache 60s | `READ_TTL_SECONDS` (`cache.ts:17`) | muc 4.2 |
| TTL user state 30s | `USER_STATE_TTL_SECONDS` | muc 5.3 |
| JWT 1 ngay | han token | muc 5.3 |

---

## 12. GAP cua project - BIET TRUOC, tra loi trung thuc

Interviewer **se** hoi ve cai con thieu. Neu biet, ban duoc cong diem; neu giu, ho se hoi tiep va ban hong tra loi duoc.

| Gap | Muc do | Tra loi nhu the nao |
|-----|--------|-------------------|
| **Chua co thanh toan** | Trung binh | "Chua lam VNPay/MoMo. Do la ranh gioi cua project. Anh/chi se lam duoc o buoc nao?" - buoc: them bang trang thanh toan, webhook xac nhan, `updateMany` doi trang thai `PENDING -> CONFIRMED` co dieu kien (CAS, dung pattern job het han). **Ghi chu:** vi vay `CONFIRMED`/`CANCELLED` chua bao gio duoc set, nen **doanh thu trong admin/organizer stats luon = 0**. Noi thang dieu nay. |
| **Chua co refresh token** | Thap | xem muc 5.7 |
| **Chua co CI** | Trung binh | "Chay 7 bo test bang script (npm run test:all) va k6, chua co CI. Neu co thoi gian, toi se dua vao GitHub Actions: service MySQL + Redis, chay test, k6 smoke test." |
| **Chua co Docker / HTTPS / helmet / structured logging** | Thap | "Chua lam. Day la danh sach vi du production-ready, toi nam trong roadmap." |
| **Chua co email xac nhan / quen mat khau** | Thap | "Chua lam, se them luong OTP va bang tiep." |
| **RBAC tinh, chua co bang `permissions`** | Thap | xem muc 5.5 - co ly do ro rang |

**Cau hoi kiem tra ban co that khong:**
> "Anh/chi noi project nay chay production chua?"
> Tra loi: "Chua. Hien tai la project hoc tap va moi chay o moi truong dev voi MySQL/Redis local. Phan con thieu de len production da duoc nam trong roadmap: Docker, secret management, structured logging, refresh token, va tich hop thanh toan."

---

## 13. CAU HOI DAO NGUOC - HOI DUOC, NEN HOI

- "Duy an nay cua anh/chi hay lam nhom?" -> **Hoi**: quy mo, phan nao ban lam, bao gio deadline
- "May test chay theo kieu nao?" -> **Hoi**: co CI khong, deploy theo nao, co canh bao gi khong
- "Co bao gio can rollback khong?" -> **Hoi**: quy trinh release
- "Team bao nhiu nguoi, ai lam phan nao?" -> **Hoi** de biet moi truong hop xu ly
- "He thong chay tren may so bao nguoi dong thoi?" -> **Hoi** de biet target scale

---

## 14. CHECKLIST TU KIEM TRA TRUOC PV

### 14.1 Code phai doc thuoc (khong tim trong file khi PV)

- [ ] `server/src/controllers/order.controller.ts` - 183 dong, doc het
- [ ] `server/src/utils/cache.ts` - doc `cacheGetOrLoad` va `parseAllowedOrigins`... (doc het file)
- [ ] `server/src/middlewares/auth.middleware.ts` - doc het
- [ ] `server/src/jobs/expireOrders.job.ts` - doc het
- [ ] `server/src/config/redis.ts` + `config/auth.ts`
- [ ] `server/src/utils/errors.ts` + `utils/validation.ts`
- [ ] `server/prisma/schema.prisma` - 139 dong
- [ ] `server/src/controllers/admin.controller.ts` - phan `FOR UPDATE`
- [ ] `client/src/views/EventDetailView.vue` - phan double-booking

### 14.2 Phai chay duoc khong can tim

- [ ] `npm run seed` - tao admin
- [ ] `npm run test:all` - 7 bo test
- [ ] `npm run test:security` - 17 case bao mat
- [ ] `npx k6 run load-test-concurrent.js` - 200 VU
- [ ] `node oversell-repro.cjs` - mo phong mat lock

### 14.3 Cau hoi bat buoc tu tra loi duoc (khong do)

1. Bai toan chinh la gi? -> **Tranh chap ton kho**
2. Vì sao khong dung read-then-write? -> **Khoang thoi gian giua doc va ghi**
3. Lock va CAS khac nhau the nao? -> **Lock = toi uu, CAS = tinh dung dan**
4. Vì sao job khong can lock? -> **No la CAS, khong phai read-then-write**
5. Stampede la gi, sua the nao? -> **Single-flight voi SET NX**
6. Vì sao 2 Redis client? -> **2 yeu cau trai nhau**
7. Vì sao khong tin role trong JWT? -> **JWT song 1 ngay**
8. Rate limit theo IP hay tai khoan? -> **Tuy use case** (dat ve: tai khoan)
9. Vi sao 3 lop bao ve? -> **Defense in depth**
10. Lam gi khi Redis chet? -> **Fail-open, doc DB**

### 14.4 Loi khi bi hoi "anh/chi lam gi them duoc"

Neu cau hoi nam ngoai kien thuc cua project (vi du "implement bang Kafka"), **noi ro la ban chua lam** roi **noi ban se lam theo huong nao**. Do la cau tra loi chuan nghiep hon la "em chua nghi toi".

---

## 15. De xuat luyen tap

| Cach | Thoi gian | Dung de |
|------|-----------|---------|
| **Kể lai 3 bug** (muc 9.2, 9.3, 9.5) theo **STAR**: Situation - Task - Action - Result | 10 phut | Thay vi "em dung Zod va Prisma", kể bang 3 cau chuyen co trieu chung, so lieu va ket qua |
| **Ve lai 3 lop bao ve** tren giay | 5 phut | Neu ve sai, interviewer se biet minh hieu |
| **Trong luong dien dat `updateMany` co dieu kien** voi `SELECT ... FOR UPDATE` | 5 phut | Phan biet thuong gap nhat |
| **Mo code, tim bang mat** (VD: "tim cho em noi dang giu lock sau khi commit") | 5 phut | Chung minh thuoc codebase |
| **Tu viet lai `parseAllowedOrigins` va `cacheGetOrLoad`** khong xem code | 15 phut | Kiem tra hieu bai |
| **Dien giai `mapPrismaError`** | 5 phut | Phan loai loi - de bi hoi |

---

*Tai lieu hoc tap - cap nhat 21/10/2026. Doc kem `PROJECT_NOTES.md` (giai thich chi tiet tung co che, kem so dong) va `README.md`.*

