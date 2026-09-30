// 协议适配器：TokenHot / DeepSeek 官方 / 火山方舟官方 —— 对话、图片、视频提交与轮询
// 每个模型的请求体严格按对应文档构造（字段名大小写、枚举、素材角色），见 platforms.ts 的资料来源
import * as Pf from './platforms'
import type { Model } from './suanli'

type PV = { kind: string; base: string; key: string; extra: any }
const H = (pv: PV) => ({ Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' })
const R = (pv: PV) => Pf.root(pv.kind, pv.base || Pf.PLATFORMS[pv.kind as Pf.Kind]?.base)
const nn = (v: any) => v !== undefined && v !== '' && v !== null
export const errMsg = (d: any, status: number) => String(d?.error?.message || d?.message || d?.error?.code || (typeof d?.error === 'string' ? d.error : '') || `HTTP ${status}`).slice(0, 300)

// ═════════ 对话 ═════════
/** 组装平台对话请求：DeepSeek 思考模式 / 方舟 thinking / TokenHot OpenAI 兼容；只发文档支持的参数 */
export function chatBody(pv: PV, model: string, messages: any[], params: any, json: boolean) {
  const p = params || {}, body: any = { model, messages }
  const think = p.thinking
  if (pv.kind === 'deepseek' || pv.kind === 'ark') {
    if (think) body.thinking = { type: think }
    if (nn(p.reasoning_effort)) body.reasoning_effort = p.reasoning_effort
  } else if (nn(p.reasoning_effort)) body.reasoning_effort = p.reasoning_effort
  const thinkingOn = (pv.kind === 'deepseek' && think !== 'disabled')
  if (nn(p.temperature) && !thinkingOn) body.temperature = +p.temperature // DeepSeek 思考模式下 temperature 不生效，不发
  if (nn(p.top_p)) body.top_p = +p.top_p
  const mt = p.max_tokens ?? p.max_completion_tokens; if (nn(mt)) body.max_tokens = +mt
  if (nn(p.seed) && pv.kind === 'tokenhot') body.seed = +p.seed
  if (nn(p.presence_penalty) && !thinkingOn) body.presence_penalty = +p.presence_penalty
  if (nn(p.frequency_penalty) && !thinkingOn) body.frequency_penalty = +p.frequency_penalty
  if (json) body.response_format = { type: 'json_object' }
  return body
}
export const chatEndpoint = (pv: PV) => pv.kind === 'deepseek' ? R(pv) + '/chat/completions' : pv.kind === 'ark' ? R(pv) + '/chat/completions' : R(pv) + '/v1/chat/completions'

// ═════════ 图片 ═════════
export type ImgOut = { url?: string; b64?: string; size?: string; n: number }
/** 同步出图的单次上限：nano-banana-pro 2K 常 1–3 分钟；超时即失败，由自动重试接手 */
export const IMG_TIMEOUT = 240000
export async function image(pv: PV, m: Model | undefined, model: string, prompt: string, portrait: boolean, P: any): Promise<ImgOut> {
  const proto = m?.proto || (pv.kind === 'ark' ? 'ark_image' : 'th_images')
  if (proto === 'th_gemini_image') {
    const r = await fetch(R(pv) + `/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: H(pv), signal: AbortSignal.timeout(IMG_TIMEOUT), body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: portrait ? (P.ratio_portrait || '3:4') : (P.ratio_landscape || '16:9'), imageSize: P.image_size || '2K' } } }) })
    const d: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status}: ${errMsg(d, r.status)}`)
    const parts = d.candidates?.[0]?.content?.parts || []
    const inline = parts.find((x: any) => x.inlineData?.data || x.inline_data?.data), txt = parts.map((x: any) => x.text || '').join(' ')
    const url = (txt.match(/https?:\/\/[^\s)"']+/) || [])[0]
    if (inline) return { b64: (inline.inlineData || inline.inline_data).data, n: 1 }
    if (!url) throw new Error('未返回图片：' + txt.slice(0, 120))
    return { url, n: 1 }
  }
  if (proto === 'th_qwen_image') {
    const size = portrait ? (P.size_portrait || '1104*1472') : (P.size_landscape || '1664*928')
    const r = await fetch(R(pv) + '/v1/images/generations', { method: 'POST', headers: H(pv), signal: AbortSignal.timeout(IMG_TIMEOUT), body: JSON.stringify({ model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { size, n: 1, watermark: false, prompt_extend: P.prompt_extend !== false, negative_prompt: '低分辨率，低画质，肢体畸形，文字，水印' } }) })
    const d: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status}: ${errMsg(d, r.status)}`)
    const url = d.output?.[0]?.content?.find((c: any) => c.type === 'image')?.text || d.output?.choices?.[0]?.message?.content?.[0]?.image || d.data?.[0]?.url
    if (!url) throw new Error('未返回图片'); return { url, size, n: 1 }
  }
  // OpenAI 图片协议（TokenHot Seedream / GPT Image）与方舟 Seedream（/api/v3/images/generations）
  const size = portrait ? (P.size_portrait || '1536x2048') : (P.size_landscape || '2048x1152')
  const body: any = { model, prompt, size, n: 1, response_format: 'url' }
  if (proto === 'ark_image' || /seedream/.test(model)) { body.watermark = false; body.sequential_image_generation = 'disabled' }
  if (/gpt-image/.test(model) && P.quality) body.quality = P.quality
  const r = await fetch((pv.kind === 'ark' ? R(pv) + '/images/generations' : R(pv) + '/v1/images/generations'), { method: 'POST', headers: H(pv), signal: AbortSignal.timeout(IMG_TIMEOUT), body: JSON.stringify(body) })
  const d: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status}: ${errMsg(d, r.status)}`)
  const x = d.data?.[0]; if (!x?.url && !x?.b64_json) throw new Error('未返回图片：' + JSON.stringify(d).slice(0, 160))
  return { url: x.url, b64: x.b64_json, size: x.size || size, n: d.usage?.generated_images || 1 }
}

// ═════════ 视频提交 ═════════
export type VideoReq = { prompt: string; first_frame?: string | null; refs: string[]; cast: string[]; ratio: string; duration: number; resolution: string; audio: boolean; watermark: boolean; seed?: number; last_frame?: boolean }
/** 返回 { task, sent }；sent 记录实际发送的时长 / 分辨率（用于计价） */
export async function videoSubmit(pv: PV, m: Model | undefined, model: string, q: VideoReq) {
  const proto = m?.proto || (pv.kind === 'ark' ? 'ark_seedance' : 'th_seedance')
  const refNote = !q.first_frame && q.refs.length ? ' ' + q.refs.map((_, i) => `图片${i + 1}为${q.cast[i] || '角色'}的设定图`).join('，') + '，人物外貌与之保持一致。' : ''
  const is25 = /2[-.]5/.test(model)
  let body: any, path = R(pv) + '/v1/video/generations', res = q.resolution, ratio = q.ratio, dur = q.duration
  if (proto === 'th_seedance' || proto === 'ark_seedance') {
    const lim = m?.params.find((p) => p.k === 'resolution')?.options as string[] | undefined
    if (lim && !lim.includes(res)) res = lim.includes('720p') ? '720p' : String(lim[lim.length - 1])
    dur = Math.max(4, Math.min(is25 ? 30 : 15, dur))
    if (q.first_frame && is25) ratio = 'adaptive' // 2.5 首帧任务只支持 adaptive（官方限制）
    const content: any[] = [{ type: 'text', text: q.prompt + refNote }]
    if (q.first_frame) content.push({ type: 'image_url', image_url: { url: q.first_frame }, role: 'first_frame' })
    else for (const u of q.refs.slice(0, is25 ? 30 : 9)) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' })
    body = { model, content, ratio, duration: dur, resolution: res, watermark: q.watermark, generate_audio: q.audio }
    if (proto === 'ark_seedance') { path = R(pv) + '/contents/generations/tasks'; body.return_last_frame = true; if (nn(q.seed)) body.seed = q.seed }
  } else if (proto === 'th_kling') {
    const file_infos = q.first_frame ? [{ Type: 'Url', Category: 'Image', Url: q.first_frame, Usage: 'FirstFrame' }] : []
    body = { model, prompt: (q.first_frame ? '<<<image_1>>> ' : '') + q.prompt, duration: Math.max(3, Math.min(15, dur)), size: String(res).toUpperCase().replace(/^(\d+)P$/, '$1P'), aspect_ratio: ['9:16', '16:9', '1:1'].includes(ratio) ? ratio : '9:16', audio_generation: q.audio, ...(file_infos.length ? { file_infos } : {}), negative_prompt: 'text, subtitles, watermark, deformed hands' }
  } else if (proto === 'th_veo') {
    const imgs = q.first_frame ? [q.first_frame] : q.refs.slice(0, 3)
    const gt = q.first_frame ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : imgs.length ? 'REFERENCE_2_VIDEO' : 'TEXT_2_VIDEO'
    dur = gt === 'REFERENCE_2_VIDEO' ? 8 : [4, 6, 8].includes(dur) ? dur : 8
    body = { model, prompt: q.prompt + refNote, aspect_ratio: ['9:16', '16:9'].includes(ratio) ? ratio : 'Auto', resolution: String(res).toLowerCase(), duration: dur, generationType: gt, enableTranslation: true, ...(imgs.length ? { imageUrls: imgs } : {}) }
  } else if (proto === 'th_wan3') {
    const media = q.first_frame ? [{ type: 'first_frame', url: q.first_frame }] : q.refs.slice(0, 9).map((u) => ({ type: 'reference_image', url: u }))
    const wnote = !q.first_frame && q.refs.length ? ' ' + q.refs.map((_, i) => `图${i + 1}为${q.cast[i] || '角色'}的设定图`).join('，') + '，人物外貌保持一致。' : ''
    body = { model, input: { prompt: q.prompt + wnote, ...(media.length ? { media } : {}) }, parameters: { resolution: String(res).toUpperCase(), ratio: q.first_frame ? 'adaptive' : ratio, duration: Math.max(2, Math.min(30, dur)), audio: q.audio, watermark: q.watermark, prompt_extend: false, ...(nn(q.seed) ? { seed: q.seed } : {}) } }
  } else if (proto === 'th_happyhorse') {
    const r2v = /r2v/.test(model), i2v = /i2v/.test(model)
    if (i2v && !q.first_frame) throw new Error(`${model} 只支持首帧图生视频`)
    const media = i2v ? [{ type: 'first_frame', url: q.first_frame }] : r2v ? q.refs.slice(0, 9).map((u) => ({ type: 'reference_image', url: u })) : []
    const hnote = r2v && q.refs.length ? ' ' + q.refs.map((_, i) => `character${i + 1}为${q.cast[i] || '角色'}`).join('，') : ''
    body = { model, input: { prompt: q.prompt + hnote, ...(media.length ? { media } : {}) }, parameters: { resolution: String(res).toUpperCase(), ...(i2v ? {} : { ratio }), duration: Math.max(3, Math.min(15, dur)), watermark: q.watermark, ...(nn(q.seed) ? { seed: q.seed } : {}) } }
  } else if (proto === 'th_grok') {
    const img = q.first_frame || q.refs[0]; if (!img) throw new Error(`${model} 是图生视频模型，需要首帧或参考图`)
    body = { model, input: { image_urls: [img], prompt: q.prompt, aspect_ratio: ratio, resolution: String(res).toLowerCase(), duration: Math.max(1, Math.min(15, dur)), nsfw_checker: false } }
  } else if (proto === 'th_omni') {
    const d = [4, 6, 8, 10].reduce((a, b) => Math.abs(b - dur) < Math.abs(a - dur) ? b : a, 8)
    body = { model, input: { prompt: q.prompt + refNote, duration: String(d), aspect_ratio: ['9:16', '16:9'].includes(ratio) ? ratio : '9:16', resolution: String(res).toLowerCase(), ...(q.first_frame || q.refs.length ? { image_urls: (q.first_frame ? [q.first_frame] : q.refs).slice(0, 7) } : {}), ...(nn(q.seed) ? { seed: q.seed } : {}) } }
    dur = d
  } else throw new Error(`${model} 的视频协议未接入`)
  const r = await fetch(path, { method: 'POST', headers: H(pv), body: JSON.stringify(body) })
  const d: any = await r.json().catch(() => ({}))
  const task = d.id || d.task_id || d.data?.task_id || d.data?.id
  if (!r.ok || !task) throw new Error(`HTTP ${r.status}: ${errMsg(d, r.status)}`)
  return { task: String(task), sent: { ratio, duration: dur, resolution: res }, body }
}

// ═════════ 视频轮询 ═════════
/** 统一轮询结果：status succeeded/failed/running；video / last 地址；usage token；quota（TokenHot 实扣额度） */
export async function videoPoll(pv: PV, task: string) {
  const ark = pv.kind === 'ark'
  const r = await fetch(ark ? R(pv) + '/contents/generations/tasks/' + encodeURIComponent(task) : R(pv) + '/v1/video/generations/' + encodeURIComponent(task), { headers: { Authorization: 'Bearer ' + pv.key } })
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok) return { status: r.status === 404 ? 'failed' : 'running', err: r.status === 404 ? '任务不存在' : '', video: '', last: '', usage: 0, quota: 0, auth: false }
  if (ark) { // 方舟：status queued/running/succeeded/failed/expired/cancelled；content.video_url / last_frame_url；usage.completion_tokens
    const s = String(d.status || '').toLowerCase()
    return { status: s === 'succeeded' ? 'succeeded' : /fail|expire|cancel/.test(s) ? 'failed' : 'running', err: d.error ? `${d.error.code || ''} ${d.error.message || ''}`.trim() : s, video: d.content?.video_url || '', last: d.content?.last_frame_url || '', usage: d.usage?.completion_tokens || d.usage?.total_tokens || 0, quota: 0, auth: false }
  }
  // TokenHot（new-api 任务）：data.status NOT_START/SUBMITTED/QUEUED/IN_PROGRESS/SUCCESS/FAILURE；data.result_url；data.quota；data.data 为原厂返回
  const x = d.data || d, s = String(x.status || '').toUpperCase(), raw = x.data || {}
  const video = x.result_url || raw.content?.video_url || raw.video_url || raw.output?.video_url || raw.metadata?.url || ''
  const last = raw.content?.last_frame_url || ''
  const failed = /FAIL/.test(s) || /fail/.test(String(raw.status || ''))
  return { status: s === 'SUCCESS' ? 'succeeded' : failed ? 'failed' : 'running', err: x.fail_reason || raw.error?.message || '', video, last, usage: raw.usage?.completion_tokens || raw.usage?.total_tokens || 0, quota: +x.quota || 0, auth: video.startsWith(R(pv)) || /api\.tokenhot\.(cn|ai)/.test(video) }
}
