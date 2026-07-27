#!/bin/sh
# pct サーバーを systemd の user service として導入する。
# 取り除くときは uninstall-service.sh を実行する。

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
server_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
entry="$server_dir/dist/main.js"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/pct-server.service"

if [ ! -f "$entry" ]; then
  echo "ビルド結果が見つからない: $entry" >&2
  echo "先に 'pnpm --filter @pct/server build' を実行すること。" >&2
  exit 1
fi

node_bin=$(command -v node)

mkdir -p "$unit_dir"
sed -e "s#@NODE@#$node_bin#" -e "s#@SERVER_ENTRY@#$entry#" \
  "$server_dir/build/pct-server.service" > "$unit"

# ログインしていない状態でもサービスを動かすために lingering を有効にする。
if ! loginctl show-user "$(id -un)" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  echo "lingering を有効にする(sudo が必要)"
  sudo loginctl enable-linger "$(id -un)"
fi

systemctl --user daemon-reload
systemctl --user enable --now pct-server.service

echo "導入した: $unit"
systemctl --user --no-pager status pct-server.service || true
