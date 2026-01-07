-- 月次明細に名称カラムを追加
-- 例: "PF営 DVPF_202601"

ALTER TABLE monthly_details ADD COLUMN name TEXT;

-- インデックスを追加
CREATE INDEX IF NOT EXISTS idx_monthly_details_name ON monthly_details(name);
