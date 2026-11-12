# AGENTS.md

Hướng dẫn chung cho mọi AI làm việc trong repo này (Claude Code, Codex, opencode, kilo...). Đọc file này trước, rồi chỉ mở đúng file cần cho việc được giao.

Hệ thống bán vé sự kiện: `client/` (Vue 3, Pinia, Tailwind, shadcn-vue) và `server/` (Express 4, Prisma 5, MySQL 8, Redis 7). Hai package độc lập, không có workspace, cài dependency riêng trong từng thư mục. Comment trong code và thông báo API bằng tiếng Việt: giữ nguyên ngôn ngữ này.

## Luật cho AI

- **Không đọc:** `.env*` (chứa mật khẩu thật), `backups/` (dump database thật), `**/package-lock.json`, `**/dist/`, `node_modules/`.
- **Không đọc nguyên** `PROJECT_NOTES.md` (~30k token) hay `TRICK.md`. Cần lý do thiết kế thì tìm mục bằng `grep -n '^##' PROJECT_NOTES.md` rồi chỉ đọc khoảng dòng đó. Hai file này có thể lệch với code: **lấy code làm chuẩn**.
- Không commit, push hay tạo nhánh nếu người giao việc không yêu cầu. Chỉ sửa đúng các file được giao.
- Không chạy test trên database thật hoặc TiDB production (xem mục Test).

## Cần gì thì mở đâu

| Chủ đề | File |
|---|---|
| Đặt vé, xác nhận, huỷ đơn | `server/src/controllers/order.controller.ts`, `server/src/utils/orderInventory.ts` |
| Đơn hết hạn | `server/src/jobs/expireOrders.job.ts` |
| Sự kiện, loại vé | `server/src/controllers/event.controller.ts` |
| Danh mục, bộ lọc danh sách sự kiện | `server/src/utils/eventFilters.ts`, `client/src/utils/categories.ts`, `client/src/views/HomeView.vue` |
| Đăng nhập, phân quyền | `server/src/middlewares/auth.middleware.ts`, `server/src/utils/userState.ts` |
| Quản trị | `server/src/controllers/admin.controller.ts` |
| Cache, Redis | `server/src/utils/cache.ts`, `server/src/config/redis.ts` |
| Validation, giới hạn dữ liệu | `server/src/utils/validation.ts`, `server/prisma/schema.prisma` |
| Ảnh tải lên | `server/src/utils/storage.ts`, `server/src/controllers/upload.controller.ts` |
| Lỗi và mã HTTP | `server/src/utils/errors.ts` |
| Dữ liệu mẫu | `server/prisma/seed.ts` (admin), `server/prisma/seed-demo.ts` (demo) |
| Client gọi API | `client/src/api/axios.ts`, `client/src/stores/` |
| Deploy | `render.yaml`, `Dockerfile` (gốc), `deploy/ENVIRONMENTS.md`, `deploy/cloud/` |

## Lệnh

```bash
docker compose up -d                 # chỉ bật MySQL và Redis; server và client chạy local

# server/ (mặc định http://localhost:5000, cần .env với DATABASE_URL và JWT_SECRET >= 32 ký tự)
npm run dev                          # ts-node-dev, tự reload
npx tsc --noEmit                     # kiểm tra kiểu
npm run build && npm start           # biên dịch rồi chạy dist/app.js
npx prisma migrate deploy            # áp dụng migration
npx prisma migrate dev --name <ten>  # tạo migration mới (kèm DROP DEFAULT của actorEmail do schema đang lệch)
npm run seed                         # tạo hoặc đặt lại admin@test.com
npm run seed:demo                    # dữ liệu demo

# client/ (http://localhost:5173)
npm run dev
npm run build                        # vue-tsc rồi vite build
```

Không có linter. CI ở `.github/workflows/ci.yml` chạy trên pull request. Client chưa có test tự động.

### Test

Test là script Node tự viết ở gốc `server/` (`test-*.cjs`), không dùng test framework. Chúng gọi API thật và ghi thẳng vào database, nên cần server, MySQL và Redis đang chạy.

```bash
npm run test:all                     # tất cả bộ test, chạy tuần tự
node test-regressions.cjs            # một bộ; không lọc được từng case
BASE_URL=http://localhost:5055/api npm run test:all   # server ở cổng khác
```

