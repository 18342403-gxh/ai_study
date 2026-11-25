/**
 * 图运行时单测 —— 节点状态合并、条件边、节点失败、灰度开关。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

import { compileGraph, isGraphEnabled, tracedNode } from '../runtime.js'

const State = Annotation.Root({
  input: Annotation<string>(),
  upper: Annotation<string>(),
  suffix: Annotation<string>(),
})

type TestState = typeof State.State

const buildGraph = () =>
  new StateGraph(State)
    .addNode(
      'toUpper',
      tracedNode<TestState>('search', 'toUpper', (state) => ({
        upper: state.input.toUpperCase(),
      })),
    )
    .addNode(
      'longBranch',
      tracedNode<TestState>('search', 'longBranch', () => ({ suffix: 'long' })),
    )
    .addNode(
      'shortBranch',
      tracedNode<TestState>('search', 'shortBranch', () => ({ suffix: 'short' })),
    )
    .addEdge(START, 'toUpper')
    .addConditionalEdges(
      'toUpper',
      (state) => (state.upper.length > 3 ? 'longBranch' : 'shortBranch'),
      ['longBranch', 'shortBranch'],
    )
    .addEdge('longBranch', END)
    .addEdge('shortBranch', END)

describe('compileGraph + tracedNode', () => {
  it('节点返回的局部补丁按字段合并', async () => {
    const graph = await compileGraph(buildGraph(), { checkpointer: false })
    const out = await graph.invoke({ input: 'hello' })

    expect(out.upper).toBe('HELLO')
    expect(out.suffix).toBe('long')
    expect(out.input).toBe('hello')
  })

  it('条件边按状态选择分支', async () => {
    const graph = await compileGraph(buildGraph(), { checkpointer: false })
    const out = await graph.invoke({ input: 'hi' })

    expect(out.upper).toBe('HI')
    expect(out.suffix).toBe('short')
  })

  it('节点抛错时 invoke 直接失败', async () => {
    const failing = new StateGraph(State)
      .addNode(
        'boom',
        tracedNode<TestState>('search', 'boom', () => {
          throw new Error('node-boom')
        }),
      )
      .addEdge(START, 'boom')
      .addEdge('boom', END)

    const graph = await compileGraph(failing, { checkpointer: false })
    await expect(graph.invoke({ input: 'x' })).rejects.toThrow('node-boom')
  })
})

describe('isGraphEnabled', () => {
  afterEach(() => {
    delete process.env.ENABLE_GRAPH_SEARCH
    delete process.env.ENABLE_GRAPH_EXTRACT
    delete process.env.ENABLE_GRAPH_AGENT
  })

  it('默认关闭', () => {
    expect(isGraphEnabled('search')).toBe(false)
    expect(isGraphEnabled('extract')).toBe(false)
    expect(isGraphEnabled('agent')).toBe(false)
  })

  it('三个开关彼此独立', () => {
    process.env.ENABLE_GRAPH_SEARCH = '1'
    expect(isGraphEnabled('search')).toBe(true)
    expect(isGraphEnabled('extract')).toBe(false)

    process.env.ENABLE_GRAPH_EXTRACT = 'true'
    expect(isGraphEnabled('extract')).toBe(false)
  })
})
