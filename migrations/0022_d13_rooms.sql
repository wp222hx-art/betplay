-- 致命13 社交房间：13 座 · 入座参赛 / 外围下注（每人每局只能一个身份）· 开房间 · 聊天
CREATE TABLE IF NOT EXISTS d13_rooms (
  id TEXT PRIMARY KEY, code TEXT, kind TEXT NOT NULL DEFAULT 'public', host TEXT, title TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',          -- waiting → locking → playing → settling → ended
  seed TEXT NOT NULL, commit_hash TEXT NOT NULL, outcome TEXT, schedule TEXT, winner INTEGER, stats TEXT,
  created_at INTEGER NOT NULL, lock_at INTEGER NOT NULL, start_at INTEGER, end_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_d13_rooms_status ON d13_rooms(status, lock_at);
CREATE INDEX IF NOT EXISTS idx_d13_rooms_code ON d13_rooms(code);
CREATE TABLE IF NOT EXISTS d13_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT,
  role TEXT NOT NULL,                               -- seat | out
  seat INTEGER NOT NULL, pick TEXT NOT NULL, stake INTEGER NOT NULL DEFAULT 0, odds REAL NOT NULL DEFAULT 0,
  bot INTEGER NOT NULL DEFAULT 0, hit INTEGER, payout INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_d13_seat_u ON d13_entries(room_id, seat) WHERE role = 'seat';
CREATE INDEX IF NOT EXISTS idx_d13_e_room ON d13_entries(room_id);
CREATE INDEX IF NOT EXISTS idx_d13_e_user ON d13_entries(user_id, created_at);
CREATE TABLE IF NOT EXISTS d13_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, user_id TEXT, nickname TEXT, text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'msg', bot INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_d13_chat_room ON d13_chat(room_id, id);
