// 开心1分钟 · 「三元素组合结局」博弈引擎（阿木系列）
// 一局 = 三个依次揭晓的随机元素 A → B → C（后者的概率受前者影响，规则公开）+ 小概率反转牌
// 押法：① 开局押注单（三个元素各押一个，中 1/2/3 条按精确联合概率赔付）② 片中追加（每个悬念窗口 6 秒，片子不停，越早押赔率越高）③ 押反转
// 防泄露：结果片段的播放票据只在该元素揭晓时才下发；结果只由开局种子决定，开局公布 sha256(seed|rid)，结束可复算
import { randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export type COpt = { id: string; label: string; word: string; clip: string; desc: string }
export type CSlot = { key: 'A' | 'B' | 'C'; title: string; q: string; tease: string; suspense: string; opts: COpt[] }
export type ComboGame = {
  sid: string; title: string; tag: string; logline: string; color: string; hero: string
  cast: { id: string; name: string; role: string }[]
  intro: string; outro: string
  slots: [CSlot, CSlot, CSlot]
  pA: number[]                                   // P(A)
  pB: (a: number) => number[]                    // P(B | A)
  pC: (a: number, b: number) => number[]         // P(C | A, B)
  twist: { p: number; opts: { id: string; label: string; clip: string; p: number }[] }   // 反转牌：总概率 p，内部按 p 分配
  names: string[][]                              // 结局名 [B][C]
  rules: string[]
}

const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0); return a.map((x) => x / s) }

// ───────────────────────── 阿木停车 ─────────────────────────
const PB = [[0.35, 0.2, 0.25, 0.2], [0.25, 0.3, 0.25, 0.2], [0.2, 0.25, 0.2, 0.35], [0.25, 0.2, 0.4, 0.15]]
const PC = [[0.25, 0.4, 0.2, 0.15], [0.45, 0.15, 0.25, 0.15], [0.3, 0.2, 0.2, 0.3], [0.25, 0.2, 0.4, 0.15]]
export const AMU_PARK: ComboGame = {
  sid: 'fun_amu_park', title: '阿木停车', tag: '默剧 · 三元素结局', color: '#ff5a3c', hero: '阿木',
  logline: '商场地下车库只剩一个车位，夹在柱子和豪车中间。阿木开着他的小红车来了——他非常、非常认真。三件事决定结局：怎么停进去、半路杀出什么、最后谁倒霉。',
  cast: [{ id: 'amu', name: '阿木', role: '一本正经的倒霉蛋' }, { id: 'owner', name: '豪车姐', role: '黑色豪车车主' }, { id: 'guard', name: '保安老周', role: '在岗亭打盹' }, { id: 'uncle', name: '热心大爷', role: '扇子不离手' }, { id: 'auntie', name: '遛狗阿姨', role: '带着胖柯基' }],
  intro: 'intro', outro: 'outro',
  slots: [
    { key: 'A', title: '① 怎么弄进去', q: '阿木要怎么把车弄进这个车位？', tease: '他舔了舔手指，试了试风向……', suspense: 'sA', opts: [
      { id: 'rev', label: '硬倒车', word: '倒车王', clip: 'a_rev', desc: '一把梭，后视镜先折了' },
      { id: 'push', label: '下车推', word: '推车侠', clip: 'a_push', desc: '用手、用背、用屁股' },
      { id: 'jack', label: '千斤顶平移', word: '千斤顶', clip: 'a_jack', desc: '像螃蟹一样横着挪' },
      { id: 'guide', label: '大爷指挥', word: '大爷指挥', clip: 'a_guide', desc: '大爷说往哪就往哪' }] },
    { key: 'B', title: '② 半路杀出', q: '阿木刚挤出车门，什么东西冲过来了？', tease: '远处传来一阵奇怪的声响……', suspense: 'sB', opts: [
      { id: 'cart', label: '失控购物车', word: '购物车', clip: 'b_cart', desc: '斗牛士闪避' },
      { id: 'balloon', label: '一串氢气球', word: '气球', clip: 'b_balloon', desc: '脚离地了' },
      { id: 'dog', label: '胖柯基', word: '柯基', clip: 'b_dog', desc: '叼走了公文包' },
      { id: 'scrub', label: '无人洗地机', word: '洗地机', clip: 'b_scrub', desc: '泡沫冲浪' }] },
    { key: 'C', title: '③ 最后谁倒霉', q: '电梯叮了一声——最后倒霉的是谁？', tease: '有脚步声过来了……', suspense: 'sC', opts: [
      { id: 'amu', label: '阿木自己', word: '阿木', clip: 'c_amu', desc: '香蕉皮' },
      { id: 'owner', label: '豪车姐', word: '豪车姐', clip: 'c_owner', desc: '车门只开两厘米' },
      { id: 'guard', label: '保安老周', word: '保安', clip: 'c_guard', desc: '卡在缝里' },
      { id: 'uncle', label: '热心大爷', word: '大爷', clip: 'c_uncle', desc: '倒栽进天窗' }] }
  ],
  pA: [0.35, 0.25, 0.15, 0.25],
  pB: (a) => PB[a],
  pC: (a, b) => norm(PC[b].map((x, i) => (a === 3 && i === 3 ? x * 1.6 : a === 2 && i === 2 ? x * 1.3 : x))),
  twist: { p: 0.08, opts: [{ id: 'tow', label: '这是无障碍车位——拖车来了', clip: 'tw_tow', p: 0.05 }, { id: 'wrong', label: '这根本不是他的车', clip: 'tw_wrong', p: 0.03 }] },
  names: [
    ['购物车滑板少年', '豪车姐被关禁闭', '保安被推着巡逻', '大爷坐车兜风'],
    ['升空的阿木', '气球缠住豪车姐', '升空的保安亭', '大爷放风筝'],
    ['柯基的新主人', '豪车姐的柯基危机', '保安被狗追三圈', '大爷与狗的和解'],
    ['泡沫里的阿木', '豪车姐的泡沫浴', '保安滑行十米', '大爷洗了个澡']
  ],
  rules: [
    '结局由三件事组合：① 怎么弄进去（4 种）② 半路杀出（4 种）③ 最后谁倒霉（4 种），再加 8% 的反转牌，共 70+ 种结局',
    '后一件事的概率受前一件影响，规则公开：大爷指挥 → 柯基出现 40%、大爷自己倒霉概率 ×1.6；千斤顶 → 洗地机 35%、保安倒霉 ×1.3；气球 → 阿木自己倒霉 45%；购物车 → 豪车姐倒霉 40%',
    '每个元素揭晓前有 6 秒追加窗口，片子不停：越早押赔率越高（回报率 95% → 85% 线性下降），每个窗口追加一次，押错不出局',
    '开局押注单：三条各押一个，中 1/2/3 条按精确联合概率赔付（期望回报 93%），三条全中最高 ×100+'
  ]
}
export const COMBO_GAMES: Record<string, ComboGame> = { [AMU_PARK.sid]: AMU_PARK }

