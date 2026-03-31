import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/payments', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>入金状況一覧 - SFA</title>
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

        <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <div class="px-4 py-6 sm:px-0">
                <!-- ヘッダー -->
                <div class="mb-6">
                    <h1 class="text-3xl font-bold text-gray-900">
                        <i class="fas fa-money-bill-wave mr-2"></i>入金状況一覧
                    </h1>
                    <p class="mt-2 text-sm text-gray-600">
                        リード（会社）単位で月毎の入金総額を表示します
                    </p>
                </div>

                <!-- 入金状況一覧テーブル -->
                <div class="bg-white shadow rounded-lg overflow-hidden">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    会社名
                                </th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    部署名
                                </th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    年月
                                </th>
                                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    予定金額（税抜）
                                </th>
                                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    予定金額（税込）
                                </th>
                                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    入金総額（税込）
                                </th>
                                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    入金状況
                                </th>
                            </tr>
                        </thead>
                        <tbody id="payment-table-body" class="bg-white divide-y divide-gray-200">
                            <!-- JavaScript で動的に生成 -->
                        </tbody>
                    </table>
                </div>

                <!-- ローディング表示 -->
                <div id="loading" class="text-center py-12">
                    <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
                    <p class="mt-4 text-gray-600">読み込み中...</p>
                </div>
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
            logout: () => {
              localStorage.removeItem('jwt_token');
              document.cookie = 'jwt_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
              window.location.href = '/login';
            }
          };

          // 認証チェック
          AUTH_UTILS.checkAuth();

          // Axiosのデフォルト設定
          axios.defaults.headers.common['Authorization'] = 'Bearer ' + AUTH_UTILS.getToken();

          // ユーザー情報を取得
          async function loadUserInfo() {
            try {
              const response = await axios.get('/api/auth/me');
              if (response.data && response.data.success) {
                const user = response.data.user;
                if (user && user.name) {
                  document.getElementById('nav-user-name').textContent = user.name;
                }
              }
            } catch (error) {
              console.error('ユーザー情報の取得に失敗しました:', error);
            }
          }

          // 入金状況一覧を読み込む
          async function loadPayments() {
            try {
              const response = await axios.get('/api/payment-summary');
              const payments = response.data.data;

              const tbody = document.getElementById('payment-table-body');
              
              if (payments.length === 0) {
                tbody.innerHTML = \`
                  <tr>
                    <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                      <i class="fas fa-inbox text-4xl mb-3 block"></i>
                      入金データがありません
                    </td>
                  </tr>
                \`;
              } else {
                tbody.innerHTML = payments.map(payment => {
                  const amountBeforeTax = payment.total_amount_before_tax || 0;
                  const amountWithTax = payment.total_amount_with_tax || 0;
                  const totalPayment = payment.total_payment || 0;
                  
                  // 入金状況の判定
                  let statusBadge = '';
                  let statusColor = '';
                  if (totalPayment >= amountWithTax) {
                    statusBadge = '入金完了';
                    statusColor = 'bg-green-100 text-green-800';
                  } else if (totalPayment > 0) {
                    statusBadge = '部分入金';
                    statusColor = 'bg-yellow-100 text-yellow-800';
                  } else {
                    statusBadge = '未入金';
                    statusColor = 'bg-gray-100 text-gray-800';
                  }

                  return \`
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-medium text-gray-900">\${payment.company_name || '-'}</div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        \${payment.department || '-'}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        \${payment.target_month}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        ¥\${amountBeforeTax.toLocaleString()}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-semibold">
                        ¥\${amountWithTax.toLocaleString()}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-semibold">
                        ¥\${totalPayment.toLocaleString()}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-center">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${statusColor}">
                          \${statusBadge}
                        </span>
                      </td>
                    </tr>
                  \`;
                }).join('');
              }

              document.getElementById('loading').style.display = 'none';
            } catch (error) {
              console.error('入金状況一覧の読み込みに失敗しました:', error);
              document.getElementById('loading').innerHTML = \`
                <div class="text-center py-12">
                  <i class="fas fa-exclamation-triangle text-4xl text-red-600"></i>
                  <p class="mt-4 text-gray-600">データの読み込みに失敗しました</p>
                </div>
              \`;
            }
          }

          // 初期化
          loadUserInfo();
          loadPayments();
        </script>
    </body>
    </html>
  `)
})


export default app
