/**
 * 图编排共享类型
 *
 * 设计约束：节点是普通的 `async (state) => Partial<state>` 函数，节点内部继续调用
 * 现有 createChatChain / invokeChatWithToolCalls / 检索服务；框架只负责状态合并、
 * 条件边、检查点与 interrupt/resume。
 */

/** 图标识：用于 span 命名、灰度开关与 thread_id 前缀 */
export type GraphName = 'search' | 'extract' | 'agent' | 'plan'

/** 节点函数签名：读取完整状态，返回局部补丁（LangGraph 按字段合并） */
export type GraphNode<TState extends object> = (
  state: TState,
) => Partial<TState> | Promise<Partial<TState>>

/**
 * interrupt() 的载荷约定。
 *
 * `type` 标识中断场景（如 `extract:confirm`），`data` 是透传给调用方的业务数据。
 * 恢复时调用方通过 `new Command({ resume })` 回传编辑后的数据。
 */
export interface InterruptPayload<TData = unknown> {
  type: string
  data: TData
}
