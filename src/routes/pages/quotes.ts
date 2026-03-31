import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

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
                                    <span style="font-size: 12px; color: #1a1a1a;">\${quote.quote_number}</span>
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
                                <!-- ★ 金額列: 7桁以上対応のため 100px→130px、単価も 96px→120px に拡大 -->
                                <table style="width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed;">
                                    <colgroup>
                                        <col style="width: auto;">
                                        <col style="width: 48px;">
                                        <col style="width: 40px;">
                                        <col style="width: 120px;">
                                        <col style="width: 52px;">
                                        <col style="width: 130px;">
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
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: right; font-weight: 500; white-space: nowrap; overflow: visible;">¥\${(item.unit_price || 0).toLocaleString()}</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 6px; text-align: right; font-weight: 500;">\${((item.workload || 1.0) * 100).toFixed(0)}%</td>
                                                <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #1a1a1a; white-space: nowrap; overflow: visible;">¥\${(item.amount || 0).toLocaleString()}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                    <tfoot>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="5" style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #1a1a1a;">小計</td>
                                            <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 700; color: #1a1a1a; white-space: nowrap; overflow: visible;">¥\${(quote.subtotal || 0).toLocaleString()}</td>
                                        </tr>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="5" style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 600; color: #666;">消費税(10%)</td>
                                            <td style="border: 1px solid #e0e0e0; padding: 7px 8px; text-align: right; font-weight: 700; color: #666; white-space: nowrap; overflow: visible;">¥\${(quote.tax || 0).toLocaleString()}</td>
                                        </tr>
                                        <tr style="background: #4a90e2; color: white;">
                                            <td colspan="5" style="border: 1px solid #3a7bc8; padding: 9px 8px; text-align: right; font-weight: 700; font-size: 13px;">合計金額</td>
                                            <td style="border: 1px solid #3a7bc8; padding: 9px 8px; text-align: right; font-weight: 700; font-size: 13px; white-space: nowrap; overflow: visible;">¥\${(quote.total || 0).toLocaleString()}</td>
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


export default app
