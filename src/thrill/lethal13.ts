// 致命13 v3 —— 监狱俄罗斯轮盘（六孔左轮）· 一张押注单押前三轮 · 每轮还能追注 · 3~5 轮 + 决斗
// ─────────────────────────────────────────────────────────────────────────────
// 剧情（只由种子决定，与任何人的下注无关；开局公开 commit，结束公开 seed 可复算）：
// · 13 人侧身单列成环，后者举枪对着前者；第 k 轮每把枪装 k 发（六孔），灯亮同时扣扳机：某人倒下 ⇔ 他身后那把枪响了
// · 固定 3 轮；第 3 轮后若仍 ≥5 人 → 加赛第 4 轮（4 发）；之后仍 ≥5 人 → 加赛第 5 轮（5 发）。最多 5 轮
// · 环形结束：≥3 人 → 主持人按种子抽 2 人决斗，其余活着离场；2 人直接决斗；1 人即为赢家。决斗第 d 枪各装 min(d,5) 发
// · 任何一枪若全员死亡 → 敲杖作废重来（保证唯一幸存者）。第 k 轮第 t 次尝试第 i 把枪响 ⇔ HMAC(seed,"r:k:t:i") < k/6
// 下注（三种，互不影响）：
// ① 押注单（主注，开局一次性下完）：分别押「第 1/2/3 轮过后剩几人」各一档 → 结算按命中数综合赔付：
//    中 1 档小赔、中 2 档翻倍、三档全中 = 大奖倍率 + 瓜分奖池。赔率按本单三档的联合真实概率精确计算，任何押法期望恒为 slip_rtp
// ② 每轮追注（可选）：每轮开枪前 8 秒，按当轮人数押「这一轮过后剩几人」，独立结算，押错不影响后续
// ③ 押冠军（可选）：开局押最后活下来的号码
// 时长约束：开局押单 ≤30s；每轮 ≈25s（押 8s + 上弹 5s + 齐射 4s + 倒地特写 ≤3 段）；最长 5 轮 + 决斗 ≈ 3.5 分钟；15 分钟未完成自动按种子结算
import { randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export const L13_SERIES = 'l13_deadly13'
export const PRISONERS = ['老鬼', '刀疤', '眼镜', '小四', '和尚', '阿彪', '哑巴', '老K', '黑皮', '书生', '二愣', '胖虎', '阿森'].map((name, i) => ({ id: i + 1, name }))
export const L13_CFG = {
  step_rtp: 0.94,          // 每轮追注：赔率 = step_rtp / 档概率 → 任何押法期望恒为 94%
  slip_rtp: 0.93,          // 押注单：中 1/2/3 档的赔付份额之和（期望返还 93%）
  slip_share: { 1: 0.12, 2: 0.36, 3: 0.45 } as Record<number, number>,
  slip_min_p3: 0.004,      // 三档全中概率低于 0.4% 的组合（自相矛盾）不收
  ring_base: 3, ring_max: 5, extra_min_alive: 5,
  rake: 0.02,              // 注金 2% 注入奖池
  stakes: [10, 20, 50, 100, 200],
  pick_sec: 8,
  jackpot_share: 0.2,
  jackpot_cap_mult: 200,
  champ_rtp: 0.92,        // 押冠军（开局押最后活下来的号码，1/13）赔率 = 0.92 × 13
  max_mult: 2000,
  seed_pool: 30000,
  max_open_per_ip: 2,
  jackpot_min_age_h: 24
}
const POOL = `pool:thrill:${L13_SERIES}`
export const bulletsAt = (k: number) => Math.min(k, 5)

// ─────────── 概率与分档 ───────────
const C = (n: number, r: number) => { let x = 1; for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i; return x }
/** n 人、每人中枪概率 p，条件于「至少 1 人存活」（全灭作废重开）→ 存活人数分布 */
export function survivorDist(n: number, b: number) {
  const p = b / 6, q = 1 - p, norm = 1 - Math.pow(p, n)
  const d: Record<number, number> = {}
  for (let s = 1; s <= n; s++) d[s] = (C(n, s) * Math.pow(q, s) * Math.pow(p, n - s)) / norm
  return d
}
/** 把存活人数 1..n 切成连续的 2~3 档，使每档概率尽量接近均分；赔率 = step_rtp / 档概率 */
export function tiersFor(n: number, b: number, rtp = L13_CFG.step_rtp, dist?: Record<number, number>) {
  const d = dist || survivorDist(n, b), vals = Array.from({ length: n }, (_, i) => n - i) // 从多到少
  const P = (a: number[]) => a.reduce((x, s) => x + d[s], 0)
  let best: number[][] = [vals], score = Infinity
  const k = n >= 3 ? 3 : 2
  if (k === 2) best = [[vals[0]], vals.slice(1)]
  else for (let i = 1; i < vals.length - 1; i++) for (let j = i + 1; j < vals.length; j++) {
    const g = [vals.slice(0, i), vals.slice(i, j), vals.slice(j)], ps = g.map(P)
    if (ps.some((x) => x < 0.04)) continue
    const sc = Math.max(...ps.map((x) => Math.abs(x - 1 / 3)))
    if (sc < score) { score = sc; best = g }
  }
  if (score === Infinity && k === 3) { // 尾部概率过小 → 退化为两档
    let b2: number[][] = [vals], s2 = Infinity
    for (let i = 1; i < vals.length; i++) { const g = [vals.slice(0, i), vals.slice(i)], ps = g.map(P); const sc = Math.abs(ps[0] - 0.5); if (sc < s2) { s2 = sc; b2 = g } }
    best = b2
  }
  return best.map((g, i) => {
    const p = P(g), hi = g[0], lo = g[g.length - 1]
    const label = hi === lo ? `剩 ${hi} 人` : lo === 1 ? `剩 ${hi} 人及以下` : hi === n || (dist && !d[hi + 1]) ? `剩 ${lo} 人及以上` : `剩 ${lo}~${hi} 人`
    return { id: 't' + i, label, lo, hi, p, odds: Math.max(1.01, Math.floor((rtp / p) * 100) / 100) }
  })
}

// ─────────── 整局（只由种子决定） ───────────
export const RING_ROUNDS = 3 // 押注单覆盖的轮数（之后最多加赛到 ring_max）
const ringMore = (k: number, alive: number) => k <= L13_CFG.ring_base || (k <= L13_CFG.ring_max && alive >= L13_CFG.extra_min_alive)
export type Shot = { d: number; bullets: number; voids: number; fired: number[]; dead: number[] }
export type Round = { k: number; type: 'ring' | 'duel'; extra?: boolean; bullets: number; before: number[]; voids: number; fired: number[]; dead: number[]; after: number[]; pair?: number[]; released?: number[]; shots?: Shot[] }
export async function fullGame(seed: string) {
  let alive = PRISONERS.map((p) => p.id)
  const rounds: Round[] = []
  // 环形三轮
  for (let k = 1; alive.length > 1 && ringMore(k, alive.length); k++) {
    const b = k, n = alive.length
    let t = 0, fired: number[] = [], dead: number[] = []
    for (; t < 50; t++) {
      fired = []; dead = []
      for (let i = 0; i < n; i++) if ((await seedFloat(seed, `r:${k}:${t}:${i}`)) < b / 6) fired.push(alive[i])
      for (let i = 0; i < n; i++) if (fired.includes(alive[(i - 1 + n) % n])) dead.push(alive[i])
      if (dead.length < n) break
    }
    const after = alive.filter((x) => !dead.includes(x))
    rounds.push({ k, type: 'ring', extra: k > L13_CFG.ring_base, bullets: b, before: alive, voids: t, fired, dead, after })
    alive = after
  }
  // 决斗
  if (alive.length >= 2) {
    const before = alive
    let pair = alive
    if (alive.length > 2) {
      const order = await Promise.all(alive.map(async (id) => ({ id, r: await seedFloat(seed, `pick:${id}`) })))
      pair = order.sort((a, b) => a.r - b.r).slice(0, 2).map((x) => x.id).sort((a, b) => a - b)
    }
    const released = alive.filter((x) => !pair.includes(x))
    const shots: Shot[] = []
    let winner = 0
    for (let d = 1; d <= 60 && !winner; d++) {
      const b = Math.min(d, 5)
      let t = 0, fired: number[] = [], dead: number[] = []
      for (; t < 50; t++) {
        fired = []
        for (let i = 0; i < 2; i++) if ((await seedFloat(seed, `d:${d}:${t}:${i}`)) < b / 6) fired.push(pair[i])
        dead = pair.filter((_, i) => fired.includes(pair[1 - i]))
        if (dead.length < 2) break
      }
      shots.push({ d, bullets: b, voids: t, fired, dead })
      if (dead.length === 1) winner = pair.find((x) => !dead.includes(x))!
    }
    const allDead = shots.flatMap((x) => x.dead)
    rounds.push({ k: rounds.length + 1, type: 'duel', bullets: 0, before, voids: 0, fired: [], dead: allDead, after: [winner], pair, released, shots })
  }
  return rounds
}
// ─────────── 押注单：三轮的边缘分布、分档、联合概率 → 综合赔率 ───────────
const step = (dist: Record<number, number>, b: number) => {
  const out: Record<number, number> = {}
  for (const [s0, p0] of Object.entries(dist)) {
    const s = +s0
    if (s <= 1) { out[1] = (out[1] || 0) + p0; continue } // 只剩 1 人：之后人数不再变化
    for (const [s1, p1] of Object.entries(survivorDist(s, b))) out[+s1] = (out[+s1] || 0) + p0 * p1
  }
  return out
}
export const SLIP_DIST: Record<number, number>[] = (() => { const a: Record<number, number>[] = []; let d: Record<number, number> = { 13: 1 }; for (let k = 1; k <= RING_ROUNDS; k++) { d = step(d, k); a.push(d) } return a })()
export const SLIP_BINS = SLIP_DIST.map((d) => tiersFor(13, 1, L13_CFG.step_rtp, d).map(({ id, label, lo, hi, p }) => ({ id, label, lo, hi, p })))
/** 三档联合：按命中数 h=0..3 的精确概率 */
export function slipProbs(picks: string[]) {
  const bins = picks.map((id, k) => SLIP_BINS[k].find((b) => b.id === id))
  if (bins.length !== RING_ROUNDS || bins.some((b) => !b)) throw new GameError('BAD_SLIP', '押注单要三轮各选一档')
  let f: Record<string, number> = { '13:0': 1 }
  for (let k = 1; k <= RING_ROUNDS; k++) {
    const g: Record<string, number> = {}, b = bins[k - 1]!
    for (const [key, p0] of Object.entries(f)) {
      const [s, h] = key.split(':').map(Number)
      const nx = s <= 1 ? { 1: 1 } : survivorDist(s, k)
      for (const [s1, p1] of Object.entries(nx)) { const hit = +s1 >= b.lo && +s1 <= b.hi ? 1 : 0, kk = `${s1}:${h + hit}`; g[kk] = (g[kk] || 0) + p0 * p1 }
    }
    f = g
  }
  const P = [0, 0, 0, 0]; for (const [key, p] of Object.entries(f)) P[+key.split(':')[1]] += p
  return { bins: bins as any[], P }
}
export function slipQuote(picks: string[]) {
  const { bins, P } = slipProbs(picks)
  const mult: Record<number, number> = { 0: 0 }
  for (const h of [1, 2, 3]) mult[h] = P[h] > 0 ? Math.min(L13_CFG.max_mult, Math.floor((L13_CFG.slip_share[h] / P[h]) * 100) / 100) : 0
  return { picks, bins: bins.map((b, i) => ({ k: i + 1, ...b })), P, mult, ok: P[3] >= L13_CFG.slip_min_p3, ev: Math.round((P[1] * mult[1] + P[2] * mult[2] + P[3] * mult[3]) * 1000) / 1000 }
}
const survAfter = (g: Round[], k: number) => { const ring = g.filter((r) => r.type === 'ring'); return (ring[k - 1] || ring[ring.length - 1]).after.length }
export function slipResult(g: Round[], picks: string[], quote = slipQuote(picks)) {
  const res = quote.bins.map((b: any) => { const s = survAfter(g, b.k); return { k: b.k, id: b.id, label: b.label, actual: s, hit: s >= b.lo && s <= b.hi } })
  const hits = res.filter((x) => x.hit).length
  return { rows: res, hits, mult: quote.mult[hits] || 0 }
}
// ─────────── 资金 ───────────
async function poolBalance(env: Env) {
  const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL).first()
  return r?.b || 0
}
async function ensurePool(env: Env) {
  const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL).first()
  if (!r) await post(env, '致命13奖池·上线注资', L13_SERIES, [['platform:house', 'D', L13_CFG.seed_pool], [POOL, 'C', L13_CFG.seed_pool]])
}

