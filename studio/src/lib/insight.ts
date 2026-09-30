// 前置模拟 + 剧本评审：在花钱生成视频之前，先回答三个问题
//   ① 能不能玩（结构）：玩家端编译是否成功、路径 / 结局分布、每次游玩时长、结局到达概率（蒙特卡洛）
//   ② 合不合理（剧本合理性）：确定性检查（账本冲突、悬念、台词、角色出场）+ 评审 Agent（动机、因果、人设、逻辑漏洞）
//   ③ 吸不吸引人（吸引力指数）：钩子、悬念密度、抉择张力、反转、情绪曲线、人设辨识度、结局回报 七维打分 → 0–100
// 生成清单：把所有要拍的片段按「主线 / 分支 / 汇合 / 结局 / 裂隙」×「参考图 / 尾帧接力」归类，拓扑分批（同一批可并行），逐项估算成本
import { HttpError, type Env, type User, audit } from './auth'
import * as C from './compile'
import * as G from './graph'
import * as Gw from './gateway'
import * as L from './ledger'
import * as Steps from './steps'
import { uid } from './sec'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const DIMS = [
  { k: 'hook', n: '开场钩子', w: 0.2, d: '前 3 秒能否抓住人（冲突 / 悬念 / 反常画面）' },
  { k: 'suspense', n: '悬念密度', w: 0.15, d: '每个节点结尾是否留钩子，让人想押下一注' },
  { k: 'stakes', n: '抉择张力', w: 0.2, d: '选项之间是否势均力敌、代价明确、押哪个都心疼' },
  { k: 'twist', n: '反转力度', w: 0.1, d: '是否有出乎意料又合理的反转' },
  { k: 'emotion', n: '情绪曲线', w: 0.1, d: '爽 / 虐 / 燃 / 甜 的起伏节奏' },
  { k: 'character', n: '人设辨识度', w: 0.1, d: '角色一句话能被记住，动机鲜明' },
  { k: 'payoff', n: '结局回报', w: 0.15, d: '结局是否兑现铺垫，黄金以上结局值得追' }
] as const
// 真实价格参考（算力网公开价，720p 有声 Seedance 2.0 ≈ 每秒 ¥1.0；图片 ¥0.2/张）；可在 Agent 参数 unit_price_sec 覆盖
const PRICE = { video_sec: 1.0, image: 0.2, llm_call: 0.02 }

