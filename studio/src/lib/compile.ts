// P5 编译器（纯函数，可单测）：Studio 结构图 → 玩家端对弈引擎 DATA
//
// 两边的模型不同：
//   Studio：每个节点 = 1 段视频；节点类型 scene / choice / merge / loop / ending；边 next / option / back
//   玩家端：只有「抉择点」（nodes，每个有 2–4 个下注选项）；选中一个选项 → 播放该选项的「片段」segment → 进入下一个抉择点或结局
//
// 翻译规则：
//   · 序章 P = 从起点沿 scene/merge 一路走到第一个抉择点（含抉择点自己的视频：它以悬念收尾，正好接下注面板）
//   · 抉择点的每条选项边 → 一个玩家端选项；其片段 = 从目标节点沿 scene/merge 走到下一个抉择点或结局（多段视频拼接）
//   · 汇合节点会出现在多个选项的片段里（同一段视频复用，不需要重拍）
//   · 时间裂隙 loop（≥2 个前进选项）= 抉择点 + fork：悔棋时可选「时间裂隙」→ 播放回溯目标起的片段 → 回到那个抉择点（平行时间线）
//   · 结局等级 bad/normal/gold/platinum/diamond 写进选项 ending_tier（结局卡展示用）；押注命运等级仍由引擎按真实押注判定
import type { Graph, GNode, GEdge } from './graph'

export type Part = { node: string; title: string }
export type SegPlan = { id: string; title: string; parts: Part[]; kind: 'prologue' | 'option' | 'fork' }
export type EngineOption = { id: string; key: string; label: string; hint: string; weight: number; category: string; next?: string; ending_title?: string; ending_tier?: string; ending_node?: string }
export type EngineNode = { id: string; depth: number; question: string; title: string; options: EngineOption[]; fork?: { node: string; seg: string; label: string; desc: string } }
export type CompileIssue = { level: 'error' | 'warn'; code: string; msg: string; node?: string }
export type Plan = { prologue: string[]; nodes: EngineNode[]; segments: Record<string, SegPlan>; issues: CompileIssue[]; stats: { decisions: number; options: number; endings: number; segments: number; clips_used: number; clips_reused: number; unused: string[] } }

const DECISION = (n: GNode | undefined, fwdCount: number) => !!n && (n.type === 'choice' || (n.type === 'loop' && fwdCount >= 2))
const segId = (s: string) => s.replace(/[^\w-]/g, '_').slice(0, 40)

