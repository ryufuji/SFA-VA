// 共通ヘルパー関数

/**
 * 契約ステータスを自動更新する関数
 * 関連する月次明細がすべて「請求済」「金額と入金総額が一致」の場合、契約を「完了」に更新
 */
export async function updateContractStatusIfCompleted(DB: D1Database, contractId: number) {
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.id,
      md.amount,
      md.amount_with_tax,
      md.billing_status,
      md.payment_status,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment
    FROM monthly_details md
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    WHERE md.contract_id = ?
    GROUP BY md.id, md.amount, md.amount_with_tax, md.billing_status, md.payment_status
  `).bind(contractId).all()

  if (!monthlyDetails || monthlyDetails.length === 0) {
    return
  }

  const allCompleted = monthlyDetails.every((detail: any) => {
    return detail.billing_status === '請求済' &&
           detail.total_payment >= detail.amount_with_tax
  })

  if (allCompleted) {
    await DB.prepare(`
      UPDATE contracts 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND status != 'completed'
    `).bind(contractId).run()
  }
}

/**
 * CSV値をエスケープする関数
 */
export function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * テーブルデータをCSV形式で取得
 */
export async function exportTableToCsv(DB: D1Database, tableName: string): Promise<string> {
  try {
    // テーブル情報を取得
    const { results: tableInfo } = await DB.prepare(
      `PRAGMA table_info(${tableName})`
    ).all()
    
    if (!tableInfo || tableInfo.length === 0) {
      return '' // テーブルが存在しない
    }
    
    // カラム名を取得
    const columns = tableInfo.map((col: any) => col.name)
    
    // データを取得（パスワードは除外）
    let query = `SELECT * FROM ${tableName}`
    let exportColumns = columns
    
    if (tableName === 'users') {
      // ユーザーテーブルの場合、パスワードハッシュは除外
      exportColumns = columns.filter(col => col !== 'password_hash')
      query = `SELECT ${exportColumns.join(', ')} FROM ${tableName}`
    }
    
    const { results } = await DB.prepare(query).all()
    
    // CSVヘッダー（エクスポート対象のカラムのみ）
    let csv = exportColumns.join(',') + '\n'
    
    // データ行
    if (results) {
      for (const row of results) {
        const values = exportColumns.map(col => {
          const value = (row as any)[col]
          return escapeCsvValue(value)
        })
        csv += values.join(',') + '\n'
      }
    }
    
    return csv
  } catch (error) {
    console.error(`Error exporting table ${tableName}:`, error)
    return ''
  }
}
