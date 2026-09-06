import fs from 'node:fs/promises'
import type { Bank } from './bank.js'
import { LAYERS } from './layer.js'
import { shippedTemplateNames } from './init.js'
import type { BankDoc } from './types.js'

export type Severity = 'error' | 'warning'

export interface Finding {
  severity: Severity
  rule: string
  path: string
  message: string
  /** Line in `path` the finding points at, when it comes from the body. */
  line?: number
}

export interface ValidateOptions {
  /** Restrict to one subdirectory of the bank. */
  scope?: string
  severity?: Severity
  rule?: string
}

/** Ordered by measured productivity across the real banks, most findings first. */
export const RULES = [
  'invalid-frontmatter',
  'broken-derived-from',
  'missing-derived-from',
  'cycle-in-derived-from',
  'unregistered-doc',
  'unresolved-rule-reference',
  'unknown-enum-value',
  'ssot-conflict',
  'must-not-define-violated',
  'dangling-index-entry',
  'unknown-layer-value',
  'no-contract',
] as const

function inScope(doc: BankDoc, scope?: string): boolean {
  if (!scope) return true
  const prefix = scope.replace(/^\.?\//, '').replace(/\/$/, '')
  return doc.path === prefix || doc.path.startsWith(`${prefix}/`)
}

/** A document is a tree root when the contract names it, or when it is `dna/principles.md`. */
function isRoot(bank: Bank, doc: BankDoc): boolean {
  return bank.contract.roots.has(doc.path)
}

function structural(bank: Bank, scope?: string): Finding[] {
  const out: Finding[] = []
  const docs = bank.all().filter((d) => inScope(d, scope))

  for (const doc of docs) {
    if (doc.parseError) {
      out.push({
        severity: 'error',
        rule: 'invalid-frontmatter',
        path: doc.path,
        message: `YAML frontmatter does not parse (${doc.parseError}). Values were recovered leniently; quote any value containing ": ".`,
      })
    }

    for (const edge of doc.derivedFrom) {
      if (edge.external || !edge.resolved) continue
      if (!bank.docs.has(edge.resolved)) {
        out.push({
          severity: 'error',
          rule: 'broken-derived-from',
          path: doc.path,
          message: `derived_from points at a file that does not exist: ${edge.raw}`,
        })
      }
    }

    if (
      bank.contract.requiresDerivedFrom &&
      doc.status === 'active' &&
      doc.derivedFrom.length === 0 &&
      !isRoot(bank, doc)
    ) {
      out.push({
        severity: 'error',
        rule: 'missing-derived-from',
        path: doc.path,
        message: 'Governance requires every active non-root document to declare derived_from.',
      })
    }

    if (doc.canonicalFor.length > 0 && doc.mustNotDefine.length > 0) {
      const forbidden = new Set(doc.mustNotDefine)
      for (const key of doc.canonicalFor) {
        if (forbidden.has(key)) {
          out.push({
            severity: 'error',
            rule: 'must-not-define-violated',
            path: doc.path,
            message: `Document owns "${key}" while its own must_not_define forbids it.`,
          })
        }
      }
    }

    // Quarantine sits outside navigation on purpose until it is promoted.
    if (
      doc.registeredIn.length === 0 &&
      doc.layer !== 'inbox' &&
      doc.docFunction !== 'index' &&
      !doc.path.endsWith('README.md')
    ) {
      out.push({
        severity: 'warning',
        rule: 'unregistered-doc',
        path: doc.path,
        message: 'No index links to this document, so navigation cannot reach it.',
      })
    }

    const c = bank.contract
    const unknown: [string, string, Set<string>][] = [
      ['doc_kind', doc.docKind, c.docKinds],
      ['doc_function', doc.docFunction, c.docFunctions],
      ['status', doc.status, c.statuses],
      ['delivery_status', doc.deliveryStatus ?? '', c.deliveryStatuses],
      ['decision_status', doc.decisionStatus ?? '', c.decisionStatuses],
    ]
    for (const [field, value, allowed] of unknown) {
      if (!value || allowed.size === 0) continue
      if (!allowed.has(value)) {
        out.push({
          severity: 'warning',
          rule: 'unknown-enum-value',
          path: doc.path,
          message: `${field}: "${value}" is not among the values declared in dna/ (${[...allowed].sort().join(', ')}).`,
        })
      }
    }
  }

  for (const [key, owners] of bank.ownerByKey) {
    if (owners.length < 2) continue
    const scoped = owners.filter((p) => inScope(bank.get(p)!, scope))
    if (scoped.length === 0) continue
    out.push({
      severity: 'error',
      rule: 'ssot-conflict',
      path: owners[0]!,
      message: `canonical_for "${key}" is claimed by ${owners.length} documents: ${owners.join(', ')}.`,
    })
  }

  for (const link of bank.indexLinks) {
    if (!link.to) continue
    const from = bank.get(link.from)
    if (!from || !inScope(from, scope)) continue
    if (!bank.docs.has(link.to)) {
      out.push({
        severity: 'error',
        rule: 'dangling-index-entry',
        path: link.from,
        line: link.line,
        message: `Index links to a file that does not exist: ${link.raw}`,
      })
    }
  }

  if (bank.contract.forbidsCycles) out.push(...cycles(bank, scope))
  return out
}

/** Back edges in the `derived_from` graph. Governance forbids cycles; 17 exist across the real banks. */
function cycles(bank: Bank, scope?: string): Finding[] {
  const out: Finding[] = []
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const reported = new Set<string>()

  const visit = (node: string): void => {
    state.set(node, 1)
    stack.push(node)
    const doc = bank.docs.get(node)
    for (const edge of doc?.derivedFrom ?? []) {
      const next = edge.resolved
      if (!next || !bank.docs.has(next)) continue
      const s = state.get(next) ?? 0
      if (s === 1) {
        const at = stack.indexOf(next)
        const loop = [...stack.slice(at), next]
        const id = [...loop].sort().join('>')
        if (!reported.has(id)) {
          reported.add(id)
          const target = bank.get(node)!
          if (inScope(target, scope)) {
            out.push({
              severity: 'error',
              rule: 'cycle-in-derived-from',
              path: node,
              message: `Cyclic derived_from: ${loop.join(' -> ')}.`,
            })
          }
        }
      } else if (s === 0) {
        visit(next)
      }
    }
    stack.pop()
    state.set(node, 2)
  }

  for (const node of bank.docs.keys()) if ((state.get(node) ?? 0) === 0) visit(node)
  return out
}

/**
 * A markdown link carries the claim in its text and the path in its destination, and only the
 * destination is authoritative: `owned by [domain/model.md](../../domain/model.md)` is correct
 * prose, and reading the text instead reports it as broken.
 */
const RULE_REF =
  /\b([A-Za-z][\w`, -]{4,60}?)\s+(?:is\s+|are\s+)?(?:defined|described|specified|owned|governed)\s+(?:by|in)\s+(?:\[[^\]]*\]\(([^)\s]+\.md)[^)]*\)|`?([\w./-]+\.md))/gi

/**
 * A document says "X is defined in Y.md" while Y.md does not resolve from that document.
 * Found in the wild: the `Done` gate of feature-flow.md requires a "simplify review defined by
 * testing-policy.md" — written as a bare filename that resolves to flows/testing-policy.md,
 * which does not exist. Checking resolution rather than wording keeps this precise: a claim whose
 * target does resolve is left alone, since prose cannot be matched against a rule by keyword.
 */
async function unresolvedRuleReferences(bank: Bank, scope?: string): Promise<Finding[]> {
  const out: Finding[] = []
  const shipped = await shippedTemplateNames()

  // `design.md` / `brief.md` occur once per feature package; a bare mention of such a name is
  // generic prose about package structure, not a reference to one file. A basename that exists
  // exactly once is unambiguous, so an unresolved mention of it is a real path mistake.
  const byBasename = new Map<string, string[]>()
  for (const doc of bank.docs.keys()) {
    const base = doc.slice(doc.lastIndexOf('/') + 1)
    const list = byBasename.get(base)
    if (list) list.push(doc)
    else byBasename.set(base, [doc])
  }

  for (const doc of bank.all()) {
    if (!inScope(doc, scope)) continue
    // Templates reference placeholder paths on purpose (`ADR-ID.md`, `FT-XXX/brief.md`).
    if (doc.docFunction === 'template') continue

    let raw: string
    try {
      raw = await fs.readFile(bank.abs(doc.path), 'utf8')
    } catch {
      continue
    }

    const lines = raw.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      RULE_REF.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = RULE_REF.exec(line)) !== null) {
        const phrase = m[1]!.replace(/`/g, '').trim()
        const targetRaw = (m[2] ?? m[3])!
        const target = resolveTarget(doc.path, targetRaw)
        if (target === null) continue // escapes the root: a nested-bank reference, not a defect
        if (target === doc.path || bank.docs.has(target)) continue

        const base = targetRaw.slice(targetRaw.lastIndexOf('/') + 1)
        const sameName = byBasename.get(base) ?? []
        if (!targetRaw.includes('/')) {
          // Several carriers, or a template filename: the mention is about package shape, not a file.
          if (sameName.length > 1) continue
          if (sameName.length === 1 && bank.get(sameName[0]!)?.docFunction === 'template') continue
          // A bank that points at the shipped templates rather than copying them has no such
          // document to find, but the name means exactly the same thing.
          if (sameName.length === 0 && shipped.has(base)) continue
        }

        const hint = sameName.length === 1 ? ` Did you mean ${sameName[0]}?` : ''
        out.push({
          severity: 'warning',
          rule: 'unresolved-rule-reference',
          path: doc.path,
          line: i + 1,
          message: `Claims "${phrase}" is defined in ${targetRaw}, but that path does not resolve from this document (tried ${target}).${hint}`,
        })
      }
    }
  }
  return out
}

function resolveTarget(fromDoc: string, target: string): string | null {
  const parts = fromDoc.split('/')
  parts.pop()
  const segments = [...parts, ...target.split('/')]
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else stack.push(seg)
  }
  return stack.join('/')
}

const ORDER = new Map(RULES.map((r, i) => [r as string, i]))

export async function validate(bank: Bank, opts: ValidateOptions = {}): Promise<Finding[]> {
  // Most rules are structural and need no contract; only missing-derived-from, the cycle rule and
  // unknown-enum-value depend on what dna/ declares, and each gates itself on that.
  const findings = [...structural(bank, opts.scope), ...(await unresolvedRuleReferences(bank, opts.scope))]

  // A layer table that names a layer which does not exist is silent otherwise: the row is skipped,
  // the directory keeps whatever the built-in map says, and ranking quietly differs from the
  // declaration. Reported here rather than thrown, because one bad row should not void the table.
  for (const row of bank.layers.unknown) {
    if (opts.scope && !row.source.startsWith(opts.scope.replace(/^\.?\//, '').replace(/\/$/, ''))) continue
    findings.push({
      severity: 'warning',
      rule: 'unknown-layer-value',
      path: row.source,
      message: `"${row.dir}" is declared as layer "${row.layer}", which is not one of ${LAYERS.join(', ')}. The row is ignored and "${row.dir}" keeps its default layer.`,
    })
  }
  if (!bank.contract.present) {
    findings.push({
      severity: 'warning',
      rule: 'no-contract',
      path: 'dna/',
      message:
        'This bank has no dna/ directory, so contract-dependent rules (missing derived_from, cycles, declared values) are not applied.',
    })
  }
  const filtered = findings
    .filter((f) => (opts.severity ? f.severity === opts.severity : true))
    .filter((f) => (opts.rule ? f.rule === opts.rule : true))

  filtered.sort(
    (a, b) =>
      (ORDER.get(a.rule) ?? 99) - (ORDER.get(b.rule) ?? 99) ||
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0),
  )
  return filtered
}
