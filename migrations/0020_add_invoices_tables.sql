-- 請求書テーブル
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,  -- 20251225-009
  monthly_detail_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  issue_date DATE NOT NULL,
  payment_due_date DATE,
  subject TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax_rate REAL DEFAULT 10.0,
  tax INTEGER NOT NULL,
  total INTEGER NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_detail_id) REFERENCES monthly_details(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX idx_invoices_monthly_detail_id ON invoices(monthly_detail_id);
CREATE INDEX idx_invoices_lead_id ON invoices(lead_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);

-- 請求明細テーブル
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  item_description TEXT NOT NULL,      -- [2025/12/26 納品分] 対応人員：（藤本/菅原/坂井）
  quantity INTEGER DEFAULT 1,
  unit TEXT DEFAULT '式',
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
