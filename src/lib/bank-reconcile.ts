// 振込明細と月次明細（未入金）の自動突合ロジック
// DBに触れない純粋な関数だけを置く（tests/bank-reconcile.test.ts でテスト）

export type DepositInput = {
  id: number
  deposit_date: string
  payer_name: string
  remaining_amount: number
}

export type UnpaidItem = {
  id: number              // monthly_details.id
  lead_id: number
  company_name: string
  contract_name: string
  target_month: string    // 'YYYY-MM'
  remaining: number       // 税込請求額 − 入金済み額
}

export type LeadInput = { id: number; company_name: string }

export type Allocation = { monthly_detail_id: number; amount: number }

export type Candidate = {
  lead_id: number
  company_name: string
  allocations: Allocation[]
  fee: number             // 振込手数料が差し引かれたとみなした額（0 = 金額が完全一致）
  ambiguous: boolean      // 同じ金額になる明細の組み合わせが他にもある
}

export type Suggestion = {
  deposit_id: number
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string
  lead_source: 'learned' | 'name' | 'amount' | null
  candidates: Candidate[] // 先頭が第一候補
}

// よくある振込手数料（税込）。入金額がこの分だけ少ない場合は「手数料差引の可能性」として候補に出す
const TRANSFER_FEES = [110, 165, 220, 275, 330, 385, 440, 495, 550, 605, 660, 770, 880]
const MAX_SUBSET_ITEMS = 15

const SMALL_KANA: Record<string, string> = {
  'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ'
}
const CORP_WORDS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '社会福祉法人', '医療法人', '学校法人', '特定非営利活動法人', '税理士法人', '弁護士法人',
  'カブシキガイシヤ', 'ユウゲンガイシヤ', 'ゴウドウガイシヤ', '(株)', '(有)', '(同)', '㈱', '㈲'
]

/**
 * 振込人名・会社名を照合用に正規化する。
 * 例: 「ｶ)ﾃｸﾉｿﾘﾕ-ｼﾖﾝ」「株式会社テクノソリューション」→ どちらも「テクノソリユーシヨン」
 */
export function normalizeName(raw: string): string {
  let s = (raw || '').normalize('NFKC').toUpperCase()
  // ひらがな → カタカナ
  s = s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
  for (const w of CORP_WORDS) s = s.split(w).join('')
  // 銀行の略語: カ)〇〇 / 〇〇(カ / 〇〇(カ)〇〇 など
  s = s.replace(/\((カ|ユ|ド|シヤ|ザイ|イ|シ)\)/g, '')
       .replace(/^(カ|ユ|ド|シヤ|ザイ|イ|シ)\)/, '')
       .replace(/\((カ|ユ|ド|シヤ|ザイ|イ|シ)$/, '')
  s = s.replace(/[ァィゥェォッャュョヮヵヶ]/g, ch => SMALL_KANA[ch])
  // 長音・ハイフン類をそろえ、記号と空白を取り除く
  s = s.replace(/[-‐‑–—―−ｰ]/g, 'ー')
  s = s.replace(/[^0-9A-Z゠-ヿ一-鿿々]/g, '')
  return s
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.includes(short)
}

/** 合計が target になる明細の組み合わせを探す（古い月・少ない月数を優先） */
function findSubsets(items: UnpaidItem[], target: number): UnpaidItem[][] {
  const pool = [...items].sort((x, y) => x.target_month.localeCompare(y.target_month) || x.id - y.id).slice(0, MAX_SUBSET_ITEMS)
  const found: { set: UnpaidItem[]; score: number }[] = []
  const n = pool.length
  for (let mask = 1; mask < (1 << n) && found.length < 50; mask++) {
    let sum = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += pool[i].remaining
    if (sum !== target) continue
    const set = pool.filter((_, i) => mask & (1 << i))
    const months = new Set(set.map(x => x.target_month)).size
    const order = set.reduce((acc, x) => acc + pool.indexOf(x), 0)
    found.push({ set, score: months * 1000 + set.length * 100 + order })
  }
  return found.sort((x, y) => x.score - y.score).map(f => f.set)
}

// 古い月から順に入金されるのが普通なので、月が違う組み合わせは「別候補」とは数えない。
// 第一候補と同じ月の中に、同じ金額になる別の明細の組み合わせがあるときだけ「あいまい」とする
function isAmbiguous(sets: UnpaidItem[][]): boolean {
  const months = (set: UnpaidItem[]) => [...new Set(set.map(x => x.target_month))].sort().join(',')
  return sets.slice(1).some(set => months(set) === months(sets[0]))
}

