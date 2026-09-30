// P5 · 第 10 步「预检 · 上架」—— 替代旧导演台 / 上架中心
//   预检（确定性）→ 合规审核 Agent（COMPLIANCE）→ 打包（执行节点：按编译计划拼接片段、裁角色头像、抽海报/末帧，写到玩家端媒体路径）
//   → 版本快照 ready（不可变）→ 审核通过 = 发布到玩家端 published_series（发现页 + /s/:id 立即可玩）
//   每个版本的媒体文件名都带版本号，旧版素材永不覆盖 → 任意历史版本一键回滚；下架 / 恢复只改状态
import { HttpError, type Env, type User, audit } from './auth'
import * as C from './compile'
import * as Gw from './gateway'
import * as L from './ledger'
import * as Media from './media'
import * as Steps from './steps'
import { uid } from './sec'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const AUDS = ['all', 'female', 'male'], RATINGS = ['all', '12', '16', '18'], BADGES = ['新作', '热播', '爆款', '独家', '限免', '完结']
export const GENRES = ['romance', 'urban', 'revenge', 'suspense', 'costume', 'fantasy', 'action', 'survival', 'absurd', 'surreal']
const COLORS = ['#ff7eb3', '#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#f87171']
type Check = { key: string; ok: boolean; level: 'block' | 'warn'; msg: string; detail?: any }

async function project(env: Env, pid: string) {
  const p: any = await env.DB.prepare('SELECT * FROM st_projects WHERE id=?').bind(pid).first()
  if (!p) throw new HttpError(404, 'NO_PROJECT', '项目不存在')
  return p
}
/** 玩家端作品 id：一个项目固定一个（首次打包时分配），版本号递增 */
async function seriesIdOf(env: Env, p: any) {
  if (p.series_id) return p.series_id
  const sid = 'ms_' + p.id.replace(/^sp_/, '').slice(0, 10)
  await env.DB.prepare('UPDATE st_projects SET series_id=? WHERE id=?').bind(sid, p.id).run()
  return sid
}

/** 收集编译所需的全部上游（全部来自已审批版本）+ 素材槽 */
async function gather(env: Env, pid: string) {
  const u = await Media.upstream(env, pid)
  const slots = new Map<string, any>(((await env.DB.prepare('SELECT * FROM st_slots WHERE project_id=?').bind(pid).all()).results as any[]).map((r) => [`${r.step}:${r.slot}`, r]))
  const clip = (node: string) => slots.get(`${u.main.has(node) ? 7 : 8}:${node}`)
  const plan = C.compile(u.graph)
  return { u, slots, clip, plan }
}

/** 编译指纹：结构图 + 剧本台词 + 每个用到的素材（media_key）+ 上架信息 → 任何一项变了都必须重新打包 */
function fingerprint(g: any, meta: any) {
  const clips = [...new Set(Object.values<C.SegPlan>(g.plan.segments).flatMap((s) => s.parts.map((p) => p.node)))].sort()
  return L.fnv(L.stable({
    n: g.u.graph.nodes.map((n: any) => [n.id, n.type, n.title, n.question, n.tier]), e: g.u.graph.edges.map((e: any) => [e.from, e.to, e.kind, e.label, e.hint]),
    c: clips.map((id) => [id, g.clip(id)?.media_key || '', (g.u.scripts.get(id)?.beats || []).map((b: any) => b.line || '')]),
    cast: (g.u.bible?.cast || []).map((c: any) => [c.id, c.name, g.slots.get(`6:cast.${c.id}`)?.media_key || '']), cover: g.slots.get('6:cover')?.media_key || '', meta
  }))
}

