import http from 'node:http'

const body = JSON.stringify({ requirement: '一个按钮', artifactType: 'component', framework: 'vue' })
const startTime = Date.now()

const req = http.request({
  host: 'localhost', port: 3001, path: '/api/generator/run', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  console.log(`✅ Connected in ${Date.now() - startTime}ms`)
  console.log('Status:', res.statusCode, '| Content-Type:', res.headers['content-type'])
  let buf = ''
  let lines = 0
  res.on('data', (c) => {
    buf += c.toString()
    const newLines = (buf.match(/\n/g) || []).length
    if (newLines > lines) {
      lines = newLines
      console.log(`  📡 SSE chunk #${lines} (+${c.length} bytes)`)
    }
  })
  res.on('end', () => {
    console.log(`\n✅ Stream done in ${Date.now() - startTime}ms`)
    console.log(`Total: ${buf.length} bytes, ${lines} lines`)
    console.log('--- Preview ---')
    console.log(buf.substring(0, 1000))
  })
})
req.on('error', (e) => console.error('❌ ERROR:', e.message))
req.setTimeout(60000, () => { console.error(`\n⏱️ 60s Timeout at ${Date.now() - startTime}ms — LLM/DB 卡住了`); req.destroy() })
req.write(body)
req.end()
