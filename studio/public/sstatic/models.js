// 算力网模型目录 + Agent 模型下拉 + 按文档参数表生成的参数表单
// window.SuanliUI.enhance({ cfg, api, toast, reload, esc, adm })
;(function () {
  const $ = (s, r = document) => r.querySelector(s)
  const CAT_ICON = { chat: 'fa-comments', vision: 'fa-eye', image: 'fa-image', video: 'fa-film' }
  const TIER = { flagship: ['旗舰', '#ff6fae'], balanced: ['均衡', '#7dd3fc'], budget: ['省钱', '#3ddc97'] }
  const AG_NAME = { SCREENWRITER: '编剧', STRUCTURE: '结构', SCRIPT: '剧本', REVIEWER: '评审', PROMPT: '提示词', CONTINUITY: '连贯', COMPLIANCE: '合规', CONSISTENCY: '一致性', ASSET: '设定图', VIDEO_MAIN: '主线视频', VIDEO_BRANCH: '分支视频' }
  let CAT = null

  const priceLine = (m) => m.cat === 'video' ? `${m.price.note}${m.per_sec_720p ? ` · 720p ≈ ¥${m.per_sec_720p}/秒` : ''}` : m.price.note
  const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : n)

  function catalogCard(esc) {
    const cats = ['video', 'image', 'chat', 'vision']
    const cnt = (c) => CAT.models.filter((m) => m.cat === c).length
    return `<section class="card mc-card" id="mcat"><h2><i class="fas fa-layer-group"></i> 算力网模型目录 <span class="mut sm">· 依据 <a href="${CAT.docs}" target="_blank" rel="noopener">suanli.com/api-docs</a></span>
        <button class="btn sm" id="mc-sync" style="float:right"><i class="fas fa-rotate"></i> 在线同步</button></h2>
      <p class="mut sm">${esc(CAT.sync.note)}${CAT.sync.added.length ? ` · 新模型：${CAT.sync.added.map(esc).join('、')}` : ''} · ${CAT.key.checked ? (CAT.key.ok ? `<span class="ok-t">✓ 当前 Key 可用 ${CAT.key.count} 个模型</span>` : `<span class="bad-t">✗ Key 校验失败 ${esc(CAT.key.note)}</span>`) : '<span class="warn-t">尚未接入 Key：填入后会标出你账号实际可用的模型</span>'}</p>
      <div class="mc-tabs">${cats.map((c, i) => `<button class="mc-tab ${i ? '' : 'on'}" data-cat="${c}"><i class="fas ${CAT_ICON[c]}"></i> ${CAT.cats[c]} <b>${cnt(c)}</b></button>`).join('')}</div>
      ${cats.map((c, i) => `<div class="mc-pane" data-pane="${c}" ${i ? 'hidden' : ''}>${CAT.models.filter((m) => m.cat === c).map((m) => modelRow(m, esc)).join('')}</div>`).join('')}
    </section>`
  }
  function modelRow(m, esc) {
    const fits = Object.entries(m.fit).filter(([, v]) => !v).map(([k]) => AG_NAME[k] || k)
    const av = m.available === null ? '' : m.available ? '<span class="pill" style="--c:#3ddc97">Key 可用</span>' : '<span class="pill" style="--c:#6b7280">Key 未开通</span>'
    const t = TIER[m.tier] || null
    return `<details class="mc-row"><summary><code>${esc(m.id)}</code> ${t ? `<span class="pill" style="--c:${t[1]}">${t[0]}</span>` : ''} ${m.source === 'live' ? '<span class="pill" style="--c:#f5c451">新上架</span>' : ''} ${av}
        <span class="mc-v">${esc(m.vendor)}</span><span class="mc-p">${esc(priceLine(m))}</span></summary>
      <div class="mc-body"><div class="kv"><b>协议</b><span>${{ chat: 'POST /v1/chat/completions', images: 'POST /v1/images/generations', video_moldex: 'Moldex 统一协议 · POST /v1/video/generations → GET /v1/videos/{id} → /content', video_generic: '通用协议 · POST /v1/video/generations（纯文生）' }[m.proto]}</span>
        ${m.ctx ? `<b>上下文</b><span>${kfmt(m.ctx)}${m.max_out ? ` · 最大输出 ${kfmt(m.max_out)}` : ''}</span>` : ''}
        <b>能力</b><span>${m.caps.map(esc).join(' · ') || '—'}${m.roles?.length ? ` · 素材角色：${m.roles.join(' / ')}` : m.cat === 'video' ? ' · <span class="warn-t">不支持参考图 / 首帧</span>' : ''}</span>
        <b>适用 Agent</b><span>${fits.length ? fits.join('、') : '<span class="mut">生产线暂不适用</span>'}</span></div>
        ${m.notes ? `<p class="mut sm">${esc(m.notes)}</p>` : ''}
        <table class="mc-params"><tr><th>参数</th><th>取值</th><th>默认</th><th>说明</th></tr>${m.params.map((p) => `<tr><td><code>${p.k}</code><br><span class="mut">${esc(p.n)}</span></td><td>${p.type === 'enum' ? p.options.filter((x) => x !== '').map(esc).join(' / ') : p.type === 'bool' ? '是 / 否' : `${p.min} ~ ${p.max}`}</td><td>${p.def === '' ? '—' : esc(String(p.def))}</td><td class="mut">${esc(p.d || '')}</td></tr>`).join('')}</table></div></details>`
  }

  /** Agent 行：服务商是算力网时，模型输入框换成「按类别分组、只列适配模型」的下拉 */
  function modelSelect(code, cur, esc) {
    const opts = CAT.agents[code]?.options || [], by = {}
    for (const id of opts) { const m = CAT.models.find((x) => x.id === id); (by[m.cat] = by[m.cat] || []).push(m) }
    const rec = CAT.agents[code]?.pick || []
    const known = opts.includes(cur)
    return `<select class="inp" name="model">${!known && cur ? `<option value="${esc(cur)}" selected>${esc(cur)}（不在目录中）</option>` : ''}${Object.entries(by).map(([c, ms]) => `<optgroup label="${CAT.cats[c]}">${ms.sort((a, b) => (rec.indexOf(a.id) + 1 || 99) - (rec.indexOf(b.id) + 1 || 99)).map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''} ${m.available === false ? 'disabled' : ''}>${rec[0] === m.id ? '★ ' : ''}${esc(m.id)} · ${esc(m.cat === 'video' ? `¥${m.per_sec_720p}/秒` : m.price.note.split('（')[0])}${m.available === false ? '（Key 未开通）' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`
  }

  /** 参数表单：按模型参数表生成（枚举 → 下拉；数值 → 带范围的输入；布尔 → 勾选），保留表外的自定义参数 */
  function paramsModal(a, modelId, ctx) {
    const { esc, api, toast, reload } = ctx
    const m = CAT.models.find((x) => x.id === modelId)
    if (!m) return toast('该模型不在目录中，请在「详细」里手动编辑 JSON 参数')
    const cur = a.params || {}
    const field = (p) => {
      const v = cur[p.k] !== undefined ? cur[p.k] : p.def
      const input = p.type === 'enum' ? `<select class="inp" name="${p.k}">${p.options.map((o) => `<option value="${esc(String(o))}" ${String(o) === String(v) ? 'selected' : ''}>${o === '' ? '（模型默认）' : esc(String(o))}</option>`).join('')}</select>`
        : p.type === 'bool' ? `<label class="chk"><input type="checkbox" name="${p.k}" ${v === true || v === 'true' ? 'checked' : ''}> 开启</label>`
        : `<input class="inp" name="${p.k}" type="number" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${v === '' ? '' : esc(String(v))}" placeholder="${p.def === '' ? '留空' : p.def}">`
      return `<label class="f">${esc(p.n)} <code class="mut">${p.k}</code>${input}<small class="mut">${esc(p.d || '')}${p.type !== 'enum' && p.type !== 'bool' ? ` · 范围 ${p.min}~${p.max}` : ''}</small></label>`
    }
    const est = m.cat === 'video' ? '<div class="banner" id="pm-est"></div>' : ''
    const m0 = document.createElement('div'); m0.className = 'modal'
    m0.innerHTML = `<div class="card"><h2>${esc(a.name)} · 参数 <span class="mut sm">${esc(m.id)}</span></h2>
      <p class="mut sm">参数表取自算力网文档；超出范围会自动夹紧，不支持的取值会被拒绝。${esc(m.notes || '')}</p>
      <form id="pmf" class="grid g2">${m.params.map(field).join('')}</form>${est}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" data-reset>恢复文档默认</button><button class="btn" data-close>取消</button><button class="btn pri" data-save>保存参数</button></div></div>`
    document.body.appendChild(m0)
    const read = () => { const o = { ...cur }; for (const p of m.params) { const el = m0.querySelector(`[name="${p.k}"]`); if (!el) continue; if (p.type === 'bool') o[p.k] = el.checked; else if (el.value === '') delete o[p.k]; else o[p.k] = p.type === 'enum' ? el.value : +el.value } return o }
    const upd = () => { const e = $('#pm-est', m0); if (!e) return; const o = read(), res = o.resolution || '720p', sec = +o.duration || 8
      const ps = m.price.unit === 'sec' ? (m.price.per_res?.[res] ?? m.price.per) : +((m.price.per_res?.[res] ?? 46) * (res === '1080p' ? 1920 * 1080 : res === '480p' ? 854 * 480 : 1280 * 720) * 24 / 1024 / 1e6).toFixed(3)
      e.innerHTML = `预估：${res} · 每段 ${sec} 秒 ≈ <b>¥${(ps * sec).toFixed(2)}</b>（¥${ps}/秒${m.price.unit === 'vtok' ? '，按 token 计费，以上游 usage 为准' : ''}）` }
    m0.addEventListener('input', upd); m0.addEventListener('change', upd); upd()
    m0.onclick = async (e) => {
      if (e.target === m0 || e.target.closest('[data-close]')) return m0.remove()
      if (e.target.closest('[data-reset]')) { for (const p of m.params) { const el = m0.querySelector(`[name="${p.k}"]`); if (!el) continue; if (p.type === 'bool') el.checked = !!p.def; else el.value = p.def } upd(); return }
      if (e.target.closest('[data-save]')) {
        try { const r = await api('/api/agents/' + a.code, { model: m.id, params: read() }); toast(r.fixes?.length ? '已保存（已按文档修正：' + r.fixes.join('；') + '）' : '参数已保存'); m0.remove(); reload() } catch (er) { toast(er.message) }
      }
    }
  }

  async function enhance(ctx) {
    const { cfg, api, toast, reload, esc, adm } = ctx
    try { CAT = await api('/api/suanli/catalog') } catch { return }
    const anchor = $('.sl-card') || $('.card'); if (!anchor) return
    anchor.insertAdjacentHTML('afterend', catalogCard(esc))
    const root = $('#mcat')
    root.querySelectorAll('.mc-tab').forEach((b) => (b.onclick = () => { root.querySelectorAll('.mc-tab').forEach((x) => x.classList.toggle('on', x === b)); root.querySelectorAll('.mc-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.cat)) }))
    $('#mc-sync').onclick = async (e) => { e.target.disabled = true; try { await api('/api/suanli/catalog?refresh=1'); toast('已同步算力网最新模型与价格'); reload() } catch (er) { toast(er.message) } }
    const slIds = new Set(cfg.providers.filter((p) => p.kind === 'suanli').map((p) => p.id))
    document.querySelectorAll('[data-agent]').forEach((row) => {
      const code = row.dataset.agent, a = cfg.agents.find((x) => x.code === code); if (!a || !CAT.agents[code]) return
      const pvSel = row.querySelector('[name=provider_id]'), mIn = row.querySelector('[name=model]')
      const swap = () => {
        const cur = row.querySelector('[name=model]')
        if (slIds.has(pvSel.value)) { if (cur.tagName !== 'SELECT') { cur.insertAdjacentHTML('afterend', modelSelect(code, CAT.agents[code].options.includes(cur.value) ? cur.value : CAT.agents[code].pick[0], esc)); cur.remove() } }
        else if (cur.tagName === 'SELECT') { cur.insertAdjacentHTML('afterend', `<input class="inp" name="model" value="${esc(cur.value)}" placeholder="模型 ID">`); cur.remove() }
        const sel = row.querySelector('[name=model]'); if (!adm) sel.disabled = true
        const hint = row.querySelector('.mc-hint') || (row.querySelector('.nm').insertAdjacentHTML('beforeend', '<small class="mc-hint"></small>'), row.querySelector('.mc-hint'))
        const m = CAT.models.find((x) => x.id === sel.value)
        hint.innerHTML = slIds.has(pvSel.value) ? `<i class="fas fa-circle-info"></i> 需要：${esc(CAT.agents[code].why)}${m ? ` · 当前 ${esc(priceLine(m))}` : ''}` : ''
        sel.onchange = swap
      }
      if (mIn) { pvSel.addEventListener('change', swap); swap() }
      if (adm) { const box = row.querySelector('[data-more]')?.parentElement; if (box && !box.querySelector('[data-par]')) { box.insertAdjacentHTML('afterbegin', '<button class="btn sm" data-par title="按文档参数表编辑"><i class="fas fa-sliders"></i> 参数</button>'); box.querySelector('[data-par]').onclick = () => { if (!slIds.has(pvSel.value)) return toast('参数表单用于算力网模型；其他服务商请用「详细」编辑 JSON'); paramsModal(a, row.querySelector('[name=model]').value, ctx) } } }
    })
  }
  window.SuanliUI = { enhance }
})()
