// 認証チェック用のユーティリティ関数

const AUTH_UTILS = {
  // トークンを取得
  getToken: function() {
    return localStorage.getItem('jwt_token');
  },
  
  // ログイン状態をチェック
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
      if (error.response?.status === 401) {
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
    return permissions.some(p => this.hasPermission(user, p));
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
    'inspection_manage': '検収・請求の更新',
    'payment_manage': '入金の登録'
  }
};

// ナビゲーションバーユーティリティ
const NAVBAR = {
  showPermissionError: function(requiredPermission) {
    const label = AUTH_UTILS.PERMISSION_LABELS[requiredPermission] || requiredPermission;
    alert('この操作を行う権限がありません。\n必要な権限: ' + label + '\n\n管理者に権限の付与を依頼してください。');
  }
};
