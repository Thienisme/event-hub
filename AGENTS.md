# AGENTS.md

Hướng dẫn chung cho mọi AI làm việc trong repo này (Claude Code, Codex, opencode, kilo...). Đọc file này trước, rồi chỉ mở đúng file cần cho việc được giao.

Hệ thống bán vé sự kiện: `client/` (Vue 3, Pinia, Tailwind, shadcn-vue) và `server/` (Express 4, Prisma 5, MySQL 8, Redis 7). Hai package độc lập, không có workspace, cài dependency riêng trong từng thư mục. Comment trong code và thông báo API bằng tiếng Việt: giữ nguyên ngôn ngữ này.

## Luật cho AI

- **Không đọc:** `.env*` (chứa mật khẩu thật), `backups/` (dump database thật), `**/package-lock.json`, `**/dist/`, `node_modules/`.
- **Không đọc nguyên** `PROJECT_NOTES.md` (~30k token) hay `TRICK.md`. Cần lý do thiết kế thì tìm mục bằng `grep -n '^##' PROJECT_NOTES.md` rồi chỉ đọc khoảng dòng đó. Hai file này có thể lệch với code: **lấy code làm chuẩn**.
- Không commit, push hay tạo nhánh nếu người giao việc không yêu cầu. Chỉ sửa đúng các file được giao.
- Không chạy test trên database thật hoặc TiDB production (xem mục Test).
- `docs/DEVOPS-HOC-TAP.md` là sổ tay học CI/CD và deploy của chủ dự án (kèm sự cố đã gặp). Gặp sự cố CI/deploy mới đáng nhớ thì thêm một dòng vào mục 4 của file đó.

## Cần gì thì mở đâu

| Chủ đề | File |
|---|---|
| Đặt vé, xác nhận, huỷ đơn | `server/src/controllers/order.controller.ts`, `server/src/utils/orderInventory.ts` |
| Email vé, nhắc lịch | `server/src/utils/ticketEmail.ts`, `server/src/jobs/eventReminder.job.ts`, `server/test-ticket-email.cjs` |
| Đơn hết hạn | `server/src/jobs/expireOrders.job.ts` |
| Thanh toán VNPay/MoMo, mã giảm giá, danh sách chờ | `docs/PAYMENTS.md` (luồng, chốt chặn, cách test), `server/src/payments/`, `server/src/controllers/payment.controller.ts` |
| Phòng chờ ảo | `docs/WAITING-ROOM.md`, `server/src/utils/waitingRoom.ts`, `server/src/controllers/queue.controller.ts`, `server/test-waiting-room.cjs` |
| Chuyển nhượng vé | `server/src/controllers/ticket.controller.ts`, `server/test-ticket-transfer.cjs`, `client/src/components/TransferTicketDialog.vue` |
| Soát vé QR (check-in) | `server/src/controllers/checkin.controller.ts`, `client/src/views/CheckInView.vue` |
| Nhân viên soát vé | `server/src/controllers/eventStaff.controller.ts`, `client/src/views/EventStaffView.vue`, `client/src/views/CheckInEventsView.vue`, `server/test-event-staff.cjs` |
| Sự kiện, loại vé | `server/src/controllers/event.controller.ts` |
| Danh mục, bộ lọc danh sách sự kiện | `server/src/utils/eventFilters.ts`, `client/src/utils/categories.ts`, `client/src/views/HomeView.vue` |
| Đăng nhập, phân quyền | `server/src/middlewares/auth.middleware.ts`, `server/src/utils/userState.ts` |
| Email, quên mật khẩu, xác minh email | `server/src/utils/mailer.ts`, `server/src/controllers/emailAuth.controller.ts`, `server/test-password-reset.cjs` |
| Hồ sơ, đổi mật khẩu | `server/src/controllers/auth.controller.ts`, `client/src/views/ProfileView.vue` |
| Bảng điều khiển bán vé | `server/src/controllers/dashboard.controller.ts`, `client/src/views/SalesDashboardView.vue`, `client/src/components/RevenueChart.vue`, `CategoryDonut.vue`, `StatTile.vue`, `server/test-dashboard.cjs` |
| Quản trị | `server/src/controllers/admin.controller.ts` |
| Cache, Redis | `server/src/utils/cache.ts`, `server/src/config/redis.ts` |
| Validation, giới hạn dữ liệu | `server/src/utils/validation.ts`, `server/prisma/schema.prisma` |
| Ảnh tải lên | `server/src/utils/storage.ts`, `server/src/controllers/upload.controller.ts` |
| Lỗi và mã HTTP | `server/src/utils/errors.ts` |
| Dữ liệu mẫu | `server/prisma/seed.ts` (admin), `server/prisma/seed-demo.ts` (demo) |
| Client gọi API | `client/src/api/axios.ts`, `client/src/stores/` |
| Giao diện: màu, chữ, bo góc, thành phần | `DESIGN.md`, `client/src/style.css` |
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

