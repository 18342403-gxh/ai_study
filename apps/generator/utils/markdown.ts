/**
 * 回答渲染 — Markdown → HTML，并把引用标记 [n] 变成可点击 chip
 *
 * 安全策略：先转义原始 HTML，再交给 marked。
 * 这样模型输出里的 <script> 只会变成文字，Markdown 语法仍然正常渲染。
 */

import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 渲染助手回答；点击 chip 时由容器上的事件委托处理（data-cite 属性） */
export const renderAnswer = (markdown: string): string => {
  const html = marked.parse(escapeHtml(markdown), { async: false })
  return html.replace(
    /\[(\d{1,2})\]/g,
    (_match, num: string) =>
      `<button type="button" class="cite-chip" data-cite="${num}" title="查看引用 ${num}">${num}</button>`,
  )
}

/** 从点击事件中取出被点的引用编号 */
export const citationFromEvent = (event: Event): number | null => {
  const target = event.target as HTMLElement | null
  const chip = target?.closest('[data-cite]') as HTMLElement | null
  if (!chip) return null
  const num = Number(chip.dataset.cite)
  return Number.isInteger(num) ? num : null
}
