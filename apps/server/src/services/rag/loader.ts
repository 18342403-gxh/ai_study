/**
 * RAG Step 1: Loader — 多格式文档加载器
 * 支持 txt / md / json / pdf 四种格式
 * 统一输出纯文本，方便后续 Splitter 处理
 */

import path from 'path'
import { randomUUID } from 'crypto'

export interface LoadedDocument {
  id: string
  name: string
  source: string
  content: string
  metadata: Record<string, unknown>
}

export interface LoadOptions {
  metadata?: Record<string, unknown>
}

/** 根据扩展名判断文件类型 */
function detectType(filename: string): string {
  return path.extname(filename).toLowerCase()
}

/** PDF 加载器 */
async function loadPdf(filePath: string, originalName: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default
  const fs = await import('fs/promises')
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  return data.text
}

/** 纯文本加载器（txt/md/json） */
async function loadPlain(filePath: string): Promise<string> {
  const fs = await import('fs/promises')
  return fs.readFile(filePath, 'utf-8')
}

/**
 * 从文件路径加载文档
 */
export async function loadFromFile(
  filePath: string,
  originalName?: string,
  options: LoadOptions = {}
): Promise<LoadedDocument> {
  const name = originalName || path.basename(filePath)
  const type = detectType(name)

  let content: string
  switch (type) {
    case '.pdf':
      content = await loadPdf(filePath, name)
      break
    case '.txt':
    case '.md':
    case '.json':
      content = await loadPlain(filePath)
      break
    default:
      throw new Error(`不支持的文件类型: ${type}`)
  }

  return {
    id: randomUUID(),
    name,
    source: filePath,
    content,
    metadata: {
      ...options.metadata,
      type,
      loadedAt: Date.now(),
    },
  }
}

/**
 * 从字符串加载（用于测试或直接灌入文本）
 */
export function loadFromString(text: string, name = 'inline.txt', options: LoadOptions = {}): LoadedDocument {
  return {
    id: randomUUID(),
    name,
    source: 'inline',
    content: text,
    metadata: {
      ...options.metadata,
      type: 'inline',
      loadedAt: Date.now(),
    },
  }
}

/**
 * 从 URL 加载（抓取网页 → 提取纯文本 → 作为文档）
 *
 * 零外部依赖：Node 18+ 原生 fetch + 正则剥离 HTML 标签
 * 对 HTML 做了基本的噪音过滤（<script>/<style>/<nav>/<footer>/<header>）
 */
const MAX_URL_BYTES = 2 * 1024 * 1024 // 2MB，避免巨大页面

export async function loadFromUrl(
  url: string,
  name?: string,
  options: LoadOptions = {}
): Promise<LoadedDocument> {
  // 1. fetch 页面（带超时 + size limit）
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  let res: Response
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 伪装成浏览器，避免某些站点拒绝 node-fetch UA
        'User-Agent': 'Mozilla/5.0 (compatible; ai-study-rag/1.0)',
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
      },
      redirect: 'follow',
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`抓取失败 HTTP ${res.status}: ${res.statusText}`)
  }

  // 检查大小（ReadableStream 读前先看 content-length）
  const lenHeader = res.headers.get('content-length')
  if (lenHeader && Number(lenHeader) > MAX_URL_BYTES) {
    throw new Error(`页面过大 (${lenHeader} bytes)，最大支持 ${MAX_URL_BYTES / 1024 / 1024}MB`)
  }

  const raw = await res.text()
  if (raw.length > MAX_URL_BYTES) {
    throw new Error(`页面过大 (${raw.length} chars)`)
  }

  // 2. 判断内容类型
  const contentType = res.headers.get('content-type') || ''
  const isHtml = contentType.includes('html') || /<!DOCTYPE\s+html|<html/i.test(raw.slice(0, 500))

  let text: string
  let title = ''

  if (isHtml) {
    // ── HTML → 纯文本 ──
    text = stripHtmlToText(raw)
    // 尝试提取 <title> 作为文档名
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    title = titleMatch ? titleMatch[1].trim().slice(0, 120) : ''
  } else {
    // 纯文本 / JSON / Markdown — 直接用
    text = raw
  }

  if (!text.trim()) {
    throw new Error('页面内容为空，无法提取有效文本')
  }

  const resolvedName = name
    || title
    || new URL(url).hostname + new URL(url).pathname
    || url.slice(0, 80)

  return {
    id: randomUUID(),
    name: resolvedName,
    source: url,
    content: text,
    metadata: {
      ...options.metadata,
      type: isHtml ? 'url-html' : 'url-text',
      url,
      status: res.status,
      contentType,
      title,
      loadedAt: Date.now(),
    },
  }
}

/**
 * 把 HTML 转成纯文本（轻量正则版，零依赖）
 *
 * 策略：
 *  1. 移除 <script>/<style>/<noscript>/<iframe>/<svg>/<canvas>/<template>/<nav>/<footer>/<header>/<aside> 整块
 *  2. 把 <br> / <p> / <div> / <li> / <h1-6> / <tr> 等块级标签替换成换行
 *  3. 移除所有剩余 HTML 标签
 *  4. HTML entities 解码（&amp; &lt; &gt; &nbsp; &quot; &#39; 等）
 *  5. 合并多余空行和空格
 */
function stripHtmlToText(html: string): string {
  let s = html

  // 1. 移除噪音块（DOTALL 模式 — [\s\S] 匹配跨行）
  const NOISE_TAGS = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    'template', 'nav', 'footer', 'header', 'aside', 'form',
  ]
  for (const tag of NOISE_TAGS) {
    s = s.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '\n')
  }

  // 2. 把常见块级标签 → 换行（保持段落结构）
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|tr|h[1-6]|blockquote|pre|hr)[^>]*>/gi, '\n')
    .replace(/<\/(ul|ol|table|section|article|main|body)>/gi, '\n')

  // 3. 移除剩余所有 HTML 标签
  s = s.replace(/<[^>]+>/g, '')

  // 4. HTML entities 解码（常见 ones，不追求全量）
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x?([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16)
      return isNaN(code) ? '' : String.fromCharCode(code)
    })

  // 5. 合并多余空行和空白
  s = s
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return s
}
