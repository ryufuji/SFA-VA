-- Migration: Add monthly member assignments table
-- 月次明細ごとにメンバーをアサインし、按分比率を管理するテーブル

-- ========================================
-- 月次メンバーアサインテーブル
-- ========================================
CREATE TABLE IF NOT EXISTS monthly_member_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monthly_detail_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  allocation_ratio REAL NOT NULL CHECK(allocation_ratio >= 0 AND allocation_ratio <= 1),
  unit_price INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_detail_id) REFERENCES monthly_details(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX idx_monthly_member_monthly_detail ON monthly_member_assignments(monthly_detail_id);
CREATE INDEX idx_monthly_member_member_id ON monthly_member_assignments(member_id);
CREATE UNIQUE INDEX idx_monthly_member_unique ON monthly_member_assignments(monthly_detail_id, member_id);
