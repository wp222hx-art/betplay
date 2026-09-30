-- 剧本评审：合理性（logic 0–10）+ 吸引力指数（appeal 0–100，七维加权）
CREATE TABLE IF NOT EXISTS st_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  logic REAL, appeal INTEGER,
  dims TEXT, issues TEXT, suggestions TEXT, highlights TEXT,
  verdict TEXT, hook TEXT, sim TEXT,
  run_id TEXT, created_by TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_reviews ON st_reviews(project_id, created_at);
