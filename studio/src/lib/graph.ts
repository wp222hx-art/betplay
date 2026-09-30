// 结构图引擎（第 3 步）：剧情 DAG + 回溯边。
// 设计要点：用「汇合」控制组合爆炸——路径数可以成百上千，而需要拍摄的片段数只随节点数线性增长。
//   节点 type：scene 剧情场景 / choice 博弈锚点（2–4 个选项）/ merge 汇合 / loop 时间裂隙（回溯）/ ending 结局
//   边 kind：next 顺接 / option 选项 / back 回溯（只能指向祖先，且源节点必须还有前进出口 → 可玩路径有限）
export type NodeType = 'scene' | 'choice' | 'merge' | 'loop' | 'ending'
export type Tier = 'bad' | 'normal' | 'gold' | 'platinum' | 'diamond'
export type GNode = { id: string; type: NodeType; title: string; beat?: string; question?: string; tier?: Tier; x?: number; y?: number; cast?: string[] }
export type GEdge = { id: string; from: string; to: string; kind: 'next' | 'option' | 'back'; label?: string; hint?: string; main?: boolean; max_uses?: number }
export type Graph = { start: string; nodes: GNode[]; edges: GEdge[]; meta?: any }
export type Issue = { level: 'error' | 'warn'; code: string; msg: string; node?: string; edge?: string }

export const TYPES: NodeType[] = ['scene', 'choice', 'merge', 'loop', 'ending']
export const TIERS: Tier[] = ['bad', 'normal', 'gold', 'platinum', 'diamond']
const QUESTION_RE = /你(会|要|想|该|选|打算|决定)|要不要|是否|还是继续|[?？]$/
const clip = (s: any, n: number) => String(s ?? '').trim().slice(0, n)

/** 清洗任意来源（AI / 前端）的图：丢弃非法字段、补全默认值、去重 */
const unq = (o: any) => { if (!o || typeof o !== 'object') return o; const r: any = {}; for (const [k, v] of Object.entries(o)) { const kk = k.replace(/\?$/, ''); if (r[kk] === undefined || !k.endsWith('?')) r[kk] = v } return r }

export function normalize(g: any): Graph {
  const nodes: GNode[] = [], seen = new Set<string>()
  for (const n0 of Array.isArray(g?.nodes) ? g.nodes : []) {
    const n = unq(n0)
    const id = clip(n?.id, 24).replace(/[^\w-]/g, '_'); if (!id || seen.has(id)) continue; seen.add(id)
    const type: NodeType = TYPES.includes(n.type) ? n.type : 'scene'
    const o: GNode = { id, type, title: clip(n.title || id, 24), beat: clip(n.beat, 240) }
    if (type === 'choice' || type === 'loop') o.question = clip(n.question, 60)
    if (type === 'ending') o.tier = TIERS.includes(n.tier) ? n.tier : 'normal'
    if (Array.isArray(n.cast)) o.cast = n.cast.map((c: any) => clip(c, 24)).filter(Boolean).slice(0, 6)
    if (Number.isFinite(+n.x) && n.x !== null && n.x !== undefined) o.x = Math.round(+n.x)
    if (Number.isFinite(+n.y) && n.y !== null && n.y !== undefined) o.y = Math.round(+n.y)
    nodes.push(o)
  }
  const edges: GEdge[] = [], eseen = new Set<string>(), eids = new Set<string>(); let k = 0
  for (const e0 of Array.isArray(g?.edges) ? g.edges : []) {
    const e = unq(e0)
    const from = String(e?.from ?? ''), to = String(e?.to ?? '')
    if (!seen.has(from) || !seen.has(to) || from === to) continue
    const kind = e.kind === 'back' ? 'back' : e.kind === 'option' ? 'option' : 'next'
    const key = `${from}>${to}>${kind}>${kind === 'back' ? '' : clip(e.label, 12)}`; if (eseen.has(key)) continue; eseen.add(key)
    let id = clip(e.id, 24).replace(/[^\w-]/g, '_'); if (!id || eids.has(id)) { do id = 'e' + ++k; while (eids.has(id)) }
    eids.add(id)
    const o: GEdge = { id, from, to, kind }
    if (e.label) o.label = clip(e.label, 12); if (e.hint) o.hint = clip(e.hint, 40)
    if (e.main === true || e.main === 'true') o.main = true
    if (kind === 'back') o.max_uses = Math.max(1, Math.min(3, +e.max_uses || 1))
    edges.push(o)
  }
  // 选项边：choice/loop 的前进出边一律视为 option
  const tmap = new Map(nodes.map((n) => [n.id, n.type]))
  for (const e of edges) if (e.kind !== 'back') e.kind = tmap.get(e.from) === 'choice' || tmap.get(e.from) === 'loop' ? 'option' : 'next'
  const start = seen.has(g?.start) ? g.start : nodes.find((n) => !edges.some((e) => e.to === n.id && e.kind !== 'back'))?.id || nodes[0]?.id || ''
  return { start, nodes, edges, meta: g?.meta && typeof g.meta === 'object' ? g.meta : undefined }
}

