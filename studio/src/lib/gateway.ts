// 模型接入层：Agent → 服务商适配器（OpenAI 兼容对话 / 火山方舟 Seedance / OpenAI 风格视频中转 / 即梦 CLI 执行节点 / 模拟）
// 统一：预算闸门 → 调用 → st_runs 记账（延迟、token、费用、错误）；Key 只在本模块内存中出现
import { HttpError, type Env } from './auth'
import { resolveProvider } from './agents'
import { uid } from './sec'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

async function agentOf(env: Env, code: string) {
  const a: any = await env.DB.prepare('SELECT * FROM st_agents WHERE code=?').bind(code).first()
  if (!a) throw new HttpError(404, 'NO_AGENT', `Agent ${code} 不存在`)
  if (!a.enabled) throw new HttpError(409, 'AGENT_DISABLED', `${a.name} 已停用`)
  if (!a.provider_id) throw new HttpError(409, 'AGENT_UNCONFIGURED', `${a.name} 尚未配置服务商`)
  if (a.budget > 0 && a.spent >= a.budget) throw new HttpError(402, 'BUDGET_EXCEEDED', `${a.name} 已达预算上限 ${a.budget}`)
  return { ...a, params: J(a.params, {}) }
}

async function record(env: Env, r: any) {
  await env.DB.prepare('INSERT INTO st_runs (id,project_id,step,agent,provider_id,model,status,latency_ms,tokens_in,tokens_out,cost,error,input,output,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(r.id, r.project_id || null, r.step || null, r.agent, r.provider_id, r.model, r.status, r.latency_ms || 0, r.tokens_in || 0, r.tokens_out || 0, r.cost || 0, r.error || null, String(r.input || '').slice(0, 2000), String(r.output || '').slice(0, 4000), now(), r.created_by || null).run()
  if (r.cost) await env.DB.prepare('UPDATE st_agents SET spent=spent+? WHERE code=?').bind(r.cost, r.agent).run()
}

/** 宽容 JSON：去围栏 / 取第一个对象 */
export function parseJson(t: string) {
  const s = t.replace(/```(json)?/g, '').trim(); const i = s.indexOf('{'), k = s.lastIndexOf('}')
  return JSON.parse(i >= 0 && k > i ? s.slice(i, k + 1) : s)
}

// ─────────── 文本 ───────────
export async function chat(env: Env, code: string, o: { system?: string; prompt: string; json?: boolean; project_id?: string; step?: number; user?: string; timeoutMs?: number }) {
  const a = await agentOf(env, code)
  const pv = await resolveProvider(env, a.provider_id)
  const id = uid('run_'), t0 = now()
  const system = [a.prompt, o.system].filter(Boolean).join('\n\n')
  try {
    let text = '', tin = 0, tout = 0
    if (pv.kind === 'mock_text') text = JSON.stringify({ mock: true, agent: code, echo: o.prompt.slice(0, 200) })
    else if (pv.kind === 'openai_compat') {
      if (!pv.base || !pv.key) throw new HttpError(409, 'PROVIDER_UNCONFIGURED', '服务商缺少 Base URL 或 Key')
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), o.timeoutMs || 90000)
      const { temperature, reasoning_effort, ...rest } = a.params || {}
      const body: any = { model: a.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: o.prompt }], ...rest }
      if (/gpt-5|o\d/.test(a.model)) { if (reasoning_effort) body.reasoning_effort = reasoning_effort } else if (temperature !== undefined) body.temperature = temperature
      if (o.json) body.response_format = { type: 'json_object' }
      const r = await fetch(pv.base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).finally(() => clearTimeout(tm))
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`)
      text = j.choices?.[0]?.message?.content || ''; tin = j.usage?.prompt_tokens || 0; tout = j.usage?.completion_tokens || 0
    } else throw new HttpError(409, 'PROVIDER_CAPABILITY', `服务商 ${pv.kind} 不支持对话`)
    const cost = a.unit_price ? +(((tin + tout) / 1000) * a.unit_price).toFixed(4) : 0
    await record(env, { id, project_id: o.project_id, step: o.step, agent: code, provider_id: pv.id, model: a.model, status: 'ok', latency_ms: now() - t0, tokens_in: tin, tokens_out: tout, cost, input: o.prompt, output: text, created_by: o.user })
    return { run_id: id, text, data: o.json ? parseJson(text) : null, latency_ms: now() - t0, model: a.model, provider: pv.kind }
  } catch (e: any) {
    const msg = String(e?.message || e)
    await record(env, { id, project_id: o.project_id, step: o.step, agent: code, provider_id: pv.id, model: a.model, status: 'error', latency_ms: now() - t0, error: msg.slice(0, 500), input: o.prompt, created_by: o.user })
    if (e instanceof HttpError) throw e
    throw new HttpError(502, 'MODEL_ERROR', `${a.name} 调用失败：${msg.slice(0, 200)}`)
  }
}

