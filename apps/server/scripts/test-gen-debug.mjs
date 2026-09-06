import http from 'node:http'

const body = JSON.stringify({ requirement: '按钮组件', artifactType: 'component', framework: 'vue' })
const startTime = Date.now()

const req = http.request({
  host: 'localhost', port: 3001, path: '/api/generator/run', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  console.log(`✅ Connected in ${Date.now() - startTime}ms, Status: ${res.statusCode}`)
  let buf = '', chunks = 0
  res.on('data', (c) => { buf += c.toString(); chunks++ })
  res.on('end', () => console.log(`🏁 res.on('end') — ${Date.now() - startTime}ms, ${chunks} chunks`))
  res.on('finish', () => console.log(`🏁 res.on('finish') — ${Date.now() - startTime}ms`))
  res.on('close', () => console.log(`🏁 res.on('close') — ${Date.now() - startTime}ms`))
})
req.on('error', (e) => console.error('❌ ERROR:', e.message))
req.setTimeout(60000, () => { console.error(`⏱️ 60s Timeout at ${Date.now() - startTime}ms`); req.destroy() })
req.write(body)
req.end()
