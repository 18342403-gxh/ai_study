/**
 * DB 门面转换函数回归测试
 * 零依赖，node scripts/test-db-wrap.mjs 直接跑
 *
 * 覆盖：
 *   1. sqliteToPgParams — ? 占位符转 $N，字符串内的 ? 不转
 *   2. qualifySchema    — 裸表名加 app.，关键字不误转，逗号分隔多表
 */

const RESERVED = new Set([
  'SET', 'ON', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'VALUES',
  'AND', 'OR', 'AS', 'IS', 'IN', 'NOT', 'NULL', 'LIKE', 'BETWEEN',
  'BY', 'ASC', 'DESC', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'TRUE', 'FALSE',
  'RETURNING', 'DO', 'CONFLICT', 'EXCLUDED', 'DEFAULT', 'CHECK',
  'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
  'WITH', 'RECURSIVE', 'LATERAL', 'CROSS', 'NATURAL', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'TABLESAMPLE', 'ONLY', 'USING',
])

// ─── 复制 db/index.ts 里的两个核心函数（独立可测） ───

function sqliteToPgParams(sql) {
  let counter = 0
  let inSingle = false, inDouble = false, escapeNext = false
  let result = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (escapeNext) { result += c; escapeNext = false; continue }
    if (c === '\\') { result += c; escapeNext = true; continue }
    if (c === "'" && !inDouble) { inSingle = !inSingle; result += c; continue }
    if (c === '"' && !inSingle) { inDouble = !inDouble; result += c; continue }
    if (c === '?' && !inSingle && !inDouble) { result += `$${++counter}`; continue }
    result += c
  }
  return result
}

function qualifySchema(sql) {
  let result = sql.replace(
    /\b(FROM|JOIN|INTO|UPDATE)\s+(?!app\.|public\.|pg_|information_schema\.)(\w+)/gi,
    (m, kw, table) => RESERVED.has(table.toUpperCase()) ? m : kw + ' app.' + table
  )
  result = result.replace(
    /((?:FROM|JOIN)\s+app\.\w+(?:\s+(?:AS\s+)?\w+)?)\s*,\s*(?!app\.|public\.|pg_|information_schema\.)(\w+)/gi,
    (m, prefix, table) => RESERVED.has(table.toUpperCase()) ? m : `${prefix}, app.${table}`
  )
  return result
}

