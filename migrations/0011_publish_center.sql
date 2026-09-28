-- 上架中心：审核拒绝自愈计数 / 上架元数据 / 上架审计日志
ALTER TABLE render_jobs ADD COLUMN softened INTEGER DEFAULT 0;
ALTER TABLE published_series ADD COLUMN aud TEXT DEFAULT 'all';
ALTER TABLE published_series ADD COLUMN rating TEXT DEFAULT '16';
ALTER TABLE published_series ADD COLUMN badge TEXT DEFAULT '新作';
ALTER TABLE published_series ADD COLUMN source_item TEXT;
CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id TEXT, project_id TEXT, action TEXT NOT NULL, version INTEGER,
  actor TEXT, note TEXT, checks TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_publog_series ON publish_log(series_id, created_at);
