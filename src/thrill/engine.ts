// 惊心 1 分钟（Thrill 60s）—— 真人剧 5 关连续竞猜
// ─────────────────────────────────────────────────────────────────────────────
// 一局 = 一条完整的 1 分钟剧情：序章 → 关1 → 关2 → 关3 → 关4 → 关5 → 结局
// · 每关 2~3 个分支，命中完全随机（服务端真随机，均匀分布）；开局时 5 关结果一次性生成并承诺（commit），
//   通关后公开种子，任何人可复算 —— 平台无法事后改结果，玩家也无法预知
// · 开局一次性托管「每关注金 × 5」，之后不能撤注、不能悔棋、不能暂停回看 —— 剧情一口气演完
// · 连续命中按阶梯倍率赔付（第 1 中 ×2、连 2 ×3、连 3 ×4、连 4 ×5、连 5 ×6）；未中连击清零，本关注金归平台
// · 5 关全中 = Jackpot：额外瓜分本剧奖池（奖池来自每局注金抽成 + 平台注资，只发奖池里有的钱，平台永不超发）
// · 剧情分支：每关的结局片段 = 该关被抽中的分支；后一关的抉择情境由前一关结果决定（交叉剧情），
//   但下一关的「命中概率」与前面结果无关（独立均匀），保证博弈公平
// 防作弊：令牌身份（不可冒充）· 同账号同时只能有 1 局进行中 · 同 IP 同时最多 2 局 · Jackpot 需账号满 24h 且非女巫，
//         否则进入人工审核 · 每关抉择窗口服务端计时 · 视频只凭当局票据播放 · 所有资金走复式账本
import { encryptSlot, hmac, randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database }
const now = () => Date.now()
/** 一局最长存活 10 分钟（1 分钟剧 + 网络余量）；超时剩余关按弃权清算 */
export const STALE_MS = 10 * 60000
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

/** 平台默认参数（每部剧可覆盖 DATA.thrill.cfg）；RTP 见 ladderRtp() */
export const DEFAULT_CFG = {
  ladder: [2, 3, 4, 5, 6],        // 连击倍率：第 k 次连续命中 × ladder[k-1]（配合关卡选项数 2/3/3/3/3 → 阶梯返还 86.7%）
  stakes: [10, 20, 50, 100, 200], // 每关注金档位（开局托管 ×5）
  pick_sec: 6,                    // 每关抉择窗口（秒）—— 1 分钟节奏，窗口很短
  rake: 0.05,                     // 每局总注金的 5% 注入本剧奖池
  jackpot_share: 0.5,             // 全中者拿走当前奖池的 50%
  jackpot_cap_mult: 200,          // 单次 Jackpot 上限 = 每关注金 × 200
  seed_pool: 20000,               // 新剧上线平台注资
  max_open_per_ip: 2,             // 同 IP 同时进行中的局数上限（多开拦截）
  jackpot_min_age_h: 24           // 账号满 24 小时才能直接拿 Jackpot，否则冻结待审核
}
export type Cfg = typeof DEFAULT_CFG
/** 总返还率红线（阶梯 + 奖池）；超出拒绝上架 */
export const MAX_RTP = 0.94

/** 阶梯 RTP（不含奖池）：枚举所有 2^5 条命中路径，按每关选项数精确计算 —— 用来校验倍率不会让平台亏损 */
export function ladderRtp(ladder: number[], arity: number[]) {
  let total = 0, p5 = 1
  const n = arity.length
  for (let mask = 0; mask < 1 << n; mask++) {
    let p = 1, s = 0, pay = 0
    for (let k = 0; k < n; k++) {
      const hit = (mask >> k) & 1, q = 1 / arity[k]
      p *= hit ? q : 1 - q
      if (hit) { s++; pay += ladder[Math.min(s, ladder.length) - 1] } else s = 0
    }
    total += p * pay
  }
  for (const a of arity) p5 *= 1 / a
  return { rtp: total / n, jackpot_odds: 1 / p5 }
}

