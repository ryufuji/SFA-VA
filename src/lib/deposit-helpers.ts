// 銀行入金の消込（入金 → 月次明細への割り当て）の共通処理
// 手動の消込（/api/bank-deposits/:id/allocate）と、振込明細の自動突合の両方から使う

import { updateContractStatusIfCompleted } from './helpers'

export type AllocationInput = { monthly_detail_id: number; amount: number }

export type AllocateResult =
  | { ok: true; remaining_amount: number; status: string }
  | { ok: false; status: 400 | 404; error: string }

export async function allocateDeposit(DB: D1Database, depositId: number | string, allocations: AllocationInput[], createdBy: string): Promise<AllocateResult> {
  if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
    return { ok: false, status: 400, error: '消込対象を選択してください' }
  }

  const deposit = await DB.prepare('SELECT * FROM bank_deposits WHERE id = ?').bind(depositId).first() as any
  if (!deposit) {
    return { ok: false, status: 404, error: '銀行入金が見つかりません' }
  }

  const totalAllocating = allocations.reduce((sum: number, a: any) => sum + a.amount, 0)
  if (totalAllocating <= 0) {
    return { ok: false, status: 400, error: '消込額は1円以上である必要があります' }
  }
  if (totalAllocating > deposit.remaining_amount) {
    return { ok: false, status: 400, error: `消込合計額(¥${totalAllocating.toLocaleString()})が未消込残高(¥${deposit.remaining_amount.toLocaleString()})を超えています` }
  }

  // 先に全件を検証する（途中まで消し込んでからエラーで止まるのを防ぐ）
  const targets: { md: any; amount: number; expectedAmount: number }[] = []
  for (const alloc of allocations) {
    const { monthly_detail_id, amount } = alloc
    if (!monthly_detail_id || !amount || amount <= 0) continue
    const md = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
    if (!md) continue
    const expectedAmount = md.amount_with_tax || md.amount
    const already = targets.filter(t => t.md.id === md.id).reduce((s, t) => s + t.amount, 0)
    const remaining = expectedAmount - (md.total_payment_amount || 0) - already
    if (amount > remaining) {
      return { ok: false, status: 400, error: `月次明細ID:${monthly_detail_id}（${md.target_month}）の未入金額(¥${remaining.toLocaleString()})を超える消込はできません` }
    }
    targets.push({ md, amount, expectedAmount })
  }

  let applied = 0
  for (const { md, amount, expectedAmount } of targets) {
    await DB.prepare(`
      INSERT INTO deposit_allocations (bank_deposit_id, monthly_detail_id, allocated_amount, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(depositId, md.id, amount, createdBy).run()

    // payment_histories にも記録（既存の入金ステータス更新ロジック互換）
    await DB.prepare(`
      INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(md.id, deposit.deposit_date, amount, `銀行入金消込 (入金ID:${depositId} / ${deposit.payer_name})`, createdBy).run()

    const row = await DB.prepare(
      'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
    ).bind(md.id).first() as any
    const totalPayment = row?.total || 0

    let paymentStatus = '未入金'
    if (totalPayment >= expectedAmount) paymentStatus = '入金完了'
    else if (totalPayment > 0) paymentStatus = '部分入金'

    await DB.prepare(`
      UPDATE monthly_details
      SET total_payment_amount = ?, payment_status = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(totalPayment, paymentStatus, deposit.deposit_date, md.id).run()

    if (md.contract_id) {
      await updateContractStatusIfCompleted(DB, md.contract_id)
    }
    applied += amount
  }

  const newRemaining = deposit.remaining_amount - applied
  const depositStatus = newRemaining <= 0 ? '消込完了' : newRemaining < deposit.amount ? '一部消込' : '未消込'
  await DB.prepare(`
    UPDATE bank_deposits
    SET remaining_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(newRemaining, depositStatus, depositId).run()

  return { ok: true, remaining_amount: newRemaining, status: depositStatus }
}
