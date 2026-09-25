// Agent-1 · 示范剧《天台》蓝图 → D1 播种（幂等）
import content from './seed-content.json'
import { uid } from './crypto'

type Env = { DB: D1Database }

export const DEMO_SERIES = 'rooftop'

const CASH = [
  {
    id: 'C1', after: 'S1', question: '林夏会把U盘交给陈默吗？',
    outcomes: [
      ['give', '交出U盘', 0.45, 'trust'],
      ['betray', '转身交给渡鸦', 0.4, 'betray'],
      ['drop', '把U盘扔下天台', 0.15, 'sacrifice']
    ]
  },
  {
    id: 'C2', after: 'S2', question: '他们会走哪条路逃生？',
    outcomes: [
      ['elevator', '电梯遭伏击', 0.4, 'risk'],
      ['stairs', '消防梯脱身', 0.35, 'escape'],
      ['trapped', '被困38层', 0.25, 'trapped']
    ]
  },
  {
    id: 'C3', after: 'S3', question: '陈默会扣下扳机吗？',
    outcomes: [
      ['shoot', '开枪', 0.35, 'violence'],
      ['lower', '放下枪', 0.45, 'mercy'],
      ['together', '同归于尽', 0.2, 'sacrifice']
    ]
  }
] as const

const BIBLE = {
  era: '近未来雨夜都市·穹顶财团统治',
  rules: ['U盘记录穹顶财团罪证', '渡鸦是财团杀手，只听命于穹顶', '故事发生在一夜之间，黎明前必须结束'],
  characters: {
    林夏: { trait: '冷静的数据掮客', bottom_line: '绝不伤害妹妹林小雨' },
    陈默: { trait: '隐忍的前搭档警探', bottom_line: '欠林夏一条命，不会先对她开枪' },
    渡鸦: { trait: '冷酷杀手', bottom_line: '不会放过目击者' },
    林小雨: { trait: '林夏的妹妹，只通过电话出现', bottom_line: '不出现在天台' }
  },
  forbidden: ['真实人物', '血腥特写', '未成年受伤'],
  convergence_k: 3
}

export async function ensureSeed(env: Env) {
  const has = await env.DB.prepare('SELECT id FROM series WHERE id=?').bind(DEMO_SERIES).first()
  if (has) return false
  const c: any = content
  const stmts: D1PreparedStatement[] = []
  stmts.push(
    env.DB.prepare('INSERT INTO series (id,title,logline,world_bible,poem) VALUES (?,?,?,?,?)').bind(
      DEMO_SERIES, '天台', '雨夜38层，一枚U盘，三次抉择——你押谁的命运？', JSON.stringify(BIBLE),
      '三十八层雨未歇，一枚孤证系生灭。\n你押人心向何处，天台风起已先决。'
    )
  )
  let ord = 0
  for (const cash of CASH) {
    const scene = c.scenes[cash.after]
    stmts.push(
      env.DB.prepare('INSERT INTO nodes (id,series_id,kind,ord,title,lines) VALUES (?,?,?,?,?,?)').bind(
        cash.after, DEMO_SERIES, 'scene', ord++, scene.title, JSON.stringify(scene.lines)
      )
    )
    const cfg = {
      window_sec: 12, odds_mode: 'fixed', arena_mode: 'parimutuel', rake: 0.08, min_bet: 10,
      rewind: { allowed: true, max_times: 2, tax: 1.5 }, currency: ['chips'], compliance: { age: 18, regions: ['GLOBAL'] }
    }
    stmts.push(
      env.DB.prepare('INSERT INTO nodes (id,series_id,kind,ord,title,question,config) VALUES (?,?,?,?,?,?,?)').bind(
        cash.id, DEMO_SERIES, 'cash', ord++, cash.question, cash.question, JSON.stringify(cfg)
      )
    )
    for (const [oid, label, w, cat] of cash.outcomes) {
      const o = c.outcomes[oid]
      stmts.push(
        env.DB.prepare('INSERT INTO outcomes (id,node_id,label,hint,story_weight,category) VALUES (?,?,?,?,?,?)').bind(
          oid, cash.id, label, o.hint, w, cat
        )
      )
      o.variants.forEach((v: any, i: number) => {
        stmts.push(
          env.DB.prepare(
            'INSERT INTO variants (id,outcome_id,title,angle,lines,shot,is_fallback,score,source) VALUES (?,?,?,?,?,?,?,?,?)'
          ).bind(`${oid}_v${i + 1}`, oid, v.title, v.angle, JSON.stringify(v.lines), v.shot, i === 2 ? 1 : 0, 78 + ((i * 7) % 12), 'seed')
        )
      })
    }
  }
  for (const [k, e] of Object.entries<any>(c.endings)) {
    stmts.push(
      env.DB.prepare('INSERT INTO nodes (id,series_id,kind,ord,title,lines) VALUES (?,?,?,?,?,?)').bind(
        'END_' + k, DEMO_SERIES, 'ending', 100, e.title, JSON.stringify([{ speaker: '旁白', text: e.epilogue, mood: '余韵' }])
      )
    )
  }
  // 全网决策信号种子（模拟外部平台竞猜/评论的决策类目分布）
  const sources = ['douyin', 'xhs', 'bilibili', 'weibo']
  const bias: Record<string, number[]> = {
    C1: [520, 610, 140], C2: [300, 420, 280], C3: [260, 380, 360]
  }
  const now = Date.now()
  for (const cash of CASH) {
    cash.outcomes.forEach(([oid, , , cat], i) => {
      sources.forEach((s, si) => {
        const base = bias[cash.id][i]
        const votes = Math.round(base * (0.6 + ((si * 37 + i * 13) % 50) / 100))
        stmts.push(
          env.DB.prepare(
            'INSERT INTO decision_signals (series_id,node_id,outcome_id,category,source,votes,created_at) VALUES (?,?,?,?,?,?,?)'
          ).bind(DEMO_SERIES, cash.id, oid, cat, s, votes, now)
        )
      })
    })
  }
  // Arena 模拟玩家
  for (let i = 0; i < 6; i++) {
    stmts.push(env.DB.prepare('INSERT INTO users (id,nickname,chips,bot) VALUES (?,?,?,1)').bind('bot_' + i, '观众' + (i + 1), 100000))
  }
  await env.DB.batch(stmts)
  await env.DB.prepare('INSERT INTO agent_runs (agent_no,action,status,detail,created_at) VALUES (1,?,?,?,?)')
    .bind('seed_blueprint', 'ok', '示范剧《天台》蓝图播种：3 场景 × 3 Cash 节点 × 9 结局簇 × 27 变体', Date.now()).run()
  return true
}

export { uid }
