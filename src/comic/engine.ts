// 漫剧 Comic 引擎（Agent-4 结算 × Agent-7 剧本树）
// · 一次通关 = run；每个抉择点 = round（Commit-Reveal）
// · 后台机制概率：每局以种子派生“抖动”（jitter）扰动剧情权重 → 同一节点每次开局概率/赔率都不同
// · 悔棋两种变局：binary 二选一（排除刚发生的结局，剩余重算概率）/ plus 新变数（多出一个隐藏选项）
import { encryptSlot, hmac, randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import DATA from './data.json'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const COMIC: any = DATA
const NODES: Record<string, any> = Object.fromEntries(COMIC.nodes.map((n: any) => [n.id, n]))
export const ROOT = COMIC.nodes.find((n: any) => n.depth === 1).id
const SERIES = COMIC.series.id

export const DEFAULT_CFG = { jitter: 0.25, rake: 0.08, window_sec: 15, min_bet: 10, rewind_tax: 1.5, twist_weight: 0.25, max_rewinds: 2 }

export async function getConfig(env: Env) {
  const rows = (await env.DB.prepare('SELECT key,value FROM comic_config WHERE series_id=?').bind(SERIES).all()).results as any[]
  const cfg: any = { ...DEFAULT_CFG, overrides: {} as Record<string, Record<string, number>> }
  for (const r of rows) {
    if (r.key.startsWith('w:')) cfg.overrides[r.key.slice(2)] = J(r.value, {})
    else cfg[r.key] = Number(r.value)
  }
  return cfg
}
export async function setConfig(env: Env, patch: Record<string, any>) {
  const lim: Record<string, [number, number]> = { jitter: [0, 0.6], rake: [0.05, 0.1], window_sec: [8, 30], min_bet: [1, 1000], rewind_tax: [1.1, 3], twist_weight: [0.1, 0.5], max_rewinds: [0, 2] }
  const st: D1PreparedStatement[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'overrides') {
      for (const [nid, ws] of Object.entries<any>(v || {})) {
        if (!NODES[nid]) continue
        if (!ws) { st.push(env.DB.prepare('DELETE FROM comic_config WHERE series_id=? AND key=?').bind(SERIES, 'w:' + nid)); continue }
        const vals = Object.values<number>(ws).map(Number)
        const sum = vals.reduce((a, b) => a + b, 0)
        if (Math.abs(sum - 1) > 0.01 || vals.some((x) => x < 0.05 || x > 0.9)) throw new GameError('WEIGHT_RULE', `${nid} 权重和须为 1，单项 0.05–0.9`)
        st.push(env.DB.prepare('INSERT OR REPLACE INTO comic_config (series_id,key,value) VALUES (?,?,?)').bind(SERIES, 'w:' + nid, JSON.stringify(ws)))
      }
    } else if (lim[k]) {
      const n = Number(v)
      if (!(n >= lim[k][0] && n <= lim[k][1])) throw new GameError('CFG_RANGE', `${k} 取值 ${lim[k][0]}–${lim[k][1]}`)
      st.push(env.DB.prepare('INSERT OR REPLACE INTO comic_config (series_id,key,value) VALUES (?,?,?)').bind(SERIES, k, String(n)))
    }
  }
  if (st.length) await env.DB.batch(st)
  return getConfig(env)
}

