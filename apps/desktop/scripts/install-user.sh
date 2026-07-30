#!/usr/bin/env bash
# pct のデスクトップアプリをユーザー単位で置く。root は要らない。
set -euo pipefail

desktop_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$desktop_dir/package.json').version")"
appimage="$desktop_dir/release/pct-${version}.x86_64.AppImage"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
install_dir="$data_home/pct"
applications_dir="$data_home/applications"
icons_dir="$data_home/icons/hicolor/512x512/apps"
niri_dir="${XDG_CONFIG_HOME:-$HOME/.config}/niri"
niri_config="$niri_dir/config.kdl"
niri_rule="$niri_dir/pct.kdl"
niri_include='include optional=true "pct.kdl"'

if [[ ! -f "$appimage" ]]; then
  printf '配布物が無い: %s\n先に pnpm --filter @pct/desktop package を実行する。\n' "$appimage" >&2
  exit 1
fi

install -d "$install_dir" "$applications_dir" "$icons_dir"
install -m 0755 "$appimage" "$install_dir/pct.AppImage"
install -m 0644 "$desktop_dir/build/icon.png" "$icons_dir/dev.matchachoco010.pct.png"

desktop_file="$applications_dir/dev.matchachoco010.pct.desktop"
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Name=pct' \
  'Comment=論文を集めて読み、エージェントと議論する' \
  "Exec=$install_dir/pct.AppImage" \
  'Icon=dev.matchachoco010.pct' \
  'Terminal=false' \
  'Categories=Science;Education;' \
  'StartupWMClass=pct' \
  >"$desktop_file"
chmod 0644 "$desktop_file"

# ぼかしはコンポジターが当てる。規則を置き、設定から読み込ませる(0001)。
if command -v niri >/dev/null 2>&1 && [[ -f "$niri_config" ]]; then
  install -m 0644 "$desktop_dir/build/pct.niri.kdl" "$niri_rule"
  if ! grep -Fqx "$niri_include" "$niri_config"; then
    printf '\n%s\n' "$niri_include" >>"$niri_config"
  fi
  niri validate
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$applications_dir"
printf '置いた: %s\n' "$install_dir/pct.AppImage"
