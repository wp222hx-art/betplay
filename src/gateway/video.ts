// Agent-3 · 视频模型选型路由 + 预判（投机）生成 + 存储
// 选型五维：质量 / 人物一致性 / 成本每秒 / 排队时延 / 运镜可控；按档位加权打分
import { uid } from '../core/crypto'
import type { Bindings } from './llm'

export const VIDEO_MODELS = [
  { id: 'seedance-2.0', vendor: 'ByteDance', quality: 9.0, consistency: 8.8, cost_per_sec: 0.10, queue_sec: 90, camera: 9, max_sec: 15, audio: true, fal: 'fal-ai/bytedance/seedance/v1/pro/text-to-video' },
  { id: 'kling-v3', vendor: 'Kuaishou', quality: 9.2, consistency: 9.0, cost_per_sec: 0.14, queue_sec: 150, camera: 9, max_sec: 15, audio: true, fal: 'fal-ai/kling-video/v2.1/master/text-to-video' },
  { id: 'veo-3.1', vendor: 'Google', quality: 9.5, consistency: 8.5, cost_per_sec: 0.40, queue_sec: 120, camera: 8, max_sec: 8, audio: true, fal: 'fal-ai/veo3' },
  { id: 'hailuo-h3', vendor: 'MiniMax', quality: 8.6, consistency: 8.2, cost_per_sec: 0.06, queue_sec: 60, camera: 8, max_sec: 10, audio: false, fal: 'fal-ai/minimax/hailuo-02/standard/text-to-video' },
  { id: 'wan-2.7', vendor: 'Alibaba', quality: 8.0, consistency: 7.8, cost_per_sec: 0.03, queue_sec: 45, camera: 7, max_sec: 5, audio: false, fal: 'fal-ai/wan-t2v' },
  { id: 'motion-still', vendor: 'DreamForge 内置', quality: 5.5, consistency: 10, cost_per_sec: 0, queue_sec: 0, camera: 6, max_sec: 60, audio: false, fal: '' }
]

const WEIGHTS: Record<string, Record<string, number>> = {
  draft: { quality: 0.15, consistency: 0.15, cost: 0.4, queue: 0.25, camera: 0.05 },
  standard: { quality: 0.3, consistency: 0.25, cost: 0.25, queue: 0.1, camera: 0.1 },
  premium: { quality: 0.45, consistency: 0.3, cost: 0.05, queue: 0.05, camera: 0.15 },
  realtime: { quality: 0.1, consistency: 0.2, cost: 0.1, queue: 0.6, camera: 0 }
}

export function rankVideoModels(tier: keyof typeof WEIGHTS = 'standard', durationSec = 6, health: Record<string, number> = {}) {
  const w = WEIGHTS[tier] || WEIGHTS.standard
  return VIDEO_MODELS.filter((m) => m.max_sec >= durationSec || m.id === 'motion-still')
    .map((m) => {
      const s =
        w.quality * m.quality + w.consistency * m.consistency + w.cost * (10 - Math.min(10, m.cost_per_sec * 25)) +
        w.queue * (10 - Math.min(10, m.queue_sec / 20)) + w.camera * m.camera
      const penalty = (health[m.id] ?? 0) * 3 // 失败率惩罚
      return { ...m, score: Math.round((s - penalty) * 100) / 100, est_cost: Math.round(m.cost_per_sec * durationSec * 100) / 100 }
    })
    .sort((a, b) => b.score - a.score)
}

export function buildVideoPrompt(v: any, outcomeLabel: string, bible: any) {
  const lines = (() => { try { return JSON.parse(v.lines) } catch { return [] } })()
  return [
    `Cinematic vertical 9:16 shot, near-future rainy cyberpunk city rooftop, 38th floor, neon reflections, heavy rain.`,
    `Characters: Lin Xia (calm female data broker, black trench coat, short hair), Chen Mo (weary male detective, grey coat).`,
    `Beat: ${outcomeLabel}. Camera: ${v.shot}. Angle: ${v.angle}.`,
    `Mood: ${lines.map((l: any) => l.mood).join(', ')}. No text, no gore, consistent faces.`,
    bible?.era ? `World: ${bible.era}` : ''
  ].join(' ')
}

