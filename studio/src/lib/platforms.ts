// 多平台模型接入：算力网 suanli.com · TokenHot（docs.tokenhot.cn）· DeepSeek 官方 · 豆包 / 火山方舟官方
// 每个平台：默认 Base、文档、目录（模型 → 类别 / 协议 / 文档参数表 / 价格 / 素材角色）、推荐预设、连通测试与余额
// 资料来源（2026-09-30 核对）：
//   TokenHot：https://docs.tokenhot.cn/llms.txt 全部 API 文档 + 公开价格表 https://api.tokenhot.cn/api/pricing（new-api 网关）
//   DeepSeek：https://api-docs.deepseek.com（首次调用 / 模型与价格 / 思考模式 / 余额 /user/balance）
//   火山方舟：https://www.volcengine.com/docs/82379（模型列表 1330310 / 创建与查询视频任务 1520757·1521309 / 价格 1544106）
import type { Env } from './auth'
import * as Sl from './suanli'
import type { Model, Param } from './suanli'

const now = () => Date.now()
export type Kind = 'suanli' | 'tokenhot' | 'deepseek' | 'ark'
export const PLATFORM_KINDS: Kind[] = ['suanli', 'tokenhot', 'deepseek', 'ark']
export const isPlatform = (k?: string | null): k is Kind => !!k && (PLATFORM_KINDS as string[]).includes(k)

