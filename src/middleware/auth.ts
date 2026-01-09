// 認証ミドルウェア
import { sign, verify } from 'hono/jwt';
import { Context, Next } from 'hono';
import { getUserPermissions, ADMIN_PERMISSIONS } from '../auth';

// JWT署名用シークレットキー（本番環境では環境変数から取得）
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * JWTペイロード構造
 */
export interface JWTPayload {
  userId: number;
  email: string;
  role: 'admin' | 'user';
  permissions: string[];
  iat: number;  // 発行時刻
  exp: number;  // 有効期限
}

/**
 * JWT生成（24時間有効）
 */
export async function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      ...payload,
      iat: now,
      exp: now + 60 * 60 * 24 // 24時間後
    },
    JWT_SECRET
  );
  return token;
}

/**
 * JWT検証ミドルウェア
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '認証が必要です' }, 401);
  }
  
  const token = authHeader.substring(7);
  
  try {
    const payload = await verify(token, JWT_SECRET) as JWTPayload;
    c.set('user', payload);
    await next();
  } catch (error) {
    return c.json({ error: '無効なトークンです' }, 401);
  }
}

/**
 * 権限チェックミドルウェア
 */
export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JWTPayload;
    
    if (!user) {
      return c.json({ error: '認証が必要です' }, 401);
    }
    
    // 管理者は全権限を持つ
    if (user.role === 'admin') {
      await next();
      return;
    }
    
    // 権限チェック
    if (!user.permissions.includes(permission)) {
      return c.json({ 
        error: 'この操作を行う権限がありません',
        required_permission: permission,
        your_permissions: user.permissions
      }, 403);
    }
    
    await next();
  };
}

/**
 * 複数権限のいずれかが必要な場合
 */
export function requireAnyPermission(permissions: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JWTPayload;
    
    if (!user) {
      return c.json({ error: '認証が必要です' }, 401);
    }
    
    // 管理者は全権限を持つ
    if (user.role === 'admin') {
      await next();
      return;
    }
    
    // いずれかの権限を持っているか確認
    const hasPermission = permissions.some(p => user.permissions.includes(p));
    
    if (!hasPermission) {
      return c.json({ 
        error: 'この操作を行う権限がありません',
        required_permissions: permissions,
        your_permissions: user.permissions
      }, 403);
    }
    
    await next();
  };
}

/**
 * 管理者のみアクセス可能
 */
export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user') as JWTPayload;
  
  if (!user) {
    return c.json({ error: '認証が必要です' }, 401);
  }
  
  if (user.role !== 'admin') {
    return c.json({ error: '管理者のみアクセス可能です' }, 403);
  }
  
  await next();
}
