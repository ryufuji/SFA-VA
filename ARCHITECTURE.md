# アーキテクチャガイド (SFA システム)

> このドキュメントはプロジェクトのコード構造と開発規約を定義します。
> 新しい機能追加・修正を行う際は、必ずこのドキュメントに従ってください。

## 1. ディレクトリ構造

```
src/
├── index.tsx                    # エントリーポイント（ルート登録のみ、84行）
│                                  ⚠️ ビジネスロジックを書かないこと
├── auth.ts                      # 認証ヘルパー（hashPassword, verifyPassword等）
├── renderer.tsx                 # Hono JSX レンダラー
│
├── middleware/
│   └── auth.ts                  # JWT認証・権限ミドルウェア
│                                  (authMiddleware, requirePermission, requireAdmin)
│
├── lib/                         # 共通ライブラリ（再利用可能な関数・型・定数）
│   ├── types.ts                 # 共通型定義（AppEnv, Bindings）
│   ├── constants.ts             # 共通定数（EXPORT_TABLES, PERMISSION_LABELS）
│   ├── helpers.ts               # 共通ヘルパー（escapeCsvValue, exportTableToCsv, updateContractStatusIfCompleted）
│   ├── import-helpers.ts        # データインポート関連（transformRecord, validateRecord, checkDuplicate, insertRecord）
│   └── layout.ts                # HTMLレイアウトテンプレート（将来の共通化用）
│
├── routes/
│   ├── api/                     # APIルート（16ファイル）
│   │   ├── leads.ts             # GET/POST/PUT /api/leads
│   │   ├── projects.ts          # GET/POST/PUT /api/projects
│   │   ├── contracts.ts         # GET/POST/PUT /api/contracts
│   │   ├── monthly-details.ts   # GET/PUT /api/monthly-details
│   │   ├── members.ts           # GET/POST/PUT /api/members
│   │   ├── quotes.ts            # GET/POST/PUT/DELETE /api/quotes
│   │   ├── invoices.ts          # GET/POST/PUT/DELETE /api/invoices
│   │   ├── bank-deposits.ts     # GET/POST /api/bank-deposits
│   │   ├── payments.ts          # GET/POST/DELETE /api/payment-*
│   │   ├── dashboard.ts         # GET /api/dashboard/*
│   │   ├── auth-routes.ts       # POST /api/auth/*
│   │   ├── admin-users.ts       # GET/PUT /api/admin/users + データインポート
│   │   ├── admin-data.ts        # GET/POST /api/admin/data/* (バックアップ/リストア)
│   │   ├── company-info.ts      # GET/PUT/POST /api/company-info
│   │   ├── meeting-notes.ts     # GET/POST/PUT/DELETE /api/meeting-notes
│   │   └── monthly-member-assignments.ts  # POST/PUT/DELETE
│   │
│   └── pages/                   # HTMLページルート（15ファイル）
│       ├── dashboard.ts         # GET /
│       ├── leads.ts             # GET /leads, /leads/:id
│       ├── projects.ts          # GET /projects, /projects/detail/:id, /projects/detail/:id/contracts/new
│       ├── contracts.ts         # GET /contracts, /contracts/:id
│       ├── monthly.ts           # GET /monthly-list, /monthly-details, /monthly/:id
│       ├── members.ts           # GET /members
│       ├── quotes.ts            # GET /quotes, /quotes/:id, /quotes/create
│       ├── invoices.ts          # GET /invoices, /invoices/:id, /invoices/create
│       ├── bank-deposits.ts     # GET /bank-deposits, /bank-deposits/:id
│       ├── payments.ts          # GET /payments
│       ├── settings.ts          # GET /settings, /settings/company, /settings/data-backup
│       ├── admin.ts             # GET /admin/users, /admin/import
│       ├── auth-pages.ts        # GET /login, /profile, /change-password
│       ├── details.ts           # GET /details
│       └── misc.ts              # GET /health, /test
│
public/
└── static/
    ├── auth.js                  # 共通認証ユーティリティ（全ページから参照）
    ├── navbar.js                # ナビバー生成ユーティリティ（将来利用）
    └── style.css                # カスタムCSS
```

