// L0 · Model Gateway —— 统一调用契约（能力接口 → 模型路由 → 熔断降级 → 任务记账）
import { uid } from '../core/crypto'

export type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string; FAL_KEY?: string }

/** 能力 → 模型组（质量档位映射）。调用方只面对“能力”，不面对“模型”。 */
// effort：推理强度（minimal = 实时/秒级；low = 创作类）；sla_ms 为单模型超时预算
export const TEXT_ROUTES: Record<string, { draft: string; standard: string; premium: string; sla_ms: number; effort: string }> = {
  outline: { draft: 'gpt-5-nano', standard: 'gpt-5-mini', premium: 'gpt-5', sla_ms: 60000, effort: 'minimal' },
  storyboard: { draft: 'gpt-5-nano', standard: 'gpt-5-mini', premium: 'gpt-5', sla_ms: 45000, effort: 'minimal' },
  dialogue: { draft: 'gpt-5-nano', standard: 'gpt-5-mini', premium: 'gpt-5-mini', sla_ms: 30000, effort: 'minimal' },
  review: { draft: 'gpt-5-nano', standard: 'gpt-5-nano', premium: 'gpt-5-mini', sla_ms: 8000, effort: 'minimal' },
  score: { draft: 'gpt-5-nano', standard: 'gpt-5-mini', premium: 'gpt-5-mini', sla_ms: 30000, effort: 'minimal' },
  poem: { draft: 'gpt-5-nano', standard: 'gpt-5-mini', premium: 'gpt-5', sla_ms: 40000, effort: 'low' },
  summary: { draft: 'gpt-5-nano', standard: 'gpt-5-nano', premium: 'gpt-5-mini', sla_ms: 8000, effort: 'minimal' },
  personalize: { draft: 'gpt-5-nano', standard: 'gpt-5-nano', premium: 'gpt-5-mini', sla_ms: 9000, effort: 'minimal' }
}

const FALLBACK_CHAIN = ['gpt-5-mini', 'gpt-5-nano']

// 简易熔断：isolate 内存级（错误率 >5% 熔断 60s 的轻量实现）
const breaker: Record<string, { fail: number; until: number }> = {}

async function streamChat(env: Bindings, model: string, messages: any[], json: boolean, timeoutMs: number, effort = 'minimal') {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch((env.OPENAI_BASE_URL || '') + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, reasoning_effort: effort, ...(json ? { response_format: { type: 'json_object' } } : {}) })
    })
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = '', out = '', finish = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n')
      buf = parts.pop() || ''
      for (const l of parts) {
        if (!l.startsWith('data:')) continue
        const d = l.slice(5).trim()
        if (d === '[DONE]') continue
        try { const ch = JSON.parse(d).choices?.[0]; out += ch?.delta?.content || ''; if (ch?.finish_reason) finish = ch.finish_reason } catch {}
      }
    }
    // finish_reason：stop / length / eof（流断开无结束标记）——用于识别长剧本被截断
    return { out, finish: finish || (out ? 'eof' : '') }
  } finally {
    clearTimeout(t)
  }
}