- **Test ghi vào database mà `DATABASE_URL` trỏ tới.** Biến môi trường đã đặt sẵn được ưu tiên hơn `.env`, nên hãy trỏ sang MySQL tạm. `test-admin-race.cjs` tạm hạ quyền toàn bộ admin và chỉ chạy với host cục bộ, trừ khi đặt `ALLOW_DESTRUCTIVE_TESTS=true`.
- Rate limit nằm trong RAM server (100 request/phút, 30 request admin/phút, 5 lần đăng nhập sai/phút). Chạy lặp sẽ nhận 429 dạng JSON `{ message }`, không phải bug: chờ khoảng 1 phút hoặc khởi động lại server.
- Bộ test mới cần thêm vào `SUITES` trong `run-all-tests.cjs` và `scripts` trong `package.json`.
- `load-test*.js` chạy bằng k6. `oversell-*.cjs` tái hiện tranh chấp vé, không nằm trong `test:all`.

## Kiến trúc

Luồng request: `routes/` gắn middleware theo thứ tự `authenticate` → `authorize` hoặc rate limiter → `validateBody(schema)` → controller. Không có tầng service, logic nghiệp vụ nằm trong controller.

### Đặt vé và tồn kho

`availableQuantity` là số vé còn lại; số đã "bán" là `totalQuantity - availableQuantity`, gồm cả vé đang giữ chỗ.

- **Chốt chặn chống bán quá số vé là `updateMany` có điều kiện `availableQuantity >= quantity`** trong `createOrder`, cùng `CHECK` ở database. Redlock chỉ là lớp bên ngoài. Không đổi thành kiểu đọc rồi mới ghi.
- Vòng đời đơn: `createOrder` tạo `PENDING`; chỉ một trong ba đường đổi được trạng thái nhờ `updateMany` có điều kiện: `confirmOrder` (`CONFIRMED`, sinh `qrCode`, thanh toán giả lập), `cancelOrder` (`CANCELLED`) và job hết hạn (`EXPIRED`). Hai đường sau trả vé qua `returnTicketsToStock` trong cùng transaction.
- Hạn mức theo tài khoản: câu đầu tiên của transaction trong `createOrder` phải là `SELECT ... FOR UPDATE` trên dòng user. Redlock khoá theo loại vé nên không bảo vệ được hạn mức, và đọc thường trước đó sẽ chụp snapshot cũ.
- Đơn `EXPIRED` và `CANCELLED` vẫn giữ dòng `Ticket`, mà `tickets -> ticket_types` là FK `RESTRICT`. Xoá sự kiện hoặc loại vé phải xoá các đơn đó trong cùng transaction (`deleteReleasedOrdersOf`).
- `updateEvent` đối chiếu loại vé theo `id` và dùng `increment` theo chênh lệch. `ticketTypes` là `undefined` nghĩa là không đụng tới, `[]` nghĩa là xoá hết các loại chưa bán.
- MySQL từ chối `deleteMany` có điều kiện quan hệ (lỗi 1093): tìm id trước rồi xoá theo id.

### Cache và Redis

- **Hai Redis client có chủ đích:** `redisClient` cho Redlock (kiên nhẫn chờ, thử lại) và `cacheClient` (lỗi nhanh, timeout 200 ms). Cache phải dùng `cacheClient`, và lỗi Redis không được làm hỏng request đọc. `REDIS_URL` (nếu có) được ưu tiên hơn `REDIS_HOST`/`REDIS_PORT`.
- Cache danh sách dùng version trong khoá: vô hiệu bằng `INCR`, không dùng `KEYS`. Mọi thao tác đổi số vé phải gọi `invalidateEventCache`.
- `GET /api/events` lọc theo `category`, `location` (chứa chuỗi), `from`/`to` (ngày giờ Việt Nam, `to` gồm hết ngày), `minPrice`/`maxPrice` (có ít nhất một loại vé trong khoảng). `parseEventFilters` chuẩn hoá và **bỏ qua giá trị sai thay vì trả 400**, giống `parsePagination`. **Khoá cache phải gồm mọi bộ lọc đã chuẩn hoá**: thêm bộ lọc mới thì thêm vào `listCacheKey`, nếu không người dùng sẽ nhận kết quả của bộ lọc khác.
- Danh mục là enum `EventCategory` (mặc định `OTHER`); thêm giá trị mới cần migration và nhãn tiếng Việt trong `client/src/utils/categories.ts`.
- `getUserState` cache role và trạng thái khoá trong 30 giây; đổi role hoặc khoá tài khoản phải gọi `invalidateUserState`.