const fwd = (g: Graph) => g.edges.filter((e) => e.kind !== 'back')

/** 拓扑序（仅前进边）；有环则返回环上的节点 */
function topo(g: Graph) {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0])), out = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]))
  for (const e of fwd(g)) { indeg.set(e.to, (indeg.get(e.to) || 0) + 1); out.get(e.from)!.push(e.to) }
  const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id), order: string[] = []
  while (q.length) { const id = q.shift()!; order.push(id); for (const t of out.get(id)!) { indeg.set(t, indeg.get(t)! - 1); if (indeg.get(t) === 0) q.push(t) } }
  const os = new Set(order)
  return { order, cyclic: g.nodes.filter((n) => !os.has(n.id)).map((n) => n.id), out }
}

function reach(out: Map<string, string[]>, from: string) {
  const s = new Set<string>([from]), st = [from]
  while (st.length) for (const t of out.get(st.pop()!) || []) if (!s.has(t)) { s.add(t); st.push(t) }
  return s
}

/** 主线：从起点沿 main 标记（缺省取第一条）前进边走到结局 */
export function mainline(g: Graph) {
  const OUT = new Map<string, GEdge[]>(); for (const e of fwd(g)) { if (!OUT.has(e.from)) OUT.set(e.from, []); OUT.get(e.from)!.push(e) }
  const path: string[] = [], seen = new Set<string>(); let cur = g.start
  while (cur && !seen.has(cur)) {
    path.push(cur); seen.add(cur)
    const outs = OUT.get(cur); if (!outs?.length) break
    cur = (outs.find((e) => e.main) || outs[0]).to
  }
  return path
}

