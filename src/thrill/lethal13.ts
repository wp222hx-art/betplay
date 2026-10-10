// 致命13 —— 监狱俄罗斯轮盘（六孔左轮）· 押存活人数 · 连中三把拿连环大奖
// ─────────────────────────────────────────────────────────────────────────────
// 规则（致敬《13 Tzameti》结构；开局公开、种子可复算）：
// · 环形三轮：13 人围成一圈，枪口对准前一个人；六孔左轮第 1/2/3 轮各装 1/2/3 发；灯亮同时扣扳机，某人死亡 ⇔ 他身后那把枪响了
// · 三轮之后：若仍有 ≥3 人，主持人按种子抽出 2 人进入「决斗」，其余人活着离场；恰好 2 人直接决斗；只剩 1 人即为赢家
// · 决斗：两人面对面，枪口对准对方；第 d 枪各装 min(d,5) 发，同时扣扳机，直到一人倒下
// · 任何一枪若会让全员死亡：主持人敲杖，本枪作废，重新上弹（保证最后必有唯一幸存者）
// · 整局结果只由种子决定，与任何人的下注无关：第 k 轮第 t 次尝试第 i 把枪 fired ⇔ HMAC(seed,"r:k:t:i") < b/6
// 下注：开局托管一注；环形三轮每轮押「本轮过后剩几人」（按真实概率切成 2~3 档）；决斗押「哪个号码活下来」（两人对称，各 50%）
//      猜中 → 累计倍率 × 该档赔率；环形三轮全中 → 连环大奖（瓜分本剧奖池）；猜错 → 自动出局，但剧情照常演到最后一人
//      每轮开枪前也可以「收手」带走当前倍率；超时 = 自动收手
import { randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export const L13_SERIES = 'l13_deadly13'
export const PRISONERS = ['老鬼', '刀疤', '眼镜', '小四', '和尚', '阿彪', '哑巴', '老K', '黑皮', '书生', '二愣', '胖虎', '阿森'].map((name, i) => ({ id: i + 1, name }))
export const L13_CFG = {
  step_rtp: 0.94,          // 每档赔率 = step_rtp / 该档概率 → 任何押法单轮期望恒为 94%
  rake: 0.02,              // 注金 2% 注入奖池
  stakes: [10, 20, 50, 100, 200],
  pick_sec: 8,
  chain: 3,                // 连中 3 把触发连环大奖
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
export function tiersFor(n: number, b: number, rtp = L13_CFG.step_rtp) {
  const d = survivorDist(n, b), vals = Array.from({ length: n }, (_, i) => n - i) // 从多到少
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
    const label = hi === lo ? `剩 ${hi} 人` : lo === 1 ? `剩 ${hi} 人及以下` : hi === n ? `剩 ${lo} 人及以上` : `剩 ${lo}~${hi} 人`
    return { id: 't' + i, label, lo, hi, p, odds: Math.max(1.01, Math.floor((rtp / p) * 100) / 100) }
  })
}

// ─────────── 整局（只由种子决定） ───────────
export const RING_ROUNDS = 3
export type Shot = { d: number; bullets: number; voids: number; fired: number[]; dead: number[] }
export type Round = { k: number; type: 'ring' | 'duel'; bullets: number; before: number[]; voids: number; fired: number[]; dead: number[]; after: number[]; pair?: number[]; released?: number[]; shots?: Shot[] }
export async function fullGame(seed: string) {
  let alive = PRISONERS.map((p) => p.id)
  const rounds: Round[] = []
  // 环形三轮
  for (let k = 1; k <= RING_ROUNDS && alive.length > 1; k++) {
    const b = k, n = alive.length
    let t = 0, fired: number[] = [], dead: number[] = []
    for (; t < 50; t++) {
      fired = []; dead = []
      for (let i = 0; i < n; i++) if ((await seedFloat(seed, `r:${k}:${t}:${i}`)) < b / 6) fired.push(alive[i])
      for (let i = 0; i < n; i++) if (fired.includes(alive[(i - 1 + n) % n])) dead.push(alive[i])
      if (dead.length < n) break
    }
    const after = alive.filter((x) => !dead.includes(x))
    rounds.push({ k, type: 'ring', bullets: b, before: alive, voids: t, fired, dead, after })
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
// ─────────── 资金 ───────────
async function poolBalance(env: Env) {
  const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL).first()
  return r?.b || 0
}
async function ensurePool(env: Env) {
  const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL).first()
  if (!r) await post(env, '致命13奖池·上线注资', L13_SERIES, [['platform:house', 'D', L13_CFG.seed_pool], [POOL, 'C', L13_CFG.seed_pool]])
}