/** 每轮追注选项：环形 = 当轮存活人数分档；决斗 = 押哪个号码活（对称 50%） */
export function optionsFor(r: Round) {
  if (r.type === 'duel') return r.pair!.map((id) => ({ id: 'n' + id, label: `${id} 号 · ${PRISONERS[id - 1].name}`, lo: id, hi: id, p: 0.5, odds: Math.floor((L13_CFG.step_rtp / 0.5) * 100) / 100 }))
  return tiersFor(r.before.length, r.bullets)
}
const roundCard = (r: Round, total: number) => ({ k: r.k, type: r.type, extra: !!r.extra, bullets: r.bullets, alive: r.before, pair: r.pair || null, released: r.released || null, tiers: optionsFor(r), total })
const reveal = (r: Round) => ({ k: r.k, type: r.type, extra: !!r.extra, bullets: r.bullets, voids: r.voids, before: r.before, fired: r.fired, dead: r.dead, after: r.after, pair: r.pair || null, released: r.released || null, shots: r.shots || null })

/** 真人片媒体清单（存 thrill_series 行 l13_media；没有则 null → 前端用模拟舞台） */
export async function l13Media(env: any, userId: string) {
  const r: any = await env.DB.prepare(`SELECT data FROM thrill_series WHERE id=?`).bind('l13_media').first()
  if (!r) return null
  const clips: Record<string, number> = J(r.data, {}).clips || {}
  const out: Record<string, { url: string; dur: number }> = {}
  for (const [k, dur] of Object.entries(clips)) out[k] = { url: userId ? await mediaTicket(env, userId, L13_SERIES, k, 30 * 60000) : '', dur }
  return { clips: out, faces: PRISONERS.map((p) => `/gimg/${L13_SERIES}/p${p.id}.webp`), cover: `/gimg/${L13_SERIES}/cover.webp` }
}
export async function l13SaveMedia(env: Env, clips: Record<string, number>) {
  await env.DB.prepare(`INSERT INTO thrill_series (id,title,logline,tension,cover,data,version,status,created_at,updated_at) VALUES ('l13_media','致命13·媒体清单','',5,NULL,?,1,'offline',?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, version=thrill_series.version+1, updated_at=excluded.updated_at`).bind(JSON.stringify({ clips }), now(), now()).run()
  return { ok: true, clips: Object.keys(clips).length }
}

