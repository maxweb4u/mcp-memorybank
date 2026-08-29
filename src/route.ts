import type { BankDoc, Layer } from './types.js'
import { LAYER_WEIGHT } from './layer.js'
import type { Bank } from './bank.js'

const FIELD_WEIGHT = { canonicalFor: 5, purpose: 3, title: 2, section: 1 } as const

const STATUS_WEIGHT: Record<string, number> = { active: 1, draft: 0.7, archived: 0.2 }
const CLOSED_DELIVERY = new Set(['done', 'cancelled'])

const STOP = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'what', 'where', 'how',
  'which', 'that', 'this', 'do', 'does', 'when', 'why', 'who', 'with', 'about', 'i', 'we', 'it',
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

function scoreField(tokens: string[], words: string[]): { score: number; hits: string[] } {
  const set = new Set(words)
  let score = 0
  const hits: string[] = []
  for (const token of tokens) {
    if (set.has(token)) {
      score += 1
      hits.push(token)
    } else if (token.length >= 4 && words.some((w) => w.startsWith(token) || token.startsWith(w))) {
      score += 0.6
      hits.push(token)
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

/** ADRs exist to answer "why"; a why-question should outrank the component description. */
const WHY = /(\bwhy\b|\brationale\b|\bdecision\b|\bdecided\b|instead of|trade-?off|почему)/i

function layerWeights(question: string): Record<Layer, number> {
  if (!WHY.test(question)) return LAYER_WEIGHT
  return { ...LAYER_WEIGHT, decision: 1.6, knowledge: 1.2 }
}

export function route(bank: Bank, question: string, opts: RouteOptions = {}): RouteResult[] {
  const tokens = tokenize(question)
  const weights = layerWeights(question)
  if (tokens.length === 0) return []
  const limit = opts.limit ?? 5
  const scored: (RouteResult & { raw: number })[] = []

  for (const doc of bank.all()) {
    // Templates are structurally similar to every real document and would flood the list.
    if (doc.docFunction === 'template') continue
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
      const { score } = scoreField(tokens, words)
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

    const purpose = scoreField(tokens, tokenize(doc.purpose))
    if (purpose.score > 0) {
      raw += purpose.score * FIELD_WEIGHT.purpose
      hits.push({ field: 'purpose', token: purpose.hits.join(', '), exact: true })
    }

    const title = scoreField(tokens, tokenize(doc.title))
    if (title.score > 0) {
      raw += title.score * FIELD_WEIGHT.title
      hits.push({ field: 'title', token: title.hits.join(', '), exact: true })
    }

    let bestSection: string | undefined
    let sectionScore = 0
    for (const section of doc.sections) {
      const s = scoreField(tokens, tokenize(section.title))
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
