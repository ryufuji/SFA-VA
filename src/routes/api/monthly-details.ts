import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'
import { updateContractStatusIfCompleted } from '../../lib/helpers'

const app = new Hono<AppEnv>()

app.get('/unpaid', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT 
      md.id, md.target_month, md.amount, md.amount_with_tax,
      md.payment_status, md.total_payment_amount,
      c.contract_name, c.id as contract_id,
      p.project_name,
      l.company_name, l.department
    FROM monthly_details md
    INNER JOIN contracts c ON md.contract_id = c.id
    INNER JOIN projects p ON c.project_id = p.id
    INNER JOIN leads l ON p.lead_id = l.id
    WHERE md.payment_status IN ('未入金', '部分入金')
      AND md.billing_status = '請求済'
    ORDER BY md.target_month ASC, l.company_name ASC
  `).all()
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, async (c) => {
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

app.put('/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { 
    amount, 
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
        billing_status = ?, 
        billing_date = ?, 
        invoice_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    amount || current.amount,
    billing_status || current.billing_status,
    billing_date || current.billing_date,
    invoice_number || current.invoice_number,
    id
  ).run()
  
  return c.json({ success: true, message: 'Updated successfully' })
})

app.put('/:id/billing', authMiddleware, requirePermission('billing_manage'), async (c) => {
  const id = c.req.param('id')
  const { billing_status, billing_date, invoice_number, expected_payment_date } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  if (current.billing_status !== billing_status) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'billing_status', current.billing_status, billing_status, '管理者').run()
  }
  
  if (current.billing_date !== billing_date) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'billing_date', current.billing_date || 'null', billing_date || 'null', '管理者').run()
  }
  
  if (current.invoice_number !== invoice_number) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'invoice_number', current.invoice_number || 'null', invoice_number || 'null', '管理者').run()
  }

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET billing_status = ?, billing_date = ?, invoice_number = ?, expected_payment_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(billing_status, billing_date || null, invoice_number || null, expected_payment_date || null, id).run()

  // 月次明細の契約IDを取得
  const monthlyDetail = await c.env.DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (monthlyDetail?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(c.env.DB, monthlyDetail.contract_id)
  }

  return c.json({ success: true })
})

app.put('/:id/amount', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')
  const { amount } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (!current) return c.notFound()

  // 契約の税率を取得して税込み額を再計算
  const contract = await c.env.DB.prepare('SELECT tax_rate FROM contracts WHERE id = ?').bind(current.contract_id).first() as any
  const taxRate = contract?.tax_rate ?? 10
  const amountWithTax = Math.round(amount * (1 + taxRate / 100))

  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('monthly_details', id, 'amount', current.amount.toString(), amount.toString(), '管理者').run()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, amount_with_tax = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(amount, amountWithTax, id).run()

  return c.json({ success: true })
})

app.get('/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env

  // 月次明細とアサインメンバーを取得
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount,
      md.acceptance_date,
      md.billing_status,
      md.billing_date,
      md.invoice_number,
      md.expected_payment_date,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY md.target_month DESC, md.id DESC
  `).all()

  // 各月次明細のアサインメンバーを取得
  const csvRows = []
  for (const detail of monthlyDetails) {
    const { results: assignments } = await DB.prepare(`
      SELECT 
        m.email,
        mma.unit_price,
        mma.allocation_ratio
      FROM monthly_member_assignments mma
      LEFT JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
      ORDER BY m.email ASC
    `).bind(detail.id).all()

    // アサインメンバーを文字列に変換（メール:単価:稼働率;メール:単価:稼働率）
    const memberString = assignments.map(a => 
      `${a.email}:${a.unit_price}:${a.allocation_ratio}`
    ).join(';')

    csvRows.push({
      id: detail.id,
      target_month: detail.target_month,
      contract_name: detail.contract_name || '',
      project_name: detail.project_name || '',
      company_name: detail.company_name || '',
      amount: detail.amount,
      acceptance_date: (detail as any).acceptance_date || '',
      billing_status: detail.billing_status,
      billing_date: detail.billing_date || '',
      invoice_number: detail.invoice_number || '',
      expected_payment_date: detail.expected_payment_date || '',
      assign_members: memberString
    })
  }

  // CSVヘッダー
  const header = 'ID,対象月,契約名,案件名,会社名,金額,検収日,請求ステータス,請求日,請求書番号,入金予定日,アサインメンバー(メール:単価:稼働率;で区切る)'
  
  // CSVボディ
  const body = csvRows.map(row => 
    [
      row.id,
      row.target_month,
      `"${row.contract_name}"`,
      `"${row.project_name}"`,
      `"${row.company_name}"`,
      row.amount,
      row.acceptance_date,
      row.billing_status,
      row.billing_date,
      `"${row.invoice_number}"`,
      row.expected_payment_date,
      `"${row.assign_members}"`
    ].join(',')
  ).join('\n')

  const csv = header + '\n' + body

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="monthly_details.csv"'
    }
  })
})

