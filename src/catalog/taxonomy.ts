// 专业分类体系：形态 format × 题材 genre × 受众 audience × 分级 rating
// 形态决定生成管线（画风 / 设定图 / 封面提示词），题材决定剧本类型，受众与分级决定分发
import CATALOG from './data.json'

export type Format = 'anime' | 'live' | 'abstract'
export const FORMATS = (CATALOG as any).cats as { id: Format; name: string; icon: string; color: string; desc: string }[]
export const GENRES = (CATALOG as any).genres as { id: string; name: string; icon: string }[]

/** 兼容旧数据：love → 漫剧，film → 真人剧 */
export const fmt = (c?: string): Format => (c === 'love' || c === 'anime' ? 'anime' : c === 'abstract' ? 'abstract' : 'live')
export const fmtName = (c?: string) => FORMATS.find((f) => f.id === fmt(c))?.name || '真人剧'
export const genreName = (g?: string) => GENRES.find((x) => x.id === g)?.name || ''

/** 每种形态的视频画风（Seedance 提示词） */
export const STYLE: Record<Format, string> = {
  anime: 'luminous high-end Japanese / Chinese anime feature film, cinematic cel-shaded animation, soft pastel palette, glowing light, bloom, vertical framing',
  live: 'photorealistic live-action East Asian cinematic drama, high-end color grading, shallow depth of field, moody practical lighting, vertical framing',
  abstract: 'surreal absurdist experimental animation, bold saturated pop colors, whimsical uncanny visual metaphors, mixed media (claymation, glitch, dreamcore), playful camera, vertical framing'
}
export const SHEET_STYLE: Record<Format, string> = {
  anime: 'premium Japanese anime style',
  live: 'photorealistic cinematic portrait photography',
  abstract: 'stylized surreal pop-art character design, claymation / 3D toy look'
}
export const COVER_STYLE: Record<Format, string> = {
  anime: 'Premium anime key art, romantic tension, Makoto Shinkai lighting',
  live: 'Photorealistic East Asian actors, cinematic, sultry but tasteful',
  abstract: 'Surreal absurdist pop-art key visual, bold colors, witty visual metaphor'
}
/** 编剧提示：形态 + 题材 */
export const brief = (c?: string, g?: string) => {
  const f = fmt(c)
  const base = { anime: '漫剧（AI 动画，日漫/国漫画风，人设鲜明，情绪饱满）', live: '真人剧（AI 真人电影质感竖屏短剧，强冲突、强反转）', abstract: '抽象剧（超现实/无厘头/梦核，荒诞设定一本正经地演，梗密集、适合二创传播）' }[f]
  return `${base}${g ? `；题材：${genreName(g)}` : ''}；玩家对每个抉择押注`
}
/** 按标签/主题自动推断题材（导演台未指定时） */
export function guessGenre(text: string, f: Format): string {
  const R: [string, RegExp][] = [
    ['absurd', /无厘头|整活|离谱|沙雕|猫|NPC|弹幕|售货机/], ['surreal', /梦核|怪核|超现实|平行|梦/],
    ['costume', /古风|仙侠|修仙|宫|王朝|狐|师尊/], ['revenge', /复仇|逆袭|重生|夺舍|打脸/],
    ['suspense', /悬疑|惊悚|凶|密室|灵异|诡|失踪/], ['action', /杀手|特工|动作|赌|枪|犯罪|系统|觉醒/],
    ['survival', /末日|生存|荒岛|丧尸/], ['fantasy', /奇幻|科幻|AI|吸血|人鱼|异世界|魔/],
    ['urban', /总裁|豪门|霸总|商战|都市|秘书|职场/], ['romance', /恋|爱|婚|心动|甜|暧昧|前任/]
  ]
  for (const [g, re] of R) if (re.test(text)) return g
  return f === 'abstract' ? 'absurd' : 'romance'
}
