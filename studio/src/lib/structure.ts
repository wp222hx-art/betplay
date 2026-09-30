// 结构 Agent（第 3 步）：AI 生成初版结构图 / 在锚点上延展分支 / 设计回溯。
// 原则：AI 只产出「提案」，由人在画布上预览后决定是否采纳；所有提案先过 normalize + analyze 再返回。
import { HttpError, type Env, type User } from './auth'
import * as Gw from './gateway'
import * as G from './graph'

const SCALE: Record<string, { choices: string; endings: string; nodes: string }> = {
  pilot: { choices: '2', endings: '3~4', nodes: '8~12' },
  standard: { choices: '3~4', endings: '5~7', nodes: '14~22' },
  epic: { choices: '5~7', endings: '8~12', nodes: '24~40' }
}

const RULES = `结构图规则（必须遵守）：
- 节点 type：scene 剧情场景 / choice 博弈锚点（玩家下注的分叉点，2~4 个选项）/ merge 汇合（多条支线回到同一剧情）/ loop 时间裂隙（可回溯到之前的节点重来，必须同时有前进出口）/ ending 结局（tier: bad/normal/gold/platinum/diamond）
- 边 kind：next（scene/merge 的唯一出边）/ option（choice 或 loop 的前进出边，必须有 label）/ back（只能从 loop 指向它的上游节点）
- 只有 choice 和 loop 能分叉；scene 与 merge 只能有 1 条出边；ending 没有出边；前进边不能成环
- 选项 label 是 ≤8 字的动作（如「掀桌摊牌」「押上全部」），不能是问句；hint 是 ≤20 字的风险提示
- 用 merge 让支线汇合，控制拍摄量；结局至少 1 个 gold 及以上，至少 1 个 bad
- title ≤12 字；beat ≤60 字写清这个节点发生了什么、谁在场；question 写博弈情境（≤30 字）
- cast 用角色 id 列表
只输出 JSON。

示例（仅示意格式，内容要按本剧重新设计）：
{"start":"s1","nodes":[
 {"id":"s1","type":"scene","title":"深夜赌局","beat":"主角被债主押进地下赌场","cast":["hero"]},
 {"id":"c1","type":"choice","title":"第一注","beat":"庄家发出底牌，债主盯着他","question":"底牌只有一对七","cast":["hero","boss"]},
 {"id":"s2","type":"scene","title":"孤注一掷","beat":"他把全部筹码推上桌","cast":["hero"]},
 {"id":"s3","type":"scene","title":"以退为进","beat":"他弃牌并悄悄记下庄家手法","cast":["hero"]},
 {"id":"m1","type":"merge","title":"决战前夜","beat":"两条路都把他带到终局牌桌","cast":["hero","boss"]},
 {"id":"c2","type":"choice","title":"最后一手","beat":"全场屏息","question":"对手加注到天价","cast":["hero","boss"]},
 {"id":"e1","type":"ending","title":"赢下一切","tier":"gold","beat":"他翻开同花顺"},
 {"id":"e2","type":"ending","title":"满盘皆输","tier":"bad","beat":"他被拖出赌场"}],
"edges":[
 {"from":"s1","to":"c1","kind":"next","main":true},
 {"from":"c1","to":"s2","kind":"option","label":"全部押上","hint":"赢则翻身","main":true},
 {"from":"c1","to":"s3","kind":"option","label":"弃牌观察","hint":"输小钱换情报"},
 {"from":"s2","to":"m1","kind":"next","main":true},{"from":"s3","to":"m1","kind":"next"},
 {"from":"m1","to":"c2","kind":"next","main":true},
 {"from":"c2","to":"e1","kind":"option","label":"跟到底","main":true},
 {"from":"c2","to":"e2","kind":"option","label":"揭穿出千"}]}
注意：字段名不要带问号；想让剧情「回到前面」必须用 loop 节点 + back 边，不能用普通边指回去；多个选项可以指向同一个节点（但意义要不同）。`

function worldBrief(bible: any, brief: any) {
  const cast = (bible?.cast || []).map((c: any) => `${c.id}=${c.name}（${c.role}）`).join('；')
  return `主题：${brief?.theme || ''}\n题材：${brief?.genre || ''}\n一句话：${bible?.logline || ''}\n世界观：${bible?.world || ''}\n角色：${cast}\n主线节拍：${(bible?.mainline || []).map((b: string, i: number) => `${i + 1}.${b}`).join(' ')}`
}

/** 自检 → 最多回炉 1 次（带问题清单） */
async function askGraph(env: Env, u: User, pid: string, system: string, prompt: string, build0: (d: any) => G.Graph) {
  let fixes: string[] = []
  const build = (d: any) => { const g0 = build0(d), keep = (g0 as any)._new; const r = G.repair(g0); fixes = r.fixes; const g = G.layout(r.graph, keep); if (keep) (g as any)._new = keep; return g }
  const call = async (p: string) => { try { return await Gw.chat(env, 'STRUCTURE', { json: true, system, prompt: p, project_id: pid, step: 3, user: u.id, timeoutMs: 150000 }) } catch (e: any) { if (e?.code !== 'BAD_JSON') throw e; return Gw.chat(env, 'STRUCTURE', { json: true, system, prompt: p + '\n\n（上次输出不是合法 JSON，请只输出一个完整 JSON 对象）', project_id: pid, step: 3, user: u.id, timeoutMs: 150000 }) } }
  let r = await call(prompt)
  let g = build(r.data || {}), a = G.analyze(g), runs = [r.run_id], allFixes = fixes
  const errs = a.issues.filter((i) => i.level === 'error')
  if (errs.length) {
    r = await call(`${prompt}\n\n上一版有这些问题，请修正后重新完整输出：\n${errs.slice(0, 12).map((e) => '- ' + e.msg).join('\n')}\n\n上一版：${JSON.stringify(r.data || {}).slice(0, 6000)}`)
    const g2 = build(r.data || {}), a2 = G.analyze(g2); runs.push(r.run_id)
    if (a2.issues.filter((i) => i.level === 'error').length <= errs.length) { g = g2; a = a2; allFixes = fixes }
  }
  return { graph: g, analysis: a, runs, fixes: allFixes }
}

