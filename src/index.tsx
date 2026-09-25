import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AGENTS, BLUEPRINT } from './agents/registry'
import { ensureSeed, DEMO_SERIES } from './core/seed'
import { cancelBet, claimFaucet, ensureUser, GameError, J, lockRevealSettle, monteCarlo, openRound, placeBet, rewind, verifyRound } from './core/engine'
import { generateVariants, replenish, waterLevels } from './agents/builder'
import { runSelfTest } from './agents/qa'
import { modelHealth, predictiveQueue, rankVideoModels, submitVideo, buildVideoPrompt } from './gateway/video'
import { branches, overview, scriptTree } from './agents/console'
import { applyClipPlan, approveExtension, clipPairs, derive, generatePoems, ingestSignals, regulate } from './agents/deriver'
import type { Bindings } from './gateway/llm'
import { playerPage, consolePage, agentsPage, comicPage } from './pages/shell'
import * as Comic from './comic/engine'

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// 首次访问自动播种（Agent-1 蓝图）
let seeded = false
app.use('/api/*', async (c, next) => {
  if (!seeded) { await ensureSeed(c.env); seeded = true }
  await next()
})

app.onError((err, c) => {
  if (err instanceof GameError) return c.json({ error: err.code, message: err.message }, 400)
  console.error(err)
  return c.json({ error: 'INTERNAL', message: String(err.message || err) }, 500)
})

const body = async (c: any) => { try { return await c.req.json() } catch { return {} } }
const uidOf = (c: any, b: any = {}) => String(b.user_id || c.req.header('x-user-id') || c.req.query('user_id') || '').slice(0, 40)

// ─────────────── 页面 ───────────────
app.get('/', (c) => c.html(playerPage()))
app.get('/play/:series', (c) => c.html(playerPage()))
app.get('/console', (c) => c.html(consolePage()))
app.get('/agents', (c) => c.html(agentsPage()))
app.get('/comic', (c) => c.html(comicPage()))

