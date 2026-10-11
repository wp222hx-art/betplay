// 逐个揭晓 · 淘汰赛通用引擎（从致命13 提炼）
// 一部剧 = 一份配置：N 个参赛者 + 每轮公开风险 risk[k] + 文案；每人 2 段片 out{i}/safe{i}（同机位、首尾帧锁定）
// 规则：每轮所有在场者同时“判定”（HMAC(seed,"r:k:t:i") < risk[k] → 出局）；全员出局的尝试作废重来（保证有人留下）
//       剩 ≥3 人继续下一轮（最多 max_rounds 轮）；剩 2 人进入对决（final：两人依次判定，直到恰好一人出局）；剩 1 人直接胜出
// 押注：每轮开演前 8 秒押「这一轮后还剩几人」（三档，赔率 = rtp / 档概率）；对决押谁赢；连中 3 轮发奖池大奖
import { randomHex, seedFloat, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'
import { survivorDist } from './lethal13'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

export type GCast = { id: number; name: string; tag?: string }
export type Gauntlet = {
  sid: string; title: string; board: 'thrill' | 'fun'; tension: number; color: string
  logline: string; rules: string[]
  cast: GCast[]
  risk: number[]                 // risk[k-1]：第 k 轮每人出局概率（公开）
  final_risk: number              // 对决每次判定的出局概率
  max_rounds: number
  words: { round: string; roundCap: (k: number, n: number, r: number) => string; q: string; out: string; safe: string; outFx: string; safeFx: string; finalQ: string; finalCap: string; winner: string; seqCap: string }
  sfx: { out: string; safe: string }   // 'bang' | 'click' | 'slam' | 'fail' | 'ding' ...（前端映射）
}
export const G_CFG = { rtp: 0.94, stakes: [10, 20, 50, 100, 200], pick_sec: 8, streak_need: 3, streak_share: 0.05, streak_cap_mult: 30, side_rake: 0.02, seed_pool: 20000, max_open_per_ip: 2 }

const C = (names: string[]) => names.map((name, i) => ({ id: i + 1, name }))
export const GAUNTLETS: Record<string, Gauntlet> = {
  g_elevator: {
    sid: 'g_elevator', title: '坠梯', board: 'thrill', tension: 5, color: '#ff3b4f',
    logline: '23:40，写字楼 23 层。8 个加班的人挤在同一部电梯里，钢缆断了。每坠一层就是一次猛烈的急停——松手的人，会被甩到地上。',
    rules: ['8 个人困在失控下坠的电梯里，每人死死抓着扶手', '每坠一层就急停一次，一次比一次猛：被甩倒的概率 15% → 55%，被甩倒 = 出局', '每次急停前 8 秒，押「这一层之后还剩几个人站着」；最后 2 人迎来最后一次急停'],
    cast: C(['林夏', '老周', '阿强', '小美', '眼镜', '胖哥', '保洁阿姨', '帽檐男人']),
    risk: [0.15, 0.25, 0.35, 0.45, 0.55], final_risk: 0.5, max_rounds: 5,
    words: { round: '层', roundCap: (k, n, r) => `第 <b>${k}</b> 次急停 · 比上一次更猛 · 被甩倒 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一次急停之后，还剩几个人站着？', out: '被甩倒', safe: '抓住了', outFx: '倒！', safeFx: '稳', finalQ: '最后一次急停——谁还站着？', finalCap: '只剩两个人还抓着扶手', winner: '撑到了救援', seqCap: '电梯猛地一停——一个接一个看过去' },
    sfx: { out: 'slam', safe: 'grip' }
  },
  g_hostage: {
    sid: 'g_hostage', title: '人质谈判', board: 'thrill', tension: 5, color: '#ff3b4f',
    logline: '银行劫案第 3 小时。劫匪说只放一个人走，手里一只黑布袋：「摸到黑球的，回墙角去。」每谈一轮，他往袋里多扔一颗黑球。',
    rules: ['8 个人质依次伸手进黑布袋摸球：白球 = 留在队里，黑球 = 被押回墙角（出局）', '每谈判一轮，袋里多一颗黑球：摸到黑球的概率 15% → 55%', '每轮摸球前 8 秒，押「这一轮后还剩几个人在队里」；最后 2 人：袋里一白一黑，摸到白球的被放走'],
    cast: C(['小周', '老板', '孕妇', '外卖员', '大学生', '保安', '老太太', '程序员']),
    risk: [0.15, 0.25, 0.35, 0.45, 0.55], final_risk: 0.5, max_rounds: 5,
    words: { round: '轮', roundCap: (k, n, r) => `第 <b>${k}</b> 轮谈判 · 袋里多了一颗黑球 · 摸到黑球 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一轮摸完，队里还剩几个人？', out: '黑球·押回墙角', safe: '白球·留下', outFx: '黑球', safeFx: '白球', finalQ: '一白一黑——谁被放走？', finalCap: '袋里只剩一白一黑', winner: '被放走了', seqCap: '一个接一个伸手进袋子' },
    sfx: { out: 'thud', safe: 'ding' }
  },
  g_lasthand: {
    sid: 'g_lasthand', title: '最后一把', board: 'thrill', tension: 4, color: '#ffb020',
    logline: '地下牌室，一盏吊灯，8 个欠债的人。荷官每轮翻开一张「门槛牌」，一轮比一轮大。翻到比它小的——离桌，债翻倍。',
    rules: ['8 个赌徒依次翻开自己的牌：比门槛牌大 = 留下，比它小 = 离桌', '门槛牌一轮比一轮大：出局概率 20% → 60%', '每轮翻牌前 8 秒，押「这一轮后还剩几人」；最后 2 人比一张'],
    cast: C(['老陈', '刀疤', '阿杰', '红姐', '老K', '学生仔', '胖子', '荷官的弟弟']),
    risk: [0.2, 0.3, 0.4, 0.5, 0.6], final_risk: 0.5, max_rounds: 5,
    words: { round: '轮', roundCap: (k, n, r) => `第 <b>${k}</b> 轮 · 门槛牌更大了 · 翻输 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一轮翻完，桌上还剩几个人？', out: '翻小·离桌', safe: '翻大·留下', outFx: '输', safeFx: '过', finalQ: '最后一张牌，谁赢？', finalCap: '只剩两个人，各翻一张', winner: '赢下了最后一把', seqCap: '一个接一个翻牌' },
    sfx: { out: 'fail', safe: 'flip' }
  },
  g_slacker: {
    sid: 'g_slacker', title: '摸鱼大逃杀', board: 'fun', tension: 3, color: '#ffb020',
    logline: '周五下午 4 点，开放式工位，8 个打工人都在摸鱼。老板端着保温杯开始巡逻——一圈比一圈快。',
    rules: ['老板依次走过 8 个工位：秒切回工作界面 = 过关，被抓包 = 出局', '老板一圈比一圈走得快：被抓概率 15% → 55%', '每圈巡逻前 8 秒，押「这一圈后还剩几个摸鱼人」；最后 2 人：老板站在两人中间'],
    cast: C(['小王', '阿花', '老李', '实习生', '大刘', '财务姐', '程序猿', '前台妹']),
    risk: [0.15, 0.25, 0.35, 0.45, 0.55], final_risk: 0.5, max_rounds: 5,
    words: { round: '圈', roundCap: (k, n, r) => `老板第 <b>${k}</b> 圈巡逻 · 走得更快了 · 被抓 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一圈巡完，还剩几个摸鱼人？', out: '被抓包', safe: '秒切屏', outFx: '抓到了！', safeFx: '稳', finalQ: '老板站在两人中间——谁先露馅？', finalCap: '最后两个摸鱼高手', winner: '摸鱼到了下班', seqCap: '老板一个工位一个工位走过去' },
    sfx: { out: 'fail', safe: 'ding' }
  },
  g_parking: {
    sid: 'g_parking', title: '抢车位', board: 'fun', tension: 3, color: '#ffb020',
    logline: '商场地下车库只剩一个窄车位。8 个司机排队轮流倒车，刮一下就出局。每过一轮，保安往里再挪一个雪糕筒。',
    rules: ['8 个司机依次倒车进同一个车位：稳稳停进 = 过关，「咔」刮到 = 出局', '每轮车位再窄一点：刮蹭概率 15% → 55%', '每轮倒车前 8 秒，押「这一轮后还剩几个司机」；最后 2 人：车位只剩一车宽'],
    cast: C(['阿木', '老爸', '新手妹', '出租司机', '霸总', '大妈', '外卖小哥', '代驾']),
    risk: [0.15, 0.25, 0.35, 0.45, 0.55], final_risk: 0.5, max_rounds: 5,
    words: { round: '轮', roundCap: (k, n, r) => `第 <b>${k}</b> 轮 · 雪糕筒又挪近了 · 刮蹭 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一轮倒完，还剩几个司机？', out: '咔·刮到了', safe: '稳稳停进', outFx: '咔！', safeFx: '稳', finalQ: '车位只剩一车宽——谁停进去？', finalCap: '最后两个车神', winner: '停进了最后的车位', seqCap: '一个接一个倒车' },
    sfx: { out: 'crunch', safe: 'ding' }
  },
  g_ceo: {
    sid: 'g_ceo', title: '霸总选妃', board: 'fun', tension: 3, color: '#ff5a8a',
    logline: '顶楼宴会厅，8 位求婚者排成一排单膝跪地。霸总每走过一个人，只说两个字：「收下」或「下一位」。戒指盒一轮比一轮小。',
    rules: ['霸总依次走过 8 位求婚者：「收下」= 过关，「下一位」= 出局', '戒指盒一轮比一轮小：被淘汰概率 20% → 60%', '每轮走过前 8 秒，押「这一轮后还剩几位」；最后 2 人：只剩一枚戒指'],
    cast: C(['白富美', '王大妈', '外卖小哥', '前妻', '健身教练', '女秘书', '保洁阿姨', '隔壁老王']),
    risk: [0.2, 0.3, 0.4, 0.5, 0.6], final_risk: 0.5, max_rounds: 5,
    words: { round: '轮', roundCap: (k, n, r) => `第 <b>${k}</b> 轮 · 戒指盒更小了 · 被淘汰 <b class="red">${Math.round(r * 100)}%</b>`, q: '这一轮选完，还剩几位求婚者？', out: '「下一位」', safe: '「收下」', outFx: '下一位', safeFx: '收下', finalQ: '只剩一枚戒指——给谁？', finalCap: '最后两位', winner: '拿到了最后一枚戒指', seqCap: '霸总一个一个走过去' },
    sfx: { out: 'fail', safe: 'ding' }
  }
}
const POOL = (sid: string) => `pool:thrill:${sid}`
const G = (sid: string) => { const g = GAUNTLETS[sid]; if (!g) throw new GameError('NOT_FOUND', '剧不存在'); return g }

// ─────────── 概率：n 人、每人出局 p，条件于「至少 1 人留下」→ 留下人数分布 ───────────
export function stayDist(n: number, p: number) {
  const q = 1 - p, norm = 1 - Math.pow(p, n), d: Record<number, number> = {}
  let c = 1
  for (let s = 0; s <= n; s++) { if (s) c = (c * (n - s + 1)) / s; if (s >= 1) d[s] = (c * Math.pow(q, s) * Math.pow(p, n - s)) / norm }
  return d
}
/** 三档（或两档）：剩 n 人分布切成概率尽量均等的连续区间 */
export function gTiers(n: number, p: number, rtp = G_CFG.rtp) {
  const d = stayDist(n, p), vals = Array.from({ length: n }, (_, i) => n - i), P = (a: number[]) => a.reduce((x, s) => x + (d[s] || 0), 0)
  let best: number[][] = [], score = Infinity
  if (n >= 3) for (let i = 1; i < vals.length - 1; i++) for (let j = i + 1; j < vals.length; j++) {
    const g = [vals.slice(0, i), vals.slice(i, j), vals.slice(j)], ps = g.map(P)
    if (ps.some((x) => x < 0.06)) continue
    const sc = Math.max(...ps.map((x) => Math.abs(x - 1 / 3))); if (sc < score) { score = sc; best = g }
  }
  if (!best.length) { let s2 = Infinity; for (let i = 1; i < vals.length; i++) { const g = [vals.slice(0, i), vals.slice(i)], sc = Math.abs(P(g[0]) - 0.5); if (sc < s2) { s2 = sc; best = g } } }
  return best.map((g, i) => { const p0 = P(g), hi = g[0], lo = g[g.length - 1]
    return { id: 't' + i, label: hi === lo ? `剩 ${hi} 人` : lo === 1 ? `剩 ${hi} 人及以下` : hi === n ? `剩 ${lo} 人及以上` : `剩 ${lo}~${hi} 人`, lo, hi, p: p0, odds: Math.max(1.01, Math.floor((rtp / p0) * 100) / 100) } })
}

// ─────────── 整局（只由种子决定） ───────────
export type GRound = { k: number; type: 'ring' | 'final'; risk: number; before: number[]; voids: number; out: number[]; after: number[]; order?: number[]; tries?: { t: number; out: number[] }[] }
export async function gFull(g: Gauntlet, seed: string) {
  let alive = g.cast.map((c) => c.id); const rounds: GRound[] = []
  for (let k = 1; alive.length >= 3 && k <= g.max_rounds; k++) {
    const p = g.risk[k - 1]; let t = 0, out: number[] = []
    for (; t < 50; t++) { out = []; for (let i = 0; i < alive.length; i++) if ((await seedFloat(seed, `r:${k}:${t}:${i}`)) < p) out.push(alive[i]); if (out.length < alive.length) break }
    const order = await shuffle(seed, `o:${k}`, alive)
    rounds.push({ k, type: 'ring', risk: p, before: alive, voids: t, out, after: alive.filter((x) => !out.includes(x)), order }); alive = rounds[rounds.length - 1].after
  }
  if (alive.length > 2) { // 轮数用尽仍 ≥3：按种子抽 2 人进对决，其余并列「幸存」
    const o = await shuffle(seed, 'pick', alive); alive = o.slice(0, 2).sort((a, b) => a - b)
  }
  if (alive.length === 2) {
    const tries: { t: number; out: number[] }[] = []; let loser = 0
    for (let t = 0; t < 60 && !loser; t++) { const out: number[] = []; for (let i = 0; i < 2; i++) if ((await seedFloat(seed, `f:${t}:${i}`)) < g.final_risk) out.push(alive[i]); tries.push({ t, out }); if (out.length === 1) loser = out[0] }
    rounds.push({ k: rounds.length + 1, type: 'final', risk: g.final_risk, before: alive, voids: 0, out: [loser], after: alive.filter((x) => x !== loser), tries })
  }
  return rounds
}
async function shuffle(seed: string, label: string, a: number[]) { const r = await Promise.all(a.map(async (x) => ({ x, r: await seedFloat(seed, `${label}:${x}`) }))); return r.sort((p, q) => p.r - q.r).map((y) => y.x) }
const winnerOf = (rs: GRound[]) => rs[rs.length - 1].after[0]

export function gOptions(g: Gauntlet, r: GRound) {
  if (r.type === 'final') return r.before.map((id) => ({ id: 'n' + id, label: `${id} 号 · ${g.cast[id - 1].name}`, lo: id, hi: id, p: 0.5, odds: Math.floor((G_CFG.rtp / 0.5) * 100) / 100 }))
  return gTiers(r.before.length, r.risk)
}
const card = (g: Gauntlet, r: GRound, total: number) => ({ k: r.k, type: r.type, risk: r.risk, alive: r.before, tiers: gOptions(g, r), total })
const reveal = (r: GRound) => ({ k: r.k, type: r.type, risk: r.risk, before: r.before, voids: r.voids, out: r.out, after: r.after, order: r.order || null, tries: r.tries || null })

// ─────────── 资金 / 媒体 ───────────
async function poolBalance(env: Env, sid: string) { const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL(sid)).first(); return r?.b || 0 }
async function ensurePool(env: Env, sid: string) { const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL(sid)).first(); if (!r) await post(env, `${G(sid).title}·奖池注资`, sid, [['platform:house', 'D', G_CFG.seed_pool], [POOL(sid), 'C', G_CFG.seed_pool]]) }
export async function gSaveMedia(env: Env, sid: string, clips: Record<string, number>) {
  G(sid)
  await env.DB.prepare(`INSERT INTO thrill_series (id,title,logline,tension,cover,data,version,status,created_at,updated_at) VALUES (?,?,'',3,NULL,?,1,'offline',?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, version=thrill_series.version+1, updated_at=excluded.updated_at`).bind(sid + '_media', G(sid).title + '·媒体清单', JSON.stringify({ clips }), now(), now()).run()
  return { ok: true, clips: Object.keys(clips).length }
}
async function media(env: any, sid: string, userId?: string) {
  const r: any = await env.DB.prepare(`SELECT data FROM thrill_series WHERE id=?`).bind(sid + '_media').first(); if (!r) return null
  const clips: Record<string, number> = J(r.data, {}).clips || {}, out: Record<string, { url: string; dur: number }> = {}
  for (const [k, dur] of Object.entries(clips)) out[k] = { url: userId ? await mediaTicket(env, userId, sid, k, 30 * 60000) : '', dur }
  return { clips: out, faces: G(sid).cast.map((c) => `/gimg/${sid}/p${c.id}.webp`), cover: `/gimg/${sid}/cover.webp` }
}
export async function gList(env: Env, board?: string) {
  const out = []
  for (const g of Object.values(GAUNTLETS)) {
    if (board && g.board !== board) continue
    const m: any = await env.DB.prepare(`SELECT 1 FROM thrill_series WHERE id=?`).bind(g.sid + '_media').first()
    const n: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE series_id=?`).bind(g.sid).first()
    await ensurePool(env, g.sid)
    out.push({ id: g.sid, title: g.title, board: g.board, tension: g.tension, logline: g.logline, color: g.color, cover: m ? `/gimg/${g.sid}/cover.webp` : null, live: !!m, plays: n?.n || 0, pool: await poolBalance(env, g.sid), url: '/g/' + g.sid, gauntlet: true, cast_n: g.cast.length })
  }
  return out
}
export async function gMeta(env: Env, sid: string, userId?: string) {
  const g = G(sid); await ensurePool(env, sid)
  const open: any = userId ? await env.DB.prepare(`SELECT id FROM thrill_runs WHERE user_id=? AND series_id=? AND status='playing' LIMIT 1`).bind(userId, sid).first() : null
  const agg: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE series_id=? AND status='ended'`).bind(sid).first()
  return { sid, title: g.title, board: g.board, tension: g.tension, color: g.color, logline: g.logline, rules: g.rules, cast: g.cast, risk: g.risk, final_risk: g.final_risk, words: { ...g.words, roundCap: undefined }, round_caps: g.risk.map((r, i) => g.words.roundCap(i + 1, 0, r)), sfx: g.sfx,
    cfg: G_CFG, pool: await poolBalance(env, sid), stats: { plays: agg?.n || 0 }, open_run: open?.id || null, media: userId ? await media(env, sid, userId) : null }
}

// ─────────── 一局 ───────────
export async function gStart(env: Env, p: { sid: string; userId: string; ipHash: string; sybil?: boolean }) {
  const g = G(p.sid)
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  await gExpire(env)
  const mine: any = await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE user_id=? AND status='playing' AND started_at>? LIMIT 1`).bind(p.userId, now() - 15 * 60000).first()
  if (mine) {
    if (GAUNTLETS[mine.series_id]) await finish(env, mine.id, 'abandon')
    else throw new GameError('ONE_AT_A_TIME', '你在另一部剧还有一局没看完（15 分钟后自动结算）')
  }
  const ipOpen: any = await env.DB.prepare(`SELECT COUNT(*) n FROM thrill_runs WHERE ip_hash=? AND status='playing' AND started_at>?`).bind(p.ipHash, now() - 15 * 60000).first()
  if ((ipOpen?.n || 0) >= G_CFG.max_open_per_ip) { await riskEvent(env as any, p.userId, 'gauntlet_multi_open', 2, { sid: p.sid }); throw new GameError('MULTI_OPEN', '同一网络下同时进行的局数已达上限') }
  await ensurePool(env, p.sid)
  const rid = uid('gr_'), seed = randomHex(32), commit = await sha256(`${seed}|${rid}`), rs = await gFull(g, seed)
  await env.DB.prepare(`INSERT INTO thrill_runs (id,user_id,series_id,ip_hash,stake,gates,seed,commit_hash,outcomes,cfg,status,gate,mult,started_at) VALUES (?,?,?,?,0,?,?,?,'[]',?,'playing',0,0,?)`)
    .bind(rid, p.userId, p.sid, p.ipHash, rs.length, seed, commit, JSON.stringify({ ...G_CFG, sybil: !!p.sybil, streak: 0 }), now()).run()
  return { run_id: rid, commit, pool: await poolBalance(env, p.sid), round: card(g, rs[0], rs.length), balance: u.chips }
}
async function load(env: Env, rid: string, userId: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  if (!r || !GAUNTLETS[r.series_id]) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.user_id !== userId) throw new GameError('FORBIDDEN', '非本人局')
  return r
}
export async function gArm(env: Env, p: { runId: string; userId: string }) {
  const r = await load(env, p.runId, p.userId)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  if (r.armed_at) return { lock_at: r.lock_at, server_time: now() }
  const t = now(), lock = t + G_CFG.pick_sec * 1000 + 800
  await env.DB.prepare('UPDATE thrill_runs SET armed_at=?, lock_at=? WHERE id=? AND armed_at IS NULL').bind(t, lock, r.id).run()
  return { lock_at: lock, server_time: t }
}
export async function gAct(env: Env, p: { runId: string; userId: string; k: number; tier?: string | null; bet?: number }) {
  const r = await load(env, p.runId, p.userId), g = G(r.series_id)
  if (r.status !== 'playing') throw new GameError('RUN_ENDED', '本局已结束')
  const idx = r.gate
  if (+p.k !== idx + 1) throw new GameError('STALE_ROUND', `当前是第 ${idx + 1} 轮`)
  const rs = await gFull(g, r.seed), rd = rs[idx], late = !r.armed_at || now() > r.lock_at
  const tiers = gOptions(g, rd), tier = p.tier && !late ? tiers.find((t) => t.id === p.tier) : null
  if (p.tier && !late && !tier) throw new GameError('BAD_TIER', '无效选项')
  const bet = tier ? Math.floor(+(p.bet || 0)) : 0
  if (tier && !G_CFG.stakes.includes(bet)) throw new GameError('BAD_STAKE', `只能押 ${G_CFG.stakes.join(' / ')}`)
  if (bet) { const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first(); if ((u?.chips || 0) < bet) throw new GameError('INSUFFICIENT', `需要 ${bet} Chips`) }
  const adv = await env.DB.prepare(`UPDATE thrill_runs SET gate=gate+1, armed_at=NULL, lock_at=NULL WHERE id=? AND gate=? AND status='playing'`).bind(r.id, idx).run()
  if (!adv.meta.changes) throw new GameError('DUPLICATE', '已结算')
  const val = rd.type === 'final' ? rd.after[0] : rd.after.length
  const res: any = { k: rd.k, type: rd.type, left: rd.after.length, winner: rd.type === 'final' ? rd.after[0] : null, round: reveal(rd), side: null }
  if (tier) {
    const hit = val >= tier.lo && val <= tier.hi, pay = hit ? Math.floor(bet * tier.odds) : 0, rake = Math.round(bet * G_CFG.side_rake)
    const lines: [string, 'D' | 'C', number][] = [[`user:${r.user_id}:available`, 'D', bet], ['platform:house', 'C', bet - rake]]
    if (rake) lines.push([POOL(r.series_id), 'C', rake])
    if (pay) lines.push(['platform:house', 'D', pay], [`user:${r.user_id}:available`, 'C', pay])
    await post(env, `${g.title}·第${rd.k}轮${hit ? '命中' : '未中'} ${tier.label}`, r.id, lines)
    await env.DB.prepare('UPDATE users SET chips=chips-?+? WHERE id=?').bind(bet, pay, r.user_id).run()
    res.side = { tier: tier.id, label: tier.label, odds: tier.odds, bet, hit, payout: pay }
  }
  await env.DB.prepare(`INSERT INTO thrill_picks (run_id,gate,option_id,outcome_id,hit,streak,mult,payout,stake,picked_at) VALUES (?,?,?,?,?,0,?,?,?,?)`)
    .bind(r.id, idx, tier ? tier.id : late ? 'timeout' : 'watch', String(val), res.side?.hit ? 1 : 0, tier ? tier.odds : 0, res.side?.payout || 0, bet, now()).run()
  res.streak = await streak(env, r, res.side)
  if (idx + 1 >= rs.length) Object.assign(res, await finish(env, r.id, 'final'))
  else res.next = card(g, rs[idx + 1], rs.length)
  return res
}
async function streak(env: Env, r: any, side: any) {
  const cfg: any = J((await env.DB.prepare('SELECT cfg FROM thrill_runs WHERE id=?').bind(r.id).first<any>())?.cfg, {})
  const n = side?.hit ? (cfg.streak || 0) + 1 : 0; let bonus: any = null
  if (n && n % G_CFG.streak_need === 0) {
    const amt = Math.max(0, Math.min(Math.floor((await poolBalance(env, r.series_id)) * G_CFG.streak_share), side.bet * G_CFG.streak_cap_mult))
    if (amt) {
      if (cfg.sybil) { await post(env, `连中${n}大奖待审核`, r.id, [[POOL(r.series_id), 'D', amt], [`hold:thrill:${r.id}`, 'C', amt]]); bonus = { amount: amt, status: 'held' } }
      else { await post(env, `连中${n}大奖`, r.id, [[POOL(r.series_id), 'D', amt], [`user:${r.user_id}:available`, 'C', amt]]); await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(amt, r.user_id).run(); bonus = { amount: amt, status: 'paid' }; cfg.bonus_total = (cfg.bonus_total || 0) + amt }
    }
  }
  cfg.streak = n; cfg.best_streak = Math.max(cfg.best_streak || 0, n)
  await env.DB.prepare('UPDATE thrill_runs SET cfg=? WHERE id=?').bind(JSON.stringify(cfg), r.id).run()
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  return { n, need: G_CFG.streak_need, bonus, balance: u?.chips, pool: await poolBalance(env, r.series_id) }
}
async function finish(env: Env, rid: string, reason: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  await env.DB.prepare(`UPDATE thrill_runs SET status='ended', end_reason=?, ended_at=? WHERE id=? AND status!='ended'`).bind(reason, now(), rid).run()
  const g = G(r.series_id), rs = await gFull(g, r.seed), cfg: any = J(r.cfg, {})
  const sides = (await env.DB.prepare(`SELECT COALESCE(SUM(stake),0) s, COALESCE(SUM(payout),0) p FROM thrill_picks WHERE run_id=?`).bind(rid).first<any>()) || { s: 0, p: 0 }
  const u: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(r.user_id).first()
  return { ended: true, reason, winner: winnerOf(rs), staked: sides.s, paid: sides.p, bonus_total: cfg.bonus_total || 0, best_streak: cfg.best_streak || 0, net: sides.p - sides.s + (cfg.bonus_total || 0), balance: u?.chips, pool: await poolBalance(env, r.series_id), verify: { seed: r.seed, commit: r.commit_hash } }
}
export async function gExpire(env: Env) {
  const old = (await env.DB.prepare(`SELECT id, series_id FROM thrill_runs WHERE status='playing' AND series_id LIKE 'g_%' AND started_at<?`).bind(now() - 15 * 60000).all()).results as any[]
  for (const r of old) if (GAUNTLETS[r.series_id]) await finish(env, r.id, 'timeout')
}
export async function gVerify(env: Env, rid: string) {
  const r: any = await env.DB.prepare('SELECT * FROM thrill_runs WHERE id=?').bind(rid).first()
  if (!r || !GAUNTLETS[r.series_id]) throw new GameError('RUN_NOT_FOUND', '局不存在')
  if (r.status !== 'ended') return { run_id: rid, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const rs = await gFull(G(r.series_id), r.seed)
  return { run_id: rid, seed: r.seed, commit: r.commit_hash, ok: (await sha256(`${r.seed}|${rid}`)) === r.commit_hash, rounds: rs.map(reveal), winner: winnerOf(rs) }
}
export { survivorDist }
