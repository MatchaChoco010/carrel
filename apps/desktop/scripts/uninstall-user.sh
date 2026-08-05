#!/usr/bin/env bash
# install-user.sh が置いたものを取り除く。
set -euo pipefail

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
niri_dir="${XDG_CONFIG_HOME:-$HOME/.config}/niri"
niri_config="$niri_dir/config.kdl"
niri_include='include optional=true "carrel.kdl"'

rm -rf "$data_home/carrel"
rm -f \
  "$data_home/applications/dev.matchachoco010.carrel.desktop" \
  "$data_home/icons/hicolor/512x512/apps/dev.matchachoco010.carrel.png" \
  "$niri_dir/carrel.kdl"

if [[ -f "$niri_config" ]] && grep -Fqx "$niri_include" "$niri_config"; then
  temporary="$(mktemp)"
  grep -Fvx "$niri_include" "$niri_config" >"$temporary" || true
  cat "$temporary" >"$niri_config"
  rm -f "$temporary"
  command -v niri >/dev/null 2>&1 && niri validate
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data_home/applications"
printf '取り除いた\n'
