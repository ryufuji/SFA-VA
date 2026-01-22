-- 見積書にステータスカラムを追加
ALTER TABLE quotes ADD COLUMN status TEXT DEFAULT 'draft' 
  CHECK(status IN ('draft', 'pending', 'approved', 'rejected', 'expired'));

-- 見積書ステータス変更履歴テーブル
CREATE TABLE IF NOT EXISTS quote_status_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  comment TEXT,
  FOREIGN KEY (quote_id) REFERENCES quotes(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE INDEX idx_quote_status_changes_quote_id ON quote_status_changes(quote_id);
CREATE INDEX idx_quote_status_changes_changed_at ON quote_status_changes(changed_at);

-- 既存の見積書のステータスを'pending'に設定（承認待ち）
UPDATE quotes SET status = 'pending' WHERE status IS NULL;