export const CHAMP_ODDS = Math.floor(L13_CFG.champ_rtp * 13 * 100) / 100
export async function l13Meta(env: Env, userId?: string) {
  await ensurePool(env)
  const agg: any = await env.DB.prepare(`SELECT COUNT(*) n, COALESCE(MAX(hits),0) best, COALESCE(MAX(mult),0) top FROM thrill_runs WHERE series_id=? AND status='ended'`).bind(L13_SERIES).first()
  const recent = (await env.DB.prepare(`SELECT user_id,hits,mult,payout,jackpot,end_reason FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 8`).bind(L13_SERIES).all()).results as any[]
  const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' LIMIT 1`).bind(userId, L13_SERIES).first() : null
  return {
    prisoners: PRISONERS, cfg: L13_CFG, champ_odds: CHAMP_ODDS, ring_rounds: RING_ROUNDS, pool: await poolBalance(env),
    slip_bins: SLIP_BINS, slip_default: slipQuote(SLIP_BINS.map((b) => [...b].sort((x, y) => y.p - x.p)[0].id)),
    stats: { plays: agg?.n || 0, best: agg?.best || 0, top_mult: agg?.top || 0 },
    recent: recent.map((x) => ({ who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, mult: x.mult, win: x.payout, jackpot: x.jackpot, reason: x.end_reason })),
    open_run: open?.id || null,
    media: userId ? await l13Media(env, userId) : null
  }
}

