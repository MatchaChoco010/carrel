"""HTML の原本から本文だけを取り出し、変換の成果物として書く(0022)。

使い方:
    carrel_html.py <HTML> <出力ディレクトリ> [--base-url URL]

出力は PDF の変換と同じ形にする。

    <出力>/document.json   ブロックと図の一覧
    <出力>/assets/         図の画像
    <出力>/pages/          空(HTML には紙面が無い)

案内や共有のボタンを落とすために、本文の塊を選んでから markdown にする。
数式は MathML の中に入っている LaTeX を取り出す。
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import MarkdownConverter

# 本文の塊に残さない要素。案内・頭・足・傍注と、動く仕掛け。
DROP_TAGS = ["nav", "header", "footer", "aside", "script", "style", "form", "button", "noscript"]

# 本文として扱う塊の最小の文字数。これに満たなければ選び損ねたとみなす。
MIN_BODY_CHARS = 400

# 地の文と認める段落の長さ。案内や同意の文はこれより短い。
PARAGRAPH_CHARS = 200

# 本文と認めるために要る段落の数。
#
# 中身を JavaScript で描くページは、取れた HTML に案内と同意の文しか無い。実測では
# 出版社の閲覧ページが 3 段落、arXiv の HTML が 41 段落だった。
MIN_PARAGRAPHS = 5

# 画像を落とすときの名乗り。取りに行くのは素の HTTP である(0021)。
USER_AGENT = "carrel/0.1 (https://github.com/MatchaChoco010/carrel)"

HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


class Inline(MarkdownConverter):
    """段落の中の飾りだけを markdown にする変換器。

    見出しや箇条書きの構造はこちらで組み立てるので、ここでは扱わない。
    """

    def convert_img(self, el, text, parent_tags=None):
        # 図はブロックとして別に置くので、地の文には出さない。
        return ""


def latex_of(math: Tag) -> str:
    """MathML から LaTeX を取り出す。

    LaTeXML が出す HTML は `alttext` に元の式を持ち、`annotation` にも同じものが入る。
    どちらも無いときは、読める文字をそのまま返す。
    """
    alt = math.get("alttext")
    if isinstance(alt, str) and alt.strip():
        return alt.strip()
    annotation = math.find("annotation", attrs={"encoding": "application/x-tex"})
    if annotation is not None and annotation.get_text().strip():
        return annotation.get_text().strip()
    return math.get_text(" ", strip=True)


def inline_math(root: Tag) -> None:
    """数式を LaTeX の文字列へ置き換える。"""
    for math in root.find_all("math"):
        latex = latex_of(math)
        if not latex:
            math.decompose()
            continue
        block = math.get("display") == "block"
        math.replace_with(NavigableString(f"$${latex}$$" if block else f"${latex}$"))


def pick_body(soup: BeautifulSoup) -> Tag:
    """本文の塊を選ぶ。

    `article` / `main` / `role=main` を順に当て、無ければ文章の量が最も多い塊を採る。
    出版社ごとの決め打ちは持たない(0022)。
    """
    for finder in (
        lambda: soup.find("article"),
        lambda: soup.find("main"),
        lambda: soup.find(attrs={"role": "main"}),
    ):
        found = finder()
        if isinstance(found, Tag) and len(found.get_text(strip=True)) >= MIN_BODY_CHARS:
            return found

    best = None
    best_len = 0
    for candidate in soup.find_all(["div", "section", "body"]):
        length = len(candidate.get_text(strip=True))
        if length > best_len:
            best, best_len = candidate, length
    if best is None:
        raise SystemExit("本文の塊が見つからない")
    return best


def clean(body: Tag) -> None:
    for tag in body.find_all(DROP_TAGS):
        tag.decompose()


def download(url: str, dest: Path) -> bool:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            dest.write_bytes(response.read())
        return True
    except Exception:
        return False


def suffix_of(url: str) -> str:
    name = Path(urllib.parse.urlparse(url).path).suffix.lower()
    return name if name in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"} else ".png"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("html")
    parser.add_argument("out")
    parser.add_argument("--base-url", default="")
    args = parser.parse_args()

    out = Path(args.out)
    assets = out / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    (out / "pages").mkdir(parents=True, exist_ok=True)

    soup = BeautifulSoup(Path(args.html).read_text(encoding="utf8", errors="replace"), "html.parser")
    base = args.base_url
    base_tag = soup.find("base", href=True)
    if base_tag is not None:
        base = urllib.parse.urljoin(base, str(base_tag["href"]))

    body = pick_body(soup)
    clean(body)
    inline_math(body)

    text_length = len(body.get_text(strip=True))
    if text_length < MIN_BODY_CHARS:
        raise SystemExit(f"本文が短すぎる ({text_length} 文字)")

    inline = Inline(heading_style="ATX", bullets="-", strip=["a"])

    def as_markdown(tag: Tag) -> str:
        """要素の中身だけを markdown にする。

        要素そのものを渡すと、箇条書きの印を markdownify も付けてしまい二重になる。
        紙面の箇条書きが持つ中黒も落とす。
        """
        text = inline.convert(tag.decode_contents()).strip()
        return re.sub(r"^[\u2022\u00b7\u25cf\u25e6*-]+\s*", "", text).strip()

    blocks = []
    seen_images: set[int] = set()

    def add(kind: str, markdown: str, image: str | None = None, group: str | None = None) -> str:
        # 番号は種別をまたいで 1 つずつ増やす。本文の順序はこの番号で決まる。
        block_id = f"/page/0/{kind}/{len(blocks) + 1}"
        blocks.append(
            {
                "id": block_id,
                "kind": kind,
                "page": 0,
                "bbox": {"x0": 0, "y0": 0, "x1": 0, "y1": 0},
                "markdown": markdown,
                "image": image,
                "groupId": group,
            }
        )
        return block_id

    def add_figure(figure: Tag) -> None:
        image = figure if figure.name == "img" else figure.find("img")
        caption_tag = None if figure.name == "img" else figure.find("figcaption")
        src = image.get("src") if isinstance(image, Tag) else None
        if not isinstance(src, str) or not src.strip():
            return
        if id(image) in seen_images:
            return
        seen_images.add(id(image))

        url = urllib.parse.urljoin(base, src.strip())
        name = f"figure-{len(seen_images):03d}{suffix_of(url)}"
        group = f"/group/{len(seen_images)}"
        if download(url, assets / name):
            add("figure", "", image=name, group=group)
        else:
            # 落とせなかった画像は本文から外し、元の場所への参照だけ残す(0022)。
            add("text", f"(図を取得できなかった: {url})")
            return
        if isinstance(caption_tag, Tag):
            caption = inline.convert_soup(caption_tag).strip()
            if caption:
                add("caption", caption, group=group)

    def walk(node: Tag) -> None:
        for child in node.children:
            if not isinstance(child, Tag):
                continue
            name = child.name
            if name in HEADINGS:
                text = child.get_text(" ", strip=True)
                if text:
                    add("sectionHeader", f"{'#' * HEADINGS[name]} {text}")
            elif name in {"figure", "img"}:
                add_figure(child)
            elif name == "table":
                markdown = inline.convert_soup(child).strip()
                if markdown:
                    add("table", markdown)
            elif name in {"pre"}:
                code = child.get_text("\n", strip=False).rstrip()
                if code.strip():
                    add("code", f"```\n{code}\n```")
            elif name in {"ul", "ol"}:
                for item in child.find_all("li", recursive=False):
                    text = as_markdown(item)
                    if text:
                        add("listItem", f"- {text}")
            elif name in {"p", "blockquote"}:
                if child.find("img") is not None:
                    for image in child.find_all("img"):
                        add_figure(image)
                text = as_markdown(child)
                if text:
                    add("text", text)
            else:
                walk(child)

    walk(body)

    paragraphs = [b for b in blocks if b["kind"] == "text" and len(b["markdown"]) >= PARAGRAPH_CHARS]
    if len(paragraphs) < MIN_PARAGRAPHS:
        raise SystemExit(
            f"本文が取れなかった(地の文の段落が {len(paragraphs)} 個しか無い)。"
            "中身を JavaScript で描くページの可能性がある"
        )

    document = {"pageCount": 1, "blocks": blocks}
    (out / "document.json").write_text(json.dumps(document, ensure_ascii=False), encoding="utf8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
