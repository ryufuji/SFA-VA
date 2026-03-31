// データインポート・変換ヘルパー関数
import { hashPassword } from '../auth'

/**
 * レコード変換関数（Notion形式に対応）
 */
export async function transformRecord(db: D1Database, type: string, record: any, autoMatch: boolean = true): Promise<any> {
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
      
    case 'projects': {
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
    }
      
    case 'contracts': {
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
    }
      
    default:
      throw new Error('Unknown import type: ' + type)
  }
}

/**
 * ステータス正規化（Notion日本語→英語キーワード）
 */
export function normalizeStatus(value: string, entityType: string): string {
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

/**
 * 日付正規化（Notion ISO形式→YYYY-MM-DD）
 */
export function normalizeDate(value: string | null | undefined): string {
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

/**
 * 数値パース（カンマ区切り対応）
 */
export function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  
  // カンマを削除して数値化
  const cleaned = String(value).replace(/,/g, '').trim()
  const num = parseInt(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * バリデーション
 */
export function validateRecord(type: string, record: any): string | null {
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

/**
 * 重複チェック
 */
export async function checkDuplicate(db: D1Database, type: string, record: any): Promise<boolean> {
  try {
    switch (type) {
      case 'leads': {
        const lead = await db.prepare(
          'SELECT id FROM leads WHERE company_name = ? AND COALESCE(department, \'\') = ?'
        ).bind(record.company_name, record.department || '').first()
        return !!lead
      }
        
      case 'members': {
        const member = await db.prepare('SELECT id FROM members WHERE email = ?').bind(record.email).first()
        return !!member
      }
        
      case 'projects': {
        const project = await db.prepare('SELECT id FROM projects WHERE project_name = ? AND lead_id = ?')
          .bind(record.project_name, record.lead_id).first()
        return !!project
      }
        
      case 'contracts': {
        const contract = await db.prepare('SELECT id FROM contracts WHERE contract_name = ? AND project_id = ?')
          .bind(record.contract_name, record.project_id).first()
        return !!contract
      }
        
      default:
        return false
    }
  } catch (e) {
    return false
  }
}

/**
 * レコード挿入
 */
export async function insertRecord(db: D1Database, type: string, record: any): Promise<void> {
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
