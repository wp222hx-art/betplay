// 配音（第 10 步打包前）：逐句 TTS → R2；执行节点打包时按句混入成片（压低环境音），并按真实时长回写字幕时间
//   视频模型（Wan / Seedance 等）的原生音轨基本只有环境音、几乎不说中文台词 → 台词统一由 TTS 配音，角色音色固定，全剧一致
//   服务商：TokenHot / 小米 MiMo（OpenAI 兼容 /v1/chat/completions + audio:{format,voice}；台词放 assistant，风格指令放 user）
import { HttpError, type Env, type User, audit } from './auth'
import { resolveProvider } from './agents'
import * as Media from './media'
import * as L from './ledger'
import { uid } from './sec'

const now = () => Date.now()
const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

/** MiMo 内置音色（文档：platform.xiaomimimo.com 语音合成） */
export const VOICES = [
  { id: '苏打', gender: 'male', lang: 'zh', desc: '男 · 清亮年轻' },
  { id: '白桦', gender: 'male', lang: 'zh', desc: '男 · 沉稳成熟' },
  { id: '冰糖', gender: 'female', lang: 'zh', desc: '女 · 甜亮年轻' },
  { id: '茉莉', gender: 'female', lang: 'zh', desc: '女 · 温柔知性' },
  { id: 'Milo', gender: 'male', lang: 'en', desc: 'Male · young' },
  { id: 'Dean', gender: 'male', lang: 'en', desc: 'Male · mature' },
  { id: 'Mia', gender: 'female', lang: 'en', desc: 'Female · young' },
  { id: 'Chloe', gender: 'female', lang: 'en', desc: 'Female · warm' }
]
export const TTS_MODEL = 'mimo-v2.5-tts'
const VOICE_IDS = new Set(VOICES.map((v) => v.id))

/** 从角色外貌描述推断性别 / 年龄段（look 是英文：man / woman, mid 20s / early 50s…） */
export function guessPerson(c: { look?: string; role?: string; gender?: string; age?: any }) {
  const t = `${c.gender || ''} ${c.look || ''} ${c.role || ''}`.toLowerCase()
  const female = /\b(woman|girl|female|lady|mother|wife|she)\b|女|妈|姐|妹|妻|她/.test(t)
  const m = t.match(/(early|mid|late)?\s*(\d0)s/) || t.match(/(\d{2})\s*(?:岁|years?)/)
  const age = m ? +String(m[2] || m[1]).slice(0, 2) + (m[1] === 'late' ? 7 : m[1] === 'mid' ? 4 : 0) : (+c.age || 28)
  return { female, age }
}
/** 默认选角：同性别里按年龄分配（年轻 → 清亮，≥40 → 沉稳），同性别多角色轮换，尽量不撞音色 */
export function defaultCasting(cast: any[]) {
  const used = new Map<string, number>(), out: Record<string, { voice: string; style: string }> = {}
  for (const c of cast) {
    const { female, age } = guessPerson(c)
    const pool = female ? (age >= 38 ? ['茉莉', '冰糖'] : ['冰糖', '茉莉']) : (age >= 40 ? ['白桦', '苏打'] : ['苏打', '白桦'])
    const voice = pool.slice().sort((a, b) => (used.get(a) || 0) - (used.get(b) || 0))[0]
    used.set(voice, (used.get(voice) || 0) + 1)
    out[c.id] = { voice, style: `${female ? '女' : '男'}，约 ${age} 岁，${c.role || c.name || ''}` }
  }
  return out
}

/** 一句台词的配音风格：角色设定 + 本节点情绪 + 动作（MiMo 的 user 消息：自然语言导演指令） */
export function styleFor(cast: { style: string }, mood: string, action: string) {
  return [`角色：${cast.style}`, mood && `情绪：${mood}`, action && `此刻：${action}`, '短剧对白，口语化，自然有呼吸感，不要播音腔，不要念出括号里的内容'].filter(Boolean).join('；').slice(0, 300)
}
const cleanLine = (s: string) => String(s || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim()
export const speakable = (s: string) => cleanLine(s).replace(/[.。…·\s—\-~～!！?？,，、]/g, '').length > 0

/** 设置：配音 Agent 的服务商 + 选角（存第 10 步 input.voice） */
async function cfgOf(env: Env, pid: string) {
  const s: any = await env.DB.prepare('SELECT input FROM st_steps WHERE project_id=? AND step=10').bind(pid).first()
  return (J(s?.input, {}) || {}).voice || {}
}
export async function saveConfig(env: Env, u: User, pid: string, b: any) {
  await Media.upstream(env, pid)
  const s: any = await env.DB.prepare('SELECT input FROM st_steps WHERE project_id=? AND step=10').bind(pid).first()
  const input = J(s?.input, {}) || {}, cur = input.voice || {}
  const casting = { ...(cur.casting || {}) }
  for (const [id, v] of Object.entries<any>(b.casting || {})) {
    if (v?.voice && !VOICE_IDS.has(v.voice)) throw new HttpError(400, 'BAD_VOICE', `未知音色：${v.voice}`)
    casting[id] = { voice: v?.voice || casting[id]?.voice, style: String(v?.style ?? casting[id]?.style ?? '').slice(0, 120) }
  }
  const next = { ...cur, casting, ...(b.provider_id ? { provider_id: String(b.provider_id) } : {}), ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}), ...(b.duck !== undefined ? { duck: Math.max(0, Math.min(1, +b.duck)) } : {}) }
  await env.DB.prepare('UPDATE st_steps SET input=?, updated_at=?, updated_by=? WHERE project_id=? AND step=10').bind(JSON.stringify({ ...input, voice: next }), now(), u.id, pid).run()
  await audit(env, u.id, 'voice_config', pid, next)
  return status(env, pid)
}

