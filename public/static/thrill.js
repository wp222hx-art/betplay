// 惊心 1 分钟 · 前端：板块页 ThrillHub() + 播放页 ThrillPlay(sid)
// 规则在 UI 层的落实：无暂停 / 无进度条 / 无回看 / 无悔棋；每关抉择窗口由服务端计时，前端倒计时只是展示
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')
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
      box.innerHTML = items.map((it, i) => `
        <a class="thrill-card" href="${it.url}" id="thrill-card-${esc(it.id)}">
          <div class="cover" style="background-image:url('${esc(it.cover || '')}')"><span class="rank">#${i + 1}</span>${it.demo ? '<span class="demo">架构演示</span>' : ''}</div>
          <div class="info">
            <div class="tension" title="紧张度">${flame(it.tension)}</div>
            <h3>${esc(it.title)}</h3><p>${esc(it.logline)}</p>
            <div class="ladder">${it.ladder.map((m, k) => `<b>关${k + 1}<i>×${m}</i><s>${it.arity[k]}选1</s></b>`).join('')}</div>
            <div class="foot"><span class="pool"><i class="fas fa-sack-dollar"></i> 奖池 ${fmt(it.pool)}</span><span><i class="fas fa-play"></i> ${fmt(it.plays)} 局 · 全中 ${it.perfect}</span><span>Jackpot 1/${it.jackpot_odds}</span></div>
          </div>
        </a>`).join('')
    } catch (e) { box.innerHTML = `<div class="t-empty">${esc(e.message)}</div>` }
  }

  // ─────────────── 播放页 ───────────────
  window.ThrillPlay = async function (sid) {
    const API = `/api/thrill/${sid}`
    const side = $('#thrill-side'), gateEl = $('#thrill-gate'), hud = $('#thrill-hud'), lines = $('#thrill-lines')
    const video = $('#thrill-video'), poster = $('#thrill-poster'), flash = $('#thrill-flash'), modal = $('#thrill-modal')
    const S = { meta: null, run: null, stake: 0, streak: 0, hits: 0, won: 0, gate: null, log: [], playing: false }
    // 禁止暂停 / 拖动：视频不给控件，任何暂停都会被立即恢复
    video.controls = false; video.disablePictureInPicture = true
    video.addEventListener('pause', () => { if (S.playing && !video.ended) video.play().catch(() => {}) })
    video.addEventListener('contextmenu', (e) => e.preventDefault())

    try { S.meta = await api(`${API}/meta`) } catch (e) { side.innerHTML = `<div class="t-empty">${esc(e.message)}</div>`; return }
    const M = S.meta
    S.stake = M.cfg.stakes[0]
    renderHud()
    lobby()
    if (M.open_run) { const r = await api(`${API}/resume`).catch(() => null); if (r?.run) return resume(r.run) }

    function renderHud() {
      const L = S.run?.ladder || M.cfg.ladder
      const next = S.streak < L.length ? L[S.streak] : L[L.length - 1]
      hud.innerHTML = `
        <div class="h-ladder">${L.map((m, i) => `<span class="${i < S.streak ? 'lit' : i === S.streak && S.run ? 'next' : ''}">×${m}</span>`).join('')}<span class="jp ${S.streak >= 5 ? 'lit' : ''}">JP</span></div>
        <div class="h-pool"><i class="fas fa-sack-dollar"></i> <b id="pool-n">${fmt(M.pool)}</b></div>
        ${S.run ? `<div class="h-stat">连中 <b>${S.streak}</b> · 下一关命中 <b class="gold">×${next}</b> · 已赢 <b class="coin">${fmt(S.won)}</b></div>` : ''}`
    }

    function lobby() {
      poster.src = '/static/film/F_P.webp'
      side.innerHTML = `
        <div class="s-title"><div class="tension">${flame(M.series.tension || 3)}</div><h2>${esc(M.series.title)}</h2><p>${esc(M.series.logline)}</p>${M.demo ? '<div class="demo-tip"><i class="fas fa-flask"></i> 架构演示：占位画面，正式剧集制作中</div>' : ''}</div>
        <div class="s-block"><h4>阶梯赔率（连续命中）</h4><div class="ladder-big">${M.cfg.ladder.map((m, i) => `<div><b>×${m}</b><span>第${i + 1}关 · ${M.gates[i].arity}选1</span></div>`).join('')}<div class="jp"><b>Jackpot</b><span>5 关全中瓜分奖池 ${Math.round(M.cfg.jackpot_share * 100)}%</span></div></div>
          <p class="note">未命中连击清零，本关注金归庄；超时视为弃权（注金退回、连击清零）</p></div>
        <div class="s-block"><h4>每关注金</h4><div class="stakes">${M.cfg.stakes.map((v) => `<button class="stake ${v === S.stake ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
          <p class="note">开局一次性托管 <b id="tot">${S.stake * 5}</b>（${S.stake} × 5 关），之后不能撤注、不能暂停、不能悔棋</p></div>
        <button id="thrill-start" class="btn gold big"><i class="fas fa-bolt"></i> 开演 · 60 秒不停</button>
        <div class="s-block stats"><span>已开 ${fmt(M.stats.plays)} 局</span><span>全中 ${M.stats.perfect} 次</span><span>最高 JP ${fmt(M.stats.top_jackpot)}</span><span>全中概率 1/${M.jackpot_odds}</span></div>
        <div class="s-block recent"><h4>实时战报</h4>${M.recent.length ? M.recent.map((r) => `<div>${esc(r.who)} <b>${r.hits}/5</b> ${r.jackpot ? `<em>JP +${fmt(r.jackpot)}</em>` : `+${fmt(r.payout)}`}</div>`).join('') : '<div class="mut">还没有人挑战，第一个全中的就是你</div>'}</div>`
      side.querySelectorAll('.stake').forEach((b) => (b.onclick = () => { S.stake = +b.dataset.v; side.querySelectorAll('.stake').forEach((x) => x.classList.toggle('on', x === b)); $('#tot').textContent = S.stake * 5 }))
      $('#thrill-start').onclick = start
    }

    function liveSide() {
      side.innerHTML = `<div class="s-title"><h2>${esc(M.series.title)}</h2><p class="mut">一口气演完 · 不可暂停 · 不可回看</p></div>
        <div class="s-block"><h4>本局</h4><div class="run-kv"><span>每关注金</span><b>${S.run.stake}</b><span>托管</span><b>${S.run.stake * 5}</b><span>承诺哈希</span><code title="${S.run.commit}">${S.run.commit.slice(0, 16)}…</code></div></div>
        <div class="s-block"><h4>关卡</h4><ol id="gate-log" class="gate-log">${M.gates.map((g, i) => `<li id="gl-${i + 1}" class="${S.log[i] ? (S.log[i].hit ? 'hit' : 'miss') : ''}"><span>第${i + 1}关</span><em>${S.log[i] ? esc(S.log[i].label) : '…'}</em><b>${S.log[i] ? (S.log[i].hit ? '+' + fmt(S.log[i].payout) : S.log[i].timeout ? '弃权' : '未中') : ''}</b></li>`).join('')}</ol></div>`
    }

    async function start() {
      const btn = $('#thrill-start'); btn.disabled = true; btn.textContent = '锁定 5 关结果中…'
      try {
        const r = await api(`${API}/start`, { body: { stake: S.stake } })
        S.run = r; S.streak = 0; S.hits = 0; S.won = 0; S.log = []; M.pool = r.pool
        liveSide(); renderHud()
        S.playing = true
        await playSeg(r.prologue, { kicker: '序章' })
        await runGate(r.gate)
      } catch (e) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> 开演 · 60 秒不停'; toast(e.message); btn.insertAdjacentHTML('afterend', `<p class="note err">${esc(e.message)}</p>`) }
    }
    async function resume(run) {
      S.run = run; S.streak = run.streak; S.hits = run.hits; S.won = run.payout; S.log = []
      liveSide(); renderHud(); S.playing = true
      toast('上一局还没演完，继续往下（已揭晓的关不能回看）')
      await runGate(run.gate)
    }

    // 播放一个片段（有视频播视频，否则海报 + 台词按时长推进）
    async function playSeg(seg, o = {}) {
      if (!seg) return
      lines.innerHTML = o.kicker ? `<div class="kicker">${esc(o.kicker)}</div><div class="seg-t">${esc(seg.title)}</div>` : `<div class="seg-t">${esc(seg.title)}</div>`
      const dur = Math.max(2, Math.min(12, seg.dur || 5))
      if (seg.video) {
        poster.src = seg.poster || poster.src
        video.src = seg.video; video.classList.add('on'); video.muted = false
        const done = new Promise((res) => { video.onended = res; setTimeout(res, (dur + 4) * 1000) })
        try { await video.play() } catch { video.muted = true; await video.play().catch(() => {}) }
        showLines(seg.lines, dur)
        await done
      } else {
        video.classList.remove('on'); video.removeAttribute('src')
        if (seg.poster) poster.src = seg.poster
        poster.classList.remove('kb'); void poster.offsetWidth; poster.classList.add('kb')
        showLines(seg.lines, dur)
        await sleep(dur * 1000)
      }
    }
    function showLines(ls = [], dur) {
      if (!ls.length) return
      const step = (dur * 1000) / ls.length
      ls.forEach((t, i) => setTimeout(() => { const d = document.createElement('div'); d.className = 'line'; d.textContent = t; lines.appendChild(d); while (lines.children.length > 4) lines.children[1]?.remove() }, i * step))
    }

    // 一关：情境 → 激活服务端计时 → 抉择（只能点一次）→ 揭晓 → 结果片段
    async function runGate(g) {
      S.gate = g; renderHud()
      const L = S.run.ladder, mult = L[Math.min(S.streak, L.length - 1)]
      gateEl.innerHTML = `
        <div class="g-head"><span class="g-no">第 ${g.no} / 5 关 · ${esc(g.title)}</span><span class="g-mult">命中 ×${mult}${g.no === 5 && S.streak === 4 ? ' + <b>JACKPOT</b>' : ''}</span></div>
        <div class="g-q">${esc(g.question)}</div>
        <div class="g-opts">${g.options.map((o, i) => `<button class="g-opt" data-id="${esc(o.id)}"><i>${'ABC'[i]}</i><span>${esc(o.label)}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('')}</div>
        <div class="g-timer"><div id="g-bar"></div><b id="g-sec"></b></div>
        <div class="g-foot">${g.options.length} 选 1 · 结果开局已锁定 · 选定即锁盘，不可更改</div>`
      gateEl.classList.remove('hidden', 'locked'); gateEl.classList.add('in')
      let picked = null, sent = false
      const arm = await api(`${API}/runs/${S.run.run_id}/arm`, { body: {} })
      const skew = Date.now() - arm.server_time
      const lockAt = arm.lock_at + skew - 800 // 前端提前 0.8 秒锁盘（服务端留了网络余量）
      const total = lockAt - Date.now()
      const submit = async () => {
        if (sent) return; sent = true; clearInterval(tm)
        gateEl.classList.add('locked')
        gateEl.querySelectorAll('.g-opt').forEach((b) => (b.disabled = true))
        $('#g-sec').textContent = picked ? '已锁盘' : '超时弃权'
        try { await reveal(g, picked) } catch (e) { toast(e.message); if (e.code === 'RUN_ENDED' || e.code === 'DUPLICATE') location.reload() }
      }
      gateEl.querySelectorAll('.g-opt').forEach((b) => (b.onclick = () => { if (sent) return; picked = b.dataset.id; b.classList.add('on'); submit() }))
      const tm = setInterval(() => {
        const left = lockAt - Date.now()
        $('#g-bar').style.width = Math.max(0, (left / total) * 100) + '%'
        $('#g-sec').textContent = Math.max(0, Math.ceil(left / 1000)) + 's'
        gateEl.classList.toggle('hot', left < 3000)
        if (left <= 0) submit()
      }, 100)
    }

    async function reveal(g, picked) {
      const r = await api(`${API}/runs/${S.run.run_id}/pick`, { body: { gate: g.no, option_id: picked } })
      const seg = r.reveal.key ? await decrypt(g.encrypted[r.reveal.slot], r.reveal.key) : null
      gateEl.querySelectorAll('.g-opt').forEach((b) => { if (b.dataset.id === r.reveal.outcome_id) b.classList.add('win'); else if (b.dataset.id === picked) b.classList.add('lose') })
      S.streak = r.streak; S.hits += r.hit ? 1 : 0; if (r.hit) S.won += r.payout
      S.log[g.no - 1] = { label: r.reveal.label, hit: r.hit, payout: r.payout, timeout: r.timeout }
      boom(r.hit ? `命中 ×${r.mult}<small>+${fmt(r.payout)}</small>` : r.timeout ? '弃权<small>注金已退回</small>' : '未中<small>连击清零</small>', r.hit ? 'hit' : 'miss')
      await sleep(1100)
      gateEl.classList.add('hidden'); gateEl.classList.remove('in')
      renderHud(); liveSide()
      await playSeg(seg)
      if (r.next) return runGate(r.next)
      S.playing = false
      if (r.ending) await playSeg(r.ending, { kicker: '结局' })
      end(r)
    }

    function boom(html, cls) { flash.className = 't-flash ' + cls; flash.innerHTML = `<div>${html}</div>`; void flash.offsetWidth; flash.classList.add('go') }

    function end(r) {
      M.pool = r.pool; renderHud()
      const net = r.total_payout - r.staked
      modal.innerHTML = `<div class="t-card ${r.hits === 5 ? 'perfect' : ''}">
        <div class="k">${r.hits === 5 ? 'JACKPOT · 五关全中' : '本局落幕'}</div>
        <div class="hits">${[0, 1, 2, 3, 4].map((i) => `<span class="${S.log[i]?.hit ? 'hit' : 'miss'}">${i + 1}</span>`).join('')}</div>
        <div class="big">${r.hits}<small>/5</small></div>
        <div class="kv"><span>托管注金</span><b>${fmt(r.staked)}</b><span>阶梯赔付</span><b>${fmt(r.total_payout - (r.jackpot_status === 'paid' ? r.jackpot : 0))}</b>
          ${r.jackpot ? `<span>Jackpot</span><b class="coin">${fmt(r.jackpot)}${r.jackpot_status === 'held' ? '（风控审核中）' : ''}</b>` : ''}
          <span>本局净额</span><b class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${fmt(net)}</b><span>余额</span><b>${fmt(r.balance)}</b></div>
        ${r.hold_reason ? `<p class="note">审核原因：${esc(r.hold_reason)}。奖金已冻结在独立账户，审核通过后到账。</p>` : ''}
        <details class="verify"><summary><i class="fas fa-shield-halved"></i> 公平性验证</summary><code>seed: ${esc(r.verify.seed)}</code><code>commit: ${esc(r.verify.commit)}</code><code>outcomes: ${esc(r.verify.outcomes.join(' → '))}</code><p>${esc(r.verify.formula)}</p><a href="${API}/runs/${S.run.run_id}/verify" target="_blank">服务端复算 →</a></details>
        <div class="acts"><button class="btn gold" id="again"><i class="fas fa-rotate-right"></i> 再来一局</button><a class="btn" href="/thrill">回板块</a></div></div>`
      modal.classList.remove('hidden')
      $('#again').onclick = async () => { modal.classList.add('hidden'); S.run = null; S.streak = 0; S.won = 0; S.log = []; S.meta = await api(`${API}/meta`); Object.assign(M, S.meta); renderHud(); lobby() }
    }

    function toast(m) { const t = document.createElement('div'); t.className = 't-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) }
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.playing) toast('剧情不会因切走而暂停：抉择窗口到时自动弃权') })
  }
})()
