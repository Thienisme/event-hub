# Event Hub trên máy nhà Ubuntu x86_64

Hướng dẫn này dùng máy nhà chỉ bật khi demo, không cần mua tên miền, tài khoản Cloudflare hay mở cổng router. Các lệnh cài đặt/pull bên dưới cần Internet **khi bạn thực hiện trên máy nhà**. Không chạy script setup Oracle cũ. Mọi script ở đây tự tìm gốc repo nên gọi bằng đường dẫn tuyệt đối từ thư mục nào cũng được.

## 1. Hiểu trước khi chạy

```text
Người xem -> Cloudflare (HTTPS) <=tunnel ra ngoài= cloudflared (máy nhà)
                                                     |
                                                     v
                                                nginx client
                                                     | /api
                                                     v
                                                    Node -> MySQL
                                                         -> Redis

GitHub Actions -> GHCR <- update.sh (máy nhà tự kéo mỗi 5 phút)
```

- **Tunnel / outbound connection**: cloudflared chủ động kết nối ra Cloudflare, đưa request về nginx qua kết nối này. Router không cần port forwarding. Người xem thấy địa chỉ Cloudflare, không nhận IP nhà từ DNS của link; Cloudflare và nhà mạng vẫn thấy IP kết nối. Chỉ dùng mạng Docker nội bộ cho các service.
- **Quick Tunnel** cấp link `https://<ngẫu-nhiên>.trycloudflare.com`, không cần tài khoản. **Named Tunnel** dùng tài khoản Cloudflare và, để public web với hostname riêng, cần tên miền; phù hợp học bước tiếp theo.
- **Push-based deploy**: Actions chủ động SSH vào máy đích. Job SSH giữ lại cho VPS sau này, thiếu `DEPLOY_HOST` sẽ tự bỏ qua. **Pull-based deploy**: máy nhà tự tải image từ GHCR; không cần SSH từ Internet vào nhà.
- **Image/tag**: image đóng gói app. `latest` là nhãn có thể chuyển tới bản build mới; `sha-xxxxxxx` xác định bản build theo 7 ký tự commit. Workflow `Deploy` build `linux/amd64`; đợi build thành công trước lần chạy đầu. Đặt SHA trong env để giữ bản app cũ, nhưng migration và cấu hình không tự rollback.
- **Volume** giữ dữ liệu ngoài container: project cố định `eventhub` tạo `eventhub_mysql_data`, `eventhub_redis_data`, `eventhub_uploads_data`. Docker quản lý chúng trên đĩa máy nhà (thường dưới `/var/lib/docker/volumes`; kiểm tra bằng `docker volume inspect eventhub_mysql_data`). `down` giữ volume; `down -v` xoá dữ liệu, tuyệt đối không dùng khi muốn giữ dữ liệu.

## 2. Cài Docker Engine một lần

