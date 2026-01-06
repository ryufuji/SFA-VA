# SFA (営業支援システム)

## プロジェクト概要
- **名前**: SFA (Sales Force Automation)
- **目的**: 見込み顧客から継続取引までを一気通貫で管理
- **技術スタック**: Hono + Cloudflare Pages + D1 Database + TailwindCSS

## 🌐 公開URL (サンドボックス環境)

**ダッシュボード**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/

**リード一覧**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/leads

**リード詳細 (例)**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/leads/1

**案件詳細 (例)**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/projects/1

**契約詳細 (例)**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/contracts/2

**月次明細詳細 (例)**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/monthly/4

**システムステータス**: https://3000-iv7sqp6gryhcbuljunite-dfc00ec5.sandbox.novita.ai/health

## 現在の実装状況

### ✅ 完了した機能 (Phase 1 - MVP)
- **✅ データベース基盤**
  - D1 Database (SQLite) の統合完了
  - 10テーブルの完全なスキーマ実装（月次メンバーアサイン追加）
  - マイグレーション・シードデータ投入済み
  - ローカル開発環境セットアップ完了
  
- **✅ 画面実装 (SSR with Hono)**
  - ✅ トップダッシュボード
    - 月次売上（確定/未検収）、未請求・未入金金額の表示
    - 月次売上推移グラフ (Chart.js)
    - 最近の契約一覧
  - ✅ リード一覧・作成機能
    - 一覧表示 (ページネーション未実装)
    - モーダルでの新規作成
  - ✅ リード詳細画面
    - 基本情報表示
    - 関連案件の一覧表示
  - ✅ 案件詳細画面 (ハブ画面)
    - 案件基本情報表示
    - 関連する契約一覧
    - 契約追加ボタン
  - ✅ 契約詳細画面 (タブ構造)
    - サマリーカード (契約金額、検収済、請求済、入金済)
    - 月次明細タブ (一覧表示)
    - アサインメンバータブ (一覧表示、按分比率表示)
  - ✅ **月次明細詳細画面** ⭐ NEW
    - 基本情報表示と金額編集
    - 検収情報管理（ステータス・日付）
    - 請求情報管理（ステータス・日付・請求書番号）
    - 入金管理（履歴一覧・追加・削除、進捗表示）
    - 月次メンバーアサイン（この月のみ、按分比率・想定売上）
    - 変更履歴表示（監査証跡）

- **✅ API実装** (RESTful)
  - ダッシュボードAPI (サマリー、売上推移)
  - リード管理 (一覧、詳細、作成)
  - 案件管理 (詳細取得)
  - 契約管理 (詳細取得、月次明細・メンバー含む)
  - **月次明細管理** ⭐ NEW
    - 検収情報更新
    - 請求情報更新
    - 金額編集
    - 入金履歴追加・削除
    - 変更履歴記録
  
### 🚧 次に実装する機能 (Phase 1 残り)
- 🔲 契約作成機能
  - 契約情報入力フォーム
  - 月次明細の自動生成 (任意期間対応)
  - 月次メンバーアサインの初期設定
- 🔲 案件作成機能
  - リードから案件への変換
  - 案件情報入力フォーム
- 🔲 メンバー管理画面
  - メンバー一覧・作成・編集
  - メンバー詳細
  - デフォルト単価設定
- 🔲 月次メンバーアサイン管理機能
  - メンバー追加・編集・削除のUI
  - 按分比率の一括調整
  - 契約期間全体のコピー機能
- 🔲 高度な警告機能
  - 契約金額と月次明細合計の差異警告
  - 過入金の詳細表示
  - ステータス遷移の順序警告

### 📋 Phase 2 以降の機能
- 認証・権限管理
- ワークフロー・アラート機能
- メール通知
- 営業活動履歴
- 月次按分の変動管理

## データモデル

### エンティティ構造
```
リード (Lead)
  └── 1:N → 案件 (Project)
        └── 1:N → 契約 (Contract)
              ├── 1:N → 月次明細 (MonthlyDetail)
              │     └── 1:N → 入金履歴 (PaymentHistory)
              └── N:M → メンバー (Member)
```

### 主要なビジネスルール
1. **売上計上**: 検収済 = 売上計上 (発生主義)
2. **契約作成時**: 月次明細を自動生成 (均等割)
3. **ステータス変更**: 双方向遷移を許容、変更履歴を記録
4. **入金管理**: 分割入金に対応、過入金も許容(警告表示)
5. **削除不可**: リード、案件、契約、月次明細は削除禁止 (ステータス管理)

## セットアップ手順

### 1. 依存関係のインストール
```bash
cd /home/user/webapp
npm install
```

### 2. データベースのセットアップ
```bash
# データベースのリセット (マイグレーション + シードデータ投入)
npm run db:reset

# または個別に実行
npm run db:migrate:local  # マイグレーション実行
npm run db:seed           # サンプルデータ投入
```

### 3. ビルド
```bash
npm run build
```

### 4. 開発サーバーの起動

#### 方法A: PM2 (推奨 - サンドボックス環境用)
```bash
# ポートのクリーンアップ
npm run clean-port

# PM2で起動
pm2 start ecosystem.config.cjs

# ログ確認
pm2 logs webapp --nostream

# 停止
pm2 delete webapp
```

#### 方法B: 直接起動 (ローカルマシン用)
```bash
npm run dev:sandbox
```

