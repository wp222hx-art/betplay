// 角色声线工作室（Voice Studio）：千问 Qwen3-TTS 选角、试听、表演指令、声音设计（文字描述 → 专属音色）
// · 配置保存在 D1 的 voice_cast 表，默认值来自 scripts/comic/cast.json（构建时打包进 data.json 的 cast 字段）
// · 离线批量配音脚本 produce_voice_v3.py 会读取 /api/voice/cast（或导出的 cast.json），用同样的配置重新生成
// · 密钥只放在服务端：DASHSCOPE_API_KEY（在 .dev.vars 或 wrangler secret 中配置），前端永远拿不到
type Env = { DB: D1Database; DASHSCOPE_API_KEY?: string; DASHSCOPE_BASE?: string }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const BASE = (env: Env) => env.DASHSCOPE_BASE || 'https://dashscope.aliyuncs.com/api/v1'

// 千问系统音色（instruct 模型可用的中文音色），用于选角下拉
export const QWEN_VOICES = [
  { id: 'Serena', g: 'F', desc: '温柔的年轻女性' }, { id: 'Cherry', g: 'F', desc: '阳光、亲切、自然的年轻女性' },
  { id: 'Maia', g: 'F', desc: '知性又温柔' }, { id: 'Vivian', g: 'F', desc: '自信、可爱、有点小脾气' },
  { id: 'Chelsie', g: 'F', desc: '二次元虚拟女友' }, { id: 'Momo', g: 'F', desc: '俏皮捣蛋' },
  { id: 'Bella', g: 'F', desc: '活泼俏皮的少女' }, { id: 'Mia', g: 'F', desc: '温柔乖巧' },
  { id: 'Bellona', g: 'F', desc: '有力、清亮、英雄气概' }, { id: 'Elias', g: 'F', desc: '严谨又会讲故事' },
  { id: 'Nini', g: 'F', desc: '软糯黏人' }, { id: 'Stella', g: 'F', desc: '甜美少女 / 热血变身' }, { id: 'Seren', g: 'F', desc: '轻柔助眠' },
  { id: 'Ethan', g: 'M', desc: '阳光温暖、带一点北方口音' }, { id: 'Moon', g: 'M', desc: '率性帅气（月白）' },
  { id: 'Kai', g: 'M', desc: '舒缓低沉，像耳边 SPA' }, { id: 'Vincent', g: 'M', desc: '独特的沙哑烟嗓，自带千军万马' },
  { id: 'Arthur', g: 'M', desc: '质朴、带着烟草和岁月感' }, { id: 'Eldric Sage', g: 'M', desc: '沉稳睿智的长者' },
  { id: 'Neil', g: 'M', desc: '最专业的新闻主播，平直清晰' }, { id: 'Mochi', g: 'M', desc: '聪明机灵的少年' },
  { id: 'Nofish', g: 'M', desc: '平翘舌不分的设计师' }, { id: 'Pip', g: 'M', desc: '调皮男孩' },
]
// 后期处理预设（离线配音链使用，页面上可以直接选）
export const FX_PRESETS: Record<string, { label: string; af: string }> = {
  none: { label: '干声（仅压缩）', af: 'highpass=f=80,acompressor=threshold=-20dB:ratio=3' },
  warm: { label: '温暖人声', af: 'highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,equalizer=f=3200:t=q:w=1.2:g=2' },
  chest: { label: '胸腔厚重（硬汉）', af: 'highpass=f=70,acompressor=threshold=-20dB:ratio=3,equalizer=f=180:t=q:w=1:g=2' },
  mask: { label: '面具金属低语', af: 'asetrate=24000*0.95,aresample=24000,atempo=1.0526,highpass=f=100,lowpass=f=6500,equalizer=f=1400:t=q:w=2:g=2,aecho=0.8:0.5:22:0.18,acompressor=threshold=-22dB:ratio=4' },
  hall: { label: '会议厅回响 + 降调（年长）', af: 'asetrate=24000*0.86,aresample=24000,atempo=1.163,highpass=f=60,equalizer=f=150:t=q:w=1:g=2.5,aecho=0.8:0.6:45|70:0.18|0.10,acompressor=threshold=-20dB:ratio=2.5' },
  bright: { label: '清亮少女', af: 'highpass=f=120,acompressor=threshold=-18dB:ratio=2.5,equalizer=f=4000:t=q:w=1.5:g=2' },
  phone: { label: '电话 / 耳机', af: 'highpass=f=350,lowpass=f=3400,acrusher=bits=12:mix=0.15,volume=1.4' },
}

