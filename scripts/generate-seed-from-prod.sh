#!/bin/bash
#
# 本番D1データからseed SQLを生成するスクリプト
#
# 使い方:
#   bash scripts/generate-seed-from-prod.sh              # ログテーブル除外（デフォルト）
#   bash scripts/generate-seed-from-prod.sh --all        # 全テーブル含む
#   bash scripts/generate-seed-from-prod.sh --output out.sql  # 出力ファイル指定
#
set -euo pipefail

# --- 設定 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_NAME="webapp-production"
OUTPUT_FILE="$PROJECT_DIR/seed_production.sql"
INCLUDE_LOGS=false
# パスワード: va1234 の固定ハッシュ
FIXED_PASSWORD_HASH='6ClIqG+Y63TyavHx4SbhIpbw9rxSN8TOq59fD4levSB0nbaWKgEwcLW6+fXrupxp'

# EXPORT_TABLES の順序（外部キー依存順 - src/lib/constants.ts と同期）
TABLES=(
  system_settings
  members
  leads
  users
  company_info
  bank_deposits
  user_permissions
  projects
  contracts
  meeting_notes
  monthly_details
  contract_member_assignments
  monthly_member_assignments
  quotes
  invoices
  deposit_allocations
  payment_histories
  quote_items
  quote_status_changes
  invoice_items
  status_change_histories
  audit_logs
)

# ログテーブル（デフォルト除外）
LOG_TABLES=(status_change_histories audit_logs)

# --- 引数パース ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) INCLUDE_LOGS=true; shift ;;
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- 前提チェック ---
if ! command -v npx &>/dev/null; then
  echo "ERROR: npx が見つかりません" >&2; exit 1
fi
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 が見つかりません" >&2; exit 1
fi

echo "=== 本番D1データからseed SQL生成 ==="
echo "  DB: $DB_NAME"
echo "  出力: $OUTPUT_FILE"
echo "  ログテーブル: $([ "$INCLUDE_LOGS" = true ] && echo '含む' || echo '除外')"
echo ""

# --- メイン処理 ---
cd "$PROJECT_DIR"

# 一時ディレクトリ
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

total_rows=0
table_count=0

for table in "${TABLES[@]}"; do
  # ログテーブル除外判定
  if [ "$INCLUDE_LOGS" = false ]; then
    skip=false
    for lt in "${LOG_TABLES[@]}"; do
      if [ "$table" = "$lt" ]; then skip=true; break; fi
    done
    if [ "$skip" = true ]; then
      echo "  SKIP: $table (ログテーブル)"
      continue
    fi
  fi

  echo -n "  $table ... "

  # wrangler でデータ取得（JSON） → 一時ファイルに保存
  npx wrangler d1 execute "$DB_NAME" --remote --json \
    --command="SELECT * FROM $table" \
    > "$TMPDIR/${table}.json" 2>/dev/null || echo '[]' > "$TMPDIR/${table}.json"

  # JSON → INSERT SQL 変換（Python、ファイル経由で安全に処理）
  python3 << PYEOF > "$TMPDIR/${table}.sql"
import json, sys

table = "${table}"
fixed_hash = "${FIXED_PASSWORD_HASH}"
json_path = "${TMPDIR}/${table}.json"

# 巨大バイナリ/Base64カラムはNULLに置換（seed用途では不要）
NULL_COLUMNS = {
    'company_info': ['logo_base64', 'seal_base64'],
}

try:
    with open(json_path, 'r') as f:
        data = json.load(f)
except Exception:
    sys.exit(0)

results = []
if isinstance(data, list) and len(data) > 0:
    if 'results' in data[0]:
        results = data[0]['results']

if not results:
    sys.exit(0)

columns = list(results[0].keys())
is_users = (table == 'users')
null_cols = NULL_COLUMNS.get(table, [])

lines = []
for row in results:
    values = []
    for col in columns:
        val = row[col]
        if col in null_cols:
            values.append('NULL')
        elif val is None:
            values.append('NULL')
        elif is_users and col == 'password_hash':
            values.append("'" + fixed_hash + "'")
        elif isinstance(val, (int, float)):
            values.append(str(val))
        else:
            escaped = str(val).replace("'", "''")
            values.append("'" + escaped + "'")
    lines.append('(' + ', '.join(values) + ')')

cols_str = ', '.join(columns)
print(f'INSERT OR REPLACE INTO {table} ({cols_str}) VALUES')
for i, line in enumerate(lines):
    if i < len(lines) - 1:
        print(f'  {line},')
    else:
        print(f'  {line};')
print(f'-- {table}: {len(results)} rows')
print()
PYEOF

  rows=$(grep -c "^  (" "$TMPDIR/${table}.sql" 2>/dev/null || true)
  rows=${rows:-0}
  rows=$(echo "$rows" | tr -dc '0-9')
  rows=${rows:-0}
  total_rows=$((total_rows + rows))
  if [ "$rows" -gt 0 ]; then
    table_count=$((table_count + 1))
  fi
  echo "${rows} rows"
done

# --- SQLファイル結合 ---
{
  echo "-- ============================================"
  echo "-- 本番データ seed SQL"
  echo "-- 生成日時: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "-- ログテーブル: $([ "$INCLUDE_LOGS" = true ] && echo '含む' || echo '除外')"
  echo "-- ============================================"
  echo ""
  echo "-- password_hash は全ユーザー共通: va1234"
  echo ""

  for table in "${TABLES[@]}"; do
    if [ -f "$TMPDIR/${table}.sql" ] && [ -s "$TMPDIR/${table}.sql" ]; then
      echo "-- ---- ${table} ----"
      cat "$TMPDIR/${table}.sql"
    fi
  done
} > "$OUTPUT_FILE"

echo ""
echo "=== 完了 ==="
echo "  テーブル数: $table_count"
echo "  合計行数: $total_rows"
echo "  出力: $OUTPUT_FILE"
echo "  サイズ: $(wc -c < "$OUTPUT_FILE" | tr -d ' ') bytes"
