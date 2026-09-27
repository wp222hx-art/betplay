// 结局卡交易所
// · 铸造：只在服务端判定通关时发生（advance → mintCard），run_id 唯一 → 无法伪造/重复铸造
// · 稀有度：由“结局全服出现率 + 是否隐藏 + 是否走过时间裂隙”决定
// · 交易：挂单 → 购买（原子 CAS），平台手续费 5% 进复式账本；卡片与筹码同一事务内过户
// · 防作弊：持有冷却 1h（防刷卡）· 限价带（地板价 0.3×~10× 参考价）· 同 IP / 互刷环检测 · 每日成交上限
// · 观看路径：持卡人可凭卡重播完整路径（片段 → 媒体票据），这是“收藏”真正的价值
import { sha256, uid } from '../core/crypto'
import { ensureUser, GameError, post } from '../core/engine'
import { mediaTicket, riskEvent } from '../core/guard'

type Env = { DB: D1Database; AUTH_SECRET?: string }
const now = () => Date.now()
export const FEE = 0.05
export const HOLD_MS = 60 * 60 * 1000
export const DAILY_TRADES = 20
const BASE: Record<string, number> = { R: 80, SR: 200, SSR: 600, UR: 1800 }

export async function rarityOf(env: Env, series: string, ending: string, twist: boolean, forked: boolean) {
  const tot: any = await env.DB.prepare(`SELECT COUNT(*) n FROM comic_runs WHERE series_id=? AND status='ended'`).bind(series).first()
  const hit: any = await env.DB.prepare(`SELECT COUNT(*) n FROM comic_runs WHERE series_id=? AND status='ended' AND ending_id=?`).bind(series, ending).first()
  const share = tot.n > 20 ? hit.n / tot.n : 0.1
  let score = share < 0.02 ? 3 : share < 0.05 ? 2 : share < 0.12 ? 1 : 0
  if (twist) score++
  if (forked) score++
  return (['R', 'SR', 'SSR', 'UR'] as const)[Math.min(3, score)]
}

export async function mintCard(env: Env, p: { series: string; ending: string; owner: string; run: string; path: any[]; playlist: string[]; twist: boolean; rewinds: number; tier?: any }) {
  const forked = p.path.some((x) => x.fork)
  const base = await rarityOf(env, p.series, p.ending, p.twist, forked)
  const order = ['R', 'SR', 'SSR', 'UR']
  const rarity = order[Math.min(3, order.indexOf(base) + (p.tier?.rarity || 0))] as string  // 命运等级升阶
  const ser: any = await env.DB.prepare('SELECT COUNT(*) n FROM ending_cards WHERE series_id=? AND ending_id=?').bind(p.series, p.ending).first()
  const id = 'card_' + (await sha256(p.run + p.ending)).slice(0, 12)
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO ending_cards (id,series_id,ending_id,serial,rarity,owner_id,minter_id,run_id,path,playlist,forked,locked_until,minted_at,tier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, p.series, p.ending, (ser.n || 0) + 1, rarity, p.owner, p.owner, p.run, JSON.stringify(p.path), JSON.stringify(p.playlist), forked ? 1 : 0, now() + HOLD_MS, now(), p.tier?.id || null).run()
  if (!r.meta.changes) return null
  return { id, rarity, serial: (ser.n || 0) + 1, forked, tier: p.tier?.id || null, ref_price: Math.round(BASE[rarity] * ({ gold: 1.2, platinum: 1.5, diamond: 2 } as any)[p.tier?.id] || BASE[rarity]) }
}

const rowToCard = (c: any, titles: (s: string, e: string) => any) => ({ ...c, path: JSON.parse(c.path), playlist: JSON.parse(c.playlist), ...titles(c.series_id, c.ending_id), ref_price: BASE[c.rarity] })

export async function myCards(env: Env, owner: string, titles: any) {
  const rows = (await env.DB.prepare(`SELECT c.*, l.id listing_id, l.price FROM ending_cards c LEFT JOIN card_listings l ON l.card_id=c.id AND l.status='open' WHERE c.owner_id=? ORDER BY c.minted_at DESC LIMIT 200`).bind(owner).all()).results as any[]
  return rows.map((c) => rowToCard(c, titles))
}

async function floorOf(env: Env, series: string, ending: string, rarity: string) {
  const last: any = await env.DB.prepare(`SELECT AVG(price) p FROM (SELECT t.price FROM card_trades t JOIN ending_cards c ON c.id=t.card_id WHERE c.series_id=? AND c.ending_id=? ORDER BY t.created_at DESC LIMIT 10)`).bind(series, ending).first()
  return Math.round(last?.p || BASE[rarity])
}

