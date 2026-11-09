#!/bin/sh
set -eu
sh /opt/nuqta-backup/files.sh init
while true; do
  if sh /opt/nuqta-backup/files.sh backup; then
    echo '{"component":"files_backup","healthy":true}'
    sleep 86400
  else
    echo '{"component":"files_backup","healthy":false}'
    sleep 900
  fi
done
