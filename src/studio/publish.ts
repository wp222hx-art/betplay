// 上架中心：统一的「提交上线」入口 —— 预检（素材真实 / 剧情树可玩 / 媒体可播 / 元数据齐全）→ 上架 / 更新版本 → 下架 / 恢复 → 审计日志
// 导演台产出的作品、以及目录里“即将上线”的概念作品，都从这里进入发现页与 /s/:id 播放器。
import * as Tax from '../catalog/taxonomy'
import { GameError } from '../core/engine'
import type { Bindings } from '../gateway/llm'
import { publish as assemble } from './director'
import { validateTree } from './pipeline'

type Env = Bindings & { MEDIA?: any }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
export const AUDS = ['all', 'female', 'male'] as const
export const RATINGS = ['all', '12', '16', '18'] as const
export const BADGES = ['新作', '热播', '爆款', '独家', '限免', '完结']

async function log(env: Env, a: { series_id?: string | null; project_id?: string | null; action: string; version?: number | null; actor?: string; note?: string; checks?: any }) {
  await env.DB.prepare('INSERT INTO publish_log (series_id,project_id,action,version,actor,note,checks,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(a.series_id || null, a.project_id || null, a.action, a.version ?? null, a.actor || 'admin', a.note || '', a.checks ? JSON.stringify(a.checks) : null, now()).run()
}

/** 可玩性：剔除没有成片的选项后，剧情树是否仍然完整（每个节点 ≥2 选项、至少 4 个结局可达、根节点可进入） */
export function prunePlayable(tree: any, ready: Set<string>) {
  const dropped: string[] = []
  let nodes = (tree.nodes || []).map((n: any) => ({ ...n, options: (n.options || []).filter((o: any) => { const ok = ready.has(o.id); if (!ok) dropped.push(o.id); return ok }) }))
  // 迭代：节点剩 <2 个选项 → 整个节点不可玩 → 指向它的选项降级为“结局”不合理，直接删除
  for (let k = 0; k < 6; k++) {
    const dead = new Set(nodes.filter((n: any) => n.options.length < 2).map((n: any) => n.id))
    if (!dead.size) break
    nodes = nodes.filter((n: any) => !dead.has(n.id)).map((n: any) => ({ ...n, fork: n.fork && dead.has(n.fork.node) ? undefined : n.fork, options: n.options.filter((o: any) => { const bad = o.next && dead.has(o.next); if (bad) dropped.push(o.id); return !bad }) }))
  }
  // 每个节点至少保留 1 个常规（非隐藏）选项；隐藏支权重不变，常规权重重新归一
  for (const n of nodes) { const reg = n.options.filter((o: any) => !o.twist), sum = reg.reduce((a: number, o: any) => a + (+o.weight || 1), 0); reg.forEach((o: any) => (o.weight = Math.round(((+o.weight || 1) / sum) * 100) / 100)) }
  return { tree: { ...tree, nodes }, dropped: [...new Set(dropped)] }
}

/** 预检：返回逐项检查结果；blockers 为空才允许上架 */
export async function preflight(env: Env, projectId: string) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  if (!pj) throw new GameError('NOT_FOUND', '项目不存在')
  const jobs = (await env.DB.prepare(`SELECT clip_id, kind, status, result_url, meta, softened FROM render_jobs WHERE project_id=?`).bind(projectId).all()).results as any[]
  const tree = J(pj.tree, {}), bible = J(pj.bible, {})
  const clips = jobs.filter((j) => j.kind === 'clip')
  const checks: { key: string; ok: boolean; level: 'block' | 'warn'; msg: string }[] = []
  const add = (key: string, ok: boolean, level: 'block' | 'warn', msg: string) => checks.push({ key, ok, level, msg })

  const dry = clips.filter((j) => String(j.result_url || '').startsWith('dry://'))
  add('real_media', !dry.length && clips.length > 0, 'block', dry.length ? `${dry.length}/${clips.length} 个片段是空跑(dry)占位，没有真实视频 —— 需要真实开拍` : clips.length ? '全部片段为真实生成' : '还没有开拍')
  const ok = new Set(clips.filter((j) => j.status === 'approved' && !String(j.result_url || '').startsWith('dry://')).map((j) => j.clip_id))
  const pending = clips.filter((j) => ['queued', 'running', 'review'].includes(j.status))
  const failed = clips.filter((j) => j.status === 'failed')
  add('render_done', !pending.length, 'block', pending.length ? `${pending.length} 个片段仍在生成/待审核：${pending.map((j) => j.clip_id).join(', ')}` : '无进行中的片段')
  add('prologue', ok.has('P'), 'block', ok.has('P') ? '序章已就绪' : '序章 P 没有成片，无法开局')

  const pr = prunePlayable(tree, ok)
  const v = validateTree(pr.tree)
  const root = pr.tree.nodes.find((n: any) => n.depth === 1)
  add('root', !!root, 'block', root ? `首个抉择点「${root.question}」有 ${root.options.length} 个选项` : '首个抉择点可用选项不足 2 个')
  add('endings', v.endings >= 3, 'block', `可达结局 ${v.endings} 个${v.endings < 3 ? '（至少需要 3 个）' : ''}`)
  add('tree_errors', v.ok, 'block', v.ok ? '剧情树结构校验通过' : v.errors.slice(0, 3).join('；'))
  if (!dry.length) add('complete', !failed.length && !pr.dropped.length, 'warn', failed.length || pr.dropped.length ? `将以“精简版”上架：${failed.length} 个片段失败，剧情树裁掉 ${pr.dropped.length} 个分支（${pr.dropped.join(', ')}）；可先点“失败片段重拍”` : '完整版：全部分支可玩')
  const likeness = failed.filter((j) => /copyright/i.test(String(J(j.meta, {})?.error || '')))
  if (likeness.length) add('likeness', false, 'warn', `${likeness.length} 个片段因“肖像/版权”被视频模型拒绝（${likeness.map((j) => j.clip_id).join(', ')}）：角色设定图疑似撞脸真人明星，改写提示词无效 —— 需要重做设定图（原创面孔）后重拍`)
  add('forks', v.forks > 0 || !tree.nodes?.some((n: any) => n.fork), 'warn', v.forks ? `时间裂隙 ${v.forks} 处` : '无时间裂隙')
  const bonus = ['gold', 'platinum', 'diamond'].filter((t) => ok.has('BONUS_' + t))
  add('bonus', bonus.length === 3, 'warn', `命运彩蛋 ${bonus.length}/3（${bonus.join('/') || '无'}）${bonus.length < 3 ? '，缺失档位押中时不播放彩蛋' : ''}`)
  add('cover', !!pj.cover_url, 'block', pj.cover_url ? '封面已生成' : '缺少封面')
  add('cast', !!pj.cast_imgs && Object.keys(J(pj.cast_imgs, {})).length >= (bible.cast || []).length, 'warn', pj.cast_imgs ? '角色立绘已裁切' : '缺少角色立绘（播放器用封面代替）')
  // 媒体可播：抽查 R2 里序章视频真实存在
  const sid = pj.series_id || 'gen_' + projectId.slice(4, 12)
  if (env.MEDIA) { const h = await env.MEDIA.head(`${sid}/P.mp4`); add('r2', !!h, 'block', h ? `R2 媒体就绪（序章 ${(h.size / 1e6).toFixed(1)}MB）` : `R2 中找不到 ${sid}/P.mp4`) }
  const blockers = checks.filter((c) => !c.ok && c.level === 'block')
  return { project_id: projectId, series_id: sid, title: pj.title, cat: Tax.fmt(pj.cat), status: pj.status, can_publish: !blockers.length, blockers: blockers.map((b) => b.msg), checks, playable: { nodes: v.nodes, endings: v.endings, forks: v.forks, clips: ok.size, dropped: pr.dropped, bonus }, failed: failed.map((j) => ({ clip: j.clip_id, error: J(j.meta, {})?.error || '', softened: j.softened || 0 })) }
}

