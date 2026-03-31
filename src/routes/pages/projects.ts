import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/projects/detail/:id', async (c) => {
  const id = c.req.param('id')
  
  // 案件情報とリード情報、営業担当を取得
  const project = await c.env.DB.prepare(`
    SELECT p.*, l.company_name, l.contact_person, m.name as sales_rep_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    WHERE p.id = ?
  `).bind(id).first()
  
  if (!project) return c.notFound()

  // 関連する契約を取得
  const contracts = await c.env.DB.prepare(`
    SELECT 
      c.*,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count,
      (SELECT SUM(amount) FROM monthly_details WHERE contract_id = c.id) as total_amount
    FROM contracts c
    WHERE c.project_id = ?
    ORDER BY c.contract_start_date DESC
  `).bind(id).all()
  
  // アクティブなメンバー一覧を取得（編集モーダル用）
  const { results: members } = await c.env.DB.prepare(
    'SELECT id, name, email, default_unit_price FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>案件詳細 - ${project.project_name}</title>
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

        <div class="max-w-7xl mx-auto p-8">
            <div class="mb-6">
                <a href="/leads/${project.lead_id}" class="text-blue-600 hover:text-blue-800">
                    <i class="fas fa-arrow-left mr-2"></i>リード詳細に戻る
                </a>
            </div>

            <!-- 案件基本情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">
                            <i class="fas fa-folder-open mr-2 text-blue-600"></i><span id="project-name-display">${project.project_name}</span>
                        </h1>
                        <p class="text-gray-600">
                            <i class="fas fa-building mr-2"></i>${project.company_name}
                            ${project.contact_person ? ` / ${project.contact_person}` : ''}
                        </p>
                    </div>
                    <div class="flex items-center space-x-3">
                        <span id="project-status-display" class="px-3 py-1 rounded-full text-sm font-semibold ${
                          project.status === 'active' ? 'bg-green-100 text-green-800' :
                          project.status === 'won' ? 'bg-blue-100 text-blue-800' :
                          project.status === 'lost' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }">
                            ${project.status === 'active' ? '商談中' :
                              project.status === 'won' ? '受注' :
                              project.status === 'lost' ? '失注' : project.status}
                        </span>
                        <button onclick="openEditProjectModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <i class="fas fa-edit mr-2"></i>編集
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-sm text-gray-600">営業担当</label>
                        <p id="sales-rep-display" class="text-gray-800">
                            ${project.sales_rep_name ? `<i class="fas fa-user mr-1 text-blue-500"></i>${project.sales_rep_name}` : '<span class="text-gray-400">未設定</span>'}
                        </p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">ステータス</label>
                        <p class="text-gray-800">
                            ${project.status === 'active' ? '商談中' :
                              project.status === 'won' ? '受注' :
                              project.status === 'lost' ? '失注' :
                              project.status === 'archived' ? 'アーカイブ' : project.status}
                        </p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">見込み月額</label>
                        <p class="text-gray-800">
                            <i class="fas fa-yen-sign mr-1 text-green-500"></i>${(project.expected_monthly_amount || 0).toLocaleString()}
                        </p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">作成日</label>
                        <p class="text-gray-800">${project.created_at}</p>
                    </div>
                    <div>
                        <label class="text-sm text-gray-600">更新日</label>
                        <p class="text-gray-800">${project.updated_at}</p>
                    </div>
                </div>
            </div>

            <!-- 契約一覧 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-file-contract mr-2 text-blue-600"></i>契約一覧
                    </h2>
                    <button onclick="location.href='/projects/detail/${id}/contracts/new'" 
                            class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                        <i class="fas fa-plus mr-2"></i>契約を追加
                    </button>
                </div>

                ${contracts.results.length > 0 ? `
                <div class="grid grid-cols-1 gap-4">
                    ${contracts.results.map(contract => `
                    <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                         onclick="location.href='/contracts/${contract.id}'">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <h3 class="font-bold text-gray-800">${contract.contract_name}</h3>
                                <p class="text-sm text-gray-600">
                                    <i class="fas fa-calendar-alt mr-1"></i>${contract.contract_start_date} 〜 ${contract.contract_end_date}
                                </p>
                            </div>
                            <span class="px-2 py-1 rounded text-xs font-semibold ${
                              contract.status === 'active' ? 'bg-green-100 text-green-800' :
                              contract.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                              contract.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }">
                                ${contract.status === 'active' ? '進行中' :
                                  contract.status === 'completed' ? '完了' :
                                  contract.status === 'cancelled' ? 'キャンセル' : contract.status}
                            </span>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                            <div class="text-gray-600">
                                <i class="fas fa-calendar-alt mr-1"></i>
                                月次明細: ${contract.monthly_count}件
                            </div>
                            <div class="text-lg font-bold text-blue-600">
                                ¥${(contract.total_amount || 0).toLocaleString()}
                            </div>
                        </div>
                    </div>
                    `).join('')}
                </div>
                ` : `
                <div class="text-center py-12 text-gray-500">
                    <i class="fas fa-file-contract text-5xl mb-3"></i>
                    <p class="text-lg">まだ契約がありません</p>
                    <p class="text-sm mt-2">「契約を追加」ボタンから新しい契約を作成してください</p>
                </div>
                `}
            </div>
        </div>

        <!-- 見積書 -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-file-invoice mr-2 text-purple-600"></i>見積書
                </h3>
                <button onclick="openCreateQuoteModal()" class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
                    <i class="fas fa-plus mr-2"></i>見積書を作成
                </button>
            </div>

            <div id="quotes-list" class="space-y-3">
                <!-- 見積書は動的にロード -->
            </div>
        </div>

        <!-- 商談メモ -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-comments mr-2 text-green-600"></i>商談メモ
                </h3>
                <button onclick="openAddMeetingNoteModal()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                    <i class="fas fa-plus mr-2"></i>メモを追加
                </button>
            </div>

            <div id="meeting-notes-list" class="space-y-3">
                <!-- 商談メモは動的にロード -->
            </div>
        </div>
    </div>

    <!-- 商談メモ追加モーダル -->
    <div id="add-meeting-note-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-900">
                    <i class="fas fa-comments mr-2"></i>商談メモを追加
                </h3>
                <button onclick="closeAddMeetingNoteModal()" class="text-gray-400 hover:text-gray-500">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <form id="add-meeting-note-form" onsubmit="addMeetingNote(event)">
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        日付 <span class="text-red-500">*</span>
                    </label>
                    <input type="date" name="meeting_date" required
                        class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500">
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        メモ <span class="text-red-500">*</span>
                    </label>
                    <textarea name="note" required rows="5"
                        class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="商談の内容や重要なポイントを記録してください"></textarea>
                </div>
                
                <div class="flex justify-end space-x-3">
                    <button type="button" onclick="closeAddMeetingNoteModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                        キャンセル
                    </button>
                    <button type="submit" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                        <i class="fas fa-plus mr-2"></i>追加
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- 見積書作成モーダル -->
    <div id="create-quote-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden z-50">
        <div class="relative top-10 mx-auto p-5 border w-full max-w-4xl shadow-lg rounded-md bg-white">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-900">
                    <i class="fas fa-file-invoice mr-2 text-purple-600"></i>見積書を作成
                </h3>
                <button onclick="closeCreateQuoteModal()" class="text-gray-400 hover:text-gray-500">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <form id="create-quote-form" onsubmit="createQuote(event)">
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            件名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" name="subject" required
                            class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            発行日 <span class="text-red-500">*</span>
                        </label>
                        <input type="date" name="issue_date" required
                            class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            有効期限 <span class="text-red-500">*</span>
                        </label>
                        <input type="date" name="expiry_date" required
                            class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                </div>

                <!-- 見積明細 -->
                <div class="mb-4">
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-sm font-medium text-gray-700">
                            見積明細 <span class="text-red-500">*</span>
                        </label>
                        <button type="button" onclick="addQuoteItem()" 
                                class="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700">
                            <i class="fas fa-plus mr-1"></i>明細を追加
                        </button>
                    </div>
                    
                    <div id="quote-items" class="space-y-2">
                        <!-- 明細行は動的に追加 -->
                    </div>
                </div>

                <!-- 合計金額 -->
                <div class="bg-gray-50 p-4 rounded mb-4">
                    <div class="space-y-2 text-right">
                        <div class="flex justify-between">
                            <span class="text-gray-700">小計:</span>
                            <span id="quote-subtotal" class="font-semibold">¥0</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-700">消費税 (10%):</span>
                            <span id="quote-tax" class="font-semibold">¥0</span>
                        </div>
                        <div class="flex justify-between text-lg border-t pt-2">
                            <span class="text-gray-900 font-bold">合計:</span>
                            <span id="quote-total" class="font-bold text-purple-600">¥0</span>
                        </div>
                    </div>
                </div>

                <!-- 備考 -->
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        備考
                    </label>
                    <textarea name="notes" rows="3"
                        class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="支払い条件や納期などの補足情報を入力してください"></textarea>
                </div>
                
                <div class="flex justify-end space-x-3">
                    <button type="button" onclick="closeCreateQuoteModal()" 
                            class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                        キャンセル
                    </button>
                    <button type="submit" class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
                        <i class="fas fa-save mr-2"></i>見積書を保存
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- 案件編集モーダル -->
        <div id="edit-project-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-edit mr-2"></i>案件編集
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

                <form id="edit-project-form" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            案件名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" id="edit-project-name" required
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            value="${project.project_name}">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fas fa-user mr-1"></i>営業担当
                        </label>
                        <select id="edit-sales-rep-id" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <option value="">未設定</option>
                            ${members.map((member: any) => `
                              <option value="${member.id}" ${project.sales_rep_id === member.id ? 'selected' : ''}>
                                ${member.name}${member.email ? ` (${member.email})` : ''}
                              </option>
                            `).join('')}
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            ステータス <span class="text-red-500">*</span>
                        </label>
                        <select id="edit-status" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <option value="active" ${project.status === 'active' ? 'selected' : ''}>商談中</option>
                            <option value="won" ${project.status === 'won' ? 'selected' : ''}>受注</option>
                            <option value="lost" ${project.status === 'lost' ? 'selected' : ''}>失注</option>
                            <option value="archived" ${project.status === 'archived' ? 'selected' : ''}>アーカイブ</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fas fa-yen-sign mr-1"></i>見込み月額
                        </label>
                        <input type="number" id="edit-expected-monthly-amount" min="0" step="1000"
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            value="${project.expected_monthly_amount || 0}">
                        <p class="mt-1 text-xs text-gray-500">月額の見込み金額を入力してください（任意）</p>
                    </div>

                    <div class="flex space-x-3 pt-4">
                        <button type="submit" class="flex-1 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
                            <i class="fas fa-save mr-2"></i>保存
                        </button>
                        <button type="button" onclick="closeEditProjectModal()" class="flex-1 py-2 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400">
                            キャンセル
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
          const PROJECT_ID = ${id};
          const PROJECT_NAME = '${project.project_name.replace(/'/g, "\\'")}';
          
          // AUTH_UTILS - 認証ユーティリティ
          const AUTH_UTILS = {
            getToken: () => localStorage.getItem('jwt_token'),
            checkAuth: () => {
              if (!window.location.pathname.includes('/login') && !AUTH_UTILS.getToken()) {
                window.location.href = '/login';
              }
            },
            getCurrentUser: async () => {
              try {
                const response = await axios.get('/api/auth/me', {
                  headers: { 'Authorization': 'Bearer ' + AUTH_UTILS.getToken() }
                });
                return response.data.user;
              } catch (error) {
                console.error('Failed to get current user:', error);
                return null;
              }
            },
            logout: () => {
              localStorage.removeItem('jwt_token');
              window.location.href = '/login';
            },
            setupAxios: () => {
              const token = AUTH_UTILS.getToken();
              if (token) {
                axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
              }
            }
          };

          // ページロード時にAxiosセットアップ
          AUTH_UTILS.setupAxios();

          // ユーザー情報を取得してナビゲーションを更新（失敗してもページは表示）
          AUTH_UTILS.getCurrentUser().then(user => {
            if (user) {
              document.getElementById('nav-user-name').textContent = user.name;
              if (user.role === 'admin') {
                document.getElementById('admin-users-link').classList.remove('hidden');
              }
            } else {
              document.getElementById('nav-user-name').textContent = 'ゲスト';
            }
          }).catch(error => {
            console.error('Failed to load user info:', error);
            document.getElementById('nav-user-name').textContent = 'ゲスト';
          });
          
          // 編集モーダルを開く
          window.openEditProjectModal = function() {
            document.getElementById('edit-project-modal').classList.remove('hidden');
          }
          
          // 編集モーダルを閉じる
          window.closeEditProjectModal = function() {
            document.getElementById('edit-project-modal').classList.add('hidden');
            document.getElementById('modal-success-message').classList.add('hidden');
            document.getElementById('modal-error-message').classList.add('hidden');
          }
          
          // 案件を更新
          document.getElementById('edit-project-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const projectName = document.getElementById('edit-project-name').value;
            const salesRepId = document.getElementById('edit-sales-rep-id').value;
            const status = document.getElementById('edit-status').value;
            const expectedMonthlyAmount = parseInt(document.getElementById('edit-expected-monthly-amount').value) || 0;
            
            const errorDiv = document.getElementById('modal-error-message');
            const successDiv = document.getElementById('modal-success-message');
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            
            try {
              const response = await axios.put(\`/api/projects/\${PROJECT_ID}\`, {
                project_name: projectName,
                sales_rep_id: salesRepId || null,
                status: status,
                expected_monthly_amount: expectedMonthlyAmount
              });
              
              document.getElementById('modal-success-text').textContent = '案件を更新しました';
              successDiv.classList.remove('hidden');
              
              // 画面の表示を更新
              document.getElementById('project-name-display').textContent = projectName;
              
              // ステータス表示を更新
              const statusDisplay = document.getElementById('project-status-display');
              const statusLabels = {
                'active': '商談中',
                'won': '受注',
                'lost': '失注',
                'archived': 'アーカイブ'
              };
              const statusColors = {
                'active': 'bg-green-100 text-green-800',
                'won': 'bg-blue-100 text-blue-800',
                'lost': 'bg-red-100 text-red-800',
                'archived': 'bg-gray-100 text-gray-800'
              };
              statusDisplay.className = 'px-3 py-1 rounded-full text-sm font-semibold ' + statusColors[status];
              statusDisplay.textContent = statusLabels[status];
              
              // 営業担当表示を更新
              const salesRepSelect = document.getElementById('edit-sales-rep-id');
              const salesRepText = salesRepSelect.options[salesRepSelect.selectedIndex].text;
              const salesRepDisplay = document.getElementById('sales-rep-display');
              if (salesRepId) {
                salesRepDisplay.innerHTML = \`<i class="fas fa-user mr-1 text-blue-500"></i>\${salesRepText}\`;
              } else {
                salesRepDisplay.innerHTML = '<span class="text-gray-400">未設定</span>';
              }
              
              setTimeout(() => {
                closeEditProjectModal();
                window.location.reload();
              }, 1500);
            } catch (error) {
              document.getElementById('modal-error-text').textContent = error.response?.data?.error || '案件の更新に失敗しました';
              errorDiv.classList.remove('hidden');
            }
          });

          // 商談メモ関連の関数
          
          // 商談メモ一覧を読み込む
          async function loadMeetingNotes() {
            try {
              const response = await axios.get(\`/api/projects/\${PROJECT_ID}/meeting-notes\`);
              if (response.data.success) {
                const notes = response.data.data;
                const container = document.getElementById('meeting-notes-list');
                
                if (notes.length === 0) {
                  container.innerHTML = \`
                    <div class="text-center py-8 text-gray-500">
                      <i class="fas fa-comments text-4xl mb-2"></i>
                      <p>商談メモがまだありません</p>
                    </div>
                  \`;
                } else {
                  container.innerHTML = notes.map(note => \`
                    <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center space-x-2">
                          <i class="fas fa-calendar text-blue-500"></i>
                          <span class="text-sm font-medium text-gray-700">\${note.meeting_date}</span>
                        </div>
                        <button onclick="deleteMeetingNote(\${note.id})" class="text-red-600 hover:text-red-800 text-sm">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                      <p class="text-gray-800 whitespace-pre-wrap">\${note.note}</p>
                      <div class="mt-2 text-xs text-gray-500">
                        <i class="fas fa-user mr-1"></i>\${note.created_by} - \${new Date(note.created_at).toLocaleString('ja-JP')}
                      </div>
                    </div>
                  \`).join('');
                }
              }
            } catch (error) {
              console.error('商談メモの読み込みに失敗しました:', error);
            }
          }

          // 商談メモ追加モーダルを開く
          function openAddMeetingNoteModal() {
            document.getElementById('add-meeting-note-modal').classList.remove('hidden');
            // デフォルトで今日の日付を設定
            const today = new Date().toISOString().split('T')[0];
            document.querySelector('#add-meeting-note-form input[name="meeting_date"]').value = today;
          }

          // 商談メモ追加モーダルを閉じる
          function closeAddMeetingNoteModal() {
            document.getElementById('add-meeting-note-modal').classList.add('hidden');
            document.getElementById('add-meeting-note-form').reset();
          }

          // 商談メモを追加
          async function addMeetingNote(event) {
            event.preventDefault();
            const form = event.target;
            const formData = new FormData(form);
            const data = {
              project_id: PROJECT_ID,
              meeting_date: formData.get('meeting_date'),
              note: formData.get('note')
            };
            
            try {
              const response = await axios.post('/api/meeting-notes', data);
              if (response.data.success) {
                alert('商談メモを追加しました');
                closeAddMeetingNoteModal();
                loadMeetingNotes();
              }
            } catch (error) {
              alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
            }
          }

          // 商談メモを削除
          async function deleteMeetingNote(noteId) {
            if (!confirm('この商談メモを削除しますか？')) return;
            
            try {
              const response = await axios.delete(\`/api/meeting-notes/\${noteId}\`);
              if (response.data.success) {
                alert('商談メモを削除しました');
                loadMeetingNotes();
              }
            } catch (error) {
              alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
            }
          }

          // ページロード時に商談メモを読み込む
          loadMeetingNotes();
          
          // ========================================
          // 見積書管理機能
          // ========================================
          
          const quotesMembers = ${JSON.stringify(members)};
          console.log('Quotes Members:', quotesMembers);
          let quoteItemCounter = 0;
          
          // 見積書一覧を読み込む
          async function loadQuotes() {
            try {
              const response = await axios.get(\`/api/projects/\${PROJECT_ID}/quotes\`);
              const quotes = response.data.data || [];
              const list = document.getElementById('quotes-list');
              
              if (quotes.length === 0) {
                list.innerHTML = '<p class="text-gray-500 text-center py-4">見積書はまだありません</p>';
                return;
              }
              
              list.innerHTML = quotes.map(q => \`
                <div class="border border-gray-200 rounded p-3 hover:bg-gray-50">
                  <div class="flex justify-between items-start">
                    <div>
                      <div class="font-semibold text-gray-800">\${q.quote_number}</div>
                      <div class="text-sm text-gray-600">\${q.subject}</div>
                      <div class="text-xs text-gray-500 mt-1">
                        発行日: \${q.issue_date} / 有効期限: \${q.expiry_date || '未設定'}
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="font-bold text-purple-600">¥\${q.total.toLocaleString()}</div>
                      <button onclick="window.open('/quotes/\${q.id}/pdf', '_blank')" 
                              class="mt-1 text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700">
                        <i class="fas fa-file-pdf mr-1"></i>PDF
                      </button>
                    </div>
                  </div>
                </div>
              \`).join('');
            } catch (error) {
              console.error('見積書の読み込みに失敗:', error);
              document.getElementById('quotes-list').innerHTML = 
                '<p class="text-red-500 text-center py-4">見積書の読み込みに失敗しました</p>';
            }
          }
          
          // 見積書作成モーダルを開く
          window.openCreateQuoteModal = function() {
            document.getElementById('create-quote-modal').classList.remove('hidden');
            // 件名に案件名を自動入力
            document.querySelector('#create-quote-form input[name="subject"]').value = PROJECT_NAME;
            // 今日の日付をデフォルト設定
            const today = new Date().toISOString().split('T')[0];
            document.querySelector('#create-quote-form input[name="issue_date"]').value = today;
            // 1ヶ月後を有効期限のデフォルト
            const oneMonthLater = new Date();
            oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
            document.querySelector('#create-quote-form input[name="expiry_date"]').value = 
              oneMonthLater.toISOString().split('T')[0];
            // 初期明細を追加
            if (quoteItemCounter === 0) {
              addQuoteItem();
            }
          }
          
          // 見積書作成モーダルを閉じる
          window.closeCreateQuoteModal = function() {
            document.getElementById('create-quote-modal').classList.add('hidden');
            document.getElementById('create-quote-form').reset();
            document.getElementById('quote-items').innerHTML = '';
            quoteItemCounter = 0;
          }
          
          // 明細行を追加
          window.addQuoteItem = function() {
            quoteItemCounter++;
            const container = document.getElementById('quote-items');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'border border-gray-200 rounded-lg p-3 space-y-2';
            itemDiv.id = 'quote-item-' + quoteItemCounter;
            
            itemDiv.innerHTML = \`
              <div class="flex justify-between items-center mb-2">
                <span class="font-medium text-sm text-gray-700">明細 #\${quoteItemCounter}</span>
                <button type="button" onclick="removeQuoteItem(\${quoteItemCounter})" 
                        class="text-red-600 hover:text-red-700 text-sm">
                  <i class="fas fa-times"></i>
                </button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs text-gray-600 mb-1">メンバー</label>
                  <select class="quote-member w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                          onchange="updateMemberPrice(this, \${quoteItemCounter})">
                    <option value="">選択してください</option>
                    \${quotesMembers.map(m => \`<option value="\${m.id}" data-price="\${m.default_unit_price || 0}">\${m.name}</option>\`).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">品名 *</label>
                  <input type="text" class="quote-description w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                         placeholder="例: コンサルティング業務" required>
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">数量 *</label>
                  <input type="number" step="1" class="quote-quantity w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                         value="1" min="1" required onchange="calculateQuoteItem(\${quoteItemCounter})">
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">単位</label>
                  <input type="text" class="quote-unit w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                         value="人月">
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">稼働率 *</label>
                  <input type="number" step="0.01" class="quote-workload w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                         value="1.0" min="0" max="1" required onchange="calculateQuoteItem(\${quoteItemCounter})">
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">単価 *</label>
                  <input type="number" class="quote-unit-price w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                         value="0" min="0" required onchange="calculateQuoteItem(\${quoteItemCounter})">
                </div>
                <div>
                  <label class="block text-xs text-gray-600 mb-1">金額</label>
                  <input type="text" class="quote-amount w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50" 
                         value="¥0" readonly>
                </div>
              </div>
              <div>
                <label class="block text-xs text-gray-600 mb-1">備考</label>
                <input type="text" class="quote-note w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                       placeholder="例: 対応内容の詳細">
              </div>
            \`;
            
            container.appendChild(itemDiv);
            calculateQuoteTotal();
          }
          
          // メンバー選択時に単価を自動入力
          window.updateMemberPrice = function(select, itemId) {
            const selectedOption = select.options[select.selectedIndex];
            const price = selectedOption.getAttribute('data-price') || 0;
            console.log('Selected member:', selectedOption.text, 'Price:', price);
            const itemDiv = document.getElementById('quote-item-' + itemId);
            const priceInput = itemDiv.querySelector('.quote-unit-price');
            priceInput.value = price;
            calculateQuoteItem(itemId);
          }
          
          // 明細行を削除
          window.removeQuoteItem = function(itemId) {
            const itemDiv = document.getElementById('quote-item-' + itemId);
            itemDiv.remove();
            calculateQuoteTotal();
          }
          
          // 明細の金額を計算
          window.calculateQuoteItem = function(itemId) {
            const itemDiv = document.getElementById('quote-item-' + itemId);
            const quantity = parseInt(itemDiv.querySelector('.quote-quantity').value) || 0;
            const workload = parseFloat(itemDiv.querySelector('.quote-workload').value) || 0;
            const unitPrice = parseFloat(itemDiv.querySelector('.quote-unit-price').value) || 0;
            const amount = quantity * workload * unitPrice;
            
            itemDiv.querySelector('.quote-amount').value = '¥' + Math.floor(amount).toLocaleString();
            itemDiv.querySelector('.quote-amount').dataset.amount = Math.floor(amount);
            
            calculateQuoteTotal();
          }
          
          // 合計を計算
          window.calculateQuoteTotal = function() {
            const amounts = Array.from(document.querySelectorAll('.quote-amount'))
              .map(el => parseFloat(el.dataset.amount) || 0);
            
            const subtotal = amounts.reduce((sum, amount) => sum + amount, 0);
            const tax = Math.floor(subtotal * 0.1);
            const total = subtotal + tax;
            
            document.getElementById('quote-subtotal').textContent = '¥' + subtotal.toLocaleString();
            document.getElementById('quote-tax').textContent = '¥' + tax.toLocaleString();
            document.getElementById('quote-total').textContent = '¥' + total.toLocaleString();
          }
          
          // 見積書作成
          window.createQuote = async function(event) {
            event.preventDefault();
            const form = event.target;
            const formData = new FormData(form);
            
            // 明細を収集
            const items = [];
            document.querySelectorAll('[id^="quote-item-"]').forEach(itemDiv => {
              const memberSelect = itemDiv.querySelector('.quote-member');
              const memberId = memberSelect.value || null;
              const description = itemDiv.querySelector('.quote-description').value;
              const quantity = parseInt(itemDiv.querySelector('.quote-quantity').value);
              const workload = parseFloat(itemDiv.querySelector('.quote-workload').value);
              const unit = itemDiv.querySelector('.quote-unit').value;
              const unitPrice = parseFloat(itemDiv.querySelector('.quote-unit-price').value);
              const amount = parseFloat(itemDiv.querySelector('.quote-amount').dataset.amount);
              const note = itemDiv.querySelector('.quote-note').value;
              
              items.push({
                member_id: memberId,
                item_description: description,
                quantity: quantity,
                workload: workload,
                unit: unit,
                unit_price: unitPrice,
                amount: amount,
                note: note
              });
            });
            
            if (items.length === 0) {
              alert('明細を追加してください');
              return;
            }
            
            const data = {
              issue_date: formData.get('issue_date'),
              expiry_date: formData.get('expiry_date') || null,
              subject: formData.get('subject'),
              items: items,
              notes: formData.get('notes')
            };
            
            try {
              const response = await axios.post('/api/projects/' + PROJECT_ID + '/quotes', data);
              if (response.data.success) {
                const quoteId = response.data.data.id;
                const quoteNumber = response.data.data.quote_number;
                
                // モーダルを閉じる
                closeCreateQuoteModal();
                
                // 確認メッセージを表示して詳細画面へ遷移
                if (confirm(\`見積書を作成しました！\\n見積番号: \${quoteNumber}\\n\\n詳細画面を表示しますか？\`)) {
                  window.location.href = \`/quotes/\${quoteId}\`;
                } else {
                  loadQuotes();
                }
              }
            } catch (error) {
              alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
            }
          }
          
          // ページロード時に見積書を読み込む
          loadQuotes();
        </script>
    </body>
    </html>
  `)
})

