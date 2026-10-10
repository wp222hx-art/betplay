// 惊心 1 分钟（Thrill 60s）v2 —— 「连猜爬塔」：剧情一条线演到底，竞猜与剧情解耦、可无限加猜
// ─────────────────────────────────────────────────────────────────────────────
// 剧情：main[] 是一条完整的线性主线（S0 → S1 → … → Sn），保证人物 / 故事 / 形象连贯，不分叉
// 竞猜：主线每两段之间插一张「猜卡」（剧情卡），每张卡只有 A / B 两面（像硬币正反），
//       两面揭晓片段都是「微瞬间」，结束后都回到同一条主线 —— 猜卡不改变剧情走向
//       主线演完后进入「加时赛」：从本剧的加时卡库（后日谈 / 氛围微瞬间）里无限续猜，卡库可随时运营扩充
// 博弈：一局只押一次注金；每猜中一次，累计倍率上涨；越往后单步命中率越低（50% → 46% → 42% … 下限 20%）
//       每张卡出现时你可以选 A / B 继续爬，或「落袋」带走当前倍率；猜错 = 本局注金归零
//       每个落袋点的期望返还恒定（= rtp），平台不靠"诱导多爬"获利；连中到第 jackpot_step 关额外瓜分本剧奖池
// 随机：每人每局独立种子（不存在多人同猜一个结果），开局公开 commit=sha256(seed|run)，结束公开 seed 可复算
//       第 k 猜：r_k = HMAC(seed,"step:k")；命中 ⇔ r_k < p_k —— 与你选 A 还是 B 无关（命中率对两面一致、透明公示）
// 不可悔棋：注金开局托管；无暂停 / 回看 / 撤注；抉择窗口服务端计时，超时 = 自动落袋；
//          中途落袋或猜错后，主线剧情照常一口气演完（顺畅表演到底），只是不能再押
// 防作弊：令牌身份 · 同账号同时 1 局 · 同 IP 同时 ≤ N 局 · Jackpot 风控冻结审核 · 视频凭票据播放 · 复式账本
import { encryptSlot, randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
/** 一局最长存活 15 分钟（主线 1 分钟 + 加时赛）；超时未操作 = 自动落袋 */
export const STALE_MS = 15 * 60000

export const DEFAULT_CFG = {
  p: [0.5, 0.46, 0.42, 0.38, 0.34, 0.3, 0.26, 0.22], // 第 k 猜命中率（越往后越难）
  p_floor: 0.2,                   // 之后每猜的命中率
  rtp: 0.91,                      // 任意落袋点的期望返还
  rake: 0.03,                     // 注金 3% 注入本剧奖池
  stakes: [10, 20, 50, 100, 200], // 单局注金档位
  pick_sec: 6,                    // 每张卡抉择窗口（秒）
  max_mult: 10000,                // 封顶倍率（风控）：到达即自动落袋
  jackpot_step: 6,                // 连中第 6 猜触发 Jackpot（继续可爬）
  jackpot_share: 0.5,             // 拿走奖池的 50%
  jackpot_cap_mult: 500,          // 单次 Jackpot ≤ 注金 × 500
  seed_pool: 20000,               // 新剧上线平台注资
  max_open_per_ip: 2,
  jackpot_min_age_h: 24
}
export type Cfg = typeof DEFAULT_CFG
/** 总返还红线（落袋 rtp + 奖池抽成）；超出拒绝上架 */
export const MAX_RTP = 0.95

export const pAt = (cfg: Cfg, k: number) => (k < cfg.p.length ? cfg.p[k] : cfg.p_floor)
/** 连中 h 次后的累计倍率（两位小数向下取整，保证每个落袋点期望 ≤ rtp） */
export function multAt(cfg: Cfg, h: number) {
  if (h <= 0) return 1
  let P = 1
  for (let i = 0; i < h; i++) P *= pAt(cfg, i)
  return Math.min(cfg.max_mult, Math.floor((cfg.rtp / P) * 100) / 100)
}
/** 倍率塔：每一层的命中率 / 到达概率 / 倍率 —— 前端展示 + 经济校验 */
export function ladderTable(cfg: Cfg, n = 12) {
  const rows: { step: number; p: number; reach: number; mult: number; jackpot: boolean; cap: boolean }[] = []
  let reach = 1
  for (let h = 1; h <= n; h++) {
    reach *= pAt(cfg, h - 1)
    const mult = multAt(cfg, h)
    rows.push({ step: h, p: pAt(cfg, h - 1), reach, mult, jackpot: h === cfg.jackpot_step, cap: mult >= cfg.max_mult })
    if (mult >= cfg.max_mult) break
  }
  return rows
}

// ─────────────────────────── 剧本数据（DATA v2） ───────────────────────────
// DATA = {
//   v: 2, series: { id, title, logline, tension, gated?, cast? }, thrill: { cfg? },
//   main: [seg_id, …],                         // 线性主线（≥2 段）
//   cards: [ { id, at?, title?, q, a:{label,seg}, b:{label,seg} } ],
//      at = 剧情卡位置（显示在 main[at] 之后，0 ≤ at < main.length-1）；不填 at = 加时卡（主线演完后无限循环抽取）
//   segments: { [id]: { title, video_url, poster, dur, lines } }
// }
export function validate(DATA: any) {
  const errs: string[] = []
  if (!DATA?.series?.id) errs.push('缺少 series.id')
  const segs = DATA?.segments || {}, main: string[] = DATA?.main || [], cards: any[] = DATA?.cards || []
  if (main.length < 2) errs.push('主线至少 2 段')
  main.forEach((s, i) => { if (!segs[s]) errs.push(`主线第 ${i + 1} 段缺少片段 ${s}`) })
  const ats = new Set<number>()
  for (const c of cards) {
    if (!c.id || !c.q) errs.push('猜卡缺少 id / 问题')
    for (const side of ['a', 'b']) if (!c[side]?.label || !segs[c[side]?.seg]) errs.push(`猜卡「${c.q}」${side.toUpperCase()} 面缺少文案或片段`)
    if (c.at !== undefined && c.at !== null) {
      if (!(c.at >= 0 && c.at < main.length - 1)) errs.push(`剧情卡「${c.q}」位置 at=${c.at} 越界`)
      if (ats.has(c.at)) errs.push(`主线第 ${c.at + 1} 段之后有多张剧情卡`)
      ats.add(c.at)
    }
  }
  // 剧情卡必须从第 1 段之后连续排布（否则爬塔会在主线中间断档）
  for (let i = 0; i < ats.size; i++) if (!ats.has(i)) errs.push(`剧情卡位置必须从 0 起连续（缺 at=${i}）`)
  if (!cards.length) errs.push('至少 1 张猜卡')
  const cfg: Cfg = { ...DEFAULT_CFG, ...(DATA?.thrill?.cfg || {}) }
  if (cfg.rtp + cfg.rake > MAX_RTP) errs.push(`返还 ${(cfg.rtp * 100).toFixed(0)}% + 奖池 ${(cfg.rake * 100).toFixed(0)}% 超过红线 ${MAX_RTP * 100}%`)
  if (cfg.p.some((x, i) => x <= 0 || x > 0.5 || (i && x > cfg.p[i - 1]))) errs.push('命中率必须在 (0, 50%] 且逐步递减')
  return errs
}

export function createThrill(DATA: any) {
  const errs = validate(DATA)
  if (errs.length) throw new GameError('THRILL_INVALID', '惊心 1 分钟剧本不合法：' + errs.join('；'))
  const SERIES = DATA.series.id
  const CFG: Cfg = { ...DEFAULT_CFG, ...(DATA.thrill?.cfg || {}) }
  const MAIN: string[] = DATA.main
  const STORY: any[] = DATA.cards.filter((c: any) => c.at !== undefined && c.at !== null).sort((a: any, b: any) => a.at - b.at)
  const BONUS: any[] = DATA.cards.filter((c: any) => c.at === undefined || c.at === null)
  const POOL = `pool:thrill:${SERIES}`
  const clipOf = (url: string) => (url.split('/').pop() || '').replace(/\.mp4$/, '')
  const vurl = async (env: any, u: string, url?: string | null) => (url ? (DATA.series.gated === false || !/^\/m\//.test(url) ? url : mediaTicket(env, u, SERIES, clipOf(url), 30 * 60000)) : null)
  const segOut = async (env: any, u: string, segId?: string) => {
    const s = segId && DATA.segments[segId]; if (!s) return null
    return { id: segId, title: s.title, video: await vurl(env, u, s.video_url), poster: s.poster || null, dur: s.dur || 6, lines: s.lines || [] }
  }

  /** 第 k 猜用哪张卡：先剧情卡，再加时卡（按种子洗牌、轮次循环、无限续） */
  async function cardAt(seed: string, k: number) {
    if (k < STORY.length) return { card: STORY[k], phase: 'story' as const }
    if (!BONUS.length) return null
    const j = k - STORY.length, round = Math.floor(j / BONUS.length)
    const order = BONUS.map((c, i) => ({ c, i }))
    for (let i = order.length - 1; i > 0; i--) { const r = await seedFloat(seed, `bonus:${round}:${i}`); const x = Math.floor(r * (i + 1));[order[i], order[x]] = [order[x], order[i]] }
    return { card: order[j % BONUS.length].c, phase: 'bonus' as const }
  }

  async function poolBalance(env: Env) {
    const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL).first()
    return r?.b || 0
  }
  async function ensurePool(env: Env) {
    const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL).first()
    if (!r && CFG.seed_pool > 0) await post(env, '惊心1分钟奖池·上线注资', SERIES, [['platform:house', 'D', CFG.seed_pool], [POOL, 'C', CFG.seed_pool]])
  }
  const publicCfg = () => ({ stakes: CFG.stakes, pick_sec: CFG.pick_sec, max_mult: CFG.max_mult, jackpot_step: CFG.jackpot_step, jackpot_share: CFG.jackpot_share, jackpot_cap_mult: CFG.jackpot_cap_mult, rtp: CFG.rtp, rake: CFG.rake })

  async function meta(env: Env, userId?: string) {
    await ensurePool(env)
    const recent = (await env.DB.prepare(`SELECT user_id, hits, mult, payout, stake, jackpot, end_reason, ended_at FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 8`).bind(SERIES).all()).results as any[]
    const agg: any = await env.DB.prepare(`SELECT COUNT(*) n, COALESCE(MAX(hits),0) best, COALESCE(MAX(mult),0) top_mult, COALESCE(MAX(jackpot),0) top FROM thrill_runs WHERE series_id=? AND status='ended'`).bind(SERIES).first()
    const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(userId, SERIES, now() - STALE_MS).first() : null
    return {
      series: { ...DATA.series }, story_cards: STORY.length, bonus_cards: BONUS.length, main_segs: MAIN.length,
      cfg: publicCfg(), ladder: ladderTable(CFG), pool: await poolBalance(env),
      stats: { plays: agg?.n || 0, best_streak: agg?.best || 0, top_mult: agg?.top_mult || 0, top_jackpot: agg?.top || 0 },
      recent: recent.map((x) => ({ who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, mult: x.mult, win: x.payout, stake: x.stake, jackpot: x.jackpot, reason: x.end_reason, at: x.ended_at })),
      open_run: open?.id || null
    }
  }

  // ─────────────────────────── 开局 ───────────────────────────
  async function start(env: Env, p: { userId: string; stake: number; ipHash: string; sybil?: boolean }) {
    const stake = Math.floor(+p.stake)
    if (!CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${CFG.stakes.join(' / ')}`)
    const u: any = await ensureUser(env, p.userId)
    if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
    if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
    if (u.chips < stake) throw new GameError('INSUFFICIENT', `需要 ${stake} Chips`)
    const day = new Date(); day.setHours(0, 0, 0, 0)
    const spent: any = await env.DB.prepare(`SELECT COALESCE(SUM(stake),0) s FROM thrill_runs WHERE user_id=? AND started_at>=?`).bind(p.userId, day.getTime()).first()
    if ((spent?.s || 0) + stake > u.daily_limit) throw new GameError('DAILY_LIMIT', `超出日限额 ${u.daily_limit}`)
    await expireStale(env)
    const mine: any = await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - STALE_MS).first()
    if (mine) throw new GameError('ONE_AT_A_TIME', '你有一局「惊心 1 分钟」还没结束，必须先演完')
    const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - STALE_MS).first()
    if ((ipOpen?.n || 0) >= CFG.max_open_per_ip) {
      await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { ip_open: ipOpen.n, series: SERIES })
      throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限，请先看完正在进行的一局')
    }
    await ensurePool(env)
    const rid = uid('tr_'), seed = randomHex(32)
    const commit = await sha256(`${seed}|${rid}`)
    const rake = Math.floor(stake * CFG.rake)
    await post(env, '惊心1分钟·开局托管', rid, [[`user:${p.userId}:available`, 'D', stake], [`escrow:thrill:${rid}`, 'C', stake - rake], [POOL, 'C', rake]])
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake, p.userId),
      env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,?,0,?,?,'[]',?,'playing',0,1,?)`)
        .bind(rid, p.userId, SERIES, p.ipHash, stake, seed, commit, JSON.stringify({ ...CFG, sybil: !!p.sybil, rake_amt: rake }), now())
    ])
    return {
      run_id: rid, commit, stake, rake, pick_sec: CFG.pick_sec, ladder: ladderTable(CFG), pool: await poolBalance(env),
      intro: await segOut(env, p.userId, MAIN[0]),
      card: await cardPayload(env, p.userId, rid, seed, 0),
      balance: u.chips - stake
    }
  }

  /** 猜卡载荷：问题 + A/B 文案 + 两面揭晓片段的等长密文（揭晓时只下发展示那一面的钥匙） */
  async function cardPayload(env: Env, userId: string, rid: string, seed: string, k: number) {
    const ca = await cardAt(seed, k)
    if (!ca) return null
    const c = ca.card
    const plains = await Promise.all(['a', 'b'].map(async (side) => ({ side, plain: JSON.stringify({ side, label: c[side].label, ...(await segOut(env, userId, c[side].seg)) }) })))
    const pad = Math.ceil(Math.max(...plains.map((x) => new TextEncoder().encode(x.plain).length)) / 512) * 512
    const slots: any[] = []
    for (const x of plains) slots.push({ side: x.side, ...(await encryptSlot(x.plain, pad)) })
    if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) slots.reverse()
    await env.DB.prepare(`INSERT OR REPLACE INTO thrill_gate_slots (run_id,gate,slots) VALUES (?,?,?)`).bind(rid, k, JSON.stringify(slots)).run()
    const cfg = CFG, h = k
    return {
      step: k + 1, phase: ca.phase, id: c.id, title: c.title || (ca.phase === 'story' ? `第 ${k + 1} 猜` : `加时 · 第 ${k + 1} 猜`), q: c.q,
      a: { label: c.a.label }, b: { label: c.b.label },
      p: pAt(cfg, h), mult_now: multAt(cfg, h), mult_next: multAt(cfg, h + 1), jackpot: h + 1 === cfg.jackpot_step,
      encrypted: slots.map((s, i) => ({ slot: i, iv: s.iv, ct: s.ct }))
    }
  }

  async function load(env: Env, rid: string, userId: string) {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
    if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
    return r
  }

  async function arm(env: Env, p: { runId: string; userId: string }) {
    const r = await load(env, p.runId, p.userId)
    if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
    if (r.armed_at) return { step: r.gate + 1, lock_at: r.lock_at, server_time: now() }
    const t = now(), lock = t + J(r.cfg, CFG).pick_sec * 1000 + 800
    await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(t, lock, r.id).run()
    return { step: r.gate + 1, lock_at: lock, server_time: t }
  }

  /** 剩余主线：第 k 猜之后应接着演的主线片段（猜错 / 落袋后也照演，剧情顺畅到底） */
  const restMain = async (env: Env, userId: string, fromIdx: number) => Promise.all(MAIN.slice(fromIdx).map((s) => segOut(env, userId, s)))

  // ─────────────────────────── 行动：选 A / B 继续爬，或落袋 ───────────────────────────
  async function act(env: Env, p: { runId: string; userId: string; step: number; side?: 'a' | 'b' | null; cashout?: boolean }) {
    const r = await load(env, p.runId, p.userId)
    if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
    if (+p.step !== r.gate + 1) throw new GameError('STALE_STEP', `当前是第 ${r.gate + 1} 猜`)
    const cfg: any = J(r.cfg, CFG), k = r.gate
    const late = !r.armed_at || now() > r.lock_at
    let side = p.side === 'a' || p.side === 'b' ? p.side : null
    if (p.side && !side) throw new GameError('BAD_SIDE', '只能选 A 或 B')
    // 超时 / 未计时 / 主动落袋 → 落袋（第 0 猜落袋 = 退回扣除抽成后的注金）
    if (p.cashout || late || !side) {
      if (!(await claim(env, r.id, k))) throw new GameError('DUPLICATE', '本猜已结算')
      await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,picked_at) VALUES (?,?,?,?,0,?,?,0,?)`).bind(r.id, k, p.cashout ? 'cashout' : 'timeout', '-', r.hits, multAt(cfg, r.hits), now()).run()
      return { step: k + 1, action: p.cashout ? 'cashout' : 'timeout', ...(await settle(env, r.id, p.cashout ? 'cashout' : 'timeout')), rest: await restMain(env, r.user_id, k + 1) }
    }
    // 选面：命中与选哪一面无关 —— r_k < p_k 即命中；展示面 = 命中 ? 你选的面 : 另一面
    const rk = await seedFloat(r.seed, `step:${k}`), pk = pAt(cfg, k)
    const hit = rk < pk
    const shown = hit ? side : side === 'a' ? 'b' : 'a'
    const hits = hit ? r.hits + 1 : r.hits, mult = hit ? multAt(cfg, hits) : 0
    if (!(await claim(env, r.id, k, hit, mult))) throw new GameError('DUPLICATE', '本猜已结算')
    await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,picked_at) VALUES (?,?,?,?,?,?,?,0,?)`).bind(r.id, k, side, shown, hit ? 1 : 0, hits, mult, now()).run()
    const slots: any[] = J(((await env.DB.prepare('SELECT slots FROM thrill_gate_slots WHERE run_id=? AND gate=?').bind(r.id, k).first()) as any)?.slots, [])
    const si = slots.findIndex((s) => s.side === shown)
    const ca = await cardAt(r.seed, k)
    const res: any = { step: k + 1, side, hit, shown, p: pk, hits, mult, reveal: { slot: si, key: slots[si]?.key, side: shown, label: ca?.card[shown].label } }
    // 主线：本猜之后的那段主线（剧情卡 k 在 main[k] 之后 → 揭晓后接 main[k+1]）
    const nextMainIdx = k + 1 < MAIN.length ? k + 1 : null
    if (!hit) return Object.assign(res, await settle(env, r.id, 'miss'), { rest: await restMain(env, r.user_id, k + 1) })
    if (hits === cfg.jackpot_step) res.jackpot = await awardJackpot(env, r)
    if (mult >= cfg.max_mult) return Object.assign(res, await settle(env, r.id, 'cap'), { rest: await restMain(env, r.user_id, k + 1) })
    const next = await cardPayload(env, r.user_id, r.id, r.seed, k + 1)
    if (!next) return Object.assign(res, await settle(env, r.id, 'final'), { rest: await restMain(env, r.user_id, k + 1) })
    res.main = nextMainIdx !== null ? await segOut(env, r.user_id, MAIN[nextMainIdx]) : null
    res.next = next
    return res
  }
  /** 原子推进一步（防重复提交 / 双开同一局） */
  async function claim(env: Env, rid: string, k: number, hit?: boolean, mult?: number) {
    const u = hit
      ? await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, hits=hits+1, streak=streak+1, mult=?, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(mult ?? 1, rid, k).run()
      : await env.DB.prepare(`UPDATE thrill_runs SET armed_at=NULL, lock_at=NULL, status='settling' WHERE id=? AND gate=? AND status='playing'`).bind(rid, k).run()
    return !!u.meta.changes
  }

  /** Jackpot：连中到第 jackpot_step 猜立即发放（风控命中则冻结待审），之后可继续爬 */
  async function awardJackpot(env: Env, r: any) {
    const cfg: any = J(r.cfg, CFG)
    const pool = await poolBalance(env)
    const jackpot = Math.max(0, Math.min(Math.floor(pool * cfg.jackpot_share), r.stake * cfg.jackpot_cap_mult))
    if (!jackpot) return { amount: 0 }
    const dev: any = await env.DB.prepare('SELECT created_at FROM auth_devices WHERE uid=?').bind(r.user_id).first()
    const ageH = dev ? (now() - dev.created_at) / 3600000 : 0
    const ipWins: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND jackpot>0 AND started_at>? AND id!=?`).bind(r.ip_hash, now() - 86400000, r.id).first()
    let hold: string | null = null
    if (cfg.sybil) hold = '同网络新设备超限（疑似多开）'
    else if (ageH < cfg.jackpot_min_age_h) hold = `账号注册不足 ${cfg.jackpot_min_age_h} 小时`
    else if ((ipWins?.n || 0) > 0) hold = '同网络 24 小时内已中过 Jackpot'
    if (hold) {
      await post(env, '惊心1分钟·Jackpot 待审核', r.id, [[POOL, 'D', jackpot], [`hold:thrill:${r.id}`, 'C', jackpot]])
      await riskEvent(env as any, r.user_id, 'thrill_jackpot_hold', 2, { run: r.id, jackpot, reason: hold })
    } else {
      await post(env, '惊心1分钟·Jackpot', r.id, [[POOL, 'D', jackpot], [`user:${r.user_id}:available`, 'C', jackpot]])
      await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(jackpot, r.user_id).run()
    }
    await env.DB.prepare(`UPDATE thrill_runs SET jackpot=?, jackpot_status=?, hold_reason=? WHERE id=?`).bind(jackpot, hold ? 'held' : 'paid', hold, r.id).run()
    return { amount: jackpot, status: hold ? 'held' : 'paid', hold_reason: hold }
  }

  /** 结算：miss = 注金归平台；cashout / timeout / cap / final = 按当前倍率赔付（0 猜落袋 = 退净注金） */
  async function settle(env: Env, rid: string, reason: 'miss' | 'cashout' | 'timeout' | 'cap' | 'final') {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    const cfg: any = J(r.cfg, CFG), net = r.stake - (cfg.rake_amt ?? 0)
    const mult = reason === 'miss' ? 0 : multAt(cfg, r.hits)
    const payout = reason === 'miss' ? 0 : r.hits === 0 ? net : Math.floor(r.stake * mult)
    if (payout) {
      const lines: [string, 'D' | 'C', number][] = [[`escrow:thrill:${rid}`, 'D', net], [`user:${r.user_id}:available`, 'C', payout]]
      if (payout > net) lines.push(['platform:house', 'D', payout - net]); else if (payout < net) lines.push(['platform:house', 'C', net - payout])
      await post(env, `惊心1分钟·${reason === 'cashout' ? '落袋' : reason === 'timeout' ? '超时自动落袋' : reason === 'cap' ? '封顶落袋' : '卡库演完落袋'} ×${mult}`, rid, lines)
      await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(payout, r.user_id).run()
    } else await post(env, '惊心1分钟·猜错', rid, [[`escrow:thrill:${rid}`, 'D', net], ['platform:house', 'C', net]])
    await env.DB.prepare(`UPDATE thrill_runs SET status='ended', payout=?, mult=?, end_reason=?, ended_at=? WHERE id=?`).bind(payout, mult, reason, now(), rid).run()
    const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
    const picks = (await env.DB.prepare('SELECT gate, option_id, outcome_id, hit FROM thrill_picks WHERE run_id=? ORDER BY gate').bind(rid).all()).results as any[]
    return {
      ended: true, reason, hits: r.hits, mult, payout, stake: r.stake, jackpot: r.jackpot, jackpot_status: r.jackpot_status, hold_reason: r.hold_reason,
      net: payout + (r.jackpot_status === 'paid' ? r.jackpot : 0) - r.stake, balance: u?.chips, pool: await poolBalance(env),
      verify: { seed: r.seed, commit: r.commit_hash, picks, formula: 'sha256(seed|run_id)=commit；第 k 猜 r=HMAC(seed,"step:k") 前 52 位/2^52，命中 ⇔ r < 该步命中率（与选 A/B 无关）' }
    }
  }

  /** 离开超过 STALE_MS 的局：按当前倍率自动落袋（不会因为掉线而白输） */
  async function expireStale(env: Env) {
    const old = (await env.DB.prepare(`SELECT id,gate FROM thrill_runs WHERE status='playing' AND series_id=? AND started_at<?`).bind(SERIES, now() - STALE_MS).all()).results as any[]
    for (const r of old) if (await claim(env, r.id, r.gate)) await settle(env, r.id, 'timeout').catch(() => {})
  }

  async function resume(env: Env, userId: string) {
    const r: any = await env.DB.prepare(`SELECT * FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(userId, SERIES, now() - STALE_MS).first()
    if (!r) return null
    return { run_id: r.id, commit: r.commit_hash, stake: r.stake, pick_sec: J(r.cfg, CFG).pick_sec, hits: r.hits, mult: multAt(CFG, r.hits), ladder: ladderTable(CFG),
      card: await cardPayload(env, userId, r.id, r.seed, r.gate), main: r.gate < MAIN.length ? await segOut(env, userId, MAIN[r.gate]) : null }
  }

  async function verify(env: Env, rid: string) {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
    if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, status: r.status, note: '本局未结束，种子保密' }
    const cfg: any = J(r.cfg, CFG)
    const picks = (await env.DB.prepare('SELECT * FROM thrill_picks WHERE run_id=? ORDER BY gate').bind(rid).all()).results as any[]
    const rows = []
    let ok = (await sha256(`${r.seed}|${rid}`)) === r.commit_hash
    for (const pk of picks) {
      if (pk.option_id === 'cashout' || pk.option_id === 'timeout') { rows.push({ step: pk.gate + 1, action: pk.option_id }); continue }
      const rk = await seedFloat(r.seed, `step:${pk.gate}`), hit = rk < pAt(cfg, pk.gate)
      if (hit !== !!pk.hit) ok = false
      rows.push({ step: pk.gate + 1, pick: pk.option_id, r: rk, p: pAt(cfg, pk.gate), hit })
    }
    return { run_id: rid, seed: r.seed, commit: r.commit_hash, steps: rows, ok }
  }

  /** 蒙特卡洛：玩家策略 = 爬到第 target 猜后落袋（target=Infinity 一直爬） */
  function simulate(n = 100000, stake = 10, target = 3) {
    let staked = 0, paid = 0, pool = CFG.seed_pool, jp = 0, jpHits = 0
    for (let i = 0; i < n; i++) {
      staked += stake; pool += Math.floor(stake * CFG.rake)
      let h = 0, alive = true
      while (alive && h < target && multAt(CFG, h) < CFG.max_mult) {
        if (Math.random() < pAt(CFG, h)) { h++; if (h === CFG.jackpot_step) { const j = Math.min(Math.floor(pool * CFG.jackpot_share), stake * CFG.jackpot_cap_mult); pool -= j; paid += j; jp += j; jpHits++ } } else alive = false
      }
      if (alive) paid += h ? Math.floor(stake * multAt(CFG, h)) : stake - Math.floor(stake * CFG.rake)
    }
    return { runs: n, target, rtp_total: Math.round((paid / staked) * 1000) / 10, jackpots: jpHits, jackpot_paid: jp, pool_end: pool }
  }

  async function resolveHold(env: Env, rid: string, approve: boolean, actor = 'admin') {
    const r: any = await env.DB.prepare(`SELECT * FROM thrill_runs WHERE id=? AND jackpot_status='held'`).bind(rid).first()
    if (!r) throw new GameError('NOT_HELD', '该局没有待审核的 Jackpot')
    const upd = await env.DB.prepare(`UPDATE thrill_runs SET jackpot_status=? WHERE id=? AND jackpot_status='held'`).bind(approve ? 'released' : 'void', rid).run()
    if (!upd.meta.changes) throw new GameError('DUPLICATE', '已处理')
    if (approve) {
      await post(env, '惊心1分钟·Jackpot 审核放行', rid, [[`hold:thrill:${rid}`, 'D', r.jackpot], [`user:${r.user_id}:available`, 'C', r.jackpot]])
      await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(r.jackpot, r.user_id).run()
    } else await post(env, '惊心1分钟·Jackpot 作废退池', rid, [[`hold:thrill:${rid}`, 'D', r.jackpot], [POOL, 'C', r.jackpot]])
    await env.DB.prepare('INSERT INTO audit_log (actor,action,detail,created_at) VALUES (?,?,?,?)').bind(actor, approve ? 'thrill_release' : 'thrill_void', JSON.stringify({ rid, jackpot: r.jackpot }), now()).run()
    return { ok: true, run_id: rid, status: approve ? 'released' : 'void', jackpot: r.jackpot }
  }

  return { SERIES, CFG, DATA, MAIN, STORY, BONUS, meta, start, arm, act, verify, simulate, poolBalance, ensurePool, expireStale, resolveHold, resume, validate: () => validate(DATA) }
}
