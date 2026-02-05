-- サンプルデータ (開発・テスト用)

-- 外部キー制約を一時的に無効化
PRAGMA foreign_keys = OFF;

-- メンバーのサンプルデータ（usersより先に挿入）
INSERT OR IGNORE INTO members (id, name, email, default_unit_price, status) VALUES 
  (1, '田中太郎', 'tanaka@valuearchs.com', 600000, 'active'),
  (2, '佐藤花子', 'sato@valuearchs.com', 700000, 'active'),
  (3, '鈴木次郎', 'suzuki@valuearchs.com', 550000, 'active'),
  (4, '高橋美咲', 'takahashi@valuearchs.com', 650000, 'active'),
  (5, '伊藤健太', 'ito@valuearchs.com', 500000, 'active');

-- ユーザーのサンプルデータ（membersの後に挿入）
-- 管理者ユーザー (admin@system.local / admin@system.local1234)
-- パスワードハッシュは bcrypt で生成 (ラウンド数: 10)
INSERT OR IGNORE INTO users (id, email, password_hash, role, member_id, password_change_required) VALUES 
  (1, 'admin@system.local', '$2a$10$D5xzYZq3Q3Y3Q3Q3Q3Q3QeO9x3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q', 'admin', NULL, 0);

-- メンバー紐付きユーザー (メンバーメールアドレス / password123)
INSERT OR IGNORE INTO users (id, email, password_hash, role, member_id, password_change_required) VALUES 
  (2, 'tanaka@valuearchs.com', '$2a$10$D5xzYZq3Q3Y3Q3Q3Q3Q3QeO9x3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q', 'member', 1, 0),
  (3, 'sato@valuearchs.com', '$2a$10$D5xzYZq3Q3Y3Q3Q3Q3Q3QeO9x3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q', 'member', 2, 0),
  (4, 'suzuki@valuearchs.com', '$2a$10$D5xzYZq3Q3Y3Q3Q3Q3Q3QeO9x3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q3Q', 'member', 3, 0);

-- リードのサンプルデータ（より充実したデータ）
INSERT OR IGNORE INTO leads (id, company_name, contact_person, email, phone, status, honorific, billing_postal_code, billing_address, billing_contact_name, memo) VALUES 
  (1, '株式会社テクノロジー', '山田太郎', 'yamada@techno.co.jp', '03-1234-5678', 'active', '様', '1500001', '東京都渋谷区神宮前1-1-1', '経理部 山田', 'ITコンサルティング会社。年商50億円規模。'),
  (2, '株式会社グローバル商事', '佐藤花子', 'sato@global.com', '03-2345-6789', 'active', '様', '1000001', '東京都千代田区丸の内2-2-2', '経理部 佐藤', '総合商社。グローバル展開。'),
  (3, '合同会社イノベーション', '鈴木一郎', 'suzuki@innov.jp', '03-3456-7890', 'active', '様', '1070051', '東京都港区元赤坂3-3-3', '経理部 鈴木', 'スタートアップ企業。成長中。'),
  (4, '株式会社メガコーポ', '田中美咲', 'tanaka@mega.co.jp', '03-4567-8901', 'active', '御中', '1408611', '東京都品川区大崎4-4-4', '経理課長 田中', '大手製造業。安定企業。'),
  (5, '有限会社ベンチャー', '高橋健太', 'takahashi@venture.jp', '03-5678-9012', 'active', '様', '1500041', '東京都渋谷区神南5-5-5', '代表 高橋', '小規模ベンチャー企業。');

-- 案件のサンプルデータ（より充実したデータ）
INSERT OR IGNORE INTO projects (id, lead_id, project_name, status, sales_rep_id) VALUES 
  (1, 1, 'システム開発プロジェクトA', 'won', NULL),
  (2, 1, '保守運用案件B', 'active', NULL),
  (3, 2, 'Webサイト制作案件', 'won', NULL),
  (4, 3, 'モバイルアプリ開発', 'active', NULL),
  (5, 4, 'クラウド移行プロジェクト', 'won', NULL),
  (6, 5, 'データ分析基盤構築', 'active', NULL);

