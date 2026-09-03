/**
 * Generator — 代码生成引擎（LLM + Prompt 模板）
 *
 * 支持两种产物模式：
 *   1. Component 模式 → Vue SFC / React TSX 组件（单文件）
 *   2. Skill 模式      → Trae IDE Skill 包（SKILL.md + 可选 scripts/*.ts，多文件）
 *
 * 设计要点：
 *   - 用 Discriminated Union 严格区分两种请求的类型约束
 *   - CodegenResult 统一为多文件结构 files: Array<{path, content, language}>
 *     组件模式产出 1 个文件，Skill 模式产出 1~3 个文件
 *   - Prompt 层按 type 路由：ComponentPromptBuilder | SkillPromptBuilder
 */

import { createChatChain } from '../chain/chatChain.js'
import { createRAGService } from '../rag/index.js'

// ── 类型定义（Discriminated Union）───────────────────────────

export type ArtifactType = 'component' | 'skill'

export type Framework = 'vue' | 'react'
export type ScriptLang = 'ts' | 'py'

/** 组件模式请求 */
export interface ComponentRequest {
  type: 'component'
  requirement: string
  framework: Framework
  references?: string[]
  extraPrompt?: string
}

/** Skill 模式请求 */
export interface SkillRequest {
  type: 'skill'
  skillName: string
  requirement: string
  scriptLang?: ScriptLang
  references?: string[]
  extraPrompt?: string
}

export type CodegenRequest = ComponentRequest | SkillRequest

/** 统一的文件产出（支持多文件） */
export interface GeneratedFile {
  path: string
  content: string
  language: string
}

export interface CodegenResult {
  files: GeneratedFile[]
  artifactType: ArtifactType
  metadata: {
    tokenCount: number
    generationTime: number
    framework?: Framework
    scriptLang?: ScriptLang
  }
}

// ── Component Prompt 构建器 ──────────────────────────────────

