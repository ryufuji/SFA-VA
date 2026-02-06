-- 基本的なサンプルデータ

-- メンバー
INSERT OR IGNORE INTO members (id, name, email, default_unit_price, status) VALUES 
  (1, '田中太郎', 'tanaka@valuearchs.com', 600000, 'active'),
  (2, '佐藤花子', 'sato@valuearchs.com', 700000, 'active'),
  (3, '鈴木次郎', 'suzuki@valuearchs.com', 550000, 'active');

-- リード
INSERT OR IGNORE INTO leads (id, company_name, contact_person, email, phone, status) VALUES 
  (1, '株式会社テクノロジー', '山田太郎', 'yamada@techno.co.jp', '03-1234-5678', 'active'),
  (2, '株式会社グローバル商事', '佐藤花子', 'sato@global.com', '03-2345-6789', 'active'),
  (3, '合同会社イノベーション', '鈴木一郎', 'suzuki@innov.jp', '03-3456-7890', 'active');

-- 案件
INSERT OR IGNORE INTO projects (id, lead_id, project_name, status) VALUES 
  (1, 1, 'システム開発プロジェクトA', 'won'),
  (2, 1, '保守運用案件B', 'active'),
  (3, 2, 'Webサイト制作案件', 'won');

-- 契約
INSERT OR IGNORE INTO contracts (id, project_id, contract_name, contract_start_date, contract_end_date, contract_amount, tax_rate, status) VALUES 
  (1, 1, '2026年Q1 開発契約', '2026-01-01', '2026-03-31', 3000000, 10.0, 'active'),
  (2, 2, '保守運用契約', '2026-01-01', '2026-06-30', 3000000, 10.0, 'active'),
  (3, 3, 'Web制作契約', '2025-12-01', '2026-02-28', 3000000, 10.0, 'completed');

-- 月次明細
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, billing_status, payment_status) VALUES 
  (1, 1, '2026-01', 1000000, 1100000, '検収済', '請求済', '入金完了'),
  (2, 1, '2026-02', 1000000, 1100000, '検収済', '請求済', '部分入金'),
  (3, 1, '2026-03', 1000000, 1100000, '検収中', '未請求', '未入金'),
  (4, 2, '2026-01', 500000, 550000, '検収済', '請求済', '入金完了'),
  (5, 2, '2026-02', 500000, 550000, '検収中', '未請求', '未入金');

-- 契約メンバーアサイン
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (1, 1, 60.0, 600000),
  (1, 2, 40.0, 700000),
  (2, 3, 100.0, 500000);

-- 入金履歴
INSERT OR IGNORE INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note) VALUES 
  (1, '2026-02-28', 1000000, '全額入金'),
  (2, '2026-03-15', 500000, '第1回入金'),
  (4, '2026-02-28', 500000, '保守費用入金');

-- 自社情報
INSERT OR REPLACE INTO company_info (id, company_name, postal_code, address, registration_number, updated_at) VALUES 
  (1, 'VALUE ARCHITECTS株式会社', '1410022', '東京都品川区東五反田3-17-21 ダモビル 401', 'T6011001108247', datetime('now'));

-- ユーザー（管理者）
-- パスワード: va1234
INSERT OR IGNORE INTO users (id, email, password_hash, role, is_active, member_id) VALUES 
  (1, 'admin@system.local', '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'admin', 1, NULL);

-- ユーザー（一般メンバー）
-- パスワード: va1234
INSERT OR IGNORE INTO users (email, password_hash, role, is_active, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', 1, id
FROM members
WHERE status = 'active';
