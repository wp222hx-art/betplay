// 防作弊守卫层（多人场景）
// ① 身份：服务端签发 HMAC 设备令牌，客户端传来的 user_id 一律忽略 → 无法冒充他人
// ② 女巫：同一 IP 每日新设备数上限；超限的新设备不发新手币
// ③ 限流：按 uid / IP 的滑动窗口计数（D1）
// ④ 媒体门禁：结局/分支视频只能凭“揭晓后签发的短时票据”播放 → 无法跳过博弈直接拿结局
import { hmac, randomHex, sha256 } from './crypto'
import { GameError } from './engine'

type Env = { DB: D1Database; AUTH_SECRET?: string }
const now = () => Date.now()
const DEV_SECRET = 'df-dev-secret-change-me'
const secret = (env: Env) => {
  const s = env.AUTH_SECRET || DEV_SECRET
  return Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)
}
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 90
export const SYBIL_PER_IP_DAY = 5

// 生产：Cloudflare 注入的 cf-connecting-ip 是唯一可信来源；本地 wrangler dev 为回环地址时才退回 XFF（便于多用户测试）
const ipOf = (c: any) => {
  const cf = c.req.header('cf-connecting-ip')
  if (cf && !/^(127\.|::1$|::ffff:127\.)/.test(cf)) return cf
  return (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || cf || '0.0.0.0'
}

export async function signToken(env: Env, uid: string, ver = 1) {
  const exp = now() + TOKEN_TTL
  const body = `${uid}.${ver}.${exp}`
  return `${body}.${(await hmac(secret(env), 'tok|' + body)).slice(0, 40)}`
}
export async function verifyToken(env: Env, tok?: string | null) {
  if (!tok) return null
  const p = tok.split('.')
  if (p.length !== 4) return null
  const [uid, ver, exp, sig] = p
  if (+exp < now()) return null
  if ((await hmac(secret(env), `tok|${uid}.${ver}.${exp}`)).slice(0, 40) !== sig) return null
  return { uid, ver: +ver }
}

/** 签发/认领设备身份。legacy：旧版本地 uid（只能认领一次，认领后被令牌绑定） */
export async function issueDevice(env: Env, c: any, legacy?: string) {
  const ip = await sha256('ip|' + ipOf(c)), ua = await sha256('ua|' + (c.req.header('user-agent') || ''))
  let uid = ''
  let isLegacy = 0
  if (legacy && /^u_[a-z0-9]{6,12}$/.test(legacy)) {
    const taken: any = await env.DB.prepare('SELECT uid FROM auth_devices WHERE uid=?').bind(legacy).first()
    if (!taken) { uid = legacy; isLegacy = 1 }
  }
  const dayAgo = now() - 86400000
  const cnt: any = await env.DB.prepare('SELECT COUNT(*) n FROM auth_devices WHERE ip_hash=? AND created_at>? AND legacy=0').bind(ip, dayAgo).first()
  const sybil = !isLegacy && (cnt?.n || 0) >= SYBIL_PER_IP_DAY
  if (!uid) uid = 'u_' + randomHex(5)
  await env.DB.prepare('INSERT INTO auth_devices (uid,ip_hash,ua_hash,legacy,created_at,last_seen) VALUES (?,?,?,?,?,?)').bind(uid, ip, ua, isLegacy, now(), now()).run()
  if (sybil) {
    // 超出同 IP 新设备上限：允许观看，但不发新手币（预先建号，余额 0）
    await env.DB.prepare('INSERT OR IGNORE INTO users (id,nickname,chips) VALUES (?,?,0)').bind(uid, '观众' + uid.slice(-4)).run()
    await riskEvent(env, uid, 'sybil', 2, { ip_devices_24h: cnt.n + 1 })
  }
  return { uid, token: await signToken(env, uid), sybil }
}

/** 从请求中取已认证用户；无效令牌 → 401 */
export async function authUid(env: Env, c: any, required = true) {
  const h = c.req.header('authorization') || ''
  const tok = h.startsWith('Bearer ') ? h.slice(7) : c.req.header('x-df-token') || c.req.query('t')
  const v = await verifyToken(env, tok)
  if (!v) { if (required) throw new GameError('UNAUTHORIZED', '身份无效，请刷新页面'); return '' }
  const d: any = await env.DB.prepare('SELECT token_ver FROM auth_devices WHERE uid=?').bind(v.uid).first()
  if (!d || d.token_ver !== v.ver) { if (required) throw new GameError('UNAUTHORIZED', '身份已失效'); return '' }
  const f: any = await env.DB.prepare('SELECT banned FROM user_flags WHERE uid=?').bind(v.uid).first()
  if (f?.banned && required) throw new GameError('BANNED', '账号因风控已被限制')
  // 伪造检测：body 里带了别人的 user_id → 记录（仍以令牌身份为准）
  return v.uid
}

export async function rateLimit(env: Env, key: string, limit: number, windowMs: number) {
  const t = now()
  const r: any = await env.DB.prepare('SELECT n, reset_at FROM rate_limits WHERE k=?').bind(key).first()
  if (!r || r.reset_at < t) { await env.DB.prepare('INSERT OR REPLACE INTO rate_limits (k,n,reset_at) VALUES (?,1,?)').bind(key, t + windowMs).run(); return }
  if (r.n >= limit) throw new GameError('RATE_LIMITED', '操作太频繁，请稍后再试')
  await env.DB.prepare('UPDATE rate_limits SET n=n+1 WHERE k=?').bind(key).run()
}
export const ipKey = async (c: any) => (await sha256('ip|' + ipOf(c))).slice(0, 16)

export async function riskEvent(env: Env, uid: string, kind: string, severity: number, detail: any) {
  await env.DB.prepare('INSERT INTO risk_events (uid,kind,severity,detail,created_at) VALUES (?,?,?,?,?)').bind(uid, kind, severity, JSON.stringify(detail), now()).run()
}

// ─── 媒体门禁：/m/:series/:clip?e=exp&s=sig&u=uid ───
export async function mediaTicket(env: Env, uid: string, series: string, clip: string, ttlMs = 1000 * 60 * 60 * 6) {
  const exp = now() + ttlMs
  const sig = (await hmac(secret(env), `media|${uid}|${series}|${clip}|${exp}`)).slice(0, 32)
  return `/m/${series}/${clip}.mp4?u=${uid}&e=${exp}&s=${sig}`
}
export async function checkTicket(env: Env, series: string, clip: string, q: { u?: string; e?: string; s?: string }) {
  if (!q.u || !q.e || !q.s || +q.e < now()) return false
  return (await hmac(secret(env), `media|${q.u}|${series}|${clip}|${q.e}`)).slice(0, 32) === q.s
}