/** 宽容 JSON 解析：去 markdown 围栏 / 尾逗号 / 截断补全括号（长剧本常见的输出被截断） */
export function looseJson(txt: string) {
  let t = txt.replace(/```(json)?/g, '').trim()
  const i = t.indexOf('{'); if (i > 0) t = t.slice(i)
  try { return JSON.parse(t) } catch {}
  t = t.replace(/,\s*([}\]])/g, '$1')
  try { return JSON.parse(t) } catch {}
  // 截断修复：回退到最后一个完整值，再按栈补齐括号
  const stack: string[] = []; let inStr = false, esc = false, lastSafe = 0
  for (let k = 0; k < t.length; k++) {
    const ch = t[k]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') { stack.pop(); lastSafe = k + 1 }
    else if (ch === ',') lastSafe = k
  }
  let cut = t.slice(0, lastSafe).replace(/,\s*$/, '')
  const st2: string[] = []; inStr = false; esc = false
  for (const ch of cut) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true; else if (ch === '{') st2.push('}'); else if (ch === '[') st2.push(']'); else if (ch === '}' || ch === ']') st2.pop()
  }
  cut = cut.replace(/,\s*$/, '') + st2.reverse().join('')
  return JSON.parse(cut.replace(/,\s*([}\]])/g, '$1'))
}

export type CallOpts = {
  capability: string
  tier?: 'draft' | 'standard' | 'premium'
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  agent?: number
  ref?: string
  json?: boolean
  system?: string
  prompt: string
  timeoutMs?: number
  fallback?: () => any // 兜底模板
}

/** 统一调用：返回 { ok, data, model, degraded, task_id, latency_ms } */
export async function callCapability(env: Bindings, o: CallOpts) {
  const route = TEXT_ROUTES[o.capability] || TEXT_ROUTES.outline
  const tier = o.tier || 'standard'
  const primary = route[tier]
  const chain = [primary, ...FALLBACK_CHAIN.filter((m) => m !== primary)]
  const task_id = uid('task_')
  const t0 = Date.now()
  await env.DB.prepare(
    'INSERT INTO gen_tasks (id,capability,provider,model,priority,tier,status,agent_no,ref_id,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(task_id, o.capability, 'openai-compatible', primary, o.priority || 'P2', tier, 'running', o.agent || 0, o.ref || null,
    o.prompt.slice(0, 1500), t0, t0).run()

  let lastErr = ''
  if (env.OPENAI_API_KEY) {
    const tries = [...chain]; let retried = false
    for (let ti = 0; ti < tries.length; ti++) {
      const model = tries[ti]
      const b = breaker[model]
      if (b && b.until > Date.now()) continue
      try {
        const { out: txt, finish } = await streamChat(env, model, [
          ...(o.system ? [{ role: 'system', content: o.system }] : []),
          { role: 'user', content: o.prompt }
        ], !!o.json, o.timeoutMs || route.sla_ms, route.effort)
        let data: any = txt
        let truncated = finish === 'length' || finish === 'eof'
        if (o.json) { try { data = JSON.parse(txt.replace(/```(json)?/g, '').trim()) } catch { truncated = true; data = looseJson(txt) } }
        const latency = Date.now() - t0
        await env.DB.prepare('UPDATE gen_tasks SET status=?,model=?,output=?,latency_ms=?,cost=?,updated_at=? WHERE id=?')
          .bind(model === primary ? 'succeeded' : 'degraded', model, (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 4000),
            latency, Math.round(txt.length / 4), Date.now(), task_id).run()
        if (breaker[model]) breaker[model].fail = 0
        if (truncated) await env.DB.prepare('UPDATE gen_tasks SET degrade_reason=? WHERE id=?').bind(`truncated finish=${finish} chars=${txt.length}`, task_id).run()
        return { ok: true, data, model, degraded: model !== primary, task_id, latency_ms: latency, truncated, finish }
      } catch (e: any) {
        lastErr = String(e?.message || e)
        // 主模型输出 JSON 损坏（非超时）→ 同模型重试一次，而不是直接降级到小模型
        if (model === primary && !retried && !/abort/i.test(lastErr)) { retried = true; tries.splice(ti + 1, 0, primary) }
        const b2 = (breaker[model] ||= { fail: 0, until: 0 })
        if (++b2.fail >= 3) b2.until = Date.now() + 60000
      }
    }
  } else lastErr = 'no api key'

  // 兜底：模板产物，保证任何模型故障都不会让流程“卡死”
  const fb = o.fallback ? o.fallback() : null
  await env.DB.prepare('UPDATE gen_tasks SET status=?,output=?,degrade_reason=?,latency_ms=?,updated_at=? WHERE id=?')
    .bind(fb ? 'degraded' : 'failed', fb ? JSON.stringify(fb).slice(0, 4000) : null, lastErr.slice(0, 300), Date.now() - t0, Date.now(), task_id).run()
  return { ok: !!fb, data: fb, model: 'template', degraded: true, task_id, latency_ms: Date.now() - t0, error: lastErr }
}
