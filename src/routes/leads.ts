-- リード一覧ページ
import { Hono } from 'hono'

export const leadsRoutes = new Hono<{ Bindings: { DB: D1Database } }>()

// リード一覧ページ
leadsRoutes.get('/', async (c) => {
  const { DB } = c.env
  const { results: leads } = await DB.prepare(
    'SELECT * FROM leads ORDER BY created_at DESC'
  ).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>リード一覧 - SFA</title>
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
                <a href="/leads" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
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
        <div class="px-4 py-6 sm:px-0 flex justify-between items-center">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-users mr-2"></i>リード一覧
          </h1>
          <button onclick="openCreateModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            <i class="fas fa-plus mr-2"></i>新規リード作成
          </button>
        </div>

        <!-- データテーブル -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">会社名</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">担当者</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">メール</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">電話</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${leads.map((lead: any) => `
                <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/leads/${lead.id}'">
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${lead.company_name}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.contact_person || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.email || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.phone || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${lead.status === 'active' 
                      ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                      : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 作成モーダル -->
      <div id="create-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-users mr-2"></i>新規リード作成
            </h3>
            <button onclick="closeCreateModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="create-form" onsubmit="createLead(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                会社名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="company_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                担当者名
              </label>
              <input type="text" name="contact_person"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                電話番号
              </label>
              <input type="tel" name="phone"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeCreateModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>作成
              </button>
            </div>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        function openCreateModal() {
          document.getElementById('create-modal').classList.remove('hidden');
        }

        function closeCreateModal() {
          document.getElementById('create-modal').classList.add('hidden');
          document.getElementById('create-form').reset();
        }

        async function createLead(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          
          try {
            const response = await axios.post('/api/leads', data);
            if (response.data.success) {
              alert('リードを作成しました');
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})
