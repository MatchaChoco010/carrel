import { useEffect, useRef, useState } from 'react'

export type ServerEvent = {
  type: string
  payload: unknown
}

export type ConnectionState = 'connecting' | 'open' | 'closed'

/**
 * サーバーからの push を受け取る。
 *
 * 接続が切れたら間隔を伸ばしながら繋ぎ直す。サーバーの再起動をまたいでも
 * 画面を開いたままにしておけるようにする。
 */
export function useServerEvents(onEvent: (event: ServerEvent) => void): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting')
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    let socket: WebSocket | null = null
    let timer: number | undefined
    let attempt = 0
    let disposed = false

    const connect = (): void => {
      if (disposed) return
      setState('connecting')
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`)

      socket.onopen = () => {
        attempt = 0
        setState('open')
      }
      socket.onmessage = (message) => {
        try {
          handler.current(JSON.parse(message.data as string) as ServerEvent)
        } catch {
          // 読めない通知は捨てる。次の通知で状態は追いつく。
        }
      }
      socket.onclose = () => {
        setState('closed')
        if (disposed) return
        attempt += 1
        timer = window.setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)))
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      socket?.close()
    }
  }, [])

  return state
}
