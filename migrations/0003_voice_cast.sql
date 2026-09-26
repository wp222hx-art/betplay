-- 角色声线配置（覆盖 scripts/comic/cast.json 的默认值）+ 自定义音色库（声音设计 / 复刻）
CREATE TABLE IF NOT EXISTS voice_cast (
  name TEXT PRIMARY KEY,        -- 角色名
  config TEXT NOT NULL,         -- JSON: qwen_voice / qwen_persona / fx_preset / color ...
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS voice_custom (
  voice_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- design / clone
  label TEXT,
  prompt TEXT,
  target_model TEXT,
  owner TEXT,                   -- 为哪个角色设计
  created_at INTEGER
);
