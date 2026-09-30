// 多平台接入验收：TokenHot / DeepSeek 官方 / 火山方舟官方（隔离 D1 + 三平台协议模拟 :3996）
// 覆盖：一键接入 + 深度连通测试（鉴权 / 模型列表 / 余额 / 最小对话）· 错误 Key · 心跳 + 监控总览 · 目录与 Agent 适配
//      · DeepSeek 对话（思考模式参数规则）· 方舟 Seedream 设定图 + Seedance 主线（content[] reference_image + return_last_frame）
//      · TokenHot Seedance 分支（content[] first_frame，按任务 quota 计费）· 使用情况按服务商 × 模型聚合
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), PORT = 3097, BASE = `http://127.0.0.1:${PORT}`, MB = 'http://127.0.0.1:3996'
const persist = mkdtempSync(join(tmpdir(), 'studio-pf-'))
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
execSync(`npx wrangler d1 migrations apply webapp-production --local --persist-to ${persist}`, { cwd: ROOT, stdio: 'ignore' })
try { await fetch(MB + '/'); console.error('❌ 端口 3996 已被占用'); process.exit(2) } catch {}
const mock = spawn('node', [join(ROOT, 'studio/tests/platforms_mock.mjs')], { stdio: 'ignore', detached: true, env: { ...process.env, LOG: join(persist, 'pf.jsonl') } })
const srv = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--d1=webapp-production', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(PORT)], { cwd: join(ROOT, 'studio'), stdio: 'ignore', detached: true })
let node = null
const stop = () => { for (const p of [srv, mock, node]) try { p && process.kill(-p.pid) } catch {}; rmSync(persist, { recursive: true, force: true }) }
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const x = sc.match(/momo_studio=([^;]*)/); if (x) cookie = `momo_studio=${x[1]}` } const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {} return { status: r.status, json: j, text: t } } }
const log = () => existsSync(join(persist, 'pf.jsonl')) ? readFileSync(join(persist, 'pf.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await wait(500) }
  const A = client()
  await A('POST', '/api/auth/bootstrap', { email: 'admin@pf.test', password: 'Admin-Pass-2026!' })
  // ── 1 错误 Key ──
  let r = await A('POST', '/api/platforms/deepseek/connect', { key: 'sk-wrong', base_url: MB + '/ds', agents: ['__none__'] })
  ok('DeepSeek 错误 Key → 连通测试失败', r.status === 200 && r.json.test.ok === false && /Invalid|401/.test(r.json.test.note), r.json?.test?.note)
  // ── 2 三个平台接入（深度连通测试）──
  r = await A('POST', '/api/platforms/deepseek/connect', { key: 'sk-ds-test-0001', base_url: MB + '/ds' })
  ok('DeepSeek 接入：鉴权 + 模型 2 个 + 余额 ¥88.5 + 最小对话', r.json?.test?.ok && r.json.test.models === 2 && r.json.test.balance === 88.5 && r.json.test.chat?.ok, r.json?.test?.note)
  ok('DeepSeek 推荐预设切换 8 个对话 Agent', r.json.agents.length === 8 && !r.json.agents.includes('VIDEO_MAIN'), JSON.stringify(r.json.agents))
  const dsBody = log().filter((l) => l.pf === 'ds' && l.p === '/chat/completions').pop()?.body
  ok('DeepSeek 探测请求关闭思考且 max_tokens=8', dsBody?.thinking?.type === 'disabled' && dsBody.max_tokens === 8)
  r = await A('POST', '/api/platforms/ark/connect', { key: 'ark-test-0001', base_url: MB + '/ark/api/v3', agents: ['ASSET', 'VIDEO_MAIN'] })
  ok('方舟接入：最小对话鉴权通过，设定图 + 主线视频切到方舟', r.json?.test?.ok && r.json.agents.join() === 'ASSET,VIDEO_MAIN', r.json?.test?.note)
  r = await A('POST', '/api/platforms/tokenhot/connect', { key: 'sk-th-test-0001', base_url: MB + '/th', agents: ['VIDEO_BRANCH'] })
  ok('TokenHot 接入：模型 6 个 + 余额 $37.66 + 分支视频切到 TokenHot', r.json?.test?.ok && r.json.test.models === 6 && r.json.test.balance === 37.66 && r.json.agents.join() === 'VIDEO_BRANCH', r.json?.test?.note)
  const cfg = (await A('GET', '/api/config')).json
  ok('Key 全部只返回掩码', !/sk-ds-test-0001|ark-test-0001|sk-th-test-0001/.test(JSON.stringify(cfg)) && ['deepseek', 'ark', 'tokenhot'].every((k) => cfg.providers.find((p) => p.kind === k)?.has_key), JSON.stringify(cfg.providers.map((p) => [p.kind, p.has_key, p.key_hint])))
  // ── 3 目录 ──
  const thc = (await A('GET', '/api/platforms/tokenhot/catalog')).json
  ok('TokenHot 目录：96 个模型，Key 可用标注 6 个', thc.models.length === 96 && thc.models.filter((m) => m.available).length === 6, `${thc.models.length}`)
  ok('TokenHot 主线视频下拉只含能锁人物的模型（含 Seedance / Veo / Wan3 / HappyHorse r2v）', thc.agents.VIDEO_MAIN.options.includes('doubao-seedance-2-0') && thc.agents.VIDEO_MAIN.options.includes('wan3.0-video') && !thc.agents.VIDEO_MAIN.options.includes('happyhorse-1.1-t2v') && !thc.agents.VIDEO_MAIN.options.includes('kling-v3'))
  const arkc = (await A('GET', '/api/platforms/ark/catalog')).json
  ok('方舟目录：Seed 2.1 / Seedream 5.0 / Seedance 2.5·2.0·fast·mini', ['doubao-seed-2-1-pro-260915', 'doubao-seedream-5-0-260128', 'doubao-seedance-2-5-260628', 'doubao-seedance-2-0-mini-260615'].every((id) => arkc.models.some((m) => m.id === id)))
  r = await A('POST', '/api/agents/VIDEO_MAIN', { model: 'doubao-seed-2-1-lite-260915' }); ok('方舟：主线视频选对话模型 → 400', r.status === 400)
  r = await A('POST', '/api/agents/VIDEO_MAIN', { model: 'not-a-model' }); ok('未知模型 → 400 UNKNOWN_MODEL', r.status === 400 && /目录中没有/.test(r.text))
  r = await A('POST', '/api/agents/VIDEO_MAIN', { model: 'doubao-seedance-2-0-260128', params: { ratio: '9:16', resolution: '720p', duration: 8, audio: true, watermark: false, seed: 11 } }); ok('方舟主线视频参数保存（seed=11）', r.status === 200)
  // ── 4 心跳 + 监控 ──
  r = await A('POST', '/api/health/beat', {})
  ok('立即心跳：三个平台全部探测成功', r.json.beats.length === 3 && r.json.beats.every((b) => b.ok), JSON.stringify(r.json.beats))
  let mon = (await A('GET', '/api/health/providers')).json
  const byKind = Object.fromEntries(mon.providers.map((p) => [p.kind, p]))
  ok('监控：三个平台在线，可用率正确（DeepSeek 含错误 Key 那次 = 2/3），火花线有记录', ['deepseek', 'ark', 'tokenhot'].every((k) => byKind[k].status === 'up' && byKind[k].uptime24 >= (k === 'deepseek' ? 66 : 100) && byKind[k].spark.length >= 2), JSON.stringify(['deepseek', 'ark', 'tokenhot'].map((k) => [k, byKind[k].status, byKind[k].uptime24, byKind[k].spark.length])))
  ok('监控：DeepSeek 余额 ¥88.5 / TokenHot $37.66；方舟无余额接口', byKind.deepseek.balance?.value === 88.5 && byKind.tokenhot.balance?.value === 37.66 && !byKind.ark.balance)
  ok('监控：显示各平台使用中的 Agent', byKind.deepseek.agents.length === 8 && byKind.ark.agents.map((a) => a.code).sort().join() === 'ASSET,VIDEO_MAIN')
  const beats0 = log().length; r = await A('GET', '/api/health/providers'); await wait(800)
  ok('心跳节流：5 分钟内再次访问不重复探测', log().length === beats0)
  // ── 5 生产线：DeepSeek 写剧本 → 方舟设定图 + 主线 → TokenHot 分支 ──
  r = await A('POST', '/api/projects', { title: '多平台接入测试' }); const pid = r.json.id
  const step = async (n, b) => { await A('POST', `/api/projects/${pid}/steps/${n}`, { ...(b || {}), submit: true }); return A('POST', `/api/projects/${pid}/steps/${n}/approve`) }
  // 结构 / 剧本等用 mock_text 保证产出结构稳定；DeepSeek 真实协议由评审 Agent 验证
  for (const code of ['SCREENWRITER', 'STRUCTURE', 'SCRIPT', 'PROMPT', 'CONTINUITY', 'CONSISTENCY']) await A('POST', `/api/agents/${code}`, { provider_id: 'mock_text', model: 'mock' })
  await step(1, { output: { theme: '雨夜赌局', format: 'live' } })
  await A('POST', `/api/projects/${pid}/steps/2/run`); await A('POST', `/api/projects/${pid}/steps/2/approve`)
  r = await A('POST', `/api/projects/${pid}/graph/draft`); await step(3, { output: r.json.proposal })
  await A('POST', `/api/projects/${pid}/scripts-run`, {}); await step(4)
  r = await A('POST', `/api/projects/${pid}/insight/review`)
  const rv = log().filter((l) => l.pf === 'ds' && l.p === '/chat/completions').pop()?.body
  ok('DeepSeek 评审调用成功（思考模式 → 不发 temperature，json_object）', r.status === 200 && rv?.model === 'deepseek-v4-pro' && rv.temperature === undefined && rv.response_format?.type === 'json_object' && rv.reasoning_effort === 'high', r.json?.message || '')
  const pre = (await A('GET', `/api/projects/${pid}/insight`)).json
  ok('前置预算按所选模型：视频 ¥/秒 来自 TokenHot（动态）或方舟官方价', pre.budget?.price && pre.budget.price.image_model === 'doubao-seedream-5-0-260128' && pre.budget.price.image === 0.22 && pre.budget.price.video_model === 'doubao-seedance-2-0', JSON.stringify(pre.budget?.price))
  await A('POST', `/api/projects/${pid}/prompts-run`, {}); await step(5)
  r = await A('POST', `/api/projects/${pid}/media/6/run`, {}); ok('方舟 Seedream 设定图提交', r.json?.started?.length === 3, JSON.stringify(r.json))
  let m; for (let i = 0; i < 30; i++) { m = (await A('GET', `/api/projects/${pid}/media/6`)).json; if (m.summary.complete) break; await wait(800) }
  ok('设定图全部完成，按官方单价计费（3 × ¥0.22）', m.summary.complete && Math.abs(m.summary.cost - 0.66) < 0.001, JSON.stringify(m.summary))
  const img = log().filter((l) => l.pf === 'ark' && l.p === '/api/v3/images/generations')
  ok('方舟图片请求：Bearer + watermark=false + 竖版封面 1536x2048', img.length === 3 && img.every((l) => l.auth && l.body.watermark === false) && img.some((l) => l.body.size === '1536x2048'))
  await step(6)
  const tok = (await A('POST', '/api/nodes', { name: 'post', kinds: ['post'] })).json.token
  node = spawn('python3', [join(ROOT, 'scripts/studio/studio_node.py')], { env: { ...process.env, STUDIO: BASE, NODE_TOKEN: tok, KINDS: 'post', CONC: '3', NODE_TMP: join(persist, 'node') }, stdio: 'ignore', detached: true })
  r = await A('POST', `/api/projects/${pid}/media/7/run`, {}); ok('方舟 Seedance 主线开拍', r.json?.started?.length >= 2, JSON.stringify(r.json))
  for (let i = 0; i < 60; i++) { m = (await A('GET', `/api/projects/${pid}/media/7`)).json; if (m.summary.ok + m.summary.failed + m.summary.qc_fail === m.summary.total) break; await wait(1500) }
  ok('主线全部完成（方舟轮询 → 下载 → 尾帧 → 后处理 → 质检）', m.summary.complete, JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.note])))
  const av = log().filter((l) => l.pf === 'ark' && l.p === '/api/v3/contents/generations/tasks' && l.m === 'POST')
  ok('方舟视频：content[] + reference_image + 图片1为… + return_last_frame + seed', av.length >= 2 && av.every((l) => l.body.content[0].type === 'text' && l.body.return_last_frame === true && l.body.seed === 11 && l.body.generate_audio === true && l.body.content.slice(1).every((c) => c.role === 'reference_image')) && av.some((l) => /图片1为/.test(l.body.content[0].text)))
  ok('主线按方舟 usage 计费（173000 token × ¥46/M ≈ ¥7.96/段）', Math.abs(m.summary.cost / m.summary.total - 7.958) < 0.01, String(m.summary.cost))
  await step(7)
  r = await A('POST', `/api/projects/${pid}/media/8/run`, {})
  for (let i = 0; i < 60; i++) { m = (await A('GET', `/api/projects/${pid}/media/8`)).json; if (m.summary.total && m.summary.ok + m.summary.failed + m.summary.qc_fail === m.summary.total) break; await wait(1500) }
  const tv = log().filter((l) => l.pf === 'th' && l.p === '/v1/video/generations' && l.m === 'POST')
  ok('TokenHot 分支：Seedance content[] + first_frame（主线尾帧接力）', tv.length >= 1 && tv.every((l) => l.body.model === 'doubao-seedance-2-0' && l.body.content[0].type === 'text' && l.body.content.some((c) => c.role === 'first_frame')), JSON.stringify(tv.map((l) => l.body.content.map((c) => c.role || c.type))))
  ok('TokenHot 成片带鉴权下载 + 分支完成', log().some((l) => l.pf === 'th' && /\/content$/.test(l.p) && l.auth) && m.summary.complete, JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.note])))
  ok('TokenHot 按任务 quota 实扣计费（350000 quota = $0.7 = ¥4.9/段）', Math.abs(m.summary.cost / m.summary.total - 4.9) < 0.01, String(m.summary.cost))
  // ── 6 使用情况 ──
  mon = (await A('GET', '/api/health/providers')).json
  const U = Object.fromEntries(mon.providers.map((p) => [p.kind, p.usage]))
  ok('使用情况：DeepSeek 对话调用计数 + token + 花费', U.deepseek.calls7 >= 1 && U.deepseek.tokens7 >= 1500 && U.deepseek.cost7 > 0, JSON.stringify(U.deepseek))
  ok('使用情况：方舟媒体任务 ≥5（3 图 + 主线）/ TokenHot 分支任务', U.ark.media7 >= 5 && U.ark.media_ok7 === U.ark.media7 && U.tokenhot.media7 >= 1, JSON.stringify({ ark: U.ark.media7, th: U.tokenhot.media7 }))
  ok('使用情况：按模型拆分', mon.providers.find((p) => p.kind === 'ark').usage.models.some((x) => x.model === 'doubao-seedance-2-0-260128') && mon.providers.find((p) => p.kind === 'ark').usage.models.some((x) => x.model === 'doubao-seedream-5-0-260128'))
  const leaked = JSON.stringify((await A('GET', '/api/audit')).json)
  ok('审计日志不含任何 Key 明文', !/sk-ds-test-0001|ark-test-0001|sk-th-test-0001/.test(leaked))
} catch (e) { fail++; console.error('❌ 异常', e) } finally { stop() }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
