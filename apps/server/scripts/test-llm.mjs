import http from 'node:http'

const body = JSON.stringify({
  model: 'glm-4-flash',
  messages: [{ role: 'user', content: '说"hello"' }],
  stream: false
})

const req = http.request({
  host: 'localhost', port: 3001,
  path: '/api/chat', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let buf = ''
  res.on('data', (c) => buf += c.toString())
  res.on('end', () => {
    console.log('✅ Status:', res.statusCode)
    console.log('Body:', buf.substring(0, 500))
  })
})
req.on('error', (e) => console.error('❌ ERROR:', e.message))
req.setTimeout(15000, () => { console.error('⏱️ 15s Timeout — LLM 卡住了'); req.destroy() })
req.write(body)
req.end()
