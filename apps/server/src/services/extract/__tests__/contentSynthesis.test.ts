import type { ChatMessage } from '../../chain/model.js'
import { synthesizeEntryContent } from '../contentSynthesis.js'

const baseParams = {
  type: 'note',
  title: '龚熙皓的简历',
  existingContent: '龚熙皓目前担任哈啰前端开发工程师，拥有3年 B 端开发经验。',
  incomingContent: '龚熙皓是一名全栈工程师。',
  existingSourceType: 'document',
  incomingSourceType: 'conversation',
}

describe('LLM 合并正文重写', () => {
  it('把当前岗位与全栈技术定位组织成自然正文', async () => {
    const invoke = vi.fn(async (messages: ChatMessage[]) => {
      expect(messages[0]?.content).toContain('不得修改姓名、数字、日期、公司、职位、技术名词')
      expect(messages[0]?.content).toContain('真实冲突必须中性并存')
      expect(messages[1]?.content).toContain('龚熙皓是一名全栈工程师')
      return JSON.stringify({
        content: '龚熙皓是一名全栈工程师，目前担任哈啰前端开发工程师，拥有3年 B 端开发经验。',
      })
    })

    const result = await synthesizeEntryContent({ ...baseParams, invoke })

    expect(result.rewritten).toBe(true)
    expect(result.content).toBe(
      '龚熙皓是一名全栈工程师，目前担任哈啰前端开发工程师，拥有3年 B 端开发经验。',
    )
    expect(result.content).not.toContain('被描述为')
    expect(result.content).not.toContain('【来自对话】')
    expect(result.rawContent).toContain('【来自对话】')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('模型调用失败时回退到保留事实和来源的确定性合并', async () => {
    const result = await synthesizeEntryContent({
      ...baseParams,
      invoke: async () => {
        throw new Error('model unavailable')
      },
    })

    expect(result.rewritten).toBe(false)
    expect(result.content).toBe(result.rawContent)
    expect(result.content).toContain('哈啰前端开发工程师')
    expect(result.content).toContain('【来自对话】龚熙皓是一名全栈工程师')
  })

  it('模型输出丢失数字或技术术语时拒绝写入重写结果', async () => {
    const result = await synthesizeEntryContent({
      ...baseParams,
      invoke: async () => JSON.stringify({ content: '龚熙皓是一名全栈工程师。' }),
    })

    expect(result.rewritten).toBe(false)
    expect(result.content).toContain('3年 B 端')
    expect(result.content).toContain('全栈工程师')
  })

  it('模型输出包含机械来源措辞时回退', async () => {
    const result = await synthesizeEntryContent({
      ...baseParams,
      invoke: async () =>
        JSON.stringify({
          content:
            '龚熙皓目前担任哈啰前端开发工程师，拥有3年 B 端开发经验，此外被描述为一名全栈工程师。',
        }),
    })

    expect(result.rewritten).toBe(false)
    expect(result.content).toBe(result.rawContent)
  })

  it('真实冲突允许中性并存，不要求模型选择一方', async () => {
    const result = await synthesizeEntryContent({
      type: 'fact',
      title: '张三的职业',
      existingContent: '张三目前在甲公司担任前端工程师。',
      incomingContent: '张三目前在乙公司担任全栈工程师。',
      existingSourceType: 'document',
      incomingSourceType: 'conversation',
      invoke: async () =>
        JSON.stringify({
          content:
            '张三目前的工作信息存在两种记录：一是在甲公司担任前端工程师，二是在乙公司担任全栈工程师。',
        }),
    })

    expect(result.rewritten).toBe(true)
    expect(result.content).toContain('甲公司担任前端工程师')
    expect(result.content).toContain('乙公司担任全栈工程师')
  })

  it('完全重复的内容不调用模型', async () => {
    const invoke = vi.fn(async () => JSON.stringify({ content: '不应被调用' }))
    const result = await synthesizeEntryContent({
      ...baseParams,
      existingContent: '龚熙皓是一名全栈工程师。',
      incomingContent: '龚熙皓是一名全栈工程师',
      invoke,
    })

    expect(result.rewritten).toBe(false)
    expect(result.content).toBe('龚熙皓是一名全栈工程师。')
    expect(invoke).not.toHaveBeenCalled()
  })
})
