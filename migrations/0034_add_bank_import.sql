-- Migration: 振込明細アップロード・自動突合
-- Description: 取込バッチIDと、振込人名 → リード（取引先）の対応を覚えるテーブルを追加

-- 1. どのアップロードで取り込んだ入金かを記録
ALTER TABLE bank_deposits ADD COLUMN import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bank_deposits_import_batch ON bank_deposits(import_batch_id);

-- 2. 振込人名とリードの対応（突合を確定するたびに学習し、次回から自動で当たる）
CREATE TABLE IF NOT EXISTS payer_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payer_key TEXT NOT NULL UNIQUE,     -- 表記ゆれを吸収した照合用の振込人名
  payer_name TEXT NOT NULL,           -- 元の振込人名（表示用）
  lead_id INTEGER NOT NULL,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_payer_aliases_lead_id ON payer_aliases(lead_id);
