-- 検収日（acceptance_date）カラム追加
-- 対象月の月末日を自動登録（例: target_month='2026-03' → acceptance_date='2026-03-31'）

ALTER TABLE monthly_details ADD COLUMN acceptance_date DATE;

-- 既存データを一括更新：target_month の月末日を計算して設定
UPDATE monthly_details
SET acceptance_date = DATE(
  SUBSTR(target_month, 1, 4) || '-' ||
  SUBSTR(target_month, 6, 2) || '-01',
  '+1 month', '-1 day'
);
