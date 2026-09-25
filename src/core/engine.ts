// ForgeCore 博弈内核（Agent-2 开发 / Agent-4 负责下注·结算·悔棋·赔率）
// DFP 七态：OPEN → COMMIT → BETTING → LOCK → REVEAL → SETTLE → NEXT（+ REWIND 回到 OPEN，全新承诺）
import { encryptSlot, hmac, makeCommit, randomHex, seedFloat, sha256, uid } from './crypto'

type Env = { DB: D1Database }
export class GameError extends Error { constructor(public code: string, msg: string) { super(msg) } }

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

// ─────────────────────────── 事件溯源 + 哈希链 ───────────────────────────
async function appendEvent(env: Env, roundId: string, type: string, payload: any) {
  const last: any = await env.DB.prepare('SELECT seq,hash FROM round_events WHERE round_id=? ORDER BY seq DESC LIMIT 1').bind(roundId).first()
  const seq = (last?.seq || 0) + 1
  const prev = last?.hash || 'GENESIS'
  const body = JSON.stringify(payload)
  const hash = await sha256(`${prev}|${roundId}|${seq}|${type}|${body}`)
  await env.DB.prepare('INSERT INTO round_events (round_id,seq,type,payload,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(roundId, seq, type, body, prev, hash, now()).run()
  await env.DB.prepare('UPDATE rounds SET seq=? WHERE id=?').bind(seq, roundId).run()
  return seq
}

// ─────────────────────────── 复式记账 ForgeLedger ───────────────────────────
async function post(env: Env, memo: string, ref: string, lines: [string, 'D' | 'C', number][]) {
  const d = lines.filter((l) => l[1] === 'D').reduce((a, l) => a + l[2], 0)
  const c = lines.filter((l) => l[1] === 'C').reduce((a, l) => a + l[2], 0)
  if (d !== c) throw new GameError('LEDGER_UNBALANCED', `借贷不平 ${d}≠${c}`)
  const tx = uid('tx_')
  await env.DB.batch(lines.filter((l) => l[2] > 0).map(([acc, dir, amt]) =>
    env.DB.prepare('INSERT INTO ledger (tx_id,account,direction,amount,memo,ref_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(tx, acc, dir, amt, memo, ref, now())))
  return tx
}

export async function ensureUser(env: Env, userId: string, nickname?: string) {
  let u: any = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first()
  if (!u) {
    await env.DB.prepare('INSERT INTO users (id,nickname,chips) VALUES (?,?,?)').bind(userId, nickname || '新玩家', 1000).run()
    await post(env, '新手免费币', userId, [['platform:faucet', 'D', 1000], [`user:${userId}:available`, 'C', 1000]])
    u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first()
  }
  return u
}

export async function claimFaucet(env: Env, userId: string) {
  const u: any = await ensureUser(env, userId)
  if (u.chips >= 200) throw new GameError('FAUCET_DENIED', '余额 ≥ 200 时不可领取免费币')
  await post(env, '每日免费币', userId, [['platform:faucet', 'D', 500], [`user:${userId}:available`, 'C', 500]])
  await env.DB.prepare('UPDATE users SET chips=chips+500 WHERE id=?').bind(userId).run()
  return ensureUser(env, userId)
}

// ─────────────────────────── 赔率（Agent-4） ───────────────────────────
export function fixedOdds(outcomes: any[], rake: number) {
  const o: Record<string, number> = {}
  for (const x of outcomes) o[x.id] = Math.max(1.05, Math.floor(((1 - rake) / x.story_weight) * 100) / 100)
  return o
}
export function parimutuelOdds(crowd: Record<string, number>, rake: number) {
  const pool = Object.values(crowd).reduce((a, b) => a + b, 0)
  const o: Record<string, number> = {}
  for (const k in crowd) o[k] = crowd[k] > 0 ? Math.max(1.01, Math.floor(((pool * (1 - rake)) / crowd[k]) * 100) / 100) : 0
  return o
}

async function loadNode(env: Env, nodeId: string) {
  const node: any = await env.DB.prepare('SELECT * FROM nodes WHERE id=? AND kind=?').bind(nodeId, 'cash').first()
  if (!node) throw new GameError('NODE_NOT_FOUND', 'Cash 节点不存在')
  const outcomes = (await env.DB.prepare('SELECT * FROM outcomes WHERE node_id=? ORDER BY story_weight DESC').bind(nodeId).all()).results as any[]
  return { node, cfg: J(node.config, {}), outcomes }
}

/** 变体抽取器：排除 Branch Registry 已看过；全看过 → 兜底/最久未看（经典重现） */
async function pickVariant(env: Env, userId: string, outcomeId: string, r: number) {
  const pool = (await env.DB.prepare(
    `SELECT v.* FROM variants v WHERE v.outcome_id=? AND v.status='pool'
     AND v.id NOT IN (SELECT variant_id FROM branch_registry WHERE user_id=?) ORDER BY v.is_fallback, v.id`
  ).bind(outcomeId, userId).all()).results as any[]
  const normal = pool.filter((v) => !v.is_fallback)
  if (normal.length) return { v: normal[Math.floor(r * normal.length)], reuse: false }
  if (pool.length) return { v: pool[0], reuse: false }
  const oldest: any = await env.DB.prepare(
    `SELECT v.* FROM variants v JOIN branch_registry b ON b.variant_id=v.id AND b.user_id=?
     WHERE v.outcome_id=? AND v.status='pool' ORDER BY b.seen_at ASC LIMIT 1`).bind(userId, outcomeId).first()
  if (!oldest) throw new GameError('POOL_EMPTY', '变体池为空且无兜底变体')
  return { v: oldest, reuse: true }
}

function render(v: any, nick: string) {
  // 表现层个性化（只改表现，不改结果语义）
  return (J(v.lines, []) as any[]).map((l) => ({ ...l, text: String(l.text).replace(/\{nick\}/g, nick) }))
}

// ─────────────────────────── OPEN + COMMIT + BETTING ───────────────────────────
export async function openRound(env: Env, p: { userId: string; nodeId: string; mode?: 'solo' | 'arena'; rewindOf?: string; rewindCount?: number }) {
  const user: any = await ensureUser(env, p.userId)
  if (user.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  const { node, cfg, outcomes } = await loadNode(env, p.nodeId)
  const mode = p.mode || 'solo'
  const roundId = uid('rd_')
  const seed = randomHex(32) // HSM 替身：服务端真随机

  // 结果抽取：按 story_weight 累积分布
  const r1 = await seedFloat(seed, 'outcome')
  let acc = 0, chosen = outcomes[outcomes.length - 1]
  const sorted = [...outcomes].sort((a, b) => a.id.localeCompare(b.id)) // 固定顺序便于复算
  for (const o of sorted) { acc += o.story_weight; if (r1 < acc) { chosen = o; break } }
  const r2 = await seedFloat(seed, 'variant')
  const { v: variant, reuse } = await pickVariant(env, p.userId, chosen.id, r2)
  const commit = await makeCommit(seed, roundId, chosen.id, variant.id)

  // 生成-播放分离：为每个结局簇各准备一个加密分片（真 + 诱饵），顺序随机、长度对齐
  const plains: { o: any; v: any; plain: string }[] = []
  for (const o of outcomes) {
    let v = variant
    if (o.id !== chosen.id) {
      const d: any = await env.DB.prepare(`SELECT * FROM variants WHERE outcome_id=? AND status='pool' ORDER BY RANDOM() LIMIT 1`).bind(o.id).first()
      v = d
    }
    plains.push({ o, v, plain: JSON.stringify({ outcome_id: o.id, label: o.label, variant_id: v.id, title: v.title, shot: v.shot, lines: render(v, user.nickname), video_url: v.video_url || null }) })
  }
  const maxBytes = Math.max(...plains.map((p) => new TextEncoder().encode(p.plain).length))
  const padTo = Math.max(4096, Math.ceil(maxBytes / 1024) * 1024)
  const slots: any[] = []
  for (const p of plains) slots.push({ outcome_id: p.o.id, variant_id: p.v.id, ...(await encryptSlot(p.plain, padTo)) })
  slots.sort(() => Math.random() - 0.5)
  const window = cfg.window_sec || 12
  const opened = now()

  // Arena：注入全网决策信号形成的“人群彩池”
  let crowd: Record<string, number> | null = null
  let odds: Record<string, number>
  if (mode === 'arena') {
    const sig = (await env.DB.prepare('SELECT outcome_id, SUM(votes) v FROM decision_signals WHERE node_id=? GROUP BY outcome_id').bind(p.nodeId).all()).results as any[]
    crowd = {}
    for (const o of outcomes) {
      const s = sig.find((x) => x.outcome_id === o.id)?.v || 100
      crowd[o.id] = Math.round(s * (0.8 + Math.random() * 0.4))
    }
    odds = parimutuelOdds(crowd, cfg.rake ?? 0.08)
  } else odds = fixedOdds(outcomes, cfg.rake ?? 0.08)

  await env.DB.prepare(
    `INSERT INTO rounds (id,user_id,series_id,node_id,mode,state,seed,outcome_id,variant_id,commit_hash,slots,odds,crowd,rewind_of,rewind_count,window_sec,opened_at,lock_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(roundId, p.userId, node.series_id, p.nodeId, mode, 'BETTING', seed, chosen.id, variant.id, commit,
    JSON.stringify(slots), JSON.stringify(odds), crowd ? JSON.stringify(crowd) : null, p.rewindOf || null, p.rewindCount || 0,
    window, opened, opened + (window + 3) * 1000).run() // +3s 为节点预告缓冲

  await appendEvent(env, roundId, 'OPEN', { node: p.nodeId, mode, rewind_of: p.rewindOf || null })
  await appendEvent(env, roundId, 'COMMIT', { commit })
  await appendEvent(env, roundId, 'BETTING', { window_sec: window, odds })

  const taxMul = p.rewindCount ? Math.pow(cfg.rewind?.tax || 1.5, p.rewindCount) : 1
  return {
    round_id: roundId, state: 'BETTING', mode, commit, node_id: p.nodeId, question: node.question,
    window_sec: window, lock_at: opened + (window + 3) * 1000, server_time: opened,
    min_bet: Math.ceil((cfg.min_bet || 10) * taxMul), rewind_count: p.rewindCount || 0,
    rewind: cfg.rewind, rake: cfg.rake, odds, crowd, reuse,
    options: outcomes.map((o) => ({ id: o.id, label: o.label, hint: o.hint, odds: odds[o.id], heat: crowd ? crowd[o.id] : null })),
    // 客户端只拿密文（不含 outcome 映射）
    encrypted: slots.map((s, i) => ({ slot: i, iv: s.iv, ct: s.ct })),
    balance: user.chips
  }
}

async function loadRound(env: Env, roundId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(roundId).first()
  if (!r) throw new GameError('ROUND_NOT_FOUND', '局不存在')
  return r
}

// ─────────────────────────── 下注（幂等 + 资金冻结） ───────────────────────────
export async function placeBet(env: Env, p: { roundId: string; userId: string; outcomeId: string; amount: number; idemKey: string }) {
  const dup: any = await env.DB.prepare('SELECT * FROM bets WHERE idem_key=?').bind(p.idemKey).first()
  if (dup) return { bet_id: dup.id, idempotent: true, amount: dup.amount, odds: dup.odds }
  const r = await loadRound(env, p.roundId)
  if (r.user_id !== p.userId) throw new GameError('FORBIDDEN', '非本人局')
  if (r.state !== 'BETTING') throw new GameError('NOT_BETTING', '当前不在下注窗口')
  if (now() > r.lock_at) throw new GameError('LOCKED', '已锁盘，本次下注未生效')
  const amount = Math.floor(Number(p.amount))
  const cfg = J((await env.DB.prepare('SELECT config FROM nodes WHERE id=?').bind(r.node_id).first<any>())?.config, {})
  const min = Math.ceil((cfg.min_bet || 10) * (r.rewind_count ? Math.pow(cfg.rewind?.tax || 1.5, r.rewind_count) : 1))
  if (!(amount >= min)) throw new GameError('MIN_BET', `最低下注 ${min} Chips`)
  const odds = J(r.odds, {})
  if (!(p.outcomeId in odds)) throw new GameError('BAD_OPTION', '无效选项')
  const existing = await env.DB.prepare(`SELECT COUNT(*) n FROM bets WHERE round_id=? AND status='placed'`).bind(p.roundId).first<any>()
  if (existing?.n) throw new GameError('ONE_BET', '每局仅可下一注，可先撤销')
  const u: any = await ensureUser(env, p.userId)
  if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
  if (u.chips < amount) throw new GameError('INSUFFICIENT', '余额不足')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const spent = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) s FROM bets WHERE user_id=? AND created_at>=? AND status!='cancelled'`).bind(p.userId, today.getTime()).first<any>()
  if ((spent?.s || 0) + amount > u.daily_limit) throw new GameError('DAILY_LIMIT', `超出日限额 ${u.daily_limit}，剩余 ${u.daily_limit - (spent?.s || 0)}`)

  const betId = uid('bet_')
  await env.DB.prepare('INSERT INTO bets (id,round_id,user_id,outcome_id,amount,odds,idem_key,created_at,rewind_tax) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(betId, p.roundId, p.userId, p.outcomeId, amount, odds[p.outcomeId], p.idemKey, now(), r.rewind_count ? Math.pow(1.5, r.rewind_count) : 1).run()
  await env.DB.prepare('UPDATE users SET chips=chips-?, frozen=frozen+? WHERE id=?').bind(amount, amount, p.userId).run()
  await post(env, '下注冻结', betId, [[`user:${p.userId}:available`, 'D', amount], [`user:${p.userId}:frozen`, 'C', amount]])
  await appendEvent(env, p.roundId, 'BET', { bet_id: betId, outcome: p.outcomeId, amount })
  // 平台决策信号回流
  await env.DB.prepare('INSERT INTO decision_signals (series_id,node_id,outcome_id,category,source,votes,created_at) SELECT ?,?,id,category,?,1,? FROM outcomes WHERE id=?')
    .bind(r.series_id, r.node_id, 'platform', now(), p.outcomeId).run()
  return { bet_id: betId, amount, odds: odds[p.outcomeId], balance: u.chips - amount }
}

export async function cancelBet(env: Env, p: { roundId: string; userId: string }) {
  const r = await loadRound(env, p.roundId)
  if (r.state !== 'BETTING' || now() > r.lock_at) throw new GameError('LOCKED', '已锁盘，不可撤销')
  const b: any = await env.DB.prepare(`SELECT * FROM bets WHERE round_id=? AND user_id=? AND status='placed'`).bind(p.roundId, p.userId).first()
  if (!b) throw new GameError('NO_BET', '无可撤销下注')
  if (now() - b.created_at > 2000) throw new GameError('UNDO_EXPIRED', '仅可在确认后 2 秒内撤销')
  await env.DB.prepare(`UPDATE bets SET status='cancelled' WHERE id=?`).bind(b.id).run()
  await env.DB.prepare('UPDATE users SET chips=chips+?, frozen=frozen-? WHERE id=?').bind(b.amount, b.amount, p.userId).run()
  await post(env, '撤销下注', b.id, [[`user:${p.userId}:frozen`, 'D', b.amount], [`user:${p.userId}:available`, 'C', b.amount]])
  await appendEvent(env, p.roundId, 'BET_CANCEL', { bet_id: b.id })
  return { ok: true }
}

// ─────────────────────────── LOCK → REVEAL → SETTLE（WF-07） ───────────────────────────
export async function lockRevealSettle(env: Env, p: { roundId: string; userId: string; early?: boolean }) {
  const r = await loadRound(env, p.roundId)
  if (r.user_id !== p.userId) throw new GameError('FORBIDDEN', '非本人局')
  if (r.state === 'SETTLE' || r.state === 'NEXT') return settledView(env, r)
  if (r.state !== 'BETTING') throw new GameError('BAD_STATE', '局状态异常: ' + r.state)
  // 局级锁（单写者）：CAS 迁移 BETTING → LOCK
  const cas = await env.DB.prepare(`UPDATE rounds SET state='LOCK' WHERE id=? AND state='BETTING'`).bind(r.id).run()
  if (!cas.meta.changes) return settledView(env, await loadRound(env, r.id))
  const bet: any = await env.DB.prepare(`SELECT * FROM bets WHERE round_id=? AND status='placed'`).bind(r.id).first()
  const odds = J(r.odds, {})
  let crowd = J(r.crowd, null)
  await appendEvent(env, r.id, 'LOCK', { bet: bet ? { o: bet.outcome_id, a: bet.amount } : null, odds })

  // REVEAL：只下发“真结果”分片的密钥
  const slots = J(r.slots, [])
  const idx = slots.findIndex((s: any) => s.outcome_id === r.outcome_id)
  await env.DB.prepare(`UPDATE rounds SET state='REVEAL' WHERE id=?`).bind(r.id).run()
  await appendEvent(env, r.id, 'REVEAL', { slot: idx })

  // SETTLE
  const cfg = J((await env.DB.prepare('SELECT config FROM nodes WHERE id=?').bind(r.node_id).first<any>())?.config, {})
  const rake = cfg.rake ?? 0.08
  let payout = 0, finalOdds = bet ? odds[bet.outcome_id] : 0
  if (bet) {
    const U = `user:${r.user_id}`
    const won = bet.outcome_id === r.outcome_id
    if (r.mode === 'arena' && crowd) {
      // parimutuel：(彩池 − rake) × 个人占赢方比例
      crowd[bet.outcome_id] = (crowd[bet.outcome_id] || 0) + bet.amount
      const pool = Object.values<number>(crowd).reduce((a, b) => a + b, 0)
      const net = Math.floor(pool * (1 - rake))
      const winStake = crowd[r.outcome_id]
      finalOdds = Math.floor((net / (crowd[bet.outcome_id] || 1)) * 100) / 100
      if (won) payout = Math.floor((net * bet.amount) / winStake)
      const rakeAmt = pool - net
      // 用户本金进彩池；彩池按比例派彩；抽水入平台；剩余返还人群
      await post(env, 'Arena 彩池结算', bet.id, [
        [`${U}:frozen`, 'D', bet.amount], ['arena:pool', 'C', bet.amount],
        ['arena:crowd', 'D', pool - bet.amount], ['arena:pool', 'C', pool - bet.amount],
        ['arena:pool', 'D', pool], ...(payout ? [[`${U}:available`, 'C', payout] as any] : []),
        ['platform:rake', 'C', rakeAmt], ['arena:crowd', 'C', pool - rakeAmt - payout]
      ])
    } else if (won) {
      payout = Math.floor(bet.amount * odds[bet.outcome_id])
      await post(env, '固定赔率派彩', bet.id, [
        [`${U}:frozen`, 'D', bet.amount], [`${U}:available`, 'C', bet.amount],
        ['platform:house', 'D', payout - bet.amount], [`${U}:available`, 'C', payout - bet.amount]
      ])
    } else {
      await post(env, '固定赔率收注', bet.id, [[`${U}:frozen`, 'D', bet.amount], ['platform:house', 'C', bet.amount]])
    }
    await env.DB.prepare('UPDATE bets SET status=?, payout=?, odds=? WHERE id=?').bind(won ? 'won' : 'lost', payout, finalOdds, bet.id).run()
    await env.DB.prepare('UPDATE users SET frozen=frozen-?, chips=chips+? WHERE id=?').bind(bet.amount, payout, r.user_id).run()
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO branch_registry (user_id,variant_id,seen_at) VALUES (?,?,?)`).bind(r.user_id, r.variant_id, now()),
    env.DB.prepare('UPDATE variants SET plays=plays+1 WHERE id=?').bind(r.variant_id),
    env.DB.prepare(`UPDATE rounds SET state='SETTLE', settled_at=?, crowd=? WHERE id=?`).bind(now(), crowd ? JSON.stringify(crowd) : null, r.id)
  ])
  await appendEvent(env, r.id, 'SETTLE', { outcome: r.outcome_id, variant: r.variant_id, payout, seed: r.seed })
  return settledView(env, await loadRound(env, r.id))
}

async function settledView(env: Env, r: any) {
  const slots = J(r.slots, [])
  const idx = slots.findIndex((s: any) => s.outcome_id === r.outcome_id)
  const bet: any = await env.DB.prepare(`SELECT * FROM bets WHERE round_id=? AND status IN ('won','lost')`).bind(r.id).first()
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  const oc: any = await env.DB.prepare('SELECT label FROM outcomes WHERE id=?').bind(r.outcome_id).first()
  const cfg = J((await env.DB.prepare('SELECT config FROM nodes WHERE id=?').bind(r.node_id).first<any>())?.config, {})
  return {
    round_id: r.id, state: r.state, reveal: { slot: idx, key: slots[idx]?.key },
    outcome_id: r.outcome_id, outcome_label: oc?.label, variant_id: r.variant_id,
    seed: r.seed, commit: r.commit_hash, crowd: J(r.crowd, null),
    bet: bet ? { outcome_id: bet.outcome_id, amount: bet.amount, odds: bet.odds, payout: bet.payout, won: bet.status === 'won' } : null,
    balance: u?.chips, rewind: { allowed: !!cfg.rewind?.allowed, used: r.rewind_count, max: cfg.rewind?.max_times || 2, tax: cfg.rewind?.tax || 1.5, fee: Math.ceil((cfg.min_bet || 10) * (cfg.rewind?.tax || 1.5)) }
  }
}

// ─────────────────────────── 悔棋 WF-04 ───────────────────────────
export async function rewind(env: Env, p: { roundId: string; userId: string }) {
  const r = await loadRound(env, p.roundId)
  if (r.user_id !== p.userId) throw new GameError('FORBIDDEN', '非本人局')
  if (r.state !== 'SETTLE') throw new GameError('BAD_STATE', '仅结算后可悔棋')
  const cfg = J((await env.DB.prepare('SELECT config FROM nodes WHERE id=?').bind(r.node_id).first<any>())?.config, {})
  const rw = cfg.rewind || {}
  if (!rw.allowed) throw new GameError('REWIND_DISABLED', '本节点不允许悔棋')
  if (r.rewind_count >= (rw.max_times || 2)) throw new GameError('REWIND_MAX', '悔棋次数已用尽')
  const u: any = await ensureUser(env, p.userId)
  // 冷静建议：30 分钟内悔棋 ≥4 次
  const recent = await env.DB.prepare(`SELECT COUNT(*) n FROM rounds WHERE user_id=? AND rewind_of IS NOT NULL AND opened_at>?`).bind(p.userId, now() - 1800000).first<any>()
  const fee = Math.ceil((cfg.min_bet || 10) * (rw.tax || 1.5))
  if (u.chips < fee) throw new GameError('INSUFFICIENT', `悔棋税 ${fee} Chips，余额不足`)
  await env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(fee, p.userId).run()
  await post(env, '悔棋税', r.id, [[`user:${p.userId}:available`, 'D', fee], ['platform:rewind_tax', 'C', fee]])
  await env.DB.prepare(`UPDATE rounds SET state='NEXT' WHERE id=?`).bind(r.id).run()
  await appendEvent(env, r.id, 'REWIND', { fee })
  const nr = await openRound(env, { userId: p.userId, nodeId: r.node_id, mode: r.mode, rewindOf: r.id, rewindCount: r.rewind_count + 1 })
  return { ...nr, rewind_fee: fee, cooloff_hint: (recent?.n || 0) >= 3 ? '30 分钟内已多次悔棋，建议休息 10 分钟' : null }
}

// ─────────────────────────── 公平验证 ───────────────────────────
export async function verifyRound(env: Env, roundId: string) {
  const r = await loadRound(env, roundId)
  if (!['SETTLE', 'NEXT'].includes(r.state)) return { round_id: roundId, state: r.state, commit: r.commit_hash, seed: null, message: '结算前种子不公开' }
  const recomputed = await makeCommit(r.seed, r.id, r.outcome_id, r.variant_id)
  const outcomes = ((await env.DB.prepare('SELECT id,label,story_weight FROM outcomes WHERE node_id=?').bind(r.node_id).all()).results as any[])
    .sort((a, b) => a.id.localeCompare(b.id))
  const r1 = await seedFloat(r.seed, 'outcome')
  let acc = 0, derived = outcomes[outcomes.length - 1]?.id
  for (const o of outcomes) { acc += o.story_weight; if (r1 < acc) { derived = o.id; break } }
  const events = (await env.DB.prepare('SELECT seq,type,payload,prev_hash,hash,created_at FROM round_events WHERE round_id=? ORDER BY seq').bind(roundId).all()).results as any[]
  let chainOk = true, prev = 'GENESIS'
  for (const e of events) {
    const h = await sha256(`${prev}|${roundId}|${e.seq}|${e.type}|${e.payload}`)
    if (h !== e.hash || e.prev_hash !== prev) chainOk = false
    prev = e.hash
  }
  return {
    round_id: roundId, seed: r.seed, commit: r.commit_hash, recomputed_commit: recomputed,
    commit_match: recomputed === r.commit_hash, outcome_id: r.outcome_id, variant_id: r.variant_id,
    random_value: r1, derived_outcome: derived, outcome_match: derived === r.outcome_id,
    weights: outcomes, event_chain_ok: chainOk, events,
    formula: 'commit = HMAC_SHA256(seed, round_id|outcome_id|variant_id)；r = HMAC(seed,"outcome") 前52bit / 2^52；按 outcome_id 字典序累积 story_weight 取首个 r<acc'
  }
}

// ─────────────────────────── 蒙特卡洛 EV 沙盘（Agent-4） ───────────────────────────
export function monteCarlo(weights: number[], rake: number, opts: { n?: number; rewindTax?: number; rewindMax?: number; minBet?: number; stake?: number } = {}) {
  const n = Math.min(opts.n || 20000, 100000)
  const odds = weights.map((w) => Math.max(1.05, Math.floor(((1 - rake) / w) * 100) / 100))
  const stake = opts.stake || 100
  const fee = Math.ceil((opts.minBet || 10) * (opts.rewindTax || 1.5))
  const strategies: Record<string, { profit: number; staked: number; wins: number }> = {}
  const pickers: Record<string, () => number> = {
    '押热门': () => weights.indexOf(Math.max(...weights)),
    '押冷门': () => weights.indexOf(Math.min(...weights)),
    '随机押': () => Math.floor(Math.random() * weights.length),
    '输了就悔棋': () => Math.floor(Math.random() * weights.length)
  }
  for (const [name, pick] of Object.entries(pickers)) {
    let profit = 0, staked = 0, wins = 0
    for (let i = 0; i < n; i++) {
      let tries = name === '输了就悔棋' ? 1 + (opts.rewindMax ?? 2) : 1
      for (let t = 0; t < tries; t++) {
        const k = pick()
        let r = Math.random(), acc = 0, res = weights.length - 1
        for (let j = 0; j < weights.length; j++) { acc += weights[j]; if (r < acc) { res = j; break } }
        const s = t === 0 ? stake : Math.ceil(stake * Math.pow(opts.rewindTax || 1.5, t))
        if (t > 0) profit -= fee
        staked += s
        if (k === res) { profit += s * (odds[k] - 1); wins++; break } else profit -= s
      }
    }
    strategies[name] = { profit, staked, wins }
  }
  const rows = Object.entries(strategies).map(([k, v]) => ({ strategy: k, player_ev_per_100: Math.round((v.profit / v.staked) * 10000) / 100, win_rate: Math.round((v.wins / n) * 1000) / 10 }))
  return { n, odds, rake, rows, arbitrage_risk: rows.some((r) => r.player_ev_per_100 > 0), platform_edge_pct: Math.round(rake * 1000) / 10 }
}

export { J }
