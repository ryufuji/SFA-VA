import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'
import { logAction } from '../../auth'

const app = new Hono<AppEnv>()

app.get('/:projectId/meeting-notes', authMiddleware, async (c) => {
  const { DB } = c.env
  const projectId = c.req.param('projectId')
  
  const { results: notes } = await DB.prepare(`
    SELECT * FROM meeting_notes 
    WHERE project_id = ? 
    ORDER BY meeting_date DESC, created_at DESC
  `).bind(projectId).all()
  
  return c.json({ success: true, data: notes })
})

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 案件一覧を取得（リード情報と営業担当者情報を結合）
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      l.company_name,
      l.department,
      m.name as sales_rep_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    WHERE p.status = 'active'
    ORDER BY p.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  
  // リード情報を取得
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first()
  
  // 契約一覧を取得
  const { results: contracts } = await DB.prepare(
    'SELECT * FROM contracts WHERE project_id = ? ORDER BY contract_start_date DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...project, lead, contracts } })
})

app.post('/', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { lead_id, project_name, sales_rep_id, expected_monthly_amount } = body
  
  if (!lead_id || !project_name) {
    return c.json({ success: false, error: 'Lead ID and project name are required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO projects (lead_id, project_name, sales_rep_id, status, expected_monthly_amount) VALUES (?, ?, ?, ?, ?)'
  ).bind(lead_id, project_name, sales_rep_id || null, 'active', expected_monthly_amount || 0).run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

app.put('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const { project_name, sales_rep_id, status, expected_monthly_amount } = await c.req.json()
  
  // 案件の存在確認
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  if (!project) {
    return c.json({ success: false, error: '案件が見つかりません' }, 404)
  }
  
  // バリデーション
  if (!project_name) {
    return c.json({ error: '案件名は必須です' }, 400)
  }
  
  // 許可されたステータスのみ
  const validStatuses = ['active', 'won', 'lost', 'archived']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: '無効なステータスです' }, 400)
  }
  
  try {
    // 案件を更新
    await DB.prepare(`
      UPDATE projects 
      SET project_name = ?,
          sales_rep_id = ?,
          status = ?,
          expected_monthly_amount = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      project_name,
      sales_rep_id || null,
      status || 'active',
      expected_monthly_amount || 0,
      id
    ).run()
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'update_project',
      'projects',
      parseInt(id),
      {
        old_name: project.project_name,
        new_name: project_name,
        old_status: project.status,
        new_status: status || 'active',
        old_sales_rep_id: project.sales_rep_id,
        new_sales_rep_id: sales_rep_id
      },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ 
      success: true,
      message: '案件を更新しました'
    })
  } catch (error: any) {
    return c.json({ error: '案件の更新に失敗しました: ' + error.message }, 500)
  }
})

app.get('/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全案件取得（リード情報と営業担当者情報を含む）
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      l.company_name,
      l.department,
      m.name as sales_rep_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    ORDER BY p.created_at DESC
  `).all()

  // CSVヘッダー
  let csv = '案件名,会社名,部署名,営業担当,ステータス\n'

  // データ行を追加
  for (const project of results) {
    const project_name = (project.project_name || '').replace(/"/g, '""')
    const company_name = (project.company_name || '').replace(/"/g, '""')
    const department = (project.department || '').replace(/"/g, '""')
    const sales_rep_name = (project.sales_rep_name || '').replace(/"/g, '""')
    const status = project.status || 'active'
    
    csv += '"' + project_name + '","' + company_name + '","' + department + '","' + sales_rep_name + '","' + status + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="projects.csv"'
    }
  })
})

app.post('/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { projects } = await c.req.json()

  if (!Array.isArray(projects) || projects.length === 0) {
    return c.json({ success: false, error: '案件データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    const { project_name, company_name, department, sales_rep_name, status } = project

    // バリデーション
    if (!project_name) {
      errors.push({ line: i + 2, project_name: '', error: '案件名は必須です' })
      error_count++
      continue
    }

    if (!company_name) {
      errors.push({ line: i + 2, project_name: project_name, error: '会社名は必須です' })
      error_count++
      continue
    }

    try {
      // リードIDを検索
      const lead = await DB.prepare(
        'SELECT id FROM leads WHERE company_name = ? AND (department = ? OR (department IS NULL AND ? IS NULL))'
      ).bind(company_name, department || null, department || null).first()

      if (!lead) {
        errors.push({ line: i + 2, project_name: project_name, error: '対応するリードが見つかりません' })
        error_count++
        continue
      }

      // 営業担当者IDを検索（指定がある場合）
      let sales_rep_id = null
      if (sales_rep_name) {
        const member = await DB.prepare('SELECT id FROM members WHERE name = ?').bind(sales_rep_name).first()
        if (!member) {
          errors.push({ line: i + 2, project_name: project_name, error: '営業担当者が見つかりません: ' + sales_rep_name })
          error_count++
          continue
        }
        sales_rep_id = member.id
      }

      // 挿入
      await DB.prepare(`
        INSERT INTO projects (lead_id, project_name, sales_rep_id, status)
        VALUES (?, ?, ?, ?)
      `).bind(
        lead.id,
        project_name,
        sales_rep_id,
        status || 'active'
      ).run()

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, project_name: project_name, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: projects.length,
    success_count,
    error_count,
    errors
  })
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const projectId = parseInt(c.req.param('id'));

  if (!projectId) {
    return c.json({ success: false, error: '案件IDが必要です' }, 400);
  }

  try {
    let deletedContracts = 0;
    let deletedMonthlyDetails = 0;
    let deletedMemberAssignments = 0;

    const allStatements = [];

    // 契約を取得
    const contracts = await DB.prepare(`
      SELECT id FROM contracts WHERE project_id = ?
    `).bind(projectId).all();

    if (contracts.results.length > 0) {
      deletedContracts = contracts.results.length;
      
      // 各契約について処理
      for (const contract of contracts.results) {
        const monthlyDetails = await DB.prepare(`
          SELECT id FROM monthly_details WHERE contract_id = ?
        `).bind(contract.id).all();

        if (monthlyDetails.results.length > 0) {
          deletedMonthlyDetails += monthlyDetails.results.length;
          
          // 各月次明細について処理
          for (const monthly of monthlyDetails.results) {
            // 月次メンバーアサインのカウント
            const monthlyMembers = await DB.prepare(`
              SELECT COUNT(*) as count FROM monthly_member_assignments 
              WHERE monthly_detail_id = ?
            `).bind(monthly.id).first();
            deletedMemberAssignments += monthlyMembers.count;
            
            // 月次メンバーアサインの削除文を追加
            allStatements.push(
              DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
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
          SELECT COUNT(*) as count FROM contract_member_assignments 
          WHERE contract_id = ?
        `).bind(contract.id).first();
        deletedMemberAssignments += contractMembers.count;
        
        // 契約メンバーアサインの削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM contract_member_assignments WHERE contract_id = ?`).bind(contract.id)
        );
        
        // 契約の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contract.id)
        );
      }
    }

    // 案件の削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId)
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
        projects: 1,
        contracts: deletedContracts,
        monthly_details: deletedMonthlyDetails,
        member_assignments: deletedMemberAssignments
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const projectId = parseInt(c.req.param('id'));

  try {
    const contracts = await DB.prepare(`
      SELECT id, contract_name FROM contracts WHERE project_id = ?
    `).bind(projectId).all();

    const contractIds = contracts.results.map(c => c.id);
    let monthlyDetailsCount = 0;
    let memberAssignmentsCount = 0;

    if (contractIds.length > 0) {
      const monthlyDetails = await DB.prepare(`
        SELECT COUNT(*) as count FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
      `).first();
      monthlyDetailsCount = monthlyDetails.count;

      const allAssignments = await DB.prepare(`
        SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id IN (${contractIds.join(',')})
      `).first();
      memberAssignmentsCount = allAssignments.count;

      const monthlyAssignments = await DB.prepare(`
        SELECT COUNT(*) as count FROM monthly_member_assignments 
        WHERE monthly_detail_id IN (
          SELECT id FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
        )
      `).first();
      memberAssignmentsCount += monthlyAssignments.count;
    }

    return c.json({
      success: true,
      impact: {
        contracts: contracts.results,
        monthly_details_count: monthlyDetailsCount,
        member_assignments_count: memberAssignmentsCount
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/:projectId/quotes', authMiddleware, async (c) => {
  const { DB } = c.env
  const projectId = c.req.param('projectId')
  
  const { results } = await DB.prepare(`
    SELECT 
      q.*,
      l.company_name,
      l.honorific
    FROM quotes q
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.project_id = ?
    ORDER BY q.created_at DESC
  `).bind(projectId).all()
  
  return c.json({ success: true, data: results })
})

app.post('/:projectId/quotes', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  
  const { issue_date, expiry_date, subject, items, notes } = body
  
  // プロジェクトの存在確認
  const project = await DB.prepare(`
    SELECT p.*, l.id as lead_id, l.company_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE p.id = ?
  `).bind(projectId).first() as any
  
  if (!project) {
    return c.json({ success: false, error: '案件が見つかりません' }, 404)
  }
  
  // 小計・消費税・合計を計算
  const subtotal = items.reduce((sum: number, item: any) => sum + item.amount, 0)
  const tax = Math.floor(subtotal * 0.1)
  const total = subtotal + tax
  
  // 見積番号を生成（YYYYMMDD-XXX形式）
  const today = new Date()
  const datePrefix = today.toISOString().split('T')[0].replace(/-/g, '').substring(2) // YYMMDD
  
  // 同日の見積書数を取得
  const { results: todayQuotes } = await DB.prepare(`
    SELECT id FROM quotes WHERE quote_number LIKE ?
  `).bind(`${datePrefix}-%`).all()
  
  const sequenceNumber = String(todayQuotes.length + 1).padStart(3, '0')
  const quoteNumber = `${datePrefix}-${sequenceNumber}`
  
  try {
    // 見積書を作成
    const result = await DB.prepare(`
      INSERT INTO quotes (
        quote_number, project_id, lead_id, issue_date, expiry_date,
        subject, subtotal, tax_rate, tax, total, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      quoteNumber,
      projectId,
      project.lead_id,
      issue_date,
      expiry_date || null,
      subject,
      subtotal,
      10.0,
      tax,
      total,
      notes || null,
      user.userId
    ).run()
    
    const quoteId = result.meta.last_row_id
    
    // 見積明細を作成
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      await DB.prepare(`
        INSERT INTO quote_items (
          quote_id, member_id, item_description, quantity, workload,
          unit, unit_price, amount, note, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        quoteId,
        item.member_id || null,
        item.item_description,
        item.quantity,
        item.workload || 1.0,
        item.unit || '人月',
        item.unit_price,
        item.amount,
        item.note || null,
        i
      ).run()
    }
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'create_quote',
      'quotes',
      Number(quoteId),
      { quote_number: quoteNumber, project_id: projectId, total },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({
      success: true,
      data: { id: quoteId, quote_number: quoteNumber },
      message: '見積書を作成しました'
    })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の作成に失敗しました: ' + error.message }, 500)
  }
})


export default app
