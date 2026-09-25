// API 级 E2E：node tests/e2e.mjs [base]
const B = process.argv[2] || 'http://localhost:3000'
const j = async (p, o = {}) => { const r = await fetch(B + p, { method: o.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-user-id': 'e2e_' + Date.now() }, body: o.body ? JSON.stringify(o.body) : undefined }); return r.json() }
const st = await j('/api/agents/3/selftest', { body: {} })
st.cases.forEach((c) => console.log(c.ok ? '✅' : '❌', c.name, '—', c.detail))
const ev = await j('/api/agents/4/simulate', { body: { weights: [0.45, 0.4, 0.15] } })
console.log(ev.arbitrage_risk ? '❌' : '✅', 'EV 沙盘无套利', ev.rows.map((r) => r.strategy + ':' + r.player_ev_per_100).join(' '))
const reg = await j('/api/agents/7/regulate'); console.log('✅ 监管节点', reg.nodes.length)
const cp = await j('/api/agents/7/clip-pairs'); console.log('✅ 片对规划 片数', cp.total_clips, '片对', cp.total_clip_pairs, '路径', cp.full_paths)
process.exit(st.failed || ev.arbitrage_risk ? 1 : 0)
