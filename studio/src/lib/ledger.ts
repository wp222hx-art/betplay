// 剧情账本（纯函数，可单测）：把「服装 / 道具 / 伤痕 / 已知信息 / 关系 / 地点 / 时间」作为键值事实，沿结构图（DAG）逐节点推演。
//   入场状态 = 所有前驱节点离场状态的合并：各路径一致 → firm（确定）；不一致或部分路径没有 → varies（不确定，剧本不得依赖）
//   离场状态 = 入场状态 ⊕ 本节点 sets（value=null 表示移除）
//   回溯边（back）不参与推演：时间裂隙回到的节点使用它原本的入场状态
// 指纹：src_hash = 节点定义 + 出入边 + 世界观 + 入场状态 → 只有真正影响本节点的上游变化才会让它过期，避免无意义的级联重做
import type { GEdge, GNode, Graph } from './graph'

export type Fact = { key: string; value: string | null }
export type Entry = { v: string; firm: boolean; vals?: string[] }
export type State = Record<string, Entry>
export type ScriptDoc = {
  summary: string; location?: string; time?: string; mood?: string
  beats: { who?: string; action: string; line?: string }[]
  cliff?: string; duration?: number; cast: string[]
  requires: Fact[]; sets: Fact[]
}
export type DocIssue = { level: 'error' | 'warn'; code: string; msg: string }

export const KEY_RE = /^(costume|prop|injury|know|rel|loc|time|world)(\.[\w-]{1,24}){0,3}$/
export const KEY_HELP = `账本键格式：costume.<角色id>（服装，英文）/ prop.<角色id>（手持道具，英文）/ injury.<角色id>（伤痕，英文）/ know.<角色id>.<话题>（知道的秘密，中文）/ rel.<角色a>.<角色b>（关系，中文）/ loc（地点，英文）/ time（时间，英文）/ world.<话题>（世界事实，中文）`

export function fnv(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return (h >>> 0).toString(36) }
export const stable = (o: any): string => (o === null || typeof o !== 'object' ? JSON.stringify(o) : Array.isArray(o) ? `[${o.map(stable).join(',')}]` : `{${Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',')}}`)

const clip = (s: any, n: number) => String(s ?? '').trim().slice(0, n)

/** 清洗 SCRIPT Agent / 人工编辑的剧本文档 */
export function normScript(d: any): ScriptDoc {
  const facts = (a: any) => (Array.isArray(a) ? a : []).map((f: any) => ({ key: clip(f?.key, 60).replace(/\s+/g, ''), value: f?.value === null || f?.value === undefined || f?.value === '' ? null : clip(f.value, 120) })).filter((f: Fact) => f.key).slice(0, 24)
  return {
    summary: clip(d?.summary, 160), location: clip(d?.location, 60), time: clip(d?.time, 40), mood: clip(d?.mood, 40),
    beats: (Array.isArray(d?.beats) ? d.beats : []).map((b: any) => ({ who: clip(b?.who, 24) || undefined, action: clip(b?.action, 120), line: clip(b?.line, 60) || undefined })).filter((b: any) => b.action).slice(0, 8),
    cliff: clip(d?.cliff, 120), duration: [5, 8, 10].includes(+d?.duration) ? +d.duration : 8,
    cast: [...new Set((Array.isArray(d?.cast) ? d.cast : []).map((c: any) => clip(c, 24)).filter(Boolean))].slice(0, 6) as string[],
    requires: facts(d?.requires).filter((f: Fact) => f.value !== null || true), sets: facts(d?.sets)
  }
}

export function preds(g: Graph) {
  const p = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]))
  for (const e of g.edges) if (e.kind !== 'back') p.get(e.to)?.push(e.from)
  return p
}
export function topoOrder(g: Graph) {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0])), out = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]))
  for (const e of g.edges) if (e.kind !== 'back') { indeg.set(e.to, (indeg.get(e.to) || 0) + 1); out.get(e.from)?.push(e.to) }
  const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id), order: string[] = [], level = new Map<string, number>()
  for (const id of q) level.set(id, 0)
  while (q.length) { const id = q.shift()!; order.push(id); for (const t of out.get(id)!) { level.set(t, Math.max(level.get(t) || 0, level.get(id)! + 1)); indeg.set(t, indeg.get(t)! - 1); if (indeg.get(t) === 0) q.push(t) } }
  return { order, level }
}

export function merge(states: State[]): State {
  if (!states.length) return {}
  if (states.length === 1) return { ...states[0] }
  const keys = new Set(states.flatMap((s) => Object.keys(s))), r: State = {}
  for (const k of keys) {
    // 每条来路展开成可能取值集合（不确定的上游保留它全部可能，包括「无」）
    const per = states.map((s) => (s[k] ? (s[k].firm ? [s[k].v] : s[k].vals || [s[k].v]) : ['∅']))
    const all = [...new Set(per.flat())]
    if (all.length === 1 && all[0] !== '∅') r[k] = { v: all[0], firm: true }
    else r[k] = { v: all.find((x) => x !== '∅') || '', firm: false, vals: all }
  }
  return r
}
export function apply(s: State, sets: Fact[]): State {
  const r: State = { ...s }
  for (const f of sets) { if (f.value === null) delete r[f.key]; else r[f.key] = { v: f.value, firm: true } }
  return r
}

