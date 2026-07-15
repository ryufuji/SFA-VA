import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'
import { logAction } from '../../auth'
import {
  sha256Hex,
  generateAccessToken,
  calcExpiresAt,
  getClientIp,
} from '../../lib/esign-helpers'

const app = new Hono<AppEnv>()

// ============================================================
// 電子契約（電子サイン）管理API ※自社担当者用（要認証）
// ============================================================

/**
 * 契約書ドキュメントを作成・確定する
 * POST /api/esign/documents
 * body: {
 *   contract_id, title,
 *   source_type: 'text' | 'pdf',
 *   document_body?  (text型),
 *   pdf_base64?     (pdf型)
 * }
 * 確定時に content_hash(SHA-256) を算出し、以後編集不可
 */
app.post('/documents', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user') as any
  const body = await c.req.json()

  const { contract_id, title, source_type = 'text', document_body, pdf_base64 } = body

  if (!contract_id || !title) {
    return c.json({ success: false, error: 'contract_id と title は必須です' }, 400)
  }

  // 契約の存在確認
  const contract = await DB.prepare('SELECT id FROM contracts WHERE id = ?').bind(contract_id).first()
  if (!contract) {
    return c.json({ success: false, error: '対象の契約が見つかりません' }, 404)
  }

  // source_type ごとの必須チェック
  if (source_type === 'text' && (!document_body || String(document_body).trim() === '')) {
    return c.json({ success: false, error: 'text型では document_body が必須です' }, 400)
  }
  if (source_type === 'pdf' && (!pdf_base64 || String(pdf_base64).trim() === '')) {
    return c.json({ success: false, error: 'pdf型では pdf_base64 が必須です' }, 400)
  }
  if (!['text', 'pdf'].includes(source_type)) {
    return c.json({ success: false, error: 'source_type は text または pdf を指定してください' }, 400)
  }

  // 改ざん検知用ハッシュ（本文 or PDFのBase64 を対象に計算）
  const hashTarget = source_type === 'text' ? String(document_body) : String(pdf_base64)
  const contentHash = await sha256Hex(hashTarget)

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

  const result = await DB.prepare(`
    INSERT INTO contract_documents
      (contract_id, title, source_type, document_body, pdf_base64, content_hash, status, finalized_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).bind(
    contract_id,
    title,
    source_type,
    source_type === 'text' ? document_body : null,
    source_type === 'pdf' ? pdf_base64 : null,
    contentHash,
    now,
    user?.userId ?? null,
    now,
    now
  ).run()

  await logAction(DB, user?.userId ?? null, 'esign_document_create', 'contract_documents', Number(result.meta.last_row_id), { contract_id, title, source_type }, getClientIp(c))

  return c.json({
    success: true,
    data: {
      id: result.meta.last_row_id,
      contract_id,
      title,
      source_type,
      content_hash: contentHash,
      status: 'draft',
    },
  })
})

/**
 * 契約に紐づくドキュメント一覧＋各署名依頼の状況を取得
 * GET /api/esign/contracts/:contractId/documents
 */
app.get('/contracts/:contractId/documents', authMiddleware, async (c) => {
  const { DB } = c.env
  const contractId = c.req.param('contractId')

  const { results: documents } = await DB.prepare(`
    SELECT id, contract_id, title, source_type, content_hash, status, drive_file_id, finalized_at, created_at
    FROM contract_documents
    WHERE contract_id = ?
    ORDER BY created_at DESC
  `).bind(contractId).all()

  // 各ドキュメントの署名依頼を取得
  for (const doc of documents as any[]) {
    const { results: requests } = await DB.prepare(`
      SELECT id, signer_name, signer_email, status, expires_at, signed_at, email_sent_at, created_at
      FROM signature_requests
      WHERE document_id = ?
      ORDER BY created_at DESC
    `).bind(doc.id).all()
    doc.signature_requests = requests
  }

  return c.json({ success: true, data: documents })
})

/**
 * 署名依頼を発行する（送信先1件ごと）
 * POST /api/esign/documents/:documentId/requests
 * body: { signer_name, signer_email, expires_days? }
 * ※フェーズ1では「署名URL」を返すのみ（メール送信はフェーズ3）
 */
app.post('/documents/:documentId/requests', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user') as any
  const documentId = c.req.param('documentId')
  const body = await c.req.json()

  const { signer_name, signer_email, expires_days } = body

  if (!signer_name || !signer_email) {
    return c.json({ success: false, error: 'signer_name と signer_email は必須です' }, 400)
  }
  // 簡易メール形式チェック
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signer_email)) {
    return c.json({ success: false, error: 'メールアドレスの形式が不正です' }, 400)
  }

  const doc = await DB.prepare('SELECT id, status FROM contract_documents WHERE id = ?').bind(documentId).first()
  if (!doc) {
    return c.json({ success: false, error: '対象のドキュメントが見つかりません' }, 404)
  }

  const token = generateAccessToken()
  const days = Number.isFinite(expires_days) && expires_days > 0 ? Math.floor(expires_days) : 14
  const expiresAt = calcExpiresAt(days)
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

  const result = await DB.prepare(`
    INSERT INTO signature_requests
      (document_id, signer_name, signer_email, access_token, expires_at, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(documentId, signer_name, signer_email, token, expiresAt, user?.userId ?? null, now).run()

  // ドキュメントを「送信済み」に更新
  await DB.prepare(`UPDATE contract_documents SET status = 'sent', updated_at = ? WHERE id = ?`)
    .bind(now, documentId).run()

  await logAction(DB, user?.userId ?? null, 'esign_request_create', 'signature_requests', Number(result.meta.last_row_id), { document_id: documentId, signer_email }, getClientIp(c))

  // 署名URLを構築（フェーズ3ではこれをメール送信）
  const origin = new URL(c.req.url).origin
  const signUrl = `${origin}/sign/${token}`

  return c.json({
    success: true,
    data: {
      id: result.meta.last_row_id,
      signer_name,
      signer_email,
      expires_at: expiresAt,
      status: 'pending',
      sign_url: signUrl, // ← フェーズ1では画面にコピー表示して手動送付
    },
  })
})

/**
 * 署名依頼のキャンセル（期限切れ扱いにする）
 * POST /api/esign/requests/:requestId/cancel
 */
app.post('/requests/:requestId/cancel', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user') as any
  const requestId = c.req.param('requestId')

  const req = await DB.prepare('SELECT id, status FROM signature_requests WHERE id = ?').bind(requestId).first()
  if (!req) {
    return c.json({ success: false, error: '対象の署名依頼が見つかりません' }, 404)
  }
  if ((req as any).status === 'signed') {
    return c.json({ success: false, error: '既に合意済みの依頼はキャンセルできません' }, 400)
  }

  await DB.prepare(`UPDATE signature_requests SET status = 'expired' WHERE id = ?`).bind(requestId).run()
  await logAction(DB, user?.userId ?? null, 'esign_request_cancel', 'signature_requests', Number(requestId), { requestId }, getClientIp(c))

  return c.json({ success: true })
})

/**
 * 合意証跡（監査ログ）を取得
 * GET /api/esign/requests/:requestId/audit-logs
 */
app.get('/requests/:requestId/audit-logs', authMiddleware, async (c) => {
  const { DB } = c.env
  const requestId = c.req.param('requestId')

  const request = await DB.prepare(`
    SELECT sr.*, cd.title, cd.content_hash as document_hash, cd.contract_id
    FROM signature_requests sr
    JOIN contract_documents cd ON sr.document_id = cd.id
    WHERE sr.id = ?
  `).bind(requestId).first()

  if (!request) {
    return c.json({ success: false, error: '対象の署名依頼が見つかりません' }, 404)
  }

  const { results: logs } = await DB.prepare(`
    SELECT id, event_type, signed_content_hash, signer_input_name, ip_address, user_agent, event_at
    FROM signature_audit_logs
    WHERE signature_request_id = ?
    ORDER BY event_at ASC
  `).bind(requestId).all()

  return c.json({ success: true, data: { request, logs } })
})

export default app
