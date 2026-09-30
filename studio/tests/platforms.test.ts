// 多平台目录 / 计价 / 请求体单测（TokenHot 用 2026-09-30 真实价格表快照；DeepSeek / 火山方舟按官方文档）
import { readFileSync } from 'node:fs'
import * as Pf from '../src/lib/platforms'
import * as Ad from '../src/lib/adapters'
import * as Sl from '../src/lib/suanli'
let pass = 0, fail = 0; const ok = (n: string, c: any, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
const snap = readFileSync(new URL('./fixtures/tokenhot_pricing.json', import.meta.url), 'utf8')
const realFetch = globalThis.fetch
let sent: any[] = []
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u)
  if (url.endsWith('/api/pricing')) return new Response(snap, { headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/api/status')) return new Response(JSON.stringify({ data: { price: 7, quota_per_unit: 500000 } }))
  sent.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization })
  return new Response(JSON.stringify({ id: 'task_x', task_id: 'task_x', status: 'queued', data: [{ url: 'https://x/y.png' }] }))
}) as any
const env: any = {}
;(async () => {
  const th = await Pf.tokenhotModels(env, null, true)
  const byId = Object.fromEntries(th.list.map((m) => [m.id, m]))
  ok('TokenHot：价格表 96 个模型全部归类', th.raw === 96 && th.list.length === 96, `${th.list.length}/${th.raw}`)
  const cnt = (c: string) => th.list.filter((m) => m.cat === c && m.proto !== 'unsupported').length
  ok('TokenHot：四类都有可用模型', cnt('chat') + cnt('vision') >= 45 && cnt('vision') > 10 && cnt('image') >= 8 && cnt('video') >= 20, JSON.stringify({ chat: cnt('chat'), vision: cnt('vision'), image: cnt('image'), video: cnt('video') }))
  ok('Seedance 2.0 → content[] 协议 + 首帧/尾帧/参考图角色', byId['doubao-seedance-2-0'].proto === 'th_seedance' && byId['doubao-seedance-2-0'].roles!.includes('last_frame'))
  ok('Seedance 2.0 fast/mini 只有 480p/720p；2.5 时长 ≤30', (byId['doubao-seedance-2-0-mini'].params.find((p) => p.k === 'resolution')!.options as string[]).join() === '480p,720p' && byId['doubao-seedance-2-5'].params.find((p) => p.k === 'duration')!.max === 30)
  ok('Kling / Veo / Wan3 / HappyHorse / Grok / Omni 各自协议', ['kling-v3:th_kling', 'veo3.1:th_veo', 'wan3.0-video:th_wan3', 'happyhorse-1.1-i2v:th_happyhorse', 'grok-imagine-video-1-5-preview:th_grok', 'gemini-omni-video:th_omni'].every((x) => { const [id, p] = x.split(':'); return byId[id]?.proto === p }))
  ok('HappyHorse t2v 不能锁人物 → 主线拒绝；i2v 可做分支首帧', !!Sl.fitFor('VIDEO_MAIN', byId['happyhorse-1.1-t2v']) && !Sl.fitFor('VIDEO_BRANCH', byId['happyhorse-1.1-i2v']) && !!Sl.fitFor('VIDEO_MAIN', byId['happyhorse-1.1-i2v']))
  ok('视频编辑 / TTS / 向量模型标为不支持', byId['happyhorse-1.0-video-edit'].proto === 'unsupported' && byId['mimo-v2.5-tts'].proto === 'unsupported' && byId['jina-embeddings-v4'].proto === 'unsupported')
  ok('按次计费图片：gpt-image-2 $0.028 → ¥0.196', byId['gpt-image-2'].price.unit === 'call' && byId['gpt-image-2'].price.per === 0.196)
  ok('Nano Banana → Gemini 原生图片协议', byId['nano-banana-pro'].proto === 'th_gemini_image')
  ok('对话倍率换算：deepseek-v4.1-flash 0.15×2×7 = ¥2.1 入 / ¥8.4 出', byId['deepseek-v4.1-flash'].price.in === 2.1 && byId['deepseek-v4.1-flash'].price.out === 8.4)
  ok('倍率 37.5（动态）模型标为按任务实扣', byId['doubao-seedance-2-0'].price.unit === 'quota' && /实扣/.test(byId['doubao-seedance-2-0'].price.note))
  ok('免费模型标注限流', /免费/.test(byId['minimax-m3-free'].price.note))
  ok('TokenHot 推荐预设全部通过 Agent 适配校验', Object.entries(Pf.PRESETS.tokenhot).every(([c, p]) => !Sl.fitFor(c, byId[p.model])), JSON.stringify(Object.entries(Pf.PRESETS.tokenhot).filter(([c, p]) => Sl.fitFor(c, byId[p.model])).map(([c, p]) => [c, Sl.fitFor(c, byId[p.model])])))
  ok('TokenHot 额度换算：quota 500000 = $1 = ¥7', Pf.thQuotaCny(500000) === 7)
  // DeepSeek 官方
  const ds = Object.fromEntries(Pf.DEEPSEEK.map((m) => [m.id, m]))
  ok('DeepSeek：官方模型名 deepseek-v4-pro / deepseek-flash', !!ds['deepseek-v4-pro'] && !!ds['deepseek-flash'])
  ok('DeepSeek：Flash 可看图 → 能做一致性质检；Pro 不能', !Sl.fitFor('CONSISTENCY', ds['deepseek-flash']) && !!Sl.fitFor('CONSISTENCY', ds['deepseek-v4-pro']))
  const peak = Date.parse('2026-09-30T10:00:00+08:00'), idle = Date.parse('2026-10-03T10:00:00+08:00')
  ok('DeepSeek 峰谷：周三 10 点高峰 / 周六空闲', Pf.dsPeak(peak) && !Pf.dsPeak(idle))
  ok('DeepSeek 计价：Pro 1M 入 + 1M 出 高峰 ¥36 / 空闲 ¥18', Pf.chatCost('deepseek', ds['deepseek-v4-pro'], 1e6, 1e6, peak) === 36 && Pf.chatCost('deepseek', ds['deepseek-v4-pro'], 1e6, 1e6, idle) === 18)
  const b1 = Ad.chatBody({ kind: 'deepseek', base: '', key: '', extra: {} }, 'deepseek-v4-pro', [], { temperature: 0.9, max_tokens: 100 }, true)
  const b2 = Ad.chatBody({ kind: 'deepseek', base: '', key: '', extra: {} }, 'deepseek-flash', [], { thinking: 'disabled', temperature: 0.9 }, false)
  ok('DeepSeek 思考模式下不发 temperature；关闭思考才发', b1.temperature === undefined && b1.response_format?.type === 'json_object' && b2.thinking.type === 'disabled' && b2.temperature === 0.9)
  ok('DeepSeek 预设全部通过适配校验', Object.entries(Pf.PRESETS.deepseek).every(([c, p]) => !Sl.fitFor(c, ds[p.model])))
  // 火山方舟
  const ark = Object.fromEntries(Pf.ARK.map((m) => [m.id, m]))
  ok('方舟：Seedance 2.5 / 2.0 / fast / mini 官方 Model ID', ['doubao-seedance-2-5-260628', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615'].every((i) => ark[i]?.proto === 'ark_seedance'))
  const t0 = Date.parse('2026-11-01T00:00:00+08:00')
  ok('方舟官方价：2.0 720p 5 秒 ≈ ¥4.97（官方表 4.97）', Math.abs(Pf.videoCost(ark['doubao-seedance-2-0-260128'], { sec: 5, res: '720p' }, t0) - 4.97) < 0.01, String(Pf.videoCost(ark['doubao-seedance-2-0-260128'], { sec: 5, res: '720p' }, t0)))
  ok('方舟官方价：2.0 480p 5 秒 ≈ ¥2.31；2.5 720p ≈ ¥7.56', Math.abs(Pf.videoCost(ark['doubao-seedance-2-0-260128'], { sec: 5, res: '480p' }, t0) - 2.31) < 0.02 && Math.abs(Pf.videoCost(ark['doubao-seedance-2-5-260628'], { sec: 5, res: '720p' }, t0) - 7.56) < 0.01)
  ok('方舟限时折扣：mini 活动期 4 折、结束后原价', Pf.videoCost(ark['doubao-seedance-2-0-mini-260615'], { sec: 5, res: '720p' }, Date.parse('2026-09-30T12:00:00+08:00')) < Pf.videoCost(ark['doubao-seedance-2-0-mini-260615'], { sec: 5, res: '720p' }, t0) * 0.41)
  ok('方舟按上游 usage 计费：109586 token × ¥46/M ≈ ¥5.04', Pf.videoCost(ark['doubao-seedance-2-0-260128'], { vtok: 109586, res: '720p' }, t0) === 5.041)
  ok('Seedream 5.0 Pro 按像素分档：1200x1600 ¥0.3 / 1536x2048 ¥0.6', Pf.imageCost(ark['doubao-seedream-5-0-pro-260628'], '1200x1600') === 0.3 && Pf.imageCost(ark['doubao-seedream-5-0-pro-260628'], '1536x2048') === 0.6)
  ok('Seed 2.0 Lite 阶梯价：>32K 输入改用 ¥0.9', Pf.chatCost('ark', ark['doubao-seed-2-0-lite-260428'], 50000, 0) === 0.045)
  ok('方舟预设全部通过适配校验', Object.entries(Pf.PRESETS.ark).every(([c, p]) => !Sl.fitFor(c, ark[p.model])))
  ok('即将下线模型已标注', ark['doubao-seed-2-0-pro-260215'].deprecated === true)
  // 请求体
  const pvA = { kind: 'ark', base: 'https://ark.cn-beijing.volces.com/api/v3', key: 'k', extra: {} }
  sent = []; await Ad.videoSubmit(pvA, ark['doubao-seedance-2-0-260128'], 'doubao-seedance-2-0-260128', { prompt: 'P', first_frame: null, refs: ['https://a/1.png', 'https://a/2.png'], cast: ['林默', '庄家'], ratio: '9:16', duration: 8, resolution: '720p', audio: true, watermark: false, seed: 7 })
  let b = sent[0].body
  ok('方舟视频：POST /api/v3/contents/generations/tasks + content[] + reference_image', sent[0].url.endsWith('/api/v3/contents/generations/tasks') && b.content[0].type === 'text' && b.content.filter((c: any) => c.role === 'reference_image').length === 2 && /图片1为林默/.test(b.content[0].text))
  ok('方舟视频：return_last_frame + seed + generate_audio', b.return_last_frame === true && b.seed === 7 && b.generate_audio === true && b.ratio === '9:16')
  sent = []; await Ad.videoSubmit(pvA, ark['doubao-seedance-2-5-260628'], 'doubao-seedance-2-5-260628', { prompt: 'P', first_frame: 'https://a/last.png', refs: [], cast: [], ratio: '9:16', duration: 40, resolution: '1080p', audio: true, watermark: false })
  b = sent[0].body
  ok('2.5 首帧任务：ratio 自动改 adaptive、时长夹到 30', b.ratio === 'adaptive' && b.duration === 30 && b.content[1].role === 'first_frame')
  const pvT = { kind: 'tokenhot', base: 'https://api.tokenhot.cn', key: 'k', extra: {} }
  sent = []; await Ad.videoSubmit(pvT, byId['doubao-seedance-2-0-mini'], 'doubao-seedance-2-0-mini', { prompt: 'P', first_frame: null, refs: ['https://a/1.png'], cast: ['A'], ratio: '9:16', duration: 8, resolution: '1080p', audio: true, watermark: false })
  b = sent[0].body
  ok('TokenHot Seedance mini：1080p 自动降到 720p；POST /v1/video/generations', sent[0].url === 'https://api.tokenhot.cn/v1/video/generations' && b.resolution === '720p' && b.content[1].role === 'reference_image')
  sent = []; await Ad.videoSubmit(pvT, byId['kling-v3'], 'kling-v3', { prompt: '走进雨夜', first_frame: 'https://a/f.png', refs: [], cast: [], ratio: '9:16', duration: 8, resolution: '720p', audio: true, watermark: false })
  b = sent[0].body
  ok('Kling：file_infos[FirstFrame] + <<<image_1>>> + size/aspect_ratio', b.file_infos[0].Usage === 'FirstFrame' && b.prompt.startsWith('<<<image_1>>>') && b.size === '720P' && b.aspect_ratio === '9:16')
  sent = []; await Ad.videoSubmit(pvT, byId['veo3.1'], 'veo3.1', { prompt: 'P', first_frame: null, refs: ['https://a/1.png'], cast: ['A'], ratio: '9:16', duration: 5, resolution: '720p', audio: true, watermark: false })
  b = sent[0].body
  ok('Veo：参考图模式 REFERENCE_2_VIDEO 强制 8 秒', b.generationType === 'REFERENCE_2_VIDEO' && b.duration === 8 && b.imageUrls.length === 1)
  sent = []; await Ad.videoSubmit(pvT, byId['wan3.0-video'], 'wan3.0-video', { prompt: 'P', first_frame: 'https://a/f.png', refs: [], cast: [], ratio: '9:16', duration: 8, resolution: '720p', audio: true, watermark: false })
  b = sent[0].body
  ok('Wan 3.0：input.media first_frame + parameters（720P 大写）', b.input.media[0].type === 'first_frame' && b.parameters.resolution === '720P' && b.parameters.ratio === 'adaptive')
  sent = []; await Ad.image(pvT, byId['nano-banana-pro'], 'nano-banana-pro', 'cat', true, { image_size: '2K' }).catch(() => null)
  ok('Nano Banana：/v1beta/models/{model}:generateContent + imageConfig', /\/v1beta\/models\/nano-banana-pro:generateContent$/.test(sent[0].url) && sent[0].body.generationConfig.imageConfig.aspectRatio === '3:4')
  sent = []; await Ad.image(pvA, ark['doubao-seedream-5-0-260128'], 'doubao-seedream-5-0-260128', 'cat', false, {})
  ok('方舟 Seedream：/api/v3/images/generations + watermark=false', sent[0].url.endsWith('/api/v3/images/generations') && sent[0].body.watermark === false && sent[0].body.size === '2048x1152')
  globalThis.fetch = realFetch
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
