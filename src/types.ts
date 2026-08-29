/** Knowledge layer of a document, derived from its top-level directory. */
export type Layer = 'dna' | 'knowledge' | 'decision' | 'delivery' | 'flow' | 'inbox' | 'other'

/** One `derived_from` entry. The bank uses two forms: a bare path, or `{ path, fit }`. */
export interface Edge {
  /** Exactly as written in the document. */
  raw: string
  /** Present only in the object form; explains the scope of the dependency. */
  fit?: string
  /** Bank-relative POSIX path, resolved against the document's own directory. */
  resolved: string | null
  /** True when the target lies outside the bank root (nested banks in a monorepo). */
  external: boolean
}

export interface Section {
  title: string
  line: number
}

export interface BankDoc {
  /** Bank-relative POSIX path. */
  path: string
  title: string
  docKind: string
  docFunction: string
  purpose: string
  status: string
  layer: Layer
  derivedFrom: Edge[]
  canonicalFor: string[]
  mustNotDefine: string[]
  deliveryStatus?: string
  decisionStatus?: string
  /** Level-two headings, for section-scoped reads. */
  sections: Section[]
  /** Index documents that link to this one. */
  registeredIn: string[]
  /** Every frontmatter key present, for contract checks. */
  fields: string[]
  hasFrontmatter: boolean
  parseError?: string
  mtimeMs: number
  bytes: number
}

/** Markdown link found inside an index document. */
export interface IndexLink {
  /** Index document that carries the link. */
  from: string
  /** Bank-relative resolved path, or null when it escapes the root. */
  to: string | null
  raw: string
  line: number
}

/**
 * Allowed values, read from the bank's own `dna/` documents rather than hardcoded.
 * Absent when the bank has no `dna/` directory — the server then runs degraded.
 */
export interface Contract {
  present: boolean
  source: string[]
  docKinds: Set<string>
  docFunctions: Set<string>
  statuses: Set<string>
  deliveryStatuses: Set<string>
  decisionStatuses: Set<string>
  /** Documents with no `derived_from` that the contract names as tree roots. */
  roots: Set<string>
  /** Governance states that every active non-root document must declare `derived_from`. */
  requiresDerivedFrom: boolean
  /** Governance forbids cycles in the dependency tree. */
  forbidsCycles: boolean
}
