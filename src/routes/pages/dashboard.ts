import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/', async (c) => {
  try {
    const { DB } = c.env
    
    // ダッシュボードデータを取得
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`
    
    // 前月を計算
    let lastYear = year
    let lastMonthNum = month - 1
    if (lastMonthNum === 0) {
      lastYear -= 1
      lastMonthNum = 12
    }
    const lastMonth = `${lastYear}-${String(lastMonthNum).padStart(2, '0')}`
  
  // 当月売上（対象月の全件）
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ?'
  ).bind(currentMonth).all()
  
  // 前月売上（対象月の全件）
  const { results: lastMonthSales } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ?'
  ).bind(lastMonth).all()
  
  // ※当月売上はcurrentMonthSalesと同一クエリのため削除（currentMonthSalesTotalを使用）
  
  // 未請求金額（billing_date <= 今日）
  const { results: unbilled } = await DB.prepare(
    "SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE billing_status = ? AND billing_date <= DATE('now')"
  ).bind('未請求').all()
  
  // 未入金金額（請求済のみ）
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount_with_tax - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?) AND billing_status = ?'
  ).bind('未入金', '部分入金', '請求済').all()
  
  // メンバー稼働率（当月）
  const { results: memberWorkRatio } = await DB.prepare(`
    SELECT 
      m.name as member_name,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.allocation_ratio ELSE 0 END), 0) as total_ratio,
      COUNT(DISTINCT CASE WHEN md.target_month = ? THEN mma.monthly_detail_id END) as project_count
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name
    ORDER BY total_ratio DESC
  `).bind(currentMonth, currentMonth).all()
  
  // メンバー稼働率（前月）
  const { results: memberWorkRatioLastMonth } = await DB.prepare(`
    SELECT 
      m.name as member_name,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.allocation_ratio ELSE 0 END), 0) as total_ratio,
      COUNT(DISTINCT CASE WHEN md.target_month = ? THEN mma.monthly_detail_id END) as project_count
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name
    ORDER BY total_ratio DESC
  `).bind(lastMonth, lastMonth).all()
  
  // メンバー別 累計売上（請求済ベース）
  const { results: memberTotalSales } = await DB.prepare(`
    SELECT 
      m.name as member_name,
      COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0) as total_sales,
      COUNT(DISTINCT mma.monthly_detail_id) as monthly_count
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name
    ORDER BY total_sales DESC
  `).all()
  
  // 入金不一致の月次明細を取得（入金総額が0より大きく、月次明細金額と異なる場合）
  // payment_historiesから実際の入金額を集計して比較（税込み額で比較）
  const { results: paymentMismatches } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount_with_tax,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment_amount,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY md.id, md.target_month, md.amount_with_tax, c.contract_name, p.project_name, l.company_name
    HAVING COALESCE(SUM(ph.payment_amount), 0) > 0 
      AND md.amount_with_tax != COALESCE(SUM(ph.payment_amount), 0)
    ORDER BY md.target_month DESC
    LIMIT 10
  `).all()
  
  const currentMonthSalesTotal = (currentMonthSales[0] as any)?.total || 0
  const lastMonthSalesTotal = (lastMonthSales[0] as any)?.total || 0
  const currentMonthPlannedTotal = currentMonthSalesTotal
  const unbilledTotal = (unbilled[0] as any)?.total || 0
  const unpaidTotal = (unpaid[0] as any)?.total || 0
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>トップダッシュボード - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>
      </script>
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
                <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-briefcase mr-2"></i>案件
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-list-alt mr-2"></i>詳細一覧
                </a>
                <a href="/bank-deposits" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-cash-register mr-2"></i>入金消込
                </a>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/settings" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-cog mr-1"></i>設定
              </a>
              <button onclick="AUTH_UTILS.logout()" class="text-sm text-red-600 hover:text-red-700">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
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
        <!-- 1行目: 売上関連 -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-5">
          <!-- 前月売上 -->
          <a href="/monthly-list?filter=lastMonth" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-history mr-1"></i>前月売上
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-700">
                ¥${lastMonthSalesTotal.toLocaleString()}
              </dd>
            </div>
          </a>

          <!-- 当月売上 -->
          <a href="/monthly-list?filter=current" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-calendar-check mr-1"></i>当月売上
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-700">
                ¥${currentMonthPlannedTotal.toLocaleString()}
              </dd>
            </div>
          </a>
        </div>

        <!-- 2行目: 未処理関連 -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          <!-- 未請求 -->
          <a href="/monthly-list?filter=unbilled" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-file-invoice mr-1"></i>未請求金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-600">
                ¥${unbilledTotal.toLocaleString()}
              </dd>
            </div>
          </a>

          <!-- 未入金 -->
          <a href="/monthly-list?filter=unpaid" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-exclamation-circle mr-1"></i>未入金金額
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-red-600">
                ¥${unpaidTotal.toLocaleString()}
              </dd>
            </div>
          </a>
        </div>

        <!-- 未処理タスクダッシュボード -->
        <div class="bg-white shadow rounded-lg p-6 mb-8" id="pending-tasks-section">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-exclamation-triangle mr-2 text-orange-500"></i>⚠️ 要対応タスク
          </h2>
          <div id="pending-tasks-content" class="space-y-6">
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-spinner fa-spin text-3xl mb-2"></i>
              <p>読み込み中...</p>
            </div>
          </div>
        </div>

        <!-- 月次売上推移グラフ -->
        <div class="bg-white shadow rounded-lg p-6 mb-8">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-chart-line mr-2"></i>月次売上推移(検収日ベース・直近12ヶ月)
          </h2>
          <canvas id="salesChart" height="80"></canvas>
        </div>

        <!-- メンバー稼働率と累計売上 -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <!-- メンバー稼働率（前月） -->
          <div class="bg-white shadow rounded-lg p-6">
            <h2 class="text-lg font-semibold text-gray-900 mb-4">
              <i class="fas fa-history mr-2"></i>メンバー稼働率(前月)
            </h2>
            ${memberWorkRatioLastMonth.length > 0 ? `
            <div class="space-y-3">
              ${memberWorkRatioLastMonth.map((m: any) => {
                const ratio = (m.total_ratio * 100).toFixed(1)
                const color = m.total_ratio >= 1.0 ? 'bg-green-600' : m.total_ratio >= 0.7 ? 'bg-blue-600' : m.total_ratio >= 0.3 ? 'bg-yellow-600' : 'bg-gray-400'
                return `
                <div>
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-gray-700">${m.member_name}</span>
                    <span class="text-sm font-semibold text-gray-900">${ratio}%</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2">
                    <div class="${color} h-2 rounded-full" style="width: ${Math.min(100, parseFloat(ratio))}%"></div>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">${m.project_count}案件</p>
                </div>
                `}).join('')}
            </div>
            ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-user-slash text-4xl mb-2"></i>
              <p>前月のアサインがありません</p>
            </div>
            `}
          </div>

          <!-- メンバー稼働率（当月） -->
          <div class="bg-white shadow rounded-lg p-6">
            <h2 class="text-lg font-semibold text-gray-900 mb-4">
              <i class="fas fa-user-clock mr-2"></i>メンバー稼働率(当月)
            </h2>
            ${memberWorkRatio.length > 0 ? `
            <div class="space-y-3">
              ${memberWorkRatio.map((m: any) => {
                const ratio = (m.total_ratio * 100).toFixed(1)
                const color = m.total_ratio >= 1.0 ? 'bg-green-600' : m.total_ratio >= 0.7 ? 'bg-blue-600' : m.total_ratio >= 0.3 ? 'bg-yellow-600' : 'bg-gray-400'
                return `
                <div>
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-gray-700">${m.member_name}</span>
                    <span class="text-sm font-semibold text-gray-900">${ratio}%</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2">
                    <div class="${color} h-2 rounded-full" style="width: ${Math.min(100, parseFloat(ratio))}%"></div>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">${m.project_count}案件</p>
                </div>
                `}).join('')}
            </div>
            ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-user-slash text-4xl mb-2"></i>
              <p>当月のアサインがありません</p>
            </div>
            `}
          </div>

          <!-- メンバー別 累計売上 -->
          <div class="bg-white shadow rounded-lg p-6">
            <h2 class="text-lg font-semibold text-gray-900 mb-4">
              <i class="fas fa-trophy mr-2"></i>メンバー別 累計売上
            </h2>
            ${memberTotalSales.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="min-w-full">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">メンバー</th>
                    <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">累計売上</th>
                    <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">請求月数</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  ${memberTotalSales.map((m: any, index: number) => `
                  <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-sm">
                      <div class="flex items-center">
                        ${index < 3 ? '<i class="fas fa-medal text-yellow-500 mr-2"></i>' : ''}
                        <span class="font-medium text-gray-900">${m.member_name}</span>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-sm text-right font-semibold text-green-600">
                      ¥${Math.round(m.total_sales).toLocaleString()}
                    </td>
                    <td class="px-3 py-2 text-sm text-center text-gray-600">
                      ${m.monthly_count}ヶ月
                    </td>
                  </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-inbox text-4xl mb-2"></i>
              <p>売上がありません</p>
            </div>
            `}
          </div>
        </div>
      </div>

      <!-- Chart.js -->
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>
        // Axiosセットアップ（認証ヘッダー設定）
        AUTH_UTILS.setupAxios();
        
        // 未処理タスクの読み込み
        axios.get('/api/dashboard/pending-tasks').then(response => {
          const tasks = response.data.data;
          const { overdueBillings, overduePayments, amountMismatch, paymentMismatches } = tasks;
          
          const totalTasks = overdueBillings.length + overduePayments.length + (amountMismatch ? amountMismatch.length : 0) + (paymentMismatches ? paymentMismatches.length : 0);
          
          if (totalTasks === 0) {
            document.getElementById('pending-tasks-content').innerHTML = \`
              <div class="text-center py-8 text-green-600">
                <i class="fas fa-check-circle text-5xl mb-3"></i>
                <p class="text-lg font-semibold">すべてのタスクが完了しています！</p>
                <p class="text-sm text-gray-500 mt-2">現在、対応が必要なタスクはありません。</p>
              </div>
            \`;
            return;
          }
          
          let html = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">';
          
          // 請求期限間近・超過
          if (overdueBillings.length > 0) {
            html += \`
              <div class="border-l-4 border-yellow-500 bg-yellow-50 p-4 rounded">
                <h3 class="text-yellow-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-exclamation-triangle mr-2"></i>🟡 請求期限間近 (\${overdueBillings.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${overdueBillings.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month} - ¥\${task.amount.toLocaleString()}</div>
                      <div class="text-xs text-yellow-600 mt-1">
                        <i class="fas fa-clock mr-1"></i>対象月末から\${Math.floor(task.days_since_month_end)}日経過
                      </div>
                    </a>
                  \`).join('')}
                </div>
              </div>
            \`;
          }
          
          // 入金予定日超過
          if (overduePayments.length > 0) {
            html += \`
              <div class="border-l-4 border-orange-500 bg-orange-50 p-4 rounded">
                <h3 class="text-orange-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-money-bill-wave mr-2"></i>🟠 入金予定日超過 (\${overduePayments.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${overduePayments.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month}</div>
                      <div class="text-xs text-orange-600 mt-1">
                        ¥\${task.amount.toLocaleString()} 
                        <span class="text-gray-500">(入金済: ¥\${(task.total_payment_amount || 0).toLocaleString()})</span>
                      </div>
                      <div class="text-xs text-orange-600">
                        <i class="fas fa-clock mr-1"></i>\${Math.floor(task.days_overdue)}日超過
                      </div>
                    </a>
                  \`).join('')}
                </div>
              </div>
            \`;
          }
          
          // 金額と想定売上の不一致
          if (amountMismatch && amountMismatch.length > 0) {
            html += \`
              <div class="border-l-4 border-purple-500 bg-purple-50 p-4 rounded">
                <h3 class="text-purple-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-exclamation mr-2"></i>🟣 金額不一致 (\${amountMismatch.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${amountMismatch.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month}</div>
                      <div class="text-xs text-purple-600 mt-1">
                        明細金額: ¥\${task.amount.toLocaleString()}
                      </div>
                      <div class="text-xs text-purple-600">
                        想定売上: ¥\${Math.round(task.expected_revenue).toLocaleString()}
                      </div>
                      <div class="text-xs text-purple-600 font-semibold">
                        <i class="fas fa-exclamation-triangle mr-1"></i>差額: ¥\${Math.round(task.difference).toLocaleString()}
                      </div>
                    </a>
                  \`).join('')}
                </div>
              </div>
            \`;
          }
          
          // 入金不一致
          if (paymentMismatches && paymentMismatches.length > 0) {
            html += \`
              <div class="border-l-4 border-pink-500 bg-pink-50 p-4 rounded">
                <h3 class="text-pink-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-coins mr-2"></i>🔴 入金不一致 (\${paymentMismatches.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${paymentMismatches.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month}</div>
                      <div class="text-xs text-pink-600 mt-1">
                        請求金額(税込): ¥\${task.amount_with_tax.toLocaleString()}
                      </div>
                      <div class="text-xs text-pink-600">
                        入金総額: ¥\${(task.total_payment_amount || 0).toLocaleString()}
                      </div>
                      <div class="text-xs text-pink-600 font-semibold">
                        <i class="fas fa-exclamation-triangle mr-1"></i>差額: ¥\${Math.round(task.difference).toLocaleString()}
                      </div>
                    </a>
                  \`).join('')}
                </div>
              </div>
            \`;
          }
          
          html += '</div>';
          document.getElementById('pending-tasks-content').innerHTML = html;
        }).catch(error => {
          console.error('Failed to load pending tasks:', error);
          document.getElementById('pending-tasks-content').innerHTML = \`
            <div class="text-center py-8 text-red-500">
              <i class="fas fa-exclamation-circle text-3xl mb-2"></i>
              <p>タスクの読み込みに失敗しました</p>
            </div>
          \`;
        });

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
        
        // ユーザー情報を読み込み
        document.addEventListener('DOMContentLoaded', async function() {
          AUTH_UTILS.checkAuth();
          AUTH_UTILS.setupAxios();
          const user = await AUTH_UTILS.getCurrentUser();
          if (user) {
            document.getElementById('nav-user-name').textContent = user.name;
            if (user.role === 'admin') {
              document.getElementById('admin-menu').style.display = '';
            }
          }
        });
      </script>
    </body>
    </html>
  `)
  } catch (error) {
    console.error('Dashboard error:', error)
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - SFA</title>
      </head>
      <body>
        <h1>Error</h1>
        <p>An error occurred while loading the dashboard.</p>
        <pre>${error instanceof Error ? error.message : 'Unknown error'}</pre>
        <pre>${error instanceof Error && error.stack ? error.stack : ''}</pre>
        <p><a href="/login">Go to Login</a></p>
      </body>
      </html>
    `, 500)
  }
})


export default app
