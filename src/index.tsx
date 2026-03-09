import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, getUserPermissions, logAction, ADMIN_PERMISSIONS } from './auth'
import { generateJWT, authMiddleware, requirePermission, requireAdmin } from './middleware/auth'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// ========================================
// Helper Functions
// ========================================

/**
 * 契約ステータスを自動更新する関数
 * 関連する月次明細がすべて「検収済」「請求済」「金額と入金総額が一致」の場合、契約を「完了」に更新
 */
async function updateContractStatusIfCompleted(DB: D1Database, contractId: number) {
  // 契約に関連する月次明細をすべて取得
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.id,
      md.amount,
      md.amount_with_tax,
      md.inspection_status,
      md.billing_status,
      md.payment_status,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment
    FROM monthly_details md
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    WHERE md.contract_id = ?
    GROUP BY md.id, md.amount, md.amount_with_tax, md.inspection_status, md.billing_status, md.payment_status
  `).bind(contractId).all()

  // 月次明細が存在しない場合は何もしない
  if (!monthlyDetails || monthlyDetails.length === 0) {
    return
  }

  // すべての月次明細が条件を満たすかチェック
  // 月次明細の税込み金額で比較する
  const allCompleted = monthlyDetails.every((detail: any) => {
    return detail.inspection_status === '検収済' &&
           detail.billing_status === '請求済' &&
           detail.total_payment >= detail.amount_with_tax
  })

  // すべて完了している場合、契約ステータスを「completed」に更新
  if (allCompleted) {
    await DB.prepare(`
      UPDATE contracts 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND status != 'completed'
    `).bind(contractId).run()
  }
}

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
        </div>

        <!-- フッター -->
        <div class="text-center mt-6 text-sm text-gray-600">
          <p>&copy; 2026 SFA System. All rights reserved.</p>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
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

// 詳細一覧トップページ
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

            <!-- 入金一覧 -->
            <a href="/payments" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-teal-500">
                <div class="flex items-center mb-4">
                  <div class="bg-teal-100 rounded-full p-3 mr-4">
                    <i class="fas fa-money-bill-wave text-2xl text-teal-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">入金一覧</h2>
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

        loadUserInfo();
      </script>
    </body>
    </html>
  `)
})

// 自社情報管理画面（権限必要）
// 設定トップページ
app.get('/settings', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>設定 - SFA</title>
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
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
              <a href="/settings" class="text-sm text-blue-600 font-semibold">
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
            <i class="fas fa-cog mr-2"></i>設定
          </h1>
          
          <!-- 設定メニュー -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 自社情報管理 -->
            <a href="/settings/company" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-blue-500">
                <div class="flex items-center mb-4">
                  <div class="bg-blue-100 rounded-full p-3 mr-4">
                    <i class="fas fa-building text-2xl text-blue-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">自社情報管理</h2>
                    <p class="text-sm text-gray-500">会社情報、ロゴ、印鑑などの設定</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  会社名、住所、電話番号、登録番号、銀行口座、ロゴ、会社印などの自社情報を管理します。
                </p>
              </div>
            </a>

            <!-- メンバー管理 -->
            <a href="/members" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-green-500">
                <div class="flex items-center mb-4">
                  <div class="bg-green-100 rounded-full p-3 mr-4">
                    <i class="fas fa-user-tie text-2xl text-green-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">メンバー管理</h2>
                    <p class="text-sm text-gray-500">営業メンバーの登録と管理</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  営業メンバーの登録、編集、削除を行います。案件や契約へのアサイン、按分比率の設定に使用されます。
                </p>
              </div>
            </a>

            <!-- プロフィール -->
            <a href="/profile" class="block">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-indigo-500">
                <div class="flex items-center mb-4">
                  <div class="bg-indigo-100 rounded-full p-3 mr-4">
                    <i class="fas fa-user-cog text-2xl text-indigo-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">プロフィール</h2>
                    <p class="text-sm text-gray-500">個人情報とパスワードの変更</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  ログインユーザーの氏名、メールアドレス、パスワードを変更できます。
                </p>
              </div>
            </a>

            <!-- ユーザー管理 -->
            <a href="/admin/users" id="user-management-card" class="block" style="display:none;">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-orange-500">
                <div class="flex items-center mb-4">
                  <div class="bg-orange-100 rounded-full p-3 mr-4">
                    <i class="fas fa-users-cog text-2xl text-orange-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">ユーザー管理</h2>
                    <p class="text-sm text-gray-500">ユーザーアカウントと権限の管理</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  ユーザーアカウントの作成、編集、削除、および権限の設定を行います。管理者のみアクセス可能です。
                </p>
              </div>
            </a>

            <!-- データバックアップ・リストア -->
            <a href="/settings/data-backup" id="data-backup-card" class="block" style="display:none;">
              <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 hover:border-purple-500">
                <div class="flex items-center mb-4">
                  <div class="bg-purple-100 rounded-full p-3 mr-4">
                    <i class="fas fa-database text-2xl text-purple-600"></i>
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900">データバックアップ・リストア</h2>
                    <p class="text-sm text-gray-500">全テーブルデータのエクスポート・インポート</p>
                  </div>
                </div>
                <p class="text-gray-600 text-sm">
                  全データのバックアップ（CSV形式）、テスト環境へのデータ投入、本番環境への初期データ登録を行います。管理者のみアクセス可能です。
                </p>
              </div>
            </a>
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
            console.log('API response:', response.data);
            if (response.data && response.data.success) {
              const user = response.data.user;
              if (user && user.name) {
                document.getElementById('nav-user-name').textContent = user.name;
                
                // 管理者の場合のみユーザー管理カードとデータバックアップカードを表示
                if (user.role === 'admin') {
                  document.getElementById('user-management-card').style.display = 'block';
                  const dataBackupCard = document.getElementById('data-backup-card');
                  if (dataBackupCard) dataBackupCard.style.display = 'block';
                }
              } else {
                console.error('ユーザー情報が不正です:', response.data);
              }
            }
          } catch (error) {
            console.error('ユーザー情報の取得に失敗しました:');
            console.error('Error message:', error.message);
            console.error('Error response:', error.response?.data);
            console.error('Error status:', error.response?.status);
            console.error('Full error:', error);
          }
        }

        loadUserInfo();
      </script>
    </body>
    </html>
  `)
})

app.get('/settings/company', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>自社情報管理 - SFA</title>
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
          <i class="fas fa-building mr-2"></i>自社情報管理
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

        <form id="company-form" class="space-y-6">
          <!-- 基本情報 -->
          <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">基本情報</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  会社名 <span class="text-red-500">*</span>
                </label>
                <input type="text" id="company_name" required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    郵便番号
                  </label>
                  <input type="text" id="postal_code" placeholder="1234567"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    登録番号（インボイス）
                  </label>
                  <input type="text" id="registration_number" placeholder="T1234567890123"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  住所
                </label>
                <input type="text" id="address"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
            </div>
          </div>

          <!-- 銀行情報 -->
          <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">銀行情報</h2>
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    銀行名
                  </label>
                  <input type="text" id="bank_name" placeholder="三井住友銀行"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    支店名
                  </label>
                  <input type="text" id="bank_branch" placeholder="渋谷支店"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    口座種別
                  </label>
                  <select id="account_type"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">選択してください</option>
                    <option value="普通">普通</option>
                    <option value="当座">当座</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    口座番号
                  </label>
                  <input type="text" id="account_number" placeholder="1234567"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  口座名義
                </label>
                <input type="text" id="account_holder" placeholder="バリュー アーキテクツ（カ"
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
            </div>
          </div>

          <!-- 画像アップロード -->
          <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">ロゴ・印鑑</h2>
            <div class="space-y-6">
              <!-- ロゴ -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-image mr-1"></i>会社ロゴ
                </label>
                <div class="flex items-center space-x-4">
                  <div id="logo-preview" class="hidden w-32 h-32 border-2 border-gray-300 rounded-lg overflow-hidden">
                    <img id="logo-image" src="" alt="Logo" class="w-full h-full object-contain">
                  </div>
                  <div class="flex-1">
                    <input type="file" id="logo-file" accept="image/*" class="hidden">
                    <button type="button" onclick="document.getElementById('logo-file').click()"
                      class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      <i class="fas fa-upload mr-2"></i>ファイルを選択
                    </button>
                    <button type="button" id="upload-logo-button" class="hidden ml-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <i class="fas fa-cloud-upload mr-2"></i>アップロード
                    </button>
                    <p class="text-xs text-gray-500 mt-2">推奨サイズ: 200×100px程度、最大1MB</p>
                  </div>
                </div>
              </div>

              <!-- 会社印 -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-stamp mr-1"></i>会社印
                </label>
                <div class="flex items-center space-x-4">
                  <div id="seal-preview" class="hidden w-32 h-32 border-2 border-gray-300 rounded-lg overflow-hidden">
                    <img id="seal-image" src="" alt="Seal" class="w-full h-full object-contain">
                  </div>
                  <div class="flex-1">
                    <input type="file" id="seal-file" accept="image/*" class="hidden">
                    <button type="button" onclick="document.getElementById('seal-file').click()"
                      class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      <i class="fas fa-upload mr-2"></i>ファイルを選択
                    </button>
                    <button type="button" id="upload-seal-button" class="hidden ml-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <i class="fas fa-cloud-upload mr-2"></i>アップロード
                    </button>
                    <p class="text-xs text-gray-500 mt-2">推奨サイズ: 100×100px程度、最大1MB</p>
                  </div>
                </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 保存ボタン -->
          <div class="flex justify-end">
            <button type="submit" class="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
              <i class="fas fa-save mr-2"></i>保存
            </button>
          </div>
        </form>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script>
        const token = localStorage.getItem('jwt_token');
        if (!token) {
          window.location.href = '/login';
        }
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;

        // ユーザー情報取得
        async function loadUserInfo() {
          try {
            const response = await axios.get('/api/auth/me');
            document.getElementById('user-name').textContent = response.data.user.name;
          } catch (error) {
            console.error('ユーザー情報取得失敗:', error);
          }
        }

        // 自社情報取得
        async function loadCompanyInfo() {
          try {
            const response = await axios.get('/api/company-info');
            const data = response.data.data;

            document.getElementById('company_name').value = data.company_name || '';
            document.getElementById('postal_code').value = data.postal_code || '';
            document.getElementById('address').value = data.address || '';
            document.getElementById('registration_number').value = data.registration_number || '';
            document.getElementById('bank_name').value = data.bank_name || '';
            document.getElementById('bank_branch').value = data.bank_branch || '';
            document.getElementById('account_type').value = data.account_type || '';
            document.getElementById('account_number').value = data.account_number || '';
            document.getElementById('account_holder').value = data.account_holder || '';

            // 画像表示
            if (data.logo_base64) {
              const logoImg = document.getElementById('logo-image');
              logoImg.src = data.logo_base64;
              document.getElementById('logo-preview').classList.remove('hidden');
            }
            if (data.seal_base64) {
              const sealImg = document.getElementById('seal-image');
              sealImg.src = data.seal_base64;
              document.getElementById('seal-preview').classList.remove('hidden');
            }
          } catch (error) {
            if (error.response?.status === 403) {
              document.getElementById('error-text').textContent = 'この画面を閲覧する権限がありません';
              document.getElementById('error-message').classList.remove('hidden');
              setTimeout(() => window.location.href = '/', 2000);
            }
          }
        }

        // フォーム送信
        document.getElementById('company-form').addEventListener('submit', async (e) => {
          e.preventDefault();

          const errorDiv = document.getElementById('error-message');
          const successDiv = document.getElementById('success-message');
          errorDiv.classList.add('hidden');
          successDiv.classList.add('hidden');

          try {
            await axios.put('/api/company-info', {
              company_name: document.getElementById('company_name').value,
              postal_code: document.getElementById('postal_code').value,
              address: document.getElementById('address').value,
              registration_number: document.getElementById('registration_number').value,
              bank_name: document.getElementById('bank_name').value,
              bank_branch: document.getElementById('bank_branch').value,
              account_type: document.getElementById('account_type').value,
              account_number: document.getElementById('account_number').value,
              account_holder: document.getElementById('account_holder').value
            });

            document.getElementById('success-text').textContent = '自社情報を更新しました';
            successDiv.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || '更新に失敗しました';
            errorDiv.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });

        // ロゴファイル選択
        document.getElementById('logo-file').addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            // ファイルサイズチェック（1MB = 1048576バイト）
            const maxSize = 1 * 1024 * 1024; // 1MB
            if (file.size > maxSize) {
              document.getElementById('error-text').textContent = 'ロゴ画像のファイルサイズが大きすぎます（最大1MB）';
              document.getElementById('error-message').classList.remove('hidden');
              window.scrollTo({ top: 0, behavior: 'smooth' });
              e.target.value = ''; // ファイル選択をクリア
              return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
              document.getElementById('logo-image').src = e.target.result;
              document.getElementById('logo-preview').classList.remove('hidden');
              document.getElementById('upload-logo-button').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
          }
        });

        // 印鑑ファイル選択
        document.getElementById('seal-file').addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            // ファイルサイズチェック（1MB = 1048576バイト）
            const maxSize = 1 * 1024 * 1024; // 1MB
            if (file.size > maxSize) {
              document.getElementById('error-text').textContent = '会社印画像のファイルサイズが大きすぎます（最大1MB）';
              document.getElementById('error-message').classList.remove('hidden');
              window.scrollTo({ top: 0, behavior: 'smooth' });
              e.target.value = ''; // ファイル選択をクリア
              return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
              document.getElementById('seal-image').src = e.target.result;
              document.getElementById('seal-preview').classList.remove('hidden');
              document.getElementById('upload-seal-button').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
          }
        });

        // ロゴアップロード
        document.getElementById('upload-logo-button').addEventListener('click', async () => {
          const file = document.getElementById('logo-file').files[0];
          if (!file) return;

          const formData = new FormData();
          formData.append('logo', file);

          try {
            await axios.post('/api/company-info/upload-logo', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            document.getElementById('success-text').textContent = 'ロゴをアップロードしました';
            document.getElementById('success-message').classList.remove('hidden');
            document.getElementById('upload-logo-button').classList.add('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || 'アップロードに失敗しました';
            document.getElementById('error-message').classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });

        // 印鑑アップロード
        document.getElementById('upload-seal-button').addEventListener('click', async () => {
          const file = document.getElementById('seal-file').files[0];
          if (!file) return;

          const formData = new FormData();
          formData.append('seal', file);

          try {
            await axios.post('/api/company-info/upload-seal', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            document.getElementById('success-text').textContent = '会社印をアップロードしました';
            document.getElementById('success-message').classList.remove('hidden');
            document.getElementById('upload-seal-button').classList.add('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (error) {
            document.getElementById('error-text').textContent = error.response?.data?.error || 'アップロードに失敗しました';
            document.getElementById('error-message').classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });

        // ログアウト
        document.getElementById('logout-button').addEventListener('click', async () => {
          try {
            await axios.post('/api/auth/logout');
          } catch (error) {
            console.error('ログアウトエラー:', error);
          }
          localStorage.removeItem('jwt_token');
          window.location.href = '/login';
        });

        loadUserInfo();
        loadCompanyInfo();
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
  const { company_name, contact_person, department, email, phone, memo } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO leads (company_name, contact_person, department, email, phone, memo, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(company_name, contact_person || null, department || null, email || null, phone || null, memo || null, 'active').run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// リード更新（lead_manage権限が必要）
app.put('/api/leads/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  const { company_name, contact_person, department, email, phone, memo } = body
  
  if (!company_name) {
    return c.json({ success: false, error: 'Company name is required' }, 400)
  }
  
  await DB.prepare(`
    UPDATE leads 
    SET company_name = ?, contact_person = ?, department = ?, email = ?, phone = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(company_name, contact_person || null, department || null, email || null, phone || null, memo || null, id).run()
  
  return c.json({ success: true })
})

// リードステータス変更API（lead_manage権限が必要）
app.put('/api/leads/:id/status', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { status } = await c.req.json()

  // バリデーション
  if (!status || !['active', 'archived'].includes(status)) {
    return c.json({ success: false, error: 'Invalid status. Must be "active" or "archived"' }, 400)
  }

  // リードの存在確認
  const lead = await DB.prepare('SELECT id, status FROM leads WHERE id = ?').bind(id).first()
  if (!lead) {
    return c.json({ success: false, error: 'Lead not found' }, 404)
  }

  // ステータス更新
  await DB.prepare(`
    UPDATE leads 
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run()

  return c.json({ success: true, message: 'ステータスを更新しました' })
})

// --- 商談メモ API ---

// 商談メモ一覧取得API（案件別）
app.get('/api/projects/:projectId/meeting-notes', authMiddleware, async (c) => {
  const { DB } = c.env
  const projectId = c.req.param('projectId')
  
  const { results: notes } = await DB.prepare(`
    SELECT * FROM meeting_notes 
    WHERE project_id = ? 
    ORDER BY meeting_date DESC, created_at DESC
  `).bind(projectId).all()
  
  return c.json({ success: true, data: notes })
})

// 商談メモ作成API
app.post('/api/meeting-notes', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const { project_id, meeting_date, note } = await c.req.json()
  
  // バリデーション
  if (!project_id || !meeting_date || !note) {
    return c.json({ error: '必須項目を入力してください' }, 400)
  }
  
  // 案件の存在確認
  const project = await DB.prepare('SELECT id FROM projects WHERE id = ?').bind(project_id).first()
  if (!project) {
    return c.json({ error: '案件が見つかりません' }, 404)
  }
  
  // 商談メモを作成
  await DB.prepare(`
    INSERT INTO meeting_notes (project_id, meeting_date, note, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(project_id, meeting_date, note, '管理者').run()
  
  return c.json({ success: true, message: '商談メモを追加しました' })
})

// 商談メモ更新API
app.put('/api/meeting-notes/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { meeting_date, note } = await c.req.json()
  
  // バリデーション
  if (!meeting_date || !note) {
    return c.json({ error: '必須項目を入力してください' }, 400)
  }
  
  // 商談メモの存在確認
  const meetingNote = await DB.prepare('SELECT id FROM meeting_notes WHERE id = ?').bind(id).first()
  if (!meetingNote) {
    return c.json({ error: '商談メモが見つかりません' }, 404)
  }
  
  // 商談メモを更新
  await DB.prepare(`
    UPDATE meeting_notes 
    SET meeting_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(meeting_date, note, id).run()
  
  return c.json({ success: true, message: '商談メモを更新しました' })
})

// 商談メモ削除API
app.delete('/api/meeting-notes/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 商談メモの存在確認
  const meetingNote = await DB.prepare('SELECT id FROM meeting_notes WHERE id = ?').bind(id).first()
  if (!meetingNote) {
    return c.json({ error: '商談メモが見つかりません' }, 404)
  }
  
  // 商談メモを削除
  await DB.prepare('DELETE FROM meeting_notes WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, message: '商談メモを削除しました' })
})

// リードCSVエクスポートAPI（管理者のみ）
app.get('/api/leads/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全リード取得
  const { results } = await DB.prepare('SELECT * FROM leads ORDER BY created_at DESC').all()

  // CSVヘッダー
  let csv = '会社名,部署名,担当者,メールアドレス,電話番号,ステータス,メモ\n'

  // データ行を追加
  for (const lead of results) {
    const company_name = (lead.company_name || '').replace(/"/g, '""')
    const department = (lead.department || '').replace(/"/g, '""')
    const contact_person = (lead.contact_person || '').replace(/"/g, '""')
    const email = (lead.email || '').replace(/"/g, '""')
    const phone = (lead.phone || '').replace(/"/g, '""')
    const status = lead.status || 'active'
    const memo = (lead.memo || '').replace(/"/g, '""')
    
    csv += '"' + company_name + '","' + department + '","' + contact_person + '","' + email + '","' + phone + '","' + status + '","' + memo + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"'
    }
  })
})

// リードCSVインポートAPI（管理者のみ）
app.post('/api/leads/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { leads } = await c.req.json()

  if (!Array.isArray(leads) || leads.length === 0) {
    return c.json({ success: false, error: 'リードデータが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]
    const { company_name, department, contact_person, email, phone, status, memo } = lead

    // バリデーション
    if (!company_name) {
      errors.push({ line: i + 2, email: email || '', error: '会社名は必須です' })
      error_count++
      continue
    }

    try {
      // 重複チェック（会社名+部署名の組み合わせ）
      const existing = await DB.prepare(
        'SELECT id FROM leads WHERE company_name = ? AND department = ?'
      ).bind(company_name, department || null).first()

      if (existing) {
        errors.push({ line: i + 2, email: email || '', error: '同じ会社名と部署名の組み合わせが既に存在します' })
        error_count++
        continue
      }

      // 挿入
      await DB.prepare(`
        INSERT INTO leads (company_name, department, contact_person, email, phone, status, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        company_name,
        department || null,
        contact_person || null,
        email || null,
        phone || null,
        status || 'active',
        memo || null
      ).run()

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, email: email || '', error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: leads.length,
    success_count,
    error_count,
    errors
  })
})

// --- 案件 API ---
// 案件一覧取得（認証必須、閲覧のみ）
app.get('/api/projects', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // 案件一覧を取得（リード情報と営業担当者情報を結合）
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      l.company_name,
      l.department,
      m.name as sales_rep_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    WHERE p.status = 'active'
    ORDER BY p.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

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
  const { lead_id, project_name, sales_rep_id, expected_monthly_amount } = body
  
  if (!lead_id || !project_name) {
    return c.json({ success: false, error: 'Lead ID and project name are required' }, 400)
  }
  
  const result = await DB.prepare(
    'INSERT INTO projects (lead_id, project_name, sales_rep_id, status, expected_monthly_amount) VALUES (?, ?, ?, ?, ?)'
  ).bind(lead_id, project_name, sales_rep_id || null, 'active', expected_monthly_amount || 0).run()
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } })
})

