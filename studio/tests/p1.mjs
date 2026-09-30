// MoMo Studio P1 验收测试：在隔离的临时 D1 上启动独立 wrangler 实例（端口 3099），不污染真实后台数据
// 覆盖：初始化/登录、未登录 401、角色不足 403、跨站 403、跳步 409、通过解锁、修改已完成步骤→下游 stale、Key 不外泄、登录锁定
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 3099, BASE = `http://127.0.0.1:${PORT}`
const persist = mkdtempSync(join(tmpdir(), 'studio-p1-'))
const SECRET = 'sk-TEST-plaintext-9f8e7d6c5b4a3210-never-leak'
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`) }

execSync(`npx wrangler d1 migrations apply webapp-production --local --persist-to ${persist}`, { cwd: ROOT, stdio: 'ignore' })
const srv = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--d1=webapp-production', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(PORT)], { cwd: join(ROOT, 'studio'), stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-srv.pid) } catch {} ; rmSync(persist, { recursive: true, force: true }) }

// 极简 cookie 客户端
function client(ip) {
  let cookie = ''
  return async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/momo_studio=([^;]*)/); if (m) cookie = m[1] ? `momo_studio=${m[1]}` : '' }
    const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, text, setCookie: sc }
  }
}

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
  const admin = client('10.0.0.1'), anon = client('10.0.0.2')
  const allText = []  // 收集所有响应，用于 Key 泄露扫描
  const A = async (...a) => { const r = await admin(...a); allText.push(r.text); return r }

  // 1 初始化 + 登录
  let r = await anon('GET', '/api/auth/state'); ok('初始状态未初始化', r.json?.initialized === false && r.json?.master_key_ok === true, JSON.stringify(r.json))
  r = await A('POST', '/api/auth/bootstrap', { email: 'admin@momo.test', password: 'short' }); ok('弱密码被拒 400', r.status === 400)
  r = await A('POST', '/api/auth/bootstrap', { email: 'admin@momo.test', password: 'Admin-Pass-2026!' }); ok('初始化管理员并登录', r.status === 200 && r.json?.user?.role === 'admin')
  ok('Cookie HttpOnly + SameSite=Strict', /HttpOnly/i.test(r.setCookie || '') && /SameSite=Strict/i.test(r.setCookie || ''))
  r = await anon('POST', '/api/auth/bootstrap', { email: 'evil@x.com', password: 'Evil-Pass-2026!' }); ok('重复初始化被拒 409', r.status === 409)

  // 2 未登录 401
  r = await anon('GET', '/api/config'); ok('未登录访问配置 401', r.status === 401)
  r = await anon('GET', '/api/projects'); ok('未登录访问项目 401', r.status === 401)

  // 3 角色
  r = await A('POST', '/api/users', { email: 'rev@momo.test', password: 'Review-Pass-2026!', role: 'reviewer' }); ok('创建 reviewer', r.status === 200)
  r = await A('POST', '/api/users', { email: 'wri@momo.test', password: 'Writer-Pass-2026!', role: 'writer' }); ok('创建 writer', r.status === 200)
  const rev = client('10.0.0.3'), wri = client('10.0.0.4')
  await rev('POST', '/api/auth/login', { email: 'rev@momo.test', password: 'Review-Pass-2026!' })
  await wri('POST', '/api/auth/login', { email: 'wri@momo.test', password: 'Writer-Pass-2026!' })
  r = await rev('POST', '/api/projects', { title: 'x' }); ok('reviewer 不能建项目 403', r.status === 403)
  r = await wri('GET', '/api/users'); ok('writer 不能管账号 403', r.status === 403)
  r = await wri('POST', '/api/providers', { name: 'x', kind: 'openai_compat', base_url: 'https://a.b', key: 'k' }); ok('writer 不能改 Key 403', r.status === 403)
  r = await A('POST', '/api/projects', { title: 'csrf' }, { origin: 'https://evil.example.com' }); ok('跨站 Origin 写入 403', r.status === 403 && r.json?.error === 'BAD_ORIGIN')

  // 4 十步卡关
  r = await wri('POST', '/api/projects', { title: '卡关测试剧', format: 'live' }); const pid = r.json?.id; ok('writer 建项目', !!pid)
  r = await wri('POST', `/api/projects/${pid}/steps/3`, { output: { nodes: [] } }); ok('跳到第 3 步被拒 409', r.status === 409 && r.json?.error === 'STEP_LOCKED' && r.json?.blocking_step === 1, JSON.stringify(r.json))
  r = await wri('POST', `/api/projects/${pid}/steps/2/run`); ok('第 1 步未完成时运行第 2 步 Agent 被拒 409', r.status === 409 && r.json?.blocking_step === 1)
  r = await rev('POST', `/api/projects/${pid}/steps/1/approve`); ok('无产出不能通过 409', r.status === 409 && r.json?.error === 'NO_OUTPUT')
  r = await wri('POST', `/api/projects/${pid}/steps/1`, { output: { theme: '豪门复仇', format: 'live', scale: 'pilot' }, submit: true }); ok('第 1 步提交审核', r.status === 200 && r.json?.status === 'review')
  r = await wri('POST', `/api/projects/${pid}/steps/1/approve`); ok('writer 不能审批 403', r.status === 403)
  r = await rev('POST', `/api/projects/${pid}/steps/1/approve`); ok('reviewer 通过第 1 步 → 解锁第 2 步', r.status === 200 && r.json?.next === 2)
  r = await wri('POST', `/api/projects/${pid}/steps/3`, { output: {} }); ok('第 2 步未完成，第 3 步仍 409', r.status === 409 && r.json?.blocking_step === 2)
  await wri('POST', `/api/projects/${pid}/steps/2`, { output: { logline: 'x', cast: [] }, submit: true })
  await rev('POST', `/api/projects/${pid}/steps/2/approve`)
  const G3 = { start: 's', nodes: [{ id: 's', type: 'scene', title: '开局', beat: 'x' }, { id: 'c', type: 'choice', title: '下注', beat: 'x', question: 'q' }, { id: 'e1', type: 'ending', title: '赢', tier: 'gold' }, { id: 'e2', type: 'ending', title: '输', tier: 'bad' }], edges: [{ from: 's', to: 'c' }, { from: 'c', to: 'e1', label: '全押' }, { from: 'c', to: 'e2', label: '弃牌' }] }
  r = await wri('POST', `/api/projects/${pid}/steps/3`, { output: { nodes: [{ id: 'a', type: 'scene', title: 'x' }] }, submit: true }); ok('非法结构图不能提交审核 422', r.status === 422 && r.json?.error === 'GRAPH_INVALID' && r.json?.issues?.length > 0)
  r = await rev('POST', `/api/projects/${pid}/steps/3/approve`); ok('非法结构图不能审批通过 422', r.status === 422)
  r = await wri('POST', `/api/projects/${pid}/steps/3`, { output: G3, submit: true }); ok('合法结构图提交审核', r.status === 200 && r.json?.status === 'review')
  r = await wri('POST', `/api/projects/${pid}/graph/analyze`, { graph: G3 }); ok('结构分析接口：2 条路径', r.json?.stats?.paths === 2 && r.json?.ok === true)
  r = await anon('POST', `/api/projects/${pid}/graph/analyze`, { graph: G3 }); ok('未登录不能调用结构接口 401', r.status === 401)
  await rev('POST', `/api/projects/${pid}/steps/3/approve`)
  r = await rev('GET', `/api/projects/${pid}`); let st = r.json.steps.map((s) => s.status)
  ok('1–3 done，4 ready，5+ locked', st.slice(0, 3).every((s) => s === 'done') && st[3] === 'ready' && st.slice(4).every((s) => s === 'locked'), st.join(','))
  // 修改已完成的第 1 步 → 下游失效
  r = await wri('POST', `/api/projects/${pid}/steps/1`, { output: { theme: '豪门复仇·改', format: 'live' } }); ok('修改已完成步骤', r.status === 200 && r.json?.staled >= 3, JSON.stringify(r.json))
  r = await rev('GET', `/api/projects/${pid}`); st = r.json.steps.map((s) => s.status)
  ok('第 1 步回到 review，2–4 变 stale', st[0] === 'review' && st.slice(1, 4).every((s) => s === 'stale') && st.slice(4).every((s) => s === 'locked'), st.join(','))
  r = await wri('POST', `/api/projects/${pid}/steps/2`, { output: {} }); ok('上游重审前下游仍被卡 409', r.status === 409 && r.json?.blocking_step === 1)
  await rev('POST', `/api/projects/${pid}/steps/1/approve`)
  r = await rev('GET', `/api/projects/${pid}`); st = r.json.steps.map((s) => s.status)
  ok('重审通过 → 第 2 步 ready，3/4 仍 stale 待重做', st[0] === 'done' && st[1] === 'ready' && st[2] === 'stale' && st[3] === 'stale', st.join(','))
  r = await wri('POST', `/api/projects/${pid}/steps/2/reopen`); ok('reopen 未通过前置的下游不可操作', r.status === 200)

  // 4b P3 · 剧本 + 提示词（切到模拟对话服务商，离线确定性）
  for (const code of ['SCREENWRITER', 'STRUCTURE', 'SCRIPT', 'PROMPT', 'CONTINUITY']) await A('POST', `/api/agents/${code}`, { provider_id: 'mock_text', model: 'mock' })
  r = await wri('POST', '/api/projects', { title: '账本测试剧' }); const p3 = r.json.id
  await wri('POST', `/api/projects/${p3}/steps/1`, { output: { theme: 't', format: 'live' }, submit: true }); await rev('POST', `/api/projects/${p3}/steps/1/approve`)
  r = await wri('POST', `/api/projects/${p3}/steps/2/run`); ok('模拟编剧 Agent 生成世界观', r.status === 200 && r.json?.output?.cast?.length === 2)
  await rev('POST', `/api/projects/${p3}/steps/2/approve`)
  r = await wri('POST', `/api/projects/${p3}/graph/draft`); ok('模拟结构 Agent 出提案', r.status === 200 && r.json?.analysis?.ok, JSON.stringify(r.json?.analysis?.issues || r.json).slice(0, 200))
  await wri('POST', `/api/projects/${p3}/steps/3`, { output: r.json.proposal, submit: true }); await rev('POST', `/api/projects/${p3}/steps/3/approve`)
  r = await wri('GET', `/api/projects/${p3}/prompts`); ok('第 4 步未完成，提示词接口 409', r.status === 409)
  r = await wri('GET', `/api/projects/${p3}/scripts`); ok('剧本状态：起点可写、其余等待上游', r.json?.summary?.missing === 1 && r.json?.summary?.waiting === 3, JSON.stringify(r.json?.summary))
  r = await wri('POST', `/api/projects/${p3}/steps/4`, { submit: true }); ok('剧本未完成不能提交 422', r.status === 422 && r.json?.error === 'DOCS_INCOMPLETE')
  r = await wri('POST', `/api/projects/${p3}/scripts/e1`, { doc: { summary: 'x', beats: [{ action: 'a' }, { action: 'b' }], cast: ['hero'] } }); ok('上游未完成不能编辑下游节点 409', r.status === 409 && r.json?.error === 'UPSTREAM_PENDING')
  r = await wri('POST', `/api/projects/${p3}/scripts-run`, {}); ok('逐层生成全部剧本', r.status === 200 && r.json?.summary?.complete, JSON.stringify(r.json?.summary || r.json))
  r = await wri('POST', `/api/projects/${p3}/scripts/e2`, { doc: { summary: '输光', beats: [{ who: 'hero', action: '起身' }, { who: 'hero', action: '离开' }], cast: ['hero'], requires: [{ key: 'know.hero.secret', value: '庄家出千' }] } })
  ok('人工写入依赖未建立事实 → 账本报错', r.status === 200 && r.json.ok === false && r.json.issues.some((i) => i.code === 'LEDGER_MISSING'))
  r = await wri('POST', `/api/projects/${p3}/steps/4`, { submit: true }); ok('有账本错误不能提交 422', r.status === 422)
  r = await wri('POST', `/api/projects/${p3}/scripts/e2`, { doc: { summary: '输光', beats: [{ who: 'hero', action: '起身' }, { who: 'hero', action: '离开' }], cast: ['hero'] } }); ok('修正后通过', r.json?.ok === true)
  r = await wri('POST', `/api/projects/${p3}/steps/4`, { submit: true }); ok('剧本提交审核', r.status === 200)
  await wri('POST', `/api/projects/${p3}/scripts/e2`, { doc: { summary: '输光·改', beats: [{ who: 'hero', action: '起身' }, { who: 'hero', action: '离开' }], cast: ['hero'] } })
  r = await rev('GET', `/api/projects/${p3}`); ok('提交后再改节点 → 步骤回到进行中，需重新提交', r.json.steps[3].status === 'ready', r.json.steps[3].status)
  await wri('POST', `/api/projects/${p3}/steps/4`, { submit: true }); r = await rev('POST', `/api/projects/${p3}/steps/4/approve`); ok('剧本审批通过', r.status === 200 && r.json?.next === 5)
  r = await wri('POST', `/api/projects/${p3}/scripts-run`, {}); ok('已通过步骤不能再生成 409', r.status === 409 && r.json?.error === 'STEP_DONE')
  r = await wri('GET', `/api/projects/${p3}/prompts`); ok('提示词：主线参考图 / 分支尾帧', r.json?.summary?.reference >= 3 && r.json?.summary?.frames === 1, JSON.stringify(r.json?.summary))
  r = await wri('POST', `/api/projects/${p3}/prompts-run`, {}); ok('生成提示词 + 连贯监管', r.status === 200 && r.json?.summary?.complete, JSON.stringify(r.json?.summary || r.json))
  r = await wri('GET', `/api/projects/${p3}/prompts/e2`); ok('提示词含账本附录且禁止字幕', /Keep every character/.test(r.json?.doc?.final) && /No on-screen text/.test(r.json?.doc?.final) && r.json?.doc?.mode === 'frames')
  r = await wri('POST', `/api/projects/${p3}/steps/5`, { submit: true }); ok('提示词提交审核', r.status === 200)
  r = await rev('POST', `/api/projects/${p3}/steps/5/approve`); ok('提示词审批通过 → 解锁第 6 步', r.status === 200 && r.json?.next === 6)
  r = await wri('POST', `/api/projects/${p3}/steps/4/reopen`, { note: 'x' }); ok('退回第 4 步 → 第 5 步失效', r.json?.staled >= 1)
  r = await wri('GET', `/api/projects/${p3}/prompts`); ok('第 4 步退回后提示词接口被卡', r.status === 409)

  // 4c P4 · 素材流水线（模拟图片/视频 + 本地执行节点）
  {
    await A('POST', `/api/agents/ASSET`, { provider_id: 'mock_image', model: 'mock' })
    r = await wri('POST', '/api/projects', { title: '素材测试剧' }); const p4 = r.json.id
    await wri('POST', `/api/projects/${p4}/steps/1`, { output: { theme: 't', format: 'live' }, submit: true }); await rev('POST', `/api/projects/${p4}/steps/1/approve`)
    await wri('POST', `/api/projects/${p4}/steps/2/run`); await rev('POST', `/api/projects/${p4}/steps/2/approve`)
    r = await wri('POST', `/api/projects/${p4}/graph/draft`); await wri('POST', `/api/projects/${p4}/steps/3`, { output: r.json.proposal, submit: true }); await rev('POST', `/api/projects/${p4}/steps/3/approve`)
    await wri('POST', `/api/projects/${p4}/scripts-run`, {}); await wri('POST', `/api/projects/${p4}/steps/4`, { submit: true }); await rev('POST', `/api/projects/${p4}/steps/4/approve`)
    await wri('POST', `/api/projects/${p4}/prompts-run`, {}); await wri('POST', `/api/projects/${p4}/steps/5`, { submit: true }); r = await rev('POST', `/api/projects/${p4}/steps/5/approve`)
    ok('P4 项目前 5 步通过', r.json?.next === 6)
    r = await wri('POST', `/api/projects/${p4}/media/7/run`, {}); ok('设定图未通过时不能开拍主线 409', r.status === 409 && r.json?.blocking_step === 6)
    r = await anon('POST', '/node/claim', {}); ok('执行节点无令牌 401', r.status === 401)
    r = await anon('POST', '/node/claim', {}, { authorization: 'Bearer msn_fake' }); ok('执行节点伪造令牌 401', r.status === 401)
    r = await wri('POST', '/api/nodes', { name: 'x' }); ok('编剧不能创建执行节点 403', r.status === 403)
    r = await A('POST', '/api/nodes', { name: '测试节点', kinds: ['post', 'mock_image', 'mock_video'] }); const tok = r.json?.token; ok('管理员创建执行节点（令牌仅返回一次）', /^msn_/.test(tok || ''))
    r = await A('GET', '/api/nodes'); ok('节点列表不含令牌', !JSON.stringify(r.json).includes(tok))
    const node = spawn('python3', [join(ROOT, 'scripts/studio/studio_node.py')], { env: { ...process.env, STUDIO: BASE, NODE_TOKEN: tok, KINDS: 'post,mock_image,mock_video', CONC: '3', NODE_TMP: join(persist, 'node') }, stdio: 'ignore', detached: true })
    const wait = async (step, cond, ms = 90000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await wri('GET', `/api/projects/${p4}/media/${step}`); if (cond(v.json)) return v.json; await new Promise((z) => setTimeout(z, 1500)) } return v.json }
    try {
      r = await wri('POST', `/api/projects/${p4}/media/6/run`, {}); ok('提交设定图（2 角色 + 封面）', r.json?.started?.length === 3, JSON.stringify(r.json))
      let m = await wait(6, (d) => d.summary.complete); ok('设定图全部生成', m.summary.complete, JSON.stringify(m.summary))
      r = await anon('GET', m.slots[0].media); ok('未登录不能读素材 401', r.status === 401)
      r = await wri('POST', `/api/projects/${p4}/steps/6`, { submit: true }); await rev('POST', `/api/projects/${p4}/steps/6/approve`)
      r = await wri('POST', `/api/projects/${p4}/media/7/run`, {}); ok('主线开拍', r.json?.started?.length >= 3, JSON.stringify(r.json))
      m = await wait(7, (d) => d.summary.ok + d.summary.failed + d.summary.qc_fail === d.summary.total)
      ok('主线全部通过（后处理 + 质检）', m.summary.complete, JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.note])))
      ok('主线全部为参考图模式', m.slots.every((x) => x.mode === 'reference'))
      ok('主线有首帧/尾帧/海报/质检', m.slots.every((x) => x.first && x.last && x.thumb && x.qc?.duration > 0 && x.qc?.audio === true))
      r = await wri('GET', m.slots[0].media, null, { range: 'bytes=0-99' }); ok('视频支持 Range 206', r.status === 206)
      await wri('POST', `/api/projects/${p4}/steps/7`, { submit: true }); await rev('POST', `/api/projects/${p4}/steps/7/approve`)
      r = await wri('POST', `/api/projects/${p4}/media/8/run`, {}); ok('分支开拍', r.status === 200)
      m = await wait(8, (d) => d.summary.ok + d.summary.failed + d.summary.qc_fail === d.summary.total && d.summary.total > 0)
      const br = m.slots[0]
      ok('分支为尾帧接力并算出衔接分', br.mode === 'frames' && typeof br.qc?.seam === 'number' && br.qc.seam >= 0.55, JSON.stringify(br.qc))
      r = await wri('POST', `/api/projects/${p4}/media/8/judge`, { slot: br.slot, accept: false }); ok('编剧不能判定素材 403', r.status === 403)
      r = await rev('POST', `/api/projects/${p4}/media/8/judge`, { slot: br.slot, accept: false, note: 'hero 的发型不对' }); ok('审核驳回 → 不合格', r.status === 200)
      r = await wri('POST', `/api/projects/${p4}/steps/8`, { submit: true }); ok('有不合格素材不能提交 422', r.status === 422)
      r = await wri('POST', `/api/projects/${p4}/media/8/run`, { only: [br.slot] }); m = await wait(8, (d) => d.slots[0].status === 'ok' || d.slots[0].status === 'qc_fail' && d.slots[0].attempts > 1)
      ok('重拍通过，驳回意见写入下次提示词', m.slots[0].status === 'ok' && m.slots[0].attempts === 2)
      const jobs = execSync(`npx wrangler d1 execute webapp-production --local --persist-to ${persist} --json --command "SELECT req FROM st_jobs WHERE slot='${br.slot}' AND phase='gen' ORDER BY created_at DESC LIMIT 1"`, { cwd: ROOT }).toString()
      ok('重拍请求含驳回约束 + 上一段尾帧', jobs.includes('hero 的发型不对') && jobs.includes('first_frame_key'))
      await wri('POST', `/api/projects/${p4}/steps/8`, { submit: true }); r = await rev('POST', `/api/projects/${p4}/steps/8/approve`); ok('分支审批通过', r.json?.next === 9)
      r = await wri('POST', `/api/projects/${p4}/steps/9`, { submit: true }); ok('一致性检测提交（汇总衔接分）', r.status === 200)
      r = await rev('POST', `/api/projects/${p4}/steps/9/approve`); ok('一致性检测通过 → 解锁第 10 步', r.json?.next === 10)
      // 依赖传播：退回第 6 步重画一个角色 → 重新通过后，用到该角色的视频全部变 stale
      const m7 = (await wri('GET', `/api/projects/${p4}/media/7`)).json, dep = m7.slots.flatMap((x) => x.deps).find((d) => d.startsWith('6:')).slice(2)
      await wri('POST', `/api/projects/${p4}/steps/6/reopen`, { note: '换演员' })
      const unused = ['cast.hero', 'cast.boss'].find((c) => !m7.slots.some((x) => x.deps.includes('6:' + c)))
      r = await wri('POST', `/api/projects/${p4}/media/6/run`, { only: [dep] }); await wait(6, (d) => d.slots.find((x) => x.slot === dep).attempts === 2 && d.slots.find((x) => x.slot === dep).status === 'ok')
      await wri('POST', `/api/projects/${p4}/steps/6`, { submit: true }); await rev('POST', `/api/projects/${p4}/steps/6/approve`)
      m = (await wri('GET', `/api/projects/${p4}/media/7`)).json
      ok('换设定图 → 用到该角色的视频变 stale（需重拍）', m.slots.filter((x) => x.deps.includes('6:' + dep)).every((x) => x.status === 'stale') && m.slots.some((x) => x.status === 'stale'), JSON.stringify(m.slots.map((x) => [x.slot, x.status, x.deps])))
      ok('没用到该角色的视频不受影响', m.slots.filter((x) => !x.deps.includes('6:' + dep)).every((x) => x.status === 'ok'))
      void unused
    } finally { try { process.kill(-node.pid) } catch {} }
  }

  // 5 Key 加密与不外泄
  r = await A('POST', '/api/providers', { name: '测试中转站', kind: 'ark_video', base_url: 'https://relay.example.com', key: SECRET }); const prov = r.json?.id; ok('保存供应商 Key', r.status === 200 && !!prov, JSON.stringify(r.json))
  r = await A('GET', '/api/config'); const p = (r.json?.providers || []).find((x) => x.id === prov)
  ok('配置返回 key_hint 而非明文', !!p && p.key_hint && !String(p.key_hint).includes(SECRET.slice(6, 20)), p?.key_hint)
  r = await A('POST', '/api/providers', { name: 'http', kind: 'openai_compat', base_url: 'http://insecure.example.com', key: 'k' }); ok('非 https base_url 被拒', r.status === 400)
  await A('GET', '/api/audit'); await A('GET', '/api/runs'); await A('GET', `/api/projects/${pid}`)
  const leaked = allText.some((t) => t.includes(SECRET))
  ok('全部 API 响应中无 Key 明文', !leaked)
  const dbDump = execSync(`npx wrangler d1 execute webapp-production --local --persist-to ${persist} --json --command "SELECT key_enc, key_iv, key_hint FROM st_providers WHERE id='${prov}'"`, { cwd: ROOT }).toString()
  ok('数据库中存的是密文', !dbDump.includes(SECRET) && /key_enc/.test(dbDump))
  r = await A('POST', `/api/providers/${prov}/delete`); ok('删除未被引用的供应商', r.status === 200)

  // 6 登录锁定（独立 IP，避免影响其他账号）
  const brute = client('10.9.9.9'); let last
  for (let i = 0; i < 8; i++) last = await brute('POST', '/api/auth/login', { email: 'rev@momo.test', password: 'wrong-password-' + i })
  ok('连续错误密码返回 401', last.status === 401)
  r = await brute('POST', '/api/auth/login', { email: 'rev@momo.test', password: 'Review-Pass-2026!' }); ok('第 9 次（即使密码正确）被锁 429', r.status === 429)

  // 7 登出后会话失效
  await rev('POST', '/api/auth/logout'); r = await rev('GET', '/api/projects'); ok('登出后 401', r.status === 401)
  // 8 停用账号 → 会话立即失效
  const uid = (await A('GET', '/api/users')).json.find((u) => u.email === 'wri@momo.test').id
  await A('POST', `/api/users/${uid}`, { disabled: true }); r = await wri('GET', '/api/projects'); ok('停用账号后会话立即失效', r.status === 401)
  r = await A('POST', `/api/users/${(await A('GET', '/api/users')).json.find((u) => u.role === 'admin').id}`, { disabled: true }); ok('管理员不能停用自己', r.status === 409)
} catch (e) { fail++; console.error('❌ 异常', e) }
finally { stop() }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
