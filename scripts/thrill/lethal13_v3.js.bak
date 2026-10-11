// 致命13 v3 · 押注单（一次押三轮，综合赔付）+ 每轮追注 + 3~5 轮 + 决斗
// 舞台：SVG 链式环（侧身成列、后者枪口指向前者）+ 中央六孔转轮；有真人片则按结果实时拼接片段
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
    if (!r.ok || j.error) throw Object.assign(new Error(j.error === 'INSUFFICIENT' ? j.message + '，余额不足' : j.message || '请求失败'), { code: j.error })
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
  // 手势解锁：在「交单」点击的同步阶段先让 <video> 播一次（静音），之后同一元素可自动带声播放（iOS / 微信）
  function unlockVideo() { try { video.muted = true; video.playsInline = true; const p = video.play(); p?.catch?.(() => {}); video.pause() } catch {} }
  /** 等用户点一下再播（自动播放被拦截时的兜底） */
  function tapToPlay() {
    return new Promise((res) => {
      const o = document.createElement('button'); o.className = 'tap-play'; o.innerHTML = '<i class="fas fa-play"></i><span>点一下继续观看</span>'
      video.parentElement.appendChild(o); o.onclick = () => { o.remove(); video.muted = false; video.play().then(res, () => { video.muted = true; video.play().then(res, res) }) }
    })
  }
  /** 播放一个片段；返回 Promise（播完 / 超时）。超时从「真正开始播放」起算，加载最多等 20 秒 */
  function clip(key, maxMs) {
    const c = MEDIA?.clips?.[key]; if (!c || !c.url) return null
    return new Promise(async (res) => {
      document.body.classList.add('l13-film'); video.src = c.url; video.dataset.playing = '1'; video.muted = false
      let done = false, timer = 0; const fin = () => { if (done) return; done = true; clearTimeout(timer); video.dataset.playing = '0'; res() }
      const arm = () => { clearTimeout(timer); timer = setTimeout(fin, Math.min(maxMs || 1e9, (c.dur + 3) * 1000)) }
      video.onended = fin; video.onplaying = arm; video.onerror = fin; timer = setTimeout(fin, 20000)
      try { await video.play() } catch { video.muted = true; try { await video.play() } catch { clearTimeout(timer); await tapToPlay(); arm() } }
    })
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  // ─────────── 舞台：SVG 链式环 + 中央转轮 ───────────
  const ring = $('#l13-ring'), center = $('#l13-center'), dark = $('#l13-dark'), cap = $('#l13-caption'), hud = $('#l13-hud'), side = $('#l13-side'), flash = $('#thrill-flash'), modal = $('#thrill-modal')
  let M, S = { run: null, champ: 0, stake: 10, bet: 10, picks: [], quote: null, dead: new Set(), log: [], slip: null }
  const name = (id) => M.prisoners.find((p) => p.id === id)?.name || '#' + id
  const N = 13, R = 37
  const pos = (i) => { const a = (i / N) * Math.PI * 2 - Math.PI / 2; return [50 + R * Math.cos(a), 50 + R * Math.sin(a)] }
  const GUN = '<svg viewBox="0 0 40 16" class="gun-svg"><path d="M2 5h22l2-2h3v2h9v3H26l-2 1v2l-3 4h-4l1-5H9L6 9H2z" fill="currentColor"/><circle cx="20" cy="7" r="2.6" fill="#000" opacity=".5"/></svg>'
  function drawRing(alive) {
    const svg = [`<svg class="l13-floor" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs><radialGradient id="bulb" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#dfe" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <marker id="tip" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="currentColor"/></marker></defs>
      <circle cx="50" cy="50" r="48" fill="url(#bulb)"/>
      <circle cx="50" cy="50" r="${R}" fill="none" stroke="#e9ece8" stroke-opacity=".55" stroke-width=".9" stroke-dasharray="2.2 1.1"/>
      <circle cx="50" cy="50" r="${R - 2.4}" fill="none" stroke="#e9ece8" stroke-opacity=".12" stroke-width=".3"/>
      ${M.prisoners.map((p, i) => { const [x, y] = pos(i), [nx, ny] = pos((i + 1) % N), dx = nx - x, dy = ny - y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L
        return `<line id="aim${p.id}" class="aim ${S.dead.has(p.id) ? 'off' : ''}" x1="${(x + ux * 4.2).toFixed(2)}" y1="${(y + uy * 4.2).toFixed(2)}" x2="${(nx - ux * 4.6).toFixed(2)}" y2="${(ny - uy * 4.6).toFixed(2)}" marker-end="url(#tip)"/>` }).join('')}
    </svg>`]
    ring.innerHTML = svg.join('') + M.prisoners.map((p, i) => {
      const [x, y] = pos(i), [nx, ny] = pos((i + 1) % N), rot = (Math.atan2(ny - y, nx - x) * 180) / Math.PI
      return `<div class="p ${S.dead.has(p.id) ? 'dead' : ''}" id="p${p.id}" style="left:${x}%;top:${y}%">
        <div class="gun" style="transform:rotate(${rot}deg)">${GUN}</div>
        <div class="head" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[i]}')"` : ''}><span>${p.id}</span></div><b>${esc(p.name)}</b></div>`
    }).join('')
    if (alive) setCenter(cylHTML(S.run ? 0 : 1, alive))
  }
  /** 六孔转轮（SVG · 发蓝枪钢）：bullets 发装弹；spin = 旋转；顶部红色击针标记 = 下一发 */
  function cylinder(bullets, spin) {
    const P = (r, i, off = 0) => { const a = ((i + off) / 6) * Math.PI * 2 - Math.PI / 2; return [50 + r * Math.cos(a), 50 + r * Math.sin(a), (a * 180) / Math.PI] }
    const flutes = Array.from({ length: 6 }, (_, i) => { const [x, y, d] = P(37.5, i, 0.5)
      return `<g transform="rotate(${d + 90} ${x} ${y})"><rect x="${x - 3.3}" y="${y - 9}" width="6.6" height="18" rx="3.3" fill="url(#flute)"/><rect x="${x - 3.3}" y="${y - 9}" width="6.6" height="18" rx="3.3" fill="none" stroke="#9aa6ab" stroke-opacity=".35" stroke-width=".5"/></g>` }).join('')
    const ch = Array.from({ length: 6 }, (_, i) => { const [x, y] = P(24.5, i), on = i < bullets
      return `<g class="ch ${on ? 'on' : ''}" style="--d:${i * 80}ms"><circle cx="${x}" cy="${y}" r="10.6" fill="#07090a" stroke="url(#rim)" stroke-width="1.6"/>
        ${on ? `<circle cx="${x}" cy="${y}" r="9" fill="url(#brass)"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#4a2f05" stroke-width=".9"/><circle cx="${x}" cy="${y}" r="6.6" fill="none" stroke="#ffe6a0" stroke-opacity=".35" stroke-width=".5"/><circle cx="${x}" cy="${y}" r="2.9" fill="url(#primer)" stroke="#5b3d0c" stroke-width=".5"/>`
        : `<circle cx="${x}" cy="${y}" r="8.4" fill="url(#bore)"/>`}</g>` }).join('')
    return `<svg class="cyl-svg" viewBox="0 0 100 100"><defs>
      <radialGradient id="blued" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#9aa7ad"/><stop offset=".25" stop-color="#4b565c"/><stop offset=".6" stop-color="#1f262a"/><stop offset="1" stop-color="#090b0c"/></radialGradient>
      <linearGradient id="flute" x1="0" x2="1"><stop offset="0" stop-color="#050708"/><stop offset=".5" stop-color="#20282c"/><stop offset="1" stop-color="#050708"/></linearGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9d3d7"/><stop offset=".5" stop-color="#39434a"/><stop offset="1" stop-color="#0d1012"/></linearGradient>
      <radialGradient id="bore" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#000"/><stop offset=".75" stop-color="#050607"/><stop offset="1" stop-color="#1e2427"/></radialGradient>
      <radialGradient id="brass" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#fff4c6"/><stop offset=".35" stop-color="#e7b347"/><stop offset=".75" stop-color="#a9700f"/><stop offset="1" stop-color="#5a3a06"/></radialGradient>
      <radialGradient id="primer" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fbf0d4"/><stop offset=".6" stop-color="#c9a466"/><stop offset="1" stop-color="#7a5a22"/></radialGradient>
      <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset=".86" stop-color="#d7ece2" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
      <circle cx="50" cy="50" r="50" fill="url(#halo)"/>
      <g class="rot ${spin ? 'spin' : ''}">
        <circle cx="50" cy="50" r="45.5" fill="url(#blued)"/><circle cx="50" cy="50" r="45.5" fill="none" stroke="#c9d3d7" stroke-opacity=".28" stroke-width=".6"/>
        <circle cx="50" cy="50" r="42.6" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="1.2"/>${flutes}${ch}
        <circle cx="50" cy="50" r="8.2" fill="url(#blued)" stroke="#05070a" stroke-width="1"/><circle cx="50" cy="50" r="3.2" fill="#05070a"/><circle cx="48.6" cy="48.6" r="1" fill="#fff" fill-opacity=".35"/>
        <path d="M18 26 A40 40 0 0 1 50 9.5" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.4" stroke-linecap="round"/></g>
      <path d="M50 1.5 l3.4 5.4 h-6.8z" fill="#ff3b4f" filter="drop-shadow(0 0 2px #ff3b4f)"/></svg>`
  }
  const cylHTML = (bullets, alive, sub) => `<div class="cyl-wrap">${cylinder(bullets, false)}<div class="cyl-n"><b>${alive}</b><small>${sub || '存活'}</small></div></div>${bullets && S.run ? `<div class="cyl-cap">${bullets} 发 / 6 孔 · 每人中枪 ${pct(bullets / 6)}</div>` : !S.run ? '<div class="cyl-cap">六孔左轮 · 第 k 轮装 k 发</div>' : ''}`
  async function spinCyl(bullets) { const w = center.querySelector('.cyl-svg'); if (!w) return; w.outerHTML = cylinder(bullets, true); SFX.cylinder(); setTimeout(() => SFX.cylinder(), 450); await sleep(1500); SFX.cock() }
  function setCenter(html) { center.innerHTML = html }
  function caption(t, cls = '') { cap.className = 'l13-caption ' + cls; cap.innerHTML = t; void cap.offsetWidth; cap.classList.add('in') }
  function renderHud() {
    const s = S.slip, q = S.quote
    hud.innerHTML = `<div class="h-stat">${S.run ? `押注单 ${S.run.quote.bins.map((b, i) => `<i class="dot ${s?.rows?.[i] ? (s.rows[i].hit ? 'hit' : 'miss') : ''}"></i>`).join('')} · 全中 <b class="gold">${xm(S.run.quote.mult[3])}</b>${s ? ` · 中 <b>${s.hits}</b>/3 → <b class="coin">+${fmt(s.payout)}</b>` : ''}` : '致命13'}</div><div class="h-pool"><i class="fas fa-sack-dollar"></i> <b>${fmt(M.pool)}</b></div>`
  }
  function boom(html, cls) { flash.className = 't-flash ' + cls; flash.innerHTML = `<div>${html}</div>`; void flash.offsetWidth; flash.classList.add('go') }
  function toast(m) { const t = document.createElement('div'); t.className = 't-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) }
    async function needChips(btn) {
      if (!btn || document.getElementById('faucet-cta')) return
      btn.insertAdjacentHTML('afterend', '<button id="faucet-cta" class="btn ghost" style="width:100%;margin-top:8px"><i class="fas fa-gift"></i> 余额不足 · 领取 500 免费币</button>')
      document.getElementById('faucet-cta').onclick = async (e) => { try { await api('/api/me/faucet', { body: {} }); e.currentTarget.remove(); toast('+500 Chips 已到账，再点交单') } catch (er) { toast(er.message) } }
    }

  // ─────────── 大厅：押注单 ───────────
  const short = (l) => String(l).replace(/^剩 /, '').replace(/ 人及以上$/, '+ 人').replace(/^(\d+) 人及以下$/, '≤$1 人')
  function slipTable(q, stake) {
    return `<div class="pay-table">${[1, 2, 3].map((h) => `<div class="pay ${h === 3 ? 'top' : ''}"><span>中 ${h} 档</span><em>${pct(q.P[h])}</em><b>${q.mult[h] ? xm(q.mult[h]) : '—'}</b><strong>${q.mult[h] ? fmt(Math.floor(stake * q.mult[h])) : 0}</strong></div>`).join('')}
      <div class="pay zero"><span>全不中</span><em>${pct(q.P[0])}</em><b>×0</b><strong>0</strong></div></div>
      <p class="note">三档全中另享 <b class="coin">奖池 ${Math.round(M.cfg.jackpot_share * 100)}%</b>（最高 ${M.cfg.jackpot_cap_mult}× 注金）${q.ok ? '' : ' · <b class="down">这三档几乎不可能同时成立，换一档</b>'}</p>`
  }
  async function requote() {
    try { S.quote = await api('/api/l13/quote', { body: { picks: S.picks } }) } catch (e) { toast(e.message) }
    const box = $('#slip-pay'); if (box && S.quote) box.innerHTML = slipTable(S.quote, S.stake)
    const st = $('#l13-start'); if (st) st.disabled = !S.quote?.ok
  }
  function lobby() {
    S.picks = S.picks.length === 3 ? S.picks : [...M.slip_default.picks]; S.quote = S.quote || M.slip_default
    side.innerHTML = `
      <div class="s-title"><div class="tension">${'<i class="fas fa-fire"></i>'.repeat(5)}</div><h2>致命<b class="red">13</b></h2>
        <p>13 个人侧身站成一圈，每人举枪对着前一个人的头。第 k 轮每把六孔左轮装 k 发，灯一亮，同时扣扳机。</p>
        <p class="note">固定 3 轮；3 轮后仍有 ≥${M.cfg.extra_min_alive} 人则<b>加赛</b>（最多 ${M.cfg.ring_max} 轮）；最后抽 2 人<b>决斗</b>，直到一人倒下。一局约 2~3 分钟。</p></div>
      <div class="s-block slip"><h4><i class="fas fa-receipt"></i> 押注单 · 一次押完前三轮</h4>
        ${M.slip_bins.map((bins, k) => `<div class="slip-row"><div class="slip-k">第 ${k + 1} 轮<small>${k + 1} 发</small></div><div class="slip-bins">${bins.map((b) => `<button class="sb ${S.picks[k] === b.id ? 'on' : ''}" data-k="${k}" data-id="${b.id}"><span>${esc(short(b.label))}</span><small>${pct(b.p)}</small></button>`).join('')}</div></div>`).join('')}
        <div id="slip-pay">${slipTable(S.quote, S.stake)}</div></div>
      <div class="s-block"><h4>注金</h4><div class="stakes">${M.cfg.stakes.map((v) => `<button class="stake ${v === S.stake ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
        <p class="note">押注单在第 3 轮枪响后揭晓 · 之后每轮（含加赛、决斗）开枪前 ${M.cfg.pick_sec} 秒还可<b>追注</b>，押错不影响后续</p></div>
      <div class="s-block"><h4>押冠军（可选 · 命中 ×${M.champ_odds}）</h4><div class="champ-grid">${M.prisoners.map((p) => `<button class="champ ${S.champ === p.id ? 'on' : ''}" data-n="${p.id}" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[p.id - 1]}')"` : ''}><b>${p.id}</b><span>${esc(p.name)}</span></button>`).join('')}</div><p class="note" id="champ-tip"></p></div>
      <button id="l13-start" class="btn gold big" ${S.quote?.ok ? '' : 'disabled'}><i class="fas fa-skull"></i> 交单 · 灯要灭了</button>
      <div class="s-block stats"><span>已开 ${fmt(M.stats.plays)} 局</span><span>押注单最高 ${xm(M.stats.top_mult || 0)}</span><span>奖池 ${fmt(M.pool)}</span></div>
      <div class="s-block recent"><h4>实时战报</h4>${M.recent.length ? M.recent.map((r) => `<div>${esc(r.who)} 押注单中 <b>${r.hits}</b>/3 ${r.win ? `<b class="gold">${xm(r.mult)}</b> +${fmt(r.win)}` : '<span class="down">未中</span>'}${r.jackpot ? ` <em>奖池 +${fmt(r.jackpot)}</em>` : ''}</div>`).join('') : '<div class="mut">还没有人入场</div>'}</div>`
    const champTip = () => { $('#champ-tip').innerHTML = S.champ ? `押 <b>${S.champ} 号 ${esc(name(S.champ))}</b> 活到最后 · 注金 ${S.stake} · 命中得 <b class="gold">${fmt(Math.floor(S.stake * M.champ_odds))}</b>` : '不押也可以开局' }
    champTip()
    side.querySelectorAll('.sb').forEach((b) => (b.onclick = () => { const k = +b.dataset.k; S.picks[k] = b.dataset.id; side.querySelectorAll(`.sb[data-k="${k}"]`).forEach((x) => x.classList.toggle('on', x === b)); SFX.click(); requote() }))
    side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)); champTip(); $('#slip-pay').innerHTML = slipTable(S.quote, S.stake) }))
    side.querySelectorAll('.champ').forEach((b) => (b.onclick = () => { S.champ = S.champ === +b.dataset.n ? 0 : +b.dataset.n; side.querySelectorAll('.champ').forEach((x) => x.classList.toggle('on', +x.dataset.n === S.champ)); champTip() }))
    $('#l13-start').onclick = start
  }
  function liveSide() {
    const q = S.run.quote, s = S.slip
    side.innerHTML = `<div class="s-title"><h2>致命<b class="red">13</b></h2><p class="mut">一口气演完 · 不可暂停 · 不可悔单</p></div>
      <div class="s-block slip live"><h4><i class="fas fa-receipt"></i> 我的押注单 · ${fmt(S.run.stake)}</h4>
        ${q.bins.map((b, i) => { const r = s?.rows?.[i]; const live = S.log.find((l) => l.k === i + 1)
          return `<div class="slip-line ${r ? (r.hit ? 'hit' : 'miss') : live ? (live.n >= b.lo && live.n <= b.hi ? 'hit' : 'miss') : ''}"><span>第 ${i + 1} 轮</span><em>${esc(b.label)}</em><b>${live ? `实际 ${live.n}` : '待开'}</b></div>` }).join('')}
        <div class="pay-mini">${[1, 2, 3].map((h) => `<span class="${s && s.hits === h ? 'on' : ''}">中${h} ${xm(q.mult[h])}</span>`).join('')}</div>
        ${s ? `<div class="slip-res">${s.hits === 3 ? '<b class="coin">三档全中！</b>' : `中 ${s.hits}/3`} · 赔付 <b class="coin">${fmt(s.payout)}</b>${s.jackpot?.amount ? ` + 奖池 <b class="coin">${fmt(s.jackpot.amount)}</b>${s.jackpot.status === 'held' ? '（审核中）' : ''}` : ''}</div>` : ''}</div>
      <div class="s-block"><h4>轮次</h4><ol class="gate-log">${S.log.length ? S.log.map((l) => `<li class="${l.cls}"><span>${l.k > M.cfg.ring_base && l.type !== 'duel' ? '加赛' : ''}${l.type === 'duel' ? '决斗' : `第${l.k}轮`}</span><em>${esc(l.text)}</em><b>${esc(l.tag)}</b></li>`).join('') : '<li><span>—</span><em>灯还亮着</em><b></b></li>'}</ol></div>
      <div class="s-block run-kv"><span>承诺哈希</span><code>${S.run.commit.slice(0, 16)}…</code></div>
      <button class="btn small ghost" id="l13-skip"><i class="fas fa-forward"></i> 不再追注 · 直接看完</button>`
    $('#l13-skip').onclick = skip
  }

  async function start() {
    ac().resume?.(); unlockVideo()
    const btn = $('#l13-start'); btn.disabled = true; btn.textContent = '锁定随机种子…'
    try {
      const body = { stake: S.stake, picks: S.picks, champ: S.champ || 0, champ_stake: S.champ ? S.stake : 0 }
      let r
      try { r = await api('/api/l13/start', { body }) } catch (e) {
        if (e.code !== 'ONE_AT_A_TIME' || !M.open_run) throw e
        await api(`/api/l13/runs/${M.open_run}/skip`, { body: {} }).catch(() => {}); M.open_run = null; toast('上一局已按种子自动结算'); r = await api('/api/l13/start', { body })
      }
      Object.assign(S, { run: r, dead: new Set(), log: [], slip: null, busy: false }); M.pool = r.pool
      liveSide(); renderHud(); drawRing(13)
      caption('主持人：<b>先生们，单子已经交了。最后站着的人，带走一切。</b>'); heart(72)
      const ic = clip('intro'); if (ic) { heartStop(); await ic; document.body.classList.remove('l13-film'); heart(80) } else await sleep(2600)
      await runRound(r.round)
    } catch (e) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-skull"></i> 交单 · 灯要灭了'; toast(e.message); if (e.code === 'INSUFFICIENT') needChips(btn) }
  }

  // 一轮：追注面板（可不押）→ 演出 → 下一轮
  async function runRound(rc) {
    if (S.skipped) return
    const duel = rc.type === 'duel'
    if (duel) await duelIntro(rc)
    else {
      caption(`${rc.extra ? '<b class="red">加赛</b> · ' : ''}第 <b>${rc.k}</b> 轮 · 每把枪装 <b class="red">${rc.bullets}</b> 发`)
      setCenter(cylHTML(0, rc.alive.length)); await spinCyl(rc.bullets)
      setCenter(cylHTML(rc.bullets, rc.alive.length))
    }
    heart(80 + rc.k * 12)
    const slipNote = !duel && rc.k <= M.cfg.ring_base ? `押注单：<b>${esc(S.run.quote.bins[rc.k - 1].label)}</b>` : duel ? '决斗：每枪加一发' : '加赛：押注单已结'
    const panel = document.createElement('div'); panel.className = 't-gate l13-bet in'; panel.id = 'l13-bet'
    panel.innerHTML = `<div class="g-head"><span>${duel ? `决斗 · ${rc.pair.map((x) => x + ' 号').join(' 对 ')}` : `${rc.extra ? '加赛 · ' : ''}第 ${rc.k} 轮 · ${rc.alive.length} 人 · ${rc.bullets} 发`}</span><span class="g-mult">${slipNote}</span></div>
      <div class="g-q">${duel ? '追注：谁会活着走出这个房间？' : '追注：这一枪之后，还剩几个人？'}</div>
      <div class="g-opts l13-tiers">${rc.tiers.map((t) => `<button class="g-opt" data-t="${t.id}"><span>${esc(t.label)}</span><small>概率 ${pct(t.p)}</small><b class="odds">${xm(t.odds)}</b></button>`).join('')}</div>
      <div class="bet-row"><span>追注</span>${M.cfg.stakes.map((v) => `<button class="bchip ${v === S.bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}<button class="g-cash" id="l13-watch"><i class="fas fa-eye"></i> 不追 · 只看</button></div>
      <div class="g-timer"><div id="g-bar"></div><b id="g-sec"></b></div>`
    $('#l13-stage').appendChild(panel)
    panel.querySelectorAll('.bchip').forEach((b) => (b.onclick = () => { S.bet = +b.dataset.v; panel.querySelectorAll('.bchip').forEach((x) => x.classList.toggle('on', x === b)) }))
    const arm = await api(`/api/l13/runs/${S.run.run_id}/arm`, { body: {} })
    const skew = Date.now() - arm.server_time, lockAt = arm.lock_at + skew - 800, total = lockAt - Date.now()
    let sent = false
    const submit = async (body) => {
      if (sent) return; sent = true; clearInterval(tm)
      panel.querySelectorAll('button').forEach((b) => (b.disabled = true)); panel.classList.add('locked')
      try {
        const r = await api(`/api/l13/runs/${S.run.run_id}/act`, { body: { k: rc.k, ...body } })
        await sleep(300); panel.remove()
        await perform(r.round, r)
      } catch (e) { panel.remove(); toast(e.message); if (['RUN_ENDED', 'DUPLICATE', 'STALE_ROUND', 'INSUFFICIENT'].includes(e.code)) setTimeout(() => location.reload(), 1500) }
    }
    panel.querySelectorAll('.g-opt').forEach((b) => (b.onclick = () => { b.classList.add('on'); submit({ tier: b.dataset.t, bet: S.bet }) }))
    $('#l13-watch').onclick = () => submit({})
    const tm = setInterval(() => {
      const left = lockAt - Date.now(), bar = $('#g-bar'); if (!bar) return clearInterval(tm)
      bar.style.width = Math.max(0, (left / total) * 100) + '%'; $('#g-sec').textContent = Math.max(0, Math.ceil(left / 1000)) + 's'
      panel.classList.toggle('hot', left < 3000)
      if (left <= 0) submit({})
    }, 100)
  }

  // ─────────── 决斗 ───────────
  async function duelIntro(rd) {
    const pair = rd.pair || rd.after
    if (rd.released?.length) {
      caption(`主持人：<b>${rd.released.map((x) => x + ' 号').join('、')}</b>，你们可以走了。`)
      rd.released.forEach((id) => { $('#p' + id)?.classList.add('released'); $('#aim' + id)?.classList.add('off') }); await sleep(2000)
    }
    caption(`<b class="red">决斗</b>：${pair.map((x) => `${x} 号 ${esc(name(x))}`).join(' <b>对</b> ')}`, 'warn')
    setCenter(`<div class="duel-vs">${pair.map((x) => `<span class="dv" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[x - 1]}')"` : ''}><b>${x}</b></span>`).join('<i>VS</i>')}</div><div class="alive-t">每枪加一发 · 直到一人倒下</div>`)
    document.querySelectorAll('.p').forEach((e) => e.classList.toggle('duelist', pair.includes(+e.id.slice(1))))
    const dc = clip('duel_intro'); if (dc) { heartStop(); await dc; document.body.classList.remove('l13-film') } else await sleep(1800)
  }
  async function showDuel(rd) {
    for (const sh of rd.shots) {
      for (let v = 0; v <= sh.voids; v++) {
        caption(`第 <b>${sh.d}</b> 枪 · 各装 <b class="red">${sh.bullets}</b> 发`, 'dim')
        setCenter(`<div class="cyl-wrap small">${cylinder(sh.bullets, true)}</div><div class="cyl-cap">决斗 · ${rd.pair.join(' VS ')}</div>`); SFX.cylinder()
        heart(160 + sh.d * 10)
        const lc = clip('duel_load'); if (lc) await lc
        else { dark.classList.add('on'); await sleep(600); SFX.cock(); await sleep(1300); dark.classList.remove('on'); SFX.lights() }
        if (v < sh.voids) { caption('<b class="red">敲杖！</b> 两人都会死——作废，重来。', 'warn'); const vc = clip('void'); if (vc) await vc; else { SFX.whistle(); await sleep(1800) } continue }
        heartStop()
        const fc = clip(sh.dead.length ? 'duel_fire' : 'duel_dry')
        if (fc) await fc
        else { if (sh.fired.length) SFX.shot(); else { SFX.dry(); setTimeout(() => SFX.dry(), 80) } shake(); await sleep(700) }
        if (sh.dead.length) {
          const id = sh.dead[0]; caption(`<b class="red">${id} 号 ${esc(name(id))}</b> 倒下了。`)
          const dc = clip('death' + id, 3200); if (dc) await dc
          kill(id)
        } else caption('<b>两声空响。</b> 两个人都还站着。')
        document.body.classList.remove('l13-film'); await sleep(1200)
      }
    }
  }
  const shake = () => { $('#l13-stage').classList.add('shake'); setTimeout(() => $('#l13-stage').classList.remove('shake'), 500) }
  const kill = (id) => { S.dead.add(id); $('#p' + id)?.classList.add('dead', 'falling'); $('#aim' + id)?.classList.add('off'); SFX.body() }

  async function show(rd) {
    if (rd.type === 'duel') return showDuel(rd)
    for (let v = 0; v <= rd.voids; v++) {
      caption('灯灭了。', 'dim')
      const lc = clip('load_' + pick(['a', 'b', 'c']))
      if (lc) { heart(150 + rd.k * 10); await lc; caption('<b>咔嚓</b> —— 所有人同时上膛。', 'dim') }
      else {
        dark.classList.add('on'); SFX.lights(); await sleep(900)
        for (let i = 0; i < 3; i++) { SFX.click(); await sleep(260) }
        SFX.cock(); caption('<b>咔嚓</b> —— 所有人同时上膛。', 'dim'); heart(150 + rd.k * 10); await sleep(1500)
        dark.classList.remove('on'); SFX.lights(); $('#l13-stage').classList.add('flashbang'); setTimeout(() => $('#l13-stage').classList.remove('flashbang'), 240); await sleep(260)
      }
      if (v < rd.voids) {
        caption('<b class="red">敲杖！</b> 这一枪会让所有人死——主持人：作废，重来。', 'warn')
        const vc = clip('void'); if (vc) { heartStop(); await vc } else { SFX.whistle(); await sleep(2400) }
        document.body.classList.remove('l13-film'); continue
      }
      const fc = clip('fire' + rd.before.length)
      if (fc) { heartStop(); await fc }
      rd.fired.forEach((id) => { $('#p' + id)?.classList.add('fire'); $('#aim' + id)?.classList.add('hot') })
      rd.before.filter((id) => !rd.fired.includes(id)).forEach((id) => $('#p' + id)?.classList.add('dry'))
      if (!fc) { if (rd.fired.length) SFX.shot(); else SFX.dry(); if (rd.fired.length > 1) setTimeout(() => SFX.shot(), 60) }
      shake(); heartStop(); await sleep(700)
      const close = MEDIA ? rd.dead.slice(0, 3) : []
      for (const id of rd.dead) { if (close.includes(id)) { caption(`<b class="red">${id} 号 ${esc(name(id))}</b>`); const dc = clip('death' + id, 3200); if (dc) await dc } kill(id); await sleep(140) }
      document.body.classList.remove('l13-film')
      document.querySelectorAll('.p.fire,.p.dry').forEach((e) => e.classList.remove('fire', 'dry')); document.querySelectorAll('.aim.hot').forEach((e) => e.classList.remove('hot'))
      setCenter(cylHTML(rd.bullets, rd.after.length))
      caption(rd.dead.length ? `倒下 <b class="red">${rd.dead.length}</b> 人：${rd.dead.map(name).join('、')}` : '<b>所有枪都是空膛。</b> 没有人倒下。')
      await sleep(1500)
    }
  }
  async function perform(rd, r) {
    await show(rd)
    const duel = r.type === 'duel'
    S.log.push({ k: rd.k, type: r.type, n: duel ? r.winner : r.survivors, cls: r.side ? (r.side.hit ? 'hit' : 'miss') : '', text: duel ? `${r.winner} 号活下来` : `剩 ${r.survivors} 人`, tag: r.side ? (r.side.hit ? `追注 +${fmt(r.side.payout)}` : `追注 -${fmt(r.side.bet)}`) : '只看' })
    if (r.side) { boom(`${r.side.hit ? '追注命中' : '追注未中'}<small>${esc(r.side.label)} · ${r.side.hit ? '+' + fmt(r.side.payout) : '-' + fmt(r.side.bet)}</small>`, r.side.hit ? 'hit' : 'miss'); r.side.hit ? SFX.win() : SFX.lose(); await sleep(1300) }
    if (r.slip && !S.slip) { S.slip = r.slip; await slipReveal(r.slip) }
    renderHud(); liveSide()
    if (r.ended) return finale(r)
    return runRound(r.next)
  }
  async function slipReveal(s) {
    heartStop()
    caption(`押注单揭晓：${s.rows.map((x) => `<b class="${x.hit ? 'gold' : 'red'}">${x.hit ? '✓' : '✕'}</b>`).join(' ')}`, s.hits === 3 ? 'gold' : '')
    s.hits ? SFX.win() : SFX.lose()
    boom(`${s.hits === 3 ? '三档全中！' : `押注单 中 ${s.hits}/3`}<small>${s.payout ? `${xm(s.mult)} · +${fmt(s.payout)}` : '未中'}${s.jackpot?.amount ? ` · 奖池 +${fmt(s.jackpot.amount)}` : ''}</small>`, s.hits >= 2 ? 'hit' : s.hits ? 'cash' : 'miss')
    await sleep(2200)
  }
  async function skip() {
    if (S.skipped) return; S.skipped = true
    try { const r = await api(`/api/l13/runs/${S.run.run_id}/skip`, { body: {} }); $('#l13-bet')?.remove(); S.slip = r.slip; renderHud(); liveSide(); for (const rd of r.rest) { if (rd.type === 'duel') await duelIntro(rd); await show(rd); S.log.push({ k: rd.k, type: rd.type, n: rd.type === 'duel' ? rd.after[0] : rd.after.length, cls: '', text: rd.type === 'duel' ? `${rd.after[0]} 号活下来` : `剩 ${rd.after.length} 人`, tag: '只看' }); liveSide() } finale(r) }
    catch (e) { S.skipped = false; toast(e.message) }
  }
  async function finale(r) {
    const w = r.winner
    heartStop(); $('#p' + w)?.classList.add('winner')
    setCenter(`<div class="duel-vs"><span class="dv win" ${MEDIA?.faces ? `style="background-image:url('${MEDIA.faces[w - 1]}')"` : ''}><b>${w}</b></span></div>`)
    caption(w === 13 ? `<b class="gold">13 号 · 阿森</b> 活下来了。他攥着那封信，手还在抖。` : `<b class="gold">${w} 号 · ${esc(name(w))}</b> 站到了最后。他手里的枪，还是热的。`, 'gold')
    const wc = clip('winner' + w); if (wc) { await wc; document.body.classList.remove('l13-film') } else await sleep(2600)
    end(r)
  }

  function end(r) {
    M.pool = r.pool; renderHud()
    const s = r.slip || { rows: [], hits: 0, payout: 0, mult: 0 }
    modal.innerHTML = `<div class="t-card ${s.hits === 3 ? 'perfect' : ''}">
      <div class="k">${s.hits === 3 ? '押注单 · 三档全中' : `押注单 · 中 ${s.hits}/3`}</div>
      <p class="mut">最后幸存：<b class="gold">${r.winner} 号 · ${esc(name(r.winner))}</b></p>
      <div class="slip-end">${s.rows.map((x) => `<div class="${x.hit ? 'hit' : 'miss'}"><span>第 ${x.k} 轮</span><em>${esc(x.label)}</em><b>实际 ${x.actual}</b></div>`).join('')}</div>
      <div class="kv"><span>押注单</span><b>${fmt(r.stake)} → ${fmt(s.payout)}${s.mult ? ` (${xm(s.mult)})` : ''}</b>
        ${r.jackpot ? `<span>奖池大奖</span><b class="coin">${fmt(r.jackpot)}${r.jackpot_status === 'held' ? '（审核中）' : ''}</b>` : ''}
        ${r.side_total?.staked ? `<span>追注</span><b>${fmt(r.side_total.staked)} → ${fmt(r.side_total.paid)}</b>` : ''}
        ${r.champ ? `<span>押冠军 ${r.champ.pick} 号</span><b class="${r.champ.hit ? 'up' : 'down'}">${r.champ.hit ? '+' + fmt(r.champ.payout) : '未中'}</b>` : ''}
        <span>本局净额</span><b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
      <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><p>第 k 轮第 t 次尝试第 i 把枪响 ⇔ HMAC(seed,"r:k:t:i") &lt; 装弹数/6；全员死亡的尝试作废重开。剧情只由种子决定，与任何下注无关。</p><a href="/api/l13/runs/${S.run.run_id}/verify" target="_blank">服务端复算整局 →</a></details>
      <div class="acts"><button class="btn gold" id="again"><i class="fas fa-rotate-right"></i> 再押一单</button><a class="btn" href="/thrill">回板块</a></div></div>`
    modal.classList.remove('hidden')
    $('#again').onclick = async () => { modal.classList.add('hidden'); M = await api('/api/l13/meta'); MEDIA = M.media; Object.assign(S, { champ: 0, run: null, dead: new Set(), log: [], slip: null, skipped: false }); drawRing(13); cap.innerHTML = ''; renderHud(); lobby() }
  }

  ;(async () => {
    try { M = await api('/api/l13/meta'); MEDIA = M.media } catch (e) { side.innerHTML = `<div class="t-empty">${esc(e.message)}</div>`; return }
    drawRing(13); renderHud(); lobby()
    if (M.open_run) toast('你有一局还没看完，交单时会先自动结算上一局')
  })()
})()