export function analyze(g: Graph, opt: { secPerClip?: number; pricePerSec?: number } = {}) {
  const issues: Issue[] = [], by = new Map(g.nodes.map((n) => [n.id, n]))
  const E = (code: string, msg: string, x: { node?: string; edge?: string } = {}) => issues.push({ level: 'error', code, msg, ...x })
  const W = (code: string, msg: string, x: { node?: string; edge?: string } = {}) => issues.push({ level: 'warn', code, msg, ...x })
  if (!g.nodes.length) { E('EMPTY', '结构图为空'); return { ok: false, issues, stats: null as any } }
  if (!by.has(g.start)) E('NO_START', '未指定起点')
  const { order, cyclic, out } = topo(g)
  if (cyclic.length) E('CYCLE', `前进边出现环（${cyclic.slice(0, 5).join('、')}）——想让剧情回到前面请用「回溯」边`, { node: cyclic[0] })
  const r = by.has(g.start) ? reach(out, g.start) : new Set<string>()
  const dcache = new Map<string, Set<string>>(), desc = (id: string) => { if (!dcache.has(id)) dcache.set(id, reach(out, id)); return dcache.get(id)! }
  const IN = new Map<string, GEdge[]>(), OUT = new Map<string, GEdge[]>(), BACK = new Map<string, GEdge[]>()
  for (const e of g.edges) { const m = e.kind === 'back' ? BACK : OUT; if (!m.has(e.from)) m.set(e.from, []); m.get(e.from)!.push(e); if (e.kind !== 'back') { if (!IN.has(e.to)) IN.set(e.to, []); IN.get(e.to)!.push(e) } }
  const inF = (id: string) => IN.get(id) || [], outF = (id: string) => OUT.get(id) || []
  for (const n of g.nodes) {
    if (!r.has(n.id)) E('UNREACHABLE', `「${n.title}」从起点无法到达`, { node: n.id })
    const o = outF(n.id), i = inF(n.id), backs = BACK.get(n.id) || []
    if (!n.title?.trim()) E('NO_TITLE', `节点 ${n.id} 缺少标题`, { node: n.id })
    if (n.type !== 'merge' && n.type !== 'ending' && !(n.beat || '').trim()) W('NO_BEAT', `「${n.title}」还没有剧情节拍`, { node: n.id })
    if (n.type === 'ending') {
      if (o.length) E('ENDING_OUT', `结局「${n.title}」不能再有出边（要延展剧情请先把它改成场景）`, { node: n.id })
    } else if (!o.length) E('DEAD_END', `「${n.title}」没有出路（需要连到下一节点或改成结局）`, { node: n.id })
    if (n.type === 'choice') {
      if (o.length < 2 || o.length > 4) E('CHOICE_ARITY', `博弈锚点「${n.title}」需要 2–4 个选项（当前 ${o.length}）`, { node: n.id })
      if (!(n.question || '').trim()) W('NO_QUESTION', `博弈锚点「${n.title}」缺少下注情境描述`, { node: n.id })
      for (const e of o) {
        if (!(e.label || '').trim()) E('NO_LABEL', `「${n.title}」有选项没有文案`, { node: n.id, edge: e.id })
        else if ([...e.label!].length > 8) W('LONG_LABEL', `选项「${e.label}」超过 8 字，手机端会折行`, { edge: e.id })
        if (e.label && QUESTION_RE.test(e.label)) W('QUESTION_LABEL', `选项「${e.label}」是问句，应写成动作（如「掀桌摊牌」）`, { edge: e.id })
      }
    }
    if ((n.type === 'scene' || n.type === 'merge') && o.length > 1) E('SCENE_FORK', `「${n.title}」有 ${o.length} 条出边——分叉必须放在博弈锚点上`, { node: n.id })
    if (n.type === 'merge' && i.length < 2) W('MERGE_SINGLE', `汇合节点「${n.title}」只有 ${i.length} 条入边，可改为普通场景`, { node: n.id })
    if (n.type === 'loop') {
      if (!backs.length) E('LOOP_NO_BACK', `时间裂隙「${n.title}」没有回溯边`, { node: n.id })
      if (!o.length) E('LOOP_NO_EXIT', `时间裂隙「${n.title}」没有前进出口，会无限回溯`, { node: n.id })
    }
    for (const b of backs) {
      if (n.type !== 'loop') E('BACK_SOURCE', `回溯边只能从「时间裂隙」节点发出（${n.title}）`, { edge: b.id })
      if (!desc(b.to).has(n.id)) E('BACK_TARGET', `回溯目标「${by.get(b.to)?.title}」不是「${n.title}」的上游`, { edge: b.id })
    }
  }
  const endings = g.nodes.filter((n) => n.type === 'ending')
  if (!endings.length) E('NO_ENDING', '至少需要一个结局')
  if (endings.length && !endings.some((n) => ['gold', 'platinum', 'diamond'].includes(n.tier!))) W('NO_PREMIUM', '没有黄金及以上结局，玩家缺少追求目标')
  // 路径数（前进 DAG 上 DP）
  let paths = 0, maxDepth = 0
  if (!cyclic.length && by.has(g.start)) {
    const cnt = new Map<string, number>(), dep = new Map<string, number>()
    for (const id of [...order].reverse()) {
      const o = out.get(id)!
      cnt.set(id, o.length ? Math.min(1e12, o.reduce((s, t) => s + (cnt.get(t) || 0), 0)) : by.get(id)?.type === 'ending' ? 1 : 0)
      dep.set(id, 1 + Math.max(0, ...o.map((t) => dep.get(t) || 0)))
    }
    paths = cnt.get(g.start) || 0; maxDepth = dep.get(g.start) || 0
  }
  if (paths > 5000) W('PATH_EXPLOSION', `路径数 ${paths}，建议增加汇合节点，控制审核与测试成本`)
  if (maxDepth > 16) W('TOO_DEEP', `最长路径 ${maxDepth} 个节点，单次游玩可能过长`)
  const main = mainline(g), mainSet = new Set(main)
  const sec = opt.secPerClip || 8, price = opt.pricePerSec || 0
  const clips = g.nodes.length
  const stats = {
    nodes: g.nodes.length, edges: g.edges.length,
    by_type: Object.fromEntries(TYPES.map((t) => [t, g.nodes.filter((n) => n.type === t).length])),
    endings_by_tier: Object.fromEntries(TIERS.map((t) => [t, endings.filter((n) => n.tier === t).length])),
    paths, max_depth: maxDepth, back_edges: g.edges.filter((e) => e.kind === 'back').length,
    mainline: main, main_clips: main.length, branch_clips: clips - main.length, clips,
    seconds: clips * sec, sec_per_clip: sec, est_cost: price ? +(clips * sec * price).toFixed(2) : null,
    // 汇合带来的“节省”：纯树结构下需要的片段数（每条路径各拍一遍）
    tree_clips: paths && !cyclic.length ? treeClips(g, out, by) : null
  }
  void mainSet
  return { ok: !issues.some((i) => i.level === 'error'), issues, stats }
}

