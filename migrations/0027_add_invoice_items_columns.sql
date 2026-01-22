-- invoice_itemsテーブルにmember_idとnoteカラムを追加
ALTER TABLE invoice_items ADD COLUMN member_id INTEGER;
ALTER TABLE invoice_items ADD COLUMN note TEXT;

CREATE INDEX idx_invoice_items_member_id ON invoice_items(member_id);
