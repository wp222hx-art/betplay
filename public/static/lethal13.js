// 致命13 · 模拟演出版：程序化舞台（13 人围圈）+ WebAudio 合成音效（心跳 / 上弹 / 枪声 / 哨声）
// 每轮节奏：押注（8 秒）→ 灯灭 → 统一上弹（咔·咔·咔）→ 心跳加速 → 灯亮 → 齐射 → 倒下 → 揭晓
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

  // ─────────── 合成音效 ───────────
  let AC = null, heartTimer = null, heartBpm = 70
  const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  function noise(dur, gain = 1, hp = 0, lp = 0) {
    const c = ac(), len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    const src = c.createBufferSource(); src.buffer = buf
    let node = src
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f }
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f }
    const g = c.createGain(); g.gain.value = gain; node.connect(g); g.connect(c.destination); src.start()
  }
  function tone(f0, f1, dur, gain = 0.6, type = 'sine') {
    const c = ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(c.destination); o.start(); o.stop(t + dur)
  }
  const SFX = {
    beat() { tone(60, 38, 0.13, 0.9); setTimeout(() => tone(52, 34, 0.11, 0.6), 160) },
    click() { noise(0.035, 0.7, 2500); tone(1800, 900, 0.03, 0.15, 'square') },
    cylinder() { for (let i = 0; i < 6; i++) setTimeout(() => noise(0.02, 0.35, 3000), i * 45) },
    cock() { noise(0.05, 0.8, 1200); setTimeout(() => noise(0.04, 0.6, 2000), 70) },
    shot() { noise(0.6, 1.4, 0, 3500); tone(140, 40, 0.35, 0.9, 'triangle') },
    dry() { noise(0.03, 0.5, 4000) },
    lights() { tone(90, 90, 0.4, 0.25, 'sawtooth'); noise(0.08, 0.4, 5000) },
    whistle() { tone(2900, 2700, 0.9, 0.35, 'sine'); setTimeout(() => tone(2900, 2600, 0.5, 0.3), 950) },
    body() { tone(80, 30, 0.25, 0.8); noise(0.15, 0.4, 0, 400) },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f, 0.25, 0.25, 'triangle'), i * 110)) },
    lose() { tone(220, 70, 0.9, 0.4, 'sawtooth') }
  }
  function heart(bpm) {
    heartBpm = bpm; if (heartTimer) return
    const loop = () => { if (!heartBpm) { heartTimer = null; return } SFX.beat(); document.body.classList.add('pulse'); setTimeout(() => document.body.classList.remove('pulse'), 160); heartTimer = setTimeout(loop, 60000 / heartBpm) }
    loop()
  }
  const heartStop = () => { heartBpm = 0 }

  // ─────────── 真人片（有媒体清单则用视频，否则用模拟舞台） ───────────
  const video = document.getElementById('l13-video')
  let MEDIA = null
  if (video) { video.controls = false; video.disablePictureInPicture = true; video.addEventListener('pause', () => { if (video.dataset.playing === '1' && !video.ended) video.play().catch(() => {}) }) }
  /** 播放一个片段；返回 Promise（播完 / 超时）。maxMs：截断长片段以保节奏 */
  function clip(key, maxMs) {
    const c = MEDIA?.clips?.[key]; if (!c || !c.url) return null
    return new Promise(async (res) => {
      document.body.classList.add('l13-film'); video.src = c.url; video.dataset.playing = '1'; video.muted = false
      let done = false; const fin = () => { if (done) return; done = true; video.dataset.playing = '0'; res() }
      video.onended = fin; setTimeout(fin, Math.min(maxMs || 1e9, (c.dur + 3) * 1000))
      try { await video.play() } catch { video.muted = true; await video.play().catch(fin) }
    })
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  // ─────────── 舞台 ───────────
  const ring = $('#l13-ring'), center = $('#l13-center'), dark = $('#l13-dark'), cap = $('#l13-caption'), hud = $('#l13-hud'), side = $('#l13-side'), flash = $('#thrill-flash'), modal = $('#thrill-modal')
  let M, S = { run: null, champ: 0, stake: 10, mult: 1, hits: 0, out: false, dead: new Set(), log: [] }
  const name = (id) => M.prisoners.find((p) => p.id === id)?.name || '#' + id

  function drawRing(alive) {
    const n = 13, R = 38
    const pos = (i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [50 + R * Math.cos(a), 50 + R * Math.sin(a)] }
    ring.innerHTML = M.prisoners.map((p, i) => {
      const [x, y] = pos(i), [nx, ny] = pos((i + 1) % n)   // 枪口指向下一个人（他身后的人用枪顶着他）
      const rot = (Math.atan2(ny - y, nx - x) * 180) / Math.PI
      return `<div class="p ${S.dead.has(p.id) ? 'dead' : ''}" id="p${p.id}" style="left:${x}%;top:${y}%">
        <div class="gun" style="transform:rotate(${rot}deg)"></div>
        <div class="head" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[i]}')"` : ''}><span>${p.id}</span></div><b>${esc(p.name)}</b></div>`
    }).join('')
    center.innerHTML = alive ? `<div class="alive-n">${alive}</div><div class="alive-t">存活</div>` : ''
  }
  function setCenter(html) { center.innerHTML = html }
  function caption(t, cls = '') { cap.className = 'l13-caption ' + cls; cap.innerHTML = t; void cap.offsetWidth; cap.classList.add('in') }
  function renderHud() {
    hud.innerHTML = `<div class="h-stat">${S.run ? `连中 <b>${S.hits}</b>/${M.cfg.chain} · 当前 <b class="gold">${xm(S.mult)}</b> = <b class="coin">${fmt(Math.floor(S.run.stake * S.mult))}</b>${S.out ? ' · <b class="down">已出局 · 观战到最后一人</b>' : ''}` : '致命13 · 模拟演出版'}</div><div class="h-pool"><i class="fas fa-sack-dollar"></i> <b>${fmt(M.pool)}</b></div>`
  }
  function boom(html, cls) { flash.className = 't-flash ' + cls; flash.innerHTML = `<div>${html}</div>`; void flash.offsetWidth; flash.classList.add('go') }
  function toast(m) { const t = document.createElement('div'); t.className = 't-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) }

  function lobby() {
    side.innerHTML = `
      <div class="s-title"><div class="tension">${'<i class="fas fa-fire"></i>'.repeat(5)}</div><h2>致命<b class="red">13</b></h2>
        <p>穷小子阿森替死去的雇主送一封信，一张单程车票把他带进森林深处的庄园。他胸前被别上了 <b>13</b> 号。13 个人围成一圈，枪口对准前一个人，富人们在身后下注。</p>
        <p class="note">第 1/2/3 轮各装 1/2/3 发，灯亮同时扣扳机。三轮之后，主持人抽 2 人进入<b>决斗</b>，其余人活着离场；决斗每枪加 1 发，直到一人倒下。</p>
        ${MEDIA ? '' : '<div class="demo-tip"><i class="fas fa-flask"></i> 模拟演出版：程序化舞台 + 合成音效，真人片拍摄确认后替换</div>'}</div>
      <div class="s-block"><h4>怎么押</h4><p class="note" style="margin:0"><b>① 连押：</b>每轮开枪前押「这一轮过后还剩几个人」，决斗押「哪个号码活下来」。猜中倍率相乘；<b>环形三轮全中 = 连环大奖</b>（奖池 ${Math.round(M.cfg.jackpot_share * 100)}%）；猜错出局但演到最后一人；开枪前可收手。<br><b>② 押冠军（可选）：</b>开局押最后活下来的号码，命中 <b class="gold">×${M.champ_odds}</b>。</p></div>
      <div class="s-block"><h4>押冠军（可选）</h4><div class="champ-grid">${M.prisoners.map((p) => `<button class="champ" data-n="${p.id}" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[p.id - 1]}')"` : ''}><b>${p.id}</b><span>${esc(p.name)}</span></button>`).join('')}</div><p class="note" id="champ-tip">不押冠军也可以开局</p></div>
      <div class="s-block"><h4>第 1 轮赔率预览（13 人 · 1 发）</h4>${M.first.map((t) => `<div class="tier-row"><span>${esc(t.label)}</span><em>${pct(t.p)}</em><b>${xm(t.odds)}</b></div>`).join('')}</div>
      <div class="s-block"><h4>本局注金</h4><div class="stakes">${M.cfg.stakes.map((v) => `<button class="stake ${v === S.stake ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
        <p class="note">一局一注 · 不可暂停 · 不可悔棋 · ${M.cfg.pick_sec} 秒不押 = 自动收手</p></div>
      <button id="l13-start" class="btn gold big"><i class="fas fa-skull"></i> 入场 · 灯要灭了</button>
      <div class="s-block stats"><span>已开 ${fmt(M.stats.plays)} 局</span><span>最高连中 ${M.stats.best}</span><span>最高倍率 ${xm(M.stats.top_mult || 1)}</span><span>奖池 ${fmt(M.pool)}</span></div>
      <div class="s-block recent"><h4>实时战报</h4>${M.recent.length ? M.recent.map((r) => `<div>${esc(r.who)} 连中 <b>${r.hits}</b> ${r.reason === 'miss' ? '<span class="down">押错出局</span>' : `收 <b class="gold">${xm(r.mult)}</b> +${fmt(r.win)}`}${r.jackpot ? ` <em>连环大奖 +${fmt(r.jackpot)}</em>` : ''}</div>`).join('') : '<div class="mut">还没有人入场</div>'}</div>`
    const champTip = () => { $('#champ-tip').innerHTML = S.champ ? `押 <b>${S.champ} 号 ${esc(name(S.champ))}</b> 活到最后 · 注金 ${S.stake} · 命中得 <b class="gold">${fmt(Math.floor(S.stake * M.champ_odds))}</b>（再点一次取消）` : '不押冠军也可以开局' }
    side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)); champTip() }))
    side.querySelectorAll('.champ').forEach((b) => (b.onclick = () => { S.champ = S.champ === +b.dataset.n ? 0 : +b.dataset.n; side.querySelectorAll('.champ').forEach((x) => x.classList.toggle('on', +x.dataset.n === S.champ)); champTip() }))
    $('#l13-start').onclick = start
  }
  function liveSide() {
    side.innerHTML = `<div class="s-title"><h2>致命<b class="red">13</b></h2><p class="mut">一口气演完 · 不可暂停 · 不可悔棋</p></div>
      <div class="s-block"><h4>本局</h4><div class="run-kv"><span>注金</span><b>${S.run.stake}</b><span>当前倍率</span><b class="gold">${xm(S.mult)}</b><span>连环进度</span><b>${'●'.repeat(Math.min(S.hits, M.cfg.chain))}${'○'.repeat(Math.max(0, M.cfg.chain - S.hits))}</b><span>承诺哈希</span><code>${S.run.commit.slice(0, 16)}…</code></div></div>
      <div class="s-block"><h4>轮次记录</h4><ol class="gate-log">${S.log.length ? S.log.map((l) => `<li class="${l.cls}"><span>第${l.k}轮</span><em>${esc(l.text)}</em><b>${esc(l.tag)}</b></li>`).join('') : '<li><span>—</span><em>灯还亮着</em><b></b></li>'}</ol></div>`
  }

  async function start() {
    ac().resume?.()
    const btn = $('#l13-start'); btn.disabled = true; btn.textContent = '锁定随机种子…'
    try {
      const r = await api('/api/l13/start', { body: { stake: S.stake, champ: S.champ || 0, champ_stake: S.champ ? S.stake : 0 } })
      Object.assign(S, { run: r, mult: 1, hits: 0, out: false, dead: new Set(), log: [] }); M.pool = r.pool
      liveSide(); renderHud(); drawRing(13)
      caption('主持人：<b>先生们，下注吧。最后站着的人，带走一切。</b>'); heart(72)
      const ic = clip('intro'); if (ic) { heartStop(); await ic; heart(80) } else await sleep(2600)
      await runRound(r.round)
    } catch (e) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-skull"></i> 入场 · 灯要灭了'; toast(e.message) }
  }

  // 一轮：押注面板（未出局时）→ 演出
  async function runRound(rc) {
    const duel = rc.type === 'duel'
    if (duel) await duelIntro(rc)
    else {
      caption(`第 <b>${rc.k}</b> 轮 · 每把枪装 <b class="red">${rc.bullets}</b> 发 · 每人中枪概率 <b>${pct(rc.bullets / 6)}</b>`)
      setCenter(`<div class="alive-n">${rc.alive.length}</div><div class="alive-t">存活</div><div class="cyl">${'<i class="on"></i>'.repeat(rc.bullets)}${'<i></i>'.repeat(6 - rc.bullets)}</div>`)
    }
    heart(80 + rc.k * 12)
    if (S.out) { await sleep(1500); return perform(null) }  // 不会走到：出局后走 replay
    const panel = document.createElement('div'); panel.className = 't-gate l13-bet in'; panel.id = 'l13-bet'
    panel.innerHTML = `<div class="g-head"><span>${duel ? `决斗 · ${rc.pair.map((x) => x + ' 号').join(' 对 ')}` : `第 ${rc.k} 轮 · ${rc.alive.length} 人 · ${rc.bullets} 发`}</span><span class="g-mult">${duel ? '每枪加一发，直到一人倒下' : `连环还差 ${rc.chain_left} 把`}</span></div>
      <div class="g-q">${duel ? '谁会活着走出这个房间？' : '这一枪之后，还剩几个人？'}</div>
      <div class="g-opts l13-tiers">${rc.tiers.map((t) => `<button class="g-opt" data-t="${t.id}"><span>${esc(t.label)}</span><small>概率 ${pct(t.p)}</small><b class="odds">${xm(t.odds)}</b></button>`).join('')}</div>
      ${S.hits ? `<button class="g-cash" id="l13-cash"><i class="fas fa-hand-holding-dollar"></i> 收手 ${xm(S.mult)} · 带走 ${fmt(Math.floor(S.run.stake * S.mult))}</button>` : ''}
      <div class="g-timer"><div id="g-bar"></div><b id="g-sec"></b></div>`
    $('#l13-stage').appendChild(panel)
    const arm = await api(`/api/l13/runs/${S.run.run_id}/arm`, { body: {} })
    const skew = Date.now() - arm.server_time, lockAt = arm.lock_at + skew - 800, total = lockAt - Date.now()
    let sent = false
    const submit = async (body) => {
      if (sent) return; sent = true; clearInterval(tm)
      panel.querySelectorAll('button').forEach((b) => (b.disabled = true)); panel.classList.add('locked')
      try {
        const r = await api(`/api/l13/runs/${S.run.run_id}/act`, { body: { k: rc.k, ...body } })
        await sleep(400); panel.remove()
        if (r.action) { S.out = true; S.log.push({ k: rc.k, cls: 'cash', text: r.action === 'cashout' ? `收手 ${xm(r.mult)}` : '超时自动收手', tag: '+' + fmt(r.payout) }); boom(r.payout ? `收手 ${xm(r.mult)}<small>+${fmt(r.payout)}</small>` : '退回注金', 'cash'); renderHud(); liveSide(); await sleep(1200); return replay(r.rest, r) }
        await perform(r.round, r, body.tier, rc)
      } catch (e) { toast(e.message); if (['RUN_ENDED', 'DUPLICATE', 'STALE_ROUND'].includes(e.code)) setTimeout(() => location.reload(), 1500) }
    }
    panel.querySelectorAll('.g-opt').forEach((b) => (b.onclick = () => { b.classList.add('on'); submit({ tier: b.dataset.t }) }))
    if (S.hits) $('#l13-cash').onclick = () => submit({ cashout: true })
    const tm = setInterval(() => {
      const left = lockAt - Date.now()
      const bar = $('#g-bar'); if (!bar) return clearInterval(tm)
      bar.style.width = Math.max(0, (left / total) * 100) + '%'; $('#g-sec').textContent = Math.max(0, Math.ceil(left / 1000)) + 's'
      panel.classList.toggle('hot', left < 3000)
      if (left <= 0) submit({})
    }, 100)
  }

  // 演出一轮：灯灭 → 上弹 → 心跳 → 灯亮 → 齐射 → 倒下
  // ─────────── 决斗（三轮之后） ───────────
  async function duelIntro(rd) {
    const pair = rd.pair || rd.after
    if (rd.released?.length) {
      caption(`三轮结束。主持人：<b>${rd.released.map((x) => x + ' 号').join('、')}</b>，你们可以走了。`)
      rd.released.forEach((id) => $('#p' + id)?.classList.add('released')); await sleep(2200)
    }
    caption(`<b class="red">决斗</b>：${pair.map((x) => `${x} 号 ${esc(name(x))}`).join(' <b>对</b> ')}`, 'warn')
    setCenter(`<div class="duel-vs">${pair.map((x) => `<span>${x}</span>`).join('<i>VS</i>')}</div><div class="alive-t">每枪加一发 · 直到一人倒下</div>`)
    document.querySelectorAll('.p').forEach((e) => e.classList.toggle('duelist', pair.includes(+e.id.slice(1))))
    const dc = clip('duel_intro'); if (dc) { heartStop(); await dc } else await sleep(1800)
  }
  async function showDuel(rd) {
    for (const sh of rd.shots) {
      for (let v = 0; v <= sh.voids; v++) {
        caption(`第 <b>${sh.d}</b> 枪 · 各装 <b class="red">${sh.bullets}</b> 发`, 'dim')
        setCenter(`<div class="duel-vs">${rd.pair.map((x) => `<span>${x}</span>`).join('<i>VS</i>')}</div><div class="cyl">${'<i class="on"></i>'.repeat(sh.bullets)}${'<i></i>'.repeat(6 - sh.bullets)}</div>`)
        heart(160 + sh.d * 10)
        const lc = clip('duel_load'); if (lc) await lc
        else { dark.classList.add('on'); SFX.cylinder(); await sleep(600); SFX.cock(); await sleep(1300); dark.classList.remove('on'); SFX.lights() }
        if (v < sh.voids) { caption('<b class="red">敲杖！</b> 两人都会死——作废，重来。', 'warn'); const vc = clip('void'); if (vc) await vc; else { SFX.whistle(); await sleep(1800) } continue }
        heartStop()
        const fc = clip(sh.dead.length ? 'duel_fire' : 'duel_dry')
        if (fc) await fc
        else { if (sh.fired.length) SFX.shot(); else { SFX.dry(); setTimeout(() => SFX.dry(), 80) } $('#l13-stage').classList.add('shake'); setTimeout(() => $('#l13-stage').classList.remove('shake'), 500); await sleep(700) }
        if (sh.dead.length) {
          const id = sh.dead[0]; caption(`<b class="red">${id} 号 ${esc(name(id))}</b> 倒下了。`)
          const dc = clip('death' + id, 3200); if (dc) await dc
          S.dead.add(id); $('#p' + id)?.classList.add('dead', 'falling'); SFX.body()
        } else caption('<b>两声空响。</b> 两个人都还站着。')
        document.body.classList.remove('l13-film'); await sleep(1300)
      }
    }
  }

  async function show(rd) {
    if (rd.type === 'duel') return showDuel(rd)
    for (let v = 0; v <= rd.voids; v++) {
      caption('灯灭了。', 'dim')
      const lc = clip('load_' + pick(['a', 'b', 'c']))
      if (lc) { heart(150 + rd.k * 10); await lc; caption('<b>咔嚓</b> —— 所有人同时上膛。', 'dim') }
      else {
        dark.classList.add('on'); SFX.lights(); await sleep(900)
        SFX.cylinder(); await sleep(500)
        for (let i = 0; i < 3; i++) { SFX.click(); await sleep(260) }
        SFX.cock(); caption('<b>咔嚓</b> —— 所有人同时上膛。', 'dim'); heart(150 + rd.k * 10); await sleep(1500)
        dark.classList.remove('on'); SFX.lights(); $('#l13-stage').classList.add('flashbang'); setTimeout(() => $('#l13-stage').classList.remove('flashbang'), 240)
        await sleep(260)
      }
      if (v < rd.voids) { // 全灭作废
        rd.before.forEach((id) => { $('#p' + id)?.classList.add('fire'); }); caption('<b class="red">敲杖！</b> 这一枪会让所有人死——主持人：作废，重来。', 'warn')
        const vc = clip('void'); if (vc) { heartStop(); await vc } else { SFX.whistle(); await sleep(2400) }
        rd.before.forEach((id) => $('#p' + id)?.classList.remove('fire')); continue
      }
      const fc = clip('fire' + rd.before.length)
      if (fc) { heartStop(); await fc }
      rd.fired.forEach((id) => $('#p' + id)?.classList.add('fire'))
      rd.before.filter((id) => !rd.fired.includes(id)).forEach((id) => $('#p' + id)?.classList.add('dry'))
      if (!fc) { if (rd.fired.length) SFX.shot(); else SFX.dry(); if (rd.fired.length > 1) setTimeout(() => SFX.shot(), 60) }
      $('#l13-stage').classList.add('shake'); setTimeout(() => $('#l13-stage').classList.remove('shake'), 500)
      heartStop(); await sleep(700)
      // 倒下：真人片按死亡名单逐个播放（每轮最多 3 个特写，其余直接在环上标记）
      const close = MEDIA ? rd.dead.slice(0, 3) : []
      for (const id of rd.dead) { if (close.includes(id)) { caption(`<b class="red">${esc(name(id))}</b>`); const dc = clip('death' + id, 3200); if (dc) await dc } S.dead.add(id); $('#p' + id)?.classList.add('dead', 'falling'); SFX.body(); await sleep(140) }
      document.body.classList.remove('l13-film')
      document.querySelectorAll('.p.fire,.p.dry').forEach((e) => e.classList.remove('fire', 'dry'))
      setCenter(`<div class="alive-n">${rd.after.length}</div><div class="alive-t">存活</div>`)
      caption(rd.dead.length ? `倒下 <b class="red">${rd.dead.length}</b> 人：${rd.dead.map(name).join('、')}` : '<b>六把枪，全是空膛。</b> 没有人倒下。')
      await sleep(1600)
    }
  }
  async function perform(rd, r, tier, rc) {
    await show(rd)
    if (r.hit) {
      S.hits = r.hits; S.mult = r.mult; SFX.win()
      const jp = r.chain_jp?.amount
      boom(`押中 · ${r.type === 'duel' ? `${r.winner} 号活下来` : `剩 ${r.survivors} 人`}<small>${jp ? `连环大奖 +${fmt(jp)}${r.chain_jp.status === 'held' ? '（审核中）' : ''}` : `倍率 ${xm(r.mult)}`}</small>`, 'hit')
      S.log.push({ k: rd.k, cls: 'hit', text: r.type === 'duel' ? `决斗：${r.winner} 号胜` : `剩 ${r.survivors} 人`, tag: jp ? '连环大奖' : xm(r.mult) })
    } else {
      S.out = true; SFX.lose()
      boom(`押错 · ${r.type === 'duel' ? `${r.winner} 号活下来` : `剩 ${r.survivors} 人`}<small>出局 · 继续观战到最后一人</small>`, 'miss')
      S.log.push({ k: rd.k, cls: 'miss', text: r.type === 'duel' ? `决斗：${r.winner} 号胜` : `剩 ${r.survivors} 人`, tag: '出局' })
    }
    renderHud(); liveSide(); await sleep(1600)
    if (r.ended) return replay(r.rest, r)
    return runRound(r.next)
  }
  // 出局 / 收手后：剩余轮次照常演完
  async function replay(rest, r) {
    for (const rd of rest || []) {
      if (rd.type === 'duel') await duelIntro(rd)
      else {
        caption(`第 <b>${rd.k}</b> 轮 · 每把枪装 <b class="red">${rd.bullets}</b> 发`); heart(90 + rd.k * 12)
        setCenter(`<div class="alive-n">${rd.before.length}</div><div class="alive-t">存活</div><div class="cyl">${'<i class="on"></i>'.repeat(rd.bullets)}${'<i></i>'.repeat(6 - rd.bullets)}</div>`)
        await sleep(1400)
      }
      await show(rd)
      S.log.push({ k: rd.k, cls: '', text: rd.type === 'duel' ? `决斗：${rd.after[0]} 号胜` : `剩 ${rd.after.length} 人`, tag: '观战' }); liveSide()
    }
    const w = [...document.querySelectorAll('.p:not(.dead)')].map((e) => +e.id.slice(1))
    heartStop(); w.forEach((id) => $('#p' + id)?.classList.add('winner'))
    caption(w[0] === 13 ? `<b class="gold">13 号 · 阿森</b> 活下来了。他攥着那封信，手还在抖。` : `<b class="gold">${w[0]} 号 · ${esc(name(w[0]))}</b> 站到了最后。他手里的枪，还是热的。`, 'gold')
    const wc = clip('winner' + w[0]); if (wc) { await wc; document.body.classList.remove('l13-film') } else await sleep(2600)
    end(r, w[0])
  }

  function end(r, winner) {
    M.pool = r.pool; renderHud()
    modal.innerHTML = `<div class="t-card ${r.jackpot ? 'perfect' : ''}">
      <div class="k">${r.reason === 'miss' ? '押错出局' : r.reason === 'final' ? '押到最后一人' : '收手离场'}</div>
      <p class="mut">最后幸存：<b class="gold">${winner} 号 · ${esc(name(winner))}</b></p>
      ${r.champ ? `<p class="${r.champ.hit ? 'up' : 'down'}">押冠军 ${r.champ.pick} 号：${r.champ.hit ? `命中 +${fmt(r.champ.payout)}` : '未中'}</p>` : ''}
      <div class="big">${r.hits}<small> 连中</small></div>
      <div class="kv"><span>注金</span><b>${fmt(r.stake)}</b><span>倍率</span><b class="gold">${r.reason === 'miss' ? '—' : xm(r.mult || 1)}</b><span>赔付</span><b>${fmt(r.payout)}</b>
        ${r.jackpot ? `<span>连环大奖</span><b class="coin">${fmt(r.jackpot)}${r.jackpot_status === 'held' ? '（审核中）' : ''}</b>` : ''}
        <span>本局净额</span><b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
      <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><p>第 k 轮第 t 次尝试第 i 把枪响 ⇔ HMAC(seed,"r:k:t:i") &lt; 装弹数/6；全员死亡的尝试作废重开</p><a href="/api/l13/runs/${S.run.run_id}/verify" target="_blank">服务端复算整局 →</a></details>
      <div class="acts"><button class="btn gold" id="again"><i class="fas fa-rotate-right"></i> 再来一局</button><a class="btn" href="/thrill">回板块</a></div></div>`
    modal.classList.remove('hidden')
    $('#again').onclick = async () => { modal.classList.add('hidden'); M = await api('/api/l13/meta'); MEDIA = M.media; Object.assign(S, { champ: 0, run: null, mult: 1, hits: 0, out: false, dead: new Set(), log: [] }); drawRing(13); cap.innerHTML = ''; renderHud(); lobby() }
  }

  ;(async () => {
    try { M = await api('/api/l13/meta'); MEDIA = M.media } catch (e) { side.innerHTML = `<div class="t-empty">${esc(e.message)}</div>`; return }
    drawRing(13); renderHud(); lobby()
    if (M.open_run) toast('你有一局还在进行，超过 15 分钟会自动按当前倍率收手')
  })()
})()
