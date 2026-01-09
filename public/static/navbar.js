// 共通ナビゲーションバーを生成する関数

const NAVBAR = {
  // ナビゲーションバーのHTMLを生成
  getHTML: function(currentUser) {
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    return `
      <nav class="bg-white shadow-sm border-b border-gray-200 mb-6">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <!-- 左側: ロゴとメインメニュー -->
            <div class="flex items-center space-x-8">
              <a href="/" class="flex items-center">
                <i class="fas fa-chart-line text-2xl text-blue-600 mr-2"></i>
                <span class="text-xl font-semibold text-gray-800">SFA システム</span>
              </a>
              
              <div class="hidden md:flex space-x-4">
                <a href="/" class="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">
                  <i class="fas fa-home mr-1"></i>ダッシュボード
                </a>
                <a href="/leads" class="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">
                  <i class="fas fa-users mr-1"></i>リード
                </a>
                <a href="/contracts" class="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">
                  <i class="fas fa-file-contract mr-1"></i>契約
                </a>
                <a href="/monthly-list" class="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">
                  <i class="fas fa-calendar-alt mr-1"></i>月次明細
                </a>
                <a href="/members" class="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">
                  <i class="fas fa-user-tie mr-1"></i>メンバー
                </a>
              </div>
            </div>
            
            <!-- 右側: ユーザーメニュー -->
            <div class="flex items-center space-x-4">
              <span class="text-gray-700 text-sm">
                <i class="fas fa-user-circle mr-1"></i>
                <span id="navbar-user-name">${currentUser ? currentUser.name : ''}</span>
              </span>
              
              <a href="/profile" class="text-gray-600 hover:text-blue-600 text-sm">
                <i class="fas fa-user-cog mr-1"></i>プロフィール
              </a>
              
              ${isAdmin ? `
              <a href="/admin/users" class="text-gray-600 hover:text-blue-600 text-sm">
                <i class="fas fa-users-cog mr-1"></i>ユーザー管理
              </a>
              ` : ''}
              
              <button onclick="AUTH_UTILS.logout()" class="text-red-600 hover:text-red-700 text-sm">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>
    `;
  },
  
  // ナビゲーションバーを挿入
  render: async function(containerId = 'navbar-container') {
    const user = await AUTH_UTILS.getCurrentUser();
    if (!user) return;
    
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = this.getHTML(user);
    }
  },
  
  // 権限に応じてボタンの表示/非表示を制御
  toggleButtonByPermission: function(buttonId, permission, user) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    if (AUTH_UTILS.hasPermission(user, permission)) {
      button.style.display = '';
    } else {
      button.style.display = 'none';
    }
  },
  
  // 権限エラーメッセージを表示
  showPermissionError: function(requiredPermission) {
    const label = AUTH_UTILS.PERMISSION_LABELS[requiredPermission] || requiredPermission;
    alert(`この操作を行う権限がありません。\n必要な権限: ${label}\n\n管理者に権限の付与を依頼してください。`);
  }
};
