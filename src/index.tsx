import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, getUserPermissions, logAction, ADMIN_PERMISSIONS } from './auth'
import { generateJWT, authMiddleware, requirePermission, requireAdmin } from './middleware/auth'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// ========================================
// Test Routes (データベース不要)
// ========================================
app.get('/health', (c) => {
  return c.json({ status: 'ok', message: 'SFA API is running', timestamp: new Date().toISOString() })
})

app.get('/test', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SFA Test Page</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 p-8">
      <div class="max-w-4xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 class="text-3xl font-bold text-blue-600 mb-4">🎉 SFA システムが起動しました!</h1>
        <p class="text-gray-700 mb-4">データベース統合前のテストページです。</p>
        <div class="space-y-2">
          <p><strong>ステータス:</strong> <span class="text-green-600">稼働中</span></p>
          <p><strong>時刻:</strong> ${new Date().toISOString()}</p>
        </div>
        <div class="mt-6">
          <a href="/" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            ダッシュボードへ (DB接続後)
          </a>
        </div>
      </div>
    </body>
    </html>
  `)
})

// ログインページ
app.get('/login', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ログイン - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full">
        <!-- ロゴ・タイトル -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-600 text-white rounded-full mb-4">
            <i class="fas fa-chart-line text-2xl"></i>
          </div>
          <h1 class="text-3xl font-bold text-gray-800">SFA システム</h1>
          <p class="text-gray-600 mt-2">営業支援・契約管理システム</p>
        </div>

        <!-- ログインフォーム -->
        <div class="bg-white rounded-lg shadow-xl p-8">
          <h2 class="text-2xl font-bold text-gray-800 mb-6">ログイン</h2>
          
          <!-- エラーメッセージ -->
          <div id="error-message" class="hidden bg-red-50 border-l-4 border-red-400 p-4 mb-4">
            <div class="flex">
              <i class="fas fa-exclamation-circle text-red-400 mt-0.5 mr-2"></i>
              <p class="text-sm text-red-700" id="error-text"></p>
            </div>
          </div>

          <form id="login-form" class="space-y-4">
            <!-- メールアドレス -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-envelope mr-2"></i>メールアドレス
              </label>
              <input 
                type="email" 
                id="email" 
                name="email" 
                required 
                autocomplete="email"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="your.email@example.com">
            </div>

            <!-- パスワード -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-lock mr-2"></i>パスワード
              </label>
              <input 
                type="password" 
                id="password" 
                name="password" 
                required 
                autocomplete="current-password"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="パスワードを入力">
            </div>

            <!-- ログインボタン -->
            <button 
              type="submit" 
              id="login-button"
              class="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
              <i class="fas fa-sign-in-alt mr-2"></i>ログイン
            </button>
          </form>

          <!-- 初期ログイン情報 -->
          <div class="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p class="text-xs text-blue-800 mb-2">
              <i class="fas fa-info-circle mr-1"></i>
              <strong>初回ログイン情報</strong>
            </p>
            <div class="text-xs text-blue-700 space-y-1">
              <p><strong>管理者:</strong> admin@system.local</p>
              <p><strong>一般ユーザー:</strong> メンバーのメールアドレス</p>
              <p><strong>初期パスワード:</strong> va1234</p>
            </div>
          </div>
        </div>

        <!-- フッター -->
        <div class="text-center mt-6 text-sm text-gray-600">
          <p>&copy; 2026 SFA System. All rights reserved.</p>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        document.getElementById('login-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          const button = document.getElementById('login-button');
          const errorDiv = document.getElementById('error-message');
          const errorText = document.getElementById('error-text');
          
          // ボタンを無効化
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>ログイン中...';
          errorDiv.classList.add('hidden');
          
          try {
            const response = await axios.post('/api/auth/login', {
              email: email,
              password: password
            });
            
            if (response.data.success) {
              // JWTトークンをlocalStorageに保存
              localStorage.setItem('jwt_token', response.data.token);
              localStorage.setItem('user', JSON.stringify(response.data.user));
              
              // パスワード変更が必要な場合は強制的にパスワード変更画面へ
              if (response.data.password_change_required) {
                alert('初期パスワードを変更する必要があります。パスワード変更画面に移動します。');
                window.location.href = '/change-password?required=true';
              } else {
                // ダッシュボードへリダイレクト
                window.location.href = '/';
              }
            }
          } catch (error) {
            // エラー表示
            errorText.textContent = error.response?.data?.error || 'ログインに失敗しました';
            errorDiv.classList.remove('hidden');
            
            // ボタンを再度有効化
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>ログイン';
          }
        });
      </script>
    </body>
    </html>
  `)
})

// プロフィール画面
app.get('/profile', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>プロフィール - SFA</title>
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
              <button id="logout-button" class="text-red-600 hover:text-red-700">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-4xl mx-auto py-8 px-4">
        <h1 class="text-3xl font-bold text-gray-800 mb-8">
          <i class="fas fa-user-circle mr-2"></i>プロフィール
        </h1>

        <!-- ユーザー情報 -->
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">ユーザー情報</h2>
          <div class="space-y-3">
            <div class="flex">
              <span class="w-32 text-gray-600">メールアドレス:</span>
              <span id="user-email" class="font-medium"></span>
            </div>
            <div class="flex">
              <span class="w-32 text-gray-600">名前:</span>
              <span id="user-display-name" class="font-medium"></span>
            </div>
            <div class="flex">
              <span class="w-32 text-gray-600">役割:</span>
              <span id="user-role" class="font-medium"></span>
            </div>
            <div class="flex">
              <span class="w-32 text-gray-600">最終ログイン:</span>
              <span id="user-last-login" class="font-medium"></span>
            </div>
          </div>
        </div>

        <!-- 権限情報 -->
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">権限</h2>
          <div id="permissions-list" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <!-- JavaScript で動的に生成 -->
          </div>
        </div>

        <!-- パスワード変更 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold text-gray-800 mb-4">パスワード変更</h2>
          
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

          <form id="password-form" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                現在のパスワード
              </label>
              <input 
                type="password" 
                id="current-password" 
                name="current_password" 
                required 
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                新しいパスワード
              </label>
              <input 
                type="password" 
                id="new-password" 
                name="new_password" 
                required 
                minlength="6"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <p class="text-xs text-gray-500 mt-1">6文字以上で入力してください</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                新しいパスワード（確認）
              </label>
              <input 
                type="password" 
                id="confirm-password" 
                name="confirm_password" 
                required 
                minlength="6"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            </div>
            <button 
              type="submit" 
              class="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
              <i class="fas fa-key mr-2"></i>パスワードを変更
            </button>
          </form>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        const API_BASE = '';
        const token = localStorage.getItem('jwt_token');
        
        if (!token) {
          window.location.href = '/login';
        }
        
        // APIリクエスト設定
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
        
        const PERMISSION_LABELS = {
          'lead_manage': 'リード・案件の登録/更新',
          'contract_manage': '契約の登録/更新',
          'inspection_manage': '検収・請求の更新',
          'payment_manage': '入金の登録'
        };
        
        // ユーザー情報取得
        async function loadUserInfo() {
          try {
            const response = await axios.get(API_BASE + '/api/auth/me');
            const user = response.data.user;
            
            document.getElementById('user-name').textContent = user.name;
            document.getElementById('user-email').textContent = user.email;
            document.getElementById('user-display-name').textContent = user.name;
            document.getElementById('user-role').textContent = user.role === 'admin' ? '管理者' : '一般ユーザー';
            document.getElementById('user-last-login').textContent = user.lastLoginAt 
              ? new Date(user.lastLoginAt).toLocaleString('ja-JP')
              : '不明';
            
            // 権限表示
            const permissionsDiv = document.getElementById('permissions-list');
            if (user.role === 'admin') {
              permissionsDiv.innerHTML = '<div class="col-span-2 text-green-600 font-medium"><i class="fas fa-crown mr-2"></i>すべての権限（管理者）</div>';
            } else if (user.permissions && user.permissions.length > 0) {
              permissionsDiv.innerHTML = user.permissions.map(p => 
                \`<div class="flex items-center text-gray-700">
                  <i class="fas fa-check-circle text-green-500 mr-2"></i>
                  \${PERMISSION_LABELS[p] || p}
                </div>\`
              ).join('');
            } else {
              permissionsDiv.innerHTML = '<div class="col-span-2 text-gray-500">権限が設定されていません（閲覧のみ可能）</div>';
            }
          } catch (error) {
            console.error('ユーザー情報の取得に失敗:', error);
            if (error.response?.status === 401) {
              localStorage.removeItem('jwt_token');
              window.location.href = '/login';
            }
          }
        }
        
        // パスワード変更
        document.getElementById('password-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const currentPassword = document.getElementById('current-password').value;
          const newPassword = document.getElementById('new-password').value;
          const confirmPassword = document.getElementById('confirm-password').value;
          
          const errorDiv = document.getElementById('error-message');
          const successDiv = document.getElementById('success-message');
          errorDiv.classList.add('hidden');
          successDiv.classList.add('hidden');
          
          if (newPassword !== confirmPassword) {
            document.getElementById('error-text').textContent = '新しいパスワードが一致しません';
            errorDiv.classList.remove('hidden');
            return;
          }
          
          try {
            await axios.post(API_BASE + '/api/auth/change-password', {
              current_password: currentPassword,
              new_password: newPassword,
              confirm_password: confirmPassword
            });
            
            document.getElementById('success-text').textContent = 'パスワードを変更しました';
            successDiv.classList.remove('hidden');
            document.getElementById('password-form').reset();
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || 'パスワード変更に失敗しました';
            errorDiv.classList.remove('hidden');
          }
        });
        
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
        
        loadUserInfo();
      </script>
    </body>
    </html>
  `)
})

// パスワード変更画面
app.get('/change-password', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>パスワード変更 - SFA</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full">
        <!-- ロゴ・タイトル -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-600 text-white rounded-full mb-4">
            <i class="fas fa-lock text-2xl"></i>
          </div>
          <h1 class="text-3xl font-bold text-gray-800">パスワード変更</h1>
          <p class="text-gray-600 mt-2" id="subtitle">セキュリティのため、パスワードを変更してください</p>
        </div>

        <!-- 警告メッセージ（必須の場合のみ表示） -->
        <div id="required-warning" class="hidden bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
          <div class="flex">
            <i class="fas fa-exclamation-triangle text-yellow-400 mt-0.5 mr-2"></i>
            <div>
              <p class="text-sm font-semibold text-yellow-800">初期パスワードの変更が必要です</p>
              <p class="text-xs text-yellow-700 mt-1">セキュリティのため、初期パスワードから変更してください。</p>
            </div>
          </div>
        </div>

        <!-- パスワード変更フォーム -->
        <div class="bg-white rounded-lg shadow-xl p-8">
          <h2 class="text-2xl font-bold text-gray-800 mb-6">新しいパスワードを設定</h2>
          
          <!-- 成功メッセージ -->
          <div id="success-message" class="hidden bg-green-50 border-l-4 border-green-400 p-4 mb-4">
            <div class="flex">
              <i class="fas fa-check-circle text-green-400 mt-0.5 mr-2"></i>
              <p class="text-sm text-green-700" id="success-text"></p>
            </div>
          </div>

          <!-- エラーメッセージ -->
          <div id="error-message" class="hidden bg-red-50 border-l-4 border-red-400 p-4 mb-4">
            <div class="flex">
              <i class="fas fa-exclamation-circle text-red-400 mt-0.5 mr-2"></i>
              <p class="text-sm text-red-700" id="error-text"></p>
            </div>
          </div>

          <form id="change-password-form" class="space-y-4">
            <!-- 現在のパスワード -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-lock mr-2"></i>現在のパスワード
              </label>
              <input 
                type="password" 
                id="current_password" 
                name="current_password" 
                required 
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="現在のパスワードを入力">
            </div>

            <!-- 新しいパスワード -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-key mr-2"></i>新しいパスワード
              </label>
              <input 
                type="password" 
                id="new_password" 
                name="new_password" 
                required 
                minlength="6"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="新しいパスワード（6文字以上）">
              <p class="text-xs text-gray-500 mt-1">6文字以上で入力してください</p>
            </div>

            <!-- パスワード確認 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-key mr-2"></i>新しいパスワード（確認）
              </label>
              <input 
                type="password" 
                id="confirm_password" 
                name="confirm_password" 
                required 
                minlength="6"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="新しいパスワードを再入力">
            </div>

            <!-- 変更ボタン -->
            <button 
              type="submit" 
              id="change-button"
              class="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
              <i class="fas fa-save mr-2"></i>パスワードを変更
            </button>
          </form>

          <!-- キャンセルボタン（必須でない場合のみ表示） -->
          <div id="cancel-section" class="mt-4 text-center">
            <a href="/" class="text-sm text-gray-600 hover:text-blue-600">
              <i class="fas fa-arrow-left mr-1"></i>ダッシュボードに戻る
            </a>
          </div>
        </div>

        <!-- フッター -->
        <div class="text-center mt-6 text-sm text-gray-600">
          <p>&copy; 2026 SFA System. All rights reserved.</p>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        // URLパラメータから必須かどうかを確認
        const urlParams = new URLSearchParams(window.location.search);
        const isRequired = urlParams.get('required') === 'true';
        
        if (isRequired) {
          document.getElementById('required-warning').classList.remove('hidden');
          document.getElementById('cancel-section').style.display = 'none';
          document.getElementById('subtitle').textContent = '初期パスワードの変更が必須です';
        }
        
        // 認証チェック
        const token = localStorage.getItem('jwt_token');
        if (!token) {
          window.location.href = '/login';
        }
        
        // Axiosのデフォルトヘッダーに認証トークンを設定
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
        
        document.getElementById('change-password-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const currentPassword = document.getElementById('current_password').value;
          const newPassword = document.getElementById('new_password').value;
          const confirmPassword = document.getElementById('confirm_password').value;
          const button = document.getElementById('change-button');
          const errorDiv = document.getElementById('error-message');
          const errorText = document.getElementById('error-text');
          const successDiv = document.getElementById('success-message');
          const successText = document.getElementById('success-text');
          
          // クライアント側バリデーション
          if (newPassword !== confirmPassword) {
            errorText.textContent = '新しいパスワードが一致しません';
            errorDiv.classList.remove('hidden');
            successDiv.classList.add('hidden');
            return;
          }
          
          if (newPassword.length < 6) {
            errorText.textContent = 'パスワードは6文字以上で入力してください';
            errorDiv.classList.remove('hidden');
            successDiv.classList.add('hidden');
            return;
          }
          
          // ボタンを無効化
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>変更中...';
          errorDiv.classList.add('hidden');
          successDiv.classList.add('hidden');
          
          try {
            const response = await axios.post('/api/auth/change-password', {
              current_password: currentPassword,
              new_password: newPassword,
              confirm_password: confirmPassword
            });
            
            if (response.data.success) {
              successText.textContent = 'パスワードを変更しました。3秒後にダッシュボードに移動します。';
              successDiv.classList.remove('hidden');
              
              // 3秒後にダッシュボードへリダイレクト
              setTimeout(() => {
                window.location.href = '/';
              }, 3000);
            }
          } catch (error) {
            // エラー表示
            errorText.textContent = error.response?.data?.error || 'パスワード変更に失敗しました';
            errorDiv.classList.remove('hidden');
            
            // ボタンを再度有効化
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-save mr-2"></i>パスワードを変更';
          }
        });
      </script>
    </body>
    </html>
  `)
})

// 管理者用ユーザー管理画面
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
              <a href="/profile" class="text-gray-600 hover:text-blue-600">
                <i class="fas fa-user mr-1"></i>プロフィール
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
              <input type="checkbox" value="inspection_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">検収・請求の更新</span>
            </label>
            <label class="flex items-center">
              <input type="checkbox" value="payment_manage" class="permission-checkbox rounded text-blue-600 mr-2">
              <span class="text-gray-700">入金の登録</span>
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

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
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
          'inspection_manage': '検収・請求',
          'payment_manage': '入金'
        };
        
        let currentEditUserId = null;
        
        // ユーザー一覧取得
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

// データインポート画面（管理者専用）
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
      <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
      <script>
        const AUTH_UTILS = {
          checkAuth: function() {
            const token = localStorage.getItem('jwt_token');
            if (!token) {
              window.location.href = '/login';
              return false;
            }
            return true;
          },
          setupAxios: function() {
            const token = localStorage.getItem('jwt_token');
            if (token) {
              axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
            }
          },
          logout: function() {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('user');
            window.location.href = '/login';
          },
          getCurrentUser: async function() {
            try {
              const response = await axios.get('/api/auth/me');
              return response.data.user;
            } catch (error) {
              return null;
            }
          }
        };

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
            format.description + '\\n\\n例:\\n' + format.example.replace(/\\\\n/g, '\\n');
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

// ========================================
// API Routes
// ========================================

// --- リード API ---
// リード一覧取得（認証必須、閲覧のみ）
app.get('/api/leads', authMiddleware, async (c) => {
  const { DB } = c.env
  const { status, search } = c.req.query()
  
  let query = 'SELECT * FROM leads WHERE 1=1'
  const params: any[] = []
  
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  
  if (search) {
    query += ' AND (company_name LIKE ? OR contact_person LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  
  query += ' ORDER BY created_at DESC'
  
  const { results } = await DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: results })
})

// リード詳細取得（認証必須、閲覧のみ）
app.get('/api/leads/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first()
  if (!lead) {
    return c.json({ success: false, error: 'Lead not found' }, 404)
  }
  
  // 関連する案件も取得
  const { results: projects } = await DB.prepare(
    'SELECT * FROM projects WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...lead, projects } })
})

// リード作成（lead_manage権限が必要）
app.post('/api/leads', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { company_name, contact_person, department, email, phone } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO leads (company_name, contact_person, department, email, phone, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(company_name, contact_person || null, department || null, email || null, phone || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// リード更新（lead_manage権限が必要）
app.put('/api/leads/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { company_name, contact_person, department, email, phone } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  await DB.prepare(`
    UPDATE leads 
    SET company_name = ?, contact_person = ?, department = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(company_name, contact_person || null, department || null, email || null, phone || null, id).run()
  
  return c.json({ success: true })
})

