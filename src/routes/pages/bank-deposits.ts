import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/bank-deposits', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>入金消込 - SFA</title>
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
                  <a href="/bank-deposits" class="border-blue-500 text-blue-600 inline-flex items-center px-1 pt-1 border-b-2 font-semibold">
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

                <!-- 権限エラー表示 -->
                <div id="permission-error" class="hidden mb-6 bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <i class="fas fa-lock text-4xl text-red-400 mb-3"></i>
                    <p class="text-red-700 font-semibold text-lg">アクセス権限がありません</p>
                    <p class="text-red-600 text-sm mt-1">この画面は管理者または「入金」権限を持つユーザーのみ利用できます。</p>
                </div>

                <!-- メインコンテンツ -->
                <div id="main-content" class="hidden">
                    <!-- ヘッダー -->
                    <div class="flex justify-between items-center mb-6">
                        <div>
                            <h1 class="text-3xl font-bold text-gray-900">
                                <i class="fas fa-cash-register mr-2"></i>入金消込
                            </h1>
                            <p class="mt-2 text-sm text-gray-600">
                                銀行口座への入金を登録し、月次明細への消込を行います
                            </p>
                        </div>
                        <button onclick="openCreateModal()" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg shadow">
                            <i class="fas fa-plus mr-2"></i>新規入金登録
                        </button>
                    </div>

                    <!-- 銀行入金一覧テーブル -->
                    <div class="bg-white shadow rounded-lg overflow-hidden">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">入金日</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">振込人名</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">入金額</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">未消込残高</th>
                                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">備考</th>
                                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                                </tr>
                            </thead>
                            <tbody id="deposits-table-body" class="bg-white divide-y divide-gray-200">
                                <tr><td colspan="7" class="px-6 py-12 text-center text-gray-500">
                                    <i class="fas fa-spinner fa-spin text-2xl mb-2"></i><br>読み込み中...
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- 入金情報編集モーダル -->
        <div id="edit-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-edit mr-2 text-amber-500"></i>入金情報編集
            </h2>
            <input type="hidden" id="edit-id">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">入金日 <span class="text-red-500">*</span></label>
                <input type="date" id="edit-date" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500 border p-2">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">入金額（円） <span class="text-red-500">*</span></label>
                <input type="number" id="edit-amount" min="1" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500 border p-2">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">振込人名 <span class="text-red-500">*</span></label>
                <input type="text" id="edit-payer" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500 border p-2">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">備考</label>
                <textarea id="edit-note" rows="2" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500 border p-2"></textarea>
              </div>
            </div>
            <div class="flex justify-end space-x-3 mt-6">
              <button onclick="closeEditModal()" class="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">キャンセル</button>
              <button onclick="submitEdit()" id="edit-submit-btn" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold">更新</button>
            </div>
          </div>
        </div>

        <!-- 新規入金登録モーダル -->
        <div id="create-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-4">
              <i class="fas fa-plus-circle mr-2 text-blue-600"></i>新規入金登録
            </h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">入金日 <span class="text-red-500">*</span></label>
                <input type="date" id="create-date" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">入金額（円） <span class="text-red-500">*</span></label>
                <input type="number" id="create-amount" min="1" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2" placeholder="例: 1100000">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">振込人名 <span class="text-red-500">*</span></label>
                <input type="text" id="create-payer" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2" placeholder="例: 株式会社〇〇">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">備考</label>
                <textarea id="create-note" rows="2" class="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2" placeholder="任意"></textarea>
              </div>
            </div>
            <div class="flex justify-end space-x-3 mt-6">
              <button onclick="closeCreateModal()" class="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">キャンセル</button>
              <button onclick="submitDeposit()" id="submit-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">登録</button>
            </div>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/auth.js"></script>
        <script>
          const token = localStorage.getItem('jwt_token');
          if (!token) { window.location.href = '/login'; }
          axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;

          // 権限チェック
          async function checkPermission() {
            try {
              const res = await axios.get('/api/auth/me');
              const user = res.data.user;
              document.getElementById('nav-user-name').textContent = user.name || 'ユーザー';

              if (user.role === 'admin' || (user.permissions && user.permissions.includes('payment_manage'))) {
                document.getElementById('main-content').classList.remove('hidden');
                loadDeposits();
              } else {
                document.getElementById('permission-error').classList.remove('hidden');
              }
            } catch (e) {
              if (e.response?.status === 401) window.location.href = '/login';
            }
          }

          // 銀行入金一覧を読み込む
          async function loadDeposits() {
            try {
              const res = await axios.get('/api/bank-deposits');
              const deposits = res.data.data;
              const tbody = document.getElementById('deposits-table-body');

              if (deposits.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-gray-400"><i class="fas fa-inbox text-4xl mb-3"></i><br>銀行入金が登録されていません</td></tr>';
                return;
              }

              tbody.innerHTML = deposits.map(d => {
                const statusClass = d.status === '消込完了' ? 'bg-green-100 text-green-800'
                  : d.status === '一部消込' ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-red-100 text-red-800';
                return \`<tr class="hover:bg-gray-50">
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">\${d.deposit_date}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">\${d.payer_name}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">¥\${Number(d.amount).toLocaleString()}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold \${d.remaining_amount > 0 ? 'text-orange-600' : 'text-gray-400'}">¥\${Number(d.remaining_amount).toLocaleString()}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-center">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full \${statusClass}">\${d.status}</span>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">\${d.note || '—'}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center space-x-1">
                    \${d.status === '未消込' ? \`
                      <a href="/bank-deposits/\${d.id}/allocate" class="inline-flex items-center px-2 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg"><i class="fas fa-check-double mr-1"></i>消込</a>
                      <button onclick="openEditModal(\${d.id}, '\${d.deposit_date}', \${d.amount}, \${JSON.stringify(d.payer_name)}, \${JSON.stringify(d.note || '')})" class="inline-flex items-center px-2 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg"><i class="fas fa-edit mr-1"></i>編集</button>
                      <button onclick="deleteDeposit(\${d.id}, \${JSON.stringify(d.payer_name)}, \${d.amount})" class="inline-flex items-center px-2 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg"><i class="fas fa-trash mr-1"></i>削除</button>
                    \` : d.status === '一部消込' ? \`
                      <a href="/bank-deposits/\${d.id}/allocate" class="inline-flex items-center px-2 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg"><i class="fas fa-check-double mr-1"></i>消込</a>
                    \` : \`
                      <a href="/bank-deposits/\${d.id}/allocate" class="inline-flex items-center px-2 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-semibold rounded-lg"><i class="fas fa-eye mr-1"></i>詳細</a>
                    \`}
                    </div>
                  </td>
                </tr>\`;
              }).join('');
            } catch (e) {
              console.error('銀行入金一覧の読み込みに失敗:', e);
            }
          }

          // 新規入金登録モーダル
          function openCreateModal() {
            document.getElementById('create-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('create-amount').value = '';
            document.getElementById('create-payer').value = '';
            document.getElementById('create-note').value = '';
            document.getElementById('create-modal').classList.remove('hidden');
          }
          function closeCreateModal() {
            document.getElementById('create-modal').classList.add('hidden');
          }

          async function submitDeposit() {
            const deposit_date = document.getElementById('create-date').value;
            const amount = parseInt(document.getElementById('create-amount').value);
            const payer_name = document.getElementById('create-payer').value.trim();
            const note = document.getElementById('create-note').value.trim();

            if (!deposit_date || !amount || !payer_name) {
              alert('入金日、入金額、振込人名は必須です');
              return;
            }
            if (amount <= 0) {
              alert('入金額は1円以上で入力してください');
              return;
            }

            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>登録中...';

            try {
              await axios.post('/api/bank-deposits', { deposit_date, amount, payer_name, note: note || null });
              closeCreateModal();
              loadDeposits();
            } catch (e) {
              alert(e.response?.data?.error || '登録に失敗しました');
            } finally {
              btn.disabled = false;
              btn.innerHTML = '登録';
            }
          }

          // 編集モーダル
          function openEditModal(id, date, amount, payer, note) {
            document.getElementById('edit-id').value = id;
            document.getElementById('edit-date').value = date;
            document.getElementById('edit-amount').value = amount;
            document.getElementById('edit-payer').value = payer;
            document.getElementById('edit-note').value = note;
            document.getElementById('edit-modal').classList.remove('hidden');
          }
          function closeEditModal() {
            document.getElementById('edit-modal').classList.add('hidden');
          }

          async function submitEdit() {
            const id = document.getElementById('edit-id').value;
            const deposit_date = document.getElementById('edit-date').value;
            const amount = parseInt(document.getElementById('edit-amount').value);
            const payer_name = document.getElementById('edit-payer').value.trim();
            const note = document.getElementById('edit-note').value.trim();

            if (!deposit_date || !amount || !payer_name) {
              alert('入金日、入金額、振込人名は必須です');
              return;
            }
            if (amount <= 0) {
              alert('入金額は1円以上で入力してください');
              return;
            }

            const btn = document.getElementById('edit-submit-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>更新中...';

            try {
              await axios.put('/api/bank-deposits/' + id, { deposit_date, amount, payer_name, note: note || null });
              closeEditModal();
              loadDeposits();
            } catch (e) {
              alert(e.response?.data?.error || '更新に失敗しました');
            } finally {
              btn.disabled = false;
              btn.innerHTML = '更新';
            }
          }

          // 削除
          async function deleteDeposit(id, payerName, amount) {
            const msg = '以下の入金情報を削除します。\n\n'
              + '振込人名: ' + payerName + '\n'
              + '入金額: ¥' + Number(amount).toLocaleString() + '\n\n'
              + 'この操作は取り消せません。よろしいですか？';
            if (!confirm(msg)) return;

            try {
              await axios.delete('/api/bank-deposits/' + id);
              loadDeposits();
            } catch (e) {
              alert(e.response?.data?.error || '削除に失敗しました');
            }
          }

          // 初期化
          checkPermission();
        </script>
    </body>
    </html>
  `)
})

app.get('/bank-deposits/:id/allocate', async (c) => {
  const depositId = c.req.param('id')
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>消込実行 - SFA</title>
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
                  <a href="/bank-deposits" class="border-blue-500 text-blue-600 inline-flex items-center px-1 pt-1 border-b-2 font-semibold">
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

                <!-- 権限エラー表示 -->
                <div id="permission-error" class="hidden mb-6 bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <i class="fas fa-lock text-4xl text-red-400 mb-3"></i>
                    <p class="text-red-700 font-semibold text-lg">アクセス権限がありません</p>
                    <p class="text-red-600 text-sm mt-1">この画面は管理者または「入金」権限を持つユーザーのみ利用できます。</p>
                </div>

                <!-- メインコンテンツ -->
                <div id="main-content" class="hidden">
                    <!-- パンくず -->
                    <nav class="flex mb-4" aria-label="Breadcrumb">
                      <ol class="inline-flex items-center space-x-1 text-sm text-gray-500">
                        <li><a href="/bank-deposits" class="hover:text-blue-600"><i class="fas fa-cash-register mr-1"></i>入金消込</a></li>
                        <li><i class="fas fa-chevron-right mx-2 text-gray-300"></i></li>
                        <li class="text-gray-900 font-medium">消込実行</li>
                      </ol>
                    </nav>

                    <!-- 銀行入金情報カード -->
                    <div id="deposit-info" class="bg-white shadow rounded-lg p-6 mb-6">
                      <div class="flex items-center justify-between">
                        <h1 class="text-2xl font-bold text-gray-900">
                          <i class="fas fa-check-double mr-2 text-teal-600"></i>消込実行
                        </h1>
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div>
                          <p class="text-xs text-gray-500">入金日</p>
                          <p id="info-date" class="text-lg font-semibold text-gray-900">—</p>
                        </div>
                        <div>
                          <p class="text-xs text-gray-500">振込人名</p>
                          <p id="info-payer" class="text-lg font-semibold text-gray-900">—</p>
                        </div>
                        <div>
                          <p class="text-xs text-gray-500">入金額</p>
                          <p id="info-amount" class="text-lg font-semibold text-gray-900">—</p>
                        </div>
                        <div>
                          <p class="text-xs text-gray-500">未消込残高</p>
                          <p id="info-remaining" class="text-lg font-bold text-orange-600">—</p>
                        </div>
                      </div>
                    </div>

                    <!-- 消込済み履歴 -->
                    <div id="allocation-history-section" class="hidden bg-white shadow rounded-lg p-6 mb-6">
                      <h2 class="text-lg font-bold text-gray-900 mb-3">
                        <i class="fas fa-history mr-2 text-gray-500"></i>消込済み履歴
                      </h2>
                      <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">会社名</th>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">契約名</th>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">対象月</th>
                            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">消込額</th>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">消込日時</th>
                          </tr>
                        </thead>
                        <tbody id="allocation-history-body" class="divide-y divide-gray-200"></tbody>
                      </table>
                    </div>

                    <!-- 未入金月次明細一覧（消込対象がある場合のみ） -->
                    <div id="unpaid-section" class="hidden bg-white shadow rounded-lg p-6">
                      <div class="flex justify-between items-center mb-4">
                        <h2 class="text-lg font-bold text-gray-900">
                          <i class="fas fa-file-invoice-dollar mr-2 text-blue-500"></i>消込対象の月次明細
                        </h2>
                        <div class="flex items-center space-x-4">
                          <span class="text-sm text-gray-600">消込合計: <span id="alloc-total" class="font-bold text-teal-700">¥0</span></span>
                          <button onclick="executeAllocate()" id="allocate-btn" class="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-5 rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                            <i class="fas fa-check-double mr-1"></i>消込実行
                          </button>
                        </div>
                      </div>
                      <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 w-10">
                                      <input type="checkbox" id="select-all" class="rounded text-teal-600" onchange="toggleAll()">
                                    </th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">会社名</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">契約名</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">対象月</th>
                                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">税込金額</th>
                                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">入金済額</th>
                                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">未入金額</th>
                                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 w-36">消込額</th>
                                </tr>
                            </thead>
                            <tbody id="unpaid-table-body" class="divide-y divide-gray-200"></tbody>
                        </table>
                      </div>
                    </div>

                    <!-- 消込完了で対象なしメッセージ -->
                    <div id="completed-msg" class="hidden bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                      <i class="fas fa-check-circle text-4xl text-green-500 mb-3"></i>
                      <p class="text-green-800 font-semibold">この入金は消込完了です</p>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/auth.js"></script>
        <script>
          const DEPOSIT_ID = '${depositId}';
          const token = localStorage.getItem('jwt_token');
          if (!token) { window.location.href = '/login'; }
          axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;

          let depositData = null;
          let unpaidList = [];

          // 権限チェック
          async function checkPermission() {
            try {
              const res = await axios.get('/api/auth/me');
              const user = res.data.user;
              document.getElementById('nav-user-name').textContent = user.name || 'ユーザー';

              if (user.role === 'admin' || (user.permissions && user.permissions.includes('payment_manage'))) {
                document.getElementById('main-content').classList.remove('hidden');
                await loadData();
              } else {
                document.getElementById('permission-error').classList.remove('hidden');
              }
            } catch (e) {
              if (e.response?.status === 401) window.location.href = '/login';
            }
          }

          async function loadData() {
            try {
              // 銀行入金詳細
              const depositRes = await axios.get('/api/bank-deposits/' + DEPOSIT_ID);
              depositData = depositRes.data.data;

              document.getElementById('info-date').textContent = depositData.deposit_date;
              document.getElementById('info-payer').textContent = depositData.payer_name;
              document.getElementById('info-amount').textContent = '¥' + Number(depositData.amount).toLocaleString();
              document.getElementById('info-remaining').textContent = '¥' + Number(depositData.remaining_amount).toLocaleString();

              if (depositData.remaining_amount <= 0) {
                document.getElementById('info-remaining').textContent = '¥0';
                document.getElementById('info-remaining').classList.remove('text-orange-600');
                document.getElementById('info-remaining').classList.add('text-green-600');
              }

              // 消込済み履歴表示
              if (depositData.allocations && depositData.allocations.length > 0) {
                document.getElementById('allocation-history-section').classList.remove('hidden');
                const tbody = document.getElementById('allocation-history-body');
                tbody.innerHTML = depositData.allocations.map(a => \`
                  <tr class="hover:bg-gray-50">
                    <td class="px-4 py-2 text-sm text-gray-900">\${a.company_name}</td>
                    <td class="px-4 py-2 text-sm text-gray-700">\${a.contract_name}</td>
                    <td class="px-4 py-2 text-sm text-gray-700">\${a.target_month}</td>
                    <td class="px-4 py-2 text-sm text-right font-semibold text-gray-900">¥\${Number(a.allocated_amount).toLocaleString()}</td>
                    <td class="px-4 py-2 text-sm text-gray-500">\${new Date(a.created_at).toLocaleString('ja-JP')}</td>
                  </tr>
                \`).join('');
              }

              // 消込完了ならメッセージ、そうでなければ未入金一覧を表示
              if (depositData.remaining_amount <= 0) {
                document.getElementById('completed-msg').classList.remove('hidden');
              } else {
                // 未入金月次明細を取得
                const unpaidRes = await axios.get('/api/monthly-details/unpaid');
                unpaidList = unpaidRes.data.data;

                if (unpaidList.length === 0) {
                  document.getElementById('unpaid-section').classList.remove('hidden');
                  document.getElementById('unpaid-table-body').innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">消込対象の月次明細がありません</td></tr>';
                } else {
                  document.getElementById('unpaid-section').classList.remove('hidden');
                  renderUnpaidTable();
                }
              }
            } catch (e) {
              console.error('データの読み込みに失敗:', e);
              alert('データの読み込みに失敗しました');
            }
          }

          function renderUnpaidTable() {
            const tbody = document.getElementById('unpaid-table-body');
            tbody.innerHTML = unpaidList.map((md, idx) => {
              const taxAmount = md.amount_with_tax || md.amount;
              const paid = md.total_payment_amount || 0;
              const unpaid = taxAmount - paid;
              return \`<tr class="hover:bg-gray-50" id="row-\${idx}">
                <td class="px-3 py-2 text-center">
                  <input type="checkbox" class="alloc-check rounded text-teal-600" data-idx="\${idx}" onchange="onCheckChange(\${idx})">
                </td>
                <td class="px-4 py-2 text-sm text-gray-900 font-medium">\${md.company_name}\${md.department ? ' / ' + md.department : ''}</td>
                <td class="px-4 py-2 text-sm text-gray-700">\${md.contract_name}</td>
                <td class="px-4 py-2 text-sm text-gray-700">\${md.target_month}</td>
                <td class="px-4 py-2 text-sm text-right text-gray-900">¥\${Number(taxAmount).toLocaleString()}</td>
                <td class="px-4 py-2 text-sm text-right text-gray-500">¥\${Number(paid).toLocaleString()}</td>
                <td class="px-4 py-2 text-sm text-right font-semibold text-red-600">¥\${Number(unpaid).toLocaleString()}</td>
                <td class="px-4 py-2 text-right">
                  <input type="number" class="alloc-amount w-28 border-gray-300 rounded-md shadow-sm text-sm text-right p-1.5 border focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-100"
                    id="amount-\${idx}" data-idx="\${idx}" data-max="\${unpaid}" value="\${unpaid}" disabled
                    onchange="onAmountChange(\${idx})" oninput="onAmountChange(\${idx})">
                </td>
              </tr>\`;
            }).join('');
          }

          function toggleAll() {
            const selectAll = document.getElementById('select-all').checked;
            document.querySelectorAll('.alloc-check').forEach(cb => {
              cb.checked = selectAll;
              const idx = parseInt(cb.dataset.idx);
              const amountInput = document.getElementById('amount-' + idx);
              amountInput.disabled = !selectAll;
              if (!selectAll) {
                const md = unpaidList[idx];
                const unpaid = (md.amount_with_tax || md.amount) - (md.total_payment_amount || 0);
                amountInput.value = unpaid;
              }
            });
            updateTotal();
          }

          function onCheckChange(idx) {
            const cb = document.querySelector('.alloc-check[data-idx="' + idx + '"]');
            const amountInput = document.getElementById('amount-' + idx);
            amountInput.disabled = !cb.checked;
            if (!cb.checked) {
              const md = unpaidList[idx];
              const unpaid = (md.amount_with_tax || md.amount) - (md.total_payment_amount || 0);
              amountInput.value = unpaid;
            }
            updateTotal();
          }

          function onAmountChange(idx) {
            const input = document.getElementById('amount-' + idx);
            const max = parseInt(input.dataset.max);
            let val = parseInt(input.value) || 0;
            if (val < 0) val = 0;
            if (val > max) val = max;
            input.value = val;
            updateTotal();
          }

          function updateTotal() {
            let total = 0;
            document.querySelectorAll('.alloc-check:checked').forEach(cb => {
              const idx = parseInt(cb.dataset.idx);
              total += parseInt(document.getElementById('amount-' + idx).value) || 0;
            });
            document.getElementById('alloc-total').textContent = '¥' + total.toLocaleString();

            const btn = document.getElementById('allocate-btn');
            const remaining = depositData ? depositData.remaining_amount : 0;
            if (total > 0 && total <= remaining) {
              btn.disabled = false;
              btn.classList.remove('bg-gray-400');
            } else {
              btn.disabled = true;
            }

            // 残高超過の警告
            if (total > remaining) {
              document.getElementById('alloc-total').classList.add('text-red-600');
              document.getElementById('alloc-total').classList.remove('text-teal-700');
              document.getElementById('alloc-total').textContent += ' （残高超過）';
            } else {
              document.getElementById('alloc-total').classList.remove('text-red-600');
              document.getElementById('alloc-total').classList.add('text-teal-700');
            }
          }

          async function executeAllocate() {
            const allocations = [];
            document.querySelectorAll('.alloc-check:checked').forEach(cb => {
              const idx = parseInt(cb.dataset.idx);
              const amount = parseInt(document.getElementById('amount-' + idx).value) || 0;
              if (amount > 0) {
                allocations.push({
                  monthly_detail_id: unpaidList[idx].id,
                  amount: amount
                });
              }
            });

            if (allocations.length === 0) {
              alert('消込対象を選択してください');
              return;
            }

            const totalAllocating = allocations.reduce((s, a) => s + a.amount, 0);
            const msg = '以下の内容で消込を実行します。\\n\\n'
              + '消込件数: ' + allocations.length + '件\\n'
              + '消込合計額: ¥' + totalAllocating.toLocaleString() + '\\n\\n'
              + 'よろしいですか？';
            if (!confirm(msg)) return;

            const btn = document.getElementById('allocate-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>処理中...';

            try {
              await axios.post('/api/bank-deposits/' + DEPOSIT_ID + '/allocate', { allocations });
              alert('消込が完了しました');
              window.location.reload();
            } catch (e) {
              alert(e.response?.data?.error || '消込に失敗しました');
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-check-double mr-1"></i>消込実行';
            }
          }

          // 初期化
          checkPermission();
        </script>
    </body>
    </html>
  `)
})


export default app