function candidateForLead(amount: number, items: UnpaidItem[], allowFee: boolean): Candidate | null {
  if (!items.length) return null
  const base = { lead_id: items[0].lead_id, company_name: items[0].company_name }
  const exact = findSubsets(items, amount)
  if (exact.length) {
    return { ...base, fee: 0, ambiguous: isAmbiguous(exact), allocations: exact[0].map(x => ({ monthly_detail_id: x.id, amount: x.remaining })) }
  }
  if (!allowFee) return null
  for (const fee of TRANSFER_FEES) {
    const sets = findSubsets(items, amount + fee)
    if (!sets.length) continue
    const set = sets[0]
    // 手数料分は最後の明細から差し引く（その明細は「部分入金」で残る）
    const allocations = set.map((x, i) => ({ monthly_detail_id: x.id, amount: i === set.length - 1 ? x.remaining - fee : x.remaining }))
    if (allocations.some(a => a.amount <= 0)) continue
    return { ...base, fee, ambiguous: isAmbiguous(sets), allocations }
  }
  return null
}

/**
 * 未消込の入金それぞれに、突合の候補を提案する。
 * aliases: 正規化した振込人名 → lead_id（過去に確定した突合から学習したもの）
 */
export function suggestMatches(deposits: DepositInput[], unpaid: UnpaidItem[], leads: LeadInput[], aliases: Record<string, number>): Suggestion[] {
  const left = new Map<number, number>()   // 明細ごとの「まだ他の入金に割り当てていない残額」
  unpaid.forEach(u => left.set(u.id, u.remaining))
  const leadKeys = leads.map(l => ({ id: l.id, key: normalizeName(l.company_name) }))
  const available = (leadId?: number) => unpaid
    .filter(u => (leadId === undefined || u.lead_id === leadId) && (left.get(u.id) || 0) > 0)
    .map(u => ({ ...u, remaining: left.get(u.id) as number }))
  const reserve = (c: Candidate) => c.allocations.forEach(a => left.set(a.monthly_detail_id, (left.get(a.monthly_detail_id) || 0) - a.amount))

  // 1) 振込人名から取引先を特定する
  const resolved = deposits.map(d => {
    const key = normalizeName(d.payer_name)
    if (key && aliases[key] !== undefined) return { d, leadId: aliases[key], source: 'learned' as const }
    const hits = leadKeys.filter(l => namesMatch(key, l.key))
    if (hits.length === 1) return { d, leadId: hits[0].id, source: 'name' as const }
    return { d, leadId: undefined, source: null }
  })

  const out = new Map<number, Suggestion>()
  const byDate = (x: { d: DepositInput }, y: { d: DepositInput }) => x.d.deposit_date.localeCompare(y.d.deposit_date) || x.d.id - y.d.id

  // 2) 取引先が特定できた入金を先に処理する（明細の取り合いを避けるため）
  for (const r of resolved.filter(x => x.leadId !== undefined).sort(byDate)) {
    const items = available(r.leadId)
    const how = r.source === 'learned' ? '以前の突合と同じ振込人名' : '振込人名が取引先名と一致'
    const c = candidateForLead(r.d.remaining_amount, items, true)
    if (!c) {
      const name = leads.find(l => l.id === r.leadId)?.company_name || ''
      out.set(r.d.id, { deposit_id: r.d.id, confidence: 'none', lead_source: r.source, candidates: [], reason: `${how}（${name}）ですが、金額が合う未入金の明細がありません` })
      continue
    }
    reserve(c)
    const s: Suggestion = { deposit_id: r.d.id, lead_source: r.source, candidates: [c], confidence: 'high', reason: `${how}・金額も一致` }
    if (c.fee > 0) { s.confidence = 'low'; s.reason = `${how}。振込手数料 ¥${c.fee.toLocaleString()} が差し引かれている可能性があります` }
    else if (c.ambiguous) { s.confidence = 'medium'; s.reason = `${how}・金額も一致（同じ金額になる明細の組み合わせが他にもあります）` }
    out.set(r.d.id, s)
  }

  // 3) 取引先が特定できない入金は、金額だけで全取引先から探す
  for (const r of resolved.filter(x => x.leadId === undefined).sort(byDate)) {
    const leadIds = [...new Set(available().map(u => u.lead_id))]
    const cands = leadIds.map(id => candidateForLead(r.d.remaining_amount, available(id), false)).filter((c): c is Candidate => !!c)
    if (!cands.length) {
      out.set(r.d.id, { deposit_id: r.d.id, confidence: 'none', lead_source: null, candidates: [], reason: '振込人名・金額が合う未入金の明細が見つかりません' })
      continue
    }
    if (cands.length === 1) {
      reserve(cands[0])
      out.set(r.d.id, { deposit_id: r.d.id, confidence: 'medium', lead_source: 'amount', candidates: cands, reason: '金額が一致する取引先が1社だけあります（振込人名は初めて）' })
    } else {
      out.set(r.d.id, { deposit_id: r.d.id, confidence: 'low', lead_source: 'amount', candidates: cands.slice(0, 5), reason: `金額が一致する取引先が${cands.length}社あります。正しい取引先を選んでください` })
    }
  }
  return deposits.map(d => out.get(d.id) as Suggestion)
}
