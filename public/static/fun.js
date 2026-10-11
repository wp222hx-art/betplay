// 开心1分钟 · 恶搞喜剧博弈短片播放器（9:16）
// 节奏：交押注单 → 开场片 → [悬念片 + 5 秒快押] → 翻车片 + 字幕 → … → 结局片 → 结算卡
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const xm = (m) => '×' + (m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : (+m).toFixed(2))
  const pct = (p) => (p < 0.01 ? (p * 100).toFixed(1) : Math.round(p * 100)) + '%'
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.error === 'INSUFFICIENT' ? j.message + '，余额不足' : j.message || '请求失败'), { code: j.error })
    return j
  }
  // 小音效：叮 / 嘣 / 胜利 / 啊哦
  let AC = null; const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  function tone(f0, f1, dur, g = 0.25, type = 'sine', delay = 0) { const c = ac(), o = c.createOscillator(), v = c.createGain(), t = c.currentTime + delay; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur); v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(v); v.connect(c.destination); o.start(t); o.stop(t + dur) }
  const SFX = { tick: () => tone(1400, 1200, 0.05, 0.12, 'square'), pick: () => tone(660, 990, 0.12, 0.2, 'triangle'), win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 0.22, 'triangle', i * 0.09)), lose: () => { tone(400, 300, 0.25, 0.25, 'sawtooth'); tone(300, 180, 0.4, 0.25, 'sawtooth', 0.25) }, boing: () => tone(180, 520, 0.25, 0.3, 'sine') }

  // ─────────── 板块页 ───────────
  window.FunHub = async () => {
    const list = $('#fun-list')
    try {
      const items = await api('/api/fun')
      list.innerHTML = items.map((g, i) => `<a class="fun-card" href="${g.url}" style="--c:${g.color}">
        <div class="cover" style="${g.cover ? `background-image:url('${g.cover}')` : ''}"><span class="tag">${esc(g.tag)}</span>${g.live ? '' : '<span class="soon">拍摄中</span>'}<span class="play"><i class="fas fa-play"></i></span></div>
        <div class="info"><h3>${esc(g.title)}</h3><p>${esc(g.logline)}</p><div class="foot"><span><i class="fas fa-users"></i> ${fmt(g.plays)} 局</span><span class="go">押一单 <i class="fas fa-arrow-right"></i></span></div></div></a>`).join('')
    } catch (e) { list.innerHTML = `<div class="f-empty">${esc(e.message)}</div>` }
  }

  // ─────────── 播放页 ───────────
  window.FunPlay = async (sid) => {
    const stage = $('#fun-stage'), video = $('#fun-video'), poster = $('#fun-poster'), cap = $('#fun-cap'), hud = $('#fun-hud'), betBox = $('#fun-bet'), flash = $('#fun-flash'), side = $('#fun-side'), modal = $('#fun-modal')
    let M, MEDIA, S = { stake: 10, bet: 10, picks: [], quote: null, final: null, run: null, log: [], skipped: false }
    video.controls = false; video.disablePictureInPicture = true
    video.addEventListener('pause', () => { if (video.dataset.playing === '1' && !video.ended) video.play().catch(() => {}) })
    const face = (id) => MEDIA?.faces?.[id] || ''
    function unlockVideo() { try { video.muted = true; video.playsInline = true; video.play()?.catch?.(() => {}); video.pause() } catch {} }
    function tapToPlay() {
      return new Promise((res) => {
        const o = document.createElement('button'); o.className = 'tap-play'; o.innerHTML = '<i class="fas fa-play"></i><span>点一下继续观看</span>'
        stage.appendChild(o); o.onclick = () => { o.remove(); video.muted = false; video.play().then(res, () => { video.muted = true; video.play().then(res, res) }) }
      })
    }
    function clip(key, maxMs, onEnd) {
      const c = MEDIA?.clips?.[key]; if (!c?.url) return sleep(Math.min(maxMs || 3200, 3200))
      return new Promise(async (res) => {
        stage.classList.add('film'); video.src = c.url; video.dataset.playing = '1'; video.muted = false
        let done = false, timer = 0; const fin = () => { if (done) return; done = true; clearTimeout(timer); try { onEnd?.() } catch {} video.dataset.playing = '0'; res() }
        const arm = () => { clearTimeout(timer); timer = setTimeout(fin, Math.min(maxMs || 1e9, (c.dur + 2.5) * 1000)) }
        video.onended = fin; video.onplaying = arm; video.onerror = fin; timer = setTimeout(fin, 20000)
        try { await video.play() } catch { video.muted = true; try { await video.play() } catch { clearTimeout(timer); await tapToPlay(); arm() } }
      })
    }
    function caption(t, cls = '') { cap.className = 'f-cap ' + cls; cap.innerHTML = t; void cap.offsetWidth; cap.classList.add('in') }
    function boom(html, cls) { flash.className = 'f-flash ' + cls; flash.innerHTML = `<div>${html}</div>`; void flash.offsetWidth; flash.classList.add('go') }
    function toast(m) { const t = document.createElement('div'); t.className = 'f-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3200) }
    async function needChips(btn) {
      if (!btn || document.getElementById('faucet-cta')) return
      btn.insertAdjacentHTML('afterend', '<button id="faucet-cta" class="btn ghost" style="width:100%;margin-top:8px"><i class="fas fa-gift"></i> 余额不足 · 领取 500 免费币</button>')
      document.getElementById('faucet-cta').onclick = async (e) => { try { await api('/api/me/faucet', { body: {} }); e.currentTarget.remove(); toast('+500 Chips 已到账，再点交单') } catch (er) { toast(er.message) } }
    }
    function renderHud() { hud.innerHTML = S.run ? `<span class="pill"><i class="fas fa-receipt"></i> 押注单 ${fmt(S.run.stake)} · 全中 <b>${xm(S.run.quote.mult[3])}</b></span>${S.run.final ? `<span class="pill"><i class="fas fa-crown"></i> ${esc(S.run.final.label)} ${xm(S.run.final.odds)}</span>` : ''}` : `<span class="pill"><i class="fas fa-face-laugh-squint"></i> 开心1分钟 · ${esc(M.title)}</span>` }

    function payTable() {
      const q = S.quote
      return `<div class="pay-table">${[1, 2, 3].map((h) => `<div class="pay ${h === 3 ? 'top' : ''}"><span>中 ${h} 条</span><em>${pct(q.P[h])}</em><b>${q.mult[h] ? xm(q.mult[h]) : '—'}</b><strong>${fmt(Math.floor(S.stake * (q.mult[h] || 0)))}</strong></div>`).join('')}</div>${q.ok ? '' : '<p class="warn">这几条几乎不可能同时成立，换一档试试</p>'}`
    }
    async function requote() { try { S.quote = await api(`/api/fun/${sid}/quote`, { body: { picks: S.picks } }) } catch (e) { toast(e.message) } $('#pay').innerHTML = payTable(); $('#go').disabled = !S.quote?.ok }
    function lobby() {
      S.picks = S.picks.length ? S.picks : [...M.slip_default.picks]; S.quote = S.quote || M.slip_default
      poster.src = MEDIA?.cover || ''; stage.classList.remove('film'); caption(esc(M.logline), 'intro')
      side.innerHTML = `
        <div class="s-title"><span class="tag" style="background:${M.color}">${esc(M.tag)}</span><h2>${esc(M.title)}</h2>
          <div class="cast">${M.cast.map((c) => `<div class="cm"><i style="${face(c.id) ? `background-image:url('${face(c.id)}')` : ''}"></i><b>${esc(c.name)}</b><small>${esc(c.role)}</small></div>`).join('')}</div></div>
        <div class="s-block"><h4><i class="fas fa-receipt"></i> 押注单 · 开局一次押三条</h4>
          ${M.legs.map((l, k) => `<div class="leg"><div class="lk">${esc(l.title)}</div><div class="bins" style="--n:${Math.min(l.bins.length, 5)}">${l.bins.map((b) => `<button class="sb ${S.picks[k] === b.id ? 'on' : ''}" data-k="${k}" data-id="${b.id}"><span>${esc(b.label)}</span><small>${pct(b.p)}</small></button>`).join('')}</div></div>`).join('')}
          <div id="pay">${payTable()}</div></div>
        <div class="s-block"><h4>注金</h4><div class="stakes">${M.cfg.stakes.map((v) => `<button class="stake ${v === S.stake ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div></div>
        <div class="s-block"><h4><i class="fas fa-crown"></i> ${esc(M.final.title)}（可选 · 同注金）</h4><div class="finals">${M.final.opts.map((o) => `<button class="fo ${S.final === o.id ? 'on' : ''}" data-id="${o.id}"><span>${esc(o.label)}</span><b>${xm(o.odds)}</b></button>`).join('')}</div></div>
        <button id="go" class="btn big" ${S.quote.ok ? '' : 'disabled'}><i class="fas fa-clapperboard"></i> 交单 · 开拍！</button>
        <details class="s-block rules"><summary>公开规则 · 概率怎么来的</summary><ul>${M.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p>押注单赔率按整棵概率树精确计算（中 1/2/3 条分得 12% / 36% / 45%），任何押法期望 93%；快押 94%；押主角 92%。结果开局锁定，结束公开种子可复算。</p></details>
        <div class="s-block recent"><h4>战报</h4>${M.recent.length ? M.recent.map((r) => `<div>${esc(r.who)} 押注单中 <b>${r.hits}</b>/3 ${r.win ? `<b class="gold">+${fmt(r.win)}</b>` : '<span class="mut">没中</span>'}</div>`).join('') : '<div class="mut">还没有人押过，来当第一个</div>'}</div>`
      side.querySelectorAll('.sb').forEach((b) => (b.onclick = () => { const k = +b.dataset.k; S.picks[k] = b.dataset.id; side.querySelectorAll(`.sb[data-k="${k}"]`).forEach((x) => x.classList.toggle('on', x === b)); SFX.pick(); requote() }))
      side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)); $('#pay').innerHTML = payTable() }))
      side.querySelectorAll('.fo').forEach((b) => (b.onclick = () => { S.final = S.final === b.dataset.id ? null : b.dataset.id; side.querySelectorAll('.fo').forEach((x) => x.classList.toggle('on', x.dataset.id === S.final)); SFX.pick() }))
      $('#go').onclick = start; renderHud()
    }
    function liveSide() {
      side.innerHTML = `<div class="s-title"><span class="tag" style="background:${M.color}">${esc(M.tag)}</span><h2>${esc(M.title)}</h2></div>
        <div class="s-block"><h4><i class="fas fa-receipt"></i> 我的押注单 · ${fmt(S.run.stake)}</h4>${M.legs.map((l, k) => `<div class="slip-line ${S.res ? (S.res.slip.rows[k].hit ? 'hit' : 'miss') : ''}"><span>${esc(l.title)}</span><em>${esc(l.bins.find((b) => b.id === S.run.quote.picks[k])?.label)}</em>${S.res ? `<b>${esc(S.res.slip.rows[k].actual_label)}</b>` : '<b>待揭晓</b>'}</div>`).join('')}
          <div class="pay-mini">${[1, 2, 3].map((h) => `<span class="${S.res?.slip.hits === h ? 'on' : ''}">中${h} ${xm(S.run.quote.mult[h])}</span>`).join('')}</div></div>
        <div class="s-block"><h4>剧情进度</h4><ol class="log">${S.log.length ? S.log.map((l) => `<li class="${l.cls}"><span>${esc(l.title)}</span><em>${esc(l.out)}</em><b>${esc(l.tag)}</b></li>`).join('') : '<li><em>开拍中……</em></li>'}</ol></div>
        <button class="btn ghost" id="skip"><i class="fas fa-forward"></i> 不快押了 · 直接看完</button>`
      $('#skip').onclick = skip
    }

    async function start() {
      ac().resume?.(); unlockVideo()
      const b = $('#go'); b.disabled = true; b.textContent = '开拍准备…'
      try {
        const body = { stake: S.stake, picks: S.picks, final: S.final, final_stake: S.final ? S.stake : 0 }
        let r
        try { r = await api(`/api/fun/${sid}/start`, { body }) } catch (e) {
          if (e.code !== 'ONE_AT_A_TIME' || !M.open_run) throw e
          await api(`/api/fun/${M.open_run.sid}/runs/${M.open_run.id}/skip`, { body: {} }).catch(() => {}); M.open_run = null; r = await api(`/api/fun/${sid}/start`, { body })
        }
        Object.assign(S, { run: r, log: [], res: null, skipped: false }); renderHud(); liveSide()
        caption(esc(r.intro.cap)); await clip(r.intro.clip)
        await step(r.step)
      } catch (e) { b.disabled = false; b.innerHTML = '<i class="fas fa-clapperboard"></i> 交单 · 开拍！'; toast(e.message); if (e.code === 'INSUFFICIENT') needChips(b) }
    }
    async function step(st) {
      if (S.skipped) return
      caption(`<small>${esc(st.title)}</small>${esc(st.cap)}`)
      const pre = clip(st.pre[0], 6500)
      betBox.innerHTML = `<div class="q"><b>${esc(st.q)}</b><span id="sec"></span></div>
        <div class="opts" style="--n:${st.opts.length}">${st.opts.map((o) => `<button class="qo" data-id="${o.id}"><span>${esc(o.label)}</span><b>${xm(o.odds)}</b></button>`).join('')}</div>
        <div class="chips"><span>快押</span>${M.cfg.stakes.slice(0, 4).map((v) => `<button class="chip ${v === S.bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}<button class="watch" id="watch">只看 <i class="fas fa-eye"></i></button></div><div class="bar"><i id="bar"></i></div>`
      betBox.classList.remove('hidden', 'locked'); void betBox.offsetWidth; betBox.classList.add('in')
      betBox.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.bet = +b.dataset.v; betBox.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)) }))
      const arm = await api(`/api/fun/${sid}/runs/${S.run.run_id}/arm`, { body: {} })
      const lockAt = arm.lock_at + (Date.now() - arm.server_time) - 800, total = lockAt - Date.now()
      let sent = false, res = null, last = 9
      const submit = (body) => new Promise(async (ok) => {
        if (sent) return; sent = true; clearInterval(tm); betBox.classList.add('locked')
        try { res = await api(`/api/fun/${sid}/runs/${S.run.run_id}/act`, { body: { i: st.i, ...body } }) } catch (e) { toast(e.message); if (['RUN_ENDED', 'DUPLICATE', 'STALE_ROUND'].includes(e.code)) setTimeout(() => location.reload(), 1500) }
        ok()
      })
      let done
      const waitPick = new Promise((r) => (done = r))
      betBox.querySelectorAll('.qo').forEach((b) => (b.onclick = () => { b.classList.add('on'); SFX.pick(); submit({ opt: b.dataset.id, bet: S.bet }).then(done) }))
      $('#watch').onclick = () => submit({}).then(done)
      const tm = setInterval(() => { const left = lockAt - Date.now(), bar = $('#bar'); if (!bar) return; bar.style.width = Math.max(0, (left / total) * 100) + '%'; const s = Math.max(0, Math.ceil(left / 1000)); $('#sec').textContent = s + 's'; if (s < last) { last = s; if (s <= 3) SFX.tick() } if (left <= 0) submit({}).then(done) }, 100)
      await Promise.all([pre, waitPick])
      betBox.classList.add('hidden'); if (!res) return
      await perform(st, res)
    }
    async function perform(st, r) {
      caption(`<small>${esc(st.title)}</small><b class="out">${esc(r.out_label)}</b>`, 'reveal'); SFX.boing()
      for (const k of r.post.clips) await clip(k)
      if (r.post.cap) { caption(esc(r.post.cap), 'post'); if (!r.post.clips.length) await sleep(2000); else await sleep(900) }
      S.log.push({ title: st.title, out: r.out_label, cls: r.side ? (r.side.hit ? 'hit' : 'miss') : '', tag: r.side ? (r.side.hit ? `+${fmt(r.side.payout)}` : `-${fmt(r.side.bet)}`) : '只看' })
      if (r.side) { boom(`${r.side.hit ? '快押命中！' : '没押中'}<small>${esc(r.side.label)} · ${r.side.hit ? '+' + fmt(r.side.payout) : '-' + fmt(r.side.bet)}</small>`, r.side.hit ? 'hit' : 'miss'); r.side.hit ? SFX.win() : SFX.lose(); await sleep(1100) }
      liveSide()
      if (r.ended) return finale(r)
      return step(r.next)
    }
    async function skip() {
      if (S.skipped || !S.run) return; S.skipped = true; betBox.classList.add('hidden')
      try { const r = await api(`/api/fun/${sid}/runs/${S.run.run_id}/skip`, { body: {} })
        for (const s of r.rest) { caption(`<small>${esc(s.title)}</small>${esc(s.cap)}`); await clip(s.pre[0], 4500); caption(`<small>${esc(s.title)}</small><b class="out">${esc(s.out_label)}</b>`, 'reveal'); for (const k of s.post.clips) await clip(k); S.log.push({ title: s.title, out: s.out_label, cls: '', tag: '只看' }); liveSide() }
        finale(r) } catch (e) { S.skipped = false; toast(e.message) }
    }
    function grabFrame() {
      try { if (!video.videoWidth) return; const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); c.toDataURL(); S.frame = c } catch (e) { S.frame = null }
    }
    const loadImg = (u) => new Promise((ok) => { if (!u) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u })
    function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
    function wrap(g, t, x, y, maxW, lh, maxL) { let line = '', n = 0; for (const ch of t) { if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); y += lh; line = ch; if (++n >= maxL - 1) { line = t.slice(t.indexOf(line)); break } } else line += ch } let rest = line; while (g.measureText(rest).width > maxW && rest.length > 1) rest = rest.slice(0, -2) + '…'; g.fillText(rest, x, y); return y + lh }
    async function drawPoster(r) {
      const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), C = M.color || '#ffb020', s = r.slip
      const bg = S.frame || await loadImg(MEDIA?.cover)
      g.fillStyle = '#1b1210'; g.fillRect(0, 0, W, H)
      if (bg) { const k = Math.max(W / bg.width, H / bg.height), w = bg.width * k, h = bg.height * k; g.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h) }
      let gr = g.createLinearGradient(0, 0, 0, 520); gr.addColorStop(0, 'rgba(0,0,0,.72)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, 520)
      gr = g.createLinearGradient(0, H * 0.36, 0, H); gr.addColorStop(0, 'rgba(20,12,8,0)'); gr.addColorStop(.3, 'rgba(20,12,8,.82)'); gr.addColorStop(1, 'rgba(20,12,8,.97)'); g.fillStyle = gr; g.fillRect(0, H * 0.36, W, H * 0.64)
      const F = '"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif'; g.textBaseline = 'top'
      // header
      g.fillStyle = C; rr(g, 64, 72, 230, 64, 32); g.fill(); g.fillStyle = '#1b1210'; g.font = `800 32px ${F}`; g.fillText('开心1分钟', 92, 86)
      g.fillStyle = '#fff'; g.font = `900 92px ${F}`; g.fillText(M.title, 64, 168)
      g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `500 34px ${F}`; g.fillText(M.tag || '', 66, 280)
      // big result
      let y = 760
      g.fillStyle = s.hits === 3 ? '#ffd23f' : '#fff'; g.font = `900 120px ${F}`
      g.fillText(s.hits === 3 ? '三条全中！' : `押注单 中 ${s.hits}/3`, 64, y); y += 150
      if (s.mult) { g.fillStyle = C; g.font = `900 84px ${F}`; g.fillText(`${xm(s.mult)}  ·  ${fmt(s.stake)} → ${fmt(s.payout)}`, 64, y); y += 112 }
      g.fillStyle = 'rgba(255,255,255,.88)'; g.font = `600 38px ${F}`; y = wrap(g, r.ending.cap || '', 64, y + 10, W - 128, 54, 3) + 24
      // legs
      for (const x of s.rows) {
        g.fillStyle = x.hit ? 'rgba(46,204,113,.2)' : 'rgba(255,255,255,.08)'; rr(g, 64, y, W - 128, 104, 24); g.fill()
        g.fillStyle = x.hit ? '#2ecc71' : '#ff5470'; g.font = `900 52px ${F}`; g.fillText(x.hit ? '✓' : '✕', 96, y + 24)
        g.fillStyle = 'rgba(255,255,255,.65)'; g.font = `600 30px ${F}`; g.fillText(x.title, 168, y + 16)
        g.fillStyle = '#fff'; g.font = `800 38px ${F}`; g.fillText(`押 ${x.pick_label}`, 168, y + 54)
        g.textAlign = 'right'; g.fillStyle = x.hit ? '#2ecc71' : 'rgba(255,255,255,.75)'; g.font = `700 34px ${F}`; g.fillText(`实际：${x.actual_label}`, W - 96, y + 36); g.textAlign = 'left'
        y += 124
      }
      // net
      y += 10; g.fillStyle = 'rgba(255,255,255,.65)'; g.font = `600 34px ${F}`; g.fillText(r.final ? `押主角 · ${r.final.label} ${r.final.hit ? '命中 +' + fmt(r.final.payout) : '未中'}` : `结局 · ${r.final_actual.label}`, 64, y)
      g.textAlign = 'right'; g.fillStyle = r.net >= 0 ? '#2ecc71' : '#ff5470'; g.font = `900 46px ${F}`; g.fillText(`本局 ${r.net >= 0 ? '+' : ''}${fmt(r.net)}`, W - 64, y - 6); g.textAlign = 'left'
      // footer
      g.fillStyle = C; rr(g, 64, H - 210, W - 128, 140, 36); g.fill()
      g.fillStyle = '#1b1210'; g.font = `900 48px ${F}`; g.fillText('你能押得比我准吗？', 108, H - 186)
      g.font = `600 28px ${F}`; g.fillText(location.host + location.pathname, 108, H - 122)
      g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `500 24px ${F}`; g.fillText('结果开局锁定 · 可公开复算 · commit ' + String(r.verify.commit).slice(0, 12), 64, H - 50)
      return c
    }
    async function sharePoster(r) {
      const txt = `我在《${M.title}》押注单中了 ${r.slip.hits}/3${r.slip.mult ? ' ' + xm(r.slip.mult) : ''}！结局：${r.final_actual.label} ${location.href}`
      let c; try { c = await drawPoster(r) } catch (e) { navigator.clipboard?.writeText(txt); return toast('战绩已复制') }
      let url; try { url = c.toDataURL('image/jpeg', .9) } catch (e) { S.frame = null; c = await drawPoster(r); url = c.toDataURL('image/jpeg', .9) }
      const ov = document.createElement('div'); ov.className = 'f-share'; ov.id = 'fun-poster-modal'
      ov.innerHTML = `<div class="pp"><img src="${url}" alt="战绩海报"><div class="acts"><a class="btn" id="pdl" download="${M.title}-战绩.jpg" href="${url}"><i class="fas fa-download"></i> 保存海报</a><button class="btn ghost" id="psh"><i class="fas fa-share-nodes"></i> 分享</button><button class="btn ghost" id="pcl">关闭</button></div><p>长按图片也可保存，发到小红书 / 抖音 / 朋友圈</p></div>`
      document.body.appendChild(ov)
      ov.onclick = (e) => { if (e.target === ov) ov.remove() }; $('#pcl').onclick = () => ov.remove()
      $('#psh').onclick = async () => {
        try { const blob = await (await fetch(url)).blob(), file = new File([blob], 'poster.jpg', { type: 'image/jpeg' })
          if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text: txt })
        } catch (e) { if (e.name === 'AbortError') return }
        navigator.clipboard?.writeText(txt); toast('文案和链接已复制，配上海报去发吧')
      }
    }
    async function finale(r) {
      S.res = r; liveSide()
      caption(esc(r.ending.cap), 'ending'); S.frame = null; await clip(r.ending.clip, 0, () => grabFrame())
      if (!S.frame) grabFrame()
      const s = r.slip; s.hits >= 2 || r.final?.hit ? SFX.win() : SFX.lose()
      modal.innerHTML = `<div class="f-card ${s.hits === 3 ? 'perfect' : ''}">
        <div class="k">${s.hits === 3 ? '押注单 · 三条全中！' : `押注单 · 中 ${s.hits}/3`}</div>
        <p class="end-cap">${esc(r.ending.cap)}</p>
        <div class="slip-end">${s.rows.map((x) => `<div class="${x.hit ? 'hit' : 'miss'}"><span>${esc(x.title)}</span><em>${esc(x.pick_label)}</em><b>${x.hit ? '✓' : '✕'} ${esc(x.actual_label)}</b></div>`).join('')}</div>
        <div class="kv"><span>押注单</span><b>${fmt(s.stake)} → ${fmt(s.payout)}${s.mult ? ` (${xm(s.mult)})` : ''}</b>
          ${r.final ? `<span>押主角 · ${esc(r.final.label)}</span><b class="${r.final.hit ? 'up' : 'down'}">${r.final.hit ? '+' + fmt(r.final.payout) : '没中（实际：' + esc(r.final_actual.label) + '）'}</b>` : `<span>结局</span><b>${esc(r.final_actual.label)}</b>`}
          ${r.side_total.staked ? `<span>快押</span><b>${fmt(r.side_total.staked)} → ${fmt(r.side_total.paid)}</b>` : ''}
          <span>本局净额</span><b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
        <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><p>第 i 步结果 = HMAC(seed,"f:i") 落在公开概率的哪个区间。</p><a href="/api/fun/${sid}/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details>
        <div class="acts"><button class="btn" id="again"><i class="fas fa-rotate-right"></i> 再押一单</button><button class="btn ghost" id="share"><i class="fas fa-share-nodes"></i> 晒战绩</button><a class="btn ghost" href="/fun">换一部</a></div></div>`
      modal.classList.remove('hidden')
      $('#again').onclick = async () => { modal.classList.add('hidden'); M = await api(`/api/fun/${sid}/meta`); MEDIA = M.media; Object.assign(S, { run: null, res: null, log: [] }); lobby() }
      $('#share').onclick = () => sharePoster(r)
    }

    try { M = await api(`/api/fun/${sid}/meta`); MEDIA = M.media } catch (e) { side.innerHTML = `<div class="f-empty">${esc(e.message)}</div>`; return }
    stage.style.setProperty('--c', M.color); lobby()
  }
})()
