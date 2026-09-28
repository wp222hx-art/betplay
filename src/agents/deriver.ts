// Agent-7 · 剧本衍生与诗词提炼师
// ① WF-06 剧情延展：状态摘要 + 圣经 → N 候选 → 六维评分 → 分流 → 写入画布（血肉层）
// ② 诗词提炼：为剧集 / 每个结局簇生成绝句，作为分支“题眼”与战报文案
// ③ 全网决策类目监管：聚合平台下注 + 外部平台信号，识别一边倒 / 与 story_weight 偏离 → 调整建议
// ④ 对弈片对优化：把剧本压缩/扩展成“可对弈的片对数量”（每个 Cash 节点 = 1 问题 × N 结局簇 × M 变体）
import { uid } from '../core/crypto'
import { callCapability, type Bindings } from '../gateway/llm'

const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const log = (env: Bindings, action: string, status: string, detail: string) =>
  env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (7,?,?,?,?)').bind(action, status, detail, Date.now()).run()

// ─────────────── ③ 全网决策类目监管 ───────────────
export async function regulate(env: Bindings, seriesId: string) {
  const rows = (await env.DB.prepare(
    `SELECT n.id node_id, n.question, n.status, o.id outcome_id, o.label, o.category, o.story_weight,
       COALESCE(SUM(CASE WHEN s.source='platform' THEN s.votes END),0) platform,
       COALESCE(SUM(CASE WHEN s.source!='platform' THEN s.votes END),0) external
     FROM nodes n JOIN outcomes o ON o.node_id=n.id LEFT JOIN decision_signals s ON s.outcome_id=o.id
     WHERE n.series_id=? AND n.kind='cash' GROUP BY o.id ORDER BY n.ord, o.id`).bind(seriesId).all()).results as any[]
  const reach = (await env.DB.prepare(
    `SELECT node_id, outcome_id, COUNT(*) n FROM rounds WHERE series_id=? AND state IN ('SETTLE','NEXT') GROUP BY node_id, outcome_id`).bind(seriesId).all()).results as any[]
  const bySource = (await env.DB.prepare(
    `SELECT s.node_id, s.source, s.outcome_id, SUM(s.votes) v FROM decision_signals s JOIN nodes n ON n.id=s.node_id WHERE n.series_id=? GROUP BY s.node_id, s.source, s.outcome_id`).bind(seriesId).all()).results as any[]
  const nodes: Record<string, any> = {}
  for (const r of rows) {
    const n = (nodes[r.node_id] ||= { node_id: r.node_id, question: r.question, status: r.status, outcomes: [], totals: { platform: 0, external: 0, rounds: 0 } })
    const rc = reach.find((x) => x.node_id === r.node_id && x.outcome_id === r.outcome_id)?.n || 0
    n.outcomes.push({ ...r, rounds: rc })
    n.totals.platform += r.platform; n.totals.external += r.external; n.totals.rounds += rc
  }
  const categories: Record<string, number> = {}
  const report = Object.values(nodes).map((n: any) => {
    const cold = n.totals.platform + n.totals.external === 0
    const all = n.totals.platform + n.totals.external || 1
    // 冷启动：尚无信号时以 story_weight 作为先验分布
    const shares = n.outcomes.map((o: any) => cold ? o.story_weight : (o.platform + o.external) / all)
    // 分歧度：1 − |p_max − p_min| 的归一化熵，越接近 1 越“扎心”
    const H = -shares.reduce((a: number, p: number) => a + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(shares.length)
    const maxShare = Math.max(...shares)
    const alerts: string[] = []
    const actions: string[] = []
    if (cold) actions.push('冷启动：暂无全网信号，按 story_weight 先验评估，建议投放阅览表内测采集决策')
    if (!cold && maxShare > 0.9) { alerts.push('P0 单边下注 >90%'); actions.push('暂停开盘 → 风控排查串谋 → 博弈师确认') }
    else if (!cold && maxShare > 0.65) { alerts.push('一边倒 >65%'); actions.push('上调冷门结局赔率/增加暗示张力，或插入“加倍反转”节点') }
    if (H > 0.95) actions.push('分歧度极高 → 推荐升级为 Arena 同场局，并由 WF-06 加深该分支')
    // 实际到达率 vs story_weight 偏差（长期偏差超阈值告警，可解释公平）
    const devs = n.outcomes.map((o: any) => ({ id: o.outcome_id, actual: n.totals.rounds ? o.rounds / n.totals.rounds : null, expect: o.story_weight }))
    const bigDev = n.totals.rounds >= 30 ? devs.filter((d: any) => Math.abs(d.actual - d.expect) > 0.15) : []
    if (bigDev.length) alerts.push('到达率偏离 story_weight >15%（样本≥30）')
    // 外部 vs 平台 意见分裂：外部舆论热门 ≠ 平台热门
    const topExt = [...n.outcomes].sort((a: any, b: any) => b.external - a.external)[0]
    const topPlat = [...n.outcomes].sort((a: any, b: any) => b.platform - a.platform)[0]
    const split = n.totals.platform > 5 && topExt.outcome_id !== topPlat.outcome_id
    if (split) actions.push(`全网偏好「${topExt.label}」，站内偏好「${topPlat.label}」→ 可做“全网 vs 站内”对赌话题`)
    n.outcomes.forEach((o: any) => (categories[o.category] = (categories[o.category] || 0) + o.platform + o.external))
    return {
      ...n, cold, divergence: Math.round(H * 1000) / 1000, max_share: Math.round(maxShare * 1000) / 1000,
      shares: n.outcomes.map((o: any, i: number) => ({ outcome_id: o.outcome_id, label: o.label, category: o.category, share: Math.round(shares[i] * 1000) / 1000, weight: o.story_weight })),
      deviation: devs, alerts, actions, split,
      sources: bySource.filter((s) => s.node_id === n.node_id)
    }
  })
  return { series_id: seriesId, categories, nodes: report, generated_at: Date.now() }
}

/** 模拟外部平台信号注入（真实环境对接抖音/小红书/B站评论竞猜 API） */
export async function ingestSignals(env: Bindings, seriesId: string, items: { node_id: string; outcome_id: string; source: string; votes: number }[]) {
  const stmts = items.map((i) => env.DB.prepare(
    'INSERT INTO decision_signals (series_id,node_id,outcome_id,category,source,votes,created_at) SELECT ?,?,id,category,?,?,? FROM outcomes WHERE id=?'
  ).bind(seriesId, i.node_id, i.source, Math.max(0, Math.floor(i.votes)), Date.now(), i.outcome_id))
  if (stmts.length) await env.DB.batch(stmts)
  return { ingested: stmts.length }
}

// ─────────────── ④ 对弈片对数量优化 ───────────────
export async function clipPairs(env: Bindings, seriesId: string, opts: { budget_clips?: number; min_variants?: number } = {}) {
  const reg = await regulate(env, seriesId)
  const budget = opts.budget_clips || 60
  const minV = opts.min_variants || 3
  // 每个节点的“对弈价值” = 分歧度 × (1 + 热度占比)；按价值分配变体预算（片 = 一个结局簇下的一个可播变体）
  const totalVotes = reg.nodes.reduce((a: number, n: any) => a + n.totals.platform + n.totals.external, 0) || 1
  const valued = reg.nodes.map((n: any) => ({ n, value: n.divergence * (1 + (n.totals.platform + n.totals.external) / totalVotes) }))
  const sumV = valued.reduce((a: number, x: any) => a + x.value, 0) || 1
  const plan = valued.map(({ n, value }: any) => {
    const k = n.outcomes.length
    const nodeBudget = Math.max(k * minV, Math.round((budget * value) / sumV))
    // 结局簇内按“存在感”分配：更可能被抽中（story_weight）与更受关注（share）的结局需要更多变体防重复
    const alloc = n.shares.map((s: any) => ({ outcome_id: s.outcome_id, label: s.label, variants: Math.max(minV, Math.round(nodeBudget * (0.7 * s.weight + 0.3 * s.share))) }))
    const clips = alloc.reduce((a: number, x: any) => a + x.variants, 0)
    return {
      node_id: n.node_id, question: n.question, outcomes: k, divergence: n.divergence, value: Math.round(value * 1000) / 1000,
      clip_pairs: k * (k - 1) / 2, // 可对弈“片对”：任意两个结局簇构成一组对立押注
      clips, alloc,
      recommendation: n.cold ? '冷启动：按先验分配最低片数，待信号回流后重算' : n.divergence < 0.6 ? '分歧度低 → 合并为二选一或调整权重，减少片数' : n.divergence > 0.95 ? '高价值 → 增加变体防重复，并考虑追加“加倍反转”子节点' : '维持'
    }
  })
  const totalClips = plan.reduce((a: number, p: any) => a + p.clips, 0)
  // 组合路径数（剧本可对弈的完整局路径）
  const paths = plan.reduce((a: number, p: any) => a * p.outcomes, 1)
  return { series_id: seriesId, budget_clips: budget, total_clips: totalClips, total_clip_pairs: plan.reduce((a: number, p: any) => a + p.clip_pairs, 0), full_paths: paths, plan }
}

/** 将片数规划应用到变体池目标库存（target_variants），驱动 WF-05 补货 */
export async function applyClipPlan(env: Bindings, seriesId: string, budget?: number) {
  const cp = await clipPairs(env, seriesId, { budget_clips: budget })
  const stmts = cp.plan.flatMap((p: any) => p.alloc.map((a: any) => env.DB.prepare('UPDATE outcomes SET target_variants=? WHERE id=?').bind(a.variants, a.outcome_id)))
  await env.DB.batch(stmts)
  await log(env, 'apply_clip_plan', 'ok', `目标片数 ${cp.total_clips}，对弈片对 ${cp.total_clip_pairs}，完整路径 ${cp.full_paths}`)
  return cp
}

// ─────────────── ② 诗词提炼 ───────────────
export async function generatePoems(env: Bindings, seriesId: string) {
  const outs = (await env.DB.prepare(`SELECT o.id, o.label, o.category, n.question FROM outcomes o JOIN nodes n ON n.id=o.node_id WHERE n.series_id=? ORDER BY n.ord`).bind(seriesId).all()).results as any[]
  const s: any = await env.DB.prepare('SELECT title, logline FROM series WHERE id=?').bind(seriesId).first()
  const prompt = `你是精通格律的诗人兼互动剧文案官。剧名《${s.title}》：${s.logline}
请为以下每个“押注结局”写一首七言绝句，并为整部剧写一首卷首诗。严格要求：
1. 每首 4 句，每句恰好 7 个汉字，不含标点；
2. 第 2、4 句押平声韵（第 1 句可押可不押），韵脚字不得相同，全诗不得有两句以同一字结尾；
3. 讲究起承转合：一句写景、二句写人、三句转折、四句余韵；意象取雨夜、天台、霓虹、孤灯、风、刃、鸦等；
4. 暗合结局意味但不直白剧透，不出现“U盘”等现代词，语言典雅凝练，杜绝生造词与凑字。
示例（勿照抄）：高楼风急雨如麻，一纸孤证系天涯。回眸不语灯先暗，谁把人心换落花。
结局列表：${outs.map((o) => `${o.id}=「${o.question}」→「${o.label}」`).join('；')}
只输出 JSON：{"series":"四句用\\n分隔","outcomes":{"<id>":"四句用\\n分隔"}}`
  const valid = (p: string) => {
    const L = String(p || '').split(/\n|[，。,.！？；]/).map((x) => x.replace(/[^\u4e00-\u9fa5]/g, '')).filter(Boolean)
    return L.length === 4 && L.every((l) => l.length === 7) && new Set(L.map((l) => l.slice(-1))).size === 4
  }
  const norm = (p: string) => String(p).split(/\n|[，。,.！？；]/).map((x) => x.replace(/[^\u4e00-\u9fa5]/g, '')).filter(Boolean).join('\n')
  const res = await callCapability(env, {
    capability: 'poem', tier: 'standard', priority: 'P3', agent: 7, ref: seriesId, json: true, prompt,
    fallback: () => ({ series: '三十八层雨未歇，一枚孤证系生灭。\n你押人心向何处，天台风起已先决。', outcomes: Object.fromEntries(outs.map((o) => [o.id, `雨落高楼夜未央，一念${o.label}定行藏。\n押来筹码皆心事，揭晓方知梦一场。`])) })
  })
  // 格律校验（Critic Loop）：不合格的单首重写一次，仍不合格则保留旧诗
  const data = res.data || {}
  const bad = Object.entries<any>(data.outcomes || {}).filter(([, p]) => !valid(p)).map(([id]) => id)
  if (!valid(data.series)) bad.push('__series')
  let fixed = 0
  if (bad.length && !res.degraded) {
    const re = await callCapability(env, {
      capability: 'poem', tier: 'standard', priority: 'P3', agent: 7, ref: seriesId, json: true,
      prompt: prompt + `\n\n上一版以下条目不合格律（句数/字数/韵脚重复），请只重写这些条目：${bad.join('、')}（__series 表示卷首诗）。输出同样 JSON 结构，只包含这些键。`
    })
    if (re.ok && re.data) {
      if (re.data.series && valid(re.data.series)) { data.series = re.data.series; fixed++ }
      for (const [id, p] of Object.entries<any>(re.data.outcomes || {})) if (valid(p)) { data.outcomes[id] = p; fixed++ }
    }
  }
  const stmts: D1PreparedStatement[] = []
  if (data.series && valid(data.series)) stmts.push(env.DB.prepare('UPDATE series SET poem=? WHERE id=?').bind(norm(data.series), seriesId))
  for (const [id, poem] of Object.entries<any>(data.outcomes || {})) if (valid(poem)) stmts.push(env.DB.prepare('UPDATE outcomes SET poem=? WHERE id=?').bind(norm(poem), id))
  if (stmts.length) await env.DB.batch(stmts)
  await log(env, 'poems', res.degraded ? 'degraded' : 'ok', `提炼诗词 ${stmts.length} 首入库（格律不合 ${bad.length}，重写修复 ${fixed}）· model=${res.model}`)
  return { model: res.model, degraded: res.degraded, accepted: stmts.length, rewritten: fixed, series: data.series, outcomes: data.outcomes }
}

// ─────────────── ① WF-06 剧情延展 ───────────────
export async function derive(env: Bindings, seriesId: string, p: { anchor?: string; trigger?: string; n?: number } = {}) {
  const series: any = await env.DB.prepare('SELECT * FROM series WHERE id=?').bind(seriesId).first()
  const reg = await regulate(env, seriesId)
  // 自动选锚点：分歧度最高（最有下注价值）的 Cash 节点
  const anchor = p.anchor || [...reg.nodes].sort((a: any, b: any) => b.divergence - a.divergence)[0]?.node_id
  const anchorNode: any = reg.nodes.find((n: any) => n.node_id === anchor)
  const tree = (await env.DB.prepare('SELECT id,kind,title,question,layer FROM nodes WHERE series_id=? ORDER BY ord').bind(seriesId).all()).results
  const n = p.n || 3
  const prompt = `你是 MoMocash剧场 剧情延展 Agent（编剧 Agent + 博弈师 Agent + 评审模型）。
世界观圣经（不可违背）：${series.world_bible}
当前剧情树：${JSON.stringify(tree)}
锚点 Cash 节点：${anchor}「${anchorNode?.question}」，全网决策分布：${JSON.stringify(anchorNode?.shares)}
请在该锚点之后生成 ${n} 个“下一幕”候选，每个必须：可在 K=3 个 Cash 节点内收束回主干；给出一个新的押注问题(≤24字，不暗示结果)与 3 个结局簇（权重和=1，单项≤0.6，保证悬念）。
并以评审模型身份六维打分(0-10)：consistency 一致性, tension 戏剧张力, bet_value 下注价值(悬念均衡), convergence 收束距离, compliance 合规安全, cost 制作成本友好。
每个候选附一句七言诗句 verse 作为该幕题眼。
只输出 JSON：{"candidates":[{"title","scene":"≤60字场景","conflict":"≤30字","question","outcomes":[{"label","weight","category"}],"scores":{"consistency","tension","bet_value","convergence","compliance","cost"},"verse"}]}`
  const res = await callCapability(env, {
    capability: 'outline', tier: 'standard', priority: 'P2', agent: 7, ref: anchor, json: true, prompt,
    fallback: () => ({ candidates: [{
      title: '渡鸦的来电', scene: '黎明前，林夏的手机亮起，来电显示是渡鸦。', conflict: '接还是不接',
      question: '林夏会接起渡鸦的电话吗？', outcomes: [{ label: '接听', weight: 0.45, category: 'risk' }, { label: '挂断', weight: 0.4, category: 'escape' }, { label: '交给陈默', weight: 0.15, category: 'trust' }],
      scores: { consistency: 7, tension: 7, bet_value: 7, convergence: 8, compliance: 9, cost: 8 }, verse: '一声来电破残宵'
    }] })
  })
  const W = { consistency: 0.25, tension: 0.2, bet_value: 0.25, convergence: 0.1, compliance: 0.1, cost: 0.1 }
  const cands = (res.data?.candidates || []).map((c: any) => {
    // 权重修正：和为 1、单项 ≤ 0.9（PRD 校验规则）
    let ws = (c.outcomes || []).map((o: any) => Math.min(0.9, Math.max(0.05, Number(o.weight) || 0.33)))
    const sum = ws.reduce((a: number, b: number) => a + b, 0)
    ws = ws.map((w: number) => Math.round((w / sum) * 100) / 100)
    c.outcomes = (c.outcomes || []).map((o: any, i: number) => ({ ...o, weight: ws[i] }))
    const total = Object.entries(W).reduce((a, [k, w]) => a + w * (Number(c.scores?.[k]) || 0), 0)
    const autoPass = total >= 7.5 && (Number(c.scores?.compliance) || 0) >= 8
    return { ...c, total: Math.round(total * 100) / 100, route: autoPass ? 'auto_pass' : 'human_review' }
  }).sort((a: any, b: any) => b.total - a.total)
  const id = uid('ext_')
  await env.DB.prepare('INSERT INTO extensions (id,series_id,anchor_node_id,trigger,candidates,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, seriesId, anchor, p.trigger || 'manual', JSON.stringify(cands), 'pending', Date.now()).run()
  await log(env, 'derive', res.degraded ? 'degraded' : 'ok', `锚点 ${anchor} 生成 ${cands.length} 个延展候选 · model=${res.model}`)
  return { extension_id: id, anchor, model: res.model, degraded: res.degraded, candidates: cands }
}

/** 编剧采纳 → 写入画布（血肉层）：新增 scene + cash 节点 + 结局簇 + 每簇 1 个兜底变体（其余由 WF-05 补货） */
export async function approveExtension(env: Bindings, extId: string, idx: number) {
  const ext: any = await env.DB.prepare('SELECT * FROM extensions WHERE id=?').bind(extId).first()
  if (!ext) throw new Error('extension not found')
  const c = J(ext.candidates, [])[idx]
  if (!c) throw new Error('candidate not found')
  const active = await env.DB.prepare(`SELECT COUNT(*) n FROM nodes WHERE series_id=? AND kind='cash' AND status='active'`).bind(ext.series_id).first<any>()
  if (active.n >= 12) throw new Error('组合预算：单集活跃 Cash 节点 ≥ 12，拒绝延展')
  const anchor: any = await env.DB.prepare('SELECT ord FROM nodes WHERE id=?').bind(ext.anchor_node_id).first()
  const ord = (anchor?.ord ?? 0) + 0.5
  const sid = uid('XS'), cid = uid('XC')
  const cfg = { window_sec: 12, odds_mode: 'fixed', rake: 0.08, min_bet: 10, rewind: { allowed: true, max_times: 2, tax: 1.5 }, currency: ['chips'], compliance: { age: 18, regions: ['GLOBAL'] } }
  const stmts = [
    env.DB.prepare(`INSERT INTO nodes (id,series_id,kind,ord,title,lines,layer) VALUES (?,?,?,?,?,?,'flesh')`).bind(sid, ext.series_id, 'scene', ord, c.title,
      JSON.stringify([{ speaker: '旁白', text: String(c.scene).slice(0, 60), mood: '悬念' }, { speaker: '旁白', text: String(c.conflict).slice(0, 30), mood: '紧张' }])),
    env.DB.prepare(`INSERT INTO nodes (id,series_id,kind,ord,title,question,config,layer) VALUES (?,?,?,?,?,?,?,'flesh')`).bind(cid, ext.series_id, 'cash', ord + 0.1, c.question, c.question, JSON.stringify(cfg))
  ]
  c.outcomes.forEach((o: any, i: number) => {
    const oid = `${cid}_o${i}`
    stmts.push(env.DB.prepare('INSERT INTO outcomes (id,node_id,label,hint,story_weight,category,poem) VALUES (?,?,?,?,?,?,?)').bind(oid, cid, o.label, c.verse || '', o.weight, o.category || 'other', c.verse || null))
    stmts.push(env.DB.prepare('INSERT INTO variants (id,outcome_id,title,angle,lines,shot,is_fallback,score,source) VALUES (?,?,?,?,?,?,1,76,?)').bind(
      `${oid}_fb`, oid, '通用兜底', '简洁揭晓', JSON.stringify([{ speaker: '旁白', text: `结果揭晓：${o.label}`, mood: '决断' }, { speaker: '旁白', text: c.verse || '这一次，故事不同。', mood: '余韵' }]), '中景定格后缓推', 'extend'))
  })
  stmts.push(env.DB.prepare(`UPDATE extensions SET status='written', chosen=? WHERE id=?`).bind(idx, extId))
  await env.DB.batch(stmts)
  await log(env, 'approve_extension', 'ok', `写入画布：${sid} + ${cid}「${c.question}」`)
  return { scene_id: sid, cash_id: cid, question: c.question }
}
