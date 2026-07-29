import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { pollFeed, type PollDeps } from './poll.ts'
import { translateFeed, type FeedTranslateDeps } from './translate.ts'

export const FEED_FETCH_JOB = 'feedFetch'
export const FEED_TRANSLATE_JOB = 'feedTranslate'

/** 対象を持たない仕事なので、同じ種別が並ばないように固定の名前を使う。 */
const ALL = 'all'

/**
 * 取得のジョブを積む。
 *
 * 資源クラスは network で、arXiv の呼び出し間隔の制約は取得の側で守る。
 */
export function enqueueFeedFetch(queue: JobQueue): Job {
  return queue.enqueue({ kind: FEED_FETCH_JOB, target: ALL, resource: 'network', priority: 'background' })
}

/**
 * 和訳のジョブを積む。
 *
 * 背景の優先度で積むので、ユーザーが待っている取り込みと議論に順番を譲る(0003)。
 */
export function enqueueFeedTranslate(queue: JobQueue): Job {
  return queue.enqueue({ kind: FEED_TRANSLATE_JOB, target: ALL, resource: 'codex', priority: 'background' })
}

export function registerFeed(
  queue: JobQueue,
  deps: { poll: () => PollDeps; translate: FeedTranslateDeps; onFetched: () => void },
): void {
  queue.register(FEED_FETCH_JOB, async () => {
    const results = await pollFeed(deps.poll())
    if (results.some((r) => r.added > 0)) deps.onFetched()
    // 新着が無くても、前の回で訳し残した項目があれば拾う。
    if (deps.translate.feed.needsTranslation(1).length > 0) enqueueFeedTranslate(queue)
  })

  queue.register(FEED_TRANSLATE_JOB, async () => {
    await translateFeed(deps.translate)
    deps.onFetched()
  })
}
