/**
 * 纯文本分块 — 无 LangChain 依赖
 *
 * simpleSplit 的逻辑与 splitter.ts 里的 simpleSplit 完全一致，
 * 但这个文件只导出纯函数，不 import LangChain。
 * 测试和 routes 可以安全 import 这里而不拉进整个 LangChain 依赖树。
 *
 * v5 分片策略（spec 4.2）：
 *   - splitStructured 是文档入库的主分片函数（结构 → 段落 → 句子 → 硬切 四级）
 *   - simpleSplit 保留为兜底（无结构文本的纯硬切）
 *   - 统一参数：目标 600 / 下限 80 / 重叠 80 / 硬上限 900 / 单文档块数上限 500
 */

export interface TextChunk {
  id: string
  content: string
  index: number
  metadata: Record<string, unknown>
}

// ── v5 统一分片参数（spec 4.2.3） ────────────────────────
export const CHUNK_TARGET = 600
export const CHUNK_MIN = 80
export const CHUNK_OVERLAP = 80
export const CHUNK_HARD_MAX = 900
export const CHUNK_MAX_COUNT = 500

/**
 * 简化版分块器：按固定字符长度硬切 + 重叠窗口
 * 兜底策略（v5 默认 600/80）；结构化分片请用 splitStructured
 */
export function simpleSplit(
  text: string,
  maxChunkSize = CHUNK_TARGET,
  overlap = CHUNK_OVERLAP,
): TextChunk[] {
  if (text.length <= maxChunkSize) {
    return [
      {
        id: `chunk_${Date.now()}_0`,
        content: text,
        index: 0,
        metadata: { tokenCount: text.length },
      },
    ]
  }

  const chunks: TextChunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length)
    const chunk = text.slice(start, end)
    chunks.push({
      id: `chunk_${Date.now()}_${index}`,
      content: chunk,
      index,
      metadata: { tokenCount: chunk.length },
    })
    start = end - overlap
    index++
  }

  return chunks
}

// ════════════════════════════════════════════════════════
// splitStructured — v5 文档结构化分片（spec 4.2.2 四级策略）
// ════════════════════════════════════════════════════════

export interface StructuredSplitOptions {
  targetSize?: number // 目标块大小，默认 600
  minChunkSize?: number // 块下限，小于并入前一块，默认 80
  overlap?: number // 硬切重叠，默认 80
  hardMax?: number // 单块硬上限，默认 900
  maxChunks?: number // 单文档块数上限，默认 500
}

type ContentType = 'text' | 'code'

interface Section {
  headingPath: string[]
  text: string
  /** 在原文中的起始偏移（用于 charStart/charEnd 元数据） */
  baseOffset: number
}

interface Unit {
  content: string
  contentType: ContentType
  charStart: number
  charEnd: number
}