### 5. 動作確認
```bash
# ヘルスチェック
curl http://localhost:3000

# APIテスト
curl http://localhost:3000/api/leads
curl http://localhost:3000/api/dashboard/summary
```

## URLs

### 開発環境
- **Web UI**: http://localhost:3000
- **API Base**: http://localhost:3000/api

### 主要なエンドポイント
- `GET /` - トップダッシュボード
- `GET /leads` - リード一覧
- `GET /api/leads` - リードAPI (一覧)
- `POST /api/leads` - リード作成
- `GET /api/contracts/:id` - 契約詳細
- `POST /api/contracts` - 契約作成 (月次明細自動生成)
- `PUT /api/monthly-details/:id` - 月次明細更新
- `POST /api/payment-histories` - 入金履歴追加
- `GET /api/dashboard/summary` - ダッシュボードサマリー
- `GET /api/dashboard/sales-trend` - 月次売上推移

## 開発コマンド

```bash
# データベース関連
npm run db:migrate:local   # ローカルDBマイグレーション
npm run db:migrate:prod    # 本番DBマイグレーション
npm run db:seed            # サンプルデータ投入
npm run db:reset           # DB完全リセット
npm run db:console:local   # ローカルDB接続

# ビルド・実行
npm run build              # 本番ビルド
npm run dev:sandbox        # サンドボックス開発サーバー
npm run clean-port         # ポート3000のクリーンアップ
npm run test               # 簡易動作確認

# デプロイ
npm run deploy             # Cloudflare Pagesにデプロイ
npm run deploy:prod        # プロジェクト名指定でデプロイ
```

## システム設定 (未回答の質問対応)

システム設定は `system_settings` テーブルで管理されており、後から変更可能です:

| 設定キー | デフォルト値 | 説明 |
|---------|------------|------|
| `fiscal_year_start_month` | `4` | 会計年度開始月 (1-12) |
| `default_allocation_mode` | `fixed` | 按分モード: fixed=固定, monthly=月次変動 |
| `require_status_change_reason` | `rollback_only` | ステータス変更理由: always=常に必須, rollback_only=巻き戻し時のみ, never=不要 |
| `allow_overpayment` | `true` | 過入金を許容するか |
| `allow_status_rollback` | `true` | ステータス巻き戻しを許容するか |

### 設定変更方法
```bash
# SQLで直接変更
npm run db:console:local

# 例: 会計年度を1月開始に変更
UPDATE system_settings SET value = '1' WHERE key = 'fiscal_year_start_month';

# 例: ステータス変更理由を常に必須に
UPDATE system_settings SET value = 'always' WHERE key = 'require_status_change_reason';
```

## サンプルデータ

以下のサンプルデータが含まれています:
- リード: 3社
- 案件: 3件
- 契約: 3件 (Q1 2026, Q2 2026, 単月契約)
- 月次明細: 7件 (各種ステータス)
- 入金履歴: 2件
- メンバー: 3名
- 契約メンバーアサイン: 4件

## 次のステップ

### Phase 1 残りタスク (優先度順)
1. **P0 画面実装** (Week 1-2)
   - [ ] リード詳細画面
   - [ ] 案件詳細画面 (ハブ画面)
   - [ ] 契約詳細画面 (タブ構造)
   - [ ] 月次明細詳細画面

2. **P1 画面実装** (Week 3-4)
   - [ ] メンバー一覧・詳細画面
   - [ ] 契約メンバー管理画面
   - [ ] 売上ダッシュボード

3. **P2 機能追加** (Week 5-6)
   - [ ] 簡易認証機能
   - [ ] 警告表示の実装
   - [ ] ステータス変更履歴の表示充実

### Phase 2 機能 (3-6ヶ月目)
- 月次按分の変動管理
- ワークフロー・アラート機能
- メール通知 (Resend)
- 権限管理 (ロールベース)
- 営業活動履歴

### Phase 3 機能 (6ヶ月以降)
- 売上予測
- 原価管理
- メンバー稼働最適化提案
- 外部API連携 (会計システム等)

## トラブルシューティング

### データベースが見つからないエラー
```bash
# .wranglerディレクトリをクリーンして再構築
npm run db:reset
npm run build
pm2 delete webapp
pm2 start ecosystem.config.cjs
```

### ポート3000が使用中
```bash
npm run clean-port
# または
fuser -k 3000/tcp
```

### PM2プロセスが残っている
```bash
pm2 delete all
pm2 list
```

## 最終更新日
2026-01-06

## 開発者メモ

### 設計判断のログ
- **契約期間**: 任意の期間を許容 (1ヶ月〜12ヶ月)
- **月次明細金額**: 編集可能、契約金額との差異は警告のみ
- **メンバー按分**: Phase 1は固定按分のみ
- **ステータス巻き戻し**: 許容、変更履歴を完全記録
- **入金管理**: 発生主義 (検収ベース売上計上)

### 既知の問題
- PM2起動時に`.wrangler`ディレクトリのパスが一致しない場合がある
  - 解決策: `npm run db:reset` でデータベースを再構築
- D1 Databaseのローカル開発時、wrangler pages devが別のDBインスタンスを使用する可能性
  - 対策: `--persist-to ./.wrangler` オプションを使用

### 今後の改善点
- 認証機能の追加 (Cloudflare Access or 独自実装)
- エラーハンドリングの強化
- フロントエンドのコンポーネント化
- TypeScript型定義の整備
