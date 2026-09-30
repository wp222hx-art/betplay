// 算力网 suanli.com 模型目录（依据 https://www.suanli.com/api-docs 与公开模型广场 /api/v1/portal/models，2026-09-30 核对）
// 每个模型：类别 → 协议 → 参数表（枚举 / 范围，来自文档）→ 价格 → 适配哪些生产 Agent
// 目录 = 内置静态表 + 在线同步（新上架模型按 model_type / capabilities 自动归类），Key 可用性用 /v1/models 标注
import type { Env } from './auth'
const now = () => Date.now()

export type Cat = 'chat' | 'vision' | 'image' | 'video'
export type Proto = 'chat' | 'images' | 'video_moldex' | 'video_generic'
export type Param = { k: string; n: string; type: 'enum' | 'int' | 'float' | 'bool'; options?: (string | number)[]; min?: number; max?: number; step?: number; def: any; d?: string }
export type Model = {
  id: string; name: string; vendor: string; cat: Cat; proto: Proto; caps: string[]; ctx?: number; max_out?: number
  price: { unit: 'mtok' | 'image' | 'sec' | 'vtok'; in?: number; out?: number; cache?: number; per?: number; per_res?: Record<string, number>; with_video?: number; note: string }
  roles?: string[]; params: Param[]; notes?: string; tier?: 'flagship' | 'balanced' | 'budget'; source?: 'builtin' | 'live'
}

