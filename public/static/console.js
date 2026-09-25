// Agent-6 · Forge Console 运营后台（驾驶舱）
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const main = $('#console-main'), menu = $('#console-menu')
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', 'x-user-id': 'console_admin' }, body: opt.body ? JSON.stringify(opt.body) : undefined })
    const j = await r.json(); if (!r.ok) throw new Error(j.message || j.error); return j
  }
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600) }
  const ts = (t) => t ? new Date(t).toLocaleString('zh-CN', { hour12: false }).slice(5) : '—'
  const busy = async (btn, fn) => { const h = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中…'; try { await fn() } catch (e) { toast('失败：' + e.message) } finally { btn.disabled = false; btn.innerHTML = h } }
  const lvTag = (l) => `<span class="tag ${l.startsWith('green') ? 'green' : l}">${{ red: '红', yellow: '黄', green: '绿', 'green-': '绿-' }[l]}</span>`
  let charts = []
  const kill = () => { charts.forEach((c) => c.destroy()); charts = [] }

  const PAGES = [
    { id: 'monitor', icon: 'fa-display', name: '局监控大屏', ag: 6 },
    { id: 'comic', icon: 'fa-book-open', name: '漫剧机制概率', ag: 4 },
    { id: 'comictree', icon: 'fa-sitemap', name: '漫剧分支树', ag: 7 },
    { id: 'branches', icon: 'fa-code-branch', name: '分支统计', ag: 6 },
    { id: 'script', icon: 'fa-diagram-project', name: '剧本管理', ag: 6 },
    { id: 'derive', icon: 'fa-wand-magic-sparkles', name: '实时衍生剧本', ag: 7 },
    { id: 'regulate', icon: 'fa-scale-balanced', name: '全网对弈监管', ag: 7 },
    { id: 'clips', icon: 'fa-film', name: '对弈片对优化', ag: 7 },
    { id: 'pool', icon: 'fa-layer-group', name: '变体池水位', ag: 2 },
    { id: 'video', icon: 'fa-video', name: '视频模型路由', ag: 3 },
    { id: 'economy', icon: 'fa-coins', name: '经济调控·EV 沙盘', ag: 4 },
    { id: 'rounds', icon: 'fa-list', name: '局记录·审计', ag: 4 },
    { id: 'tasks', icon: 'fa-microchip', name: '模型任务', ag: 2 },
    { id: 'qa', icon: 'fa-vial-circle-check', name: '自动化测试', ag: 3 }
  ]
  const route = () => (location.hash.slice(1) || 'monitor')
  function renderMenu() {
    menu.innerHTML = `<h4>FORGE CONSOLE</h4>` + PAGES.map((p) => `<button data-p="${p.id}" class="${route() === p.id ? 'on' : ''}"><i class="fas ${p.icon}" style="width:16px"></i>${p.name}<span class="ag">A${p.ag}</span></button>`).join('')
    menu.onclick = (e) => { const b = e.target.closest('button[data-p]'); if (b) location.hash = b.dataset.p }
  }
  addEventListener('hashchange', () => { renderMenu(); go() })
  const header = (icon, title, sub, actions = '') => `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px"><div><div class="h1"><i class="fas ${icon}" style="color:var(--gold)"></i>${title}</div><div class="sub">${sub}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`

  const V = {}
  V.monitor = async () => {
    const d = await api('/api/console/overview'); const k = d.kpi
    const K = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="sub" style="font-size:11px">${s}</div></div>`
    main.innerHTML = header('fa-display', '局监控大屏', '实时全局态势 · 每 5 秒刷新', `<a class="btn" href="/" target="_blank"><i class="fas fa-play"></i> 打开剧场</a>`) +
      `<div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        ${K('总局数', k.rounds, `下注中 ${k.live}`)}${K('真实玩家', k.players)}${K('下注笔数', k.bets, `玩家胜率 ${k.win_rate}%`)}${K('下注总额', k.volume, `派彩 ${k.paid}`)}
        ${K('庄家净收', k.house, `抽水 ${k.rake} · 悔棋税 ${k.rewind_tax}`)}${K('平均单局', k.avg_round_sec + 's', '目标 60–120s')}
        ${K('悔棋率', k.rewind_rate + '%', '健康区间 8–18%')}${K('兜底率', k.fallback_rate + '%', '目标 ≤ 2%')}${K('模型任务', k.tasks, `降级 ${k.task_degraded} · 失败 ${k.task_failed}`)}
        ${K('平均任务耗时', k.avg_task_ms + 'ms')}${K('免费币发放', k.faucet)}${K('账本不平', k.ledger_unbalanced, k.ledger_unbalanced ? '⚠ P0' : '✓ 零差错')}
      </div>
      <div class="grid md:grid-cols-3 gap-3 mt-3">
        <div class="card md:col-span-2"><div class="sub mb-2">开局趋势（每分钟）</div><canvas id="ch-h" height="110"></canvas></div>
        <div class="card"><div class="sub mb-2">告警流</div>${d.alerts.length ? d.alerts.map((a) => `<div style="padding:6px 0;border-bottom:1px solid #1b2036"><span class="tag ${a.level === 'P0' ? 'red' : 'yellow'}">${a.level}</span> ${esc(a.msg)}</div>`).join('') : '<div class="sub">✓ 无告警</div>'}
          <div class="sub mt-3 mb-1">生成队列</div>${d.queues.map((q) => `<span class="tag blue" style="margin:2px">${q.priority}·${q.status} ${q.n}</span>`).join('') || '<span class="sub">空</span>'}</div>
      </div>
      <div class="card mt-3"><div class="sub mb-2">7-Agent 实时动作流</div><table class="tbl"><tr><th>时间</th><th>Agent</th><th>动作</th><th>状态</th><th>详情</th></tr>
        ${d.agent_runs.map((r) => `<tr><td>${ts(r.created_at)}</td><td><span class="tag purple">A${r.agent_no}</span></td><td>${esc(r.action)}</td><td><span class="tag ${r.status === 'ok' ? 'green' : r.status === 'degraded' ? 'yellow' : 'red'}">${r.status}</span></td><td>${esc(r.detail)}</td></tr>`).join('')}</table></div>`
    kill()
    charts.push(new Chart($('#ch-h'), { type: 'bar', data: { labels: d.hourly.map((h) => new Date(h.t).toTimeString().slice(0, 5)), datasets: [{ data: d.hourly.map((h) => h.n), backgroundColor: '#f5c451' }] }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8b93b3' } }, y: { ticks: { color: '#8b93b3' }, grid: { color: '#1d2340' } } } } }))
  }

  V.comic = async () => {
    const [cfg, st] = await Promise.all([api('/api/comic/config'), api('/api/comic/stats')])
    const F = (k, l, min, max, step, tip) => `<div class="mb-3"><div style="display:flex;justify-content:space-between"><span class="sub">${l}</span><b id="v-${k}">${cfg[k]}</b></div><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${cfg[k]}" style="width:100%;accent-color:#f5c451"><div class="sub" style="font-size:11px">${tip}</div></div>`
    main.innerHTML = header('fa-book-open', '漫剧机制概率 · 后台调控', '《穹顶之下》：每局 = 基础剧情权重 → 后台覆盖 → 悔棋变局（二选一/新变数）→ 种子机制扰动；调参后可一键全树蒙特卡洛看结局分布',
      `<a class="btn" href="/comic" target="_blank"><i class="fas fa-book-open"></i> 打开漫剧</a>`) +
      `<div class="grid md:grid-cols-3 gap-3">
        <div class="card">${F('jitter', '机制扰动强度 jitter', 0, 0.6, 0.01, '每局用种子对各选项权重做 ±jitter 随机扰动 → 同一抉择每次概率/赔率都不同')}
          ${F('twist_weight', '“新变数”隐藏选项概率', 0.1, 0.5, 0.01, '悔棋选择“新变数”时隐藏选项分得的概率，其余按比例缩放')}
          ${F('rake', '抽水 rake', 0.05, 0.1, 0.005, '赔率 = (1−rake)/p')}
          ${F('rewind_tax', '悔棋税倍率', 1.1, 3, 0.1, '第 n 次悔棋费用 = 最低下注 × 倍率^n')}
          ${F('window_sec', '下注窗口（秒）', 8, 30, 1, '')}
          ${F('max_rewinds', '每个抉择最多悔棋', 0, 2, 1, '')}
          <button class="btn gold" id="save" style="width:100%;justify-content:center"><i class="fas fa-floppy-disk"></i> 保存机制参数（实时生效）</button></div>
        <div class="card md:col-span-2"><div style="display:flex;justify-content:space-between;align-items:center"><div class="sub">全树蒙特卡洛：按当前参数模拟完整通关（常规路径）</div><button class="btn" id="sim"><i class="fas fa-dice"></i> 模拟 3000 次通关</button></div>
          <div id="sim-out" class="mt-2 sub">点击模拟</div></div></div>
      <div class="grid md:grid-cols-3 gap-3 mt-3">
        <div class="kpi"><div class="l">漫剧通关次数</div><div class="v">${st.runs.n || 0}</div><div class="sub" style="font-size:11px">完成 ${st.runs.ended || 0} · 悔棋 ${st.runs.rewinds || 0}</div></div>
        <div class="kpi"><div class="l">玩家累计盈亏</div><div class="v">${st.runs.pnl || 0}</div></div>
        <div class="kpi"><div class="l">局面模式分布</div><div class="v" style="font-size:14px">${st.modes.map((m) => `${{ normal: '常规', binary: '二选一', plus: '新变数', binary_plus: '二选一+新变数' }[m.mode] || m.mode} ${m.n}`).join(' · ') || '—'}</div></div></div>`
    main.querySelectorAll('input[data-k]').forEach((i) => (i.oninput = () => ($('#v-' + i.dataset.k).textContent = i.value)))
    $('#save').onclick = (e) => busy(e.currentTarget, async () => { const b = {}; main.querySelectorAll('input[data-k]').forEach((i) => (b[i.dataset.k] = +i.value)); await api('/api/comic/config', { method: 'POST', body: b }); toast('机制参数已生效，下一局即按新参数开盘') })
    $('#sim').onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api('/api/comic/simulate', { method: 'POST', body: { n: 3000 } })
      $('#sim-out').innerHTML = `<div style="margin-bottom:8px">jitter=${r.jitter} · 模拟 ${r.n} 次 · 触达 <b style="color:var(--gold)">${r.distinct_endings}</b>/${r.total_regular_endings} 个常规结局（隐藏结局只能靠悔棋“新变数”解锁）</div><canvas id="ch-end" height="150"></canvas>`
      kill(); charts.push(new Chart($('#ch-end'), { type: 'bar', data: { labels: r.endings.map((x) => x.title), datasets: [{ label: '结局占比 %', data: r.endings.map((x) => x.pct), backgroundColor: '#f5c451' }] }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8b93b3', font: { size: 9 } } }, y: { ticks: { color: '#8b93b3' }, grid: { color: '#1d2340' } } } } }))
    })
  }

  V.comictree = async () => {
    const [t, cfg, st] = await Promise.all([api('/api/comic/tree'), api('/api/comic/config'), api('/api/comic/stats')])
    const hits = {}; st.rows.forEach((r) => (hits[r.outcome_id] = (hits[r.outcome_id] || 0) + r.n))
    const N = Object.fromEntries(t.nodes.map((n) => [n.id, n]))
    const reg = t.nodes.reduce((a, n) => a + n.options.filter((o) => !o.twist).length, 0), tw = t.nodes.reduce((a, n) => a + n.options.filter((o) => o.twist).length, 0)
    const nodeCard = (id) => {
      const n = N[id]; const ov = cfg.overrides[id] || {}
      return `<details ${n.depth <= 2 ? 'open' : ''} style="margin:6px 0 6px ${(n.depth - 1) * 14}px;border-left:2px solid ${['#f5c451', '#22d3ee', '#a78bfa', '#fb7185'][n.depth - 1]};padding-left:10px">
        <summary style="cursor:pointer"><b>${esc(n.id)}</b> · 第${n.depth}幕 · ${esc(n.question)} ${cfg.overrides[id] ? '<span class="tag yellow">已覆盖权重</span>' : ''}</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">${n.options.map((o) => { const seg = t.segments[o.id]; return `<div style="width:170px;background:#0f1325;border:1px solid ${o.twist ? '#8a5cff' : '#232945'};border-radius:10px;overflow:hidden">
          ${seg.image_url ? `<img src="${seg.image_url}" loading="lazy" style="width:100%;aspect-ratio:9/12;object-fit:cover">` : ''}
          <div style="padding:6px;font-size:11px"><b>${esc(o.label)}</b> ${o.twist ? '<span class="tag purple">悔棋隐藏</span>' : ''}${!o.next ? '<span class="tag red">结局</span>' : ''}
          <div class="sub">${esc(seg.title)} · 到达 ${hits[o.id] || 0}</div>
          ${o.twist ? '' : `<div>权重 <input class="inp" data-w="${id}" data-o="${o.id}" value="${ov[o.id] ?? o.weight}" style="width:60px;padding:2px 4px"></div>`}
          <button class="btn" data-play="${o.id}" style="font-size:10px;padding:2px 8px;margin-top:4px"><i class="fas fa-volume-high"></i> 试听</button></div></div>` }).join('')}</div>
        <button class="btn" data-savew="${id}" style="font-size:11px;padding:3px 10px">保存本节点权重</button> <button class="btn" data-resetw="${id}" style="font-size:11px;padding:3px 10px">恢复默认</button>
        ${n.options.filter((o) => o.next && !o.twist).map((o) => nodeCard(o.next)).join('')}</details>`
    }
    main.innerHTML = header('fa-sitemap', '漫剧分支树 · 《穹顶之下》', `${t.nodes.length} 个抉择点 · ${reg} 条常规分支 · ${tw} 条悔棋隐藏分支 · ${Object.keys(t.segments).length} 幅 GPT Image 2 分镜 · 全部配音`) + `<div class="card">${nodeCard(t.nodes[0].id)}</div>`
    const au = new Audio()
    main.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => { const l = t.segments[b.dataset.play].lines; let i = 0; const nx = () => { if (i < l.length && l[i].audio) { au.src = l[i++].audio; au.play(); au.onended = nx } }; nx() }))
    main.querySelectorAll('[data-savew]').forEach((b) => (b.onclick = () => busy(b, async () => { const id = b.dataset.savew; const w = {}; main.querySelectorAll(`[data-w="${id}"]`).forEach((i) => (w[i.dataset.o] = +i.value)); await api('/api/comic/config', { method: 'POST', body: { overrides: { [id]: w } } }); toast('已覆盖 ' + id + ' 权重') })))
    main.querySelectorAll('[data-resetw]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('/api/comic/config', { method: 'POST', body: { overrides: { [b.dataset.resetw]: null } } }); toast('已恢复默认'); V.comictree() })))
  }

  V.branches = async () => {
    const d = await api('/api/console/branches')
    main.innerHTML = header('fa-code-branch', '分支统计', '到达率 vs story_weight（可解释公平）· 玩家选择率 · 押注额') +
      d.nodes.map((n, i) => `<div class="card mb-3"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><b>${esc(n.node_id)}</b> · ${esc(n.question)} ${n.layer === 'flesh' ? '<span class="tag purple">AI 延展</span>' : ''} ${n.status === 'dormant' ? '<span class="tag">休眠</span>' : ''}</div><div class="sub">到达 ${n.reached} 局 · 下注 ${n.picks} 笔</div></div>
        <div class="grid md:grid-cols-2 gap-4 mt-2"><table class="tbl"><tr><th>结局簇</th><th>权重</th><th>实际到达</th><th>偏差</th><th>玩家选择</th><th>押注额</th></tr>
        ${n.outcomes.map((o) => `<tr><td>${esc(o.label)}<div class="sub" style="font-size:11px">${esc(o.category)}</div></td><td>${Math.round(o.story_weight * 100)}%</td><td>${o.reach_rate}%</td><td style="color:${Math.abs(o.ev_dev) > 15 ? 'var(--red)' : 'var(--mut)'}">${o.ev_dev > 0 ? '+' : ''}${o.ev_dev}</td><td>${o.pick_rate}%</td><td>${o.stake}</td></tr>`).join('')}</table>
        <canvas id="ch-b${i}" height="130"></canvas></div></div>`).join('')
    kill()
    d.nodes.forEach((n, i) => charts.push(new Chart($('#ch-b' + i), { type: 'bar', data: { labels: n.outcomes.map((o) => o.label), datasets: [
      { label: '设计权重%', data: n.outcomes.map((o) => Math.round(o.story_weight * 100)), backgroundColor: '#3b4470' },
      { label: '实际到达%', data: n.outcomes.map((o) => o.reach_rate), backgroundColor: '#f5c451' },
      { label: '玩家选择%', data: n.outcomes.map((o) => o.pick_rate), backgroundColor: '#22d3ee' }] },
      options: { plugins: { legend: { labels: { color: '#8b93b3' } } }, scales: { x: { ticks: { color: '#8b93b3' } }, y: { ticks: { color: '#8b93b3' }, grid: { color: '#1d2340' } } } } })))
  }

  V.script = async () => {
    const d = await api('/api/console/script')
    const outs = (nid) => d.outcomes.filter((o) => o.node_id === nid)
    const vars = (oid) => d.variants.filter((v) => v.outcome_id === oid)
    main.innerHTML = header('fa-diagram-project', '剧本管理 · Forge Canvas', `《${esc(d.series.title)}》剧情树：主干 Spine（编剧锁定）/ 血肉 Flesh（AI 延展）/ 皮肤 Skin（变体）`,
      `<button class="btn" id="poems"><i class="fas fa-feather"></i> A7 重新提炼诗词</button>`) +
      `<div class="card mb-3 poem">${esc(d.series.poem || '')}</div>` +
      d.nodes.map((n) => {
        if (n.kind === 'scene') return `<div class="card mb-2" style="border-left:3px solid #3b4470"><span class="tag blue">SCENE</span> <b>${esc(n.title)}</b> ${n.layer === 'flesh' ? '<span class="tag purple">血肉层</span>' : '<span class="tag">主干</span>'}<div class="sub mt-1">${(JSON.parse(n.lines || '[]')).map((l) => `${esc(l.speaker)}：${esc(l.text)}`).join(' ／ ')}</div></div>`
        if (n.kind === 'ending') return `<div class="card mb-2" style="border-left:3px solid #fb7185"><span class="tag red">ENDING</span> <b>${esc(n.title)}</b><div class="sub">${esc(JSON.parse(n.lines || '[]')[0]?.text)}</div></div>`
        const cfg = JSON.parse(n.config || '{}')
        return `<div class="card mb-2" style="border-left:3px solid var(--gold)"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><span class="tag yellow">CASH · bet</span> <b>${esc(n.id)}</b> <input class="inp" value="${esc(n.question)}" data-q="${n.id}" style="width:260px" maxlength="24"> ${n.status === 'dormant' ? '<span class="tag">休眠</span>' : ''}</div>
          <div style="display:flex;gap:6px"><button class="btn" data-saveq="${n.id}"><i class="fas fa-floppy-disk"></i> 保存问题</button><button class="btn" data-dorm="${n.id}" data-st="${n.status === 'dormant' ? 'active' : 'dormant'}">${n.status === 'dormant' ? '唤醒' : '休眠剪枝'}</button></div></div>
          <div class="sub mt-1">窗口 ${cfg.window_sec}s · rake ${cfg.rake} · 悔棋 ${cfg.rewind?.max_times} 次 ×${cfg.rewind?.tax} · 币种 ${cfg.currency} · ${cfg.compliance?.age}+</div>
          <div class="grid md:grid-cols-3 gap-2 mt-2">${outs(n.id).map((o) => `<div style="background:#0f1325;border:1px solid #232945;border-radius:12px;padding:10px">
            <div style="display:flex;justify-content:space-between"><b>${esc(o.label)}</b><span class="sub">w ${o.story_weight} · 目标 ${o.target_variants}</span></div>
            ${o.poem ? `<div class="poem" style="font-size:12px;margin:4px 0">${esc(o.poem)}</div>` : ''}
            ${vars(o.id).map((v) => `<div style="font-size:12px;padding:4px 0;border-top:1px dashed #232945;display:flex;gap:6px;align-items:center">
              <span class="tag ${v.status === 'pool' ? 'green' : v.status === 'rejected' ? 'red' : 'yellow'}">${v.status}</span>${v.is_fallback ? '<span class="tag">兜底</span>' : ''}
              <span style="flex:1" title="${esc(v.angle)}">${esc(v.title)} <span class="sub">${v.score}分 · ${v.source} · ▶${v.plays}</span></span>
              <i class="fas fa-video" title="${esc(v.video_model || '')} ${v.video_status}" style="color:${v.video_status === 'ready' ? 'var(--green)' : '#444'}"></i></div>`).join('')}
            <button class="btn mt-2" data-gen="${o.id}" style="font-size:12px;padding:5px 10px"><i class="fas fa-plus"></i> A2 生成变体</button></div>`).join('')}</div></div>`
      }).join('')
    $('#poems').onclick = (e) => busy(e.currentTarget, async () => { await api('/api/agents/7/poems', { method: 'POST', body: {} }); toast('诗词已更新'); V.script() })
    main.querySelectorAll('[data-gen]').forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api('/api/agents/2/generate-variants', { method: 'POST', body: { outcome_id: b.dataset.gen, count: 2 } }); toast(`生成 ${r.variants.length} 个 · ${r.model}`); V.script() })))
    main.querySelectorAll('[data-dorm]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('/api/console/nodes/' + b.dataset.dorm, { method: 'PATCH', body: { status: b.dataset.st } }); V.script() })))
    main.querySelectorAll('[data-saveq]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('/api/console/nodes/' + b.dataset.saveq, { method: 'PATCH', body: { question: main.querySelector(`[data-q="${b.dataset.saveq}"]`).value } }); toast('已保存') })))
  }

  V.derive = async () => {
    const d = await api('/api/console/script')
    main.innerHTML = header('fa-wand-magic-sparkles', '实时衍生剧本 · WF-06', 'Agent-7：状态摘要 + 世界观圣经 → N 候选 → 六维评分 → 分流（自动过/人审）→ 写入画布血肉层',
      `<select class="inp" id="anchor"><option value="">自动（分歧度最高）</option>${d.nodes.filter((n) => n.kind === 'cash').map((n) => `<option value="${n.id}">${n.id} · ${esc(n.question)}</option>`).join('')}</select>
       <button class="btn gold" id="go"><i class="fas fa-wand-magic-sparkles"></i> 衍生下一幕</button>`) + `<div id="ext-list"></div>`
    const list = $('#ext-list')
    const draw = (exts) => {
      list.innerHTML = exts.map((e) => {
        const cands = typeof e.candidates === 'string' ? JSON.parse(e.candidates) : e.candidates
        return `<div class="card mb-3"><div class="sub mb-2">${esc(e.id || e.extension_id)} · 锚点 ${esc(e.anchor_node_id || e.anchor)} · <span class="tag ${e.status === 'written' ? 'green' : 'yellow'}">${e.status || 'pending'}</span></div>
        <div class="grid md:grid-cols-3 gap-3">${cands.map((c, i) => `<div style="background:#0f1325;border:1px solid ${e.chosen === i ? 'var(--gold)' : '#232945'};border-radius:12px;padding:12px">
          <div style="display:flex;justify-content:space-between"><b>${esc(c.title)}</b><span class="tag ${c.route === 'auto_pass' ? 'green' : 'yellow'}">${c.route === 'auto_pass' ? '自动过审' : '待人审'} ${c.total}</span></div>
          <div class="poem" style="font-size:13px;margin:4px 0">${esc(c.verse || '')}</div>
          <div class="sub">${esc(c.scene)}</div><div style="margin:6px 0;font-weight:700">押注：${esc(c.question)}</div>
          ${c.outcomes.map((o) => `<div style="font-size:12px;display:flex;justify-content:space-between"><span>${esc(o.label)} <span class="sub">${esc(o.category || '')}</span></span><span>${o.weight}</span></div>`).join('')}
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px">${Object.entries(c.scores || {}).map(([k, v]) => `<div style="font-size:10px;color:var(--mut)">${{ consistency: '一致性', tension: '张力', bet_value: '下注值', convergence: '收束', compliance: '合规', cost: '成本' }[k] || k}<div class="bar"><i style="width:${v * 10}%"></i></div></div>`).join('')}</div>
          ${e.status !== 'written' ? `<button class="btn mt-2" data-approve="${e.id || e.extension_id}" data-i="${i}" style="width:100%;justify-content:center"><i class="fas fa-check"></i> 编剧采纳 → 写入画布</button>` : ''}</div>`).join('')}</div></div>`
      }).join('') || '<div class="card sub">暂无延展记录，点击右上角“衍生下一幕”</div>'
      list.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api('/api/agents/7/approve', { method: 'POST', body: { extension_id: b.dataset.approve, index: +b.dataset.i } }); toast('已写入画布：' + r.question + '（剧场即刻可玩）'); V.derive() })))
    }
    draw(d.extensions)
    $('#go').onclick = (e) => busy(e.currentTarget, async () => { await api('/api/agents/7/derive', { method: 'POST', body: { anchor: $('#anchor').value || undefined, n: 3 } }); const dd = await api('/api/console/script'); draw(dd.extensions); toast('衍生完成') })
  }

  V.regulate = async () => {
    const d = await api('/api/agents/7/regulate')
    const SRC = { platform: '站内下注', douyin: '抖音', xhs: '小红书', bilibili: 'B站', weibo: '微博' }
    main.innerHTML = header('fa-scale-balanced', '全网对弈监管', 'Agent-7 聚合站内下注 + 全网平台决策信号 → 按决策类目监管一边倒 / 偏差 / 意见分裂，给出对弈调整建议',
      `<button class="btn" id="inject"><i class="fas fa-satellite-dish"></i> 模拟注入一波全网信号</button>`) +
      `<div class="grid md:grid-cols-3 gap-3 mb-3"><div class="card"><div class="sub mb-2">全网决策类目分布</div><canvas id="ch-cat" height="200"></canvas></div>
       <div class="card md:col-span-2"><div class="sub mb-2">各节点分歧度（越接近 1 越“扎心”，越适合对弈）</div><canvas id="ch-div" height="120"></canvas></div></div>` +
      d.nodes.map((n) => `<div class="card mb-3"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><b>${esc(n.node_id)}</b> · ${esc(n.question)}</div>
        <div><span class="tag blue">分歧度 ${n.divergence}</span> <span class="tag ${n.max_share > 0.65 ? 'red' : 'green'}">最大占比 ${Math.round(n.max_share * 100)}%</span> ${n.split ? '<span class="tag purple">全网/站内分裂</span>' : ''}</div></div>
        <div class="grid md:grid-cols-2 gap-3 mt-2"><div>${n.shares.map((s) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(s.label)} <span class="tag">${esc(s.category)}</span></span><span>${Math.round(s.share * 100)}% <span class="sub">/ 权重 ${Math.round(s.weight * 100)}%</span></span></div><div class="bar"><i style="width:${s.share * 100}%"></i></div></div>`).join('')}</div>
        <div><table class="tbl"><tr><th>来源</th>${n.outcomes.map((o) => `<th>${esc(o.label)}</th>`).join('')}</tr>${[...new Set(n.sources.map((s) => s.source))].map((src) => `<tr><td>${SRC[src] || src}</td>${n.outcomes.map((o) => `<td>${n.sources.find((s) => s.source === src && s.outcome_id === o.outcome_id)?.v || 0}</td>`).join('')}</tr>`).join('')}</table></div></div>
        ${n.alerts.length || n.actions.length ? `<div class="mt-2">${n.alerts.map((a) => `<span class="tag red" style="margin:2px">${esc(a)}</span>`).join('')}${n.actions.map((a) => `<div class="sub" style="margin-top:4px"><i class="fas fa-lightbulb" style="color:var(--gold)"></i> ${esc(a)}</div>`).join('')}</div>` : ''}</div>`).join('')
    kill()
    const cats = Object.entries(d.categories)
    charts.push(new Chart($('#ch-cat'), { type: 'doughnut', data: { labels: cats.map((c) => c[0]), datasets: [{ data: cats.map((c) => c[1]), backgroundColor: ['#f5c451', '#fb7185', '#22d3ee', '#a78bfa', '#34d399', '#60a5fa', '#f472b6', '#fbbf24'] }] }, options: { plugins: { legend: { labels: { color: '#8b93b3' }, position: 'bottom' } } } }))
    charts.push(new Chart($('#ch-div'), { type: 'bar', data: { labels: d.nodes.map((n) => n.node_id), datasets: [{ label: '分歧度', data: d.nodes.map((n) => n.divergence), backgroundColor: '#22d3ee' }, { label: '最大占比', data: d.nodes.map((n) => n.max_share), backgroundColor: '#fb7185' }] }, options: { plugins: { legend: { labels: { color: '#8b93b3' } } }, scales: { y: { max: 1, ticks: { color: '#8b93b3' }, grid: { color: '#1d2340' } }, x: { ticks: { color: '#8b93b3' } } } } }))
    $('#inject').onclick = (e) => busy(e.currentTarget, async () => {
      const items = []
      d.nodes.forEach((n) => n.outcomes.forEach((o, i) => ['douyin', 'xhs', 'bilibili', 'weibo'].forEach((s) => items.push({ node_id: n.node_id, outcome_id: o.outcome_id, source: s, votes: Math.round(Math.random() * 300 * (i === 0 && Math.random() < 0.4 ? 4 : 1)) }))))
      await api('/api/agents/7/signals', { method: 'POST', body: { items } }); toast(`注入 ${items.length} 条全网信号`); V.regulate()
    })
  }

  V.clips = async () => {
    const budget = +(sessionStorage.clipBudget || 60)
    const d = await api('/api/agents/7/clip-pairs?budget=' + budget)
    main.innerHTML = header('fa-film', '对弈片对优化', 'Agent-7：按“分歧度 × 全网热度”把片数预算分配到节点与结局簇，得出可对弈片对数量，并写回变体池目标库存驱动 WF-05 补货',
      `<label class="sub">片数预算 <input class="inp" id="bud" type="number" value="${budget}" style="width:80px"></label><button class="btn" id="calc"><i class="fas fa-calculator"></i> 重新计算</button><button class="btn gold" id="apply"><i class="fas fa-check"></i> 应用到变体池</button>`) +
      `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div class="kpi"><div class="l">规划总片数</div><div class="v">${d.total_clips}</div></div>
        <div class="kpi"><div class="l">可对弈片对</div><div class="v">${d.total_clip_pairs}</div><div class="sub" style="font-size:11px">Σ C(k,2)</div></div>
        <div class="kpi"><div class="l">完整对局路径</div><div class="v">${d.full_paths}</div><div class="sub" style="font-size:11px">Π 结局簇数</div></div>
        <div class="kpi"><div class="l">预算</div><div class="v">${d.budget_clips}</div></div></div>` +
      `<div class="card"><table class="tbl"><tr><th>节点</th><th>分歧度</th><th>对弈价值</th><th>片对</th><th>规划片数</th><th>结局簇分配</th><th>建议</th></tr>
      ${d.plan.map((p) => `<tr><td><b>${esc(p.node_id)}</b><div class="sub">${esc(p.question)}</div></td><td>${p.divergence}</td><td>${p.value}</td><td>${p.clip_pairs}</td><td><b>${p.clips}</b></td>
      <td>${p.alloc.map((a) => `<div style="font-size:12px">${esc(a.label)}：<b>${a.variants}</b> 片</div>`).join('')}</td><td class="sub">${esc(p.recommendation)}</td></tr>`).join('')}</table></div>`
    $('#calc').onclick = () => { sessionStorage.clipBudget = $('#bud').value; V.clips() }
    $('#apply').onclick = (e) => busy(e.currentTarget, async () => { await api('/api/agents/7/clip-pairs/apply', { method: 'POST', body: { budget: +$('#bud').value } }); toast('已写回目标库存，前往“变体池水位”执行补货') })
  }

  V.pool = async () => {
    const w = await api('/api/agents/2/water')
    main.innerHTML = header('fa-layer-group', '变体池水位', '绿 ≥ 目标 / 黄 < 60% / 红 < 30% 或 < 2 个；黄→P1 补货，红→P0 紧急补货；休眠分支不补',
      `<button class="btn gold" id="rep"><i class="fas fa-truck-ramp-box"></i> A2 执行 WF-05 补货</button>`) +
      `<div class="card"><table class="tbl"><tr><th>节点</th><th>结局簇</th><th>水位</th><th>库存</th><th>视频就绪</th><th>播放</th><th>操作</th></tr>
      ${w.map((r) => `<tr><td>${esc(r.node_id)}${r.node_status === 'dormant' ? ' <span class="tag">休眠</span>' : ''}</td><td>${esc(r.label)}</td><td>${lvTag(r.level)}</td>
        <td style="min-width:160px"><div class="bar"><i style="width:${Math.min(100, r.ratio * 100)}%;background:${r.level === 'red' ? 'var(--red)' : r.level === 'yellow' ? '#ffd66b' : 'var(--green)'}"></i></div><div class="sub" style="font-size:11px">${r.pool}/${r.target_variants}（预备池 ${r.reserve || 0}）</div></td>
        <td>${r.video_ready || 0}</td><td>${r.plays || 0}</td><td><button class="btn" data-gen="${r.id}" style="font-size:12px;padding:4px 10px">+2</button></td></tr>`).join('')}</table></div>`
    $('#rep').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('/api/agents/2/replenish', { method: 'POST', body: {} }); toast(`检查 ${r.checked} 个缺口，补货 ${r.replenished.reduce((a, x) => a + x.variants.filter((v) => v.status === 'pool').length, 0)} 个入池`); V.pool() })
    main.querySelectorAll('[data-gen]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('/api/agents/2/generate-variants', { method: 'POST', body: { outcome_id: b.dataset.gen, count: 2 } }); V.pool() })))
  }

  V.video = async () => {
    const tier = sessionStorage.vtier || 'standard'
    const m = await api('/api/agents/3/video-models?tier=' + tier)
    main.innerHTML = header('fa-video', '视频模型路由 · 预判生成', 'Agent-3：质量/一致性/成本/排队/运镜五维加权选型；结合 story_weight 与全网热度预判最可能到达的分支，优先生成并入库',
      `<select class="inp" id="tier">${['draft', 'standard', 'premium', 'realtime'].map((t) => `<option ${t === tier ? 'selected' : ''} value="${t}">${{ draft: '草稿档', standard: '标准档', premium: '精品档', realtime: '实时档' }[t]}</option>`).join('')}</select>
       <button class="btn" id="dry"><i class="fas fa-eye"></i> 预判（仅规划）</button><button class="btn gold" id="run"><i class="fas fa-bolt"></i> 预判并提交生成</button>`) +
      `<div class="card mb-3 sub"><i class="fas fa-plug"></i> 供应商密钥：${m.has_provider_key ? '<span class="tag green">FAL_KEY 已配置 · 真实提交</span>' : '<span class="tag yellow">未配置 FAL_KEY · 自动降级为 motion-still 静帧运镜（播放器程序化渲染）</span>'}</div>
      <div class="card mb-3"><table class="tbl"><tr><th>#</th><th>模型</th><th>厂商</th><th>综合分</th><th>质量</th><th>一致性</th><th>$/秒</th><th>排队</th><th>最长</th><th>6s 预估</th></tr>
      ${m.ranking.map((x, i) => `<tr style="${i === 0 ? 'background:#1b1a10' : ''}"><td>${i === 0 ? '<i class="fas fa-crown" style="color:var(--gold)"></i>' : i + 1}</td><td><b>${x.id}</b></td><td>${x.vendor}</td><td><b>${x.score}</b></td><td>${x.quality}</td><td>${x.consistency}</td><td>${x.cost_per_sec}</td><td>${x.queue_sec}s</td><td>${x.max_sec}s</td><td>$${x.est_cost}</td></tr>`).join('')}</table></div><div id="plan"></div>`
    $('#tier').onchange = (e) => { sessionStorage.vtier = e.target.value; V.video() }
    const show = (r) => {
      $('#plan').innerHTML = `<div class="card"><div class="sub mb-2">预判优先级 = 0.6 × story_weight + 0.4 × 全网热度占比</div><table class="tbl"><tr><th>变体</th><th>结局</th><th>优先级</th><th>选用模型</th><th>预估</th><th>Prompt</th></tr>
      ${r.plan.map((p) => `<tr><td>${esc(p.variant_id)}</td><td>${esc(p.outcome)}</td><td>${p.priority}</td><td><span class="tag blue">${p.model}</span></td><td>$${p.est_cost}</td><td class="sub" style="font-size:11px;max-width:420px">${esc(p.prompt)}</td></tr>`).join('')}</table></div>`
    }
    $('#dry').onclick = (e) => busy(e.currentTarget, async () => show(await api('/api/agents/3/predictive', { method: 'POST', body: { tier, dry_run: true, limit: 8 } })))
    $('#run').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('/api/agents/3/predictive', { method: 'POST', body: { tier, limit: 8 } }); show(r); toast(`已提交 ${r.plan.length} 个视频任务`) })
  }

  V.economy = async () => {
    main.innerHTML = header('fa-coins', '经济调控 · EV 沙盘', 'Agent-4：拖动参数实时蒙特卡洛，确认不存在正期望套利（含“输了就悔棋”策略）') +
      `<div class="grid md:grid-cols-3 gap-3"><div class="card">
        ${[['w1', '结局 A 权重', 0.45], ['w2', '结局 B 权重', 0.4], ['w3', '结局 C 权重', 0.15]].map(([id, l, v]) => `<div class="mb-2"><div class="sub">${l} <b id="${id}v">${v}</b></div><input type="range" class="slider" id="${id}" min="0.05" max="0.9" step="0.01" value="${v}" style="width:100%"></div>`).join('')}
        <div class="mb-2"><div class="sub">抽水 rake <b id="rkv">0.08</b></div><input type="range" id="rk" min="0.05" max="0.1" step="0.005" value="0.08" style="width:100%"></div>
        <div class="mb-2"><div class="sub">悔棋税 <b id="txv">1.5</b></div><input type="range" id="tx" min="1.2" max="2.5" step="0.1" value="1.5" style="width:100%"></div>
        <button class="btn gold" id="sim" style="width:100%;justify-content:center"><i class="fas fa-dice"></i> 运行 20,000 次模拟</button></div>
        <div class="card md:col-span-2" id="sim-out"><div class="sub">调整参数后运行</div></div></div>`
    const val = () => { let w = ['w1', 'w2', 'w3'].map((i) => +$('#' + i).value); const s = w.reduce((a, b) => a + b, 0); w = w.map((x) => Math.round((x / s) * 100) / 100); ['w1', 'w2', 'w3'].forEach((i, k) => ($('#' + i + 'v').textContent = w[k])); $('#rkv').textContent = $('#rk').value; $('#txv').textContent = $('#tx').value; return w }
    main.querySelectorAll('input[type=range]').forEach((i) => (i.oninput = val))
    $('#sim').onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api('/api/agents/4/simulate', { method: 'POST', body: { weights: val(), rake: +$('#rk').value, rewind_tax: +$('#tx').value, n: 20000 } })
      $('#sim-out').innerHTML = `<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap"><span class="tag blue">固定赔率 ${r.odds.map((o) => '×' + o).join(' / ')}</span><span class="tag ${r.arbitrage_risk ? 'red' : 'green'}">${r.arbitrage_risk ? '⚠ 存在套利风险，禁止发布' : '✓ 无正期望套利，EV 安全'}</span><span class="tag">平台优势 ≈ ${r.platform_edge_pct}%</span></div>
        <table class="tbl"><tr><th>玩家策略</th><th>玩家 EV / 100 Chips</th><th>胜率</th></tr>${r.rows.map((x) => `<tr><td>${x.strategy}</td><td style="color:${x.player_ev_per_100 > 0 ? 'var(--red)' : 'var(--mut)'}">${x.player_ev_per_100}</td><td>${x.win_rate}%</td></tr>`).join('')}</table>`
    })
  }

  V.rounds = async () => {
    const rs = await api('/api/console/rounds')
    main.innerHTML = header('fa-list', '局记录 · 审计', '事件溯源 + 哈希链；点击任一已结算局可复算验证') +
      `<div class="card" style="overflow:auto"><table class="tbl"><tr><th>时间</th><th>局</th><th>玩家</th><th>节点</th><th>模式</th><th>状态</th><th>结果</th><th>下注/派彩</th><th>悔棋</th><th>承诺</th><th></th></tr>
      ${rs.map((r) => `<tr><td>${ts(r.opened_at)}</td><td>${r.id}</td><td>${esc(r.user_id)}</td><td>${r.node_id}</td><td>${r.mode}</td><td><span class="tag">${r.state}</span></td><td>${['SETTLE', 'NEXT'].includes(r.state) ? r.outcome_id : '🔒'}</td><td>${r.amount ? `${r.amount} → <span style="color:${r.bet_status === 'won' ? 'var(--gold)' : 'var(--mut)'}">${r.payout}</span>` : '—'}</td><td>${r.rewind_count}</td><td style="font-family:monospace;font-size:11px">${r.commit_hash.slice(0, 10)}…</td><td>${['SETTLE', 'NEXT'].includes(r.state) ? `<button class="btn" data-v="${r.id}" style="font-size:11px;padding:3px 8px">验证</button>` : ''}</td></tr>`).join('')}</table></div><div id="vout" class="mt-3"></div>`
    main.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => { const v = await api(`/api/rounds/${b.dataset.v}/verify`); $('#vout').innerHTML = `<div class="card"><b>${v.round_id}</b> 承诺 <span class="${v.commit_match ? 'tag green' : 'tag red'}">${v.commit_match ? '✓' : '✗'}</span> 结果 <span class="${v.outcome_match ? 'tag green' : 'tag red'}">${v.outcome_match ? '✓' : '✗'}</span> 哈希链 <span class="${v.event_chain_ok ? 'tag green' : 'tag red'}">${v.event_chain_ok ? '✓' : '✗'}</span><pre class="code mt-2">${esc(JSON.stringify(v, null, 2))}</pre></div>` }))
  }

  V.tasks = async () => {
    const t = await api('/api/console/tasks')
    main.innerHTML = header('fa-microchip', '模型任务 · 统一调用契约', 'task.queued / succeeded / degraded / failed；主模型失败自动路由备选 → 降档 → 兜底模板') +
      `<div class="card" style="overflow:auto"><table class="tbl"><tr><th>时间</th><th>任务</th><th>Agent</th><th>能力</th><th>模型</th><th>队列</th><th>状态</th><th>耗时</th><th>成本</th><th>降级说明</th></tr>
      ${t.map((x) => `<tr><td>${ts(x.created_at)}</td><td style="font-size:11px">${x.id}</td><td><span class="tag purple">A${x.agent_no}</span></td><td>${x.capability}</td><td>${esc(x.model)}</td><td>${x.priority}</td><td><span class="tag ${x.status === 'succeeded' || x.status === 'ready' ? 'green' : x.status === 'degraded' ? 'yellow' : x.status === 'failed' ? 'red' : 'blue'}">${x.status}</span></td><td>${x.latency_ms ?? '—'}ms</td><td>${x.cost}</td><td class="sub" style="font-size:11px">${esc(x.degrade_reason || '')}</td></tr>`).join('')}</table></div>`
  }

  V.qa = async () => {
    const reps = await api('/api/agents/3/reports')
    main.innerHTML = header('fa-vial-circle-check', '自动化测试 · Agent-3 验收', '对 Agent-2 / Agent-4 的开发结果执行 11 项验收（对应 PRD 第 10 章验收标准）', `<button class="btn gold" id="run"><i class="fas fa-play"></i> 运行全部测试</button>`) + `<div id="qa-out"></div>`
    const show = (r) => {
      const cases = typeof r.detail === 'string' ? JSON.parse(r.detail) : r.cases
      $('#qa-out').innerHTML = `<div class="card mb-3"><div style="font-size:18px;font-weight:700">${r.passed}/${r.passed + r.failed} 通过 ${r.failed ? '<span class="tag red">存在失败</span>' : '<span class="tag green">全部通过</span>'}</div>
        <table class="tbl mt-2">${cases.map((c) => `<tr><td style="width:28px">${c.ok ? '<i class="fas fa-circle-check" style="color:var(--green)"></i>' : '<i class="fas fa-circle-xmark" style="color:var(--red)"></i>'}</td><td><b>${esc(c.name)}</b><div class="sub">${esc(c.detail)}</div></td><td class="sub">${c.ms}ms</td></tr>`).join('')}</table></div>`
    }
    if (reps[0]) show(reps[0])
    $('#run').onclick = (e) => busy(e.currentTarget, async () => show(await api('/api/agents/3/selftest', { method: 'POST' })))
  }

  let timer
  async function go() {
    clearInterval(timer)
    const p = route()
    try { await (V[p] || V.monitor)() } catch (e) { main.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>` }
    if (p === 'monitor') timer = setInterval(() => route() === 'monitor' && V.monitor(), 5000)
  }
  renderMenu(); go()
})()
