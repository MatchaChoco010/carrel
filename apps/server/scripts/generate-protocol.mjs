// app-server のプロトコル型を生成して src/codex/generated/ へ置く。
//
// 使い方: node apps/server/scripts/generate-protocol.mjs
//
// codex が出す型は拡張子なしの相対 import を使っており、NodeNext の解決では
// そのまま型検査に通らない。そのため取り込みの際に `.ts` を補う。これは全ファイル
// へ一律に当てる機械的な置換で、内容の取捨選択はしない。

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(serverDir, 'src', 'codex', 'generated')

const RELATIVE_IMPORT = /(from\s+")(\.\.?\/[^"]+)(")/g

function exists(path) {
  try {
    return statSync(path).isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

// ディレクトリを指す import には `/index.ts` を、ファイルを指す import には
// `.ts` を補う。
function addExtension(text, file) {
  return text.replace(RELATIVE_IMPORT, (match, head, path, tail) => {
    if (path.endsWith('.ts')) return match
    const resolved = join(dirname(file), path)
    const suffix = exists(resolved) === 'dir' ? '/index.ts' : '.ts'
    return `${head}${path}${suffix}${tail}`
  })
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

const staging = mkdtempSync(join(tmpdir(), 'carrel-protocol-'))
try {
  execFileSync('codex', ['app-server', 'generate-ts', '--out', staging], { stdio: 'inherit' })

  rmSync(outDir, { recursive: true, force: true })
  cpSync(staging, outDir, { recursive: true })

  const files = walk(outDir)
  for (const file of files) {
    writeFileSync(file, addExtension(readFileSync(file, 'utf8'), file), 'utf8')
  }

  const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim()
  writeFileSync(
    join(outDir, 'README.md'),
    [
      '# 生成されたプロトコル型',
      '',
      'このディレクトリのファイルは生成物である。手で編集しない。',
      '',
      `生成元: \`${version}\``,
      '',
      '作り直すには次を実行する。',
      '',
      '```sh',
      'node apps/server/scripts/generate-protocol.mjs',
      '```',
      '',
    ].join('\n'),
    'utf8',
  )

  console.log(`${files.length} 件の型を ${outDir} へ置いた (${version})`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
