import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

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
            // member_manage権限チェック（管理者 または member_manage権限保有者）
            const hasMemberManage = user.role === 'admin' || (user.permissions && user.permissions.includes('member_manage'));
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
            // 追加ボタン・編集/無効化ボタンを member_manage 権限保有者にも表示
            const addMemberButton = document.getElementById('add-member-button');
            if (addMemberButton) {
              addMemberButton.style.display = hasMemberManage ? '' : 'none';
            }
            const memberActionButtons = document.querySelectorAll('.member-manage-only');
            memberActionButtons.forEach(function(btn) {
              btn.style.display = hasMemberManage ? '' : 'none';
            });
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
            <button onclick="openAddMemberModal()" id="add-member-button" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" style="display: none;">
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
                            class="text-blue-600 hover:text-blue-800 mr-3 member-manage-only" style="display: none;">
                      <i class="fas fa-edit mr-1"></i>編集
                    </button>
                    <button onclick="confirmDeleteMember(${member.id}, '${member.name.replace(/'/g, "\\'")}');" 
                            class="text-red-600 hover:text-red-800 admin-only-column" style="display: none;">
                      <i class="fas fa-trash mr-1"></i>削除
                    </button>
                    <button onclick="toggleMemberStatus(${member.id}, '${member.status}')" 
                            class="text-${member.status === 'active' ? 'red' : 'green'}-600 hover:text-${member.status === 'active' ? 'red' : 'green'}-800 mr-3 member-manage-only" style="display: none;">
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


export default app
