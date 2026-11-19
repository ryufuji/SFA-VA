/**
 * 銀行の振込明細CSVを読み取る共通処理（画面に依存しない）
 * ブラウザでもテスト（Node）でも、グローバルの BankCsv として使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BankCsv = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 見出しの候補（上にあるものほど優先）
  var KEYS = {
    date: ['取引日', 'お取引日', '入金日', '勘定日', '取扱日', '年月日', '日付', '操作日'],
    deposit: ['入金金額', 'お預り金額', 'お預かり金額', 'お預入金額', '預入金額', '預り金額', '受取金額', '入金額', 'お預入れ', 'お預け入れ', 'ご入金', '入金'],
    amount: ['取引金額', '金額'],
    payer: ['振込依頼人名', '依頼人名', '振込人名', '振込人', 'お取引内容', '取引内容', 'お取り扱い内容', '摘要内容', '摘要', '内容', '明細', '取引先'],
    note: ['備考', 'メモ', 'EDI情報', '摘要2'],
    type: ['入払区分', '入出金区分', '取引区分', '入出金']
  };
  var ERA = { R: 2018, '令和': 2018, H: 1988, '平成': 1988 };

  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ''); }

  /** ファイルの中身を文字にする（UTF-8 でなければ Shift_JIS とみなす） */
  function decodeBuffer(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('shift_jis').decode(buf); }
  }

  /** CSV（またはタブ区切り）を行と列に分ける */
  function parseCsv(text) {
    var head = text.slice(0, 2000);
    var delim = (head.split('\t').length > head.split(',').length) ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
    return rows;
  }

  /** いろいろな書き方の日付を 'YYYY-MM-DD' にそろえる。読めなければ null */
  function parseDate(s) {
    var t = norm(s), m, y, mo, d;
    if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/)) || (m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = t.match(/^(R|H|令和|平成)(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/))) {
      y = ERA[m[1]] + (m[2] === '元' ? 1 : +m[2]); mo = +m[3]; d = +m[4];
    } else return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (y < 1990 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** 「1,650,000円」「¥880000」などを整数にする。読めなければ null */
  function parseAmount(s) {
    var t = norm(s).replace(/[,¥\\円]/g, '');
    if (!/^[+-]?\d+(\.0+)?$/.test(t)) return null;
    return parseInt(t, 10);
  }

  function findCol(header, keys, reject) {
    for (var k = 0; k < keys.length; k++) {
      for (var i = 0; i < header.length; i++) {
        var h = norm(header[i]);
        if (h.indexOf(keys[k]) >= 0 && !(reject && reject(h))) return i;
      }
    }
    return -1;
  }

  /** 見出し行と、日付・入金額・振込人名などの列を自動で見つける */
  function detectColumns(rows) {
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var h = rows[r];
      var date = findCol(h, KEYS.date, function (x) { return x.indexOf('起算') >= 0; });
      var deposit = findCol(h, KEYS.deposit, function (x) { return x.indexOf('出') >= 0 || x.indexOf('残') >= 0; });
      var amount = deposit >= 0 ? deposit : findCol(h, KEYS.amount, function (x) { return x.indexOf('残') >= 0 || x.indexOf('出金') >= 0 || x.indexOf('支払') >= 0; });
      if (date < 0 || amount < 0) continue;
      var payer = findCol(h, KEYS.payer, function (x) { return x.indexOf('区分') >= 0; });
      var note = findCol(h, KEYS.note);
      return {
        headerRow: r, date: date, amount: amount, payer: payer,
        note: note === payer ? -1 : note,
        type: deposit >= 0 ? -1 : findCol(h, KEYS.type)   // 入金専用の列が無いときだけ、入出金の区分列を見る
      };
    }
    // 見出しが無いファイル: 中身から推測する
    var sample = rows.slice(0, 30), cols = sample[0] ? sample[0].length : 0;
    var rate = function (i, fn) { return sample.filter(function (x) { return fn(x[i]) !== null; }).length / (sample.length || 1); };
    var guess = { headerRow: -1, date: -1, amount: -1, payer: -1, note: -1, type: -1 };
    for (var i = 0; i < cols; i++) {
      if (guess.date < 0 && rate(i, parseDate) > 0.8) guess.date = i;
      else if (guess.amount < 0 && rate(i, parseAmount) > 0.8) guess.amount = i;
      else if (guess.payer < 0 && rate(i, parseAmount) < 0.2 && rate(i, parseDate) < 0.2 && sample.some(function (x) { return norm(x[i]).length > 2; })) guess.payer = i;
    }
    return guess;
  }

  /** 列の対応に従って、入金の行だけを取り出す */
  function extractRows(rows, map) {
    var out = [], skipped = 0;
    for (var r = map.headerRow + 1; r < rows.length; r++) {
      var row = rows[r];
      var date = map.date >= 0 ? parseDate(row[map.date]) : null;
      var amount = map.amount >= 0 ? parseAmount(row[map.amount]) : null;
      var type = map.type >= 0 ? norm(row[map.type]) : '';
      if (!date || amount === null || amount <= 0 || /出金|支払|払出|引落/.test(type)) { skipped++; continue; }
      var raw = map.payer >= 0 ? String(row[map.payer] || '').trim() : '';
      var payer = raw.replace(/^(振込入金|振込|フリコミ|ﾌﾘｺﾐ)[\s　]*/, '').trim() || raw;
      out.push({
        deposit_date: date, amount: amount, payer_name: payer,
        note: map.note >= 0 ? String(row[map.note] || '').trim() : '',
        // 利息などは売上の入金ではないので、初期状態ではチェックを外す
        checked: !!payer && !/利息|リソク|ﾘｿｸ/.test(raw)
      });
    }
    return { rows: out, skipped: skipped };
  }

  return { decodeBuffer: decodeBuffer, parseCsv: parseCsv, parseDate: parseDate, parseAmount: parseAmount, detectColumns: detectColumns, extractRows: extractRows };
});