Không có linter. CI ở `.github/workflows/ci.yml` chạy trên pull request. Client có test E2E bằng Playwright (job CI riêng).

### Test

Test là script Node tự viết ở gốc `server/` (`test-*.cjs`), không dùng test framework. Chúng gọi API thật và ghi thẳng vào database, nên cần server, MySQL và Redis đang chạy.

```bash
npm run test:all                     # tất cả bộ test, chạy tuần tự
node test-regressions.cjs            # một bộ; không lọc được từng case
BASE_URL=http://localhost:5055/api npm run test:all   # server ở cổng khác
```

- **Test ghi vào database mà `DATABASE_URL` trỏ tới.** Biến môi trường đã đặt sẵn được ưu tiên hơn `.env`, nên hãy trỏ sang MySQL tạm. `test-admin-race.cjs` tạm hạ quyền toàn bộ admin và chỉ chạy với host cục bộ, trừ khi đặt `ALLOW_DESTRUCTIVE_TESTS=true`.
- Rate limit nằm trong RAM server (100 request/phút, 30 request admin/phút, 5 lần đăng nhập sai/phút). Chạy lặp sẽ nhận 429 dạng JSON `{ message }`, không phải bug: chờ khoảng 1 phút hoặc khởi động lại server.
- Trần 100 request/phút đọc từ `API_RATE_LIMIT_MAX` (mặc định 100). CI đặt `100000` để `run-all-tests.cjs` không phải chờ giữa các bộ; chạy test ở máy thì đặt biến này cho server tạm cũng nhanh hơn. Không đặt biến này trên production.
- Bộ test mới cần thêm vào `SUITES` trong `run-all-tests.cjs` và `scripts` trong `package.json`.
- `load-test*.js` chạy bằng k6. `oversell-*.cjs` tái hiện tranh chấp vé, không nằm trong `test:all`.

### E2E client (Playwright)

- Chỉ dùng database tạm, migrate rồi `cd server && npm run seed:demo`; server chạy `NODE_ENV=development` để bật MOCK. Không dùng database thật.
- Chạy client dev ở 5173 và server ở 5000, rồi `cd client && E2E_API_URL=http://localhost:5000/api npm run test:e2e`. Client phải gọi đúng API server. Nếu server phục vụ cả client build: `E2E_BASE_URL=http://127.0.0.1:5000 npm run test:e2e`.
- Dữ liệu: ba tài khoản demo, mật khẩu `E2E_PASSWORD` (mặc định `demo12345`, khớp `SEED_DEMO_PASSWORD` lúc seed). Mỗi test tự tạo đơn/QR cần dùng qua API; đổi hồ sơ phải khôi phục trong `finally`. Seed lại database tạm khi cần đặt lại tồn kho/đơn sau nhiều lượt chạy.
- Selector ưu tiên `getByRole`, `getByLabel`, chữ tiếng Việt; không dựa vào class CSS. Chỉ thêm `data-testid` khi không có selector ổn định. Chạy tuần tự một worker vì dùng chung database.
- Server phục vụ client build (`SERVE_CLIENT_DIR`) giữ sẵn `index.html` đã chèn thẻ OG cho `/events/:slug`: build lại client thì **khởi động lại server**, nếu không trang sự kiện trắng vì trỏ tới file JS cũ đã bị xoá.
- `cd client && npx playwright test --list` chỉ liệt kê test, không cần server. Báo cáo trong `client/playwright-report/`, ảnh và trace trong `client/test-results/`.

