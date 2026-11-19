/**
 * 振込明細アップロード・自動突合 画面（/bank-deposits/import）
 * 前提: axios, /static/auth.js, /static/bank-csv.js が先に読み込まれていること
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var yen = function (n) { return '¥' + Number(n || 0).toLocaleString(); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function banner(kind, html) {
    var cls = { ok: 'bg-green-50 border-green-200 text-green-800', warn: 'bg-amber-50 border-amber-200 text-amber-800', err: 'bg-red-50 border-red-200 text-red-800' }[kind];
    $('message').className = 'mb-6 border rounded-lg p-4 ' + cls;
    $('message').innerHTML = html;
    $('message').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function apiError(e) { return (e.response && e.response.data && e.response.data.error) || '通信に失敗しました。もう一度お試しください。'; }

  // ---------- 1. ファイルを読む ----------
  var file = { name: '', rows: [], map: null, items: [], skipped: 0 };
  var FIELDS = [['date', '入金日'], ['amount', '入金額'], ['payer', '振込人名'], ['note', '備考（任意）']];

  function readFile(f) {
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        file.name = f.name;
        file.rows = BankCsv.parseCsv(BankCsv.decodeBuffer(reader.result));
        file.map = BankCsv.detectColumns(file.rows);
      } catch (e) { file.rows = []; }
      if (!file.rows.length) return banner('err', 'ファイルを読み取れませんでした。銀行からダウンロードしたCSVファイルを選んでください。');
      $('message').className = 'hidden';
      extract(); renderPreview();
    };
    reader.readAsArrayBuffer(f);
  }
  function extract() {
    var r = BankCsv.extractRows(file.rows, file.map);
    file.items = r.rows; file.skipped = r.skipped;
  }

  function renderPreview() {
    var header = file.map.headerRow >= 0 ? file.rows[file.map.headerRow] : [];
    var width = Math.max.apply(null, file.rows.slice(0, 30).map(function (r) { return r.length; }));
    var sampleRow = file.rows[file.map.headerRow + 1] || [];
    $('mapping').innerHTML = FIELDS.map(function (f) {
      var opts = '<option value="-1">（なし）</option>';
      for (var i = 0; i < width; i++) {
        var label = header[i] ? header[i] : (i + 1) + '列目（例: ' + String(sampleRow[i] || '').slice(0, 12) + '）';
        opts += '<option value="' + i + '"' + (file.map[f[0]] === i ? ' selected' : '') + '>' + esc(label) + '</option>';
      }
      return '<label class="block text-sm"><span class="block text-gray-600 mb-1">' + f[1] + '</span>' +
        '<select id="map-' + f[0] + '" data-field="' + f[0] + '" class="w-full border border-gray-300 rounded-md p-2 bg-white">' + opts + '</select></label>';
    }).join('');

    var ok = file.map.date >= 0 && file.map.amount >= 0 && file.map.payer >= 0;
    var checked = file.items.filter(function (x) { return x.checked; });
    var total = checked.reduce(function (s, x) { return s + x.amount; }, 0);
    $('preview-summary').innerHTML = !ok
      ? '<span class="text-red-600 font-semibold">入金日・入金額・振込人名の列を選んでください。</span>'
      : '<b>' + esc(file.name) + '</b>：入金 <b>' + file.items.length + '</b> 件を読み取りました（出金・合計行など ' + file.skipped + ' 行は対象外）。取り込み対象 <b>' + checked.length + '</b> 件・合計 <b>' + yen(total) + '</b>';
    $('preview-body').innerHTML = file.items.map(function (x, i) {
      return '<tr class="' + (x.checked ? '' : 'bg-gray-50 text-gray-400') + '">' +
        '<td class="px-3 py-2 text-center"><input type="checkbox" class="row-check h-4 w-4" data-i="' + i + '"' + (x.checked ? ' checked' : '') + ' aria-label="この行を取り込む"></td>' +
        '<td class="px-3 py-2 whitespace-nowrap">' + x.deposit_date + '</td>' +
        '<td class="px-3 py-2">' + (esc(x.payer_name) || '<span class="text-red-500">（振込人名なし）</span>') + '</td>' +
        '<td class="px-3 py-2 text-right whitespace-nowrap">' + yen(x.amount) + '</td>' +
        '<td class="px-3 py-2 text-gray-500">' + esc(x.note) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="px-3 py-8 text-center text-gray-500">入金の行が見つかりませんでした。上の「列の対応」を確認してください。</td></tr>';
    $('import-btn').disabled = !ok || !checked.length;
    $('import-btn').textContent = checked.length + ' 件を取り込んで突合する';
    $('preview-card').classList.remove('hidden');
  }

  function doImport() {
    var rows = file.items.filter(function (x) { return x.checked; }).map(function (x) {
      return { deposit_date: x.deposit_date, amount: x.amount, payer_name: x.payer_name, note: x.note };
    });
    $('import-btn').disabled = true; $('import-btn').textContent = '取り込み中…';
    axios.post('/api/bank-reconcile/import', { rows: rows, file_name: file.name }).then(function (res) {
      var d = res.data;
      banner(d.inserted ? 'ok' : 'warn',
        '<b>' + d.inserted + ' 件</b>を取り込みました。' +
        (d.duplicates ? ' すでに登録済みの ' + d.duplicates + ' 件は重複のためスキップしました。' : '') +
        (d.invalid ? ' 内容に不備のある ' + d.invalid + ' 件は取り込めませんでした。' : '') +
        ' 下の「突合候補」を確認して確定してください。');
      $('preview-card').classList.add('hidden'); $('file-input').value = '';
      loadSuggestions();
    }).catch(function (e) { banner('err', esc(apiError(e))); renderPreview(); });
  }

  // ---------- 2. 突合候補 ----------
  var match = { list: [], details: {}, pick: {}, check: {} };
  var BADGE = {
    high: ['確度：高', 'bg-green-100 text-green-800'], medium: ['確度：中', 'bg-amber-100 text-amber-800'],
    low: ['要確認', 'bg-orange-100 text-orange-800'], none: ['候補なし', 'bg-gray-100 text-gray-600']
  };

  function loadSuggestions() {
    $('match-body').innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>突合しています…</td></tr>';
    return axios.get('/api/bank-reconcile/suggestions').then(function (res) {
      match.list = res.data.data; match.details = res.data.details; match.pick = {}; match.check = {};
      match.list.forEach(function (x) {
        match.pick[x.deposit.id] = 0;
        match.check[x.deposit.id] = x.suggestion.confidence === 'high'; // 確度が高いものだけ最初からチェック
      });
      renderMatches();
    }).catch(function (e) {
      $('match-body').innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-red-600">' + esc(apiError(e)) + '</td></tr>';
    });
  }

  function renderMatches() {
    var n = { high: 0, medium: 0, low: 0, none: 0 };
    match.list.forEach(function (x) { n[x.suggestion.confidence]++; });
    $('match-summary').innerHTML = match.list.length
      ? '未消込の入金 <b>' + match.list.length + '</b> 件：確度が高い <b class="text-green-700">' + n.high + '</b> ／ 確認が必要 <b class="text-amber-700">' + (n.medium + n.low) + '</b> ／ 候補なし <b>' + n.none + '</b>'
      : '';
    $('match-body').innerHTML = match.list.map(function (x) {
      var d = x.deposit, s = x.suggestion, id = d.id;
      var cand = s.candidates[match.pick[id]];
      var candHtml = '<span class="text-gray-400">—</span>';
      if (cand) {
        var who = s.candidates.length > 1
          ? '<select class="cand-select border border-gray-300 rounded-md p-1 text-sm bg-white mb-1 max-w-full" data-id="' + id + '" aria-label="取引先を選ぶ">' + s.candidates.map(function (c, i) {
              return '<option value="' + i + '"' + (i === match.pick[id] ? ' selected' : '') + '>' + esc(c.company_name) + '</option>';
            }).join('') + '</select>'
          : '<div class="font-semibold text-gray-900">' + esc(cand.company_name) + '</div>';
        candHtml = who + '<ul class="text-xs text-gray-600 space-y-0.5">' + cand.allocations.map(function (a) {
          var md = match.details[a.monthly_detail_id] || {};
          return '<li><a class="text-blue-600 hover:underline" href="/monthly/' + a.monthly_detail_id + '">' + esc(md.target_month) + '</a> ' + esc(md.contract_name) +
            ' <span class="whitespace-nowrap font-semibold">' + yen(a.amount) + '</span>' + (a.amount < md.remaining ? '（残り ' + yen(md.remaining - a.amount) + '）' : '') + '</li>';
        }).join('') + '</ul>';
      }
      var b = BADGE[s.confidence];
      return '<tr class="align-top">' +
        '<td class="px-3 py-3 text-center">' + (cand ? '<input type="checkbox" class="match-check h-4 w-4" data-id="' + id + '"' + (match.check[id] ? ' checked' : '') + ' aria-label="この突合を確定する">' : '') + '</td>' +
        '<td class="px-3 py-3 whitespace-nowrap text-sm">' + esc(d.deposit_date) + '</td>' +
        '<td class="px-3 py-3 text-sm"><div class="font-medium text-gray-900">' + esc(d.payer_name) + '</div>' + (d.note ? '<div class="text-xs text-gray-500">' + esc(d.note) + '</div>' : '') + '</td>' +
        '<td class="px-3 py-3 text-right whitespace-nowrap text-sm font-semibold">' + yen(d.remaining_amount) + (d.remaining_amount !== d.amount ? '<div class="text-xs font-normal text-gray-500">入金額 ' + yen(d.amount) + '</div>' : '') + '</td>' +
        '<td class="px-3 py-3 text-sm">' + candHtml + '</td>' +
        '<td class="px-3 py-3 text-sm"><span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ' + b[1] + '">' + b[0] + '</span>' +
        '<div class="text-xs text-gray-600 mt-1">' + esc(s.reason) + '</div>' +
        '<a class="text-xs text-blue-600 hover:underline" href="/bank-deposits/' + id + '/allocate">手動で消込する</a></td></tr>';
    }).join('') || '<tr><td colspan="6" class="px-4 py-10 text-center text-gray-500">未消込の入金はありません。振込明細をアップロードすると、ここに突合候補が表示されます。</td></tr>';
    updateConfirm();
  }

  function selected() {
    return match.list.filter(function (x) { return match.check[x.deposit.id] && x.suggestion.candidates[match.pick[x.deposit.id]]; });
  }
  function updateConfirm() {
    var sel = selected();
    var total = sel.reduce(function (s, x) {
      return s + x.suggestion.candidates[match.pick[x.deposit.id]].allocations.reduce(function (t, a) { return t + a.amount; }, 0);
    }, 0);
    $('confirm-btn').disabled = !sel.length;
    $('confirm-btn').textContent = sel.length ? 'チェックした ' + sel.length + ' 件（' + yen(total) + '）を確定する' : '確定する突合にチェックを入れてください';
  }

  function doConfirm() {
    var sel = selected();
    var items = sel.map(function (x) {
      return { deposit_id: x.deposit.id, allocations: x.suggestion.candidates[match.pick[x.deposit.id]].allocations };
    });
    $('confirm-btn').disabled = true; $('confirm-btn').textContent = '確定しています…';
    axios.post('/api/bank-reconcile/confirm', { items: items }).then(function (res) {
      var d = res.data;
      var fails = d.results.filter(function (r) { return !r.success; }).map(function (r) {
        var x = match.list.filter(function (m) { return m.deposit.id === r.deposit_id; })[0];
        return '<li>' + esc(x ? x.deposit.payer_name + ' ' + yen(x.deposit.remaining_amount) : '入金ID ' + r.deposit_id) + '：' + esc(r.error) + '</li>';
      }).join('');
      banner(d.failed ? 'warn' : 'ok', '<b>' + d.confirmed + ' 件</b>の入金を消し込み、月次明細の入金状況を更新しました。' +
        (d.failed ? '<div class="mt-2">' + d.failed + ' 件は確定できませんでした：<ul class="list-disc pl-5">' + fails + '</ul></div>' : ''));
      loadSuggestions();
    }).catch(function (e) { banner('err', esc(apiError(e))); updateConfirm(); });
  }

  // ---------- 初期化 ----------
  async function init() {
    if (!AUTH_UTILS.checkAuth()) return;
    AUTH_UTILS.setupAxios();
    var user = await AUTH_UTILS.getCurrentUser();
    if (user && $('nav-user-name')) $('nav-user-name').textContent = user.name || user.email;
    if (!AUTH_UTILS.hasPermission(user, 'payment_manage')) { $('permission-error').classList.remove('hidden'); return; }
    $('main-content').classList.remove('hidden');

    var drop = $('dropzone');
    $('file-input').addEventListener('change', function (e) { readFile(e.target.files[0]); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('border-blue-500', 'bg-blue-50'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('border-blue-500', 'bg-blue-50'); }); });
    drop.addEventListener('drop', function (e) { readFile(e.dataTransfer.files[0]); });

    $('mapping').addEventListener('change', function (e) {
      if (!e.target.dataset.field) return;
      file.map[e.target.dataset.field] = Number(e.target.value);
      if (e.target.dataset.field === 'amount') file.map.type = -1;
      extract(); renderPreview();
    });
    $('preview-body').addEventListener('change', function (e) {
      if (!e.target.classList.contains('row-check')) return;
      file.items[Number(e.target.dataset.i)].checked = e.target.checked; renderPreview();
    });
    $('import-btn').addEventListener('click', doImport);
    $('cancel-btn').addEventListener('click', function () { $('preview-card').classList.add('hidden'); $('file-input').value = ''; });

    $('match-body').addEventListener('change', function (e) {
      var id = Number(e.target.dataset.id);
      if (e.target.classList.contains('match-check')) { match.check[id] = e.target.checked; updateConfirm(); }
      else if (e.target.classList.contains('cand-select')) { match.pick[id] = Number(e.target.value); renderMatches(); }
    });
    $('confirm-btn').addEventListener('click', doConfirm);
    $('reload-btn').addEventListener('click', loadSuggestions);
    loadSuggestions();
  }
  init();
})();
