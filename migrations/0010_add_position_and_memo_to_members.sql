-- メンバーテーブルに役職とメモを追加
ALTER TABLE members ADD COLUMN position TEXT;
ALTER TABLE members ADD COLUMN memo TEXT;

-- インデックスを追加
CREATE INDEX IF NOT EXISTS idx_members_position ON members(position);
