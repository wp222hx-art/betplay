// Studio 安全基元：PBKDF2 密码、会话令牌、AES-GCM 密钥加密（Web Crypto，Workers 原生）
const enc = new TextEncoder(), dec = new TextDecoder()
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
export const unhex = (h: string) => new Uint8Array((h.match(/.{2}/g) || []).map((x) => parseInt(x, 16)))
export const rand = (n = 32) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a) }
export const uid = (p = '') => p + rand(6)
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

const PBKDF2_ITER = 100000 // Workers 上限 100k
export async function hashPassword(pw: string, saltHex = rand(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: PBKDF2_ITER }, key, 256)
  return { hash: hex(bits), salt: saltHex }
}
/** 常量时间比较 */
export function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
export async function verifyPassword(pw: string, hashHex: string, saltHex: string) {
  return safeEq((await hashPassword(pw, saltHex)).hash, hashHex)
}

// ── Key 加密：主密钥来自环境变量 STUDIO_MASTER_KEY（任意长字符串 → SHA-256 派生 AES-256）──
async function masterKey(master: string) {
  if (!master || master.length < 16) throw new Error('STUDIO_MASTER_KEY 未配置或过短（≥16 字符）')
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('momo-studio:' + master))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(master: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await masterKey(master), enc.encode(plain))
  return { enc: hex(ct), iv: hex(iv) }
}
export async function unseal(master: string, encHex: string, ivHex: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(ivHex) }, await masterKey(master), unhex(encHex))
  return dec.decode(pt)
}
/** 只展示前 3 + 后 4 位 */
export const hint = (k: string) => (k.length <= 10 ? '•'.repeat(k.length) : `${k.slice(0, 3)}••••${k.slice(-4)}`)
