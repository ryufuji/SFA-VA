-- 契約テーブルに支払種別カラムを追加
ALTER TABLE contracts ADD COLUMN payment_type TEXT DEFAULT '毎月支払' CHECK(payment_type IN ('毎月支払', '初回全額支払'));

-- 既存の契約データに「毎月支払」を設定
UPDATE contracts SET payment_type = '毎月支払' WHERE payment_type IS NULL;
