# プロジェクト固有の常時規約

<!-- 常時必要なプロジェクト固有の規約だけをここに書く。sync が harness/AGENTS.md(共有規約)と結合してルート AGENTS.md を生成する。 -->

## サーバーを立ち上げて動作を確かめるとき

`pnpm dev` を使う(口は 7818、設定と索引とコレクションはリポジトリの `.dev/` の中)。
本番のサーバーは別の clone を systemd で動かしていて(口は 7817)、設定も索引もコレクションも開発用と別である。
**本番の口を叩かない。本番の設定を書き替えない。**
運用の詳細は [docs/harness/dev-server.md](docs/harness/dev-server.md)。

## 変換・照合・翻訳の品質を比べるとき

変換器や Codex のモデル・reasoning effort を選び直すときは、[docs/evaluation-papers.md](docs/evaluation-papers.md) の論文セットで比べる。
どの論文が何を試すか、何を機械的に測れて何を目で見るしかないかを記録してある。
検証の仕組みは置いていないので、必要になった時点でスクリプトを書く。