### Xác thực và phân quyền

- `authenticate` gán `req.user.currentRole` từ database (qua cache). **Kiểm tra quyền bằng `currentRole`, không dùng `role` trong JWT** vì token sống 1 ngày.
- Đổi quyền admin khoá các dòng admin bằng `FOR UPDATE`, đếm kết quả trong JS (không dùng `count()`), và chạy qua `runWithDeadlockRetry`.

### Xử lý lỗi

- Controller bọc `try/catch` và gọi `handleControllerError`. **Handler async bắt buộc phải tự bắt lỗi:** Express 4 không bắt được promise bị reject và tiến trình Node sẽ thoát.
- Chỉ message của `AppError` được trả nguyên văn cho client. Lỗi Prisma đã biết được `mapPrismaError` chuyển thành 400 hoặc 409.
- `app.ts` phải giữ `import 'dotenv/config'` ở dòng import đầu tiên.

### Tải ảnh

- `POST /api/uploads` (ORGANIZER/ADMIN, field `file`) nhận diện ảnh bằng **magic bytes**, encode lại bằng sharp thành WEBP, bỏ metadata, giới hạn 40 triệu pixel và thu nhỏ tối đa 1920×1920. Trả về đường dẫn **tương đối** `/uploads/<uuid>.webp`; client ghép origin qua `resolveMediaUrl`. Không lưu host vào database.
- `STORAGE_DRIVER=disk` (mặc định) ghi vào `UPLOAD_DIR`; `STORAGE_DRIVER=db` lưu ảnh trong database (dùng trên Render vì ổ đĩa không bền).
- Đổi giới hạn 5MB thì sửa cả `MAX_IMAGE_BYTES`, `client_max_body_size` trong `client/nginx.conf` và `MAX_BANNER_BYTES` ở client.

### Validation

Giới hạn trong `LIMITS` (`utils/validation.ts`) phải khớp với độ dài cột trong `schema.prisma`. `CHECK` constraint không biểu diễn được trong Prisma, nên viết tay trong migration SQL.

### Client

- **`api/axios.ts` nhận diện loại lỗi 403 bằng regex trên message tiếng Việt** ("token", "bị khoá", "không có quyền"). Đổi các thông báo này ở `auth.middleware.ts` thì phải sửa cả regex.
- `api/session.ts` là kênh callback giữa axios và `main.ts`, tránh vòng import với router.
- `token` lưu ở `localStorage`, `user` chỉ nằm trong RAM. Router guard của route cần role phải chờ `authStore.ensureProfile()`.
- Prisma `Decimal` được serialize thành chuỗi, phải chuyển sang số trước khi tính toán.
- `confirmOrder`/`cancelOrder` chỉ trả `tickets` trần, nên store ghép lại `ticketType` cũ theo ticket id.

## Deploy

Bảng đầy đủ các môi trường ở `deploy/ENVIRONMENTS.md`, các bước deploy ở `deploy/cloud/README.md`.

- **Production demo: Render free + TiDB Cloud Starter + Render Key Value.** Một image từ `Dockerfile` ở gốc: Node phục vụ cả build Vue (`SERVE_CLIENT_DIR`) và `/api`, chạy `prisma migrate deploy` khi khởi động. Cấu hình trong `render.yaml` (Blueprint, Singapore), tự deploy khi push `main`.
- Giữ **một web service duy nhất** (750 giờ miễn phí mỗi tháng) và image `linux/amd64`.
- Render ngủ sau 15 phút không có request: `.github/workflows/keepalive.yml` ping `/api/health` mỗi 10 phút.
- **TiDB có thể tắt `CHECK` constraint**, nên lớp chống bán quá số vé ở database có thể không có tác dụng. Chạy test trên TiDB trước khi khẳng định.
- Backup và khôi phục: `deploy/cloud/backup-db.sh`, `deploy/cloud/restore-db.sh`. Chúng đọc `server/.env.render.local` mà không `source` file đó.
- `deploy/*.sh`, `deploy/Caddyfile`, `deploy/docker-compose.deploy.yml` và `.github/workflows/deploy.yml` thuộc hướng VPS ARM64 trước đây, **không dùng cho Render**; `deploy.yml` chỉ chạy khi bấm tay.