export async function listCard(env: Env, p: { owner: string; card: string; price: number }) {
  const c: any = await env.DB.prepare('SELECT * FROM ending_cards WHERE id=?').bind(p.card).first()
  if (!c || c.owner_id !== p.owner) throw new GameError('NOT_OWNER', '这张卡不属于你')
  if (c.locked_until > now()) throw new GameError('HOLD', `新卡冷却中，${Math.ceil((c.locked_until - now()) / 60000)} 分钟后可挂单`)
  const ref = await floorOf(env, c.series_id, c.ending_id, c.rarity)
  const price = Math.floor(p.price)
  if (!(price >= Math.ceil(ref * 0.3) && price <= ref * 10)) {
    await riskEvent(env, p.owner, 'price_band', 1, { card: c.id, price, ref })
    throw new GameError('PRICE_BAND', `价格需在 ${Math.ceil(ref * 0.3)} ~ ${ref * 10} 之间（参考价 ${ref}）`)
  }
  const id = uid('lst_')
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO card_listings (id,card_id,seller_id,price,created_at) VALUES (?,?,?,?,?)`).bind(id, c.id, p.owner, price, now()),
      env.DB.prepare(`UPDATE ending_cards SET status='listed' WHERE id=? AND owner_id=?`).bind(c.id, p.owner)
    ])
  } catch { throw new GameError('LISTED', '已在挂单中') }
  return { listing_id: id, price, ref }
}

export async function cancelListing(env: Env, p: { owner: string; listing: string }) {
  const r = await env.DB.prepare(`UPDATE card_listings SET status='cancelled', closed_at=? WHERE id=? AND seller_id=? AND status='open'`).bind(now(), p.listing, p.owner).run()
  if (!r.meta.changes) throw new GameError('NOT_OPEN', '挂单不存在或已成交')
  const l: any = await env.DB.prepare('SELECT card_id FROM card_listings WHERE id=?').bind(p.listing).first()
  await env.DB.prepare(`UPDATE ending_cards SET status='held' WHERE id=?`).bind(l.card_id).run()
  return { ok: true }
}

export async function buyListing(env: Env, p: { buyer: string; listing: string; ipHash: string }) {
  const l: any = await env.DB.prepare(`SELECT * FROM card_listings WHERE id=? AND status='open'`).bind(p.listing).first()
  if (!l) throw new GameError('NOT_OPEN', '挂单已失效')
  if (l.seller_id === p.buyer) throw new GameError('SELF_TRADE', '不能购买自己的卡')
  // ── 洗售检测 ──
  const sellerDev: any = await env.DB.prepare('SELECT ip_hash FROM auth_devices WHERE uid=?').bind(l.seller_id).first()
  const buyerDev: any = await env.DB.prepare('SELECT ip_hash FROM auth_devices WHERE uid=?').bind(p.buyer).first()
  if (sellerDev?.ip_hash && sellerDev.ip_hash === buyerDev?.ip_hash) {
    await riskEvent(env, p.buyer, 'wash_trade', 3, { reason: 'same_ip', seller: l.seller_id, listing: l.id })
    throw new GameError('WASH_TRADE', '风控拦截：买卖双方为同一网络环境')
  }
  const loop: any = await env.DB.prepare(`SELECT COUNT(*) n FROM card_trades WHERE seller_id=? AND buyer_id=? AND created_at>?`).bind(p.buyer, l.seller_id, now() - 7 * 86400000).first()
  if (loop.n >= 2) {
    await riskEvent(env, p.buyer, 'wash_trade', 3, { reason: 'ring', seller: l.seller_id })
    throw new GameError('WASH_TRADE', '风控拦截：检测到双方互刷交易')
  }
  const today: any = await env.DB.prepare(`SELECT COUNT(*) n FROM card_trades WHERE buyer_id=? AND created_at>?`).bind(p.buyer, now() - 86400000).first()
  if (today.n >= DAILY_TRADES) throw new GameError('DAILY_LIMIT', `每日最多成交 ${DAILY_TRADES} 笔`)
  const u: any = await ensureUser(env as any, p.buyer)
  if (u.chips < l.price) throw new GameError('INSUFFICIENT', '心动值不足')
  // ── 原子成交：挂单 CAS → 扣款(余额足够才生效) → 过户 ──
  const fee = Math.ceil(l.price * FEE), net = l.price - fee
  const cas = await env.DB.prepare(`UPDATE card_listings SET status='sold', buyer_id=?, closed_at=? WHERE id=? AND status='open'`).bind(p.buyer, now(), l.id).run()
  if (!cas.meta.changes) throw new GameError('NOT_OPEN', '被别人抢先买走了')
  const pay = await env.DB.prepare('UPDATE users SET chips=chips-? WHERE id=? AND chips>=?').bind(l.price, p.buyer, l.price).run()
  if (!pay.meta.changes) { await env.DB.prepare(`UPDATE card_listings SET status='open', buyer_id=NULL, closed_at=NULL WHERE id=?`).bind(l.id).run(); throw new GameError('INSUFFICIENT', '心动值不足') }
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chips=chips+? WHERE id=?').bind(net, l.seller_id),
    env.DB.prepare(`UPDATE ending_cards SET owner_id=?, status='held', locked_until=? WHERE id=?`).bind(p.buyer, now() + HOLD_MS, l.card_id),
    env.DB.prepare('INSERT INTO card_trades (id,card_id,listing_id,seller_id,buyer_id,price,fee,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(uid('trd_'), l.card_id, l.id, l.seller_id, p.buyer, l.price, fee, now())
  ])
  await post(env, '结局卡成交', l.id, [[`user:${p.buyer}:available`, 'D', l.price], [`user:${l.seller_id}:available`, 'C', net], ['platform:market_fee', 'C', fee]])
  return { ok: true, card_id: l.card_id, price: l.price, fee, balance: u.chips - l.price }
}

export async function market(env: Env, titles: any, q: { series?: string; rarity?: string; sort?: string }) {
  const where = [`l.status='open'`], args: any[] = []
  if (q.series) { where.push('c.series_id=?'); args.push(q.series) }
  if (q.rarity) { where.push('c.rarity=?'); args.push(q.rarity) }
  const ord = q.sort === 'price_asc' ? 'l.price ASC' : q.sort === 'price_desc' ? 'l.price DESC' : 'l.created_at DESC'
  const rows = (await env.DB.prepare(`SELECT l.id listing_id, l.price, l.seller_id, l.created_at listed_at, c.* FROM card_listings l JOIN ending_cards c ON c.id=l.card_id WHERE ${where.join(' AND ')} ORDER BY ${ord} LIMIT 100`).bind(...args).all()).results as any[]
  const stats: any = await env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price),0) vol, COALESCE(SUM(fee),0) fee FROM card_trades WHERE created_at>?`).bind(now() - 86400000).first()
  const recent = (await env.DB.prepare(`SELECT t.price, t.created_at, c.series_id, c.ending_id, c.rarity FROM card_trades t JOIN ending_cards c ON c.id=t.card_id ORDER BY t.created_at DESC LIMIT 12`).all()).results as any[]
  const minted: any = await env.DB.prepare('SELECT COUNT(*) n FROM ending_cards').first()
  return {
    listings: rows.map((c) => { const x = rowToCard(c, titles); delete x.playlist; x.path = x.path.map((p: any) => p.label); return x }),
    stats: { trades_24h: stats.n, volume_24h: stats.vol, fee_24h: stats.fee, minted: minted.n },
    recent: recent.map((r) => ({ ...r, ...titles(r.series_id, r.ending_id) })), fee_rate: FEE, hold_min: HOLD_MS / 60000
  }
}

