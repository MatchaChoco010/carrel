# 変換器

論文の PDF を、本文の markdown・図表の画像とキャプション・ページ対応・全ページの画像へ変換する。
実装と実行環境の選定は [0008](../../docs/design/0008_conversion_runtime.md) に記録した。

## 用意するもの

- Python 3.13
- ROCm が動く AMD の GPU
- llama.cpp の `llama-server`(ROCm 版)

## 構築

`setup.sh` が venv を作り、バージョンを固定した依存を入れる。

```sh
./setup.sh
```

torch は ROCm の安定版を URL で直接指定して入れる。
索引から解決させると CUDA 版が選ばれることがあり、そちらが入ると変換が GPU で動かない。
構築の最後に、入った torch が ROCm 版であることを確かめる。

`llama-server` は別に用意する。
[llama.cpp のリリース](https://github.com/ggml-org/llama.cpp/releases)から `bin-ubuntu-rocm-*-x64` を取り、展開した場所をサーバーの設定 `converter.llamaServer` と `converter.llamaLibDir` に書く。

## 実行

```sh
.venv/bin/python carrel_convert.py <PDF> <出力ディレクトリ>
```

出力ディレクトリに次ができる。

| 場所 | 中身 |
|---|---|
| `document.json` | ブロックの一覧と、図表とキャプションの組 |
| `assets/` | 図表の画像 |
| `pages/` | 全ページの画像 |

呼び出す側が依存するのは `document.json` の形だけである。
モード・推論バックエンド・装置の指定は `carrel_convert.py` の中で閉じている。

## 更新するとき

ROCm と依存のバージョンは固定してある。
上げるときは、上げる前後で同じ論文を変換し、`document.json` の本文と構造が変わらないことを確かめる。
確かめずに上げると、視覚モデルの出力が壊れたことに気づかないまま論文が取り込まれる(0008)。