/** 确定性整理：起点没有上游 → requires 视为本节点建立的事实；本节点自己 sets 的键不算依赖 */
export function tidyScript(d: ScriptDoc, isStart: boolean): ScriptDoc {
  if (isStart) { const keys = new Set(d.sets.map((f) => f.key)); return { ...d, sets: [...d.sets, ...d.requires.filter((f) => f.value !== null && !keys.has(f.key))], requires: [] } }
  const own = new Set(d.sets.map((f) => f.key)); return { ...d, requires: d.requires.filter((f) => !own.has(f.key)) }
}

/** 初始账本：第 2 步角色卡的外貌/服装作为全剧基线（costume.<id>），分支里换装才会产生不确定 */
export function initialState(bible: any): State {
  const st: State = {}
  for (const c of bible?.cast || []) if (c?.id && c?.look) st[`costume.${c.id}`] = { v: String(c.look).slice(0, 120), firm: true }
  return st
}

/** 沿图推演整本账：返回每个节点的入场 / 离场状态（缺剧本的节点离场状态 = null，其后代入场状态不可用） */
export function propagate(g: Graph, scripts: Map<string, ScriptDoc>, initial: State = {}) {
  const { order } = topoOrder(g), P = preds(g), entry = new Map<string, State | null>(), exit = new Map<string, State | null>()
  for (const id of order) {
    const ps = P.get(id) || []
    let en: State | null
    if (!ps.length) en = { ...initial }
    else { const xs = ps.map((p) => exit.get(p)); en = xs.some((x) => !x) ? null : merge(xs as State[]) }
    entry.set(id, en)
    const sc = scripts.get(id)
    exit.set(id, en && sc ? apply(en, sc.sets) : null)
  }
  return { entry, exit, order }
}

const loose = (a: string, b: string) => { const x = a.toLowerCase().replace(/\s+/g, ''), y = b.toLowerCase().replace(/\s+/g, ''); return !y || x === y || x.includes(y) || y.includes(x) }

/** 确定性连贯检查（剧本层）：依赖的事实必须在所有到达路径上都成立 */
export function checkScript(doc: ScriptDoc, entry: State, node: GNode, castIds: Set<string>, g?: Graph): DocIssue[] {
  const is: DocIssue[] = []
  const E = (code: string, msg: string) => is.push({ level: 'error', code, msg }), W = (code: string, msg: string) => is.push({ level: 'warn', code, msg })
  if (!doc.summary) E('NO_SUMMARY', '缺少剧情概要')
  if (node.type !== 'merge' && doc.beats.length < 2) E('FEW_BEATS', '剧情节拍少于 2 条')
  for (const c of doc.cast) if (!castIds.has(c)) E('UNKNOWN_CAST', `出场角色「${c}」不在角色表里`)
  for (const b of doc.beats) { if (b.who && !castIds.has(b.who)) E('UNKNOWN_CAST', `节拍里的角色「${b.who}」不在角色表里`); if (b.who && !doc.cast.includes(b.who)) W('CAST_MISSING', `「${b.who}」有戏份但没列入出场角色`); if (b.line && [...b.line].length > 30) W('LONG_LINE', `台词「${b.line.slice(0, 12)}…」超过 30 字，画面里念不完`) }
  for (const f of [...doc.requires, ...doc.sets]) if (!KEY_RE.test(f.key)) W('BAD_KEY', `账本键「${f.key}」格式不规范`)
  for (const f of doc.requires) {
    const e = entry[f.key]
    if (!e) E('LEDGER_MISSING', `剧本依赖「${f.key}${f.value ? '=' + f.value : ''}」，但上游从未建立这个事实`)
    else if (!e.firm) E('LEDGER_VARIES', `剧本依赖「${f.key}」，但它只在部分路径成立（${(e.vals || []).map((v) => v === '∅' ? '无' : v).join(' / ')}）——汇合后的剧情不能假定它`)
    else if (f.value && !loose(e.v, f.value)) E('LEDGER_CONFLICT', `剧本认为「${f.key}=${f.value}」，账本记录是「${e.v}」`)
  }
  // 出场角色的服装必须在账本里确定（或本节点设置），否则视频无法保证一致
  for (const c of doc.cast) { const k = `costume.${c}`; if (!doc.sets.some((f) => f.key === k) && !(entry[k]?.firm)) W('NO_COSTUME', `「${c}」的服装在账本里不确定，建议本节点用 sets 写明（英文）`) }
  if (node.type === 'choice' && !doc.cliff) W('NO_CLIFF', '博弈锚点缺少「抉择前一刻」的悬念画面')
  if (g && node.type === 'choice') {
    const labels = g.edges.filter((e) => e.from === node.id && e.kind !== 'back').map((e) => e.label).filter(Boolean)
    if (labels.length && !labels.some((l) => (doc.cliff + doc.summary + doc.beats.map((b) => b.action).join('')).includes(String(l).slice(0, 2)))) W('CHOICE_SETUP', `剧本没有铺垫任何一个选项（${labels.join(' / ')}）`)
  }
  return is
}