/** 上架信息：默认值来自第 1/2 步，可在第 10 步编辑 */
async function metaOf(env: Env, pid: string, u: any, patch: any = {}) {
  const p = await project(env, pid), s: any = await env.DB.prepare('SELECT input FROM st_steps WHERE project_id=? AND step=10').bind(pid).first()
  const saved = J(s?.input, {}) || {}
  const m = { title: p.title, logline: u.bible?.logline || '', genre: u.brief?.genre && GENRES.includes(u.brief.genre) ? u.brief.genre : p.genre || '', aud: 'all', rating: '16', badge: '新作', tags: [] as string[], ...saved, ...patch }
  m.title = String(m.title || '').trim().slice(0, 30); m.logline = String(m.logline || '').trim().slice(0, 120)
  if (!GENRES.includes(m.genre)) m.genre = ''
  if (!AUDS.includes(m.aud)) m.aud = 'all'; if (!RATINGS.includes(m.rating)) m.rating = '16'; if (!BADGES.includes(m.badge)) m.badge = '新作'
  m.tags = (Array.isArray(m.tags) ? m.tags : String(m.tags || '').split(/[,，\s]+/)).map((t: any) => String(t).trim().slice(0, 8)).filter(Boolean).slice(0, 5)
  return m
}
export async function saveMeta(env: Env, u: User, pid: string, patch: any) {
  await Steps.assertOpen(env, pid, 10)
  const g = await Media.upstream(env, pid), m = await metaOf(env, pid, g, patch)
  await env.DB.prepare('UPDATE st_steps SET input=?, updated_at=?, updated_by=? WHERE project_id=? AND step=?').bind(JSON.stringify(m), now(), u.id, pid, 10).run()
  await audit(env, u.id, 'release_meta', pid, m)
  return m
}

// ───────── 预检（确定性，不花钱）─────────
export async function preflight(env: Env, pid: string) {
  await Steps.assertOpen(env, pid, 10)
  const g = await gather(env, pid), meta = await metaOf(env, pid, g.u)
  const checks: Check[] = [], add = (key: string, ok: boolean, level: Check['level'], msg: string, detail?: any) => checks.push({ key, ok, level, msg, detail })
  const errs = g.plan.issues.filter((i) => i.level === 'error')
  add('compile', !errs.length, 'block', errs.length ? `结构图无法翻译成玩家端剧情：${errs.map((e) => e.msg).join('；')}` : `可玩：${g.plan.stats.decisions} 个抉择点 · ${g.plan.stats.options} 个选项 · ${g.plan.stats.endings} 个结局 · ${g.plan.stats.segments} 个播放片段`)
  for (const w of g.plan.issues.filter((i) => i.level === 'warn')) add('compile_' + w.code, false, 'warn', w.msg)
  // 素材：每个用到的节点视频都必须 ok（第 9 步已放行）且真实（非模拟）
  const need = [...new Set(Object.values<C.SegPlan>(g.plan.segments).flatMap((s) => s.parts.map((p) => p.node)))]
  const missing = need.filter((id) => g.clip(id)?.status !== 'ok' || !g.clip(id)?.media_key)
  add('clips', !missing.length, 'block', missing.length ? `${missing.length} 个节点视频未通过：${missing.slice(0, 6).join('、')}` : `${need.length} 段视频全部通过一致性检测`)
  const jobs = (await env.DB.prepare(`SELECT slot, provider_kind FROM st_jobs WHERE project_id=? AND phase='gen' AND status='succeeded'`).bind(pid).all()).results as any[]
  const lastKind = new Map<string, string>(); for (const j of jobs) lastKind.set(j.slot, j.provider_kind)
  const mocked = need.filter((id) => /^mock/.test(lastKind.get(id) || ''))
  add('real_media', !mocked.length, env.STUDIO_ALLOW_MOCK_PUBLISH === '1' ? 'warn' : 'block', mocked.length ? `${mocked.length} 段视频是模拟占位（${mocked.slice(0, 4).join('、')}），不能发布给玩家` : '全部为真实生成素材')
  const cast = g.u.bible?.cast || [], noSheet = cast.filter((c: any) => g.slots.get(`6:cast.${c.id}`)?.status !== 'ok')
  add('cast', !noSheet.length, 'warn', noSheet.length ? `${noSheet.length} 个角色没有设定图（播放器头像用封面代替）` : `${cast.length} 个角色设定图就绪（打包时裁成头像）`)
  add('cover', g.slots.get('6:cover')?.status === 'ok', 'block', g.slots.get('6:cover')?.status === 'ok' ? '封面已就绪' : '缺少封面（第 6 步）')
  // 台词：每段有台词才有字幕；台词里不能出现角色 id 以外的说话人
  const noLines = need.filter((id) => !(g.u.scripts.get(id)?.beats || []).some((b: any) => b.line && b.line !== '……'))
  add('lines', noLines.length < need.length, 'warn', noLines.length ? `${noLines.length} 段没有台词（播放时无字幕）` : '全部片段有台词字幕')
  add('meta', !!meta.title && !!meta.logline && !!meta.genre, 'block', !meta.title || !meta.logline ? '缺少标题或简介' : !meta.genre ? '请选择题材（发现页分类用）' : `「${meta.title}」· ${meta.genre} · ${meta.aud} · ${meta.rating}+`)
  if (!(await env.DB.prepare(`SELECT 1 FROM st_exec_nodes WHERE enabled=1 AND last_seen>? AND kinds LIKE '%post%'`).bind(now() - 10 * 60000).first())) add('node', false, 'block', '没有在线的执行节点（需要 post 能力，负责拼接片段）')
  const p = await project(env, pid), sid = p.series_id
  const live: any = sid ? await env.DB.prepare('SELECT version, status FROM published_series WHERE id=?').bind(sid).first() : null
  const fp = fingerprint(g, meta)
  const last: any = await env.DB.prepare(`SELECT id, version, status, src_hash FROM st_releases WHERE project_id=? ORDER BY created_at DESC LIMIT 1`).bind(pid).first()
  const blockers = checks.filter((c) => !c.ok && c.level === 'block')
  return { checks, can_pack: !blockers.length, blockers: blockers.map((b) => b.msg), meta, stats: g.plan.stats, plan: { nodes: g.plan.nodes.map((n) => ({ id: n.id, depth: n.depth, question: n.question, fork: !!n.fork, options: n.options.map((o) => ({ label: o.label, next: o.next || null, ending: o.ending_title || null, tier: o.ending_tier || null, seg: o.id })) })), segments: Object.values(g.plan.segments).map((s) => ({ id: s.id, kind: s.kind, title: s.title, parts: s.parts.map((x) => x.node) })) },
    fingerprint: fp, latest: last ? { ...last, up_to_date: last.src_hash === fp } : null, live: live ? { series_id: sid, ...live } : null }
}

