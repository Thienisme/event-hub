#!/usr/bin/env bash
# Timer tự kéo image; không có thay đổi thì chỉ ghi một dòng log ngoài repo.
set -euo pipefail
umask 077
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/eventhub"
mkdir -p "$state_dir"
exec 9>"$state_dir/update.lock"
flock -n 9 || exit 0
log() { printf '[%s] %s\n' "$(date -Is)" "$*" >> "$state_dir/update.log"; }
# Thu log lỗi mà không in biến môi trường hay secret.
trap 'log "Cập nhật thất bại tại dòng $LINENO; xem journalctl --user -u eventhub-update"' ERR
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
# Không tự bật lại app nếu người dùng đã down/stop sau demo.
if [[ -z "$(compose ps --status running -q server)" ]]; then
  log 'App đang dừng; bỏ qua cập nhật.'
  exit 0
fi
image_ids() {
  local image
  while IFS= read -r image; do
    docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || printf 'missing:%s\n' "$image"
  done < <(compose config --images | sort -u)
}
before=$(image_ids)
# Giữ timer im lặng nếu pull thành công và không có bản mới.
pull_output=$(compose pull 2>&1) || { log 'Pull image thất bại; xem journal.'; printf '%s\n' "$pull_output" >&2; exit 1; }
after=$(image_ids)
# So với container đang chạy để lần lỗi up trước đó vẫn được thử lại.
stale=false
for service in server client mysql redis tunnel; do
  id=$(compose ps --all -q "$service")
  [[ -n "$id" ]] || { stale=true; continue; }
  running_image=$(docker inspect --format '{{.Image}}' "$id")
  image_ref=$(docker inspect --format '{{.Config.Image}}' "$id")
  wanted=$(docker image inspect --format '{{.Id}}' "$image_ref")
  [[ "$running_image" == "$wanted" ]] || stale=true
done
if [[ "$before" == "$after" && "$stale" == false ]]; then
  log 'Không có image mới.'
  exit 0
fi
echo 'Có image mới: lấy compose/scripts rồi chạy migration và cập nhật app...'
log 'Bắt đầu cập nhật image.'
# Không ghi đè thay đổi local, kể cả file chưa được Git theo dõi.
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Cảnh báo: repo có thay đổi local; bỏ qua git pull, dùng cấu hình hiện tại.'
  log 'Bỏ qua git pull vì repo có thay đổi local.'
else
  GIT_TERMINAL_PROMPT=0 git pull --ff-only
fi
# Cấu hình vừa lấy có thể đổi image/tag; pull lại trước khi khởi động.
compose pull
compose rm -sf migrate
compose up -d --no-build
echo 'Dọn image dangling để tiết kiệm đĩa...'
docker image prune -f
log 'Cập nhật hoàn tất; Compose đã chờ các dependency healthy.'
