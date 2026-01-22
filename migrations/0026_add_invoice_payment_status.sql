-- invoicesテーブルにpayment_statusとpayment_dateカラムを追加
ALTER TABLE invoices ADD COLUMN payment_status TEXT NOT NULL DEFAULT '未入金' CHECK(payment_status IN ('未入金', '部分入金', '入金完了'));
ALTER TABLE invoices ADD COLUMN payment_date DATE;

CREATE INDEX idx_invoices_payment_status ON invoices(payment_status);
