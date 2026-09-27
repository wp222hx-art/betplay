import * as Tax from '../catalog/taxonomy'
// 制作平台 · 可延续生成管线
// 选题（想看榜 / 结局热度）→ 剧本树（LLM：圣经 + 节点 + 片段分镜）→ 静态校验 → 渲染队列（Seedance 任务，外部 worker 拉取）
// → AI 质检 → 人工审核 → 上架；已上架作品可从“最热结局”派生续集 / 时间裂隙，形成数据飞轮
import { uid } from '../core/crypto'
import { GameError } from '../core/engine'
import { callCapability, type Bindings } from '../gateway/llm'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const CREDITS = { clip12: 1000, clip10: 850, cover: 88 }
export const STAGES = ['draft', 'scripted', 'rendering', 'review', 'published'] as const

// ─── 剧本树静态校验：可达性 / 结局数 / 隐藏支 / 裂隙闭环 / 片段齐备 ───
export function validateTree(tree: any) {
  const errs: string[] = [], warns: string[] = []
  const nodes: any[] = tree?.nodes || []
  const segs = tree?.clips || {}
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  if (!nodes.length) errs.push('没有抉择节点')
  const root = nodes.find((n) => n.depth === 1) || nodes[0]
  const seen = new Set<string>(), endings = new Set<string>()
  const walk = (id: string, d = 0) => {
    if (!id || seen.has(id) || d > 12) return
    seen.add(id)
    const n = byId[id]; if (!n) { errs.push(`节点 ${id} 不存在`); return }
    if ((n.options || []).length < 2) errs.push(`节点 ${id} 选项少于 2 个`)
    if (!(n.options || []).some((o: any) => o.twist)) warns.push(`节点 ${id} 没有隐藏选项（悔棋·新变数无效）`)
    for (const o of n.options || []) {
      if (!segs[o.id]) errs.push(`选项 ${o.id} 缺少片段分镜`)
      if (o.next) walk(o.next, d + 1); else endings.add(o.id)
    }
    if (n.fork) { if (!byId[n.fork.node]) errs.push(`节点 ${id} 的时间裂隙指向不存在的 ${n.fork.node}`); else walk(n.fork.node, d + 1) }
  }
  if (root) walk(root.id)
  nodes.filter((n) => !seen.has(n.id)).forEach((n) => warns.push(`节点 ${n.id} 不可达`))
  if (endings.size < 8) warns.push(`结局仅 ${endings.size} 个（建议 ≥ 12）`)
  const clipCount = Object.keys(segs).length
  const credits = Object.values<any>(segs).reduce((a, s) => a + ((s.dur || 10) >= 12 ? CREDITS.clip12 : CREDITS.clip10), 0)
  return { ok: !errs.length, errors: errs, warnings: warns, endings: endings.size, nodes: nodes.length, clips: clipCount, forks: nodes.filter((n) => n.fork).length, est_credits: credits }
}