interface PackedChunk {
  content: string
  contentType: ContentType
  headingPath: string[]
  charStart: number
  charEnd: number
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const FENCE_RE = /^```/
/** 中文句读 + 英文句读（保留分隔符在句尾） */
const SENTENCE_RE = /[^。！？；!?;\n]+[。！？；!?;]?|\n+/g

/** 第一级：按 Markdown 标题切结构块，维护标题路径 */
function splitSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  const headingStack: string[] = []
  let buf: string[] = []
  let bufOffset = 0
  let offset = 0
  let inFence = false
  /** buf 内是否已有正文（连续标题行不单独成块，归入后续正文块） */
  let hasBody = false

  const flush = () => {
    const body = buf.join('\n')
    if (body.trim()) {
      sections.push({ headingPath: [...headingStack], text: body, baseOffset: bufOffset })
    }
    buf = []
    hasBody = false
  }

  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence

    const m = inFence ? null : HEADING_RE.exec(line)
    if (m) {
      if (hasBody) flush()
      const level = m[1].length
      headingStack.length = level - 1
      headingStack[level - 1] = m[2]
      // 标题行归入其开启的结构块（保留标题作为块开头）
      if (buf.length === 0) bufOffset = offset
      buf.push(line)
    } else {
      if (buf.length === 0) bufOffset = offset
      buf.push(line)
      if (line.trim()) hasBody = true
    }
    offset += line.length + 1 // + '\n'
  }
  flush()

  return sections
}

/** 把结构块正文拆成原子单元：代码块整体保留，段落按空行切 */
function splitUnits(section: Section): Unit[] {
  const units: Unit[] = []
  const lines = section.text.split('\n')
  let offset = section.baseOffset
  let buf: string[] = []
  let bufOffset = offset
  let bufType: ContentType = 'text'
  let inFence = false

  const flush = () => {
    const content = buf.join('\n')
    if (content.trim()) {
      units.push({
        content,
        contentType: bufType,
        charStart: bufOffset,
        charEnd: bufOffset + content.length,
      })
    }
    buf = []
  }

  for (const line of lines) {
    const isFence = FENCE_RE.test(line)
    if (isFence && !inFence) {
      // 代码块开始：先 flush 已有段落
      flush()
      inFence = true
      bufType = 'code'
      buf = [line]
      bufOffset = offset
    } else if (isFence && inFence) {
      // 代码块结束
      buf.push(line)
      flush()
      inFence = false
      bufType = 'text'
    } else if (!inFence && !line.trim()) {
      // 空行 → 段落边界
      flush()
    } else {
      if (buf.length === 0) bufOffset = offset
      buf.push(line)
    }
    offset += line.length + 1
  }
  flush()

  return units
}

/** 第三级：超长文本按句子切，累积到 target 为止 */
function splitBySentence(text: string, target: number, hardMax: number, overlap: number): string[] {
  const sentences = text.match(SENTENCE_RE) || [text]
  const pieces: string[] = []
  let cur = ''

  for (const s of sentences) {
    if (s.length > hardMax) {
      // 单句超硬上限 → 第四级硬切
      if (cur) {
        pieces.push(cur)
        cur = ''
      }
      let start = 0
      while (start < s.length) {
        const end = Math.min(start + target, s.length)
        pieces.push(s.slice(start, end))
        if (end >= s.length) break
        start = end - overlap
      }
      continue
    }
    if (cur && cur.length + s.length > target) {
      pieces.push(cur)
      cur = s
    } else {
      cur += s
    }
  }
  if (cur) pieces.push(cur)
  return pieces
}

/** 第二级打包：单元按 target 合并；超 target 单元走句子/硬切降级 */
function packUnits(
  sections: Section[],
  target: number,
  hardMax: number,
  overlap: number,
): PackedChunk[] {
  const out: PackedChunk[] = []
  let cur: PackedChunk | null = null

  const flush = () => {
    if (cur) {
      out.push(cur)
      cur = null
    }
  }

  for (const section of sections) {
    for (const unit of splitUnits(section)) {
      if (unit.content.length > target) {
        flush()
        // 降级：代码块超 hardMax 按空行切（spec 4.2.4），文本走句子切
        const pieces =
          unit.contentType === 'code' && unit.content.length <= hardMax
            ? [unit.content]
            : splitBySentence(unit.content, target, hardMax, overlap)
        let localOffset = unit.charStart
        for (const p of pieces) {
          out.push({
            content: p,
            contentType: unit.contentType,
            headingPath: section.headingPath,
            charStart: localOffset,
            charEnd: localOffset + p.length,
          })
          localOffset += p.length
        }
        continue
      }

      if (!cur) {
        cur = {
          content: unit.content,
          contentType: unit.contentType,
          headingPath: section.headingPath,
          charStart: unit.charStart,
          charEnd: unit.charEnd,
        }
        continue
      }

      const merged = cur.content + '\n\n' + unit.content
      if (merged.length <= target && cur.contentType === unit.contentType) {
        cur.content = merged
        cur.charEnd = unit.charEnd
      } else {
        flush()
        cur = {
          content: unit.content,
          contentType: unit.contentType,
          headingPath: section.headingPath,
          charStart: unit.charStart,
          charEnd: unit.charEnd,
        }
      }
    }
    // 结构块边界强制切分：跨标题不合并（保留 headingPath 纯度）
    flush()
  }
  flush()

  return out
}

/**
 * 文档结构化分片（v5 主分片函数）
 *
 * 四级策略：
 *   1. Markdown 标题 → 结构块（带 headingPath 元数据）
 *   2. 结构块超 600 → 按空行段落合并/切分（代码块整体保留）
 *   3. 段落超 600 无空行 → 按中英文句读切句累积
 *   4. 无标点超长文本 → 600 硬切，overlap 80
 *
 * 附加规则：
 *   - 块 < minChunkSize（80）并入前一块
 *   - 单文档块数超 maxChunks（500）抛错（提示文档过大）
 */
export function splitStructured(text: string, options: StructuredSplitOptions = {}): TextChunk[] {
  const {
    targetSize = CHUNK_TARGET,
    minChunkSize = CHUNK_MIN,
    overlap = CHUNK_OVERLAP,
    hardMax = CHUNK_HARD_MAX,
    maxChunks = CHUNK_MAX_COUNT,
  } = options

  if (!text.trim()) {
    return [
      {
        id: `chunk_${Date.now()}_0`,
        content: text,
        index: 0,
        metadata: {
          tokenCount: text.length,
          headingPath: [],
          charStart: 0,
          charEnd: text.length,
          contentType: 'text',
        },
      },
    ]
  }

  const sections = splitSections(text)
  const packed = packUnits(sections, targetSize, hardMax, overlap)

  // 小块并入前一块
  const merged: PackedChunk[] = []
  for (const c of packed) {
    const prev = merged[merged.length - 1]
    if (prev && c.content.length < minChunkSize && prev.contentType === c.contentType) {
      prev.content += '\n\n' + c.content
      prev.charEnd = c.charEnd
    } else {
      merged.push({ ...c })
    }
  }

  if (merged.length > maxChunks) {
    throw new Error(`文档过大：分块数 ${merged.length} 超过上限 ${maxChunks}，建议拆分后再导入`)
  }

  return merged.map((c, index) => ({
    id: `chunk_${Date.now()}_${index}`,
    content: c.content,
    index,
    metadata: {
      tokenCount: c.content.length,
      headingPath: c.headingPath,
      charStart: c.charStart,
      charEnd: c.charEnd,
      contentType: c.contentType,
    },
  }))
}
