// Agent-2 · 子模块开发师 —— WF-02 变体池批量生成 / WF-05 补货（差异化指令 → 生成 → 去重 → 评分 → 入池）
import { uid } from '../core/crypto'
import { callCapability, type Bindings } from '../gateway/llm'

const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

/** 字符 bigram Jaccard 相似度（台词去重 ≥0.85 视为重复） */
export function similarity(a: string, b: string) {
  const g = (s: string) => { const x = new Set<string>(); const t = s.replace(/\s/g, ''); for (let i = 0; i < t.length - 1; i++) x.add(t.slice(i, i + 2)); return x }
  const A = g(a), B = g(b)
  if (!A.size || !B.size) return 0
  let inter = 0; A.forEach((x) => B.has(x) && inter++)
  return inter / (A.size + B.size - inter)
}
const linesText = (lines: any[]) => (lines || []).map((l) => l.text).join('')

export async function waterLevels(env: Bindings, seriesId?: string) {
  const rows = (await env.DB.prepare(
    `SELECT o.id, o.label, o.node_id, o.target_variants, o.story_weight, n.status node_status,
      SUM(CASE WHEN v.status='pool' THEN 1 ELSE 0 END) pool, SUM(CASE WHEN v.status='reserve' THEN 1 ELSE 0 END) reserve,
      SUM(CASE WHEN v.status='pool' AND v.video_status='ready' THEN 1 ELSE 0 END) video_ready, SUM(v.plays) plays
     FROM outcomes o JOIN nodes n ON n.id=o.node_id LEFT JOIN variants v ON v.outcome_id=o.id
     ${seriesId ? 'WHERE n.series_id=?' : ''} GROUP BY o.id ORDER BY n.ord, o.story_weight DESC`
  ).bind(...(seriesId ? [seriesId] : [])).all()).results as any[]
  return rows.map((r) => {
    const ratio = r.pool / (r.target_variants || 4)
    return { ...r, ratio, level: r.pool < 2 || ratio < 0.3 ? 'red' : ratio < 0.6 ? 'yellow' : ratio < 1 ? 'green-' : 'green' }
  })
}

export async function generateVariants(env: Bindings, outcomeId: string, count = 2, source = 'agent2') {
  const o: any = await env.DB.prepare('SELECT o.*, n.question, n.series_id FROM outcomes o JOIN nodes n ON n.id=o.node_id WHERE o.id=?').bind(outcomeId).first()
  if (!o) throw new Error('outcome not found')
  const series: any = await env.DB.prepare('SELECT world_bible FROM series WHERE id=?').bind(o.series_id).first()
  const existing = (await env.DB.prepare(`SELECT title,angle,lines FROM variants WHERE outcome_id=? AND status IN ('pool','reserve')`).bind(outcomeId).all()).results as any[]
  const prompt = `你是互动剧“调度 Agent + 编剧 Agent”。世界观圣经：${series?.world_bible}
Cash 节点问题：「${o.question}」，本结局簇（因果必须保持一致）：「${o.label}」。
已有变体切入点（新变体必须避开，采用全新切入点：不同视角/节奏/道具细节/时间顺序）：${existing.map((e) => e.angle).join('；')}
请生成 ${count} 个新变体，每个 {title(≤10字), angle(≤16字), lines:[{speaker,text(≤28字),mood}] 3-4句, shot(≤30字)}。speaker ∈ 旁白/林夏/陈默/渡鸦/林小雨(电话)。
可在一句台词中使用占位符 {nick} 代表正在观看的玩家昵称（如“{nick}，你押对了吗”由旁白说），最多一次。
只输出 JSON：{"variants":[...]}`
  const res = await callCapability(env, {
    capability: 'dialogue', tier: 'standard', priority: source === 'replenish' ? 'P1' : 'P2', agent: 2, ref: outcomeId, json: true, prompt,
    fallback: () => ({ variants: Array.from({ length: count }, (_, i) => ({
      title: `模板变体${i + 1}`, angle: '模板兜底切入', shot: '中景缓推，雨幕',
      lines: [{ speaker: '旁白', text: `雨声里，结局已定：${o.label}`, mood: '紧张' }, { speaker: '旁白', text: '{nick}，这一次故事不同。', mood: '悬念' }]
    })) })
  })
  const out: any[] = []
  const pool = existing.map((e) => linesText(J(e.lines, [])))
  for (const v of (res.data?.variants || []).slice(0, count)) {
    const txt = linesText(v.lines)
    const maxSim = Math.max(0, ...pool.map((p) => similarity(p, txt)))
    const dup = maxSim >= 0.85
    // 质量评分（规则版：句数、长度、角色覆盖、禁区词）
    const banned = /(血腥|肢解|未成年)/.test(txt)
    const speakers = new Set((v.lines || []).map((l: any) => l.speaker)).size
    const score = Math.round(Math.min(95, 60 + (v.lines?.length || 0) * 5 + speakers * 4 - maxSim * 30 - (banned ? 50 : 0)))
    const status = dup || banned ? 'rejected' : score >= 75 ? 'pool' : 'review'
    const id = `${outcomeId}_${uid('g')}`
    await env.DB.prepare('INSERT INTO variants (id,outcome_id,title,angle,lines,shot,score,status,source) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, outcomeId, v.title, v.angle, JSON.stringify(v.lines), v.shot, score, status, source).run()
    if (status === 'pool') pool.push(txt)
    out.push({ id, title: v.title, angle: v.angle, score, status, max_similarity: Math.round(maxSim * 100) / 100 })
  }
  await env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (2,?,?,?,?)')
    .bind('generate_variants', res.degraded ? 'degraded' : 'ok', `${outcomeId} +${out.filter((x) => x.status === 'pool').length} 入池 / ${out.length} 生成 · model=${res.model}`, Date.now()).run()
  return { outcome_id: outcomeId, model: res.model, degraded: res.degraded, task_id: res.task_id, variants: out }
}

/** WF-05 补货：红/黄水位自动扇出；休眠节点不补 */
export async function replenish(env: Bindings, seriesId: string, maxOutcomes = 2) {
  const levels = (await waterLevels(env, seriesId)).filter((l) => l.node_status !== 'dormant' && (l.level === 'red' || l.level === 'yellow'))
    .sort((a, b) => a.ratio - b.ratio).slice(0, maxOutcomes)
  const results = await Promise.all(levels.map((l) => generateVariants(env, l.id, Math.max(1, Math.min(3, (l.target_variants || 4) - l.pool)), 'replenish')))
  return { replenished: results, checked: levels.length }
}
