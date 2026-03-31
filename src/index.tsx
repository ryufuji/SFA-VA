import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, getUserPermissions, logAction, ADMIN_PERMISSIONS } from './auth'
import { generateJWT, authMiddleware, requirePermission, requireAdmin } from './middleware/auth'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
}


// API Routes (分割済み)
import leadsApi from './routes/api/leads'
import projectsApi from './routes/api/projects'
import meetingNotesApi from './routes/api/meeting-notes'
import contractsApi from './routes/api/contracts'
import monthlyDetailsApi from './routes/api/monthly-details'
import paymentsApi from './routes/api/payments'
import bankDepositsApi from './routes/api/bank-deposits'
import authRoutesApi from './routes/api/auth-routes'
import adminUsersApi from './routes/api/admin-users'
import adminDataApi from './routes/api/admin-data'
import membersApi from './routes/api/members'
import monthlyMemberAssignmentsApi from './routes/api/monthly-member-assignments'
import dashboardApi from './routes/api/dashboard'
import companyInfoApi from './routes/api/company-info'
import quotesApi from './routes/api/quotes'
import invoicesApi from './routes/api/invoices'

// Page Routes (分割済み)
import miscPages from './routes/pages/misc'
import authPages from './routes/pages/auth-pages'
import dashboardPages from './routes/pages/dashboard'
import leadsPages from './routes/pages/leads'
import projectsPages from './routes/pages/projects'
import contractsPages from './routes/pages/contracts'
import monthlyPages from './routes/pages/monthly'
import membersPages from './routes/pages/members'
import quotesPages from './routes/pages/quotes'
import invoicesPages from './routes/pages/invoices'
import bankDepositsPages from './routes/pages/bank-deposits'
import paymentsPages from './routes/pages/payments'
import detailsPages from './routes/pages/details'
import settingsPages from './routes/pages/settings'
import adminPages from './routes/pages/admin'


const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// API ルート登録
app.route('/api/leads', leadsApi)
app.route('/api/projects', projectsApi)
app.route('/api/meeting-notes', meetingNotesApi)
app.route('/api/contracts', contractsApi)
app.route('/api/monthly-details', monthlyDetailsApi)
app.route('/api', paymentsApi)
app.route('/api/bank-deposits', bankDepositsApi)
app.route('/api/auth', authRoutesApi)
app.route('/api/admin', adminUsersApi)
app.route('/api/admin/data', adminDataApi)
app.route('/api/members', membersApi)
app.route('/api/monthly-member-assignments', monthlyMemberAssignmentsApi)
app.route('/api/dashboard', dashboardApi)
app.route('/api/company-info', companyInfoApi)
app.route('/api/quotes', quotesApi)
app.route('/api/invoices', invoicesApi)

// Page ルート登録
app.route('/', miscPages)
app.route('/', authPages)
app.route('/', dashboardPages)
app.route('/', leadsPages)
app.route('/', projectsPages)
app.route('/', contractsPages)
app.route('/', monthlyPages)
app.route('/', membersPages)
app.route('/', quotesPages)
app.route('/', invoicesPages)
app.route('/', bankDepositsPages)
app.route('/', paymentsPages)
app.route('/', detailsPages)
app.route('/', settingsPages)
app.route('/', adminPages)




// ========================================
// Helper Functions
// ========================================

/**
 * 契約ステータスを自動更新する関数
 * 関連する月次明細がすべて「請求済」「金額と入金総額が一致」の場合、契約を「完了」に更新
 */

// ========================================
// Test Routes (データベース不要)







// 自社情報管理画面（権限必要）



// ========================================
// API Routes
// ========================================

// --- リード API ---
// リード一覧取得（認証必須、閲覧のみ）

// リード詳細取得（認証必須、閲覧のみ）

// リード作成（lead_manage権限が必要）

// リード更新（lead_manage権限が必要）

// リードステータス変更API（lead_manage権限が必要）

// --- 商談メモ API ---

// 商談メモ一覧取得API（案件別）

// 商談メモ作成API

// 商談メモ更新API

// 商談メモ削除API

// リードCSVエクスポートAPI（管理者のみ）

// リードCSVインポートAPI（管理者のみ）

// --- 案件 API ---
// 案件一覧取得（認証必須、閲覧のみ）

// 案件詳細取得（認証必須、閲覧のみ）

// 案件作成（lead_manage権限が必要）

// 案件更新（lead_manage権限が必要）

// 案件CSVエクスポートAPI（管理者のみ）

// 案件CSVインポートAPI（管理者のみ）

