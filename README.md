# Event Hub 🎟️

Hệ thống bán vé sự kiện full-stack, tập trung vào bài toán khó nhất của lĩnh vực này: **không bán quá số vé khi nhiều người cùng mua một lúc**.

> **Trạng thái:** dự án học tập, chưa sẵn sàng cho production. Thanh toán hiện là **giả lập** và mặc định tắt ở production; giao diện thanh toán đang được làm. Xem [Giới hạn hiện tại](#giới-hạn-hiện-tại).

## Tính năng

**Khách hàng**
- Đăng ký, đăng nhập bằng JWT
- Xem và tìm kiếm sự kiện có phân trang
- Đặt vé, giữ chỗ 10 phút, xem lại đơn của mình
- API thanh toán giả lập, huỷ đơn và sinh mã QR cho từng vé (giao diện đang làm)

**Nhà tổ chức**
- Tạo, sửa, xoá sự kiện với nhiều loại vé
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
| Hạ tầng dev | Docker Compose (chỉ MySQL và Redis) |

## Cấu trúc thư mục

```
event-hub/
├── client/                 # Ứng dụng Vue
│   └── src/
│       ├── api/            # Axios client, xử lý phiên đăng nhập
│       ├── components/
│       ├── router/
│       ├── stores/         # Pinia
│       └── views/
├── server/                 # API Express
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
└── docker-compose.yml      # MySQL và Redis cho môi trường dev
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

Dự án chưa có CI và client chưa có test tự động.

## Giới hạn hiện tại

- Thanh toán mới là giả lập, chưa soát vé bằng QR và chưa huỷ được đơn đã thanh toán.
- Chưa có xác thực email, đặt lại mật khẩu và refresh token.
- Hạn mức vé tính theo tài khoản (mặc định 100 vé mỗi sự kiện), nên vẫn lách được bằng nhiều tài khoản.
- Rate limit lưu trong RAM, chưa dùng chung được khi chạy nhiều instance.
- Chưa có Dockerfile và cấu hình triển khai production.

## Giấy phép

[MIT](LICENSE)
