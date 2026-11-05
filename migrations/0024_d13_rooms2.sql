-- 致命13 房间：结算时刻 / 下一局指针 / 同网多号限制
ALTER TABLE d13_rooms ADD COLUMN settle_at INTEGER;
ALTER TABLE d13_rooms ADD COLUMN next_id TEXT;
ALTER TABLE d13_entries ADD COLUMN ip_hash TEXT;
