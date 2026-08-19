# HANDOFF.md — Claude Code 引き継ぎ資料

> **目的**: このプロジェクトをローカルの Claude Code で継続開発するための引き継ぎ資料。
> **最初に読むファイル**: `CLAUDE.md` → `ARCHITECTURE.md` → この `HANDOFF.md`。
> **最終更新**: 2026-08-19 / 直近コミット `fae5f3e`（電子契約フェーズ1・2）

---

## 0. まず把握すべきこと（30秒サマリ）

- 本体は **Hono + Cloudflare Pages + D1(SQLite)** のSFA（営業支援システム）。全体像は `README.md` / `ARCHITECTURE.md`。
- 直近で **電子署名（電子契約・合意記録型）機能のフェーズ1・2** を実装・本番デプロイ済み。
- 次にやること: **フェーズ3（Resendメール送信）** と **フェーズ4（Google Drive保存＋合意証明書PDF）**。どちらも外部クレデンシャル待ち。
- 本番: https://webapp-85s.pages.dev/ ／ GitHub: `VALUEARCHITECTS/VA-SFA`（`main` ブランチ）。

---

## 1. プロジェクト概要

| 項目 | 内容 |
|------|------|
| 種別 | SFA（営業支援システム）業務Webアプリ |
| フレームワーク | Hono v4（Cloudflare Workers ランタイム） |
| DB | Cloudflare D1（SQLite） binding名 `DB`、DB名 `webapp-production` |
| ストレージ | Cloudflare R2 binding名 `STORAGE`（画像用） |
| フロント | TailwindCSS(CDN) + FontAwesome(CDN) + axios(CDN) + Vanilla JS |
| 認証 | 自前JWT実装（`hono/jwt`）、ブラウザは `localStorage.jwt_token` |
| ビルド | Vite + `@hono/vite-cloudflare-pages` → `dist/_worker.js` |
| デプロイ | Cloudflare Pages（BYOK：ユーザー自身のCFアカウント） |

### 主要な構造ルール（`CLAUDE.md`と同義・厳守）
- `src/index.tsx` は **ルート登録専用**。ロジック・ハンドラを絶対に書かない。
- 新API → `src/routes/api/{domain}.ts`、新画面 → `src/routes/pages/{domain}.ts` を作り、index.tsx には import と `app.route()` の2行だけ追加。
- `AUTH_UTILS` はインライン再定義せず `public/static/auth.js` を読み込む。

---

## 2. ローカル環境セットアップ手順

```bash
# 1) クローン
git clone https://github.com/VALUEARCHITECTS/VA-SFA.git
cd VA-SFA

# 2) 依存インストール
npm install

# 3)（任意）Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 4) ローカルD1にマイグレーション適用（ローカルSQLiteが自動生成される）
npx wrangler d1 migrations apply webapp-production --local

# 5)（任意）シードデータ投入
#    seed.sql がある場合:
npx wrangler d1 execute webapp-production --local --file=./seed.sql

# 6) ビルド
npm run build

# 7) ローカル起動（開発）
#    ⚠️ --d1 フラグは付けない（後述の落とし穴 5-1 参照）
npx wrangler pages dev dist --ip 0.0.0.0 --port 3000
#    または PM2 経由: pm2 start ecosystem.config.cjs

# 8) 動作確認
curl http://localhost:3000/health
```

### 環境変数 / シークレット
- `.dev.vars`（ローカル用、**gitには入れない**）に `JWT_SECRET` などを置く。
- 本番シークレットは `npx wrangler pages secret put <NAME> --project-name webapp` で登録。
- フェーズ3以降で追加予定: `RESEND_API_KEY`、Google関連（サービスアカウントJSON、Drive フォルダID）。

---

## 3. デプロイ手順（BYOK：ユーザーのCloudflareアカウント）