export const COMBO_CFG = { stakes: [10, 20, 50, 100, 200], bets: [10, 20, 50, 100], slip_share: { 1: 0.12, 2: 0.36, 3: 0.45 } as Record<number, number>, slip_min_p3: 0.003,
  win_ms: 6500, rtp_hi: 0.95, rtp_lo: 0.85, twist_rtp: 0.92, max_mult: 1000, max_open_per_ip: 2, stale_ms: 15 * 60000 }

// ─────────── 概率 ───────────
/** 全部 64 种 (a,b,c) 组合及其概率 */
export function joint(g: ComboGame) {
  const out: { a: number; b: number; c: number; p: number }[] = []
  g.pA.forEach((pa, a) => g.pB(a).forEach((pb, b) => g.pC(a, b).forEach((pc, c) => out.push({ a, b, c, p: pa * pb * pc }))))
  return out
}
/** 已知前面元素时，第 k 个元素各选项的条件概率 */
export function condProbs(g: ComboGame, k: number, known: number[]) {
  const J = joint(g).filter((x) => known.every((v, i) => [x.a, x.b, x.c][i] === v))
  const tot = J.reduce((s, x) => s + x.p, 0)
  return g.slots[k].opts.map((_, i) => J.filter((x) => [x.a, x.b, x.c][k] === i).reduce((s, x) => s + x.p, 0) / tot)
}
export function marginals(g: ComboGame) { return [0, 1, 2].map((k) => condProbs(g, k, [])) }
const idx = (g: ComboGame, k: number, id: string) => g.slots[k].opts.findIndex((o) => o.id === id)
export function quote(g: ComboGame, picks: string[]) {
  if (!Array.isArray(picks) || picks.length !== 3) throw new GameError('BAD_SLIP', '押注单要三条各选一个')
  const pi = picks.map((id, k) => idx(g, k, id))
  if (pi.some((x) => x < 0)) throw new GameError('BAD_SLIP', '押注单选项无效')
  const P = [0, 0, 0, 0]
  for (const x of joint(g)) P[[x.a, x.b, x.c].reduce((s, v, k) => s + (v === pi[k] ? 1 : 0), 0)] += x.p
  const mult: Record<number, number> = { 0: 0 }
  for (const h of [1, 2, 3]) mult[h] = P[h] > 1e-12 ? Math.min(COMBO_CFG.max_mult, Math.floor((COMBO_CFG.slip_share[h] / P[h]) * 100) / 100) : 0
  return { picks, P, mult, ok: P[3] >= COMBO_CFG.slip_min_p3, ev: Math.round((P[1] * mult[1] + P[2] * mult[2] + P[3] * mult[3]) * 1000) / 1000 }
}
/** 揭晓了前 n 个元素后，押注单最终命中 0..3 条的概率（片中实时显示） */
export function slipLive(g: ComboGame, picks: string[], known: number[]) {
  const pi = picks.map((id, k) => idx(g, k, id))
  const J = joint(g).filter((x) => known.every((v, i) => [x.a, x.b, x.c][i] === v)), tot = J.reduce((s, x) => s + x.p, 0)
  const P = [0, 0, 0, 0]
  for (const x of J) P[[x.a, x.b, x.c].reduce((s, v, k) => s + (v === pi[k] ? 1 : 0), 0)] += x.p / tot
  return P
}
export const twistOdds = (g: ComboGame) => Math.min(COMBO_CFG.max_mult, Math.floor((COMBO_CFG.twist_rtp / g.twist.p) * 100) / 100)
/** 追加窗口内的实时赔率：回报率随时间从 rtp_hi 线性降到 rtp_lo */
export function liveOdds(p: number[], elapsedMs: number) {
  const f = Math.max(0, Math.min(1, elapsedMs / COMBO_CFG.win_ms)), rtp = COMBO_CFG.rtp_hi - (COMBO_CFG.rtp_hi - COMBO_CFG.rtp_lo) * f
  return p.map((x) => (x > 0 ? Math.min(COMBO_CFG.max_mult, Math.max(1.01, Math.floor((rtp / x) * 100) / 100)) : 0))
}

