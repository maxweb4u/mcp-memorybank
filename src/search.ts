import { splitFrontmatter } from './parse.js'
import type { Bank } from './bank.js'
import type { Layer } from './types.js'
import { expandTerms, RU_STOP } from './lang.js'

export interface SearchHit {
  path: string
  title: string
  docKind: string
  layer: Layer
  status: string
  score: number
  /** The matching line, trimmed. */
  excerpt: string
  line: number
  /** How many times the query terms occur in the document. */
  hits: number
}

export interface SearchOptions {
  limit?: number
  docKind?: string
  layer?: Layer
  status?: string
}

/**
 * Whole words as written: `ft-smd-843`, `req-04`, `filter_thresholds`. Cyrillic is a word character
 * here: the banks are English, but a document may quote a Russian source, and a separator class that
 * excluded Cyrillic would drop that text out of the index entirely rather than merely rank it low.
 */
export function searchTokens(text: string): string[] {
  const out: string[] = []
  for (const token of text.toLowerCase().split(/[^a-z0-9_\u0400-\u04ff-]+/i)) {
    const clean = token.replace(/^[-_]+|[-_]+$/g, '')
    if (clean.length >= 2) out.push(clean)
  }
  return out
}

/** Parts of a compound token, so `filter_thresholds` is also reachable by "thresholds". */
export function tokenParts(token: string): string[] {
  if (!/[-_]/.test(token)) return []
  return token.split(/[-_]+/).filter((p) => p.length >= 2)
}

/**
 * The index stores compounds and their parts alike. A query, though, must weigh the whole token far
 * above its parts: `features/README.md` lists seventy `FT-SMD-*` rows, so scoring the query
 * `FT-SMD-843` by its "ft" and "smd" fragments would put the registry above the feature itself.
 */
function indexTokens(text: string): string[] {
  const out: string[] = []
  for (const token of searchTokens(text)) {
    out.push(token)
    out.push(...tokenParts(token))
  }
  return out
}

/** A header hit through the dictionary counts, but below one the user typed outright. */
const CROSS_LANGUAGE_DISCOUNT = 0.6

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were', 'not', 'but', 'its',
  'has', 'have', 'had', 'can', 'may', 'must', 'when', 'which', 'what', 'where', 'how', 'why',
  ...RU_STOP,
])

interface Posting {
  /** Occurrences of the token in the document body. */
  count: number
}

/** Inverted index over document bodies. Rebuilt only for documents whose mtime moved. */
export class SearchIndex {
  private postings = new Map<string, Map<string, Posting>>()
  private indexed = new Map<string, number>()
  /** Lower-cased body, without frontmatter, for phrase matching and excerpts. */
  private bodies = new Map<string, string>()

  private removeDoc(path: string): void {
    for (const token of this.postings.values()) token.delete(path)
    this.indexed.delete(path)
    this.bodies.delete(path)
  }

  /** Re-reads only what changed; returns how many documents were re-indexed. */
  sync(bank: Bank): number {
    let touched = 0
    for (const path of [...this.indexed.keys()]) {
      if (!bank.docs.has(path)) {
        this.removeDoc(path)
        touched++
      }
    }

    for (const doc of bank.all()) {
      if (this.indexed.get(doc.path) === doc.mtimeMs) continue
      this.removeDoc(doc.path)

      const raw = bank.raw(doc.path)
      if (raw === undefined) continue
      // Same split as the parser: a document whose YAML is invalid must still have its
      // frontmatter kept out of the body, or its field values would leak into search results.
      const body = splitFrontmatter(raw).body
      const lower = body.toLowerCase()
      this.bodies.set(doc.path, lower)

      for (const token of indexTokens(body)) {
        let bucket = this.postings.get(token)
        if (!bucket) {
          bucket = new Map()
          this.postings.set(token, bucket)
        }
        const posting = bucket.get(doc.path)
        if (posting) posting.count++
        else bucket.set(doc.path, { count: 1 })
      }

      this.indexed.set(doc.path, doc.mtimeMs)
      touched++
    }
    return touched
  }

  get size(): number {
    return this.postings.size
  }

  body(path: string): string | undefined {
    return this.bodies.get(path)
  }

  has(token: string): boolean {
    return this.postings.has(token)
  }

  /**
   * Indexed tokens starting with `prefix`. Russian inflects the ending, so a query for `пороги`
   * only reaches an indexed `порогов` through the shared stem the dictionary supplies.
   */
  tokensWithPrefix(prefix: string): string[] {
    if (prefix.length < 3) return []
    const out: string[] = []
    for (const token of this.postings.keys()) if (token.startsWith(prefix)) out.push(token)
    return out
  }

  /** Weighted occurrence count per document; `weight` separates whole tokens from fragments. */
  candidates(tokens: { token: string; weight: number }[]): Map<string, number> {
    const scores = new Map<string, number>()
    for (const { token, weight } of tokens) {
      const bucket = this.postings.get(token)
      if (!bucket) continue
      for (const [path, posting] of bucket) {
        scores.set(path, (scores.get(path) ?? 0) + posting.count * weight)
      }
    }
    return scores
  }