// 案件更新（lead_manage権限が必要）
app.put('/api/projects/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const { project_name, sales_rep_id, status, expected_monthly_amount } = await c.req.json()
  
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
          expected_monthly_amount = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      project_name,
      sales_rep_id || null,
      status || 'active',
      expected_monthly_amount || 0,
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

// 案件CSVエクスポートAPI（管理者のみ）
app.get('/api/projects/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全案件取得（リード情報と営業担当者情報を含む）
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      l.company_name,
      l.department,
      m.name as sales_rep_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN members m ON p.sales_rep_id = m.id
    ORDER BY p.created_at DESC
  `).all()

  // CSVヘッダー
  let csv = '案件名,会社名,部署名,営業担当,ステータス\n'

  // データ行を追加
  for (const project of results) {
    const project_name = (project.project_name || '').replace(/"/g, '""')
    const company_name = (project.company_name || '').replace(/"/g, '""')
    const department = (project.department || '').replace(/"/g, '""')
    const sales_rep_name = (project.sales_rep_name || '').replace(/"/g, '""')
    const status = project.status || 'active'
    
    csv += '"' + project_name + '","' + company_name + '","' + department + '","' + sales_rep_name + '","' + status + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="projects.csv"'
    }
  })
})

// 案件CSVインポートAPI（管理者のみ）
app.post('/api/projects/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { projects } = await c.req.json()

  if (!Array.isArray(projects) || projects.length === 0) {
    return c.json({ success: false, error: '案件データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    const { project_name, company_name, department, sales_rep_name, status } = project

    // バリデーション
    if (!project_name) {
      errors.push({ line: i + 2, project_name: '', error: '案件名は必須です' })
      error_count++
      continue
    }

    if (!company_name) {
      errors.push({ line: i + 2, project_name: project_name, error: '会社名は必須です' })
      error_count++
      continue
    }

    try {
      // リードIDを検索
      const lead = await DB.prepare(
        'SELECT id FROM leads WHERE company_name = ? AND (department = ? OR (department IS NULL AND ? IS NULL))'
      ).bind(company_name, department || null, department || null).first()

      if (!lead) {
        errors.push({ line: i + 2, project_name: project_name, error: '対応するリードが見つかりません' })
        error_count++
        continue
      }

      // 営業担当者IDを検索（指定がある場合）
      let sales_rep_id = null
      if (sales_rep_name) {
        const member = await DB.prepare('SELECT id FROM members WHERE name = ?').bind(sales_rep_name).first()
        if (!member) {
          errors.push({ line: i + 2, project_name: project_name, error: '営業担当者が見つかりません: ' + sales_rep_name })
          error_count++
          continue
        }
        sales_rep_id = member.id
      }

      // 挿入
      await DB.prepare(`
        INSERT INTO projects (lead_id, project_name, sales_rep_id, status)
        VALUES (?, ?, ?, ?)
      `).bind(
        lead.id,
        project_name,
        sales_rep_id,
        status || 'active'
      ).run()

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, project_name: project_name, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: projects.length,
    success_count,
    error_count,
    errors
  })
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

// 契約CSVエクスポートAPI（管理者のみ）
app.get('/api/contracts/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全契約取得（案件・リード情報と月次明細を含む）
  const { results } = await DB.prepare(`
    SELECT 
      c.*,
      p.project_name,
      l.company_name,
      (SELECT COUNT(*) FROM monthly_details WHERE contract_id = c.id) as monthly_count
    FROM contracts c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY c.created_at DESC
  `).all()

  // CSVヘッダー
  let csv = '契約名,案件名,会社名,契約種別,契約開始日,契約終了日,契約金額,支払種別,月次明細数,ステータス\n'

  // データ行を追加
  for (const contract of results) {
    const contract_name = (contract.contract_name || '').replace(/"/g, '""')
    const project_name = (contract.project_name || '').replace(/"/g, '""')
    const company_name = (contract.company_name || '').replace(/"/g, '""')
    const contract_type = (contract.contract_type || '').replace(/"/g, '""')
    const start_date = contract.contract_start_date || ''
    const end_date = contract.contract_end_date || ''
    const amount = contract.contract_amount || 0
    const payment_type = (contract.payment_type || '毎月支払').replace(/"/g, '""')
    const monthly_count = contract.monthly_count || 0
    const status = contract.status || 'active'
    
    csv += '"' + contract_name + '","' + project_name + '","' + company_name + '","' + contract_type + '","' + start_date + '","' + end_date + '",' + amount + ',"' + payment_type + '",' + monthly_count + ',"' + status + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contracts.csv"'
    }
  })
})

// 契約CSVインポートAPI（管理者のみ、月次明細も自動生成）
app.post('/api/contracts/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { contracts } = await c.req.json()

  if (!Array.isArray(contracts) || contracts.length === 0) {
    return c.json({ success: false, error: '契約データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i]
    const { contract_name, project_name, company_name, department, contract_type, contract_date, contract_start_date, contract_end_date, contract_amount, payment_type, member_emails, status } = contract

    // バリデーション
    if (!contract_name || !contract_start_date || !contract_end_date || !contract_amount) {
      errors.push({ line: i + 2, contract_name: contract_name || '', error: '契約名、契約開始日、契約終了日、契約金額は必須です' })
      error_count++
      continue
    }

    try {
      // 案件IDを検索
      let project_id = null
      if (project_name && company_name) {
        let query = `
          SELECT p.id FROM projects p
          LEFT JOIN leads l ON p.lead_id = l.id
          WHERE p.project_name = ? AND l.company_name = ?
        `
        const params = [project_name, company_name]
        
        // 部署名が指定されている場合は検索条件に追加
        if (department) {
          query += ` AND l.department = ?`
          params.push(department)
        }
        
        const project = await DB.prepare(query).bind(...params).first()
        
        if (project) {
          project_id = project.id
        }
      }

      if (!project_id) {
        errors.push({ line: i + 2, contract_name: contract_name, error: '対応する案件が見つかりません' })
        error_count++
        continue
      }

      // 日付バリデーション
      const startDate = new Date(contract_start_date)
      const endDate = new Date(contract_end_date)
      
      if (startDate > endDate) {
        errors.push({ line: i + 2, contract_name: contract_name, error: '開始日は終了日より前である必要があります' })
        error_count++
        continue
      }

      // メンバー情報リストを取得（メール:単価:稼働率）
      const memberAssignments = []
      if (member_emails) {
        const emailList = member_emails.split(';').map((e: string) => e.trim()).filter((e: string) => e)
        for (const emailStr of emailList) {
          const parts = emailStr.split(':').map((p: string) => p.trim())
          const email = parts[0]
          const unit_price = parts[1] ? parseInt(parts[1]) : null
          const allocation_ratio = parts[2] ? parseFloat(parts[2]) : null
          
          const member = await DB.prepare('SELECT id, default_unit_price FROM members WHERE email = ?').bind(email).first()
          if (member) {
            memberAssignments.push({
              member_id: member.id,
              unit_price: unit_price || member.default_unit_price || 0,
              allocation_ratio: allocation_ratio !== null ? allocation_ratio : 1.0
            })
          }
        }
      }

      // 契約を挿入
      const result = await DB.prepare(`
        INSERT INTO contracts (project_id, contract_name, contract_type, contract_start_date, contract_end_date, contract_amount, payment_type, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        project_id,
        contract_name,
        contract_type || '準委任',
        contract_start_date,
        contract_end_date,
        contract_amount,
        payment_type || '毎月支払',
        status || 'active',
        contract_date || new Date().toISOString()
      ).run()

      const contract_id = result.meta.last_row_id

      // 月次明細を自動生成
      const months = []
      let current = new Date(startDate)
      while (current <= endDate) {
        months.push(current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0'))
        current.setMonth(current.getMonth() + 1)
      }

      const monthlyAmount = Math.floor(contract_amount / months.length)
      
      for (const month of months) {
        await DB.prepare(`
          INSERT INTO monthly_details (contract_id, target_month, amount, inspection_status, billing_status, payment_status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(contract_id, month, monthlyAmount, '未検収', '未請求', '未入金').run()
      }

      // メンバーアサインを登録（単価と稼働率込み）
      if (memberAssignments.length > 0) {
        for (const assignment of memberAssignments) {
          await DB.prepare(`
            INSERT INTO contract_member_assignments (contract_id, member_id, unit_price, allocation_ratio)
            VALUES (?, ?, ?, ?)
          `).bind(contract_id, assignment.member_id, assignment.unit_price, assignment.allocation_ratio).run()
        }
      }

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, contract_name: contract_name, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: contracts.length,
    success_count,
    error_count,
    errors
  })
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
  // 月次明細の税込み金額で比較する
  const monthlyDetailForTax = await DB.prepare('SELECT amount_with_tax FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  const expectedPaymentAmount = monthlyDetailForTax?.amount_with_tax || monthlyAmount
  
  let paymentStatus = '未入金'
  if (totalPayment >= expectedPaymentAmount) {
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
  
  // 月次明細の契約IDを取得
  const monthlyDetailForContract = await DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first() as any
  if (monthlyDetailForContract?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(DB, monthlyDetailForContract.contract_id)
  }
  
  return c.json({ success: true, message: 'Payment added successfully', totalPayment, paymentStatus })
})

// 入金一覧API（リード単位で月毎の入金総額を取得）
app.get('/api/payment-summary', authMiddleware, async (c) => {
  const { DB } = c.env
  
  // リード単位で月毎の入金総額を集計
  const { results: paymentSummary } = await DB.prepare(`
    SELECT 
      l.id as lead_id,
      l.company_name,
      l.department,
      md.target_month,
      SUM(COALESCE(ph.payment_amount, 0)) as total_payment,
      SUM(md.amount) as total_amount_before_tax,
      SUM(md.amount_with_tax) as total_amount_with_tax
    FROM leads l
    INNER JOIN projects p ON l.id = p.lead_id
    INNER JOIN contracts c ON p.id = c.project_id
    INNER JOIN monthly_details md ON c.id = md.contract_id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY l.id, l.company_name, l.department, md.target_month
    ORDER BY md.target_month DESC, l.company_name ASC
  `).all()
  
  return c.json({
    success: true,
    data: paymentSummary
  })
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
  
  // Cookieにトークンを設定（HTTPOnly, Secure, SameSite）
  c.header('Set-Cookie', `jwt_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
  
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

// メンバーCSVエクスポートAPI（管理者のみ）
app.get('/api/members/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  // 全メンバー取得（アクティブのみ）
  const { results } = await DB.prepare(
    'SELECT name, position, default_unit_price, email, memo FROM members WHERE status = ? ORDER BY name ASC'
  ).bind('active').all()

  // CSVヘッダー
  let csv = '名前,役職,単価,メールアドレス,メモ\n'

  // データ行を追加
  for (const member of results) {
    const name = (member.name || '').replace(/"/g, '""')
    const position = (member.position || '').replace(/"/g, '""')
    const unit_price = member.default_unit_price || 0
    const email = (member.email || '').replace(/"/g, '""')
    const memo = (member.memo || '').replace(/"/g, '""')
    
    csv += '"' + name + '","' + position + '",' + unit_price + ',"' + email + '","' + memo + '"\n'
  }

  // CSVとして返す
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="members.csv"'
    }
  })
})

// --- 契約 API ---

// API: 契約作成（contract_manage権限が必要）
app.post('/api/contracts', authMiddleware, requirePermission('contract_manage'), async (c) => {
  const { project_id, contract_name, contract_type, contract_date, start_date, end_date, contract_amount, tax_rate, notes, payment_type, monthly_breakdown, member_assignments } = await c.req.json()

  // バリデーション
  if (!project_id || !contract_name || !start_date || !end_date || !contract_amount) {
    return c.json({ error: '必須項目が入力されていません' }, 400)
  }
  
  // 税率のデフォルト値（10%）
  const taxRateValue = tax_rate !== undefined ? parseFloat(tax_rate) : 10.0
  
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
        contract_amount, tax_rate, payment_type, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      project_id, contract_name, contract_type || '準委任', contract_date || null, start_date, end_date, 
      contract_amount, taxRateValue, paymentTypeValue, 'active'
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
      
      // 税込み金額を計算
      const monthAmountWithTax = Math.round(monthAmount * (1 + taxRateValue / 100))
      
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
          contract_id, target_month, amount, amount_with_tax, name, notes,
          inspection_status, inspection_date, 
          billing_status, billing_date,
          payment_status, expected_payment_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        contractId, months[i], monthAmount, monthAmountWithTax, monthlyName, monthNote,
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

  // 月次明細の契約IDを取得
  const monthlyDetail = await c.env.DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (monthlyDetail?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(c.env.DB, monthlyDetail.contract_id)
  }

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

  // 月次明細の契約IDを取得
  const monthlyDetail = await c.env.DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(id).first() as any
  if (monthlyDetail?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(c.env.DB, monthlyDetail.contract_id)
  }

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

// API: 月次明細一括検収
app.post('/api/monthly-details/bulk-inspect', authMiddleware, requirePermission('inspection_manage'), async (c) => {
  const { ids, inspection_date } = await c.req.json()
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ success: false, error: '対象IDが指定されていません' }, 400)
  }
  
  const { DB } = c.env
  const today = inspection_date || new Date().toISOString().split('T')[0]
  
  let success_count = 0
  let error_count = 0
  const errors = []
  
  for (const id of ids) {
    try {
      const current = await DB.prepare('SELECT * FROM monthly_details WHERE id = ?').bind(id).first()
      if (!current) {
        errors.push({ id, error: '月次明細が見つかりません' })
        error_count++
        continue
      }
      
      if (current.inspection_status === '検収済') {
        errors.push({ id, error: 'すでに検収済みです' })
        error_count++
        continue
      }
      
      // 変更履歴を記録
      await DB.prepare(`
        INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('monthly_details', id, 'inspection_status', current.inspection_status, '検収済', '管理者').run()
      
      // 検収済に更新
      await DB.prepare(`
        UPDATE monthly_details 
        SET inspection_status = ?, inspection_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind('検収済', today, id).run()
      
      success_count++
    } catch (error) {
      errors.push({ id, error: error.message })
      error_count++
    }
  }
  
  return c.json({ 
    success: true, 
    success_count, 
    error_count, 
    errors,
    message: `${success_count}件を検収済みに更新しました${error_count > 0 ? `（エラー: ${error_count}件）` : ''}`
  })
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

  // 月次明細の合計入金額を再計算
  const { results: histories } = await c.env.DB.prepare(`
    SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?
  `).bind(payment.monthly_detail_id).all()

  const totalPayment = histories[0]?.total || 0

  // 月次明細の金額を取得
  const detail = await c.env.DB.prepare('SELECT amount FROM monthly_details WHERE id = ?').bind(payment.monthly_detail_id).first()
  const monthlyAmount = detail?.amount || 0

  // 入金ステータスの判定
  let paymentStatus = '未入金'
  if (totalPayment >= monthlyAmount) {
    paymentStatus = '入金完了'
  } else if (totalPayment > 0) {
    paymentStatus = '部分入金'
  }

  // 月次明細を更新
  await c.env.DB.prepare(`
    UPDATE monthly_details 
    SET total_payment_amount = ?, 
        payment_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalPayment, paymentStatus, payment.monthly_detail_id).run()

  // 月次明細の契約IDを取得
  const monthlyDetail = await c.env.DB.prepare('SELECT contract_id FROM monthly_details WHERE id = ?').bind(payment.monthly_detail_id).first() as any
  if (monthlyDetail?.contract_id) {
    // 契約ステータスを自動更新
    await updateContractStatusIfCompleted(c.env.DB, monthlyDetail.contract_id)
  }

  return c.json({ success: true })
})

// 入金履歴CSVインポートAPI（管理者のみ）
app.post('/api/payment-histories/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { payment_histories } = await c.req.json()

  if (!Array.isArray(payment_histories) || payment_histories.length === 0) {
    return c.json({ success: false, error: '入金履歴データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < payment_histories.length; i++) {
    const payment = payment_histories[i]
    const { monthly_detail_id, payment_date, payment_amount, note } = payment

    // バリデーション
    if (!monthly_detail_id) {
      errors.push({ line: i + 2, monthly_detail_id: '', error: '月次明細IDは必須です' })
      error_count++
      continue
    }

    if (!payment_date) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金日は必須です' })
      error_count++
      continue
    }

    if (payment_amount === undefined || payment_amount === null) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金金額は必須です' })
      error_count++
      continue
    }

    if (payment_amount < 0) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '入金金額は0以上である必要があります' })
      error_count++
      continue
    }

    try {
      // 月次明細が存在するか確認
      const detail = await DB.prepare('SELECT id, amount FROM monthly_details WHERE id = ?').bind(monthly_detail_id).first()
      
      if (!detail) {
        errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: '該当する月次明細が見つかりません' })
        error_count++
        continue
      }

      // 入金履歴を追加
      const result = await DB.prepare(`
        INSERT INTO payment_histories (monthly_detail_id, payment_date, payment_amount, note, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        monthly_detail_id,
        payment_date,
        payment_amount,
        note || null,
        '管理者(CSV)'
      ).run()

      // 変更履歴を記録
      await DB.prepare(`
        INSERT INTO status_change_histories (table_name, record_id, field_name, old_value, new_value, changed_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('payment_histories', result.meta.last_row_id, 'payment_added', 'null', `¥${payment_amount} (${payment_date})`, '管理者(CSV)').run()

      // 累計入金額を再計算
      const { results: histories } = await DB.prepare(
        'SELECT SUM(payment_amount) as total FROM payment_histories WHERE monthly_detail_id = ?'
      ).bind(monthly_detail_id).all()
      
      const totalPayment = (histories[0] as any)?.total || 0
      
      // 入金ステータスの判定
      let paymentStatus = '未入金'
      if (totalPayment >= (detail.amount || 0)) {
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

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, monthly_detail_id: monthly_detail_id, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: payment_histories.length,
    success_count,
    error_count,
    errors
  })
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

      // メンバーを挿入
      const result = await c.env.DB.prepare(`
        INSERT INTO members (name, email, default_unit_price, position, memo, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(name, email, default_unit_price, position || null, memo || null, 'active').run()

      // ユーザーも自動作成（権限なし）
      // まず、同じメールアドレスのユーザーが存在するかチェック
      const existingUser = await c.env.DB.prepare(`
        SELECT id FROM users WHERE email = ?
      `).bind(email).first()

      if (!existingUser) {
        // デフォルトパスワードはメールアドレスの@前の部分 + "1234"
        const defaultPassword = email.split('@')[0] + '1234'
        const hashedPassword = await hashPassword(defaultPassword)
        
        await c.env.DB.prepare(`
          INSERT INTO users (email, password_hash, role, member_id, password_change_required)
          VALUES (?, ?, ?, ?, ?)
        `).bind(email, hashedPassword, 'none', result.meta.last_row_id, 1).run()
      }

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

// 既存メンバーをユーザー管理に追加（管理者のみ）
app.post('/api/members/sync-users', authMiddleware, requireAdmin, async (c) => {
  try {
    // メールアドレスを持つ全メンバーを取得
    const members = await c.env.DB.prepare(`
      SELECT id, name, email FROM members WHERE email IS NOT NULL AND email != ''
    `).all()

    let addedCount = 0
    let skippedCount = 0
    const errors = []

    for (const member of members.results) {
      try {
        // 既にユーザーが存在するかチェック
        const existingUser = await c.env.DB.prepare(`
          SELECT id FROM users WHERE email = ?
        `).bind(member.email).first()

        if (existingUser) {
          skippedCount++
          continue
        }

        // ユーザーを作成
        const defaultPassword = member.email.split('@')[0] + '1234'
        const hashedPassword = await hashPassword(defaultPassword)
        
        await c.env.DB.prepare(`
          INSERT INTO users (email, password_hash, role, member_id, password_change_required)
          VALUES (?, ?, ?, ?, ?)
        `).bind(member.email, hashedPassword, 'none', member.id, 1).run()

        addedCount++
      } catch (error: any) {
        errors.push({ email: member.email, name: member.name, error: error.message })
      }
    }

    return c.json({
      success: true,
      total_members: members.results.length,
      synced_count: addedCount,
      skipped_count: skippedCount,
      errors: errors.map(e => ({ member_name: e.name || e.email, error: e.error }))
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// メンバー削除API（管理者のみ、無効なメンバーのみ削除可能）
app.delete('/api/members/:id', authMiddleware, requireAdmin, async (c) => {
  const id = c.req.param('id')

  // メンバーが存在するか確認
  const member = await c.env.DB.prepare('SELECT status, name FROM members WHERE id = ?').bind(id).first()
  
  if (!member) {
    return c.json({ success: false, error: 'メンバーが見つかりません' }, 404)
  }

  // 無効なメンバーのみ削除可能
  if (member.status !== 'inactive') {
    return c.json({ success: false, error: '無効なメンバーのみ削除できます' }, 400)
  }

  // ユーザーアカウントが紐付けられているか確認
  const userCheck = await c.env.DB.prepare('SELECT id FROM users WHERE member_id = ?').bind(id).first()
  if (userCheck) {
    return c.json({ success: false, error: 'このメンバーにはユーザーアカウントが紐付けられているため削除できません。先にユーザーアカウントを削除してください。' }, 400)
  }

  // 月次アサインがあるか確認
  const assignmentCheck = await c.env.DB.prepare('SELECT id FROM monthly_member_assignments WHERE member_id = ?').bind(id).first()
  if (assignmentCheck) {
    return c.json({ success: false, error: 'このメンバーには月次アサイン履歴があるため削除できません。データの整合性を保つため、無効化のみ可能です。' }, 400)
  }

  // メンバーを削除
  try {
    await c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: 'メンバーを削除しました' })
  } catch (error) {
    return c.json({ success: false, error: '削除に失敗しました。このメンバーは他のデータから参照されている可能性があります。' }, 500)
  }
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
      SUM(amount_with_tax) as confirmed_sales
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
  
  // 検収期限超過（月末を過ぎた未検収）
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
      AND julianday('now') - julianday(date(md.target_month || '-01', '+1 month', '-1 day')) > 0
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
  
  // 入金不一致（入金総額が0より大きく、月次明細金額と異なる場合）
  // payment_historiesから実際の入金額を集計して比較（税込み額で比較）
  const { results: paymentMismatches } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      c.contract_name,
      p.project_name,
      md.amount_with_tax,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment_amount,
      ABS(md.amount_with_tax - COALESCE(SUM(ph.payment_amount), 0)) as difference
    FROM monthly_details md
    JOIN contracts c ON md.contract_id = c.id
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY md.id, md.target_month, c.contract_name, p.project_name, md.amount_with_tax
    HAVING COALESCE(SUM(ph.payment_amount), 0) > 0 
      AND md.amount_with_tax != COALESCE(SUM(ph.payment_amount), 0)
    ORDER BY difference DESC
    LIMIT 10
  `).all()
  
  return c.json({ 
    success: true, 
    data: {
      overdueInspections,
      overdueBillings,
      overduePayments,
      amountMismatch,
      paymentMismatches
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
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'created_at'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['company_name', 'department', 'project_count', 'earliest_contract', 'latest_contract', 'status', 'created_at']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // リード一覧と関連する案件数、契約情報を取得
  const { results: leads } = await DB.prepare(`
    SELECT 
      l.*,
      COUNT(DISTINCT p.id) as project_count,
      MIN(md.target_month) as earliest_contract,
      MAX(md.target_month) as latest_contract
    FROM leads l
    LEFT JOIN projects p ON l.id = p.lead_id
    LEFT JOIN contracts c ON p.id = c.project_id
    LEFT JOIN monthly_details md ON c.id = md.contract_id
    GROUP BY l.id, l.company_name, l.department, l.contact_person, l.email, l.phone, l.status, l.memo, l.created_at, l.updated_at
    ORDER BY ${sortColumn} ${order}
  `).all()
  
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
        
        // ソート機能
        function sortTable(column) {
          const urlParams = new URLSearchParams(window.location.search);
          const currentSort = urlParams.get('sortBy');
          const currentOrder = urlParams.get('sortOrder') || 'DESC';
          
          let newOrder = 'ASC';
          if (currentSort === column && currentOrder === 'ASC') {
            newOrder = 'DESC';
          }
          
          window.location.href = '/leads?sortBy=' + column + '&sortOrder=' + newOrder;
        }

        document.addEventListener('DOMContentLoaded', async function() {
          AUTH_UTILS.checkAuth();
          AUTH_UTILS.setupAxios();
          const user = await AUTH_UTILS.getCurrentUser();
          console.log('Current user:', user);
          if (user) {
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) {
              navUserName.textContent = user.name;
            }
            if (user.role === 'admin') {
              console.log('User is admin, showing CSV buttons');
              const adminMenu = document.getElementById('admin-menu');
              if (adminMenu) adminMenu.style.display = '';
              const csvExportButton = document.getElementById('csv-export-button');
              const csvImportButton = document.getElementById('csv-import-button');
              if (csvExportButton) csvExportButton.style.display = '';
              if (csvImportButton) csvImportButton.style.display = '';
            } else {
              console.log('User role:', user.role);
            }
          } else {
            console.log('No user found');
          }
          
          // ソートアイコンの更新
          const urlParams = new URLSearchParams(window.location.search);
          const sortBy = urlParams.get('sortBy');
          const sortOrder = urlParams.get('sortOrder');
          if (sortBy) {
            const header = document.querySelector('[data-sort="' + sortBy + '"]');
            if (header) {
              const icon = header.querySelector('.sort-icon');
              if (icon) {
                icon.className = 'sort-icon fas fa-sort-' + (sortOrder === 'ASC' ? 'up' : 'down');
              }
            }
          }
        });

        // CSVエクスポート機能
        async function exportLeadsCSV() {
          try {
            const response = await axios.get('/api/leads/export/csv', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'leads.csv');
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
        async function importLeadsCSV() {
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
            
            const leads = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                company_name: values[0] || '',
                department: values[1] || '',
                contact_person: values[2] || '',
                email: values[3] || '',
                phone: values[4] || '',
                status: values[5] || 'active',
                memo: values[6] || ''
              };
            });

            try {
              const response = await axios.post('/api/leads/import/csv', { leads });
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件のリードをインポートしました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (' + err.email + ')';
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
                <a href="/leads" class="border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2">
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
            <i class="fas fa-users mr-2"></i>リード一覧
          </h1>
          <div class="flex space-x-2">
            <button id="csv-export-button" onclick="exportLeadsCSV()" class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700" style="display:none;">
              <i class="fas fa-file-download mr-2"></i>CSVエクスポート
            </button>
            <button id="csv-import-button" onclick="openImportModal()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700" style="display:none;">
              <i class="fas fa-file-upload mr-2"></i>CSVインポート
            </button>
            <button onclick="openCreateModal()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <i class="fas fa-plus mr-2"></i>新規リード作成
            </button>
          </div>
        </div>

        <!-- データテーブル -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
            <thead class="bg-gray-50">
              <tr>
                <th data-sort="company_name" onclick="sortTable('company_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 150px;">
                  会社名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="department" onclick="sortTable('department')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  部署名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="project_count" onclick="sortTable('project_count')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  案件数 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="earliest_contract" onclick="sortTable('earliest_contract')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  契約開始 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="latest_contract" onclick="sortTable('latest_contract')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  最新契約 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="status" onclick="sortTable('status')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  ステータス <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th class="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider admin-only-column" style="display: none; min-width: 80px;">操作</th>
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
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${lead.project_count > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
                      <i class="fas fa-briefcase mr-1"></i>${lead.project_count}件
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.earliest_contract ? `<i class="fas fa-calendar mr-1"></i>${lead.earliest_contract}` : '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.latest_contract ? `<i class="fas fa-calendar mr-1"></i>${lead.latest_contract}` : '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    ${lead.status === 'active' 
                      ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                      : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                    }
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 admin-only-column" style="display: none;" onclick="event.stopPropagation();">
                    <button onclick="confirmDeleteLead(${lead.id}, '${lead.company_name}')" class="text-red-600 hover:text-red-900">
                      <i class="fas fa-trash-alt"></i> 削除
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
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
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-sticky-note mr-1"></i>メモ
              </label>
              <textarea name="memo" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
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


        // 管理者専用列の表示
        document.addEventListener('DOMContentLoaded', async function() {
          const user = await AUTH_UTILS.getCurrentUser();
          if (user && user.role === 'admin') {
            // 管理者専用列を表示
            document.querySelectorAll('.admin-only-column').forEach(el => {
              el.style.display = '';
            });
          }
        });

        // リード削除確認
        async function confirmDeleteLead(leadId, companyName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/leads/' + leadId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ リード: ' + companyName + '\\n';
            
            if (impact.projects.length > 0) {
              message += '\\n■ 案件 (' + impact.projects.length + '件):\\n';
              impact.projects.forEach(p => {
                message += '  - ' + p.project_name + '\\n';
              });
            }
            
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
            
            const deleteResponse = await axios.delete('/api/leads/' + leadId, {
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

        // 月次明細削除確認
        async function confirmDeleteMonthlyDetail(monthlyDetailId, targetMonth, contractName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/monthly-details/' + monthlyDetailId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ 月次明細: ' + targetMonth + ' - ' + contractName + '\\n';
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '\\n■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/monthly-details/' + monthlyDetailId, {
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

        // メンバー削除確認
        async function confirmDeleteMember(memberId, memberName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/members/' + memberId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ メンバー: ' + memberName + '\\n';
            
            if (impact.contract_member_assignments_count > 0) {
              message += '\\n■ 契約メンバーアサイン: ' + impact.contract_member_assignments_count + '件\\n';
            }
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/members/' + memberId, {
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
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: 会社名,部署名,担当者,メールアドレス,電話番号,ステータス,メモ</p>
            <input type="file" id="csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closeImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="import-button" onclick="importLeadsCSV()" disabled class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400">
              インポート実行
            </button>
          </div>
        </div>
      </div>
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
                <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-briefcase mr-2"></i>案件
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
              <dd class="mt-1 flex items-center space-x-2">
                <span id="status-badge">
                  ${lead.status === 'active' 
                    ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                    : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>'
                  }
                </span>
                <button id="toggle-status-button" onclick="toggleLeadStatus()" class="px-3 py-1 text-xs font-medium rounded ${lead.status === 'active' ? 'bg-gray-600 hover:bg-gray-700' : 'bg-green-600 hover:bg-green-700'} text-white">
                  <i class="fas ${lead.status === 'active' ? 'fa-archive' : 'fa-check-circle'} mr-1"></i>
                  ${lead.status === 'active' ? 'アーカイブ' : 'アクティブに戻す'}
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium text-gray-500">登録日</dt>
              <dd class="mt-1 text-sm text-gray-900">${lead.created_at}</dd>
            </div>
          </dl>
          ${lead.memo ? `
            <div class="mt-4 pt-4 border-t border-gray-200">
              <dt class="text-sm font-medium text-gray-500 mb-2">
                <i class="fas fa-sticky-note mr-1"></i>メモ
              </dt>
              <dd class="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">${lead.memo}</dd>
            </div>
          ` : ''}
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
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">見込み月額</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${projects.map((project: any) => `
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="location.href='/projects/detail/${project.id}'">
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        ${project.project_name}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        ${project.sales_rep_name ? `<i class="fas fa-user mr-1 text-blue-500"></i>${project.sales_rep_name}` : '<span class="text-gray-400">-</span>'}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        <i class="fas fa-yen-sign mr-1 text-green-500"></i>${(project.expected_monthly_amount || 0).toLocaleString()}
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
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-yen-sign mr-1"></i>見込み月額
              </label>
              <input type="number" name="expected_monthly_amount" min="0" step="1000"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 1000000">
              <p class="mt-1 text-xs text-gray-500">月額の見込み金額を入力してください（任意）</p>
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
          
          // expected_monthly_amountを数値に変換
          if (data.expected_monthly_amount) {
            data.expected_monthly_amount = parseInt(data.expected_monthly_amount);
          } else {
            data.expected_monthly_amount = 0;
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

        // リードステータス変更
        let currentStatus = '${lead.status}';
        
        async function toggleLeadStatus() {
          const newStatus = currentStatus === 'active' ? 'archived' : 'active';
          const confirmMessage = newStatus === 'archived' 
            ? 'このリードをアーカイブしますか？' 
            : 'このリードをアクティブに戻しますか？';
          
          if (!confirm(confirmMessage)) return;

          try {
            const token = localStorage.getItem('jwt_token');
            const response = await axios.put('/api/leads/${lead.id}/status', 
              { status: newStatus },
              { headers: { 'Authorization': 'Bearer ' + token } }
            );

            if (response.data.success) {
              currentStatus = newStatus;
              
              // ステータスバッジを更新
              const badge = newStatus === 'active'
                ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>アクティブ</span>'
                : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800"><i class="fas fa-archive mr-1"></i>アーカイブ</span>';
              document.getElementById('status-badge').innerHTML = badge;
              
              // ボタンを更新
              const button = document.getElementById('toggle-status-button');
              if (newStatus === 'active') {
                button.className = 'px-3 py-1 text-xs font-medium rounded bg-gray-600 hover:bg-gray-700 text-white';
                button.innerHTML = '<i class="fas fa-archive mr-1"></i>アーカイブ';
              } else {
                button.className = 'px-3 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-700 text-white';
                button.innerHTML = '<i class="fas fa-check-circle mr-1"></i>アクティブに戻す';
              }
              
              alert('ステータスを更新しました');
            }
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // 商談メモ関連の関数は案件詳細画面に移動しました
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
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-sticky-note mr-1"></i>メモ
              </label>
              <textarea name="memo" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">${lead.memo || ''}</textarea>
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
  try {
    const { DB } = c.env
    
    // ダッシュボードデータを取得
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`
    
    // 前月を計算
    let lastYear = year
    let lastMonthNum = month - 1
    if (lastMonthNum === 0) {
      lastYear -= 1
      lastMonthNum = 12
    }
    const lastMonth = `${lastYear}-${String(lastMonthNum).padStart(2, '0')}`
  
  // 当月売上（確定）
  const { results: currentMonthSales } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '検収済').all()
  
  // 前月売上（確定）
  const { results: lastMonthSales } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(lastMonth, '検収済').all()
  
  // 当月売上（予定） - 検収ステータスに関係なく当月の全売上
  const { results: currentMonthPlanned } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ?'
  ).bind(currentMonth).all()
  
  // 未検収金額（当月のみ）
  const { results: uninspected } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE target_month = ? AND inspection_status = ?'
  ).bind(currentMonth, '未検収').all()
  
  // 未請求金額（検収済のみ）
  const { results: unbilled } = await DB.prepare(
    'SELECT SUM(amount_with_tax) as total FROM monthly_details WHERE billing_status = ? AND inspection_status = ?'
  ).bind('未請求', '検収済').all()
  
  // 未入金金額（請求済のみ）
  const { results: unpaid } = await DB.prepare(
    'SELECT SUM(amount_with_tax - total_payment_amount) as total FROM monthly_details WHERE payment_status IN (?, ?) AND billing_status = ?'
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
  
  // メンバー稼働率（前月）
  const { results: memberWorkRatioLastMonth } = await DB.prepare(`
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
  `).bind(lastMonth, lastMonth).all()
  
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
  
  // 入金不一致の月次明細を取得（入金総額が0より大きく、月次明細金額と異なる場合）
  // payment_historiesから実際の入金額を集計して比較（税込み額で比較）
  const { results: paymentMismatches } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount_with_tax,
      COALESCE(SUM(ph.payment_amount), 0) as total_payment_amount,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    GROUP BY md.id, md.target_month, md.amount_with_tax, c.contract_name, p.project_name, l.company_name
    HAVING COALESCE(SUM(ph.payment_amount), 0) > 0 
      AND md.amount_with_tax != COALESCE(SUM(ph.payment_amount), 0)
    ORDER BY md.target_month DESC
    LIMIT 10
  `).all()
  
  const currentMonthSalesTotal = (currentMonthSales[0] as any)?.total || 0
  const lastMonthSalesTotal = (lastMonthSales[0] as any)?.total || 0
  const currentMonthPlannedTotal = (currentMonthPlanned[0] as any)?.total || 0
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
                <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-briefcase mr-2"></i>案件
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-home mr-2"></i>トップダッシュボード
          </h1>
        </div>

        <!-- KPIカード -->
        <!-- 1行目: 売上関連 -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-5">
          <!-- 前月売上 -->
          <a href="/monthly-list?filter=lastMonthInspected" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-history mr-1"></i>前月売上(確定)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-700">
                ¥${lastMonthSalesTotal.toLocaleString()}
              </dd>
            </div>
          </a>

          <!-- 当月売上(確定) -->
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

          <!-- 当月売上(予定) -->
          <a href="/monthly-list" class="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow cursor-pointer">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">
                <i class="fas fa-calendar-check mr-1"></i>当月売上(予定)
              </dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-700">
                ¥${currentMonthPlannedTotal.toLocaleString()}
              </dd>
            </div>
          </a>
        </div>

        <!-- 2行目: 未処理関連 -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">
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
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <!-- メンバー稼働率（前月） -->
          <div class="bg-white shadow rounded-lg p-6">
            <h2 class="text-lg font-semibold text-gray-900 mb-4">
              <i class="fas fa-history mr-2"></i>メンバー稼働率(前月)
            </h2>
            ${memberWorkRatioLastMonth.length > 0 ? `
            <div class="space-y-3">
              ${memberWorkRatioLastMonth.map((m: any) => {
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
              <p>前月のアサインがありません</p>
            </div>
            `}
          </div>

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
          const { overdueInspections, overdueBillings, overduePayments, amountMismatch, paymentMismatches } = tasks;
          
          const totalTasks = overdueInspections.length + overdueBillings.length + overduePayments.length + (amountMismatch ? amountMismatch.length : 0) + (paymentMismatches ? paymentMismatches.length : 0);
          
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
          
          // 入金不一致
          if (paymentMismatches && paymentMismatches.length > 0) {
            html += \`
              <div class="border-l-4 border-pink-500 bg-pink-50 p-4 rounded">
                <h3 class="text-pink-800 font-semibold mb-3 flex items-center">
                  <i class="fas fa-coins mr-2"></i>🔴 入金不一致 (\${paymentMismatches.length}件)
                </h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                  \${paymentMismatches.map(task => \`
                    <a href="/monthly/\${task.id}" class="block bg-white p-3 rounded shadow-sm hover:shadow-md transition-shadow">
                      <div class="text-sm font-medium text-gray-900">\${task.project_name}</div>
                      <div class="text-xs text-gray-600">\${task.target_month}</div>
                      <div class="text-xs text-pink-600 mt-1">
                        請求金額(税込): ¥\${task.amount_with_tax.toLocaleString()}
                      </div>
                      <div class="text-xs text-pink-600">
                        入金総額: ¥\${(task.total_payment_amount || 0).toLocaleString()}
                      </div>
                      <div class="text-xs text-pink-600 font-semibold">
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
  } catch (error) {
    console.error('Dashboard error:', error)
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - SFA</title>
      </head>
      <body>
        <h1>Error</h1>
        <p>An error occurred while loading the dashboard.</p>
        <pre>${error instanceof Error ? error.message : 'Unknown error'}</pre>
        <pre>${error instanceof Error && error.stack ? error.stack : ''}</pre>
        <p><a href="/login">Go to Login</a></p>
      </body>
      </html>
    `, 500)
  }
})


// 案件詳細 (ハブ画面)
// 案件詳細画面（ハブ画面）
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

  // 月次明細を取得（実際の入金履歴から集計）
  const monthlyDetails = await c.env.DB.prepare(`
    SELECT 
      md.*,
      COALESCE(SUM(ph.payment_amount), 0) as paid_amount
    FROM monthly_details md
    LEFT JOIN payment_histories ph ON md.id = ph.monthly_detail_id
    WHERE md.contract_id = ?
    GROUP BY md.id, md.target_month, md.contract_id, md.amount, md.amount_with_tax, md.inspection_status, 
             md.inspection_date, md.billing_status, md.billing_date, md.invoice_number, 
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
          // 認証チェック用のユーティリティ関数（インライン定義）
          const AUTH_UTILS = {
            getToken: function() {
              return localStorage.getItem('jwt_token');
            },
            checkAuth: function() {
              const token = this.getToken();
              if (!token) {
                window.location.href = '/login';
                return false;
              }
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
            hasAnyPermission: function(user, permissions) {
              if (!user) return false;
              if (user.role === 'admin') return true;
              return permissions.some(p => this.hasPermission(user, p));
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
                    <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">月次明細</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額（税抜）</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">金額（税込）</th>
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

// 契約作成画面
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

  // 関連する請求書を取得
  const invoice = await c.env.DB.prepare(`
    SELECT id, invoice_number, issue_date
    FROM invoices
    WHERE monthly_detail_id = ?
    LIMIT 1
  `).bind(id).first()

  // 統計計算
  const totalPayment = payments.results.reduce((sum, p) => sum + (p.payment_amount || 0), 0)
  const remainingAmount = (monthly.amount_with_tax || 0) - totalPayment
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
                  <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-briefcase mr-2"></i>案件
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
                <a href="/leads/${monthly.lead_id}" class="text-blue-600 hover:text-blue-800">${monthly.company_name}</a>
                <span class="text-gray-400 mx-2">/</span>
                <a href="/projects/detail/${monthly.project_id}" class="text-blue-600 hover:text-blue-800">${monthly.project_name}</a>
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
                        <p class="text-sm text-gray-500">金額（税抜）</p>
                        <p class="text-2xl font-bold text-gray-700">¥${(monthly.amount || 0).toLocaleString()}</p>
                        <p class="text-sm text-gray-500 mt-2">金額（税込）</p>
                        <p class="text-3xl font-bold text-blue-600">¥${(monthly.amount_with_tax || 0).toLocaleString()}</p>
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
                <div class="overflow-x-auto">
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
                </div>
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
                    <div class="flex justify-end gap-3">
                        ${!invoice ? `
                        <button type="button" onclick="openCreateInvoiceModal()" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                            <i class="fas fa-receipt mr-2"></i>請求書を作成
                        </button>
                        ` : `
                        <button type="button" onclick="window.open('/invoices/${invoice.id}/pdf', '_blank')" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                            <i class="fas fa-file-pdf mr-2"></i>請求書PDF
                        </button>
                        <a href="/invoices/${invoice.id}" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
                            <i class="fas fa-eye mr-2"></i>請求書詳細
                        </a>
                        `}
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
                            <p class="text-sm text-gray-600">予定金額（税込）</p>
                            <p class="text-xl font-semibold text-gray-700">¥${(monthly.amount_with_tax || 0).toLocaleString()}</p>
                        </div>
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
                            <div class="bg-purple-600 h-2 rounded-full" style="width: ${Math.min(100, (totalPayment / (monthly.amount_with_tax || 1)) * 100)}%"></div>
                        </div>
                    </div>
                </div>

                <!-- 入金履歴 -->
                ${payments.results.length > 0 ? `
                <div class="overflow-x-auto">
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
                </div>
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
            
            // 請求書作成モーダル
            window.openCreateInvoiceModal = function() {
                document.getElementById('create-invoice-modal').classList.remove('hidden')
                // 今日の日付をデフォルト設定
                const today = new Date().toISOString().split('T')[0]
                document.querySelector('#create-invoice-form input[name="issue_date"]').value = today
                // 30日後を支払期限のデフォルト
                const dueDate = new Date()
                dueDate.setDate(dueDate.getDate() + 30)
                document.querySelector('#create-invoice-form input[name="payment_due_date"]').value = dueDate.toISOString().split('T')[0]
                // 件名のデフォルト設定
                document.querySelector('#create-invoice-form input[name="subject"]').value = 
                    '${monthly.target_month} 業務委託費用'
            }
            
            window.closeCreateInvoiceModal = function() {
                document.getElementById('create-invoice-modal').classList.add('hidden')
                document.getElementById('create-invoice-form').reset()
            }
            
            // 請求書作成
            document.getElementById('create-invoice-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const formData = new FormData(e.target)
                const data = {
                    issue_date: formData.get('issue_date'),
                    payment_due_date: formData.get('payment_due_date') || null,
                    subject: formData.get('subject'),
                    notes: formData.get('notes') || null
                }
                
                try {
                    const response = await axios.post('/api/monthly-details/${id}/invoice', data)
                    if (response.data.success) {
                        const invoiceId = response.data.data.invoice_id
                        const invoiceNumber = response.data.data.invoice_number
                        
                        // 確認ダイアログで選択肢を提示
                        const userChoice = confirm(
                            '請求書を作成しました！\\n' +
                            '請求書番号: ' + invoiceNumber + '\\n\\n' +
                            'OKをクリックするとPDFを生成します。\\n' +
                            'キャンセルをクリックすると請求書一覧へ移動します。'
                        )
                        
                        closeCreateInvoiceModal()
                        
                        if (userChoice) {
                            // PDFを新しいタブで開く
                            window.open('/invoices/' + invoiceId + '/pdf', '_blank')
                            // 現在のページをリロードして請求済みに更新
                            setTimeout(() => location.reload(), 500)
                        } else {
                            // 請求書一覧へ遷移
                            window.location.href = '/invoices'
                        }
                    }
                } catch (error) {
                    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message))
                }
            })
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

        <!-- 請求書作成モーダル -->
        <div id="create-invoice-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-10 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-2/3 shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-semibold text-gray-900">
                        <i class="fas fa-receipt mr-2 text-green-600"></i>請求書を作成
                    </h3>
                    <button onclick="closeCreateInvoiceModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <form id="create-invoice-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                発行日 <span class="text-red-500">*</span>
                            </label>
                            <input type="date" name="issue_date" required
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                支払期限
                            </label>
                            <input type="date" name="payment_due_date"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            件名 <span class="text-red-500">*</span>
                        </label>
                        <input type="text" name="subject" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                               placeholder="例: 2026年1月分 業務委託費用">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            備考
                        </label>
                        <textarea name="notes" rows="3"
                                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                  placeholder="支払条件や振込先などの補足情報"></textarea>
                    </div>
                    
                    <!-- 請求金額プレビュー -->
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-semibold text-gray-700 mb-2">請求金額プレビュー</h4>
                        <div class="space-y-1 text-sm">
                            <div class="flex justify-between">
                                <span>小計:</span>
                                <span id="invoice-preview-subtotal">¥${monthly.amount.toLocaleString()}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>消費税 (10%):</span>
                                <span id="invoice-preview-tax">¥${Math.floor(monthly.amount * 0.1).toLocaleString()}</span>
                            </div>
                            <div class="flex justify-between font-bold text-lg border-t pt-1">
                                <span>合計:</span>
                                <span id="invoice-preview-total" class="text-green-600">¥${(monthly.amount + Math.floor(monthly.amount * 0.1)).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex justify-end space-x-3 pt-4">
                        <button type="button" onclick="closeCreateInvoiceModal()" 
                                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                            <i class="fas fa-times mr-2"></i>キャンセル
                        </button>
                        <button type="submit" 
                                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                            <i class="fas fa-check mr-2"></i>請求書を作成
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
  
  // 前月を計算
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  
  let whereClause = ''
  let title = '月次明細一覧'
  let icon = 'fa-calendar'
  
  switch(filter) {
    case 'inspected':
      whereClause = `WHERE md.target_month = '${currentMonth}' AND md.inspection_status = '検収済'`
      title = '当月売上(確定)'
      icon = 'fa-yen-sign'
      break
    case 'lastMonthInspected':
      whereClause = `WHERE md.target_month = '${lastMonth}' AND md.inspection_status = '検収済'`
      title = '前月売上(確定)'
      icon = 'fa-history'
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
                  <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-briefcase mr-2"></i>案件
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
// 案件一覧画面
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

// 見積書一覧画面
app.get('/quotes', async (c) => {
  const { DB } = c.env
  
  const { results: quotes } = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    ORDER BY q.created_at DESC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>見積書一覧 - SFA</title>
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
                    <i class="fas fa-project-diagram mr-2"></i>案件
                  </a>
                  <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-file-contract mr-2"></i>契約
                  </a>
                  <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                    <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
            <h1 class="text-3xl font-bold text-gray-800 mb-6">
                <i class="fas fa-file-invoice mr-2 text-purple-600"></i>見積書一覧
            </h1>

            ${quotes.length > 0 ? `
            <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">見積番号</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">発行日</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">顧客</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">件名</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">ステータス</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">金額</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${quotes.map((quote: any) => {
                            const status = quote.status || 'draft';
                            const statusStyles = {
                                draft: { bg: 'bg-gray-100', text: 'text-gray-800', label: '下書き' },
                                pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '承認待ち' },
                                approved: { bg: 'bg-green-100', text: 'text-green-800', label: '承認済み' },
                                rejected: { bg: 'bg-red-100', text: 'text-red-800', label: '却下' },
                                expired: { bg: 'bg-gray-100', text: 'text-gray-600', label: '期限切れ' }
                            };
                            const style = statusStyles[status] || statusStyles.draft;
                            
                            return `
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                <a href="/quotes/${quote.id}" class="text-blue-600 hover:text-blue-800">
                                    ${quote.quote_number}
                                </a>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                ${quote.issue_date}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                ${quote.company_name}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                ${quote.project_name}
                            </td>
                            <td class="px-6 py-4 text-sm text-gray-700">
                                ${quote.subject}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-center">
                                <span class="inline-block px-2 py-1 text-xs rounded-full ${style.bg} ${style.text}">
                                    ${style.label}
                                </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                                ¥${(quote.total || 0).toLocaleString()}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-center text-sm">
                                <button onclick="window.open('/quotes/${quote.id}/pdf', '_blank')" 
                                        class="text-purple-600 hover:text-purple-900 mr-3">
                                    <i class="fas fa-file-pdf mr-1"></i>PDF
                                </button>
                                <button onclick="deleteQuote(${quote.id})" 
                                        class="text-red-600 hover:text-red-900">
                                    <i class="fas fa-trash mr-1"></i>削除
                                </button>
                            </td>
                        </tr>
                        `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ` : `
            <div class="bg-white rounded-lg shadow p-12 text-center text-gray-500">
                <i class="fas fa-file-invoice text-6xl mb-4"></i>
                <p class="text-xl">見積書がまだありません</p>
                <p class="mt-2">案件詳細画面から見積書を作成してください</p>
            </div>
            `}
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

            AUTH_UTILS.checkAuth();
            AUTH_UTILS.setupAxios();
            
            // ユーザー名を表示
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
            
            async function deleteQuote(id) {
              if (!confirm('この見積書を削除しますか？')) return;
              
              try {
                await axios.delete('/api/quotes/' + id);
                alert('見積書を削除しました');
                location.reload();
              } catch (error) {
                alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
              }
            }
        </script>
    </body>
    </html>
  `)
})

// 見積書PDF表示画面
app.get('/quotes/:id/pdf', async (c) => {
  const id = c.req.param('id')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>見積書PDF - SFA</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            body { font-family: 'メイリオ', 'Meiryo', 'MS Pゴシック', sans-serif; }
        </style>
    </head>
    <body class="bg-gray-100">
        <div id="loading" class="flex items-center justify-center min-h-screen">
            <div class="text-center">
                <div class="mb-4">
                    <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
                </div>
                <p class="text-gray-700">見積書PDFを生成中...</p>
            </div>
        </div>
        
        <!-- 見積書HTMLテンプレート（画像化用） -->
        <!-- ★ A4幅(794px)に合わせた固定幅。left:-99999pxで画面外に配置 -->
        <div id="quote-template" style="position: fixed; left: -99999px; width: 794px; background: white;">
            <!-- コンテンツは動的に生成 -->
        </div>
        
        <script>
            const quoteId = ${id};

            // ===================================================================
            // ★ 改善①：改ページ対応ユーティリティ
            //   canvas を A4高さ(1123px@96dpi相当) ごとに切り出して
            //   jsPDF に複数ページとして追加する
            // ===================================================================
            async function addCanvasToPdfWithPageBreaks(doc, canvas, imgWidthMM) {
                const A4_HEIGHT_MM  = 297;   // A4縦 mm
                const A4_WIDTH_MM   = 210;   // A4横 mm
                const PAGE_MARGIN_MM = 0;    // ページ余白(mm) ※0で端まで使用

                // canvasの1pxが何mmに相当するか
                const pxToMM = imgWidthMM / canvas.width;

                // A4 1ページ分の高さをpx換算
                const pageHeightPx = Math.floor((A4_HEIGHT_MM - PAGE_MARGIN_MM * 2) / pxToMM);

                const totalPages = Math.ceil(canvas.height / pageHeightPx);

                for (let page = 0; page < totalPages; page++) {
                    if (page > 0) {
                        doc.addPage();
                    }

                    // 切り出す範囲
                    const srcY      = page * pageHeightPx;
                    const srcHeight = Math.min(pageHeightPx, canvas.height - srcY);

                    // 一時canvasに切り出し
                    const slice = document.createElement('canvas');
                    slice.width  = canvas.width;
                    slice.height = srcHeight;
                    const ctx = slice.getContext('2d');
                    ctx.drawImage(canvas, 0, srcY, canvas.width, srcHeight,
                                         0, 0,    canvas.width, srcHeight);

                    const sliceData   = slice.toDataURL('image/png');
                    const sliceHeightMM = srcHeight * pxToMM;

                    doc.addImage(sliceData, 'PNG',
                                 PAGE_MARGIN_MM,
                                 PAGE_MARGIN_MM,
                                 A4_WIDTH_MM - PAGE_MARGIN_MM * 2,
                                 sliceHeightMM);
                }
            }
            
            async function generateQuotePDF() {
                try {
                    // localStorageまたはクッキーからトークンを取得
                    let token = localStorage.getItem('jwt_token');
                    
                    if (!token) {
                        const cookies = document.cookie.split(';');
                        for (let cookie of cookies) {
                            const [name, value] = cookie.trim().split('=');
                            if (name === 'jwt_token') {
                                token = value;
                                break;
                            }
                        }
                    }
                    
                    if (!token) {
                        alert('ログインが必要です。ログイン画面に戻ります。');
                        window.location.href = '/login';
                        return;
                    }
                    
                    console.log('トークン取得成功:', token.substring(0, 20) + '...');
                    
                    const response = await fetch('/api/quotes/' + quoteId + '/pdf-data', {
                        headers: { 'Authorization': 'Bearer ' + token },
                        credentials: 'include'
                    });
                    
                    console.log('レスポンスステータス:', response.status);
                    
                    if (!response.ok) {
                        throw new Error('HTTPエラー: ' + response.status);
                    }
                    
                    const result = await response.json();
                    
                    if (!result.success) {
                        alert('データの取得に失敗しました: ' + (result.error || '不明なエラー'));
                        window.close();
                        return;
                    }
                    
                    const { quote, items, companyInfo } = result.data;
                    
                    // ===================================================================
                    // ★ 改善②：ヘッダー余白を詰めてレイアウトを上寄りに変更
                    //   変更点：
                    //   - 外側padding: 40px → 20px 12px（上下を半分に削減）
                    //   - タイトル margin-bottom: 30px → 12px
                    //   - 発行先ブロック margin-bottom: 30px → 14px, padding-bottom: 20px → 10px
                    //   - メタ情報+ロゴ margin-bottom: 30px → 14px
                    //   - 件名ブロック margin-bottom: 25px → 12px, padding: 12px 15px → 8px 12px
                    //   - 金額サマリーカード padding: 20px 25px → 12px 18px, margin-bottom: 30px → 16px
                    //   - 見積明細テーブル行padding: 10px 12px → 7px 10px
                    // ===================================================================
                    const template = document.getElementById('quote-template');
                    template.innerHTML = \`
                        <div style="padding: 20px 40px 30px 40px; font-family: 'メイリオ', 'Meiryo', 'MS Pゴシック', sans-serif; max-width: 794px;">

                            <!-- ===== ヘッダー行：ロゴ（左）＋タイトル（中央）＋会社情報（右） ===== -->
                            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px;">
                                <!-- 左：ロゴ -->
                                <div style="min-width: 130px;">
                                    \${companyInfo.logo_base64
                                        ? '<img src="' + companyInfo.logo_base64 + '" style="max-width: 130px; max-height: 55px; object-fit: contain;">'
                                        : '<div style="width:130px;"></div>'}
                                </div>

                                <!-- 中央：タイトル -->
                                <div style="flex: 1; text-align: center; padding: 0 12px;">
                                    <h1 style="font-size: 26px; font-weight: bold; color: #1a1a1a; letter-spacing: 4px; margin: 0 0 0 0;">見積書</h1>
                                </div>

                                <!-- 右：自社情報 -->
                                <div style="text-align: right; min-width: 180px; max-width: 220px;">
                                    <div style="font-weight: bold; font-size: 12px; color: #1a1a1a; margin-bottom: 3px;">\${companyInfo.company_name}</div>
                                    <div style="font-size: 9px; color: #555; line-height: 1.55; word-break: break-all;">
                                        \${companyInfo.postal_code ? '<div>〒' + companyInfo.postal_code + '</div>' : ''}
                                        \${companyInfo.address    ? '<div>' + companyInfo.address + '</div>'    : ''}
                                        \${companyInfo.registration_number ? '<div style="margin-top:3px;">登録番号: ' + companyInfo.registration_number + '</div>' : ''}
                                    </div>
                                    \${companyInfo.seal_base64
                                        ? '<div style="margin-top:6px;"><img src="' + companyInfo.seal_base64 + '" style="max-width:55px; max-height:55px; object-fit:contain;"></div>'
                                        : ''}
                                </div>
                            </div>

                            <!-- ===== 見積番号・発行日・有効期限（横並び小型） ===== -->
                            <div style="display: flex; gap: 24px; margin-bottom: 10px; padding: 6px 10px; background: #f8f9fa; border-radius: 4px; border: 1px solid #e8e8e8;">
                                <div>
                                    <span style="font-size: 9px; color: #888; font-weight: 500; display: block;">見積番号</span>
                                    <span style="font-size: 12px; color: #1a1a1a; font-weight: 700;">\${quote.quote_number}</span>
                                </div>
                                <div>
                                    <span style="font-size: 9px; color: #888; font-weight: 500; display: block;">発行日</span>
                                    <span style="font-size: 12px; color: #1a1a1a;">\${quote.issue_date}</span>
                                </div>
                                \${quote.expiry_date ? '<div><span style="font-size:9px;color:#888;font-weight:500;display:block;">有効期限</span><span style="font-size:12px;color:#1a1a1a;">' + quote.expiry_date + '</span></div>' : ''}
                            </div>

                            <!-- ===== 発行先 ===== -->
                            <div style="margin-bottom: 10px; border-bottom: 1.5px solid #e0e0e0; padding-bottom: 8px;">
                                <span style="font-size: 10px; color: #666; font-weight: 500; display: block; margin-bottom: 3px;">発行先</span>
                                <span style="font-size: 18px; font-weight: bold; color: #1a1a1a; display: block;">\${quote.company_name}</span>
                                <span style="font-size: 14px; color: #333;">\${quote.honorific || '御中'}</span>
                            </div>

                            <!-- ===== 件名 ===== -->
                            <div style="margin-bottom: 12px; padding: 7px 12px; background: #f8f9fa; border-left: 4px solid #4a90e2; border-radius: 4px;">
                                <span style="font-size: 9px; color: #666; margin-bottom: 2px; font-weight: 500; display: block;">件名</span>
                                <span style="font-size: 13px; color: #1a1a1a; font-weight: 600;">\${quote.subject}</span>
                            </div>
                            
                            <!-- ===== 金額サマリーカード ===== -->
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px 20px; margin-bottom: 14px; border-radius: 6px;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 12px; color: rgba(255,255,255,0.9); font-weight: 500;">お見積金額（消費税込み）</span>
                                    <span style="font-size: 26px; font-weight: bold; color: #ffffff; letter-spacing: 1px;">¥\${(quote.total || 0).toLocaleString()}</span>
                                </div>
                            </div>
                            
                            <!-- ===== 見積明細テーブル ===== -->
                            <div style="margin-bottom: 16px;">
                                <div style="font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #1a1a1a; padding-bottom: 6px; border-bottom: 2px solid #4a90e2;">
                                    見積明細
                                </div>
                                <!-- ★ 改善③：table-layout:fixed + 行paddingを削減してコンパクトに -->
                                <table style="width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed;">
                                    <colgroup>
                                        <col style="width: auto;">
                                        <col style="width: 52px;">
                                        <col style="width: 44px;">
                                        <col style="width: 96px;">
                                        <col style="width: 56px;">
                                        <col style="width: 100px;">
                                    </colgroup>
                                    <thead>
                                        <tr style="background: #4a90e2; color: white;">
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 10px; text-align: left; font-weight: 600;">品目・品名</th>
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 6px; text-align: right; font-weight: 600;">数量</th>
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 6px; text-align: center; font-weight: 600;">単位</th>
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 6px; text-align: right; font-weight: 600;">単価</th>
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 6px; text-align: right; font-weight: 600;">稼働率</th>
                                            <th style="border: 1px solid #3a7bc8; padding: 7px 8px; text-align: right; font-weight: 600;">金額</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${items.map((item, index) => \`
                                            <tr style="background: \${index % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 10px; line-height: 1.5; word-break: break-word;">
                                                    <div style="font-weight: 500; color: #1a1a1a;">\${item.item_description}</div>
                                                    \${item.note ? '<div style="font-size: 9px; color: #666; margin-top: 2px; padding-left: 6px; border-left: 2px solid #ddd;">' + item.note + '</div>' : ''}
                                                </td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: right; font-weight: 500;">\${item.quantity.toLocaleString()}</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: center; color: #666;">\${item.unit || ''}</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: right; font-weight: 500;">¥\${(item.unit_price || 0).toLocaleString()}</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: right; font-weight: 500;">\${((item.workload || 1.0) * 100).toFixed(0)}%</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #1a1a1a;">¥\${(item.amount || 0).toLocaleString()}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                    <tfoot>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="5" style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #1a1a1a;">小計</td>
                                            <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 700; color: #1a1a1a;">¥\${(quote.subtotal || 0).toLocaleString()}</td>
                                        </tr>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="5" style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #666;">消費税(10%)</td>
                                            <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 700; color: #666;">¥\${(quote.tax || 0).toLocaleString()}</td>
                                        </tr>
                                        <tr style="background: #4a90e2; color: white;">
                                            <td colspan="5" style="border: 1px solid #3a7bc8; padding: 9px 8px; text-align: right; font-weight: 700; font-size: 13px;">合計金額</td>
                                            <td style="border: 1px solid #3a7bc8; padding: 9px 8px; text-align: right; font-weight: 700; font-size: 14px;">¥\${(quote.total || 0).toLocaleString()}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            
                            <!-- ===== 備考 ===== -->
                            \${quote.notes ? '<div style="margin-top: 16px; padding: 10px 14px; background: #f8f9fa; border-left: 4px solid #4a90e2; border-radius: 4px;"><div style="font-weight: 600; margin-bottom: 5px; font-size: 11px; color: #1a1a1a;">備考</div><div style="font-size: 11px; line-height: 1.7; color: #333; white-space: pre-wrap;">' + quote.notes + '</div></div>' : ''}
                        </div>
                    \`;
                    
                    // HTMLを画像に変換（scaleを2→1.8に調整して画質とサイズのバランスを取る）
                    const canvas = await html2canvas(template, {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                        windowWidth: 794,
                        windowHeight: template.scrollHeight
                    });
                    
                    // jsPDF初期化
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF({
                        orientation: 'portrait',
                        unit: 'mm',
                        format: 'a4'
                    });
                    
                    // ★ 改善①：改ページ対応で複数ページに分割して追加
                    await addCanvasToPdfWithPageBreaks(doc, canvas, 210);
                    
                    // PDFをダウンロード
                    const fileName = '見積書_' + quote.quote_number + '_' + new Date().toISOString().split('T')[0] + '.pdf';
                    doc.save(fileName);
                    
                    // 3秒後にウィンドウを閉じる
                    setTimeout(() => {
                        window.close();
                    }, 3000);
                    
                } catch (error) {
                    console.error('PDF生成エラー:', error);
                    alert('PDF生成に失敗しました: ' + error.message);
                    window.close();
                }
            }
            
            // ページロード後にPDF生成
            window.addEventListener('load', generateQuotePDF);
        </script>
    </body>
    </html>
  `)
})

// 見積書詳細画面（認証必須）
app.get('/quotes/:id', async (c) => {
  const id = c.req.param('id')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>見積書詳細 - SFA</title>
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

        <div class="max-w-6xl mx-auto p-8">
            <!-- ローディング表示 -->
            <div id="loading" class="flex items-center justify-center py-12">
                <div class="text-center">
                    <i class="fas fa-spinner fa-spin text-4xl text-blue-600 mb-4"></i>
                    <p class="text-gray-600">読み込み中...</p>
                </div>
            </div>

            <!-- メインコンテンツ -->
            <div id="content" class="hidden">
                <!-- パンくずリスト -->
                <div class="mb-6">
                    <nav class="flex" aria-label="Breadcrumb">
                        <ol class="inline-flex items-center space-x-1 md:space-x-3">
                            <li class="inline-flex items-center">
                                <a href="/quotes" class="text-gray-600 hover:text-blue-600">
                                    <i class="fas fa-file-invoice mr-2"></i>見積書一覧
                                </a>
                            </li>
                            <li>
                                <div class="flex items-center">
                                    <i class="fas fa-chevron-right text-gray-400 mx-2"></i>
                                    <span class="text-gray-900 font-medium" id="breadcrumb-title">詳細</span>
                                </div>
                            </li>
                        </ol>
                    </nav>
                </div>

                <!-- ヘッダー -->
                <div class="bg-white border-b border-gray-200 p-6 mb-6 rounded-t-lg shadow-sm">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="text-sm text-gray-500 mb-1">発行先</p>
                            <h2 class="text-2xl font-bold text-gray-900" id="company-name">-</h2>
                            <p class="text-gray-600" id="honorific">-</p>
                        </div>
                        <div class="text-right text-sm text-gray-600">
                            <p><span class="font-medium">見積番号:</span> <span id="quote-number">-</span></p>
                            <p><span class="font-medium">発行日:</span> <span id="issue-date">-</span></p>
                            <p><span class="font-medium">有効期限:</span> <span id="expiry-date">-</span></p>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-gray-100">
                        <p class="text-sm text-gray-500 mb-1">件名</p>
                        <p class="text-lg text-gray-900" id="subject">-</p>
                    </div>
                </div>

                <!-- 金額サマリーカード -->
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6 shadow-lg border-2 border-blue-200">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="text-sm text-gray-600 mb-1">お見積金額</p>
                            <p class="text-4xl font-bold text-gray-900" id="total-amount">¥0</p>
                            <p class="text-xs text-gray-500 mt-1">消費税込み</p>
                        </div>
                        <div class="text-right">
                            <span id="status-badge" class="inline-block px-3 py-1 text-sm rounded-full">-</span>
                        </div>
                    </div>
                    
                    <!-- 内訳ドロップダウン -->
                    <button onclick="toggleBreakdown()" class="text-sm text-blue-600 hover:text-blue-700 mt-3 flex items-center">
                        <i id="breakdown-icon" class="fas fa-chevron-down mr-1"></i> 
                        <span id="breakdown-toggle-text">内訳を表示</span>
                    </button>
                    
                    <div id="breakdown" class="hidden mt-3 pt-3 border-t border-gray-300">
                        <div class="flex justify-between text-sm mb-1">
                            <span>小計</span>
                            <span id="subtotal-amount">¥0</span>
                        </div>
                        <div class="flex justify-between text-sm text-gray-600 mb-2">
                            <span>消費税(<span id="tax-rate">10</span>%)</span>
                            <span id="tax-amount">¥0</span>
                        </div>
                    </div>
                </div>

                <!-- タブナビゲーション -->
                <div class="border-b border-gray-200 mb-6">
                    <nav class="-mb-px flex space-x-8">
                        <button onclick="switchTab('overview')" 
                                id="tab-overview" 
                                class="tab-button border-blue-500 text-blue-600 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                            <i class="fas fa-info-circle mr-2"></i>概要
                        </button>
                        <button onclick="switchTab('items')" 
                                id="tab-items" 
                                class="tab-button border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                            <i class="fas fa-list-ul mr-2"></i>明細
                        </button>
                        <button onclick="switchTab('history')" 
                                id="tab-history" 
                                class="tab-button border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                            <i class="fas fa-history mr-2"></i>履歴
                        </button>
                    </nav>
                </div>

                <!-- タブコンテンツ -->
                <!-- 概要タブ -->
                <div id="tab-content-overview" class="tab-content">
                    <!-- 基本情報 -->
                    <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
                        <h3 class="text-lg font-semibold mb-4 flex items-center border-b border-gray-200 pb-3">
                            <i class="fas fa-clipboard-list mr-2 text-blue-600"></i>
                            基本情報
                        </h3>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="text-sm font-medium text-gray-500">見積番号</label>
                                <p class="mt-1 text-base text-gray-900" id="overview-quote-number">-</p>
                            </div>
                            <div>
                                <label class="text-sm font-medium text-gray-500">発行日</label>
                                <p class="mt-1 text-base text-gray-900" id="overview-issue-date">-</p>
                            </div>
                            <div>
                                <label class="text-sm font-medium text-gray-500">有効期限</label>
                                <p class="mt-1 text-base text-gray-900" id="overview-expiry-date">-</p>
                            </div>
                            <div>
                                <label class="text-sm font-medium text-gray-500">ステータス</label>
                                <p class="mt-1"><span id="overview-status-badge" class="inline-block px-2 py-1 text-xs rounded-full">-</span></p>
                            </div>
                            <div class="col-span-2">
                                <label class="text-sm font-medium text-gray-500">案件</label>
                                <p class="mt-1 text-base text-gray-900" id="overview-project-name">-</p>
                            </div>
                        </div>
                    </div>

                    <!-- 備考 -->
                    <div id="overview-notes-section" class="bg-white rounded-lg shadow-sm p-6 mb-6 hidden">
                        <h3 class="text-lg font-semibold mb-4 flex items-center border-b border-gray-200 pb-3">
                            <i class="fas fa-sticky-note mr-2 text-blue-600"></i>
                            備考
                        </h3>
                        <p id="overview-notes-content" class="text-sm text-gray-600 whitespace-pre-wrap">-</p>
                    </div>
                </div>

                <!-- 明細タブ -->
                <div id="tab-content-items" class="tab-content hidden">
                    <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
                        <h3 class="text-lg font-semibold mb-4 flex items-center">
                            <i class="fas fa-list-ul mr-2 text-blue-600"></i>
                            見積明細
                        </h3>
                        
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead class="bg-gray-50 border-b-2 border-gray-300">
                                    <tr>
                                        <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">品目・品名</th>
                                        <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-20">数量</th>
                                        <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-16">単位</th>
                                        <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-28">単価</th>
                                        <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-32">金額</th>
                                    </tr>
                                </thead>
                                <tbody id="items-tbody" class="divide-y divide-gray-200">
                                    <!-- 動的に生成 -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- 履歴タブ -->
                <div id="tab-content-history" class="tab-content hidden">
                    <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
                        <h3 class="text-lg font-semibold mb-4 flex items-center">
                            <i class="fas fa-history mr-2 text-blue-600"></i>
                            変更履歴
                        </h3>
                        <div id="history-list" class="space-y-3">
                            <p class="text-gray-500 text-center py-8">変更履歴はまだありません</p>
                        </div>
                    </div>
                </div>

                <!-- アクションバー -->
                <div class="bg-white border border-gray-200 rounded-lg shadow-sm p-4 sticky bottom-0 z-40">
                    <div class="flex justify-between items-center">
                        <a href="/quotes" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                            <i class="fas fa-arrow-left mr-2"></i>一覧に戻る
                        </a>
                        
                        <div class="flex space-x-3">
                            <button onclick="openStatusModal()" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                                <i class="fas fa-exchange-alt mr-2"></i>ステータス変更
                            </button>
                            <button onclick="window.open('/quotes/${id}/pdf', '_blank')" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                                <i class="fas fa-file-pdf mr-2"></i>PDF出力
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ステータス変更モーダル -->
        <div id="status-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h3 class="text-lg font-semibold mb-4">見積ステータスを変更</h3>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">変更後のステータス</label>
                    <select id="new-status" class="w-full border border-gray-300 rounded px-3 py-2">
                        <option value="draft">下書き</option>
                        <option value="pending">承認待ち</option>
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                        <option value="expired">期限切れ</option>
                    </select>
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">コメント（任意）</label>
                    <textarea id="status-comment" rows="3" class="w-full border border-gray-300 rounded px-3 py-2" placeholder="ステータス変更の理由やメモを入力..."></textarea>
                </div>
                
                <div class="flex justify-end space-x-3">
                    <button onclick="closeStatusModal()" class="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">
                        キャンセル
                    </button>
                    <button onclick="submitStatusChange()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        変更を保存
                    </button>
                </div>
            </div>
        </div>

        <script>
            const QUOTE_ID = ${id};
            let quoteData = null;

            // ステータスバッジのスタイル
            const STATUS_STYLES = {
                draft: { bg: 'bg-gray-100', text: 'text-gray-800', label: '下書き' },
                pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '承認待ち' },
                approved: { bg: 'bg-green-100', text: 'text-green-800', label: '承認済み' },
                rejected: { bg: 'bg-red-100', text: 'text-red-800', label: '却下' },
                expired: { bg: 'bg-gray-100', text: 'text-gray-600', label: '期限切れ' }
            };

            // 内訳の表示切り替え
            function toggleBreakdown() {
                const breakdown = document.getElementById('breakdown');
                const icon = document.getElementById('breakdown-icon');
                const toggleText = document.getElementById('breakdown-toggle-text');
                
                if (breakdown.classList.contains('hidden')) {
                    breakdown.classList.remove('hidden');
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-up');
                    toggleText.textContent = '内訳を隠す';
                } else {
                    breakdown.classList.add('hidden');
                    icon.classList.remove('fa-chevron-up');
                    icon.classList.add('fa-chevron-down');
                    toggleText.textContent = '内訳を表示';
                }
            }

            // タブ切り替え
            function switchTab(tabName) {
                // すべてのタブボタンを非アクティブに
                const tabButtons = document.querySelectorAll('.tab-button');
                tabButtons.forEach(btn => {
                    btn.classList.remove('border-blue-500', 'text-blue-600');
                    btn.classList.add('border-transparent', 'text-gray-500');
                });

                // すべてのタブコンテンツを隠す
                const tabContents = document.querySelectorAll('.tab-content');
                tabContents.forEach(content => {
                    content.classList.add('hidden');
                });

                // 選択されたタブをアクティブに
                const activeButton = document.getElementById(\`tab-\${tabName}\`);
                activeButton.classList.remove('border-transparent', 'text-gray-500');
                activeButton.classList.add('border-blue-500', 'text-blue-600');

                // 選択されたタブコンテンツを表示
                const activeContent = document.getElementById(\`tab-content-\${tabName}\`);
                activeContent.classList.remove('hidden');
            }

            // 見積書データの読み込み
            async function loadQuoteData() {
                try {
                    const token = localStorage.getItem('jwt_token') || getCookie('jwt_token');
                    if (!token) {
                        window.location.href = '/login';
                        return;
                    }

                    const response = await axios.get(\`/api/quotes/\${QUOTE_ID}\`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });

                    if (!response.data.success) {
                        alert('見積書の取得に失敗しました: ' + response.data.error);
                        window.location.href = '/quotes';
                        return;
                    }

                    quoteData = response.data.data;
                    renderQuoteData();
                } catch (error) {
                    console.error('エラー:', error);
                    alert('見積書の取得に失敗しました');
                    window.location.href = '/quotes';
                }
            }

            // 見積書データの表示
            function renderQuoteData() {
                const data = quoteData;

                // ヘッダー情報
                document.getElementById('breadcrumb-title').textContent = data.quote_number;
                document.getElementById('company-name').textContent = data.company_name || '-';
                document.getElementById('honorific').textContent = data.honorific || '御中';
                document.getElementById('quote-number').textContent = data.quote_number;
                document.getElementById('issue-date').textContent = data.issue_date;
                document.getElementById('expiry-date').textContent = data.expiry_date || '無期限';
                document.getElementById('subject').textContent = data.subject;

                // 金額サマリー
                document.getElementById('total-amount').textContent = '¥' + (data.total || 0).toLocaleString();
                document.getElementById('subtotal-amount').textContent = '¥' + (data.subtotal || 0).toLocaleString();
                document.getElementById('tax-rate').textContent = data.tax_rate || 10;
                document.getElementById('tax-amount').textContent = '¥' + (data.tax || 0).toLocaleString();

                // ステータスバッジ
                const status = data.status || 'draft';
                const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.draft;
                const badge = document.getElementById('status-badge');
                badge.className = \`inline-block px-3 py-1 text-sm rounded-full \${statusStyle.bg} \${statusStyle.text}\`;
                badge.textContent = statusStyle.label;

                // 概要タブの基本情報
                document.getElementById('overview-quote-number').textContent = data.quote_number;
                document.getElementById('overview-issue-date').textContent = data.issue_date;
                document.getElementById('overview-expiry-date').textContent = data.expiry_date || '無期限';
                document.getElementById('overview-project-name').textContent = data.project_name || '-';
                
                const overviewBadge = document.getElementById('overview-status-badge');
                overviewBadge.className = \`inline-block px-2 py-1 text-xs rounded-full \${statusStyle.bg} \${statusStyle.text}\`;
                overviewBadge.textContent = statusStyle.label;

                // 概要タブの備考
                if (data.notes) {
                    document.getElementById('overview-notes-section').classList.remove('hidden');
                    document.getElementById('overview-notes-content').textContent = data.notes;
                }

                // 明細
                const tbody = document.getElementById('items-tbody');
                tbody.innerHTML = '';
                
                if (data.items && data.items.length > 0) {
                    data.items.forEach(item => {
                        const tr = document.createElement('tr');
                        tr.className = 'hover:bg-gray-50 transition';
                        tr.innerHTML = \`
                            <td class="px-4 py-3">
                                <div class="text-sm text-gray-900">\${item.item_description}</div>
                                \${item.note ? '<div class="text-xs text-gray-500 mt-1">' + item.note + '</div>' : ''}
                            </td>
                            <td class="px-4 py-3 text-right text-sm">\${item.quantity.toLocaleString()}</td>
                            <td class="px-4 py-3 text-center text-sm">\${item.unit || ''}</td>
                            <td class="px-4 py-3 text-right text-sm">¥\${(item.unit_price || 0).toLocaleString()}</td>
                            <td class="px-4 py-3 text-right text-sm font-semibold">¥\${(item.amount || 0).toLocaleString()}</td>
                        \`;
                        tbody.appendChild(tr);
                    });
                } else {
                    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">明細がありません</td></tr>';
                }

                // ローディングを隠してコンテンツを表示
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('content').classList.remove('hidden');
            }

            // Cookieから値を取得
            function getCookie(name) {
                const cookies = document.cookie.split(';');
                for (let cookie of cookies) {
                    const [cookieName, cookieValue] = cookie.trim().split('=');
                    if (cookieName === name) return cookieValue;
                }
                return null;
            }

            // ステータス変更モーダルを開く
            function openStatusModal() {
                const modal = document.getElementById('status-modal');
                const selectElement = document.getElementById('new-status');
                
                // 現在のステータスを選択
                if (quoteData && quoteData.status) {
                    selectElement.value = quoteData.status;
                }
                
                modal.classList.remove('hidden');
            }

            // ステータス変更モーダルを閉じる
            function closeStatusModal() {
                const modal = document.getElementById('status-modal');
                modal.classList.add('hidden');
                document.getElementById('status-comment').value = '';
            }

            // ステータス変更を送信
            async function submitStatusChange() {
                const newStatus = document.getElementById('new-status').value;
                const comment = document.getElementById('status-comment').value;

                if (!newStatus) {
                    alert('ステータスを選択してください');
                    return;
                }

                try {
                    const token = localStorage.getItem('jwt_token') || getCookie('jwt_token');
                    const response = await axios.put(\`/api/quotes/\${QUOTE_ID}/status\`, {
                        status: newStatus,
                        comment: comment || null
                    }, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });

                    if (response.data.success) {
                        alert('ステータスを更新しました');
                        closeStatusModal();
                        // ページをリロードしてデータを再取得
                        location.reload();
                    } else {
                        alert('ステータスの更新に失敗しました: ' + response.data.error);
                    }
                } catch (error) {
                    console.error('エラー:', error);
                    alert('ステータスの更新に失敗しました: ' + (error.response?.data?.error || error.message));
                }
            }

            // ステータス変更履歴を読み込む
            async function loadStatusHistory() {
                try {
                    const token = localStorage.getItem('jwt_token') || getCookie('jwt_token');
                    const response = await axios.get(\`/api/quotes/\${QUOTE_ID}/status-history\`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });

                    if (response.data.success) {
                        const history = response.data.data;
                        const historyList = document.getElementById('history-list');
                        
                        if (history && history.length > 0) {
                            historyList.innerHTML = history.map(item => {
                                const statusStyles = {
                                    draft: { label: '下書き' },
                                    pending: { label: '承認待ち' },
                                    approved: { label: '承認済み' },
                                    rejected: { label: '却下' },
                                    expired: { label: '期限切れ' }
                                };
                                const fromLabel = statusStyles[item.from_status]?.label || item.from_status;
                                const toLabel = statusStyles[item.to_status]?.label || item.to_status;
                                
                                return \`
                                    <div class="border border-gray-200 rounded-lg p-4">
                                        <div class="flex justify-between items-start mb-2">
                                            <div>
                                                <span class="text-sm text-gray-600">\${fromLabel}</span>
                                                <i class="fas fa-arrow-right mx-2 text-gray-400"></i>
                                                <span class="text-sm font-semibold">\${toLabel}</span>
                                            </div>
                                            <span class="text-xs text-gray-500">\${new Date(item.changed_at).toLocaleString('ja-JP')}</span>
                                        </div>
                                        <div class="text-sm text-gray-600">
                                            変更者: \${item.changed_by_name || 'システム'}
                                        </div>
                                        \${item.comment ? '<div class="mt-2 text-sm text-gray-700 bg-gray-50 p-2 rounded">' + item.comment + '</div>' : ''}
                                    </div>
                                \`;
                            }).join('');
                        } else {
                            historyList.innerHTML = '<p class="text-gray-500 text-center py-8">変更履歴はまだありません</p>';
                        }
                    }
                } catch (error) {
                    console.error('履歴取得エラー:', error);
                }
            }

            // ページロード時にデータを取得
            window.addEventListener('load', () => {
                loadQuoteData();
                loadStatusHistory();
            });
        </script>
    </body>
    </html>
  `)
})

// 請求書一覧画面
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

// 請求書詳細画面
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

// 請求書PDF生成画面
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
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            body { 
                margin: 0; 
                padding: 20px;
                background-color: #f5f5f5;
            }
            .pdf-container {
                width: 794px;
                background: white;
                padding: 40px;
                margin: 0 auto;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .invoice-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 2px solid #22c55e;
            }
            .customer-info {
                flex: 1;
            }
            .customer-name {
                font-size: 20px;
                font-weight: bold;
                color: #1f2937;
                margin-bottom: 8px;
            }
            .customer-address {
                font-size: 12px;
                color: #6b7280;
                line-height: 1.6;
            }
            .company-info {
                text-align: right;
                font-size: 8px;
                color: #4b5563;
                line-height: 1.6;
                max-width: 280px;
                margin-left: auto;
                word-break: break-all;
            }
            .company-name-right {
                font-weight: bold;
                font-size: 13px;
                color: #1f2937;
                margin-bottom: 4px;
            }
            .invoice-title {
                text-align: center;
                font-size: 32px;
                font-weight: bold;
                color: #1f2937;
                margin: 20px 0 30px 0;
                letter-spacing: 8px;
            }
            .metadata {
                display: flex;
                justify-content: flex-end;
                gap: 30px;
                margin-bottom: 30px;
                font-size: 12px;
            }
            .metadata-item {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .metadata-label {
                color: #6b7280;
                font-weight: 500;
            }
            .metadata-value {
                color: #1f2937;
                font-weight: 600;
            }
            .amount-summary {
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                border-radius: 12px;
                padding: 24px;
                margin: 30px 0;
                box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
            }
            .amount-label {
                color: rgba(255, 255, 255, 0.9);
                font-size: 14px;
                font-weight: 500;
                margin-bottom: 8px;
            }
            .amount-value {
                color: white;
                font-size: 32px;
                font-weight: bold;
                letter-spacing: 1px;
            }
            .subject-section {
                background-color: #f0fdf4;
                border-left: 4px solid #22c55e;
                padding: 16px 20px;
                margin: 25px 0;
                border-radius: 4px;
            }
            .subject-label {
                color: #16a34a;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 6px;
            }
            .subject-text {
                color: #1f2937;
                font-size: 15px;
                font-weight: 500;
                line-height: 1.6;
            }
            .items-table {
                width: 100%;
                border-collapse: collapse;
                margin: 25px 0;
                font-size: 12px;
            }
            .items-table thead {
                background-color: #22c55e;
                color: white;
            }
            .items-table th {
                padding: 12px;
                text-align: left;
                font-weight: 600;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .items-table td {
                padding: 12px;
                border-bottom: 1px solid #e0e0e0;
                color: #374151;
            }
            .items-table tbody tr:nth-child(even) {
                background-color: #f9fafb;
            }
            .items-table tbody tr:hover {
                background-color: #f0fdf4;
            }
            .items-table td:last-child,
            .items-table th:last-child {
                text-align: right;
                font-weight: 600;
            }
            .item-note {
                border-left: 2px solid #22c55e;
                padding-left: 10px;
                font-size: 10px;
                color: #6b7280;
                font-style: italic;
                margin-top: 4px;
            }
            .summary-row {
                background-color: #22c55e !important;
                color: white !important;
                font-weight: bold !important;
                font-size: 13px !important;
            }
            .summary-row td {
                padding: 14px 12px !important;
                border-bottom: none !important;
            }
            .bank-info {
                background-color: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 20px;
                margin: 25px 0;
            }
            .bank-title {
                color: #16a34a;
                font-size: 12px;
                font-weight: 600;
                margin-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .bank-details {
                font-size: 12px;
                color: #374151;
                line-height: 1.8;
            }
            .notes-section {
                background-color: #fffbeb;
                border: 1px solid #fde68a;
                border-radius: 8px;
                padding: 16px 20px;
                margin-top: 25px;
            }
            .notes-title {
                color: #92400e;
                font-size: 11px;
                font-weight: 600;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .notes-text {
                color: #78350f;
                font-size: 12px;
                line-height: 1.7;
                white-space: pre-wrap;
            }
        </style>
    </head>
    <body>
        <div class="text-center" style="padding: 20px;">
            <i class="fas fa-spinner fa-spin text-4xl text-green-600"></i>
            <p class="text-gray-700" style="margin-top: 16px;">請求書PDFを生成中...</p>
        </div>
        
        <div id="pdf-content" class="pdf-container" style="position: absolute; left: -9999px;">
            <!-- PDFコンテンツはJavaScriptで動的生成 -->
        </div>
        
        <script>
            const invoiceId = ${id};
            
            async function generateInvoicePDF() {
                try {
                    // トークン取得
                    let token = localStorage.getItem('jwt_token');
                    if (!token) {
                        const cookies = document.cookie.split(';');
                        for (let cookie of cookies) {
                            const [name, value] = cookie.trim().split('=');
                            if (name === 'jwt_token') {
                                token = value;
                                break;
                            }
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
                    
                    if (!response.ok) {
                        throw new Error('HTTPエラー: ' + response.status);
                    }
                    
                    const result = await response.json();
                    if (!result.success) {
                        alert('データの取得に失敗しました: ' + (result.error || '不明なエラー'));
                        window.close();
                        return;
                    }
                    
                    const { invoice, items, companyInfo } = result.data;
                    
                    // PDFコンテンツ生成
                    const pdfContent = document.getElementById('pdf-content');
                    let html = '';
                    
                    // ヘッダー
                    html += '<div class="invoice-header">';
                    html += '<div class="customer-info">';
                    html += '<div class="customer-name">' + (invoice.company_name || '') + ' ' + (invoice.honorific || '御中') + '</div>';
                    if (invoice.billing_postal_code && invoice.billing_address) {
                        html += '<div class="customer-address">';
                        html += '〒' + invoice.billing_postal_code + '<br>';
                        html += invoice.billing_address;
                        html += '</div>';
                    }
                    html += '</div>';
                    
                    html += '<div class="company-info">';
                    if (companyInfo.logo_base64) {
                        html += '<img src="' + companyInfo.logo_base64 + '" style="max-width: 120px; max-height: 40px; margin-bottom: 8px;" /><br>';
                    }
                    html += '<div class="company-name-right">' + (companyInfo.company_name || '') + '</div>';
                    if (companyInfo.postal_code && companyInfo.address) {
                        html += '<div>〒' + companyInfo.postal_code + '</div>';
                        html += '<div style="word-break: break-all;">' + companyInfo.address + '</div>';
                    }
                    if (companyInfo.registration_number) {
                        html += '<div style="margin-top: 4px;">登録番号: ' + companyInfo.registration_number + '</div>';
                    }
                    if (companyInfo.seal_base64) {
                        html += '<img src="' + companyInfo.seal_base64 + '" style="max-width: 60px; max-height: 60px; margin-top: 8px;" />';
                    }
                    html += '</div>';
                    html += '</div>';
                    
                    // タイトル
                    html += '<div class="invoice-title">請求書</div>';
                    
                    // メタデータ
                    html += '<div class="metadata">';
                    html += '<div class="metadata-item">';
                    html += '<span class="metadata-label">請求書番号:</span>';
                    html += '<span class="metadata-value">' + (invoice.invoice_number || '') + '</span>';
                    html += '</div>';
                    html += '<div class="metadata-item">';
                    html += '<span class="metadata-label">発行日:</span>';
                    html += '<span class="metadata-value">' + (invoice.issue_date || '') + '</span>';
                    html += '</div>';
                    if (invoice.payment_due_date) {
                        html += '<div class="metadata-item">';
                        html += '<span class="metadata-label">支払期限:</span>';
                        html += '<span class="metadata-value">' + invoice.payment_due_date + '</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    
                    // 金額サマリー
                    html += '<div class="amount-summary">';
                    html += '<div class="amount-label">ご請求金額</div>';
                    html += '<div class="amount-value">¥' + (invoice.total || 0).toLocaleString() + '</div>';
                    html += '</div>';
                    
                    // 件名
                    if (invoice.subject) {
                        html += '<div class="subject-section">';
                        html += '<div class="subject-label">件名</div>';
                        html += '<div class="subject-text">' + invoice.subject + '</div>';
                        html += '</div>';
                    }
                    
                    // 明細テーブル
                    html += '<table class="items-table">';
                    html += '<thead>';
                    html += '<tr>';
                    html += '<th style="width: 35%;">品目・品名</th>';
                    html += '<th style="width: 12%; text-align: center;">数量</th>';
                    html += '<th style="width: 10%; text-align: center;">単位</th>';
                    html += '<th style="width: 18%; text-align: right;">単価</th>';
                    html += '<th style="width: 25%; text-align: right;">金額</th>';
                    html += '</tr>';
                    html += '</thead>';
                    html += '<tbody>';
                    
                    items.forEach(item => {
                        html += '<tr>';
                        html += '<td>';
                        html += item.item_description || '';
                        if (item.note) {
                            html += '<div class="item-note">' + item.note + '</div>';
                        }
                        html += '</td>';
                        html += '<td style="text-align: center;">' + (item.quantity || 0).toLocaleString() + '</td>';
                        html += '<td style="text-align: center;">' + (item.unit || '') + '</td>';
                        html += '<td style="text-align: right;">¥' + (item.unit_price || 0).toLocaleString() + '</td>';
                        html += '<td style="text-align: right;">¥' + (item.amount || 0).toLocaleString() + '</td>';
                        html += '</tr>';
                    });
                    
                    // 小計・税・合計
                    html += '<tr>';
                    html += '<td colspan="4" style="text-align: right; font-weight: 600;">小計</td>';
                    html += '<td style="text-align: right; font-weight: 600;">¥' + (invoice.subtotal || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    html += '<tr>';
                    html += '<td colspan="4" style="text-align: right; font-weight: 600;">消費税 (' + (invoice.tax_rate || 10) + '%)</td>';
                    html += '<td style="text-align: right; font-weight: 600;">¥' + (invoice.tax || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    html += '<tr class="summary-row">';
                    html += '<td colspan="4" style="text-align: right;">合計金額</td>';
                    html += '<td style="text-align: right;">¥' + (invoice.total || 0).toLocaleString() + '</td>';
                    html += '</tr>';
                    
                    html += '</tbody>';
                    html += '</table>';
                    
                    // 振込先情報
                    if (companyInfo.bank_name) {
                        html += '<div class="bank-info">';
                        html += '<div class="bank-title">お振込先</div>';
                        html += '<div class="bank-details">';
                        html += '銀行名: ' + (companyInfo.bank_name || '') + '<br>';
                        if (companyInfo.bank_branch) {
                            html += '支店名: ' + companyInfo.bank_branch + '<br>';
                        }
                        if (companyInfo.account_type) {
                            html += '口座種別: ' + companyInfo.account_type + '<br>';
                        }
                        if (companyInfo.account_number) {
                            html += '口座番号: ' + companyInfo.account_number + '<br>';
                        }
                        if (companyInfo.account_holder) {
                            html += '口座名義: ' + companyInfo.account_holder;
                        }
                        html += '</div>';
                        html += '</div>';
                    }
                    
                    // 備考
                    if (invoice.notes) {
                        html += '<div class="notes-section">';
                        html += '<div class="notes-title">備考</div>';
                        html += '<div class="notes-text">' + invoice.notes + '</div>';
                        html += '</div>';
                    }
                    
                    pdfContent.innerHTML = html;
                    pdfContent.style.position = 'static';
                    pdfContent.style.left = '0';
                    
                    // html2canvasでキャンバス生成
                    const canvas = await html2canvas(pdfContent, {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                        windowWidth: 794
                    });
                    
                    // jsPDFでPDF生成
                    const { jsPDF } = window.jspdf;
                    const imgData = canvas.toDataURL('image/png');
                    const pdf = new jsPDF({
                        orientation: 'portrait',
                        unit: 'mm',
                        format: 'a4'
                    });
                    
                    const imgWidth = 210;
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;
                    
                    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
                    
                    // PDFダウンロード
                    const fileName = '請求書_' + (invoice.invoice_number || 'unknown') + '_' + new Date().toISOString().split('T')[0] + '.pdf';
                    pdf.save(fileName);
                    
                    // 3秒後にウィンドウを閉じる
                    setTimeout(() => {
                        window.close();
                    }, 3000);
                    
                } catch (error) {
                    console.error('PDF生成エラー:', error);
                    alert('PDF生成に失敗しました: ' + error.message);
                    window.close();
                }
            }
            
            // ページロード後にPDF生成
            window.addEventListener('load', generateInvoicePDF);
        </script>
    </body>
    </html>
  `)
})

// 入金一覧画面
app.get('/payments', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>入金一覧 - SFA</title>
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
                        <i class="fas fa-money-bill-wave mr-2"></i>入金一覧
                    </h1>
                    <p class="mt-2 text-sm text-gray-600">
                        リード（会社）単位で月毎の入金総額を表示します
                    </p>
                </div>

                <!-- 入金一覧テーブル -->
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

          // 入金一覧を読み込む
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
              console.error('入金一覧の読み込みに失敗しました:', error);
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

// 契約一覧画面
app.get('/contracts', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'created_at'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['contract_name', 'project_name', 'company_name', 'monthly_count', 'inspected_count', 'total_amount', 'created_at']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
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
                <th data-sort="inspected_count" onclick="sortTable('inspected_count')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
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


// 月次明細一覧画面
app.get('/monthly-details', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'target_month'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['target_month', 'amount', 'amount_with_tax', 'contract_name', 'project_name', 'company_name', 'inspection_status', 'billing_status', 'payment_status']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'target_month'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // 全ての月次明細を取得（契約情報と案件情報を含む）
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount,
      md.amount_with_tax,
      md.inspection_status,
      md.billing_status,
      md.payment_status,
      c.contract_name,
      c.contract_start_date,
      c.contract_end_date,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY ${sortColumn} ${order}, md.id DESC
  `).all()
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>月次明細一覧 - SFA</title>
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
              } catch (error) {}
              localStorage.removeItem('jwt_token');
            }
            window.location.href = '/login';
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
          
          window.location.href = '/monthly-details?sortBy=' + column + '&sortOrder=' + newOrder;
        }

        document.addEventListener('DOMContentLoaded', async function() {
          if (!AUTH_UTILS.checkAuth()) return;
          
          const user = await AUTH_UTILS.getCurrentUser();
          if (user) {
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = user.name || user.email;
            if (user.role === 'admin') {
              const adminMenu = document.getElementById('admin-menu');
              if (adminMenu) adminMenu.style.display = 'inline-block';
              const adminCsvButtons = document.getElementById('admin-csv-buttons');
              if (adminCsvButtons) adminCsvButtons.style.display = 'flex';
            }
          }

          // CSVファイル読み込みイベント
          const csvFileInput = document.getElementById('csv-file');
          if (csvFileInput) {
            csvFileInput.addEventListener('change', function(event) {
              const file = event.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = function(e) {
                const csv = e.target.result;
                const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
                
                if (lines.length < 2) {
                  alert('CSVファイルが空です');
                  document.getElementById('import-button').disabled = true;
                  return;
                }

                // プレビュー表示（最初の6行）
                const previewLines = lines.slice(0, 6);
                let previewHTML = '<table class="min-w-full text-xs"><tbody>';
                previewLines.forEach((line, index) => {
                  if (index === 0) {
                    previewHTML += '<tr class="bg-gray-100 font-bold"><td class="px-2 py-1" colspan="100">ヘッダー: ' + line + '</td></tr>';
                  } else {
                    previewHTML += '<tr><td class="px-2 py-1">' + line + '</td></tr>';
                  }
                });
                previewHTML += '</tbody></table>';
                previewHTML += '<p class="mt-2 text-sm text-gray-600">総件数: ' + (lines.length - 1) + '件</p>';
                
                document.getElementById('import-preview').innerHTML = previewHTML;
                document.getElementById('import-button').disabled = false;
              };
              reader.readAsText(file);
            });
          }

          // 入金CSVファイル読み込みイベント
          const paymentCsvFileInput = document.getElementById('payment-csv-file');
          if (paymentCsvFileInput) {
            paymentCsvFileInput.addEventListener('change', function(event) {
              const file = event.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = function(e) {
                const csv = e.target.result;
                const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
                
                if (lines.length < 2) {
                  alert('CSVファイルが空です');
                  document.getElementById('payment-import-button').disabled = true;
                  return;
                }

                // プレビュー表示（最初の6行）
                const previewLines = lines.slice(0, 6);
                let previewHTML = '<table class="min-w-full text-xs"><tbody>';
                previewLines.forEach((line, index) => {
                  if (index === 0) {
                    previewHTML += '<tr class="bg-gray-100 font-bold"><td class="px-2 py-1" colspan="100">ヘッダー: ' + line + '</td></tr>';
                  } else {
                    previewHTML += '<tr><td class="px-2 py-1">' + line + '</td></tr>';
                  }
                });
                previewHTML += '</tbody></table>';
                previewHTML += '<p class="mt-2 text-sm text-gray-600">総件数: ' + (lines.length - 1) + '件</p>';
                
                document.getElementById('payment-import-preview').innerHTML = previewHTML;
                document.getElementById('payment-import-button').disabled = false;
              };
              reader.readAsText(file);
            });
          }
        });


        // 月次明細削除確認
        async function confirmDeleteMonthlyDetail(monthlyDetailId, targetMonth, contractName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/monthly-details/' + monthlyDetailId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ 月次明細: ' + targetMonth + ' - ' + contractName + '\\n';
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '\\n■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/monthly-details/' + monthlyDetailId, {
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

        // CSVエクスポート
        async function exportCSV() {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/monthly-details/export/csv', {
              headers: { 'Authorization': 'Bearer ' + token },
              responseType: 'blob'
            });
            
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'monthly_details.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
          } catch (error) {
            alert('エクスポートに失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // CSVインポートモーダル
        function openImportModal() {
          document.getElementById('import-modal').classList.remove('hidden');
        }

        function closeImportModal() {
          document.getElementById('import-modal').classList.add('hidden');
          document.getElementById('csv-file').value = '';
          document.getElementById('import-preview').innerHTML = '';
          document.getElementById('import-button').disabled = true;
        }

        // CSVインポート実行
        async function importMonthlyDetailsCSV() {
          const file = document.getElementById('csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('CSVファイルをインポートしますか？\\n既存の月次明細データが更新されます（新規追加はできません）。')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const monthly_details = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                id: parseInt(values[0]) || 0,
                target_month: values[1] || '',
                contract_name: values[2] || '',
                project_name: values[3] || '',
                company_name: values[4] || '',
                amount: parseInt(values[5]) || 0,
                inspection_status: values[6] || '未検収',
                inspection_date: values[7] || '',
                billing_status: values[8] || '未請求',
                billing_date: values[9] || '',
                invoice_number: values[10] || '',
                expected_payment_date: values[11] || '',
                assign_members: values[12] || ''
              };
            });

            try {
              const token = AUTH_UTILS.getToken();
              const response = await axios.post('/api/monthly-details/import/csv', 
                { monthly_details },
                { headers: { 'Authorization': 'Bearer ' + token } }
              );
              
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の月次明細を更新しました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (ID: ' + err.id + ')';
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

        // 入金CSVインポートモーダル
        function openPaymentImportModal() {
          document.getElementById('payment-import-modal').classList.remove('hidden');
        }

        function closePaymentImportModal() {
          document.getElementById('payment-import-modal').classList.add('hidden');
          document.getElementById('payment-csv-file').value = '';
          document.getElementById('payment-import-preview').innerHTML = '';
          document.getElementById('payment-import-button').disabled = true;
        }

        // 一括検収機能
        let selectedIds = new Set();

        function toggleAll(checked) {
          selectedIds.clear();
          document.querySelectorAll('.detail-checkbox').forEach(checkbox => {
            checkbox.checked = checked;
            if (checked) selectedIds.add(parseInt(checkbox.value));
          });
          updateBulkActions();
        }

        function toggleDetail(id, checked) {
          if (checked) {
            selectedIds.add(id);
          } else {
            selectedIds.delete(id);
          }
          updateBulkActions();
        }

        function updateBulkActions() {
          const bulkActions = document.getElementById('bulk-actions');
          const selectedCount = document.getElementById('selected-count');
          if (selectedIds.size > 0) {
            bulkActions.classList.remove('hidden');
            selectedCount.textContent = selectedIds.size;
          } else {
            bulkActions.classList.add('hidden');
          }
        }

        async function bulkInspect() {
          if (selectedIds.size === 0) {
            alert('検収する月次明細を選択してください');
            return;
          }

          if (!confirm(selectedIds.size + '件の月次明細を一括検収しますか？')) return;

          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.post('/api/monthly-details/bulk-inspect',
              { ids: Array.from(selectedIds), inspection_date: new Date().toISOString().split('T')[0] },
              { headers: { 'Authorization': 'Bearer ' + token } }
            );

            alert(response.data.message);
            if (response.data.success_count > 0) {
              location.reload();
            }
          } catch (error) {
            alert('一括検収に失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // 入金CSVインポート実行
        async function importPaymentHistoriesCSV() {
          const file = document.getElementById('payment-csv-file').files[0];
          if (!file) {
            alert('CSVファイルを選択してください');
            return;
          }

          if (!confirm('入金履歴をCSVからインポートしますか?\\n指定された月次明細に入金履歴が追加されます。')) return;

          const reader = new FileReader();
          reader.onload = async function(event) {
            const csv = event.target.result;
            const lines = csv.split(/\\r?\\n/).filter(line => line.trim());
            
            // ヘッダーをスキップ
            const dataLines = lines.slice(1);
            
            const payment_histories = dataLines.map(line => {
              const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              return {
                monthly_detail_id: parseInt(values[0]) || 0,
                payment_date: values[1] || '',
                payment_amount: parseInt(values[2]) || 0,
                note: values[3] || ''
              };
            });

            try {
              const token = AUTH_UTILS.getToken();
              const response = await axios.post('/api/payment-histories/import/csv', 
                { payment_histories },
                { headers: { 'Authorization': 'Bearer ' + token } }
              );
              
              const { success_count, error_count, errors } = response.data;
              
              let message = success_count + '件の入金履歴を登録しました';
              if (error_count > 0) {
                message += '\\n\\nエラー: ' + error_count + '件';
                errors.slice(0, 5).forEach(err => {
                  message += '\\n行' + err.line + ': ' + err.error + ' (月次明細ID: ' + err.monthly_detail_id + ')';
                });
              }
              
              alert(message);
              
              if (success_count > 0) {
                closePaymentImportModal();
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
      <nav class="bg-white shadow-lg">
        <div class="max-w-7xl mx-auto px-4">
          <div class="flex justify-between h-16">
            <div class="flex space-x-8">
              <div class="flex items-center space-x-4">
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

      <div class="max-w-7xl mx-auto py-8 px-4">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-3xl font-bold text-gray-800">
            <i class="fas fa-calendar-alt mr-2"></i>月次明細一覧
          </h1>
          <div id="admin-csv-buttons" class="flex space-x-2" style="display:none;">
            <button onclick="exportCSV()" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
              <i class="fas fa-download mr-2"></i>CSVエクスポート
            </button>
            <button onclick="openImportModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              <i class="fas fa-upload mr-2"></i>明細CSVインポート
            </button>
            <button onclick="openPaymentImportModal()" class="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
              <i class="fas fa-money-bill-wave mr-2"></i>入金CSVインポート
            </button>
          </div>
        </div>

        <!-- 一括操作バー -->
        <div id="bulk-actions" class="hidden bg-blue-50 border-l-4 border-blue-500 p-4 mb-4 rounded-lg">
          <div class="flex items-center justify-between">
            <span class="text-blue-800 font-semibold">
              <i class="fas fa-check-circle mr-2"></i><span id="selected-count">0</span>件選択中
            </span>
            <button onclick="bulkInspect()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              <i class="fas fa-clipboard-check mr-2"></i>一括検収
            </button>
          </div>
        </div>

        ${monthlyDetails.length > 0 ? `
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-center" style="width: 50px;">
                  <input type="checkbox" onchange="toggleAll(this.checked)" class="w-4 h-4 text-blue-600 rounded">
                </th>
                <th data-sort="target_month" onclick="sortTable('target_month')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  対象月 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="contract_name" onclick="sortTable('contract_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 200px;">
                  契約名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="project_name" onclick="sortTable('project_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 180px;">
                  案件名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="company_name" onclick="sortTable('company_name')" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 150px;">
                  会社名 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="amount" onclick="sortTable('amount')" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  金額（税抜） <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="amount_with_tax" onclick="sortTable('amount_with_tax')" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 120px;">
                  金額（税込） <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="inspection_status" onclick="sortTable('inspection_status')" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  検収 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="billing_status" onclick="sortTable('billing_status')" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  請求 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th data-sort="payment_status" onclick="sortTable('payment_status')" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 resize-x overflow-auto" style="min-width: 100px;">
                  入金 <i class="sort-icon fas fa-sort ml-1"></i>
                </th>
                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" style="min-width: 80px;">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${monthlyDetails.map(detail => `
                <tr class="hover:bg-blue-50 transition-colors">
                  <td class="px-6 py-4 whitespace-nowrap text-center" onclick="event.stopPropagation()">
                    <input type="checkbox" value="${detail.id}" onchange="toggleDetail(${detail.id}, this.checked)" class="detail-checkbox w-4 h-4 text-blue-600 rounded">
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.target_month}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.contract_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.project_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ${detail.company_name || '-'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ¥${detail.amount?.toLocaleString() || '0'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    ¥${detail.amount_with_tax?.toLocaleString() || '0'}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      detail.inspection_status === '検収済' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }">
                      ${detail.inspection_status || '未検収'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      detail.billing_status === '請求済' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                    }">
                      ${detail.billing_status || '未請求'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center cursor-pointer" onclick="window.location.href='/monthly/${detail.id}'">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      detail.payment_status === '入金済' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                    }">
                      ${detail.payment_status || '未入金'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <a href="/monthly/${detail.id}" class="text-blue-600 hover:text-blue-900" onclick="event.stopPropagation()">
                      <i class="fas fa-eye mr-1"></i>詳細
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>月次明細がまだありません</p>
        </div>
        `}
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
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: ID,対象月,契約名,案件名,会社名,金額,検収ステータス,検収日,請求ステータス,請求日,請求書番号,入金予定日,アサインメンバー(メール:単価:稼働率;で区切る)</p>
            <p class="text-sm text-red-600 mb-2">※既存データの更新のみ可能です（新規追加はできません）</p>
            <p class="text-sm text-gray-500 mb-2">例: 1,2026-01,Q1契約,開発案件,株式会社テスト,1000000,検収済,2026-01-31,請求済,2026-02-01,INV-001,2026-02-28,yamada@example.com:800000:0.8;sato@example.com:700000:1.0</p>
            <input type="file" id="csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closeImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="import-button" onclick="importMonthlyDetailsCSV()" disabled class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400">
              インポート実行
            </button>
          </div>
        </div>
      </div>

      <!-- 入金CSVインポートモーダル -->
      <div id="payment-import-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden">
        <div class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium">入金履歴CSVインポート</h3>
            <button onclick="closePaymentImportModal()" class="text-gray-400 hover:text-gray-600">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="mb-4">
            <p class="text-sm text-gray-600 mb-2">CSVフォーマット: 月次明細ID,入金日(YYYY-MM-DD),入金金額,備考</p>
            <p class="text-sm text-blue-600 mb-2">※月次明細IDは月次明細一覧画面で確認できます（CSVエクスポートで確認可能）</p>
            <p class="text-sm text-gray-500 mb-2">例: 1,2026-02-28,1000000,振込手数料込み</p>
            <input type="file" id="payment-csv-file" accept=".csv" class="w-full px-3 py-2 border border-gray-300 rounded">
          </div>
          
          <div id="payment-import-preview" class="mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex justify-end space-x-2">
            <button onclick="closePaymentImportModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
              キャンセル
            </button>
            <button id="payment-import-button" onclick="importPaymentHistoriesCSV()" disabled class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400">
              入金履歴インポート
            </button>
          </div>
        </div>
      </div>
    </body>
    </html>
  `)
})


// 月次明細CSVエクスポートAPI（管理者のみ）
app.get('/api/monthly-details/export/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env

  // 月次明細とアサインメンバーを取得
  const { results: monthlyDetails } = await DB.prepare(`
    SELECT 
      md.id,
      md.target_month,
      md.amount,
      md.inspection_status,
      md.inspection_date,
      md.billing_status,
      md.billing_date,
      md.invoice_number,
      md.expected_payment_date,
      c.contract_name,
      p.project_name,
      l.company_name
    FROM monthly_details md
    LEFT JOIN contracts c ON md.contract_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    ORDER BY md.target_month DESC, md.id DESC
  `).all()

  // 各月次明細のアサインメンバーを取得
  const csvRows = []
  for (const detail of monthlyDetails) {
    const { results: assignments } = await DB.prepare(`
      SELECT 
        m.email,
        mma.unit_price,
        mma.allocation_ratio
      FROM monthly_member_assignments mma
      LEFT JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
      ORDER BY m.email ASC
    `).bind(detail.id).all()

    // アサインメンバーを文字列に変換（メール:単価:稼働率;メール:単価:稼働率）
    const memberString = assignments.map(a => 
      `${a.email}:${a.unit_price}:${a.allocation_ratio}`
    ).join(';')

    csvRows.push({
      id: detail.id,
      target_month: detail.target_month,
      contract_name: detail.contract_name || '',
      project_name: detail.project_name || '',
      company_name: detail.company_name || '',
      amount: detail.amount,
      inspection_status: detail.inspection_status,
      inspection_date: detail.inspection_date || '',
      billing_status: detail.billing_status,
      billing_date: detail.billing_date || '',
      invoice_number: detail.invoice_number || '',
      expected_payment_date: detail.expected_payment_date || '',
      assign_members: memberString
    })
  }

  // CSVヘッダー
  const header = 'ID,対象月,契約名,案件名,会社名,金額,検収ステータス,検収日,請求ステータス,請求日,請求書番号,入金予定日,アサインメンバー(メール:単価:稼働率;で区切る)'
  
  // CSVボディ
  const body = csvRows.map(row => 
    [
      row.id,
      row.target_month,
      `"${row.contract_name}"`,
      `"${row.project_name}"`,
      `"${row.company_name}"`,
      row.amount,
      row.inspection_status,
      row.inspection_date,
      row.billing_status,
      row.billing_date,
      `"${row.invoice_number}"`,
      row.expected_payment_date,
      `"${row.assign_members}"`
    ].join(',')
  ).join('\n')

  const csv = header + '\n' + body

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="monthly_details.csv"'
    }
  })
})

// 月次明細CSVインポートAPI（管理者のみ、既存データの更新のみ）
app.post('/api/monthly-details/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const { monthly_details } = await c.req.json()

  if (!Array.isArray(monthly_details) || monthly_details.length === 0) {
    return c.json({ success: false, error: '月次明細データが必要です' }, 400)
  }

  let success_count = 0
  let error_count = 0
  const errors = []

  for (let i = 0; i < monthly_details.length; i++) {
    const detail = monthly_details[i]
    const { 
      id, 
      inspection_status, 
      inspection_date, 
      billing_status, 
      billing_date, 
      invoice_number, 
      expected_payment_date,
      assign_members 
    } = detail

    // IDが必須
    if (!id) {
      errors.push({ line: i + 2, id: '', error: 'IDは必須です' })
      error_count++
      continue
    }

    try {
      // 月次明細が存在するか確認
      const existing = await DB.prepare('SELECT id FROM monthly_details WHERE id = ?').bind(id).first()
      
      if (!existing) {
        errors.push({ line: i + 2, id: id, error: '該当する月次明細が見つかりません（新規追加はできません）' })
        error_count++
        continue
      }

      // 月次明細を更新
      await DB.prepare(`
        UPDATE monthly_details 
        SET 
          inspection_status = ?,
          inspection_date = ?,
          billing_status = ?,
          billing_date = ?,
          invoice_number = ?,
          expected_payment_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        inspection_status || '未検収',
        inspection_date || null,
        billing_status || '未請求',
        billing_date || null,
        invoice_number || null,
        expected_payment_date || null,
        id
      ).run()

      // アサインメンバーの更新
      if (assign_members) {
        // 既存のアサインメンバーを削除
        await DB.prepare('DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?').bind(id).run()

        // 新しいアサインメンバーを追加
        const memberList = assign_members.split(';').map((m: string) => m.trim()).filter((m: string) => m)
        for (const memberStr of memberList) {
          const parts = memberStr.split(':').map((p: string) => p.trim())
          const email = parts[0]
          const unit_price = parts[1] ? parseInt(parts[1]) : 0
          const allocation_ratio = parts[2] ? parseFloat(parts[2]) : 1.0

          // メンバーIDを取得
          const member = await DB.prepare('SELECT id FROM members WHERE email = ?').bind(email).first()
          
          if (member) {
            await DB.prepare(`
              INSERT INTO monthly_member_assignments (monthly_detail_id, member_id, unit_price, allocation_ratio)
              VALUES (?, ?, ?, ?)
            `).bind(id, member.id, unit_price, allocation_ratio).run()
          }
        }
      }

      success_count++
    } catch (error) {
      errors.push({ line: i + 2, id: id, error: error.message || '不明なエラー' })
      error_count++
    }
  }

  return c.json({
    success: true,
    total: monthly_details.length,
    success_count,
    error_count,
    errors
  })
})

// ========================================
// データ削除API（管理者のみ）
// ========================================

// リード削除API（関連する案件、契約、明細も含む）
app.delete('/api/leads/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const leadId = parseInt(c.req.param('id'));

  if (!leadId) {
    return c.json({ success: false, error: 'リードIDが必要です' }, 400);
  }

  try {
    console.log(`[DELETE] Starting lead deletion for leadId=${leadId}`);
    let deletedProjects = 0;
    let deletedContracts = 0;
    let deletedMonthlyDetails = 0;
    let deletedMemberAssignments = 0;

    // まず、削除対象のIDをすべて収集
    const projects = await DB.prepare(`
      SELECT id FROM projects WHERE lead_id = ?
    `).bind(leadId).all();
    console.log(`[DELETE] Found ${projects.results.length} projects`);

    const allStatements = [];
    const statementDescriptions = [];
    
    if (projects.results.length > 0) {
      deletedProjects = projects.results.length;
      
      for (const project of projects.results) {
        const contracts = await DB.prepare(`
          SELECT id FROM contracts WHERE project_id = ?
        `).bind(project.id).all();
        
        if (contracts.results.length > 0) {
          deletedContracts += contracts.results.length;
          
          for (const contract of contracts.results) {
            const monthlyDetails = await DB.prepare(`
              SELECT id FROM monthly_details WHERE contract_id = ?
            `).bind(contract.id).all();

            if (monthlyDetails.results.length > 0) {
              deletedMonthlyDetails += monthlyDetails.results.length;
              
              // 月次メンバーアサインの削除文を追加
              for (const monthly of monthlyDetails.results) {
                const monthlyMembers = await DB.prepare(`
                  SELECT COUNT(*) as count FROM monthly_member_assignments 
                  WHERE monthly_detail_id = ?
                `).bind(monthly.id).first();
                deletedMemberAssignments += monthlyMembers.count;
                
                allStatements.push(
                  DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE monthly_member_assignments for monthly_detail_id=${monthly.id}`);
              }
              
              // 入金履歴の削除文を追加
              for (const monthly of monthlyDetails.results) {
                allStatements.push(
                  DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE payment_histories for monthly_detail_id=${monthly.id}`);
              }
              
              // 月次明細の削除文を追加
              for (const monthly of monthlyDetails.results) {
                allStatements.push(
                  DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthly.id)
                );
                statementDescriptions.push(`DELETE monthly_details id=${monthly.id}`);
              }
            }

            // 契約メンバーアサインのカウント
            const contractMembers = await DB.prepare(`
              SELECT COUNT(*) as count FROM contract_member_assignments 
              WHERE contract_id = ?
            `).bind(contract.id).first();
            deletedMemberAssignments += contractMembers.count;
            
            // 契約メンバーアサインの削除文を追加
            allStatements.push(
              DB.prepare(`DELETE FROM contract_member_assignments WHERE contract_id = ?`).bind(contract.id)
            );
            statementDescriptions.push(`DELETE contract_member_assignments for contract_id=${contract.id}`);
            
            // 契約の削除文を追加
            allStatements.push(
              DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contract.id)
            );
            statementDescriptions.push(`DELETE contracts id=${contract.id}`);
          }
        }

        // 案件の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(project.id)
        );
        statementDescriptions.push(`DELETE projects id=${project.id}`);
      }
    }

    // リードの削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM leads WHERE id = ?`).bind(leadId)
    );
    statementDescriptions.push(`DELETE leads id=${leadId}`);

    console.log(`[DELETE] Executing ${allStatements.length} delete statements`);
    
    // 個別に削除を実行（順序を保証）
    for (let i = 0; i < allStatements.length; i++) {
      try {
        console.log(`[DELETE] Executing ${i+1}/${allStatements.length}: ${statementDescriptions[i]}`);
        await allStatements[i].run();
        console.log(`[DELETE] Statement ${i+1}/${allStatements.length} executed successfully`);
      } catch (err) {
        console.error(`[DELETE] Statement ${i+1}/${allStatements.length} (${statementDescriptions[i]}) failed:`, err);
        throw err;
      }
    }

    return c.json({
      success: true,
      deleted: {
        leads: 1,
        projects: deletedProjects,
        contracts: deletedContracts,
        monthly_details: deletedMonthlyDetails,
        member_assignments: deletedMemberAssignments
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 案件削除API（関連する契約、明細も含む）
app.delete('/api/projects/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const projectId = parseInt(c.req.param('id'));

  if (!projectId) {
    return c.json({ success: false, error: '案件IDが必要です' }, 400);
  }

  try {
    let deletedContracts = 0;
    let deletedMonthlyDetails = 0;
    let deletedMemberAssignments = 0;

    const allStatements = [];

    // 契約を取得
    const contracts = await DB.prepare(`
      SELECT id FROM contracts WHERE project_id = ?
    `).bind(projectId).all();

    if (contracts.results.length > 0) {
      deletedContracts = contracts.results.length;
      
      // 各契約について処理
      for (const contract of contracts.results) {
        const monthlyDetails = await DB.prepare(`
          SELECT id FROM monthly_details WHERE contract_id = ?
        `).bind(contract.id).all();

        if (monthlyDetails.results.length > 0) {
          deletedMonthlyDetails += monthlyDetails.results.length;
          
          // 各月次明細について処理
          for (const monthly of monthlyDetails.results) {
            // 月次メンバーアサインのカウント
            const monthlyMembers = await DB.prepare(`
              SELECT COUNT(*) as count FROM monthly_member_assignments 
              WHERE monthly_detail_id = ?
            `).bind(monthly.id).first();
            deletedMemberAssignments += monthlyMembers.count;
            
            // 月次メンバーアサインの削除文を追加
            allStatements.push(
              DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
            );
          }
          
          // 月次明細の削除文を追加
          for (const monthly of monthlyDetails.results) {
            allStatements.push(
              DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthly.id)
            );
          }
        }

        // 契約メンバーアサインのカウント
        const contractMembers = await DB.prepare(`
          SELECT COUNT(*) as count FROM contract_member_assignments 
          WHERE contract_id = ?
        `).bind(contract.id).first();
        deletedMemberAssignments += contractMembers.count;
        
        // 契約メンバーアサインの削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM contract_member_assignments WHERE contract_id = ?`).bind(contract.id)
        );
        
        // 契約の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contract.id)
        );
      }
    }

    // 案件の削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId)
    );

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      ...allStatements,
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        projects: 1,
        contracts: deletedContracts,
        monthly_details: deletedMonthlyDetails,
        member_assignments: deletedMemberAssignments
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 契約削除API（関連する明細も含む）
app.delete('/api/contracts/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const contractId = parseInt(c.req.param('id'));

  if (!contractId) {
    return c.json({ success: false, error: '契約IDが必要です' }, 400);
  }

  try {
    let deletedMonthlyDetails = 0;
    let deletedContractMembers = 0;
    let deletedMonthlyMembers = 0;

    const allStatements = [];

    // 月次明細を取得
    const monthlyDetails = await DB.prepare(`
      SELECT id FROM monthly_details WHERE contract_id = ?
    `).bind(contractId).all();

    if (monthlyDetails.results.length > 0) {
      deletedMonthlyDetails = monthlyDetails.results.length;
      
      // 各月次明細について処理
      for (const monthly of monthlyDetails.results) {
        // 月次メンバーアサインのカウント
        const monthlyMembers = await DB.prepare(`
          SELECT COUNT(*) as count FROM monthly_member_assignments 
          WHERE monthly_detail_id = ?
        `).bind(monthly.id).first();
        deletedMonthlyMembers += monthlyMembers.count;
        
        // 月次メンバーアサインの削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthly.id)
        );
        
        // 入金履歴の削除文を追加
        allStatements.push(
          DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthly.id)
        );
      }
      
      // 月次明細の削除文を追加
      for (const monthly of monthlyDetails.results) {
        allStatements.push(
          DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthly.id)
        );
      }
    }

    // 契約メンバーアサインのカウント
    const contractMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id = ?
    `).bind(contractId).first();
    deletedContractMembers = contractMembers.count;
    
    // 契約メンバーアサインの削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM contract_member_assignments WHERE contract_id = ?`).bind(contractId)
    );

    // 契約の削除文を追加
    allStatements.push(
      DB.prepare(`DELETE FROM contracts WHERE id = ?`).bind(contractId)
    );

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      ...allStatements,
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        contracts: 1,
        monthly_details: deletedMonthlyDetails,
        contract_member_assignments: deletedContractMembers,
        monthly_member_assignments: deletedMonthlyMembers
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 月次明細削除の影響確認API
app.get('/api/monthly-details/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  if (!monthlyDetailId) {
    return c.json({ success: false, error: '月次明細IDが必要です' }, 400);
  }

  try {
    // 月次明細情報を取得
    const monthlyDetail = await DB.prepare(`
      SELECT 
        md.*,
        c.contract_name,
        p.project_name,
        l.company_name
      FROM monthly_details md
      LEFT JOIN contracts c ON md.contract_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN leads l ON p.lead_id = l.id
      WHERE md.id = ?
    `).bind(monthlyDetailId).first();

    if (!monthlyDetail) {
      return c.json({ success: false, error: '月次明細が見つかりません' }, 404);
    }

    // 関連するメンバーアサインを取得
    const { results: memberAssignments } = await DB.prepare(`
      SELECT 
        mma.id,
        m.name as member_name,
        mma.unit_price,
        mma.allocation_ratio
      FROM monthly_member_assignments mma
      LEFT JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
    `).bind(monthlyDetailId).all();

    // 関連する入金履歴を取得
    const { results: paymentHistories } = await DB.prepare(`
      SELECT 
        id,
        payment_date,
        payment_amount,
        note
      FROM payment_histories
      WHERE monthly_detail_id = ?
      ORDER BY payment_date DESC
    `).bind(monthlyDetailId).all();

    // 関連する変更履歴を取得
    const { results: changeHistories } = await DB.prepare(`
      SELECT COUNT(*) as count
      FROM status_change_histories
      WHERE table_name = 'monthly_details' AND record_id = ?
    `).bind(monthlyDetailId).all();

    return c.json({
      success: true,
      impact: {
        monthly_detail: monthlyDetail,
        member_assignments: memberAssignments,
        member_assignments_count: memberAssignments.length,
        payment_histories: paymentHistories,
        payment_histories_count: paymentHistories.length,
        change_histories_count: changeHistories[0]?.count || 0
      }
    });

  } catch (error) {
    console.error('Get delete impact error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 月次明細削除API（関連するメンバーアサインも含む）
app.delete('/api/monthly-details/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  if (!monthlyDetailId) {
    return c.json({ success: false, error: '月次明細IDが必要です' }, 400);
  }

  try {
    // 関連データの確認
    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    const paymentHistories = await DB.prepare(`
      SELECT COUNT(*) as count FROM payment_histories WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    const changeHistories = await DB.prepare(`
      SELECT COUNT(*) as count FROM status_change_histories 
      WHERE table_name = 'monthly_details' AND record_id = ?
    `).bind(monthlyDetailId).first();

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      DB.prepare(`DELETE FROM monthly_member_assignments WHERE monthly_detail_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM payment_histories WHERE monthly_detail_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM status_change_histories WHERE table_name = 'monthly_details' AND record_id = ?`).bind(monthlyDetailId),
      DB.prepare(`DELETE FROM monthly_details WHERE id = ?`).bind(monthlyDetailId),
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        monthly_details: 1,
        monthly_member_assignments: monthlyMembers.count,
        payment_histories: paymentHistories.count,
        change_histories: changeHistories.count
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// メンバー削除API（関連するアサインも含む）
app.delete('/api/members/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const memberId = parseInt(c.req.param('id'));

  if (!memberId) {
    return c.json({ success: false, error: 'メンバーIDが必要です' }, 400);
  }

  try {
    // 関連データの確認
    const contractAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    const monthlyAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    // バッチで全削除を実行（外部キー制約を一時的に無効化）
    const batchStatements = [
      DB.prepare('PRAGMA foreign_keys = OFF'),
      DB.prepare(`DELETE FROM contract_member_assignments WHERE member_id = ?`).bind(memberId),
      DB.prepare(`DELETE FROM monthly_member_assignments WHERE member_id = ?`).bind(memberId),
      DB.prepare(`UPDATE projects SET sales_rep_id = NULL WHERE sales_rep_id = ?`).bind(memberId),
      DB.prepare(`DELETE FROM members WHERE id = ?`).bind(memberId),
      DB.prepare('PRAGMA foreign_keys = ON')
    ];
    
    await DB.batch(batchStatements);

    return c.json({
      success: true,
      deleted: {
        members: 1,
        contract_member_assignments: contractAssignments.count,
        monthly_member_assignments: monthlyAssignments.count
      }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 削除前の影響確認API
app.get('/api/leads/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const leadId = parseInt(c.req.param('id'));

  try {
    const projects = await DB.prepare(`
      SELECT id, project_name FROM projects WHERE lead_id = ?
    `).bind(leadId).all();

    const projectIds = projects.results.map(p => p.id);
    let contracts = { results: [] };
    let monthlyDetailsCount = 0;
    let memberAssignmentsCount = 0;

    if (projectIds.length > 0) {
      contracts = await DB.prepare(`
        SELECT id, contract_name FROM contracts WHERE project_id IN (${projectIds.join(',')})
      `).all();

      const contractIds = contracts.results.map(c => c.id);
      
      if (contractIds.length > 0) {
        const monthlyDetails = await DB.prepare(`
          SELECT COUNT(*) as count FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
        `).first();
        monthlyDetailsCount = monthlyDetails.count;

        const allAssignments = await DB.prepare(`
          SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id IN (${contractIds.join(',')})
        `).first();
        memberAssignmentsCount = allAssignments.count;

        const monthlyAssignments = await DB.prepare(`
          SELECT COUNT(*) as count FROM monthly_member_assignments 
          WHERE monthly_detail_id IN (
            SELECT id FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
          )
        `).first();
        memberAssignmentsCount += monthlyAssignments.count;
      }
    }

    return c.json({
      success: true,
      impact: {
        projects: projects.results,
        contracts: contracts.results,
        monthly_details_count: monthlyDetailsCount,
        member_assignments_count: memberAssignmentsCount
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/api/projects/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const projectId = parseInt(c.req.param('id'));

  try {
    const contracts = await DB.prepare(`
      SELECT id, contract_name FROM contracts WHERE project_id = ?
    `).bind(projectId).all();

    const contractIds = contracts.results.map(c => c.id);
    let monthlyDetailsCount = 0;
    let memberAssignmentsCount = 0;

    if (contractIds.length > 0) {
      const monthlyDetails = await DB.prepare(`
        SELECT COUNT(*) as count FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
      `).first();
      monthlyDetailsCount = monthlyDetails.count;

      const allAssignments = await DB.prepare(`
        SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id IN (${contractIds.join(',')})
      `).first();
      memberAssignmentsCount = allAssignments.count;

      const monthlyAssignments = await DB.prepare(`
        SELECT COUNT(*) as count FROM monthly_member_assignments 
        WHERE monthly_detail_id IN (
          SELECT id FROM monthly_details WHERE contract_id IN (${contractIds.join(',')})
        )
      `).first();
      memberAssignmentsCount += monthlyAssignments.count;
    }

    return c.json({
      success: true,
      impact: {
        contracts: contracts.results,
        monthly_details_count: monthlyDetailsCount,
        member_assignments_count: memberAssignmentsCount
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/api/contracts/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const contractId = parseInt(c.req.param('id'));

  try {
    const monthlyDetails = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_details WHERE contract_id = ?
    `).bind(contractId).first();

    const contractMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE contract_id = ?
    `).bind(contractId).first();

    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments 
      WHERE monthly_detail_id IN (
        SELECT id FROM monthly_details WHERE contract_id = ?
      )
    `).bind(contractId).first();

    return c.json({
      success: true,
      impact: {
        monthly_details_count: monthlyDetails.count,
        contract_member_assignments_count: contractMembers.count,
        monthly_member_assignments_count: monthlyMembers.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/api/monthly-details/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const monthlyDetailId = parseInt(c.req.param('id'));

  try {
    const monthlyMembers = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE monthly_detail_id = ?
    `).bind(monthlyDetailId).first();

    return c.json({
      success: true,
      impact: {
        monthly_member_assignments_count: monthlyMembers.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/api/members/:id/delete-impact', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env;
  const memberId = parseInt(c.req.param('id'));

  try {
    const contractAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM contract_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    const monthlyAssignments = await DB.prepare(`
      SELECT COUNT(*) as count FROM monthly_member_assignments WHERE member_id = ?
    `).bind(memberId).first();

    return c.json({
      success: true,
      impact: {
        contract_member_assignments_count: contractAssignments.count,
        monthly_member_assignments_count: monthlyAssignments.count
      }
    });

  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

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
            // CSVインポート・エクスポートボタンを管理者のみ表示
            const csvImportButton = document.getElementById('csv-import-button');
            if (csvImportButton && user.role === 'admin') {
              csvImportButton.style.display = '';
            }
            const csvExportButton = document.getElementById('csv-export-button');
            if (csvExportButton && user.role === 'admin') {
              csvExportButton.style.display = '';
            }
            const syncUsersButton = document.getElementById('sync-users-button');
            if (syncUsersButton && user.role === 'admin') {
              syncUsersButton.style.display = '';
            }
            // 削除ボタンを管理者のみ表示
            if (user.role === 'admin') {
              const deleteButtons = document.querySelectorAll('.admin-only-column');
              deleteButtons.forEach(btn => btn.style.display = '');
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
                <a href="/projects" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-briefcase mr-2"></i>案件
                </a>
                <a href="/contracts" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-file-contract mr-2"></i>契約
                </a>
                <a href="/details" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-list-alt mr-2"></i>詳細一覧
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
            <i class="fas fa-user-friends mr-2"></i>メンバー管理
          </h1>
          <div class="flex space-x-3">
            <button onclick="syncMembersToUsers()" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700" id="sync-users-button" style="display: none;">
              <i class="fas fa-sync mr-2"></i>ユーザー管理に同期
            </button>
            <button onclick="exportCsv()" class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700" id="csv-export-button" style="display: none;">
              <i class="fas fa-download mr-2"></i>CSVエクスポート
            </button>
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
          <div class="overflow-x-scroll" style="overflow-x: scroll;">
          <table id="members-table" class="min-w-full divide-y divide-gray-200" style="table-layout: auto;">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative resize-col" 
                    onclick="sortTable('name')" style="min-width: 150px;">
                  <div class="flex items-center">
                    名前 
                    <i class="fas fa-sort ml-2 text-gray-400" id="sort-icon-name"></i>
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative resize-col" 
                    onclick="sortTable('position')" style="min-width: 120px;">
                  <div class="flex items-center">
                    役職 
                    <i class="fas fa-sort ml-2 text-gray-400" id="sort-icon-position"></i>
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative resize-col" 
                    onclick="sortTable('email')" style="min-width: 200px;">
                  <div class="flex items-center">
                    メール 
                    <i class="fas fa-sort ml-2 text-gray-400" id="sort-icon-email"></i>
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative resize-col" 
                    onclick="sortTable('default_unit_price')" style="min-width: 150px;">
                  <div class="flex items-center">
                    デフォルト単価 
                    <i class="fas fa-sort ml-2 text-gray-400" id="sort-icon-default_unit_price"></i>
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider relative resize-col" style="min-width: 200px;">
                  <div class="flex items-center">
                    メモ
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative resize-col" 
                    onclick="sortTable('status')" style="min-width: 120px;">
                  <div class="flex items-center">
                    ステータス 
                    <i class="fas fa-sort ml-2 text-gray-400" id="sort-icon-status"></i>
                  </div>
                  <div class="resize-handle"></div>
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="min-width: 150px;">
                  操作
                </th>
              </tr>
            </thead>
            <tbody id="members-tbody" class="bg-white divide-y divide-gray-200">
              ${members.map((member: any) => `
                <tr class="hover:bg-gray-50" data-name="${member.name}" data-position="${member.position || ''}" data-email="${member.email || ''}" data-default_unit_price="${member.default_unit_price || 0}" data-status="${member.status}">
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
                  <td class="px-6 py-4 text-sm text-gray-500" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;" title="${member.memo || ''}">
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
                    <button onclick="confirmDeleteMember(${member.id}, '${member.name.replace(/'/g, "\\'")}');" 
                            class="text-red-600 hover:text-red-800 admin-only-column" style="display: none;">
                      <i class="fas fa-trash mr-1"></i>削除
                    </button>
                    </button>
                    <button onclick="toggleMemberStatus(${member.id}, '${member.status}')" 
                            class="text-${member.status === 'active' ? 'red' : 'green'}-600 hover:text-${member.status === 'active' ? 'red' : 'green'}-800 mr-3">
                      <i class="fas fa-${member.status === 'active' ? 'ban' : 'check'} mr-1"></i>${member.status === 'active' ? '無効化' : '有効化'}
                    </button>
                    ${member.status === 'inactive' ? `
                    <button onclick="deleteMember(${member.id}, '${member.name}')" 
                            class="text-red-600 hover:text-red-800">
                      <i class="fas fa-trash mr-1"></i>削除
                    </button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <style>
        /* リサイズハンドルのスタイル */
        .resize-col {
          position: relative;
        }
        .resize-handle {
          position: absolute;
          top: 0;
          right: 0;
          width: 5px;
          height: 100%;
          cursor: col-resize;
          user-select: none;
        }
        .resize-handle:hover {
          background-color: rgba(59, 130, 246, 0.5);
        }
        /* 常にスクロールバーを表示 */
        .overflow-x-scroll::-webkit-scrollbar {
          height: 12px;
        }
        .overflow-x-scroll::-webkit-scrollbar-track {
          background: #f1f1f1;
        }
        .overflow-x-scroll::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 6px;
        }
        .overflow-x-scroll::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      </style>

      <script>
        // ソート機能
        let currentSortColumn = '';
        let currentSortDirection = 'asc';

        function sortTable(column) {
          const tbody = document.getElementById('members-tbody');
          const rows = Array.from(tbody.querySelectorAll('tr'));
          
          // ソート方向を決定
          if (currentSortColumn === column) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortColumn = column;
            currentSortDirection = 'asc';
          }
          
          // アイコンをリセット
          document.querySelectorAll('[id^="sort-icon-"]').forEach(icon => {
            icon.className = 'fas fa-sort ml-2 text-gray-400';
          });
          
          // 現在のソートアイコンを更新
          const icon = document.getElementById('sort-icon-' + column);
          if (icon) {
            icon.className = 'fas fa-sort-' + (currentSortDirection === 'asc' ? 'up' : 'down') + ' ml-2 text-blue-600';
          }
          
          // ソート実行
          rows.sort((a, b) => {
            let aVal = a.getAttribute('data-' + column) || '';
            let bVal = b.getAttribute('data-' + column) || '';
            
            // 数値の場合
            if (column === 'default_unit_price') {
              aVal = parseFloat(aVal) || 0;
              bVal = parseFloat(bVal) || 0;
              return currentSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }
            
            // 文字列の場合
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
            
            if (currentSortDirection === 'asc') {
              return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            } else {
              return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            }
          });
          
          // テーブルを更新
          rows.forEach(row => tbody.appendChild(row));
        }
        
        // 列幅リサイズ機能
        document.addEventListener('DOMContentLoaded', function() {
          const table = document.getElementById('members-table');
          if (!table) return;
          
          const cols = table.querySelectorAll('.resize-col');
          
          cols.forEach(col => {
            const handle = col.querySelector('.resize-handle');
            if (!handle) return;
            
            let startX, startWidth;
            
            handle.addEventListener('mousedown', function(e) {
              e.preventDefault();
              e.stopPropagation();
              startX = e.pageX;
              startWidth = col.offsetWidth;
              
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            });
            
            function handleMouseMove(e) {
              const diff = e.pageX - startX;
              const newWidth = Math.max(50, startWidth + diff);
              col.style.width = newWidth + 'px';
              col.style.minWidth = newWidth + 'px';
            }
            
            function handleMouseUp() {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            }
          });
        });
      </script>

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


        // 既存メンバーをユーザー管理に同期
        async function syncMembersToUsers() {
          if (!confirm('既存メンバーをユーザー管理に同期します。\\n\\nメールアドレスを持つメンバーで、まだユーザーが作成されていない場合のみ追加されます。\\n\\nよろしいですか？')) {
            return;
          }

          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.post('/api/members/sync-users', {}, {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            if (response.data.success) {
              const { synced_count, skipped_count, errors } = response.data;
              let message = '同期が完了しました！\\n\\n';
              message += '✅ ユーザー作成: ' + synced_count + '件\\n';
              message += '⏭️  スキップ: ' + skipped_count + '件\\n';
              
              if (errors && errors.length > 0) {
                message += '\\n⚠️ エラー: ' + errors.length + '件\\n';
                errors.forEach(err => {
                  message += '  - ' + err.member_name + ': ' + err.error + '\\n';
                });
              }
              
              alert(message);
            }
          } catch (error) {
            console.error('Sync error:', error);
            alert('同期に失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // メンバー削除確認
        async function confirmDeleteMember(memberId, memberName) {
          try {
            const token = AUTH_UTILS.getToken();
            const response = await axios.get('/api/members/' + memberId + '/delete-impact', {
              headers: { 'Authorization': 'Bearer ' + token }
            });

            const impact = response.data.impact;
            
            let message = '以下のデータを完全に削除します：\\n\\n';
            message += '■ メンバー: ' + memberName + '\\n';
            
            if (impact.contract_member_assignments_count > 0) {
              message += '\\n■ 契約メンバーアサイン: ' + impact.contract_member_assignments_count + '件\\n';
            }
            
            if (impact.monthly_member_assignments_count > 0) {
              message += '■ 月次メンバーアサイン: ' + impact.monthly_member_assignments_count + '件\\n';
            }
            
            message += '\\nこの操作は取り消せません。本当に削除しますか？';
            
            if (!confirm(message)) return;
            
            const deleteResponse = await axios.delete('/api/members/' + memberId, {
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

        // CSVエクスポート機能
        function exportCsv() {
          const tbody = document.getElementById('members-tbody');
          const rows = Array.from(tbody.querySelectorAll('tr'));
          
          // CSVヘッダー
          const headers = ['名前', '役職', '単価', 'メールアドレス', 'メモ', 'ステータス'];
          const csvContent = [headers.join(',')];
          
          // データ行
          rows.forEach(row => {
            const name = row.getAttribute('data-name') || '';
            const position = row.getAttribute('data-position') || '';
            const unitPrice = row.getAttribute('data-default_unit_price') || '';
            const email = row.getAttribute('data-email') || '';
            const status = row.getAttribute('data-status') || '';
            
            // メモは表示されているテキストから取得
            const memoCell = row.cells[4];
            const memo = memoCell ? memoCell.getAttribute('title') || memoCell.textContent.trim() : '';
            
            // CSVフォーマット（カンマやダブルクォートをエスケープ）
            const rowData = [
              escapeCsvField(name),
              escapeCsvField(position),
              unitPrice,
              escapeCsvField(email),
              escapeCsvField(memo),
              status === 'active' ? 'アクティブ' : '無効'
            ];
            
            csvContent.push(rowData.join(','));
          });
          
          // BOM付きUTF-8でダウンロード
          const bom = '\\uFEFF';
          const blob = new Blob([bom + csvContent.join('\\n')], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          const url = URL.createObjectURL(blob);
          
          const now = new Date();
          const filename = 'members_' + now.getFullYear() + 
            String(now.getMonth() + 1).padStart(2, '0') + 
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') + 
            String(now.getMinutes()).padStart(2, '0') + 
            '.csv';
          
          link.setAttribute('href', url);
          link.setAttribute('download', filename);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

        function escapeCsvField(field) {
          if (!field) return '';
          field = String(field);
          // ダブルクォート、カンマ、改行が含まれる場合はダブルクォートで囲む
          if (field.includes('"') || field.includes(',') || field.includes('\\n')) {
            return '"' + field.replace(/"/g, '""') + '"';
          }
          return field;
        }

        // メンバー削除機能
        async function deleteMember(id, name) {
          if (!confirm('「' + name + '」を完全に削除しますか？\\n\\nこの操作は取り消せません。')) {
            return;
          }
          
          try {
            await axios.delete('/api/members/' + id);
            alert('メンバーを削除しました');
            location.reload();
          } catch (error) {
            alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
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
      
      // ユーザーも自動作成（メールアドレスがある場合のみ）
      if (record.email) {
        const existingUser = await db.prepare(`
          SELECT id FROM users WHERE email = ?
        `).bind(record.email).first()

        if (!existingUser) {
          const defaultPassword = record.email.split('@')[0] + '1234'
          const hashedPassword = await hashPassword(defaultPassword)
          
          await db.prepare(`
            INSERT INTO users (name, email, password, role, password_change_required)
            VALUES (?, ?, ?, ?, ?)
          `).bind(record.name, record.email, hashedPassword, 'none', 1).run()
        }
      }
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

// ========================================
// 自社情報管理 API
// ========================================

// 自社情報取得API（認証必須）
app.get('/api/company-info', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  if (!companyInfo) {
    return c.json({ success: false, error: '自社情報が見つかりません' }, 404)
  }
  
  return c.json({ success: true, data: companyInfo })
})

// 自社情報更新API（can_edit_company_info権限必要）
app.put('/api/company-info', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  const body = await c.req.json()
  const {
    company_name,
    postal_code,
    address,
    registration_number,
    bank_name,
    bank_branch,
    account_type,
    account_number,
    account_holder
  } = body
  
  if (!company_name) {
    return c.json({ success: false, error: '会社名は必須です' }, 400)
  }
  
  await DB.prepare(`
    UPDATE company_info 
    SET company_name = ?,
        postal_code = ?,
        address = ?,
        registration_number = ?,
        bank_name = ?,
        bank_branch = ?,
        account_type = ?,
        account_number = ?,
        account_holder = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(
    company_name,
    postal_code || null,
    address || null,
    registration_number || null,
    bank_name || null,
    bank_branch || null,
    account_type || null,
    account_number || null,
    account_holder || null
  ).run()
  
  await logAction(
    DB,
    user.userId,
    'update_company_info',
    'company_info',
    1,
    body,
    c.req.header('CF-Connecting-IP') || null
  )
  
  return c.json({ success: true, message: '自社情報を更新しました' })
})

// ロゴ画像アップロードAPI（can_edit_company_info権限必要）
app.post('/api/company-info/upload-logo', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('logo') as File
    
    if (!file) {
      return c.json({ success: false, error: 'ファイルが見つかりません' }, 400)
    }
    
    // ファイルサイズチェック（1MB）
    const maxSize = 1 * 1024 * 1024
    if (file.size > maxSize) {
      return c.json({ success: false, error: 'ファイルサイズが大きすぎます（最大1MB）' }, 400)
    }
    
    // ファイルをBase64に変換（大きなファイルでもスタックオーバーフローしないようチャンク処理）
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const base64 = btoa(binary)
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // DBを更新
    await DB.prepare(`
      UPDATE company_info 
      SET logo_base64 = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(dataUrl).run()
    
    await logAction(
      DB,
      user.userId,
      'upload_logo',
      'company_info',
      1,
      { file_type: file.type },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: 'ロゴをアップロードしました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'アップロードに失敗しました: ' + error.message }, 500)
  }
})

// 会社印画像アップロードAPI（can_edit_company_info権限必要）
app.post('/api/company-info/upload-seal', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('seal') as File
    
    if (!file) {
      return c.json({ success: false, error: 'ファイルが見つかりません' }, 400)
    }
    
    // ファイルサイズチェック（1MB）
    const maxSize = 1 * 1024 * 1024
    if (file.size > maxSize) {
      return c.json({ success: false, error: 'ファイルサイズが大きすぎます（最大1MB）' }, 400)
    }
    
    // ファイルをBase64に変換（大きなファイルでもスタックオーバーフローしないようチャンク処理）
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const base64 = btoa(binary)
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // DBを更新
    await DB.prepare(`
      UPDATE company_info 
      SET seal_base64 = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(dataUrl).run()
    
    await logAction(
      DB,
      user.userId,
      'upload_seal',
      'company_info',
      1,
      { file_type: file.type },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '会社印をアップロードしました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'アップロードに失敗しました: ' + error.message }, 500)
  }
})

// Base64画像取得API（認証必須）
app.get('/api/company-info/image/:type', authMiddleware, async (c) => {
  const { DB } = c.env
  const type = c.req.param('type') // 'logo' or 'seal'
  
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first() as any
  
  if (!companyInfo) {
    return c.json({ success: false, error: '自社情報が見つかりません' }, 404)
  }
  
  const base64Data = type === 'logo' ? companyInfo.logo_base64 : companyInfo.seal_base64
  
  if (!base64Data) {
    return c.json({ success: false, error: '画像が登録されていません' }, 404)
  }
  
  try {
    // data:image/png;base64,... 形式から画像データを抽出
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/)
    if (!matches) {
      return c.json({ success: false, error: '画像データの形式が不正です' }, 400)
    }
    
    const contentType = matches[1]
    const base64 = matches[2]
    
    // Base64をバイナリに変換
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    
    return new Response(bytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: '画像の取得に失敗しました: ' + error.message }, 500)
  }
})

// ========================================
// 見積書管理 API
// ========================================

// 見積書一覧取得API（認証必須）
app.get('/api/quotes', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const { results } = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    ORDER BY q.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

// 見積書詳細取得API（認証必須）
app.get('/api/quotes/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const quote = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific,
      l.billing_postal_code as postal_code,
      l.billing_address as address
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.id = ?
  `).bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  // 見積明細を取得
  const { results: items } = await DB.prepare(`
    SELECT 
      qi.*,
      m.name as member_name
    FROM quote_items qi
    LEFT JOIN members m ON qi.member_id = m.id
    WHERE qi.quote_id = ?
    ORDER BY qi.sort_order ASC
  `).bind(id).all()
  
  return c.json({ success: true, data: { ...quote, items } })
})

// プロジェクトの見積書一覧取得API（認証必須）
app.get('/api/projects/:projectId/quotes', authMiddleware, async (c) => {
  const { DB } = c.env
  const projectId = c.req.param('projectId')
  
  const { results } = await DB.prepare(`
    SELECT 
      q.*,
      l.company_name,
      l.honorific
    FROM quotes q
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.project_id = ?
    ORDER BY q.created_at DESC
  `).bind(projectId).all()
  
  return c.json({ success: true, data: results })
})

// 見積書作成API（lead_manage権限必要）
app.post('/api/projects/:projectId/quotes', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  
  const { issue_date, expiry_date, subject, items, notes } = body
  
  // プロジェクトの存在確認
  const project = await DB.prepare(`
    SELECT p.*, l.id as lead_id, l.company_name
    FROM projects p
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE p.id = ?
  `).bind(projectId).first() as any
  
  if (!project) {
    return c.json({ success: false, error: '案件が見つかりません' }, 404)
  }
  
  // 小計・消費税・合計を計算
  const subtotal = items.reduce((sum: number, item: any) => sum + item.amount, 0)
  const tax = Math.floor(subtotal * 0.1)
  const total = subtotal + tax
  
  // 見積番号を生成（YYYYMMDD-XXX形式）
  const today = new Date()
  const datePrefix = today.toISOString().split('T')[0].replace(/-/g, '').substring(2) // YYMMDD
  
  // 同日の見積書数を取得
  const { results: todayQuotes } = await DB.prepare(`
    SELECT id FROM quotes WHERE quote_number LIKE ?
  `).bind(`${datePrefix}-%`).all()
  
  const sequenceNumber = String(todayQuotes.length + 1).padStart(3, '0')
  const quoteNumber = `${datePrefix}-${sequenceNumber}`
  
  try {
    // 見積書を作成
    const result = await DB.prepare(`
      INSERT INTO quotes (
        quote_number, project_id, lead_id, issue_date, expiry_date,
        subject, subtotal, tax_rate, tax, total, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      quoteNumber,
      projectId,
      project.lead_id,
      issue_date,
      expiry_date || null,
      subject,
      subtotal,
      10.0,
      tax,
      total,
      notes || null,
      user.userId
    ).run()
    
    const quoteId = result.meta.last_row_id
    
    // 見積明細を作成
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      await DB.prepare(`
        INSERT INTO quote_items (
          quote_id, member_id, item_description, quantity, workload,
          unit, unit_price, amount, note, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        quoteId,
        item.member_id || null,
        item.item_description,
        item.quantity,
        item.workload || 1.0,
        item.unit || '人月',
        item.unit_price,
        item.amount,
        item.note || null,
        i
      ).run()
    }
    
    // 監査ログ記録
    await logAction(
      DB,
      user.userId,
      'create_quote',
      'quotes',
      Number(quoteId),
      { quote_number: quoteNumber, project_id: projectId, total },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({
      success: true,
      data: { id: quoteId, quote_number: quoteNumber },
      message: '見積書を作成しました'
    })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の作成に失敗しました: ' + error.message }, 500)
  }
})

// 見積書更新API（lead_manage権限必要）
app.put('/api/quotes/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { issue_date, expiry_date, subject, notes } = body
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    await DB.prepare(`
      UPDATE quotes 
      SET issue_date = ?,
          expiry_date = ?,
          subject = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      issue_date,
      expiry_date || null,
      subject,
      notes || null,
      id
    ).run()
    
    await logAction(
      DB,
      user.userId,
      'update_quote',
      'quotes',
      parseInt(id),
      body,
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '見積書を更新しました' })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の更新に失敗しました: ' + error.message }, 500)
  }
})

// 見積書ステータス変更API（lead_manage権限必要）
app.put('/api/quotes/:id/status', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { status, comment } = body
  
  // ステータスのバリデーション
  const validStatuses = ['draft', 'pending', 'approved', 'rejected', 'expired']
  if (!validStatuses.includes(status)) {
    return c.json({ success: false, error: '無効なステータスです' }, 400)
  }
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    // 現在のステータス
    const fromStatus = quote.status || 'draft'
    
    // ステータスを更新
    await DB.prepare(`
      UPDATE quotes 
      SET status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, id).run()
    
    // ステータス変更履歴を記録
    await DB.prepare(`
      INSERT INTO quote_status_changes (quote_id, from_status, to_status, changed_by, comment)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      id,
      fromStatus,
      status,
      user.userId,
      comment || null
    ).run()
    
    // アクションログに記録
    await logAction(
      DB,
      user.userId,
      'change_quote_status',
      'quotes',
      parseInt(id),
      { from: fromStatus, to: status, comment },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: 'ステータスを更新しました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'ステータスの更新に失敗しました: ' + error.message }, 500)
  }
})

// 見積書ステータス変更履歴取得API（認証必須）
app.get('/api/quotes/:id/status-history', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const { results } = await DB.prepare(`
    SELECT 
      qsc.*,
      COALESCE(m.name, u.email) as changed_by_name
    FROM quote_status_changes qsc
    LEFT JOIN users u ON qsc.changed_by = u.id
    LEFT JOIN members m ON u.member_id = m.id
    WHERE qsc.quote_id = ?
    ORDER BY qsc.changed_at DESC
  `).bind(id).all()
  
  return c.json({ success: true, data: results || [] })
})

// 見積書削除API（lead_manage権限必要）
app.delete('/api/quotes/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const id = c.req.param('id')
  
  // 見積書の存在確認
  const quote = await DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first()
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  try {
    // 明細を削除
    await DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id).run()
    
    // 見積書を削除
    await DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id).run()
    
    await logAction(
      DB,
      user.userId,
      'delete_quote',
      'quotes',
      parseInt(id),
      quote,
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '見積書を削除しました' })
  } catch (error: any) {
    return c.json({ success: false, error: '見積書の削除に失敗しました: ' + error.message }, 500)
  }
})

// PDF生成用データ取得API（認証必須）
app.get('/api/quotes/:id/pdf-data', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 見積書情報取得
  const quote = await DB.prepare(`
    SELECT 
      q.*,
      p.project_name,
      l.company_name,
      l.honorific,
      l.billing_postal_code as customer_postal_code,
      l.billing_address as customer_address
    FROM quotes q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.id = ?
  `).bind(id).first() as any
  
  if (!quote) {
    return c.json({ success: false, error: '見積書が見つかりません' }, 404)
  }
  
  // 見積明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      qi.*,
      m.name as member_name
    FROM quote_items qi
    LEFT JOIN members m ON qi.member_id = m.id
    WHERE qi.quote_id = ?
    ORDER BY qi.sort_order ASC
  `).bind(id).all()
  
  // 自社情報取得
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  return c.json({
    success: true,
    data: {
      quote,
      items,
      companyInfo
    }
  })
})

// ========================================
// 請求書管理 API
// ========================================

// 請求書一覧取得API（認証必須）
app.get('/api/invoices', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const { results } = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    ORDER BY i.created_at DESC
  `).all()
  
  return c.json({ success: true, data: results })
})

// 請求書詳細取得API（認証必須）
app.get('/api/invoices/:id', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const invoice = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific,
      l.billing_postal_code,
      l.billing_address,
      l.billing_contact_name
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    WHERE i.id = ?
  `).bind(id).first() as any
  
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      ii.*,
      m.name as member_name
    FROM invoice_items ii
    LEFT JOIN members m ON ii.member_id = m.id
    WHERE ii.invoice_id = ?
    ORDER BY ii.sort_order ASC
  `).bind(id).all()
  
  return c.json({ success: true, data: { ...invoice, items } })
})

// 月次明細から請求書作成API（lead_manage権限必要）
app.post('/api/monthly-details/:monthlyDetailId/invoice', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const monthlyDetailId = c.req.param('monthlyDetailId')
  
  try {
    const body = await c.req.json()
    
    // 月次明細情報取得
    const monthlyDetail = await DB.prepare(`
      SELECT 
        md.*,
        c.project_id,
        p.lead_id,
        l.company_name
      FROM monthly_details md
      JOIN contracts c ON md.contract_id = c.id
      JOIN projects p ON c.project_id = p.id
      JOIN leads l ON p.lead_id = l.id
      WHERE md.id = ?
    `).bind(monthlyDetailId).first() as any
    
    if (!monthlyDetail) {
      return c.json({ success: false, error: '月次明細が見つかりません' }, 404)
    }
  
  // 請求書番号を生成（INV-YYYYMM-XXX形式）
  const now = new Date()
  const yearMonth = now.toISOString().slice(0, 7).replace('-', '')
  const { results: existingInvoices } = await DB.prepare(
    'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1'
  ).bind(`INV-${yearMonth}-%`).all()
  
  let nextNumber = 1
  if (existingInvoices.length > 0) {
    const lastNumber = existingInvoices[0].invoice_number.split('-')[2]
    nextNumber = parseInt(lastNumber) + 1
  }
  const invoiceNumber = `INV-${yearMonth}-${String(nextNumber).padStart(3, '0')}`
  
  // 請求書作成
  const { issue_date, payment_due_date, subject, notes } = body
  const subtotal = monthlyDetail.amount
  const tax = Math.floor(subtotal * 0.1)
  const total = subtotal + tax
  
  // すべての値を確認
  const invoiceValues = {
    invoiceNumber,
    monthlyDetailId,
    lead_id: monthlyDetail.lead_id,
    issue_date,
    payment_due_date: payment_due_date ? payment_due_date : null,
    subject,
    subtotal,
    tax,
    total,
    tax_rate: 10,
    notes: notes ? notes : null,
    payment_status: '未入金',
    created_by: user.userId  // user.id ではなく user.userId
  }
  
  // undefinedの値を検出
  for (const [key, value] of Object.entries(invoiceValues)) {
    if (value === undefined) {
      throw new Error(`Invoice value '${key}' is undefined`)
    }
  }
  
  const invoiceResult = await DB.prepare(`
    INSERT INTO invoices (
      invoice_number, monthly_detail_id, lead_id,
      issue_date, payment_due_date, subject,
      subtotal, tax, total, tax_rate,
      notes, payment_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    invoiceNumber,
    monthlyDetailId,
    monthlyDetail.lead_id,
    issue_date,
    payment_due_date ? payment_due_date : null,
    subject,
    subtotal,
    tax,
    total,
    10,
    notes ? notes : null,
    '未入金',
    user.userId  // user.id ではなく user.userId
  ).run()
  
  const invoiceId = invoiceResult.meta.last_row_id
  console.log('[DEBUG] Invoice created successfully, ID:', invoiceId)
  
    // 月次明細のアサインメンバーから請求明細を作成
    const { results: monthlyMembers } = await DB.prepare(`
      SELECT 
        mma.id,
        mma.member_id,
        mma.allocation_ratio,
        mma.unit_price,
        mma.notes,
        m.name as member_name
      FROM monthly_member_assignments mma
      JOIN members m ON mma.member_id = m.id
      WHERE mma.monthly_detail_id = ?
    `).bind(monthlyDetailId).all()
    
    console.log('[DEBUG] Monthly members count:', monthlyMembers.length)
    
    let sortOrder = 1
    for (const member of monthlyMembers) {
      // allocation_ratioは既に0.0〜1.0の範囲（例: 0.2=20%, 0.5=50%）
      const quantity = member.allocation_ratio
      const amount = Math.floor(monthlyDetail.amount * member.allocation_ratio)
      
      await DB.prepare(`
        INSERT INTO invoice_items (
          invoice_id, member_id, item_description,
          quantity, unit, unit_price, amount, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoiceId,
        member.member_id,
        `${member.member_name} 稼働費用（${monthlyDetail.target_month}）`,
        quantity,
        '人月',
        member.unit_price,
        amount,
        sortOrder++
      ).run()
    }
    
    console.log('[DEBUG] All invoice items created successfully')
    
    // 月次明細の請求情報を更新
    await DB.prepare(`
      UPDATE monthly_details 
      SET billing_status = '請求済',
          billing_date = ?,
          invoice_number = ?
      WHERE id = ?
    `).bind(issue_date, invoiceNumber, monthlyDetailId).run()
    
    console.log('[DEBUG] Monthly details updated successfully')
    
    // 変更履歴を記録
    await DB.prepare(`
      INSERT INTO status_change_histories (
        table_name, record_id, field_name, 
        old_value, new_value, reason, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'monthly_details',
      monthlyDetailId,
      'billing_status',
      monthlyDetail.billing_status,
      '請求済',
      `請求書作成: ${invoiceNumber}`,
      user.email
    ).run()
    
    console.log('[DEBUG] History recorded successfully')
    
    return c.json({
      success: true,
      data: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber
      }
    })
  } catch (error) {
    console.error('Invoice creation error:', error)
    // エラーの詳細情報を出力
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    return c.json({ 
      success: false, 
      error: `請求書の作成に失敗しました: ${error instanceof Error ? error.message : String(error)}`
    }, 500)
  }
})

// 請求書更新API（lead_manage権限必要）
app.put('/api/invoices/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const { payment_status, payment_date, notes } = body
  
  await DB.prepare(`
    UPDATE invoices 
    SET payment_status = ?,
        payment_date = ?,
        notes = ?
    WHERE id = ?
  `).bind(payment_status, payment_date || null, notes || null, id).run()
  
  return c.json({ success: true })
})

// 請求書削除API（admin権限必要）
app.delete('/api/invoices/:id', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 請求書が存在するか確認
  const invoice = await DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first()
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細を削除
  await DB.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id).run()
  
  // 請求書を削除
  await DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run()
  
  return c.json({ success: true })
})

// 請求書PDF用データ取得API（認証必須）
app.get('/api/invoices/:id/pdf-data', authMiddleware, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 請求書情報取得
  const invoice = await DB.prepare(`
    SELECT 
      i.*,
      l.company_name,
      l.honorific,
      l.billing_postal_code,
      l.billing_address,
      l.billing_contact_name
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
    WHERE i.id = ?
  `).bind(id).first() as any
  
  if (!invoice) {
    return c.json({ success: false, error: '請求書が見つかりません' }, 404)
  }
  
  // 請求明細取得
  const { results: items } = await DB.prepare(`
    SELECT 
      ii.*,
      m.name as member_name
    FROM invoice_items ii
    LEFT JOIN members m ON ii.member_id = m.id
    WHERE ii.invoice_id = ?
    ORDER BY ii.sort_order ASC
  `).bind(id).all()
  
  // 自社情報取得
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  return c.json({
    success: true,
    data: {
      invoice,
      items,
      companyInfo
    }
  })
})

// ========================================
// データバックアップ・リストア API（管理者のみ）
// ========================================

// テーブル定義とエクスポート順序（外部キー制約を考慮）
const EXPORT_TABLES = [
  // 独立テーブル（外部キーなし）
  { name: 'system_settings', label: 'システム設定' },
  { name: 'members', label: 'メンバー' },
  { name: 'leads', label: 'リード' },
  { name: 'users', label: 'ユーザー' },
  { name: 'company_info', label: '自社情報' },
  // 第1レベル依存
  { name: 'user_permissions', label: 'ユーザー権限' },
  { name: 'projects', label: '案件' },
  // 第2レベル依存
  { name: 'contracts', label: '契約' },
  { name: 'meeting_notes', label: '議事録' },
  // 第3レベル依存
  { name: 'monthly_details', label: '月次明細' },
  { name: 'contract_member_assignments', label: '契約メンバーアサイン' },
  { name: 'monthly_member_assignments', label: '月次メンバーアサイン' },
  { name: 'quotes', label: '見積書' },
  { name: 'invoices', label: '請求書' },
  // 第4レベル依存
  { name: 'payment_histories', label: '入金履歴' },
  { name: 'quote_items', label: '見積書明細' },
  { name: 'quote_status_changes', label: '見積書ステータス変更履歴' },
  { name: 'invoice_items', label: '請求書明細' },
  // ログテーブル（最後）
  { name: 'status_change_histories', label: 'ステータス変更履歴' },
  { name: 'audit_logs', label: '監査ログ' }
]

// CSVエスケープ関数
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return ''
  }
  const str = String(value)
  // ダブルクォートをエスケープ
  const escaped = str.replace(/"/g, '""')
  // カンマ、改行、ダブルクォートを含む場合はクォートで囲む
  if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
    return `"${escaped}"`
  }
  return escaped
}

// テーブルデータをCSV形式で取得
async function exportTableToCsv(DB: D1Database, tableName: string): Promise<string> {
  try {
    // テーブル情報を取得
    const { results: tableInfo } = await DB.prepare(
      `PRAGMA table_info(${tableName})`
    ).all()
    
    if (!tableInfo || tableInfo.length === 0) {
      return '' // テーブルが存在しない
    }
    
    // カラム名を取得
    const columns = tableInfo.map((col: any) => col.name)
    
    // データを取得（パスワードは除外）
    let query = `SELECT * FROM ${tableName}`
    let exportColumns = columns
    
    if (tableName === 'users') {
      // ユーザーテーブルの場合、パスワードハッシュは除外
      exportColumns = columns.filter(col => col !== 'password_hash')
      query = `SELECT ${exportColumns.join(', ')} FROM ${tableName}`
    }
    
    const { results } = await DB.prepare(query).all()
    
    // CSVヘッダー（エクスポート対象のカラムのみ）
    let csv = exportColumns.join(',') + '\n'
    
    // データ行
    if (results) {
      for (const row of results) {
        const values = exportColumns.map(col => {
          const value = (row as any)[col]
          return escapeCsvValue(value)
        })
        csv += values.join(',') + '\n'
      }
    }
    
    return csv
  } catch (error) {
    console.error(`Error exporting table ${tableName}:`, error)
    return ''
  }
}

// 全データエクスポートAPI
app.get('/api/admin/data/export/all', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // メタデータ作成
    const metadata = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: user.email || 'unknown',
      database_schema_version: '0024',
      tables: [] as any[],
      options: {
        include_users: true,
        include_system_settings: true,
        anonymize_data: false
      }
    }
    
    // ZIP用のファイル辞書を作成
    const zipFiles: { [key: string]: Uint8Array } = {}
    
    // 各テーブルをCSVに変換
    for (const table of EXPORT_TABLES) {
      const csv = await exportTableToCsv(DB, table.name)
      if (csv) {
        // CSVをUint8Arrayに変換
        zipFiles[`${table.name}.csv`] = strToU8(csv)
        
        // 行数をカウント
        const lines = csv.split('\n').filter(line => line.trim())
        const rowCount = Math.max(0, lines.length - 1) // ヘッダーを除く
        
        metadata.tables.push({
          name: table.name,
          label: table.label,
          row_count: rowCount,
          file: `${table.name}.csv`
        })
      }
    }
    
    // メタデータをJSON文字列に変換してZIPに追加
    zipFiles['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    
    // ZIPファイルを生成
    const zippedData = zipSync(zipFiles, { level: 6 })
    
    // タイムスタンプを生成
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_all_${timestamp}.zip`
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_export',
      'backup',
      null,
      `Exported all tables (${metadata.tables.length} tables)`,
      null
    )
    
    // ZIPファイルをレスポンスとして返す
    return new Response(zippedData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zippedData.length.toString()
      }
    })
    
  } catch (error: any) {
    console.error('Export error:', error)
    return c.json({ 
      success: false, 
      error: 'エクスポートに失敗しました: ' + error.message 
    }, 500)
  }
})

// テーブル選択エクスポートAPI
app.post('/api/admin/data/export/selective', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const { tables, anonymize_data } = await c.req.json()
  
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return c.json({ error: 'テーブルを選択してください' }, 400)
  }
  
  try {
    // 選択されたテーブルのみエクスポート
    const selectedTables = EXPORT_TABLES.filter(t => tables.includes(t.name))
    
    const metadata = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: user.email || 'unknown',
      database_schema_version: '0024',
      tables: [] as any[],
      options: {
        include_users: tables.includes('users'),
        include_system_settings: tables.includes('system_settings'),
        anonymize_data: anonymize_data || false
      }
    }
    
    // ZIP用のファイル辞書を作成
    const zipFiles: { [key: string]: Uint8Array } = {}
    
    for (const table of selectedTables) {
      const csv = await exportTableToCsv(DB, table.name)
      if (csv) {
        // CSVをUint8Arrayに変換
        zipFiles[`${table.name}.csv`] = strToU8(csv)
        
        const lines = csv.split('\n').filter(line => line.trim())
        const rowCount = Math.max(0, lines.length - 1)
        
        metadata.tables.push({
          name: table.name,
          label: table.label,
          row_count: rowCount,
          file: `${table.name}.csv`
        })
      }
    }
    
    // メタデータをJSON文字列に変換してZIPに追加
    zipFiles['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    
    // ZIPファイルを生成
    const zippedData = zipSync(zipFiles, { level: 6 })
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_selective_${timestamp}.zip`
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_export',
      'backup',
      null,
      `Exported ${selectedTables.length} selected tables`,
      null
    )
    
    // ZIPファイルをレスポンスとして返す
    return new Response(zippedData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zippedData.length.toString()
      }
    })
    
  } catch (error: any) {
    console.error('Export error:', error)
    return c.json({ 
      success: false, 
      error: 'エクスポートに失敗しました: ' + error.message 
    }, 500)
  }
})

// インポートプレビューAPI
app.post('/api/admin/data/import/preview', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    // multipart/form-dataからファイルを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return c.json({ error: 'ファイルが選択されていません' }, 400)
    }
    
    console.log('File received:', file.name, 'Size:', file.size, 'Type:', file.type)
    
    // ファイルをArrayBufferとして読み込み
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    console.log('ArrayBuffer size:', arrayBuffer.byteLength)
    
    // ZIPファイルを解凍
    let unzipped: any
    try {
      unzipped = unzipSync(uint8Array)
      console.log('Unzipped files:', Object.keys(unzipped))
    } catch (error: any) {
      console.error('Unzip error:', error)
      return c.json({ error: 'ZIPファイルの解凍に失敗しました: ' + error.message }, 400)
    }
    
    // ファイルパスを正規化する関数（ディレクトリ構造を無視）
    const findFile = (filename: string): Uint8Array | undefined => {
      // 直接ルートにある場合
      if (unzipped[filename]) return unzipped[filename]
      
      // ディレクトリ内を検索（__MACOSX を除外）
      for (const path of Object.keys(unzipped)) {
        if (path.includes('__MACOSX')) continue
        if (path.endsWith('/' + filename) || path.endsWith('\\' + filename)) {
          return unzipped[path]
        }
      }
      return undefined
    }
    
    // metadata.jsonを読み込み
    const metadataData = findFile('metadata.json')
    if (!metadataData) {
      console.error('metadata.json not found. Available files:', Object.keys(unzipped))
      return c.json({ 
        error: 'metadata.jsonが見つかりません。ZIPファイルに含まれるファイル: ' + Object.keys(unzipped).join(', ') 
      }, 400)
    }
    
    const metadataStr = strFromU8(metadataData)
    const metadata = JSON.parse(metadataStr)
    
    // バックアップファイルの検証
    const tablesFound = []
    const warnings = []
    
    for (const table of metadata.tables) {
      const csvData = findFile(table.file)
      if (csvData) {
        const csv = strFromU8(csvData)
        const lines = csv.split('\n').filter((line: string) => line.trim())
        const dataRows = Math.max(0, lines.length - 1)
        
        // 既存データの件数を確認
        try {
          const { results } = await DB.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).all()
          const existingRows = results && results[0] ? (results[0] as any).count : 0
          
          tablesFound.push({
            name: table.name,
            label: table.label,
            row_count: dataRows,
            existing_rows: existingRows,
            will_import: true,
            has_data: existingRows > 0
          })
          
          if (existingRows > 0) {
            warnings.push(`${table.label}に既存データ${existingRows}件があります`)
          }
        } catch (error) {
          tablesFound.push({
            name: table.name,
            label: table.label,
            row_count: dataRows,
            existing_rows: 0,
            will_import: true,
            has_data: false,
            error: 'テーブルが存在しません'
          })
        }
      }
    }
    
    return c.json({
      success: true,
      metadata,
      tables_found: tablesFound,
      warnings: warnings.length > 0 ? warnings : ['既存データが削除される可能性があります']
    })
    
  } catch (error: any) {
    console.error('Preview error:', error)
    return c.json({ 
      success: false, 
      error: 'プレビューに失敗しました: ' + error.message 
    }, 500)
  }
})

// インポート実行API
app.post('/api/admin/data/import/execute', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // multipart/form-dataからファイルとモードを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const mode = formData.get('mode') as string || 'append'
    
    if (!file) {
      return c.json({ error: 'ファイルが選択されていません' }, 400)
    }
    
    if (!['replace', 'append', 'merge'].includes(mode)) {
      return c.json({ error: '無効なインポートモードです' }, 400)
    }
    
    // ファイルをArrayBufferとして読み込み
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // ZIPファイルを解凍
    let unzipped: any
    try {
      unzipped = unzipSync(uint8Array)
    } catch (error) {
      return c.json({ error: 'ZIPファイルの解凍に失敗しました' }, 400)
    }
    
    // ファイルパスを正規化する関数（ディレクトリ構造を無視）
    const findFile = (filename: string): Uint8Array | undefined => {
      // 直接ルートにある場合
      if (unzipped[filename]) return unzipped[filename]
      
      // ディレクトリ内を検索（__MACOSX を除外）
      for (const path of Object.keys(unzipped)) {
        if (path.includes('__MACOSX')) continue
        if (path.endsWith('/' + filename) || path.endsWith('\\' + filename)) {
          return unzipped[path]
        }
      }
      return undefined
    }
    
    // metadata.jsonを読み込み
    const metadataData = findFile('metadata.json')
    if (!metadataData) {
      return c.json({ error: 'metadata.jsonが見つかりません' }, 400)
    }
    
    const metadataStr = strFromU8(metadataData)
    const metadata = JSON.parse(metadataStr)
    
    const results = []
    const deleteQueries = []  // DELETE用（逆順で実行）
    const insertQueries = []  // INSERT用（正順で実行）
    const queryInfo = [] // デバッグ用：各クエリの情報を記録
    
    console.log('Starting import process. Mode:', mode, 'Tables:', metadata.tables.length)
    
    // Replaceモード: 既存データを削除（外部キー依存の逆順）
    if (mode === 'replace') {
      console.log('Replace mode: preparing DELETE queries in reverse order')
      const reversedTables = [...metadata.tables].reverse()
      for (const table of reversedTables) {
        const deleteQuery = DB.prepare(`DELETE FROM ${table.name}`)
        deleteQueries.push(deleteQuery)
        queryInfo.push({ type: 'DELETE', sql: `DELETE FROM ${table.name}`, table: table.name })
        console.log(`Added DELETE query for table: ${table.name}`)
      }
    }
    
    // データインポート（外部キー依存順）
    for (const table of metadata.tables) {
      const csvData = findFile(table.file)
      if (!csvData) {
        console.log(`CSV file not found for table: ${table.name}`)
        continue
      }
      
      const csv = strFromU8(csvData)
      const lines = csv.split('\n').filter((line: string) => line.trim())
      if (lines.length < 2) {
        console.log(`No data rows for table: ${table.name}`)
        continue
      }
      
      console.log(`Processing table: ${table.name}, rows: ${lines.length - 1}`)
      
      let inserted = 0
      let updated = 0
      let errors = 0
      
      try {
        // ヘッダー行からカラム名を取得
        let headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        console.log(`Table ${table.name} headers:`, headers)
        
        // usersテーブルの特別処理: password_hashが欠けている場合はデフォルト値を追加
        const isUsersTable = table.name === 'users'
        const hasPasswordHash = headers.includes('password_hash')
        if (isUsersTable && !hasPasswordHash) {
          headers.push('password_hash')
          console.log(`Added password_hash column for users table`)
        }
        
        // データ行をインポート
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]
          const values = []
          let current = ''
          let inQuotes = false
          
          // CSVパース（クォート対応）
          for (let j = 0; j < line.length; j++) {
            const char = line[j]
            if (char === '"') {
              inQuotes = !inQuotes
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim())
              current = ''
            } else {
              current += char
            }
          }
          values.push(current.trim())
          
          // 値の整形（クォート除去、空文字列をnullに変換）
          const cleanValues = values.map(v => {
            if (v === '') return null
            if (v.startsWith('"') && v.endsWith('"')) {
              return v.slice(1, -1).replace(/""/g, '"')
            }
            return v
          })
          
          // usersテーブルでpassword_hashが欠けている場合、デフォルトのハッシュ値を追加
          if (isUsersTable && !hasPasswordHash) {
            // デフォルトパスワード 'admin123' のPBKDF2ハッシュ
            cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
          }
          
          // usersテーブルでpassword_hashがNULLまたは空の場合、デフォルト値に置き換える
          if (isUsersTable && hasPasswordHash) {
            const passwordHashIndex = headers.indexOf('password_hash')
            if (passwordHashIndex !== -1 && (!cleanValues[passwordHashIndex] || cleanValues[passwordHashIndex] === '')) {
              cleanValues[passwordHashIndex] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
              console.log(`Replaced empty password_hash with default for row ${i}`)
            }
          }
          
          if (mode === 'merge') {
            // Mergeモード: UPSERT（ON CONFLICT）
            const placeholders = headers.map(() => '?').join(', ')
            const updateSet = headers
              .filter(h => h !== 'id')
              .map(h => `${h} = excluded.${h}`)
              .join(', ')
            
            const sql = `INSERT INTO ${table.name} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
            insertQueries.push(DB.prepare(sql).bind(...cleanValues))
            queryInfo.push({ 
              type: 'MERGE', 
              sql, 
              table: table.name, 
              row: i, 
              values: cleanValues.slice(0, 3) // 最初の3つの値のみ記録
            })
            updated++
          } else {
            // Replace/Appendモード: INSERT
            // IDカラムがある場合、appendモードではIDを除外
            let insertHeaders = headers
            let insertValues = cleanValues
            
            if (mode === 'append' && headers.includes('id')) {
              const idIndex = headers.indexOf('id')
              insertHeaders = headers.filter((_, idx) => idx !== idIndex)
              insertValues = cleanValues.filter((_, idx) => idx !== idIndex)
            }
            
            const placeholders = insertHeaders.map(() => '?').join(', ')
            const sql = `INSERT INTO ${table.name} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
            insertQueries.push(DB.prepare(sql).bind(...insertValues))
            queryInfo.push({ 
              type: 'INSERT', 
              sql, 
              table: table.name, 
              row: i, 
              values: insertValues.slice(0, 3) // 最初の3つの値のみ記録
            })
            inserted++
          }
        }
        
        console.log(`Table ${table.name}: prepared ${inserted + updated} queries`)
        
        results.push({
          table: table.name,
          label: table.label,
          inserted,
          updated: mode === 'merge' ? updated : 0,
          errors
        })
        
      } catch (error: any) {
        console.error(`Import error for table ${table.name}:`, error)
        results.push({
          table: table.name,
          label: table.label,
          inserted: 0,
          updated: 0,
          errors: 1,
          error: error.message
        })
      }
    }
    
    console.log(`Total DELETE queries: ${deleteQueries.length}`)
    console.log(`Total INSERT queries: ${insertQueries.length}`)
    console.log(`Query info summary:`, queryInfo.slice(0, 10)) // 最初の10件のみログ出力
    
    // バッチ実行: DELETEとINSERTを1つのバッチにまとめる
    // これにより、バッチ全体が成功または失敗するため、データ消失を防ぐ
    try {
      const allQueries = []
      
      if (mode === 'replace' && deleteQueries.length > 0) {
        // Replaceモード: DELETEを先に追加（逆順）
        console.log('Replace mode: Adding DELETE queries to batch (reverse order)')
        allQueries.push(...deleteQueries)
      }
      
      // INSERTを追加（正順）
      if (insertQueries.length > 0) {
        console.log('Adding INSERT queries to batch (forward order)')
        allQueries.push(...insertQueries)
      }
      
      // 1つのバッチとして実行
      if (allQueries.length > 0) {
        console.log(`Executing batch with ${allQueries.length} queries...`)
        await DB.batch(allQueries)
        console.log('Batch execution successful')
      }
    } catch (batchError: any) {
      console.error('Batch execution failed:', batchError)
      console.error('Error details:', {
        message: batchError.message,
        cause: batchError.cause,
        stack: batchError.stack
      })
      
      // より詳細なエラー情報を返す
      return c.json({ 
        success: false, 
        error: 'バッチ実行に失敗しました',
        details: {
          message: batchError.message,
          deleteQueries: deleteQueries.length,
          insertQueries: insertQueries.length,
          mode: mode,
          tables: metadata.tables.map((t: any) => t.name),
          queryInfoSample: queryInfo.slice(0, 20) // 最初の20クエリの情報
        }
      }, 500)
    }
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_import',
      'backup',
      null,
      `Imported ${results.length} tables in ${mode} mode`,
      null
    )
    
    return c.json({
      success: true,
      mode,
      results
    })
    
  } catch (error: any) {
    console.error('Import error:', error)
    console.error('Error stack:', error.stack)
    return c.json({ 
      success: false, 
      error: 'インポートに失敗しました: ' + error.message,
      details: {
        stack: error.stack,
        cause: error.cause
      }
    }, 500)
  }
})

// CSV単体インポートAPI（管理者専用）
app.post('/api/admin/data/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // multipart/form-dataからファイル、テーブル名、モードを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const tableName = formData.get('table_name') as string
    const mode = formData.get('mode') as string || 'append'
    
    if (!file) {
      return c.json({ error: 'CSVファイルが選択されていません' }, 400)
    }
    
    if (!tableName) {
      return c.json({ error: 'テーブル名が指定されていません' }, 400)
    }
    
    if (!['replace', 'append', 'merge'].includes(mode)) {
      return c.json({ error: '無効なインポートモードです' }, 400)
    }
    
    // テーブルが存在するか確認
    const tableConfig = EXPORT_TABLES.find(t => t.name === tableName)
    if (!tableConfig) {
      return c.json({ error: '指定されたテーブルが見つかりません' }, 400)
    }
    
    // ファイルをテキストとして読み込み
    const csvText = await file.text()
    const lines = csvText.split('\n').filter((line: string) => line.trim())
    
    if (lines.length < 2) {
      return c.json({ error: 'CSVファイルにデータがありません' }, 400)
    }
    
    console.log(`CSV Import - Table: ${tableName}, Mode: ${mode}, Rows: ${lines.length - 1}`)
    
    let inserted = 0
    let updated = 0
    let errors = 0
    
    const deleteQueries = []
    const insertQueries = []
    
    try {
      // Replaceモード: テーブルのデータを削除
      if (mode === 'replace') {
        console.log(`Replace mode: preparing DELETE for table ${tableName}`)
        const deleteQuery = DB.prepare(`DELETE FROM ${tableName}`)
        deleteQueries.push(deleteQuery)
      }
      
      // ヘッダー行からカラム名を取得
      let headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      console.log(`Table ${tableName} headers:`, headers)
      
      // usersテーブルの特別処理: password_hashが欠けている場合はデフォルト値を追加
      const isUsersTable = tableName === 'users'
      const hasPasswordHash = headers.includes('password_hash')
      if (isUsersTable && !hasPasswordHash) {
        headers.push('password_hash')
        console.log(`Added password_hash column for users table`)
      }
      
      // データ行をインポート
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const values = []
        let current = ''
        let inQuotes = false
        
        // CSVパース（クォート対応）
        for (let j = 0; j < line.length; j++) {
          const char = line[j]
          if (char === '"') {
            inQuotes = !inQuotes
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim())
            current = ''
          } else {
            current += char
          }
        }
        values.push(current.trim())
        
        // 値の整形（クォート除去、空文字列をnullに変換）
        const cleanValues = values.map(v => {
          if (v === '') return null
          if (v.startsWith('"') && v.endsWith('"')) {
            return v.slice(1, -1).replace(/""/g, '"')
          }
          return v
        })
        
        // usersテーブルでpassword_hashが欠けている場合、デフォルトのハッシュ値を追加
        if (isUsersTable && !hasPasswordHash) {
          cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
        }
        
        // usersテーブルでpassword_hashがNULLまたは空の場合、デフォルト値に置き換える
        if (isUsersTable && hasPasswordHash) {
          const passwordHashIndex = headers.indexOf('password_hash')
          if (passwordHashIndex !== -1 && (!cleanValues[passwordHashIndex] || cleanValues[passwordHashIndex] === '')) {
            cleanValues[passwordHashIndex] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
            console.log(`Replaced empty password_hash with default for row ${i}`)
          }
        }
        
        if (mode === 'merge') {
          // Mergeモード: UPSERT（ON CONFLICT）
          const placeholders = headers.map(() => '?').join(', ')
          const updateSet = headers
            .filter(h => h !== 'id')
            .map(h => `${h} = excluded.${h}`)
            .join(', ')
          
          const sql = `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
          insertQueries.push(DB.prepare(sql).bind(...cleanValues))
          updated++
        } else {
          // Replace/Appendモード: INSERT
          let insertHeaders = headers
          let insertValues = cleanValues
          
          if (mode === 'append' && headers.includes('id')) {
            const idIndex = headers.indexOf('id')
            insertHeaders = headers.filter((_, idx) => idx !== idIndex)
            insertValues = cleanValues.filter((_, idx) => idx !== idIndex)
          }
          
          const placeholders = insertHeaders.map(() => '?').join(', ')
          const sql = `INSERT INTO ${tableName} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
          insertQueries.push(DB.prepare(sql).bind(...insertValues))
          inserted++
        }
      }
      
      console.log(`Prepared ${inserted + updated} queries for ${tableName}`)
      
      // バッチ実行: DELETEとINSERTを1つのバッチにまとめる
      const allQueries = []
      
      if (mode === 'replace' && deleteQueries.length > 0) {
        allQueries.push(...deleteQueries)
      }
      
      if (insertQueries.length > 0) {
        allQueries.push(...insertQueries)
      }
      
      if (allQueries.length > 0) {
        console.log(`Executing batch with ${allQueries.length} queries...`)
        await DB.batch(allQueries)
        console.log('Batch execution successful')
      }
      
    } catch (error: any) {
      console.error(`CSV Import error for table ${tableName}:`, error)
      errors = 1
      
      return c.json({ 
        success: false, 
        error: 'CSVインポートに失敗しました',
        details: {
          message: error.message,
          table: tableName,
          mode: mode
        }
      }, 500)
    }
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'csv_import',
      'backup',
      null,
      `CSV imported to ${tableName} table in ${mode} mode`,
      null
    )
    
    return c.json({
      success: true,
      mode,
      result: {
        table: tableName,
        label: tableConfig.label,
        inserted,
        updated: mode === 'merge' ? updated : 0,
        errors
      }
    })
    
  } catch (error: any) {
    console.error('CSV Import error:', error)
    return c.json({ 
      success: false, 
      error: 'CSVインポートに失敗しました: ' + error.message,
      details: {
        message: error.message,
        stack: error.stack
      }
    }, 500)
  }
})

// エクスポート可能なテーブル一覧取得API
app.get('/api/admin/data/tables', authMiddleware, requireAdmin, async (c) => {
  return c.json({
    success: true,
    tables: EXPORT_TABLES
  })
})

// データバックアップ・リストア画面
app.get('/settings/data-backup', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>データバックアップ・リストア - SFA</title>
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
                <a href="/settings" class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2">
                  <i class="fas fa-cog mr-2"></i>設定
                </a>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-700">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="nav-user-name">読込中...</span>
              </span>
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
          <div class="flex items-center justify-between mb-6">
            <h1 class="text-3xl font-bold text-gray-900">
              <i class="fas fa-database mr-2"></i>データバックアップ・リストア
            </h1>
            <a href="/settings" class="text-blue-600 hover:text-blue-700">
              <i class="fas fa-arrow-left mr-1"></i>設定に戻る
            </a>
          </div>

          <!-- 警告メッセージ -->
          <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <div class="flex">
              <div class="flex-shrink-0">
                <i class="fas fa-exclamation-triangle text-yellow-400"></i>
              </div>
              <div class="ml-3">
                <p class="text-sm text-yellow-700">
                  <strong>注意:</strong> データのインポートは既存データに影響を与える可能性があります。本番環境での実行前に必ずバックアップを取得してください。
                </p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- エクスポートセクション -->
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-semibold text-gray-900 mb-4">
                <i class="fas fa-download mr-2 text-blue-600"></i>データエクスポート
              </h2>
              <p class="text-gray-600 mb-4 text-sm">
                全テーブルのデータをZIP形式（複数CSV）でエクスポートします。
              </p>

              <!-- エクスポートオプション -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">エクスポート対象</label>
                <div class="space-y-2">
                  <label class="flex items-center">
                    <input type="radio" name="export-type" value="all" checked class="mr-2">
                    <span class="text-sm">すべてのテーブル</span>
                  </label>
                  <label class="flex items-center">
                    <input type="radio" name="export-type" value="selective" class="mr-2">
                    <span class="text-sm">テーブルを選択</span>
                  </label>
                </div>
              </div>

              <!-- テーブル選択（初期非表示） -->
              <div id="table-selection" class="mb-4" style="display:none;">
                <label class="block text-sm font-medium text-gray-700 mb-2">エクスポートするテーブル</label>
                <div id="table-checkboxes" class="space-y-1 max-h-64 overflow-y-auto border border-gray-300 rounded p-2">
                  <!-- 動的に生成 -->
                </div>
              </div>

              <button 
                id="export-button"
                onclick="exportData()" 
                class="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
                <i class="fas fa-download mr-2"></i>エクスポート開始
              </button>

              <!-- エクスポート進行状況 -->
              <div id="export-progress" class="mt-4" style="display:none;">
                <div class="bg-blue-50 border border-blue-200 rounded p-3">
                  <div class="flex items-center">
                    <i class="fas fa-spinner fa-spin text-blue-600 mr-2"></i>
                    <span class="text-sm text-blue-700">エクスポート中...</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- インポートセクション -->
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-xl font-semibold text-gray-900 mb-4">
                <i class="fas fa-upload mr-2 text-green-600"></i>データインポート
              </h2>
              <p class="text-gray-600 mb-4 text-sm">
                エクスポートしたZIPファイルからデータをインポートします。
              </p>

              <!-- ファイル選択 -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">ZIPファイルを選択</label>
                <input 
                  type="file" 
                  id="import-file" 
                  accept=".zip"
                  class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  onchange="handleFileSelect()">
              </div>

              <!-- インポートモード -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">インポートモード</label>
                <select id="import-mode" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="append" selected>Append（追加）: 既存データを保持して新規追加（推奨）</option>
                  <option value="merge">Merge（マージ）: ID一致時は更新、不一致時は追加</option>
                  <option value="replace">Replace（上書き）: 既存データを削除して新規投入</option>
                </select>
                <p class="text-xs text-gray-500 mt-1">
                  <i class="fas fa-info-circle"></i> 
                  Replaceモードは全データを削除後、新規投入します。実行前に必ずバックアップを取得してください。
                </p>
              </div>

              <!-- プレビューボタン -->
              <button 
                id="preview-button"
                onclick="previewImport()" 
                class="w-full bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors mb-2"
                disabled>
                <i class="fas fa-eye mr-2"></i>プレビュー
              </button>

              <!-- インポート実行ボタン -->
              <button 
                id="import-button"
                onclick="executeImport()" 
                class="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
                disabled>
                <i class="fas fa-upload mr-2"></i>インポート実行
              </button>

              <!-- インポート進行状況 -->
              <div id="import-progress" class="mt-4" style="display:none;">
                <div class="bg-green-50 border border-green-200 rounded p-3">
                  <div class="flex items-center">
                    <i class="fas fa-spinner fa-spin text-green-600 mr-2"></i>
                    <span class="text-sm text-green-700">インポート中...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- CSV単体インポートセクション -->
          <div class="bg-white rounded-lg shadow-md p-6 mt-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-4">
              <i class="fas fa-file-csv mr-2 text-purple-600"></i>CSV単体インポート
            </h2>
            <p class="text-gray-600 mb-4 text-sm">
              単一テーブルのCSVファイルをインポートします。
            </p>

            <!-- テーブル選択 -->
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">インポート先テーブル</label>
              <select id="csv-table-select" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">テーブルを選択してください</option>
              </select>
            </div>

            <!-- CSVファイル選択 -->
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">CSVファイルを選択</label>
              <input 
                type="file" 
                id="csv-file" 
                accept=".csv"
                class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                onchange="handleCsvFileSelect()">
            </div>

            <!-- CSVインポートモード -->
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">インポートモード</label>
              <select id="csv-import-mode" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="append" selected>Append（追加）: 既存データを保持して新規追加（推奨）</option>
                <option value="merge">Merge（マージ）: ID一致時は更新、不一致時は追加</option>
                <option value="replace">Replace（上書き）: テーブルの全データを削除して新規投入</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">
                <i class="fas fa-exclamation-triangle text-yellow-600"></i> 
                Replaceモードは選択したテーブルの全データを削除します。実行前にバックアップを取得してください。
              </p>
            </div>

            <!-- CSVインポート実行ボタン -->
            <button 
              id="csv-import-button"
              onclick="executeCsvImport()" 
              class="w-full bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors"
              disabled>
              <i class="fas fa-upload mr-2"></i>CSVインポート実行
            </button>

            <!-- CSVインポート進行状況 -->
            <div id="csv-import-progress" class="mt-4" style="display:none;">
              <div class="bg-purple-50 border border-purple-200 rounded p-3">
                <div class="flex items-center">
                  <i class="fas fa-spinner fa-spin text-purple-600 mr-2"></i>
                  <span class="text-sm text-purple-700">CSVインポート中...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
      <script> 
                  onclick="closePreviewModal(); executeImport();" 
                  class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                  <i class="fas fa-upload mr-2"></i>インポート実行
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
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
          },
          getCurrentUser: async function() {
            try {
              const token = this.getToken();
              if (!token) return null;
              const response = await axios.get('/api/auth/me', {
                headers: { Authorization: \`Bearer \${token}\` }
              });
              return response.data.user;
            } catch (error) {
              console.error('Failed to get current user:', error);
              return null;
            }
          }
        };

        // 認証チェック
        AUTH_UTILS.checkAuth();
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + AUTH_UTILS.getToken();

        // ユーザー情報を取得
        async function loadUserInfo() {
          try {
            const user = await AUTH_UTILS.getCurrentUser();
            if (user) {
              document.getElementById('nav-user-name').textContent = user.name || user.email;
            }
          } catch (error) {
            console.error('ユーザー情報の取得に失敗しました:', error);
          }
        }

        // テーブル一覧を読み込み
        let availableTables = [];
        async function loadTables() {
          try {
            const response = await axios.get('/api/admin/data/tables');
            if (response.data.success) {
              availableTables = response.data.tables;
              renderTableCheckboxes();
              renderCsvTableSelect();
            }
          } catch (error) {
            console.error('テーブル一覧の取得に失敗しました:', error);
          }
        }

        // テーブルチェックボックスを描画
        function renderTableCheckboxes() {
          const container = document.getElementById('table-checkboxes');
          container.innerHTML = availableTables.map(table => \`
            <label class="flex items-center p-1 hover:bg-gray-50">
              <input type="checkbox" value="\${table.name}" checked class="mr-2 table-checkbox">
              <span class="text-sm">\${table.label}</span>
            </label>
          \`).join('');
        }

        // CSV単体インポート用のテーブルセレクトボックスを描画
        function renderCsvTableSelect() {
          const select = document.getElementById('csv-table-select');
          select.innerHTML = '<option value="">テーブルを選択してください</option>' + 
            availableTables.map(table => \`
              <option value="\${table.name}">\${table.label} (\${table.name})</option>
            \`).join('');
        }

        // エクスポートタイプの変更
        document.addEventListener('DOMContentLoaded', () => {
          loadUserInfo();
          loadTables();

          const exportTypeRadios = document.querySelectorAll('input[name="export-type"]');
          exportTypeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
              const tableSelection = document.getElementById('table-selection');
              if (e.target.value === 'selective') {
                tableSelection.style.display = 'block';
              } else {
                tableSelection.style.display = 'none';
              }
            });
          });
        });

        // エクスポート処理
        let selectedFile = null;
        async function exportData() {
          const exportType = document.querySelector('input[name="export-type"]:checked').value;
          const exportButton = document.getElementById('export-button');
          const exportProgress = document.getElementById('export-progress');

          try {
            exportButton.disabled = true;
            exportProgress.style.display = 'block';

            let url = '/api/admin/data/export/all';
            let params = {};

            if (exportType === 'selective') {
              const selectedTables = Array.from(document.querySelectorAll('.table-checkbox:checked'))
                .map(cb => cb.value);
              
              if (selectedTables.length === 0) {
                alert('エクスポートするテーブルを少なくとも1つ選択してください。');
                return;
              }

              url = '/api/admin/data/export/selective';
              const response = await axios.post(url, {
                tables: selectedTables,
                include_metadata: true
              }, {
                responseType: 'blob'
              });

              downloadBlob(response.data, \`backup_selective_\${new Date().toISOString().slice(0,10)}.zip\`);
            } else {
              const response = await axios.get(url, {
                responseType: 'blob'
              });

              downloadBlob(response.data, \`backup_all_\${new Date().toISOString().slice(0,10)}.zip\`);
            }

            alert('エクスポートが完了しました！');
          } catch (error) {
            console.error('エクスポートエラー:', error);
            alert('エクスポートに失敗しました: ' + (error.response?.data?.error || error.message));
          } finally {
            exportButton.disabled = false;
            exportProgress.style.display = 'none';
          }
        }

        // ファイル選択時の処理
        function handleFileSelect() {
          const fileInput = document.getElementById('import-file');
          const previewButton = document.getElementById('preview-button');
          const importButton = document.getElementById('import-button');

          if (fileInput.files && fileInput.files[0]) {
            selectedFile = fileInput.files[0];
            previewButton.disabled = false;
            importButton.disabled = false;
          } else {
            selectedFile = null;
            previewButton.disabled = true;
            importButton.disabled = true;
          }
        }

        // プレビュー処理
        async function previewImport() {
          if (!selectedFile) {
            alert('ファイルを選択してください。');
            return;
          }

          try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const response = await axios.post('/api/admin/data/import/preview', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (response.data.success) {
              displayPreview(response.data);
              document.getElementById('preview-modal').classList.remove('hidden');
            }
          } catch (error) {
            console.error('プレビューエラー:', error);
            alert('プレビューに失敗しました: ' + (error.response?.data?.error || error.message));
          }
        }

        // プレビュー表示
        function displayPreview(data) {
          const content = document.getElementById('preview-content');
          const metadata = data.metadata;
          const tables = data.tables_found || [];

          let html = \`
            <div class="mb-4 p-3 bg-gray-50 rounded">
              <h4 class="font-semibold mb-2">メタデータ</h4>
              <div class="text-sm space-y-1">
                <p><strong>エクスポート日時:</strong> \${metadata.exported_at}</p>
                <p><strong>エクスポート者:</strong> \${metadata.exported_by}</p>
                <p><strong>バージョン:</strong> \${metadata.version}</p>
              </div>
            </div>
          \`;

          if (data.warnings && data.warnings.length > 0) {
            html += \`
              <div class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <h4 class="font-semibold text-yellow-800 mb-2">
                  <i class="fas fa-exclamation-triangle mr-1"></i>警告
                </h4>
                <ul class="text-sm text-yellow-700 list-disc list-inside">
                  \${data.warnings.map(w => \`<li>\${w}</li>\`).join('')}
                </ul>
              </div>
            \`;
          }

          html += \`
            <div class="mb-4">
              <h4 class="font-semibold mb-2">インポート対象テーブル</h4>
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-2 text-left">テーブル名</th>
                      <th class="px-4 py-2 text-left">ラベル</th>
                      <th class="px-4 py-2 text-right">件数</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    \${tables.map(t => \`
                      <tr>
                        <td class="px-4 py-2">\${t.name}</td>
                        <td class="px-4 py-2">\${t.label}</td>
                        <td class="px-4 py-2 text-right">\${t.row_count}</td>
                      </tr>
                    \`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          \`;

          content.innerHTML = html;
        }

        // プレビューモーダルを閉じる
        function closePreviewModal() {
          document.getElementById('preview-modal').classList.add('hidden');
        }

        // インポート実行
        async function executeImport() {
          if (!selectedFile) {
            alert('ファイルを選択してください。');
            return;
          }

          const mode = document.getElementById('import-mode').value;
          const importButton = document.getElementById('import-button');
          const importProgress = document.getElementById('import-progress');

          // 確認ダイアログ
          const modeLabels = {
            'replace': 'Replace（上書き）',
            'append': 'Append（追加）',
            'merge': 'Merge（マージ）'
          };

          if (!confirm(\`\${modeLabels[mode]}モードでインポートを実行します。よろしいですか？\n\n※この操作は既存データに影響を与える可能性があります。\`)) {
            return;
          }

          try {
            importButton.disabled = true;
            importProgress.style.display = 'block';

            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('mode', mode);

            const response = await axios.post('/api/admin/data/import/execute', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 300000 // 5分タイムアウト
            });

            if (response.data.success) {
              displayImportResults(response.data);
            }
          } catch (error) {
            console.error('インポートエラー:', error);
            alert('インポートに失敗しました: ' + (error.response?.data?.error || error.message));
          } finally {
            importButton.disabled = false;
            importProgress.style.display = 'none';
          }
        }

        // インポート結果を表示
        function displayImportResults(data) {
          const results = data.results || [];
          let message = \`インポートが完了しました！\n\nモード: \${data.mode}\n\n\`;

          results.forEach(r => {
            message += \`\${r.label} (\${r.table}):\n\`;
            message += \`  - 追加: \${r.inserted}件\n\`;
            if (data.mode === 'merge') {
              message += \`  - 更新: \${r.updated}件\n\`;
            }
            if (r.errors > 0) {
              message += \`  - エラー: \${r.errors}件\n\`;
              if (r.error) {
                message += \`    エラー詳細: \${r.error}\n\`;
              }
            }
            message += \`\n\`;
          });

          alert(message);
          
          // ページをリロードして最新データを表示
          if (confirm('ページをリロードして最新のデータを表示しますか？')) {
            window.location.reload();
          }
        }

        // Blob をダウンロード
        function downloadBlob(blob, filename) {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }

        // CSV単体インポート: ファイル選択時の処理
        let selectedCsvFile = null;
        function handleCsvFileSelect() {
          const fileInput = document.getElementById('csv-file');
          const tableSelect = document.getElementById('csv-table-select');
          const csvImportButton = document.getElementById('csv-import-button');

          if (fileInput.files && fileInput.files[0] && tableSelect.value) {
            selectedCsvFile = fileInput.files[0];
            csvImportButton.disabled = false;
          } else {
            selectedCsvFile = null;
            csvImportButton.disabled = true;
          }
        }

        // CSV単体インポート: テーブル選択時の処理
        document.addEventListener('DOMContentLoaded', () => {
          const csvTableSelect = document.getElementById('csv-table-select');
          csvTableSelect.addEventListener('change', handleCsvFileSelect);
        });

        // CSV単体インポート: 実行
        async function executeCsvImport() {
          const tableSelect = document.getElementById('csv-table-select');
          const tableName = tableSelect.value;

          if (!tableName) {
            alert('インポート先のテーブルを選択してください。');
            return;
          }

          if (!selectedCsvFile) {
            alert('CSVファイルを選択してください。');
            return;
          }

          const mode = document.getElementById('csv-import-mode').value;
          const csvImportButton = document.getElementById('csv-import-button');
          const csvImportProgress = document.getElementById('csv-import-progress');

          // 確認ダイアログ
          const modeLabels = {
            'replace': 'Replace（上書き）',
            'append': 'Append（追加）',
            'merge': 'Merge（マージ）'
          };

          const tableLabel = availableTables.find(t => t.name === tableName)?.label || tableName;

          if (!confirm(\`\${tableLabel}テーブルに\${modeLabels[mode]}モードでCSVインポートを実行します。よろしいですか？\n\n※この操作は既存データに影響を与える可能性があります。\`)) {
            return;
          }

          try {
            csvImportButton.disabled = true;
            csvImportProgress.style.display = 'block';

            const formData = new FormData();
            formData.append('file', selectedCsvFile);
            formData.append('table_name', tableName);
            formData.append('mode', mode);

            const response = await axios.post('/api/admin/data/import/csv', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 300000 // 5分タイムアウト
            });

            if (response.data.success) {
              const result = response.data.result;
              let message = \`CSVインポートが完了しました！\n\nテーブル: \${result.label} (\${result.table})\nモード: \${modeLabels[mode]}\n\n\`;
              message += \`  - 追加: \${result.inserted}件\n\`;
              if (mode === 'merge') {
                message += \`  - 更新: \${result.updated}件\n\`;
              }
              if (result.errors > 0) {
                message += \`  - エラー: \${result.errors}件\n\`;
                if (result.error) {
                  message += \`    エラー詳細: \${result.error}\n\`;
                }
              }

              alert(message);
              
              // ページをリロードして最新データを表示
              if (confirm('ページをリロードして最新のデータを表示しますか？')) {
                window.location.reload();
              }
            }
          } catch (error) {
            console.error('CSVインポートエラー:', error);
            const errorMessage = error.response?.data?.details?.message || error.response?.data?.error || error.message;
            alert('CSVインポートに失敗しました: ' + errorMessage);
          } finally {
            csvImportButton.disabled = false;
            csvImportProgress.style.display = 'none';
          }
        }
      </script>
    </body>
    </html>
  `)
})

export default app
