/**
 * SQLite 数据库初始化和操作
 * 存储文档元数据和向量化的文档块
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../../data/knowledge.db')

let db: Database.Database

/** 初始化数据库，创建表结构 */
export const initDatabase = () => {
  db = new Database(DB_PATH)

  // 启用 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL')

  // 文档表
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      chunk_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 文档块表（含向量）
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding TEXT,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `)

  // 创建索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)`)
}

export const getDb = () => db
