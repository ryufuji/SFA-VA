-- Phase 1: 検収ステータス削除マイグレーション
-- monthly_details テーブルから inspection_status / inspection_date 列を削除
-- inspection_manage 権限を billing_manage に変更

-- インデックス削除
DROP INDEX IF EXISTS idx_monthly_details_inspection_status;

-- inspection_status 列を削除
ALTER TABLE monthly_details DROP COLUMN inspection_status;

-- inspection_date 列を削除
ALTER TABLE monthly_details DROP COLUMN inspection_date;

-- user_permissions の inspection_manage を billing_manage に変更
UPDATE user_permissions
SET permission_name = 'billing_manage'
WHERE permission_name = 'inspection_manage';
