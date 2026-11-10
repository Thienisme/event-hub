#!/usr/bin/env bash
# Xoá container nhưng giữ volume để lần sau vẫn còn dữ liệu.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
echo 'Dừng app và tunnel, giữ nguyên dữ liệu...'
compose down
echo 'Dữ liệu vẫn còn trong volume. KHÔNG thêm -v nếu muốn giữ dữ liệu.'
