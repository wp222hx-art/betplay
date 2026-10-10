// 致命13 v3：押注单综合赔付 / 追注 / 轮数约束（npx tsx tests/l13.test.ts）
import { SLIP_BINS, SLIP_DIST, slipQuote, slipProbs, fullGame, l13Simulate, L13_CFG, tiersFor } from '../src/thrill/lethal13'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) { pass++; console.log('✅', m) } else { fail++; console.log('❌', m) } }
;(async () => {
  SLIP_DIST.forEach((d, k) => ok(Math.abs(Object.values(d).reduce((a, b) => a + b, 0) - 1) < 1e-9, `第 ${k + 1} 轮边缘分布归一`))
  SLIP_BINS.forEach((b, k) => { console.log(`   第${k + 1}轮档位`, b.map((x) => `${x.label} ${(x.p * 100).toFixed(1)}%`).join(' | ')); ok(b.length >= 2 && Math.abs(b.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, `第 ${k + 1} 轮押注单 ${b.length} 档、概率和 = 1`) })
  let all = 0, okc = 0, maxEv = 0
  const combos: string[][] = []; for (const a of SLIP_BINS[0]) for (const b of SLIP_BINS[1]) for (const c of SLIP_BINS[2]) combos.push([a.id, b.id, c.id])
  for (const c of combos) { const q = slipQuote(c); all++; if (q.ok) { okc++; maxEv = Math.max(maxEv, q.ev); if (q.mult[1] > q.mult[2] || q.mult[2] > q.mult[3]) ok(false, `赔率单调 ${c}`) } }
  ok(maxEv <= L13_CFG.slip_rtp + 1e-9, `所有押注单期望 ≤ ${L13_CFG.slip_rtp}（最大 ${maxEv}）· 可下组合 ${okc}/${all}`)
  const d = slipQuote(SLIP_BINS.map((b) => [...b].sort((x, y) => y.p - x.p)[0].id))
  console.log('   默认单（每轮最可能档）', d.bins.map((b: any) => b.label).join(' / '), 'P=', d.P.map((x: number) => x.toFixed(3)), 'mult=', d.mult)
  ok(d.mult[3] >= 5 && d.mult[2] >= 1, '默认单：全中 ≥ ×5、中两档 ≥ 回本')
  const hard = combos.map(slipQuote).filter((q) => q.ok).sort((a, b) => b.mult[3] - a.mult[3])[0]
  console.log('   最刺激可下单', hard.bins.map((b: any) => b.label).join(' / '), 'mult=', hard.mult)
  let bad = false; try { slipProbs(['t0', 't0']) } catch { bad = true } ok(bad, '缺档押注单被拒')
  // 轮数约束：3~5 轮 + 决斗
  let minR = 9, maxR = 0, oneWinner = true
  for (let i = 0; i < 400; i++) { const g = await fullGame(i.toString(16).padStart(64, '0')); const ring = g.filter((r) => r.type === 'ring').length; minR = Math.min(minR, ring); maxR = Math.max(maxR, ring); if (g[g.length - 1].after.length !== 1) oneWinner = false }
  ok(minR >= 2 && maxR <= 5, `环形轮数 ${minR}~${maxR}（≤5）`); ok(oneWinner, '每局必有唯一幸存者')
  const m = l13Simulate(200000); console.log('   MC', m)
  ok(m.slip_rtp < 95 && m.slip_rtp > 88, `押注单 MC 返还 ${m.slip_rtp}%`); ok(m.side_rtp < 96, `追注 MC 返还 ${m.side_rtp}%`)
  ok(m.avg_rounds <= 5.2, `平均 ${m.avg_rounds} 场（含决斗）→ 单局 ≈ ${Math.round(m.avg_rounds * 25 + 30)} 秒`)
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
