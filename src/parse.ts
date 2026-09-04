import matter from 'gray-matter'
import path from 'node:path'
import type { BankDoc, Edge, IndexLink, Section } from './types.js'
import { layerOf } from './layer.js'

/** Resolve a link written inside `fromDoc` into a bank-relative POSIX path. */
export function resolveFrom(fromDoc: string, target: string): { resolved: string | null; external: boolean } {
  const clean = target.split('#')[0]!.trim()
  if (!clean) return { resolved: null, external: false }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromDoc), clean))
  if (joined.startsWith('..')) return { resolved: null, external: true }
  return { resolved: joined, external: false }
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * `derived_from` appears in two forms in real banks: a bare path string, and
 * `{ path, fit }` where `fit` narrows what is actually inherited.
 */
function parseEdges(docPath: string, value: unknown): Edge[] {
  if (!Array.isArray(value)) return []
  const edges: Edge[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      edges.push({ raw: item, ...resolveFrom(docPath, item) })
    } else if (item && typeof item === 'object' && typeof (item as any).path === 'string') {
      const raw = (item as any).path as string
      const fit = typeof (item as any).fit === 'string' ? ((item as any).fit as string) : undefined
      edges.push({ raw, fit, ...resolveFrom(docPath, raw) })
    }
  }
  return edges
}

/** Line indices that sit inside a fenced code block, so headings there are ignored. */
function fencedLines(lines: string[]): Set<number> {
  const inside = new Set<number>()
  let open = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      open = !open
      inside.add(i)
      return
    }
    if (open) inside.add(i)
  })
  return inside
}

function extractSections(body: string, offset: number): Section[] {
  const lines = body.split('\n')
  const fenced = fencedLines(lines)
  const out: Section[] = []
  lines.forEach((line, i) => {
    if (fenced.has(i)) return
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ title: m[1]!, line: offset + i + 1 })
  })
  return out
}

function firstHeading(body: string): string | null {
  const lines = body.split('\n')
  const fenced = fencedLines(lines)
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]!)
    if (m) return m[1]!
  }
  return null
}

/** Count of body lines that precede the frontmatter block's end, for section line numbers. */
function frontmatterOffset(raw: string): number {
  if (!raw.startsWith('---')) return 0
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return 0
  return raw.slice(0, end).split('\n').length + 1
}

/**
 * Line-based frontmatter reader used when YAML parsing fails.
 * 22 documents across the real banks have unquoted colons in `purpose`, which is invalid YAML.
 * Losing their metadata would drop core knowledge documents out of routing, so the values are
 * recovered leniently and the parse error is kept for `bank_validate` to report.
 */
export function lenientFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }

  const head = raw.slice(4, end).split('\n')
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1)
  const data: Record<string, unknown> = {}
  let currentKey: string | null = null
  let list: unknown[] = []
  let pending: { path: string; fit?: string } | null = null

  const flush = () => {
    if (currentKey && list.length > 0) data[currentKey] = list
    list = []
    pending = null
  }
  const unquote = (v: string) => v.trim().replace(/^["']/, '').replace(/["']$/, '').trim()

  for (const line of head) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && currentKey) {
      const objPath = /^path:\s*(.+)$/.exec(item[1]!.trim())
      if (objPath) {
        pending = { path: unquote(objPath[1]!) }
        list.push(pending)
      } else {
        pending = null
        list.push(unquote(item[1]!))
      }
      continue
    }
    const fit = /^\s+fit:\s*(.+)$/.exec(line)
    if (fit && pending) {
      pending.fit = unquote(fit[1]!)
      continue
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    flush()
    currentKey = pair[1]!
    const inline = pair[2]!.trim()
    if (inline) data[currentKey] = unquote(inline)
  }
  flush()
  return { data, body }
}

/**
 * The one place frontmatter is split. Options are always passed to gray-matter on purpose: without
 * them it memoises by content, and a document whose YAML threw once returns a cached result on the
 * next call — no error, and the whole frontmatter silently inside `content`.
 */
export function splitFrontmatter(raw: string): {
  data: Record<string, unknown>
  body: string
  error?: string
} {
  try {
    const parsed = matter(raw, { language: 'yaml' })
    return { data: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content }
  } catch (err) {
    const lenient = lenientFrontmatter(raw)
    return { ...lenient, error: (err instanceof Error ? err.message : String(err)).split('\n')[0]! }
  }
}

export function parseDoc(bankRelativePath: string, raw: string, mtimeMs: number): BankDoc {
  const base: BankDoc = {
    path: bankRelativePath,
    title: '',
    docKind: '',
    docFunction: '',
    purpose: '',
    status: '',
    layer: layerOf(bankRelativePath),
    derivedFrom: [],
    canonicalFor: [],
    mustNotDefine: [],
    anchors: [],
    sections: [],
    registeredIn: [],
    fields: [],
    hasFrontmatter: raw.startsWith('---'),
    mtimeMs,
    bytes: Buffer.byteLength(raw),
  }

  const split = splitFrontmatter(raw)
  const data = split.data
  const body = split.body
  if (split.error) base.parseError = split.error

  const offset = frontmatterOffset(raw)
  base.fields = Object.keys(data)
  base.sections = extractSections(body, offset)

  const str = (key: string): string => (typeof data[key] === 'string' ? (data[key] as string).trim() : '')
  base.docKind = str('doc_kind')
  base.docFunction = str('doc_function')
  base.purpose = str('purpose')
  base.status = str('status')

  const delivery = str('delivery_status')
  if (delivery) base.deliveryStatus = delivery
  const decision = str('decision_status')
  if (decision) base.decisionStatus = decision

  base.derivedFrom = parseEdges(bankRelativePath, data['derived_from'])
  base.canonicalFor = asStringList(data['canonical_for']).map((s) => s.trim())
  base.mustNotDefine = asStringList(data['must_not_define']).map((s) => s.trim())
  base.anchors = asStringList(data['anchors'])
    .map((s) => s.trim().replace(/^\.?\//, ''))
    .filter(Boolean)

  // `title` is missing on ~26% of real documents; fall back to the first H1, then the filename.
  base.title = str('title') || firstHeading(body) || path.posix.basename(bankRelativePath, '.md')

  return base
}

const LINK = /\[[^\]]*\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g

/** Markdown links to `.md` files, in any shape: bullet, table row, numbered item or prose. */
export function extractLinks(docPath: string, raw: string): IndexLink[] {
  const out: IndexLink[] = []
  raw.split('\n').forEach((line, i) => {
    LINK.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = LINK.exec(line)) !== null) {
      const target = m[1]!
      const { resolved } = resolveFrom(docPath, target)
      out.push({ from: docPath, to: resolved, raw: target, line: i + 1 })
    }
  })
  return out
}
