import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'

const app = new Hono<AppEnv>()

app.post('/', authMiddleware, requirePermission('contract_manage'), async (c) => {
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

  // メンバー名を取得
  const member = await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(member_id).first()
  
  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('monthly_member_assignments', result.meta.last_row_id, 'member_assigned', 'null', `${member.name} (稼働率:${allocation_ratio * 100}%, 単価:¥${unit_price})`, '管理者').run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

app.post('/batch', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { monthly_detail_id, assignments } = await c.req.json()

  // バリデーション
  if (!monthly_detail_id || !assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return c.json({ success: false, error: 'Invalid request format' }, 400)
  }

  const results = []
  const errors = []

  for (const assignment of assignments) {
    const { member_id, allocation_ratio, unit_price, notes } = assignment

    // バリデーション
    if (!member_id || allocation_ratio === undefined || !unit_price) {
      errors.push({ member_id, error: 'Required fields are missing' })
      continue
    }

    // 稼働率は0-1の範囲
    if (allocation_ratio < 0 || allocation_ratio > 1) {
      errors.push({ member_id, error: 'Work ratio must be between 0 and 1' })
      continue
    }

    // 既存のアサインを確認
    const existing = await c.env.DB.prepare(`
      SELECT * FROM monthly_member_assignments 
      WHERE monthly_detail_id = ? AND member_id = ?
    `).bind(monthly_detail_id, member_id).first()

    if (existing) {
      errors.push({ member_id, error: 'Member is already assigned to this monthly detail' })
      continue
    }

    try {
      // 追加
      const result = await c.env.DB.prepare(`
        INSERT INTO monthly_member_assignments 
        (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(monthly_detail_id, member_id, allocation_ratio, unit_price, notes || '').run()

      results.push({ member_id, id: result.meta.last_row_id })
    } catch (error) {
      errors.push({ member_id, error: error.message })
    }
  }

  return c.json({ 
    success: errors.length === 0, 
    results, 
    errors,
    message: `${results.length}件のメンバーを追加しました${errors.length > 0 ? `（${errors.length}件のエラー）` : ''}`
  })
})

app.put('/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')
  const { allocation_ratio, unit_price, notes } = await c.req.json()

  // バリデーション
  if (allocation_ratio !== undefined && (allocation_ratio < 0 || allocation_ratio > 1)) {
    return c.json({ success: false, error: 'Work ratio must be between 0 and 1' }, 400)
  }

  // 現在の値を取得
  const current = await c.env.DB.prepare('SELECT * FROM monthly_member_assignments WHERE id = ?').bind(id).first()
  if (!current) return c.json({ success: false, error: 'Assignment not found' }, 404)

  // 変更履歴を記録
  if (current.allocation_ratio !== allocation_ratio) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'allocation_ratio', current.allocation_ratio.toString(), allocation_ratio.toString(), '管理者').run()
  }
  
  if (current.unit_price !== unit_price) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'unit_price', current.unit_price.toString(), unit_price.toString(), '管理者').run()
  }
  
  if (current.notes !== notes) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'notes', current.notes || 'null', notes || 'null', '管理者').run()
  }

  // 更新
  await c.env.DB.prepare(`
    UPDATE monthly_member_assignments 
    SET allocation_ratio = ?, unit_price = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(allocation_ratio, unit_price, notes || '', id).run()

  return c.json({ success: true })
})

app.delete('/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')

  // 削除前に情報を取得
  const assignment = await c.env.DB.prepare(`
    SELECT mma.*, m.name as member_name
    FROM monthly_member_assignments mma
    JOIN members m ON mma.member_id = m.id
    WHERE mma.id = ?
  `).bind(id).first()
  
  if (assignment) {
    // 変更履歴を記録
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'member_unassigned', `${assignment.member_name} (稼働率:${assignment.allocation_ratio * 100}%, 単価:¥${assignment.unit_price})`, 'null', '管理者').run()
  }

  await c.env.DB.prepare('DELETE FROM monthly_member_assignments WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})


export default app