// --- 案件 API ---
// 案件詳細取得（認証必須、閲覧のみ）
app.get('/api/projects/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  
  // リード情報を取得
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(project.lead_id).first()
  
  // 契約一覧を取得
  const { results: contracts } = await DB.prepare(
    'SELECT * FROM contracts WHERE project_id = ? ORDER BY contract_start_date DESC'
  ).bind(id).all()
  
  return c.json({ success: true, data: { ...project, lead, contracts } })
})

// 案件作成（lead_manage権限が必要）
app.post('/api/projects', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { lead_id, project_name, sales_rep_id } = body
  
  if (!lead_id || !project_name) {
    return c.json({ success: false, error: 'Lead ID and project name are required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO projects (lead_id, project_name, sales_rep_id, status) VALUES (?, ?, ?, ?)'
  ).bind(lead_id, project_name, sales_rep_id || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// 案件更新（lead_manage権限が必要）
app.put('/api/projects/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const { project_name, sales_rep_id, status } = await c.req.json()
  
  // 案件の存在確認
  const project = await DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  if (!project) {
    return c.json({ success: false, error: '案件が見つかりません' }, 404)
  }
  
  // バリデーション
  if (!project_name) {
    return c.json({ error: '案件名は必須です' }, 400)
  }
  
  // 許可されたステータスのみ
  const validStatuses = ['active', 'won', 'lost', 'archived']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: '無効なステータスです' }, 400)
  }
  
  try {
    // 案件を更新
    await DB.prepare(`
      UPDATE projects 
      SET project_name = ?,
          sales_rep_id = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      project_name,
      sales_rep_id || null,
      status || 'active',
      id
    ).run()
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'update_project',
      'projects',
      parseInt(id),
      {
        old_name: project.project_name,
        new_name: project_name,
        old_status: project.status,
        new_status: status || 'active',
        old_sales_rep_id: project.sales_rep_id,
        new_sales_rep_id: sales_rep_id
      },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ 
      success: true,
      message: '案件を更新しました'
    })
  } catch (error: any) {
    return c.json({ error: '案件の更新に失敗しました: ' + error.message }, 500)
  }
})

// --- 契約 API ---
// 契約詳細取得（認証必須、閲覧のみ）
app.get('/api/contracts/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const contract = await DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first()
  if (!contract) {
    return c.json({ success: false, error: 'Contract not found' }, 404)
  }
  
  // 月次明細を取得
  const { results: monthlyDetails } = await DB.prepare(
    'SELECT * FROM monthly_details WHERE contract_id = ? ORDER BY target_month ASC'
  ).bind(id).all()
  
  // メンバーアサインを取得
  const { results: members } = await DB.prepare(`
    SELECT cma.*, m.name as member_name 
    FROM contract_member_assignments cma
    JOIN members m ON cma.member_id = m.id
    WHERE cma.contract_id = ?
  `).bind(id).all()
  
  // 契約金額と月次明細合計の差異を計算
  const monthlyTotal = monthlyDetails.reduce((sum: number, detail: any) => sum + detail.amount, 0)
  const difference = (contract as any).contract_amount - monthlyTotal
  
  return c.json({ 
    success: true, 
    data: { 
      ...contract, 
      monthlyDetails, 
      members,
      monthlyTotal,
      difference
    } 
  })
})

// 契約を更新（認証必須、contract_manage権限必要）
app.put('/api/contracts/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const { contract_name, contract_type, contract_date, notes, status, payment_type } = await c.req.json()
  
  // 契約の存在確認
  const contract = await DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first()
  if (!contract) {
    return c.json({ success: false, error: '契約が見つかりません' }, 404)
  }
  
  // バリデーション
  if (!contract_name) {
    return c.json({ error: '契約名は必須です' }, 400)
  }
  
  // 許可されたステータスのみ
  const validStatuses = ['active', 'completed', 'cancelled', 'suspended']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: '無効なステータスです' }, 400)
  }
  
  try {
    // 契約を更新
    await DB.prepare(`
      UPDATE contracts 
      SET contract_name = ?,
          contract_type = ?,
          contract_date = ?,
          notes = ?,
          status = ?,
          payment_type = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      contract_name,
      contract_type || '準委任',
      contract_date || null,
      notes || null,
      status || 'active',
      payment_type || '毎月支払',
      id
    ).run()
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'update_contract',
      'contracts',
      parseInt(id),
      {
        old_name: contract.contract_name,
        new_name: contract_name,
        old_status: contract.status,
        new_status: status || 'active'
      },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ 
      success: true,
      message: '契約を更新しました'
    })
  } catch (error: any) {
    return c.json({ error: '契約の更新に失敗しました: ' + error.message }, 500)
  }
})

// app.post('/api/contracts', async (c) => {
//   const { DB } = c.env
//   const body = await c.req.json()
//   const { project_id, contract_name, contract_start_date, contract_end_date, contract_amount } = body
//   
//   if (!project_id || !contract_start_date || !contract_end_date || !contract_amount) {
//     return c.json({ success: false, error: 'All fields are required' }, 400)
//   }
//   
//   // 契約を作成
//   const result = await DB.prepare(
//     'INSERT INTO contracts (project_id, contract_name, contract_start_date, contract_end_date, contract_amount, status) VALUES (?, ?, ?, ?, ?, ?)'
//   ).bind(project_id, contract_name, contract_start_date, contract_end_date, contract_amount, 'active').run()
//   
//   const contractId = result.meta.last_row_id
//   
//   // 月次明細を自動生成
//   const startDate = new Date(contract_start_date)
//   const endDate = new Date(contract_end_date)
//   
//   const months: string[] = []
//   let currentDate = new Date(startDate)
//   
//   while (currentDate <= endDate) {
//     const yearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
//     if (!months.includes(yearMonth)) {
//       months.push(yearMonth)
//     }
//     currentDate.setMonth(currentDate.getMonth() + 1)
//   }
//   
//   // 均等割で月次明細を作成
//   const amountPerMonth = Math.floor(contract_amount / months.length)
//   
//   for (const month of months) {
//     await DB.prepare(
//       'INSERT INTO monthly_details (contract_id, target_month, amount, inspection_status, billing_status, payment_status, total_payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
//     ).bind(contractId, month, amountPerMonth, '未検収', '未請求', '未入金', 0).run()
//   }
//   
//   return c.json({ success: true, data: { id: contractId, monthsGenerated: months.length } })
// })

// 上記の古い契約作成APIは390行目の新しいバージョンと重複しているため、
// 新しいバージョン（メンバーアサイン対応版）が優先されるはず

// --- 月次明細 API ---
// 月次明細詳細取得（認証必須、閲覧のみ）
app.get('/api/monthly-details/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const detail = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!detail) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // 入金履歴を取得
  const { results: paymentHistories } = await DB.prepare(
    'SELECT * FROM payment_histories WHERE monthly_detail_id = ? ORDER BY payment_date ASC'
  ).bind(id).all()
  
  // ステータス変更履歴を取得
  const { results: statusHistories } = await DB.prepare(
    'SELECT * FROM status_change_histories WHERE table_name = ? AND record_id = ? ORDER BY changed_at DESC LIMIT 10'
  ).bind('monthly_details', id).all()
  
  return c.json({ success: true, data: { ...detail, paymentHistories, statusHistories } })
})

// 月次明細更新（contract_manage権限が必要）
app.put('/api/monthly-details/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { 
    amount, 
    inspection_status, 
    inspection_date, 
    inspection_reason,
    billing_status, 
    billing_date, 
    invoice_number,
    billing_reason
  } = body
  
  // 現在の値を取得
  const current = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (!current) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  // システム設定を取得
  const requireReasonSetting = await DB.prepare(
    'SELECT value FROM system_settings WHERE key = ?'
  ).bind('require_status_change_reason').first() as any
  
  const requireReason = requireReasonSetting?.value || 'rollback_only'
  
  // ステータス変更履歴を記録
  if (inspection_status && inspection_status !== current.inspection_status) {
    // 巻き戻しの場合、理由が必須
    const isRollback = inspection_status === '未検収' && current.inspection_status === '検収済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !inspection_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'inspection_status', current.inspection_status, inspection_status, inspection_reason || '', '管理者').run()
  }
  
  if (billing_status && billing_status !== current.billing_status) {
    const isRollback = billing_status === '未請求' && current.billing_status === '請求済'
    if ((requireReason === 'always' || (requireReason === 'rollback_only' && isRollback)) && !billing_reason) {
      return c.json({ success: false, error: 'Change reason is required' }, 400)
    }
    
    await DB.prepare(
      'INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('monthly_details', id, 'billing_status', current.billing_status, billing_status, billing_reason || '', '管理者').run()
  }
  
  // 月次明細を更新
  await DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, 
        inspection_status = ?, 
        inspection_date = ?,
        billing_status = ?, 
        billing_date = ?, 
        invoice_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    amount || current.amount,
    inspection_status || current.inspection_status,
    inspection_date || current.inspection_date,
    billing_status || current.billing_status,
    billing_date || current.billing_date,
    invoice_number || current.invoice_number,
    id
  ).run()
  
  return c.json({ success: true, message: 'Updated successfully' })
})

// --- 入金履歴 API ---
// 入金追加（payment_manage権限が必要）
app.post('/api/payment-histories', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { monthly_detail_id, payment_date, payment_amount, note } = body
  
  // 基本的な必須フィールドチェック
  if (!monthly_detail_id || !payment_date || payment_amount === undefined || payment_amount === null) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }
  
  // 月次明細の金額を取得
  const detail = await DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  if (!detail) {
    return c.json({ success: false, error: 'Monthly detail not found' }, 404)
  }
  
  const monthlyAmount = detail.amount || 0
  
  // 入金額が0円の場合、月次明細の金額も0円でないとエラー
  if (payment_amount === 0 && monthlyAmount !== 0) {
    return c.json({ success: false, error: '0円の入金は、月次明細の金額が0円の場合のみ登録できます' }, 400)
  }
  
  // 入金額が負の値の場合はエラー
  if (payment_amount < 0) {
    return c.json({ success: false, error: '入金額は0以上である必要があります' }, 400)
  }
  
  // 入金履歴を追加
  const result = await DB.prepare(
    'INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(monthly_detail_id, payment_date, payment_amount, note || null, '管理者').run()
  
  // 変更履歴を記録
  await DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('payment_histories', result.meta.last_row_id, 'payment_added', 'null', `¥${payment_amount} (${payment_date})`, '管理者').run()
  
  // 累計入金額を再計算
  const { results: histories } = await DB.prepare(
    'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
  ).bind(monthly_detail_id).all()
  
  const totalPayment = (histories[0] as any)?.total || 0
  
  // 入金ステータスの判定
  let paymentStatus = '未入金'
  if (totalPayment >= monthlyAmount) {
    paymentStatus = '入金完了'
  } else if (totalPayment > 0) {
    paymentStatus = '部分入金'
  }
  
  await DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, 
        payment_status = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalPayment, paymentStatus, payment_date, monthly_detail_id).run()
  
  return c.json({ success: true, message: 'Payment added successfully', totalPayment, paymentStatus })
})

// --- 認証 API ---