## Kiến trúc

Luồng request: `routes/` gắn middleware theo thứ tự `authenticate` → `authorize` hoặc rate limiter → `validateBody(schema)` → controller. Không có tầng service, logic nghiệp vụ nằm trong controller.

### Đặt vé và tồn kho

`availableQuantity` là số vé còn lại; số đã "bán" là `totalQuantity - availableQuantity`, gồm cả vé đang giữ chỗ.

- **Chốt chặn chống bán quá số vé là `updateMany` có điều kiện `availableQuantity >= quantity`** trong `createOrder`, cùng `CHECK` ở database. Redlock chỉ là lớp bên ngoài. Không đổi thành kiểu đọc rồi mới ghi.
- Vòng đời đơn: `createOrder` tạo `PENDING`; chỉ một trong các đường sau đổi được trạng thái nhờ `updateMany` có điều kiện: `confirmOrder` (`CONFIRMED`, sinh `qrCode`, thanh toán giả lập), `completePayment` (`CONFIRMED` khi VNPay/MoMo báo trả tiền), `cancelOrder` (`CANCELLED`) và job hết hạn (`EXPIRED`). Hai đường sau trả vé qua `returnTicketsToStock` trong cùng transaction.
- Hạn mức theo tài khoản: câu đầu tiên của transaction trong `createOrder` phải là `SELECT ... FOR UPDATE` trên dòng user. Redlock khoá theo loại vé nên không bảo vệ được hạn mức, và đọc thường trước đó sẽ chụp snapshot cũ.
- Đơn `EXPIRED` và `CANCELLED` vẫn giữ dòng `Ticket`, mà `tickets -> ticket_types` là FK `RESTRICT`. Xoá sự kiện hoặc loại vé phải xoá các đơn đó trong cùng transaction (`deleteReleasedOrdersOf`).
- `updateEvent` đối chiếu loại vé theo `id` và dùng `increment` theo chênh lệch. `ticketTypes` là `undefined` nghĩa là không đụng tới, `[]` nghĩa là xoá hết các loại chưa bán.
- MySQL từ chối `deleteMany` có điều kiện quan hệ (lỗi 1093): tìm id trước rồi xoá theo id.

### Thanh toán, mã giảm giá, danh sách chờ

Chi tiết và cách test ở `docs/PAYMENTS.md`. Những điều không được phá:

- IPN và route return đều đi qua `completePayment`: khoá dòng `payments` bằng `FOR UPDATE` theo `txnRef`, chỉ xử lý Payment `PENDING`, so số tiền với lúc tạo, đổi đơn bằng `updateMany` có điều kiện `PENDING`. Tiền về khi đơn đã huỷ/hết hạn thì đánh dấu `needsRefund`, không xác nhận đơn.
- Kiểm chữ ký bằng `timingSafeEqual`; IPN VNPay luôn trả HTTP 200 kèm `RspCode`.
- `/pay` kéo `expiresAt` của đơn qua thời điểm cổng đóng (`PAYMENT_HOLD_MINUTES` + 5 phút); tối đa 3 Payment mỗi đơn; đơn 0 đ xác nhận luôn.
- Đơn đã có Payment thì không đổi mã giảm giá nữa (409), để số tiền gửi sang cổng luôn khớp đơn.
- Lượt dùng mã: chiếm bằng `claimPromoUsage` (UPDATE có điều kiện `usedCount < maxUses`), trả bằng `releasePromoUsage` trong cùng transaction khi huỷ/hết hạn. Hạn mức `perUserLimit` cần `SELECT ... FOR UPDATE` dòng user trước, như `createOrder`.
- Danh sách chờ chỉ báo email, không giữ vé; chiếm lượt báo bằng `updateMany` có điều kiện `notifiedAt: null` trước khi gửi.
- Test thanh toán và mã giảm giá tự ký callback bằng khoá giả (`TESTTMN`/`testsecret`, `MOMO`/`testaccess`/`testmomosecret`): server phải chạy với cùng bộ khoá đó, database tên chứa `test`/`tmp`/`temp`.

### Soát vé (check-in)

