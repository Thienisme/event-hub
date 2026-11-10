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
# Chọn nơi lưu log theo hệ điều hành; đường dẫn Mac có dấu cách.
OS_NAME=$(uname -s)
if [[ "$OS_NAME" == Darwin ]]; then
  state_dir="$HOME/Library/Application Support/eventhub"
else
  state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/eventhub"
fi
# Giới hạn lệnh bằng watchdog, không cần tiện ích timeout của GNU.
run_with_timeout() {
  local seconds=$1 command_pid watcher_pid result=0
  shift
  "$@" &
  command_pid=$!
  # Watcher KHÔNG được giữ stdout/stderr: nếu giữ, `$(...)` của người gọi phải chờ cả
  # tiến trình `sleep` bên trong (vẫn sống sau khi kill watcher) -> mọi lệnh tốn trọn timeout.
  ( sleep "$seconds"; kill -TERM "$command_pid" 2>/dev/null || exit 0
    sleep 2; kill -KILL "$command_pid" 2>/dev/null || true ) </dev/null >/dev/null 2>&1 &
  watcher_pid=$!
  wait "$command_pid" || result=$?
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  return "$result"
}
compose() {
  # Dùng if để tránh mở rộng mảng rỗng trên bash 3.2.
  if [[ -n "${COMPOSE_TIMEOUT:-}" ]]; then
    run_with_timeout "$COMPOSE_TIMEOUT" docker compose -p eventhub -f docker-compose.prod.yml -f deploy/home/docker-compose.home.yml --env-file deploy/home/.env.home "$@"
  else
    docker compose -p eventhub -f docker-compose.prod.yml -f deploy/home/docker-compose.home.yml --env-file deploy/home/.env.home "$@"
  fi
}
check_mac_docker() {
  if [[ "$OS_NAME" == Darwin ]] && ! docker info >/dev/null 2>&1; then
    echo 'Docker chưa sẵn sàng. Chạy: colima start --cpu 2 --memory 3 (hoặc mở Docker Desktop).' >&2
    echo 'Nếu thiếu lệnh docker, kiểm tra PATH Homebrew theo README.' >&2
    exit 1
  fi
}