// --- 契約 API ---
// 契約詳細取得（認証必須、閲覧のみ）

// 契約を更新（認証必須、contract_manage権限必要）

// 契約CSVエクスポートAPI（管理者のみ）

// 契約CSVインポートAPI（管理者のみ、月次明細も自動生成）

// app.post('/api/contracts', async (c) => {
//   const { DB } = c.env
//   const body = await c.req.json()
//   const { project_id, contract_name, contract_start_date, contract_end_date, contract_amount } = body
//   
//   if (!project_id || !contract_start_date || !contract_end_date || !contract_amount) {
//     return c.json({ success: false, error: 'All fields are required' }, 400)
//   }
//   
//   // 契約を作成
//   const result = await DB.prepare(
//     'INSERT INTO contracts (project_id, contract_name, contract_start_date, contract_end_date, contract_amount, status) VALUES (?, ?, ?, ?, ?, ?)'
//   ).bind(project_id, contract_name, contract_start_date, contract_end_date, contract_amount, 'active').run()
//   
//   const contractId = result.meta.last_row_id
//   
//   // 月次明細を自動生成
//   const startDate = new Date(contract_start_date)
//   const endDate = new Date(contract_end_date)
//   
//   const months: string[] = []
//   let currentDate = new Date(startDate)
//   
//   while (currentDate <= endDate) {
//     const yearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
//     if (!months.includes(yearMonth)) {
//       months.push(yearMonth)
//     }
//     currentDate.setMonth(currentDate.getMonth() + 1)
//   }
//   
//   // 均等割で月次明細を作成
//   const amountPerMonth = Math.floor(contract_amount / months.length)
//   
//   for (const month of months) {
//     await DB.prepare(
//       'INSERT INTO monthly_details (contract_id, target_month, amount, inspection_status, billing_status, payment_status, total_payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
//     ).bind(contractId, month, amountPerMonth, '未検収', '未請求', '未入金', 0).run()
//   }
//   
//   return c.json({ success: true, data: { id: contractId, monthsGenerated: months.length } })
// })

// 上記の古い契約作成APIは390行目の新しいバージョンと重複しているため、
// 新しいバージョン（メンバーアサイン対応版）が優先されるはず

// --- 月次明細 API ---
// 未入金/部分入金の月次明細一覧（消込対象候補）
// 注意: /api/monthly-details/:id より前に定義する必要がある（ルートマッチ順序）

// 月次明細詳細取得（認証必須、閲覧のみ）

// 月次明細更新（contract_manage権限が必要）

// --- 入金履歴 API ---
// 入金追加（payment_manage権限が必要）

// 入金状況一覧API（リード単位で月毎の入金総額を取得）

// --- 入金消込 API ---

// 銀行入金一覧取得

// 銀行入金詳細取得（消込履歴含む）

// 銀行入金登録

// 消込実行

// --- 認証 API ---

// ログインAPI

// 現在のユーザー情報取得API

// パスワード変更API

// ログアウトAPI（クライアント側でトークンを削除するため、サーバー側では特に処理なし）

// --- ユーザー管理 API（管理者のみ）---

// ユーザー一覧取得API

// ユーザー権限更新API

// ユーザーアクティブ状態変更API

// パスワードリセットAPI（管理者のみ）

// --- メンバー API ---
// メンバー一覧取得（認証必須、閲覧のみ）

// メンバーCSVエクスポートAPI（管理者のみ）

// --- 契約 API ---

// API: 契約作成（contract_manage権限が必要）

// --- 月次明細 API ---

// API: 月次明細の請求情報更新（billing_manage権限が必要）

// API: 月次明細の金額更新（contract_manage権限が必要）

// API: 入金履歴削除
// 入金削除（payment_manage権限が必要）

// 入金履歴CSVインポートAPI（管理者のみ）

// API: 月次メンバーアサイン追加
// メンバーアサイン追加（contract_manage権限が必要）

// API: 月次メンバーアサイン バッチ登録
// メンバーアサイン一括追加（contract_manage権限が必要）

// API: 月次メンバーアサイン更新
// メンバーアサイン更新（contract_manage権限が必要）

// API: 月次メンバーアサイン削除
// メンバーアサイン削除（contract_manage権限が必要）

// API: メンバー一覧取得

// API: メンバー作成
// メンバー作成（管理者 または member_manage権限）

// API: メンバー更新
// メンバー更新（管理者 または member_manage権限）

// API: メンバーステータス変更
// メンバーステータス更新（管理者 または member_manage権限）

// 既存メンバーをユーザー管理に追加（管理者のみ）

