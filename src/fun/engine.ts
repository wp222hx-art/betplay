// 开心1分钟 · 通用博弈引擎：任何「公开概率事件树」都能直接变成三种押法
// ① 押注单：开局一次押完 3 条腿（每条腿是整局结果的一个函数），按命中条数综合赔付；赔率由整棵树精确枚举的联合概率给出
// ② 快押：每一步开演前 5 秒押这一步的结果，赔率 = rtp / 该结果概率，独立结算
// ③ 押主角：押最终结局，赔率 = rtp / 结局概率
// 整局结果只由种子决定：第 i 步取 u=HMAC(seed,"f:i") 落在哪个累积区间；演出彩蛋 fx=HMAC(seed,"fx:i")
import { randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'
import { FUN_GAMES, Game, Hist } from './games'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const FUN_CFG = { stakes: [10, 20, 50, 100, 200], slip_share: { 1: 0.12, 2: 0.36, 3: 0.45 } as Record<number, number>, slip_min_p3: 0.003, quick_rtp: 0.94, final_rtp: 0.92, max_mult: 1000, pick_sec: 5, max_open_per_ip: 2, stale_ms: 15 * 60000 }

// ─────────── 整棵树枚举 ───────────
type Leaf = { h: Hist; p: number }
const LEAVES = new Map<string, Leaf[]>()
export function leaves(g: Game): Leaf[] {
  if (LEAVES.has(g.sid)) return LEAVES.get(g.sid)!
  const out: Leaf[] = []
  const walk = (h: Hist, p: number) => { const st = g.next(h); if (!st) { out.push({ h, p }); return } for (const o of st.opts) if (o.p > 0) walk([...h, { key: st.key, out: o.id }], p * o.p) }
  walk([], 1); LEAVES.set(g.sid, out); return out
}
export function legMarginals(g: Game) {
  const L = leaves(g)
  return g.legs.map((leg) => ({ id: leg.id, title: leg.title, bins: leg.bins.map((b) => ({ ...b, p: L.filter((l) => leg.of(l.h) === b.id).reduce((a, l) => a + l.p, 0) })) }))
}
export function finalOdds(g: Game) {
  const L = leaves(g)
  return g.final.opts.map((o) => { const p = L.filter((l) => g.final.of(l.h) === o.id).reduce((a, l) => a + l.p, 0); return { ...o, p, odds: p > 0 ? Math.min(FUN_CFG.max_mult, Math.floor((FUN_CFG.final_rtp / p) * 100) / 100) : 0 } })
}
export function quote(g: Game, picks: string[]) {
  if (!Array.isArray(picks) || picks.length !== g.legs.length || picks.some((id, i) => !g.legs[i].bins.find((b) => b.id === id))) throw new GameError('BAD_SLIP', `押注单要 ${g.legs.length} 条各选一档`)
  const P = [0, 0, 0, 0]
  for (const l of leaves(g)) P[g.legs.reduce((a, leg, i) => a + (leg.of(l.h) === picks[i] ? 1 : 0), 0)] += l.p
  const mult: Record<number, number> = { 0: 0 }
  for (const h of [1, 2, 3]) mult[h] = P[h] > 1e-12 ? Math.min(FUN_CFG.max_mult, Math.floor((FUN_CFG.slip_share[h] / P[h]) * 100) / 100) : 0
  return { picks, P, mult, ok: P[3] >= FUN_CFG.slip_min_p3, ev: Math.round((P[1] * mult[1] + P[2] * mult[2] + P[3] * mult[3]) * 1000) / 1000 }
}
const bestSlip = (g: Game) => legMarginals(g).map((l) => [...l.bins].sort((a, b) => b.p - a.p)[0].id)

// ─────────── 一局（只由种子决定） ───────────
export type Played = { step: any; out: string; fx: number; post: { clips: string[]; cap: string } }
export async function play(g: Game, seed: string) {
  const h: Hist = [], steps: Played[] = []
  for (let i = 0; i < 20; i++) {
    const st = g.next(h); if (!st) break
    const u = await seedFloat(seed, `f:${i}`), fx = await seedFloat(seed, `fx:${i}`)
    let acc = 0, out = st.opts[st.opts.length - 1].id
    for (const o of st.opts) { acc += o.p; if (u < acc) { out = o.id; break } }
    h.push({ key: st.key, out })
    steps.push({ step: st, out, fx, post: g.post(h, out, fx) })
  }
  return { h, steps, ending: g.ending(h), final: g.final.of(h), legs: g.legs.map((l) => l.of(h)) }
}
const stepCard = (st: any, i: number) => ({ i, key: st.key, title: st.title, q: st.q, pre: st.pre, cap: st.cap, opts: st.opts.map((o: any) => ({ id: o.id, label: o.label, p: o.p, odds: Math.min(FUN_CFG.max_mult, Math.max(1.01, Math.floor((FUN_CFG.quick_rtp / o.p) * 100) / 100)) })) })

// ─────────── 媒体 ───────────
export async function funMedia(env: any, sid: string, userId?: string) {
  const r: any = await env.DB.prepare(`SELECT data FROM thrill_series WHERE id=?`).bind(sid + '_media').first()
  if (!r) return null
  const clips: Record<string, number> = J(r.data, {}).clips || {}, out: Record<string, { url: string; dur: number }> = {}
  for (const [k, dur] of Object.entries(clips)) out[k] = { url: userId ? await mediaTicket(env, userId, sid, k, 30 * 60000) : '', dur }
  const g = FUN_GAMES[sid]
  return { clips: out, faces: Object.fromEntries(g.cast.map((c) => [c.id, `/gimg/${sid}/${c.id}.webp`])), cover: `/gimg/${sid}/cover.webp` }
}
export async function funSaveMedia(env: Env, sid: string, clips: Record<string, number>) {
  if (!FUN_GAMES[sid]) throw new GameError('NOT_FOUND', '无此剧')
  await env.DB.prepare(`INSERT INTO thrill_series (id,title,logline,tension,cover,data,version,status,created_at,updated_at) VALUES (?,?,'',1,NULL,?,1,'offline',?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, version=thrill_series.version+1, updated_at=excluded.updated_at`).bind(sid + '_media', FUN_GAMES[sid].title + '·媒体清单', JSON.stringify({ clips }), now(), now()).run()
  return { ok: true, clips: Object.keys(clips).length }
}
const gameOf = (sid: string) => { const g = FUN_GAMES[sid]; if (!g) throw new GameError('NOT_FOUND', '无此剧'); return g }

export async function funList(env: any) {
  const out = []
  for (const g of Object.values(FUN_GAMES)) {
    const m: any = await env.DB.prepare(`SELECT 1 FROM thrill_series WHERE id=?`).bind(g.sid + '_media').first()
    const n: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE series_id=?`).bind(g.sid).first()
    out.push({ id: g.sid, title: g.title, tag: g.tag, logline: g.logline, color: g.color, cover: m ? `/gimg/${g.sid}/cover.webp` : null, live: !!m, plays: n?.n || 0, url: '/f/' + g.sid })
  }
  return out
}
export async function funMeta(env: any, sid: string, userId?: string) {
  const g = gameOf(sid)
  const recent = (await env.DB.prepare(`SELECT user_id,hits,mult,payout FROM thrill_runs WHERE series_id=? AND status='ended' ORDER BY ended_at DESC LIMIT 6`).bind(sid).all()).results as any[]
  return { sid, title: g.title, tag: g.tag, logline: g.logline, color: g.color, cast: g.cast, rules: g.rules, cfg: FUN_CFG,
    legs: legMarginals(g), slip_default: quote(g, bestSlip(g)), final: { title: g.final.title, opts: finalOdds(g) },
    recent: recent.map((x) => ({ who: '玩家' + String(x.user_id).slice(-4), hits: x.hits, mult: x.mult, win: x.payout })), media: await funMedia(env, sid, userId),
    open_run: userId ? await (async () => { const o: any = await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE user_id=? AND status='playing' AND series_id LIKE 'fun_%' LIMIT 1`).bind(userId).first(); return o ? { id: o.id, sid: o.series_id } : null })() : null }
}

