-- 惊心 1 分钟（Thrill 60s）：一部剧 = 5 关连续竞猜；每次开局一颗独立种子，5 关结果在开局时一次性承诺（Commit），通关后公开种子可复算
-- 注金开局一次性托管（不可反悔、不可中途撤注），连续命中按阶梯倍率赔付，5 关全中瓜分本剧奖池（Jackpot）
CREATE TABLE IF NOT EXISTS thrill_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  ip_hash TEXT,                       -- 同 IP 并发 / Jackpot 风控
  stake INTEGER NOT NULL,             -- 每关注金（开局托管 stake × 关数）
  gates INTEGER NOT NULL,
  seed TEXT NOT NULL,                 -- 服务端真随机；通关前绝不下发
  commit_hash TEXT NOT NULL,          -- sha256(seed|run|outcomes)：开局即公开
  outcomes TEXT NOT NULL,             -- 每关命中选项（JSON 数组，保密到通关）
  cfg TEXT,                           -- 开局时锁定的倍率阶梯 / 奖池参数快照（之后改配置不影响本局）
  status TEXT NOT NULL DEFAULT 'playing',   -- playing / ended
  gate INTEGER NOT NULL DEFAULT 0,    -- 当前关（0 基）
  armed_at INTEGER, lock_at INTEGER,  -- 当前关抉择窗口
  streak INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
  payout INTEGER NOT NULL DEFAULT 0,
  jackpot INTEGER NOT NULL DEFAULT 0,
  jackpot_status TEXT,                -- paid / held（风控审核中）/ released / void
  hold_reason TEXT,
  started_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_thrill_runs_user ON thrill_runs(user_id, status, started_at);
CREATE INDEX IF NOT EXISTS idx_thrill_runs_ip ON thrill_runs(ip_hash, status, started_at);
CREATE INDEX IF NOT EXISTS idx_thrill_runs_series ON thrill_runs(series_id, status, ended_at);

CREATE TABLE IF NOT EXISTS thrill_picks (
  run_id TEXT NOT NULL,
  gate INTEGER NOT NULL,
  option_id TEXT,                     -- NULL = 超时弃权（本关注金退回、连击中断）
  outcome_id TEXT NOT NULL,
  hit INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  mult REAL NOT NULL DEFAULT 0,
  payout INTEGER NOT NULL DEFAULT 0,
  picked_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, gate)
);

-- 每关结果片段的等长密文（真 + 诱饵），揭晓时只下发命中片段的密钥
CREATE TABLE IF NOT EXISTS thrill_gate_slots (
  run_id TEXT NOT NULL,
  gate INTEGER NOT NULL,
  slots TEXT NOT NULL,
  PRIMARY KEY (run_id, gate)
);

-- 惊心 1 分钟剧本库（独立于 published_series：DATA 结构不同，不进入普通分支剧目录）
-- status: draft（制作中，不可玩）/ demo（占位素材演示）/ live / offline
CREATE TABLE IF NOT EXISTS thrill_series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  logline TEXT,
  tension INTEGER DEFAULT 3,          -- 紧张度 1~5（板块按紧张度排序）
  cover TEXT,
  data TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft',
  created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_thrill_series_status ON thrill_series(status, tension);