export async function l13Start(env: Env, p: { userId: string; stake: number; picks: string[]; ipHash: string; sybil?: boolean; champ?: number; champStake?: number }) {
  const stake = Math.floor(+p.stake)
  if (!L13_CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${L13_CFG.stakes.join(' / ')}`)
  const quote = slipQuote((p.picks || []).map(String))
  if (!quote.ok) throw new GameError('SLIP_IMPOSSIBLE', '这三档几乎不可能同时成立，换个组合')
  const champ = p.champ ? Math.floor(+p.champ) : 0, champStake = champ ? Math.floor(+(p.champStake || 0)) : 0
  if (champ && (champ < 1 || champ > 13 || !L13_CFG.stakes.includes(champStake))) throw new GameError('BAD_CHAMP', '押冠军：号码 1~13，注金同档位')
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
  if (u.chips < stake + champStake) throw new GameError('INSUFFICIENT', `需要 ${stake + champStake} Chips`)
  await l13Expire(env)
  const mine: any = await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - 15 * 60000).first()
  if (mine) throw new GameError('ONE_AT_A_TIME', mine.series_id === L13_SERIES ? '你还有一局没结束' : '你在另一部剧还有一局没看完（15 分钟后自动结算）')
  const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - 15 * 60000).first()
  if ((ipOpen?.n || 0) >= L13_CFG.max_open_per_ip) { await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { series: L13_SERIES }); throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限') }
  await ensurePool(env)
  const rid = uid('tr_'), seed = randomHex(32), commit = await sha256(`${seed}|${rid}`)
  const rake = Math.max(1, Math.round(stake * L13_CFG.rake))
  await post(env, '致命13·押注单托管', rid, [[`user:${p.userId}:available`, 'D', stake + champStake], [`escrow:thrill:${rid}`, 'C', stake - rake], [POOL, 'C', rake], ...(champStake ? [[`escrow:thrill:${rid}:champ`, 'C', champStake] as [string, 'C', number]] : [])])
  const g = await fullGame(seed)
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake + champStake, p.userId),
    env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,?,?,?,?,'[]',?,'playing',0,0,?)`)
      .bind(rid, p.userId, L13_SERIES, p.ipHash, stake, g.length, seed, commit, JSON.stringify({ ...L13_CFG, sybil: !!p.sybil, rake_amt: rake, champ, champ_stake: champStake, picks: quote.picks, slip: { P: quote.P, mult: quote.mult } }), now())
  ])
  return { run_id: rid, commit, stake, quote, champ, champ_stake: champStake, champ_odds: CHAMP_ODDS, pool: await poolBalance(env), round: roundCard(g[0], g.length), balance: u.chips - stake - champStake }
}

