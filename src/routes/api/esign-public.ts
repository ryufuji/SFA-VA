import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { sha256Hex, isExpired, getClientIp, getUserAgent } from '../../lib/esign-helpers'

const app = new Hono<AppEnv>()

// ============================================================
// 公開署名API（クライアント用・認証不要）
// トークンによる本人特定のみ。JWTは要求しない。
// ============================================================

/**
 * トークンに紐づく署名依頼＋契約書を取得（署名ページ表示用）
 * GET /api/sign/:token
 * アクセス時に viewed イベントを記録
 */
app.get('/:token', async (c) => {
  const { DB } = c.env
  const token = c.req.param('token')

  const request = await DB.prepare(`
    SELECT sr.id as request_id, sr.signer_name, sr.signer_email, sr.status, sr.expires_at, sr.signed_at,
           cd.id as document_id, cd.title, cd.source_type, cd.document_body, cd.pdf_base64, cd.content_hash,
           cd.contract_id
    FROM signature_requests sr
    JOIN contract_documents cd ON sr.document_id = cd.id
    WHERE sr.access_token = ?
  `).bind(token).first() as any

  if (!request) {
    return c.json({ success: false, error: 'invalid_token', message: '無効なリンクです' }, 404)
  }

  // 期限切れ判定（自動でステータス更新）
  if (request.status === 'pending' && isExpired(request.expires_at)) {
    await DB.prepare(`UPDATE signature_requests SET status = 'expired' WHERE id = ?`).bind(request.request_id).run()
    request.status = 'expired'
  }

  // 閲覧ログを記録（pending時のみ）
  if (request.status === 'pending') {
    await DB.prepare(`
      INSERT INTO signature_audit_logs (signature_request_id, event_type, signed_content_hash, ip_address, user_agent)
      VALUES (?, 'viewed', ?, ?, ?)
    `).bind(request.request_id, request.content_hash, getClientIp(c), getUserAgent(c)).run()
  }

  return c.json({
    success: true,
    data: {
      request_id: request.request_id,
      signer_name: request.signer_name,
      signer_email: request.signer_email,
      status: request.status,
      expires_at: request.expires_at,
      signed_at: request.signed_at,
      title: request.title,
      source_type: request.source_type,
      document_body: request.document_body,
      pdf_base64: request.pdf_base64,
      content_hash: request.content_hash,
    },
  })
})

/**
 * 合意処理（クライアントが「合意する」を押した時）
 * POST /api/sign/:token/agree
 * body: { input_name, agreed: true }
 */
app.post('/:token/agree', async (c) => {
  const { DB } = c.env
  const token = c.req.param('token')
  const body = await c.req.json().catch(() => ({}))
  const { input_name, agreed } = body

  const request = await DB.prepare(`
    SELECT sr.id as request_id, sr.status, sr.expires_at, sr.document_id,
           cd.content_hash, cd.source_type, cd.document_body, cd.pdf_base64
    FROM signature_requests sr
    JOIN contract_documents cd ON sr.document_id = cd.id
    WHERE sr.access_token = ?
  `).bind(token).first() as any

  if (!request) {
    return c.json({ success: false, error: 'invalid_token', message: '無効なリンクです' }, 404)
  }

  // 二重署名の防止
  if (request.status === 'signed') {
    return c.json({ success: false, error: 'already_signed', message: 'この契約書は既に合意済みです' }, 409)
  }
  // 期限切れの防止
  if (request.status === 'expired' || (request.status === 'pending' && isExpired(request.expires_at))) {
    await DB.prepare(`UPDATE signature_requests SET status = 'expired' WHERE id = ?`).bind(request.request_id).run()
    return c.json({ success: false, error: 'expired', message: 'この署名リンクは有効期限が切れています' }, 410)
  }
  // 入力チェック
  if (agreed !== true) {
    return c.json({ success: false, error: 'not_agreed', message: '同意が必要です' }, 400)
  }
  if (!input_name || String(input_name).trim() === '') {
    return c.json({ success: false, error: 'name_required', message: '氏名の入力が必要です' }, 400)
  }

  // 改ざん検知：現在の契約書内容から再計算したハッシュと確定時ハッシュを照合
  const hashTarget = request.source_type === 'text' ? String(request.document_body) : String(request.pdf_base64)
  const recomputed = await sha256Hex(hashTarget)
  if (recomputed !== request.content_hash) {
    return c.json({
      success: false,
      error: 'integrity_error',
      message: '契約書の整合性を確認できませんでした。管理者にお問い合わせください。',
    }, 409)
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const ip = getClientIp(c)
  const ua = getUserAgent(c)

  // 合意イベントを証跡として記録
  await DB.prepare(`
    INSERT INTO signature_audit_logs
      (signature_request_id, event_type, signed_content_hash, signer_input_name, ip_address, user_agent)
    VALUES (?, 'agreed', ?, ?, ?, ?)
  `).bind(request.request_id, request.content_hash, String(input_name).trim(), ip, ua).run()

  // 署名依頼を合意済みに更新
  await DB.prepare(`
    UPDATE signature_requests
    SET status = 'signed', signed_at = ?, signed_content_hash = ?
    WHERE id = ?
  `).bind(now, request.content_hash, request.request_id).run()

  // ドキュメントを署名済みに更新
  await DB.prepare(`UPDATE contract_documents SET status = 'signed', updated_at = ? WHERE id = ?`)
    .bind(now, request.document_id).run()

  return c.json({
    success: true,
    data: { signed_at: now, content_hash: request.content_hash },
  })
})

/**
 * 拒否処理（クライアントが合意しない場合）
 * POST /api/sign/:token/decline
 */
app.post('/:token/decline', async (c) => {
  const { DB } = c.env
  const token = c.req.param('token')

  const request = await DB.prepare(`
    SELECT sr.id as request_id, sr.status, cd.content_hash
    FROM signature_requests sr
    JOIN contract_documents cd ON sr.document_id = cd.id
    WHERE sr.access_token = ?
  `).bind(token).first() as any

  if (!request) {
    return c.json({ success: false, error: 'invalid_token', message: '無効なリンクです' }, 404)
  }
  if (request.status === 'signed') {
    return c.json({ success: false, error: 'already_signed', message: '既に合意済みです' }, 409)
  }

  await DB.prepare(`
    INSERT INTO signature_audit_logs (signature_request_id, event_type, signed_content_hash, ip_address, user_agent)
    VALUES (?, 'declined', ?, ?, ?)
  `).bind(request.request_id, request.content_hash, getClientIp(c), getUserAgent(c)).run()

  await DB.prepare(`UPDATE signature_requests SET status = 'declined' WHERE id = ?`).bind(request.request_id).run()

  return c.json({ success: true })
})

export default app
