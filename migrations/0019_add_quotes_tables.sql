-- 見積書テーブル
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT UNIQUE NOT NULL,   -- 20260119-002
  project_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  issue_date DATE NOT NULL,
  expiry_date DATE,
  subject TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax_rate REAL DEFAULT 10.0,
  tax INTEGER NOT NULL,
  total INTEGER NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX idx_quotes_project_id ON quotes(project_id);
CREATE INDEX idx_quotes_lead_id ON quotes(lead_id);
CREATE INDEX idx_quotes_quote_number ON quotes(quote_number);

-- 見積明細テーブル
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  member_id INTEGER,               -- 対応メンバー（NULLの場合は直接入力）
  item_description TEXT NOT NULL,  -- 品名詳細
  quantity REAL NOT NULL,          -- 数量（人月）
  unit TEXT DEFAULT '人月',        -- 単位
  unit_price INTEGER NOT NULL,     -- 単価
  amount INTEGER NOT NULL,         -- 金額
  note TEXT,                       -- 備考（例: 小林対応内容：IBMO）
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (quote_id) REFERENCES quotes(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX idx_quote_items_quote_id ON quote_items(quote_id);
