// 开心1分钟 · 三部恶搞博弈短片的「概率树 + 演出脚本」
// 每部剧 = 一棵公开概率的事件树（next(h) 给出下一步及各结果概率）+ 每个结果对应的真人片段与字幕
// 结果只由开局种子决定；押注单 / 快押 / 押主角的赔率都由整棵树精确枚举得出
export type Opt = { id: string; label: string; p: number }
export type Hist = { key: string; out: string }[]
export type Step = { key: string; title: string; q: string; opts: Opt[]; pre: string[]; cap: string }
export type Leg = { id: string; title: string; bins: { id: string; label: string }[]; of: (h: Hist) => string }
export type Game = {
  sid: string; title: string; tag: string; logline: string; color: string
  cast: { id: string; name: string; role: string }[]
  intro: { clip: string; cap: string }
  next: (h: Hist) => Step | null
  post: (h: Hist, out: string, fx: number) => { clips: string[]; cap: string }
  legs: Leg[]
  final: { title: string; opts: { id: string; label: string }[]; of: (h: Hist) => string }
  ending: (h: Hist) => { clip: string; cap: string }
  rules: string[]
}
const O = (id: string, label: string, p: number): Opt => ({ id, label, p })

// ───────────────────────── ① 老爸倒车 ─────────────────────────
const PARK_ROWS = [[0.2, 0.45, 0.25, 0.1], [0.3, 0.35, 0.2, 0.15], [0.4, 0.25, 0.15, 0.2], [0.5, 0.15, 0.1, 0.25]]
const tries = (h: Hist) => h.filter((x) => x.key.startsWith('try')).length
const parkWho = (h: Hist) => { const t = h.find((x) => x.key === 'take'); return t ? t.out : h.some((x) => x.out === 'ok') ? 'dad' : 'mom' }
export const PARKING: Game = {
  sid: 'fun_parking', title: '老爸倒车', tag: '父亲节爆笑车库', color: '#ffb020',
  logline: '商场地下车库只剩最后一个车位。老爸：「我自己来！」妈妈在副驾憋着，儿子在后座开直播。他到底能不能停进去？',
  cast: [{ id: 'dad', name: '老爸', role: '嘴硬车神' }, { id: 'mom', name: '老妈', role: '副驾冷面' }, { id: 'son', name: '儿子', role: '直播吐槽' }, { id: 'girl', name: '朵朵', role: '贴纸颁奖' }, { id: 'guard', name: '保安大叔', role: '隐藏车神' }],
  intro: { clip: 'intro', cap: '老爸：「这个位置，小意思。」老妈：「要不……」——「我自己来！」' },
  next(h) {
    const last = h[h.length - 1]
    if (last?.key === 'take') return null
    if (last?.out === 'ok') return null
    const n = tries(h)
    if (last?.out === 'mom' || n >= 5) return { key: 'take', title: '老妈接管', q: '老妈出手，能一把停进去吗？', opts: [O('mom', '老妈一把进', 0.7), O('guard', '保安大叔：我来！', 0.3)], pre: ['mom'], cap: '老妈：「下车，我来。」' }
    const r = PARK_ROWS[Math.min(n, 3)]
    return { key: 'try' + (n + 1), title: `第 ${n + 1} 次倒车`, q: '这一把会怎样？', pre: [n % 2 ? 'try2' : 'try1'], cap: n ? `第 ${n + 1} 次。老爸：「这次肯定行。」` : '倒车雷达：嘀……嘀……嘀嘀嘀',
      opts: [O('ok', '稳稳停进', r[0]), O('skew', '歪了重来', r[1]), O('bin', '撞垃圾桶', r[2]), O('mom', '老妈：下车我来', r[3])] }
  },
  post(h, out, fx) {
    const take = h[h.length - 1]?.key === 'take'
    if (take) return out === 'guard' ? { clips: ['guard'], cap: '保安大叔小跑过来：「师傅，我来！」——一秒入库。全场沉默。' } : { clips: ['mom_ok'], cap: '老妈单手一打方向，一把进库。老爸缓缓摘下了眼镜。' }
    const n = tries(h), bins = h.filter((x) => x.out === 'bin').length
    if (out === 'ok') return { clips: ['ok'], cap: '一把进库！老爸：「看见没！」' }
    if (out === 'skew') return { clips: ['skew', ...(n >= 3 ? ['roast2'] : fx < 0.5 ? ['roast1'] : ['honk'])], cap: n >= 3 ? '朵朵：「爸爸，这是第三次了。」' : '斜跨两个车位。「我再调一下。」' }
    if (out === 'bin') return { clips: ['bin', ...(fx < 0.5 ? ['honk'] : ['roast1'])], cap: `哐！垃圾桶第 ${bins} 个坑。「谁把垃圾桶放这儿的！」` }
    return { clips: [], cap: '老妈把墨镜拉了下来……' }
  },
  legs: [
    { id: 'when', title: '第几次停进去', bins: [{ id: 'n1', label: '第 1 次' }, { id: 'n23', label: '第 2~3 次' }, { id: 'n4', label: '第 4 次+' }, { id: 'take', label: '被接管' }],
      of: (h) => { if (h.some((x) => x.key === 'take')) return 'take'; const n = tries(h); return n === 1 ? 'n1' : n <= 3 ? 'n23' : 'n4' } },
    { id: 'bin', title: '垃圾桶被撞几次', bins: [{ id: 'b0', label: '0 次' }, { id: 'b1', label: '1 次' }, { id: 'b2', label: '2 次+' }], of: (h) => { const b = h.filter((x) => x.out === 'bin').length; return b === 0 ? 'b0' : b === 1 ? 'b1' : 'b2' } },
    { id: 'who', title: '最后谁停进去', bins: [{ id: 'dad', label: '老爸' }, { id: 'mom', label: '老妈' }, { id: 'guard', label: '保安大叔' }], of: parkWho }
  ],
  final: { title: '押车神', opts: [{ id: 'dad', label: '老爸' }, { id: 'mom', label: '老妈' }, { id: 'guard', label: '保安大叔' }], of: parkWho },
  ending: (h) => { const w = parkWho(h); return { clip: 'end_' + w, cap: w === 'dad' ? '朵朵给老爸贴上「车神」。「下次……还是我来。」「闭嘴。」' : w === 'mom' ? '「车神」贴纸贴在了老妈身上。老爸：「下次……还是我来。」' : '「车神」是保安大叔。全家给大叔递上冰淇淋。' } },
  rules: ['每次倒车 4 种结果，概率随次数变化：老爸越倒越熟（进库 20%→50%），老妈越来越没耐心（接管 10%→25%）', '老妈接管后 70% 一把进，30% 保安大叔冲过来', '最多倒 5 次，第 5 次还不行老妈强制接管']
}

