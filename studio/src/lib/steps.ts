// 十步卡关状态机：服务端强制推进（上一步未 done → 下一步接口 409）；修改上游已完成步骤 → 所有下游标记 stale，必须重新走
import { HttpError, type Env, type User, audit } from './auth'

export const STEPS = [
  { no: 1, key: 'brief', name: '立项', agent: 'SCREENWRITER', desc: '主题、形态、题材、受众、规模、预算' },
  { no: 2, key: 'bible', name: '世界观 · 角色', agent: 'SCREENWRITER', desc: '世界观、角色卡（中文人设 + 英文外貌）、主线梗概' },
  { no: 3, key: 'graph', name: '结构图', agent: 'STRUCTURE', desc: '画布：场景/抉择锚点/汇合/回溯/结局；AI 延展；路径数与成本估算' },
  { no: 4, key: 'script', name: '剧本描述', agent: 'SCRIPT', desc: '每个节点的剧情细节、对白、情绪、结尾悬念' },
  { no: 5, key: 'prompts', name: '提示词 · 连贯监管', agent: 'PROMPT', desc: '剧本 → 视频提示词；剧情账本逐节点比对（服装/道具/伤痕/信息）' },
  { no: 6, key: 'assets', name: '设定图', agent: 'ASSET', desc: '角色设定图、场景图、封面；原创面孔约束' },
  { no: 7, key: 'mainline', name: '主线视频', agent: 'VIDEO_MAIN', desc: '主线片段（参考图模式锁人物）' },
  { no: 8, key: 'branches', name: '分支视频', agent: 'VIDEO_BRANCH', desc: '分支片段（上一段尾帧 → 下一段首帧）；按需生成' },
  { no: 9, key: 'consistency', name: '一致性检测', agent: 'CONSISTENCY', desc: '首尾帧衔接、人脸相似度、烧录字幕、视觉抽检；不合格重拍' },
  { no: 10, key: 'publish', name: '预检 · 上架', agent: 'COMPLIANCE', desc: '合规审核、可玩性预检、生成不可变版本快照给玩家端' }
] as const
export type StepStatus = 'locked' | 'ready' | 'running' | 'review' | 'done' | 'failed' | 'stale'
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export async function initSteps(env: Env, projectId: string, by: string) {
  await env.DB.batch(STEPS.map((s) => env.DB.prepare('INSERT INTO st_steps (project_id,step,status,updated_at,updated_by) VALUES (?,?,?,?,?)').bind(projectId, s.no, s.no === 1 ? 'ready' : 'locked', now(), by)))
}

export async function listSteps(env: Env, projectId: string) {
  const rows = (await env.DB.prepare('SELECT * FROM st_steps WHERE project_id=? ORDER BY step').bind(projectId).all()).results as any[]
  return STEPS.map((s) => { const r = rows.find((x) => x.step === s.no) || {}; return { ...s, status: r.status || 'locked', version: r.version || 0, note: r.note || '', approved_by: r.approved_by || null, approved_at: r.approved_at || null, updated_at: r.updated_at || null, input: J(r.input), output: J(r.output) } })
}

async function row(env: Env, projectId: string, step: number) {
  const r: any = await env.DB.prepare('SELECT * FROM st_steps WHERE project_id=? AND step=?').bind(projectId, step).first()
  if (!r) throw new HttpError(404, 'NO_STEP', '项目或步骤不存在')
  return r
}

/** 进入某一步的前置条件：它之前所有步骤都必须 done */
export async function assertOpen(env: Env, projectId: string, step: number) {
  if (step < 1 || step > STEPS.length) throw new HttpError(400, 'BAD_STEP', '步骤编号无效')
  const prev = (await env.DB.prepare('SELECT step,status FROM st_steps WHERE project_id=? AND step<? ORDER BY step').bind(projectId, step).all()).results as any[]
  const blocker = prev.find((p) => p.status !== 'done')
  if (blocker) {
    const s = STEPS[blocker.step - 1]
    throw new HttpError(409, 'STEP_LOCKED', `请先完成第 ${blocker.step} 步「${s.name}」（当前：${blocker.status}）`, { blocking_step: blocker.step, blocking_status: blocker.status })
  }
  return row(env, projectId, step)
}