app.post('/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { monthly_details } = await c.req.json()

  if (!Array.isArray(monthly_details) || monthly_details.length === 0) {
    return c.json({ success: false, error: '月次明細データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < monthly_details.length; i++) {
    const detail = monthly_details[i]
    const { 
      id, 
      billing_status, 
      billing_date, 
      invoice_number, 
      expected_payment_date,
      assign_members 
    } = detail

    // IDが必須
    if (!id) {
      errors.push({ line: i + 2, id: '', error: 'IDは必須です' })
      error_count++
      continue
    }

    try {
      // 月次明細が存在するか確認
      const existing = await DB.prepare('SELECT id FROM monthly_details WHERE id = ?').bind(id).first()
      
      if (!existing) {
        errors.push({ line: i + 2, id: id, error: '該当する月次明細が見つかりません（新規追加はできません）' })
        error_count++
        continue
      }

      // 月次明細を更新
      await DB.prepare(`
        UPDATE monthly_details 
        SET 
          billing_status = ?,
          billing_date = ?,
          invoice_number = ?,
          expected_payment_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        billing_status || '未請求',
        billing_date || null,
        invoice_number || null,
        expected_payment_date || null,
        id
      ).run()

      // アサインメンバーの更新
      if (assign_members) {
        // 既存のアサインメンバーを削除
        await DB.prepare('DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?').bind(id).run()

        // 新しいアサインメンバーを追加
        const memberList = assign_members.split(';').map((m: string) => m.trim()).filter((m: string) => m)
        for (const memberStr of memberList) {
          const parts = memberStr.split(':').map((p: string) => p.trim())
          const email = parts[0]
          const unit_price = parts[1] ? parseInt(parts[1]) : 0
          const allocation_ratio = parts[2] ? parseFloat(parts[2]) : 1.0

          // メンバーIDを取得
          const member = await DB.prepare('SELECT id FROM members WHERE email = ?').bind(email).first()
          
          if (member) {
            await DB.prepare(`
              INSERT INTO monthly_member_assignments (monthly_detail_id, member_id, unit_price, allocation_ratio)
              VALUES (?, ?, ?, ?)
            `).bind(id, member.id, unit_price, allocation_ratio).run()
          }
        }
      }

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, id: id, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: monthly_details.length,
    success_count,
    error_count,
    errors
  })
})

app.get('/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  if (!monthlyDetailId) {
    return c.json({ success: false, error: '月次明細IDが必要です' }, 400);
  }

  try {
    // 月次明細情報を取得
    const monthlyDetail = await DB.prepare(`
      SELECT 
        md.*,
        c.contract_name,
        p.project_name,
        l.company_name
      FROM monthly_details md
      LEFT JOIN contracts c ON md.contract_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN leads l ON p.lead_id = l.id
      WHERE md.id = ?
    `).bind(monthlyDetailId).first();

    if (!monthlyDetail) {
      return c.json({ success: false, error: '月次明細が見つかりません' }, 404);
    }

    // 関連するメンバーアサインを取得
    const { results: memberAssignments } = await DB.prepare(`
      SELECT 
        mma.id,
        m.name as member_name,
        mma.unit_price,
        mma.allocation_ratio
      FROM monthly_member_assignments mma
      LEFT JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
    `).bind(monthlyDetailId).all();

    // 関連する入金履歴を取得
    const { results: paymentHistories } = await DB.prepare(`
      SELECT 
        id,
        payment_date,
        payment_amount,
        note
      FROM payment_histories
      WHERE monthly_detail_id = ?
      ORDER BY payment_date DESC
    `).bind(monthlyDetailId).all();

    // 関連する変更履歴を取得
    const { results: changeHistories } = await DB.prepare(`
      SELECT COUNT(*) as count
      FROM status_change_histories
      WHERE table_name = 'monthly_details' AND record_id = ?
    `).bind(monthlyDetailId).all();

    return c.json({
      success: true,
      impact: {
        monthly_detail: monthlyDetail,
        member_assignments: memberAssignments,
        member_assignments_count: memberAssignments.length,
        payment_histories: paymentHistories,
        payment_histories_count: paymentHistories.length,
        change_histories_count: changeHistories[0]?.count || 0
      }
    });

  } catch (error) {
    console.error('Get delete impact error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  if (!monthlyDetailId) {
    return c.json({ success: false, error: '月次明細IDが必要です' }, 400);
  }

  try {
    // 関連データの確認
    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    const paymentHistories = await DB.prepare(`
      SELECT COUNT(*) as count FROM payment_histories WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    const changeHistories = await DB.prepare(`
      SELECT COUNT(*) as count FROM status_change_histories 
      WHERE table_name = 'monthly_details' AND record_id = ?
    `).bind(monthlyDetailId).first();

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM status_change_histories WHERE table_name = 'monthly_details' AND record_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthlyDetailId),
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        monthly_details: 1,
        monthly_member_assignments: monthlyMembers.count,
        payment_histories: paymentHistories.count,
        change_histories: changeHistories.count
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  try {
    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    return c.json({
      success: true,
      impact: {
        monthly_member_assignments_count: monthlyMembers.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.post('/:monthlyDetailId/invoice', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const monthlyDetailId = c.req.param('monthlyDetailId')
  
  try {
    const body = await c.req.json()
    
    // 月次明細情報取得
    const monthlyDetail = await DB.prepare(`
      SELECT 
        md.*,
        c.project_id,
        p.lead_id,
        l.company_name
      FROM monthly_details md
      JOIN contracts c ON md.contract_id = c.id
      JOIN projects p ON c.project_id = p.id
      JOIN leads l ON p.lead_id = l.id
      WHERE md.id = ?
    `).bind(monthlyDetailId).first() as any
    
    if (!monthlyDetail) {
      return c.json({ success: false, error: '月次明細が見つかりません' }, 404)
    }
  
  // 請求書番号を生成（INV-YYYYMM-XXX形式）
  const now = new Date()
  const yearMonth = now.toISOString().slice(0, 7).replace('-', '')
  const { results: existingInvoices } = await DB.prepare(
    'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1'
  ).bind(`INV-${yearMonth}-%`).all()
  
  let nextNumber = 1
  if (existingInvoices.length > 0) {
    const lastNumber = existingInvoices[0].invoice_number.split('-')[2]
    nextNumber = parseInt(lastNumber) + 1
  }
  const invoiceNumber = `INV-${yearMonth}-${String(nextNumber).padStart(3, '0')}`
  
  // 請求書作成
  const { issue_date, payment_due_date, subject, notes } = body
  const subtotal = monthlyDetail.amount
  const tax = Math.floor(subtotal * 0.1)
  const total = subtotal + tax
  
  // すべての値を確認
  const invoiceValues = {
    invoiceNumber,
    monthlyDetailId,
    lead_id: monthlyDetail.lead_id,
    issue_date,
    payment_due_date: payment_due_date ? payment_due_date : null,
    subject,
    subtotal,
    tax,
    total,
    tax_rate: 10,
    notes: notes ? notes : null,
    payment_status: '未入金',
    created_by: user.userId  // user.id ではなく user.userId
  }
  
  // undefinedの値を検出
  for (const [key, value] of Object.entries(invoiceValues)) {
    if (value === undefined) {
      throw new Error(`Invoice value '${key}' is undefined`)
    }
  }
  
  const invoiceResult = await DB.prepare(`
    INSERT INTO invoices (
      invoice_number, monthly_detail_id, lead_id,
      issue_date, payment_due_date, subject,
      subtotal, tax, total, tax_rate,
      notes, payment_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    invoiceNumber,
    monthlyDetailId,
    monthlyDetail.lead_id,
    issue_date,
    payment_due_date ? payment_due_date : null,
    subject,
    subtotal,
    tax,
    total,
    10,
    notes ? notes : null,
    '未入金',
    user.userId  // user.id ではなく user.userId
  ).run()
  
  const invoiceId = invoiceResult.meta.last_row_id
  console.log('[DEBUG] Invoice created successfully, ID:', invoiceId)
  
    // 月次明細のアサインメンバーから請求明細を作成
    const { results: monthlyMembers } = await DB.prepare(`
      SELECT 
        mma.id,
        mma.member_id,
        mma.allocation_ratio,
        mma.unit_price,
        mma.notes,
        m.name as member_name
      FROM monthly_member_assignments mma
      JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
    `).bind(monthlyDetailId).all()
    
    console.log('[DEBUG] Monthly members count:', monthlyMembers.length)
    
    let sortOrder = 1
    for (const member of monthlyMembers) {
      // allocation_ratioは既に0.0〜1.0の範囲（例: 0.2=20%, 0.5=50%）
      const quantity = member.allocation_ratio
      const amount = Math.floor(monthlyDetail.amount * member.allocation_ratio)
      
      await DB.prepare(`
        INSERT INTO invoice_items (
          invoice_id, member_id, item_description,
          quantity, unit, unit_price, amount, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoiceId,
        member.member_id,
        `${member.member_name} 稼働費用（${monthlyDetail.target_month}）`,
        quantity,
        '人月',
        member.unit_price,
        amount,
        sortOrder++
      ).run()
    }
    
    console.log('[DEBUG] All invoice items created successfully')
    
    // 月次明細の請求情報を更新
    await DB.prepare(`
      UPDATE monthly_details 
      SET billing_status = '請求済',
          billing_date = ?,
          invoice_number = ?
      WHERE id = ?
    `).bind(issue_date, invoiceNumber, monthlyDetailId).run()
    
    console.log('[DEBUG] Monthly details updated successfully')
    
    // 変更履歴を記録
    await DB.prepare(`
      INSERT INTO status_change_histories (
        table_name, record_id, field_name, 
        old_value, new_value, reason, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'monthly_details',
      monthlyDetailId,
      'billing_status',
      monthlyDetail.billing_status,
      '請求済',
      `請求書作成: ${invoiceNumber}`,
      user.email
    ).run()
    
    console.log('[DEBUG] History recorded successfully')
    
    return c.json({
      success: true,
      data: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber
      }
    })
  } catch (error) {
    console.error('Invoice creation error:', error)
    // エラーの詳細情報を出力
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    return c.json({ 
      success: false, 
      error: `請求書の作成に失敗しました: ${error instanceof Error ? error.message : String(error)}`
    }, 500)
  }
})


export default app
