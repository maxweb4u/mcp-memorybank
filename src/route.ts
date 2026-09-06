import type { BankDoc, Layer } from './types.js'
import { layerWeights as declaredWeights } from './layer.js'
import type { Bank } from './bank.js'
import { expandTerms, RU_STOP, WHY_INTENT, type QueryTerm } from './lang.js'

const FIELD_WEIGHT = { canonicalFor: 5, purpose: 3, title: 2, section: 1 } as const

const STATUS_WEIGHT: Record<string, number> = { active: 1, draft: 0.7, archived: 0.2 }
const CLOSED_DELIVERY = new Set(['done', 'cancelled'])

/**
 * Function words carry no routing signal. The list is longer than it looks it needs to be because a
 * short one was measured failing: asked for "improvements deferred from review ... that are not
 * defects", the router scored a document on the word `not` and put it third. `search.ts` had
 * already filtered `not`, `from` and `can`; the two lists had simply drifted apart.
 */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'what', 'where', 'how',
  'which', 'that', 'this', 'do', 'does', 'when', 'why', 'who', 'with', 'about', 'i', 'we', 'it',
  'not', 'no', 'from', 'but', 'its', 'has', 'have', 'had', 'was', 'were', 'be', 'been', 'being',
  'can', 'could', 'should', 'would', 'may', 'might', 'must', 'will', 'as', 'at', 'by', 'if', 'into',
  'than', 'then', 'there', 'these', 'those', 'them', 'they', 'you', 'my', 'our', 'us', 'me',
  'any', 'all', 'some', 'such', 'only', 'also', 'just', 'very', 'each', 'both', 'get', 'got',
  ...RU_STOP,
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9Ѐ-ӿ]+/i)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

interface FieldHit {
  field: keyof typeof FIELD_WEIGHT
  token: string
  exact: boolean
  detail?: string
}

/** A translation is a real concept hit, but the word actually typed should still win a tie. */
const TRANSLATION_DISCOUNT = 0.9

function matchWord(word: string, words: string[], set: Set<string>): number {
  if (set.has(word)) return 1
  if (word.length >= 4 && words.some((w) => w.startsWith(word) || word.startsWith(w))) return 0.6
  return 0
}

/**
 * Scored per query term, not per word: a Russian term carries its English equivalents with it, and
 * three equivalents matching one `purpose` is still one concept, not three.
 */
function scoreField(terms: QueryTerm[], words: string[]): { score: number; hits: string[] } {
  const set = new Set(words)
  let score = 0
  const hits: string[] = []
  for (const term of terms) {
    let best = matchWord(term.literal, words, set)
    let bestWord = term.literal
    for (const translation of term.translations) {
      const value = matchWord(translation, words, set) * TRANSLATION_DISCOUNT
      if (value > best) {
        best = value
        bestWord = translation
      }
    }
    if (best > 0) {
      score += best
      hits.push(bestWord)
    }
  }
  return { score, hits }
}

export interface RouteResult {
  path: string
  title: string
  purpose: string
  docKind: string
  layer: Layer
  status: string
  score: number
  why: string
}

export interface RouteOptions {
  limit?: number
  docKind?: string
  layer?: Layer
}

/**
 * A "why" question wants the decision that settled the matter, not the document describing the
 * result — so decision is lifted and knowledge is damped, until decision outranks it.
 *
 * These are multipliers rather than fixed numbers because the bank may declare its own weights
 * (B-08). Against the built-in 1.2 and 1.5 they reproduce exactly the 1.6 and 1.2 this has always
 * used; against a bank that weighs its layers differently they preserve the relationship instead of
 * overwriting the declaration.
 */
const WHY_DECISION_LIFT = 4 / 3
const WHY_KNOWLEDGE_DAMP = 0.8

function layerWeights(bank: Bank, question: string): Record<Layer, number> {
  const base = declaredWeights(bank.layers)
  if (!WHY_INTENT.test(question)) return base
  return {
    ...base,
    decision: base.decision * WHY_DECISION_LIFT,
    knowledge: base.knowledge * WHY_KNOWLEDGE_DAMP,
  }
}

