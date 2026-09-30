-- 模型接入监控：连通测试 / 心跳探测记录（每个服务商的可用性、延迟、余额、可用模型数）
CREATE TABLE IF NOT EXISTS st_provider_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- test（手动连通测试）/ beat（自动心跳）
  ok INTEGER NOT NULL,
  ms INTEGER,
  note TEXT,
  balance REAL,
  currency TEXT,
  models INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_checks_pv ON st_provider_checks(provider_id, at);
