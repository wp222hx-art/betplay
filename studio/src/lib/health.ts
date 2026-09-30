// 模型接入监控：连通测试（深度）/ 心跳（轻量，自动）/ 使用情况（按服务商 × 模型聚合 st_runs + st_jobs）
// 心跳无需 cron：由执行节点 claim、后台页面访问懒触发，每个服务商至少间隔 HEARTBEAT_MS 才探测一次
import type { Env } from './auth'
import { resolveProvider } from './agents'
import * as Pf from './platforms'
import { errText } from './gateway'

const now = () => Date.now()
export const HEARTBEAT_MS = 5 * 60000
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

type Probe = { ok: boolean; ms: number; note: string; balance?: number | null; currency?: string | null; models?: number | null; model_ids?: string[]; chat?: { ok: boolean; model: string; ms: number; text?: string; note?: string } | null }

/** 探测：鉴权 + 模型列表 + 余额；deep=true 时再发一次最小对话（max_tokens=8，约 ¥0.0001） */
export async function probe(env: Env, id: string, deep = false): Promise<Probe> {
  const pv = await resolveProvider(env, id), t0 = now()
  const H = { Authorization: 'Bearer ' + pv.key }
  const done = (p: Omit<Probe, 'ms'>): Probe => ({ ...p, ms: now() - t0 })
  if (!pv.key) return done({ ok: false, note: '缺少 API Key' })
  const R = Pf.root(pv.kind, pv.base || Pf.PLATFORMS[pv.kind as Pf.Kind]?.base || '')
  try {
    let ids: string[] = [], balance: number | null = null, currency: string | null = null, note = ''
    if (pv.kind === 'ark') {
      // 方舟无 /models 与余额接口：用最小对话鉴权（官方推荐的探测方式），失败码区分 Key / 权限 / 模型未开通
      const m = pv.extra.probe_model || 'doubao-seed-2-0-mini-260428'
      const r = await fetch(R + '/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4, thinking: { type: 'disabled' } }) })
      const d: any = await r.json().catch(() => ({}))
      if (r.status === 401) return done({ ok: false, note: `API Key 无效（${d.error?.code || 401}）` })
      if (r.status === 403) return done({ ok: false, note: `无权限：${d.error?.message?.slice(0, 120) || '请在方舟控制台为该 Key 所在项目开通模型'}` })
      if (r.status === 404 || d.error?.code === 'InvalidEndpointOrModel.NotFound') return done({ ok: true, note: `鉴权通过，但探测模型 ${m} 未开通（去方舟控制台「开通管理」开通）`, models: null })
      if (!r.ok) return done({ ok: false, note: `HTTP ${r.status}：${d.error?.message?.slice(0, 120) || ''}` })
      return done({ ok: true, note: `鉴权通过 · ${m} 可用`, models: null, chat: { ok: true, model: m, ms: now() - t0, text: d.choices?.[0]?.message?.content || '' } })
    }
    const lr = await fetch(R + (pv.kind === 'deepseek' ? '/models' : '/v1/models'), { headers: H })
    const ld: any = await lr.json().catch(() => ({}))
    if (!lr.ok) return done({ ok: false, note: pv.kind === 'suanli' ? errText(ld) : (ld.error?.message || ld.message || `HTTP ${lr.status}`).slice(0, 160) })
    ids = (ld.data || []).map((m: any) => m.id).filter(Boolean)
    if (pv.kind === 'deepseek') {
      const br = await fetch(R + '/user/balance', { headers: H }); const bd: any = await br.json().catch(() => ({}))
      const b = (bd.balance_infos || []).find((x: any) => x.currency === 'CNY') || bd.balance_infos?.[0]
      if (b) { balance = +b.total_balance; currency = b.currency }
      if (bd.is_available === false) note = '余额不足，无法调用'
    } else if (pv.kind === 'tokenhot') {
      // new-api 兼容 OpenAI 计费接口：subscription.hard_limit_usd（令牌额度）− usage.total_usage/100（已用，美分）
      const [s, u] = await Promise.all([fetch(R + '/v1/dashboard/billing/subscription', { headers: H }).then((r) => r.ok ? r.json() : null).catch(() => null), fetch(R + '/v1/dashboard/billing/usage', { headers: H }).then((r) => r.ok ? r.json() : null).catch(() => null)]) as any[]
      if (s?.hard_limit_usd !== undefined) { const lim = +s.hard_limit_usd, used = u?.total_usage ? +u.total_usage / 100 : 0; balance = lim >= 1e8 ? null : +(lim - used).toFixed(4); currency = 'USD'; if (lim >= 1e8) note = '令牌为无限额度' }
    }
    let chat: Probe['chat'] = null
    if (deep) {
      const m = pv.extra.probe_model || (pv.kind === 'deepseek' ? 'deepseek-flash' : pv.kind === 'suanli' ? 'deepseek-v4-flash-0731' : ids.find((i) => /deepseek-v4\.1-flash|deepseek-v4-flash|gpt-5\.4-nano/.test(i)) || ids[0])
      if (m) {
        const c0 = now()
        const body: any = { model: m, messages: [{ role: 'user', content: '只回复 OK' }], max_tokens: 8 }
        if (pv.kind === 'deepseek') body.thinking = { type: 'disabled' }
        const r = await fetch(R + (pv.kind === 'deepseek' ? '/chat/completions' : '/v1/chat/completions'), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const d: any = await r.json().catch(() => ({}))
        chat = r.ok ? { ok: true, model: m, ms: now() - c0, text: (d.choices?.[0]?.message?.content || '').slice(0, 40) } : { ok: false, model: m, ms: now() - c0, note: (pv.kind === 'suanli' ? errText(d) : d.error?.message || `HTTP ${r.status}`).slice(0, 140) }
      }
    }
    const vids = ids.filter((i) => /seedance|kling|veo|wan.*(t2v|video)|happyhorse|hailuo|grok-imagine|omni-video/i.test(i))
    const main = `鉴权通过 · 可用模型 ${ids.length} 个${vids.length ? `（视频 ${vids.length}：${vids.slice(0, 4).join('、')}${vids.length > 4 ? '…' : ''}）` : ''}`
    const bal = balance !== null ? ` · 余额 ${currency === 'USD' ? '$' : '¥'}${balance}` : ''
    return done({ ok: !note.includes('无法调用') && (chat ? chat.ok : true), note: [main + bal, note, chat && !chat.ok ? `对话探测失败：${chat.note}` : chat ? `对话探测 ${chat.model} ${chat.ms}ms` : ''].filter(Boolean).join(' · '), balance, currency, models: ids.length, model_ids: ids, chat })
  } catch (e: any) { return done({ ok: false, note: '网络错误：' + String(e?.message || e).slice(0, 140) }) }
}

async function save(env: Env, id: string, kind: 'test' | 'beat', p: Probe) {
  await env.DB.prepare(`INSERT INTO st_provider_checks (provider_id,kind,ok,ms,note,balance,currency,models,at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, kind, p.ok ? 1 : 0, p.ms, p.note.slice(0, 500), p.balance ?? null, p.currency ?? null, p.models ?? null, now()).run()
  // 只保留每个服务商最近 500 条
  await env.DB.prepare(`DELETE FROM st_provider_checks WHERE provider_id=? AND id NOT IN (SELECT id FROM st_provider_checks WHERE provider_id=? ORDER BY at DESC LIMIT 500)`).bind(id, id).run().catch(() => {})
}

/** 手动连通测试（深度：含一次最小对话） */
export async function test(env: Env, id: string) { const p = await probe(env, id, true); await save(env, id, 'test', p); return p }

/** 心跳：对启用的平台服务商（suanli / tokenhot / deepseek / ark）做轻量探测；每个至少间隔 HEARTBEAT_MS */
export async function beat(env: Env, force = false) {
  const rows = ((await env.DB.prepare(`SELECT id, kind FROM st_providers WHERE enabled=1 AND key_enc IS NOT NULL`).all()).results as any[]).filter((r) => Pf.isPlatform(r.kind))
  const out: any[] = []
  for (const r of rows) {
    const last: any = await env.DB.prepare(`SELECT at FROM st_provider_checks WHERE provider_id=? ORDER BY at DESC LIMIT 1`).bind(r.id).first()
    if (!force && last && now() - last.at < HEARTBEAT_MS) continue
    const p = await probe(env, r.id, false).catch((e) => ({ ok: false, ms: 0, note: String(e?.message || e) }) as Probe)
    await save(env, r.id, 'beat', p); out.push({ id: r.id, ok: p.ok, ms: p.ms })
  }
  return out
}

/** 使用情况：近 24 小时 / 7 天按服务商 × 模型聚合（调用次数、成功率、平均延迟、token、花费、视频任务） */
export async function usage(env: Env) {
  const d1 = now() - 86400e3, d7 = now() - 7 * 86400e3
  const runs = (await env.DB.prepare(`SELECT provider_id, model, COUNT(*) n, SUM(status='ok') ok, SUM(created_at>?) n24, SUM(created_at>? AND status!='ok') err24, ROUND(AVG(latency_ms)) ms, SUM(tokens_in) tin, SUM(tokens_out) tout, ROUND(SUM(cost),4) cost, MAX(created_at) last FROM st_runs WHERE created_at>? GROUP BY provider_id, model`).bind(d1, d1, d7).all()).results as any[]
  const jobs = (await env.DB.prepare(`SELECT provider_id, model, COUNT(*) n, SUM(status='succeeded') ok, SUM(status='failed') failed, SUM(status IN ('queued','submitted','running','ingesting','claimed')) active, ROUND(SUM(cost),3) cost, MAX(updated_at) last FROM st_jobs WHERE phase='gen' AND created_at>? AND provider_id IS NOT NULL GROUP BY provider_id, model`).bind(d7).all()).results as any[]
  const errs = (await env.DB.prepare(`SELECT provider_id, model, error, created_at FROM st_runs WHERE status!='ok' AND created_at>? ORDER BY created_at DESC LIMIT 20`).bind(d7).all()).results as any[]
  const jerrs = (await env.DB.prepare(`SELECT provider_id, model, error, updated_at created_at FROM st_jobs WHERE status='failed' AND updated_at>? ORDER BY updated_at DESC LIMIT 20`).bind(d7).all()).results as any[]
  return { runs, jobs, errors: [...errs, ...jerrs].sort((a, b) => b.created_at - a.created_at).slice(0, 20) }
}

/** 总览：每个服务商的在线状态（最近心跳）、24 小时可用率、延迟、余额 + 使用情况 */
export async function overview(env: Env) {
  const pvs = (await env.DB.prepare(`SELECT id, name, kind, base_url, key_hint, enabled, key_enc IS NOT NULL has_key FROM st_providers ORDER BY created_at`).all()).results as any[]
  const u = await usage(env), d1 = now() - 86400e3
  const agents = (await env.DB.prepare(`SELECT code, name, provider_id, model FROM st_agents`).all()).results as any[]
  const list = []
  for (const p of pvs) {
    const last: any = await env.DB.prepare(`SELECT * FROM st_provider_checks WHERE provider_id=? ORDER BY at DESC LIMIT 1`).bind(p.id).first()
    const lastBal: any = await env.DB.prepare(`SELECT balance, currency, at FROM st_provider_checks WHERE provider_id=? AND balance IS NOT NULL ORDER BY at DESC LIMIT 1`).bind(p.id).first()
    const agg: any = await env.DB.prepare(`SELECT COUNT(*) n, SUM(ok) ok, ROUND(AVG(ms)) ms FROM st_provider_checks WHERE provider_id=? AND at>?`).bind(p.id, d1).first()
    const spark = ((await env.DB.prepare(`SELECT ok, ms, at FROM st_provider_checks WHERE provider_id=? ORDER BY at DESC LIMIT 36`).bind(p.id).all()).results as any[]).reverse()
    const stale = !last || now() - last.at > 3 * HEARTBEAT_MS
    const r = u.runs.filter((x) => x.provider_id === p.id), j = u.jobs.filter((x) => x.provider_id === p.id)
    list.push({
      id: p.id, name: p.name, kind: p.kind, platform: Pf.isPlatform(p.kind) ? Pf.PLATFORMS[p.kind] : null, key_hint: p.key_hint, has_key: !!p.has_key, enabled: !!p.enabled,
      status: !p.enabled ? 'disabled' : !Pf.isPlatform(p.kind) ? 'n/a' : !p.has_key ? 'no_key' : !last ? 'unknown' : last.ok ? (stale ? 'stale' : 'up') : 'down',
      last: last ? { ok: !!last.ok, ms: last.ms, note: last.note, at: last.at, kind: last.kind, models: last.models } : null,
      balance: lastBal ? { value: lastBal.balance, currency: lastBal.currency, at: lastBal.at } : null,
      uptime24: agg?.n ? +(agg.ok / agg.n * 100).toFixed(1) : null, avg_ms24: agg?.ms || null, checks24: agg?.n || 0, spark,
      usage: {
        calls7: r.reduce((a, x) => a + x.n, 0), ok7: r.reduce((a, x) => a + (x.ok || 0), 0), calls24: r.reduce((a, x) => a + (x.n24 || 0), 0), err24: r.reduce((a, x) => a + (x.err24 || 0), 0),
        tokens7: r.reduce((a, x) => a + (x.tin || 0) + (x.tout || 0), 0), cost7: +(r.reduce((a, x) => a + (x.cost || 0), 0) + j.reduce((a, x) => a + (x.cost || 0), 0)).toFixed(3),
        media7: j.reduce((a, x) => a + x.n, 0), media_ok7: j.reduce((a, x) => a + (x.ok || 0), 0), media_active: j.reduce((a, x) => a + (x.active || 0), 0),
        models: [...r.map((x) => ({ model: x.model, type: 'chat', n: x.n, ok: x.ok, ms: x.ms, tokens: (x.tin || 0) + (x.tout || 0), cost: x.cost, last: x.last })), ...j.map((x) => ({ model: x.model, type: 'media', n: x.n, ok: x.ok, failed: x.failed, active: x.active, cost: x.cost, last: x.last }))].sort((a, b) => (b.last || 0) - (a.last || 0))
      },
      agents: agents.filter((a) => a.provider_id === p.id).map((a) => ({ code: a.code, name: a.name, model: a.model }))
    })
  }
  return { providers: list, errors: u.errors.map((e) => ({ ...e, provider: pvs.find((p) => p.id === e.provider_id)?.name || e.provider_id, error: String(e.error || '').slice(0, 200) })), heartbeat_ms: HEARTBEAT_MS, now: now() }
}
