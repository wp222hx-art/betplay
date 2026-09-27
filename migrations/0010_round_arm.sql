-- 押注窗口从“玩家真正看到抉择面板”开始计时（之前从开局算起，被片段播放时长吃掉）
ALTER TABLE comic_rounds ADD COLUMN armed_at INTEGER;
