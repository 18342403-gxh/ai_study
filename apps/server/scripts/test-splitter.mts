/** splitStructured 手动验证（vitest 排除 splitter.test.ts 的替代手段） */
import { splitStructured } from '../src/services/rag/splitterPure.js'

let failed = 0
const check = (name: string, cond: boolean) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name)
  if (!cond) failed++
}

// 1. Markdown 标题 → 结构块 + headingPath
const body = '这是一段足够长的正文内容，用来避免小块合并逻辑把标题块并掉。'.repeat(3)
const md = ['# 项目笔记', '## 前端工程化', '### 构建', body, '### 测试', body].join('\n')
const cs = splitStructured(md)
check('标题切块数为 2', cs.length === 2)
check(
  'headingPath[0] = 项目笔记/前端工程化/构建',
  JSON.stringify(cs[0].metadata.headingPath) === JSON.stringify(['项目笔记', '前端工程化', '构建']),
)
check(
  'headingPath[1] = 项目笔记/前端工程化/测试',
  JSON.stringify(cs[1].metadata.headingPath) === JSON.stringify(['项目笔记', '前端工程化', '测试']),
)
check('块内容保留标题行', cs[0].content.includes('### 构建'))

// 2. 无标点超长 → 600 硬切 + 80 重叠
const hard = splitStructured('a'.repeat(1500))
check('硬切块数 >= 2', hard.length >= 2)
check('首块长度 600', hard[0].content.length === 600)
check('重叠 80', hard[1].content.slice(0, 80) === hard[0].content.slice(-80))

// 3. 代码块整体保留
const code = '```ts\n' + 'const x = 1\n'.repeat(30) + '```'
const cc = splitStructured(
  '前置说明文字，要足够长避免被小块合并掉。\n\n' + code + '\n\n后续说明文字，同样要足够长避免被小块合并掉。',
)
const codeChunks = cc.filter((c) => c.metadata.contentType === 'code')
check('代码块单独成块且只有 1 个', codeChunks.length === 1)
check('代码块完整（含围栏）', codeChunks[0].content.startsWith('```ts') && codeChunks[0].content.endsWith('```'))

// 4. 超长段落无空行 → 句子切
const s = '这是一个用来凑长度的句子，里面什么实质内容都没有。'.repeat(40)
const sc = splitStructured(s)
check('句子切块数 > 1', sc.length > 1)
check('每块 <= 600', sc.every((c) => c.content.length <= 600))
check('句子不被切断', sc[0].content.endsWith('。'))

// 5. 小块并入前一块
const mergeCase = splitStructured('长段落。'.repeat(100) + '\n\n短尾巴。')
check('小块并入前块 → 单块', mergeCase.length === 1 && mergeCase[0].content.includes('短尾巴。'))

// 6. 块数上限抛错
let threw = false
try {
  splitStructured('一句话。\n\n'.repeat(300), { targetSize: 10, minChunkSize: 0, maxChunks: 50 })
} catch (e) {
  threw = /文档过大/.test((e as Error).message)
}
check('块数超上限抛错', threw)

console.log(failed === 0 ? '\n✅ 全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
