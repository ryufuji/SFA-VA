-- Migration: 月次明細に備考（notes）カラムを追加
-- Date: 2026-01-08

ALTER TABLE monthly_details ADD COLUMN notes TEXT;
