import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'
import { logAction } from '../../auth'

const app = new Hono<AppEnv>()

app.get('/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const contract = await DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first()
  if (!contract) {
    return c.json({ success: false, error: 'Contract not found' }, 404)
  }
  
  // 月次明細を取得
  const { results: monthlyDetails } = await DB.prepare(
    'SELECT * FROM monthly_details WHERE contract_id = ? ORDER BY target_month ASC'
  ).bind(id).all()
  
  // メンバーアサインを取得
  const { results: members } = await DB.prepare(`
    SELECT cma.*, m.name as member_name 
    FROM contract_member_assignments cma
    JOIN members m ON cma.member_id = m.id
    WHERE cma.contract_id = ?
  `).bind(id).all()
  
  // 契約金額と月次明細合計の差異を計算
  const monthlyTotal = monthlyDetails.reduce((sum: number, detail: any) => sum + detail.amount, 0)
  const difference = (contract as any).contract_amount - monthlyTotal
  
  return c.json({ 
    success: true, 
    data: { 
      ...contract, 
      monthlyDetails, 
      members,
      monthlyTotal,
      difference
    } 
  })
})

app.put('/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const { contract_name, contract_type, contract_date, notes, status, payment_type } = await c.req.json()
  
  // 契約の存在確認
  const contract = await DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first()
  if (!contract) {
    return c.json({ success: false, error: '契約が見つかりません' }, 404)
  }
  
  // バリデーション
  if (!contract_name) {
    return c.json({ error: '契約名は必須です' }, 400)
  }
  
  // 許可されたステータスのみ
  const validStatuses = ['active', 'completed', 'cancelled', 'suspended']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: '無効なステータスです' }, 400)
  }
  
  try {
    // 契約を更新
    await DB.prepare(`
      UPDATE contracts 
      SET contract_name = ?,
          contract_type = ?,
          contract_date = ?,
          notes = ?,
          status = ?,
          payment_type = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      contract_name,
      contract_type || '準委任',
      contract_date || null,
      notes || null,
      status || 'active',
      payment_type || '毎月支払',
      id
    ).run()
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'update_contract',
      'contracts',
      parseInt(id),
      {
        old_name: contract.contract_name,
        new_name: contract_name,
        old_status: contract.status,
        new_status: status || 'active'
      },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ 
      success: true,
      message: '契約を更新しました'
    })
  } catch (error: any) {
    return c.json({ error: '契約の更新に失敗しました: ' + error.message }, 500)
  }
})

app.get('/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全契約取得（案件・リード情報と月次明細を含む）
  const { results } = await DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      l.company_name,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count
    FROM contracts c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY c.created_at DESC
  `).all()

  // CSVヘッダー
  let csv = '契約名,案件名,会社名,契約種別,契約開始日,契約終了日,契約金額,支払種別,月次明細数,ステータス\n'

  // データ行を追加
  for (const contract of results) {
    const contract_name = (contract.contract_name || '').replace(/"/g, '""')
    const project_name = (contract.project_name || '').replace(/"/g, '""')
    const company_name = (contract.company_name || '').replace(/"/g, '""')
    const contract_type = (contract.contract_type || '').replace(/"/g, '""')
    const start_date = contract.contract_start_date || ''
    const end_date = contract.contract_end_date || ''
    const amount = contract.contract_amount || 0
    const payment_type = (contract.payment_type || '毎月支払').replace(/"/g, '""')
    const monthly_count = contract.monthly_count || 0
    const status = contract.status || 'active'
    
    csv += '"' + contract_name + '","' + project_name + '","' + company_name + '","' + contract_type + '","' + start_date + '","' + end_date + '",' + amount + ',"' + payment_type + '",' + monthly_count + ',"' + status + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contracts.csv"'
    }
  })
})

app.post('/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { contracts } = await c.req.json()

  if (!Array.isArray(contracts) || contracts.length === 0) {
    return c.json({ success: false, error: '契約データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i]
    const { contract_name, project_name, company_name, department, contract_type, contract_date, contract_start_date, contract_end_date, contract_amount, payment_type, member_emails, status } = contract

    // バリデーション
    if (!contract_name || !contract_start_date || !contract_end_date || !contract_amount) {
      errors.push({ line: i + 2, contract_name: contract_name || '', error: '契約名、契約開始日、契約終了日、契約金額は必須です' })
      error_count++
      continue
    }

    try {
      // 案件IDを検索
      let project_id = null
      if (project_name && company_name) {
        let query = `
          SELECT p.id FROM projects p
          LEFT JOIN leads l ON p.lead_id = l.id
          WHERE p.project_name = ? AND l.company_name = ?
        `
        const params = [project_name, company_name]
        
        // 部署名が指定されている場合は検索条件に追加
        if (department) {
          query += ` AND l.department = ?`
          params.push(department)
        }
        
        const project = await DB.prepare(query).bind(...params).first()
        
        if (project) {
          project_id = project.id
        }
      }

      if (!project_id) {
        errors.push({ line: i + 2, contract_name: contract_name, error: '対応する案件が見つかりません' })
        error_count++
        continue
      }

      // 日付バリデーション
      const startDate = new Date(contract_start_date)
      const endDate = new Date(contract_end_date)
      
      if (startDate > endDate) {
        errors.push({ line: i + 2, contract_name: contract_name, error: '開始日は終了日より前である必要があります' })
        error_count++
        continue
      }

      // メンバー情報リストを取得（メール:単価:稼働率）
      const memberAssignments = []
      if (member_emails) {
        const emailList = member_emails.split(';').map((e: string) => e.trim()).filter((e: string) => e)
        for (const emailStr of emailList) {
          const parts = emailStr.split(':').map((p: string) => p.trim())
          const email = parts[0]
          const unit_price = parts[1] ? parseInt(parts[1]) : null
          const allocation_ratio = parts[2] ? parseFloat(parts[2]) : null
          
          const member = await DB.prepare('SELECT id, default_unit_price FROM members WHERE email = ?').bind(email).first()
          if (member) {
            memberAssignments.push({
              member_id: member.id,
              unit_price: unit_price || member.default_unit_price || 0,
              allocation_ratio: allocation_ratio !== null ? allocation_ratio : 1.0
            })
          }
        }
      }

      // 契約を挿入
      const result = await DB.prepare(`
        INSERT INTO contracts (project_id, contract_name, contract_type, contract_start_date, contract_end_date, contract_amount, payment_type, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        project_id,
        contract_name,
        contract_type || '準委任',
        contract_start_date,
        contract_end_date,
        contract_amount,
        payment_type || '毎月支払',
        status || 'active',
        contract_date || new Date().toISOString()
      ).run()

      const contract_id = result.meta.last_row_id

      // 月次明細を自動生成
      const months = []
      let current = new Date(startDate)
      while (current <= endDate) {
        months.push(current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0'))
        current.setMonth(current.getMonth() + 1)
      }

      const monthlyAmount = Math.floor(contract_amount / months.length)
      
      for (const month of months) {
        const [mYear, mMonth] = month.split('-').map(Number)
        const accDate = new Date(mYear, mMonth, 0)
        const accDateStr = `${mYear}-${String(mMonth).padStart(2, '0')}-${String(accDate.getDate()).padStart(2, '0')}`
        await DB.prepare(`
          INSERT INTO monthly_details (contract_id, target_month, amount, billing_status, payment_status, acceptance_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(contract_id, month, monthlyAmount, '未請求', '未入金', accDateStr).run()
      }

      // メンバーアサインを登録（単価と稼働率込み）
      if (memberAssignments.length > 0) {
        for (const assignment of memberAssignments) {
          await DB.prepare(`
            INSERT INTO contract_member_assignments (contract_id, member_id, unit_price, allocation_ratio)
            VALUES (?, ?, ?, ?)
          `).bind(contract_id, assignment.member_id, assignment.unit_price, assignment.allocation_ratio).run()
        }
      }

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, contract_name: contract_name, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: contracts.length,
    success_count,
    error_count,
    errors
  })
})

app.post('/', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { project_id, contract_name, contract_type, contract_date, start_date, end_date, contract_amount, tax_rate, notes, payment_type, monthly_breakdown, member_assignments } = await c.req.json()

  // バリデーション
  if (!project_id || !contract_name || !start_date || !end_date || !contract_amount) {
    return c.json({ error: '必須項目が入力されていません' }, 400)
  }
  
  // 税率のデフォルト値（10%）
  const taxRateValue = tax_rate !== undefined ? parseFloat(tax_rate) : 10.0
  
  // 支払種別のデフォルト値
  const paymentTypeValue = payment_type || '毎月支払'

  // プロジェクト名を取得
  const project = await c.env.DB.prepare('SELECT project_name FROM projects WHERE id = ?').bind(project_id).first()
  if (!project) {
    return c.json({ error: 'プロジェクトが見つかりません' }, 404)
  }
  const projectName = project.project_name

  // 月数を計算
  const startDate = new Date(start_date)
  const endDate = new Date(end_date)
  
  if (startDate > endDate) {
    return c.json({ error: '開始日は終了日より前である必要があります' }, 400)
  }

  const months = []
  let current = new Date(startDate)
  while (current <= endDate) {
    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
    months.push(yearMonth)
    current.setMonth(current.getMonth() + 1)
  }

  if (months.length === 0) {
    return c.json({ error: '契約期間が無効です' }, 400)
  }

  // 月次明細データの検証
  if (monthly_breakdown && monthly_breakdown.length > 0) {
    // 月次明細の合計が契約金額と一致するか確認
    const totalMonthlyAmount = monthly_breakdown.reduce((sum, item) => sum + parseInt(item.amount), 0)
    if (totalMonthlyAmount !== parseInt(contract_amount)) {
      return c.json({ 
        error: `月次明細の金額合計（¥${totalMonthlyAmount}）が契約金額（¥${contract_amount}）と一致しません` 
      }, 400)
    }
    
    // 月次明細の月数が契約期間の月数と一致するか確認
    if (monthly_breakdown.length !== months.length) {
      return c.json({ 
        error: `月次明細の件数（${monthly_breakdown.length}件）が契約期間の月数（${months.length}ヶ月）と一致しません` 
      }, 400)
    }
  }

  // 金額配分の計算（支払種別に応じて）
  let baseAmount, remainder
  if (paymentTypeValue === '初回全額支払') {
    // 初回全額支払の場合、初月に全額、以降は0円
    baseAmount = 0
    remainder = contract_amount
  } else {
    // 毎月支払の場合、均等割（端数は初月）
    baseAmount = Math.floor(contract_amount / months.length)
    remainder = contract_amount - (baseAmount * months.length)
  }

  try {
    // 契約を作成
    const contractResult = await c.env.DB.prepare(`
      INSERT INTO contracts (
        project_id, contract_name, contract_type, contract_date, contract_start_date, contract_end_date, 
        contract_amount, tax_rate, payment_type, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      project_id, contract_name, contract_type || '準委任', contract_date || null, start_date, end_date, 
      contract_amount, taxRateValue, paymentTypeValue, 'active'
    ).run()

    const contractId = contractResult.meta.last_row_id

    // 月次明細を生成し、IDを保持
    const monthlyDetailIds = []
    for (let i = 0; i < months.length; i++) {
      // 月次明細データから金額と備考を取得（無ければ均等割）
      let monthAmount = i === 0 ? baseAmount + remainder : baseAmount
      let monthNote = ''
      
      if (monthly_breakdown && monthly_breakdown[i]) {
        monthAmount = parseInt(monthly_breakdown[i].amount)
        monthNote = monthly_breakdown[i].note || ''
      }
      
      // 税込み金額を計算
      const monthAmountWithTax = Math.round(monthAmount * (1 + taxRateValue / 100))
      
      // 月次明細の名称を生成: 案件名_YYYYMM
      const yearMonth = months[i].replace('-', '') // 2026-01 → 202601
      const monthlyName = `${projectName}_${yearMonth}`
      
      // 対象月の年月を解析
      const [year, month] = months[i].split('-').map(Number)
      
      // 検収日（acceptance_date）: 対象月の月末
      const acceptanceDate = new Date(year, month, 0) // 月末を取得
      const acceptanceDateStr = `${year}-${String(month).padStart(2, '0')}-${String(acceptanceDate.getDate()).padStart(2, '0')}`
      
      // 請求日: 翌月1日
      const billingDate = new Date(year, month, 1)
      const billingDateStr = `${billingDate.getFullYear()}-${String(billingDate.getMonth() + 1).padStart(2, '0')}-01`
      
      // 入金予定日: 翌月末日
      const expectedPaymentDate = new Date(year, month + 1, 0)
      const expectedPaymentDateStr = `${expectedPaymentDate.getFullYear()}-${String(expectedPaymentDate.getMonth() + 1).padStart(2, '0')}-${String(expectedPaymentDate.getDate()).padStart(2, '0')}`
      
      const monthlyResult = await c.env.DB.prepare(`
        INSERT INTO monthly_details (
          contract_id, target_month, amount, amount_with_tax, name, notes,
          billing_status, billing_date,
          payment_status, expected_payment_date,
          acceptance_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        contractId, months[i], monthAmount, monthAmountWithTax, monthlyName, monthNote,
        '未請求', billingDateStr,
        '未入金', expectedPaymentDateStr,
        acceptanceDateStr
      ).run()
      
      monthlyDetailIds.push(monthlyResult.meta.last_row_id)
    }

    // メンバーアサインがある場合、各月次明細に追加
    if (member_assignments && member_assignments.length > 0) {
      for (let i = 0; i < monthlyDetailIds.length; i++) {
        const monthlyDetailId = monthlyDetailIds[i]
        for (const assignment of member_assignments) {
          // 初回全額支払の場合、2ヶ月目以降は単価を0にする
          let unitPrice = assignment.unit_price
          if (paymentTypeValue === '初回全額支払' && i > 0) {
            unitPrice = 0
          }
          
          await c.env.DB.prepare(`
            INSERT INTO monthly_member_assignments (
              monthly_detail_id, member_id, allocation_ratio, unit_price, notes
            ) VALUES (?, ?, ?, ?, ?)
          `).bind(
            monthlyDetailId,
            assignment.member_id,
            assignment.allocation_ratio,
            unitPrice,
            assignment.notes || ''
          ).run()
        }
      }
    }

    return c.json({ 
      success: true, 
      contract_id: contractId,
      monthly_details_count: months.length,
      member_assignments_count: member_assignments ? member_assignments.length : 0
    })
  } catch (error) {
    console.error('Contract creation error:', error)
    return c.json({ error: 'データベースエラーが発生しました: ' + error.message }, 500)
  }
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const contractId = parseInt(c.req.param('id'));

  if (!contractId) {
    return c.json({ success: false, error: '契約IDが必要です' }, 400);
  }

  try {
    let deletedMonthlyDetails = 0;
    let deletedContractMembers = 0;
    let deletedMonthlyMembers = 0;

    const allStatements = [];

    // 月次明細を取得
    const monthlyDetails = await DB.prepare(`
      SELECT id FROM monthly_details WHERE contract_id = ?
    `).bind(contractId).all();

    if (monthlyDetails.results.length > 0) {
      deletedMonthlyDetails = monthlyDetails.results.length;
      
      // 各月次明細について処理
      for (const monthly of monthlyDetails.results) {
        // 月次メンバーアサインのカウント
        const monthlyMembers = await DB.prepare(`
          SELECT COUNT(*) as count FROM monthly_member_assignments 
          WHERE monthly_detail_id = ?
        `).bind(monthly.id).first();
        deletedMonthlyMembers += monthlyMembers.count;
        
        // 月次メンバーアサインの削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
        );
        
        // 入金履歴の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthly.id)
        );
      }
      
      // 月次明細の削除文を追加
      for (const monthly of monthlyDetails.results) {
        allStatements.push(
          DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthly.id)
        );
      }
    }

    // 契約メンバーアサインのカウント
    const contractMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id = ?
    `).bind(contractId).first();
    deletedContractMembers = contractMembers.count;
    
    // 契約メンバーアサインの削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM contract_member_assignments WHERE contract_id = ?`).bind(contractId)
    );

    // 契約の削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contractId)
    );

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      ...allStatements,
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        contracts: 1,
        monthly_details: deletedMonthlyDetails,
        contract_member_assignments: deletedContractMembers,
        monthly_member_assignments: deletedMonthlyMembers
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const contractId = parseInt(c.req.param('id'));

  try {
    const monthlyDetails = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_details WHERE contract_id = ?
    `).bind(contractId).first();

    const contractMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id = ?
    `).bind(contractId).first();

    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments 
      WHERE monthly_detail_id IN (
        SELECT id FROM monthly_details WHERE contract_id = ?
      )
    `).bind(contractId).first();

    return c.json({
      success: true,
      impact: {
        monthly_details_count: monthlyDetails.count,
        contract_member_assignments_count: contractMembers.count,
        monthly_member_assignments_count: monthlyMembers.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});


export default app
