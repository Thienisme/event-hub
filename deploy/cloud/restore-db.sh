#!/usr/bin/env bash
set +x
set -euo pipefail
# Giữ đường dẫn file đầu vào theo nơi gọi trước khi common cd về gốc repo.
input='' database='' yes=false allow_production=false
caller_dir="$PWD"
source "$(dirname -- "${BASH_SOURCE[0]}")/_db-common.sh"
while (($#)); do
  case "$1" in
    --env-file) db_need_value "$@"; DB_ENV_FILE="$2"; shift 2 ;;
    --database) db_need_value "$@"; database="$2"; shift 2 ;;
    --yes) yes=true; shift ;;
    --i-know-this-overwrites-production) allow_production=true; shift ;;
    -*) db_error "Tham số không hợp lệ: $1" ;;
    *) [[ -z "$input" ]] || db_error 'Chỉ nhận một file backup.'; input="$1"; shift ;;
  esac
done
[[ -n "$database" && -n "$input" ]] || db_error 'Cách dùng: restore-db.sh <file.sql.gz> --database <tên đích> [--yes] [--env-file <file>]'
db_validate_name "$database"
[[ "$input" = /* ]] || input="$caller_dir/$input"
[[ -r "$input" && "$input" = *.sql.gz ]] || db_error 'Cần file .sql.gz đọc được.'
for tool in mysql gunzip gzip; do command -v "$tool" >/dev/null || db_error "Thiếu $tool."; done
gzip -t -- "$input"
db_load
echo "Bước 2: Chuẩn bị khôi phục vào $(db_connection_info "$database")"
echo 'CẢNH BÁO: dump có DROP TABLE IF EXISTS, sẽ ghi đè bảng trùng tên.'
if [[ "$database" == "$DB_PRODUCTION" ]]; then
  "$allow_production" || db_error 'Đích là production; cần --i-know-this-overwrites-production.'
  echo "Gõ lại đúng tên database '$database' để xác nhận ghi đè production:"
  read -r confirmation || db_error 'Không nhận được xác nhận.'
  [[ "$confirmation" == "$database" ]] || db_error 'Tên xác nhận không khớp.'
  echo 'Bước 3: Tạo backup an toàn của production trước khi ghi đè.'
  # Script con tự kiểm tra backup và in đường dẫn; lỗi sẽ chặn restore.
  bash "$DB_REPO_ROOT/deploy/cloud/backup-db.sh" --env-file "$DB_ENV_FILE" --database "$DB_PRODUCTION"
elif ! "$yes"; then
  echo 'Bạn đồng ý ghi đè các bảng trùng tên ở database đích? [y/N]'
  read -r confirmation || db_error 'Không nhận được xác nhận.'
  [[ "$confirmation" == y || "$confirmation" == Y ]] || db_error 'Đã huỷ khôi phục.'
fi
echo 'Bước 4: Tạo database nếu thiếu và nạp dump (có thể mất thời gian).'
mysql --defaults-extra-file="$DB_DEFAULTS_FILE" --execute="CREATE DATABASE IF NOT EXISTS \`$database\` CHARACTER SET utf8mb4;"
gunzip -c -- "$input" | mysql --defaults-extra-file="$DB_DEFAULTS_FILE" --default-character-set=utf8mb4 -- "$database"
echo 'Bước 5: Đếm dòng các bảng chính để đối chiếu.'
for table in users events ticket_types orders tickets stored_files; do
  mysql --defaults-extra-file="$DB_DEFAULTS_FILE" --batch --skip-column-names --execute="SELECT '$table', COUNT(*) FROM \`$table\`;" -- "$database"
done
echo "Đã khôi phục vào $database."
