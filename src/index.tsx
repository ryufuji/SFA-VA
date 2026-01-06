import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// 静的ファイルの配信
app.use('/static/*', serveStatic({ root: './public' }))

// ========================================
// API Routes
// ========================================

// --- リード API ---
app.get('/api/leads', async (c) => {
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

app.get('/api/leads/:id', async (c) => {
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

app.post('/api/leads', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { company_name, contact_person, email, phone } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO leads (company_name, contact_person, email, phone, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(company_name, contact_person || null, email || null, phone || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// --- 案件 API ---
app.get('/api/projects/:id', async (c) => {
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

app.post('/api/projects', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { lead_id, project_name } = body
  
  if (!lead_id || !project_name) {
    return c.json({ success: false, error: 'Lead ID and project name are required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO projects (lead_id, project_name, status) VALUES (?, ?, ?)'
  ).bind(lead_id, project_name, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// --- 契約 API ---
app.get('/api/contracts/:id', async (c) => {
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

app.post('/api/contracts', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { project_id, contract_name, contract_start_date, contract_end_date, contract_amount } = body
  
  if (!project_id || !contract_start_date || !contract_end_date || !contract_amount) {
    return c.json({ success: false, error: 'All fields are required' }, 400)
  }
  
  // 契約を作成
  const result = await DB.prepare(
    'INSERT INTO contracts (project_id, contract_name, contract_start_date, contract_end_date, contract_amount, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(project_id, contract_name, contract_start_date, contract_end_date, contract_amount, 'active').run()
  
  const contractId = result.meta.last_row_id
  
  // 月次明細を自動生成
  const startDate = new Date(contract_start_date)
  const endDate = new Date(contract_end_date)
  
  const months: string[] = []
  let currentDate = new Date(startDate)
  
  while (currentDate <= endDate) {
    const yearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
    if (!months.includes(yearMonth)) {
      months.push(yearMonth)
    }
    currentDate.setMonth(currentDate.getMonth() + 1)
  }
  
  // 均等割で月次明細を作成
  const amountPerMonth = Math.floor(contract_amount / months.length)
  
  for (const month of months) {
    await DB.prepare(
      'INSERT INTO monthly_details (contract_id, target_month, amount, inspection_status, billing_status, payment_status, total_payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(contractId, month, amountPerMonth, '未検収', '未請求', '未入金', 0).run()
  }
  
  return c.json({ success: true, data: { id: contractId, monthsGenerated: months.length } })
})

// --- 月次明細 API ---
app.get('/api/monthly-details/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const detail = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!detail) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // 入金履歴を取得
  const { results: paymentHistories } = await DB.prepare(
    'SELECT * FROM payment_histories WHERE monthly_detail_id = ? ORDER BY payment_date ASC'
  ).bind(id).all()
  
  // ステータス変更履歴を取得
  const { results: statusHistories } = await DB.prepare(
    'SELECT * FROM status_change_histories WHERE table_name = ? AND record_id = ? ORDER BY changed_at DESC LIMIT 10'
  ).bind('monthly_details', id).all()
  
  return c.json({ success: true, data: { ...detail, paymentHistories, statusHistories } })
})

app.put('/api/monthly-details/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { 
    amount, 
    inspection_status, 
    inspection_date, 
    inspection_reason,
    billing_status, 
    billing_date, 
    invoice_number,
    billing_reason
  } = body
  
  // 現在の値を取得
  const current = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (!current) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // システム設定を取得
  const requireReasonSetting = await DB.prepare(
    'SELECT value FROM system_settings WHERE key = ?'
  ).bind('require_status_change_reason').first() as any
  
  const requireReason = requireReasonSetting?.value || 'rollback_only'
  
  // ステータス変更履歴を記録
  if (inspection_status && inspection_status !== current.inspection_status) {
    // 巻き戻しの場合、理由が必須
    const isRollback = inspection_status === '未検収' && current.inspection_status === '検収済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !inspection_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'inspection_status', current.inspection_status, inspection_status, inspection_reason || '', '管理者').run()
  }
  
  if (billing_status && billing_status !== current.billing_status) {
    const isRollback = billing_status === '未請求' && current.billing_status === '請求済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !billing_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'billing_status', current.billing_status, billing_status, billing_reason || '', '管理者').run()
  }
  
  // 月次明細を更新
  await DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, 
        inspection_status = ?, 
        inspection_date = ?,
        billing_status = ?, 
        billing_date = ?, 
        invoice_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    amount || current.amount,
    inspection_status || current.inspection_status,
    inspection_date || current.inspection_date,
    billing_status || current.billing_status,
    billing_date || current.billing_date,
    invoice_number || current.invoice_number,
    id
  ).run()
  
  return c.json({ success: true, message: 'Updated successfully' })
})

// --- 入金履歴 API ---
app.post('/api/payment-histories', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { monthly_detail_id, payment_date, payment_amount, note } = body
  
  if (!monthly_detail_id || !payment_date || !payment_amount) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }
  
  // 入金履歴を追加
  await DB.prepare(
    'INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(monthly_detail_id, payment_date, payment_amount, note || null, '管理者').run()
  
  // 累計入金額を再計算
  const { results: histories } = await DB.prepare(
    'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
  ).bind(monthly_detail_id).all()
  
  const totalPayment = (histories[0] as any)?.total || 0
  
  // 月次明細の入金情報を更新
  const detail = await DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  const amount = detail?.amount || 0
  
  let paymentStatus = '未入金'
  if (totalPayment >= amount) {
    paymentStatus = '入金完了'
  } else if (totalPayment > 0) {
    paymentStatus = '部分入金'
  }
  
  await DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, 
        payment_status = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalPayment, paymentStatus, payment_date, monthly_detail_id).run()
  
  return c.json({ success: true, message: 'Payment added successfully', totalPayment, paymentStatus })
})

// --- メンバー API ---
app.get('/api/members', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(
    'SELECT * FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()
  
  return c.json({ success: true, data: results })
})

// --- ダッシュボード API ---
app.get('/api/dashboard/summary', async (c) => {
  const { DB } = c.env
  
  // 当月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 当月売上(検収済)
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  // 未検収金額
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE inspection_status = ?'
  ).bind('未検収').all()
  
  // 未請求金額
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ?'
  ).bind('未請求').all()
  
  // 未入金金額
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?)'
  ).bind('未入金', '部分入金').all()
  
  return c.json({
    success: true,
    data: {
      currentMonthSales: (currentMonthSales[0] as any)?.total || 0,
      uninspectedAmount: (uninspected[0] as any)?.total || 0,
      unbilledAmount: (unbilled[0] as any)?.total || 0,
      unpaidAmount: (unpaid[0] as any)?.total || 0
    }
  })
})

// 月次売上推移(直近12ヶ月)
app.get('/api/dashboard/sales-trend', async (c) => {
  const { DB } = c.env
  
  // 直近12ヶ月のデータを取得
  const { results } = await DB.prepare(`
    SELECT 
      target_month,
      SUM(CASE WHEN inspection_status = '検収済' THEN amount ELSE 0 END) as confirmed_sales
    FROM monthly_details
    WHERE target_month >= date('now', '-12 months')
    GROUP BY target_month
    ORDER BY target_month ASC
  `).all()
  
  return c.json({ success: true, data: results })
})

// ========================================
// HTML Pages
// ========================================

// トップダッシュボード
app.get('/', async (c) => {
  const { DB } = c.env
  
  // ダッシュボードデータを取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE inspection_status = ?'
  ).bind('未検収').all()
  
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ?'
  ).bind('未請求').all()
  
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?)'
  ).bind('未入金', '部分入金').all()
  
  const currentMonthSalesTotal = (currentMonthSales[0] as any)?.total || 0
  const uninspectedTotal = (uninspected[0] as any)?.total || 0
  const unbilledTotal = (unbilled[0] as any)?.total || 0
  const unpaidTotal = (unpaid[0] as any)?.total || 0
  
  // 進行中の契約を取得
  const { results: activeContracts } = await DB.prepare(`
    SELECT c.*, p.project_name
    FROM contracts c
    JOIN projects p ON c.project_id = p.id
    WHERE c.status = 'active'
    ORDER BY c.contract_start_date DESC
    LIMIT 10
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>トップダッシュボード - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100">
      <!-- グローバルナビゲーション -->
      <nav class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex">
              <div class="flex-shrink-0 flex items-center">
                <a href="/" class="text-xl font-bold text-blue-600">
                  <i class="fas fa-chart-line mr-2"></i>SFA
                </a>
              </div>
              <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-home mr-2"></i>ダッシュボード
                </a>
                <a href="/leads" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-users mr-2"></i>リード
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-4">
                <i class="fas fa-user-circle mr-1"></i>管理者
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- ページヘッダー -->
        <div class="px-4 py-6 sm:px-0">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-home mr-2"></i>トップダッシュボード
          </h1>
        </div>

        <!-- KPIカード -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <!-- 当月売上 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-yen-sign mr-1"></i>当月売上(確定)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-900">
                ¥${currentMonthSalesTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未検収 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-clock mr-1"></i>未検収金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-yellow-600">
                ¥${uninspectedTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未請求 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-file-invoice mr-1"></i>未請求金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-600">
                ¥${unbilledTotal.toLocaleString()}
              </dd>
            </div>
          </div>

          <!-- 未入金 -->
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-exclamation-circle mr-1"></i>未入金金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-red-600">
                ¥${unpaidTotal.toLocaleString()}
              </dd>
            </div>
          </div>
        </div>

        <!-- 月次売上推移グラフ -->
        <div class="bg-white shadow rounded-lg p-6 mb-8">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-chart-line mr-2"></i>月次売上推移(直近12ヶ月)
          </h2>
          <canvas id="salesChart" height="80"></canvas>
        </div>

        <!-- 進行中の契約 -->
        <div class="bg-white shadow rounded-lg p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-contract mr-2"></i>進行中の契約(上位10件)
            </h2>
          </div>
          
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">契約期間</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">契約金額</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${activeContracts.map((contract: any) => `
                  <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/contracts/${contract.id}'">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ${contract.project_name}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${contract.contract_start_date} 〜 ${contract.contract_end_date}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ¥${parseInt(contract.contract_amount).toLocaleString()}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        <i class="fas fa-play-circle mr-1"></i>進行中
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Chart.js -->
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        // 月次売上推移グラフ
        axios.get('/api/dashboard/sales-trend').then(response => {
          const data = response.data.data
          const labels = data.map(d => d.target_month)
          const values = data.map(d => d.confirmed_sales)
          
          const ctx = document.getElementById('salesChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: '売上(円)',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  display: false
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: function(value) {
                      return '¥' + value.toLocaleString();
                    }
                  }
                }
              }
            }
          });
        })
      </script>
    </body>
    </html>
  `)
})

export default app