// メンバー削除API（管理者のみ、無効なメンバーのみ削除可能）

// --- ダッシュボード API ---
// ダッシュボードサマリ（認証必須、閲覧のみ）

// 月次売上推移(直近12ヶ月)
// 売上推移（認証必須、閲覧のみ）

// 未処理タスク取得API
// 保留中タスク（認証必須、閲覧のみ）

// メンバー稼働状況API

// ========================================
// HTML Pages
// ========================================




// 案件詳細 (ハブ画面)





// 契約一覧画面














// 月次明細CSVエクスポートAPI（管理者のみ）

// 月次明細CSVインポートAPI（管理者のみ、既存データの更新のみ）

// ========================================
// データ削除API（管理者のみ）
// ========================================

// リード削除API（関連する案件、契約、明細も含む）

// 案件削除API（関連する契約、明細も含む）

// 契約削除API（関連する明細も含む）

// 月次明細削除の影響確認API

// 月次明細削除API（関連するメンバーアサインも含む）

// メンバー削除API（関連するアサインも含む）

// 削除前の影響確認API


// API: データインポート（管理者専用）

// レコード変換関数（Notion形式に対応）
async function transformRecord(db: D1Database, type: string, record: any, autoMatch: boolean = true): Promise<any> {
  switch (type) {
    case 'leads':
      return {
        company_name: record.company_name || record['会社名'] || record['Company Name'] || '',
        department: record.department || record['部署名'] || record['Department'] || null,
        contact_person: record.contact_person || record['担当者名'] || record['Contact Person'] || '',
        email: record.email || record['メールアドレス'] || record['Email'] || '',
        phone: record.phone || record['電話番号'] || record['Phone'] || '',
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'lead')
      }
      
    case 'members':
      return {
        name: record.name || record['名前'] || record['Name'] || '',
        email: record.email || record['メールアドレス'] || record['Email'] || '',
        default_unit_price: parseNumber(record.default_unit_price || record['単価'] || record['デフォルト単価'] || record['Unit Price'] || '0'),
        position: record.position || record['役職'] || record['Position'] || null,
        memo: record.memo || record['メモ'] || record['Memo'] || null,
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'member')
      }
      
    case 'projects':
      let leadId = null
      if (autoMatch && (record.company_name || record['会社名'] || record['Company Name'])) {
        const companyName = record.company_name || record['会社名'] || record['Company Name']
        const lead = await db.prepare('SELECT id FROM leads WHERE company_name = ?').bind(companyName).first()
        if (lead) leadId = lead.id
      }
      
      let salesRepId = null
      if (autoMatch && (record.sales_rep_email || record['営業担当メール'] || record['Sales Rep Email'])) {
        const email = record.sales_rep_email || record['営業担当メール'] || record['Sales Rep Email']
        const member = await db.prepare('SELECT id FROM members WHERE email = ?').bind(email).first()
        if (member) salesRepId = member.id
      }
      
      return {
        project_name: record.project_name || record['案件名'] || record['Project Name'] || '',
        lead_id: leadId || parseNumber(record.lead_id || ''),
        sales_rep_id: salesRepId || (record.sales_rep_id ? parseNumber(record.sales_rep_id) : null),
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'project')
      }
      
    case 'contracts':
      let projectId = null
      if (autoMatch && (record.project_name || record['案件名'] || record['Project Name'])) {
        const projectName = record.project_name || record['案件名'] || record['Project Name']
        const project = await db.prepare('SELECT id FROM projects WHERE project_name = ?').bind(projectName).first()
        if (project) projectId = project.id
      }
      
      return {
        contract_name: record.contract_name || record['契約名'] || record['Contract Name'] || '',
        project_id: projectId || parseNumber(record.project_id || ''),
        contract_start_date: normalizeDate(record.contract_start_date || record['開始日'] || record['Start Date']),
        contract_end_date: normalizeDate(record.contract_end_date || record['終了日'] || record['End Date']),
        contract_amount: parseNumber(record.contract_amount || record['契約金額'] || record['Amount'] || '0'),
        contract_type: record.contract_type || record['契約形態'] || record['Type'] || '準委任',
        payment_type: record.payment_type || record['支払形態'] || record['Payment Type'] || '毎月支払',
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'contract')
      }
      
    default:
      throw new Error('Unknown import type: ' + type)
  }
}

