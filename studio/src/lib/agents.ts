// Agent 配置中心：服务商（加密 Key）+ 生产 Agent（模型 / 参数 / 提示词版本 / 预算）
import { HttpError, type Env, type User, audit } from './auth'
import { hint, seal, unseal, uid } from './sec'
import * as Sl from './suanli'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export const PROVIDER_KINDS: Record<string, { name: string; cap: 'text' | 'video' | 'image' | 'any'; needs: string[]; hint: string }> = {
  suanli: { name: '算力网 suanli.com（对话 + 图片 + 视频）', cap: 'any', needs: ['key'], hint: '一个 Key 通用：/v1/chat/completions · /v1/images/generations · /v1/video/generations（Seedance 2.0/2.5、Wan 2.7）；Base 默认 https://api.suanli.com' },
  openai_compat: { name: 'OpenAI 兼容对话', cap: 'text', needs: ['base_url', 'key'], hint: 'OpenAI / DeepSeek / 豆包方舟对话 / 任意中转站 /chat/completions' },
  ark_video: { name: '火山方舟 Seedance（方舟原生格式）', cap: 'video', needs: ['base_url', 'key'], hint: '官方 https://ark.cn-beijing.volces.com 或方舟兼容中转；POST /api/v3/contents/generations/tasks' },
  openai_video: { name: 'OpenAI 风格视频中转', cap: 'video', needs: ['base_url', 'key'], hint: '中转站 POST /v1/videos/generations + 轮询' },
  ark_image: { name: '火山方舟 Seedream 图片', cap: 'image', needs: ['base_url', 'key'], hint: 'POST /api/v3/images/generations（doubao-seedream-*）；方舟兼容中转同样适用' },
  openai_image: { name: 'OpenAI 风格图片中转', cap: 'image', needs: ['base_url', 'key'], hint: '中转站 POST /v1/images/generations（gpt-image / flux / seedream 等）' },
  jimeng_cli: { name: '即梦 CLI（经执行节点）', cap: 'any', needs: [], hint: '常驻执行节点上安装 dreamina 并完成登录；后台只下发任务' },
  gsk: { name: 'Genspark gsk（沙箱兜底）', cap: 'any', needs: [], hint: '现有 director_worker 通道' },
  mock_video: { name: '模拟视频（联调用，不计费）', cap: 'video', needs: [], hint: '执行节点用 ffmpeg 生成占位视频（尾帧接力可视化），走完整流水线' },
  mock_image: { name: '模拟图片（联调用，不计费）', cap: 'image', needs: [], hint: '执行节点生成占位设定图' },
  mock_text: { name: '模拟对话（联调用，不计费）', cap: 'text', needs: [], hint: '返回回显 JSON，用于流程联调' }
}

// 生产线 Agent（按十步流水线组织；原 7 个开发 Agent 保留在玩家端 /agents 作为历史）
export const AGENT_DEFAULTS = [
  { code: 'SCREENWRITER', name: '编剧 Agent', step: 2, capability: 'text', duty: '立项 → 世界观、角色卡、主线梗概' },
  { code: 'STRUCTURE', name: '结构 Agent', step: 3, capability: 'text', duty: '在锚点上延展分支、设计汇合与回溯，控制路径数' },
  { code: 'SCRIPT', name: '剧本描述 Agent', step: 4, capability: 'text', duty: '节点剧情细节、对白、情绪、结尾悬念' },
  { code: 'REVIEWER', name: '剧本评审 Agent', step: 4, capability: 'text', duty: '剧本合理性（动机/因果/人设/信息）+ 吸引力指数七维打分 + 可执行修改建议' },
  { code: 'PROMPT', name: '提示词 Agent', step: 5, capability: 'text', duty: '剧本 → 高质量视频/对白提示词（镜头、光线、台词）' },
  { code: 'CONTINUITY', name: '连贯监管 Agent', step: 5, capability: 'text', duty: '剧情账本：服装/道具/伤痕/已知信息逐节点比对，冲突打回' },
  { code: 'ASSET', name: '设定图 Agent', step: 6, capability: 'image', duty: '角色设定图、场景图、封面（原创面孔）' },
  { code: 'VIDEO_MAIN', name: '主线视频 Agent', step: 7, capability: 'video', duty: '主线片段：参考图模式锁定人物' },
  { code: 'VIDEO_BRANCH', name: '分支视频 Agent', step: 8, capability: 'video', duty: '分支片段：上一段尾帧 → 下一段首帧；按热度按需生成' },
  { code: 'CONSISTENCY', name: '一致性检测 Agent', step: 9, capability: 'text', duty: '首尾帧衔接、人脸相似度、烧录字幕、视觉抽检' },
  { code: 'COMPLIANCE', name: '合规审核 Agent', step: 10, capability: 'text', duty: '提交前审核风险预扫、上架合规（娱乐币不可提现）' }
]

