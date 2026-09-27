// 增长引擎：抽象剧拉新 → 真人剧变现
// · 全民陪审：每个选项显示“多少人押了它”（真实下注 + 以概率为先验的平滑），少数派押中 → 独行侠奖励
// · 梗图裂变：分享带 ref，被邀请人首次开局 → 双方各得奖励（受 sybil / 每日上限约束）
// · 跨剧导流：结局按“押注人格”推荐真人剧；全链路埋点 → 漏斗看板
import { GameError, post } from '../core/engine'

type Env = { DB: D1Database }
const now = () => Date.now()
export const CONTRA = { share: 0.85, bonus: 0.2, prior: 20 } // 少数派阈值 = 0.85/选项数（3 选≈28%，4 选≈21%），奖励 = 押注额 20%
export const minorOf = (n: number) => Math.round((CONTRA.share / Math.max(2, n)) * 1000) / 1000
export const REF = { reward: 200, perDay: 10 }
export const EVENTS = ['play_start', 'play_end', 'meme_make', 'meme_share', 'ref_join', 'crosssell_view', 'crosssell_click', 'live_start', 'live_end'] as const

/** 某节点各选项的押注人群占比（贝叶斯平滑：先验 20 票按剧情概率分配） */
export async function crowd(env: Env, series: string, nodeId: string, options: { id: string; p: number }[]) {
  const rows = (await env.DB.prepare(`SELECT outcome_id, SUM(votes) v FROM decision_signals WHERE series_id=? AND node_id=? AND source='platform' GROUP BY outcome_id`).bind(series, nodeId).all()).results as any[]
  const votes: Record<string, number> = Object.fromEntries(rows.map((r) => [r.outcome_id, r.v || 0]))
  const real = options.reduce((a, o) => a + (votes[o.id] || 0), 0)
  const tot = real + CONTRA.prior
  return { voters: real, share: Object.fromEntries(options.map((o) => [o.id, Math.round((((votes[o.id] || 0) + CONTRA.prior * o.p) / tot) * 1000) / 1000])) as Record<string, number> }
}

/** 押中少数派：从平台收入发放独行侠奖励（复式记账） */
export async function contrarianBonus(env: Env, p: { series: string; roundId: string; userId: string; nodeId: string; option: string; amount: number; options: { id: string; p: number }[] }) {
  const c = await crowd(env, p.series, p.nodeId, p.options)
  const sh = c.share[p.option] ?? 1
  if (sh >= minorOf(p.options.length)) return { bonus: 0, share: sh }
  const bonus = Math.floor(p.amount * CONTRA.bonus)
  if (bonus <= 0) return { bonus: 0, share: sh }
  await post(env, '独行侠奖励', p.roundId, [['platform:house', 'D', bonus], [`user:${p.userId}:available`, 'C', bonus]])
  await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(bonus, p.userId).run()
  await env.DB.prepare('UPDATE comic_rounds SET contrarian=? WHERE id=?').bind(bonus, p.roundId).run()
  return { bonus, share: sh }
}

export async function track(env: Env, uid: string, event: string, p: { series?: string; src?: string; meta?: any } = {}) {
  if (!(EVENTS as readonly string[]).includes(event)) throw new GameError('BAD_EVENT', '未知事件')
  // 同一用户同一作品同一事件 10 秒内去重（防刷）
  const dup: any = await env.DB.prepare('SELECT id FROM funnel_events WHERE uid=? AND event=? AND COALESCE(series,"")=? AND created_at>?').bind(uid, event, p.series || '', now() - 10000).first()
  if (dup) return { ok: true, dedup: true }
  await env.DB.prepare('INSERT INTO funnel_events (uid,series,event,src,meta,created_at) VALUES (?,?,?,?,?,?)').bind(uid, p.series || null, event, p.src || null, p.meta ? JSON.stringify(p.meta).slice(0, 500) : null, now()).run()
  return { ok: true }
}