export async function funStart(env: Env, sid: string, p: { userId: string; stake: number; picks: string[]; final?: string; finalStake?: number; ipHash: string; sybil?: boolean }) {
  const g = gameOf(sid), stake = Math.floor(+p.stake)
  if (!FUN_CFG.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${FUN_CFG.stakes.join(' / ')}`)
  const q = quote(g, p.picks)
  if (!q.ok) throw new GameError('SLIP_IMPOSSIBLE', '这几档几乎不可能同时成立，换个组合')
  const fo = p.final ? finalOdds(g).find((o) => o.id === p.final) : null
  if (p.final && !fo) throw new GameError('BAD_FINAL', '无效的押主角选项')
  const fs = fo ? Math.floor(+(p.finalStake || 0)) : 0
  if (fo && !FUN_CFG.stakes.includes(fs)) throw new GameError('BAD_STAKE', '押主角注金不合法')
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观看')
  if (u.chips < stake + fs) throw new GameError('INSUFFICIENT', `需要 ${stake + fs} Chips`)
  await funExpire(env)
  const mine: any = await env.DB.prepare(`SELECT series_id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - FUN_CFG.stale_ms).first()
  if (mine) throw new GameError('ONE_AT_A_TIME', String(mine.series_id).startsWith('fun_') ? '你还有一局没结束' : '你在另一部剧还有一局没看完（15 分钟后自动结算）')
  const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - FUN_CFG.stale_ms).first()
  if ((ipOpen?.n || 0) >= FUN_CFG.max_open_per_ip) { await riskEvent(env as any, p.userId, 'thrill_multi_open', 2, { series: sid }); throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限') }
  const rid = uid('fn_'), seed = randomHex(32), commit = await sha256(`${seed}|${rid}`)
  await post(env, `开心1分钟·${g.title}·押注单托管`, rid, [[`user:${p.userId}:available`, 'D', stake + fs], [`escrow:fun:${rid}`, 'C', stake + fs]])
  const pl = await play(g, seed)
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake + fs, p.userId),
    env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,?,?,?,?,'[]',?,'playing',0,0,?)`)
      .bind(rid, p.userId, sid, p.ipHash, stake, pl.steps.length, seed, commit, JSON.stringify({ picks: q.picks, slip: { P: q.P, mult: q.mult }, final: fo?.id || null, final_odds: fo?.odds || 0, final_stake: fs, sybil: !!p.sybil }), now())
  ])
  return { run_id: rid, commit, stake, quote: q, final: fo ? { id: fo.id, label: fo.label, odds: fo.odds, stake: fs } : null, intro: g.intro, step: stepCard(pl.steps[0].step, 0), total_hint: pl.steps.length, balance: u.chips - stake - fs }
}

async function load(env: Env, sid: string, rid: string, userId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, sid).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
  return r
}
export async function funArm(env: Env, sid: string, p: { runId: string; userId: string }) {
  const r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  if (r.armed_at) return { lock_at: r.lock_at, server_time: now() }
  const t = now(), lock = t + FUN_CFG.pick_sec * 1000 + 800
  await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(t, lock, r.id).run()
  return { lock_at: lock, server_time: t }
}
export async function funAct(env: Env, sid: string, p: { runId: string; userId: string; i: number; opt?: string | null; bet?: number }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const idx = r.gate
  if (+p.i !== idx) throw new GameError('STALE_ROUND', `当前是第 ${idx + 1} 步`)
  const pl = await play(g, r.seed), cur = pl.steps[idx], card = stepCard(cur.step, idx)
  const late = !r.armed_at || now() > r.lock_at
  const o = p.opt && !late ? card.opts.find((x: any) => x.id === p.opt) : null
  if (p.opt && !late && !o) throw new GameError('BAD_OPT', '无效选项')
  const bet = o ? Math.floor(+(p.bet || 0)) : 0
  if (o && !FUN_CFG.stakes.includes(bet)) throw new GameError('BAD_STAKE', `快押只能是 ${FUN_CFG.stakes.join(' / ')}`)
  if (bet) { const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first(); if ((u?.chips || 0) < bet) throw new GameError('INSUFFICIENT', `快押需要 ${bet} Chips`) }
  const adv = await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, idx).run()
  if (!adv.meta.changes) throw new GameError('DUPLICATE', '已结算')
  const res: any = { i: idx, out: cur.out, out_label: card.opts.find((x: any) => x.id === cur.out)?.label, post: cur.post, side: null }
  if (o) {
    const hit = o.id === cur.out, pay = hit ? Math.floor(bet * o.odds) : 0
    const lines: [string, 'D' | 'C', number][] = [[`user:${r.user_id}:available`, 'D', bet], ['platform:house', 'C', bet]]
    if (pay) lines.push(['platform:house', 'D', pay], [`user:${r.user_id}:available`, 'C', pay])
    await post(env, `开心1分钟·${g.title}·快押${hit ? '命中' : '未中'}`, r.id, lines)
    await env.DB.prepare('UPDATE users SET chips=chips-?+? WHERE id=?').bind(bet, pay, r.user_id).run()
    res.side = { opt: o.id, label: o.label, odds: o.odds, bet, hit, payout: pay }
  }
  await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,stake,picked_at) VALUES (?,?,?,?,?,0,?,?,?,?)`)
    .bind(r.id, idx, o ? o.id : late ? 'timeout' : 'watch', cur.out, res.side?.hit ? 1 : 0, o ? o.odds : 0, res.side?.payout || 0, bet, now()).run()
  if (idx + 1 >= pl.steps.length) Object.assign(res, await finish(env, g, r.id, 'final'))
  else res.next = stepCard(pl.steps[idx + 1].step, idx + 1)
  return res
}

