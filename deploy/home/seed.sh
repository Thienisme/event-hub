#!/usr/bin/env bash
# Seed dùng mật khẩu trong env server, không xoá dữ liệu test bằng purge.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
echo 'Tạo/đặt lại dữ liệu demo; nên backup trước khi chạy lại...'
compose exec -T server npm run seed:demo
