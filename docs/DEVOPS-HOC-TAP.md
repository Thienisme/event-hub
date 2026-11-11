# Sổ tay DevOps: học từ chính dự án Event Hub

Ghi lại những gì đã làm để đưa Event Hub lên Internet, **vì sao làm vậy**, và **các sự cố thật đã gặp**.
Đọc theo thứ tự từ trên xuống. Cuối file có câu hỏi phỏng vấn và bài tập tự làm.

Tra cứu nhanh môi trường và biến: [`deploy/ENVIRONMENTS.md`](../deploy/ENVIRONMENTS.md).
Hướng dẫn deploy từng bước: [`deploy/cloud/README.md`](../deploy/cloud/README.md).

---

## 1. Bức tranh tổng thể

```
 ① Code trên nhánh feat/...
        │ git push + mở Pull Request
        ▼
 ② GitHub Actions chạy ci.yml (CI): máy ảo trắng → dựng MySQL, Redis → 10 bộ test → build client → ✅/❌ trên PR
        │ Merge vào main (khi ✅)
        ▼
 ③ GitHub gửi webhook cho Render: "main vừa có commit mới"
        ▼
 ④ Render (CD): clone đúng commit → docker build theo Dockerfile → chạy container mới
      + bơm biến môi trường → container chạy `prisma migrate deploy` rồi `node dist/app.js`
      → Render gọi /api/health: 200 thì chuyển người dùng sang bản mới; lỗi thì giữ bản cũ
        ▼
 ⑤ https://eventhub-v3xy.onrender.com chạy bản mới
    GitHub Actions keepalive.yml gọi /api/health mỗi 10 phút để Render free không ngủ
```

| Việc | Ai làm | Nhờ file nào |
|---|---|---|
| Kiểm tra code (CI) | GitHub Actions | `.github/workflows/ci.yml` |
| Báo có code mới | GitHub (webhook) | GitHub App của Render (cài khi đăng ký bằng GitHub) |
| Build + deploy (CD) | Render | `Dockerfile`, `render.yaml` |
| Cập nhật cấu trúc database | Chính container lúc khởi động | `CMD` trong `Dockerfile` |
| Giữ web không ngủ | GitHub Actions theo lịch | `.github/workflows/keepalive.yml` |
| Giữ bí mật | Render Environment, TiDB | không nằm trong code |

---

## 2. Sáu khái niệm cốt lõi

### 2.1. CI và CD
- **CI (Continuous Integration):** mỗi thay đổi đều được **tự động build và test** trên một máy sạch trước khi gộp vào nhánh chính. Mục tiêu: phát hiện lỗi sớm, chặn kiểu "chạy được trên máy em".
- **CD (Continuous Delivery/Deployment):** code đã qua kiểm tra được **tự động đưa lên môi trường chạy thật**. Delivery là sẵn sàng deploy bằng một nút bấm; Deployment là tự deploy luôn (dự án này dùng kiểu sau).
- Ví von: CI là bộ phận **kiểm tra chất lượng** trong nhà máy, CD là **xe tải tự chở hàng đã qua kiểm tra** ra cửa hàng.

### 2.2. Git là nguồn sự thật duy nhất
Mọi thứ, kể cả hạ tầng (`render.yaml`), cấu hình build (`Dockerfile`) và quy trình (`.github/workflows/`), đều nằm trong Git.
Không sửa tay trên server. Muốn đổi gì thì sửa code → PR → merge. Nhờ vậy luôn biết server đang chạy đúng commit nào và quay lại được.

### 2.3. Webhook và kiến trúc theo sự kiện (event-driven)
Khi đăng ký Render bằng GitHub, ta đã **cài GitHub App của Render** vào repo với quyền đọc code và nhận sự kiện.
Mỗi lần có push/merge, GitHub **chủ động gửi một HTTP request (webhook)** tới Render. Render không cần hỏi liên tục.
GitHub Actions cũng chạy theo sự kiện: `on: pull_request`, `on: push`, `on: schedule` (lịch hẹn giờ kiểu cron).

### 2.4. Docker: cùng công thức, cùng kết quả
- **Image** là "hộp cơm đóng sẵn": code đã build + Node + thư viện. **Container** là hộp cơm đang được hâm nóng và ăn (image đang chạy).
- `Dockerfile` là công thức tạo image. Dự án dùng **multi-stage build**: stage build client, stage build server, stage cuối chỉ chép những gì cần chạy → image gọn hơn.
- Docker cần nhân Linux; trên macOS/Windows phải chạy qua một máy ảo Linux nhỏ (Docker Desktop, Colima).
- Kiến trúc chip phải khớp: image **amd64** (Intel/AMD) không chạy trên máy **ARM64** và ngược lại.

### 2.5. Biến môi trường: tách cấu hình khỏi code (12-Factor App)
Code chỉ viết `process.env.DATABASE_URL`. Mỗi môi trường bơm giá trị riêng lúc chạy:

| Môi trường | `DATABASE_URL` lấy từ |
|---|---|
| Máy cá nhân | `server/.env` → MySQL trong Docker |
| CI | khai báo trong `ci.yml` → MySQL tạm |
| Render | trang Environment → TiDB Cloud |

Cùng một image chạy được ở mọi nơi, và repo public vẫn không lộ bí mật.
File chứa bí mật (`.env`, `.env.*.local`, `.env.home`, `.env.prod`) phải nằm trong `.gitignore`; chỉ commit file `*.example`.

### 2.6. Infrastructure as Code và health check
- `render.yaml` mô tả hạ tầng bằng văn bản: 1 web Docker gói free ở Singapore, 1 Key Value (Redis), các biến môi trường, tự deploy khi có commit. Render đọc và tự dựng. Dựng lại = bấm lại; ai đọc repo cũng biết hạ tầng gồm gì.
- `healthCheckPath: /api/health` là **cổng kiểm soát**: bản mới phải trả 200 mới được nhận người dùng. Đây là **zero-downtime deploy**: chạy bản mới song song, chỉ chuyển khi bản mới khoẻ.

---

## 3. Các thành phần đang chạy

| Thành phần | Dịch vụ | Ghi chú |
|---|---|---|
| Web (giao diện Vue + API Node) | Render, web service free, Docker | Ngủ sau 15 phút không có truy cập; 750 giờ/tháng |
| Redis (Redlock, cache) | Render Key Value free | 25MB, không lưu bền (mất khi khởi động lại: chấp nhận được vì chỉ là cache/khoá) |
| MySQL | TiDB Cloud Starter | Tương thích MySQL, **bắt buộc TLS**, free 5GB |
| Ảnh banner | Lưu trong database (bảng `stored_files`) | Ổ đĩa Render free bị xoá mỗi lần deploy/ngủ |
| Giữ web thức | GitHub Actions `keepalive.yml` | Cron mỗi 10 phút; GitHub có thể chạy trễ vài phút |

**Vì sao chọn bộ này** (sau khi thử nhiều hướng):

| Hướng | Kết quả |
|---|---|
| Oracle Cloud Always Free (VPS ARM) | Từ chối thẻ ảo khi đăng ký |
| Máy nhà + Cloudflare Quick Tunnel | Chạy được, nhưng link đổi mỗi lần khởi động lại → không demo từ xa được (code giữ ở nhánh `feat/home-deploy`) |
| Vercel + Render + Upstash + Cloudinary + UptimeRobot | Quá nhiều tài khoản |
| **Render + TiDB Cloud** | 2 tài khoản, 0đ, link cố định, chạy 24/7 |

Bài học: chọn hạ tầng là **đánh đổi** giữa chi phí, độ phức tạp, độ tin cậy và mức "học được". Không có lựa chọn hoàn hảo.

---

## 4. Sự cố thật đã gặp và bài học

| # | Sự cố | Nguyên nhân | Bài học |
|---|---|---|---|
| 1 | Render: `render.yaml not found on main branch` | PR chứa file chưa được merge | Render (và mọi CD) chỉ thấy code **trên nhánh của GitHub**, không thấy máy cá nhân |
| 2 | Deploy failed: `P1000: Authentication failed` | Sai mật khẩu TiDB trong `DATABASE_URL` | Đọc log: tìm **dòng `Error` đầu tiên**; các dòng `Exited`, `restarted` sau đó chỉ là hệ quả |
| 3 | Seed chạy nhưng web vẫn trống | File env viết `DATABASE_URL= '...'` (dấu cách sau `=`): bash gán **rỗng** rồi chạy giá trị như một lệnh → seed lặng lẽ ghi vào database dev | **Lỗi im lặng nguy hiểm hơn lỗi ồn ào.** Luôn kiểm tra đích trước khi chạy lệnh ghi dữ liệu (in host ra xem) |
| 4 | Mật khẩu lộ ra màn hình | `source` một file env sai định dạng → bash in nguyên dòng lỗi | Không `source` file chứa bí mật khi chưa chắc định dạng; đọc bằng chương trình riêng và không bao giờ in giá trị |
| 5 | Seed lỗi `Transaction already closed… 5000 ms` | Máy ở VN gọi TiDB Singapore, mỗi câu 50–100ms đi về; giao dịch nhiều câu vượt 5 giây | **Độ trễ mạng giữa các vùng** làm lộ lỗi không bao giờ thấy ở local |
| 6 | Backup lỗi `SAVEPOINT sp does not exist` | TiDB không giống MySQL 100%; `mysqldump --single-transaction` dùng SAVEPOINT | Dịch vụ "tương thích X" không phải X; phải chạy thử trên dịch vụ thật |
| 7 | Script đếm thời gian chờ treo 60 giây trên macOS | Tiến trình chạy nền giữ stdout, `$(...)` phải chờ nó | Script phải test đúng môi trường đích (bash 3.2 trên Mac khác bash Linux) |
| 8 | File secret `.env.home` không nằm trong `.gitignore` | Quên khai báo | Mỗi file secret mới → thêm `.gitignore` ngay và kiểm tra bằng `git check-ignore -v <file>` |

