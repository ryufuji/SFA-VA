// 実行方法: node --test tests/*.test.ts
import test from 'node:test'
import assert from 'node:assert'
await import('../public/static/bank-csv.js')
const BankCsv = (globalThis as any).BankCsv

test('日付と金額のいろいろな書き方を読める', () => {
  for (const s of ['2026/2/5', '2026-02-05', '20260205', '2026年2月5日', 'R8.2.5', '令和8年2月5日', '２０２６／０２／０５']) {
    assert.strictEqual(BankCsv.parseDate(s), '2026-02-05', s)
  }
  assert.strictEqual(BankCsv.parseDate('2026/02/30'), null)
  assert.strictEqual(BankCsv.parseDate('合計'), null)
  assert.strictEqual(BankCsv.parseAmount('1,650,000円'), 1650000)
  assert.strictEqual(BankCsv.parseAmount('¥880000'), 880000)
  assert.strictEqual(BankCsv.parseAmount(''), null)
})

test('入金・出金が別の列になっている明細（一般的な通帳形式）', () => {
  const csv = '口座番号,1234567\r\n\r\n日付,摘要,お支払金額,お預り金額,差引残高\r\n' +
    '2026/02/25,"振込 ｶ)ﾃｸﾉｿﾘﾕ-ｼﾖﾝ",,"1,650,000","5,000,000"\r\n' +
    '2026/02/26,電気料,"12,000",,"4,988,000"\r\n' +
    '2026/02/28,利息,,12,"4,988,012"\r\n'
  const rows = BankCsv.parseCsv(csv)
  const map = BankCsv.detectColumns(rows)
  assert.deepStrictEqual([map.headerRow, map.date, map.amount, map.payer], [1, 0, 3, 1])
  const { rows: out, skipped } = BankCsv.extractRows(rows, map)
  assert.strictEqual(skipped, 1)
  assert.deepStrictEqual(out[0], { deposit_date: '2026-02-25', amount: 1650000, payer_name: 'ｶ)ﾃｸﾉｿﾘﾕ-ｼﾖﾝ', note: '', checked: true })
  assert.strictEqual(out[1].checked, false) // 利息
})

test('金額が1列で、入出金の区分が別の列にある明細', () => {
  const csv = '取引日,入出金区分,取引金額,振込依頼人名,残高\n20260227,入金,1210000,ド)クリエイトワークス,100\n20260227,出金,5000,ヤチン,95\n'
  const rows = BankCsv.parseCsv(csv)
  const map = BankCsv.detectColumns(rows)
  const { rows: out } = BankCsv.extractRows(rows, map)
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].payer_name, 'ド)クリエイトワークス')
})

test('Shift_JIS のファイルも読める', () => {
  // 「日付」を Shift_JIS で表したバイト列
  const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74])
  assert.strictEqual(BankCsv.decodeBuffer(sjis.buffer), '日付')
  assert.strictEqual(BankCsv.decodeBuffer(new TextEncoder().encode('日付').buffer), '日付')
})
