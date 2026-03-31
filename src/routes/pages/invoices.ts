import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/invoices', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>請求書一覧 - SFA</title>
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

        <!-- メインコンテンツ -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="mb-6">
                <h1 class="text-3xl font-bold text-gray-900">
                    <i class="fas fa-receipt mr-3 text-green-600"></i>請求書一覧
                </h1>
            </div>

            <!-- 請求書一覧 -->
            <div id="invoices-list" class="space-y-4">
                <!-- 動的にロード -->
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
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

          AUTH_UTILS.setupAxios();
          
          AUTH_UTILS.getCurrentUser().then(user => {
            if (user) {
              document.getElementById('nav-user-name').textContent = user.name;
            } else {
              document.getElementById('nav-user-name').textContent = 'ゲスト';
            }
          }).catch(error => {
            console.error('Failed to load user info:', error);
            document.getElementById('nav-user-name').textContent = 'ゲスト';
          });

          async function loadInvoices() {
            try {
              const response = await axios.get('/api/invoices');
              const invoices = response.data.data || [];
              const list = document.getElementById('invoices-list');
              
              if (invoices.length === 0) {
                list.innerHTML = \`
                  <div class="bg-white rounded-lg shadow p-8 text-center">
                    <i class="fas fa-receipt text-5xl text-gray-300 mb-4"></i>
                    <p class="text-gray-500 text-lg">請求書はまだありません</p>
                  </div>
                \`;
                return;
              }
              
              list.innerHTML = invoices.map(inv => \`
                <div class="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6">
                  <div class="flex justify-between items-start">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        <a href="/invoices/\${inv.id}" class="text-lg font-bold text-blue-600 hover:text-blue-800 hover:underline">
                          \${inv.invoice_number}
                        </a>
                        <span class="px-2 py-1 rounded text-xs font-semibold \${
                          inv.payment_status === '入金完了' ? 'bg-green-100 text-green-800' :
                          inv.payment_status === '部分入金' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }">
                          \${inv.payment_status}
                        </span>
                      </div>
                      <p class="text-gray-600 mb-1">\${inv.company_name} \${inv.honorific || '御中'}</p>
                      <p class="text-sm text-gray-500">\${inv.subject}</p>
                      <div class="flex gap-4 mt-2 text-sm text-gray-600">
                        <span><i class="fas fa-calendar-alt mr-1"></i>発行日: \${inv.issue_date}</span>
                        \${inv.payment_due_date ? \`<span><i class="fas fa-clock mr-1"></i>支払期限: \${inv.payment_due_date}</span>\` : ''}
                      </div>
                    </div>
                    <div class="text-right ml-4">
                      <div class="text-2xl font-bold text-green-600 mb-2">
                        ¥\${inv.total.toLocaleString()}
                      </div>
                      <div class="flex gap-2">
                        <a href="/invoices/\${inv.id}" 
                           class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
                          <i class="fas fa-eye mr-1"></i>詳細
                        </a>
                        <button onclick="window.open('/invoices/\${inv.id}/pdf', '_blank')" 
                                class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
                          <i class="fas fa-file-pdf mr-1"></i>PDF
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              \`).join('');
            } catch (error) {
              console.error('請求書の読み込みに失敗:', error);
              document.getElementById('invoices-list').innerHTML = \`
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p class="text-red-700">請求書の読み込みに失敗しました</p>
                </div>
              \`;
            }
          }

          loadInvoices();
        </script>
    </body>
    </html>
  `)
})