/** 如果不做汇合、把 DAG 展开成树，需要拍多少个片段（用于展示汇合的成本价值） */
function treeClips(g: Graph, out: Map<string, string[]>, by: Map<string, GNode>) {
  const memo = new Map<string, number>()
  const f = (id: string): number => { if (memo.has(id)) return memo.get(id)!; const v = Math.min(1e12, 1 + (out.get(id) || []).reduce((s, t) => s + f(t), 0)); memo.set(id, v); return v }
  void by; return f(g.start)
}

/** 确定性修复（用于 AI 产出）：把常见结构错误改成合法形态，返回修复记录。人工编辑不自动修，只提示。 */
export function repair(g0: Graph) {
  const g = normalize(g0), fixes: string[] = [], by = new Map(g.nodes.map((n) => [n.id, n]))
  // 1) 前进边成环：DFS 找回边；若源是 choice/loop → 在它后面插入/改用「时间裂隙」回溯；否则删除
  const out = new Map<string, GEdge[]>(); for (const e of g.edges) if (e.kind !== 'back') { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from)!.push(e) }
  const color = new Map<string, number>(), cyc: GEdge[] = []
  const dfs = (u: string) => { color.set(u, 1); for (const e of out.get(u) || []) { const c = color.get(e.to) || 0; if (c === 1) cyc.push(e); else if (!c) dfs(e.to) } color.set(u, 2) }
  if (by.has(g.start)) dfs(g.start); for (const n of g.nodes) if (!color.get(n.id)) dfs(n.id)
  for (const e of cyc) {
    const src = by.get(e.from)!
    if (src.type === 'choice' && (out.get(src.id) || []).length >= 3) { e.kind = 'back'; e.max_uses = 1; src.type = 'loop'; fixes.push(`「${src.title}」的「${e.label || '回头'}」会让剧情回到前面，已改为时间裂隙回溯`) }
    else if (src.type === 'loop') { e.kind = 'back'; e.max_uses = 1; fixes.push(`「${src.title}」→「${by.get(e.to)?.title}」改为回溯边`) }
    else { g.edges = g.edges.filter((x) => x !== e); fixes.push(`删除成环的边「${src.title}」→「${by.get(e.to)?.title}」`) }
  }
  const outs = (id: string) => g.edges.filter((e) => e.from === id && e.kind !== 'back')
  const ins = (id: string) => g.edges.filter((e) => e.to === id && e.kind !== 'back')
  for (const n of g.nodes) {
    const o = outs(n.id)
    // 2) 场景/汇合分叉 → 改成博弈锚点（2–4 条），多于 4 条保留前 4 条
    if ((n.type === 'scene' || n.type === 'merge') && o.length > 1) {
      n.type = 'choice'; n.question = n.question || clip(n.beat, 30)
      for (const e of o) { e.kind = 'option'; if (!e.label) e.label = clip(by.get(e.to)?.title, 8) }
      if (o.length > 4) { g.edges = g.edges.filter((e) => !o.slice(4).includes(e)); }
      fixes.push(`「${n.title}」有 ${o.length} 条出路，已改为博弈锚点`)
    }
    // 3) 只有 1 个选项的锚点 → 场景
    if (n.type === 'choice' && o.length === 1) { n.type = 'scene'; delete n.question; o[0].kind = 'next'; delete o[0].label; delete o[0].hint; fixes.push(`「${n.title}」只有 1 个选项，已改为普通场景`) }
    // 4) 选项缺文案
    if (n.type === 'choice' || n.type === 'loop') for (const e of outs(n.id)) if (!e.label) { e.label = clip(by.get(e.to)?.title, 8) || '继续'; fixes.push(`为「${n.title}」补齐选项文案「${e.label}」`) }
    // 5) 结局有出边 → 改场景；非结局无出路 → 改结局
    if (n.type === 'ending' && o.length) { n.type = o.length > 1 ? 'choice' : 'scene'; delete n.tier; fixes.push(`「${n.title}」后面还有剧情，已从结局改为${n.type === 'choice' ? '锚点' : '场景'}`) }
    else if (n.type !== 'ending' && !o.length && !g.edges.some((e) => e.from === n.id)) { n.type = 'ending'; n.tier = n.tier || 'normal'; delete n.question; fixes.push(`「${n.title}」没有后续，已设为结局`) }
    // 6) 单入边汇合 → 场景
    if (n.type === 'merge' && ins(n.id).length < 2) { n.type = 'scene'; fixes.push(`「${n.title}」只有一条入边，已由汇合改为场景`) }
  }
  // 7) 结局分级：没有 gold+ 就把主线终点提为 gold；没有 bad 就把最后一个非主线结局设为 bad
  const endings = g.nodes.filter((n) => n.type === 'ending'), main = new Set(mainline(g))
  if (endings.length && !endings.some((n) => ['gold', 'platinum', 'diamond'].includes(n.tier!))) { const t = endings.find((n) => main.has(n.id)) || endings[0]; t.tier = 'gold'; fixes.push(`「${t.title}」提升为黄金结局`) }
  if (endings.length > 1 && !endings.some((n) => n.tier === 'bad')) { const t = [...endings].reverse().find((n) => !main.has(n.id) && n.tier === 'normal'); if (t) { t.tier = 'bad'; fixes.push(`「${t.title}」设为坏结局`) } }
  return { graph: normalize(g), fixes }
}