// ─────────────────────────── 剧本数据（DATA） ───────────────────────────
// DATA = {
//   series: { id, title, logline, tension },  thrill: { cfg? },
//   prologue: seg_id,                     // 序章片段（≈8 秒）
//   gates: [ { id, title, question, options: [ { id, label, hint, seg } ] } ×5 ],   // 每关 2~3 个选项，每个选项对应一个结果片段（≈8 秒）
//   // 交叉剧情：gates[k].variants?: { [上一关命中选项 id]: { question, options: [...] } } —— 前一关结果改变本关情境与选项文案/片段
//   endings: { perfect: seg, ...按命中数分档: { "0": seg, "1-2": seg, "3-4": seg } }（可选；不填则以第 5 关片段收尾）
//   segments: { [seg_id]: { title, video_url, poster, dur, lines } }
// }
export function validate(DATA: any) {
  const errs: string[] = []
  if (!DATA?.series?.id) errs.push('缺少 series.id')
  const gates = DATA?.gates || []
  if (gates.length !== 5) errs.push(`必须正好 5 关，当前 ${gates.length}`)
  const segs = DATA?.segments || {}
  if (!segs[DATA?.prologue]) errs.push('序章片段不存在')
  gates.forEach((g: any, i: number) => {
    const sets = [g, ...Object.values<any>(g.variants || {})]
    for (const s of sets) {
      const n = (s.options || []).length
      if (n < 2 || n > 3) errs.push(`第 ${i + 1} 关选项数必须 2~3 个（当前 ${n}）`)
      for (const o of s.options || []) if (!segs[o.seg]) errs.push(`第 ${i + 1} 关选项「${o.label}」缺少片段 ${o.seg}`)
    }
    // 交叉剧情：所有情境的选项数必须一致，否则「命中概率」会随上一关结果变化，不公平
    const ns = new Set(sets.map((s: any) => (s.options || []).length))
    if (ns.size > 1) errs.push(`第 ${i + 1} 关各交叉情境的选项数不一致（${[...ns].join('/')}），会导致命中概率随前一关变化`)
  })
  // 经济红线：阶梯返还 + 奖池抽成 必须 ≤ MAX_RTP，否则平台长期必亏（例：全二选一 + 2/3/4/5/6 倍 = 130%）
  if (gates.length === 5 && !errs.length) {
    const cfg = { ...DEFAULT_CFG, ...(DATA.thrill?.cfg || {}) }
    const r = ladderRtp(cfg.ladder, gates.map((g: any) => g.options.length))
    if (r.rtp + cfg.rake > MAX_RTP) errs.push(`倍率阶梯不可持续：阶梯返还 ${(r.rtp * 100).toFixed(1)}% + 奖池 ${(cfg.rake * 100).toFixed(0)}% > ${MAX_RTP * 100}%（请增加关卡选项数或降低倍率）`)
  }
  return errs
}

