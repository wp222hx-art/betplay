// Studio 独立登录：邮箱 + 密码（PBKDF2）→ HttpOnly 会话 Cookie（库里只存 token 的 SHA-256）；角色 admin / writer / reviewer
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { hashPassword, rand, sha256, uid, verifyPassword } from './sec'

export type Role = 'admin' | 'writer' | 'reviewer'
export type Env = { DB: D1Database; MEDIA?: R2Bucket; STUDIO_MASTER_KEY?: string; STUDIO_BOOTSTRAP_TOKEN?: string; [k: string]: any }
export type User = { id: string; email: string; name: string; role: Role }
export class HttpError extends Error { constructor(public status: number, public code: string, msg: string, public extra?: any) { super(msg) } }

const COOKIE = 'momo_studio'
const TTL = 7 * 24 * 3600 * 1000
const now = () => Date.now()
export const RANK: Record<Role, number> = { reviewer: 1, writer: 2, admin: 3 }

export async function audit(env: Env, user: string | null, action: string, target = '', detail: any = null, ip = '') {
  await env.DB.prepare('INSERT INTO st_audit (user_id,action,target,detail,ip,created_at) VALUES (?,?,?,?,?,?)').bind(user, action, target, detail ? JSON.stringify(detail).slice(0, 2000) : null, ip, now()).run()
}
const ipOf = (c: Context) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'

/** 登录限流：同 IP 或同邮箱 15 分钟内失败 ≥ 8 次即锁定 */
async function tooMany(env: Env, ip: string, email: string) {
  const r: any = await env.DB.prepare(`SELECT COUNT(*) n FROM st_audit WHERE action='login_fail' AND created_at>? AND (ip=? OR target=?)`).bind(now() - 15 * 60000, ip, email).first()
  return (r?.n || 0) >= 8
}

export async function userCount(env: Env) { return ((await env.DB.prepare('SELECT COUNT(*) n FROM st_users').first()) as any).n as number }

/** 首个管理员：库里没有任何账号时才允许；若配置了 STUDIO_BOOTSTRAP_TOKEN 则必须携带 */
export async function bootstrap(env: Env, c: Context, b: any) {
  if ((await userCount(env)) > 0) throw new HttpError(409, 'ALREADY_INITIALIZED', '已初始化，请使用管理员账号登录')
  if (env.STUDIO_BOOTSTRAP_TOKEN && b.token !== env.STUDIO_BOOTSTRAP_TOKEN) throw new HttpError(403, 'BAD_BOOTSTRAP_TOKEN', '初始化口令错误')
  const u = await createUser(env, { email: b.email, name: b.name || '管理员', role: 'admin', password: b.password })
  await audit(env, u.id, 'bootstrap', u.email, null, ipOf(c))
  return login(env, c, { email: b.email, password: b.password })
}

export async function createUser(env: Env, p: { email: string; name?: string; role: Role; password: string }) {
  const email = String(p.email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'BAD_EMAIL', '邮箱格式不正确')
  if (String(p.password || '').length < 10) throw new HttpError(400, 'WEAK_PASSWORD', '密码至少 10 位')
  if (!RANK[p.role]) throw new HttpError(400, 'BAD_ROLE', '角色无效')
  const { hash, salt } = await hashPassword(p.password)
  const id = uid('u_')
  try { await env.DB.prepare('INSERT INTO st_users (id,email,name,role,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, email, p.name || email.split('@')[0], p.role, hash, salt, now()).run() }
  catch { throw new HttpError(409, 'EMAIL_TAKEN', '该邮箱已存在') }
  return { id, email, name: p.name || email.split('@')[0], role: p.role }
}

export async function login(env: Env, c: Context, b: any) {
  const email = String(b.email || '').trim().toLowerCase(), ip = ipOf(c)
  if (await tooMany(env, ip, email)) throw new HttpError(429, 'LOCKED', '登录失败次数过多，请 15 分钟后再试')
  const u: any = await env.DB.prepare('SELECT * FROM st_users WHERE email=?').bind(email).first()
  // 用户不存在也执行一次哈希，避免通过耗时枚举邮箱
  const ok = u && !u.disabled ? await verifyPassword(String(b.password || ''), u.pw_hash, u.pw_salt) : (await hashPassword('x'), false)
  if (!ok) { await audit(env, null, 'login_fail', email, null, ip); throw new HttpError(401, 'BAD_CREDENTIALS', '邮箱或密码错误') }
  const token = rand(32)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO st_sessions (token_hash,user_id,expires_at,created_at,ip,ua) VALUES (?,?,?,?,?,?)').bind(await sha256(token), u.id, now() + TTL, now(), ip, (c.req.header('user-agent') || '').slice(0, 200)),
    env.DB.prepare('UPDATE st_users SET last_login=? WHERE id=?').bind(now(), u.id),
    env.DB.prepare('DELETE FROM st_sessions WHERE expires_at<?').bind(now())
  ])
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: TTL / 1000 })
  await audit(env, u.id, 'login', email, null, ip)
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role } }
}

export async function logout(env: Env, c: Context) {
  const t = getCookie(c, COOKIE)
  if (t) await env.DB.prepare('DELETE FROM st_sessions WHERE token_hash=?').bind(await sha256(t)).run()
  deleteCookie(c, COOKIE, { path: '/' })
  return { ok: true }
}

export async function currentUser(env: Env, c: Context): Promise<User | null> {
  const t = getCookie(c, COOKIE); if (!t) return null
  const r: any = await env.DB.prepare('SELECT u.id,u.email,u.name,u.role,u.disabled,s.expires_at FROM st_sessions s JOIN st_users u ON u.id=s.user_id WHERE s.token_hash=?').bind(await sha256(t)).first()
  if (!r || r.disabled || r.expires_at < now()) return null
  return { id: r.id, email: r.email, name: r.name, role: r.role }
}

/** 路由守卫：未登录 401；角色不足 403；写操作要求同源（防 CSRF，Cookie 已 SameSite=Strict，双保险） */
export const requireRole = (min: Role): MiddlewareHandler<{ Bindings: Env; Variables: { user: User } }> => async (c, next) => {
  const u = await currentUser(c.env, c)
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录')
  if (RANK[u.role] < RANK[min]) throw new HttpError(403, 'FORBIDDEN', `需要 ${min} 及以上权限`)
  if (c.req.method !== 'GET') {
    const o = c.req.header('origin'); if (o && new URL(o).host !== new URL(c.req.url).host) throw new HttpError(403, 'BAD_ORIGIN', '跨站请求被拒绝')
  }
  c.set('user', u); await next()
}
/** 审批权限：只有审核或管理员可放行（编剧不能给自己的产出盖章——生产与审核职责分离） */
export const requireApprover: MiddlewareHandler<{ Bindings: Env; Variables: { user: User } }> = async (c, next) => {
  const u = await currentUser(c.env, c)
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录')
  if (u.role !== 'reviewer' && u.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '仅审核或管理员可审批')
  if (c.req.method !== 'GET') { const o = c.req.header('origin'); if (o && new URL(o).host !== new URL(c.req.url).host) throw new HttpError(403, 'BAD_ORIGIN', '跨站请求被拒绝') }
  c.set('user', u); await next()
}
export { ipOf }