function buildComponentSystemPrompt(framework: Framework): string {
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

function buildComponentUserPrompt(req: ComponentRequest): string {
  const { requirement, framework, references, extraPrompt } = req
  const fileExt = framework === 'vue' ? '.vue' : '.tsx'

  const sections: string[] = [`## 用户需求\n${requirement}`]

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
6. 使用示例（在文件末尾注释中）

**只输出代码，不要解释文字。**`)

  return sections.join('\n\n')
}

// ── Skill Prompt 构建器 ──────────────────────────────────────

function buildSkillSystemPrompt(): string {
  return `你是一名 AI Skill 工程师，擅长为 Trae IDE 创建高质量的 Skill 包。

## Trae Skill 规范

一个合法的 Trae Skill 包由以下文件组成：

### 1. SKILL.md（必须）

文件位置：\`.trae/skills/<skill-name>/SKILL.md\`

格式要求：
\`\`\`markdown
---
name: "<skill-name>"
description: "<一句话描述：做什么 + 什么时候触发。英文，200字符以内>"
---

# Skill 标题

## When to Use
**CRITICAL: You MUST invoke this skill IMMEDIATELY as your FIRST action when:**
- 条件 1（用户说 X 时）
- 条件 2（用户问 Y 时）

**DO NOT:**
- 不要做什么

## Instructions
详细的执行步骤、约束、注意事项、示例代码等

## Examples
1~2 个具体的使用示例
\`\`\`

### 2. scripts/*.ts（可选）

如果 Skill 需要执行具体代码逻辑（如批量重构、代码生成、文件处理），可以创建 scripts/ 目录放置可执行脚本。
脚本使用 Node.js + TypeScript，用 tsx 或 ts-node 执行。

## 核心原则

1. **description 是关键**：它决定了 AI 什么时候会自动选用这个 Skill，必须包含「做什么」和「什么时候触发」
2. **When to Use 要具体**：列出明确的触发条件，不要模糊
3. **Instructions 要可执行**：给 AI 的指令必须是确定的步骤，不是模糊的建议
4. **脚本要自包含**：scripts/*.ts 不应依赖项目外部的全局变量或状态`
}

function buildSkillUserPrompt(req: SkillRequest): string {
  const { skillName, requirement, scriptLang, references, extraPrompt } = req

  const sections: string[] = [
    `## Skill 名称\n${skillName}`,
    `## 功能需求\n${requirement}`,
  ]

  if (references && references.length > 0) {
    sections.push(`## 参考 Skill 模式\n${references.join('\n\n---\n\n')}`)
  }

  if (scriptLang) {
    sections.push(`## 脚本语言\n${scriptLang === 'ts' ? 'TypeScript（Node.js）' : 'Python 3'}`)
  }

  if (extraPrompt) {
    sections.push(`## 额外要求\n${extraPrompt}`)
  }

  const needsScripts = scriptLang !== undefined

  sections.push(`## 输出要求

**你需要一次输出完整的 Skill 包内容，用以下格式组织多个文件：**

\`\`\`
=== FILE: .trae/skills/${skillName}/SKILL.md ===
<完整的 SKILL.md 内容，含 frontmatter 和详细指令>
${needsScripts ? `

=== FILE: .trae/skills/${skillName}/scripts/main.${scriptLang} ===
<可执行脚本内容>` : ''}
\`\`\`

**每个文件用 \`=== FILE: <相对路径> ===\` 分隔标记。只输出文件内容，不要额外解释。**`)

  return sections.join('\n\n')
}

// ── 文件内容解析（从 LLM 输出中提取多文件） ─────────────────

/**
 * 解析 LLM 输出，提取多个文件内容
 * 格式：=== FILE: <path> ===\n<content>\n=== FILE: ... ===\n<content>
 * 如果没有文件分隔标记，则整个输出视为单文件
 */
function parseMultiFileOutput(
  rawContent: string,
  defaultPath: string,
  defaultLanguage: string
): GeneratedFile[] {
  const filePattern = /=== FILE: (.+?) ===\n([\s\S]*?)(?=\n=== FILE:|$)/g
  const matches = [...rawContent.matchAll(filePattern)]

  if (matches.length === 0) {
    // 没有文件分隔，整体当一个文件
    return [{ path: defaultPath, content: rawContent.trim(), language: defaultLanguage }]
  }

  return matches.map((m) => {
    const path = m[1].trim()
    const content = m[2].trim()
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = {
      md: 'markdown',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      js: 'javascript',
      vue: 'vue',
    }
    return {
      path,
      content,
      language: langMap[ext] || ext || 'text',
    }
  })
}

// ── 代码生成引擎 ────────────────────────────────────────────

export function createCodegenEngine() {
  const rag = createRAGService()

  /** 同步生成（返回多文件结构） */
  async function generate(req: CodegenRequest): Promise<CodegenResult> {
    const startTime = Date.now()
    const chain = createChatChain({ temperature: 0.7 })

    // 根据 type 路由 prompt 构建
    let systemPrompt: string
    let userPrompt: string
    let defaultPath: string
    let defaultLanguage: string

    if (req.type === 'component') {
      systemPrompt = buildComponentSystemPrompt(req.framework)
      userPrompt = buildComponentUserPrompt(req)
      const ext = req.framework === 'vue' ? '.vue' : '.tsx'
      defaultPath = `GeneratedComponent${ext}`
      defaultLanguage = req.framework === 'vue' ? 'vue' : 'typescript'
    } else {
      systemPrompt = buildSkillSystemPrompt()
      userPrompt = buildSkillUserPrompt(req)
      defaultPath = `.trae/skills/${req.skillName}/SKILL.md`
      defaultLanguage = 'markdown'
    }

    // 可选 RAG 检索
    let references = req.references || []
    if (!references || references.length === 0) {
      try {
        const searchResults = await rag.search(req.requirement, 3)
        references = searchResults.map((r) => r.doc.content)
      } catch {
        // RAG 不可用时静默降级
      }
    }

    const finalUserPrompt = req.type === 'component'
      ? buildComponentUserPrompt({ ...req, references })
      : buildSkillUserPrompt({ ...req, references })

    const result = await chain.invoke({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalUserPrompt },
      ],
    })

    const files = parseMultiFileOutput(result.content, defaultPath, defaultLanguage)

    return {
      files,
      artifactType: req.type,
      metadata: {
        tokenCount: result.content.length,
        generationTime: Date.now() - startTime,
        ...(req.type === 'component'
          ? { framework: req.framework }
          : { scriptLang: req.scriptLang }),
      },
    }
  }

  /** 流式生成（用于 SSE 输出） */
  async function* streamGenerate(req: CodegenRequest): AsyncGenerator<{
    type: 'delta' | 'done' | 'error'
    content?: string
    data?: unknown
  }> {
    const startTime = Date.now()
    const chain = createChatChain({ temperature: 0.7 })

    try {
      // 根据 type 路由 prompt
      let systemPrompt: string
      let userPrompt: string
      let defaultPath: string
      let defaultLanguage: string

      if (req.type === 'component') {
        systemPrompt = buildComponentSystemPrompt(req.framework)
        const references = req.references || (await rag.search(req.requirement, 3).catch(() => [])).map((r) => r.doc.content)
        userPrompt = buildComponentUserPrompt({ ...req, references })
        const ext = req.framework === 'vue' ? '.vue' : '.tsx'
        defaultPath = `GeneratedComponent${ext}`
        defaultLanguage = req.framework === 'vue' ? 'vue' : 'typescript'
      } else {
        systemPrompt = buildSkillSystemPrompt()
        const references = req.references || (await rag.search(req.requirement, 3).catch(() => [])).map((r) => r.doc.content)
        userPrompt = buildSkillUserPrompt({ ...req, references })
        defaultPath = `.trae/skills/${req.skillName}/SKILL.md`
        defaultLanguage = 'markdown'
      }

      yield { type: 'delta', content: '', data: { step: 'generating' } }

      let fullContent = ''
      for await (const delta of chain.stream({
        messages: [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ],
        stream: true,
      })) {
        fullContent += delta
        yield { type: 'delta', content: delta }
      }

      // 解析多文件
      const files = parseMultiFileOutput(fullContent, defaultPath, defaultLanguage)

      yield {
        type: 'done',
        content: fullContent,
        data: {
          files,
          artifactType: req.type,
          generationTime: Date.now() - startTime,
        },
      }
    } catch (err) {
      yield { type: 'error', data: { message: (err as Error).message } }
    }
  }

  return { generate, streamGenerate }
}
