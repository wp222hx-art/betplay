// Agent-6 · 后台统计与剧本管理师（Forge Console 数据源）
import type { Bindings } from '../gateway/llm'
import { waterLevels } from './builder'

export async function overview(env: Bindings) {
  const q = (sql: string, ...b: any[]) => env.DB.prepare(sql).bind(...b).first<any>()
  const since = Date.now() - 24 * 3600e3
  const [rounds, bets, settle, users, tasks, rewinds, ledger, fallback] = await Promise.all([
    q(`SELECT COUNT(*) n, SUM(CASE WHEN state='BETTING' THEN 1 ELSE 0 END) live FROM rounds`),
    q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) vol, COALESCE(SUM(payout),0) paid, SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) won FROM bets WHERE status IN ('won','lost')`),
    q(`SELECT AVG(settled_at-opened_at) avg_ms FROM rounds WHERE settled_at IS NOT NULL`),
    q(`SELECT COUNT(*) n FROM users WHERE bot=0`),
    q(`SELECT COUNT(*) n, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN status='degraded' THEN 1 ELSE 0 END) degraded, COALESCE(SUM(cost),0) cost, AVG(latency_ms) lat FROM gen_tasks`),
    q(`SELECT COUNT(*) n FROM rounds WHERE rewind_of IS NOT NULL`),
    q(`SELECT COALESCE(SUM(CASE WHEN account='platform:house' THEN (CASE WHEN direction='C' THEN amount ELSE -amount END) END),0) house,
              COALESCE(SUM(CASE WHEN account='platform:rake' THEN amount END),0) rake,
              COALESCE(SUM(CASE WHEN account='platform:rewind_tax' THEN amount END),0) rewind_tax,
              COALESCE(SUM(CASE WHEN account='platform:faucet' THEN amount END),0) faucet FROM ledger`),
    q(`SELECT COUNT(*) n, SUM(CASE WHEN v.is_fallback=1 THEN 1 ELSE 0 END) fb FROM rounds r JOIN variants v ON v.id=r.variant_id WHERE r.settled_at IS NOT NULL`)
  ])
  const unbalanced = await q(`SELECT COUNT(*) n FROM (SELECT tx_id, SUM(CASE WHEN direction='D' THEN amount ELSE -amount END) d FROM ledger GROUP BY tx_id HAVING d!=0)`)
  const hourly = (await env.DB.prepare(`SELECT (opened_at/60000)*60000 t, COUNT(*) n FROM rounds WHERE opened_at>? GROUP BY t ORDER BY t`).bind(since).all()).results
  const queues = (await env.DB.prepare(`SELECT priority, status, COUNT(*) n FROM gen_tasks GROUP BY priority, status`).all()).results
  const agentRuns = (await env.DB.prepare(`SELECT * FROM agent_runs ORDER BY id DESC LIMIT 30`).all()).results
  const alerts: any[] = []
  if (unbalanced.n) alerts.push({ level: 'P0', msg: `资金对账不平 ${unbalanced.n} 笔` })
  if (tasks.n && tasks.failed / tasks.n > 0.2) alerts.push({ level: 'P0', msg: '生成失败率 >20%' })
  const wl = await waterLevels(env)
  wl.filter((w) => w.level === 'red' && w.node_status !== 'dormant').forEach((w) => alerts.push({ level: 'P1', msg: `变体库存告急：${w.label}（${w.pool}/${w.target_variants}）` }))
  return {
    kpi: {
      rounds: rounds.n, live: rounds.live || 0, players: users.n, bets: bets.n, volume: bets.vol, paid: bets.paid,
      win_rate: bets.n ? Math.round((bets.won / bets.n) * 1000) / 10 : 0,
      avg_round_sec: settle.avg_ms ? Math.round(settle.avg_ms / 100) / 10 : 0,
      rewind_rate: rounds.n ? Math.round((rewinds.n / rounds.n) * 1000) / 10 : 0,
      fallback_rate: fallback.n ? Math.round(((fallback.fb || 0) / fallback.n) * 1000) / 10 : 0,
      tasks: tasks.n, task_failed: tasks.failed || 0, task_degraded: tasks.degraded || 0, ai_cost_tokens: Math.round(tasks.cost || 0), avg_task_ms: Math.round(tasks.lat || 0),
      house: ledger.house, rake: ledger.rake, rewind_tax: ledger.rewind_tax, faucet: ledger.faucet, ledger_unbalanced: unbalanced.n
    },
    hourly, queues, alerts, agent_runs: agentRuns
  }
}

export async function branches(env: Bindings, seriesId: string) {
  const rows = (await env.DB.prepare(
    `SELECT n.id node_id, n.question, n.ord, n.status, n.layer, o.id outcome_id, o.label, o.story_weight, o.poem, o.category,
       (SELECT COUNT(*) FROM rounds r WHERE r.outcome_id=o.id AND r.state IN ('SETTLE','NEXT')) reached,
       (SELECT COUNT(*) FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.outcome_id=o.id AND r.node_id=n.id AND b.status IN ('won','lost')) picks,
       (SELECT COALESCE(SUM(b.amount),0) FROM bets b WHERE b.outcome_id=o.id AND b.status IN ('won','lost')) stake
     FROM nodes n JOIN outcomes o ON o.node_id=n.id WHERE n.series_id=? AND n.kind='cash' ORDER BY n.ord, o.id`).bind(seriesId).all()).results as any[]
  const nodes: Record<string, any> = {}
  for (const r of rows) {
    const n = (nodes[r.node_id] ||= { node_id: r.node_id, question: r.question, status: r.status, layer: r.layer, reached: 0, picks: 0, outcomes: [] })
    n.outcomes.push(r); n.reached += r.reached; n.picks += r.picks
  }
  const list = Object.values(nodes).map((n: any) => {
    n.outcomes.forEach((o: any) => {
      o.reach_rate = n.reached ? Math.round((o.reached / n.reached) * 1000) / 10 : 0
      o.pick_rate = n.picks ? Math.round((o.picks / n.picks) * 1000) / 10 : 0
      o.ev_dev = n.reached ? Math.round((o.reached / n.reached - o.story_weight) * 1000) / 10 : 0
    })
    return n
  })
  return { series_id: seriesId, nodes: list, water: await waterLevels(env, seriesId) }
}

export async function scriptTree(env: Bindings, seriesId: string) {
  const series = await env.DB.prepare('SELECT * FROM series WHERE id=?').bind(seriesId).first()
  const nodes = (await env.DB.prepare('SELECT * FROM nodes WHERE series_id=? ORDER BY ord').bind(seriesId).all()).results as any[]
  const outcomes = (await env.DB.prepare(`SELECT o.* FROM outcomes o JOIN nodes n ON n.id=o.node_id WHERE n.series_id=?`).bind(seriesId).all()).results as any[]
  const variants = (await env.DB.prepare(
    `SELECT v.id,v.outcome_id,v.title,v.angle,v.shot,v.is_fallback,v.score,v.status,v.source,v.video_model,v.video_status,v.plays,v.lines FROM variants v
     JOIN outcomes o ON o.id=v.outcome_id JOIN nodes n ON n.id=o.node_id WHERE n.series_id=? ORDER BY v.created_at`).bind(seriesId).all()).results
  const exts = (await env.DB.prepare('SELECT * FROM extensions WHERE series_id=? ORDER BY created_at DESC LIMIT 10').bind(seriesId).all()).results
  return { series, nodes, outcomes, variants, extensions: exts }
}