// ─────────────── Agent-1 · 蓝图 ───────────────
app.get('/api/blueprint', (c) => c.json({ ...BLUEPRINT, agents: AGENTS }))
app.get('/api/agents', async (c) => {
  const runs = (await c.env.DB.prepare('SELECT agent_no, COUNT(*) n, MAX(created_at) last FROM agent_runs GROUP BY agent_no').all()).results as any[]
  return c.json(AGENTS.map((a) => ({ ...a, runs: runs.find((r) => r.agent_no === a.no)?.n || 0, last_run: runs.find((r) => r.agent_no === a.no)?.last || null })))
})
app.get('/api/agents/runs', async (c) => c.json((await c.env.DB.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT 80').all()).results))

// ─────────────── 玩家端数据 ───────────────
app.get('/api/series', async (c) => c.json((await c.env.DB.prepare(`SELECT id,title,logline,poem,status FROM series WHERE status='live'`).all()).results))
app.get('/api/series/:id', async (c) => {
  const id = c.req.param('id')
  const s: any = await c.env.DB.prepare('SELECT id,title,logline,poem,world_bible FROM series WHERE id=?').bind(id).first()
  if (!s) return c.json({ error: 'NOT_FOUND' }, 404)
  const nodes = ((await c.env.DB.prepare(`SELECT id,kind,ord,title,question,lines,layer FROM nodes WHERE series_id=? AND status='active' ORDER BY ord`).bind(id).all()).results as any[])
    .map((n) => ({ ...n, lines: J(n.lines, null) }))
  const dist = (await c.env.DB.prepare(
    `SELECT o.node_id, o.id, o.label, o.story_weight, o.poem, (SELECT COUNT(*) FROM rounds r WHERE r.outcome_id=o.id AND r.state IN ('SETTLE','NEXT')) hits FROM outcomes o JOIN nodes n ON n.id=o.node_id WHERE n.series_id=?`).bind(id).all()).results
  return c.json({ ...s, world_bible: J(s.world_bible, {}), nodes, distribution: dist })
})
app.get('/api/me', async (c) => {
  const id = uidOf(c); if (!id) return c.json({ error: 'NO_USER' }, 400)
  const u: any = await ensureUser(c.env, id, c.req.query('nick') || undefined)
  const stats: any = await c.env.DB.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) w, COALESCE(SUM(payout-amount),0) pnl FROM bets WHERE user_id=? AND status IN ('won','lost')`).bind(id).first()
  const endings = (await c.env.DB.prepare(`SELECT DISTINCT v.outcome_id FROM branch_registry b JOIN variants v ON v.id=b.variant_id WHERE b.user_id=?`).bind(id).all()).results.map((x: any) => x.outcome_id)
  return c.json({ ...u, stats, collected_outcomes: endings })
})
app.post('/api/me/faucet', async (c) => { const b = await body(c); return c.json(await claimFaucet(c.env, uidOf(c, b))) })
app.post('/api/me/limits', async (c) => {
  const b = await body(c); const id = uidOf(c, b)
  if (b.daily_limit) await c.env.DB.prepare('UPDATE users SET daily_limit=? WHERE id=?').bind(Math.max(100, Math.min(100000, b.daily_limit | 0)), id).run()
  if (b.cooloff_minutes) await c.env.DB.prepare('UPDATE users SET cooloff_until=? WHERE id=?').bind(new Date(Date.now() + b.cooloff_minutes * 60000).toISOString(), id).run()
  if (b.self_exclude) await c.env.DB.prepare('UPDATE users SET self_excluded=1 WHERE id=?').bind(id).run()
  return c.json(await ensureUser(c.env, id))
})

// ─────────────── Agent-4 · 下注结算（WF-03/04/07） ───────────────
app.post('/api/rounds/open', async (c) => {
  const b = await body(c)
  return c.json(await openRound(c.env, { userId: uidOf(c, b), nodeId: b.node_id, mode: b.mode === 'arena' ? 'arena' : 'solo' }))
})
app.post('/api/rounds/:id/bet', async (c) => {
  const b = await body(c)
  return c.json(await placeBet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), outcomeId: b.outcome_id, amount: b.amount, idemKey: b.idem_key || crypto.randomUUID() }))
})
app.post('/api/rounds/:id/cancel', async (c) => { const b = await body(c); return c.json(await cancelBet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/rounds/:id/settle', async (c) => { const b = await body(c); return c.json(await lockRevealSettle(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/rounds/:id/rewind', async (c) => { const b = await body(c); return c.json(await rewind(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.get('/api/rounds/:id/verify', async (c) => c.json(await verifyRound(c.env, c.req.param('id'))))
app.get('/api/rounds/:id/live', async (c) => {
  // Arena 实时彩池热度（模拟人群持续入注）
  const r: any = await c.env.DB.prepare('SELECT crowd, mode, state, node_id FROM rounds WHERE id=?').bind(c.req.param('id')).first()
  if (!r || r.mode !== 'arena' || r.state !== 'BETTING') return c.json({ crowd: J(r?.crowd, null) })
  const crowd = J(r.crowd, {})
  for (const k in crowd) crowd[k] += Math.floor(Math.random() * 40)
  await c.env.DB.prepare('UPDATE rounds SET crowd=? WHERE id=?').bind(JSON.stringify(crowd), c.req.param('id')).run()
  const pool = Object.values<number>(crowd).reduce((a, b) => a + b, 0)
  const odds: any = {}; for (const k in crowd) odds[k] = Math.max(1.01, Math.floor(((pool * 0.92) / crowd[k]) * 100) / 100)
  // 注意：赔率变化写回 odds 快照，下注以提交时赔率为准，结算以 LOCK 后彩池为准
  await c.env.DB.prepare('UPDATE rounds SET odds=? WHERE id=?').bind(JSON.stringify(odds), c.req.param('id')).run()
  return c.json({ crowd, odds, pool })
})
app.post('/api/agents/4/simulate', async (c) => {
  const b = await body(c)
  const w = (b.weights || [0.45, 0.4, 0.15]).map(Number)
  const r = monteCarlo(w, Number(b.rake ?? 0.08), { n: b.n || 20000, rewindTax: b.rewind_tax, rewindMax: b.rewind_max, minBet: b.min_bet, stake: b.stake })
  await c.env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (4,?,?,?,?)').bind('ev_simulate', r.arbitrage_risk ? 'fail' : 'ok', `权重 ${w.join('/')} rake ${b.rake ?? 0.08} → ${r.arbitrage_risk ? '存在套利' : '无套利'}，赔率 ${r.odds.join('/')}`, Date.now()).run()
  return c.json(r)
})

// ─────────────── Agent-2 · 变体生产 ───────────────
app.post('/api/agents/2/generate-variants', async (c) => { const b = await body(c); return c.json(await generateVariants(c.env, b.outcome_id, Math.min(4, b.count || 2))) })
app.post('/api/agents/2/replenish', async (c) => { const b = await body(c); return c.json(await replenish(c.env, b.series_id || DEMO_SERIES, b.max || 2)) })
app.get('/api/agents/2/water', async (c) => c.json(await waterLevels(c.env, c.req.query('series_id') || DEMO_SERIES)))

// ─────────────── Agent-3 · 测试 & 视频模型 ───────────────
app.post('/api/agents/3/selftest', async (c) => c.json(await runSelfTest(c.env)))
app.get('/api/agents/3/reports', async (c) => c.json((await c.env.DB.prepare('SELECT * FROM test_reports ORDER BY id DESC LIMIT 10').all()).results))
app.get('/api/agents/3/video-models', async (c) => c.json({ tier: c.req.query('tier') || 'standard', has_provider_key: !!c.env.FAL_KEY, ranking: rankVideoModels((c.req.query('tier') || 'standard') as any, Number(c.req.query('duration') || 6), await modelHealth(c.env)) }))
app.post('/api/agents/3/predictive', async (c) => { const b = await body(c); return c.json(await predictiveQueue(c.env, b.series_id || DEMO_SERIES, { tier: b.tier, limit: b.limit, dryRun: !!b.dry_run })) })
app.post('/api/agents/3/video', async (c) => {
  const b = await body(c)
  const v: any = await c.env.DB.prepare('SELECT v.*, o.label FROM variants v JOIN outcomes o ON o.id=v.outcome_id WHERE v.id=?').bind(b.variant_id).first()
  if (!v) return c.json({ error: 'NOT_FOUND' }, 404)
  const model = b.model || rankVideoModels(b.tier || 'standard').find((m) => m.id !== 'motion-still')!.id
  return c.json(await submitVideo(c.env, v.id, model, buildVideoPrompt(v, v.label, {}), b.priority || 'P2'))
})

// ─────────────── Agent-6 · Console ───────────────
app.get('/api/console/overview', async (c) => c.json(await overview(c.env)))
app.get('/api/console/branches', async (c) => c.json(await branches(c.env, c.req.query('series_id') || DEMO_SERIES)))
app.get('/api/console/script', async (c) => c.json(await scriptTree(c.env, c.req.query('series_id') || DEMO_SERIES)))
app.get('/api/console/tasks', async (c) => c.json((await c.env.DB.prepare('SELECT id,capability,provider,model,priority,tier,status,agent_no,ref_id,cost,latency_ms,degrade_reason,created_at FROM gen_tasks ORDER BY created_at DESC LIMIT 60').all()).results))
app.get('/api/console/rounds', async (c) => c.json((await c.env.DB.prepare(`SELECT r.id,r.user_id,r.node_id,r.mode,r.state,r.outcome_id,r.variant_id,r.commit_hash,r.rewind_count,r.opened_at,r.settled_at,b.amount,b.payout,b.status bet_status FROM rounds r LEFT JOIN bets b ON b.round_id=r.id AND b.status IN ('won','lost') ORDER BY r.opened_at DESC LIMIT 60`).all()).results))
app.patch('/api/console/nodes/:id', async (c) => {
  const b = await body(c); const id = c.req.param('id')
  const n: any = await c.env.DB.prepare('SELECT * FROM nodes WHERE id=?').bind(id).first()
  if (!n) return c.json({ error: 'NOT_FOUND' }, 404)
  if (b.status && ['active', 'dormant'].includes(b.status)) await c.env.DB.prepare('UPDATE nodes SET status=? WHERE id=?').bind(b.status, id).run()
  if (b.question && n.kind === 'cash') await c.env.DB.prepare('UPDATE nodes SET question=?, title=? WHERE id=?').bind(String(b.question).slice(0, 24), String(b.question).slice(0, 24), id).run()
  if (b.config && n.kind === 'cash') {
    const cfg = { ...J(n.config, {}), ...b.config }
    if (cfg.rake < 0.05 || cfg.rake > 0.1) return c.json({ error: 'RAKE_RANGE', message: 'rake 需在 0.05–0.10' }, 400)
    if (cfg.window_sec < 8 || cfg.window_sec > 15) return c.json({ error: 'WINDOW_RANGE', message: '下注窗口 8–15 秒' }, 400)
    await c.env.DB.prepare('UPDATE nodes SET config=? WHERE id=?').bind(JSON.stringify(cfg), id).run()
  }
  if (b.weights && n.kind === 'cash') {
    const sum = Object.values<number>(b.weights).reduce((a, x) => a + Number(x), 0)
    if (Math.abs(sum - 1) > 0.001 || Object.values<number>(b.weights).some((w) => w > 0.9 || w < 0.05)) return c.json({ error: 'WEIGHT_RULE', message: '权重和须为 1，单项 0.05–0.9' }, 400)
    await c.env.DB.batch(Object.entries<number>(b.weights).map(([oid, w]) => c.env.DB.prepare('UPDATE outcomes SET story_weight=? WHERE id=? AND node_id=?').bind(w, oid, id)))
  }
  await c.env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (6,?,?,?,?)').bind('edit_node', 'ok', `${id} ← ${JSON.stringify(b).slice(0, 120)}`, Date.now()).run()
  return c.json({ ok: true })
})
app.patch('/api/console/variants/:id', async (c) => {
  const b = await body(c)
  if (!['pool', 'review', 'rejected', 'reserve'].includes(b.status)) return c.json({ error: 'BAD_STATUS' }, 400)
  await c.env.DB.prepare('UPDATE variants SET status=? WHERE id=? AND is_fallback=0').bind(b.status, c.req.param('id')).run()
  return c.json({ ok: true })
})

// ─────────────── Agent-7 · 衍生 / 诗词 / 监管 / 片对 ───────────────
app.post('/api/agents/7/derive', async (c) => { const b = await body(c); return c.json(await derive(c.env, b.series_id || DEMO_SERIES, { anchor: b.anchor, trigger: b.trigger, n: Math.min(4, b.n || 3) })) })
app.post('/api/agents/7/approve', async (c) => { const b = await body(c); return c.json(await approveExtension(c.env, b.extension_id, b.index | 0)) })
app.post('/api/agents/7/poems', async (c) => { const b = await body(c); return c.json(await generatePoems(c.env, b.series_id || DEMO_SERIES)) })
app.get('/api/agents/7/regulate', async (c) => c.json(await regulate(c.env, c.req.query('series_id') || DEMO_SERIES)))
app.post('/api/agents/7/signals', async (c) => { const b = await body(c); return c.json(await ingestSignals(c.env, b.series_id || DEMO_SERIES, b.items || [])) })
app.get('/api/agents/7/clip-pairs', async (c) => c.json(await clipPairs(c.env, c.req.query('series_id') || DEMO_SERIES, { budget_clips: Number(c.req.query('budget') || 60) })))
app.post('/api/agents/7/clip-pairs/apply', async (c) => { const b = await body(c); return c.json(await applyClipPlan(c.env, b.series_id || DEMO_SERIES, b.budget)) })

// ─────────────── 漫剧 Comic 模式 ───────────────
app.get('/api/comic/meta', async (c) => {
  const id = uidOf(c)
  return c.json({ series: Comic.COMIC.series, nodes: Comic.COMIC.nodes.length, total_endings: Comic.totalEndings(), my_endings: id ? await Comic.myEndings(c.env, id) : [], config: await Comic.getConfig(c.env) })
})
app.post('/api/comic/start', async (c) => { const b = await body(c); return c.json(await Comic.startRun(c.env, uidOf(c, b), b.nick)) })
app.post('/api/comic/rounds/:id/bet', async (c) => { const b = await body(c); return c.json(await Comic.bet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), optionId: b.option_id, amount: b.amount })) })
app.post('/api/comic/rounds/:id/settle', async (c) => { const b = await body(c); return c.json(await Comic.settle(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/comic/rounds/:id/rewind', async (c) => { const b = await body(c); return c.json(await Comic.rewind(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), mode: b.mode })) })
app.post('/api/comic/rounds/:id/next', async (c) => { const b = await body(c); return c.json(await Comic.advance(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.get('/api/comic/rounds/:id/verify', async (c) => c.json(await Comic.verify(c.env, c.req.param('id'))))
app.get('/api/comic/tree', (c) => c.json({ series: Comic.COMIC.series, prologue: Comic.COMIC.prologue, nodes: Comic.COMIC.nodes, segments: Object.fromEntries(Object.entries<any>(Comic.COMIC.segments).map(([k, v]) => [k, { title: v.title, mood: v.mood, image_url: v.image_url, lines: v.lines }])) }))
app.get('/api/comic/config', async (c) => c.json(await Comic.getConfig(c.env)))
app.post('/api/comic/config', async (c) => {
  const cfg = await Comic.setConfig(c.env, await body(c))
  await c.env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (4,?,?,?,?)').bind('comic_config', 'ok', `机制参数更新 jitter=${cfg.jitter} rake=${cfg.rake} twist=${cfg.twist_weight} 覆盖 ${Object.keys(cfg.overrides).length} 个节点`, Date.now()).run()
  return c.json(cfg)
})
app.post('/api/comic/simulate', async (c) => { const b = await body(c); return c.json(await Comic.simulateTree(c.env, b.n || 2000)) })
app.get('/api/comic/stats', async (c) => c.json(await Comic.comicStats(c.env)))

app.get('/api/health', (c) => c.json({ ok: true, llm: !!c.env.OPENAI_API_KEY, video_provider: !!c.env.FAL_KEY, time: Date.now() }))

export default app