/** 每一步的押注选项：环形 = 存活人数分档；决斗 = 押哪个号码活（对称 50%） */
export function optionsFor(r: Round) {
  if (r.type === 'duel') return r.pair!.map((id) => ({ id: 'n' + id, label: `${id} 号 · ${PRISONERS[id - 1].name}`, lo: id, hi: id, p: 0.5, odds: Math.floor((L13_CFG.step_rtp / 0.5) * 100) / 100 }))
  return tiersFor(r.before.length, r.bullets)
}
const roundCard = (r: Round, mult: number, hits: number) => ({
  k: r.k, type: r.type, bullets: r.bullets, alive: r.before, pair: r.pair || null, released: r.released || null, tiers: optionsFor(r),
  mult, hits, chain_left: Math.max(0, L13_CFG.chain - hits)
})
const reveal = (r: Round) => ({ k: r.k, type: r.type, bullets: r.bullets, voids: r.voids, before: r.before, fired: r.fired, dead: r.dead, after: r.after, pair: r.pair || null, released: r.released || null, shots: r.shots || null })

/** 真人片媒体清单（KV 风格存 D1 settings 表；没有则为 null → 前端用模拟舞台） */
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

export async function l13Meta(env: Env, userId?: string) {
  await ensurePool(env)
  const agg: any = await env.DB.prepare(`SELECT COUNT(*) n, COALESCE(MAX(hits),0) best, COALESCE(MAX(mult),0) top FROM thrill_runs WHERE series_id=? AND status='ended'`).bind(L13_SERIES).first()
  const recent = (await env.DB.prepare(`SELECT user_id,hits,mult,payout,jackpot,end_reason FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 8`).bind(L13_SERIES).all()).results as any[]
  const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' LIMIT 1`).bind(userId, L13_SERIES).first() : null
  return {
    prisoners: PRISONERS, cfg: L13_CFG, champ_odds: CHAMP_ODDS, ring_rounds: RING_ROUNDS, pool: await poolBalance(env), first: tiersFor(13, 1),
    stats: { plays: agg?.n || 0, best: agg?.best || 0, top_mult: agg?.top || 0 },
    recent: recent.map((x) => ({ who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, mult: x.mult, win: x.payout, jackpot: x.jackpot, reason: x.end_reason })),
    open_run: open?.id || null,
    media: userId ? await l13Media(env, userId) : null
  }
}

