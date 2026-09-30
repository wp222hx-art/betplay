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
  await wri('POST', `/api/projects/${pid}/steps/3`, { output: { nodes: [1] }, submit: true })
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
