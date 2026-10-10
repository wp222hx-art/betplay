// 惊心 1 分钟 v2 · 连猜爬塔
// 剧情一条线演到底；每张猜卡 A / B 二选一，猜中倍率上涨、越往后越难；随时落袋；猜错 = 注金归零但剧情照演完
// UI 落实「不可悔棋」：无暂停 / 无进度条 / 无回看；抉择窗口服务端计时，超时 = 自动落袋
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const xm = (m) => '×' + (m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : m.toFixed(2))
  const pct = (p) => Math.round(p * 100) + '%'
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.message || '请求失败'), { code: j.error })
    return j
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  async function decrypt(slot, k) {
    const key = await crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['decrypt'])
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(slot.iv) }, key, unb64(slot.ct))).trim())
  }
  const flame = (n) => '<i class="fas fa-fire"></i>'.repeat(n) + '<i class="fas fa-fire off"></i>'.repeat(Math.max(0, 5 - n))

  // ─────────────── 板块页 ───────────────
  window.ThrillHub = async function () {
    const box = $('#thrill-list')
    box.innerHTML = '<div class="t-empty">加载中…</div>'
    try {
      const { items } = await api('/api/thrill')
      if (!items.length) { box.innerHTML = '<div class="t-empty">首批剧集制作中，敬请期待</div>'; return }
      box.innerHTML = items.map((it, i) => it.soon ? `
        <div class="thrill-card soon" id="thrill-card-${esc(it.id)}">
          <div class="cover" style="${it.cover ? `background-image:url('${esc(it.cover)}')` : ''}"><span class="rank">#${i + 1}</span><span class="demo">拍摄中</span></div>
          <div class="info"><div class="tension">${flame(it.tension)}</div><h3>${esc(it.title)}</h3><p>${esc(it.logline)}</p></div>
        </div>` : `
        <a class="thrill-card" href="${it.url}" id="thrill-card-${esc(it.id)}">
          <div class="cover" style="background-image:url('${esc(it.cover || '')}')"><span class="rank">#${i + 1}</span>${it.demo ? '<span class="demo">试映</span>' : ''}</div>
          <div class="info">
            <div class="tension" title="紧张度">${flame(it.tension)}</div>
            <h3>${esc(it.title)}</h3><p>${esc(it.logline)}</p>
            <div class="ladder">${it.ladder.map((m, k) => `<b class="${k + 1 === it.jackpot_step ? 'jp' : ''}">连中${k + 1}<i>${xm(m)}</i></b>`).join('')}<b>…<i>∞</i></b></div>
            <div class="foot"><span class="pool"><i class="fas fa-sack-dollar"></i> 奖池 ${fmt(it.pool)}</span><span><i class="fas fa-play"></i> ${fmt(it.plays)} 局</span><span>最高连中 ${it.best_streak} · ${xm(it.top_mult || 1)}</span></div>
          </div>
        </a>`).join('')
    } catch (e) { box.innerHTML = `<div class="t-empty">${esc(e.message)}</div>` }
  }

  // ─────────────── 播放页 ───────────────
  window.ThrillPlay = async function (sid) {
    const API = `/api/thrill/${sid}`
    const side = $('#thrill-side'), gateEl = $('#thrill-gate'), hud = $('#thrill-hud'), lines = $('#thrill-lines')
    const video = $('#thrill-video'), poster = $('#thrill-poster'), flash = $('#thrill-flash'), modal = $('#thrill-modal')
    const S = { run: null, stake: 0, hits: 0, mult: 1, log: [], playing: false, dead: false }
    video.controls = false; video.disablePictureInPicture = true
    video.addEventListener('pause', () => { if (S.playing && !video.ended) video.play().catch(() => {}) })
    video.addEventListener('contextmenu', (e) => e.preventDefault())

    let M
    const ladder = () => S.run?.ladder || M.ladder
    try { M = await api(`${API}/meta`) } catch (e) { side.innerHTML = `<div class="t-empty">${esc(e.message)}</div>`; return }
    S.stake = M.cfg.stakes[0]
    renderHud(); lobby()
    if (M.open_run) { const r = await api(`${API}/resume`).catch(() => null); if (r?.run) return resume(r.run) }

    function renderHud() {
      const L = ladder().slice(0, 8)
      hud.innerHTML = `
        <div class="h-ladder">${L.map((x) => `<span class="${x.step <= S.hits ? 'lit' : x.step === S.hits + 1 && S.run && !S.dead ? 'next' : ''} ${x.jackpot ? 'jpstep' : ''}" title="命中率 ${pct(x.p)}">${xm(x.mult)}</span>`).join('')}<span class="more">∞</span></div>
        <div class="h-pool"><i class="fas fa-sack-dollar"></i> <b>${fmt(M.pool)}</b></div>
        ${S.run ? `<div class="h-stat">连中 <b>${S.hits}</b> · 当前 <b class="gold">${xm(S.mult)}</b> = <b class="coin">${fmt(Math.floor(S.run.stake * S.mult))}</b>${S.dead ? ' · <b class="down">本局已出局，剧情继续</b>' : ''}</div>` : ''}`
    }

    function lobby() {
      side.innerHTML = `
        <div class="s-title"><div class="tension">${flame(M.series.tension || 3)}</div><h2>${esc(M.series.title)}</h2><p>${esc(M.series.logline)}</p></div>
        <div class="s-block"><h4>连猜爬塔 · 每张卡 A / B 二选一</h4>
          <table class="tower"><thead><tr><th>连中</th><th>这一猜命中率</th><th>累计倍率</th></tr></thead><tbody>
          ${M.ladder.slice(0, 8).map((x) => `<tr class="${x.jackpot ? 'jp' : ''}"><td>${x.step}</td><td>${pct(x.p)}</td><td><b>${xm(x.mult)}</b>${x.jackpot ? ' <em>+JACKPOT</em>' : ''}</td></tr>`).join('')}
          <tr><td>…</td><td>${pct(M.ladder[M.ladder.length - 1]?.p || 0.2)}</td><td>无限续猜</td></tr></tbody></table>
          <p class="note">每张卡出现时：选 A / B 继续爬，或<b>落袋</b>带走当前倍率。猜错 = 本局注金归零。越往后越难，倍率越疯。每个人的结果独立随机，开局即锁定。</p></div>
        <div class="s-block"><h4>本局注金</h4><div class="stakes">${M.cfg.stakes.map((v) => `<button class="stake ${v === S.stake ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
          <p class="note">一局只押一次。剧情不可暂停、不可回看、不可悔棋；${M.cfg.pick_sec} 秒不选 = 自动落袋。</p></div>
        <button id="thrill-start" class="btn gold big"><i class="fas fa-bolt"></i> 开演 · 一口气看完</button>
        <div class="s-block stats"><span>已开 ${fmt(M.stats.plays)} 局</span><span>最高连中 ${M.stats.best_streak}</span><span>最高倍率 ${xm(M.stats.top_mult || 1)}</span><span>最高 JP ${fmt(M.stats.top_jackpot)}</span></div>
        <div class="s-block recent"><h4>实时战报</h4>${M.recent.length ? M.recent.map((r) => `<div>${esc(r.who)} 连中 <b>${r.hits}</b> ${r.reason === 'miss' ? '<span class="down">猜错出局</span>' : `落袋 <b class="gold">${xm(r.mult)}</b> +${fmt(r.win)}`}${r.jackpot ? ` <em>JP +${fmt(r.jackpot)}</em>` : ''}</div>`).join('') : '<div class="mut">还没有人挑战</div>'}</div>`
      side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)) }))
      $('#thrill-start').onclick = start
    }

    function liveSide() {
      side.innerHTML = `<div class="s-title"><h2>${esc(M.series.title)}</h2><p class="mut">一口气演完 · 不可暂停 · 不可回看</p></div>
        <div class="s-block"><h4>本局</h4><div class="run-kv"><span>注金</span><b>${S.run.stake}</b><span>当前倍率</span><b class="gold">${xm(S.mult)}</b><span>落袋可得</span><b class="coin">${fmt(Math.floor(S.run.stake * S.mult))}</b><span>承诺哈希</span><code title="${S.run.commit}">${S.run.commit.slice(0, 16)}…</code></div></div>
        <div class="s-block"><h4>猜卡记录</h4><ol class="gate-log">${S.log.length ? S.log.map((l) => `<li class="${l.hit ? 'hit' : l.cash ? 'cash' : 'miss'}"><span>第${l.step}猜</span><em>${esc(l.text)}</em><b>${l.hit ? xm(l.mult) : l.cash ? '落袋' : '出局'}</b></li>`).join('') : '<li><span>—</span><em>第一张卡马上出现</em><b></b></li>'}</ol></div>`
    }

    async function start() {
      const btn = $('#thrill-start'); btn.disabled = true; btn.textContent = '锁定随机种子…'
      try {
        const r = await api(`${API}/start`, { body: { stake: S.stake } })
        Object.assign(S, { run: r, hits: 0, mult: 1, log: [], dead: false, playing: true }); M.pool = r.pool
        liveSide(); renderHud()
        await playSeg(r.intro, { kicker: '开场' })
        await runCard(r.card)
      } catch (e) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> 开演 · 一口气看完'; toast(e.message); btn.insertAdjacentHTML('afterend', `<p class="note err">${esc(e.message)}</p>`) }
    }
    async function resume(run) {
      Object.assign(S, { run, hits: run.hits, mult: run.mult, log: [], dead: false, playing: true })
      liveSide(); renderHud(); toast('上一局还没结束，从当前猜卡继续（已揭晓的不能回看）')
      await runCard(run.card)
    }

    async function playSeg(seg, o = {}) {
      if (!seg) return
      lines.innerHTML = `${o.kicker ? `<div class="kicker">${esc(o.kicker)}</div>` : ''}<div class="seg-t">${esc(seg.title)}</div>`
      const dur = Math.max(2, Math.min(12, seg.dur || 5))
      if (seg.video) {
        if (seg.poster) poster.src = seg.poster
        video.src = seg.video; video.classList.add('on'); video.muted = false
        const done = new Promise((res) => { video.onended = res; setTimeout(res, (dur + 4) * 1000) })
        try { await video.play() } catch { video.muted = true; await video.play().catch(() => {}) }
        showLines(seg.lines, dur); await done
      } else {
        video.classList.remove('on'); video.removeAttribute('src')
        if (seg.poster) poster.src = seg.poster
        poster.classList.remove('kb'); void poster.offsetWidth; poster.classList.add('kb')
        showLines(seg.lines, dur); await sleep(dur * 1000)
      }
    }
    function showLines(ls = [], dur) {
      const step = (dur * 1000) / Math.max(1, ls.length)
      ls.forEach((t, i) => setTimeout(() => { const d = document.createElement('div'); d.className = 'line'; d.textContent = t; lines.appendChild(d); while (lines.children.length > 4) lines.children[1]?.remove() }, i * step))
    }

    // 猜卡：A / B / 落袋（服务端计时；超时自动落袋）
    async function runCard(c) {
      const canCash = S.hits > 0
      gateEl.innerHTML = `
        <div class="g-head"><span class="g-no">${esc(c.title)}${c.phase === 'bonus' ? ' · <b class="gold">加时</b>' : ''}</span><span class="g-mult">命中率 ${pct(c.p)} · 猜中 → <b>${xm(c.mult_next)}</b>${c.jackpot ? ' + <b class="coin">JACKPOT</b>' : ''}</span></div>
        <div class="g-q">${esc(c.q)}</div>
        <div class="g-opts two"><button class="g-opt" data-side="a"><i>A</i><span>${esc(c.a.label)}</span></button><button class="g-opt" data-side="b"><i>B</i><span>${esc(c.b.label)}</span></button></div>
        ${canCash ? `<button class="g-cash" id="g-cash"><i class="fas fa-hand-holding-dollar"></i> 落袋 ${xm(c.mult_now)} · 带走 ${fmt(Math.floor(S.run.stake * c.mult_now))}</button>` : ''}
        <div class="g-timer"><div id="g-bar"></div><b id="g-sec"></b></div>
        <div class="g-foot">结果开局已锁定 · 选定即锁盘 · ${canCash ? '超时 = 自动落袋' : '超时 = 退回注金（扣奖池抽成）'}</div>`
      gateEl.classList.remove('hidden', 'locked'); gateEl.classList.add('in')
      let sent = false
      const arm = await api(`${API}/runs/${S.run.run_id}/arm`, { body: {} })
      const skew = Date.now() - arm.server_time, lockAt = arm.lock_at + skew - 800, total = lockAt - Date.now()
      const submit = async (body) => {
        if (sent) return; sent = true; clearInterval(tm)
        gateEl.classList.add('locked'); gateEl.querySelectorAll('button').forEach((b) => (b.disabled = true))
        try { await resolve(c, await api(`${API}/runs/${S.run.run_id}/act`, { body: { step: c.step, ...body } }), body.side) }
        catch (e) { toast(e.message); if (['RUN_ENDED', 'DUPLICATE', 'STALE_STEP'].includes(e.code)) setTimeout(() => location.reload(), 1500) }
      }
      gateEl.querySelectorAll('.g-opt').forEach((b) => (b.onclick = () => { b.classList.add('on'); submit({ side: b.dataset.side }) }))
      if (canCash) $('#g-cash').onclick = () => submit({ cashout: true })
      const tm = setInterval(() => {
        const left = lockAt - Date.now()
        $('#g-bar').style.width = Math.max(0, (left / total) * 100) + '%'
        $('#g-sec').textContent = Math.max(0, Math.ceil(left / 1000)) + 's'
        gateEl.classList.toggle('hot', left < 3000)
        if (left <= 0) submit({ side: null })
      }, 100)
    }

    async function resolve(c, r, picked) {
      if (r.action) { // 落袋 / 超时
        S.log.push({ step: c.step, cash: true, text: r.action === 'cashout' ? `落袋 ${xm(r.mult)}` : '超时自动落袋' })
        boom(r.payout ? `落袋 ${xm(r.mult)}<small>+${fmt(r.payout)}</small>` : '退回注金', 'cash')
        await sleep(1100); hideGate(); S.dead = true; renderHud(); liveSide()
        return finale(r)
      }
      const seg = r.reveal.key ? await decrypt(c.encrypted[r.reveal.slot], r.reveal.key) : null
      gateEl.querySelectorAll('.g-opt').forEach((b) => { if (b.dataset.side === r.shown) b.classList.add('win'); else if (b.dataset.side === picked) b.classList.add('lose') })
      S.log.push({ step: c.step, hit: r.hit, mult: r.mult, text: r.reveal.label })
      if (r.hit) { S.hits = r.hits; S.mult = r.mult; boom(`猜中 ${xm(r.mult)}${r.jackpot?.amount ? `<small class="coin">JACKPOT +${fmt(r.jackpot.amount)}${r.jackpot.status === 'held' ? '（审核中）' : ''}</small>` : `<small>落袋可得 ${fmt(Math.floor(S.run.stake * r.mult))}</small>`}`, 'hit') }
      else { S.dead = true; boom('猜错<small>注金归零 · 剧情继续</small>', 'miss') }
      await sleep(1100); hideGate(); renderHud(); liveSide()
      await playSeg(seg, { kicker: r.hit ? '猜中' : '揭晓' })
      if (r.ended) return finale(r)
      if (r.main) await playSeg(r.main)
      return runCard(r.next)
    }
    const hideGate = () => { gateEl.classList.add('hidden'); gateEl.classList.remove('in') }

    // 出局 / 落袋后：剩余主线照常一口气演完，再出结算
    async function finale(r) {
      for (const s of r.rest || []) await playSeg(s)
      S.playing = false; M.pool = r.pool; renderHud()
      modal.innerHTML = `<div class="t-card ${r.jackpot ? 'perfect' : ''}">
        <div class="k">${r.reason === 'miss' ? '猜错出局' : r.reason === 'cap' ? '封顶落袋' : '落袋离场'}</div>
        <div class="big">${r.hits}<small> 连中</small></div>
        <div class="kv"><span>注金</span><b>${fmt(r.stake)}</b><span>落袋倍率</span><b class="gold">${r.reason === 'miss' ? '—' : xm(r.mult || 1)}</b><span>赔付</span><b>${fmt(r.payout)}</b>
          ${r.jackpot ? `<span>Jackpot</span><b class="coin">${fmt(r.jackpot)}${r.jackpot_status === 'held' ? '（风控审核中）' : ''}</b>` : ''}
          <span>本局净额</span><b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
        ${r.hold_reason ? `<p class="note">审核原因：${esc(r.hold_reason)}。奖金已冻结在独立账户，审核通过后到账。</p>` : ''}
        <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><p>${esc(r.verify.formula)}</p><a href="${API}/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details>
        <div class="acts"><button class="btn gold" id="again"><i class="fas fa-rotate-right"></i> 再来一局</button><a class="btn" href="/thrill">回板块</a></div></div>`
      modal.classList.remove('hidden')
      $('#again').onclick = async () => { modal.classList.add('hidden'); M = await api(`${API}/meta`); Object.assign(S, { run: null, hits: 0, mult: 1, log: [], dead: false }); renderHud(); lobby() }
    }

    function boom(html, cls) { flash.className = 't-flash ' + cls; flash.innerHTML = `<div>${html}</div>`; void flash.offsetWidth; flash.classList.add('go') }
    function toast(m) { const t = document.createElement('div'); t.className = 't-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) }
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.playing) toast('剧情不会因切走而暂停：抉择窗口到时自动落袋') })
  }
})()