// ステータス正規化（Notion日本語→英語キーワード）
function normalizeStatus(value: string, entityType: string): string {
  if (!value) return 'active'
  
  const statusMaps: Record<string, Record<string, string>> = {
    lead: {
      'アクティブ': 'active', '有効': 'active', 'Active': 'active',
      'アーカイブ': 'archived', '終了': 'archived', 'Archived': 'archived'
    },
    member: {
      'アクティブ': 'active', '有効': 'active', 'Active': 'active',
      '無効': 'inactive', 'Inactive': 'inactive'
    },
    project: {
      '進行中': 'active', '商談中': 'active', 'Active': 'active',
      '受注': 'won', '成約': 'won', '完了': 'won', 'Won': 'won',
      '失注': 'lost', 'キャンセル': 'lost', 'Lost': 'lost',
      'アーカイブ': 'archived', '終了': 'archived', 'Archived': 'archived'
    },
    contract: {
      '下書き': 'draft', 'Draft': 'draft',
      'アクティブ': 'active', '有効': 'active', '進行中': 'active', 'Active': 'active',
      '完了': 'completed', 'Completed': 'completed',
      '終了': 'terminated', '解約': 'terminated', 'Terminated': 'terminated'
    }
  }
  
  const map = statusMaps[entityType] || {}
  return map[value] || value.toLowerCase()
}

// 日付正規化（Notion ISO形式→YYYY-MM-DD）
function normalizeDate(value: string | null | undefined): string {
  if (!value) return ''
  
  // Notion ISO 8601形式: 2026-01-15T00:00:00.000Z
  if (value.includes('T')) {
    return value.split('T')[0]
  }
  
  // すでにYYYY-MM-DD形式
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  
  // その他の形式
  try {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }
  } catch (e) {
    // 変換失敗
  }
  
  return value
}

// 数値パース（カンマ区切り対応）
function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  
  // カンマを削除して数値化
  const cleaned = String(value).replace(/,/g, '').trim()
  const num = parseInt(cleaned)
  return isNaN(num) ? 0 : num
}

// バリデーション
function validateRecord(type: string, record: any): string | null {
  switch (type) {
    case 'leads':
      if (!record.company_name || record.company_name.trim() === '') {
        return '会社名は必須です'
      }
      break
      
    case 'members':
      if (!record.name || record.name.trim() === '') {
        return '名前は必須です'
      }
      if (!record.email || record.email.trim() === '') {
        return 'メールアドレスは必須です'
      }
      if (!record.default_unit_price || record.default_unit_price <= 0) {
        return 'デフォルト単価は必須です'
      }
      break
      
    case 'projects':
      if (!record.project_name || record.project_name.trim() === '') {
        return '案件名は必須です'
      }
      if (!record.lead_id || record.lead_id <= 0) {
        return 'リードIDが見つかりません（会社名を確認してください）'
      }
      break
      
    case 'contracts':
      if (!record.contract_name || record.contract_name.trim() === '') {
        return '契約名は必須です'
      }
      if (!record.project_id || record.project_id <= 0) {
        return '案件IDが見つかりません（案件名を確認してください）'
      }
      if (!record.contract_start_date) {
        return '開始日は必須です'
      }
      if (!record.contract_end_date) {
        return '終了日は必須です'
      }
      if (!record.contract_amount || record.contract_amount <= 0) {
        return '契約金額は必須です'
      }
      break
  }
  
  return null
}

// 重複チェック
async function checkDuplicate(db: D1Database, type: string, record: any): Promise<boolean> {
  try {
    switch (type) {
      case 'leads':
        // 会社名と部署名の組み合わせでチェック
        const lead = await db.prepare(
          'SELECT id FROM leads WHERE company_name = ? AND COALESCE(department, \'\') = ?'
        ).bind(record.company_name, record.department || '').first()
        return !!lead
        
      case 'members':
        const member = await db.prepare('SELECT id FROM members WHERE email = ?').bind(record.email).first()
        return !!member
        
      case 'projects':
        const project = await db.prepare('SELECT id FROM projects WHERE project_name = ? AND lead_id = ?')
          .bind(record.project_name, record.lead_id).first()
        return !!project
        
      case 'contracts':
        const contract = await db.prepare('SELECT id FROM contracts WHERE contract_name = ? AND project_id = ?')
          .bind(record.contract_name, record.project_id).first()
        return !!contract
        
      default:
        return false
    }
  } catch (e) {
    return false
  }
}

