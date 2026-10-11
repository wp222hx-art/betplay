// 开心1分钟 · 阿木系列播放器：开局押注单 → 片子一口气放完，三个悬念各开 6 秒追加窗口（片子不停、赔率实时下滑）→ 盖章揭晓 → 结局卡
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
  const xm = (m) => '×' + (m >= 100 ? Math.round(m) : m >= 10 ? (+m).toFixed(1) : (+m).toFixed(2))
  const pct = (p) => (p * 100 >= 10 ? Math.round(p * 100) : (p * 100).toFixed(1)) + '%'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  async function api(p, o = {}) {
    const r = await fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw Object.assign(new Error(j.error === 'INSUFFICIENT' ? j.message + '，余额不足' : j.message || '请求失败'), { code: j.error })
    return j
  }
  let AC = null; const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)())
  function tone(f0, f1, dur, g = 0.2, type = 'sine', delay = 0) { try { const c = ac(), o = c.createOscillator(), v = c.createGain(), t = c.currentTime + delay; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur); v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(v).connect(c.destination); o.start(t); o.stop(t + dur + 0.02) } catch {} }
  const SFX = { tick: () => tone(1500, 1300, 0.04, 0.08, 'square'), pick: () => tone(660, 990, 0.12, 0.18, 'triangle'), stamp: () => { tone(180, 60, 0.25, 0.4, 'square'); tone(90, 40, 0.3, 0.3, 'sine', 0.02) },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.2, 0.2, 'triangle', i * 0.09)), lose: () => [392, 330, 262].forEach((f, i) => tone(f, f * 0.97, 0.22, 0.16, 'sawtooth', i * 0.14)), open: () => tone(440, 880, 0.18, 0.16, 'triangle') }
  const RT = window.ComboRT = {}   // 测试钩子

  window.ComboPlay = async (sid) => {
    const stage = $('#cb-stage'), V = [$('#cb-v0'), $('#cb-v1')], poster = $('#cb-poster'), tl = $('#cb-timeline'), hud = $('#cb-hud'), cap = $('#cb-cap'), win = $('#cb-window'), stamp = $('#cb-stamp'), side = $('#cb-side'), modal = $('#cb-modal')
    let M, S = { stake: 20, picks: [], quote: null, twist: false, run: null, known: [], live: null, next: null, bets: [], reveals: [], res: null, cur: 0 }
    V.forEach((v) => { v.controls = false; v.disablePictureInPicture = true; v.playsInline = true })
    const toast = (m) => { const t = document.createElement('div'); t.className = 'f-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3200) }

    // ─────────── 双缓冲播放：下一段在后台缓冲，切换无黑屏 ───────────
    const front = () => V[S.cur], back = () => V[1 - S.cur]
    function load(v, c) { if (!c?.url) return; if (v.dataset.key === c.key) return; v.dataset.key = c.key; v.src = c.url; v.load() }
    function unlock() { V.forEach((v) => { try { v.muted = true; v.play()?.catch?.(() => {}); v.pause() } catch {} }) }
    function tapToPlay(v) {
      return new Promise((res) => {
        const o = document.createElement('button'); o.className = 'tap-play'; o.innerHTML = '<i class="fas fa-play"></i><span>点一下继续观看</span>'; stage.appendChild(o)
        o.onclick = () => { o.remove(); v.muted = false; v.play().then(res, () => { v.muted = true; v.play().then(res, res) }) }
      })
    }
    /** 播一段：返回 { started, ended }；onTime(t,dur) 回调用于时间轴 */
    function playClip(c, onTime) {
      let started, ended
      const pS = new Promise((r) => (started = r)), pE = new Promise((r) => (ended = r))
      if (!c?.url) { started(); setTimeout(ended, 2500); return { started: pS, ended: pE } }
      const v = back(); load(v, c)
      let done = false, timer = 0; const fin = () => { if (done) return; done = true; clearTimeout(timer); v.ontimeupdate = null; ended() }
      v.onended = fin; v.onerror = () => { started(); fin() }
      v.onplaying = () => { if (!v.classList.contains('on')) { V.forEach((x) => x.classList.toggle('on', x === v)); S.cur = V.indexOf(v); front().muted = false; V.forEach((x) => { if (x !== v) x.pause() }) } started(); clearTimeout(timer); timer = setTimeout(fin, (c.dur + 3) * 1000) }
      v.ontimeupdate = () => onTime?.(v.currentTime, c.dur)
      timer = setTimeout(() => { started(); fin() }, 20000)
      v.muted = false
      v.play().catch(async () => { v.muted = true; try { await v.play() } catch { clearTimeout(timer); await tapToPlay(v) } })
      return { started: pS, ended: pE }
    }

    // ─────────── 时间轴（有时间感：一直往前走，标出三个悬念点） ───────────
    let PLAN = [], tlStart = 0
    function buildPlan() {
      const d = (k, f) => M.media?.dur?.[k] || f
      PLAN = [{ id: 'intro', label: '开场', dur: d('intro', 8) }]
      M.slots.forEach((s, k) => { PLAN.push({ id: 'w' + k, label: s.key, dur: d(['sA', 'sB', 'sC'][k], 6), win: true }); PLAN.push({ id: 'r' + k, label: '揭晓', dur: 8 }) })
      PLAN.push({ id: 'end', label: '结局', dur: d('outro', 5) })
    }
    const total = () => PLAN.reduce((s, x) => s + x.dur, 0)
    function drawTimeline(segId, t) {
      const T = total(); let acc = 0, done = 0
      for (const p of PLAN) { if (p.id === segId) { done = acc + Math.min(t, p.dur); break } acc += p.dur }
      if (segId === 'over') done = T
      let x = 0
      tl.innerHTML = `<div class="tl-bar">${PLAN.map((p) => { const w = (p.dur / T) * 100, html = `<i class="tl-seg ${p.win ? 'win' : ''} ${p.id === segId ? 'cur' : ''}" style="left:${x}%;width:${w}%">${p.win ? `<b>${p.label}</b>` : ''}</i>`; x += w; return html }).join('')}<em class="tl-fill" style="width:${(done / T) * 100}%"></em><span class="tl-head" style="left:${(done / T) * 100}%"></span></div>
        <div class="tl-t"><span>${Math.floor(done)}s</span><span>${Math.round(T)}s</span></div>`
    }

    // ─────────── HUD：押注单三格 + 实时全中概率 ───────────
    function renderHud() {
      if (!S.run) { hud.innerHTML = ''; return }
      const L = S.live || [0, 0, 0, 0]
      hud.innerHTML = `<div class="h-slip">${M.slots.map((s, k) => { const r = S.reveals[k]; const pick = s.opts.find((o) => o.id === S.picks[k]); return `<span class="h-leg ${r ? (r.hit ? 'hit' : 'miss') : ''}"><small>${s.key}</small>${esc(pick?.word || '')}</span>` }).join('')}</div>
        <div class="h-odds">全中概率 <b>${pct(L[3])}</b> · 全中 <b class="gold">${xm(S.run.quote.mult[3])}</b></div>`
    }

    // ─────────── 大厅：押注单 ───────────
    function lobby() {
      S.picks = S.picks.length === 3 ? S.picks : [...M.slip_default.picks]; S.quote = S.quote || M.slip_default
      poster.src = M.media?.cover || ''; stage.classList.remove('film'); cap.innerHTML = `<b>${esc(M.hero)}</b> · 一本正经地停个车`; cap.className = 'cb-cap in intro'
      buildPlan(); drawTimeline('intro', 0); renderHud()
      side.innerHTML = `
        <div class="s-title"><span class="tag">${esc(M.tag)}</span><h2>${esc(M.title)}</h2><p>${esc(M.logline)}</p></div>
        <div class="cast">${M.cast.map((c) => `<div class="cm"><i style="background-image:url('${M.media?.faces?.[c.id] || ''}')"></i><b>${esc(c.name)}</b><small>${esc(c.role)}</small></div>`).join('')}</div>
        <div class="s-block"><h4><i class="fas fa-receipt"></i> 押注单 · 开演前押三件事</h4>
          ${M.slots.map((s, k) => `<div class="slot"><div class="sl-h"><b>${esc(s.title)}</b><small>${esc(s.q)}</small></div><div class="sl-o">${s.opts.map((o, i) => `<button class="so ${S.picks[k] === o.id ? 'on' : ''}" data-k="${k}" data-id="${o.id}"><b>${esc(o.label)}</b><em>${pct(M.marg[k][i])}</em></button>`).join('')}</div></div>`).join('')}
          <div id="cb-pay" class="pay-table"></div>
        </div>
        <div class="s-block"><h4>注金</h4><div class="chips">${M.cfg.stakes.map((v) => `<button class="stake ${S.stake === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
          <label class="twist"><input type="checkbox" id="cb-tw" ${S.twist ? 'checked' : ''}> 加押<b>反转牌</b>（${pct(M.twist.p)} 概率 · 赔 ${xm(M.twist.odds)}）<small>${M.twist.opts.map((o) => esc(o.label)).join(' / ')}</small></label>
          <button id="cb-go" class="btn big"><i class="fas fa-clapperboard"></i> 交单 · 开演</button>
          <p class="note">片子一口气放完不暂停。三个悬念各有 <b>6 秒</b>追加窗口，越早押赔率越高。</p></div>
        <details class="s-block rules"><summary>公开规则 · 概率怎么算</summary><ul>${M.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
        ${M.recent?.length ? `<div class="s-block"><h4>最近结局</h4><ul class="recent">${M.recent.map((r) => `<li><span>${esc(r.who)}</span><em>${esc(r.name)}</em><b>中${r.hits}/3</b></li>`).join('')}</ul></div>` : ''}`
      payTable()
      side.querySelectorAll('.so').forEach((b) => (b.onclick = async () => { const k = +b.dataset.k; S.picks[k] = b.dataset.id; side.querySelectorAll(`.so[data-k="${k}"]`).forEach((x) => x.classList.toggle('on', x === b)); SFX.pick(); try { S.quote = await api(`/api/combo/${sid}/quote`, { body: { picks: S.picks } }) } catch (e) { toast(e.message) } payTable() }))
      side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)); payTable() }))
      $('#cb-tw').onchange = (e) => (S.twist = e.target.checked)
      $('#cb-go').onclick = start
      if (M.open_run) toast('你上一局没看完，交单时会先自动结算')
    }
    function payTable() {
      const q = S.quote; if (!q) return
      $('#cb-pay').innerHTML = [3, 2, 1].map((h) => `<div class="pay ${h === 3 ? 'top' : ''}"><span>中 ${h} 条</span><em>${pct(q.P[h])}</em><b>${q.mult[h] ? xm(q.mult[h]) : '—'}</b><strong>${fmt(Math.floor(S.stake * (q.mult[h] || 0)))}</strong></div>`).join('') + `<div class="pay"><span>全不中</span><em>${pct(q.P[0])}</em><b>×0</b><strong>0</strong></div>`
      const go = $('#cb-go'); if (go) go.disabled = !q.ok
    }
    async function needChips(btn) {
      if (document.getElementById('faucet-cta')) return
      btn.insertAdjacentHTML('afterend', '<button id="faucet-cta" class="btn ghost" style="width:100%;margin-top:8px"><i class="fas fa-gift"></i> 余额不足 · 领取 500 免费币</button>')
      $('#faucet-cta').onclick = async (e) => { try { await api('/api/me/faucet', { body: {} }); e.currentTarget.remove(); toast('+500 Chips 已到账，再点交单') } catch (er) { toast(er.message) } }
    }

    // ─────────── 演出 ───────────
    function liveSide() {
      const L = S.live || [0, 0, 0, 0]
      side.innerHTML = `<div class="s-title"><span class="tag">${esc(M.tag)}</span><h2>${esc(M.title)}</h2><p class="mini">一口气演完 · 不可暂停 · 结果开局已锁定</p></div>
        <div class="s-block"><h4><i class="fas fa-receipt"></i> 我的押注单 · ${fmt(S.stake)}</h4>
          ${M.slots.map((s, k) => { const r = S.reveals[k], p = s.opts.find((o) => o.id === S.picks[k]); return `<div class="my-leg ${r ? (r.hit ? 'hit' : 'miss') : ''}"><span>${esc(s.title)}</span><em>${esc(p?.label)}</em><b>${r ? (r.hit ? '✓ ' : '✕ ') + esc(r.label) : '待揭晓'}</b></div>` }).join('')}
          <div class="live-p">${[3, 2, 1, 0].map((h) => `<div class="lp ${h === 3 ? 'top' : ''}"><span>${h ? '中 ' + h : '全不中'}</span><i style="width:${Math.max(2, L[h] * 100)}%"></i><b>${pct(L[h])}</b></div>`).join('')}</div></div>
        <div class="s-block"><h4>追加记录</h4><ol class="bet-log">${S.bets.length ? S.bets.map((b) => `<li class="${b.hit === true ? 'hit' : b.hit === false ? 'miss' : ''}"><span>${esc(M.slots[b.k].key)}</span><em>${esc(b.label)} ${xm(b.odds)}</em><b>${b.hit === true ? '+' + fmt(b.payout) : b.hit === false ? '-' + fmt(b.bet) : fmt(b.bet)}</b></li>`).join('') : '<li class="empty">还没追加</li>'}</ol></div>
        ${S.next ? `<div class="s-block"><h4>下一个悬念 · 当前概率</h4><div class="next-p">${M.slots[S.known.length].opts.map((o, i) => `<span><b>${esc(o.label)}</b><em>${pct(S.next[i])}</em></span>`).join('')}</div></div>` : ''}`
    }
    function caption(t, cls = '') { cap.className = 'cb-cap ' + cls; cap.innerHTML = t; void cap.offsetWidth; cap.classList.add('in') }
    async function doStamp(k, r) {
      SFX.stamp()
      stamp.className = 'cb-stamp'; stamp.innerHTML = `<div class="st ${r.hit ? 'hit' : 'miss'}"><small>${esc(M.slots[k].title)}</small><b>${esc(r.label)}</b><i>${r.hit ? '押注单 ✓' : '押注单 ✕'}</i></div>`
      void stamp.offsetWidth; stamp.classList.add('go')
      setTimeout(() => stamp.classList.remove('go'), 2200)
    }

    async function start() {
      ac().resume?.(); unlock()
      const b = $('#cb-go'); b.disabled = true; b.textContent = '锁定结果…'
      try {
        const body = { stake: S.stake, picks: S.picks, twist: S.twist, twist_stake: S.twist ? Math.min(50, S.stake) : 0 }
        const r = await api(`/api/combo/${sid}/start`, { body })
        Object.assign(S, { run: r, known: [], live: r.live, next: r.next, bets: [], reveals: [], res: null })
        stage.classList.add('film'); liveSide(); renderHud()
        const pre = M.media?.pre || {}
        load(back(), pre.intro)
        caption(`<b>${esc(M.hero)}</b>来了。车位只有一个。`, 'intro')
        const p = playClip(pre.intro, (t) => drawTimeline('intro', t))
        await p.started; load(back(), pre.sA); await p.ended
        for (let k = 0; k < 3; k++) await beat(k)
        await finale()
      } catch (e) { b.disabled = false; b.innerHTML = '<i class="fas fa-clapperboard"></i> 交单 · 开演'; toast(e.message); if (e.code === 'INSUFFICIENT') needChips(b) }
    }

    /** 一个悬念：悬念片照常播放 + 追加窗口 → 窗口锁定 → 揭晓（盖章）→ 结果片 */
    async function beat(k) {
      const s = M.slots[k], pre = M.media?.pre || {}, susKey = ['sA', 'sB', 'sC'][k]
      caption(`<small>${esc(s.title)}</small>${esc(s.tease)}`, 'tease')
      const p = playClip(pre[susKey], (t) => drawTimeline('w' + k, t))
      await p.started
      let arm = null; try { arm = await api(`/api/combo/${sid}/runs/${S.run.run_id}/arm`, { body: { k } }) } catch (e) { toast(e.message) }
      const closeAt = arm ? Date.now() + (arm.lock_at - arm.server_time) : Date.now() + 6500
      if (arm) openWindow(k, arm, closeAt)
      await Promise.race([p.ended, sleep(Math.max(0, closeAt - Date.now()) + 900)])
      while (Date.now() < closeAt + 150) await sleep(80)
      closeWindow()
      // 悬念片结束后定格 + 慢推，同时请求揭晓（遮住加载）
      stage.classList.add('freeze'); caption(`<small>${esc(s.title)}</small><b class="drum">揭晓……</b>`, 'reveal')
      let r; for (let i = 0; i < 3; i++) { try { r = await api(`/api/combo/${sid}/runs/${S.run.run_id}/reveal`, { body: { k } }); break } catch (e) { if (e.code !== 'WINDOW_OPEN') throw e; await sleep(400) } }
      load(back(), r.clip)
      S.known.push(r.out); S.reveals[k] = r; S.live = r.live; S.next = r.next || null
      if (r.side) { const b = S.bets.find((x) => x.k === k); if (b) Object.assign(b, r.side) }
      await sleep(350); stage.classList.remove('freeze'); doStamp(k, r)
      caption(`<small>${esc(s.title)}</small><b>${esc(r.label)}</b>`, 'reveal')
      const rp = playClip(r.clip, (t) => drawTimeline('r' + k, t))
      await rp.started
      if (r.side) setTimeout(() => { r.side.hit ? SFX.win() : SFX.lose(); toast(r.side.hit ? `追加命中 +${fmt(r.side.payout)}` : `追加没中 -${fmt(r.side.bet)}`) }, 900)
      liveSide(); renderHud()
      if (k < 2) { const nk = ['sA', 'sB', 'sC'][k + 1]; setTimeout(() => load(back(), pre[nk]), 1200) }
      else if (r.ending?.clip) setTimeout(() => load(back(), r.ending.clip), 1200)
      if (k === 2) S.res = r
      await rp.ended
    }

    // ─────────── 追加窗口：片子不停，赔率实时下滑 ───────────
    let wTimer = 0
    function openWindow(k, arm, closeAt) {
      const s = M.slots[k], openAt = Date.now() - (arm.server_time - arm.armed_at), W = M.cfg.win_ms
      let bet = M.cfg.bets.includes(S.stake) ? S.stake : 20, placed = null
      SFX.open()
      const odds = (i) => { const f = Math.max(0, Math.min(1, (Date.now() - openAt) / W)), rtp = M.cfg.rtp_hi - (M.cfg.rtp_hi - M.cfg.rtp_lo) * f; return Math.max(1.01, Math.floor((rtp / arm.probs[i]) * 100) / 100) }
      win.className = 'cb-window'; stage.classList.add('win-open')
      win.innerHTML = `<div class="w-h"><span class="w-k">${esc(s.key)}</span><b>${esc(s.q)}</b><em id="w-left">6.0s</em></div><div class="w-bar"><i id="w-bar"></i></div>
        <div class="w-opts">${s.opts.map((o, i) => `<button class="wo" data-i="${i}" data-id="${o.id}"><b>${esc(o.label)}</b><small>${pct(arm.probs[i])}</small><em data-o="${i}">${xm(odds(i))}</em></button>`).join('')}</div>
        <div class="w-f"><div class="w-chips">${M.cfg.bets.map((v) => `<button class="wc ${v === bet ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div><span class="w-note">越早押越高 · 押错不出局</span></div>`
      win.querySelectorAll('.wc').forEach((b) => (b.onclick = () => { bet = +b.dataset.v; win.querySelectorAll('.wc').forEach((x) => x.classList.toggle('on', x === b)) }))
      win.querySelectorAll('.wo').forEach((b) => (b.onclick = async () => {
        if (placed) return; placed = 'pending'; b.classList.add('on'); SFX.pick()
        try {
          const r = await api(`/api/combo/${sid}/runs/${S.run.run_id}/bet`, { body: { k, opt: b.dataset.id, bet } })
          placed = r; S.bets.push({ k, label: r.label, odds: r.odds, bet: r.bet })
          win.classList.add('placed'); win.querySelector('.w-f').innerHTML = `<span class="w-done"><i class="fas fa-check"></i> 已追加 ${fmt(r.bet)} · ${esc(r.label)} · 锁定 ${xm(r.odds)}</span>`
          liveSide()
        } catch (e) { placed = null; b.classList.remove('on'); toast(e.message); if (e.code === 'INSUFFICIENT') win.querySelector('.w-f').insertAdjacentHTML('beforeend', '<small class="w-err">余额不足</small>') }
      }))
      let lastSec = 7
      clearInterval(wTimer); wTimer = setInterval(() => {
        const left = Math.max(0, closeAt - Date.now()), f = left / W
        const el = $('#w-left'); if (!el) return
        el.textContent = (left / 1000).toFixed(1) + 's'; $('#w-bar').style.width = Math.max(0, Math.min(100, f * 100)) + '%'
        if (!placed) win.querySelectorAll('[data-o]').forEach((e) => (e.textContent = xm(odds(+e.dataset.o))))
        const sec = Math.ceil(left / 1000); if (sec < lastSec && sec <= 3 && sec > 0) SFX.tick(); lastSec = sec
        win.classList.toggle('hurry', left < 2000)
        if (left <= 0) { win.classList.add('locked'); clearInterval(wTimer) }
      }, 100)
      RT.window = { k, pick: (i) => win.querySelectorAll('.wo')[i]?.click() }
    }
    function closeWindow() { clearInterval(wTimer); stage.classList.remove('win-open'); win.classList.add('closing'); setTimeout(() => (win.className = 'cb-window hidden'), 350); RT.window = null }

    // ─────────── 结局 ───────────
    async function finale() {
      const r = S.res
      caption(r.ending.twist ? `<small>🃏 反转牌</small><b>${esc(r.ending.twist.label)}</b>` : `<small>结局</small><b>${esc(r.ending.name)}</b>`, r.ending.twist ? 'twist' : 'ending')
      if (r.ending.twist) { SFX.stamp(); stamp.innerHTML = `<div class="st twist"><small>🃏 反转牌</small><b>${esc(r.ending.twist.label)}</b></div>`; stamp.classList.add('go'); setTimeout(() => stamp.classList.remove('go'), 2400) }
      const p = playClip(r.ending.clip, (t) => drawTimeline('end', t)); await p.ended
      drawTimeline('over', 0)
      const s = r.slip; s.hits >= 2 || r.twist_bet?.hit ? SFX.win() : SFX.lose()
      modal.innerHTML = `<div class="f-card cb-card ${s.hits === 3 ? 'perfect' : ''}">
        <div class="k">${r.ending.twist ? '🃏 反转结局' : '本局结局'}</div>
        <h3 class="end-name">${esc(r.ending.name)}</h3><p class="end-word">${esc(r.ending.word)}</p>
        <div class="slip-end">${s.rows.map((x) => `<div class="${x.hit ? 'hit' : 'miss'}"><span>${esc(x.title)}</span><em>${esc(x.pick_label)}</em><b>${x.hit ? '✓' : '✕'} ${esc(x.actual_label)}</b></div>`).join('')}</div>
        <div class="kv"><span>押注单 · 中 ${s.hits}/3</span><b>${fmt(s.stake)} → ${fmt(s.payout)}${s.mult ? ` (${xm(s.mult)})` : ''}</b>
          ${r.side_total.staked ? `<span>片中追加</span><b>${fmt(r.side_total.staked)} → ${fmt(r.side_total.paid)}</b>` : ''}
          ${r.twist_bet ? `<span>反转牌</span><b class="${r.twist_bet.hit ? 'up' : 'down'}">${r.twist_bet.hit ? '+' + fmt(r.twist_bet.payout) : '-' + fmt(r.twist_bet.stake)}</b>` : ''}
          <span>本局净额</span><b class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
        <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><p>${esc(r.verify.recipe)}</p><a href="/api/combo/${sid}/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details>
        <div class="acts"><button class="btn" id="again"><i class="fas fa-rotate-right"></i> 再押一单</button><button class="btn ghost" id="share"><i class="fas fa-share-nodes"></i> 晒结局</button><a class="btn ghost" href="/fun">换一部</a></div></div>`
      modal.classList.remove('hidden')
      $('#again').onclick = async () => { modal.classList.add('hidden'); M = await api(`/api/combo/${sid}/meta`); Object.assign(S, { run: null, res: null, bets: [], reveals: [], known: [], live: null, next: null, quote: null }); stage.classList.remove('film'); V.forEach((v) => { v.pause(); v.removeAttribute('src'); v.dataset.key = '' }); lobby() }
      $('#share').onclick = () => share(r)
      RT.done = r
    }
    async function share(r) {
      const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), C = M.color
      try { const v = front(); if (v.videoWidth) g.drawImage(v, 0, 0, W, H) } catch {}
      let gr = g.createLinearGradient(0, H * 0.35, 0, H); gr.addColorStop(0, 'rgba(20,12,8,0)'); gr.addColorStop(0.35, 'rgba(20,12,8,.85)'); gr.addColorStop(1, 'rgba(20,12,8,.97)'); g.fillStyle = gr; g.fillRect(0, 0, W, H)
      const F = '"PingFang SC","Noto Sans CJK SC",sans-serif'; g.textBaseline = 'top'
      g.fillStyle = C; g.fillRect(64, 72, 250, 64); g.fillStyle = '#fff'; g.font = `800 32px ${F}`; g.fillText('开心1分钟', 92, 86)
      g.font = `900 88px ${F}`; g.fillText(M.title, 64, 170)
      g.fillStyle = '#ffd23f'; g.font = `900 104px ${F}`; g.fillText(r.ending.name.slice(0, 9), 64, 820)
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `600 42px ${F}`; g.fillText(r.ending.word, 64, 960)
      let y = 1060
      for (const x of r.slip.rows) { g.fillStyle = x.hit ? '#2ecc71' : '#ff5470'; g.font = `900 48px ${F}`; g.fillText(x.hit ? '✓' : '✕', 64, y); g.fillStyle = '#fff'; g.font = `700 40px ${F}`; g.fillText(`${x.title}  押 ${x.pick_label}  → ${x.actual_label}`, 130, y + 4); y += 84 }
      g.fillStyle = r.net >= 0 ? '#2ecc71' : '#ff5470'; g.font = `900 64px ${F}`; g.fillText(`中 ${r.slip.hits}/3 · 本局 ${r.net >= 0 ? '+' : ''}${fmt(r.net)}`, 64, y + 30)
      g.fillStyle = C; g.fillRect(64, H - 220, W - 128, 140); g.fillStyle = '#fff'; g.font = `900 48px ${F}`; g.fillText('70 种结局，你能押中几条？', 104, H - 196); g.font = `600 28px ${F}`; g.fillText(location.host + location.pathname, 104, H - 130)
      let url; try { url = c.toDataURL('image/jpeg', 0.9) } catch { toast('当前浏览器不支持截图，已复制文案'); navigator.clipboard?.writeText(`我在《${M.title}》押出了「${r.ending.name}」！${location.href}`); return }
      const ov = document.createElement('div'); ov.className = 'f-share'
      ov.innerHTML = `<div class="pp"><img src="${url}" alt="结局海报"><div class="acts"><a class="btn" download="${M.title}-${r.ending.name}.jpg" href="${url}"><i class="fas fa-download"></i> 保存海报</a><button class="btn ghost" id="pcl">关闭</button></div></div>`
      document.body.appendChild(ov); ov.onclick = (e) => { if (e.target === ov) ov.remove() }; $('#pcl').onclick = () => ov.remove()
    }

    try { M = await api(`/api/combo/${sid}/meta`) } catch (e) { side.innerHTML = `<div class="f-empty">${esc(e.message)}</div>`; return }
    stage.style.setProperty('--c', M.color); document.body.style.setProperty('--c', M.color)
    if (!M.media) { side.innerHTML = `<div class="f-empty">《${esc(M.title)}》拍摄中，敬请期待</div>`; return }
    lobby()
  }
})()
