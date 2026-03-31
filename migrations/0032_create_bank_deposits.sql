-- Migration: 入金消込機能用テーブル追加
-- Date: 2026-03-31
-- Description: 銀行入金テーブルと消込テーブルを作成

-- ========================================
-- 1. 銀行入金テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS bank_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deposit_date DATE NOT NULL,
  amount INTEGER NOT NULL,
  payer_name TEXT NOT NULL,
  note TEXT,
  remaining_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT '未消込' CHECK(status IN ('未消込', '一部消込', '消込完了')),
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bank_deposits_deposit_date ON bank_deposits(deposit_date);
CREATE INDEX idx_bank_deposits_status ON bank_deposits(status);
CREATE INDEX idx_bank_deposits_payer_name ON bank_deposits(payer_name);

-- ========================================
-- 2. 消込テーブル（銀行入金 → 月次明細の紐付け）
-- ========================================
CREATE TABLE IF NOT EXISTS deposit_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_deposit_id INTEGER NOT NULL,
  monthly_detail_id INTEGER NOT NULL,
  allocated_amount INTEGER NOT NULL,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bank_deposit_id) REFERENCES bank_deposits(id),
  FOREIGN KEY (monthly_detail_id) REFERENCES monthly_details(id)
);

CREATE INDEX idx_deposit_allocations_bank_deposit_id ON deposit_allocations(bank_deposit_id);
CREATE INDEX idx_deposit_allocations_monthly_detail_id ON deposit_allocations(monthly_detail_id);
