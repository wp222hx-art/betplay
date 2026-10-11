// 逐个揭晓淘汰赛（致命13 机制通用版）· 坠梯 / 人质谈判 / 最后一把 / 摸鱼大逃杀 / 抢车位 / 霸总选妃
// 每轮：仪式片 → 屏上押注 8s（押「这轮之后还剩几人」三档）→ 按顺序一个个揭晓（出局 / 过关）→ 结算 → 下一轮
// 最后 2 人对决 → 赢家片 → 3 秒自动下一局
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const xm = (m) => '×' + (m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : m.toFixed(2))
  const pct = (p) => Math.round(p * 100) + '%'
  const SID = document.body.dataset.sid
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.message || '请求失败'), { code: j.error })
    return j
  }

  // ─────────── 合成音效（每部剧一套「出局 / 过关」声） ───────────
  let AC = null, hb = 0, hbT = null
  const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  function noise(d, g = 1, hp = 0, lp = 0, delay = 0) { const c = ac(), n = Math.floor(c.sampleRate * d), b = c.createBuffer(1, n, c.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); const s = c.createBufferSource(); s.buffer = b; let nd = s; if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; nd.connect(f); nd = f } if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; nd.connect(f); nd = f } const G = c.createGain(); G.gain.value = g; nd.connect(G); G.connect(c.destination); s.start(c.currentTime + delay) }
  function tone(f0, f1, d, g = 0.5, t = 'sine', delay = 0) { const c = ac(), o = c.createOscillator(), G = c.createGain(), T = c.currentTime + delay; o.type = t; o.frequency.setValueAtTime(f0, T); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), T + d); G.gain.setValueAtTime(0.0001, c.currentTime); G.gain.setValueAtTime(g, T); G.gain.exponentialRampToValueAtTime(0.0001, T + d); o.connect(G); G.connect(c.destination); o.start(T); o.stop(T + d + 0.02) }
  const SFX = {
    beat() { tone(60, 38, 0.13, 0.8); tone(52, 34, 0.11, 0.5, 'sine', 0.16) },
    tick() { tone(1400, 1300, 0.04, 0.12, 'square') },
    chip() { noise(0.04, 0.5, 3000); tone(2200, 1800, 0.05, 0.12, 'triangle') },
    lock() { noise(0.06, 0.8, 1200); tone(300, 120, 0.12, 0.4, 'square') },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.25, 0.25, 'triangle', i * 0.1)) },
    big() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, f * 1.01, 0.4, 0.3, 'triangle', i * 0.09)); noise(1.2, 0.25, 4000, 0, 0.5) },
    lose() { tone(220, 70, 0.8, 0.35, 'sawtooth') },
    // 出局类
    slam() { noise(0.5, 1.4, 0, 900); tone(90, 30, 0.45, 1, 'sine'); noise(0.25, 0.5, 2500, 0, 0.05) },        // 电梯急停：钢板砸地
    thud() { tone(70, 35, 0.35, 1, 'sine'); noise(0.3, 0.9, 0, 600); tone(180, 120, 0.6, 0.18, 'triangle', 0.12) },  // 黑球落盘：闷响
    fail() { tone(330, 220, 0.18, 0.35, 'square'); tone(220, 110, 0.4, 0.35, 'square', 0.2) },                  // 搞笑失败「嘟嘟——」
    crunch() { noise(0.45, 1.2, 300, 3000); for (let i = 0; i < 5; i++) noise(0.04, 0.6, 2000, 0, 0.05 + i * 0.06) }, // 蹭柱子：刮擦
    // 过关类
    grip() { tone(900, 600, 0.12, 0.18, 'triangle'); noise(0.08, 0.25, 3000) },                                // 抓稳：金属扶手吱
    ding() { tone(1320, 1320, 0.6, 0.22, 'sine'); tone(1980, 1980, 0.4, 0.08, 'sine') },                        // 叮
    flip() { noise(0.05, 0.6, 4000); tone(1500, 2400, 0.06, 0.1, 'triangle') }                                  // 翻牌
  }
  const sfx = (k) => (SFX[k] || SFX.ding)()
  function heart(bpm) { hb = bpm; if (hbT) return; const L = () => { if (!hb) { hbT = null; return } SFX.beat(); hbT = setTimeout(L, 60000 / hb) }; L() }
  const heartStop = () => { hb = 0 }
  let CUES = {}
  const cueOf = (k) => CUES[k] ?? CUES['*' + k.replace(/\d+$/, '')] ?? 2.0
  function flashFx(kind) { const st = $('#l13-stage'); st.classList.remove('fx-bang', 'fx-click'); void st.offsetWidth; st.classList.add('fx-' + kind); setTimeout(() => st.classList.remove('fx-' + kind), 700) }
  function stamp(txt, cls) { const e = document.createElement('div'); e.className = 'l13-stamp ' + cls; e.innerHTML = txt; $('#l13-stage').appendChild(e); setTimeout(() => e.remove(), 1500) }

  // ─────────── 双缓冲视频 ───────────
  const V = [$('#l13-v0'), $('#l13-v1')]; let cur = 0, MEDIA = null
  V.forEach((v) => { v.controls = false; v.disablePictureInPicture = true; v.muted = true; v.playsInline = true })
  const has = (k) => !!MEDIA?.clips?.[k]?.url
  function preload(k) { if (!has(k)) return; const v = V[1 - cur]; if (v.dataset.k !== k) { v.dataset.k = k; v.src = MEDIA.clips[k].url; v.load() } }
  function unlock() { V.forEach((v) => { try { const p = v.play(); p?.catch?.(() => {}); v.pause() } catch {} }) }
  function tapToPlay(v) {
    return new Promise((res) => {
      const o = document.createElement('button'); o.className = 'tap-play'; o.innerHTML = '<i class="fas fa-play"></i><span>点一下继续</span>'
      $('#l13-stage').appendChild(o); o.onclick = () => { o.remove(); unlock(); v.muted = false; v.play().then(res, () => { v.muted = true; v.play().then(res, res) }) }
    })
  }
  // 无视频时的静帧兜底：人物定妆照 / 场景
  const still = (() => { const e = document.createElement('div'); e.className = 'g-still'; $('#l13-stage').prepend(e); return e })()
  function showStill(url) { if (!url) { still.classList.remove('on'); return } still.style.backgroundImage = `url('${url}')`; still.classList.add('on') }
  function play(k, opts = {}) {
    if (!has(k)) { if (opts.cue != null) { opts.onPre?.(); setTimeout(() => opts.onCue?.(), 500) } return sleep(opts.loop ? 0 : opts.fallback ?? 1200).then(() => false) }
    showStill(null)
    const c = MEDIA.clips[k]
    return new Promise(async (res) => {
      const nv = V[1 - cur], ov = V[cur]
      if (nv.dataset.k !== k) { nv.dataset.k = k; nv.src = c.url }
      nv.currentTime = opts.from || 0; nv.muted = false; nv.loop = !!opts.loop; nv.volume = opts.vol ?? 1
      let done = false, t = 0
      const fin = () => { if (done) return; done = true; clearTimeout(t); res(true) }
      if (opts.until != null) { const u = opts.until; const tk = () => { if (done) return; if (nv.currentTime >= u) { nv.pause(); fin() } else requestAnimationFrame(tk) }; requestAnimationFrame(tk) }
      if (opts.cue != null) { let fired = false, pre = false; const cueT = opts.cue; const tick = () => { if (done && fired) return; const tt = nv.currentTime; if (!pre && tt >= cueT - 0.55) { pre = true; heartStop(); opts.onPre?.() } if (!fired && tt >= cueT - 0.03) { fired = true; opts.onCue?.() } else if (!fired) requestAnimationFrame(tick) }; requestAnimationFrame(tick) }
      const arm = () => { clearTimeout(t); t = setTimeout(() => { if (opts.cue != null) opts.onCue?.(); fin() }, Math.min(opts.max || 1e9, (c.dur + 2) * 1000)) }
      nv.onended = fin; nv.onerror = fin; t = setTimeout(fin, 15000)
      nv.onplaying = () => { nv.classList.add('on'); ov.classList.remove('on'); ov.pause(); cur = 1 - cur; arm(); nv.onplaying = null }
      if (opts.loop) { res(true) }
      try { await nv.play() } catch { nv.muted = true; try { await nv.play() } catch { clearTimeout(t); await tapToPlay(nv); arm() } }
    })
  }
  const stopVideo = () => V.forEach((v) => { v.pause(); v.classList.remove('on') })

  // ─────────── 状态 / HUD ───────────
  const hud = $('#l13-hud'), roster = $('#l13-roster'), cap = $('#l13-caption'), big = $('#l13-big'), over = $('#l13-over'), bar = $('#l13-bet')
  let M, W, S = { bet: 20, auto: false, run: null, out: new Set(), streak: 0, sess: { n: 0, net: 0 }, balance: 0 }
  const name = (id) => M.cast.find((p) => p.id === id)?.name || '#' + id
  const face = (id) => MEDIA?.faces?.[id - 1] || ''
  function caption(t, cls = '') { cap.className = 'l13-caption ' + cls; cap.innerHTML = t; void cap.offsetWidth; cap.classList.add('in') }
  function renderHud() {
    const need = M.cfg.streak_need, n = S.streak % need
    hud.innerHTML = `<div class="hb"><i class="fas fa-coins"></i><b id="hud-bal">${fmt(S.balance)}</b></div>
      <div class="hb streak ${S.streak ? 'on' : ''}" title="连中 ${need} 轮拿奖池大奖"><i class="fas fa-fire"></i>连中 ${Array.from({ length: need }, (_, i) => `<i class="pip ${i < n || (S.streak && n === 0 && S.justBonus) ? 'on' : ''}"></i>`).join('')}<small>${S.streak ? S.streak + ' 连' : `中 ${need} 轮爆奖池`}</small></div>
      <div class="hb pool"><i class="fas fa-sack-dollar"></i>奖池 <b>${fmt(M.pool)}</b></div>
      <div class="hb sess ${S.sess.net >= 0 ? 'up' : 'down'}">本场 ${S.sess.n} 局 · ${S.sess.net >= 0 ? '+' : ''}${fmt(S.sess.net)}</div>`
  }
  function renderRoster(alive, hi = []) {
    roster.innerHTML = M.cast.map((p) => `<span class="rp ${S.out.has(p.id) ? 'dead' : alive && !alive.includes(p.id) ? 'out' : ''} ${hi.includes(p.id) ? 'hi' : ''}" style="background-image:url('${face(p.id)}')" title="${esc(p.name)}"><b>${p.id}</b></span>`).join('')
  }
  function bigText(html, cls = '', ms = 1400) { big.className = 'l13-big ' + cls; big.innerHTML = `<div>${html}</div>`; void big.offsetWidth; big.classList.add('go'); return sleep(ms) }

  // ─────────── 中奖特效 ───────────
  const fx = $('#l13-fx'); let fxP = [], fxOn = false
  function coins(n = 80, gold = true) {
    const r = fx.getBoundingClientRect(); fx.width = r.width * devicePixelRatio; fx.height = r.height * devicePixelRatio
    for (let i = 0; i < n; i++) fxP.push({ x: fx.width / 2 + (Math.random() - 0.5) * fx.width * 0.3, y: fx.height * 0.45, vx: (Math.random() - 0.5) * 22, vy: -Math.random() * 26 - 8, r: (6 + Math.random() * 8) * devicePixelRatio, a: Math.random() * 6, g: gold })
    if (!fxOn) { fxOn = true; requestAnimationFrame(fxLoop) }
  }
  function fxLoop() {
    const c = fx.getContext('2d'); c.clearRect(0, 0, fx.width, fx.height)
    fxP = fxP.filter((p) => p.y < fx.height + 40)
    for (const p of fxP) { p.vy += 0.9; p.x += p.vx; p.y += p.vy; p.a += 0.2; const w = Math.abs(Math.cos(p.a)) * p.r
      c.fillStyle = p.g ? '#ffc53d' : '#ff3b4f'; c.beginPath(); c.ellipse(p.x, p.y, w + 1, p.r, 0, 0, 7); c.fill(); c.fillStyle = p.g ? '#fff3b0' : '#ffb4bd'; c.beginPath(); c.ellipse(p.x - w * 0.3, p.y - p.r * 0.3, w * 0.3 + 0.5, p.r * 0.3, 0, 0, 7); c.fill() }
    if (fxP.length) requestAnimationFrame(fxLoop); else { fxOn = false; c.clearRect(0, 0, fx.width, fx.height) }
  }
  function rollTo(el, from, to, ms = 900) { const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(f) }; requestAnimationFrame(f) }
  function setBalance(b) { const el = $('#hud-bal'); if (el && b != null && b !== S.balance) rollTo(el, S.balance, b); S.balance = b ?? S.balance }

  // ─────────── 屏上押注条 ───────────
  const STK = () => M.cfg.stakes
  function betIdle(msg) {
    bar.className = 'l13-betbar idle'
    bar.innerHTML = `<div class="bb-msg">${msg || ''}</div><div class="bb-stake">${STK().map((v) => `<button class="ck ${v === S.bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>`
    bindStake()
  }
  function bindStake() { bar.querySelectorAll('.ck').forEach((b) => (b.onclick = () => { S.bet = +b.dataset.v; bar.querySelectorAll('.ck').forEach((x) => x.classList.toggle('on', x === b)); SFX.chip() })) }
  function betWindow(rc, lockAt) {
    return new Promise((res) => {
      const fin = rc.type === 'final', total = lockAt - Date.now()
      bar.className = 'l13-betbar open'
      bar.innerHTML = `<div class="bb-q"><b>${fin ? esc(W.finalQ) : `${esc(W.q).replace(/还剩几/, '<em>' + rc.alive.length + '</em> 人里还剩几')}`}</b><span class="bb-sec" id="bb-sec">${M.cfg.pick_sec}</span></div>
        <div class="bb-opts">${rc.tiers.map((t) => `<button class="bo" data-t="${t.id}">${fin ? `<i style="background-image:url('${face(t.lo)}')"></i>` : ''}<span>${esc(t.label)}</span><b>${xm(t.odds)}</b><small>${pct(t.p)}</small></button>`).join('')}</div>
        <div class="bb-foot"><div class="bb-stake">${STK().map((v) => `<button class="ck ${v === S.bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div><button class="bb-skip" id="bb-skip">这轮不押</button></div>
        <div class="bb-timer"><i id="bb-bar"></i></div>`
      bindStake()
      let done = false, last = 99
      const end = (v) => { if (done) return; done = true; clearInterval(tm); bar.classList.add('locked'); SFX.lock(); res(v) }
      bar.querySelectorAll('.bo').forEach((b) => (b.onclick = () => { if (S.balance < S.bet) { toast('余额不足'); needChips(); return } bar.querySelectorAll('.bo').forEach((x) => x.classList.toggle('on', x === b)); SFX.chip(); end({ tier: b.dataset.t, bet: S.bet }) }))
      $('#bb-skip').onclick = () => end(null)
      const tm = setInterval(() => {
        const left = lockAt - Date.now(), s = Math.max(0, Math.ceil(left / 1000))
        const b = $('#bb-bar'); if (b) b.style.width = Math.max(0, (left / total) * 100) + '%'
        if (s !== last) { last = s; const e = $('#bb-sec'); if (e) e.textContent = s; if (s <= 3 && s > 0) SFX.tick() }
        bar.classList.toggle('hot', left < 3000)
        if (left <= 0) end(null)
      }, 100)
    })
  }
  function toast(m) { const t = document.createElement('div'); t.className = 't-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3000) }
  async function needChips() {
    if ($('#faucet-cta')) return
    over.insertAdjacentHTML('beforeend', '<button id="faucet-cta" class="btn gold"><i class="fas fa-gift"></i> 余额不足 · 领取 500 免费币</button>')
    $('#faucet-cta').onclick = async (e) => { try { const r = await api('/api/me/faucet', { body: {} }); e.currentTarget.remove(); setBalance(r.balance ?? S.balance + 500); toast('+500 已到账') } catch (er) { toast(er.message) } }
  }

  // ─────────── 一局 ───────────
  async function startRun() {
    ac().resume?.(); unlock()
    over.className = 'l13-over'; over.innerHTML = ''
    let r
    try { r = await api(`/api/g/${SID}/start`, { body: {} }) } catch (e) { toast(e.message); return showLobby() }
    Object.assign(S, { run: r, out: new Set(), streak: 0, justBonus: false }); M.pool = r.pool; S.balance = r.balance; renderHud(); renderRoster(r.round.alive)
    bar.className = 'l13-betbar'; bar.innerHTML = ''
    showStill(MEDIA?.cover)
    caption(esc(M.logline), 'dim')
    if (S.sess.n === 0 || !S.auto) { preload('intro'); await play('intro', { fallback: 2600 }) } else await sleep(500)
    await round(r.round)
  }
  async function round(rc) {
    const fin = rc.type === 'final'
    if (fin) {
      renderRoster(rc.alive, rc.alive)
      caption(`<b class="red">对决</b> · ${esc(W.finalCap)} · ${rc.alive.map((x) => `<b>${x} 号 ${esc(name(x))}</b>`).join(' 对 ')}`, 'warn')
      for (const x of rc.alive) { showStill(face(x)); await bigText(`<em>${x}</em><small>${esc(name(x))}</small>`, '', 1100) }
    } else {
      caption(M.round_caps[rc.k - 1] || `第 <b>${rc.k}</b> ${esc(W.round)}`)
      heart(90 + rc.k * 12); preload('ritual')
      await play('ritual', { max: 4200, fallback: 1500 })
    }
    // 押注期：仪式片低音量循环 / 静帧轮换当轮的人
    const pool = rc.alive; let ci = 0
    if (has('ritual')) play('ritual', { loop: true, vol: 0.25 })
    const cyc = setInterval(() => { ci = (ci + 1) % pool.length; renderRoster(pool, [pool[ci]]); if (!has('ritual')) showStill(face(pool[ci])) }, 1300)
    renderRoster(pool, [pool[0]])
    const arm = await api(`/api/g/runs/${S.run.run_id}/arm`, { body: {} })
    const lockAt = arm.lock_at + (Date.now() - arm.server_time) - 800
    heart(140 + rc.k * 8)
    const choice = await betWindow(rc, lockAt); clearInterval(cyc)
    let r
    try { r = await api(`/api/g/runs/${S.run.run_id}/act`, { body: { k: rc.k, ...(choice || {}) } }) }
    catch (e) { toast(e.message); if (e.code === 'INSUFFICIENT') needChips(); r = await api(`/api/g/runs/${S.run.run_id}/act`, { body: { k: rc.k } }) }
    if (r.side) setBalance(S.balance - r.side.bet)
    bar.className = 'l13-betbar msg'; bar.innerHTML = `<div class="bb-msg">${r.side ? `已押 <b>${esc(r.side.label)}</b> · ${fmt(r.side.bet)} · <b class="gold">${xm(r.side.odds)}</b>` : '这一轮只看'}</div>`
    heartStop()
    await (r.round.type === 'final' ? performFinal(r.round) : perform(r.round))
    await settle(r)
    renderHud()
    if (r.ended) return finale(r)
    return round(r.next)
  }
  /** 揭晓一个人：out{i} / safe{i}，在 cue 点触发音效 + 印章 */
  async function revealOne(id, isOut, fast) {
    const k = (isOut ? 'out' : 'safe') + id, c = cueOf(k)
    renderRoster(null, [id]); caption(`<b>${id} 号 ${esc(name(id))}</b> ……`, 'dim')
    if (!has(k)) showStill(face(id))
    await play(k, { from: Math.max(0, c - (fast ? 0.9 : 1.6)), until: isOut ? c + 1.7 : c + (fast ? 0.7 : 1.1), cue: c, fallback: fast ? 700 : 1100,
      onCue: () => {
        sfx(isOut ? M.sfx.out : M.sfx.safe)
        if (isOut) { stamp(esc(W.outFx), 'bang'); flashFx('bang') } else { stamp(esc(W.safeFx), 'click'); flashFx('click') }
        caption(`<b>${id} 号 ${esc(name(id))}</b> · ${isOut ? `<b class="red">${esc(W.out)}</b>` : esc(W.safe)}`, isOut ? 'warn' : '')
      } })
    if (isOut) { S.out.add(id) }
  }
  async function perform(rd) {
    if (rd.voids) { await bigText(`<em>全员${esc(W.out)}？</em><small>不算——作废 ${rd.voids} 次，重来</small>`, 'red', 1500) }
    caption(esc(W.seqCap), 'dim'); await sleep(500)
    const order = rd.order || rd.before
    for (const [j, id] of order.entries()) {
      const isOut = rd.out.includes(id), nx = order[j + 1]
      if (nx) preload((rd.out.includes(nx) ? 'out' : 'safe') + nx)
      await revealOne(id, isOut, j >= 3 && !isOut)
      renderRoster(rd.before.filter((x) => !S.out.has(x)))
    }
    renderRoster(rd.after)
    await bigText(rd.out.length ? `${esc(W.out)} <em>${rd.out.length}</em> 人<small>还剩 ${rd.after.length} 人</small>` : `<em>0</em> 人${esc(W.out)}<small>${rd.after.length} 人全过</small>`, rd.out.length ? 'red' : '', 1300)
  }
  async function performFinal(rd) {
    const [a, b] = rd.before
    for (const tr of rd.tries || []) {
      const last = tr.out.length === 1
      if (!last && tr.out.length === 2) { await bigText(`<em>两人同时${esc(W.out)}？</em><small>不算，再来一次</small>`, 'red', 1300); continue }
      for (const id of [a, b]) await revealOne(id, tr.out.includes(id), false)
      if (!last) { S.out.delete(a); S.out.delete(b); await bigText(`<em>都${esc(W.safe)}</em><small>再来一次</small>`, '', 1100) }
    }
  }
  async function settle(r) {
    const st = r.streak || { n: 0 }; S.streak = st.n; M.pool = st.pool ?? M.pool
    if (r.side) {
      if (r.side.hit && r.side.odds >= 3.5) { SFX.big(); coins(130); setBalance(st.balance); over.className = 'l13-over jackpot'; over.innerHTML = `<div class="jp"><small>${xm(r.side.odds)} 冷门命中</small><b>大 奖</b><em id="jp-n">0</em><span>${esc(r.side.label)}${st.n > 1 ? ` · ${st.n} 连中` : ''}</span></div>`; rollTo($('#jp-n'), 0, r.side.payout, 1300); await sleep(2600); over.className = 'l13-over'; over.innerHTML = '' }
      else if (r.side.hit) { SFX.win(); coins(40); setBalance(st.balance); await bigText(`押中 <em>+${fmt(r.side.payout)}</em><small>${esc(r.side.label)} · ${xm(r.side.odds)}${st.n > 1 ? ` · <b>${st.n} 连中</b>` : ''}</small>`, 'gold', 1600) }
      else { SFX.lose(); setBalance(st.balance); await bigText(`没中 <em>-${fmt(r.side.bet)}</em><small>${S.streak === 0 ? '连中断了 · 下一轮重新来' : ''}</small>`, 'red', 1200) }
    } else setBalance(st.balance)
    if (st.bonus?.amount) {
      S.justBonus = true; renderHud(); SFX.big(); coins(160)
      over.className = 'l13-over jackpot'; over.innerHTML = `<div class="jp"><small>${st.n} 连中</small><b>奖池大奖</b><em id="jp-n">0</em><span>${st.bonus.status === 'held' ? '审核中' : '已到账'}</span></div>`
      rollTo($('#jp-n'), 0, st.bonus.amount, 1600); await sleep(3200); over.className = 'l13-over'; over.innerHTML = ''; S.justBonus = false
    }
    renderHud()
  }
  async function finale(r) {
    const w = r.winner; heartStop(); renderRoster([w], [w])
    caption(`<b class="gold">${w} 号 · ${esc(name(w))}</b> ${esc(W.winner)}`, 'gold')
    preload('win' + w); if (!has('win' + w)) showStill(face(w))
    SFX.win(); await play('win' + w, { max: 5200, fallback: 2200 })
    S.sess.n++; S.sess.net += r.net || 0; setBalance(r.balance); renderHud()
    over.className = 'l13-over next'
    over.innerHTML = `<div class="nx"><div class="nx-w" style="background-image:url('${face(w)}')"><b>${w}</b></div>
      <h3>${w} 号 ${esc(name(w))} ${esc(W.winner)}</h3>
      <p>本局 <b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b>${r.best_streak ? ` · 最高 ${r.best_streak} 连中` : ''}${r.bonus_total ? ` · 奖池 +${fmt(r.bonus_total)}` : ''} · 余额 ${fmt(r.balance)}</p>
      <button class="btn gold big" id="nx-go"><i class="fas fa-forward"></i> 下一局 <span id="nx-c">3</span></button>
      <div class="nx-acts"><label><input type="checkbox" id="nx-auto" ${S.auto ? 'checked' : ''}> 自动连播</label><button class="lnk" id="nx-stop">歇一会</button>
      <details class="verify"><summary>公平验证</summary><code>seed ${esc(r.verify.seed)}</code><code>commit ${esc(r.verify.commit)}</code><a href="/api/g/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details></div></div>`
    let c = S.auto ? 3 : 6, stop = false
    $('#nx-c').textContent = c
    $('#nx-auto').onchange = (e) => (S.auto = e.target.checked)
    $('#nx-stop').onclick = () => { stop = true; showLobby() }
    const go = () => { if (stop) return; stop = true; startRun() }
    $('#nx-go').onclick = go
    while (!stop && c > 0) { await sleep(1000); c--; const e = $('#nx-c'); if (e) e.textContent = c }
    if (!stop) go()
  }

  // ─────────── 大厅 ───────────
  function showLobby() {
    stopVideo(); showStill(MEDIA?.cover || face(1)); renderRoster(); renderHud(); betIdle('选好注金，开局后每轮在这里押')
    caption('')
    const live = !!MEDIA && Object.keys(MEDIA.clips || {}).length > 0
    over.className = 'l13-over lobby'
    over.innerHTML = `<div class="lb"><h1>${esc(M.title)}</h1><p class="g-log">${esc(M.logline)}</p>
      <ol>${M.rules.map((x) => `<li>${esc(x)}</li>`).join('')}<li>押错不出局，下一轮接着押；连中 <b>${M.cfg.streak_need} 轮</b>拿奖池大奖。</li></ol>
      <div class="g-cast">${M.cast.map((c) => `<span style="background-image:url('${face(c.id)}')"><b>${c.id}</b><small>${esc(c.name)}</small></span>`).join('')}</div>
      <button class="btn gold big" id="lb-go"><i class="fas fa-play"></i> 进场</button>
      <p class="mut">${live ? '' : '<b>影片拍摄中 · 当前为静帧预演版</b> · '}奖池 ${fmt(M.pool)} · 已开 ${fmt(M.stats.plays)} 局 · 一局约 2 分钟</p></div>`
    $('#lb-go').onclick = startRun
  }

  ;(async () => {
    try { M = await api(`/api/g/${SID}/meta`); MEDIA = M.media; W = M.words } catch (e) { over.className = 'l13-over lobby'; over.innerHTML = `<div class="lb"><p>${esc(e.message)}</p></div>`; return }
    document.documentElement.style.setProperty('--g-c', M.color)
    const me = await api('/api/me').catch(() => null); S.balance = me?.chips ?? me?.user?.chips ?? 0
    try { const all = await (await fetch('/static/sfx/g_cues.json')).json(); CUES = all[SID] || {} } catch {}
    showLobby()
    window.GRT = { S, M }
  })()
})()
