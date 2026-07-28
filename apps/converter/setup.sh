#!/usr/bin/env bash
# 変換器の Python 環境を作り直す。
#
# 余計なものが残った状態を避けるため、毎回 venv を作り直す。
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_VERSION=3.13
TORCH=2.13.0+rocm7.2
TORCHVISION=0.28.0+rocm7.2
MARKER=2.0.0
ROCM_INDEX=https://download.pytorch.org/whl/rocm7.2

rm -rf .venv
uv venv --python "$PYTHON_VERSION" .venv
export VIRTUAL_ENV="$PWD/.venv"

# 索引から解決させると CUDA 版が選ばれることがあるため、URL で直接指定する。
uv pip install --index-url "$ROCM_INDEX" \
  "$ROCM_INDEX/torch-${TORCH/+/%2B}-cp313-cp313-manylinux_2_28_x86_64.whl" \
  "$ROCM_INDEX/torchvision-${TORCHVISION/+/%2B}-cp313-cp313-manylinux_2_28_x86_64.whl"

uv pip install "marker-pdf==$MARKER"

# 入った torch が ROCm 版であることを確かめる。CUDA 版が混入していると変換が
# GPU で動かないが、その場では気づきにくい。
.venv/bin/python - <<'PY'
import sys
import torch

if torch.version.hip is None:
    sys.exit(f"ROCm 版ではない torch が入っている: {torch.__version__}")
if not torch.cuda.is_available():
    sys.exit("GPU を認識できない")
print(f"torch {torch.__version__} (HIP {torch.version.hip})")
PY

echo "できあがり。llama-server は別に用意して、サーバーの設定に場所を書く(README.md)。"
