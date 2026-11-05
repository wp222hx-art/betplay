// 致命13 · 社交房间（独立产品）
// ─────────────────────────────────────────────────────────────────────────────
// 一个房间 = 一局致命13（13 人一圈、第 k 轮每把枪 k 发、3~5 轮 + 决斗，结果只由种子决定，开局公开 commit、结束公开 seed）
// 每个用户每局只能以「一个身份」加入，二选一：
//   ① 入座参赛：认领 1~13 号中的一个空座位，押「自己」活过 3 轮 / 活过 4 轮 / 拿冠军（固定赔率，座位赔率更高）
//   ② 外围下注：押任意一个座位号 活过 3 轮 / 活过 4 轮 / 拿冠军（固定赔率）
// 只有一次下注、三个选项、五档注金 —— 没有每轮追注、没有分档、没有押注单。
// 节奏：等待（倒计时可下注）→ 开局（全房间按同一条服务端时间线同步观看）→ 结算 → 自动进入下一局（下一局在本局开打时就开放下注）
// 前期用「模拟玩家」（bot=1，界面明确标注）填充座位/外围/聊天；真人进来即真实占座，接口完全相同
// 无 cron：所有状态推进都在请求里惰性完成（tick），状态切换用条件 UPDATE 防并发重复
import { randomHex, sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'
import { fullGame, PRISONERS, type Round } from '../thrill/lethal13'

type Env = { DB: D1Database }
const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

// 实测概率（4 万局模拟，单个座位）：活过 3 轮 28.2% · 活过 4 轮 15.5% · 冠军 1/13 = 7.69%
export const TARGETS = [
  { id: 's3', label: '活过 3 轮', p: 0.282 },
  { id: 's4', label: '活过 4 轮', p: 0.155 },
  { id: 'champ', label: '拿冠军', p: 1 / 13 }
] as const
export type Target = (typeof TARGETS)[number]['id']
export const D13 = {
  seats: 13,
  stakes: [10, 20, 50, 100, 200],
  seat_odds: { s3: 3, s4: 6, champ: 12 } as Record<string, number>,   // 门内（入座押自己）
  out_odds: { s3: 3, s4: 5, champ: 10 } as Record<string, number>,    // 门外（外围押别人）
  rake: 0.03,                 // 每单 3% 进奖池
  champ_share: 0.05,          // 入座真人的座位拿冠军：额外分奖池 5%（上限注金 ×30）
  champ_cap_mult: 30,
  lobby_ms: 45000,            // 公共厅等待时长
  private_ms: 180000,         // 私人房最长等待（房主可提前开局）
  next_gap_ms: 15000,         // 本局结束后下一局至少还留 15 秒下注
  seed_pool: 50000,
  max_per_ip: 3               // 同一网络在同一局最多 3 个身份
}
const POOL = 'pool:d13'
const ODDS = (role: string, t: string) => (role === 'seat' ? D13.seat_odds : D13.out_odds)[t] || 0
const TLABEL = (t: string) => TARGETS.find((x) => x.id === t)?.label || t

async function poolBalance(env: Env) {
  const r: any = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='C' THEN amount ELSE -amount END),0) b FROM ledger WHERE account=?`).bind(POOL).first()
  return r?.b || 0
}
async function ensurePool(env: Env) {
  const r: any = await env.DB.prepare(`SELECT 1 FROM ledger WHERE account=? LIMIT 1`).bind(POOL).first()
  if (!r) await post(env, '致命13 社交房间奖池·上线注资', 'd13', [['platform:house', 'D', D13.seed_pool], [POOL, 'C', D13.seed_pool]])
}

// ─────────── 整局 → 每个座位的结局 ───────────
export function seatFates(rs: Round[]) {
  const dead: Record<number, number> = {}
  for (const r of rs) for (const d of r.dead) dead[d] ??= r.k
  const winner = rs[rs.length - 1].after[0]
  const fate = (seat: number) => ({ seat, died_round: dead[seat] || null, s3: !(dead[seat] <= 3), s4: !(dead[seat] <= 4), champ: winner === seat })
  return { winner, fates: PRISONERS.map((p) => fate(p.id)) }
}
export const hitOf = (fates: ReturnType<typeof seatFates>['fates'], seat: number, t: string) => !!(fates[seat - 1] as any)?.[t]

// ─────────── 全房间同步的时间线（毫秒偏移；前端按 start_at + at 播放） ───────────
export type Ev = { at: number; dur: number; type: string; [k: string]: any }
export function buildSchedule(rs: Round[]) {
  const ev: Ev[] = []; let t = 0
  const add = (e: any, d: number) => { ev.push({ ...e, at: t, dur: d }); t += d }
  add({ type: 'intro' }, 7000)
  for (const r of rs) {
    if (r.type === 'ring') {
      add({ type: 'round', k: r.k, bullets: r.bullets, extra: !!r.extra, alive: r.before }, 5500)
      for (let v = 0; v < r.voids; v++) add({ type: 'void', k: r.k }, 5000)
      // 依次开枪：从本轮活下来的一个人开始沿圈往回走 → 死人不开枪（与单人版 ringOrder 一致）
      const b = r.before, n = b.length, i0 = b.findIndex((x) => r.after.includes(x))
      const order = Array.from({ length: n }, (_, j) => b[(i0 - j + n * 2) % n])
      order.forEach((tg, j) => { const hit = r.dead.includes(tg); add({ type: 'shot', k: r.k, shooter: b[(b.indexOf(tg) - 1 + n) % n], target: tg, hit, ring: b }, hit ? 3400 : j < 3 ? 2000 : 1500) })
      add({ type: 'tally', k: r.k, dead: r.dead, after: r.after }, 2400)
    } else {
      const [a, bb] = r.pair!
      add({ type: 'duel', k: r.k, pair: r.pair, released: r.released || [] }, 5200)
      for (const sh of r.shots!) {
        add({ type: 'dload', d: sh.d, bullets: sh.bullets }, 4500)
        for (let v = 0; v < sh.voids; v++) add({ type: 'void', k: r.k }, 5000)
        let hit = false
        for (const tg of [bb, a]) { const h = sh.dead.includes(tg); add({ type: 'dshot', d: sh.d, shooter: tg === a ? bb : a, target: tg, hit: h }, h ? 3600 : 2000); if (h) { hit = true; break } }
        if (!hit) add({ type: 'dmiss', d: sh.d }, 1400)
      }
    }
  }
  const winner = rs[rs.length - 1].after[0]
  add({ type: 'winner', winner }, 6000)
  return { events: ev, total: t, winner }
}

// ─────────── 模拟玩家（前期填充；bot=1 明确标注；不进账本） ───────────
const BOT_NAMES = ['夜猫子', '老烟枪', '赌神本神', '小鹿乱撞', '阿乐', '不吃香菜', '北岛', '红桃K', '一把梭', '豆豆', '咸鱼翻身', '浪里白条', '小葵', '铁头', '月亮不睡', '二当家', '九命猫', '冷面', '大白鲨', '南风', '富贵', '橘子汽水', '老刀', '叶子', '花卷', '无名氏', '黑桃A', '阿彪粉丝', '摸鱼王', '小透明', '夜行者', '芒果', '石头', '闪电', '七号', '慢慢来', '听雨', '老实人', '冲冲冲', '路过']
const SEAT_LINES = ['这位置我坐定了', '{s}号，稳！', '活过三轮就行，别贪', '冠军是我的', '手心全是汗', '上把在这个位置活到最后', '谁都别看我', '来了来了']
const OUT_LINES = ['押{s}号，面相能活', '{s}号冲啊', '外围看戏，顺便赚点', '我赌{s}号拿冠军', '13号阿森每次都命硬', '稳一点，押活过三轮']
const HIT_LINES = ['我的{s}号……', '啊啊啊{s}号没了', '早知道不坐这', '{s}号走好', '这枪太准了']
const WIN_LINES = ['{s}号牛！！', '冠军！我押中了！', '赚翻了', '命硬', '就说他能活']
type Rnd = () => number
function rng(seedHex: string, salt: string): Rnd { // 确定性小随机（mulberry32），只用于模拟玩家的节奏，与剧情种子相互独立
  let h = 2166136261
  for (const ch of seedHex + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
}
const pickW = (r: Rnd, w: [string, number][]) => { let x = r() * w.reduce((a, b) => a + b[1], 0); for (const [k, v] of w) if ((x -= v) <= 0) return k; return w[0][0] }
function botPlan(room: any) {
  const r = rng(room.id, 'bots'), span = room.lock_at - room.created_at
  const nSeat = room.kind === 'public' ? 5 + Math.floor(r() * 5) : 2 + Math.floor(r() * 3)
  const nOut = room.kind === 'public' ? 4 + Math.floor(r() * 7) : 1 + Math.floor(r() * 3)
  const names = [...BOT_NAMES].sort(() => r() - 0.5)
  const plan: any[] = []
  for (let i = 0; i < nSeat + nOut; i++) {
    const role = i < nSeat ? 'seat' : 'out'
    plan.push({ i, role, uid: `bot:${room.id}:${i}`, nick: names[i % names.length], at: room.created_at + Math.floor(span * (0.05 + r() * 0.75)),
      seat: 1 + Math.floor(r() * 13), pick: pickW(r, role === 'seat' ? [['s3', 5], ['s4', 3], ['champ', 2]] : [['s3', 4], ['s4', 3], ['champ', 3]]),
      stake: D13.stakes[Math.floor(Math.pow(r(), 1.6) * D13.stakes.length)], say: r() < 0.55 ? Math.floor(r() * 100) : -1 })
  }
  return plan.sort((x, y) => x.at - y.at)
}
async function chat(env: Env, roomId: string, u: { id?: string | null; nick?: string | null; bot?: boolean }, text: string, kind = 'msg', at = now()) {
  await env.DB.prepare('INSERT INTO d13_chat (room_id,user_id,nickname,text,kind,bot,created_at) VALUES (?,?,?,?,?,?,?)').bind(roomId, u.id || null, u.nick || null, text.slice(0, 120), kind, u.bot ? 1 : 0, at).run()
}
async function botsJoin(env: Env, room: any) {
  const t = Math.min(now(), room.lock_at - 1500)
  const due = botPlan(room).filter((b) => b.at <= t)
  if (!due.length) return
  const have = new Set(((await env.DB.prepare('SELECT user_id FROM d13_entries WHERE room_id=? AND bot=1').bind(room.id).all()).results as any[]).map((x) => x.user_id))
  const todo = due.filter((b) => !have.has(b.uid)); if (!todo.length) return
  const taken = new Set(((await env.DB.prepare(`SELECT seat FROM d13_entries WHERE room_id=? AND role='seat'`).bind(room.id).all()).results as any[]).map((x) => x.seat))
  for (const b of todo) {
    let seat = b.seat
    if (b.role === 'seat') { let k = 0; while (taken.has(seat) && k++ < 13) seat = (seat % 13) + 1; if (taken.has(seat)) continue; taken.add(seat) }
    const odds = ODDS(b.role, b.pick)
    const ins = await env.DB.prepare(`INSERT OR IGNORE INTO d13_entries (room_id,user_id,nickname,role,seat,pick,stake,odds,bot,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)`).bind(room.id, b.uid, b.nick, b.role, seat, b.pick, b.stake, odds, b.at).run()
    if (!ins.meta.changes) continue
    if (b.say >= 0) { const L = b.role === 'seat' ? SEAT_LINES : OUT_LINES; await chat(env, room.id, { id: b.uid, nick: b.nick, bot: true }, L[b.say % L.length].replace('{s}', String(seat)), 'msg', b.at + 800) }
  }
}

// ─────────── 房间生命周期 ───────────
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => CODE_CH[x % CODE_CH.length]).join('')
async function createRoom(env: Env, o: { kind: 'public' | 'private'; host?: string | null; title?: string | null; code?: string | null; lockAt?: number }) {
  const id = uid('dr_'), seed = randomHex(32), commit = await sha256(`${seed}|${id}`), t = now()
  const lock = o.lockAt || t + (o.kind === 'private' ? D13.private_ms : D13.lobby_ms)
  await env.DB.prepare(`INSERT INTO d13_rooms (id,code,kind,host,title,status,seed,commit_hash,created_at,lock_at) VALUES (?,?,?,?,?,'waiting',?,?,?,?)`)
    .bind(id, o.code || null, o.kind, o.host || null, o.title || null, seed, commit, t, lock).run()
  return id
}
async function roomRow(env: Env, id: string) {
  const r: any = await env.DB.prepare('SELECT * FROM d13_rooms WHERE id=?').bind(id).first()
  if (!r) throw new GameError('ROOM_NOT_FOUND', '房间不存在')
  return r
}
/** 惰性推进：等待 → 开打（同时开出下一局）→ 结算 */
export async function tick(env: Env, id: string) {
  let r = await roomRow(env, id)
  if (r.status === 'waiting') {
    await botsJoin(env, r)
    if (now() >= r.lock_at) {
      const rs = await fullGame(r.seed), sc = buildSchedule(rs), start = now() + 2500, settle = start + sc.total
      const up = await env.DB.prepare(`UPDATE d13_rooms SET status='playing', outcome=?, schedule=?, winner=?, start_at=?, settle_at=? WHERE id=? AND status='waiting'`)
        .bind(JSON.stringify(rs), JSON.stringify(sc.events), sc.winner, start, settle, r.id).run()
      if (up.meta.changes) {
        const next = await createRoom(env, { kind: r.kind, host: r.host, title: r.title, code: r.code, lockAt: Math.max(now() + D13.lobby_ms, settle + D13.next_gap_ms) })
        await env.DB.prepare('UPDATE d13_rooms SET next_id=? WHERE id=?').bind(next, r.id).run()
        await chat(env, r.id, {}, `灯灭了。本局已锁定，commit ${r.commit_hash.slice(0, 16)}…（结束后公开种子可复算）`, 'sys')
        await botReactions(env, r, rs, sc.events, start)
      }
      r = await roomRow(env, id)
    }
  }
  if (r.status === 'playing' && now() >= r.settle_at) { await settle(env, r.id); r = await roomRow(env, id) }
  return r
}
async function botReactions(env: Env, room: any, rs: Round[], events: Ev[], start: number) {
  const bots = ((await env.DB.prepare('SELECT * FROM d13_entries WHERE room_id=? AND bot=1').bind(room.id).all()).results as any[])
  const rnd = rng(room.id, 'react'), { winner } = seatFates(rs)
  for (const e of events) {
    if ((e.type === 'shot' || e.type === 'dshot') && e.hit) {
      const fans = bots.filter((b) => b.seat === e.target); const b = fans[0]
      if (b && rnd() < 0.8) await chat(env, room.id, { id: b.user_id, nick: b.nickname, bot: true }, HIT_LINES[Math.floor(rnd() * HIT_LINES.length)].replace('{s}', String(e.target)), 'msg', start + e.at + 1500 + Math.floor(rnd() * 1500))
    }
  }
  const w = events[events.length - 1], fans = bots.filter((b) => b.seat === winner)
  for (const b of fans.slice(0, 3)) await chat(env, room.id, { id: b.user_id, nick: b.nickname, bot: true }, WIN_LINES[Math.floor(rnd() * WIN_LINES.length)].replace('{s}', String(winner)), 'msg', start + w.at + 1200 + Math.floor(rnd() * 2500))
}
async function settle(env: Env, id: string) {
  const up = await env.DB.prepare(`UPDATE d13_rooms SET status='ended', end_at=? WHERE id=? AND status='playing'`).bind(now(), id).run()
  if (!up.meta.changes) return
  const r = await roomRow(env, id), rs: Round[] = J(r.outcome, []), { winner, fates } = seatFates(rs)
  const es = (await env.DB.prepare('SELECT * FROM d13_entries WHERE room_id=?').bind(id).all()).results as any[]
  let real = 0, staked = 0, paid = 0, bonusPaid = 0
  for (const e of es) {
    const hit = hitOf(fates, e.seat, e.pick), pay = hit ? Math.floor(e.stake * e.odds) : 0
    let bonus = 0
    if (!e.bot) {
      real++; staked += e.stake
      if (pay) { await post(env, `致命13 房间 ${id} · ${e.role === 'seat' ? '入座' : '外围'} ${e.seat} 号 ${TLABEL(e.pick)} 命中`, id, [['platform:house', 'D', pay], [`user:${e.user_id}:available`, 'C', pay]]); paid += pay }
      if (e.role === 'seat' && e.seat === winner) {
        bonus = Math.max(0, Math.min(Math.floor((await poolBalance(env)) * D13.champ_share), e.stake * D13.champ_cap_mult))
        if (bonus) { await post(env, `致命13 房间 ${id} · 冠军座位奖池`, id, [[POOL, 'D', bonus], [`user:${e.user_id}:available`, 'C', bonus]]); bonusPaid += bonus }
      }
      if (pay + bonus) await env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(pay + bonus, e.user_id).run()
    }
    await env.DB.prepare('UPDATE d13_entries SET hit=?, payout=?, bonus=? WHERE id=?').bind(hit ? 1 : 0, pay, bonus, e.id).run()
  }
  const champ = es.find((e) => e.role === 'seat' && e.seat === winner)
  await env.DB.prepare('UPDATE d13_rooms SET stats=? WHERE id=?').bind(JSON.stringify({ real, staked, paid, bonus: bonusPaid, entries: es.length }), id).run()
  await chat(env, id, {}, `${winner} 号 ${PRISONERS[winner - 1].name} 活到了最后${champ ? `（座位主：${champ.nickname}${champ.bot ? ' · 模拟' : ''}）` : '（无人认领的座位）'}。种子已公开，可复算。`, 'sys')
}

// ─────────── 对外接口 ───────────
/** 公共厅：返回正在打的一局（可能没有）+ 正在等待下注的一局（总有） */
export async function lobby(env: Env, userId?: string) {
  await ensurePool(env)
  let live: any = await env.DB.prepare(`SELECT id FROM d13_rooms WHERE kind='public' AND status='playing' ORDER BY created_at DESC LIMIT 1`).first()
  if (live) { const r = await tick(env, live.id); if (r.status !== 'playing') live = null }
  let wait: any = await env.DB.prepare(`SELECT id FROM d13_rooms WHERE kind='public' AND status='waiting' ORDER BY created_at DESC LIMIT 1`).first()
  if (wait) { const r = await tick(env, wait.id); if (r.status === 'playing') { live = { id: r.id }; wait = r.next_id ? { id: r.next_id } : null } }
  if (!wait) wait = { id: await createRoom(env, { kind: 'public' }) }
  const recent = ((await env.DB.prepare(`SELECT id, winner, stats, end_at FROM d13_rooms WHERE kind='public' AND status='ended' ORDER BY end_at DESC LIMIT 6`).all()).results as any[])
    .map((x) => ({ id: x.id, winner: x.winner, name: PRISONERS[(x.winner || 1) - 1].name, ...J(x.stats, {}), end_at: x.end_at }))
  const mine = userId ? ((await env.DB.prepare(`SELECT id, code, title, status FROM d13_rooms WHERE kind='private' AND host=? AND status IN ('waiting','playing') ORDER BY created_at DESC LIMIT 3`).bind(userId).all()).results as any[]) : []
  const online: any = await env.DB.prepare(`SELECT COUNT(DISTINCT user_id) n FROM d13_entries WHERE created_at>?`).bind(now() - 10 * 60000).first()
  return { live: live?.id || null, next: wait.id, recent, mine, pool: await poolBalance(env), online: online?.n || 0, cfg: cfgPublic() }
}
export const cfgPublic = () => ({ seats: D13.seats, stakes: D13.stakes, targets: TARGETS.map((t) => ({ id: t.id, label: t.label, p: t.p, seat_odds: D13.seat_odds[t.id], out_odds: D13.out_odds[t.id] })), champ_share: D13.champ_share, champ_cap_mult: D13.champ_cap_mult, rake: D13.rake })

export async function createPrivate(env: Env, userId: string, title?: string) {
  await ensureUser(env, userId)
  const open: any = await env.DB.prepare(`SELECT COUNT(*) n FROM d13_rooms WHERE kind='private' AND host=? AND status IN ('waiting','playing')`).bind(userId).first()
  if ((open?.n || 0) >= 3) throw new GameError('TOO_MANY_ROOMS', '你同时开着的房间已达 3 个')
  let code = newCode()
  for (let i = 0; i < 5 && (await env.DB.prepare(`SELECT 1 FROM d13_rooms WHERE code=? AND status!='ended'`).bind(code).first()); i++) code = newCode()
  const id = await createRoom(env, { kind: 'private', host: userId, title: (title || '').slice(0, 20) || null, code })
  await chat(env, id, {}, `房间已创建，房号 ${code}。把链接发给朋友，大家各认一个座位，或者在外围押别人。`, 'sys')
  return { id, code }
}
/** 房号 → 当前该看的那一局（正在打的优先，否则等待中的） */
export async function byCode(env: Env, code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const rows = (await env.DB.prepare(`SELECT id, status FROM d13_rooms WHERE code=? ORDER BY created_at DESC LIMIT 3`).bind(c).all()).results as any[]
  if (!rows.length) throw new GameError('ROOM_NOT_FOUND', '房号不存在')
  for (const x of rows) await tick(env, x.id)
  const fresh = (await env.DB.prepare(`SELECT id, status FROM d13_rooms WHERE code=? ORDER BY created_at DESC LIMIT 3`).bind(c).all()).results as any[]
  return { id: (fresh.find((x) => x.status === 'playing') || fresh.find((x) => x.status === 'waiting') || fresh[0]).id, code: c }
}
export async function hostStart(env: Env, id: string, userId: string) {
  const r = await roomRow(env, id)
  if (r.kind !== 'private' || r.host !== userId) throw new GameError('NOT_HOST', '只有房主可以提前开局')
  if (r.status !== 'waiting') throw new GameError('ROOM_STARTED', '已经开局')
  await env.DB.prepare(`UPDATE d13_rooms SET lock_at=? WHERE id=? AND status='waiting' AND lock_at>?`).bind(now() + 3000, id, now() + 3000).run()
  await chat(env, id, {}, '房主喊了开局：3 秒后锁定下注。', 'sys')
  return { ok: true }
}

export async function join(env: Env, p: { roomId: string; userId: string; role: string; seat: number; pick: string; stake: number; ipHash: string; sybil?: boolean }) {
  const r = await tick(env, p.roomId)
  if (r.status !== 'waiting' || now() > r.lock_at - 1000) throw new GameError('LOCKED', '这一局已经锁定，下一局再来')
  const role = p.role === 'seat' ? 'seat' : p.role === 'out' ? 'out' : ''
  if (!role) throw new GameError('BAD_ROLE', '请选择：入座参赛 或 外围下注')
  const seat = Math.floor(+p.seat), stake = Math.floor(+p.stake)
  if (!(seat >= 1 && seat <= 13)) throw new GameError('BAD_SEAT', '座位号 1~13')
  if (!TARGETS.some((t) => t.id === p.pick)) throw new GameError('BAD_PICK', '只能押：活过 3 轮 / 活过 4 轮 / 拿冠军')
  if (!D13.stakes.includes(stake)) throw new GameError('BAD_STAKE', `注金只能是 ${D13.stakes.join(' / ')}`)
  const u: any = await ensureUser(env, p.userId)
  if (u.self_excluded) throw new GameError('SELF_EXCLUDED', '您已加入自我排除名单，仅可观战')
  if ((u.chips || 0) < stake) throw new GameError('INSUFFICIENT', `需要 ${stake} 筹码`)
  const ipN: any = await env.DB.prepare('SELECT COUNT(*) n FROM d13_entries WHERE room_id=? AND ip_hash=? AND bot=0').bind(r.id, p.ipHash).first()
  if ((ipN?.n || 0) >= D13.max_per_ip) { await riskEvent(env as any, p.userId, 'd13_multi_entry', 2, { room: r.id }); throw new GameError('MULTI_ENTRY', '同一网络在这一局的身份已达上限') }
  const odds = ODDS(role, p.pick)
  try {
    await env.DB.prepare(`INSERT INTO d13_entries (room_id,user_id,nickname,role,seat,pick,stake,odds,bot,ip_hash,created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)`)
      .bind(r.id, p.userId, u.nickname || '玩家', role, seat, p.pick, stake, odds, p.ipHash, now()).run()
  } catch (e: any) {
    const mine: any = await env.DB.prepare('SELECT 1 FROM d13_entries WHERE room_id=? AND user_id=?').bind(r.id, p.userId).first()
    if (mine) throw new GameError('ONE_ROLE', '每局只能以一个身份加入（入座 或 外围，二选一）')
    if (role === 'seat') { // 座位被模拟玩家占了：真人优先，把模拟玩家挪到外围
      const bot: any = await env.DB.prepare(`SELECT id, pick FROM d13_entries WHERE room_id=? AND role='seat' AND seat=? AND bot=1`).bind(r.id, seat).first()
      if (bot) { await env.DB.prepare(`UPDATE d13_entries SET role='out', odds=? WHERE id=?`).bind(ODDS('out', bot.pick), bot.id).run(); return join(env, p) }
      throw new GameError('SEAT_TAKEN', `${seat} 号座位已经有人了`)
    }
    throw new GameError('JOIN_FAILED', '加入失败，请重试')
  }
  const rake = Math.round(stake * D13.rake)
  await post(env, `致命13 房间 ${r.id} · ${role === 'seat' ? '入座' : '外围'} ${seat} 号 ${TLABEL(p.pick)}`, r.id, [[`user:${p.userId}:available`, 'D', stake], ['platform:house', 'C', stake - rake], [POOL, 'C', rake]])
  await env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=?').bind(stake, p.userId).run()
  await chat(env, r.id, { id: p.userId, nick: u.nickname }, role === 'seat' ? `坐进了 ${seat} 号（${PRISONERS[seat - 1].name}），押自己${TLABEL(p.pick)}` : `在外围押 ${seat} 号${TLABEL(p.pick)}`, 'join')
  const bal: any = await env.DB.prepare('SELECT chips FROM users WHERE id=?').bind(p.userId).first()
  return { ok: true, room_id: r.id, role, seat, pick: p.pick, stake, odds, win: Math.floor(stake * odds), balance: bal?.chips }
}

export async function say(env: Env, roomId: string, userId: string, text: string) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!t) throw new GameError('EMPTY', '说点什么')
  await roomRow(env, roomId)
  const u: any = await ensureUser(env, userId)
  await chat(env, roomId, { id: userId, nick: u.nickname }, t)
  return { ok: true }
}

const pubEntry = (e: any, me?: string) => ({ role: e.role, seat: e.seat, pick: e.pick, stake: e.stake, odds: e.odds, nick: e.nickname, bot: !!e.bot, mine: !!me && e.user_id === me, hit: e.hit == null ? null : !!e.hit, payout: e.payout, bonus: e.bonus })
/** 房间快照：只下发「已经播到」的时间线事件（+1.5 秒预读），结果不会提前泄露 */
export async function state(env: Env, id: string, userId?: string) {
  const r = await tick(env, id), t = now()
  const es = (await env.DB.prepare('SELECT * FROM d13_entries WHERE room_id=? ORDER BY created_at').bind(id).all()).results as any[]
  const seats = PRISONERS.map((p) => { const e = es.find((x) => x.role === 'seat' && x.seat === p.id); return { seat: p.id, name: p.name, user: e ? pubEntry(e, userId) : null } })
  const outs = es.filter((x) => x.role === 'out')
  const me = userId ? es.find((x) => x.user_id === userId) : null
  const out: any = {
    server_time: t,
    room: { id: r.id, code: r.code, kind: r.kind, title: r.title, status: r.status, lock_at: r.lock_at, start_at: r.start_at, settle_at: r.settle_at, end_at: r.end_at, commit: r.commit_hash, next_id: r.next_id, is_host: !!userId && r.host === userId },
    seats, outs: { n: outs.length, total: outs.reduce((a, x) => a + x.stake, 0), list: outs.slice(-14).map((x) => pubEntry(x, userId)), by_seat: Object.fromEntries(PRISONERS.map((p) => [p.id, outs.filter((x) => x.seat === p.id).length])) },
    me: me ? pubEntry(me, userId) : null,
    // 模拟玩家的反应是开局时预写入、带未来时间戳的 → 按时间取「已到点」的最近 40 条，前端按 id 去重
    chat: ((await env.DB.prepare('SELECT id, nickname, text, kind, bot, created_at FROM d13_chat WHERE room_id=? AND created_at<=? ORDER BY created_at DESC, id DESC LIMIT 40').bind(id, t).all()).results as any[]).reverse()
  }
  if (r.status === 'playing' || r.status === 'ended') {
    const ev: Ev[] = J(r.schedule, []), el = t - r.start_at
    out.events = r.status === 'ended' ? ev : ev.filter((e) => e.at <= el + 1500)
    out.total = ev.length ? ev[ev.length - 1].at + ev[ev.length - 1].dur : 0
  }
  if (r.status === 'ended') {
    const { winner, fates } = seatFates(J(r.outcome, []))
    out.result = { winner, fates, seed: r.seed, commit: r.commit_hash, stats: J(r.stats, {}) }
  }
  if ((r.status === 'playing' || r.status === 'ended') && r.next_id) { // 本局开打后（含刚结束），下一局已开放下注：一并下发，方便边看边押
    const n = await tick(env, r.next_id)
    const ne = (await env.DB.prepare('SELECT * FROM d13_entries WHERE room_id=?').bind(n.id).all()).results as any[]
    out.next = { id: n.id, status: n.status, lock_at: n.lock_at, taken: ne.filter((x) => x.role === 'seat').map((x) => ({ seat: x.seat, nick: x.nickname, bot: !!x.bot })), n: ne.length, me: userId ? (ne.find((x) => x.user_id === userId) ? pubEntry(ne.find((x) => x.user_id === userId), userId) : null) : null }
  }
  return out
}

export async function verify(env: Env, id: string) {
  const r = await roomRow(env, id)
  if (r.status !== 'ended') return { room_id: id, commit: r.commit_hash, note: '本局未结束，种子保密' }
  const rs = await fullGame(r.seed)
  return { room_id: id, seed: r.seed, commit: r.commit_hash, ok: (await sha256(`${r.seed}|${id}`)) === r.commit_hash, same_outcome: JSON.stringify(rs) === r.outcome, winner: rs[rs.length - 1].after[0], fates: seatFates(rs).fates }
}

export async function media(env: any, userId: string) {
  const r: any = await env.DB.prepare(`SELECT data FROM thrill_series WHERE id='l13_media'`).first()
  if (!r) return null
  const clips: Record<string, number> = J(r.data, {}).clips || {}, out: Record<string, { url: string; dur: number }> = {}
  for (const [k, dur] of Object.entries(clips)) out[k] = { url: await mediaTicket(env, userId, 'l13_deadly13', k, 40 * 60000), dur }
  return { clips: out, faces: PRISONERS.map((p) => `/gimg/l13_deadly13/p${p.id}.webp`), cover: '/gimg/l13_deadly13/cover.webp' }
}
export async function history(env: Env, userId: string) {
  const rows = (await env.DB.prepare(`SELECT e.*, r.winner, r.status FROM d13_entries e JOIN d13_rooms r ON r.id=e.room_id WHERE e.user_id=? ORDER BY e.created_at DESC LIMIT 20`).bind(userId).all()).results as any[]
  return rows.map((e) => ({ room_id: e.room_id, ...pubEntry(e, userId), winner: e.winner, status: e.status, at: e.created_at }))
}