// ───────────────────────── ② 霸总求婚 ─────────────────────────
const CEO_STEPS = [
  { key: 's1', title: '第一步 · 戒指藏蛋糕', q: '蛋糕端上来了……', pre: ['t1'], cap: '顾总：「女人，你成功引起了我的注意。」',
    opts: [O('ok', '切到戒指·感动', 0.3), O('a', '蛋糕扣顾总脸上', 0.27), O('b', '王大妈吃到戒指', 0.25), O('c', '「我减肥」', 0.18)] },
  { key: 's2', title: '第二步 · 无人机送玫瑰', q: '无人机起飞了……', pre: ['t2'], cap: '特助：「顾总，第二步准备就绪。」',
    opts: [O('ok', '花瓣漫天', 0.3), O('a', '挂吊灯上转圈', 0.27), O('b', '玫瑰投给王大妈', 0.25), O('c', '跟外卖小哥跑了', 0.18)] },
  { key: 's3', title: '第三步 · 单膝下跪', q: '顾总单膝跪地……', pre: ['t3'], cap: '「女人，嫁给我。」',
    opts: [O('ok', '「我愿意！」', 0.3), O('a', '裤裆裂了', 0.27), O('b', '「我是来面试保洁的」', 0.25), O('c', '前妻抱娃冲进来', 0.18)] }
]
const CEO_CAP: Record<string, string> = {
  s1_ok: '她切开蛋糕——钻戒！捂嘴感动。', s1_a: '小王一个踉跄，整个蛋糕扣在顾总脸上。顾总：「没事。」', s1_b: '王大妈一口咬下：「哎哟！谁家蛋糕里有石头！」然后戴上了。', s1_c: '「不好意思，我减肥，不吃蛋糕。」（蟋蟀声）',
  s2_ok: '漫天玫瑰花瓣，慢动作。', s2_a: '无人机挂在水晶吊灯上原地转圈，两人的头跟着一起转。', s2_b: '玫瑰精准投进王大妈怀里：「哎呀，这多不好意思。」', s2_c: '无人机跟着外卖小哥飞走了。「回来！回来！」',
  s3_ok: '「我愿意！」礼炮炸响，顾总终于笑了（墨镜没摘）。', s3_a: '「嘶啦——」裤裆裂了。全场死寂，王大妈的瓜子掉了。', s3_b: '「顾总……我是来面试保洁的。」一片花瓣落在他头上。', s3_c: '「孩子他爸！」「爸爸！」顾总缓缓摘下墨镜，冒汗。'
}
const ceoEnd = (h: Hist) => { const s3 = h.find((x) => x.key === 's3')?.out; const dama = h.filter((x) => x.out === 'b' && x.key !== 's3').length
  return s3 === 'ok' ? 'lin' : s3 === 'b' ? 'wang' : s3 === 'c' ? 'zhu' : dama ? 'dama' : 'wang' }