## 2. コーディング規約

### 2.1 index.tsx のルール

**index.tsx はルート登録のみ。絶対にビジネスロジックを書かない。**

```typescript
// ✅ 正しい: importとapp.route()のみ
import leadsApi from './routes/api/leads'
app.route('/api/leads', leadsApi)

// ❌ 禁止: ルートハンドラーやヘルパー関数をここに書く
app.get('/api/something', async (c) => { ... })
function someHelper() { ... }
```

### 2.2 新しいAPIルートの追加手順

1. `src/routes/api/{domain}.ts` にファイルを作成
2. 以下のテンプレートに従う:

```typescript
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'

const app = new Hono<AppEnv>()

// ルートパスは index.tsx で設定したプレフィックス相対
// 例: index.tsx で app.route('/api/leads', ...) なら
//     このファイルの '/' は '/api/leads' を意味する
app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  // ...
  return c.json({ data: results })
})

export default app
```

3. `src/index.tsx` に import と route 登録を追加:

```typescript
import newDomainApi from './routes/api/new-domain'
app.route('/api/new-domain', newDomainApi)
```

### 2.3 新しいHTMLページの追加手順

1. `src/routes/pages/{domain}.ts` にファイルを作成
2. 以下のテンプレートに従う:

```typescript
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/new-page', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ページタイトル - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
    </head>
    <body>
      <!-- ナビゲーションバー -->
      <!-- ページ内容 -->

      <script>
        // ⚠️ AUTH_UTILS をここで定義しないこと（auth.js で提供済み）
        document.addEventListener('DOMContentLoaded', async function() {
          const user = await AUTH_UTILS.initPage();
          // ページ固有の初期化処理
        });
      </script>
    </body>
    </html>
  `)
})

export default app
```

3. `src/index.tsx` に import と route 登録を追加:

```typescript
import newPages from './routes/pages/new-domain'
app.route('/', newPages)
```

### 2.4 共通関数の追加ルール

| 関数の種類 | 配置先 |
|-----------|--------|
| CSV/エクスポート関連 | `src/lib/helpers.ts` |
| データインポート・変換 | `src/lib/import-helpers.ts` |
| 定数（テーブル定義、権限名等） | `src/lib/constants.ts` |
| 型定義 | `src/lib/types.ts` |
| 認証（パスワード、権限） | `src/auth.ts` |
| ミドルウェア（JWT、権限チェック） | `src/middleware/auth.ts` |
| フロントエンド共通処理 | `public/static/auth.js` |

### 2.5 フロントエンドJSのルール

- **AUTH_UTILS はインラインで定義しない。** `public/static/auth.js` に集約済み
- 各ページは `<script src="/static/auth.js"></script>` を `axios` の後に読み込む
- ページ初期化は `AUTH_UTILS.initPage()` を使う
- ページ固有のJSはインライン `<script>` で書いてよい

## 3. 絶対にやってはいけないこと

1. **index.tsx にルートハンドラーやヘルパー関数を追加しない**
   - 追加した場合、84行を超えたことで検出可能
2. **AUTH_UTILS をHTMLページにインラインで再定義しない**
   - `public/static/auth.js` を使うこと
3. **APIルートをページルートファイルに書かない**（逆も同様）
4. **共通関数をルートファイルにローカル定義しない**
   - 2箇所以上で使う関数は必ず `src/lib/` に置く
5. **`src/routes/` 直下にファイルを置かない**
   - 必ず `api/` または `pages/` サブディレクトリに配置

## 4. 構造検証

```bash
# 構造チェックスクリプトを実行
bash check_structure.sh

# ルートテスト（全画面・APIの疎通確認）
bash test_all_routes.sh
```

## 5. 技術スタック

- **バックエンド**: Hono v4 (Cloudflare Workers)
- **データベース**: Cloudflare D1 (SQLite)
- **ストレージ**: Cloudflare R2 (画像用)
- **フロントエンド**: TailwindCSS (CDN) + Vanilla JS
- **認証**: JWT (カスタム実装)
- **ビルド**: Vite + @hono/vite-cloudflare-pages
- **デプロイ**: Cloudflare Pages
