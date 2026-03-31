import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin, requirePermission } from '../../middleware/auth'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  const { status, search } = c.req.query()
  
  let query = 'SELECT * FROM leads WHERE 1=1'
  const params: any[] = []
  
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  
  if (search) {
    query += ' AND (company_name LIKE ? OR contact_person LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  
  query += ' ORDER BY created_at DESC'
  
  const { results } = await DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: results })
})

app.get('/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first()
  if (!lead) {
    return c.json({ success: false, error: 'Lead not found' }, 404)
  }
  
  // 関連する案件も取得
  const { results: projects } = await DB.prepare(
    'SELECT * FROM projects WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...lead, projects } })
})

app.post('/', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { company_name, contact_person, department, email, phone, memo } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO leads (company_name, contact_person, department, email, phone, memo, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(company_name, contact_person || null, department || null, email || null, phone || null, memo || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

app.put('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { company_name, contact_person, department, email, phone, memo } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  await DB.prepare(`
    UPDATE leads 
    SET company_name = ?, contact_person = ?, department = ?, email = ?, phone = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(company_name, contact_person || null, department || null, email || null, phone || null, memo || null, id).run()
  
  return c.json({ success: true })
})

app.put('/:id/status', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { status } = await c.req.json()

  // バリデーション
  if (!status || !['active', 'archived'].includes(status)) {
    return c.json({ success: false, error: 'Invalid status. Must be "active" or "archived"' }, 400)
  }

  // リードの存在確認
  const lead = await DB.prepare('SELECT id, status FROM leads WHERE id = ?').bind(id).first()
  if (!lead) {
    return c.json({ success: false, error: 'Lead not found' }, 404)
  }

  // ステータス更新
  await DB.prepare(`
    UPDATE leads 
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run()

  return c.json({ success: true, message: 'ステータスを更新しました' })
})

app.get('/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全リード取得
  const { results } = await DB.prepare('SELECT * FROM leads ORDER BY created_at DESC').all()

  // CSVヘッダー
  let csv = '会社名,部署名,担当者,メールアドレス,電話番号,ステータス,メモ\n'

  // データ行を追加
  for (const lead of results) {
    const company_name = (lead.company_name || '').replace(/"/g, '""')
    const department = (lead.department || '').replace(/"/g, '""')
    const contact_person = (lead.contact_person || '').replace(/"/g, '""')
    const email = (lead.email || '').replace(/"/g, '""')
    const phone = (lead.phone || '').replace(/"/g, '""')
    const status = lead.status || 'active'
    const memo = (lead.memo || '').replace(/"/g, '""')
    
    csv += '"' + company_name + '","' + department + '","' + contact_person + '","' + email + '","' + phone + '","' + status + '","' + memo + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"'
    }
  })
})

app.post('/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { leads } = await c.req.json()

  if (!Array.isArray(leads) || leads.length === 0) {
    return c.json({ success: false, error: 'リードデータが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]
    const { company_name, department, contact_person, email, phone, status, memo } = lead

    // バリデーション
    if (!company_name) {
      errors.push({ line: i + 2, email: email || '', error: '会社名は必須です' })
      error_count++
      continue
    }

    try {
      // 重複チェック（会社名+部署名の組み合わせ）
      const existing = await DB.prepare(
        'SELECT id FROM leads WHERE company_name = ? AND department = ?'
      ).bind(company_name, department || null).first()

      if (existing) {
        errors.push({ line: i + 2, email: email || '', error: '同じ会社名と部署名の組み合わせが既に存在します' })
        error_count++
        continue
      }

      // 挿入
      await DB.prepare(`
        INSERT INTO leads (company_name, department, contact_person, email, phone, status, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        company_name,
        department || null,
        contact_person || null,
        email || null,
        phone || null,
        status || 'active',
        memo || null
      ).run()

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, email: email || '', error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: leads.length,
    success_count,
    error_count,
    errors
  })
})