- `POST /api/events/:id/check-in` `{ qrCode }`, trả `result`: `VALID` (200), `ALREADY_USED` (409, kèm `checkedInAt`), `NOT_FOUND` (404), `WRONG_EVENT` (409), `NOT_CONFIRMED` (409). `GET /api/events/:id/check-in/stats` đếm vé đã thanh toán và đã vào cổng.
- Được soát: ORGANIZER của chính sự kiện, ADMIN (`currentRole`), hoặc nhân viên được gán trong bảng `event_staff` (mọi role). **Kiểm tra quyền trước khi tra mã QR** để người ngoài không dò được mã nào tồn tại.
- Route soát vé không dùng `authorize(role)` vì nhân viên thường là CUSTOMER; quyền kiểm trong `loadEventForStaff`, đọc thẳng DB mỗi request nên gỡ nhân viên là mất quyền ngay.
- Nhân viên chỉ quét vé và xem thống kê của sự kiện được gán; mọi route sửa sự kiện, loại vé, mã giảm giá, nhân viên vẫn yêu cầu ORGANIZER chủ sự kiện hoặc ADMIN.
- Quản lý nhân viên: `GET/POST /api/events/:id/staff`, `DELETE /api/events/:id/staff/:userId`; nhân viên xem sự kiện được gán qua `GET /api/check-in/events`, `/auth/me` trả `isCheckInStaff`. Tối đa 20 người mỗi sự kiện: `POST` khoá dòng `events` bằng `FOR UPDATE` rồi mới đếm.
- **Chốt chặn quét trùng là `updateMany` có điều kiện `checkedInAt: null`**, ghi kèm `checkedInById`. Không đổi thành đọc rồi mới ghi. `test-checkin.cjs` bắn 20 request đồng thời cùng một mã và chỉ chấp nhận đúng 1 `VALID`.
- QR động có dạng `EH1.<ticketId>.<step>.<sig>`; HMAC-SHA256 dùng UTF-8 của `ticket.qrCode` làm khoá, lấy 16 byte đầu rồi base64url.
- Mỗi step dài 30 giây, nhận cửa sổ ±1 step theo đồng hồ server; `my-orders` trả `serverTime` để client bù lệch giờ.
- `dynamicQrOnly` mặc định false nhận cả mã tĩnh và động; true chỉ nhận mã động.
- Chữ ký đúng ngoài cửa sổ trả `QR_EXPIRED` (409); mã tĩnh đúng sự kiện chỉ nhận động trả `STATIC_QR_NOT_ALLOWED` (409). Chữ ký sai trả `NOT_FOUND`.

### Chuyển nhượng vé

- `POST /api/tickets/:id/transfer` `{ email }`: người giữ hiện tại là `holderId ?? order.userId`; người nhận phải có tài khoản đang hoạt động. Chỉ vé của đơn CONFIRMED, chưa check-in, sự kiện chưa bắt đầu. Vé không tồn tại và vé của người khác trả cùng 404.
- **Chốt chặn là `updateMany` có điều kiện `qrCode` + `holderId` vừa đọc + `checkedInAt: null`**, đổi người giữ và sinh `qrCode` mới cùng lúc; thua trả 409 `TICKET_CHANGED`. Mã cũ (tĩnh, động, email, ảnh chụp) chết ngay vì khoá QR động là `qrCode`.
- Check-in chiếm vé kèm điều kiện `qrCode` vừa tra, nên vé bị chuyển giữa lúc tra và lúc chiếm trả `NOT_FOUND`. `test-ticket-transfer.cjs` bắn chuyển và soát đồng thời, không bao giờ được cả hai cùng thắng.
- Mọi response trả `tickets` của đơn cho người mua phải che `qrCode` vé đã chuyển (`hideTransferredQr`, `MYOrders`); email vé và nhắc lịch chỉ liệt kê vé người mua còn giữ (`holderId: null`). Email báo người nhận không ghi mã vé.
- Giới hạn: người nhận chưa có email nhắc lịch; vé đã chuyển vẫn tính vào hạn mức mua của người mua.

### Phòng chờ ảo