export const PLATFORMS: Record<Kind, { name: string; short: string; base: string; docs: string; keyUrl: string; covers: string; balance: boolean; cats: string[] }> = {
  suanli: { name: '算力网 suanli.com', short: '算力网', base: 'https://api.suanli.com', docs: 'https://www.suanli.com/api-docs', keyUrl: 'https://www.suanli.com', covers: '对话 + 图片 + 视频（Seedance 2.0/2.5）', balance: false, cats: ['chat', 'vision', 'image', 'video'] },
  tokenhot: { name: 'TokenHot', short: 'TokenHot', base: 'https://api.tokenhot.cn', docs: 'https://docs.tokenhot.cn', keyUrl: 'https://api.tokenhot.cn/console/token', covers: '对话（GPT / Claude / Gemini / DeepSeek / Qwen / GLM / Kimi）+ 图片（Seedream / GPT Image / Nano Banana / Qwen）+ 视频（Seedance / Kling / Veo / Wan 3.0 / HappyHorse / Grok / Gemini Omni）', balance: true, cats: ['chat', 'vision', 'image', 'video'] },
  deepseek: { name: 'DeepSeek 官方', short: 'DeepSeek', base: 'https://api.deepseek.com', docs: 'https://api-docs.deepseek.com/zh-cn/', keyUrl: 'https://platform.deepseek.com/api_keys', covers: '对话（V4 Pro / V4.1 Flash，Flash 可看图）', balance: true, cats: ['chat', 'vision'] },
  ark: { name: '豆包 · 火山方舟官方', short: '火山方舟', base: 'https://ark.cn-beijing.volces.com/api/v3', docs: 'https://www.volcengine.com/docs/82379', keyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apiKey', covers: '对话（Seed 2.1 / 2.0）+ 图片（Seedream 5.0）+ 视频（Seedance 2.5 / 2.0 / fast / mini）', balance: false, cats: ['chat', 'vision', 'image', 'video'] }
}

// ───────── 通用参数表 ─────────
const P = {
  temp: (def = 0.7): Param => ({ k: 'temperature', n: '采样温度', type: 'float', min: 0, max: 2, step: 0.05, def, d: 'temperature 0~2；思考模式下部分模型会忽略' }),
  topP: (): Param => ({ k: 'top_p', n: '核采样', type: 'float', min: 0, max: 1, step: 0.05, def: 1, d: 'top_p 0~1' }),
  maxTok: (k: string, max: number, def = 8192): Param => ({ k, n: '最大输出 token', type: 'int', min: 256, max, step: 256, def, d: `${k}，上限 ${max}` }),
  seed: (k = 'seed', d = '随机种子（留空=随机）'): Param => ({ k, n: '随机种子', type: 'int', min: 0, max: 2147483647, step: 1, def: '', d }),
  enumP: (k: string, n: string, options: (string | number)[], def: any, d: string): Param => ({ k, n, type: 'enum', options, def, d }),
  intP: (k: string, n: string, min: number, max: number, def: number, d: string): Param => ({ k, n, type: 'int', min, max, step: 1, def, d }),
  bool: (k: string, n: string, def: boolean, d: string): Param => ({ k, n, type: 'bool', def, d })
}
const VIDEO_P = (o: { ratios: string[]; res: string[]; resDef?: string; min: number; max: number; def?: number; durEnum?: number[]; audio?: boolean; seed?: boolean; watermark?: boolean; ratioDef?: string }): Param[] => [
  P.enumP('ratio', '画面比例', o.ratios, o.ratioDef || (o.ratios.includes('9:16') ? '9:16' : o.ratios[0]), '竖屏短剧用 9:16；adaptive = 随首帧 / 素材自适应'),
  P.enumP('resolution', '分辨率', o.res, o.resDef || (o.res.includes('720p') ? '720p' : o.res.includes('720P') ? '720P' : o.res[0]), `可选：${o.res.join(' / ')}`),
  o.durEnum ? P.enumP('duration', '单段时长（秒）', o.durEnum, o.def ?? o.durEnum[o.durEnum.length - 1], `只能取 ${o.durEnum.join(' / ')} 秒`) : P.intP('duration', '单段时长（秒）', o.min, o.max, o.def ?? Math.min(8, o.max), `范围 ${o.min}~${o.max} 秒`),
  ...(o.audio === false ? [] : [P.bool('audio', '同时生成音频', true, '有声（台词 / 环境音）')]),
  ...(o.watermark === false ? [] : [P.bool('watermark', 'AI 水印', false, '是否加水印')]),
  ...(o.seed === false ? [] : [P.seed()])
]
const IMG_P = (portrait: string[], landscape: string[], extra: Param[] = []): Param[] => [
  P.enumP('size_portrait', '竖版尺寸（封面 3:4）', portrait, portrait[0], '封面 / 竖版海报'), P.enumP('size_landscape', '横版尺寸（设定图 16:9）', landscape, landscape[0], '角色设定图 / 场景图'), ...extra
]

// ═════════ TokenHot（new-api 网关）═════════
// 价格：quota_type=0 → 输入 ¥/百万 = model_ratio × 2 美元 × 充值汇率（price，默认 7）；输出 = 输入 × completion_ratio
//       quota_type=1 → 按次 model_price 美元 × 汇率；视频 / 部分图片 model_ratio=37.5（默认倍率）→ 以任务返回 quota 为准（quota / quota_per_unit 美元）
const TH = { rate: 7, qpu: 500000 }
const SEEDANCE_ROLES = ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']
function thVideo(id: string): Partial<Model> | null {
  const m = id.toLowerCase()
  if (/seedance/.test(m)) {
    const v25 = /2[-.]5/.test(m), lite = /fast|mini/.test(m)
    const res = v25 || lite ? ['480p', '720p'] : ['480p', '720p', '1080p', '4k']
    return { proto: 'th_seedance', roles: SEEDANCE_ROLES, params: VIDEO_P({ ratios: ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9', 'adaptive'], res, min: 4, max: v25 ? 30 : 15 }), notes: `content[] 协议（与火山 Ark 一致）：text + image_url(role=first_frame/last_frame/reference_image) + video_url/audio_url；参考图 1~${v25 ? 30 : 9} 张；首帧/首尾帧与多模态参考互斥。${/filter-off/.test(m) ? '（filter-off：关闭上游内容过滤通道）' : ''}` }
  }
  if (/^kling/.test(m)) return { proto: 'th_kling', roles: ['first_frame', 'last_frame'], public_url: true, params: [P.enumP('ratio', '画面比例', ['9:16', '16:9', '1:1'], '9:16', 'aspect_ratio'), P.enumP('resolution', '分辨率', ['720P', '1080P', '4K'], '720P', 'size'), P.intP('duration', '单段时长（秒）', 3, 15, 8, '3~15 秒'), P.bool('audio', '生成音效', true, 'audio_generation'), P.enumP('enhance_prompt', '提示词增强', ['', 'Enabled', 'Disabled'], '', 'enhance_prompt')], notes: 'Kling：prompt + file_infos[{Type:Url, Category:Image, Url, Usage:FirstFrame/LastFrame}]；图片须公网 URL；主体控制需先创建主体（未接入）' } as any
  if (/^veo/.test(m)) return { proto: 'th_veo', roles: ['first_frame', 'last_frame', 'reference_image'], public_url: true, params: [P.enumP('ratio', '画面比例', ['9:16', '16:9', 'Auto'], '9:16', 'aspect_ratio'), P.enumP('resolution', '分辨率', ['720p', '1080p', '4k'], '720p', '上游返回的 resolution 不可信，以请求为准'), P.enumP('duration', '单段时长（秒）', [4, 6, 8], 8, '4 / 6 / 8 秒；参考图模式仅 8 秒'), P.bool('enableTranslation', '提示词自动翻译为英文', true, 'enableTranslation（Veo 建议英文）')], notes: 'Veo 3.1：imageUrls 1 张 = 首帧；2 张 = 首尾帧；参考模式 1~3 张（REFERENCE_2_VIDEO，仅 8 秒）；须公网 URL' } as any
  if (/^wan3/.test(m)) return { proto: 'th_wan3', roles: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'], params: [...VIDEO_P({ ratios: ['9:16', '16:9', '1:1', '3:4', '4:3', 'adaptive'], res: ['720P', '1080P', '480P'], min: 2, max: 30, def: 8 }), P.bool('prompt_extend', '提示词智能改写', false, 'prompt_extend（会增加耗时）')], notes: 'Wan 3.0：input.prompt + input.media[{type:first_frame/reference_image…, url}] + parameters；支持 base64 图片；时长 2~30 秒' }
  if (/happyhorse.*i2v/.test(m)) return { proto: 'th_happyhorse', roles: ['first_frame'], params: VIDEO_P({ ratios: ['adaptive'], res: ['720P', '1080P'], min: 3, max: 15, def: 5, audio: false }), notes: 'HappyHorse 图生视频：input.media 仅 first_frame；宽高比随首帧' }
  if (/happyhorse.*r2v/.test(m)) return { proto: 'th_happyhorse', roles: ['reference_image'], public_url: true, params: VIDEO_P({ ratios: ['9:16', '16:9', '3:4', '4:3', '1:1'], res: ['720P', '1080P'], min: 3, max: 15, def: 5, audio: false }), notes: 'HappyHorse 参考生视频：input.media reference_image，提示词用 character1/character2 指代；须公网 URL' } as any
  if (/happyhorse.*t2v/.test(m)) return { proto: 'th_happyhorse', roles: [], params: VIDEO_P({ ratios: ['9:16', '16:9', '1:1', '3:4', '4:3'], res: ['720P', '1080P'], min: 3, max: 15, def: 5, audio: false }), notes: 'HappyHorse 文生视频：不能锁人物，只适合空镜' }
  if (/happyhorse.*edit/.test(m)) return { proto: 'unsupported', roles: [], params: [], notes: '视频编辑模型（需要源视频），生产线暂不使用' }
  if (/grok-imagine-video/.test(m)) return { proto: 'th_grok', roles: ['first_frame'], public_url: true, params: VIDEO_P({ ratios: ['9:16', '16:9', '1:1', '3:4', '4:3', '2:3', '3:2', 'auto'], res: ['480p', '720p'], min: 1, max: 15, def: 8, audio: false, seed: false, watermark: false }), notes: 'Grok Imagine：图生视频，input.image_urls 必填且仅 1 张（公网 URL，不支持 base64）' } as any
  if (/gemini-omni-video/.test(m)) return { proto: 'th_omni', roles: ['reference_image'], public_url: true, params: VIDEO_P({ ratios: ['9:16', '16:9'], res: ['720p', '1080p', '4k'], min: 4, max: 10, durEnum: [4, 6, 8, 10], audio: false, watermark: false }), notes: 'Gemini Omni：input.image_urls 参考图最多 7 张（公网 URL）；时长 4/6/8/10' } as any
  return { proto: 'unsupported', roles: [], params: [], notes: '文档中没有该视频模型的调用协议' }
}
function thImage(id: string, eps: string[]): Partial<Model> {
  const m = id.toLowerCase()
  if (/nano-banana|gemini.*image/.test(m)) return { proto: 'th_gemini_image', params: [P.enumP('image_size', '清晰度', ['2K', '1K', '4K'], '2K', 'imageConfig.imageSize'), P.enumP('ratio_portrait', '竖版比例（封面）', ['3:4', '9:16', '2:3', '4:5'], '3:4', 'imageConfig.aspectRatio'), P.enumP('ratio_landscape', '横版比例（设定图）', ['16:9', '3:2', '4:3', '21:9'], '16:9', 'imageConfig.aspectRatio')], notes: 'Gemini 原生协议 POST /v1beta/models/{model}:generateContent；本渠道以 URL 文本返回' }
  if (/seedream/.test(m) && eps.includes('openai')) return { proto: 'th_images', params: IMG_P(['1536x2048', '1728x2304', '2K'], ['2048x1152', '2560x1440', '2K']), notes: 'POST /v1/images/generations；size 可写像素（总像素 92 万~462 万）或 2K / 4K' }
  if (/gpt-image/.test(m)) return { proto: 'th_images', params: IMG_P(['1024x1536', '1152x2048', '864x1536'], ['1536x1024', '2048x1152', '1536x864'], [P.enumP('quality', '质量', ['auto', 'high', 'medium', 'low'], 'auto', 'quality')]), notes: 'OpenAI 图片协议 POST /v1/images/generations' }
  if (/qwen-image/.test(m)) return { proto: 'th_qwen_image', params: IMG_P(['1104*1472', '928*1664', '1328*1328'], ['1664*928', '1472*1104', '1328*1328'], [P.bool('prompt_extend', '智能改写', true, 'parameters.prompt_extend')]), notes: '通义图片协议：input.messages[].content[].text + parameters.size（宽*高）' }
  return { proto: 'unsupported', params: [], notes: '文档中没有该图片模型的调用协议（或只支持 Responses 接口）' }
}
function thClassify(r: any, vendors: Record<number, string>): Model | null {
  const id = String(r.model_name || ''); if (!id) return null
  const inM = String(r.input_modalities || ''), outM = String(r.output_modalities || ''), tags = String(r.tags || ''), eps: string[] = r.supported_endpoint_types || []
  const vendor = vendors[r.vendor_id] || '—', free = vendor === 'free' || /-free$/.test(id)
  const ratio = +r.model_ratio || 0, comp = +r.completion_ratio || 1, price = +r.model_price || 0, dyn = r.quota_type === 0 && ratio === 37.5
  const pr = (): Model['price'] => r.quota_type === 1 ? { unit: 'call', per: +(price * TH.rate).toFixed(3), note: `¥${(price * TH.rate).toFixed(3)} / 次（$${price}）` }
    : dyn ? { unit: 'quota', note: '按任务动态计费（倍率未公开），以任务返回 quota 实扣为准' }
    : free ? { unit: 'mtok', in: 0, out: 0, note: '免费（每分钟 5 次，随时可能下架，不建议生产）' }
    : { unit: 'mtok', in: +(ratio * 2 * TH.rate).toFixed(3), out: +(ratio * 2 * TH.rate * comp).toFixed(3), note: `输入 ¥${(ratio * 2 * TH.rate).toFixed(2)} / 输出 ¥${(ratio * 2 * TH.rate * comp).toFixed(2)} 每百万 token` }
  const base = { id, name: id, vendor, caps: tags.split(',').filter(Boolean), ctx: r.context_length || undefined, source: 'live' as const, platform: 'tokenhot' }
  if (/视频/.test(outM)) { const v = thVideo(id)!; return { ...base, cat: 'video', price: pr(), tier: /mini|fast|lite/.test(id) ? 'budget' : /2[-.]5|veo|kling/.test(id) ? 'flagship' : 'balanced', ...v } as Model }
  if (/图像/.test(outM) && !/^文本$/.test(outM)) { const v = thImage(id, eps); return { ...base, cat: 'image', price: pr(), tier: /lite|sale|flash/.test(id) ? 'budget' : 'balanced', ...v } as Model }
  if (/音频/.test(outM) && !/文本/.test(outM)) return { ...base, cat: 'chat', proto: 'unsupported', price: pr(), params: [], notes: '语音合成模型，生产线暂未使用' } as Model
  if (!eps.includes('openai')) return { ...base, cat: 'chat', proto: 'unsupported', price: pr(), params: [], notes: '不支持 OpenAI 兼容对话接口' } as Model
  if (/embedding/.test(id)) return { ...base, cat: 'chat', proto: 'unsupported', price: pr(), params: [], notes: '向量模型' } as Model
  const json = /结构化输出|函数调用|工具调用/.test(tags), vision = /图像/.test(inM)
  return { ...base, cat: vision ? 'vision' : 'chat', proto: 'chat', caps: [...base.caps, ...(json ? ['json_mode'] : []), ...(vision ? ['vision'] : [])], price: pr(), tier: free ? 'budget' : ratio >= 2 ? 'flagship' : ratio <= 0.2 ? 'budget' : 'balanced', params: [P.temp(), P.topP(), P.maxTok('max_tokens', 65536), P.enumP('reasoning_effort', '推理力度', ['', 'low', 'medium', 'high'], '', '仅推理模型；留空=默认'), P.seed()], notes: free ? '免费模型：每分钟 5 次，随时可能下架' : undefined } as Model
}
let thLive: { at: number; list: Model[]; raw: number; note: string } | null = null
export async function tokenhotModels(env: Env, pv?: { base?: string; extra?: any } | null, force = false) {
  if (!force && thLive && now() - thLive.at < 6 * 3600e3) return thLive
  const pricing = pv?.extra?.pricing_url || (pv?.base ? root('tokenhot', pv.base) + '/api/pricing' : 'https://api.tokenhot.cn/api/pricing'), status = pv?.extra?.status_url || pricing.replace(/\/api\/pricing$/, '/api/status')
  try {
    const st: any = await fetch(status).then((r) => r.json()).catch(() => null)
    if (st?.data?.price) TH.rate = +st.data.price || 7; if (st?.data?.quota_per_unit) TH.qpu = +st.data.quota_per_unit || 500000
    const d: any = await fetch(pricing, { headers: { accept: 'application/json' } }).then((r) => r.json())
    const vendors = Object.fromEntries((d.vendors || []).map((v: any) => [v.id, v.name]))
    const list = (d.data || []).map((r: any) => thClassify(r, vendors)).filter(Boolean) as Model[]
    thLive = { at: now(), list, raw: (d.data || []).length, note: `已从 TokenHot 公开价格表同步 ${list.length} 个模型（¥${TH.rate} = $1）` }
  } catch (e: any) { if (!thLive) thLive = { at: 0, list: [], raw: 0, note: 'TokenHot 价格表暂不可达：' + String(e?.message || e).slice(0, 80) } }
  return thLive
}
export const thQuotaCny = (quota: number) => +((quota || 0) / TH.qpu * TH.rate).toFixed(4)

// ═════════ DeepSeek 官方 ═════════
const DS_PARAMS = (vision: boolean): Param[] => [
  P.enumP('thinking', '思考模式', ['', 'enabled', 'disabled'], '', 'thinking.type：默认开启；关闭后更快更省，temperature 才生效'),
  P.enumP('reasoning_effort', '思考强度', ['', 'low', 'high', 'max'], '', 'reasoning_effort：low / high（默认）/ max'),
  P.temp(0.7), P.topP(), P.maxTok('max_tokens', 384000, 8192),
  P.enumP('peak_hint', '计价提示', ['auto'], 'auto', `高峰：工作日 9-12 / 14-18 点（北京时间），其余时段半价${vision ? '' : ''}`)
]
export const DEEPSEEK: Model[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro（0813）', vendor: 'DeepSeek', cat: 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling'], ctx: 1000000, max_out: 384000, tier: 'flagship', platform: 'deepseek', price: { unit: 'mtok', in: 9, out: 27, cache: 0.3, idle: { in: 4.5, out: 13.5 }, note: '高峰 输入 ¥9 / 输出 ¥27；空闲半价 ¥4.5 / ¥13.5（每百万 token）' }, params: DS_PARAMS(false), notes: '官方直连；1M 上下文，最大输出 384K；不支持图像理解' },
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek', cat: 'vision', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling', 'vision'], ctx: 1000000, max_out: 384000, tier: 'budget', platform: 'deepseek', price: { unit: 'mtok', in: 2, out: 8, cache: 0.04, idle: { in: 1, out: 4 }, note: '高峰 输入 ¥2 / 输出 ¥8；空闲 ¥1 / ¥4（每百万 token）' }, params: DS_PARAMS(true), notes: '官方推荐模型名 deepseek-flash（旧名 deepseek-v4-flash 已转发到 V4.1 Flash）；支持图像理解' }
]
/** DeepSeek 高峰：北京时间周一至周五 9-12、14-18 */
export function dsPeak(t = now()) { const d = new Date(t + 8 * 3600e3), w = d.getUTCDay(), h = d.getUTCHours(); return w >= 1 && w <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18)) }

