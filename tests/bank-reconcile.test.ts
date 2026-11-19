// 実行方法: node --test tests/
import test from 'node:test'
import assert from 'node:assert'
import { normalizeName, suggestMatches } from '../src/lib/bank-reconcile.ts'

const leads = [
  { id: 1, company_name: '株式会社テクノソリューション' },
  { id: 2, company_name: '合同会社クリエイトワークス' },
  { id: 3, company_name: 'グローバルシステムズ株式会社' }
]
const item = (id: number, lead_id: number, target_month: string, remaining: number) =>
  ({ id, lead_id, company_name: leads[lead_id - 1].company_name, contract_name: 'c' + id, target_month, remaining })
const unpaid = () => [
  item(401, 1, '2026-01', 1100000), item(403, 1, '2026-01', 550000),
  item(402, 1, '2026-02', 1100000), item(404, 1, '2026-02', 550000),
  item(407, 2, '2026-01', 1210000), item(408, 2, '2026-02', 1210000),
  item(409, 3, '2026-01', 880000), item(410, 3, '2026-02', 880000)
]
const dep = (id: number, payer_name: string, remaining_amount: number, deposit_date = '2026-02-25') => ({ id, payer_name, remaining_amount, deposit_date })

test('振込人名の表記ゆれを吸収する', () => {
  assert.strictEqual(normalizeName('ｶ)ﾃｸﾉｿﾘﾕ-ｼﾖﾝ'), normalizeName('株式会社テクノソリューション'))
  assert.strictEqual(normalizeName('グローバルシステムズ（カ'), normalizeName('グローバルシステムズ株式会社'))
  assert.strictEqual(normalizeName('ド）クリエイト　ワークス'), normalizeName('合同会社クリエイトワークス'))
  assert.strictEqual(normalizeName('ＡＢＣ商事(株)'), 'ABC商事')
})

test('振込人名と金額が合えば、同じ月の明細をまとめて高い確度で提案する', () => {
  const [s] = suggestMatches([dep(1, 'ｶ)ﾃｸﾉｿﾘﾕ-ｼﾖﾝ', 1650000)], unpaid(), leads, {})
  assert.strictEqual(s.confidence, 'high')
  assert.deepStrictEqual(s.candidates[0].allocations, [{ monthly_detail_id: 401, amount: 1100000 }, { monthly_detail_id: 403, amount: 550000 }])
})

test('同じ明細を2つの入金に重ねて提案しない', () => {
  const r = suggestMatches([dep(1, 'グローバルシステムズ(カ', 880000, '2026-02-28'), dep(2, 'グローバルシステムズ(カ', 880000, '2026-03-31')], unpaid(), leads, {})
  assert.deepStrictEqual(r.map(s => s.candidates[0].allocations[0].monthly_detail_id), [409, 410])
  const r3 = suggestMatches([dep(1, 'グローバルシステムズ(カ', 880000), dep(2, 'グローバルシステムズ(カ', 880000), dep(3, 'グローバルシステムズ(カ', 880000)], unpaid(), leads, {})
  assert.strictEqual(r3[2].confidence, 'none')
})

test('学習済みの振込人名は、名前が似ていなくても取引先を特定する', () => {
  const key = normalizeName('ヤマダ タロウ')
  const [s] = suggestMatches([dep(1, 'ﾔﾏﾀﾞ ﾀﾛｳ', 1210000)], unpaid(), leads, { [key]: 2 })
  assert.strictEqual(s.confidence, 'high')
  assert.strictEqual(s.lead_source, 'learned')
  assert.strictEqual(s.candidates[0].lead_id, 2)
})

test('初めての振込人名は金額だけで探し、確度を下げる', () => {
  const [one] = suggestMatches([dep(1, 'ヤマダ タロウ', 1210000)], unpaid(), leads, {})
  assert.strictEqual(one.confidence, 'medium')
  assert.strictEqual(one.candidates[0].lead_id, 2)
  const u = unpaid().concat([item(500, 3, '2026-03', 1210000)])
  const [many] = suggestMatches([dep(1, 'ヤマダ タロウ', 1210000)], u, leads, {})
  assert.strictEqual(many.confidence, 'low')
  assert.strictEqual(many.candidates.length, 2)
})

test('振込手数料が引かれた入金は、低い確度で提案する', () => {
  const [s] = suggestMatches([dep(1, '合同会社クリエイトワークス', 1210000 - 440)], unpaid(), leads, {})
  assert.strictEqual(s.confidence, 'low')
  assert.strictEqual(s.candidates[0].fee, 440)
  assert.deepStrictEqual(s.candidates[0].allocations, [{ monthly_detail_id: 407, amount: 1209560 }])
})

test('同じ月に同じ金額の明細が複数あるときは、確度を下げて確認を促す', () => {
  const u = unpaid().concat([item(420, 3, '2026-01', 880000)])
  const [s] = suggestMatches([dep(1, 'グローバルシステムズ株式会社', 880000)], u, leads, {})
  assert.strictEqual(s.confidence, 'medium')
})

test('金額が合わない入金は候補なしにする', () => {
  const [s] = suggestMatches([dep(1, 'グローバルシステムズ株式会社', 1000000)], unpaid(), leads, {})
  assert.strictEqual(s.confidence, 'none')
  assert.strictEqual(s.candidates.length, 0)
})
