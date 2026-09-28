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


// 每种形态的“博弈题面”设计指引：抉择 = 玩家押注“接下来会发生什么”，而不是“你想怎么做”
const MECH_GUIDE: Record<string, string> = {
  anime: '题面示例：“他收回伸出的手，是因为……？”“师尊这一笑，是杀意还是心软？”——押角色的真实动机/下一步反应。',
  live: '题面示例：“后视镜里她又笑了，下一秒会发生什么？”“赌王推出全部筹码，他手里是？”——押剧情走向/谁在说谎/谁会出手。',
  abstract: '题面示例：“售货机吐出一张小票，上面写的是？”“喵总拍了三下桌子，意思是？”——押荒诞规则下的“正确解读”，选项要好笑、互相矛盾、都说得通。'
}
// ─── 两段式编剧：① 骨架（剧情树 + 博弈题面，短 JSON 不会截断）→ lint → ② 分镜并行批量写（每段知道自己要“引出哪道题”）───
// 旧版一次性输出整棵树 + 全部分镜（1~1.6 万字），尾部的 fork / bonus 常被截断后被 looseJson 静默补括号吞掉。
const SKEL_SYS = (s: typeof SCALES[string], cat = 'live') => `你是互动博弈剧总编剧。只输出一个 JSON 对象，不要 markdown、不要解释。本步只写【剧情骨架与博弈题面】，不写分镜。
【核心玩法】玩家在每个抉择点“押注接下来会发生什么”，押中赢筹码 —— 题面是“竞猜题”，不是“你想怎么做”。
- 问题：具体、有悬念、以“？”结尾，紧贴上一段最后一幕，主语是剧中角色或事件（例：“他收回手，是因为……？”“她推出全部筹码，底牌是？”）；
  禁止“你会/你要/你想/要不要/是否/还是继续”这类玩家行动题，禁止“第一抉择”“路线A”等空洞编号。
- 选项 label ≤8 字，彼此互斥、都合理、都有画面感；hint ≤12 字，像弹幕一样制造犹豫；每组最后一个是出人意料的反转（tone=twist）。
- ${MECH_GUIDE[cat] || MECH_GUIDE.live}
- 所有中文字段里提到角色一律用中文名，禁止出现英文 id；cast.name 必须是真正的人名/称号（不要“我”“（弟子）”这类）。
- beat = 该段剧情一句话（≤40 字），写清发生了什么、结尾停在哪个画面。
【JSON 结构】
{"title":"爆款片名≤10字","logline":"一句话剧情≤40字","mech":{"name":"玩法名≤6字","rule":"一句话规则≤20字"},
 "cast":[{"id":"英文单词如 Mo","name":"中文名","look":"ENGLISH ONLY: hair, face, outfit, accessories","role":"中文人设≤16字","side":"L或R"}],
 "setting":"ENGLISH ONLY scene description",
 "prologue":{"title":"","beat":""},
 "q1":"第一道竞猜题？",
 "routes":[{"label":"","hint":"","title":"片段名","beat":"","q2":"该路线的竞猜题？",
    "endings":[{"label":"","hint":"","title":"结局名","tone":"love|sacrifice|betrayal|risk|twist","beat":""}]}],
 "hidden_route":{"label":"","hint":"","title":"","beat":"q1 的隐藏答案，之后接入第 1 条路线"},
 "fork":${s.forkEnds ? `{"title":"","beat":"平行时间线开启","question":"平行时间线的竞猜题？","endings":[常规结局×${s.forkEnds} + 1 个 tone=twist 的隐藏结局]}` : 'null'},
 "bonus":{"gold":{"title":"","beat":"高光加长"},"platinum":{"title":"","beat":"隐藏真相揭露"},"diamond":{"title":"","beat":"最震撼的终极彩蛋"}}}
【硬性规则】cast 3~4 人；routes 恰好 ${s.routes} 条；每条 endings 恰好 ${s.ends} 个（最后一个 tone=twist）；${s.forkEnds ? `fork.endings 恰好 ${s.forkEnds + 1} 个（最后一个 twist）；` : ''}标题要有爆款感。`

