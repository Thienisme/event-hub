#!/usr/bin/env bash
# Cài timer của user hiện tại, không cần sudo để ghi unit.
set -euo pipefail
HOME_DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode=${1:-}
[[ $# -le 1 && ( -z "$mode" || "$mode" == --uninstall ) ]] || { echo 'Dùng: install-autoupdate.sh [--uninstall]' >&2; exit 1; }
case $(uname -s) in
Darwin)
  state_dir="$HOME/Library/Application Support/eventhub"
  plist="$HOME/Library/LaunchAgents/com.eventhub.update.plist"
  domain="gui/$(id -u)"
  if [[ "$mode" == --uninstall ]]; then
    launchctl bootout "$domain/com.eventhub.update" 2>/dev/null || launchctl unload -w "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo 'Đã gỡ LaunchAgent; giữ lại log.'
    exit 0
  fi
  mkdir -p "$(dirname "$plist")" "$state_dir"
  # Escape XML để đường dẫn chứa &, dấu nháy vẫn dùng được.
  xml_escape() {
    local value=$1
    value=${value//&/\&amp;}
    value=${value//</\&lt;}
    value=${value//>/\&gt;}
    printf '%s' "$value"
  }
  script_xml=$(xml_escape "$HOME_DEPLOY_DIR/update.sh")
  state_xml=$(xml_escape "$state_dir")
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.eventhub.update</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$script_xml</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$state_xml/launchd.stdout.log</string>
  <key>StandardErrorPath</key><string>$state_xml/launchd.stderr.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict></plist>
PLIST
  # Gỡ bản cũ trước khi nạp lại; load dành cho macOS cũ.
  launchctl bootout "$domain/com.eventhub.update" 2>/dev/null || launchctl unload -w "$plist" 2>/dev/null || true
  launchctl bootstrap "$domain" "$plist" || launchctl load -w "$plist"
  printf 'Xem log: tail -n 20 "%s/update.log"\n' "$state_dir"
  printf 'Log launchd: "%s/launchd.stdout.log" và "%s/launchd.stderr.log"\n' "$state_dir" "$state_dir"
  printf 'Gỡ: launchctl bootout %s/com.eventhub.update; rm "%s"\n' "$domain" "$plist"
  echo 'Hoặc chạy lại script với --uninstall (có fallback cho macOS cũ).'
  exit 0
  ;;
Linux) ;;
*) echo 'Chỉ hỗ trợ macOS và Linux.' >&2; exit 1 ;;
esac
unit_dir="$HOME/.config/systemd/user"
if [[ "$mode" == --uninstall ]]; then
  systemctl --user disable --now eventhub-update.timer
  systemctl --user stop eventhub-update.service
  rm -f "$unit_dir/eventhub-update.service" "$unit_dir/eventhub-update.timer"
  systemctl --user daemon-reload
  echo 'Đã gỡ systemd user timer; giữ lại log và cấu hình linger.'
  exit 0
fi
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