// ─────────── 一局（只由种子决定） ───────────
const pickIdx = (ps: number[], u: number) => { let acc = 0; for (let i = 0; i < ps.length; i++) { acc += ps[i]; if (u < acc) return i } return ps.length - 1 }
export async function play(g: ComboGame, seed: string) {
  const a = pickIdx(g.pA, await seedFloat(seed, 'c:A'))
  const b = pickIdx(g.pB(a), await seedFloat(seed, 'c:B'))
  const c = pickIdx(g.pC(a, b), await seedFloat(seed, 'c:C'))
  const ut = await seedFloat(seed, 'c:T'), ut2 = await seedFloat(seed, 'c:T2')
  const tw = ut < g.twist.p ? g.twist.opts[pickIdx(g.twist.opts.map((o) => o.p / g.twist.p), ut2)] : null
  return { idx: [a, b, c], ids: [g.slots[0].opts[a].id, g.slots[1].opts[b].id, g.slots[2].opts[c].id], twist: tw?.id || null,
    name: g.names[b][c], word: `${g.slots[0].opts[a].word} × ${g.slots[1].opts[b].word} × ${g.slots[2].opts[c].word}` }
}

// ─────────── 媒体 ───────────
async function clipsOf(env: any, sid: string): Promise<Record<string, number>> {
  const r: any = await env.DB.prepare(`SELECT data FROM thrill_series WHERE id=?`).bind(sid + '_media').first()
  return (J(r?.data, {}) || {}).clips || {}
}
async function ticket(env: any, userId: string, sid: string, clips: Record<string, number>, key: string) {
  return clips[key] ? { key, url: await mediaTicket(env, userId, sid, key, 30 * 60000), dur: clips[key] } : null
}
export async function comboSaveMedia(env: Env, sid: string, clips: Record<string, number>) {
  const g = gameOf(sid)
  await env.DB.prepare(`INSERT INTO thrill_series (id,title,logline,tension,cover,data,version,status,created_at,updated_at) VALUES (?,?,'',1,NULL,?,1,'offline',?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, version=thrill_series.version+1, updated_at=excluded.updated_at`).bind(sid + '_media', g.title + '·媒体清单', JSON.stringify({ clips }), now(), now()).run()
  return { ok: true, clips: Object.keys(clips).length }
}
const gameOf = (sid: string) => { const g = COMBO_GAMES[sid]; if (!g) throw new GameError('NOT_FOUND', '无此剧'); return g }