async function load(env: Env, rid: string, userId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, L13_SERIES).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
  return r
}
export async function l13Arm(env: Env, p: { runId: string; userId: string }) {
  const r = await load(env, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  if (r.armed_at) return { lock_at: r.lock_at, server_time: now() }
  const t = now(), lock = t + L13_CFG.pick_sec * 1000 + 800
  await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(t, lock, r.id).run()
  return { lock_at: lock, server_time: t }
}

/** 推进一轮：可附带一笔追注（tier + bet）；不押 / 超时 = 只看 */
export async function l13Act(env: Env, p: { runId: string; userId: string; k: number; tier?: string | null; bet?: number }) {
  const r = await load(env, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const idx = r.gate
  if (+p.k !== idx + 1) throw new GameError('STALE_ROUND', `当前是第 ${idx + 1} 轮`)
  const g = await fullGame(r.seed), rd = g[idx]
  const late = !r.armed_at || now() > r.lock_at
  const tiers = optionsFor(rd)
  const tier = p.tier && !late ? tiers.find((t) => t.id === p.tier) : null
  if (p.tier && !late && !tier) throw new GameError('BAD_TIER', '无效选项')
  const bet = tier ? Math.floor(+(p.bet || 0)) : 0
  if (tier && !L13_CFG.stakes.includes(bet)) throw new GameError('BAD_STAKE', `追注只能是 ${L13_CFG.stakes.join(' / ')}`)
  if (bet) { const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first(); if ((u?.chips || 0) < bet) throw new GameError('INSUFFICIENT', `追注需要 ${bet} Chips`) }
  const adv = await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, idx).run()
  if (!adv.meta.changes) throw new GameError('DUPLICATE', '已结算')
  const surv = rd.type === 'duel' ? rd.after[0] : rd.after.length
  const res: any = { k: rd.k, type: rd.type, survivors: rd.after.length, winner: rd.type === 'duel' ? rd.after[0] : null, round: reveal(rd), side: null }
  if (tier) {
    const hit = surv >= tier.lo && surv <= tier.hi, pay = hit ? Math.floor(bet * tier.odds) : 0
    const lines: [string, 'D' | 'C', number][] = [[`user:${r.user_id}:available`, 'D', bet], ['platform:house', 'C', bet]]
    if (pay) lines.push(['platform:house', 'D', pay], [`user:${r.user_id}:available`, 'C', pay])
    await post(env, `致命13·第${rd.k}轮追注${hit ? '命中' : '未中'} ${tier.label}`, r.id, lines)
    await env.DB.prepare('UPDATE users SET chips=chips-?+? WHERE id=?').bind(bet, pay, r.user_id).run()
    res.side = { tier: tier.id, label: tier.label, odds: tier.odds, bet, hit, payout: pay }
  }
  await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,stake,picked_at) VALUES (?,?,?,?,?,0,?,?,?,?)`)
    .bind(r.id, idx, tier ? tier.id : late ? 'timeout' : 'watch', String(surv), res.side?.hit ? 1 : 0, tier ? tier.odds : 0, res.side?.payout || 0, bet, now()).run()
  if (rd.k === RING_ROUNDS || (idx + 1 >= g.length && rd.k < RING_ROUNDS)) res.slip = await settleSlip(env, r.id) // 押注单在第 3 轮揭晓（不足 3 轮按最终人数）
  if (idx + 1 >= g.length) Object.assign(res, await finish(env, r.id, 'final'), { rest: [] })
  else res.next = roundCard(g[idx + 1], g.length)
  return res
}

async function settleSlip(env: Env, rid: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  const cfg: any = J(r.cfg, L13_CFG)
  if (cfg.slip_done) return cfg.slip_done
  const u = await env.DB.prepare(`UPDATE thrill_runs SET end_reason='slip' WHERE id=? AND end_reason IS NULL`).bind(rid).run()
  if (!u.meta.changes) return J((await env.DB.prepare('SELECT cfg FROM thrill_runs WHERE id=?').bind(rid).first<any>())?.cfg, {}).slip_done || { rows: [], hits: 0, mult: 0, payout: 0, stake: r.stake, jackpot: null }
  const g = await fullGame(r.seed), sr = slipResult(g, cfg.picks)
  const net = r.stake - (cfg.rake_amt ?? 0), payout = Math.floor(r.stake * sr.mult)
  const lines: [string, 'D' | 'C', number][] = [[`escrow:thrill:${rid}`, 'D', net]]
  if (payout) lines.push([`user:${r.user_id}:available`, 'C', payout])
  if (payout > net) lines.push(['platform:house', 'D', payout - net]); else if (payout < net) lines.push(['platform:house', 'C', net - payout])
  await post(env, `致命13·押注单 中${sr.hits}/3 ×${sr.mult}`, rid, lines)
  if (payout) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(payout, r.user_id).run()
  const jp = sr.hits === RING_ROUNDS ? await jackpot(env, r) : null
  const done = { ...sr, payout, stake: r.stake, jackpot: jp }
  cfg.slip_done = done
  await env.DB.prepare(`UPDATE thrill_runs SET hits=?, mult=?, payout=?, cfg=? WHERE id=?`).bind(sr.hits, sr.mult, payout, JSON.stringify(cfg), rid).run()
  return done
}

async function jackpot(env: Env, r: any) {
  const cfg: any = J(r.cfg, L13_CFG), pool = await poolBalance(env)
  const amt = Math.max(0, Math.min(Math.floor(pool * cfg.jackpot_share), r.stake * cfg.jackpot_cap_mult))
  if (!amt) return { amount: 0 }
  const dev: any = await env.DB.prepare('SELECT created_at FROM auth_devices WHERE uid=?').bind(r.user_id).first()
  const ageH = dev ? (now() - dev.created_at) / 3600000 : 0
  const hold = cfg.sybil ? '同网络新设备超限（疑似多开）' : ageH < cfg.jackpot_min_age_h ? `账号注册不足 ${cfg.jackpot_min_age_h} 小时` : null
  if (hold) {
    await post(env, '致命13·押注单大奖待审核', r.id, [[POOL, 'D', amt], [`hold:thrill:${r.id}`, 'C', amt]])
    await riskEvent(env as any, r.user_id, 'thrill_jackpot_hold', 2, { run: r.id, jackpot: amt, reason: hold })
  } else {
    await post(env, '致命13·押注单大奖', r.id, [[POOL, 'D', amt], [`user:${r.user_id}:available`, 'C', amt]])
    await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(amt, r.user_id).run()
  }
  await env.DB.prepare(`UPDATE thrill_runs SET jackpot=?, jackpot_status=?, hold_reason=? WHERE id=?`).bind(amt, hold ? 'held' : 'paid', hold, r.id).run()
  return { amount: amt, status: hold ? 'held' : 'paid', hold_reason: hold }
}

/** 收尾：押注单（若未结）+ 押冠军；追注已逐轮结清 */
async function finish(env: Env, rid: string, reason: string) {
  const slip = await settleSlip(env, rid)
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  const u0 = await env.DB.prepare(`UPDATE thrill_runs SET status='ended', end_reason=?, ended_at=? WHERE id=? AND status!='ended'`).bind(reason, now(), rid).run()
  const cfg: any = J(r.cfg, L13_CFG), g = await fullGame(r.seed), winner = g[g.length - 1].after[0]
  let champ: any = null
  if (cfg.champ && cfg.champ_stake) {
    const win = winner === cfg.champ, cp = win ? Math.floor(cfg.champ_stake * CHAMP_ODDS) : 0
    if (u0.meta.changes) {
      if (win) {
        await post(env, `致命13·押冠军 ${cfg.champ} 号命中`, rid, [[`escrow:thrill:${rid}:champ`, 'D', cfg.champ_stake], ['platform:house', 'D', cp - cfg.champ_stake], [`user:${r.user_id}:available`, 'C', cp]])
        await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(cp, r.user_id).run()
      } else await post(env, `致命13·押冠军 ${cfg.champ} 号未中`, rid, [[`escrow:thrill:${rid}:champ`, 'D', cfg.champ_stake], ['platform:house', 'C', cfg.champ_stake]])
    }
    champ = { pick: cfg.champ, stake: cfg.champ_stake, winner, hit: win, payout: cp }
  }
  const sides = (await env.DB.prepare(`SELECT COALESCE(SUM(stake),0) s, COALESCE(SUM(payout),0) p FROM thrill_picks WHERE run_id=?`).bind(rid).first<any>()) || { s: 0, p: 0 }
  const usr: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  const jp = r.jackpot_status === 'paid' ? r.jackpot : 0
  return {
    ended: true, reason, winner, slip, champ, side_total: { staked: sides.s, paid: sides.p },
    hits: slip.hits, mult: slip.mult, payout: slip.payout, stake: r.stake, jackpot: r.jackpot, jackpot_status: r.jackpot_status,
    net: slip.payout - r.stake + jp + (champ ? champ.payout - champ.stake : 0) + (sides.p - sides.s),
    balance: usr?.chips, pool: await poolBalance(env), verify: { seed: r.seed, commit: r.commit_hash }
  }
}

/** 掉线 / 超时：剧情由种子决定，直接按种子把押注单与冠军结清（未下的追注视为放弃） */
export async function l13Expire(env: Env) {
  const old = (await env.DB.prepare(`SELECT id FROM thrill_runs WHERE status='playing' AND series_id=? AND started_at<?`).bind(L13_SERIES, now() - 15 * 60000).all()).results as any[]
  for (const r of old) await finish(env, r.id, 'timeout')
}
/** 玩家主动「快进到结局」：剩余轮次不再追注 */
export async function l13Skip(env: Env, p: { runId: string; userId: string }) {
  const r = await load(env, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const g = await fullGame(r.seed)
  const u = await env.DB.prepare(`UPDATE thrill_runs SET gate=? WHERE id=? AND gate=? AND status='playing'`).bind(g.length, r.id, r.gate).run()
  if (!u.meta.changes) throw new GameError('DUPLICATE', '已结算')
  return { ...(await finish(env, r.id, 'skip')), rest: g.slice(r.gate).map(reveal) }
}

export async function l13Verify(env: Env, rid: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, L13_SERIES).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const g = await fullGame(r.seed), cfg: any = J(r.cfg, {})
  return { run_id: rid, seed: r.seed, commit: r.commit_hash, ok: (await sha256(`${r.seed}|${rid}`)) === r.commit_hash, rounds: g.map(reveal), winner: g[g.length - 1].after, slip: cfg.picks ? slipResult(g, cfg.picks) : null }
}

/** 蒙特卡洛（纯本地，快速近似）：随机押注单 + 每轮追注概率最高档 */
export function l13Simulate(n = 20000) {
  let slipStake = 0, slipPaid = 0, sideStake = 0, sidePaid = 0, rounds = 0, extra = 0, duels = 0, h3 = 0
  const quotes = new Map<string, any>()
  for (let i = 0; i < n; i++) {
    const picks = SLIP_BINS.map((b) => b[Math.floor(Math.random() * b.length)].id), key = picks.join()
    if (!quotes.has(key)) quotes.set(key, slipQuote(picks))
    const q = quotes.get(key); if (!q.ok) { i--; continue }
    let alive = 13; const after: number[] = []
    for (let k = 1; alive > 1 && (k <= L13_CFG.ring_base || (k <= L13_CFG.ring_max && alive >= L13_CFG.extra_min_alive)); k++) {
      let nx; do { nx = 0; for (let j = 0; j < alive; j++) if (Math.random() >= k / 6) nx++ } while (nx === 0)
      const t = [...tiersFor(alive, k)].sort((a, c) => c.p - a.p)[0]; sideStake += 10; if (nx >= t.lo && nx <= t.hi) sidePaid += Math.floor(10 * t.odds)
      alive = nx; after.push(nx); rounds++; if (k > 3) extra++
    }
    if (alive >= 2) { duels++; rounds++ }
    const hits = q.bins.filter((b: any) => { const s = after[b.k - 1] ?? after[after.length - 1]; return s >= b.lo && s <= b.hi }).length
    if (hits === 3) h3++
    slipStake += 10; slipPaid += Math.floor(10 * q.mult[hits])
  }
  return { runs: n, slip_rtp: Math.round((slipPaid / slipStake) * 1000) / 10, side_rtp: Math.round((sidePaid / sideStake) * 1000) / 10, all3_rate: h3 / n, avg_rounds: Math.round((rounds / n) * 100) / 100, extra_rate: Math.round((extra / n) * 100) / 100, duel_rate: duels / n }
}
