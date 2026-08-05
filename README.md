# carrel.

論文を収集して markdown として手元に保持し、セマンティック検索を備えたうえで、Codex のエージェントと論文について議論するためのアプリケーション。

## 構成

| ディレクトリ | 中身 |
|---|---|
| `apps/server` | 常駐するサーバー。HTTP API・WebSocket・ジョブキュー・フィードの取得・MCP の口 |
| `docs/design` | design doc |

論文とチャットは `$CARREL_DATA`(NAS のマウント先)に markdown で置く。
設定は `$XDG_CONFIG_HOME/carrel/config.json`、検索用の索引と運用状態は `$XDG_STATE_HOME/carrel/` に置く。

## 必要なもの

- Node.js 22 以上、pnpm
- Codex CLI(認証済み)
- Ollama(埋め込みの生成に使う)
- Python(PDF の変換に使う)

## 開発

```sh
pnpm install
pnpm --filter @carrel/server dev        # 型剥がしでそのまま実行する
pnpm --filter @carrel/server typecheck
pnpm --filter @carrel/server test
```

## 導入

```sh
pnpm --filter @carrel/server build
apps/server/scripts/install-service.sh
```

systemd の user service として登録し、PC の起動時から動くよう lingering を有効にする(この操作にだけ sudo が要る)。
取り除くときは `apps/server/scripts/uninstall-service.sh` を実行する。
