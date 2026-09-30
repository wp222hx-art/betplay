// 模型接入中心（算力网 / TokenHot / DeepSeek 官方 / 豆包·火山方舟官方）+ 分平台模型目录 + Agent 模型下拉 + 文档参数表单 + 模型监控页
// window.SuanliUI.enhance({ cfg, api, toast, reload, esc, adm })   window.SuanliUI.monitor(root, { api, toast, esc, adm, fmtT })
;(function () {
  const $ = (s, r = document) => r.querySelector(s)
  const CAT_ICON = { chat: 'fa-comments', vision: 'fa-eye', image: 'fa-image', video: 'fa-film' }
  const TIER = { flagship: ['旗舰', '#ff6fae'], balanced: ['均衡', '#7dd3fc'], budget: ['省钱', '#3ddc97'] }
  const AG_NAME = { SCREENWRITER: '编剧', STRUCTURE: '结构', SCRIPT: '剧本', REVIEWER: '评审', PROMPT: '提示词', CONTINUITY: '连贯', COMPLIANCE: '合规', CONSISTENCY: '一致性', ASSET: '设定图', VIDEO_MAIN: '主线视频', VIDEO_BRANCH: '分支视频' }
  const PF = [['tokenhot', 'TokenHot', 'fa-fire', '#ff8a3d'], ['ark', '豆包 · 火山方舟', 'fa-mountain', '#3370ff'], ['deepseek', 'DeepSeek 官方', 'fa-water', '#4d6bfe'], ['suanli', '算力网', 'fa-bolt', '#ff6fae']]
  const PROTO = { chat: 'POST /v1/chat/completions（OpenAI 兼容）', images: 'POST /v1/images/generations', video_moldex: 'Moldex 统一协议 · POST /v1/video/generations → GET /v1/videos/{id} → /content', video_generic: '通用协议 · POST /v1/video/generations（纯文生）', th_seedance: 'POST /v1/video/generations · content[]（text + image_url role）→ GET /v1/video/generations/{id}', th_kling: 'POST /v1/video/generations · prompt + file_infos[FirstFrame/LastFrame]', th_veo: 'POST /v1/video/generations · imageUrls + generationType', th_wan3: 'POST /v1/video/generations · input.media + parameters', th_happyhorse: 'POST /v1/video/generations · input.media + parameters', th_grok: 'POST /v1/video/generations · input.image_urls（1 张）', th_omni: 'POST /v1/video/generations · input.image_urls（≤7 张）', th_images: 'POST /v1/images/generations', th_gemini_image: 'POST /v1beta/models/{model}:generateContent（Gemini 原生）', th_qwen_image: 'POST /v1/images/generations · input.messages + parameters', ark_seedance: 'POST /api/v3/contents/generations/tasks → GET …/tasks/{id}', ark_image: 'POST /api/v3/images/generations', unsupported: '文档未提供可用于生产线的协议' }
  const CATS = {}, KEY_OF = {} // kind → catalog
  let CFG = null

  const priceLine = (m) => m.cat === 'video' ? `${m.price.note}${m.per_sec_720p ? ` · ${m.price.unit === 'quota' ? '预算参考' : '≈'} ¥${m.per_sec_720p}/秒` : ''}` : m.price.note
  const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : n)
  const kindOf = (pid) => CFG?.providers.find((p) => p.id === pid)?.kind
  const isPf = (k) => PF.some(([x]) => x === k)
  async function cat(kind, api, force) { if (!CATS[kind] || force) CATS[kind] = await api(`/api/platforms/${kind}/catalog${force ? '?refresh=1' : ''}`); return CATS[kind] }

  // ───────── 接入中心 ─────────
  function hubCard(esc, adm) {
    const conn = (k) => CFG.providers.find((p) => p.kind === k)
    return `<section class="card hub-card" id="hub"><h2><i class="fas fa-plug-circle-bolt"></i> 模型接入中心 <span class="mut sm">· 四个平台，Key 加密入库、只显示掩码</span> <a class="btn sm" href="#/monitor" style="float:right"><i class="fas fa-heart-pulse"></i> 模型监控</a></h2>
      <div class="hub-tabs">${PF.map(([k, n, ic, c], i) => `<button class="hub-tab ${i ? '' : 'on'}" data-hub="${k}" style="--c:${c}"><i class="fas ${ic}"></i> ${n} ${conn(k) ? '<span class="dot ok"></span>' : ''}</button>`).join('')}</div>
      ${PF.map(([k], i) => `<div class="hub-pane" data-hpane="${k}" ${i ? 'hidden' : ''}><p class="mut sm">加载中…</p></div>`).join('')}
    </section>`
  }
  async function renderPane(kind, ctx) {
    const { api, esc, adm, toast, reload } = ctx, pane = $(`[data-hpane="${kind}"]`); if (!pane) return
    let C; try { C = await cat(kind, api) } catch (e) { pane.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
    const M = C.meta, pv = CFG.providers.find((p) => p.kind === kind)
    const presetN = Object.keys(C.agents).filter((c) => C.agents[c].pick?.[0] && C.models.find((m) => m.id === C.agents[c].pick[0] && !m.fit[c])).length
    pane.innerHTML = `<div class="hub-head"><div><b>${esc(M.name)}</b> <a href="${M.docs}" target="_blank" rel="noopener" class="sm">文档 <i class="fas fa-up-right-from-square"></i></a> · <a href="${M.keyUrl}" target="_blank" rel="noopener" class="sm">获取 Key</a>
        <div class="mut sm">${esc(M.covers)} · Base <code>${esc(pv?.base_url || M.base)}</code></div></div>
        ${pv ? `<div class="hub-state"><span class="pill" style="--c:#3ddc97">已接入 ${esc(pv.key_hint)}</span> <button class="btn sm" data-t="${pv.id}"><i class="fas fa-stethoscope"></i> 连通测试</button></div>` : '<span class="pill" style="--c:#6b7280">未接入</span>'}</div>
      ${adm ? `<form class="sl-form" data-cf="${kind}"><input class="inp" name="key" type="password" autocomplete="off" placeholder="${esc(M.short)} API Key${pv ? '（留空 = 只重新套用推荐配置）' : ''}">
        <label class="chk"><input type="checkbox" name="all" ${pv ? '' : 'checked'}> 把 ${presetN} 个 Agent 切到 ${esc(M.short)} 推荐模型</label><button class="btn pri" type="submit"><i class="fas fa-plug-circle-check"></i> 保存并测试</button></form><div class="cf-r"></div>` : ''}
      <details class="mc-card"><summary><b>模型目录</b> · ${C.models.length} 个 · ${esc(C.sync.note)} ${C.key.checked ? (C.key.ok ? `<span class="ok-t">· 当前 Key 可用 ${C.key.count} 个</span>` : `<span class="bad-t">· Key 校验失败 ${esc(C.key.note)}</span>`) : C.key.note ? `<span class="mut">· ${esc(C.key.note)}</span>` : ''}
        <button class="btn sm" data-sync="${kind}" style="float:right" type="button"><i class="fas fa-rotate"></i> 在线同步</button></summary>
        ${catalogBody(C, esc)}</details>`
    pane.querySelectorAll('.mc-tab').forEach((b) => (b.onclick = () => { pane.querySelectorAll('.mc-tab').forEach((x) => x.classList.toggle('on', x === b)); pane.querySelectorAll('.mc-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.cat)) }))
    const q = pane.querySelector('.mc-q'); if (q) q.oninput = () => { const v = q.value.trim().toLowerCase(); pane.querySelectorAll('.mc-row').forEach((r) => (r.hidden = v && !r.dataset.id.toLowerCase().includes(v) && !r.textContent.toLowerCase().includes(v))) }
    const sb = pane.querySelector('[data-sync]'); if (sb) sb.onclick = async (e) => { e.preventDefault(); sb.disabled = true; try { await cat(kind, api, true); toast('已同步最新模型与价格'); renderPane(kind, ctx) } catch (er) { toast(er.message) } }
    const tb = pane.querySelector('[data-t]'); if (tb) tb.onclick = async () => { tb.disabled = true; tb.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中'; try { const r = await api(`/api/providers/${tb.dataset.t}/test`, {}); pane.querySelector('.cf-r') ? (pane.querySelector('.cf-r').innerHTML = `<div class="banner ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${esc(r.note)} · ${r.ms}ms</div>`) : toast(r.note) } catch (er) { toast(er.message) } tb.disabled = false; tb.innerHTML = '<i class="fas fa-stethoscope"></i> 连通测试' }
    const f = pane.querySelector('[data-cf]'); if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(f), btn = f.querySelector('button'), out = pane.querySelector('.cf-r'); btn.disabled = true; out.innerHTML = '<p class="mut sm"><i class="fas fa-spinner fa-spin"></i> 保存 → 连通测试（鉴权 / 模型列表 / 余额 / 最小对话）…</p>'
      try { const r = await api(`/api/platforms/${kind}/connect`, { key: fd.get('key') || undefined, agents: fd.get('all') ? undefined : ['__none__'] })
        out.innerHTML = `<div class="banner ${r.test.ok ? 'ok' : 'bad'}">${r.test.ok ? '✓' : '✗'} ${esc(r.test.note)} · ${r.test.ms}ms${r.agents.length ? `<br>已切换 Agent：${r.agents.map((c) => AG_NAME[c] || c).join('、')}` : ''}${r.skipped?.length ? `<br><span class="warn-t">未切换：${r.skipped.map(esc).join('；')}</span>` : ''}</div>`
        delete CATS[kind]; if (r.test.ok) setTimeout(reload, 2200) } catch (er) { out.innerHTML = `<div class="banner bad">${esc(er.message)}</div>` } btn.disabled = false }
  }
  function catalogBody(C, esc) {
    const cats = ['video', 'image', 'chat', 'vision'].filter((c) => C.models.some((m) => m.cat === c))
    const cnt = (c) => C.models.filter((m) => m.cat === c).length
    return `<div class="mc-bar"><div class="mc-tabs">${cats.map((c, i) => `<button type="button" class="mc-tab ${i ? '' : 'on'}" data-cat="${c}"><i class="fas ${CAT_ICON[c]}"></i> ${C.cats[c]} <b>${cnt(c)}</b></button>`).join('')}</div><input class="inp mc-q" placeholder="搜索模型…"></div>
      ${cats.map((c, i) => `<div class="mc-pane" data-pane="${c}" ${i ? 'hidden' : ''}>${C.models.filter((m) => m.cat === c).sort((a, b) => (a.proto === 'unsupported') - (b.proto === 'unsupported') || (a.deprecated ? 1 : 0) - (b.deprecated ? 1 : 0)).map((m) => modelRow(m, esc)).join('')}</div>`).join('')}`
  }
  function modelRow(m, esc) {
    const fits = Object.entries(m.fit).filter(([, v]) => !v).map(([k]) => AG_NAME[k] || k)
    const av = m.available === null || m.available === undefined ? '' : m.available ? '<span class="pill" style="--c:#3ddc97">Key 可用</span>' : '<span class="pill" style="--c:#6b7280">Key 未开通</span>'
    const t = TIER[m.tier] || null, off = m.proto === 'unsupported'
    return `<details class="mc-row ${off ? 'off' : ''}" data-id="${esc(m.id)}"><summary><code>${esc(m.id)}</code> ${t && !off ? `<span class="pill" style="--c:${t[1]}">${t[0]}</span>` : ''} ${m.deprecated ? '<span class="pill" style="--c:#f5a524">即将下线</span>' : ''} ${off ? '<span class="pill" style="--c:#6b7280">不可用于生产线</span>' : ''} ${av}
        <span class="mc-v">${esc(m.vendor)}</span><span class="mc-p">${esc(priceLine(m))}</span></summary>
      <div class="mc-body"><div class="kv"><b>协议</b><span>${esc(PROTO[m.proto] || m.proto)}</span>
        ${m.ctx ? `<b>上下文</b><span>${kfmt(m.ctx)}${m.max_out ? ` · 最大输出 ${kfmt(m.max_out)}` : ''}</span>` : ''}
        <b>能力</b><span>${(m.caps || []).map(esc).join(' · ') || '—'}${m.roles?.length ? ` · 素材角色：${m.roles.join(' / ')}` : m.cat === 'video' ? ' · <span class="warn-t">不支持参考图 / 首帧</span>' : ''}${m.public_url ? ' · <span class="warn-t">图片需公网 URL</span>' : ''}</span>
        <b>适用 Agent</b><span>${fits.length ? fits.join('、') : '<span class="mut">生产线暂不适用</span>'}</span></div>
        ${m.notes ? `<p class="mut sm">${esc(m.notes)}</p>` : ''}
        ${m.params?.length ? `<table class="mc-params"><tr><th>参数</th><th>取值</th><th>默认</th><th>说明</th></tr>${m.params.map((p) => `<tr><td><code>${p.k}</code><br><span class="mut">${esc(p.n)}</span></td><td>${p.type === 'enum' ? p.options.filter((x) => x !== '').map(esc).join(' / ') : p.type === 'bool' ? '是 / 否' : `${p.min} ~ ${p.max}`}</td><td>${p.def === '' ? '—' : esc(String(p.def))}</td><td class="mut">${esc(p.d || '')}</td></tr>`).join('')}</table>` : ''}</div></details>`
  }

  // ───────── Agent 行：平台服务商 → 模型下拉 + 参数按钮 ─────────
  function modelSelect(C, code, cur, esc) {
    const opts = C.agents[code]?.options || [], by = {}
    for (const id of opts) { const m = C.models.find((x) => x.id === id); (by[m.cat] = by[m.cat] || []).push(m) }
    const rec = C.agents[code]?.pick || [], known = opts.includes(cur)
    return `<select class="inp" name="model">${!known && cur ? `<option value="${esc(cur)}" selected>${esc(cur)}（不在目录中）</option>` : ''}${Object.entries(by).map(([c, ms]) => `<optgroup label="${C.cats[c]}">${ms.sort((a, b) => (rec.indexOf(a.id) + 1 || 99) - (rec.indexOf(b.id) + 1 || 99)).map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''} ${m.available === false ? 'disabled' : ''}>${rec[0] === m.id ? '★ ' : ''}${esc(m.id)} · ${esc(m.cat === 'video' ? (m.per_sec_720p ? `¥${m.per_sec_720p}/秒` : m.price.note.slice(0, 16)) : m.price.note.split('（')[0].slice(0, 28))}${m.deprecated ? '（即将下线）' : ''}${m.available === false ? '（Key 未开通）' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`
  }
  function paramsModal(C, a, modelId, ctx) {
    const { esc, api, toast, reload } = ctx
    const m = C.models.find((x) => x.id === modelId)
    if (!m || !m.params?.length) return toast('该模型没有文档参数表，请在「详细」里编辑 JSON 参数')
    const cur = a.params || {}
    const field = (p) => {
      const v = cur[p.k] !== undefined ? cur[p.k] : p.def
      const input = p.type === 'enum' ? `<select class="inp" name="${p.k}">${p.options.map((o) => `<option value="${esc(String(o))}" ${String(o) === String(v) ? 'selected' : ''}>${o === '' ? '（模型默认）' : esc(String(o))}</option>`).join('')}</select>`
        : p.type === 'bool' ? `<label class="chk"><input type="checkbox" name="${p.k}" ${v === true || v === 'true' ? 'checked' : ''}> 开启</label>`
        : `<input class="inp" name="${p.k}" type="number" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${v === '' ? '' : esc(String(v))}" placeholder="${p.def === '' ? '留空' : p.def}">`
      return `<label class="f">${esc(p.n)} <code class="mut">${p.k}</code>${input}<small class="mut">${esc(p.d || '')}${p.type !== 'enum' && p.type !== 'bool' ? ` · 范围 ${p.min}~${p.max}` : ''}</small></label>`
    }
    const m0 = document.createElement('div'); m0.className = 'modal'
    m0.innerHTML = `<div class="card"><h2>${esc(a.name)} · 参数 <span class="mut sm">${esc(C.meta.short)} · ${esc(m.id)}</span></h2>
      <p class="mut sm">参数表取自 ${esc(C.meta.short)} 文档；越界自动夹紧，不支持的取值会被修正。${esc(m.notes || '')}</p>
      <form class="grid g2">${m.params.map(field).join('')}</form>${m.cat === 'video' ? '<div class="banner" id="pm-est"></div>' : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" data-reset>恢复文档默认</button><button class="btn" data-close>取消</button><button class="btn pri" data-save>保存参数</button></div></div>`
    document.body.appendChild(m0)
    const read = () => { const o = { ...cur }; for (const p of m.params) { const el = m0.querySelector(`[name="${p.k}"]`); if (!el) continue; if (p.type === 'bool') o[p.k] = el.checked; else if (el.value === '') delete o[p.k]; else o[p.k] = p.type === 'enum' ? (isNaN(+el.value) || /[a-z:]/i.test(el.value) ? el.value : +el.value) : +el.value } return o }
    const upd = () => { const e = $('#pm-est', m0); if (!e) return; const o = read(), res = String(o.resolution || '720p').toLowerCase(), sec = +o.duration || 8, pr = m.price
      const px = { '480p': 864 * 496, '720p': 1280 * 720, '1080p': 1920 * 1080, '4k': 3840 * 2160 }[res] || 921600
      let ps = null; if (pr.unit === 'sec') ps = pr.per_res?.[res] ?? pr.per; else if (pr.unit === 'vtok') { let rate = pr.per_res?.[res] ?? pr.per_res?.['720p'] ?? 46; if (pr.promo && Date.now() < Date.parse(pr.promo.until)) rate *= pr.promo.factor; ps = +(px * 24 / 1024 * rate / 1e6).toFixed(3) }
      e.innerHTML = ps != null ? `预估：${res} · 每段 ${sec} 秒 ≈ <b>¥${(ps * sec).toFixed(2)}</b>（¥${ps}/秒${pr.unit === 'vtok' ? '，按 token 计费，以上游 usage 为准' : ''}${pr.promo && Date.now() < Date.parse(pr.promo.until) ? `，含限时 ${pr.promo.factor * 10} 折` : ''}）` : `计费：${esc(pr.note)}` }
    m0.addEventListener('input', upd); m0.addEventListener('change', upd); upd()
    m0.onclick = async (e) => {
      if (e.target === m0 || e.target.closest('[data-close]')) return m0.remove()
      if (e.target.closest('[data-reset]')) { for (const p of m.params) { const el = m0.querySelector(`[name="${p.k}"]`); if (!el) continue; if (p.type === 'bool') el.checked = !!p.def; else el.value = p.def } upd(); return }
      if (e.target.closest('[data-save]')) { try { const r = await api('/api/agents/' + a.code, { model: m.id, params: read() }); toast(r.fixes?.length ? '已保存（已按文档修正：' + r.fixes.join('；') + '）' : '参数已保存'); m0.remove(); reload() } catch (er) { toast(er.message) } }
    }
  }

  async function enhance(ctx) {
    const { cfg, api, esc, adm } = ctx; CFG = cfg
    const old = $('.sl-card'); if (old) old.remove()
    const anchor = document.querySelector('main h1 + p.sub') || document.querySelector('main .sub')
    const box = document.createElement('div'); box.innerHTML = hubCard(esc, adm); (anchor?.nextElementSibling ? anchor.parentElement.insertBefore(box.firstElementChild, anchor.nextElementSibling.nextElementSibling || null) : document.querySelector('main').prepend(box.firstElementChild))
    const hub = $('#hub')
    hub.querySelectorAll('.hub-tab').forEach((b) => (b.onclick = () => { hub.querySelectorAll('.hub-tab').forEach((x) => x.classList.toggle('on', x === b)); hub.querySelectorAll('.hub-pane').forEach((p) => (p.hidden = p.dataset.hpane !== b.dataset.hub)); renderPane(b.dataset.hub, ctx) }))
    const first = PF.find(([k]) => cfg.providers.some((p) => p.kind === k))?.[0] || 'tokenhot'
    hub.querySelector(`[data-hub="${first}"]`).click()
    // Agent 行
    document.querySelectorAll('[data-agent]').forEach((row) => {
      const code = row.dataset.agent, a = cfg.agents.find((x) => x.code === code); if (!a) return
      const pvSel = row.querySelector('[name=provider_id]'); if (!pvSel) return
      const swap = async () => {
        const kind = kindOf(pvSel.value), cur = row.querySelector('[name=model]')
        const hint = row.querySelector('.mc-hint') || (row.querySelector('.nm').insertAdjacentHTML('beforeend', '<small class="mc-hint"></small>'), row.querySelector('.mc-hint'))
        if (isPf(kind)) {
          let C; try { C = await cat(kind, api) } catch { return }
          if (!C.agents[code]) return
          const keep = C.agents[code].options.includes(cur.value) ? cur.value : C.agents[code].pick.find((id) => C.agents[code].options.includes(id)) || C.agents[code].options[0] || cur.value
          cur.insertAdjacentHTML('afterend', modelSelect(C, code, keep, esc)); cur.remove()
          const sel = row.querySelector('[name=model]'); if (!adm) sel.disabled = true
          const m = C.models.find((x) => x.id === sel.value)
          hint.innerHTML = `<i class="fas fa-circle-info"></i> ${esc(C.meta.short)} · 需要：${esc(C.agents[code].why)}${m ? ` · ${esc(priceLine(m))}` : ''}`
          sel.onchange = () => { const mm = C.models.find((x) => x.id === sel.value); hint.innerHTML = `<i class="fas fa-circle-info"></i> ${esc(C.meta.short)} · 需要：${esc(C.agents[code].why)}${mm ? ` · ${esc(priceLine(mm))}` : ''}` }
        } else { if (cur.tagName === 'SELECT') { cur.insertAdjacentHTML('afterend', `<input class="inp" name="model" value="${esc(cur.value)}" placeholder="模型 ID">`); cur.remove() } hint.innerHTML = '' }
      }
      pvSel.addEventListener('change', swap); swap()
      if (adm) { const box = row.querySelector('[data-more]')?.parentElement; if (box && !box.querySelector('[data-par]')) { box.insertAdjacentHTML('afterbegin', '<button class="btn sm" data-par title="按文档参数表编辑"><i class="fas fa-sliders"></i> 参数</button>'); box.querySelector('[data-par]').onclick = async () => { const kind = kindOf(pvSel.value); if (!isPf(kind)) return ctx.toast('参数表单用于四个接入平台；其他服务商请用「详细」编辑 JSON'); paramsModal(await cat(kind, api), a, row.querySelector('[name=model]').value, ctx) } } }
    })
  }

  // ───────── 模型监控页 ─────────
  const ST = { up: ['在线', '#3ddc97'], down: ['故障', '#ff5d73'], stale: ['心跳超时', '#f5a524'], unknown: ['待探测', '#7dd3fc'], no_key: ['未填 Key', '#6b7280'], disabled: ['已停用', '#6b7280'], 'n/a': ['不监控', '#6b7280'] }
  const spark = (s) => `<span class="spark">${s.map((x) => `<i style="height:${Math.max(3, Math.min(22, 3 + (x.ms || 0) / 150))}px;background:${x.ok ? '#3ddc97' : '#ff5d73'}" title="${new Date(x.at).toLocaleTimeString('zh-CN', { hour12: false })} · ${x.ok ? '正常' : '失败'} · ${x.ms}ms"></i>`).join('')}</span>`
  async function monitor(root, ctx) {
    const { api, toast, esc, adm, fmtT } = ctx
    let d; try { d = await api('/api/health/providers') } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return }
    const ago = (t) => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.round(s / 60)} 分钟前` : fmtT(t) }
    const plat = d.providers.filter((p) => isPf(p.kind)), other = d.providers.filter((p) => !isPf(p.kind))
    const tot = plat.reduce((a, p) => ({ calls: a.calls + p.usage.calls24, cost: a.cost + p.usage.cost7, media: a.media + p.usage.media7, up: a.up + (p.status === 'up' ? 1 : 0) }), { calls: 0, cost: 0, media: 0, up: 0 })
    root.innerHTML = `<div class="mon-top"><div class="kv4"><div><b>${tot.up}/${plat.length}</b><span>平台在线</span></div><div><b>${tot.calls}</b><span>24 小时对话调用</span></div><div><b>${tot.media}</b><span>7 天媒体任务</span></div><div><b>¥${tot.cost.toFixed(2)}</b><span>7 天花费</span></div></div>
        <div class="mut sm">心跳：每 ${Math.round(d.heartbeat_ms / 60000)} 分钟自动探测一次（鉴权 + 模型列表 + 余额，不产生费用）；由执行节点领取任务和后台访问触发，无需定时器。${adm ? ' <button class="btn sm pri" id="beat"><i class="fas fa-heart-pulse"></i> 立即心跳</button>' : ''} <button class="btn sm" id="mref"><i class="fas fa-rotate"></i> 刷新</button></div></div>
      ${plat.length ? plat.map((p) => { const [sn, sc] = ST[p.status] || ['—', '#6b7280']; return `<section class="card mon-card"><div class="mon-h"><div><b>${esc(p.name)}</b> <span class="pill" style="--c:${sc}">● ${sn}</span> <span class="mut sm">${esc(p.key_hint || '')}</span>
          <div class="mut sm">${p.last ? `最近${p.last.kind === 'test' ? '连通测试' : '心跳'} ${ago(p.last.at)} · ${p.last.ms}ms · ${esc(p.last.note)}` : '还没有探测记录'}</div></div>
          ${adm ? `<button class="btn sm" data-t="${p.id}"><i class="fas fa-stethoscope"></i> 连通测试</button>` : ''}</div>
        <div class="mon-grid"><div><span class="mut sm">24h 可用率</span><b>${p.uptime24 == null ? '—' : p.uptime24 + '%'}</b></div><div><span class="mut sm">平均延迟</span><b>${p.avg_ms24 ? p.avg_ms24 + 'ms' : '—'}</b></div><div><span class="mut sm">余额</span><b>${p.balance ? `${p.balance.currency === 'USD' ? '$' : '¥'}${p.balance.value}` : p.platform?.balance ? '—' : '<span class="mut sm">平台无余额接口</span>'}</b></div><div><span class="mut sm">24h 调用 / 失败</span><b>${p.usage.calls24} / <span class="${p.usage.err24 ? 'bad-t' : ''}">${p.usage.err24}</span></b></div><div><span class="mut sm">7 天媒体任务</span><b>${p.usage.media_ok7}/${p.usage.media7}${p.usage.media_active ? ` <span class="warn-t sm">进行中 ${p.usage.media_active}</span>` : ''}</b></div><div><span class="mut sm">7 天花费</span><b>¥${p.usage.cost7}</b></div></div>
        <div class="mon-sp"><span class="mut sm">心跳</span>${p.spark.length ? spark(p.spark) : '<span class="mut sm">暂无</span>'}</div>
        <div class="mon-ag"><span class="mut sm">使用中的 Agent：</span>${p.agents.length ? p.agents.map((a) => `<span class="chip">${esc(AG_NAME[a.code] || a.code)} · ${esc(a.model || '')}</span>`).join(' ') : '<span class="mut sm">无</span>'}</div>
        ${p.usage.models.length ? `<details><summary class="sm">按模型的使用情况（7 天 · ${p.usage.models.length} 个模型）</summary><div class="tbl"><table><tr><th>模型</th><th>类型</th><th>次数</th><th>成功</th><th>延迟 / 进行中</th><th>token</th><th>花费</th><th>最近</th></tr>${p.usage.models.map((m) => `<tr><td><code>${esc(m.model || '—')}</code></td><td>${m.type === 'chat' ? '对话' : '媒体'}</td><td>${m.n}</td><td>${m.ok || 0}${m.failed ? ` <span class="bad-t">✗${m.failed}</span>` : ''}</td><td>${m.type === 'chat' ? (m.ms || 0) + 'ms' : m.active || 0}</td><td>${m.tokens ? kfmt(m.tokens) : '—'}</td><td>¥${m.cost || 0}</td><td class="mut sm">${ago(m.last)}</td></tr>`).join('')}</table></div></details>` : ''}
      </section>` }).join('') : '<div class="banner">还没有接入任何平台。去 <a href="#/config">Agent 配置 → 模型接入中心</a> 填入 Key。</div>'}
      ${d.errors.length ? `<section class="card"><h3>最近错误（7 天）</h3><div class="tbl"><table>${d.errors.map((e) => `<tr><td class="mut sm">${ago(e.created_at)}</td><td>${esc(e.provider)}</td><td><code>${esc(e.model || '')}</code></td><td class="bad-t sm">${esc(e.error)}</td></tr>`).join('')}</table></div></section>` : ''}
      ${other.length ? `<p class="mut sm">其他服务商（不做心跳）：${other.map((p) => esc(p.name)).join('、')}</p>` : ''}`
    const b = $('#beat', root); if (b) b.onclick = async () => { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 探测中'; try { const r = await api('/api/health/beat', {}); toast(`心跳完成：${r.beats.filter((x) => x.ok).length}/${r.beats.length} 正常`); monitor(root, ctx) } catch (er) { toast(er.message); b.disabled = false } }
    $('#mref', root).onclick = () => monitor(root, ctx)
    root.querySelectorAll('[data-t]').forEach((x) => (x.onclick = async () => { x.disabled = true; x.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; try { const r = await api(`/api/providers/${x.dataset.t}/test`, {}); toast(`${r.ok ? '✓' : '✗'} ${r.note}`); monitor(root, ctx) } catch (er) { toast(er.message) } }))
    clearTimeout(monitor._t); monitor._t = setTimeout(() => { if (document.body.contains(root)) monitor(root, ctx) }, 60000)
  }
  window.SuanliUI = { enhance, monitor }
})()