/** 节点剧本的依赖指纹 */
export function scriptHash(node: GNode, g: Graph, entry: State | null, bibleHash: string) {
  const ins = g.edges.filter((e) => e.to === node.id && e.kind !== 'back').map((e) => `${e.from}:${e.label || ''}`).sort()
  const outs = g.edges.filter((e) => e.from === node.id).map((e) => `${e.kind}:${e.to}:${e.label || ''}:${e.hint || ''}`).sort()
  return fnv(stable({ n: { t: node.type, ti: node.title, b: node.beat, q: node.question, tier: node.tier, c: node.cast }, ins, outs, entry, bibleHash }))
}

/** 视频生成模式：主线用参考图锁人物；单前驱分支接上一段尾帧；汇合节点或连续 3 段尾帧接力后重新用参考图校准 */
export function videoModes(g: Graph, mainline: string[]) {
  const main = new Set(mainline), P = preds(g), { order } = topoOrder(g), mode = new Map<string, { mode: 'reference' | 'frames'; from?: string; chain: number; why: string }>()
  for (const id of order) {
    const ps = P.get(id) || []
    if (main.has(id) || !ps.length) { mode.set(id, { mode: 'reference', chain: 0, why: main.has(id) ? '主线：参考图锁定人物' : '起点' }); continue }
    if (ps.length > 1) { mode.set(id, { mode: 'reference', chain: 0, why: `汇合（${ps.length} 条入路）：无法唯一接帧，改用参考图` }); continue }
    const up = mode.get(ps[0])!, chain = up.chain + 1
    if (chain > 3) mode.set(id, { mode: 'reference', chain: 0, why: '连续尾帧接力 3 段，重新用参考图校准人物' })
    else mode.set(id, { mode: 'frames', from: ps[0], chain, why: `接「${ps[0]}」的尾帧作为首帧` })
  }
  return mode
}

/** 由账本确定性地拼出视频提示词的「连贯性附录」——服装/伤痕/道具/地点不交给模型自由发挥 */
export function continuityAppendix(entry: State, sets: Fact[], cast: { id: string; name?: string; look?: string }[], castIds: string[]) {
  // 附录描述的是「片段开场」：地点/时间/服装取本节点设定；伤痕/道具多为本段剧情的结果（结尾状态），
  // 若写进附录会让角色第一帧就是结尾模样（如刚受伤却已戴氧气面罩）→ 取入场状态，由正文描述变化过程
  const st = apply(entry, sets.filter((f) => /^(costume|loc|time)\b/.test(f.key)))
  const firm = (k: string) => (st[k]?.firm ? st[k].v : '')
  const people = castIds.map((id) => {
    const c = cast.find((x) => x.id === id); if (!c) return ''
    const cos = firm(`costume.${id}`), bits = [c.look, cos && cos !== String(c.look || '').slice(0, 120) && `now wearing ${cos}`, firm(`injury.${id}`) && `visible ${firm(`injury.${id}`)}`, firm(`prop.${id}`) && `holding ${firm(`prop.${id}`)}`].filter(Boolean)
    return `${id}: ${bits.join(', ')}`
  }).filter(Boolean)
  const place = [firm('loc'), firm('time')].filter(Boolean).join(', ')
  return [people.length ? `Characters — ${people.join('; ')}.` : '', place ? `Setting — ${place}.` : '', 'Keep every character\'s face, hairstyle and outfit identical to the reference. No on-screen text, no subtitles, no captions, no watermark.'].filter(Boolean).join(' ')
}

/** 给模型看的账本（确定 / 不确定分开写） */
export function ledgerText(st: State | null, max = 60) {
  if (!st) return '（上游未完成）'
  const ks = Object.keys(st).sort().slice(0, max)
  const firm = ks.filter((k) => st[k].firm).map((k) => `${k} = ${st[k].v}`)
  const vary = ks.filter((k) => !st[k].firm).map((k) => `${k} ∈ {${(st[k].vals || []).map((v) => (v === '∅' ? '无' : v)).join(' | ')}}`)
  return `【确定事实】\n${firm.join('\n') || '（无）'}\n【不确定事实——因路径不同而不同，不得依赖或当作已知】\n${vary.join('\n') || '（无）'}`
}

export type { GEdge }