-- 契約のサンプルデータ（より充実したデータ）
INSERT OR IGNORE INTO contracts (id, project_id, contract_name, contract_start_date, contract_end_date, contract_amount, tax_rate, status, contract_type, payment_type) VALUES 
  (1, 1, '2026年Q1 基幹システム開発', '2026-01-01', '2026-03-31', 4000000, 10.0, 'active', '準委任', '月末締め翌月末払い'),
  (2, 1, '2026年Q2 基幹システム開発', '2026-04-01', '2026-06-30', 4000000, 10.0, 'active', '準委任', '月末締め翌月末払い'),
  (3, 2, '2026年上半期 保守運用', '2026-01-01', '2026-06-30', 3000000, 10.0, 'active', '準委任', '月末締め翌月末払い'),
  (4, 3, 'Webサイト制作', '2025-12-01', '2026-02-28', 3000000, 10.0, 'completed', '請負', '検収後30日以内'),
  (5, 5, 'クラウド移行 Phase1', '2026-01-01', '2026-06-30', 8000000, 10.0, 'active', '準委任', '月末締め翌月末払い');

-- 月次明細のサンプルデータ（より充実したデータ）
-- 契約1: Q1 2026 基幹システム開発
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, inspection_date, billing_status, billing_date, invoice_number, expected_payment_date, payment_status, total_payment_amount) VALUES 
  (1, 1, '2026-01', 1400000, 1540000, '検収済', '2026-01-31', '請求済', '2026-02-05', 'INV-202601-001', '2026-02-28', '入金完了', 1400000),
  (2, 1, '2026-02', 1300000, 1430000, '検収済', '2026-02-28', '請求済', '2026-03-05', 'INV-202602-001', '2026-03-31', '部分入金', 800000),
  (3, 1, '2026-03', 1300000, 1430000, '検収中', NULL, '未請求', NULL, NULL, '2026-04-30', '未入金', 0);

-- 契約2: Q2 2026 基幹システム開発
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, billing_status, payment_status) VALUES 
  (4, 2, '2026-04', 1300000, 1430000, '未検収', '未請求', '未入金'),
  (5, 2, '2026-05', 1400000, 1540000, '未検収', '未請求', '未入金'),
  (6, 2, '2026-06', 1300000, 1430000, '未検収', '未請求', '未入金');

-- 契約3: 保守運用
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, inspection_date, billing_status, billing_date, invoice_number, payment_status, total_payment_amount) VALUES 
  (7, 3, '2026-01', 500000, 550000, '検収済', '2026-01-31', '請求済', '2026-02-05', 'INV-202601-002', '入金完了', 500000),
  (8, 3, '2026-02', 500000, 550000, '検収済', '2026-02-28', '請求済', '2026-03-05', 'INV-202602-002', '未入金', 0),
  (9, 3, '2026-03', 500000, 550000, '検収中', NULL, '未請求', NULL, NULL, '未入金', 0),
  (10, 3, '2026-04', 500000, 550000, '未検収', '未請求', '未入金'),
  (11, 3, '2026-05', 500000, 550000, '未検収', '未請求', '未入金'),
  (12, 3, '2026-06', 500000, 550000, '未検収', '未請求', '未入金');

-- 契約4: Webサイト制作（完了済み）
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, inspection_date, billing_status, billing_date, invoice_number, payment_status, total_payment_amount) VALUES 
  (13, 4, '2025-12', 1000000, 1100000, '検収済', '2026-01-10', '請求済', '2026-01-15', 'INV-202601-003', '入金完了', 1000000),
  (14, 4, '2026-01', 1000000, 1100000, '検収済', '2026-02-10', '請求済', '2026-02-15', 'INV-202602-003', '入金完了', 1000000),
  (15, 4, '2026-02', 1000000, 1100000, '検収済', '2026-03-10', '請求済', '2026-03-15', 'INV-202603-001', '入金完了', 1000000);