```bash
# CFアカウント: admin@value-arc.com / account ID 9bdfd8b0fbc8656b41d70c8350ec7161
# CFプロジェクト: webapp（本番URL: https://webapp-85s.pages.dev/）

# 1) APIトークンを環境にセット（Deployパネルに保存済みのトークンを使用）
#    export CLOUDFLARE_API_TOKEN=xxxxx
npx wrangler whoami   # 認証確認

# 2) ビルド
npm run build

# 3) 本番D1へマイグレーション適用（新規マイグレーションがある場合のみ）
npx wrangler d1 migrations apply webapp-production --remote

# 4) デプロイ
npx wrangler pages deploy dist --project-name webapp --branch main

# 5) 確認
curl -I https://webapp-85s.pages.dev/
```

> ⚠️ `wrangler login` / OAuth は使わない。必ず APIトークン方式。
> ⚠️ ローカルとリモートのD1は別物。マイグレーションは両方に適用する必要がある（`--local` と `--remote`）。

---

## 4. 電子署名（電子契約）機能の実装状況

### 4.1 方式・法的前提
- **合意記録型（電子サイン）** を採用。PKIの当事者型・立会人型ではない。
- 本人確認は **メールリンクのみ**（SMS OTP なし）。
- 証拠力は以下で担保:
  - **監査ログ**（閲覧/合意/拒否をINSERTのみで記録・改変不可運用）
  - **SHA-256ハッシュ**（文書確定時に算出、合意時に再計算して改ざん検知）
  - **サーバ時刻タイムスタンプ**
- 関連法令メモ: 電子署名法3条（推定効）、電子帳簿保存法7条（見読性・検索性・非改ざん性・7年保存）、民法522条（合意による契約成立）。

### 4.2 フェーズ進捗

| フェーズ | 内容 | 状態 |
|---------|------|------|
| 1 | データモデル / 文書作成API（text+PDF, SHA-256）/ 署名依頼API（一意トークン・有効期限） | ✅ 完了 |
| 2 | 公開署名ページ `/sign/:token` / 閲覧ログ / 合意API / 期限・二重署名防御 | ✅ 完了 |
| 3 | **Resendメール送信**（署名依頼メール＋完了通知） | ⏳ 未着手（`RESEND_API_KEY`＋認証済み送信ドメイン待ち） |
| 4 | **合意証明書PDF生成＋Google Drive保存**（サービスアカウントJWT→アクセストークンをWeb Cryptoで生成→Drive API） | ⏳ 未着手（GCPサービスアカウントJSON＋DriveフォルダID待ち） |
| 5 | 検索要件（取引年月日/金額/取引先）・削除ロック強制 | ⏳ 一部のみ |

### 4.3 追加・変更したファイル（ファイルマップ）

**新規作成**
```
migrations/0033_add_esign.sql        電子署名の3テーブル（local/remote 両方に適用済み）
src/lib/esign-helpers.ts             Web Cryptoヘルパー群
src/routes/api/esign.ts              管理API（要認証）  → /api/esign
src/routes/api/esign-public.ts       公開API（トークン認証）→ /api/sign
src/routes/pages/sign.ts             公開署名ページ    → /sign/:token
src/routes/pages/esign.ts            管理画面          → /contracts/:id/esign
```

**変更**
```
src/index.tsx                        API×2・ページ×2 のルート登録を追加
                                     （esignPages は contractsPages より前に登録：後述 5-3）
src/routes/pages/contracts.ts        契約詳細に電子署名サマリカード + loadEsignSummary() 追加
README.md                            電子署名機能セクション + エンティティ図更新
```

### 4.4 データモデル（`migrations/0033_add_esign.sql`）

