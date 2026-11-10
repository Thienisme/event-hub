#!/usr/bin/env bash
# Cài timer của user hiện tại, không cần sudo để ghi unit.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
# Escape ký tự đặc biệt của systemd trong đường dẫn ExecStart.
unit_script=${HOME_DEPLOY_DIR//\\/\\\\}
unit_script=${unit_script//\"/\\\"}
unit_script=${unit_script//%/%%}
unit_script=${unit_script//\$/\$\$}
echo 'Cài service và timer kiểm tra image mỗi 5 phút...'
cat > "$unit_dir/eventhub-update.service" <<UNIT
# Chạy một lượt cập nhật, lỗi được lưu trong journal của user.
[Unit]
Description=Event Hub pull-based update
[Service]
Type=oneshot
ExecStart=/bin/bash "$unit_script/update.sh"
UNIT
cat > "$unit_dir/eventhub-update.timer" <<'UNIT'
# Lịch theo đồng hồ để Persistent chạy bù khi máy bật lại.
[Unit]
Description=Check Event Hub images every five minutes
[Timer]
OnCalendar=*:0/5
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now eventhub-update.timer
printf 'Để timer chạy khi chưa đăng nhập: sudo loginctl enable-linger %q\n' "$USER"
echo 'Xem log: journalctl --user -u eventhub-update'
echo 'Gỡ: systemctl --user disable --now eventhub-update.timer'
echo 'Sau đó: rm ~/.config/systemd/user/eventhub-update.{service,timer}; systemctl --user daemon-reload'
