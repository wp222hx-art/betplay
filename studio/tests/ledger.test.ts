// 剧情账本单元测试：npx tsx studio/tests/ledger.test.ts
import * as G from '../src/lib/graph'
import * as L from '../src/lib/ledger'
let pass = 0, fail = 0
const ok = (n: string, c: any, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
const codes = (is: L.DocIssue[]) => is.map((i) => i.code)

// s → c1 →(a | b) → m → e
const g = G.normalize({ start: 's', nodes: [{ id: 's', type: 'scene', title: '开局', beat: 'x' }, { id: 'c1', type: 'choice', title: '下注', beat: 'x' }, { id: 'a', type: 'scene', title: '全押', beat: 'x' }, { id: 'b', type: 'scene', title: '弃牌', beat: 'x' }, { id: 'm', type: 'merge', title: '汇合', beat: 'x' }, { id: 'e', type: 'ending', title: '终', tier: 'gold' }],
  edges: [{ from: 's', to: 'c1' }, { from: 'c1', to: 'a', label: '全押', main: true }, { from: 'c1', to: 'b', label: '弃牌' }, { from: 'a', to: 'm' }, { from: 'b', to: 'm' }, { from: 'm', to: 'e' }] })
const sc = (sets: L.Fact[], requires: L.Fact[] = [], cast = ['hero']) => L.normScript({ summary: 's', beats: [{ action: 'a' }, { action: 'b' }], cast, sets, requires, cliff: 'c' })
const docs = new Map<string, L.ScriptDoc>([
  ['s', sc([{ key: 'costume.hero', value: 'black suit' }, { key: 'loc', value: 'casino' }])],
  ['c1', sc([])],
  ['a', sc([{ key: 'injury.hero', value: 'cut on cheek' }, { key: 'know.hero.cheat', value: '庄家出千' }])],
  ['b', sc([{ key: 'know.hero.cheat', value: '庄家出千' }, { key: 'prop.hero', value: 'marked card' }])],
  ['m', sc([])]
])
const { entry } = L.propagate(g, docs)
const em = entry.get('m')!
ok('两条路都成立的事实 → 确定', em['know.hero.cheat']?.firm === true && em['costume.hero']?.firm === true)
ok('只在一条路成立的事实 → 不确定', em['injury.hero']?.firm === false && em['prop.hero']?.firm === false)
ok('不确定事实记录各路取值', (em['injury.hero'].vals || []).includes('∅'))
const mNode = g.nodes.find((n) => n.id === 'm')!, cast = new Set(['hero', 'boss'])
ok('汇合后依赖确定事实 → 通过', !codes(L.checkScript(sc([], [{ key: 'know.hero.cheat', value: '庄家出千' }]), em, mNode, cast)).some((c) => c.startsWith('LEDGER')))
ok('汇合后依赖不确定事实 → LEDGER_VARIES', codes(L.checkScript(sc([], [{ key: 'injury.hero', value: 'cut on cheek' }]), em, mNode, cast)).includes('LEDGER_VARIES'))
ok('依赖从未建立的事实 → LEDGER_MISSING', codes(L.checkScript(sc([], [{ key: 'know.hero.boss_secret', value: 'x' }]), em, mNode, cast)).includes('LEDGER_MISSING'))
ok('与账本值冲突 → LEDGER_CONFLICT', codes(L.checkScript(sc([], [{ key: 'costume.hero', value: 'red dress' }]), em, mNode, cast)).includes('LEDGER_CONFLICT'))
ok('宽松匹配（包含关系）不算冲突', !codes(L.checkScript(sc([], [{ key: 'costume.hero', value: 'Black Suit' }]), em, mNode, cast)).includes('LEDGER_CONFLICT'))
ok('未知角色 → UNKNOWN_CAST', codes(L.checkScript(sc([], [], ['ghost']), em, mNode, cast)).includes('UNKNOWN_CAST'))
ok('服装不确定的角色出场 → NO_COSTUME 警告', codes(L.checkScript(sc([], [], ['boss']), em, mNode, cast)).includes('NO_COSTUME'))
ok('value=null 移除事实', !L.apply(em, [{ key: 'costume.hero', value: null }])['costume.hero'])
ok('汇合节点 sets 可以重新统一不确定事实', L.apply(em, [{ key: 'injury.hero', value: 'bandaged' }])['injury.hero'].firm === true)
const d2 = new Map(docs); d2.delete('a')
ok('上游缺剧本 → 下游入场状态为 null（等待）', L.propagate(g, d2).entry.get('m') === null && L.propagate(g, d2).entry.get('b') !== null)

// 指纹
const bh = 'bible1', n = g.nodes.find((x) => x.id === 'm')!
const h1 = L.scriptHash(n, g, em, bh)
ok('指纹稳定（键顺序无关）', h1 === L.scriptHash(n, g, JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(em).reverse()))), bh))
ok('上游账本变化 → 指纹变化', h1 !== L.scriptHash(n, g, L.apply(em, [{ key: 'loc', value: 'rooftop' }]), bh))
ok('无关节点改标题 → 指纹不变', (() => { const g2 = JSON.parse(JSON.stringify(g)); g2.nodes.find((x: any) => x.id === 'e').title = '改名'; return L.scriptHash(n, G.normalize(g2), em, bh) === h1 })())
ok('出边选项文案变化 → 指纹变化（锚点）', (() => { const c1 = g.nodes.find((x) => x.id === 'c1')!, e1 = entry.get('c1')!, a = L.scriptHash(c1, g, e1, bh); const g2 = JSON.parse(JSON.stringify(g)); g2.edges.find((x: any) => x.label === '弃牌').label = '掀桌'; return a !== L.scriptHash(c1, G.normalize(g2), e1, bh) })())