// ───────── 合规审核 Agent ─────────
async function compliance(env: Env, pid: string, g: any, meta: any, u?: User) {
  const texts = Object.values<C.SegPlan>(g.plan.segments).map((s) => `【${s.title}】` + s.parts.map((p) => (g.u.scripts.get(p.node)?.beats || []).map((b: any) => `${b.who}：${b.line || ''}（${b.action || ''}）`).join(' ')).join(' ')).join('\n').slice(0, 6000)
  const opts = g.plan.nodes.map((n: any) => `${n.question}：${n.options.map((o: any) => o.label).join(' / ')}`).join('\n')
  const r = await Gw.chat(env, 'COMPLIANCE', { json: true, project_id: pid, step: 10, user: u?.id, timeoutMs: 60000,
    system: '你是互动短剧上架合规审核员。平台已在所有页面固定展示「娱乐币 · 不可提现 · 不可兑换」声明，这一点无需再作为问题提出。平台规则：玩家用「娱乐币 Chips」对剧情走向下注，娱乐币不可提现、不可兑换现金或实物；严禁出现真钱赌博、提现、兑换、返现的引导；严禁未成年人涉性、露骨色情、血腥虐杀细节、毒品教学、真实名人/品牌侵权、歧视与仇恨；暴力与犯罪题材可以存在但须戏剧化、不渲染细节；剧中角色的赌局、筹码属于戏剧情节，不是违规。level=block 只用于必须修改才能上架的问题。只输出 JSON：{"ok":bool,"risk":"low|medium|high","rating":"all|12|16|18","issues":[{"where":"片段标题或字段","level":"block|warn","msg":"≤40字"}],"note":"≤60字"}',
    prompt: `作品：${meta.title}\n简介：${meta.logline}\n分级（申报）：${meta.rating}\n标签：${meta.tags.join('、')}\n\n抉择与选项：\n${opts}\n\n台词与动作：\n${texts}` })
  const d = r.data || {}
  return { ok: d.ok !== false, risk: ['low', 'medium', 'high'].includes(d.risk) ? d.risk : 'medium', rating: RATINGS.includes(String(d.rating)) ? String(d.rating) : null, issues: (Array.isArray(d.issues) ? d.issues : []).slice(0, 12).map((i: any) => ({ where: String(i.where || '').slice(0, 30), level: i.level === 'block' ? 'block' : 'warn', msg: String(i.msg || '').slice(0, 80) })), note: String(d.note || '').slice(0, 120), run_id: r.run_id }
}

