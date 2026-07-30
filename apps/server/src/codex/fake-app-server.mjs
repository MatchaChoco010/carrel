// client.test.ts が動かす app-server の代わり。
// 初期化に答え、`test/notify` で言われた通知を流し、`test/exit` で終わる。
import { createInterface } from 'node:readline'

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  switch (message.method) {
    case 'test/notify':
      write({ method: message.params.method, params: message.params.params })
      write({ id: message.id, result: {} })
      return
    case 'test/exit':
      process.exit(3)
      return
    default:
      write({ id: message.id, result: {} })
  }
})
