import http from 'node:http'

const body = JSON.stringify({ requirement: '一个按钮组件', artifactType: 'component', framework: 'vue' })
const req = http.request({
  host: 'localhost', port: 3001, path: '/api/generator/run', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  console.log('✅ Status:', res.statusCode)
  console.log('Content-Type:', res.headers['content-type'] || '(none)')
  let buf = ''
  res.on('data', (c) => { buf += c.toString() })
  res.on('end', () => {
    console.log('Total bytes:', buf.length)
    console.log('--- Preview ---')
    console.log(buf.substring(0, 1500))
  })
})
req.on('error', (e) => console.error('❌ ERROR:', e.message, e.stack))
req.setTimeout(60000, () => { console.error('⏱️ Timeout'); req.destroy() })
req.write(body)
req.end()
