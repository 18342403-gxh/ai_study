/** PostgreSQL 检查点：setup、写入、最新检查点、关闭后重开恢复。 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { closeTestDatabase, resetTestDatabase } from '../../../../tests/helpers/db.js'

const State = Annotation.Root({
  count: Annotation<number>(),
})

const buildGraph = () =>
  new StateGraph(State)
    .addNode('increment', (state) => ({ count: state.count + 1 }))
    .addEdge(START, 'increment')
    .addEdge('increment', END)

const configFor = (threadId: string) => ({ configurable: { thread_id: threadId } })

let checkpointer: typeof import('../checkpointer.js')
let runtime: typeof import('../runtime.js')

beforeAll(async () => {
  checkpointer = await import('../checkpointer.js')
  runtime = await import('../runtime.js')
})

beforeEach(resetTestDatabase)
afterAll(closeTestDatabase)

describe('getCheckpointer (PostgreSQL)', () => {
  it('初始化独立 saver，写入后关闭并重开可恢复', async () => {
    const saver = await checkpointer.getCheckpointer()
    expect(saver).toBeInstanceOf(PostgresSaver)
    expect(saver).toBe(await checkpointer.getCheckpointer())

    const graph = await runtime.compileGraph(buildGraph())
    const config = configFor(`test:read:${Date.now()}`)
    const out = await graph.invoke({ count: 0 }, config)
    expect(out.count).toBe(1)

    const tuple = await saver.getTuple(config)
    expect((tuple?.checkpoint.channel_values as { count?: number } | undefined)?.count).toBe(1)

    await checkpointer.closeCheckpointer()
    const reopened = await checkpointer.getCheckpointer()
    expect(reopened).not.toBe(saver)
    const reopenedTuple = await reopened.getTuple(config)
    expect(reopenedTuple?.checkpoint.id).toBe(tuple?.checkpoint.id)
  })

  it('同一 thread 多次运行产生多个检查点，取最新', async () => {
    const saver = await checkpointer.getCheckpointer()
    const config = configFor(`test:latest:${Date.now()}`)

    const firstGraph = await runtime.compileGraph(buildGraph())
    await firstGraph.invoke({ count: 0 }, config)
    const first = await saver.getTuple(config)

    const secondGraph = await runtime.compileGraph(buildGraph())
    const secondOut = await secondGraph.invoke({ count: 1 }, config)
    expect(secondOut.count).toBe(2)

    const latest = await saver.getTuple(config)
    expect(latest?.checkpoint.id).not.toBe(first?.checkpoint.id)
    expect((latest?.checkpoint.channel_values as { count?: number } | undefined)?.count).toBe(2)

    const history: unknown[] = []
    for await (const item of saver.list(config)) history.push(item)
    expect(history.length).toBeGreaterThanOrEqual(2)
  })
})