app.get('/projects/detail/:projectId/contracts/new', async (c) => {
  const projectId = c.req.param('projectId')
  
  // 案件情報を取得
  const project = await c.env.DB.prepare(`
    SELECT p.*, l.company_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE p.id = ?
  `).bind(projectId).first()
  
  if (!project) return c.notFound()

  // アクティブなメンバー一覧を取得
  const { results: members } = await c.env.DB.prepare(`
    SELECT id, name, email, default_unit_price
    FROM members
    WHERE status = 'active'
    ORDER BY name ASC
  `).all()

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>契約作成 - ${project.project_name}</title>
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

        <div class="max-w-4xl mx-auto p-8">
            <!-- パンくずリスト -->
            <div class="mb-6 text-sm">
                <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/detail/${projectId}" class="text-blue-600 hover:text-blue-800">${project.project_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <span class="text-gray-700">契約作成</span>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
                <h1 class="text-2xl font-bold text-gray-800 mb-6">
                    <i class="fas fa-file-contract mr-2 text-blue-600"></i>新規契約作成
                </h1>
                
                <div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <p class="text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        契約期間と金額を入力すると、月次明細の金額配分テーブルが表示されます。各月の金額を編集できます。
                    </p>
                </div>

                <form id="contract-form" class="space-y-6">
                    <input type="hidden" name="project_id" value="${projectId}">

                    <!-- 案件情報表示 -->
                    <div class="bg-gray-50 rounded-lg p-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">案件</label>
                        <p class="text-gray-800 font-medium">${project.project_name}</p>
                        <p class="text-sm text-gray-600">${project.company_name}</p>
                    </div>

                    <!-- 契約名 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            契約名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" name="contract_name" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                               placeholder="例: Q1 2026 契約">
                    </div>

                    <!-- 契約種別、契約日、支払種別 -->
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                契約種別
                            </label>
                            <select name="contract_type"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="準委任">準委任</option>
                                <option value="請負">請負</option>
                                <option value="その他">その他</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                契約日
                            </label>
                            <input type="date" name="contract_date"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                支払種別 <span class="text-red-500">*</span>
                            </label>
                            <select name="payment_type" id="payment_type" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="毎月支払">毎月支払</option>
                                <option value="初回全額支払">初回全額支払</option>
                            </select>
                        </div>
                    </div>

                    <!-- 契約期間 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                開始日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="start_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                終了日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="end_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>

                    <!-- 契約金額と税率 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                契約金額（税抜・円） <span class="text-red-500">*</span>
                            </label>
                            <input type="number" id="contract_amount" name="contract_amount" required min="0" step="1"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                   placeholder="3000000">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                税率（%） <span class="text-red-500">*</span>
                            </label>
                            <input type="number" id="tax_rate" name="tax_rate" required min="0" max="100" step="0.1" value="10.0"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                   placeholder="10.0">
                            <p class="text-xs text-gray-500 mt-1">通常は10%（消費税）</p>
                        </div>
                    </div>

                    <!-- 税込み金額の表示 -->
                    <div class="bg-blue-50 rounded-lg p-4">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-medium text-gray-700">契約金額（税込）</span>
                            <span class="text-xl font-bold text-blue-600" id="contract_amount_with_tax">¥0</span>
                        </div>
                    </div>

                    <!-- 月次明細の金額配分 -->
                    <div id="monthly-breakdown-section" class="hidden border-t pt-6">
                        <h3 class="text-lg font-semibold text-gray-800 mb-4">
                            <i class="fas fa-calendar-alt mr-2 text-green-600"></i>月次明細の金額配分
                        </h3>
                        
                        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-700">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            各月の金額を編集できます。合計が契約金額と一致する必要があります。
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead class="bg-gray-100">
                                    <tr>
                                        <th class="px-4 py-2 text-left">対象月</th>
                                        <th class="px-4 py-2 text-right">金額（円）</th>
                                        <th class="px-4 py-2 text-left">備考（任意）</th>
                                    </tr>
                                </thead>
                                <tbody id="monthly-breakdown-body" class="bg-white">
                                    <!-- JavaScriptで動的生成 -->
                                </tbody>
                                <tfoot class="bg-gray-50 font-semibold">
                                    <tr>
                                        <td class="px-4 py-2">合計</td>
                                        <td class="px-4 py-2 text-right" id="monthly-total-amount">¥0</td>
                                        <td class="px-4 py-2" id="monthly-validation-status"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    <!-- 備考 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            備考
                        </label>
                        <textarea name="notes" rows="3"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                  placeholder="契約に関する補足情報"></textarea>
                    </div>

                    <!-- メンバーアサイン -->
                    <div class="border-t pt-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg font-semibold text-gray-800">
                                <i class="fas fa-users mr-2 text-indigo-600"></i>初期メンバーアサイン（任意）
                            </h3>
                            <button type="button" onclick="addMemberRow()" class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">
                                <i class="fas fa-plus mr-1"></i>メンバーを追加
                            </button>
                        </div>
                        
                        <div class="bg-blue-50 border-l-4 border-blue-400 p-3 mb-4 text-sm text-blue-700">
                            <i class="fas fa-info-circle mr-2"></i>
                            契約全期間に適用されるデフォルトのメンバーアサインを設定できます。後から月次明細ごとに変更も可能です。
                        </div>

                        <div id="members-container" class="space-y-3">
                            <!-- メンバー行が動的に追加される -->
                        </div>

                        <div id="allocation-warning" class="hidden bg-yellow-50 border-l-4 border-yellow-400 p-3 mt-4">
                            <p class="text-sm text-yellow-700">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
                                稼働率の合計: <span id="allocation-total">0</span>% （推奨: 100%）
                            </p>
                        </div>
                    </div>

                    <!-- プレビュー -->
                    <div id="preview" class="bg-gray-50 rounded-lg p-4 hidden">
                        <h3 class="text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-eye mr-2"></i>月次明細プレビュー
                        </h3>
                        <div id="preview-content" class="text-sm text-gray-600"></div>
                    </div>

                    <!-- ボタン -->
                    <div class="flex justify-end space-x-3">
                        <button type="button" onclick="location.href='/projects/detail/${projectId}'"
                                class="px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                            キャンセル
                        </button>
                        <button type="button" onclick="previewContract()"
                                class="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                            <i class="fas fa-eye mr-2"></i>プレビュー
                        </button>
                        <button type="submit"
                                class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <i class="fas fa-save mr-2"></i>契約を作成
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // AUTH_UTILS - 認証ユーティリティ
            const AUTH_UTILS = {
              getToken: () => localStorage.getItem('jwt_token'),
              checkAuth: () => {
                if (!window.location.pathname.includes('/login') && !AUTH_UTILS.getToken()) {
                  window.location.href = '/login';
                }
              },
              getCurrentUser: async () => {
                try {
                  const response = await axios.get('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + AUTH_UTILS.getToken() }
                  });
                  return response.data.user;
                } catch (error) {
                  console.error('Failed to get current user:', error);
                  return null;
                }
              },
              logout: () => {
                localStorage.removeItem('jwt_token');
                window.location.href = '/login';
              },
              setupAxios: () => {
                const token = AUTH_UTILS.getToken();
                if (token) {
                  axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
                }
              }
            };

            // ページロード時にAxiosセットアップ
            AUTH_UTILS.setupAxios();

            // ユーザー情報を取得してナビゲーションを更新（失敗してもページは表示）
            AUTH_UTILS.getCurrentUser().then(user => {
              if (user) {
                document.getElementById('nav-user-name').textContent = user.name;
                if (user.role === 'admin') {
                  document.getElementById('admin-users-link').classList.remove('hidden');
                }
              } else {
                document.getElementById('nav-user-name').textContent = 'ゲスト';
              }
            }).catch(error => {
              console.error('Failed to load user info:', error);
              document.getElementById('nav-user-name').textContent = 'ゲスト';
            });

            // メンバーデータ
            const members = ${JSON.stringify(members)}
            let memberRowIndex = 0
            
            // 月次明細データを保持
            let monthlyBreakdownData = []
            
            // 契約期間・金額・支払種別・税率変更時に月次明細テーブルを生成
            document.querySelector('input[name="start_date"]').addEventListener('change', generateMonthlyBreakdown)
            document.querySelector('input[name="end_date"]').addEventListener('change', generateMonthlyBreakdown)
            document.getElementById('contract_amount').addEventListener('change', updateTaxAmountAndBreakdown)
            document.getElementById('tax_rate').addEventListener('change', updateTaxAmountAndBreakdown)
            document.getElementById('payment_type').addEventListener('change', generateMonthlyBreakdown)
            
            // 税込み金額を更新する関数
            function updateTaxAmountAndBreakdown() {
                const contractAmount = parseInt(document.getElementById('contract_amount').value) || 0
                const taxRate = parseFloat(document.getElementById('tax_rate').value) || 0
                const amountWithTax = Math.round(contractAmount * (1 + taxRate / 100))
                
                document.getElementById('contract_amount_with_tax').textContent = '¥' + amountWithTax.toLocaleString()
                
                // 月次明細も再生成
                generateMonthlyBreakdown()
            }
            
            function generateMonthlyBreakdown() {
                const startDate = document.querySelector('input[name="start_date"]').value
                const endDate = document.querySelector('input[name="end_date"]').value
                const contractAmount = parseInt(document.getElementById('contract_amount').value) || 0
                const paymentType = document.getElementById('payment_type').value
                
                if (!startDate || !endDate || contractAmount === 0) {
                    document.getElementById('monthly-breakdown-section').classList.add('hidden')
                    return
                }
                
                // 月リストを生成
                const months = []
                const start = new Date(startDate)
                const end = new Date(endDate)
                
                if (start > end) {
                    alert('開始日は終了日より前である必要があります')
                    return
                }
                
                let current = new Date(start)
                while (current <= end) {
                    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
                    months.push(yearMonth)
                    current.setMonth(current.getMonth() + 1)
                }
                
                if (months.length === 0) {
                    document.getElementById('monthly-breakdown-section').classList.add('hidden')
                    return
                }
                
                // 支払種別に応じた金額配分
                let baseAmount, remainder
                if (paymentType === '初回全額支払') {
                    // 初回全額支払: 初月に全額、以降は0円
                    baseAmount = 0
                    remainder = contractAmount
                } else {
                    // 毎月支払: 均等割（端数は初月）
                    baseAmount = Math.floor(contractAmount / months.length)
                    remainder = contractAmount - (baseAmount * months.length)
                }
                
                // 月次明細データを初期化
                monthlyBreakdownData = months.map((month, index) => ({
                    month: month,
                    amount: index === 0 ? baseAmount + remainder : baseAmount,
                    note: ''
                }))
                
                // テーブルを描画
                renderMonthlyBreakdownTable()
                
                // セクションを表示
                document.getElementById('monthly-breakdown-section').classList.remove('hidden')
            }
            
            function renderMonthlyBreakdownTable() {
                const tbody = document.getElementById('monthly-breakdown-body')
                tbody.innerHTML = ''
                
                monthlyBreakdownData.forEach((data, index) => {
                    const row = document.createElement('tr')
                    row.className = 'border-b'
                    row.innerHTML = \`
                        <td class="px-4 py-2">\${data.month}</td>
                        <td class="px-4 py-2">
                            <input type="number" 
                                   data-index="\${index}"
                                   value="\${data.amount}"
                                   min="0"
                                   step="1"
                                   class="monthly-amount-input w-full px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-green-500"
                                   onchange="updateMonthlyAmount(\${index}, this.value)">
                        </td>
                        <td class="px-4 py-2">
                            <input type="text" 
                                   data-index="\${index}"
                                   value="\${data.note}"
                                   placeholder="例: 初月全額請求"
                                   class="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                   onchange="updateMonthlyNote(\${index}, this.value)">
                        </td>
                    \`
                    tbody.appendChild(row)
                })
                
                // 合計を更新
                updateMonthlyTotal()
            }
            
            function updateMonthlyAmount(index, value) {
                monthlyBreakdownData[index].amount = parseInt(value) || 0
                updateMonthlyTotal()
            }
            
            function updateMonthlyNote(index, value) {
                monthlyBreakdownData[index].note = value
            }
            
            function updateMonthlyTotal() {
                const contractAmount = parseInt(document.getElementById('contract_amount').value) || 0
                const total = monthlyBreakdownData.reduce((sum, data) => sum + data.amount, 0)
                
                document.getElementById('monthly-total-amount').textContent = '¥' + total.toLocaleString()
                
                const statusEl = document.getElementById('monthly-validation-status')
                if (total === contractAmount) {
                    statusEl.innerHTML = '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>一致</span>'
                } else {
                    const diff = contractAmount - total
                    statusEl.innerHTML = \`<span class="text-red-600"><i class="fas fa-times-circle mr-1"></i>差額: ¥\${diff.toLocaleString()}</span>\`
                }
            }

            // メンバー行を追加
            function addMemberRow() {
                const container = document.getElementById('members-container')
                const rowId = 'member-row-' + memberRowIndex++
                
                const row = document.createElement('div')
                row.id = rowId
                row.className = 'flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200'
                
                row.innerHTML = \`
                    <div class="flex-1">
                        <label class="block text-xs font-medium text-gray-700 mb-1">メンバー</label>
                        <select name="member_id[]" required class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500">
                            <option value="">選択してください</option>
                            \${members.map(m => \`<option value="\${m.id}">\${m.name} (¥\${(m.default_unit_price || 0).toLocaleString()}/月)</option>\`).join('')}
                        </select>
                    </div>
                    <div class="w-28">
                        <label class="block text-xs font-medium text-gray-700 mb-1">稼働率(%)</label>
                        <input type="number" name="allocation_ratio[]" required min="0" max="100" step="0.1" 
                               class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
                               placeholder="50" onchange="updateAllocationTotal()">
                    </div>
                    <div class="flex-1">
                        <label class="block text-xs font-medium text-gray-700 mb-1">単価(円/月)</label>
                        <input type="number" name="unit_price[]" required min="0" step="1000"
                               class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
                               placeholder="500000">
                    </div>
                    <div class="pt-6">
                        <button type="button" onclick="removeMemberRow('\${rowId}')" 
                                class="text-red-600 hover:text-red-800 text-sm">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                \`
                
                // メンバー選択時に単価を自動入力
                const select = row.querySelector('select[name="member_id[]"]')
                const priceInput = row.querySelector('input[name="unit_price[]"]')
                select.addEventListener('change', (e) => {
                    const selectedMember = members.find(m => m.id == e.target.value)
                    if (selectedMember) {
                        priceInput.value = selectedMember.default_unit_price || 0
                    }
                })
                
                container.appendChild(row)
                updateAllocationTotal()
            }

            // メンバー行を削除
            function removeMemberRow(rowId) {
                document.getElementById(rowId).remove()
                updateAllocationTotal()
            }

            // 稼働率合計を更新
            function updateAllocationTotal() {
                const inputs = document.querySelectorAll('input[name="allocation_ratio[]"]')
                let total = 0
                inputs.forEach(input => {
                    total += parseFloat(input.value) || 0
                })
                
                const totalSpan = document.getElementById('allocation-total')
                const warning = document.getElementById('allocation-warning')
                
                if (inputs.length > 0) {
                    totalSpan.textContent = total.toFixed(1)
                    warning.classList.remove('hidden')
                    
                    if (Math.abs(total - 100) < 0.1) {
                        warning.className = 'bg-green-50 border-l-4 border-green-400 p-3 mt-4'
                        warning.innerHTML = '<p class="text-sm text-green-700"><i class="fas fa-check-circle mr-2"></i>稼働率の合計: <span id="allocation-total">' + total.toFixed(1) + '</span>% （適切です）</p>'
                    } else {
                        warning.className = 'bg-yellow-50 border-l-4 border-yellow-400 p-3 mt-4'
                        warning.innerHTML = '<p class="text-sm text-yellow-700"><i class="fas fa-exclamation-triangle mr-2"></i>稼働率の合計: <span id="allocation-total">' + total.toFixed(1) + '</span>% （推奨: 100%）</p>'
                    }
                } else {
                    warning.classList.add('hidden')
                }
            }

            // プレビュー機能
            function previewContract() {
                const projectName = '${project.project_name}'
                const startDate = document.querySelector('input[name="start_date"]').value
                const endDate = document.querySelector('input[name="end_date"]').value
                const amount = parseInt(document.querySelector('input[name="contract_amount"]').value)

                if (!startDate || !endDate || !amount) {
                    alert('開始日、終了日、契約金額を入力してください')
                    return
                }

                // 月数を計算
                const start = new Date(startDate)
                const end = new Date(endDate)
                const months = []
                
                let current = new Date(start)
                while (current <= end) {
                    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
                    months.push(yearMonth)
                    current.setMonth(current.getMonth() + 1)
                }

                // 均等割
                const baseAmount = Math.floor(amount / months.length)
                const remainder = amount - (baseAmount * months.length)

                // プレビュー表示
                const preview = document.getElementById('preview')
                const content = document.getElementById('preview-content')
                
                let html = '<div class="space-y-2">'
                html += '<p class="font-medium">期間: ' + months.length + 'ヶ月</p>'
                html += '<table class="w-full text-sm mt-2">'
                html += '<thead class="bg-gray-100"><tr><th class="px-2 py-1 text-left">月次明細名</th><th class="px-2 py-1 text-right">金額</th></tr></thead>'
                html += '<tbody>'
                
                months.forEach((month, index) => {
                    const monthAmount = index === 0 ? baseAmount + remainder : baseAmount
                    const yearMonth = month.replace('-', '')  // 2026-01 → 202601
                    const monthlyName = projectName + '_' + yearMonth
                    html += '<tr><td class="px-2 py-1">' + monthlyName + '</td><td class="px-2 py-1 text-right">¥' + monthAmount.toLocaleString() + '</td></tr>'
                })
                
                html += '</tbody></table>'
                html += '<p class="mt-2 text-xs text-gray-500">※ 端数は最初の月に加算されます</p>'
                html += '</div>'
                
                content.innerHTML = html
                preview.classList.remove('hidden')
            }

            // フォーム送信
            document.getElementById('contract-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                // 月次明細の金額合計チェック
                const contractAmount = parseInt(document.getElementById('contract_amount').value) || 0
                const monthlyTotal = monthlyBreakdownData.reduce((sum, data) => sum + data.amount, 0)
                
                if (monthlyTotal !== contractAmount) {
                    alert(\`月次明細の金額合計（¥\${monthlyTotal.toLocaleString()}）が契約金額（¥\${contractAmount.toLocaleString()}）と一致しません。\`)
                    return
                }
                
                if (!confirm('この内容で契約を作成しますか？')) return
                
                const formData = new FormData(e.target)
                
                // メンバーアサインデータを収集
                const memberIds = formData.getAll('member_id[]')
                const allocationRatios = formData.getAll('allocation_ratio[]')
                const unitPrices = formData.getAll('unit_price[]')
                
                const memberAssignments = []
                for (let i = 0; i < memberIds.length; i++) {
                    if (memberIds[i]) {
                        memberAssignments.push({
                            member_id: parseInt(memberIds[i]),
                            allocation_ratio: parseFloat(allocationRatios[i]) / 100,
                            unit_price: parseInt(unitPrices[i])
                        })
                    }
                }
                
                const data = {
                    project_id: parseInt(formData.get('project_id')),
                    contract_name: formData.get('contract_name'),
                    contract_type: formData.get('contract_type'),
                    contract_date: formData.get('contract_date'),
                    start_date: formData.get('start_date'),
                    end_date: formData.get('end_date'),
                    contract_amount: parseInt(formData.get('contract_amount')),
                    tax_rate: parseFloat(formData.get('tax_rate')) || 10.0,
                    payment_type: formData.get('payment_type'),
                    notes: formData.get('notes') || '',
                    monthly_breakdown: monthlyBreakdownData,
                    member_assignments: memberAssignments
                }

                try {
                    const response = await axios.post('/api/contracts', data)
                    alert('契約を作成しました')
                    location.href = '/contracts/' + response.data.contract_id
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            })
        </script>
    </body>
    </html>
  `)
})

app.get('/projects', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'created_at'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['project_name', 'company_name', 'department', 'sales_rep_name', 'contract_count', 'status', 'created_at']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // 全案件を取得（リード情報と契約数を含む）
  const { results: projects } = await DB.prepare(`
    SELECT 
      p.*,
      l.company_name,
      l.department,
      m.name as sales_rep_name,
      (SELECT COUNT(*) FROM contracts WHERE project_id = p.id) as contract_count
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    WHERE p.status = 'active'
    ORDER BY ${sortColumn} ${order}
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>案件一覧 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        const AUTH_UTILS = {
          getToken: function() { return localStorage.getItem('jwt_token'); },
          checkAuth: function() {
            const token = this.getToken();
            if (!token) { window.location.href = '/login'; return false; }
            return true;
          },
          getCurrentUser: async function() {
            const token = this.getToken();
            if (!token) return null;
            try {
              const response = await axios.get('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              return response.data.user;
            } catch (error) {
              if (error.response?.status === 401) {
                localStorage.removeItem('jwt_token');
                window.location.href = '/login';
              }
              return null;
            }
          },
          logout: async function() {
            const token = this.getToken();
            if (token) {
              try {
                await axios.post('/api/auth/logout', {}, {
                  headers: { 'Authorization': 'Bearer ' + token }
                });
              } catch (error) {
                console.error('ログアウトエラー:', error);
              }
            }
            localStorage.removeItem('jwt_token');
            window.location.href = '/login';
          },
          setupAxios: function() {
            const token = this.getToken();
            if (token) {
              axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
            }
          }
        };
        
        // ソート機能
        function sortTable(column) {
          const urlParams = new URLSearchParams(window.location.search);
          const currentSort = urlParams.get('sortBy');
          const currentOrder = urlParams.get('sortOrder') || 'DESC';
          
          let newOrder = 'ASC';
          if (currentSort === column && currentOrder === 'ASC') {
            newOrder = 'DESC';
          }
          
          window.location.href = '/projects?sortBy=' + column + '&sortOrder=' + newOrder;
        }

        document.addEventListener('DOMContentLoaded', async function() {
          AUTH_UTILS.checkAuth();
          AUTH_UTILS.setupAxios();
          const user = await AUTH_UTILS.getCurrentUser();
          console.log('Projects page - Current user:', user);
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
        async function exportProjectsCSV() {
          try {
            const response = await axios.get('/api/projects/export/csv', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'projects.csv');
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

        // CSVインポート実行

        // 案件削除確認
        async function confirmDeleteProject(projectId, projectName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/projects/' + projectId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ 案件: ' + projectName + '\\n';
            
            if (impact.contracts.length > 0) {
              message += '\\n■ 契約 (' + impact.contracts.length + '件):\\n';
              impact.contracts.forEach(c => {
                message += '  - ' + c.contract_name + '\\n';
              });
            }
            
            if (impact.monthly_details_count > 0) {
              message += '\\n■ 月次明細: ' + impact.monthly_details_count + '件\\n';
            }
            
            if (impact.member_assignments_count > 0) {
              message += '\\n■ メンバーアサイン: ' + impact.member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/projects/' + projectId, {
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

        async function importProjectsCSV() {
          const file = document.getElementById('csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('CSVファイルをインポートしますか？')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const projects = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                project_name: values[0] || '',
                company_name: values[1] || '',
                department: values[2] || '',
                sales_rep_name: values[3] || '',
                status: values[4] || 'active'
              };
            });

            try {
              const response = await axios.post('/api/projects/import/csv', { projects });
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の案件をインポートしました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (' + err.project_name + ')';
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
                <a href="/projects" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
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
        <div class="px-4 py-6 sm:px-0 flex justify-between items-center">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-briefcase mr-2"></i>案件一覧
          </h1>
          <div class="flex space-x-2">
            <button id="csv-export-button" onclick="exportProjectsCSV()" class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700" style="display:none;">
              <i class="fas fa-file-download mr-2"></i>CSVエクスポート
            </button>
            <button id="csv-import-button" onclick="openImportModal()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700" style="display:none;">
              <i class="fas fa-file-upload mr-2"></i>CSVインポート
            </button>
          </div>
        </div>

        <!-- 案件一覧テーブル -->
        <div class="bg-white shadow overflow-hidden sm:rounded-lg">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
              <thead class="bg-gray-50">
                <tr>
                  <th data-sort="project_name" onclick="sortTable('project_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 200px;">
                    案件名 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="company_name" onclick="sortTable('company_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 150px;">
                    顧客 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="department" onclick="sortTable('department')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                    部署 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="sales_rep_name" onclick="sortTable('sales_rep_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                    営業担当 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="contract_count" onclick="sortTable('contract_count')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                    契約数 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="status" onclick="sortTable('status')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                    ステータス <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                  <th data-sort="created_at" onclick="sortTable('created_at')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                    作成日 <i class="sort-icon fas fa-sort ml-1"></i>
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${projects.map(project => `
                  <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.location.href='/projects/detail/${project.id}'">
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm font-medium text-gray-900">${project.project_name}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-900">${project.company_name || '-'}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-500">${project.department || '-'}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-900">${project.sales_rep_name || '-'}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                        ${project.contract_count || 0}件
                      </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${project.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                        ${project.status === 'active' ? 'アクティブ' : 'アーカイブ'}
                      </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${new Date(project.created_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                `).join('')}
                ${projects.length === 0 ? `
                  <tr>
                    <td colspan="7" class="px-6 py-4 text-center text-gray-500">
                      案件がありません
                    </td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
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
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: 案件名,会社名,部署名,営業担当,ステータス</p>
            <input type="file" id="csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closeImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="import-button" onclick="importProjectsCSV()" disabled class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400">
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