export async function seedDefaults(env: Env) {
  const has: any = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM st_agents) a, (SELECT COUNT(*) FROM st_providers WHERE id='mock_image') m`).first()
  if (has.a >= AGENT_DEFAULTS.length && has.m) return
  const st: any[] = [
    env.DB.prepare('INSERT OR IGNORE INTO st_providers (id,name,kind,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('mock_text', '模拟对话', 'mock_text', 1, now(), now()),
    env.DB.prepare('INSERT OR IGNORE INTO st_providers (id,name,kind,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('mock_video', '模拟视频', 'mock_video', 1, now(), now()),
    env.DB.prepare('INSERT OR IGNORE INTO st_providers (id,name,kind,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('mock_image', '模拟图片', 'mock_image', 1, now(), now()),
    // 复用玩家端已有的 OpenAI 兼容配置（引用环境变量，不入库明文）
    env.DB.prepare('INSERT OR IGNORE INTO st_providers (id,name,kind,base_env,key_env,key_hint,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('env_openai', '平台 LLM（环境变量）', 'openai_compat', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', '引用环境变量', 1, now(), now()),
    // 老库：设定图 Agent 以前没有默认服务商
    env.DB.prepare(`UPDATE st_agents SET provider_id='mock_image', model='mock' WHERE code='ASSET' AND provider_id IS NULL`)
  ]
  AGENT_DEFAULTS.forEach((a, i) => st.push(env.DB.prepare('INSERT OR IGNORE INTO st_agents (code,name,duty,step,capability,provider_id,model,params,sort,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(a.code, a.name, a.duty, a.step, a.capability, a.capability === 'video' ? 'mock_video' : a.capability === 'image' ? 'mock_image' : 'env_openai', a.capability === 'text' ? 'gpt-5-mini' : 'mock', JSON.stringify(a.capability === 'text' ? { temperature: 0.8, reasoning_effort: 'minimal' } : a.capability === 'video' ? { ratio: '9:16', resolution: '720p', duration: 8, audio: true } : { }), i, now())))
  await env.DB.batch(st)
}

const pubProvider = (p: any) => ({ id: p.id, name: p.name, kind: p.kind, kind_name: PROVIDER_KINDS[p.kind]?.name || p.kind, base_url: p.base_url || (p.base_env ? `$${p.base_env}` : ''), key_hint: p.key_hint || (p.key_env ? `$${p.key_env}` : ''), has_key: !!(p.key_enc || p.key_env), extra: J(p.extra, {}), enabled: !!p.enabled, updated_at: p.updated_at })

export async function listConfig(env: Env) {
  await seedDefaults(env)
  const providers = ((await env.DB.prepare('SELECT * FROM st_providers ORDER BY created_at').all()).results as any[]).map(pubProvider)
  const agents = ((await env.DB.prepare('SELECT * FROM st_agents ORDER BY sort').all()).results as any[]).map((a) => ({ ...a, params: J(a.params, {}), enabled: !!a.enabled }))
  const usage = (await env.DB.prepare(`SELECT agent, COUNT(*) n, SUM(status='ok') ok, ROUND(AVG(latency_ms)) ms, ROUND(SUM(cost),2) cost FROM st_runs WHERE created_at>? GROUP BY agent`).bind(now() - 7 * 86400000).all()).results
  return { providers, agents, usage, kinds: PROVIDER_KINDS, master_key_ok: !!(env.STUDIO_MASTER_KEY && env.STUDIO_MASTER_KEY.length >= 16) }
}

export async function upsertProvider(env: Env, u: User, b: any) {
  const kind = String(b.kind || '')
  if (!PROVIDER_KINDS[kind]) throw new HttpError(400, 'BAD_KIND', '服务商类型无效')
  const id = b.id || uid('pv_')
  const base = b.base_url ? String(b.base_url).trim().replace(/\/+$/, '') : kind === 'suanli' ? 'https://api.suanli.com' : null
  if (base && !/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.)/.test(base)) throw new HttpError(400, 'BAD_URL', 'Base URL 必须是 https')
  let encd: { enc: string; iv: string } | null = null, kh: string | null = null
  if (b.key) { encd = await seal(env.STUDIO_MASTER_KEY || '', String(b.key).trim()); kh = hint(String(b.key).trim()) }
  const ex: any = await env.DB.prepare('SELECT id FROM st_providers WHERE id=?').bind(id).first()
  if (ex) await env.DB.prepare(`UPDATE st_providers SET name=COALESCE(?,name), kind=?, base_url=COALESCE(?,base_url), key_enc=COALESCE(?,key_enc), key_iv=COALESCE(?,key_iv), key_hint=COALESCE(?,key_hint), extra=COALESCE(?,extra), enabled=COALESCE(?,enabled), updated_at=?, updated_by=? WHERE id=?`)
    .bind(b.name || null, kind, base, encd?.enc || null, encd?.iv || null, kh, b.extra ? JSON.stringify(b.extra) : null, b.enabled === undefined ? null : b.enabled ? 1 : 0, now(), u.id, id).run()
  else await env.DB.prepare('INSERT INTO st_providers (id,name,kind,base_url,key_enc,key_iv,key_hint,extra,enabled,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, b.name || PROVIDER_KINDS[kind].name, kind, base, encd?.enc || null, encd?.iv || null, kh, JSON.stringify(b.extra || {}), 1, now(), now(), u.id).run()
  await audit(env, u.id, ex ? 'provider_update' : 'provider_create', id, { kind, base, key_changed: !!b.key })
  return pubProvider(await env.DB.prepare('SELECT * FROM st_providers WHERE id=?').bind(id).first())
}

export async function deleteProvider(env: Env, u: User, id: string) {
  const used: any = await env.DB.prepare('SELECT COUNT(*) n FROM st_agents WHERE provider_id=?').bind(id).first()
  if (used.n) throw new HttpError(409, 'IN_USE', `仍有 ${used.n} 个 Agent 在使用该服务商`)
  await env.DB.prepare('DELETE FROM st_providers WHERE id=?').bind(id).run(); await audit(env, u.id, 'provider_delete', id)
  return { ok: true }
}

export async function updateAgent(env: Env, u: User, code: string, b: any) {
  await seedDefaults(env)
  const a: any = await env.DB.prepare('SELECT * FROM st_agents WHERE code=?').bind(code).first()
  if (!a) throw new HttpError(404, 'NO_AGENT', 'Agent 不存在')
  let fixes: string[] = []
  const pid = b.provider_id || a.provider_id
  if (pid) {
    const p: any = await env.DB.prepare('SELECT kind FROM st_providers WHERE id=?').bind(pid).first()
    if (!p) throw new HttpError(400, 'NO_PROVIDER', '服务商不存在')
    const cap = PROVIDER_KINDS[p.kind].cap
    if (cap !== 'any' && cap !== a.capability) throw new HttpError(400, 'CAPABILITY_MISMATCH', `${a.name} 需要「${a.capability}」能力，该服务商只提供「${cap}」`)
    if (p.kind === 'suanli') { // 按算力网文档校验：模型类别 / JSON 能力 / 首帧·参考图角色；参数按文档枚举与范围夹紧
      const model = b.model ?? a.model, m = Sl.find(model)
      const why = Sl.fitFor(code, m); if (why) throw new HttpError(400, 'MODEL_MISMATCH', `${a.name}：${why}`)
      if (m) { const n = Sl.normalizeParams(m, b.params ?? J(a.params, {})); fixes = n.fixes; if (b.params || fixes.length) b.params = n.params }
    }
  }
  let ver = a.prompt_version
  if (typeof b.prompt === 'string' && b.prompt !== a.prompt) {
    ver = a.prompt_version + 1
    await env.DB.prepare('INSERT INTO st_agent_prompts (agent,version,prompt,created_at,created_by) VALUES (?,?,?,?,?)').bind(code, ver, b.prompt, now(), u.id).run()
  }
  await env.DB.prepare(`UPDATE st_agents SET provider_id=COALESCE(?,provider_id), model=COALESCE(?,model), params=COALESCE(?,params), prompt=COALESCE(?,prompt), prompt_version=?, budget=COALESCE(?,budget), unit_price=COALESCE(?,unit_price), enabled=COALESCE(?,enabled), updated_at=?, updated_by=? WHERE code=?`)
    .bind(b.provider_id || null, b.model ?? null, b.params ? JSON.stringify(b.params) : null, typeof b.prompt === 'string' ? b.prompt : null, ver, b.budget ?? null, b.unit_price ?? null, b.enabled === undefined ? null : b.enabled ? 1 : 0, now(), u.id, code).run()
  await audit(env, u.id, 'agent_update', code, { provider: b.provider_id, model: b.model, prompt_version: ver, budget: b.budget })
  return { code, prompt_version: ver, fixes }
}

export async function promptHistory(env: Env, code: string) {
  return (await env.DB.prepare('SELECT version, substr(prompt,1,400) prompt, created_at, created_by FROM st_agent_prompts WHERE agent=? ORDER BY version DESC LIMIT 20').bind(code).all()).results
}

/** 解析出可调用的服务商（仅服务端内部使用，绝不返回给前端） */
export async function resolveProvider(env: Env, id: string) {
  const p: any = await env.DB.prepare('SELECT * FROM st_providers WHERE id=?').bind(id).first()
  if (!p || !p.enabled) throw new HttpError(409, 'PROVIDER_DISABLED', '服务商不存在或已停用')
  const key = p.key_enc ? await unseal(env.STUDIO_MASTER_KEY || '', p.key_enc, p.key_iv) : p.key_env ? env[p.key_env] || '' : ''
  const base = p.base_url || (p.base_env ? env[p.base_env] || '' : '')
  return { id: p.id, kind: p.kind as string, base: String(base).replace(/\/+$/, ''), key: String(key), extra: J(p.extra, {}) }
}

/** 一键接入算力网：保存加密 Key → 连通测试 → 按推荐把各 Agent 指向 suanli（只改选中的 Agent；原配置写进审计便于回退） */
export const SUANLI_PRESET: Record<string, { model: string; params?: any }> = {
  SCREENWRITER: { model: 'deepseek-v4-pro-0813', params: { temperature: 0.9, max_completion_tokens: 16384 } }, STRUCTURE: { model: 'deepseek-v4-pro-0813', params: { temperature: 0.7, max_completion_tokens: 16384 } },
  SCRIPT: { model: 'deepseek-v4-flash-0731', params: { temperature: 0.85, max_completion_tokens: 16384 } }, PROMPT: { model: 'deepseek-v4-flash-0731', params: { temperature: 0.6, max_completion_tokens: 8192 } },
  CONTINUITY: { model: 'deepseek-v4-flash-0731', params: { temperature: 0.2, max_completion_tokens: 8192 } }, REVIEWER: { model: 'deepseek-v4-pro-0813', params: { temperature: 0.3, max_completion_tokens: 8192 } },
  COMPLIANCE: { model: 'doubao-seed-2-0-lite', params: { temperature: 0.1, max_completion_tokens: 4096 } }, CONSISTENCY: { model: 'doubao-seed-2-0-pro', params: { temperature: 0.1, max_completion_tokens: 2048 } },
  ASSET: { model: 'wan2.7-image-pro', params: { size_portrait: '1536x2048', size_landscape: '2048x1152', n: 1 } },
  VIDEO_MAIN: { model: 'doubao-seedance-2-0-cmcc1', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } },
  VIDEO_BRANCH: { model: 'doubao-seedance-2-0-cmcc1', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } }
}
/** 算力网模型目录（按类别 + 文档参数表 + 价格 + 每个 Agent 可选列表）；有 Key 时标注该 Key 实际可用的模型 */
export async function suanliCatalog(env: Env, force = false) {
  const p: any = await env.DB.prepare(`SELECT id FROM st_providers WHERE kind='suanli' AND enabled=1 ORDER BY created_at LIMIT 1`).first()
  const pv = p ? await resolveProvider(env, p.id).catch(() => null) : null
  return { provider_id: p?.id || null, ...(await Sl.catalog(env, pv, force)) }
}
export async function connectSuanli(env: Env, u: User, b: { key?: string; agents?: string[]; base_url?: string }) {
  await seedDefaults(env)
  let p: any = await env.DB.prepare(`SELECT id FROM st_providers WHERE kind='suanli' ORDER BY created_at LIMIT 1`).first()
  if (!p && !b.key) throw new HttpError(400, 'NO_KEY', '请填写算力网 API Key')
  const saved = await upsertProvider(env, u, { id: p?.id, kind: 'suanli', name: '算力网 suanli.com', base_url: b.base_url || 'https://api.suanli.com', ...(b.key ? { key: b.key } : {}) })
  const want = (b.agents?.length ? b.agents : Object.keys(SUANLI_PRESET)).filter((c) => SUANLI_PRESET[c])
  const before = (await env.DB.prepare(`SELECT code, provider_id, model, params FROM st_agents`).all()).results
  for (const code of want) await updateAgent(env, u, code, { provider_id: saved.id, model: SUANLI_PRESET[code].model, ...(SUANLI_PRESET[code].params ? { params: SUANLI_PRESET[code].params } : {}) })
  await audit(env, u.id, 'suanli_connect', saved.id, { agents: want, before })
  return { provider: saved, agents: want }
}