// ───────── 机制概率：基础权重 → 后台覆盖 → 变局（二选一/新变数）→ 种子抖动 ─────────
export function baseOptions(node: any, cfg: any, mode: string, exclude: string[]) {
  const ov = cfg.overrides[node.id] || {}
  let opts = node.options.filter((o: any) => !o.twist).map((o: any) => ({ ...o, w: ov[o.id] ?? o.weight }))
  if (mode === 'binary' || mode === 'binary_plus') opts = opts.filter((o: any) => !exclude.includes(o.id))
  let s = opts.reduce((a: number, o: any) => a + o.w, 0)
  opts.forEach((o: any) => (o.w = o.w / s))
  if (mode === 'plus' || mode === 'binary_plus') {
    const tw = node.options.find((o: any) => o.twist)
    if (tw) {
      opts.forEach((o: any) => (o.w *= 1 - cfg.twist_weight))
      opts.push({ ...tw, w: cfg.twist_weight })
    }
  }
  return opts
}
export async function jitterWeights(seed: string, opts: any[], jitter: number) {
  const sorted = [...opts].sort((a, b) => a.id.localeCompare(b.id))
  for (const o of sorted) o.jw = Math.max(0.03, o.w * (1 + jitter * (2 * (await seedFloat(seed, 'jitter:' + o.id)) - 1)))
  const s = sorted.reduce((a, o) => a + o.jw, 0)
  sorted.forEach((o) => (o.p = Math.round((o.jw / s) * 10000) / 10000))
  // 修正舍入：保证和为 1
  sorted[sorted.length - 1].p = Math.round((1 - sorted.slice(0, -1).reduce((a, o) => a + o.p, 0)) * 10000) / 10000
  return sorted
}
export async function pickOutcome(seed: string, sorted: any[]) {
  const r = await seedFloat(seed, 'outcome')
  let acc = 0
  for (const o of sorted) { acc += o.p; if (r < acc) return { o, r } }
  return { o: sorted[sorted.length - 1], r }
}
const oddsOf = (p: number, rake: number) => Math.max(1.05, Math.floor(((1 - rake) / p) * 100) / 100)

function segPayload(o: any) {
  const seg = COMIC.segments[o.id]
  return JSON.stringify({ option_id: o.id, label: o.label, twist: !!o.twist, title: seg.title, mood: seg.mood, image: seg.image_url, lines: seg.lines, next: o.next, ending_title: o.ending_title })
}

