import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'
import { updateContractStatusIfCompleted } from '../../lib/helpers'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT bd.*,
      (SELECT COUNT(*) FROM deposit_allocations da WHERE da.bank_deposit_id = bd.id) as allocation_count
    FROM bank_deposits bd
    ORDER BY bd.deposit_date DESC, bd.created_at DESC
  `).all()
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(id).first()
  if (!deposit) {
    return c.json({ success: false, error: '銀行入金が見つかりません' }, 404)
  }
  
  const { results: allocations } = await DB.prepare(`
    SELECT da.*, 
      md.target_month, md.amount as md_amount, md.amount_with_tax as md_amount_with_tax,
      md.payment_status,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM deposit_allocations da
    INNER JOIN monthly_details md ON da.monthly_detail_id = md.id
    INNER JOIN contracts c ON md.contract_id = c.id
    INNER JOIN projects p ON c.project_id = p.id
    INNER JOIN leads l ON p.lead_id = l.id
    WHERE da.bank_deposit_id = ?
    ORDER BY da.created_at DESC
  `).bind(id).all()
  
  return c.json({ success: true, data: { ...deposit, allocations } })
})

app.post('/', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const { deposit_date, amount, payer_name, note } = await c.req.json()
  
  if (!deposit_date || !amount || !payer_name) {
    return c.json({ success: false, error: '入金日、入金額、振込人名は必須です' }, 400)
  }
  if (amount <= 0) {
    return c.json({ success: false, error: '入金額は1円以上である必要があります' }, 400)
  }
  
  const user = c.get('user') as any
  const result = await DB.prepare(`
    INSERT INTO bank_deposits (deposit_date, amount, payer_name, note, remaining_amount, status, created_by)
    VALUES (?, ?, ?, ?, ?, '未消込', ?)
  `).bind(deposit_date, amount, payer_name, note || null, amount, user?.email || '管理者').run()
  
  return c.json({ success: true, id: result.meta.last_row_id })
})

app.post('/:id/allocate', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const depositId = c.req.param('id')
  const { allocations } = await c.req.json()
  
  if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
    return c.json({ success: false, error: '消込対象を選択してください' }, 400)
  }
  
  // 銀行入金を取得
  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(depositId).first() as any
  if (!deposit) {
    return c.json({ success: false, error: '銀行入金が見つかりません' }, 404)
  }
  
  // 消込合計額を検証
  const totalAllocating = allocations.reduce((sum: number, a: any) => sum + a.amount, 0)
  if (totalAllocating <= 0) {
    return c.json({ success: false, error: '消込額は1円以上である必要があります' }, 400)
  }
  if (totalAllocating > deposit.remaining_amount) {
    return c.json({ success: false, error: `消込合計額(¥${totalAllocating.toLocaleString()})が未消込残高(¥${deposit.remaining_amount.toLocaleString()})を超えています` }, 400)
  }
  
  const user = c.get('user') as any
  const createdBy = user?.email || '管理者'
  
  // 各消込を実行
  for (const alloc of allocations) {
    const { monthly_detail_id, amount } = alloc
    if (!monthly_detail_id || !amount || amount <= 0) continue
    
    // 月次明細の検証
    const md = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
    if (!md) continue
    
    const expectedAmount = md.amount_with_tax || md.amount
    const currentPaid = md.total_payment_amount || 0
    const remaining = expectedAmount - currentPaid
    
    if (amount > remaining) {
      return c.json({ success: false, error: `月次明細ID:${monthly_detail_id}（${md.target_month}）の未入金額(¥${remaining.toLocaleString()})を超える消込はできません` }, 400)
    }
    
    // deposit_allocations に記録
    await DB.prepare(`
      INSERT INTO deposit_allocations (bank_deposit_id, monthly_detail_id, allocated_amount, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(depositId, monthly_detail_id, amount, createdBy).run()
    
    // payment_histories にも自動で記録（既存の入金ステータス更新ロジック互換）
    await DB.prepare(`
      INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(monthly_detail_id, deposit.deposit_date, amount, `銀行入金消込 (入金ID:${depositId} / ${deposit.payer_name})`, createdBy).run()
    
    // 累計入金額を再計算
    const { results: histories } = await DB.prepare(
      'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
    ).bind(monthly_detail_id).all()
    const totalPayment = (histories[0] as any)?.total || 0
    
    // 入金ステータス判定
    let paymentStatus = '未入金'
    if (totalPayment >= expectedAmount) {
      paymentStatus = '入金完了'
    } else if (totalPayment > 0) {
      paymentStatus = '部分入金'
    }
    
    // 月次明細を更新
    await DB.prepare(`
      UPDATE monthly_details 
      SET total_payment_amount = ?, payment_status = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(totalPayment, paymentStatus, deposit.deposit_date, monthly_detail_id).run()
    
    // 契約ステータス自動更新
    if (md.contract_id) {
      await updateContractStatusIfCompleted(DB, md.contract_id)
    }
  }
  
  // 銀行入金の残高・ステータスを更新
  const newRemaining = deposit.remaining_amount - totalAllocating
  let depositStatus = '消込完了'
  if (newRemaining > 0) {
    depositStatus = '一部消込'
  }
  
  await DB.prepare(`
    UPDATE bank_deposits 
    SET remaining_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(newRemaining, depositStatus, depositId).run()
  
  return c.json({ success: true, message: '消込が完了しました', remaining_amount: newRemaining, status: depositStatus })
})

// 入金情報の修正（未消込・一部消込）
app.put('/:id', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')

  // 既存レコード取得
  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(id).first() as any
  if (!deposit) {
    return c.json({ success: false, error: '銀行入金が見つかりません' }, 404)
  }

  // 消込完了は修正不可
  if (deposit.status === '消込完了') {
    return c.json({ success: false, error: '消込完了の入金情報は修正できません。' }, 400)
  }

  const { deposit_date, amount, payer_name, note } = await c.req.json()

  // バリデーション
  if (!deposit_date || !amount || !payer_name) {
    return c.json({ success: false, error: '入金日、入金額、振込人名は必須です' }, 400)
  }
  if (amount <= 0) {
    return c.json({ success: false, error: '入金額は1円以上である必要があります' }, 400)
  }

  // 消込済み額を算出
  const consumed = deposit.amount - deposit.remaining_amount

  // 一部消込の場合、消込済み額以上でなければならない
  if (deposit.status === '一部消込' && amount < consumed) {
    return c.json({ success: false, error: `消込済み額(¥${consumed.toLocaleString()})を下回る金額には変更できません。` }, 400)
  }

  // remaining_amount と status を再計算
  const newRemaining = amount - consumed
  let newStatus = deposit.status
  if (consumed === 0) {
    newStatus = '未消込'
  } else if (newRemaining <= 0) {
    newStatus = '消込完了'
  } else {
    newStatus = '一部消込'
  }

  await DB.prepare(`
    UPDATE bank_deposits 
    SET deposit_date = ?, amount = ?, payer_name = ?, note = ?, remaining_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(deposit_date, amount, payer_name, note || null, newRemaining, newStatus, id).run()

  return c.json({ success: true, message: '入金情報を更新しました' })
})