export function compile(g: Graph): Plan {
  const by = new Map(g.nodes.map((n) => [n.id, n]))
  const OUT = new Map<string, GEdge[]>(), BACK = new Map<string, GEdge[]>()
  for (const e of g.edges) { const m = e.kind === 'back' ? BACK : OUT; if (!m.has(e.from)) m.set(e.from, []); m.get(e.from)!.push(e) }
  const outF = (id: string) => OUT.get(id) || []
  const isDecision = (id: string) => DECISION(by.get(id), outF(id).length)
  const issues: CompileIssue[] = []
  const segments: Record<string, SegPlan> = {}
  const used = new Map<string, number>()

  /** 从 id 出发沿「非抉择」节点前进，直到抉择点或结局（都包含在片段内） */
  function chain(from: string) {
    const parts: Part[] = [], seen = new Set<string>()
    let cur: string | undefined = from
    while (cur && !seen.has(cur)) {
      seen.add(cur); const n = by.get(cur); if (!n) break
      parts.push({ node: n.id, title: n.title })
      if (n.type === 'ending' || isDecision(cur)) return { parts, stop: n }
      if (n.type === 'loop') issues.push({ level: 'warn', code: 'LOOP_PASSTHRU', msg: `时间裂隙「${n.title}」只有 1 个前进选项，玩家端按普通场景播放（不提供裂隙回溯）`, node: n.id })
      const o = outF(cur)
      if (o.length !== 1) { issues.push({ level: 'error', code: 'CHAIN_FORK', msg: `「${n.title}」有 ${o.length} 条出边，但不是博弈锚点`, node: n.id }); return { parts, stop: null } }
      cur = o[0].to
    }
    issues.push({ level: 'error', code: 'CHAIN_CYCLE', msg: `从「${by.get(from)?.title || from}」前进时出现环`, node: from })
    return { parts, stop: null as GNode | null }
  }
  const addSeg = (id: string, title: string, parts: Part[], kind: SegPlan['kind']) => { segments[id] = { id, title, parts, kind }; for (const p of parts) used.set(p.node, (used.get(p.node) || 0) + 1) }

  const nodes: EngineNode[] = []
  const pro = chain(g.start)
  addSeg('P', by.get(g.start)?.title || '序章', pro.parts, 'prologue')
  if (!pro.stop || pro.stop.type === 'ending') {
    issues.push({ level: 'error', code: 'NO_DECISION', msg: pro.stop ? `从起点直接走到结局「${pro.stop.title}」，中间没有任何博弈锚点——玩家无处下注` : '序章无法走到第一个博弈锚点' })
    return finish()
  }
  // BFS：抉择点深度 = 离序章的抉择次数（引擎要求唯一的 depth=1 根节点）
  const depth = new Map<string, number>([[pro.stop.id, 1]]), queue = [pro.stop.id], order: string[] = []
  while (queue.length) {
    const id = queue.shift()!; if (order.includes(id)) continue; order.push(id)
    for (const e of outF(id)) { const c = chain(e.to); if (c.stop && c.stop.type !== 'ending' && !depth.has(c.stop.id)) { depth.set(c.stop.id, depth.get(id)! + 1); queue.push(c.stop.id) } }
    for (const b of BACK.get(id) || []) { const c = chain(b.to); if (c.stop && c.stop.type !== 'ending' && !depth.has(c.stop.id)) { depth.set(c.stop.id, depth.get(id)! + 1); queue.push(c.stop.id) } }
  }
  for (const id of order) {
    const n = by.get(id)!, outs = outF(id), w = Math.round((1 / outs.length) * 100) / 100
    const en: EngineNode = { id, depth: depth.get(id)!, title: n.title, question: n.question || n.title, options: [] }
    outs.forEach((e, i) => {
      const c = chain(e.to), sid = segId('o_' + e.id), tgt = by.get(e.to)
      addSeg(sid, tgt?.title || e.label || '', c.parts, 'option')
      const o: EngineOption = { id: sid, key: String.fromCharCode(65 + i), label: e.label || tgt?.title || `选项${i + 1}`, hint: e.hint || '', weight: w, category: 'story' }
      if (c.stop?.type === 'ending') { o.ending_title = c.stop.title; o.ending_tier = c.stop.tier || 'normal'; o.ending_node = c.stop.id }
      else if (c.stop) o.next = c.stop.id
      en.options.push(o)
    })
    const backs = BACK.get(id) || []
    if (backs.length) {
      const b = backs[0], c = chain(b.to)
      if (c.stop && c.stop.type !== 'ending') { const fk = segId('k_' + b.id); addSeg(fk, `⟲ ${by.get(b.to)?.title || ''}`, c.parts, 'fork'); en.fork = { node: c.stop.id, seg: fk, label: '时间裂隙', desc: n.beat || '世界察觉了你的悔棋——一条平行时间线被撕开' } }
      else issues.push({ level: 'warn', code: 'FORK_NO_DECISION', msg: `「${n.title}」的回溯目标之后没有博弈锚点，玩家端不提供裂隙回溯`, node: id })
      if (backs.length > 1) issues.push({ level: 'warn', code: 'FORK_MULTI', msg: `「${n.title}」有 ${backs.length} 条回溯边，玩家端只用第一条`, node: id })
    }
    nodes.push(en)
  }
  return finish()

  function finish(): Plan {
    const endings = nodes.flatMap((n) => n.options.filter((o) => !o.next))
    if (nodes.length && endings.length < 2) issues.push({ level: 'error', code: 'FEW_ENDINGS', msg: `玩家端只有 ${endings.length} 个结局，至少需要 2 个` })
    for (const n of nodes) if (n.options.length < 2) issues.push({ level: 'error', code: 'ARITY', msg: `抉择点「${n.title}」只有 ${n.options.length} 个选项`, node: n.id })
    const unused = g.nodes.filter((n) => !used.has(n.id)).map((n) => n.id)
    if (unused.length) issues.push({ level: 'warn', code: 'UNUSED', msg: `${unused.length} 个节点的视频不会出现在玩家端（${unused.slice(0, 5).join('、')}）` })
    return { prologue: ['P'], nodes, segments, issues, stats: { decisions: nodes.length, options: nodes.reduce((a, n) => a + n.options.length, 0), endings: endings.length, segments: Object.keys(segments).length, clips_used: used.size, clips_reused: [...used.values()].filter((v) => v > 1).length, unused } }
  }
}

/** 台词时间轴：按每段视频的真实时长，把该节点的台词均匀排进它在拼接片段里的时间窗 */
export function timeline(parts: { dur: number; lines: { speaker: string; text: string }[] }[]) {
  const out: { speaker: string; text: string; start: number; end: number }[] = []
  let off = 0
  for (const p of parts) {
    const n = p.lines.length, span = Math.max(0.5, p.dur - 1)
    p.lines.forEach((l, i) => { const s = off + 0.5 + (span * i) / n, e = Math.min(off + p.dur - 0.2, s + Math.min(3.2, span / n - 0.15)); out.push({ ...l, start: +s.toFixed(2), end: +Math.max(s + 0.6, e).toFixed(2) }) })
    off += p.dur
  }
  return out
}
