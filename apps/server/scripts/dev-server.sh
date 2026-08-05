#!/bin/sh
# 開発用の carrel サーバーを、本番と別の場所・別の口で立ち上げる。
#
# 本番(systemd の carrel-server.service)は ~/.config/carrel と ~/.local/state/carrel を使う。
# ここで XDG を差し替えるのは、動作確認の削除や設定の変更を本番へ届かせないためである。
# 設定・状態・コレクションはリポジトリの中の .dev/ に置くので、消せば初期状態に戻る。

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
dev="$repo/.dev"

XDG_CONFIG_HOME="$dev/config"
XDG_STATE_HOME="$dev/state"
export XDG_CONFIG_HOME XDG_STATE_HOME

# 変換と埋め込みを dGPU に載せる。理由は build/carrel-server.service に書いてある。
ROCR_VISIBLE_DEVICES="${ROCR_VISIBLE_DEVICES:-0}"
export ROCR_VISIBLE_DEVICES

config="$XDG_CONFIG_HOME/carrel/config.json"
if [ ! -f "$config" ]; then
  mkdir -p "$(dirname -- "$config")"
  # 欠けたキーはサーバーが既定値で埋める。ここには本番と違えたい値だけを書く。
  # 購読を空にするのは、開発用のサーバーが arXiv の取り込みと翻訳を回さないためである。
  # 変換器の venv は 16GB あるので clone ごとには持たず、開発用のものを指す。
  cat > "$config" <<JSON
{
  "dataDir": "$dev/data",
  "server": { "host": "127.0.0.1", "port": 7818 },
  "arxiv": { "categories": [] },
  "converter": { "python": "$repo/apps/converter/.venv/bin/python" }
}
JSON
  echo "開発用の設定を作った: $config"
fi

echo "設定: $config"
echo "状態: $XDG_STATE_HOME/carrel"
exec pnpm --filter @carrel/server dev