export const CHAMP_ODDS = Math.floor(L13_CFG.champ_rtp * 13 * 100) / 100
export async function l13Start(env: Env, p: { userId: string; stake: number; ipHash: string; sybil?: boolean; champ?: number; champStake?: number }) {
  const stake = Math.floor(+p.stake)
  if (!L13_CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${L13_CFG.stakes.join(' / ')}`)
  const champ = p.champ ? Math.floor(+p.champ) : 0, champStake = champ ? Math.floor(+(p.champStake || 0)) : 0
  if (champ && (champ < 1 || champ > 13 || !L13_CFG.stakes.includes(champStake))) throw new GameError('BAD_CHAMP', '押冠军：号码 1~13，注金同档位')
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
  if (u.chips < stake + champStake) throw new GameError('INSUFFICIENT', `需要 ${stake + champStake} Chips`)
  await l13Expire(env)
  const mine: any = await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND status='playing' LIMIT 1`).bind(p.userId).first()
  if (mine) throw new GameError('ONE_AT_A_TIME', '你还有一局没结束')
  const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing'`).bind(p.ipHash).first()
  if ((ipOpen?.n || 0) >= L13_CFG.max_open_per_ip) { await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { series: L13_SERIES }); throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限') }
  await ensurePool(env)
  const rid = uid('tr_'), seed = randomHex(32), commit = await sha256(`${seed}|${rid}`)
  const rake = Math.max(1, Math.round(stake * L13_CFG.rake))
  await post(env, '致命13·开局托管', rid, [[`user:${p.userId}:available`, 'D', stake + champStake], [`escrow:thrill:${rid}`, 'C', stake - rake], [POOL, 'C', rake], ...(champStake ? [[`escrow:thrill:${rid}:champ`, 'C', champStake] as [string, 'C', number]] : [])])
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake + champStake, p.userId),
    env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,?,0,?,?,'[]',?,'playing',0,1,?)`)
      .bind(rid, p.userId, L13_SERIES, p.ipHash, stake, seed, commit, JSON.stringify({ ...L13_CFG, sybil: !!p.sybil, rake_amt: rake, champ, champ_stake: champStake }), now())
  ])
  const g = await fullGame(seed)
  return { run_id: rid, commit, stake, champ, champ_stake: champStake, champ_odds: CHAMP_ODDS, pool: await poolBalance(env), round: roundCard(g[0], 1, 0), balance: u.chips - stake - champStake }
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

/** 押档 / 收手 */
export async function l13Act(env: Env, p: { runId: string; userId: string; k: number; tier?: string | null; cashout?: boolean }) {
  const r = await load(env, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const idx = r.gate
  if (+p.k !== idx + 1) throw new GameError('STALE_ROUND', `当前是第 ${idx + 1} 轮`)
  const g = await fullGame(r.seed), rd = g[idx]
  const late = !r.armed_at || now() > r.lock_at
  const tiers = optionsFor(rd)
  const tier = p.tier ? tiers.find((t) => t.id === p.tier) : null
  if (p.tier && !tier) throw new GameError('BAD_TIER', '无效选项')
  if (p.cashout || late || !tier) {
    const u = await env.DB.prepare(`UPDATE thrill_runs SET status='settling', armed_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, idx).run()
    if (!u.meta.changes) throw new GameError('DUPLICATE', '已结算')
    await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,picked_at) VALUES (?,?,?,?,0,?,?,0,?)`).bind(r.id, idx, p.cashout ? 'cashout' : 'timeout', '-', r.hits, r.mult, now()).run()
    return { action: p.cashout ? 'cashout' : 'timeout', ...(await settle(env, r.id, p.cashout ? 'cashout' : 'timeout')), rest: g.slice(idx).map(reveal) }
  }
  const surv = rd.type === 'duel' ? rd.after[0] : rd.after.length
  const hit = surv >= tier.lo && surv <= tier.hi
  const mult = hit ? Math.min(L13_CFG.max_mult, Math.floor(r.mult * tier.odds * 100) / 100) : 0
  const u = hit
    ? await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, hits=hits+1, streak=streak+1, mult=?, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(mult, r.id, idx).run()
    : await env.DB.prepare(`UPDATE thrill_runs SET status='settling', armed_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, idx).run()
  if (!u.meta.changes) throw new GameError('DUPLICATE', '已结算')
  await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,picked_at) VALUES (?,?,?,?,?,?,?,0,?)`).bind(r.id, idx, tier.id, String(surv), hit ? 1 : 0, hit ? r.hits + 1 : r.hits, mult, now()).run()
  const res: any = { k: rd.k, type: rd.type, tier: tier.id, hit, survivors: rd.after.length, winner: rd.type === 'duel' ? rd.after[0] : null, mult, hits: hit ? r.hits + 1 : r.hits, round: reveal(rd) }
  if (!hit) return Object.assign(res, await settle(env, r.id, 'miss'), { rest: g.slice(idx + 1).map(reveal) })
  if (rd.type === 'ring' && res.hits === L13_CFG.chain) res.chain_jp = await jackpot(env, r)
  const last = idx + 1 >= g.length
  if (last || mult >= L13_CFG.max_mult) return Object.assign(res, await settle(env, r.id, last ? 'final' : 'cap'), { rest: g.slice(idx + 1).map(reveal) })
  res.next = roundCard(g[idx + 1], mult, res.hits)
  return res
}

async function jackpot(env: Env, r: any) {
  const cfg: any = J(r.cfg, L13_CFG), pool = await poolBalance(env)
  const amt = Math.max(0, Math.min(Math.floor(pool * cfg.jackpot_share), r.stake * cfg.jackpot_cap_mult))
  if (!amt) return { amount: 0 }
  const dev: any = await env.DB.prepare('SELECT created_at FROM auth_devices WHERE uid=?').bind(r.user_id).first()
  const ageH = dev ? (now() - dev.created_at) / 3600000 : 0
  const hold = cfg.sybil ? '同网络新设备超限（疑似多开）' : ageH < cfg.jackpot_min_age_h ? `账号注册不足 ${cfg.jackpot_min_age_h} 小时` : null
  if (hold) {
    await post(env, '致命13·连环大奖待审核', r.id, [[POOL, 'D', amt], [`hold:thrill:${r.id}`, 'C', amt]])
    await riskEvent(env as any, r.user_id, 'thrill_jackpot_hold', 2, { run: r.id, jackpot: amt, reason: hold })
  } else {
    await post(env, '致命13·连环大奖', r.id, [[POOL, 'D', amt], [`user:${r.user_id}:available`, 'C', amt]])
    await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(amt, r.user_id).run()
  }
  await env.DB.prepare(`UPDATE thrill_runs SET jackpot=?, jackpot_status=?, hold_reason=? WHERE id=?`).bind(amt, hold ? 'held' : 'paid', hold, r.id).run()
  return { amount: amt, status: hold ? 'held' : 'paid', hold_reason: hold }
}

async function settle(env: Env, rid: string, reason: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  const cfg: any = J(r.cfg, L13_CFG), net = r.stake - (cfg.rake_amt ?? 0)
  const mult = reason === 'miss' ? 0 : r.mult
  const payout = reason === 'miss' ? 0 : r.hits === 0 ? net : Math.floor(r.stake * mult)
  if (payout) {
    const lines: [string, 'D' | 'C', number][] = [[`escrow:thrill:${rid}`, 'D', net], [`user:${r.user_id}:available`, 'C', payout]]
    if (payout > net) lines.push(['platform:house', 'D', payout - net]); else if (payout < net) lines.push(['platform:house', 'C', net - payout])
    await post(env, `致命13·${reason === 'final' ? '押到最后一人' : reason === 'cashout' ? '收手' : reason === 'timeout' ? '超时收手' : '封顶'} ×${mult}`, rid, lines)
    await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(payout, r.user_id).run()
  } else await post(env, '致命13·押错出局', rid, [[`escrow:thrill:${rid}`, 'D', net], ['platform:house', 'C', net]])
  // 押冠军：整局结果已由种子决定，结束时一并结算
  let champ: any = null
  if (cfg.champ && cfg.champ_stake) {
    const g = await fullGame(r.seed), winner = g[g.length - 1].after[0], win = winner === cfg.champ
    const cp = win ? Math.floor(cfg.champ_stake * CHAMP_ODDS) : 0
    if (win) {
      await post(env, `致命13·押冠军 ${cfg.champ} 号命中`, rid, [[`escrow:thrill:${rid}:champ`, 'D', cfg.champ_stake], ['platform:house', 'D', cp - cfg.champ_stake], [`user:${r.user_id}:available`, 'C', cp]])
      await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(cp, r.user_id).run()
    } else await post(env, `致命13·押冠军 ${cfg.champ} 号未中`, rid, [[`escrow:thrill:${rid}:champ`, 'D', cfg.champ_stake], ['platform:house', 'C', cfg.champ_stake]])
    champ = { pick: cfg.champ, stake: cfg.champ_stake, winner, hit: win, payout: cp }
  }
  await env.DB.prepare(`UPDATE thrill_runs SET status='ended', payout=?, mult=?, end_reason=?, ended_at=? WHERE id=?`).bind(payout, mult, reason, now(), rid).run()
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  return { ended: true, reason, hits: r.hits, mult, payout, stake: r.stake, champ, jackpot: r.jackpot, jackpot_status: r.jackpot_status, net: payout + (r.jackpot_status === 'paid' ? r.jackpot : 0) - r.stake + (champ ? champ.payout - champ.stake : 0), balance: u?.chips, pool: await poolBalance(env), verify: { seed: r.seed, commit: r.commit_hash } }
}

export async function l13Expire(env: Env) {
  const old = (await env.DB.prepare(`SELECT id,gate FROM thrill_runs WHERE status='playing' AND series_id=? AND started_at<?`).bind(L13_SERIES, now() - 15 * 60000).all()).results as any[]
  for (const r of old) { const u = await env.DB.prepare(`UPDATE thrill_runs SET status='settling' WHERE id=? AND status='playing'`).bind(r.id).run(); if (u.meta.changes) await settle(env, r.id, 'timeout') }
}

export async function l13Verify(env: Env, rid: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, L13_SERIES).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const g = await fullGame(r.seed)
  return { run_id: rid, seed: r.seed, commit: r.commit_hash, ok: (await sha256(`${r.seed}|${rid}`)) === r.commit_hash, rounds: g.map(reveal), winner: g[g.length - 1].after }
}

/** 蒙特卡洛（纯本地）：策略 = 每步押概率最高的档，押到第 target 步后收手 */
export function l13Simulate(n = 20000, target = 9) {
  let staked = 0, paid = 0, chains = 0, pool = L13_CFG.seed_pool, duels = 0
  for (let i = 0; i < n; i++) {
    const stake = 10; staked += stake; pool += Math.max(1, Math.round(stake * L13_CFG.rake))
    let alive = 13, mult = 1, hits = 0, out = false, done = false, step = 0
    const bet = (opts: any[], outcome: number) => {
      if (out || done) return
      step++
      const t = [...opts].sort((a, c) => c.p - a.p)[0]
      if (outcome >= t.lo && outcome <= t.hi) { hits++; mult *= t.odds } else out = true
      if (!out && step >= target) { paid += Math.floor(stake * mult); done = true }
    }
    for (let k = 1; k <= RING_ROUNDS && alive > 1; k++) {
      let nxt; do { nxt = 0; for (let j = 0; j < alive; j++) if (Math.random() >= k / 6) nxt++ } while (nxt === 0)
      const opts = tiersFor(alive, k); bet(opts, nxt)
      if (!out && hits === RING_ROUNDS && k === RING_ROUNDS) { const j = Math.min(Math.floor(pool * L13_CFG.jackpot_share), stake * L13_CFG.jackpot_cap_mult); pool -= j; paid += j; chains++ }
      alive = nxt
    }
    if (alive >= 2) { duels++; const w = Math.random() < 0.5 ? 1 : 2; bet([{ lo: 1, hi: 1, p: 0.5, odds: Math.floor((L13_CFG.step_rtp / 0.5) * 100) / 100 }, { lo: 2, hi: 2, p: 0.5, odds: 0 }], w) }
    if (!out && !done) paid += Math.floor(stake * mult)
  }
  return { runs: n, target, rtp_total: Math.round((paid / staked) * 1000) / 10, chain_rate: chains / n, duel_rate: duels / n, pool_end: pool }
}
