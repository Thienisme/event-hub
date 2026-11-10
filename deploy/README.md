# Triển khai Event Hub trên Oracle ARM64

Tài liệu dành cho người mới: thực hiện theo thứ tự, thay mọi giá trị mẫu.
Các lệnh cài đặt bên dưới chạy **trên VM của bạn**, cần Internet; không chạy trên máy chứa dữ liệu quan trọng.
Ứng dụng vẫn là dự án học tập, thanh toán giả lập và đang tắt ở production.

## 1. Hiểu luồng hoạt động

```text
Người dùng -> Caddy (HTTPS :443) -> nginx client :80
                                  | /api, /uploads
                                  v
                               server Node :5000 -> MySQL
                                                -> Redis

GitHub Actions (ARM64) -> GHCR (image) -> VM Oracle (pull + Compose)
```

- **VPS/VM**: máy Linux thuê trên cloud, hoạt động liên tục.
- **SSH key**: cặp khoá; public key đặt trên VM, private key giữ kín để đăng nhập.
- **Reverse proxy**: nhận request rồi chuyển tới dịch vụ bên trong; Caddy nhận HTTPS, nginx phục vụ Vue và chuyển API.
- **HTTPS/Let's Encrypt**: mã hoá kết nối bằng chứng chỉ miễn phí, Caddy tự xin và gia hạn.
- **Image/container**: image là bản đóng gói phần mềm; container là tiến trình chạy từ image. Volume giữ dữ liệu ngoài container.
- **GHCR/registry**: kho image trên GitHub; VM tải image thay vì tự build.
- **CI/CD**: CI kiểm thử thay đổi; CD đóng gói và triển khai. CI hiện chạy trên PR, CD chạy khi push main; nên bảo vệ main, yêu cầu CI đạt trước khi merge.
- **Secrets**: dữ liệu nhạy cảm như khoá SSH và mật khẩu, đặt trong GitHub Secrets hoặc file env riêng, không đưa vào Git.

Chỉ cổng 80/443 public. MySQL, Redis và API nằm trong mạng Docker. Không chạy `docker compose down -v`: lệnh này xoá volume dữ liệu.

## 2. Tạo VM Always Free

1. Trong Oracle Cloud, tạo Compute Instance, chọn region còn dung lượng.
2. Chọn **VM.Standard.A1.Flex**, **2 OCPU / 12 GB RAM**, image **Ubuntu 24.04 aarch64/ARM64**.
3. Kiểm tra nhãn **Always Free eligible** trên tài nguyên; boot volume cũng phải trong hạn mức miễn phí toàn tài khoản.
4. Tạo/tải SSH key và lưu private key an toàn. Ghi lại public IPv4 của VM.
5. Vào VCN → subnet → **Security List → Ingress Rules**, thêm:
   - Source `0.0.0.0/0`, protocol TCP, destination port `80`.
   - Source `0.0.0.0/0`, protocol TCP, destination port `443`.
   - Tuỳ chọn UDP `443` cho HTTP/3; TCP vẫn hoạt động khi không mở UDP.
6. Giữ rule SSH TCP 22; giới hạn nguồn về IP của bạn khi thực hành. Nếu dùng NSG, kiểm tra rule NSG tương ứng. Runner GitHub cũng cần truy cập SSH cho CD.

Chỉ dùng tài nguyên Always Free, kiểm tra tổng quota cả tài khoản. Không nâng cấp **Pay As You Go** khi chưa hiểu chi phí. Tạo **Budget alert**; cảnh báo ngân sách không tự chặn phát sinh phí.

## 3. SSH và chuẩn bị máy

Trên máy cá nhân (thay IP và đường dẫn key):

```bash
chmod 600 ~/.ssh/oracle.key
ssh -i ~/.ssh/oracle.key ubuntu@1.2.3.4
```

Clone trước để có script setup (nếu thiếu Git: `sudo apt-get update && sudo apt-get install -y git`):

```bash
git clone https://github.com/Thienisme/event-hub.git ~/event-hub
cd ~/event-hub
sudo bash deploy/server-setup.sh
exit
```

SSH lại rồi kiểm tra:

```bash
cd ~/event-hub
docker version
docker compose version
free -h
```

Compose cần **>= 2.24.4** để hiểu `!reset`. Script cài Docker chính thức, mở iptables trước REJECT của Oracle (INPUT và DOCKER-USER), lưu bằng netfilter-persistent, thêm swap 2GB và bật cập nhật bảo mật. Nó giữ cổng SSH hiện có. Nhóm docker có quyền tương đương root: chỉ thêm user tin cậy. Nếu có `/var/run/reboot-required`, lên lịch reboot, SSH lại và kiểm tra.

## 4. Chuẩn bị hostname, env và GHCR

