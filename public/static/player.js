// Agent-5 · Cash Stage 专属交互播放器
// 剧情段落 → 节点预告冻结 → 下注面板(倒计时环/赔率跳动) → 咔哒锁盘 → 本地解密揭晓 → 筹码结算 → 倒带悔棋 → 一键验证公平
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const layer = $('#stage-layer'), side = $('#side-panel'), modalRoot = $('#modal-root')
  const SERIES = location.pathname.startsWith('/play/') ? location.pathname.split('/')[2] : 'rooftop'
  const uid = localStorage.df_uid || (localStorage.df_uid = 'u_' + Math.random().toString(36).slice(2, 10))
  const nick = localStorage.df_nick || (localStorage.df_nick = '玩家' + uid.slice(-4).toUpperCase())
  const S = { series: null, nodes: [], idx: 0, mode: 'solo', me: null, round: null, path: [], log: [], stake: 50, sel: null, betPlaced: false, sessionStart: Date.now(), clientCommit: null, lastOdds: {} }
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', 'x-user-id': uid, ...(opt.headers || {}) }, body: opt.body ? JSON.stringify({ user_id: uid, ...opt.body }) : undefined })
    const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.message || j.error), { code: j.error }); return j
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ─────────── 音效（WebAudio 合成，无外部资源） ───────────
  let AC = null
  const tone = (f, d = 0.08, type = 'sine', v = 0.15, when = 0) => {
    try {
      AC ||= new (window.AudioContext || window.webkitAudioContext)()
      const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f
      g.gain.setValueAtTime(v, AC.currentTime + when); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + d)
      o.connect(g).connect(AC.destination); o.start(AC.currentTime + when); o.stop(AC.currentTime + when + d + 0.02)
    } catch {}
  }
  const SFX = {
    tick: () => tone(1200, 0.03, 'square', 0.04),
    heart: () => { tone(60, 0.12, 'sine', 0.4); tone(55, 0.12, 'sine', 0.3, 0.16) },
    lock: () => { tone(180, 0.05, 'square', 0.25); tone(90, 0.12, 'triangle', 0.3, 0.04) },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)),
    lose: () => [300, 240].forEach((f, i) => tone(f, 0.3, 'sine', 0.1, i * 0.15)),
    select: () => tone(880, 0.05, 'sine', 0.08),
    rewind: () => { for (let i = 0; i < 10; i++) tone(900 - i * 60, 0.06, 'sawtooth', 0.03, i * 0.12) }
  }

  // ─────────── 程序化镜头渲染器（静帧+运镜+粒子 = motion-still 兜底模型） ───────────
  const cv = $('#fx-canvas'), ctx = cv.getContext('2d')
  const R = { mood: '冷清', rain: 1, zoom: 1, targetZoom: 1.04, flash: 0, tint: [20, 30, 70], freeze: false, pan: 0, chars: 2, t0: performance.now() }
  const MOOD = { 冷清: [20, 30, 70], 冷静: [18, 40, 80], 紧张: [70, 20, 40], 担心: [40, 30, 70], 隐忍: [30, 30, 60], 冷笑: [60, 15, 25], 决绝: [80, 30, 10], 悬念: [50, 20, 70], 余韵: [70, 50, 30], 决断: [80, 40, 10], 希望: [40, 60, 70] }
  let W = 0, H = 0, drops = [], blds = []
  const resize = () => {
    const r = cv.getBoundingClientRect(); W = cv.width = r.width * devicePixelRatio; H = cv.height = r.height * devicePixelRatio
    drops = Array.from({ length: 220 }, () => ({ x: Math.random() * W, y: Math.random() * H, l: 10 + Math.random() * 25, s: 8 + Math.random() * 14 }))
    let x = -20; blds = []
    while (x < W * 1.3) { const w = 40 + Math.random() * 90; blds.push({ x, w, h: H * (0.25 + Math.random() * 0.45), win: Math.random() }); x += w + 6 }
  }
  addEventListener('resize', resize); resize()
  const setMood = (m) => { R.mood = m; R.tint = MOOD[m] || MOOD['冷清'] }
  const frame = (now) => {
    const t = (now - R.t0) / 1000
    R.zoom += (R.targetZoom - R.zoom) * 0.01
    const [r, g, b] = R.tint
    ctx.setTransform(R.zoom, 0, 0, R.zoom, (W - W * R.zoom) / 2 + Math.sin(t * 0.1) * 8 + R.pan, (H - H * R.zoom) / 2)
    const grd = ctx.createLinearGradient(0, 0, 0, H)
    grd.addColorStop(0, `rgb(${r * 0.3},${g * 0.3},${b * 0.5})`); grd.addColorStop(0.6, `rgb(${r},${g},${b})`); grd.addColorStop(1, '#05060c')
    ctx.fillStyle = grd; ctx.fillRect(-50, -50, W + 100, H + 100)
    // 远景楼群 + 霓虹窗
    for (const bd of blds) {
      ctx.fillStyle = 'rgba(5,6,14,.92)'; ctx.fillRect(bd.x, H * 0.72 - bd.h, bd.w, bd.h + H)
      for (let wy = H * 0.72 - bd.h + 10; wy < H * 0.72; wy += 14) for (let wx = bd.x + 6; wx < bd.x + bd.w - 6; wx += 11) {
        const on = Math.sin(wx * 13.1 + wy * 7.7 + bd.win * 99) > 0.55
        if (on) { ctx.fillStyle = (wx + wy) % 3 < 1 ? 'rgba(255,90,160,.55)' : 'rgba(120,200,255,.45)'; ctx.fillRect(wx, wy, 5, 7) }
      }
    }
    // 天台地面 + 栏杆
    ctx.fillStyle = '#07080f'; ctx.fillRect(-50, H * 0.78, W + 100, H)
    ctx.strokeStyle = 'rgba(245,196,81,.25)'; ctx.lineWidth = 2 * devicePixelRatio
    ctx.beginPath(); ctx.moveTo(-50, H * 0.74); ctx.lineTo(W + 50, H * 0.74); ctx.stroke()
    for (let x = 0; x < W; x += 36 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, H * 0.74); ctx.lineTo(x, H * 0.78); ctx.stroke() }
    // 角色剪影
    const sil = (cx, hgt, coat) => {
      ctx.fillStyle = '#020307'; ctx.beginPath(); ctx.ellipse(cx, H * 0.78 - hgt, hgt * 0.09, hgt * 0.11, 0, 0, 7); ctx.fill()
      ctx.beginPath(); ctx.moveTo(cx - hgt * 0.16, H * 0.8); ctx.lineTo(cx - hgt * 0.12, H * 0.78 - hgt * 0.85); ctx.lineTo(cx + hgt * 0.12, H * 0.78 - hgt * 0.85); ctx.lineTo(cx + hgt * (coat ? 0.2 : 0.15), H * 0.8); ctx.fill()
      ctx.strokeStyle = 'rgba(120,200,255,.35)'; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.stroke()
    }
    if (R.chars >= 1) sil(W * 0.33, H * 0.2, true)
    if (R.chars >= 2) sil(W * 0.68, H * 0.22, false)
    // 雨
    ctx.strokeStyle = 'rgba(180,200,255,.35)'; ctx.lineWidth = 1 * devicePixelRatio
    ctx.beginPath()
    const sp = R.freeze ? 0.06 : R.rain
    for (const d of drops) { d.y += d.s * sp; d.x -= d.s * sp * 0.2; if (d.y > H) { d.y = -20; d.x = Math.random() * W * 1.2 } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.2, d.y - d.l) }
    ctx.stroke()
    // 闪电 / 锁盘闪光
    if (Math.random() < 0.002 && !R.freeze) R.flash = 0.6
    if (R.flash > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(220,230,255,${R.flash})`; ctx.fillRect(0, 0, W, H); R.flash *= 0.88; if (R.flash < 0.01) R.flash = 0 }
    // 暗角
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.75)')
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ─────────── Base64 & AES-GCM 本地解密（REVEAL 才拿到密钥） ───────────
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  async function decryptSlot(slot, keyB64) {
    const key = await crypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['decrypt'])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(slot.iv) }, key, unb64(slot.ct))
    return JSON.parse(new TextDecoder().decode(pt).trim())
  }
  async function localHmac(seedHex, msg) {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(seedHex.match(/.{2}/g).map((h) => parseInt(h, 16))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  // ─────────── HUD ───────────
  function hud(extra = '') {
    const cashIdx = S.nodes.filter((n) => n.kind !== 'ending')
    const prog = cashIdx.map((n, i) => `<i class="${n.kind === 'cash' ? 'cash' : ''} ${i < S.idx ? 'done' : i === S.idx ? 'now' : ''}"></i>`).join('')
    return `<div class="progress">${prog}</div>
      <div class="hud-top"><div class="chip-balance" id="hud-chips"><i class="fas fa-coins"></i> ${S.me?.chips ?? '—'}</div>
      ${S.round ? `<div class="commit-badge" id="commit-badge" title="点击查看完整承诺哈希">🔒 结果已锁定 <b>#${S.round.commit.slice(0, 8)}…</b></div>` : ''}</div>${extra}`
  }
  const setChips = (v) => { if (S.me) S.me.chips = v; const e = $('#hud-chips'); if (e) e.innerHTML = `<i class="fas fa-coins"></i> ${v}`; renderSide() }
  layer.addEventListener('click', (e) => { if (e.target.closest('#commit-badge')) showCommit() })

  // ─────────── 首页 ───────────
  async function home() {
    S.idx = 0; S.path = []; S.round = null
    setMood('冷清'); R.freeze = false; R.targetZoom = 1.02
    layer.innerHTML = `${hud()}<div class="spacer"></div>
      <div class="home">
        <div class="sub" style="letter-spacing:4px;color:var(--gold)">对弈式交互剧 · 第 1 集</div>
        <h1>${esc(S.series.title)}</h1>
        <div class="log">${esc(S.series.logline)}</div>
        <div class="poem">${esc(S.series.poem || '')}</div>
        <div class="mode-tabs" id="mode-tabs">
          <button data-m="solo" class="${S.mode === 'solo' ? 'on' : ''}"><i class="fas fa-user"></i> Solo 固定赔率</button>
          <button data-m="arena" class="${S.mode === 'arena' ? 'on' : ''}"><i class="fas fa-users"></i> Arena 全网彩池</button>
          <button disabled title="Phase 2"><i class="fas fa-chess"></i> Duel</button>
        </div>
        <button class="start-btn" id="start-btn"><i class="fas fa-play"></i> 开 局</button>
        <div class="first-bet">${S.nodes.filter((n) => n.kind === 'cash').length} 个抉择点 · 每局结果在下注前锁定 · 可一键验证公平</div>
      </div>`
    $('#mode-tabs').onclick = (e) => { const b = e.target.closest('button[data-m]'); if (b) { S.mode = b.dataset.m; SFX.select(); home() } }
    $('#start-btn').onclick = () => { SFX.select(); step() }
  }

  // ─────────── 主流程 ───────────
  async function step() {
    const n = S.nodes[S.idx]
    if (!n || n.kind === 'ending') return ending()
    if (n.kind === 'scene') { await playScene(n); S.idx++; return step() }
    if (n.kind === 'cash') return cashNode(n)
  }

  async function playLines(lines, titleHtml = '') {
    for (const l of lines) {
      setMood(l.mood)
      R.chars = /林夏|陈默/.test(l.speaker) ? 2 : l.speaker === '渡鸦' ? 1 : R.chars
      layer.innerHTML = `${hud(titleHtml)}<div class="spacer"></div>
        <div class="subtitle" id="sub"><div class="sp"><i class="fas fa-quote-left"></i>${esc(l.speaker)} <em>${esc(l.mood || '')}</em></div>
        <div class="tx">${esc(l.text)}</div><div class="tap">点击继续 ▸</div></div>`
      await new Promise((res) => { const t = setTimeout(res, 1800 + String(l.text).length * 90); $('#sub').onclick = () => { clearTimeout(t); res() } })
    }
  }
  async function playScene(n) {
    R.freeze = false; R.targetZoom = 1.08
    await playLines(n.lines || [], `<div class="scene-title">— ${esc(n.title)} —</div>`)
  }

  // ─────────── Cash 节点：OPEN/COMMIT → 预告 → BETTING ───────────
  async function cashNode(n, rewound = null) {
    S.sel = null; S.betPlaced = false
    let rd
    try { rd = rewound || (await api('/api/rounds/open', { method: 'POST', body: { node_id: n.id, mode: S.mode } })) }
    catch (e) { return toastStage(e.message) }
    S.round = rd; S.clientCommit = rd.commit; S.offset = rd.server_time - Date.now(); S.lastOdds = { ...rd.odds }
    // ② 节点预告：画面冻结，问题浮现，承诺角标闪烁
    R.freeze = true; R.targetZoom = 1.15; setMood('悬念'); SFX.heart()
    layer.innerHTML = `${hud()}<div class="spacer"></div>
      <div class="question"><small>${rewound ? '这一次，故事不同' : S.mode === 'arena' ? 'ARENA · 全网同押' : '抉择时刻'}</small>${esc(rd.question)}</div><div style="height:30vh"></div>`
    setTimeout(() => $('#commit-badge')?.classList.add('flash'), 200)
    await sleep(2400)
    betting(n)
  }

  function betting(n) {
    const rd = S.round
    const opts = rd.options
    const total = opts.reduce((a, o) => a + (o.heat || 0), 0)
    const maxStake = Math.max(rd.min_bet, Math.min(S.me.chips, 1000))
    if (S.stake < rd.min_bet) S.stake = rd.min_bet
    if (S.stake > maxStake) S.stake = maxStake
    const hints = opts.map((o) => o.hint).filter(Boolean)
    layer.innerHTML = `${hud()}<div class="spacer"></div>
      <div class="subtitle" id="sus" style="margin-bottom:8px;min-height:auto"><div class="sp"><i class="fas fa-wind"></i>悬念空镜</div><div class="tx" id="sus-tx" style="font-size:14px">${esc(hints[0] || '')}</div></div>
      <div class="question" style="font-size:18px;margin-bottom:8px">${esc(rd.question)}</div>
      <div class="bet-panel" id="bet-panel">
        ${opts.map((o) => `<div class="opt" data-o="${o.id}">
          <div class="heat" style="width:${total ? ((o.heat / total) * 100).toFixed(1) : 0}%"></div>
          <div class="lb"><b>${esc(o.label)}</b><span>${esc(o.hint || '')}</span></div>
          ${rd.mode === 'arena' ? `<div class="pct" data-pct="${o.id}">${total ? Math.round((o.heat / total) * 100) : 0}%</div>` : ''}
          <div class="od" data-od="${o.id}">×${o.odds}</div></div>`).join('')}
        <div class="stake-row" id="stake-row">${[rd.min_bet, 50, 100, 'MAX'].filter((v, i, a) => a.indexOf(v) === i).map((v) => `<button data-s="${v}">${v === 'MAX' ? 'MAX' : v}</button>`).join('')}</div>
        <input type="range" class="slider" id="stake-slider" min="${rd.min_bet}" max="${maxStake}" value="${S.stake}" step="1">
        <div class="confirm-row">
          <div class="ring" id="ring"><svg width="64" height="64"><circle cx="32" cy="32" r="28" stroke="#232a47" stroke-width="5" fill="none"/><circle id="ring-c" cx="32" cy="32" r="28" stroke="#f5c451" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="175.9" stroke-dashoffset="0"/></svg><div class="num" id="ring-n">12</div></div>
          <button class="btn-bet" id="btn-bet" disabled>选择一个选项</button>
        </div>
        <div class="bet-meta"><span id="win-est">预计赢得 —</span><span>${rd.mode === 'arena' ? '彩池赔率 · rake 8%' : 'AI 庄家固定赔率'}${rd.rewind_count ? ` · 悔棋第 ${rd.rewind_count} 次，最低 ${rd.min_bet}` : ''}</span></div>
        <div style="text-align:center;margin-top:4px"><button class="watch-link" id="watch">不下注，仅观战 →</button></div>
      </div>`
    const panel = $('#bet-panel')
    const refresh = () => {
      panel.querySelectorAll('.opt').forEach((e) => e.classList.toggle('sel', e.dataset.o === S.sel))
      panel.querySelectorAll('#stake-row button').forEach((b) => b.classList.toggle('on', String(b.dataset.s) === String(S.stake) || (b.dataset.s === 'MAX' && S.stake === maxStake)))
      const btn = $('#btn-bet')
      if (S.betPlaced) { btn.className = 'btn-bet placed'; btn.disabled = false; btn.innerHTML = `<i class="fas fa-lock"></i> 已下注 · 立即锁盘揭晓` }
      else { btn.className = 'btn-bet'; btn.disabled = !S.sel; btn.textContent = S.sel ? `确认押注 ${S.stake} Chips` : '选择一个选项' }
      const od = S.lastOdds[S.sel]
      $('#win-est').textContent = S.sel ? `预计赢得 ${Math.floor(S.stake * od)} Chips` : '预计赢得 —'
    }
    panel.onclick = async (e) => {
      const o = e.target.closest('.opt'); const s = e.target.closest('#stake-row button')
      if (o && !S.betPlaced) { S.sel = o.dataset.o; SFX.select(); navigator.vibrate?.(15); refresh() }
      if (s && !S.betPlaced) { S.stake = s.dataset.s === 'MAX' ? maxStake : Math.min(maxStake, +s.dataset.s); $('#stake-slider').value = S.stake; refresh() }
    }
    $('#stake-slider').oninput = (e) => { if (!S.betPlaced) { S.stake = +e.target.value; refresh() } }
    $('#watch').onclick = () => lockAndReveal(n)
    let pressT = 0
    $('#btn-bet').onclick = async () => {
      if (S.betPlaced) return lockAndReveal(n)
      if (!S.sel) return
      // 防误触：大额 (>日限额 30%) 需二次确认
      if (S.stake > (S.me.daily_limit || 5000) * 0.3 && Date.now() - pressT > 1500) { pressT = Date.now(); $('#btn-bet').textContent = '大额下注，再点一次确认'; return }
      const btn = $('#btn-bet'); btn.disabled = true; btn.textContent = '提交中…'
      try {
        const r = await api(`/api/rounds/${rd.round_id}/bet`, { method: 'POST', body: { outcome_id: S.sel, amount: S.stake, idem_key: rd.round_id + ':' + uid } })
        S.betPlaced = true; setChips(r.balance); SFX.lock(); chipFly(btn, $('#hud-chips'), 4)
        refresh()
        // 2 秒内可撤销
        const u = document.createElement('button'); u.className = 'watch-link'; u.textContent = '撤销（2 秒内）'
        $('#watch').replaceWith(u)
        u.onclick = async () => { try { await api(`/api/rounds/${rd.round_id}/cancel`, { method: 'POST' }); S.betPlaced = false; S.me = await api('/api/me'); setChips(S.me.chips); u.remove(); refresh() } catch (e) { toastStage(e.message) } }
        setTimeout(() => u.remove(), 2000)
      } catch (e) { toastStage(e.message); btn.disabled = false; refresh() }
    }
    refresh()
    // 倒计时环（服务器时钟为准）+ 悬念空镜轮播 + Arena 实时赔率
    let hi = 0, lastSec = -1
    const circ = 175.9
    const timer = setInterval(async () => {
      if (!document.body.contains(panel)) return clearInterval(timer)
      const remain = Math.max(0, rd.lock_at - (Date.now() + S.offset))
      const sec = Math.ceil(remain / 1000)
      $('#ring-n').textContent = sec
      $('#ring-c').setAttribute('stroke-dashoffset', String(circ * (1 - remain / (rd.window_sec * 1000))))
      if (sec <= 3) { $('#ring').classList.add('hot'); $('#ring-c').setAttribute('stroke', '#ff5d73') }
      if (sec !== lastSec) { lastSec = sec; sec <= 3 && sec > 0 ? SFX.heart() : SFX.tick(); if (sec % 3 === 0 && hints.length) $('#sus-tx').textContent = hints[++hi % hints.length] }
      if (remain <= 0) { clearInterval(timer); lockAndReveal(n) }
    }, 250)
    if (rd.mode === 'arena') {
      const live = setInterval(async () => {
        if (!document.body.contains(panel) || S.betPlaced) return clearInterval(live)
        try {
          const L = await api(`/api/rounds/${rd.round_id}/live`)
          if (!L.odds) return
          const tot = Object.values(L.crowd).reduce((a, b) => a + b, 0)
          for (const k in L.odds) {
            const el = panel.querySelector(`[data-od="${k}"]`); if (!el) continue
            el.classList.remove('up', 'down'); if (L.odds[k] > S.lastOdds[k]) el.classList.add('up'); else if (L.odds[k] < S.lastOdds[k]) el.classList.add('down')
            el.textContent = '×' + L.odds[k]
            panel.querySelector(`[data-o="${k}"] .heat`).style.width = ((L.crowd[k] / tot) * 100).toFixed(1) + '%'
            const p = panel.querySelector(`[data-pct="${k}"]`); if (p) p.textContent = Math.round((L.crowd[k] / tot) * 100) + '%'
          }
          S.lastOdds = L.odds; refresh()
        } catch {}
      }, 1000)
    }
  }

  // ─────────── LOCK → REVEAL（本地解密） → SETTLE ───────────
  let revealing = false
  async function lockAndReveal(n) {
    if (revealing) return; revealing = true
    try {
      SFX.lock(); R.flash = 0.9
      layer.insertAdjacentHTML('beforeend', `<div class="lock-flash"></div><div class="lock-stamp">LOCKED</div>`)
      const t0 = performance.now()
      const st = await api(`/api/rounds/${S.round.round_id}/settle`, { method: 'POST' })
      const slot = S.round.encrypted[st.reveal.slot]
      const clip = await decryptSlot(slot, st.reveal.key)
      const revealMs = Math.round(performance.now() - t0)
      await sleep(450)
      R.freeze = false; R.targetZoom = 1.2
      const oc = S.series.distribution.find((d) => d.id === clip.outcome_id)
      S.path.push({ node: n.id, q: S.round.question, label: clip.label, outcome: clip.outcome_id })
      S.log.unshift({ q: S.round.question, label: clip.label, bet: st.bet, round: st.round_id })
      const banner = `<div class="outcome-banner"><div class="k">揭晓 · ${revealMs}ms · ${esc(clip.title)}</div><div class="t">${esc(clip.label)}</div>${oc?.poem ? `<div class="poem">${esc(oc.poem)}</div>` : ''}</div>`
      if (clip.video_url && /^https?:/.test(clip.video_url)) { const v = $('#clip-video'); v.src = clip.video_url; v.style.display = 'block'; v.play().catch(() => {}) }
      await playLines(clip.lines, `<div class="spacer" style="flex:.35"></div>${banner}`)
      $('#clip-video').style.display = 'none'
      settleCard(n, st, clip)
    } catch (e) { toastStage(e.message) } finally { revealing = false }
  }

  function settleCard(n, st, clip) {
    const b = st.bet
    const pnl = b ? b.payout - b.amount : 0
    if (b) (b.won ? SFX.win : SFX.lose)()
    const canRewind = st.rewind.allowed && st.rewind.used < st.rewind.max
    layer.innerHTML = `${hud()}<div class="spacer"></div>
      <div class="outcome-banner"><div class="k">本局结果</div><div class="t">${esc(clip.label)}</div></div>
      <div class="settle-card">
        <div class="res ${b ? (b.won ? 'win' : 'lose') : ''}">${b ? (b.won ? `+${b.payout}` : `−${b.amount}`) : '观战'}</div>
        <div class="sub" style="text-align:center">${b ? `押「${esc(S.round.options.find((o) => o.id === b.outcome_id)?.label)}」${b.amount} · 赔率 ×${b.odds} · 净${pnl >= 0 ? '赢' : '输'} ${Math.abs(pnl)}` : '本局未下注，无盈亏'}</div>
        <div class="row"><button class="pill-btn" id="btn-verify"><i class="fas fa-shield-halved"></i> 验证公平</button><button class="pill-btn" id="btn-share"><i class="fas fa-share-nodes"></i> 战报</button></div>
        ${canRewind ? `<div class="row"><button class="pill-btn rewind ${b && !b.won ? 'hl' : ''}" id="btn-rewind"><i class="fas fa-clock-rotate-left"></i> 悔棋 · 税 ${st.rewind.fee}（${st.rewind.max - st.rewind.used}/${st.rewind.max}）</button></div>` : ''}
        <div class="row"><button class="pill-btn gold" id="btn-next">继续剧情 <i class="fas fa-forward"></i></button></div>
      </div>`
    if (b?.won) chipFly($('.settle-card .res'), $('#hud-chips'), 8)
    setChips(st.balance)
    api('/api/me').then((m) => { S.me = m; renderSide() }).catch(() => {})
    $('#btn-verify').onclick = () => verifyModal(st.round_id)
    $('#btn-share').onclick = () => shareModal()
    $('#btn-next').onclick = () => { S.round = null; S.idx++; step() }
    $('#btn-rewind') && ($('#btn-rewind').onclick = () => rewindConfirm(n, st))
  }

  // ─────────── 悔棋：滑动二次确认 → 倒带 1.5s（遮蔽开新局时延） ───────────
  function rewindConfirm(n, st) {
    const card = $('.settle-card')
    card.insertAdjacentHTML('beforeend', `<div class="sub" style="margin-top:10px;text-align:center">悔棋税 × ${st.rewind.tax}，扣除 ${st.rewind.fee} Chips；结果将由<b>全新种子</b>重新抽取，不会看到同一变体</div>
      <div class="slide-confirm" id="slide"><div class="knob"><i class="fas fa-angles-right"></i></div><div class="lbl">滑动确认悔棋 →</div></div>`)
    $('#btn-rewind').remove()
    const sl = $('#slide'), knob = sl.querySelector('.knob')
    let sx = null
    const move = (x) => { if (sx == null) return; const d = Math.max(0, Math.min(sl.clientWidth - 44, x - sx)); knob.style.left = 3 + d + 'px'; if (d >= sl.clientWidth - 46) { sx = null; doRewind(n, st) } }
    knob.onpointerdown = (e) => { sx = e.clientX; knob.setPointerCapture(e.pointerId) }
    knob.onpointermove = (e) => move(e.clientX)
    knob.onpointerup = () => { if (sx != null) { sx = null; knob.style.left = '3px' } }
  }
  async function doRewind(n, st) {
    SFX.rewind()
    layer.innerHTML = `${hud()}<div class="rewinding"></div><div class="rewind-clock"><i class="fas fa-clock-rotate-left"></i></div>`
    R.targetZoom = 0.95; R.rain = -1.5
    try {
      const [nr] = await Promise.all([api(`/api/rounds/${st.round_id}/rewind`, { method: 'POST' }), sleep(1500)])
      R.rain = 1; S.path.pop()
      S.me.chips -= nr.rewind_fee; setChips(nr.balance)
      if (nr.cooloff_hint) toastStage(nr.cooloff_hint)
      cashNode(n, nr)
    } catch (e) { R.rain = 1; toastStage(e.message); settleCard(n, st, { label: '—' }) }
  }

  // ─────────── 结局 ───────────
  function ending() {
    const last = [...S.path].reverse().find((p) => p.node === 'C3') || S.path[S.path.length - 1]
    const end = S.nodes.find((x) => x.kind === 'ending' && x.id === 'END_' + last?.outcome) || S.nodes.find((x) => x.kind === 'ending')
    setMood('余韵'); R.freeze = false; R.targetZoom = 1.0
    layer.innerHTML = `${hud()}<div class="spacer"></div>
      <div class="ending"><div class="sub" style="letter-spacing:5px;color:var(--gold)">结 局</div>
      <div class="t">${esc(end?.title || '未完待续')}</div><div class="ep">${esc(end?.lines?.[0]?.text || '')}</div>
      <div class="path">${S.path.map((p) => `<span>${esc(p.label)}</span>`).join('<i class="fas fa-angle-right" style="color:#555;font-size:10px;align-self:center"></i>')}</div>
      <div class="row" style="display:flex;gap:8px;margin-top:10px"><button class="pill-btn" id="e-share"><i class="fas fa-share-nodes"></i> 分享战报</button><button class="pill-btn gold" id="e-again"><i class="fas fa-rotate"></i> 再来一局（故事不同）</button></div></div>`
    $('#e-share').onclick = shareModal
    $('#e-again').onclick = async () => { await loadSeries(); home() }
    renderSide()
  }

  // ─────────── 公平验证：三步 + 浏览器本地复算 ───────────
  async function verifyModal(roundId) {
    const v = await api(`/api/rounds/${roundId}/verify`)
    const local = await localHmac(v.seed, `${v.round_id}|${v.outcome_id}|${v.variant_id}`)
    const okLocal = local === v.commit
    openModal(`<h2><i class="fas fa-shield-halved" style="color:var(--gold)"></i> 我的这一局 · 公平验证</h2>
      <div class="step"><div class="n">1</div><div><b>开局前，我们锁定了答案</b><div class="sub">下注窗口开启前服务端抽取种子并生成承诺哈希（你在角标看到的那串）</div><code>commit = ${v.commit}</code></div></div>
      <div class="step"><div class="n">2</div><div><b>这是钥匙（结算后公开的种子）</b><code>seed = ${v.seed}</code><code>r = ${v.random_value.toFixed(6)} → ${esc(v.derived_outcome)}（权重 ${v.weights.map((w) => w.id + ':' + w.story_weight).join(' / ')}）</code></div></div>
      <div class="step"><div class="n">3</div><div><b>锁与钥匙吻合</b>
        <div>服务端复算承诺：<span class="${v.commit_match ? 'ok' : 'bad'}">${v.commit_match ? '✓ 一致' : '✗ 不一致'}</span></div>
        <div>你的浏览器本地 HMAC 复算：<span class="${okLocal ? 'ok' : 'bad'}">${okLocal ? '✓ 一致' : '✗ 不一致'}</span></div>
        <div>种子推导结果 = 实际结果：<span class="${v.outcome_match ? 'ok' : 'bad'}">${v.outcome_match ? '✓' : '✗'}</span> · 事件哈希链（${v.events.length} 事件）：<span class="${v.event_chain_ok ? 'ok' : 'bad'}">${v.event_chain_ok ? '✓ 未被篡改' : '✗'}</span></div>
        <code>${esc(v.formula)}</code></div></div>
      <details><summary class="sub" style="cursor:pointer">事件溯源明细</summary><pre class="code">${esc(v.events.map((e) => `#${e.seq} ${e.type} ${e.payload}\n   hash=${e.hash.slice(0, 24)}… prev=${e.prev_hash.slice(0, 12)}…`).join('\n'))}</pre></details>
      <div style="text-align:right;margin-top:10px"><button class="btn gold" data-close>明白了</button></div>`)
  }
  function showCommit() {
    if (!S.round) return
    openModal(`<h2>🔒 结果已锁定</h2><div class="sub">本局结果与变体已在下注前由服务端抽取，并公开以下承诺哈希。你的下注只影响赔付，永不影响结果。结算后可用公开种子验证。</div>
      <pre class="code" style="margin-top:10px">${S.round.commit}</pre><div class="sub">客户端当前只持有 ${S.round.encrypted.length} 个等长密文分片（每个结局簇一个），无法区分哪个为真。</div>
      <div style="text-align:right;margin-top:10px"><button class="btn gold" data-close>关闭</button></div>`)
  }
  function shareModal() {
    const wins = S.log.filter((l) => l.bet?.won).length
    const best = S.log.filter((l) => l.bet?.won).sort((a, b) => b.bet.odds - a.bet.odds)[0]
    const txt = `我在《${S.series.title}》押中 ${wins} 次${best ? `，最高赔率 ×${best.bet.odds}` : ''}！路径：${S.path.map((p) => p.label).join(' → ')}。你敢押吗？`
    openModal(`<h2><i class="fas fa-share-nodes"></i> 战报卡</h2><div class="share-card"><div class="sub" style="letter-spacing:4px;color:var(--gold)">DreamForge · Cash 剧场</div>
      <div class="serif" style="font-size:30px;font-weight:900;margin:6px 0">${esc(S.series.title)}</div>
      <div style="font-size:40px;font-weight:900;color:var(--gold)">${wins} 连中</div><div class="sub">${best ? `最高赔率 ×${best.bet.odds}` : '下一局就是你的'}</div>
      <div class="path" style="margin-top:12px">${S.path.map((p) => `<span>${esc(p.label)}</span>`).join('')}</div>
      <div class="poem" style="margin-top:10px;font-size:13px">${esc(S.series.poem || '')}</div></div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end"><button class="btn" id="copy-share"><i class="fas fa-copy"></i> 复制文案+链接</button><button class="btn gold" data-close>关闭</button></div>`)
    $('#copy-share').onclick = () => { navigator.clipboard?.writeText(txt + ' ' + location.origin + '/?ref=' + uid); $('#copy-share').innerHTML = '<i class="fas fa-check"></i> 已复制' }
  }
  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`
    modalRoot.onclick = (e) => { if (e.target.classList.contains('modal-bg') || e.target.closest('[data-close]')) modalRoot.innerHTML = '' }
  }
  function toastStage(msg) {
    const d = document.createElement('div'); d.className = 'toast show'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2800)
  }
  function chipFly(from, to, n = 5) {
    if (!from || !to) return
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect()
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div'); c.className = 'chip-fly'; c.style.left = a.left + a.width / 2 + 'px'; c.style.top = a.top + 'px'; c.style.position = 'fixed'
      document.body.appendChild(c)
      setTimeout(() => { c.style.transform = `translate(${b.left - a.left - a.width / 2 + (Math.random() * 20 - 10)}px, ${b.top - a.top}px) scale(.6)`; c.style.opacity = '.2' }, 30 + i * 70)
      setTimeout(() => c.remove(), 1200 + i * 70)
    }
  }

  // ─────────── 侧栏：钱包 / 战绩 / 结局图鉴 / 负责任娱乐 ───────────
  function renderSide() {
    if (!S.me) return
    const mins = Math.floor((Date.now() - S.sessionStart) / 60000)
    const allOut = S.series?.distribution || []
    const got = new Set(S.me.collected_outcomes || [])
    side.innerHTML = `
      <div class="side-card"><h3><i class="fas fa-wallet"></i> 钱包 <span class="sub" style="margin-left:auto">${esc(nick)}</span></h3>
        <div class="wallet"><div class="chips"><div class="l"><i class="fas fa-coins"></i> Chips 娱乐币</div><div class="v">${S.me.chips}</div></div>
        <div class="cash"><div class="l"><i class="fas fa-shield-halved"></i> Cash 真实货币</div><div class="v" style="font-size:13px;margin-top:6px">仅持牌区 + KYC 开放</div></div></div>
        <div style="display:flex;gap:6px;margin-top:10px"><button class="btn" id="faucet" style="flex:1;justify-content:center"><i class="fas fa-gift"></i> 领免费币</button><button class="btn" id="limits" style="flex:1;justify-content:center"><i class="fas fa-hand"></i> 防沉迷</button></div>
        <div class="sub" style="margin-top:8px">本次会话 ${mins} 分钟 · 日限额 ${S.me.daily_limit} · 战绩 ${S.me.stats?.w || 0}/${S.me.stats?.n || 0} 胜 · 累计 ${(S.me.stats?.pnl || 0) >= 0 ? '+' : ''}${S.me.stats?.pnl || 0}</div></div>
      <div class="side-card"><h3><i class="fas fa-book-open"></i> 结局簇图鉴 <span class="sub" style="margin-left:auto">${allOut.filter((o) => got.has(o.id)).length}/${allOut.length}</span></h3>
        <div class="gallery">${allOut.map((o) => `<div class="${got.has(o.id) ? 'got' : ''}">${got.has(o.id) ? esc(o.label) : '？？？'}</div>`).join('')}</div></div>
      <div class="side-card"><h3><i class="fas fa-scroll"></i> 本场对局</h3><div class="log-list">${S.log.length ? S.log.map((l) => `<div><span>${esc(l.label)}</span><span style="color:${l.bet ? (l.bet.won ? 'var(--gold)' : '#8f98bb') : '#555'}">${l.bet ? (l.bet.won ? '+' + l.bet.payout : '−' + l.bet.amount) : '观战'}</span></div>`).join('') : '<div class="sub">尚未开局</div>'}</div></div>
      <div class="side-card sub" style="font-size:11px;line-height:1.7"><i class="fas fa-circle-info"></i> 结果先锁定再开盘：每局结果由服务端种子在下注前抽取并公布承诺哈希；客户端只拿到加密分片，揭晓时才下发密钥。未满 18 岁请勿参与，理性娱乐。</div>`
    $('#faucet').onclick = async () => { try { S.me = await api('/api/me/faucet', { method: 'POST' }); S.me = await api('/api/me'); setChips(S.me.chips); toastStage('+500 Chips 已到账') } catch (e) { toastStage(e.message) } }
    $('#limits').onclick = limitsModal
  }
  function limitsModal() {
    openModal(`<h2><i class="fas fa-hand"></i> 防沉迷中心</h2>
      <div class="step"><div><b>日下注限额</b><div class="sub">下调即时生效</div><div style="display:flex;gap:6px;margin-top:6px"><input class="inp" id="lim" type="number" value="${S.me.daily_limit}" style="flex:1"><button class="btn gold" id="lim-save">保存</button></div></div></div>
      <div class="step"><div><b>冷静期</b><div class="sub">期间无法下注，可继续观战</div><div style="display:flex;gap:6px;margin-top:6px">${[10, 60, 1440].map((m) => `<button class="btn" data-cool="${m}">${m < 60 ? m + ' 分钟' : m === 60 ? '1 小时' : '24 小时'}</button>`).join('')}</div></div></div>
      <div class="step"><div><b>自我排除</b><div class="sub">加入后禁止任何下注，同步至合规中心</div><button class="btn" id="selfex" style="margin-top:6px;border-color:var(--red);color:var(--red)">加入自我排除</button></div></div>
      <div style="text-align:right"><button class="btn" data-close>关闭</button></div>`)
    $('#lim-save').onclick = async () => { S.me = { ...S.me, ...(await api('/api/me/limits', { method: 'POST', body: { daily_limit: +$('#lim').value } })) }; renderSide(); toastStage('限额已更新') }
    modalRoot.querySelectorAll('[data-cool]').forEach((b) => (b.onclick = async () => { await api('/api/me/limits', { method: 'POST', body: { cooloff_minutes: +b.dataset.cool } }); toastStage('冷静期已开启') }))
    $('#selfex').onclick = async () => { if (confirm('确认加入自我排除？')) { await api('/api/me/limits', { method: 'POST', body: { self_exclude: true } }); toastStage('已加入自我排除名单') } }
  }
  // 时长提醒：每 45 分钟
  setInterval(() => { const m = Math.floor((Date.now() - S.sessionStart) / 60000); if (m && m % 45 === 0) toastStage(`你已游玩 ${m} 分钟，适当休息一下`) }, 60000)

  async function loadSeries() {
    S.series = await api('/api/series/' + SERIES)
    S.nodes = S.series.nodes.filter((n) => n.kind !== 'ending').concat(S.series.nodes.filter((n) => n.kind === 'ending'))
    S.me = await api('/api/me?nick=' + encodeURIComponent(nick))
    renderSide()
  }
  loadSeries().then(home).catch((e) => { layer.innerHTML = `<div style="margin:auto;padding:20px" class="sub">加载失败：${esc(e.message)}</div>` })
})()