- Cấp lượt bằng Lua nguyên khối, lấy giờ từ Redis TIME; không tách đọc/ghi thành lệnh JS vì có thể cấp quá giới hạn.
- Cửa trong `createOrder` trước Redlock yêu cầu ACTIVE còn hạn cho sự kiện bật phòng chờ; thiếu lượt trả 409 `QUEUE_REQUIRED`, lỗi Redis trả 503.
- Chỉ trả lượt sau khi transaction tạo đơn thành công; lỗi trả lượt chỉ log, không làm hỏng đơn đã tạo.
- Dùng `redisClient`, không dùng `cacheClient`; sự kiện tắt phòng chờ không truy cập Redis phòng chờ.

### Cache và Redis

- **Hai Redis client có chủ đích:** `redisClient` cho Redlock (kiên nhẫn chờ, thử lại) và `cacheClient` (lỗi nhanh, timeout 200 ms). Cache phải dùng `cacheClient`, và lỗi Redis không được làm hỏng request đọc. `REDIS_URL` (nếu có) được ưu tiên hơn `REDIS_HOST`/`REDIS_PORT`.
- Cache danh sách dùng version trong khoá: vô hiệu bằng `INCR`, không dùng `KEYS`. Mọi thao tác đổi số vé phải gọi `invalidateEventCache`.
- `GET /api/events` lọc theo `category`, `location` (chứa chuỗi), `from`/`to` (ngày giờ Việt Nam, `to` gồm hết ngày), `minPrice`/`maxPrice` (có ít nhất một loại vé trong khoảng). `parseEventFilters` chuẩn hoá và **bỏ qua giá trị sai thay vì trả 400**, giống `parsePagination`. **Khoá cache phải gồm mọi bộ lọc đã chuẩn hoá**: thêm bộ lọc mới thì thêm vào `listCacheKey`, nếu không người dùng sẽ nhận kết quả của bộ lọc khác.
- Danh mục là enum `EventCategory` (mặc định `OTHER`); thêm giá trị mới cần migration và nhãn tiếng Việt trong `client/src/utils/categories.ts`.
- `getUserState` cache role và trạng thái khoá trong 30 giây; đổi role hoặc khoá tài khoản phải gọi `invalidateUserState`.

### Xác thực và phân quyền

- `authenticate` gán `req.user.currentRole` từ database (qua cache). **Kiểm tra quyền bằng `currentRole`, không dùng `role` trong JWT** vì token sống 1 ngày.
- **Thu hồi token bằng `users.tokenVersion`:** JWT mang `tv` lúc cấp (thiếu thì coi là 0), `authenticate` trả 403 nếu `tv` khác `tokenVersion` trong `getUserState`. Đổi mật khẩu (`POST /api/auth/change-password`) tăng `tokenVersion` bằng `updateMany` có điều kiện số cũ, gọi `invalidateUserState` và trả token mới. Cấp token mới chỉ qua `signAccessToken` để luôn có `tv`. Message 403 này phải chứa chữ "token" để client coi là hết phiên.
- Sai mật khẩu hiện tại trả **400, không phải 401**: client coi mọi 401 là hết phiên và đăng xuất.
- Đổi quyền admin khoá các dòng admin bằng `FOR UPDATE`, đếm kết quả trong JS (không dùng `count()`), và chạy qua `runWithDeadlockRetry`.

### Email và token dùng một lần

- `MAIL_DRIVER=log` mặc định: ghi JSON vào `MAIL_OUTBOX_DIR` nếu có, nếu không chỉ log tiêu đề và người nhận. Thư mục outbox chứa token thật, không phục vụ public. `MAIL_DRIVER=brevo` cần `BREVO_API_KEY` và `MAIL_FROM` dạng `Tên <email>`; fetch timeout 10 giây, không thêm thư viện.
- `APP_PUBLIC_URL` là origin giao diện dùng dựng link (mặc định `http://localhost:5173`). Escape mọi giá trị chèn vào HTML email. `sendMail` ném lỗi; `sendMailSafe` chỉ log lỗi, không làm hỏng đăng ký hay yêu cầu quên mật khẩu.
- Hai bảng token chỉ lưu SHA-256, hạn reset 30 phút, xác minh 24 giờ. Chiếm token bằng `updateMany` có điều kiện chưa dùng/chưa hết hạn trong cùng transaction với cập nhật user. Reset tăng `tokenVersion`, vô hiệu mọi token reset còn lại và gọi `invalidateUserState` sau commit; không cấp JWT mới.
- Quên mật khẩu trả cùng thông báo cho email tồn tại/không tồn tại; giới hạn 5/15 phút riêng theo IP và email. Gửi lại xác minh cần đăng nhập, giới hạn 3/15 phút theo user. Chưa xác minh không bị chặn tính năng.
- `test-password-reset.cjs` cần server và script dùng chung `MAIL_OUTBOX_DIR`, driver `log`, database tạm; thêm trong `test:all`. Không chạy trên database thật.

