/**
 * 認証ユーティリティ (全ページ共通)
 * 使用方法: <script src="/static/auth.js"></script> を <head> に追加
 * 前提: axios が先に読み込まれていること
 */
const AUTH_UTILS = {
  // トークンを取得
  getToken: function() {
    return localStorage.getItem('jwt_token');
  },
  
  // ログイン状態をチェック（未ログインならログイン画面へリダイレクト）
  checkAuth: function() {
    const token = this.getToken();
    if (!token) {
      window.location.href = '/login';
      return false;
    }
    return true;
  },
  
  // ユーザー情報を取得
  getCurrentUser: async function() {
    const token = this.getToken();
    if (!token) return null;
    
    try {
      const response = await axios.get('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      return response.data.user;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.removeItem('jwt_token');
        window.location.href = '/login';
      }
      return null;
    }
  },
  
  // 権限チェック
  hasPermission: function(user, permission) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions && user.permissions.includes(permission);
  },
  
  // 複数権限のいずれかを持っているかチェック
  hasAnyPermission: function(user, permissions) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return permissions.some(function(p) { return user.permissions && user.permissions.includes(p); });
  },
  
  // ログアウト
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
  
  // Axiosのデフォルトヘッダーを設定
  setupAxios: function() {
    const token = this.getToken();
    if (token) {
      axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
    }
  },
  
  // 権限ラベル
  PERMISSION_LABELS: {
    'lead_manage': 'リード・案件の登録/更新',
    'contract_manage': '契約の登録/更新',
    'billing_manage': '請求管理',
    'payment_manage': '入金の登録',
    'member_manage': 'メンバー管理'
  },

  /**
   * ページ初期化（共通セットアップ処理）
   * - 認証チェック
   * - Axiosヘッダー設定
   * - ユーザー情報取得＆ナビバーユーザー名設定
   * - admin判定
   * @returns {Promise<Object|null>} ユーザーオブジェクト
   */
  initPage: async function() {
    this.checkAuth();
    this.setupAxios();
    const user = await this.getCurrentUser();
    if (user) {
      // nav-user-name を全て更新
      document.querySelectorAll('#nav-user-name, .nav-user-name').forEach(function(el) {
        el.textContent = user.name;
      });
      // admin メニュー表示制御
      if (user.role === 'admin') {
        document.querySelectorAll('.admin-only, #admin-menu').forEach(function(el) {
          el.style.display = '';
        });
      }
    }
    return user;
  },

  // 権限エラーメッセージを表示
  showPermissionError: function(requiredPermission) {
    var label = this.PERMISSION_LABELS[requiredPermission] || requiredPermission;
    alert('この操作を行う権限がありません。\n必要な権限: ' + label + '\n\n管理者に権限の付与を依頼してください。');
  }
};
