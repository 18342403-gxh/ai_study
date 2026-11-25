/**
 * LangGraph PostgreSQL 检查点存储。
 * 业务连接使用 postgres.js；PostgresSaver 按其 API 要求维护独立 pg.Pool。
 */

import { logger } from '../logger.js'

type PostgresSaverInstance = InstanceType<
  typeof import('@langchain/langgraph-checkpoint-postgres').PostgresSaver
>

export type GraphCheckpointer = PostgresSaverInstance

let cached: GraphCheckpointer | null = null
let pending: Promise<GraphCheckpointer> | null = null

const createCheckpointer = async (): Promise<GraphCheckpointer> => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the graph checkpointer')
  }

  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres')
  const saver = PostgresSaver.fromConnString(databaseUrl)
  try {
    await saver.setup()
    return saver
  } catch (error) {
    await saver.end().catch(() => {})
    throw error
  }
}

export const getCheckpointer = (): Promise<GraphCheckpointer> => {
  if (cached) return Promise.resolve(cached)

  if (!pending) {
    pending = createCheckpointer()
      .then((saver) => {
        cached = saver
        logger.info('graph', 'PostgreSQL 检查点存储初始化完成')
        return saver
      })
      .catch((error: unknown) => {
        pending = null
        logger.error('graph', '检查点存储初始化失败', {
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      })
  }

  return pending
}

export const closeCheckpointer = async (): Promise<void> => {
  const initializing = pending
  let saver = cached
  cached = null
  pending = null

  if (!saver && initializing) {
    try {
      saver = await initializing
    } catch {
      // 初始化失败时 createCheckpointer 已释放其连接池。
    }
  }

  if (saver) {
    await saver.end()
  }
  cached = null
}