### Email vé và nhắc lịch

- `confirmOrder` chỉ gửi email vé qua `sendTicketEmail` sau commit và khi CAS thực sự chuyển sang CONFIRMED; gửi nền, bắt mọi lỗi, không await và không gửi lại khi xác nhận lần hai.
- `sweepEventReminders` quét tối đa 100 đơn CONFIRMED chưa có `reminderSentAt`, sự kiện trong (now, now + 24h]. `startEventReminderJob` chạy cạnh job hết hạn, ngay lúc khởi động rồi mỗi `REMINDER_SWEEP_INTERVAL_MS` (mặc định 15 phút).
- Chống gửi nhắc trùng giữa các instance bằng `updateMany` có điều kiện `reminderSentAt: null` trước khi gửi. Đây là dấu chiếm: lỗi gửi hoặc tiến trình dừng sau khi chiếm sẽ không tự thử lại, tránh gửi trùng. Mỗi đơn bắt lỗi riêng, lượt quét nền cũng bắt lỗi.
- Nội dung HTML phải escape, thời gian dùng `Asia/Ho_Chi_Minh`, chỉ ghi mã vé và link `/my-orders`, không nhúng QR.
- `test-ticket-email.cjs` import job TypeScript qua ts-node, không cần route dev. Chỉ chạy với database tạm, server/script dùng chung `MAIL_OUTBOX_DIR`, `MAIL_DRIVER=log` và bật thanh toán giả lập.

### Bảng điều khiển bán vé

- `GET /api/organizer/dashboard?eventId=&days=7|30|90` (ORGANIZER/ADMIN, chỉ sự kiện của chính mình; `eventId` không phải của mình trả 404). Chỉ tính đơn `CONFIRMED`; doanh thu là `totalAmount` sau giảm giá.
- Ngày là ngày đặt đơn theo giờ Việt Nam, gom bằng `DATE_ADD(createdAt, INTERVAL 7 HOUR)` trong SQL (chạy được cả TiDB, không cần bảng múi giờ). Ngày không bán vẫn trả về với số 0.
- Doanh thu theo loại vé chia đều tổng tiền đơn cho từng vé (`COUNT(*) OVER (PARTITION BY orderId)`): đúng khi mỗi đơn một loại vé. **Làm "mua nhiều loại vé một đơn" thì phải xem lại cách chia này.**
- Trả thêm `period` (kỳ hiện tại và kỳ liền trước cùng độ dài, dùng cho % tăng giảm ở ô số) và `byCategory` (doanh thu theo danh mục, toàn thời gian); sự kiện, loại vé, dòng soát vé có `category`.
- Biểu đồ tự vẽ bằng SVG (`RevenueChart.vue`, `CategoryDonut.vue`, sparkline trong `StatTile.vue`), không thêm thư viện; một chuỗi số liệu màu `chart-1`, theo danh mục dùng tông danh mục, không dùng `brand`. Có tooltip chuột/phím mũi tên và bảng số liệu trong `<details>`.

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

### Skill UI/UX (`ui-ux-pro-max`)