/** 预判生成：根据全网决策信号预测最可能被到达的结局簇，优先为其变体排队生成视频 */
export async function predictiveQueue(env: Bindings, seriesId: string, opts: { tier?: string; limit?: number; dryRun?: boolean } = {}) {
  const tier = (opts.tier || 'standard') as any
  const sig = (await env.DB.prepare(
    `SELECT o.id outcome_id, o.label, o.node_id, o.story_weight, COALESCE(SUM(s.votes),0) votes
     FROM outcomes o JOIN nodes n ON n.id=o.node_id LEFT JOIN decision_signals s ON s.outcome_id=o.id
     WHERE n.series_id=? GROUP BY o.id`).bind(seriesId).all()).results as any[]
  const byNode: Record<string, number> = {}
  sig.forEach((s) => (byNode[s.node_id] = (byNode[s.node_id] || 0) + s.votes))
  // 到达概率 = story_weight（真实抽取概率）；关注热度 = 投票占比 → 二者融合为预判优先级
  const ranked = sig.map((s) => ({ ...s, heat: byNode[s.node_id] ? s.votes / byNode[s.node_id] : 0, priority: 0 }))
    .map((s) => ({ ...s, priority: Math.round((0.6 * s.story_weight + 0.4 * s.heat) * 1000) / 1000 }))
    .sort((a, b) => b.priority - a.priority)
  const series: any = await env.DB.prepare('SELECT world_bible FROM series WHERE id=?').bind(seriesId).first()
  const bible = (() => { try { return JSON.parse(series?.world_bible) } catch { return {} } })()
  const health = await modelHealth(env)
  const models = rankVideoModels(tier, 6, health)
  const plan: any[] = []
  for (const s of ranked) {
    const vs = (await env.DB.prepare(`SELECT * FROM variants WHERE outcome_id=? AND status='pool' AND video_status IN ('none','failed') ORDER BY is_fallback DESC, score DESC`).bind(s.outcome_id).all()).results as any[]
    for (const v of vs) {
      if (plan.length >= (opts.limit || 6)) break
      // 兜底变体永远用 motion-still（零成本、零失败），保证每个结局簇都能播
      const model = v.is_fallback ? models.find((m) => m.id === 'motion-still')! : models.find((m) => m.id !== 'motion-still')!
      plan.push({ variant_id: v.id, outcome: s.label, priority: s.priority, model: model.id, est_cost: model.est_cost, prompt: buildVideoPrompt(v, s.label, bible) })
    }
  }
  if (!opts.dryRun) {
    for (const p of plan) await submitVideo(env, p.variant_id, p.model, p.prompt, p.priority > 0.4 ? 'P1' : 'P2')
  }
  return { tier, model_ranking: models, prediction: ranked, plan }
}

export async function submitVideo(env: Bindings, variantId: string, modelId: string, prompt: string, priority = 'P2') {
  const m = VIDEO_MODELS.find((x) => x.id === modelId) || VIDEO_MODELS[VIDEO_MODELS.length - 1]
  const task = uid('vtask_')
  const t = Date.now()
  let status = 'queued', url: string | null = null, reason: string | null = null, output: any = null
  if (m.id === 'motion-still') {
    status = 'ready'; url = `motion://${variantId}` // 播放器以“静帧 + 运镜 + 粒子”程序化渲染
  } else if (env.FAL_KEY && m.fal) {
    try {
      const r = await fetch(`https://queue.fal.run/${m.fal}`, {
        method: 'POST', headers: { Authorization: 'Key ' + env.FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, aspect_ratio: '9:16', duration: '5' })
      })
      output = await r.json()
      status = r.ok ? 'running' : 'failed'
      if (!r.ok) reason = 'provider ' + r.status
    } catch (e: any) { status = 'failed'; reason = String(e.message) }
  } else {
    // 未配置供应商密钥：按设计降级为“静帧运镜动画”，保证可播
    status = 'degraded'; url = `motion://${variantId}`; reason = '未配置 FAL_KEY，降级为静帧+运镜动画'
  }
  await env.DB.prepare('INSERT INTO gen_tasks (id,capability,provider,model,priority,tier,status,agent_no,ref_id,input,output,cost,degrade_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(task, 'video', m.vendor, m.id, priority, 'standard', status, 3, variantId, prompt, output ? JSON.stringify(output).slice(0, 2000) : null,
      status === 'degraded' ? 0 : Math.round(m.cost_per_sec * 5 * 100) / 100, reason, t, t).run()
  await env.DB.prepare('UPDATE variants SET video_model=?, video_status=?, video_url=?, video_prompt=? WHERE id=?')
    .bind(m.id, status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'ready', url, prompt, variantId).run()
  return { task_id: task, status, model: m.id, reason }
}

export async function modelHealth(env: Bindings) {
  const rows = (await env.DB.prepare(`SELECT model, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)*1.0/COUNT(*) fr FROM gen_tasks WHERE capability='video' GROUP BY model`).all()).results as any[]
  const h: Record<string, number> = {}
  rows.forEach((r) => (h[r.model] = r.fr))
  return h
}
