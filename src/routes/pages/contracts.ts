import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/contracts/:id', async (c) => {
  const id = c.req.param('id')
  const tab = c.req.query('tab') || 'monthly' // デフォルトは月次明細タブ
  
  // 契約情報と案件情報を取得
  const contract = await c.env.DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      p.lead_id,
      l.company_name
    FROM contracts c
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE c.id = ?
  `).bind(id).first()
  
  if (!contract) return c.notFound()

  // 月次明細を取得（実際の入金履歴から集計）
  const monthlyDetails = await c.env.DB.prepare(`
    SELECT 
      md.*,
      COALESCE(SUM(ph.payment_amount), 0) as paid_amount
    FROM monthly_details md
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    WHERE md.contract_id = ?
    GROUP BY md.id, md.target_month, md.contract_id, md.amount, md.amount_with_tax,
             md.billing_status, md.billing_date, md.invoice_number, 
             md.expected_payment_date, md.payment_status, md.payment_date, 
             md.total_payment_amount, md.name, md.notes, md.created_at, md.updated_at
    ORDER BY md.target_month ASC
  `).bind(id).all()

  // 各月次明細のアサインメンバーを取得
  for (const md of monthlyDetails.results) {
    const monthlyMembers = await c.env.DB.prepare(`
      SELECT 
        mma.*,
        m.name as member_name,
        m.email
      FROM monthly_member_assignments mma
      JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
      ORDER BY mma.allocation_ratio DESC
    `).bind(md.id).all()
    
    md.assigned_members = monthlyMembers.results
  }

  // アサインされたメンバーを取得（契約全体）
  const members = await c.env.DB.prepare(`
    SELECT 
      cma.*,
      m.name as member_name,
      m.email
    FROM contract_member_assignments cma
    JOIN members m ON cma.member_id = m.id
    WHERE cma.contract_id = ?
    ORDER BY cma.allocation_ratio DESC
  `).bind(id).all()

  // 統計情報を計算
  const totalAmount = monthlyDetails.results.reduce((sum, md) => sum + (md.amount || 0), 0)
  const paidAmount = monthlyDetails.results.reduce((sum, md) => sum + (md.paid_amount || 0), 0)
  const billedCount = monthlyDetails.results.filter(md => md.billing_status === '請求済').length

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>契約詳細 - ${contract.contract_name}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
        <script>
          // 認証チェック用のユーティリティ関数（インライン定義）

          // ナビゲーションバーユーティリティ
          const NAVBAR = {
            showPermissionError: function(requiredPermission) {
              const label = AUTH_UTILS.PERMISSION_LABELS[requiredPermission] || requiredPermission;
              alert('この操作を行う権限がありません。' + String.fromCharCode(10) + '必要な権限: ' + label + String.fromCharCode(10) + String.fromCharCode(10) + '管理者に権限の付与を依頼してください。');
            }
          };
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
                  <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
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

        <div class="max-w-7xl mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/leads/${contract.lead_id}" class="text-blue-600 hover:text-blue-800">${contract.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/detail/${contract.project_id}" class="text-blue-600 hover:text-blue-800">${contract.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">${contract.contract_name}</span>
            </div>

            <!-- 契約基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-file-contract mr-2 text-blue-600"></i><span id="contract-name-display">${contract.contract_name}</span>
                        </h1>
                        <p class="text-gray-600">
                            <i class="fas fa-calendar-alt mr-2"></i>
                            ${contract.contract_start_date} 〜 ${contract.contract_end_date}
                        </p>
                    </div>
                    <div class="flex items-center space-x-3">
                        <span id="contract-status-display" class="px-3 py-1 rounded-full text-sm font-semibold ${
                          contract.status === 'active' ? 'bg-green-100 text-green-800' :
                          contract.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                          contract.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }">
                            ${contract.status === 'active' ? '進行中' :
                              contract.status === 'completed' ? '完了' :
                              contract.status === 'cancelled' ? 'キャンセル' : contract.status}
                        </span>
                        <button id="edit-contract-button" onclick="openEditModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <i class="fas fa-edit mr-2"></i>編集
                        </button>
                    </div>
                </div>

                <!-- 契約詳細情報 -->
                <div class="grid grid-cols-3 gap-4 mb-6 border-t border-b border-gray-200 py-4">
                    <div>
                        <p class="text-sm text-gray-600 mb-1">契約種別</p>
                        <p class="text-base font-semibold text-gray-800">${contract.contract_type || '準委任'}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600 mb-1">契約日</p>
                        <p class="text-base font-semibold text-gray-800">${contract.contract_date || '-'}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600 mb-1">契約期間</p>
                        <p class="text-base font-semibold text-gray-800">${contract.contract_start_date} 〜 ${contract.contract_end_date}</p>
                    </div>
                </div>

                <!-- サマリーカード -->
                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">契約金額</p>
                        <p class="text-2xl font-bold text-blue-600">¥${totalAmount.toLocaleString()}</p>
                    </div>
                    <div class="bg-orange-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">請求済</p>
                        <p class="text-2xl font-bold text-orange-600">${billedCount}/${monthlyDetails.results.length}件</p>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">入金済</p>
                        <p class="text-2xl font-bold text-purple-600">¥${paidAmount.toLocaleString()}</p>
                    </div>
                </div>

                ${contract.notes ? `
                <div class="border-t pt-4">
                    <label class="text-sm text-gray-600 font-medium">備考</label>
                    <p class="text-gray-800 mt-1 whitespace-pre-wrap">${contract.notes}</p>
                </div>
                ` : ''}
            </div>

            <!-- 月次明細 -->
            <div class="bg-white rounded-lg shadow-md mb-6">
                <div class="border-b border-gray-200 px-6 py-4">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-calendar-check mr-2"></i>月次明細 (${monthlyDetails.results.length})
                    </h2>
                </div>

                <!-- コンテンツ -->
                <div class="p-6">
                    
                    <!-- 月次明細タブ -->
                    ${monthlyDetails.results.length > 0 ? `
                    <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">月次明細</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額（税抜）</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額（税込）</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">アサインメンバー</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">請求</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">入金</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            ${monthlyDetails.results.map(md => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium">${md.name || md.target_month}</td>
                                <td class="px-4 py-3">¥${(md.amount || 0).toLocaleString()}</td>
                                <td class="px-4 py-3 font-semibold text-blue-600">¥${(md.amount_with_tax || 0).toLocaleString()}</td>
                                <td class="px-4 py-3">
                                    ${md.assigned_members && md.assigned_members.length > 0 
                                      ? md.assigned_members.map(m => 
                                          `<div class="flex items-center gap-2 mb-1">
                                            <span class="text-sm text-gray-700">${m.member_name}</span>
                                            <span class="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-800">${(m.allocation_ratio * 100).toFixed(0)}%</span>
                                          </div>`
                                        ).join('')
                                      : '<span class="text-xs text-gray-400">未割当</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    ${md.billing_status === '請求済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800"><i class="fas fa-file-invoice mr-1"></i>済</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">未</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    ${(md.paid_amount || 0) > 0
                                      ? `<span class="text-green-600 font-medium">¥${(md.paid_amount || 0).toLocaleString()}</span>`
                                      : '<span class="text-gray-400">-</span>'
                                    }
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex items-center space-x-2">
                                        <a href="/monthly/${md.id}" class="text-blue-600 hover:text-blue-800">
                                            <i class="fas fa-edit mr-1"></i>詳細
                                        </a>
                                        <button onclick="confirmDeleteMonthlyDetail(${md.id}, '${md.target_month}')" class="text-red-600 hover:text-red-800 admin-only-button" style="display:none;">
                                            <i class="fas fa-trash-alt mr-1"></i>削除
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    </div>
                    ` : `
                    <div class="text-center py-12 text-gray-500">
                        <i class="fas fa-calendar-times text-5xl mb-3"></i>
                        <p class="text-lg">月次明細がありません</p>
                    </div>
                    `}
                </div>
            </div>
        </div>

        <!-- 契約編集モーダル -->
        <div id="edit-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-edit mr-2"></i>契約編集
                </h3>
                
                <!-- 成功・エラーメッセージ -->
                <div id="modal-success-message" class="hidden bg-green-50 border-l-4 border-green-400 p-4 mb-4">
                    <p class="text-sm text-green-700">
                        <i class="fas fa-check-circle mr-2"></i>
                        <span id="modal-success-text"></span>
                    </p>
                </div>
                <div id="modal-error-message" class="hidden bg-red-50 border-l-4 border-red-400 p-4 mb-4">
                    <p class="text-sm text-red-700">
                        <i class="fas fa-exclamation-circle mr-2"></i>
                        <span id="modal-error-text"></span>
                    </p>
                </div>

                <form id="edit-contract-form" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">契約名</label>
                        <input type="text" id="edit-contract-name" required
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            value="${contract.contract_name}">
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">契約種別</label>
                            <select id="edit-contract-type" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="準委任" ${contract.contract_type === '準委任' ? 'selected' : ''}>準委任</option>
                                <option value="請負" ${contract.contract_type === '請負' ? 'selected' : ''}>請負</option>
                                <option value="派遣" ${contract.contract_type === '派遣' ? 'selected' : ''}>派遣</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">契約日</label>
                            <input type="date" id="edit-contract-date"
                                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                value="${contract.contract_date || ''}">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">支払種別</label>
                        <select id="edit-payment-type" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <option value="毎月支払" ${(contract.payment_type || '毎月支払') === '毎月支払' ? 'selected' : ''}>毎月支払</option>
                            <option value="初回全額支払" ${contract.payment_type === '初回全額支払' ? 'selected' : ''}>初回全額支払</option>
                        </select>
                        <p class="text-xs text-gray-500 mt-1">
                            <span class="font-medium">毎月支払:</span> 契約金額を月数で均等割（端数は初月）<br>
                            <span class="font-medium">初回全額支払:</span> 初月に全額、2ヶ月目以降は0円
                        </p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">ステータス</label>
                        <select id="edit-status" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <option value="active" ${contract.status === 'active' ? 'selected' : ''}>進行中</option>
                            <option value="completed" ${contract.status === 'completed' ? 'selected' : ''}>完了</option>
                            <option value="suspended" ${contract.status === 'suspended' ? 'selected' : ''}>一時停止</option>
                            <option value="cancelled" ${contract.status === 'cancelled' ? 'selected' : ''}>キャンセル</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">備考</label>
                        <textarea id="edit-notes" rows="4"
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">${contract.notes || ''}</textarea>
                    </div>

                    <div class="flex space-x-3 pt-4">
                        <button type="submit" class="flex-1 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
                            <i class="fas fa-save mr-2"></i>保存
                        </button>
                        <button type="button" onclick="closeEditModal()" class="flex-1 py-2 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400">
                            キャンセル
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            const CONTRACT_ID = ${id};
            let currentUser = null;

            // ユーザー情報を取得
            async function loadUserInfo() {
                currentUser = await AUTH_UTILS.getCurrentUser();
                if (!currentUser) return;

                // ナビゲーションのユーザー名を更新
                const userDisplayName = document.getElementById('user-display-name');
                if (userDisplayName) {
                    userDisplayName.textContent = currentUser.name;
                }

                // 権限に応じて編集ボタンの表示/非表示を制御
                const editButton = document.getElementById('edit-contract-button');
                if (editButton && !AUTH_UTILS.hasPermission(currentUser, 'contract_manage')) {
                    editButton.style.display = 'none';
                }

                // 管理者の場合、削除ボタンを表示
                if (currentUser.role === 'admin') {
                    const deleteButtons = document.querySelectorAll('.admin-only-button');
                    deleteButtons.forEach(btn => btn.style.display = 'inline-block');
                }
            }

            // 月次明細削除確認（グローバルスコープに公開）
            window.confirmDeleteMonthlyDetail = async function(monthlyDetailId, targetMonth) {
                if (!currentUser || currentUser.role !== 'admin') {
                    alert('管理者権限が必要です');
                    return;
                }

                try {
                    const token = AUTH_UTILS.getToken();
                    const response = await axios.get(\`/api/monthly-details/\${monthlyDetailId}/delete-impact\`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });

                    const impact = response.data.impact;
                    
                    let message = '以下のデータを完全に削除します：\\n\\n';
                    message += '■ 月次明細: ' + targetMonth + '\\n';
                    message += '  - 契約名: ' + (impact.monthly_detail.contract_name || '-') + '\\n';
                    message += '  - 案件名: ' + (impact.monthly_detail.project_name || '-') + '\\n';
                    message += '  - 金額: ¥' + (impact.monthly_detail.amount || 0).toLocaleString() + '\\n';
                    
                    if (impact.member_assignments_count > 0) {
                        message += '\\n■ メンバーアサイン: ' + impact.member_assignments_count + '件\\n';
                        impact.member_assignments.forEach(ma => {
                            message += '  - ' + ma.member_name + ' (単価: ¥' + (ma.unit_price || 0).toLocaleString() + 
                                     ', 稼働率: ' + ((ma.allocation_ratio || 0) * 100).toFixed(0) + '%)\\n';
                        });
                    }
                    
                    if (impact.payment_histories_count > 0) {
                        message += '\\n■ 入金履歴: ' + impact.payment_histories_count + '件\\n';
                        impact.payment_histories.forEach(ph => {
                            message += '  - ' + ph.payment_date + ': ¥' + (ph.payment_amount || 0).toLocaleString() + 
                                     (ph.note ? ' (' + ph.note + ')' : '') + '\\n';
                        });
                    }

                    if (impact.change_histories_count > 0) {
                        message += '\\n■ 変更履歴: ' + impact.change_histories_count + '件\\n';
                    }
                    
                    message += '\\nこの操作は取り消せません。本当に削除しますか？';
                    
                    if (!confirm(message)) return;
                    
                    const deleteResponse = await axios.delete(\`/api/monthly-details/\${monthlyDetailId}\`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    
                    if (deleteResponse.data.success) {
                        alert('月次明細を削除しました');
                        location.reload();
                    }
                } catch (error) {
                    alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
                }
            }


            // 編集モーダルを開く（グローバルスコープに公開）
            window.openEditModal = function() {
                if (!currentUser) {
                    alert('ユーザー情報の読み込み中です。少々お待ちください。');
                    return;
                }
                if (!AUTH_UTILS.hasPermission(currentUser, 'contract_manage')) {
                    NAVBAR.showPermissionError('contract_manage');
                    return;
                }
                document.getElementById('edit-modal').classList.remove('hidden');
            }

            // 編集モーダルを閉じる（グローバルスコープに公開）
            window.closeEditModal = function() {
                document.getElementById('edit-modal').classList.add('hidden');
                document.getElementById('modal-success-message').classList.add('hidden');
                document.getElementById('modal-error-message').classList.add('hidden');
            }

            // 契約を更新
            document.getElementById('edit-contract-form').addEventListener('submit', async (e) => {
                e.preventDefault();

                const contractName = document.getElementById('edit-contract-name').value;
                const contractType = document.getElementById('edit-contract-type').value;
                const contractDate = document.getElementById('edit-contract-date').value;
                const status = document.getElementById('edit-status').value;
                const notes = document.getElementById('edit-notes').value;
                const paymentType = document.getElementById('edit-payment-type').value;

                const errorDiv = document.getElementById('modal-error-message');
                const successDiv = document.getElementById('modal-success-message');
                errorDiv.classList.add('hidden');
                successDiv.classList.add('hidden');

                try {
                    const response = await axios.put(\`/api/contracts/\${CONTRACT_ID}\`, {
                        contract_name: contractName,
                        contract_type: contractType,
                        contract_date: contractDate || null,
                        status: status,
                        notes: notes,
                        payment_type: paymentType
                    });

                    document.getElementById('modal-success-text').textContent = response.data.message;
                    successDiv.classList.remove('hidden');

                    // 画面の表示を更新
                    document.getElementById('contract-name-display').textContent = contractName;
                    
                    // ステータス表示を更新
                    const statusDisplay = document.getElementById('contract-status-display');
                    const statusLabels = {
                        'active': '進行中',
                        'completed': '完了',
                        'suspended': '一時停止',
                        'cancelled': 'キャンセル'
                    };
                    const statusColors = {
                        'active': 'bg-green-100 text-green-800',
                        'completed': 'bg-gray-100 text-gray-800',
                        'suspended': 'bg-yellow-100 text-yellow-800',
                        'cancelled': 'bg-red-100 text-red-800'
                    };
                    statusDisplay.className = 'px-3 py-1 rounded-full text-sm font-semibold ' + statusColors[status];
                    statusDisplay.textContent = statusLabels[status];

                    setTimeout(() => {
                        closeEditModal();
                        window.location.reload();
                    }, 1500);
                } catch (error) {
                    document.getElementById('modal-error-text').textContent = error.response?.data?.error || '契約の更新に失敗しました';
                    errorDiv.classList.remove('hidden');
                }
            });

            // DOMContentLoaded後にloadUserInfoを実行
            document.addEventListener('DOMContentLoaded', function() {
                AUTH_UTILS.checkAuth();
                AUTH_UTILS.setupAxios();
                loadUserInfo();
            });
        </script>
    </body>
    </html>
  `)
})

