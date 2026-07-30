/**
 * 実行ファイルを包むシェルの中身を作る。
 *
 * Chromium の初期化より前に渡す必要がある引数があるので、`app.commandLine` では足りない。
 * 実行ファイルを `-bin` へ退かし、元の名前でこのラッパーを置く。
 *
 * `--ozone-platform=wayland` は XWayland ではなく Wayland で開くため、
 * `--disable-features=Vulkan` は透明な surface に前のフレームが残るのを避けるため。
 * どちらも同じ環境(Fedora・Niri・AMD)での実測に基づく回避で、Electron や
 * ドライバーを上げたときは要否を測り直す。
 */
export function wrapperScript(binaryName: string): string {
  return [
    '#!/bin/sh',
    'directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    `exec "$directory/${binaryName}" --ozone-platform=wayland --disable-features=Vulkan "$@"`,
    '',
  ].join('\n')
}
