const reserved = new Set([
  'SET', 'ON', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'VALUES',
  'AND', 'OR', 'AS', 'IS', 'IN', 'NOT', 'NULL', 'LIKE', 'BETWEEN',
  'BY', 'ASC', 'DESC', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'TRUE', 'FALSE',
  'RETURNING', 'DO', 'CONFLICT', 'EXCLUDED', 'DEFAULT', 'CHECK',
  'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
])

function qualifySchema(sql) {
  return sql.replace(
    /\b(FROM|JOIN|INTO|UPDATE)\s+(?!app\.|public\.|pg_|information_schema\.)(\w+)/gi,
    (m, kw, table) => {
      if (reserved.has(table.toUpperCase())) return m
      return kw + ' app.' + table
    }
  )
}

const tests = [
  `INSERT INTO generator_states (id, state_json, status) VALUES (?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,

  `SELECT * FROM sessions WHERE id = ?`,

  `UPDATE sessions SET status = ? WHERE id = ?`,

  `SELECT * FROM chunks JOIN documents ON chunks.doc_id = documents.id
   WHERE chunks.embedding IS NOT NULL LIMIT 10`,

  `INSERT INTO generator_files (session_id, path, content) VALUES (?, ?, ?)
   ON CONFLICT DO NOTHING`,
]

for (const sql of tests) {
  console.log('=== ORIGINAL ===')
  console.log(sql.trim())
  console.log('\n=== QUALIFIED ===')
  console.log(qualifySchema(sql).trim())
  console.log()
}
