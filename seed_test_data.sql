-- =====================================================
-- 入金消込テスト用データ
-- =====================================================

-- 1. リード（取引先企業）
INSERT INTO leads (id, company_name, contact_person, email, phone, status, department) VALUES
  (101, '株式会社テクノソリューション', '山田一郎', 'yamada@techno-sol.co.jp', '03-1234-5678', 'active', 'IT事業部'),
  (102, '合同会社クリエイトワークス', '佐々木恵', 'sasaki@create-works.jp', '06-9876-5432', 'active', '開発部'),
  (103, 'グローバルシステムズ株式会社', '中村健太', 'nakamura@global-sys.co.jp', '045-111-2222', 'active', 'システム開発課');

-- 2. 案件
INSERT INTO projects (id, lead_id, project_name, status) VALUES
  (201, 101, '基幹システムリプレイス', 'won'),
  (202, 101, 'クラウド移行プロジェクト', 'won'),
  (203, 102, 'ECサイト構築', 'won'),
  (204, 103, 'データ分析基盤構築', 'won');

-- 3. 契約
INSERT INTO contracts (id, project_id, contract_name, contract_type, contract_start_date, contract_end_date, contract_amount, tax_rate, payment_type, status) VALUES
  (301, 201, '基幹システム 2026年Q1', '準委任', '2026-01-01', '2026-03-31', 3000000, 10.0, '毎月支払', 'active'),
  (302, 202, 'クラウド移行 2026年Q1', '準委任', '2026-01-01', '2026-03-31', 1500000, 10.0, '毎月支払', 'active'),
  (303, 203, 'ECサイト構築 Phase1', '請負', '2026-01-01', '2026-02-28', 2200000, 10.0, '毎月支払', 'active'),
  (304, 204, 'データ分析基盤 2026年Q1', '準委任', '2026-01-01', '2026-03-31', 2400000, 10.0, '毎月支払', 'active');

-- 4. 月次明細（一部を請求済にする）
-- 契約301: 基幹システム 月100万（税込110万）× 3ヶ月
INSERT INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, billing_status, billing_date, invoice_number, payment_status, total_payment_amount, expected_payment_date, acceptance_date) VALUES
  (401, 301, '2026-01', 1000000, 1100000, '請求済', '2026-02-01', 'INV-2026-0101', '未入金', 0, '2026-02-28', '2026-01-31'),
  (402, 301, '2026-02', 1000000, 1100000, '請求済', '2026-03-01', 'INV-2026-0102', '未入金', 0, '2026-03-31', '2026-02-28'),
  (403, 301, '2026-03', 1000000, 1100000, '未請求', NULL, NULL, '未入金', 0, NULL, '2026-03-31');

-- 契約302: クラウド移行 月50万（税込55万）× 3ヶ月
INSERT INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, billing_status, billing_date, invoice_number, payment_status, total_payment_amount, expected_payment_date, acceptance_date) VALUES
  (404, 302, '2026-01', 500000, 550000, '請求済', '2026-02-01', 'INV-2026-0201', '未入金', 0, '2026-02-28', '2026-01-31'),
  (405, 302, '2026-02', 500000, 550000, '請求済', '2026-03-01', 'INV-2026-0202', '未入金', 0, '2026-03-31', '2026-02-28'),
  (406, 302, '2026-03', 500000, 550000, '未請求', NULL, NULL, '未入金', 0, NULL, '2026-03-31');

-- 契約303: ECサイト 月110万（税込121万）× 2ヶ月
INSERT INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, billing_status, billing_date, invoice_number, payment_status, total_payment_amount, expected_payment_date, acceptance_date) VALUES
  (407, 303, '2026-01', 1100000, 1210000, '請求済', '2026-02-01', 'INV-2026-0301', '未入金', 0, '2026-02-28', '2026-01-31'),
  (408, 303, '2026-02', 1100000, 1210000, '請求済', '2026-03-01', 'INV-2026-0302', '未入金', 0, '2026-03-31', '2026-02-28');

-- 契約304: データ分析 月80万（税込88万）× 3ヶ月
INSERT INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, billing_status, billing_date, invoice_number, payment_status, total_payment_amount, expected_payment_date, acceptance_date) VALUES
  (409, 304, '2026-01', 800000, 880000, '請求済', '2026-02-01', 'INV-2026-0401', '未入金', 0, '2026-02-28', '2026-01-31'),
  (410, 304, '2026-02', 800000, 880000, '請求済', '2026-03-01', 'INV-2026-0402', '未入金', 0, '2026-03-31', '2026-02-28'),
  (411, 304, '2026-03', 800000, 880000, '未請求', NULL, NULL, '未入金', 0, NULL, '2026-03-31');

-- 5. 銀行入金データ（消込テスト用）
-- 入金1: テクノソリューション 1月分まとめ（基幹110万+クラウド55万 = 165万）
INSERT INTO bank_deposits (id, deposit_date, amount, payer_name, note, remaining_amount, status, created_by) VALUES
  (501, '2026-02-25', 1650000, '株式会社テクノソリューション', '2026年1月分 請求書2件分', 1650000, '未消込', 'admin@system.local');

-- 入金2: クリエイトワークス 1月分（ECサイト121万）
INSERT INTO bank_deposits (id, deposit_date, amount, payer_name, note, remaining_amount, status, created_by) VALUES
  (502, '2026-02-27', 1210000, '合同会社クリエイトワークス', '2026年1月分 ECサイト構築', 1210000, '未消込', 'admin@system.local');

-- 入金3: グローバルシステムズ 1月分（データ分析88万）
INSERT INTO bank_deposits (id, deposit_date, amount, payer_name, note, remaining_amount, status, created_by) VALUES
  (503, '2026-02-28', 880000, 'グローバルシステムズ株式会社', '2026年1月分', 880000, '未消込', 'admin@system.local');

-- 入金4: テクノソリューション 2月分まとめ（基幹110万+クラウド55万 = 165万）
INSERT INTO bank_deposits (id, deposit_date, amount, payer_name, note, remaining_amount, status, created_by) VALUES
  (504, '2026-03-25', 1650000, '株式会社テクノソリューション', '2026年2月分 請求書2件分', 1650000, '未消込', 'admin@system.local');

-- 入金5: 金額不一致テスト用 — 端数がある振込
INSERT INTO bank_deposits (id, deposit_date, amount, payer_name, note, remaining_amount, status, created_by) VALUES
  (505, '2026-03-28', 1000000, 'グローバルシステムズ株式会社', '2026年2月分（一部振込）', 1000000, '未消込', 'admin@system.local');
