import * as Tax from '../catalog/taxonomy'
// 后台指挥：一句主题 → 可生产剧本（自动植入博弈抉择 / 隐藏支 / 时间裂隙）→ 预算 → 资产+片段任务 → 自动质检审核 → 自动上架
// 视频生成由外部 worker（沙箱里的 gsk CLI：Seedance 2.0 音画一体）执行；本模块只做编排、积分核算与发布。
import { uid } from '../core/crypto'
import { GameError } from '../core/engine'
import { callCapability, type Bindings } from '../gateway/llm'
import { repairTree, validateTree } from './pipeline'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

// 积分价目（实测：Seedance 2.0 mini 12s ≈ 1000，10s ≈ 850；nano-banana-pro 图 ≈ 88）
export const PRICE = { clip: (dur: number) => Math.round(dur * 85), sheet: 90, cover: 90 }
// 规模档：抉择层数 × 分支数 → 片段数 / 结局数
export const SCALES: Record<string, { name: string; routes: number; ends: number; forkEnds: number; desc: string }> = {
  pilot: { name: '试播集', routes: 2, ends: 2, forkEnds: 0, desc: '序章 + 2 路线 + 每线 2 结局（含隐藏支），约 7 段' },
  standard: { name: '标准剧', routes: 3, ends: 3, forkEnds: 2, desc: '序章 + 3 路线 + 每线 3 结局 + 时间裂隙 2 结局，约 16 段' },
  epic: { name: '长篇', routes: 4, ends: 4, forkEnds: 3, desc: '序章 + 4 路线 + 每线 4 结局 + 裂隙 3 结局，约 26 段' }
}

export function estimate(scale: string) {
  const s = SCALES[scale] || SCALES.standard
  // 路线：routes 常规 + 1 隐藏（隐藏路线复用第一条路线的结局节点）；每条常规路线 ends-1 常规 + 1 隐藏结局
  const routeClips = s.routes + 1
  const endClips = s.routes * s.ends
  const forkClips = s.forkEnds ? 1 + s.forkEnds : 0
  const clips12 = 1 + routeClips + (s.forkEnds ? 1 : 0), clips10 = endClips + s.forkEnds + 3
  return { scale: s.name, clips: clips12 + clips10, bonus: 3, endings: endClips + s.forkEnds, nodes: 1 + s.routes + (s.forkEnds ? 1 : 0), credits: clips12 * PRICE.clip(12) + clips10 * PRICE.clip(10) + PRICE.sheet + PRICE.cover }
}


const SYS = (s: typeof SCALES[string]) => `你是互动博弈剧总编剧 + 分镜导演。输出严格 JSON，不要多余文字：
{"title":"爆款中文片名(≤10字)","cast":[{"id":"英文名","name":"中文名","look":"英文外貌服装描述(发型/发色/服装/配饰，便于AI保持一致)","role":"一句中文人设","side":"L或R"}],
 "setting":"英文场景总述",
 "prologue":{"title":"中文","shots":[{"desc":"英文镜头描述","speaker":"英文id或空","line":"中文台词或空","sfx":"英文音效"}]},
 "routes":[{"label":"中文选项(≤8字)","hint":"中文钩子(≤12字)","title":"中文片段名","shots":[...],
    "endings":[{"label":"中文选项","hint":"中文钩子","title":"中文结局名","tone":"love|sacrifice|betrayal|risk|twist","shots":[...]}]}],
 "hidden_route":{"label":"中文","hint":"中文","title":"中文","shots":[...]},
 "q1":"第一抉择的中文问题","q2":["每条路线第二抉择的中文问题"],
 "fork":${s.forkEnds ? '{"title":"中文","shots":[...],"question":"中文","endings":[同endings结构]}' : 'null'},
 "bonus":{"gold":{"title":"中文","shots":[...]},"platinum":{...},"diamond":{...}}}
硬性规则：cast 3~4 人（含男/女主角视角人物）；routes 恰好 ${s.routes} 条；每条 endings 恰好 ${s.ends} 个，其中最后一个是反转的隐藏结局(tone=twist)；${s.forkEnds ? `fork.endings 恰好 ${s.forkEnds} 个（平行时间线里改写命运）；` : ''}
bonus 是“命运等级彩蛋”：只有下注够大且押得准的玩家才能看到——gold=心动/高光加长、platinum=隐藏真相揭露、diamond=最震撼的终极彩蛋（尺度最大、最华丽），越高级越惊艳；
每段 shots 4~6 个镜头，至少 2 句台词，台词口语化、有冲突、有钩子，每句 ≤ 22 字；镜头描述写清人物动作/表情/机位/光线；标题要有爆款感。`

