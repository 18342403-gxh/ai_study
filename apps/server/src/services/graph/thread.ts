/**
 * thread_id 约定 —— 三条链路共用一套可生成、可解析的命名规则。
 *
 *   search:{sessionId | anon}:{messageId}
 *   extract:{draftId}
 *   agent:{sessionId}:{messageId}
 *   plan:{draftId}
 *
 * 解析失败的 thread_id 返回 null，由调用方决定 404 还是回退旧路径。
 */

export const ANON_SESSION = 'anon'

const requirePart = (value: string, name: string): string => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`thread_id 缺少 ${name}`)
  return trimmed
}

export const searchThreadId = (sessionId: string | null | undefined, messageId: string): string =>
  `search:${sessionId?.trim() || ANON_SESSION}:${requirePart(messageId, 'messageId')}`

export const extractThreadId = (draftId: string): string =>
  `extract:${requirePart(draftId, 'draftId')}`

export const agentThreadId = (sessionId: string, messageId: string): string =>
  `agent:${requirePart(sessionId, 'sessionId')}:${requirePart(messageId, 'messageId')}`

export const planThreadId = (draftId: string): string => `plan:${requirePart(draftId, 'draftId')}`

export type ThreadRef =
  | { graph: 'search'; sessionId: string; messageId: string }
  | { graph: 'extract'; draftId: string }
  | { graph: 'agent'; sessionId: string; messageId: string }
  | { graph: 'plan'; draftId: string }

/**
 * 解析 thread_id。`sessionId` 为 `anon` 时原样返回，由调用方按匿名会话处理；
 * `messageId` / `draftId` 中的冒号保持原样（仅前缀与第一段参与路由）。
 */
export const parseThreadId = (threadId: string): ThreadRef | null => {
  if (threadId.startsWith('extract:')) {
    const draftId = threadId.slice('extract:'.length)
    return draftId ? { graph: 'extract', draftId } : null
  }

  if (threadId.startsWith('plan:')) {
    const draftId = threadId.slice('plan:'.length)
    return draftId ? { graph: 'plan', draftId } : null
  }

  const [graph, sessionId, ...rest] = threadId.split(':')
  if (graph !== 'search' && graph !== 'agent') return null
  if (!sessionId) return null

  const messageId = rest.join(':')
  if (!messageId) return null

  return { graph, sessionId, messageId }
}
