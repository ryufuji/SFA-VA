// 共通HTMLテンプレート関数

/**
 * HTML <head> タグ生成
 */
export function htmlHead(title: string, extraHead: string = ''): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - SFA</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  ${extraHead}
</head>`
}

/**
 * ナビゲーションメニュー項目定義
 */
const NAV_ITEMS = [
  { href: '/', icon: 'fa-home', label: 'ダッシュボード', key: 'dashboard' },
  { href: '/leads', icon: 'fa-users', label: 'リード', key: 'leads' },
  { href: '/projects', icon: 'fa-briefcase', label: '案件', key: 'projects' },
  { href: '/contracts', icon: 'fa-file-contract', label: '契約', key: 'contracts' },
  { href: '/details', icon: 'fa-list-alt', label: '詳細一覧', key: 'details' },
  { href: '/bank-deposits', icon: 'fa-cash-register', label: '入金消込', key: 'bank-deposits' },
]

/**
 * グローバルナビゲーションバー生成
 * @param activePage - ハイライトするページキー
 */
export function navbar(activePage: string = ''): string {
  const navLinks = NAV_ITEMS.map(item => {
    const isActive = item.key === activePage
    const classes = isActive
      ? 'border-blue-500 text-blue-600 inline-flex items-center px-1 pt-1 border-b-2 font-semibold'
      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2'
    return `<a href="${item.href}" class="${classes}"><i class="fas ${item.icon} mr-2"></i>${item.label}</a>`
  }).join('\n                ')

  return `
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
              ${navLinks}
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
    </nav>`
}

/**
 * 共通のスクリプトタグ（axios + 認証チェック）
 */
export function commonScripts(): string {
  return `
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
      // 認証チェック
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
            const response = await axios.get('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } });
            return response.data.user;
          } catch (error) {
            if (error.response?.status === 401) { localStorage.removeItem('jwt_token'); window.location.href = '/login'; }
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
            try { await axios.post('/api/auth/logout', {}, { headers: { 'Authorization': 'Bearer ' + token } }); } catch(e) {}
          }
          localStorage.removeItem('jwt_token');
          document.cookie = 'jwt_token=; path=/; max-age=0; SameSite=Lax';
          window.location.href = '/login';
        },
        setupAxios: function() {
          const token = this.getToken();
          if (token) { axios.defaults.headers.common['Authorization'] = 'Bearer ' + token; }
        },
        PERMISSION_LABELS: {
          'lead_manage': 'リード・案件の登録/更新',
          'contract_manage': '契約の登録/更新',
          'billing_manage': '請求管理',
          'payment_manage': '入金の登録',
          'member_manage': 'メンバー管理'
        }
      };

      AUTH_UTILS.checkAuth();
      AUTH_UTILS.setupAxios();

      async function loadUserInfo() {
        try {
          const user = await AUTH_UTILS.getCurrentUser();
          if (user) {
            const nameEl = document.getElementById('nav-user-name');
            if (nameEl) nameEl.textContent = user.name || user.email;
          }
        } catch(e) { console.error('ユーザー情報の読み込みに失敗:', e); }
      }
      loadUserInfo();
    </script>`
}

/**
 * ページ全体テンプレート
 * @param title - ページタイトル（" - SFA" が自動付与）
 * @param activePage - ナビゲーションのアクティブページキー
 * @param bodyContent - メインコンテンツHTML
 * @param scripts - 追加のスクリプトHTML（commonScriptsの後に挿入）
 * @param options - 追加オプション
 */
export function pageLayout(
  title: string,
  activePage: string,
  bodyContent: string,
  scripts: string = '',
  options: { extraHead?: string; bodyClass?: string; noNav?: boolean; noAuth?: boolean } = {}
): string {
  const bodyClass = options.bodyClass || 'bg-gray-100'
  const nav = options.noNav ? '' : navbar(activePage)
  const authScripts = options.noAuth ? '' : commonScripts()

  return `${htmlHead(title, options.extraHead || '')}
<body class="${bodyClass}">
  ${nav}
  ${bodyContent}
  ${authScripts}
  ${scripts}
</body>
</html>`
}