// ログインAPI
app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  
  // バリデーション
  if (!email || !password) {
    return c.json({ error: 'メールアドレスとパスワードを入力してください' }, 400)
  }
  
  // ユーザー検索
  const user = await c.env.DB.prepare(`
    SELECT u.*, m.name as member_name 
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    WHERE u.email = ? AND u.is_active = 1
  `).bind(email).first()
  
  if (!user) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }
  
  // パスワード検証
  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }
  
  // 権限取得
  const permissions = user.role === 'admin' 
    ? ADMIN_PERMISSIONS
    : await getUserPermissions(c.env.DB, user.id)
  
  // JWT生成
  const token = await generateJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    permissions: permissions
  })
  
  // 最終ログイン時刻更新
  await c.env.DB.prepare(`
    UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(user.id).run()
  
  // 監査ログ記録
  await logAction(c.env.DB, user.id, 'login', null, null, {}, c.req.header('CF-Connecting-IP'))
  
  return c.json({
    success: true,
    token: token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.member_name || '管理者',
      permissions: permissions
    },
    password_change_required: user.password_change_required === 1
  })
})

// 現在のユーザー情報取得API
app.get('/api/auth/me', authMiddleware, async (c) => {
  const user = c.get('user')
  
  const userData = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.last_login_at, m.name as member_name 
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    WHERE u.id = ?
  `).bind(user.userId).first()
  
  if (!userData) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  return c.json({
    success: true,
    user: {
      id: userData.id,
      email: userData.email,
      role: userData.role,
      name: userData.member_name || '管理者',
      lastLoginAt: userData.last_login_at,
      permissions: user.permissions
    }
  })
})

