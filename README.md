# SFA (営業支援システム)

## プロジェクト概要
- **名前**: SFA (Sales Force Automation)
- **目的**: 見込み顧客（リード）から継続取引までを一気通貫で管理する営業支援システム
- **技術スタック**: Hono + Cloudflare Pages + D1 Database + TailwindCSS
- **GitHubリポジトリ**: https://github.com/VALUEARCHITECTS/VA-SFA

## 本番環境URL

| 画面 | URL |
|------|-----|
| ダッシュボード | https://webapp-85s.pages.dev/ |
| ログイン | https://webapp-85s.pages.dev/login |
| ヘルスチェック | https://webapp-85s.pages.dev/health |

### ログイン情報
- **メールアドレス**: admin@system.local
- **パスワード**: va1234

## 実装済み機能

### 画面一覧（SSR with Hono）

| 画面 | パス | 概要 |
|------|------|------|
| ダッシュボード | `/` | 月次売上（確定/未検収）、未請求・未入金金額、売上推移グラフ、最近の契約一覧 |
| リード一覧 | `/leads` | リード一覧表示、新規作成モーダル、CSVインポート/エクスポート |
| リード詳細 | `/leads/:id` | 基本情報表示、関連案件一覧 |
| 案件一覧 | `/projects` | 案件一覧表示（ソート機能付き）、CSVインポート/エクスポート |
| 案件詳細 | `/projects/detail/:id` | 案件情報、関連契約一覧、見積書セクション（作成・PDF出力）、商談メモ |
| 契約作成 | `/projects/detail/:projectId/contracts/new` | 契約情報入力、期間指定（1〜12ヶ月）、月次明細自動生成、プレビュー |
| 契約一覧 | `/contracts` | 契約一覧表示、CSVインポート/エクスポート |
| 契約詳細 | `/contracts/:id` | サマリーカード、月次明細タブ、アサインメンバータブ |
| 月次明細一覧 | `/monthly-details` | 全月次明細、税抜・税込表示、検収/請求/入金バッジ、一括検収、CSVインポート/エクスポート |
| 月次リスト | `/monthly-list` | 月次明細の簡易リスト表示 |
| 月次明細詳細 | `/monthly/:id` | 基本情報・金額編集、検収/請求管理、請求書作成、入金管理（税込ベース残額計算）、メンバーアサイン、変更履歴 |
| 見積書一覧 | `/quotes` | 見積書一覧、ステータスバッジ、PDF出力 |
| 見積書詳細 | `/quotes/:id` | 金額サマリー、タブ（概要/明細/履歴）、ステータス変更、PDF出力 |
| 見積書PDF | `/quotes/:id/pdf` | 見積書のPDF表示 |
| 請求書一覧 | `/invoices` | 請求書一覧、PDF出力 |
| 請求書詳細 | `/invoices/:id` | 請求書詳細表示 |
| 請求書PDF | `/invoices/:id/pdf` | 請求書のPDF表示 |
| 入金状況一覧 | `/payments` | リード単位の月毎入金集計、税抜/税込/入金総額、入金状況バッジ |
| 入金消込 | `/bank-deposits` | 銀行入金一覧 |
| 入金消込配分 | `/bank-deposits/:id/allocate` | 入金の配分設定 |
| メンバー管理 | `/members` | メンバー一覧、追加・編集・ステータス変更 |
| 詳細一覧ハブ | `/details` | 月次明細・見積書・請求書・入金一覧へのナビゲーション |
| 自社情報管理 | `/settings/company` | 会社情報編集、銀行情報、ロゴ・印鑑アップロード（R2ストレージ） |
| データバックアップ | `/settings/data-backup` | データのエクスポート/インポート管理 |
| システム設定 | `/settings` | システム設定管理画面 |
| ログイン | `/login` | JWT認証によるログイン |
| プロフィール | `/profile` | ユーザープロフィール表示・編集 |
| パスワード変更 | `/change-password` | パスワード変更 |
| 管理者ユーザー管理 | `/admin/users` | ユーザー一覧、権限管理、アクティブ/非アクティブ切替 |
| 管理者データインポート | `/admin/import` | 管理用データインポート画面 |

### API一覧（REST）

**認証** (`/api/auth`)
| メソッド | パス | 概要 |
|---------|------|------|
| POST | `/api/auth/login` | ログイン（JWT発行） |
| GET | `/api/auth/me` | 現在のユーザー情報取得 |
| POST | `/api/auth/change-password` | パスワード変更 |
| POST | `/api/auth/logout` | ログアウト |