---

## 5. Backup và khôi phục

- **Backup** = bản sao dữ liệu cất ở chỗ khác; **restore** = nạp lại khi cần.
- Mất dữ liệu thường do **con người** (xoá nhầm, chạy nhầm database, migration lỗi, bug), không phải do phần cứng.
- **Backup trước mọi thao tác rủi ro**: migration lớn, script xoá, sửa tay bằng SQL.
- **Quy tắc 3-2-1**: 3 bản sao, trên 2 loại nơi lưu, 1 bản ngoài hệ thống chính.
- **Chưa thử restore = chưa có backup.** Dự án đã thử thật: backup production, restore vào `eventhub_verify`, đối chiếu 7 bảng và 24 ảnh khớp từng byte.

| Kiểu backup | Là gì | Ở dự án |
|---|---|---|
| Dump (logical) | Xuất ra file lệnh SQL | `deploy/cloud/backup-db.sh` (mysqldump) |
| Snapshot (physical) | Chụp nguyên trạng ổ đĩa/cluster | Tính năng của nhà cung cấp |
| Point-in-time (PITR) | Khôi phục về đúng một giây | Thường là gói trả phí |

```bash
bash deploy/cloud/backup-db.sh                                      # backup production → backups/
bash deploy/cloud/restore-db.sh backups/<file>.sql.gz --database eventhub_verify   # thử khôi phục
```

---

## 6. Bảo mật khi deploy

- Bí mật chỉ nằm ở: trang Environment của Render, TiDB, file `*.local` đã gitignore. **Không dán vào chat, không commit.**
- Kết nối database phải **mã hoá TLS** (`?sslaccept=strict`) và xác minh chứng chỉ máy chủ.
- TiDB đang mở cho mọi IP (`0.0.0.0/0`): chấp nhận được vì có TLS + mật khẩu dài ngẫu nhiên, và Render free không có IP cố định.
- Mật khẩu không đặt trên dòng lệnh (người khác trên máy xem được qua `ps`); dùng file cấu hình tạm quyền 600.
- Agent AI không đáng tin (ví dụ freebuff) không được đọc bí mật; nhốt bằng sandbox hoặc không dùng.
- Lộ bí mật → **đổi ngay** (rotate), rồi cập nhật mọi nơi dùng nó.

---

## 7. Lệnh hay dùng

```bash
# Git / GitHub
git checkout -b feat/ten-tinh-nang          # nhánh mới cho mỗi việc
gh pr create                                  # mở PR
gh pr checks <số>                             # xem CI của PR
gh run list --limit 5                         # các lần chạy GitHub Actions

# Docker
docker compose up -d                          # bật MySQL + Redis cho dev
docker compose logs -f <service>              # xem log
docker build -t ten:tag .                     # build image theo Dockerfile

# Kiểm tra web thật
curl https://eventhub-v3xy.onrender.com/api/health
```

---

## 8. Câu hỏi phỏng vấn tự luyện

1. CI và CD khác nhau thế nào? Dự án của bạn CI chạy ở đâu, CD chạy ở đâu?
2. Vì sao không ghi mật khẩu database vào code? Bạn quản lý bí mật thế nào khi repo public?
3. Khi merge vào `main`, chuyện gì xảy ra từng bước cho tới khi người dùng thấy bản mới?
4. Zero-downtime deploy là gì? Health check đóng vai trò gì?
5. Vì sao ảnh không lưu trên ổ đĩa server mà lưu trong database? Nhược điểm của cách đó?
6. Migration chạy lúc nào? Nếu migration lỗi thì người dùng có bị ảnh hưởng không?
7. Bạn đã gặp lỗi deploy nào và debug thế nào? (Kể sự cố P1000 hoặc dấu cách trong file env.)
8. Backup của bạn thế nào? Làm sao biết bản backup dùng được?
9. Push-based deploy (GitHub đẩy vào server qua SSH) khác pull-based (server tự kéo bản mới) thế nào?
10. Vì sao dịch vụ "tương thích MySQL" vẫn có thể làm hỏng app? Cho ví dụ.

---

## 9. Bài tập tự làm

- [ ] Bật **branch protection** cho `main`: bắt buộc CI ✅ mới cho merge (Settings → Branches). Sau đó CI không chỉ là tín hiệu mà là cái khoá.
- [ ] Thêm `buildFilter` vào `render.yaml` để thay đổi chỉ ở `docs/`, `*.md` không kích hoạt deploy.
- [ ] Tự chạy backup và thử khôi phục vào `eventhub_verify`, đối chiếu số dòng.
- [ ] Cố tình làm một deploy lỗi (ví dụ đổi tạm `DATABASE_URL` sai) rồi đọc log, xác nhận Render giữ bản cũ; sau đó sửa lại.
- [ ] Viết backup tự động hằng đêm bằng GitHub Actions (dùng GitHub Secrets cho `DATABASE_URL`).
- [ ] Đọc `deploy/README.md` (phương án VPS) để so sánh PaaS (Render) với tự quản server (VPS + Caddy + SSH).
