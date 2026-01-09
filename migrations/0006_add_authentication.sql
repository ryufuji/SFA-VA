-- Migration: 認証・権限管理機能の追加
-- Date: 2026-01-08
-- Description: ユーザー認証、権限管理、監査ログ機能を追加

-- ユーザーテーブル作成
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',  -- 'admin' or 'user'
  member_id INTEGER,  -- members テーブルへの参照（NULL可: 管理者用）
  is_active INTEGER DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

-- 権限テーブル作成
CREATE TABLE user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_name TEXT NOT NULL,  -- 'lead_manage', 'contract_manage', 'inspection_manage', 'payment_manage'
  granted_by INTEGER,  -- 付与した管理者のuser_id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (granted_by) REFERENCES users(id),
  UNIQUE(user_id, permission_name)
);

-- 監査ログテーブル作成
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,    -- 'lead', 'project', 'contract', 'monthly_detail', 'payment'
  resource_id INTEGER,
  details TEXT,          -- JSON形式の詳細情報
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- インデックス作成
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_member_id ON users(member_id);
CREATE INDEX idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- 初期管理者アカウント作成
-- email: admin@system.local
-- password: va1234
INSERT INTO users (email, password_hash, role, member_id)
VALUES ('admin@system.local', '6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp', 'admin', NULL);
