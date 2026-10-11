import { AMU_PARK as g, joint, condProbs, marginals, quote, liveOdds, play, twistOdds, slipLive, COMBO_CFG } from '../src/fun/combo'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) pass++; else { fail++; console.log('FAIL', m) } }
const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e

;(async () => {
  const J = joint(g)
  ok(J.length === 64, '64 combos')
  ok(close(J.reduce((s, x) => s + x.p, 0), 1), 'joint sums to 1')
  for (let a = 0; a < 4; a++) { ok(close(g.pB(a).reduce((s, x) => s + x, 0), 1), 'pB rows ' + a); for (let b = 0; b < 4; b++) ok(close(g.pC(a, b).reduce((s, x) => s + x, 0), 1), `pC ${a}${b}`) }
  ok(close(g.twist.opts.reduce((s, o) => s + o.p, 0), g.twist.p), 'twist p')
  const M = marginals(g); M.forEach((m, k) => ok(close(m.reduce((s, x) => s + x, 0), 1), 'marg ' + k))
  console.log('marginals', M.map((m) => m.map((x) => (x * 100).toFixed(1) + '%').join(' ')))
  // conditional shifts are real (博弈信号)
  const cB_guide = condProbs(g, 1, [3]), cC_balloon = condProbs(g, 2, [0, 1])
  ok(cB_guide[2] > 0.35, 'guide → dog likely'); ok(cC_balloon[0] > 0.4, 'balloon → amu likely')
  console.log('P(B|guide)', cB_guide.map((x) => x.toFixed(2)), 'P(C|rev,balloon)', cC_balloon.map((x) => x.toFixed(2)))

  // every slip: EV ≤ 0.93 and payouts sane
  let maxEv = 0, maxMult = 0, minMult = 1e9, allowed = 0
  const ids = g.slots.map((s) => s.opts.map((o) => o.id))
  for (const a of ids[0]) for (const b of ids[1]) for (const c of ids[2]) {
    const q = quote(g, [a, b, c]); if (!q.ok) continue; allowed++
    maxEv = Math.max(maxEv, q.ev); maxMult = Math.max(maxMult, q.mult[3]); minMult = Math.min(minMult, q.mult[3])
    ok(close(q.P.reduce((s, x) => s + x, 0), 1, 1e-9), 'slip P sums')
  }
  ok(maxEv <= 0.93 + 1e-9, 'slip EV ≤ .93 got ' + maxEv)
  console.log('slips allowed', allowed, '/64  全中 ×' + minMult + ' ~ ×' + maxMult, 'max EV', maxEv)

  // window odds: never +EV, early > late
  for (let k = 0; k < 3; k++) {
    const P = condProbs(g, k, k === 0 ? [] : k === 1 ? [0] : [0, 1])
    const early = liveOdds(P, 0), late = liveOdds(P, COMBO_CFG.win_ms)
    P.forEach((p, i) => { ok(p * early[i] <= COMBO_CFG.rtp_hi + 1e-9, 'early EV'); ok(early[i] >= late[i], 'early ≥ late'); ok(p * late[i] <= COMBO_CFG.rtp_lo + 0.011, 'late EV') })
  }
  ok(g.twist.p * twistOdds(g) <= 0.92 + 1e-9, 'twist EV')

  // live slip probs after reveals
  const L = slipLive(g, ['rev', 'balloon', 'amu'], [0, 1]); ok(close(L.reduce((s, x) => s + x, 0), 1), 'live sums'); ok(L[0] === 0 && L[1] === 0, 'live: two hits already')

  // determinism + empirical frequency
  const seedA = 'ab'.repeat(32); const p1 = await play(g, seedA), p2 = await play(g, seedA)
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'deterministic')
  const cnt: Record<string, number> = {}; let tw = 0; const N = 4000
  for (let i = 0; i < N; i++) { const r = await play(g, i.toString(16).padStart(64, '0')); cnt[r.ids.join('|')] = (cnt[r.ids.join('|')] || 0) + 1; if (r.twist) tw++ }
  ok(Object.keys(cnt).length >= 55, 'many distinct endings ' + Object.keys(cnt).length)
  ok(Math.abs(tw / N - g.twist.p) < 0.02, 'twist freq ' + tw / N)
  const pA0 = Object.entries(cnt).filter(([k]) => k.startsWith('rev|')).reduce((s, [, v]) => s + v, 0) / N
  ok(Math.abs(pA0 - g.pA[0]) < 0.03, 'A freq ' + pA0)
  console.log('distinct endings in', N, 'runs:', Object.keys(cnt).length, ' twist', (tw / N * 100).toFixed(1) + '%')
  console.log(`${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
})()
