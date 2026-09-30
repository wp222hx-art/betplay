// 算力网接入验收：隔离 D1 + 本地算力网模拟服务（严格按 suanli.com/api-docs 协议）
// 覆盖：一键接入 / 连通测试 / 错误 Key 中文提示 / 11 个 Agent 套用推荐模型 / 设定图（/v1/images/generations）/ 主线视频参考图（metadata.content role=reference_image）/ 分支首帧接力（role=first_frame）/ 轮询 + 带鉴权下载 / 前置模拟 / 剧本评审
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), PORT = 3098, BASE = `http://127.0.0.1:${PORT}`, KEY = 'sk-suanli-test-0001'
const persist = mkdtempSync(join(tmpdir(), 'studio-sl-'))
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`) }
execSync(`npx wrangler d1 migrations apply webapp-production --local --persist-to ${persist}`, { cwd: ROOT, stdio: 'ignore' })
try { await fetch('http://127.0.0.1:3997/'); console.error('❌ 端口 3997 已被占用（旧 mock 未退出），请先结束该进程'); process.exit(2) } catch {}
const mock = spawn('node', [join(ROOT, 'studio/tests/suanli_mock.mjs')], { stdio: 'ignore', detached: true, env: { ...process.env, LOG: join(persist, 'sl.jsonl') } })
const srv = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--d1=webapp-production', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(PORT)], { cwd: join(ROOT, 'studio'), stdio: 'ignore', detached: true })
let node = null
const stop = () => { for (const p of [srv, mock, node]) try { p && process.kill(-p.pid) } catch {}; rmSync(persist, { recursive: true, force: true }) }
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const x = sc.match(/momo_studio=([^;]*)/); if (x) cookie = `momo_studio=${x[1]}` } const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {} return { status: r.status, json: j, text: t } } }
const log = () => existsSync(join(persist, 'sl.jsonl')) ? readFileSync(join(persist, 'sl.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
  const A = client()
  await A('POST', '/api/auth/bootstrap', { email: 'admin@sl.test', password: 'Admin-Pass-2026!' })
  // 1 错误 Key
  let r = await A('POST', '/api/providers/suanli/connect', { key: 'sk-wrong', base_url: 'http://127.0.0.1:3997', agents: ['__none__'] })
  ok('错误 Key → 连通测试失败并给中文原因', r.status === 200 && r.json.test.ok === false && /API Key 无效/.test(r.json.test.note), r.json?.test?.note)
  // 2 正确 Key + 套用推荐
  r = await A('POST', '/api/providers/suanli/connect', { key: KEY, base_url: 'http://127.0.0.1:3997' })
  ok('正确 Key → 鉴权通过并列出视频模型', r.json?.test?.ok && /seedance/.test(r.json.test.note), r.json?.test?.note)
  ok('11 个 Agent 套用推荐模型', r.json?.agents?.length === 11, String(r.json?.agents?.length))
  const cfg = (await A('GET', '/api/config')).json
  ok('配置只返回 Key 掩码', !JSON.stringify(cfg).includes(KEY) && cfg.providers.find((p) => p.kind === 'suanli')?.has_key)
  const ag = Object.fromEntries(cfg.agents.map((a) => [a.code, a]))
  ok('视频 Agent → doubao-seedance-2-0-cmcc1，图片 → wan2.7-image-pro', ag.VIDEO_MAIN.model === 'doubao-seedance-2-0-cmcc1' && ag.ASSET.model === 'wan2.7-image-pro')
  // 模拟文本走 mock_text（生成剧本不依赖外部）；视频/图片走算力网
  for (const code of ['SCREENWRITER', 'STRUCTURE', 'SCRIPT', 'PROMPT', 'CONTINUITY', 'REVIEWER', 'CONSISTENCY']) await A('POST', `/api/agents/${code}`, { provider_id: 'mock_text', model: 'mock' })
  r = await A('POST', '/api/projects', { title: '算力网接入测试' }); const pid = r.json.id
  const step = async (n, b) => { await A('POST', `/api/projects/${pid}/steps/${n}`, { ...(b || {}), submit: true }); return A('POST', `/api/projects/${pid}/steps/${n}/approve`) }
  await step(1, { output: { theme: '雨夜赌局', format: 'live' } })
  await A('POST', `/api/projects/${pid}/steps/2/run`); await A('POST', `/api/projects/${pid}/steps/2/approve`)
  r = await A('POST', `/api/projects/${pid}/graph/draft`); await step(3, { output: r.json.proposal })
  // 3 前置模拟（第 3 步后即可用，免费）
  r = await A('GET', `/api/projects/${pid}/insight`)
  ok('前置模拟：可编译 + 结局分布 + 生成清单 + 预算', r.json?.simulation?.playable && r.json.simulation.endings.length >= 2 && r.json.manifest.totals.clips > 0 && r.json.budget.total > 0, JSON.stringify({ e: r.json?.simulation?.endings, t: r.json?.manifest?.totals }))
  ok('生成清单按类型归类且分批（尾帧接力在后）', r.json.manifest.groups.length >= 2 && r.json.manifest.waves[0].wave === 0)
  r = await A('POST', `/api/projects/${pid}/insight/review`); ok('第 4 步前评审 → 409（需要剧本）', r.status === 409)
  await A('POST', `/api/projects/${pid}/scripts-run`, {}); await step(4)
  r = await A('POST', `/api/projects/${pid}/insight/review`)
  ok('剧本评审：合理性 + 吸引力指数（七维加权）', r.status === 200 && typeof r.json.logic === 'number' && r.json.appeal > 0 && Object.keys(r.json.dims).length === 7, JSON.stringify({ logic: r.json?.logic, appeal: r.json?.appeal, grade: r.json?.grade }))
  await A('POST', `/api/projects/${pid}/prompts-run`, {}); await step(5)
  // 4 设定图（算力网图片直连，无需执行节点）
  r = await A('POST', `/api/projects/${pid}/media/6/run`, {}); ok('设定图提交', r.json?.started?.length === 3, JSON.stringify(r.json))
  let m; for (let i = 0; i < 30; i++) { m = (await A('GET', `/api/projects/${pid}/media/6`)).json; if (m.summary.complete) break; await new Promise((z) => setTimeout(z, 1000)) }
  ok('设定图全部由算力网生成', m.summary.complete, JSON.stringify(m.summary))
  const img = log().filter((l) => l.p === '/v1/images/generations')
  ok('图片请求：Bearer + model=wan2.7-image-pro + 竖版封面 size', img.length === 3 && img.every((l) => l.auth && l.body.model === 'wan2.7-image-pro') && img.some((l) => l.body.size === '1536x2048'))
  await step(6)
  // 5 主线视频：直连提交 → 轮询 → 带鉴权下载 → 执行节点后处理
  const tok = (await A('POST', '/api/nodes', { name: 'post', kinds: ['post'] })).json.token
  node = spawn('python3', [join(ROOT, 'scripts/studio/studio_node.py')], { env: { ...process.env, STUDIO: BASE, NODE_TOKEN: tok, KINDS: 'post', CONC: '3', NODE_TMP: join(persist, 'node') }, stdio: 'ignore', detached: true })
  r = await A('POST', `/api/projects/${pid}/media/7/run`, {}); ok('主线开拍（算力网直连）', r.json?.started?.length >= 2, JSON.stringify(r.json))
  for (let i = 0; i < 60; i++) { m = (await A('GET', `/api/projects/${pid}/media/7`)).json; if (m.summary.ok + m.summary.failed + m.summary.qc_fail === m.summary.total) break; await new Promise((z) => setTimeout(z, 1500)) }
  ok('主线全部完成（轮询 → 下载 → 后处理 → 质检）', m.summary.complete, JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.note])))
  const vs = log().filter((l) => l.p === '/v1/video/generations')
  ok('视频请求：统一协议 model + prompt + metadata', vs.length >= 2 && vs.every((l) => l.auth && l.body.model === 'doubao-seedance-2-0-cmcc1' && l.body.metadata.generate_audio === true && l.body.metadata.resolution === '720p' && l.body.ratio === '9:16'))
  ok('主线：设定图作为 reference_image，并在提示词中标注「图片1为…」', vs.every((l) => (l.body.metadata.content || []).every((c) => c.role === 'reference_image')) && vs.some((l) => /图片1为/.test(l.body.prompt)))
  ok('成片下载带 Authorization（/v1/videos/{id}/content）', log().some((l) => /\/content$/.test(l.p) && l.auth))
  await step(7)
  r = await A('POST', `/api/projects/${pid}/media/8/run`, {})
  for (let i = 0; i < 60; i++) { m = (await A('GET', `/api/projects/${pid}/media/8`)).json; if (m.summary.total && m.summary.ok + m.summary.failed + m.summary.qc_fail === m.summary.total) break; await new Promise((z) => setTimeout(z, 1500)) }
  const fr = log().filter((l) => l.p === '/v1/video/generations').slice(vs.length)
  ok('分支：上一段尾帧作为 first_frame（首帧接力）', fr.length >= 1 && fr.some((l) => (l.body.metadata.content || []).some((c) => c.role === 'first_frame')), JSON.stringify(fr.map((l) => (l.body.metadata.content || []).map((c) => c.role))))
  ok('分支完成', m.summary.complete, JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.note])))
  const leaked = log().length && JSON.stringify((await A('GET', '/api/audit')).json).includes(KEY)
  ok('审计日志不含 Key 明文', !leaked)
} catch (e) { fail++; console.error('❌ 异常', e) } finally { stop() }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
