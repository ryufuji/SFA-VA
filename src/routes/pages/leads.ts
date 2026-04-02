import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

app.get('/leads', async (c) => {
  const { DB } = c.env
  
  // クエリパラメータからソート情報を取得
  const sortBy = c.req.query('sortBy') || 'created_at'
  const sortOrder = c.req.query('sortOrder') || 'DESC'
  
  // フィルターパラメータを取得
  const filterCompany = c.req.query('filterCompany') || ''
  const filterDepartment = c.req.query('filterDepartment') || ''
  const filterStatus = c.req.query('filterStatus') || ''
  
  // ソート可能なカラムのホワイトリスト
  const allowedSortColumns = ['company_name', 'department', 'project_count', 'earliest_contract', 'latest_contract', 'status', 'created_at']
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  
  // フィルター条件を構築
  const conditions: string[] = []
  const params: any[] = []
  if (filterCompany) {
    conditions.push("l.company_name LIKE ?")
    params.push(`%${filterCompany}%`)
  }
  if (filterDepartment) {
    conditions.push("l.department LIKE ?")
    params.push(`%${filterDepartment}%`)
  }
  if (filterStatus) {
    conditions.push("l.status = ?")
    params.push(filterStatus)
  }
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  
  // リード一覧と関連する案件数、契約情報を取得
  const stmt = DB.prepare(`
    SELECT 
      l.*,
      COUNT(DISTINCT p.id) as project_count,
      MIN(md.target_month) as earliest_contract,
      MAX(md.target_month) as latest_contract
    FROM leads l
    LEFT JOIN projects p ON l.id = p.lead_id
    LEFT JOIN contracts c ON p.id = c.project_id
    LEFT JOIN monthly_details md ON c.id = md.contract_id
    ${whereClause}
    GROUP BY l.id, l.company_name, l.department, l.contact_person, l.email, l.phone, l.status, l.memo, l.created_at, l.updated_at
    ORDER BY ${sortColumn} ${order}
  `)
  const { results: leads } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all()
  
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
      <script src="/static/auth.js"></script>
      <script>
        
        // ソート機能
        function sortTable(column) {
          const urlParams = new URLSearchParams(window.location.search);
          const currentSort = urlParams.get('sortBy');
          const currentOrder = urlParams.get('sortOrder') || 'DESC';
          
          let newOrder = 'ASC';
          if (currentSort === column && currentOrder === 'ASC') {
            newOrder = 'DESC';
          }
          
          urlParams.set('sortBy', column);
          urlParams.set('sortOrder', newOrder);
          window.location.href = '/leads?' + urlParams.toString();
        }

        function applyFilter() {
          const params = new URLSearchParams();
          const company = document.getElementById('filter-company').value.trim();
          const department = document.getElementById('filter-department').value.trim();
          const status = document.getElementById('filter-status').value;
          if (company) params.set('filterCompany', company);
          if (department) params.set('filterDepartment', department);
          if (status) params.set('filterStatus', status);
          window.location.href = '/leads?' + params.toString();
        }

        function resetFilter() {
          window.location.href = '/leads';
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

      <div class="max-w-full mx-auto py-6 sm:px-6 lg:px-8">
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

        <!-- フィルターバー -->
        <div class="bg-white p-4 rounded-lg shadow mb-4">
          <div class="flex flex-wrap gap-3 items-end">
            <div class="flex-1 min-w-[180px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">会社名</label>
              <input type="text" id="filter-company" value="${filterCompany}" placeholder="検索..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" onkeydown="if(event.key==='Enter')applyFilter()">
            </div>
            <div class="flex-1 min-w-[180px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">部署名</label>
              <input type="text" id="filter-department" value="${filterDepartment}" placeholder="検索..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" onkeydown="if(event.key==='Enter')applyFilter()">
            </div>
            <div class="min-w-[150px]">
              <label class="block text-xs font-medium text-gray-500 mb-1">ステータス</label>
              <select id="filter-status" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">すべて</option>
                <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>アクティブ</option>
                <option value="archived" ${filterStatus === 'archived' ? 'selected' : ''}>アーカイブ</option>
              </select>
            </div>
            <div class="flex gap-2">
              <button onclick="applyFilter()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"><i class="fas fa-search mr-1"></i>検索</button>
              <button onclick="resetFilter()" class="text-gray-600 px-4 py-2 rounded text-sm border border-gray-300 hover:bg-gray-50"><i class="fas fa-times mr-1"></i>リセット</button>
            </div>
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
      <script src="/static/auth.js"></script>
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

      <div class="max-w-full mx-auto py-6 sm:px-6 lg:px-8">
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
      <script src="/static/auth.js"></script>
      <script>
        // AUTH_UTILS - 認証ユーティリティ

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


export default app