Ví dụ IP `1.2.3.4` → hostname `1-2-3-4.sslip.io`. Dùng **IP public thực tế**, không dùng IP private.
sslip.io giúp hostname phân giải về IP; không cần mua domain.

```bash
cd ~/event-hub
# .env.prod chưa được .gitignore gốc loại trừ: bỏ qua riêng tại checkout VM.
printf '\n.env.prod\n' >> .git/info/exclude
umask 077
cp deploy/.env.prod.example .env.prod
chmod 600 .env.prod
openssl rand -hex 32
# Chạy lại để tạo từng secret riêng, rồi sửa file bằng editor.
nano .env.prod
```

Thay DOMAIN, CORS_ORIGINS cùng hostname, ba mật khẩu/secret riêng; giữ MySQL password dạng hex vì compose ghép vào URL. File mẫu liệt kê đủ biến của compose gốc và override. Đừng gửi file env, log có secret hay private key lên GitHub. Không dùng `source .env.prod`.

Trên GitHub → Actions → Deploy ARM64 → Run workflow (main). Lần đầu chưa đặt DEPLOY_HOST: workflow chỉ build.
Trong trang Packages của GitHub, mở **cả hai package** `event-hub-server` và `event-hub-client` → Package settings → Change visibility → **Public**. Repo public không đảm bảo package tự public.
VM tải public image không cần token. Nếu giữ package private, cần tự cấu hình `docker login ghcr.io` trên VM bằng token chỉ có read:packages; không ghi token vào repo.

## 5. Chạy lần đầu

Trong `~/event-hub`, mọi lệnh compose deploy phải dùng đủ hai file và env:

```bash
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod config -q
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod up -d
```

Migrate đợi MySQL healthy; server đợi migrate thành công và Redis healthy; client đợi server healthy. Caddy đợi client, tự chuyển HTTP sang HTTPS. Mở `https://1-2-3-4.sslip.io` và `https://1-2-3-4.sslip.io/api/health`.
Lần xin chứng chỉ đầu có thể cần hơn 60 giây; xem log và chạy lại deploy nếu cần.

Để viết lệnh ngắn trong **phiên shell hiện tại**:

```bash
dc() { docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod "$@"; }
dc ps
dc logs -f server
dc logs --tail=100 migrate caddy
```

Không dùng riêng compose gốc trên VM: file đó giữ hành vi build local, client tại localhost:8081; Caddy có profile nên không tự bật.

## 6. Seed demo (tuỳ chọn, chỉ trên database demo)

Image server chứa sẵn `ts-node`, `src/` và `tsconfig.json`, nên chạy seed ngay trong container đang chạy:

```bash
dc exec server npm run seed:demo
```

> 📘 `exec` = chạy thêm một lệnh bên trong container đang chạy (giống mở terminal vào trong nó). Seed dùng chung database,
> Redis và volume ảnh với API nên ảnh demo hiện ngay trên web.

SEED_DEMO_PASSWORD được truyền từ env qua override. Script tạo tài khoản demo liệt kê trong README gốc và đặt lại sự kiện demo khi chạy lại; sao lưu trước. Không dùng `--purge-test` ở production.

## 7. Bật CD qua GitHub Secrets

1. Tạo key SSH riêng cho deploy trên máy cá nhân: `ssh-keygen -t ed25519 -f ~/.ssh/eventhub_deploy` (không passphrase để runner tự động dùng).
2. Thêm nội dung public key `.pub` vào `~/.ssh/authorized_keys` của user ubuntu trên VM, không thay thế key đang dùng; đặt thư mục 700, file 600.
3. Repo → Settings → Secrets and variables → Actions → New repository secret:
   - `DEPLOY_HOST`: IP public, ví dụ `1.2.3.4` (không kèm scheme/port).
   - `DEPLOY_USER`: `ubuntu`.
   - `DEPLOY_SSH_KEY`: toàn bộ private key deploy, gồm BEGIN/END.
4. Checkout VM phải ở branch main, đường dẫn `~/event-hub`, không có thay đổi tracked local. Tắt interactive git credential cho public clone nếu từng cấu hình credential riêng.
5. Push/merge main hoặc bấm Run workflow. Build ARM64 native tạo tag latest và sha-7-ký-tự. Deploy truyền tag SHA nên không bị latest đổi giữa chừng.

