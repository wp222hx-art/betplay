// P4 · 素材流水线（第 6 设定图 / 第 7 主线视频 / 第 8 分支视频 / 第 9 一致性检测）
//   槽位（st_slots）= 一个交付物；尝试（st_jobs）= 一次生成。依赖指纹变化 → 槽位 stale
//   调度：惰性 tick（无 cron，兼容托管部署）——前端轮询 / 执行节点领取时推进；Worker 只做轻活（提交、查询、搬运）
//   重活（抽帧、衔接评分、烧录字幕检测、ffmpeg 压制）交给执行节点的 post / seam 阶段
//   路由：ark_video / openai_video / openai_image / ark_image → Worker 直连；jimeng_cli / gsk / mock_* → 执行节点
import { HttpError, type Env, type User, audit } from './auth'
import { resolveProvider } from './agents'
import * as Gw from './gateway'
import * as G from './graph'
import * as L from './ledger'
import * as Steps from './steps'
import { rand, sha256, uid } from './sec'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const DIRECT = new Set(['ark_video', 'openai_video', 'ark_image', 'openai_image'])
const MAX_ATTEMPTS = 3
const STALE_CLAIM_MS = 30 * 60000

// ───────── 设置（并发上限、质检阈值）─────────
export const DEFAULT_SETTINGS = { max_concurrent: 4, seam_min: 0.55, face_min: 6, subs_max: 0.2, auto_retry: true }
export async function settings(env: Env) {
  const r: any = await env.DB.prepare(`SELECT v FROM st_settings WHERE k='media'`).first()
  return { ...DEFAULT_SETTINGS, ...(J(r?.v, {}) || {}) }
}
export async function saveSettings(env: Env, u: User, b: any) {
  const cur = await settings(env), n = { ...cur }
  if (b.max_concurrent !== undefined) n.max_concurrent = Math.max(1, Math.min(32, +b.max_concurrent || 4))
  if (b.seam_min !== undefined) n.seam_min = Math.max(0, Math.min(1, +b.seam_min))
  if (b.face_min !== undefined) n.face_min = Math.max(0, Math.min(10, +b.face_min))
  if (b.subs_max !== undefined) n.subs_max = Math.max(0, Math.min(1, +b.subs_max))
  if (b.auto_retry !== undefined) n.auto_retry = !!b.auto_retry
  await env.DB.prepare(`INSERT INTO st_settings (k,v,updated_at) VALUES ('media',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`).bind(JSON.stringify(n), now()).run()
  await audit(env, u.id, 'media_settings', '', n); return n
}

// ───────── 上游 ─────────
async function upstream(env: Env, pid: string) {
  const brief = await Steps.doneOutput(env, pid, 1), bible = await Steps.doneOutput(env, pid, 2), graph = G.normalize(await Steps.doneOutput(env, pid, 3))
  await Steps.doneOutput(env, pid, 5)
  const prompts = new Map<string, any>(((await env.DB.prepare(`SELECT node_id,data FROM st_node_docs WHERE project_id=? AND kind='prompt'`).bind(pid).all()).results as any[]).map((r) => [r.node_id, J(r.data)]))
  const scripts = new Map<string, any>(((await env.DB.prepare(`SELECT node_id,data FROM st_node_docs WHERE project_id=? AND kind='script'`).bind(pid).all()).results as any[]).map((r) => [r.node_id, J(r.data)]))
  const main = new Set(G.mainline(graph))
  return { brief, bible, graph, prompts, scripts, main }
}

// ───────── 槽位规划 ─────────
type SlotPlan = { step: number; slot: string; kind: 'image' | 'video'; hash: string; deps: string[]; req: any; agent: string }
const castPrompt = (c: any, brief: any) => `Character design sheet of an ORIGINAL fictional adult character for a ${brief?.format === 'anime' ? 'anime-style' : 'photorealistic live-action'} vertical short drama. ${c.look}. Front view, three-quarter view and full-body view on a clean neutral studio background, consistent face, hairstyle and outfit across views, soft even lighting, high detail. The person must NOT resemble any real actor, celebrity or public figure. No text, no labels, no watermark.`
const coverPrompt = (bible: any, brief: any) => `Vertical 3:4 key art poster for an interactive short drama: ${bible?.logline || brief?.theme}. ${(bible?.cast || []).slice(0, 3).map((c: any) => `${c.id}: ${c.look}`).join('; ')}. Cinematic lighting, dramatic composition, ORIGINAL fictional faces that do not resemble any real person. No text, no title, no watermark.`

export async function plan(env: Env, pid: string) {
  const u = await upstream(env, pid), out: SlotPlan[] = []
  for (const c of u.bible?.cast || []) out.push({ step: 6, slot: `cast.${c.id}`, kind: 'image', agent: 'ASSET', deps: [], hash: L.fnv(L.stable({ look: c.look, f: u.brief?.format })), req: { prompt: castPrompt(c, u.brief), ratio: '16:9', purpose: 'cast', cast: c.id } })
  out.push({ step: 6, slot: 'cover', kind: 'image', agent: 'ASSET', deps: [], hash: L.fnv(L.stable({ l: u.bible?.logline, c: (u.bible?.cast || []).map((c: any) => c.look) })), req: { prompt: coverPrompt(u.bible, u.brief), ratio: '3:4', purpose: 'cover' } })
  const modes = L.videoModes(u.graph, [...u.main])
  for (const n of u.graph.nodes) {
    const p = u.prompts.get(n.id); if (!p) continue
    const m = modes.get(n.id)!, step = u.main.has(n.id) ? 7 : 8
    const deps = (p.cast || []).map((c: string) => `6:cast.${c}`)
    if (m.mode === 'frames' && m.from) deps.push(`${u.main.has(m.from) ? 7 : 8}:${m.from}`)
    out.push({ step, slot: n.id, kind: 'video', agent: step === 7 ? 'VIDEO_MAIN' : 'VIDEO_BRANCH', deps, hash: L.fnv(L.stable({ p: p.final, d: p.duration, m: m.mode, f: m.from, neg: p.negative })),
      req: { prompt: p.final, negative: p.negative, duration: p.duration || 8, ratio: '9:16', mode: m.mode, from: m.from || null, cast: p.cast || [], dialogue: p.dialogue || [], title: n.title, type: n.type } })
  }
  return { slots: out, u }
}

