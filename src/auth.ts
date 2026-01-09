// 認証関連のユーティリティ関数

/**
 * PBKDF2を使用したパスワードハッシュ化（Cloudflare Workers対応）
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  const key = await crypto.subtle.importKey(
    'raw',
    data,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  );
  
  // salt + hash を Base64エンコード
  const hashArray = new Uint8Array(hash);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);
  
  return btoa(String.fromCharCode(...combined));
}

/**
 * パスワード検証
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    // Base64デコード
    const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));
    
    // salt と hash を分離
    const salt = combined.slice(0, 16);
    const storedHashArray = combined.slice(16);
    
    // 入力パスワードから同じ方法でハッシュ生成
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    const key = await crypto.subtle.importKey(
      'raw',
      data,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      key,
      256
    );
    
    const hashArray = new Uint8Array(hash);
    
    // 比較
    if (hashArray.length !== storedHashArray.length) {
      return false;
    }
    
    for (let i = 0; i < hashArray.length; i++) {
      if (hashArray[i] !== storedHashArray[i]) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/**
 * ユーザーの権限を取得
 */
export async function getUserPermissions(db: any, userId: number): Promise<string[]> {
  const { results } = await db.prepare(`
    SELECT permission_name FROM user_permissions WHERE user_id = ?
  `).bind(userId).all();
  
  return results.map((row: any) => row.permission_name);
}

/**
 * 監査ログを記録
 */
export async function logAction(
  db: any,
  userId: number | null,
  action: string,
  resourceType: string | null,
  resourceId: number | null,
  details: any,
  ipAddress: string | null
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    action,
    resourceType,
    resourceId,
    JSON.stringify(details),
    ipAddress
  ).run();
}

/**
 * 権限定義
 */
export enum Permission {
  LEAD_MANAGE = 'lead_manage',           // リード・案件の登録/更新
  CONTRACT_MANAGE = 'contract_manage',   // 契約の登録/更新
  INSPECTION_MANAGE = 'inspection_manage', // 検収・請求の更新
  PAYMENT_MANAGE = 'payment_manage'      // 入金の登録
}

/**
 * 管理者が持つ全権限
 */
export const ADMIN_PERMISSIONS = [
  Permission.LEAD_MANAGE,
  Permission.CONTRACT_MANAGE,
  Permission.INSPECTION_MANAGE,
  Permission.PAYMENT_MANAGE
];
