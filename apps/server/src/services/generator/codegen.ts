/**
 * Generator — 代码生成引擎（LLM + Prompt 模板）
 * 输入：需求描述 + 技术栈 + 参考代码片段
 * 输出：Vue SFC / React TSX 组件代码
 */

import { createChatChain } from '../chain/chatChain.js'
import { createRAGService } from '../rag/index.js'

export type Framework = 'vue' | 'react'

export interface CodegenRequest {
  requirement: string
  framework: Framework
  references?: string[]
  extraPrompt?: string
}

export interface CodegenResult {
  code: string
  language: string
  filePath: string
  metadata: {
    framework: Framework
    tokenCount: number
    generationTime: number
  }
}

/**
 * 构建 System Prompt（资深前端架构师角色 + 组件规范约束）
 */
function buildSystemPrompt(framework: Framework): string {
  const common = `你是一名资深前端架构师，擅长组件设计和代码生成。
请严格遵循以下规范生成组件代码：
1. TypeScript 类型安全：所有 props、emits、事件都要有类型定义
2. 可访问性（a11y）：语义化 HTML、aria-label、键盘导航
3. 性能：虚拟滚动、懒加载、合理的重渲染
4. 主题：支持 CSS 变量 / Design Token
5. 交互：loading/error/skeleton 三态齐全
6. 响应式：支持 375px ~ 1920px 自适应`

  const vueExtra = `
Vue 3 SFC 规范：
- <script setup lang="ts"> + defineProps<T>() + defineEmits<T>()
- 使用 Composition API，不要 Options API
- 样式 scoped + CSS 变量
- 使用 Vue 3.3+ defineModel / defineSlots`

  const reactExtra = `
React TSX 规范：
- 函数组件 + Hooks，不要 class 组件
- React.FC<P> + useState / useMemo / useCallback
- CSS Modules 或 styled-components
- 支持 React 18+ Hooks`

  return `${common}\n\n${framework === 'vue' ? vueExtra : reactExtra}`
}

/**
 * 构建用户 Prompt（需求 + 参考 + 输出要求）
 */
function buildUserPrompt(req: CodegenRequest): string {
  const { requirement, framework, references, extraPrompt } = req
  const fileExt = framework === 'vue' ? '.vue' : '.tsx'

  const sections: string[] = [
    `## 用户需求\n${requirement}`,
  ]

  if (references && references.length > 0) {
    sections.push(`## 参考组件实现（请参考这些模式）\n${references.join('\n\n---\n\n')}`)
  }

  if (extraPrompt) {
    sections.push(`## 额外要求\n${extraPrompt}`)
  }

  sections.push(`## 输出要求\n请输出完整的 ${fileExt} 文件，包含：
1. 组件模板 / JSX 结构
2. Props 类型定义
3. 事件定义
4. 核心逻辑
5. 样式
6. 使用示例（在文件末尾注释中）`)

  return sections.join('\n\n')
}

/**
 * 代码生成引擎
 */
export function createCodegenEngine() {
  const rag = createRAGService()

  return {
    /** 同步生成 */
    async generate(req: CodegenRequest): Promise<CodegenResult> {
      const startTime = Date.now()
      const chain = createChatChain({ temperature: 0.7 })

      const systemPrompt = buildSystemPrompt(req.framework)
      const userPrompt = buildUserPrompt(req)

      // 可选：RAG 检索参考实现
      let references = req.references || []
      if (!references || references.length === 0) {
        try {
          const searchResults = await rag.search(req.requirement, 3)
          references = searchResults.map((r) => r.doc.content)
        } catch {}
      }

      const enhancedUserPrompt = buildUserPrompt({
        ...req,
        references,
      })

      const result = await chain.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: enhancedUserPrompt },
        ],
      })

      const fileExt = req.framework === 'vue' ? '.vue' : '.tsx'

      return {
        code: result.content,
        language: req.framework === 'vue' ? 'vue' : 'tsx',
        filePath: `GeneratedComponent${fileExt}`,
        metadata: {
          framework: req.framework,
          tokenCount: result.content.length,
          generationTime: Date.now() - startTime,
        },
      }
    },

    /** 流式生成（用于 SSE 输出） */
    async *streamGenerate(req: CodegenRequest): AsyncGenerator<{
      type: 'delta' | 'done' | 'error'
      content?: string
      data?: unknown
    }> {
      const startTime = Date.now()
      const chain = createChatChain({ temperature: 0.7 })

      try {
        const systemPrompt = buildSystemPrompt(req.framework)
        const userPrompt = buildUserPrompt(req)

        const searchResults = await rag.search(req.requirement, 3).catch(() => [])
        const references = searchResults.map((r) => r.doc.content)

        yield { type: 'delta', content: '', data: { step: 'retrieving' } }

        let fullContent = ''
        for await (const delta of chain.stream({
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: buildUserPrompt({ ...req, references }) },
          ],
          stream: true,
        })) {
          fullContent += delta
          yield { type: 'delta', content: delta }
        }

        const fileExt = req.framework === 'vue' ? '.vue' : '.tsx'
        yield {
          type: 'done',
          content: fullContent,
          data: {
            filePath: `GeneratedComponent${fileExt}`,
            generationTime: Date.now() - startTime,
            framework: req.framework,
          },
        }
      } catch (err) {
        yield { type: 'error', data: { message: (err as Error).message } }
      }
    },
  }
}