// 视频模式
const main = G.mainline(g), modes = L.videoModes(g, main)
ok('主线节点 → 参考图模式', main.every((id) => modes.get(id)!.mode === 'reference'))
ok('单前驱分支 → 尾帧接力', modes.get('b')!.mode === 'frames' && modes.get('b')!.from === 'c1')
const chain = G.normalize({ start: 'r', nodes: [{ id: 'r', type: 'choice', title: 'r' }, { id: 'x0', type: 'ending', title: 'm', tier: 'gold' }, ...[1, 2, 3, 4, 5].map((i) => ({ id: 'k' + i, type: 'scene', title: 'k' })), { id: 'z', type: 'ending', title: 'z' }], edges: [{ from: 'r', to: 'x0', label: 'a', main: true }, { from: 'r', to: 'k1', label: 'b' }, { from: 'k1', to: 'k2' }, { from: 'k2', to: 'k3' }, { from: 'k3', to: 'k4' }, { from: 'k4', to: 'k5' }, { from: 'k5', to: 'z' }] })
const cm = L.videoModes(chain, G.mainline(chain))
ok('连续尾帧接力 3 段后重新参考图校准', cm.get('k3')!.mode === 'frames' && cm.get('k4')!.mode === 'reference' && cm.get('k5')!.mode === 'frames', ['k1', 'k2', 'k3', 'k4', 'k5'].map((k) => cm.get(k)!.mode[0]).join(''))
const dm = L.videoModes(G.normalize({ start: 'c', nodes: [{ id: 'c', type: 'choice', title: 'c' }, { id: 'p', type: 'scene', title: 'p' }, { id: 'q', type: 'scene', title: 'q' }, { id: 'mm', type: 'merge', title: 'm' }, { id: 'e', type: 'ending', title: 'e' }], edges: [{ from: 'c', to: 'p', label: '1', main: true }, { from: 'c', to: 'q', label: '2' }, { from: 'p', to: 'e' }, { from: 'q', to: 'mm' }, { from: 'p', to: 'mm' }] }), ['c', 'p', 'e'])
ok('汇合节点（多前驱）→ 参考图', dm.get('mm')!.mode === 'reference')

