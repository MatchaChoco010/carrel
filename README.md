# pct — paper collection tool

論文を収集して markdown として手元に保持し、セマンティック検索を備えたうえで、Codex のエージェントと論文について議論するためのアプリケーション。

設計判断は [docs/design/](docs/design/) に番号付きの design doc として記録している。索引は [docs/design/INDEX.md](docs/design/INDEX.md)。

## 構成

| ディレクトリ | 中身 |
|---|---|
| `apps/server` | 常駐するサーバー。HTTP API・WebSocket・ジョブキュー・フィードの取得・MCP の口 |

論文とチャットは `$PCT_DATA`(NAS のマウント先)に markdown で置く。
設定は `$XDG_CONFIG_HOME/pct/config.json`、検索用の索引と運用状態は `$XDG_STATE_HOME/pct/` に置く。
索引をローカルディスクに置くのは、SQLite のロックがネットワークファイルシステム上で信頼できないことと、markdown から作り直せるためである。

## 必要なもの

- Node.js 22 以上、pnpm
- Codex CLI(認証済み)
- Ollama(埋め込みの生成に使う)
- Python(PDF の変換に使う)

## 開発

```sh
pnpm install
pnpm --filter @pct/server dev        # 型剥がしでそのまま実行する
pnpm --filter @pct/server typecheck
pnpm --filter @pct/server test
```

## 導入

```sh
pnpm --filter @pct/server build
apps/server/scripts/install-service.sh
```

systemd の user service として登録し、PC の起動時から動くよう lingering を有効にする(この操作にだけ sudo が要る)。
取り除くときは `apps/server/scripts/uninstall-service.sh` を実行する。

サーバーが待ち受けるのは `127.0.0.1` と tailscale のインターフェースだけで、物理 LAN には口を開けない。
