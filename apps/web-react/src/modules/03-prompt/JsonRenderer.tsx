/**
 * 知识点 3.7：结构化输出（JSON Mode）渲染组件
 *
 * 学习要点：
 * - JSON.parse 安全解析（try-catch 包裹）
 * - 动态渲染 JSON 为卡片/列表
 * - 处理解析失败的降级展示
 *
 * 面试相关：
 * - JSON.parse 失败时如何优雅降级
 * - 如何根据数据结构动态渲染 UI
 */

interface JsonRendererProps {
  content: string
}

interface StructuredAnswer {
  answer: string
  details: string[]
  confidence: number
}

// 📝 面试考点：JSON.parse 必须 try-catch，AI 可能返回非法 JSON
const tryParseJson = (text: string): StructuredAnswer | null => {
  try {
    // AI 返回可能包含 markdown 代码块包裹，先清理
    const cleaned = text
      .replace(/^```json\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned)
    if (parsed.answer && Array.isArray(parsed.details)) {
      return parsed as StructuredAnswer
    }
    return null
  } catch {
    return null
  }
}

const JsonRenderer: React.FC<JsonRendererProps> = ({ content }) => {
  const data = tryParseJson(content)

  // 解析失败时降级为纯文本展示
  if (!data) {
    return (
      <div className="text-sm text-gray-800 whitespace-pre-wrap">{content}</div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 主回答 */}
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
        <div className="text-sm font-medium text-blue-900">{data.answer}</div>
      </div>

      {/* 详情列表 */}
      {data.details.length > 0 && (
        <div className="space-y-1">
          {data.details.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-blue-500 shrink-0">•</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* 置信度 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">置信度：</span>
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${data.confidence * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-600">{Math.round(data.confidence * 100)}%</span>
      </div>
    </div>
  )
}

export default JsonRenderer