export function route(bank: Bank, question: string, opts: RouteOptions = {}): RouteResult[] {
  const terms = expandTerms(tokenize(question))
  const weights = layerWeights(bank, question)
  if (terms.length === 0) return []
  const limit = opts.limit ?? 5
  const scored: (RouteResult & { raw: number })[] = []

  for (const doc of bank.all()) {
    // Templates are structurally similar to every real document and would flood the list.
    if (doc.docFunction === 'template') continue
    // The quarantine is not navigation. memorybank://inbox promises unreviewed captures are out of
    // it until promoted, and damping them by layer weight is not the same as keeping that promise:
    // measured on a young bank, a note reached the top three for the question it answered.
    if (doc.layer === 'inbox') continue
    if (opts.docKind && doc.docKind !== opts.docKind) continue
    if (opts.layer && doc.layer !== opts.layer) continue

    const hits: FieldHit[] = []
    let raw = 0

    // Scored by how much of a key the question covers, not by a single word of it:
    // otherwise "rules" would boost every document owning any `*_rules` key.
    let canonicalScore = 0
    let ownedKey: string | undefined
    for (const key of doc.canonicalFor) {
      const words = tokenize(key)
      if (words.length === 0) continue
      const { score } = scoreField(terms, words)
      const weighted = (score / words.length) * FIELD_WEIGHT.canonicalFor
      if (weighted > canonicalScore) {
        canonicalScore = weighted
        ownedKey = key
      }
    }
    if (canonicalScore > 0) {
      raw += canonicalScore
      hits.push({ field: 'canonicalFor', token: '', exact: true, detail: ownedKey })
    }

    const purpose = scoreField(terms, tokenize(doc.purpose))
    if (purpose.score > 0) {
      raw += purpose.score * FIELD_WEIGHT.purpose
      hits.push({ field: 'purpose', token: purpose.hits.join(', '), exact: true })
    }

    const title = scoreField(terms, tokenize(doc.title))
    if (title.score > 0) {
      raw += title.score * FIELD_WEIGHT.title
      hits.push({ field: 'title', token: title.hits.join(', '), exact: true })
    }

    let bestSection: string | undefined
    let sectionScore = 0
    for (const section of doc.sections) {
      const s = scoreField(terms, tokenize(section.title))
      if (s.score > sectionScore) {
        sectionScore = s.score
        bestSection = section.title
      }
    }
    if (sectionScore > 0) {
      raw += sectionScore * FIELD_WEIGHT.section
      hits.push({ field: 'section', token: '', exact: false, detail: bestSection })
    }

    if (raw === 0) continue

    let score = raw * weights[doc.layer] * (STATUS_WEIGHT[doc.status] ?? 0.9)
    if (doc.deliveryStatus && CLOSED_DELIVERY.has(doc.deliveryStatus)) score *= 0.5

    scored.push({
      path: doc.path,
      title: doc.title,
      purpose: doc.purpose,
      docKind: doc.docKind,
      layer: doc.layer,
      status: doc.status,
      score: Math.round(score * 100) / 100,
      why: explain(hits, doc),
      raw,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return scored.slice(0, limit).map(({ raw: _raw, ...rest }) => rest)
}

function explain(hits: FieldHit[], doc: BankDoc): string {
  const parts: string[] = []
  for (const hit of hits) {
    switch (hit.field) {
      case 'canonicalFor':
        if (hit.detail) parts.push(`owns canonical_for: ${hit.detail}`)
        break
      case 'purpose':
        parts.push(`purpose matches "${hit.token}"`)
        break
      case 'title':
        parts.push(`title matches "${hit.token}"`)
        break
      case 'section':
        if (hit.detail) parts.push(`has section "${hit.detail}"`)
        break
    }
  }
  if (doc.layer === 'delivery') parts.push('delivery-layer document, ranked below knowledge')
  return parts.join('; ')
}
