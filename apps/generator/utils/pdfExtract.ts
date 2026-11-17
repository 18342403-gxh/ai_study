/**
 * PDF 前端提取：文字层 → 浏览器 OCR
 *
 * 后端的 pdf-parse 只能处理带文字层的 PDF；扫描件 / 图片型 PDF 没有文字层，
 * 直接上传会解析失败。这里在浏览器里先把 PDF 转成纯文本，再包装成 .txt
 * 走后端已有的文本解析链路，后端无需任何 OCR 依赖。
 *
 * 注意：pdf.js 与 tesseract.js 只能在浏览器里跑（依赖 DOM / Canvas / Worker）。
 * 为了避免 Nuxt SSR 在服务端求值时崩溃，所有重依赖都在函数内动态 import，
 * 模块顶层不引入 pdfjs-dist / tesseract.js。
 */

/** 文字层阈值：少于该字符数视为扫描件，转 OCR */
const TEXT_LAYER_THRESHOLD = 50
/** OCR 渲染缩放：2 倍像素密度兼顾识别率与速度 */
const OCR_SCALE = 2
/** 单页 OCR 超时（毫秒） */
const OCR_PAGE_TIMEOUT_MS = 30_000

export type PdfExtractMethod = 'text' | 'ocr'

export interface PdfExtractProgress {
  stage: 'loading' | 'text' | 'ocr' | 'done'
  method?: PdfExtractMethod
  current: number
  total: number
}

export interface PdfExtractResult {
  text: string
  method: PdfExtractMethod
  pageCount: number
}

type ProgressCb = (progress: PdfExtractProgress) => void

const report = (cb: ProgressCb | undefined, progress: PdfExtractProgress) => cb?.(progress)

/** 懒加载 pdf.js 并配置 worker（Vite 用 ?url 拿到打包后的 worker 路径） */
const loadPdfJs = async () => {
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = (workerUrl as { default: string }).default
  return pdfjs
}

/** 加载 PDF 文档 */
const loadPdf = async (file: File): Promise<any> => {
  const pdfjs = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  return pdfjs.getDocument({ data: arrayBuffer }).promise
}

/** 提取文字层：每页 getTextContent，拼接时保留换行 */
const extractTextLayer = async (pdf: any, onProgress?: ProgressCb): Promise<string> => {
  const pages: string[] = []
  const total = pdf.numPages
  report(onProgress, { stage: 'text', method: 'text', current: 0, total })

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const lines: string[] = []
    let line = ''
    let lastY: number | null = null
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str) continue
      const y = item.transform?.[5] ?? null
      if (lastY !== null && y !== null && y !== lastY && line) {
        lines.push(line.trim())
        line = ''
      }
      line += item.str
      if (y !== null) lastY = y
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.join('\n'))
    report(onProgress, { stage: 'text', method: 'text', current: i, total })
  }
  return pages.filter(Boolean).join('\n\n--- 分页 ---\n\n')
}

/** 单页 OCR：渲染到 canvas 后交给 tesseract */
const ocrPage = async (
  page: any,
  worker: any,
  index: number,
  total: number,
  onProgress?: ProgressCb,
): Promise<string> => {
  const viewport = page.getViewport({ scale: OCR_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise

  report(onProgress, { stage: 'ocr', method: 'ocr', current: index, total })

  const race = await Promise.race([
    worker.recognize(canvas),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`第 ${index} 页 OCR 超时`)), OCR_PAGE_TIMEOUT_MS),
    ),
  ])
  return (race as { data: { text: string } }).data.text
}

/** 扫描件 OCR：逐页识别并拼接 */
const ocrPdf = async (pdf: any, onProgress?: ProgressCb): Promise<string> => {
  const { createWorker } = await import('tesseract.js')
  // chi_sim + eng 同时识别中英文；OCR 首次会下载语言包（约 10-20MB），走 CDN
  const worker = await createWorker(['chi_sim', 'eng'])
  const total = pdf.numPages
  const pages: string[] = []

  try {
    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i)
      const text = await ocrPage(page, worker, i, total, onProgress)
      pages.push(text.trim())
    }
  } finally {
    await worker.terminate()
  }

  return pages.filter(Boolean).join('\n\n--- 分页 ---\n\n')
}

/**
 * 主入口：提取 PDF 文本
 *
 * 优先文字层；文字层内容不足时自动切换到 OCR。
 * 返回的 text 可直接包装成 .txt File 上传。
 */
export const extractPdfText = async (
  file: File,
  onProgress?: ProgressCb,
): Promise<PdfExtractResult> => {
  if (typeof window === 'undefined') {
    throw new Error('PDF 提取只能在浏览器中执行')
  }
  report(onProgress, { stage: 'loading', current: 0, total: 0 })
  const pdf = await loadPdf(file)
  const pageCount = pdf.numPages

  try {
    const textLayer = await extractTextLayer(pdf, onProgress)
    const meaningful = textLayer.replace(/\s/g, '').length
    if (meaningful >= TEXT_LAYER_THRESHOLD) {
      report(onProgress, { stage: 'done', method: 'text', current: pageCount, total: pageCount })
      return { text: textLayer, method: 'text', pageCount }
    }

    const ocrText = await ocrPdf(pdf, onProgress)
    if (!ocrText.trim()) {
      throw new Error('PDF 未识别到任何文字，可能是纯图片或图片质量过低')
    }
    report(onProgress, { stage: 'done', method: 'ocr', current: pageCount, total: pageCount })
    return { text: ocrText, method: 'ocr', pageCount }
  } finally {
    await pdf.cleanup()
  }
}

/** 把提取出的文本包装成 .txt File，复用后端文本上传链路 */
export const wrapAsTextFile = (name: string, text: string): File => {
  const baseName = name.replace(/\.pdf$/i, '')
  return new File([text], `${baseName}.txt`, { type: 'text/plain;charset=utf-8' })
}
