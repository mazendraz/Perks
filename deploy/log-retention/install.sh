#!/bin/sh
set -eu
umask 022
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mode=${1:-}
case "$mode" in
  --stage)
    test "$#" -eq 2
    destination=$(realpath -e -- "$2")
    test -d "$destination"
    test "$destination" != /
    ;;
  --apply-on-server)
    test "$#" -eq 1
    test "$(id -u)" = 0
    test -d /run/systemd/system
    destination=''
    ;;
  *) echo 'Use --stage <existing-review-directory>. Applying to the approved dedicated host requires --apply-on-server.'; exit 0;;
esac
for target in etc/systemd/journald.conf.d/90-nuqta-retention.conf etc/systemd/system/nuqta-log-retention.service etc/systemd/system/nuqta-log-retention.timer; do
  if test -e "$destination/$target" || test -L "$destination/$target"; then
    echo 'Existing retention configuration retained; review it before changing host policy.' >&2
    exit 1
  fi
done
install -D -m 644 "$source_dir/journald.conf" "$destination/etc/systemd/journald.conf.d/90-nuqta-retention.conf"
install -D -m 644 "$source_dir/nuqta-log-retention.service" "$destination/etc/systemd/system/nuqta-log-retention.service"
install -D -m 644 "$source_dir/nuqta-log-retention.timer" "$destination/etc/systemd/system/nuqta-log-retention.timer"
if test "$mode" = --apply-on-server; then
  systemd-analyze verify /etc/systemd/system/nuqta-log-retention.service /etc/systemd/system/nuqta-log-retention.timer
  systemctl daemon-reload
  systemctl restart systemd-journald
  systemctl enable --now nuqta-log-retention.timer
  echo 'Host journal policy installed. Apply compose.retention.yml at the planned launch; existing container drivers were not changed.'
else
  echo 'Review files staged only. No host settings, services, containers or journals were changed.'
fi
