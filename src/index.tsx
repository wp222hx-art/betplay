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
import { playerPage, consolePage, agentsPage, comicPage, filmPage, voicePage, lovePage, discoverPage, marketPage, studioPage, archPage, directorPage, seriesPage } from './pages/shell'
import CATALOG from './catalog/data.json'
import * as Comic from './comic/engine'
import * as Film from './film/engine'
import * as Love from './love/engine'
import * as Voice from './voice/studio'
import { authUid, checkTicket, ipKey, issueDevice, rateLimit, riskEvent } from './core/guard'
import * as Market from './market/cards'
import * as Studio from './studio/pipeline'
import * as Director from './studio/director'
import * as Tiers from './market/tiers'
import { createEngine } from './comic/factory'

const app = new Hono<{ Bindings: Bindings & { MEDIA?: R2Bucket; AUTH_SECRET?: string; ADMIN_KEY?: string }; Variables: { uid: string } }>()
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
// 身份只来自服务端签发的令牌；body/header 里的 user_id 一律忽略（旧逻辑可被任意冒充）
// uidOf(c) = 可选身份；uidOf(c, b) = 必须登录
const uidOf = (c: any, b?: any) => { const u = c.get('uid') || ''; if (b !== undefined && !u) throw new GameError('UNAUTHORIZED', '身份无效，请刷新页面'); return u }
const ADMIN_PREFIX = ['/api/console', '/api/agents', '/api/studio', '/api/admin', '/api/director']
app.use('/api/*', async (c, next) => {
  const path = c.req.path
  const u = await authUid(c.env as any, c, false)
  c.set('uid', u)
  const claimed = c.req.header('x-user-id')
  if (claimed && u && claimed !== u && !claimed.startsWith('console') && !claimed.startsWith('agent')) await riskEvent(c.env as any, u, 'spoof', 2, { claimed, path })
  // 管理面：生产环境必须携带 ADMIN_KEY（本地未配置时开放，便于开发）
  const isAdminWrite = ADMIN_PREFIX.some((p) => path.startsWith(p)) || (c.req.method !== 'GET' && (path.startsWith('/api/comic/config') || path.startsWith('/api/voice/')))
  if (isAdminWrite && (c.env as any).ADMIN_KEY && c.req.header('x-admin-key') !== (c.env as any).ADMIN_KEY) return c.json({ error: 'ADMIN_ONLY', message: '需要管理员密钥' }, 403)
  // 通用写操作限流：每设备 120 次/分钟，每 IP 600 次/分钟
  if (c.req.method === 'POST') {
    const ik = await ipKey(c)
    await rateLimit(c.env as any, 'ip:' + ik, 600, 60000)
    if (u) await rateLimit(c.env as any, 'u:' + u, 120, 60000)
  }
  await next()
})
app.post('/api/auth/device', async (c) => {
  const b = await body(c)
  await rateLimit(c.env as any, 'dev:' + (await ipKey(c)), 20, 3600000)
  return c.json(await issueDevice(c.env as any, c, b.legacy))
})
app.get('/api/auth/me', (c) => c.json({ uid: c.get('uid') || null }))

