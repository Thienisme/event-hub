# Các môi trường của Event Hub

Bảng tra nhanh: app chạy ở đâu, dùng dịch vụ gì, biến môi trường nào, bí mật nằm ở đâu.
Hướng dẫn deploy từng bước xem [`deploy/cloud/README.md`](cloud/README.md).

**Link demo:** https://eventhub-v3xy.onrender.com

## 1. Ba môi trường

| Môi trường | Chạy ở đâu | Database | Redis | Ảnh banner | Dùng để |
|---|---|---|---|---|---|
| **Dev** | Máy cá nhân: `npm run dev` ở `server/` và `client/` | MySQL 8 trong Docker (`docker compose up -d`) | Redis 7 trong Docker | Thư mục `server/uploads/` | Viết code, chạy test |
| **CI** | Máy ảo GitHub Actions, mỗi khi mở pull request | MySQL dựng tạm trong job | Redis dựng tạm | Ổ đĩa tạm | 10 bộ test + build client trước khi merge |
| **Production (demo)** | **Render** (free, Singapore) | **TiDB Cloud Starter**, database `eventhub` | **Render Key Value** (free) | Trong database, bảng `stored_files` | Web public 24/7 |

> Vì sao ảnh nằm trong database: ổ đĩa của Render free bị xoá mỗi lần deploy hoặc ngủ. Ảnh đã nén WEBP
> (khoảng 100–300KB mỗi ảnh), nên 5GB của TiDB dư cho demo.

## 2. Tài khoản và dịch vụ

| Dịch vụ | Vai trò | Gói | Xem ở đâu |
|---|---|---|---|
| GitHub `Thienisme/event-hub` | Code, CI, keepalive | Free (repo public) | Tab **Actions** |
| Render: web service `eventhub` | Chạy image Docker (giao diện + API) | Free, 750 giờ/tháng | Dashboard → `eventhub` → Logs / Environment |
| Render: Key Value `eventhub-redis` | Redis cho Redlock, cache | Free, 25MB, không lưu bền | Dashboard → `eventhub-redis` |
| TiDB Cloud: cluster `Event-hub` | MySQL (tương thích) | Starter, free 5GB | SQL Editor, Networking |

TiDB có hai database: `eventhub` (dữ liệu thật của demo) và `eventhub_verify` (chỉ để chạy test, test ghi dữ liệu rác).

## 3. Biến môi trường trên Render

Service `eventhub` → **Environment**. 🔒 là bí mật: chỉ nằm trên Render và TiDB, không có trong code, không gửi qua chat.

| Biến | Giá trị | Ai đặt |
|---|---|---|
| `DATABASE_URL` 🔒 | `mysql://<user>:<mật khẩu>@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/eventhub?sslaccept=strict` | Tự dán (đổi được ở trang Environment) |
| `JWT_SECRET` 🔒 | Chuỗi ngẫu nhiên 256 bit | Render tự sinh (`generateValue`) |
| `SEED_DEMO_PASSWORD` 🔒 | Mật khẩu các tài khoản demo | Tự đặt |
| `REDIS_URL` | `redis://red-…:6379`, chỉ dùng trong mạng nội bộ Render | Render tự nối từ `eventhub-redis` |
| `STORAGE_DRIVER` | `db` | `render.yaml` |
| `SERVE_CLIENT_DIR` | `/app/public` | `render.yaml` |
| `NODE_ENV` | `production` | `render.yaml` |
| `TRUST_PROXY` | `1` (sau proxy của Render) | `render.yaml` |
| `TZ` | `Asia/Ho_Chi_Minh` | `render.yaml` |
| `ALLOW_SIMULATED_PAYMENT` | `true` (bật thanh toán giả lập cho demo) | `render.yaml` |
| `CORS_ORIGINS` | `https://eventhub-v3xy.onrender.com` | `render.yaml` |
| `MAIL_DRIVER` | `brevo` trên Render, mặc định `log` ở dev/CI | `render.yaml` |
| `APP_PUBLIC_URL` | `https://eventhub-v3xy.onrender.com`; mặc định `http://localhost:5173` | `render.yaml`, sửa nếu tên miền thay đổi |
| `BREVO_API_KEY` 🔒 | API key Brevo | Tự đặt (`sync: false`) |
| `MAIL_FROM` | `EventHub <email đã xác thực với Brevo>` | Tự đặt (`sync: false`) |
| `MAIL_OUTBOX_DIR` | Tuỳ chọn với driver `log`; CI dùng `/tmp/eventhub-mail-outbox`, mỗi thư một JSON chứa token | Dev/CI đặt; không public thư mục này |
| `PORT` | `10000` | Render tự đặt |

`DATABASE_URL` và `SEED_DEMO_PASSWORD` khai báo `sync: false`: Render chỉ hỏi một lần lúc tạo Blueprint; muốn đổi thì
sửa ở trang **Environment** rồi **Save, rebuild, and deploy**.

Biến của GitHub (repo → Settings → Secrets and variables → Actions → Variables):

| Biến | Giá trị | Dùng cho |
|---|---|---|
| `APP_URL` | `https://eventhub-v3xy.onrender.com` | Workflow `keepalive.yml` |

## 4. Luồng CI/CD

```
Nhánh tính năng → mở PR → CI chạy 10 bộ test + build client
    → CI xanh → merge vào main
    → Render thấy commit mới trên main → build Dockerfile → prisma migrate deploy → thay bản đang chạy
GitHub Actions "Keepalive" gọi /api/health mỗi 10 phút → Render free không ngủ
```