/** 本剧所有要配的台词（只取视频用到的节点） */
async function linesOf(env: Env, pid: string) {
  const u = await Media.upstream(env, pid), cfg = await cfgOf(env, pid)
  const cast = u.bible?.cast || [], def = defaultCasting(cast), casting: Record<string, any> = { ...def }
  for (const [k, v] of Object.entries<any>(cfg.casting || {})) casting[k] = { ...def[k], ...v }
  const out: { node: string; idx: number; who: string; text: string; voice: string; style: string; hash: string; beat: number }[] = []
  for (const n of u.graph.nodes) {
    const s = u.scripts.get(n.id); if (!s) continue
    let idx = 0
    ;(s.beats || []).forEach((b: any, bi: number) => {
      if (!b.line || !speakable(b.line)) return
      const ca = casting[b.who] || { voice: '苏打', style: '旁白' }, text = cleanLine(b.line).slice(0, 120)
      const style = styleFor(ca, s.mood || '', String(b.action || '').slice(0, 80))
      out.push({ node: n.id, idx: idx++, who: b.who, text, voice: ca.voice, style, beat: bi, hash: L.fnv(L.stable({ v: ca.voice, t: text, s: style, m: TTS_MODEL })) })
    })
  }
  return { lines: out, casting, cast, cfg }
}

export async function status(env: Env, pid: string) {
  const { lines, casting, cast, cfg } = await linesOf(env, pid)
  const rows = new Map<string, any>(((await env.DB.prepare('SELECT * FROM st_voice_lines WHERE project_id=?').bind(pid).all()).results as any[]).map((r) => [`${r.node_id}:${r.idx}`, r]))
  const items = lines.map((l) => { const r = rows.get(`${l.node}:${l.idx}`); const st = !r ? 'missing' : r.hash !== l.hash ? 'stale' : r.status; return { ...l, state: st, media: st === 'ok' ? `/m/${r.media_key}` : null, dur: st === 'ok' ? r.dur : null, error: r?.status === 'failed' ? r.error : null } })
  const n = (s: string) => items.filter((x) => x.state === s).length
  const pvs = ((await env.DB.prepare(`SELECT id,name,kind FROM st_providers WHERE enabled=1 AND kind='tokenhot'`).all()).results as any[])
  return { enabled: cfg.enabled !== false, provider_id: cfg.provider_id || pvs[0]?.id || null, providers: pvs, model: TTS_MODEL, duck: cfg.duck ?? 0.25, voices: VOICES,
    cast: cast.map((c: any) => ({ id: c.id, name: c.name, role: c.role, ...casting[c.id] })), lines: items,
    summary: { total: items.length, ok: n('ok'), missing: n('missing'), stale: n('stale'), failed: n('failed'), complete: items.length > 0 && n('ok') === items.length, seconds: +items.reduce((a, x) => a + (x.dur || 0), 0).toFixed(1) } }
}

/** 单句合成：TokenHot / MiMo（返回 base64 wav） */
export async function synth(pv: { base: string; key: string }, voice: string, style: string, text: string, signal?: AbortSignal) {
  const root = pv.base.replace(/\/v1$/, '').replace(/\/+$/, '')
  const r = await fetch(root + '/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, messages: [{ role: 'user', content: style }, { role: 'assistant', content: text }], audio: { format: 'wav', voice } }) })
  const d: any = await r.json().catch(() => ({}))
  const b64 = d.choices?.[0]?.message?.audio?.data
  if (!r.ok || !b64) throw new Error(`HTTP ${r.status}: ${d.error?.message || JSON.stringify(d).slice(0, 160)}`)
  return { b64, usage: d.usage || {} }
}
/** wav 时长（PCM：data 块字节 / 字节率）；解析失败返回 0 */
export function wavDur(buf: Uint8Array) {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let p = 12, rate = 0
    while (p + 8 <= buf.length) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]), sz = dv.getUint32(p + 4, true)
      if (id === 'fmt ') rate = dv.getUint32(p + 16, true) // byteRate（p+12 是采样率）
      if (id === 'data') return rate ? +(Math.min(sz, buf.length - p - 8) / rate).toFixed(2) : 0
      p += 8 + sz + (sz & 1)
    }
  } catch {}
  return 0
}
const b64bytes = (s: string) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }

