// 真实跑一部剧：node studio/tests/run_drama.mjs <stage> [pid]
// 阶段：text（1–5 步）| media <6|7|8> | status <n> | approve <n> | finish（9–10 步）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const LOCAL = 'http://localhost:3001'
const PUB = process.env.PUB || 'https://3001-ixhlm6xucjszv77erpt0l-b9b802c4.sandbox.novita.ai'
const STATE = '/tmp/drama_state.json'
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 2))
let cookie = st.cookie || ''
async function req(method, path, body, base = LOCAL) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = r.headers.get('set-cookie'); if (sc) { cookie = sc.split(';')[0]; st.cookie = cookie; save() }
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  if (r.status >= 400) { console.log(`✗ ${method} ${path} → ${r.status}`, JSON.stringify(j).slice(0, 600)); throw new Error('HTTP ' + r.status) }
  return j
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
async function login() { await req('POST', '/api/auth/login', { email: 'admin@momocash.local', password: 'MomoAdmin-2026!' }) }
const [stage, arg] = process.argv.slice(2)
await login()
const pid = st.pid
const P = (s) => `/api/projects/${pid}${s}`
const submitApprove = async (n, output) => { await req('POST', P(`/steps/${n}`), output ? { output, submit: true } : { submit: true }); const r = await req('POST', P(`/steps/${n}/approve`)); log(`第 ${n} 步通过 → next`, r.next) }

if (stage === 'text') {
  const title = '第十三层的外卖'
  const r = await req('POST', '/api/projects', { title }); st.pid = r.id; save(); log('项目', r.id)
  const Q = (s) => `/api/projects/${st.pid}${s}`
  await req('POST', Q('/steps/1'), { output: {
    theme: '都市悬疑 · 外卖骑手深夜接到一张送往"不存在的第十三层"的订单，每一次选择都在揭开大楼十年前一场火灾的真相',
    format: 'live', genre: '悬疑', scale: 'pilot', audience: '18-35 岁都市短剧用户', tone: '冷色调、紧张、反转，结局有温度',
  }, submit: true })
  await req('POST', Q('/steps/1/approve')); log('第 1 步通过')
  { const t = Date.now(); const o = await req('POST', Q('/steps/2/run')); log(`第 2 步 世界观 ${((Date.now() - t) / 1000).toFixed(0)}s · 角色`, (o.output?.cast || []).map((c) => c.name).join('、'))
  await req('POST', Q('/steps/2/approve')); log('第 2 步通过') }
  await textFrom3(Q)
} else if (stage === 'text3') {
  await textFrom3((s) => `/api/projects/${st.pid}${s}`)
}
async function loop(Q, path) {
  let o, stuck = 0, last = -1
  for (let i = 0; i < 30; i++) {
    o = await req('POST', Q(path), {}); log(path, JSON.stringify(o.summary))
    if (o.summary?.complete) return o
    if (o.summary?.ok === last) { if (++stuck >= 2) { o = await req('POST', Q(path), { errors: true }); log(path, '重试错误节点', JSON.stringify(o.summary)); if (o.summary?.complete) return o; if (stuck >= 4) return o } } else stuck = 0
    last = o.summary?.ok
  }
  return o
}
async function textFrom3(Q) {
  let t = Date.now(), o
  const d = await req('GET', Q('')); const s3 = d.steps[2].status
  if (s3 !== 'done') {
  o = await req('POST', Q('/graph/draft')); log(`第 3 步 结构 ${((Date.now() - t) / 1000).toFixed(0)}s · 分析`, JSON.stringify(o.analysis).slice(0, 300))
  await req('POST', Q('/steps/3'), { output: o.proposal, submit: true }); await req('POST', Q('/steps/3/approve')); log('第 3 步通过')
  }
  t = Date.now(); o = await loop(Q, '/scripts-run'); log(`第 4 步 剧本 ${((Date.now() - t) / 1000).toFixed(0)}s`, JSON.stringify(o.summary))
  try { const rv = await req('POST', Q('/insight/review')); log('评审', JSON.stringify(rv).slice(0, 400)) } catch (e) { log('评审失败（不阻塞）', e.message) }
  await req('POST', Q('/steps/4'), { submit: true }); await req('POST', Q('/steps/4/approve')); log('第 4 步通过')
  t = Date.now(); o = await loop(Q, '/prompts-run'); log(`第 5 步 提示词 ${((Date.now() - t) / 1000).toFixed(0)}s`, JSON.stringify(o.summary))
  await req('POST', Q('/steps/5'), { submit: true }); await req('POST', Q('/steps/5/approve')); log('第 5 步通过')
}
if (stage === 'media') {
  const r = await req('POST', P(`/media/${arg}/run`), {}, PUB); log(`开拍第 ${arg} 步`, JSON.stringify(r).slice(0, 500))
} else if (stage === 'status') {
  const m = await req('GET', P(`/media/${arg}`)); log(JSON.stringify(m.summary)); for (const s of m.slots) console.log(' ', s.slot, s.status, s.attempts, s.cost, (s.note || '').slice(0, 160), s.job?.error ? String(s.job.error).slice(0, 200) : '')
} else if (stage === 'approve') {
  await submitApprove(+arg)
} else if (stage === 'finish') {
  await submitApprove(9)
  const b = await req('GET', P('/release')); log('发布看板', JSON.stringify(b).slice(0, 800))
} else if (stage === 'raw') {
  console.log(JSON.stringify(await req(arg.split(' ')[0], arg.split(' ')[1], process.argv[4] ? JSON.parse(process.argv[4]) : undefined), null, 1).slice(0, 4000))
}
