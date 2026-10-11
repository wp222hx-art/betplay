// 开心1分钟：三部剧的概率树 / 押注单 / 快押 / 押主角 经济校验（npx tsx tests/fun.test.ts）
import { FUN_GAMES } from '../src/fun/games'
import { leaves, legMarginals, quote, finalOdds, play, FUN_CFG } from '../src/fun/engine'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) { pass++; console.log('✅', m) } else { fail++; console.log('❌', m) } }
;(async () => {
  for (const g of Object.values(FUN_GAMES)) {
    console.log(`\n── ${g.title} ──`)
    const L = leaves(g), tot = L.reduce((a, l) => a + l.p, 0)
    ok(Math.abs(tot - 1) < 1e-9, `概率树归一（${L.length} 个结局路径）`)
    for (const l of L) { let h: any[] = []; for (const x of l.h) { const st = g.next(h)!; if (Math.abs(st.opts.reduce((a, o) => a + o.p, 0) - 1) > 1e-9) { ok(false, `${st.key} 概率和≠1`); break } h = [...h, x] } }
    const lm = legMarginals(g); lm.forEach((l) => console.log('   ', l.title, l.bins.map((b) => `${b.label} ${(b.p * 100).toFixed(1)}%`).join(' | ')))
    ok(lm.every((l) => l.bins.every((b) => b.p > 0)), '押注单每一档都可能发生')
    const combos: string[][] = [[]]; for (const l of g.legs) { const nx: string[][] = []; for (const c of combos) for (const b of l.bins) nx.push([...c, b.id]); combos.splice(0, combos.length, ...nx) }
    let maxEv = 0, okc = 0, mono = true, top: any = null
    for (const c of combos) { const q = quote(g, c); if (!q.ok) continue; okc++; maxEv = Math.max(maxEv, q.ev); if (q.mult[1] > q.mult[2] || q.mult[2] > q.mult[3]) mono = false; if (!top || q.mult[3] > top.mult[3]) top = q }
    ok(maxEv <= 0.93 + 1e-9, `所有押注单期望 ≤ 93%（最大 ${maxEv}，可下 ${okc}/${combos.length}）`); ok(mono, '综合赔付随命中数单调递增')
    console.log('    最冷门可下单 全中', top.mult[3], '×  ·', top.picks.join('/'))
    const fo = finalOdds(g); console.log('    押主角', fo.map((o) => `${o.label} ×${o.odds}`).join(' | '))
    ok(fo.every((o) => o.p * o.odds <= FUN_CFG.final_rtp + 1e-9), '押主角期望 ≤ 92%')
    // 种子抽样分布 ≈ 枚举分布
    const N = 3000, cnt: Record<string, number> = {}; let steps = 0, maxSteps = 0
    for (let i = 0; i < N; i++) { const pl = await play(g, (i * 7919).toString(16).padStart(64, 'a')); cnt[pl.final] = (cnt[pl.final] || 0) + 1; steps += pl.steps.length; maxSteps = Math.max(maxSteps, pl.steps.length) }
    ok(fo.every((o) => Math.abs((cnt[o.id] || 0) / N - o.p) < 0.035), `种子抽样与公开概率一致（${fo.map((o) => `${o.label} ${(((cnt[o.id] || 0) / N) * 100).toFixed(0)}%/${(o.p * 100).toFixed(0)}%`).join(' ')}）`)
    console.log(`    平均 ${(steps / N).toFixed(2)} 步，最多 ${maxSteps} 步 → 单局约 ${Math.round(8 + (steps / N) * 16 + 7)} 秒`)
    ok(maxSteps <= 6, '最多 6 步（时长可控）')
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
