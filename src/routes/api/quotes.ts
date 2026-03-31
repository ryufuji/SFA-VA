import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'
import { logAction } from '../../auth'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const { results } = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    ORDER BY q.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const quote = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific,
      l.billing_postal_code as postal_code,
      l.billing_address as address
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.id = ?
  `).bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  // 見積明細を取得
  const { results: items } = await DB.prepare(`
    SELECT 
      qi.*,
      m.name as member_name
    FROM quote_items qi
    LEFT JOIN members m ON qi.member_id = m.id
    WHERE qi.quote_id = ?
    ORDER BY qi.sort_order ASC
  `).bind(id).all()
  
  return c.json({ success: true, data: { ...quote, items } })
})

app.put('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { issue_date, expiry_date, subject, notes } = body
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    await DB.prepare(`
      UPDATE quotes 
      SET issue_date = ?,
          expiry_date = ?,
          subject = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      issue_date,
      expiry_date || null,
      subject,
      notes || null,
      id
    ).run()
    
    await logAction(
      DB,
      user.userId,
      'update_quote',
      'quotes',
      parseInt(id),
      body,
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '見積書を更新しました' })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の更新に失敗しました: ' + error.message }, 500)
  }
})

app.put('/:id/status', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { status, comment } = body
  
  // ステータスのバリデーション
  const validStatuses = ['draft', 'pending', 'approved', 'rejected', 'expired']
  if (!validStatuses.includes(status)) {
    return c.json({ success: false, error: '無効なステータスです' }, 400)
  }
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    // 現在のステータス
    const fromStatus = quote.status || 'draft'
    
    // ステータスを更新
    await DB.prepare(`
      UPDATE quotes 
      SET status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, id).run()
    
    // ステータス変更履歴を記録
    await DB.prepare(`
      INSERT INTO quote_status_changes (quote_id, from_status, to_status, changed_by, comment)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      id,
      fromStatus,
      status,
      user.userId,
      comment || null
    ).run()
    
    // アクションログに記録
    await logAction(
      DB,
      user.userId,
      'change_quote_status',
      'quotes',
      parseInt(id),
      { from: fromStatus, to: status, comment },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: 'ステータスを更新しました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'ステータスの更新に失敗しました: ' + error.message }, 500)
  }
})

app.get('/:id/status-history', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const { results } = await DB.prepare(`
    SELECT 
      qsc.*,
      COALESCE(m.name, u.email) as changed_by_name
    FROM quote_status_changes qsc
    LEFT JOIN users u ON qsc.changed_by = u.id
    LEFT JOIN members m ON u.member_id = m.id
    WHERE qsc.quote_id = ?
    ORDER BY qsc.changed_at DESC
  `).bind(id).all()
  
  return c.json({ success: true, data: results || [] })
})

app.delete('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    // 明細を削除
    await DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id).run()
    
    // 見積書を削除
    await DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id).run()
    
    await logAction(
      DB,
      user.userId,
      'delete_quote',
      'quotes',
      parseInt(id),
      quote,
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '見積書を削除しました' })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の削除に失敗しました: ' + error.message }, 500)
  }
})

app.get('/:id/pdf-data', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 見積書情報取得
  const quote = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific,
      l.billing_postal_code as customer_postal_code,
      l.billing_address as customer_address
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.id = ?
  `).bind(id).first() as any
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  // 見積明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      qi.*,
      m.name as member_name
    FROM quote_items qi
    LEFT JOIN members m ON qi.member_id = m.id
    WHERE qi.quote_id = ?
    ORDER BY qi.sort_order ASC
  `).bind(id).all()
  
  // 自社情報取得
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  return c.json({
    success: true,
    data: {
      quote,
      items,
      companyInfo
    }
  })
})


export default app