// ─── 自动修复：把 LLM 常见结构错误规整成可生产的树 ───
// · 指向“空节点/伪结局节点”的选项 → 改为叶子结局 · 删除空节点 · 缺隐藏支 → 复制最低权重选项为 twist
// · 缺片段 → 补分镜占位 · 缺裂隙闭环 → 去掉 fork · 权重归一
export function repairTree(tree: any) {
  const fixes: string[] = []
  let nodes: any[] = (tree.nodes || []).filter((n: any) => n && n.id)
  const clips = (tree.clips ||= {})
  const real = (id: string) => nodes.find((n) => n.id === id && (n.options || []).length >= 2)
  for (const n of nodes) for (const o of n.options || []) {
    if (o.next && !real(o.next)) { const dead = nodes.find((x) => x.id === o.next); if (dead?.options?.[0] && !clips[o.id]) clips[o.id] = clips[dead.options[0].id] || { title: dead.question || o.label }; fixes.push(`${o.id}：${o.next} 为空节点 → 改为结局`); delete o.next }
  }
  const before = nodes.length
  nodes = nodes.filter((n) => (n.options || []).length >= 2)
  if (nodes.length < before) fixes.push(`删除 ${before - nodes.length} 个空节点`)
  for (const n of nodes) {
    if (n.fork && !nodes.some((x) => x.id === n.fork.node)) { fixes.push(`${n.id}：裂隙目标不存在 → 移除`); delete n.fork }
    if (!n.options.some((o: any) => o.twist)) {
      const base = [...n.options].sort((a: any, b: any) => (a.weight || 0) - (b.weight || 0))[0]
      const tid = `${base.id}_T`
      n.options.push({ id: tid, key: 'T', label: '意想不到的第三条路', hint: '只有悔棋才会出现', weight: 0.25, twist: true, ...(base.next ? { next: base.next } : {}) })
      clips[tid] = { title: '隐藏：' + (clips[base.id]?.title || base.label), dur: base.next ? 12 : 10, shots: '（待补分镜）隐藏分支：' + (clips[base.id]?.shots || '') }
      fixes.push(`${n.id}：补隐藏选项 ${tid}`)
    }
    const reg = n.options.filter((o: any) => !o.twist), sum = reg.reduce((a: number, o: any) => a + (+o.weight || 1), 0)
    reg.forEach((o: any) => (o.weight = Math.round(((+o.weight || 1) / sum) * 100) / 100))
    for (const o of n.options) if (!clips[o.id]) { clips[o.id] = { title: o.label, dur: o.next ? 12 : 10, shots: '（待补分镜）' + (o.hint || '') }; fixes.push(`补片段 ${o.id}`) }
    if (n.fork?.seg && !clips[n.fork.seg]) clips[n.fork.seg] = { title: '时间裂隙', dur: 12, shots: '世界静止，天空裂开，平行时间线开启' }
  }
  if (nodes.length && !nodes.some((n) => n.depth === 1)) nodes[0].depth = 1
  // 只保留被引用的片段
  const used = new Set<string>(['P', ...nodes.flatMap((n) => [...n.options.map((o: any) => o.id), n.fork?.seg].filter(Boolean))])
  for (const k of Object.keys(clips)) if (!used.has(k) && !/^P|prologue|^BONUS_/i.test(k)) delete clips[k]
  return { tree: { ...tree, nodes, clips }, fixes }
}

// ─── 模板兜底（无 LLM / 超时）：3 幕 × 4 选项 + 隐藏 + 裂隙 ───
function templateTree(title: string, logline: string, cast: string[]) {
  const [A, B, C] = [cast[0] || '她', cast[1] || '他', cast[2] || '神秘人']
  const clips: any = { P: { title: '序章', dur: 12, shots: `开场：${logline}` } }
  const nodes: any[] = [{ id: 'N1', depth: 1, question: `第一夜，你站在谁那边？`, options: [] }]
  const r = ['A', 'B', 'C']
  r.forEach((k, i) => {
    const id = 'R_' + k
    nodes[0].options.push({ id, key: k, label: [A, B, C][i] + '的秘密', hint: '越靠近，越危险', weight: 0.33, next: 'N_' + k })
    clips[id] = { title: [A, B, C][i] + '线', dur: 12, shots: `${[A, B, C][i]}主导的关键冲突场景` }
    nodes.push({ id: 'N_' + k, depth: 2, question: `${[A, B, C][i]}摊牌了，你押哪个结局？`, fork: { node: 'N_K', seg: 'K_1', label: '时间裂隙' }, options: ['真心', '背叛', '牺牲'].map((t, j) => ({ id: `E_${k}${j + 1}`, key: 'ABC'[j], label: t, hint: '', weight: 0.33 })).concat([{ id: `E_${k}X`, key: 'T', label: '隐藏真相', hint: '悔棋才会出现', weight: 0.25, twist: true } as any]) })
    ;['1', '2', '3', 'X'].forEach((j) => (clips[`E_${k}${j}`] = { title: `${[A, B, C][i]}·结局${j}`, dur: 10, shots: '结局场景' }))
  })
  nodes[0].options.push({ id: 'R_T', key: 'T', label: '第四个人', hint: '一直在暗处看着你', weight: 0.25, twist: true, next: 'N_A' })
  clips.R_T = { title: '暗处的人', dur: 12, shots: '隐藏角色登场' }
  nodes.push({ id: 'N_K', depth: 3, question: '平行时间线：你要改写谁的结局？', options: [{ id: 'E_K1', key: 'A', label: '全员幸存', hint: '', weight: 0.5 }, { id: 'E_K2', key: 'B', label: '只剩你一个', hint: '', weight: 0.5 }] })
  clips.K_1 = { title: '时间裂隙', dur: 12, shots: '世界静止，裂开' }; clips.E_K1 = { title: '全员幸存', dur: 10, shots: '' }; clips.E_K2 = { title: '只剩你一个', dur: 10, shots: '' }
  return { bible: { cast: [A, B, C].map((n) => ({ name: n, look: '', voice: '' })), style: 'cinematic', dialogue: 'Mandarin Chinese' }, nodes, clips }
}