const SEG_SYS = `你是互动短剧分镜导演。只输出一个 JSON 对象：{"segs":{"<key>":{"meme":"名场面梗≤14字","shots":[{"desc":"ENGLISH: who does what, expression, camera angle, lighting","speaker":"cast id 或空","line":"中文台词≤22字或空","sfx":"english sound"}]}}}
规则：每个 key 4~6 个 shots，至少 2 句真正的中文 line（沉默/省略号不算台词，无台词就留空；line 里不要写括号动作）（口语化、有冲突、有钩子，≤22 字）；desc/sfx 必须英文，desc 里用角色英文 id；speaker 只能填 cast id；
严格按给定 beat 演，不要跳剧情；若给了“结尾要引出的竞猜题”，最后一个镜头必须停在能引出这道题的悬念画面上，但不要说出答案。
【示例】{"desc":"Mo glances back; the back seat woman in a red dress smiles, face half in shadow","speaker":"Su","line":"师傅，开快一点，他们在等我。","sfx":"low hum"}`

const ACTION_Q = /你(会|要|想|该|选|打算|决定)|要不要|是否|还是继续/
const lenCJK = (x: any) => [...String(x || '')].length
/** 骨架 lint：结构数量 / 题面类型 / 选项长度与互斥 / 英文 id 泄漏（可自动修的直接修，其余交给重试） */
export function lintSkeleton(o: any, s: typeof SCALES[string]) {
  const issues: string[] = [], fixes: string[] = []
  const cast = (o.cast || []) as any[]
  // 自动修：中文字段里的英文 id → 中文名；角色名去掉括号注释
  for (const c of cast) { const n0 = String(c.name || ''); const n1 = n0.replace(/[（(].*?[)）]/g, '').trim(); if (n1 && n1 !== n0) { c.name = n1; fixes.push(`角色名 ${n0} → ${n1}`) } }
  const ids = cast.filter((c) => c.id && c.name).map((c) => [String(c.id), String(c.name)] as const)
  const zh = (x: any, k: string) => { if (typeof x?.[k] !== 'string') return; let v = x[k]; for (const [id, nm] of ids) v = v.replace(new RegExp(`(^|[^A-Za-z])${id}(?![A-Za-z])`, 'g'), `$1${nm}`); if (v !== x[k]) { fixes.push(`英文 id → 中文名：${x[k].slice(0, 14)}`); x[k] = v } }
  const segs = [o.prologue, ...(o.routes || []), ...(o.routes || []).flatMap((r: any) => r.endings || []), o.hidden_route, o.fork, ...(o.fork?.endings || []), ...Object.values(o.bonus || {})].filter(Boolean)
  for (const x of segs) for (const k of ['label', 'hint', 'title', 'beat', 'q2', 'question']) zh(x, k)
  zh(o, 'q1'); zh(o, 'title'); zh(o, 'logline')
  if (cast.length < 3) issues.push(`cast 只有 ${cast.length} 人（需要 3~4）`)
  if ((o.routes || []).length !== s.routes) issues.push(`routes 需要恰好 ${s.routes} 条，实际 ${(o.routes || []).length}`)
  ;(o.routes || []).forEach((r: any, i: number) => { if ((r.endings || []).length !== s.ends) issues.push(`routes[${i}].endings 需要恰好 ${s.ends} 个，实际 ${(r.endings || []).length}`) })
  if (s.forkEnds && (!o.fork || (o.fork.endings || []).length < s.forkEnds + 1)) issues.push(`fork 缺失或 fork.endings 少于 ${s.forkEnds + 1} 个`)
  if (!o.hidden_route?.label) issues.push('缺少 hidden_route')
  if (!['gold', 'platinum', 'diamond'].every((k) => o.bonus?.[k]?.beat)) issues.push('bonus 三档不全')
  const groups: [string, string, any[]][] = [['q1', o.q1, [...(o.routes || []), o.hidden_route].filter(Boolean)], ...(o.routes || []).map((r: any, i: number) => [`routes[${i}].q2`, r.q2, r.endings || []] as [string, string, any[]]), ...(o.fork ? [['fork.question', o.fork.question, o.fork.endings || []] as [string, string, any[]]] : [])]
  for (const [where, q, opts] of groups) {
    if (!q || !/[？?]\s*$/.test(q)) issues.push(`${where} 不是问句：${q || '（空）'}`)
    else if (ACTION_Q.test(q)) issues.push(`${where} 是“玩家行动题”而不是竞猜题：${q}`)
    const ls = opts.map((x) => String(x.label || ''))
    if (new Set(ls).size < ls.length) issues.push(`${where} 选项重复：${ls.join('/')}`)
    for (const x of opts) { if (!x.label || lenCJK(x.label) > 8) issues.push(`${where} 选项“${x.label}”为空或超过 8 字`); if (!x.hint) issues.push(`${where} 选项“${x.label}”缺少 hint`); if (!x.beat) issues.push(`${where} 选项“${x.label}”缺少 beat`) }
  }
  return { issues, fixes }
}

