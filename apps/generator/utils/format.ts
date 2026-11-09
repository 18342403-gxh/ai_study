/**
 * 前端日期格式化工具 —— 日程 / 规划 / 事实 / 文档页共用
 * 统一按本地时区渲染，避免各页面各写一套。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 时间：14:05 */
export const formatTime = (ms: number): string => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 日期：11月9日 周日 */
export const formatDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

/** 日期 + 时间：11月9日 周日 14:05 */
export const formatDateTime = (ms: number): string => `${formatDay(ms)} ${formatTime(ms)}`

/** 当天 00:00:00 */
export const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 次日 00:00:00 */
export const endOfDay = (ms: number): number => startOfDay(ms) + 86_400_000

/** 本周一 00:00:00（周一为一周起点） */
export const startOfWeek = (ms: number): number => {
  const d = new Date(startOfDay(ms))
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d.getTime()
}

/** 时间戳 → <input type="datetime-local"> 的值（本地时区） */
export const toDateTimeInput = (ms: number | null): string => {
  if (ms === null) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** <input type="datetime-local"> 的值 → 时间戳；空值 → null */
export const fromDateTimeInput = (value: string): number | null => {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** 相对今天的天数描述：今天 / 明天 / 后天 / 11月12日 */
export const relativeDay = (ms: number, nowMs = Date.now()): string => {
  const diff = Math.round((startOfDay(ms) - startOfDay(nowMs)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  return formatDay(ms)
}
