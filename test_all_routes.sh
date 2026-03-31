#!/bin/bash
# 全ルート動作確認スクリプト
# 認証不要のルート（HTML画面）と認証必要のAPIを確認

BASE="http://localhost:3000"
PASS=0
FAIL=0
ERRORS=""

check() {
  local url="$1"
  local expected_code="$2"
  local desc="$3"
  
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$code" = "$expected_code" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL: $desc ($url) expected=$expected_code got=$code"
  fi
}

echo "=== HTML画面ルート ==="
check "$BASE/health" "200" "Health"
check "$BASE/login" "200" "Login"
check "$BASE/test" "200" "Test"
check "$BASE/" "200" "Dashboard"
check "$BASE/leads" "200" "Leads"
check "$BASE/leads/1" "200" "Lead Detail"
check "$BASE/projects" "200" "Projects"
check "$BASE/projects/detail/1" "200" "Project Detail"
check "$BASE/contracts" "200" "Contracts"
check "$BASE/contracts/1" "200" "Contract Detail"
check "$BASE/monthly/1" "200" "Monthly Detail"
check "$BASE/monthly-list" "200" "Monthly List"
check "$BASE/monthly-details" "200" "Monthly Details"
check "$BASE/members" "200" "Members"
check "$BASE/quotes" "200" "Quotes"
check "$BASE/invoices" "200" "Invoices"
check "$BASE/payments" "200" "Payments"
check "$BASE/bank-deposits" "200" "Bank Deposits"
check "$BASE/details" "200" "Details"
check "$BASE/profile" "200" "Profile"
check "$BASE/change-password" "200" "Change Password"
check "$BASE/settings" "200" "Settings"
check "$BASE/settings/company" "200" "Company Settings"
check "$BASE/settings/data-backup" "200" "Data Backup"
check "$BASE/admin/users" "200" "Admin Users"
check "$BASE/admin/import" "200" "Admin Import"

echo "=== API (認証なし→401期待) ==="
check "$BASE/api/leads" "401" "API Leads (no auth)"
check "$BASE/api/dashboard/summary" "401" "API Dashboard (no auth)"

echo ""
echo "=== 結果 ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ $FAIL -gt 0 ]; then
  echo -e "  エラー詳細:$ERRORS"
fi
echo ""
[ $FAIL -eq 0 ] && echo "✅ 全ルート正常" || echo "❌ 失敗あり"
