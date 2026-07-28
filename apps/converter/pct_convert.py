"""PDF を変換し、pct が求める形の JSON と画像を書き出す。

使い方:
    pct_convert.py <PDF> <出力ディレクトリ>

出力ディレクトリには次を作る。

    document.json  ブロックの一覧と図表の組
    assets/        図表の画像
    pages/         全ページの画像

変換器固有の設定(モード・推論バックエンド・装置)はこのファイルで閉じる。
呼び出す側は document.json の形だけに依存する。
"""

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

# marker の import より前に置く。読み込み時に装置とバックエンドを見るため。
os.environ.setdefault("SURYA_INFERENCE_BACKEND", "llamacpp")
os.environ.setdefault("LLAMA_CPP_NGL", "99")
os.environ.setdefault("TORCH_DEVICE", "cuda")

import pypdfium2  # noqa: E402
from marker.config.parser import ConfigParser  # noqa: E402
from marker.models import create_model_dict  # noqa: E402

# 変換器のブロック種別を pct の種別へ写す。ここに無いものは other になる。
BLOCK_KINDS = {
    "Text": "text",
    "TextInlineMath": "text",
    "SectionHeader": "sectionHeader",
    "ListItem": "listItem",
    "Caption": "caption",
    "Figure": "figure",
    "Picture": "figure",
    "Diagram": "figure",
    "Table": "table",
    "Equation": "equation",
    "Code": "code",
    "Footnote": "footnote",
    "Reference": "reference",
    "PageHeader": "pageHeader",
    "PageFooter": "pageFooter",
    "PageNumber": "pageNumber",
}

# 図表とキャプションを組にして返す入れ物。中身は個別のブロックとしても現れる。
GROUP_KINDS = {"PictureGroup", "FigureGroup", "DiagramGroup", "TableGroup", "ListGroup"}

# 変換器が抜き出した画像の形式。
IMAGE_SUFFIX = "jpeg"

PAGE_ID = re.compile(r"^/page/(\d+)/")
TAG = re.compile(r"<[^>]*>")


def page_of(block_id: str) -> int:
    m = PAGE_ID.match(block_id or "")
    return int(m.group(1)) if m else 0


def flatten(block, out, group=None):
    """入れ子のブロックを平らに並べる。変換器がまとめた組の識別子も持たせる。"""
    here = block.get("id") if block.get("block_type") in GROUP_KINDS else group
    out.append((block, here))
    for child in block.get("children") or []:
        flatten(child, out, here)


def to_markdown(html: str) -> str:
    """ブロックの html を markdown の本文として使える形にする。

    marker は各ブロックを完結した html で返すので、見出しと箇条書きの印だけを
    起こし、残りはタグを落とした文字列にする。数式は LaTeX のまま残る。
    """
    if not html:
        return ""
    text = html
    for level in range(1, 7):
        text = re.sub(
            rf"<h{level}[^>]*>(.*?)</h{level}>",
            lambda m, n=level: f"{'#' * n} {m.group(1)}",
            text,
            flags=re.S,
        )
    text = re.sub(r"<li[^>]*>(.*?)</li>", lambda m: f"- {m.group(1)}", text, flags=re.S)
    text = TAG.sub("", text)
    return text.strip()


def save_block_image(block, assets: Path) -> str | None:
    """ブロックが持つ画像を assets へ書き、ファイル名を返す。

    変換器は画像をブロックごとに base64 で持たせる。ブロックの識別子は
    `/page/0/Picture/5` の形なので、ファイル名に使える形へ均す。
    """
    images = block.get("images") or {}
    for key, encoded in images.items():
        if not isinstance(encoded, str):
            continue
        name = f"{re.sub(r'[^A-Za-z0-9]+', '-', str(key)).strip('-')}.{IMAGE_SUFFIX}"
        (assets / name).write_bytes(base64.b64decode(encoded))
        return name
    return None


def build_document(rendered, assets: Path) -> dict:
    assets.mkdir(parents=True, exist_ok=True)
    blocks = []
    flatten(json.loads(rendered.model_dump_json()), blocks)

    converted = []
    for b, group in blocks:
        kind_raw = b.get("block_type")
        if kind_raw in ("Document", "Page") or kind_raw in GROUP_KINDS:
            continue
        bbox = b.get("bbox") or [0, 0, 0, 0]
        image = save_block_image(b, assets)
        converted.append(
            {
                "id": b.get("id") or "",
                "kind": BLOCK_KINDS.get(kind_raw, "other"),
                "page": page_of(b.get("id") or ""),
                "bbox": {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]},
                "markdown": "" if image else to_markdown(b.get("html") or ""),
                "image": image,
                "groupId": group,
            }
        )

    return {"blocks": converted}


def render_pages(pdf: Path, pages_dir: Path, scale: float) -> int:
    """全ページを画像にする。照合がページ画像を要求する(0004)。"""
    pages_dir.mkdir(parents=True, exist_ok=True)
    doc = pypdfium2.PdfDocument(str(pdf))
    for i in range(len(doc)):
        doc[i].render(scale=scale).to_pil().save(pages_dir / f"{i:04d}.png")
    return len(doc)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("out")
    parser.add_argument("--page-scale", type=float, default=2.0)
    args = parser.parse_args()

    pdf = Path(args.pdf)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    config = ConfigParser(
        {
            "mode": "fast",
            "output_format": "json",
            "disable_tqdm": True,
        }
    )
    converter_cls = config.get_converter_cls()
    converter = converter_cls(
        config=config.generate_config_dict(),
        artifact_dict=create_model_dict(),
        processor_list=config.get_processors(),
        renderer=config.get_renderer(),
        llm_service=config.get_llm_service(),
    )
    rendered = converter(str(pdf))

    document = build_document(rendered, out / "assets")
    document["pageCount"] = render_pages(pdf, out / "pages", args.page_scale)

    (out / "document.json").write_text(
        json.dumps(document, ensure_ascii=False), encoding="utf8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
