-- 月次メンバーアサインのサンプルデータ

-- 月次明細ID=4 (2026-04, 契約ID=2, Q2 2026契約)
INSERT INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
VALUES 
  (4, 1, 0.5, 500000, '田中: メインエンジニア'),
  (4, 2, 0.3, 300000, '佐藤: サブエンジニア'),
  (4, 3, 0.2, 200000, '鈴木: デザイナー');

-- 月次明細ID=5 (2026-05, 契約ID=2)
INSERT INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
VALUES 
  (5, 1, 0.4, 400000, '田中: 4月から比率減'),
  (5, 2, 0.6, 600000, '佐藤: メイン担当に昇格');

-- 月次明細ID=6 (2026-06, 契約ID=2)
INSERT INTO monthly_member_assignments (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
VALUES 
  (6, 1, 0.3, 300000, '田中: サポート'),
  (6, 2, 0.7, 700000, '佐藤: 引き続きメイン');