/** 保存草稿 / 写入产出（运行中、待审核） */
export async function saveStep(env: Env, u: User, projectId: string, step: number, p: { input?: any; output?: any; status?: StepStatus; note?: string; run_id?: string }) {
  const r = await assertOpen(env, projectId, step)
  const wasDone = r.status === 'done'
  const status = p.status || (r.status === 'locked' || r.status === 'stale' ? 'ready' : r.status === 'done' ? 'review' : r.status)
  await env.DB.prepare(`UPDATE st_steps SET input=COALESCE(?,input), output=COALESCE(?,output), status=?, note=COALESCE(?,note), run_id=COALESCE(?,run_id), version=version+?, updated_at=?, updated_by=?, approved_by=CASE WHEN ?='done' THEN approved_by ELSE NULL END WHERE project_id=? AND step=?`)
    .bind(p.input === undefined ? null : JSON.stringify(p.input), p.output === undefined ? null : JSON.stringify(p.output), status, p.note ?? null, p.run_id ?? null, p.output !== undefined ? 1 : 0, now(), u.id, status, projectId, step).run()
  // 修改已完成的步骤 → 下游全部失效
  const staled = wasDone && status !== 'done' ? await invalidateAfter(env, projectId, step) : 0
  await audit(env, u.id, 'step_save', `${projectId}#${step}`, { status, staled })
  return { step, status, staled }
}

/** 审批通过：本步 done，下一步解锁为 ready（仅当本步有产出） */
export async function approveStep(env: Env, u: User, projectId: string, step: number, note = '') {
  const r = await assertOpen(env, projectId, step)
  if (!r.output) throw new HttpError(409, 'NO_OUTPUT', '本步还没有产出，无法通过')
  if (['running'].includes(r.status)) throw new HttpError(409, 'RUNNING', '本步仍在运行中')
  const st: any[] = [env.DB.prepare(`UPDATE st_steps SET status='done', approved_by=?, approved_at=?, note=?, updated_at=? WHERE project_id=? AND step=?`).bind(u.id, now(), note, now(), projectId, step)]
  if (step < STEPS.length) st.push(env.DB.prepare(`UPDATE st_steps SET status=CASE WHEN status IN ('locked','stale') THEN 'ready' ELSE status END, updated_at=? WHERE project_id=? AND step=?`).bind(now(), projectId, step + 1))
  await env.DB.batch(st)
  await env.DB.prepare('UPDATE st_projects SET updated_at=? WHERE id=?').bind(now(), projectId).run()
  await audit(env, u.id, 'step_approve', `${projectId}#${step}`, { note })
  return { step, status: 'done', next: step < STEPS.length ? step + 1 : null }
}

/** 退回：本步回到 review；下游失效 */
export async function reopenStep(env: Env, u: User, projectId: string, step: number, note = '') {
  await assertOpen(env, projectId, step)
  await env.DB.prepare(`UPDATE st_steps SET status='review', approved_by=NULL, approved_at=NULL, note=?, updated_at=?, updated_by=? WHERE project_id=? AND step=?`).bind(note, now(), u.id, projectId, step).run()
  const staled = await invalidateAfter(env, projectId, step)
  await audit(env, u.id, 'step_reopen', `${projectId}#${step}`, { note, staled })
  return { step, status: 'review', staled }
}

async function invalidateAfter(env: Env, projectId: string, step: number) {
  const r = await env.DB.prepare(`UPDATE st_steps SET status=CASE WHEN status='locked' THEN 'locked' ELSE 'stale' END, approved_by=NULL, approved_at=NULL, updated_at=? WHERE project_id=? AND step>? AND status!='locked'`).bind(now(), projectId, step).run()
  return r.meta.changes || 0
}

/** 读取已完成的上游产出（下游 Agent 的输入必须来自已审批版本） */
export async function doneOutput(env: Env, projectId: string, step: number) {
  const r: any = await env.DB.prepare(`SELECT output,status FROM st_steps WHERE project_id=? AND step=?`).bind(projectId, step).first()
  if (!r || r.status !== 'done') throw new HttpError(409, 'UPSTREAM_NOT_DONE', `上游第 ${step} 步尚未通过`)
  return J(r.output)
}
