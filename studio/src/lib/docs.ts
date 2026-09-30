// P3 · 第 4 步剧本描述 / 第 5 步提示词 + 连贯监管
//   - 节点级文档存 st_node_docs（一节点一行），规模可到上千节点
//   - 生成按「就绪」推进：节点的所有前驱剧本都是最新 → 才能写它（账本需要上游离场状态）；每次请求在时间预算内跑若干轮，前端循环调用，可中断可续跑
//   - 过期检测靠依赖指纹：只有真正影响本节点的上游变化才会让它过期
import { HttpError, type Env, type User, audit } from './auth'
import * as Gw from './gateway'
import * as G from './graph'
import * as L from './ledger'
import * as Steps from './steps'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const PAR = 6, BUDGET_MS = 50000

type Ctx = { pid: string; graph: G.Graph; bible: any; brief: any; bibleHash: string; castIds: Set<string>; by: Map<string, G.GNode> }
type Row = { node_id: string; data: any; src_hash: string; status: string; review: any; version: number; updated_at: number; updated_by: string | null }

async function ctx(env: Env, pid: string, step: 4 | 5): Promise<Ctx> {
  await Steps.assertOpen(env, pid, step)
  const brief = await Steps.doneOutput(env, pid, 1), bible = await Steps.doneOutput(env, pid, 2), graph = G.normalize(await Steps.doneOutput(env, pid, 3))
  return { pid, graph, bible, brief, bibleHash: L.fnv(L.stable(bible)), castIds: new Set((bible?.cast || []).map((c: any) => c.id)), by: new Map(graph.nodes.map((n) => [n.id, n])) }
}
/** 写操作前：已审核通过的步骤是只读的，必须先「退回修改」 */
async function assertEditable(env: Env, pid: string, step: 4 | 5) {
  const r: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (r?.status === 'done') throw new HttpError(409, 'STEP_DONE', `第 ${step} 步已审核通过，如需修改请先「退回修改」（下游将失效）`)
}
async function rows(env: Env, pid: string, kind: 'script' | 'prompt') {
  const rs = (await env.DB.prepare('SELECT node_id,data,src_hash,status,review,version,updated_at,updated_by FROM st_node_docs WHERE project_id=? AND kind=?').bind(pid, kind).all()).results as any[]
  return new Map<string, Row>(rs.map((r) => [r.node_id, { ...r, data: J(r.data), review: J(r.review) }]))
}
async function put(env: Env, pid: string, kind: 'script' | 'prompt', node: string, data: any, src_hash: string, status: string, review: any, run_id: string | null, by: string) {
  await env.DB.prepare(`INSERT INTO st_node_docs (project_id,kind,node_id,data,src_hash,status,review,version,run_id,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,1,?,?,?)
    ON CONFLICT(project_id,kind,node_id) DO UPDATE SET data=excluded.data, src_hash=excluded.src_hash, status=excluded.status, review=excluded.review, version=st_node_docs.version+1, run_id=excluded.run_id, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(pid, kind, node, JSON.stringify(data), src_hash, status, review ? JSON.stringify(review) : null, run_id, now(), by).run()
}

// ─────────── 剧本状态（确定性，每次全量重算，O(N+E)）───────────
export type NodeState = 'waiting' | 'missing' | 'stale' | 'ok' | 'error'
function scriptView(c: Ctx, docs: Map<string, Row>) {
  const { order, level } = L.topoOrder(c.graph), P = L.preds(c.graph)
  const exit = new Map<string, L.State | null>(), entryOf = new Map<string, L.State | null>(), out: any[] = []
  for (const id of order) {
    const n = c.by.get(id)!, ps = P.get(id) || []
    const xs = ps.map((p) => exit.get(p))
    const entry: L.State | null = !ps.length ? L.initialState(c.bible) : xs.some((x) => !x) ? null : L.merge(xs as L.State[])
    entryOf.set(id, entry)
    const d = docs.get(id), hash = entry ? L.scriptHash(n, c.graph, entry, c.bibleHash) : ''
    let state: NodeState, issues: L.DocIssue[] = []
    if (!entry) state = 'waiting'
    else if (!d) state = 'missing'
    else if (d.src_hash !== hash) state = 'stale'
    else { issues = L.checkScript(L.normScript(d.data), entry, n, c.castIds, c.graph); state = issues.some((i) => i.level === 'error') ? 'error' : 'ok' }
    exit.set(id, (state === 'ok' || state === 'error') && d ? L.apply(entry!, L.normScript(d.data).sets) : null)
    out.push({ id, type: n.type, title: n.title, level: level.get(id) || 0, state, hash, issues, edited: d?.status === 'manual', version: d?.version || 0, updated_at: d?.updated_at || null, preds: ps })
  }
  const count = (s: NodeState) => out.filter((x) => x.state === s).length
  return { nodes: out, entryOf, summary: { total: out.length, ok: count('ok'), error: count('error'), missing: count('missing'), stale: count('stale'), waiting: count('waiting'), complete: out.length > 0 && count('ok') === out.length } }
}

export async function scriptStatus(env: Env, pid: string) {
  const c = await ctx(env, pid, 4), v = scriptView(c, await rows(env, pid, 'script'))
  return { summary: v.summary, nodes: v.nodes }
}

export async function scriptDetail(env: Env, pid: string, node: string) {
  const c = await ctx(env, pid, 4), docs = await rows(env, pid, 'script'), v = scriptView(c, docs)
  const nv = v.nodes.find((x) => x.id === node); if (!nv) throw new HttpError(404, 'NO_NODE', '节点不存在')
  const entry = v.entryOf.get(node) || null, d = docs.get(node)
  return { node: c.by.get(node), view: nv, doc: d ? L.normScript(d.data) : null, entry, ledger: L.ledgerText(entry), incoming: c.graph.edges.filter((e) => e.to === node && e.kind !== 'back').map((e) => ({ from: e.from, from_title: c.by.get(e.from)?.title, label: e.label })), outgoing: c.graph.edges.filter((e) => e.from === node).map((e) => ({ to: e.to, to_title: c.by.get(e.to)?.title, label: e.label, kind: e.kind })), key_help: L.KEY_HELP }
}

/** 人工编辑剧本：上游必须就绪；保存即以当前指纹为准 */
export async function saveScript(env: Env, u: User, pid: string, node: string, data: any) {
  await assertEditable(env, pid, 4)
  const c = await ctx(env, pid, 4), docs = await rows(env, pid, 'script'), v = scriptView(c, docs)
  const nv = v.nodes.find((x) => x.id === node); if (!nv) throw new HttpError(404, 'NO_NODE', '节点不存在')
  if (nv.state === 'waiting') throw new HttpError(409, 'UPSTREAM_PENDING', '上游节点的剧本还没完成，账本无法确定，暂不能编辑这个节点')
  const doc = L.tidyScript(L.normScript(data), !(nv.preds || []).length)
  await put(env, pid, 'script', node, doc, nv.hash, 'manual', null, null, u.id)
  await touchStep(env, u, pid, 4)
  const issues = L.checkScript(doc, v.entryOf.get(node)!, c.by.get(node)!, c.castIds, c.graph)
  return { ok: !issues.some((i) => i.level === 'error'), issues }
}

// ─────────── SCRIPT Agent ───────────
const SCRIPT_SYS = `你是互动博弈短剧的分场编剧。为结构图中的「一个节点」写可拍摄的剧本描述，一个节点 = 一段 5~10 秒的视频。
只输出 JSON：{"summary":"≤60字概要","location":"英文地点","time":"英文时间","mood":"情绪","beats":[{"who":"角色id","action":"动作/画面（中文，≤40字）","line":"台词（≤20字，可空）"}],"cliff":"最后一个画面/悬念（≤40字）","duration":8,"cast":["出场角色id"],"requires":[{"key":"...","value":"..."}],"sets":[{"key":"...","value":"..."}]}
规则：
- beats 2~4 条，必须是镜头能拍出来的具体动作，不写心理活动；台词口语化
- cast 只能使用角色表里的 id
- 【剧情账本】requires 写本节点剧情「依赖」的既有事实；sets 写本节点「新建立或改变」的事实（value 为 null 表示失去/移除）
- 只能依赖【确定事实】；【不确定事实】因玩家走的路径不同而不同，绝不能当作已知（汇合节点尤其注意，可以用 sets 重新统一它）
- 账本已含每个角色的基线服装（costume.<id>）。只有剧情里换装/弄脏/受伤时才 sets；汇合后服装不确定的角色，要在 sets 里重新写明（英文），以便视频保持一致；受伤写 injury.<id>；拿起/放下道具写 prop.<id>；地点变化写 loc
- 博弈锚点：cliff 必须停在玩家下注前的一刻，并为每个选项埋下合理动机
- 结局：summary 与 cliff 体现结局等级的情绪（黄金及以上要爽，坏结局要痛）
` + L.KEY_HELP

function scriptPrompt(c: Ctx, n: G.GNode, entry: L.State, docs: Map<string, Row>) {
  const cast = (c.bible?.cast || []).map((x: any) => `${x.id}：${x.name}（${x.role}）`).join('；')
  const ins = c.graph.edges.filter((e) => e.to === n.id && e.kind !== 'back')
  const prev = ins.map((e) => { const d = docs.get(e.from)?.data; const pn = c.by.get(e.from); return `- 从「${pn?.title}」${e.label ? `（玩家选择了「${e.label}」${e.hint ? '：' + e.hint : ''}）` : ''}进入；上一段结尾：${d?.cliff || d?.summary || pn?.beat || ''}` }).join('\n')
  const outs = c.graph.edges.filter((e) => e.from === n.id && e.kind !== 'back')
  const backs = c.graph.edges.filter((e) => e.from === n.id && e.kind === 'back').map((e) => c.by.get(e.to)?.title)
  const role = n.type === 'choice' ? `这是博弈锚点，情境：${n.question || ''}。接下来玩家的选项：${outs.map((e) => `「${e.label}」${e.hint ? '(' + e.hint + ')' : ''}`).join('、')}`
    : n.type === 'loop' ? `这是时间裂隙：主角获得回到「${backs.join('、')}」重来的机会（有代价），也可以选择继续：${outs.map((e) => `「${e.label}」`).join('、')}`
      : n.type === 'ending' ? `这是结局，等级：${n.tier}`
        : n.type === 'merge' ? `这是汇合节点：${ins.length} 条不同路线在这里汇合，剧情必须对所有来路都成立` : `普通场景，之后进入「${outs.map((e) => c.by.get(e.to)?.title).join('')}」`
  return `世界观：${c.bible?.world || ''}\n一句话：${c.bible?.logline || ''}\n角色表：${cast}\n\n当前节点「${n.title}」（${n.id}）：${n.beat || ''}\n${role}\n${ins.length ? `来路：\n${prev}` : '这是全剧第一个镜头：交代地点、时间、主角的服装（sets）'}\n\n入场时的剧情账本：\n${L.ledgerText(entry)}`
}

async function writeScript(env: Env, u: User, c: Ctx, id: string, entry: L.State, hash: string, docs: Map<string, Row>) {
  const n = c.by.get(id)!, prompt = scriptPrompt(c, n, entry, docs)
  let r = await Gw.chat(env, 'SCRIPT', { json: true, system: SCRIPT_SYS, prompt, project_id: c.pid, step: 4, user: u.id, timeoutMs: 120000 })
  const isStart = !c.graph.edges.some((e) => e.to === id && e.kind !== 'back')
  let doc = L.tidyScript(L.normScript(r.data), isStart), is = L.checkScript(doc, entry, n, c.castIds, c.graph)
  let errs = is.filter((i) => i.level === 'error')
  if (errs.length) {
    r = await Gw.chat(env, 'SCRIPT', { json: true, system: SCRIPT_SYS, prompt: `${prompt}\n\n你上一版的问题（必须修正）：\n${errs.map((e) => '- ' + e.msg).join('\n')}\n上一版：${JSON.stringify(doc)}`, project_id: c.pid, step: 4, user: u.id, timeoutMs: 120000 })
    const d2 = L.tidyScript(L.normScript(r.data), isStart), i2 = L.checkScript(d2, entry, n, c.castIds, c.graph), e2 = i2.filter((i) => i.level === 'error')
    if (e2.length <= errs.length) { doc = d2; is = i2; errs = e2 }
  }
  await put(env, c.pid, 'script', id, doc, hash, errs.length ? 'conflict' : 'ok', { issues: is }, r.run_id, u.id)
  return { id, ok: !errs.length }
}

/** 在时间预算内推进若干轮；only 指定时只重写这些节点（必须就绪） */
export async function generateScripts(env: Env, u: User, pid: string, o: { only?: string[]; force?: boolean } = {}) {
  await assertEditable(env, pid, 4)
  const t0 = now(), done: any[] = [], failed: any[] = []
  const c = await ctx(env, pid, 4)
  for (let round = 0; round < 50; round++) {
    const docs = await rows(env, pid, 'script'), v = scriptView(c, docs)
    let ready = v.nodes.filter((x) => (o.only ? o.only.includes(x.id) && x.state !== 'waiting' && (o.force || x.state !== 'ok') : x.state === 'missing' || x.state === 'stale'))
    ready = ready.filter((x) => !done.some((d) => d.id === x.id) && !failed.some((d) => d.id === x.id)).slice(0, PAR)
    if (!ready.length || now() - t0 > BUDGET_MS) break
    const res = await Promise.allSettled(ready.map((x) => writeScript(env, u, c, x.id, v.entryOf.get(x.id)!, x.hash, docs)))
    res.forEach((r, i) => (r.status === 'fulfilled' ? done.push(r.value) : failed.push({ id: ready[i].id, error: String((r as any).reason?.message || r.reason).slice(0, 200) })))
    if (failed.length >= 3 && !done.length) break
  }
  await touchStep(env, u, pid, 4)
  const st = scriptView(c, await rows(env, pid, 'script')).summary
  return { done, failed, summary: st, more: st.missing + st.stale > 0 && !(o.only) }
}

// 任何节点文档变动 → 步骤回到「进行中」（若已提交审核，需重新提交）
async function touchStep(env: Env, u: User, pid: string, step: 4 | 5) {
  const r: any = await env.DB.prepare('SELECT status FROM st_steps WHERE project_id=? AND step=?').bind(pid, step).first()
  if (r && r.status !== 'ready') await Steps.saveStep(env, u, pid, step, { status: 'ready' })
}

// ─────────── 第 5 步：提示词 + 连贯监管 ───────────
const PROMPT_SYS = `你是 AI 视频提示词工程师（Seedance / 即梦类图生视频模型）。把一段剧本描述转成一条可直接生成 5~10 秒视频的英文提示词。
只输出 JSON，字段：
- prompt：英文，60~160 词，现在时，电影感。写清场景、光线、角色动作与表情、镜头运动。
- shots：1~3 个镜头，每个 {"camera": 景别+运镜（英文）, "visual": 画面（英文）}
- dialogue：[{"who": 角色id, "line": 中文台词}]
- negative：英文负面提示词
示例：{"prompt":"Night, a smoky underground card room lit by a single green-shaded lamp. adept sits hunched at the table, turning a chip between scarred knuckles, eyes fixed on broker across the felt. broker slides a folded contract forward with two fingers and leans back, smiling thinly. Slow push-in from a wide two-shot to a close-up on adept's hand hovering over the contract. Warm tungsten key light, deep shadows, film grain.","shots":[{"camera":"wide two-shot, slow push-in","visual":"adept and broker face each other across the card table"},{"camera":"close-up","visual":"adept's hand hovers over the contract"}],"dialogue":[{"who":"broker","line":"签了，债一笔勾销。"}],"negative":"text, subtitles, watermark, logo, extra fingers, distorted face, cartoon"}
规则：
- 角色在 prompt 里一律用角色 id 称呼（如 adept、broker），外貌与服装会由系统按账本自动追加，prompt 里只需简短提及服装变化
- 严格按 beats 顺序；台词只放 dialogue，不要写进 prompt
- 「尾帧接力」模式：第一个镜头必须从上一段结尾画面自然延续（同一地点、同一姿态、同一光线）
- 画面中不得出现任何可读文字、字幕、水印、Logo；手机/屏幕内容一律模糊不可读；不写真实明星、品牌`
const CONT_SYS = `你是短剧「连贯监管」审查员。对照【剧情账本】【剧本】【上一段结尾】检查视频提示词是否连贯。
注意：提示词末尾的 "No on-screen text, no subtitles…" 等是「禁止出现文字」的约束，完全正确，不是问题；角色外貌描述来自角色设定，也不是问题。
只找硬伤：服装/发型/伤痕/道具与账本不符；角色不该在场却出现或该在场却缺席；地点/时间跳变；与上一段结尾矛盾（尾帧接力模式）；角色知道了他不该知道的事；台词与剧情矛盾；画面要求出现文字字幕。
只输出 JSON：{"ok":true|false,"conflicts":[{"type":"costume|injury|prop|cast|location|time|continuity|knowledge|dialogue|text","detail":"具体问题（中文）","fix":"修改建议（中文）"}]}；没有硬伤就返回 {"ok":true,"conflicts":[]}，不要吹毛求疵。`

export type PromptDoc = { prompt: string; final: string; shots: { camera: string; visual: string }[]; dialogue: { who: string; line: string }[]; negative: string; mode: 'reference' | 'frames'; from?: string; why: string; duration: number; appendix: string; cast: string[] }

function normPrompt(d: any) {
  const c = (s: any, n: number) => String(s ?? '').trim().slice(0, n)
  return { prompt: c(d?.prompt, 1600), shots: (Array.isArray(d?.shots) ? d.shots : []).map((s: any) => ({ camera: c(s?.camera, 120), visual: c(s?.visual, 300) })).filter((s: any) => s.visual).slice(0, 4), dialogue: (Array.isArray(d?.dialogue) ? d.dialogue : []).slice(0, 6).map((x: any) => ({ who: c(x?.who, 24), line: c(x?.line, 60) })).filter((x: any) => x.line), negative: c(d?.negative, 300) }
}
export function checkPrompt(p: PromptDoc, castIds: Set<string>): L.DocIssue[] {
  const is: L.DocIssue[] = []
  if (!p.prompt || p.prompt.length < 120) is.push({ level: 'error', code: 'SHORT_PROMPT', msg: '提示词过短' })
  if (/60\s*~\s*160 words|present tense, cinematic\.?$|^English,/i.test(p.prompt)) is.push({ level: 'error', code: 'TEMPLATE_LEAK', msg: '提示词照抄了格式说明，需要重写' })
  if (/[\u4e00-\u9fa5]/.test(p.prompt)) is.push({ level: 'warn', code: 'CJK_PROMPT', msg: '提示词里含中文，视频模型对英文更稳定' })
  if (/\b(subtitle|caption|text overlay|title card|watermark|logo)\b/i.test(p.prompt.replace(/no (on-screen )?(text|subtitles?|captions?|watermark|logo)[^.]*\.?/gi, ''))) is.push({ level: 'error', code: 'TEXT_IN_FRAME', msg: '提示词要求画面出现文字/字幕/水印' })
  for (const id of p.cast) if (!new RegExp(`\\b${id}\\b`, 'i').test(p.prompt)) is.push({ level: 'warn', code: 'CAST_NOT_NAMED', msg: `出场角色 ${id} 没有在提示词中出现` })
  for (const d of p.dialogue) if (d.who && !castIds.has(d.who)) is.push({ level: 'warn', code: 'UNKNOWN_SPEAKER', msg: `台词角色 ${d.who} 不在角色表` })
  return is
}

async function promptCtx(env: Env, pid: string) {
  const c = await ctx(env, pid, 5), sdocs = await rows(env, pid, 'script'), sv = scriptView(c, sdocs)
  if (!sv.summary.complete) throw new HttpError(409, 'SCRIPTS_INCOMPLETE', '第 4 步剧本已变化或不完整，请先回到第 4 步')
  const modes = L.videoModes(c.graph, G.mainline(c.graph))
  return { c, sdocs, sv, modes }
}
function promptHash(pc: any, id: string) {
  const s = pc.sdocs.get(id)!, m = pc.modes.get(id)!, from = m.from ? pc.sdocs.get(m.from)?.data?.cliff : ''
  return L.fnv(L.stable({ s: s.data, e: pc.sv.entryOf.get(id), m: m.mode, from, cast: (pc.c.bible?.cast || []).map((x: any) => [x.id, x.look]) }))
}
function promptView(pc: any, pdocs: Map<string, Row>) {
  const out = pc.sv.nodes.map((x: any) => {
    const d = pdocs.get(x.id), m = pc.modes.get(x.id), h = promptHash(pc, x.id)
    let state: 'missing' | 'stale' | 'ok' | 'conflict' | 'error' = !d ? 'missing' : d.src_hash !== h ? 'stale' : d.status === 'conflict' ? 'conflict' : 'ok'
    const issues = d && state !== 'stale' ? checkPrompt(d.data, pc.c.castIds) : []
    if (state === 'ok' && issues.some((i) => i.level === 'error')) state = 'error'
    return { id: x.id, type: x.type, title: x.title, level: x.level, state, hash: h, mode: m.mode, from: m.from || null, why: m.why, issues, conflicts: d?.review?.conflicts || [], edited: d?.status === 'manual', version: d?.version || 0 }
  })
  const n = (s: string) => out.filter((x: any) => x.state === s).length
  return { nodes: out, summary: { total: out.length, ok: n('ok'), conflict: n('conflict'), error: n('error'), missing: n('missing'), stale: n('stale'), complete: out.length > 0 && n('ok') === out.length, reference: out.filter((x: any) => x.mode === 'reference').length, frames: out.filter((x: any) => x.mode === 'frames').length } }
}
export async function promptStatus(env: Env, pid: string) { const pc = await promptCtx(env, pid); const v = promptView(pc, await rows(env, pid, 'prompt')); return v }
export async function promptDetail(env: Env, pid: string, node: string) {
  const pc = await promptCtx(env, pid), pd = await rows(env, pid, 'prompt'), v = promptView(pc, pd), nv = v.nodes.find((x: any) => x.id === node)
  if (!nv) throw new HttpError(404, 'NO_NODE', '节点不存在')
  return { node: pc.c.by.get(node), view: nv, doc: pd.get(node)?.data || null, review: pd.get(node)?.review || null, script: L.normScript(pc.sdocs.get(node)!.data), ledger: L.ledgerText(pc.sv.entryOf.get(node)) }
}

async function writePrompt(env: Env, u: User, pc: any, id: string) {
  const c: Ctx = pc.c, n = c.by.get(id)!, s = L.normScript(pc.sdocs.get(id)!.data), entry = pc.sv.entryOf.get(id)!, m = pc.modes.get(id)!
  const prevCliff = m.from ? L.normScript(pc.sdocs.get(m.from)!.data).cliff : ''
  const cast = (c.bible?.cast || []).filter((x: any) => s.cast.includes(x.id))
  const appendix = L.continuityAppendix(entry, s.sets, c.bible?.cast || [], s.cast)
  const base = `角色（id: 外貌）：${cast.map((x: any) => `${x.id}: ${x.look}`).join('; ')}\n剧情账本（入场）：\n${L.ledgerText(entry)}\n本节点账本变化：${s.sets.map((f) => `${f.key}=${f.value ?? '(移除)'}`).join('; ') || '无'}\n\n剧本：${JSON.stringify({ summary: s.summary, location: s.location, time: s.time, mood: s.mood, beats: s.beats, cliff: s.cliff })}\n时长：${s.duration} 秒\n生成模式：${m.mode === 'frames' ? `尾帧接力——第一帧就是上一段的最后一帧：「${prevCliff}」` : '参考图模式（用角色设定图锁定人物）'}\n节点类型：${n.type}${n.tier ? '，结局等级 ' + n.tier : ''}`
  let runs: string[] = [], draft: any = null, review: any = null, conflicts: any[] = []
  for (let round = 0; round < 2; round++) {
    const r = await Gw.chat(env, 'PROMPT', { json: true, system: PROMPT_SYS, prompt: round === 0 ? base : `${base}\n\n连贯监管指出的硬伤（必须全部修正）：\n${conflicts.map((x) => `- [${x.type}] ${x.detail}；建议：${x.fix || ''}`).join('\n')}\n上一版提示词：${draft.prompt}`, project_id: c.pid, step: 5, user: u.id, timeoutMs: 120000 })
    runs.push(r.run_id); draft = normPrompt(r.data)
    const hard = checkPrompt({ ...draft, cast: s.cast } as any, c.castIds).filter((i) => i.level === 'error')
    if (hard.length && round === 0) { conflicts = hard.map((i) => ({ type: 'format', detail: i.msg, fix: '按 JSON 字段说明重写完整英文提示词' })); continue }
    const final = `${draft.prompt} ${appendix}`.trim()
    const cr = await Gw.chat(env, 'CONTINUITY', { json: true, system: CONT_SYS, prompt: `【剧情账本（入场）】\n${L.ledgerText(entry)}\n本节点变化：${s.sets.map((f) => `${f.key}=${f.value ?? '(移除)'}`).join('; ') || '无'}\n【出场角色】${s.cast.join(', ')}\n【剧本】${JSON.stringify({ summary: s.summary, beats: s.beats, cliff: s.cliff, location: s.location, time: s.time })}\n${m.mode === 'frames' ? `【上一段结尾（本段第一帧）】${prevCliff}\n` : ''}【待审提示词】${final}\n【台词】${JSON.stringify(draft.dialogue)}`, project_id: c.pid, step: 5, user: u.id, timeoutMs: 90000 })
    runs.push(cr.run_id); review = cr.data || { ok: true, conflicts: [] }
    conflicts = Array.isArray(review.conflicts) ? review.conflicts.slice(0, 8) : []
    if (review.ok !== false && !conflicts.length) break
  }
  const doc: PromptDoc = { ...draft, final: `${draft.prompt} ${appendix}`.trim(), mode: m.mode, from: m.from, why: m.why, duration: s.duration || 8, appendix, cast: s.cast }
  await put(env, c.pid, 'prompt', id, doc, promptHash(pc, id), conflicts.length ? 'conflict' : 'ok', { ok: !conflicts.length, conflicts, runs }, runs[runs.length - 1], u.id)
  return { id, ok: !conflicts.length, conflicts: conflicts.length }
}

export async function generatePrompts(env: Env, u: User, pid: string, o: { only?: string[]; force?: boolean } = {}) {
  await assertEditable(env, pid, 5)
  const t0 = now(), done: any[] = [], failed: any[] = []
  const pc = await promptCtx(env, pid)
  for (let round = 0; round < 50; round++) {
    const v = promptView(pc, await rows(env, pid, 'prompt'))
    const ready = v.nodes.filter((x: any) => (o.only ? o.only.includes(x.id) && (o.force || x.state !== 'ok') : x.state === 'missing' || x.state === 'stale')).filter((x: any) => !done.some((d) => d.id === x.id) && !failed.some((d) => d.id === x.id)).slice(0, PAR)
    if (!ready.length || now() - t0 > BUDGET_MS) break
    const res = await Promise.allSettled(ready.map((x: any) => writePrompt(env, u, pc, x.id)))
    res.forEach((r, i) => (r.status === 'fulfilled' ? done.push(r.value) : failed.push({ id: ready[i].id, error: String((r as any).reason?.message || r.reason).slice(0, 200) })))
    if (failed.length >= 3 && !done.length) break
  }
  await touchStep(env, u, pid, 5)
  const st = promptView(pc, await rows(env, pid, 'prompt')).summary
  return { done, failed, summary: st, more: st.missing + st.stale > 0 && !o.only }
}

/** 人工改提示词：视为人工确认（manual），但仍需通过确定性检查 */
export async function savePrompt(env: Env, u: User, pid: string, node: string, data: any) {
  await assertEditable(env, pid, 5)
  const pc = await promptCtx(env, pid); if (!pc.c.by.has(node)) throw new HttpError(404, 'NO_NODE', '节点不存在')
  const old = (await rows(env, pid, 'prompt')).get(node)?.data
  const s = L.normScript(pc.sdocs.get(node)!.data), m = pc.modes.get(node)!, d = normPrompt({ ...old, ...data })
  const appendix = L.continuityAppendix(pc.sv.entryOf.get(node)!, s.sets, pc.c.bible?.cast || [], s.cast)
  const doc: PromptDoc = { ...d, final: `${d.prompt} ${appendix}`.trim(), mode: m.mode, from: m.from, why: m.why, duration: s.duration || 8, appendix, cast: s.cast }
  await put(env, pid, 'prompt', node, doc, promptHash(pc, node), 'manual', { ok: true, conflicts: [], manual_by: u.id }, null, u.id)
  await touchStep(env, u, pid, 5)
  await audit(env, u.id, 'prompt_manual', `${pid}#${node}`)
  return { ok: true, issues: checkPrompt(doc, pc.c.castIds) }
}

// ─────────── 提交 / 审批闸门 ───────────
export async function gate(env: Env, pid: string, step: 4 | 5) {
  if (step === 4) {
    const st = await scriptStatus(env, pid)
    if (!st.summary.complete) throw new HttpError(422, 'DOCS_INCOMPLETE', `剧本未完成：${st.summary.ok}/${st.summary.total} 通过（错误 ${st.summary.error}、缺失 ${st.summary.missing}、过期 ${st.summary.stale}、等待上游 ${st.summary.waiting}）`, { summary: st.summary, bad: st.nodes.filter((n: any) => n.state !== 'ok').slice(0, 30).map((n: any) => ({ id: n.id, title: n.title, state: n.state, issues: n.issues })) })
    return { nodes: st.summary.total, graph_hash: L.fnv(L.stable(st.nodes.map((n: any) => n.hash))), checked_at: now() }
  }
  const st = await promptStatus(env, pid)
  if (!st.summary.complete) throw new HttpError(422, 'DOCS_INCOMPLETE', `提示词未完成：${st.summary.ok}/${st.summary.total} 通过（连贯冲突 ${st.summary.conflict}、错误 ${st.summary.error}、缺失 ${st.summary.missing}、过期 ${st.summary.stale}）`, { summary: st.summary, bad: st.nodes.filter((n: any) => n.state !== 'ok').slice(0, 30).map((n: any) => ({ id: n.id, title: n.title, state: n.state, conflicts: n.conflicts, issues: n.issues })) })
  return { nodes: st.summary.total, reference: st.summary.reference, frames: st.summary.frames, prompt_hash: L.fnv(L.stable(st.nodes.map((n: any) => n.hash))), checked_at: now() }
}
