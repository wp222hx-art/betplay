// 致命13 v4 · 屏上下注（每轮一次 · 连中奖励）· 双缓冲无缝拼片 · 局与局自动衔接
// 节奏（每轮 ≈ 20s）：上弹特写(k 发) → 屏上押注 8s（下注时播当轮人的近景脸）→ 灯亮齐射 → 倒地（尸体留在画面下方）→ 结算特效 → 下一轮
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const xm = (m) => '×' + (m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : m.toFixed(2))
  const pct = (p) => Math.round(p * 100) + '%'
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.message || '请求失败'), { code: j.error })
    return j
  }

  // ─────────── 合成音效 ───────────
  let AC = null, hb = 0, hbT = null
  const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  function noise(d, g = 1, hp = 0, lp = 0) { const c = ac(), n = Math.floor(c.sampleRate * d), b = c.createBuffer(1, n, c.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); const s = c.createBufferSource(); s.buffer = b; let nd = s; if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; nd.connect(f); nd = f } if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; nd.connect(f); nd = f } const G = c.createGain(); G.gain.value = g; nd.connect(G); G.connect(c.destination); s.start() }
  function tone(f0, f1, d, g = 0.5, t = 'sine') { const c = ac(), o = c.createOscillator(), G = c.createGain(), T = c.currentTime; o.type = t; o.frequency.setValueAtTime(f0, T); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), T + d); G.gain.setValueAtTime(g, T); G.gain.exponentialRampToValueAtTime(0.0001, T + d); o.connect(G); G.connect(c.destination); o.start(); o.stop(T + d) }
  const SFX = {
    beat() { tone(60, 38, 0.13, 0.8); setTimeout(() => tone(52, 34, 0.11, 0.5), 160) },
    tick() { tone(1400, 1300, 0.04, 0.12, 'square') },
    chip() { noise(0.04, 0.5, 3000); tone(2200, 1800, 0.05, 0.12, 'triangle') },
    lock() { noise(0.06, 0.8, 1200); tone(300, 120, 0.12, 0.4, 'square') },
    shot() { noise(0.6, 1.3, 0, 3500); tone(140, 40, 0.35, 0.8, 'triangle') },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f, 0.25, 0.25, 'triangle'), i * 100)) },
    big() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, f * 1.01, 0.4, 0.3, 'triangle'), i * 90)); setTimeout(() => noise(1.2, 0.25, 4000), 500) },
    lose() { tone(220, 70, 0.8, 0.35, 'sawtooth') },
    dry() { noise(0.025, 0.45, 4500) }
  }
  // 真实采样：开枪 vs 空膛（WebAudio 解码，零延迟触发）
  const BUF = {}, CUES = {}, SLOG = []
  async function loadSfx() {
    try { Object.assign(CUES, await (await fetch('/static/sfx/l13_cues.json')).json()) } catch {}
    await Promise.all(['shot_a', 'shot_b', 'click', 'fall', 'cock', 'ring'].map(async (k) => { try { BUF[k] = await ac().decodeAudioData(await (await fetch(`/static/sfx/${k}.mp3`)).arrayBuffer()) } catch {} }))
  }
  function samp(k, gain = 1, delay = 0, rate = 1) {
    const b = BUF[k]; SLOG.push([k, +(performance.now() / 1000).toFixed(2), V[cur]?.dataset.k, +(V[cur]?.currentTime || 0).toFixed(2)]); if (!b) return false
    const c = ac(), src = c.createBufferSource(), g = c.createGain(); src.buffer = b; src.playbackRate.value = rate; g.gain.value = gain
    src.connect(g); g.connect(c.destination); src.start(c.currentTime + delay); return true
  }
  /** 枪响：n 把同时响（齐射时多把错开几毫秒，听得出"不止一把"） */
  function bang(n = 1) { for (let i = 0; i < Math.min(n, 4); i++) samp(i % 2 ? 'shot_b' : 'shot_a', i ? 0.75 : 1.1, i * 0.035 + Math.random() * 0.02, 0.94 + Math.random() * 0.12) || SFX.shot(); flashFx('bang') }
  /** 空膛：n 把扣空 → 一串清脆"咔"，没有任何回响 */
  function clickN(n = 1, d0 = 0) { for (let i = 0; i < Math.min(n, 6); i++) samp('click', 0.9, d0 + i * 0.07 + Math.random() * 0.03, 0.9 + Math.random() * 0.25) || SFX.dry?.() }
  function flashFx(kind) { const st = $('#l13-stage'); st.classList.remove('fx-bang', 'fx-click'); void st.offsetWidth; st.classList.add('fx-' + kind); setTimeout(() => st.classList.remove('fx-' + kind), 700) }
  function stamp(txt, cls) { const e = document.createElement('div'); e.className = 'l13-stamp ' + cls; e.innerHTML = txt; $('#l13-stage').appendChild(e); setTimeout(() => e.remove(), 1500) }

  function heart(bpm) { hb = bpm; if (hbT) return; const L = () => { if (!hb) { hbT = null; return } SFX.beat(); hbT = setTimeout(L, 60000 / hb) }; L() }
  const heartStop = () => { hb = 0 }

  // ─────────── 双缓冲视频：下一段提前加载，切换零黑屏 ───────────
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
  /** 播放片段 k；opts.hold=true → 播完停在最后一帧（尸体留在画面里）；opts.max 截断 */
  function play(k, opts = {}) {
    if (!has(k)) return Promise.resolve(false)
    const c = MEDIA.clips[k]
    return new Promise(async (res) => {
      const nv = V[1 - cur], ov = V[cur]
      if (nv.dataset.k !== k) { nv.dataset.k = k; nv.src = c.url }
      nv.currentTime = 0; nv.muted = false; nv.loop = !!opts.loop; nv.volume = opts.vol ?? 1
      if (opts.cue != null) { let fired = false, pre = false; const cueT = opts.cue; const tick = () => { if (done) return; const t = nv.currentTime; if (!pre && t >= cueT - 0.55) { pre = true; heartStop(); opts.onPre?.() } if (!fired && t >= cueT - 0.03) { fired = true; opts.onCue?.() } else requestAnimationFrame(tick) }; requestAnimationFrame(tick) }
      let done = false, t = 0
      const fin = () => { if (done) return; done = true; clearTimeout(t); res(true) }
      const arm = () => { clearTimeout(t); t = setTimeout(fin, Math.min(opts.max || 1e9, (c.dur + 2) * 1000)) }
      nv.onended = fin; nv.onerror = fin; t = setTimeout(fin, 15000)
      nv.onplaying = () => { nv.classList.add('on'); ov.classList.remove('on'); if (!opts.keepOld) ov.pause(); cur = 1 - cur; arm(); nv.onplaying = null }
      try { await nv.play() } catch { nv.muted = true; try { await nv.play() } catch { clearTimeout(t); await tapToPlay(nv); arm() } }
    })
  }
  const stopVideo = () => V.forEach((v) => { v.pause(); v.classList.remove('on') })

  // ─────────── 状态 ───────────
  const hud = $('#l13-hud'), roster = $('#l13-roster'), cap = $('#l13-caption'), big = $('#l13-big'), over = $('#l13-over'), bar = $('#l13-bet'), dark = $('#l13-dark')
  let M, S = { bet: 20, auto: false, run: null, dead: new Set(), streak: 0, sess: { n: 0, net: 0 }, balance: 0 }
  const name = (id) => M.prisoners.find((p) => p.id === id)?.name || '#' + id
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
    roster.innerHTML = M.prisoners.map((p) => `<span class="rp ${S.dead.has(p.id) ? 'dead' : alive && !alive.includes(p.id) ? 'out' : ''} ${hi.includes(p.id) ? 'hi' : ''}" style="background-image:url('${face(p.id)}')"><b>${p.id}</b></span>`).join('')
  }
  function bigText(html, cls = '', ms = 1400) { big.className = 'l13-big ' + cls; big.innerHTML = `<div>${html}</div>`; void big.offsetWidth; big.classList.add('go'); return sleep(ms) }

  // ─────────── 中奖特效（canvas 金币雨 + 数字滚动） ───────────
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
  /** 打开押注窗口：返回 Promise<{tier}|null> */
  function betWindow(rc, lockAt) {
    return new Promise((res) => {
      const duel = rc.type === 'duel', total = lockAt - Date.now()
      bar.className = 'l13-betbar open'
      bar.innerHTML = `<div class="bb-q"><b>${duel ? '谁活着走出去？' : `这一枪之后，<em>${rc.alive.length}</em> 人里还剩几个？`}</b><span class="bb-sec" id="bb-sec">8</span></div>
        <div class="bb-opts">${rc.tiers.map((t) => `<button class="bo" data-t="${t.id}">${duel ? `<i style="background-image:url('${face(t.lo)}')"></i>` : ''}<span>${esc(duel ? `${t.lo} 号 ${name(t.lo)}` : t.label)}</span><b>${xm(t.odds)}</b><small>${pct(t.p)}</small></button>`).join('')}</div>
        <div class="bb-foot"><div class="bb-stake">${STK().map((v) => `<button class="ck ${v === S.bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div><button class="bb-skip" id="bb-skip">这轮不押</button></div>
        <div class="bb-timer"><i id="bb-bar"></i></div>`
      bindStake()
      let done = false, last = 9
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
    ac().resume?.(); unlock(); if (!BUF.shot_a) loadSfx()
    over.className = 'l13-over'; over.innerHTML = ''
    let r
    try { r = await api('/api/l13/start', { body: { picks: [] } }) } catch (e) {
      if (e.code === 'ONE_AT_A_TIME' && M.open_run) { await api(`/api/l13/runs/${M.open_run}/skip`, { body: {} }).catch(() => {}); M.open_run = null; return startRun() }
      toast(e.message); return showLobby()
    }
    Object.assign(S, { run: r, dead: new Set(), streak: 0, justBonus: false }); M.pool = r.pool; S.balance = r.balance; renderHud(); renderRoster(r.round.alive)
    bar.className = 'l13-betbar'; bar.innerHTML = ''
    caption('主持人：<b>规矩只有一条——最后站着的人，明天出去。</b>')
    if (S.sess.n === 0) { preload('intro'); await play('intro') } else { preload('plate'); await sleep(600) }
    await round(r.round)
  }
  async function round(rc) {
    const duel = rc.type === 'duel'
    // ① 上弹特写（k 发）或决斗开场
    if (duel) {
      if (rc.released?.length) caption(`主持人：<b>${rc.released.map((x) => x + ' 号').join('、')}</b>，你们可以走了。`)
      renderRoster(rc.pair, rc.pair)
      caption(`<b class="red">决斗</b> · ${rc.pair.map((x) => `${x} 号 ${esc(name(x))}`).join(' <b>对</b> ')}`, 'warn')
      if (rc.pair.every((x) => has('face' + x))) {
        for (const x of rc.pair) { preload('face' + x); renderRoster(rc.pair, [x]); caption(`<b class="red">决斗</b> · <b>${x} 号 ${esc(name(x))}</b>`, 'warn'); await play('face' + x, { max: 2600 }) }
      } else { preload('duel_intro'); await play('duel_intro', { max: 4500 }) }
    } else {
      caption(`${rc.extra ? '<b class="red">加赛</b> · ' : ''}第 <b>${rc.k}</b> 轮 · 每把枪装 <b class="red">${rc.bullets}</b> 发 · 每人中枪 ${pct(rc.bullets / 6)}`)
      const lk = 'load' + Math.min(rc.bullets, 5); preload(lk); heart(90 + rc.k * 12)
      await play(has(lk) ? lk : 'load_' + pick(['a', 'b']), { max: 6500 })
    }
    // ② 屏上押注：同时循环播放当轮一个活人的近景脸（决赛 = 真正剩下的人）
    const pool = duel ? rc.pair : rc.alive, who = pool[Math.floor(Math.random() * pool.length)]
    const fk = 'face' + who; if (has(fk)) play(fk, { loop: true })
    // 少人轮 / 决斗：押注期间轮流切每个真正活着的人的脸
    let cyc = 0, ci = pool.indexOf(who)
    if (pool.length <= 4) cyc = setInterval(() => { ci = (ci + 1) % pool.length; const x = pool[ci]; if (has('face' + x)) { play('face' + x, { loop: true }); renderRoster(pool, [x]) } }, 2600)
    caption(duel ? `${rc.pair.map((x) => `<b>${x} 号</b>`).join(' 对 ')} · 每枪加一发` : `<b>${rc.alive.length}</b> 人举枪 · 灯一亮同时扣扳机`)
    renderRoster(pool, [who])
    const arm = await api(`/api/l13/runs/${S.run.run_id}/arm`, { body: {} })
    const lockAt = arm.lock_at + (Date.now() - arm.server_time) - 800
    heart(140 + rc.k * 8)
    const choice = await betWindow(rc, lockAt); clearInterval(cyc)
    let r
    try { r = await api(`/api/l13/runs/${S.run.run_id}/act`, { body: { k: rc.k, ...(choice || {}) } }) }
    catch (e) { toast(e.message); if (e.code === 'INSUFFICIENT') needChips(); r = await api(`/api/l13/runs/${S.run.run_id}/act`, { body: { k: rc.k } }) }
    if (r.side) setBalance(S.balance - r.side.bet)
    bar.className = 'l13-betbar msg'; bar.innerHTML = `<div class="bb-msg">${r.side ? `已押 <b>${esc(duel ? r.side.label : r.side.label)}</b> · ${fmt(r.side.bet)} · <b class="gold">${xm(r.side.odds)}</b>` : '这一轮只看'}</div>`
    heartStop()
    await perform(r.round)
    await settle(r)
    renderHud()
    if (r.ended) return finale(r)
    return round(r.next)
  }
  async function perform(rd) {
    if (rd.type === 'duel') return performDuel(rd)
    for (let v = 0; v <= rd.voids; v++) {
      if (v < rd.voids) { caption('<b class="red">敲杖！</b> 这一枪会让所有人死——作废，重来。', 'warn'); preload('voidC'); await play(has('voidC') ? 'voidC' : 'void'); continue }
      const n = rd.before.length, nf = rd.fired.length, nd = n - nf
      if (nf) {
        // 有人开火：齐射片原声压低，在闪光那一帧叠真实枪声（几把枪响就叠几层）+ 其余空膛的"咔"
        caption('<b>灯亮——</b>', 'dim'); preload('death' + rd.dead[0])
        await play('fire' + n, { max: 3400, vol: 0.12, cue: CUES['fire' + n] ?? 1.5,
          onCue: () => { bang(nf); clickN(Math.min(nd, 5), 0.02); samp('ring', 0.35, 0.25); stamp(`砰！<small>${nf} 把枪响了 · ${nd} 把空膛</small>`, 'bang') } })
        // 倒地：最多 3 人特写；中枪声与画面闪光对齐，随后倒地闷响，尸体留在画面下方
        const shown = rd.dead.slice(0, 3)
        for (const [j, id] of shown.entries()) {
          if (shown[j + 1]) preload('death' + shown[j + 1])
          caption(`<b class="red">${id} 号 ${esc(name(id))}</b>`)
          await play('death' + id, { vol: 0.1, cue: CUES['death' + id] ?? 1, onCue: () => { bang(1); samp('fall', 0.9, 0.45) } })
          S.dead.add(id); renderRoster(rd.after); await sleep(350)
        }
      } else {
        // 全是空膛：不放齐射片（没有一把枪响），镜头给一个人的脸——只有一串干巴巴的"咔"，然后死寂
        const w = pick(rd.before); preload('dry' + w)
        caption('<b>灯亮——</b>', 'dim')
        await play(has('dry' + w) ? 'dry' + w : 'face' + w, { max: 4200, vol: 0.08, cue: CUES['dry' + w] ?? 1,
          onCue: () => { clickN(Math.min(n, 6)); stamp(`咔。<small>${n} 把全是空膛</small>`, 'click'); flashFx('click') } })
        caption('<b>全是空膛。</b>没有人倒下。')
      }
      rd.dead.forEach((id) => S.dead.add(id)); renderRoster(rd.after)
      await bigText(rd.dead.length ? `倒下 <em>${rd.dead.length}</em> 人<small>还剩 ${rd.after.length} 人</small>` : `<em>0</em> 人倒下<small>${rd.after.length} 人都还站着</small>`, rd.dead.length ? 'red' : '', 1300)
    }
  }
  async function performDuel(rd) {
    const [a, b] = rd.pair
    for (const sh of rd.shots) {
      for (let v = 0; v <= sh.voids; v++) {
        caption(`第 <b>${sh.d}</b> 枪 · 各装 <b class="red">${sh.bullets}</b> 发`)
        const lk = 'load' + Math.min(sh.bullets, 5); preload(lk); await play(has(lk) ? lk : 'duel_load', { max: 5000 })
        if (v < sh.voids) { caption('<b class="red">敲杖！</b> 两人都会死——重来。', 'warn'); await play(has('voidC') ? 'voidC' : 'void'); continue }
        if (sh.dead.length) {
          // 一把响一把空：先"咔"（活下来的人扣空），紧跟着"砰"
          const d = sh.dead[0]; caption(`<b class="red">${d} 号 ${esc(name(d))}</b>`)
          await play('death' + d, { vol: 0.1, cue: CUES['death' + d] ?? 1, onPre: () => { if (sh.fired.length === 1) setTimeout(() => clickN(1), 250) }, onCue: () => { bang(1); samp('fall', 0.9, 0.45); samp('ring', 0.35, 0.25); stamp('砰！', 'bang') } })
          S.dead.add(d); renderRoster(rd.pair)
        } else {
          for (const x of [a, b]) { renderRoster(rd.pair, [x]); caption(`<b>${x} 号</b> 扣下扳机——`); await play(has('dry' + x) ? 'dry' + x : 'duel_dry', { max: 3800, vol: 0.08, cue: CUES['dry' + x] ?? 1, onCue: () => { clickN(1); stamp('咔。', 'click'); flashFx('click') } }) }
          await bigText('<em>两声空响</em><small>两个人都还站着</small>', '', 1100)
        }
      }
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
    caption(w === 13 ? '<b class="gold">13 号 · 阿森</b> 活下来了。他攥着那封信，手还在抖。' : `<b class="gold">${w} 号 · ${esc(name(w))}</b> 站到了最后。`, 'gold')
    preload('winner' + w); await play('winner' + w, { max: 5200 })
    S.sess.n++; S.sess.net += r.net || 0; setBalance(r.balance); renderHud()
    // 局间：3 秒自动进下一局（可取消）
    over.className = 'l13-over next'
    over.innerHTML = `<div class="nx"><div class="nx-w" style="background-image:url('${face(w)}')"><b>${w}</b></div>
      <h3>${w} 号 ${esc(name(w))} 活到最后</h3>
      <p>本局 <b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b>${r.best_streak ? ` · 最高 ${r.best_streak} 连中` : ''}${r.bonus_total ? ` · 奖池 +${fmt(r.bonus_total)}` : ''} · 余额 ${fmt(r.balance)}</p>
      <button class="btn gold big" id="nx-go"><i class="fas fa-forward"></i> 下一局 <span id="nx-c">3</span></button>
      <div class="nx-acts"><label><input type="checkbox" id="nx-auto" ${S.auto ? 'checked' : ''}> 自动连播</label><button class="lnk" id="nx-stop">歇一会</button>
      <details class="verify"><summary>公平验证</summary><code>seed ${esc(r.verify.seed)}</code><code>commit ${esc(r.verify.commit)}</code><a href="/api/l13/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details></div></div>`
    let c = S.auto ? 3 : 6, stop = false
    $('#nx-auto').onchange = (e) => (S.auto = e.target.checked)
    $('#nx-stop').onclick = () => { stop = true; showLobby() }
    const go = () => { if (stop) return; stop = true; startRun() }
    $('#nx-go').onclick = go
    while (!stop && c > 0) { await sleep(1000); c--; const e = $('#nx-c'); if (e) e.textContent = c }
    if (!stop) go()
  }

  // ─────────── 大厅（极简：一个按钮 + 玩法三句话） ───────────
  function showLobby() {
    stopVideo(); renderRoster(); renderHud(); betIdle('选好注金，开局后每轮在这里押')
    caption('')
    over.className = 'l13-over lobby'
    over.innerHTML = `<div class="lb"><h1>致命<b>13</b></h1>
      <ol><li><b>13 人</b>站成一圈，每人枪口顶着前一个人。第 k 轮每把枪装 <b>k 发</b>，灯一亮同时扣扳机。</li>
      <li>每轮开枪前 <b>8 秒</b>，在屏幕下方押<b>「这一枪后还剩几人」</b>，押错不出局，下一轮接着押。</li>
      <li>连中 <b>${M.cfg.streak_need} 轮</b>拿奖池大奖；最后两人决斗，押谁活下来。</li></ol>
      <button class="btn gold big" id="lb-go"><i class="fas fa-skull"></i> 进场</button>
      <p class="mut">奖池 ${fmt(M.pool)} · 已开 ${fmt(M.stats.plays)} 局 · 一局约 2 分钟 · 局与局自动衔接</p></div>`
    $('#lb-go').onclick = startRun
  }

  ;(async () => {
    try { M = await api('/api/l13/meta'); MEDIA = M.media } catch (e) { over.innerHTML = `<div class="lb"><p>${esc(e.message)}</p></div>`; return }
    const me = await api('/api/me').catch(() => null); S.balance = me?.chips ?? me?.user?.chips ?? 0
    loadSfx(); showLobby()
    window.L13RT = { S, M, SLOG, BUF }
  })()
})()
