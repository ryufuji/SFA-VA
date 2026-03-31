import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'
import { updateContractStatusIfCompleted } from '../../lib/helpers'

const app = new Hono<AppEnv>()

app.post('/payment-histories', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { monthly_detail_id, payment_date, payment_amount, note } = body
  
  // 基本的な必須フィールドチェック
  if (!monthly_detail_id || !payment_date || payment_amount === undefined || payment_amount === null) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }
  
  // 月次明細の金額を取得
  const detail = await DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  if (!detail) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  const monthlyAmount = detail.amount || 0
  
  // 入金額が0円の場合、月次明細の金額も0円でないとエラー
  if (payment_amount === 0 && monthlyAmount !== 0) {
    return c.json({ success: false, error: '0円の入金は、月次明細の金額が0円の場合のみ登録できます' }, 400)
  }
  
  // 入金額が負の値の場合はエラー
  if (payment_amount < 0) {
    return c.json({ success: false, error: '入金額は0以上である必要があります' }, 400)
  }
  
  // 入金履歴を追加
  const result = await DB.prepare(
    'INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(monthly_detail_id, payment_date, payment_amount, note || null, '管理者').run()
  
  // 変更履歴を記録
  await DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('payment_histories', result.meta.last_row_id, 'payment_added', 'null', `¥${payment_amount} (${payment_date})`, '管理者').run()
  
  // 累計入金額を再計算
  const { results: histories } = await DB.prepare(
    'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
  ).bind(monthly_detail_id).all()
  
  const totalPayment = (histories[0] as any)?.total || 0
  
  // 入金ステータスの判定
  // 月次明細の税込み金額で比較する
  const monthlyDetailForTax = await DB.prepare('SELECT amount_with_tax FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  const expectedPaymentAmount = monthlyDetailForTax?.amount_with_tax || monthlyAmount
  
  let paymentStatus = '未入金'
  if (totalPayment >= expectedPaymentAmount) {
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
  
  // 月次明細の契約IDを取得
  const monthlyDetailForContract = await DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  if (monthlyDetailForContract?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(DB, monthlyDetailForContract.contract_id)
  }
  
  return c.json({ success: true, message: 'Payment added successfully', totalPayment, paymentStatus })
})

app.get('/payment-summary', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // リード単位で月毎の入金総額を集計
  const { results: paymentSummary } = await DB.prepare(`
    SELECT 
      l.id as lead_id,
      l.company_name,
      l.department,
      md.target_month,
      SUM(COALESCE(ph.payment_amount, 0)) as total_payment,
      SUM(md.amount) as total_amount_before_tax,
      SUM(md.amount_with_tax) as total_amount_with_tax
    FROM leads l
    INNER JOIN projects p ON l.id = p.lead_id
    INNER JOIN contracts c ON p.id = c.project_id
    INNER JOIN monthly_details md ON c.id = md.contract_id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY l.id, l.company_name, l.department, md.target_month
    ORDER BY md.target_month DESC, l.company_name ASC
  `).all()
  
  return c.json({
    success: true,
    data: paymentSummary
  })
})

app.delete('/payment-histories/:id', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const id = c.req.param('id')

  // 入金履歴を取得
  const payment = await c.env.DB.prepare('SELECT * FROM payment_histories WHERE id = ?').bind(id).first()
  if (!payment) return c.notFound()

  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('payment_histories', id, 'payment_deleted', `¥${payment.payment_amount} (${payment.payment_date})`, 'null', '管理者').run()

  // 削除
  await c.env.DB.prepare('DELETE FROM payment_histories WHERE id = ?').bind(id).run()

  // 月次明細の合計入金額を再計算
  const { results: histories } = await c.env.DB.prepare(`
    SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?
  `).bind(payment.monthly_detail_id).all()

  const totalPayment = histories[0]?.total || 0

  // 月次明細の金額を取得
  const detail = await c.env.DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(payment.monthly_detail_id).first()
  const monthlyAmount = detail?.amount || 0

  // 入金ステータスの判定
  let paymentStatus = '未入金'
  if (totalPayment >= monthlyAmount) {
    paymentStatus = '入金完了'
  } else if (totalPayment > 0) {
    paymentStatus = '部分入金'
  }

  // 月次明細を更新
  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, 
        payment_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalPayment, paymentStatus, payment.monthly_detail_id).run()

  // 月次明細の契約IDを取得
  const monthlyDetail = await c.env.DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(payment.monthly_detail_id).first() as any
  if (monthlyDetail?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(c.env.DB, monthlyDetail.contract_id)
  }

  return c.json({ success: true })
})

app.post('/payment-histories/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { payment_histories } = await c.req.json()

  if (!Array.isArray(payment_histories) || payment_histories.length === 0) {
    return c.json({ success: false, error: '入金履歴データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < payment_histories.length; i++) {
    const payment = payment_histories[i]
    const { monthly_detail_id, payment_date, payment_amount, note } = payment

    // バリデーション
    if (!monthly_detail_id) {
      errors.push({ line: i + 2, monthly_detail_id: '', error: '月次明細IDは必須です' })
      error_count++
      continue
    }

    if (!payment_date) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金日は必須です' })
      error_count++
      continue
    }

    if (payment_amount === undefined || payment_amount === null) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金金額は必須です' })
      error_count++
      continue
    }

    if (payment_amount < 0) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金金額は0以上である必要があります' })
      error_count++
      continue
    }

    try {
      // 月次明細が存在するか確認
      const detail = await DB.prepare('SELECT id, amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first()
      
      if (!detail) {
        errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '該当する月次明細が見つかりません' })
        error_count++
        continue
      }

      // 入金履歴を追加
      const result = await DB.prepare(`
        INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        monthly_detail_id,
        payment_date,
        payment_amount,
        note || null,
        '管理者(CSV)'
      ).run()

      // 変更履歴を記録
      await DB.prepare(`
        INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('payment_histories', result.meta.last_row_id, 'payment_added', 'null', `¥${payment_amount} (${payment_date})`, '管理者(CSV)').run()

      // 累計入金額を再計算
      const { results: histories } = await DB.prepare(
        'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
      ).bind(monthly_detail_id).all()
      
      const totalPayment = (histories[0] as any)?.total || 0
      
      // 入金ステータスの判定
      let paymentStatus = '未入金'
      if (totalPayment >= (detail.amount || 0)) {
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

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: payment_histories.length,
    success_count,
    error_count,
    errors
  })
})


export default app
