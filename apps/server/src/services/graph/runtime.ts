/**
 * 图运行时 —— 统一封装 compile、检查点注入与节点追踪。
 *
 * 业务代码只负责构建节点与条件边；LangGraph 细节收敛在 services/graph/。
 */

import type { StateGraph } from '@langchain/langgraph'

import { withSpan } from '../../observability/tracing.js'
import { getCheckpointer } from './checkpointer.js'
import type { GraphName, GraphNode } from './types.js'

/** 与 StateGraph 的 9 个泛型参数对齐，避免业务侧重复书写长泛型 */
export type AnyStateGraph = StateGraph<any, any, any, any, any, any, any, any, any>

const GRAPH_SWITCHES: Record<GraphName, string> = {
  search: 'ENABLE_GRAPH_SEARCH',
  extract: 'ENABLE_GRAPH_EXTRACT',
  agent: 'ENABLE_GRAPH_AGENT',
  // 规划链路没有旧实现可对比，开关只控制 AI 入口（默认开）
  plan: 'ENABLE_PLAN_AI',
}

/** 灰度开关：默认关闭，关闭时调用方走旧实现 */
export const isGraphEnabled = (graph: GraphName): boolean =>
  process.env[GRAPH_SWITCHES[graph]] === '1'

/** 节点包装：span 名 `graph.{graph}.{node}`，不改变节点语义与返回值 */
export const tracedNode =
  <TState extends object>(
    graph: GraphName,
    node: string,
    fn: GraphNode<TState>,
  ): GraphNode<TState> =>
  (state) =>
    withSpan(`graph.${graph}.${node}`, { 'graph.name': graph, 'graph.node': node }, async () =>
      fn(state),
    )

export interface CompileGraphOptions {
  /** 传 false 时不注入 checkpointer（纯节点/条件边单测用） */
  checkpointer?: boolean
}

/** 统一编译入口：默认注入检查点存储 */
export const compileGraph = async <G extends AnyStateGraph>(
  builder: G,
  options: CompileGraphOptions = {},
): Promise<ReturnType<G['compile']>> => {
  if (options.checkpointer === false) {
    return builder.compile() as ReturnType<G['compile']>
  }

  const checkpointer = await getCheckpointer()
  return builder.compile({ checkpointer }) as ReturnType<G['compile']>
}