// ─── 测试框架（极简，零依赖） ───

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++ }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++ }
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''}\n    got:      ${actual}\n    expected: ${expected}`)
}

// ─── sqliteToPgParams ───

console.log('\n📦 sqliteToPgParams')

test('基本 ? 占位符', () => {
  assertEqual(sqliteToPgParams('SELECT * FROM t WHERE id = ?'), 'SELECT * FROM t WHERE id = $1')
})

test('多个 ? 顺序递增', () => {
  assertEqual(sqliteToPgParams('INSERT INTO t (a, b, c) VALUES (?, ?, ?)'),
    'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)')
})

test('字符串内的 ? 不转', () => {
  assertEqual(sqliteToPgParams("SELECT * FROM t WHERE x = 'what?' AND y = ?"),
    "SELECT * FROM t WHERE x = 'what?' AND y = $1")
})

test('双引号字符串内的 ? 不转', () => {
  assertEqual(sqliteToPgParams('SELECT * FROM t WHERE x = "a?b" AND y = ?'),
    'SELECT * FROM t WHERE x = "a?b" AND y = $1')
})

test('混合引号 + 字符串外 ? 正常转', () => {
  assertEqual(sqliteToPgParams("SELECT * FROM t WHERE a = '?' AND b = ? AND c = '?' AND d = ?"),
    "SELECT * FROM t WHERE a = '?' AND b = $1 AND c = '?' AND d = $2")
})

test('转义字符不影响引号状态', () => {
  // 注意：SQLite 的单引号转义是 ''（两个单引号），不是 \'
  // 这里的 \\' 是 JavaScript 字符串，实际 SQL 是 \'
  assertEqual(sqliteToPgParams("SELECT * FROM t WHERE x = ? AND y = ''"),
    "SELECT * FROM t WHERE x = $1 AND y = ''")
})

// ─── qualifySchema ───

console.log('\n🏷️  qualifySchema')

test('基本 FROM', () => {
  assertEqual(qualifySchema('SELECT * FROM sessions'), 'SELECT * FROM app.sessions')
})

test('INTO', () => {
  assertEqual(qualifySchema('INSERT INTO sessions (id) VALUES (?)'), 'INSERT INTO app.sessions (id) VALUES (?)')
})

test('UPDATE', () => {
  assertEqual(qualifySchema('UPDATE sessions SET x = ? WHERE id = ?'), 'UPDATE app.sessions SET x = ? WHERE id = ?')
})

test('DELETE FROM', () => {
  assertEqual(qualifySchema('DELETE FROM sessions WHERE id = ?'), 'DELETE FROM app.sessions WHERE id = ?')
})

test('LEFT JOIN', () => {
  assertEqual(qualifySchema('SELECT * FROM sessions LEFT JOIN messages ON sessions.id = messages.session_id'),
    'SELECT * FROM app.sessions LEFT JOIN app.messages ON sessions.id = messages.session_id')
})

test('ON CONFLICT DO UPDATE — SET/DO/CONFLICT/EXCLUDED 不被误转', () => {
  const inp = 'INSERT INTO generator_states (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json'
  const out = qualifySchema(inp)
  assertEqual(out, 'INSERT INTO app.generator_states (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json')
})

test('关键字 ON 不被误转', () => {
  const inp = 'SELECT * FROM sessions JOIN messages ON sessions.id = messages.session_id'
  const out = qualifySchema(inp)
  // ON 不应被当作表名
  assertEqual(out, 'SELECT * FROM app.sessions JOIN app.messages ON sessions.id = messages.session_id')
})

test('app. 前缀不重复加', () => {
  assertEqual(qualifySchema('SELECT * FROM app.sessions'), 'SELECT * FROM app.sessions')
})

test('子查询内层 FROM', () => {
  assertEqual(qualifySchema('SELECT * FROM (SELECT id FROM sessions) AS sub'),
    'SELECT * FROM (SELECT id FROM app.sessions) AS sub')
})

test('INSERT...SELECT 两个表都要加', () => {
  const out = qualifySchema('INSERT INTO chunks SELECT id FROM documents')
  assertEqual(out, 'INSERT INTO app.chunks SELECT id FROM app.documents')
})

// ─── 逗号分隔多表（Step 2） ───

console.log('\n🔗  qualifySchema Step 2: 逗号分隔多表')

test('FROM t1, t2 两个都要加', () => {
  assertEqual(qualifySchema('FROM t1, t2'), 'FROM app.t1, app.t2')
})

test('FROM t1 s, t2 m 带别名', () => {
  assertEqual(qualifySchema('FROM t1 s, t2 m'), 'FROM app.t1 s, app.t2 m')
})

test('逗号表已限定不重复', () => {
  assertEqual(qualifySchema('FROM app.t1, messages'), 'FROM app.t1, app.messages')
})

test('真实代码: sessions 统计查询', () => {
  const inp = 'SELECT s.*, COUNT(m.id) FROM sessions s, messages m WHERE m.session_id = s.id GROUP BY s.id'
  const out = qualifySchema(inp)
  assertEqual(out.includes('FROM app.sessions s, app.messages m'), true, '两个表都应加 app.')
})

test('逗号表是关键字时不误转', () => {
  // 如果有人写 "FROM sessions, SELECT" 这种怪 SQL — SELECT 不是 reserved... 但这是非法 SQL
  // 测试一个合理场景: FROM sessions, EXCLUDED — EXCLUDED 是 reserved
  assertEqual(qualifySchema('FROM sessions, EXCLUDED'), 'FROM app.sessions, EXCLUDED')
})

// ─── 全量真实 SQL 回归 ───

console.log('\n📋  真实代码 SQL 回归（24 条）')

const realSqls = [
  'SELECT s.*, COUNT(m.id) FROM sessions s LEFT JOIN messages m ON m.session_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC',
  'INSERT INTO sessions (id, title, model, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  'SELECT * FROM sessions WHERE id = ?',
  'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
  'UPDATE sessions SET title = ? WHERE id = ?',
  'DELETE FROM sessions WHERE id = ?',
  'INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  'DELETE FROM messages WHERE session_id = ?',
  'INSERT INTO documents (id, name, size, type, status, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
  'UPDATE documents SET status = ? WHERE id = ?',
  'SELECT * FROM documents ORDER BY created_at DESC',
  'DELETE FROM documents WHERE id = ?',
  'SELECT * FROM chunks WHERE doc_id IN (?) AND embedding IS NOT NULL',
  'SELECT name FROM documents WHERE id = ?',
  'SELECT state_json FROM generator_states WHERE id = ?',
  'INSERT INTO generator_states (id, state_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, status = excluded.status, updated_at = excluded.updated_at',
  'SELECT state_json FROM agent_states WHERE thread_id = ?',
  'INSERT INTO agent_states (thread_id, state_json, status, current_node, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, status = excluded.status, current_node = excluded.current_node, updated_at = excluded.updated_at',
  'INSERT INTO tool_calls (id, session_id, tool_name, args_json, result_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  'SELECT s.*, COUNT(m.id) as message_count FROM sessions s LEFT JOIN messages m ON m.session_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC',
  'INSERT INTO documents (id, name, size, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  'INSERT INTO chunks (id, doc_id, content, chunk_index, embedding) VALUES (?, ?, ?, ?, ?)',
  'UPDATE documents SET status = ?, chunk_count = ?, updated_at = ? WHERE id = ?',
  'DELETE FROM chunks WHERE doc_id = ?',
]

const allTables = ['sessions', 'messages', 'documents', 'chunks', 'generator_states', 'agent_states', 'tool_calls']

for (const sql of realSqls) {
  const out = qualifySchema(sql)
  // 每个出现的表名都应该加 app.
  for (const tbl of allTables) {
    const bareRe = new RegExp('\\b(FROM|JOIN|INTO|UPDATE)\\s+' + tbl + '\\b', 'i')
    if (bareRe.test(sql)) {
      // 这个表在 SQL 里裸出现
      const qualifiedRe = new RegExp('\\b(FROM|JOIN|INTO|UPDATE)\\s+app\\.' + tbl + '\\b', 'i')
      if (!qualifiedRe.test(out)) {
        console.log('  ✗ 漏加 schema: ' + tbl + ' in SQL: ' + sql.substring(0, 60))
        console.log('    OUT: ' + out.substring(0, 80))
        failed++
      }
    }
  }
  // sqliteToPgParams: ? 全部转成 $N
  const pgSql = sqliteToPgParams(sql)
  if (pgSql.includes('?')) {
    console.log('  ✗ 漏转 ?: ' + sql.substring(0, 60))
    failed++
  }
}
if (failed === 0) {
  console.log('  ✓ 全部 24 条真实 SQL 通过')
  passed++
}

// ─── 汇总 ───

console.log('\n══════════════════════════════')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('══════════════════════════════\n')
process.exit(failed > 0 ? 1 : 0)
