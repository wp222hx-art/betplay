// Agent-1 · 7-Agent 指挥中心：架构蓝图 + 各 Agent 职责/接口/一键执行 + 流水线编排
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const main = $('#agents-main')
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', 'x-user-id': 'agent_ops' }, body: opt.body ? JSON.stringify(opt.body) : undefined })
    const j = await r.json(); if (!r.ok) throw new Error(j.message || j.error); return j
  }
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600) }
  const ts = (t) => (t ? new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) : '—')

  const ACTIONS = {
    1: { label: '查看蓝图', run: () => api('/api/blueprint'), sum: (r) => `${r.stack.length} 层栈 · ${r.agents.length} Agent · ${r.principles.length} 原则` },
    2: { label: '执行 WF-05 补货', run: () => api('/api/agents/2/replenish', { method: 'POST', body: {} }), sum: (r) => `检查 ${r.checked} 缺口 · 入池 ${r.replenished.reduce((a, x) => a + x.variants.filter((v) => v.status === 'pool').length, 0)}` },
    3: { label: '运行自动化验收', run: () => api('/api/agents/3/selftest', { method: 'POST' }), sum: (r) => `${r.passed}/${r.total} 通过` },
    4: { label: 'EV 蒙特卡洛', run: () => api('/api/agents/4/simulate', { method: 'POST', body: { weights: [0.45, 0.4, 0.15] } }), sum: (r) => (r.arbitrage_risk ? '⚠ 套利风险' : '✓ 无套利') + ' · 赔率 ' + r.odds.join('/') },
    5: { label: '打开播放器', run: async () => { open('/', '_blank'); return { ok: 1 } }, sum: () => '已在新标签打开' },
    6: { label: '拉取大屏数据', run: () => api('/api/console/overview'), sum: (r) => `${r.kpi.rounds} 局 · ${r.kpi.bets} 注 · 告警 ${r.alerts.length}` },
    7: { label: '衍生下一幕', run: () => api('/api/agents/7/derive', { method: 'POST', body: { n: 3 } }), sum: (r) => `锚点 ${r.anchor} · ${r.candidates.length} 候选 · ${r.model}` }
  }

  async function render() {
    const [bp, agents, runs] = await Promise.all([api('/api/blueprint'), api('/api/agents'), api('/api/agents/runs')])
    main.innerHTML = `
      <section id="hero" class="card" style="background:linear-gradient(135deg,#1a1430,#0e1120 60%);margin-bottom:16px">
        <div class="sub" style="letter-spacing:4px;color:var(--gold)">AGENT-1 · 系统产品策划师 · 架构蓝图</div>
        <div class="serif" style="font-size:30px;font-weight:900;margin:6px 0">${esc(bp.name)} · 7-Agent 协作系统</div>
        <div class="poem">"${esc(bp.motto)}"</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${bp.principles.map((p, i) => `<span class="tag yellow">0${i + 1} ${esc(p)}</span>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn gold" id="pipeline"><i class="fas fa-diagram-successor"></i> 一键运行全流水线（A2→A3→A4→A7→A6）</button>${bp.terminals.map((t) => `<a class="btn" href="${t.path}">${esc(t.name)}</a>`).join('')}</div>
        <div id="pipe-out" class="mt-3"></div>
      </section>
      <section id="stack" class="grid md:grid-cols-6 gap-2 mb-4">${bp.stack.map((s) => `<div class="kpi"><div class="l">${s.layer} · A${s.agent}</div><div style="font-weight:700;margin:4px 0">${esc(s.name)}</div><div class="sub" style="font-size:11px">${s.items.map(esc).join(' · ')}</div></div>`).join('')}</section>
      <section id="agent-grid" class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">${agents.map((a) => `
        <article class="card agent-card" style="border-top:3px solid ${a.color}">
          <div style="display:flex;gap:10px;align-items:center"><div style="width:42px;height:42px;border-radius:12px;background:${a.color}22;color:${a.color};display:flex;align-items:center;justify-content:center;font-size:18px"><i class="fas ${a.icon}"></i></div>
            <div><div class="sub" style="font-size:11px">AGENT-${a.no} · ${a.code}</div><div style="font-weight:700">${esc(a.name)}</div></div>
            <div style="margin-left:auto;text-align:right"><div class="tag">${a.layer}</div><div class="sub" style="font-size:11px;margin-top:3px">运行 ${a.runs} 次</div></div></div>
          <p class="sub" style="margin:10px 0;line-height:1.7">${esc(a.mission)}</p>
          <div style="font-size:12px;margin-bottom:6px">${a.workflows.map((w) => `<span class="tag blue" style="margin:2px">${esc(w)}</span>`).join('')}</div>
          <details><summary class="sub" style="cursor:pointer;font-size:12px">接口 & 负责文件</summary><pre class="code" style="font-size:11px">${esc([...a.api, '', ...a.owns].join('\n'))}</pre></details>
          <div style="display:flex;gap:8px;align-items:center;margin-top:10px"><button class="btn" data-run="${a.no}"><i class="fas fa-play"></i> ${ACTIONS[a.no].label}</button><span class="sub" id="res-${a.no}" style="font-size:12px"></span></div>
        </article>`).join('')}</section>
      <section class="card mt-4"><div class="sub mb-2">协作日志（agent_runs）</div><div style="max-height:320px;overflow:auto"><table class="tbl">${runs.map((r) => `<tr><td>${ts(r.created_at)}</td><td><span class="tag purple">A${r.agent_no}</span></td><td>${esc(r.action)}</td><td><span class="tag ${r.status === 'ok' ? 'green' : r.status === 'degraded' ? 'yellow' : 'red'}">${r.status}</span></td><td class="sub">${esc(r.detail)}</td></tr>`).join('')}</table></div></section>`
    main.querySelectorAll('[data-run]').forEach((b) => (b.onclick = async () => {
      const n = +b.dataset.run, a = ACTIONS[n]; b.disabled = true; $('#res-' + n).innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
      try { const r = await a.run(); $('#res-' + n).textContent = a.sum(r) } catch (e) { $('#res-' + n).textContent = '失败：' + e.message } finally { b.disabled = false }
    }))
    $('#pipeline').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true
      const out = $('#pipe-out')
      const steps = [[2, 'Agent-2 补货变体池'], [3, 'Agent-3 验收测试'], [4, 'Agent-4 EV 安全'], [7, 'Agent-7 衍生下一幕'], [6, 'Agent-6 汇总统计']]
      out.innerHTML = steps.map(([n, l]) => `<div id="ps-${n}" class="sub" style="padding:4px 0"><i class="far fa-circle"></i> ${l}</div>`).join('')
      for (const [n, l] of steps) {
        const el = $('#ps-' + n); el.innerHTML = `<i class="fas fa-spinner fa-spin" style="color:var(--gold)"></i> ${l}…`
        try { const r = await ACTIONS[n].run(); el.innerHTML = `<i class="fas fa-circle-check" style="color:var(--green)"></i> ${l} — ${esc(ACTIONS[n].sum(r))}` }
        catch (err) { el.innerHTML = `<i class="fas fa-circle-xmark" style="color:var(--red)"></i> ${l} — ${esc(err.message)}` }
      }
      btn.disabled = false; toast('流水线完成')
    }
  }
  render().catch((e) => (main.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`))
})()