async function finish(env: Env, g: Game, rid: string, reason: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  const u0 = await env.DB.prepare(`UPDATE thrill_runs SET status='ended', end_reason=?, ended_at=? WHERE id=? AND status!='ended'`).bind(reason, now(), rid).run()
  const cfg: any = J(r.cfg, {}), pl = await play(g, r.seed)
  const rows = g.legs.map((leg, i) => ({ id: leg.id, title: leg.title, pick: cfg.picks[i], pick_label: leg.bins.find((b) => b.id === cfg.picks[i])?.label, actual: pl.legs[i], actual_label: leg.bins.find((b) => b.id === pl.legs[i])?.label, hit: pl.legs[i] === cfg.picks[i] }))
  const hits = rows.filter((x) => x.hit).length, mult = cfg.slip.mult[hits] || 0, payout = Math.floor(r.stake * mult)
  const fHit = cfg.final && cfg.final === pl.final, fPay = fHit ? Math.floor(cfg.final_stake * cfg.final_odds) : 0
  if (u0.meta.changes) {
    const lines: [string, 'D' | 'C', number][] = [[`escrow:fun:${rid}`, 'D', r.stake + (cfg.final_stake || 0)]]
    const pay = payout + fPay, held = r.stake + (cfg.final_stake || 0)
    if (pay) lines.push([`user:${r.user_id}:available`, 'C', pay])
    if (pay > held) lines.push(['platform:house', 'D', pay - held]); else if (pay < held) lines.push(['platform:house', 'C', held - pay])
    await post(env, `开心1分钟·${g.title}·押注单中${hits}/3${cfg.final ? (fHit ? '·押主角命中' : '·押主角未中') : ''}`, rid, lines)
    if (pay) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(pay, r.user_id).run()
    await env.DB.prepare(`UPDATE thrill_runs SET hits=?, mult=?, payout=? WHERE id=?`).bind(hits, mult, payout, rid).run()
  }
  const sides: any = (await env.DB.prepare(`SELECT COALESCE(SUM(stake),0) s, COALESCE(SUM(payout),0) p FROM thrill_picks WHERE run_id=?`).bind(rid).first()) || { s: 0, p: 0 }
  const usr: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  const fl = g.final.opts.find((o) => o.id === pl.final)
  return { ended: true, reason, ending: pl.ending, final_actual: { id: pl.final, label: fl?.label }, slip: { rows, hits, mult, payout, stake: r.stake },
    final: cfg.final ? { id: cfg.final, label: g.final.opts.find((o) => o.id === cfg.final)?.label, stake: cfg.final_stake, odds: cfg.final_odds, hit: fHit, payout: fPay } : null,
    side_total: { staked: sides.s, paid: sides.p }, net: payout + fPay - r.stake - (cfg.final_stake || 0) + sides.p - sides.s, balance: usr?.chips, verify: { seed: r.seed, commit: r.commit_hash } }
}
export async function funSkip(env: Env, sid: string, p: { runId: string; userId: string }) {
  const g = gameOf(sid), r = await load(env, sid, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const pl = await play(g, r.seed)
  const u = await env.DB.prepare(`UPDATE thrill_runs SET gate=? WHERE id=? AND gate=? AND status='playing'`).bind(pl.steps.length, r.id, r.gate).run()
  if (!u.meta.changes) throw new GameError('DUPLICATE', '已结算')
  const rest = pl.steps.slice(r.gate).map((s, j) => ({ i: r.gate + j, title: s.step.title, pre: s.step.pre, cap: s.step.cap, out: s.out, out_label: s.step.opts.find((o: any) => o.id === s.out)?.label, post: s.post }))
  return { ...(await finish(env, g, r.id, 'skip')), rest }
}
export async function funExpire(env: Env) {
  const old = (await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE status='playing' AND series_id LIKE 'fun_%' AND started_at<?`).bind(now() - FUN_CFG.stale_ms).all()).results as any[]
  for (const r of old) if (FUN_GAMES[r.series_id]) await finish(env, FUN_GAMES[r.series_id], r.id, 'timeout')
}
export async function funVerify(env: Env, sid: string, rid: string) {
  const g = gameOf(sid), r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=? AND series_id=?').bind(rid, sid).first()
  if (!r) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const pl = await play(g, r.seed)
  return { run_id: rid, seed: r.seed, commit: r.commit_hash, ok: (await sha256(`${r.seed}|${rid}`)) === r.commit_hash, steps: pl.steps.map((s) => ({ key: s.step.key, out: s.out })), final: pl.final, legs: pl.legs }
}
