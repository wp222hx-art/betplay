// 惊心 1 分钟 v2：爬塔经济 + 剧本校验 + 蒙特卡洛（npx tsx tests/thrill.test.ts）
import { validate, createThrill, multAt, ladderTable, DEFAULT_CFG, MAX_RTP, pAt } from '../src/thrill/engine'
import { THRILL_SCRIPTS } from '../src/thrill/scripts'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) { pass++; console.log('✅', m) } else { fail++; console.log('❌', m) } }
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const C = DEFAULT_CFG
ok(multAt(C, 1) === 1.82 && multAt(C, 2) === 3.95, '倍率塔：连中1 ×1.82 · 连中2 ×3.95')
let P = 1, okEv = true
for (let h = 1; h <= 12; h++) { P *= pAt(C, h - 1); if (P * multAt(C, h) > C.rtp + 1e-9) okEv = false }
ok(okEv, '任意落袋点期望 ≤ rtp（平台不靠诱导多爬获利）')
ok(C.rtp + C.rake <= MAX_RTP, `rtp ${C.rtp} + 抽成 ${C.rake} ≤ ${MAX_RTP}`)
ok(ladderTable(C, 20).length >= 8, '爬塔层数 ≥ 8 且命中率逐级递减')
for (const d of THRILL_SCRIPTS) {
  ok(validate(d).length === 0, `剧本《${d.series.title}》合法 ${validate(d).join(';')}`)
  const story = d.cards.filter((c: any) => c.at !== undefined).length
  ok(story === d.main.length - 1, `《${d.series.title}》每两段主线之间一张剧情卡（${story} 张）+ 加时卡 ${d.cards.length - story} 张`)
  const castOk = Object.values<any>(d.segments).every((s) => s.cast.every((k: string) => d.cast[k]))
  ok(castOk, `《${d.series.title}》所有片段的演员都在定妆表内`)
}
const bad = clone(THRILL_SCRIPTS[0]); bad.cards[0].a.seg = 'nope'
ok(validate(bad).some((e) => e.includes('缺少')), '缺片段被拒绝')
const gap = clone(THRILL_SCRIPTS[0]); gap.cards[1].at = undefined
ok(validate(gap).some((e) => e.includes('连续')), '剧情卡断档被拒绝')
const greedy = clone(THRILL_SCRIPTS[0]); greedy.thrill = { cfg: { rtp: 0.97 } }
ok(validate(greedy).some((e) => e.includes('红线')), '超红线被拒绝')
const E = createThrill(THRILL_SCRIPTS[0])
for (const t of [1, 2, 3, 5, 99]) { const m = E.simulate(300000, 10, t); console.log('   MC 爬到', t, '落袋 →', m.rtp_total + '%', 'JP', m.jackpots); ok(m.rtp_total < 96, `策略「爬 ${t} 猜落袋」总返还 ${m.rtp_total}% < 96%`) }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