/** 列出所有需要分镜的片段：key → { 目标对象, 上下文说明, 结尾要引出的题 } */
function segPlan(o: any) {
  const P: { key: string; obj: any; ctx: string; lead?: string }[] = []
  const add = (key: string, obj: any, ctx: string, lead?: string) => obj && P.push({ key, obj, ctx, lead })
  add('P', o.prologue, `序章《${o.prologue?.title || ''}》：${o.prologue?.beat || o.logline || ''}`, o.q1)
  ;(o.routes || []).forEach((r: any, i: number) => {
    add(`R${i + 1}`, r, `竞猜题“${o.q1}”的答案揭晓为「${r.label}」。片段《${r.title}》：${r.beat}`, r.q2)
    ;(r.endings || []).forEach((e: any, j: number) => add(`R${i + 1}E${j + 1}`, e, `竞猜题“${r.q2}”的答案揭晓为「${e.label}」→ 结局《${e.title}》（${e.tone}）：${e.beat}。要有收束感${e.tone === 'twist' ? '，并给出强反转' : ''}。`))
  })
  add('RT', o.hidden_route, `隐藏答案：竞猜题“${o.q1}”的真相其实是「${o.hidden_route?.label}」。片段《${o.hidden_route?.title}》：${o.hidden_route?.beat}`, o.routes?.[0]?.q2)
  if (o.fork) {
    add('K', o.fork, `时间裂隙《${o.fork.title}》：${o.fork.beat || '世界静止，平行时间线开启'}`, o.fork.question)
    ;(o.fork.endings || []).forEach((e: any, j: number) => add(`KE${j + 1}`, e, `平行时间线竞猜题“${o.fork.question}”的答案揭晓为「${e.label}」→ 结局《${e.title}》（${e.tone}）：${e.beat}`))
  }
  for (const t of ['gold', 'platinum', 'diamond']) add(`B_${t}`, o.bonus?.[t], `${{ gold: '黄金彩蛋（高光加长）', platinum: '白金彩蛋（隐藏真相揭露）', diamond: '钻石彩蛋（终极、最震撼华丽）' }[t]}《${o.bonus?.[t]?.title || ''}》：${o.bonus?.[t]?.beat || ''}`)
  return P
}
const segOk = (x: any) => Array.isArray(x?.shots) && x.shots.length >= 3 && x.shots.filter((s: any) => cleanLine(s?.line)).length >= 2

