-- Add department field to leads table
ALTER TABLE leads ADD COLUMN department TEXT;

-- Add contract_type and contract_date to contracts table
ALTER TABLE contracts ADD COLUMN contract_type TEXT DEFAULT '準委任' CHECK(contract_type IN ('準委任', '請負', 'その他'));
ALTER TABLE contracts ADD COLUMN contract_date DATE;

-- Add monthly_member_assignments table (if not exists)
CREATE TABLE IF NOT EXISTS monthly_member_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monthly_detail_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  allocation_ratio REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_detail_id) REFERENCES monthly_details(id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  UNIQUE(monthly_detail_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_member_assignments_monthly_detail_id ON monthly_member_assignments(monthly_detail_id);
CREATE INDEX IF NOT EXISTS idx_monthly_member_assignments_member_id ON monthly_member_assignments(member_id);
