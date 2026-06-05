/**
 * 知识点 2.1/2.3：SSE 数据解析器
 *
 * 学习要点：
 * - SSE 协议格式：每行 `data: ` 前缀，`\n\n` 分隔事件
 * - `[DONE]` 结束标记
 * - delta.content 增量内容提取
 * - 处理粘包/拆包：buffer 缓存未完成的行
 *
 * 面试相关：
 * - SSE 和 WebSocket 的区别
 * - 如何处理流式数据的粘包问题
 */

// 📝 面试考点：SSE 数据行的结构 — "data: {JSON}\n\n"
export interface SSEParseResult {
  content: string
  done: boolean
}

/**
 * 解析单行 SSE 数据
 * 📝 面试考点：SSE 每行以 "data: " 开头，内容是 JSON 或 "[DONE]"
 */
const parseLine = (line: string): SSEParseResult | null => {
  // 跳过空行和注释行
  if (!line || line.startsWith(':')) return null

  // 去掉 "data: " 前缀
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6)

  // 📝 面试考点：[DONE] 标记流式传输结束
  if (data === '[DONE]') {
    return { content: '', done: true }
  }

  try {
    const parsed = JSON.parse(data)
    const content = parsed.choices?.[0]?.delta?.content || ''
    return { content, done: false }
  } catch {
    // JSON 解析失败，跳过这行
    return null
  }
}

/**
 * 创建 SSE 解析器（带 buffer 处理粘包/拆包）
 * 📝 面试考点：流式数据可能一个 chunk 包含多行（粘包），也可能一行被拆到两个 chunk（拆包）
 */
export const createSSEParser = () => {
  let buffer = ''

  return (chunk: string): SSEParseResult[] => {
    buffer += chunk
    const results: SSEParseResult[] = []

    // 按换行符分割，处理 \r\n 和 \n 两种情况
    const lines = buffer.split(/\r?\n/)

    // 最后一个元素可能是不完整的行，保留在 buffer 中
    buffer = lines.pop() || ''

    for (const line of lines) {
      const result = parseLine(line.trim())
      if (result) {
        results.push(result)
      }
    }

    return results
  }
}
