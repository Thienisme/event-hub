#!/usr/bin/env bash
# Các script dùng chung đường dẫn và lệnh Compose để không nhầm project/volume.
set -euo pipefail
HOME_DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$HOME_DEPLOY_DIR/../.."
REPO_ROOT=$PWD
if [[ ! -f deploy/home/.env.home ]]; then
  echo 'Thiếu deploy/home/.env.home. Chạy: cp deploy/home/.env.home.example deploy/home/.env.home' >&2
  echo 'Điền secret riêng theo README rồi chạy lại; không đưa file này vào Git.' >&2
  exit 1
fi
compose() {
  # Giới hạn riêng cho vòng chờ health/link; các lệnh pull/up không giới hạn.
  local guard=()
  if [[ -n "${COMPOSE_TIMEOUT:-}" ]]; then guard=(timeout "${COMPOSE_TIMEOUT}s"); fi
  "${guard[@]}" docker compose -p eventhub -f docker-compose.prod.yml -f deploy/home/docker-compose.home.yml --env-file deploy/home/.env.home "$@"
}
