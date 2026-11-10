# Deploy Event Hub miễn phí lên cloud

Hướng dẫn dành cho bản demo: một web service Docker, một Render Key Value và TiDB Cloud Starter. Không dùng Docker Compose trên Render.

```text
Người xem --HTTPS--> Render Singapore (Node: Vue + /api)
                         |                |
                         | TLS/MySQL      | Redis nội bộ
                         v                v
                    TiDB Starter     Render Key Value
                    dữ liệu + ảnh    cache + khoá Redlock
GitHub Actions --mỗi 10 phút--> Render /api/health
```

## Hiểu các khái niệm trước khi bấm

- **PaaS**: nhà cung cấp chạy container, cấp URL HTTPS và quản lý máy chủ cho bạn.
- **Blueprint / Infrastructure as Code**: `render.yaml` mô tả dịch vụ bằng mã; Render đọc file để tạo hạ tầng có thể lặp lại.
- **Biến môi trường**: cấu hình truyền vào ứng dụng khi chạy. Secret như mật khẩu DB, JWT phải nhập trên dashboard; không đưa vào Git hay chat.
- **TLS**: mã hoá và xác minh kết nối database; Prisma dùng `sslaccept=strict` cho TiDB.
- **Ngủ / cold start**: Render free ngủ sau 15 phút không có truy cập; request kế tiếp phải đợi container thức dậy. Keepalive giúp giảm tình trạng này, không bảo đảm uptime.
- **Ảnh trong database**: ổ đĩa tạm của Render free có thể bị xoá khi deploy, khởi động lại hoặc ngủ. `STORAGE_DRIVER=db` giữ ảnh cùng dữ liệu trong TiDB.

## Điều kiện mã nguồn trước khi triển khai

Task cấu hình này chỉ tạo ba file. Trước khi Apply Blueprint, cần tích hợp phần ứng dụng của task song song vào `main`: **Dockerfile ở gốc repo**, image duy nhất build Vue vào `/app/public`, Node phục vụ giao diện cùng `/api`, đọc `REDIS_URL`, hỗ trợ ảnh trong DB và health `GET /api/health`. Trong snapshot khi viết hướng dẫn, Dockerfile gốc chưa có; chỉ có Dockerfile riêng trong `client/` và `server/`.

Container phải tự chạy `npx prisma migrate deploy` rồi mới `node dist/app.js`; migration lỗi phải chặn server khởi động. Render free không có pre-deploy command. Image cần có Prisma CLI và công cụ chạy `npm run seed:demo` nếu muốn seed trong container. Không tự tạo Dockerfile hoặc sửa code theo tài liệu này.

## Bước 1 — Tạo TiDB Cloud Starter

