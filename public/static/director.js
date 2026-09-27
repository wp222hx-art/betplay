// 导演台：一句主题 → 剧本（自动植入博弈抉择）→ 预算确认 → 开拍 → 实时进度/积分 → 审核 → 上架
;(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, body) => { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.df_admin || '' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.message || '请求失败'); return j }
  const toast = (m) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) } t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600) }
  const root = $('#director')
  const S = { meta: null, cat: 'anime', genre: '', scale: 'pilot', auto: true, brief: null, active: null, timer: null }
  const JS = { queued: ['排队', '#64748b'], running: ['生成中', '#f5a524'], review: ['待审核', '#c084fc'], approved: ['通过', '#3ddc97'], failed: ['失败', '#ff5d73'] }
  const KIND = { sheet: '设定图', cover: '封面', clip: '片段' }
  const IDEAS = { anime: ['转生成恶役千金，王子们都不按剧本来了', '病弱师尊其实是魔尊，只有我知道', '我的 AI 女友觉醒了，开始吃醋和说谎', '全民觉醒日，F 级废柴解锁隐藏职业'], live: ['被丈夫和闺蜜推下游轮，三年后她换了一张脸回来', '澳门最高赌桌，荷官是前女友，对面是杀父仇人', '冷面总裁深夜加班，只对你失控', '午夜出租车，后视镜里的红裙乘客没有倒影'], abstract: ['公司被一只橘猫收购了，它只会说喵却决定谁被裁', '第 999 次星期一，我决定干点离谱的事', '前任变成了楼下的自动售货机，投币说真心话', '冰箱里住着另一个我，要和我换一天人生'] }
  const GENRES = [['', '自动识别'], ['romance', '恋爱·甜宠'], ['urban', '都市·豪门'], ['revenge', '复仇·逆袭'], ['suspense', '悬疑·惊悚'], ['costume', '古风·仙侠'], ['fantasy', '奇幻·科幻'], ['action', '动作·犯罪'], ['survival', '末日·生存'], ['absurd', '无厘头·整活'], ['surreal', '超现实·梦核']]

  async function load() {
    try { S.meta = await api('/api/director/meta') } catch (e) { root.innerHTML = `<div class="st-card"><h3>需要管理员权限</h3><p class="mut">${esc(e.message)}</p><input id="ak" class="inp2" placeholder="管理员密钥"><button class="btn2" id="aks" style="margin-top:8px">保存</button></div>`; $('#aks').onclick = () => { localStorage.df_admin = $('#ak').value; load() }; return }
    render()
  }

  function render() {
    const M = S.meta, sc = M.scales
    const w = M.workers[0], online = w && Date.now() - w.seen_at < 90000
    root.innerHTML = `
      <header class="st-head"><h1><i class="fas fa-video"></i> 导演台</h1><p>输入一句主题 → AI 编剧自动写好剧情树与<b>博弈抉择</b>（常规选项 · 隐藏支 · 时间裂隙）→ 预算确认 → 后台自动生成视频、质检、上架，积分逐笔核算。</p></header>
      <section class="dk-status">
        <div><span>worker</span><b class="${online ? 'ok' : 'bad'}">${online ? '● 在线' : '○ 离线'}</b><em>${w ? esc(w.worker) + (w.running ? ' · ' + esc(w.running) : '') : '未连接'}</em></div>
        <div><span>积分余额</span><b>${w?.balance != null ? Math.round(w.balance).toLocaleString() : '—'}</b><em>worker 上报</em></div>
        <div><span>累计消耗</span><b>${M.total_spent.toLocaleString()}</b><em>${M.entries} 笔</em></div>
      </section>
      <section class="st-card dk-brief">
        <h3><i class="fas fa-wand-magic-sparkles"></i> ① 主题</h3>
        <div class="seg">${[['anime', 'fa-wand-magic-sparkles', '漫剧'], ['live', 'fa-film', '真人剧'], ['abstract', 'fa-shapes', '抽象剧']].map(([k, ic, n]) => `<button class="${S.cat === k ? 'on' : ''}" data-cat="${k}"><i class="fas ${ic}"></i> ${n}</button>`).join('')}</div>
        <p class="mut sm">${{ anime: '漫剧：AI 动画（日漫/国漫/韩漫画风），人设鲜明、成本最低', live: '真人剧：AI 真人电影质感竖屏短剧，强冲突强反转', abstract: '抽象剧：超现实 / 无厘头 / 梦核，荒诞设定一本正经地演，最适合二创传播' }[S.cat]}</p>
        <div class="genre-pick">${GENRES.map(([k, n]) => `<button class="${S.genre === k ? 'on' : ''}" data-genre="${k}">${n}</button>`).join('')}</div>
        <textarea id="theme" class="inp2 ta" rows="3" placeholder="例如：${esc(IDEAS[S.cat][0])}">${esc(S.theme || '')}</textarea>
        <div class="ideas">${IDEAS[S.cat].map((x) => `<button data-idea="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <h3 style="margin-top:14px"><i class="fas fa-layer-group"></i> ② 规模 · 预算</h3>
        <div class="scales">${Object.entries(sc).map(([k, v]) => `<button class="${S.scale === k ? 'on' : ''}" data-scale="${k}"><b>${v.name}</b><span>${v.clips} 段 · ${v.endings} 结局 · ${v.nodes} 抉择点</span><em>≈ ${v.credits.toLocaleString()} 积分</em></button>`).join('')}</div>
        <label class="chk"><input type="checkbox" id="auto" ${S.auto ? 'checked' : ''}> 全自动：AI 质检通过即审核，全部通过自动上架</label>
        <button class="btn2 big" id="go"><i class="fas fa-pen-nib"></i> AI 编剧 · 生成剧本与博弈抉择</button>
        <p class="mut sm">价目：12s 片段 ≈ ${M.price.clip12} · 10s ≈ ${M.price.clip10} · 设定图 ${M.price.sheet} · 封面 ${M.price.cover}（Seedance 2.0 mini / nano-banana-pro 实测）</p>
      </section>
      <section class="st-card"><h3><i class="fas fa-coins"></i> 命运等级 · 收益模型</h3>
        <div class="fate-lad">${[['👑', '黄金结局', '押注≥200 · 押中≥1', '奖池 2%（≤400）· 卡稀有度+1 · 黄金彩蛋'], ['🏆', '白金结局', '押注≥600 · 押中≥2 · 净赢≥200', '奖池 5%（≤1200）· 卡+2 · 白金彩蛋'], ['💎', '钻石结局', '押注≥1500 · 每幕全押全中 · 净赢≥800', '奖池 12%（≤3000）· 卡+3 · 钻石彩蛋']].map(([i, n, c, r]) => `<div><b>${i} ${n}</b><span>条件：${c}</span><em>奖励：${r}</em></div>`).join('')}</div>
        <p class="mut sm">奖池来源：每笔下注 2% + 悔棋税 30%（均从平台收入划转，复式记账）；分红按奖池比例派发，奖池越少发得越少 → 平台永不超发。高阶结局卡参考价 ×1.2 / ×1.5 / ×2，交易再抽 5%。</p></section>
      <section class="st-card" id="funnel-card"><h3><i class="fas fa-filter"></i> 增长实验 · 抽象剧拉新 → 真人剧变现 <small class="mut">近 7 天 · 去重用户</small></h3><div id="funnel" class="mut sm">加载中…</div></section>
      <div id="brief-out"></div>
      <section class="st-card"><h3><i class="fas fa-list-check"></i> 生产中 / 历史</h3>
        ${M.projects.length ? M.projects.map((p) => `<div class="dk-row" data-open="${p.id}"><div><b>${esc(p.title)}</b><span>${esc(p.scale || '')} · ${p.status}</span></div><div class="bar"><i style="width:${p.est ? Math.min(100, (p.spent / p.est) * 100) : 0}%"></i></div><em>${(p.spent || 0).toLocaleString()} / ${(p.est || 0).toLocaleString()}</em></div>`).join('') : '<p class="mut">还没有项目</p>'}</section>
      <div id="prj"></div>`
    api('/api/admin/funnel').then((f) => {
      const top = Math.max(1, f.steps[0].u)
      $('#funnel').innerHTML = `<div class="fnl">${f.steps.map((x, i) => `<div class="fs"><span>${esc(x.name)}</span><div class="fb"><i style="width:${Math.max(2, (x.u / top) * 100)}%"></i></div><b>${x.u}</b><em>${i ? (f.steps[i - 1].u ? Math.round((x.u / f.steps[i - 1].u) * 100) + '%' : '—') : ''}</em></div>`).join('')}</div>
        <div class="fk"><div><b>${f.k_factor}</b><span>K 因子（邀请新人 / 抽象剧开局）</span></div><div><b>${f.referrals.bound}/${f.referrals.rewarded}</b><span>邀请绑定 / 已奖励</span></div><div><b>${f.contrarian.rounds}</b><span>独行侠命中 · 发放 ${f.contrarian.paid}</span></div></div>`
    }).catch(() => {})
    if (S.brief) showBrief(S.brief)
    if (S.active) openProject(S.active)
  }

  function showBrief(b) {
    const v = b.validation
    $('#brief-out').innerHTML = `<section class="st-card dk-script"><h3><i class="fas fa-scroll"></i> ③ 剧本就绪 · 《${esc(b.title)}》 <small class="mut">${esc(b.model)}</small></h3>
      <div class="dk-cast">${b.cast.map((c) => `<div><b>${esc(c.name)}</b><span>${esc(c.role)}</span></div>`).join('')}</div>
      <div class="dk-v ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ 结构校验通过' : '✗ ' + v.errors.join('；')} · ${v.nodes} 抉择点 · ${v.endings} 结局 · ${v.forks} 时间裂隙 · ${v.clips} 段 · <b>${b.estimate.credits.toLocaleString()} 积分</b>${b.fixes?.length ? ` · 自动修复 ${b.fixes.length} 处` : ''}${b.secs ? ` · 用时 ${b.secs}s` : ''}</div>
      ${b.lint?.length ? `<div class="dk-v bad">⚠ 编剧质检提示（不阻断开拍，建议重生成或人工精修）：${b.lint.map(esc).join('；')}</div>` : ''}
      <div id="tree-host" class="mut sm">加载剧情树…</div>
      <div class="dk-go"><button class="btn2 big" data-green="${b.id}" ${v.ok ? '' : 'disabled'}><i class="fas fa-clapperboard"></i> 确认开拍 · 预计消耗 ${b.estimate.credits.toLocaleString()} 积分</button></div></section>`
    api('/api/studio/projects/' + b.id).then((d) => { $('#tree-host').innerHTML = treeHtml(d.tree) }).catch(() => {})
  }
  const treeHtml = (t) => `<div class="tree2">${t.nodes.map((n) => `<div class="tn"><b>${esc(n.id)}</b> ${esc(n.question)}${n.fork ? ` <em class="fk">⟲ 时间裂隙 → ${esc(n.fork.node)}</em>` : ''}<div>${n.options.map((o) => `<span class="${o.twist ? 'tw' : ''} ${o.next ? '' : 'end'}" title="${esc(t.clips[o.id]?.lines?.map((l) => l.speaker + '：' + l.text).join('\n') || '')}">${o.twist ? '✦ ' : ''}${esc(o.label)}${o.next ? ' → ' + esc(o.next) : ' ★'}</span>`).join('')}</div></div>`).join('')}</div>`

  async function openProject(id) {
    S.active = id
    let d; try { d = await api('/api/studio/projects/' + id) } catch (e) { return }
    const jobs = d.jobs, n = jobs.length, ok = jobs.filter((j) => j.status === 'approved').length, spent = jobs.reduce((a, j) => a + (j.spent || 0), 0), est = jobs.reduce((a, j) => a + j.credits, 0)
    const pub = d.status === 'published'
    $('#prj').innerHTML = `<section class="st-card dk-prj"><header><h3>《${esc(d.title)}》</h3><span class="pill">${esc(d.status)}</span></header>
      <div class="dk-k"><div><b>${ok}/${n}</b><span>已通过</span></div><div><b>${spent.toLocaleString()}</b><span>已消耗</span></div><div><b>${est.toLocaleString()}</b><span>预计</span></div><div><b>${d.budget ? d.budget.toLocaleString() : '不限'}</b><span>预算</span></div></div>
      <div class="bar big"><i style="width:${n ? (ok / n) * 100 : 0}%"></i></div>
      ${pub ? `<a class="btn2 big" href="/s/${d.series_id}" style="margin:12px 0"><i class="fas fa-play"></i> 已上架 · 立即试玩</a>` : ''}
      ${!n ? `<button class="btn2 big" data-green="${d.id}"><i class="fas fa-clapperboard"></i> 开拍</button>` : ''}
      ${n && !pub && d.status === 'review' ? `<button class="btn2 big" data-pub="${d.id}"><i class="fas fa-rocket"></i> 全部通过 · 上架</button>` : ''}
      ${pub && !jobs.some((j) => j.clip_id.startsWith('BONUS_')) ? `<button class="btn2 ghost" data-bonus="${d.id}" style="width:100%;margin-bottom:10px"><i class="fas fa-gem"></i> 续生成：黄金 / 白金 / 钻石 彩蛋片段（≈ ${3 * S.meta.price.clip10} 积分）</button>` : ''}
      ${n && !pub ? `<button class="btn2 ghost sm" data-pause="${d.id}">${d.status === 'paused' ? '▶ 继续' : '⏸ 暂停'}</button>` : ''}
      <div class="jobs">${jobs.map((j) => { const [t, c] = JS[j.status] || [j.status, '#666']; return `<div class="jb2" style="--c:${c}"><i>${KIND[j.kind] || ''}</i><b>${esc(j.clip_id)}</b><span>${esc(j.title)}${j.dur ? ' · ' + j.dur + 's' : ''}</span><em>${t}</em><small>${j.spent || j.credits}</small>${j.status === 'review' ? `<button class="btn2 sm" data-ok="${j.id}">✓</button><button class="btn2 sm ghost" data-no="${j.id}">↻</button>` : ''}${j.result_url && j.result_url.startsWith('http') ? `<a href="${j.result_url}" target="_blank" class="lnk"><i class="fas fa-up-right-from-square"></i></a>` : ''}</div>` }).join('')}</div>
      <p class="mut sm">worker 启动：<code>cd scripts/studio && CONC=3 python3 director_worker.py</code>（在装有 gsk 的沙箱上常驻；按任务实际扣减积分并回报）</p></section>`
    clearTimeout(S.timer)
    if (!pub && n) S.timer = setTimeout(() => S.active === id && openProject(id), 8000)
  }

  document.addEventListener('click', async (e) => {
    const t = e.target, q = (s) => t.closest(s)
    try {
      if (q('[data-cat]')) { S.cat = q('[data-cat]').dataset.cat; S.theme = $('#theme').value; return render() }
      if (q('[data-genre]')) { S.genre = q('[data-genre]').dataset.genre; S.theme = $('#theme').value; return render() }
      if (q('[data-scale]')) { S.scale = q('[data-scale]').dataset.scale; S.theme = $('#theme').value; return render() }
      if (q('[data-idea]')) { $('#theme').value = q('[data-idea]').dataset.idea; return }
      if (q('#go')) {
        const th = $('#theme').value.trim(); if (!th) return toast('请输入主题')
        const b = q('#go'); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI 编剧创作中（约 1 分钟）…'
        S.theme = th; S.auto = $('#auto').checked
        S.brief = await api('/api/director/brief', { theme: th, cat: S.cat, genre: S.genre || undefined, scale: S.scale, auto: S.auto }); toast('剧本完成：' + S.brief.title); S.meta = await api('/api/director/meta'); return render()
      }
      if (q('[data-green]')) { const id = q('[data-green]').dataset.green; if (!confirm('确认开拍？将按任务实际消耗积分。')) return; const r = await api(`/api/director/projects/${id}/greenlight`, {}); toast(`已开拍：${r.queued} 个任务入队 · 预计 ${r.est_credits} 积分`); S.brief = null; S.active = id; S.meta = await api('/api/director/meta'); return render() }
      if (q('[data-open]')) return openProject(q('[data-open]').dataset.open)
      if (q('[data-ok]')) { await api(`/api/director/jobs/${q('[data-ok]').dataset.ok}/review`, { approve: true }); return openProject(S.active) }
      if (q('[data-no]')) { await api(`/api/director/jobs/${q('[data-no]').dataset.no}/review`, { approve: false }); toast('已驳回，重新排队生成'); return openProject(S.active) }
      if (q('[data-pub]')) { const r = await api(`/api/director/projects/${q('[data-pub]').dataset.pub}/publish`, {}); toast('已上架 ' + r.url); return openProject(S.active) }
      if (q('[data-bonus]')) { const b = q('[data-bonus]'); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI 编写彩蛋分镜…'; const r = await api(`/api/director/projects/${b.dataset.bonus}/bonus`, {}); toast(`已入队 ${r.queued} 个彩蛋片段 · ${r.est_credits} 积分`); return openProject(S.active) }
      if (q('[data-pause]')) { await api(`/api/director/projects/${q('[data-pause]').dataset.pause}/pause`, {}); return openProject(S.active) }
    } catch (er) { toast(er.message); const b = $('#go'); if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-pen-nib"></i> AI 编剧 · 生成剧本与博弈抉择' } }
  })
  load()
})()