// ═════════ 豆包 · 火山方舟官方 ═════════
const ARK_CHAT = (): Param[] => [P.enumP('thinking', '深度思考', ['', 'enabled', 'disabled', 'auto'], '', 'thinking.type：enabled / disabled / auto；关闭更快更省'), P.temp(0.7), P.topP(), P.maxTok('max_tokens', 262144, 8192), P.enumP('reasoning_effort', '思考强度', ['', 'minimal', 'low', 'medium', 'high'], '', 'reasoning_effort（可选）')]
const arkChat = (id: string, name: string, vision: boolean, price: Model['price'], tier: Model['tier'], notes = '', deprecated = false): Model => ({ id, name, vendor: '字节 · 火山方舟', cat: vision ? 'vision' : 'chat', proto: 'chat', caps: ['reasoning', 'json_mode', 'function_calling', ...(vision ? ['vision'] : [])], ctx: /turbo/.test(id) ? 256000 : 1024000, max_out: 262144, tier, platform: 'ark', price, params: ARK_CHAT(), notes, deprecated })
const arkSd = (id: string, name: string, o: { res: string[]; max: number; list: Record<string, number>; withVideo: number; promo?: { factor: number; until: string }; tier: Model['tier']; notes: string }): Model => ({
  id, name, vendor: '字节 · 火山方舟', cat: 'video', proto: 'ark_seedance', caps: ['video_generation', 'text_to_video', 'image_to_video', 'reference', 'last_frame'], tier: o.tier, platform: 'ark', roles: SEEDANCE_ROLES,
  price: { unit: 'vtok', per_res: o.list, with_video: o.withVideo, note: `${Object.entries(o.list).map(([r, p]) => `${r} ¥${p}`).join(' · ')} / 百万 token（含参考视频 ¥${o.withVideo}）${o.promo ? ` · 限时 ${o.promo.factor * 10} 折至 ${o.promo.until}` : ''}`, ...(o.promo ? { promo: o.promo } : {}) } as any,
  params: VIDEO_P({ ratios: ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9', 'adaptive'], res: o.res, min: 4, max: o.max }), notes: o.notes
})
export const ARK: Model[] = [
  arkChat('doubao-seed-2-1-pro-260915', '豆包 Seed 2.1 Pro', true, { unit: 'mtok', in: 6, out: 30, cache: 1.2, note: '输入 ¥6 / 输出 ¥30 每百万 token' }, 'flagship', '旗舰：复杂推理、长文、多模态理解；1M 上下文'),
  arkChat('doubao-seed-2-1-lite-260915', '豆包 Seed 2.1 Lite', true, { unit: 'mtok', in: 0.8, out: 2.7, cache: 0.16, note: '输入 ¥0.8 / 输出 ¥2.7 每百万 token' }, 'budget', '极高性价比，RPM 3 万；适合批量剧本 / 提示词 / 质检'),
  arkChat('doubao-seed-2-1-turbo-260628', '豆包 Seed 2.1 Turbo', true, { unit: 'mtok', in: 3, out: 15, cache: 0.6, note: '输入 ¥3 / 输出 ¥15 每百万 token' }, 'balanced', '256K 上下文'),
  arkChat('doubao-seed-evolving', '豆包 Seed Evolving（持续迭代）', true, { unit: 'mtok', in: 6, out: 30, cache: 1.2, note: '输入 ¥6 / 输出 ¥30 每百万 token' }, 'flagship', '固定 ID 自动跟随最新生产版本（结果可能随版本变化）'),
  arkChat('doubao-seed-2-0-lite-260428', '豆包 Seed 2.0 Lite', true, { unit: 'mtok', in: 0.6, out: 3.6, cache: 0.12, tiers: [{ upto: 32000, in: 0.6, out: 3.6 }, { upto: 128000, in: 0.9, out: 5.4 }, { upto: 256000, in: 1.8, out: 10.8 }], note: '≤32K 输入 ¥0.6 / 输出 ¥3.6（长输入阶梯加价）' } as any, 'budget'),
  arkChat('doubao-seed-2-0-mini-260428', '豆包 Seed 2.0 Mini', true, { unit: 'mtok', in: 0.2, out: 2, cache: 0.04, tiers: [{ upto: 32000, in: 0.2, out: 2 }, { upto: 128000, in: 0.4, out: 4 }, { upto: 256000, in: 0.8, out: 8 }], note: '≤32K 输入 ¥0.2 / 输出 ¥2' } as any, 'budget', '最便宜，适合合规扫描'),
  arkChat('doubao-seed-2-0-pro-260215', '豆包 Seed 2.0 Pro（即将下线）', true, { unit: 'mtok', in: 3.2, out: 16, tiers: [{ upto: 32000, in: 3.2, out: 16 }, { upto: 128000, in: 4.8, out: 24 }, { upto: 256000, in: 9.6, out: 48 }], note: '≤32K 输入 ¥3.2 / 输出 ¥16' } as any, 'balanced', '官方标注即将下线，建议迁移到 Seed 2.1', true),
  { ...arkChat('deepseek-v4-pro-ga-260813', 'DeepSeek V4 Pro（方舟托管）', false, { unit: 'mtok', in: 9, out: 27, cache: 0.3, note: '输入 ¥9 / 输出 ¥27 每百万 token' }, 'flagship', '火山方舟托管的 DeepSeek，不支持图像理解'), vendor: 'DeepSeek · 火山方舟' },
  { ...arkChat('deepseek-v4-1-flash-260910', 'DeepSeek V4.1 Flash（方舟托管）', false, { unit: 'mtok', in: 2, out: 8, idle: { in: 1, out: 4 }, note: '高峰 ¥2 / ¥8；空闲 ¥1 / ¥4 每百万 token' }, 'budget'), vendor: 'DeepSeek · 火山方舟' },
  { ...arkChat('glm-5-2-260617', '智谱 GLM-5.2（方舟托管）', false, { unit: 'mtok', in: 8, out: 28, note: '输入 ¥8 / 输出 ¥28 每百万 token' }, 'balanced'), vendor: '智谱 · 火山方舟' },
  // 图片（Seedream）
  { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro', vendor: '字节 · 火山方舟', cat: 'image', proto: 'ark_image', caps: ['image_generation', 'reference'], tier: 'flagship', platform: 'ark', price: { unit: 'image', per: 0.6, per_px: { limit: 2610000, lo: 0.3, hi: 0.6 }, note: '≤261 万像素 ¥0.30 / 张，更大 ¥0.60 / 张' } as any, params: IMG_P(['1536x2048', '1200x1600', '2K'], ['2048x1152', '1600x900', '2K']), notes: '最高画质；1536x2048 为 314 万像素（¥0.60），选 1200x1600 可降到 ¥0.30' },
  { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0', vendor: '字节 · 火山方舟', cat: 'image', proto: 'ark_image', caps: ['image_generation', 'reference', 'group'], tier: 'balanced', platform: 'ark', price: { unit: 'image', per: 0.22, note: '¥0.22 / 张' }, params: IMG_P(['1536x2048', '2K'], ['2048x1152', '2K']), notes: '支持组图；同时兼容 doubao-seedream-5-0-lite-260128' },
  { id: 'doubao-seedream-5-0-flash-260915', name: 'Seedream 5.0 Flash', vendor: '字节 · 火山方舟', cat: 'image', proto: 'ark_image', caps: ['image_generation'], tier: 'budget', platform: 'ark', price: { unit: 'image', per: 0.12, note: '¥0.12 / 张' }, params: IMG_P(['1536x2048', '2K'], ['2048x1152', '2K']), notes: '最便宜，适合草图 / 场景参考' },
  // 视频（Seedance）
  arkSd('doubao-seedance-2-0-260128', 'Seedance 2.0', { res: ['480p', '720p', '1080p', '4k'], max: 15, list: { '480p': 46, '720p': 46, '1080p': 51, '4k': 26 }, withVideo: 28, tier: 'balanced', notes: '官方主力：720p 5 秒 ≈ ¥4.97（¥0.99/秒），1080p ≈ ¥2.48/秒，4k ≈ ¥5.05/秒；可返回尾帧（return_last_frame）用于分支接力。注意：2.x 不接受真人人脸参考图（AI 生成的设定图可用）' }),
  arkSd('doubao-seedance-2-5-260628', 'Seedance 2.5', { res: ['480p', '720p', '1080p'], max: 30, list: { '480p': 70, '720p': 70, '1080p': 77 }, withVideo: 42, tier: 'flagship', notes: '画质最好，最长 30 秒；720p ≈ ¥1.51/秒，1080p ≈ ¥3.74/秒；首帧 / 首尾帧任务宽高比只能 adaptive（随首帧）' }),
  arkSd('doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast', { res: ['480p', '720p'], max: 15, list: { '480p': 37, '720p': 37 }, withVideo: 22, promo: { factor: 0.75, until: '2026-10-07T14:00:00+08:00' }, tier: 'budget', notes: '更快；720p ≈ ¥0.80/秒（限时 75 折约 ¥0.6/秒，仅企业用户）' }),
  arkSd('doubao-seedance-2-0-mini-260615', 'Seedance 2.0 Mini', { res: ['480p', '720p'], max: 15, list: { '480p': 23, '720p': 23 }, withVideo: 14, promo: { factor: 0.4, until: '2026-10-07T14:00:00+08:00' }, tier: 'budget', notes: '最便宜；720p ≈ ¥0.50/秒（限时 4 折约 ¥0.2/秒，仅企业用户）；适合分支批量生成' })
]

// ───────── 目录读取 ─────────
export async function modelsOf(env: Env, kind: Kind, pv?: any, force = false): Promise<{ list: Model[]; note: string; at: number }> {
  if (kind === 'suanli') { await Sl.catalog(env, null, force).catch(() => null); return { list: Sl.allModels(), note: '算力网内置目录 + 模型广场在线同步', at: now() } }
  if (kind === 'tokenhot') { const t = await tokenhotModels(env, pv, force); return { list: t.list, note: t.note, at: t.at } }
  if (kind === 'deepseek') return { list: DEEPSEEK, note: '依据 DeepSeek 官方文档（模型与价格 / 思考模式）', at: now() }
  return { list: ARK, note: '依据火山方舟官方文档（模型列表 / 视频任务 / 模型价格）', at: now() }
}
export async function findModel(env: Env, kind: string, id?: string | null, pv?: any) {
  if (!id || !isPlatform(kind)) return undefined
  if (kind === 'suanli') return Sl.find(id)
  const { list } = await modelsOf(env, kind, pv)
  return list.find((m) => m.id === id)
}
/** 同步查找（已加载的缓存）；计价 / 构造请求时使用 */
export function findSync(kind: string, id?: string | null) {
  if (!id) return undefined
  if (kind === 'suanli') return Sl.find(id)
  if (kind === 'tokenhot') return thLive?.list.find((m) => m.id === id)
  if (kind === 'deepseek') return DEEPSEEK.find((m) => m.id === id)
  if (kind === 'ark') return ARK.find((m) => m.id === id)
  return undefined
}

// ───────── 计价 ─────────
export function chatCost(kind: string, m: Model | undefined, tin: number, tout: number, t = now()) {
  if (!m) return 0
  const p: any = m.price
  if (p.unit === 'call') return p.per || 0
  if (p.unit !== 'mtok') return 0
  let i = p.in || 0, o = p.out || 0
  if (p.tiers) { const tier = p.tiers.find((x: any) => tin <= x.upto) || p.tiers[p.tiers.length - 1]; i = tier.in; o = tier.out }
  if (p.idle && !dsPeak(t)) { i = p.idle.in; o = p.idle.out }
  return +((tin * i + tout * o) / 1e6).toFixed(5)
}
export function imageCost(m: Model | undefined, size?: string, n = 1) {
  if (!m) return 0
  const p: any = m.price
  if (p.unit === 'call') return +((p.per || 0) * n).toFixed(3)
  if (p.unit !== 'image') return 0
  if (p.per_px && size && /^\d+x\d+$/.test(size)) { const [w, h] = size.split('x').map(Number); return +((w * h <= p.per_px.limit ? p.per_px.lo : p.per_px.hi) * n).toFixed(3) }
  return +((p.per || 0) * n).toFixed(3)
}
export function videoCost(m: Model | undefined, u: { vtok?: number; sec?: number; res?: string; quota?: number; withVideo?: boolean }, t = now()) {
  if (!m) return 0
  const p: any = m.price
  if (u.quota) return thQuotaCny(u.quota)
  if (p.unit === 'vtok') {
    const res = (u.res || '720p').toLowerCase()
    let rate = u.withVideo && p.with_video ? p.with_video : p.per_res?.[res] ?? p.per_res?.['720p'] ?? 46
    if (p.promo && t < Date.parse(p.promo.until)) rate *= p.promo.factor
    const tok = u.vtok || (u.sec ? Sl.vtokPerSec(res) * u.sec : 0)
    return +(tok * rate / 1e6).toFixed(3)
  }
  if (p.unit === 'sec') return +((u.sec || 0) * (p.per_res?.[(u.res || '720p').toLowerCase()] ?? p.per ?? 0)).toFixed(3)
  if (p.unit === 'call') return p.per || 0
  return 0
}
export function perSec(m: Model | undefined, res = '720p') {
  if (!m) return null
  const p: any = m.price
  if (p.unit === 'vtok') return +(videoCost(m, { sec: 1, res })).toFixed(3)
  if (p.unit === 'sec') return p.per_res?.[res.toLowerCase()] ?? p.per ?? null
  if (p.unit === 'quota' && m.cat === 'video') { const ref = ARK.find((x) => x.id === (/2[-.]5/.test(m.id) ? 'doubao-seedance-2-5-260628' : /mini/.test(m.id) ? 'doubao-seedance-2-0-mini-260615' : /fast/.test(m.id) ? 'doubao-seedance-2-0-fast-260128' : 'doubao-seedance-2-0-260128')); return ref ? perSec(ref, res) : null } // 动态计费：用官方同档价做预算参考
  return null
}

// ───────── 推荐预设（只覆盖该平台能做的 Agent）─────────
export const PRESETS: Record<Kind, Record<string, { model: string; params?: any }>> = {
  suanli: {},
  tokenhot: {
    SCREENWRITER: { model: 'deepseek-v4-pro', params: { temperature: 0.9, max_tokens: 16384 } }, STRUCTURE: { model: 'deepseek-v4-pro', params: { temperature: 0.7, max_tokens: 16384 } }, REVIEWER: { model: 'deepseek-v4-pro', params: { temperature: 0.3, max_tokens: 8192 } },
    SCRIPT: { model: 'deepseek-v4.1-flash', params: { temperature: 0.85, max_tokens: 16384 } }, PROMPT: { model: 'deepseek-v4.1-flash', params: { temperature: 0.6, max_tokens: 8192 } }, CONTINUITY: { model: 'deepseek-v4.1-flash', params: { temperature: 0.2, max_tokens: 8192 } },
    COMPLIANCE: { model: 'deepseek-v4.1-flash', params: { temperature: 0.1, max_tokens: 4096 } }, CONSISTENCY: { model: 'deepseek-v4.1-flash', params: { temperature: 0.1, max_tokens: 2048 } },
    ASSET: { model: 'nano-banana-pro', params: { image_size: '2K', ratio_portrait: '3:4', ratio_landscape: '16:9' } },
    VIDEO_MAIN: { model: 'doubao-seedance-2-0', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } },
    VIDEO_BRANCH: { model: 'doubao-seedance-2-0', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } }
  },
  deepseek: {
    SCREENWRITER: { model: 'deepseek-v4-pro', params: { max_tokens: 16384 } }, STRUCTURE: { model: 'deepseek-v4-pro', params: { max_tokens: 16384 } }, REVIEWER: { model: 'deepseek-v4-pro', params: { reasoning_effort: 'high', max_tokens: 8192 } },
    SCRIPT: { model: 'deepseek-flash', params: { thinking: 'disabled', temperature: 0.85, max_tokens: 16384 } }, PROMPT: { model: 'deepseek-flash', params: { thinking: 'disabled', temperature: 0.6, max_tokens: 8192 } },
    CONTINUITY: { model: 'deepseek-flash', params: { max_tokens: 8192 } }, COMPLIANCE: { model: 'deepseek-flash', params: { thinking: 'disabled', temperature: 0.1, max_tokens: 4096 } }, CONSISTENCY: { model: 'deepseek-flash', params: { thinking: 'disabled', temperature: 0.1, max_tokens: 2048 } }
  },
  ark: {
    SCREENWRITER: { model: 'doubao-seed-2-1-pro-260915', params: { temperature: 0.9, max_tokens: 16384 } }, STRUCTURE: { model: 'doubao-seed-2-1-pro-260915', params: { temperature: 0.7, max_tokens: 16384 } }, REVIEWER: { model: 'doubao-seed-2-1-pro-260915', params: { temperature: 0.3, max_tokens: 8192 } },
    SCRIPT: { model: 'doubao-seed-2-1-lite-260915', params: { thinking: 'disabled', temperature: 0.85, max_tokens: 16384 } }, PROMPT: { model: 'doubao-seed-2-1-lite-260915', params: { thinking: 'disabled', temperature: 0.6, max_tokens: 8192 } },
    CONTINUITY: { model: 'doubao-seed-2-1-lite-260915', params: { temperature: 0.2, max_tokens: 8192 } }, COMPLIANCE: { model: 'doubao-seed-2-0-mini-260428', params: { thinking: 'disabled', temperature: 0.1, max_tokens: 4096 } }, CONSISTENCY: { model: 'doubao-seed-2-1-lite-260915', params: { thinking: 'disabled', temperature: 0.1, max_tokens: 2048 } },
    ASSET: { model: 'doubao-seedream-5-0-260128', params: { size_portrait: '1536x2048', size_landscape: '2048x1152' } },
    VIDEO_MAIN: { model: 'doubao-seedance-2-0-260128', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } },
    VIDEO_BRANCH: { model: 'doubao-seedance-2-0-260128', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false } }
  }
}