// ───────── 参数表（全部取自文档字段说明）─────────
const CHAT_PARAMS = (reasoning = true): Param[] => [
  { k: 'temperature', n: '采样温度', type: 'float', min: 0, max: 2, step: 0.05, def: 0.7, d: 'temperature 0~2：越高越发散，编剧 0.8~1.0，审核/质检 ≤0.2' },
  { k: 'top_p', n: '核采样', type: 'float', min: 0, max: 1, step: 0.05, def: 1, d: 'top_p 0~1' },
  { k: 'max_completion_tokens', n: '最大输出 token', type: 'int', min: 256, max: 32768, step: 256, def: 8192, d: 'max_completion_tokens（新版参数）' },
  ...(reasoning ? [{ k: 'reasoning_effort', n: '推理力度', type: 'enum', options: ['', 'low', 'medium', 'high'], def: '', d: 'reasoning_effort：low / medium / high（仅推理模型；留空=模型默认）' } as Param] : []),
  { k: 'presence_penalty', n: '存在惩罚', type: 'float', min: -2, max: 2, step: 0.1, def: 0, d: 'presence_penalty -2~2：>0 鼓励新话题' },
  { k: 'frequency_penalty', n: '频率惩罚', type: 'float', min: -2, max: 2, step: 0.1, def: 0, d: 'frequency_penalty -2~2：>0 减少重复用词' },
  { k: 'seed', n: '随机种子', type: 'int', min: 0, max: 2147483647, step: 1, def: '', d: 'seed：结果可复现（留空=随机）' }
]
const IMAGE_PARAMS: Param[] = [
  { k: 'size_portrait', n: '竖版尺寸（封面 3:4）', type: 'enum', options: ['1536x2048', '1152x1536', '1080x1440', '2048x2048'], def: '1536x2048', d: '万相 2.7：总像素 768²~2048²，宽高比 1:8~8:1' },
  { k: 'size_landscape', n: '横版尺寸（设定图 16:9）', type: 'enum', options: ['2048x1152', '1920x1080', '1536x864', '2048x2048'], def: '2048x1152', d: '角色设定图 / 场景图' },
  { k: 'n', n: '每次张数', type: 'int', min: 1, max: 4, step: 1, def: 1, d: 'n：生成图片数量（取第一张入库）' }
]
const SEEDANCE_PARAMS = (v25: boolean): Param[] => [
  { k: 'ratio', n: '画面比例', type: 'enum', options: ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'], def: '9:16', d: 'ratio：竖屏短剧用 9:16' },
  { k: 'resolution', n: '分辨率', type: 'enum', options: v25 ? ['480p', '720p'] : ['480p', '720p', '1080p'], def: '720p', d: v25 ? 'metadata.resolution：Seedance 2.5 仅 480p / 720p' : 'metadata.resolution：480p / 720p / 1080p' },
  { k: 'duration', n: '单段时长（秒）', type: 'int', min: 4, max: v25 ? 30 : 15, step: 1, def: 8, d: v25 ? 'duration：2.5 最长 30 秒' : 'duration：常见 5 / 8 / 10，2.0 最长 15 秒' },
  { k: 'audio', n: '同时生成音频', type: 'bool', def: true, d: 'metadata.generate_audio：有声（台词 / 环境音）' },
  { k: 'watermark', n: 'AI 水印', type: 'bool', def: false, d: 'metadata.watermark' },
  { k: 'seed', n: '随机种子', type: 'int', min: 0, max: 2147483647, step: 1, def: '', d: 'metadata.seed：便于复现（留空=随机）' }
]
const T2V_PARAMS = (maxDur: number): Param[] => [
  { k: 'ratio', n: '画面比例', type: 'enum', options: ['9:16', '16:9', '1:1'], def: '9:16', d: '换算为 size（如 720x1280）' },
  { k: 'resolution', n: '分辨率', type: 'enum', options: ['720p', '1080p'], def: '720p', d: '价格按分辨率分档' },
  { k: 'duration', n: '单段时长（秒）', type: 'int', min: 2, max: maxDur, step: 1, def: 5, d: 'duration（秒）' }
]
const SEEDANCE_ROLES = ['first_frame', 'reference_image', 'reference_video', 'reference_audio']

// Seedance 按 token 计费：tokens = 宽 × 高 × 24fps × 秒 / 1024（文档示例 5 秒 720p = 108,900 token）
export const RES_PX: Record<string, number> = { '480p': 854 * 480, '720p': 1280 * 720, '1080p': 1920 * 1080 }
export const vtokPerSec = (res: string) => Math.round((RES_PX[res] || RES_PX['720p']) * 24 / 1024)

const sd = (id: string, vendor: string, v25: boolean, tier: Model['tier'], note = ''): Model => ({
  id, name: id, vendor, cat: 'video', proto: 'video_moldex', caps: ['video_generation', 'text_to_video', 'image_to_video', 'reference'], tier,
  price: v25 ? { unit: 'vtok', per_res: { '480p': 70, '720p': 70 }, with_video: 42, note: '¥70 / 百万 token（含参考视频 ¥42）' } : { unit: 'vtok', per_res: { '480p': 46, '720p': 46, '1080p': 51 }, with_video: 28, note: '¥46 / 百万 token，1080p ¥51（含参考视频 ¥28~31）' },
  roles: SEEDANCE_ROLES, params: SEEDANCE_PARAMS(v25),
  notes: `Moldex 统一协议 POST /v1/video/generations → GET /v1/videos/{id} → GET /v1/videos/{id}/content（均需 Bearer）。支持首帧 / 参考图 / 参考视频 / 参考音频。${note}`
})

export const BUILTIN: Model[] = [
  // ── 对话（纯文本）──
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro（0813）', vendor: 'DeepSeek', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 1000000, max_out: 384000, tier: 'flagship', price: { unit: 'mtok', in: 9, out: 27, cache: 0.3, note: '输入 ¥9 / 输出 ¥27 每百万 token' }, params: CHAT_PARAMS(), notes: '1M 上下文，推理强，适合编剧 / 结构 / 评审' },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash（0731）', vendor: 'DeepSeek', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 1000000, max_out: 384000, tier: 'budget', price: { unit: 'mtok', in: 3, out: 9, cache: 0.1, note: '输入 ¥3 / 输出 ¥9 每百万 token' }, params: CHAT_PARAMS(), notes: '便宜快速，适合批量剧本 / 提示词 / 连贯监管' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: 'DeepSeek', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 4096, tier: 'balanced', price: { unit: 'mtok', in: 12, out: 24, cache: 1, note: '输入 ¥12 / 输出 ¥24 每百万 token' }, params: CHAT_PARAMS(), notes: '旧版别名；推荐改用 deepseek-v4-pro-0813（更新、更便宜、1M 上下文）' },
  { id: 'qwen3.8-max', name: '通义 Qwen3.8 Max', vendor: '阿里', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 1000000, max_out: 128000, tier: 'flagship', price: { unit: 'mtok', in: 12, out: 36, note: '输入 ¥12 / 输出 ¥36 每百万 token' }, params: CHAT_PARAMS() },
  { id: 'qwen3.7-max', name: '通义 Qwen3.7 Max', vendor: '阿里', cat: 'chat', proto: 'chat', caps: ['reasoning'], ctx: 1000000, max_out: 64000, tier: 'balanced', price: { unit: 'mtok', in: 12, out: 36, note: '输入 ¥12 / 输出 ¥36 每百万 token' }, params: CHAT_PARAMS(), notes: '未声明 json_mode，结构化输出建议用其他模型' },
  { id: 'qwen3.7-plus', name: '通义 Qwen3.7 Plus', vendor: '阿里', cat: 'chat', proto: 'chat', caps: ['reasoning'], ctx: 1000000, max_out: 64000, tier: 'budget', price: { unit: 'mtok', in: 2, out: 8, note: '输入 ¥2 / 输出 ¥8 每百万 token' }, params: CHAT_PARAMS(), notes: '未声明 json_mode' },
  { id: 'glm-5.3', name: '智谱 GLM-5.3', vendor: '智谱', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 1000000, max_out: 128000, tier: 'balanced', price: { unit: 'mtok', in: 8, out: 28, cache: 2, note: '输入 ¥8 / 输出 ¥28 每百万 token' }, params: CHAT_PARAMS() },
  { id: 'glm-5.2', name: '智谱 GLM-5.2', vendor: '智谱', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 200000, max_out: 128000, tier: 'balanced', price: { unit: 'mtok', in: 8, out: 28, cache: 2, note: '输入 ¥8 / 输出 ¥28 每百万 token' }, params: CHAT_PARAMS() },
  { id: 'MiniMax-M3', name: 'MiniMax M3', vendor: 'MiniMax', cat: 'chat', proto: 'chat', caps: ['tool_use'], ctx: 4096, tier: 'budget', price: { unit: 'mtok', in: 4.2, out: 16.8, cache: 0.84, note: '输入 ¥4.2 / 输出 ¥16.8 每百万 token' }, params: CHAT_PARAMS(false), notes: '不支持 json_mode / 推理参数，不建议用于结构化 Agent' },
  // ── 对话 + 看图 ──
  { id: 'doubao-seed-2-0-pro', name: '豆包 Seed 2.0 Pro', vendor: '字节', cat: 'vision', proto: 'chat', caps: ['reasoning', 'json_mode', 'vision'], ctx: 256000, max_out: 128000, tier: 'balanced', price: { unit: 'mtok', in: 3.2, out: 16, cache: 0.64, note: '≤32K：输入 ¥3.2 / 输出 ¥16 每百万 token（长上下文阶梯加价）' }, params: CHAT_PARAMS(), notes: '支持图片理解，适合一致性质检（人脸 / 字幕 / 畸形）' },
  { id: 'doubao-seed-2-0-lite', name: '豆包 Seed 2.0 Lite', vendor: '字节', cat: 'vision', proto: 'chat', caps: ['reasoning', 'json_mode', 'vision'], ctx: 256000, max_out: 128000, tier: 'budget', price: { unit: 'mtok', in: 0.6, out: 3.6, note: '≤32K：输入 ¥0.6 / 输出 ¥3.6 每百万 token' }, params: CHAT_PARAMS(), notes: '极便宜，适合合规审核 / 轻量质检' },
  { id: 'kimi-k3', name: 'Kimi K3', vendor: '月之暗面', cat: 'vision', proto: 'chat', caps: ['reasoning', 'json_mode', 'vision'], ctx: 1000000, max_out: 1000000, tier: 'flagship', price: { unit: 'mtok', in: 20, out: 100, cache: 2, note: '输入 ¥20 / 输出 ¥100 每百万 token' }, params: CHAT_PARAMS(), notes: '长文 + 看图，贵；适合高要求评审' },
  // ── 图片 ──
  { id: 'wan2.7-image-pro', name: '万相 2.7 Image Pro', vendor: '阿里', cat: 'image', proto: 'images', caps: ['image_generation'], tier: 'flagship', price: { unit: 'image', per: 0.5, note: '¥0.5 / 张' }, params: IMAGE_PARAMS, notes: 'POST /v1/images/generations；人物细节更好，推荐设定图' },
  { id: 'wan2.7-image', name: '万相 2.7 Image', vendor: '阿里', cat: 'image', proto: 'images', caps: ['image_generation'], tier: 'budget', price: { unit: 'image', per: 0.2, note: '¥0.2 / 张' }, params: IMAGE_PARAMS, notes: 'POST /v1/images/generations；便宜，适合场景图 / 草图' },
  // ── 视频：Seedance（统一协议，支持首帧 / 参考图）──
  sd('doubao-seedance-2-0-cmcc1', '字节 · CMCC1 通道', false, 'balanced', '通道稳定，推荐主力。'),
  sd('doubao-seedance-2-0-sshi', '字节 · SSHI 通道', false, 'balanced', '备用通道（同价）。'),
  sd('seedance2.0-qidian', '字节 · 启点通道', false, 'balanced', '备用通道（同价）。'),
  sd('seedance2.0-qidian-v2', '字节 · 启点 v2 通道', false, 'balanced', '备用通道（同价）。'),
  sd('doubao-seedance-2-5-volc1', '字节 · 火山 VOLC1', true, 'flagship', 'Seedance 2.5：画质 / 运动更好，最长 30 秒，仅 480p / 720p。'),
  sd('seedance2.5-qidian', '字节 · 启点通道', true, 'flagship', 'Seedance 2.5 备用通道（同价）。'),
  // ── 视频：纯文生（通用协议，不支持参考图 / 首帧）──
  { id: 'wan2.7-t2v', name: '万相 2.7 文生视频', vendor: '阿里', cat: 'video', proto: 'video_generic', caps: ['video_generation', 'text_to_video'], tier: 'budget', price: { unit: 'sec', per_res: { '720p': 0.6, '1080p': 1 }, note: '720p ¥0.6/秒，1080p ¥1/秒' }, roles: [], params: T2V_PARAMS(15), notes: '通用协议 POST /v1/video/generations（model + prompt + size + duration）。仅文生：不能锁人物，适合空镜 / 转场 / 片头' },
  { id: 'happyhorse-1.1-t2v', name: 'HappyHorse 1.1 文生视频', vendor: 'HappyHorse', cat: 'video', proto: 'video_generic', caps: ['video_generation', 'text_to_video'], tier: 'balanced', price: { unit: 'sec', per_res: { '720p': 0.9, '1080p': 1.6 }, note: '720p ¥0.9/秒，1080p ¥1.6/秒' }, roles: [], params: T2V_PARAMS(15), notes: '通用协议；仅文生，适合空镜 / 氛围片段' }
]

