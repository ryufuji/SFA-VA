-- 案件テーブルに営業担当を追加
ALTER TABLE projects ADD COLUMN sales_rep_id INTEGER REFERENCES members(id);

-- インデックスを追加
CREATE INDEX IF NOT EXISTS idx_projects_sales_rep_id ON projects(sales_rep_id);
