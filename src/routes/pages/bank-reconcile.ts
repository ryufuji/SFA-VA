// 振込明細アップロード・自動突合 画面
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { htmlHead, navbar } from '../../lib/layout'

const app = new Hono<AppEnv>()

app.get('/bank-deposits/import', (c) => {
  return c.html(`${htmlHead('振込明細の取込・突合')}
<body class="bg-gray-100">
  ${navbar('bank-deposits')}
  <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
    <div class="px-4 py-6 sm:px-0">

      <div id="permission-error" class="hidden mb-6 bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-lock text-4xl text-red-400 mb-3"></i>
        <p class="text-red-700 font-semibold text-lg">アクセス権限がありません</p>
        <p class="text-red-600 text-sm mt-1">この画面は管理者または「入金」権限を持つユーザーのみ利用できます。</p>
      </div>

      <div id="main-content" class="hidden">
        <div class="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h1 class="text-3xl font-bold text-gray-900"><i class="fas fa-file-import mr-2"></i>振込明細の取込・突合</h1>
            <p class="mt-2 text-sm text-gray-600">銀行の振込明細（CSV）をアップロードすると、未入金の月次明細と自動で突き合わせます。確定すると入金済みになります。</p>
          </div>
          <a href="/bank-deposits" class="text-sm text-blue-600 hover:underline"><i class="fas fa-arrow-left mr-1"></i>入金消込の一覧へ</a>
        </div>

        <div id="message" class="hidden" role="status"></div>

        <!-- 1. アップロード -->
        <div class="bg-white shadow rounded-lg p-6 mb-6">
          <h2 class="text-lg font-bold text-gray-900 mb-3">1. 振込明細をアップロード</h2>
          <label id="dropzone" for="file-input" class="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400">
            <i class="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i>
            <p class="font-semibold text-gray-700">ここにCSVファイルをドラッグ、またはクリックして選択</p>
            <p class="text-xs text-gray-500 mt-1">インターネットバンキングからダウンロードした入出金明細（CSV）。出金の行は自動で除外します。</p>
            <input type="file" id="file-input" accept=".csv,.txt,.tsv,text/csv" class="sr-only">
          </label>
        </div>

        <!-- 2. 内容の確認 -->
        <div id="preview-card" class="hidden bg-white shadow rounded-lg p-6 mb-6">
          <h2 class="text-lg font-bold text-gray-900 mb-3">2. 読み取った内容を確認</h2>
          <p class="text-sm text-gray-600 mb-2">列の対応（自動で判定しています。違っていたら選び直してください）</p>
          <div id="mapping" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4"></div>
          <p id="preview-summary" class="text-sm text-gray-700 mb-3"></p>
          <div class="overflow-x-auto border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-center text-xs font-medium text-gray-500">取込</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">入金日</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">振込人名</th>
                  <th class="px-3 py-2 text-right text-xs font-medium text-gray-500">入金額</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">備考</th>
                </tr>
              </thead>
              <tbody id="preview-body" class="divide-y divide-gray-100"></tbody>
            </table>
          </div>
          <div class="flex flex-wrap gap-3 mt-4">
            <button id="import-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed"></button>
            <button id="cancel-btn" class="text-gray-600 hover:text-gray-900 py-2 px-3">やめる</button>
          </div>
        </div>

        <!-- 3. 突合候補 -->
        <div class="bg-white shadow rounded-lg p-6">
          <div class="flex flex-wrap justify-between items-center gap-3 mb-3">
            <div>
              <h2 class="text-lg font-bold text-gray-900">3. 突合候補を確認して確定</h2>
              <p id="match-summary" class="text-sm text-gray-700 mt-1"></p>
            </div>
            <button id="reload-btn" class="text-sm text-blue-600 hover:underline"><i class="fas fa-sync-alt mr-1"></i>突合し直す</button>
          </div>
          <div class="overflow-x-auto border border-gray-200 rounded-lg">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-center text-xs font-medium text-gray-500">確定</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">入金日</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">振込人名</th>
                  <th class="px-3 py-2 text-right text-xs font-medium text-gray-500">未消込額</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">突合候補（取引先・月次明細）</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">判定</th>
                </tr>
              </thead>
              <tbody id="match-body" class="divide-y divide-gray-100"></tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-center gap-3 mt-4">
            <button id="confirm-btn" class="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-5 rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed" disabled></button>
            <p class="text-xs text-gray-500">確度が高いものだけ最初からチェックが入っています。確定した消込は、入金消込の詳細画面から取り消せます。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="/static/auth.js"></script>
  <script src="/static/bank-csv.js"></script>
  <script src="/static/bank-import.js"></script>
</body>
</html>`)
})

export default app
