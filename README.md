# Event Hub 🎟️

Hệ thống bán vé sự kiện full-stack, tập trung vào bài toán khó nhất của lĩnh vực này: **không bán quá số vé khi nhiều người cùng mua một lúc**.

> **Trạng thái:** dự án học tập, chưa sẵn sàng cho production. Thanh toán hiện là **giả lập** và mặc định tắt ở production; giao diện đã có nút thanh toán giả lập, huỷ đơn và xem mã QR. Xem [Giới hạn hiện tại](#giới-hạn-hiện-tại).

## Tính năng

**Khách hàng**
- Đăng ký, đăng nhập bằng JWT
- Xem và tìm kiếm sự kiện có phân trang
- Đặt vé, giữ chỗ 10 phút, xem lại đơn của mình (có đếm ngược)
- Thanh toán giả lập, huỷ đơn đang giữ chỗ, xem mã QR của từng vé

**Nhà tổ chức**
- Tạo, sửa, xoá sự kiện với nhiều loại vé
- Tải ảnh banner lên (kéo thả, xem trước; JPG/PNG/WEBP tối đa 5MB) hoặc dán URL ảnh
- Xem thống kê sự kiện của mình

**Quản trị viên**
- Xem tổng quan hệ thống
- Đổi vai trò, khoá và mở khoá tài khoản, có hiệu lực ở request kế tiếp
- Xem nhật ký thao tác quản trị

## Điểm kỹ thuật chính

| Bài toán | Cách giải quyết | Mã nguồn |
|---|---|---|
| Bán quá số vé | `UPDATE` có điều kiện trong transaction, Redlock, và `CHECK` ở database | `server/src/controllers/order.controller.ts` |
| Đơn hết hạn | Job nền trả vé trong transaction, an toàn khi chạy nhiều instance | `server/src/jobs/expireOrders.job.ts` |
| Vòng đời đơn | `updateMany` có điều kiện khi confirm/cancel, hạn mức theo tài khoản, mã QR từng vé | `server/src/controllers/order.controller.ts` |
| Tải đọc cao | Cache có version, single-flight, tự chuyển sang database khi Redis lỗi | `server/src/utils/cache.ts` |
| Thu hồi quyền | Đọc role từ database (cache 30 giây, xoá ngay khi đổi quyền), không tin role trong JWT | `server/src/middlewares/auth.middleware.ts` |
| Mất admin cuối cùng | `SELECT ... FOR UPDATE` trong transaction | `server/src/controllers/admin.controller.ts` |

Phân tích chi tiết và các bug đã gặp nằm trong [`PROJECT_NOTES.md`](PROJECT_NOTES.md).

## Công nghệ

| Tầng | Công nghệ |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Pinia, Vue Router, Tailwind CSS, Axios |
| Backend | Node.js, Express, TypeScript, Prisma, Zod, JWT |
| Dữ liệu | MySQL 8, Redis 7 (cache và Redlock) |
| Hạ tầng | Docker Compose cho dev; Dockerfile multi-stage và GitHub Actions cho CI |

## Cấu trúc thư mục

```
event-hub/
├── client/                 # Ứng dụng Vue (Dockerfile, nginx.conf)
│   └── src/
│       ├── api/            # Axios client, xử lý phiên đăng nhập
│       ├── components/
│       ├── router/
│       ├── stores/         # Pinia
│       └── views/
├── server/                 # API Express (Dockerfile)
│   ├── prisma/             # Schema, migration, seed
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── jobs/           # Job trả vé của đơn hết hạn
│   │   ├── middlewares/
│   │   ├── routes/
│   │   └── utils/
│   ├── test-*.cjs          # Test tích hợp, cần server đang chạy
│   └── load-test*.js       # Load test bằng k6
├── docker-compose.yml      # MySQL và Redis cho môi trường dev
├── docker-compose.prod.yml # MySQL, Redis, migrate, API và client nginx
└── .github/workflows/ci.yml
```

## Cài đặt

Yêu cầu: Node.js 20.19+ hoặc 22.12+, Docker.

**1. Bật MySQL và Redis**

```bash
docker compose up -d
```

**2. Chạy server** (`http://localhost:5000`)

```bash
cd server
cp .env.example .env
```

Sửa `.env`:
- `DATABASE_URL="mysql://root:root@127.0.0.1:3306/eventhub"`
- `JWT_SECRET`: sinh bằng lệnh bên dưới. Server từ chối khởi động nếu thiếu hoặc dưới 32 ký tự.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npm install
npx prisma migrate deploy
npm run seed
npm run dev
```

`npm run seed` tạo tài khoản admin và in thông tin đăng nhập ra màn hình. Đặt `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` nếu muốn đổi.

**3. Chạy client** (`http://localhost:5173`, ở terminal khác)

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Client mặc định gọi `http://localhost:5000/api`. Đặt `VITE_API_BASE_URL` trong `client/.env` nếu server chạy ở địa chỉ khác.

## Test

Các script test là test tích hợp, gọi API thật và **ghi vào database**. Chỉ chạy trên database dev, không chạy trên dữ liệu thật.

```bash
cd server
npm run dev        # terminal 1
npm run test:all   # terminal 2
```

Server chạy ở cổng khác thì đặt `BASE_URL`, ví dụ `BASE_URL=http://localhost:5055/api npm run test:all`.

`npm run test:all` chạy 10 bộ test tích hợp. GitHub Actions chạy lại toàn bộ trên mỗi pull request; client mới chỉ được build, chưa có test tự động.

## Chạy bằng Docker (production)

Triển khai máy nhà Ubuntu x86_64 qua Cloudflare Quick Tunnel: [hướng dẫn từng bước](deploy/home/README.md).

`docker-compose.prod.yml` build image cho server và client, chạy migration một lần rồi mới khởi động API. MySQL và Redis không publish ra host; client phục vụ bằng nginx và chuyển `/api` sang server.

```bash
MYSQL_ROOT_PASSWORD=<mật-khẩu-mạnh> \
JWT_SECRET=<chuỗi-ngẫu-nhiên-ít-nhất-32-ký-tự> \
docker compose -f docker-compose.prod.yml up --build
```

Client ở `http://localhost:8081`, health check ở `http://localhost:8081/api/health`. Đổi cổng bằng `WEB_PORT`. Ảnh banner nằm trong volume `uploads_data`, nên build lại container không mất ảnh. File compose không chứa secret; hai biến trên là bắt buộc.

## Dữ liệu demo

Để chạy app trong buổi demo, hãy tạo dữ liệu mẫu sẵn sàng:

```bash
cd server
npm run seed:demo
```

Script tạo 3 tài khoản demo, 12 sự kiện và một số đơn hàng đã thanh toán. Chạy lại được (an toàn trên database dev), mỗi lần sẽ đặt lại sự kiện của 2 organizer demo.

```bash
npm run seed:demo -- --purge-test --yes
```

Cờ `--purge-test` là chế độ riêng, chỉ dọn dữ liệu test cũ rồi thoát (không seed), nên chạy nó trước rồi mới `npm run seed:demo`. Nó xoá: sự kiện có tiêu đề bắt đầu bằng `E2E `, `DIAG `, `UI Check `, `Final Review `, `Tong tien vua cham bien`, `Gia toi bien`, `LIFECYCLE`, `UPLOAD TEST`, `Live Concert 17`, `Đêm nhạc Trịnh 17`, `test1` (kèm đơn hàng, vé đang giữ của sự kiện khác được trả về kho), và tài khoản email kết thúc `@test.local` (trừ khi họ đang organizer sự kiện còn lại). Chỉ dùng trên database dev, bị từ chối khi `NODE_ENV=production`. Chạy không có `--yes` chỉ in danh sách sẽ xóa.

Tài khoản demo (mật khẩu mặc định `demo12345`, tuỳ chỉnh qua `SEED_DEMO_PASSWORD`):
- `organizer@eventhub.demo` – ORGANIZER, "Saigon Live Events"
- `organizer2@eventhub.demo` – ORGANIZER, "Hanoi Creative Hub"
- `khach@eventhub.demo` – CUSTOMER, "Nguyễn Minh Anh"

## Giới hạn hiện tại

- Thanh toán mới là giả lập; chưa tích hợp VNPay/MoMo, chưa soát vé bằng QR và chưa huỷ được đơn đã thanh toán (không hoàn tiền).
- Chưa có xác thực email, đặt lại mật khẩu và refresh token.
- Hạn mức 100 vé mỗi sự kiện cho mỗi tài khoản (`MAX_TICKETS_PER_USER_PER_EVENT`), nên vẫn lách được bằng nhiều tài khoản.
- Rate limit lưu trong RAM, chưa dùng chung được khi chạy nhiều instance. Đã hỗ trợ `TRUST_PROXY` khi chạy sau reverse proxy.
- Client chưa có test tự động; CI mới build client.
- Ảnh banner lưu trên đĩa của server: chưa dọn ảnh không còn sự kiện nào dùng, và chưa chạy được nhiều instance server (cần chuyển sang S3/MinIO, chỉ phải sửa `server/src/utils/storage.ts`).

## Giấy phép

[MIT](LICENSE)
