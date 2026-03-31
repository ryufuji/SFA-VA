import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const { results } = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    ORDER BY i.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const invoice = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific,
      l.billing_postal_code,
      l.billing_address,
      l.billing_contact_name
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    WHERE i.id = ?
  `).bind(id).first() as any
  
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      ii.*,
      m.name as member_name
    FROM invoice_items ii
    LEFT JOIN members m ON ii.member_id = m.id
    WHERE ii.invoice_id = ?
    ORDER BY ii.sort_order ASC
  `).bind(id).all()
  
  return c.json({ success: true, data: { ...invoice, items } })
})

app.put('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { payment_status, payment_date, notes } = body
  
  await DB.prepare(`
    UPDATE invoices 
    SET payment_status = ?,
        payment_date = ?,
        notes = ?
    WHERE id = ?
  `).bind(payment_status, payment_date || null, notes || null, id).run()
  
  return c.json({ success: true })
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 請求書が存在するか確認
  const invoice = await DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first()
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細を削除
  await DB.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id).run()
  
  // 請求書を削除
  await DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run()
  
  return c.json({ success: true })
})

app.get('/:id/pdf-data', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 請求書情報取得
  const invoice = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific,
      l.billing_postal_code,
      l.billing_address,
      l.billing_contact_name
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    WHERE i.id = ?
  `).bind(id).first() as any
  
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      ii.*,
      m.name as member_name
    FROM invoice_items ii
    LEFT JOIN members m ON ii.member_id = m.id
    WHERE ii.invoice_id = ?
    ORDER BY ii.sort_order ASC
  `).bind(id).all()
  
  // 自社情報取得
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  return c.json({
    success: true,
    data: {
      invoice,
      items,
      companyInfo
    }
  })
})


export default app
