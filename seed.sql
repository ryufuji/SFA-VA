-- サンプルデータ (開発・テスト用)

-- リードのサンプルデータ
INSERT OR IGNORE INTO leads (id, company_name, contact_person, email, phone, status) VALUES 
  (1, '株式会社サンプル', '山田太郎', 'yamada@example.com', '03-1234-5678', 'active'),
  (2, '株式会社テスト商事', '佐藤花子', 'sato@test.com', '03-2345-6789', 'active'),
  (3, '合同会社デモ', '鈴木一郎', 'suzuki@demo.co.jp', '03-3456-7890', 'active');

-- 案件のサンプルデータ
INSERT OR IGNORE INTO projects (id, lead_id, project_name, status) VALUES 
  (1, 1, 'システム開発案件A', 'won'),
  (2, 1, '保守運用案件B', 'active'),
  (3, 2, 'Webサイト制作案件', 'won');

-- 契約のサンプルデータ
INSERT OR IGNORE INTO contracts (id, project_id, contract_name, contract_start_date, contract_end_date, contract_amount, status) VALUES 
  (1, 1, 'Q1 2026 契約', '2026-01-01', '2026-03-31', 3000000, 'active'),
  (2, 1, 'Q2 2026 契約', '2026-04-01', '2026-06-30', 3000000, 'active'),
  (3, 3, '単月契約 2026-01', '2026-01-01', '2026-01-31', 1000000, 'active');

-- 月次明細のサンプルデータ (契約1: Q1 2026)
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, inspection_status, inspection_date, billing_status, billing_date, invoice_number, payment_status, total_payment_amount) VALUES 
  (1, 1, '2026-01', 1000000, '検収済', '2026-01-31', '請求済', '2026-02-05', 'INV-2026-001', '入金完了', 1000000),
  (2, 1, '2026-02', 1000000, '検収済', '2026-02-28', '請求済', '2026-03-05', 'INV-2026-002', '部分入金', 500000),
  (3, 1, '2026-03', 1000000, '未検収', NULL, '未請求', NULL, NULL, '未入金', 0);

-- 月次明細のサンプルデータ (契約2: Q2 2026)
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, inspection_status, billing_status, payment_status) VALUES 
  (4, 2, '2026-04', 1000000, '未検収', '未請求', '未入金'),
  (5, 2, '2026-05', 1000000, '未検収', '未請求', '未入金'),
  (6, 2, '2026-06', 1000000, '未検収', '未請求', '未入金');

-- 月次明細のサンプルデータ (契約3: 単月)
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, inspection_status, billing_status, payment_status) VALUES 
  (7, 3, '2026-01', 1000000, '検収済', '請求済', '未入金');

-- 入金履歴のサンプルデータ
INSERT OR IGNORE INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by) VALUES 
  (1, '2026-02-28', 1000000, '全額入金', '管理者'),
  (2, '2026-03-15', 500000, '第1回入金', '管理者');

-- メンバーのサンプルデータ
INSERT OR IGNORE INTO members (id, name, email, default_unit_price, status) VALUES 
  (1, '田中太郎', 'tanaka@company.com', 600000, 'active'),
  (2, '佐藤花子', 'sato@company.com', 500000, 'active'),
  (3, '鈴木次郎', 'suzuki@company.com', 550000, 'active');

-- 契約メンバーアサインのサンプルデータ (契約1)
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (1, 1, 60.0, 600000),
  (1, 2, 40.0, 500000);

-- 契約メンバーアサインのサンプルデータ (契約2)
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (2, 1, 50.0, 600000),
  (2, 3, 50.0, 550000);

-- ステータス変更履歴のサンプルデータ
INSERT OR IGNORE INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES 
  ('monthly_details', 1, 'inspection_status', '未検収', '検収済', '顧客から検収書を受領', '管理者'),
  ('monthly_details', 1, 'billing_status', '未請求', '請求済', '請求書を発行', '管理者'),
  ('monthly_details', 2, 'inspection_status', '未検収', '検収済', '検収完了', '管理者');
