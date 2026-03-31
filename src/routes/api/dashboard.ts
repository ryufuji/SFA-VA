import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<AppEnv>()

app.get('/summary', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 当月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 当月売上（対象月の全件、税込）
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ?'
  ).bind(currentMonth).all()
  
  // 未請求金額（billing_date <= 今日）
  const { results: unbilled } = await DB.prepare(
    "SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE billing_status = ? AND billing_date <= DATE('now')"
  ).bind('未請求').all()
  
  // 未入金金額（請求済のみ）
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount_with_tax - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?) AND billing_status = ?'
  ).bind('未入金', '部分入金', '請求済').all()
  
  return c.json({
    success: true,
    data: {
      currentMonthSales: (currentMonthSales[0] as any)?.total || 0,
      unbilledAmount: (unbilled[0] as any)?.total || 0,
      unpaidAmount: (unpaid[0] as any)?.total || 0
    }
  })
})

app.get('/sales-trend', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 直近12ヶ月のデータを取得（対象月ベース、全件）
  const { results } = await DB.prepare(`
    SELECT 
      target_month,
      SUM(amount_with_tax) as confirmed_sales
    FROM monthly_details
    WHERE target_month >= strftime('%Y-%m', date('now', '-12 months'))
    GROUP BY target_month
    ORDER BY target_month ASC
  `).all()
  
  return c.json({ success: true, data: results })
})

app.get('/pending-tasks', authMiddleware, async (c) => {
  const { DB } = c.env
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = now.toISOString().split('T')[0]
  
  // 請求期限間近・超過（未請求で対象月末から3日以上経過）
  const { results: overdueBillings } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      md.billing_status,
      julianday('now') - julianday(date(md.target_month || '-01', '+1 month', '-1 day')) as days_since_month_end
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE md.billing_status = '未請求'
      AND julianday('now') - julianday(date(md.target_month || '-01', '+1 month', '-1 day')) >= 3
    ORDER BY days_since_month_end DESC
    LIMIT 10
  `).all()
  
  // 入金予定日超過（請求済だが未入金/部分入金で入金予定日が過去）
  const { results: overduePayments } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      md.total_payment_amount,
      md.payment_status,
      md.expected_payment_date,
      julianday('now') - julianday(md.expected_payment_date) as days_overdue
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE md.billing_status = '請求済'
      AND md.payment_status IN ('未入金', '部分入金')
      AND md.expected_payment_date IS NOT NULL
      AND md.expected_payment_date < ?
    ORDER BY days_overdue DESC
    LIMIT 10
  `).bind(today).all()
  
  // 金額と想定売上の不一致（月次明細の金額と、メンバーアサインの想定売上が一致しない）
  const { results: amountMismatch } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0) as expected_revenue,
      ABS(md.amount - COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0)) as difference
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN monthly_member_assignments mma ON md.id = mma.monthly_detail_id
    GROUP BY md.id, md.target_month, c.contract_name, p.project_name, md.amount
    HAVING ABS(md.amount - COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0)) > 0
    ORDER BY difference DESC
    LIMIT 10
  `).all()
  
  // 入金不一致（入金総額が0より大きく、月次明細金額と異なる場合）
  // payment_historiesから実際の入金額を集計して比較（税込み額で比較）
  const { results: paymentMismatches } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount_with_tax,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment_amount,
      ABS(md.amount_with_tax - COALESCE(SUM(ph.payment_amount), 0)) as difference
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY md.id, md.target_month, c.contract_name, p.project_name, md.amount_with_tax
    HAVING COALESCE(SUM(ph.payment_amount), 0) > 0 
      AND md.amount_with_tax != COALESCE(SUM(ph.payment_amount), 0)
    ORDER BY difference DESC
    LIMIT 10
  `).all()
  
  return c.json({ 
    success: true, 
    data: {
      overdueBillings,
      overduePayments,
      amountMismatch,
      paymentMismatches
    }
  })
})


export default app
