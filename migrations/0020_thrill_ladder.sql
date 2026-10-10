-- 惊心 1 分钟 v2「连猜爬塔」：一局一注、累计倍率、随时落袋
ALTER TABLE thrill_runs ADD COLUMN mult REAL NOT NULL DEFAULT 1;   -- 当前累计倍率
ALTER TABLE thrill_runs ADD COLUMN end_reason TEXT;                -- miss / cashout / timeout / cap / final
-- v1 演示剧本数据结构已废弃
DELETE FROM thrill_series WHERE id='thr_demo_bomb';
