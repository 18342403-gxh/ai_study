import 'dotenv/config'
import http from 'node:http'

const url = new URL(process.env.AI_API_URL + '/chat/completions')
const body = JSON.stringify({
  model: process.env.AI_MODEL || 'glm-4-flash',
  messages: [{ role: 'user', content: '说hello' }],
  stream: false
})

const req = http.request({
  hostname: url.hostname, port: url.port || 443, path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.AI_API_KEY}`,
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let buf = ''
  res.on('data', (c) => buf += c.toString())
  res.on('end', () => {
    console.log('✅ LLM Status:', res.statusCode)
    console.log('Body:', buf.substring(0, 500))
  })
})
req.on('error', (e) => console.error('❌ LLM ERROR:', e.message))
req.setTimeout(10000, () => { console.error('⏱️ LLM 10s 超时'); req.destroy() })
req.write(body)
req.end()
