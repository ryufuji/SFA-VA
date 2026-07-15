import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

// ============================================================
// 電子署名 管理ページ（自社担当者用・要ログイン）
// URL: /contracts/:id/esign
// ※認証はフロントの auth.js（checkAuth）で担保し、
//   データ取得APIはJWT必須のため未ログインでは何も表示されない
// ============================================================
app.get('/contracts/:id/esign', async (c) => {
  const id = c.req.param('id')

  const contract = await c.env.DB.prepare(`
    SELECT c.*, p.project_name, l.company_name
    FROM contracts c
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN leads l ON p.lead_id = l.id
    WHERE c.id = ?
  `).bind(id).first() as any

  if (!contract) return c.notFound()

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>電子署名管理 - ${contract.contract_name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="/static/auth.js"></script>
</head>
<body class="bg-gray-100">
  <div class="max-w-5xl mx-auto p-4 md:p-8">
    <!-- パンくず -->
    <div class="mb-4 text-sm text-gray-500">
      <a href="/contracts" class="hover:text-blue-600">契約一覧</a>
      <i class="fas fa-chevron-right mx-2 text-xs"></i>
      <a href="/contracts/${id}" class="hover:text-blue-600">${contract.contract_name}</a>
      <i class="fas fa-chevron-right mx-2 text-xs"></i>
      <span class="text-gray-700">電子署名管理</span>
    </div>

    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-file-signature text-blue-600 mr-2"></i>電子署名管理
      </h1>
      <p class="text-gray-500 mt-1">${contract.company_name || ''} / ${contract.project_name || ''}</p>
    </header>

    <!-- 契約書作成 -->
    <section class="bg-white rounded-lg shadow-md mb-6">
      <div class="border-b px-6 py-4">
        <h2 class="text-lg font-semibold text-gray-800"><i class="fas fa-file-circle-plus mr-2 text-gray-500"></i>1. 契約書を作成</h2>
      </div>
      <div class="p-6">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">契約書タイトル <span class="text-red-500">*</span></label>
          <input id="doc-title" type="text" class="w-full border rounded px-3 py-2" value="${contract.contract_name} 契約書">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">作成方法</label>
          <div class="flex gap-4">
            <label class="flex items-center cursor-pointer"><input type="radio" name="source-type" value="text" checked class="mr-2">アプリ内でテキスト作成</label>
            <label class="flex items-center cursor-pointer"><input type="radio" name="source-type" value="pdf" class="mr-2">PDFをアップロード</label>
          </div>
        </div>
        <div id="text-input-area" class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">契約書本文 <span class="text-red-500">*</span></label>
          <textarea id="doc-body" rows="10" class="w-full border rounded px-3 py-2 font-mono text-sm" placeholder="契約書の全文を入力してください。">${''}</textarea>
        </div>
        <div id="pdf-input-area" class="mb-4 hidden">
          <label class="block text-sm font-medium text-gray-700 mb-1">契約書PDF <span class="text-red-500">*</span></label>
          <input id="doc-pdf" type="file" accept="application/pdf" class="w-full border rounded px-3 py-2 bg-white">
          <p class="text-xs text-gray-400 mt-1">※PDFはアップロード時に確定され、以後変更できません（改ざん検知のためハッシュを記録）。</p>
        </div>
        <button id="btn-create-doc" class="px-5 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          <i class="fas fa-lock mr-1"></i>契約書を確定して作成
        </button>
        <p id="create-error" class="hidden text-red-500 text-sm mt-3"></p>
      </div>
    </section>

    <!-- 作成済み契約書と署名依頼 -->
    <section class="bg-white rounded-lg shadow-md">
      <div class="border-b px-6 py-4">
        <h2 class="text-lg font-semibold text-gray-800"><i class="fas fa-list-check mr-2 text-gray-500"></i>2. 契約書と署名依頼</h2>
      </div>
      <div id="docs-list" class="p-6">
        <div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...</div>
      </div>
    </section>
  </div>

  <!-- 署名依頼モーダル -->
  <div id="request-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
      <h3 class="text-lg font-semibold mb-4"><i class="fas fa-paper-plane mr-2 text-blue-600"></i>署名依頼の発行</h3>
      <input type="hidden" id="req-document-id">
      <div class="mb-3">
        <label class="block text-sm font-medium text-gray-700 mb-1">署名者氏名 <span class="text-red-500">*</span></label>
        <input id="req-signer-name" type="text" class="w-full border rounded px-3 py-2" placeholder="例：山田 太郎">
      </div>
      <div class="mb-3">
        <label class="block text-sm font-medium text-gray-700 mb-1">署名者メール <span class="text-red-500">*</span></label>
        <input id="req-signer-email" type="email" class="w-full border rounded px-3 py-2" placeholder="client@example.com">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">有効期限（日数）</label>
        <input id="req-expires-days" type="number" value="14" min="1" max="90" class="w-full border rounded px-3 py-2">
      </div>
      <div class="flex gap-3">
        <button id="btn-send-request" class="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">発行する</button>
        <button id="btn-close-modal" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">閉じる</button>
      </div>
      <div id="sign-url-result" class="hidden mt-4 p-3 bg-blue-50 rounded text-sm">
        <p class="font-medium text-gray-700 mb-1"><i class="fas fa-link mr-1"></i>署名URL（クライアントへ送付してください）</p>
        <div class="flex gap-2">
          <input id="sign-url-text" type="text" readonly class="flex-1 border rounded px-2 py-1 text-xs bg-white">
          <button id="btn-copy-url" class="px-3 py-1 bg-gray-700 text-white rounded text-xs">コピー</button>
        </div>
        <p class="text-xs text-gray-500 mt-2">※現段階ではメール自動送信は未接続です。このURLを手動で送付してください。</p>
      </div>
      <p id="request-error" class="hidden text-red-500 text-sm mt-3"></p>
    </div>
  </div>

  <!-- 証跡モーダル -->
  <div id="audit-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold"><i class="fas fa-clipboard-list mr-2 text-green-600"></i>合意証跡（監査ログ）</h3>
        <button id="btn-close-audit" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-xl"></i></button>
      </div>
      <div id="audit-content"></div>
    </div>
  </div>

  <script>
    const CONTRACT_ID = ${id};
    const $ = (id) => document.getElementById(id);

    // 作成方法の切り替え
    document.addEventListener('change', (e) => {
      if (e.target.name === 'source-type') {
        const isText = e.target.value === 'text';
        $('text-input-area').classList.toggle('hidden', !isText);
        $('pdf-input-area').classList.toggle('hidden', isText);
      }
    });

    function getSourceType() {
      return document.querySelector('input[name="source-type"]:checked').value;
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // 契約書作成
    async function createDocument() {
      const title = $('doc-title').value.trim();
      const sourceType = getSourceType();
      $('create-error').classList.add('hidden');
      if (!title) { showCreateError('タイトルを入力してください'); return; }

      const payload = { contract_id: CONTRACT_ID, title, source_type: sourceType };
      if (sourceType === 'text') {
        const body = $('doc-body').value;
        if (!body.trim()) { showCreateError('契約書本文を入力してください'); return; }
        payload.document_body = body;
      } else {
        const file = $('doc-pdf').files[0];
        if (!file) { showCreateError('PDFファイルを選択してください'); return; }
        payload.pdf_base64 = await fileToBase64(file);
      }

      const btn = $('btn-create-doc');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>作成中...';
      try {
        await axios.post('/api/esign/documents', payload);
        $('doc-body').value = '';
        if ($('doc-pdf')) $('doc-pdf').value = '';
        await loadDocs();
      } catch (e) {
        showCreateError(e.response?.data?.error || '作成に失敗しました');
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-1"></i>契約書を確定して作成';
      }
    }
    function showCreateError(msg) { $('create-error').textContent = msg; $('create-error').classList.remove('hidden'); }

    const STATUS_LABEL = { draft: '下書き', sent: '送信済み', signed: '合意済み', declined: '拒否', expired: '期限切れ', pending: '未署名' };
    const STATUS_COLOR = { draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', signed: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700', expired: 'bg-orange-100 text-orange-700', pending: 'bg-yellow-100 text-yellow-700' };

    // 一覧の読み込み
    async function loadDocs() {
      const el = $('docs-list');
      try {
        const res = await axios.get('/api/esign/contracts/' + CONTRACT_ID + '/documents');
        const docs = res.data.data || [];
        if (docs.length === 0) {
          el.innerHTML = '<div class="text-gray-400 text-center py-8">まだ契約書がありません。上の「契約書を作成」から始めてください。</div>';
          return;
        }
        let html = '';
        docs.forEach(function(d) {
          let reqHtml = '';
          (d.signature_requests || []).forEach(function(r) {
            reqHtml += '<div class="flex flex-wrap items-center justify-between border-t py-2 text-sm gap-2">'
              + '<div><i class="fas fa-user text-gray-400 mr-1"></i>' + esc(r.signer_name) + ' <span class="text-gray-400 text-xs">' + esc(r.signer_email) + '</span>'
              + ' <span class="text-xs px-2 py-0.5 rounded ' + (STATUS_COLOR[r.status]||'') + '">' + (STATUS_LABEL[r.status]||r.status) + '</span></div>'
              + '<div class="flex gap-2">'
              + '<button onclick="showAudit(' + r.id + ')" class="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"><i class="fas fa-clipboard-list mr-1"></i>証跡</button>'
              + (r.status === 'pending' ? '<button onclick="cancelRequest(' + r.id + ')" class="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">取消</button>' : '')
              + '</div></div>';
          });
          html += '<div class="border rounded-lg mb-4">'
            + '<div class="flex flex-wrap items-center justify-between px-4 py-3 bg-gray-50 rounded-t-lg gap-2">'
            + '<div><span class="font-medium text-gray-800">' + esc(d.title) + '</span>'
            + ' <span class="text-xs px-2 py-0.5 rounded ' + (STATUS_COLOR[d.status]||'') + '">' + (STATUS_LABEL[d.status]||d.status) + '</span>'
            + ' <span class="text-xs text-gray-400 ml-1">' + (d.source_type === 'pdf' ? 'PDF' : 'テキスト') + '</span></div>'
            + '<button onclick="openRequestModal(' + d.id + ')" class="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"><i class="fas fa-paper-plane mr-1"></i>署名依頼</button>'
            + '</div>'
            + '<div class="px-4 py-2">'
            + '<div class="text-xs text-gray-400 mb-1 font-mono break-all"><i class="fas fa-shield-halved mr-1"></i>' + esc(d.content_hash) + '</div>'
            + (reqHtml || '<div class="text-sm text-gray-400 py-2">署名依頼はまだありません</div>')
            + '</div></div>';
        });
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<div class="text-red-500 text-center py-8">読み込みに失敗しました</div>';
      }
    }
    function esc(s){ const d=document.createElement('div'); d.textContent = s==null?'':String(s); return d.innerHTML; }

    // 署名依頼モーダル
    function openRequestModal(docId) {
      $('req-document-id').value = docId;
      $('req-signer-name').value = '';
      $('req-signer-email').value = '';
      $('req-expires-days').value = '14';
      $('sign-url-result').classList.add('hidden');
      $('request-error').classList.add('hidden');
      $('request-modal').classList.remove('hidden');
    }
    window.openRequestModal = openRequestModal;

    async function sendRequest() {
      const docId = $('req-document-id').value;
      const signer_name = $('req-signer-name').value.trim();
      const signer_email = $('req-signer-email').value.trim();
      const expires_days = parseInt($('req-expires-days').value) || 14;
      $('request-error').classList.add('hidden');
      if (!signer_name || !signer_email) { $('request-error').textContent = '氏名とメールは必須です'; $('request-error').classList.remove('hidden'); return; }
      const btn = $('btn-send-request');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        const res = await axios.post('/api/esign/documents/' + docId + '/requests', { signer_name, signer_email, expires_days });
        $('sign-url-text').value = res.data.data.sign_url;
        $('sign-url-result').classList.remove('hidden');
        await loadDocs();
      } catch (e) {
        $('request-error').textContent = e.response?.data?.error || '発行に失敗しました';
        $('request-error').classList.remove('hidden');
      } finally {
        btn.disabled = false; btn.innerHTML = '発行する';
      }
    }

    async function cancelRequest(reqId) {
      if (!confirm('この署名依頼を取り消します。よろしいですか？')) return;
      try { await axios.post('/api/esign/requests/' + reqId + '/cancel'); await loadDocs(); }
      catch (e) { alert('取消に失敗しました'); }
    }
    window.cancelRequest = cancelRequest;

    // 証跡モーダル
    async function showAudit(reqId) {
      $('audit-modal').classList.remove('hidden');
      $('audit-content').innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin"></i></div>';
      try {
        const res = await axios.get('/api/esign/requests/' + reqId + '/audit-logs');
        const { request, logs } = res.data.data;
        const evLabel = { viewed: '閲覧', agreed: '合意', declined: '拒否' };
        let html = '<div class="mb-4 text-sm bg-gray-50 rounded p-3">'
          + '<div>署名者: <strong>' + esc(request.signer_name) + '</strong>（' + esc(request.signer_email) + '）</div>'
          + '<div>ステータス: ' + (STATUS_LABEL[request.status]||request.status) + '</div>'
          + (request.signed_at ? '<div>合意日時: ' + esc(request.signed_at) + '</div>' : '')
          + '<div class="text-xs text-gray-400 mt-1 font-mono break-all">文書ハッシュ: ' + esc(request.document_hash) + '</div>'
          + '</div>';
        html += '<table class="w-full text-sm border"><thead class="bg-gray-100"><tr>'
          + '<th class="px-2 py-1 text-left">日時</th><th class="px-2 py-1 text-left">操作</th><th class="px-2 py-1 text-left">氏名入力</th><th class="px-2 py-1 text-left">IP</th></tr></thead><tbody>';
        if (logs.length === 0) html += '<tr><td colspan="4" class="text-center py-3 text-gray-400">ログなし</td></tr>';
        logs.forEach(function(l) {
          html += '<tr class="border-t"><td class="px-2 py-1">' + esc(l.event_at) + '</td>'
            + '<td class="px-2 py-1">' + (evLabel[l.event_type]||l.event_type) + '</td>'
            + '<td class="px-2 py-1">' + esc(l.signer_input_name || '-') + '</td>'
            + '<td class="px-2 py-1 text-xs text-gray-500">' + esc(l.ip_address || '-') + '</td></tr>';
        });
        html += '</tbody></table>';
        $('audit-content').innerHTML = html;
      } catch (e) {
        $('audit-content').innerHTML = '<div class="text-red-500 text-center py-8">読み込みに失敗しました</div>';
      }
    }
    window.showAudit = showAudit;

    // イベント登録
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btn-create-doc')) createDocument();
      if (e.target.closest('#btn-send-request')) sendRequest();
      if (e.target.closest('#btn-close-modal')) $('request-modal').classList.add('hidden');
      if (e.target.closest('#btn-close-audit')) $('audit-modal').classList.add('hidden');
      if (e.target.closest('#btn-copy-url')) {
        $('sign-url-text').select();
        navigator.clipboard.writeText($('sign-url-text').value);
        e.target.closest('#btn-copy-url').textContent = 'コピー済';
      }
    });

    document.addEventListener('DOMContentLoaded', function() {
      AUTH_UTILS.checkAuth();
      AUTH_UTILS.setupAxios();
      loadDocs();
    });
  </script>
</body>
</html>
  `)
})

export default app
