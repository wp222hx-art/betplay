-- 上架目录：想看/预约（展示概念阶段用于测需求热度）
CREATE TABLE IF NOT EXISTS catalog_wish (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_wish_item ON catalog_wish(item_id);