/** 提交上线：预检通过 → 组装（按可玩子树裁剪）→ 写入 published_series（新版本）→ 目录联动 → 审计 */
export async function submit(env: Env, projectId: string, meta: { title?: string; logline?: string; genre?: string; aud?: string; rating?: string; badge?: string; tags?: string[]; source_item?: string; note?: string; actor?: string } = {}) {
  const pf = await preflight(env, projectId)
  if (!pf.can_publish) throw new GameError('PREFLIGHT', '预检未通过：' + pf.blockers.join('；'))
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  // 元数据先落到项目上（组装时读取）
  if (meta.title || meta.logline || meta.genre || meta.source_item !== undefined) await env.DB.prepare('UPDATE studio_projects SET title=COALESCE(?,title), logline=COALESCE(?,logline), genre=COALESCE(?,genre), source_item=COALESCE(?,source_item), updated_at=? WHERE id=?')
    .bind(meta.title || null, meta.logline || null, meta.genre || null, meta.source_item || null, now(), projectId).run()
  // 把未成片的分支从树里裁掉后再组装（assemble 只接受全部 approved，这里临时让它看到裁剪后的树）
  const jobs = (await env.DB.prepare(`SELECT clip_id FROM render_jobs WHERE project_id=? AND kind='clip' AND status='approved'`).bind(projectId).all()).results as any[]
  const pr = prunePlayable(J(pj.tree, {}), new Set(jobs.map((j) => j.clip_id)))
  const r = await assemble(env, projectId, { tree: pr.tree, onlyApproved: true })
  const aud = AUDS.includes(meta.aud as any) ? meta.aud : 'all', rating = RATINGS.includes(meta.rating as any) ? meta.rating : '16'
  const tags = meta.tags?.length ? meta.tags : null
  await env.DB.prepare(`UPDATE published_series SET status='live', aud=?, rating=?, badge=?, source_item=?, tags=COALESCE(?,tags), updated_at=? WHERE id=?`)
    .bind(aud, rating, meta.badge || '新作', meta.source_item || pj.source_item || null, tags ? JSON.stringify(tags) : null, now(), r.series_id).run()
  const row: any = await env.DB.prepare('SELECT version FROM published_series WHERE id=?').bind(r.series_id).first()
  await log(env, { series_id: r.series_id, project_id: projectId, action: pj.status === 'published' ? 'update' : 'publish', version: row?.version, actor: meta.actor, note: meta.note || (pr.dropped.length ? `精简版：裁掉 ${pr.dropped.join(',')}` : '完整版'), checks: pf.checks })
  return { ...r, version: row?.version, dropped: pr.dropped, playable: pf.playable }
}