/** 同步槽位表：新增 / 指纹变化 → stale（保留旧素材以便对比）/ 删除已不存在的 */
export async function sync(env: Env, pid: string) {
  const { slots } = await plan(env, pid)
  const cur = new Map<string, any>(((await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=?').bind(pid).all()).results as any[]).map((r) => [`${r.step}:${r.slot}`, r]))
  const st: any[] = [], want = new Set<string>()
  // 依赖传播：上游素材换了（设定图重画、上一段重拍）→ 指纹变 → 下游 stale；只认已通过（ok）的上游素材
  for (const s of slots) s.hash = L.fnv(s.hash + '|' + s.deps.map((d) => { const r = cur.get(d); return r?.status === 'ok' ? r.media_key || '' : '' }).join('|'))
  for (const s of slots) {
    const k = `${s.step}:${s.slot}`; want.add(k); const c = cur.get(k)
    if (!c) st.push(env.DB.prepare('INSERT INTO st_slots (project_id,step,slot,kind,status,src_hash,updated_at) VALUES (?,?,?,?,?,?,?)').bind(pid, s.step, s.slot, s.kind, 'pending', s.hash, now()))
    else if (c.src_hash !== s.hash && !['queued', 'running', 'post', 'checking'].includes(c.status)) st.push(env.DB.prepare(`UPDATE st_slots SET status=CASE WHEN media_key IS NULL THEN 'pending' ELSE 'stale' END, src_hash=?, attempts=0, override=NULL, accepted_by=NULL, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(s.hash, now(), pid, s.step, s.slot))
  }
  for (const [k, c] of cur) if (!want.has(k)) st.push(env.DB.prepare('DELETE FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(pid, c.step, c.slot))
  if (st.length) await env.DB.batch(st)
  return slots
}


// ───────── 提交 ─────────
async function providerFor(env: Env, agent: string) {
  const a: any = await env.DB.prepare('SELECT * FROM st_agents WHERE code=?').bind(agent).first()
  if (!a?.enabled) throw new HttpError(409, 'AGENT_DISABLED', `${agent} 已停用`)
  if (!a.provider_id) throw new HttpError(409, 'AGENT_UNCONFIGURED', `${a.name} 尚未配置服务商（Agent 配置 → ${a.name}）`)
  if (a.budget > 0 && a.spent >= a.budget) throw new HttpError(402, 'BUDGET_EXCEEDED', `${a.name} 已达预算上限`)
  const pv = await resolveProvider(env, a.provider_id)
  return { a: { ...a, params: J(a.params, {}) }, pv }
}
/** 给服务商的图片地址：配置了公网地址 → 1 小时有效的签名链接；否则内联 base64（方舟支持 data URL） */
async function imageRef(env: Env, key: string | null) {
  if (!key) return null
  const base = String(env.STUDIO_PUBLIC_BASE || (await settings(env) as any).public_base || '').replace(/\/$/, '')
  if (/^https:\/\//.test(base)) { const exp = now() + 3600000; return `${base}/pub/${key}?exp=${exp}&sig=${await sign(env, key + '|' + exp)}` }
  const o = await env.MEDIA?.get(key); if (!o) return null
  const buf = new Uint8Array(await o.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return `data:${o.httpMetadata?.contentType || 'image/png'};base64,${btoa(bin)}`
}
export async function sign(env: Env, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('momo-pub:' + (env.STUDIO_MASTER_KEY || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 组装一次生成请求：参考图（设定图）或上一段尾帧；附加质检失败后的约束 / 审核改写 */
async function buildReq(s: SlotPlan, rows: Map<string, any>, slot: any, env: Env, direct: boolean) {
  const r = { ...s.req }
  const ov = J(slot.override, null)
  if (ov?.prompt) r.prompt = ov.prompt
  if (ov?.extra) r.prompt = `${r.prompt} ${ov.extra}`
  if (s.kind === 'video') {
    r.reference_keys = (s.req.cast || []).map((c: string) => rows.get(`6:cast.${c}`)?.media_key).filter(Boolean).slice(0, 4)
    if (s.req.mode === 'frames' && s.req.from) r.first_frame_key = rows.get(s.deps[s.deps.length - 1])?.last_key || null
    if (direct) { // 直连服务商才需要可访问的图片地址；执行节点自己从 R2 拉
      if (r.first_frame_key) r.first_frame = await imageRef(env, r.first_frame_key)
      else r.reference_images = (await Promise.all(r.reference_keys.map((k: string) => imageRef(env, k)))).filter(Boolean)
    }
  }
  return r
}

async function submit(env: Env, pid: string, s: SlotPlan, slot: any, rows: Map<string, any>, by: string) {
  const { a, pv } = await providerFor(env, s.agent)
  const route = DIRECT.has(pv.kind) ? 'direct' : 'node'
  const req = await buildReq(s, rows, slot, env, route === 'direct'), id = uid('job_'), attempt = (slot.attempts || 0) + 1
  await env.DB.prepare(`INSERT INTO st_jobs (id,project_id,step,slot,phase,route,agent,provider_id,provider_kind,model,status,req,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, pid, s.step, s.slot, 'gen', route, s.agent, pv.id, pv.kind, a.model, 'queued', JSON.stringify({ ...req, params: a.params }), attempt, now(), now()).run()
  await env.DB.prepare(`UPDATE st_slots SET status='queued', job_id=?, attempts=?, qc=NULL, accepted_by=NULL, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(id, attempt, now(), pid, s.step, s.slot).run()
  if (route === 'direct') await directSubmit(env, id)
  return id
}

// ───────── Worker 直连服务商 ─────────
async function directSubmit(env: Env, jobId: string) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first(); const q = J(j.req, {}), pv = await resolveProvider(env, j.provider_id)
  try {
    let task = '', immediate: any = null
    if (pv.kind === 'ark_video') {
      const content: any[] = [{ type: 'text', text: q.prompt }]
      if (q.first_frame) content.push({ type: 'image_url', image_url: { url: q.first_frame }, role: 'first_frame' })
      else for (const u of q.reference_images || []) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' })
      const body: any = { model: j.model, content, ratio: q.ratio || q.params?.ratio || '9:16', duration: q.duration || 8, resolution: q.params?.resolution || '720p', watermark: false, return_last_frame: true }
      if (q.params?.audio !== false) body.generate_audio = true
      const r = await fetch(pv.base + (pv.extra.submit_path || '/api/v3/contents/generations/tasks'), { method: 'POST', headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d: any = await r.json().catch(() => ({})); if (!r.ok || !d.id) throw new Error(`HTTP ${r.status}: ${d.error?.code || ''} ${d.error?.message || JSON.stringify(d).slice(0, 200)}`)
      task = d.id
    } else if (pv.kind === 'openai_video') {
      const r = await fetch(pv.base + (pv.extra.submit_path || '/v1/videos/generations'), { method: 'POST', headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: j.model, prompt: q.prompt, duration: q.duration, ratio: q.ratio, image: q.first_frame || q.reference_images?.[0], images: q.reference_images, ...(pv.extra.body || {}) }) })
      const d: any = await r.json().catch(() => ({})); task = d.id || d.task_id || d.data?.id || d.data?.task_id
      if (!r.ok || !task) throw new Error(`HTTP ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
    } else if (pv.kind === 'ark_image' || pv.kind === 'openai_image') {
      const size = q.ratio === '3:4' ? (pv.extra.size_portrait || '1536x2048') : (pv.extra.size_landscape || '2048x1152')
      const r = await fetch(pv.base + (pv.extra.submit_path || (pv.kind === 'ark_image' ? '/api/v3/images/generations' : '/v1/images/generations')), { method: 'POST', headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: j.model, prompt: q.prompt, size, n: 1, response_format: 'url', watermark: false, ...(pv.extra.body || {}) }) })
      const d: any = await r.json().catch(() => ({})); const url = d.data?.[0]?.url, b64 = d.data?.[0]?.b64_json
      if (!r.ok || (!url && !b64)) throw new Error(`HTTP ${r.status}: ${d.error?.message || JSON.stringify(d).slice(0, 200)}`)
      immediate = { url, b64 }
    }
    if (immediate) return await ingest(env, jobId, immediate)
    await env.DB.prepare(`UPDATE st_jobs SET status='submitted', task_id=?, updated_at=? WHERE id=?`).bind(task, now(), jobId).run()
    await env.DB.prepare(`UPDATE st_slots SET status='running', updated_at=? WHERE job_id=?`).bind(now(), jobId).run()
  } catch (e: any) { await failJob(env, jobId, String(e?.message || e)) }
}

async function directPoll(env: Env, j: any) {
  const pv = await resolveProvider(env, j.provider_id)
  try {
    let st = '', video = '', last = '', err = ''
    if (pv.kind === 'ark_video') {
      const r = await fetch(pv.base + (pv.extra.query_path || '/api/v3/contents/generations/tasks/') + encodeURIComponent(j.task_id), { headers: { Authorization: 'Bearer ' + pv.key } })
      const d: any = await r.json().catch(() => ({})); if (!r.ok) return
      st = d.status; video = d.content?.video_url || ''; last = d.content?.last_frame_url || ''; err = d.error ? `${d.error.code || ''} ${d.error.message || ''}` : ''
    } else {
      const r = await fetch(pv.base + (pv.extra.query_path || '/v1/videos/generations/') + encodeURIComponent(j.task_id), { headers: { Authorization: 'Bearer ' + pv.key } })
      const d: any = await r.json().catch(() => ({})); if (!r.ok) return
      const s = String(d.status || d.data?.status || '').toLowerCase(); st = /succe|complete|done|finish/.test(s) ? 'succeeded' : /fail|error|cancel/.test(s) ? 'failed' : 'running'
      video = d.video_url || d.data?.video_url || d.data?.output?.video_url || d.output?.[0] || ''; last = d.last_frame_url || ''; err = typeof d.error === 'string' ? d.error : d.error?.message || ''
    }
    if (st === 'succeeded' && video) return ingest(env, j.id, { url: video, last_url: last })
    if (st === 'failed' || st === 'expired' || st === 'cancelled') return failJob(env, j.id, err || st)
    await env.DB.prepare(`UPDATE st_jobs SET status='running', updated_at=? WHERE id=?`).bind(now(), j.id).run()
  } catch (e: any) { /* 网络抖动：下一轮再查 */ }
}

/** 把服务商结果搬进 R2（服务商链接通常 24 小时过期），然后交给执行节点做后处理 */
async function ingest(env: Env, jobId: string, res: { url?: string; b64?: string; last_url?: string }) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first(); if (!env.MEDIA) return failJob(env, jobId, 'R2 未绑定')
  const ext = j.step === 6 ? 'png' : 'mp4', key = `studio/${j.project_id}/${j.step}/${j.slot}/${jobId}.${ext}`
  let body: ArrayBuffer
  if (res.b64) body = Uint8Array.from(atob(res.b64), (c) => c.charCodeAt(0)).buffer
  else { const r = await fetch(res.url!); if (!r.ok) return failJob(env, jobId, `下载结果失败 HTTP ${r.status}`); body = await r.arrayBuffer() }
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: ext === 'png' ? 'image/png' : 'video/mp4' } })
  let lastKey: string | null = null
  if (res.last_url) { try { const r = await fetch(res.last_url); if (r.ok) { lastKey = key.replace(/\.mp4$/, '_last.png'); await env.MEDIA.put(lastKey, await r.arrayBuffer(), { httpMetadata: { contentType: 'image/png' } }) } } catch {} }
  await completeGen(env, jobId, { media_key: key, last_key: lastKey })
}

