import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// 静的ファイルの配信
app.use('/static/*', serveStatic({ root: './public' }))

// ========================================
// Test Routes (データベース不要)
// ========================================
app.get('/health', (c) => {
  return c.json({ status: 'ok', message: 'SFA API is running', timestamp: new Date().toISOString() })
})

app.get('/test', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SFA Test Page</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 p-8">
      <div class="max-w-4xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 class="text-3xl font-bold text-blue-600 mb-4">🎉 SFA システムが起動しました!</h1>
        <p class="text-gray-700 mb-4">データベース統合前のテストページです。</p>
        <div class="space-y-2">
          <p><strong>ステータス:</strong> <span class="text-green-600">稼働中</span></p>
          <p><strong>時刻:</strong> ${new Date().toISOString()}</p>
        </div>
        <div class="mt-6">
          <a href="/" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            ダッシュボードへ (DB接続後)
          </a>
        </div>
      </div>
    </body>
    </html>
  `)
})

// ========================================
// API Routes
// ========================================

// --- リード API ---
app.get('/api/leads', async (c) => {
  const { DB } = c.env
  const { status, search } = c.req.query()
  
  let query = 'SELECT * FROM leads WHERE 1=1'
  const params: any[] = []
  
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  
  if (search) {
    query += ' AND (company_name LIKE ? OR contact_person LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  
  query += ' ORDER BY created_at DESC'
  
  const { results } = await DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: results })
})

app.get('/api/leads/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first()
  if (!lead) {
    return c.json({ success: false, error: 'Lead not found' }, 404)
  }
  
  // 関連する案件も取得
  const { results: projects } = await DB.prepare(
    'SELECT * FROM projects WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...lead, projects } })
})

app.post('/api/leads', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { company_name, contact_person, email, phone } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO leads (company_name, contact_person, email, phone, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(company_name, contact_person || null, email || null, phone || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// --- 案件 API ---
app.get('/api/projects/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  
  // リード情報を取得
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first()
  
  // 契約一覧を取得
  const { results: contracts } = await DB.prepare(
    'SELECT * FROM contracts WHERE project_id = ? ORDER BY contract_start_date DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...project, lead, contracts } })
})

app.post('/api/projects', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { lead_id, project_name } = body
  
  if (!lead_id || !project_name) {
    return c.json({ success: false, error: 'Lead ID and project name are required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO projects (lead_id, project_name, status) VALUES (?, ?, ?)'
  ).bind(lead_id, project_name, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// --- 契約 API ---
app.get('/api/contracts/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const contract = await DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first()
  if (!contract) {
    return c.json({ success: false, error: 'Contract not found' }, 404)
  }
  
  // 月次明細を取得
  const { results: monthlyDetails } = await DB.prepare(
    'SELECT * FROM monthly_details WHERE contract_id = ? ORDER BY target_month ASC'
  ).bind(id).all()
  
  // メンバーアサインを取得
  const { results: members } = await DB.prepare(`
    SELECT cma.*, m.name as member_name 
    FROM contract_member_assignments cma
    JOIN members m ON cma.member_id = m.id
    WHERE cma.contract_id = ?
  `).bind(id).all()
  
  // 契約金額と月次明細合計の差異を計算
  const monthlyTotal = monthlyDetails.reduce((sum: number, detail: any) => sum + detail.amount, 0)
  const difference = (contract as any).contract_amount - monthlyTotal
  
  return c.json({ 
    success: true, 
    data: { 
      ...contract, 
      monthlyDetails, 
      members,
      monthlyTotal,
      difference
    } 
  })
})

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
app.get('/api/monthly-details/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const detail = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!detail) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // 入金履歴を取得
  const { results: paymentHistories } = await DB.prepare(
    'SELECT * FROM payment_histories WHERE monthly_detail_id = ? ORDER BY payment_date ASC'
  ).bind(id).all()
  
  // ステータス変更履歴を取得
  const { results: statusHistories } = await DB.prepare(
    'SELECT * FROM status_change_histories WHERE table_name = ? AND record_id = ? ORDER BY changed_at DESC LIMIT 10'
  ).bind('monthly_details', id).all()
  
  return c.json({ success: true, data: { ...detail, paymentHistories, statusHistories } })
})

app.put('/api/monthly-details/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { 
    amount, 
    inspection_status, 
    inspection_date, 
    inspection_reason,
    billing_status, 
    billing_date, 
    invoice_number,
    billing_reason
  } = body
  
  // 現在の値を取得
  const current = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (!current) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // システム設定を取得
  const requireReasonSetting = await DB.prepare(
    'SELECT value FROM system_settings WHERE key = ?'
  ).bind('require_status_change_reason').first() as any
  
  const requireReason = requireReasonSetting?.value || 'rollback_only'
  
  // ステータス変更履歴を記録
  if (inspection_status && inspection_status !== current.inspection_status) {
    // 巻き戻しの場合、理由が必須
    const isRollback = inspection_status === '未検収' && current.inspection_status === '検収済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !inspection_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'inspection_status', current.inspection_status, inspection_status, inspection_reason || '', '管理者').run()
  }
  
  if (billing_status && billing_status !== current.billing_status) {
    const isRollback = billing_status === '未請求' && current.billing_status === '請求済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !billing_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'billing_status', current.billing_status, billing_status, billing_reason || '', '管理者').run()
  }
  
  // 月次明細を更新
  await DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, 
        inspection_status = ?, 
        inspection_date = ?,
        billing_status = ?, 
        billing_date = ?, 
        invoice_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    amount || current.amount,
    inspection_status || current.inspection_status,
    inspection_date || current.inspection_date,
    billing_status || current.billing_status,
    billing_date || current.billing_date,
    invoice_number || current.invoice_number,
    id
  ).run()
  
  return c.json({ success: true, message: 'Updated successfully' })
})

// --- 入金履歴 API ---
app.post('/api/payment-histories', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { monthly_detail_id, payment_date, payment_amount, note } = body
  
  if (!monthly_detail_id || !payment_date || !payment_amount) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }
  
  // 入金履歴を追加
  await DB.prepare(
    'INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(monthly_detail_id, payment_date, payment_amount, note || null, '管理者').run()
  
  // 累計入金額を再計算
  const { results: histories } = await DB.prepare(
    'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
  ).bind(monthly_detail_id).all()
  
  const totalPayment = (histories[0] as any)?.total || 0
  
  // 月次明細の入金情報を更新
  const detail = await DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  const amount = detail?.amount || 0
  
  let paymentStatus = '未入金'
  if (totalPayment >= amount) {
    paymentStatus = '入金完了'
  } else if (totalPayment > 0) {
    paymentStatus = '部分入金'
  }
  
  await DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, 
        payment_status = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalPayment, paymentStatus, payment_date, monthly_detail_id).run()
  
  return c.json({ success: true, message: 'Payment added successfully', totalPayment, paymentStatus })
})

// --- メンバー API ---
app.get('/api/members', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(
    'SELECT * FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()
  
  return c.json({ success: true, data: results })
})

// --- 契約 API ---

// API: 契約作成（月次明細自動生成）
app.post('/api/contracts', async (c) => {
  const { project_id, contract_name, start_date, end_date, contract_amount, notes, member_assignments } = await c.req.json()

  // バリデーション
  if (!project_id || !contract_name || !start_date || !end_date || !contract_amount) {
    return c.json({ error: '必須項目が入力されていません' }, 400)
  }

  // 月数を計算
  const startDate = new Date(start_date)
  const endDate = new Date(end_date)
  
  if (startDate > endDate) {
    return c.json({ error: '開始日は終了日より前である必要があります' }, 400)
  }

  const months = []
  let current = new Date(startDate)
  while (current <= endDate) {
    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
    months.push(yearMonth)
    current.setMonth(current.getMonth() + 1)
  }

  if (months.length === 0) {
    return c.json({ error: '契約期間が無効です' }, 400)
  }

  // 均等割の計算
  const baseAmount = Math.floor(contract_amount / months.length)
  const remainder = contract_amount - (baseAmount * months.length)

  try {
    // 契約を作成
    const contractResult = await c.env.DB.prepare(`
      INSERT INTO contracts (
        project_id, contract_name, contract_start_date, contract_end_date, 
        contract_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      project_id, contract_name, start_date, end_date, 
      contract_amount, 'active'
    ).run()

    const contractId = contractResult.meta.last_row_id

    // 月次明細を生成し、IDを保持
    const monthlyDetailIds = []
    for (let i = 0; i < months.length; i++) {
      const monthAmount = i === 0 ? baseAmount + remainder : baseAmount
      
      const monthlyResult = await c.env.DB.prepare(`
        INSERT INTO monthly_details (
          contract_id, target_month, amount,
          inspection_status, billing_status, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        contractId, months[i], monthAmount,
        '未検収', '未請求', '未入金'
      ).run()
      
      monthlyDetailIds.push(monthlyResult.meta.last_row_id)
    }

    // メンバーアサインがある場合、各月次明細に追加
    if (member_assignments && member_assignments.length > 0) {
      for (const monthlyDetailId of monthlyDetailIds) {
        for (const assignment of member_assignments) {
          await c.env.DB.prepare(`
            INSERT INTO monthly_member_assignments (
              monthly_detail_id, member_id, allocation_ratio, unit_price, notes
            ) VALUES (?, ?, ?, ?, ?)
          `).bind(
            monthlyDetailId,
            assignment.member_id,
            assignment.allocation_ratio,
            assignment.unit_price,
            assignment.notes || ''
          ).run()
        }
      }
    }

    return c.json({ 
      success: true, 
      contract_id: contractId,
      monthly_details_count: months.length,
      member_assignments_count: member_assignments ? member_assignments.length : 0
    })
  } catch (error) {
    console.error('Contract creation error:', error)
    return c.json({ error: 'データベースエラーが発生しました: ' + error.message }, 500)
  }
})

// --- 月次明細 API ---

// API: 月次明細の検収情報更新
app.put('/api/monthly-details/:id/inspection', async (c) => {
  const id = c.req.param('id')
  const { inspection_status, inspection_date } = await c.req.json()

  // ステータス遷移のバリデーション
  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  if (current.inspection_status !== inspection_status) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_detail', id, 'inspection_status', current.inspection_status, inspection_status, '管理者').run()
  }

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET inspection_status = ?, inspection_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(inspection_status, inspection_date, id).run()

  return c.json({ success: true })
})

// API: 月次明細の請求情報更新
app.put('/api/monthly-details/:id/billing', async (c) => {
  const id = c.req.param('id')
  const { billing_status, billing_date, invoice_number, expected_payment_date } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  if (current.billing_status !== billing_status) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_detail', id, 'billing_status', current.billing_status, billing_status, '管理者').run()
  }

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET billing_status = ?, billing_date = ?, invoice_number = ?, expected_payment_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(billing_status, billing_date, invoice_number, expected_payment_date, id).run()

  return c.json({ success: true })
})

// API: 月次明細の金額更新
app.put('/api/monthly-details/:id/amount', async (c) => {
  const id = c.req.param('id')
  const { amount } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('monthly_detail', id, 'amount', current.amount.toString(), amount.toString(), '管理者').run()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(amount, id).run()

  return c.json({ success: true })
})

// API: 入金履歴追加
app.post('/api/payment-histories', async (c) => {
  const { monthly_detail_id, payment_date, amount, notes } = await c.req.json()

  await c.env.DB.prepare(`
    INSERT INTO payment_histories (monthly_detail_id, payment_date, amount, notes)
    VALUES (?, ?, ?, ?)
  `).bind(monthly_detail_id, payment_date, amount, notes || '').run()

  // 月次明細の合計入金額を更新
  const payments = await c.env.DB.prepare(`
    SELECT SUM(amount) as total FROM payment_histories WHERE monthly_detail_id = ?
  `).bind(monthly_detail_id).first()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(payments.total || 0, monthly_detail_id).run()

  return c.json({ success: true })
})

// API: 入金履歴削除
app.delete('/api/payment-histories/:id', async (c) => {
  const id = c.req.param('id')

  // 入金履歴を取得
  const payment = await c.env.DB.prepare('SELECT * FROM payment_histories WHERE id = ?').bind(id).first()
  if (!payment) return c.notFound()

  // 削除
  await c.env.DB.prepare('DELETE FROM payment_histories WHERE id = ?').bind(id).run()

  // 月次明細の合計入金額を更新
  const payments = await c.env.DB.prepare(`
    SELECT SUM(amount) as total FROM payment_histories WHERE monthly_detail_id = ?
  `).bind(payment.monthly_detail_id).first()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(payments.total || 0, payment.monthly_detail_id).run()

  return c.json({ success: true })
})

// API: 月次メンバーアサイン追加
app.post('/api/monthly-member-assignments', async (c) => {
  const { monthly_detail_id, member_id, allocation_ratio, unit_price, notes } = await c.req.json()

  // バリデーション
  if (!monthly_detail_id || !member_id || allocation_ratio === undefined || !unit_price) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }

  // 稼働率は0-1の範囲
  if (allocation_ratio < 0 || allocation_ratio > 1) {
    return c.json({ success: false, error: 'Work ratio must be between 0 and 1' }, 400)
  }

  // 既存のアサインを確認
  const existing = await c.env.DB.prepare(`
    SELECT * FROM monthly_member_assignments 
    WHERE monthly_detail_id = ? AND member_id = ?
  `).bind(monthly_detail_id, member_id).first()

  if (existing) {
    return c.json({ success: false, error: 'Member is already assigned to this monthly detail' }, 400)
  }

  // 追加
  const result = await c.env.DB.prepare(`
    INSERT INTO monthly_member_assignments 
    (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
    VALUES (?, ?, ?, ?, ?)
  `).bind(monthly_detail_id, member_id, allocation_ratio, unit_price, notes || '').run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// API: 月次メンバーアサイン更新
app.put('/api/monthly-member-assignments/:id', async (c) => {
  const id = c.req.param('id')
  const { allocation_ratio, unit_price, notes } = await c.req.json()

  // バリデーション
  if (allocation_ratio !== undefined && (allocation_ratio < 0 || allocation_ratio > 1)) {
    return c.json({ success: false, error: 'Work ratio must be between 0 and 1' }, 400)
  }

  // 更新
  await c.env.DB.prepare(`
    UPDATE monthly_member_assignments 
    SET allocation_ratio = ?, unit_price = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(allocation_ratio, unit_price, notes || '', id).run()

  return c.json({ success: true })
})

// API: 月次メンバーアサイン削除
app.delete('/api/monthly-member-assignments/:id', async (c) => {
  const id = c.req.param('id')

  await c.env.DB.prepare('DELETE FROM monthly_member_assignments WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// API: メンバー一覧取得
app.get('/api/members', async (c) => {
  const members = await c.env.DB.prepare(`
    SELECT id, name, email, default_unit_price, status
    FROM members
    WHERE status = 'active'
    ORDER BY name ASC
  `).all()

  return c.json({ success: true, data: members.results })
})

// API: メンバー作成
app.post('/api/members/create', async (c) => {
  const { name, email, default_unit_price } = await c.req.json()

  if (!name || !default_unit_price) {
    return c.json({ success: false, error: 'Name and default unit price are required' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO members (name, email, default_unit_price, status)
    VALUES (?, ?, ?, ?)
  `).bind(name, email || null, default_unit_price, 'active').run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// API: メンバー更新
app.put('/api/members/:id', async (c) => {
  const id = c.req.param('id')
  const { name, email, default_unit_price } = await c.req.json()

  if (!name || !default_unit_price) {
    return c.json({ success: false, error: 'Name and default unit price are required' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE members 
    SET name = ?, email = ?, default_unit_price = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, email || null, default_unit_price, id).run()

  return c.json({ success: true })
})

// API: メンバーステータス変更
app.put('/api/members/:id/status', async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()

  if (!status || !['active', 'inactive'].includes(status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE members 
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run()

  return c.json({ success: true })
})

// --- ダッシュボード API ---
app.get('/api/dashboard/summary', async (c) => {
  const { DB } = c.env
  
  // 当月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 当月売上(検収済)
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  // 未検収金額
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE inspection_status = ?'
  ).bind('未検収').all()
  
  // 未請求金額
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ?'
  ).bind('未請求').all()
  
  // 未入金金額
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?)'
  ).bind('未入金', '部分入金').all()
  
  return c.json({
    success: true,
    data: {
      currentMonthSales: (currentMonthSales[0] as any)?.total || 0,
      uninspectedAmount: (uninspected[0] as any)?.total || 0,
      unbilledAmount: (unbilled[0] as any)?.total || 0,
      unpaidAmount: (unpaid[0] as any)?.total || 0
    }
  })
})

// 月次売上推移(直近12ヶ月)
app.get('/api/dashboard/sales-trend', async (c) => {
  const { DB } = c.env
  
  // 直近12ヶ月のデータを取得
  const { results } = await DB.prepare(`
    SELECT 
      target_month,
      SUM(CASE WHEN inspection_status = '検収済' THEN amount ELSE 0 END) as confirmed_sales
    FROM monthly_details
    WHERE target_month >= date('now', '-12 months')
    GROUP BY target_month
    ORDER BY target_month ASC
  `).all()
  
  return c.json({ success: true, data: results })
})

// ========================================
// HTML Pages
// ========================================

// リード一覧
app.get('/leads', async (c) => {
  const { DB } = c.env
  const { results: leads } = await DB.prepare(
    'SELECT * FROM leads ORDER BY created_at DESC'
  ).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>リード一覧 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- ページヘッダー -->
        <div class="px-4 py-6 sm:px-0 flex justify-between items-center">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-users mr-2"></i>リード一覧
          </h1>
          <button onclick="openCreateModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            <i class="fas fa-plus mr-2"></i>新規リード作成
          </button>
        </div>

        <!-- データテーブル -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">会社名</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">担当者</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">メール</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">電話</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${leads.map((lead: any) => `
                <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/leads/${lead.id}'">
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${lead.company_name}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.contact_person || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.email || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.phone || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${lead.status === 'active' 
                      ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                      : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 作成モーダル -->
      <div id="create-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-users mr-2"></i>新規リード作成
            </h3>
            <button onclick="closeCreateModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="create-form" onsubmit="createLead(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                会社名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="company_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                担当者名
              </label>
              <input type="text" name="contact_person"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                電話番号
              </label>
              <input type="tel" name="phone"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeCreateModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>作成
              </button>
            </div>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        function openCreateModal() {
          document.getElementById('create-modal').classList.remove('hidden');
        }

        function closeCreateModal() {
          document.getElementById('create-modal').classList.add('hidden');
          document.getElementById('create-form').reset();
        }

        async function createLead(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          
          try {
            const response = await axios.post('/api/leads', data);
            if (response.data.success) {
              alert('リードを作成しました');
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})

// リード詳細
app.get('/leads/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first() as any
  if (!lead) {
    return c.html('<h1>リードが見つかりません</h1>', 404)
  }
  
  // 関連する案件を取得
  const { results: projects } = await DB.prepare(
    'SELECT * FROM projects WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(id).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>リード詳細 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- パンくずリスト -->
        <nav class="flex mb-4" aria-label="Breadcrumb">
          <ol class="inline-flex items-center space-x-1 md:space-x-3">
            <li>
              <a href="/leads" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-users mr-1"></i>リード一覧
              </a>
            </li>
            <li>
              <span class="text-gray-400 mx-2">/</span>
            </li>
            <li class="text-gray-700">
              ${lead.company_name}
            </li>
          </ol>
        </nav>

        <!-- ページヘッダー -->
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-user mr-2"></i>リード詳細
          </h1>
        </div>

        <!-- 基本情報 -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-info-circle mr-2"></i>基本情報
          </h2>
          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-sm font-medium text-gray-500">会社名</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.company_name}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">担当者名</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.contact_person || '-'}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">メールアドレス</dt>
              <dd class="mt-1 text-sm text-gray-900">
                ${lead.email ? `<a href="mailto:${lead.email}" class="text-blue-600 hover:text-blue-800">${lead.email}</a>` : '-'}
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">電話番号</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.phone || '-'}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">ステータス</dt>
              <dd class="mt-1">
                ${lead.status === 'active' 
                  ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                  : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                }
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">登録日</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.created_at}</dd>
            </div>
          </dl>
        </div>

        <!-- 案件一覧 -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-briefcase mr-2"></i>案件一覧
            </h2>
            <button onclick="openCreateProjectModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-plus mr-2"></i>案件を作成
            </button>
          </div>

          ${projects.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${projects.map((project: any) => `
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/projects/${project.id}'">
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        ${project.project_name}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        ${project.status === 'active' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-play-circle mr-1"></i>進行中</span>' :
                          project.status === 'won' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-trophy mr-1"></i>受注</span>' :
                          project.status === 'lost' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-times-circle mr-1"></i>失注</span>' :
                          '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                        }
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${project.created_at}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-inbox text-4xl mb-2"></i>
              <p>案件がまだありません</p>
            </div>
          `}
        </div>
      </div>

      <!-- 案件作成モーダル -->
      <div id="create-project-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-briefcase mr-2"></i>新規案件作成
            </h3>
            <button onclick="closeCreateProjectModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="create-project-form" onsubmit="createProject(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                案件名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="project_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeCreateProjectModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>作成
              </button>
            </div>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        function openCreateProjectModal() {
          document.getElementById('create-project-modal').classList.remove('hidden');
        }

        function closeCreateProjectModal() {
          document.getElementById('create-project-modal').classList.add('hidden');
          document.getElementById('create-project-form').reset();
        }

        async function createProject(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          data.lead_id = '${id}';
          
          try {
            const response = await axios.post('/api/projects', data);
            if (response.data.success) {
              alert('案件を作成しました');
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})

// 案件詳細 (ハブ画面)
app.get('/projects/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first() as any
  if (!project) {
    return c.html('<h1>案件が見つかりません</h1>', 404)
  }
  
  // リード情報を取得
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first() as any
  
  // 契約一覧を取得
  const { results: contracts } = await DB.prepare(
    'SELECT * FROM contracts WHERE project_id = ? ORDER BY contract_start_date DESC'
  ).bind(id).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>案件詳細 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- パンくずリスト -->
        <nav class="flex mb-4" aria-label="Breadcrumb">
          <ol class="inline-flex items-center space-x-1 md:space-x-3">
            <li>
              <a href="/leads" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-users mr-1"></i>リード一覧
              </a>
            </li>
            <li>
              <span class="text-gray-400 mx-2">/</span>
            </li>
            <li>
              <a href="/leads/${lead.id}" class="text-gray-500 hover:text-gray-700">
                ${lead.company_name}
              </a>
            </li>
            <li>
              <span class="text-gray-400 mx-2">/</span>
            </li>
            <li class="text-gray-700">
              ${project.project_name}
            </li>
          </ol>
        </nav>

        <!-- ページヘッダー -->
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-briefcase mr-2"></i>案件詳細
          </h1>
        </div>

        <!-- 基本情報 -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-info-circle mr-2"></i>基本情報
          </h2>
          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-sm font-medium text-gray-500">案件名</dt>
              <dd class="mt-1 text-sm text-gray-900">${project.project_name}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">リード</dt>
              <dd class="mt-1 text-sm text-blue-600 hover:text-blue-800">
                <a href="/leads/${lead.id}">${lead.company_name}</a>
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">ステータス</dt>
              <dd class="mt-1">
                ${project.status === 'active' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-play-circle mr-1"></i>進行中</span>' :
                  project.status === 'won' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-trophy mr-1"></i>受注</span>' :
                  project.status === 'lost' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-times-circle mr-1"></i>失注</span>' :
                  '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                }
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">作成日</dt>
              <dd class="mt-1 text-sm text-gray-900">${project.created_at}</dd>
            </div>
          </dl>
        </div>

        <!-- 契約一覧 (最重要セクション) -->
        <div class="bg-white shadow rounded-lg p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-contract mr-2"></i>契約一覧
            </h2>
            <button onclick="location.href='/projects/${id}/contracts/new'" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-plus mr-2"></i>契約を作成
            </button>
          </div>

          ${contracts.length > 0 ? `
            <div class="space-y-4">
              ${contracts.map((contract: any) => `
                <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer" onclick="location.href='/contracts/${contract.id}'">
                  <div class="flex justify-between items-start mb-3">
                    <div>
                      <h3 class="text-base font-semibold text-gray-900">${contract.contract_name}</h3>
                      <p class="text-sm text-gray-500 mt-1">
                        <i class="fas fa-calendar-alt mr-1"></i>${contract.contract_start_date} 〜 ${contract.contract_end_date}
                      </p>
                    </div>
                    <div class="text-right">
                      <p class="text-lg font-bold text-gray-900">¥${parseInt(contract.contract_amount).toLocaleString()}</p>
                      ${contract.status === 'active' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-play-circle mr-1"></i>進行中</span>' :
                        contract.status === 'completed' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>完了</span>' :
                        '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Draft</span>'
                      }
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-inbox text-4xl mb-2"></i>
              <p>契約がまだありません</p>
            </div>
          `}
        </div>
      </div>

      <!-- 契約作成モーダル -->
      <div id="create-contract-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-contract mr-2"></i>新規契約作成
            </h3>
            <button onclick="closeCreateContractModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="create-contract-form" onsubmit="createContract(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                契約名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="contract_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: Q1 2026 契約">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                開始日 <span class="text-red-500">*</span>
              </label>
              <input type="date" name="contract_start_date" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                終了日 <span class="text-red-500">*</span>
              </label>
              <input type="date" name="contract_end_date" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                契約金額 <span class="text-red-500">*</span>
              </label>
              <div class="relative">
                <input type="number" name="contract_amount" min="0" required
                  class="w-full px-3 py-2 pr-12 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="3000000">
                <span class="absolute right-3 top-2 text-gray-500">円</span>
              </div>
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeCreateContractModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>作成
              </button>
            </div>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        function openCreateContractModal() {
          document.getElementById('create-contract-modal').classList.remove('hidden');
        }

        function closeCreateContractModal() {
          document.getElementById('create-contract-modal').classList.add('hidden');
          document.getElementById('create-contract-form').reset();
        }

        async function createContract(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          data.project_id = '${id}';
          
          try {
            const response = await axios.post('/api/contracts', data);
            if (response.data.success) {
              alert('契約を作成しました（月次明細も自動生成されました）');
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})

// トップダッシュボード
app.get('/', async (c) => {
  const { DB } = c.env
  
  // ダッシュボードデータを取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE inspection_status = ?'
  ).bind('未検収').all()
  
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ?'
  ).bind('未請求').all()
  
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?)'
  ).bind('未入金', '部分入金').all()
  
  const currentMonthSalesTotal = (currentMonthSales[0] as any)?.total || 0
  const uninspectedTotal = (uninspected[0] as any)?.total || 0
  const unbilledTotal = (unbilled[0] as any)?.total || 0
  const unpaidTotal = (unpaid[0] as any)?.total || 0
  
  // 進行中の契約を取得
  const { results: activeContracts } = await DB.prepare(`
    SELECT c.*, p.project_name
    FROM contracts c
    JOIN projects p ON c.project_id = p.id
    WHERE c.status = 'active'
    ORDER BY c.contract_start_date DESC
    LIMIT 10
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>トップダッシュボード - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- ページヘッダー -->
        <div class="px-4 py-6 sm:px-0">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-home mr-2"></i>トップダッシュボード
          </h1>
        </div>

        <!-- KPIカード -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <!-- 当月売上 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-yen-sign mr-1"></i>当月売上(確定)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-900">
                ¥${currentMonthSalesTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未検収 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-clock mr-1"></i>未検収金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-yellow-600">
                ¥${uninspectedTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未請求 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-file-invoice mr-1"></i>未請求金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-600">
                ¥${unbilledTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未入金 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-exclamation-circle mr-1"></i>未入金金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-red-600">
                ¥${unpaidTotal.toLocaleString()}
              </dd>
            </div>
          </div>
        </div>

        <!-- 月次売上推移グラフ -->
        <div class="bg-white shadow rounded-lg p-6 mb-8">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-chart-line mr-2"></i>月次売上推移(直近12ヶ月)
          </h2>
          <canvas id="salesChart" height="80"></canvas>
        </div>

        <!-- 進行中の契約 -->
        <div class="bg-white shadow rounded-lg p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-contract mr-2"></i>進行中の契約(上位10件)
            </h2>
          </div>
          
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">契約期間</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">契約金額</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${activeContracts.map((contract: any) => `
                  <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/contracts/${contract.id}'">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ${contract.project_name}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${contract.contract_start_date} 〜 ${contract.contract_end_date}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ¥${parseInt(contract.contract_amount).toLocaleString()}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        <i class="fas fa-play-circle mr-1"></i>進行中
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Chart.js -->
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        // 月次売上推移グラフ
        axios.get('/api/dashboard/sales-trend').then(response => {
          const data = response.data.data
          const labels = data.map(d => d.target_month)
          const values = data.map(d => d.confirmed_sales)
          
          const ctx = document.getElementById('salesChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: '売上(円)',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  display: false
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: function(value) {
                      return '¥' + value.toLocaleString();
                    }
                  }
                }
              }
            }
          });
        })
      </script>
    </body>
    </html>
  `)
})

// 案件詳細画面（ハブ画面）
app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  
  // 案件情報とリード情報を取得
  const project = await c.env.DB.prepare(`
    SELECT p.*, l.company_name, l.contact_person 
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE p.id = ?
  `).bind(id).first()
  
  if (!project) return c.notFound()

  // 関連する契約を取得
  const contracts = await c.env.DB.prepare(`
    SELECT 
      c.*,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count,
      (SELECT SUM(target_amount) FROM monthly_details WHERE contract_id = c.id) as total_amount
    FROM contracts c
    WHERE c.project_id = ?
    ORDER BY c.start_date DESC
  `).bind(id).all()

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>案件詳細 - ${project.project_name}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
        <!-- グローバルナビゲーション -->
        <nav class="bg-white shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
              <div class="flex">
                <div class="flex-shrink-0 flex items-center">
                  <a href="/" class="text-xl font-bold text-blue-600">
                    <i class="fas fa-chart-line mr-2"></i>SFA
                  </a>
                </div>
                <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-home mr-2"></i>ダッシュボード
                  </a>
                  <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-users mr-2"></i>リード
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center">
                <span class="text-sm text-gray-500 mr-4">
                  <i class="fas fa-user-circle mr-1"></i>管理者
                </span>
              </div>
            </div>
          </div>
        </nav>

        <div class="max-w-7xl mx-auto p-8">
            <div class="mb-6">
                <a href="/leads/${project.lead_id}" class="text-blue-600 hover:text-blue-800">
                    <i class="fas fa-arrow-left mr-2"></i>リード詳細に戻る
                </a>
            </div>

            <!-- 案件基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-folder-open mr-2 text-blue-600"></i>${project.project_name}
                        </h1>
                        <p class="text-gray-600">
                            <i class="fas fa-building mr-2"></i>${project.company_name}
                            ${project.contact_person ? ` / ${project.contact_person}` : ''}
                        </p>
                    </div>
                    <span class="px-3 py-1 rounded-full text-sm font-semibold ${
                      project.status === 'active' ? 'bg-green-100 text-green-800' :
                      project.status === 'won' ? 'bg-blue-100 text-blue-800' :
                      project.status === 'lost' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }">
                        ${project.status === 'active' ? '商談中' :
                          project.status === 'won' ? '受注' :
                          project.status === 'lost' ? '失注' : project.status}
                    </span>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-sm text-gray-600">予算見込</label>
                        <p class="text-gray-800 font-medium">
                            ${project.estimated_value ? `¥${project.estimated_value.toLocaleString()}` : '-'}
                        </p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">営業担当</label>
                        <p class="text-gray-800">${project.sales_owner || '-'}</p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">作成日</label>
                        <p class="text-gray-800">${project.created_at}</p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">更新日</label>
                        <p class="text-gray-800">${project.updated_at}</p>
                    </div>
                </div>

                ${project.notes ? `
                <div class="mt-4">
                    <label class="text-sm text-gray-600">備考</label>
                    <p class="text-gray-800 whitespace-pre-wrap">${project.notes}</p>
                </div>
                ` : ''}
            </div>

            <!-- 契約一覧 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-file-contract mr-2 text-blue-600"></i>契約一覧
                    </h2>
                    <button onclick="location.href='/projects/${id}/contracts/new'" 
                            class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                        <i class="fas fa-plus mr-2"></i>契約を追加
                    </button>
                </div>

                ${contracts.results.length > 0 ? `
                <div class="grid grid-cols-1 gap-4">
                    ${contracts.results.map(contract => `
                    <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                         onclick="location.href='/contracts/${contract.id}'">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <h3 class="font-bold text-gray-800">${contract.contract_name}</h3>
                                <p class="text-sm text-gray-600">
                                    ${contract.start_date} 〜 ${contract.end_date}
                                </p>
                            </div>
                            <span class="px-2 py-1 rounded text-xs font-semibold ${
                              contract.status === 'active' ? 'bg-green-100 text-green-800' :
                              contract.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                              contract.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }">
                                ${contract.status === 'active' ? '進行中' :
                                  contract.status === 'completed' ? '完了' :
                                  contract.status === 'cancelled' ? 'キャンセル' : contract.status}
                            </span>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                            <div class="text-gray-600">
                                <i class="fas fa-calendar-alt mr-1"></i>
                                月次明細: ${contract.monthly_count}件
                            </div>
                            <div class="text-lg font-bold text-blue-600">
                                ¥${(contract.total_amount || 0).toLocaleString()}
                            </div>
                        </div>
                    </div>
                    `).join('')}
                </div>
                ` : `
                <div class="text-center py-12 text-gray-500">
                    <i class="fas fa-file-contract text-5xl mb-3"></i>
                    <p class="text-lg">まだ契約がありません</p>
                    <p class="text-sm mt-2">「契約を追加」ボタンから新しい契約を作成してください</p>
                </div>
                `}
            </div>
        </div>
    </body>
    </html>
  `)
})

// 契約詳細画面（タブ構造）
app.get('/contracts/:id', async (c) => {
  const id = c.req.param('id')
  const tab = c.req.query('tab') || 'monthly' // デフォルトは月次明細タブ
  
  // 契約情報と案件情報を取得
  const contract = await c.env.DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      p.lead_id,
      l.company_name
    FROM contracts c
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE c.id = ?
  `).bind(id).first()
  
  if (!contract) return c.notFound()

  // 月次明細を取得
  const monthlyDetails = await c.env.DB.prepare(`
    SELECT 
      md.*,
      md.total_payment_amount as paid_amount
    FROM monthly_details md
    WHERE md.contract_id = ?
    ORDER BY md.target_month ASC
  `).bind(id).all()

  // アサインされたメンバーを取得
  const members = await c.env.DB.prepare(`
    SELECT 
      cma.*,
      m.name as member_name,
      m.email
    FROM contract_member_assignments cma
    JOIN members m ON cma.member_id = m.id
    WHERE cma.contract_id = ?
    ORDER BY cma.allocation_ratio DESC
  `).bind(id).all()

  // 統計情報を計算
  const totalAmount = monthlyDetails.results.reduce((sum, md) => sum + (md.amount || 0), 0)
  const paidAmount = monthlyDetails.results.reduce((sum, md) => sum + (md.paid_amount || 0), 0)
  const inspectedCount = monthlyDetails.results.filter(md => md.inspection_status === '検収済').length
  const billedCount = monthlyDetails.results.filter(md => md.billing_status === '請求済').length

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>契約詳細 - ${contract.contract_name}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
        <!-- グローバルナビゲーション -->
        <nav class="bg-white shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
              <div class="flex">
                <div class="flex-shrink-0 flex items-center">
                  <a href="/" class="text-xl font-bold text-blue-600">
                    <i class="fas fa-chart-line mr-2"></i>SFA
                  </a>
                </div>
                <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-home mr-2"></i>ダッシュボード
                  </a>
                  <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-users mr-2"></i>リード
                  </a>
                  <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center">
                <span class="text-sm text-gray-500 mr-4">
                  <i class="fas fa-user-circle mr-1"></i>管理者
                </span>
              </div>
            </div>
          </div>
        </nav>

        <div class="max-w-7xl mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/leads/${contract.lead_id}" class="text-blue-600 hover:text-blue-800">${contract.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/${contract.project_id}" class="text-blue-600 hover:text-blue-800">${contract.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">${contract.contract_name}</span>
            </div>

            <!-- 契約基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-file-contract mr-2 text-blue-600"></i>${contract.contract_name}
                        </h1>
                        <p class="text-gray-600">
                            <i class="fas fa-calendar-alt mr-2"></i>
                            ${contract.start_date} 〜 ${contract.end_date}
                        </p>
                    </div>
                    <span class="px-3 py-1 rounded-full text-sm font-semibold ${
                      contract.status === 'active' ? 'bg-green-100 text-green-800' :
                      contract.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                      contract.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }">
                        ${contract.status === 'active' ? '進行中' :
                          contract.status === 'completed' ? '完了' :
                          contract.status === 'cancelled' ? 'キャンセル' : contract.status}
                    </span>
                </div>

                <!-- サマリーカード -->
                <div class="grid grid-cols-4 gap-4 mb-6">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">契約金額</p>
                        <p class="text-2xl font-bold text-blue-600">¥${totalAmount.toLocaleString()}</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">検収済</p>
                        <p class="text-2xl font-bold text-green-600">${inspectedCount}/${monthlyDetails.results.length}件</p>
                    </div>
                    <div class="bg-orange-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">請求済</p>
                        <p class="text-2xl font-bold text-orange-600">${billedCount}/${monthlyDetails.results.length}件</p>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">入金済</p>
                        <p class="text-2xl font-bold text-purple-600">¥${paidAmount.toLocaleString()}</p>
                    </div>
                </div>

                ${contract.notes ? `
                <div class="border-t pt-4">
                    <label class="text-sm text-gray-600 font-medium">備考</label>
                    <p class="text-gray-800 mt-1 whitespace-pre-wrap">${contract.notes}</p>
                </div>
                ` : ''}
            </div>

            <!-- タブナビゲーション -->
            <div class="bg-white rounded-lg shadow-md mb-6">
                <div class="border-b border-gray-200">
                    <nav class="flex -mb-px">
                        <button onclick="location.href='/contracts/${id}?tab=monthly'" 
                                class="px-6 py-4 border-b-2 font-medium text-sm ${
                                  tab === 'monthly' 
                                    ? 'border-blue-600 text-blue-600' 
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }">
                            <i class="fas fa-calendar-check mr-2"></i>月次明細 (${monthlyDetails.results.length})
                        </button>
                        <button onclick="location.href='/contracts/${id}?tab=members'" 
                                class="px-6 py-4 border-b-2 font-medium text-sm ${
                                  tab === 'members' 
                                    ? 'border-blue-600 text-blue-600' 
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }">
                            <i class="fas fa-users mr-2"></i>アサインメンバー (${members.results.length})
                        </button>
                    </nav>
                </div>

                <!-- タブコンテンツ -->
                <div class="p-6">
                    ${tab === 'monthly' ? `
                    <!-- 月次明細タブ -->
                    ${monthlyDetails.results.length > 0 ? `
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">対象月</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">検収</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">請求</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">入金</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            ${monthlyDetails.results.map(md => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium">${md.target_month}</td>
                                <td class="px-4 py-3">¥${(md.amount || 0).toLocaleString()}</td>
                                <td class="px-4 py-3">
                                    ${md.inspection_status === '検収済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>完了</span>'
                                      : md.inspection_status === '未検収'
                                      ? '<span class="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800"><i class="fas fa-clock mr-1"></i>未完</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">-</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    ${md.billing_status === '請求済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800"><i class="fas fa-file-invoice mr-1"></i>済</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">未</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    ${(md.paid_amount || 0) > 0
                                      ? `<span class="text-green-600 font-medium">¥${(md.paid_amount || 0).toLocaleString()}</span>`
                                      : '<span class="text-gray-400">-</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    <a href="/monthly/${md.id}" class="text-blue-600 hover:text-blue-800">
                                        <i class="fas fa-edit mr-1"></i>詳細
                                    </a>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : `
                    <div class="text-center py-12 text-gray-500">
                        <i class="fas fa-calendar-times text-5xl mb-3"></i>
                        <p class="text-lg">月次明細がありません</p>
                    </div>
                    `}
                    ` : `
                    <!-- メンバータブ -->
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">アサインメンバー</h3>
                        <button class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                            <i class="fas fa-user-plus mr-2"></i>メンバーを追加
                        </button>
                    </div>
                    ${members.results.length > 0 ? `
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">メンバー名</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">単価</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">稼働率</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">想定売上</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            ${members.results.map(m => {
                              const allocationPercentage = (m.allocation_ratio * 100).toFixed(1)
                              const expectedRevenue = m.unit_price * m.allocation_ratio
                              return `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3">
                                    <div class="font-medium">${m.member_name}</div>
                                    <div class="text-sm text-gray-500">${m.email || '-'}</div>
                                </td>
                                <td class="px-4 py-3">¥${(m.unit_price || 0).toLocaleString()}/月</td>
                                <td class="px-4 py-3">
                                    <span class="font-medium">${allocationPercentage}%</span>
                                </td>
                                <td class="px-4 py-3 text-green-600 font-medium">
                                    ¥${Math.round(expectedRevenue).toLocaleString()}
                                </td>
                                <td class="px-4 py-3">
                                    <button class="text-blue-600 hover:text-blue-800">
                                        <i class="fas fa-edit mr-1"></i>編集
                                    </button>
                                </td>
                            </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                    ` : `
                    <div class="text-center py-12 text-gray-500">
                        <i class="fas fa-user-slash text-5xl mb-3"></i>
                        <p class="text-lg">アサインされたメンバーがいません</p>
                        <p class="text-sm mt-2">「メンバーを追加」ボタンから追加してください</p>
                    </div>
                    `}
                    `}
                </div>
            </div>
        </div>
    </body>
    </html>
  `)
})

// 契約作成画面
app.get('/projects/:projectId/contracts/new', async (c) => {
  const projectId = c.req.param('projectId')
  
  // 案件情報を取得
  const project = await c.env.DB.prepare(`
    SELECT p.*, l.company_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE p.id = ?
  `).bind(projectId).first()
  
  if (!project) return c.notFound()

  // アクティブなメンバー一覧を取得
  const { results: members } = await c.env.DB.prepare(`
    SELECT id, name, email, default_unit_price
    FROM members
    WHERE status = 'active'
    ORDER BY name ASC
  `).all()

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>契約作成 - ${project.project_name}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
        <!-- グローバルナビゲーション -->
        <nav class="bg-white shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
              <div class="flex">
                <div class="flex-shrink-0 flex items-center">
                  <a href="/" class="text-xl font-bold text-blue-600">
                    <i class="fas fa-chart-line mr-2"></i>SFA
                  </a>
                </div>
                <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-home mr-2"></i>ダッシュボード
                  </a>
                  <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-users mr-2"></i>リード
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center">
                <span class="text-sm text-gray-500 mr-4">
                  <i class="fas fa-user-circle mr-1"></i>管理者
                </span>
              </div>
            </div>
          </div>
        </nav>

        <div class="max-w-4xl mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/${projectId}" class="text-blue-600 hover:text-blue-800">${project.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">契約作成</span>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
                <h1 class="text-2xl font-bold text-gray-800 mb-6">
                    <i class="fas fa-file-contract mr-2 text-blue-600"></i>新規契約作成
                </h1>
                
                <div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <p class="text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        契約期間から月次明細が自動生成されます。契約金額は期間で均等割されます。
                    </p>
                </div>

                <form id="contract-form" class="space-y-6">
                    <input type="hidden" name="project_id" value="${projectId}">

                    <!-- 案件情報表示 -->
                    <div class="bg-gray-50 rounded-lg p-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">案件</label>
                        <p class="text-gray-800 font-medium">${project.project_name}</p>
                        <p class="text-sm text-gray-600">${project.company_name}</p>
                    </div>

                    <!-- 契約名 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            契約名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" name="contract_name" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                               placeholder="例: Q1 2026 契約">
                    </div>

                    <!-- 契約期間 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                開始日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="start_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                終了日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="end_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>

                    <!-- 契約金額 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            契約金額（円） <span class="text-red-500">*</span>
                        </label>
                        <input type="number" name="contract_amount" required min="0" step="1"
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                               placeholder="3000000">
                    </div>

                    <!-- 備考 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            備考
                        </label>
                        <textarea name="notes" rows="3"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                  placeholder="契約に関する補足情報"></textarea>
                    </div>

                    <!-- メンバーアサイン -->
                    <div class="border-t pt-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg font-semibold text-gray-800">
                                <i class="fas fa-users mr-2 text-indigo-600"></i>初期メンバーアサイン（任意）
                            </h3>
                            <button type="button" onclick="addMemberRow()" class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">
                                <i class="fas fa-plus mr-1"></i>メンバーを追加
                            </button>
                        </div>
                        
                        <div class="bg-blue-50 border-l-4 border-blue-400 p-3 mb-4 text-sm text-blue-700">
                            <i class="fas fa-info-circle mr-2"></i>
                            契約全期間に適用されるデフォルトのメンバーアサインを設定できます。後から月次明細ごとに変更も可能です。
                        </div>

                        <div id="members-container" class="space-y-3">
                            <!-- メンバー行が動的に追加される -->
                        </div>

                        <div id="allocation-warning" class="hidden bg-yellow-50 border-l-4 border-yellow-400 p-3 mt-4">
                            <p class="text-sm text-yellow-700">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
                                稼働率の合計: <span id="allocation-total">0</span>% （推奨: 100%）
                            </p>
                        </div>
                    </div>

                    <!-- プレビュー -->
                    <div id="preview" class="bg-gray-50 rounded-lg p-4 hidden">
                        <h3 class="text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-eye mr-2"></i>月次明細プレビュー
                        </h3>
                        <div id="preview-content" class="text-sm text-gray-600"></div>
                    </div>

                    <!-- ボタン -->
                    <div class="flex justify-end space-x-3">
                        <button type="button" onclick="location.href='/projects/${projectId}'"
                                class="px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                            キャンセル
                        </button>
                        <button type="button" onclick="previewContract()"
                                class="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                            <i class="fas fa-eye mr-2"></i>プレビュー
                        </button>
                        <button type="submit"
                                class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <i class="fas fa-save mr-2"></i>契約を作成
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // メンバーデータ
            const members = ${JSON.stringify(members)}
            let memberRowIndex = 0

            // メンバー行を追加
            function addMemberRow() {
                const container = document.getElementById('members-container')
                const rowId = 'member-row-' + memberRowIndex++
                
                const row = document.createElement('div')
                row.id = rowId
                row.className = 'flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200'
                
                row.innerHTML = \`
                    <div class="flex-1">
                        <label class="block text-xs font-medium text-gray-700 mb-1">メンバー</label>
                        <select name="member_id[]" required class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500">
                            <option value="">選択してください</option>
                            \${members.map(m => \`<option value="\${m.id}">\${m.name} (¥\${(m.default_unit_price || 0).toLocaleString()}/月)</option>\`).join('')}
                        </select>
                    </div>
                    <div class="w-28">
                        <label class="block text-xs font-medium text-gray-700 mb-1">稼働率(%)</label>
                        <input type="number" name="allocation_ratio[]" required min="0" max="100" step="0.1" 
                               class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
                               placeholder="50" onchange="updateAllocationTotal()">
                    </div>
                    <div class="flex-1">
                        <label class="block text-xs font-medium text-gray-700 mb-1">単価(円/月)</label>
                        <input type="number" name="unit_price[]" required min="0" step="1000"
                               class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
                               placeholder="500000">
                    </div>
                    <div class="pt-6">
                        <button type="button" onclick="removeMemberRow('\${rowId}')" 
                                class="text-red-600 hover:text-red-800 text-sm">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                \`
                
                // メンバー選択時に単価を自動入力
                const select = row.querySelector('select[name="member_id[]"]')
                const priceInput = row.querySelector('input[name="unit_price[]"]')
                select.addEventListener('change', (e) => {
                    const selectedMember = members.find(m => m.id == e.target.value)
                    if (selectedMember) {
                        priceInput.value = selectedMember.default_unit_price || 0
                    }
                })
                
                container.appendChild(row)
                updateAllocationTotal()
            }

            // メンバー行を削除
            function removeMemberRow(rowId) {
                document.getElementById(rowId).remove()
                updateAllocationTotal()
            }

            // 稼働率合計を更新
            function updateAllocationTotal() {
                const inputs = document.querySelectorAll('input[name="allocation_ratio[]"]')
                let total = 0
                inputs.forEach(input => {
                    total += parseFloat(input.value) || 0
                })
                
                const totalSpan = document.getElementById('allocation-total')
                const warning = document.getElementById('allocation-warning')
                
                if (inputs.length > 0) {
                    totalSpan.textContent = total.toFixed(1)
                    warning.classList.remove('hidden')
                    
                    if (Math.abs(total - 100) < 0.1) {
                        warning.className = 'bg-green-50 border-l-4 border-green-400 p-3 mt-4'
                        warning.innerHTML = '<p class="text-sm text-green-700"><i class="fas fa-check-circle mr-2"></i>稼働率の合計: <span id="allocation-total">' + total.toFixed(1) + '</span>% （適切です）</p>'
                    } else {
                        warning.className = 'bg-yellow-50 border-l-4 border-yellow-400 p-3 mt-4'
                        warning.innerHTML = '<p class="text-sm text-yellow-700"><i class="fas fa-exclamation-triangle mr-2"></i>稼働率の合計: <span id="allocation-total">' + total.toFixed(1) + '</span>% （推奨: 100%）</p>'
                    }
                } else {
                    warning.classList.add('hidden')
                }
            }

            // プレビュー機能
            function previewContract() {
                const startDate = document.querySelector('input[name="start_date"]').value
                const endDate = document.querySelector('input[name="end_date"]').value
                const amount = parseInt(document.querySelector('input[name="contract_amount"]').value)

                if (!startDate || !endDate || !amount) {
                    alert('開始日、終了日、契約金額を入力してください')
                    return
                }

                // 月数を計算
                const start = new Date(startDate)
                const end = new Date(endDate)
                const months = []
                
                let current = new Date(start)
                while (current <= end) {
                    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
                    months.push(yearMonth)
                    current.setMonth(current.getMonth() + 1)
                }

                // 均等割
                const baseAmount = Math.floor(amount / months.length)
                const remainder = amount - (baseAmount * months.length)

                // プレビュー表示
                const preview = document.getElementById('preview')
                const content = document.getElementById('preview-content')
                
                let html = '<div class="space-y-2">'
                html += '<p class="font-medium">期間: ' + months.length + 'ヶ月</p>'
                html += '<table class="w-full text-sm mt-2">'
                html += '<thead class="bg-gray-100"><tr><th class="px-2 py-1 text-left">対象月</th><th class="px-2 py-1 text-right">金額</th></tr></thead>'
                html += '<tbody>'
                
                months.forEach((month, index) => {
                    const monthAmount = index === 0 ? baseAmount + remainder : baseAmount
                    html += '<tr><td class="px-2 py-1">' + month + '</td><td class="px-2 py-1 text-right">¥' + monthAmount.toLocaleString() + '</td></tr>'
                })
                
                html += '</tbody></table>'
                html += '<p class="mt-2 text-xs text-gray-500">※ 端数は最初の月に加算されます</p>'
                html += '</div>'
                
                content.innerHTML = html
                preview.classList.remove('hidden')
            }

            // フォーム送信
            document.getElementById('contract-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                if (!confirm('この内容で契約を作成しますか？')) return
                
                const formData = new FormData(e.target)
                
                // メンバーアサインデータを収集
                const memberIds = formData.getAll('member_id[]')
                const allocationRatios = formData.getAll('allocation_ratio[]')
                const unitPrices = formData.getAll('unit_price[]')
                
                const memberAssignments = []
                for (let i = 0; i < memberIds.length; i++) {
                    if (memberIds[i]) {
                        memberAssignments.push({
                            member_id: parseInt(memberIds[i]),
                            allocation_ratio: parseFloat(allocationRatios[i]) / 100,
                            unit_price: parseInt(unitPrices[i])
                        })
                    }
                }
                
                const data = {
                    project_id: parseInt(formData.get('project_id')),
                    contract_name: formData.get('contract_name'),
                    start_date: formData.get('start_date'),
                    end_date: formData.get('end_date'),
                    contract_amount: parseInt(formData.get('contract_amount')),
                    notes: formData.get('notes') || '',
                    member_assignments: memberAssignments
                }

                try {
                    const response = await axios.post('/api/contracts', data)
                    alert('契約を作成しました')
                    location.href = '/contracts/' + response.data.contract_id
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            })
        </script>
    </body>
    </html>
  `)
})

// 月次明細詳細画面
app.get('/monthly/:id', async (c) => {
  const id = c.req.param('id')
  
  // 月次明細情報と契約、案件、リード情報を取得
  const monthly = await c.env.DB.prepare(`
    SELECT 
      md.*,
      c.contract_name,
      c.project_id,
      c.contract_amount,
      p.project_name,
      p.lead_id,
      l.company_name
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    JOIN leads l ON p.lead_id = l.id
    WHERE md.id = ?
  `).bind(id).first()
  
  if (!monthly) return c.notFound()

  // 月次メンバーアサインを取得
  const members = await c.env.DB.prepare(`
    SELECT 
      mma.*,
      m.name as member_name,
      m.email
    FROM monthly_member_assignments mma
    JOIN members m ON mma.member_id = m.id
    WHERE mma.monthly_detail_id = ?
    ORDER BY mma.allocation_ratio DESC
  `).bind(id).all()

  // 入金履歴を取得
  const payments = await c.env.DB.prepare(`
    SELECT * FROM payment_histories
    WHERE monthly_detail_id = ?
    ORDER BY payment_date DESC
  `).bind(id).all()

  // 変更履歴を取得
  const histories = await c.env.DB.prepare(`
    SELECT * FROM status_change_histories
    WHERE table_name = 'monthly_detail' AND record_id = ?
    ORDER BY changed_at DESC
    LIMIT 10
  `).bind(id).all()

  // 統計計算
  const totalPayment = payments.results.reduce((sum, p) => sum + (p.amount || 0), 0)
  const remainingAmount = (monthly.amount || 0) - totalPayment
  const allocationTotal = members.results.reduce((sum, m) => sum + (m.allocation_ratio || 0), 0)

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>月次明細詳細 - ${monthly.target_month}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
        <!-- グローバルナビゲーション -->
        <nav class="bg-white shadow-sm">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
              <div class="flex">
                <div class="flex-shrink-0 flex items-center">
                  <a href="/" class="text-xl font-bold text-blue-600">
                    <i class="fas fa-chart-line mr-2"></i>SFA
                  </a>
                </div>
                <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-home mr-2"></i>ダッシュボード
                  </a>
                  <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-users mr-2"></i>リード
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center">
                <span class="text-sm text-gray-500 mr-4">
                  <i class="fas fa-user-circle mr-1"></i>管理者
                </span>
              </div>
            </div>
          </div>
        </nav>

        <div class="max-w-7xl mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/leads/${monthly.lead_id}" class="text-blue-600 hover:text-blue-800">${monthly.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/${monthly.project_id}" class="text-blue-600 hover:text-blue-800">${monthly.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/contracts/${monthly.contract_id}" class="text-blue-600 hover:text-blue-800">${monthly.contract_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">月次明細 ${monthly.target_month}</span>
            </div>

            <!-- 基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-calendar-alt mr-2 text-blue-600"></i>月次明細 ${monthly.target_month}
                        </h1>
                        <p class="text-gray-600">${monthly.contract_name}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-3xl font-bold text-blue-600">¥${(monthly.amount || 0).toLocaleString()}</p>
                        <button onclick="openEditAmountModal()" class="text-sm text-blue-600 hover:text-blue-800 mt-2">
                            <i class="fas fa-edit mr-1"></i>金額を編集
                        </button>
                    </div>
                </div>
            </div>

            <!-- アサインメンバー（この月のみ） -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-users mr-2 text-indigo-600"></i>アサインメンバー（この月のみ）
                    </h2>
                    <button onclick="openAddMemberModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
                        <i class="fas fa-user-plus mr-2"></i>メンバーを追加
                    </button>
                </div>

                ${allocationTotal !== 1.0 ? `
                <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                    <div class="flex">
                        <i class="fas fa-exclamation-triangle text-yellow-600 mr-2 mt-1"></i>
                        <p class="text-sm text-yellow-700">
                            稼働率の合計が ${(allocationTotal * 100).toFixed(1)}% です。100%を推奨します。
                        </p>
                    </div>
                </div>
                ` : ''}

                ${members.results.length > 0 ? `
                <table class="w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">メンバー名</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">単価</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">稼働率</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">想定売上</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">備考</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${members.results.map(m => {
                          const expectedRevenue = m.unit_price * m.allocation_ratio
                          return `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3">
                                <div class="font-medium">${m.member_name}</div>
                                <div class="text-sm text-gray-500">${m.email || '-'}</div>
                            </td>
                            <td class="px-4 py-3">¥${(m.unit_price || 0).toLocaleString()}/月</td>
                            <td class="px-4 py-3">
                                <span class="font-medium">${(m.allocation_ratio * 100).toFixed(1)}%</span>
                            </td>
                            <td class="px-4 py-3 text-green-600 font-medium">
                                ¥${Math.round(expectedRevenue).toLocaleString()}
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-600">${m.notes || '-'}</td>
                            <td class="px-4 py-3">
                                <button onclick="editMember(${m.id})" class="text-blue-600 hover:text-blue-800 mr-2">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button onclick="deleteMember(${m.id})" class="text-red-600 hover:text-red-800">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                        `}).join('')}
                    </tbody>
                </table>
                ` : `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-user-slash text-4xl mb-2"></i>
                    <p>まだメンバーがアサインされていません</p>
                </div>
                `}
            </div>

            <!-- 検収情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-check-circle mr-2 text-green-600"></i>検収情報
                </h2>
                <form id="inspection-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">検収ステータス</label>
                            <select name="inspection_status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="未検収" ${monthly.inspection_status === '未検収' ? 'selected' : ''}>未検収</option>
                                <option value="検収済" ${monthly.inspection_status === '検収済' ? 'selected' : ''}>検収済</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">検収日</label>
                            <input type="date" name="inspection_date" value="${monthly.inspection_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="flex justify-end">
                        <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                            <i class="fas fa-save mr-2"></i>検収情報を更新
                        </button>
                    </div>
                </form>
            </div>

            <!-- 請求情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-file-invoice mr-2 text-orange-600"></i>請求情報
                </h2>
                <form id="billing-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求ステータス</label>
                            <select name="billing_status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="未請求" ${monthly.billing_status === '未請求' ? 'selected' : ''}>未請求</option>
                                <option value="請求済" ${monthly.billing_status === '請求済' ? 'selected' : ''}>請求済</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求日</label>
                            <input type="date" id="billing_date" name="billing_date" value="${monthly.billing_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求書番号</label>
                            <input type="text" name="invoice_number" value="${monthly.invoice_number || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                   placeholder="INV-2026-001">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">入金予定日</label>
                            <input type="date" id="expected_payment_date" name="expected_payment_date" value="${monthly.expected_payment_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="flex justify-end">
                        <button type="submit" class="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700">
                            <i class="fas fa-save mr-2"></i>請求情報を更新
                        </button>
                    </div>
                </form>
            </div>

            <!-- 入金情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-money-bill-wave mr-2 text-purple-600"></i>入金情報
                    </h2>
                    <button onclick="openAddPaymentModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
                        <i class="fas fa-plus mr-2"></i>入金を追加
                    </button>
                </div>

                <!-- 入金サマリー -->
                <div class="bg-purple-50 rounded-lg p-4 mb-4">
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="text-sm text-gray-600">合計入金額</p>
                            <p class="text-2xl font-bold text-purple-600">¥${totalPayment.toLocaleString()}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-sm text-gray-600">残額</p>
                            <p class="text-2xl font-bold ${remainingAmount > 0 ? 'text-red-600' : 'text-green-600'}">
                                ¥${remainingAmount.toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div class="mt-2">
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div class="bg-purple-600 h-2 rounded-full" style="width: ${Math.min(100, (totalPayment / monthly.amount) * 100)}%"></div>
                        </div>
                    </div>
                </div>

                <!-- 入金履歴 -->
                ${payments.results.length > 0 ? `
                <table class="w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">入金日</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">備考</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${payments.results.map(p => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3">${p.payment_date}</td>
                            <td class="px-4 py-3 font-medium text-green-600">¥${(p.amount || 0).toLocaleString()}</td>
                            <td class="px-4 py-3 text-gray-600">${p.notes || '-'}</td>
                            <td class="px-4 py-3">
                                <button onclick="deletePayment(${p.id})" class="text-red-600 hover:text-red-800">
                                    <i class="fas fa-trash mr-1"></i>削除
                                </button>
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-2"></i>
                    <p>まだ入金がありません</p>
                </div>
                `}
            </div>

            <!-- 変更履歴 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-history mr-2 text-gray-600"></i>変更履歴
                </h2>
                ${histories.results.length > 0 ? `
                <div class="space-y-3">
                    ${histories.results.map(h => `
                    <div class="border-l-4 border-gray-300 pl-4 py-2">
                        <p class="text-sm text-gray-600">${h.changed_at}</p>
                        <p class="text-gray-800">${h.field_name}: ${h.old_value || '-'} → ${h.new_value || '-'}</p>
                        ${h.reason ? `<p class="text-sm text-gray-600 mt-1">理由: ${h.reason}</p>` : ''}
                    </div>
                    `).join('')}
                </div>
                ` : `
                <p class="text-center text-gray-500 py-4">変更履歴はありません</p>
                `}
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // 検収情報の更新
            document.getElementById('inspection-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                const formData = new FormData(e.target)
                const data = {
                    inspection_status: formData.get('inspection_status'),
                    inspection_date: formData.get('inspection_date') || null
                }

                try {
                    await axios.put('/api/monthly-details/${id}/inspection', data)
                    alert('検収情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            })

            // 請求日が入力されたときに翌月末日を自動計算
            document.getElementById('billing_date').addEventListener('change', (e) => {
                const billingDate = e.target.value
                if (billingDate) {
                    const date = new Date(billingDate)
                    // 翌月の1日を計算
                    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 2, 1)
                    // 1日前（翌月末日）を計算
                    const lastDay = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000)
                    // YYYY-MM-DD形式に変換
                    const expectedDate = lastDay.toISOString().split('T')[0]
                    document.getElementById('expected_payment_date').value = expectedDate
                }
            })

            // 請求情報の更新
            document.getElementById('billing-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                const formData = new FormData(e.target)
                const data = {
                    billing_status: formData.get('billing_status'),
                    billing_date: formData.get('billing_date') || null,
                    invoice_number: formData.get('invoice_number') || null,
                    expected_payment_date: formData.get('expected_payment_date') || null
                }

                try {
                    await axios.put('/api/monthly-details/${id}/billing', data)
                    alert('請求情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            })

            function openAddPaymentModal() {
                const date = prompt('入金日 (YYYY-MM-DD):')
                if (!date) return
                
                const amount = prompt('入金金額:')
                if (!amount) return
                
                const notes = prompt('備考（任意）:')
                
                axios.post('/api/payment-histories', {
                    monthly_detail_id: ${id},
                    payment_date: date,
                    amount: parseInt(amount),
                    notes: notes || ''
                }).then(() => {
                    alert('入金を追加しました')
                    location.reload()
                }).catch(error => {
                    alert('エラーが発生しました: ' + error.message)
                })
            }

            function deletePayment(paymentId) {
                if (!confirm('この入金履歴を削除しますか？')) return
                
                axios.delete('/api/payment-histories/' + paymentId)
                    .then(() => {
                        alert('入金履歴を削除しました')
                        location.reload()
                    })
                    .catch(error => {
                        alert('エラーが発生しました: ' + error.message)
                    })
            }

            async function openAddMemberModal() {
                try {
                    // メンバー一覧を取得
                    const response = await axios.get('/api/members')
                    const members = response.data.data
                    
                    if (members.length === 0) {
                        alert('アサイン可能なメンバーがいません')
                        return
                    }
                    
                    // メンバー選択
                    let memberOptions = members.map(m => m.id + ': ' + m.name + ' (¥' + (m.default_unit_price || 0).toLocaleString() + '/月)').join('\\n')
                    const memberInput = prompt('メンバーIDを入力してください:\\n' + memberOptions)
                    if (!memberInput) return
                    
                    const memberId = parseInt(memberInput)
                    const selectedMember = members.find(m => m.id === memberId)
                    if (!selectedMember) {
                        alert('無効なメンバーIDです')
                        return
                    }
                    
                    // 稼働率入力
                    const ratioInput = prompt('稼働率を入力してください (0-100):', '100')
                    if (!ratioInput) return
                    const ratio = parseFloat(ratioInput) / 100
                    
                    if (ratio < 0 || ratio > 1) {
                        alert('稼働率は0〜100の範囲で入力してください')
                        return
                    }
                    
                    // 単価入力
                    const priceInput = prompt('単価を入力してください:', selectedMember.default_unit_price || '0')
                    if (!priceInput) return
                    const price = parseInt(priceInput)
                    
                    // 備考入力
                    const notes = prompt('備考（任意）:', '') || ''
                    
                    // APIリクエスト
                    await axios.post('/api/monthly-member-assignments', {
                        monthly_detail_id: ${id},
                        member_id: memberId,
                        allocation_ratio: ratio,
                        unit_price: price,
                        notes: notes
                    })
                    
                    alert('メンバーを追加しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            }

            async function editMember(assignmentId) {
                try {
                    // 現在の値を取得するために再度APIを呼ぶか、データを埋め込む必要がある
                    // ここでは簡易的にプロンプトで入力させる
                    const ratioInput = prompt('新しい稼働率を入力してください (0-100):')
                    if (!ratioInput) return
                    const ratio = parseFloat(ratioInput) / 100
                    
                    if (ratio < 0 || ratio > 1) {
                        alert('稼働率は0〜100の範囲で入力してください')
                        return
                    }
                    
                    const priceInput = prompt('新しい単価を入力してください:')
                    if (!priceInput) return
                    const price = parseInt(priceInput)
                    
                    const notes = prompt('備考（任意）:', '') || ''
                    
                    await axios.put('/api/monthly-member-assignments/' + assignmentId, {
                        allocation_ratio: ratio,
                        unit_price: price,
                        notes: notes
                    })
                    
                    alert('メンバー情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            }

            async function deleteMember(assignmentId) {
                if (!confirm('このメンバーのアサインを削除しますか？')) return
                
                try {
                    await axios.delete('/api/monthly-member-assignments/' + assignmentId)
                    alert('メンバーのアサインを削除しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            }

            function openEditAmountModal() {
                const newAmount = prompt('新しい金額:', ${monthly.amount})
                if (!newAmount) return
                
                axios.put('/api/monthly-details/${id}/amount', {
                    amount: parseInt(newAmount)
                }).then(() => {
                    alert('金額を更新しました')
                    location.reload()
                }).catch(error => {
                    alert('エラーが発生しました: ' + error.message)
                })
            }
        </script>
    </body>
    </html>
  `)
})

// 契約一覧画面
app.get('/contracts', async (c) => {
  const { DB } = c.env
  
  // 全契約を取得（案件・リード情報を含む）
  const { results: contracts } = await DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      l.company_name,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id AND inspection_status = '検収済') as inspected_count,
      (SELECT SUM(amount) FROM monthly_details WHERE contract_id = c.id) as total_amount
    FROM contracts c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY c.created_at DESC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>契約一覧 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- ページヘッダー -->
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-file-contract mr-2"></i>契約一覧
          </h1>
        </div>

        <!-- 契約一覧 -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          ${contracts.length > 0 ? `
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約名</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">案件/顧客</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約期間</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約金額</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">進捗</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${contracts.map((contract: any) => `
                <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/contracts/${contract.id}'">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="font-medium text-gray-900">${contract.contract_name}</div>
                    <div class="text-sm text-gray-500">${contract.monthly_count || 0}ヶ月</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">${contract.project_name || '-'}</div>
                    <div class="text-sm text-gray-500">${contract.company_name || '-'}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${contract.contract_start_date} 〜<br>${contract.contract_end_date}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">¥${(contract.contract_amount || 0).toLocaleString()}</div>
                    ${contract.total_amount !== contract.contract_amount ? 
                      '<div class="text-xs text-yellow-600">実績: ¥' + (contract.total_amount || 0).toLocaleString() + '</div>' 
                      : ''}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">
                      検収: ${contract.inspected_count || 0}/${contract.monthly_count || 0}
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                      <div class="bg-green-600 h-2 rounded-full" style="width: ${contract.monthly_count > 0 ? (contract.inspected_count / contract.monthly_count * 100) : 0}%"></div>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${contract.status === 'active' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>進行中</span>' :
                      contract.status === 'completed' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-flag-checkered mr-1"></i>完了</span>' :
                      contract.status === 'terminated' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800"><i class="fas fa-times-circle mr-1"></i>終了</span>' :
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-file mr-1"></i>下書き</span>'
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : `
          <div class="text-center py-12 text-gray-500">
            <i class="fas fa-inbox text-4xl mb-2"></i>
            <p>契約がまだありません</p>
          </div>
          `}
        </div>
      </div>
    </body>
    </html>
  `)
})

// メンバー管理画面
app.get('/members', async (c) => {
  const { DB } = c.env
  
  // 全メンバーを取得
  const { results: members } = await DB.prepare(`
    SELECT * FROM members ORDER BY name ASC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>メンバー管理 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- ページヘッダー -->
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-user-friends mr-2"></i>メンバー管理
          </h1>
          <button onclick="openAddMemberModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            <i class="fas fa-user-plus mr-2"></i>メンバーを追加
          </button>
        </div>

        <!-- メンバー一覧 -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名前</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">メール</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">デフォルト単価</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">登録日</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${members.map((member: any) => `
                <tr class="hover:bg-gray-50">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="font-medium text-gray-900">${member.name}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${member.email ? '<a href="mailto:' + member.email + '" class="text-blue-600 hover:text-blue-800">' + member.email + '</a>' : '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ¥${(member.default_unit_price || 0).toLocaleString()}/月
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${member.status === 'active' 
                      ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                      : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-ban mr-1"></i>無効</span>'
                    }
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${member.created_at.split(' ')[0]}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button onclick="editMember(${member.id}, '${member.name}', '${member.email || ''}', ${member.default_unit_price}, '${member.status}')" 
                            class="text-blue-600 hover:text-blue-800 mr-3">
                      <i class="fas fa-edit mr-1"></i>編集
                    </button>
                    <button onclick="toggleMemberStatus(${member.id}, '${member.status}')" 
                            class="text-${member.status === 'active' ? 'red' : 'green'}-600 hover:text-${member.status === 'active' ? 'red' : 'green'}-800">
                      <i class="fas fa-${member.status === 'active' ? 'ban' : 'check'} mr-1"></i>${member.status === 'active' ? '無効化' : '有効化'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- メンバー追加モーダル -->
      <div id="add-member-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-user-plus mr-2"></i>新規メンバー追加
            </h3>
            <button onclick="closeAddMemberModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="add-member-form">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                名前 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                デフォルト単価 <span class="text-red-500">*</span>
              </label>
              <input type="number" name="default_unit_price" required min="0"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="500000">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeAddMemberModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>追加
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- メンバー編集モーダル -->
      <div id="edit-member-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-edit mr-2"></i>メンバー編集
            </h3>
            <button onclick="closeEditMemberModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="edit-member-form">
            <input type="hidden" name="member_id" id="edit_member_id">
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                名前 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="name" id="edit_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email" id="edit_email"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                デフォルト単価 <span class="text-red-500">*</span>
              </label>
              <input type="number" name="default_unit_price" id="edit_default_unit_price" required min="0"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeEditMemberModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-save mr-2"></i>更新
              </button>
            </div>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        function openAddMemberModal() {
          document.getElementById('add-member-modal').classList.remove('hidden');
        }

        function closeAddMemberModal() {
          document.getElementById('add-member-modal').classList.add('hidden');
          document.getElementById('add-member-form').reset();
        }

        function openEditMemberModal() {
          document.getElementById('edit-member-modal').classList.remove('hidden');
        }

        function closeEditMemberModal() {
          document.getElementById('edit-member-modal').classList.add('hidden');
          document.getElementById('edit-member-form').reset();
        }

        document.getElementById('add-member-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = {
            name: formData.get('name'),
            email: formData.get('email') || null,
            default_unit_price: parseInt(formData.get('default_unit_price'))
          };
          
          try {
            await axios.post('/api/members/create', data);
            alert('メンバーを追加しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        });

        function editMember(id, name, email, price, status) {
          document.getElementById('edit_member_id').value = id;
          document.getElementById('edit_name').value = name;
          document.getElementById('edit_email').value = email;
          document.getElementById('edit_default_unit_price').value = price;
          openEditMemberModal();
        }

        document.getElementById('edit-member-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const id = formData.get('member_id');
          const data = {
            name: formData.get('name'),
            email: formData.get('email') || null,
            default_unit_price: parseInt(formData.get('default_unit_price'))
          };
          
          try {
            await axios.put('/api/members/' + id, data);
            alert('メンバー情報を更新しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        });

        async function toggleMemberStatus(id, currentStatus) {
          const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
          const action = newStatus === 'active' ? '有効化' : '無効化';
          
          if (!confirm('このメンバーを' + action + 'しますか？')) return;
          
          try {
            await axios.put('/api/members/' + id + '/status', { status: newStatus });
            alert('メンバーを' + action + 'しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})

export default app
