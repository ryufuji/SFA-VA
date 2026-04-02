import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/monthly/:id', async (c) => {
  const id = c.req.param('id')
  
  // 月次明細情報と契約、案件、リード情報を取得
  const monthly = await c.env.DB.prepare(`
    SELECT 
      md.*,
      c.contract_name,
      c.project_id,
      c.contract_amount,
      p.project_name,
      p.lead_id,
      l.company_name
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    JOIN leads l ON p.lead_id = l.id
    WHERE md.id = ?
  `).bind(id).first()
  
  if (!monthly) return c.notFound()

  // 月次メンバーアサインを取得
  const members = await c.env.DB.prepare(`
    SELECT 
      mma.*,
      m.name as member_name,
      m.email
    FROM monthly_member_assignments mma
    JOIN members m ON mma.member_id = m.id
    WHERE mma.monthly_detail_id = ?
    ORDER BY mma.allocation_ratio DESC
  `).bind(id).all()

  // 入金履歴を取得
  const payments = await c.env.DB.prepare(`
    SELECT * FROM payment_histories
    WHERE monthly_detail_id = ?
    ORDER BY payment_date DESC
  `).bind(id).all()

  // 変更履歴を取得
  const histories = await c.env.DB.prepare(`
    SELECT * FROM status_change_histories
    WHERE table_name = 'monthly_detail' AND record_id = ?
    ORDER BY changed_at DESC
    LIMIT 10
  `).bind(id).all()

  // 関連する請求書を取得
  const invoice = await c.env.DB.prepare(`
    SELECT id, invoice_number, issue_date
    FROM invoices
    WHERE monthly_detail_id = ?
    LIMIT 1
  `).bind(id).first()

  // 統計計算
  const totalPayment = payments.results.reduce((sum, p) => sum + (p.payment_amount || 0), 0)
  const remainingAmount = (monthly.amount_with_tax || 0) - totalPayment
  const allocationTotal = members.results.reduce((sum, m) => sum + (m.allocation_ratio || 0), 0)
  
  // 想定売上の合計を計算
  const totalExpectedRevenue = members.results.reduce((sum, m) => sum + (m.unit_price * m.allocation_ratio), 0)
  const revenueDifference = (monthly.amount || 0) - totalExpectedRevenue

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>月次明細詳細 - ${monthly.target_month}</title>
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
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
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

        <div class="max-w-full mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/leads/${monthly.lead_id}" class="text-blue-600 hover:text-blue-800">${monthly.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/detail/${monthly.project_id}" class="text-blue-600 hover:text-blue-800">${monthly.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/contracts/${monthly.contract_id}" class="text-blue-600 hover:text-blue-800">${monthly.contract_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">${monthly.name || `月次明細 ${monthly.target_month}`}</span>
            </div>

            <!-- 基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-calendar-alt mr-2 text-blue-600"></i>${monthly.name || `月次明細 ${monthly.target_month}`}
                        </h1>
                        <p class="text-gray-600">${monthly.contract_name}</p>
                        <p class="text-sm text-gray-500 mt-1">
                            <i class="fas fa-calendar mr-1"></i>対象年月: <span class="font-semibold">${monthly.target_month}</span>
                        </p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-gray-500">金額（税抜）</p>
                        <p class="text-2xl font-bold text-gray-700">¥${(monthly.amount || 0).toLocaleString()}</p>
                        <p class="text-sm text-gray-500 mt-2">金額（税込）</p>
                        <p class="text-3xl font-bold text-blue-600">¥${(monthly.amount_with_tax || 0).toLocaleString()}</p>
                        <button onclick="openEditAmountModal()" class="text-sm text-blue-600 hover:text-blue-800 mt-2">
                            <i class="fas fa-edit mr-1"></i>金額を編集
                        </button>
                    </div>
                </div>
            </div>

            <!-- アサインメンバー（この月のみ） -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-users mr-2 text-indigo-600"></i>アサインメンバー（この月のみ）
                    </h2>
                    <button onclick="openAddMemberModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
                        <i class="fas fa-user-plus mr-2"></i>メンバーを追加
                    </button>
                </div>

                ${revenueDifference !== 0 ? `
                <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                    <div class="flex">
                        <i class="fas fa-exclamation-triangle text-yellow-600 mr-2 mt-1"></i>
                        <div class="text-sm text-yellow-700">
                            <p class="font-semibold mb-1">想定売上の合計が月次明細金額と一致しません</p>
                            <p>月次明細金額: ¥${(monthly.amount || 0).toLocaleString()}</p>
                            <p>想定売上合計: ¥${Math.round(totalExpectedRevenue).toLocaleString()}</p>
                            <p class="font-semibold mt-1">差額: ¥${Math.abs(Math.round(revenueDifference)).toLocaleString()} ${revenueDifference > 0 ? '(不足)' : '(超過)'}</p>
                        </div>
                    </div>
                </div>
                ` : ''}

                ${members.results.length > 0 ? `
                <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">メンバー名</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">単価</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">稼働率</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">想定売上</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">備考</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${members.results.map(m => {
                          const expectedRevenue = m.unit_price * m.allocation_ratio
                          return `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3">
                                <div class="font-medium">${m.member_name}</div>
                                <div class="text-sm text-gray-500">${m.email || '-'}</div>
                            </td>
                            <td class="px-4 py-3">¥${(m.unit_price || 0).toLocaleString()}/月</td>
                            <td class="px-4 py-3">
                                <span class="font-medium">${(m.allocation_ratio * 100).toFixed(1)}%</span>
                            </td>
                            <td class="px-4 py-3 text-green-600 font-medium">
                                ¥${Math.round(expectedRevenue).toLocaleString()}
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-600">${m.notes || '-'}</td>
                            <td class="px-4 py-3">
                                <button onclick="openEditMemberModal(${m.id}, '${m.member_name}', ${m.allocation_ratio}, ${m.unit_price}, '${(m.notes || '').replace(/'/g, "\\'")}');" class="text-blue-600 hover:text-blue-800 mr-2">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button onclick="deleteMember(${m.id})" class="text-red-600 hover:text-red-800">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                        `}).join('')}
                    </tbody>
                </table>
                </div>
                ` : `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-user-slash text-4xl mb-2"></i>
                    <p>まだメンバーがアサインされていません</p>
                </div>
                `}
            </div>

            <!-- 請求情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-file-invoice mr-2 text-orange-600"></i>請求情報
                </h2>
                <form id="billing-form" class="space-y-4">
                    <!-- 検収日（読み取り専用） -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">検収日</label>
                            <div class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                                ${monthly.acceptance_date || '—'}
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求ステータス</label>
                            <select name="billing_status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="未請求" ${monthly.billing_status === '未請求' ? 'selected' : ''}>未請求</option>
                                <option value="請求済" ${monthly.billing_status === '請求済' ? 'selected' : ''}>請求済</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求日</label>
                            <input type="date" id="billing_date" name="billing_date" value="${monthly.billing_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">請求書番号</label>
                            <input type="text" name="invoice_number" value="${monthly.invoice_number || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                   placeholder="INV-2026-001">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">入金予定日</label>
                            <input type="date" id="expected_payment_date" name="expected_payment_date" value="${monthly.expected_payment_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="flex justify-end gap-3">
                        ${!invoice ? `
                        <button type="button" onclick="openCreateInvoiceModal()" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                            <i class="fas fa-receipt mr-2"></i>請求書を作成
                        </button>
                        ` : `
                        <button type="button" onclick="window.open('/invoices/${invoice.id}/pdf', '_blank')" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                            <i class="fas fa-file-pdf mr-2"></i>請求書PDF
                        </button>
                        <a href="/invoices/${invoice.id}" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
                            <i class="fas fa-eye mr-2"></i>請求書詳細
                        </a>
                        `}
                        <button type="submit" class="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700">
                            <i class="fas fa-save mr-2"></i>請求情報を更新
                        </button>
                    </div>
                </form>
            </div>

            <!-- 入金情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-money-bill-wave mr-2 text-purple-600"></i>入金情報
                    </h2>

                </div>

                <!-- 入金サマリー -->
                <div class="bg-purple-50 rounded-lg p-4 mb-4">
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="text-sm text-gray-600">予定金額（税込）</p>
                            <p class="text-xl font-semibold text-gray-700">¥${(monthly.amount_with_tax || 0).toLocaleString()}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-600">合計入金額</p>
                            <p class="text-2xl font-bold text-purple-600">¥${totalPayment.toLocaleString()}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-sm text-gray-600">残額</p>
                            <p class="text-2xl font-bold ${remainingAmount > 0 ? 'text-red-600' : 'text-green-600'}">
                                ¥${remainingAmount.toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div class="mt-2">
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div class="bg-purple-600 h-2 rounded-full" style="width: ${Math.min(100, (totalPayment / (monthly.amount_with_tax || 1)) * 100)}%"></div>
                        </div>
                    </div>
                </div>

                <!-- 入金履歴 -->
                ${payments.results.length > 0 ? `
                <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">入金日</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">備考</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${payments.results.map(p => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3">${p.payment_date}</td>
                            <td class="px-4 py-3 font-medium text-green-600">¥${(p.payment_amount || 0).toLocaleString()}</td>
                            <td class="px-4 py-3 text-gray-600">${p.note || '-'}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                </div>
                ` : `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-2"></i>
                    <p>まだ入金がありません</p>
                </div>
                `}
            </div>

            <!-- 変更履歴 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-history mr-2 text-gray-600"></i>変更履歴
                </h2>
                ${histories.results.length > 0 ? `
                <div class="space-y-3">
                    ${histories.results.map(h => `
                    <div class="border-l-4 border-gray-300 pl-4 py-2">
                        <p class="text-sm text-gray-600">${h.changed_at}</p>
                        <p class="text-gray-800">${h.field_name}: ${h.old_value || '-'} → ${h.new_value || '-'}</p>
                        ${h.reason ? `<p class="text-sm text-gray-600 mt-1">理由: ${h.reason}</p>` : ''}
                    </div>
                    `).join('')}
                </div>
                ` : `
                <p class="text-center text-gray-500 py-4">変更履歴はありません</p>
                `}
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
        <script>
            // 認証チェック用のユーティリティ関数
            
            // ユーザー情報を読み込む
            async function loadUserInfo() {
              AUTH_UTILS.checkAuth();
              AUTH_UTILS.setupAxios();
              const user = await AUTH_UTILS.getCurrentUser();
              if (user) {
                const navUserName = document.getElementById('nav-user-name');
                if (navUserName) {
                  navUserName.textContent = user.name;
                }
                if (user.role === 'admin') {
                  const adminMenu = document.getElementById('admin-menu');
                  if (adminMenu) {
                    adminMenu.style.display = '';
                  }
                }
              }
            }

            document.addEventListener('DOMContentLoaded', function() {
            // ユーザー情報を読み込む
            loadUserInfo();
            
            // 請求日が入力されたときに同月末日を自動計算
            document.getElementById('billing_date').addEventListener('change', (e) => {
                const billingDate = e.target.value
                if (billingDate) {
                    const date = new Date(billingDate)
                    // 同月の翌月1日を計算
                    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1)
                    // 1日前（同月末日）を計算
                    const lastDay = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000)
                    // YYYY-MM-DD形式に変換
                    const expectedDate = lastDay.toISOString().split('T')[0]
                    document.getElementById('expected_payment_date').value = expectedDate
                }
            })

            // 請求情報の更新
            document.getElementById('billing-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                const formData = new FormData(e.target)
                const data = {
                    billing_status: formData.get('billing_status'),
                    billing_date: formData.get('billing_date') || null,
                    invoice_number: formData.get('invoice_number') || null,
                    expected_payment_date: formData.get('expected_payment_date') || null
                }

                try {
                    await axios.put('/api/monthly-details/${id}/billing', data)
                    alert('請求情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            })



            window.openAddMemberModal = async function() {
                try {
                    // メンバー一覧を取得
                    const response = await axios.get('/api/members')
                    const members = response.data.data
                    
                    if (members.length === 0) {
                        alert('アサイン可能なメンバーがいません')
                        return
                    }
                    
                    // 既にアサイン済みのメンバーIDを取得
                    const assignedMemberIds = ${JSON.stringify(members.results.map(m => m.member_id))}
                    
                    // モーダルを表示
                    const modal = document.getElementById('addMemberModal')
                    const memberList = document.getElementById('memberList')
                    
                    // メンバーリストを生成
                    memberList.innerHTML = members.filter(m => !assignedMemberIds.includes(m.id)).map(member => \`
                        <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 member-item">
                            <div class="flex items-center mb-3">
                                <input type="checkbox" 
                                       id="member-\${member.id}" 
                                       value="\${member.id}" 
                                       class="w-5 h-5 text-indigo-600 rounded mr-3"
                                       onchange="toggleMemberInputs(\${member.id})">
                                <label for="member-\${member.id}" class="flex-1 cursor-pointer">
                                    <div class="font-medium text-gray-900">\${member.name}</div>
                                    <div class="text-sm text-gray-500">\${member.email || '-'}</div>
                                </label>
                            </div>
                            <div id="inputs-\${member.id}" class="ml-8 space-y-2 hidden">
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-700 mb-1">稼働率</label>
                                        <select id="ratio-\${member.id}" class="w-full px-2 py-1 text-sm border border-gray-300 rounded">
                                            <option value="1.0">100%</option>
                                            <option value="0.9">90%</option>
                                            <option value="0.8">80%</option>
                                            <option value="0.7">70%</option>
                                            <option value="0.6">60%</option>
                                            <option value="0.5">50%</option>
                                            <option value="0.4">40%</option>
                                            <option value="0.3">30%</option>
                                            <option value="0.2">20%</option>
                                            <option value="0.1">10%</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-700 mb-1">単価（円/月）</label>
                                        <input type="number" 
                                               id="price-\${member.id}" 
                                               value="\${member.default_unit_price || 0}"
                                               class="w-full px-2 py-1 text-sm border border-gray-300 rounded">
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-xs font-medium text-gray-700 mb-1">備考</label>
                                    <input type="text" 
                                           id="notes-\${member.id}" 
                                           placeholder="役割など"
                                           class="w-full px-2 py-1 text-sm border border-gray-300 rounded">
                                </div>
                            </div>
                        </div>
                    \`).join('')
                    
                    if (members.filter(m => !assignedMemberIds.includes(m.id)).length === 0) {
                        memberList.innerHTML = '<p class="text-center text-gray-500 py-8">アサイン可能なメンバーがいません</p>'
                    }
                    
                    modal.classList.remove('hidden')
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            }

            function toggleMemberInputs(memberId) {
                const checkbox = document.getElementById('member-' + memberId)
                const inputs = document.getElementById('inputs-' + memberId)
                
                if (checkbox.checked) {
                    inputs.classList.remove('hidden')
                } else {
                    inputs.classList.add('hidden')
                }
            }

            window.closeAddMemberModal = function() {
                document.getElementById('addMemberModal').classList.add('hidden')
            }

            window.submitMembers = async function() {
                try {
                    const checkboxes = document.querySelectorAll('#memberList input[type="checkbox"]:checked')
                    
                    if (checkboxes.length === 0) {
                        alert('少なくとも1人のメンバーを選択してください')
                        return
                    }
                    
                    const assignments = []
                    
                    checkboxes.forEach(checkbox => {
                        const memberId = parseInt(checkbox.value)
                        const ratio = parseFloat(document.getElementById('ratio-' + memberId).value)
                        const price = parseInt(document.getElementById('price-' + memberId).value)
                        const notes = document.getElementById('notes-' + memberId).value
                        
                        assignments.push({
                            member_id: memberId,
                            allocation_ratio: ratio,
                            unit_price: price,
                            notes: notes
                        })
                    })
                    
                    // バッチ登録APIを呼び出し
                    const response = await axios.post('/api/monthly-member-assignments/batch', {
                        monthly_detail_id: ${id},
                        assignments: assignments
                    })
                    
                    if (response.data.success) {
                        alert(response.data.message)
                        location.reload()
                    } else {
                        alert('一部のメンバーの追加に失敗しました:\\n' + 
                              response.data.errors.map(e => '- メンバーID ' + e.member_id + ': ' + e.error).join('\\n'))
                        if (response.data.results.length > 0) {
                            location.reload()
                        }
                    }
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            }

            async function editMember(assignmentId) {
                try {
                    // 現在の値を取得するために再度APIを呼ぶか、データを埋め込む必要がある
                    // ここでは簡易的にプロンプトで入力させる
                    const ratioInput = prompt('新しい稼働率を入力してください (0-100):')
                    if (!ratioInput) return
                    const ratio = parseFloat(ratioInput) / 100
                    
                    if (ratio < 0 || ratio > 1) {
                        alert('稼働率は0〜100の範囲で入力してください')
                        return
                    }
                    
                    const priceInput = prompt('新しい単価を入力してください:')
                    if (!priceInput) return
                    const price = parseInt(priceInput)
                    
                    const notes = prompt('備考（任意）:', '') || ''
                    
                    await axios.put('/api/monthly-member-assignments/' + assignmentId, {
                        allocation_ratio: ratio,
                        unit_price: price,
                        notes: notes
                    })
                    
                    alert('メンバー情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            }

            window.openEditMemberModal = function(assignmentId, memberName, allocationRatio, unitPrice, notes) {
                document.getElementById('edit_assignment_id').value = assignmentId
                document.getElementById('edit_member_name').value = memberName
                document.getElementById('edit_allocation_ratio').value = allocationRatio
                document.getElementById('edit_unit_price').value = unitPrice
                document.getElementById('edit_notes').value = notes
                document.getElementById('editMemberModal').classList.remove('hidden')
            }

            window.closeEditMemberModal = function() {
                document.getElementById('editMemberModal').classList.add('hidden')
                document.getElementById('editMemberForm').reset()
            }

            window.submitEditMember = async function() {
                const assignmentId = document.getElementById('edit_assignment_id').value
                const allocationRatio = parseFloat(document.getElementById('edit_allocation_ratio').value)
                const unitPrice = parseInt(document.getElementById('edit_unit_price').value)
                const notes = document.getElementById('edit_notes').value

                if (isNaN(allocationRatio) || allocationRatio < 0 || allocationRatio > 1) {
                    alert('稼働率は0.0〜1.0の範囲で入力してください')
                    return
                }

                if (isNaN(unitPrice) || unitPrice < 0) {
                    alert('単価は0以上の数値で入力してください')
                    return
                }

                try {
                    await axios.put('/api/monthly-member-assignments/' + assignmentId, {
                        allocation_ratio: allocationRatio,
                        unit_price: unitPrice,
                        notes: notes
                    })
                    alert('メンバー情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            }

            window.deleteMember = async function(assignmentId) {
                if (!confirm('このメンバーのアサインを削除しますか？')) return
                
                try {
                    await axios.delete('/api/monthly-member-assignments/' + assignmentId)
                    alert('メンバーのアサインを削除しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            }

            window.openEditAmountModal = function() {
                const newAmount = prompt('新しい金額:', ${monthly.amount})
                if (!newAmount) return
                
                axios.put('/api/monthly-details/${id}/amount', {
                    amount: parseInt(newAmount)
                }).then(() => {
                    alert('金額を更新しました')
                    location.reload()
                }).catch(error => {
                    alert('エラーが発生しました: ' + error.message)
                })
            }
            
            // 請求書作成モーダル
            window.openCreateInvoiceModal = function() {
                document.getElementById('create-invoice-modal').classList.remove('hidden')
                // 今日の日付をデフォルト設定
                const today = new Date().toISOString().split('T')[0]
                document.querySelector('#create-invoice-form input[name="issue_date"]').value = today
                // 30日後を支払期限のデフォルト
                const dueDate = new Date()
                dueDate.setDate(dueDate.getDate() + 30)
                document.querySelector('#create-invoice-form input[name="payment_due_date"]').value = dueDate.toISOString().split('T')[0]
                // 件名のデフォルト設定
                document.querySelector('#create-invoice-form input[name="subject"]').value = 
                    '${monthly.target_month} 業務委託費用'
            }
            
            window.closeCreateInvoiceModal = function() {
                document.getElementById('create-invoice-modal').classList.add('hidden')
                document.getElementById('create-invoice-form').reset()
            }
            
            // 請求書作成
            document.getElementById('create-invoice-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const formData = new FormData(e.target)
                const data = {
                    issue_date: formData.get('issue_date'),
                    payment_due_date: formData.get('payment_due_date') || null,
                    subject: formData.get('subject'),
                    notes: formData.get('notes') || null
                }
                
                try {
                    const response = await axios.post('/api/monthly-details/${id}/invoice', data)
                    if (response.data.success) {
                        const invoiceId = response.data.data.invoice_id
                        const invoiceNumber = response.data.data.invoice_number
                        
                        // 確認ダイアログで選択肢を提示
                        const userChoice = confirm(
                            '請求書を作成しました！\\n' +
                            '請求書番号: ' + invoiceNumber + '\\n\\n' +
                            'OKをクリックするとPDFを生成します。\\n' +
                            'キャンセルをクリックすると請求書一覧へ移動します。'
                        )
                        
                        closeCreateInvoiceModal()
                        
                        if (userChoice) {
                            // PDFを新しいタブで開く
                            window.open('/invoices/' + invoiceId + '/pdf', '_blank')
                            // 現在のページをリロードして請求済みに更新
                            setTimeout(() => location.reload(), 500)
                        } else {
                            // 請求書一覧へ遷移
                            window.location.href = '/invoices'
                        }
                    }
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            })
            }) // DOMContentLoaded end
        </script>

        <!-- 請求書作成モーダル -->
        <div id="create-invoice-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-10 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-2/3 shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-semibold text-gray-900">
                        <i class="fas fa-receipt mr-2 text-green-600"></i>請求書を作成
                    </h3>
                    <button onclick="closeCreateInvoiceModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <form id="create-invoice-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                発行日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="issue_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                支払期限
                            </label>
                            <input type="date" name="payment_due_date"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            件名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" name="subject" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                               placeholder="例: 2026年1月分 業務委託費用">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            備考
                        </label>
                        <textarea name="notes" rows="3"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                  placeholder="支払条件や振込先などの補足情報"></textarea>
                    </div>
                    
                    <!-- 請求金額プレビュー -->
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-semibold text-gray-700 mb-2">請求金額プレビュー</h4>
                        <div class="space-y-1 text-sm">
                            <div class="flex justify-between">
                                <span>小計:</span>
                                <span id="invoice-preview-subtotal">¥${monthly.amount.toLocaleString()}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>消費税 (10%):</span>
                                <span id="invoice-preview-tax">¥${Math.floor(monthly.amount * 0.1).toLocaleString()}</span>
                            </div>
                            <div class="flex justify-between font-bold text-lg border-t pt-1">
                                <span>合計:</span>
                                <span id="invoice-preview-total" class="text-green-600">¥${(monthly.amount + Math.floor(monthly.amount * 0.1)).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex justify-end space-x-3 pt-4">
                        <button type="button" onclick="closeCreateInvoiceModal()" 
                                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                            <i class="fas fa-times mr-2"></i>キャンセル
                        </button>
                        <button type="submit" 
                                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                            <i class="fas fa-check mr-2"></i>請求書を作成
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- メンバー追加モーダル -->
        <div id="addMemberModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-2/3 shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-semibold text-gray-900">
                        <i class="fas fa-user-plus mr-2 text-indigo-600"></i>メンバーを追加
                    </h3>
                    <button onclick="closeAddMemberModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <div class="mb-4 p-3 bg-blue-50 border-l-4 border-blue-400 text-sm text-blue-700">
                    <i class="fas fa-info-circle mr-2"></i>
                    チェックボックスでメンバーを選択し、稼働率と単価を設定してください。複数人を同時に追加できます。
                </div>

                <div id="memberList" class="space-y-3 max-h-96 overflow-y-auto mb-4">
                    <!-- メンバーリストがここに動的に追加されます -->
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t">
                    <button onclick="closeAddMemberModal()" 
                            class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        <i class="fas fa-times mr-2"></i>キャンセル
                    </button>
                    <button onclick="submitMembers()" 
                            class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                        <i class="fas fa-check mr-2"></i>選択したメンバーを追加
                    </button>
                </div>
            </div>
        </div>

        <!-- メンバー編集モーダル -->
        <div id="editMemberModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-semibold text-gray-900">
                        <i class="fas fa-user-edit mr-2 text-blue-600"></i>メンバー情報を更新
                    </h3>
                    <button onclick="closeEditMemberModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <form id="editMemberForm" class="space-y-4">
                    <input type="hidden" id="edit_assignment_id" name="assignment_id">
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">メンバー名</label>
                        <input type="text" id="edit_member_name" readonly
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            稼働率 <span class="text-red-500">*</span>
                        </label>
                        <div class="flex items-center space-x-2">
                            <input type="number" id="edit_allocation_ratio" name="allocation_ratio" 
                                   min="0" max="1" step="0.01" required
                                   class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <span class="text-gray-600">(0.0 〜 1.0)</span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">例: 50% = 0.5, 100% = 1.0</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            単価 <span class="text-red-500">*</span>
                        </label>
                        <div class="flex items-center space-x-2">
                            <span class="text-gray-600">¥</span>
                            <input type="number" id="edit_unit_price" name="unit_price" 
                                   min="0" step="1000" required
                                   class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">備考</label>
                        <textarea id="edit_notes" name="notes" rows="3"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"></textarea>
                    </div>
                </form>

                <div class="flex justify-end space-x-3 pt-4 border-t mt-4">
                    <button onclick="closeEditMemberModal()" 
                            class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        <i class="fas fa-times mr-2"></i>キャンセル
                    </button>
                    <button onclick="submitEditMember()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        <i class="fas fa-save mr-2"></i>更新
                    </button>
                </div>
            </div>
        </div>
    </body>
    </html>
  `)
})

app.get('/monthly-list', async (c) => {
  const { DB } = c.env
  const filter = c.req.query('filter') || 'all'
  
  // 現在の月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 前月を計算
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  
  let whereClause = ''
  let title = '月次明細一覧'
  let icon = 'fa-calendar'
  
  switch(filter) {
    case 'current':
      whereClause = `WHERE md.target_month = '${currentMonth}'`
      title = '当月売上'
      icon = 'fa-yen-sign'
      break
    case 'lastMonth':
      whereClause = `WHERE md.target_month = '${lastMonth}'`
      title = '前月売上'
      icon = 'fa-history'
      break
    case 'unbilled':
      whereClause = `WHERE md.billing_status = '未請求' AND md.billing_date <= DATE('now')`
      title = '未請求金額'
      icon = 'fa-file-invoice'
      break
    case 'unpaid':
      whereClause = `WHERE md.payment_status IN ('未入金', '部分入金') AND md.billing_status = '請求済'`
      title = '未入金金額'
      icon = 'fa-exclamation-circle'
      break
  }
  
  // 月次明細を取得
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.*,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ${whereClause}
    ORDER BY md.target_month DESC, md.created_at DESC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} - SFA</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
        <script>
          
          document.addEventListener('DOMContentLoaded', async function() {
            AUTH_UTILS.checkAuth();
            AUTH_UTILS.setupAxios();
            const user = await AUTH_UTILS.getCurrentUser();
            if (user) {
              const navUserName = document.getElementById('nav-user-name');
              if (navUserName) {
                navUserName.textContent = user.name;
              }
              const adminMenu = document.getElementById('admin-menu');
              if (adminMenu && user.role === 'admin') {
                adminMenu.style.display = '';
              }
            }
          });
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
                  <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
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

        <div class="max-w-full mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">${title}</span>
            </div>

            <!-- ページヘッダー -->
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-900">
                    <i class="fas ${icon} mr-2"></i>${title}
                </h1>
            </div>

            <!-- 月次明細一覧 -->
            <div class="bg-white rounded-lg shadow-md">
                ${monthlyDetails.length > 0 ? `
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">月次明細</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">顧客</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">案件</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">契約</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">請求</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">入金</th>
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            ${monthlyDetails.map(md => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-6 py-4">
                                    <div class="font-medium text-gray-900">${md.name || md.target_month}</div>
                                    <div class="text-sm text-gray-500">${md.target_month}</div>
                                </td>
                                <td class="px-6 py-4 text-sm text-gray-700">${md.company_name || '-'}</td>
                                <td class="px-6 py-4 text-sm text-gray-700">${md.project_name || '-'}</td>
                                <td class="px-6 py-4 text-sm text-gray-700">${md.contract_name || '-'}</td>
                                <td class="px-6 py-4 font-medium">¥${(md.amount || 0).toLocaleString()}</td>
                                <td class="px-6 py-4">
                                    ${md.billing_status === '請求済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800"><i class="fas fa-file-invoice mr-1"></i>済</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">未</span>'
                                    }
                                </td>
                                <td class="px-6 py-4">
                                    ${(md.total_payment_amount || 0) > 0
                                      ? `<span class="text-green-600 font-medium">¥${(md.total_payment_amount || 0).toLocaleString()}</span>`
                                      : '<span class="text-gray-400">-</span>'
                                    }
                                </td>
                                <td class="px-6 py-4">
                                    <a href="/monthly/${md.id}" class="text-blue-600 hover:text-blue-800">
                                        <i class="fas fa-edit mr-1"></i>詳細
                                    </a>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ` : `
                <div class="text-center py-12 text-gray-500">
                    <i class="fas fa-inbox text-5xl mb-3"></i>
                    <p class="text-lg">該当する月次明細がありません</p>
                </div>
                `}
            </div>
        </div>
    </body>
    </html>
  `)
})

app.get('/monthly-details', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'target_month'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // フィルターパラメータを取得
  const filterCompany = c.req.query('filterCompany') || ''
  const filterProject = c.req.query('filterProject') || ''
  const filterContract = c.req.query('filterContract') || ''
  const filterBilling = c.req.query('filterBilling') || ''
  const filterPayment = c.req.query('filterPayment') || ''
  const filterMonth = c.req.query('filterMonth') || ''
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['target_month', 'amount', 'amount_with_tax', 'contract_name', 'project_name', 'company_name', 'billing_status', 'payment_status']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'target_month'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // フィルター条件を構築
  const conditions: string[] = []
  const mParams: any[] = []
  if (filterCompany) {
    conditions.push("l.company_name LIKE ?")
    mParams.push(`%${filterCompany}%`)
  }
  if (filterProject) {
    conditions.push("p.project_name LIKE ?")
    mParams.push(`%${filterProject}%`)
  }
  if (filterContract) {
    conditions.push("c.contract_name LIKE ?")
    mParams.push(`%${filterContract}%`)
  }
  if (filterBilling) {
    conditions.push("md.billing_status = ?")
    mParams.push(filterBilling)
  }
  if (filterPayment) {
    conditions.push("md.payment_status = ?")
    mParams.push(filterPayment)
  }
  if (filterMonth) {
    conditions.push("md.target_month = ?")
    mParams.push(filterMonth)
  }
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  
  // 全ての月次明細を取得（契約情報と案件情報を含む）
  const stmt = DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount,
      md.amount_with_tax,
      md.billing_status,
      md.payment_status,
      c.contract_name,
      c.contract_start_date,
      c.contract_end_date,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ${whereClause}
    ORDER BY ${sortColumn} ${order}, md.id DESC
  `)
  const { results: monthlyDetails } = mParams.length > 0 ? await stmt.bind(...mParams).all() : await stmt.all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>月次明細一覧 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>

        // ソート機能
        function sortTable(column) {
          const urlParams = new URLSearchParams(window.location.search);
          const currentSort = urlParams.get('sortBy');
          const currentOrder = urlParams.get('sortOrder') || 'DESC';
          
          let newOrder = 'ASC';
          if (currentSort === column && currentOrder === 'ASC') {
            newOrder = 'DESC';
          }
          
          urlParams.set('sortBy', column);
          urlParams.set('sortOrder', newOrder);
          window.location.href = '/monthly-details?' + urlParams.toString();
        }

        function applyFilter() {
          const params = new URLSearchParams();
          const company = document.getElementById('filter-company').value.trim();
          const project = document.getElementById('filter-project').value.trim();
          const contract = document.getElementById('filter-contract').value.trim();
          const billing = document.getElementById('filter-billing').value;
          const payment = document.getElementById('filter-payment').value;
          const month = document.getElementById('filter-month').value;
          if (company) params.set('filterCompany', company);
          if (project) params.set('filterProject', project);
          if (contract) params.set('filterContract', contract);
          if (billing) params.set('filterBilling', billing);
          if (payment) params.set('filterPayment', payment);
          if (month) params.set('filterMonth', month);
          window.location.href = '/monthly-details?' + params.toString();
        }

        function resetFilter() {
          window.location.href = '/monthly-details';
        }

        document.addEventListener('DOMContentLoaded', async function() {
          if (!AUTH_UTILS.checkAuth()) return;
          
          const user = await AUTH_UTILS.getCurrentUser();
          if (user) {
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = user.name || user.email;
            if (user.role === 'admin') {
              const adminMenu = document.getElementById('admin-menu');
              if (adminMenu) adminMenu.style.display = 'inline-block';
              const adminCsvButtons = document.getElementById('admin-csv-buttons');
              if (adminCsvButtons) adminCsvButtons.style.display = 'flex';
            }
          }

          // CSVファイル読み込みイベント
          const csvFileInput = document.getElementById('csv-file');
          if (csvFileInput) {
            csvFileInput.addEventListener('change', function(event) {
              const file = event.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = function(e) {
                const csv = e.target.result;
                const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
                
                if (lines.length < 2) {
                  alert('CSVファイルが空です');
                  document.getElementById('import-button').disabled = true;
                  return;
                }

                // プレビュー表示（最初の6行）
                const previewLines = lines.slice(0, 6);
                let previewHTML = '<table class="min-w-full text-xs"><tbody>';
                previewLines.forEach((line, index) => {
                  if (index === 0) {
                    previewHTML += '<tr class="bg-gray-100 font-bold"><td class="px-2 py-1" colspan="100">ヘッダー: ' + line + '</td></tr>';
                  } else {
                    previewHTML += '<tr><td class="px-2 py-1">' + line + '</td></tr>';
                  }
                });
                previewHTML += '</tbody></table>';
                previewHTML += '<p class="mt-2 text-sm text-gray-600">総件数: ' + (lines.length - 1) + '件</p>';
                
                document.getElementById('import-preview').innerHTML = previewHTML;
                document.getElementById('import-button').disabled = false;
              };
              reader.readAsText(file);
            });
          }

          // 入金CSVファイル読み込みイベント
          const paymentCsvFileInput = document.getElementById('payment-csv-file');
          if (paymentCsvFileInput) {
            paymentCsvFileInput.addEventListener('change', function(event) {
              const file = event.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = function(e) {
                const csv = e.target.result;
                const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
                
                if (lines.length < 2) {
                  alert('CSVファイルが空です');
                  document.getElementById('payment-import-button').disabled = true;
                  return;
                }

                // プレビュー表示（最初の6行）
                const previewLines = lines.slice(0, 6);
                let previewHTML = '<table class="min-w-full text-xs"><tbody>';
                previewLines.forEach((line, index) => {
                  if (index === 0) {
                    previewHTML += '<tr class="bg-gray-100 font-bold"><td class="px-2 py-1" colspan="100">ヘッダー: ' + line + '</td></tr>';
                  } else {
                    previewHTML += '<tr><td class="px-2 py-1">' + line + '</td></tr>';
                  }
                });
                previewHTML += '</tbody></table>';
                previewHTML += '<p class="mt-2 text-sm text-gray-600">総件数: ' + (lines.length - 1) + '件</p>';
                
                document.getElementById('payment-import-preview').innerHTML = previewHTML;
                document.getElementById('payment-import-button').disabled = false;
              };
              reader.readAsText(file);
            });
          }
        });


        // 月次明細削除確認
        async function confirmDeleteMonthlyDetail(monthlyDetailId, targetMonth, contractName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/monthly-details/' + monthlyDetailId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ 月次明細: ' + targetMonth + ' - ' + contractName + '\\n';
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '\\n■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/monthly-details/' + monthlyDetailId, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            
            if (deleteResponse.data.success) {
              alert('削除しました');
              location.reload();
            }
          } catch (error) {
            alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // CSVエクスポート
        async function exportCSV() {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/monthly-details/export/csv', {
              headers: { 'Authorization': 'Bearer ' + token },
              responseType: 'blob'
            });
            
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'monthly_details.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
          } catch (error) {
            alert('エクスポートに失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // CSVインポートモーダル
        function openImportModal() {
          document.getElementById('import-modal').classList.remove('hidden');
        }

        function closeImportModal() {
          document.getElementById('import-modal').classList.add('hidden');
          document.getElementById('csv-file').value = '';
          document.getElementById('import-preview').innerHTML = '';
          document.getElementById('import-button').disabled = true;
        }

        // CSVインポート実行
        async function importMonthlyDetailsCSV() {
          const file = document.getElementById('csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('CSVファイルをインポートしますか？\\n既存の月次明細データが更新されます（新規追加はできません）。')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const monthly_details = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                id: parseInt(values[0]) || 0,
                target_month: values[1] || '',
                contract_name: values[2] || '',
                project_name: values[3] || '',
                company_name: values[4] || '',
                amount: parseInt(values[5]) || 0,
                billing_status: values[6] || '未請求',
                billing_date: values[7] || '',
                invoice_number: values[8] || '',
                expected_payment_date: values[9] || '',
                assign_members: values[10] || ''
              };
            });

            try {
              const token = AUTH_UTILS.getToken();
              const response = await axios.post('/api/monthly-details/import/csv', 
                { monthly_details },
                { headers: { 'Authorization': 'Bearer ' + token } }
              );
              
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の月次明細を更新しました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (ID: ' + err.id + ')';
                });
              }
              
              alert(message);
              
              if (success_count > 0) {
                location.reload();
              }
            } catch (error) {
              alert('インポートに失敗しました: ' + (error.response?.data?.error || error.message));
            }
          };
          reader.readAsText(file);
        }

        // 入金CSVインポートモーダル
        function openPaymentImportModal() {
          document.getElementById('payment-import-modal').classList.remove('hidden');
        }

        function closePaymentImportModal() {
          document.getElementById('payment-import-modal').classList.add('hidden');
          document.getElementById('payment-csv-file').value = '';
          document.getElementById('payment-import-preview').innerHTML = '';
          document.getElementById('payment-import-button').disabled = true;
        }

        // 入金CSVインポート実行
        async function importPaymentHistoriesCSV() {
          const file = document.getElementById('payment-csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('入金履歴をCSVからインポートしますか?\\n指定された月次明細に入金履歴が追加されます。')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const payment_histories = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                monthly_detail_id: parseInt(values[0]) || 0,
                payment_date: values[1] || '',
                payment_amount: parseInt(values[2]) || 0,
                note: values[3] || ''
              };
            });

            try {
              const token = AUTH_UTILS.getToken();
              const response = await axios.post('/api/payment-histories/import/csv', 
                { payment_histories },
                { headers: { 'Authorization': 'Bearer ' + token } }
              );
              
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の入金履歴を登録しました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (月次明細ID: ' + err.monthly_detail_id + ')';
                });
              }
              
              alert(message);
              
              if (success_count > 0) {
                closePaymentImportModal();
                location.reload();
              }
            } catch (error) {
              alert('インポートに失敗しました: ' + (error.response?.data?.error || error.message));
            }
          };
          reader.readAsText(file);
        }
      </script>
    </head>
    <body class="bg-gray-100">
      <nav class="bg-white shadow-lg">
        <div class="max-w-7xl mx-auto px-4">
          <div class="flex justify-between h-16">
            <div class="flex space-x-8">
              <div class="flex items-center space-x-4">
                <a href="/" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
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

      <div class="max-w-full mx-auto py-8 px-4">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-800">
            <i class="fas fa-calendar-alt mr-2"></i>月次明細一覧
          </h1>
          <div id="admin-csv-buttons" class="flex space-x-2" style="display:none;">
            <button onclick="exportCSV()" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
              <i class="fas fa-download mr-2"></i>CSVエクスポート
            </button>
            <button onclick="openImportModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              <i class="fas fa-upload mr-2"></i>明細CSVインポート
            </button>
            <button onclick="openPaymentImportModal()" class="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
              <i class="fas fa-money-bill-wave mr-2"></i>入金CSVインポート
            </button>
          </div>
        </div>



        <!-- フィルターバー -->
        <div class="bg-white p-4 rounded-lg shadow mb-4">
          <div class="flex flex-wrap gap-3 items-end">
            <div class="flex-1 min-w-[150px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">顧客名</label>
              <input type="text" id="filter-company" value="${filterCompany}" placeholder="検索..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" onkeydown="if(event.key==='Enter')applyFilter()">
            </div>
            <div class="flex-1 min-w-[150px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">案件名</label>
              <input type="text" id="filter-project" value="${filterProject}" placeholder="検索..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" onkeydown="if(event.key==='Enter')applyFilter()">
            </div>
            <div class="flex-1 min-w-[150px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">契約名</label>
              <input type="text" id="filter-contract" value="${filterContract}" placeholder="検索..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" onkeydown="if(event.key==='Enter')applyFilter()">
            </div>
            <div class="min-w-[120px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">請求</label>
              <select id="filter-billing" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">すべて</option>
                <option value="請求済" ${filterBilling === '請求済' ? 'selected' : ''}>請求済</option>
                <option value="未請求" ${filterBilling === '未請求' ? 'selected' : ''}>未請求</option>
              </select>
            </div>
            <div class="min-w-[120px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">入金</label>
              <select id="filter-payment" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">すべて</option>
                <option value="入金完了" ${filterPayment === '入金完了' ? 'selected' : ''}>入金完了</option>
                <option value="部分入金" ${filterPayment === '部分入金' ? 'selected' : ''}>部分入金</option>
                <option value="未入金" ${filterPayment === '未入金' ? 'selected' : ''}>未入金</option>
              </select>
            </div>
            <div class="min-w-[150px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">対象月</label>
              <input type="month" id="filter-month" value="${filterMonth}" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            </div>
            <div class="flex gap-2">
              <button onclick="applyFilter()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"><i class="fas fa-search mr-1"></i>検索</button>
              <button onclick="resetFilter()" class="text-gray-600 px-4 py-2 rounded text-sm border border-gray-300 hover:bg-gray-50"><i class="fas fa-times mr-1"></i>リセット</button>
            </div>
          </div>
        </div>

        ${monthlyDetails.length > 0 ? `
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-center" style="width: 50px;">
                  <input type="checkbox" onchange="toggleAll(this.checked)" class="w-4 h-4 text-blue-600 rounded">
                </th>
                <th data-sort="target_month" onclick="sortTable('target_month')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  対象月 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="contract_name" onclick="sortTable('contract_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 200px;">
                  契約名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="project_name" onclick="sortTable('project_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 180px;">
                  案件名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="company_name" onclick="sortTable('company_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 150px;">
                  会社名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="amount" onclick="sortTable('amount')" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  金額（税抜） <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="amount_with_tax" onclick="sortTable('amount_with_tax')" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  金額（税込） <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="billing_status" onclick="sortTable('billing_status')" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  請求 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="payment_status" onclick="sortTable('payment_status')" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  入金 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" style="min-width: 80px;">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${monthlyDetails.map(detail => `
                <tr class="hover:bg-blue-50 transition-colors">
                  <td class="px-6 py-4 whitespace-nowrap text-center" onclick="event.stopPropagation()">
                    <input type="checkbox" value="${detail.id}" onchange="toggleDetail(${detail.id}, this.checked)" class="detail-checkbox w-4 h-4 text-blue-600 rounded">
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.target_month}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.contract_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.project_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.company_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ¥${detail.amount?.toLocaleString() || '0'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ¥${detail.amount_with_tax?.toLocaleString() || '0'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      detail.billing_status === '請求済' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                    }">
                      ${detail.billing_status || '未請求'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      detail.payment_status === '入金済' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                    }">
                      ${detail.payment_status || '未入金'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <a href="/monthly/${detail.id}" class="text-blue-600 hover:text-blue-900" onclick="event.stopPropagation()">
                      <i class="fas fa-eye mr-1"></i>詳細
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>月次明細がまだありません</p>
        </div>
        `}
      </div>

      <!-- CSVインポートモーダル -->
      <div id="import-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium">CSVインポート</h3>
            <button onclick="closeImportModal()" class="text-gray-400 hover:text-gray-600">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="mb-4">
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: ID,対象月,契約名,案件名,会社名,金額,請求ステータス,請求日,請求書番号,入金予定日,アサインメンバー(メール:単価:稼働率;で区切る)<br><span class="text-gray-400 text-xs">※ エクスポートCSVには検収日列が含まれますが、インポート時は無視されます（IDで既存レコードを更新）</span></p>
            <p class="text-sm text-red-600 mb-2">※既存データの更新のみ可能です（新規追加はできません）</p>
            <p class="text-sm text-gray-500 mb-2">例: 1,2026-01,Q1契約,開発案件,株式会社テスト,1000000,請求済,2026-02-01,INV-001,2026-02-28,yamada@example.com:800000:0.8;sato@example.com:700000:1.0</p>
            <input type="file" id="csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closeImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="import-button" onclick="importMonthlyDetailsCSV()" disabled class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400">
              インポート実行
            </button>
          </div>
        </div>
      </div>

      <!-- 入金CSVインポートモーダル -->
      <div id="payment-import-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium">入金履歴CSVインポート</h3>
            <button onclick="closePaymentImportModal()" class="text-gray-400 hover:text-gray-600">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="mb-4">
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: 月次明細ID,入金日(YYYY-MM-DD),入金金額,備考</p>
            <p class="text-sm text-blue-600 mb-2">※月次明細IDは月次明細一覧画面で確認できます（CSVエクスポートで確認可能）</p>
            <p class="text-sm text-gray-500 mb-2">例: 1,2026-02-28,1000000,振込手数料込み</p>
            <input type="file" id="payment-csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="payment-import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closePaymentImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="payment-import-button" onclick="importPaymentHistoriesCSV()" disabled class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400">
              入金履歴インポート
            </button>
          </div>
        </div>
      </div>
    </body>
    </html>
  `)
})


export default app
