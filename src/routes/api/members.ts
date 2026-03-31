import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'
import { hashPassword } from '../../auth'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(
    'SELECT * FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()
  
  return c.json({ success: true, data: results })
})

app.get('/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全メンバー取得（アクティブのみ）
  const { results } = await DB.prepare(
    'SELECT name, position, default_unit_price, email, memo FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()

  // CSVヘッダー
  let csv = '名前,役職,単価,メールアドレス,メモ\n'

  // データ行を追加
  for (const member of results) {
    const name = (member.name || '').replace(/"/g, '""')
    const position = (member.position || '').replace(/"/g, '""')
    const unit_price = member.default_unit_price || 0
    const email = (member.email || '').replace(/"/g, '""')
    const memo = (member.memo || '').replace(/"/g, '""')
    
    csv += '"' + name + '","' + position + '",' + unit_price + ',"' + email + '","' + memo + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="members.csv"'
    }
  })
})

app.get('/', async (c) => {
  const members = await c.env.DB.prepare(`
    SELECT id, name, email, default_unit_price, status
    FROM members
    WHERE status = 'active'
    ORDER BY name ASC
  `).all()

  return c.json({ success: true, data: members.results })
})

app.post('/create', authMiddleware, requirePermission('member_manage'), async (c) => {
  const body = await c.req.json()
  
  // 配列または単一オブジェクトを受け取る
  const members = Array.isArray(body) ? body : [body]
  
  if (members.length === 0) {
    return c.json({ success: false, error: 'No members provided' }, 400)
  }

  const results = []
  const errors = []

  for (let i = 0; i < members.length; i++) {
    const { name, email, default_unit_price, position, memo } = members[i]
    
    // バリデーション
    if (!name || !email || !default_unit_price) {
      errors.push({ index: i + 1, error: 'Name, email, and default unit price are required' })
      continue
    }

    try {
      // メールアドレスの重複チェック
      const existing = await c.env.DB.prepare(`
        SELECT id FROM members WHERE email = ?
      `).bind(email).first()

      if (existing) {
        errors.push({ index: i + 1, email, error: 'Email address already exists' })
        continue
      }

      // メンバーを挿入
      const result = await c.env.DB.prepare(`
        INSERT INTO members (name, email, default_unit_price, position, memo, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(name, email, default_unit_price, position || null, memo || null, 'active').run()

      // ユーザーも自動作成（権限なし）
      // まず、同じメールアドレスのユーザーが存在するかチェック
      const existingUser = await c.env.DB.prepare(`
        SELECT id FROM users WHERE email = ?
      `).bind(email).first()

      if (!existingUser) {
        // デフォルトパスワードはメールアドレスの@前の部分 + "1234"
        const defaultPassword = email.split('@')[0] + '1234'
        const hashedPassword = await hashPassword(defaultPassword)
        
        await c.env.DB.prepare(`
          INSERT INTO users (email, password_hash, role, member_id, password_change_required)
          VALUES (?, ?, ?, ?, ?)
        `).bind(email, hashedPassword, 'none', result.meta.last_row_id, 1).run()
      }

      results.push({ 
        index: i + 1, 
        id: result.meta.last_row_id, 
        name, 
        email 
      })
    } catch (error: any) {
      errors.push({ index: i + 1, email, error: error.message })
    }
  }

  return c.json({ 
    success: true, 
    total: members.length,
    success_count: results.length,
    error_count: errors.length,
    results, 
    errors 
  })
})

app.put('/:id', authMiddleware, requirePermission('member_manage'), async (c) => {
  const id = c.req.param('id')
  const { name, email, default_unit_price, position, memo } = await c.req.json()

  if (!name || !default_unit_price) {
    return c.json({ success: false, error: 'Name and default unit price are required' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE members 
    SET name = ?, email = ?, default_unit_price = ?, position = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, email || null, default_unit_price, position || null, memo || null, id).run()

  return c.json({ success: true })
})

app.put('/:id/status', authMiddleware, requirePermission('member_manage'), async (c) => {
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

app.post('/sync-users', authMiddleware, requireAdmin, async (c) => {
  try {
    // メールアドレスを持つ全メンバーを取得
    const members = await c.env.DB.prepare(`
      SELECT id, name, email FROM members WHERE email IS NOT NULL AND email != ''
    `).all()

    let addedCount = 0
    let skippedCount = 0
    const errors = []

    for (const member of members.results) {
      try {
        // 既にユーザーが存在するかチェック
        const existingUser = await c.env.DB.prepare(`
          SELECT id FROM users WHERE email = ?
        `).bind(member.email).first()

        if (existingUser) {
          skippedCount++
          continue
        }

        // ユーザーを作成
        const defaultPassword = member.email.split('@')[0] + '1234'
        const hashedPassword = await hashPassword(defaultPassword)
        
        await c.env.DB.prepare(`
          INSERT INTO users (email, password_hash, role, member_id, password_change_required)
          VALUES (?, ?, ?, ?, ?)
        `).bind(member.email, hashedPassword, 'none', member.id, 1).run()

        addedCount++
      } catch (error: any) {
        errors.push({ email: member.email, name: member.name, error: error.message })
      }
    }

    return c.json({
      success: true,
      total_members: members.results.length,
      synced_count: addedCount,
      skipped_count: skippedCount,
      errors: errors.map(e => ({ member_name: e.name || e.email, error: e.error }))
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const id = c.req.param('id')

  // メンバーが存在するか確認
  const member = await c.env.DB.prepare('SELECT status, name FROM members WHERE id = ?').bind(id).first()
  
  if (!member) {
    return c.json({ success: false, error: 'メンバーが見つかりません' }, 404)
  }

  // 無効なメンバーのみ削除可能
  if (member.status !== 'inactive') {
    return c.json({ success: false, error: '無効なメンバーのみ削除できます' }, 400)
  }

  // ユーザーアカウントが紐付けられているか確認
  const userCheck = await c.env.DB.prepare('SELECT id FROM users WHERE member_id = ?').bind(id).first()
  if (userCheck) {
    return c.json({ success: false, error: 'このメンバーにはユーザーアカウントが紐付けられているため削除できません。先にユーザーアカウントを削除してください。' }, 400)
  }

  // 月次アサインがあるか確認
  const assignmentCheck = await c.env.DB.prepare('SELECT id FROM monthly_member_assignments WHERE member_id = ?').bind(id).first()
  if (assignmentCheck) {
    return c.json({ success: false, error: 'このメンバーには月次アサイン履歴があるため削除できません。データの整合性を保つため、無効化のみ可能です。' }, 400)
  }

  // メンバーを削除
  try {
    await c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: 'メンバーを削除しました' })
  } catch (error) {
    return c.json({ success: false, error: '削除に失敗しました。このメンバーは他のデータから参照されている可能性があります。' }, 500)
  }
})

app.get('/workload', async (c) => {
  const { DB } = c.env
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // メンバーごとの今月のアサイン状況を取得
  const { results: memberWorkload } = await DB.prepare(`
    SELECT 
      m.id as member_id,
      m.name as member_name,
      m.email,
      m.default_unit_price,
      m.status,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.allocation_ratio ELSE 0 END), 0) as total_allocation,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.unit_price * mma.allocation_ratio ELSE 0 END), 0) as total_revenue,
      COUNT(DISTINCT CASE WHEN md.target_month = ? THEN mma.monthly_detail_id END) as project_count,
      GROUP_CONCAT(
        CASE WHEN md.target_month = ? THEN
          p.project_name || ' (' || CAST(ROUND(mma.allocation_ratio * 100) AS INTEGER) || '%): ¥' || 
          CAST(mma.unit_price AS TEXT) || ' | ' || COALESCE(mma.notes, '')
        END
      , '|||') as assignments
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name, m.email, m.default_unit_price, m.status
    ORDER BY total_allocation DESC, m.name ASC
  `).bind(currentMonth, currentMonth, currentMonth, currentMonth).all()
  
  return c.json({ success: true, data: memberWorkload })
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const memberId = parseInt(c.req.param('id'));

  if (!memberId) {
    return c.json({ success: false, error: 'メンバーIDが必要です' }, 400);
  }

  try {
    // 関連データの確認
    const contractAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    const monthlyAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      DB.prepare(`DELETE FROM contract_member_assignments WHERE member_id = ?`).bind(memberId),
      DB.prepare(`DELETE FROM monthly_member_assignments WHERE member_id = ?`).bind(memberId),
      DB.prepare(`UPDATE projects SET sales_rep_id = NULL WHERE sales_rep_id = ?`).bind(memberId),
      DB.prepare(`DELETE FROM members WHERE id = ?`).bind(memberId),
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        members: 1,
        contract_member_assignments: contractAssignments.count,
        monthly_member_assignments: monthlyAssignments.count
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const memberId = parseInt(c.req.param('id'));

  try {
    const contractAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    const monthlyAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    return c.json({
      success: true,
      impact: {
        contract_member_assignments_count: contractAssignments.count,
        monthly_member_assignments_count: monthlyAssignments.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});


export default app
