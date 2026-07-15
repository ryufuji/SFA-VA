// 電子契約（電子サイン）共通ヘルパ
// Cloudflare Workers 環境のため Web Crypto API を使用（Node.js crypto は不可）

/**
 * 文字列のSHA-256ハッシュ（16進文字列）を計算
 * 契約書の改ざん検知に使用
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 推測不能な署名アクセストークンを生成
 * crypto.randomUUID を2つ連結し、ハイフンを除去（長く推測困難に）
 */
export function generateAccessToken(): string {
  const a = crypto.randomUUID().replace(/-/g, '')
  const b = crypto.randomUUID().replace(/-/g, '')
  return `${a}${b}`
}

/**
 * 有効期限を計算（既定14日後）のISO文字列（UTC）を返す
 */
export function calcExpiresAt(days: number = 14): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return d.toISOString().replace('T', ' ').substring(0, 19)
}

/**
 * 期限切れ判定
 */
export function isExpired(expiresAt: string): boolean {
  const exp = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime()
  return Date.now() > exp
}

/**
 * リクエストからクライアントIPを取得（Cloudflare のヘッダを優先）
 */
export function getClientIp(c: any): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  )
}

/**
 * リクエストからUser-Agentを取得
 */
export function getUserAgent(c: any): string {
  return c.req.header('User-Agent') || 'unknown'
}

/**
 * HTMLエスケープ（署名ページで契約書本文・氏名を安全に表示）
 */
export function escapeHtml(str: string): string {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
