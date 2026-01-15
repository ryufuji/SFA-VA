-- メンバーテーブルにメールアドレスのユニーク制約を追加

-- 既存の重複メールアドレスがある場合に備えて、まず重複をチェック
-- (この段階では重複がないことを前提とします。もし重複がある場合は手動で修正が必要)

-- メールアドレスにユニークインデックスを作成
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_unique ON members(email);
