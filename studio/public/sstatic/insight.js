// 前置模拟 · 剧本评审 · 生成流程视图：在花钱开拍前，把「能不能玩 / 合不合理 / 吸不吸引人 / 要拍什么、按什么顺序拍、花多少」一次看清
;(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TIER = { bad: ['坏结局', '#8a8aa6'], normal: ['普通', '#7dd3fc'], gold: ['👑 黄金', '#fbbf24'], platinum: ['💠 白金', '#c4b5fd'], diamond: ['💎 钻石', '#67e8f9'] }
  const CAT = { main: ['主线', '#ff6fae', 'fa-road'], branch: ['分支', '#7dd3fc', 'fa-code-branch'], merge: ['汇合', '#34d399', 'fa-code-merge'], ending: ['结局', '#fbbf24', 'fa-flag-checkered'], loop: ['时间裂隙', '#c084fc', 'fa-clock-rotate-left'] }
  const MODE = { reference: ['参考图锁人物', '#3ddc97'], frames: ['接上一段尾帧', '#f5a524'] }
  const DIMN = { hook: '开场钩子', suspense: '悬念密度', stakes: '抉择张力', twist: '反转力度', emotion: '情绪曲线', character: '人设辨识度', payoff: '结局回报' }
  const grade = (a) => (a >= 80 ? ['S', '#f472b6'] : a >= 70 ? ['A', '#3ddc97'] : a >= 60 ? ['B', '#7dd3fc'] : a >= 50 ? ['C', '#f5a524'] : ['D', '#ff5d73'])
  const pct = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`
  const bar = (v, max, c) => `<i class="ib"><b style="width:${Math.max(2, Math.min(100, (v / max) * 100))}%;background:${c}"></b></i>`

  function radar(dims) {
    const ks = Object.keys(DIMN), n = ks.length, R = 78, cx = 100, cy = 96
    const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)]
    const ring = (f) => ks.map((_, i) => pt(i, R * f).join(',')).join(' ')
    const val = ks.map((k, i) => pt(i, (R * (dims[k] || 0)) / 10).join(',')).join(' ')
    return `<svg viewBox="0 0 200 196" class="radar">${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" class="rg"/>`).join('')}
      <polygon points="${val}" class="rv"/>${ks.map((k, i) => { const [x, y] = pt(i, R + 13); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${DIMN[k].slice(0, 4)} ${dims[k] ?? '—'}</text>` }).join('')}</svg>`
  }

  function mount(root, o) {
    let d = null, view = localStorage.st_ins_view || 'cat', rv = null
    const load = async () => { try { d = await o.api(`/api/projects/${o.pid}/insight`); rv = d.review ? { ...d.review, grade: grade(d.review.appeal)[0] } : null; render() } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>` } }
    const render = () => {
      const s = d.simulation, m = d.manifest, b = d.budget
      root.innerHTML = `
      <div class="ins-top">
        <section class="card ins-kpi"><h3><i class="fas fa-dice"></i> 结构模拟 <span class="mut sm">${s.runs} 次随机游玩</span></h3>
          <div class="kv4"><div><b>${s.playable ? '✓' : '✗'}</b><span>玩家端可编译</span></div><div><b>${s.avg_seconds}s</b><span>平均一局（${s.min_seconds}–${s.max_seconds}s）</span></div><div><b>${s.avg_decisions}</b><span>平均抉择次数</span></div><div><b>${pct(s.premium_rate)}</b><span>黄金+结局到达率</span></div></div>
          <h4>结局分布 <span class="mut sm">均衡度 ${s.ending_balance}</span></h4>
          ${s.endings.map((e) => { const t = TIER[e.tier] || ['', '#aaa']; return `<div class="ib-row"><span>${esc(e.title)} <em style="color:${t[1]}">${t[0]}</em></span>${bar(e.p, 1, t[1])}<b>${pct(e.p)}</b></div>` }).join('') || '<p class="mut">没有可达结局</p>'}
          ${s.warnings.map((w) => `<div class="warn-t sm"><i class="fas fa-triangle-exclamation"></i> ${esc(w)}</div>`).join('')}
          ${s.compile_issues.filter((i) => i.level === 'error').map((i) => `<div class="bad-t sm"><i class="fas fa-circle-xmark"></i> ${esc(i.msg)}</div>`).join('')}
        </section>
        <section class="card ins-kpi"><h3><i class="fas fa-wand-magic-sparkles"></i> 剧本评审 · 吸引力指数 ${o.canWrite && d.stage.scripts ? `<button class="btn sm pri" data-review style="float:right"><i class="fas fa-play"></i> ${rv ? '重新评审' : '开始评审'}</button>` : ''}</h3>
          ${!d.stage.scripts ? '<p class="mut">第 4 步剧本写完后可评审（评审只花一次对话调用费用）。</p>' : rv ? (() => { const [g, gc] = grade(rv.appeal); return `
            <div class="ins-score"><div class="big" style="--c:${gc}"><b>${rv.appeal}</b><span>吸引力 · ${g} 级</span></div><div class="big" style="--c:${rv.logic >= 7 ? '#3ddc97' : rv.logic >= 5 ? '#f5a524' : '#ff5d73'}"><b>${rv.logic}<small>/10</small></b><span>剧本合理性</span></div>${radar(rv.dims || {})}</div>
            ${rv.verdict ? `<p class="sm"><b>总评：</b>${esc(rv.verdict)}</p>` : ''}${rv.hook ? `<p class="sm"><b>宣传语：</b>「${esc(rv.hook)}」</p>` : ''}
            ${(rv.highlights ? (typeof rv.highlights === 'string' ? JSON.parse(rv.highlights) : rv.highlights) : []).map((h) => `<span class="chip">✦ ${esc(h)}</span>`).join(' ')}
            <details open><summary class="sm"><b>问题 ${(rv.issues || []).length}</b></summary>${(rv.issues || []).map((i) => `<div class="sm ${i.level === 'error' ? 'bad-t' : ''}">${i.level === 'error' ? '✗' : '!'} ${i.node ? `<code>${esc(i.node)}</code> ` : ''}${esc(i.msg)} <span class="mut">${i.src === 'lint' ? '· 规则' : '· 评审'}</span></div>`).join('') || '<div class="mut sm">无</div>'}</details>
            <details><summary class="sm"><b>修改建议 ${(rv.suggestions || []).length}</b></summary>${(rv.suggestions || []).map((x) => `<div class="sm">→ ${x.node ? `<code>${esc(x.node)}</code> ` : ''}${esc(x.msg)}</div>`).join('')}</details>` })() : `<p class="mut">还没评审。${d.lint.length ? `规则检查已发现 ${d.lint.length} 处问题：` : ''}</p>${d.lint.slice(0, 6).map((i) => `<div class="sm ${i.level === 'error' ? 'bad-t' : 'warn-t'}">${esc(i.msg)}</div>`).join('')}`}
        </section>
        <section class="card ins-kpi"><h3><i class="fas fa-coins"></i> 预算预估 <span class="mut sm">${esc(b.currency)}</span></h3>
          <div class="kv4"><div><b>¥${b.total}</b><span>总计（含重拍缓冲）</span></div><div><b>${m.totals.clips}</b><span>片段 · ${m.totals.seconds}s</span></div><div><b>¥${b.videos}</b><span>视频 ¥${m.price_per_sec}/秒</span></div><div><b>¥${b.images}</b><span>设定图 / 封面</span></div></div>
          ${m.groups.map((g) => { const c = CAT[g.key]; return `<div class="ib-row"><span><i class="fas ${c[2]}" style="color:${c[1]}"></i> ${g.name} ${g.count}</span>${bar(g.cost, m.totals.cost || 1, c[1])}<b>¥${g.cost}</b></div>` }).join('')}
          <p class="mut sm">${esc(b.note)}。复用：${m.totals.reused} 段视频被多条路线共用，不重复拍。</p>
        </section>
      </div>
      <section class="card"><div class="gh"><h3><i class="fas fa-diagram-successor"></i> 生成流程 · ${m.totals.clips} 个片段提示词</h3><span class="ge-grow"></span>
        <div class="seg-sw">${[['cat', '按类型'], ['wave', '按生成批次'], ['flow', '剧情流程']].map(([k, n]) => `<button class="btn sm ${view === k ? 'pri' : ''}" data-view="${k}">${n}</button>`).join('')}</div></div>
        ${m.totals.missing_prompts ? `<div class="banner warn">${m.totals.missing_prompts} 个节点还没有提示词（第 5 步生成后这里会显示完整提示词）</div>` : ''}
        <div id="ins-flow">${view === 'wave' ? waves(m) : view === 'flow' ? flow(m, d) : cats(m)}</div>
        <div class="ins-act">${o.goStep ? `<button class="btn" data-go="7"><i class="fas fa-road"></i> 去第 7 步生成主线</button><button class="btn" data-go="8"><i class="fas fa-code-branch"></i> 去第 8 步生成分支</button>` : ''}</div>
      </section>`
      bind()
    }
    const card = (x) => { const c = CAT[x.category], md = MODE[x.mode], t = x.tier && TIER[x.tier]; return `<details class="pcard" style="--c:${c[1]}"><summary><b>${esc(x.title)}</b> <code>${esc(x.node)}</code>
      <span class="pill" style="--c:${md[1]}">${md[0]}${x.from ? ' ← ' + esc(x.from) : ''}</span>${t ? `<span class="pill" style="--c:${t[1]}">${t[0]}</span>` : ''}${x.reused ? `<span class="pill" style="--c:#34d399">复用 ×${x.used_in.length}</span>` : ''}
      <span class="mut sm">第 ${x.step} 步 · ${x.duration}s · ¥${x.cost}${x.cast.length ? ' · ' + x.cast.map(esc).join('、') : ''}</span></summary>
      <div class="pbody">${x.prompt ? `<pre class="code-b">${esc(x.prompt)}</pre>` : '<p class="mut sm">暂无提示词</p>'}<p class="mut sm">${esc(x.why)}${x.dialogue ? ` · 台词 ${x.dialogue} 句` : ''} · 用于片段：${x.used_in.map(esc).join('、') || '—'}</p></div></details>` }
    const cats = (m) => m.groups.map((g) => { const c = CAT[g.key]; return `<div class="pgroup"><h4 style="color:${c[1]}"><i class="fas ${c[2]}"></i> ${g.name} <span class="mut sm">${g.count} 段 · ${g.seconds}s · ¥${g.cost} · 参考图 ${g.reference} / 尾帧 ${g.frames}</span></h4>${m.items.filter((x) => x.category === g.key).map(card).join('')}</div>` }).join('')
    const waves = (m) => `<div class="pwaves">${m.waves.map((w) => `<div class="pwave"><h4>${esc(w.label)} <span class="mut sm">${w.nodes.length} 段</span></h4>${w.nodes.map((id) => card(m.items.find((x) => x.node === id))).join('')}</div>`).join('<div class="parrow"><i class="fas fa-arrow-down"></i> 上一批完成并通过质检后自动开拍</div>')}</div>`
    const flow = (m, d) => { const reach = Object.fromEntries(d.simulation.node_reach.map((r) => [r.id, r.p])); const mItem = Object.fromEntries(m.items.map((x) => [x.node, x]))
      const tree = d.manifest.items.length ? d.simulation : null; void tree
      return `<div class="pflow">${m.items.filter((x) => x.category === 'main').map((x, i) => `${i ? '<i class="fas fa-arrow-right parr"></i>' : ''}<div class="pf-n" style="--c:${CAT.main[1]}"><b>${esc(x.title)}</b><span>${esc(x.node)}${reach[x.node] !== undefined ? ` · 到达 ${pct(reach[x.node])}` : ''}</span></div>`).join('')}</div>
        <p class="mut sm">主线（上）是每位玩家都会看到的；下面是按来源分组的分支：</p>
        ${[...new Set(m.items.filter((x) => x.category !== 'main').map((x) => x.from || '参考图起拍'))].map((src) => `<div class="pf-src"><span class="mut sm">${src === '参考图起拍' ? '参考图起拍（不依赖上一段）' : '接「' + esc(mItem[src]?.title || src) + '」尾帧'}</span><div class="pflow">${m.items.filter((x) => x.category !== 'main' && (x.from || '参考图起拍') === src).map((x) => `<div class="pf-n" style="--c:${CAT[x.category][1]}"><b>${esc(x.title)}</b><span>${CAT[x.category][0]} · ${esc(x.node)}</span></div>`).join('')}</div></div>`).join('')}` }
    const bind = () => {
      root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { view = b.dataset.view; localStorage.st_ins_view = view; render() }))
      root.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => o.goStep(+b.dataset.go)))
      const r = root.querySelector('[data-review]')
      if (r) r.onclick = async () => { r.disabled = true; r.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 评审中…'; try { const x = await o.api(`/api/projects/${o.pid}/insight/review`, {}); o.toast(`吸引力 ${x.appeal}（${x.grade} 级）· 合理性 ${x.logic}/10`); await load() } catch (e) { o.toast(e.message); r.disabled = false } }
    }
    load()
  }
  window.InsightPanel = { mount }
})()
