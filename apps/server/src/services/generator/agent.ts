/**
 * Generator — 编排 Agent（5 节点 StateGraph）
 *   clarify → retrieve → generate → preview → iterate
 *
 * 作为 AI 组件生成器的核心业务 Agent
 * 每次迭代负责：需求细化 → 检索参考 → 生成代码 → 预览 → 收集反馈
 */

import { z } from 'zod'
import { createChatChain } from '../chain/chatChain.js'
import { createRAGService } from '../rag/index.js'
import { createCodegenEngine, type CodegenResult } from './codegen.js'
import { getDb } from '../../db/index.js'
import { randomUUID } from 'crypto'

export type GeneratorNode = 'clarify' | 'retrieve' | 'generate' | 'preview' | 'iterate'
export type GeneratorStatus = 'idle' | 'clarifying' | 'retrieving' | 'generating' | 'previewing' | 'completed' | 'error'

export interface GeneratorState {
  id: string
  requirement: string
  clarifiedRequirement?: string
  framework: 'vue' | 'react'
  references: string[]
  code?: CodegenResult
  previewUrl?: string
  feedback?: string
  iteration: number
  status: GeneratorStatus
  history: Array<{ node: GeneratorNode; content: string; timestamp: number }>
}

export interface GeneratorConfig {
  maxIterations?: number
  framework?: 'vue' | 'react'
  enableRAG?: boolean
}

export interface GeneratorStreamEvent {
  event: string
  node?: GeneratorNode
  data?: unknown
}

export function createGeneratorAgent(config: GeneratorConfig = {}) {
  const maxIter = config.maxIterations || 3
  const rag = createRAGService()
  const codegen = createCodegenEngine()

  /** 需求细化（clarify）：LLM 将模糊需求转化为结构化描述 */
  async function clarify(requirement: string): Promise<string> {
    const chain = createChatChain({ temperature: 0.7 })
    const result = await chain.invoke({
      messages: [
        {
          role: 'system',
          content: `你是一个组件需求分析专家。将用户的模糊需求转化为结构化的组件设计描述，包括：
1. 组件的核心功能
2. 必要的 Props 及其类型
3. 关键事件/Emits
4. 视觉和交互要求
5. 边界情况

用简洁的 JSON 格式输出，字段：
{ "functionality": "...", "props": {...}, "events": [...], "design": "...", "edge_cases": [...] }`,
        },
        { role: 'user', content: requirement },
      ],
    })
    return result.content
  }

  /** 检索参考实现（retrieve）：RAG 搜索组件库 */
  async function retrieve(requirement: string, framework: string): Promise<string[]> {
    try {
      const results = await rag.search(`${requirement} ${framework} component`, 5)
      return results.map((r) => r.doc.content)
    } catch {
      return []
    }
  }

  return {
    /** 流式执行 Generator Agent */
    async *stream(
      requirement: string,
      framework: 'vue' | 'react' = config.framework || 'vue',
      initialFeedback?: string
    ): AsyncGenerator<GeneratorStreamEvent> {
      const state: GeneratorState = {
        id: randomUUID(),
        requirement,
        framework,
        references: [],
        iteration: 0,
        status: 'clarifying',
        history: [],
      }

      yield { event: 'on_chain_start', node: 'clarify', data: { requirement, framework } }

      try {
        // Node 1: Clarify — 需求细化
        const clarified = await clarify(requirement)
        state.clarifiedRequirement = clarified
        state.status = 'retrieving'
        state.history.push({ node: 'clarify', content: clarified, timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'clarify', data: { clarifiedRequirement: clarified } }

        // Node 2: Retrieve — RAG 检索
        yield { event: 'on_chain_start', node: 'retrieve' }
        const references = config.enableRAG === false
          ? []
          : await retrieve(clarified, framework)
        state.references = references
        state.status = 'generating'
        state.history.push({ node: 'retrieve', content: `found ${references.length} references`, timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'retrieve', data: { referenceCount: references.length } }

        // Node 3: Generate — 代码生成（流式）
        yield { event: 'on_chain_start', node: 'generate', data: { iteration: 1 } }

        let fullCode = ''
        for await (const genEvent of codegen.streamGenerate({
          requirement: clarified,
          framework,
          references,
        })) {
          if (genEvent.type === 'delta' && genEvent.content) {
            fullCode += genEvent.content
            yield { event: 'on_delta', node: 'generate', data: genEvent.content }
          }
        }

        state.code = {
          code: fullCode,
          language: framework === 'vue' ? 'vue' : 'tsx',
          filePath: `GeneratedComponent.${framework === 'vue' ? 'vue' : 'tsx'}`,
          metadata: { framework, tokenCount: fullCode.length, generationTime: 0 },
        }

        state.status = 'previewing'
        state.history.push({ node: 'generate', content: fullCode.slice(0, 200), timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'generate', data: state.code }

        // Node 4: Preview — 生成预览 URL（预留，实际应调用沙箱服务）
        yield {
          event: 'on_chain_start',
          node: 'preview',
          data: { previewUrl: `/preview/${state.id}` },
        }
        state.previewUrl = `/preview/${state.id}`
        state.status = 'completed'
        state.history.push({ node: 'preview', content: state.previewUrl, timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'preview', data: { previewUrl: state.previewUrl } }

        // Node 5: Iterate — 收集反馈（由外部触发 resume）
        state.iteration = 1
        yield {
          event: 'on_iteration_complete',
          data: {
            stateId: state.id,
            code: state.code,
            previewUrl: state.previewUrl,
            iteration: state.iteration,
          },
        }

        // 持久化
        persistGeneratorState(state)
      } catch (err) {
        state.status = 'error'
        yield { event: 'on_error', data: { message: (err as Error).message } }
      }
    },

    /** 根据反馈迭代重新生成 */
    async *iterate(
      stateId: string,
      feedback: string
    ): AsyncGenerator<GeneratorStreamEvent> {
      const state = getGeneratorState(stateId)
      if (!state) {
        yield { event: 'on_error', data: { message: '状态不存在' } }
        return
      }

      state.iteration++
      state.status = 'generating'
      state.feedback = feedback

      yield { event: 'on_chain_start', node: 'iterate', data: { iteration: state.iteration, feedback } }

      const combinedRequirement = `${state.clarifiedRequirement || state.requirement}\n\n用户反馈：${feedback}`

      for await (const genEvent of codegen.streamGenerate({
        requirement: combinedRequirement,
        framework: state.framework,
        references: state.references,
      })) {
        if (genEvent.type === 'delta' && genEvent.content) {
          yield { event: 'on_delta', node: 'generate', data: genEvent.content }
        }
      }

      state.status = 'completed'
      yield { event: 'on_chain_end', node: 'iterate', data: { state } }
      persistGeneratorState(state)
    },

    /** 获取状态 */
    getState: getGeneratorState,
  }
}

function getGeneratorState(stateId: string): GeneratorState | null {
  const db = getDb()
  const row = db
    .prepare('SELECT state_json FROM generator_states WHERE id = ?')
    .get(stateId) as { state_json: string } | undefined
  return row ? JSON.parse(row.state_json) : null
}

function persistGeneratorState(state: GeneratorState): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO generator_states (id, state_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       state_json = excluded.state_json,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(state.id, JSON.stringify(state), state.status, now, now)
}

export const generatorInputSchema = z.object({
  requirement: z.string().min(1),
  framework: z.enum(['vue', 'react']).default('vue'),
  enableRAG: z.boolean().default(true),
})

export const generatorIterateSchema = z.object({
  stateId: z.string().min(1),
  feedback: z.string().min(1),
})
