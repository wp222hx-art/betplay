import { GAUNTLETS, gFull, gTiers, stayDist, G_CFG } from '../src/thrill/gauntlet'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) pass++; else { fail++; console.log('❌', m) } }
;(async () => {
  for (const g of Object.values(GAUNTLETS)) {
    ok(g.risk.length >= g.max_rounds, `${g.sid} risk 长度`)
    for (let n = 2; n <= g.cast.length; n++) for (const p of g.risk) {
      const d = stayDist(n, p); ok(Math.abs(Object.values(d).reduce((a, b) => a + b, 0) - 1) < 1e-9, `${g.sid} 分布归一 n=${n}`)
      const t = gTiers(n, p); ok(Math.abs(t.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, `${g.sid} 档位覆盖 n=${n} p=${p}`)
      ok(t.every((x) => x.p * x.odds <= G_CFG.rtp + 1e-9), `${g.sid} EV≤rtp n=${n}`)
    }
    let rounds = 0, finals = 0, one = true, wins: Record<number, number> = {}, voidMax = 0
    const N = 1500
    for (let i = 0; i < N; i++) {
      const rs = await gFull(g, (i * 7919).toString(16).padStart(64, '0'))
      rounds += rs.length; if (rs[rs.length - 1].type === 'final') finals++
      if (rs[rs.length - 1].after.length !== 1) one = false
      wins[rs[rs.length - 1].after[0]] = (wins[rs[rs.length - 1].after[0]] || 0) + 1
      for (const r of rs) { voidMax = Math.max(voidMax, r.voids); if (r.type === 'ring') ok(r.order!.length === r.before.length, 'order 全员') }
    }
    ok(one, `${g.sid} 每局唯一胜者`)
    const spread = Math.max(...Object.values(wins)) / Math.min(...Object.values(wins))
    console.log(`${g.title}: 平均 ${(rounds / N).toFixed(2)} 段（含对决），对决率 ${(finals / N * 100).toFixed(0)}%，胜者分布偏差 ×${spread.toFixed(2)}，最多作废 ${voidMax}`)
    ok(spread < 1.6, `${g.sid} 胜者大致均匀`)
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