/** 分镜并行写：每批 ≤4 段、全部并发；不合格的段落合并重试一次 */
async function writeSegments(env: Bindings, o: any, plan: ReturnType<typeof segPlan>) {
  const castTxt = (o.cast || []).map((c: any) => `${c.id}=${c.name}（${c.role}；${c.look}）`).join('\n')
  const head = `片名《${o.title}》：${o.logline || ''}\n场景（英文）：${o.setting || ''}\n角色（id=中文名）：\n${castTxt}\n`
  const run = async (items: typeof plan) => {
    const prompt = head + '\n请为以下每个 key 写分镜：\n' + items.map((x) => `【${x.key}】${x.ctx}${x.lead ? `\n  结尾要引出的竞猜题：${x.lead}` : ''}`).join('\n')
    const r: any = await callCapability(env, { capability: 'storyboard', tier: 'standard', json: true, system: SEG_SYS, prompt, agent: 7, timeoutMs: 90000, fallback: () => null })
    const got = r?.ok ? (r.data?.segs || r.data || {}) : {}
    for (const x of items) if (segOk(got[x.key])) { x.obj.shots = got[x.key].shots; x.obj.meme = got[x.key].meme || x.obj.meme || '' }
  }
  const chunks = (xs: typeof plan, n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
  await Promise.all(chunks(plan, 4).map(run))
  const miss = plan.filter((x) => !segOk(x.obj))
  if (miss.length) await Promise.all(chunks(miss, 3).map(run))
  return plan.filter((x) => !segOk(x.obj)).map((x) => x.key)
}

// 台词清洗：去掉括号舞台指示（如“（silent stare）”），纯省略号 / 无中文的“台词”视为无台词（避免 TTS 念出怪声、Seedance 误判口型）
export const cleanLine = (x: any) => { const t = String(x || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[{}]/g, '').trim(); return /[\u4e00-\u9fff]/.test(t) ? t : '' }
function shotsText(shots: any[], castMap: Record<string, any>) {
  return (shots || []).slice(0, 6).map((s: any, i: number) => {
    const who = castMap[s.speaker]
    const ln = cleanLine(s.line), line = ln ? ` ${who ? who.id : 'The character'} says in Mandarin Chinese: {${ln}}` : ''
    return `Shot ${i + 1}: ${s.desc || ''}${line}${s.sfx ? ` <${s.sfx}>` : ''}`
  }).join('\n')
}
function linesOf(shots: any[], castMap: Record<string, any>) {
  return (shots || []).filter((s: any) => cleanLine(s.line)).map((s: any) => ({ speaker: castMap[s.speaker]?.name || s.speaker || '旁白', text: cleanLine(s.line) }))
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
    const n: any = { id: nid, depth: 2, question: r.q2 || (out.q2 || [])[i] || `${r.label}之后，会发生什么？`, options: [] }
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
    const fe0 = out.fork.endings || [], fe = [...fe0.filter((e: any) => !(e.twist || e.tone === 'twist')).slice(0, sc.forkEnds), ...fe0.filter((e: any) => e.twist || e.tone === 'twist').slice(0, 1)]
    nodes.push({ id: 'N_K', depth: 3, question: out.fork.question || '平行时间线：你要改写什么？', options: fe.map((e: any, j: number) => { add(`E_K${j + 1}`, e, 10); return { id: `E_K${j + 1}`, key: 'ABCD'[j], label: e.label, hint: e.hint || '', weight: +(1 / fe.length).toFixed(2), category: e.tone || 'love', ending_title: e.title, ...(e.twist || e.tone === 'twist' ? { twist: true, key: 'T' } : {}) } }) })
  }
  for (const t of ['gold', 'platinum', 'diamond']) if (out.bonus?.[t]) add(`BONUS_${t}`, { title: out.bonus[t].title || t, shots: out.bonus[t].shots }, 10)
  const sheetPrompt = `Character reference sheet, ${Tax.SHEET_STYLE[Tax.fmt(cat)]}, ${cast.length} characters standing side by side left to right on a clean light background, full body plus face close-up, consistent lighting, labeled by position only, no text. All characters are ORIGINAL fictional people with unique faces — must NOT resemble any real actor, celebrity or public figure. ` + cast.map((c: any, i: number) => `#${i + 1}: ${c.look}.`).join(' ')
  return { cast, nodes, clips, sheetPrompt }
}

