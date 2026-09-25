-- DreamForge · Cash 剧场 —— Agent-1 数据架构（D1 / SQLite）
-- 分层：内容域(series/nodes/outcomes/variants) · 博弈域(rounds/bets/round_events/branch_registry)
--       资金域(users/ledger) · 生产域(gen_tasks/extensions) · 监管域(decision_signals) · 运维域(agent_runs/test_reports)

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  logline TEXT,
  world_bible TEXT,            -- JSON：世界观圣经（规则/人物底线/禁区）
  poem TEXT,                   -- Agent-7 卷首诗
  status TEXT DEFAULT 'live',  -- draft/review/live/offline
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- scene / cash / ending
  ord REAL NOT NULL,
  title TEXT,
  question TEXT,               -- cash 节点问题 ≤24 字
  lines TEXT,                  -- scene 台词 JSON
  config TEXT,                 -- cash 配置 JSON：window_sec/odds_mode/rake/rewind/min_bet/compliance
  layer TEXT DEFAULT 'spine',  -- spine 主干 / flesh 血肉(AI 延展)
  status TEXT DEFAULT 'active',-- active / dormant(休眠剪枝)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nodes_series ON nodes(series_id, ord);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  hint TEXT,
  story_weight REAL NOT NULL,
  category TEXT,               -- 决策类目：trust/betray/sacrifice/escape/violence/mercy...
  poem TEXT,                   -- Agent-7 分支诗
  target_variants INTEGER DEFAULT 4
);
CREATE INDEX IF NOT EXISTS idx_outcomes_node ON outcomes(node_id);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  title TEXT,
  angle TEXT,
  lines TEXT,                  -- JSON
  shot TEXT,
  is_fallback INTEGER DEFAULT 0,
  score REAL DEFAULT 80,
  status TEXT DEFAULT 'pool',  -- pool / reserve(预备池) / review / rejected
  source TEXT DEFAULT 'seed',  -- seed / agent2 / replenish / extend
  video_model TEXT,
  video_status TEXT DEFAULT 'none', -- none / queued / running / ready / degraded / failed
  video_url TEXT,
  video_prompt TEXT,
  plays INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_variants_outcome ON variants(outcome_id, status);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT,
  chips INTEGER DEFAULT 1000,
  frozen INTEGER DEFAULT 0,
  daily_limit INTEGER DEFAULT 5000,
  self_excluded INTEGER DEFAULT 0,
  cooloff_until DATETIME,
  bot INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  mode TEXT DEFAULT 'solo',    -- solo(fixed) / arena(parimutuel)
  state TEXT NOT NULL,         -- OPEN/COMMIT/BETTING/LOCK/REVEAL/SETTLE/NEXT/VOID
  seed TEXT,                   -- SETTLE 前绝不对外
  outcome_id TEXT,
  variant_id TEXT,
  commit_hash TEXT,
  slots TEXT,                  -- 加密分片槽位（服务端私有：密钥+映射）
  odds TEXT,                   -- JSON 赔率快照
  crowd TEXT,                  -- Arena 彩池分布 JSON
  rewind_of TEXT,
  rewind_count INTEGER DEFAULT 0,
  window_sec INTEGER DEFAULT 12,
  seq INTEGER DEFAULT 0,
  opened_at INTEGER,
  lock_at INTEGER,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_rounds_node ON rounds(node_id, state);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  odds REAL,
  idem_key TEXT UNIQUE,
  status TEXT DEFAULT 'placed', -- placed/cancelled/won/lost/refunded
  payout INTEGER DEFAULT 0,
  rewind_tax REAL DEFAULT 1,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);

-- 复式记账：每笔交易 debit 总额 = credit 总额
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT NOT NULL,
  account TEXT NOT NULL,       -- user:<id>:available / user:<id>:frozen / platform:rake / platform:house / platform:faucet
  direction TEXT NOT NULL,     -- D / C
  amount INTEGER NOT NULL,
  memo TEXT,
  ref_id TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger(tx_id);

-- 事件溯源 + 哈希链存证
CREATE TABLE IF NOT EXISTS round_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  prev_hash TEXT,
  hash TEXT,
  created_at INTEGER,
  UNIQUE(round_id, seq)
);

CREATE TABLE IF NOT EXISTS branch_registry (
  user_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  seen_at INTEGER,
  PRIMARY KEY (user_id, variant_id)
);

-- 模型网关任务（统一调用契约）
CREATE TABLE IF NOT EXISTS gen_tasks (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,    -- outline/storyboard/dialogue/video/tts/review/score/poem/...
  provider TEXT,
  model TEXT,
  priority TEXT DEFAULT 'P2',
  tier TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'queued',-- queued/running/succeeded/degraded/failed/review_required
  agent_no INTEGER,
  ref_id TEXT,
  input TEXT,
  output TEXT,
  cost REAL DEFAULT 0,
  latency_ms INTEGER,
  degrade_reason TEXT,
  idem_key TEXT UNIQUE,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON gen_tasks(status, created_at);

-- WF-06 剧情延展
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  anchor_node_id TEXT,
  trigger TEXT,                -- manual / hot_branch / divergence / sequel
  candidates TEXT,             -- JSON 候选大纲 + 六维评分
  chosen INTEGER,
  status TEXT DEFAULT 'pending', -- pending / approved / rejected / written
  poem TEXT,
  created_at INTEGER
);

-- 全网决策信号（平台下注 + 外部舆情/评论竞猜 等来源的决策类目分布）
CREATE TABLE IF NOT EXISTS decision_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id TEXT,
  node_id TEXT,
  outcome_id TEXT,
  category TEXT,
  source TEXT,                 -- platform / douyin / xhs / bilibili / weibo / comments
  votes INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_signals_node ON decision_signals(node_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_no INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT,
  detail TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS test_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suite TEXT,
  passed INTEGER,
  failed INTEGER,
  detail TEXT,
  created_at INTEGER
);
