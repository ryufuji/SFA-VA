-- 自社情報テーブル追加
CREATE TABLE IF NOT EXISTS company_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  registration_number TEXT,        -- インボイス登録番号
  bank_name TEXT,
  bank_branch TEXT,
  account_type TEXT,               -- 普通、当座 など
  account_number TEXT,
  account_holder TEXT,
  logo_r2_key TEXT,                -- R2ストレージのキー
  seal_r2_key TEXT,                -- R2ストレージのキー（会社印）
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初期データ投入
INSERT INTO company_info (
  company_name,
  postal_code,
  address,
  registration_number
) VALUES (
  'VALUE ARCHITECTS株式会社',
  '1410022',
  '東京都品川区東五反田3-17-21 ダモビル 401',
  'T6011001108247'
);