Workflow `deploy.yml` (build image lên GHCR, SSH vào VPS) vẫn giữ cho phương án VPS sau này;
bước SSH tự bỏ qua khi chưa có secret `DEPLOY_HOST`.

## 5. Seed dữ liệu lên production

Render Shell là tính năng trả phí, nên seed chạy từ máy cá nhân, trỏ thẳng vào TiDB. Tạo file `server/.env.render.local`
(đã được gitignore). Mỗi dòng dạng `TÊN='giá trị'`: **không có dấu cách quanh dấu `=`** (bash hiểu `TÊN= giá trị` là gán rỗng rồi chạy `giá trị` như một lệnh, và seed sẽ âm thầm ghi vào database dev).

```
DATABASE_URL='<giống hệt giá trị trên Render>'
STORAGE_DRIVER='db'
SEED_ADMIN_PASSWORD='<mật khẩu admin mạnh>'
SEED_DEMO_PASSWORD='<mật khẩu tài khoản demo>'
```

```bash
cd server
set -a; . ./.env.render.local; set +a
echo "$DATABASE_URL" | sed -E 's#^[a-z]+://[^@]*@##'   # phải ra gateway01...tidbcloud.com:4000/eventhub...; rỗng là file sai
npm run seed        # tài khoản admin@test.com với SEED_ADMIN_PASSWORD
npm run seed:demo   # 3 tài khoản demo + 12 sự kiện có ảnh
```

Không đặt `SEED_ADMIN_PASSWORD` thì admin có mật khẩu mặc định `admin12345`, rất nguy hiểm trên web public.
Không chạy `npm run test:all` hay `--purge-test` vào database `eventhub`: test ghi dữ liệu thật.

## 6. Backup & khôi phục

Backup trước migration lớn, seed hoặc sửa dữ liệu bằng tay; lên lịch backup định kỳ theo mức dữ liệu chấp nhận mất. Máy cần Python 3, MySQL client/mysqldump 8.0, gzip và CA bundle Ubuntu. Script luôn xác minh TLS với TiDB Cloud Starter (cổng mặc định 4000).

Từ gốc repo, dùng file env tự tạo chứa `DATABASE_URL='mysql://USER:PASS@HOST:4000/eventhub?sslaccept=strict'`. URL-encode mật khẩu; script chỉ đọc DATABASE_URL, không thực thi file env. Mặc định đọc `server/.env.render.local`; có thể đổi bằng `--env-file <đường dẫn>` (đường dẫn tương đối tính từ gốc repo).

```bash
bash deploy/cloud/backup-db.sh
bash deploy/cloud/backup-db.sh --database eventhub_verify --keep 10
# Thay timestamp bằng file vừa tạo; đường dẫn backup tương đối tính từ nơi gọi.
bash deploy/cloud/restore-db.sh backups/eventhub-YYYYmmdd-HHMMSS.sql.gz --database eventhub_verify
```

Backup nằm trong `backups/`, giữ mặc định 10 bản mới nhất mỗi database (`--keep N`). Dump dùng hex cho ảnh BLOB. Restore sẽ tạo database nếu thiếu và **DROP TABLE IF EXISTS sẽ ghi đè bảng trùng tên**; bảng chỉ có ở đích không tự bị xoá. Chỉ dùng dump đáng tin cậy do script này tạo, không chứa lệnh chuyển database. Kiểm tra số dòng được in và thử ứng dụng trên database kiểm chứng; **chưa thử restore = chưa có backup**.

Restore vào tên database trong DATABASE_URL được coi là production: bắt buộc thêm `--i-know-this-overwrites-production` và gõ lại đúng tên database; `--yes` chỉ bỏ câu hỏi y/N cho đích khác. Script tự backup production trước khi nạp; backup thất bại sẽ dừng restore. Nên dừng thao tác ghi của ứng dụng khi khôi phục; restore lỗi có thể để lại dữ liệu mới nạp một phần.

Áp dụng **3-2-1**: 3 bản dữ liệu, trên 2 loại phương tiện, ít nhất 1 bản ngoài máy/chỗ lưu chính. Giới hạn 10 bản local không thay thế chính sách này. File backup chứa dữ liệu người dùng: **không commit, không gửi đi**; chỉ lưu bản ngoài máy ở nơi được quản lý an toàn, kiểm soát truy cập và mã hoá.

## 7. Khi có sự cố

| Triệu chứng | Xem ở đâu | Nguyên nhân hay gặp |
|---|---|---|
| Deploy Failed | Render → `eventhub` → Logs, tìm dòng `Error` đầu tiên | `P1000 Authentication failed`: sai mật khẩu trong `DATABASE_URL` |
| Web mở chậm khoảng 1 phút | Tab Actions → Keepalive | Web đang ngủ: keepalive chưa chạy hoặc thiếu biến `APP_URL` |
| Không có sự kiện nào | `/api/events` | Chưa seed (mục 5) |
| Migration lỗi | Logs, ngay sau dòng `Applying migration` | Câu SQL TiDB chưa hỗ trợ |

## 8. Phương án đã cân nhắc và bỏ

| Phương án | Lý do bỏ |
|---|---|
| Oracle Cloud Always Free (VPS ARM) | Từ chối thẻ ảo khi đăng ký |
| Máy nhà + Cloudflare Quick Tunnel | Link đổi mỗi lần khởi động lại; code vẫn giữ ở nhánh `feat/home-deploy` |
| Vercel + Upstash + Cloudinary + UptimeRobot | Quá nhiều tài khoản; gộp lại thành Render + TiDB |
