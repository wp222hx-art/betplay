-- Studio P3：节点级文档（剧本描述 / 提示词），一节点一行，支持成百上千节点、增量生成与过期检测
CREATE TABLE IF NOT EXISTS st_node_docs (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('script','prompt')),
  node_id TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON 文档
  src_hash TEXT NOT NULL,          -- 生成时依赖的上游内容指纹；与当前不一致 = 过期
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','conflict','manual')),
  review TEXT,                     -- 连贯监管 Agent 的审查结果 JSON
  version INTEGER NOT NULL DEFAULT 1,
  run_id TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (project_id, kind, node_id)
);
CREATE INDEX IF NOT EXISTS idx_st_node_docs_proj ON st_node_docs(project_id, kind);
