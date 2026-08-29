import type { Contract } from './types.js'

const FIELDS = ['doc_kind', 'doc_function', 'status', 'delivery_status', 'decision_status'] as const
type Field = (typeof FIELDS)[number]

const TOKEN = /`([a-z][a-z0-9_-]*)`/g
const NOISE = new Set(['enum', 'string', 'array', 'object', 'md', 'yaml', 'true', 'false'])

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/**
 * The contract lives in the bank itself (`dna/frontmatter.md`, `dna/governance.md`),
 * written as markdown tables. Rows are read as `| field | ... | allowed values |`,
 * and every backticked token after the first cell is taken as an allowed value.
 */
export function parseContract(docs: Map<string, string>): Contract {
  const found: Record<Field, Set<string>> = {
    doc_kind: new Set(),
    doc_function: new Set(),
    status: new Set(),
    delivery_status: new Set(),
    decision_status: new Set(),
  }
  const roots = new Set<string>()
  const source: string[] = []
  let requiresDerivedFrom = false
  let forbidsCycles = false

  for (const [docPath, raw] of docs) {
    if (!docPath.startsWith('dna/')) continue
    source.push(docPath)

    if (/must define `?derived_from`?/i.test(raw)) requiresDerivedFrom = true
    if (/cyclic dependencies are forbidden/i.test(raw)) forbidsCycles = true

    for (const line of raw.split('\n')) {
      const rootMatch = /root document is \[?`?([\w./-]+\.md)`?/i.exec(line)
      if (rootMatch) roots.add(`dna/${rootMatch[1]!.replace(/^\.\//, '')}`)

      if (!line.trim().startsWith('|')) continue
      const cs = cells(line)
      if (cs.length < 2) continue
      const head = cs[0]!.replace(/`/g, '').trim()
      if (!(FIELDS as readonly string[]).includes(head)) continue

      const rest = cs.slice(1).join(' | ')
      TOKEN.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = TOKEN.exec(rest)) !== null) {
        const token = m[1]!
        if (NOISE.has(token) || token === head) continue
        found[head as Field].add(token)
      }
    }
  }

  if (source.length === 0) {
    return {
      present: false,
      source: [],
      docKinds: new Set(),
      docFunctions: new Set(),
      statuses: new Set(),
      deliveryStatuses: new Set(),
      decisionStatuses: new Set(),
      roots: new Set(),
      requiresDerivedFrom: false,
      forbidsCycles: false,
    }
  }

  if (roots.size === 0 && docs.has('dna/principles.md')) roots.add('dna/principles.md')

  return {
    present: true,
    source: source.sort(),
    docKinds: found.doc_kind,
    docFunctions: found.doc_function,
    statuses: found.status,
    deliveryStatuses: found.delivery_status,
    decisionStatuses: found.decision_status,
    roots,
    requiresDerivedFrom,
    forbidsCycles,
  }
}
