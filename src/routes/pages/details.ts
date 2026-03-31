import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/details', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>詳細一覧 - SFA</title>
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
                <a href="/details" class="border-blue-500 text-blue-600 inline-flex items-center px-1 pt-1 border-b-2 font-semibold">
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
          <h1 class="text-3xl font-bold text-gray-900 mb-6">
            <i class="fas fa-list-alt mr-2"></i>詳細一覧
          </h1>
          
          <!-- 詳細一覧メニュー -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- 月次明細一覧 -->
            <a href="/monthly-details" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-blue-500">
                <div class="flex items-center mb-4">
                  <div class="bg-blue-100 rounded-full p-3 mr-4">
                    <i class="fas fa-calendar-alt text-2xl text-blue-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">月次明細一覧</h2>
                    <p class="text-sm text-gray-500">月次ベースの契約明細</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  各契約の月次明細情報を確認できます。検収状況、請求状況、入金状況などを一覧で管理します。
                </p>
              </div>
            </a>

            <!-- 見積書一覧 -->
            <a href="/quotes" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-green-500">
                <div class="flex items-center mb-4">
                  <div class="bg-green-100 rounded-full p-3 mr-4">
                    <i class="fas fa-file-invoice text-2xl text-green-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">見積書一覧</h2>
                    <p class="text-sm text-gray-500">発行した見積書</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  案件に対して発行した見積書を一覧で確認できます。ステータスやPDF出力も可能です。
                </p>
              </div>
            </a>

            <!-- 請求書一覧 -->
            <a href="/invoices" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-purple-500">
                <div class="flex items-center mb-4">
                  <div class="bg-purple-100 rounded-full p-3 mr-4">
                    <i class="fas fa-file-invoice-dollar text-2xl text-purple-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">請求書一覧</h2>
                    <p class="text-sm text-gray-500">発行した請求書</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  月次明細から発行した請求書を一覧で確認できます。PDF出力や入金管理も可能です。
                </p>
              </div>
            </a>

            <!-- 入金状況一覧 -->
            <a href="/payments" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-teal-500">
                <div class="flex items-center mb-4">
                  <div class="bg-teal-100 rounded-full p-3 mr-4">
                    <i class="fas fa-money-bill-wave text-2xl text-teal-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">入金状況一覧</h2>
                    <p class="text-sm text-gray-500">リード単位の入金状況</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  リード（会社）単位で月毎の入金総額を一覧で確認できます。税込み金額での入金状況を把握できます。
                </p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>
        // AUTH_UTILS - 認証ユーティリティ

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

        loadUserInfo();
      </script>
    </body>
    </html>
  `)
})


export default app