// 入金情報の削除（未消込のみ）
app.delete('/:id', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')

  // 既存レコード取得
  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(id).first() as any
  if (!deposit) {
    return c.json({ success: false, error: '銀行入金が見つかりません' }, 404)
  }

  // 未消込ガードチェック
  if (deposit.status !== '未消込') {
    return c.json({ success: false, error: '消込済みの入金情報は削除できません。ステータスが「未消込」の場合のみ削除可能です。' }, 400)
  }

  // 消込レコードがないことを確認（安全策）
  const allocCount = await DB.prepare(
    'SELECT COUNT(*) as cnt FROM deposit_allocations WHERE bank_deposit_id = ?'
  ).bind(id).first() as any
  if (allocCount && allocCount.cnt > 0) {
    return c.json({ success: false, error: '消込履歴が存在するため削除できません' }, 400)
  }

  await DB.prepare('DELETE FROM bank_deposits WHERE id = ?').bind(id).run()

  return c.json({ success: true, message: '入金情報を削除しました' })
})


// 消込履歴の取消（巻き戻し）
app.delete('/:id/allocations/:allocationId', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const depositId = c.req.param('id')
  const allocationId = c.req.param('allocationId')

  // 消込レコード取得
  const alloc = await DB.prepare(
    'SELECT * FROM deposit_allocations WHERE id = ? AND bank_deposit_id = ?'
  ).bind(allocationId, depositId).first() as any
  if (!alloc) {
    return c.json({ success: false, error: '消込履歴が見つかりません' }, 404)
  }

  // 銀行入金取得
  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(depositId).first() as any
  if (!deposit) {
    return c.json({ success: false, error: '銀行入金が見つかりません' }, 404)
  }

  // 対応する payment_histories レコードを特定・削除
  const ph = await DB.prepare(`
    SELECT id FROM payment_histories
    WHERE monthly_detail_id = ?
      AND payment_amount = ?
      AND note LIKE ?
    LIMIT 1
  `).bind(alloc.monthly_detail_id, alloc.allocated_amount, `%銀行入金消込 (入金ID:${depositId}%`).first() as any
  if (ph) {
    await DB.prepare('DELETE FROM payment_histories WHERE id = ?').bind(ph.id).run()
  }

  // deposit_allocations レコード削除
  await DB.prepare('DELETE FROM deposit_allocations WHERE id = ?').bind(allocationId).run()

  // 月次明細の再計算
  const md = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(alloc.monthly_detail_id).first() as any
  if (md) {
    const { results: histories } = await DB.prepare(
      'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
    ).bind(alloc.monthly_detail_id).all()
    const totalPayment = (histories[0] as any)?.total || 0
    const expectedAmount = md.amount_with_tax || md.amount

    let paymentStatus = '未入金'
    if (totalPayment >= expectedAmount) {
      paymentStatus = '入金完了'
    } else if (totalPayment > 0) {
      paymentStatus = '部分入金'
    }

    await DB.prepare(`
      UPDATE monthly_details
      SET total_payment_amount = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(totalPayment, paymentStatus, alloc.monthly_detail_id).run()

    // 契約ステータス再判定
    if (md.contract_id) {
      await updateContractStatusIfCompleted(DB, md.contract_id)
    }
  }

  // 銀行入金の remaining_amount, status を再計算
  const newRemaining = deposit.remaining_amount + alloc.allocated_amount
  let depositStatus = '未消込'
  if (newRemaining <= 0) {
    depositStatus = '消込完了'
  } else if (newRemaining < deposit.amount) {
    depositStatus = '一部消込'
  }

  await DB.prepare(`
    UPDATE bank_deposits
    SET remaining_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(newRemaining, depositStatus, depositId).run()

  return c.json({ success: true, message: '消込を取り消しました', remaining_amount: newRemaining, status: depositStatus })
})


export default app