**リード管理** (`/api/leads`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/leads` | リード一覧取得 |
| GET | `/api/leads/:id` | リード詳細取得 |
| POST | `/api/leads` | リード作成 |
| PUT | `/api/leads/:id` | リード更新 |
| PUT | `/api/leads/:id/status` | ステータス変更 |
| DELETE | `/api/leads/:id` | リード削除 |
| GET | `/api/leads/:id/delete-impact` | 削除影響範囲確認 |
| GET | `/api/leads/export/csv` | CSVエクスポート |
| POST | `/api/leads/import/csv` | CSVインポート |

**案件管理** (`/api/projects`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/projects` | 案件一覧取得 |
| GET | `/api/projects/:id` | 案件詳細取得 |
| POST | `/api/projects` | 案件作成 |
| PUT | `/api/projects/:id` | 案件更新 |
| DELETE | `/api/projects/:id` | 案件削除 |
| GET | `/api/projects/:id/delete-impact` | 削除影響範囲確認 |
| GET | `/api/projects/export/csv` | CSVエクスポート |
| POST | `/api/projects/import/csv` | CSVインポート |
| GET | `/api/projects/:projectId/quotes` | 案件別見積書一覧 |
| POST | `/api/projects/:projectId/quotes` | 見積書作成 |
| GET | `/api/projects/:projectId/meeting-notes` | 商談メモ一覧 |

**契約管理** (`/api/contracts`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/contracts/:id` | 契約詳細取得 |
| POST | `/api/contracts` | 契約作成（月次明細自動生成） |
| PUT | `/api/contracts/:id` | 契約更新 |
| DELETE | `/api/contracts/:id` | 契約削除 |
| GET | `/api/contracts/:id/delete-impact` | 削除影響範囲確認 |
| GET | `/api/contracts/export/csv` | CSVエクスポート |
| POST | `/api/contracts/import/csv` | CSVインポート |

**月次明細管理** (`/api/monthly-details`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/monthly-details/unpaid` | 未入金明細一覧 |
| GET | `/api/monthly-details/:id` | 月次明細詳細 |
| PUT | `/api/monthly-details/:id` | 月次明細更新 |
| PUT | `/api/monthly-details/:id/billing` | 請求情報更新 |
| PUT | `/api/monthly-details/:id/amount` | 金額編集 |
| DELETE | `/api/monthly-details/:id` | 月次明細削除 |
| GET | `/api/monthly-details/:id/delete-impact` | 削除影響範囲確認 |
| GET | `/api/monthly-details/export/csv` | CSVエクスポート |
| POST | `/api/monthly-details/import/csv` | CSVインポート |
| POST | `/api/monthly-details/:monthlyDetailId/invoice` | 請求書生成 |

**月次メンバーアサイン** (`/api/monthly-member-assignments`)
| メソッド | パス | 概要 |
|---------|------|------|
| POST | `/api/monthly-member-assignments` | アサイン追加 |
| POST | `/api/monthly-member-assignments/batch` | 一括アサイン |
| PUT | `/api/monthly-member-assignments/:id` | アサイン更新 |
| DELETE | `/api/monthly-member-assignments/:id` | アサイン削除 |

**入金管理** (`/api/payment-histories`, `/api/payment-summary`)
| メソッド | パス | 概要 |
|---------|------|------|
| POST | `/api/payment-histories` | 入金履歴追加 |
| DELETE | `/api/payment-histories/:id` | 入金履歴削除 |
| POST | `/api/payment-histories/import/csv` | CSVインポート |
| GET | `/api/payment-summary` | 入金状況一覧（リード単位集計） |

**入金消込** (`/api/bank-deposits`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/bank-deposits` | 銀行入金一覧 |
| GET | `/api/bank-deposits/:id` | 銀行入金詳細 |
| POST | `/api/bank-deposits` | 銀行入金登録 |
| POST | `/api/bank-deposits/:id/allocate` | 入金配分 |

**見積書管理** (`/api/quotes`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/quotes` | 見積書一覧 |
| GET | `/api/quotes/:id` | 見積書詳細 |
| PUT | `/api/quotes/:id` | 見積書更新 |
| PUT | `/api/quotes/:id/status` | ステータス変更 |
| GET | `/api/quotes/:id/status-history` | ステータス変更履歴 |
| DELETE | `/api/quotes/:id` | 見積書削除 |
| GET | `/api/quotes/:id/pdf-data` | PDF用データ取得 |

**請求書管理** (`/api/invoices`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/invoices` | 請求書一覧 |
| GET | `/api/invoices/:id` | 請求書詳細 |
| PUT | `/api/invoices/:id` | 請求書更新 |
| DELETE | `/api/invoices/:id` | 請求書削除 |
| GET | `/api/invoices/:id/pdf-data` | PDF用データ取得 |

**ダッシュボード** (`/api/dashboard`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/dashboard/summary` | ダッシュボードサマリー |
| GET | `/api/dashboard/sales-trend` | 月次売上推移 |
| GET | `/api/dashboard/pending-tasks` | 未処理タスク |

**メンバー管理** (`/api/members`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/members` | メンバー一覧 |
| POST | `/api/members/create` | メンバー作成 |
| PUT | `/api/members/:id` | メンバー更新 |
| PUT | `/api/members/:id/status` | ステータス変更 |
| DELETE | `/api/members/:id` | メンバー削除 |
| GET | `/api/members/:id/delete-impact` | 削除影響範囲確認 |
| GET | `/api/members/export/csv` | CSVエクスポート |
| POST | `/api/members/sync-users` | ユーザー同期 |
| GET | `/api/members/workload` | 稼働状況 |

**商談メモ** (`/api/meeting-notes`)
| メソッド | パス | 概要 |
|---------|------|------|
| POST | `/api/meeting-notes` | メモ作成 |
| PUT | `/api/meeting-notes/:id` | メモ更新 |
| DELETE | `/api/meeting-notes/:id` | メモ削除 |

**自社情報** (`/api/company-info`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/company-info` | 自社情報取得 |
| PUT | `/api/company-info` | 自社情報更新 |
| POST | `/api/company-info/upload-logo` | ロゴアップロード |
| POST | `/api/company-info/upload-seal` | 印鑑アップロード |
| GET | `/api/company-info/image/:type` | 画像取得 |

**管理者機能** (`/api/admin`)
| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/admin/users` | ユーザー一覧 |
| PUT | `/api/admin/users/:id/permissions` | 権限変更 |
| PUT | `/api/admin/users/:id/active` | アクティブ/非アクティブ切替 |
| POST | `/api/admin/users/:id/reset-password` | パスワードリセット |
| POST | `/api/admin/import` | データインポート |
| GET | `/api/admin/data/export/all` | 全データエクスポート |
| POST | `/api/admin/data/export/selective` | 選択エクスポート |
| POST | `/api/admin/data/import/preview` | インポートプレビュー |
| POST | `/api/admin/data/import/execute` | インポート実行 |
| POST | `/api/admin/data/import/csv` | CSVインポート |
| GET | `/api/admin/data/tables` | テーブル一覧 |

## 電子署名（電子契約）機能 ★新規

クライアントとの契約合意を電磁的に行う「電子サイン（合意記録型）」機能。
日本の電子署名法・電子帳簿保存法・JIIMA電子契約活用ガイドラインを踏まえた合意証跡を記録します。

### 実装状況（フェーズ）
- ✅ **フェーズ1・2（コア機能）実装済み**
  - 契約書ドキュメントの作成・確定（テキスト作成／PDFアップロードの両対応）
  - 確定時の SHA-256 ハッシュ記録（改ざん検知の基準値）
  - 署名依頼の発行（推測不能な一意トークン＋有効期限14日）
  - 公開署名ページ（ログイン不要・トークンで本人特定）
  - 合意フロー（氏名入力＋同意チェック＋合意ボタン）
  - 合意証跡（閲覧・合意・拒否）の監査ログ記録（IP・UA・時刻・ハッシュ）
  - 改ざん検知（合意時にハッシュ再計算・照合）／二重署名防止／期限切れ制御
- ⏳ **フェーズ3（未実装）**: Resendによる署名依頼メールの自動送信（現状は署名URLを画面表示して手動送付）
- ⏳ **フェーズ4（未実装）**: 合意証明書PDFの生成＋Google Drive保存（サービスアカウント方式）
- ⏳ **フェーズ5（一部）**: 検索要件（取引年月日・金額・取引先）強化、削除ロックの厳格化

### 画面
| 画面 | パス | 用途 |
|------|------|------|
| 電子署名管理 | `/contracts/:id/esign` | 自社担当者用。契約書作成・署名依頼発行・署名URL表示・証跡確認 |
| 公開署名ページ | `/sign/:token` | クライアント用（ログイン不要）。契約書閲覧・合意 |

### API
**管理用（要認証・`contract_manage`権限）**
- `POST /api/esign/documents` — 契約書ドキュメント作成・確定
- `GET /api/esign/contracts/:contractId/documents` — 契約のドキュメント＋署名依頼状況
- `POST /api/esign/documents/:documentId/requests` — 署名依頼発行（署名URLを返す）
- `POST /api/esign/requests/:requestId/cancel` — 署名依頼の取消
- `GET /api/esign/requests/:requestId/audit-logs` — 合意証跡（監査ログ）取得

**公開用（認証不要・トークン特定）**
- `GET /api/sign/:token` — 署名情報取得（閲覧ログ記録）
- `POST /api/sign/:token/agree` — 合意処理（ハッシュ照合・証跡記録）
- `POST /api/sign/:token/decline` — 合意拒否

### 追加テーブル（3テーブル）
`contract_documents`（契約書本体・ハッシュ）, `signature_requests`（署名依頼・トークン・期限）, `signature_audit_logs`（合意証跡・INSERT専用）

### 準備が必要な外部連携（フェーズ3・4）
- **Resend**: APIキー（`re_...`）＋認証済み送信元ドメイン
- **Google Drive**: GCPサービスアカウントJSON＋保存先DriveフォルダID（共有ドライブ推奨）
- ※いずれも `wrangler secret` で安全に管理予定（コード・Gitには残さない）

> ⚠️ 本機能は電子署名法3条の「推定効」を直接得るものではなく、適切な証跡（監査ログ・ハッシュ・タイムスタンプ）により実務上の証拠力を確保する方式です。運用開始前のリーガルチェックを推奨します。

## データモデル

### エンティティ構造
```
リード (Lead)
  └── 1:N → 案件 (Project)
        ├── 1:N → 見積書 (Quote) → 見積明細 (QuoteItem)
        ├── 1:N → 商談メモ (MeetingNote)
        └── 1:N → 契約 (Contract)
              ├── 1:N → 月次明細 (MonthlyDetail)
              │     ├── 1:N → 入金履歴 (PaymentHistory)
              │     ├── 1:N → 請求書 (Invoice) → 請求明細 (InvoiceItem)
              │     └── N:M → メンバー (MonthlyMemberAssignment)
              ├── N:M → メンバー (ContractMemberAssignment)
              └── 1:N → 契約書ドキュメント (ContractDocument)  ★電子署名
                    └── 1:N → 署名依頼 (SignatureRequest)
                          └── 1:N → 合意証跡 (SignatureAuditLog)

銀行入金 (BankDeposit) → 1:N → 入金配分 (DepositAllocation)
```

### データベーステーブル（22テーブル）
`audit_logs`, `bank_deposits`, `company_info`, `contract_member_assignments`, `contracts`, `deposit_allocations`, `invoice_items`, `invoices`, `leads`, `meeting_notes`, `members`, `monthly_details`, `monthly_member_assignments`, `payment_histories`, `projects`, `quote_items`, `quote_status_changes`, `quotes`, `status_change_histories`, `system_settings`, `user_permissions`, `users`

### 主要なビジネスルール
1. **売上計上**: 検収済 = 売上計上（発生主義）
2. **契約作成時**: 月次明細を自動生成（均等割、端数は最初の月に加算）、税込み額も自動計算
3. **ステータス変更**: 双方向遷移を許容、変更履歴を完全記録
4. **入金管理**: 分割入金に対応、過入金も許容（警告表示）
5. **税率管理**: 契約レベルで税率を設定（デフォルト10%）、月次明細に税込み額を事前計算して保存
6. **入金判定**: 入金総額と月次明細の税込み額（`amount_with_tax`）を直接比較

### 権限管理
| 権限キー | 説明 |
|---------|------|
| `lead_manage` | リード・案件の登録/更新 |
| `contract_manage` | 契約の登録/更新 |
| `billing_manage` | 請求管理 |
| `payment_manage` | 入金の登録 |
| `member_manage` | メンバー管理 |

## CSVインポート機能

### リードCSVフォーマット
```csv
会社名,部署名,担当者,メールアドレス,電話番号,ステータス,メモ
株式会社テスト,営業部,山田太郎,yamada@test.com,03-1234-5678,active,テストデータ
```

### 案件CSVフォーマット
```csv
案件名,会社名,部署名,営業担当メールアドレス,ステータス
システム開発案件,株式会社テスト,営業部,sales@example.com,active
```

### 契約CSVフォーマット（メンバーアサイン対応）
```csv
契約名,案件名,会社名,部署名,契約種別,契約日,契約開始日,契約終了日,契約金額,支払種別,アサインメンバー,ステータス
2026年Q1契約,システム開発案件,株式会社テスト,営業部,準委任,2025-12-20,2026-01-01,2026-03-31,3000000,毎月支払,yamada@example.com:800000:0.8;sato@example.com:700000:1.0,active
```

**アサインメンバーフォーマット**: `メールアドレス:単価:稼働率` をセミコロン(`;`)区切りで複数指定可能。単価・稼働率は省略可。

## システム設定

`system_settings` テーブルで管理（設定画面から変更可能）:

| 設定キー | デフォルト値 | 説明 |
|---------|------------|------|
| `fiscal_year_start_month` | `4` | 会計年度開始月 (1-12) |
| `default_allocation_mode` | `fixed` | 按分モード: fixed=固定, monthly=月次変動 |
| `require_status_change_reason` | `rollback_only` | ステータス変更理由の必須設定 |
| `allow_overpayment` | `true` | 過入金を許容するか |
| `allow_status_rollback` | `true` | ステータス巻き戻しを許容するか |

## セットアップ手順

### 1. 依存関係のインストール
```bash
cd /home/user/webapp
npm install
```

### 2. データベースのセットアップ
```bash
npm run db:reset    # マイグレーション + シードデータ投入
# または個別に実行
npm run db:migrate:local  # マイグレーションのみ
npm run db:seed           # サンプルデータ投入
```

### 3. ビルド・起動
```bash
npm run build
pm2 start ecosystem.config.cjs
```

### 4. 動作確認
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/dashboard/summary
```

## 開発コマンド

```bash
# データベース
npm run db:migrate:local   # ローカルDBマイグレーション
npm run db:migrate:prod    # 本番DBマイグレーション
npm run db:seed            # サンプルデータ投入
npm run db:reset           # DB完全リセット

# ビルド・実行
npm run build              # 本番ビルド
npm run dev:sandbox        # サンドボックス開発サーバー
npm run clean-port         # ポート3000のクリーンアップ

# デプロイ
npm run deploy             # Cloudflare Pagesにデプロイ
npm run deploy:prod        # プロジェクト名指定でデプロイ
```

## デプロイ

### 本番環境（Cloudflare Pages）
```bash
npm run build
npx wrangler pages deploy dist --project-name webapp --commit-message "Update" --commit-dirty=true
```

### データベースマイグレーション（本番）
```bash
npx wrangler d1 migrations apply webapp-production --remote
```

## コードアーキテクチャ

```
src/
├── index.tsx                  # エントリーポイント（84行 - ルート登録のみ）
├── auth.ts                    # 認証ヘルパー（パスワードハッシュ、権限チェック等）
├── renderer.tsx               # Hono JSX レンダラー
├── middleware/
│   └── auth.ts                # JWT認証・権限ミドルウェア
├── lib/
│   ├── types.ts               # 共通型定義（AppEnv等）
│   ├── constants.ts           # 共通定数（EXPORT_TABLES, PERMISSION_LABELS等）
│   ├── helpers.ts             # 共通ヘルパー（escapeCsvValue, exportTableToCsv等）
│   ├── import-helpers.ts      # データインポート関連（transformRecord, validateRecord等）
│   └── layout.ts              # HTMLレイアウトテンプレート
├── routes/
│   ├── api/                   # APIルート（16ファイル）
│   └── pages/                 # HTMLページルート（15ファイル）
public/
└── static/
    ├── auth.js                # 共通認証ユーティリティ（全ページから参照）
    ├── navbar.js              # ナビバー生成ユーティリティ
    └── style.css              # カスタムCSS
```

## プロジェクト統計

| 項目 | 数値 |
|------|------|
| コミット数 | 177件 |
| TypeScript/TSX行数 | 約20,000行 |
| ソースファイル数 | 43件 |
| マイグレーション数 | 33個 |
| データベーステーブル数 | 22個 |
| 全ルート数 | 131（GET 42, POST 29, PUT 17, DELETE 11, ページ 32） |
| バンドルサイズ | 838KB |

## トラブルシューティング

### データベースが見つからないエラー
```bash
npm run db:reset
npm run build
pm2 delete webapp
pm2 start ecosystem.config.cjs
```

### ポート3000が使用中
```bash
npm run clean-port
```

### PM2プロセスが残っている
```bash
pm2 delete all
```

## ライセンス

このプロジェクトは VALUE ARCHITECTS によって開発されています。
