const { chmod, rename, writeFile } = require('node:fs/promises')
const path = require('node:path')

/** ラッパーの中身は src/wrapper.ts が正。ここは配置だけを行う。 */
const EXECUTABLE = 'pct'

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const { wrapperScript } = await import('../dist/wrapper.js')
  const executable = path.join(context.appOutDir, EXECUTABLE)
  const binary = `${executable}-bin`

  await rename(executable, binary)
  await writeFile(executable, wrapperScript(`${EXECUTABLE}-bin`))
  await chmod(executable, 0o755)
}
