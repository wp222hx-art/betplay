-- 致命13 v3：前三轮一次性押注单（综合赔付）+ 每轮可追加单注（不再「押错出局」）
ALTER TABLE thrill_picks ADD COLUMN stake INTEGER NOT NULL DEFAULT 0;
