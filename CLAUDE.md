# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hệ thống bán vé sự kiện: `client/` (Vue 3, Pinia, Tailwind) và `server/` (Express 4, Prisma 5, MySQL 8, Redis 7). Hai package độc lập, không có workspace, cài dependency riêng trong từng thư mục. Comment trong code và thông báo API đều bằng tiếng Việt, nên giữ nguyên ngôn ngữ này.

## Lệnh

```bash
docker compose up -d                 # chỉ bật MySQL và Redis; server và client chạy local

# server/ (mặc định http://localhost:5000, cần .env với DATABASE_URL và JWT_SECRET >= 32 ký tự)
npm run dev                          # ts-node-dev, tự reload
npm run build                        # tsc; dùng `npx tsc --noEmit` để chỉ kiểm tra kiểu
npx prisma migrate deploy            # áp dụng migration
npx prisma migrate dev --name <ten>  # tạo migration mới (kèm DROP DEFAULT của actorEmail do schema đang lệch)
npm run seed                         # tạo hoặc đặt lại admin@test.com

# client/ (http://localhost:5173)
npm run dev
npm run build                        # vue-tsc rồi vite build
```

Dự án không có linter, CI, script `start` hay test cho client.

### Test

Test nằm ở gốc `server/` (`test-*.cjs`), là script Node tự viết chứ không dùng test framework. Chúng gọi API thật và truy cập trực tiếp database, nên cần server, MySQL và Redis đang chạy.

```bash
npm run test:all                     # tất cả bộ test, chạy tuần tự
node test-regressions.cjs            # một bộ; không lọc được từng case
BASE_URL=http://localhost:5055/api npm run test:all   # server ở cổng khác
```

- **Script test ghi vào database mà `DATABASE_URL` trỏ tới và không kiểm tra đó là database nào.** `test-admin-race.cjs` tạm hạ quyền toàn bộ admin. Không chạy trên dữ liệu thật. Biến môi trường đã đặt sẵn sẽ được ưu tiên hơn `.env`, nên có thể trỏ sang database tạm.
- Rate limit theo IP nằm trong RAM server (100 request/phút, 30 request admin/phút, 5 lần đăng nhập sai/phút) và áp dụng cả cho test. Chạy lặp liên tục sẽ nhận 429, thường biểu hiện thành lỗi đăng nhập hoặc lỗi parse JSON, không phải bug. Hãy chờ khoảng 1 phút hoặc khởi động lại server.
- Bộ test mới cần thêm vào `SUITES` trong `run-all-tests.cjs` và `scripts` trong `package.json`.
- `load-test*.js` chạy bằng k6. `oversell-*.cjs` là kịch bản tái hiện tranh chấp vé, không nằm trong `test:all`, và cần có sẵn ít nhất một sự kiện trong database.

## Kiến trúc

Luồng request ở server: `routes/` gắn middleware theo thứ tự `authenticate` → `authorize` hoặc rate limiter → `validateBody(schema)` → controller. Không có tầng service, logic nghiệp vụ nằm trong controller.

### Đặt vé và tồn kho

`availableQuantity` là số vé còn lại; số đã "bán" được tính bằng `totalQuantity - availableQuantity`, nên đã gồm cả vé đang giữ chỗ.

- **Chốt chặn chống bán quá số vé là `updateMany` có điều kiện `availableQuantity >= quantity`** trong `createOrder`, cùng `CHECK` ở database. Redlock chỉ là lớp bên ngoài. Không đổi thành kiểu đọc rồi mới ghi.
- Vòng đời đơn: `createOrder` tạo `PENDING`, `jobs/expireOrders.job.ts` chuyển sang `EXPIRED` và trả vé về kho sau `ORDER_HOLD_MINUTES`. Chưa có code nào tạo `CONFIRMED` hoặc `CANCELLED`, và `qrCode` chưa được sinh.
- Đơn `EXPIRED` vẫn giữ dòng `Ticket` để hiển thị lịch sử, mà `tickets -> ticket_types` là FK `RESTRICT`. Vì vậy xoá sự kiện hoặc loại vé phải xoá đơn `EXPIRED` liên quan trong cùng transaction (`deleteExpiredOrdersOf` trong `event.controller.ts`).
- `updateEvent` đối chiếu loại vé theo `id` và dùng `increment` theo chênh lệch. `ticketTypes` là `undefined` nghĩa là không đụng tới, còn `[]` nghĩa là xoá hết các loại chưa bán. POST và PUT dùng chung `createEventSchema`.
- MySQL từ chối `deleteMany` có điều kiện quan hệ (lỗi 1093): hãy tìm id trước rồi xoá theo id.

### Cache và Redis (`config/redis.ts`, `utils/cache.ts`)

- Có **hai Redis client có chủ đích**: `redisClient` cho Redlock (kiên nhẫn chờ, thử lại) và `cacheClient` (lỗi nhanh, timeout 200 ms). Cache phải dùng `cacheClient`, và lỗi Redis không được làm hỏng request đọc.
- Cache danh sách dùng version trong khoá: vô hiệu bằng `INCR`, không dùng `KEYS`. Mọi thao tác đổi số vé phải gọi `invalidateEventCache`.
- `getUserState` cache role và trạng thái khoá trong 30 giây; thay đổi role hoặc trạng thái khoá phải gọi `invalidateUserState`.

### Xác thực và phân quyền

- `authenticate` gán `req.user.currentRole` từ database (qua cache). **Khi kiểm tra quyền phải dùng `currentRole`, không dùng `role` trong JWT**, vì token sống 1 ngày và có thể đã cũ.
- Thao tác đổi quyền của admin khoá các dòng admin bằng `FOR UPDATE`, đếm kết quả trong JS (không dùng `count()`), và chạy qua `runWithDeadlockRetry`.

### Xử lý lỗi

- Controller bọc `try/catch` và gọi `handleControllerError`. **Handler async bắt buộc phải tự bắt lỗi:** Express 4 không bắt được promise bị reject và tiến trình Node sẽ thoát.
- Chỉ message của `AppError` được trả nguyên văn cho client. Lỗi Prisma đã biết được `mapPrismaError` chuyển thành 400 hoặc 409.
- `app.ts` phải giữ `import 'dotenv/config'` ở dòng import đầu tiên, vì nhiều module đọc `process.env` ngay khi được nạp.

### Validation

Giới hạn trong `LIMITS` (`utils/validation.ts`) phải khớp với độ dài cột trong `schema.prisma`; đổi một bên thì đổi cả bên kia. `CHECK` constraint không biểu diễn được trong Prisma schema, nên phải viết tay trong migration SQL.

### Client

- **`api/axios.ts` nhận diện loại lỗi 403 bằng regex trên message tiếng Việt của server** ("token", "bị khoá", "không có quyền"). Đổi các thông báo này ở `auth.middleware.ts` thì phải sửa cả regex.
- `api/session.ts` là kênh callback giữa axios và `main.ts`, dùng để tránh vòng import với router.
- `token` lưu ở `localStorage`, còn `user` chỉ nằm trong RAM. Router guard của route cần role phải chờ `authStore.ensureProfile()`.
- Prisma `Decimal` được serialize thành chuỗi trong JSON, nên phải chuyển sang số trước khi tính toán hoặc định dạng.

## Tài liệu

`PROJECT_NOTES.md` giải thích lý do thiết kế và các bug đã gặp, `TRICK.md` là tài liệu ôn phỏng vấn. Cả hai có thể đã lệch so với code, kể cả số dòng được trích dẫn, nên hãy lấy code làm chuẩn.
