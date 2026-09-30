// 第 10 步「预检 · 上架」面板：上架信息 → 预检 + 剧情预览 → 打包新版本（合规审核 + 执行节点拼接）→ 提交审核 → 审核通过 = 发布
// 版本历史：任意历史快照一键回滚；线上下架 / 恢复
;(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmtT = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')
  const GN = { romance: '恋爱·甜宠', urban: '都市·豪门', revenge: '复仇·逆袭', suspense: '悬疑·惊悚', costume: '古风·仙侠', fantasy: '奇幻·科幻', action: '动作·犯罪', survival: '末日·生存', absurd: '无厘头·整活', surreal: '超现实·梦核' }
  const AN = { all: '全向', female: '女频', male: '男频' }, RN = { all: '全年龄', 12: '12+', 16: '16+', 18: '18+' }
  const TIER = { bad: ['坏结局', '#8a8aa6'], normal: ['普通', '#7dd3fc'], gold: ['👑 黄金', '#fbbf24'], platinum: ['💠 白金', '#c4b5fd'], diamond: ['💎 钻石', '#67e8f9'] }
  const RS = { packing: ['打包中', '#f5a524'], ready: ['待发布', '#c084fc'], published: ['线上版本', '#3ddc97'], superseded: ['历史版本', '#6b7280'], failed: ['打包失败', '#ff5d73'], canceled: ['已取消', '#6b7280'] }

  function mount(root, o) {
    let timer = null, d = null
    const load = async () => {
      try { d = await o.api(`/api/projects/${o.pid}/release`) } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
      render(); clearTimeout(timer); if (d.packing) timer = setTimeout(async () => { const was = !!d.packing; await load(); if (was && !d.packing) o.onChange && o.onChange() }, 3000)
    }
    const render = () => {
      const m = d.meta, ro = o.readonly, blocks = d.checks.filter((c) => !c.ok && c.level === 'block'), warns = d.checks.filter((c) => !c.ok && c.level === 'warn')
      const latest = d.releases[0], live = d.live
      root.innerHTML = `
      ${live ? `<div class="banner ${live.status === 'live' ? 'ok' : 'warn'} rl-live"><i class="fas ${live.status === 'live' ? 'fa-signal' : 'fa-circle-pause'}"></i> 玩家端 <b>${esc(live.series_id)}</b> · v${live.version} · ${live.status === 'live' ? '上线中' : '已下架'}
        ${o.playerOrigin ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(o.playerOrigin)}/s/${esc(live.series_id)}"><i class="fas fa-arrow-up-right-from-square"></i> 打开玩家端</a>` : ''}
        ${o.canJudge2 ? (live.status === 'live' ? `<button class="btn sm bad" data-live="0"><i class="fas fa-eye-slash"></i> 下架</button>` : `<button class="btn sm ok" data-live="1"><i class="fas fa-eye"></i> 恢复上线</button>`) : ''}</div>` : ''}
      <div class="rl-grid">
        <section class="card rl-meta"><h3><i class="fas fa-tag"></i> 上架信息</h3>
          <form id="rl-f" class="rl-form">
            <label class="f">标题<input class="inp" name="title" maxlength="30" value="${esc(m.title)}" ${ro ? 'disabled' : ''}></label>
            <label class="f">一句话简介<textarea class="inp" name="logline" maxlength="120" rows="2" ${ro ? 'disabled' : ''}>${esc(m.logline)}</textarea></label>
            <div class="rl-row">
              <label class="f">题材<select class="inp" name="genre" ${ro ? 'disabled' : ''}><option value="">请选择</option>${d.options.genres.map((g) => `<option value="${g}" ${m.genre === g ? 'selected' : ''}>${GN[g] || g}</option>`).join('')}</select></label>
              <label class="f">受众<select class="inp" name="aud" ${ro ? 'disabled' : ''}>${d.options.auds.map((x) => `<option value="${x}" ${m.aud === x ? 'selected' : ''}>${AN[x]}</option>`).join('')}</select></label>
              <label class="f">分级<select class="inp" name="rating" ${ro ? 'disabled' : ''}>${d.options.ratings.map((x) => `<option value="${x}" ${m.rating === x ? 'selected' : ''}>${RN[x]}</option>`).join('')}</select></label>
              <label class="f">角标<select class="inp" name="badge" ${ro ? 'disabled' : ''}>${d.options.badges.map((x) => `<option ${m.badge === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
            </div>
            <label class="f">标签（逗号分隔，最多 5 个）<input class="inp" name="tags" value="${esc((m.tags || []).join('，'))}" ${ro ? 'disabled' : ''}></label>
            ${ro ? '' : '<button class="btn sm" type="submit"><i class="fas fa-floppy-disk"></i> 保存上架信息</button>'}
          </form></section>
        <section class="card rl-pf"><h3><i class="fas fa-list-check"></i> 预检 <span class="pill" style="--c:${blocks.length ? '#ff5d73' : '#3ddc97'}">${blocks.length ? blocks.length + ' 项阻断' : '可以打包'}</span></h3>
          <ul class="rl-checks">${d.checks.map((c) => `<li class="${c.ok ? 'ok' : c.level}"><i class="fas ${c.ok ? 'fa-circle-check' : c.level === 'block' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i><span>${esc(c.msg)}</span></li>`).join('')}</ul>
          <div class="rl-act">
            ${!ro && !d.packing ? `<button class="btn pri" data-pack ${blocks.length ? 'disabled' : ''}><i class="fas fa-box-archive"></i> 打包新版本</button>` : ''}
            ${d.packing ? `<span class="pill" style="--c:#f5a524"><i class="fas fa-spinner fa-spin"></i> v${d.packing.version} 打包中 · ${esc(d.packing.job?.status === 'claimed' ? '执行节点处理中' : '等待执行节点')}</span>${!ro ? ' <button class="btn sm" data-cancel>取消</button>' : ''}` : ''}
            ${latest && !d.packing ? `<span class="mut sm">${latest.up_to_date ? `最新快照 v${latest.version} 与当前内容一致` : `<b class="warn-t">最新快照 v${latest.version} 已过期（打包后上游有改动）</b>`}</span>` : ''}
          </div>
          <p class="mut sm hide-m">打包 = 合规审核 Agent 审文本 → 执行节点把节点视频按剧情拼成播放片段、裁角色头像 → 生成不可变快照。提交审核后，审核人「审核通过」即发布到玩家端。</p>
        </section>
      </div>
      <section class="card"><h3><i class="fas fa-diagram-project"></i> 玩家端剧情预览 <span class="mut sm">${d.stats.decisions} 个抉择点 · ${d.stats.endings} 个结局 · ${d.stats.segments} 个片段 · 用到 ${d.stats.clips_used} 段视频${d.stats.clips_reused ? `（${d.stats.clips_reused} 段被多条路线复用）` : ''}</span></h3>
        <div class="rl-tree">
          <div class="rl-seg pro"><b>序章</b><span>${(d.plan.segments.find((s) => s.id === 'P')?.parts || []).map(esc).join(' → ')}</span></div>
          ${d.plan.nodes.map((n) => `<div class="rl-node"><div class="q"><span class="pill" style="--c:#ff6fae">第 ${n.depth} 幕</span> <b>${esc(n.question)}</b>${n.fork ? ' <span class="pill" style="--c:#c084fc">⟲ 时间裂隙</span>' : ''}</div>
            <div class="opts">${n.options.map((op) => { const sg = d.plan.segments.find((s) => s.id === op.seg); const t = TIER[op.tier]; return `<div class="op"><b>${esc(op.label)}</b><span class="mut sm">${(sg?.parts || []).map(esc).join(' → ')}</span>${op.ending ? `<span class="pill" style="--c:${t ? t[1] : '#aaa'}">结局 · ${esc(op.ending)}${t ? ' · ' + t[0] : ''}</span>` : `<span class="pill" style="--c:#7dd3fc">→ 下一幕</span>`}</div>` }).join('')}</div></div>`).join('')}
        </div></section>
      <section class="card"><h3><i class="fas fa-clock-rotate-left"></i> 版本快照</h3>
        ${d.releases.length ? `<div class="tbl"><table><tr><th>版本</th><th>状态</th><th>内容</th><th>合规</th><th>时间</th><th></th></tr>${d.releases.map((r) => { const [sn, sc] = RS[r.status] || [r.status, '#888']; const cp = r.compliance; return `<tr>
          <td><b>v${r.version}</b><div class="mut sm">${esc(r.id)}</div></td>
          <td><span class="pill" style="--c:${sc}">${sn}</span>${r.status !== 'superseded' && r.status !== 'canceled' && !r.up_to_date && r.status !== 'failed' ? '<div class="warn-t sm">内容已变</div>' : ''}${r.error ? `<div class="bad-t sm">${esc(r.error.slice(0, 120))}</div>` : ''}</td>
          <td class="sm">${esc(r.meta?.title || '')}<div class="mut">${r.stats?.segments || '—'} 片段 · ${r.stats?.seconds ? r.stats.seconds + ' 秒' : '—'}${r.stats?.bytes ? ' · ' + (r.stats.bytes / 1e6).toFixed(1) + 'MB' : ''}</div></td>
          <td class="sm">${cp ? `<span class="pill" style="--c:${cp.risk === 'low' ? '#3ddc97' : cp.risk === 'medium' ? '#f5a524' : '#ff5d73'}">${{ low: '低风险', medium: '中风险', high: '高风险' }[cp.risk] || cp.risk}</span>${cp.issues?.length ? `<details><summary class="mut">${cp.issues.length} 条提示</summary>${cp.issues.map((i) => `<div>· ${esc(i.where)}：${esc(i.msg)}</div>`).join('')}</details>` : ''}` : '—'}</td>
          <td class="sm">${fmtT(r.created_at)}${r.published_at ? `<div class="mut">发布 ${fmtT(r.published_at)}</div>` : ''}</td>
          <td>${o.canJudge2 && r.status === 'superseded' ? `<button class="btn sm" data-rollback="${esc(r.id)}"><i class="fas fa-rotate-left"></i> 回滚到此版</button>` : ''}</td></tr>` }).join('')}</table></div>` : '<p class="mut">还没有打包过。预检通过后点「打包新版本」。</p>'}
        ${d.logs.length ? `<details class="rl-logs"><summary class="mut sm">上架日志（${d.logs.length}）</summary>${d.logs.map((l) => `<div class="sm">${fmtT(l.created_at)} · <b>${esc(l.action)}</b> v${l.version ?? '—'} · ${esc(l.actor || '')} ${esc(l.note || '')}</div>`).join('')}</details>` : ''}
      </section>`
      bind()
    }
    const go = async (fn, msg) => { try { await fn(); if (msg) o.toast(msg); await load(); o.onChange && o.onChange() } catch (e) { o.toast(e.message) } }
    const bind = () => {
      const f = root.querySelector('#rl-f')
      if (f) f.onsubmit = (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(f)); go(() => o.api(`/api/projects/${o.pid}/release/meta`, b), '上架信息已保存') }
      root.querySelector('[data-pack]')?.addEventListener('click', async (e) => { e.target.disabled = true; o.toast('合规审核中…'); await go(() => o.api(`/api/projects/${o.pid}/release/pack`, {}), '已提交打包，执行节点处理中') })
      root.querySelector('[data-cancel]')?.addEventListener('click', () => go(() => o.api(`/api/projects/${o.pid}/release/cancel`, {}), '已取消'))
      root.querySelectorAll('[data-rollback]').forEach((b) => (b.onclick = () => { if (confirm('玩家端立即切回该版本（进行中的对局不受影响）。确定？')) go(() => o.api(`/api/projects/${o.pid}/release/rollback`, { release: b.dataset.rollback }), '已回滚') }))
      root.querySelectorAll('[data-live]').forEach((b) => (b.onclick = () => { const live = b.dataset.live === '1'; const note = prompt(live ? '恢复上线说明（可空）' : '下架原因', ''); if (note === null) return; go(() => o.api(`/api/projects/${o.pid}/release/live`, { live, note }), live ? '已恢复上线' : '已下架') }))
    }
    load()
    return { destroy: () => clearTimeout(timer) }
  }
  window.ReleasePanel = { mount }
})()
