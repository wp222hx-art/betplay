// 结构图引擎单元测试：npx tsx studio/tests/graph.test.ts
import * as G from '../src/lib/graph'
let pass = 0, fail = 0
const ok = (n: string, c: any, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
const codes = (a: any) => a.issues.map((i: any) => i.code)

// 一个带汇合 + 回溯的合法图
const good = G.normalize({ start: 's', nodes: [
  { id: 's', type: 'scene', title: '开局', beat: '顾墨言走进地下赌场' },
  { id: 'c1', type: 'choice', title: '第一注', beat: '庄家发牌', question: '底牌未知，是否下注' },
  { id: 'a', type: 'scene', title: '激进线', beat: '全押' }, { id: 'b', type: 'scene', title: '保守线', beat: '观望' },
  { id: 'm', type: 'merge', title: '汇合：决战前夜', beat: '两条线都来到决战前夜' },
  { id: 'L', type: 'loop', title: '时间裂隙', beat: '他得到重来一次的机会', question: '要不要回到第一注' },
  { id: 'c2', type: 'choice', title: '终局', beat: '最后一手', question: '最后一手' },
  { id: 'e1', type: 'ending', title: '赢下一切', tier: 'diamond' }, { id: 'e2', type: 'ending', title: '满盘皆输', tier: 'bad' }, { id: 'e3', type: 'ending', title: '全身而退', tier: 'normal' }
], edges: [
  { from: 's', to: 'c1' }, { from: 'c1', to: 'a', label: '全部押上', main: true }, { from: 'c1', to: 'b', label: '按兵不动' },
  { from: 'a', to: 'm' }, { from: 'b', to: 'm' }, { from: 'm', to: 'L' },
  { from: 'L', to: 'c2', label: '继续前进' }, { from: 'L', to: 'c1', kind: 'back' },
  { from: 'c2', to: 'e1', label: '掀桌摊牌' }, { from: 'c2', to: 'e2', label: '跟注到底' }, { from: 'c2', to: 'e3', label: '起身离场' }
] })
let a = G.analyze(good)
ok('合法图零错误', a.ok, JSON.stringify(a.issues.filter((i) => i.level === 'error')))
ok('路径数 = 2×3 = 6（回溯边不计）', a.stats.paths === 6, String(a.stats.paths))
ok('选项边自动识别为 option', good.edges.filter((e) => e.from === 'c1').every((e) => e.kind === 'option'))
ok('主线沿 main 标记走', a.stats.mainline.join('>') === 's>c1>a>m>L>c2>e1', a.stats.mainline.join('>'))
ok('汇合节省：树展开需要更多片段', a.stats.tree_clips > a.stats.clips, `${a.stats.clips} vs ${a.stats.tree_clips}`)
ok('回溯边 max_uses 默认 1', good.edges.find((e) => e.kind === 'back')!.max_uses === 1)
ok('问句选项发出警告', (() => { const g = JSON.parse(JSON.stringify(good)); g.edges.find((e: any) => e.label === '按兵不动').label = '你要不要跟？'; return codes(G.analyze(G.normalize(g))).includes('QUESTION_LABEL') })())

// 错误用例
const bad = (mut: (g: any) => void) => { const g = JSON.parse(JSON.stringify(good)); mut(g); return codes(G.analyze(G.normalize(g))) }
ok('前进边成环 → CYCLE', bad((g) => g.edges.push({ from: 'm', to: 'c1' })).includes('CYCLE'))
ok('场景分叉 → SCENE_FORK', bad((g) => g.edges.push({ from: 's', to: 'b' })).includes('SCENE_FORK'))
ok('锚点只有 1 个选项 → CHOICE_ARITY', bad((g) => { g.edges = g.edges.filter((e: any) => !(e.from === 'c1' && e.to === 'b')); g.nodes = g.nodes.filter((n: any) => n.id !== 'b') }).includes('CHOICE_ARITY'))
ok('死胡同 → DEAD_END', bad((g) => g.nodes.push({ id: 'z', type: 'scene', title: '孤岛', beat: 'x' }) && g.edges.push({ from: 'c2', to: 'z', label: '跳海' })).includes('DEAD_END'))
ok('不可达 → UNREACHABLE', bad((g) => g.nodes.push({ id: 'y', type: 'ending', title: '野结局' })).includes('UNREACHABLE'))
ok('结局有出边 → ENDING_OUT', bad((g) => g.edges.push({ from: 'e1', to: 'e2' })).includes('ENDING_OUT'))
ok('回溯指向下游 → BACK_TARGET', bad((g) => { g.edges.find((e: any) => e.kind === 'back').to = 'e1' }).includes('BACK_TARGET'))
ok('非裂隙节点发回溯 → BACK_SOURCE', bad((g) => g.edges.push({ from: 'm', to: 's', kind: 'back' })).includes('BACK_SOURCE'))
ok('裂隙无出口 → LOOP_NO_EXIT', bad((g) => { g.edges = g.edges.filter((e: any) => !(e.from === 'L' && e.kind !== 'back')) }).includes('LOOP_NO_EXIT'))
ok('选项无文案 → NO_LABEL', bad((g) => { delete g.edges.find((e: any) => e.label === '按兵不动').label }).includes('NO_LABEL'))
ok('没有结局 → NO_ENDING', codes(G.analyze(G.normalize({ nodes: [{ id: 'a', type: 'scene', title: 'x' }] }))).includes('NO_ENDING'))

// normalize 安全性
const dirty = G.normalize({ nodes: [{ id: 'a<script>', type: 'evil', title: 'x'.repeat(99) }, { id: 'a<script>' }, { id: 'b', type: 'ending', tier: 'mythic' }], edges: [{ from: 'a_script_', to: 'b' }, { from: 'a_script_', to: 'ghost' }, { from: 'b', to: 'b' }] })
ok('非法 id 被清洗、重复被去掉', dirty.nodes.length === 2 && dirty.nodes[0].id === 'a_script_')
ok('非法 type/tier 回落默认', dirty.nodes[0].type === 'scene' && dirty.nodes[1].tier === 'normal')
ok('悬空边 / 自环被丢弃', dirty.edges.length === 1)
ok('标题截断 24 字', dirty.nodes[0].title.length === 24)

// 规模：1000 个锚点串联 → 路径 2^1000 不溢出（封顶），计算快速
const big: any = { start: 'c0', nodes: [], edges: [] }
for (let i = 0; i < 400; i++) { big.nodes.push({ id: 'c' + i, type: 'choice', title: 'c', beat: 'x', question: 'q' }, { id: 'l' + i, type: 'scene', title: 'l', beat: 'x' }, { id: 'r' + i, type: 'scene', title: 'r', beat: 'x' }, { id: 'm' + i, type: 'merge', title: 'm', beat: 'x' }); big.edges.push({ from: 'c' + i, to: 'l' + i, label: '左' }, { from: 'c' + i, to: 'r' + i, label: '右' }, { from: 'l' + i, to: 'm' + i }, { from: 'r' + i, to: 'm' + i }, { from: 'm' + i, to: i < 399 ? 'c' + (i + 1) : 'end' }) }
big.nodes.push({ id: 'end', type: 'ending', title: 'end', tier: 'gold' })
const t0 = Date.now(), ab = G.analyze(G.normalize(big)), ms = Date.now() - t0
ok('1601 节点大图 < 300ms', ms < 300, `${ms}ms`)
ok('路径数封顶不溢出（2^400 → 1e12）', ab.stats.paths === 1e12, String(ab.stats.paths))
ok('片段数线性 = 节点数', ab.stats.clips === 1601)
ok('路径爆炸警告', codes(ab).includes('PATH_EXPLOSION'))

// 排版 & 合并
const lg = G.layout(G.normalize(good))
ok('排版后所有节点有坐标', lg.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)))
ok('排版列序：起点在最左', lg.nodes.find((n) => n.id === 's')!.x! < lg.nodes.find((n) => n.id === 'c2')!.x!)
const { graph: mg, newIds } = G.mergeInto(G.normalize(good), { nodes: [{ id: 'x1', type: 'scene', title: '背叛', beat: 'b' }], edges: [{ from: 'c2', to: 'x1', label: '出卖同伴' }, { from: 'x1', to: 'e2' }] })
ok('增量合并：新节点改名不冲突', newIds.size === 1 && ![...newIds].some((id) => good.nodes.some((n) => n.id === id)))
ok('增量合并：新支线汇入已有结局', G.analyze(mg).ok && G.analyze(mg).stats.paths === 8, String(G.analyze(mg).stats.paths))
// repair：修复 AI 常见错误
const aiBad = { start: 's1', nodes: [{ id: 's1', type: 'scene', title: '开局', beat: 'x' }, { id: 'c1', type: 'choice', title: '邀请', beat: 'x', 'question?': '接不接' }, { id: 's2', type: 'scene', title: '入局', beat: 'x' }, { id: 'c2', type: 'choice', title: '搭档', beat: 'x' }, { id: 's3', type: 'scene', title: '对峙', beat: 'x' }, { id: 'e1', type: 'ending', title: '翻身', 'tier?': 'normal' }, { id: 'e2', type: 'ending', title: '离场', tier: 'normal' }],
  edges: [{ from: 's1', to: 'c1' }, { from: 'c1', to: 's2', label: '接受', 'main?': true }, { from: 'c1', to: 's1', label: '暂不入局' }, { from: 's2', to: 'c2' }, { from: 'c2', to: 's3', label: '结盟' }, { from: 's3', to: 'e1', label: 'a' }, { from: 's3', to: 'e2', label: 'b' }] }
const n0 = G.normalize(aiBad)
ok('带问号的字段名被识别', n0.nodes.find((n) => n.id === 'c1')!.question === '接不接' && n0.edges.find((e) => e.to === 's2')!.main === true)
ok('同一目标的不同选项都保留', G.normalize({ nodes: [{ id: 'a', type: 'choice' }, { id: 'b' }], edges: [{ from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'b', label: 'y' }] }).edges.length === 2)
const before = codes(G.analyze(n0)), rp = G.repair(n0), after = G.analyze(rp.graph)
ok('修复前有 CYCLE/CHOICE_ARITY/SCENE_FORK', ['CYCLE', 'CHOICE_ARITY', 'SCENE_FORK'].every((c) => before.includes(c)), before.join(','))
ok('修复后零错误', after.ok, JSON.stringify(after.issues.filter((i) => i.level === 'error').map((i) => i.msg)))
ok('修复记录可读', rp.fixes.length >= 3, rp.fixes.join(' | '))
ok('修复后有黄金 + 坏结局', after.stats.endings_by_tier.gold >= 1 && after.stats.endings_by_tier.bad >= 1)
ok('合法图 repair 不改动', G.repair(good).fixes.length === 0, G.repair(good).fixes.join('|'))

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
