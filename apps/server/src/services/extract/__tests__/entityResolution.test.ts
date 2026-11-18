import { describe, expect, it } from 'vitest'

import {
  ENTITY_AUTO_MERGE_THRESHOLD,
  extractEntityName,
  findBestEntityMatch,
  mergeEntryContent,
} from '../entityResolution.js'

describe('GoldenMatch 实体解析', () => {
  it('从对话事实与简历标题中提取同一实体', () => {
    expect(extractEntityName({ title: '龚熙皓是一个全栈开发', content: '' })).toBe('龚熙皓')
    expect(extractEntityName({ title: '龚熙皓的简历', content: '' })).toBe('龚熙皓')
  })

  it('跨 fact/note 匹配同一实体，达到自动合并阈值', () => {
    const hit = findBestEntityMatch(
      { type: 'fact', title: '龚熙皓是一个全栈开发', content: '龚熙皓是一个全栈开发' },
      [{ type: 'note', title: '龚熙皓的简历', content: '龚熙皓是一位前端开发工程师。' }],
    )

    expect(hit?.index).toBe(0)
    expect(hit?.entity).toBe('龚熙皓')
    expect(hit?.score).toBeGreaterThanOrEqual(ENTITY_AUTO_MERGE_THRESHOLD)
  })

  it('不同姓名不会达到自动合并阈值', () => {
    const hit = findBestEntityMatch({ type: 'fact', title: '龚熙皓是一个全栈开发', content: '' }, [
      { type: 'note', title: '龚熙明的简历', content: '' },
    ])

    expect(hit?.score ?? 0).toBeLessThan(ENTITY_AUTO_MERGE_THRESHOLD)
  })

  it('schedule 不参与跨类型实体合并', () => {
    const hit = findBestEntityMatch(
      { type: 'schedule', title: '龚熙皓是一个全栈开发', content: '' },
      [{ type: 'note', title: '龚熙皓的简历', content: '' }],
    )
    expect(hit).toBeNull()
  })
})

describe('属性级内容合并', () => {
  it('旧内容更长时仍保留新增短事实及来源', () => {
    const merged = mergeEntryContent({
      existingContent: '龚熙皓是一位前端开发工程师，参与过多个项目。',
      incomingContent: '龚熙皓是一个全栈开发',
      existingSourceType: 'document',
      incomingSourceType: 'conversation',
    })

    expect(merged).toContain('参与过多个项目')
    expect(merged).toContain('【来自对话】龚熙皓是一个全栈开发')
  })

  it('冲突事实并存，不用新值覆盖旧值', () => {
    const merged = mergeEntryContent({
      existingContent: '龚熙皓是前端开发',
      incomingContent: '龚熙皓是全栈开发',
      existingSourceType: 'document',
      incomingSourceType: 'conversation',
    })

    expect(merged).toContain('龚熙皓是前端开发')
    expect(merged).toContain('龚熙皓是全栈开发')
  })

  it('完全重复的事实不重复追加', () => {
    const merged = mergeEntryContent({
      existingContent: '龚熙皓是全栈开发。',
      incomingContent: '龚熙皓是全栈开发',
    })
    expect(merged).toBe('龚熙皓是全栈开发。')
  })
})