export async function comboList(env: any) {
  const out = []
  for (const g of Object.values(COMBO_GAMES)) {
    const m: any = await env.DB.prepare(`SELECT 1 FROM thrill_series WHERE id=?`).bind(g.sid + '_media').first()
    const n: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE series_id=?`).bind(g.sid).first()
    out.push({ id: g.sid, title: g.title, tag: g.tag, logline: g.logline, color: g.color, cover: m ? `/gimg/${g.sid}/cover.webp` : null, live: !!m, plays: n?.n || 0, url: '/f/' + g.sid, combo: true })
  }
  return out
}

const pub = (g: ComboGame) => ({ sid: g.sid, title: g.title, tag: g.tag, logline: g.logline, color: g.color, hero: g.hero, cast: g.cast, rules: g.rules,
  slots: g.slots.map((s) => ({ key: s.key, title: s.title, q: s.q, tease: s.tease, opts: s.opts.map((o) => ({ id: o.id, label: o.label, word: o.word, desc: o.desc })) })) })

export async function comboMeta(env: any, sid: string, userId?: string) {
  const g = gameOf(sid), clips = await clipsOf(env, sid)
  const recent = (await env.DB.prepare(`SELECT user_id,hits,mult,payout,cfg FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 6`).bind(sid).all()).results as any[]
  const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' LIMIT 1`).bind(userId, sid).first() : null
  const media = Object.keys(clips).length ? {
    // 只预发「不泄露结果」的片段：开场 + 三个悬念片段；结果片段在揭晓时才发票据
    pre: userId ? Object.fromEntries(await Promise.all(['intro', ...g.slots.map((s) => s.suspense)].map(async (k) => [k, await ticket(env, userId, sid, clips, k)]))) : null,
    dur: Object.fromEntries(Object.entries(clips).map(([k, v]) => [k, v])),
    faces: Object.fromEntries(g.cast.map((c) => [c.id, `/gimg/${sid}/${c.id}.webp`])), cover: `/gimg/${sid}/cover.webp`
  } : null
  const best = marginals(g).map((p, k) => g.slots[k].opts[p.indexOf(Math.max(...p))].id)
  return { ...pub(g), cfg: COMBO_CFG, marg: marginals(g), slip_default: quote(g, best), twist: { p: g.twist.p, odds: twistOdds(g), opts: g.twist.opts.map((o) => ({ id: o.id, label: o.label })) },
    recent: recent.map((x) => { const c = J(x.cfg, {}); return { who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, mult: x.mult, win: x.payout, name: c.name || '' } }),
    media, open_run: open?.id || null }
}

