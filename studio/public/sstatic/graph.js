// MoMo Studio · 结构图画布（纯 SVG，无第三方依赖）
// 功能：拖拽节点 / 平移缩放 / 连线 / 检查器编辑 / 实时结构检查 / AI 提案预览（新增节点高亮，采纳或丢弃）
;(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TYPE = {
    scene: { name: '场景', icon: '🎬', color: '#8b8fff' },
    choice: { name: '博弈锚点', icon: '🎲', color: '#ff6fae' },
    merge: { name: '汇合', icon: '🔀', color: '#38bdf8' },
    loop: { name: '时间裂隙', icon: '⏳', color: '#f5a524' },
    ending: { name: '结局', icon: '🏁', color: '#3ddc97' }
  }
  const TIER = { bad: ['坏结局', '#ff5d73'], normal: ['普通', '#9ca3af'], gold: ['黄金', '#f5c542'], platinum: ['白金', '#cfe3ff'], diamond: ['钻石', '#7df9ff'] }
  const NW = 180, NH = 64
  const uidN = (g) => { let k = g.nodes.length; let id; do id = 'n' + ++k; while (g.nodes.some((n) => n.id === id)); return id }
  const uidE = (g) => { let k = g.edges.length; let id; do id = 'e' + ++k; while (g.edges.some((n) => n.id === id)); return id }

  function mount(root, opt) {
    const st = { g: JSON.parse(JSON.stringify(opt.graph || { start: '', nodes: [], edges: [] })), sel: null, selE: null, view: { x: 0, y: 0, k: 1 }, connect: null, proposal: null, added: new Set(), analysis: null, dirty: false, busy: false }
    const ro = !!opt.readonly
    root.innerHTML = `<div class="ge">
      <div class="ge-bar">
        ${ro ? '' : `<button class="btn sm" data-add="scene">🎬 场景</button><button class="btn sm" data-add="choice">🎲 锚点</button><button class="btn sm" data-add="merge">🔀 汇合</button><button class="btn sm" data-add="loop">⏳ 裂隙</button><button class="btn sm" data-add="ending">🏁 结局</button><span class="ge-sep"></span>`}
        <button class="btn sm" data-act="fit" title="适配视图"><i class="fas fa-expand"></i></button>
        ${ro ? '' : `<button class="btn sm" data-act="layout" title="自动排版"><i class="fas fa-sitemap"></i> 排版</button>`}
        ${ro || !opt.canAI ? '' : `<span class="ge-sep"></span><button class="btn sm pri" data-act="draft"><i class="fas fa-wand-magic-sparkles"></i> AI 生成初版</button>`}
        <span class="ge-grow"></span><span class="ge-stat"></span>
      </div>
      <div class="ge-main"><div class="ge-cv"><svg class="ge-svg"><defs>
        <marker id="ge-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8a7a93"/></marker>
        <marker id="ge-arr-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ff6fae"/></marker>
        <marker id="ge-arr-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f5a524"/></marker>
        </defs><g class="ge-vp"><g class="ge-edges"></g><g class="ge-nodes"></g></g></svg>
        <div class="ge-prop" hidden></div><div class="ge-hint" hidden></div></div>
        <aside class="ge-side"><div class="ge-insp"></div><div class="ge-issues"></div></aside></div></div>`
    const $ = (s) => root.querySelector(s)
    const svg = $('.ge-svg'), vp = $('.ge-vp'), gE = $('.ge-edges'), gN = $('.ge-nodes')
    const byId = () => new Map(st.g.nodes.map((n) => [n.id, n]))

    // ── 渲染 ──
    function render() {
      const m = byId(), mainE = mainEdges()
      gE.innerHTML = st.g.edges.map((e) => {
        const a = m.get(e.from), b = m.get(e.to); if (!a || !b) return ''
        const back = e.kind === 'back', isMain = mainE.has(e.id)
        let d, lx, ly
        if (back) { const x1 = a.x + NW / 2, y1 = a.y, x2 = b.x + NW / 2, y2 = b.y, top = Math.min(y1, y2) - 70 - Math.abs(x1 - x2) * 0.08; d = `M${x1},${y1} C${x1},${top} ${x2},${top} ${x2},${y2}`; lx = (x1 + x2) / 2; ly = top + 18 }
        else { const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(40, (x2 - x1) / 2); d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 - 6 }
        const cls = `ge-e ${back ? 'back' : ''} ${isMain ? 'main' : ''} ${st.selE === e.id ? 'on' : ''} ${st.added.has(e.from) || st.added.has(e.to) ? 'new' : ''}`
        return `<g class="${cls}" data-e="${e.id}"><path class="hit" d="${d}"/><path class="ln" d="${d}" marker-end="url(#ge-arr${back ? '-b' : isMain ? '-m' : ''})"/>${e.label || back ? `<text x="${lx}" y="${ly}" text-anchor="middle">${esc(back ? `↶ 回溯${e.max_uses > 1 ? '×' + e.max_uses : ''}` : e.label)}</text>` : ''}</g>`
      }).join('')
      const bad = new Set((st.analysis?.issues || []).filter((i) => i.level === 'error' && i.node).map((i) => i.node))
      const warn = new Set((st.analysis?.issues || []).filter((i) => i.level === 'warn' && i.node).map((i) => i.node))
      gN.innerHTML = st.g.nodes.map((n) => {
        const t = TYPE[n.type] || TYPE.scene, tier = n.type === 'ending' ? TIER[n.tier || 'normal'] : null
        const col = tier ? tier[1] : t.color
        return `<g class="ge-n ${st.sel === n.id ? 'on' : ''} ${st.added.has(n.id) ? 'new' : ''} ${bad.has(n.id) ? 'bad' : warn.has(n.id) ? 'warn' : ''} ${st.connect === n.id ? 'src' : ''}" data-n="${n.id}" transform="translate(${n.x},${n.y})" style="--c:${col}">
          <rect width="${NW}" height="${NH}" rx="${n.type === 'choice' ? 18 : 10}"/><rect class="band" width="6" height="${NH}" rx="3"/>
          <text x="16" y="24" class="tt">${t.icon} ${esc(n.title).slice(0, 12)}</text>
          <text x="16" y="45" class="sb">${esc(tier ? `${t.name} · ${tier[0]}` : n.id === st.g.start ? `起点 · ${t.name}` : `${t.name} · ${n.id}`)}</text>
          ${ro ? '' : `<circle class="port" cx="${NW}" cy="${NH / 2}" r="7"/>`}</g>`
      }).join('')
      vp.setAttribute('transform', `translate(${st.view.x},${st.view.y}) scale(${st.view.k})`)
      inspector(); issues(); stat()
    }
    function mainEdges() {
      const s = new Set(), seen = new Set(); let cur = st.g.start
      while (cur && !seen.has(cur)) { seen.add(cur); const outs = st.g.edges.filter((e) => e.from === cur && e.kind !== 'back'); if (!outs.length) break; const e = outs.find((x) => x.main) || outs[0]; s.add(e.id); cur = e.to }
      return s
    }
    function stat() {
      const a = st.analysis?.stats, errs = (st.analysis?.issues || []).filter((i) => i.level === 'error').length
      $('.ge-stat').innerHTML = a ? `<b>${a.nodes}</b> 节点 · <b>${a.paths > 1e6 ? '100万+' : a.paths}</b> 条路径 · 需拍 <b>${a.clips}</b> 段（主线 ${a.main_clips} / 分支 ${a.branch_clips}）${a.tree_clips && a.tree_clips > a.clips ? ` · 汇合节省 <b>${Math.round((1 - a.clips / a.tree_clips) * 100)}%</b>` : ''}${a.est_cost ? ` · 估算 ¥${a.est_cost}` : ''} · ${errs ? `<span class="bad-t">${errs} 个错误</span>` : '<span class="ok-t">结构合法</span>'}${st.dirty ? ' · <span class="warn-t">未保存</span>' : ''}` : '…'
    }
    function issues() {
      const is = st.analysis?.issues || []
      $('.ge-issues').innerHTML = `<h4>结构检查 ${is.length ? `<span class="mut sm">（${is.filter((i) => i.level === 'error').length} 错 / ${is.filter((i) => i.level === 'warn').length} 警告）</span>` : ''}</h4>` + (is.length ? is.map((i) => `<div class="ge-is ${i.level}" ${i.node ? `data-go="${i.node}"` : ''}${i.edge ? ` data-goe="${i.edge}"` : ''}>${i.level === 'error' ? '⛔' : '⚠️'} ${esc(i.msg)}</div>`).join('') : '<p class="ok-t sm">✓ 没有问题</p>')
    }
    function inspector() {
      const box = $('.ge-insp'), m = byId()
      if (st.selE) {
        const e = st.g.edges.find((x) => x.id === st.selE); if (!e) { st.selE = null; return inspector() }
        const a = m.get(e.from), b = m.get(e.to)
        box.innerHTML = `<h4>${e.kind === 'back' ? '↶ 回溯边' : e.kind === 'option' ? '🎲 选项' : '→ 顺接'}</h4><p class="mut sm">${esc(a?.title)} → ${esc(b?.title)}</p>
          ${e.kind === 'option' ? `<label class="f">选项文案（≤8 字动作）<input class="inp" data-ef="label" value="${esc(e.label || '')}" maxlength="12" ${ro ? 'disabled' : ''}></label><label class="f">风险提示<input class="inp" data-ef="hint" value="${esc(e.hint || '')}" maxlength="40" ${ro ? 'disabled' : ''}></label>` : ''}
          ${e.kind === 'back' ? `<label class="f">可回溯次数<input class="inp" type="number" min="1" max="3" data-ef="max_uses" value="${e.max_uses || 1}" ${ro ? 'disabled' : ''}></label>` : ''}
          ${e.kind !== 'back' ? `<label class="chk"><input type="checkbox" data-ef="main" ${e.main ? 'checked' : ''} ${ro ? 'disabled' : ''}> 主线（最佳观看路径，用参考图模式拍摄）</label>` : ''}
          ${ro ? '' : '<button class="btn sm bad" data-del-e>删除这条边</button>'}`
        return
      }
      const n = m.get(st.sel)
      if (!n) { box.innerHTML = `<h4>画布操作</h4><ul class="mut sm ge-help"><li>拖动节点移动；拖动空白处平移；滚轮缩放</li><li>从节点右侧 <b>●</b> 拖到另一个节点 = 连线</li><li>「时间裂隙」连向上游节点会自动成为回溯边</li><li>选中节点后可让 AI 在此延展分支</li><li>Delete 键删除选中项</li></ul>`; return }
      const outs = st.g.edges.filter((e) => e.from === n.id && e.kind !== 'back').length
      box.innerHTML = `<h4>${TYPE[n.type].icon} 节点 <span class="mut sm">${esc(n.id)}</span></h4>
        <label class="f">类型<select class="inp" data-f="type" ${ro ? 'disabled' : ''}>${Object.entries(TYPE).map(([k, t]) => `<option value="${k}" ${n.type === k ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></label>
        <label class="f">标题<input class="inp" data-f="title" value="${esc(n.title)}" maxlength="24" ${ro ? 'disabled' : ''}></label>
        <label class="f">剧情节拍<textarea class="inp" data-f="beat" rows="3" maxlength="240" ${ro ? 'disabled' : ''}>${esc(n.beat || '')}</textarea></label>
        ${n.type === 'choice' || n.type === 'loop' ? `<label class="f">博弈情境<input class="inp" data-f="question" value="${esc(n.question || '')}" maxlength="60" ${ro ? 'disabled' : ''}></label>` : ''}
        ${n.type === 'ending' ? `<label class="f">结局等级<select class="inp" data-f="tier" ${ro ? 'disabled' : ''}>${Object.entries(TIER).map(([k, t]) => `<option value="${k}" ${(n.tier || 'normal') === k ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>` : ''}
        ${ro ? '' : `<div class="ge-row"><button class="btn sm" data-start ${st.g.start === n.id ? 'disabled' : ''}>设为起点</button><button class="btn sm bad" data-del>删除节点</button></div>`}
        ${ro || !opt.canAI ? '' : `<div class="ge-ai"><h4>🤖 结构 Agent · 在此延展</h4>
          <textarea class="inp" id="ge-hint" rows="2" placeholder="可选：补充要求，例如「加一个背叛线，最后汇合到决战」"></textarea>
          <div class="ge-row">${n.type === 'choice' ? `<button class="btn sm pri" data-ext="branch" ${outs >= 4 ? 'disabled' : ''}>＋ 新选项分支</button>` : ''}
          ${(!outs || n.type === 'ending') && n.type !== 'choice' ? `<button class="btn sm pri" data-ext="continue">续写后续剧情</button>` : ''}
          ${n.type !== 'ending' && n.type !== 'loop' && outs ? `<button class="btn sm" data-ext="loop">⏳ 插入时间裂隙</button>` : ''}</div></div>`}`
    }

    // ── 分析（防抖，服务端权威）──
    let tmr
    const analyze = (now) => { clearTimeout(tmr); tmr = setTimeout(async () => { try { const r = await opt.api('analyze', { graph: st.g }); st.analysis = r; render() } catch (e) { opt.toast?.(e.message) } }, now ? 0 : 400) }
    const changed = () => { st.dirty = true; opt.onChange?.(st.g); render(); analyze() }

    // ── 坐标 ──
    const toG = (ev) => { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left - st.view.x) / st.view.k, y: (ev.clientY - r.top - st.view.y) / st.view.k } }
    function fit() {
      const r = svg.getBoundingClientRect(); if (!st.g.nodes.length || !r.width) { st.view = { x: 40, y: 0, k: 1 }; return render() }
      const xs = st.g.nodes.map((n) => n.x), ys = st.g.nodes.map((n) => n.y)
      const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + NW + 40, minY = Math.min(...ys) - 110, maxY = Math.max(...ys) + NH + 40
      const k0 = Math.min(r.width / (maxX - minX), r.height / (maxY - minY)), k = Math.max(0.55, Math.min(1.2, k0))
      // 放得下就居中；放不下就保持可读缩放并从起点（左侧）开始，其余部分拖动/滚轮查看
      st.view = k0 >= 0.55 ? { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k } : { k, x: 20 - minX * k, y: r.height / 2 - ((minY + maxY) / 2) * k }; render()
    }

    // ── 交互：拖拽 / 平移 / 连线 ──
    let drag = null
    svg.addEventListener('pointerdown', (ev) => {
      const port = ev.target.closest('.port'), ng = ev.target.closest('.ge-n'), eg = ev.target.closest('.ge-e')
      if (st.proposal) return
      if (port && !ro) { const id = ng.dataset.n; drag = { mode: 'link', from: id }; st.connect = id; svg.setPointerCapture(ev.pointerId); return }
      if (ng) { const n = byId().get(ng.dataset.n); st.sel = n.id; st.selE = null; const p = toG(ev); drag = { mode: 'node', n, dx: p.x - n.x, dy: p.y - n.y, moved: false }; svg.setPointerCapture(ev.pointerId); render(); return }
      if (eg) { st.selE = eg.dataset.e; st.sel = null; render(); return }
      st.sel = null; st.selE = null; drag = { mode: 'pan', sx: ev.clientX - st.view.x, sy: ev.clientY - st.view.y }; svg.setPointerCapture(ev.pointerId); render()
    })
    let tempLine = null
    svg.addEventListener('pointermove', (ev) => {
      if (!drag) return
      if (drag.mode === 'pan') { st.view.x = ev.clientX - drag.sx; st.view.y = ev.clientY - drag.sy; vp.setAttribute('transform', `translate(${st.view.x},${st.view.y}) scale(${st.view.k})`) }
      else if (drag.mode === 'node' && !ro) { const p = toG(ev); drag.n.x = Math.round(p.x - drag.dx); drag.n.y = Math.round(p.y - drag.dy); drag.moved = true; render() }
      else if (drag.mode === 'link') {
        const a = byId().get(drag.from), p = toG(ev)
        if (!tempLine) { tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tempLine.setAttribute('class', 'ge-temp'); vp.appendChild(tempLine) }
        tempLine.setAttribute('d', `M${a.x + NW},${a.y + NH / 2} L${p.x},${p.y}`)
      }
    })
    svg.addEventListener('pointerup', (ev) => {
      if (!drag) return
      if (drag.mode === 'node' && drag.moved) { st.dirty = true; opt.onChange?.(st.g); stat() }
      if (drag.mode === 'link') {
        tempLine?.remove(); tempLine = null; st.connect = null
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ge-n')
        if (el && el.dataset.n !== drag.from) link(drag.from, el.dataset.n); else render()
      }
      drag = null
    })
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault(); const r = svg.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top
      const k2 = Math.max(0.15, Math.min(2.5, st.view.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)))
      st.view.x = mx - ((mx - st.view.x) * k2) / st.view.k; st.view.y = my - ((my - st.view.y) * k2) / st.view.k; st.view.k = k2
      vp.setAttribute('transform', `translate(${st.view.x},${st.view.y}) scale(${st.view.k})`)
    }, { passive: false })

    function isAncestor(a, b) { // a 是否为 b 的上游（前进边）
      const inn = new Map(); for (const e of st.g.edges) if (e.kind !== 'back') { if (!inn.has(e.to)) inn.set(e.to, []); inn.get(e.to).push(e.from) }
      const seen = new Set([b]), stack = [b]; while (stack.length) for (const p of inn.get(stack.pop()) || []) { if (p === a) return true; if (!seen.has(p)) { seen.add(p); stack.push(p) } }
      return false
    }
    function link(from, to) {
      const a = byId().get(from)
      if (st.g.edges.some((e) => e.from === from && e.to === to)) return opt.toast?.('已经连过了')
      const back = a.type === 'loop' && isAncestor(to, from)
      if (!back && isAncestor(to, from)) return opt.toast?.('这会形成环。想让剧情回到前面，请从「时间裂隙」节点连线（自动成为回溯边）')
      const kind = back ? 'back' : a.type === 'choice' || a.type === 'loop' ? 'option' : 'next'
      if (kind === 'next' && st.g.edges.some((e) => e.from === from && e.kind !== 'back')) return opt.toast?.('场景只能有一条后续。需要分叉请改成「博弈锚点」')
      const e = { id: uidE(st.g), from, to, kind }
      if (kind === 'option') e.label = '新选项'
      if (kind === 'back') e.max_uses = 1
      st.g.edges.push(e); st.selE = e.id; st.sel = null; changed()
    }

    // ── 检查器编辑 ──
    root.addEventListener('input', (ev) => {
      const f = ev.target.dataset.f, ef = ev.target.dataset.ef
      if (f) { const n = byId().get(st.sel); if (!n) return; n[f] = ev.target.value; if (f === 'type') { if (n.type !== 'ending') delete n.tier; else n.tier = n.tier || 'normal'; for (const e of st.g.edges) if (e.from === n.id && e.kind !== 'back') { e.kind = n.type === 'choice' || n.type === 'loop' ? 'option' : 'next'; if (e.kind === 'option' && !e.label) e.label = '新选项' } } ; if (f === 'type' || f === 'tier') changed(); else { st.dirty = true; opt.onChange?.(st.g); clearTimeout(st._rt); st._rt = setTimeout(() => { render(); analyze() }, 350) } }
      if (ef) { const e = st.g.edges.find((x) => x.id === st.selE); if (!e) return; if (ef === 'main') { if (ev.target.checked) for (const x of st.g.edges) if (x.from === e.from) delete x.main; e.main = ev.target.checked || undefined } else if (ef === 'max_uses') e.max_uses = Math.max(1, Math.min(3, +ev.target.value || 1)); else e[ef] = ev.target.value; st.dirty = true; opt.onChange?.(st.g); clearTimeout(st._rt); st._rt = setTimeout(() => { render(); analyze() }, 350) }
    })
    root.addEventListener('change', (ev) => { if (ev.target.dataset.ef === 'main') changed() })
    function delNode(id) { st.g.nodes = st.g.nodes.filter((n) => n.id !== id); st.g.edges = st.g.edges.filter((e) => e.from !== id && e.to !== id); if (st.g.start === id) st.g.start = st.g.nodes[0]?.id || ''; st.sel = null; changed() }
    root.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button,[data-go],[data-goe]'); if (!t) return
      if (t.dataset.add) {
        const r = svg.getBoundingClientRect(), c = { x: (r.width / 2 - st.view.x) / st.view.k - NW / 2, y: (r.height / 2 - st.view.y) / st.view.k - NH / 2 }
        const n = { id: uidN(st.g), type: t.dataset.add, title: TYPE[t.dataset.add].name, beat: '', x: Math.round(c.x + (Math.random() - 0.5) * 60), y: Math.round(c.y + (Math.random() - 0.5) * 60) }
        if (n.type === 'ending') n.tier = 'normal'
        st.g.nodes.push(n); if (!st.g.start) st.g.start = n.id; st.sel = n.id; st.selE = null; changed()
      }
      if (t.dataset.act === 'fit') fit()
      if (t.dataset.act === 'layout') { const r = await opt.api('layout', { graph: st.g }); st.g = r.graph; changed(); fit() }
      if (t.dataset.act === 'draft') ai('draft', {})
      if (t.dataset.ext) ai('extend', { node: st.sel, mode: t.dataset.ext, hint: $('#ge-hint')?.value || '' })
      if (t.hasAttribute('data-del')) delNode(st.sel)
      if (t.hasAttribute('data-del-e')) { st.g.edges = st.g.edges.filter((e) => e.id !== st.selE); st.selE = null; changed() }
      if (t.hasAttribute('data-start')) { st.g.start = st.sel; changed() }
      if (t.dataset.go) { st.sel = t.dataset.go; st.selE = null; const n = byId().get(st.sel); if (n) { const r = svg.getBoundingClientRect(); st.view.x = r.width / 2 - (n.x + NW / 2) * st.view.k; st.view.y = r.height / 2 - (n.y + NH / 2) * st.view.k } render() }
      else if (t.dataset.goe) { st.selE = t.dataset.goe; st.sel = null; render() }
      if (t.hasAttribute('data-accept')) { st.g = st.proposal.graph; st.proposal = null; st.added = new Set(st.added); $('.ge-prop').hidden = true; changed(); setTimeout(() => { st.added = new Set(); render() }, 6000) }
      if (t.hasAttribute('data-discard')) { st.g = st.proposal.before; st.proposal = null; st.added = new Set(); $('.ge-prop').hidden = true; render(); analyze(true) }
    })
    document.addEventListener('keydown', function kd(ev) {
      if (!document.body.contains(root)) return document.removeEventListener('keydown', kd)
      if (ro || st.proposal || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return
      if (ev.key === 'Delete' || ev.key === 'Backspace') { if (st.sel) delNode(st.sel); else if (st.selE) { st.g.edges = st.g.edges.filter((e) => e.id !== st.selE); st.selE = null; changed() } }
    })

    // ── AI 提案 ──
    async function ai(kind, payload) {
      if (st.busy) return
      if (kind === 'draft' && st.g.nodes.length && !confirm('AI 初版会替换当前整张结构图（先预览，确认后才生效）。继续？')) return
      st.busy = true; const hint = $('.ge-hint'); hint.hidden = false; hint.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 结构 Agent 正在${kind === 'draft' ? '设计整张结构图' : '延展剧情'}…（约 20–60 秒）`
      try {
        const r = await opt.api(kind, { graph: st.g, ...payload })
        st.proposal = { before: st.g, graph: r.proposal }
        st.added = new Set(kind === 'draft' ? r.proposal.nodes.map((n) => n.id) : r.added)
        st.g = r.proposal; st.analysis = r.analysis; st.sel = null; st.selE = null
        const errs = r.analysis.issues.filter((i) => i.level === 'error').length, s = r.analysis.stats
        const p = $('.ge-prop'); p.hidden = false
        p.innerHTML = `<b>🤖 AI 提案</b> · ${kind === 'draft' ? `${s?.nodes} 节点` : `新增 ${r.added.length} 节点`} · ${s?.paths ?? '?'} 条路径 · ${errs ? `<span class="bad-t">${errs} 个问题需人工修</span>` : '<span class="ok-t">结构合法</span>'}${r.fixes?.length ? ` · <span class="warn-t" title="${esc(r.fixes.join('\n'))}">已自动修正 ${r.fixes.length} 处 ⓘ</span>` : ''}<span class="ge-grow"></span><button class="btn sm ok" data-accept>采纳</button><button class="btn sm" data-discard>丢弃</button>`
        render(); if (kind === 'draft') fit()
      } catch (e) { opt.toast?.(e.message) } finally { st.busy = false; hint.hidden = true }
    }

    // 初始：没有坐标的节点先排版
    if (st.g.nodes.some((n) => n.x === undefined || n.y === undefined)) opt.api('layout', { graph: st.g }).then((r) => { st.g = r.graph; render(); fit(); analyze(true) }).catch(() => {})
    else { render(); requestAnimationFrame(fit); analyze(true) }

    return {
      get graph() { return st.g },
      get analysis() { return st.analysis },
      get pending() { return !!st.proposal },
      saved() { st.dirty = false; stat() },
      setIssues(is) { st.analysis = { ...(st.analysis || {}), issues: is }; render() }
    }
  }
  window.GraphEditor = { mount }
})()