// ───────── 打包：生成新版本 → 执行节点拼接 ─────────
export async function pack(env: Env, u: User, pid: string) {
  const pf = await preflight(env, pid)
  if (!pf.can_pack) throw new HttpError(422, 'PREFLIGHT', '预检未通过：' + pf.blockers.join('；'), { checks: pf.checks })
  const busy: any = await env.DB.prepare(`SELECT id FROM st_releases WHERE project_id=? AND status='packing'`).bind(pid).first()
  if (busy) throw new HttpError(409, 'PACKING', '已有版本正在打包')
  const g = await gather(env, pid), meta = pf.meta
  const comp = await compliance(env, pid, g, meta, u)
  // 只有「阻断级」问题或高风险才拦截；警告写进快照，由审核人在第 10 步查看后决定是否发布
  const blocks = comp.issues.filter((i: any) => i.level === 'block')
  if (blocks.length || comp.risk === 'high') {
    await audit(env, u.id, 'release_compliance_block', pid, comp)
    throw new HttpError(422, 'COMPLIANCE', `合规审核未通过：${blocks.map((b: any) => b.msg).join('；') || comp.note || '高风险'}`, { compliance: comp })
  }
  const p = await project(env, pid), sid = await seriesIdOf(env, p)
  const vr: any = await env.DB.prepare('SELECT MAX(version) v FROM st_releases WHERE series_id=?').bind(sid).first()
  const pub: any = await env.DB.prepare('SELECT version FROM published_series WHERE id=?').bind(sid).first()
  const version = Math.max(vr?.v || 0, pub?.version || 0) + 1
  // 打包任务：每个片段 = 按顺序拼接的若干节点视频；角色头像 = 设定图裁切
  const segs = Object.values<C.SegPlan>(g.plan.segments).map((s) => ({ id: s.id, out: `${sid}/v${version}_${s.id}`, parts: s.parts.map((x) => ({ node: x.node, key: g.clip(x.node)!.media_key })) }))
  const cast = (g.u.bible?.cast || []).map((c: any, i: number) => ({ id: c.id, idx: i, key: g.slots.get(`6:cast.${c.id}`)?.status === 'ok' ? g.slots.get(`6:cast.${c.id}`).media_key : null, out: `${sid}/img/v${version}_c${i}.webp` }))
  const rid = uid('rel_'), jid = uid('job_')
  const req = { series_id: sid, version, segments: segs, cast, cover: { key: g.slots.get('6:cover').media_key, out: `${sid}/img/v${version}_cover.webp` } }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO st_releases (id,project_id,series_id,version,status,src_hash,plan,meta,checks,stats,job_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(rid, pid, sid, version, 'packing', pf.fingerprint, JSON.stringify({ nodes: g.plan.nodes, segments: g.plan.segments }), JSON.stringify(meta), JSON.stringify({ preflight: pf.checks, compliance: comp }), JSON.stringify(g.plan.stats), jid, u.id, now()),
    env.DB.prepare(`INSERT INTO st_jobs (id,project_id,step,slot,phase,route,status,req,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(jid, pid, 10, 'release:' + rid, 'pack', 'node', 'queued', JSON.stringify(req), 1, now(), now()),
    env.DB.prepare(`UPDATE st_steps SET status='running', updated_at=? WHERE project_id=? AND step=10`).bind(now(), pid)
  ])
  await audit(env, u.id, 'release_pack', pid, { release: rid, series: sid, version, risk: comp.risk })
  return { release: rid, series_id: sid, version, compliance: comp }
}

/** 执行节点回报打包结果 → 组装不可变的引擎 DATA */
export async function packDone(env: Env, j: any, b: any) {
  const rid = String(j.slot).replace(/^release:/, '')
  const rel: any = await env.DB.prepare('SELECT * FROM st_releases WHERE id=?').bind(rid).first()
  if (!rel || rel.status !== 'packing') return { ignored: true }
  if (!b.ok) {
    await env.DB.batch([env.DB.prepare(`UPDATE st_releases SET status='failed', error=? WHERE id=?`).bind(String(b.error || '打包失败').slice(0, 400), rid),
      env.DB.prepare(`UPDATE st_steps SET status='ready', updated_at=? WHERE project_id=? AND step=10 AND status='running'`).bind(now(), rel.project_id)])
    return { ok: true }
  }
  const pid = rel.project_id, plan = J(rel.plan), meta = J(rel.meta), u = await Media.upstream(env, pid)
  const p = await project(env, pid), out: any = b.segments || {}, castOut: any = b.cast || {}
  const segments: any = {}
  for (const s of Object.values<C.SegPlan>(plan.segments)) {
    const o = out[s.id]; if (!o) throw new HttpError(500, 'PACK_MISSING', `打包结果缺少片段 ${s.id}`)
    const lines = C.timeline(s.parts.map((x, i) => ({ dur: +(o.durs?.[i] || 8), lines: (u.scripts.get(x.node)?.beats || []).filter((bt: any) => bt.line && bt.line.replace(/[.。…\s]/g, '')).map((bt: any) => ({ speaker: nameOf(u, bt.who), text: String(bt.line).slice(0, 60) })) })))
    const last = s.parts[s.parts.length - 1], sc = u.scripts.get(last.node) || {}
    // 玩家端媒体约定：视频 R2 键 <sid>/<clip>.mp4 → video_url /static/<sid>/<clip>.mp4（播放时换成签名票据 /m/<sid>/<clip>.mp4）；图片 <sid>/img/<name> → /gimg/<sid>/<name>
    segments[s.id] = { title: s.title, meme: '', mood: sc.mood || '', image_url: gimg(rel.series_id, o.poster), video_url: `/static/${rel.series_id}/${base(o.key)}`, last_url: gimg(rel.series_id, o.last), dur: +(+o.dur).toFixed(2), lines, film: true, ambience: null, sfx: null, sfx_at: 0, src: s.parts.map((x) => x.node) }
  }
  const cast = Object.fromEntries((u.bible?.cast || []).map((c: any, i: number) => [c.name || c.id, { color: COLORS[i % COLORS.length], img: castOut[c.id] ? gimg(rel.series_id, castOut[c.id]) : gimg(rel.series_id, b.cover), side: i === 0 ? 'L' : 'R', brand: c.role || '' }]))
  const nodes = plan.nodes.map((n: any) => ({ ...n, options: n.options.map((o: any) => ({ ...o })) }))
  const data = { series: { id: rel.series_id, title: meta.title, logline: meta.logline, gated: true, generated: true, studio: { project: pid, release: rid, version: rel.version }, cat: u.brief?.format === 'anime' ? 'anime' : u.brief?.format === 'abstract' ? 'abstract' : 'live', genre: meta.genre || null, mech: { name: '押剧情', rule: '对每个抉择点下注：押中按赔率派彩（娱乐币，不可提现）' } }, prologue: plan.prologue || ['P'], nodes, segments, cast }
  const cover = gimg(rel.series_id, b.cover)
  const stats = { ...J(rel.stats, {}), seconds: Math.round(Object.values<any>(segments).reduce((a, s) => a + s.dur, 0)), bytes: b.bytes || null }
  await env.DB.batch([
    env.DB.prepare(`UPDATE st_releases SET status='ready', data=?, stats=?, error=NULL WHERE id=?`).bind(JSON.stringify({ ...data, cover }), JSON.stringify(stats), rid),
    env.DB.prepare(`UPDATE st_steps SET status='review', output=?, version=version+1, updated_at=? WHERE project_id=? AND step=10`).bind(JSON.stringify({ release: rid, version: rel.version, series_id: rel.series_id, src_hash: rel.src_hash, stats }), now(), pid)
  ])
  void p
  return { ok: true }
}
const base = (k: string) => String(k).split('/').pop()!
const gimg = (sid: string, k: string) => `/gimg/${sid}/${base(k)}`
const nameOf = (u: any, who: string) => { const c = (u.bible?.cast || []).find((x: any) => x.id === who || x.name === who); return c ? c.name || c.id : who }

// ───────── 发布 / 回滚 / 下架 ─────────
async function writeLive(env: Env, rel: any, by: string, action: string) {
  const data = J(rel.data), meta = J(rel.meta), cover = data.cover; delete data.cover
  await env.DB.prepare(`INSERT INTO published_series (id,project_id,cat,genre,title,logline,tags,cover,data,version,status,aud,rating,badge,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, cat=excluded.cat, genre=excluded.genre, title=excluded.title, logline=excluded.logline, tags=excluded.tags, cover=excluded.cover, data=excluded.data, version=excluded.version, status='live', aud=excluded.aud, rating=excluded.rating, badge=excluded.badge, updated_at=excluded.updated_at`)
    .bind(rel.series_id, rel.project_id, data.series.cat, meta.genre || null, meta.title, meta.logline, JSON.stringify(meta.tags?.length ? meta.tags : ['Studio 出品']), cover, JSON.stringify(data), rel.version, 'live', meta.aud, meta.rating, meta.badge, now(), now()).run()
  await env.DB.batch([
    env.DB.prepare(`UPDATE st_releases SET status='superseded' WHERE series_id=? AND status='published' AND id!=?`).bind(rel.series_id, rel.id),
    env.DB.prepare(`UPDATE st_releases SET status='published', published_by=?, published_at=? WHERE id=?`).bind(by, now(), rel.id),
    env.DB.prepare('INSERT INTO publish_log (series_id,project_id,action,version,actor,note,checks,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(rel.series_id, rel.project_id, action, rel.version, 'studio:' + by, `Studio 第 10 步 ${rel.id}`, rel.checks, now())
  ])
}
/** 审核通过第 10 步 = 发布最新 ready 版本（必须和当前上游指纹一致，防止发布过期快照） */
export async function publishLatest(env: Env, u: User, pid: string) {
  const rel: any = await env.DB.prepare(`SELECT * FROM st_releases WHERE project_id=? AND status='ready' ORDER BY created_at DESC LIMIT 1`).bind(pid).first()
  if (!rel) throw new HttpError(409, 'NO_RELEASE', '还没有打包完成的版本')
  const pf = await preflight(env, pid)
  if (pf.fingerprint !== rel.src_hash) throw new HttpError(409, 'RELEASE_STALE', '打包之后上游有改动（剧本 / 素材 / 上架信息），请重新打包')
  if (!pf.can_pack) throw new HttpError(422, 'PREFLIGHT', '预检未通过：' + pf.blockers.join('；'))
  await writeLive(env, rel, u.id, rel.version > 1 ? 'update' : 'publish')
  await audit(env, u.id, 'release_publish', pid, { release: rel.id, series: rel.series_id, version: rel.version })
  return { series_id: rel.series_id, version: rel.version, url: `/s/${rel.series_id}` }
}
export async function rollback(env: Env, u: User, pid: string, rid: string) {
  const rel: any = await env.DB.prepare(`SELECT * FROM st_releases WHERE id=? AND project_id=?`).bind(rid, pid).first()
  if (!rel || !rel.data || !['superseded', 'published', 'ready'].includes(rel.status)) throw new HttpError(409, 'BAD_RELEASE', '只能回滚到打包完成过的版本')
  await writeLive(env, rel, u.id, 'rollback')
  await audit(env, u.id, 'release_rollback', pid, { release: rid, version: rel.version })
  return { series_id: rel.series_id, version: rel.version }
}
export async function setLive(env: Env, u: User, pid: string, live: boolean, note = '') {
  const p = await project(env, pid); if (!p.series_id) throw new HttpError(409, 'NOT_PUBLISHED', '作品还没有上架')
  const r = await env.DB.prepare(`UPDATE published_series SET status=?, updated_at=? WHERE id=? AND project_id=?`).bind(live ? 'live' : 'offline', now(), p.series_id, pid).run()
  if (!r.meta.changes) throw new HttpError(409, 'NOT_PUBLISHED', '作品还没有上架')
  const v: any = await env.DB.prepare('SELECT version FROM published_series WHERE id=?').bind(p.series_id).first()
  await env.DB.prepare('INSERT INTO publish_log (series_id,project_id,action,version,actor,note,created_at) VALUES (?,?,?,?,?,?,?)').bind(p.series_id, pid, live ? 'restore' : 'takedown', v?.version, 'studio:' + u.id, note, now()).run()
  await audit(env, u.id, live ? 'release_restore' : 'release_takedown', pid, { note })
  return { series_id: p.series_id, status: live ? 'live' : 'offline' }
}
export async function cancel(env: Env, u: User, pid: string) {
  const rel: any = await env.DB.prepare(`SELECT * FROM st_releases WHERE project_id=? AND status='packing'`).bind(pid).first()
  if (!rel) throw new HttpError(409, 'NOT_PACKING', '没有进行中的打包')
  await env.DB.batch([env.DB.prepare(`UPDATE st_releases SET status='canceled' WHERE id=?`).bind(rel.id), env.DB.prepare(`UPDATE st_jobs SET status='canceled', updated_at=? WHERE id=? AND status IN ('queued','claimed')`).bind(now(), rel.job_id),
    env.DB.prepare(`UPDATE st_steps SET status='ready', updated_at=? WHERE project_id=? AND step=10 AND status='running'`).bind(now(), pid)])
  await audit(env, u.id, 'release_cancel', pid, { release: rel.id })
  return { ok: true }
}

/** 第 10 步看板：预检 + 版本历史 + 线上状态 + 最近上架日志 */
export async function board(env: Env, pid: string) {
  const pf = await preflight(env, pid)
  const rels = ((await env.DB.prepare(`SELECT id,series_id,version,status,src_hash,stats,meta,checks,error,created_at,created_by,published_at,published_by,job_id FROM st_releases WHERE project_id=? ORDER BY created_at DESC LIMIT 20`).bind(pid).all()).results as any[])
    .map((r) => ({ ...r, stats: J(r.stats, {}), meta: J(r.meta, {}), compliance: J(r.checks, {})?.compliance || null, checks: undefined, up_to_date: r.src_hash === pf.fingerprint }))
  const packing = rels.find((r) => r.status === 'packing')
  const job: any = packing ? await env.DB.prepare('SELECT status, claimed_by, error, updated_at FROM st_jobs WHERE id=?').bind(packing.job_id).first() : null
  const sid = pf.live?.series_id || rels[0]?.series_id
  const logs = sid ? (await env.DB.prepare('SELECT action, version, actor, note, created_at FROM publish_log WHERE series_id=? ORDER BY created_at DESC LIMIT 15').bind(sid).all()).results : []
  return { ...pf, releases: rels, packing: packing ? { ...packing, job } : null, logs, options: { auds: AUDS, ratings: RATINGS, badges: BADGES, genres: GENRES } }
}

/** 第 10 步闸门：必须有「已发布且与当前上游一致」的版本才算完成 */
export async function gate(env: Env, pid: string) {
  const r: any = await env.DB.prepare(`SELECT * FROM st_releases WHERE project_id=? AND status IN ('ready','published') ORDER BY created_at DESC LIMIT 1`).bind(pid).first()
  if (!r) throw new HttpError(422, 'NO_RELEASE', '请先「打包新版本」')
  const pf = await preflight(env, pid)
  if (pf.fingerprint !== r.src_hash) throw new HttpError(409, 'RELEASE_STALE', '打包之后上游有改动，请重新打包')
  return { release: r.id, version: r.version, series_id: r.series_id, src_hash: r.src_hash, stats: J(r.stats, {}) }
}