// ─────────── 开局 ───────────
export async function comboStart(env: Env, sid: string, p: { userId: string; stake: number; picks: string[]; twist?: boolean; twistStake?: number; ipHash: string; sybil?: boolean }) {
  const g = gameOf(sid), stake = Math.floor(+p.stake)
  if (!COMBO_CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${COMBO_CFG.stakes.join(' / ')}`)
  const q = quote(g, p.picks)
  if (!q.ok) throw new GameError('SLIP_IMPOSSIBLE', '这个组合几乎不可能出现，换一个')
  const ts = p.twist ? Math.floor(+(p.twistStake || 0)) : 0
  if (p.twist && !COMBO_CFG.bets.includes(ts)) throw new GameError('BAD_STAKE', '押反转注金不合法')
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观看')
  if (u.chips < stake + ts) throw new GameError('INSUFFICIENT', `需要 ${stake + ts} Chips`)
  await comboExpire(env)
  const mine: any = await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - COMBO_CFG.stale_ms).first()
  if (mine) {
    if (mine.series_id !== sid) throw new GameError('ONE_AT_A_TIME', '你在另一部剧还有一局没看完（15 分钟后自动结算）')
    await comboSkip(env, sid, { runId: mine.id, userId: p.userId }).catch(() => {})   // 本剧的旧局：直接按种子结算掉
  }
  const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - COMBO_CFG.stale_ms).first()
  if ((ipOpen?.n || 0) >= COMBO_CFG.max_open_per_ip) { await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { series: sid }); throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限') }
  const rid = uid('cb_'), seed = randomHex(32), commit = await sha256(`${seed}|${rid}`)
  await post(env, `开心1分钟·${g.title}·押注单托管`, rid, [[`user:${p.userId}:available`, 'D', stake + ts], [`escrow:combo:${rid}`, 'C', stake + ts]])
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake + ts, p.userId),
    env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,?,3,?,?,'[]',?,'playing',0,0,?)`)
      .bind(rid, p.userId, sid, p.ipHash, stake, seed, commit, JSON.stringify({ picks: q.picks, slip: { P: q.P, mult: q.mult }, twist: !!p.twist, twist_stake: ts, twist_odds: p.twist ? twistOdds(g) : 0, sybil: !!p.sybil }), now())
  ])
  return { run_id: rid, commit, stake, quote: q, twist: p.twist ? { stake: ts, odds: twistOdds(g) } : null, live: slipLive(g, q.picks, []), next: condProbs(g, 0, []), balance: u.chips - stake - ts }
}

async function load(env: Env, sid: string, rid: string, userId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, sid).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
  return r
}
const knownOf = async (g: ComboGame, seed: string, n: number) => (await play(g, seed)).idx.slice(0, n)

/** 打开第 k 个追加窗口（悬念片段开播时调用）：服务器计时，6.5 秒后锁定 */
export async function comboArm(env: Env, sid: string, p: { runId: string; userId: string; k: number }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  if (+p.k !== r.gate) throw new GameError('STALE_ROUND', `当前是第 ${r.gate + 1} 个悬念`)
  let armed = r.armed_at, lock = r.lock_at
  if (!armed) { armed = now(); lock = armed + COMBO_CFG.win_ms; await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(armed, lock, r.id).run() }
  const P = condProbs(g, r.gate, await knownOf(g, r.seed, r.gate))
  return { k: r.gate, armed_at: armed, lock_at: lock, server_time: now(), probs: P, odds_now: liveOdds(P, now() - armed), win_ms: COMBO_CFG.win_ms, rtp: [COMBO_CFG.rtp_hi, COMBO_CFG.rtp_lo] }
}

/** 在窗口内追加一注：赔率按服务器收到的时刻计算 */
export async function comboBet(env: Env, sid: string, p: { runId: string; userId: string; k: number; opt: string; bet: number }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  if (+p.k !== r.gate) throw new GameError('STALE_ROUND', '这个悬念已经揭晓了')
  if (!r.armed_at || now() > r.lock_at) throw new GameError('WINDOW_CLOSED', '追加窗口已关闭')
  const oi = idx(g, r.gate, p.opt); if (oi < 0) throw new GameError('BAD_OPT', '无效选项')
  const bet = Math.floor(+p.bet); if (!COMBO_CFG.bets.includes(bet)) throw new GameError('BAD_STAKE', `追加只能是 ${COMBO_CFG.bets.join(' / ')}`)
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  if ((u?.chips || 0) < bet) throw new GameError('INSUFFICIENT', `追加需要 ${bet} Chips`)
  const pl = await play(g, r.seed), P = condProbs(g, r.gate, pl.idx.slice(0, r.gate)), odds = liveOdds(P, now() - r.armed_at)[oi]
  const ins = await env.DB.prepare(`INSERT OR IGNORE INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,stake,picked_at) VALUES (?,?,?,?,0,0,?,0,?,?)`)
    .bind(r.id, r.gate, p.opt, pl.ids[r.gate], odds, bet, now()).run()
  if (!ins.meta.changes) throw new GameError('DUPLICATE', '这个悬念已经追加过了')
  await post(env, `开心1分钟·${g.title}·追加${g.slots[r.gate].key}`, r.id, [[`user:${r.user_id}:available`, 'D', bet], [`escrow:combo:${r.id}`, 'C', bet]])
  await env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(bet, r.user_id).run()
  return { k: r.gate, opt: p.opt, label: g.slots[r.gate].opts[oi].label, odds, bet, balance: (u?.chips || 0) - bet }
}