app.get('/invoices/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>請求書詳細 - SFA</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
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

        <!-- メインコンテンツ -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <!-- ローディング表示 -->
            <div id="loading" class="text-center py-12">
                <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
                <p class="mt-4 text-gray-600">請求書を読み込んでいます...</p>
            </div>

            <!-- コンテンツ（最初は非表示） -->
            <div id="content" class="hidden">
                <!-- パンくずリスト -->
                <div class="mb-6 text-sm">
                    <a href="/" class="text-blue-600 hover:text-blue-800">ダッシュボード</a>
                    <span class="text-gray-400 mx-2">/</span>
                    <a href="/invoices" class="text-blue-600 hover:text-blue-800">請求書一覧</a>
                    <span class="text-gray-400 mx-2">/</span>
                    <span id="breadcrumb-title" class="text-gray-700">-</span>
                </div>

                <!-- ヘッダー部分 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <div class="flex justify-between items-start mb-6">
                        <!-- 左側：発行先企業 -->
                        <div class="flex-1">
                            <div class="flex items-center gap-3 mb-2">
                                <h1 class="text-3xl font-bold text-gray-900" id="company-name">-</h1>
                                <span id="honorific" class="text-xl text-gray-600">御中</span>
                            </div>
                            <p class="text-sm text-gray-600" id="company-address">-</p>
                        </div>

                        <!-- 右側：メタデータ -->
                        <div class="text-right space-y-2">
                            <div class="flex items-center justify-end gap-3">
                                <span class="text-sm text-gray-600">請求書番号:</span>
                                <span id="invoice-number" class="text-lg font-bold text-gray-900">-</span>
                            </div>
                            <div class="flex items-center justify-end gap-3">
                                <span class="text-sm text-gray-600">発行日:</span>
                                <span id="issue-date" class="text-sm font-semibold text-gray-700">-</span>
                            </div>
                            <div class="flex items-center justify-end gap-3">
                                <span class="text-sm text-gray-600">支払期限:</span>
                                <span id="payment-due-date" class="text-sm font-semibold text-gray-700">-</span>
                            </div>
                            <div id="payment-status-badge" class="inline-block px-3 py-1 rounded-full text-sm font-semibold">
                                -
                            </div>
                        </div>
                    </div>

                    <!-- 金額サマリーカード -->
                    <div class="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-6 text-white shadow-lg">
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="text-green-100 text-sm font-medium mb-1">ご請求金額</p>
                                <p class="text-4xl font-bold" id="total">¥0</p>
                            </div>
                            <button onclick="toggleBreakdown()" class="bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-lg transition-colors">
                                <span id="breakdown-toggle-text">内訳を表示</span>
                                <i id="breakdown-icon-down" class="fas fa-chevron-down ml-2"></i>
                                <i id="breakdown-icon-up" class="fas fa-chevron-up ml-2 hidden"></i>
                            </button>
                        </div>
                        
                        <div id="breakdown" class="hidden mt-4 pt-4 border-t border-green-400 border-opacity-30">
                            <div class="space-y-2 text-green-50">
                                <div class="flex justify-between">
                                    <span>小計:</span>
                                    <span id="subtotal" class="font-semibold">¥0</span>
                                </div>
                                <div class="flex justify-between">
                                    <span>消費税 (<span id="tax-rate">10</span>%):</span>
                                    <span id="tax" class="font-semibold">¥0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 件名 -->
                <div class="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded">
                    <p class="text-xs text-green-700 font-semibold uppercase tracking-wider mb-1">件名</p>
                    <p id="subject" class="text-gray-900 font-medium">-</p>
                </div>

                <!-- 明細テーブル -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 class="text-lg font-semibold text-gray-800 mb-4">
                        <i class="fas fa-list-ul mr-2 text-green-600"></i>請求明細
                    </h2>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-green-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">品目・品名</th>
                                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">数量</th>
                                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">単位</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">単価</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">金額</th>
                                </tr>
                            </thead>
                            <tbody id="items-table" class="bg-white divide-y divide-gray-200">
                                <!-- 動的に追加 -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 備考 -->
                <div id="notes-section" class="bg-white rounded-lg shadow-md p-6 mb-6 hidden">
                    <h2 class="text-lg font-semibold text-gray-800 mb-4">
                        <i class="fas fa-sticky-note mr-2 text-yellow-600"></i>備考
                    </h2>
                    <p id="notes" class="text-gray-700 whitespace-pre-wrap">-</p>
                </div>

                <!-- アクションバー -->
                <div class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg py-4 px-6">
                    <div class="max-w-7xl mx-auto flex justify-between items-center">
                        <a href="/invoices" class="text-gray-600 hover:text-gray-900">
                            <i class="fas fa-arrow-left mr-2"></i>一覧に戻る
                        </a>
                        <div class="flex gap-3">
                            <button onclick="window.open('/invoices/${id}/pdf', '_blank')" 
                                    class="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors">
                                <i class="fas fa-file-pdf mr-2"></i>PDF出力
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 下部余白（アクションバーの高さ分） -->
                <div class="h-20"></div>
            </div>
        </div>

        <script>
            const INVOICE_ID = ${id};
            
            const AUTH_UTILS = {
              getToken: () => localStorage.getItem('jwt_token'),
              checkAuth: () => {
                if (!AUTH_UTILS.getToken()) {
                  window.location.href = '/login';
                  return false;
                }
                return true;
              },
              getCurrentUser: async () => {
                try {
                  const response = await axios.get('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + AUTH_UTILS.getToken() }
                  });
                  return response.data.user;
                } catch (error) {
                  return null;
                }
              },
              logout: () => {
                localStorage.removeItem('jwt_token');
                window.location.href = '/login';
              },
              setupAxios: () => {
                axios.defaults.headers.common['Authorization'] = 'Bearer ' + AUTH_UTILS.getToken();
              }
            };
            
            // 支払いステータスのスタイル
            const PAYMENT_STATUS_STYLES = {
              '未入金': 'bg-red-100 text-red-800',
              '部分入金': 'bg-yellow-100 text-yellow-800',
              '入金完了': 'bg-green-100 text-green-800'
            };
            
            // 内訳表示の切り替え
            function toggleBreakdown() {
                const breakdown = document.getElementById('breakdown');
                const toggleText = document.getElementById('breakdown-toggle-text');
                const iconDown = document.getElementById('breakdown-icon-down');
                const iconUp = document.getElementById('breakdown-icon-up');
                
                breakdown.classList.toggle('hidden');
                
                if (breakdown.classList.contains('hidden')) {
                    toggleText.textContent = '内訳を表示';
                    iconDown.classList.remove('hidden');
                    iconUp.classList.add('hidden');
                } else {
                    toggleText.textContent = '内訳を隠す';
                    iconDown.classList.add('hidden');
                    iconUp.classList.remove('hidden');
                }
            }
            
            // 請求書データの読み込み
            async function loadInvoiceData() {
                try {
                    const response = await axios.get('/api/invoices/' + INVOICE_ID);
                    
                    if (!response.data.success) {
                        alert('請求書が見つかりません');
                        window.location.href = '/invoices';
                        return;
                    }
                    
                    const data = response.data.data;
                    renderInvoiceData(data);
                    
                    document.getElementById('loading').classList.add('hidden');
                    document.getElementById('content').classList.remove('hidden');
                } catch (error) {
                    console.error('請求書データの読み込みエラー:', error);
                    alert('請求書データの読み込みに失敗しました');
                    window.location.href = '/invoices';
                }
            }
            
            // 請求書データの表示
            function renderInvoiceData(data) {
                // パンくずリスト
                document.getElementById('breadcrumb-title').textContent = data.invoice_number;
                
                // ヘッダー情報
                document.getElementById('company-name').textContent = data.company_name || '-';
                document.getElementById('honorific').textContent = data.honorific || '御中';
                document.getElementById('invoice-number').textContent = data.invoice_number;
                document.getElementById('issue-date').textContent = data.issue_date;
                document.getElementById('payment-due-date').textContent = data.payment_due_date || '指定なし';
                
                // 住所
                if (data.postal_code && data.address) {
                    document.getElementById('company-address').textContent = 
                        '〒' + data.postal_code + ' ' + data.address;
                } else {
                    document.getElementById('company-address').textContent = '-';
                }
                
                // 支払いステータス
                const statusBadge = document.getElementById('payment-status-badge');
                const status = data.payment_status || '未入金';
                statusBadge.textContent = status;
                statusBadge.className = 'inline-block px-3 py-1 rounded-full text-sm font-semibold ' + 
                    (PAYMENT_STATUS_STYLES[status] || 'bg-gray-100 text-gray-800');
                
                // 金額
                document.getElementById('total').textContent = '¥' + (data.total || 0).toLocaleString();
                document.getElementById('subtotal').textContent = '¥' + (data.subtotal || 0).toLocaleString();
                document.getElementById('tax-rate').textContent = data.tax_rate || 10;
                document.getElementById('tax').textContent = '¥' + (data.tax || 0).toLocaleString();
                
                // 件名
                document.getElementById('subject').textContent = data.subject || '-';
                
                // 明細
                const itemsTable = document.getElementById('items-table');
                if (data.items && data.items.length > 0) {
                    itemsTable.innerHTML = data.items.map(item => \`
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-4">
                                <div class="text-sm font-medium text-gray-900">\${item.item_description}</div>
                                \${item.note ? \`<div class="text-xs text-gray-500 mt-1">\${item.note}</div>\` : ''}
                            </td>
                            <td class="px-6 py-4 text-center text-sm text-gray-900">\${(item.quantity || 0).toLocaleString()}</td>
                            <td class="px-6 py-4 text-center text-sm text-gray-700">\${item.unit || ''}</td>
                            <td class="px-6 py-4 text-right text-sm text-gray-900">¥\${(item.unit_price || 0).toLocaleString()}</td>
                            <td class="px-6 py-4 text-right text-sm font-semibold text-gray-900">¥\${(item.amount || 0).toLocaleString()}</td>
                        </tr>
                    \`).join('');
                } else {
                    itemsTable.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">明細がありません</td></tr>';
                }
                
                // 備考
                if (data.notes) {
                    document.getElementById('notes-section').classList.remove('hidden');
                    document.getElementById('notes').textContent = data.notes;
                }
            }
            
            // 初期化
            document.addEventListener('DOMContentLoaded', async () => {
                if (!AUTH_UTILS.checkAuth()) return;
                AUTH_UTILS.setupAxios();
                
                const user = await AUTH_UTILS.getCurrentUser();
                if (user) {
                    document.getElementById('nav-user-name').textContent = user.email;
                }
                
                await loadInvoiceData();
            });
        </script>
    </body>
    </html>
  `)
})

