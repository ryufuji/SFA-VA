-- 案件に見込み月額カラムを追加
ALTER TABLE projects ADD COLUMN expected_monthly_amount INTEGER DEFAULT 0;
