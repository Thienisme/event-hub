# Event Hub 🎟️

Hệ thống bán vé sự kiện full-stack, tập trung vào bài toán khó nhất của lĩnh vực này: **không bán quá số vé khi nhiều người cùng mua một lúc**.

**Demo:** https://eventhub-v3xy.onrender.com · tài khoản thử ở mục [Dữ liệu demo](#dữ-liệu-demo).

> **Trạng thái:** dự án học tập. Thanh toán VNPay/MoMo chạy ở chế độ **sandbox**, demo còn bật thêm nút thanh toán giả lập. Xem [Giới hạn hiện tại](#giới-hạn-hiện-tại).

## Tính năng

**Khách hàng**
- Đăng ký, đăng nhập JWT; xác minh email, quên và đặt lại mật khẩu qua email
- Trang hồ sơ: đổi tên, ảnh đại diện, đổi mật khẩu (mọi phiên đăng nhập cũ bị đăng xuất ngay)
- Khám phá sự kiện: mục nổi bật, tìm kiếm, lọc theo danh mục, thành phố, khoảng ngày, khoảng giá; bộ lọc nằm trên URL nên chia sẻ được
- Trang sự kiện có link dạng chữ (slug), ảnh xem trước khi chia sẻ, thêm vào lịch, thời gian mở bán
- Đặt vé giữ chỗ 10 phút, trang thanh toán riêng có đồng hồ đếm ngược
- Thanh toán **VNPay, MoMo** (sandbox) hoặc giả lập; áp **mã giảm giá**
- Email vé sau khi thanh toán, email nhắc lịch trước sự kiện 24 giờ
- Hết vé thì vào **danh sách chờ**, có vé trả về thì được báo email
- "Vé của tôi": mã QR từng vé, trạng thái đã check-in

**Nhà tổ chức**
- Tạo, sửa, xoá sự kiện nhiều loại vé, chọn danh mục, tải banner (kéo thả, ảnh được làm sạch và nén WEBP)
- Tạo mã giảm giá (phần trăm hoặc số tiền, giới hạn lượt, công khai hoặc ẩn)
- **Soát vé ở cổng bằng camera quét QR** (có ô nhập mã tay dự phòng), thống kê số người đã vào
- Thống kê doanh thu và số vé đã bán của sự kiện mình

**Quản trị viên**
- Tổng quan hệ thống, danh sách sự kiện
- Đổi vai trò, khoá và mở khoá tài khoản, có hiệu lực ở request kế tiếp
- Nhật ký thao tác quản trị

## Điểm kỹ thuật chính

Mỗi chốt chặn dưới đây có bộ test tích hợp riêng; nhiều bộ đã được kiểm chứng bằng cách tạm gỡ chốt chặn để chắc test bắt được lỗi.

| Bài toán | Cách giải quyết | Mã nguồn |
|---|---|---|
| Bán quá số vé khi nhiều người mua cùng lúc | `UPDATE` có điều kiện trong transaction, Redlock bên ngoài, `CHECK` ở database | `server/src/controllers/order.controller.ts` |
| Vòng đời đơn (xác nhận, huỷ, hết hạn, thanh toán) | Mỗi đường đổi trạng thái là `updateMany` có điều kiện, nên chỉ một đường thắng; job hết hạn trả vé trong transaction | `server/src/controllers/order.controller.ts`, `server/src/jobs/expireOrders.job.ts` |
| Thanh toán bị gọi lại nhiều lần hoặc giả mạo | Khoá dòng thanh toán `FOR UPDATE`, so số tiền với lúc tạo, kiểm chữ ký bằng `timingSafeEqual`; tiền về khi đơn đã huỷ thì đánh dấu cần hoàn tiền | `server/src/payments/`, [`docs/PAYMENTS.md`](docs/PAYMENTS.md) |
| Mã giảm giá bị dùng vượt lượt | Chiếm lượt bằng `UPDATE` có điều kiện, trả lượt trong cùng transaction khi huỷ hoặc hết hạn | `server/src/utils/orderInventory.ts` |
| Một vé bị quét hai lần ở cổng | `updateMany` có điều kiện "chưa check-in"; 20 lượt quét đồng thời chỉ 1 lượt hợp lệ | `server/src/controllers/checkin.controller.ts` |
| Token cũ còn dùng được sau khi đổi mật khẩu | `tokenVersion` trong JWT, thu hồi mọi phiên ngay | `server/src/middlewares/auth.middleware.ts` |
| Quyền cũ nằm trong token sau khi bị hạ quyền | Đọc role từ database (cache 30 giây, xoá ngay khi đổi quyền), không tin role trong JWT | `server/src/utils/userState.ts` |
| Mất admin cuối cùng | `SELECT ... FOR UPDATE` các dòng admin trong transaction, thử lại khi deadlock | `server/src/controllers/admin.controller.ts` |
| Tải đọc cao | Cache Redis có version (khoá gồm mọi bộ lọc), single-flight, Redis lỗi thì đọc thẳng database | `server/src/utils/cache.ts` |
| Ảnh tải lên độc hại | Nhận diện bằng magic bytes, giải mã và encode lại, bỏ metadata, chống pixel bomb | `server/src/utils/storage.ts` |
| Email gửi trùng khi chạy nhiều instance | Chiếm lượt gửi bằng `updateMany` có điều kiện trước khi gửi | `server/src/jobs/eventReminder.job.ts`, `server/src/utils/waitlistNotify.ts` |

Phân tích chi tiết và các bug đã gặp nằm trong [`PROJECT_NOTES.md`](PROJECT_NOTES.md).

## Công nghệ

| Tầng | Công nghệ |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Pinia, Vue Router, Tailwind CSS, Axios |
| Backend | Node.js, Express, TypeScript, Prisma, Zod, JWT |
| Dữ liệu | MySQL 8, Redis 7 (cache và Redlock) |
| Thanh toán, email | VNPay, MoMo (sandbox), Brevo |
| Hạ tầng | Docker Compose cho dev; Dockerfile multi-stage; GitHub Actions (CI); Render + TiDB Cloud (production); UptimeRobot (giám sát) |

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
│   │   ├── jobs/           # Trả vé đơn hết hạn, email nhắc lịch
│   │   ├── middlewares/
│   │   ├── payments/       # VNPay, MoMo, xác nhận đơn sau khi trả tiền
│   │   ├── routes/
│   │   └── utils/
│   ├── test-*.cjs          # Test tích hợp, cần server đang chạy
│   └── load-test*.js       # Load test bằng k6
├── docs/                   # Thanh toán, lộ trình, sổ tay DevOps
├── deploy/                 # Render + TiDB, backup và khôi phục
├── docker-compose.yml      # MySQL và Redis cho môi trường dev
├── docker-compose.prod.yml # MySQL, Redis, migrate, API và client nginx
└── .github/workflows/      # ci.yml, keepalive.yml, deploy.yml (VPS cũ)
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

`npm run test:all` chạy 20 bộ test tích hợp (đặt vé, thanh toán, mã giảm giá, soát vé, bảo mật JWT, tranh chấp quyền admin...). Server dùng để test nên chạy với `API_RATE_LIMIT_MAX=100000`, nếu không script phải chờ rate limit giữa các bộ.

GitHub Actions chạy toàn bộ trên mỗi pull request với MySQL và Redis thật (khoảng 3,5 phút). `main` có branch protection: CI chưa xanh thì không merge được, và merge vào `main` thì Render tự deploy. Client mới chỉ được build, chưa có test tự động.

## Chạy bằng Docker (production)

**Demo đang chạy:** https://eventhub-v3xy.onrender.com (Render + TiDB Cloud, miễn phí). Hướng dẫn deploy: [deploy/cloud/README.md](deploy/cloud/README.md); bảng tổng hợp môi trường, biến và bí mật: [deploy/ENVIRONMENTS.md](deploy/ENVIRONMENTS.md). Phương án VPS (Oracle ARM64, Caddy HTTPS): [deploy/README.md](deploy/README.md). Sổ tay học CI/CD và các sự cố đã gặp: [docs/DEVOPS-HOC-TAP.md](docs/DEVOPS-HOC-TAP.md).

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

- VNPay và MoMo mới chạy sandbox; đơn đã thanh toán chưa huỷ được, tiền về sau khi đơn hết hạn chỉ được đánh dấu cần hoàn tiền (chưa có luồng hoàn tiền).
- Mỗi đơn chỉ một loại vé; chưa chọn ghế, chưa chuyển nhượng vé.
- Chưa có refresh token: phiên đăng nhập là JWT sống 1 ngày.
- Hạn mức 100 vé mỗi sự kiện cho mỗi tài khoản (`MAX_TICKETS_PER_USER_PER_EVENT`), vẫn lách được bằng nhiều tài khoản.
- Rate limit lưu trong RAM, chưa dùng chung được khi chạy nhiều instance. Đã hỗ trợ `TRUST_PROXY` khi chạy sau reverse proxy.
- TiDB có thể tắt `CHECK` constraint, nên trên production lớp chống bán quá vé ở database có thể không có tác dụng (chốt chặn chính ở code vẫn còn).
- Render free ngủ khi không có truy cập; UptimeRobot giữ thức nhưng không bảo đảm uptime.
- Client chưa có test tự động.

Các việc tiếp theo nằm trong [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Giấy phép

[MIT](LICENSE)
