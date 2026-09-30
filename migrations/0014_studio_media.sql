-- Studio P4：素材槽位（每个交付物一行）/ 生成尝试 / 执行节点
-- 槽位：第 6 步 cast.<id> / cover；第 7 步主线节点；第 8 步分支节点
CREATE TABLE IF NOT EXISTS st_slots (
  project_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|blocked|queued|running|post|checking|ok|qc_fail|failed|stale|deferred
  job_id TEXT,                              -- 当前尝试
  attempts INTEGER NOT NULL DEFAULT 0,
  media_key TEXT, thumb_key TEXT, first_key TEXT, last_key TEXT, poster_key TEXT,
  src_hash TEXT,                            -- 依赖指纹（提示词 / 设定图 / 上一段尾帧），变化即 stale
  qc TEXT,                                  -- 质检结果 JSON（确定性指标 + 视觉 Agent）
  accepted_by TEXT,                         -- 人工放行
  note TEXT,
  override TEXT,                            -- 审核拒绝后改写的提示词 / 质检失败后的追加约束
  cost REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, step, slot)
);
CREATE TABLE IF NOT EXISTS st_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  slot TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('gen','post','seam')),
  route TEXT NOT NULL CHECK (route IN ('direct','node')),   -- direct = Worker 直连服务商；node = 执行节点
  agent TEXT, provider_id TEXT, provider_kind TEXT, model TEXT,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|claimed|submitted|running|succeeded|failed|canceled
  req TEXT NOT NULL,                        -- 请求 JSON
  task_id TEXT,                             -- 服务商任务号
  result TEXT,                              -- 结果 JSON
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  cost REAL NOT NULL DEFAULT 0,
  claimed_by TEXT, claimed_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_jobs_status ON st_jobs(status, route, phase);
CREATE INDEX IF NOT EXISTS idx_st_jobs_proj ON st_jobs(project_id, step, slot);
CREATE TABLE IF NOT EXISTS st_exec_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kinds TEXT,                                -- 节点声明的能力 JSON：["gsk","jimeng_cli","mock","post"]
  info TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen INTEGER,
  created_at INTEGER NOT NULL, created_by TEXT
);
CREATE TABLE IF NOT EXISTS st_settings (k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER);