async function openRound(env: Env, run: any, nodeId: string, p: { mode?: string; exclude?: string[]; rewindNo?: number; rewindOf?: string }) {
  const node = NODES[nodeId]
  if (!node) throw new GameError('NODE_NOT_FOUND', '抉择节点不存在')
  const cfg = await getConfig(env)
  const mode = p.mode || 'normal'
  const seed = randomHex(32)
  const rid = uid('cr_')
  const sorted = await jitterWeights(seed, baseOptions(node, cfg, mode, p.exclude || []), cfg.jitter)
  const { o: chosen } = await pickOutcome(seed, sorted)
  const optIds = sorted.map((o) => o.id).join(',')
  const commit = await hmac(seed, `${rid}|${chosen.id}|${optIds}`)
  // 生成-播放分离：所有选项等长密文，客户端可预载全部分镜/配音，揭晓时只下发真分片密钥
  const plains = sorted.map((o) => ({ id: o.id, plain: segPayload(o) }))
  const maxB = Math.max(...plains.map((x) => new TextEncoder().encode(x.plain).length))
  const padTo = Math.ceil(maxB / 512) * 512
  const slots: any[] = []
  for (const x of plains) slots.push({ option_id: x.id, ...(await encryptSlot(x.plain, padTo)) })
  slots.sort(() => Math.random() - 0.5)
  const options = sorted.map((o) => ({ id: o.id, label: o.label, hint: o.hint, twist: !!o.twist, category: o.category, base: o.w, p: o.p, odds: oddsOf(o.p, cfg.rake) }))
  const t = now()
  const lockAt = t + (cfg.window_sec + 2) * 1000
  await env.DB.prepare(`INSERT INTO comic_rounds (id,run_id,user_id,node_id,mode,state,seed,options,outcome_id,commit_hash,slots,rewind_no,rewind_of,jitter,lock_at,opened_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid, run.id, run.user_id, nodeId, mode, 'BETTING', seed, JSON.stringify({ options, exclude: p.exclude || [] }),
    chosen.id, commit, JSON.stringify(slots), p.rewindNo || 0, p.rewindOf || null, cfg.jitter, lockAt, t).run()
  await env.DB.prepare('UPDATE comic_runs SET node_id=? WHERE id=?').bind(nodeId, run.id).run()
  const taxMul = Math.pow(cfg.rewind_tax, p.rewindNo || 0)
  return {
    round_id: rid, node_id: nodeId, depth: node.depth, question: node.question, mode, commit, rewind_no: p.rewindNo || 0,
    window_sec: cfg.window_sec, lock_at: lockAt, server_time: t, min_bet: Math.ceil(cfg.min_bet * taxMul), jitter: cfg.jitter,
    options, preload: sorted.map((o) => ({ image: COMIC.segments[o.id].image_url, audio: COMIC.segments[o.id].lines?.[0]?.audio })),
    encrypted: slots.map((s, i) => ({ slot: i, iv: s.iv, ct: s.ct })),
    excluded: (p.exclude || []).map((id) => ({ id, label: NODES[nodeId].options.find((o: any) => o.id === id)?.label }))
  }
}

export async function startRun(env: Env, userId: string, nick?: string) {
  const u: any = await ensureUser(env, userId, nick)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  const id = uid('run_')
  await env.DB.prepare('INSERT INTO comic_runs (id,user_id,series_id,node_id,created_at) VALUES (?,?,?,?,?)').bind(id, userId, SERIES, ROOT, now()).run()
  const run = { id, user_id: userId }
  const round = await openRound(env, run, ROOT, {})
  return { run_id: id, series: COMIC.series, prologue: COMIC.prologue.map((sid: string) => ({ id: sid, ...COMIC.segments[sid] })), round, balance: u.chips, total_nodes: COMIC.nodes.length }
}

async function loadRound(env: Env, id: string, userId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM comic_rounds WHERE id=?').bind(id).first()
  if (!r) throw new GameError('ROUND_NOT_FOUND', '局不存在')
  if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
  return r
}

export async function bet(env: Env, p: { roundId: string; userId: string; optionId: string; amount: number }) {
  const r = await loadRound(env, p.roundId, p.userId)
  if (r.state !== 'BETTING' || now() > r.lock_at) throw new GameError('LOCKED', '已锁盘，本次下注未生效')
  if (r.bet_option) throw new GameError('ONE_BET', '本局已下注')
  const cfg = await getConfig(env)
  const opt = J(r.options).options.find((o: any) => o.id === p.optionId)
  if (!opt) throw new GameError('BAD_OPTION', '无效选项')
  const amount = Math.floor(Number(p.amount))
  const min = Math.ceil(cfg.min_bet * Math.pow(cfg.rewind_tax, r.rewind_no))
  if (!(amount >= min)) throw new GameError('MIN_BET', `最低下注 ${min} Chips`)
  const u: any = await ensureUser(env, p.userId)
  if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
  if (u.chips < amount) throw new GameError('INSUFFICIENT', '余额不足')
  // CAS：防并发重复下注
  const cas = await env.DB.prepare(`UPDATE comic_rounds SET bet_option=?, bet_amount=?, bet_odds=? WHERE id=? AND bet_option IS NULL AND state='BETTING'`).bind(p.optionId, amount, opt.odds, r.id).run()
  if (!cas.meta.changes) throw new GameError('ONE_BET', '本局已下注')
  await env.DB.prepare('UPDATE users SET chips=chips-?, frozen=frozen+? WHERE id=?').bind(amount, amount, p.userId).run()
  await post(env, '漫剧下注冻结', r.id, [[`user:${p.userId}:available`, 'D', amount], [`user:${p.userId}:frozen`, 'C', amount]])
  await env.DB.prepare('INSERT INTO decision_signals (series_id,node_id,outcome_id,category,source,votes,created_at) VALUES (?,?,?,?,?,1,?)').bind(SERIES, r.node_id, p.optionId, opt.category, 'platform', now()).run()
  return { ok: true, amount, odds: opt.odds, balance: u.chips - amount }
}

export async function settle(env: Env, p: { roundId: string; userId: string }) {
  const r = await loadRound(env, p.roundId, p.userId)
  if (r.state === 'BETTING') {
    const cas = await env.DB.prepare(`UPDATE comic_rounds SET state='SETTLE', settled_at=? WHERE id=? AND state='BETTING'`).bind(now(), r.id).run()
    if (cas.meta.changes && r.bet_option) {
      const U = `user:${r.user_id}`
      const won = r.bet_option === r.outcome_id
      const payout = won ? Math.floor(r.bet_amount * r.bet_odds) : 0
      if (won) await post(env, '漫剧派彩', r.id, [[`${U}:frozen`, 'D', r.bet_amount], [`${U}:available`, 'C', r.bet_amount], ['platform:house', 'D', payout - r.bet_amount], [`${U}:available`, 'C', payout - r.bet_amount]])
      else await post(env, '漫剧收注', r.id, [[`${U}:frozen`, 'D', r.bet_amount], ['platform:house', 'C', r.bet_amount]])
      await env.DB.prepare('UPDATE users SET frozen=frozen-?, chips=chips+? WHERE id=?').bind(r.bet_amount, payout, r.user_id).run()
      await env.DB.prepare('UPDATE comic_rounds SET payout=? WHERE id=?').bind(payout, r.id).run()
      await env.DB.prepare('UPDATE comic_runs SET pnl=pnl+? WHERE id=?').bind(payout - r.bet_amount, r.run_id).run()
    }
  }
  const s: any = await env.DB.prepare('SELECT * FROM comic_rounds WHERE id=?').bind(r.id).first()
  const slots = J(s.slots, [])
  const idx = slots.findIndex((x: any) => x.option_id === s.outcome_id)
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(s.user_id).first()
  const node = NODES[s.node_id]
  const regular = node.options.filter((o: any) => !o.twist).length
  const cfg = await getConfig(env)
  const used = s.rewind_no
  // 悔棋可选变局：二选一（需剩余 ≥2 个常规选项）/ 新变数（本节点有隐藏选项且尚未加入）
  const excl: string[] = J(s.options).exclude || []
  const hasTwist = J(s.options).options.some((o: any) => o.twist)
  const outcomeIsTwist = J(s.options).options.find((o: any) => o.id === s.outcome_id)?.twist
  const remainingRegular = regular - excl.length - (outcomeIsTwist ? 0 : 1)
  const rewindModes = used >= cfg.max_rewinds ? [] : [
    ...(remainingRegular >= 2 ? [{ mode: 'binary', label: '二选一', desc: `排除「${node.options.find((o: any) => o.id === s.outcome_id)?.label}」，剩余选项重算概率与赔率` }] : []),
    ...(!hasTwist && node.options.some((o: any) => o.twist) ? [{ mode: 'plus', label: '新变数', desc: '保留原选项，并多出一个隐藏选项（概率/赔率重新分配）' }] : [])
  ]
  return {
    round_id: s.id, outcome_id: s.outcome_id, reveal: { slot: idx, key: slots[idx]?.key }, seed: s.seed, commit: s.commit_hash,
    bet: s.bet_option ? { option_id: s.bet_option, amount: s.bet_amount, odds: s.bet_odds, payout: s.payout, won: s.bet_option === s.outcome_id } : null,
    balance: u?.chips, rewind: { used, max: cfg.max_rewinds, fee: Math.ceil(cfg.min_bet * Math.pow(cfg.rewind_tax, used + 1)), modes: rewindModes }
  }
}

export async function rewind(env: Env, p: { roundId: string; userId: string; mode: 'binary' | 'plus' }) {
  const r = await loadRound(env, p.roundId, p.userId)
  if (r.state !== 'SETTLE') throw new GameError('BAD_STATE', '仅揭晓后可悔棋')
  const st: any = await settle(env, p)
  const m = st.rewind.modes.find((x: any) => x.mode === p.mode)
  if (!m) throw new GameError('REWIND_DENIED', '该悔棋变局不可用或次数已用尽')
  const fee = st.rewind.fee
  const u: any = await ensureUser(env, p.userId)
  if (u.chips < fee) throw new GameError('INSUFFICIENT', `悔棋税 ${fee} Chips，余额不足`)
  const cas = await env.DB.prepare(`UPDATE comic_rounds SET state='REWOUND' WHERE id=? AND state='SETTLE'`).bind(r.id).run()
  if (!cas.meta.changes) throw new GameError('BAD_STATE', '已悔棋')
  await env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(fee, p.userId).run()
  await post(env, '漫剧悔棋税', r.id, [[`user:${p.userId}:available`, 'D', fee], ['platform:rewind_tax', 'C', fee]])
  await env.DB.prepare('UPDATE comic_runs SET rewinds=rewinds+1, pnl=pnl-? WHERE id=?').bind(fee, r.run_id).run()
  const prev = J(r.options)
  const prevMode = r.mode
  const exclude = [...(prev.exclude || [])]
  let mode = p.mode as string
  if (p.mode === 'binary') exclude.push(r.outcome_id)
  // 叠加：先二选一再新变数 = binary_plus；先新变数再二选一 = binary_plus（排除刚发生的结局）
  if ((p.mode === 'binary' && prevMode.includes('plus')) || (p.mode === 'plus' && prevMode.includes('binary'))) mode = 'binary_plus'
  const run: any = await env.DB.prepare('SELECT * FROM comic_runs WHERE id=?').bind(r.run_id).first()
  const nr = await openRound(env, run, r.node_id, { mode, exclude, rewindNo: r.rewind_no + 1, rewindOf: r.id })
  return { ...nr, rewind_fee: fee, balance: u.chips - fee, changed: m }
}

export async function advance(env: Env, p: { roundId: string; userId: string }) {
  const r = await loadRound(env, p.roundId, p.userId)
  if (r.state !== 'SETTLE') throw new GameError('BAD_STATE', '请先揭晓')
  const run: any = await env.DB.prepare('SELECT * FROM comic_runs WHERE id=?').bind(r.run_id).first()
  if (run.status !== 'playing') throw new GameError('RUN_ENDED', '本局漫剧已结束')
  const node = NODES[r.node_id]
  const opt = node.options.find((o: any) => o.id === r.outcome_id)
  const path = J(run.path, [])
  if (!path.find((x: any) => x.round === r.id)) path.push({ round: r.id, node: r.node_id, q: node.question, option: opt.id, label: opt.label, twist: !!opt.twist, mode: r.mode, bet: r.bet_option, won: r.bet_option === r.outcome_id })
  await env.DB.prepare(`UPDATE comic_rounds SET state='NEXT' WHERE id=?`).bind(r.id).run()
  if (!opt.next) {
    await env.DB.prepare(`UPDATE comic_runs SET path=?, status='ended', ending_id=?, ended_at=? WHERE id=?`).bind(JSON.stringify(path), opt.id, now(), run.id).run()
    const fin: any = await env.DB.prepare('SELECT pnl, rewinds FROM comic_runs WHERE id=?').bind(run.id).first()
    const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(p.userId).first()
    return { ended: true, ending: { id: opt.id, title: opt.ending_title || opt.label, twist: !!opt.twist }, path, pnl: fin.pnl, rewinds: fin.rewinds, balance: u.chips, total_endings: totalEndings() }
  }
  await env.DB.prepare('UPDATE comic_runs SET path=? WHERE id=?').bind(JSON.stringify(path), run.id).run()
  return { ended: false, round: await openRound(env, run, opt.next, {}), path }
}

export async function verify(env: Env, roundId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM comic_rounds WHERE id=?').bind(roundId).first()
  if (!r) throw new GameError('ROUND_NOT_FOUND', '局不存在')
  if (r.state === 'BETTING') return { round_id: roundId, commit: r.commit_hash, seed: null, message: '揭晓前种子不公开' }
  const opts = J(r.options).options
  const base = opts.map((o: any) => ({ id: o.id, w: o.base }))
  const sorted = await jitterWeights(r.seed, base, r.jitter)
  const { o, r: rv } = await pickOutcome(r.seed, sorted)
  const commit = await hmac(r.seed, `${r.id}|${r.outcome_id}|${sorted.map((x) => x.id).join(',')}`)
  return {
    round_id: r.id, seed: r.seed, commit: r.commit_hash, recomputed_commit: commit, commit_match: commit === r.commit_hash,
    jitter: r.jitter, mode: r.mode, random_value: rv, derived_outcome: o.id, outcome_match: o.id === r.outcome_id,
    weights: sorted.map((x) => ({ id: x.id, label: opts.find((y: any) => y.id === x.id)?.label, base: x.w, final: x.p })),
    formula: 'p_i = norm(base_i × (1 + jitter × (2·HMAC(seed,"jitter:"+id)→[0,1) − 1)))；r = HMAC(seed,"outcome")→[0,1)；按 id 字典序累积 p 取首个 r<acc；commit = HMAC(seed, round|outcome|ids)'
  }
}

export function totalEndings() {
  return COMIC.nodes.reduce((a: number, n: any) => a + n.options.filter((o: any) => !o.next).length, 0)
}

export async function myEndings(env: Env, userId: string) {
  const rows = (await env.DB.prepare(`SELECT DISTINCT ending_id FROM comic_runs WHERE user_id=? AND status='ended'`).bind(userId).all()).results as any[]
  return rows.map((r) => r.ending_id)
}

// ───────── 后台：全树蒙特卡洛（按当前机制参数模拟完整通关，统计结局分布与分支到达） ─────────
export async function simulateTree(env: Env, n = 2000) {
  const cfg = await getConfig(env)
  const endings: Record<string, number> = {}, reach: Record<string, number> = {}
  const N = Math.min(n, 5000)
  for (let i = 0; i < N; i++) {
    let nid = ROOT, guard = 0
    while (nid && guard++ < 10) {
      const node = NODES[nid]
      const opts = baseOptions(node, cfg, 'normal', [])
      const jw = opts.map((o: any) => o.w * (1 + cfg.jitter * (2 * Math.random() - 1)))
      const s = jw.reduce((a: number, b: number) => a + b, 0)
      let r = Math.random() * s, k = 0
      while (r > jw[k] && k < jw.length - 1) { r -= jw[k]; k++ }
      const o = opts[k]
      reach[o.id] = (reach[o.id] || 0) + 1
      if (!o.next) { endings[o.id] = (endings[o.id] || 0) + 1; break }
      nid = o.next
    }
  }
  const list = Object.entries(endings).map(([id, c]) => {
    const node = COMIC.nodes.find((x: any) => x.options.some((o: any) => o.id === id))
    const o = node.options.find((x: any) => x.id === id)
    return { id, title: o.ending_title || o.label, count: c, pct: Math.round((c / N) * 10000) / 100 }
  }).sort((a, b) => b.count - a.count)
  return { n: N, jitter: cfg.jitter, distinct_endings: list.length, total_regular_endings: COMIC.nodes.reduce((a: number, x: any) => a + x.options.filter((o: any) => !o.twist && !o.next).length, 0), endings: list, reach }
}

export async function comicStats(env: Env) {
  const rows = (await env.DB.prepare(`SELECT node_id, outcome_id, mode, COUNT(*) n, SUM(CASE WHEN bet_option IS NOT NULL THEN 1 ELSE 0 END) bets, COALESCE(SUM(bet_amount),0) stake, COALESCE(SUM(payout),0) paid FROM comic_rounds WHERE state IN ('SETTLE','NEXT','REWOUND') GROUP BY node_id, outcome_id, mode`).all()).results as any[]
  const runs: any = await env.DB.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN status='ended' THEN 1 ELSE 0 END) ended, COALESCE(SUM(rewinds),0) rewinds, COALESCE(SUM(pnl),0) pnl FROM comic_runs`).first()
  const modes = (await env.DB.prepare(`SELECT mode, COUNT(*) n FROM comic_rounds GROUP BY mode`).all()).results
  const ends = (await env.DB.prepare(`SELECT ending_id, COUNT(*) n FROM comic_runs WHERE status='ended' GROUP BY ending_id ORDER BY n DESC`).all()).results
  return { rows, runs, modes, endings: ends }
}
export { sha256 }