/** 生成缺失 / 过期 / 失败的台词配音；每次调用最多 maxLines 句（避免单请求超时），前端/脚本循环续跑 */
export async function generate(env: Env, u: User, pid: string, o: { only?: string[]; force?: boolean; maxLines?: number } = {}) {
  await import('./steps').then((S) => S.assertOpen(env, pid, 10))
  const st = await status(env, pid)
  if (!st.provider_id) throw new HttpError(409, 'NO_TTS_PROVIDER', '请先在「模型配置」接入 TokenHot（配音使用 mimo-v2.5-tts）')
  const pv = await resolveProvider(env, st.provider_id)
  const todo = st.lines.filter((l) => (o.only ? o.only.includes(`${l.node}:${l.idx}`) || o.only.includes(l.node) : true) && (o.force || l.state !== 'ok')).slice(0, o.maxLines || 24)
  const done: string[] = [], failed: { id: string; error: string }[] = []
  const one = async (l: typeof todo[number]) => {
    const t0 = now(), rid = uid('run_')
    try {
      const { b64, usage } = await synth(pv, l.voice, l.style, l.text, AbortSignal.timeout(90000))
      const bytes = b64bytes(b64), key = `studio/${pid}/voice/${l.node}_${l.idx}_${l.hash}.wav`
      await env.MEDIA!.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } })
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO st_voice_lines (project_id,node_id,idx,who,text,voice,style,hash,status,media_key,dur,error,run_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(project_id,node_id,idx) DO UPDATE SET who=excluded.who,text=excluded.text,voice=excluded.voice,style=excluded.style,hash=excluded.hash,status='ok',media_key=excluded.media_key,dur=excluded.dur,error=NULL,run_id=excluded.run_id,updated_at=excluded.updated_at`)
          .bind(pid, l.node, l.idx, l.who, l.text, l.voice, l.style, l.hash, 'ok', key, wavDur(bytes), null, rid, now()),
        env.DB.prepare('INSERT INTO st_runs (id,project_id,step,agent,provider_id,model,status,latency_ms,tokens_in,tokens_out,cost,error,input,output,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(rid, pid, 10, 'VOICE', pv.id, TTS_MODEL, 'ok', now() - t0, usage.prompt_tokens || 0, usage.completion_tokens || 0, 0, null, `${l.voice}｜${l.text}`, key, now(), u.id)
      ])
      done.push(`${l.node}:${l.idx}`)
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300)
      await env.DB.prepare(`INSERT INTO st_voice_lines (project_id,node_id,idx,who,text,voice,style,hash,status,error,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,node_id,idx) DO UPDATE SET hash=excluded.hash,status='failed',error=excluded.error,updated_at=excluded.updated_at`).bind(pid, l.node, l.idx, l.who, l.text, l.voice, l.style, l.hash, 'failed', msg, now()).run()
      failed.push({ id: `${l.node}:${l.idx}`, error: msg })
    }
  }
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(one)) // 4 并发
  const after = await status(env, pid)
  return { done, failed, summary: after.summary, more: after.lines.some((l) => l.state !== 'ok' && !failed.find((f) => f.id === `${l.node}:${l.idx}`)) }
}

/** 打包用：节点 → 有序台词音频（只返回 ok 且未过期的；缺了就不配，不阻断打包） */
export async function forPack(env: Env, pid: string) {
  const st = await status(env, pid)
  if (!st.enabled) return { enabled: false, duck: st.duck, nodes: {} as Record<string, any[]> }
  const nodes: Record<string, { idx: number; beat: number; key: string; dur: number; who: string; text: string }[]> = {}
  const rows = new Map<string, any>(((await env.DB.prepare('SELECT node_id,idx,media_key,dur,hash FROM st_voice_lines WHERE project_id=? AND status=?').bind(pid, 'ok').all()).results as any[]).map((r) => [`${r.node_id}:${r.idx}`, r]))
  for (const l of st.lines) {
    const r = rows.get(`${l.node}:${l.idx}`); if (!r || r.hash !== l.hash) continue
    ;(nodes[l.node] ||= []).push({ idx: l.idx, beat: l.beat, key: r.media_key, dur: r.dur || 0, who: l.who, text: l.text })
  }
  return { enabled: true, duck: st.duck, nodes, hash: L.fnv(L.stable(Object.entries(nodes).map(([k, v]) => [k, v.map((x) => x.key)]))) }
}
