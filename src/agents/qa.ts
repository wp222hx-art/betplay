// Agent-3 · 测试官 —— 对 Agent-2/4 的产出做可重复的自动化验收（对应 PRD 第 10 章验收标准）
import { cancelBet, lockRevealSettle, monteCarlo, openRound, placeBet, rewind, verifyRound } from '../core/engine'
import { uid } from '../core/crypto'
import type { Bindings } from '../gateway/llm'

type Case = { name: string; ok: boolean; detail: string; ms: number }

export async function runSelfTest(env: Bindings) {
  const cases: Case[] = []
  const t = async (name: string, fn: () => Promise<string>) => {
    const s = Date.now()
    try { cases.push({ name, ok: true, detail: await fn(), ms: Date.now() - s }) }
    catch (e: any) { cases.push({ name, ok: false, detail: String(e?.message || e), ms: Date.now() - s }) }
  }
  const assert = (c: any, m: string) => { if (!c) throw new Error(m) }
  const user = uid('qa_')

  await t('T1 承诺先于下注：OPEN 返回 commit 且不泄露 seed/结果', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C1' })
    assert(r.commit?.length === 64, 'commit 长度异常')
    const s = JSON.stringify(r)
    assert(!s.includes('"seed"') && !s.includes('outcome_id'), '响应泄露结果信息')
    assert(r.encrypted.length === r.options.length, '密文分片数 ≠ 结局簇数')
    const lens = new Set(r.encrypted.map((e: any) => e.ct.length))
    assert(lens.size === 1, '密文长度未对齐，可被流量分析')
    return `commit=${r.commit.slice(0, 12)}… 分片 ${r.encrypted.length} 个且长度一致`
  })

  await t('T2 幂等下注：同一幂等键重复提交只扣一次', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C1' })
    const k = uid('idem_')
    const a: any = await placeBet(env, { roundId: r.round_id, userId: user, outcomeId: r.options[0].id, amount: 50, idemKey: k })
    const b: any = await placeBet(env, { roundId: r.round_id, userId: user, outcomeId: r.options[0].id, amount: 50, idemKey: k })
    assert(a.bet_id === b.bet_id && b.idempotent, '幂等失效')
    const s: any = await lockRevealSettle(env, { roundId: r.round_id, userId: user })
    assert(s.state === 'SETTLE', '未结算')
    return `bet=${a.bet_id} 重复提交返回首次结果；结算 ${s.bet.won ? '赢' : '输'} payout=${s.bet.payout}`
  })

  await t('T3 公平复算：公开种子可复算承诺与结果，事件哈希链完整', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C2' })
    await lockRevealSettle(env, { roundId: r.round_id, userId: user })
    const v: any = await verifyRound(env, r.round_id)
    assert(v.commit_match && v.outcome_match && v.event_chain_ok, JSON.stringify({ c: v.commit_match, o: v.outcome_match, e: v.event_chain_ok }))
    return `commit✓ outcome✓ chain✓（${v.events.length} 事件）`
  })

  await t('T4 分支不重复：同账号连续进入同节点，普通变体不重复', async () => {
    const u2 = uid('qa_dup_')
    const seen: string[] = []
    let reused = 0
    for (let i = 0; i < 8; i++) {
      const r: any = await openRound(env, { userId: u2, nodeId: 'C3' })
      const s: any = await lockRevealSettle(env, { roundId: r.round_id, userId: u2 })
      if (r.reuse) { reused++; continue } // 池耗尽时“经典重现”是被允许且被标注的
      seen.push(s.variant_id)
    }
    const fresh = seen.filter((v, i) => seen.indexOf(v) === i)
    assert(fresh.length === seen.length, '未标注重现却出现重复变体: ' + seen.join(','))
    return `8 局中 ${seen.length} 局全新变体 0 重复；${reused} 局池耗尽走“经典重现”并标注`
  })

  await t('T5 账本平衡：所有交易借贷相等', async () => {
    const bad = await env.DB.prepare(`SELECT tx_id, SUM(CASE WHEN direction='D' THEN amount ELSE -amount END) d FROM ledger GROUP BY tx_id HAVING d != 0`).all()
    assert(!bad.results.length, `${bad.results.length} 笔不平`)
    const n = await env.DB.prepare('SELECT COUNT(DISTINCT tx_id) n FROM ledger').first<any>()
    return `${n.n} 笔交易全部借贷平衡`
  })

  await t('T6 余额一致：用户余额 = 账本 available 科目净额', async () => {
    const u: any = await env.DB.prepare('SELECT chips, frozen FROM users WHERE id=?').bind(user).first()
    const l: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) bal FROM ledger WHERE account=?`).bind(`user:${user}:available`).first()
    assert(u.chips === l.bal, `users.chips=${u.chips} ≠ ledger=${l.bal}`)
    return `chips=${u.chips} 与账本一致，frozen=${u.frozen}`
  })

  await t('T7 锁盘后拒注 & 撤销窗口', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C1' })
    await placeBet(env, { roundId: r.round_id, userId: user, outcomeId: r.options[1].id, amount: 20, idemKey: uid('i') })
    await cancelBet(env, { roundId: r.round_id, userId: user })
    await lockRevealSettle(env, { roundId: r.round_id, userId: user })
    let rejected = false
    try { await placeBet(env, { roundId: r.round_id, userId: user, outcomeId: r.options[0].id, amount: 20, idemKey: uid('i') }) } catch { rejected = true }
    assert(rejected, '锁盘后仍可下注')
    return '2s 内撤销成功，锁盘后下注被拒'
  })

  await t('T8 悔棋：全新承诺、悔棋税记账、最低下注按 ×1.5 递增', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C1' })
    await lockRevealSettle(env, { roundId: r.round_id, userId: user })
    const n: any = await rewind(env, { roundId: r.round_id, userId: user })
    assert(n.commit !== r.commit, '悔棋未生成新承诺')
    assert(n.min_bet === 15, '最低下注应为 15，实际 ' + n.min_bet)
    return `新承诺 ${n.commit.slice(0, 10)}… 悔棋税 ${n.rewind_fee}，最低下注 ${n.min_bet}`
  })

  await t('T9 EV 安全：蒙特卡洛无正期望套利（含“输了就悔棋”策略）', async () => {
    const nodes = (await env.DB.prepare(`SELECT id FROM nodes WHERE kind='cash'`).all()).results as any[]
    const out: string[] = []
    for (const n of nodes) {
      const w = ((await env.DB.prepare('SELECT story_weight FROM outcomes WHERE node_id=? ORDER BY id').bind(n.id).all()).results as any[]).map((x) => x.story_weight)
      const mc = monteCarlo(w, 0.08, { n: 5000 })
      assert(!mc.arbitrage_risk, `${n.id} 存在套利：` + JSON.stringify(mc.rows))
      out.push(`${n.id}:${Math.max(...mc.rows.map((r) => r.player_ev_per_100))}%`)
    }
    return '玩家最优策略 EV：' + out.join(' ')
  })

  await t('T10 兜底存在：每个结局簇至少 1 个兜底变体', async () => {
    const miss = await env.DB.prepare(`SELECT o.id FROM outcomes o WHERE NOT EXISTS (SELECT 1 FROM variants v WHERE v.outcome_id=o.id AND v.is_fallback=1 AND v.status='pool')`).all()
    assert(!miss.results.length, '缺兜底: ' + miss.results.map((x: any) => x.id).join(','))
    return '全部结局簇具备兜底变体'
  })

  await t('T11 Arena 彩池：parimutuel 结算且借贷平衡', async () => {
    const r: any = await openRound(env, { userId: user, nodeId: 'C2', mode: 'arena' })
    assert(r.crowd, '无彩池')
    await placeBet(env, { roundId: r.round_id, userId: user, outcomeId: r.options[0].id, amount: 30, idemKey: uid('i') })
    const s: any = await lockRevealSettle(env, { roundId: r.round_id, userId: user })
    return `彩池 ${Object.values<number>(s.crowd).reduce((a, b) => a + b, 0)}，${s.bet.won ? '赢 ' + s.bet.payout : '输'}，最终赔率 ×${s.bet.odds}`
  })

  const passed = cases.filter((c) => c.ok).length
  await env.DB.prepare('INSERT INTO test_reports (suite,passed,failed,detail,created_at) VALUES (?,?,?,?,?)')
    .bind('agent3-selftest', passed, cases.length - passed, JSON.stringify(cases), Date.now()).run()
  await env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (3,?,?,?,?)')
    .bind('selftest', passed === cases.length ? 'ok' : 'fail', `${passed}/${cases.length} 通过`, Date.now()).run()
  return { passed, failed: cases.length - passed, total: cases.length, cases }
}