export async function setLive(env: Env, sid: string, live: boolean, note = '', actor = 'admin') {
  const r: any = await env.DB.prepare('SELECT project_id, version, status FROM published_series WHERE id=?').bind(sid).first()
  if (!r) throw new GameError('NOT_FOUND', '作品未上架过')
  await env.DB.prepare('UPDATE published_series SET status=?, updated_at=? WHERE id=?').bind(live ? 'live' : 'offline', now(), sid).run()
  await log(env, { series_id: sid, project_id: r.project_id, action: live ? 'restore' : 'takedown', version: r.version, actor, note })
  return { series_id: sid, status: live ? 'live' : 'offline' }
}

export async function updateMeta(env: Env, sid: string, m: any) {
  const r: any = await env.DB.prepare('SELECT * FROM published_series WHERE id=?').bind(sid).first()
  if (!r) throw new GameError('NOT_FOUND', '作品未上架过')
  const data = J(r.data, {})
  if (m.title) data.series.title = m.title
  if (m.logline) data.series.logline = m.logline
  if (m.genre) data.series.genre = m.genre
  await env.DB.prepare(`UPDATE published_series SET title=COALESCE(?,title), logline=COALESCE(?,logline), genre=COALESCE(?,genre), aud=COALESCE(?,aud), rating=COALESCE(?,rating), badge=COALESCE(?,badge), tags=COALESCE(?,tags), source_item=?, data=?, version=version+1, updated_at=? WHERE id=?`)
    .bind(m.title || null, m.logline || null, m.genre || null, AUDS.includes(m.aud) ? m.aud : null, RATINGS.includes(m.rating) ? m.rating : null, m.badge || null, m.tags?.length ? JSON.stringify(m.tags) : null, m.source_item === undefined ? r.source_item : (m.source_item || null), JSON.stringify(data), now(), sid).run()
  await log(env, { series_id: sid, project_id: r.project_id, action: 'meta', version: r.version + 1, actor: m.actor, note: Object.keys(m).filter((k) => k !== 'actor').join(',') })
  return { series_id: sid, version: r.version + 1 }
}

/** 上架中心看板：待上架（成片项目）/ 已上架 / 已下架 + 最近审计 */
export async function board(env: Env) {
  const prj = (await env.DB.prepare(`SELECT p.id, p.title, p.cat, p.genre, p.status, p.scale, p.spent, p.series_id, p.cover_url, p.source_item, p.logline, p.updated_at,
      SUM(j.kind='clip') clips, SUM(j.kind='clip' AND j.status='approved' AND j.result_url NOT LIKE 'dry://%') ready, SUM(j.kind='clip' AND j.status='failed') failed,
      SUM(j.kind='clip' AND j.status IN ('queued','running','review')) pending, SUM(j.result_url LIKE 'dry://%') dry
    FROM studio_projects p JOIN render_jobs j ON j.project_id=p.id WHERE p.status!='archived' GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 40`).all()).results as any[]
  const pub = (await env.DB.prepare(`SELECT p.id, p.project_id, p.cat, p.genre, p.title, p.logline, p.cover, p.status, p.version, p.aud, p.rating, p.badge, p.tags, p.source_item, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM comic_runs r WHERE r.series_id=p.id) plays FROM published_series p ORDER BY p.updated_at DESC`).all()).results as any[]
  const logs = (await env.DB.prepare('SELECT * FROM publish_log ORDER BY created_at DESC LIMIT 30').all()).results
  const pubBy = Object.fromEntries(pub.map((p) => [p.project_id, p]))
  return {
    queue: prj.filter((p) => !pubBy[p.id] || pubBy[p.id].status !== 'live').map((p) => ({ ...p, published: pubBy[p.id] || null })),
    live: pub.filter((p) => p.status === 'live').map((p) => ({ ...p, tags: J(p.tags, []) })),
    offline: pub.filter((p) => p.status !== 'live').map((p) => ({ ...p, tags: J(p.tags, []) })),
    logs, genres: Tax.GENRES, formats: Tax.FORMATS, auds: AUDS, ratings: RATINGS, badges: BADGES
  }
}
