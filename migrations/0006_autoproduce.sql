-- 后台指挥自动生产：预算/积分核算 · 资产任务（设定图/封面）· 动态上架作品
ALTER TABLE studio_projects ADD COLUMN scale TEXT DEFAULT 'standard';
ALTER TABLE studio_projects ADD COLUMN budget INTEGER DEFAULT 0;      -- 积分预算上限（0 = 不限）
ALTER TABLE studio_projects ADD COLUMN spent INTEGER DEFAULT 0;       -- 已消耗积分
ALTER TABLE studio_projects ADD COLUMN auto INTEGER DEFAULT 0;        -- 1 = 质检通过自动审核 + 全部通过自动上架
ALTER TABLE studio_projects ADD COLUMN series_id TEXT;
ALTER TABLE studio_projects ADD COLUMN sheet_url TEXT;                -- 角色设定图（Seedance 参考图）
ALTER TABLE studio_projects ADD COLUMN cover_url TEXT;
ALTER TABLE studio_projects ADD COLUMN cast_imgs TEXT;

ALTER TABLE render_jobs ADD COLUMN kind TEXT DEFAULT 'clip';          -- sheet / cover / clip
ALTER TABLE render_jobs ADD COLUMN lines TEXT;                        -- 台词脚本（说话人+文本），用于字幕对齐
ALTER TABLE render_jobs ADD COLUMN meta TEXT;                         -- 产出：时长 / 字幕 / 海报 / 末帧
ALTER TABLE render_jobs ADD COLUMN spent INTEGER DEFAULT 0;
ALTER TABLE render_jobs ADD COLUMN attempts INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  job_id TEXT,
  kind TEXT,
  credits INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_credit_project ON credit_ledger(project_id);

CREATE TABLE IF NOT EXISTS published_series (
  id TEXT PRIMARY KEY,               -- series_id
  project_id TEXT,
  cat TEXT,
  title TEXT,
  logline TEXT,
  tags TEXT,
  cover TEXT,
  data TEXT NOT NULL,                -- 引擎 DATA（nodes / segments / cast）
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'live',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  worker TEXT PRIMARY KEY,
  balance REAL,
  running TEXT,
  seen_at INTEGER
);