export async function direct(env: Bindings, p: { theme: string; cat: string; genre?: string; scale: string; budget?: number; auto?: boolean; item_id?: string; title?: string; logline?: string; tags?: string[]; outline?: any; mech?: any }) {
  const sc = SCALES[p.scale] || SCALES.standard
  const est = estimate(p.scale)
  if (p.budget && p.budget < est.credits) throw new GameError('BUDGET', `预算 ${p.budget} 不足，${sc.name} 预计需要 ${est.credits} 积分`)
  const prompt = `主题：${p.theme}\n类型：${Tax.brief(p.cat, p.genre)}${p.title ? `\n片名：${p.title}` : ''}${p.logline ? `\n梗概：${p.logline}` : ''}\n请输出完整剧本 JSON。`
  // 导演自带剧本（人工精修 / 外部编剧）→ 跳过 LLM，直接编译校验
  const t0 = Date.now(), lint: string[] = [], autofix: string[] = []
  let r: any
  if (p.outline) r = { ok: true, data: p.outline, model: 'director-manual' }
  else {
    // ① 骨架：lint 不过 → 带着问题清单重写一次
    const skel = (extra = '') => callCapability(env, { capability: 'outline', tier: 'standard', json: true, system: SKEL_SYS(sc, Tax.fmt(p.cat)), prompt: prompt + extra, agent: 7, timeoutMs: 90000, fallback: () => null })
    r = await skel()
    let L = r?.ok && r.data?.routes?.length ? lintSkeleton(r.data, sc) : { issues: ['骨架输出无效'], fixes: [] }
    if (L.issues.length) {
      const r2: any = await skel(`\n\n上一版存在以下问题，请全部修正后重新输出完整 JSON：\n- ${L.issues.slice(0, 12).join('\n- ')}`)
      const L2 = r2?.ok && r2.data?.routes?.length ? lintSkeleton(r2.data, sc) : null
      if (L2 && L2.issues.length <= L.issues.length) { r = r2; L = L2 }
    }
    if (!r?.ok || !r.data?.routes?.length) throw new GameError('LLM_FAILED', '编剧模型超时或输出无效，请重试')
    lint.push(...L.issues); autofix.push(...L.fixes)
    // ② 分镜：并行批量写，每段知道自己要引出哪道题
    const missing = await writeSegments(env, r.data, segPlan(r.data))
    if (missing.length) lint.push(`分镜重试后仍不合格：${missing.join(',')}`)
  }
  const c = compile(r.data, p.cat, p.scale)
  const rep = repairTree({ nodes: c.nodes, clips: c.clips })
  rep.fixes.unshift(...autofix)
  const v = validateTree(rep.tree)
  const id = uid('prj_')
  const title = p.title || r.data.title || p.theme.split(/[，,。]/)[0].slice(0, 12)
  await env.DB.prepare(`INSERT INTO studio_projects (id,kind,source_item,cat,genre,title,logline,status,bible,tree,score,scale,budget,auto,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, 'series', p.item_id || null, Tax.fmt(p.cat), p.genre || Tax.guessGenre(p.theme + (p.tags || []).join(''), Tax.fmt(p.cat)), title, p.logline || p.theme, 'scripted', JSON.stringify({ cast: c.cast, sheet_prompt: c.sheetPrompt, setting: r.data.setting, mech: p.mech || r.data.mech || null }), JSON.stringify(rep.tree), v.ok ? 1 : 0, p.scale, p.budget || 0, p.auto ? 1 : 0, now(), now()).run()
  return { id, title, model: r.model, validation: v, fixes: rep.fixes, lint, secs: Math.round((Date.now() - t0) / 1000), estimate: est, cast: c.cast }
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
  // 内容审核拒绝：同一提示词重试必然再被拒 → LLM 改写成合规版本、重置次数重新排队（最多自愈 2 轮）
  const moderated = !p.ok && /moderation|safety|sensitive|rejected/i.test(String(p.meta?.error || ''))
  let softened: string | null = null
  // copyright = 参考图（设定图）撞脸真人，改写文字无效 → 直接判失败，由预检提示“重做设定图”
  if (moderated && !/copyright/i.test(String(p.meta?.error || '')) && j.kind === 'clip' && (j.softened || 0) < 2) softened = await softenPrompt(env, j.prompt, j.softened || 0)
  const status = softened ? 'queued' : !p.ok ? (moderated || j.attempts >= 2 ? 'failed' : 'queued') : j.kind !== 'clip' || (pj.auto && pass) ? 'approved' : 'review'
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status=?, result_url=?, meta=?, qc=?, spent=spent+?, worker=CASE WHEN ?='queued' THEN NULL ELSE worker END, updated_at=? WHERE id=?`).bind(status, p.url || null, JSON.stringify(p.meta || {}), JSON.stringify(p.qc || {}), spent, status, now(), p.id),
    env.DB.prepare('UPDATE studio_projects SET spent=spent+?, updated_at=? WHERE id=?').bind(spent, now(), j.project_id),
    env.DB.prepare('INSERT INTO credit_ledger (project_id,job_id,kind,credits,note,created_at) VALUES (?,?,?,?,?,?)').bind(j.project_id, p.id, j.kind, spent, `${j.clip_id} ${p.ok ? 'ok' : 'fail'}`, now())
  ])
  if (softened) await env.DB.prepare('UPDATE render_jobs SET prompt=?, softened=softened+1, attempts=0 WHERE id=?').bind(softened, p.id).run()
  if (p.ok && j.kind === 'sheet') await env.DB.prepare('UPDATE studio_projects SET sheet_url=?, cast_imgs=? WHERE id=?').bind(p.url, JSON.stringify(p.meta?.cast || {}), j.project_id).run()
  if (p.ok && j.kind === 'cover') await env.DB.prepare('UPDATE studio_projects SET cover_url=? WHERE id=?').bind(p.meta?.public_url || p.url, j.project_id).run()
  return progress(env, j.project_id)
}

