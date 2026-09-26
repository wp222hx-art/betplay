// 发现页：恋爱 / 影剧 两大类上架列表（轮播 · 分类 · 标签 · 货架 · 榜单 · 瀑布 · 详情抽屉 · 想看）
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const uid = localStorage.df_uid || (localStorage.df_uid = 'u_' + Math.random().toString(36).slice(2, 10))
  const api = async (url, body) => { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-user-id': uid }, body: body ? JSON.stringify({ user_id: uid, ...body }) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '请求失败'); return j }
  const qs = new URLSearchParams(location.search)
  const S = { cats: [], items: [], cat: qs.get('cat') || 'all', tab: qs.get('tab') || '', tag: '', sort: 'heat', adult: localStorage.df_adult === '1', mine: {} }
  const K = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + '万' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
  const root = $('#discover')
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800) }
  const isAdult = (it) => it.badge === '18+' || it.tags.includes('成人向')
  const catName = (id) => S.cats.find((c) => c.id === id)?.name || ''

  // ─── 卡片 ───
  const card = (it, size = '') => `
    <article class="dc ${size} ${it.status} ${isAdult(it) && !S.adult ? 'veil' : ''}" data-id="${it.id}" style="--cc:${it.cat === 'love' ? '#ff7eb3' : '#f5c451'}">
      <div class="pic"><img loading="lazy" src="${it.cover}" alt="${esc(it.title)}">
        ${it.badge ? `<i class="bd ${it.badge === '18+' ? 'r18' : ''}">${esc(it.badge)}</i>` : ''}
        ${it.status === 'live' ? '<i class="lv"><b></b>可玩</i>' : '<i class="sn">即将上线</i>'}
        ${isAdult(it) && !S.adult ? '<div class="veil-t"><i class="fas fa-eye-slash"></i><span>成人向 · 点击确认</span></div>' : ''}
        <div class="meta"><span><i class="fas fa-fire"></i> ${K(it.wish)}</span><span>${it.endings} 结局</span></div>
        <button class="wbtn ${it.wished ? 'on' : ''}" data-w="${it.id}" aria-label="${it.status === 'live' ? '开玩' : '想看'}">${it.status === 'live' ? '<i class="fas fa-play"></i>' : `<i class="${it.wished ? 'fas' : 'far'} fa-heart"></i>`}</button>
      </div>
      <div class="tx"><h4>${esc(it.title)}</h4><p>${esc(it.sub)}</p>
        <div class="tg">${it.tags.slice(0, 3).map((t) => `<em>${esc(t)}</em>`).join('')}</div></div>
    </article>`

  function filtered() {
    let a = S.items.filter((x) => (S.cat === 'all' || x.cat === S.cat) && (!S.tag || x.tags.includes(S.tag)))
    const by = { heat: (x, y) => y.wish - x.wish, new: (x, y) => (y.badge === '新作') - (x.badge === '新作') || y.order - x.order, end: (x, y) => y.endings - x.endings }[S.sort]
    return [...a].sort((x, y) => (y.status === 'live') - (x.status === 'live') || by(x, y))
  }

  // ─── 主渲染 ───
  function render() {
    document.querySelectorAll('.nav-links a, .tab-bar a').forEach((a) => {
      const h = a.getAttribute('href'); a.classList.toggle('on', S.tab === 'mine' ? h.includes('tab=mine') : h === (S.cat === 'all' ? '/' : `/?cat=${S.cat}`))
    })
    if (S.tab === 'mine') return renderMine()
    const pool = S.items.filter((x) => S.cat === 'all' || x.cat === S.cat)
    const hero = [...pool.filter((x) => x.status === 'live'), ...pool.filter((x) => x.status !== 'live' && ['爆款', '热播', '独家'].includes(x.badge)).sort((a, b) => b.wish - a.wish)].slice(0, 6)
    const tags = [...new Map(pool.flatMap((x) => x.tags).map((t) => [t, (pool.filter((x) => x.tags.includes(t)).length)])).entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map((x) => x[0])
    const rank = [...pool].sort((a, b) => b.wish - a.wish).slice(0, 10)
    const shelves = S.cat === 'all' ? S.cats.map((c) => ({ c, list: S.items.filter((x) => x.cat === c.id).sort((a, b) => (b.status === 'live') - (a.status === 'live') || b.wish - a.wish) })) : []
    const temptation = pool.filter((x) => isAdult(x) || x.tags.some((t) => ['禁忌', '诱惑', '危险恋人', '一夜'].includes(t)))
    const all = filtered()
    root.innerHTML = `
      <section class="hero" id="hero">
        <div class="hero-track">${hero.map((it, i) => `
          <div class="hs ${i === 0 ? 'on' : ''}" data-id="${it.id}">
            <img src="${it.cover}" alt="" class="${isAdult(it) && !S.adult ? 'blur' : ''}"><div class="hs-g"></div>
            <div class="hs-t"><div class="k">${it.status === 'live' ? '<b class="lvd"></b> 正在热播 · 可玩' : `${esc(it.badge || '')} · 即将上线`} · ${catName(it.cat)}</div>
              <h2>${esc(it.title)}</h2><p>${esc(it.logline)}</p>
              <div class="hs-s"><span><i class="fas fa-code-branch"></i> ${it.endings} 种结局</span>${it.forks ? `<span><i class="fas fa-clock-rotate-left"></i> ${it.forks} 条时间裂隙</span>` : ''}<span><i class="fas fa-fire"></i> ${K(it.wish)} 想看</span></div>
              <div class="hs-b">${it.status === 'live' ? `<a class="cta" href="${it.url}"><i class="fas fa-play"></i> 立即开玩</a>` : `<button class="cta" data-w="${it.id}"><i class="${it.wished ? 'fas' : 'far'} fa-heart"></i> ${it.wished ? '已想看' : '想看'}</button>`}<button class="ghost" data-open="${it.id}">详情</button></div></div>
          </div>`).join('')}</div>
        <div class="dots">${hero.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
      </section>
      <section class="cats" id="cat-tabs">
        ${[{ id: 'all', name: '全部', icon: 'fa-compass' }, ...S.cats].map((c) => `<button class="${S.cat === c.id ? 'on' : ''}" data-cat="${c.id}"><i class="fas ${c.icon}"></i> ${c.name}<small>${c.id === 'all' ? S.items.length : S.items.filter((x) => x.cat === c.id).length}</small></button>`).join('')}
      </section>
      ${S.cat !== 'all' ? `<p class="cat-desc">${esc(S.cats.find((c) => c.id === S.cat)?.desc)}</p>` : ''}
      <section class="mech" id="mech">
        <div><i class="fas fa-lock"></i><b>押注锁定</b><span>结果在你下注前已加密封存</span></div>
        <div><i class="fas fa-code-branch"></i><b>二选一 / 新变数</b><span>悔棋改写概率与赔率</span></div>
        <div class="hot"><i class="fas fa-clock-rotate-left"></i><b>时间裂隙</b><span>悔棋撕开平行时间线，解锁全新剧情</span></div>
      </section>
      ${shelves.map(({ c, list }) => `
        <section class="shelf" id="shelf-${c.id}"><header><h3><i class="fas ${c.icon}"></i> ${c.name}<small>${esc(c.desc)}</small></h3><button data-cat="${c.id}">更多 <i class="fas fa-angle-right"></i></button></header>
          <div class="row">${list.slice(0, 10).map((x) => card(x, 'sm')).join('')}</div></section>`).join('')}
      ${temptation.length ? `<section class="shelf dark" id="shelf-night"><header><h3><i class="fas fa-moon"></i> 深夜禁区<small>危险、诱惑、欲罢不能</small></h3></header><div class="row">${temptation.map((x) => card(x, 'sm')).join('')}</div></section>` : ''}
      <section class="rank" id="rank"><header><h3><i class="fas fa-trophy"></i> 想看榜 TOP 10</h3></header>
        <ol>${rank.map((x, i) => `<li data-id="${x.id}" class="${isAdult(x) && !S.adult ? 'veil' : ''}"><b class="n n${i + 1}">${i + 1}</b><img src="${x.cover}" alt=""><div><h4>${esc(x.title)}${x.status === 'live' ? '<i class="lvs">可玩</i>' : ''}</h4><p>${esc(x.logline)}</p><span>${catName(x.cat)} · ${x.tags.slice(0, 2).join(' · ')} · <i class="fas fa-fire"></i> ${K(x.wish)}</span></div></li>`).join('')}</ol></section>
      <section class="grid-sec" id="all"><header><h3><i class="fas fa-layer-group"></i> 全部作品 <small>${all.length} 部</small></h3>
        <div class="sort">${[['heat', '最热'], ['new', '最新'], ['end', '结局最多']].map(([k, n]) => `<button class="${S.sort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div></header>
        <div class="tags">${['', ...tags].map((t) => `<button class="${S.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${t ? '#' + esc(t) : '全部标签'}</button>`).join('')}</div>
        <div class="grid">${all.map((x) => card(x)).join('') || '<p class="empty">这个标签下暂无作品</p>'}</div></section>
      <footer class="dfoot">DreamForge · 对弈式互动剧 · 娱乐币不可提现 · 封面为概念展示</footer>`
    startHero()
  }

  function renderMine() {
    const list = S.items.filter((x) => x.wished)
    root.innerHTML = `<section class="grid-sec mine"><header><h3><i class="fas fa-bookmark"></i> 我的想看 <small>${list.length} 部</small></h3></header>
      ${list.length ? `<div class="grid">${list.map((x) => card(x)).join('')}</div>` : `<div class="empty-big"><i class="far fa-heart"></i><p>还没有想看的作品</p><a href="/" class="cta">去发现</a></div>`}
      ${Object.keys(S.mine).length ? `<h3 class="sub-h"><i class="fas fa-book"></i> 结局收集</h3><div class="prog">${Object.entries(S.mine).map(([id, m]) => { const it = S.items.find((x) => x.id === id); return `<a href="${it.url}" class="pg"><img src="${it.cover}"><div><b>${esc(it.title)}</b><div class="bar"><i style="width:${(m.got / m.total) * 100}%"></i></div><span>已解锁 ${m.got}/${m.total} 结局</span></div></a>` }).join('')}</div>` : ''}</section>`
  }

  // ─── 轮播：自动 + 手势 ───
  let ht
  function startHero() {
    const hs = [...document.querySelectorAll('.hs')], dots = [...document.querySelectorAll('.dots i')]
    if (hs.length < 2) return
    let i = 0
    const go = (n) => { i = (n + hs.length) % hs.length; hs.forEach((x, k) => x.classList.toggle('on', k === i)); dots.forEach((x, k) => x.classList.toggle('on', k === i)) }
    clearInterval(ht); ht = setInterval(() => go(i + 1), 5200)
    dots.forEach((d, k) => (d.onclick = () => { go(k); clearInterval(ht) }))
    const h = $('#hero'); let x0 = null
    h.ontouchstart = (e) => (x0 = e.touches[0].clientX)
    h.ontouchend = (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); clearInterval(ht) } x0 = null }
  }

  // ─── 详情抽屉 ───
  function openSheet(id) {
    const it = S.items.find((x) => x.id === id); if (!it) return
    if (isAdult(it) && !S.adult) return ageGate(() => openSheet(id))
    const m = S.mine[id]
    $('#sheet-root').innerHTML = `<div class="sheet-bg" data-close></div>
      <section class="sheet" role="dialog" aria-label="${esc(it.title)}"><div class="grab" data-close></div>
        <div class="sh-top"><img src="${it.cover}" alt=""><div class="sh-g"></div><button class="x" data-close><i class="fas fa-xmark"></i></button>
          <div class="sh-t">${it.badge ? `<i class="bd ${it.badge === '18+' ? 'r18' : ''}">${esc(it.badge)}</i>` : ''}<h2>${esc(it.title)}</h2><p>${esc(it.sub)}</p></div></div>
        <div class="sh-body">
          <div class="sh-tags">${[catName(it.cat), ...it.tags].map((t) => `<em>${esc(t)}</em>`).join('')}</div>
          <p class="lg">${esc(it.logline)}</p>
          <div class="sh-stats"><div><b>${it.endings}</b><span>结局</span></div><div><b>${it.nodes}</b><span>抉择点</span></div><div><b>${it.forks}</b><span>时间裂隙</span></div><div><b>${K(it.wish)}</b><span>想看</span></div></div>
          ${m ? `<div class="sh-prog"><span>我的结局收集</span><div class="bar"><i style="width:${(m.got / m.total) * 100}%"></i></div><b>${m.got}/${m.total}</b></div>` : ''}
          <h5>玩法</h5>
          <ul class="sh-mech"><li><i class="fas fa-lock"></i><div><b>押注她的心 / 押注命运</b><span>每个抉择点在你下注前已加密锁定，揭晓后可验证</span></div></li>
            <li><i class="fas fa-code-branch"></i><div><b>悔棋 · 二选一 / 新变数</b><span>回到这一刻，概率和赔率会被改写，可能多出一个隐藏选项</span></div></li>
            <li class="hot"><i class="fas fa-clock-rotate-left"></i><div><b>悔棋 · 时间裂隙</b><span>世界察觉你在悔棋，撕开一条平行时间线：新片段、新抉择、新结局</span></div></li></ul>
          <h5>剧情树预览</h5>
          <div class="sh-tree">${Array.from({ length: it.nodes }, (_, k) => `<i style="--d:${k}"></i>`).join('')}<span>${it.endings} 个结局 · ${it.forks} 条平行线</span></div>
        </div>
        <div class="sh-cta">${it.status === 'live' ? `<a class="cta" href="${it.url}"><i class="fas fa-play"></i> 立即开玩</a>` : `<button class="cta ${it.wished ? 'on' : ''}" data-w="${it.id}"><i class="${it.wished ? 'fas' : 'far'} fa-heart"></i> ${it.wished ? '已想看 · 上线提醒' : '想看 · 上线提醒我'}</button>`}
          <button class="ghost" data-share="${it.id}"><i class="fas fa-share-nodes"></i></button></div>
      </section>`
    requestAnimationFrame(() => document.body.classList.add('sheet-open'))
  }
  const closeSheet = () => { document.body.classList.remove('sheet-open'); setTimeout(() => ($('#sheet-root').innerHTML = ''), 280) }

  function ageGate(then) {
    $('#sheet-root').innerHTML = `<div class="sheet-bg" data-close></div><section class="gate"><i class="fas fa-user-shield"></i><h3>成人向内容</h3><p>该作品包含成熟情感与暗示性情节，仅面向 18 岁以上用户。</p>
      <div><button class="ghost" data-close>离开</button><button class="cta" id="age-ok">我已满 18 岁</button></div></section>`
    document.body.classList.add('sheet-open')
    $('#age-ok').onclick = () => { S.adult = true; localStorage.df_adult = '1'; document.querySelectorAll('.veil').forEach((x) => x.classList.remove('veil')); document.querySelectorAll('.hs img.blur').forEach((x) => x.classList.remove('blur')); then() }
  }

  async function wish(id) {
    const it = S.items.find((x) => x.id === id); if (!it) return
    if (it.status === 'live') return (location.href = it.url)
    const on = !it.wished
    try { await api(`/api/catalog/${id}/wish`, { on }); it.wished = on; it.wish += on ? 1 : -1; navigator.vibrate?.(10); toast(on ? `已加入想看 · 《${it.title}》上线第一时间提醒你` : '已取消想看') } catch (e) { return toast(e.message) }
    document.querySelectorAll(`[data-w="${id}"]`).forEach((b) => { b.classList.toggle('on', on); const i = b.querySelector('i'); if (i) i.className = `${on ? 'fas' : 'far'} fa-heart`; if (b.classList.contains('cta')) b.innerHTML = `<i class="${on ? 'fas' : 'far'} fa-heart"></i> ${on ? (b.closest('.sheet') ? '已想看 · 上线提醒' : '已想看') : b.closest('.sheet') ? '想看 · 上线提醒我' : '想看'}` })
    if (S.tab === 'mine') renderMine()
  }

  // ─── 事件委托 ───
  document.addEventListener('click', (e) => {
    const t = e.target
    const w = t.closest('[data-w]'); if (w) { e.preventDefault(); e.stopPropagation(); return wish(w.dataset.w) }
    if (t.closest('[data-close]')) return closeSheet()
    const sh = t.closest('[data-share]'); if (sh) { const it = S.items.find((x) => x.id === sh.dataset.share); const txt = `《${it.title}》${it.sub} —— ${it.endings} 种结局，你押谁？ ${location.origin}${it.url || '/'}`; navigator.share ? navigator.share({ title: it.title, text: txt }).catch(() => {}) : navigator.clipboard?.writeText(txt).then(() => toast('分享文案已复制')); return }
    const c = t.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; S.tag = ''; S.tab = ''; history.replaceState(null, '', S.cat === 'all' ? '/' : `/?cat=${S.cat}`); render(); scrollTo({ top: 0, behavior: 'smooth' }); return }
    const tg = t.closest('[data-tag]'); if (tg) { S.tag = tg.dataset.tag; render(); $('#all').scrollIntoView({ behavior: 'smooth' }); return }
    const so = t.closest('[data-sort]'); if (so) { S.sort = so.dataset.sort; render(); $('#all').scrollIntoView(); return }
    const op = t.closest('[data-open]'); if (op) return openSheet(op.dataset.open)
    const cd = t.closest('.dc, .rank li, .hs'); if (cd && !t.closest('a')) return openSheet(cd.dataset.id)
  })
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSheet())
  // 顶栏/底栏的分类链接在本页内切换，不刷新
  document.querySelectorAll('.nav-links a, .tab-bar a').forEach((a) => a.addEventListener('click', (e) => {
    const u = new URL(a.href); if (u.pathname !== '/') return
    e.preventDefault(); S.cat = u.searchParams.get('cat') || 'all'; S.tab = u.searchParams.get('tab') || ''; S.tag = ''; history.replaceState(null, '', u.search || '/'); render(); scrollTo({ top: 0 })
  }))

  ;(async () => {
    root.innerHTML = '<div class="skel">' + '<i></i>'.repeat(8) + '</div>'
    const d = await api('/api/catalog'); S.cats = d.cats; S.items = d.items
    render()
    // 可玩作品的结局收集进度
    const meta = { love_corridor: '/api/love/meta', under_dome: '/api/film/meta' }
    for (const [id, u] of Object.entries(meta)) api(u).then((m) => { if (m.my_endings?.length) { S.mine[id] = { got: m.my_endings.length, total: m.total_endings }; if (S.tab === 'mine') renderMine() } }).catch(() => {})
  })()
})()
