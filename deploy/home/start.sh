#!/usr/bin/env bash
# Khởi động từ image có sẵn; Compose giữ thứ tự migration trước API.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
check_mac_docker
echo 'Tải image và khởi động; MySQL có thể cần thời gian tạo database...'
compose pull
# Tạo lại migration để áp dụng đầy đủ trước mỗi lần triển khai.
compose rm -sf migrate
compose up -d --no-build
echo 'Chờ API trả health thành công, tối đa 120 giây...'
deadline=$((SECONDS + 120))
while (( SECONDS < deadline )); do
  if COMPOSE_TIMEOUT=$((deadline - SECONDS)) compose exec -T server node -e "fetch('http://127.0.0.1:5000/api/health', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
    echo 'API đã sẵn sàng.'
    bash "$HOME_DEPLOY_DIR/url.sh"
    exit 0
  fi
  sleep 1
done
echo 'API chưa sẵn sàng sau 120 giây; xem logs server migrate mysql.' >&2
exit 1
