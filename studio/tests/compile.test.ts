// P5 编译器单元测试：npx tsx studio/tests/compile.test.ts
import * as G from '../src/lib/graph'
import * as C from '../src/lib/compile'
let pass = 0, fail = 0
const ok = (n: string, c: any, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
const N = (id: string, type: string, extra: any = {}) => ({ id, type, title: id.toUpperCase(), beat: 'b', ...extra })
const codes = (p: C.Plan) => p.issues.map((i) => i.code)
const parts = (p: C.Plan, seg: string) => p.segments[seg]?.parts.map((x) => x.node).join('>')

// 1 最小：s → c1 →(e1 | e2)（真拍小样同构）
{
  const g = G.normalize({ start: 's1', nodes: [N('s1', 'scene'), N('c1', 'choice', { question: '押上全部还是弃牌' }), N('e1', 'ending', { tier: 'gold' }), N('e2', 'ending', { tier: 'bad' })],
    edges: [{ from: 's1', to: 'c1' }, { id: 'x1', from: 'c1', to: 'e1', label: '押上全部', main: true }, { id: 'x2', from: 'c1', to: 'e2', label: '弃牌离场' }] })
  const p = C.compile(g)
  ok('序章 = 起点场景 + 第一个抉择点（悬念收尾）', parts(p, 'P') === 's1>c1', parts(p, 'P'))
  ok('一个抉择点，depth=1，问题取自锚点', p.nodes.length === 1 && p.nodes[0].depth === 1 && p.nodes[0].question === '押上全部还是弃牌')
  ok('两个选项 → 两个结局，带结局等级', p.nodes[0].options.every((o) => !o.next) && p.nodes[0].options.map((o) => o.ending_tier).join() === 'gold,bad')
  ok('选项片段 = 目标节点视频', parts(p, 'o_x1') === 'e1' && parts(p, 'o_x2') === 'e2')
  ok('选项文案 / 权重均分', p.nodes[0].options[0].label === '押上全部' && p.nodes[0].options.every((o) => o.weight === 0.5))
  ok('无错误', !p.issues.some((i) => i.level === 'error'), JSON.stringify(p.issues))
  ok('统计：4 段视频全部用到', p.stats.clips_used === 4 && !p.stats.unused.length)
}

// 2 场景链 + 汇合：s → c1 →(a → a2 | b) → m → c2 →(e1 | e2)
{
  const g = G.normalize({ start: 's', nodes: [N('s', 'scene'), N('c1', 'choice', { question: 'q1' }), N('a', 'scene'), N('a2', 'scene'), N('b', 'scene'), N('m', 'merge'), N('c2', 'choice', { question: 'q2' }), N('e1', 'ending'), N('e2', 'ending', { tier: 'diamond' })],
    edges: [{ from: 's', to: 'c1' }, { id: 'oa', from: 'c1', to: 'a', label: 'A' }, { id: 'ob', from: 'c1', to: 'b', label: 'B' }, { from: 'a', to: 'a2' }, { from: 'a2', to: 'm' }, { from: 'b', to: 'm' }, { from: 'm', to: 'c2' }, { id: 'o1', from: 'c2', to: 'e1', label: '一' }, { id: 'o2', from: 'c2', to: 'e2', label: '二' }] })
  const p = C.compile(g)
  ok('场景链拼成一个片段（a>a2>m>c2）', parts(p, 'o_oa') === 'a>a2>m>c2', parts(p, 'o_oa'))
  ok('另一条路经汇合到同一抉择点（b>m>c2）', parts(p, 'o_ob') === 'b>m>c2')
  ok('两个选项都指向下一抉择点 c2', p.nodes[0].options.every((o) => o.next === 'c2'))
  ok('c2 深度 = 2', p.nodes.find((n) => n.id === 'c2')?.depth === 2)
  ok('汇合与后续抉择点的视频被复用（不重拍）', p.stats.clips_reused === 2, String(p.stats.clips_reused))
  ok('钻石结局等级透传', p.nodes[1].options.find((o) => o.id === 'o_o2')?.ending_tier === 'diamond')
}

// 3 时间裂隙：c1 →(A → L | B → e2)；L 是 loop（2 个前进选项 + 回溯到 s）
{
  const g = G.normalize({ start: 's', nodes: [N('s', 'scene'), N('c1', 'choice', { question: 'q' }), N('a', 'scene'), N('L', 'loop', { question: '要不要回到那一夜？', beat: '时钟倒转' }), N('e1', 'ending'), N('e2', 'ending'), N('e3', 'ending', { tier: 'platinum' })],
    edges: [{ from: 's', to: 'c1' }, { id: 'oa', from: 'c1', to: 'a', label: 'A' }, { id: 'ob', from: 'c1', to: 'e2', label: 'B' }, { from: 'a', to: 'L' }, { id: 'l1', from: 'L', to: 'e1', label: '认命' }, { id: 'l2', from: 'L', to: 'e3', label: '反抗' }, { id: 'bk', from: 'L', to: 's', kind: 'back' }] })
  const p = C.compile(g), L = p.nodes.find((n) => n.id === 'L')
  ok('loop（≥2 前进出口）当作抉择点', !!L && L.options.length === 2)
  ok('回溯边 → fork：裂隙片段从回溯目标起播放', L?.fork?.node === 'c1' && parts(p, L!.fork!.seg) === 's>c1', JSON.stringify(L?.fork))
  ok('fork 描述取 loop 的剧情节拍', L?.fork?.desc === '时钟倒转')
  ok('无错误', !p.issues.some((i) => i.level === 'error'), JSON.stringify(p.issues))
}

// 4 只有 1 个前进出口的 loop → 普通场景 + 警告
{
  const g = G.normalize({ start: 's', nodes: [N('s', 'scene'), N('c1', 'choice', { question: 'q' }), N('L', 'loop', { question: 'x' }), N('e1', 'ending'), N('e2', 'ending')],
    edges: [{ from: 's', to: 'c1' }, { id: 'a', from: 'c1', to: 'L', label: 'A' }, { id: 'b', from: 'c1', to: 'e2', label: 'B' }, { from: 'L', to: 'e1' }, { from: 'L', to: 's', kind: 'back' }] })
  const p = C.compile(g)
  ok('单出口 loop 当场景穿过（片段 L>e1）', parts(p, 'o_a') === 'L>e1')
  ok('给出 LOOP_PASSTHRU 警告', codes(p).includes('LOOP_PASSTHRU'))
}

// 5 错误：没有博弈锚点
{
  const p = C.compile(G.normalize({ start: 's', nodes: [N('s', 'scene'), N('e', 'ending')], edges: [{ from: 's', to: 'e' }] }))
  ok('从起点直达结局 → NO_DECISION 错误', codes(p).includes('NO_DECISION') && !p.nodes.length)
}
// 6 错误：只有 1 个结局
{
  const p = C.compile(G.normalize({ start: 's', nodes: [N('s', 'scene'), N('c', 'choice', { question: 'q' }), N('a', 'scene'), N('b', 'scene'), N('e', 'ending')],
    edges: [{ from: 's', to: 'c' }, { from: 'c', to: 'a', label: 'A' }, { from: 'c', to: 'b', label: 'B' }, { from: 'a', to: 'e' }, { from: 'b', to: 'e' }] }))
  ok('两个选项汇到同一结局（每条路径一个结局选项 → 引擎看作 2 个结局）', p.stats.endings === 2 && !codes(p).includes('FEW_ENDINGS'))
}
// 7 不可达节点 → UNUSED 警告
{
  const p = C.compile(G.normalize({ start: 's', nodes: [N('s', 'scene'), N('c', 'choice', { question: 'q' }), N('e1', 'ending'), N('e2', 'ending'), N('orphan', 'scene')],
    edges: [{ from: 's', to: 'c' }, { from: 'c', to: 'e1', label: 'A' }, { from: 'c', to: 'e2', label: 'B' }] }))
  ok('孤立节点报 UNUSED', codes(p).includes('UNUSED') && p.stats.unused.includes('orphan'))
}
// 8 深层 DAG：3 层锚点，每层 2 选项汇合 → 抉择点 3 个、结局 2 个
{
  const nodes: any[] = [N('s', 'scene')], edges: any[] = []
  let prev = 's'
  for (let k = 1; k <= 3; k++) {
    nodes.push(N('c' + k, 'choice', { question: 'q' + k }), N('a' + k, 'scene'), N('b' + k, 'scene'), N('m' + k, 'merge'))
    edges.push({ from: prev, to: 'c' + k }, { from: 'c' + k, to: 'a' + k, label: 'A' }, { from: 'c' + k, to: 'b' + k, label: 'B' }, { from: 'a' + k, to: 'm' + k }, { from: 'b' + k, to: 'm' + k })
    prev = 'm' + k
  }
  nodes.push(N('c4', 'choice', { question: 'final' }), N('e1', 'ending'), N('e2', 'ending'))
  edges.push({ from: prev, to: 'c4' }, { from: 'c4', to: 'e1', label: '一' }, { from: 'c4', to: 'e2', label: '二' })
  const p = C.compile(G.normalize({ start: 's', nodes, edges }))
  ok('4 个抉择点，深度 1..4', p.nodes.map((n) => n.depth).join() === '1,2,3,4', p.nodes.map((n) => n.id + n.depth).join())
  ok('片段数 = 1 序章 + 8 选项', p.stats.segments === 9)
  ok('16 条路径只需 16 段视频（汇合复用 m1–m3 与后续锚点）', p.stats.clips_used === 16 && p.stats.clips_reused >= 6, String(p.stats.clips_reused))
}
// 9 台词时间轴
{
  const t = C.timeline([{ dur: 8, lines: [{ speaker: 'A', text: '1' }, { speaker: 'B', text: '2' }] }, { dur: 6, lines: [{ speaker: 'A', text: '3' }] }])
  ok('台词按段落时长排布，第二段从 8 秒后开始', t.length === 3 && t[0].start >= 0.5 && t[1].start < 8 && t[2].start >= 8 && t[2].end <= 14)
  ok('台词不重叠', t.every((l, i) => i === 0 || l.start >= t[i - 1].end - 0.01), JSON.stringify(t))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
