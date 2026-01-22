-- leadsテーブルに書類送付先情報を追加
ALTER TABLE leads ADD COLUMN billing_postal_code TEXT;
ALTER TABLE leads ADD COLUMN billing_address TEXT;
ALTER TABLE leads ADD COLUMN billing_contact_name TEXT;
ALTER TABLE leads ADD COLUMN billing_phone TEXT;
ALTER TABLE leads ADD COLUMN billing_email TEXT;
ALTER TABLE leads ADD COLUMN honorific TEXT DEFAULT '御中';
