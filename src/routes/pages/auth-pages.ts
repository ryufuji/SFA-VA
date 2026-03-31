import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

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
        </div>

        <!-- フッター -->
        <div class="text-center mt-6 text-sm text-gray-600">
          <p>&copy; 2026 SFA System. All rights reserved.</p>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="/static/auth.js"></script>
      <script>
        // ページロード時に古いトークンをクリア
        // これにより、ログアウト後の404エラーを防ぐ
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user');
        document.cookie = 'jwt_token=; path=/; max-age=0; SameSite=Lax';
        
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
              // JWTトークンをlocalStorageとクッキーに保存
              localStorage.setItem('jwt_token', response.data.token);
              localStorage.setItem('user', JSON.stringify(response.data.user));
              
              // クッキーにもトークンを保存（PDFページなど新しいウィンドウで使用するため）
              document.cookie = 'jwt_token=' + response.data.token + '; path=/; max-age=86400; SameSite=Lax';
              
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
      <script src="/static/auth.js"></script>
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
          'billing_manage': '請求管理',
          'payment_manage': '入金の登録',
          'member_manage': 'メンバー管理'
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
      <script src="/static/auth.js"></script>
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


export default app
