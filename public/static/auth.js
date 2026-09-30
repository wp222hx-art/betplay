// 统一身份：向服务端申请签名令牌（旧版 localStorage uid 会被“认领”迁移一次），之后所有请求自动带 Bearer
;(() => {
  const K = 'df_tok'
  let pending = null
  async function token() {
    const t = localStorage[K]
    if (t && +t.split('.')[2] > Date.now() + 86400000) return t
    if (!pending) pending = fetch('/api/auth/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legacy: localStorage.df_uid }) })
      .then((r) => r.json()).then((d) => { if (!d.token) throw new Error(d.message || '身份申请失败'); localStorage[K] = d.token; localStorage.df_uid = d.uid; if (d.sybil) localStorage.df_sybil = '1'; return d.token }).finally(() => (pending = null))
    return pending
  }
  const _fetch = window.fetch.bind(window)
  window.fetch = async (url, opt = {}) => {
    const u = typeof url === 'string' ? url : url.url
    if (!u.startsWith('/api/') || u.startsWith('/api/auth/device')) return _fetch(url, opt)
    const h = new Headers(opt.headers || {})
    h.set('Authorization', 'Bearer ' + (await token()))
    h.delete('x-user-id')
    let r = await _fetch(url, { ...opt, headers: h })
    if (r.status === 400 || r.status === 401) {
      const j = await r.clone().json().catch(() => ({}))
      if (j.error === 'UNAUTHORIZED') { localStorage.removeItem(K); h.set('Authorization', 'Bearer ' + (await token())); r = await _fetch(url, { ...opt, headers: h }) }
    }
    return r
  }
  window.DF_AUTH = { token, uid: () => localStorage.df_uid }
})()

// 「工作台」下拉：点页面其它位置 / 选中菜单项 / 滚动 时自动收起（手机端尤其需要）
;(() => {
  const close = (e) => document.querySelectorAll('details.nav-more[open]').forEach((d) => { if (!e || e.type === 'scroll' || !d.contains(e.target) || e.target.closest('.more-menu a')) d.open = false })
  document.addEventListener('click', close, true)
  addEventListener('scroll', () => close({ type: 'scroll' }), { passive: true })
})()
