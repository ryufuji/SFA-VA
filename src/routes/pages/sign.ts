import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

const app = new Hono<AppEnv>()

// ============================================================
// 公開署名ページ（クライアント用・ログイン不要）
// URL: /sign/:token
// 認証ミドルウェアは通さない（トークンで本人特定）
// ============================================================
app.get('/sign/:token', async (c) => {
  const token = c.req.param('token')

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>契約書の確認・合意 - 電子署名</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="max-w-3xl mx-auto p-4 md:p-8">
    <!-- ヘッダー -->
    <header class="text-center mb-6">
      <h1 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-file-signature text-blue-600 mr-2"></i>契約書の確認・合意
      </h1>
      <p class="text-sm text-gray-500 mt-1">内容をご確認の上、合意手続きを行ってください。</p>
    </header>

    <!-- ローディング -->
    <div id="loading" class="text-center py-16">
      <i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i>
      <p class="text-gray-500 mt-3">読み込み中...</p>
    </div>

    <!-- エラー/状態メッセージ -->
    <div id="state-message" class="hidden bg-white rounded-lg shadow p-8 text-center"></div>

    <!-- メインコンテンツ -->
    <main id="main-content" class="hidden">
      <!-- 署名者情報 -->
      <section class="bg-white rounded-lg shadow p-4 mb-4">
        <div class="flex items-center text-sm text-gray-600">
          <i class="fas fa-user-circle text-gray-400 text-xl mr-2"></i>
          <span>署名者: <strong id="signer-name" class="text-gray-800"></strong>（<span id="signer-email"></span>）</span>
        </div>
        <div class="text-xs text-gray-400 mt-1">
          <i class="fas fa-clock mr-1"></i>有効期限: <span id="expires-at"></span>
        </div>
      </section>

      <!-- 契約書本文 -->
      <section class="bg-white rounded-lg shadow mb-4">
        <div class="border-b px-4 py-3 bg-gray-50 rounded-t-lg">
          <h2 class="font-semibold text-gray-800"><i class="fas fa-file-lines mr-2 text-gray-500"></i><span id="doc-title"></span></h2>
        </div>
        <div id="doc-container" class="p-4 md:p-6 max-h-[60vh] overflow-y-auto"></div>
        <div class="border-t px-4 py-2 bg-gray-50 rounded-b-lg text-xs text-gray-400">
          <i class="fas fa-shield-halved mr-1"></i>文書ハッシュ(SHA-256): <span id="content-hash" class="font-mono break-all"></span>
        </div>
      </section>

      <!-- 合意フォーム -->
      <section id="agree-form" class="bg-white rounded-lg shadow p-4 md:p-6">
        <h3 class="font-semibold text-gray-800 mb-3"><i class="fas fa-pen-nib mr-2 text-blue-600"></i>合意手続き</h3>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">お名前（フルネーム）<span class="text-red-500">*</span></label>
          <input id="input-name" type="text" class="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="例：山田 太郎">
        </div>
        <label class="flex items-start mb-4 cursor-pointer">
          <input id="agree-check" type="checkbox" class="mt-1 mr-2 h-4 w-4">
          <span class="text-sm text-gray-700">上記の契約内容を確認し、これに同意します。本合意は電磁的記録として記録されます。</span>
        </label>
        <div class="flex flex-col sm:flex-row gap-3">
          <button id="btn-agree" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded transition disabled:opacity-50 disabled:cursor-not-allowed" disabled>
            <i class="fas fa-check mr-2"></i>合意する
          </button>
          <button id="btn-decline" class="sm:w-40 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 py-3 rounded transition">
            合意しない
          </button>
        </div>
        <p id="form-error" class="hidden text-red-500 text-sm mt-3"></p>
      </section>
    </main>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const $ = (id) => document.getElementById(id);

    function showState(icon, color, title, msg) {
      $('loading').classList.add('hidden');
      $('main-content').classList.add('hidden');
      const el = $('state-message');
      el.classList.remove('hidden');
      el.innerHTML = \`
        <i class="fas \${icon} text-5xl \${color} mb-4"></i>
        <h2 class="text-xl font-bold text-gray-800 mb-2">\${title}</h2>
        <p class="text-gray-500">\${msg}</p>\`;
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s == null ? '' : String(s);
      return div.innerHTML;
    }

    async function load() {
      try {
        const res = await axios.get('/api/sign/' + TOKEN);
        const d = res.data.data;

        if (d.status === 'signed') {
          showState('fa-circle-check', 'text-green-500', '合意済みです', 'この契約書には既に合意いただいています。ありがとうございました。');
          return;
        }
        if (d.status === 'declined') {
          showState('fa-circle-xmark', 'text-gray-400', '合意が見送られました', 'この契約書は「合意しない」で処理されています。');
          return;
        }
        if (d.status === 'expired') {
          showState('fa-clock', 'text-orange-400', '有効期限切れ', 'この署名リンクは有効期限が切れています。お手数ですが担当者にご連絡ください。');
          return;
        }

        // pending: 署名フォームを表示
        $('signer-name').textContent = d.signer_name;
        $('signer-email').textContent = d.signer_email;
        $('expires-at').textContent = d.expires_at;
        $('doc-title').textContent = d.title;
        $('content-hash').textContent = d.content_hash;

        const container = $('doc-container');
        if (d.source_type === 'pdf' && d.pdf_base64) {
          const src = d.pdf_base64.startsWith('data:') ? d.pdf_base64 : 'data:application/pdf;base64,' + d.pdf_base64;
          container.innerHTML = '<iframe src="' + src + '" class="w-full" style="height:55vh;" title="契約書PDF"></iframe>';
        } else {
          container.innerHTML = '<pre class="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">' + escapeHtml(d.document_body) + '</pre>';
        }

        $('loading').classList.add('hidden');
        $('main-content').classList.remove('hidden');
      } catch (e) {
        const msg = e.response?.data?.message || '読み込みに失敗しました。';
        showState('fa-triangle-exclamation', 'text-red-500', 'エラー', msg);
      }
    }

    // 合意ボタンの有効化制御
    function updateAgreeButton() {
      const ok = $('agree-check').checked && $('input-name').value.trim() !== '';
      $('btn-agree').disabled = !ok;
    }
    document.addEventListener('input', (e) => {
      if (e.target.id === 'agree-check' || e.target.id === 'input-name') updateAgreeButton();
    });
    document.addEventListener('change', (e) => {
      if (e.target.id === 'agree-check') updateAgreeButton();
    });

    // 合意処理
    document.addEventListener('click', async (e) => {
      if (e.target.closest('#btn-agree')) {
        const btn = $('btn-agree');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>処理中...';
        $('form-error').classList.add('hidden');
        try {
          await axios.post('/api/sign/' + TOKEN + '/agree', {
            input_name: $('input-name').value.trim(),
            agreed: true
          });
          showState('fa-circle-check', 'text-green-500', '合意が完了しました', 'ご協力ありがとうございました。合意内容は記録されました。');
        } catch (err) {
          const msg = err.response?.data?.message || '処理に失敗しました。';
          $('form-error').textContent = msg;
          $('form-error').classList.remove('hidden');
          btn.innerHTML = '<i class="fas fa-check mr-2"></i>合意する';
          updateAgreeButton();
        }
      }
      if (e.target.closest('#btn-decline')) {
        if (!confirm('この契約書に「合意しない」として記録します。よろしいですか？')) return;
        try {
          await axios.post('/api/sign/' + TOKEN + '/decline');
          showState('fa-circle-xmark', 'text-gray-400', '記録しました', '「合意しない」として処理しました。');
        } catch (err) {
          alert('処理に失敗しました。');
        }
      }
    });

    load();
  </script>
</body>
</html>
  `)
})

export default app