// レコード挿入
async function insertRecord(db: D1Database, type: string, record: any): Promise<void> {
  switch (type) {
    case 'leads':
      await db.prepare(`
        INSERT INTO leads (company_name, department, contact_person, email, phone, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        record.company_name,
        record.department,
        record.contact_person,
        record.email,
        record.phone,
        record.status
      ).run()
      break
      
    case 'members':
      await db.prepare(`
        INSERT INTO members (name, email, default_unit_price, position, memo, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        record.name,
        record.email,
        record.default_unit_price,
        record.position,
        record.memo,
        record.status
      ).run()
      
      // ユーザーも自動作成（メールアドレスがある場合のみ）
      if (record.email) {
        const existingUser = await db.prepare(`
          SELECT id FROM users WHERE email = ?
        `).bind(record.email).first()

        if (!existingUser) {
          const defaultPassword = record.email.split('@')[0] + '1234'
          const hashedPassword = await hashPassword(defaultPassword)
          
          await db.prepare(`
            INSERT INTO users (name, email, password, role, password_change_required)
            VALUES (?, ?, ?, ?, ?)
          `).bind(record.name, record.email, hashedPassword, 'none', 1).run()
        }
      }
      break
      
    case 'projects':
      await db.prepare(`
        INSERT INTO projects (project_name, lead_id, sales_rep_id, status)
        VALUES (?, ?, ?, ?)
      `).bind(
        record.project_name,
        record.lead_id,
        record.sales_rep_id,
        record.status
      ).run()
      break
      
    case 'contracts':
      await db.prepare(`
        INSERT INTO contracts (contract_name, project_id, contract_start_date, contract_end_date, contract_amount, contract_type, payment_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.contract_name,
        record.project_id,
        record.contract_start_date,
        record.contract_end_date,
        record.contract_amount,
        record.contract_type,
        record.payment_type,
        record.status
      ).run()
      break
  }
}

// ========================================
// 自社情報管理 API
// ========================================

// 自社情報取得API（認証必須）

// 自社情報更新API（can_edit_company_info権限必要）

// ロゴ画像アップロードAPI（can_edit_company_info権限必要）

// 会社印画像アップロードAPI（can_edit_company_info権限必要）

// Base64画像取得API（認証必須）

// ========================================
// 見積書管理 API
// ========================================

// 見積書一覧取得API（認証必須）

// 見積書詳細取得API（認証必須）

// プロジェクトの見積書一覧取得API（認証必須）

// 見積書作成API（lead_manage権限必要）

// 見積書更新API（lead_manage権限必要）

// 見積書ステータス変更API（lead_manage権限必要）

// 見積書ステータス変更履歴取得API（認証必須）

// 見積書削除API（lead_manage権限必要）

// PDF生成用データ取得API（認証必須）

// ========================================
// 請求書管理 API
// ========================================

// 請求書一覧取得API（認証必須）

// 請求書詳細取得API（認証必須）

// 月次明細から請求書作成API（lead_manage権限必要）

// 請求書更新API（lead_manage権限必要）

// 請求書削除API（admin権限必要）

// 請求書PDF用データ取得API（認証必須）

// ========================================
// データバックアップ・リストア API（管理者のみ）


// テーブルデータをCSV形式で取得
async function exportTableToCsv(DB: D1Database, tableName: string): Promise<string> {
  try {
    // テーブル情報を取得
    const { results: tableInfo } = await DB.prepare(
      `PRAGMA table_info(${tableName})`
    ).all()
    
    if (!tableInfo || tableInfo.length === 0) {
      return '' // テーブルが存在しない
    }
    
    // カラム名を取得
    const columns = tableInfo.map((col: any) => col.name)
    
    // データを取得（パスワードは除外）
    let query = `SELECT * FROM ${tableName}`
    let exportColumns = columns
    
    if (tableName === 'users') {
      // ユーザーテーブルの場合、パスワードハッシュは除外
      exportColumns = columns.filter(col => col !== 'password_hash')
      query = `SELECT ${exportColumns.join(', ')} FROM ${tableName}`
    }
    
    const { results } = await DB.prepare(query).all()
    
    // CSVヘッダー（エクスポート対象のカラムのみ）
    let csv = exportColumns.join(',') + '\n'
    
    // データ行
    if (results) {
      for (const row of results) {
        const values = exportColumns.map(col => {
          const value = (row as any)[col]
          return escapeCsvValue(value)
        })
        csv += values.join(',') + '\n'
      }
    }
    
    return csv
  } catch (error) {
    console.error(`Error exporting table ${tableName}:`, error)
    return ''
  }
}

// 全データエクスポートAPI

// テーブル選択エクスポートAPI

// インポートプレビューAPI

// インポート実行API

// CSV単体インポートAPI（管理者専用）

// エクスポート可能なテーブル一覧取得API


export default app
