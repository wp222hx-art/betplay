// 制作平台：选题（数据驱动）→ 剧本树 → 校验 → 渲染队列 → 质检审核 → 上架；风控台
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, body) => { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.df_admin || '' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '请求失败'); return j }
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400) }
  const root = $('#studio')
  const ST = { draft: ['草稿', '#64748b'], scripted: ['剧本就绪', '#38bdf8'], rendering: ['渲染中', '#f5a524'], review: ['待审核', '#c084fc'], published: ['已上架', '#3ddc97'] }
  const JS = { queued: '排队', running: '生成中', review: '待质检', approved: '通过', rejected: '驳回', failed: '失败' }
  const S = { tab: 'pipe', data: null, next: null, risk: null, open: null }

  async function load() {
    try {
      const [d, n] = await Promise.all([api('/api/studio/projects'), api('/api/studio/next')])
      S.data = d; S.next = n
      if (S.tab === 'risk') S.risk = await api('/api/admin/risk')
    } catch (e) { root.innerHTML = `<div class="st-card"><h3>无法访问制作平台</h3><p class="mut">${esc(e.message)}</p><input id="ak" placeholder="管理员密钥" class="inp2"><button class="btn2" id="aks">保存</button></div>`; $('#aks').onclick = () => { localStorage.df_admin = $('#ak').value; load() }; return }
    render()
  }

  function render() {
    const P = S.data.projects
    const flow = ['选题', '剧本树', '校验', '渲染', '质检', '上架', '数据回流']
    root.innerHTML = `
      <header class="st-head"><h1><i class="fas fa-clapperboard"></i> 制作平台</h1><p>可延续生成：数据选题 → AI 剧本树 → 渲染队列 → 质检 → 上架 → 结局热度回流派生续集</p></header>
      <div class="flow">${flow.map((f, i) => `<span><b>${i + 1}</b>${f}</span>`).join('<i class="fas fa-angle-right"></i>')}</div>
      <nav class="st-tabs">${[['pipe', 'fa-diagram-project', '生产线'], ['next', 'fa-fire', '选题池'], ['risk', 'fa-shield-halved', '风控台']].map(([k, ic, n]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}"><i class="fas ${ic}"></i> ${n}</button>`).join('')}</nav>
      ${S.tab === 'pipe' ? `
        <section class="kan">${Object.entries(ST).map(([k, [n, c]]) => `<div class="col"><h4 style="--c:${c}">${n}<small>${P.filter((p) => p.status === k).length}</small></h4>
          ${P.filter((p) => p.status === k).map((p) => `<article class="pj" data-pj="${p.id}"><b>${esc(p.title)}</b><span>${p.kind === 'sequel' ? '续集 · ' : ''}${({ love: '漫剧', anime: '漫剧', abstract: '抽象剧' })[p.cat] || '真人剧'} · ${p.validation.nodes} 节点 · ${p.validation.endings} 结局 · ${p.validation.clips} 片段</span>
            <div class="bar"><i style="width:${p.jobs_total ? ((p.jobs.approved || 0) / p.jobs_total) * 100 : 0}%"></i></div>
            <em>${p.validation.ok ? '<i class="fas fa-circle-check ok"></i> 校验通过' : `<i class="fas fa-triangle-exclamation bad"></i> ${p.validation.errors.length} 个错误`} · 预计 ${p.validation.est_credits.toLocaleString()} 积分</em></article>`).join('') || '<p class="mut sm">—</p>'}</div>`).join('')}</section>
        <section class="st-card"><h3><i class="fas fa-plus"></i> 新建项目</h3><div class="new"><input id="nt" class="inp2" placeholder="标题，如：危险上司的深夜加班"><input id="nl" class="inp2" placeholder="一句话梗概"><select id="nc" class="inp2"><option value="anime">漫剧</option><option value="live">真人剧</option><option value="abstract">抽象剧</option></select><button class="btn2" id="ncreate"><i class="fas fa-wand-magic-sparkles"></i> AI 生成剧本树</button></div></section>` : ''}
      ${S.tab === 'next' ? `
        <section class="st-card"><h3><i class="fas fa-fire"></i> 概念 → 正片（按想看需求排序）</h3>${S.next.concepts.map((c, i) => `<div class="nx"><b class="rk">${i + 1}</b><div><b>${esc(c.title)}</b><span>${c.cat === 'love' ? '恋爱' : '影剧'} · ${c.tags.join(' / ')} · 需求分 ${Math.round(c.demand)}</span></div><button class="btn2 sm" data-make="${c.id}">立项</button></div>`).join('')}</section>
        <section class="st-card"><h3><i class="fas fa-code-branch"></i> 续集 / 裂隙派生（按通关热度）</h3>${S.next.sequels.map((s) => `<div class="nx"><i class="fas fa-flag-checkered"></i><div><b>${esc(s.ending_id)}</b><span>${esc(s.series_id)} · 通关 ${s.n} 次</span></div><button class="btn2 sm" data-sequel="${s.series_id}:${s.ending_id}">派生续集</button></div>`).join('') || '<p class="mut">暂无通关数据</p>'}
          ${S.next.traded.length ? `<h4 class="mut" style="margin:14px 0 6px">交易最活跃的结局</h4>${S.next.traded.map((t) => `<div class="nx"><i class="fas fa-gem"></i><div><b>${esc(t.ending_id)}</b><span>${t.n} 笔 · 均价 ${Math.round(t.p)}</span></div></div>`).join('')}` : ''}</section>` : ''}
      ${S.tab === 'risk' && S.risk ? riskHtml() : ''}
      <div id="pj-detail"></div>`
    if (S.open) openProject(S.open)
  }

  function riskHtml() {
    const R = S.risk, by = Object.fromEntries(R.by_kind_24h.map((x) => [x.kind, x.n]))
    const K = { sybil: '女巫多开', spoof: '身份伪造', wash_trade: '洗售', price_band: '异常定价', rate_limit: '频率超限' }
    return `<section class="risk-k">${Object.entries(K).map(([k, n]) => `<div><b>${by[k] || 0}</b><span>${n} · 24h</span></div>`).join('')}<div><b class="${R.ledger_balanced ? 'ok' : 'bad'}">${R.ledger_balanced ? '平衡' : '失衡'}</b><span>复式账本</span></div><div><b>${R.devices.n}</b><span>设备身份</span></div></section>
      <section class="st-card"><h3><i class="fas fa-list"></i> 风控事件</h3><div class="ev">${R.events.map((e) => `<div><i class="sev s${e.severity}"></i><b>${K[e.kind] || e.kind}</b><span>${esc(e.uid || '')}</span><code>${esc(e.detail)}</code><button class="btn2 sm ghost" data-ban="${esc(e.uid)}">封禁</button></div>`).join('') || '<p class="mut">暂无事件</p>'}</div></section>`
  }

  async function openProject(id) {
    S.open = id
    let d; try { d = await api('/api/studio/projects/' + id) } catch (e) { return toast(e.message) }
    const v = d.validation
    $('#pj-detail').innerHTML = `<section class="st-card pjd"><header><h3>${esc(d.title)} <small class="pill" style="--c:${ST[d.status][1]}">${ST[d.status][0]}</small></h3><button class="btn2 sm ghost" id="pjx">收起</button></header>
      <p class="mut">${esc(d.logline)}</p>
      <div class="vd ${v.ok ? 'ok' : 'bad'}"><b>${v.ok ? '✓ 剧本树校验通过' : '✗ 校验未通过'}</b> · ${v.nodes} 节点 · ${v.endings} 结局 · ${v.forks} 时间裂隙 · ${v.clips} 片段 · 预计 ${v.est_credits.toLocaleString()} 积分
        ${[...v.errors.map((e) => `<div class="e">✗ ${esc(e)}</div>`), ...v.warnings.slice(0, 4).map((w) => `<div class="w">! ${esc(w)}</div>`)].join('')}</div>
      <h4>剧情树</h4><div class="tree2">${d.tree.nodes.map((n) => `<div class="tn"><b>${esc(n.id)}</b> ${esc(n.question)}${n.fork ? ` <em class="fk">⟲ → ${esc(n.fork.node)}</em>` : ''}<div>${n.options.map((o) => `<span class="${o.twist ? 'tw' : ''} ${o.next ? '' : 'end'}">${esc(o.label)}${o.next ? ' → ' + esc(o.next) : ' ★'}</span>`).join('')}</div></div>`).join('')}</div>
      <h4>渲染队列 <small class="mut">${d.jobs.length} 个任务</small></h4>
      ${d.jobs.length ? `<div class="jobs">${d.jobs.map((j) => `<div class="jb ${j.status}"><b>${esc(j.clip_id)}</b><span>${esc(j.title)} · ${j.dur}s · ${j.credits}</span><em>${JS[j.status]}</em>${j.status === 'review' ? `<button class="btn2 sm" data-ok="${j.id}">通过</button><button class="btn2 sm ghost" data-no="${j.id}">驳回</button>` : ''}</div>`).join('')}</div>`
        : `${v.ok ? '' : `<button class="btn2 ghost" data-repair="${d.id}" style="margin-right:8px"><i class="fas fa-screwdriver-wrench"></i> 一键修复剧本树</button>`}<button class="btn2" data-render="${d.id}" ${v.ok ? '' : 'disabled'}><i class="fas fa-film"></i> 拆分入渲染队列（${v.clips} 段 · ${v.est_credits.toLocaleString()} 积分）</button>`}
      <p class="mut sm">渲染 worker：<code>python3 scripts/studio/worker.py</code> 拉取任务 → Seedance 生成 → AI 质检 → 回报；人工审核通过后进入上架。</p></section>`
    $('#pjx').onclick = () => { S.open = null; $('#pj-detail').innerHTML = '' }
    $('#pj-detail').scrollIntoView({ behavior: 'smooth' })
  }

  document.addEventListener('click', async (e) => {
    const t = e.target, q = (s) => t.closest(s)
    try {
      if (q('[data-tab]')) { S.tab = q('[data-tab]').dataset.tab; return load() }
      if (q('[data-pj]')) return openProject(q('[data-pj]').dataset.pj)
      if (q('#ncreate')) { const b = q('#ncreate'); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中…'; const r = await api('/api/studio/projects', { title: $('#nt').value, logline: $('#nl').value, cat: $('#nc').value }); toast(`剧本树已生成（${r.source}）· ${r.validation.endings} 结局`); S.open = r.id; return load() }
      if (q('[data-make]')) { const b = q('[data-make]'); b.disabled = true; b.textContent = '生成中…'; const r = await api('/api/studio/projects', { item_id: b.dataset.make }); toast(`已立项 · ${r.validation.endings} 结局`); S.tab = 'pipe'; S.open = r.id; return load() }
      if (q('[data-sequel]')) { const [s, en] = q('[data-sequel]').dataset.sequel.split(':'); const r = await api('/api/studio/projects', { title: `续·${en}`, logline: `承接 ${s} 的结局 ${en}，故事在平行时间线继续`, cat: s.includes('love') ? 'love' : 'film', parent: q('[data-sequel]').dataset.sequel }); toast('续集项目已创建'); S.tab = 'pipe'; S.open = r.id; return load() }
      if (q('[data-repair]')) { const r = await api(`/api/studio/projects/${q('[data-repair]').dataset.repair}/repair`, {}); toast(`已修复 ${r.fixes.length} 处 · ${r.validation.ok ? '校验通过' : '仍有 ' + r.validation.errors.length + ' 个错误'}`); return openProject(S.open) }
      if (q('[data-render]')) { const r = await api(`/api/studio/projects/${q('[data-render]').dataset.render}/render`, {}); toast(`已入队 ${r.queued} 个渲染任务`); return load() }
      if (q('[data-ok]')) { await api(`/api/studio/jobs/${q('[data-ok]').dataset.ok}/review`, { approve: true }); return load() }
      if (q('[data-no]')) { await api(`/api/studio/jobs/${q('[data-no]').dataset.no}/review`, { approve: false }); return load() }
      if (q('[data-ban]')) { if (!confirm('封禁该设备？其令牌将立即失效')) return; await api('/api/admin/ban', { uid: q('[data-ban]').dataset.ban, ban: true, reason: 'risk' }); toast('已封禁'); return load() }
    } catch (er) { toast(er.message); load() }
  })
  load()
})()
