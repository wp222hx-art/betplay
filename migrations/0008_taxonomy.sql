-- 专业分类体系：形态(cat: anime/live/abstract) + 题材(genre)
ALTER TABLE studio_projects ADD COLUMN genre TEXT;
ALTER TABLE published_series ADD COLUMN genre TEXT;
UPDATE studio_projects SET cat = CASE cat WHEN 'love' THEN 'anime' WHEN 'film' THEN 'live' ELSE cat END;
UPDATE published_series SET cat = CASE cat WHEN 'love' THEN 'anime' WHEN 'film' THEN 'live' ELSE cat END;
CREATE INDEX IF NOT EXISTS idx_pub_cat ON published_series(cat, genre);
