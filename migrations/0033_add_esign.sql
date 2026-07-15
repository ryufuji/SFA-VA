-- ============================================================
-- 電子契約（電子サイン・合意記録型）機能
-- 電子署名法・電子帳簿保存法を踏まえた合意証跡の記録
-- ============================================================

-- ------------------------------------------------------------
-- 1. 契約書ドキュメント（確定した契約書本体）
--    - 契約1件に対して複数版を許容（再送・再作成に対応）
--    - content_hash: 確定時のSHA-256（改ざん検知の基準値）
--    - source_type: text=アプリ内生成 / pdf=アップロードPDF
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  title TEXT NOT NULL,                       -- 契約書タイトル
  source_type TEXT NOT NULL DEFAULT 'text'   -- text / pdf
    CHECK(source_type IN ('text', 'pdf')),
  document_body TEXT,                         -- text型: 契約書本文（確定版）
  pdf_base64 TEXT,                            -- pdf型: アップロードPDFのBase64（Drive移行までの暫定保存）
  content_hash TEXT NOT NULL,                 -- SHA-256（16進）改ざん検知用
  status TEXT NOT NULL DEFAULT 'draft'        -- draft/sent/signed/declined/expired
    CHECK(status IN ('draft', 'sent', 'signed', 'declined', 'expired')),
  drive_file_id TEXT,                         -- Google Drive保存後のファイルID（フェーズ4で使用）
  finalized_at DATETIME,                      -- 確定（編集ロック）日時
  created_by INTEGER,                         -- 作成した自社ユーザーID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract_id ON contract_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_status ON contract_documents(status);

-- ------------------------------------------------------------
-- 2. 署名依頼（送信先ごとに1レコード）
--    - access_token: 推測不能な一意トークン（公開署名URLに使用）
--    - expires_at: 有効期限（既定14日）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  signer_name TEXT NOT NULL,                  -- 署名者（クライアント）氏名
  signer_email TEXT NOT NULL,                 -- 署名者メールアドレス
  access_token TEXT UNIQUE NOT NULL,          -- 一意・推測不能なURLトークン
  expires_at DATETIME NOT NULL,               -- 有効期限
  status TEXT NOT NULL DEFAULT 'pending'      -- pending/signed/declined/expired
    CHECK(status IN ('pending', 'signed', 'declined', 'expired')),
  signed_at DATETIME,                         -- 合意完了日時
  signed_content_hash TEXT,                   -- 合意時点の契約書ハッシュ（照合結果を保存）
  email_sent_at DATETIME,                     -- 依頼メール送信日時（フェーズ3で使用）
  created_by INTEGER,                         -- 依頼を発行した自社ユーザーID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES contract_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_signature_requests_document_id ON signature_requests(document_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON signature_requests(access_token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON signature_requests(status);

-- ------------------------------------------------------------
-- 3. 合意証跡（監査ログ・INSERT専用／改ざん不可運用）
--    - event_type: viewed(閲覧) / agreed(合意) / declined(拒否)
--    - 証拠力の中核。IP・UA・時刻・ハッシュを記録
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signature_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature_request_id INTEGER NOT NULL,
  event_type TEXT NOT NULL                    -- viewed / agreed / declined
    CHECK(event_type IN ('viewed', 'agreed', 'declined')),
  signed_content_hash TEXT,                   -- そのイベント時点で提示していた契約書ハッシュ
  signer_input_name TEXT,                     -- 合意時に本人が入力した氏名
  ip_address TEXT,                            -- アクセス元IP
  user_agent TEXT,                            -- ブラウザUA
  event_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_signature_audit_logs_request_id ON signature_audit_logs(signature_request_id);
CREATE INDEX IF NOT EXISTS idx_signature_audit_logs_event_type ON signature_audit_logs(event_type);