1. Mở [TiDB Cloud](https://tidbcloud.com/), chọn đăng ký/đăng nhập bằng GitHub.
2. Trong dashboard, chọn tạo cluster mới, gói **Starter (free)**, region **Singapore**, rồi chờ cluster sẵn sàng. Kiểm tra vẫn là gói miễn phí trước khi xác nhận.
3. Mở cluster, vào **SQL Editor**, chạy:
   ```sql
   CREATE DATABASE IF NOT EXISTS eventhub;
   ```
4. Bấm **Connect**, chọn **Connect with: Prisma** hoặc **General** (tên màn hình có thể thay đổi). Đặt mật khẩu nếu được yêu cầu và lưu vào trình quản lý mật khẩu ngay; mật khẩu có thể chỉ hiện một lần.
5. Lấy URL kết nối, đổi database thành `eventhub`, giữ port `4000` và bật TLS:
   ```text
   mysql://USER:PASS@HOST:4000/eventhub?sslaccept=strict
   ```
   Thay các phần viết hoa bằng giá trị thật. Mật khẩu có ký tự đặc biệt như `@`, `:`, `#`, `%` cần được URL-encode. Nếu URL đã có query, nối `&sslaccept=strict` thay vì thêm dấu `?` thứ hai; không lặp tham số.
6. Nếu Connect yêu cầu cấu hình network access, cho phép IP máy local khi seed và dải outbound IP của web service Render (xem Render **Connect / Outbound**). Giữ TLS và tránh mở mọi IP nếu không cần.

**Không dán mật khẩu hoặc URL thật vào chat, issue, ảnh chụp màn hình hay commit.** Prisma/TiDB có [hướng dẫn kết nối chính thức](https://docs.pingcap.com/tidbcloud/integrate-tidbcloud-with-netlify/).

## Bước 2 — Tạo Blueprint trên Render

1. Đăng nhập [Render](https://dashboard.render.com/) bằng GitHub. Nếu màn hình yêu cầu thêm thẻ hoặc nâng gói, **dừng lại và báo người phụ trách**, không nhập thẻ để tiếp tục.
2. Chọn **New > Blueprint**, kết nối GitHub và cấp quyền repo cần thiết, chọn **Thienisme/event-hub**, branch **main**.
3. Render đọc `render.yaml` ở gốc. Kiểm tra có đúng web service `eventhub` (Docker, Free, Singapore) và Key Value `eventhub-redis` (Free, Singapore).
4. Nhập hai giá trị được hỏi: **DATABASE_URL** lấy từ TiDB; **SEED_DEMO_PASSWORD** là mật khẩu mạnh do bạn tự đặt cho các tài khoản demo. Chọn **Apply** / **Deploy Blueprint**.
5. Mở service `eventhub` > **Logs**. Theo dõi lần lượt build Docker, `prisma migrate deploy`, rồi server chạy. Migration được chạy lại an toàn khi container khởi động; không dùng `migrate dev` trên cloud.
6. Khi service Live, mở URL hiển thị, ví dụ `https://eventhub-xxxx.onrender.com`, rồi mở `/api/health`; phải nhận HTTP 200. Kiểm tra giao diện tải được và API hoạt động cùng origin.
7. Nếu tên `eventhub` đã được dùng, Render có thể thêm hậu tố. Vào **Environment**, sửa `CORS_ORIGINS` thành đúng URL HTTPS, không có dấu `/` cuối, rồi lưu và deploy lại. Khi sau này cập nhật Blueprint, kiểm tra giá trị này để tránh bị file ghi đè; người bảo trì nên đồng bộ URL trong Blueprint khi được phép sửa.

Các biến trong Blueprint:

| Biến | Cách đặt / ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Nhập riêng (`sync: false`), URL TiDB có TLS |
| `SEED_DEMO_PASSWORD` | Nhập riêng (`sync: false`), dùng khi seed |
| `JWT_SECRET` | Render sinh (`generateValue: true`) |
| `REDIS_URL` | Tự lấy `connectionString` từ `eventhub-redis`, dạng `redis://` hoặc `rediss://` |
| `STORAGE_DRIVER` | `db`; thiếu biến thì ứng dụng giữ mặc định `disk` như cũ |
| `SERVE_CLIENT_DIR` | `/app/public`; thiếu biến thì không phục vụ giao diện như cũ |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1`, ứng dụng đứng sau proxy Render |
| `TZ` | `Asia/Ho_Chi_Minh` |
| `ALLOW_SIMULATED_PAYMENT` | `true`, bật nút thanh toán giả lập cho demo |
| `CORS_ORIGINS` | URL web service thực tế |
| `PORT` | Render cấp, không khai báo cố định; ứng dụng đọc `process.env.PORT` |

Key Value chỉ cho kết nối nội bộ (`ipAllowList: []`). `maxmemoryPolicy: noeviction` tránh xoá ngầm khoá Redlock khi đầy RAM; lúc đầy, thao tác ghi có thể lỗi và cần kiểm tra bộ nhớ. Tham chiếu: [Blueprint YAML](https://render.com/docs/blueprint-spec).

## Bước 3 — Seed dữ liệu demo

Render free hiện **không hỗ trợ Shell**, nên thường dùng cách local bên dưới. Nếu service có tab **Shell** khả dụng, mở Shell trong thư mục chứa `package.json` của server rồi chạy:

```bash
npm run seed:demo
```

Biến môi trường của service đã có `DATABASE_URL`, `STORAGE_DRIVER=db`, `SEED_DEMO_PASSWORD`. Xem [giới hạn Shell](https://render.com/docs/ssh).

Cách local: dùng checkout đã có dependency server và công cụ seed từ bước chuẩn bị dự án; hướng dẫn này không cài package. Dùng Bash trên Linux/macOS/WSL, từ gốc repo:

```bash
cd server
DATABASE_URL='mysql://USER:PASS@HOST:4000/eventhub?sslaccept=strict' STORAGE_DRIVER=db npm run seed:demo
```

Lệnh trên là mẫu với placeholder, không chạy nguyên văn. Để tránh URL thật lưu trong lịch sử shell và dùng đúng mật khẩu demo đã nhập trên Render, nên nhập kín rồi chạy:

```bash
# Đang ở thư mục server; read -s không hiển thị giá trị khi gõ/dán.
read -rsp 'DATABASE_URL TiDB: ' DATABASE_URL; echo
read -rsp 'SEED_DEMO_PASSWORD như trên Render: ' SEED_DEMO_PASSWORD; echo
export DATABASE_URL SEED_DEMO_PASSWORD
STORAGE_DRIVER=db npm run seed:demo
unset DATABASE_URL SEED_DEMO_PASSWORD
```

Chỉ seed sau khi migrate trên Render thành công. Script có thể đặt lại dữ liệu của organizer demo khi chạy lại; không chạy trên dữ liệu thật. Không dùng cờ purge. Tài khoản: `organizer@eventhub.demo`, `organizer2@eventhub.demo`, `khach@eventhub.demo`; mật khẩu là `SEED_DEMO_PASSWORD` vừa đặt. Kiểm tra có sự kiện, ảnh và thử đặt vé/thanh toán giả lập.

## Bước 4 — Bật keepalive GitHub Actions

1. Mở repo GitHub > **Settings > Secrets and variables > Actions**.
2. Chọn tab **Variables > New repository variable**.
3. Name: `APP_URL`; Value: URL Render thật, ví dụ `https://eventhub-xxxx.onrender.com`. Đây là URL công khai, không phải secret. Bấm **Add variable**.
4. Mở tab **Actions**, cho phép Actions nếu đang tắt. Chọn workflow **Keepalive**, bấm **Run workflow**, chọn branch `main`, xác nhận chạy.
5. Mở lần chạy > job **health**: log phải hiện HTTP 200. Chưa có `APP_URL` thì workflow bỏ qua và vẫn xanh; URL sai sẽ đỏ sau ba lần thử.

Workflow trên branch mặc định gọi `/api/health` mỗi 10 phút, mỗi lần chờ tối đa 90 giây, thử tổng cộng ba lần cách nhau 20 giây. GitHub có thể chạy trễ lịch; repo public không có hoạt động 60 ngày có thể bị tắt workflow lịch. Kiểm tra và bật lại trong Actions khi cần; không coi đây là dịch vụ giám sát có cam kết thời gian. Xem [quy tắc schedule của GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## CD sau lần deploy đầu

CD là tự động triển khai thay đổi. Mỗi lần merge vào `main`, `autoDeployTrigger: commit` làm Render build lại image và deploy. Xem tiến độ/lỗi ở **Render > eventhub > Events**, chi tiết ở **Logs**. Cấu hình này triển khai theo commit, không đợi CI thành công; CI hiện có chạy trên pull request. Thao tác commit/merge do người bảo trì thực hiện riêng.

## Giới hạn miễn phí

- Render cấp **750 giờ/tháng cho cả workspace**. Một web service chạy liên tục tháng 31 ngày dùng khoảng **744 giờ**: không tạo thêm web service free thứ hai dùng chung hạn mức.
- Web free có **512 MB RAM** khi chạy. Build có thể chậm; bộ nhớ build là giới hạn riêng, không đồng nhất với RAM runtime.
- Key Value free **không lưu bền**, có thể mất dữ liệu khi khởi động lại/bảo trì. Chấp nhận cho demo vì chỉ chứa cache/khoá, không chứa đơn hàng gốc; mất khoá có thể ảnh hưởng thao tác đang chạy, còn database vẫn cần bảo vệ tồn kho bằng transaction.
- TiDB Starter có hạn mức miễn phí **5 GiB** (thường gọi 5 GB); ảnh trong DB cũng chiếm dung lượng. Kiểm tra quota hiện trên dashboard, gồm cả compute/request nếu có.
- Keepalive làm tiêu thụ giờ chạy. Ngoài giờ còn có hạn mức bandwidth/build; theo dõi Usage. Nếu Render yêu cầu thẻ, dừng và báo lại.

Hạn mức và màn hình có thể đổi: đối chiếu [Render Free](https://render.com/docs/free), [các loại instance](https://render.com/pricing) và [TiDB Starter](https://docs.pingcap.com/tidbcloud/learn-about-tidb-cloud-starter/) trước khi Apply.

## Lỗi thường gặp

| Dấu hiệu | Kiểm tra / xử lý |
| --- | --- |
| Build hết RAM, `Killed` / exit 137 | Xem Logs để biết bước nào lỗi; phân biệt build và runtime. Báo người phụ trách tối ưu Docker/build; không tự nâng gói trả phí. |
| Dockerfile không tìm thấy | Chưa tích hợp Dockerfile gốc từ task ứng dụng hoặc Blueprint trỏ sai branch; cần hoàn tất điều kiện mã nguồn ở trên. |
| `prisma migrate deploy` lỗi trên TiDB | Xem lỗi đầu tiên trong Logs, kiểm tra URL/TLS/network và tương thích SQL migration (FK, CHECK, transaction). Không sửa migration đã áp dụng hoặc dùng reset; nhờ người phụ trách xử lý. |
| `Access denied` / lỗi TLS | Kiểm tra USER có đúng tiền tố TiDB, mật khẩu đúng và đã URL-encode, database `eventhub`, port 4000; URL phải có `sslaccept=strict`. Không tắt xác minh TLS để né lỗi. |
| 502 hoặc chờ lâu lúc mở trang | Có thể đang cold start; chờ rồi thử `/api/health`. Nếu kéo dài, xem Logs và Events, kiểm tra migrate và PORT. |
| Keepalive đỏ | Xem mã HTTP/mã thoát curl trong Actions; kiểm tra APP_URL, service có bị suspend/hết giờ không. Thử health bằng trình duyệt, xem Render Logs; ba lần thử vẫn có thể chưa đủ khi cold start lâu. |
| Seed thiếu công cụ hoặc ảnh mất | Dùng checkout local đã chuẩn bị dependency; kiểm tra phần code hỗ trợ DB storage đã tích hợp và seed có `STORAGE_DRIVER=db`. Không chuyển sang disk trên Render free. |
