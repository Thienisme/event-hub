#!/usr/bin/env bash
# Chạy bằng sudo trên Ubuntu 24.04 ARM64 mới; có thể chạy lại an toàn.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Chạy: sudo bash deploy/server-setup.sh'; exit 1; }
target_user=${SUDO_USER:-ubuntu}
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && "$(dpkg --print-architecture)" == arm64 ]] || {
  echo 'Script dành cho Ubuntu 24.04 ARM64.'; exit 1;
}
echo '1/6 Cập nhật hệ thống và công cụ tải khoá Docker...'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git openssl python3
echo '2/6 Cài Docker Engine và Compose từ repo chính thức...'
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
# Repo giới hạn kiến trúc ARM64, xác thực bằng khoá vừa tải.
cat > /etc/apt/sources.list.d/docker.sources <<REPO
# Kho Docker chính thức cung cấp Engine và Compose plugin.
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
REPO
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker "$target_user"
echo '3/6 Mở firewall Oracle trước REJECT, không đổi rule SSH...'
# Tránh câu hỏi cài đặt; lưu cả rule hiện tại sau khi thêm ACCEPT.
apt-get install -y iptables-persistent netfilter-persistent
for chain in INPUT DOCKER-USER; do
  # DOCKER-USER bảo vệ cả lưu lượng DNAT tới container.
  iptables -nL "$chain" >/dev/null 2>&1 || continue
  for proto in tcp udp; do
    ports=443
    [[ "$proto" == tcp ]] && ports=80,443
    iptables -C "$chain" -p "$proto" -m multiport --dports "$ports" -j ACCEPT 2>/dev/null ||
      iptables -I "$chain" 1 -p "$proto" -m multiport --dports "$ports" -j ACCEPT
  done
done
netfilter-persistent save
echo '4/6 Tạo swap 2GB nếu chưa có, giảm nguy cơ bị OOM...'
if [[ ! -f /swapfile ]]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile
grep -qE '^/swapfile[[:space:]]' /etc/fstab ||
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo '5/6 Bật cập nhật bảo mật tự động...'
apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
// Cập nhật danh sách và cài bản vá bảo mật hàng ngày.
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades
echo "6/6 Hoàn tất. Đăng xuất/SSH lại để $target_user có quyền Docker."
echo 'Kiểm tra /var/run/reboot-required; khởi động lại nếu hệ thống yêu cầu.'