- **contract_documents**: `id, contract_id(FK), title, source_type('text'|'pdf'), document_body, pdf_base64, content_hash(SHA-256), status('draft'|'sent'|'signed'|'declined'|'expired'), drive_file_id(フェーズ4用), finalized_at, created_by, created_at, updated_at`
- **signature_requests**: `id, document_id(FK), signer_name, signer_email, access_token(UNIQUE), expires_at, status('pending'|'signed'|'declined'|'expired'), signed_at, signed_content_hash, email_sent_at(フェーズ3用), created_by, created_at`
- **signature_audit_logs**: `id, signature_request_id(FK), event_type('viewed'|'agreed'|'declined'), signed_content_hash, signer_input_name, ip_address, user_agent, event_at`（INSERTのみ＝不変性）

### 4.5 API一覧

**管理API（要認証）`/api/esign`**（`src/routes/api/esign.ts`）
| メソッド/パス | 権限 | 概要 |
|--------------|------|------|
| POST `/documents` | contract_manage | 文書作成＋確定、SHA-256算出 |
| GET `/contracts/:contractId/documents` | 認証 | 文書一覧（署名依頼をネスト） |
| POST `/documents/:documentId/requests` | contract_manage | 署名依頼発行、`sign_url = {origin}/sign/{token}` を返す |
| POST `/requests/:requestId/cancel` | contract_manage | 依頼キャンセル |
| GET `/requests/:requestId/audit-logs` | 認証 | 監査ログ取得 |

**公開API（認証なし・トークン）`/api/sign`**（`src/routes/api/esign-public.ts`）
| メソッド/パス | 概要 |
|--------------|------|
| GET `/:token` | 表示用文書返却。pending なら `viewed` ログ記録、期限切れは自動 expire |
| POST `/:token/agree` | body `{input_name, agreed:true}`。ハッシュ再計算で改ざん検知（不一致→`integrity_error` 409）、二重署名→`already_signed` 409、期限切れ→`expired` 410、成功で `agreed` ログ＋status=signed |
| POST `/:token/decline` | `declined` ログ記録 |

### 4.6 画面
- 管理画面 `/contracts/:id/esign`（`src/routes/pages/esign.ts`）: 文書作成（text/PDFラジオ）、文書一覧、署名依頼モーダル（sign_urlコピー）、監査ログビューア。
- 公開署名ページ `/sign/:token`（`src/routes/pages/sign.ts`）: 認証ミドルウェアなし。textは`<pre>`、PDFはbase64を`<iframe>`表示。氏名入力＋同意チェック＋同意/拒否ボタン。content_hash表示。
- 契約詳細（`src/routes/pages/contracts.ts`）に電子署名サマリカードを追加。

---

## 5. 落とし穴・重要な注意点（ここ重要）

### 5-1. ローカル起動で `--d1=DB` フラグを付けない
`wrangler pages dev dist --d1=DB ...` にすると **別の空ローカルDBが生成**され、
「no such table」500エラーになる。`wrangler.toml` の D1 binding が自動検出されるので
**フラグなし**で起動すること。`ecosystem.config.cjs` は最終的に
`args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000'`（--d1 なし）。

### 5-2. Node.jsの `crypto` は使えない → Web Crypto API を使う
Cloudflare Workers ランタイムには Node の `crypto` がない。
`crypto.subtle.digest('SHA-256', ...)` / `crypto.randomUUID()` を使う。
`src/lib/esign-helpers.ts` に集約済み（`sha256Hex`, `generateAccessToken`, `calcExpiresAt`, `isExpired`, `getClientIp`, `getUserAgent`, `escapeHtml`）。同様に `fs` 等のNode API全般が使えない。

### 5-3. ルート登録順序
`/contracts/:id/esign` が `/contracts/:id`（より一般的）に飲まれないよう、
`app.route('/', esignPages)` は **`contractsPages` より前** に登録する。

### 5-4. `logAction` は 7引数
`logAction(DB, userId|null, action, resourceType, resourceId(Number), details(obj), ipAddress)`。
（`src/auth.ts` 定義。detailsはJSON.stringifyされる）。誤って4引数で呼ばない。

