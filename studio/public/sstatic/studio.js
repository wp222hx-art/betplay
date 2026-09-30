// MoMo Studio 前端（SPA，hash 路由）：登录 / 项目看板 / 十步流水线 / Agent 配置中心 / 账号 / 审计
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const app = $('#app')
  const S = { me: null, state: null, cfg: null }
  const ST = { locked: ['未解锁', '#6b7280'], ready: ['待开始', '#ff6fae'], running: ['运行中', '#f5a524'], review: ['待审核', '#c084fc'], done: ['已通过', '#3ddc97'], failed: ['失败', '#ff5d73'], stale: ['上游已改·需重做', '#ff8a5d'] }
  const ROLE = { admin: '管理员', writer: '编剧', reviewer: '审核' }
  const fmtT = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200) }
  async function api(url, body) {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401 && !url.startsWith('/api/auth')) { S.me = null; route(); throw new Error('登录已过期') }
    if (!r.ok) { const e = new Error(j.message || '请求失败'); e.code = j.error; e.data = j; throw e }
    return j
  }
  const can = (role) => S.me && ({ reviewer: 1, writer: 2, admin: 3 })[S.me.role] >= ({ reviewer: 1, writer: 2, admin: 3 })[role]

  function frame(active, inner, wide) {
    const tabs = [['#/projects', 'fa-diagram-project', '项目'], ['#/config', 'fa-robot', 'Agent 配置'], ...(can('admin') ? [['#/nodes', 'fa-server', '执行节点'], ['#/users', 'fa-users', '账号'], ['#/audit', 'fa-clock-rotate-left', '审计']] : [])]
    app.innerHTML = `<header class="top"><a class="logo" href="#/projects"><img src="/sstatic/momo.svg" alt=""><b>MoMo</b><span>Studio</span></a>
      <nav class="tabs" id="main-tabs">${tabs.map(([h, ic, n]) => `<a href="${h}" class="${active === h ? 'on' : ''}"><i class="fas ${ic}"></i><b>${n}</b></a>`).join('')}</nav>
      <div class="me">${esc(S.me.name)}<span class="role">${ROLE[S.me.role]}</span><button class="btn sm" id="lo"><i class="fas fa-right-from-bracket"></i></button></div></header><main class="${wide ? 'wide' : ''}">${inner}</main>`
    $('#lo').onclick = async () => { await api('/api/auth/logout', {}); S.me = null; route() }
  }

  // ─── 登录 / 初始化 ───
  function authPage() {
    const init = S.state.initialized
    app.innerHTML = `<div class="card auth"><div class="brand"><img src="/sstatic/momo.svg" alt=""><h1>MoMo Studio</h1><p class="sub">短剧生产后台 · ${init ? '员工登录' : '首次使用：创建管理员账号'}</p></div>
      ${S.state.master_key_ok ? '' : '<div class="banner warn">⚠ 未配置 <code>STUDIO_MASTER_KEY</code>：可以登录，但无法保存任何 API Key。</div>'}
      <form id="af">${init ? '' : '<label class="f">名字<input class="inp" name="name" value="管理员"></label>'}
        <label class="f">邮箱<input class="inp" name="email" type="email" autocomplete="username" required></label>
        <label class="f">密码${init ? '' : '（≥10 位）'}<input class="inp" name="password" type="password" autocomplete="${init ? 'current-password' : 'new-password'}" required minlength="${init ? 1 : 10}"></label>
        ${!init && S.state.bootstrap_token_required ? '<label class="f">初始化口令<input class="inp" name="token" required></label>' : ''}
        <button class="btn pri" type="submit">${init ? '登录' : '创建管理员并登录'}</button></form></div>`
    $('#af').onsubmit = async (e) => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target))
      try { const r = await api(init ? '/api/auth/login' : '/api/auth/bootstrap', fd); S.me = r.user; location.hash = '#/projects'; route() } catch (er) { toast(er.message) }
    }
  }

  // ─── 项目看板 ───
  async function projectsPage() {
    const d = await api('/api/projects')
    frame('#/projects', `<h1>生产项目</h1><p class="sub">每个项目按 10 步严格推进：<b>上一步未通过审核，下一步在服务端就无法调用</b>。修改已通过的步骤，会让所有下游步骤失效、需要重做。</p>
      ${can('writer') ? `<div class="card"><h3><i class="fas fa-plus"></i> 新建项目</h3><form id="np" class="grid g4"><input class="inp" name="title" placeholder="项目名，例如：她从地狱回来了·第二季" required>
        <select class="inp" name="format"><option value="live">真人剧</option><option value="anime">漫剧</option><option value="abstract">抽象剧</option></select>
        <select class="inp" name="genre"><option value="">题材（第 1 步再定）</option>${['revenge|复仇·逆袭', 'romance|恋爱·甜宠', 'urban|都市·豪门', 'suspense|悬疑·惊悚', 'costume|古风·仙侠', 'fantasy|奇幻·科幻', 'absurd|无厘头·整活'].map((x) => { const [v, n] = x.split('|'); return `<option value="${v}">${n}</option>` }).join('')}</select>
        <button class="btn pri" type="submit">创建</button></form></div>` : ''}
      <div class="card"><table><tr><th>项目</th><th>形态</th><th>进度</th><th>当前步骤</th><th>更新</th></tr>
        ${d.projects.length ? d.projects.map((p) => { const cur = d.steps[(p.cur || 11) - 1]; return `<tr><td><a href="#/p/${p.id}"><b>${esc(p.title)}</b></a><div class="mut sm">${esc(p.id)}</div></td><td>${{ live: '真人剧', anime: '漫剧', abstract: '抽象剧' }[p.format] || p.format}</td><td><b>${p.done}</b>/10</td><td>${cur ? `${cur.no}. ${esc(cur.name)}` : '<span class="ok-t">全部完成</span>'}</td><td class="mut sm">${fmtT(p.updated_at)}</td></tr>` }).join('') : '<tr><td colspan="5" class="mut">还没有项目</td></tr>'}</table></div>`)
    const f = $('#np'); if (f) f.onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/api/projects', Object.fromEntries(new FormData(f))); location.hash = '#/p/' + r.id } catch (er) { toast(er.message) } }
  }

  // ─── 单个项目：十步流水线 ───
  async function projectPage(id, n) {
    const d = await api('/api/projects/' + id)
    const steps = d.steps, cur = n || (steps.find((s) => s.status !== 'done') || steps[9]).no, s = steps[cur - 1]
    const blocker = steps.slice(0, cur - 1).find((x) => x.status !== 'done')
    const [stn, stc] = ST[s.status] || [s.status, '#888']
    frame('#/projects', `<a href="#/projects" class="mut sm"><i class="fas fa-arrow-left"></i> 全部项目</a><h1 style="margin-top:6px">${esc(d.project.title)} ${steps[2].status === 'done' ? `<a class="btn sm pri" href="#/p/${id}/insight" style="vertical-align:middle"><i class="fas fa-diagram-successor"></i> 前置模拟 · 生成流程</a>` : ''}</h1>
      <nav class="pipe">${steps.map((x) => `<a href="#/p/${id}/${x.no}" class="st-${x.status} ${x.no === cur ? 'on' : ''}"><i class="n">第 ${x.no} 步</i><b>${esc(x.name)}</b><span class="pill" style="--c:${ST[x.status][1]}">${ST[x.status][0]}</span></a>`).join('')}</nav>
      ${s.no === 3 && !blocker ? graphShell(s) : (s.no === 4 || s.no === 5) && !blocker ? docsShell(s) : s.no >= 6 && s.no <= 9 && !blocker ? mediaShell(s) : s.no === 10 && !blocker ? releaseShell(s) : `<section class="stepbox"><div class="card"><h2>第 ${s.no} 步 · ${esc(s.name)} <span class="pill" style="--c:${stc}">${stn}</span></h2><p class="sub">${esc(s.desc)}</p>
        ${blocker ? `<div class="locked"><i class="fas fa-lock"></i>请先完成第 ${blocker.no} 步「${esc(blocker.name)}」<br><a class="btn" style="margin-top:12px" href="#/p/${id}/${blocker.no}">去第 ${blocker.no} 步</a></div>` : stepBody(s)}
      </div><aside><div class="card"><h3>步骤信息</h3><div class="kv"><b>负责 Agent</b><span>${esc(s.agent)}</span><b>版本</b><span>v${s.version}</span><b>审批</b><span>${s.approved_at ? fmtT(s.approved_at) : '—'}</span><b>备注</b><span>${esc(s.note || '—')}</span></div></div>
        <div class="card"><h3>最近调用</h3>${d.runs.length ? d.runs.slice(0, 8).map((r) => `<div class="sm" style="margin-bottom:6px"><span class="pill" style="--c:${r.status === 'ok' || r.status === 'submitted' ? '#3ddc97' : '#ff5d73'}">${esc(r.status)}</span> 第${r.step || '-'}步 ${esc(r.agent)} · ${esc(r.model || '')} · ${r.latency_ms}ms${r.error ? `<div class="bad-t">${esc(r.error.slice(0, 90))}</div>` : ''}</div>`).join('') : '<p class="mut sm">暂无</p>'}</div></aside></section>`}`, (s.no >= 3 && s.no <= 9) && !blocker)
    requestAnimationFrame(() => document.querySelector('.pipe a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }))
    if (s.no === 3 && !blocker) return bindGraph(id, s)
    if ((s.no === 4 || s.no === 5) && !blocker) return bindDocs(id, s)
    if (s.no >= 6 && s.no <= 9 && !blocker) return bindMedia(id, s)
    if (s.no === 10 && !blocker) return bindRelease(id, s)
    bindStep(id, s)
  }

  // ─── 第 3 步：结构图画布 ───
  function graphShell(s) {
    const [stn, stc] = ST[s.status] || [s.status, '#888'], canW = can('writer') && s.status !== 'done', canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    return `<section class="card gcard"><div class="gh"><h2>第 3 步 · 结构图 <span class="pill" style="--c:${stc}">${stn}</span></h2><span class="mut sm hide-m">v${s.version} · ${esc(s.desc)}</span><span class="ge-grow"></span>
      ${canW ? `<button class="btn sm" data-gsave><i class="fas fa-floppy-disk"></i> 保存</button><button class="btn sm warn" data-gsubmit><i class="fas fa-paper-plane"></i> 提交审核</button>` : ''}
      ${canR && ['review', 'ready', 'stale'].includes(s.status) && s.output ? `<button class="btn sm ok" data-approve><i class="fas fa-check"></i> 审核通过 · 解锁下一步</button>` : ''}
      ${can('writer') && s.status === 'done' ? `<button class="btn sm bad" data-reopen><i class="fas fa-rotate-left"></i> 退回修改</button>` : ''}</div>
      ${s.status === 'done' ? '<div class="banner ok" style="margin-bottom:10px">已审核通过（只读）。如需修改请「退回修改」，下游步骤将全部失效。</div>' : ''}
      <div id="graph-editor"></div></section>`
  }
  function bindGraph(id, s) {
    const ed = window.GraphEditor.mount($('#graph-editor'), {
      graph: s.output || { start: '', nodes: [], edges: [] }, readonly: s.status === 'done' || !can('writer'), canAI: can('writer'), toast,
      api: (kind, b) => api(`/api/projects/${id}/graph/${kind}`, b)
    })
    let leaving = false
    const save = async (submit) => {
      if (ed.pending) throw new Error('还有 AI 提案未处理：请先「采纳」或「丢弃」')
      try { await api(`/api/projects/${id}/steps/3`, { output: ed.graph, submit }) } catch (e) { if (e.data?.issues) ed.setIssues(e.data.issues); throw e }
      ed.saved()
    }
    const q = (sel) => $(sel)
    q('[data-gsave]') && (q('[data-gsave]').onclick = async () => { try { await save(false); toast('已保存') } catch (e) { toast(e.message) } })
    q('[data-gsubmit]') && (q('[data-gsubmit]').onclick = async () => { try { await save(true); toast('已提交审核'); leaving = true; projectPage(id, 3) } catch (e) { toast(e.message) } })
    q('[data-approve]') && (q('[data-approve]').onclick = async () => { try { const r = await api(`/api/projects/${id}/steps/3/approve`, { note: prompt('审核意见（可空）', '') || '' }); toast(`已通过，第 ${r.next} 步已解锁`); leaving = true; location.hash = `#/p/${id}/${r.next}` } catch (e) { if (e.data?.issues) ed.setIssues(e.data.issues); toast(e.message) } })
    q('[data-reopen]') && (q('[data-reopen]').onclick = async () => { if (!confirm('退回后，所有下游步骤都会失效，需要重新审核。确定？')) return; try { const r = await api(`/api/projects/${id}/steps/3/reopen`, { note: prompt('退回原因', '') || '' }); toast(`已退回，${r.staled} 个下游步骤失效`); leaving = true; projectPage(id, 3) } catch (e) { toast(e.message) } })
    window.onbeforeunload = () => (!leaving && $('.ge-stat')?.textContent.includes('未保存') ? '有未保存的修改' : undefined)
  }

  // ─── 第 4/5 步：节点级工作台 ───
  function docsShell(s) {
    const [stn, stc] = ST[s.status] || [s.status, '#888'], canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    const ro = s.status === 'done' || !can('writer')
    return `<section class="card gcard"><div class="gh"><h2>第 ${s.no} 步 · ${esc(s.name)} <span class="pill" style="--c:${stc}">${stn}</span></h2><span class="mut sm hide-m">v${s.version} · ${esc(s.desc)}</span><span class="ge-grow"></span>
      ${!ro ? `<button class="btn sm warn" data-dsubmit><i class="fas fa-paper-plane"></i> 提交审核</button>` : ''}
      ${canR && ['review', 'ready', 'stale'].includes(s.status) && s.output ? `<button class="btn sm ok" data-approve><i class="fas fa-check"></i> 审核通过 · 解锁下一步</button>` : ''}
      ${can('writer') && s.status === 'done' ? `<button class="btn sm bad" data-reopen><i class="fas fa-rotate-left"></i> 退回修改</button>` : ''}</div>
      ${s.status === 'done' ? '<div class="banner ok" style="margin-bottom:10px">已审核通过（只读）。</div>' : s.status === 'review' ? '<div class="banner warn" style="margin-bottom:10px">已提交审核。审核前如有任何节点改动，需要重新提交。</div>' : ''}
      ${s.no === 5 ? '<p class="mut sm" style="margin:-4px 0 10px">流程：提示词 Agent 写提示词 → 连贯监管 Agent 对照剧情账本 / 上一段结尾审查 → 有硬伤自动打回重写一次 → 仍有冲突的节点留给人工处理。服装、伤痕、道具、地点由账本确定性写入「连贯性附录」。</p>' : '<p class="mut sm" style="margin:-4px 0 10px">剧本按结构图从起点逐层生成：一个节点的所有来路都写完，它的「入场剧情账本」才确定，才能开写。汇合节点只能依赖所有来路都成立的事实。</p>'}
      <div id="docs-wb"></div></section>`
  }
  function bindDocs(id, s) {
    window.DocsWorkbench.mount($('#docs-wb'), { pid: id, step: s.no, readonly: s.status === 'done' || !can('writer'), toast, api: (u, b) => api(u, b), onChange: () => { if (s.status === 'review') projectPage(id, s.no) } })
    const q = (sel) => $(sel)
    const showBad = (e) => { if (e.data?.bad?.length) toast(`${e.message}｜例如「${e.data.bad[0].title}」：${e.data.bad[0].state}`); else toast(e.message) }
    q('[data-dsubmit]') && (q('[data-dsubmit]').onclick = async () => { try { await api(`/api/projects/${id}/steps/${s.no}`, { submit: true }); toast('已提交审核'); projectPage(id, s.no) } catch (e) { showBad(e) } })
    q('[data-approve]') && (q('[data-approve]').onclick = async () => { try { const r = await api(`/api/projects/${id}/steps/${s.no}/approve`, { note: prompt('审核意见（可空）', '') || '' }); toast(`已通过，第 ${r.next} 步已解锁`); location.hash = `#/p/${id}/${r.next}` } catch (e) { showBad(e) } })
    q('[data-reopen]') && (q('[data-reopen]').onclick = async () => { if (!confirm('退回后，所有下游步骤都会失效。确定？')) return; try { await api(`/api/projects/${id}/steps/${s.no}/reopen`, { note: prompt('退回原因', '') || '' }); projectPage(id, s.no) } catch (e) { toast(e.message) } })
  }

  // ─── 第 6–9 步：素材工作台 ───
  function mediaShell(s) {
    const [stn, stc] = ST[s.status] || [s.status, '#888'], canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin'), ro = s.status === 'done' || !can('writer')
    return `<section class="card gcard"><div class="gh"><h2>第 ${s.no} 步 · ${esc(s.name)} <span class="pill" style="--c:${stc}">${stn}</span></h2><span class="mut sm hide-m">${esc(s.desc)}</span><span class="ge-grow"></span>
      ${!ro ? `<button class="btn sm warn" data-dsubmit><i class="fas fa-paper-plane"></i> 提交审核</button>` : ''}
      ${canR && ['review', 'ready', 'stale'].includes(s.status) && s.output ? `<button class="btn sm ok" data-approve><i class="fas fa-check"></i> 审核通过</button>` : ''}
      ${can('writer') && s.status === 'done' ? `<button class="btn sm bad" data-reopen><i class="fas fa-rotate-left"></i> 退回修改</button>` : ''}</div>
      ${s.status === 'done' ? '<div class="banner ok" style="margin-bottom:10px">已审核通过（只读）。</div>' : ''}
      <div id="media-wb"></div></section>`
  }
  function bindMedia(id, s) {
    const canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    window.MediaWorkbench.mount($('#media-wb'), { pid: id, step: s.no, readonly: s.status === 'done' || !can('writer'), canJudge: canR && s.status !== 'done', toast, api: (u, b) => api(u, b), onChange: () => { if (s.status === 'review') projectPage(id, s.no) } })
    const q = (sel) => $(sel)
    const showBad = (e) => toast(e.data?.bad?.length ? `${e.message}｜例如「${e.data.bad[0].title || e.data.bad[0].slot}」` : e.message)
    q('[data-dsubmit]') && (q('[data-dsubmit]').onclick = async () => { try { await api(`/api/projects/${id}/steps/${s.no}`, { submit: true }); toast('已提交审核'); projectPage(id, s.no) } catch (e) { showBad(e) } })
    q('[data-approve]') && (q('[data-approve]').onclick = async () => { try { const r = await api(`/api/projects/${id}/steps/${s.no}/approve`, { note: prompt('审核意见（可空）', '') || '' }); toast(r.next ? `已通过，第 ${r.next} 步已解锁` : '全部完成'); if (r.next) location.hash = `#/p/${id}/${r.next}`; else projectPage(id, s.no) } catch (e) { showBad(e) } })
    q('[data-reopen]') && (q('[data-reopen]').onclick = async () => { if (!confirm('退回后，所有下游步骤都会失效。确定？')) return; try { await api(`/api/projects/${id}/steps/${s.no}/reopen`, { note: prompt('退回原因', '') || '' }); projectPage(id, s.no) } catch (e) { toast(e.message) } })
  }

  // ─── 前置模拟 · 剧本评审 · 生成流程 ───
  async function insightPage(id) {
    const d = await api('/api/projects/' + id)
    frame('#/projects', `<a href="#/p/${id}" class="mut sm"><i class="fas fa-arrow-left"></i> ${esc(d.project.title)}</a>
      <h1 style="margin-top:6px">前置模拟 · 生成流程</h1><p class="sub">开拍前先看清：<b>能不能玩</b>（结构模拟）、<b>合不合理 / 吸不吸引人</b>（剧本评审）、<b>要拍哪些片段、按什么顺序、花多少钱</b>（生成清单）。除「剧本评审」一次对话调用外，全部免费。</p>
      <div id="insight-p"></div>`, true)
    window.InsightPanel.mount($('#insight-p'), { pid: id, canWrite: can('writer'), toast, api: (u, b) => api(u, b), goStep: (n) => { location.hash = `#/p/${id}/${n}` } })
  }

  // ─── 第 10 步：预检 · 上架 ───
  function releaseShell(s) {
    const [stn, stc] = ST[s.status] || [s.status, '#888'], canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    return `<section class="card gcard"><div class="gh"><h2>第 10 步 · ${esc(s.name)} <span class="pill" style="--c:${stc}">${stn}</span></h2><span class="mut sm hide-m">${esc(s.desc)}</span><span class="ge-grow"></span>
      ${can('writer') && s.status !== 'done' && s.status !== 'running' ? `<button class="btn sm warn" data-dsubmit><i class="fas fa-paper-plane"></i> 提交审核</button>` : ''}
      ${canR && s.status === 'review' ? `<button class="btn sm ok" data-approve><i class="fas fa-rocket"></i> 审核通过 · 发布</button>` : ''}
      ${can('writer') && s.status === 'done' ? `<button class="btn sm" data-reopen><i class="fas fa-code-branch"></i> 迭代新版本</button>` : ''}</div>
      ${s.status === 'done' ? '<div class="banner ok" style="margin-bottom:10px">已发布到玩家端。要更新内容：点「迭代新版本」→ 改上游步骤或上架信息 → 重新打包 → 审核发布（线上版本在新版发布前不受影响）。</div>' : ''}
      <div id="release-p"></div></section>`
  }
  function bindRelease(id, s) {
    const canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    window.ReleasePanel.mount($('#release-p'), { pid: id, readonly: s.status === 'done' || !can('writer'), canJudge2: canR, playerOrigin: S.state?.player_origin || '', toast, api: (u, b) => api(u, b), onChange: () => projectPage(id, 10) })
    const q = (sel) => $(sel)
    q('[data-dsubmit]') && (q('[data-dsubmit]').onclick = async () => { try { await api(`/api/projects/${id}/steps/10`, { submit: true }); toast('已提交审核'); projectPage(id, 10) } catch (e) { toast(e.message) } })
    q('[data-approve]') && (q('[data-approve]').onclick = async () => { if (!confirm('审核通过后立即发布到玩家端。确定？')) return; try { const r = await api(`/api/projects/${id}/steps/10/approve`, { note: prompt('审核意见（可空）', '') || '' }); toast(`已发布 ${r.published?.series_id} v${r.published?.version}`); projectPage(id, 10) } catch (e) { toast(e.message) } })
    q('[data-reopen]') && (q('[data-reopen]').onclick = async () => { try { await api(`/api/projects/${id}/steps/10/reopen`, { note: '迭代新版本' }); projectPage(id, 10) } catch (e) { toast(e.message) } })
  }

  // ─── 执行节点（admin）───
  async function nodesPage() {
    const d = await api('/api/nodes'), set = await api('/api/media-settings')
    frame('#/nodes', `<h1>执行节点</h1><p class="sub">即梦 CLI、gsk、视频后处理与一致性检测跑在执行节点上（有 ffmpeg 的常驻机器）。方舟 / 中转站 API 由后台直连，不需要节点，但<b>后处理与质检仍需要至少一个带 post 能力的节点</b>。</p>
      <div class="card"><h3>节点</h3>${d.nodes.length ? `<div class="tbl"><table><tr><th>名称</th><th>能力</th><th>状态</th><th>最近心跳</th><th></th></tr>${d.nodes.map((n) => `<tr><td><b>${esc(n.name)}</b><div class="mut sm">${esc(n.id)} ${esc(n.info?.v || '')}</div></td><td>${(n.kinds || []).map((k) => `<span class="chip">${esc(k)}</span>`).join(' ')}</td><td>${!n.enabled ? '<span class="bad-t">已停用</span>' : n.online ? '<span class="ok-t">● 在线</span>' : '<span class="mut">离线</span>'}${n.info?.balance != null ? `<div class="mut sm">gsk 余额 ${n.info.balance}</div>` : ''}</td><td class="mut sm">${fmtT(n.last_seen)}</td><td><button class="btn sm" data-tog="${n.id}" data-e="${n.enabled ? 0 : 1}">${n.enabled ? '停用' : '启用'}</button></td></tr>`).join('')}</table></div>` : '<p class="mut">还没有节点</p>'}
        <p class="mut sm">队列：${d.queue.map((q) => `${q.phase}/${q.status} ${q.n}`).join('，') || '空'}</p></div>
      <div class="card"><h3>新建节点</h3><form id="nf" class="grid g4"><input class="inp" name="name" placeholder="名称，例如：剪辑室 Mac mini" required>
        <label class="chk"><input type="checkbox" name="k" value="post" checked> post 后处理/质检</label><label class="chk"><input type="checkbox" name="k" value="jimeng_cli"> 即梦 CLI</label><label class="chk"><input type="checkbox" name="k" value="gsk"> gsk</label><label class="chk"><input type="checkbox" name="k" value="mock_video" checked> 模拟视频</label><label class="chk"><input type="checkbox" name="k" value="mock_image" checked> 模拟图片</label>
        <button class="btn pri" type="submit">创建并获取令牌</button></form><div id="tok"></div></div>
      <div class="card"><h3>生产参数</h3><form id="sf2" class="grid g4"><label class="f">同时生成上限<input class="inp" type="number" name="max_concurrent" min="1" max="32" value="${set.max_concurrent}"></label><label class="f">衔接分下限（0–1）<input class="inp" type="number" step="0.05" name="seam_min" value="${set.seam_min}"></label><label class="f">人物一致下限（0–10）<input class="inp" type="number" name="face_min" value="${set.face_min}"></label><label class="f">字幕帧比例上限<input class="inp" type="number" step="0.05" name="subs_max" value="${set.subs_max}"></label><label class="chk"><input type="checkbox" name="auto_retry" ${set.auto_retry ? 'checked' : ''}> 失败/不合格自动重拍（≤3 次）</label><button class="btn" type="submit">保存</button></form></div>`)
    document.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = async () => { await api('/api/nodes/' + b.dataset.tog, { enabled: b.dataset.e === '1' }); nodesPage() }))
    $('#nf').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { const r = await api('/api/nodes', { name: fd.get('name'), kinds: fd.getAll('k') }); $('#tok').innerHTML = `<div class="banner warn" style="margin-top:12px">令牌只显示这一次，请立即保存：<pre class="code-b">${esc(r.token)}</pre>在节点机器上运行：<pre class="code-b">STUDIO=${esc(location.origin)} NODE_TOKEN=${esc(r.token)} KINDS=${esc(fd.getAll('k').join(','))} python3 scripts/studio/studio_node.py</pre></div>` } catch (er) { toast(er.message) } }
    $('#sf2').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api('/api/media-settings', { ...fd, auto_retry: !!fd.auto_retry }); toast('已保存') } catch (er) { toast(er.message) } }
  }

  function stepBody(s) {
    const out = s.output, canW = can('writer'), canR = S.me && (S.me.role === 'reviewer' || S.me.role === 'admin')
    const acts = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      ${canW && s.status !== 'done' ? `<button class="btn" data-save><i class="fas fa-floppy-disk"></i> 保存草稿</button><button class="btn warn" data-submit><i class="fas fa-paper-plane"></i> 提交审核</button>` : ''}
      ${canR && ['review', 'ready', 'stale'].includes(s.status) && out ? `<button class="btn ok" data-approve><i class="fas fa-check"></i> 审核通过 · 解锁下一步</button>` : ''}
      ${canW && s.status === 'done' ? `<button class="btn bad" data-reopen><i class="fas fa-rotate-left"></i> 退回修改（下游全部失效）</button>` : ''}</div>`
    if (s.no === 1) {
      const v = out || s.input || {}
      return `<form id="sf" class="grid g2"><label class="f" style="grid-column:1/-1">主题 / 一句话创意<textarea class="inp" name="theme" required>${esc(v.theme || '')}</textarea></label>
        <label class="f">形态<select class="inp" name="format">${[['live', '真人剧'], ['anime', '漫剧'], ['abstract', '抽象剧']].map(([k, n]) => `<option value="${k}" ${v.format === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">题材<input class="inp" name="genre" value="${esc(v.genre || '')}" placeholder="revenge / romance / …"></label>
        <label class="f">受众<select class="inp" name="audience">${[['all', '全年龄'], ['female', '女性向'], ['male', '男性向']].map(([k, n]) => `<option value="${k}" ${v.audience === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">规模<select class="inp" name="scale">${[['pilot', '试播集'], ['standard', '标准剧'], ['epic', '长篇']].map(([k, n]) => `<option value="${k}" ${v.scale === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">预算（元，0=不限）<input class="inp" name="budget" type="number" min="0" value="${esc(v.budget ?? 0)}"></label></form>${acts}`
    }
    const runnable = s.no === 2
    return `${runnable && can('writer') && s.status !== 'done' ? `<button class="btn pri" data-run><i class="fas fa-wand-magic-sparkles"></i> 调用 ${esc(s.agent)} 生成</button>` : `<div class="banner warn">本步的 Agent 将在 P4/P5 接入；现在可以手动粘贴 JSON 产出 → 提交审核，用来验证卡关流程。</div>`}
      <label class="f" style="margin-top:12px">产出（JSON）<textarea class="inp code" id="so" ${s.status === 'done' || !canW ? 'readonly' : ''}>${esc(out ? JSON.stringify(out, null, 2) : '')}</textarea></label>${acts}`
  }

  function bindStep(id, s) {
    const q = (sel) => $(sel)
    const collect = () => {
      if (s.no === 1) { const fd = Object.fromEntries(new FormData($('#sf'))); fd.budget = +fd.budget || 0; if (!fd.theme?.trim()) throw new Error('请填写主题'); return fd }
      const t = $('#so').value.trim(); if (!t) throw new Error('产出为空'); try { return JSON.parse(t) } catch { throw new Error('产出不是合法 JSON') }
    }
    const go = async (fn) => { try { await fn(); projectPage(id, s.no) } catch (er) { toast(er.message) } }
    q('[data-save]') && (q('[data-save]').onclick = () => go(async () => { await api(`/api/projects/${id}/steps/${s.no}`, { output: collect() }); toast('已保存') }))
    q('[data-submit]') && (q('[data-submit]').onclick = () => go(async () => { await api(`/api/projects/${id}/steps/${s.no}`, { output: collect(), submit: true }); toast('已提交审核') }))
    q('[data-approve]') && (q('[data-approve]').onclick = () => go(async () => { const r = await api(`/api/projects/${id}/steps/${s.no}/approve`, { note: prompt('审核意见（可空）', '') || '' }); toast(r.next ? `已通过，第 ${r.next} 步已解锁` : '全部完成'); if (r.next) location.hash = `#/p/${id}/${r.next}` }))
    q('[data-reopen]') && (q('[data-reopen]').onclick = () => go(async () => { if (!confirm('退回后，所有下游步骤都会失效，需要重新审核。确定？')) throw new Error('已取消'); const r = await api(`/api/projects/${id}/steps/${s.no}/reopen`, { note: prompt('退回原因', '') || '' }); toast(`已退回，${r.staled} 个下游步骤失效`) }))
    q('[data-run]') && (q('[data-run]').onclick = (e) => go(async () => { e.target.disabled = true; e.target.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中…'; const r = await api(`/api/projects/${id}/steps/${s.no}/run`, {}); toast(`生成完成 · ${r.latency_ms}ms`) }))
  }

  // ─── Agent 配置中心 ───
  async function configPage() {
    const d = S.cfg = await api('/api/config'), adm = can('admin')
    const pvOpts = (cap, sel) => d.providers.filter((p) => { const k = d.kinds[p.kind]; return k && (k.cap === 'any' || k.cap === cap) }).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
    const use = Object.fromEntries(d.usage.map((u) => [u.agent, u]))
    frame('#/config', `<h1>Agent 配置中心</h1><p class="sub">生产线上的每个 Agent 都在这里统一分配服务商、模型、参数、提示词版本和预算。<b>API Key 加密后入库，任何接口都只返回掩码。</b></p>
      ${d.master_key_ok ? '' : '<div class="banner bad">✗ 服务器未配置 STUDIO_MASTER_KEY，无法保存 API Key。请在环境变量中设置（≥16 位随机字符串）。</div>'}
      ${adm ? `<section class="card sl-card"><h2><i class="fas fa-bolt"></i> 一键接入 算力网 suanli.com</h2>
        <p class="sub">一个 Key 覆盖全部生产线：<b>对话</b>（DeepSeek V4 Pro 0813 / Flash 0731 / 豆包 Seed 2.0 —— 编剧、结构、剧本、提示词、连贯监管、评审、合规、视觉质检）· <b>图片</b>（万相 2.7 Image Pro ¥0.5/张 —— 设定图、封面）· <b>视频</b>（Seedance 2.0 —— 主线参考图 + 分支首帧接力，有声 720p ≈ ¥1/秒、1080p ≈ ¥2.5/秒，按 token 计费）。Key 加密入库，只显示掩码。下方「模型目录」按类别列出全部模型、文档参数和价格；每个 Agent 的模型下拉只显示适配它的模型。</p>
        ${d.providers.some((p) => p.kind === 'suanli') ? `<div class="banner ok">已接入：${esc(d.providers.find((p) => p.kind === 'suanli').key_hint)}（再次提交可更换 Key 或重新套用推荐配置）</div>` : ''}
        <form id="slf" class="sl-form"><input class="inp" name="key" type="password" autocomplete="off" placeholder="算力网 API Key（sk-…），在 suanli.com → API Keys 创建">
        <label class="chk"><input type="checkbox" name="all" checked> 同时把 11 个 Agent 切到算力网推荐模型</label><button class="btn pri" type="submit"><i class="fas fa-plug-circle-check"></i> 保存并测试</button></form><div id="slr"></div></section>` : ''}
      <section class="card"><h2><i class="fas fa-plug"></i> 服务商 ${adm ? '<button class="btn sm pri" id="addp" style="float:right"><i class="fas fa-plus"></i> 添加服务商</button>' : ''}</h2>
        ${d.providers.map((p) => `<div class="prov"><div class="nm"><b>${esc(p.name)}</b> <span class="pill" style="--c:#7dd3fc">${esc(p.kind_name)}</span><div class="mut sm">${esc(p.base_url || '—')} · Key：${p.has_key ? esc(p.key_hint) : '<span class="warn-t">未设置</span>'}</div></div>
          <span class="pill" style="--c:${p.enabled ? '#3ddc97' : '#6b7280'}">${p.enabled ? '启用' : '停用'}</span>
          ${adm ? `<button class="btn sm" data-test="${p.id}"><i class="fas fa-stethoscope"></i> 连通测试</button><button class="btn sm" data-editp="${p.id}">编辑</button>` : ''}</div>`).join('')}</section>
      <section class="card"><h2><i class="fas fa-robot"></i> 生产 Agent（${d.agents.length}）</h2>
        ${d.agents.map((a) => `<div class="agent" data-agent="${a.code}"><div class="nm"><b>${esc(a.name)} <span class="mut sm">· 第 ${a.step} 步</span></b><small>${esc(a.duty)}</small><small>${a.code} · ${a.capability} · 提示词 v${a.prompt_version}${use[a.code] ? ` · 7 天 ${use[a.code].n} 次 / 成功 ${use[a.code].ok} / ${use[a.code].ms}ms` : ''}</small></div>
          <select class="inp" name="provider_id" ${adm ? '' : 'disabled'}><option value="">— 未配置 —</option>${pvOpts(a.capability, a.provider_id)}</select>
          <input class="inp" name="model" value="${esc(a.model || '')}" placeholder="模型 ID" ${adm ? '' : 'disabled'}>
          <input class="inp" name="budget" type="number" min="0" value="${a.budget}" title="预算（0=不限）" ${adm ? '' : 'disabled'}>
          <div style="display:flex;gap:6px">${adm ? `<button class="btn sm pri" data-savea>保存</button><button class="btn sm" data-more>详细</button>` : ''}</div></div>`).join('')}</section>`)
    if (window.SuanliUI) window.SuanliUI.enhance({ cfg: d, api, toast, reload: configPage, esc, adm })
    if (!adm) return
    $('#slf').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true; $('#slr').innerHTML = '<p class="mut sm"><i class="fas fa-spinner fa-spin"></i> 保存并连通测试…</p>'
      try { const r = await api('/api/providers/suanli/connect', { key: fd.get('key') || undefined, agents: fd.get('all') ? undefined : ['__none__'] }); $('#slr').innerHTML = `<div class="banner ${r.test.ok ? 'ok' : 'bad'}">${r.test.ok ? '✓' : '✗'} ${esc(r.test.note)}${r.agents.length ? `<br>已切换 Agent：${r.agents.map(esc).join('、')}` : ''}</div>`; if (r.test.ok) setTimeout(configPage, 1800) } catch (er) { $('#slr').innerHTML = `<div class="banner bad">${esc(er.message)}</div>` } btn.disabled = false }
    $('#addp').onclick = () => providerModal()
    document.querySelectorAll('[data-editp]').forEach((b) => (b.onclick = () => providerModal(d.providers.find((p) => p.id === b.dataset.editp))))
    document.querySelectorAll('[data-test]').forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/providers/${b.dataset.test}/test`, {}); toast(`${r.ok ? '✓' : '✗'} ${r.note}${r.ms ? ` · ${r.ms}ms` : ''}`) } catch (er) { toast(er.message) } b.disabled = false }))
    document.querySelectorAll('[data-agent]').forEach((row) => {
      const code = row.dataset.agent, pick = (n) => row.querySelector(`[name=${n}]`).value
      row.querySelector('[data-savea]').onclick = async () => { try { const r = await api('/api/agents/' + code, { provider_id: pick('provider_id') || undefined, model: pick('model'), budget: +pick('budget') || 0 }); toast('已保存 ' + code + (r.fixes?.length ? '（已按文档修正参数：' + r.fixes.join('；') + '）' : '')) } catch (er) { toast(er.message) } }
      row.querySelector('[data-more]').onclick = () => agentModal(d.agents.find((a) => a.code === code))
    })
  }

  function modal(html, bind) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="card">${html}</div>`; document.body.appendChild(m)
    m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove() }; bind(m); return m
  }
  function providerModal(p) {
    const K = S.cfg.kinds
    modal(`<h2>${p ? '编辑' : '添加'}服务商</h2><form id="pf" class="grid"><label class="f">名称<input class="inp" name="name" value="${esc(p?.name || '')}" required></label>
      <label class="f">类型<select class="inp" name="kind">${Object.entries(K).map(([k, v]) => `<option value="${k}" ${p?.kind === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label><p class="mut sm" id="kh"></p>
      <label class="f">Base URL<input class="inp" name="base_url" value="${esc(p && !String(p.base_url).startsWith('$') ? p.base_url : '')}" placeholder="https://ark.cn-beijing.volces.com"></label>
      <label class="f">API Key ${p?.has_key ? `（当前 ${esc(p.key_hint)}，留空不修改）` : ''}<input class="inp" name="key" type="password" autocomplete="off" placeholder="${p?.has_key ? '留空 = 不修改' : 'sk-…'}"></label>
      <label class="f">高级（JSON，可选：submit_path / query_path / body）<textarea class="inp code" name="extra" style="min-height:80px">${esc(p ? JSON.stringify(p.extra || {}, null, 2) : '{}')}</textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end">${p ? `<button type="button" class="btn bad" id="delp">删除</button>` : ''}<button type="button" class="btn" data-close>取消</button><button class="btn pri" type="submit">保存</button></div></form>`, (m) => {
      const k = m.querySelector('[name=kind]'), h = m.querySelector('#kh'); const upd = () => (h.textContent = K[k.value].hint); k.onchange = upd; upd()
      m.querySelector('#pf').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { fd.extra = JSON.parse(fd.extra || '{}') } catch { return toast('高级配置不是合法 JSON') } if (!fd.key) delete fd.key; if (p) fd.id = p.id; try { await api('/api/providers', fd); m.remove(); toast('已保存'); configPage() } catch (er) { toast(er.message) } }
      const del = m.querySelector('#delp'); if (del) del.onclick = async () => { if (!confirm('删除该服务商？')) return; try { await api(`/api/providers/${p.id}/delete`, {}); m.remove(); configPage() } catch (er) { toast(er.message) } }
    })
  }
  async function agentModal(a) {
    const hist = await api(`/api/agents/${a.code}/prompts`).catch(() => [])
    modal(`<h2>${esc(a.name)} <span class="mut sm">${a.code}</span></h2><form id="af2" class="grid">
      <label class="f">系统提示词（保存即生成新版本 v${a.prompt_version + 1}）<textarea class="inp code" name="prompt">${esc(a.prompt || '')}</textarea></label>
      <label class="f">参数（JSON）<textarea class="inp code" name="params" style="min-height:90px">${esc(JSON.stringify(a.params || {}, null, 2))}</textarea></label>
      <div class="grid g2"><label class="f">单价（元 / 千 token 或 / 次）<input class="inp" name="unit_price" type="number" step="0.0001" value="${a.unit_price || 0}"></label><label class="f">已花费<input class="inp" value="${a.spent}" disabled></label></div>
      ${a.capability === 'text' ? '<button type="button" class="btn" id="try"><i class="fas fa-vial"></i> 试运行（真实调用一次）</button><pre class="out" id="tryo" style="display:none"></pre>' : ''}
      <div class="mut sm">历史版本：${hist.length ? hist.map((h) => `v${h.version}（${fmtT(h.created_at)}）`).join('、') : '无'}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-close>关闭</button><button class="btn pri" type="submit">保存</button></div></form>`, (m) => {
      m.querySelector('#af2').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { fd.params = JSON.parse(fd.params || '{}') } catch { return toast('参数不是合法 JSON') } fd.unit_price = +fd.unit_price || 0; try { const r = await api('/api/agents/' + a.code, fd); toast(`已保存 · 提示词 v${r.prompt_version}`); m.remove(); configPage() } catch (er) { toast(er.message) } }
      const t = m.querySelector('#try'); if (t) t.onclick = async () => { t.disabled = true; t.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 调用中…'; const o = m.querySelector('#tryo'); o.style.display = 'block'; try { const r = await api(`/api/agents/${a.code}/try`, {}); o.textContent = `✓ ${r.model} · ${r.latency_ms}ms\n\n${r.text}` } catch (er) { o.textContent = '✗ ' + er.message } t.disabled = false; t.innerHTML = '<i class="fas fa-vial"></i> 再试一次' }
    })
  }

  // ─── 账号 / 审计 ───
  async function usersPage() {
    const us = await api('/api/users')
    frame('#/users', `<h1>账号与角色</h1><p class="sub">管理员：全部权限（含 API Key）；编剧：创建项目、调用 Agent、提交；审核：查看、审核通过。</p>
      <div class="card"><h3>新建账号</h3><form id="uf" class="grid g4"><input class="inp" name="email" type="email" placeholder="邮箱" required><input class="inp" name="name" placeholder="名字"><select class="inp" name="role"><option value="writer">编剧</option><option value="reviewer">审核</option><option value="admin">管理员</option></select><input class="inp" name="password" type="password" placeholder="初始密码（≥10 位）" required minlength="10"><button class="btn pri" type="submit">创建</button></form></div>
      <div class="card"><table><tr><th>账号</th><th>角色</th><th>状态</th><th>最近登录</th><th></th></tr>${us.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="mut sm">${esc(u.email)}</div></td><td>${ROLE[u.role]}</td><td>${u.disabled ? '<span class="bad-t">已停用</span>' : '<span class="ok-t">正常</span>'}</td><td class="mut sm">${fmtT(u.last_login)}</td><td>${u.id === S.me.id ? '<span class="mut sm">（我）</span>' : `<button class="btn sm" data-tog="${u.id}" data-d="${u.disabled ? 0 : 1}">${u.disabled ? '启用' : '停用'}</button>`}</td></tr>`).join('')}</table></div>`)
    $('#uf').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/users', Object.fromEntries(new FormData(e.target))); toast('已创建'); usersPage() } catch (er) { toast(er.message) } }
    document.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = async () => { try { await api('/api/users/' + b.dataset.tog, { disabled: b.dataset.d === '1' }); usersPage() } catch (er) { toast(er.message) } }))
  }
  async function auditPage() {
    const [a, r] = await Promise.all([api('/api/audit'), api('/api/runs')])
    frame('#/audit', `<h1>审计与调用记录</h1><div class="grid g2"><div class="card"><h3>操作审计</h3><table>${a.map((x) => `<tr><td class="mut sm">${fmtT(x.created_at)}</td><td>${esc(x.action)}</td><td class="sm">${esc(x.email || x.target || '')}</td></tr>`).join('')}</table></div>
      <div class="card"><h3>Agent 调用</h3><table>${r.map((x) => `<tr><td class="mut sm">${fmtT(x.created_at)}</td><td>${esc(x.agent)}</td><td><span class="pill" style="--c:${x.status === 'error' ? '#ff5d73' : '#3ddc97'}">${esc(x.status)}</span></td><td class="sm">${x.latency_ms}ms${x.error ? `<div class="bad-t">${esc(x.error.slice(0, 80))}</div>` : ''}</td></tr>`).join('')}</table></div></div>`)
  }

  async function route() {
    try {
      if (!S.state || !S.me) { S.state = await api('/api/auth/state'); S.me = S.state.user }
      if (!S.me) return authPage()
      const h = location.hash.replace(/^#\/?/, '').split('/')
      if (h[0] === 'p' && h[1] && h[2] === 'insight') return insightPage(h[1])
      if (h[0] === 'p' && h[1]) return projectPage(h[1], +h[2] || 0)
      if (h[0] === 'config') return configPage()
      if (h[0] === 'nodes' && can('admin')) return nodesPage()
      if (h[0] === 'users' && can('admin')) return usersPage()
      if (h[0] === 'audit' && can('admin')) return auditPage()
      return projectsPage()
    } catch (er) { if (S.me) toast(er.message) }
  }
  addEventListener('hashchange', route); route()
})()