/** 揭晓第 k 个元素（窗口锁定后）：返回结果、结果片段票据、下一窗口的条件概率；第 3 个揭晓后直接结算 */
export async function comboReveal(env: Env, sid: string, p: { runId: string; userId: string; k: number }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const k = r.gate
  if (+p.k !== k) throw new GameError('STALE_ROUND', '这个悬念已经揭晓了')
  if (r.armed_at && now() < r.lock_at - 600) throw new GameError('WINDOW_OPEN', '窗口还没关')
  const adv = await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, k).run()
  if (!adv.meta.changes) throw new GameError('DUPLICATE', '已揭晓')
  const pl = await play(g, r.seed), oi = pl.idx[k], opt = g.slots[k].opts[oi], clips = await clipsOf(env, sid)
  const side = await settleSide(env, g, r, k, opt.id)
  const cfg = J(r.cfg, {})
  const res: any = { k, out: opt.id, label: opt.label, word: opt.word, clip: await ticket(env, r.user_id, sid, clips, opt.clip), side, hit: cfg.picks[k] === opt.id, live: slipLive(g, cfg.picks, pl.idx.slice(0, k + 1)) }
  if (k < 2) res.next = condProbs(g, k + 1, pl.idx.slice(0, k + 1))
  else Object.assign(res, await finish(env, g, r.id, 'final'))
  return res
}

async function settleSide(env: Env, g: ComboGame, r: any, k: number, out: string) {
  const pk: any = await env.DB.prepare('SELECT * FROM thrill_picks WHERE run_id=? AND gate=?').bind(r.id, k).first()
  if (!pk || !pk.stake) return null
  const o = g.slots[k].opts.find((x) => x.id === pk.option_id)
  if (pk.streak) return { opt: pk.option_id, label: o?.label, odds: pk.mult, bet: pk.stake, hit: !!pk.hit, payout: pk.payout }   // 已结算
  const claim = await env.DB.prepare('UPDATE thrill_picks SET streak=1 WHERE run_id=? AND gate=? AND streak=0').bind(r.id, k).run()
  if (!claim.meta.changes) return null
  const hit = pk.option_id === out, pay = hit ? Math.floor(pk.stake * pk.mult) : 0
  const lines: [string, 'D' | 'C', number][] = [[`escrow:combo:${r.id}`, 'D', pk.stake]]
  if (pay) lines.push([`user:${r.user_id}:available`, 'C', pay])
  if (pay > pk.stake) lines.push(['platform:house', 'D', pay - pk.stake]); else if (pay < pk.stake) lines.push(['platform:house', 'C', pk.stake - pay])
  await post(env, `开心1分钟·${g.title}·追加${g.slots[k].key}${hit ? '命中' : '未中'}`, r.id, lines)
  if (pay) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(pay, r.user_id).run()
  await env.DB.prepare('UPDATE thrill_picks SET hit=?, payout=? WHERE run_id=? AND gate=?').bind(hit ? 1 : 0, pay, r.id, k).run()
  return { opt: pk.option_id, label: o?.label, odds: pk.mult, bet: pk.stake, hit, payout: pay }
}

