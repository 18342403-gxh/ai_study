/**
 * 文档管理 API
 * POST /api/documents/upload — 上传文档
 * GET  /api/documents        — 获取文档列表
 * DELETE /api/documents/:id  — 删除文档
 */

import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

import { getDb } from '../db/index.js'
import { splitIntoChunks } from '../services/chunker.js'
import { getEmbeddings } from '../services/embedding.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()

// 文件上传配置
const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowedExts = ['.txt', '.md', '.json', '.pdf']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedExts.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`不支持的文件格式: ${ext}`))
    }
  },
})

/** 读取上传文件的文本内容 */
const extractText = async (filePath: string, originalName: string): Promise<string> => {
  const ext = path.extname(originalName).toLowerCase()
  const fs = await import('fs/promises')

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const buffer = await fs.readFile(filePath)
    const data = await pdfParse(buffer)
    return data.text
  }

  // txt/md/json 直接读取
  return fs.readFile(filePath, 'utf-8')
}

/** POST /api/documents/upload */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: '未提供文件' })
      return
    }

    const db = getDb()
    const docId = randomUUID()
    const now = Date.now()

    // 插入文档记录（状态：processing）
    db.prepare(`
      INSERT INTO documents (id, name, size, type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'processing', ?, ?)
    `).run(docId, file.originalname, file.size, path.extname(file.originalname), now, now)

    // 异步处理文档（解析 → 分块 → 向量化）
    // 这里用立即执行的 async 函数模拟后台处理
    ;(async () => {
      try {
        // 1. 提取文本
        const text = await extractText(file.path, file.originalname)

        // 2. 分块
        const chunks = splitIntoChunks(text)

        // 3. 向量化
        const embeddings = await getEmbeddings(chunks.map((c) => c.content))

        // 4. 存入数据库
        const insertChunk = db.prepare(`
          INSERT INTO chunks (id, doc_id, content, chunk_index, embedding)
          VALUES (?, ?, ?, ?, ?)
        `)

        const insertMany = db.transaction(() => {
          for (let i = 0; i < chunks.length; i++) {
            insertChunk.run(
              randomUUID(),
              docId,
              chunks[i].content,
              chunks[i].index,
              JSON.stringify(embeddings[i])
            )
          }
        })
        insertMany()

        // 5. 更新文档状态为 ready
        db.prepare(`
          UPDATE documents SET status = 'ready', chunk_count = ?, updated_at = ?
          WHERE id = ?
        `).run(chunks.length, Date.now(), docId)

      } catch (err) {
        // 处理失败，更新状态
        db.prepare(`
          UPDATE documents SET status = 'failed', updated_at = ? WHERE id = ?
        `).run(Date.now(), docId)
      }
    })()

    // 立即返回文档 ID（后台继续处理）
    res.json({ id: docId, name: file.originalname, status: 'processing' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败'
    res.status(500).json({ error: message })
  }
})

/** GET /api/documents */
router.get('/', (_req, res) => {
  const db = getDb()
  const documents = db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all()
  res.json(documents)
})

/** DELETE /api/documents/:id */
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(req.params.id)
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

export default router