async function failJob(env: Env, jobId: string, error: string) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first(); if (!j) return
  await env.DB.prepare(`UPDATE st_jobs SET status='failed', error=?, updated_at=? WHERE id=?`).bind(error.slice(0, 500), now(), jobId).run()
  const moderation = /moderation|sensitive|审核|违规|risk/i.test(error), copyright = /copyright|celebrity|portrait|肖像/i.test(error)
  const slot: any = await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(j.project_id, j.step, j.slot).first()
  if (!slot || slot.job_id !== jobId) return
  const note = copyright ? '疑似真人肖像被拒：请重新生成该角色设定图（第 6 步）' : moderation ? '内容审核拒绝：下次尝试会自动弱化敏感描述' : error.slice(0, 160)
  const override = moderation && !copyright ? JSON.stringify({ ...(J(slot.override, {}) || {}), extra: 'Tasteful, non-violent, no blood, no weapons pointed at people, no gambling money close-ups, fully clothed.' }) : slot.override
  await env.DB.prepare(`UPDATE st_slots SET status='failed', note=?, override=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(note, override, now(), j.project_id, j.step, j.slot).run()
}

/** 生成完成 → 视频需要后处理（执行节点：压制、首/尾帧、海报、字幕检测）；图片直接进入质检/完成 */
async function completeGen(env: Env, jobId: string, r: { media_key: string; last_key?: string | null; cost?: number }) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first()
  await env.DB.prepare(`UPDATE st_jobs SET status='succeeded', result=?, cost=cost+?, updated_at=? WHERE id=?`).bind(JSON.stringify(r), r.cost || 0, now(), jobId).run()
  if (r.cost) await env.DB.prepare('UPDATE st_agents SET spent=spent+? WHERE code=?').bind(r.cost, j.agent).run()
  const slot: any = await env.DB.prepare('SELECT job_id FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(j.project_id, j.step, j.slot).first()
  if (slot?.job_id !== jobId) return // 已被新的尝试取代
  if (j.step === 6) {
    await env.DB.prepare(`UPDATE st_slots SET status='ok', media_key=?, thumb_key=?, cost=cost+?, note=NULL, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(r.media_key, r.media_key, r.cost || 0, now(), j.project_id, j.step, j.slot).run()
    return
  }
  const pid = uid('job_')
  await env.DB.prepare(`INSERT INTO st_jobs (id,project_id,step,slot,phase,route,status,req,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(pid, j.project_id, j.step, j.slot, 'post', 'node', 'queued', JSON.stringify({ raw_key: r.media_key, last_key: r.last_key || null, gen_job: jobId, dialogue: J(j.req, {}).dialogue || [] }), j.attempt, now(), now()).run()
  await env.DB.prepare(`UPDATE st_slots SET status='post', job_id=?, cost=cost+?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(pid, r.cost || 0, now(), j.project_id, j.step, j.slot).run()
}

