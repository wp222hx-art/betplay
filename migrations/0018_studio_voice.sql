-- Studio 配音：每节点每句台词一条 TTS 音频（R2），按 (角色音色 + 台词 + 风格) 指纹去重；剧本改了自动过期
CREATE TABLE IF NOT EXISTS st_voice_lines (
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  idx INTEGER NOT NULL,            -- 节点内第几句（按 beats 顺序，仅含台词）
  who TEXT,                        -- 角色 id
  text TEXT NOT NULL,
  voice TEXT,                      -- 音色 id
  style TEXT,                      -- 风格指令（自然语言）
  hash TEXT NOT NULL,              -- 指纹：voice + text + style + model
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed')),
  media_key TEXT,                  -- R2：studio/<pid>/voice/<node>_<idx>_<hash>.wav
  dur REAL,                        -- 秒
  error TEXT,
  run_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, node_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_voice_project ON st_voice_lines(project_id);