function shotsText(shots: any[], castMap: Record<string, any>) {
  return (shots || []).slice(0, 6).map((s: any, i: number) => {
    const who = castMap[s.speaker]
    const line = s.line ? ` ${who ? who.id : 'The character'} says in Mandarin Chinese: {${String(s.line).replace(/[{}]/g, '')}}` : ''
    return `Shot ${i + 1}: ${s.desc || ''}${line}${s.sfx ? ` <${s.sfx}>` : ''}`
  }).join('\n')
}
function linesOf(shots: any[], castMap: Record<string, any>) {
  return (shots || []).filter((s: any) => s.line).map((s: any) => ({ speaker: castMap[s.speaker]?.name || s.speaker || '旁白', text: String(s.line) }))
}

/** 把 LLM 大纲转成引擎树 + 每段完整 Seedance 提示词 */
export function compile(out: any, cat: string, scaleKey: string) {
  const sc = SCALES[scaleKey] || SCALES.standard
  const cast = (out.cast || []).slice(0, 4).map((c: any, i: number) => ({ id: String(c.id || 'C' + i).replace(/[^A-Za-z]/g, '') || 'C' + i, name: c.name || c.id, look: c.look || '', role: c.role || '', side: c.side === 'R' ? 'R' : 'L' }))
  const castMap: Record<string, any> = Object.fromEntries(cast.flatMap((c: any) => [[c.id, c], [c.name, c]]))
  const defs = cast.map((c: any, i: number) => `Define the character #${i + 1} from left in @Image1 (${c.look}) as ${c.id}.`).join(' ')
  const head = `@Image1 is the character sheet, use appearance only. ${defs}\nStyle: ${Tax.STYLE[Tax.fmt(cat)]}. Setting: ${out.setting || ''}. Dialogue language: Mandarin Chinese (Putonghua).`
  const tail = 'Faces stable and undeformed, consistent hairstyle and costume for every character, natural proportions, no morphing, no subtitles, no on-screen text, no logo, no watermark.'
  const clips: Record<string, any> = {}
  const add = (id: string, seg: any, dur: number) => { clips[id] = { title: seg.title || id, meme: seg.meme || '', dur, shots: `${head}\n${shotsText(seg.shots, castMap)}\n${tail}`, lines: linesOf(seg.shots, castMap) } }
  add('P', out.prologue || { title: '序章' }, 12)
  const routes = (out.routes || []).slice(0, sc.routes)
  const nodes: any[] = [{ id: 'N1', depth: 1, question: out.q1 || '命运的第一个抉择', options: [] }]
  const fk = sc.forkEnds && out.fork ? { node: 'N_K', seg: 'K_1', label: '时间裂隙', desc: '不回到原局面——撕开一条平行时间线' } : null
  routes.forEach((r: any, i: number) => {
    const rid = `R_${i + 1}`, nid = `N_${i + 1}`
    nodes[0].options.push({ id: rid, key: 'ABCD'[i], label: r.label, hint: r.hint || '', weight: +(1 / routes.length).toFixed(2), category: 'love', next: nid })
    add(rid, r, 12)
    const ends = (r.endings || []).slice(0, sc.ends)
    const n: any = { id: nid, depth: 2, question: (out.q2 || [])[i] || `${r.label}：结局会是？`, options: [] }
    ends.forEach((e: any, j: number) => {
      const eid = `E_${i + 1}${j + 1}`, twist = j === ends.length - 1
      n.options.push({ id: eid, key: twist ? 'T' : 'ABC'[j], label: e.label, hint: e.hint || '', weight: twist ? 0.25 : +(1 / Math.max(1, ends.length - 1)).toFixed(2), category: e.tone || 'love', twist, ending_title: e.title })
      add(eid, e, 10)
    })
    if (fk) n.fork = fk
    nodes.push(n)
  })
  if (out.hidden_route) {
    nodes[0].options.push({ id: 'R_T', key: 'T', label: out.hidden_route.label, hint: out.hidden_route.hint || '悔棋才会出现', weight: 0.25, category: 'risk', twist: true, next: 'N_1' })
    add('R_T', out.hidden_route, 12)
  }
  if (fk) {
    add('K_1', { title: out.fork.title || '时间裂隙', shots: out.fork.shots }, 12)
    const fe0 = out.fork.endings || [], fe = [...fe0.filter((e: any) => !e.twist).slice(0, sc.forkEnds), ...fe0.filter((e: any) => e.twist).slice(0, 1)]
    nodes.push({ id: 'N_K', depth: 3, question: out.fork.question || '平行时间线：你要改写什么？', options: fe.map((e: any, j: number) => { add(`E_K${j + 1}`, e, 10); return { id: `E_K${j + 1}`, key: 'ABCD'[j], label: e.label, hint: e.hint || '', weight: +(1 / fe.length).toFixed(2), category: e.tone || 'love', ending_title: e.title, ...(e.twist ? { twist: true, key: 'T' } : {}) } }) })
  }
  for (const t of ['gold', 'platinum', 'diamond']) if (out.bonus?.[t]) add(`BONUS_${t}`, { title: out.bonus[t].title || t, shots: out.bonus[t].shots }, 10)
  const sheetPrompt = `Character reference sheet, ${Tax.SHEET_STYLE[Tax.fmt(cat)]}, ${cast.length} characters standing side by side left to right on a clean light background, full body plus face close-up, consistent lighting, labeled by position only, no text. ` + cast.map((c: any, i: number) => `#${i + 1}: ${c.look}.`).join(' ')
  return { cast, nodes, clips, sheetPrompt }
}

