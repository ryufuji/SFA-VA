import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/admin/users', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ユーザー管理 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50 min-h-screen">
      <!-- ナビゲーション -->
      <nav class="bg-white shadow-sm border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex items-center">
              <i class="fas fa-chart-line text-2xl text-blue-600 mr-3"></i>
              <span class="text-xl font-semibold text-gray-800">SFA システム</span>
            </div>
            <div class="flex items-center space-x-4">
              <span id="user-name" class="text-gray-700"></span>
              <a href="/" class="text-gray-600 hover:text-blue-600">
                <i class="fas fa-home mr-1"></i>ダッシュボード
              </a>
              <a href="/settings" class="text-gray-600 hover:text-blue-600">
                <i class="fas fa-cog mr-1"></i>設定
              </a>
              <button id="logout-button" class="text-red-600 hover:text-red-700">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-8 px-4">
        <h1 class="text-3xl font-bold text-gray-800 mb-8">
          <i class="fas fa-users-cog mr-2"></i>ユーザー管理
        </h1>

        <!-- 成功・エラーメッセージ -->
        <div id="success-message" class="hidden bg-green-50 border-l-4 border-green-400 p-4 mb-4">
          <p class="text-sm text-green-700">
            <i class="fas fa-check-circle mr-2"></i>
            <span id="success-text"></span>
          </p>
        </div>
        <div id="error-message" class="hidden bg-red-50 border-l-4 border-red-400 p-4 mb-4">
          <p class="text-sm text-red-700">
            <i class="fas fa-exclamation-circle mr-2"></i>
            <span id="error-text"></span>
          </p>
        </div>

        <!-- ユーザー一覧 -->
        <div class="bg-white rounded-lg shadow-md overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ユーザー</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">役割</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">権限</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最終ログイン</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状態</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody id="users-table-body" class="bg-white divide-y divide-gray-200">
              <!-- JavaScript で動的に生成 -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- 権限編集モーダル -->
      <div id="permission-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-xl font-semibold text-gray-800 mb-4">
            <i class="fas fa-key mr-2"></i>権限設定
          </h3>
          <p class="text-gray-600 mb-4">
            ユーザー: <strong id="modal-user-name"></strong>
          </p>
          
          <div class="space-y-3 mb-6">
            <label class="flex items-center">
              <input type="checkbox" value="lead_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">リード・案件の登録/更新</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" value="contract_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">契約の登録/更新</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" value="billing_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">請求管理</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" value="payment_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">入金の登録</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" value="member_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">メンバー管理</span>
            </label>
          </div>

          <div class="flex space-x-3">
            <button 
              id="save-permissions-button"
              class="flex-1 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
              <i class="fas fa-save mr-2"></i>保存
            </button>
            <button 
              id="cancel-permissions-button"
              class="flex-1 py-2 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400">
              キャンセル
            </button>
          </div>
        </div>
      </div>

      <!-- パスワードリセットモーダル -->
      <div id="reset-password-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-xl font-semibold text-gray-800 mb-2">
            <i class="fas fa-key mr-2 text-orange-500"></i>パスワードリセット
          </h3>
          <p class="text-gray-600 mb-1">
            ユーザー: <strong id="reset-modal-user-name"></strong>
          </p>
          <p class="text-sm text-gray-500 mb-4">
            リセット後、対象ユーザーは次回ログイン時にパスワードの変更が求められます。
          </p>

          <div id="reset-error-message" class="hidden bg-red-50 border-l-4 border-red-400 p-3 mb-4">
            <p class="text-sm text-red-700">
              <i class="fas fa-exclamation-circle mr-1"></i>
              <span id="reset-error-text"></span>
            </p>
          </div>

          <div class="space-y-4 mb-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                <i class="fas fa-lock mr-1"></i>新しいパスワード
              </label>
              <input
                type="password"
                id="reset-new-password"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="新しいパスワード（6文字以上）"
                autocomplete="new-password">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                <i class="fas fa-lock mr-1"></i>パスワード確認
              </label>
              <input
                type="password"
                id="reset-confirm-password"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="パスワードを再入力"
                autocomplete="new-password">
            </div>
          </div>

          <div class="flex space-x-3">
            <button
              id="save-reset-password-button"
              class="flex-1 py-2 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700">
              <i class="fas fa-key mr-2"></i>リセット実行
            </button>
            <button
              id="cancel-reset-password-button"
              class="flex-1 py-2 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400">
              キャンセル
            </button>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>
        const API_BASE = '';
        const token = localStorage.getItem('jwt_token');
        
        if (!token) {
          window.location.href = '/login';
        }
        
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
        
        const PERMISSION_LABELS = {
          'lead_manage': 'リード・案件',
          'contract_manage': '契約',
          'billing_manage': '請求',
          'payment_manage': '入金',
          'member_manage': 'メンバー管理'
        };
        
        let currentEditUserId = null;
        let currentResetUserId = null;
        async function loadUsers() {
          try {
            const response = await axios.get(API_BASE + '/api/auth/me');
            const currentUser = response.data.user;
            document.getElementById('user-name').textContent = currentUser.name;
            
            // 管理者チェック
            if (currentUser.role !== 'admin') {
              document.getElementById('error-text').textContent = 'この画面を閲覧する権限がありません';
              document.getElementById('error-message').classList.remove('hidden');
              setTimeout(() => window.location.href = '/', 2000);
              return;
            }
            
            const usersResponse = await axios.get(API_BASE + '/api/admin/users');
            const users = usersResponse.data.data;
            
            const tbody = document.getElementById('users-table-body');
            tbody.innerHTML = users.map(user => {
              const permissionsBadges = user.role === 'admin' 
                ? '<span class="inline-block px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">全権限</span>'
                : user.permissions.length > 0
                  ? user.permissions.map(p => 
                      \`<span class="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded mr-1">\${PERMISSION_LABELS[p] || p}</span>\`
                    ).join('')
                  : '<span class="text-gray-400 text-sm">なし</span>';
              
              const statusBadge = user.isActive
                ? '<span class="inline-block px-2 py-1 text-xs bg-green-100 text-green-800 rounded">有効</span>'
                : '<span class="inline-block px-2 py-1 text-xs bg-red-100 text-red-800 rounded">無効</span>';
              
              const lastLogin = user.lastLoginAt 
                ? new Date(user.lastLoginAt).toLocaleDateString('ja-JP')
                : '未ログイン';
              
              const editButton = user.role === 'admin'
                ? '<span class="text-gray-400 text-sm">編集不可</span>'
                : \`<button onclick="openPermissionModal(\${user.id}, '\${user.name}', \${JSON.stringify(user.permissions).replace(/"/g, '&quot;')})" 
                       class="text-blue-600 hover:text-blue-700 mr-3">
                      <i class="fas fa-edit mr-1"></i>権限編集
                    </button>
                    <button onclick="openResetPasswordModal(\${user.id}, '\${user.name}')"
                       class="text-orange-600 hover:text-orange-700 mr-3">
                      <i class="fas fa-key mr-1"></i>PW初期化
                    </button>
                    <button onclick="toggleUserActive(\${user.id}, \${!user.isActive})" 
                       class="text-\${user.isActive ? 'red' : 'green'}-600 hover:text-\${user.isActive ? 'red' : 'green'}-700">
                      <i class="fas fa-\${user.isActive ? 'ban' : 'check'} mr-1"></i>\${user.isActive ? '無効化' : '有効化'}
                    </button>\`;
              
              return \`
                <tr>
                  <td class="px-6 py-4">
                    <div class="text-sm font-medium text-gray-900">\${user.name}</div>
                    <div class="text-sm text-gray-500">\${user.email}</div>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    \${user.role === 'admin' ? '<i class="fas fa-crown text-yellow-500 mr-1"></i>管理者' : '一般ユーザー'}
                  </td>
                  <td class="px-6 py-4 text-sm">
                    \${permissionsBadges}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500">\${lastLogin}</td>
                  <td class="px-6 py-4">\${statusBadge}</td>
                  <td class="px-6 py-4 text-sm">\${editButton}</td>
                </tr>
              \`;
            }).join('');
          } catch (error) {
            console.error('ユーザー一覧の取得に失敗:', error);
            document.getElementById('error-text').textContent = error.response?.data?.error || 'データの取得に失敗しました';
            document.getElementById('error-message').classList.remove('hidden');
          }
        }
        
        // 権限編集モーダルを開く
        window.openPermissionModal = function(userId, userName, permissions) {
          currentEditUserId = userId;
          document.getElementById('modal-user-name').textContent = userName;
          
          // チェックボックスをリセット
          document.querySelectorAll('.permission-checkbox').forEach(cb => {
            cb.checked = permissions.includes(cb.value);
          });
          
          document.getElementById('permission-modal').classList.remove('hidden');
        };
        
        // 権限編集モーダルを閉じる
        document.getElementById('cancel-permissions-button').addEventListener('click', () => {
          document.getElementById('permission-modal').classList.add('hidden');
          currentEditUserId = null;
        });
        
        // 権限を保存
        document.getElementById('save-permissions-button').addEventListener('click', async () => {
          const permissions = Array.from(document.querySelectorAll('.permission-checkbox:checked'))
            .map(cb => cb.value);
          
          try {
            await axios.put(API_BASE + \`/api/admin/users/\${currentEditUserId}/permissions\`, {
              permissions: permissions
            });
            
            document.getElementById('success-text').textContent = '権限を更新しました';
            document.getElementById('success-message').classList.remove('hidden');
            document.getElementById('permission-modal').classList.add('hidden');
            
            setTimeout(() => {
              document.getElementById('success-message').classList.add('hidden');
            }, 3000);
            
            loadUsers();
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || '権限の更新に失敗しました';
            document.getElementById('error-message').classList.remove('hidden');
          }
        });

        // パスワードリセットモーダルを開く
        window.openResetPasswordModal = function(userId, userName) {
          currentResetUserId = userId;
          document.getElementById('reset-modal-user-name').textContent = userName;
          document.getElementById('reset-new-password').value = '';
          document.getElementById('reset-confirm-password').value = '';
          document.getElementById('reset-error-message').classList.add('hidden');
          document.getElementById('reset-password-modal').classList.remove('hidden');
        };

        // パスワードリセットモーダルを閉じる
        document.getElementById('cancel-reset-password-button').addEventListener('click', () => {
          document.getElementById('reset-password-modal').classList.add('hidden');
          currentResetUserId = null;
        });

        // パスワードリセット実行
        document.getElementById('save-reset-password-button').addEventListener('click', async () => {
          const newPassword = document.getElementById('reset-new-password').value;
          const confirmPassword = document.getElementById('reset-confirm-password').value;
          const errorMsg = document.getElementById('reset-error-message');
          const errorText = document.getElementById('reset-error-text');

          // バリデーション
          if (!newPassword) {
            errorText.textContent = '新しいパスワードを入力してください';
            errorMsg.classList.remove('hidden');
            return;
          }
          if (newPassword.length < 6) {
            errorText.textContent = 'パスワードは6文字以上で入力してください';
            errorMsg.classList.remove('hidden');
            return;
          }
          if (newPassword !== confirmPassword) {
            errorText.textContent = 'パスワードが一致しません';
            errorMsg.classList.remove('hidden');
            return;
          }

          try {
            const response = await axios.post(API_BASE + \`/api/admin/users/\${currentResetUserId}/reset-password\`, {
              new_password: newPassword
            });

            document.getElementById('success-text').textContent = response.data.message || 'パスワードをリセットしました';
            document.getElementById('success-message').classList.remove('hidden');
            document.getElementById('reset-password-modal').classList.add('hidden');
            currentResetUserId = null;

            setTimeout(() => {
              document.getElementById('success-message').classList.add('hidden');
            }, 5000);

            loadUsers();
          } catch (error) {
            errorText.textContent = error.response?.data?.error || 'パスワードのリセットに失敗しました';
            errorMsg.classList.remove('hidden');
          }
        });
        
        // ユーザーの有効/無効を切り替え
        window.toggleUserActive = async function(userId, isActive) {
          const action = isActive ? '有効化' : '無効化';
          if (!confirm(\`このユーザーを\${action}しますか？\`)) {
            return;
          }
          
          try {
            await axios.put(API_BASE + \`/api/admin/users/\${userId}/active\`, {
              is_active: isActive
            });
            
            document.getElementById('success-text').textContent = \`ユーザーを\${action}しました\`;
            document.getElementById('success-message').classList.remove('hidden');
            
            setTimeout(() => {
              document.getElementById('success-message').classList.add('hidden');
            }, 3000);
            
            loadUsers();
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || \`\${action}に失敗しました\`;
            document.getElementById('error-message').classList.remove('hidden');
          }
        };
        
        // ログアウト
        document.getElementById('logout-button').addEventListener('click', async () => {
          try {
            await axios.post(API_BASE + '/api/auth/logout');
          } catch (error) {
            console.error('ログアウトエラー:', error);
          }
          localStorage.removeItem('jwt_token');
          window.location.href = '/login';
        });
        
        loadUsers();
      </script>
    </body>
    </html>
  `)
})

app.get('/admin/import', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>データインポート - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
      <!-- ナビゲーション -->
      <nav class="bg-white shadow-sm border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex items-center">
              <i class="fas fa-chart-line text-2xl text-blue-600 mr-3"></i>
              <span class="text-xl font-semibold text-gray-800">SFA システム</span>
            </div>
            <div class="flex items-center space-x-4">
              <span id="nav-user-name" class="text-gray-700">読込中...</span>
              <a href="/" class="text-gray-600 hover:text-blue-600">
                <i class="fas fa-home mr-1"></i>ダッシュボード
              </a>
              <a href="/admin/users" class="text-gray-600 hover:text-blue-600">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
              </a>
              <button onclick="AUTH_UTILS.logout()" class="text-red-600 hover:text-red-700">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-8 px-4">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">
          <i class="fas fa-file-import mr-2"></i>データインポート
        </h1>
        <p class="text-gray-600 mb-8">NotionなどからエクスポートしたCSVファイルをインポートできます</p>

        <!-- 移行ガイドへのリンク -->
        <div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
          <div class="flex">
            <i class="fas fa-info-circle text-blue-400 mt-0.5 mr-2"></i>
            <div>
              <p class="text-sm font-semibold text-blue-800">Notionからの移行ガイド</p>
              <p class="text-xs text-blue-700 mt-1">
                Notionからのデータ移行方法については
                <a href="/NOTION_MIGRATION_GUIDE.md" target="_blank" class="underline font-semibold">移行ガイド</a>
                をご参照ください
              </p>
            </div>
          </div>
        </div>

        <!-- インポート対象選択 -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">
            <i class="fas fa-database mr-2"></i>インポート対象
          </h2>
          <select id="import-type" onchange="updateFormatGuide()" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="">選択してください</option>
            <option value="members">メンバー</option>
            <option value="leads">リード（顧客情報）</option>
            <option value="projects">案件</option>
            <option value="contracts">契約</option>
          </select>
        </div>

        <!-- CSVフォーマット説明 -->
        <div id="format-guide" class="bg-white rounded-lg shadow p-6 mb-6 hidden">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">
            <i class="fas fa-file-csv mr-2"></i>必要なCSV列
          </h3>
          <div class="bg-gray-50 p-4 rounded mb-4">
            <pre id="csv-format" class="text-sm font-mono whitespace-pre-wrap"></pre>
          </div>
          <button onclick="downloadTemplate()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <i class="fas fa-download mr-2"></i>テンプレートをダウンロード
          </button>
        </div>

        <!-- ファイルアップロード -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">
            <i class="fas fa-upload mr-2"></i>CSVファイル選択
          </h2>
          <input type="file" id="csv-file" accept=".csv" class="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100 mb-4">
          <button onclick="previewImport()" class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <i class="fas fa-eye mr-2"></i>プレビュー
          </button>
        </div>

        <!-- プレビュー -->
        <div id="preview-section" class="bg-white rounded-lg shadow p-6 mb-6 hidden">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">
            <i class="fas fa-list-check mr-2"></i>インポートプレビュー
          </h2>
          <div class="mb-4 p-4 bg-blue-50 rounded">
            <span class="font-medium text-gray-700">検出件数:</span> 
            <span id="record-count" class="text-2xl font-bold text-blue-600 ml-2"></span>件
          </div>
          <div id="preview-table" class="overflow-x-auto mb-6"></div>
          
          <!-- オプション -->
          <div class="space-y-3 mb-6 p-4 bg-gray-50 rounded">
            <h3 class="font-semibold text-gray-800 mb-2">インポートオプション</h3>
            <label class="flex items-center">
              <input type="checkbox" id="skip-duplicates" checked class="w-4 h-4 text-blue-600 mr-3">
              <span class="text-sm">重複データをスキップ（メールアドレスや会社名で判定）</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" id="auto-match" checked class="w-4 h-4 text-blue-600 mr-3">
              <span class="text-sm">リレーションを自動マッチング（会社名やメールアドレスでID検索）</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" id="dry-run" checked class="w-4 h-4 text-blue-600 mr-3">
              <span class="text-sm text-yellow-700 font-semibold">テスト実行（実際にはデータを書き込まない）</span>
            </label>
          </div>
          
          <button onclick="executeImport()" class="px-8 py-3 bg-red-600 text-white rounded-lg text-lg font-semibold hover:bg-red-700">
            <i class="fas fa-upload mr-2"></i>インポート実行
          </button>
        </div>

        <!-- 実行結果 -->
        <div id="result-section" class="bg-white rounded-lg shadow p-6 hidden">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">
            <i class="fas fa-chart-bar mr-2"></i>インポート結果
          </h2>
          <div id="result-content"></div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
      <script>

        // CSVフォーマット定義
        const formats = {
          members: {
            columns: ['name', 'email', 'default_unit_price', 'position', 'memo', 'status'],
            description: '名前（必須）,メールアドレス（必須）,デフォルト単価（必須）,役職,メモ,ステータス',
            example: 'name,email,default_unit_price,position,memo,status\\n山田太郎,yamada@example.com,500000,シニアコンサルタント,備考,active\\n佐藤花子,sato@example.com,600000,マネージャー,,active'
          },
          leads: {
            columns: ['company_name', 'department', 'contact_person', 'email', 'phone', 'status'],
            description: '会社名（必須）,部署名,担当者名,メールアドレス,電話番号,ステータス',
            example: 'company_name,department,contact_person,email,phone,status\\n株式会社サンプル,営業部,山田太郎,yamada@example.com,03-1234-5678,active\\n株式会社テスト,開発部,佐藤花子,sato@test.com,03-2345-6789,active'
          },
          projects: {
            columns: ['project_name', 'company_name', 'sales_rep_email', 'status'],
            description: '案件名（必須）,会社名（必須・自動でlead_idに変換）,営業担当メールアドレス（自動でsales_rep_idに変換）,ステータス',
            example: 'project_name,company_name,sales_rep_email,status\\nシステム開発案件A,株式会社サンプル,yamada@example.com,won\\nWebサイト制作,株式会社テスト,,active'
          },
          contracts: {
            columns: ['contract_name', 'project_name', 'contract_start_date', 'contract_end_date', 'contract_amount', 'contract_type', 'payment_type', 'status'],
            description: '契約名（必須）,案件名（必須・自動でproject_idに変換）,開始日（YYYY-MM-DD）,終了日（YYYY-MM-DD）,契約金額,契約形態,支払形態,ステータス',
            example: 'contract_name,project_name,contract_start_date,contract_end_date,contract_amount,contract_type,payment_type,status\\nQ1 2026 契約,システム開発案件A,2026-01-01,2026-03-31,3000000,準委任,毎月支払,active'
          }
        };

        let csvData = null;

        document.addEventListener('DOMContentLoaded', async function() {
          AUTH_UTILS.checkAuth();
          AUTH_UTILS.setupAxios();
          const user = await AUTH_UTILS.getCurrentUser();
          if (user) {
            document.getElementById('nav-user-name').textContent = user.name;
            if (user.role !== 'admin') {
              alert('管理者権限が必要です');
              window.location.href = '/';
            }
          }
        });

        function updateFormatGuide() {
          const type = document.getElementById('import-type').value;
          const guide = document.getElementById('format-guide');
          
          if (!type) {
            guide.classList.add('hidden');
            return;
          }
          
          const format = formats[type];
          document.getElementById('csv-format').textContent = 
            format.description + '\n\n例:\\n' + format.example.replace(/\\\\n/g, '\\n');
          guide.classList.remove('hidden');
        }

        function downloadTemplate() {
          const type = document.getElementById('import-type').value;
          if (!type) return;
          
          const format = formats[type];
          const csv = format.example.replace(/\\\\n/g, '\\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = type + '_template.csv';
          link.click();
        }

        function previewImport() {
          const file = document.getElementById('csv-file').files[0];
          const type = document.getElementById('import-type').value;
          
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }
          if (!type) {
            alert('インポート対象を選択してください');
            return;
          }
          
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
              csvData = results.data;
              displayPreview(results.data, type);
            },
            error: function(error) {
              alert('CSVの読み込みに失敗しました: ' + error.message);
            }
          });
        }

        function displayPreview(data, type) {
          document.getElementById('record-count').textContent = data.length;
          document.getElementById('preview-section').classList.remove('hidden');
          
          const preview = data.slice(0, 10);
          let html = '<table class="min-w-full border border-gray-300"><thead><tr class="bg-gray-100">';
          
          if (preview.length > 0) {
            Object.keys(preview[0]).forEach(key => {
              html += '<th class="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">' + key + '</th>';
            });
            html += '</tr></thead><tbody>';
            
            preview.forEach((row, idx) => {
              html += '<tr class="' + (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50') + '">';
              Object.values(row).forEach(value => {
                html += '<td class="border border-gray-300 px-4 py-2 text-sm">' + (value || '<span class="text-gray-400">-</span>') + '</td>';
              });
              html += '</tr>';
            });
            html += '</tbody></table>';
            
            if (data.length > 10) {
              html += '<p class="mt-3 text-sm text-gray-600">※最初の10件のみ表示しています</p>';
            }
          } else {
            html = '<p class="text-red-600">データが見つかりませんでした</p>';
          }
          
          document.getElementById('preview-table').innerHTML = html;
        }

        async function executeImport() {
          const type = document.getElementById('import-type').value;
          const skipDuplicates = document.getElementById('skip-duplicates').checked;
          const autoMatch = document.getElementById('auto-match').checked;
          const dryRun = document.getElementById('dry-run').checked;
          
          if (!csvData) {
            alert('先にプレビューを実行してください');
            return;
          }
          
          const message = dryRun 
            ? 'テスト実行を開始しますか？（データは実際には登録されません）' 
            : '本番実行を開始しますか？データが実際に登録されます。';
          
          if (!confirm(message)) return;
          
          try {
            document.getElementById('result-section').classList.add('hidden');
            
            const response = await axios.post('/api/admin/import', {
              type: type,
              data: csvData,
              skip_duplicates: skipDuplicates,
              auto_match: autoMatch,
              dry_run: dryRun
            });
            
            displayResult(response.data);
          } catch (error) {
            alert('インポートに失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        function displayResult(result) {
          document.getElementById('result-section').classList.remove('hidden');
          document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
          
          let html = '';
          
          if (result.dry_run) {
            html += '<div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">';
            html += '<p class="font-semibold text-yellow-800"><i class="fas fa-exclamation-triangle mr-2"></i>テスト実行結果（データは登録されていません）</p>';
            html += '</div>';
          } else {
            html += '<div class="bg-green-50 border-l-4 border-green-400 p-4 mb-6">';
            html += '<p class="font-semibold text-green-800"><i class="fas fa-check-circle mr-2"></i>本番実行完了</p>';
            html += '</div>';
          }
          
          html += '<div class="grid grid-cols-3 gap-4 mb-6">';
          html += '<div class="bg-green-50 border border-green-200 p-6 rounded-lg text-center">';
          html += '<p class="text-sm text-gray-600 mb-1">成功</p>';
          html += '<p class="text-4xl font-bold text-green-600">' + result.success_count + '</p>';
          html += '</div>';
          html += '<div class="bg-red-50 border border-red-200 p-6 rounded-lg text-center">';
          html += '<p class="text-sm text-gray-600 mb-1">失敗</p>';
          html += '<p class="text-4xl font-bold text-red-600">' + result.error_count + '</p>';
          html += '</div>';
          html += '<div class="bg-gray-50 border border-gray-200 p-6 rounded-lg text-center">';
          html += '<p class="text-sm text-gray-600 mb-1">スキップ</p>';
          html += '<p class="text-4xl font-bold text-gray-600">' + result.skipped_count + '</p>';
          html += '</div>';
          html += '</div>';
          
          if (result.errors && result.errors.length > 0) {
            html += '<div class="mt-6">';
            html += '<h3 class="font-semibold text-gray-800 mb-3"><i class="fas fa-exclamation-circle mr-2 text-red-600"></i>エラー詳細:</h3>';
            html += '<div class="bg-red-50 border border-red-200 rounded-lg p-4 max-h-96 overflow-y-auto">';
            result.errors.forEach(err => {
              html += '<div class="mb-2 pb-2 border-b border-red-200 last:border-0">';
              html += '<p class="text-sm font-semibold text-red-800">行 ' + err.row + ':</p>';
              html += '<p class="text-sm text-red-700 ml-4">' + err.message + '</p>';
              html += '</div>';
            });
            html += '</div>';
            html += '</div>';
          }
          
          if (!result.dry_run && result.success_count > 0) {
            html += '<div class="mt-6 text-center">';
            html += '<a href="/" class="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">';
            html += '<i class="fas fa-home mr-2"></i>ダッシュボードに戻る';
            html += '</a>';
            html += '</div>';
          }
          
          document.getElementById('result-content').innerHTML = html;
        }
      </script>
    </body>
    </html>
  `)
})


export default app
