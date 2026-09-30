// MoMo Studio · 第 6–9 步素材工作台（设定图 / 主线视频 / 分支视频 / 一致性检测），移动端友好
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const SS = { pending: ['未开始', '#6b7280'], stale: ['上游已变·需重拍', '#f5a524'], blocked: ['等待依赖', '#4b5563'], queued: ['排队中', '#8b8fff'], running: ['生成中', '#f5a524'], post: ['后处理', '#38bdf8'], checking: ['质检中', '#c084fc'], ok: ['通过', '#3ddc97'], qc_fail: ['质检不合格', '#ff8a5d'], failed: ['失败', '#ff5d73'] }
  const pill = (s) => `<span class="pill" style="--c:${(SS[s] || ['', '#888'])[1]}">${(SS[s] || [s])[0]}</span>`
  const TI = { scene: '🎬', choice: '🎲', merge: '🔀', loop: '⏳', ending: '🏁' }
  const busy = new Set(['queued', 'running', 'post', 'checking'])

  function mount(root, o) {
    const st = { d: null, sel: null, timer: null, filter: 'all' }
    const ro = o.readonly, canJudge = o.canJudge
    async function load() {
      try { st.d = await o.api(`/api/projects/${o.pid}/media/${o.step}`) } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
      render()
      clearTimeout(st.timer)
      if (st.d.slots.some((x) => busy.has(x.status)) && document.body.contains(root)) st.timer = setTimeout(load, 4000)
    }
    function card(x) {
      const isImg = x.kind === 'image', q = x.qc || {}
      const metric = [q.seam != null ? `衔接 ${(q.seam * 100).toFixed(0)}` : '', q.face != null ? `人物 ${q.face}/10` : '', typeof q.subs === 'number' ? `字幕 ${(q.subs * 100).toFixed(0)}%` : '', q.duration ? `${q.duration}s` : ''].filter(Boolean).join(' · ')
      const label = isImg ? (x.slot === 'cover' ? '🖼 封面' : `🧑 ${esc(x.slot.slice(5))}`) : `${TI[x.type] || '🎬'} ${esc(x.title)}`
      return `<article class="mc ${x.slot === st.sel ? 'on' : ''}" data-s="${esc(x.slot)}" data-step="${x.step}">
        <div class="mc-media ${isImg ? (x.slot === 'cover' ? 'r34' : 'r169') : 'r916'}">${x.thumb || (isImg && x.media) ? `<img loading="lazy" src="${esc(x.thumb || x.media)}" alt="">` : `<div class="mc-ph">${busy.has(x.status) ? '<i class="fas fa-spinner fa-spin"></i>' : isImg ? '<i class="fas fa-image"></i>' : '<i class="fas fa-film"></i>'}</div>`}
          ${x.mode ? `<i class="mode ${x.mode}">${x.mode === 'frames' ? '尾帧' : '参考'}</i>` : ''}${x.accepted ? '<i class="mode man">人工放行</i>' : ''}</div>
        <div class="mc-b"><b>${label}</b>${pill(x.status)}<div class="mut sm">${metric || (x.note ? esc(x.note).slice(0, 40) : x.attempts ? `第 ${x.attempts} 次尝试` : '')}</div></div></article>`
    }
    function render() {
      const d = st.d, s = d.summary, step = o.step
      const list = d.slots.filter((x) => st.filter === 'all' || (st.filter === 'bad' ? ['failed', 'qc_fail'].includes(x.status) : st.filter === 'busy' ? busy.has(x.status) : x.status === st.filter))
      const todo = d.slots.filter((x) => ['pending', 'stale', 'blocked'].includes(x.status) || (['failed', 'qc_fail'].includes(x.status))).length
      const pct = s.total ? Math.round((s.ok / s.total) * 100) : 0
      root.innerHTML = `<div class="mw">
        <div class="dw-top"><div class="dw-sum"><div class="dw-bar"><i style="width:${pct}%"></i></div><b>${s.ok}/${s.total}</b> 通过
          ${[['busy', '进行中', s.running], ['blocked', '等待依赖', s.blocked], ['bad', '失败/不合格', s.failed + s.qc_fail], ['pending', '未开始', s.pending]].filter((x) => x[2]).map(([k, n, v]) => `<a href="#" data-flt="${k}" class="${st.filter === k ? 'on' : ''}">${n} ${v}</a>`).join(' ')} <a href="#" data-flt="all" class="${st.filter === 'all' ? 'on' : ''}">全部</a>
          ${s.cost ? `<span class="mut sm">· 已花费 ${s.cost}</span>` : ''}</div><span class="ge-grow"></span>
          ${ro || step === 9 ? '' : `<button class="btn sm pri" data-run ${todo ? '' : 'disabled'}><i class="fas fa-play"></i> ${step === 6 ? '生成设定图' : '开拍'}（${todo}）</button>`}</div>
        ${step === 9 ? `<p class="mut sm">自动检测：上一段尾帧 ↔ 本段首帧衔接分（≥ ${Math.round(d.settings.seam_min * 100)}）、视觉 Agent 人物一致性（≥ ${d.settings.face_min}/10）、烧录字幕（≤ ${Math.round(d.settings.subs_max * 100)}% 帧）。不合格自动追加约束重拍（最多 3 次），也可以由审核人工放行。</p>` : step === 8 ? '<p class="mut sm">分支片段按依赖自动排队：尾帧接力的片段要等上一段通过质检、拿到尾帧后才开拍；汇合节点和每 3 段接力后用参考图校准人物。</p>' : step === 7 ? '<p class="mut sm">主线片段全部用参考图模式（角色设定图锁人物）。完成后自动后处理 + 一致性检测。</p>' : '<p class="mut sm">每个角色一张原创面孔设定图（正面 / 侧面 / 全身），主线视频用它做参考图；封面用于上架。可以不满意就重画，也可以直接上传。</p>'}
        <div class="mw-main"><div class="mgrid ${step === 6 ? 'img' : ''}">${list.map(card).join('') || '<p class="mut">没有符合的素材</p>'}</div>
        <aside class="mw-side">${detail()}</aside></div></div>`
    }
    function detail() {
      const x = st.d.slots.find((y) => y.slot === st.sel); if (!x) return '<p class="mut sm">点选一个素材查看详情</p>'
      const q = x.qc || {}, v = q.vision || {}, isImg = x.kind === 'image'
      return `<div class="mw-d"><div class="dw-h"><h3>${esc(isImg ? x.slot : x.title)}</h3>${pill(x.status)}</div>
        ${x.media ? (isImg ? `<img class="mw-view" src="${esc(x.media)}" alt="">` : `<video class="mw-view" src="${esc(x.media)}" poster="${esc(x.thumb || '')}" controls playsinline preload="metadata"></video>`) : ''}
        ${!isImg && (x.first || x.last) ? `<div class="mw-fr">${x.first ? `<figure><img src="${esc(x.first)}" alt=""><figcaption>首帧</figcaption></figure>` : ''}${x.last ? `<figure><img src="${esc(x.last)}" alt=""><figcaption>尾帧</figcaption></figure>` : ''}</div>` : ''}
        ${x.note ? `<div class="banner ${x.status === 'ok' ? 'ok' : 'warn'}">${esc(x.note)}</div>` : ''}
        ${Object.keys(q).length ? `<div class="kv sm"><b>衔接分</b><span>${q.seam != null ? q.seam : '—（参考图模式不需要接帧）'}</span><b>人物一致</b><span>${q.face != null ? q.face + '/10' : '—'}${v.note ? ` · ${esc(v.note)}` : ''}</span><b>烧录字幕</b><span>${typeof q.subs === 'number' ? (q.subs * 100).toFixed(0) + '% 帧' : '—'}</span><b>时长 / 音轨</b><span>${q.duration || '—'}s · ${q.audio === false ? '<span class="bad-t">无音轨</span>' : q.audio ? '有' : '—'}</span></div>` : ''}
        ${x.job ? `<p class="mut sm">第 ${x.attempts} 次 · ${esc(x.job.phase)} · ${esc(x.job.provider_kind || '执行节点')} ${esc(x.job.model || '')}${x.job.error ? `<br><span class="bad-t">${esc(x.job.error.slice(0, 200))}</span>` : ''}</p>` : ''}
        ${x.deps?.length ? `<p class="mut sm">依赖：${x.deps.map(esc).join('、')}</p>` : ''}
        ${x.prompt ? `<details class="dw-ledger"><summary>提示词</summary><pre>${esc(x.prompt)}</pre></details>` : ''}
        <div class="ge-row">${!ro && x.step !== 9 && o.step !== 9 && !busy.has(x.status) ? `<button class="btn sm pri" data-redo="${esc(x.slot)}"><i class="fas fa-rotate"></i> ${x.media ? '重新生成' : '生成'}</button>` : ''}
          ${!ro && o.step !== 9 && !busy.has(x.status) ? `<label class="btn sm"><i class="fas fa-upload"></i> 上传替换<input type="file" hidden data-up="${esc(x.slot)}" accept="${isImg ? 'image/png,image/jpeg,image/webp' : 'video/mp4'}"></label>` : ''}
          ${canJudge && x.media && !busy.has(x.status) && x.status !== 'ok' ? `<button class="btn sm ok" data-accept="${esc(x.slot)}"><i class="fas fa-check"></i> 人工放行</button>` : ''}
          ${canJudge && x.status === 'ok' ? `<button class="btn sm bad" data-reject="${esc(x.slot)}"><i class="fas fa-xmark"></i> 驳回重拍</button>` : ''}
          ${o.step === 9 && !ro ? `<a class="btn sm" href="#/p/${o.pid}/${x.step}">去第 ${x.step} 步重拍</a>` : ''}</div></div>`
    }
    root.addEventListener('click', async (ev) => {
      const t = ev.target.closest('a,button,article'); if (!t) return
      if (t.dataset.flt) { ev.preventDefault(); st.filter = t.dataset.flt; return render() }
      if (t.tagName === 'ARTICLE') { st.sel = t.dataset.s; render(); if (window.innerWidth < 900) $('.mw-side', root)?.scrollIntoView({ behavior: 'smooth' }); return }
      const go = async (fn, msg) => { try { t.disabled = true; await fn(); if (msg) o.toast(msg); await load(); o.onChange?.() } catch (e) { o.toast(e.message) } finally { t.disabled = false } }
      if (t.hasAttribute('data-run')) return go(async () => { const r = await o.api(`/api/projects/${o.pid}/media/${o.step}/run`, {}); o.toast(`已提交 ${r.started.length} 个${r.blocked.length ? `，${r.blocked.length} 个等待依赖` : ''}`) })
      if (t.dataset.redo) return go(() => o.api(`/api/projects/${o.pid}/media/${o.step}/run`, { only: [t.dataset.redo] }), '已提交')
      if (t.dataset.accept) { const x = st.d.slots.find((y) => y.slot === t.dataset.accept); return go(() => o.api(`/api/projects/${o.pid}/media/${x.step}/judge`, { slot: x.slot, accept: true, note: prompt('放行说明（可空）', '') || '' }), '已放行') }
      if (t.dataset.reject) { const x = st.d.slots.find((y) => y.slot === t.dataset.reject); const note = prompt('驳回原因（会作为追加约束写进下次提示词，例如「人物发型不对」）', ''); if (note === null) return; return go(() => o.api(`/api/projects/${o.pid}/media/${x.step}/judge`, { slot: x.slot, accept: false, note }), '已驳回') }
    })
    root.addEventListener('change', async (ev) => {
      const f = ev.target.files?.[0], slot = ev.target.dataset.up; if (!f || !slot) return
      const fd = new FormData(); fd.append('file', f); fd.append('slot', slot)
      try { const r = await fetch(`/api/projects/${o.pid}/media/${o.step}/upload`, { method: 'POST', body: fd, credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '上传失败'); o.toast('已上传'); load(); o.onChange?.() } catch (e) { o.toast(e.message) }
    })
    load()
    return { reload: load }
  }
  window.MediaWorkbench = { mount }
})()