// ───────── 调度 tick（惰性推进）─────────
export async function tick(env: Env, pid: string, o: { step?: 6 | 7 | 8; start?: boolean; only?: string[]; by?: string } = {}) {
  const set = await settings(env)
  // 1) 直连任务：查询进度（每 tick 最多 12 个，避免超时）
  const polling = (await env.DB.prepare(`SELECT * FROM st_jobs WHERE project_id=? AND route='direct' AND status IN ('submitted','running') ORDER BY updated_at LIMIT 12`).bind(pid).all()).results as any[]
  await Promise.all(polling.map((j) => directPoll(env, j)))
  // 2) 回收僵死的节点任务
  await env.DB.prepare(`UPDATE st_jobs SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=? WHERE project_id=? AND route='node' AND status='claimed' AND claimed_at<?`).bind(now(), pid, now() - STALE_CLAIM_MS).run()
  if (!o.start) return
  // 3) 提交就绪槽位
  const plans = await sync(env, pid)
  const rows = new Map<string, any>(((await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=?').bind(pid).all()).results as any[]).map((r) => [`${r.step}:${r.slot}`, r]))
  const active = ((await env.DB.prepare(`SELECT COUNT(*) n FROM st_jobs WHERE project_id=? AND phase='gen' AND status IN ('queued','claimed','submitted','running')`).bind(pid).first()) as any).n
  let room = Math.max(0, set.max_concurrent - active); const started: string[] = [], blocked: string[] = []
  for (const s of plans) {
    if (o.step && s.step !== o.step) continue
    if (o.only && !o.only.includes(s.slot)) continue
    const r = rows.get(`${s.step}:${s.slot}`)
    const want = o.only ? ['pending', 'stale', 'failed', 'qc_fail', 'ok', 'blocked'] : ['pending', 'stale', 'failed', 'qc_fail', 'blocked']
    if (!r || !want.includes(r.status)) continue
    if (!o.only && (r.status === 'failed' || r.status === 'qc_fail') && (!set.auto_retry || r.attempts >= MAX_ATTEMPTS)) continue
    const missing = s.deps.filter((d) => rows.get(d)?.status !== 'ok' || !rows.get(d)?.media_key || (d.startsWith('7:') || d.startsWith('8:') ? !rows.get(d)?.last_key : false))
    if (missing.length) { if (r.status !== 'blocked') await env.DB.prepare(`UPDATE st_slots SET status='blocked', note=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(`等待：${missing.join('、')}`, now(), pid, s.step, s.slot).run(); blocked.push(s.slot); continue }
    if (room <= 0) continue // 并发已满：继续扫描，给剩余槽位标上等待依赖
    await submit(env, pid, s, r, rows, o.by || 'system'); room--; started.push(s.slot)
  }
  return { started, blocked }
}

// ───────── 状态 ─────────
export async function status(env: Env, pid: string, step: 6 | 7 | 8 | 9) {
  await Steps.assertOpen(env, pid, step)
  await tick(env, pid)
  const plans = await sync(env, pid), set = await settings(env)
  const rows = ((await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? ORDER BY step, slot').bind(pid).all()).results as any[])
  const planOf = new Map(plans.map((p) => [`${p.step}:${p.slot}`, p]))
  const jobs = new Map<string, any>(((await env.DB.prepare(`SELECT id,phase,status,error,provider_kind,model,attempt,updated_at,claimed_by FROM st_jobs WHERE project_id=? AND id IN (SELECT job_id FROM st_slots WHERE project_id=?)`).bind(pid, pid).all()).results as any[]).map((j) => [j.id, j]))
  const want = step === 9 ? [7, 8] : [step]
  const slots = rows.filter((r) => want.includes(r.step)).map((r) => {
    const p = planOf.get(`${r.step}:${r.slot}`)
    return { step: r.step, slot: r.slot, kind: r.kind, status: r.status, attempts: r.attempts, note: r.note, qc: J(r.qc), accepted: !!r.accepted_by, cost: r.cost, updated_at: r.updated_at,
      media: r.media_key ? `/m/${r.media_key}` : null, thumb: r.poster_key || r.thumb_key ? `/m/${r.poster_key || r.thumb_key}` : null, first: r.first_key ? `/m/${r.first_key}` : null, last: r.last_key ? `/m/${r.last_key}` : null,
      job: jobs.get(r.job_id) || null, title: p?.req?.title || r.slot, mode: p?.req?.mode || null, from: p?.req?.from || null, deps: p?.deps || [], prompt: p?.req?.prompt || '', type: p?.req?.type || null }
  })
  const n = (s: string) => slots.filter((x) => x.status === s).length
  const done = slots.filter((x) => x.status === 'ok').length
  return { settings: set, slots, summary: { total: slots.length, ok: done, running: n('queued') + n('running') + n('post') + n('checking'), blocked: n('blocked'), failed: n('failed'), qc_fail: n('qc_fail'), pending: n('pending') + n('stale'), complete: slots.length > 0 && done === slots.length, cost: +slots.reduce((a, x) => a + (x.cost || 0), 0).toFixed(2) } }
}

export async function run(env: Env, u: User, pid: string, step: 6 | 7 | 8, only?: string[], origin?: string) {
  if (origin && /^https:\/\//.test(origin)) { const cur = await settings(env) as any; if (cur.public_base !== origin) await env.DB.prepare(`INSERT INTO st_settings (k,v,updated_at) VALUES ('media',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`).bind(JSON.stringify({ ...cur, public_base: origin }), now()).run() }
  await Steps.assertOpen(env, pid, step)
  const r: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (r?.status === 'done') throw new HttpError(409, 'STEP_DONE', `第 ${step} 步已审核通过，如需重拍请先「退回修改」`)
  if (r?.status === 'review') await Steps.saveStep(env, u, pid, step, { status: 'ready' })
  const res = await tick(env, pid, { step, start: true, only, by: u.id })
  await audit(env, u.id, 'media_run', `${pid}#${step}`, { started: res?.started.length, only })
  return res
}

/** 人工放行 / 驳回（质检不合格但导演认可；或合格但导演不满意） */
export async function judge(env: Env, u: User, pid: string, step: number, slot: string, accept: boolean, note = '') {
  const r: any = await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(pid, step, slot).first()
  if (!r) throw new HttpError(404, 'NO_SLOT', '素材不存在')
  const s: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (s?.status === 'done') throw new HttpError(409, 'STEP_DONE', '该步骤已审核通过，请先退回')
  if (accept) { if (!r.media_key) throw new HttpError(409, 'NO_MEDIA', '还没有素材'); await env.DB.prepare(`UPDATE st_slots SET status='ok', accepted_by=?, note=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(u.id, note || '人工放行', now(), pid, step, slot).run() }
  else await env.DB.prepare(`UPDATE st_slots SET status='qc_fail', accepted_by=NULL, note=?, override=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(note || '人工驳回', note ? JSON.stringify({ ...(J(r.override, {}) || {}), extra: String(note).slice(0, 300) }) : r.override, now(), pid, step, slot).run()
  if (s?.status === 'review') await Steps.saveStep(env, u, pid, step, { status: 'ready' })
  await audit(env, u.id, accept ? 'media_accept' : 'media_reject', `${pid}#${step}:${slot}`, { note })
  return { ok: true }
}

/** 人工上传素材（设定图 / 视频），跳过生成 */
export async function upload(env: Env, u: User, pid: string, step: number, slot: string, file: File) {
  await Steps.assertOpen(env, pid, step)
  const stp: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (stp?.status === 'done') throw new HttpError(409, 'STEP_DONE', '该步骤已审核通过，请先退回')
  const r: any = await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(pid, step, slot).first()
  if (!r) throw new HttpError(404, 'NO_SLOT', '素材槽位不存在')
  const isImg = r.kind === 'image'
  if (isImg ? !/^image\/(png|jpe?g|webp)$/.test(file.type) : file.type !== 'video/mp4') throw new HttpError(400, 'BAD_TYPE', isImg ? '请上传 PNG / JPG / WebP' : '请上传 MP4')
  if (file.size > (isImg ? 12 : 80) * 1024 * 1024) throw new HttpError(400, 'TOO_LARGE', '文件过大')
  const id = uid('job_'), key = `studio/${pid}/${step}/${slot}/${id}.${isImg ? 'png' : 'mp4'}`
  await env.MEDIA!.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
  await env.DB.prepare(`INSERT INTO st_jobs (id,project_id,step,slot,phase,route,agent,status,req,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, pid, step, slot, 'gen', 'direct', 'UPLOAD', 'queued', JSON.stringify({ upload: true, by: u.id }), (r.attempts || 0) + 1, now(), now()).run()
  await env.DB.prepare(`UPDATE st_slots SET job_id=?, attempts=attempts+1, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(id, now(), pid, step, slot).run()
  await completeGen(env, id, { media_key: key })
  if (stp?.status === 'review') await Steps.saveStep(env, u, pid, step, { status: 'ready' })
  await audit(env, u.id, 'media_upload', `${pid}#${step}:${slot}`, { size: file.size })
  return { ok: true }
}

// ───────── 闸门 ─────────
export async function gate(env: Env, pid: string, step: 6 | 7 | 8 | 9) {
  const st = await status(env, pid, step)
  if (step === 9) {
    const bad = st.slots.filter((x) => x.status !== 'ok')
    if (bad.length) throw new HttpError(422, 'MEDIA_INCOMPLETE', `还有 ${bad.length} 段视频未通过一致性检测`, { bad: bad.slice(0, 20).map((b) => ({ slot: b.slot, title: b.title, status: b.status, note: b.note })) })
    const scores = st.slots.map((x) => x.qc?.seam).filter((v: any) => typeof v === 'number')
    return { clips: st.slots.length, accepted_manually: st.slots.filter((x) => x.accepted).length, seam_avg: scores.length ? +(scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(3) : null, cost: st.summary.cost, checked_at: now() }
  }
  if (!st.summary.complete) throw new HttpError(422, 'MEDIA_INCOMPLETE', `素材未完成：${st.summary.ok}/${st.summary.total}（生成中 ${st.summary.running}、等待依赖 ${st.summary.blocked}、失败 ${st.summary.failed + st.summary.qc_fail}、未开始 ${st.summary.pending}）`, { summary: st.summary })
  const keys = st.slots.map((x) => x.media).join('|')
  return { items: st.summary.total, cost: st.summary.cost, media_hash: L.fnv(keys), checked_at: now() }
}

// ───────── 执行节点 ─────────
export async function createNode(env: Env, u: User, name: string, kinds: string[]) {
  const token = 'msn_' + rand(24), id = uid('node_')
  await env.DB.prepare('INSERT INTO st_exec_nodes (id,name,token_hash,kinds,enabled,created_at,created_by) VALUES (?,?,?,?,1,?,?)').bind(id, String(name || '执行节点').slice(0, 40), await sha256(token), JSON.stringify(kinds || []), now(), u.id).run()
  await audit(env, u.id, 'node_create', id, { name, kinds })
  return { id, token } // 令牌只返回这一次
}
export async function listNodes(env: Env) {
  const rs = (await env.DB.prepare('SELECT id,name,kinds,info,enabled,last_seen,created_at FROM st_exec_nodes ORDER BY created_at').all()).results as any[]
  const q = (await env.DB.prepare(`SELECT route, phase, status, COUNT(*) n FROM st_jobs WHERE status IN ('queued','claimed') GROUP BY route, phase, status`).all()).results
  return { nodes: rs.map((r) => ({ ...r, kinds: J(r.kinds, []), info: J(r.info, {}), online: !!r.last_seen && now() - r.last_seen < 90000 })), queue: q }
}
export async function nodeAuth(env: Env, token: string | undefined) {
  if (!token) throw new HttpError(401, 'NO_NODE_TOKEN', '缺少执行节点令牌')
  const n: any = await env.DB.prepare('SELECT * FROM st_exec_nodes WHERE token_hash=?').bind(await sha256(token)).first()
  if (!n || !n.enabled) throw new HttpError(401, 'BAD_NODE_TOKEN', '执行节点令牌无效或已停用')
  return n
}
/** 节点领取：心跳 + 原子领取一个它能做的任务。gen 任务附带解密后的参考图直链（节点从 /node/media 拉） */
export async function nodeClaim(env: Env, node: any, b: any) {
  const kinds: string[] = Array.isArray(b.kinds) ? b.kinds.map(String) : J(node.kinds, [])
  await env.DB.prepare('UPDATE st_exec_nodes SET last_seen=?, kinds=?, info=? WHERE id=?').bind(now(), JSON.stringify(kinds), JSON.stringify({ ...(b.info || {}), v: b.version || '' }), node.id).run()
  await env.DB.prepare(`INSERT INTO worker_heartbeat (worker,balance,running,seen_at) VALUES (?,?,?,?) ON CONFLICT(worker) DO UPDATE SET balance=excluded.balance, running=excluded.running, seen_at=excluded.seen_at`).bind('studio:' + node.id, b.info?.balance ?? null, b.info?.running ?? null, now()).run().catch(() => {})
  // 顺带推进所有活跃项目的直连任务（没有 cron 时由节点心跳驱动）
  const act = (await env.DB.prepare(`SELECT DISTINCT project_id FROM st_jobs WHERE route='direct' AND status IN ('submitted','running') LIMIT 5`).all()).results as any[]
  for (const p of act) await tick(env, p.project_id).catch(() => {})
  const canPost = kinds.includes('post'), genKinds = kinds.filter((k) => k !== 'post')
  const conds: string[] = [], binds: any[] = []
  if (canPost) conds.push(`(phase IN ('post','seam'))`)
  if (genKinds.length) { conds.push(`(phase='gen' AND provider_kind IN (${genKinds.map(() => '?').join(',')}))`); binds.push(...genKinds) }
  if (!conds.length) return { job: null }
  for (let i = 0; i < 3; i++) {
    const j: any = await env.DB.prepare(`SELECT * FROM st_jobs WHERE route='node' AND status='queued' AND (${conds.join(' OR ')}) ORDER BY CASE phase WHEN 'seam' THEN 0 WHEN 'post' THEN 1 ELSE 2 END, created_at LIMIT 1`).bind(...binds).first()
    if (!j) return { job: null }
    const r = await env.DB.prepare(`UPDATE st_jobs SET status='claimed', claimed_by=?, claimed_at=?, updated_at=? WHERE id=? AND status='queued'`).bind(node.id, now(), now(), j.id).run()
    if (!r.meta.changes) continue
    if (j.phase === 'gen') await env.DB.prepare(`UPDATE st_slots SET status='running', updated_at=? WHERE job_id=?`).bind(now(), j.id).run()
    if (j.phase === 'post' || j.phase === 'seam') await env.DB.prepare(`UPDATE st_slots SET status=?, updated_at=? WHERE job_id=?`).bind(j.phase === 'seam' ? 'checking' : 'post', now(), j.id).run()
    return { job: { id: j.id, phase: j.phase, kind: j.provider_kind, model: j.model, step: j.step, slot: j.slot, project_id: j.project_id, req: J(j.req, {}), attempt: j.attempt } }
  }
  return { job: null }
}
/** 节点回报：gen → 素材已上传（经 /node/upload）；post → 首尾帧/海报/字幕检测；seam → 衔接评分 + 视觉质检 */
export async function nodeReport(env: Env, node: any, jobId: string, b: any) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first()
  if (!j || j.claimed_by !== node.id) throw new HttpError(409, 'NOT_YOURS', '任务不属于该节点')
  if (j.status !== 'claimed') return { ok: true, ignored: true }
  if (!b.ok) { await failJob(env, jobId, String(b.error || '节点执行失败')); return { ok: true } }
  if (j.phase === 'gen') { await completeGen(env, jobId, { media_key: b.media_key, last_key: b.last_key || null, cost: +b.cost || 0 }); return { ok: true } }
  await env.DB.prepare(`UPDATE st_jobs SET status='succeeded', result=?, updated_at=? WHERE id=?`).bind(JSON.stringify(b), now(), jobId).run()
  const slot: any = await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(j.project_id, j.step, j.slot).first()
  if (!slot || slot.job_id !== jobId) return { ok: true, superseded: true }
  if (j.phase === 'post') {
    await env.DB.prepare(`UPDATE st_slots SET media_key=?, first_key=?, last_key=?, poster_key=?, qc=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(b.media_key, b.first_key, b.last_key, b.poster_key, JSON.stringify({ duration: b.duration, subs: b.subs ?? null, audio: b.audio ?? null }), now(), j.project_id, j.step, j.slot).run()
    await queueSeam(env, j.project_id, +j.step, j.slot, j.attempt, { first_key: b.first_key, poster_key: b.poster_key, media_key: b.media_key, subs: b.subs ?? null })
    return { ok: true }
  }
  // seam：确定性指标（节点算）+ 视觉 Agent（Worker 调 CONSISTENCY，小图）→ 综合判定
  const set = await settings(env), prev = J(slot.qc, {}) || {}
  const vision = b.frame_key ? await visionCheck(env, j, b).catch((e: any) => ({ error: String(e?.message || e).slice(0, 160) })) : null
  const qc: any = { ...prev, seam: typeof b.seam === 'number' ? +b.seam.toFixed(3) : null, face: typeof (vision as any)?.face === 'number' ? (vision as any).face : null, vision, subs: b.subs ?? prev.subs ?? null, checked_by: node.id }
  const reasons: string[] = []
  if (qc.seam !== null && qc.seam < set.seam_min) reasons.push(`首尾帧衔接 ${qc.seam} < ${set.seam_min}`)
  if (qc.face !== null && qc.face < set.face_min) reasons.push(`人物一致性 ${qc.face}/10 < ${set.face_min}`)
  if (typeof qc.subs === 'number' && qc.subs > set.subs_max) reasons.push(`检测到烧录字幕 ${(qc.subs * 100).toFixed(0)}% 帧`)
  if ((vision as any)?.burned_text) reasons.push('视觉质检：画面有文字/水印')
  if ((vision as any)?.deformed) reasons.push('视觉质检：人物畸变')
  qc.reasons = reasons
  const extra = reasons.length ? [qc.face !== null && qc.face < set.face_min ? 'Match the reference character sheet exactly: same face shape, hairstyle, hair color and outfit.' : '', reasons.some((r) => r.includes('字幕') || r.includes('文字')) ? 'Absolutely no on-screen text, captions or subtitles.' : '', reasons.some((r) => r.includes('衔接')) ? 'The first frame must be identical to the provided first-frame image; continue smoothly from it.' : ''].filter(Boolean).join(' ') : ''
  await env.DB.prepare(`UPDATE st_slots SET status=?, qc=?, note=?, override=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(reasons.length ? 'qc_fail' : 'ok', JSON.stringify(qc), reasons.length ? reasons.join('；') : null, reasons.length ? JSON.stringify({ ...(J(slot.override, {}) || {}), extra }) : slot.override, now(), j.project_id, j.step, j.slot).run()
  return { ok: true, pass: !reasons.length }
}
/** 排入一致性检测（seam）：上一段尾帧 vs 本段首帧 + 角色设定图 + 关键帧拼图 */
async function queueSeam(env: Env, pid: string, step: number, slotKey: string, attempt: number, b: { first_key: string; poster_key: string; media_key: string; subs: any }) {
  const { slots } = await plan(env, pid), p = slots.find((x) => x.step === step && x.slot === slotKey)
  const rows = new Map<string, any>(((await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=?').bind(pid).all()).results as any[]).map((r) => [`${r.step}:${r.slot}`, r]))
  const prevKey = p?.req?.mode === 'frames' ? rows.get(p.deps[p.deps.length - 1])?.last_key || null : null
  const refs = (p?.req?.cast || []).map((c: string) => ({ id: c, key: rows.get(`6:cast.${c}`)?.media_key })).filter((x: any) => x.key)
  const sid = uid('job_')
  await env.DB.prepare(`INSERT INTO st_jobs (id,project_id,step,slot,phase,route,status,req,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(sid, pid, step, slotKey, 'seam', 'node', 'queued', JSON.stringify({ first_key: b.first_key, poster_key: b.poster_key, clip_key: b.media_key, prev_last_key: prevKey, refs, cast: p?.req?.cast || [], prompt: p?.req?.prompt || '', mode: p?.req?.mode, subs: b.subs }), attempt, now(), now()).run()
  await env.DB.prepare(`UPDATE st_slots SET status='checking', job_id=?, updated_at=? WHERE project_id=? AND step=? AND slot=?`).bind(sid, now(), pid, step, slotKey).run()
  return sid
}
/** 只重跑质检（不重拍、不花生成费）：用于误判申诉 / 调整阈值后复检 */
export async function recheck(env: Env, u: User, pid: string, step: number, slotKey: string) {
  if (step !== 7 && step !== 8) throw new HttpError(400, 'BAD_STEP', '只有视频步骤可以复检')
  const r: any = await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=? AND step=? AND slot=?').bind(pid, step, slotKey).first()
  if (!r) throw new HttpError(404, 'NO_SLOT', '素材不存在')
  const s: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (s?.status === 'done') throw new HttpError(409, 'STEP_DONE', '该步骤已审核通过，请先退回')
  if (!r.media_key || !r.first_key) throw new HttpError(409, 'NO_MEDIA', '还没有可复检的视频')
  if (['queued', 'running', 'post', 'checking'].includes(r.status)) throw new HttpError(409, 'BUSY', '正在处理中')
  const q = J(r.qc, {}) || {}
  const sid = await queueSeam(env, pid, step, slotKey, r.attempts || 1, { first_key: r.first_key, poster_key: r.poster_key, media_key: r.media_key, subs: q.subs ?? null })
  await audit(env, u.id, 'media_recheck', `${pid}#${step}/${slotKey}`, {})
  return { ok: true, job: sid }
}
export async function nodeUploadKey(env: Env, node: any, jobId: string, name: string) {
  const j: any = await env.DB.prepare('SELECT * FROM st_jobs WHERE id=?').bind(jobId).first()
  if (!j || j.claimed_by !== node.id) throw new HttpError(409, 'NOT_YOURS', '任务不属于该节点')
  const safe = String(name).replace(/[^\w.-]/g, '_').slice(0, 60)
  return `studio/${j.project_id}/${j.step}/${j.slot}/${jobId}_${safe}`
}

/** 视觉一致性：本段关键帧 vs 角色设定图（节点已缩成小图），CONSISTENCY Agent 打分 */
async function visionCheck(env: Env, j: any, b: any) {
  const toData = async (k: string) => { const o = await env.MEDIA?.get(k); if (!o) return null; const u = new Uint8Array(await o.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return `data:${o.httpMetadata?.contentType || 'image/jpeg'};base64,${btoa(s)}` }
  const frame = await toData(b.frame_key); if (!frame) return null
  const refs = (await Promise.all((b.ref_keys || []).slice(0, 3).map(async (r: any) => ({ id: r.id, url: await toData(r.key) })))).filter((r: any) => r.url)
  const r = await Gw.chatVision(env, 'CONSISTENCY', {
    system: '你是 AI 短剧质检员。第一张是本段视频的关键帧拼图（从左到右 3 帧：开头 / 中段 / 结尾），后面是角色设定图（按顺序标注 id）。只输出 JSON：{"has_person":bool（3 帧中是否至少有一帧能看清人物的正脸或侧脸——只有手、背影、下颌、远景小人都算 false）,"face":0-10（仅当 has_person=true：取脸最清楚的那一帧，与对应设定图比相似度，同一人=8~10，明显换人≤4）,"deformed":bool（脸/手严重畸变）,"burned_text":bool（画面有字幕/文字/水印/Logo）,"note":"≤30字"}\n注意：特写手部 / 道具的插入镜头是正常分镜，不要因为看不到脸给低分，应 has_person=false。',
    text: `设定图顺序：${refs.map((x: any) => x.id).join(', ') || '无'}。本段提示词：${String(J(j.req, {}).prompt || '').slice(0, 300)}`,
    images: [frame, ...refs.map((x: any) => x.url)], project_id: j.project_id, step: 9
  })
  const d = r.data || {}
  return { has_person: d.has_person !== false, face: d.has_person !== false && typeof d.face === 'number' ? Math.max(0, Math.min(10, d.face)) : null, deformed: !!d.deformed, burned_text: !!d.burned_text, note: String(d.note || '').slice(0, 60), run_id: r.run_id }
}
