import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin } from '../../middleware/auth'
import { hashPassword, logAction } from '../../auth'
import { VALID_PERMISSIONS } from '../../lib/constants'
import { transformRecord, validateRecord, checkDuplicate, insertRecord } from '../../lib/import-helpers'

const app = new Hono<AppEnv>()

app.get('/users', authMiddleware, requireAdmin, async (c) => {
  const users = await c.env.DB.prepare(`
    SELECT 
      u.id,
      u.email,
      u.role,
      u.is_active,
      u.created_at,
      u.last_login_at,
      m.name as member_name,
      GROUP_CONCAT(up.permission_name) as permissions
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    LEFT JOIN user_permissions up ON u.id = up.user_id
    GROUP BY u.id, u.email, u.role, u.is_active, u.created_at, u.last_login_at, m.name
    ORDER BY u.created_at DESC
  `).all()
  
  const formattedUsers = users.results.map((user: any) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.member_name || '管理者',
    isActive: user.is_active === 1,
    permissions: user.permissions ? user.permissions.split(',') : [],
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at
  }))
  
  return c.json({ success: true, data: formattedUsers })
})

app.put('/users/:id/permissions', authMiddleware, requireAdmin, async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')
  const { permissions } = await c.req.json()
  
  // バリデーション
  if (!Array.isArray(permissions)) {
    return c.json({ error: '権限は配列形式で指定してください' }, 400)
  }
  
  const validPermissions = ['lead_manage', 'contract_manage', 'billing_manage', 'payment_manage', 'member_manage']
  const invalidPermissions = permissions.filter((p: string) => !validPermissions.includes(p))
  if (invalidPermissions.length > 0) {
    return c.json({ error: `無効な権限が含まれています: ${invalidPermissions.join(', ')}` }, 400)
  }
  
  // 対象ユーザーの確認
  const targetUser = await c.env.DB.prepare(`
    SELECT id, email, role FROM users WHERE id = ?
  `).bind(userId).first()
  
  if (!targetUser) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 管理者の権限は変更不可
  if (targetUser.role === 'admin') {
    return c.json({ error: '管理者の権限は変更できません' }, 403)
  }
  
  // 既存の権限を取得（監査ログ用）
  const oldPermissions = await c.env.DB.prepare(`
    SELECT permission_name FROM user_permissions WHERE user_id = ?
  `).bind(userId).all()
  
  const oldPermissionList = oldPermissions.results.map((p: any) => p.permission_name)
  
  // トランザクション開始（既存権限を削除して新しい権限を追加）
  await c.env.DB.prepare(`DELETE FROM user_permissions WHERE user_id = ?`).bind(userId).run()
  
  for (const permission of permissions) {
    await c.env.DB.prepare(`
      INSERT INTO user_permissions (user_id, permission_name) VALUES (?, ?)
    `).bind(userId, permission).run()
  }
  
  // 監査ログ記録
  await logAction(
    c.env.DB, 
    adminUser.userId, 
    'update_user_permissions', 
    'users', 
    userId, 
    {
      old_permissions: oldPermissionList,
      new_permissions: permissions
    },
    c.req.header('CF-Connecting-IP')
  )
  
  return c.json({ 
    success: true, 
    message: '権限を更新しました',
    data: {
      userId: userId,
      permissions: permissions
    }
  })
})