  /**
   * Documents containing every query concept, so a multi-word query narrows instead of widening.
   * A concept is one query word together with its equivalents: a document that has `threshold` but
   * not `пороги` still satisfies the term the user typed in Russian.
   */
  matchingAll(concepts: string[][]): Set<string> {
    let acc: Set<string> | null = null
    for (const variants of concepts) {
      const here = new Set<string>()
      for (const variant of variants) {
        const bucket = this.postings.get(variant)
        if (bucket) for (const path of bucket.keys()) here.add(path)
      }
      if (acc === null) acc = here
      else for (const path of [...acc]) if (!here.has(path)) acc.delete(path)
      if (acc.size === 0) break
    }
    return acc ?? new Set()
  }
}

function excerptFor(body: string, raw: string, terms: string[]): { excerpt: string; line: number } {
  const lines = raw.split('\n')
  const lower = lines.map((l) => l.toLowerCase())
  const bodyOffset = lines.length - body.split('\n').length

  let best = -1
  let bestScore = 0
  for (let i = Math.max(0, bodyOffset); i < lower.length; i++) {
    const line = lower[i]!
    if (line.trim().length === 0) continue
    let score = 0
    for (const term of terms) if (line.includes(term)) score++
    // A heading repeats the title; prefer a line that carries actual content on a tie.
    if (line.trimStart().startsWith('#')) score *= 0.9
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  if (best === -1) return { excerpt: '', line: 0 }

  const text = lines[best]!.trim()
  return { excerpt: text.length > 240 ? `${text.slice(0, 237)}...` : text, line: best + 1 }
}

export function search(bank: Bank, index: SearchIndex, query: string, opts: SearchOptions = {}): SearchHit[] {
  const all = searchTokens(query)
  if (all.length === 0) return []
  // Drop stopwords only when something else remains, so a literal query still works.
  const meaningful = all.filter((t) => !STOP.has(t))
  const primary = meaningful.length > 0 ? meaningful : all
  const limit = opts.limit ?? 10
  const phrase = query.trim().toLowerCase()

  // Three tiers, in descending confidence: the word as typed, its equivalent in the other
  // language, and a fragment of a compound token. Only the first is what the user actually wrote.
  const weighted = primary.map((token) => ({ token, weight: 10 }))
  const concepts: string[][] = []
  const terms: string[] = [...primary]

  for (const term of expandTerms(primary)) {
    const variants = [term.literal]
    for (const translation of term.translations) {
      for (const form of index.has(translation) ? [translation] : index.tokensWithPrefix(translation)) {
        weighted.push({ token: form, weight: 6 })
        variants.push(form)
        terms.push(form)
      }
    }
    // The same-language stem catches inflection: `пороги` typed, `порогов` indexed.
    if (term.stem) {
      for (const form of index.tokensWithPrefix(term.stem)) {
        if (form === term.literal) continue
        weighted.push({ token: form, weight: 6 })
        variants.push(form)
      }
    }
    if (!index.has(term.literal)) {
      // Fragments only widen the net; they never outweigh the token the user actually typed.
      for (const part of tokenParts(term.literal)) {
        weighted.push({ token: part, weight: 1 })
        variants.push(part)
      }
    }
    concepts.push(variants)
  }

  // Everything added by the dictionary, i.e. the forms the user did not type.
  const translated = terms.slice(primary.length)

  const strict = index.matchingAll(concepts)
  const counts = index.candidates(weighted)
  const pool = strict.size > 0 ? strict : new Set(counts.keys())

  const hits: SearchHit[] = []
  for (const path of pool) {
    const doc = bank.get(path)
    if (!doc) continue
    if (doc.docFunction === 'template') continue
    if (doc.layer === 'inbox') continue // quarantine: reachable by bank_read and the inbox tools only
    if (opts.docKind && doc.docKind !== opts.docKind) continue
    if (opts.layer && doc.layer !== opts.layer) continue
    if (opts.status && doc.status !== opts.status) continue

    const body = index.body(path)
    if (body === undefined) continue

    const count = counts.get(path) ?? 0
    let score = count / 10
    if (phrase.includes(' ') && body.includes(phrase)) score += 25
    // The phrase bonuses key off the query as typed, so a translated query would lose them entirely
    // and fall back to raw frequency — which ranks whichever document merely says the word most.
    // An equivalent hitting the header earns the same bonus, discounted like any translation.
    const title = doc.title.toLowerCase()
    const purpose = doc.purpose.toLowerCase()
    if (title.includes(phrase)) score += 15
    else if (translated.some((t) => title.includes(t))) score += 15 * CROSS_LANGUAGE_DISCOUNT
    if (purpose.includes(phrase)) score += 10
    else if (translated.some((t) => purpose.includes(t))) score += 10 * CROSS_LANGUAGE_DISCOUNT
    if (doc.status === 'archived') score *= 0.3

    const raw = bank.raw(path) ?? ''
    const { excerpt, line } = excerptFor(body, raw, terms)

    hits.push({
      path,
      title: doc.title,
      docKind: doc.docKind,
      layer: doc.layer,
      status: doc.status,
      score: Math.round(score * 10) / 10,
      excerpt,
      line,
      hits: Math.round(count / 10),
    })
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return hits.slice(0, limit)
}