- `.claude/skills/ui-ux-pro-max/` là skill bên ngoài (MIT, nextlevelbuilder/ui-ux-pro-max-skill, ghim commit `2de1134`, đã bỏ thư mục test). Claude Code tự nạp; AI khác đọc `SKILL.md` và `references/` nếu cần. Không sửa tay file trong đó; nâng cấp thì chép lại bản mới và soát lại script.
- Chạy từ gốc repo: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<truy vấn>" --domain ux` (hoặc `--design-system`, `--stack vue`, `--stack shadcn`). `SKILL.md` ghi đường dẫn theo `${CLAUDE_PLUGIN_ROOT}` của bản plugin; ở repo này bỏ phần đó. Script chỉ dùng thư viện chuẩn Python, không gọi mạng.
- Kết quả của skill là gợi ý, **`DESIGN.md` và token trong `style.css` luôn thắng**. Kiểm lại trước khi dùng: font phải có dấu tiếng Việt (skill từng gợi ý Righteous, Poppins không có), màu chữ trên nút phải đạt tương phản 4.5:1.
- Không dùng `--persist` ghi `design-system/` vào repo nếu chưa được chủ dự án đồng ý.

### Client

- **Sửa giao diện phải theo `DESIGN.md`:** chỉ dùng class theo token (`bg-primary`, `text-muted-foreground`, `border-border`, `text-brand`...), không viết class màu thô của Tailwind (`indigo-*`, `gray-*`...) hay mã hex trong component. Hệ "Cuống vé": nền than tối, vé giấy `.paper` cho thẻ sự kiện/khung chọn vé/vé của tôi; màu cam `brand` chỉ cho nút mua hàng, giá vé và khan hiếm (trên giấy `text-brand` tự thành đỏ mộc).
- **`api/axios.ts` nhận diện loại lỗi 403 bằng regex trên message tiếng Việt** ("token", "bị khoá", "không có quyền"). Đổi các thông báo này ở `auth.middleware.ts` thì phải sửa cả regex.
- `api/session.ts` là kênh callback giữa axios và `main.ts`, tránh vòng import với router.
- `token` lưu ở `localStorage`, `user` chỉ nằm trong RAM. Router guard của route cần role phải chờ `authStore.ensureProfile()`.
- Prisma `Decimal` được serialize thành chuỗi, phải chuyển sang số trước khi tính toán.
- `confirmOrder`/`cancelOrder` chỉ trả `tickets` trần, nên store ghép lại `ticketType` cũ theo ticket id.
- Trang soát vé (`/my-events/:id/check-in`) quét QR bằng `vue-qrcode-reader`. Camera chỉ chạy trên HTTPS hoặc localhost; luôn giữ ô nhập mã tay dự phòng. File WASM của bộ giải mã được tự phục vụ qua `setZXingModuleOverrides` (mặc định nó tải từ CDN), và CSP ở `app.ts` cần `'wasm-unsafe-eval'` trong `script-src`.

## Deploy

Bảng đầy đủ các môi trường ở `deploy/ENVIRONMENTS.md`, các bước deploy ở `deploy/cloud/README.md`.

- **Production demo: Render free + TiDB Cloud Starter + Render Key Value.** Một image từ `Dockerfile` ở gốc: Node phục vụ cả build Vue (`SERVE_CLIENT_DIR`) và `/api`, chạy `prisma migrate deploy` khi khởi động. Cấu hình trong `render.yaml` (Blueprint, Singapore), tự deploy khi push `main`.
- Giữ **một web service duy nhất** (750 giờ miễn phí mỗi tháng) và image `linux/amd64`.
- Render ngủ sau 15 phút không có request: UptimeRobot gọi `/api/health` mỗi 5 phút và báo email khi web chết; `.github/workflows/keepalive.yml` chỉ là dự phòng vì lịch của GitHub Actions hay chạy trễ hàng giờ.
- `main` có branch protection: phải qua PR và ba check CI xanh (Server, Client, E2E). Đổi tên job trong `ci.yml` thì sửa cả tên check bắt buộc.
- **TiDB có thể tắt `CHECK` constraint**, nên lớp chống bán quá số vé ở database có thể không có tác dụng. Chạy test trên TiDB trước khi khẳng định.
- Backup và khôi phục: `deploy/cloud/backup-db.sh`, `deploy/cloud/restore-db.sh`. Chúng đọc `server/.env.render.local` mà không `source` file đó.
- `deploy/*.sh`, `deploy/Caddyfile`, `deploy/docker-compose.deploy.yml` và `.github/workflows/deploy.yml` thuộc hướng VPS ARM64 trước đây, **không dùng cho Render**; `deploy.yml` chỉ chạy khi bấm tay.
