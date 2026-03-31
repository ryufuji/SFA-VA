#!/bin/bash
# check_structure.sh - プロジェクト構造の検証スクリプト
# リファクタリング後のコード構造が維持されているか自動チェックする

set -uo pipefail

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); }
warn() { echo "  ⚠️  $1"; ((WARN++)); }

echo "=== プロジェクト構造チェック ==="
echo ""

# --- 1. index.tsx の行数チェック ---
echo "[1] index.tsx の行数"
INDEX_LINES=$(wc -l < src/index.tsx)
if [ "$INDEX_LINES" -le 120 ]; then
  pass "index.tsx: ${INDEX_LINES}行（上限120行）"
else
  fail "index.tsx: ${INDEX_LINES}行（上限120行を超過！ロジックが混入した可能性）"
fi

# --- 2. index.tsx にルートハンドラーがないか ---
echo "[2] index.tsx にビジネスロジックがないか"
# app.route() はOK、app.get()/post()/put()/delete() はNG
if grep -qE "app\.(get|post|put|delete|patch)\(" src/index.tsx; then
  fail "index.tsx にルートハンドラー (app.get/post/...) が定義されている"
else
  pass "index.tsx にルートハンドラーなし"
fi

if grep -qE "^(export )?(async )?function " src/index.tsx; then
  fail "index.tsx にヘルパー関数が定義されている"
else
  pass "index.tsx にヘルパー関数なし"
fi

# --- 3. AUTH_UTILS のインライン定義チェック ---
echo "[3] AUTH_UTILS がインラインで定義されていないか"
AUTH_INLINE=$(grep -rl "const AUTH_UTILS = {" src/routes/pages/ 2>/dev/null || true)
if [ -z "$AUTH_INLINE" ]; then
  pass "HTMLページにインラインAUTH_UTILS定義なし"
else
  fail "以下のファイルにインラインAUTH_UTILS定義あり:"
  echo "$AUTH_INLINE" | while read f; do echo "       $f"; done
fi

# --- 4. auth.js の外部参照チェック ---
echo "[4] HTMLページが auth.js を外部参照しているか"
MISSING_AUTH_REF=0
for f in src/routes/pages/*.ts; do
  BASENAME=$(basename "$f")
  # auth-pages.ts と misc.ts はログイン画面等なので除外可
  if [ "$BASENAME" = "auth-pages.ts" ] || [ "$BASENAME" = "misc.ts" ]; then
    continue
  fi
  if ! grep -q '/static/auth.js' "$f"; then
    warn "${BASENAME} に /static/auth.js の参照がない"
    ((MISSING_AUTH_REF++))
  fi
done
if [ "$MISSING_AUTH_REF" -eq 0 ]; then
  pass "全HTMLページが auth.js を外部参照している"
fi

# --- 5. src/routes/ 直下にファイルがないか ---
echo "[5] src/routes/ 直下の孤立ファイル"
ORPHANS=$(find src/routes -maxdepth 1 -name '*.ts' 2>/dev/null || true)
if [ -z "$ORPHANS" ]; then
  pass "src/routes/ 直下に孤立ファイルなし"
else
  fail "src/routes/ 直下にファイルあり（api/ か pages/ に移動すべき）:"
  echo "$ORPHANS" | while read f; do echo "       $f"; done
fi

# --- 6. APIルートがpagesファイルにないか（基本チェック） ---
echo "[6] ページファイルにAPIルートが混入していないか"
API_IN_PAGES=$(grep -l "return c.json" src/routes/pages/*.ts 2>/dev/null || true)
if [ -z "$API_IN_PAGES" ]; then
  pass "ページファイルにAPIレスポンス (c.json) なし"
else
  warn "以下のページファイルに c.json 呼び出しあり（意図的でなければ要確認）:"
  echo "$API_IN_PAGES" | while read f; do echo "       $(basename $f)"; done
fi

# --- 7. 共通ライブラリの存在チェック ---
echo "[7] 共通ライブラリファイルの存在"
for f in src/lib/types.ts src/lib/constants.ts src/lib/helpers.ts src/lib/import-helpers.ts; do
  if [ -f "$f" ]; then
    pass "$f 存在"
  else
    fail "$f が見つからない"
  fi
done

# --- 8. public/static/auth.js の存在チェック ---
echo "[8] フロントエンド共通ファイル"
if [ -f "public/static/auth.js" ]; then
  pass "public/static/auth.js 存在"
else
  fail "public/static/auth.js が見つからない"
fi

# --- 9. ファイル数の健全性チェック ---
echo "[9] ファイル数の健全性"
API_COUNT=$(ls src/routes/api/*.ts 2>/dev/null | wc -l)
PAGE_COUNT=$(ls src/routes/pages/*.ts 2>/dev/null | wc -l)
echo "  📊 APIルートファイル: ${API_COUNT}個, ページルートファイル: ${PAGE_COUNT}個"
if [ "$API_COUNT" -ge 10 ] && [ "$PAGE_COUNT" -ge 10 ]; then
  pass "ルートファイル数は健全（API:${API_COUNT} Pages:${PAGE_COUNT}）"
else
  warn "ルートファイル数が想定より少ない（統合された？）"
fi

# --- 結果サマリ ---
echo ""
echo "=== 結果 ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "❌ 構造違反が検出されました。ARCHITECTURE.md を確認してください。"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "⚠️  警告あり（致命的ではないが確認推奨）"
  exit 0
else
  echo "✅ すべてのチェックをパスしました"
  exit 0
fi
