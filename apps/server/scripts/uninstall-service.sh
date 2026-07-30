#!/bin/sh
# install-service.sh が置いたユニットを取り除く。
# 設定と索引は残す。消す場合は最後に表示するコマンドを実行する。

set -eu

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/pct-server.service"

if systemctl --user list-unit-files pct-server.service >/dev/null 2>&1; then
  systemctl --user disable --now pct-server.service || true
fi

rm -f "$unit"
systemctl --user daemon-reload

echo "取り除いた: $unit"
echo "設定と索引は残している。消す場合は次を実行する。"
echo "  rm -rf \"\${XDG_CONFIG_HOME:-\$HOME/.config}/pct\" \"\${XDG_STATE_HOME:-\$HOME/.local/state}/pct\""
