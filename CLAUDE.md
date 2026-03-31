# CLAUDE.md - AIアシスタント向け開発ガイド

> **このファイルを最初に読んでください。**
> このプロジェクトで作業する前に、必ず ARCHITECTURE.md も確認してください。

## プロジェクト概要

SFA（営業支援システム）- Hono + Cloudflare Pages + D1 のWebアプリケーション。
131ルート（API 118 + HTML画面 13）を持つ業務システム。

## 最重要ルール

### 1. index.tsx はルート登録専用（84行以下を維持）

`src/index.tsx` にビジネスロジック、ルートハンドラー、ヘルパー関数を**絶対に追加しない**。
新しいルートは必ず `src/routes/api/` または `src/routes/pages/` にファイルを作成し、
index.tsx には import と `app.route()` のみ追加する。

### 2. ファイル配置ルール

| 追加するもの | 配置先 |
|-------------|--------|
| 新しいAPIエンドポイント | `src/routes/api/{domain}.ts` を作成 |
| 新しいHTML画面 | `src/routes/pages/{domain}.ts` を作成 |
| 共通関数（2箇所以上で使用） | `src/lib/` 内の適切なファイル |
| 認証関連 | `src/auth.ts` または `src/middleware/auth.ts` |
| フロントエンド共通JS | `public/static/auth.js` |
| 定数（テーブル名、権限名等） | `src/lib/constants.ts` |

### 3. AUTH_UTILS はインラインで書かない

HTMLページ内に `const AUTH_UTILS = { ... }` を書かない。
`public/static/auth.js` に定義済み。各ページは以下で読み込む:

```html
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/auth.js"></script>
```

## 作業前チェックリスト

コードを変更する前に以下を確認:

- [ ] `ARCHITECTURE.md` を読んだか？
- [ ] 変更先のファイルは正しいディレクトリにあるか？
- [ ] index.tsx にロジックを追加していないか？
- [ ] AUTH_UTILS をインラインで再定義していないか？
- [ ] 共通関数を `src/lib/` の既存ファイルに追加できないか？

## 作業後チェックリスト

```bash
# 1. 構造チェック
bash check_structure.sh

# 2. ビルド
npm run build

# 3. サービス再起動
pm2 restart webapp

# 4. 全ルートテスト
bash test_all_routes.sh
# 期待結果: 26 PASS, 2 FAIL（データ不足の既知404）

# 5. コミット
git add -A && git commit -m "説明的なメッセージ"
```

## 新機能追加の典型パターン

### パターンA: 新しいAPIエンドポイントを追加

```bash
# 1. ルートファイルを作成
#    src/routes/api/new-feature.ts

# 2. index.tsx に2行追加
#    import newFeatureApi from './routes/api/new-feature'
#    app.route('/api/new-feature', newFeatureApi)

# 3. ビルド＆テスト
npm run build && pm2 restart webapp
```

### パターンB: 既存機能にエンドポイントを追加

```bash
# 該当するドメインファイルに直接追加
# 例: リードに新しいAPIを追加 → src/routes/api/leads.ts に追記
```

### パターンC: 新しいHTML画面を追加

```bash
# 1. ページファイルを作成
#    src/routes/pages/new-page.ts

# 2. index.tsx に2行追加
#    import newPagePages from './routes/pages/new-page'
#    app.route('/', newPagePages)

# 3. ビルド＆テスト
npm run build && pm2 restart webapp
```

## 主要ファイルの役割（参照用）

```
src/index.tsx           → ルート登録のみ（触るのは import と app.route() だけ）
src/auth.ts             → hashPassword, verifyPassword, getUserPermissions, logAction
src/middleware/auth.ts   → authMiddleware, requirePermission, requireAdmin, generateJWT
src/lib/types.ts        → AppEnv, Bindings 型定義
src/lib/constants.ts    → EXPORT_TABLES, PERMISSION_LABELS, VALID_PERMISSIONS
src/lib/helpers.ts      → escapeCsvValue, exportTableToCsv, updateContractStatusIfCompleted
src/lib/import-helpers.ts → transformRecord, normalizeStatus, validateRecord, checkDuplicate, insertRecord
public/static/auth.js   → AUTH_UTILS（フロントエンド認証）、全ページから参照
```