### 5-5. `.dev.vars` はgit管理外
ローカルシークレットは `.dev.vars`。`.gitignore` 済み。クローン直後は存在しないので
自分で作成する（少なくとも `JWT_SECRET`）。

### 5-6. 本番D1はマイグレーション適用済み
マイグレーション `0033` は本番（`--remote`）にも適用済み。再適用不要。
新規マイグレーションを追加したときのみ local/remote 両方に適用。

### 5-7. ローカルログインパスワード
ローカルDBのadminパスワードハッシュは本番と異なる場合がある。
（フェーズ1・2のE2Eは、APIログインではなく直接D1インサートで検証した経緯あり）。
必要なら seed で任意ユーザーを作るか、`src/auth.ts` の `hashPassword` でハッシュ生成。

---

## 6. ビルド / テスト / 検証コマンド

```bash
# 構造チェック（index.tsx 肥大化・配置ルール違反の検出）
bash check_structure.sh

# ビルド
npm run build            # → dist/_worker.js（wrangler.toml も dist にコピーされる）

# ルート疎通テスト
bash test_all_routes.sh  # 期待: 26 PASS, 2 FAIL（データ不足の既知404）

# 電子署名E2E（ローカル）確認済み挙動:
#   閲覧 → 合意 → 二重署名ブロック(already_signed) → 改ざん検知(integrity_error)
```

---

## 7. 残タスク詳細（次の実装の入口）

### フェーズ3: Resendメール送信
- 目的: 署名依頼メール送信＋完了通知。
- 必要: `RESEND_API_KEY`、Resendで**認証済みの送信ドメイン**。
- 実装方針:
  - シークレット登録: `npx wrangler pages secret put RESEND_API_KEY --project-name webapp`
  - `src/lib/` にメール送信ヘルパーを追加（`fetch('https://api.resend.com/emails', ...)`）。
  - `POST /api/esign/documents/:documentId/requests` 発行時にメール送信、`signature_requests.email_sent_at` を更新。
  - 合意完了時（`/api/sign/:token/agree`）に依頼者へ完了通知。

### フェーズ4: 合意証明書PDF＋Google Drive保存
- 目的: 合意完了時に証明書PDFを生成し、Google Workspace の Drive にサービスアカウント経由で保存。
- 必要: GCPサービスアカウントJSON（Drive API有効化）、保存先DriveフォルダID。
- 実装方針:
  - サービスアカウントの秘密鍵で **JWTを署名 → OAuth2 トークン交換 → Drive API アップロード**。すべて Web Crypto（`crypto.subtle`）で実装（Node cryptoは不可）。
  - 生成した `drive_file_id` を `contract_documents.drive_file_id` に保存。
  - GCPへは移行しない。アプリはCloudflareのまま、Driveはサービスアカウント経由のAPI連携のみ。

### フェーズ5: 検索・削除ロック（電子帳簿保存法対応の仕上げ）
- 取引年月日 / 金額 / 取引先での検索要件。
- 確定文書の削除ロック強制（7年保存・非改ざん性）。

---

## 8. リポジトリ / インフラ参照情報

| 項目 | 値 |
|------|-----|
| GitHub | `VALUEARCHITECTS/VA-SFA`（`main`） |
| 別ブランチ | `refactor/split-index-tsx`（作業中の分割リファクタ） |
| 本番URL | https://webapp-85s.pages.dev/ |
| CFアカウント | admin@value-arc.com |
| CF account ID | 9bdfd8b0fbc8656b41d70c8350ec7161 |
| D1 database_id | 65efc191-b649-460d-aef4-1b4322225a5d |
| 直近コミット | `fae5f3e`（電子契約フェーズ1・2を追加） |

> 他のCFプロジェクト（同アカウント）: webapp-2（apps.value-arc.com）, thailand-auto-collector, bomberapp, threelink。**本SFAは `webapp` プロジェクト**。
