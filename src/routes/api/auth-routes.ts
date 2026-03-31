import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, generateJWT } from '../../middleware/auth'
import { ADMIN_PERMISSIONS, getUserPermissions, hashPassword, logAction, verifyPassword } from '../../auth'

const app = new Hono<AppEnv>()

app.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  
  // バリデーション
  if (!email || !password) {
    return c.json({ error: 'メールアドレスとパスワードを入力してください' }, 400)
  }
  
  // ユーザー検索
  const user = await c.env.DB.prepare(`
    SELECT u.*, m.name as member_name 
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    WHERE u.email = ? AND u.is_active = 1
  `).bind(email).first()
  
  if (!user) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }
  
  // パスワード検証
  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }
  
  // 権限取得
  const permissions = user.role === 'admin' 
    ? ADMIN_PERMISSIONS
    : await getUserPermissions(c.env.DB, user.id)
  
  // JWT生成
  const token = await generateJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    permissions: permissions
  })
  
  // 最終ログイン時刻更新
  await c.env.DB.prepare(`
    UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(user.id).run()
  
  // 監査ログ記録
  await logAction(c.env.DB, user.id, 'login', null, null, {}, c.req.header('CF-Connecting-IP'))
  
  // Cookieにトークンを設定（HTTPOnly, Secure, SameSite）
  c.header('Set-Cookie', `jwt_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
  
  return c.json({
    success: true,
    token: token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.member_name || '管理者',
      permissions: permissions
    },
    password_change_required: user.password_change_required === 1
  })
})

app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')
  
  const userData = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.last_login_at, m.name as member_name 
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    WHERE u.id = ?
  `).bind(user.userId).first()
  
  if (!userData) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }

  // DBから最新の権限を取得（JWTの権限は古い可能性があるため）
  const latestPermissions = (userData as any).role === 'admin'
    ? ADMIN_PERMISSIONS
    : await getUserPermissions(c.env.DB, user.userId)
  
  return c.json({
    success: true,
    user: {
      id: userData.id,
      email: userData.email,
      role: userData.role,
      name: userData.member_name || '管理者',
      lastLoginAt: userData.last_login_at,
      permissions: latestPermissions
    }
  })
})

app.post('/change-password', authMiddleware, async (c) => {
  const user = c.get('user')
  const { current_password, new_password, confirm_password } = await c.req.json()
  
  // バリデーション
  if (!current_password || !new_password || !confirm_password) {
    return c.json({ error: 'すべての項目を入力してください' }, 400)
  }
  
  if (new_password !== confirm_password) {
    return c.json({ error: '新しいパスワードが一致しません' }, 400)
  }
  
  if (new_password.length < 6) {
    return c.json({ error: 'パスワードは6文字以上で入力してください' }, 400)
  }
  
  // 現在のユーザー情報取得
  const userData = await c.env.DB.prepare(`
    SELECT password_hash FROM users WHERE id = ?
  `).bind(user.userId).first()
  
  if (!userData) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 現在のパスワード検証
  const isValid = await verifyPassword(current_password, userData.password_hash)
  if (!isValid) {
    return c.json({ error: '現在のパスワードが正しくありません' }, 401)
  }
  
  // 新しいパスワードをハッシュ化
  const newPasswordHash = await hashPassword(new_password)
  
  // パスワード更新（password_change_requiredフラグもクリア）
  await c.env.DB.prepare(`
    UPDATE users 
    SET password_hash = ?, password_change_required = 0, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).bind(newPasswordHash, user.userId).run()
  
  // 監査ログ記録
  await logAction(c.env.DB, user.userId, 'change_password', 'user', user.userId, {}, c.req.header('CF-Connecting-IP'))
  
  return c.json({ success: true, message: 'パスワードを変更しました' })
})

app.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user')
  
  // 監査ログ記録
  await logAction(c.env.DB, user.userId, 'logout', null, null, {}, c.req.header('CF-Connecting-IP'))
  
  return c.json({ success: true, message: 'ログアウトしました' })
})


export default app