/** 审核自愈：保留角色定义 / 镜头结构 / 中文台词，把暴力、赌博、血腥、威胁等易触发审核的表达改写为含蓄的电影化表达 */
const SOFT_SYS = `You rewrite prompts for an AI video model whose safety filter rejected them. Output ONLY the rewritten prompt text, no explanation.
Keep EXACTLY: the first "@Image1 ..." character-definition lines, the Style/Setting line (but replace words like casino/gambling/poker/bet/chips with "private card salon", "cards", "tokens"), the "Shot N:" structure, every Mandarin line inside {...} (you may soften only threatening words inside {...}), and the final quality line.
Rewrite: violence (grab, slam, lunge, rip, knife, gun, blood, kill, fight, threat, hit) → tense but non-violent acting (leans in, taps the table, steady glare, stands up slowly); no weapons, no injury, no minors, no sexual content, no real brands. Keep it cinematic and dramatic.`
export async function softenPrompt(env: Bindings, prompt: string, round = 0) {
  const r: any = await callCapability(env, { capability: 'storyboard', tier: 'standard', system: SOFT_SYS + (round ? '\nThis is the SECOND rejection: be much more conservative, calm body language only, avoid any conflict verbs.' : ''), prompt, agent: 7, timeoutMs: 60000, fallback: () => null })
  const t = String(r?.ok ? r.data : '').trim()
  return t.includes('@Image1') && /Shot 1:/.test(t) ? t : null
}