Các lệnh dưới đây theo [tài liệu Docker Engine cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Đọc mục gỡ package xung đột nếu máy đã cài Docker/containerd từ nguồn khác. Không chạy gỡ package trên máy đang có workload mà chưa kiểm tra.

1. Mở Terminal trên Ubuntu x86_64, kiểm tra `dpkg --print-architecture` trả `amd64`.
2. Thêm kho chính thức và cài Engine cùng Compose plugin:

```bash
# Cài công cụ để xác thực kho Docker.
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
# Tự nhận phiên bản Ubuntu hiện tại thay vì ghi cứng codename.
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
# Kho Docker chính thức cho máy này.
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Bật Engine ngay và tự chạy khi bật máy.
sudo systemctl enable docker
sudo systemctl start docker
# Nhóm docker có quyền tương đương root: chỉ thêm user tin cậy.
sudo usermod -aG docker "$USER"
```

3. Đăng xuất rồi đăng nhập lại để nhận nhóm mới. Chạy `docker version` và `docker compose version`. Compose cần **>= 2.24.4** vì override dùng `!reset`.
4. Nếu thiếu Git/OpenSSL: `sudo apt-get install -y git openssl`. Không cần cài Node/npm trên host.

## 3. Clone và điền cấu hình

```bash
# Clone bằng HTTPS để pull tự động không cần nhập SSH passphrase.
git clone https://github.com/Thienisme/event-hub.git ~/event-hub
cd ~/event-hub
# Loại env khỏi Git chỉ tại checkout này; không sửa .gitignore chung.
printf '\n/deploy/home/.env.home\n' >> .git/info/exclude
umask 077
cp deploy/home/.env.home.example deploy/home/.env.home
chmod 600 deploy/home/.env.home
# Chạy ba lần, dùng mỗi kết quả cho một secret riêng.
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
nano deploy/home/.env.home
```

Điền `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `SEED_DEMO_PASSWORD`; giữ MySQL password dạng hex vì được ghép vào URL kết nối. Hai biến đầu là toàn bộ biến bắt buộc `:?` trong compose gốc; override yêu cầu thêm mật khẩu seed. Không dùng giá trị mẫu, không commit file env, không `source` env như shell script. `TZ` có mặc định; `CORS_ORIGINS=http://localhost` là origin hợp lệ: trình duyệt gọi API cùng origin qua nginx nên không cần cập nhật theo link tunnel. Env này không thay đổi cấu hình đã build trong image client (`/api`).

Trên GitHub → Actions → **Deploy** → Run workflow, đợi build thành công. Vào Packages của chủ repo, đặt **cả hai package** `event-hub-server` và `event-hub-client` thành **Public**. Repo public không tự làm package public. Nếu giữ private, chạy `docker login ghcr.io -u TEN_GITHUB` trên máy nhà rồi nhập token có `read:packages` tại prompt; không ghi token vào repo hoặc dòng lệnh. Timer dùng cùng user để đọc thông tin đăng nhập Docker.

## 4. Chạy lần đầu

```bash
cd ~/event-hub
# Kiểm tra cấu hình mà không in secret ra màn hình.
docker compose -p eventhub -f docker-compose.prod.yml -f deploy/home/docker-compose.home.yml --env-file deploy/home/.env.home config -q
# Tải image, chạy migration, chờ API tối đa 120s, tìm link tối đa 60s.
./deploy/home/start.sh
# Tạo dữ liệu demo với SEED_DEMO_PASSWORD; không dùng --purge-test.
./deploy/home/seed.sh
# Cài timer user để kiểm tra image mỗi 5 phút.
./deploy/home/install-autoupdate.sh
```

Mở link được in, kiểm tra trang và `/api/health` rồi mới gửi người xem. Seed có thể đặt lại dữ liệu demo khi chạy lại, nên backup trước. Tài khoản demo nằm trong README gốc; mật khẩu dùng giá trị bạn đặt trong env.

Các dịch vụ lâu dài kế thừa `restart: unless-stopped`, tunnel cũng có cùng chính sách: Docker bật theo hệ thống thì app tự chạy lại khi bật máy. Migration là job một lần, giữ `restart: no`. Service đã bị stop thủ công sẽ không tự bật lại; chạy `start.sh` để mở lại sau `stop.sh`.

## 5. Bật auto-update và xem log

Installer tạo `~/.config/systemd/user/eventhub-update.service` và `.timer`, chạy `update.sh` mỗi 5 phút, `Persistent=true` để chạy bù lịch đã lỡ khi bật máy. Bật user manager ngoài phiên đăng nhập bằng lệnh sau (cần quyền sudo):

```bash
sudo loginctl enable-linger "$USER"
systemctl --user list-timers eventhub-update.timer
journalctl --user -u eventhub-update
# Log có thời gian nằm ngoài repo, không chứa env.
tail -n 20 ~/.local/state/eventhub/update.log
```

Nếu đặt `XDG_STATE_HOME`, log nằm trong `$XDG_STATE_HOME/eventhub/`. Không có image mới thì script chỉ ghi một dòng log và không in gì. Script pull rồi so image ID trước/sau, kiểm tra cả container đang dùng bản cũ để thử lại khi lần cập nhật trước lỗi. Có thay đổi thì `git pull --ff-only`, pull lại theo compose mới, tạo lại migration, `up -d`, dọn image dangling. Nếu repo có thay đổi local thì cảnh báo và bỏ qua Git pull; không xoá sửa đổi của bạn. Nếu Git pull thất bại, lượt update dừng để bạn xử lý. Image mới không bảo đảm tương thích dữ liệu cũ: backup trước thay đổi lớn, không có rollback DB tự động.

Script không tự bật app nếu server đã dừng; timer có thể để nguyên sau demo. Nếu chỉ dừng tunnel, timer giữ trạng thái dừng trong lượt không có image mới; khi có update, `up -d` có thể bật lại tunnel. Muốn giữ web tắt chắc chắn, dừng cả app hoặc tắt timer.

Gỡ timer:

```bash
systemctl --user disable --now eventhub-update.timer
systemctl --user stop eventhub-update.service
rm ~/.config/systemd/user/eventhub-update.service ~/.config/systemd/user/eventhub-update.timer
systemctl --user daemon-reload
# Chỉ tắt linger nếu không có user service khác cần chạy nền.
# sudo loginctl disable-linger "$USER"
```

## 6. Mỗi lần demo

1. Bật máy, đợi Docker và app khởi động. Nếu lần trước đã dừng app, chạy `~/event-hub/deploy/home/start.sh`.
2. Chạy `~/event-hub/deploy/home/url.sh`, mở thử và gửi link mới.
3. Giữ máy có Internet và không ngủ. Ubuntu: **Settings > Power > Automatic Suspend > Off**; chỉnh hành vi đóng nắp nếu dùng laptop.
4. Kết thúc: chạy `~/event-hub/deploy/home/stop.sh` để dừng app, giữ dữ liệu trong volume.

Tuỳ chọn chặn ngủ ở mức hệ thống (ảnh hưởng mọi user), rồi khôi phục bằng `unmask`:

```bash
# Chặn các kiểu ngủ trong thời gian demo.
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# Sau demo, cho phép lại các kiểu ngủ.
sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Để gõ lệnh Compose ngắn trong terminal hiện tại:

```bash
cd ~/event-hub
# Luôn giữ đủ project, hai file và env để dùng đúng volume.
dc() { docker compose -p eventhub -f docker-compose.prod.yml -f deploy/home/docker-compose.home.yml --env-file deploy/home/.env.home "$@"; }
dc ps -a
# Chỉ tắt public web; container khác vẫn chạy. Tắt timer để update không bật lại tunnel.
systemctl --user stop eventhub-update.timer
dc stop tunnel
# Mở lại tunnel và lấy link.
dc up -d tunnel
./deploy/home/url.sh
# Bật lại lịch cập nhật khi cần.
systemctl --user start eventhub-update.timer
```

## 7. Giới hạn và bảo mật

Quick Tunnel chỉ dành cho demo: link đổi mỗi lần tunnel khởi động lại, không cam kết uptime, giới hạn **200 request đang xử lý đồng thời** (vượt có thể trả 429), không hỗ trợ SSE. Kiểm tra lại [giới hạn Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) khi dùng vì nhà cung cấp có thể thay đổi. URL lấy từ log chưa tự chứng minh web đã truy cập được: hãy mở thử trước khi gửi.

Chỉ web đi qua tunnel; MySQL, Redis và cổng Node không publish ra host. Đổi mật khẩu demo trước khi gửi link; ai có link đều truy cập được trang web (chức năng riêng vẫn cần đăng nhập). Không để dữ liệu thật trong demo. Không mở profile `https`: Caddy vẫn tắt, không cần cổng 80/443 ở router.

Để học link cố định sau này: mua tên miền, thêm zone vào Cloudflare, tạo Named Tunnel trong tài khoản, lưu credential/token ngoài Git, cấu hình hostname trỏ tới tunnel và route origin `http://client:80`, thay lệnh Quick Tunnel bằng cấu hình Named Tunnel. Khi đó quản lý DNS/chứng thực và bảo vệ truy cập theo nhu cầu.

## 8. Lỗi thường gặp

Dùng hàm `dc` ở mục 6 trước các lệnh dưới đây:

- **Không thấy link**: `dc logs --tail=100 tunnel`; kiểm tra Internet, outbound DNS/HTTPS và kết nối Cloudflare Tunnel (thường cổng 7844 UDP/TCP). Không mở inbound router. Chạy lại `url.sh`; script lọc log từ lần start hiện tại để tránh link cũ sau restart. Hãy chờ log kết nối mới và mở thử.
- **502**: Node chưa healthy hoặc nginx/tunnel chưa tới được origin; `dc ps -a`, `dc logs --tail=100 server migrate mysql client tunnel`. Sửa lỗi migration/env trước, rồi chạy lại `start.sh`.
- **Pull denied / manifest unknown**: kiểm tra package public, login đúng user, Actions đã build thành công và tag tồn tại. Image app là AMD64, không dùng trên máy ARM.
- **Máy ngủ/tắt mạng**: tunnel rớt; đánh thức máy, chờ kết nối lại rồi lấy link và gửi lại nếu đổi.
- **Đổi IP nhà**: không phải sửa DNS/router; cloudflared kết nối outbound lại. **Đổi máy**: clone/cài Docker lại, chuyển env an toàn và restore volume/backup; dữ liệu không đi theo tài khoản GitHub.
- **Timer không chạy**: kiểm tra `systemctl --user status eventhub-update.timer`, journal, linger và quyền nhóm docker. Repo có sửa đổi local sẽ không tự lấy scripts mới.
- **Đổi MYSQL_ROOT_PASSWORD nhưng DB không nhận**: env chỉ tạo mật khẩu ở lần khởi tạo DB; đổi mật khẩu DB đang có cần quy trình riêng, không xoá volume để chữa lỗi.

## 9. Backup trước thay đổi quan trọng

`deploy/backup.sh` hiện **không tương thích trực tiếp**: script cố định `.env.prod`, override Oracle `deploy/docker-compose.deploy.yml` và không chọn project `eventhub`. `APP_DIR`/`BACKUP_DIR` chỉ đổi đường dẫn, không thay được lệnh Compose. Không chạy script đó với env máy nhà; cần chỉnh nó ở công việc riêng nếu muốn tái sử dụng tự động.

Dùng logic dump tương đương với hàm `dc` ở mục 6 (trên máy nhà):

```bash
# Quyền riêng tư; lưu ngoài repo để tránh đưa dữ liệu lên Git.
umask 077
mkdir -p "$HOME/event-hub-backups"
backup_file="$HOME/event-hub-backups/eventhub-$(date -u +%Y%m%dT%H%M%S).sql.gz"
# pipefail giúp phát hiện cả lỗi mysqldump, không chỉ lỗi gzip.
set -o pipefail
dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' | gzip > "$backup_file"
gzip -t "$backup_file"
```

Chỉ coi backup thành công khi pipeline và `gzip -t` đều thành công. Bản dump chỉ chứa MySQL, không chứa ảnh hay env. Sao lưu thêm `eventhub_uploads_data` và env vào nơi riêng tư, chép ra ổ/máy khác. Ví dụ sao lưu ảnh khi app đã dừng ghi (dừng server/client/tunnel trước, MySQL vẫn chạy):

```bash
dc stop server client tunnel
# Dùng image server đã có; không cần cài package vào container.
dc run --rm --no-deps -T --entrypoint tar server -C /app/uploads -czf - . > "$HOME/event-hub-backups/uploads.tar.gz"
gzip -t "$HOME/event-hub-backups/uploads.tar.gz"
dc up -d
```

Khôi phục phải thử trên môi trường riêng trước. Trên máy đích đã có schema, dừng ghi và backup hiện trạng trước khi nhập dump (có thể ghi đè dữ liệu trùng khoá):

```bash
dc stop server client tunnel
gzip -dc "$HOME/event-hub-backups/TEN_BAN_BACKUP.sql.gz" | dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'
# Chỉ dùng file tar tin cậy do chính bạn tạo; giải nén vào volume ảnh.
dc run --rm --no-deps -T --entrypoint tar server -C /app/uploads -xzf - < "$HOME/event-hub-backups/uploads.tar.gz"
dc up -d
```

Chọn đúng file thật thay tên mẫu. Redis chủ yếu là cache; không thay thế backup MySQL. Restore dữ liệu không đồng nghĩa rollback migration an toàn: chọn schema/image tương thích rồi thử riêng trước.