export const CEO: Game = {
  sid: 'fun_ceo', title: '霸总求婚', tag: '短剧恶搞', color: '#ff4d8d',
  logline: '顾总戴着墨镜包下整个餐厅（人均 38），按「霸总三步求婚法」向林小姐求婚。每一步都可能翻车——而且一次比一次离谱。',
  cast: [{ id: 'gu', name: '顾总', role: '墨镜霸总' }, { id: 'lin', name: '林小姐', role: '其实来面试' }, { id: 'wang', name: '服务员小王', role: '暗恋女主' }, { id: 'dama', name: '王大妈', role: '嗑瓜子看戏' }, { id: 'zhu', name: '特助', role: '执行方案' }],
  intro: { clip: 'intro', cap: '「这个餐厅，我包了。」——「先生，人均三十八。」' },
  next(h) { return h.length < 3 ? CEO_STEPS[h.length] : null },
  post(h, out, fx) { const k = h[h.length - 1].key; return { clips: [...(fx < 0.45 ? ['glasses'] : []), `${k}_${out}`], cap: (fx < 0.45 ? '顾总缓缓摘下墨镜（噔噔噔）——' : '') + CEO_CAP[`${k}_${out}`] } },
  legs: CEO_STEPS.map((s, i) => ({ id: s.key, title: s.title.split(' · ')[1], bins: s.opts.map((o) => ({ id: o.id, label: o.label })), of: (h: Hist) => h[i]?.out || '-' })),
  final: { title: '押最终配对', opts: [{ id: 'lin', label: '林小姐答应了' }, { id: 'wang', label: '跟服务员小王走了' }, { id: 'dama', label: '王大妈答应了顾总' }, { id: 'zhu', label: '顾总和特助相拥而泣' }], of: ceoEnd },
  ending: (h) => { const e = ceoEnd(h); return { clip: 'end_' + e, cap: { lin: '两人相拥。小王在背景里抹泪：「我的青春……结束了。」', wang: '林小姐牵着小王走了。「顾总，人均三十八，记得结账。」', dama: '王大妈握住顾总的手：「小伙子，阿姨答应你了！」（婚礼进行曲）', zhu: '「这个世界上，只有你懂我。」「顾总，下个月还有。」' }[e]! } },
  rules: ['三步各有 4 种结果：成功 30% · 翻车 A 27% · 翻车 B 25% · 离谱翻车 18%', '结局：第三步成功 → 林小姐；「面试保洁」→ 跟小王走；前妻冲进来 → 顾总和特助相拥；裤子裂了 → 前面王大妈截胡过就是王大妈，否则小王', '每步有 45% 概率顾总先摘墨镜放大招（纯演出，不影响结果）']
}

