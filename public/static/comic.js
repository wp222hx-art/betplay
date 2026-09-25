// Agent-5 · 对弈式漫剧播放器：GPT Image 2 分镜 + 多角色配音 + Ken Burns 运镜 + 押注揭晓 + 悔棋变局（二选一 / 新变数）
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const L = $('#comic-layer'), side = $('#comic-side'), modal = $('#modal-root')
  const PA = $('#panel-a'), PB = $('#panel-b')
  const uid = localStorage.df_uid || (localStorage.df_uid = 'u_' + Math.random().toString(36).slice(2, 10))
  const nick = localStorage.df_nick || (localStorage.df_nick = '玩家' + uid.slice(-4).toUpperCase())
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, method: opt.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-user-id': uid }, body: opt.body ? JSON.stringify({ user_id: uid, ...opt.body }) : undefined })
    const j = await r.json(); if (!r.ok) throw new Error(j.message || j.error); return j
  }
  const toast = (m) => { const d = document.createElement('div'); d.className = 'tst'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2600) }
  const S = { meta: null, tree: null, run: null, round: null, balance: 0, sel: null, stake: 50, placed: false, path: [], log: [], voice: localStorage.df_voice !== '0', bgm: localStorage.df_bgm !== '0', auto: localStorage.df_auto !== '0', offset: 0, visited: new Set() }

  // ─── 音频 ───
  const audio = new Audio(); audio.preload = 'auto'
  let AC = null
  const tone = (f, d = 0.08, type = 'sine', v = 0.12, when = 0) => { try { AC ||= new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, AC.currentTime + when); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + d); o.connect(g).connect(AC.destination); o.start(AC.currentTime + when); o.stop(AC.currentTime + when + d + 0.02) } catch {} }
  const SFX = { tick: () => tone(1200, 0.03, 'square', 0.03), heart: () => { tone(60, 0.12, 'sine', 0.35); tone(55, 0.12, 'sine', 0.25, 0.16) }, lock: () => { tone(180, 0.05, 'square', 0.22); tone(90, 0.12, 'triangle', 0.25, 0.04) }, win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.09)), lose: () => [300, 240].forEach((f, i) => tone(f, 0.3, 'sine', 0.08, i * 0.15)), sel: () => tone(880, 0.05, 'sine', 0.07), rewind: () => { for (let i = 0; i < 12; i++) tone(900 - i * 55, 0.06, 'sawtooth', 0.025, i * 0.12) } }

  // ─── 混音引擎：ElevenLabs 环境音循环（场景间交叉淡化）+ 定点音效 + 对白闪避（ducking）+ 抉择张力层 ───
  const Amb = (() => {
    let ctx, master, ambBus, sfxBus, voiceBus, padG, pulseT, on = false, cur = null
    const bufs = new Map()
    const load = async (name) => {
      if (!ctx) return null
      if (bufs.has(name)) return bufs.get(name)
      const p = fetch(`/static/comic/sfx/${name}.mp3`).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a)).catch(() => null)
      bufs.set(name, p); return p
    }
    const start = () => {
      if (on) return; on = true
      ctx = AC ||= new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') ctx.resume()
      master = ctx.createGain(); master.gain.value = S.bgm ? 1 : 0; master.connect(ctx.destination)
      ambBus = ctx.createGain(); ambBus.gain.value = 0.55; ambBus.connect(master)
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master)
      // 对白走 WebAudio：用于闪避环境音
      const ms = ctx.createMediaElementSource(audio); voiceBus = ctx.createGain(); voiceBus.gain.value = 1
      ms.connect(voiceBus).connect(ctx.destination)
      audio.addEventListener('play', () => duck(true)); audio.addEventListener('pause', () => duck(false)); audio.addEventListener('ended', () => duck(false))
      // 低频张力垫（只在抉择时抬起）
      padG = ctx.createGain(); padG.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; padG.connect(lp).connect(master)
      ;[55, 82.41, 110, 130.81].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1.5) * 7; const g = ctx.createGain(); g.gain.value = 0.22; o.connect(g).connect(padG); o.start() })
      ;['rain_roof', 'rain_street', 'lock', 'reveal', 'rewind', 'heartbeat'].forEach(load)
    }
    const duck = (d) => { if (!on) return; ambBus.gain.cancelScheduledValues(ctx.currentTime); ambBus.gain.linearRampToValueAtTime(d ? 0.22 : 0.55, ctx.currentTime + (d ? 0.15 : 0.9)) }
    // 20s 素材 → 两路错位交叉淡化循环，听不出接缝
    const ambience = async (name) => {
      if (!on || !name || cur?.name === name) return
      const buf = await load(name); if (!buf) return
      const old = cur
      const g = ctx.createGain(); g.gain.value = 0; g.connect(ambBus)
      const period = buf.duration - 3, voices = []
      const spawn = (t) => { const src = ctx.createBufferSource(); src.buffer = buf; const vg = ctx.createGain(); src.connect(vg).connect(g); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(1, t + 3); vg.gain.setValueAtTime(1, t + period); vg.gain.linearRampToValueAtTime(0, t + period + 3); src.start(t); src.stop(t + buf.duration); voices.push(src) }
      let t = ctx.currentTime; spawn(t)
      const timer = setInterval(() => { t += period; spawn(t); if (voices.length > 3) voices.shift() }, period * 1000)
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5)
      cur = { name, g, timer, voices }
      if (old) { old.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5); setTimeout(() => { clearInterval(old.timer); old.voices.forEach((v) => { try { v.stop() } catch {} }); old.g.disconnect() }, 2800) }
    }
    const sfx = async (name, vol = 1) => { if (!on || !name || name === 'none') return; const buf = await load(name); if (!buf) return; const s = ctx.createBufferSource(); s.buffer = buf; const g = ctx.createGain(); g.gain.value = vol; s.connect(g).connect(sfxBus); s.start() }
    const setTension = (t) => {
      if (!on) return
      padG.gain.linearRampToValueAtTime(t ? 0.05 : 0, ctx.currentTime + (t ? 1.5 : 0.6))
      clearInterval(pulseT); if (t) { sfx('heartbeat', 0.5); pulseT = setInterval(() => sfx('heartbeat', 0.45), 3000) }
    }
    const mood = () => {}
    const toggle = (v) => { if (!on) return v && start(); master.gain.linearRampToValueAtTime(v ? 1 : 0, ctx.currentTime + 0.6); if (!v) clearInterval(pulseT) }
    return { start, ambience, sfx, setTension, mood, toggle, load }
  })()

  // ─── 分镜切换（双缓冲 + Ken Burns） ───
  let front = PA, kbi = 0
  const cache = new Map()
  const preload = (src) => { if (!src || cache.has(src)) return; const i = new Image(); i.src = src; cache.set(src, i) }
  const preA = (src) => { if (src && !cache.has(src)) { const a = new Audio(); a.preload = 'auto'; a.src = src; cache.set(src, a) } }
  function showPanel(src, fx = '', video = null) {
    const back = front === PA ? PB : PA
    back.className = 'panel'
    back.innerHTML = ''
    back.style.backgroundImage = src ? `url(${src})` : 'linear-gradient(160deg,#1b1030,#05060c)'
    if (video) {
      // 动态漫：Seedance 图生视频（静帧兜底：视频加载失败时仍显示分镜）
      const v = document.createElement('video')
      Object.assign(v, { src: video, muted: true, playsInline: true, loop: true, autoplay: true, poster: src || '' })
      v.className = 'panel-video'; back.appendChild(v); v.play().catch(() => {})
    }
    void back.offsetWidth
    back.classList.add('show'); if (!video) back.classList.add('kb' + ((kbi++ % 4) + 1)); if (fx) back.classList.add(fx)
    front.classList.remove('show')
    const old = front; setTimeout(() => { if (!old.classList.contains('show')) old.innerHTML = '' }, 1200)
    front = back
    Amb.mood(fx)
  }
  const panelFx = (c) => { front.classList.add(c); setTimeout(() => front.classList.remove(c), 600) }

  // ─── 台词：逐字 + 配音同步（纯对白，角色色标 + 情绪标签） ───
  const CAST = { 林夏: '#60a5fa', 陈默: '#f5c451', 渡鸦: '#ff5d73', 林小雨: '#fbbf24', 顾衡: '#e5e7eb' }
  const EMO_ZH = { sad: '哽咽', angry: '怒', fearful: '惊惧', surprised: '震惊', happy: '笑', disgusted: '冷蔑' }
  async function speak(line, extra = '') {
    const narr = false
    const chars = [...line.text].map((c) => `<span>${esc(c)}</span>`).join('')
    const box = document.createElement('div')
    box.className = 'cap' + (narr ? ' narr' : '')
    box.dataset.sp = line.speaker
    box.innerHTML = `<div class="sp"><span class="av" style="--c:${CAST[line.speaker] || '#f5c451'}">${esc(line.speaker[0])}</span>${esc(line.speaker)}${line.emotion && line.emotion !== 'neutral' ? `<em class="emo">${EMO_ZH[line.emotion] || ''}</em>` : ''} ${S.voice && line.audio ? '<span class="wave"><i></i><i></i><i></i></span>' : ''}</div><div class="tx">${chars}</div>`
    const host = $('#cap-host'); host.innerHTML = ''; host.appendChild(box)
    const spans = box.querySelectorAll('.tx span')
    const durMs = Math.max(900, (line.dur || line.text.length * 0.22) * 1000)
    let skip = false
    box.onclick = () => { skip = true }
    if (S.voice && line.audio) { audio.src = line.audio; audio.play().catch(() => {}) }
    const t0 = performance.now()
    await new Promise((res) => {
      const step = () => {
        const k = skip ? spans.length : Math.floor(((performance.now() - t0) / (durMs * 0.85)) * spans.length)
        spans.forEach((s, i) => i < k && s.classList.add('v'))
        if (skip) { audio.pause(); return res() }
        if (performance.now() - t0 >= durMs + 180) return res()
        requestAnimationFrame(step)
      }
      step()
    })
    if (!S.auto && !skip) await new Promise((r) => { box.onclick = r; box.insertAdjacentHTML('beforeend', '<div class="c-tap" style="color:#888;margin:4px 0 0;text-align:right">点击继续 ▸</div>') })
  }

  const hud = () => {
    const depth = S.round?.depth || 0
    return `<div class="c-top"><div class="c-pill gold"><i class="fas fa-coins"></i> <span id="bal">${S.balance}</span></div>
      ${S.round ? `<div class="c-pill lock" id="lockp">🔒 已锁定 <b>#${S.round.commit.slice(0, 8)}</b></div>` : ''}
      <div class="c-pill" style="cursor:pointer" id="vbtn">${S.voice ? '<i class="fas fa-volume-high"></i>' : '<i class="fas fa-volume-xmark"></i>'}</div></div>
      <div class="c-depth">${[1, 2, 3, 4].map((d) => `<i class="${d <= depth ? 'on' : ''}"></i>`).join('')}</div>`
  }
  function frame(inner) {
    L.innerHTML = hud() + inner
    $('#vbtn').onclick = () => { S.voice = !S.voice; localStorage.df_voice = S.voice ? '1' : '0'; if (!S.voice) audio.pause(); $('#vbtn').innerHTML = S.voice ? '<i class="fas fa-volume-high"></i>' : '<i class="fas fa-volume-xmark"></i>' }
    $('#lockp') && ($('#lockp').onclick = () => openModal(`<h2>🔒 结果已锁定</h2><div class="sub">本抉择的结果在你下注前已由服务端种子抽出并公开承诺。客户端只持有 ${S.round.encrypted.length} 份等长密文分镜（每个选项一份），揭晓时才下发真分镜的密钥。</div><pre class="code" style="margin-top:10px">${S.round.commit}</pre><div style="text-align:right"><button class="btn gold" data-close>关闭</button></div>`))
  }
  const setBal = (v) => { S.balance = v; const e = $('#bal'); if (e) e.textContent = v; renderSide() }

  // ─── 播放一个分镜段落 ───
  async function playSegment(seg, opts = {}) {
    showPanel(seg.image_url || seg.image, opts.fx, seg.video_url || seg.video)
    frame(`${opts.header || ''}<div class="spacer"></div>${seg.title ? `<div class="seg-title">${esc(seg.title)}</div>` : ''}<div id="cap-host"></div>`)
    Amb.ambience(seg.ambience)
    const lines = seg.lines || []
    for (const [i, l] of lines.entries()) {
      if (seg.sfx && seg.sfx !== 'none' && i === Math.min(seg.sfx_at || 0, lines.length - 1)) {
        Amb.sfx(seg.sfx)
        if (/gunshot|explosion|thunder|glass_break/.test(seg.sfx)) panelFx('shake')
      }
      await speak(l)
    }
  }

  // ─── 封面 ───
  async function cover() {
    S.round = null; S.path = []; S.log = []
    const pro = S.tree.segments[S.tree.prologue[0]]
    showPanel(pro.image_url)
    const m = S.meta
    const regular = S.tree.nodes.reduce((a, n) => a + n.options.filter((o) => !o.twist).length, 0)
    const twist = S.tree.nodes.reduce((a, n) => a + n.options.filter((o) => o.twist).length, 0)
    frame(`<div class="spacer"></div><div class="cover">
      <div class="sub" style="letter-spacing:4px;color:var(--gold)">对弈式漫剧 · GPT Image 2 分镜 · 全程配音</div>
      <h1>${esc(m.series.title)}</h1>
      <div class="lg">一夜之间，新港的命运系于一枚“星核”。每个抉择都在你下注之前锁定——你押的是人心。悔棋？可以。但故事会<b style="color:#d9c6ff">变成二选一</b>，或<b style="color:#d9c6ff">多出一个你没见过的选项</b>。</div>
      <div class="stats3"><div><b>${m.nodes}</b><span>抉择点</span></div><div><b>${regular}</b><span>常规分支</span></div><div><b>${twist}</b><span>悔棋隐藏支</span></div><div><b>${m.my_endings.length}/${m.total_endings}</b><span>我的结局</span></div></div>
      <button class="start2" id="st"><i class="fas fa-book-open"></i> 开始这一夜</button>
      <div class="toggle"><label><input type="checkbox" id="tv" ${S.voice ? 'checked' : ''}> 配音</label><label><input type="checkbox" id="ta" ${S.auto ? 'checked' : ''}> 自动翻页</label><label><input type="checkbox" id="tb" ${S.bgm ? 'checked' : ''}> 环境音效</label></div></div>`)
    $('#tv').onchange = (e) => { S.voice = e.target.checked; localStorage.df_voice = S.voice ? '1' : '0' }
    $('#ta').onchange = (e) => { S.auto = e.target.checked; localStorage.df_auto = S.auto ? '1' : '0' }
    $('#tb').onchange = (e) => { S.bgm = e.target.checked; localStorage.df_bgm = S.bgm ? '1' : '0'; Amb.toggle(S.bgm) }
    $('#st').onclick = start
  }

  async function start() {
    SFX.sel(); Amb.start()
    try {
      const r = await api('/api/comic/start', { body: { nick } })
      S.run = r.run_id; S.balance = r.balance; S.round = null
      // 预载序章 + 第一抉择全部分镜
      r.prologue.forEach((p) => { preload(p.image_url); p.lines.forEach((l) => preA(l.audio)) })
      r.round.preload.forEach((p) => { preload(p.image); preA(p.audio) })
      renderSide()
      for (const [i, p] of r.prologue.entries()) await playSegment(p, { header: `<div class="c-chapter">序章 · ${i + 1}/${r.prologue.length}</div>` })
      decision(r.round)
    } catch (e) { toast(e.message) }
  }

  // ─── 抉择：押注面板 ───
  function decision(rd, changed) {
    S.round = rd; S.sel = null; S.placed = false; S.offset = rd.server_time - Date.now()
    S.visited.add(rd.node_id)
    rd.preload.forEach((p) => { preload(p.image); preA(p.audio); if (p.ambience) Amb.load(p.ambience); if (p.sfx) Amb.load(p.sfx); if (p.video && !cache.has(p.video)) { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'video'; l.href = p.video; document.head.appendChild(l); cache.set(p.video, l) } })
    if (S.stake < rd.min_bet) S.stake = rd.min_bet
    SFX.heart(); panelFx('desat'); Amb.setTension(1)
    const modeTxt = { normal: '', binary: '<span style="color:#ff9aa8">⚔ 二选一变局</span>', plus: '<span style="color:#c4a8ff">✦ 新变数出现</span>', binary_plus: '<span style="color:#c4a8ff">⚔✦ 二选一 + 新变数</span>' }[rd.mode]
    const maxS = Math.max(rd.min_bet, Math.min(S.balance, 1000))
    frame(`<div class="c-chapter">第 ${rd.depth} 幕 · 抉择${rd.rewind_no ? ` · 悔棋 ${rd.rewind_no}` : ''}</div><div class="spacer"></div>
      <div class="q-card" id="qc">
        ${modeTxt ? `<div class="mode">${modeTxt}</div>` : ''}
        ${rd.excluded?.length ? `<div class="excl">已排除：${rd.excluded.map((x) => `<s>${esc(x.label)}</s>`).join(' ')}</div>` : ''}
        <div class="q">${esc(rd.question)}</div>
        ${rd.options.map((o) => `<div class="opt2 ${o.twist ? 'twist' : ''}" data-o="${o.id}">
          <div class="pbar" style="width:${o.p * 100}%"></div>
          <div class="lb"><b>${esc(o.label)}${o.twist ? '<span class="new-badge">新变数</span>' : ''}</b><span>${esc(o.hint)}</span></div>
          <div class="pp">${Math.round(o.p * 100)}%<br>${Math.abs(o.p - o.base) > 0.005 ? `<s>${Math.round(o.base * 100)}%</s>` : ''}</div>
          <div class="od">×${o.odds}</div></div>`).join('')}
        <div class="stake2" id="stk">${[...new Set([rd.min_bet, 50, 100, 200])].map((v) => `<button data-s="${v}">${v}</button>`).join('')}<button data-s="MAX">MAX</button></div>
        <div class="row2"><div class="ring2" id="ring"><svg width="54" height="54"><circle cx="27" cy="27" r="23" stroke="#232a47" stroke-width="4" fill="none"/><circle id="rc" cx="27" cy="27" r="23" stroke="#f5c451" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="144.5"/></svg><div class="n" id="rn"></div></div>
          <button class="go" id="go" disabled>选择一个走向</button></div>
        <div class="meta2"><span id="est">—</span><span>机制扰动 ±${Math.round(rd.jitter * 100)}% · 最低 ${rd.min_bet}</span></div>
        <div style="text-align:center;margin-top:3px"><button class="link2" id="watch">不押，直接看结果 →</button></div>
      </div>`)
    if (changed) toast(`悔棋生效：${changed.label} —— ${changed.desc}`)
    const qc = $('#qc')
    const refresh = () => {
      qc.querySelectorAll('.opt2').forEach((e) => e.classList.toggle('sel', e.dataset.o === S.sel))
      qc.querySelectorAll('#stk button').forEach((b) => b.classList.toggle('on', +b.dataset.s === S.stake || (b.dataset.s === 'MAX' && S.stake === maxS)))
      const go = $('#go'), o = rd.options.find((x) => x.id === S.sel)
      if (S.placed) { go.className = 'go placed'; go.disabled = false; go.innerHTML = '<i class="fas fa-lock"></i> 已押注 · 立即揭晓' }
      else { go.className = 'go'; go.disabled = !S.sel; go.textContent = S.sel ? `押「${o.label}」${S.stake}` : '选择一个走向' }
      $('#est').textContent = o ? `命中可得 ${Math.floor(S.stake * o.odds)}` : '—'
    }
    qc.onclick = (e) => {
      const o = e.target.closest('.opt2'), s = e.target.closest('#stk button')
      if (o && !S.placed) { S.sel = o.dataset.o; SFX.sel(); navigator.vibrate?.(12); refresh() }
      if (s && !S.placed) { S.stake = s.dataset.s === 'MAX' ? maxS : Math.min(maxS, +s.dataset.s); refresh() }
    }
    $('#watch').onclick = () => reveal()
    $('#go').onclick = async () => {
      if (S.placed) return reveal()
      const b = $('#go'); b.disabled = true; b.textContent = '提交中…'
      try { const r = await api(`/api/comic/rounds/${rd.round_id}/bet`, { body: { option_id: S.sel, amount: S.stake } }); S.placed = true; setBal(r.balance); SFX.lock() } catch (e) { toast(e.message) }
      refresh()
    }
    refresh()
    let last = -1
    const tm = setInterval(() => {
      if (!document.body.contains(qc)) return clearInterval(tm)
      const remain = Math.max(0, rd.lock_at - (Date.now() + S.offset)), sec = Math.ceil(remain / 1000)
      $('#rn').textContent = sec
      $('#rc').setAttribute('stroke-dashoffset', String(144.5 * (1 - remain / (rd.window_sec * 1000))))
      if (sec <= 3) { $('#ring').classList.add('hot'); $('#rc').setAttribute('stroke', '#ff5d73') }
      if (sec !== last) { last = sec; sec <= 3 && sec > 0 ? SFX.heart() : SFX.tick() }
      if (remain <= 0) { clearInterval(tm); reveal() }
    }, 250)
  }

  // ─── 揭晓：本地解密真分镜 ───
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  async function decrypt(slot, k) { const key = await crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['decrypt']); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(slot.iv) }, key, unb64(slot.ct))).trim()) }
  let busy = false
  async function reveal() {
    if (busy) return; busy = true
    try {
      SFX.lock(); Amb.sfx('lock'); Amb.setTension(0); setTimeout(() => Amb.sfx('reveal', 0.8), 450)
      L.insertAdjacentHTML('beforeend', '<div class="flash"></div><div class="stamp">LOCKED</div>')
      const st = await api(`/api/comic/rounds/${S.round.round_id}/settle`, { body: {} })
      const seg = await decrypt(S.round.encrypted[st.reveal.slot], st.reveal.key)
      await sleep(500)
      const hdr = `<div class="c-chapter">第 ${S.round.depth} 幕 · 揭晓</div><div class="spacer" style="flex:.4"></div><div class="reveal-t"><div class="k">${seg.twist ? '✦ 隐藏分支' : '命运落定'}</div><div class="t ${seg.twist ? 'tw' : ''}">${esc(seg.label)}</div></div>`
      await playSegment(seg, { header: hdr, fx: /枪|爆|violence|战/.test(seg.title + seg.mood) ? 'shake' : '' })
      S.log.unshift({ label: seg.label, bet: st.bet, twist: seg.twist })
      settled(st, seg)
    } catch (e) { toast(e.message) } finally { busy = false }
  }

  function settled(st, seg) {
    const b = st.bet
    if (b) (b.won ? SFX.win : SFX.lose)()
    setBal(st.balance)
    const modes = st.rewind.modes
    frame(`<div class="c-chapter">第 ${S.round.depth} 幕 · 结算</div><div class="spacer"></div>
      <div class="settle2">
        <div class="sub" style="text-align:center;font-size:11px;letter-spacing:3px">本幕结果 · <b style="color:${seg.twist ? '#d9c6ff' : 'var(--gold)'}">${esc(seg.label)}</b></div>
        <div class="res ${b ? (b.won ? 'win' : 'lose') : ''}">${b ? (b.won ? '+' + b.payout : '−' + b.amount) : '观战'}</div>
        <div class="sub" style="text-align:center;font-size:12px">${b ? `押「${esc(S.round.options.find((o) => o.id === b.option_id)?.label)}」×${b.odds}` : '本幕未下注'}</div>
        ${modes.length ? `<div class="sub" style="margin-top:8px;font-size:11px;text-align:center"><i class="fas fa-clock-rotate-left" style="color:#c4a8ff"></i> 悔棋（税 ${st.rewind.fee}，剩 ${st.rewind.max - st.rewind.used} 次）——回到这一刻，但局面会改变：</div>
          <div class="rw-pick">${modes.map((m) => `<button class="pb violet" data-rw="${m.mode}"><b>${m.mode === 'binary' ? '⚔ ' : '✦ '}${m.label}</b><small>${esc(m.desc)}</small></button>`).join('')}</div>` : ''}
        <div class="btns"><button class="pb" id="vf"><i class="fas fa-shield-halved"></i> 验证</button><button class="pb gold" id="nx">${seg.next ? '翻到下一幕' : '走向结局'} <i class="fas fa-forward"></i></button></div>
      </div>`)
    $('#vf').onclick = () => verify(st.round_id)
    $('#nx').onclick = () => next(st.round_id)
    L.querySelectorAll('[data-rw]').forEach((x) => (x.onclick = () => doRewind(st.round_id, x.dataset.rw)))
    // 预载下一幕
  }

  async function doRewind(rid, mode) {
    SFX.rewind(); Amb.sfx('rewind'); audio.pause()
    L.insertAdjacentHTML('beforeend', '<div class="rewind-fx"></div><div class="rewind-clock"><i class="fas fa-clock-rotate-left"></i></div>')
    panelFx('desat')
    try {
      const [nr] = await Promise.all([api(`/api/comic/rounds/${rid}/rewind`, { body: { mode } }), sleep(1600)])
      S.log[0] && (S.log[0].rewound = true)
      setBal(nr.balance)
      decision(nr, nr.changed)
    } catch (e) { toast(e.message); frame('<div class="spacer"></div>') }
  }

  async function next(rid) {
    try {
      const r = await api(`/api/comic/rounds/${rid}/next`, { body: {} })
      S.path = r.path
      if (r.ended) return ending(r)
      r.round.preload.forEach((p) => { preload(p.image); preA(p.audio) })
      decision(r.round)
    } catch (e) { toast(e.message) }
  }

  function ending(r) {
    S.round = null
    SFX.win()
    S.meta.my_endings = [...new Set([...S.meta.my_endings, r.ending.id])]
    frame(`<div class="spacer"></div><div class="ending2">
      <div class="sub" style="letter-spacing:6px;color:${r.ending.twist ? '#c4a8ff' : 'var(--gold)'}">${r.ending.twist ? '隐 藏 结 局' : '结 局'}</div>
      <div class="t ${r.ending.twist ? 'tw' : ''}">${esc(r.ending.title)}</div>
      <div class="route">${r.path.map((p) => `<span class="${p.twist ? 'tw' : ''}">${esc(p.label)}</span>`).join('')}</div>
      <div class="sub">本夜盈亏 <b style="color:${r.pnl >= 0 ? 'var(--gold)' : '#ff9aa8'}">${r.pnl >= 0 ? '+' : ''}${r.pnl}</b> · 悔棋 ${r.rewinds} 次 · 已收集结局 ${S.meta.my_endings.length}/${r.total_endings}</div>
      <div class="btns" style="margin-top:12px"><button class="pb" id="sh"><i class="fas fa-share-nodes"></i> 战报</button><button class="pb gold" id="ag"><i class="fas fa-rotate"></i> 再走一夜</button></div></div>`)
    $('#ag').onclick = cover
    $('#sh').onclick = () => { const t = `我在《穹顶之下》走到了「${r.ending.title}」：${r.path.map((p) => p.label).join('→')}，你能走出不同的结局吗？`; navigator.clipboard?.writeText(t + ' ' + location.href); toast('战报文案已复制') }
    renderSide()
  }

  async function verify(rid) {
    const v = await api(`/api/comic/rounds/${rid}/verify`)
    openModal(`<h2><i class="fas fa-shield-halved" style="color:var(--gold)"></i> 这一幕的公平验证</h2>
      <div class="step"><div class="n">1</div><div><b>下注前锁定</b><code>commit = ${v.commit}</code></div></div>
      <div class="step"><div class="n">2</div><div><b>公开种子 + 机制扰动 ±${Math.round(v.jitter * 100)}%（${v.mode}）</b><code>seed = ${v.seed}</code>
        ${v.weights.map((w) => `<code>${esc(w.label)}：基础 ${(w.base * 100).toFixed(1)}% → 扰动后 ${(w.final * 100).toFixed(1)}%</code>`).join('')}<code>r = ${v.random_value.toFixed(6)}</code></div></div>
      <div class="step"><div class="n">3</div><div><b>复算</b><div>承诺一致：<span class="${v.commit_match ? 'ok' : 'bad'}">${v.commit_match ? '✓' : '✗'}</span> · 结果一致：<span class="${v.outcome_match ? 'ok' : 'bad'}">${v.outcome_match ? '✓' : '✗'}</span></div><code>${esc(v.formula)}</code></div></div>
      <div style="text-align:right"><button class="btn gold" data-close>明白了</button></div>`)
  }
  function openModal(h) { modal.innerHTML = `<div class="modal-bg"><div class="modal">${h}</div></div>`; modal.onclick = (e) => { if (e.target.classList.contains('modal-bg') || e.target.closest('[data-close]')) modal.innerHTML = '' } }

  // ─── 侧栏：剧情树 + 结局图鉴 ───
  function renderSide() {
    if (!S.tree) return
    const cur = S.round?.node_id
    const walked = new Set(S.path.map((p) => p.option))
    const nodeHtml = (id, d = 0) => {
      const n = S.tree.nodes.find((x) => x.id === id); if (!n || d > 4) return ''
      const onPath = S.path.some((p) => p.node === id) || cur === id
      if (!onPath && d > 0) return ''
      return `<div class="nd ${cur === id ? 'cur' : ''}">${esc(n.question)}${n.options.filter((o) => !o.twist || walked.has(o.id) || (cur === id && S.round?.options.some((x) => x.id === o.id))).map((o) => `<div class="ol ${walked.has(o.id) ? 'hit' : ''} ${o.twist ? 'tw' : ''}">${walked.has(o.id) ? '●' : '○'} ${esc(o.label)}${o.twist ? ' ✦' : ''}${o.next && walked.has(o.id) ? nodeHtml(o.next, d + 1) : ''}</div>`).join('')}</div>`
    }
    const ends = S.tree.nodes.flatMap((n) => n.options.filter((o) => !o.next).map((o) => ({ id: o.id, twist: o.twist, title: o.ending_title || o.label })))
    const got = new Set(S.meta.my_endings)
    side.innerHTML = `
      <div class="sc"><h3><i class="fas fa-wallet"></i> Chips <b style="color:var(--gold);margin-left:auto;font-size:18px">${S.balance}</b></h3>
        <div class="sub" style="font-size:11px">${esc(nick)} · 娱乐币，不可提现 · <a href="#" id="fc" style="color:var(--gold)">领免费币</a></div></div>
      <div class="sc"><h3><i class="fas fa-diagram-project"></i> 我的剧情树 <span class="sub" style="margin-left:auto;font-size:11px">${S.tree.nodes.length} 个抉择点</span></h3><div class="tree">${nodeHtml(S.tree.nodes[0].id)}</div></div>
      <div class="sc"><h3><i class="fas fa-book"></i> 结局图鉴 <span class="sub" style="margin-left:auto">${ends.filter((e) => got.has(e.id)).length}/${ends.length}</span></h3>
        <div class="eg">${ends.map((e) => `<i class="${e.twist ? 'tw' : ''} ${got.has(e.id) ? 'got' : ''}" title="${got.has(e.id) ? esc(e.title) : e.twist ? '隐藏结局（悔棋解锁）' : '未解锁'}"></i>`).join('')}</div>
        <div class="sub" style="font-size:10.5px;margin-top:6px">紫框 = 只有悔棋“新变数”才能到达的隐藏结局</div></div>
      <div class="sc"><h3><i class="fas fa-scroll"></i> 本夜对局</h3><div class="logx">${S.log.map((l) => `<div><span style="${l.twist ? 'color:#c4a8ff' : ''}">${l.rewound ? '<s>' : ''}${esc(l.label)}${l.rewound ? '</s> ⟲' : ''}</span><span style="color:${l.bet ? (l.bet.won ? 'var(--gold)' : '#8f98bb') : '#555'}">${l.bet ? (l.bet.won ? '+' + l.bet.payout : '−' + l.bet.amount) : '观战'}</span></div>`).join('') || '<div class="sub">尚未开始</div>'}</div></div>`
    $('#fc').onclick = async (e) => { e.preventDefault(); try { const u = await api('/api/me/faucet', { body: {} }); setBal(u.chips); toast('+500 Chips') } catch (er) { toast(er.message) } }
  }

  Promise.all([api('/api/comic/meta'), api('/api/comic/tree'), api('/api/me?nick=' + encodeURIComponent(nick))]).then(([m, t, me]) => {
    S.meta = m; S.tree = t; S.balance = me.chips; renderSide(); cover()
  }).catch((e) => (L.innerHTML = `<div style="margin:auto" class="sub">加载失败：${esc(e.message)}</div>`))
})()
