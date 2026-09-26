// 结局卡交易所：市场 · 我的卡册 · 卡详情（路径 + 成交历史）· 挂单/购买 · 完整观看路径播放器
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, body) => { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '请求失败'); return j }
  const qs = new URLSearchParams(location.search)
  const S = { tab: qs.get('tab') === 'mine' ? 'mine' : 'market', rarity: '', sort: 'new', data: null, mine: null, balance: 0 }
  const root = $('#market')
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200) }
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? '刚刚' : s < 3600 ? Math.floor(s / 60) + ' 分钟前' : s < 86400 ? Math.floor(s / 3600) + ' 小时前' : Math.floor(s / 86400) + ' 天前' }
  const me = () => localStorage.df_uid
  const RAR = { R: '普通', SR: '稀有', SSR: '史诗', UR: '传说' }

  const card = (c, mine) => `
    <article class="mc r-${c.rarity}" data-card="${c.id}">
      <div class="pic">${c.image ? `<img loading="lazy" src="${c.image}" alt="">` : '<div class="noimg"><i class="fas fa-lock"></i></div>'}
        <i class="rar r-${c.rarity}">${c.rarity}</i>${c.forked ? '<i class="fk">⟲ 裂隙</i>' : ''}<i class="sn">No.${c.serial}</i>
        <div class="holo"></div></div>
      <div class="tx"><h4>${esc(c.ending_title)}</h4><p>${esc(c.series_title)}</p>
        <div class="pr">${c.listing_id ? `<b><i class="fas fa-heart"></i> ${c.price}</b>${mine ? '<span class="st">挂单中</span>' : ''}` : mine ? `<span class="st ${c.locked_until > Date.now() ? 'lk' : ''}">${c.locked_until > Date.now() ? '冷却中' : '持有'}</span>` : ''}<span class="ref">参考 ${c.ref_price}</span></div></div>
    </article>`

  async function load() {
    root.innerHTML = '<div class="skel">' + '<i></i>'.repeat(6) + '</div>'
    try {
      if (S.tab === 'market') S.data = await api(`/api/market?sort=${S.sort}${S.rarity ? '&rarity=' + S.rarity : ''}`)
      const m = await api('/api/me/cards'); S.mine = m.cards; S.balance = m.balance
    } catch (e) { toast(e.message) }
    render()
    const cid = qs.get('card'); if (cid) { qs.delete('card'); history.replaceState(null, '', '/market' + (S.tab === 'mine' ? '?tab=mine' : '')); openCard(cid) }
  }

  function render() {
    const d = S.data
    root.innerHTML = `
      <header class="mk-head"><div><h1><i class="fas fa-gem"></i> 结局卡交易所</h1><p>每张卡都来自一次真实通关 · 服务端铸造 · 带完整观看路径</p></div>
        <div class="bal"><span>心动值</span><b>${S.balance}</b></div></header>
      <nav class="mk-tabs"><button class="${S.tab === 'market' ? 'on' : ''}" data-tab="market"><i class="fas fa-store"></i> 市场</button><button class="${S.tab === 'mine' ? 'on' : ''}" data-tab="mine"><i class="fas fa-book-open"></i> 我的卡册 <small>${S.mine?.length || 0}</small></button></nav>
      ${S.tab === 'market' && d ? `
        <section class="mk-stats"><div><b>${d.stats.minted}</b><span>已铸造</span></div><div><b>${d.stats.trades_24h}</b><span>24h 成交</span></div><div><b>${d.stats.volume_24h}</b><span>24h 成交额</span></div><div><b>${Math.round(d.fee_rate * 100)}%</b><span>手续费</span></div></section>
        <section class="mk-filter"><div class="chips">${['', 'UR', 'SSR', 'SR', 'R'].map((r) => `<button class="${S.rarity === r ? 'on' : ''}" data-rar="${r}">${r ? `<i class="dot r-${r}"></i>${r}` : '全部'}</button>`).join('')}</div>
          <select id="sort" aria-label="排序"><option value="new" ${S.sort === 'new' ? 'selected' : ''}>最新挂单</option><option value="price_asc" ${S.sort === 'price_asc' ? 'selected' : ''}>价格从低到高</option><option value="price_desc" ${S.sort === 'price_desc' ? 'selected' : ''}>价格从高到低</option></select></section>
        <section class="mk-grid">${d.listings.map((c) => card(c, c.seller_id === me())).join('') || `<div class="empty"><i class="fas fa-store-slash"></i><p>还没有人挂单</p><span>通关获得结局卡后，在「我的卡册」里挂单出售</span><a class="cta" href="/love">去通关 · 心动回廊</a></div>`}</section>
        ${d.recent.length ? `<section class="mk-recent"><h3><i class="fas fa-bolt"></i> 最新成交</h3>${d.recent.map((r) => `<div><i class="rar sm r-${r.rarity}">${r.rarity}</i><span>${esc(r.ending_title)}<small>${esc(r.series_title)}</small></span><b>${r.price}</b><em>${ago(r.created_at)}</em></div>`).join('')}</section>` : ''}
        <section class="mk-rules"><h3><i class="fas fa-shield-halved"></i> 公平交易规则</h3><ul>
          <li><b>唯一来源</b>结局卡只在服务端判定通关时铸造，一局一张，无法伪造或复制</li>
          <li><b>持有冷却</b>新获得的卡 ${d.hold_min} 分钟后才能挂单，杜绝秒买秒卖刷量</li>
          <li><b>限价带</b>挂单价需在参考价的 0.3 ~ 10 倍之间，防止异常定价转移资产</li>
          <li><b>洗售拦截</b>同一网络环境的买卖、双方来回互刷都会被风控拦截</li>
          <li><b>原子成交</b>付款与过户在同一次结算中完成，平台抽成 ${Math.round(d.fee_rate * 100)}% 记入复式账本</li></ul></section>` : ''}
      ${S.tab === 'mine' ? mineHtml() : ''}`
  }

  function mineHtml() {
    const cards = S.mine || []
    if (!cards.length) return `<div class="empty"><i class="fas fa-book-open"></i><p>卡册还是空的</p><span>在「心动回廊」或「穹顶之下」走到任意结局，就会获得一张结局卡</span><div style="display:flex;gap:10px;justify-content:center;margin-top:14px"><a class="cta" href="/love">心动回廊</a><a class="cta ghost2" href="/film">穹顶之下</a></div></div>`
    const by = {}; cards.forEach((c) => (by[c.series_title] ||= []).push(c))
    return Object.entries(by).map(([t, list]) => `<section class="mk-album"><h3>${esc(t)} <small>${new Set(list.map((c) => c.ending_id)).size} 种结局 · ${list.length} 张</small></h3><div class="mk-grid">${list.map((c) => card(c, true)).join('')}</div></section>`).join('')
  }

  // ─── 卡详情（底部抽屉）───
  async function openCard(id) {
    let c
    try { c = await api('/api/market/cards/' + id) } catch (e) { return toast(e.message) }
    const mine = c.owner_id === me(), locked = c.locked_until > Date.now()
    $('#sheet-root').innerHTML = `<div class="sheet-bg" data-close></div>
      <section class="sheet"><div class="grab" data-close></div>
        <div class="cd-top r-${c.rarity}">${c.image ? `<img src="${c.image}" alt="">` : ''}<div class="holo"></div><button class="x" data-close><i class="fas fa-xmark"></i></button>
          <div class="cd-t"><i class="rar r-${c.rarity}">${c.rarity}</i><div><h2>${esc(c.ending_title)}</h2><p>${esc(c.series_title)} · No.${c.serial} · ${RAR[c.rarity]}${c.forked ? ' · ⟲ 时间裂隙' : ''}</p></div></div></div>
        <div class="cd-body">
          <h5><i class="fas fa-route"></i> 通关路径</h5>
          <ol class="route2">${c.path.map((p, i) => `<li class="${p.fork ? 'fk' : ''} ${p.twist ? 'tw' : ''}"><i>${p.fork ? '⟲' : i + 1}</i><div><small>${esc(p.q || '')}</small><b>${esc(p.label)}</b></div></li>`).join('')}<li class="end"><i>★</i><div><small>结局</small><b>${esc(c.ending_title)}</b></div></li></ol>
          <div class="cd-meta"><div><span>参考价</span><b>${c.ref_price}</b></div><div><span>铸造</span><b>${ago(c.minted_at)}</b></div><div><span>成交</span><b>${c.history.length} 次</b></div></div>
          ${c.history.length ? `<h5><i class="fas fa-chart-line"></i> 成交历史</h5><div class="hist">${c.history.map((h) => `<div><span>${ago(h.created_at)}</span><b>${h.price}</b></div>`).join('')}</div>` : ''}
          ${mine && !c.listing_id ? `<h5><i class="fas fa-tag"></i> 挂单出售</h5>${locked ? `<p class="note"><i class="fas fa-hourglass-half"></i> 新卡冷却中，${Math.ceil((c.locked_until - Date.now()) / 60000)} 分钟后可挂单</p>` : `<div class="sell"><input id="price" type="number" inputmode="numeric" value="${c.ref_price}" min="${Math.ceil(c.ref_price * 0.3)}" max="${c.ref_price * 10}"><span>到手 ≈ <b id="net">${c.ref_price - Math.ceil(c.ref_price * 0.05)}</b></span></div><p class="note">价格区间 ${Math.ceil(c.ref_price * 0.3)} ~ ${c.ref_price * 10} · 手续费 5%</p>`}` : ''}
        </div>
        <div class="sh-cta">
          ${mine ? `<button class="cta" data-watch="${c.id}"><i class="fas fa-play"></i> 观看完整路径</button>${c.listing_id ? `<button class="ghost" data-cancel="${c.listing_id}">撤单</button>` : locked ? '' : `<button class="ghost" data-sell="${c.id}">挂单</button>`}`
            : c.listing_id ? `<button class="cta" data-buy="${c.listing_id}" data-price="${c.price}"><i class="fas fa-bag-shopping"></i> ${c.price} 心动值 购买</button>` : `<a class="cta" href="${c.url}"><i class="fas fa-play"></i> 自己去通关</a>`}
        </div></section>`
    requestAnimationFrame(() => document.body.classList.add('sheet-open'))
    const pi = $('#price'); if (pi) pi.oninput = () => ($('#net').textContent = Math.max(0, pi.value - Math.ceil(pi.value * 0.05)))
  }
  const closeSheet = () => { document.body.classList.remove('sheet-open'); setTimeout(() => ($('#sheet-root').innerHTML = ''), 280) }

  // ─── 完整观看路径播放器（全屏竖屏）───
  async function watch(id) {
    let w
    try { w = await api(`/api/me/cards/${id}/watch`) } catch (e) { return toast(e.message) }
    closeSheet()
    const ov = document.createElement('div'); ov.className = 'wp'; document.body.appendChild(ov); document.body.classList.add('wp-open')
    let i = 0
    ov.innerHTML = `<video playsinline autoplay></video><div class="wp-top"><button class="x" id="wpx"><i class="fas fa-xmark"></i></button><div class="bars">${w.items.map(() => '<i><b></b></i>').join('')}</div></div>
      <div class="wp-cap"></div><div class="wp-choice"></div><div class="wp-nav"><button id="wpp" aria-label="上一段"></button><button id="wpn" aria-label="下一段"></button></div>`
    const v = $('video', ov), bars = [...ov.querySelectorAll('.bars i')], cap = $('.wp-cap', ov), ch = $('.wp-choice', ov)
    const play = (k) => {
      i = Math.max(0, Math.min(w.items.length - 1, k)); const it = w.items[i]
      bars.forEach((b, j) => b.firstChild.style.width = j < i ? '100%' : '0')
      v.src = it.video_url; v.play().catch(() => { v.muted = true; v.play() })
      ch.innerHTML = it.choice ? `<span class="${it.choice.fork ? 'fk' : ''}">${it.choice.fork ? '⟲ 时间裂隙' : esc(it.choice.q || '')}</span><b>${esc(it.choice.label)}</b>` : `<span>序章</span><b>${esc(it.title)}</b>`
      ch.classList.remove('in'); void ch.offsetWidth; ch.classList.add('in')
    }
    v.ontimeupdate = () => {
      const it = w.items[i]; if (!it) return
      bars[i].firstChild.style.width = (v.currentTime / (v.duration || 1)) * 100 + '%'
      const l = (it.lines || []).find((x) => v.currentTime >= x.start && v.currentTime <= x.end + 0.4)
      cap.innerHTML = l ? `<b>${esc(l.speaker)}</b>${esc(l.text)}` : ''
    }
    v.onended = () => (i < w.items.length - 1 ? play(i + 1) : (ch.innerHTML = `<span>完整路径 · ${w.items.length} 段 · ${w.total_sec}s</span><b>— THE END —</b>`, ch.classList.add('in')))
    $('#wpn', ov).onclick = () => play(i + 1); $('#wpp', ov).onclick = () => play(i - 1)
    $('#wpx', ov).onclick = () => { v.pause(); ov.remove(); document.body.classList.remove('wp-open') }
    play(0)
  }

  document.addEventListener('click', async (e) => {
    const t = e.target
    if (t.closest('[data-close]')) return closeSheet()
    const tb = t.closest('[data-tab]'); if (tb) { S.tab = tb.dataset.tab; history.replaceState(null, '', S.tab === 'mine' ? '/market?tab=mine' : '/market'); return load() }
    const rr = t.closest('[data-rar]'); if (rr) { S.rarity = rr.dataset.rar; return load() }
    const cd = t.closest('[data-card]'); if (cd) return openCard(cd.dataset.card)
    const w = t.closest('[data-watch]'); if (w) return watch(w.dataset.watch)
    const sl = t.closest('[data-sell]'); if (sl) { try { const r = await api('/api/market/list', { card_id: sl.dataset.sell, price: +$('#price').value }); toast(`已挂单 · ${r.price} 心动值`); closeSheet(); load() } catch (er) { toast(er.message) } return }
    const cc = t.closest('[data-cancel]'); if (cc) { try { await api('/api/market/cancel', { listing_id: cc.dataset.cancel }); toast('已撤单'); closeSheet(); load() } catch (er) { toast(er.message) } return }
    const by = t.closest('[data-buy]'); if (by) { if (!confirm(`确认花费 ${by.dataset.price} 心动值购买？`)) return; try { const r = await api('/api/market/buy', { listing_id: by.dataset.buy }); toast(`购买成功！余额 ${r.balance}`); closeSheet(); S.tab = 'mine'; load() } catch (er) { toast(er.message) } return }
  })
  document.addEventListener('change', (e) => { if (e.target.id === 'sort') { S.sort = e.target.value; load() } })
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSheet())
  load()
})()