// ─── 媒体门禁：视频只能凭“揭晓后签发的短时票据”从 R2 读取，支持 Range 流式 ───
app.get('/m/:series/:clip', async (c) => {
  const series = c.req.param('series'), clip = c.req.param('clip').replace(/\.mp4$/, '')
  if (!(await checkTicket(c.env as any, series, clip, { u: c.req.query('u'), e: c.req.query('e'), s: c.req.query('s') }))) return c.text('ticket required', 403)
  const bucket = (c.env as any).MEDIA as R2Bucket | undefined
  if (!bucket) return c.text('media bucket not bound', 503)
  const key = `${series}/${clip}.mp4`
  const range = c.req.header('range')
  let opt: any = {}
  let head: R2Object | null = null
  if (range) {
    head = await bucket.head(key); if (!head) return c.notFound()
    const m = range.match(/bytes=(\d*)-(\d*)/)
    const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], head.size - 1) : head.size - 1
    opt = { range: { offset: start, length: end - start + 1 } }
    const obj = await bucket.get(key, opt); if (!obj) return c.notFound()
    return new Response(obj.body, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${head.size}`, 'Content-Length': String(end - start + 1), 'Cache-Control': 'private, max-age=3600' } })
  }
  const obj = await bucket.get(key); if (!obj) return c.notFound()
  return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(obj.size), 'Cache-Control': 'private, max-age=3600' } })
})

// ─────────────── 上架目录 ───────────────
app.get('/api/catalog', async (c) => {
  const u = uidOf(c)
  const rows = (await c.env.DB.prepare('SELECT item_id, COUNT(*) n FROM catalog_wish GROUP BY item_id').all()).results as any[]
  const cnt = Object.fromEntries(rows.map((r) => [r.item_id, r.n]))
  const mine = u ? ((await c.env.DB.prepare('SELECT item_id FROM catalog_wish WHERE user_id=?').bind(u).all()).results as any[]).map((r) => r.item_id) : []
  const plays = Object.fromEntries(((await c.env.DB.prepare(`SELECT series_id, COUNT(*) n FROM comic_runs GROUP BY series_id`).all()).results as any[]).map((r) => [r.series_id, r.n]))
  const SID: Record<string, string> = { love_corridor: 'love_corridor', under_dome: (Film.COMIC as any).series.id }
  const pub = (await c.env.DB.prepare(`SELECT p.id, p.project_id, p.cat, p.title, p.logline, p.tags, p.cover, p.data, p.created_at, s.source_item FROM published_series p LEFT JOIN studio_projects s ON s.id=p.project_id WHERE p.status='live' ORDER BY p.created_at DESC`).all()).results as any[]
  const fromItem = Object.fromEntries(pub.filter((p) => p.source_item).map((p) => [p.source_item, p]))
  const genItems = pub.filter((p) => !p.source_item).map((p, i) => { const d = JSON.parse(p.data); const ends = new Set(d.nodes.flatMap((n: any) => n.options.filter((o: any) => !o.next).map((o: any) => o.id))).size
    return { id: p.id, cat: p.cat, title: p.title, sub: 'AI 导演生成', tags: JSON.parse(p.tags || '[]'), heat: 8000, endings: ends, nodes: d.nodes.length, forks: d.nodes.filter((n: any) => n.fork).length, status: 'live', url: '/s/' + p.id, badge: '新作', logline: p.logline, cover: p.cover, order: -1 - i } })
  const items = [...genItems, ...(CATALOG as any).items.map((it: any) => fromItem[it.id] ? { ...it, status: 'live', url: '/s/' + fromItem[it.id].id, badge: '新上线', cover: it.cover } : it)]
    .map((it: any) => ({ ...it, wish: (it.heat * 3 + (cnt[it.id] || 0)), wished: mine.includes(it.id), plays: plays[SID[it.id] || it.id] || 0 }))
  return c.json({ cats: (CATALOG as any).cats, items })
})
app.post('/api/catalog/:id/wish', async (c) => {
  const b = await body(c), u = uidOf(c, b), id = c.req.param('id')
  if (!u) throw new GameError('NO_USER', '缺少用户')
  if (!(CATALOG as any).items.some((x: any) => x.id === id)) throw new GameError('NOT_FOUND', '作品不存在')
  const on = b.on !== false
  if (on) await c.env.DB.prepare('INSERT OR IGNORE INTO catalog_wish (user_id,item_id,created_at) VALUES (?,?,?)').bind(u, id, Date.now()).run()
  else await c.env.DB.prepare('DELETE FROM catalog_wish WHERE user_id=? AND item_id=?').bind(u, id).run()
  return c.json({ ok: true, wished: on })
})

// ─────────────── 结局卡交易所 ───────────────
const ENGINES: Record<string, any> = { [Love.SERIES]: Love, [Film.SERIES]: Film }
const SERIES_URL: Record<string, string> = { [Love.SERIES]: '/love', [Film.SERIES]: '/film' }
// 后台生成并上架的作品：从 published_series 动态加载引擎（isolate 内按版本缓存）
const DYN: Record<string, { v: number; E: any }> = {}
async function engineOf(env: any, sid: string) {
  if (ENGINES[sid]) return ENGINES[sid]
  const r: any = await env.DB.prepare(`SELECT data, version FROM published_series WHERE id=? AND status='live'`).bind(sid).first()
  if (!r) throw new GameError('NOT_FOUND', '作品不存在或已下架')
  if (!DYN[sid] || DYN[sid].v !== r.version) DYN[sid] = { v: r.version, E: createEngine(JSON.parse(r.data)) }
  SERIES_URL[sid] = '/s/' + sid
  return DYN[sid].E
}
const titles = (series: string, ending: string) => {
  const E = ENGINES[series] || DYN[series]?.E; if (!E) return { series_title: series, ending_title: ending }
  const o = E.COMIC.nodes.flatMap((n: any) => n.options).find((x: any) => x.id === ending)
  const seg = E.COMIC.segments[ending] || {}
  return { series_title: E.COMIC.series.title, ending_title: o?.ending_title || o?.label || seg.title, image: seg.last_url || seg.image_url, poster: seg.image_url, twist: !!o?.twist, url: SERIES_URL[series] }
}
app.get('/api/market', async (c) => c.json(await Market.market(c.env as any, titles, { series: c.req.query('series'), rarity: c.req.query('rarity'), sort: c.req.query('sort') })))
app.get('/api/market/cards/:id', async (c) => c.json(await Market.cardDetail(c.env as any, c.req.param('id'), titles)))
app.get('/api/me/cards', async (c) => { const u = uidOf(c, {}); const me: any = await ensureUser(c.env, u); return c.json({ cards: await Market.myCards(c.env as any, u, titles), balance: me.chips }) })
app.post('/api/market/list', async (c) => { const b = await body(c); const u = uidOf(c, b); await rateLimit(c.env as any, 'list:' + u, 30, 3600000); return c.json(await Market.listCard(c.env as any, { owner: u, card: b.card_id, price: b.price })) })
app.post('/api/market/cancel', async (c) => { const b = await body(c); return c.json(await Market.cancelListing(c.env as any, { owner: uidOf(c, b), listing: b.listing_id })) })
app.post('/api/market/buy', async (c) => { const b = await body(c); const u = uidOf(c, b); await rateLimit(c.env as any, 'buy:' + u, 30, 3600000); return c.json(await Market.buyListing(c.env as any, { buyer: u, listing: b.listing_id, ipHash: await ipKey(c) })) })
app.get('/api/me/cards/:id/watch', async (c) => { const cd: any = await c.env.DB.prepare('SELECT series_id FROM ending_cards WHERE id=?').bind(c.req.param('id')).first(); if (cd) await engineOf(c.env, cd.series_id).catch(() => null); return c.json(await Market.watchPath(c.env as any, { owner: uidOf(c, {}), card: c.req.param('id'), segs: (s) => (ENGINES[s] || DYN[s]?.E)?.COMIC.segments || {} })) })

// ─────────────── 风控台（管理） ───────────────
app.get('/api/admin/risk', async (c) => {
  const ev = (await c.env.DB.prepare('SELECT * FROM risk_events ORDER BY id DESC LIMIT 100').all()).results
  const by = (await c.env.DB.prepare('SELECT kind, COUNT(*) n FROM risk_events WHERE created_at>? GROUP BY kind').bind(Date.now() - 86400000).all()).results
  const dev: any = await c.env.DB.prepare('SELECT COUNT(*) n, SUM(legacy) legacy FROM auth_devices').first()
  const banned = (await c.env.DB.prepare('SELECT * FROM user_flags WHERE banned=1 ORDER BY updated_at DESC LIMIT 50').all()).results
  const ledger: any = await c.env.DB.prepare(`SELECT SUM(CASE WHEN direction='D' THEN amount ELSE 0 END) d, SUM(CASE WHEN direction='C' THEN amount ELSE 0 END) cr FROM ledger`).first()
  return c.json({ events: ev, by_kind_24h: by, devices: dev, banned, ledger_balanced: ledger.d === ledger.cr, ledger })
})
app.post('/api/admin/ban', async (c) => {
  const b = await body(c)
  await c.env.DB.prepare('INSERT OR REPLACE INTO user_flags (uid,banned,reason,updated_at) VALUES (?,?,?,?)').bind(b.uid, b.ban ? 1 : 0, b.reason || '', Date.now()).run()
  if (b.ban) await c.env.DB.prepare('UPDATE auth_devices SET token_ver=token_ver+1 WHERE uid=?').bind(b.uid).run()
  await c.env.DB.prepare('INSERT INTO audit_log (actor,action,detail,created_at) VALUES (?,?,?,?)').bind('admin', b.ban ? 'ban' : 'unban', JSON.stringify(b), Date.now()).run()
  return c.json({ ok: true })
})

// ─────────────── 制作平台（管理） ───────────────
app.get('/api/studio/projects', async (c) => c.json({ projects: await Studio.listProjects(c.env), stages: Studio.STAGES, credits: Studio.CREDITS }))
app.get('/api/studio/projects/:id', async (c) => c.json(await Studio.projectDetail(c.env, c.req.param('id'))))
app.post('/api/studio/projects', async (c) => {
  const b = await body(c)
  const it = b.item_id ? (CATALOG as any).items.find((x: any) => x.id === b.item_id) : null
  const src = it || b
  if (!src?.title) throw new GameError('BAD_INPUT', '缺少标题')
  return c.json(await Studio.scriptProject(c.env, { title: src.title, logline: src.logline || '', cat: src.cat || 'love', tags: src.tags, source_item: it?.id, parent: b.parent, kind: b.parent ? 'sequel' : 'series' }))
})
app.post('/api/studio/projects/:id/validate', async (c) => { const d: any = await Studio.projectDetail(c.env, c.req.param('id')); return c.json(d.validation) })
app.post('/api/studio/projects/:id/repair', async (c) => c.json(await Studio.repairProject(c.env, c.req.param('id'))))
app.post('/api/studio/projects/:id/render', async (c) => c.json(await Studio.queueRender(c.env, c.req.param('id'))))
app.post('/api/studio/jobs/claim', async (c) => { const b = await body(c); return c.json({ job: await Studio.claimJob(c.env, b.worker || 'worker') }) })
app.post('/api/studio/jobs/:id/report', async (c) => { const b = await body(c); return c.json(await Studio.reportJob(c.env, { id: c.req.param('id'), ok: !!b.ok, url: b.url, qc: b.qc })) })
app.post('/api/studio/jobs/:id/review', async (c) => { const b = await body(c); return c.json(await Studio.reviewJob(c.env, { id: c.req.param('id'), approve: !!b.approve })) })
// ── 后台指挥：主题 → 剧本(自动植入博弈) → 预算 → 开拍 → worker 生成 → 自动质检/审核 → 自动上架 ──
app.get('/api/director/meta', async (c) => c.json(await Director.creditReport(c.env)))
app.post('/api/director/brief', async (c) => {
  const b = await body(c)
  const it = b.item_id ? (CATALOG as any).items.find((x: any) => x.id === b.item_id) : null
  if (!b.theme && !it) throw new GameError('BAD_INPUT', '请输入主题')
  return c.json(await Director.direct(c.env, { theme: b.theme || `${it.title}：${it.logline}`, cat: b.cat || it?.cat || 'love', scale: b.scale || 'standard', budget: +b.budget || 0, auto: !!b.auto, item_id: it?.id, title: it?.title || b.title, logline: it?.logline, tags: it?.tags }))
})
app.post('/api/director/projects/:id/greenlight', async (c) => c.json(await Director.greenlight(c.env, c.req.param('id'))))
app.post('/api/director/projects/:id/bonus', async (c) => c.json(await Director.addBonus(c.env, c.req.param('id'))))
app.post('/api/admin/pool/seed', async (c) => { const b = await body(c); await Tiers.feedPool(c.env as any, b.series, +b.amount || 5000, 'platform:house', 'seed:' + Date.now()); return c.json(await Tiers.tierBoard(c.env as any, b.series)) })
app.get('/api/fate/:series', async (c) => c.json(await Tiers.tierBoard(c.env as any, c.req.param('series'))))
app.post('/api/director/projects/:id/publish', async (c) => c.json(await Director.publish(c.env, c.req.param('id'))))
app.post('/api/director/projects/:id/pause', async (c) => { await c.env.DB.prepare(`UPDATE studio_projects SET status=CASE status WHEN 'rendering' THEN 'paused' WHEN 'paused' THEN 'rendering' ELSE status END WHERE id=?`).bind(c.req.param('id')).run(); return c.json(await Director.progress(c.env, c.req.param('id'))) })
app.post('/api/director/claim', async (c) => { const b = await body(c); return c.json({ job: await Director.claim(c.env, b.worker || 'worker', b.balance) }) })
app.post('/api/director/jobs/:id/report', async (c) => { const b = await body(c); return c.json(await Director.report(c.env, { id: c.req.param('id'), ok: !!b.ok, url: b.url, spent: b.spent, meta: b.meta, qc: b.qc })) })
app.post('/api/director/jobs/:id/review', async (c) => { const b = await body(c); return c.json(await Director.review(c.env, c.req.param('id'), !!b.approve)) })

// ── 动态作品：/s/:sid 播放页 + /api/s/:sid/* 引擎 ──
app.get('/api/s/:sid/meta', async (c) => { const E = await engineOf(c.env, c.req.param('sid')); const id = uidOf(c); return c.json({ series: E.COMIC.series, nodes: E.COMIC.nodes.length, total_endings: E.totalEndings(), my_endings: id ? await E.myEndings(c.env, id) : [], config: await E.getConfig(c.env) }) })
app.get('/api/s/:sid/tree', async (c) => c.json((await engineOf(c.env, c.req.param('sid'))).publicTree()))
app.post('/api/s/:sid/start', async (c) => { const b = await body(c); return c.json(await (await engineOf(c.env, c.req.param('sid'))).startRun(c.env, uidOf(c, b), b.nick)) })
app.post('/api/s/:sid/rounds/:id/bet', async (c) => { const b = await body(c); return c.json(await (await engineOf(c.env, c.req.param('sid'))).bet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), optionId: b.option_id, amount: b.amount })) })
app.post('/api/s/:sid/rounds/:id/settle', async (c) => { const b = await body(c); return c.json(await (await engineOf(c.env, c.req.param('sid'))).settle(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/s/:sid/rounds/:id/rewind', async (c) => { const b = await body(c); return c.json(await (await engineOf(c.env, c.req.param('sid'))).rewind(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), mode: b.mode })) })
app.post('/api/s/:sid/rounds/:id/next', async (c) => { const b = await body(c); return c.json(await (await engineOf(c.env, c.req.param('sid'))).advance(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.get('/api/s/:sid/rounds/:id/verify', async (c) => c.json(await (await engineOf(c.env, c.req.param('sid'))).verify(c.env, c.req.param('id'))))

app.get('/api/studio/next', async (c) => c.json(await Studio.nextUp(c.env, (CATALOG as any).items)))

// ─────────────── 页面 ───────────────
// 首页 = 发现页（恋爱 / 影剧两大类上架列表）；旧“剧场”下沉到 /theater，漫剧保留直链不进导航
app.get('/', (c) => c.html(discoverPage()))
app.get('/discover', (c) => c.html(discoverPage()))
app.get('/theater', (c) => c.html(playerPage()))
app.get('/market', (c) => c.html(marketPage()))
app.get('/studio', (c) => c.html(studioPage()))
app.get('/arch', (c) => c.html(archPage()))
app.get('/director', (c) => c.html(directorPage()))
app.get('/s/:sid', async (c) => { const r: any = await c.env.DB.prepare(`SELECT title, cat FROM published_series WHERE id=? AND status='live'`).bind(c.req.param('sid')).first(); if (!r) return c.notFound(); return c.html(seriesPage(c.req.param('sid'), r.title, r.cat)) })
// 生成作品的公开海报/末帧/角色图（R2：<sid>/img/<name>.webp）
app.get('/gimg/:sid/:name', async (c) => { const o = await (c.env as any).MEDIA?.get(`${c.req.param('sid')}/img/${c.req.param('name')}`); if (!o) return c.notFound(); return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'image/webp', 'Cache-Control': 'public, max-age=86400' } }) })
app.get('/play/:series', (c) => c.html(playerPage()))
app.get('/console', (c) => c.html(consolePage()))
app.get('/agents', (c) => c.html(agentsPage()))
app.get('/comic', (c) => c.html(comicPage()))
app.get('/film', (c) => c.html(filmPage()))
app.get('/love', (c) => c.html(lovePage()))
app.get('/voice', (c) => c.html(voicePage()))

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
app.post('/api/me/faucet', async (c) => { const b = await body(c); const u = uidOf(c, b); await rateLimit(c.env as any, 'faucet:' + u, 1, 20 * 3600000); return c.json(await claimFaucet(c.env, u)) })
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
app.get('/api/comic/tree', (c) => c.json({ series: Comic.COMIC.series, cast: Comic.COMIC.cast || {}, prologue: Comic.COMIC.prologue, nodes: Comic.COMIC.nodes, segments: Object.fromEntries(Object.entries<any>(Comic.COMIC.segments).map(([k, v]) => [k, { title: v.title, mood: v.mood, image_url: v.image_url, video_url: v.video_url || null, lines: v.lines, track: v.track || null, track_dur: v.track_dur || 0, sfx_t: v.sfx_t ?? null, ambience: v.ambience, sfx: v.sfx, sfx_at: v.sfx_at }])) }))
app.get('/api/comic/config', async (c) => c.json(await Comic.getConfig(c.env)))
app.post('/api/comic/config', async (c) => {
  const cfg = await Comic.setConfig(c.env, await body(c))
  await c.env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (4,?,?,?,?)').bind('comic_config', 'ok', `机制参数更新 jitter=${cfg.jitter} rake=${cfg.rake} twist=${cfg.twist_weight} 覆盖 ${Object.keys(cfg.overrides).length} 个节点`, Date.now()).run()
  return c.json(cfg)
})
app.post('/api/comic/simulate', async (c) => { const b = await body(c); return c.json(await Comic.simulateTree(c.env, b.n || 2000)) })
app.get('/api/comic/stats', async (c) => c.json(await Comic.comicStats(c.env)))

// ─────────────── 影剧 Film 模式（Seedance 2.0 音画一体，5 结局）：与漫剧共用对弈引擎 ───────────────
app.get('/api/film/meta', async (c) => { const id = uidOf(c); return c.json({ series: Film.COMIC.series, nodes: Film.COMIC.nodes.length, total_endings: Film.totalEndings(), my_endings: id ? await Film.myEndings(c.env, id) : [], config: await Film.getConfig(c.env) }) })
app.get('/api/film/tree', (c) => c.json(Film.publicTree()))
app.post('/api/film/start', async (c) => { const b = await body(c); return c.json(await Film.startRun(c.env, uidOf(c, b), b.nick)) })
app.post('/api/film/rounds/:id/bet', async (c) => { const b = await body(c); return c.json(await Film.bet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), optionId: b.option_id, amount: b.amount })) })
app.post('/api/film/rounds/:id/settle', async (c) => { const b = await body(c); return c.json(await Film.settle(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/film/rounds/:id/rewind', async (c) => { const b = await body(c); return c.json(await Film.rewind(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), mode: b.mode })) })
app.post('/api/film/rounds/:id/next', async (c) => { const b = await body(c); return c.json(await Film.advance(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.get('/api/film/rounds/:id/verify', async (c) => c.json(await Film.verify(c.env, c.req.param('id'))))
app.post('/api/film/simulate', async (c) => { const b = await body(c); return c.json(await Film.simulateTree(c.env, b.n || 2000)) })

// ─────────────── 恋爱剧《心动回廊》（Seedance 2.0 音画一体，21 结局）：与漫剧共用对弈引擎 ───────────────
app.get('/api/love/meta', async (c) => { const id = uidOf(c); return c.json({ series: Love.COMIC.series, nodes: Love.COMIC.nodes.length, total_endings: Love.totalEndings(), my_endings: id ? await Love.myEndings(c.env, id) : [], config: await Love.getConfig(c.env) }) })
app.get('/api/love/tree', (c) => c.json(Love.publicTree()))
app.post('/api/love/start', async (c) => { const b = await body(c); return c.json(await Love.startRun(c.env, uidOf(c, b), b.nick)) })
app.post('/api/love/rounds/:id/bet', async (c) => { const b = await body(c); return c.json(await Love.bet(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), optionId: b.option_id, amount: b.amount })) })
app.post('/api/love/rounds/:id/settle', async (c) => { const b = await body(c); return c.json(await Love.settle(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.post('/api/love/rounds/:id/rewind', async (c) => { const b = await body(c); return c.json(await Love.rewind(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b), mode: b.mode })) })
app.post('/api/love/rounds/:id/next', async (c) => { const b = await body(c); return c.json(await Love.advance(c.env, { roundId: c.req.param('id'), userId: uidOf(c, b) })) })
app.get('/api/love/rounds/:id/verify', async (c) => c.json(await Love.verify(c.env, c.req.param('id'))))
app.post('/api/love/simulate', async (c) => { const b = await body(c); return c.json(await Love.simulateTree(c.env, b.n || 2000)) })

// ─────────────── 角色声线工作室（千问 Qwen3-TTS）───────────────
const castDefaults = () => Comic.COMIC.cast || {}
const voiceErr = (c: any, e: any) => c.json({ error: e.code || 'VOICE_ERROR', message: e.message }, e.code === 'Arrearage' ? 402 : 400)
app.get('/api/voice/meta', async (c) => {
  // 配音进度：每段对白现在用的是哪套引擎（v4 = 千问，v3 = ElevenLabs）
  const segs = Object.entries<any>(Comic.COMIC.segments)
  const eng = (t: string) => (t || '').includes('/v4/') ? 'qwen' : (t || '').includes('/v3/') ? 'elevenlabs' : 'none'
  const byEngine: Record<string, number> = {}; segs.forEach(([, v]) => { const k = eng(v.track); byEngine[k] = (byEngine[k] || 0) + 1 })
  const cueEng: Record<string, number> = {}; Comic.COMIC.nodes.forEach((n: any) => { const k = eng(n.cue?.track); cueEng[k] = (cueEng[k] || 0) + 1 })
  const lines: Record<string, any[]> = {}
  segs.forEach(([sid, v]) => (v.lines || []).forEach((l: any) => { (lines[l.speaker] ||= []).length < 6 && lines[l.speaker].push({ sid, text: l.text, emotion: l.emotion, track: v.track, start: l.start, end: l.end, engine: eng(v.track) }) }))
  const counts: Record<string, number> = {}; segs.forEach(([, v]) => (v.lines || []).forEach((l: any) => (counts[l.speaker] = (counts[l.speaker] || 0) + 1)))
  return c.json({ voices: Voice.QWEN_VOICES, fx: Voice.FX_PRESETS, progress: { segments: byEngine, cues: cueEng, total_segments: segs.length, total_cues: Comic.COMIC.nodes.length }, samples: lines, line_counts: counts })
})
app.get('/api/voice/status', async (c) => c.json(await Voice.status(c.env as any)))
app.get('/api/voice/cast', async (c) => c.json(await Voice.getCast(c.env as any, castDefaults())))
app.post('/api/voice/cast/:name', async (c) => { try { return c.json(await Voice.saveCast(c.env as any, c.req.param('name'), await body(c), castDefaults())) } catch (e) { return voiceErr(c, e) } })
app.delete('/api/voice/cast/:name', async (c) => { await Voice.resetCast(c.env as any, c.req.param('name')); return c.json({ ok: true }) })
app.post('/api/voice/audition', async (c) => { try { return c.json(await Voice.audition(c.env as any, await body(c))) } catch (e) { return voiceErr(c, e) } })
app.post('/api/voice/design', async (c) => { try { return c.json(await Voice.designVoice(c.env as any, await body(c))) } catch (e) { return voiceErr(c, e) } })
app.get('/api/voice/custom', async (c) => c.json(await Voice.listCustom(c.env as any)))
app.delete('/api/voice/custom/:id', async (c) => { await Voice.deleteCustom(c.env as any, c.req.param('id')); return c.json({ ok: true }) })

app.get('/api/health', (c) => c.json({ ok: true, llm: !!c.env.OPENAI_API_KEY, video_provider: !!c.env.FAL_KEY, time: Date.now() }))

export default app