export async function direct(env: Bindings, p: { theme: string; cat: string; genre?: string; scale: string; budget?: number; auto?: boolean; item_id?: string; title?: string; logline?: string; tags?: string[]; outline?: any; mech?: any }) {
  const sc = SCALES[p.scale] || SCALES.standard
  const est = estimate(p.scale)
  if (p.budget && p.budget < est.credits) throw new GameError('BUDGET', `预算 ${p.budget} 不足，${sc.name} 预计需要 ${est.credits} 积分`)
  const prompt = `主题：${p.theme}\n类型：${Tax.brief(p.cat, p.genre)}${p.title ? `\n片名：${p.title}` : ''}${p.logline ? `\n梗概：${p.logline}` : ''}\n请输出完整剧本 JSON。`
  // 导演自带剧本（人工精修 / 外部编剧）→ 跳过 LLM，直接编译校验
  const r: any = p.outline ? { ok: true, data: p.outline, model: 'director-manual' } : await callCapability(env, { capability: 'outline', tier: 'standard', json: true, system: SYS(sc), prompt, agent: 7, timeoutMs: 110000, fallback: () => null })
  if (!r?.ok || !r.data?.routes?.length) throw new GameError('LLM_FAILED', '编剧模型超时或输出无效，请重试')
  const c = compile(r.data, p.cat, p.scale)
  const rep = repairTree({ nodes: c.nodes, clips: c.clips })
  const v = validateTree(rep.tree)
  const id = uid('prj_')
  const title = p.title || r.data.title || p.theme.split(/[，,。]/)[0].slice(0, 12)
  await env.DB.prepare(`INSERT INTO studio_projects (id,kind,source_item,cat,genre,title,logline,status,bible,tree,score,scale,budget,auto,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, 'series', p.item_id || null, Tax.fmt(p.cat), p.genre || Tax.guessGenre(p.theme + (p.tags || []).join(''), Tax.fmt(p.cat)), title, p.logline || p.theme, 'scripted', JSON.stringify({ cast: c.cast, sheet_prompt: c.sheetPrompt, setting: r.data.setting, mech: p.mech || r.data.mech || null }), JSON.stringify(rep.tree), v.ok ? 1 : 0, p.scale, p.budget || 0, p.auto ? 1 : 0, now(), now()).run()
  return { id, title, model: r.model, validation: v, fixes: rep.fixes, estimate: est, cast: c.cast }
}

/** 开拍：先入“设定图 + 封面”资产任务，片段任务依赖设定图（worker 按 kind 顺序领取） */
export async function greenlight(env: Bindings, projectId: string) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  if (!pj) throw new GameError('NOT_FOUND', '项目不存在')
  const tree = J(pj.tree, {}), v = validateTree(tree), bible = J(pj.bible, {})
  if (!v.ok) throw new GameError('INVALID_TREE', '剧本树未通过校验')
  const est = Object.values<any>(tree.clips).reduce((a, c) => a + PRICE.clip(c.dur || 10), 0) + PRICE.sheet + PRICE.cover
  if (pj.budget && est > pj.budget) throw new GameError('BUDGET', `预计 ${est} 积分，超出预算 ${pj.budget}`)
  const st: any[] = []
  const ins = (clip: string, kind: string, title: string, prompt: string, dur: number, credits: number, lines: any = null) =>
    st.push(env.DB.prepare(`INSERT OR IGNORE INTO render_jobs (id,project_id,clip_id,kind,title,prompt,lines,dur,credits,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(uid('job_'), projectId, clip, kind, title, prompt, lines ? JSON.stringify(lines) : null, dur, credits, 'queued', now(), now()))
  ins('_sheet', 'sheet', '角色设定图', bible.sheet_prompt || '', 0, PRICE.sheet)
  ins('_cover', 'cover', '上架封面', `Vertical 3:4 streaming drama key-visual poster for "${pj.title}": ${pj.logline}. ${Tax.COVER_STYLE[Tax.fmt(pj.cat)]}, no text, no watermark.`, 0, PRICE.cover)
  for (const [cid, c] of Object.entries<any>(tree.clips)) ins(cid, 'clip', c.title || cid, c.shots || '', c.dur || 10, PRICE.clip(c.dur || 10), c.lines)
  await env.DB.batch(st)
  await env.DB.prepare(`UPDATE studio_projects SET status='rendering', updated_at=? WHERE id=?`).bind(now(), projectId).run()
  return { queued: st.length, est_credits: est }
}

/** worker 认领：资产优先；片段任务要等设定图完成；超预算自动暂停 */
export async function claim(env: Bindings, worker: string, balance?: number) {
  await env.DB.prepare('INSERT OR REPLACE INTO worker_heartbeat (worker,balance,running,seen_at) VALUES (?,?,?,?)').bind(worker, balance ?? null, null, now()).run()
  // 超时回收：running 超过 30 分钟视为 worker 崩溃，重新排队
  await env.DB.prepare(`UPDATE render_jobs SET status='queued', worker=NULL WHERE status='running' AND updated_at<?`).bind(now() - 30 * 60000).run()
  const rows = (await env.DB.prepare(`SELECT j.id, j.kind, j.credits, p.sheet_url, p.budget, p.spent FROM render_jobs j JOIN studio_projects p ON p.id=j.project_id
    WHERE j.status='queued' AND p.status='rendering' ORDER BY CASE j.kind WHEN 'sheet' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END, j.created_at LIMIT 20`).all()).results as any[]
  const j = rows.find((x) => (x.kind !== 'clip' || x.sheet_url) && (!x.budget || x.spent + x.credits <= x.budget) && (balance == null || balance > x.credits + 200))
  if (!j) return null
  const r = await env.DB.prepare(`UPDATE render_jobs SET status='running', worker=?, attempts=attempts+1, updated_at=? WHERE id=? AND status='queued'`).bind(worker, now(), j.id).run()
  if (!r.meta.changes) return null
  const job: any = await env.DB.prepare('SELECT j.*, p.sheet_url, p.cat, p.series_id FROM render_jobs j JOIN studio_projects p ON p.id=j.project_id WHERE j.id=?').bind(j.id).first()
  await env.DB.prepare('UPDATE worker_heartbeat SET running=? WHERE worker=?').bind(job.clip_id, worker).run()
  return { ...job, lines: J(job.lines, []) }
}

/** worker 回报：记实际消耗；资产写回项目；auto 项目质检通过即自动审核；全部通过自动上架 */
export async function report(env: Bindings, p: { id: string; ok: boolean; url?: string; spent?: number; meta?: any; qc?: any }) {
  const j: any = await env.DB.prepare('SELECT * FROM render_jobs WHERE id=?').bind(p.id).first()
  if (!j) throw new GameError('NOT_FOUND', '任务不存在')
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(j.project_id).first()
  const spent = Math.round(p.spent ?? (p.ok ? j.credits : 0))
  const pass = p.ok && (p.qc?.pass !== false)
  const status = !p.ok ? (j.attempts >= 2 ? 'failed' : 'queued') : j.kind !== 'clip' || (pj.auto && pass) ? 'approved' : 'review'
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status=?, result_url=?, meta=?, qc=?, spent=spent+?, worker=CASE WHEN ?='queued' THEN NULL ELSE worker END, updated_at=? WHERE id=?`).bind(status, p.url || null, JSON.stringify(p.meta || {}), JSON.stringify(p.qc || {}), spent, status, now(), p.id),
    env.DB.prepare('UPDATE studio_projects SET spent=spent+?, updated_at=? WHERE id=?').bind(spent, now(), j.project_id),
    env.DB.prepare('INSERT INTO credit_ledger (project_id,job_id,kind,credits,note,created_at) VALUES (?,?,?,?,?,?)').bind(j.project_id, p.id, j.kind, spent, `${j.clip_id} ${p.ok ? 'ok' : 'fail'}`, now())
  ])
  if (p.ok && j.kind === 'sheet') await env.DB.prepare('UPDATE studio_projects SET sheet_url=?, cast_imgs=? WHERE id=?').bind(p.url, JSON.stringify(p.meta?.cast || {}), j.project_id).run()
  if (p.ok && j.kind === 'cover') await env.DB.prepare('UPDATE studio_projects SET cover_url=? WHERE id=?').bind(p.meta?.public_url || p.url, j.project_id).run()
  return progress(env, j.project_id)
}

export async function review(env: Bindings, jobId: string, approve: boolean) {
  const j: any = await env.DB.prepare('SELECT project_id FROM render_jobs WHERE id=?').bind(jobId).first()
  await env.DB.prepare(`UPDATE render_jobs SET status=?, updated_at=? WHERE id=?`).bind(approve ? 'approved' : 'queued', now(), jobId).run()
  return progress(env, j.project_id)
}

export async function progress(env: Bindings, projectId: string) {
  const s: any = await env.DB.prepare(`SELECT COUNT(*) n, SUM(status='approved') ok, SUM(status='failed') bad, SUM(status IN ('review','approved')) done, SUM(spent) spent FROM render_jobs WHERE project_id=?`).bind(projectId).first()
  const pj: any = await env.DB.prepare('SELECT status, auto FROM studio_projects WHERE id=?').bind(projectId).first()
  let status = pj.status
  if (status !== 'published' && s.n && s.ok === s.n) status = 'review'
  if (status === 'rendering' && s.n && s.ok === s.n) status = 'review'
  if (status !== pj.status) await env.DB.prepare('UPDATE studio_projects SET status=?, updated_at=? WHERE id=?').bind(status, now(), projectId).run()
  let published = null
  if (status === 'review' && pj.auto) published = await publish(env, projectId)
  return { project: projectId, total: s.n, done: s.done || 0, approved: s.ok || 0, failed: s.bad || 0, spent: s.spent || 0, status: published ? 'published' : status, published }
}

/** 上架：把审核通过的片段组装成引擎 DATA，写入 published_series；发现页与 /s/:id 播放器即时可玩 */
export async function publish(env: Bindings, projectId: string) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  const jobs = (await env.DB.prepare(`SELECT * FROM render_jobs WHERE project_id=? AND kind='clip'`).bind(projectId).all()).results as any[]
  if (jobs.some((j) => j.status !== 'approved')) throw new GameError('NOT_READY', '还有片段未审核通过')
  const tree = J(pj.tree, {}), bible = J(pj.bible, {}), imgs = J(pj.cast_imgs, {})
  const sid = pj.series_id || 'gen_' + projectId.slice(4, 12)
  const segments: any = {}
  for (const j of jobs) {
    const m = J(j.meta, {})
    segments[j.clip_id] = { title: j.title, meme: tree.clips?.[j.clip_id]?.meme || '', mood: '', image_url: m.poster || pj.cover_url, video_url: `/static/${sid}/${j.clip_id}.mp4`, last_url: m.last || m.poster, dur: m.dur || j.dur, lines: m.lines || J(j.lines, []).map((l: any, i: number) => ({ ...l, start: 1 + i * 3, end: 3.6 + i * 3 })), film: true, ambience: null, sfx: null, sfx_at: 0 }
  }
  const cast = Object.fromEntries((bible.cast || []).map((c: any, i: number) => [c.name, { color: ['#ff7eb3', '#7dd3fc', '#fbbf24', '#a78bfa'][i % 4], img: imgs[c.id] ? imgs[c.id] + '?v=' + (now() % 1e8) : pj.cover_url, side: c.side || (i === 0 ? 'R' : 'L'), brand: c.role }]))
  const data = { series: { id: sid, title: pj.title, logline: pj.logline, gated: true, generated: true, cat: Tax.fmt(pj.cat), genre: pj.genre || null, mech: bible.mech || null }, prologue: ['P'], nodes: tree.nodes, segments, cast }
  await env.DB.prepare(`INSERT INTO published_series (id,project_id,cat,genre,title,logline,tags,cover,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, cover=excluded.cover, cat=excluded.cat, genre=excluded.genre, version=version+1, updated_at=excluded.updated_at`)
    .bind(sid, projectId, Tax.fmt(pj.cat), pj.genre || null, pj.title, pj.logline, JSON.stringify([Tax.genreName(pj.genre) || Tax.fmtName(pj.cat), 'AI 生成'].filter(Boolean)), pj.cover_url, JSON.stringify(data), now(), now()).run()
  await env.DB.prepare(`UPDATE studio_projects SET status='published', series_id=?, updated_at=? WHERE id=?`).bind(sid, now(), projectId).run()
  return { series_id: sid, url: `/s/${sid}`, clips: jobs.length }
}

export async function creditReport(env: Bindings) {
  const byP = (await env.DB.prepare(`SELECT p.id, p.title, p.status, p.budget, p.spent, p.scale, (SELECT SUM(credits) FROM render_jobs WHERE project_id=p.id) est FROM studio_projects p WHERE p.spent>0 OR p.status IN ('rendering','review','published') ORDER BY p.updated_at DESC LIMIT 20`).all()).results
  const tot: any = await env.DB.prepare('SELECT COALESCE(SUM(credits),0) c, COUNT(*) n FROM credit_ledger').first()
  const workers = (await env.DB.prepare('SELECT * FROM worker_heartbeat ORDER BY seen_at DESC LIMIT 5').all()).results
  return { projects: byP, total_spent: tot.c, entries: tot.n, workers, price: { clip12: PRICE.clip(12), clip10: PRICE.clip(10), sheet: PRICE.sheet, cover: PRICE.cover }, scales: Object.fromEntries(Object.keys(SCALES).map((k) => [k, { ...SCALES[k], ...estimate(k) }])) }
}

/** 续生成：为已上架/已有项目补拍 黄金/白金/钻石 彩蛋片段（沿用同一套角色设定图），完成后自动重新上架（版本 +1） */
export async function addBonus(env: Bindings, projectId: string) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  if (!pj) throw new GameError('NOT_FOUND', '项目不存在')
  const tree = J(pj.tree, {}), bible = J(pj.bible, {})
  const endings = tree.nodes.flatMap((n: any) => n.options.filter((o: any) => !o.next).map((o: any) => o.ending_title || o.label))
  const cast = (bible.cast || []).map((c: any) => `${c.id}（${c.name}，${c.role}）`).join('；')
  const r: any = await callCapability(env, { capability: 'outline', tier: 'standard', json: true, timeoutMs: 90000, system: '你是互动剧分镜导演，输出严格 JSON：{"gold":{"title","shots":[{"desc":"英文镜头","speaker":"英文id","line":"中文台词","sfx":"英文"}]},"platinum":{...},"diamond":{...}}。每段 4~5 镜头、2~3 句台词。gold=心动高光加长，platinum=隐藏真相揭露，diamond=终极彩蛋（最震撼、最华丽）。',
    prompt: `作品《${pj.title}》：${pj.logline}\n角色：${cast}\n已有结局：${endings.join('、')}\n请写三个命运等级彩蛋片段。` })
  if (!r?.ok || !r.data?.gold) throw new GameError('LLM_FAILED', '编剧模型超时，请重试')
  const c = compile({ cast: bible.cast, setting: bible.setting, bonus: r.data, routes: [] }, pj.cat, pj.scale || 'pilot')
  const add = Object.fromEntries(Object.entries<any>(c.clips).filter(([k]) => k.startsWith('BONUS_')))
  tree.clips = { ...tree.clips, ...add }
  const st = Object.entries<any>(add).map(([cid, cl]) => env.DB.prepare(`INSERT OR IGNORE INTO render_jobs (id,project_id,clip_id,kind,title,prompt,lines,dur,credits,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(uid('job_'), projectId, cid, 'clip', cl.title, cl.shots, JSON.stringify(cl.lines), cl.dur, PRICE.clip(cl.dur), 'queued', now(), now()))
  await env.DB.batch([...st, env.DB.prepare(`UPDATE studio_projects SET tree=?, status='rendering', updated_at=? WHERE id=?`).bind(JSON.stringify(tree), now(), projectId)])
  return { queued: st.length, clips: Object.keys(add).map((k) => ({ id: k, title: add[k].title })), est_credits: Object.values<any>(add).reduce((a, x) => a + PRICE.clip(x.dur), 0) }
}