export function createThrill(DATA: any) {
  const errs = validate(DATA)
  if (errs.length) throw new GameError('THRILL_INVALID', '惊心 1 分钟剧本不合法：' + errs.join('；'))
  const SERIES = DATA.series.id
  const CFG: Cfg = { ...DEFAULT_CFG, ...(DATA.thrill?.cfg || {}) }
  const GATES: any[] = DATA.gates
  const ARITY = GATES.map((g) => g.options.length)
  const POOL = `pool:thrill:${SERIES}`
  const clipOf = (url: string) => (url.split('/').pop() || '').replace(/\.mp4$/, '')
  const vurl = async (env: any, u: string, url?: string | null) => (url ? (DATA.series.gated === false ? url : mediaTicket(env, u, SERIES, clipOf(url), 30 * 60000)) : null)

  /** 某关在某条历史下的情境（交叉剧情）：上一关命中选项决定本关问题与选项 */
  const sceneOf = (k: number, prevOutcome?: string) => {
    const g = GATES[k], v = prevOutcome && g.variants?.[prevOutcome]
    return { id: g.id, title: v?.title || g.title, question: v?.question || g.question, options: (v?.options || g.options) as any[] }
  }
  const segOut = async (env: any, u: string, segId: string) => {
    const s = DATA.segments[segId]; if (!s) return null
    return { id: segId, title: s.title, video: await vurl(env, u, s.video_url), poster: s.poster || null, dur: s.dur || 8, lines: s.lines || [] }
  }

  async function poolBalance(env: Env) {
    const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL).first()
    return r?.b || 0
  }
  /** 首次开局时平台注资（只做一次） */
  async function ensurePool(env: Env) {
    const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL).first()
    if (!r && CFG.seed_pool > 0) await post(env, '惊心1分钟奖池·上线注资', SERIES, [['platform:house', 'D', CFG.seed_pool], [POOL, 'C', CFG.seed_pool]])
  }

  /** 公开信息：剧集、阶梯、奖池、RTP、近期战报（不含任何结果与视频） */
  async function meta(env: Env, userId?: string) {
    await ensurePool(env)
    const recent = (await env.DB.prepare(`SELECT user_id, hits, payout, jackpot, ended_at FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 8`).bind(SERIES).all()).results as any[]
    const agg: any = await env.DB.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN hits=5 THEN 1 ELSE 0 END) perfect, COALESCE(MAX(jackpot),0) top FROM thrill_runs WHERE series_id=? AND status='ended'`).bind(SERIES).first()
    const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND status='playing' LIMIT 1`).bind(userId).first() : null
    const r = ladderRtp(CFG.ladder, ARITY)
    return {
      series: { ...DATA.series }, gates: GATES.map((g, i) => ({ no: i + 1, title: g.title, arity: g.options.length })),
      cfg: { ladder: CFG.ladder, stakes: CFG.stakes, pick_sec: CFG.pick_sec, jackpot_share: CFG.jackpot_share, jackpot_cap_mult: CFG.jackpot_cap_mult },
      pool: await poolBalance(env), rtp: Math.round(r.rtp * 1000) / 10, jackpot_odds: Math.round(r.jackpot_odds),
      stats: { plays: agg?.n || 0, perfect: agg?.perfect || 0, top_jackpot: agg?.top || 0 },
      recent: recent.map((x) => ({ who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, payout: x.payout, jackpot: x.jackpot, at: x.ended_at })),
      open_run: open?.id || null
    }
  }

  // ─────────────────────────── 开局（托管全部注金 + 承诺 5 关结果） ───────────────────────────
  async function start(env: Env, p: { userId: string; stake: number; ipHash: string; sybil?: boolean }) {
    const stake = Math.floor(+p.stake)
    if (!CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `每关注金只能是 ${CFG.stakes.join(' / ')}`)
    const u: any = await ensureUser(env, p.userId)
    if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
    if (u.cooloff_until && new Date(u.cooloff_until).getTime() > now()) throw new GameError('COOLOFF', '冷静期中')
    const total = stake * GATES.length
    if (u.chips < total) throw new GameError('INSUFFICIENT', `需要 ${total} Chips（每关 ${stake} × ${GATES.length} 关）`)
    // 日限额：与普通下注共用
    const day = new Date(); day.setHours(0, 0, 0, 0)
    const spent: any = await env.DB.prepare(`SELECT COALESCE(SUM(stake*gates),0) s FROM thrill_runs WHERE user_id=? AND started_at>=?`).bind(p.userId, day.getTime()).first()
    if ((spent?.s || 0) + total > u.daily_limit) throw new GameError('DAILY_LIMIT', `超出日限额 ${u.daily_limit}`)
    // 多开拦截：同账号同时只能 1 局；同 IP 同时最多 N 局（进行中且 10 分钟内）
    await expireStale(env)
    const mine: any = await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - STALE_MS).first()
    if (mine) throw new GameError('ONE_AT_A_TIME', '你有一局「惊心 1 分钟」还没演完，必须先看完')
    const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - STALE_MS).first()
    if ((ipOpen?.n || 0) >= CFG.max_open_per_ip) {
      await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { ip_open: ipOpen.n, series: SERIES })
      throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限，请先看完正在进行的一局')
    }
    await ensurePool(env)
    const rid = uid('tr_'), seed = randomHex(32)
    // 5 关结果：每关独立均匀随机（与玩家选择、与前一关结果都无关）；交叉剧情只改变「情境」，不改变概率
    const outcomes: string[] = []
    for (let k = 0; k < GATES.length; k++) {
      const sc = sceneOf(k, outcomes[k - 1])
      const r = await seedFloat(seed, `gate:${k}`)
      outcomes.push(sc.options[Math.min(sc.options.length - 1, Math.floor(r * sc.options.length))].id)
    }
    const commit = await sha256(`${seed}|${rid}|${outcomes.join(',')}`)
    const t = now()
    // 资金：总注金一次性冻结到本局托管账户；抽成 rake 立即注入奖池
    // 抽成按关计（每关 floor(stake×rake)），托管额 = 5 × 每关净额，逐关清算后托管账户精确归零，无尾差
    const rakePer = Math.floor(stake * CFG.rake), rake = rakePer * GATES.length
    await post(env, '惊心1分钟·开局托管', rid, [[`user:${p.userId}:available`, 'D', total], [`escrow:thrill:${rid}`, 'C', total - rake], [POOL, 'C', rake]])
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(total, p.userId),
      env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(rid, p.userId, SERIES, p.ipHash, stake, GATES.length, seed, commit, JSON.stringify(outcomes), JSON.stringify({ ...CFG, sybil: !!p.sybil, rake_per: rakePer }), 'playing', 0, t)
    ])
    const s0 = sceneOf(0)
    return {
      run_id: rid, commit, stake, total, rake, ladder: CFG.ladder, pick_sec: CFG.pick_sec, pool: await poolBalance(env),
      prologue: await segOut(env, p.userId, DATA.prologue),
      gate: await gatePayload(env, p.userId, rid, 0, s0),
      balance: u.chips - total
    }
  }

  /** 关卡载荷：问题 + 选项 + 每个选项结果片段的等长密文（可预载，抉择后只下发命中片段的密钥） */
  async function gatePayload(env: Env, userId: string, rid: string, k: number, sc: any) {
    const plains = await Promise.all(sc.options.map(async (o: any) => ({ id: o.id, plain: JSON.stringify(await segOut(env, userId, o.seg)) })))
    const pad = Math.ceil(Math.max(...plains.map((x) => new TextEncoder().encode(x.plain).length)) / 512) * 512
    const slots: any[] = []
    for (const x of plains) slots.push({ option_id: x.id, ...(await encryptSlot(x.plain, pad)) })
    // 密码学洗牌（Fisher-Yates + CSPRNG），槽位顺序与选项顺序无关
    for (let i = slots.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [slots[i], slots[j]] = [slots[j], slots[i]] }
    await env.DB.prepare(`INSERT OR REPLACE INTO thrill_gate_slots (run_id,gate,slots) VALUES (?,?,?)`).bind(rid, k, JSON.stringify(slots)).run()
    return { no: k + 1, id: sc.id, title: sc.title, question: sc.question, options: sc.options.map((o: any) => ({ id: o.id, label: o.label, hint: o.hint || '' })),
      encrypted: slots.map((s, i) => ({ slot: i, iv: s.iv, ct: s.ct })) }
  }

  async function load(env: Env, rid: string, userId: string) {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
    if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
    return r
  }

  /** 抉择面板出现时激活计时（每关只能激活一次） */
  async function arm(env: Env, p: { runId: string; userId: string }) {
    const r = await load(env, p.runId, p.userId)
    if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
    if (r.armed_at) return { gate: r.gate + 1, lock_at: r.lock_at, server_time: now() }
    const t = now(), lock = t + J(r.cfg, CFG).pick_sec * 1000 + 800 // 0.8 秒网络余量
    await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(t, lock, r.id).run()
    return { gate: r.gate + 1, lock_at: lock, server_time: t }
  }

  // ─────────────────────────── 押注本关 → 揭晓 → 结算 → 下一关 ───────────────────────────
  async function pick(env: Env, p: { runId: string; userId: string; optionId?: string | null; gate: number }) {
    const r = await load(env, p.runId, p.userId)
    if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
    if (+p.gate !== r.gate + 1) throw new GameError('STALE_GATE', `当前是第 ${r.gate + 1} 关`)
    const cfg: any = J(r.cfg, CFG), outs: string[] = J(r.outcomes, [])
    const k = r.gate, prev = k ? outs[k - 1] : undefined, sc = sceneOf(k, prev)
    const outcome = outs[k]
    // 超时：服务端计时；未激活就提交也按超时处理（防止跳过计时）
    let opt = p.optionId || null
    const late = !r.armed_at || now() > r.lock_at
    if (opt && !sc.options.some((o: any) => o.id === opt)) throw new GameError('BAD_OPTION', '无效选项')
    if (late) opt = null
    const hit = opt === outcome ? 1 : 0
    const streak = hit ? r.streak + 1 : 0
    const mult = hit ? cfg.ladder[Math.min(streak, cfg.ladder.length) - 1] : 0
    const stakeNet = r.stake - (cfg.rake_per ?? Math.floor(r.stake * cfg.rake)) // 托管里每关实际可用（已扣抽成）
    const payout = hit ? Math.floor(r.stake * mult) : opt === null ? stakeNet : 0 // 超时弃权：退回本关（扣抽成后）注金
    // 并发安全：只有 gate 未变时才能结算（防重复提交/双开同一局）
    const upd = await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, streak=?, hits=hits+?, payout=payout+?, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`)
      .bind(streak, hit, payout, r.id, k).run()
    if (!upd.meta.changes) throw new GameError('DUPLICATE', '本关已结算')
    await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,picked_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(r.id, k, opt, outcome, hit, streak, mult, payout, now()).run()
    // 资金：托管里本关份额（stakeNet）——命中：从托管 + 平台补足赔付；未中：本关份额归平台；弃权：原路退回
    if (hit) await post(env, `惊心1分钟·第${k + 1}关命中 ×${mult}`, r.id, [[`escrow:thrill:${r.id}`, 'D', stakeNet], ['platform:house', 'D', payout - stakeNet], [`user:${r.user_id}:available`, 'C', payout]])
    else if (opt === null) await post(env, `惊心1分钟·第${k + 1}关超时退回`, r.id, [[`escrow:thrill:${r.id}`, 'D', stakeNet], [`user:${r.user_id}:available`, 'C', stakeNet]])
    else await post(env, `惊心1分钟·第${k + 1}关未中`, r.id, [[`escrow:thrill:${r.id}`, 'D', stakeNet], ['platform:house', 'C', stakeNet]])
    if (payout) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(payout, r.user_id).run()
    // 揭晓：只下发命中片段的密钥
    const slots: any[] = J(((await env.DB.prepare('SELECT slots FROM thrill_gate_slots WHERE run_id=? AND gate=?').bind(r.id, k).first()) as any)?.slots, [])
    const si = slots.findIndex((s) => s.option_id === outcome)
    const reveal = { slot: si, key: slots[si]?.key, outcome_id: outcome, label: sc.options.find((o: any) => o.id === outcome)?.label }
    const res: any = { gate: k + 1, pick: opt, timeout: opt === null, hit: !!hit, streak, mult, payout, reveal, next_mult: cfg.ladder[Math.min(streak + 1, cfg.ladder.length) - 1] }
    if (k + 1 < GATES.length) res.next = await gatePayload(env, r.user_id, r.id, k + 1, sceneOf(k + 1, outcome))
    else Object.assign(res, await finish(env, r.id))
    const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first(); res.balance = u?.chips
    return res
  }

  /** 收官：Jackpot 判定（5 关全中）+ 公开种子 */
  async function finish(env: Env, rid: string) {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    const cfg: any = J(r.cfg, CFG)
    let jackpot = 0, jstatus: string | null = null, hold: string | null = null
    if (r.hits === GATES.length) {
      const pool = await poolBalance(env)
      jackpot = Math.max(0, Math.min(Math.floor(pool * cfg.jackpot_share), r.stake * cfg.jackpot_cap_mult))
      // 风控：新号 / 女巫号 / 同 IP 近 24h 已中过 Jackpot → 冻结待审核（资金先划入待审账户，不会消失）
      const dev: any = await env.DB.prepare('SELECT created_at FROM auth_devices WHERE uid=?').bind(r.user_id).first()
      const ageH = dev ? (now() - dev.created_at) / 3600000 : 0
      const ipWins: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND jackpot>0 AND ended_at>? AND id!=?`).bind(r.ip_hash, now() - 86400000, rid).first()
      if (cfg.sybil) hold = '同网络新设备超限（疑似多开）'
      else if (ageH < cfg.jackpot_min_age_h) hold = `账号注册不足 ${cfg.jackpot_min_age_h} 小时`
      else if ((ipWins?.n || 0) > 0) hold = '同网络 24 小时内已中过 Jackpot'
      if (jackpot > 0) {
        if (hold) {
          jstatus = 'held'
          await post(env, '惊心1分钟·Jackpot 待审核', rid, [[POOL, 'D', jackpot], [`hold:thrill:${rid}`, 'C', jackpot]])
          await riskEvent(env as any, r.user_id, 'thrill_jackpot_hold', 2, { run: rid, jackpot, reason: hold })
        } else {
          jstatus = 'paid'
          await post(env, '惊心1分钟·Jackpot', rid, [[POOL, 'D', jackpot], [`user:${r.user_id}:available`, 'C', jackpot]])
          await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(jackpot, r.user_id).run()
        }
      }
    }
    await env.DB.prepare(`UPDATE thrill_runs SET status='ended', jackpot=?, jackpot_status=?, hold_reason=?, ended_at=? WHERE id=?`).bind(jackpot, jstatus, hold, now(), rid).run()
    const outs: string[] = J(r.outcomes, [])
    const endSeg = endingSeg(r.hits, outs[outs.length - 1])
    return {
      ended: true, hits: r.hits, total_payout: r.payout + (jstatus === 'paid' ? jackpot : 0), staked: r.stake * r.gates,
      jackpot, jackpot_status: jstatus, hold_reason: hold,
      ending: endSeg ? await segOut(env, r.user_id, endSeg) : null,
      verify: { seed: r.seed, commit: r.commit_hash, outcomes: outs, formula: 'sha256(seed|run_id|outcomes) = commit；第 k 关 = options[floor(HMAC(seed,"gate:k") 前 52 位 / 2^52 × 选项数)]' },
      pool: await poolBalance(env)
    }
  }
  /** 结局片段：全中 → perfect；否则按命中数分档；都没配就以第 5 关片段收尾（null） */
  function endingSeg(hits: number, last: string) {
    const e = DATA.endings || {}
    if (hits === GATES.length && e.perfect) return e.perfect
    for (const [k, v] of Object.entries<any>(e)) { if (k === 'perfect') continue; const [a, b] = k.split('-').map(Number); if (hits >= a && hits <= (b ?? a)) return v }
    void last; return null
  }

  /** 中途离开（关掉页面）超过 10 分钟：剩余关全部按弃权处理（注金退回、不发 Jackpot），不允许挂起后回来"看准了再押" */
  async function expireStale(env: Env) {
    const old = (await env.DB.prepare(`SELECT id,user_id FROM thrill_runs WHERE status='playing' AND series_id=? AND started_at<?`).bind(SERIES, now() - STALE_MS).all()).results as any[]
    for (const r of old) {
      for (let i = 0; i < GATES.length; i++) {
        const cur: any = await env.DB.prepare('SELECT gate,status FROM thrill_runs WHERE id=?').bind(r.id).first()
        if (cur.status !== 'playing') break
        await env.DB.prepare(`UPDATE thrill_runs SET armed_at=1, lock_at=1 WHERE id=?`).bind(r.id).run()
        await pick(env, { runId: r.id, userId: r.user_id, optionId: null, gate: cur.gate + 1 }).catch(() => {})
      }
    }
  }

  /** 公开复算：任何人拿到种子都能验证 5 关结果与承诺一致 */
  async function verify(env: Env, rid: string) {
    const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
    if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
    if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, status: r.status, note: '本局未结束，种子保密' }
    const outs: string[] = J(r.outcomes, []), re: string[] = []
    for (let k = 0; k < GATES.length; k++) { const sc = sceneOf(k, re[k - 1]); re.push(sc.options[Math.min(sc.options.length - 1, Math.floor((await seedFloat(r.seed, `gate:${k}`)) * sc.options.length))].id) }
    const commitOk = (await sha256(`${r.seed}|${rid}|${outs.join(',')}`)) === r.commit_hash
    return { run_id: rid, seed: r.seed, commit: r.commit_hash, outcomes: outs, recomputed: re, ok: commitOk && re.join() === outs.join() }
  }

  /** 蒙特卡洛：按真实引擎规则模拟 N 局（玩家随机押），给出实际 RTP / 全中率 / 奖池走势 */
  function simulate(n = 20000, stake = 10) {
    let staked = 0, paid = 0, perfect = 0, pool = CFG.seed_pool, jp = 0
    for (let i = 0; i < n; i++) {
      let s = 0, hits = 0; staked += stake * 5; pool += Math.floor(stake * 5 * CFG.rake)
      for (let k = 0; k < 5; k++) { const a = ARITY[k]; if (Math.floor(Math.random() * a) === Math.floor(Math.random() * a)) { s++; hits++; paid += stake * CFG.ladder[s - 1] } else s = 0 }
      if (hits === 5) { perfect++; const j = Math.min(Math.floor(pool * CFG.jackpot_share), stake * CFG.jackpot_cap_mult); pool -= j; paid += j; jp += j }
    }
    return { runs: n, rtp_total: Math.round((paid / staked) * 1000) / 10, perfect_rate: `1/${Math.round(n / Math.max(1, perfect))}`, jackpot_paid: jp, pool_end: pool, house_edge: Math.round((1 - paid / staked) * 1000) / 10 }
  }

  /** 管理：Jackpot 审核放行 / 作废（作废 = 退回奖池） */
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

  /** 当前进行中的局（刷新页面后恢复：只能继续往下演，不能回看已揭晓的关） */
  async function resume(env: Env, userId: string) {
    const r: any = await env.DB.prepare(`SELECT * FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' LIMIT 1`).bind(userId, SERIES).first()
    if (!r) return null
    const outs: string[] = J(r.outcomes, []), k = r.gate
    const sc = sceneOf(k, k ? outs[k - 1] : undefined)
    return { run_id: r.id, commit: r.commit_hash, stake: r.stake, ladder: J(r.cfg, CFG).ladder, pick_sec: J(r.cfg, CFG).pick_sec, streak: r.streak, hits: r.hits, payout: r.payout,
      gate: await gatePayload(env, userId, r.id, k, sc), lock_at: r.lock_at, server_time: now() }
  }

  return { SERIES, CFG, ARITY, DATA, meta, start, arm, pick, verify, simulate, poolBalance, ensurePool, expireStale, resolveHold, resume, validate: () => validate(DATA) }
}
