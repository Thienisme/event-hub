#!/usr/bin/env bash
# Chỉ đọc log container tunnel hiện tại, lấy URL xuất hiện cuối cùng.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
echo 'Tìm link Quick Tunnel, chờ tối đa 60 giây...'
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  # Lọc từ lần start hiện tại để không in link cũ sau khi container restart.
  tunnel_id=$(COMPOSE_TIMEOUT=$((deadline - SECONDS)) compose ps --all -q tunnel) || tunnel_id=''
  since=''
  if [[ -n "$tunnel_id" ]]; then
    since=$(timeout 2s docker inspect --format '{{.State.StartedAt}}' "$tunnel_id") || since=''
  fi
  (( SECONDS < deadline )) || break
  [[ -n "$since" ]] || { sleep 1; continue; }
  logs=$(COMPOSE_TIMEOUT=$((deadline - SECONDS)) compose logs --since "$since" --no-color tunnel 2>&1) || logs=''
  url=$(printf '%s\n' "$logs" | grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)
  if [[ -n "$url" ]]; then
    printf '\n========== LINK DEMO ==========\n%s\n===============================\n' "$url"
    echo 'Mở thử trên trình duyệt rồi gửi link này cho người xem; link có thể đổi khi tunnel kết nối lại.'
    exit 0
  fi
  sleep 1
done
echo 'Chưa có link. Xem log tunnel và kiểm tra máy có Internet; xem README.' >&2
exit 1