-- 契約5: クラウド移行
INSERT OR IGNORE INTO monthly_details (id, contract_id, target_month, amount, amount_with_tax, inspection_status, billing_status, payment_status) VALUES 
  (16, 5, '2026-01', 1300000, 1430000, '検収済', '請求済', '未入金'),
  (17, 5, '2026-02', 1300000, 1430000, '検収中', '未請求', '未入金'),
  (18, 5, '2026-03', 1400000, 1540000, '未検収', '未請求', '未入金'),
  (19, 5, '2026-04', 1300000, 1430000, '未検収', '未請求', '未入金'),
  (20, 5, '2026-05', 1400000, 1540000, '未検収', '未請求', '未入金'),
  (21, 5, '2026-06', 1300000, 1430000, '未検収', '未請求', '未入金');

-- 入金履歴のサンプルデータ
INSERT OR IGNORE INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note) VALUES 
  (1, '2026-02-28', 1400000, '全額入金確認'),
  (2, '2026-03-15', 500000, '第1回入金'),
  (2, '2026-03-20', 300000, '第2回入金'),
  (7, '2026-02-28', 500000, '保守費用 全額入金'),
  (13, '2026-02-10', 1000000, 'Web制作費 第1回'),
  (14, '2026-03-10', 1000000, 'Web制作費 第2回'),
  (15, '2026-04-10', 1000000, 'Web制作費 最終');

-- 契約メンバーアサインのサンプルデータ
-- 契約1: 基幹システム開発 Q1
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (1, 1, 60.0, 600000),
  (1, 2, 40.0, 700000);

-- 契約2: 基幹システム開発 Q2
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (2, 1, 50.0, 600000),
  (2, 3, 50.0, 550000);

-- 契約3: 保守運用
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (3, 3, 100.0, 500000);

-- 契約5: クラウド移行
INSERT OR IGNORE INTO contract_member_assignments (contract_id, member_id, allocation_ratio, unit_price) VALUES 
  (5, 2, 50.0, 700000),
  (5, 4, 50.0, 600000);

-- 月次メンバーアサインのサンプルデータ
-- 月次明細1: 2026-01 (契約1)
INSERT OR IGNORE INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price) VALUES 
  (1, 1, 60.0, 600000),
  (1, 2, 40.0, 700000);

-- 月次明細2: 2026-02 (契約1)
INSERT OR IGNORE INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price) VALUES 
  (2, 1, 60.0, 600000),
  (2, 2, 40.0, 700000);

-- 月次明細7: 2026-01 (契約3)
INSERT OR IGNORE INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price) VALUES 
  (7, 3, 100.0, 500000);

-- 月次明細8: 2026-02 (契約3)
INSERT OR IGNORE INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price) VALUES 
  (8, 3, 100.0, 500000);

-- 月次明細16: 2026-01 (契約5)
INSERT OR IGNORE INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price) VALUES 
  (16, 2, 50.0, 700000),
  (16, 4, 50.0, 600000);

-- ステータス変更履歴のサンプルデータ
INSERT OR IGNORE INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason) VALUES 
  ('monthly_details', 1, 'inspection_status', '未検収', '検収済', '顧客から検収書を受領'),
  ('monthly_details', 1, 'billing_status', '未請求', '請求済', '請求書INV-202601-001を発行'),
  ('monthly_details', 2, 'inspection_status', '未検収', '検収済', '検収完了通知受領'),
  ('monthly_details', 2, 'billing_status', '未請求', '請求済', '請求書INV-202602-001を発行'),
  ('monthly_details', 7, 'inspection_status', '未検収', '検収済', '月次報告書承認済み'),
  ('projects', 1, 'status', 'active', 'won', '正式受注決定'),
  ('projects', 3, 'status', 'active', 'won', '契約締結完了');

