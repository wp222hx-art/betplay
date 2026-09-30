-- Studio P5：第 10 步预检 · 上架 —— 不可变版本快照（st_releases）+ 打包任务（st_jobs.phase='pack'）
-- 1) st_jobs 增加 pack 阶段（SQLite 不能改 CHECK → 重建表）
CREATE TABLE IF NOT EXISTS st_jobs_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  slot TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('gen','post','seam','pack')),
  route TEXT NOT NULL CHECK (route IN ('direct','node')),
  agent TEXT, provider_id TEXT, provider_kind TEXT, model TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  req TEXT NOT NULL,
  task_id TEXT,
  result TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  cost REAL NOT NULL DEFAULT 0,
  claimed_by TEXT, claimed_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO st_jobs_v2 (id,project_id,step,slot,phase,route,agent,provider_id,provider_kind,model,status,req,task_id,result,error,attempt,cost,claimed_by,claimed_at,created_at,updated_at)
  SELECT id,project_id,step,slot,phase,route,agent,provider_id,provider_kind,model,status,req,task_id,result,error,attempt,cost,claimed_by,claimed_at,created_at,updated_at FROM st_jobs;
DROP TABLE st_jobs;
ALTER TABLE st_jobs_v2 RENAME TO st_jobs;
CREATE INDEX IF NOT EXISTS idx_st_jobs_status ON st_jobs(status, route, phase);
CREATE INDEX IF NOT EXISTS idx_st_jobs_proj ON st_jobs(project_id, step, slot);

-- 2) 版本快照：每次「打包」生成一个新版本；审核通过 = 发布到玩家端（published_series）
CREATE TABLE IF NOT EXISTS st_releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  series_id TEXT NOT NULL,          -- 玩家端作品 id（ms_xxxx）
  version INTEGER NOT NULL,         -- 本作品第几版（媒体文件名带版本号，旧版素材永不覆盖 → 可回滚）
  status TEXT NOT NULL,             -- packing | ready | failed | published | superseded | canceled
  src_hash TEXT,                    -- 编译指纹：上游（结构图 / 剧本 / 素材）变了 → 必须重新打包
  plan TEXT,                        -- 编译计划（片段 = 哪些节点视频拼接而成）
  data TEXT,                        -- 玩家端引擎 DATA（打包完成后生成，之后不可变）
  meta TEXT,                        -- 上架信息（标题 / 简介 / 题材 / 受众 / 分级 / 角标 / 标签）
  checks TEXT,                      -- 预检 + 合规审核结果
  stats TEXT,                       -- 片段数 / 结局数 / 总时长 / 路径数
  job_id TEXT,
  error TEXT,
  created_by TEXT, created_at INTEGER NOT NULL,
  published_by TEXT, published_at INTEGER,
  UNIQUE (series_id, version)
);
CREATE INDEX IF NOT EXISTS idx_st_rel_proj ON st_releases(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_st_rel_series ON st_releases(series_id, version);
