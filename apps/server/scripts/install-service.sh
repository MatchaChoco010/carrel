#!/bin/sh
# pct サーバーを systemd の user service として導入する。
# 取り除くときは uninstall-service.sh を実行する。

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
server_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo=$(CDPATH= cd -- "$server_dir/../.." && pwd)
entry="$server_dir/dist/main.js"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
unit_dir="$config_home/systemd/user"
unit="$unit_dir/pct-server.service"

if [ ! -f "$entry" ]; then
  echo "ビルド結果が見つからない: $entry" >&2
  echo "先に 'pnpm --filter @pct/server build' を実行すること。" >&2
  exit 1
fi

# 置き場所はユニットに焼き込むので、開発用の場所を指した shell から導入すると
# 本番のサーバーが開発用の設定と索引を掴む。
for dir in "$config_home" "$state_home"; do
  case "$dir/" in
    "$repo"/*)
      echo "開発用の置き場所を指した状態で導入しようとしている: $dir" >&2
      echo "XDG_CONFIG_HOME と XDG_STATE_HOME を持たない shell から実行すること。" >&2
      exit 1
      ;;
  esac
done

node_bin=$(command -v node)

mkdir -p "$unit_dir"
sed -e "s#@NODE@#$node_bin#" -e "s#@SERVER_ENTRY@#$entry#" \
  -e "s#@XDG_CONFIG_HOME@#$config_home#" -e "s#@XDG_STATE_HOME@#$state_home#" \
  "$server_dir/build/pct-server.service" > "$unit"

# ログインしていない状態でもサービスを動かすために lingering を有効にする。
if ! loginctl show-user "$(id -un)" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  echo "lingering を有効にする(sudo が必要)"
  sudo loginctl enable-linger "$(id -un)"
fi

systemctl --user daemon-reload
systemctl --user enable --now pct-server.service

echo "導入した: $unit"
echo "  実行物: $entry"
echo "  設定:   $config_home/pct"
echo "  状態:   $state_home/pct"
systemctl --user --no-pager status pct-server.service || true
