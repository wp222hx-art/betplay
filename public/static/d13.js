// 致命13 · 社交房间前端
// 一个房间 = 一局；全房间按服务端时间线同步观看（start_at + 事件偏移）
// 下注只有一张卡：身份（入座 / 外围）→ 座位号 → 三选一（活过 3 轮 / 活过 4 轮 / 拿冠军）→ 注金 → 确认
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const NAMES = ['老鬼', '刀疤', '眼镜', '小四', '和尚', '阿彪', '哑巴', '老K', '黑皮', '书生', '二愣', '胖虎', '阿森']
  const face = (i) => `/gimg/l13_deadly13/p${i}.webp`
  const T = { s3: '活过 3 轮', s4: '活过 4 轮', champ: '拿冠军' }
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.message || '请求失败'), { code: j.error })
    return j
  }
  function toast(m, cls = '') { const t = document.createElement('div'); t.className = 'd13-toast ' + cls; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800) }

  // ─────────── 声音：真实采样（开枪 / 空膛 / 倒地）+ 合成心跳 ───────────
  let AC = null; const BUF = {}; let CUES = {}, soundOn = false
  const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  async function loadSfx() {
    try { CUES = await (await fetch('/static/sfx/l13_cues.json')).json() } catch {}
    await Promise.all(['shot_a', 'shot_b', 'click', 'fall', 'cock', 'ring'].map(async (k) => { try { BUF[k] = await ac().decodeAudioData(await (await fetch(`/static/sfx/${k}.mp3`)).arrayBuffer()) } catch {} }))
  }
  function samp(k, gain = 1, delay = 0, rate = 1) { if (!soundOn || !BUF[k]) return; const c = ac(), s = c.createBufferSource(), g = c.createGain(); s.buffer = BUF[k]; s.playbackRate.value = rate; g.gain.value = gain; s.connect(g); g.connect(c.destination); s.start(c.currentTime + delay) }
  function tone(f0, f1, d, g = 0.4, type = 'sine', delay = 0) { if (!soundOn) return; const c = ac(), o = c.createOscillator(), G = c.createGain(), t0 = c.currentTime + delay; o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + d); G.gain.setValueAtTime(0.0001, c.currentTime); G.gain.setValueAtTime(g, t0); G.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(G); G.connect(c.destination); o.start(t0); o.stop(t0 + d + 0.02) }
  const SFX = {
    bang() { samp(Math.random() < 0.5 ? 'shot_a' : 'shot_b', 1.1, 0, 0.95 + Math.random() * 0.1); samp('fall', 0.8, 0.5) },
    click() { samp('click', 0.9, 0, 0.9 + Math.random() * 0.2) },
    cock() { samp('cock', 0.7) },
    tick() { tone(1400, 1300, 0.04, 0.1, 'square') },
    chip() { tone(2200, 1800, 0.05, 0.12, 'triangle') },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.25, 0.22, 'triangle', i * 0.1)) },
    big() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, f * 1.01, 0.4, 0.26, 'triangle', i * 0.09)) },
    lose() { tone(220, 70, 0.8, 0.3, 'sawtooth') }
  }

  // ─────────── 视频（双缓冲）+ 静帧兜底 ───────────
  const V = [$('#d13-v0'), $('#d13-v1')]; let cur = 0, MEDIA = null
  V.forEach((v) => { v.muted = true; v.playsInline = true; v.disablePictureInPicture = true })
  const has = (k) => !!MEDIA?.clips?.[k]?.url
  const still = $('#d13-still')
  function showStill(url) { if (url) { still.style.backgroundImage = `url('${url}')`; still.classList.add('on') } else still.classList.remove('on') }
  let playTok = 0
  function play(k, o = {}) {
    if (!has(k)) { V.forEach((v) => v.classList.remove('on')); if (o.still) showStill(o.still); return false }
    const tok = ++playTok, nv = V[1 - cur], ov = V[cur], c = MEDIA.clips[k]
    if (nv.dataset.k !== k) { nv.dataset.k = k; nv.src = c.url }
    nv.loop = !!o.loop; nv.muted = !soundOn; nv.volume = o.vol ?? 1
    const go = () => { try { nv.currentTime = o.from || 0 } catch {} nv.play().then(() => { if (tok !== playTok) return; nv.classList.add('on'); ov.classList.remove('on'); ov.pause(); cur = 1 - cur; showStill(null) }).catch(() => { nv.muted = true; nv.play().catch(() => {}) }) }
    if (nv.readyState >= 1) go(); else nv.addEventListener('loadedmetadata', go, { once: true })
    if (o.until != null) { const stop = () => { if (tok !== playTok) return; if (nv.currentTime >= o.until) nv.pause(); else requestAnimationFrame(stop) }; requestAnimationFrame(stop) }
    return true
  }
  function preload(k) { if (!has(k)) return; const v = V[1 - cur]; if (v.dataset.k !== k) { v.dataset.k = k; v.src = MEDIA.clips[k].url; v.load() } }

  // ─────────── 圈（SVG）：13 个点，谁 → 谁，死亡标记，我的座位 ───────────
  const ringEl = $('#d13-ring')
  const xy = (i) => { const a = ((i - 1) / 13) * Math.PI * 2 - Math.PI / 2; return [50 + 41 * Math.cos(a), 50 + 41 * Math.sin(a)] }
  function drawRing() {
    ringEl.innerHTML = `<circle cx="50" cy="50" r="41" fill="none" stroke="#fff" stroke-opacity=".14" stroke-dasharray="1.5 2"/>
      <line id="rg-aim" x1="0" y1="0" x2="0" y2="0" stroke="#ffb020" stroke-width="1.6" marker-end="url(#rgh)" opacity="0"/>
      <defs><marker id="rgh" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" fill="#ffb020"/></marker></defs>
      ${NAMES.map((n, k) => { const i = k + 1, [x, y] = xy(i); return `<g id="rg${i}" class="rg"><circle cx="${x}" cy="${y}" r="4.6"/><text x="${x}" y="${y + 1.7}" text-anchor="middle">${i}</text></g>` }).join('')}`
  }
  function ringState() {
    for (let i = 1; i <= 13; i++) {
      const g = $('#rg' + i, ringEl); if (!g) continue
      g.classList.toggle('dead', S.dead.has(i)); g.classList.toggle('me', S.watch?.me?.seat === i)
      g.classList.toggle('human', !!S.watch?.seats?.[i - 1]?.user && !S.watch.seats[i - 1].user.bot)
      g.classList.toggle('gone', !!S.gone?.has(i))
    }
  }
  function aim(a, b) {
    const ln = $('#rg-aim', ringEl); if (!ln) return
    if (!a) { ln.setAttribute('opacity', 0); $$('.rg', ringEl).forEach((g) => g.classList.remove('cur', 'gun')); return }
    const [x1, y1] = xy(a), [x2, y2] = xy(b), L = Math.hypot(x2 - x1, y2 - y1), k = 5.5 / L
    ln.setAttribute('x1', x1 + (x2 - x1) * k); ln.setAttribute('y1', y1 + (y2 - y1) * k); ln.setAttribute('x2', x2 - (x2 - x1) * k * 1.25); ln.setAttribute('y2', y2 - (y2 - y1) * k * 1.25); ln.setAttribute('opacity', 1)
    $$('.rg', ringEl).forEach((g) => g.classList.remove('cur', 'gun')); $('#rg' + b, ringEl)?.classList.add('cur'); $('#rg' + a, ringEl)?.classList.add('gun')
  }

  // ─────────── 舞台文字 / 特效 ───────────
  const cap = $('#d13-cap'), big = $('#d13-big'), phase = $('#d13-phase'), stage = $('#d13-stage')
  function caption(h, cls = '') { cap.className = 'd13-cap ' + cls; cap.innerHTML = h; void cap.offsetWidth; cap.classList.add('in') }
  function bigText(h, cls = '', ms = 1600) { big.className = 'd13-big ' + cls; big.innerHTML = `<div>${h}</div>`; void big.offsetWidth; big.classList.add('go'); setTimeout(() => big.classList.remove('go'), ms) }
  function flash(kind) { stage.classList.remove('fx-bang', 'fx-click'); void stage.offsetWidth; stage.classList.add('fx-' + kind); setTimeout(() => stage.classList.remove('fx-' + kind), 650) }
  function stamp(txt, cls) { const e = document.createElement('div'); e.className = 'd13-stamp ' + cls; e.textContent = txt; stage.appendChild(e); setTimeout(() => e.remove(), 1400) }
  const fx = $('#d13-fx'); let fxP = [], fxOn = false
  function coins(n = 80) {
    const r = fx.getBoundingClientRect(); fx.width = r.width * devicePixelRatio; fx.height = r.height * devicePixelRatio
    for (let i = 0; i < n; i++) fxP.push({ x: fx.width / 2 + (Math.random() - 0.5) * fx.width * 0.3, y: fx.height * 0.5, vx: (Math.random() - 0.5) * 20, vy: -Math.random() * 24 - 8, r: (5 + Math.random() * 7) * devicePixelRatio, a: Math.random() * 6 })
    if (!fxOn) { fxOn = true; requestAnimationFrame(fxLoop) }
  }
  function fxLoop() {
    const c = fx.getContext('2d'); c.clearRect(0, 0, fx.width, fx.height); fxP = fxP.filter((p) => p.y < fx.height + 40)
    for (const p of fxP) { p.vy += 0.9; p.x += p.vx; p.y += p.vy; p.a += 0.2; const w = Math.abs(Math.cos(p.a)) * p.r; c.fillStyle = '#ffc53d'; c.beginPath(); c.ellipse(p.x, p.y, w + 1, p.r, 0, 0, 7); c.fill() }
    if (fxP.length) requestAnimationFrame(fxLoop); else { fxOn = false; c.clearRect(0, 0, fx.width, fx.height) }
  }

  // ─────────── 状态 ───────────
  const CODE = document.body.dataset.code || ''
  const S = {
    off: 0, balance: 0, cfg: null, watchId: null, watch: null, dead: new Set(), gone: new Set(), done: new Set(), chatSeen: new Set(), lastStatus: '',
    form: { role: 'seat', seat: 0, pick: 's3', stake: 20 }, betTarget: null, busy: false, resultShown: null
  }
  const srvNow = () => Date.now() + S.off
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  async function refreshMe() { try { const me = await api('/api/me'); S.balance = me.chips ?? 0; $('#top-bal b').textContent = fmt(S.balance) } catch {} }

  // ─────────── 时间线回放（同步） ───────────
  function evKey(e) { return `${S.watchId}:${e.at}:${e.type}` }
  function applySilent(e) { if ((e.type === 'shot' || e.type === 'dshot') && e.hit) S.dead.add(e.target); if (e.type === 'duel') (e.released || []).forEach((x) => S.gone.add(x)) }
  function perform(e) {
    const L = (k) => preload(k)
    switch (e.type) {
      case 'intro': caption('灯灭。13 个人围成一圈，每人枪口顶着前一个人的后背。'); play('intro', { still: '/gimg/l13_deadly13/cover.webp' }); break
      case 'round': {
        aim(0); caption(`${e.extra ? '<b class="red">加赛</b> · ' : ''}第 <b>${e.k}</b> 轮 · 每把枪装 <b class="red">${e.bullets}</b> 发 · 每人中枪 ${Math.round((e.bullets / 6) * 100)}%`)
        SFX.cock(); play('load' + Math.min(e.bullets, 5), { still: '/gimg/l13_deadly13/cover.webp' }); phaseTag(`第 ${e.k} 轮`); break
      }
      case 'void': caption('<b class="red">敲杖！</b>这一枪会让所有人死——作废，重来。', 'warn'); play('voidC'); break
      case 'shot': case 'dshot': {
        const k = (e.hit ? 'hit' : 'miss') + e.target, c = CUES[k] ?? 1
        aim(e.shooter, e.target)
        const mine = S.watch?.me && S.watch.me.seat === e.target
        caption(`<b>${e.shooter}</b> 号 → <b>${e.target} 号 ${esc(NAMES[e.target - 1])}</b>${mine ? ' <em class="mine">（你押的人）</em>' : ''}`, e.hit ? '' : 'dim')
        play(k, { from: Math.max(0, c - 0.7), until: e.hit ? c + 2.4 : c + 0.8, vol: 0.12, still: face(e.target) })
        setTimeout(() => {
          if (e.hit) { SFX.bang(); flash('bang'); stamp('砰！', 'bang'); S.dead.add(e.target); if (mine) bigText(`<em>${e.target} 号倒下了</em><small>你押的人</small>`, 'red', 1500) }
          else { SFX.click(); flash('click'); stamp('咔。', 'click') }
          ringState(); renderSeats()
        }, 700)
        break
      }
      case 'tally': aim(0); bigText(e.dead.length ? `倒下 <em>${e.dead.length}</em> 人<small>还剩 ${e.after.length} 人</small>` : `<em>0</em> 人倒下<small>${e.after.length} 人都还站着</small>`, e.dead.length ? 'red' : '', 2000); break
      case 'duel': {
        (e.released || []).forEach((x) => S.gone.add(x)); ringState(); renderSeats(); phaseTag('决斗')
        caption(`${e.released?.length ? `${e.released.map((x) => x + ' 号').join('、')} 活着离场 · ` : ''}<b class="red">决斗</b> ${e.pair.map((x) => `<b>${x} 号 ${esc(NAMES[x - 1])}</b>`).join(' 对 ')}`, 'warn')
        play('face' + e.pair[0], { still: face(e.pair[0]) }); setTimeout(() => play('face' + e.pair[1], { still: face(e.pair[1]) }), 2500); break
      }
      case 'dload': caption(`决斗第 <b>${e.d}</b> 枪 · 各装 <b class="red">${e.bullets}</b> 发`); SFX.cock(); play('load' + Math.min(e.bullets, 5)); break
      case 'dmiss': bigText('<em>两声空响</em><small>两个人都还站着</small>', '', 1300); break
      case 'winner': aim(0); caption(`<b class="gold">${e.winner} 号 · ${esc(NAMES[e.winner - 1])}</b> 活到了最后`, 'gold'); play('winner' + e.winner, { still: face(e.winner) }); SFX.win(); phaseTag('冠军'); break
    }
    // 预读下一段
    const ev = S.watch?.events || [], i = ev.findIndex((x) => x.at === e.at && x.type === e.type), nx = ev[i + 1]
    if (nx) L(nx.type === 'shot' || nx.type === 'dshot' ? (nx.hit ? 'hit' : 'miss') + nx.target : nx.type === 'round' || nx.type === 'dload' ? 'load' + Math.min(nx.bullets, 5) : nx.type === 'winner' ? 'winner' + nx.winner : '')
  }
  function timelineTick() {
    const w = S.watch; if (!w || !w.events || !w.room.start_at) return
    const el = srvNow() - w.room.start_at
    for (const e of w.events) {
      const key = evKey(e); if (S.done.has(key) || e.at > el) continue
      S.done.add(key)
      if (el - e.at > Math.min(1500, e.dur)) applySilent(e) // 迟到 → 静默补状态，不补播
      else perform(e)
    }
    if (w.room.status === 'playing') phase.querySelector('.ph-t') && (phase.querySelector('.ph-t').textContent = mmss((w.total || 0) - el))
  }
  function phaseTag(t) { phase.innerHTML = `<span class="ph-live"><i></i>直播中</span><b>${esc(t)}</b><span class="ph-t"></span>`; phase.className = 'd13-phase on' }

  // ─────────── 拉取房间状态 ───────────
  async function load(id) {
    const st = await api('/api/d13/rooms/' + id)
    S.off = st.server_time - Date.now()
    if (id !== S.watchId) { S.watchId = id; S.dead = new Set(); S.gone = new Set(); S.done = new Set(); S.resultShown = null; drawRing(); aim(0); V.forEach((v) => { v.pause(); v.classList.remove('on') }); showStill('/gimg/l13_deadly13/cover.webp') }
    S.watch = st
    if (st.room.status === 'ended' && st.result) { // 进来就是结束的局：直接把所有人状态补齐
      for (const f of st.result.fates) if (f.died_round) S.dead.add(f.seat)
    }
    renderTop(); renderSeats(); renderChat(st.chat); renderOuts(); ringState(); renderPanel()
    if (st.room.status === 'waiting') {
      phase.className = 'd13-phase on wait'; phase.innerHTML = `<span class="ph-wait"><i class="fas fa-hourglass-half"></i>等待开局</span><b id="ph-cd">${mmss(st.room.lock_at - srvNow())}</b>`
      caption(`${st.seats.filter((x) => x.user).length} / 13 个座位有人 · 外围 ${st.outs.n} 单 · 倒计时结束自动开局`, 'dim')
    }
    if (st.room.status === 'ended' && S.resultShown !== st.room.id) showResult(st)
    S.lastStatus = st.room.status
    return st
  }
  function showResult(st) {
    S.resultShown = st.room.id
    const w = st.result.winner, me = st.me
    setTimeout(async () => {
      if (S.watchId !== st.room.id) return
      if (me) {
        const won = me.payout + me.bonus
        if (won > 0) { SFX.big(); coins(120); bigText(`押中 <em>+${fmt(won)}</em><small>${me.role === 'seat' ? `你坐的 ${me.seat} 号` : `你押的 ${me.seat} 号`} · ${T[me.pick]}${me.bonus ? ` · 冠军奖池 +${fmt(me.bonus)}` : ''}</small>`, 'gold', 3200) }
        else { SFX.lose(); bigText(`没中 <em>-${fmt(me.stake)}</em><small>${me.seat} 号 · ${T[me.pick]}</small>`, 'red', 2400) }
      }
      await refreshMe(); renderPanel()
    }, st.events ? 1200 : 0)
  }

  // ─────────── 渲染：顶栏 / 座位 / 外围 / 聊天 ───────────
  function renderTop() {
    const r = S.watch.room
    $('#room-tag').innerHTML = r.kind === 'private' ? `<i class="fas fa-lock"></i> ${esc(r.title || '私人房')} · <b>${esc(r.code)}</b> <button id="btn-share" class="mini"><i class="fas fa-share-nodes"></i> 邀请</button>` : '<i class="fas fa-globe"></i> 公共厅'
    $('#btn-share')?.addEventListener('click', share)
  }
  function renderSeats() {
    const w = S.watch; if (!w) return
    const fates = w.result?.fates
    $('#d13-seats').innerHTML = w.seats.map((s) => {
      const u = s.user, dead = S.dead.has(s.seat), gone = S.gone.has(s.seat), win = w.result?.winner === s.seat && w.room.status === 'ended'
      const outN = w.outs.by_seat?.[s.seat] || 0
      return `<button class="seat ${dead ? 'dead' : ''} ${gone ? 'gone' : ''} ${win ? 'win' : ''} ${u?.mine ? 'mine' : ''} ${u && !u.bot ? 'human' : ''}" data-seat="${s.seat}">
        <i class="pf" style="background-image:url('${face(s.seat)}')"><b>${s.seat}</b>${dead ? '<em class="x"></em>' : ''}</i>
        <span class="nm">${esc(s.name)}</span>
        <span class="who">${u ? `${u.mine ? '<b class="me">我</b>' : esc(u.nick)}${u.bot ? '<small>模拟</small>' : ''}` : '<small class="empty">空座</small>'}</span>
        ${u ? `<span class="tk">${T[u.pick]} · ${fmt(u.stake)}${u.hit === true ? ' <b class="ok">中</b>' : u.hit === false ? ' <b class="no">没中</b>' : ''}</span>` : ''}
        ${outN ? `<span class="on"><i class="fas fa-eye"></i>${outN}</span>` : ''}
      </button>`
    }).join('')
    $$('#d13-seats .seat').forEach((b) => (b.onclick = () => { if (canBet()) { S.form.seat = +b.dataset.seat; renderPanel(); $('#d13-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } }))
  }
  function renderOuts() {
    const o = S.watch.outs; $('#outs-n').textContent = o.n
    $('#d13-outs').innerHTML = o.n ? `<p class="sum">外围共 ${o.n} 单 · ${fmt(o.total)} 筹码</p>` + o.list.slice().reverse().map((x) => `<div class="orow ${x.mine ? 'mine' : ''}"><i style="background-image:url('${face(x.seat)}')"></i><b>${x.mine ? '我' : esc(x.nick)}${x.bot ? '<small>模拟</small>' : ''}</b><span>押 ${x.seat} 号 ${T[x.pick]}</span><em>${fmt(x.stake)} × ${x.odds}</em>${x.hit === true ? '<b class="ok">中</b>' : x.hit === false ? '<b class="no">没中</b>' : ''}</div>`).join('') : '<p class="sum">还没有人在外围下注</p>'
  }
  function renderChat(list = []) {
    const box = $('#d13-chat'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
    let added = 0
    for (const m of list) {
      if (S.chatSeen.has(m.id)) continue; S.chatSeen.add(m.id); added++
      const d = document.createElement('div'); d.className = 'cm ' + m.kind
      d.innerHTML = m.kind === 'sys' ? `<span class="sys">${esc(m.text)}</span>` : `<b>${esc(m.nickname || '玩家')}${m.bot ? '<small>模拟</small>' : ''}</b><span>${esc(m.text)}</span>`
      box.appendChild(d)
    }
    while (box.children.length > 120) box.firstChild.remove()
    if (added && atBottom) box.scrollTop = box.scrollHeight
  }
  async function renderMine() {
    try {
      const { history } = await api('/api/d13/me')
      $('#d13-mine').innerHTML = history.length ? history.map((h) => `<div class="orow"><i style="background-image:url('${face(h.seat)}')"></i><b>${h.role === 'seat' ? '入座' : '外围'} ${h.seat} 号</b><span>${T[h.pick]} · ${fmt(h.stake)} × ${h.odds}</span>${h.status !== 'ended' ? '<em>进行中</em>' : h.hit ? `<b class="ok">+${fmt(h.payout + h.bonus)}</b>` : '<b class="no">没中</b>'}</div>`).join('') : '<p class="sum">还没有下过注</p>'
    } catch {}
  }

  // ─────────── 下注卡（唯一的交互） ───────────
  // 下注目标：观看的局在等待 → 押这一局；观看的局在打 → 押下一局（state.next）
  function target() {
    const w = S.watch; if (!w) return null
    if (w.room.status === 'waiting') return { id: w.room.id, lock_at: w.room.lock_at, taken: w.seats.filter((s) => s.user).map((s) => s.seat), me: w.me, label: '这一局', is_host: w.room.is_host }
    if (w.next) return { id: w.next.id, lock_at: w.next.lock_at, taken: w.next.taken.map((x) => x.seat), me: w.next.me, label: '下一局', next: true }
    return null
  }
  const canBet = () => { const t = target(); return t && !t.me && t.lock_at - srvNow() > 1200 }
  function renderPanel() {
    const P = $('#d13-panel'), t = target(), w = S.watch, cfg = S.cfg
    if (!t || !cfg) { P.innerHTML = ''; return }
    const left = t.lock_at - srvNow()
    if (t.me) { // 已下注：一张票
      const m = t.me
      P.innerHTML = `<div class="ticket ${m.role}"><i class="pf" style="background-image:url('${face(m.seat)}')"><b>${m.seat}</b></i>
        <div><small>${t.label} · ${m.role === 'seat' ? '我入座参赛' : '我在外围'}</small><h3>${m.role === 'seat' ? `坐在 ${m.seat} 号（${NAMES[m.seat - 1]}）` : `押 ${m.seat} 号 ${NAMES[m.seat - 1]}`} · ${T[m.pick]}</h3>
        <p>注金 ${fmt(m.stake)} · 赔率 ×${m.odds} · 中了拿 <b>${fmt(Math.floor(m.stake * m.odds))}</b>${m.role === 'seat' && m.pick !== 'champ' ? '' : ''}${m.role === 'seat' ? ` · 若拿冠军另分奖池` : ''}</p></div>
        <span class="cd">${t.next ? `${mmss(left)} 后开局` : left > 0 ? mmss(left) : '开局中'}</span></div>
        ${t.is_host && left > 4000 ? '<button class="btn ghost wide" id="btn-host-start"><i class="fas fa-play"></i> 人齐了，立即开局</button>' : ''}`
      $('#btn-host-start')?.addEventListener('click', hostStart)
      return
    }
    if (left <= 1200) { P.innerHTML = `<div class="locked"><i class="fas fa-lock"></i> ${t.label}已锁定，正在开局…</div>`; return }
    const f = S.form, isSeat = f.role === 'seat', taken = new Set(t.taken)
    if (isSeat && (!f.seat || taken.has(f.seat))) { const free = Array.from({ length: 13 }, (_, i) => i + 1).filter((x) => !taken.has(x)); f.seat = free.length ? free[Math.floor(Math.random() * free.length)] : 0 }
    if (!isSeat && !f.seat) f.seat = 13
    const odds = (id) => (isSeat ? cfg.targets.find((x) => x.id === id).seat_odds : cfg.targets.find((x) => x.id === id).out_odds)
    const win = Math.floor(f.stake * odds(f.pick))
    P.innerHTML = `<div class="bet ${t.next ? 'is-next' : ''}">
      <div class="bet-h"><b>${t.next ? '边看边押 · 下一局' : '押这一局'}</b><span class="cd" id="bet-cd">${mmss(left)}</span></div>
      <div class="role">
        <button class="${isSeat ? 'on' : ''}" data-r="seat"><i class="fas fa-chair"></i><b>入座参赛</b><small>坐进一个位置，押自己</small></button>
        <button class="${!isSeat ? 'on' : ''}" data-r="out"><i class="fas fa-eye"></i><b>外围下注</b><small>不入座，押别人</small></button>
      </div>
      <div class="row-l">${isSeat ? '选一个空座位' : '押几号'}</div>
      <div class="nums">${Array.from({ length: 13 }, (_, i) => i + 1).map((i) => `<button class="${f.seat === i ? 'on' : ''}" data-s="${i}" ${isSeat && taken.has(i) ? 'disabled' : ''}>${i}</button>`).join('')}</div>
      <div class="row-l">${isSeat ? `${f.seat} 号（${NAMES[f.seat - 1] || ''}）押自己…` : `${f.seat} 号（${NAMES[f.seat - 1] || ''}）能…`}</div>
      <div class="picks">${cfg.targets.map((x) => `<button class="${f.pick === x.id ? 'on' : ''}" data-p="${x.id}"><b>${x.label}</b><em>×${odds(x.id)}</em></button>`).join('')}</div>
      <div class="stakes">${cfg.stakes.map((v) => `<button class="${f.stake === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
      <button class="btn gold wide" id="btn-bet" ${S.busy || !f.seat ? 'disabled' : ''}>${isSeat ? '坐下' : '下注'} · 押 ${fmt(f.stake)} 中了拿 <b>${fmt(win)}</b></button>
      <p class="hint">每局只能选一个身份、下一单。${isSeat ? `入座赔率更高；你坐的位置拿冠军，额外分奖池 ${Math.round(cfg.champ_share * 100)}%。` : '外围可以押任何座位，包括有人坐的。'}</p>
    </div>`
    $$('.role button', P).forEach((b) => (b.onclick = () => { S.form.role = b.dataset.r; SFX.chip(); renderPanel() }))
    $$('.nums button', P).forEach((b) => (b.onclick = () => { S.form.seat = +b.dataset.s; SFX.chip(); renderPanel() }))
    $$('.picks button', P).forEach((b) => (b.onclick = () => { S.form.pick = b.dataset.p; SFX.chip(); renderPanel() }))
    $$('.stakes button', P).forEach((b) => (b.onclick = () => { S.form.stake = +b.dataset.v; SFX.chip(); renderPanel() }))
    $('#btn-bet').onclick = placeBet
  }
  async function placeBet() {
    const t = target(); if (!t || S.busy) return
    if (S.balance < S.form.stake) return needChips()
    S.busy = true; renderPanel()
    try {
      const r = await api(`/api/d13/rooms/${t.id}/join`, { body: S.form })
      S.balance = r.balance; $('#top-bal b').textContent = fmt(S.balance); SFX.win()
      toast(r.role === 'seat' ? `已入座 ${r.seat} 号 · 押自己${T[r.pick]}` : `已押 ${r.seat} 号${T[r.pick]}`, 'ok')
      await load(S.watchId)
    } catch (e) { toast(e.message, 'err'); if (e.code === 'INSUFFICIENT') needChips(); await load(S.watchId).catch(() => {}) }
    S.busy = false; renderPanel()
  }
  async function needChips() {
    modal(`<h3>筹码不够了</h3><p>余额 ${fmt(S.balance)}。每天可以免费领一次 500 筹码（余额低于 200 时）。</p><div class="acts"><button class="btn gold" id="m-faucet"><i class="fas fa-gift"></i> 领 500 筹码</button><button class="btn ghost" data-close>算了</button></div>`)
    $('#m-faucet').onclick = async () => { try { await api('/api/me/faucet', { body: {} }); await refreshMe(); closeModal(); toast('+500 已到账', 'ok') } catch (e) { toast(e.message, 'err') } }
  }
  async function hostStart() { try { await api(`/api/d13/rooms/${S.watchId}/start`, { body: {} }); toast('3 秒后开局', 'ok') } catch (e) { toast(e.message, 'err') } }

  // ─────────── 开房间 / 进房间 / 邀请 ───────────
  const modalEl = $('#d13-modal')
  function modal(h) { modalEl.innerHTML = `<div class="box">${h}</div>`; modalEl.classList.add('on'); $$('[data-close]', modalEl).forEach((b) => (b.onclick = closeModal)) }
  function closeModal() { modalEl.classList.remove('on'); modalEl.innerHTML = '' }
  modalEl.onclick = (e) => { if (e.target === modalEl) closeModal() }
  $('#btn-open').onclick = () => {
    modal(`<h3>和朋友开一局</h3><p>开一个私人房间，把链接发给朋友：每人认领一个座位押自己，或者在外围押别人。空着的座位由「模拟」玩家坐，不参与结算。</p>
      <input id="m-title" maxlength="20" placeholder="房间名（可不填），比如：周五夜局">
      <div class="acts"><button class="btn gold" id="m-create"><i class="fas fa-door-open"></i> 开房间</button></div>
      <div class="or">或者输入房号进入</div>
      <div class="join-code"><input id="m-code" maxlength="6" placeholder="6 位房号"><button class="btn ghost" id="m-go">进入</button></div>`)
    $('#m-create').onclick = async () => { try { const r = await api('/api/d13/rooms', { body: { title: $('#m-title').value } }); location.href = '/d13/r/' + r.code } catch (e) { toast(e.message, 'err') } }
    $('#m-go').onclick = () => { const c = $('#m-code').value.trim().toUpperCase(); if (c) location.href = '/d13/r/' + c }
  }
  async function share() {
    const url = location.origin + '/d13/r/' + S.watch.room.code, text = `来致命13坐一个位置：房号 ${S.watch.room.code}`
    try { if (navigator.share) { await navigator.share({ title: '致命13', text, url }); return } } catch {}
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('邀请链接已复制', 'ok') } catch { modal(`<h3>邀请朋友</h3><p>把这个链接发给朋友：</p><input value="${esc(url)}" readonly onclick="this.select()"><div class="acts"><button class="btn ghost" data-close>好的</button></div>`) }
  }

  // ─────────── 聊天 / 标签页 ───────────
  $('#d13-say').onsubmit = async (e) => {
    e.preventDefault(); const i = $('#say-in'), t = i.value.trim(); if (!t || !S.watchId) return
    i.value = ''
    try { await api(`/api/d13/rooms/${S.watchId}/chat`, { body: { text: t } }); const st = await api('/api/d13/rooms/' + S.watchId); renderChat(st.chat); $('#d13-chat').scrollTop = 1e9 } catch (er) { toast(er.message, 'err') }
  }
  $$('.d13-social .tabs button').forEach((b) => (b.onclick = () => {
    $$('.d13-social .tabs button').forEach((x) => x.classList.toggle('on', x === b))
    $$('.d13-social .tab').forEach((x) => x.classList.toggle('on', x.id === 'd13-' + b.dataset.t))
    if (b.dataset.t === 'mine') renderMine()
  }))

  // ─────────── 进入现场（解锁声音）───────────
  $('#d13-tap').onclick = () => {
    soundOn = true; ac().resume?.(); $('#d13-tap').remove()
    V.forEach((v) => { v.muted = false; try { const p = v.play(); p?.catch?.(() => {}); if (!v.classList.contains('on')) v.pause() } catch {} })
    if (!BUF.shot_a) loadSfx()
  }

  // ─────────── 主循环 ───────────
  async function resolveRoom() {
    if (CODE) return (await api('/api/d13/code/' + CODE)).id
    const lb = await api('/api/d13/lobby'); S.cfg = lb.cfg
    $('#top-online b').textContent = fmt(lb.online)
    return lb.live || lb.next
  }
  async function loop() {
    let failures = 0
    for (;;) {
      try {
        const st = S.watch
        // 本局结束 8 秒后 → 自动切到下一局；公共厅 / 私人房同一逻辑
        if (st && st.room.status === 'ended' && srvNow() - (st.room.end_at || 0) > 8000) {
          const nid = st.room.next_id || (await resolveRoom()); if (nid && nid !== S.watchId) { await load(nid); continue }
        }
        await load(S.watchId || (await resolveRoom()))
        failures = 0
      } catch (e) { if (++failures > 3) caption(esc(e.message), 'warn') }
      const st = S.watch, playing = st?.room.status === 'playing'
      await sleep(playing ? 1500 : 2000)
    }
  }
  setInterval(() => {
    timelineTick()
    const cd = $('#ph-cd'); if (cd && S.watch?.room.status === 'waiting') { const l = S.watch.room.lock_at - srvNow(); cd.textContent = mmss(l); if (l < 4000 && l > 0 && Math.floor(l / 1000) !== S._lt) { S._lt = Math.floor(l / 1000); SFX.tick() } }
    const bc = $('#bet-cd'); if (bc) { const t = target(); if (t) { const l = t.lock_at - srvNow(); bc.textContent = mmss(l); bc.classList.toggle('hot', l < 10000); if (l <= 1200) renderPanel() } }
  }, 150)

  ;(async () => {
    drawRing(); showStill('/gimg/l13_deadly13/cover.webp')
    try { S.cfg = (await api('/api/d13/lobby')).cfg } catch {}
    await refreshMe()
    api('/api/d13/media').then((m) => { MEDIA = m; if (!m) $('#d13-stage').classList.add('no-media') }).catch(() => {})
    loadSfx()
    loop()
    window.D13RT = { S }
  })()
})()