Workflow dùng ssh-keyscan và StrictHostKeyChecking. Keyscan chỉ lấy khoá đang được mạng trả về, không tự chứng minh danh tính máy. Khi setup, đối chiếu fingerprint host qua Oracle Console (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`); nếu cần pin chống MITM nghiêm ngặt, bổ sung known_hosts đã xác minh trong tác vụ tiếp theo.

Build job đưa secret host qua env để xét if, xuất cờ boolean; deploy job chỉ chạy khi cờ có giá trị. Không đặt DEPLOY_HOST thì job deploy bị skip, workflow vẫn build bình thường.
Concurrency tuần tự hoá workflow; flock bảo vệ deploy manual. Script pull --ff-only, pull image, tạo lại migrate, up, prune dangling và kiểm tra HTTPS health tối đa 60 giây. Thất bại trả exit 1, **không tự rollback**.

## 8. Rollback và kiểm tra log

Ghi lại tag SHA tốt từ Actions trước mỗi deploy. Rollback code:

```bash
cd ~/event-hub
IMAGE_TAG=sha-abcdef0 bash deploy/deploy.sh
```

Thay tag mẫu bằng tag đã có thật. Script vẫn lấy compose mới từ main; rollback chỉ image, không rollback cấu hình hay migration DB. Nếu migration không tương thích ngược, cần phương án restore DB đã thử nghiệm; không chạy downgrade mù.
Sau rollback, sửa IMAGE_TAG trong .env.prod nếu muốn các lần chạy tay tiếp theo giữ tag đó. CD lần tiếp theo vẫn dùng SHA mới.

```bash
dc logs -f server
dc logs --tail=100 mysql redis migrate client caddy
dc ps -a
```

## 9. Backup và khôi phục

```bash
cd ~/event-hub
./deploy/backup.sh
crontab -e
```

Thêm (đường dẫn tuyệt đối):

```cron
# Backup 03:00 theo timezone của VM, giữ 7 lần thành công gần nhất.
0 3 * * * /home/ubuntu/event-hub/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

Kiểm tra `timedatectl`; TZ trong env chỉ đặt cho app, không đổi timezone cron.
Backup ở `~/event-hub-backups`, quyền riêng tư, gzip; script lấy password/database từ môi trường container MySQL do compose đọc .env.prod.
Kiểm tra `gzip -t <file.sql.gz>`, sao chép ra máy khác với đường truyền bảo mật. Backup cùng VM sẽ mất khi VM/đĩa bị xoá.

Khôi phục: dừng ghi dữ liệu, sao lưu hiện trạng, chọn đúng bản rồi chạy (sẽ thay dữ liệu trùng khoá; chỉ làm khi hiểu ảnh hưởng):

```bash
dc stop server client caddy
gzip -dc ~/event-hub-backups/TEN_BAN_BACKUP.sql.gz | \
  dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'
dc up -d
```

Dump chỉ chứa database; **uploads_data** phải backup riêng (ảnh), cùng .env.prod và kế hoạch khôi phục lưu an toàn. Redis là cache, không thay thế backup MySQL. Thử restore trên môi trường riêng trước khi tin dùng.

## 10. Domain thật và lỗi thường gặp

Sau này tạo bản ghi A trên Cloudflare trỏ IP VM, ban đầu chọn **DNS only**. Đổi DOMAIN/CORS_ORIGINS trong .env.prod, chạy deploy lại để Caddy xin chứng chỉ mới. Nếu bật proxy Cloudflare, dùng SSL **Full (strict)**, tránh Flexible gây vòng redirect.

- **Không vào web**: kiểm tra IP public, Security List/NSG TCP 80/443, `sudo iptables -S INPUT`, `sudo iptables -S DOCKER-USER`, container và port bằng `dc ps`. Không flush firewall hay xoá rule SSH.
- **Caddy không xin chứng chỉ**: hostname phải phân giải đúng IP, 80/443 tới đúng VM, không có nginx/Apache host chiếm port; xem `dc logs caddy`. sslip.io hoặc CA có thể giới hạn cấp chứng chỉ; không xoá volume chứng chỉ để thử liên tục.
- **Migration/API lỗi**: xem `dc logs migrate server mysql`. Nếu MySQL đã có dữ liệu, đổi MYSQL_ROOT_PASSWORD trong env không tự đổi password DB; phải đổi trong DB theo quy trình riêng.
- **Hết RAM/OOM**: kiểm tra `free -h`, `docker stats --no-stream`, `swapon --show`, dung lượng `df -h`; swap chỉ là dự phòng. Build ở Actions để VM đỡ tải; không mở thêm dịch vụ nặng.
- **Pull denied**: package GHCR chưa public hoặc image/tag chưa build thành công. Image chỉ ARM64, không chạy native trên máy x86.
- **Health timeout**: kiểm tra migration, log Caddy và DNS; deploy có thể đã lên nhưng CA chưa cấp chứng chỉ. Sửa nguyên nhân rồi chạy lại.
- **Git pull bị từ chối**: giữ checkout main sạch; không reset --hard mù khi có thay đổi cần giữ.
- **Oracle thu hồi máy rảnh/thiếu dung lượng A1**: Always Free có chính sách thu hồi tài nguyên idle và khả năng hết capacity. Giữ backup ngoài VM, không tạo tải giả để né chính sách; theo dõi thông báo Console và quota hiện tại.
