// 命运等级（Fate Tier）：结局不只是“哪一个”，还取决于你“押了多少、赢了多少”
// · 全部由服务端账本数据判定（本局真实押注额、命中数、净盈利），客户端无法伪造
// · 黄金 / 白金 / 钻石：解锁对应彩蛋片段（专属高光）、奖池分红、结局卡升阶（稀有度 +1/+2/+3）
// · 奖池：每笔下注抽 2% + 悔棋税 30% 注入“命运奖池”；分红按奖池比例派发，奖池不够就少发 → 平台永不超发
import { GameError, post } from '../core/engine'

type Env = { DB: D1Database }
export const TIERS = [
  { id: 'diamond', name: '钻石结局', color: '#7dd3fc', icon: '💎', need: { staked: 1500, hits: 2, pnl: 800, perfect: true }, pool: 0.12, cap: 3000, rarity: 3 },
  { id: 'platinum', name: '白金结局', color: '#e5e7eb', icon: '🏆', need: { staked: 600, hits: 2, pnl: 200, perfect: false }, pool: 0.05, cap: 1200, rarity: 2 },
  { id: 'gold', name: '黄金结局', color: '#fbbf24', icon: '👑', need: { staked: 200, hits: 1, pnl: 0, perfect: false }, pool: 0.02, cap: 400, rarity: 1 }
] as const
export const POOL_SHARE = { bet: 0.02, rewind: 0.3 }
const POOL = (series: string) => `pool:fate:${series}`

export async function poolBalance(env: Env, series: string) {
  const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL(series)).first()
  return r?.b || 0
}
/** 注资：从平台收入（house / rewind_tax）划入奖池，复式记账 */
export async function feedPool(env: Env, series: string, amount: number, from: 'platform:house' | 'platform:rewind_tax', ref: string) {
  const a = Math.floor(amount); if (a <= 0) return
  await post(env, '命运奖池注资', ref, [[from, 'D', a], [POOL(series), 'C', a]])
}

/** 本局统计：押注总额 / 命中次数 / 下注次数 / 净盈亏（不含悔棋税） */
export async function runStats(env: Env, runId: string) {
  const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(bet_amount),0) staked, SUM(CASE WHEN bet_option IS NOT NULL THEN 1 ELSE 0 END) bets,
    SUM(CASE WHEN bet_option IS NOT NULL AND bet_option=outcome_id THEN 1 ELSE 0 END) hits, COALESCE(SUM(payout - bet_amount),0) pnl
    FROM comic_rounds WHERE run_id=? AND state IN ('NEXT','SETTLE')`).bind(runId).first()
  return { staked: r.staked || 0, bets: r.bets || 0, hits: r.hits || 0, pnl: r.pnl || 0 }
}

export function tierOf(st: { staked: number; bets: number; hits: number; pnl: number }, depth: number) {
  for (const t of TIERS) {
    const n = t.need
    if (st.staked >= n.staked && st.hits >= n.hits && st.pnl >= n.pnl && (!n.perfect || (st.bets >= depth && st.hits === st.bets))) return t
  }
  return null
}
/** 下一档还差什么（给玩家的“差一点”提示，拉动加注） */
export function nextGoal(st: { staked: number; bets: number; hits: number; pnl: number }, current: string | null) {
  const idx = current ? TIERS.findIndex((t) => t.id === current) : TIERS.length
  const t = TIERS[idx - 1]; if (!t) return null
  const miss: string[] = []
  if (st.staked < t.need.staked) miss.push(`押注再多 ${t.need.staked - st.staked}`)
  if (st.hits < t.need.hits) miss.push(`再押中 ${t.need.hits - st.hits} 次`)
  if (st.pnl < t.need.pnl) miss.push(`净赢再多 ${t.need.pnl - st.pnl}`)
  if (t.need.perfect) miss.push('每一幕都押且全中')
  return { id: t.id, name: t.name, icon: t.icon, miss }
}

/** 通关结算：判定等级 → 奖池分红（不超发）→ 写入 run */
export async function settleTier(env: Env, p: { series: string; runId: string; userId: string; depth: number }) {
  const st = await runStats(env, p.runId)
  const t = tierOf(st, p.depth)
  let bonus = 0
  if (t) {
    const pool = await poolBalance(env, p.series)
    bonus = Math.min(t.cap, Math.floor(pool * t.pool))
    if (bonus > 0) {
      await post(env, `${t.name}分红`, p.runId, [[POOL(p.series), 'D', bonus], [`user:${p.userId}:available`, 'C', bonus]])
      await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(bonus, p.userId).run()
    }
  }
  await env.DB.prepare('UPDATE comic_runs SET staked=?, tier=?, bonus=? WHERE id=?').bind(st.staked, t?.id || null, bonus, p.runId).run()
  return { tier: t ? { id: t.id, name: t.name, icon: t.icon, color: t.color, rarity: t.rarity } : null, bonus, stats: st, next: nextGoal(st, t?.id || null) }
}

export async function tierBoard(env: Env, series: string) {
  const rows = (await env.DB.prepare(`SELECT tier, COUNT(*) n, COALESCE(SUM(bonus),0) b FROM comic_runs WHERE series_id=? AND status='ended' GROUP BY tier`).bind(series).all()).results as any[]
  const total = rows.reduce((a, r) => a + r.n, 0) || 1
  return { pool: await poolBalance(env, series), tiers: TIERS.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, need: t.need, pool_pct: t.pool, cap: t.cap, count: rows.find((r) => r.tier === t.id)?.n || 0, rate: Math.round(((rows.find((r) => r.tier === t.id)?.n || 0) / total) * 1000) / 10, paid: rows.find((r) => r.tier === t.id)?.b || 0 })), runs: total }
}