-- 商談メモのサンプルデータ
INSERT OR IGNORE INTO project_meeting_notes (project_id, meeting_date, memo) VALUES 
  (1, '2025-12-10', '初回ミーティング。システム要件のヒアリング実施。'),
  (1, '2025-12-20', '提案書を提出。好感触。'),
  (1, '2026-01-10', '契約書締結。2026年1月スタート決定。'),
  (2, '2026-01-05', '保守運用の詳細打ち合わせ。月次報告フォーマット確認。'),
  (3, '2025-11-15', 'Webサイトのデザイン案を3パターン提示。'),
  (3, '2025-12-01', 'デザイン案Bで決定。契約締結。');

-- 見積書のサンプルデータ
INSERT OR IGNORE INTO quotes (id, quote_number, project_id, lead_id, issue_date, expiry_date, subject, subtotal, tax, total, tax_rate, notes, status) VALUES 
  (1, 'QUO-202512-001', 1, 1, '2025-12-15', '2026-01-15', '基幹システム開発費用 2026年Q1', 4000000, 400000, 4400000, 10, '3ヶ月分の開発費用です。', '承認済'),
  (2, 'QUO-202601-001', 5, 4, '2026-01-10', '2026-02-10', 'クラウド移行プロジェクト Phase1', 8000000, 800000, 8800000, 10, '6ヶ月分の移行作業費用です。', '承認済'),
  (3, 'QUO-202601-002', 4, 3, '2026-01-20', '2026-02-20', 'モバイルアプリ開発費用', 8000000, 800000, 8800000, 10, 'iOS/Androidアプリ開発費用', '提出済');

-- 見積明細のサンプルデータ
-- 見積書1: 基幹システム開発
INSERT OR IGNORE INTO quote_items (quote_id, member_id, item_description, quantity, unit, unit_price, amount, note, sort_order) VALUES 
  (1, 1, 'システムアーキテクト（田中太郎）', 1.8, '人月', 600000, 1080000, 'アーキテクチャ設計・レビュー', 1),
  (1, 2, 'シニアエンジニア（佐藤花子）', 2.1, '人月', 700000, 1470000, '基幹機能開発', 2),
  (1, 4, 'エンジニア（高橋美咲）', 2.2, '人月', 650000, 1430000, 'UI/UX実装', 3),
  (1, NULL, '開発環境構築費用', 1, '式', 20000, 20000, 'AWS環境初期構築', 4);

-- 見積書2: クラウド移行
INSERT OR IGNORE INTO quote_items (quote_id, member_id, item_description, quantity, unit, unit_price, amount, note, sort_order) VALUES 
  (2, 2, 'クラウドアーキテクト（佐藤花子）', 3.5, '人月', 700000, 2450000, 'AWS設計・構築', 1),
  (2, 4, 'インフラエンジニア（高橋美咲）', 4.0, '人月', 650000, 2600000, '移行作業・検証', 2),
  (2, 1, 'プロジェクトマネージャー（田中太郎）', 2.0, '人月', 600000, 1200000, 'プロジェクト管理', 3),
  (2, NULL, 'データ移行ツール開発', 1, '式', 1750000, 1750000, 'ETLツール開発', 4);

-- 見積書3: モバイルアプリ開発
INSERT OR IGNORE INTO quote_items (quote_id, member_id, item_description, quantity, unit, unit_price, amount, note, sort_order) VALUES 
  (3, 4, 'iOSエンジニア（高橋美咲）', 4.0, '人月', 650000, 2600000, 'iOS開発', 1),
  (3, 5, 'Androidエンジニア（伊藤健太）', 4.0, '人月', 500000, 2000000, 'Android開発', 2),
  (3, 1, 'UIデザイナー', 2.0, '人月', 600000, 1200000, 'UI/UXデザイン', 3),
  (3, NULL, 'デザインツール・ライブラリ', 1, '式', 2200000, 2200000, 'デザインシステム構築', 4);

-- 自社情報（既に登録済みだが、seed.sqlに含める）
INSERT OR REPLACE INTO company_info (id, company_name, postal_code, address, registration_number, updated_at) VALUES 
  (1, 'VALUE ARCHITECTS株式会社', '1410022', '東京都品川区東五反田3-17-21 ダモビル 401', 'T6011001108247', datetime('now'));

-- 外部キー制約を再有効化
PRAGMA foreign_keys = ON;
