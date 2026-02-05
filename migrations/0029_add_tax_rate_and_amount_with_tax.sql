-- Migration: 税率と税込み額の追加
-- Date: 2026-02-05
-- Description: 契約テーブルに税率を追加し、月次明細テーブルに税込み額を追加

-- contractsテーブルに税率カラムを追加（デフォルト10%）
ALTER TABLE contracts ADD COLUMN tax_rate REAL DEFAULT 10.0;

-- monthly_detailsテーブルに税込み額カラムを追加
ALTER TABLE monthly_details ADD COLUMN amount_with_tax INTEGER DEFAULT 0;

-- 既存データの税込み額を計算して更新（税率10%）
UPDATE monthly_details 
SET amount_with_tax = ROUND(amount * 1.1);

-- 既存の契約データに税率10%を設定
UPDATE contracts 
SET tax_rate = 10.0
WHERE tax_rate IS NULL;
