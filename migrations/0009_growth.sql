-- 增长实验：抽象剧拉新 → 真人剧变现
CREATE TABLE IF NOT EXISTS funnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  series TEXT,
  event TEXT NOT NULL,      -- play_start / play_end / meme_make / meme_share / ref_join / crosssell_view / crosssell_click / live_start / live_end
  src TEXT,                 -- 来源作品形态（abstract / anime / live）或 ref
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funnel_ev ON funnel_events(event, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_uid ON funnel_events(uid, event);
CREATE TABLE IF NOT EXISTS referrals (
  uid TEXT PRIMARY KEY,     -- 被邀请人（每人只能被邀请一次）
  ref_uid TEXT NOT NULL,
  series TEXT,
  rewarded INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_ref ON referrals(ref_uid, created_at);
ALTER TABLE comic_rounds ADD COLUMN contrarian INTEGER DEFAULT 0;
