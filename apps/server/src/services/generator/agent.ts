/**
 * Generator — 编排 Agent（5 节点 StateGraph）
 *   clarify → retrieve → generate → preview → iterate
 *
 * 支持两种产物模式：
 *   - component: Vue/React 前端组件
 *   - skill:     Trae IDE Skill 包（SKILL.md + 可选 scripts/）
 *
 * clarify 节点根据 type 用不同的 system prompt 做需求细化，
 * preview 节点对 Skill 模式降级为 markdown 预览（而非 iframe）。
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createChatChain } from '../chain/chatChain.js'
import { createRAGService } from '../rag/index.js'
import { createCodegenEngine, type ArtifactType, type Framework, type CodegenResult, type GeneratedFile } from './codegen.js'
import { getDb } from '../../db/index.js'
import { logger } from '../logger.js'

export type GeneratorNode = 'clarify' | 'retrieve' | 'generate' | 'preview' | 'iterate'
export type GeneratorStatus =
  | 'idle'
  | 'clarifying'
  | 'retrieving'
  | 'generating'
  | 'previewing'
  | 'completed'
  | 'error'

export interface GeneratorState {
  id: string
  artifactType: ArtifactType
  requirement: string
  skillName?: string          // Skill 模式专属
  framework?: Framework       // Component 模式专属
  clarifiedRequirement?: string
  references: string[]
  result?: CodegenResult
  previewInfo?: {
    type: 'iframe' | 'markdown'  // component 用 iframe，skill 用 markdown
    url?: string
    files?: GeneratedFile[]
  }
  feedback?: string
  iteration: number
  status: GeneratorStatus
  history: Array<{ node: GeneratorNode; content: string; timestamp: number }>
}

export interface GeneratorConfig {
  maxIterations?: number
  enableRAG?: boolean
}

export interface GeneratorStreamEvent {
  event: string
  node?: GeneratorNode
  data?: unknown
}

// ── Clarify 双模式 Prompt ────────────────────────────────────

function buildClarifySystemPrompt(type: ArtifactType): string {
  if (type === 'component') {
    return `你是一个组件需求分析专家。将用户的模糊需求转化为结构化的组件设计描述，包括：
1. 组件的核心功能
2. 必要的 Props 及其类型
3. 关键事件/Emits
4. 视觉和交互要求
5. 边界情况

用简洁的 JSON 格式输出，字段：
{ "functionality": "...", "props": {...}, "events": [...], "design": "...", "edge_cases": [...] }`
  }

  return `你是一个 Skill 需求分析专家。将用户的模糊需求转化为结构化的 Skill 设计描述，包括：
1. Skill 的核心功能（它做什么）
2. 触发条件（什么时候应该被调用）
3. 输入参数（如果有的话）
4. 输出/副作用（执行后会产生什么）
5. 需要注意的约束或边界情况

用简洁的 JSON 格式输出，字段：
{ "functionality": "...", "trigger_conditions": [...], "inputs": [...], "outputs": [...], "constraints": [...] }`
}

// ── Generator Agent 工厂 ────────────────────────────────────

export function createGeneratorAgent(config: GeneratorConfig = {}) {
  const maxIter = config.maxIterations || 3
  const rag = createRAGService()
  const codegen = createCodegenEngine()

  /** 需求细化（clarify）：LLM 将模糊需求转化为结构化描述 */
  async function clarify(requirement: string, type: ArtifactType): Promise<string> {
    const chain = createChatChain({ temperature: 0.7 })
    const result = await chain.invoke({
      messages: [
        { role: 'system', content: buildClarifySystemPrompt(type) },
        { role: 'user', content: requirement },
      ],
    })
    return result.content
  }

  /** 检索参考实现（retrieve）：RAG 搜索 */
  async function retrieve(requirement: string, type: ArtifactType): Promise<string[]> {
    try {
      const searchType = type === 'component' ? 'component' : 'skill'
      const results = await rag.search(`${requirement} ${searchType}`, 5)
      return results.map((r) => r.doc.content)
    } catch {
      return []
    }
  }

  return {
    /** 流式执行 Generator Agent */
    async *stream(params: {
      requirement: string
      artifactType: ArtifactType
      framework?: Framework
      skillName?: string
      scriptLang?: 'ts' | 'py'
      initialFeedback?: string
    }): AsyncGenerator<GeneratorStreamEvent> {
      const { requirement, artifactType, framework, skillName, scriptLang, initialFeedback } = params

      if (artifactType === 'skill' && !skillName) {
        yield { event: 'on_error', data: { message: 'Skill 模式必须提供 skillName' } }
        return
      }
      if (artifactType === 'component' && !framework) {
        yield { event: 'on_error', data: { message: 'Component 模式必须提供 framework' } }
        return
      }

      const state: GeneratorState = {
        id: randomUUID(),
        artifactType,
        requirement,
        skillName,
        framework,
        references: [],
        iteration: 0,
        status: 'clarifying',
        history: [],
      }

      yield { event: 'on_chain_start', node: 'clarify', data: { requirement, artifactType, framework, skillName } }

      logger.info('generator.stream', '开始生成', { artifactType, framework, skillName, stateId: state.id })
      const t0 = Date.now()

      try {
        // Node 1: Clarify — 需求细化（按 type 分流 prompt）
        logger.debug('generator.clarify', 'LLM 调用中', { type: artifactType })
        const clarified = await clarify(requirement, artifactType)
        logger.info('generator.clarify', '需求细化完成', { stateId: state.id, resultLen: clarified.length, costMs: Date.now() - t0 })
        state.clarifiedRequirement = clarified
        state.status = 'retrieving'
        state.history.push({ node: 'clarify', content: clarified, timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'clarify', data: { clarifiedRequirement: clarified } }

        // Node 2: Retrieve — RAG 检索
        yield { event: 'on_chain_start', node: 'retrieve' }
        const references = config.enableRAG === false
          ? []
          : await retrieve(clarified, artifactType)
        logger.info('generator.retrieve', 'RAG 检索完成', { stateId: state.id, referenceCount: references.length })
        state.references = references
        state.status = 'generating'
        state.history.push({ node: 'retrieve', content: `found ${references.length} references`, timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'retrieve', data: { referenceCount: references.length } }

        // Node 3: Generate — 代码生成（流式）
        yield { event: 'on_chain_start', node: 'generate', data: { iteration: 1, artifactType } }
        logger.info('generator.generate', '开始代码生成', { stateId: state.id, artifactType })

        // 构造 codegen 请求（discriminated union 正确分流）
        const codegenReq = artifactType === 'component'
          ? { type: 'component' as const, requirement: clarified, framework: framework!, references }
          : { type: 'skill' as const, requirement: clarified, skillName: skillName!, scriptLang, references }

        let fullContent = ''
        let chunkCount = 0
        for await (const genEvent of codegen.streamGenerate(codegenReq)) {
          if (genEvent.type === 'delta' && genEvent.content) {
            fullContent += genEvent.content
            chunkCount++
            yield { event: 'on_delta', node: 'generate', data: genEvent.content }
          }
          if (genEvent.type === 'done' && genEvent.data) {
            const doneData = genEvent.data as { files: GeneratedFile[]; artifactType: ArtifactType }
            state.result = {
              files: doneData.files,
              artifactType: doneData.artifactType,
              metadata: { tokenCount: fullContent.length, generationTime: 0 },
            }
          }
        }
        logger.info('generator.generate', '代码生成完成', { stateId: state.id, chunkCount, totalChars: fullContent.length, costMs: Date.now() - t0 })

        state.status = 'previewing'
        state.history.push({ node: 'generate', content: fullContent.slice(0, 200), timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'generate', data: state.result }

        // Node 4: Preview — 按 type 降级
        yield { event: 'on_chain_start', node: 'preview', data: { artifactType } }

        if (artifactType === 'component') {
          // 组件模式：iframe 预览 URL（预留）
          state.previewInfo = { type: 'iframe', url: `/preview/${state.id}` }
        } else {
          // Skill 模式：markdown 预览（直接返回生成的文件列表）
          state.previewInfo = { type: 'markdown', files: state.result?.files }
        }

        state.status = 'completed'
        state.history.push({ node: 'preview', content: JSON.stringify(state.previewInfo), timestamp: Date.now() })
        yield { event: 'on_chain_end', node: 'preview', data: state.previewInfo }

        // Node 5: Iterate — 收集反馈（由外部触发 resume）
        state.iteration = 1
        yield {
          event: 'on_iteration_complete',
          data: {
            stateId: state.id,
            result: state.result,
            previewInfo: state.previewInfo,
            iteration: state.iteration,
          },
        }

        // 持久化
        await persistGeneratorState(state)
        logger.info('generator.stream', '生成完成', { stateId: state.id, totalCostMs: Date.now() - t0, iteration: state.iteration })
      } catch (err) {
        state.status = 'error'
        logger.error('generator.stream', '生成失败', { stateId: state.id, error: (err as Error).message, costMs: Date.now() - t0 })
        yield { event: 'on_error', data: { message: (err as Error).message } }
      }
    },

    /** 根据反馈迭代重新生成 */
    async *iterate(
      stateId: string,
      feedback: string
    ): AsyncGenerator<GeneratorStreamEvent> {
      const state = await getGeneratorState(stateId)
      if (!state) {
        yield { event: 'on_error', data: { message: '状态不存在' } }
        return
      }

      state.iteration++
      state.status = 'generating'
      state.feedback = feedback

      yield { event: 'on_chain_start', node: 'iterate', data: { iteration: state.iteration, feedback } }

      const combinedRequirement = `${state.clarifiedRequirement || state.requirement}\n\n用户反馈：${feedback}`

      const codegenReq = state.artifactType === 'component'
        ? { type: 'component' as const, requirement: combinedRequirement, framework: state.framework!, references: state.references }
        : { type: 'skill' as const, requirement: combinedRequirement, skillName: state.skillName!, references: state.references }

      let fullContent = ''
      for await (const genEvent of codegen.streamGenerate(codegenReq)) {
        if (genEvent.type === 'delta' && genEvent.content) {
          fullContent += genEvent.content
          yield { event: 'on_delta', node: 'generate', data: genEvent.content }
        }
        if (genEvent.type === 'done' && genEvent.data) {
          const doneData = genEvent.data as { files: GeneratedFile[]; artifactType: ArtifactType }
          state.result = {
            files: doneData.files,
            artifactType: doneData.artifactType,
            metadata: { tokenCount: fullContent.length, generationTime: 0 },
          }
        }
      }

      state.status = 'completed'
      yield { event: 'on_chain_end', node: 'iterate', data: { result: state.result } }
      await persistGeneratorState(state)
    },

    /** 获取状态 */
    getState: getGeneratorState,
  }
}

// ── 持久化（generator_sessions + generator_files 多表） ────────

async function getGeneratorState(stateId: string): Promise<GeneratorState | null> {
  const db = getDb()
  const row = await db
    .prepare('SELECT state_json FROM generator_sessions WHERE id = ?')
    .get(stateId) as { state_json: string } | undefined
  return row ? JSON.parse(row.state_json) : null
}

async function persistGeneratorState(state: GeneratorState): Promise<void> {
  const db = getDb()
  const now = Date.now()
  const { artifactType, framework, skillName } = state

  // 1. 写入/更新 generator_sessions（session 级元数据 + state_json）
  await db.prepare(
    `INSERT INTO generator_sessions
       (id, requirement, artifact_type, framework, skill_name, script_lang, state_json, status, iteration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       state_json = excluded.state_json,
       status = excluded.status,
       iteration = excluded.iteration,
       updated_at = excluded.updated_at`
  ).run(
    state.id,
    state.requirement,
    artifactType,
    framework || null,
    skillName || null,
    null,
    JSON.stringify(state),
    state.status,
    state.iteration,
    now,
    now
  )

  // 2. 写入 generator_files（如果生成有产物）
  if (state.result?.files?.length) {
    // 先把当前迭代之前的 files 全部标记为非 current
    await db.prepare(
      `UPDATE generator_files SET is_current = false
       WHERE session_id = ? AND iteration < ?`
    ).run(state.id, state.iteration)

    // 写入新迭代的 files
    const insertFile = db.prepare(
      `INSERT INTO generator_files
         (id, session_id, iteration, file_path, content, language, is_current, created_at)
       VALUES (?, ?, ?, ?, ?, ?, true, ?)`
    )
    const tx = db.transaction(async () => {
      for (const file of state.result!.files) {
        await insertFile.run(
          randomUUID(),
          state.id,
          state.iteration,
          file.path,
          file.content,
          file.language || 'tsx',
          now
        )
      }
    })
    await tx()
  }
}

// ── Zod Schema（路由层用） ────────────────────────────────────

export const generatorInputSchema = z.object({
  requirement: z.string().min(1),
  artifactType: z.enum(['component', 'skill']).default('component'),
  framework: z.enum(['vue', 'react']).optional(),
  skillName: z.string().optional(),
  scriptLang: z.enum(['ts', 'py']).optional(),
  enableRAG: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.artifactType === 'component') return !!data.framework
    if (data.artifactType === 'skill') return !!data.skillName
    return true
  },
  {
    message: 'component 模式必须提供 framework，skill 模式必须提供 skillName',
    path: ['artifactType'],
  }
)

export const generatorIterateSchema = z.object({
  stateId: z.string().min(1),
  feedback: z.string().min(1),
})
