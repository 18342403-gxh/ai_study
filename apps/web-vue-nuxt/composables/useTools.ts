/**
 * useTools — 工具调用 Composable
 * 
 * 连接 BFF /api/tools 接口
 * 支持工具列表查询和工具执行
 * 
 * 服务端格式：
 *   GET /api/tools/list → { tools: [{ name, description, schema }], count }
 *   POST /api/tools/execute → { toolName, result }
 */

import { ref } from 'vue'
import type { ToolDefinition, ToolExecuteResult } from '@ai-study/shared'

const tools = ref<ToolDefinition[]>([])
const isLoading = ref(false)
const isExecuting = ref(false)
const lastResult = ref<ToolExecuteResult | null>(null)
const error = ref<string | null>(null)

export function useTools() {
  const config = useRuntimeConfig()
  const bffUrl = config.public.bffUrl || 'http://localhost:3001'
  const baseUrl = `${bffUrl}/api/tools`

  const loadTools = async () => {
    isLoading.value = true
    error.value = null
    try {
      const res = await fetch(`${baseUrl}/list`)
      if (!res.ok) throw new Error(`获取工具列表失败: ${res.status}`)
      const data = await res.json()
      tools.value = data.tools || data
    } catch (err) {
      error.value = err instanceof Error ? err.message : '请求失败'
    } finally {
      isLoading.value = false
    }
  }

  const executeTool = async (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecuteResult | null> => {
    isExecuting.value = true
    error.value = null
    try {
      const res = await fetch(`${baseUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args }),
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `工具执行失败: ${res.status}`)
      }
      const result = await res.json() as ToolExecuteResult
      lastResult.value = result
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : '执行失败'
      lastResult.value = {
        toolName,
        result: null,
        success: false,
        error: error.value || '执行失败',
      }
      return null
    } finally {
      isExecuting.value = false
    }
  }

  const clearResult = () => {
    lastResult.value = null
    error.value = null
  }

  return {
    tools,
    isLoading,
    isExecuting,
    lastResult,
    error,
    loadTools,
    executeTool,
    clearResult,
  }
}
