-- Migration: Add expected_payment_date to monthly_details
-- 入金予定日フィールドを追加

ALTER TABLE monthly_details ADD COLUMN expected_payment_date DATE;

-- 既存データで請求済みの明細には翌月末日を自動設定
UPDATE monthly_details
SET expected_payment_date = DATE(
  billing_date, 
  '+1 month', 
  'start of month', 
  '+1 month', 
  '-1 day'
)
WHERE billing_status = '請求済' AND billing_date IS NOT NULL;