async function finish(env: Env, g: ComboGame, rid: string, reason: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  const u0 = await env.DB.prepare(`UPDATE thrill_runs SET status='ended', end_reason=?, ended_at=? WHERE id=? AND status!='ended'`).bind(reason, now(), rid).run()
  const cfg: any = J(r.cfg, {}), pl = await play(g, r.seed), clips = await clipsOf(env, g.sid)
  const rows = g.slots.map((s, k) => ({ key: s.key, title: s.title, pick: cfg.picks[k], pick_label: s.opts.find((o) => o.id === cfg.picks[k])?.label, actual: pl.ids[k], actual_label: s.opts[pl.idx[k]].label, hit: pl.ids[k] === cfg.picks[k] }))
  const hits = rows.filter((x) => x.hit).length, mult = cfg.slip.mult[hits] || 0, payout = Math.floor(r.stake * mult)
  const tw = pl.twist ? g.twist.opts.find((o) => o.id === pl.twist)! : null
  const tHit = !!(cfg.twist && tw), tPay = tHit ? Math.floor(cfg.twist_stake * cfg.twist_odds) : 0
  if (u0.meta.changes) {
    const held = r.stake + (cfg.twist_stake || 0), pay = payout + tPay
    const lines: [string, 'D' | 'C', number][] = [[`escrow:combo:${rid}`, 'D', held]]
    if (pay) lines.push([`user:${r.user_id}:available`, 'C', pay])
    if (pay > held) lines.push(['platform:house', 'D', pay - held]); else if (pay < held) lines.push(['platform:house', 'C', held - pay])
    await post(env, `开心1分钟·${g.title}·押注单中${hits}/3${cfg.twist ? (tHit ? '·反转命中' : '·反转未中') : ''}`, rid, lines)
    if (pay) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(pay, r.user_id).run()
    // 未揭晓就被结算的追加（超时 / 快进）：逐个结算
    const open = (await env.DB.prepare('SELECT gate FROM thrill_picks WHERE run_id=? AND streak=0 AND stake>0').bind(rid).all()).results as any[]
    for (const o of open) await settleSide(env, g, r, o.gate, pl.ids[o.gate])
    cfg.name = tw ? tw.label : pl.name
    await env.DB.prepare(`UPDATE thrill_runs SET gate=3, hits=?, mult=?, payout=?, cfg=? WHERE id=?`).bind(hits, mult, payout, JSON.stringify(cfg), rid).run()
  }
  const sides: any = (await env.DB.prepare(`SELECT COALESCE(SUM(stake),0) s, COALESCE(SUM(payout),0) p FROM thrill_picks WHERE run_id=?`).bind(rid).first()) || { s: 0, p: 0 }
  const usr: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  const end = await ticket(env, r.user_id, g.sid, clips, tw ? tw.clip : g.outro)
  return { ended: true, reason, ending: { name: tw ? tw.label : pl.name, word: pl.word, twist: tw ? { id: tw.id, label: tw.label } : null, clip: end },
    slip: { rows, hits, mult, payout, stake: r.stake }, twist_bet: cfg.twist ? { stake: cfg.twist_stake, odds: cfg.twist_odds, hit: tHit, payout: tPay } : null,
    side_total: { staked: sides.s, paid: sides.p },
    net: payout + tPay + sides.p - r.stake - (cfg.twist_stake || 0) - sides.s, balance: usr?.chips || 0,
    verify: { seed: r.seed, commit: r.commit_hash, run_id: rid, recipe: 'A=HMAC(seed,"c:A") B=HMAC(seed,"c:B") C=HMAC(seed,"c:C") 反转=HMAC(seed,"c:T")，各自落在公开条件概率的累积区间' } }
}

export async function comboSkip(env: Env, sid: string, p: { runId: string; userId: string }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const pl = await play(g, r.seed), clips = await clipsOf(env, sid)
  const rest = []
  for (let k = r.gate; k < 3; k++) { const o = g.slots[k].opts[pl.idx[k]]; rest.push({ k, out: o.id, label: o.label, word: o.word, side: await settleSide(env, g, r, k, o.id), clip: await ticket(env, r.user_id, sid, clips, o.clip) }) }
  return { rest, ...(await finish(env, g, r.id, 'skip')) }
}
export async function comboExpire(env: Env) {
  const old = (await env.DB.prepare(`SELECT id, series_id, user_id FROM thrill_runs WHERE status='playing' AND series_id LIKE 'fun_amu%' AND started_at<?`).bind(now() - COMBO_CFG.stale_ms).all()).results as any[]
  for (const r of old) if (COMBO_GAMES[r.series_id]) await comboSkip(env, r.series_id, { runId: r.id, userId: r.user_id }).catch(() => {})
}
export async function comboVerify(env: Env, sid: string, rid: string) {
  const g = gameOf(sid), r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, sid).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const pl = await play(g, r.seed)
  return { run_id: rid, seed: r.seed, commit: r.commit_hash, commit_ok: (await sha256(`${r.seed}|${rid}`)) === r.commit_hash, result: pl, probs: { A: g.pA, B_given_A: g.slots[0].opts.map((_, a) => g.pB(a)), twist: g.twist.p } }
}
