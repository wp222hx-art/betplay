// 算力网 API 模拟（严格按 suanli.com/api-docs 协议）：校验 Bearer、请求体结构；视频任务 2 次轮询后成功，成片从 /content 带鉴权下载
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
const KEY = 'sk-suanli-test-0001', LOG = process.env.LOG || '/tmp/slmock/log.jsonl', tasks = new Map()
const mp4 = readFileSync(process.env.MP4 || new URL('./fixtures/clip.mp4', import.meta.url)), png = readFileSync(process.env.PNG || new URL('./fixtures/frame.png', import.meta.url))
writeFileSync(LOG, '')
const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj) }
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const j = body ? JSON.parse(body) : null, u = new URL(req.url, 'http://x')
  require_log: { const l = { m: req.method, p: u.pathname, auth: req.headers.authorization === 'Bearer ' + KEY, body: j }; writeFileSync(LOG, JSON.stringify(l) + '\n', { flag: 'a' }) }
  if (req.headers.authorization !== 'Bearer ' + KEY) return send(res, 401, { error: { code: 'KEY_INVALID', message: 'Invalid token', type: 'authentication_error' }, success: false })
  if (u.pathname === '/v1/models') return send(res, 200, { object: 'list', data: ['deepseek-v4-pro', 'deepseek-v4-flash-0731', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'wan2.7-image-pro', 'doubao-seedance-2-0-cmcc1', 'doubao-seedance-2-5-volc1'].map((id) => ({ id, object: 'model' })) })
  if (u.pathname === '/v1/chat/completions') return send(res, 200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  if (u.pathname === '/v1/images/generations') { if (!j.model || !j.prompt) return send(res, 400, { error: { message: 'bad' } }); return send(res, 200, { created: 1, data: [{ b64_json: png.toString('base64') }] }) }
  if (u.pathname === '/v1/video/generations' && req.method === 'POST') {
    if (!j.model || !j.prompt || !j.metadata || typeof j.metadata.generate_audio !== 'boolean') return send(res, 400, { error: { code: 'BAD_REQUEST', message: 'model/prompt/metadata required' } })
    for (const c of j.metadata.content || []) if (!['first_frame', 'reference_image'].includes(c.role) || !c.image_url?.url) return send(res, 400, { error: { message: 'bad content role' } })
    const id = 'task_' + Math.random().toString(36).slice(2, 10); tasks.set(id, 0); return send(res, 200, { id, object: 'video', model: j.model, status: 'queued' })
  }
  let m = u.pathname.match(/^\/v1\/videos\/([\w-]+)$/)
  if (m) { if (!tasks.has(m[1])) return send(res, 404, { error: { message: 'not found' } }); const n = tasks.get(m[1]) + 1; tasks.set(m[1], n); return send(res, 200, { id: m[1], status: n >= 2 ? 'succeeded' : 'in_progress', usage: { total_tokens: 108900 } }) }
  m = u.pathname.match(/^\/v1\/videos\/([\w-]+)\/content$/)
  if (m) return send(res, 200, mp4, 'video/mp4')
  send(res, 404, { error: { message: 'no route ' + u.pathname } })
}).listen(3997, () => console.log('suanli mock :3997'))
