#!/usr/bin/env bash
set +x
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/_db-common.sh"
database='' keep=10
while (($#)); do
  case "$1" in
    --env-file) db_need_value "$@"; DB_ENV_FILE="$2"; shift 2 ;;
    --database) db_need_value "$@"; database="$2"; shift 2 ;;
    --keep) db_need_value "$@"; keep="$2"; shift 2 ;;
    *) db_error "Tham số không hợp lệ: $1" ;;
  esac
done
[[ "$keep" =~ ^[1-9][0-9]{0,5}$ ]] || db_error '--keep phải là số nguyên dương (tối đa 999999).'
for tool in mysqldump gzip zgrep; do command -v "$tool" >/dev/null || db_error "Thiếu $tool."; done
db_load
database="${database:-$DB_PRODUCTION}"
db_validate_name "$database"
echo "Bước 2: Backup $(db_connection_info "$database")"
mkdir -p backups
chmod 700 backups
output="$DB_REPO_ROOT/backups/$database-$(date +%Y%m%d-%H%M%S).sql.gz"
# Không ghi đè nếu hai lần backup trùng giây; file dở được trap dọn.
(set -o noclobber; : > "$output") 2>/dev/null || db_error 'Tên backup đã tồn tại; thử lại sau một giây.'
DB_PARTIAL_FILE="$output"
# Gom cờ tại đây để dễ chỉnh nếu phiên bản TiDB từ chối một cờ.
# KHÔNG dùng --single-transaction: mysqldump đặt SAVEPOINT cho từng bảng, TiDB Cloud báo
# "SAVEPOINT sp does not exist (1305)" và dừng. Hệ quả: các bảng được dump lần lượt chứ không
# cùng một thời điểm, nên hãy backup khi ít người dùng (demo nhỏ thì chấp nhận được).
dump_options=(
  --skip-lock-tables --routines=false --triggers
  --set-gtid-purged=OFF --no-tablespaces --column-statistics=0
  --hex-blob --default-character-set=utf8mb4
)
# pipefail giữ lỗi mysqldump; hex-blob bảo toàn ảnh MEDIUMBLOB.
mysqldump --defaults-extra-file="$DB_DEFAULTS_FILE" "${dump_options[@]}" -- "$database" | gzip > "$output"
echo 'Bước 3: Kiểm tra gzip và cấu trúc bảng.'
gzip -t -- "$output"
[[ -s "$output" ]] || db_error 'Backup rỗng.'
tables="$(zgrep -c 'CREATE TABLE' "$output" || true)"
[[ "$tables" =~ ^[0-9]+$ && "$tables" -gt 0 ]] || db_error 'Backup không chứa CREATE TABLE.'
DB_PARTIAL_FILE=''
echo "Kích thước: $(wc -c < "$output") byte; số bảng (CREATE TABLE): $tables"
echo "File backup: $output"
echo "Bước 4: Giữ $keep bản mới nhất của $database."
# Chỉ chọn đúng tên database và timestamp, không ảnh hưởng database khác.
mapfile -t old_files < <(python3 - "$DB_REPO_ROOT/backups" "$database" "$keep" <<'PY'
import pathlib, re, sys
root, name, keep = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
files = sorted((p for p in root.iterdir() if re.fullmatch(re.escape(name) + r'-\d{8}-\d{6}\.sql\.gz', p.name)), reverse=True)
for p in files[keep:]:
    print(p)
PY
)
for old in "${old_files[@]}"; do rm -- "$old"; echo "Đã xoá bản cũ: $old"; done
