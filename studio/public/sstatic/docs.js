// MoMo Studio · 第 4 步剧本描述 / 第 5 步提示词 + 连贯监管（节点级工作台）
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TI = { scene: '🎬', choice: '🎲', merge: '🔀', loop: '⏳', ending: '🏁' }
  const SS = { ok: ['通过', '#3ddc97'], error: ['有错误', '#ff5d73'], conflict: ['连贯冲突', '#ff8a5d'], missing: ['未生成', '#6b7280'], stale: ['上游已变·需重写', '#f5a524'], waiting: ['等待上游', '#4b5563'] }
  const pill = (s) => `<span class="pill" style="--c:${(SS[s] || ['', '#888'])[1]}">${(SS[s] || [s])[0]}</span>`

  function mount(root, o) {
    const kind = o.step === 4 ? 'scripts' : 'prompts'
    const st = { list: null, sel: null, detail: null, filter: 'all', running: false, stop: false }
    const ro = o.readonly
    const base = `/api/projects/${o.pid}/${kind}`

    async function load(keepSel) {
      try { st.list = await o.api(base) } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
      if (!keepSel || !st.list.nodes.some((n) => n.id === st.sel)) st.sel = (st.list.nodes.find((n) => n.state !== 'ok' && n.state !== 'waiting') || st.list.nodes[0])?.id
      render(); if (st.sel) pick(st.sel)
    }
    function summaryBar() {
      const s = st.list.summary, pct = s.total ? Math.round((s.ok / s.total) * 100) : 0
      const bits = o.step === 4 ? [['ok', s.ok], ['error', s.error], ['stale', s.stale], ['missing', s.missing], ['waiting', s.waiting]] : [['ok', s.ok], ['conflict', s.conflict], ['error', s.error], ['stale', s.stale], ['missing', s.missing]]
      return `<div class="dw-sum"><div class="dw-bar"><i style="width:${pct}%"></i></div><b>${s.ok}/${s.total}</b> 节点通过 ${bits.filter(([, n]) => n).map(([k, n]) => `<a href="#" data-flt="${k}" class="${st.filter === k ? 'on' : ''}">${pill(k)} ${n}</a>`).join(' ')} <a href="#" data-flt="all" class="${st.filter === 'all' ? 'on' : ''}">全部</a>
        ${o.step === 5 ? `<span class="mut sm">· 视频模式：参考图 ${s.reference} / 尾帧接力 ${s.frames}</span>` : ''}</div>`
    }
    function render() {
      const s = st.list.summary, todo = o.step === 4 ? s.missing + s.stale : s.missing + s.stale, bad = o.step === 4 ? s.error : s.conflict + s.error
      const nodes = st.list.nodes.filter((n) => st.filter === 'all' || n.state === st.filter)
      root.innerHTML = `<div class="dw">
        <div class="dw-top">${summaryBar()}<span class="ge-grow"></span>
          ${ro ? '' : `<button class="btn sm pri" data-gen ${todo ? '' : 'disabled'}><i class="fas fa-wand-magic-sparkles"></i> ${o.step === 4 ? '编剧 Agent 生成' : '提示词 + 连贯监管'}（${todo}）</button>
          <button class="btn sm" data-fix ${bad ? '' : 'disabled'}><i class="fas fa-screwdriver-wrench"></i> 重写问题节点（${bad}）</button>`}
          <span class="dw-prog mut sm"></span></div>
        <div class="dw-main"><nav class="dw-list">${nodes.map((n) => `<a href="#" data-n="${n.id}" class="${n.id === st.sel ? 'on' : ''}" style="padding-left:${10 + Math.min(n.level, 8) * 6}px"><span>${TI[n.type] || ''} ${esc(n.title)}</span>${n.mode ? `<i class="mode ${n.mode}" title="${esc(n.why)}">${n.mode === 'frames' ? '尾帧' : '参考'}</i>` : ''}${n.edited ? '<i class="mode man" title="人工编辑">人工</i>' : ''}${pill(n.state)}</a>`).join('') || '<p class="mut sm" style="padding:10px">没有符合的节点</p>'}</nav>
        <section class="dw-detail"><p class="mut">选择左侧节点</p></section></div></div>`
    }
    async function pick(id) {
      st.sel = id; root.querySelectorAll('.dw-list a').forEach((a) => a.classList.toggle('on', a.dataset.n === id))
      const box = $('.dw-detail', root); box.innerHTML = '<p class="mut"><i class="fas fa-spinner fa-spin"></i></p>'
      try { st.detail = await o.api(`${base}/${encodeURIComponent(id)}`) } catch (e) { box.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
      box.innerHTML = o.step === 4 ? scriptDetail(st.detail) : promptDetail(st.detail)
    }
    const issuesHtml = (is) => (is?.length ? is.map((i) => `<div class="ge-is ${i.level}">${i.level === 'error' ? '⛔' : '⚠️'} ${esc(i.msg)}</div>`).join('') : '')

    function scriptDetail(d) {
      const v = d.view, doc = d.doc || { summary: '', beats: [], cast: [], requires: [], sets: [] }, dis = ro || v.state === 'waiting' ? 'disabled' : ''
      const facts = (a) => (a || []).map((f) => `${f.key}=${f.value ?? 'null'}`).join('\n')
      return `<div class="dw-h"><h3>${TI[d.node.type]} ${esc(d.node.title)} <span class="mut sm">${esc(d.node.id)} · v${v.version}</span></h3>${pill(v.state)}</div>
        <p class="sub">${esc(d.node.beat || '')}${d.node.question ? `<br>🎲 ${esc(d.node.question)}` : ''}</p>
        <div class="dw-ctx"><div><b>来路</b>${d.incoming.map((x) => `<div class="sm">← ${esc(x.from_title)}${x.label ? ` <span class="chip">${esc(x.label)}</span>` : ''}</div>`).join('') || '<div class="sm mut">起点</div>'}</div>
          <div><b>去向</b>${d.outgoing.map((x) => `<div class="sm">${x.kind === 'back' ? '↶' : '→'} ${esc(x.to_title)}${x.label ? ` <span class="chip">${esc(x.label)}</span>` : ''}</div>`).join('') || '<div class="sm mut">结局</div>'}</div></div>
        ${v.state === 'waiting' ? '<div class="banner warn">上游节点的剧本还没完成：剧情账本无法确定，本节点暂不能编写。</div>' : ''}
        ${v.state === 'stale' ? '<div class="banner warn">上游剧情或结构已变化，这段剧本需要重写（或打开后直接保存确认）。</div>' : ''}
        ${issuesHtml(v.issues)}
        <details class="dw-ledger" ${v.issues?.some((i) => i.code?.startsWith?.('LEDGER')) ? 'open' : ''}><summary>📒 入场剧情账本</summary><pre>${esc(d.ledger)}</pre></details>
        <form id="dwf" class="grid g2">
          <label class="f" style="grid-column:1/-1">概要<input class="inp" name="summary" value="${esc(doc.summary)}" ${dis}></label>
          <label class="f">地点（英文）<input class="inp" name="location" value="${esc(doc.location || '')}" ${dis}></label>
          <label class="f">时间（英文）<input class="inp" name="time" value="${esc(doc.time || '')}" ${dis}></label>
          <label class="f">情绪<input class="inp" name="mood" value="${esc(doc.mood || '')}" ${dis}></label>
          <label class="f">时长（秒）<select class="inp" name="duration" ${dis}>${[5, 8, 10].map((x) => `<option ${+doc.duration === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="f" style="grid-column:1/-1">出场角色 id（逗号分隔）<input class="inp" name="cast" value="${esc((doc.cast || []).join(', '))}" ${dis}></label>
          <label class="f" style="grid-column:1/-1">节拍（每行：角色id | 动作 | 台词）<textarea class="inp" name="beats" rows="4" ${dis}>${esc((doc.beats || []).map((b) => [b.who || '', b.action, b.line || ''].join(' | ')).join('\n'))}</textarea></label>
          <label class="f" style="grid-column:1/-1">结尾画面 / 悬念<input class="inp" name="cliff" value="${esc(doc.cliff || '')}" ${dis}></label>
          <label class="f">依赖的事实 requires（每行 key=value）<textarea class="inp code" name="requires" rows="4" ${dis}>${esc(facts(doc.requires))}</textarea></label>
          <label class="f">改变的事实 sets（value 写 null 表示移除）<textarea class="inp code" name="sets" rows="4" ${dis}>${esc(facts(doc.sets))}</textarea></label>
        </form><p class="mut sm">${esc(d.key_help)}</p>
        ${ro || v.state === 'waiting' ? '' : `<div class="ge-row"><button class="btn sm" data-save><i class="fas fa-floppy-disk"></i> 保存（人工确认）</button><button class="btn sm pri" data-regen><i class="fas fa-rotate"></i> 让 Agent 重写这一段</button></div>`}`
    }
    function collectScript() {
      const f = Object.fromEntries(new FormData($('#dwf', root)))
      const facts = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); const k = (i < 0 ? l : l.slice(0, i)).trim(), v = i < 0 ? null : l.slice(i + 1).trim(); return { key: k, value: v === 'null' || v === '' ? null : v } })
      return { summary: f.summary, location: f.location, time: f.time, mood: f.mood, duration: +f.duration, cliff: f.cliff, cast: String(f.cast).split(/[,，\s]+/).filter(Boolean),
        beats: String(f.beats).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.join('')).map(([who, action, line]) => (action === undefined ? { action: who } : { who: who || undefined, action, line })), requires: facts(f.requires), sets: facts(f.sets) }
    }

    function promptDetail(d) {
      const v = d.view, doc = d.doc, s = d.script, dis = ro ? 'disabled' : ''
      return `<div class="dw-h"><h3>${TI[d.node.type]} ${esc(d.node.title)} <span class="mut sm">${esc(d.node.id)} · v${v.version}</span></h3>${pill(v.state)}</div>
        <div class="dw-mode"><b>${v.mode === 'frames' ? '🎞 尾帧接力' : '🖼 参考图模式'}</b> <span class="mut sm">${esc(v.why)}</span></div>
        ${v.conflicts?.length ? `<div class="dw-conf"><h4>🚨 连贯监管 Agent 打回（${v.conflicts.length}）</h4>${v.conflicts.map((c) => `<div class="ge-is error"><b>[${esc(c.type)}]</b> ${esc(c.detail)}${c.fix ? `<div class="mut sm">建议：${esc(c.fix)}</div>` : ''}</div>`).join('')}</div>` : ''}
        ${issuesHtml(v.issues)}
        ${v.state === 'stale' ? '<div class="banner warn">剧本或账本已变化，提示词需要重新生成。</div>' : ''}
        <details class="dw-ledger"><summary>📜 剧本</summary><pre>${esc(`${s.summary}\n地点 ${s.location || '-'} · 时间 ${s.time || '-'} · ${s.duration}s\n${s.beats.map((b) => `· ${b.who ? b.who + '：' : ''}${b.action}${b.line ? ` 「${b.line}」` : ''}`).join('\n')}\n结尾：${s.cliff || ''}`)}</pre></details>
        <details class="dw-ledger"><summary>📒 剧情账本</summary><pre>${esc(d.ledger)}</pre></details>
        ${doc ? `<label class="f">视频提示词（英文，可人工修改）<textarea class="inp code" id="dwp" rows="7" ${dis}>${esc(doc.prompt)}</textarea></label>
          <label class="f">连贯性附录（由账本确定性生成，不可改）<textarea class="inp code" rows="3" disabled>${esc(doc.appendix)}</textarea></label>
          <label class="f">负面提示词<input class="inp" id="dwn" value="${esc(doc.negative || '')}" ${dis}></label>
          ${doc.shots?.length ? `<div class="sm"><b>分镜</b>${doc.shots.map((x, i) => `<div class="mut">${i + 1}. [${esc(x.camera)}] ${esc(x.visual)}</div>`).join('')}</div>` : ''}
          ${doc.dialogue?.length ? `<div class="sm" style="margin-top:6px"><b>台词</b>${doc.dialogue.map((x) => `<div>${esc(x.who)}：「${esc(x.line)}」</div>`).join('')}</div>` : ''}` : '<p class="mut">尚未生成</p>'}
        ${ro ? '' : `<div class="ge-row" style="margin-top:10px">${doc ? `<button class="btn sm" data-psave><i class="fas fa-check"></i> 人工确认 / 保存修改</button>` : ''}<button class="btn sm pri" data-regen><i class="fas fa-rotate"></i> 重新生成 + 监管</button></div>`}`
    }

    async function runLoop(body) {
      if (st.running) return
      st.running = true; st.stop = false
      const prog = $('.dw-prog', root), tot = { done: 0, failed: 0 }
      root.querySelectorAll('[data-gen],[data-fix],[data-regen]').forEach((b) => (b.disabled = true))
      try {
        for (let i = 0; i < 200 && !st.stop; i++) {
          if (prog) prog.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 第 ${i + 1} 批… 已完成 ${tot.done}${tot.failed ? `，失败 ${tot.failed}` : ''} <a href="#" data-stop>停止</a>`
          const r = await o.api(`/api/projects/${o.pid}/${kind}-run`, body)
          tot.done += r.done.length; tot.failed += r.failed.length
          if (r.failed.length) o.toast(`${r.failed.length} 个节点失败：${r.failed[0].error}`)
          if (!r.more || (!r.done.length && !r.failed.length) || body.only || body.errors) break
          if (r.failed.length && !r.done.length) break
        }
        o.toast(`完成 ${tot.done} 个节点${tot.failed ? `，失败 ${tot.failed}` : ''}`)
      } catch (e) { o.toast(e.message) } finally { st.running = false; await load(true); o.onChange?.() }
    }

    root.addEventListener('click', async (ev) => {
      const t = ev.target.closest('a,button'); if (!t) return
      if (t.dataset.n) { ev.preventDefault(); return pick(t.dataset.n) }
      if (t.dataset.flt) { ev.preventDefault(); st.filter = t.dataset.flt; render(); if (st.sel) pick(st.sel); return }
      if (t.hasAttribute('data-stop')) { ev.preventDefault(); st.stop = true; t.textContent = '正在停止…'; return }
      if (t.hasAttribute('data-gen')) return runLoop({})
      if (t.hasAttribute('data-fix')) return runLoop({ errors: true, force: true })
      if (t.hasAttribute('data-regen')) return runLoop({ only: [st.sel], force: true })
      if (t.hasAttribute('data-save')) { try { const r = await o.api(`${base}/${encodeURIComponent(st.sel)}`, { doc: collectScript() }); o.toast(r.ok ? '已保存，连贯检查通过' : `已保存，但还有 ${r.issues.filter((i) => i.level === 'error').length} 个错误`); await load(true); o.onChange?.() } catch (e) { o.toast(e.message) } }
      if (t.hasAttribute('data-psave')) { try { await o.api(`${base}/${encodeURIComponent(st.sel)}`, { doc: { prompt: $('#dwp', root).value, negative: $('#dwn', root).value } }); o.toast('已人工确认'); await load(true); o.onChange?.() } catch (e) { o.toast(e.message) } }
    })
    load()
    return { reload: () => load(true) }
  }
  window.DocsWorkbench = { mount }
})()