/** 分层自动排版：列 = 最长前进深度，行按父节点重心排序；only 指定时只给这些节点落位 */
export function layout(g: Graph, only?: Set<string>) {
  const { order, out } = topo(g), depth = new Map<string, number>()
  for (const id of order) for (const t of out.get(id)!) depth.set(t, Math.max(depth.get(t) || 0, (depth.get(id) || 0) + 1))
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, 0)
  const cols = new Map<number, string[]>()
  const placed = new Set<string>()
  for (const id of order.concat(g.nodes.map((n) => n.id))) { if (placed.has(id)) continue; placed.add(id); const d = depth.get(id)!; if (!cols.has(d)) cols.set(d, []); cols.get(d)!.push(id) }
  const pos = new Map<string, number>(), parents = new Map<string, string[]>()
  for (const e of fwd(g)) { if (!parents.has(e.to)) parents.set(e.to, []); parents.get(e.to)!.push(e.from) }
  const W = 250, H = 120
  for (const d of [...cols.keys()].sort((a, b) => a - b)) {
    const ids = cols.get(d)!
    ids.sort((a, b) => bary(a) - bary(b))
    ids.forEach((id, i) => pos.set(id, i - (ids.length - 1) / 2))
    function bary(id: string) { const ps = parents.get(id) || []; return ps.length ? ps.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / ps.length : 0 }
  }
  for (const n of g.nodes) if (!only || only.has(n.id) || n.x === undefined || n.y === undefined) { n.x = 40 + depth.get(n.id)! * W; n.y = 360 + Math.round(pos.get(n.id)! * H) }
  return g
}

/** 精简表示，喂给模型（节省 token，同时让模型只看到它需要的东西） */
export function compact(g: Graph) {
  return {
    start: g.start,
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, title: n.title, beat: (n.beat || '').slice(0, 80), ...(n.question ? { question: n.question } : {}), ...(n.tier ? { tier: n.tier } : {}) })),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, ...(e.label ? { label: e.label } : {}) }))
  }
}

export function ancestors(g: Graph, id: string) {
  const inn = new Map<string, string[]>(); for (const e of fwd(g)) { if (!inn.has(e.to)) inn.set(e.to, []); inn.get(e.to)!.push(e.from) }
  return [...reach(inn, id)].filter((x) => x !== id)
}

/** 把 AI 给的新节点并入现有图：新 id 统一改名避免冲突；允许新边连到已有节点（= 汇合） */
export function mergeInto(g: Graph, add: { nodes?: any[]; edges?: any[] }, prefix = 'n') {
  const used = new Set(g.nodes.map((n) => n.id)), ren = new Map<string, string>(); let k = g.nodes.length
  const fresh = () => { let id; do id = prefix + ++k; while (used.has(id)); used.add(id); return id }
  const newIds = new Set<string>()
  for (const n of add.nodes || []) { const nid = fresh(); ren.set(String(n.id), nid); newIds.add(nid); g.nodes.push({ ...n, id: nid, x: undefined, y: undefined } as any) }
  for (const e of add.edges || []) g.edges.push({ ...e, id: '', from: ren.get(String(e.from)) || String(e.from), to: ren.get(String(e.to)) || String(e.to) } as any)
  const out = normalize(g); return { graph: out, newIds }
}