// ───────── 生产 Agent 的需求 → 可选模型 ─────────
export const NEEDS: Record<string, { cats: Cat[]; json?: boolean; roles?: string[]; why: string; pick: string[] }> = {
  SCREENWRITER: { cats: ['chat', 'vision'], json: true, why: '长文创作 + JSON 输出', pick: ['deepseek-v4-pro-0813', 'qwen3.8-max', 'glm-5.3', 'kimi-k3'] },
  STRUCTURE: { cats: ['chat', 'vision'], json: true, why: '结构推理 + JSON', pick: ['deepseek-v4-pro-0813', 'glm-5.3', 'qwen3.8-max'] },
  SCRIPT: { cats: ['chat', 'vision'], json: true, why: '批量台词，量大要便宜', pick: ['deepseek-v4-flash-0731', 'doubao-seed-2-0-pro', 'deepseek-v4-pro-0813'] },
  REVIEWER: { cats: ['chat', 'vision'], json: true, why: '严格打分，推理强', pick: ['deepseek-v4-pro-0813', 'kimi-k3', 'qwen3.8-max'] },
  PROMPT: { cats: ['chat', 'vision'], json: true, why: '批量改写提示词', pick: ['deepseek-v4-flash-0731', 'doubao-seed-2-0-pro'] },
  CONTINUITY: { cats: ['chat', 'vision'], json: true, why: '逐条比对，低温', pick: ['deepseek-v4-flash-0731', 'deepseek-v4-pro-0813'] },
  COMPLIANCE: { cats: ['chat', 'vision'], json: true, why: '合规扫描，便宜即可', pick: ['doubao-seed-2-0-lite', 'deepseek-v4-flash-0731'] },
  CONSISTENCY: { cats: ['vision'], json: true, why: '必须能看图（首尾帧 / 人脸）', pick: ['doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'kimi-k3'] },
  ASSET: { cats: ['image'], why: '文生图（设定图 / 封面）', pick: ['wan2.7-image-pro', 'wan2.7-image'] },
  VIDEO_MAIN: { cats: ['video'], roles: ['reference_image'], why: '必须支持参考图（锁定人物外貌）', pick: ['doubao-seedance-2-0-cmcc1', 'doubao-seedance-2-5-volc1', 'doubao-seedance-2-0-sshi'] },
  VIDEO_BRANCH: { cats: ['video'], roles: ['first_frame'], why: '必须支持首帧（上一段尾帧接力）', pick: ['doubao-seedance-2-0-cmcc1', 'doubao-seedance-2-5-volc1', 'doubao-seedance-2-0-sshi'] }
}

/** 某模型能否给某 Agent 用：返回 null=可以，否则返回原因 */
export function fitFor(code: string, m: Model | undefined): string | null {
  const n = NEEDS[code]; if (!n || !m) return null
  if (!n.cats.includes(m.cat)) return `${m.id} 属于「${CAT_NAME[m.cat]}」，该 Agent 需要「${n.cats.map((c) => CAT_NAME[c]).join(' / ')}」`
  if (n.json && !m.caps.includes('json_mode')) return `${m.id} 未声明 json_mode，该 Agent 需要结构化 JSON 输出`
  for (const r of n.roles || []) if (!(m.roles || []).includes(r)) return `${m.id} 不支持 ${r}（${n.why}）`
  return null
}
export const CAT_NAME: Record<Cat, string> = { chat: '对话', vision: '对话 + 看图', image: '图片', video: '视频' }

/** 参数校验 + 夹紧：未知模型原样放行；已知模型按参数表规范化（越界夹紧、非法枚举回默认），并返回提示 */
export function normalizeParams(m: Model | undefined, p: any) {
  if (!m) return { params: p || {}, fixes: [] as string[] }
  const out: any = { ...(p || {}) }, fixes: string[] = []
  for (const d of m.params) {
    const v = out[d.k]
    if (v === undefined || v === '' || v === null) { if (d.type === 'enum' && d.options && d.def !== '' && out[d.k] === undefined) {} continue }
    if (d.type === 'enum' && d.options && !d.options.map(String).includes(String(v))) { fixes.push(`${d.n}「${v}」不受支持，改为 ${d.def}`); out[d.k] = d.def }
    if ((d.type === 'int' || d.type === 'float')) { let x = +v; if (!isFinite(x)) { fixes.push(`${d.n} 不是数字，已移除`); delete out[d.k]; continue } if (d.type === 'int') x = Math.round(x); if (d.min !== undefined && x < d.min) { fixes.push(`${d.n} ${x} < ${d.min}，已夹紧`); x = d.min } if (d.max !== undefined && x > d.max) { fixes.push(`${d.n} ${x} > ${d.max}，已夹紧`); x = d.max } out[d.k] = x }
    if (d.type === 'bool') out[d.k] = v === true || v === 'true' || v === 1 || v === '1'
  }
  return { params: out, fixes }
}
export const defaults = (m: Model) => Object.fromEntries(m.params.filter((d) => d.def !== '').map((d) => [d.k, d.def]))

// ───────── 计价 ─────────
/** 视频每秒价格（元）；Seedance 按 token 折算 */
export function videoPerSec(m: Model | undefined, res = '720p') {
  if (!m) return 1
  if (m.price.unit === 'sec') return m.price.per_res?.[res] ?? m.price.per ?? 1
  if (m.price.unit === 'vtok') { const p = m.price.per_res?.[res] ?? m.price.per_res?.['720p'] ?? 46; return +(vtokPerSec(res) * p / 1e6).toFixed(3) }
  return 1
}
/** 真实花费：对话按 token 单价；视频按上游 usage.total_tokens（Seedance）或秒数 */
export function costOf(m: Model | undefined, u: { tin?: number; tout?: number; vtok?: number; sec?: number; res?: string; images?: number; withVideo?: boolean }) {
  if (!m) return 0
  const p = m.price
  if (p.unit === 'mtok') return +(((u.tin || 0) * (p.in || 0) + (u.tout || 0) * (p.out || 0)) / 1e6).toFixed(5)
  if (p.unit === 'image') return +((u.images || 1) * (p.per || 0)).toFixed(3)
  if (p.unit === 'vtok') { const rate = u.withVideo && p.with_video ? p.with_video : p.per_res?.[u.res || '720p'] ?? 46; const tok = u.vtok || (u.sec ? vtokPerSec(u.res || '720p') * u.sec : 0); return +(tok * rate / 1e6).toFixed(3) }
  if (p.unit === 'sec') return +((u.sec || 0) * (p.per_res?.[u.res || '720p'] ?? p.per ?? 0)).toFixed(3)
  return 0
}
/** 通用协议（万相 / HappyHorse）的像素尺寸 */
export function sizeOf(ratio = '9:16', res = '720p') {
  const s = res === '1080p' ? 1080 : res === '480p' ? 480 : 720, l = Math.round(s * 16 / 9)
  return ratio === '16:9' ? `${l}x${s}` : ratio === '1:1' ? `${s}x${s}` : `${s}x${l}`
}

// ───────── 在线目录（缓存 6 小时）─────────
const byId = new Map(BUILTIN.map((m) => [m.id, m]))
let live: { at: number; list: Model[] } | null = null
export function find(id?: string | null) { if (!id) return undefined; return byId.get(id) || live?.list.find((m) => m.id === id) }

function classifyLive(x: any): Model | null {
  const caps: string[] = (() => { try { const c = JSON.parse(x.capabilities || '[]'); return Array.isArray(c) ? c : [] } catch { return [] } })()
  const t = String(x.model_type || '')
  const items = (x.pricing_summary?.sections || []).flatMap((s: any) => s.items || [])
  const num = (re: RegExp) => items.find((i: any) => re.test(i.label) && i.value)?.value
  const id = x.name
  if (t === 'chat') return { id, name: x.display_name || id, vendor: x.family_name || '—', cat: caps.includes('vision') ? 'vision' : 'chat', proto: 'chat', caps, ctx: x.context_length, max_out: x.max_output, price: { unit: 'mtok', in: num(/输入/), out: num(/输出/), note: `输入 ¥${num(/输入/) ?? '?'} / 输出 ¥${num(/输出/) ?? '?'} 每百万 token` }, params: CHAT_PARAMS(caps.includes('reasoning')), source: 'live', notes: '在线同步的新模型（按能力自动归类）' }
  if (t === 'image') return { id, name: x.display_name || id, vendor: x.family_name || '—', cat: 'image', proto: 'images', caps, price: { unit: 'image', per: num(/单价/), note: `¥${num(/单价/) ?? '?'} / 张` }, params: IMAGE_PARAMS, source: 'live' }
  if (t === 'video') {
    const seed = /seedance/i.test(id + (x.family_name || '')), v25 = /2[.-]5/.test(id)
    if (seed) return { ...sd(id, x.supplier_domain_display_name || x.family_name || '字节', v25, 'balanced', '在线同步的新通道。'), source: 'live' }
    const per = num(/每秒/); return { id, name: x.display_name || id, vendor: x.family_name || '—', cat: 'video', proto: 'video_generic', caps, price: { unit: 'sec', per, note: `¥${per ?? '?'} / 秒` }, roles: [], params: T2V_PARAMS(15), source: 'live', notes: '在线同步的新视频模型（通用协议，按文生处理）' }
  }
  return null
}

export async function catalog(env: Env, pv?: { base: string; key: string; extra?: any } | null, force = false) {
  const portal = pv?.extra?.portal_url || 'https://www.suanli.com/api/v1/portal/models'
  let sync = { ok: false, at: live?.at || 0, added: [] as string[], note: '' }
  if (force || !live || now() - live.at > 6 * 3600e3) {
    try {
      const r = await fetch(portal, { headers: { accept: 'application/json' } }); const d: any = await r.json()
      const rows: any[] = d.data || []; const list = rows.map(classifyLive).filter(Boolean) as Model[]
      live = { at: now(), list: list.filter((m) => !byId.has(m.id)) }
      // 内置模型用在线价格刷新（算力网调价后自动生效）
      for (const x of rows) { const b = byId.get(x.name), l = classifyLive(x); if (b && l && b.price.unit === l.price.unit && (l.price.in || l.price.per)) { if (l.price.in) { b.price.in = l.price.in; b.price.out = l.price.out } if (b.price.unit === 'image' && l.price.per) { b.price.per = l.price.per; b.price.note = `¥${l.price.per} / 张` } } }
      sync = { ok: true, at: live.at, added: live.list.map((m) => m.id), note: `已同步 ${rows.length} 个模型` }
    } catch (e: any) { sync.note = '在线目录暂不可达，使用内置目录：' + String(e?.message || e).slice(0, 80) }
  } else sync = { ok: true, at: live.at, added: live.list.map((m) => m.id), note: '使用 6 小时内的缓存' }
  let available: string[] | null = null, keyNote = ''
  if (pv?.key) {
    try { const r = await fetch(pv.base.replace(/\/v1$/, '') + '/v1/models', { headers: { Authorization: 'Bearer ' + pv.key } }); const d: any = await r.json().catch(() => ({})); if (r.ok) available = (d.data || []).map((m: any) => m.id); else keyNote = d.error?.code || `HTTP ${r.status}` } catch (e: any) { keyNote = String(e?.message || e).slice(0, 60) }
  }
  const all = [...BUILTIN, ...(live?.list || [])]
  const models = all.map((m) => ({ ...m, available: available ? available.includes(m.id) : null, per_sec_720p: m.cat === 'video' ? videoPerSec(m, '720p') : undefined, fit: Object.fromEntries(Object.keys(NEEDS).map((c) => [c, fitFor(c, m)])) }))
  const agents = Object.fromEntries(Object.entries(NEEDS).map(([c, n]) => [c, { ...n, options: models.filter((m) => !m.fit[c]).map((m) => m.id) }]))
  return { models, agents, cats: CAT_NAME, sync, key: { checked: !!pv?.key, ok: !!available, note: keyNote, count: available?.length ?? null }, docs: 'https://www.suanli.com/api-docs' }
}
