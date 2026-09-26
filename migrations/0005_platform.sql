-- 平台层：身份与防作弊 · 结局卡与交易所 · 制作平台（剧本/渲染队列）· 审计

-- ① 身份：服务端签发的设备会话（客户端传来的 user_id 一律不再信任）
CREATE TABLE IF NOT EXISTS auth_devices (
  uid TEXT PRIMARY KEY,
  ip_hash TEXT,
  ua_hash TEXT,
  legacy INTEGER DEFAULT 0,      -- 1 = 由旧版本地 uid 认领迁移
  token_ver INTEGER DEFAULT 1,   -- 吊销：版本号 +1 即让旧 token 全部失效
  created_at INTEGER,
  last_seen INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_ip ON auth_devices(ip_hash, created_at);

-- ② 限流（滑动窗口计数器）
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- ③ 风控事件 + 封禁
CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  kind TEXT NOT NULL,            -- sybil / rate_limit / wash_trade / price_band / spoof / flip
  severity INTEGER DEFAULT 1,    -- 1 提示 2 警告 3 拦截
  detail TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_risk_uid ON risk_events(uid, created_at);
CREATE INDEX IF NOT EXISTS idx_risk_kind ON risk_events(kind, created_at);
CREATE TABLE IF NOT EXISTS user_flags (
  uid TEXT PRIMARY KEY,
  banned INTEGER DEFAULT 0,
  reason TEXT,
  updated_at INTEGER
);

-- ④ 结局卡：只在服务端通关时铸造，一局一张（run_id 唯一），带完整观看路径
CREATE TABLE IF NOT EXISTS ending_cards (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  ending_id TEXT NOT NULL,
  serial INTEGER NOT NULL,       -- 同一结局的第 N 张
  rarity TEXT NOT NULL,          -- R / SR / SSR / UR
  owner_id TEXT NOT NULL,
  minter_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,            -- 抉择路径 JSON
  playlist TEXT NOT NULL,        -- 完整观看路径（片段 id 序列）
  forked INTEGER DEFAULT 0,      -- 路径中是否含时间裂隙
  status TEXT DEFAULT 'held',    -- held / listed
  locked_until INTEGER DEFAULT 0,
  minted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON ending_cards(owner_id);
CREATE INDEX IF NOT EXISTS idx_cards_ending ON ending_cards(series_id, ending_id);

CREATE TABLE IF NOT EXISTS card_listings (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT DEFAULT 'open',    -- open / sold / cancelled
  buyer_id TEXT,
  created_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_listing_status ON card_listings(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_open ON card_listings(card_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS card_trades (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_card ON card_trades(card_id, created_at);

-- ⑤ 制作平台：项目（剧本树）→ 渲染任务队列 → 质检 → 上架
CREATE TABLE IF NOT EXISTS studio_projects (
  id TEXT PRIMARY KEY,
  kind TEXT DEFAULT 'series',    -- series / sequel
  parent TEXT,                   -- 续集：来源作品:结局
  source_item TEXT,              -- 目录概念 id
  cat TEXT,
  title TEXT,
  logline TEXT,
  status TEXT DEFAULT 'draft',   -- draft / scripted / rendering / review / published
  bible TEXT,                    -- 角色/风格圣经 JSON
  tree TEXT,                     -- 剧情树 JSON
  score REAL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  title TEXT,
  prompt TEXT,
  model TEXT DEFAULT 'seedance-2.0-mini',
  dur INTEGER DEFAULT 10,
  credits INTEGER DEFAULT 0,
  status TEXT DEFAULT 'queued',  -- queued / running / review / approved / rejected / failed
  result_url TEXT,
  qc TEXT,
  worker TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON render_jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_clip ON render_jobs(project_id, clip_id);

-- ⑥ 审计日志（管理员操作、配置变更）
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT,
  detail TEXT,
  created_at INTEGER
);
