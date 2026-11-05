-- 每个用户每局只能以一个身份加入（入座 或 外围，二选一，且只一单）
CREATE UNIQUE INDEX IF NOT EXISTS idx_d13_one_role ON d13_entries(room_id, user_id);
