// 三平台协议模拟（端口 3996）：按官方文档校验请求体
//   /th/*  TokenHot（new-api）：/v1/models · /v1/dashboard/billing/* · /v1/chat/completions · /v1/images/generations · /v1/video/generations(+/{id}) · /v1/videos/{id}/content
//   /ds/*  DeepSeek 官方：/models · /user/balance · /chat/completions（thinking / temperature 规则）
//   /ark/* 火山方舟：/api/v3/chat/completions · /api/v3/images/generations · /api/v3/contents/generations/tasks(+/{id})
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
const LOG = process.env.LOG || '/tmp/pfmock.jsonl', KEYS = { th: 'sk-th-test-0001', ds: 'sk-ds-test-0001', ark: 'ark-test-0001' }
const mp4 = readFileSync(new URL('./fixtures/clip.mp4', import.meta.url)), png = readFileSync(new URL('./fixtures/frame.png', import.meta.url))
writeFileSync(LOG, '')
const tasks = new Map()
const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' && !Buffer.isBuffer(obj) ? JSON.stringify(obj) : obj) }
const BASE = `http://127.0.0.1:3996`
http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c
  const j = raw ? JSON.parse(raw) : null, u = new URL(req.url, 'http://x'), [, pf, ...rest] = u.pathname.split('/'), p = '/' + rest.join('/')
  const auth = req.headers.authorization === 'Bearer ' + KEYS[pf]
  writeFileSync(LOG, JSON.stringify({ pf, m: req.method, p, auth, body: j }) + '\n', { flag: 'a' })
  if (pf === 'th' && p === '/api/pricing') return send(res, 200, readFileSync(new URL('./fixtures/tokenhot_pricing.json', import.meta.url)), 'application/json')
  if (pf === 'th' && p === '/api/status') return send(res, 200, { success: true, data: { price: 7, quota_per_unit: 500000 } })
  if (p.endsWith('/content') || p.startsWith('/files/')) { if (pf === 'th' && !auth) return send(res, 401, { error: { message: 'no auth' } }); return send(res, 200, p.endsWith('.png') ? png : mp4, p.endsWith('.png') ? 'image/png' : 'video/mp4') }
  if (!auth) return pf === 'ark' ? send(res, 401, { error: { code: 'AuthenticationError', message: 'The API key in the request is missing or invalid.' } }) : send(res, 401, { error: { message: 'Invalid token', type: pf === 'th' ? 'new_api_error' : 'authentication_error' } })
  const chatOK = (model) => send(res, 200, { id: 'c1', model, choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })
  if (pf === 'th') {
    if (p === '/v1/models') return send(res, 200, { object: 'list', data: ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'nano-banana-pro', 'doubao-seedance-2-0', 'kling-v3', 'wan3.0-video'].map((id) => ({ id })) })
    if (p === '/v1/dashboard/billing/subscription') return send(res, 200, { hard_limit_usd: 50 })
    if (p === '/v1/dashboard/billing/usage') return send(res, 200, { total_usage: 1234 })
    if (p === '/v1/chat/completions') { if (!j.model || !Array.isArray(j.messages)) return send(res, 400, { error: { message: 'bad chat' } }); return chatOK(j.model) }
    if (p.startsWith('/v1beta/models/') && p.endsWith(':generateContent')) { if (!j.contents?.[0]?.parts?.[0]?.text || !j.generationConfig?.imageConfig?.aspectRatio) return send(res, 400, { error: { message: 'bad gemini image' } }); return send(res, 200, { candidates: [{ content: { role: 'model', parts: [{ text: `![img](${BASE}/th/files/a.png)` }] }, finishReason: 'STOP' }] }) }
    if (p === '/v1/video/generations' && req.method === 'POST') {
      if (/seedance/.test(j.model)) { if (!Array.isArray(j.content) || j.content[0]?.type !== 'text' || j.metadata) return send(res, 400, { code: 'bad_request', message: 'content[] required, no metadata', data: null }); for (const c of j.content.slice(1)) if (!['first_frame', 'last_frame', 'reference_image'].includes(c.role)) return send(res, 400, { code: 'bad_role', message: c.role, data: null }) }
      const id = 'task_' + Math.random().toString(36).slice(2, 10); tasks.set(id, 0); return send(res, 200, { id, task_id: id, object: 'video', model: j.model, status: 'queued', progress: 0 })
    }
    const m = p.match(/^\/v1\/video\/generations\/(task_\w+)$/)
    if (m) { if (!tasks.has(m[1])) return send(res, 404, { code: 'not_found', message: 'task not exist', data: null }); const n = tasks.get(m[1]) + 1; tasks.set(m[1], n); return send(res, 200, { code: 'success', message: '', data: { task_id: m[1], status: n >= 2 ? 'SUCCESS' : 'IN_PROGRESS', progress: n >= 2 ? '100%' : '30%', quota: 350000, fail_reason: '', result_url: n >= 2 ? `${BASE}/th/v1/videos/${m[1]}/content` : '', data: { status: n >= 2 ? 'succeeded' : 'running', usage: { total_tokens: 109586 } } } }) }
  }
  if (pf === 'ds') {
    if (p === '/models') return send(res, 200, { object: 'list', data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }] })
    if (p === '/user/balance') return send(res, 200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50', granted_balance: '0.00', topped_up_balance: '88.50' }] })
    if (p === '/chat/completions') {
      if (!['deepseek-v4-pro', 'deepseek-flash'].includes(j.model)) return send(res, 400, { error: { message: 'Model Not Exist' } })
      if (j.thinking && !['enabled', 'disabled'].includes(j.thinking.type)) return send(res, 400, { error: { message: 'bad thinking' } })
      if (j.thinking?.type !== 'disabled' && j.temperature !== undefined) return send(res, 422, { error: { message: 'test-mock: temperature 在思考模式下不应发送' } })
      return chatOK(j.model)
    }
  }
  if (pf === 'ark') {
    if (p === '/api/v3/chat/completions') { if (!/^(doubao|deepseek|glm)-/.test(j.model)) return send(res, 404, { error: { code: 'InvalidEndpointOrModel.NotFound', message: 'model not found' } }); return chatOK(j.model) }
    if (p === '/api/v3/images/generations') { if (!/seedream/.test(j.model) || !j.size || j.watermark !== false) return send(res, 400, { error: { message: 'bad image' } }); return send(res, 200, { model: j.model, created: 1, data: [{ url: `${BASE}/ark/files/i.png`, size: j.size }], usage: { generated_images: 1 } }) }
    if (p === '/api/v3/contents/generations/tasks' && req.method === 'POST') {
      if (!Array.isArray(j.content) || j.content[0]?.type !== 'text' || j.prompt || j.metadata) return send(res, 400, { error: { code: 'InvalidParameter', message: 'content[] required' } })
      const ff = j.content.filter((c) => c.role === 'first_frame').length, rf = j.content.filter((c) => c.role === 'reference_image').length
      if (ff && rf) return send(res, 400, { error: { code: 'InvalidParameter', message: '首帧与参考图互斥' } })
      if (/2-5/.test(j.model) && ff && j.ratio !== 'adaptive') return send(res, 400, { error: { code: 'InvalidParameter', message: '2.5 首帧任务 ratio 只能 adaptive' } })
      const id = 'cgt-' + Math.random().toString(36).slice(2, 10); tasks.set(id, 0); return send(res, 200, { id })
    }
    const m = p.match(/^\/api\/v3\/contents\/generations\/tasks\/(cgt-\w+)$/)
    if (m) { const n = tasks.get(m[1]) + 1; tasks.set(m[1], n); return send(res, 200, { id: m[1], model: 'doubao-seedance-2-0-260128', status: n >= 2 ? 'succeeded' : 'running', content: n >= 2 ? { video_url: `${BASE}/ark/files/v.mp4`, last_frame_url: `${BASE}/ark/files/last.png` } : undefined, usage: { completion_tokens: 173000, total_tokens: 173000 }, duration: 8, ratio: '9:16', resolution: '720p' }) }
  }
  send(res, 404, { error: { message: 'no route ' + u.pathname } })
}).listen(3996, () => console.log('platforms mock :3996'))