// パスワード変更API
app.post('/api/auth/change-password', authMiddleware, async (c) => {
  const user = c.get('user')
  const { current_password, new_password, confirm_password } = await c.req.json()
  
  // バリデーション
  if (!current_password || !new_password || !confirm_password) {
    return c.json({ error: 'すべての項目を入力してください' }, 400)
  }
  
  if (new_password !== confirm_password) {
    return c.json({ error: '新しいパスワードが一致しません' }, 400)
  }
  
  if (new_password.length < 6) {
    return c.json({ error: 'パスワードは6文字以上で入力してください' }, 400)
  }
  
  // 現在のユーザー情報取得
  const userData = await c.env.DB.prepare(`
    SELECT password_hash FROM users WHERE id = ?
  `).bind(user.userId).first()
  
  if (!userData) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 現在のパスワード検証
  const isValid = await verifyPassword(current_password, userData.password_hash)
  if (!isValid) {
    return c.json({ error: '現在のパスワードが正しくありません' }, 401)
  }
  
  // 新しいパスワードをハッシュ化
  const newPasswordHash = await hashPassword(new_password)
  
  // パスワード更新（password_change_requiredフラグもクリア）
  await c.env.DB.prepare(`
    UPDATE users 
    SET password_hash = ?, password_change_required = 0, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).bind(newPasswordHash, user.userId).run()
  
  // 監査ログ記録
  await logAction(c.env.DB, user.userId, 'change_password', 'user', user.userId, {}, c.req.header('CF-Connecting-IP'))
  
  return c.json({ success: true, message: 'パスワードを変更しました' })
})

// ログアウトAPI（クライアント側でトークンを削除するため、サーバー側では特に処理なし）
app.post('/api/auth/logout', authMiddleware, async (c) => {
  const user = c.get('user')
  
  // 監査ログ記録
  await logAction(c.env.DB, user.userId, 'logout', null, null, {}, c.req.header('CF-Connecting-IP'))
  
  return c.json({ success: true, message: 'ログアウトしました' })
})

// --- ユーザー管理 API（管理者のみ）---

// ユーザー一覧取得API
app.get('/api/admin/users', authMiddleware, requireAdmin, async (c) => {
  const users = await c.env.DB.prepare(`
    SELECT 
      u.id,
      u.email,
      u.role,
      u.is_active,
      u.created_at,
      u.last_login_at,
      m.name as member_name,
      GROUP_CONCAT(up.permission_name) as permissions
    FROM users u
    LEFT JOIN members m ON u.member_id = m.id
    LEFT JOIN user_permissions up ON u.id = up.user_id
    GROUP BY u.id, u.email, u.role, u.is_active, u.created_at, u.last_login_at, m.name
    ORDER BY u.created_at DESC
  `).all()
  
  const formattedUsers = users.results.map((user: any) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.member_name || '管理者',
    isActive: user.is_active === 1,
    permissions: user.permissions ? user.permissions.split(',') : [],
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at
  }))
  
  return c.json({ success: true, data: formattedUsers })
})

// ユーザー権限更新API
app.put('/api/admin/users/:id/permissions', authMiddleware, requireAdmin, async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')
  const { permissions } = await c.req.json()
  
  // バリデーション
  if (!Array.isArray(permissions)) {
    return c.json({ error: '権限は配列形式で指定してください' }, 400)
  }
  
  const validPermissions = ['lead_manage', 'contract_manage', 'inspection_manage', 'payment_manage']
  const invalidPermissions = permissions.filter((p: string) => !validPermissions.includes(p))
  if (invalidPermissions.length > 0) {
    return c.json({ error: `無効な権限が含まれています: ${invalidPermissions.join(', ')}` }, 400)
  }
  
  // 対象ユーザーの確認
  const targetUser = await c.env.DB.prepare(`
    SELECT id, email, role FROM users WHERE id = ?
  `).bind(userId).first()
  
  if (!targetUser) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 管理者の権限は変更不可
  if (targetUser.role === 'admin') {
    return c.json({ error: '管理者の権限は変更できません' }, 403)
  }
  
  // 既存の権限を取得（監査ログ用）
  const oldPermissions = await c.env.DB.prepare(`
    SELECT permission_name FROM user_permissions WHERE user_id = ?
  `).bind(userId).all()
  
  const oldPermissionList = oldPermissions.results.map((p: any) => p.permission_name)
  
  // トランザクション開始（既存権限を削除して新しい権限を追加）
  await c.env.DB.prepare(`DELETE FROM user_permissions WHERE user_id = ?`).bind(userId).run()
  
  for (const permission of permissions) {
    await c.env.DB.prepare(`
      INSERT INTO user_permissions (user_id, permission_name) VALUES (?, ?)
    `).bind(userId, permission).run()
  }
  
  // 監査ログ記録
  await logAction(
    c.env.DB, 
    adminUser.userId, 
    'update_user_permissions', 
    'users', 
    userId, 
    {
      old_permissions: oldPermissionList,
      new_permissions: permissions
    },
    c.req.header('CF-Connecting-IP')
  )
  
  return c.json({ 
    success: true, 
    message: '権限を更新しました',
    data: {
      userId: userId,
      permissions: permissions
    }
  })
})

// ユーザーアクティブ状態変更API
app.put('/api/admin/users/:id/active', authMiddleware, requireAdmin, async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')
  const { is_active } = await c.req.json()
  
  // バリデーション
  if (typeof is_active !== 'boolean') {
    return c.json({ error: 'is_activeはboolean型で指定してください' }, 400)
  }
  
  // 対象ユーザーの確認
  const targetUser = await c.env.DB.prepare(`
    SELECT id, email, role, is_active FROM users WHERE id = ?
  `).bind(userId).first()
  
  if (!targetUser) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }
  
  // 管理者のアクティブ状態は変更不可
  if (targetUser.role === 'admin') {
    return c.json({ error: '管理者のアクティブ状態は変更できません' }, 403)
  }
  
  // 自分自身の状態は変更不可
  if (parseInt(userId) === adminUser.userId) {
    return c.json({ error: '自分自身のアクティブ状態は変更できません' }, 403)
  }
  
  // アクティブ状態を更新
  await c.env.DB.prepare(`
    UPDATE users SET is_active = ? WHERE id = ?
  `).bind(is_active ? 1 : 0, userId).run()
  
  // 監査ログ記録
  await logAction(
    c.env.DB, 
    adminUser.userId, 
    'update_user_status', 
    'users', 
    userId, 
    {
      old_status: targetUser.is_active === 1,
      new_status: is_active
    },
    c.req.header('CF-Connecting-IP')
  )
  
  return c.json({ 
    success: true, 
    message: `ユーザーを${is_active ? '有効' : '無効'}にしました` 
  })
})

// --- メンバー API ---
// メンバー一覧取得（認証必須、閲覧のみ）
app.get('/api/members', authMiddleware, async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(
    'SELECT * FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()
  
  return c.json({ success: true, data: results })
})

// --- 契約 API ---

// API: 契約作成（contract_manage権限が必要）
app.post('/api/contracts', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { project_id, contract_name, contract_type, contract_date, start_date, end_date, contract_amount, notes, payment_type, monthly_breakdown, member_assignments } = await c.req.json()

  // バリデーション
  if (!project_id || !contract_name || !start_date || !end_date || !contract_amount) {
    return c.json({ error: '必須項目が入力されていません' }, 400)
  }
  
  // 支払種別のデフォルト値
  const paymentTypeValue = payment_type || '毎月支払'

  // プロジェクト名を取得
  const project = await c.env.DB.prepare('SELECT project_name FROM projects WHERE id = ?').bind(project_id).first()
  if (!project) {
    return c.json({ error: 'プロジェクトが見つかりません' }, 404)
  }
  const projectName = project.project_name

  // 月数を計算
  const startDate = new Date(start_date)
  const endDate = new Date(end_date)
  
  if (startDate > endDate) {
    return c.json({ error: '開始日は終了日より前である必要があります' }, 400)
  }

  const months = []
  let current = new Date(startDate)
  while (current <= endDate) {
    const yearMonth = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0')
    months.push(yearMonth)
    current.setMonth(current.getMonth() + 1)
  }

  if (months.length === 0) {
    return c.json({ error: '契約期間が無効です' }, 400)
  }

  // 月次明細データの検証
  if (monthly_breakdown && monthly_breakdown.length > 0) {
    // 月次明細の合計が契約金額と一致するか確認
    const totalMonthlyAmount = monthly_breakdown.reduce((sum, item) => sum + parseInt(item.amount), 0)
    if (totalMonthlyAmount !== parseInt(contract_amount)) {
      return c.json({ 
        error: `月次明細の金額合計（¥${totalMonthlyAmount}）が契約金額（¥${contract_amount}）と一致しません` 
      }, 400)
    }
    
    // 月次明細の月数が契約期間の月数と一致するか確認
    if (monthly_breakdown.length !== months.length) {
      return c.json({ 
        error: `月次明細の件数（${monthly_breakdown.length}件）が契約期間の月数（${months.length}ヶ月）と一致しません` 
      }, 400)
    }
  }

  // 金額配分の計算（支払種別に応じて）
  let baseAmount, remainder
  if (paymentTypeValue === '初回全額支払') {
    // 初回全額支払の場合、初月に全額、以降は0円
    baseAmount = 0
    remainder = contract_amount
  } else {
    // 毎月支払の場合、均等割（端数は初月）
    baseAmount = Math.floor(contract_amount / months.length)
    remainder = contract_amount - (baseAmount * months.length)
  }

  try {
    // 契約を作成
    const contractResult = await c.env.DB.prepare(`
      INSERT INTO contracts (
        project_id, contract_name, contract_type, contract_date, contract_start_date, contract_end_date, 
        contract_amount, payment_type, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      project_id, contract_name, contract_type || '準委任', contract_date || null, start_date, end_date, 
      contract_amount, paymentTypeValue, 'active'
    ).run()

    const contractId = contractResult.meta.last_row_id

    // 月次明細を生成し、IDを保持
    const monthlyDetailIds = []
    for (let i = 0; i < months.length; i++) {
      // 月次明細データから金額と備考を取得（無ければ均等割）
      let monthAmount = i === 0 ? baseAmount + remainder : baseAmount
      let monthNote = ''
      
      if (monthly_breakdown && monthly_breakdown[i]) {
        monthAmount = parseInt(monthly_breakdown[i].amount)
        monthNote = monthly_breakdown[i].note || ''
      }
      
      // 月次明細の名称を生成: 案件名_YYYYMM
      const yearMonth = months[i].replace('-', '') // 2026-01 → 202601
      const monthlyName = `${projectName}_${yearMonth}`
      
      // 対象月の年月を解析
      const [year, month] = months[i].split('-').map(Number)
      
      // 検収日: 対象月の月末
      const inspectionDate = new Date(year, month, 0) // 月末を取得
      const inspectionDateStr = `${year}-${String(month).padStart(2, '0')}-${String(inspectionDate.getDate()).padStart(2, '0')}`
      
      // 請求日: 翌月1日
      const billingDate = new Date(year, month, 1)
      const billingDateStr = `${billingDate.getFullYear()}-${String(billingDate.getMonth() + 1).padStart(2, '0')}-01`
      
      // 入金予定日: 翌月末日
      const expectedPaymentDate = new Date(year, month + 1, 0)
      const expectedPaymentDateStr = `${expectedPaymentDate.getFullYear()}-${String(expectedPaymentDate.getMonth() + 1).padStart(2, '0')}-${String(expectedPaymentDate.getDate()).padStart(2, '0')}`
      
      const monthlyResult = await c.env.DB.prepare(`
        INSERT INTO monthly_details (
          contract_id, target_month, amount, name, notes,
          inspection_status, inspection_date, 
          billing_status, billing_date,
          payment_status, expected_payment_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        contractId, months[i], monthAmount, monthlyName, monthNote,
        '未検収', inspectionDateStr,
        '未請求', billingDateStr,
        '未入金', expectedPaymentDateStr
      ).run()
      
      monthlyDetailIds.push(monthlyResult.meta.last_row_id)
    }

    // メンバーアサインがある場合、各月次明細に追加
    if (member_assignments && member_assignments.length > 0) {
      for (let i = 0; i < monthlyDetailIds.length; i++) {
        const monthlyDetailId = monthlyDetailIds[i]
        for (const assignment of member_assignments) {
          // 初回全額支払の場合、2ヶ月目以降は単価を0にする
          let unitPrice = assignment.unit_price
          if (paymentTypeValue === '初回全額支払' && i > 0) {
            unitPrice = 0
          }
          
          await c.env.DB.prepare(`
            INSERT INTO monthly_member_assignments (
              monthly_detail_id, member_id, allocation_ratio, unit_price, notes
            ) VALUES (?, ?, ?, ?, ?)
          `).bind(
            monthlyDetailId,
            assignment.member_id,
            assignment.allocation_ratio,
            unitPrice,
            assignment.notes || ''
          ).run()
        }
      }
    }

    return c.json({ 
      success: true, 
      contract_id: contractId,
      monthly_details_count: months.length,
      member_assignments_count: member_assignments ? member_assignments.length : 0
    })
  } catch (error) {
    console.error('Contract creation error:', error)
    return c.json({ error: 'データベースエラーが発生しました: ' + error.message }, 500)
  }
})

// --- 月次明細 API ---

// API: 月次明細の検収情報更新（inspection_manage権限が必要）
app.put('/api/monthly-details/:id/inspection', authMiddleware, requirePermission('inspection_manage'), async (c) => {
  const id = c.req.param('id')
  const { inspection_status, inspection_date } = await c.req.json()

  // ステータス遷移のバリデーション
  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  if (current.inspection_status !== inspection_status) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'inspection_status', current.inspection_status, inspection_status, '管理者').run()
  }
  
  if (current.inspection_date !== inspection_date) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'inspection_date', current.inspection_date || 'null', inspection_date || 'null', '管理者').run()
  }

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET inspection_status = ?, inspection_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(inspection_status, inspection_date, id).run()

  return c.json({ success: true })
})

// API: 月次明細の請求情報更新（inspection_manage権限が必要）
app.put('/api/monthly-details/:id/billing', authMiddleware, requirePermission('inspection_manage'), async (c) => {
  const id = c.req.param('id')
  const { billing_status, billing_date, invoice_number, expected_payment_date } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  if (current.billing_status !== billing_status) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'billing_status', current.billing_status, billing_status, '管理者').run()
  }
  
  if (current.billing_date !== billing_date) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'billing_date', current.billing_date || 'null', billing_date || 'null', '管理者').run()
  }
  
  if (current.invoice_number !== invoice_number) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_details', id, 'invoice_number', current.invoice_number || 'null', invoice_number || 'null', '管理者').run()
  }

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET billing_status = ?, billing_date = ?, invoice_number = ?, expected_payment_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(billing_status, billing_date, invoice_number, expected_payment_date, id).run()

  return c.json({ success: true })
})

// API: 月次明細の金額更新（contract_manage権限が必要）
app.put('/api/monthly-details/:id/amount', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')
  const { amount } = await c.req.json()

  const current = await c.env.DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
  if (!current) return c.notFound()

  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('monthly_details', id, 'amount', current.amount.toString(), amount.toString(), '管理者').run()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(amount, id).run()

  return c.json({ success: true })
})

// API: 入金履歴削除
// 入金削除（payment_manage権限が必要）
app.delete('/api/payment-histories/:id', authMiddleware, requirePermission('payment_manage'), async (c) => {
  const id = c.req.param('id')

  // 入金履歴を取得
  const payment = await c.env.DB.prepare('SELECT * FROM payment_histories WHERE id = ?').bind(id).first()
  if (!payment) return c.notFound()

  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('payment_histories', id, 'payment_deleted', `¥${payment.payment_amount} (${payment.payment_date})`, 'null', '管理者').run()

  // 削除
  await c.env.DB.prepare('DELETE FROM payment_histories WHERE id = ?').bind(id).run()

  // 月次明細の合計入金額を更新
  const payments = await c.env.DB.prepare(`
    SELECT SUM(amount) as total FROM payment_histories WHERE monthly_detail_id = ?
  `).bind(payment.monthly_detail_id).first()

  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(payments.total || 0, payment.monthly_detail_id).run()

  return c.json({ success: true })
})

// API: 月次メンバーアサイン追加
// メンバーアサイン追加（contract_manage権限が必要）
app.post('/api/monthly-member-assignments', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { monthly_detail_id, member_id, allocation_ratio, unit_price, notes } = await c.req.json()

  // バリデーション
  if (!monthly_detail_id || !member_id || allocation_ratio === undefined || !unit_price) {
    return c.json({ success: false, error: 'Required fields are missing' }, 400)
  }

  // 稼働率は0-1の範囲
  if (allocation_ratio < 0 || allocation_ratio > 1) {
    return c.json({ success: false, error: 'Work ratio must be between 0 and 1' }, 400)
  }

  // 既存のアサインを確認
  const existing = await c.env.DB.prepare(`
    SELECT * FROM monthly_member_assignments 
    WHERE monthly_detail_id = ? AND member_id = ?
  `).bind(monthly_detail_id, member_id).first()

  if (existing) {
    return c.json({ success: false, error: 'Member is already assigned to this monthly detail' }, 400)
  }

  // 追加
  const result = await c.env.DB.prepare(`
    INSERT INTO monthly_member_assignments 
    (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
    VALUES (?, ?, ?, ?, ?)
  `).bind(monthly_detail_id, member_id, allocation_ratio, unit_price, notes || '').run()

  // メンバー名を取得
  const member = await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(member_id).first()
  
  // 変更履歴を記録
  await c.env.DB.prepare(`
    INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('monthly_member_assignments', result.meta.last_row_id, 'member_assigned', 'null', `${member.name} (稼働率:${allocation_ratio * 100}%, 単価:¥${unit_price})`, '管理者').run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// API: 月次メンバーアサイン バッチ登録
// メンバーアサイン一括追加（contract_manage権限が必要）
app.post('/api/monthly-member-assignments/batch', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { monthly_detail_id, assignments } = await c.req.json()

  // バリデーション
  if (!monthly_detail_id || !assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return c.json({ success: false, error: 'Invalid request format' }, 400)
  }

  const results = []
  const errors = []

  for (const assignment of assignments) {
    const { member_id, allocation_ratio, unit_price, notes } = assignment

    // バリデーション
    if (!member_id || allocation_ratio === undefined || !unit_price) {
      errors.push({ member_id, error: 'Required fields are missing' })
      continue
    }

    // 稼働率は0-1の範囲
    if (allocation_ratio < 0 || allocation_ratio > 1) {
      errors.push({ member_id, error: 'Work ratio must be between 0 and 1' })
      continue
    }

    // 既存のアサインを確認
    const existing = await c.env.DB.prepare(`
      SELECT * FROM monthly_member_assignments 
      WHERE monthly_detail_id = ? AND member_id = ?
    `).bind(monthly_detail_id, member_id).first()

    if (existing) {
      errors.push({ member_id, error: 'Member is already assigned to this monthly detail' })
      continue
    }

    try {
      // 追加
      const result = await c.env.DB.prepare(`
        INSERT INTO monthly_member_assignments 
        (monthly_detail_id, member_id, allocation_ratio, unit_price, notes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(monthly_detail_id, member_id, allocation_ratio, unit_price, notes || '').run()

      results.push({ member_id, id: result.meta.last_row_id })
    } catch (error) {
      errors.push({ member_id, error: error.message })
    }
  }

  return c.json({ 
    success: errors.length === 0, 
    results, 
    errors,
    message: `${results.length}件のメンバーを追加しました${errors.length > 0 ? `（${errors.length}件のエラー）` : ''}`
  })
})

// API: 月次メンバーアサイン更新
// メンバーアサイン更新（contract_manage権限が必要）
app.put('/api/monthly-member-assignments/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')
  const { allocation_ratio, unit_price, notes } = await c.req.json()

  // バリデーション
  if (allocation_ratio !== undefined && (allocation_ratio < 0 || allocation_ratio > 1)) {
    return c.json({ success: false, error: 'Work ratio must be between 0 and 1' }, 400)
  }

  // 現在の値を取得
  const current = await c.env.DB.prepare('SELECT * FROM monthly_member_assignments WHERE id = ?').bind(id).first()
  if (!current) return c.json({ success: false, error: 'Assignment not found' }, 404)

  // 変更履歴を記録
  if (current.allocation_ratio !== allocation_ratio) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'allocation_ratio', current.allocation_ratio.toString(), allocation_ratio.toString(), '管理者').run()
  }
  
  if (current.unit_price !== unit_price) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'unit_price', current.unit_price.toString(), unit_price.toString(), '管理者').run()
  }
  
  if (current.notes !== notes) {
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'notes', current.notes || 'null', notes || 'null', '管理者').run()
  }

  // 更新
  await c.env.DB.prepare(`
    UPDATE monthly_member_assignments 
    SET allocation_ratio = ?, unit_price = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(allocation_ratio, unit_price, notes || '', id).run()

  return c.json({ success: true })
})

// API: 月次メンバーアサイン削除
// メンバーアサイン削除（contract_manage権限が必要）
app.delete('/api/monthly-member-assignments/:id', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const id = c.req.param('id')

  // 削除前に情報を取得
  const assignment = await c.env.DB.prepare(`
    SELECT mma.*, m.name as member_name
    FROM monthly_member_assignments mma
    JOIN members m ON mma.member_id = m.id
    WHERE mma.id = ?
  `).bind(id).first()
  
  if (assignment) {
    // 変更履歴を記録
    await c.env.DB.prepare(`
      INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('monthly_member_assignments', id, 'member_unassigned', `${assignment.member_name} (稼働率:${assignment.allocation_ratio * 100}%, 単価:¥${assignment.unit_price})`, 'null', '管理者').run()
  }

  await c.env.DB.prepare('DELETE FROM monthly_member_assignments WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// API: メンバー一覧取得
app.get('/api/members', async (c) => {
  const members = await c.env.DB.prepare(`
    SELECT id, name, email, default_unit_price, status
    FROM members
    WHERE status = 'active'
    ORDER BY name ASC
  `).all()

  return c.json({ success: true, data: members.results })
})

// API: メンバー作成
// メンバー作成（管理者のみ）
app.post('/api/members/create', authMiddleware, requireAdmin, async (c) => {
  const body = await c.req.json()
  
  // 配列または単一オブジェクトを受け取る
  const members = Array.isArray(body) ? body : [body]
  
  if (members.length === 0) {
    return c.json({ success: false, error: 'No members provided' }, 400)
  }

  const results = []
  const errors = []

  for (let i = 0; i < members.length; i++) {
    const { name, email, default_unit_price, position, memo } = members[i]
    
    // バリデーション
    if (!name || !email || !default_unit_price) {
      errors.push({ index: i + 1, error: 'Name, email, and default unit price are required' })
      continue
    }

    try {
      // メールアドレスの重複チェック
      const existing = await c.env.DB.prepare(`
        SELECT id FROM members WHERE email = ?
      `).bind(email).first()

      if (existing) {
        errors.push({ index: i + 1, email, error: 'Email address already exists' })
        continue
      }

      // 挿入
      const result = await c.env.DB.prepare(`
        INSERT INTO members (name, email, default_unit_price, position, memo, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(name, email, default_unit_price, position || null, memo || null, 'active').run()

      results.push({ 
        index: i + 1, 
        id: result.meta.last_row_id, 
        name, 
        email 
      })
    } catch (error: any) {
      errors.push({ index: i + 1, email, error: error.message })
    }
  }

  return c.json({ 
    success: true, 
    total: members.length,
    success_count: results.length,
    error_count: errors.length,
    results, 
    errors 
  })
})

// API: メンバー更新
// メンバー更新（管理者のみ）
app.put('/api/members/:id', authMiddleware, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { name, email, default_unit_price, position, memo } = await c.req.json()

  if (!name || !default_unit_price) {
    return c.json({ success: false, error: 'Name and default unit price are required' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE members 
    SET name = ?, email = ?, default_unit_price = ?, position = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, email || null, default_unit_price, position || null, memo || null, id).run()

  return c.json({ success: true })
})

// API: メンバーステータス変更
// メンバーステータス更新（管理者のみ）
app.put('/api/members/:id/status', authMiddleware, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()

  if (!status || !['active', 'inactive'].includes(status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE members 
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run()

  return c.json({ success: true })
})

// --- ダッシュボード API ---
// ダッシュボードサマリ（認証必須、閲覧のみ）
app.get('/api/dashboard/summary', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 当月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 当月売上(検収済)
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  // 未検収金額
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE inspection_status = ?'
  ).bind('未検収').all()
  
  // 未請求金額
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ?'
  ).bind('未請求').all()
  
  // 未入金金額
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?)'
  ).bind('未入金', '部分入金').all()
  
  return c.json({
    success: true,
    data: {
      currentMonthSales: (currentMonthSales[0] as any)?.total || 0,
      uninspectedAmount: (uninspected[0] as any)?.total || 0,
      unbilledAmount: (unbilled[0] as any)?.total || 0,
      unpaidAmount: (unpaid[0] as any)?.total || 0
    }
  })
})

// 月次売上推移(直近12ヶ月)
// 売上推移（認証必須、閲覧のみ）
app.get('/api/dashboard/sales-trend', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 直近12ヶ月のデータを取得（検収日ベース、検収済のみ）
  const { results } = await DB.prepare(`
    SELECT 
      strftime('%Y-%m', inspection_date) as target_month,
      SUM(amount) as confirmed_sales
    FROM monthly_details
    WHERE inspection_status = '検収済'
      AND inspection_date IS NOT NULL
      AND inspection_date >= date('now', '-12 months')
    GROUP BY strftime('%Y-%m', inspection_date)
    ORDER BY target_month ASC
  `).all()
  
  return c.json({ success: true, data: results })
})

// 未処理タスク取得API
// 保留中タスク（認証必須、閲覧のみ）
app.get('/api/dashboard/pending-tasks', authMiddleware, async (c) => {
  const { DB } = c.env
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = now.toISOString().split('T')[0]
  
  // 検収期限超過（月末+7日経過した未検収）
  const { results: overdueInspections } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      md.inspection_status,
      julianday('now') - julianday(date(md.target_month || '-01', '+1 month', '-1 day')) as days_overdue
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE md.inspection_status = '未検収'
      AND julianday('now') - julianday(date(md.target_month || '-01', '+1 month', '-1 day')) > 7
    ORDER BY days_overdue DESC
    LIMIT 10
  `).all()
  
  // 請求期限間近・超過（検収済だが未請求で検収日から3日以上経過）
  const { results: overdueBillings } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      md.billing_status,
      md.inspection_date,
      julianday('now') - julianday(md.inspection_date) as days_since_inspection
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE md.inspection_status = '検収済'
      AND md.billing_status = '未請求'
      AND md.inspection_date IS NOT NULL
      AND julianday('now') - julianday(md.inspection_date) >= 3
    ORDER BY days_since_inspection DESC
    LIMIT 10
  `).all()
  
  // 入金予定日超過（請求済だが未入金/部分入金で入金予定日が過去）
  const { results: overduePayments } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      md.total_payment_amount,
      md.payment_status,
      md.expected_payment_date,
      julianday('now') - julianday(md.expected_payment_date) as days_overdue
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE md.billing_status = '請求済'
      AND md.payment_status IN ('未入金', '部分入金')
      AND md.expected_payment_date IS NOT NULL
      AND md.expected_payment_date < ?
    ORDER BY days_overdue DESC
    LIMIT 10
  `).bind(today).all()
  
  // 金額と想定売上の不一致（月次明細の金額と、メンバーアサインの想定売上が一致しない）
  const { results: amountMismatch } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount,
      COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0) as expected_revenue,
      ABS(md.amount - COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0)) as difference
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN monthly_member_assignments mma ON md.id = mma.monthly_detail_id
    GROUP BY md.id, md.target_month, c.contract_name, p.project_name, md.amount
    HAVING ABS(md.amount - COALESCE(SUM(mma.unit_price * mma.allocation_ratio), 0)) > 0
    ORDER BY difference DESC
    LIMIT 10
  `).all()
  
  return c.json({ 
    success: true, 
    data: {
      overdueInspections,
      overdueBillings,
      overduePayments,
      amountMismatch
    }
  })
})

// メンバー稼働状況API
app.get('/api/members/workload', async (c) => {
  const { DB } = c.env
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // メンバーごとの今月のアサイン状況を取得
  const { results: memberWorkload } = await DB.prepare(`
    SELECT 
      m.id as member_id,
      m.name as member_name,
      m.email,
      m.default_unit_price,
      m.status,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.allocation_ratio ELSE 0 END), 0) as total_allocation,
      COALESCE(SUM(CASE WHEN md.target_month = ? THEN mma.unit_price * mma.allocation_ratio ELSE 0 END), 0) as total_revenue,
      COUNT(DISTINCT CASE WHEN md.target_month = ? THEN mma.monthly_detail_id END) as project_count,
      GROUP_CONCAT(
        CASE WHEN md.target_month = ? THEN
          p.project_name || ' (' || CAST(ROUND(mma.allocation_ratio * 100) AS INTEGER) || '%): ¥' || 
          CAST(mma.unit_price AS TEXT) || ' | ' || COALESCE(mma.notes, '')
        END
      , '|||') as assignments
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name, m.email, m.default_unit_price, m.status
    ORDER BY total_allocation DESC, m.name ASC
  `).bind(currentMonth, currentMonth, currentMonth, currentMonth).all()
  
  return c.json({ success: true, data: memberWorkload })
})

// ========================================
// HTML Pages
// ========================================

// リード一覧
app.get('/leads', async (c) => {
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
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">部署名</th>
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
                    ${lead.department || '-'}
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
                部署名
              </label>
              <input type="text" name="department"
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

// リード詳細
app.get('/leads/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const lead = await DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first() as any
  if (!lead) {
    return c.html('<h1>リードが見つかりません</h1>', 404)
  }
  
  // 関連する案件を取得（営業担当の名前も含める）
  const { results: projects } = await DB.prepare(`
    SELECT p.*, m.name as sales_rep_name
    FROM projects p
    LEFT JOIN members m ON p.sales_rep_id = m.id
    WHERE p.lead_id = ?
    ORDER BY p.created_at DESC
  `).bind(id).all()
  
  // アクティブなメンバー一覧を取得（案件作成モーダル用）
  const { results: members } = await DB.prepare(
    'SELECT id, name, email FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>リード詳細 - SFA</title>
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
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
              </a>
              <button onclick="AUTH_UTILS.logout()" class="text-sm text-red-600 hover:text-red-700">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <!-- パンくずリスト -->
        <nav class="flex mb-4" aria-label="Breadcrumb">
          <ol class="inline-flex items-center space-x-1 md:space-x-3">
            <li>
              <a href="/leads" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-users mr-1"></i>リード一覧
              </a>
            </li>
            <li>
              <span class="text-gray-400 mx-2">/</span>
            </li>
            <li class="text-gray-700">
              ${lead.company_name}
            </li>
          </ol>
        </nav>

        <!-- ページヘッダー -->
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-user mr-2"></i>リード詳細
          </h1>
          <button onclick="openEditLeadModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            <i class="fas fa-edit mr-2"></i>編集
          </button>
        </div>

        <!-- 基本情報 -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">
            <i class="fas fa-info-circle mr-2"></i>基本情報
          </h2>
          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-sm font-medium text-gray-500">会社名</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.company_name}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">部署名</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.department || '-'}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">担当者名</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.contact_person || '-'}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">メールアドレス</dt>
              <dd class="mt-1 text-sm text-gray-900">
                ${lead.email ? `<a href="mailto:${lead.email}" class="text-blue-600 hover:text-blue-800">${lead.email}</a>` : '-'}
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">電話番号</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.phone || '-'}</dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">ステータス</dt>
              <dd class="mt-1">
                ${lead.status === 'active' 
                  ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                  : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                }
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">登録日</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.created_at}</dd>
            </div>
          </dl>
        </div>

        <!-- 案件一覧 -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-briefcase mr-2"></i>案件一覧
            </h2>
            <button onclick="openCreateProjectModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-plus mr-2"></i>案件を作成
            </button>
          </div>

          ${projects.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">営業担当</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${projects.map((project: any) => `
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/projects/${project.id}'">
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        ${project.project_name}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        ${project.sales_rep_name ? `<i class="fas fa-user mr-1 text-blue-500"></i>${project.sales_rep_name}` : '<span class="text-gray-400">-</span>'}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        ${project.status === 'active' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"><i class="fas fa-play-circle mr-1"></i>進行中</span>' :
                          project.status === 'won' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-trophy mr-1"></i>受注</span>' :
                          project.status === 'lost' ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-times-circle mr-1"></i>失注</span>' :
                          '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                        }
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${project.created_at}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-inbox text-4xl mb-2"></i>
              <p>案件がまだありません</p>
            </div>
          `}
        </div>
      </div>

      <!-- 案件作成モーダル -->
      <div id="create-project-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-briefcase mr-2"></i>新規案件作成
            </h3>
            <button onclick="closeCreateProjectModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="create-project-form" onsubmit="createProject(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                案件名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="project_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 新規システム開発案件">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-user mr-1"></i>営業担当
              </label>
              <select name="sales_rep_id"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">未設定</option>
                ${members.map((member: any) => `
                  <option value="${member.id}">${member.name}${member.email ? ` (${member.email})` : ''}</option>
                `).join('')}
              </select>
              <p class="mt-1 text-xs text-gray-500">案件を担当する営業メンバーを選択してください（任意）</p>
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeCreateProjectModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
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
        // AUTH_UTILS - 認証ユーティリティ
        const AUTH_UTILS = {
          getToken: () => localStorage.getItem('jwt_token'),
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
            localStorage.removeItem('token');
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

        // ユーザー情報を取得してナビゲーションを更新
        AUTH_UTILS.getCurrentUser().then(user => {
          if (user) {
            document.getElementById('nav-user-name').textContent = user.name;
            if (user.role === 'admin') {
              document.getElementById('admin-menu').style.display = 'inline-block';
            }
          } else {
            document.getElementById('nav-user-name').textContent = 'ゲスト';
          }
        }).catch(error => {
          console.error('Failed to load user info:', error);
          document.getElementById('nav-user-name').textContent = 'ゲスト';
        });

        function openCreateProjectModal() {
          document.getElementById('create-project-modal').classList.remove('hidden');
        }

        function closeCreateProjectModal() {
          document.getElementById('create-project-modal').classList.add('hidden');
          document.getElementById('create-project-form').reset();
        }

        async function createProject(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          data.lead_id = '${id}';
          
          // sales_rep_idが空文字列の場合はnullに変換
          if (data.sales_rep_id === '') {
            data.sales_rep_id = null;
          } else if (data.sales_rep_id) {
            data.sales_rep_id = parseInt(data.sales_rep_id);
          }
          
          try {
            const response = await axios.post('/api/projects', data);
            if (response.data.success) {
              alert('案件を作成しました');
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>

      <!-- リード編集モーダル -->
      <div id="edit-lead-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-user-edit mr-2"></i>リード情報を編集
            </h3>
            <button onclick="closeEditLeadModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="edit-lead-form" onsubmit="updateLead(event)">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                会社名 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="company_name" value="${lead.company_name}" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                担当者名
              </label>
              <input type="text" name="contact_person" value="${lead.contact_person || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                部署名
              </label>
              <input type="text" name="department" value="${lead.department || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email" value="${lead.email || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                電話番号
              </label>
              <input type="tel" name="phone" value="${lead.phone || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeEditLeadModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-save mr-2"></i>更新
              </button>
            </div>
          </form>
        </div>
      </div>

      <script>
        function openEditLeadModal() {
          document.getElementById('edit-lead-modal').classList.remove('hidden');
        }

        function closeEditLeadModal() {
          document.getElementById('edit-lead-modal').classList.add('hidden');
        }

        async function updateLead(event) {
          event.preventDefault();
          const form = event.target;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          
          try {
            const response = await axios.put('/api/leads/${id}', data);
            if (response.data.success) {
              alert('リード情報を更新しました');
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
// トップダッシュボード
app.get('/', async (c) => {
  const { DB } = c.env
  
  // ダッシュボードデータを取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  // 当月売上（確定）
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  // 未検収金額（当月のみ）
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '未検収').all()
  
  // 未請求金額（検収済のみ）
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount) as total FROM monthly_details WHERE billing_status = ? AND inspection_status = ?'
  ).bind('未請求', '検収済').all()
  
  // 未入金金額（請求済のみ）
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?) AND billing_status = ?'
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
  
  // メンバー別 累計売上（検収済のみ）
  const { results: memberTotalSales } = await DB.prepare(`
    SELECT 
      m.name as member_name,
      COALESCE(SUM(CASE WHEN md.inspection_status = '検収済' THEN mma.unit_price * mma.allocation_ratio ELSE 0 END), 0) as total_sales,
      COUNT(DISTINCT CASE WHEN md.inspection_status = '検収済' THEN md.id END) as monthly_count
    FROM members m
    LEFT JOIN monthly_member_assignments mma ON m.id = mma.member_id
    LEFT JOIN monthly_details md ON mma.monthly_detail_id = md.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.name
    ORDER BY total_sales DESC
  `).all()
  
  const currentMonthSalesTotal = (currentMonthSales[0] as any)?.total || 0
  const uninspectedTotal = (uninspected[0] as any)?.total || 0
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
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <!-- 当月売上 -->
          <a href="/monthly-list?filter=inspected" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-yen-sign mr-1"></i>当月売上(確定)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-900">
                ¥${currentMonthSalesTotal.toLocaleString()}
              </dd>
            </div>
          </a>

          <!-- 未検収 -->
          <a href="/monthly-list?filter=uninspected" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-clock mr-1"></i>未検収金額(当月)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-yellow-600">
                ¥${uninspectedTotal.toLocaleString()}
              </dd>
            </div>
          </a>

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
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
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
                    <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">検収済月数</th>
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
              <p>検収済の売上がありません</p>
            </div>
            `}
          </div>
        </div>
      </div>

      <!-- Chart.js -->
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        // Axiosセットアップ（認証ヘッダー設定）
        AUTH_UTILS.setupAxios();
        
        // 未処理タスクの読み込み
        axios.get('/api/dashboard/pending-tasks').then(response => {
          const tasks = response.data.data;
          const { overdueInspections, overdueBillings, overduePayments, amountMismatch } = tasks;
          
          const totalTasks = overdueInspections.length + overdueBillings.length + overduePayments.length + (amountMismatch ? amountMismatch.length : 0);
          
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
          
          // 検収期限超過
          if (overdueInspections.length > 0) {
            html += \`
              <div class="border-l-4 border-red-500 bg-red-50 p-4 rounded">
                <h3 class="text-red-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-times-circle mr-2"></i>🔴 検収期限超過 (\${overdueInspections.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${overdueInspections.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month} - ¥\${task.amount.toLocaleString()}</div>
                      <div class="text-xs text-red-600 mt-1">
                        <i class="fas fa-clock mr-1"></i>\${Math.floor(task.days_overdue)}日超過
                      </div>
                    </a>
                  \`).join('')}
                </div>
              </div>
            \`;
          }
          
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
                        <i class="fas fa-clock mr-1"></i>検収から\${Math.floor(task.days_since_inspection)}日経過
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
})


// 案件詳細 (ハブ画面)
// 案件詳細画面（ハブ画面）
app.get('/projects/:id', async (c) => {
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
    'SELECT id, name, email FROM members WHERE status = ? ORDER BY name ASC'
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
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span id="nav-user-name" class="text-sm text-gray-700">読込中...</span>
                <a href="/profile" class="text-sm text-gray-600 hover:text-gray-900">
                  <i class="fas fa-user mr-1"></i>プロフィール
                </a>
                <a href="/admin/users" id="admin-users-link" class="text-sm text-gray-600 hover:text-gray-900 hidden">
                  <i class="fas fa-users-cog mr-1"></i>ユーザー管理
                </a>
                <button onclick="AUTH_UTILS.logout()" class="text-sm text-gray-600 hover:text-gray-900">
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
                    <button onclick="location.href='/projects/${id}/contracts/new'" 
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
            
            const errorDiv = document.getElementById('modal-error-message');
            const successDiv = document.getElementById('modal-success-message');
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            
            try {
              const response = await axios.put(\`/api/projects/\${PROJECT_ID}\`, {
                project_name: projectName,
                sales_rep_id: salesRepId || null,
                status: status
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
        </script>
    </body>
    </html>
  `)
})

// 契約詳細画面（タブ構造）
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

  // 月次明細を取得
  const monthlyDetails = await c.env.DB.prepare(`
    SELECT 
      md.*,
      md.total_payment_amount as paid_amount
    FROM monthly_details md
    WHERE md.contract_id = ?
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
  const inspectedCount = monthlyDetails.results.filter(md => md.inspection_status === '検収済').length
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
        <script>
          // 認証チェック用のユーティリティ関数
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
            hasPermission: function(user, permission) {
              if (!user) return false;
              if (user.role === 'admin') return true;
              return user.permissions && user.permissions.includes(permission);
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
            },
            PERMISSION_LABELS: {
              'lead_manage': 'リード・案件の登録/更新',
              'contract_manage': '契約の登録/更新',
              'inspection_manage': '検収・請求の更新',
              'payment_manage': '入金の登録'
            }
          };
          
          const NAVBAR = {
            showPermissionError: function(requiredPermission) {
              const label = AUTH_UTILS.PERMISSION_LABELS[requiredPermission] || requiredPermission;
              alert('この操作を行う権限がありません。\\n必要な権限: ' + label + '\\n\\n管理者に権限の付与を依頼してください。');
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
                  <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="text-sm text-gray-700">
                  <i class="fas fa-user-circle mr-1"></i><span id="user-display-name">読み込み中...</span>
                </span>
                <a href="/profile" class="text-gray-600 hover:text-blue-600 text-sm">
                  <i class="fas fa-user-cog mr-1"></i>プロフィール
                </a>
                <button onclick="AUTH_UTILS.logout()" class="text-red-600 hover:text-red-700 text-sm">
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
                <a href="/projects/${contract.project_id}" class="text-blue-600 hover:text-blue-800">${contract.project_name}</a>
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
                <div class="grid grid-cols-4 gap-4 mb-6">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">契約金額</p>
                        <p class="text-2xl font-bold text-blue-600">¥${totalAmount.toLocaleString()}</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">検収済</p>
                        <p class="text-2xl font-bold text-green-600">${inspectedCount}/${monthlyDetails.results.length}件</p>
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
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">月次明細</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">アサインメンバー</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">検収</th>
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
                                    ${md.inspection_status === '検収済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>完了</span>'
                                      : md.inspection_status === '未検収'
                                      ? '<span class="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800"><i class="fas fa-clock mr-1"></i>未完</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">-</span>'
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
                                    <a href="/monthly/${md.id}" class="text-blue-600 hover:text-blue-800">
                                        <i class="fas fa-edit mr-1"></i>詳細
                                    </a>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
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

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/auth.js"></script>
        <script src="/static/navbar.js"></script>
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

            loadUserInfo();
        </script>
    </body>
    </html>
  `)
})

// 契約作成画面
app.get('/projects/:projectId/contracts/new', async (c) => {
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
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span id="nav-user-name" class="text-sm text-gray-700">読込中...</span>
                <a href="/profile" class="text-sm text-gray-600 hover:text-gray-900">
                  <i class="fas fa-user mr-1"></i>プロフィール
                </a>
                <a href="/admin/users" id="admin-users-link" class="text-sm text-gray-600 hover:text-gray-900 hidden">
                  <i class="fas fa-users-cog mr-1"></i>ユーザー管理
                </a>
                <button onclick="AUTH_UTILS.logout()" class="text-sm text-gray-600 hover:text-gray-900">
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
                <a href="/projects/${projectId}" class="text-blue-600 hover:text-blue-800">${project.project_name}</a>
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

                    <!-- 契約金額 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            契約金額（円） <span class="text-red-500">*</span>
                        </label>
                        <input type="number" id="contract_amount" name="contract_amount" required min="0" step="1"
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                               placeholder="3000000">
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
                        <button type="button" onclick="location.href='/projects/${projectId}'"
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
            
            // 契約期間・金額・支払種別変更時に月次明細テーブルを生成
            document.querySelector('input[name="start_date"]').addEventListener('change', generateMonthlyBreakdown)
            document.querySelector('input[name="end_date"]').addEventListener('change', generateMonthlyBreakdown)
            document.getElementById('contract_amount').addEventListener('change', generateMonthlyBreakdown)
            document.getElementById('payment_type').addEventListener('change', generateMonthlyBreakdown)
            
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

// 月次明細詳細画面
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

  // 統計計算
  const totalPayment = payments.results.reduce((sum, p) => sum + (p.payment_amount || 0), 0)
  const remainingAmount = (monthly.amount || 0) - totalPayment
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
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="text-sm text-gray-700">
                  <i class="fas fa-user-circle mr-1"></i>
                  <span id="nav-user-name">読込中...</span>
                </span>
                <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                  <i class="fas fa-user-cog mr-1"></i>プロフィール
                </a>
                <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                  <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
                <a href="/leads/${monthly.lead_id}" class="text-blue-600 hover:text-blue-800">${monthly.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/${monthly.project_id}" class="text-blue-600 hover:text-blue-800">${monthly.project_name}</a>
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
                        <p class="text-3xl font-bold text-blue-600">¥${(monthly.amount || 0).toLocaleString()}</p>
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
                ` : `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-user-slash text-4xl mb-2"></i>
                    <p>まだメンバーがアサインされていません</p>
                </div>
                `}
            </div>

            <!-- 検収情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-check-circle mr-2 text-green-600"></i>検収情報
                </h2>
                <form id="inspection-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">検収ステータス</label>
                            <select name="inspection_status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="未検収" ${monthly.inspection_status === '未検収' ? 'selected' : ''}>未検収</option>
                                <option value="検収済" ${monthly.inspection_status === '検収済' ? 'selected' : ''}>検収済</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">検収日</label>
                            <input type="date" name="inspection_date" value="${monthly.inspection_date || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="flex justify-end">
                        <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                            <i class="fas fa-save mr-2"></i>検収情報を更新
                        </button>
                    </div>
                </form>
            </div>

            <!-- 請求情報 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-lg font-semibold text-gray-800 mb-4">
                    <i class="fas fa-file-invoice mr-2 text-orange-600"></i>請求情報
                </h2>
                <form id="billing-form" class="space-y-4">
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
                    <div class="flex justify-end">
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
                    <button onclick="openAddPaymentModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
                        <i class="fas fa-plus mr-2"></i>入金を追加
                    </button>
                </div>

                <!-- 入金サマリー -->
                <div class="bg-purple-50 rounded-lg p-4 mb-4">
                    <div class="flex justify-between items-center">
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
                            <div class="bg-purple-600 h-2 rounded-full" style="width: ${Math.min(100, (totalPayment / monthly.amount) * 100)}%"></div>
                        </div>
                    </div>
                </div>

                <!-- 入金履歴 -->
                ${payments.results.length > 0 ? `
                <table class="w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">入金日</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">備考</th>
                            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${payments.results.map(p => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3">${p.payment_date}</td>
                            <td class="px-4 py-3 font-medium text-green-600">¥${(p.payment_amount || 0).toLocaleString()}</td>
                            <td class="px-4 py-3 text-gray-600">${p.note || '-'}</td>
                            <td class="px-4 py-3">
                                <button onclick="deletePayment(${p.id})" class="text-red-600 hover:text-red-800">
                                    <i class="fas fa-trash mr-1"></i>削除
                                </button>
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
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
        <script>
            // 認証チェック用のユーティリティ関数
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
            
            // 検収情報の更新
            document.getElementById('inspection-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                const formData = new FormData(e.target)
                const data = {
                    inspection_status: formData.get('inspection_status'),
                    inspection_date: formData.get('inspection_date') || null
                }

                try {
                    await axios.put('/api/monthly-details/${id}/inspection', data)
                    alert('検収情報を更新しました')
                    location.reload()
                } catch (error) {
                    alert('エラーが発生しました: ' + error.message)
                }
            })

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

            window.openAddPaymentModal = function() {
                document.getElementById('add-payment-modal').classList.remove('hidden')
                // デフォルトで今日の日付を設定
                const today = new Date().toISOString().split('T')[0]
                document.getElementById('payment_date').value = today
                
                // 月次明細の金額が0円の場合、0円入金を許可
                const monthlyAmount = ${monthly.amount || 0}
                const paymentAmountInput = document.querySelector('input[name="payment_amount"]')
                const paymentAmountLabel = document.getElementById('payment-amount-label')
                
                if (monthlyAmount === 0) {
                    paymentAmountInput.setAttribute('min', '0')
                    paymentAmountInput.setAttribute('placeholder', '0')
                    if (paymentAmountLabel) {
                        paymentAmountLabel.innerHTML = '入金金額 <span class="text-red-500">*</span><span class="text-xs text-gray-500 ml-2">※0円での入金が可能です</span>'
                    }
                } else {
                    paymentAmountInput.setAttribute('min', '1')
                    paymentAmountInput.setAttribute('placeholder', '1000000')
                    if (paymentAmountLabel) {
                        paymentAmountLabel.innerHTML = '入金金額 <span class="text-red-500">*</span>'
                    }
                }
            }

            window.closeAddPaymentModal = function() {
                document.getElementById('add-payment-modal').classList.add('hidden')
                document.getElementById('add-payment-form').reset()
            }

            let isSubmitting = false
            document.getElementById('add-payment-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                if (isSubmitting) {
                    console.log('Already submitting, ignoring duplicate submission')
                    return
                }
                
                isSubmitting = true
                const submitButton = e.target.querySelector('button[type="submit"]')
                if (submitButton) {
                    submitButton.disabled = true
                    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>処理中...'
                }
                
                const formData = new FormData(e.target)
                const data = {
                    monthly_detail_id: ${id},
                    payment_date: formData.get('payment_date'),
                    payment_amount: parseInt(formData.get('payment_amount')),
                    note: formData.get('note') || null
                }

                try {
                    const response = await axios.post('/api/payment-histories', data)
                    console.log('Payment added successfully:', response.data)
                    closeAddPaymentModal()
                    alert('入金を追加しました')
                    location.reload()
                } catch (error) {
                    console.error('Payment error:', error)
                    isSubmitting = false
                    if (submitButton) {
                        submitButton.disabled = false
                        submitButton.innerHTML = '<i class="fas fa-check mr-2"></i>追加'
                    }
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            })

            window.deletePayment = function(paymentId) {
                if (!confirm('この入金履歴を削除しますか？')) return
                
                axios.delete('/api/payment-histories/' + paymentId)
                    .then(() => {
                        alert('入金履歴を削除しました')
                        location.reload()
                    })
                    .catch(error => {
                        alert('エラーが発生しました: ' + error.message)
                    })
            }

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
            }) // DOMContentLoaded end
        </script>

        <!-- 入金追加モーダル -->
        <div id="add-payment-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-semibold text-gray-900">
                        <i class="fas fa-money-bill-wave mr-2 text-purple-600"></i>入金を追加
                    </h3>
                    <button onclick="closeAddPaymentModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <form id="add-payment-form" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            入金日 <span class="text-red-500">*</span>
                        </label>
                        <input type="date" 
                               id="payment_date" 
                               name="payment_date" 
                               required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                    </div>
                    
                    <div>
                        <label id="payment-amount-label" class="block text-sm font-medium text-gray-700 mb-2">
                            入金金額 <span class="text-red-500">*</span>
                        </label>
                        <input type="number" 
                               name="payment_amount" 
                               required 
                               min="1"
                               placeholder="1000000"
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            備考
                        </label>
                        <textarea name="note" 
                                  rows="3"
                                  placeholder="入金に関するメモ（任意）"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"></textarea>
                    </div>
                    
                    <div class="flex justify-end space-x-3 pt-4">
                        <button type="button" 
                                onclick="closeAddPaymentModal()" 
                                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                            <i class="fas fa-times mr-2"></i>キャンセル
                        </button>
                        <button type="submit" 
                                class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                            <i class="fas fa-check mr-2"></i>追加
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

// 月次明細一覧画面
app.get('/monthly-list', async (c) => {
  const { DB } = c.env
  const filter = c.req.query('filter') || 'all'
  
  // 現在の月を取得
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  
  let whereClause = ''
  let title = '月次明細一覧'
  let icon = 'fa-calendar'
  
  switch(filter) {
    case 'inspected':
      whereClause = `WHERE md.target_month = '${currentMonth}' AND md.inspection_status = '検収済'`
      title = '当月売上(確定)'
      icon = 'fa-yen-sign'
      break
    case 'uninspected':
      whereClause = `WHERE md.target_month = '${currentMonth}' AND md.inspection_status = '未検収'`
      title = '未検収金額(当月)'
      icon = 'fa-clock'
      break
    case 'unbilled':
      whereClause = `WHERE md.billing_status = '未請求' AND md.inspection_status = '検収済'`
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
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-user-friends mr-2"></i>メンバー
                  </a>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="text-sm text-gray-700">
                  <i class="fas fa-user-circle mr-1"></i>
                  <span id="nav-user-name">読込中...</span>
                </span>
                <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                  <i class="fas fa-user-cog mr-1"></i>プロフィール
                </a>
                <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                  <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
                                <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">検収</th>
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
                                    ${md.inspection_status === '検収済' 
                                      ? '<span class="px-2 py-1 rounded text-xs bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>完了</span>'
                                      : '<span class="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800"><i class="fas fa-clock mr-1"></i>未完</span>'
                                    }
                                </td>
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

// 契約一覧画面
app.get('/contracts', async (c) => {
  const { DB } = c.env
  
  // 全契約を取得（案件・リード情報を含む）
  const { results: contracts } = await DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      l.company_name,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id AND inspection_status = '検収済') as inspected_count,
      (SELECT SUM(amount) FROM monthly_details WHERE contract_id = c.id) as total_amount
    FROM contracts c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY c.created_at DESC
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
                <a href="/contracts" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
        </div>

        <!-- 契約一覧 -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          ${contracts.length > 0 ? `
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約名</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">案件/顧客</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約期間</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約金額</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">進捗</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
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
                      検収: ${contract.inspected_count || 0}/${contract.monthly_count || 0}
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                      <div class="bg-green-600 h-2 rounded-full" style="width: ${contract.monthly_count > 0 ? (contract.inspected_count / contract.monthly_count * 100) : 0}%"></div>
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
          ` : `
          <div class="text-center py-12 text-gray-500">
            <i class="fas fa-inbox text-4xl mb-2"></i>
            <p>契約がまだありません</p>
          </div>
          `}
        </div>
      </div>
    </body>
    </html>
  `)
})

// メンバー管理画面
app.get('/members', async (c) => {
  const { DB } = c.env
  
  // 全メンバーを取得
  const { results: members } = await DB.prepare(`
    SELECT * FROM members ORDER BY name ASC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>メンバー管理 - SFA</title>
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
            // CSVインポートボタンを管理者のみ表示
            const csvImportButton = document.getElementById('csv-import-button');
            if (csvImportButton && user.role === 'admin') {
              csvImportButton.style.display = '';
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
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/members" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-user-friends mr-2"></i>メンバー
                </a>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/profile" class="text-sm text-gray-600 hover:text-blue-600">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              <a href="/admin/users" id="admin-menu" class="text-sm text-gray-600 hover:text-blue-600" style="display:none;">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
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
            <i class="fas fa-user-friends mr-2"></i>メンバー管理
          </h1>
          <div class="flex space-x-3">
            <button onclick="openCsvImportModal()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700" id="csv-import-button" style="display: none;">
              <i class="fas fa-file-csv mr-2"></i>CSVインポート
            </button>
            <button onclick="openAddMemberModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-user-plus mr-2"></i>メンバーを追加
            </button>
          </div>
        </div>

        <!-- メンバー稼働状況ダッシュボード -->
        <div class="bg-gradient-to-r from-blue-50 to-indigo-50 shadow rounded-lg p-6 mb-8" id="member-workload-section">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            <i class="fas fa-chart-bar mr-2 text-blue-600"></i>📊 メンバー稼働状況（今月）
          </h2>
          <div id="member-workload-content">
            <div class="text-center py-8 text-gray-500">
              <i class="fas fa-spinner fa-spin text-3xl mb-2"></i>
              <p>読み込み中...</p>
            </div>
          </div>
        </div>

        <!-- メンバー一覧 -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名前</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">役職</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">メール</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">デフォルト単価</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">メモ</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${members.map((member: any) => `
                <tr class="hover:bg-gray-50">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="font-medium text-gray-900">${member.name}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    ${member.position ? '<span class="px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700">' + member.position + '</span>' : '<span class="text-gray-400">-</span>'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${member.email ? '<a href="mailto:' + member.email + '" class="text-blue-600 hover:text-blue-800">' + member.email + '</a>' : '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ¥${(member.default_unit_price || 0).toLocaleString()}/月
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title="${member.memo || ''}">
                    ${member.memo || '<span class="text-gray-400">-</span>'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${member.status === 'active' 
                      ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                      : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-ban mr-1"></i>無効</span>'
                    }
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button onclick="editMember(${member.id}, '${member.name}', '${member.email || ''}', ${member.default_unit_price}, '${member.status}', '${member.position || ''}', '${(member.memo || '').replace(/'/g, "\\'")}');" 
                            class="text-blue-600 hover:text-blue-800 mr-3">
                      <i class="fas fa-edit mr-1"></i>編集
                    </button>
                    <button onclick="toggleMemberStatus(${member.id}, '${member.status}')" 
                            class="text-${member.status === 'active' ? 'red' : 'green'}-600 hover:text-${member.status === 'active' ? 'red' : 'green'}-800">
                      <i class="fas fa-${member.status === 'active' ? 'ban' : 'check'} mr-1"></i>${member.status === 'active' ? '無効化' : '有効化'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- メンバー追加モーダル -->
      <div id="add-member-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-10 mx-auto p-5 border w-full max-w-4xl shadow-lg rounded-md bg-white my-8">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-user-plus mr-2"></i>新規メンバー追加
            </h3>
            <button onclick="closeAddMemberModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <!-- メンバー一覧 -->
          <div id="members-container" class="mb-4 space-y-4 max-h-96 overflow-y-auto"></div>
          
          <!-- メンバー追加ボタン -->
          <button type="button" onclick="addMemberRow()" class="mb-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            <i class="fas fa-plus mr-2"></i>メンバーを追加
          </button>
          
          <!-- 操作ボタン -->
          <div class="flex justify-end space-x-3 border-t pt-4">
            <button type="button" onclick="closeAddMemberModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              キャンセル
            </button>
            <button type="button" onclick="submitAllMembers()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-save mr-2"></i>一括登録
            </button>
          </div>
        </div>
      </div>

      <!-- メンバー編集モーダル -->
      <div id="edit-member-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-edit mr-2"></i>メンバー編集
            </h3>
            <button onclick="closeEditMemberModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <form id="edit-member-form">
            <input type="hidden" name="member_id" id="edit_member_id">
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                名前 <span class="text-red-500">*</span>
              </label>
              <input type="text" name="name" id="edit_name" required
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input type="email" name="email" id="edit_email"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                デフォルト単価 <span class="text-red-500">*</span>
              </label>
              <input type="number" name="default_unit_price" id="edit_default_unit_price" required min="0"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                役職
              </label>
              <select name="position" id="edit_position"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">未設定</option>
                <option value="パートナー">パートナー</option>
                <option value="マネージャー">マネージャー</option>
                <option value="シニアコンサルタント">シニアコンサルタント</option>
                <option value="コンサルタント">コンサルタント</option>
                <option value="アナリスト">アナリスト</option>
              </select>
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                メモ
              </label>
              <textarea name="memo" id="edit_memo" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="備考や特記事項"></textarea>
            </div>
            
            <div class="flex justify-end space-x-3">
              <button type="button" onclick="closeEditMemberModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
                キャンセル
              </button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                <i class="fas fa-save mr-2"></i>更新
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- CSVインポートモーダル -->
      <div id="csv-import-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-csv mr-2 text-green-600"></i>CSVインポート
            </h3>
            <button onclick="closeCsvImportModal()" class="text-gray-400 hover:text-gray-500">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400 text-sm">
            <p class="font-medium text-blue-900 mb-2"><i class="fas fa-info-circle mr-2"></i>CSVフォーマット</p>
            <p class="text-blue-800 mb-2">以下の列を含むCSVファイルをアップロードしてください：</p>
            <code class="block bg-white p-2 rounded text-xs">名前,役職,単価,メールアドレス,メモ</code>
            <p class="text-blue-800 mt-2 text-xs">
              ※ 名前、単価、メールアドレスは必須です<br>
              ※ 役職は「パートナー」「マネージャー」「シニアコンサルタント」「コンサルタント」「アナリスト」のいずれか<br>
              ※ 1行目はヘッダー行として無視されます
            </p>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              CSVファイルを選択
            </label>
            <input type="file" id="csv-file-input" accept=".csv" 
              class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>

          <div id="csv-preview" class="mb-4 hidden">
            <h4 class="text-sm font-medium text-gray-700 mb-2">プレビュー（最初の5行）</h4>
            <div class="overflow-x-auto max-h-64 border border-gray-300 rounded">
              <table class="min-w-full divide-y divide-gray-200 text-xs" id="csv-preview-table">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left">名前</th>
                    <th class="px-3 py-2 text-left">役職</th>
                    <th class="px-3 py-2 text-left">単価</th>
                    <th class="px-3 py-2 text-left">メールアドレス</th>
                    <th class="px-3 py-2 text-left">メモ</th>
                  </tr>
                </thead>
                <tbody id="csv-preview-body" class="bg-white divide-y divide-gray-200">
                </tbody>
              </table>
            </div>
            <p class="text-sm text-gray-600 mt-2">
              合計: <span id="csv-total-count" class="font-semibold">0</span> 件
            </p>
          </div>

          <div class="flex justify-end space-x-3">
            <button type="button" onclick="closeCsvImportModal()" class="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              キャンセル
            </button>
            <button type="button" onclick="importCsv()" id="import-csv-button" disabled class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
              <i class="fas fa-upload mr-2"></i>インポート実行
            </button>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        // メンバー稼働状況の読み込み
        axios.get('/api/members/workload').then(response => {
          const members = response.data.data;
          
          if (members.length === 0) {
            document.getElementById('member-workload-content').innerHTML = \`
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-user-slash text-4xl mb-2"></i>
                <p>アクティブなメンバーがいません</p>
              </div>
            \`;
            return;
          }
          
          let html = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">';
          
          members.forEach(member => {
            const totalAllocation = member.total_allocation || 0;
            const allocationPercent = (totalAllocation * 100).toFixed(1);
            const availablePercent = (100 - totalAllocation * 100).toFixed(1);
            const assignments = member.assignments ? member.assignments.split('|||').filter(a => a) : [];
            
            // 稼働率に応じた色分け
            let statusColor = 'gray';
            let statusIcon = 'fa-battery-empty';
            let statusText = '空き多';
            
            if (totalAllocation >= 1.0) {
              statusColor = 'red';
              statusIcon = 'fa-exclamation-triangle';
              statusText = '過負荷';
            } else if (totalAllocation >= 0.8) {
              statusColor = 'green';
              statusIcon = 'fa-check-circle';
              statusText = '適正';
            } else if (totalAllocation >= 0.5) {
              statusColor = 'blue';
              statusIcon = 'fa-info-circle';
              statusText = '余裕あり';
            } else if (totalAllocation > 0) {
              statusColor = 'yellow';
              statusIcon = 'fa-battery-quarter';
              statusText = '空き多';
            }
            
            html += \`
              <div class="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow border-l-4 border-\${statusColor}-500">
                <div class="flex justify-between items-start mb-3">
                  <div>
                    <h3 class="font-semibold text-gray-900 text-lg">\${member.member_name}</h3>
                    <p class="text-xs text-gray-500">\${member.email || '-'}</p>
                  </div>
                  <span class="px-2 py-1 text-xs font-semibold rounded-full bg-\${statusColor}-100 text-\${statusColor}-800">
                    <i class="fas \${statusIcon} mr-1"></i>\${statusText}
                  </span>
                </div>
                
                <div class="mb-3">
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-gray-700">稼働率</span>
                    <span class="text-lg font-bold text-\${statusColor}-600">\${allocationPercent}%</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-3">
                    <div class="bg-\${statusColor}-500 h-3 rounded-full transition-all" style="width: \${Math.min(100, allocationPercent)}%"></div>
                  </div>
                </div>
                
                <div class="border-t pt-3 space-y-2">
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-600">今月売上見込</span>
                    <span class="font-semibold text-green-600">¥\${Math.round(member.total_revenue).toLocaleString()}</span>
                  </div>
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-600">アサイン案件数</span>
                    <span class="font-semibold text-blue-600">\${member.project_count}案件</span>
                  </div>
                  \${availablePercent > 0 ? \`
                    <div class="flex justify-between text-sm">
                      <span class="text-gray-600">空き稼働</span>
                      <span class="font-semibold text-indigo-600">\${availablePercent}% (約¥\${Math.round(member.default_unit_price * parseFloat(availablePercent) / 100).toLocaleString()})</span>
                    </div>
                  \` : ''}
                </div>
                
                \${assignments.length > 0 ? \`
                  <div class="mt-3 pt-3 border-t">
                    <p class="text-xs font-medium text-gray-700 mb-2">
                      <i class="fas fa-briefcase mr-1"></i>今月のアサイン
                    </p>
                    <div class="space-y-1 max-h-32 overflow-y-auto">
                      \${assignments.map(assignment => {
                        const parts = assignment.split(' | ');
                        const projectInfo = parts[0];
                        const notes = parts[1] || '';
                        return \`
                          <div class="text-xs bg-gray-50 p-2 rounded">
                            <div class="font-medium text-gray-800">\${projectInfo}</div>
                            \${notes ? \`<div class="text-gray-600 mt-1">💡 \${notes}</div>\` : ''}
                          </div>
                        \`;
                      }).join('')}
                    </div>
                  </div>
                \` : \`
                  <div class="mt-3 pt-3 border-t text-center text-xs text-gray-500">
                    <i class="fas fa-info-circle mr-1"></i>今月のアサインなし
                  </div>
                \`}
              </div>
            \`;
          });
          
          html += '</div>';
          document.getElementById('member-workload-content').innerHTML = html;
        }).catch(error => {
          console.error('Failed to load member workload:', error);
          document.getElementById('member-workload-content').innerHTML = \`
            <div class="text-center py-8 text-red-500">
              <i class="fas fa-exclamation-circle text-3xl mb-2"></i>
              <p>稼働状況の読み込みに失敗しました</p>
            </div>
          \`;
        });

        function openAddMemberModal() {
          document.getElementById('add-member-modal').classList.remove('hidden');
          initializeMembersContainer();
        }

        function closeAddMemberModal() {
          document.getElementById('add-member-modal').classList.add('hidden');
        }

        function initializeMembersContainer() {
          const container = document.getElementById('members-container');
          container.innerHTML = ''; // 既存の行をクリア
          addMemberRow(); // 最初の行を追加
        }

        function addMemberRow() {
          const container = document.getElementById('members-container');
          const rowCount = container.children.length + 1;
          
          const row = document.createElement('div');
          row.className = 'member-row p-4 border border-gray-200 rounded-lg bg-gray-50 relative';
          
          const deleteButton = rowCount > 1 
            ? '<button type="button" onclick="removeMemberRow(this)" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-times"></i> 削除</button>' 
            : '';
          
          row.innerHTML = '<div class="flex justify-between items-center mb-3">' +
            '<h4 class="text-sm font-semibold text-gray-700">メンバー ' + rowCount + '</h4>' +
            deleteButton +
            '</div>' +
            '<div class="grid grid-cols-2 gap-4">' +
            '<div>' +
            '<label class="block text-sm font-medium text-gray-700 mb-1">名前 <span class="text-red-500">*</span></label>' +
            '<input type="text" name="name" required class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">' +
            '</div>' +
            '<div>' +
            '<label class="block text-sm font-medium text-gray-700 mb-1">メールアドレス <span class="text-red-500">*</span></label>' +
            '<input type="email" name="email" required class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">' +
            '</div>' +
            '<div>' +
            '<label class="block text-sm font-medium text-gray-700 mb-1">デフォルト単価（月額） <span class="text-red-500">*</span></label>' +
            '<input type="number" name="default_unit_price" min="0" required placeholder="500000" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">' +
            '</div>' +
            '<div>' +
            '<label class="block text-sm font-medium text-gray-700 mb-1">役職</label>' +
            '<select name="position" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">' +
            '<option value="">未設定</option>' +
            '<option value="パートナー">パートナー</option>' +
            '<option value="マネージャー">マネージャー</option>' +
            '<option value="シニアコンサルタント">シニアコンサルタント</option>' +
            '<option value="コンサルタント">コンサルタント</option>' +
            '<option value="アナリスト">アナリスト</option>' +
            '</select>' +
            '</div>' +
            '<div class="col-span-2">' +
            '<label class="block text-sm font-medium text-gray-700 mb-1">メモ</label>' +
            '<textarea name="memo" rows="2" placeholder="備考や特記事項" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"></textarea>' +
            '</div>' +
            '</div>';
          
          container.appendChild(row);
          updateMemberRowNumbers();
        }

        function removeMemberRow(button) {
          const row = button.closest('.member-row');
          row.remove();
          updateMemberRowNumbers();
        }

        function updateMemberRowNumbers() {
          const rows = document.querySelectorAll('#members-container .member-row');
          rows.forEach((row, index) => {
            const header = row.querySelector('h4');
            header.textContent = 'メンバー ' + (index + 1);
            
            // 最初の行の削除ボタンを隠す
            const deleteBtn = row.querySelector('button[onclick*="removeMemberRow"]');
            if (deleteBtn) {
              if (index === 0 && rows.length === 1) {
                deleteBtn.style.display = 'none';
              } else {
                deleteBtn.style.display = 'inline-block';
              }
            }
          });
        }

        async function submitAllMembers() {
          const rows = document.querySelectorAll('#members-container .member-row');
          const members = [];
          
          for (let row of rows) {
            const name = row.querySelector('input[name="name"]').value.trim();
            const email = row.querySelector('input[name="email"]').value.trim();
            const default_unit_price = parseInt(row.querySelector('input[name="default_unit_price"]').value);
            const position = row.querySelector('select[name="position"]').value;
            const memo = row.querySelector('textarea[name="memo"]').value.trim();
            
            // 必須項目チェック
            if (!name || !email || !default_unit_price) {
              alert('すべてのメンバーの名前、メールアドレス、デフォルト単価を入力してください');
              return;
            }
            
            members.push({
              name,
              email,
              default_unit_price,
              position: position || null,
              memo: memo || null
            });
          }
          
          if (members.length === 0) {
            alert('少なくとも1人のメンバーを入力してください');
            return;
          }
          
          try {
            const response = await axios.post('/api/members/create', members);
            const { success_count, error_count, errors } = response.data;
            
            let message = success_count + '人のメンバーを追加しました';
            if (error_count > 0) {
              message += '\\n\\n' + error_count + '件のエラー:\\n';
              errors.forEach(err => {
                message += '行' + err.index + ': ' + err.error;
                if (err.email) message += ' (' + err.email + ')';
                message += '\\n';
              });
            }
            
            alert(message);
            
            if (success_count > 0) {
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // CSV インポート関数
        let csvData = [];

        function openCsvImportModal() {
          document.getElementById('csv-import-modal').classList.remove('hidden');
          csvData = [];
          document.getElementById('csv-file-input').value = '';
          document.getElementById('csv-preview').classList.add('hidden');
          document.getElementById('import-csv-button').disabled = true;
        }

        function closeCsvImportModal() {
          document.getElementById('csv-import-modal').classList.add('hidden');
        }

        document.getElementById('csv-file-input').addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = function(event) {
            const text = event.target.result;
            parseCsv(text);
          };
          reader.readAsText(file, 'UTF-8');
        });

        function parseCsv(text) {
          const lines = text.split('\\n').filter(line => line.trim());
          if (lines.length < 2) {
            alert('CSVファイルが空か、ヘッダー行のみです');
            return;
          }

          csvData = [];
          // 1行目はヘッダーとしてスキップ
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length >= 4) {
              csvData.push({
                name: values[0] || '',
                position: values[1] || null,
                default_unit_price: parseInt(values[2]) || 0,
                email: values[3] || '',
                memo: values[4] || null
              });
            }
          }

          if (csvData.length === 0) {
            alert('有効なデータが見つかりませんでした');
            return;
          }

          displayCsvPreview();
        }

        function displayCsvPreview() {
          const tbody = document.getElementById('csv-preview-body');
          tbody.innerHTML = '';

          const previewData = csvData.slice(0, 5);
          previewData.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td class="px-3 py-2">' + item.name + '</td>' +
              '<td class="px-3 py-2">' + (item.position || '-') + '</td>' +
              '<td class="px-3 py-2">' + item.default_unit_price.toLocaleString() + '</td>' +
              '<td class="px-3 py-2">' + item.email + '</td>' +
              '<td class="px-3 py-2">' + (item.memo || '-') + '</td>';
            tbody.appendChild(tr);
          });

          document.getElementById('csv-total-count').textContent = csvData.length;
          document.getElementById('csv-preview').classList.remove('hidden');
          document.getElementById('import-csv-button').disabled = false;
        }

        async function importCsv() {
          if (csvData.length === 0) {
            alert('インポートするデータがありません');
            return;
          }

          if (!confirm(csvData.length + '件のメンバーをインポートしますか？')) {
            return;
          }

          try {
            const response = await axios.post('/api/members/create', csvData);
            const { success_count, error_count, errors } = response.data;

            let message = success_count + '人のメンバーをインポートしました';
            if (error_count > 0) {
              message += '\\n\\n' + error_count + '件のエラー:\\n';
              errors.forEach(err => {
                message += '行' + err.index + ': ' + err.error;
                if (err.email) message += ' (' + err.email + ')';
                message += '\\n';
              });
            }

            alert(message);

            if (success_count > 0) {
              closeCsvImportModal();
              location.reload();
            }
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        }

        function openEditMemberModal() {
          document.getElementById('edit-member-modal').classList.remove('hidden');
        }

        function closeEditMemberModal() {
          document.getElementById('edit-member-modal').classList.add('hidden');
          document.getElementById('edit-member-form').reset();
        }

        function editMember(id, name, email, price, status, position, memo) {
          document.getElementById('edit_member_id').value = id;
          document.getElementById('edit_name').value = name;
          document.getElementById('edit_email').value = email;
          document.getElementById('edit_default_unit_price').value = price;
          document.getElementById('edit_position').value = position || '';
          document.getElementById('edit_memo').value = memo || '';
          openEditMemberModal();
        }

        document.getElementById('edit-member-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const id = formData.get('member_id');
          const data = {
            name: formData.get('name'),
            email: formData.get('email') || null,
            default_unit_price: parseInt(formData.get('default_unit_price')),
            position: formData.get('position') || null,
            memo: formData.get('memo') || null
          };
          
          try {
            await axios.put('/api/members/' + id, data);
            alert('メンバー情報を更新しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        });

        async function toggleMemberStatus(id, currentStatus) {
          const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
          const action = newStatus === 'active' ? '有効化' : '無効化';
          
          if (!confirm('このメンバーを' + action + 'しますか？')) return;
          
          try {
            await axios.put('/api/members/' + id + '/status', { status: newStatus });
            alert('メンバーを' + action + 'しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `)
})

// API: データインポート（管理者専用）
app.post('/api/admin/import', authMiddleware, requireAdmin, async (c) => {
  const { type, data, skip_duplicates, auto_match, dry_run } = await c.req.json()
  
  const result = {
    success_count: 0,
    error_count: 0,
    skipped_count: 0,
    errors: [],
    dry_run: dry_run === true
  }
  
  if (!type || !data || !Array.isArray(data)) {
    return c.json({ error: 'Invalid request data' }, 400)
  }
  
  try {
    for (let i = 0; i < data.length; i++) {
      const record = data[i]
      
      try {
        // データ変換・バリデーション
        const transformed = await transformRecord(c.env.DB, type, record, auto_match)
        
        // 必須フィールドチェック
        const validationError = validateRecord(type, transformed)
        if (validationError) {
          throw new Error(validationError)
        }
        
        // 重複チェック
        if (skip_duplicates === true) {
          const exists = await checkDuplicate(c.env.DB, type, transformed)
          if (exists) {
            result.skipped_count++
            continue
          }
        }
        
        // インポート実行（dry_runでない場合のみ）
        if (dry_run !== true) {
          await insertRecord(c.env.DB, type, transformed)
        }
        
        result.success_count++
      } catch (error: any) {
        result.error_count++
        result.errors.push({
          row: i + 2,  // ヘッダー行を考慮
          message: error.message || 'Unknown error'
        })
      }
    }
    
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: 'インポート処理中にエラーが発生しました: ' + error.message }, 500)
  }
})

// レコード変換関数（Notion形式に対応）
async function transformRecord(db: D1Database, type: string, record: any, autoMatch: boolean = true): Promise<any> {
  switch (type) {
    case 'leads':
      return {
        company_name: record.company_name || record['会社名'] || record['Company Name'] || '',
        department: record.department || record['部署名'] || record['Department'] || null,
        contact_person: record.contact_person || record['担当者名'] || record['Contact Person'] || '',
        email: record.email || record['メールアドレス'] || record['Email'] || '',
        phone: record.phone || record['電話番号'] || record['Phone'] || '',
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'lead')
      }
      
    case 'members':
      return {
        name: record.name || record['名前'] || record['Name'] || '',
        email: record.email || record['メールアドレス'] || record['Email'] || '',
        default_unit_price: parseNumber(record.default_unit_price || record['単価'] || record['デフォルト単価'] || record['Unit Price'] || '0'),
        position: record.position || record['役職'] || record['Position'] || null,
        memo: record.memo || record['メモ'] || record['Memo'] || null,
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'member')
      }
      
    case 'projects':
      let leadId = null
      if (autoMatch && (record.company_name || record['会社名'] || record['Company Name'])) {
        const companyName = record.company_name || record['会社名'] || record['Company Name']
        const lead = await db.prepare('SELECT id FROM leads WHERE company_name = ?').bind(companyName).first()
        if (lead) leadId = lead.id
      }
      
      let salesRepId = null
      if (autoMatch && (record.sales_rep_email || record['営業担当メール'] || record['Sales Rep Email'])) {
        const email = record.sales_rep_email || record['営業担当メール'] || record['Sales Rep Email']
        const member = await db.prepare('SELECT id FROM members WHERE email = ?').bind(email).first()
        if (member) salesRepId = member.id
      }
      
      return {
        project_name: record.project_name || record['案件名'] || record['Project Name'] || '',
        lead_id: leadId || parseNumber(record.lead_id || ''),
        sales_rep_id: salesRepId || (record.sales_rep_id ? parseNumber(record.sales_rep_id) : null),
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'project')
      }
      
    case 'contracts':
      let projectId = null
      if (autoMatch && (record.project_name || record['案件名'] || record['Project Name'])) {
        const projectName = record.project_name || record['案件名'] || record['Project Name']
        const project = await db.prepare('SELECT id FROM projects WHERE project_name = ?').bind(projectName).first()
        if (project) projectId = project.id
      }
      
      return {
        contract_name: record.contract_name || record['契約名'] || record['Contract Name'] || '',
        project_id: projectId || parseNumber(record.project_id || ''),
        contract_start_date: normalizeDate(record.contract_start_date || record['開始日'] || record['Start Date']),
        contract_end_date: normalizeDate(record.contract_end_date || record['終了日'] || record['End Date']),
        contract_amount: parseNumber(record.contract_amount || record['契約金額'] || record['Amount'] || '0'),
        contract_type: record.contract_type || record['契約形態'] || record['Type'] || '準委任',
        payment_type: record.payment_type || record['支払形態'] || record['Payment Type'] || '毎月支払',
        status: normalizeStatus(record.status || record['ステータス'] || record['Status'] || 'active', 'contract')
      }
      
    default:
      throw new Error('Unknown import type: ' + type)
  }
}

// ステータス正規化（Notion日本語→英語キーワード）
function normalizeStatus(value: string, entityType: string): string {
  if (!value) return 'active'
  
  const statusMaps: Record<string, Record<string, string>> = {
    lead: {
      'アクティブ': 'active', '有効': 'active', 'Active': 'active',
      'アーカイブ': 'archived', '終了': 'archived', 'Archived': 'archived'
    },
    member: {
      'アクティブ': 'active', '有効': 'active', 'Active': 'active',
      '無効': 'inactive', 'Inactive': 'inactive'
    },
    project: {
      '進行中': 'active', '商談中': 'active', 'Active': 'active',
      '受注': 'won', '成約': 'won', '完了': 'won', 'Won': 'won',
      '失注': 'lost', 'キャンセル': 'lost', 'Lost': 'lost',
      'アーカイブ': 'archived', '終了': 'archived', 'Archived': 'archived'
    },
    contract: {
      '下書き': 'draft', 'Draft': 'draft',
      'アクティブ': 'active', '有効': 'active', '進行中': 'active', 'Active': 'active',
      '完了': 'completed', 'Completed': 'completed',
      '終了': 'terminated', '解約': 'terminated', 'Terminated': 'terminated'
    }
  }
  
  const map = statusMaps[entityType] || {}
  return map[value] || value.toLowerCase()
}

// 日付正規化（Notion ISO形式→YYYY-MM-DD）
function normalizeDate(value: string | null | undefined): string {
  if (!value) return ''
  
  // Notion ISO 8601形式: 2026-01-15T00:00:00.000Z
  if (value.includes('T')) {
    return value.split('T')[0]
  }
  
  // すでにYYYY-MM-DD形式
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  
  // その他の形式
  try {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }
  } catch (e) {
    // 変換失敗
  }
  
  return value
}

// 数値パース（カンマ区切り対応）
function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  
  // カンマを削除して数値化
  const cleaned = String(value).replace(/,/g, '').trim()
  const num = parseInt(cleaned)
  return isNaN(num) ? 0 : num
}

// バリデーション
function validateRecord(type: string, record: any): string | null {
  switch (type) {
    case 'leads':
      if (!record.company_name || record.company_name.trim() === '') {
        return '会社名は必須です'
      }
      break
      
    case 'members':
      if (!record.name || record.name.trim() === '') {
        return '名前は必須です'
      }
      if (!record.email || record.email.trim() === '') {
        return 'メールアドレスは必須です'
      }
      if (!record.default_unit_price || record.default_unit_price <= 0) {
        return 'デフォルト単価は必須です'
      }
      break
      
    case 'projects':
      if (!record.project_name || record.project_name.trim() === '') {
        return '案件名は必須です'
      }
      if (!record.lead_id || record.lead_id <= 0) {
        return 'リードIDが見つかりません（会社名を確認してください）'
      }
      break
      
    case 'contracts':
      if (!record.contract_name || record.contract_name.trim() === '') {
        return '契約名は必須です'
      }
      if (!record.project_id || record.project_id <= 0) {
        return '案件IDが見つかりません（案件名を確認してください）'
      }
      if (!record.contract_start_date) {
        return '開始日は必須です'
      }
      if (!record.contract_end_date) {
        return '終了日は必須です'
      }
      if (!record.contract_amount || record.contract_amount <= 0) {
        return '契約金額は必須です'
      }
      break
  }
  
  return null
}

// 重複チェック
async function checkDuplicate(db: D1Database, type: string, record: any): Promise<boolean> {
  try {
    switch (type) {
      case 'leads':
        // 会社名と部署名の組み合わせでチェック
        const lead = await db.prepare(
          'SELECT id FROM leads WHERE company_name = ? AND COALESCE(department, \'\') = ?'
        ).bind(record.company_name, record.department || '').first()
        return !!lead
        
      case 'members':
        const member = await db.prepare('SELECT id FROM members WHERE email = ?').bind(record.email).first()
        return !!member
        
      case 'projects':
        const project = await db.prepare('SELECT id FROM projects WHERE project_name = ? AND lead_id = ?')
          .bind(record.project_name, record.lead_id).first()
        return !!project
        
      case 'contracts':
        const contract = await db.prepare('SELECT id FROM contracts WHERE contract_name = ? AND project_id = ?')
          .bind(record.contract_name, record.project_id).first()
        return !!contract
        
      default:
        return false
    }
  } catch (e) {
    return false
  }
}

// レコード挿入
async function insertRecord(db: D1Database, type: string, record: any): Promise<void> {
  switch (type) {
    case 'leads':
      await db.prepare(`
        INSERT INTO leads (company_name, department, contact_person, email, phone, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        record.company_name,
        record.department,
        record.contact_person,
        record.email,
        record.phone,
        record.status
      ).run()
      break
      
    case 'members':
      await db.prepare(`
        INSERT INTO members (name, email, default_unit_price, position, memo, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        record.name,
        record.email,
        record.default_unit_price,
        record.position,
        record.memo,
        record.status
      ).run()
      break
      
    case 'projects':
      await db.prepare(`
        INSERT INTO projects (project_name, lead_id, sales_rep_id, status)
        VALUES (?, ?, ?, ?)
      `).bind(
        record.project_name,
        record.lead_id,
        record.sales_rep_id,
        record.status
      ).run()
      break
      
    case 'contracts':
      await db.prepare(`
        INSERT INTO contracts (contract_name, project_id, contract_start_date, contract_end_date, contract_amount, contract_type, payment_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.contract_name,
        record.project_id,
        record.contract_start_date,
        record.contract_end_date,
        record.contract_amount,
        record.contract_type,
        record.payment_type,
        record.status
      ).run()
      break
  }
}

export default app