// ───────────────────────── ③ 动物世界·打工人篇 ─────────────────────────
const SPECIES = [{ id: 'yin', label: '银背' }, { id: 'zai', label: '幼崽' }, { id: 'liang', label: '囤粮者' }, { id: 'que', label: '雄孔雀' }, { id: 'ni', label: '拟态大师' }]
const BASE = [{ yin: 0.28, zai: 0.12, liang: 0.22, que: 0.2, ni: 0.18 }, { yin: 0.2, zai: 0.15, liang: 0.3, que: 0.15, ni: 0.2 }, { yin: 0.22, zai: 0.18, liang: 0.18, que: 0.24, ni: 0.18 }] as Record<string, number>[]
const BOSS_P = 0.25
const officeOpts = (h: Hist) => {
  const k = h.length, w: Record<string, number> = { ...BASE[k] }
  for (const x of h) if (w[x.out] !== undefined) w[x.out] *= 0.6 // 赢过的物种「得意 / 吃饱」→ 下一轮权重 ×0.6
  const tot = Object.values(w).reduce((a, b) => a + b, 0), scale = k === 2 ? 1 - BOSS_P : 1
  const opts = SPECIES.map((s) => O(s.id, s.label, (w[s.id] / tot) * scale))
  if (k === 2) { opts.push(O('boss', '天敌出现·全员装死', BOSS_P)) }
  return opts
}
const officeWinner = (h: Hist) => h.map((x) => (x.out === 'boss' ? 'zai' : x.out))
const fittest = (h: Hist) => { const ws = officeWinner(h), c: Record<string, number> = {}; ws.forEach((w) => (c[w] = (c[w] || 0) + 1)); const top = Object.entries(c).sort((a, b) => b[1] - a[1]); return top[0][1] >= 2 ? top[0][0] : ws[2] }
const R_TITLE = ['早高峰 · 最后一部电梯', '午饭 · 唯一的微波炉', '下班 · 18:00 打卡']
const R_CAP: Record<string, string[]> = {
  yin: ['银背凭借二十年的经验，早就站在了门口。', '银背只用了一个眼神。', '银背第一个完成了归巢。'],
  zai: ['幼崽被族群意外推进了电梯。这是它第一次领先。', '当强者内斗，幼崽悄悄获得了食物。', '幼崽不需要加班。这是它最大的优势。'],
  liang: ['囤粮者用饭盒卡住了门。食物，就是力量。', '囤粮者一次加热了三天的口粮。', '囤粮者，满载而归。'],
  que: ['雄孔雀发起冲刺。它成功了，但没有雌性看到。', '雄孔雀的鸡胸肉，今天第五顿。', '雄孔雀奔向了它的第二个栖息地——健身房。'],
  ni: ['没有人发现，拟态大师一直都在电梯里。', '拟态大师早在十一点就占据了热源。', '拟态大师，梦游下班。']
}
export const OFFICE: Game = {
  sid: 'fun_office', title: '动物世界·打工人篇', tag: '纪录片恶搞', color: '#5ad17a',
  logline: '用《动物世界》的深沉解说，记录一座写字楼里的打工人生态：银背、幼崽、囤粮者、雄孔雀、拟态大师。三场生存争夺战，谁是年度适者？',
  cast: [{ id: 'yin', name: '银背', role: '二十年没升职' }, { id: 'zai', name: '幼崽', role: '实习生' }, { id: 'liang', name: '囤粮者', role: '带三天的饭' }, { id: 'que', name: '雄孔雀', role: '健身男' }, { id: 'ni', name: '拟态大师', role: '摸鱼王' }, { id: 'boss', name: '天敌', role: '老板' }],
  intro: { clip: 'intro', cap: '「清晨七点五十九分。写字楼里的生灵们，开始了一天的迁徙。」' },
  next(h) { if (h.length >= 3) return null; const k = h.length; return { key: 'r' + (k + 1), title: R_TITLE[k], q: k === 0 ? '谁能挤进最后一部电梯？' : k === 1 ? '谁先抢到微波炉？' : '谁第一个打卡下班？', opts: officeOpts(h), pre: ['t' + (k + 1)], cap: ['「最后一部电梯即将关闭。只有一个物种，能挤进去。」', '「正午。整片栖息地，只有一个热源。」', '「距离下班，还有最后一分钟。」'][k] } },
  post(h, out, fx) { const k = h.length - 1
    if (out === 'boss') return { clips: ['r3_boss'], cap: '「大家先别走，开个短会。」——全体瞬间装死。「这，就是自然界最古老的生存智慧。」幼崽（实习生不用开会）胜出。' }
    return { clips: [...(fx < 0.3 && k < 2 ? ['mimic'] : []), `r${k + 1}_${out}`], cap: (fx < 0.3 && k < 2 ? '「注意看，拟态大师已经进入休眠，却依然保持着打字的姿态。」' : '') + '「' + R_CAP[out][k] + '」' } },
  legs: [0, 1, 2].map((i) => ({ id: 'r' + (i + 1), title: R_TITLE[i].split(' · ')[1], bins: SPECIES, of: (h: Hist) => officeWinner(h)[i] })),
  final: { title: '押年度适者', opts: SPECIES, of: fittest },
  ending: (h) => { const f = fittest(h); return { clip: 'end_' + f, cap: { yin: '「今年的适者，是银背。他已经二十年没有升职，但他从未被淘汰。」', zai: '「今年的适者，是幼崽。它还不知道什么叫周报，这就是它的力量。」', liang: '「今年的适者，是囤粮者。在这片丛林里，吃饱的，才能活下去。」', que: '「今年的适者，是雄孔雀。虽然，依然没有雌性在看。」', ni: '「今年的适者，是拟态大师。没有人知道，他是什么时候赢的。」' }[f]! } },
  rules: ['每轮 5 个物种按公开权重争夺；上一轮的赢家「得意 / 吃饱」，下一轮权重 ×0.6', '下班那轮有 25% 概率天敌（老板）出现，全员装死，幼崽（实习生）胜出', '年度适者 = 赢 2 轮以上的物种；三轮三个赢家时，归下班最快的那位']
}
export const FUN_GAMES: Record<string, Game> = { fun_parking: PARKING, fun_ceo: CEO, fun_office: OFFICE }