app.get('/invoices/:id/pdf', async (c) => {
  const id = c.req.param('id')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>請求書PDF - SFA</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
        <style>
            body { margin: 0; padding: 20px; background-color: #f5f5f5;
                   font-family: 'メイリオ', 'Meiryo', 'MS Pゴシック', sans-serif; }
        </style>
    </head>
    <body>
        <div style="text-align:center; padding: 20px;">
            <p style="color:#16a34a; font-size:18px;">請求書PDFを生成中...</p>
        </div>

        <!-- ★ A4幅(794px)固定・画面外配置 -->
        <div id="pdf-content" style="position: fixed; left: -99999px; width: 794px; background: white;">
        </div>

        <script>
            const invoiceId = ${id};

            // =====================================================================
            // ★ ①改ページ対応: canvasをA4高さ単位でスライスして複数ページに追加
            // =====================================================================
            async function addCanvasToPdfWithPageBreaks(doc, canvas, imgWidthMM) {
                const A4_HEIGHT_MM  = 297;
                const PAGE_MARGIN_MM = 0;
                const pxToMM = imgWidthMM / canvas.width;
                const pageHeightPx = Math.floor((A4_HEIGHT_MM - PAGE_MARGIN_MM * 2) / pxToMM);
                const totalPages = Math.ceil(canvas.height / pageHeightPx);

                for (let page = 0; page < totalPages; page++) {
                    if (page > 0) doc.addPage();
                    const srcY      = page * pageHeightPx;
                    const srcHeight = Math.min(pageHeightPx, canvas.height - srcY);
                    const slice = document.createElement('canvas');
                    slice.width  = canvas.width;
                    slice.height = srcHeight;
                    slice.getContext('2d').drawImage(
                        canvas, 0, srcY, canvas.width, srcHeight,
                                0, 0,   canvas.width, srcHeight
                    );
                    doc.addImage(slice.toDataURL('image/png'), 'PNG',
                                 PAGE_MARGIN_MM, PAGE_MARGIN_MM,
                                 imgWidthMM - PAGE_MARGIN_MM * 2,
                                 srcHeight * pxToMM);
                }
            }

            async function generateInvoicePDF() {
                try {
                    // トークン取得
                    let token = localStorage.getItem('jwt_token');
                    if (!token) {
                        const cookies = document.cookie.split(';');
                        for (let c of cookies) {
                            const [n, v] = c.trim().split('=');
                            if (n === 'jwt_token') { token = v; break; }
                        }
                    }
                    if (!token) {
                        alert('ログインが必要です。ログイン画面に戻ります。');
                        window.location.href = '/login';
                        return;
                    }

                    // データ取得
                    const response = await fetch('/api/invoices/' + invoiceId + '/pdf-data', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (!response.ok) throw new Error('HTTPエラー: ' + response.status);

                    const result = await response.json();
                    if (!result.success) {
                        alert('データの取得に失敗しました: ' + (result.error || '不明なエラー'));
                        window.close(); return;
                    }

                    const { invoice, items, companyInfo } = result.data;
                    const GRN = '#22c55e';   // テーマカラー（緑）

                    // =====================================================================
                    // ★ ②ヘッダーのコンパクト化・上寄り化
                    //   変更点（見積書と同じアプローチ）:
                    //   - ロゴ(左)＋タイトル(中央)＋自社情報(右) を横3列に統合
                    //   - 請求番号・発行日・支払期限を横一列バーへ
                    //   - 各margin/paddingを旧比40〜50%削減
                    //   - 金額カードを横並び1行に圧縮
                    //   - テーブル行padding: 12px → 7px に削減
                    // =====================================================================
                    let html = '';
                    html += '<div style="padding: 20px 40px 30px 40px;">';

                    // --- ヘッダー行: ロゴ(左) ＋ タイトル(中央) ＋ 自社情報(右) ---
                    html += '<div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px;">';

                    // 左: ロゴ
                    html += '<div style="min-width:130px;">';
                    if (companyInfo.logo_base64) {
                        html += '<img src="' + companyInfo.logo_base64 + '" style="max-width:130px; max-height:55px; object-fit:contain;">';
                    }
                    html += '</div>';

                    // 中央: タイトル
                    html += '<div style="flex:1; text-align:center; padding:0 12px;">';
                    html += '<h1 style="font-size:26px; font-weight:bold; color:#1a1a1a; letter-spacing:4px; margin:0;">請求書</h1>';
                    html += '</div>';

                    // 右: 自社情報
                    html += '<div style="text-align:right; min-width:180px; max-width:220px;">';
                    html += '<div style="font-weight:bold; font-size:12px; color:#1a1a1a; margin-bottom:3px;">' + (companyInfo.company_name || '') + '</div>';
                    html += '<div style="font-size:9px; color:#555; line-height:1.55; word-break:break-all;">';
                    if (companyInfo.postal_code)  html += '<div>〒' + companyInfo.postal_code + '</div>';
                    if (companyInfo.address)      html += '<div>' + companyInfo.address + '</div>';
                    if (companyInfo.registration_number) html += '<div style="margin-top:3px;">登録番号: ' + companyInfo.registration_number + '</div>';
                    html += '</div>';
                    if (companyInfo.seal_base64) {
                        html += '<div style="margin-top:6px;"><img src="' + companyInfo.seal_base64 + '" style="max-width:55px; max-height:55px; object-fit:contain;"></div>';
                    }
                    html += '</div>';
                    html += '</div>'; // ヘッダー行end

                    // --- 請求番号・発行日・支払期限 横一列バー ---
                    html += '<div style="display:flex; gap:24px; margin-bottom:10px; padding:6px 10px; background:#f8f9fa; border-radius:4px; border:1px solid #e8e8e8;">';
                    html += '<div><span style="font-size:9px; color:#888; font-weight:500; display:block;">請求書番号</span>';
                    html += '<span style="font-size:12px; color:#1a1a1a; font-weight:700;">' + (invoice.invoice_number || '') + '</span></div>';
                    html += '<div><span style="font-size:9px; color:#888; font-weight:500; display:block;">発行日</span>';
                    html += '<span style="font-size:12px; color:#1a1a1a;">' + (invoice.issue_date || '') + '</span></div>';
                    if (invoice.payment_due_date) {
                        html += '<div><span style="font-size:9px; color:#888; font-weight:500; display:block;">支払期限</span>';
                        html += '<span style="font-size:12px; color:#1a1a1a;">' + invoice.payment_due_date + '</span></div>';
                    }
                    html += '</div>';

                    // --- 発行先 ---
                    html += '<div style="margin-bottom:10px; border-bottom:1.5px solid #e0e0e0; padding-bottom:8px;">';
                    html += '<span style="font-size:10px; color:#666; font-weight:500; display:block; margin-bottom:3px;">発行先</span>';
                    html += '<span style="font-size:18px; font-weight:bold; color:#1a1a1a; display:block;">' + (invoice.company_name || '') + '</span>';
                    html += '<span style="font-size:14px; color:#333;">' + (invoice.honorific || '御中') + '</span>';
                    if (invoice.billing_postal_code && invoice.billing_address) {
                        html += '<div style="font-size:11px; color:#6b7280; margin-top:3px;">〒' + invoice.billing_postal_code + '　' + invoice.billing_address + '</div>';
                    }
                    html += '</div>';

                    // --- 件名 ---
                    if (invoice.subject) {
                        html += '<div style="margin-bottom:12px; padding:7px 12px; background:#f0fdf4; border-left:4px solid ' + GRN + '; border-radius:4px;">';
                        html += '<span style="font-size:9px; color:#16a34a; font-weight:600; display:block; margin-bottom:2px;">件名</span>';
                        html += '<span style="font-size:13px; color:#1a1a1a; font-weight:600;">' + invoice.subject + '</span>';
                        html += '</div>';
                    }

                    // --- 金額サマリー（横並び1行）---
                    html += '<div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%); padding:12px 20px; margin-bottom:14px; border-radius:6px;">';
                    html += '<div style="display:flex; align-items:center; justify-content:space-between;">';
                    html += '<span style="font-size:12px; color:rgba(255,255,255,0.9); font-weight:500;">ご請求金額（消費税込み）</span>';
                    html += '<span style="font-size:26px; font-weight:bold; color:#fff; white-space:nowrap;">¥' + (invoice.total || 0).toLocaleString() + '</span>';
                    html += '</div></div>';

                    // =====================================================================
                    // ★ 明細テーブル
                    //   ③ 金額見切れ対策: 金額列130px・単価列120px・white-space:nowrap
                    //   行padding: 12px → 7px に削減
                    // =====================================================================
                    html += '<div style="margin-bottom:16px;">';
                    html += '<div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:#1a1a1a; padding-bottom:6px; border-bottom:2px solid ' + GRN + ';">請求明細</div>';
                    html += '<table style="width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed;">';
                    html += '<colgroup>';
                    html += '<col style="width:auto;">';
                    html += '<col style="width:48px;">';
                    html += '<col style="width:40px;">';
                    html += '<col style="width:120px;">';  // 単価
                    html += '<col style="width:130px;">';  // 金額（★7桁以上対応）
                    html += '</colgroup>';
                    html += '<thead>';
                    html += '<tr style="background:' + GRN + '; color:white;">';
                    html += '<th style="border:1px solid #16a34a; padding:7px 10px; text-align:left; font-weight:600;">品目・品名</th>';
                    html += '<th style="border:1px solid #16a34a; padding:7px 6px; text-align:right; font-weight:600;">数量</th>';
                    html += '<th style="border:1px solid #16a34a; padding:7px 6px; text-align:center; font-weight:600;">単位</th>';
                    html += '<th style="border:1px solid #16a34a; padding:7px 6px; text-align:right; font-weight:600;">単価</th>';
                    html += '<th style="border:1px solid #16a34a; padding:7px 8px; text-align:right; font-weight:600;">金額</th>';
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
                        html += '<tr style="background:' + bg + ';">';
                        html += '<td style="border:1px solid #e0e0e0; padding:7px 10px; line-height:1.5; word-break:break-word;">';
                        html += '<div style="font-weight:500; color:#1a1a1a;">' + (item.item_description || '') + '</div>';
                        if (item.note) html += '<div style="font-size:9px; color:#666; margin-top:2px; padding-left:6px; border-left:2px solid #ddd;">' + item.note + '</div>';
                        html += '</td>';
                        html += '<td style="border:1px solid #e0e0e0; padding:7px 6px; text-align:right; font-weight:500;">' + (item.quantity || 0).toLocaleString() + '</td>';
                        html += '<td style="border:1px solid #e0e0e0; padding:7px 6px; text-align:center; color:#666;">' + (item.unit || '') + '</td>';
                        html += '<td style="border:1px solid #e0e0e0; padding:7px 6px; text-align:right; font-weight:500; white-space:nowrap;">¥' + (item.unit_price || 0).toLocaleString() + '</td>';
                        html += '<td style="border:1px solid #e0e0e0; padding:7px 8px; text-align:right; font-weight:600; color:#1a1a1a; white-space:nowrap;">¥' + (item.amount || 0).toLocaleString() + '</td>';
                        html += '</tr>';
                    });

                    // 小計・消費税・合計
                    html += '<tr style="background:#f8f9fa;">';
                    html += '<td colspan="4" style="border:1px solid #e0e0e0; padding:7px 8px; text-align:right; font-weight:600; color:#1a1a1a;">小計</td>';
                    html += '<td style="border:1px solid #e0e0e0; padding:7px 8px; text-align:right; font-weight:700; color:#1a1a1a; white-space:nowrap;">¥' + (invoice.subtotal || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    html += '<tr style="background:#f8f9fa;">';
                    html += '<td colspan="4" style="border:1px solid #e0e0e0; padding:7px 8px; text-align:right; font-weight:600; color:#666;">消費税(' + (invoice.tax_rate || 10) + '%)</td>';
                    html += '<td style="border:1px solid #e0e0e0; padding:7px 8px; text-align:right; font-weight:700; color:#666; white-space:nowrap;">¥' + (invoice.tax || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    html += '<tr style="background:' + GRN + '; color:white;">';
                    html += '<td colspan="4" style="border:1px solid #16a34a; padding:9px 8px; text-align:right; font-weight:700; font-size:13px;">合計金額</td>';
                    html += '<td style="border:1px solid #16a34a; padding:9px 8px; text-align:right; font-weight:700; font-size:13px; white-space:nowrap;">¥' + (invoice.total || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    html += '</tbody></table></div>';

                    // 振込先情報
                    if (companyInfo.bank_name) {
                        html += '<div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:14px 16px; margin-bottom:14px;">';
                        html += '<div style="color:#16a34a; font-size:11px; font-weight:600; margin-bottom:8px;">お振込先</div>';
                        html += '<div style="font-size:11px; color:#374151; line-height:1.8;">';
                        html += '銀行名: ' + (companyInfo.bank_name || '') + '<br>';
                        if (companyInfo.bank_branch)    html += '支店名: ' + companyInfo.bank_branch + '<br>';
                        if (companyInfo.account_type)   html += '口座種別: ' + companyInfo.account_type + '<br>';
                        if (companyInfo.account_number) html += '口座番号: ' + companyInfo.account_number + '<br>';
                        if (companyInfo.account_holder) html += '口座名義: ' + companyInfo.account_holder;
                        html += '</div></div>';
                    }

                    // 備考
                    if (invoice.notes) {
                        html += '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-top:14px;">';
                        html += '<div style="color:#92400e; font-size:11px; font-weight:600; margin-bottom:5px;">備考</div>';
                        html += '<div style="color:#78350f; font-size:11px; line-height:1.7; white-space:pre-wrap;">' + invoice.notes + '</div>';
                        html += '</div>';
                    }

                    html += '</div>'; // padding wrapper end

                    const pdfContent = document.getElementById('pdf-content');
                    pdfContent.innerHTML = html;

                    // html2canvasでキャンバス生成
                    const canvas = await html2canvas(pdfContent, {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                        windowWidth: 794,
                        windowHeight: pdfContent.scrollHeight
                    });

                    // jsPDFでPDF生成
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

                    // ★ ①改ページ対応: 複数ページに自動分割
                    await addCanvasToPdfWithPageBreaks(pdf, canvas, 210);

                    // PDFダウンロード
                    const fileName = '請求書_' + (invoice.invoice_number || 'unknown') + '_' + new Date().toISOString().split('T')[0] + '.pdf';
                    pdf.save(fileName);

                    setTimeout(() => { window.close(); }, 3000);

                } catch (error) {
                    console.error('PDF生成エラー:', error);
                    alert('PDF生成に失敗しました: ' + error.message);
                    window.close();
                }
            }

            window.addEventListener('load', generateInvoicePDF);
        </script>
    </body>
    </html>
  `)
})


export default app
