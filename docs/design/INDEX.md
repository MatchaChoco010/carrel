# Design Docs 索引

pct(paper collection tool)の設計判断の記録。
番号は意思決定が行われた順に振る。

| # | タイトル | status | implementation |
|---|---|---|---|
| [0001](0001_architecture_and_deployment.md) | pct の全体アーキテクチャと配置 | approved | not-started |
| [0002](0002_data_contract.md) | 論文とチャットのデータ契約 | approved | not-started |
| [0003](0003_codex_integration.md) | Codex の使い分けとレート制限の運用 | approved | not-started |
| [0004](0004_paper_ingestion_and_feed.md) | 論文の取り込みと arXiv フィード | approved | not-started |
| [0005](0005_search_and_agent_access.md) | 検索とエージェントへのコレクションの公開 | approved | not-started |
| [0006](0006_chat_lifecycle.md) | チャットのライフサイクル | approved | not-started |
| [0007](0007_network_exposure.md) | ネットワークの公開範囲 | approved | done (2026-07-27) |
| [0008](0008_conversion_runtime.md) | 論文の変換に使う実装と実行環境 | approved | not-started |
| [0009](0009_text_authority_in_verification.md) | 照合で文字の正をどこに置くか | approved | not-started |
| [0010](0010_reading_text_in_verification.md) | 変換から文字の読み取りを外し、照合に任せる | approved | done (2026-07-29) |
| [0011](0011_parallel_translation.md) | 翻訳を節ごとに並べて走らせる | approved | done (2026-07-29) |
| [0012](0012_chat_branching.md) | 会話の分岐に turn の識別子を持たせる | approved | done (2026-07-30) |
| [0013](0013_chat_images.md) | チャットで画像を扱う | reviewing | not-started |

件数: 13
