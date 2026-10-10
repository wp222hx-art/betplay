// 惊心 1 分钟：经济红线 + 剧本校验 + 蒙特卡洛（npx tsx tests/thrill.test.ts）
import { ladderRtp, validate, createThrill, MAX_RTP, DEFAULT_CFG } from '../src/thrill/engine'
import { DEMO_THRILL } from '../src/thrill/demo'
let pass = 0, fail = 0
const ok = (c: any, m: string) => { if (c) { pass++; console.log('✅', m) } else { fail++; console.log('❌', m) } }
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const L = [2, 3, 4, 5, 6]
ok(Math.abs(ladderRtp(L, [2, 2, 2, 2, 2]).rtp - 1.306) < 0.002, '全二选一 + 2/3/4/5/6 = 130.6%（平台必亏）')
ok(Math.abs(ladderRtp(L, [2, 3, 3, 3, 3]).rtp - 0.867) < 0.002, '2/3/3/3/3 = 86.7%')
ok(ladderRtp(L, [2, 3, 3, 3, 3]).jackpot_odds === 162, 'Jackpot 概率 1/162')
ok(ladderRtp(L, [2, 3, 3, 3, 3]).rtp + DEFAULT_CFG.rake <= MAX_RTP, '默认配置 ≤ 94% 红线')
ok(validate(DEMO_THRILL).length === 0, '演示剧本合法：' + validate(DEMO_THRILL).join(';'))
const all2 = clone(DEMO_THRILL); all2.gates.forEach((g: any) => { g.options = g.options.slice(0, 2); if (g.variants) for (const v of Object.values<any>(g.variants)) v.options = v.options.slice(0, 2) })
ok(validate(all2).some((e) => e.includes('不可持续')), '全二选一被经济红线拒绝')
const bad = clone(DEMO_THRILL); bad.gates[1].variants.g1_blue.options.pop()
ok(validate(bad).some((e) => e.includes('不一致')), '交叉情境选项数不一致被拒绝')
const four = clone(DEMO_THRILL); four.gates.pop()
ok(validate(four).some((e) => e.includes('5 关')), '非 5 关被拒绝')
const miss = clone(DEMO_THRILL); miss.gates[0].options[0].seg = 'nope'
ok(validate(miss).some((e) => e.includes('缺少片段')), '缺片段被拒绝')
const E = createThrill(DEMO_THRILL)
const mc = E.simulate(200000, 10)
console.log('   MC', mc)
ok(mc.rtp_total > 85 && mc.rtp_total < 94, `蒙特卡洛总 RTP ${mc.rtp_total}% 在 85~94% 区间`)
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
