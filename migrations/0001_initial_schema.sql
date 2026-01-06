-- SFA Initial Schema
-- リード、案件、契約、月次明細、メンバー、アサインのテーブル定義

-- ========================================
-- 1. リードテーブル
-- ========================================
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_company_name ON leads(company_name);

-- ========================================
-- 2. 案件テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'won', 'lost', 'archived')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX idx_projects_lead_id ON projects(lead_id);
CREATE INDEX idx_projects_status ON projects(status);

-- ========================================
-- 3. 契約テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  contract_name TEXT NOT NULL,
  contract_start_date DATE NOT NULL,
  contract_end_date DATE NOT NULL,
  contract_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'terminated')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_contracts_project_id ON contracts(project_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_dates ON contracts(contract_start_date, contract_end_date);

-- ========================================
-- 4. 月次明細テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS monthly_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  target_month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  inspection_status TEXT NOT NULL DEFAULT '未検収' CHECK(inspection_status IN ('未検収', '検収済')),
  inspection_date DATE,
  billing_status TEXT NOT NULL DEFAULT '未請求' CHECK(billing_status IN ('未請求', '請求済')),
  billing_date DATE,
  invoice_number TEXT,
  payment_status TEXT NOT NULL DEFAULT '未入金' CHECK(payment_status IN ('未入金', '部分入金', '入金完了')),
  payment_date DATE,
  total_payment_amount INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

CREATE INDEX idx_monthly_details_contract_id ON monthly_details(contract_id);
CREATE INDEX idx_monthly_details_target_month ON monthly_details(target_month);
CREATE INDEX idx_monthly_details_inspection_status ON monthly_details(inspection_status);
CREATE INDEX idx_monthly_details_billing_status ON monthly_details(billing_status);
CREATE INDEX idx_monthly_details_payment_status ON monthly_details(payment_status);

-- ========================================
-- 5. 入金履歴テーブル (分割入金対応)
-- ========================================
CREATE TABLE IF NOT EXISTS payment_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monthly_detail_id INTEGER NOT NULL,
  payment_date DATE NOT NULL,
  payment_amount INTEGER NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_detail_id) REFERENCES monthly_details(id)
);

CREATE INDEX idx_payment_histories_monthly_detail_id ON payment_histories(monthly_detail_id);
CREATE INDEX idx_payment_histories_payment_date ON payment_histories(payment_date);

-- ========================================
-- 6. メンバーテーブル
-- ========================================
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  default_unit_price INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_name ON members(name);

-- ========================================
-- 7. 契約メンバーアサインテーブル (Phase 1: 固定按分)
-- ========================================
CREATE TABLE IF NOT EXISTS contract_member_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  allocation_ratio REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  UNIQUE(contract_id, member_id)
);

CREATE INDEX idx_contract_member_assignments_contract_id ON contract_member_assignments(contract_id);
CREATE INDEX idx_contract_member_assignments_member_id ON contract_member_assignments(member_id);

-- ========================================
-- 8. ステータス変更履歴テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS status_change_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_status_change_histories_table_record ON status_change_histories(table_name, record_id);
CREATE INDEX idx_status_change_histories_changed_at ON status_change_histories(changed_at);

-- ========================================
-- 9. システム設定テーブル (未回答の質問対応)
-- ========================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- デフォルト設定値を挿入
INSERT OR IGNORE INTO system_settings (key, value, description) VALUES
  ('fiscal_year_start_month', '4', '会計年度開始月 (1-12)'),
  ('default_allocation_mode', 'fixed', '按分モード: fixed=固定, monthly=月次変動'),
  ('require_status_change_reason', 'rollback_only', 'ステータス変更理由: always=常に必須, rollback_only=巻き戻し時のみ, never=不要'),
  ('allow_overpayment', 'true', '過入金を許容するか: true/false'),
  ('allow_status_rollback', 'true', 'ステータス巻き戻しを許容するか: true/false');
