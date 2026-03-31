import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

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
      <script src="/static/auth.js"></script>
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
      <script src="/static/auth.js"></script>
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
      <script src="/static/auth.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
      <script>
        // AUTH_UTILS - 認証ユーティリティ

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