// 连贯性附录：确定性写入服装/伤痕/地点，排除不确定
const ap = L.continuityAppendix(em, [], [{ id: 'hero', look: 'tall man' }], ['hero'])
ok('附录写入确定服装与地点', ap.includes('wearing black suit') && ap.includes('casino'))
ok('附录不写入不确定伤痕', !ap.includes('cut on cheek'))
ok('附录禁止字幕', /No on-screen text/.test(ap))
ok('ledgerText 区分确定/不确定', L.ledgerText(em).includes('【不确定事实') && L.ledgerText(em).includes('injury.hero ∈'))

// 规模：1000 节点链+汇合推演 < 100ms
const big: any = { start: 'c0', nodes: [], edges: [] }; const bd = new Map<string, L.ScriptDoc>()
for (let i = 0; i < 250; i++) { for (const k of ['c', 'l', 'r', 'm']) { big.nodes.push({ id: k + i, type: k === 'c' ? 'choice' : k === 'm' ? 'merge' : 'scene', title: k }); bd.set(k + i, sc([{ key: `world.k${i % 40}`, value: k + i }])) } big.edges.push({ from: 'c' + i, to: 'l' + i, label: 'L' }, { from: 'c' + i, to: 'r' + i, label: 'R' }, { from: 'l' + i, to: 'm' + i }, { from: 'r' + i, to: 'm' + i }, { from: 'm' + i, to: i < 249 ? 'c' + (i + 1) : 'end' }) }
big.nodes.push({ id: 'end', type: 'ending', title: 'e', tier: 'gold' })
const bg = G.normalize(big), t0 = performance.now(); const pr = L.propagate(bg, bd); const ms = performance.now() - t0
ok('1001 节点账本推演 < 150ms', ms < 150, `${ms | 0}ms`)
ok('汇合后同键不同值 → 不确定', pr.entry.get('m5')!['world.k5']?.firm === false)
const td = L.tidyScript(sc([{ key: 'loc', value: 'bar' }], [{ key: 'time', value: 'night' }, { key: 'loc', value: 'bar' }]), true)
ok('起点 requires 转为 sets', !td.requires.length && td.sets.some((f) => f.key === 'time'))
ok('非起点：自己 sets 的键不算依赖', L.tidyScript(sc([{ key: 'loc', value: 'bar' }], [{ key: 'loc', value: 'bar' }, { key: 'time', value: 'x' }]), false).requires.map((f) => f.key).join() === 'time')
// 二次汇合：上游不确定（部分路径没有）+ 另一路确定同值 → 仍不确定，且保留「无」
const m2 = L.merge([{ x: { v: 'A', firm: false, vals: ['A', '∅'] } }, { x: { v: 'A', firm: true } }])
ok('二次汇合保留「无」的可能', m2.x.firm === false && m2.x.vals!.includes('∅') && m2.x.vals!.length === 2)
ok('各路同一确定值 → 确定', L.merge([{ x: { v: 'A', firm: true } }, { x: { v: 'A', firm: true } }]).x.firm === true)
const ini = L.initialState({ cast: [{ id: 'hero', look: 'black suit' }, { id: 'boss' }] })
ok('初始账本含角色基线服装', ini['costume.hero']?.firm && !ini['costume.boss'])
{ const e0 = L.apply(ini, [{ key: 'prop.hero', value: 'gun' }]); const a2 = L.continuityAppendix(e0, [{ key: 'injury.hero', value: 'unconscious, oxygen mask' }, { key: 'prop.hero', value: 'broken bracelet' }, { key: 'loc', value: 'rooftop' }], [{ id: 'hero', look: 'black suit' }], ['hero'])
  ok('附录不提前写入本段结尾的伤痕/道具（用入场状态）', !a2.includes('oxygen mask') && !a2.includes('broken bracelet') && a2.includes('holding gun') && a2.includes('rooftop'), a2) }
ok('附录：服装与外貌相同不重复', !L.continuityAppendix(ini, [], [{ id: 'hero', look: 'black suit' }], ['hero']).includes('now wearing'))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