/** 初版：从世界观与主线节拍生成完整结构图 */
export async function draft(env: Env, u: User, pid: string, bible: any, brief: any) {
  const sc = SCALE[brief?.scale] || SCALE.pilot
  const system = `你是互动博弈短剧的结构设计师。${RULES}\n主线（最佳观看路径）上的边标 "main":true。`
  const prompt = `${worldBrief(bible, brief)}\n\n规模：博弈锚点 ${sc.choices} 个，结局 ${sc.endings} 个，总节点 ${sc.nodes} 个，至少 1 个 merge 汇合节点${brief?.scale === 'pilot' ? '' : '、1 个 loop 时间裂隙'}。`
  const res = await askGraph(env, u, pid, system, prompt, (d) => G.normalize(d))
  return { proposal: res.graph, analysis: res.analysis, runs: res.runs, fixes: res.fixes }
}

/** 延展：在指定节点之后长出新的剧情（锚点 → 新增选项分支；场景/结局 → 续写并在末尾接回已有节点或新结局） */
export async function extend(env: Env, u: User, pid: string, graph: G.Graph, nodeId: string, o: { mode?: 'branch' | 'continue' | 'loop'; hint?: string; count?: number }, bible: any, brief: any) {
  const g = G.normalize(graph), n = g.nodes.find((x) => x.id === nodeId)
  if (!n) throw new HttpError(404, 'NO_NODE', '节点不存在')
  const mode = o.mode || (n.type === 'choice' ? 'branch' : 'continue')
  const outs = g.edges.filter((e) => e.from === nodeId && e.kind !== 'back')
  if (mode === 'branch' && n.type !== 'choice') throw new HttpError(400, 'NOT_CHOICE', '只有博弈锚点可以加选项分支')
  if (mode === 'branch' && outs.length >= 4) throw new HttpError(400, 'CHOICE_FULL', '该锚点已有 4 个选项')
  if (mode === 'continue' && outs.length && n.type !== 'ending') throw new HttpError(400, 'HAS_NEXT', '该节点已有后续，请在锚点上加分支或先删除后续')
  const anc = G.ancestors(g, nodeId), by = new Map(g.nodes.map((x) => [x.id, x]))
  const later = g.nodes.filter((x) => !anc.includes(x.id) && x.id !== nodeId && x.type !== 'ending').map((x) => x.id)
  const k = Math.max(1, Math.min(6, o.count || (mode === 'branch' ? 3 : 3)))
  const task = mode === 'branch'
    ? `在博弈锚点「${n.title}」（id=${n.id}）上新增 1 个选项分支：一条从 ${n.id} 出发的 option 边（带 label/hint）+ ${k} 个以内的新节点。新支线的结尾要么连到已有节点形成汇合（可选：${later.slice(0, 20).join(',') || '无'}），要么以新结局收尾。已有选项：${outs.map((e) => e.label).join('、')}，新选项必须和它们明显不同。`
    : mode === 'loop'
      ? `把「${n.title}」（id=${n.id}）之后插入一个 loop 时间裂隙节点：它有一条 back 边回到上游节点（可选：${anc.slice(0, 20).join(',')}），并有 1~2 条 option 前进出口（连到 ${outs.map((e) => e.to).join(',') || '新结局'}）。回溯要有剧情理由（例如主角获得了重来的机会但要付出代价）。`
      : `从「${n.title}」（id=${n.id}${n.type === 'ending' ? '，当前是结局，将被改为场景续写' : ''}）继续往后写 ${k} 个以内的新节点，至少包含 1 个 choice 锚点，结尾连到已有节点（${later.slice(0, 20).join(',') || '无'}）或新结局。`
  const system = `你是互动博弈短剧的结构设计师，负责在现有结构图上做「增量延展」。${RULES}\n只输出新增部分：{"nodes":[新节点，id 用 x1,x2…],"edges":[新边，from/to 可以引用已有节点 id 或新节点 id]}。不要重复已有节点。`
  const prompt = `${worldBrief(bible, brief)}\n\n现有结构图：${JSON.stringify(G.compact(g)).slice(0, 9000)}\n\n当前节点上下文：${[...anc.slice(-4).map((id) => by.get(id)?.title), n.title].join(' → ')}：${n.beat || ''}\n\n任务：${task}${o.hint ? `\n编剧补充要求：${String(o.hint).slice(0, 300)}` : ''}`
  const build = (d: any) => {
    const base = G.normalize(g)
    if (mode === 'continue' && n.type === 'ending') { const bn = base.nodes.find((x) => x.id === nodeId)!; bn.type = 'scene'; delete bn.tier }
    if (mode === 'loop') { // 插入：原出边改由 loop 接管
      const origOuts = base.edges.filter((e) => e.from === nodeId && e.kind !== 'back'); base.edges = base.edges.filter((e) => !origOuts.includes(e))
    }
    const { graph: m, newIds } = G.mergeInto(base, d, 'n'); (m as any)._new = newIds
    return G.layout(m, newIds)
  }
  const res = await askGraph(env, u, pid, system, prompt, build)
  const newIds = [...(((res.graph as any)._new as Set<string>) || [])]; delete (res.graph as any)._new
  return { proposal: res.graph, added: newIds, analysis: res.analysis, runs: res.runs, fixes: res.fixes }
}
