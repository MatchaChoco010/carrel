import type { DatabaseSync } from 'node:sqlite'

/**
 * スレッドに効いているユーザーの指示を覚える(0014)。
 *
 * 記録ではなく運用の状態なので、markdown ではなく state.sqlite に置く(0002)。
 * 覚えていない間は、次の発言で指示を差し込むことになる。
 */
export class InstructionStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  inForce(threadId: string): string | null {
    const row = this.#db
      .prepare('select instructions from thread_instructions where thread_id = ?')
      .get(threadId) as { instructions?: string } | undefined
    return row?.instructions ?? null
  }

  remember(threadId: string, instructions: string): void {
    this.#db
      .prepare(
        `insert into thread_instructions (thread_id, instructions) values (?, ?)
         on conflict(thread_id) do update set instructions = excluded.instructions`,
      )
      .run(threadId, instructions)
  }

  forget(threadId: string): void {
    this.#db.prepare('delete from thread_instructions where thread_id = ?').run(threadId)
  }

  /** 分岐でスレッドを写したときに、効いている指示も引き継ぐ。 */
  copy(fromThreadId: string, toThreadId: string): void {
    const inForce = this.inForce(fromThreadId)
    if (inForce === null) return
    this.remember(toThreadId, inForce)
  }
}