// ───────── 结构模拟（纯函数，可单测）─────────
export function simulate(g: G.Graph, docs: Map<string, any>, o: { runs?: number; seed?: number; secPerClip?: number } = {}) {
  const plan = C.compile(g), runs = o.runs || 2000, sec = o.secPerClip || 8
  let seed = o.seed ?? 20260930; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const by = new Map(plan.nodes.map((n) => [n.id, n])), durOf = (seg: string) => plan.segments[seg]?.parts.reduce((a, p) => a + (+docs.get(p.node)?.duration || sec), 0) || 0
  const ends = new Map<string, number>(), lens: number[] = [], secs: number[] = [], visits = new Map<string, number>()
  const root = plan.nodes.find((n) => n.depth === 1)
  for (let i = 0; i < runs && root; i++) {
    let cur: any = root, t = durOf('P'), d = 0
    while (cur && d < 40) {
      visits.set(cur.id, (visits.get(cur.id) || 0) + 1); d++
      const r = rnd(); let acc = 0, pick = cur.options[cur.options.length - 1]
      const tot = cur.options.reduce((a: number, x: any) => a + x.weight, 0)
      for (const op of cur.options) { acc += op.weight / tot; if (r < acc) { pick = op; break } }
      t += durOf(pick.id)
      if (!pick.next) { const k = `${pick.ending_title}|${pick.ending_tier || 'normal'}`; ends.set(k, (ends.get(k) || 0) + 1); break }
      cur = by.get(pick.next)
    }
    lens.push(d); secs.push(t)
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const endings = [...ends.entries()].map(([k, v]) => { const [title, tier] = k.split('|'); return { title, tier, p: +(v / runs).toFixed(3) } }).sort((a, b) => b.p - a.p)
  const premium = endings.filter((e) => ['gold', 'platinum', 'diamond'].includes(e.tier)).reduce((a, e) => a + e.p, 0)
  const H = -endings.reduce((a, e) => a + (e.p > 0 ? e.p * Math.log2(e.p) : 0), 0), Hmax = Math.log2(Math.max(1, endings.length))
  const an = G.analyze(g)
  const warnings: string[] = []
  if (premium < 0.05 && endings.length) warnings.push(`黄金及以上结局到达率只有 ${(premium * 100).toFixed(1)}%，玩家很难看到高光`)
  if (premium > 0.6) warnings.push(`黄金及以上结局到达率 ${(premium * 100).toFixed(0)}%，太容易拿到，稀缺感不足`)
  if (avg(secs) > 600) warnings.push(`单次游玩平均 ${Math.round(avg(secs) / 60)} 分钟，偏长（竖屏短剧建议 2–6 分钟）`)
  if (avg(secs) < 40 && root) warnings.push(`单次游玩平均只有 ${Math.round(avg(secs))} 秒，内容偏薄`)
  if (Hmax && H / Hmax < 0.5) warnings.push('结局分布集中在少数几个，其余结局几乎到不了（可调选项权重或结构）')
  const lonely = plan.nodes.filter((n) => !visits.get(n.id)).map((n) => n.title)
  if (lonely.length) warnings.push(`${lonely.length} 个抉择点在模拟中从未被走到：${lonely.slice(0, 3).join('、')}`)
  return {
    playable: !plan.issues.some((i) => i.level === 'error'), compile_issues: plan.issues, stats: plan.stats, graph: an.stats,
    runs, avg_decisions: +avg(lens).toFixed(2), avg_seconds: Math.round(avg(secs)), min_seconds: secs.length ? Math.round(Math.min(...secs)) : 0, max_seconds: secs.length ? Math.round(Math.max(...secs)) : 0,
    endings, premium_rate: +premium.toFixed(3), ending_balance: Hmax ? +(H / Hmax).toFixed(2) : 0, node_reach: plan.nodes.map((n) => ({ id: n.id, title: n.title, p: +((visits.get(n.id) || 0) / runs).toFixed(3) })), warnings
  }
}

// ───────── 生成清单：所有要拍的片段按类型 × 生成方式归类 + 拓扑分批 ─────────
export function manifest(g: G.Graph, prompts: Map<string, any>, scripts: Map<string, any>, o: { priceSec?: number } = {}) {
  const main = new Set(G.mainline(g)), modes = L.videoModes(g, [...main]), P = L.preds(g), { order } = L.topoOrder(g)
  const plan = C.compile(g), uses = new Map<string, string[]>()
  for (const s of Object.values(plan.segments)) for (const p of s.parts) { if (!uses.has(p.node)) uses.set(p.node, []); uses.get(p.node)!.push(s.id) }
  const wave = new Map<string, number>()
  for (const id of order) { const m = modes.get(id)!; wave.set(id, m.mode === 'frames' && m.from ? (wave.get(m.from) || 0) + 1 : 0) }
  const cat = (n: G.GNode) => n.type === 'ending' ? 'ending' : n.type === 'loop' ? 'loop' : n.type === 'merge' || (P.get(n.id) || []).length > 1 ? 'merge' : main.has(n.id) ? 'main' : 'branch'
  const price = o.priceSec || PRICE.video_sec
  const items = g.nodes.map((n) => {
    const m = modes.get(n.id)!, p = prompts.get(n.id), sc = scripts.get(n.id), dur = +(p?.duration || sc?.duration || 8)
    return { node: n.id, title: n.title, type: n.type, category: cat(n), tier: n.tier || null, step: main.has(n.id) ? 7 : 8, mode: m.mode, from: m.from || null, why: m.why, wave: wave.get(n.id) || 0,
      duration: dur, cost: +(dur * price).toFixed(2), cast: p?.cast || sc?.cast || [], prompt: p?.final || p?.prompt || '', has_prompt: !!p, dialogue: (p?.dialogue || []).length, used_in: uses.get(n.id) || [], reused: (uses.get(n.id) || []).length > 1 }
  })
  const CATS: Record<string, string> = { main: '主线', branch: '分支', merge: '汇合', ending: '结局', loop: '时间裂隙' }
  const groups = Object.entries(CATS).map(([k, name]) => { const xs = items.filter((i) => i.category === k); return { key: k, name, count: xs.length, seconds: xs.reduce((a, x) => a + x.duration, 0), cost: +xs.reduce((a, x) => a + x.cost, 0).toFixed(2), reference: xs.filter((x) => x.mode === 'reference').length, frames: xs.filter((x) => x.mode === 'frames').length } }).filter((g) => g.count)
  const waves = [...new Set(items.map((i) => i.wave))].sort((a, b) => a - b).map((w) => ({ wave: w, label: w === 0 ? '第 1 批 · 参考图模式（可全部并行）' : `第 ${w + 1} 批 · 接第 ${w} 批尾帧`, nodes: items.filter((i) => i.wave === w).map((i) => i.node) }))
  return { items, groups, waves, totals: { clips: items.length, seconds: items.reduce((a, x) => a + x.duration, 0), cost: +items.reduce((a, x) => a + x.cost, 0).toFixed(2), missing_prompts: items.filter((x) => !x.has_prompt).length, reused: items.filter((x) => x.reused).length }, price_per_sec: price }
}

// ───────── 剧本确定性检查（不花钱）─────────
export function lint(g: G.Graph, scripts: Map<string, any>, bible: any) {
  const out: { level: 'error' | 'warn'; node?: string; msg: string }[] = []
  const cast = new Set((bible?.cast || []).map((c: any) => c.id)), speak = new Map<string, number>()
  for (const n of g.nodes) {
    const s = scripts.get(n.id); if (!s) { out.push({ level: 'error', node: n.id, msg: `「${n.title}」还没有剧本` }); continue }
    const lines = (s.beats || []).filter((b: any) => b.line && b.line.replace(/[.。…\s]/g, ''))
    if (!lines.length && n.type !== 'merge') out.push({ level: 'warn', node: n.id, msg: `「${n.title}」没有台词，观众只能看画面` })
    for (const b of s.beats || []) { if (b.who && !cast.has(b.who)) out.push({ level: 'warn', node: n.id, msg: `「${n.title}」出现未登记角色 ${b.who}` }); if (b.who) speak.set(b.who, (speak.get(b.who) || 0) + (b.line ? 1 : 0)) }
    if ((n.type === 'choice' || n.type === 'loop') && !(s.cliff || '').trim()) out.push({ level: 'warn', node: n.id, msg: `抉择点「${n.title}」结尾没有悬念钩子（cliff）` })
    if (n.type === 'ending' && lines.length < 1) out.push({ level: 'warn', node: n.id, msg: `结局「${n.title}」缺少收尾台词` })
    if ((s.duration || 8) > 15) out.push({ level: 'warn', node: n.id, msg: `「${n.title}」时长 ${s.duration}s，超过 Seedance 2.0 单段上限 15s` })
  }
  for (const c of bible?.cast || []) if (!speak.get(c.id)) out.push({ level: 'warn', msg: `角色 ${c.name || c.id} 从头到尾没有一句台词` })
  return out
}

async function load(env: Env, pid: string, need = 4) {
  const brief = await Steps.doneOutput(env, pid, 1), bible = await Steps.doneOutput(env, pid, 2), graph = G.normalize(await Steps.doneOutput(env, pid, 3))
  const docs = (kind: string) => env.DB.prepare(`SELECT node_id,data FROM st_node_docs WHERE project_id=? AND kind=?`).bind(pid, kind).all().then((r) => new Map<string, any>((r.results as any[]).map((x) => [x.node_id, J(x.data)])))
  const scripts = await docs('script'), prompts = need >= 5 ? await docs('prompt') : new Map()
  return { brief, bible, graph, scripts, prompts }
}

/** 前置模拟（免费）：第 3 步通过后即可跑；有剧本/提示词时更准 */
export async function preview(env: Env, pid: string) {
  const brief = await Steps.doneOutput(env, pid, 1), bible = await Steps.doneOutput(env, pid, 2), graph = G.normalize(await Steps.doneOutput(env, pid, 3))
  const docs = async (kind: string) => new Map<string, any>(((await env.DB.prepare(`SELECT node_id,data FROM st_node_docs WHERE project_id=? AND kind=?`).bind(pid, kind).all()).results as any[]).map((x) => [x.node_id, J(x.data)]))
  const scripts = await docs('script'), prompts = await docs('prompt')
  const a: any = await env.DB.prepare(`SELECT params FROM st_agents WHERE code='VIDEO_BRANCH'`).first()
  const priceSec = +J(a?.params, {})?.unit_price_sec || PRICE.video_sec
  const sim = simulate(graph, scripts), man = manifest(graph, prompts, scripts, { priceSec })
  const cast = (bible?.cast || []).length
  const budget = { videos: man.totals.cost, images: +((cast + 1) * PRICE.image * 1.5).toFixed(2), llm: +(graph.nodes.length * 3 * PRICE.llm_call).toFixed(2), retry_buffer: +(man.totals.cost * 0.25).toFixed(2) }
  const total = +(budget.videos + budget.images + budget.llm + budget.retry_buffer).toFixed(2)
  const last: any = await env.DB.prepare(`SELECT * FROM st_reviews WHERE project_id=? ORDER BY created_at DESC LIMIT 1`).bind(pid).first()
  return { brief: { title: brief?.theme, format: brief?.format }, simulation: sim, manifest: man, lint: scripts.size ? lint(graph, scripts, bible) : [], budget: { ...budget, total, currency: 'CNY', note: '按算力网公开价估算（Seedance 2.0 720p 有声 ≈ ¥1/秒，图片 ¥0.2/张），含 25% 重拍缓冲' },
    review: last ? { ...last, dims: J(last.dims), issues: J(last.issues), suggestions: J(last.suggestions) } : null, stage: { scripts: scripts.size, prompts: prompts.size, nodes: graph.nodes.length } }
}

// ───────── 评审 Agent：剧本合理性 + 吸引力指数 ─────────
export function scoreOf(dims: Record<string, number>) { return Math.round(DIMS.reduce((a, d) => a + (Math.max(0, Math.min(10, +dims[d.k] || 0)) * d.w), 0) * 10) }
export async function review(env: Env, u: User, pid: string) {
  const d = await load(env, pid, 4)
  if (!d.scripts.size) throw new HttpError(409, 'NO_SCRIPTS', '请先完成第 4 步剧本描述，再做剧本评审')
  const sim = simulate(d.graph, d.scripts), lin = lint(d.graph, d.scripts, d.bible)
  const main = new Set(G.mainline(d.graph)), plan = C.compile(d.graph)
  const nodeTxt = d.graph.nodes.map((n) => { const s = d.scripts.get(n.id) || {}; return `[${n.id}|${n.type}${n.tier ? '|' + n.tier : ''}${main.has(n.id) ? '|主线' : ''}] ${n.title}${n.question ? `（抉择：${n.question}）` : ''}：${s.summary || n.beat || ''} 台词：${(s.beats || []).filter((b: any) => b.line).map((b: any) => `${b.who}「${b.line}」`).join(' ')} 悬念：${s.cliff || '—'}` }).join('\n').slice(0, 9000)
  const choices = plan.nodes.map((n) => `${n.question}：${n.options.map((o) => `${o.label}${o.ending_title ? `→结局「${o.ending_title}」(${o.ending_tier})` : ''}`).join(' / ')}`).join('\n')
  const r = await Gw.chat(env, 'REVIEWER', { json: true, project_id: pid, step: 4, user: u.id, timeoutMs: 90000,
    system: `你是爆款互动短剧的总编审（懂竖屏短剧、懂下注玩法）。玩家在每个抉择点用娱乐币押剧情走向。请严格、具体地评审，只输出 JSON：
{"logic":{"score":0-10,"issues":[{"node":"节点id或空","level":"error|warn","msg":"≤50字：动机不足/因果断裂/人设崩/信息矛盾/时间线错误"}]},
"dims":{${DIMS.map((x) => `"${x.k}":0-10`).join(',')}},
"highlights":["≤30字，最能打的看点，最多3条"],
"suggestions":[{"node":"节点id或空","msg":"≤60字，可直接执行的改法"}],
"verdict":"≤60字总评","logline_hook":"≤30字，改写后更抓人的一句话宣传语"}
评分口径：${DIMS.map((x) => `${x.n}（${x.d}）`).join('；')}。5 分=及格的普通短剧，8 分=同类前 10%，不要客气。`,
    prompt: `作品：${d.bible?.logline || d.brief?.theme}\n世界观：${String(d.bible?.world || '').slice(0, 400)}\n角色：${(d.bible?.cast || []).map((c: any) => `${c.id}（${c.name}，${c.role}）`).join('；')}\n\n抉择与结局：\n${choices}\n\n节点剧本：\n${nodeTxt}\n\n结构模拟：平均 ${sim.avg_decisions} 次抉择、${sim.avg_seconds} 秒一局；结局分布 ${sim.endings.map((e) => `${e.title}(${e.tier}) ${(e.p * 100).toFixed(0)}%`).join('、')}` })
  const o = r.data || {}, dims = Object.fromEntries(DIMS.map((x) => [x.k, Math.max(0, Math.min(10, +o.dims?.[x.k] || 0))]))
  const logic = Math.max(0, Math.min(10, +o.logic?.score || 0)), appeal = scoreOf(dims)
  const issues = [...(Array.isArray(o.logic?.issues) ? o.logic.issues : []).slice(0, 20).map((i: any) => ({ node: String(i.node || ''), level: i.level === 'error' ? 'error' : 'warn', msg: String(i.msg || '').slice(0, 100), src: 'agent' })), ...lin.map((x) => ({ ...x, node: x.node || '', src: 'lint' }))]
  const sug = (Array.isArray(o.suggestions) ? o.suggestions : []).slice(0, 12).map((s: any) => ({ node: String(s.node || ''), msg: String(s.msg || '').slice(0, 120) }))
  // 结构层面的吸引力修正：结局太集中 / 高光太难拿，扣分并给建议
  const struct = sim.warnings
  const id = uid('rv_')
  await env.DB.prepare(`INSERT INTO st_reviews (id,project_id,logic,appeal,dims,issues,suggestions,verdict,hook,highlights,sim,run_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, pid, logic, appeal, JSON.stringify(dims), JSON.stringify(issues), JSON.stringify(sug), String(o.verdict || '').slice(0, 200), String(o.logline_hook || '').slice(0, 80), JSON.stringify((o.highlights || []).slice(0, 3)), JSON.stringify({ warnings: struct, premium_rate: sim.premium_rate, avg_seconds: sim.avg_seconds, balance: sim.ending_balance }), r.run_id, u.id, now()).run()
  await audit(env, u.id, 'script_review', pid, { logic, appeal })
  return { id, logic, appeal, dims, issues, suggestions: sug, verdict: o.verdict || '', hook: o.logline_hook || '', highlights: o.highlights || [], structure: struct, grade: appeal >= 80 ? 'S' : appeal >= 70 ? 'A' : appeal >= 60 ? 'B' : appeal >= 50 ? 'C' : 'D' }
}
export async function history(env: Env, pid: string) {
  return ((await env.DB.prepare(`SELECT id,logic,appeal,dims,verdict,hook,created_at FROM st_reviews WHERE project_id=? ORDER BY created_at DESC LIMIT 20`).bind(pid).all()).results as any[]).map((r) => ({ ...r, dims: J(r.dims) }))
}
