"""PDF の指定したページを画像にする。ページ数だけを数えることもできる。

使い方:
    carrel_pages.py <PDF> <出力ディレクトリ> --pages 0,1 --scale 2.0
    carrel_pages.py <PDF> --count

返すのは次の形で、標準出力へ書く。

    {"files": ["/path/0000.png", ...]}
    {"pages": 884}

変換の段階は全ページを画像にするが(0004)、解決の段階は先頭の数ページしか要らない
(0021)。ページを選んで描き起こせるように、変換とは別の入り口にしてある。
ページ数もここで数える。紙面を開かずに済むので、長さを知るだけなら文字層を取り出すより軽い(#328)。
"""

import argparse
import json
import sys
from pathlib import Path

import pypdfium2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("out", nargs="?")
    parser.add_argument("--pages", default="0")
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--count", action="store_true", help="ページ数だけを返す")
    args = parser.parse_args()

    doc = pypdfium2.PdfDocument(args.pdf)

    if args.count:
        json.dump({"pages": len(doc)}, sys.stdout)
        return 0

    if args.out is None:
        parser.error("出力ディレクトリを渡すこと")

    wanted = [int(p) for p in args.pages.split(",") if p.strip() != ""]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    files = []
    for i in wanted:
        if not 0 <= i < len(doc):
            continue
        path = out / f"{i:04d}.png"
        doc[i].render(scale=args.scale).to_pil().save(path)
        files.append(str(path))

    json.dump({"files": files}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
