#!/usr/bin/env bash
# Chạy trên VM, mặc định thư mục app là cha của script.
set -euo pipefail
cd "${APP_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# Không để hai phiên manual/SSH thay container cùng lúc.
exec 9>/tmp/event-hub-deploy.lock
flock -n 9 || { echo 'Đang có phiên deploy khác.'; exit 1; }
echo 'Lấy cấu hình mới bằng fast-forward...'
git pull --ff-only origin main
# Compose đọc env như dữ liệu, không source như mã shell.
compose=(docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod)
DOMAIN=$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["caddy"]["environment"]["DOMAIN"])')
echo 'Tải image và chạy migration trước API...'
"${compose[@]}" pull
# Tạo lại job migration cả khi deploy lại cùng tag.
"${compose[@]}" rm -sf migrate
"${compose[@]}" up -d --no-build
echo 'Dọn image dangling; giữ image có tag để rollback.'
docker image prune -f
# Giới hạn thời gian thực 60 giây, chỉ chấp nhận đúng HTTP 200.
echo "Chờ https://$DOMAIN/api/health..."
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  remaining=$((deadline - SECONDS))
  if code=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time "$remaining" "https://$DOMAIN/api/health") && [[ "$code" == 200 ]]; then
    echo 'Deploy thành công: health HTTP 200.'
    exit 0
  fi
  (( SECONDS >= deadline )) || sleep 1
done
echo 'Deploy thất bại sau 60 giây; xem logs server/migrate/caddy.' >&2
exit 1
