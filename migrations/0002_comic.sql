-- 漫剧（Comic）模式：一次完整通关 = run；每个抉择点 = comic_round
CREATE TABLE IF NOT EXISTS comic_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  node_id TEXT,               -- 当前所在抉择节点
  path TEXT DEFAULT '[]',     -- 已走路径 JSON [{node, option, label, twist, mode}]
  status TEXT DEFAULT 'playing', -- playing / ended
  ending_id TEXT,
  pnl INTEGER DEFAULT 0,
  rewinds INTEGER DEFAULT 0,
  created_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comic_runs_user ON comic_runs(user_id, created_at);

CREATE TABLE IF NOT EXISTS comic_rounds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  mode TEXT DEFAULT 'normal', -- normal / binary(二选一) / plus(多一个隐藏选项)
  state TEXT NOT NULL,        -- BETTING / SETTLE / REWOUND
  seed TEXT,
  options TEXT,               -- 本局选项集合 + 抖动后权重 + 赔率 JSON
  outcome_id TEXT,
  commit_hash TEXT,
  slots TEXT,
  bet_option TEXT,
  bet_amount INTEGER DEFAULT 0,
  bet_odds REAL,
  payout INTEGER DEFAULT 0,
  rewind_no INTEGER DEFAULT 0,
  rewind_of TEXT,
  jitter REAL,
  lock_at INTEGER,
  opened_at INTEGER,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comic_rounds_node ON comic_rounds(node_id, state);
CREATE INDEX IF NOT EXISTS idx_comic_rounds_run ON comic_rounds(run_id);

-- 后台可调机制参数（抖动强度、窗口、rake、悔棋变体策略）与权重覆盖
CREATE TABLE IF NOT EXISTS comic_config (
  series_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (series_id, key)
);