const SYS = `你是互动剧总编剧。输出严格 JSON：{"bible":{"cast":[{"name","look","voice"}],"style"},"nodes":[{"id","depth","question","fork"?:{"node","seg","label"},"options":[{"id","key","label","hint","weight","next"?,"twist"?}]}],"clips":{"<选项id或裂隙seg>":{"title","dur","shots"}}}
规则：3 层；第一层 4 个常规选项 + 1 个 twist；第二层每个节点 3 常规 + 1 twist，并带 fork 指向同一个平行时间线节点 N_K（seg=K_1）；N_K 有 3~4 个结局选项；
所有叶子选项都是结局；每个选项 id 在 clips 里有分镜（shots：3~6 个镜头，含普通话台词 {台词}）；片段 dur：路线 12，结局 10；标题要有爆款感。`

export async function scriptProject(env: Bindings, p: { title: string; logline: string; cat: string; tags?: string[]; parent?: string; source_item?: string; kind?: string }) {
  const id = uid('prj_')
  const prompt = `作品：《${p.title}》（${Tax.brief(p.cat)}；标签：${(p.tags || []).join('、')}）\n一句话：${p.logline}${p.parent ? `\n这是续集，承接原作结局：${p.parent}` : ''}\n请生成完整剧本树 JSON。`
  const r: any = await callCapability(env, { capability: 'outline', tier: 'standard', json: true, system: SYS, prompt, agent: 7, ref: id, timeoutMs: 90000, fallback: () => null })
  let tree = r?.ok && r.data?.nodes ? r.data : templateTree(p.title, p.logline, [])
  const source = r?.ok && r.data?.nodes ? r.model : 'template'
  if (!tree.clips) tree.clips = {}
  const rep = repairTree(tree); tree = rep.tree
  const v = { ...validateTree(tree), fixes: rep.fixes }
  await env.DB.prepare(`INSERT INTO studio_projects (id,kind,parent,source_item,cat,title,logline,status,bible,tree,score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, p.kind || 'series', p.parent || null, p.source_item || null, Tax.fmt(p.cat), p.title, p.logline, 'scripted', JSON.stringify(tree.bible || {}), JSON.stringify({ nodes: tree.nodes, clips: tree.clips }), v.ok ? 1 : 0, now(), now()).run()
  return { id, source, validation: v, fixes: rep.fixes }
}

/** 把剧本树拆成渲染任务（幂等：同一项目同一片段只会入队一次） */
export async function queueRender(env: Bindings, projectId: string) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  if (!pj) throw new GameError('NOT_FOUND', '项目不存在')
  const tree = J(pj.tree, {}), v = validateTree(tree)
  if (!v.ok) throw new GameError('INVALID_TREE', '剧本树未通过校验：' + v.errors.slice(0, 3).join('；'))
  const st = Object.entries<any>(tree.clips).map(([cid, c]) => env.DB.prepare(`INSERT OR IGNORE INTO render_jobs (id,project_id,clip_id,title,prompt,dur,credits,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(uid('job_'), projectId, cid, c.title || cid, c.shots || '', c.dur || 10, (c.dur || 10) >= 12 ? CREDITS.clip12 : CREDITS.clip10, 'queued', now(), now()))
  if (st.length) await env.DB.batch(st)
  await env.DB.prepare(`UPDATE studio_projects SET status='rendering', updated_at=? WHERE id=?`).bind(now(), projectId).run()
  return { queued: st.length, est_credits: v.est_credits }
}

/** 外部渲染 worker（沙箱 / GPU 机）拉取任务：原子认领，避免重复生成烧积分 */
export async function claimJob(env: Bindings, worker: string) {
  const j: any = await env.DB.prepare(`SELECT id FROM render_jobs WHERE status='queued' ORDER BY created_at LIMIT 1`).first()
  if (!j) return null
  const r = await env.DB.prepare(`UPDATE render_jobs SET status='running', worker=?, updated_at=? WHERE id=? AND status='queued'`).bind(worker, now(), j.id).run()
  if (!r.meta.changes) return null
  return env.DB.prepare('SELECT * FROM render_jobs WHERE id=?').bind(j.id).first()
}
export async function reportJob(env: Bindings, p: { id: string; ok: boolean; url?: string; qc?: any }) {
  await env.DB.prepare(`UPDATE render_jobs SET status=?, result_url=?, qc=?, updated_at=? WHERE id=?`).bind(p.ok ? 'review' : 'failed', p.url || null, JSON.stringify(p.qc || {}), now(), p.id).run()
  return refreshProject(env, p.id)
}
export async function reviewJob(env: Bindings, p: { id: string; approve: boolean }) {
  await env.DB.prepare(`UPDATE render_jobs SET status=?, updated_at=? WHERE id=?`).bind(p.approve ? 'approved' : 'queued', now(), p.id).run() // 驳回 = 重新排队
  return refreshProject(env, p.id)
}
async function refreshProject(env: Bindings, jobId: string) {
  const j: any = await env.DB.prepare('SELECT project_id FROM render_jobs WHERE id=?').bind(jobId).first()
  const s: any = await env.DB.prepare(`SELECT COUNT(*) n, SUM(status='approved') ok, SUM(status IN ('review','approved')) done FROM render_jobs WHERE project_id=?`).bind(j.project_id).first()
  const status = s.ok === s.n ? 'review' : 'rendering'
  await env.DB.prepare('UPDATE studio_projects SET status=?, updated_at=? WHERE id=? AND status!=?').bind(status, now(), j.project_id, 'published').run()
  return { project: j.project_id, total: s.n, done: s.done, approved: s.ok, status }
}

export async function listProjects(env: Bindings) {
  const ps = (await env.DB.prepare('SELECT id,kind,parent,source_item,cat,title,logline,status,score,tree,created_at,updated_at FROM studio_projects ORDER BY updated_at DESC LIMIT 50').all()).results as any[]
  const jobs = (await env.DB.prepare(`SELECT project_id, status, COUNT(*) n, SUM(credits) c FROM render_jobs GROUP BY project_id, status`).all()).results as any[]
  return ps.map((p) => {
    const v = validateTree(J(p.tree, {}))
    const js = jobs.filter((j) => j.project_id === p.id)
    const by = Object.fromEntries(js.map((j) => [j.status, j.n]))
    delete p.tree
    return { ...p, validation: v, jobs: by, jobs_total: js.reduce((a, j) => a + j.n, 0) }
  })
}
export async function projectDetail(env: Bindings, id: string) {
  const p: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(id).first()
  if (!p) throw new GameError('NOT_FOUND', '项目不存在')
  const jobs = (await env.DB.prepare(`SELECT id,clip_id,kind,title,dur,credits,spent,status,result_url,worker,attempts,updated_at FROM render_jobs WHERE project_id=? ORDER BY CASE kind WHEN 'sheet' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END, clip_id`).bind(id).all()).results
  const tree = J(p.tree, {})
  return { ...p, bible: J(p.bible, {}), tree, validation: validateTree(tree), jobs }
}

/** 可延续生成：从真实数据挑下一批该做的内容 */
export async function nextUp(env: Bindings, catalog: any[]) {
  const wish = Object.fromEntries(((await env.DB.prepare('SELECT item_id, COUNT(*) n FROM catalog_wish GROUP BY item_id').all()).results as any[]).map((r) => [r.item_id, r.n]))
  const inProd = new Set(((await env.DB.prepare('SELECT source_item FROM studio_projects WHERE source_item IS NOT NULL').all()).results as any[]).map((r) => r.source_item))
  const concepts = catalog.filter((x) => x.status !== 'live' && !inProd.has(x.id)).map((x) => ({ id: x.id, title: x.title, cat: x.cat, logline: x.logline, tags: x.tags, demand: (wish[x.id] || 0) * 50 + x.heat / 100 })).sort((a, b) => b.demand - a.demand).slice(0, 6)
  // 续集候选：通关最多 / 卡片成交最多的结局
  const hot = (await env.DB.prepare(`SELECT series_id, ending_id, COUNT(*) n FROM comic_runs WHERE status='ended' GROUP BY series_id, ending_id ORDER BY n DESC LIMIT 5`).all()).results as any[]
  const traded = (await env.DB.prepare(`SELECT c.series_id, c.ending_id, COUNT(*) n, AVG(t.price) p FROM card_trades t JOIN ending_cards c ON c.id=t.card_id GROUP BY c.series_id, c.ending_id ORDER BY n DESC LIMIT 5`).all()).results as any[]
  return { concepts, sequels: hot, traded }
}

export async function repairProject(env: Bindings, id: string) {
  const p: any = await env.DB.prepare('SELECT tree FROM studio_projects WHERE id=?').bind(id).first()
  if (!p) throw new GameError('NOT_FOUND', '项目不存在')
  const r = repairTree(J(p.tree, {}))
  const v = validateTree(r.tree)
  await env.DB.prepare('UPDATE studio_projects SET tree=?, score=?, updated_at=? WHERE id=?').bind(JSON.stringify(r.tree), v.ok ? 1 : 0, now(), id).run()
  return { fixes: r.fixes, validation: v }
}
