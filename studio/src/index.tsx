// MoMo Studio —— 短剧生产后台（独立应用 / 独立登录）；与玩家端共享 D1 + R2，但路由、会话、静态资源完全分离
import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { HttpError, type Env, type User, audit, bootstrap, createUser, currentUser, ipOf, login, logout, requireApprover, requireRole, userCount } from './lib/auth'
import * as Agents from './lib/agents'
import * as Gw from './lib/gateway'
import * as Steps from './lib/steps'
import { uid } from './lib/sec'
import { shell } from './page'
import * as G from './lib/graph'
import * as Structure from './lib/structure'
import * as Docs from './lib/docs'
import * as Media from './lib/media'

type V = { Bindings: Env; Variables: { user: User } }
const app = new Hono<V>()
const now = () => Date.now()
const body = async (c: any) => { try { return await c.req.json() } catch { return {} } }

app.onError((err: any, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, ...(err.extra || {}) }, err.status as any)
  console.error(err); return c.json({ error: 'INTERNAL', message: '服务器错误' }, 500)
})
// 安全响应头：后台禁止被嵌入、禁止缓存
app.use('*', async (c, next) => {
  await next()
  c.header('X-Frame-Options', 'DENY'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin')
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
})
app.use('/sstatic/*', serveStatic({ root: './' }))

// ─── 认证 ───
app.get('/api/auth/state', async (c) => c.json({ initialized: (await userCount(c.env)) > 0, user: await currentUser(c.env, c), bootstrap_token_required: !!c.env.STUDIO_BOOTSTRAP_TOKEN, master_key_ok: !!(c.env.STUDIO_MASTER_KEY && c.env.STUDIO_MASTER_KEY.length >= 16) }))
app.post('/api/auth/bootstrap', async (c) => c.json(await bootstrap(c.env, c, await body(c))))
app.post('/api/auth/login', async (c) => c.json(await login(c.env, c, await body(c))))
app.post('/api/auth/logout', async (c) => c.json(await logout(c.env, c)))

// ─── 账号（admin）───
app.get('/api/users', requireRole('admin'), async (c) => c.json((await c.env.DB.prepare('SELECT id,email,name,role,disabled,created_at,last_login FROM st_users ORDER BY created_at').all()).results))
app.post('/api/users', requireRole('admin'), async (c) => { const b = await body(c); const u = await createUser(c.env, b); await audit(c.env, c.get('user').id, 'user_create', u.email, { role: u.role }, ipOf(c)); return c.json(u) })
app.post('/api/users/:id', requireRole('admin'), async (c) => {
  const b = await body(c), id = c.req.param('id')
  if (id === c.get('user').id && (b.disabled || (b.role && b.role !== 'admin'))) throw new HttpError(409, 'SELF_LOCKOUT', '不能停用或降级自己')
  await c.env.DB.prepare('UPDATE st_users SET role=COALESCE(?,role), disabled=COALESCE(?,disabled), name=COALESCE(?,name) WHERE id=?').bind(b.role || null, b.disabled === undefined ? null : b.disabled ? 1 : 0, b.name || null, id).run()
  if (b.disabled) await c.env.DB.prepare('DELETE FROM st_sessions WHERE user_id=?').bind(id).run()
  await audit(c.env, c.get('user').id, 'user_update', id, b, ipOf(c)); return c.json({ ok: true })
})

// ─── Agent 配置中心（查看：writer+；修改：admin）───
app.get('/api/config', requireRole('writer'), async (c) => c.json(await Agents.listConfig(c.env)))
app.post('/api/providers', requireRole('admin'), async (c) => c.json(await Agents.upsertProvider(c.env, c.get('user'), await body(c))))
app.post('/api/providers/:id/delete', requireRole('admin'), async (c) => c.json(await Agents.deleteProvider(c.env, c.get('user'), c.req.param('id'))))
app.post('/api/providers/:id/test', requireRole('admin'), async (c) => c.json(await Gw.testProvider(c.env, c.req.param('id'))))
app.post('/api/agents/:code', requireRole('admin'), async (c) => c.json(await Agents.updateAgent(c.env, c.get('user'), c.req.param('code'), await body(c))))
app.get('/api/agents/:code/prompts', requireRole('writer'), async (c) => c.json(await Agents.promptHistory(c.env, c.req.param('code'))))
app.post('/api/agents/:code/try', requireRole('admin'), async (c) => { const b = await body(c); return c.json(await Gw.chat(c.env, c.req.param('code'), { prompt: String(b.prompt || '用一句话介绍你的职责'), user: c.get('user').id, timeoutMs: 45000 })) })

// ─── 项目 + 十步卡关 ───
app.get('/api/projects', requireRole('reviewer'), async (c) => {
  const ps = (await c.env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM st_steps s WHERE s.project_id=p.id AND s.status='done') done, (SELECT MIN(step) FROM st_steps s WHERE s.project_id=p.id AND s.status!='done') cur FROM st_projects p WHERE p.status!='archived' ORDER BY p.updated_at DESC`).all()).results
  return c.json({ projects: ps, steps: Steps.STEPS })
})
app.post('/api/projects', requireRole('writer'), async (c) => {
  const b = await body(c), u = c.get('user')
  const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'NO_TITLE', '请填写项目名')
  const id = uid('sp_')
  await c.env.DB.prepare('INSERT INTO st_projects (id,title,format,genre,owner,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, title.slice(0, 40), b.format || 'live', b.genre || null, u.id, now(), now()).run()
  await Steps.initSteps(c.env, id, u.id); await audit(c.env, u.id, 'project_create', id, { title }, ipOf(c))
  return c.json({ id })
})
app.get('/api/projects/:id', requireRole('reviewer'), async (c) => {
  const p = await c.env.DB.prepare('SELECT * FROM st_projects WHERE id=?').bind(c.req.param('id')).first()
  if (!p) throw new HttpError(404, 'NO_PROJECT', '项目不存在')
  const runs = (await c.env.DB.prepare('SELECT id,step,agent,model,status,latency_ms,cost,error,created_at FROM st_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 30').bind(c.req.param('id')).all()).results
  return c.json({ project: p, steps: await Steps.listSteps(c.env, c.req.param('id')), runs })
})
app.post('/api/projects/:id/archive', requireRole('admin'), async (c) => { await c.env.DB.prepare(`UPDATE st_projects SET status='archived', updated_at=? WHERE id=?`).bind(now(), c.req.param('id')).run(); await audit(c.env, c.get('user').id, 'project_archive', c.req.param('id')); return c.json({ ok: true }) })
// 步骤：保存（writer+）/ 通过（仅 reviewer 或 admin，编剧不能自审）/ 退回（writer+）
app.post('/api/projects/:id/steps/:n', requireRole('writer'), async (c) => {
  const b = await body(c), n = +c.req.param('n')
  let output = b.output
  if (n === 3 && output !== undefined) { // 结构图：服务端清洗；提交审核时必须零错误
    output = G.normalize(output)
    const a = G.analyze(output)
    if (b.submit && !a.ok) throw new HttpError(422, 'GRAPH_INVALID', `结构图还有 ${a.issues.filter((i) => i.level === 'error').length} 个错误，修复后才能提交审核`, { issues: a.issues })
    output.meta = { ...(output.meta || {}), stats: a.stats, checked_at: now() }
  }
  if (n === 4 || n === 5) { // 节点级文档：产出 = 服务端闸门摘要，只能通过 submit 生成
    if (!b.submit) throw new HttpError(400, 'USE_NODE_API', '第 4/5 步请逐节点编辑，完成后「提交审核」')
    output = await Docs.gate(c.env, c.req.param('id'), n)
  }
  if (n >= 6 && n <= 9) { // 素材步骤：产出 = 服务端闸门摘要
    if (!b.submit) throw new HttpError(400, 'USE_MEDIA_API', '第 6–9 步请在素材工作台操作，完成后「提交审核」')
    output = await Media.gate(c.env, c.req.param('id'), n as any)
  }
  return c.json(await Steps.saveStep(c.env, c.get('user'), c.req.param('id'), n, { input: b.input, output, note: b.note, status: b.submit ? 'review' : undefined }))
})
app.post('/api/projects/:id/steps/:n/approve', requireApprover, async (c) => {
  const b = await body(c), n = +c.req.param('n')
  if (n === 4 || n === 5) await Docs.gate(c.env, c.req.param('id'), n) // 审批时重新验证：提交后文档又被改动也拦得住
  if (n >= 6 && n <= 9) await Media.gate(c.env, c.req.param('id'), n as any)
  if (n === 3) { const r: any = await c.env.DB.prepare('SELECT output FROM st_steps WHERE project_id=? AND step=3').bind(c.req.param('id')).first(); const a = G.analyze(G.normalize(JSON.parse(r?.output || '{}'))); if (!a.ok) throw new HttpError(422, 'GRAPH_INVALID', '结构图存在错误，不能通过', { issues: a.issues }) }
  return c.json(await Steps.approveStep(c.env, c.get('user'), c.req.param('id'), +c.req.param('n'), b.note || '')) })
app.post('/api/projects/:id/steps/:n/reopen', requireRole('writer'), async (c) => { const b = await body(c); return c.json(await Steps.reopenStep(c.env, c.get('user'), c.req.param('id'), +c.req.param('n'), b.note || '')) })
// 步骤 Agent 执行（第 2 步编剧 Agent；第 3 步用 /graph/* 专用接口；其余步骤在 P3–P5 接入）
app.post('/api/projects/:id/steps/:n/run', requireRole('writer'), async (c) => {
  const id = c.req.param('id'), n = +c.req.param('n'), u = c.get('user')
  const row: any = await Steps.assertOpen(c.env, id, n)
  if (n === 2) {
    const brief = await Steps.doneOutput(c.env, id, 1)
    const r = await Gw.chat(c.env, 'SCREENWRITER', { json: true, project_id: id, step: 2, user: u.id, system: '你是互动博弈短剧总编剧。只输出 JSON：{"logline":"≤40字","world":"世界观≤120字","cast":[{"id":"英文单词","name":"中文名","role":"中文人设≤16字","look":"ENGLISH ONLY，必须以性别和年龄开头，如 woman, late 20s, ...；再写发型、脸型、服装"}],"mainline":["主线节拍1","节拍2","..."]}。cast 3~4 人，mainline 5~8 条。角色必须是原创虚构成年人，不得像任何真人。', prompt: `主题：${brief.theme}\n形态：${brief.format}\n题材：${brief.genre || '自动'}\n受众：${brief.audience || '全年龄'}\n规模：${brief.scale || 'pilot'}` })
    const out = r.data || { raw: r.text }
    await Steps.saveStep(c.env, u, id, 2, { output: out, status: 'review', run_id: r.run_id })
    return c.json({ run_id: r.run_id, output: out, latency_ms: r.latency_ms })
  }
  throw new HttpError(501, 'NOT_YET', `第 ${n} 步「${Steps.STEPS[n - 1].name}」的 Agent 将在后续阶段接入（当前可手动填写产出并提交审核）`, { status: row.status })
})

// ─── 第 3 步 · 结构图（AI 只出提案，人工采纳后才写入）───
const graphCtx = async (c: any) => {
  const id = c.req.param('id'); await Steps.assertOpen(c.env, id, 3)
  return { id, brief: await Steps.doneOutput(c.env, id, 1), bible: await Steps.doneOutput(c.env, id, 2) }
}
const priceOf = async (c: any) => { const a: any = await c.env.DB.prepare(`SELECT unit_price FROM st_agents WHERE code='VIDEO_MAIN'`).first(); return +a?.unit_price || 0 }
app.post('/api/projects/:id/graph/analyze', requireRole('reviewer'), async (c) => { const b = await body(c); const g = G.normalize(b.graph); return c.json({ graph: g, ...G.analyze(g, { pricePerSec: await priceOf(c) }) }) })
app.post('/api/projects/:id/graph/layout', requireRole('writer'), async (c) => { const b = await body(c); return c.json({ graph: G.layout(G.normalize(b.graph)) }) })
app.post('/api/projects/:id/graph/draft', requireRole('writer'), async (c) => { const x = await graphCtx(c); const r = await Structure.draft(c.env, c.get('user'), x.id, x.bible, x.brief); await audit(c.env, c.get('user').id, 'graph_draft', x.id, { nodes: r.proposal.nodes.length, ok: r.analysis.ok }, ipOf(c)); return c.json(r) })
app.post('/api/projects/:id/graph/extend', requireRole('writer'), async (c) => {
  const x = await graphCtx(c), b = await body(c)
  const r = await Structure.extend(c.env, c.get('user'), x.id, b.graph, String(b.node || ''), { mode: b.mode, hint: b.hint, count: b.count }, x.bible, x.brief)
  await audit(c.env, c.get('user').id, 'graph_extend', x.id, { node: b.node, mode: b.mode, added: r.added.length }, ipOf(c)); return c.json(r)
})

// ─── 第 4 步 · 剧本描述（节点级；剧情账本推演）───
app.get('/api/projects/:id/scripts', requireRole('reviewer'), async (c) => c.json(await Docs.scriptStatus(c.env, c.req.param('id'))))
app.get('/api/projects/:id/scripts/:node', requireRole('reviewer'), async (c) => c.json(await Docs.scriptDetail(c.env, c.req.param('id'), c.req.param('node'))))
app.post('/api/projects/:id/scripts/:node', requireRole('writer'), async (c) => { const b = await body(c); return c.json(await Docs.saveScript(c.env, c.get('user'), c.req.param('id'), c.req.param('node'), b.doc)) })
app.post('/api/projects/:id/scripts-run', requireRole('writer'), async (c) => {
  const b = await body(c), id = c.req.param('id')
  let only: string[] | undefined = Array.isArray(b.only) ? b.only.map(String).slice(0, 50) : undefined
  if (b.errors) only = (await Docs.scriptStatus(c.env, id)).nodes.filter((n: any) => n.state === 'error').map((n: any) => n.id).slice(0, 50)
  return c.json(await Docs.generateScripts(c.env, c.get('user'), id, { only, force: !!b.force }))
})
// ─── 第 5 步 · 提示词 + 连贯监管 ───
app.get('/api/projects/:id/prompts', requireRole('reviewer'), async (c) => c.json(await Docs.promptStatus(c.env, c.req.param('id'))))
app.get('/api/projects/:id/prompts/:node', requireRole('reviewer'), async (c) => c.json(await Docs.promptDetail(c.env, c.req.param('id'), c.req.param('node'))))
app.post('/api/projects/:id/prompts/:node', requireRole('writer'), async (c) => { const b = await body(c); return c.json(await Docs.savePrompt(c.env, c.get('user'), c.req.param('id'), c.req.param('node'), b.doc)) })
app.post('/api/projects/:id/prompts-run', requireRole('writer'), async (c) => {
  const b = await body(c), id = c.req.param('id')
  let only: string[] | undefined = Array.isArray(b.only) ? b.only.map(String).slice(0, 50) : undefined
  if (b.errors) only = (await Docs.promptStatus(c.env, id)).nodes.filter((n: any) => n.state === 'conflict' || n.state === 'error').map((n: any) => n.id).slice(0, 50)
  return c.json(await Docs.generatePrompts(c.env, c.get('user'), id, { only, force: !!b.force }))
})

// ─── 第 6–9 步 · 素材流水线 ───
const stepN = (c: any) => { const n = +c.req.param('n'); if (![6, 7, 8, 9].includes(n)) throw new HttpError(400, 'BAD_STEP', '素材步骤为 6–9'); return n as 6 | 7 | 8 | 9 }
app.get('/api/projects/:id/media/:n', requireRole('reviewer'), async (c) => c.json(await Media.status(c.env, c.req.param('id'), stepN(c))))
app.post('/api/projects/:id/media/:n/run', requireRole('writer'), async (c) => {
  const n = stepN(c); if (n === 9) throw new HttpError(400, 'BAD_STEP', '第 9 步由生成后自动检测；重拍请在第 7/8 步操作')
  const b = await body(c); return c.json(await Media.run(c.env, c.get('user'), c.req.param('id'), n, Array.isArray(b.only) ? b.only.map(String).slice(0, 100) : undefined, new URL(c.req.url).origin))
})
app.post('/api/projects/:id/media/:n/judge', requireApprover, async (c) => { const b = await body(c); return c.json(await Media.judge(c.env, c.get('user'), c.req.param('id'), +c.req.param('n'), String(b.slot || ''), !!b.accept, String(b.note || '').slice(0, 300))) })
app.post('/api/projects/:id/media/:n/upload', requireRole('writer'), async (c) => {
  const fd = await c.req.formData(), f = fd.get('file') as any, slot = String(fd.get('slot') || '')
  if (!f || typeof f === 'string') throw new HttpError(400, 'NO_FILE', '请选择文件')
  return c.json(await Media.upload(c.env, c.get('user'), c.req.param('id'), +c.req.param('n'), slot, f))
})
app.get('/api/media-settings', requireRole('writer'), async (c) => c.json(await Media.settings(c.env)))
app.post('/api/media-settings', requireRole('admin'), async (c) => c.json(await Media.saveSettings(c.env, c.get('user'), await body(c))))
// 执行节点管理（admin）
app.get('/api/nodes', requireRole('admin'), async (c) => c.json(await Media.listNodes(c.env)))
app.post('/api/nodes', requireRole('admin'), async (c) => { const b = await body(c); return c.json(await Media.createNode(c.env, c.get('user'), b.name, Array.isArray(b.kinds) ? b.kinds : [])) })
app.post('/api/nodes/:nid', requireRole('admin'), async (c) => { const b = await body(c); await c.env.DB.prepare('UPDATE st_exec_nodes SET enabled=? WHERE id=?').bind(b.enabled ? 1 : 0, c.req.param('nid')).run(); await audit(c.env, c.get('user').id, 'node_toggle', c.req.param('nid'), b); return c.json({ ok: true }) })

// 素材读取：登录后可看（支持 Range，手机端视频拖动）；/pub 为给服务商拉参考图的 1 小时签名链接
async function serveR2(c: any, key: string) {
  if (!key.startsWith('studio/') || key.includes('..')) throw new HttpError(404, 'NOT_FOUND', '不存在')
  const range = c.req.header('range'), m = range?.match(/bytes=(\d*)-(\d*)/)
  const head = await c.env.MEDIA?.head(key); if (!head) return c.text('not found', 404)
  const size = head.size, ct = head.httpMetadata?.contentType || 'application/octet-stream'
  if (m && (m[1] || m[2])) {
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    const o = await c.env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } })
    return new Response(o.body, { status: 206, headers: { 'Content-Type': ct, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' } })
  }
  const o = await c.env.MEDIA.get(key)
  return new Response(o.body, { headers: { 'Content-Type': ct, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' } })
}
app.get('/m/*', requireRole('reviewer'), async (c) => serveR2(c, decodeURIComponent(c.req.path.slice(3))))
app.get('/pub/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice(5)), exp = +(c.req.query('exp') || 0), sig = c.req.query('sig') || ''
  if (!exp || exp < Date.now() || sig !== (await Media.sign(c.env, key + '|' + exp))) return c.text('forbidden', 403)
  return serveR2(c, key)
})

// ─── 执行节点 API（Bearer 节点令牌；不走 Cookie）───
const nodeOf = async (c: any) => Media.nodeAuth(c.env, (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '') || undefined)
app.post('/node/claim', async (c) => c.json(await Media.nodeClaim(c.env, await nodeOf(c), await body(c))))
app.post('/node/jobs/:jid/report', async (c) => c.json(await Media.nodeReport(c.env, await nodeOf(c), c.req.param('jid'), await body(c))))
app.put('/node/jobs/:jid/files/:name', async (c) => {
  const n = await nodeOf(c), key = await Media.nodeUploadKey(c.env, n, c.req.param('jid'), c.req.param('name'))
  const len = +(c.req.header('content-length') || 0); if (len > 120 * 1024 * 1024) throw new HttpError(413, 'TOO_LARGE', '文件过大')
  await c.env.MEDIA!.put(key, await c.req.arrayBuffer(), { httpMetadata: { contentType: c.req.header('content-type') || 'application/octet-stream' } })
  return c.json({ key })
})
app.get('/node/media/*', async (c) => { await nodeOf(c); return serveR2(c, decodeURIComponent(c.req.path.slice(12))) })

// ─── 审计 ───
app.get('/api/audit', requireRole('admin'), async (c) => c.json((await c.env.DB.prepare('SELECT a.*, u.email FROM st_audit a LEFT JOIN st_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100').all()).results))
app.get('/api/runs', requireRole('writer'), async (c) => c.json((await c.env.DB.prepare('SELECT id,project_id,step,agent,provider_id,model,status,latency_ms,tokens_in,tokens_out,cost,error,created_at FROM st_runs ORDER BY created_at DESC LIMIT 60').all()).results))

app.get('/api/health', (c) => c.json({ ok: true, app: 'momo-studio', time: now() }))
app.get('*', (c) => c.html(shell()))
export default app
