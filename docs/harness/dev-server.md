# 開発用サーバーと本番サーバーの運用

このドキュメントは **サーバーを立ち上げて動作を確かめるときに読む**。

## 2 つのサーバー

| | 本番 | 開発 |
| --- | --- | --- |
| 実行物 | 本番用に別途 clone したリポジトリの `apps/server/dist/main.js` | このリポジトリの `apps/server/src/main.ts`(watch) |
| 立ち上げ | systemd の user service `pct-server.service`(常時) | `pnpm dev`(作業中だけ) |
| 待ち受け | 7817 | 7818 |
| 設定 | `~/.config/pct/config.json` | `<repo>/.dev/config/pct/config.json` |
| 索引と状態 | `~/.local/state/pct` | `<repo>/.dev/state/pct` |
| コレクション | 設定の `dataDir` | `<repo>/.dev/data` |
| arXiv の購読 | 設定の通り | 空 |

本番を別の clone にしているのは、開発中のビルドが動いている本番の実行物を置き換えないようにするためである。
`pct-server.service` は設定と状態の置き場所を焼き込んで持つので、まわりの環境変数では動かない。

## 開発用のサーバー

`pnpm dev` が `apps/server/scripts/dev-server.sh` を呼ぶ。
このスクリプトが `XDG_CONFIG_HOME` と `XDG_STATE_HOME` を `.dev/` へ向け、初回は設定を作る。
画面を触るときは別の端末で `pnpm dev:web` を動かす(vite は `.dev/` の設定から回す先の口を読む)。

**開発用のサーバーは作業しているときだけ動かす。**
立ったままにすると arXiv の取り込みと翻訳が回り続け、Codex の利用量と GPU を無駄に使う。
購読を空にしてあるのは同じ理由である。取り込みの確認は URL を渡して手で行う。

`.dev/` は捨てて構わない。消せば次の `pnpm dev` が初期状態から作り直す。

## 本番に触らない

- 動作確認は 7818 で行う。7817 を叩かない。ブラウザで開くのも開発用の口(`http://localhost:5173` か 7818)だけにする。
- 本番の設定(`~/.config/pct/config.json`)を書き替えない。開発中の画面から設定を保存すると、回す先が本番だった場合はここが書き換わる。
- 論文や会話を消す確認は開発用のコレクションで行う。
- **vite を動かしたままブランチを切り替えない。** vite は `vite.config.ts` が変わると自分を立ち上げ直すので、切り替え先のブランチの指定を読み直す。回す先を `.dev/` の設定から読むより前のブランチへ切り替えて、本番へ回っていたことがある。作業を中断するときは止める。

## 2 つのサーバーが分け合っているもの

- **Codex の利用量**。本番も取り込みで使うので、週次の制限は共有である。
- **GPU**。変換(marker)と埋め込み(Ollama)が奪い合う。両方で重い処理を同時に回さない。
- **変換器の venv**。16GB あるので clone ごとには持たない。本番の設定の `converter.python` はこのリポジトリの `apps/converter/.venv/bin/python` を指す。この venv を動かす・消すときは本番の設定も直す。

## 本番を新しくする

本番用の clone で行う。

```sh
git pull --ff-only
pnpm install
pnpm build
# ユニットの内容が変わったときだけ
apps/server/scripts/install-service.sh
systemctl --user restart pct-server
```

`install-service.sh` は導入する時点の置き場所をユニットへ焼き込むので、`XDG_CONFIG_HOME` や `XDG_STATE_HOME` を持つ shell からは実行しない(スクリプト側でも拒否する)。