/** 失败片段一键重拍：审核类失败先改写提示词，其余直接重排队（上架中心 / 导演台调用） */
export async function retryFailed(env: Bindings, projectId: string) {
  const jobs = (await env.DB.prepare(`SELECT id, prompt, softened, meta FROM render_jobs WHERE project_id=? AND status='failed'`).bind(projectId).all()).results as any[]
  const out: any[] = []
  await Promise.all(jobs.map(async (j) => {
    const err = String(J(j.meta, {})?.error || ''), mod = /moderation|safety|rejected|video failed/i.test(err) && !/copyright/i.test(err)
    const np = mod ? await softenPrompt(env, j.prompt, j.softened || 0) : null
    await env.DB.prepare(`UPDATE render_jobs SET status='queued', worker=NULL, attempts=0, prompt=COALESCE(?, prompt), softened=softened+?, updated_at=? WHERE id=?`).bind(np, np ? 1 : 0, now(), j.id).run()
    out.push({ id: j.id, softened: !!np })
  }))
  await env.DB.prepare(`UPDATE studio_projects SET status='rendering', updated_at=? WHERE id=? AND status!='published'`).bind(now(), projectId).run()
  return { requeued: out.length, softened: out.filter((x) => x.softened).length }
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
export async function publish(env: Bindings, projectId: string, opt: { tree?: any; onlyApproved?: boolean } = {}) {
  const pj: any = await env.DB.prepare('SELECT * FROM studio_projects WHERE id=?').bind(projectId).first()
  let jobs = (await env.DB.prepare(`SELECT * FROM render_jobs WHERE project_id=? AND kind='clip'`).bind(projectId).all()).results as any[]
  // 上架中心走 onlyApproved + 裁剪后的树（精简版）；自动上架仍要求全部通过
  if (opt.onlyApproved) jobs = jobs.filter((j) => j.status === 'approved' && !String(j.result_url || '').startsWith('dry://'))
  else if (jobs.some((j) => j.status !== 'approved')) throw new GameError('NOT_READY', '还有片段未审核通过')
  if (jobs.some((j) => String(j.result_url || '').startsWith('dry://'))) throw new GameError('DRY_MEDIA', '存在空跑(dry)占位片段，不能上架')
  const tree = opt.tree || J(pj.tree, {}), bible = J(pj.bible, {}), imgs = J(pj.cast_imgs, {})
  const sid = pj.series_id || 'gen_' + projectId.slice(4, 12)
  const segments: any = {}
  for (const j of jobs) {
    const m = J(j.meta, {})
    segments[j.clip_id] = { title: j.title, meme: tree.clips?.[j.clip_id]?.meme || '', mood: '', image_url: m.poster || pj.cover_url, video_url: `/static/${sid}/${j.clip_id}.mp4`, last_url: m.last || m.poster, dur: m.dur || j.dur, lines: m.lines || J(j.lines, []).map((l: any, i: number) => ({ ...l, start: 1 + i * 3, end: 3.6 + i * 3 })), film: true, ambience: null, sfx: null, sfx_at: 0 }
  }
  const cast = Object.fromEntries((bible.cast || []).map((c: any, i: number) => [c.name, { color: ['#ff7eb3', '#7dd3fc', '#fbbf24', '#a78bfa'][i % 4], img: imgs[c.id] ? imgs[c.id] + '?v=' + (now() % 1e8) : pj.cover_url, side: c.side || (i === 0 ? 'R' : 'L'), brand: c.role }]))
  const data = { series: { id: sid, title: pj.title, logline: pj.logline, gated: true, generated: true, cat: Tax.fmt(pj.cat), genre: pj.genre || null, mech: bible.mech || null }, prologue: ['P'], nodes: tree.nodes, segments, cast }
  await env.DB.prepare(`INSERT INTO published_series (id,project_id,cat,genre,title,logline,tags,cover,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, cover=excluded.cover, cat=excluded.cat, genre=excluded.genre, title=excluded.title, logline=excluded.logline, version=version+1, updated_at=excluded.updated_at`)
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