app.get('/contracts', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'created_at'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['contract_name', 'project_name', 'company_name', 'monthly_count', 'total_amount', 'created_at']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // 全契約を取得（案件・リード情報を含む）
  const { results: contracts } = await DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      l.company_name,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count,
      (SELECT SUM(amount) FROM monthly_details WHERE contract_id = c.id) as total_amount
    FROM contracts c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY ${sortColumn} ${order}
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>契約一覧 - SFA</title>
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
          
          window.location.href = '/contracts?sortBy=' + column + '&sortOrder=' + newOrder;
        }

        document.addEventListener('DOMContentLoaded', async function() {
          AUTH_UTILS.checkAuth();
          AUTH_UTILS.setupAxios();
          const user = await AUTH_UTILS.getCurrentUser();
          console.log('Contracts page - Current user:', user);
          if (user) {
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) {
              navUserName.textContent = user.name;
            }
            if (user.role === 'admin') {
              console.log('User is admin, showing buttons');
              const adminMenu = document.getElementById('admin-menu');
              if (adminMenu) adminMenu.style.display = '';
              const csvExportButton = document.getElementById('csv-export-button');
              const csvImportButton = document.getElementById('csv-import-button');
              if (csvExportButton) {
                csvExportButton.style.display = '';
                console.log('CSV export button shown');
              } else {
                console.log('CSV export button not found');
              }
              if (csvImportButton) {
                csvImportButton.style.display = '';
                console.log('CSV import button shown');
              } else {
                console.log('CSV import button not found');
              }
            } else {
              console.log('User role:', user ? user.role : 'none');
            }
          } else {
            console.log('No user data received');
          }
        });

        // CSVエクスポート機能
        async function exportContractsCSV() {
          try {
            const response = await axios.get('/api/contracts/export/csv', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'contracts.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
          } catch (error) {
            alert('CSVエクスポートに失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // CSVインポートモーダル
        function openImportModal() {
          document.getElementById('import-modal').style.display = 'block';
        }

        function closeImportModal() {
          document.getElementById('import-modal').style.display = 'none';
          document.getElementById('csv-file').value = '';
          document.getElementById('import-preview').innerHTML = '';
          document.getElementById('import-button').disabled = true;
        }

        // CSVファイル読み込み（DOMロード後に実行）
        document.addEventListener('DOMContentLoaded', function() {
          const csvFileInput = document.getElementById('csv-file');
          if (csvFileInput) {
            csvFileInput.addEventListener('change', function(e) {
              const file = e.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = function(event) {
                const csv = event.target.result;
                const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
                
                if (lines.length < 2) {
                  alert('CSVファイルが空です');
                  const importBtn = document.getElementById('import-button');
                  if (importBtn) importBtn.disabled = true;
                  return;
                }

                // プレビュー表示
                const preview = lines.slice(0, 6).map((line, idx) => {
                  if (idx === 0) return '<tr class="bg-gray-100"><td colspan="6" class="px-4 py-2 font-bold">ヘッダー: ' + line + '</td></tr>';
                  return '<tr><td colspan="6" class="px-4 py-2 text-sm">' + line + '</td></tr>';
                }).join('');
                
                const importPreview = document.getElementById('import-preview');
                if (importPreview) {
                  importPreview.innerHTML = '<table class="w-full border">' + preview + '</table><p class="mt-2 text-sm">総件数: ' + (lines.length - 1) + '件</p>';
                }
                
                const importBtn = document.getElementById('import-button');
                if (importBtn) importBtn.disabled = false;
              };
              reader.readAsText(file);
            });
          }
        });


        // 契約削除確認
        async function confirmDeleteContract(contractId, contractName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/contracts/' + contractId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ 契約: ' + contractName + '\\n';
            
            if (impact.monthly_details_count > 0) {
              message += '\\n■ 月次明細: ' + impact.monthly_details_count + '件\\n';
            }
            
            if (impact.contract_member_assignments_count > 0) {
              message += '■ 契約メンバーアサイン: ' + impact.contract_member_assignments_count + '件\\n';
            }
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/contracts/' + contractId, {
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

        // CSVインポート実行
        async function importContractsCSV() {
          const file = document.getElementById('csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('CSVファイルをインポートしますか？\\n契約期間から月次明細が自動生成され、メンバーアサイン（単価・稼働率込み）も登録されます。')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const contracts = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                contract_name: values[0] || '',
                project_name: values[1] || '',
                company_name: values[2] || '',
                department: values[3] || '',
                contract_type: values[4] || '準委任',
                contract_date: values[5] || '',
                contract_start_date: values[6] || '',
                contract_end_date: values[7] || '',
                contract_amount: parseInt(values[8]) || 0,
                payment_type: values[9] || '毎月支払',
                member_emails: values[10] || '',
                status: values[11] || 'active'
              };
            });

            try {
              const response = await axios.post('/api/contracts/import/csv', { contracts });
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の契約をインポートしました（月次明細とメンバーアサイン（単価・稼働率込み）も自動生成）';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (' + err.contract_name + ')';
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
                <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
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
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-file-contract mr-2"></i>契約一覧
          </h1>
          <div class="flex space-x-2">
            <button id="csv-export-button" onclick="exportContractsCSV()" class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700" style="display:none;">
              <i class="fas fa-file-download mr-2"></i>CSVエクスポート
            </button>
            <button id="csv-import-button" onclick="openImportModal()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700" style="display:none;">
              <i class="fas fa-file-upload mr-2"></i>CSVインポート
            </button>
          </div>
        </div>

        <!-- 契約一覧 -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <div class="overflow-x-auto">
          ${contracts.length > 0 ? `
          <table class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
            <thead class="bg-gray-50">
              <tr>
                <th data-sort="contract_name" onclick="sortTable('contract_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 200px;">
                  契約名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="project_name" onclick="sortTable('project_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 180px;">
                  案件/顧客 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="min-width: 180px;">
                  契約期間
                </th>
                <th data-sort="total_amount" onclick="sortTable('total_amount')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 150px;">
                  契約金額 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="monthly_count" onclick="sortTable('monthly_count')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  進捗 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="min-width: 100px;">
                  ステータス
                </th>
                  <th class="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider admin-only-column" style="display: none; min-width: 80px;">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${contracts.map((contract: any) => `
                <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/contracts/${contract.id}'">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="font-medium text-gray-900">${contract.contract_name}</div>
                    <div class="text-sm text-gray-500">${contract.monthly_count || 0}ヶ月</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">${contract.project_name || '-'}</div>
                    <div class="text-sm text-gray-500">${contract.company_name || '-'}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${contract.contract_start_date} 〜<br>${contract.contract_end_date}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">¥${(contract.contract_amount || 0).toLocaleString()}</div>
                    ${contract.total_amount !== contract.contract_amount ? 
                      '<div class="text-xs text-yellow-600">実績: ¥' + (contract.total_amount || 0).toLocaleString() + '</div>' 
                      : ''}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">
                      ${contract.monthly_count || 0}ヶ月
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                      <div class="bg-blue-600 h-2 rounded-full" style="width: 100%"></div>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${contract.status === 'active' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>進行中</span>' :
                      contract.status === 'completed' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-flag-checkered mr-1"></i>完了</span>' :
                      contract.status === 'terminated' ? 
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800"><i class="fas fa-times-circle mr-1"></i>終了</span>' :
                      '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-file mr-1"></i>下書き</span>'
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
          ` : `
          <div class="text-center py-12 text-gray-500">
            <i class="fas fa-inbox text-4xl mb-2"></i>
            <p>契約がまだありません</p>
          </div>
          `}
        </div>
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
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: 契約名,案件名,会社名,部署名,契約種別,契約日,契約開始日,契約終了日,契約金額,支払種別,アサインメンバー(メール:単価:稼働率;で区切る),ステータス</p>
            <p class="text-sm text-red-600 mb-2">※契約期間から月次明細が自動生成され、指定したメンバーが単価・稼働率込みで全月にアサインされます</p>
            <p class="text-sm text-gray-500 mb-2">例: Q1契約,案件A,株式会社テスト,営業部,準委任,2025-12-20,2026-01-01,2026-03-31,3000000,毎月支払,yamada@example.com:800000:0.8;sato@example.com:700000:1.0,active</p>
            <input type="file" id="csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closeImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="import-button" onclick="importContractsCSV()" disabled class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400">
              インポート実行
            </button>
          </div>
        </div>
      </div>
    </body>
    </html>
  `)
})


export default app
