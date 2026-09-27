-- 命运等级：按本局押注额度与输赢，结局升级为 黄金 / 白金 / 钻石（奖池分红 + 彩蛋片段 + 高阶结局卡）
ALTER TABLE comic_runs ADD COLUMN staked INTEGER DEFAULT 0;
ALTER TABLE comic_runs ADD COLUMN tier TEXT;            -- null / gold / platinum / diamond
ALTER TABLE comic_runs ADD COLUMN bonus INTEGER DEFAULT 0;
ALTER TABLE ending_cards ADD COLUMN tier TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_tier ON comic_runs(series_id, tier);
