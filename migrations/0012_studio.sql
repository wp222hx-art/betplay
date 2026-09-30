-- MoMo Studio（生产后台）· 独立账号 / 会话 / Agent 配置中心 / 十步卡关项目 / 调用记录 / 审计
CREATE TABLE IF NOT EXISTS st_users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','writer','reviewer')),
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, disabled INTEGER DEFAULT 0,
  created_at INTEGER, last_login INTEGER
);
CREATE TABLE IF NOT EXISTS st_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
  created_at INTEGER, ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_st_sessions_user ON st_sessions(user_id);

-- 服务商：kind = openai_compat（对话）| ark_video（火山方舟 / 方舟兼容中转）| openai_video（OpenAI 风格视频中转）| jimeng_cli（经执行节点）| gsk（沙箱兜底）| mock_video
-- Key 以 AES-GCM 加密存储（STUDIO_MASTER_KEY），接口只返回 key_hint；key_env / base_env 表示引用环境变量而不入库
CREATE TABLE IF NOT EXISTS st_providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  base_url TEXT, base_env TEXT, key_enc TEXT, key_iv TEXT, key_hint TEXT, key_env TEXT,
  extra TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS st_agents (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, duty TEXT, step INTEGER, capability TEXT NOT NULL,
  provider_id TEXT, model TEXT, params TEXT, prompt TEXT, prompt_version INTEGER DEFAULT 1,
  budget INTEGER DEFAULT 0, spent REAL DEFAULT 0, unit_price REAL DEFAULT 0,
  enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, updated_at INTEGER, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS st_agent_prompts (
  agent TEXT NOT NULL, version INTEGER NOT NULL, prompt TEXT, created_at INTEGER, created_by TEXT,
  PRIMARY KEY (agent, version)
);
CREATE TABLE IF NOT EXISTS st_runs (
  id TEXT PRIMARY KEY, project_id TEXT, step INTEGER, agent TEXT, provider_id TEXT, model TEXT,
  status TEXT, latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost REAL DEFAULT 0,
  error TEXT, input TEXT, output TEXT, created_at INTEGER, created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_st_runs_project ON st_runs(project_id, created_at);

CREATE TABLE IF NOT EXISTS st_projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT, genre TEXT,
  status TEXT DEFAULT 'active', owner TEXT, series_id TEXT, created_at INTEGER, updated_at INTEGER
);
-- 步骤状态：locked / ready / running / review / done / failed / stale
CREATE TABLE IF NOT EXISTS st_steps (
  project_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL,
  input TEXT, output TEXT, note TEXT, version INTEGER DEFAULT 0, run_id TEXT,
  approved_by TEXT, approved_at INTEGER, updated_at INTEGER, updated_by TEXT,
  PRIMARY KEY (project_id, step)
);
CREATE TABLE IF NOT EXISTS st_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL, target TEXT,
  detail TEXT, ip TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_st_audit_time ON st_audit(created_at);
