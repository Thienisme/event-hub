#!/usr/bin/env bash
set +x
set -euo pipefail

# Về gốc repo để đường dẫn mặc định không phụ thuộc nơi gọi.
DB_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$DB_REPO_ROOT"
DB_ENV_FILE=server/.env.render.local
DB_DEFAULTS_FILE=''
DB_PARTIAL_FILE=''
db_error() { echo "Lỗi: $*" >&2; exit 1; }
db_cleanup() {
  [[ -z "$DB_DEFAULTS_FILE" ]] || rm -f -- "$DB_DEFAULTS_FILE"
  [[ -z "$DB_PARTIAL_FILE" ]] || rm -f -- "$DB_PARTIAL_FILE"
  return 0
}
trap db_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

db_validate_name() {
  # Giới hạn tên để an toàn cho SQL, tên file và thao tác giữ bản cũ.
  [[ "$1" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$ ]] || db_error 'Tên database chỉ được chứa chữ, số, _, - (1–64 ký tự).'
}

db_load() {
  command -v python3 >/dev/null || db_error 'Thiếu python3.'
  [[ -r "$DB_ENV_FILE" ]] || db_error 'Không đọc được file env được chỉ định.'
  [[ -r /etc/ssl/certs/ca-certificates.crt ]] || db_error 'Không tìm thấy CA bundle.'
  echo 'Bước 1: Đọc DATABASE_URL an toàn và chuẩn bị TLS.'
  umask 077
  DB_DEFAULTS_FILE="$(mktemp)"
  chmod 600 "$DB_DEFAULTS_FILE"
  # Python tự đọc KEY=VALUE, không chạy nội dung env và không đưa secret vào argv.
  local metadata
  if ! metadata="$(python3 - "$DB_ENV_FILE" "$DB_DEFAULTS_FILE" <<'PY'
import sys, re
from urllib.parse import urlsplit, unquote
try:
    value = None
    with open(sys.argv[1], encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, sep, candidate = line.partition('=')
            if sep and key.strip() == 'DATABASE_URL':
                value = candidate.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
    if not value:
        raise ValueError()
    u = urlsplit(value)
    user, password = unquote(u.username or ''), unquote(u.password or '')
    host, port, database = u.hostname, u.port or 4000, unquote(u.path.lstrip('/'))
    if u.scheme != 'mysql' or not user or not host or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}', database):
        raise ValueError()
    if any(ord(c) < 32 or ord(c) == 127 for s in (user, password, host) for c in s):
        raise ValueError()
    def quote(s):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        f.write('[client]\n')
        for k, v in [('user', user), ('password', password), ('host', host), ('port', str(port))]:
            f.write(k + '=' + quote(v) + '\n')
        f.write('ssl-mode=VERIFY_IDENTITY\nssl-ca=/etc/ssl/certs/ca-certificates.crt\n')
    print(host, port, database, user, sep='\n')
except Exception:
    print('Lỗi: DATABASE_URL thiếu hoặc không hợp lệ; kiểm tra định dạng mysql:// và URL-encode.', file=sys.stderr)
    sys.exit(1)
PY
)"; then
    db_error 'Không thể nạp cấu hình kết nối.'
  fi
  local -a fields
  mapfile -t fields <<< "$metadata"
  DB_HOST="${fields[0]}" DB_PORT="${fields[1]}" DB_PRODUCTION="${fields[2]}" DB_USER="${fields[3]}"
}
db_connection_info() { printf '%s:%s/%s (user: %s)\n' "$DB_HOST" "$DB_PORT" "$1" "$DB_USER"; }
db_need_value() { [[ $# -ge 2 && -n "$2" ]] || db_error "Thiếu giá trị cho $1."; }
