// Fair 服务：HSM 替身（Web Crypto） —— 种子、HMAC 承诺、AES-GCM 加密分片
const enc = new TextEncoder()

export const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return toHex(a)
}

export function uid(prefix = '') {
  return prefix + randomHex(6)
}

export async function sha256(s: string) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

export async function hmac(keyHex: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

/** 由种子派生 [0,1) 均匀数 —— 可被玩家用公开种子复算 */
export async function seedFloat(seedHex: string, label: string) {
  const h = await hmac(seedHex, label)
  return parseInt(h.slice(0, 13), 16) / 2 ** 52
}

/** 承诺 = HMAC-SHA256(seed, roundId|outcomeId|variantId) */
export async function makeCommit(seed: string, roundId: string, outcomeId: string, variantId: string) {
  return hmac(seed, `${roundId}|${outcomeId}|${variantId}`)
}

/** AES-GCM 加密：生成-播放分离，客户端只拿密文，REVEAL 才下发密钥 */
export async function encryptSlot(plain: string, padTo = 4096) {
  const keyRaw = new Uint8Array(32)
  crypto.getRandomValues(keyRaw)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt'])
  // 填充对齐（按字节）：所有分片密文长度一致，抓包无差异
  const raw = enc.encode(plain)
  const size = Math.max(padTo, raw.length)
  const buf = new Uint8Array(size).fill(0x20)
  buf.set(raw)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf)
  return { key: b64(keyRaw), iv: b64(iv), ct: b64(new Uint8Array(ct)) }
}
