// 振込明細のアップロードと自動突合 API（/api/bank-reconcile）
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'
import { allocateDeposit } from '../../lib/deposit-helpers'
import { normalizeName, suggestMatches } from '../../lib/bank-reconcile'
import type { UnpaidItem } from '../../lib/bank-reconcile'

const app = new Hono<AppEnv>()

const MAX_ROWS = 1000

// 振込明細（ブラウザ側でCSVを読み取った結果）を銀行入金として取り込む
app.post('/import', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => null) as any
  const rows = body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ success: false, error: '取り込む振込明細がありません' }, 400)
  }
  if (rows.length > MAX_ROWS) {
    return c.json({ success: false, error: `一度に取り込めるのは${MAX_ROWS}件までです。ファイルを分けてください` }, 400)
  }

  const valid: { deposit_date: string; amount: number; payer_name: string; note: string | null }[] = []
  let invalid = 0
  for (const r of rows) {
    const date = String(r?.deposit_date || '')
    const amount = Number(r?.amount)
    const payer = String(r?.payer_name || '').trim().slice(0, 200)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || !Number.isInteger(amount) || amount <= 0 || !payer) { invalid++; continue }
    valid.push({ deposit_date: date, amount, payer_name: payer, note: r?.note ? String(r.note).trim().slice(0, 500) : null })
  }
  if (valid.length === 0) {
    return c.json({ success: false, error: '取り込める行がありませんでした（入金日・入金額・振込人名を確認してください）' }, 400)
  }

  // 二重取込の防止: 同じ「入金日・金額・振込人名」がすでに登録されている件数分はスキップする
  const dates = valid.map(v => v.deposit_date).sort()
  const { results: existing } = await DB.prepare(
    'SELECT deposit_date, amount, payer_name, COUNT(*) as cnt FROM bank_deposits WHERE deposit_date BETWEEN ? AND ? GROUP BY deposit_date, amount, payer_name'
  ).bind(dates[0], dates[dates.length - 1]).all()
  const already = new Map<string, number>()
  for (const e of existing as any[]) already.set(`${e.deposit_date}|${e.amount}|${e.payer_name}`, e.cnt)

  const user = c.get('user') as any
  const createdBy = user?.email || '管理者'
  const batchId = crypto.randomUUID()
  const fileNote = body?.file_name ? `取込: ${String(body.file_name).slice(0, 100)}` : '振込明細から取込'
  const inserts: D1PreparedStatement[] = []
  let duplicates = 0
  for (const v of valid) {
    const key = `${v.deposit_date}|${v.amount}|${v.payer_name}`
    const cnt = already.get(key) || 0
    if (cnt > 0) { already.set(key, cnt - 1); duplicates++; continue }
    inserts.push(DB.prepare(`
      INSERT INTO bank_deposits (deposit_date, amount, payer_name, note, remaining_amount, status, created_by, import_batch_id)
      VALUES (?, ?, ?, ?, ?, '未消込', ?, ?)
    `).bind(v.deposit_date, v.amount, v.payer_name, v.note || fileNote, v.amount, createdBy, batchId))
  }
  for (let i = 0; i < inserts.length; i += 50) await DB.batch(inserts.slice(i, i + 50))

  return c.json({ success: true, inserted: inserts.length, duplicates, invalid, batch_id: batchId })
})

// 未消込の入金すべてに、突合の候補を付けて返す
app.get('/suggestions', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const [dep, unp, lds, als] = await DB.batch([
    DB.prepare(`SELECT id, deposit_date, amount, payer_name, note, remaining_amount, status, import_batch_id
                FROM bank_deposits WHERE remaining_amount > 0 ORDER BY deposit_date ASC, id ASC`),
    DB.prepare(`
      SELECT md.id, md.target_month, md.amount, md.amount_with_tax, md.total_payment_amount, md.invoice_number,
        c.contract_name, p.project_name, l.id as lead_id, l.company_name
      FROM monthly_details md
      INNER JOIN contracts c ON md.contract_id = c.id
      INNER JOIN projects p ON c.project_id = p.id
      INNER JOIN leads l ON p.lead_id = l.id
      WHERE md.payment_status IN ('未入金', '部分入金') AND md.billing_status = '請求済'
      ORDER BY md.target_month ASC, md.id ASC`),
    DB.prepare('SELECT id, company_name FROM leads'),
    DB.prepare('SELECT payer_key, lead_id FROM payer_aliases')
  ])
  const deposits = dep.results as any[]
  const details = (unp.results as any[]).map(r => ({
    ...r, remaining: (r.amount_with_tax || r.amount) - (r.total_payment_amount || 0)
  })).filter(r => r.remaining > 0)
  const aliases: Record<string, number> = {}
  for (const a of als.results as any[]) aliases[a.payer_key] = a.lead_id

  const suggestions = suggestMatches(deposits, details as UnpaidItem[], lds.results as any[], aliases)
  const detailMap: Record<number, any> = {}
  for (const d of details) {
    detailMap[d.id] = { id: d.id, target_month: d.target_month, contract_name: d.contract_name, project_name: d.project_name, invoice_number: d.invoice_number, remaining: d.remaining }
  }
  return c.json({ success: true, data: deposits.map((d, i) => ({ deposit: d, suggestion: suggestions[i] })), details: detailMap })
})

// 選んだ突合候補をまとめて確定する（= 消込を実行）
app.post('/confirm', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => null) as any
  const items = body?.items
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: '確定する突合を選択してください' }, 400)
  }
  const user = c.get('user') as any
  const createdBy = user?.email || '管理者'

  const results: { deposit_id: number; success: boolean; error?: string }[] = []
  for (const item of items) {
    const depositId = Number(item?.deposit_id)
    const allocations = (Array.isArray(item?.allocations) ? item.allocations : [])
      .map((a: any) => ({ monthly_detail_id: Number(a?.monthly_detail_id), amount: Number(a?.amount) }))
      .filter((a: any) => Number.isInteger(a.monthly_detail_id) && Number.isInteger(a.amount) && a.amount > 0)
    const r = await allocateDeposit(DB, depositId, allocations, createdBy)
    if (!r.ok) { results.push({ deposit_id: depositId, success: false, error: r.error }); continue }
    results.push({ deposit_id: depositId, success: true })

    // 振込人名 → 取引先 の対応を覚える（消込先がすべて同じ取引先のときだけ）
    const ids = allocations.map((a: any) => a.monthly_detail_id)
    const { results: leadRows } = await DB.prepare(`
      SELECT DISTINCT p.lead_id FROM monthly_details md
      INNER JOIN contracts c ON md.contract_id = c.id
      INNER JOIN projects p ON c.project_id = p.id
      WHERE md.id IN (${ids.map(() => '?').join(',')})
    `).bind(...ids).all()
    const deposit = await DB.prepare('SELECT payer_name FROM bank_deposits WHERE id = ?').bind(depositId).first() as any
    const key = normalizeName(deposit?.payer_name || '')
    if (leadRows.length === 1 && key) {
      await DB.prepare(`
        INSERT INTO payer_aliases (payer_key, payer_name, lead_id, created_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(payer_key) DO UPDATE SET lead_id = excluded.lead_id, payer_name = excluded.payer_name, updated_at = CURRENT_TIMESTAMP
      `).bind(key, deposit.payer_name, (leadRows[0] as any).lead_id, createdBy).run()
    }
  }
  const ok = results.filter(r => r.success).length
  return c.json({ success: true, confirmed: ok, failed: results.length - ok, results })
})

export default app