export async function getCast(env: Env, defaults: Record<string, any>) {
  const rows = (await env.DB.prepare('SELECT name, config, updated_at FROM voice_cast').all()).results as any[]
  const ov = Object.fromEntries(rows.map((r) => [r.name, { ...J(r.config, {}), updated_at: r.updated_at }]))
  const out: Record<string, any> = {}
  for (const [name, d] of Object.entries<any>(defaults)) out[name] = { ...d, ...(ov[name] || {}), name, customized: !!ov[name] }
  return out
}

const ALLOWED = ['qwen_voice', 'qwen_persona', 'fx_preset', 'color', 'brand', 'side', 'sample_line']
export async function saveCast(env: Env, name: string, patch: Record<string, any>, defaults: Record<string, any>) {
  if (!defaults[name]) throw new Error('未知角色：' + name)
  const cur = (await getCast(env, defaults))[name]
  const next: any = {}
  for (const k of ALLOWED) if (patch[k] !== undefined) next[k] = String(patch[k]).slice(0, 1200)
  if (next.fx_preset && !FX_PRESETS[next.fx_preset]) throw new Error('未知后期预设')
  if (next.color && !/^#[0-9a-fA-F]{6}$/.test(next.color)) throw new Error('颜色格式应为 #RRGGBB')
  const merged = { ...Object.fromEntries(ALLOWED.map((k) => [k, cur[k]]).filter(([, v]) => v !== undefined)), ...next }
  await env.DB.prepare('INSERT OR REPLACE INTO voice_cast (name, config, updated_at) VALUES (?,?,?)').bind(name, JSON.stringify(merged), now()).run()
  return (await getCast(env, defaults))[name]
}
export async function resetCast(env: Env, name: string) {
  await env.DB.prepare('DELETE FROM voice_cast WHERE name=?').bind(name).run()
}

async function ds(env: Env, path: string, body: any) {
  if (!env.DASHSCOPE_API_KEY) throw new Error('服务端未配置 DASHSCOPE_API_KEY')
  const r = await fetch(BASE(env) + path, { method: 'POST', headers: { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.code) {
    const m = j.code === 'Arrearage' ? '阿里云百炼账户余额不足（Arrearage），请充值后重试' : j.code === 'Throttling.RateQuota' ? '千问接口限流，请稍后再试' : (j.message || `HTTP ${r.status}`)
    const e: any = new Error(m); e.code = j.code || 'DASHSCOPE_ERROR'; throw e
  }
  return j
}

// 试听：按角色当前配置（或页面上临时改的草稿）合成一句
export async function audition(env: Env, p: { voice: string; text: string; persona?: string; emotion?: string; custom_model?: string }) {
  const text = String(p.text || '').slice(0, 200)
  if (!text.trim()) throw new Error('请输入试听台词')
  const isCustom = !!p.custom_model
  const ins = [p.persona, p.emotion ? `这一句：${p.emotion}。` : '', '像影视剧里的真人演员在对戏，自然口语化，有呼吸感，不要播音腔，不要拖长字音。'].filter(Boolean).join('')
  const body: any = isCustom
    ? { model: p.custom_model, input: { text, voice: p.voice } }
    : { model: 'qwen3-tts-instruct-flash', input: { text, voice: p.voice, language_type: 'Chinese', instructions: ins, optimize_instructions: true } }
  const t0 = now()
  let j: any, fallback = false
  try { j = await ds(env, '/services/aigc/multimodal-generation/generation', body) }
  catch (e: any) {
    // 指令版（instruct）余额/额度用完时，退回基础版 qwen3-tts-flash（没有表演指令，但音色一致），方便继续选角
    if (isCustom || e.code !== 'Arrearage') throw e
    body.model = 'qwen3-tts-flash'; delete body.input.instructions; delete body.input.optimize_instructions; fallback = true
    j = await ds(env, '/services/aigc/multimodal-generation/generation', body)
  }
  return { url: j.output?.audio?.url, expires_at: j.output?.audio?.expires_at, ms: now() - t0, model: body.model, instructions: isCustom || fallback ? null : ins, fallback }
}

// 声音设计：用一段文字描述创造一个全新的专属音色（千问 qwen-voice-design，按 0.2 元/个计费；新账号有 10 次免费）
export async function designVoice(env: Env, p: { prompt: string; preview_text: string; owner?: string; name?: string }) {
  const prompt = String(p.prompt || '').slice(0, 2000)
  if (prompt.length < 8) throw new Error('声音描述太短：请写清性别、年龄、音调、语速、情感、质感')
  const target = 'qwen3-tts-vd-2026-01-26'
  const j = await ds(env, '/services/audio/tts/customization', {
    model: 'qwen-voice-design',
    input: { action: 'create', target_model: target, preferred_name: (p.name || 'df_voice').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'df_voice', voice_prompt: prompt, preview_text: String(p.preview_text || '今夜，新港的命运就在这一枚星核上。').slice(0, 120) },
    parameters: { sample_rate: 24000, response_format: 'wav' }
  })
  const vid = j.output?.voice
  if (!vid) throw new Error('声音设计没有返回音色 ID')
  await env.DB.prepare('INSERT OR REPLACE INTO voice_custom (voice_id, kind, label, prompt, target_model, owner, created_at) VALUES (?,?,?,?,?,?,?)').bind(vid, 'design', p.name || vid, prompt, target, p.owner || null, now()).run()
  return { voice_id: vid, target_model: target, preview: j.output?.preview_audio?.data ? `data:audio/wav;base64,${j.output.preview_audio.data}` : null }
}

export async function listCustom(env: Env) {
  return (await env.DB.prepare('SELECT * FROM voice_custom ORDER BY created_at DESC').all()).results
}
export async function deleteCustom(env: Env, voiceId: string) {
  await env.DB.prepare('DELETE FROM voice_custom WHERE voice_id=?').bind(voiceId).run()
}

// 服务状态：Key 是否配置、账户是否可用（用最短文本探测一次）
export async function status(env: Env) {
  if (!env.DASHSCOPE_API_KEY) return { configured: false, ok: false, message: '未配置 DASHSCOPE_API_KEY' }
  // 分别探测：指令版（带表演指令，批量配音用）和基础版
  const probe = async (model: string) => { try { await ds(env, '/services/aigc/multimodal-generation/generation', { model, input: { text: '好', voice: 'Cherry', language_type: 'Chinese' } }); return { ok: true } } catch (e: any) { return { ok: false, code: e.code, message: e.message } } }
  const [ins, base] = await Promise.all([probe('qwen3-tts-instruct-flash'), probe('qwen3-tts-flash')])
  if (ins.ok) return { configured: true, ok: true, instruct: true, base: base.ok, message: '千问语音服务可用（指令版 + 基础版）' }
  return { configured: true, ok: false, instruct: false, base: base.ok, code: ins.code, message: base.ok ? `指令版（qwen3-tts-instruct-flash）不可用：${ins.message}。试听会自动退回基础版，但批量配音需要指令版` : ins.message }
}
