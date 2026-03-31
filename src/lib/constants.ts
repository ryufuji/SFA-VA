// 共通定数定義

/**
 * テーブル定義とエクスポート順序（外部キー制約を考慮）
 */
export const EXPORT_TABLES = [
  // 独立テーブル（外部キーなし）
  { name: 'system_settings', label: 'システム設定' },
  { name: 'members', label: 'メンバー' },
  { name: 'leads', label: 'リード' },
  { name: 'users', label: 'ユーザー' },
  { name: 'company_info', label: '自社情報' },
  { name: 'bank_deposits', label: '銀行入金' },
  // 第1レベル依存
  { name: 'user_permissions', label: 'ユーザー権限' },
  { name: 'projects', label: '案件' },
  // 第2レベル依存
  { name: 'contracts', label: '契約' },
  { name: 'meeting_notes', label: '議事録' },
  // 第3レベル依存
  { name: 'monthly_details', label: '月次明細' },
  { name: 'contract_member_assignments', label: '契約メンバーアサイン' },
  { name: 'monthly_member_assignments', label: '月次メンバーアサイン' },
  { name: 'quotes', label: '見積書' },
  { name: 'invoices', label: '請求書' },
  // 第4レベル依存（bank_deposits + monthly_details に依存）
  { name: 'deposit_allocations', label: '入金消込' },
  { name: 'payment_histories', label: '入金履歴' },
  { name: 'quote_items', label: '見積書明細' },
  { name: 'quote_status_changes', label: '見積書ステータス変更履歴' },
  { name: 'invoice_items', label: '請求書明細' },
  // ログテーブル（最後）
  { name: 'status_change_histories', label: 'ステータス変更履歴' },
  { name: 'audit_logs', label: '監査ログ' }
]

/**
 * 権限ラベル
 */
export const PERMISSION_LABELS: Record<string, string> = {
  'lead_manage': 'リード・案件の登録/更新',
  'contract_manage': '契約の登録/更新',
  'billing_manage': '請求管理',
  'payment_manage': '入金の登録',
  'member_manage': 'メンバー管理'
}

/**
 * 有効な権限一覧
 */
export const VALID_PERMISSIONS = [
  'lead_manage',
  'contract_manage',
  'billing_manage',
  'payment_manage',
  'member_manage'
]