app.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const leadId = parseInt(c.req.param('id'));

  if (!leadId) {
    return c.json({ success: false, error: 'リードIDが必要です' }, 400);
  }

  try {
    console.log(`[DELETE] Starting lead deletion for leadId=${leadId}`);
    let deletedProjects = 0;
    let deletedContracts = 0;
    let deletedMonthlyDetails = 0;
    let deletedMemberAssignments = 0;

    // まず、削除対象のIDをすべて収集
    const projects = await DB.prepare(`
      SELECT id FROM projects WHERE lead_id = ?
    `).bind(leadId).all();
    console.log(`[DELETE] Found ${projects.results.length} projects`);

    const allStatements = [];
    const statementDescriptions = [];
    
    if (projects.results.length > 0) {
      deletedProjects = projects.results.length;
      
      for (const project of projects.results) {
        const contracts = await DB.prepare(`
          SELECT id FROM contracts WHERE project_id = ?
        `).bind(project.id).all();
        
        if (contracts.results.length > 0) {
          deletedContracts += contracts.results.length;
          
          for (const contract of contracts.results) {
            const monthlyDetails = await DB.prepare(`
              SELECT id FROM monthly_details WHERE contract_id = ?
            `).bind(contract.id).all();

            if (monthlyDetails.results.length > 0) {
              deletedMonthlyDetails += monthlyDetails.results.length;
              
              // 月次メンバーアサインの削除文を追加
              for (const monthly of monthlyDetails.results) {
                const monthlyMembers = await DB.prepare(`
                  SELECT COUNT(*) as count FROM monthly_member_assignments 
                  WHERE monthly_detail_id = ?
                `).bind(monthly.id).first();
                deletedMemberAssignments += monthlyMembers.count;
                
                allStatements.push(
                  DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE monthly_member_assignments for monthly_detail_id=${monthly.id}`);
              }
              
              // 入金履歴の削除文を追加
              for (const monthly of monthlyDetails.results) {
                allStatements.push(
                  DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE payment_histories for monthly_detail_id=${monthly.id}`);
              }
              
              // 月次明細の削除文を追加
              for (const monthly of monthlyDetails.results) {
                allStatements.push(
                  DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE monthly_details id=${monthly.id}`);
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
            statementDescriptions.push(`DELETE contract_member_assignments for contract_id=${contract.id}`);
            
            // 契約の削除文を追加
            allStatements.push(
              DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contract.id)
            );
            statementDescriptions.push(`DELETE contracts id=${contract.id}`);
          }
        }

        // 案件の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(project.id)
        );
        statementDescriptions.push(`DELETE projects id=${project.id}`);
      }
    }

    // リードの削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM leads WHERE id = ?`).bind(leadId)
    );
    statementDescriptions.push(`DELETE leads id=${leadId}`);

    console.log(`[DELETE] Executing ${allStatements.length} delete statements`);
    
    // 個別に削除を実行（順序を保証）
    for (let i = 0; i < allStatements.length; i++) {
      try {
        console.log(`[DELETE] Executing ${i+1}/${allStatements.length}: ${statementDescriptions[i]}`);
        await allStatements[i].run();
        console.log(`[DELETE] Statement ${i+1}/${allStatements.length} executed successfully`);
      } catch (err) {
        console.error(`[DELETE] Statement ${i+1}/${allStatements.length} (${statementDescriptions[i]}) failed:`, err);
        throw err;
      }
    }

    return c.json({
      success: true,
      deleted: {
        leads: 1,
        projects: deletedProjects,
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
  const leadId = parseInt(c.req.param('id'));

  try {
    const projects = await DB.prepare(`
      SELECT id, project_name FROM projects WHERE lead_id = ?
    `).bind(leadId).all();

    const projectIds = projects.results.map(p => p.id);
    let contracts = { results: [] };
    let monthlyDetailsCount = 0;
    let memberAssignmentsCount = 0;

    if (projectIds.length > 0) {
      contracts = await DB.prepare(`
        SELECT id, contract_name FROM contracts WHERE project_id IN (${projectIds.join(',')})
      `).all();

      const contractIds = contracts.results.map(c => c.id);
      
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
    }

    return c.json({
      success: true,
      impact: {
        projects: projects.results,
        contracts: contracts.results,
        monthly_details_count: monthlyDetailsCount,
        member_assignments_count: memberAssignmentsCount
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});


export default app