app.put('/users/:id/active', authMiddleware, requireAdmin, async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')
  const { is_active } = await c.req.json()
  
  // バリデーション
  if (typeof is_active !== 'boolean') {
    return c.json({ error: 'is_activeはboolean型で指定してください' }, 400)
  }
  
  // 対象ユーザーの確認
  const targetUser = await c.env.DB.prepare(`
    SELECT id, email, role, is_active FROM users WHERE id = ?
  `).bind(userId).first()
  
  if (!targetUser) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 管理者のアクティブ状態は変更不可
  if (targetUser.role === 'admin') {
    return c.json({ error: '管理者のアクティブ状態は変更できません' }, 403)
  }
  
  // 自分自身の状態は変更不可
  if (parseInt(userId) === adminUser.userId) {
    return c.json({ error: '自分自身のアクティブ状態は変更できません' }, 403)
  }
  
  // アクティブ状態を更新
  await c.env.DB.prepare(`
    UPDATE users SET is_active = ? WHERE id = ?
  `).bind(is_active ? 1 : 0, userId).run()
  
  // 監査ログ記録
  await logAction(
    c.env.DB, 
    adminUser.userId, 
    'update_user_status', 
    'users', 
    userId, 
    {
      old_status: targetUser.is_active === 1,
      new_status: is_active
    },
    c.req.header('CF-Connecting-IP')
  )
  
  return c.json({ 
    success: true, 
    message: `ユーザーを${is_active ? '有効' : '無効'}にしました` 
  })
})

app.post('/users/:id/reset-password', authMiddleware, requireAdmin, async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')
  const { new_password } = await c.req.json()

  // バリデーション
  if (!new_password || typeof new_password !== 'string') {
    return c.json({ error: '新しいパスワードを入力してください' }, 400)
  }
  if (new_password.length < 6) {
    return c.json({ error: 'パスワードは6文字以上で入力してください' }, 400)
  }

  // 対象ユーザーの確認
  const targetUser = await c.env.DB.prepare(`
    SELECT id, email, role FROM users WHERE id = ?
  `).bind(userId).first()

  if (!targetUser) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }

  // 管理者のパスワードは変更不可（自分自身を除く）
  if (targetUser.role === 'admin' && parseInt(userId) !== adminUser.userId) {
    return c.json({ error: '他の管理者のパスワードはリセットできません' }, 403)
  }

  // パスワードをハッシュ化して更新
  const hashedPassword = await hashPassword(new_password)
  await c.env.DB.prepare(`
    UPDATE users SET password_hash = ?, password_change_required = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(hashedPassword, userId).run()

  // 監査ログ記録
  await logAction(
    c.env.DB,
    adminUser.userId,
    'reset_user_password',
    'users',
    parseInt(userId),
    { target_email: targetUser.email },
    c.req.header('CF-Connecting-IP')
  )

  return c.json({
    success: true,
    message: 'パスワードをリセットしました。次回ログイン時にパスワード変更が求められます。'
  })
})

app.post('/import', authMiddleware, requireAdmin, async (c) => {
  const { type, data, skip_duplicates, auto_match, dry_run } = await c.req.json()
  
  const result = {
    success_count: 0,
    error_count: 0,
    skipped_count: 0,
    errors: [],
    dry_run: dry_run === true
  }
  
  if (!type || !data || !Array.isArray(data)) {
    return c.json({ error: 'Invalid request data' }, 400)
  }
  
  try {
    for (let i = 0; i < data.length; i++) {
      const record = data[i]
      
      try {
        // データ変換・バリデーション
        const transformed = await transformRecord(c.env.DB, type, record, auto_match)
        
        // 必須フィールドチェック
        const validationError = validateRecord(type, transformed)
        if (validationError) {
          throw new Error(validationError)
        }
        
        // 重複チェック
        if (skip_duplicates === true) {
          const exists = await checkDuplicate(c.env.DB, type, transformed)
          if (exists) {
            result.skipped_count++
            continue
          }
        }
        
        // インポート実行（dry_runでない場合のみ）
        if (dry_run !== true) {
          await insertRecord(c.env.DB, type, transformed)
        }
        
        result.success_count++
      } catch (error: any) {
        result.error_count++
        result.errors.push({
          row: i + 2,  // ヘッダー行を考慮
          message: error.message || 'Unknown error'
        })
      }
    }
    
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: 'インポート処理中にエラーが発生しました: ' + error.message }, 500)
  }
})


export default app
