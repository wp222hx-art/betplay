// 角色声线工作室：选音色 / 人设与表演指令 / 后期预设 / 试听（即时合成）/ 声音设计（文字描述 → 专属音色）/ 配音进度
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const toast = (m, bad) => { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(t._t); t._t = setTimeout(() => (t.className = 'toast'), 3200) }
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined })
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.message || j.error || r.status); e.code = j.error; throw e } return j
  }
  const EMO = ['', '哽咽、声音发颤', '压着怒火、咬字加重', '紧张急促、呼吸不稳', '震惊、倒吸一口气', '带着笑意', '冷蔑不屑', '压低声音耳语', '先轻叹一口气']
  const S = { meta: null, cast: {}, custom: [], draft: {}, player: new Audio(), status: null }

  function renderStatus(st) {
    S.status = st
    const el = $('#voice-status')
    el.className = 'vstat ' + (st.ok ? 'ok' : 'bad')
    el.innerHTML = st.ok ? '<i class="fas fa-circle-check"></i> 千问语音服务可用' : `<i class="fas fa-triangle-exclamation"></i> ${esc(st.message)}${st.code === 'Arrearage' ? ' <a href="https://billing-cost.console.aliyun.com/" target="_blank">去充值 ↗</a>' : ''}`
  }
  function renderProgress() {
    const p = S.meta.progress, q = p.segments.qwen || 0, e = p.segments.elevenlabs || 0, cq = p.cues.qwen || 0
    $('#voice-progress').innerHTML = `
      <div class="pg"><div class="pl"><b>对白段落</b><span>千问 ${q} / ElevenLabs ${e} / 共 ${p.total_segments}</span></div><div class="bar"><i class="q" style="width:${(q / p.total_segments) * 100}%"></i><i class="e" style="width:${(e / p.total_segments) * 100}%"></i></div></div>
      <div class="pg"><div class="pl"><b>抉择口播</b><span>千问 ${cq} / 共 ${p.total_cues}</span></div><div class="bar"><i class="q" style="width:${(cq / p.total_cues) * 100}%"></i><i class="e" style="width:${((p.total_cues - cq) / p.total_cues) * 100}%"></i></div></div>
      <div class="legend"><span><i class="q"></i> 千问 Qwen3-TTS（V4）</span><span><i class="e"></i> ElevenLabs（V3 回退）</span><span class="hint">保存配置后，在服务器运行 <code>CONC=3 python3 scripts/comic/produce_voice_v3.py</code> 批量重配（会断点续跑）</span></div>`
  }
  const voiceOptions = (sel) => {
    const sys = S.meta.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === sel ? 'selected' : ''}>${v.g === 'F' ? '♀' : '♂'} ${esc(v.id)} · ${esc(v.desc)}</option>`).join('')
    const cus = S.custom.map((v) => `<option value="${esc(v.voice_id)}" data-model="${esc(v.target_model)}" ${v.voice_id === sel ? 'selected' : ''}>✦ ${esc(v.label)}（设计音色）</option>`).join('')
    return `<optgroup label="千问系统音色">${sys}</optgroup>${cus ? `<optgroup label="专属设计音色">${cus}</optgroup>` : ''}`
  }
  function card(name) {
    const c = S.cast[name], d = { ...c, ...(S.draft[name] || {}) }
    const n = S.meta.line_counts[name] || 0
    const fxo = Object.entries(S.meta.fx).map(([k, v]) => `<option value="${k}" ${k === d.fx_preset ? 'selected' : ''}>${esc(v.label)}</option>`).join('')
    const samples = (S.meta.samples[name] || []).slice(0, 4).map((l, i) => `<button class="smp" data-i="${i}" title="播放剧中这一句（${l.engine === 'qwen' ? '千问' : 'ElevenLabs'}）"><i class="fas fa-play"></i> ${esc(l.text)} <em class="${l.engine}">${l.engine === 'qwen' ? '千问' : 'EL'}</em></button>`).join('')
    return `<article class="cc" data-name="${esc(name)}" style="--c:${d.color}">
      <div class="ch"><img src="${esc(c.img)}" alt="${esc(name)}"><div><h3>${esc(name)}${c.customized ? '<span class="tag">已自定义</span>' : ''}</h3><p>${esc(d.brand || '')}</p><small>${n} 句台词</small></div></div>
      <label>音色<select data-k="qwen_voice">${voiceOptions(d.qwen_voice)}</select></label>
      <label>角色人设 / 表演基调<textarea data-k="qwen_persona" rows="3" placeholder="年龄、性格、声音质感、说话习惯……">${esc(d.qwen_persona || '')}</textarea></label>
      <div class="row"><label>后期处理<select data-k="fx_preset">${fxo}</select></label><label class="clr">主题色<input type="color" data-k="color" value="${esc(d.color)}"></label></div>
      <label>试听台词<input data-k="sample_line" value="${esc(d.sample_line || '')}"></label>
      <div class="row"><label>这一句的情绪<select class="emo">${EMO.map((e) => `<option value="${esc(e)}">${e || '（按人设）'}</option>`).join('')}</select></label>
        <button class="btn aud"><i class="fas fa-wave-square"></i> 试听</button></div>
      <div class="ins" hidden></div>
      <div class="act"><button class="btn gold save"><i class="fas fa-floppy-disk"></i> 保存配置</button><button class="btn ghost reset" ${c.customized ? '' : 'disabled'}>恢复默认</button><button class="btn ghost dsg"><i class="fas fa-wand-magic-sparkles"></i> 设计专属声音</button></div>
      <details class="smps"><summary>剧中台词（当前版本）</summary>${samples || '<p class="mut">暂无</p>'}</details>
    </article>`
  }
  function renderCast() {
    $('#cast-grid').innerHTML = Object.keys(S.cast).map(card).join('')
    document.querySelectorAll('.cc').forEach(bindCard)
  }
  function bindCard(el) {
    const name = el.dataset.name
    el.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('input', () => {
      S.draft[name] = { ...(S.draft[name] || {}), [i.dataset.k]: i.value }
      if (i.dataset.k === 'color') el.style.setProperty('--c', i.value)
      el.classList.add('dirty')
    }))
    el.querySelector('.aud').onclick = async (ev) => {
      const b = ev.currentTarget, d = { ...S.cast[name], ...(S.draft[name] || {}) }
      const opt = el.querySelector('[data-k=qwen_voice]').selectedOptions[0]
      b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 合成中'
      try {
        const r = await api('/api/voice/audition', { body: { voice: d.qwen_voice, text: d.sample_line, persona: d.qwen_persona, emotion: el.querySelector('.emo').value, custom_model: opt?.dataset.model || undefined } })
        S.player.src = r.url; S.player.play()
        const ins = el.querySelector('.ins'); ins.hidden = false
        ins.innerHTML = `<i class="fas fa-circle-play"></i> ${r.ms}ms · ${esc(r.model)}${r.fallback ? ' <b style="color:#ffb4bf">（指令版额度用完，已退回基础版：这次没有表演指令）</b>' : ''}${r.instructions ? `<div class="mut">表演指令：${esc(r.instructions)}</div>` : ''}`
      } catch (e) { toast(e.message, true); if (e.code === 'Arrearage') renderStatus({ ok: false, code: e.code, message: e.message }) }
      b.disabled = false; b.innerHTML = '<i class="fas fa-wave-square"></i> 试听'
    }
    el.querySelector('.save').onclick = async () => {
      try {
        const opt = el.querySelector('[data-k=qwen_voice]').selectedOptions[0]
        const body = { ...(S.draft[name] || {}) }
        S.cast[name] = await api('/api/voice/cast/' + encodeURIComponent(name), { body })
        if (opt?.dataset.model) toast(`已保存。注意：${name} 用的是专属设计音色，批量配音时会走该音色对应的模型`)
        else toast(`已保存 ${name} 的声线配置`)
        delete S.draft[name]; el.outerHTML = card(name); bindCard($(`.cc[data-name="${CSS.escape(name)}"]`))
      } catch (e) { toast(e.message, true) }
    }
    el.querySelector('.reset').onclick = async () => {
      if (!confirm(`把 ${name} 恢复为默认声线？`)) return
      await api('/api/voice/cast/' + encodeURIComponent(name), { method: 'DELETE' }); await load(); toast('已恢复默认')
    }
    el.querySelector('.dsg').onclick = () => openDesign(name)
    el.querySelectorAll('.smp').forEach((b) => (b.onclick = () => {
      const l = S.meta.samples[name][+b.dataset.i]
      S.player.src = l.track; S.player.currentTime = l.start || 0; S.player.play()
      const stop = () => { if (S.player.currentTime >= (l.end || 99) + 0.1) { S.player.pause(); S.player.removeEventListener('timeupdate', stop) } }
      S.player.addEventListener('timeupdate', stop)
    }))
  }
  function openDesign(name) {
    const c = S.cast[name]
    const box = document.createElement('div'); box.className = 'mbg'
    box.innerHTML = `<div class="mdl"><h2><i class="fas fa-wand-magic-sparkles"></i> 为「${esc(name)}」设计专属声音</h2>
      <p class="mut">用一段文字描述，从零生成一个全新的音色，不需要录音样本。写清性别、年龄、音调、语速、情感和质感，写得越具体越好；不要写“模仿某位明星”。千问声音设计每个 0.2 元，新账号前 10 次免费。</p>
      <label>声音描述<textarea id="dp" rows="4">${esc(c.qwen_persona || '')}</textarea></label>
      <label>预览台词<input id="dt" value="${esc(c.sample_line || '')}"></label>
      <div class="act"><button class="btn gold" id="dgo"><i class="fas fa-wand-magic-sparkles"></i> 生成音色</button><button class="btn ghost" id="dx">关闭</button></div>
      <div id="dres"></div></div>`
    document.body.appendChild(box)
    box.querySelector('#dx').onclick = () => box.remove()
    box.querySelector('#dgo').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 设计中（约 10 秒）'
      try {
        const r = await api('/api/voice/design', { body: { prompt: box.querySelector('#dp').value, preview_text: box.querySelector('#dt').value, owner: name, name: 'df_' + (c.img || 'role') } })
        box.querySelector('#dres').innerHTML = `<div class="ok"><b>✦ 新音色：</b><code>${esc(r.voice_id)}</code>${r.preview ? `<audio controls autoplay src="${r.preview}"></audio>` : ''}<button class="btn gold" id="duse">设为「${esc(name)}」的音色</button></div>`
        await loadCustom()
        box.querySelector('#duse').onclick = async () => {
          S.cast[name] = await api('/api/voice/cast/' + encodeURIComponent(name), { body: { qwen_voice: r.voice_id } })
          box.remove(); renderCast(); toast(`「${name}」已换成专属设计音色`)
        }
      } catch (e) { toast(e.message, true); box.querySelector('#dres').innerHTML = `<div class="err">${esc(e.message)}</div>` }
      b.disabled = false; b.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> 再生成一个'
    }
  }
  async function loadCustom() {
    S.custom = await api('/api/voice/custom')
    $('#custom-voices').innerHTML = `<h2><i class="fas fa-gem"></i> 专属音色库 <small class="mut">${S.custom.length} 个</small></h2>
      ${S.custom.length ? `<table><thead><tr><th>音色 ID</th><th>归属角色</th><th>描述</th><th></th></tr></thead><tbody>${S.custom.map((v) => `<tr><td><code>${esc(v.voice_id)}</code></td><td>${esc(v.owner || '—')}</td><td class="mut">${esc((v.prompt || '').slice(0, 60))}</td><td><button class="btn ghost sm" data-del="${esc(v.voice_id)}">移除</button></td></tr>`).join('')}</tbody></table>` : '<p class="mut">还没有专属音色。在角色卡片上点「设计专属声音」，用一段文字就能生成一个独一无二的角色声线。</p>'}`
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api('/api/voice/custom/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); loadCustom() }))
  }
  async function load() {
    const [meta, cast] = await Promise.all([api('/api/voice/meta'), api('/api/voice/cast')])
    S.meta = meta; S.cast = cast
    renderProgress(); renderCast()
  }
  Promise.all([load(), loadCustom()]).then(() => renderCast()).catch((e) => toast(e.message, true))
  api('/api/voice/status').then(renderStatus).catch(() => {})
})()