// ─────────── 视频（异步任务：submit → poll）───────────
export type VideoReq = { prompt: string; duration?: number; ratio?: string; resolution?: string; first_frame?: string; last_frame?: string; reference_images?: string[]; audio?: boolean; seed?: number; callback_url?: string }

/** 火山方舟 content 数组：首尾帧与参考图互斥（优先首尾帧） */
export function arkBody(model: string, q: VideoReq, params: any = {}) {
  const content: any[] = [{ type: 'text', text: q.prompt }]
  if (q.first_frame || q.last_frame) {
    if (q.first_frame) content.push({ type: 'image_url', image_url: { url: q.first_frame }, role: 'first_frame' })
    if (q.last_frame) content.push({ type: 'image_url', image_url: { url: q.last_frame }, role: 'last_frame' })
  } else for (const u of q.reference_images || []) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' })
  const b: any = { model, content, ratio: q.ratio || params.ratio || '9:16', duration: q.duration || params.duration || 10, resolution: q.resolution || params.resolution || '720p', watermark: false, return_last_frame: true }
  if (q.audio ?? params.audio) b.generate_audio = true
  if (q.seed !== undefined) b.seed = q.seed
  if (q.callback_url) b.callback_url = q.callback_url
  if (q.first_frame && !q.last_frame && b.ratio !== 'adaptive' && params.adaptive_with_first_frame) b.ratio = 'adaptive'
  return b
}

export async function submitVideo(env: Env, code: string, q: VideoReq, meta: { project_id?: string; step?: number; user?: string } = {}) {
  const a = await agentOf(env, code); const pv = await resolveProvider(env, a.provider_id)
  const id = uid('run_'), t0 = now()
  try {
    let task = ''
    if (pv.kind === 'mock_video') task = 'mock_' + uid()
    else if (pv.kind === 'ark_video') {
      if (!pv.base || !pv.key) throw new HttpError(409, 'PROVIDER_UNCONFIGURED', '方舟服务商缺少 Base URL 或 Key')
      const r = await fetch(pv.base + (pv.extra.submit_path || '/api/v3/contents/generations/tasks'), { method: 'POST', headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify(arkBody(a.model, q, a.params)) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j.id) throw new Error(`HTTP ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`)
      task = j.id
    } else if (pv.kind === 'openai_video') {
      const r = await fetch(pv.base + (pv.extra.submit_path || '/v1/videos/generations'), { method: 'POST', headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: a.model, prompt: q.prompt, duration: q.duration || a.params.duration, ratio: q.ratio || a.params.ratio, image: q.first_frame || q.reference_images?.[0], ...(pv.extra.body || {}) }) })
      const j: any = await r.json().catch(() => ({}))
      task = j.id || j.task_id || j.data?.id
      if (!r.ok || !task) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`)
    } else if (pv.kind === 'jimeng_cli' || pv.kind === 'gsk') {
      // 交由执行节点：写入队列，节点领取后调用 dreamina / gsk（P4 实现 node 端）
      task = 'node_' + uid()
      await env.DB.prepare(`INSERT INTO st_runs (id,project_id,step,agent,provider_id,model,status,input,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(task, meta.project_id || null, meta.step || null, code, pv.id, a.model, 'queued_node', JSON.stringify({ kind: pv.kind, req: q }), now(), meta.user || null).run()
    } else throw new HttpError(409, 'PROVIDER_CAPABILITY', `服务商 ${pv.kind} 不支持视频`)
    await record(env, { id, project_id: meta.project_id, step: meta.step, agent: code, provider_id: pv.id, model: a.model, status: 'submitted', latency_ms: now() - t0, input: q.prompt, output: task, created_by: meta.user })
    return { run_id: id, task_id: task, provider: pv.kind, provider_id: pv.id }
  } catch (e: any) {
    await record(env, { id, project_id: meta.project_id, step: meta.step, agent: code, provider_id: pv.id, model: a.model, status: 'error', latency_ms: now() - t0, error: String(e?.message || e).slice(0, 500), input: q.prompt, created_by: meta.user })
    if (e instanceof HttpError) throw e
    throw new HttpError(502, 'MODEL_ERROR', `${a.name} 提交失败：${String(e?.message || e).slice(0, 200)}`)
  }
}