/** 邀请绑定：新用户（尚未开过局）首次打开带 ref 的链接；奖励在被邀请人首次开局时发放 */
export async function bindRef(env: Env, uid: string, ref: string, series?: string) {
  if (!ref || ref === uid || !/^u_[a-z0-9]{6,12}$/.test(ref)) return { ok: false, reason: 'invalid' }
  const played: any = await env.DB.prepare('SELECT id FROM comic_runs WHERE user_id=? LIMIT 1').bind(uid).first()
  if (played) return { ok: false, reason: 'not_new' }
  const r = await env.DB.prepare('INSERT OR IGNORE INTO referrals (uid,ref_uid,series,created_at) VALUES (?,?,?,?)').bind(uid, ref, series || null, now()).run()
  if (r.meta.changes) await track(env, uid, 'ref_join', { series, src: 'ref', meta: { ref } })
  return { ok: !!r.meta.changes }
}
/** 被邀请人首次开局 → 双方各得奖励（sybil 设备 / 邀请人超每日上限则不发） */
export async function rewardRef(env: Env, uid: string) {
  const r: any = await env.DB.prepare('SELECT * FROM referrals WHERE uid=? AND rewarded=0').bind(uid).first()
  if (!r) return null
  const cas = await env.DB.prepare('UPDATE referrals SET rewarded=1 WHERE uid=? AND rewarded=0').bind(uid).run()
  if (!cas.meta.changes) return null
  const sy: any = await env.DB.prepare(`SELECT id FROM risk_events WHERE uid=? AND kind='sybil' LIMIT 1`).bind(uid).first().catch(() => null)
  const today: any = await env.DB.prepare('SELECT COUNT(*) n FROM referrals WHERE ref_uid=? AND rewarded=1 AND created_at>?').bind(r.ref_uid, now() - 86400000).first()
  if (sy || (today?.n || 0) > REF.perDay) return { rewarded: false }
  for (const who of [uid, r.ref_uid]) {
    await post(env, '邀请奖励', uid, [['platform:growth', 'D', REF.reward], [`user:${who}:available`, 'C', REF.reward]])
    await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(REF.reward, who).run()
  }
  return { rewarded: true, amount: REF.reward, ref: r.ref_uid }
}

/** 押注人格：由本局押注行为推断，给出真人剧推荐理由 */
export function persona(st: { staked: number; bets: number; hits: number; pnl: number }, contrarian: number, twists: number) {
  if (contrarian > 0) return { id: 'maverick', name: '独行侠', icon: '🦊', desc: '你总和大多数人反着押，还押中了', pick: ['suspense', 'revenge'] }
  if (twists > 0) return { id: 'twist', name: '反转猎人', icon: '🌀', desc: '你总能嗅到隐藏结局', pick: ['suspense', 'action'] }
  if (st.staked >= 600) return { id: 'whale', name: '梭哈玩家', icon: '🐳', desc: '大心脏，下注从不手软', pick: ['action', 'urban'] }
  if (st.bets && st.hits === st.bets) return { id: 'oracle', name: '喵语预言家', icon: '🔮', desc: '每一声喵你都翻译对了', pick: ['suspense', 'romance'] }
  return { id: 'chill', name: '快乐吃瓜人', icon: '🍉', desc: '比起输赢，你更爱看热闹', pick: ['romance', 'urban'] }
}

/** 跨剧导流：按人格题材偏好推荐真人剧（可玩优先） */
export function crossSell(catalog: any[], pick: string[], exclude: string, n = 3) {
  const live = catalog.filter((x) => x.cat === 'live' && x.id !== exclude)
  const score = (x: any) => (x.status === 'live' ? 1000 : 0) + (pick.includes(x.genre) ? 500 - pick.indexOf(x.genre) * 100 : 0) + (x.heat || 0) / 100
  return [...live].sort((a, b) => score(b) - score(a)).slice(0, n).map((x) => ({ id: x.id, title: x.title, sub: x.sub, cover: x.cover, url: x.url, status: x.status, genre: x.genre, endings: x.endings }))
}

/** 漏斗看板：抽象剧 → 梗图 → 分享 → 邀请 → 真人剧点击 → 真人剧开局 */
export async function funnel(env: Env, days = 7) {
  const since = now() - days * 86400000
  const rows = (await env.DB.prepare(`SELECT event, COALESCE(src,'') src, COUNT(DISTINCT uid) u, COUNT(*) n FROM funnel_events WHERE created_at>? GROUP BY event, src`).bind(since).all()).results as any[]
  const U = (ev: string, src?: string) => rows.filter((r) => r.event === ev && (src === undefined || r.src === src)).reduce((a, r) => a + r.u, 0)
  const steps = [
    { id: 'abs_play', name: '抽象剧开局', u: U('play_start', 'abstract') },
    { id: 'abs_end', name: '抽象剧通关', u: U('play_end', 'abstract') },
    { id: 'meme', name: '做梗图', u: U('meme_make') },
    { id: 'share', name: '分享', u: U('meme_share') },
    { id: 'ref', name: '邀请新人进场', u: U('ref_join') },
    { id: 'cs_view', name: '看到真人剧推荐', u: U('crosssell_view', 'abstract') },
    { id: 'cs_click', name: '点击真人剧', u: U('crosssell_click', 'abstract') },
    { id: 'live', name: '真人剧开局', u: U('live_start', 'abstract') }
  ]
  const contra: any = await env.DB.prepare('SELECT COUNT(*) n, COALESCE(SUM(contrarian),0) s FROM comic_rounds WHERE contrarian>0 AND opened_at>?').bind(since).first()
  const refs: any = await env.DB.prepare('SELECT COUNT(*) n, SUM(rewarded) r FROM referrals WHERE created_at>?').bind(since).first()
  const k = steps[0].u ? Math.round((steps[4].u / steps[0].u) * 100) / 100 : 0
  return { days, steps, k_factor: k, contrarian: { rounds: contra.n, paid: contra.s }, referrals: { bound: refs.n || 0, rewarded: refs.r || 0 } }
}
