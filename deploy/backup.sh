#!/usr/bin/env bash
# Crontab mẫu (03:00 theo timezone VM, thay đường dẫn):
# 0 3 * * * /home/ubuntu/event-hub/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
set -euo pipefail
umask 077
cd "${APP_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# Lưu ngoài repo, tránh vô tình commit dữ liệu thật.
backup_dir=${BACKUP_DIR:-$HOME/event-hub-backups}
mkdir -p "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || exit 0
compose=(docker compose -f docker-compose.prod.yml -f deploy/docker-compose.deploy.yml --env-file .env.prod)
tmp=$(mktemp "$backup_dir/.dump.XXXXXX")
trap 'rm -f "$tmp"' EXIT
# Password lấy từ môi trường container; snapshot InnoDB không khoá bảng lâu.
"${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' | gzip > "$tmp"
file="$backup_dir/eventhub-$(date -u +%Y%m%dT%H%M%S%N).sql.gz"
mv "$tmp" "$file"
# Timestamp UTC sắp theo tên; chỉ xoá bản cũ sau khi dump thành công.
mapfile -t backups < <(find "$backup_dir" -maxdepth 1 -name 'eventhub-*.sql.gz' -type f -printf '%f\n' | sort -r)
for ((i=7; i<${#backups[@]}; i++)); do rm -- "$backup_dir/${backups[i]}"; done
echo "Đã backup: $file (giữ 7 bản gần nhất)."
