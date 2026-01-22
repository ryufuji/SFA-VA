-- usersテーブルに自社情報編集権限を追加
ALTER TABLE users ADD COLUMN can_edit_company_info INTEGER DEFAULT 0;

-- 管理者ユーザーには自動的に権限を付与
UPDATE users SET can_edit_company_info = 1 WHERE role = 'admin';