/** 统一查询：status = queued | running | succeeded | failed；succeeded 带 video_url / last_frame_url */
export async function pollVideo(env: Env, providerId: string, taskId: string) {
  const pv = await resolveProvider(env, providerId)
  if (pv.kind === 'mock_video') return { status: 'succeeded', video_url: null, last_frame_url: null, mock: true }
  if (pv.kind === 'ark_video') {
    const r = await fetch(pv.base + (pv.extra.query_path || '/api/v3/contents/generations/tasks/') + encodeURIComponent(taskId), { headers: { Authorization: 'Bearer ' + pv.key } })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) return { status: 'unknown', error: `HTTP ${r.status}` }
    return { status: j.status, video_url: j.content?.video_url || null, last_frame_url: j.content?.last_frame_url || null, error: j.error?.message || null, usage: j.usage || null }
  }
  if (pv.kind === 'openai_video') {
    const r = await fetch(pv.base + (pv.extra.query_path || '/v1/videos/generations/') + encodeURIComponent(taskId), { headers: { Authorization: 'Bearer ' + pv.key } })
    const j: any = await r.json().catch(() => ({})); const s = String(j.status || j.data?.status || '').toLowerCase()
    return { status: /succe|complete|done/.test(s) ? 'succeeded' : /fail|error/.test(s) ? 'failed' : 'running', video_url: j.video_url || j.data?.video_url || j.output?.[0] || null, last_frame_url: j.last_frame_url || null, error: j.error || null }
  }
  const r: any = await env.DB.prepare('SELECT status, output, error FROM st_runs WHERE id=?').bind(taskId).first()
  return { status: r?.status === 'ok' ? 'succeeded' : r?.status === 'error' ? 'failed' : 'running', ...(J(r?.output, {}) || {}), error: r?.error || null }
}

/** 连通测试：对话发一句 ping；视频只校验鉴权（查询一个不存在的任务，401/403=Key 错，404/400=鉴权通过） */
export async function testProvider(env: Env, id: string) {
  const pv = await resolveProvider(env, id); const t0 = now()
  try {
    if (pv.kind.startsWith('mock')) return { ok: true, note: '模拟服务商，无需连通', ms: 0 }
    if (pv.kind === 'jimeng_cli' || pv.kind === 'gsk') {
      const n: any = await env.DB.prepare(`SELECT MAX(seen_at) t FROM worker_heartbeat`).first().catch(() => null)
      const alive = n?.t && now() - n.t < 120000
      return { ok: !!alive, note: alive ? '执行节点在线' : '没有在线的执行节点（P4 部署）', ms: 0 }
    }
    if (!pv.base || !pv.key) return { ok: false, note: '缺少 Base URL 或 Key', ms: 0 }
    if (pv.kind === 'openai_compat') {
      const r = await fetch(pv.base + '/models', { headers: { Authorization: 'Bearer ' + pv.key } })
      return { ok: r.ok, note: r.ok ? `鉴权通过（${r.status}）` : `HTTP ${r.status}`, ms: now() - t0 }
    }
    const path = pv.kind === 'ark_video' ? (pv.extra.query_path || '/api/v3/contents/generations/tasks/') : (pv.extra.query_path || '/v1/videos/generations/')
    const r = await fetch(pv.base + path + 'connectivity-probe-0000', { headers: { Authorization: 'Bearer ' + pv.key } })
    const auth = r.status !== 401 && r.status !== 403
    return { ok: auth, note: auth ? `鉴权通过（探针返回 ${r.status}，不产生费用）` : `Key 无效（HTTP ${r.status}）`, ms: now() - t0 }
  } catch (e: any) { return { ok: false, note: String(e?.message || e).slice(0, 160), ms: now() - t0 } }
}
