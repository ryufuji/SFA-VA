-- 既存メンバーからユーザーアカウントを作成
-- 初期パスワード: va1234
-- パスワードハッシュ: 6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp

-- メンバーID 1: 田中太郎
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE id = 1;

-- メンバーID 2: 佐藤花子
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE id = 2;

-- メンバーID 3: 鈴木次郎
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE id = 3;

-- メンバーID 4: 山本太郎
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE id = 4;

-- メンバーID 5: 藤本隆太郎
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE id = 5;

-- すべてのアクティブメンバーに対してユーザーアカウントを作成
INSERT OR IGNORE INTO users (email, password_hash, role, member_id)
SELECT email, '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'user', id
FROM members
WHERE status = 'active' AND id NOT IN (SELECT member_id FROM users WHERE member_id IS NOT NULL);
