# Design Docs 索引

pct(paper collection tool)の設計判断の記録。
番号は意思決定が行われた順に振る。

| # | タイトル | status | implementation |
|---|---|---|---|
| [0001](0001_architecture_and_deployment.md) | pct の全体アーキテクチャと配置 | approved | done (2026-07-30) |
| [0002](0002_data_contract.md) | 論文とチャットのデータ契約 | approved | done (2026-07-27) |
| [0003](0003_codex_integration.md) | Codex の使い分けとレート制限の運用 | approved | done (2026-07-27) |
| [0004](0004_paper_ingestion_and_feed.md) | 論文の取り込みと arXiv フィード | approved | done (2026-07-29) |
| [0005](0005_search_and_agent_access.md) | 検索とエージェントへのコレクションの公開 | approved | done (2026-07-30) |
| [0006](0006_chat_lifecycle.md) | チャットのライフサイクル | approved | done (2026-07-30) |
| [0007](0007_network_exposure.md) | ネットワークの公開範囲 | approved | done (2026-07-27) |
| [0008](0008_conversion_runtime.md) | 論文の変換に使う実装と実行環境 | approved | done (2026-07-29) |
| [0009](0009_text_authority_in_verification.md) | 照合で文字の正をどこに置くか | approved | done (2026-07-29) |
| [0010](0010_reading_text_in_verification.md) | 変換から文字の読み取りを外し、照合に任せる | approved | done (2026-07-29) |
| [0011](0011_parallel_translation.md) | 翻訳を節ごとに並べて走らせる | approved | done (2026-07-29) |
| [0012](0012_chat_branching.md) | 会話の分岐に turn の識別子を持たせる | approved | done (2026-07-30) |
| [0013](0013_chat_images.md) | チャットで画像を扱う | approved | done (2026-07-31) |
| [0014](0014_chat_instructions.md) | 会話のエージェントへ渡す指示 | approved | done (2026-07-31) |
| [0015](0015_paper_references.md) | 論文の参考文献を持つ | approved | done (2026-07-31) |
| [0016](0016_import_from_chat.md) | チャットからの取り込み | approved | done (2026-07-31) |
| [0017](0017_references_in_body.md) | 参考文献を本文の中で辿る | approved | done (2026-07-31) |
| [0018](0018_undo_last_exchange.md) | 直前のやりとりの取り消し | approved | done (2026-07-31) |
| [0019](0019_word_index.md) | 全文検索の索引を語の単位にする | approved | done (2026-07-31) |
| [0020](0020_bibliography_lookup.md) | 書誌を本文が出てから確かめる | approved | done (2026-07-31) |
| [0021](0021_local_original.md) | 手元の PDF を原本として取り込む | approved | done (2026-07-31) |
| [0022](0022_html_original.md) | HTML の原本を本文だけ取り出して変換する | ai-approved | done (2026-08-01) |

件数: 22
