// 上架中心：待上架（导演台成片）→ 预检 → 填写上架信息 → 提交上线；已上架：改信息 / 更新版本 / 下架；已下架：恢复；审计日志
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, body) => { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.df_admin || '' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '请求失败'); return j }
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200) }
  const root = $('#publish')
  const FMT = { anime: '漫剧', live: '真人剧', abstract: '抽象剧' }
  const AUD = { all: '全年龄向', female: '女性向', male: '男性向' }
  const RAT = { all: '全年龄', 12: '12+', 16: '16+', 18: '18+' }
  const ACT = { publish: ['首次上架', '#3ddc97'], update: ['更新版本', '#7dd3fc'], takedown: ['下架', '#ff5d73'], restore: ['恢复上架', '#3ddc97'], meta: ['修改信息', '#c084fc'] }
  const S = { b: null, open: null, pf: null, catalog: [] }
  const fmtT = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false })

  async function load() {
    try { S.b = await api('/api/admin/publish/board') } catch (e) {
      root.innerHTML = `<div class="st-card"><h3>需要管理员权限</h3><p class="mut">${esc(e.message)}</p><input id="ak" class="inp2" placeholder="管理员密钥"><button class="btn2" id="aks" style="margin-top:8px">保存</button></div>`
      $('#aks').onclick = () => { localStorage.df_admin = $('#ak').value; load() }; return
    }
    if (!S.catalog.length) try { S.catalog = (await api('/api/catalog')).items.filter((x) => x.status !== 'live' || x.url?.startsWith('/s/')) } catch {}
    render()
  }

  const stateOf = (p) => p.dry > 0 ? ['空跑占位', '#64748b'] : p.pending > 0 ? ['生成中', '#f5a524'] : p.ready === p.clips ? ['成片齐全 · 待预检', '#3ddc97'] : p.ready > 0 ? [`部分成片 ${p.ready}/${p.clips} · 点开预检`, '#fbbf24'] : ['无成片', '#ff5d73']

  function render() {
    const B = S.b
    root.innerHTML = `
      <header class="st-head"><h1><i class="fas fa-rocket"></i> 上架中心</h1><p>所有作品的<b>统一上线入口</b>：导演台成片 → <b>预检</b>（素材真实 / 剧情树可玩 / 媒体可播 / 元数据）→ 填写上架信息 → <b>提交上线</b> → 发现页与播放器即时可玩。每次上架、更新、下架都有审计记录。</p></header>
      <section class="dk-status">
        <div><span>待上架</span><b>${B.queue.length}</b><em>导演台项目</em></div>
        <div><span>已上架</span><b class="ok">${B.live.length}</b><em>发现页可见</em></div>
        <div><span>已下架</span><b>${B.offline.length}</b><em>可随时恢复</em></div>
      </section>
      <section class="st-card"><h3><i class="fas fa-inbox"></i> 待上架</h3>
        ${B.queue.length ? B.queue.map((p) => { const [t, c] = stateOf(p); return `<div class="pb-row ${S.open === p.id ? 'on' : ''}" data-open="${p.id}">
          ${p.cover_url ? `<img src="${esc(p.cover_url)}" alt="">` : '<i class="pb-noimg fas fa-film"></i>'}
          <div class="pb-main"><b>${esc(p.title)}</b><span>${FMT[p.cat] || p.cat} · ${esc(p.scale || '')} · 成片 ${p.ready}/${p.clips}${p.failed ? ` · 失败 ${p.failed}` : ''} · 已耗 ${(p.spent || 0).toLocaleString()} 积分</span></div>
          <span class="pill" style="--c:${c}">${t}</span></div>${S.open === p.id ? `<div id="pf-host">${S.pf ? pfHtml(S.pf, p) : '<p class="mut sm">预检中…</p>'}</div>` : ''}` }).join('') : '<p class="mut">暂无待上架项目。去 <a href="/director">导演台</a> 生成一部吧。</p>'}
      </section>
      <section class="st-card"><h3><i class="fas fa-signal"></i> 已上架</h3>${B.live.length ? B.live.map(liveHtml).join('') : '<p class="mut">暂无</p>'}</section>
      ${B.offline.length ? `<section class="st-card"><h3><i class="fas fa-box-archive"></i> 已下架</h3>${B.offline.map(liveHtml).join('')}</section>` : ''}
      <section class="st-card"><h3><i class="fas fa-clock-rotate-left"></i> 上架审计</h3>
        ${B.logs.length ? `<div class="pb-log">${B.logs.map((l) => { const [t, c] = ACT[l.action] || [l.action, '#999']; return `<div><em>${fmtT(l.created_at)}</em><span class="pill" style="--c:${c}">${t}</span><b>${esc(l.series_id || '')}</b>${l.version ? `<small>v${l.version}</small>` : ''}<i>${esc(l.note || '')}</i></div>` }).join('')}</div>` : '<p class="mut sm">暂无记录</p>'}
      </section>`
  }

  function pfHtml(pf, p) {
    const pub = p.published
    const cands = S.catalog.filter((x) => x.cat === pf.cat && (x.status === 'soon' || x.id === p.source_item))
    const G = (S.b.genres || []).map((g) => `<option value="${g.id}" ${g.id === (p.genre || '') ? 'selected' : ''}>${esc(g.name)}</option>`).join('')
    return `<div class="pf">
      <div class="pf-checks">${pf.checks.map((c) => `<div class="${c.ok ? 'ok' : c.level === 'block' ? 'bad' : 'warn'}"><i class="fas ${c.ok ? 'fa-circle-check' : c.level === 'block' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i>${esc(c.msg)}</div>`).join('')}</div>
      <div class="pf-sum">可玩：<b>${pf.playable.nodes}</b> 抉择点 · <b>${pf.playable.endings}</b> 结局 · <b>${pf.playable.forks}</b> 裂隙 · <b>${pf.playable.clips}</b> 段成片 · 彩蛋 ${pf.playable.bonus.length}/3</div>
      ${pf.failed.length ? `<div class="pf-fail"><b>失败片段</b>${pf.failed.map((f) => `<span title="${esc(f.error)}">${esc(f.clip)} · ${/copyright/.test(f.error) ? '肖像/版权拒绝（需重做设定图）' : /moderation/.test(f.error) ? '内容审核拒绝' : esc(f.error || '生成失败')}${f.softened ? ` · 已改写 ${f.softened} 次` : ''}</span>`).join('')}
        <button class="btn2 ghost sm" data-retry="${p.id}"><i class="fas fa-rotate"></i> 失败片段重拍（审核拒绝自动改写提示词）</button></div>` : ''}
      ${pf.can_publish ? `<form class="pf-form" data-submit="${p.id}">
        <label>片名<input class="inp2" name="title" value="${esc(p.title)}" maxlength="24"></label>
        <label>一句话简介<textarea class="inp2 ta" name="logline" rows="2" maxlength="80">${esc(p.logline || '')}</textarea></label>
        <div class="pf-grid">
          <label>题材<select class="inp2" name="genre">${G}</select></label>
          <label>受众<select class="inp2" name="aud">${Object.entries(AUD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>分级<select class="inp2" name="rating">${Object.entries(RAT).map(([k, v]) => `<option value="${k}" ${k === '16' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>角标<select class="inp2" name="badge">${S.b.badges.map((x) => `<option>${x}</option>`).join('')}</select></label>
        </div>
        <label>标签（逗号分隔）<input class="inp2" name="tags" placeholder="例如：赌局,港风,博弈"></label>
        <label>关联目录作品（可选：替换发现页里“即将上线”的概念卡）<select class="inp2" name="source_item"><option value="">— 作为独立新作上架 —</option>${cands.map((x) => `<option value="${x.id}" ${x.id === p.source_item ? 'selected' : ''}>${esc(x.title)}（${x.status === 'soon' ? '即将上线' : '已关联'}）</option>`).join('')}</select></label>
        <label>上架备注<input class="inp2" name="note" placeholder="例如：精简版首发，失败分支补拍后更新"></label>
        <button class="btn2 big" type="submit"><i class="fas fa-rocket"></i> ${pub ? `更新上线（当前 v${pub.version} · ${pub.status === 'live' ? '在架' : '已下架'}）` : '提交上线'}</button>
      </form>` : `<div class="dk-v bad">✗ 不能上架：${pf.blockers.map(esc).join('；')}</div>`}
    </div>`
  }

  function liveHtml(s) {
    const live = s.status === 'live'
    return `<div class="pb-live">
      ${s.cover ? `<img src="${esc(s.cover)}" alt="">` : '<i class="pb-noimg fas fa-film"></i>'}
      <div class="pb-main"><b>${esc(s.title)}</b><span>${FMT[s.cat] || s.cat} · ${AUD[s.aud] || '全年龄向'} · ${RAT[s.rating] || '16+'} · ${esc(s.badge || '')} · v${s.version} · ${s.plays} 局</span>
        <small class="mut">${esc(s.id)} · ${fmtT(s.updated_at)}${s.source_item ? ' · 目录 ' + esc(s.source_item) : ''}</small></div>
      <div class="pb-acts">${live ? `<a class="btn2 sm" href="/s/${s.id}" target="_blank"><i class="fas fa-play"></i> 试玩</a><button class="btn2 ghost sm" data-down="${s.id}">下架</button>` : `<button class="btn2 sm" data-up="${s.id}">恢复上架</button>`}
        ${s.project_id ? `<button class="btn2 ghost sm" data-reopen="${s.project_id}">更新版本</button>` : ''}</div></div>`
  }

  async function openProject(id) {
    if (S.open === id) { S.open = null; S.pf = null; return render() }
    S.open = id; S.pf = null; render()
    try { S.pf = await api(`/api/admin/publish/${id}/preflight`) } catch (e) { S.pf = { checks: [{ ok: false, level: 'block', msg: e.message }], blockers: [e.message], playable: { nodes: 0, endings: 0, forks: 0, clips: 0, bonus: [] }, failed: [] } }
    render(); $('#pf-host')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  document.addEventListener('click', async (e) => {
    const q = (s) => e.target.closest(s)
    try {
      if (q('[data-open]') && !q('#pf-host')) return openProject(q('[data-open]').dataset.open)
      if (q('[data-retry]')) { const b = q('[data-retry]'); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI 改写提示词中…'; const r = await api(`/api/director/projects/${b.dataset.retry}/retry`, {}); toast(`已重新排队 ${r.requeued} 段（改写 ${r.softened} 段），worker 会自动重拍`); S.open = null; return load() }
      if (q('[data-down]')) { const id = q('[data-down]').dataset.down, note = prompt('下架原因（会记录在审计日志）', ''); if (note === null) return; await api(`/api/admin/series/${id}/takedown`, { note }); toast('已下架：发现页与播放器不再可见'); return load() }
      if (q('[data-up]')) { await api(`/api/admin/series/${q('[data-up]').dataset.up}/restore`, {}); toast('已恢复上架'); return load() }
      if (q('[data-reopen]')) { const id = q('[data-reopen]').dataset.reopen; if (!S.b.queue.some((p) => p.id === id)) { const s = [...S.b.live, ...S.b.offline].find((x) => x.project_id === id); S.b.queue.unshift({ id, title: s.title, cat: s.cat, genre: s.genre, logline: s.logline, cover_url: s.cover, source_item: s.source_item, clips: 0, ready: 0, pending: 0, dry: 0, failed: 0, published: s }) } S.open = null; return openProject(id) }
    } catch (er) { toast(er.message) }
  })
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-submit]'); if (!f) return
    e.preventDefault()
    const fd = Object.fromEntries(new FormData(f)), btn = f.querySelector('button[type=submit]')
    fd.tags = String(fd.tags || '').split(/[,，\s]+/).filter(Boolean)
    if (!confirm(`确认上线《${fd.title}》？上线后发现页即时可见。`)) return
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上线中…'
    try { const r = await api(`/api/admin/publish/${f.dataset.submit}/submit`, fd); toast(`🎬 已上线 v${r.version}${r.dropped.length ? ` · 精简版（裁掉 ${r.dropped.length} 个分支）` : ''}`); S.open = null; S.pf = null; S.catalog = []; await load() }
    catch (er) { toast(er.message); btn.disabled = false; btn.innerHTML = '<i class="fas fa-rocket"></i> 提交上线' }
  })
  load()
})()