export async function cardDetail(env: Env, id: string, titles: any) {
  const c: any = await env.DB.prepare(`SELECT c.*, l.id listing_id, l.price FROM ending_cards c LEFT JOIN card_listings l ON l.card_id=c.id AND l.status='open' WHERE c.id=?`).bind(id).first()
  if (!c) throw new GameError('NOT_FOUND', '卡片不存在')
  const hist = (await env.DB.prepare('SELECT price, fee, created_at FROM card_trades WHERE card_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all()).results
  const x = rowToCard(c, titles); delete x.playlist; x.path = x.path.map((p: any) => ({ label: p.label, q: p.q, fork: !!p.fork, twist: !!p.twist }))
  return { ...x, history: hist, ref_price: await floorOf(env, c.series_id, c.ending_id, c.rarity) }
}

/** 完整观看路径：只有持卡人可取；逐段签发媒体票据 */
export async function watchPath(env: Env, p: { owner: string; card: string; segs: (series: string) => Record<string, any> }) {
  const c: any = await env.DB.prepare('SELECT * FROM ending_cards WHERE id=?').bind(p.card).first()
  if (!c) throw new GameError('NOT_FOUND', '卡片不存在')
  if (c.owner_id !== p.owner) throw new GameError('NOT_OWNER', '持有这张结局卡才能观看完整路径')
  const S = p.segs(c.series_id)
  const list = JSON.parse(c.playlist) as string[]
  const path = JSON.parse(c.path)
  const items = []
  for (const id of list) {
    const s = S[id]; if (!s) continue
    const step = path.find((x: any) => x.option === id) || path.find((x: any) => x.fork && S[id] && id.startsWith('K'))
    items.push({ id, title: s.title, video_url: await mediaTicket(env, p.owner, c.series_id, id), image_url: s.image_url, dur: s.dur, lines: s.lines, choice: step ? { q: step.q, label: step.label, fork: !!step.fork } : null })
  }
  return { card: c.id, series: c.series_id, ending: c.ending_id, rarity: c.rarity, serial: c.serial, items, total_sec: Math.round(items.reduce((a, x) => a + (x.dur || 0), 0)) }
}
