"""PDF の文字層を、ページと領域の単位で取り出して JSON で返す。

使い方:
    pct_textlayer.py <PDF> <要求の JSON>

要求は次の形で標準入力ではなく引数のファイルから読む。

    {"regions": [{"id": "...", "page": 0, "bbox": {"x0":..,"y0":..,"x1":..,"y1":..}}]}

返すのは次の形で、標準出力へ書く。

    {"pages": ["ページ全体の文字列", ...],
     "regions": {"<id>": "その領域の文字列", ...}}

文字を 1 文字ずつ位置つきで取り出す経路は、基本多言語面の外にある文字を
落とす(0009)。ここでは文字列として取り出す経路だけを使う。
"""

import argparse
import json
import sys

import pypdfium2

# 変換器が返す領域の縁で文字が切れるのを避けるための余白。
MARGIN = 2.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("request")
    args = parser.parse_args()

    request = json.loads(open(args.request, encoding="utf8").read())
    doc = pypdfium2.PdfDocument(args.pdf)

    pages = []
    textpages = []
    for i in range(len(doc)):
        tp = doc[i].get_textpage()
        textpages.append((doc[i], tp))
        pages.append(tp.get_text_range())

    regions = {}
    for region in request.get("regions") or []:
        page = region.get("page")
        if not isinstance(page, int) or not 0 <= page < len(textpages):
            continue
        pdf_page, tp = textpages[page]
        bbox = region.get("bbox") or {}
        height = pdf_page.get_height()
        # 変換器の座標は上が原点、pdfium は下が原点なので入れ替える。
        try:
            text = tp.get_text_bounded(
                left=bbox["x0"] - MARGIN,
                bottom=height - bbox["y1"] - MARGIN,
                right=bbox["x1"] + MARGIN,
                top=height - bbox["y0"] + MARGIN,
            )
        except Exception:
            continue
        regions[region.get("id")] = text

    json.dump({"pages": pages, "regions": regions}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