// ───────── 目录（给前端）─────────
export async function catalog(env: Env, kind: Kind, pv?: { base: string; key: string; extra?: any } | null, force = false) {
  if (kind === 'suanli') return { platform: kind, meta: PLATFORMS[kind], ...(await Sl.catalog(env, pv, force)) }
  const { list, note, at } = await modelsOf(env, kind, pv, force)
  let available: string[] | null = null, keyNote = ''
  if (pv?.key && kind !== 'ark') {
    try { const r = await fetch(root(kind, pv.base) + (kind === 'deepseek' ? '/models' : '/v1/models'), { headers: { Authorization: 'Bearer ' + pv.key } }); const d: any = await r.json().catch(() => ({})); if (r.ok) available = (d.data || []).map((m: any) => m.id); else keyNote = d.error?.message?.slice(0, 80) || `HTTP ${r.status}` } catch (e: any) { keyNote = String(e?.message || e).slice(0, 60) }
  }
  const models = list.map((m) => ({ ...m, available: available ? available.includes(m.id) : null, per_sec_720p: m.cat === 'video' ? perSec(m, (m.params.find((p) => p.k === 'resolution')?.def as string) || '720p') : undefined, fit: Object.fromEntries(Object.keys(Sl.NEEDS).map((c) => [c, Sl.fitFor(c, m)])) }))
  const pick = PRESETS[kind]
  const agents = Object.fromEntries(Object.entries(Sl.NEEDS).map(([c, n]) => [c, { ...n, pick: pick[c] ? [pick[c].model, ...n.pick] : n.pick, options: models.filter((m) => !m.fit[c]).map((m) => m.id) }]))
  return { platform: kind, meta: PLATFORMS[kind], models, agents, cats: Sl.CAT_NAME, sync: { ok: at > 0, at, added: [], note }, key: { checked: !!pv?.key && kind !== 'ark', ok: !!available, note: kind === 'ark' ? '火山方舟 API Key 无模型列表接口，以连通测试为准' : keyNote, count: available?.length ?? null }, docs: PLATFORMS[kind].docs }
}
/** 平台根地址：tokenhot / suanli 用根域名 + /v1/...；deepseek 根域名；ark 已含 /api/v3 */
export function root(kind: string, base: string) {
  const b = String(base || '').replace(/\/+$/, '')
  if (kind === 'ark') return b
  return b.replace(/\/v1$/, '')
}
