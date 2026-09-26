-- 古籍诗册数据库 (Cloudflare D1 Schema)

CREATE TABLE IF NOT EXISTS poems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT DEFAULT '墨瀾',
  lines TEXT NOT NULL,
  date TEXT NOT NULL,
  lunar_date TEXT,
  place TEXT,
  note TEXT,
  signature TEXT DEFAULT 'season',
  seal_img TEXT DEFAULT 'assets/seal.png',
  sort_order INTEGER DEFAULT 0,
  is_published INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS book_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 初始化书册配置
INSERT OR IGNORE INTO book_config (key, value) VALUES
  ('title', '墨瀾詩草'),
  ('subTitle', '甲辰首編'),
  ('titleSlip', '墨瀾詩草'),
  ('author', '墨瀾 · 著'),
  ('signature', 'season'),
  ('colophon', '["此冊皆墨瀾居士手書雜律，歲次丙午秋月刊行。","仿古宋槧，烏絲雙欄，字遵仲春聚珍仿宋之體。"]');

-- 初始化经典诗作与用户诗作（消除所有无意义圆圈占位符）
INSERT OR IGNORE INTO poems (id, title, author, lines, date, place, note, signature, sort_order) VALUES
  (1, '静夜思', '李白', '["床前明月光，","疑是地上霜。","举头望明月，","低头思故乡。"]', '2023-09-29', '洛阳', '客居他乡，见月思归。', 'season', 1),
  (2, '水调歌头', '苏轼', '["明月几时有？把酒问青天。","不知天上宫阙，今夕是何年。","我欲乘风归去，又恐琼楼玉宇，高处不胜寒。","起舞弄清影，何似在人间。","转朱阁，低绮户，照无眠。","不应有恨，何事长向别时圆？","人有悲欢离合，月有阴晴圆缺，此事古难全。","但愿人长久，千里共婵娟。"]', '2024-09-17', '密州', '丙辰中秋，欢饮达旦，大醉，作此篇，兼怀子由。', 'full', 2),
  (3, '山居秋暝', '王维', '["空山新雨后，天气晚来秋。","明月松间照，清泉石上流。","竹喧归浣女，莲动下渔舟。","随意春芳歇，王孙自可留。"]', '2025-08-23', '辋川', '秋暮山居，偶得清兴。', 'season', 3),
  (4, '锦瑟', '李商隐', '["锦瑟无端五十弦，一弦一柱思华年。","庄生晓梦迷蝴蝶，望帝春心托杜鹃。","沧海月明珠有泪，蓝田日暖玉生烟。","此情可待成追忆，只是当时已惘然。"]', '2026-03-15', '长安', '追忆生平，抚瑟长叹。', 'season', 4),
  (5, '旧颜', '墨瀾', '["竹影簌簌金绿碎，明月皎皎照人归。","足音泠泠伴流水，心弦颤颤诉与谁？","侧畔忽闻同笑语，方知今夕不复寒。","且行且揽清秋月，流光但洗旧时颜。"]', '2026-09-25', '竹径', '丙午清秋之夕，月明如练。独行竹径，竹影筛金，足音清泠，溪流有声。初有落落孤怀，忽闻故人同声笑语，寒意立散，始觉清光可揽、今夕可亲。岁月迁流，容颜虽旧，心境常新。因拈此律，以识今夕。', 'season', 5);
