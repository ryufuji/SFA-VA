-- ロゴと印鑑のBase64データを保存するカラムを追加
ALTER TABLE company_info ADD COLUMN logo_base64 TEXT;
ALTER TABLE company_info ADD COLUMN seal_base64 TEXT;
