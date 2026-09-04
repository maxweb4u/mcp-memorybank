import fs from 'node:fs/promises'
import nodePath from 'node:path'
import type { Bank } from './bank.js'
import type { Layer } from './types.js'
import { lenientFrontmatter } from './parse.js'

export type Direction = 'up' | 'down' | 'both'

export interface GraphNode {
  path: string
  title: string
  docKind: string
  layer: Layer
  status: string
  /** Hops from the root document. The root itself is 0. */
  depth: number
  /** Which traversal reached this node. */
  via: Direction
}

export interface GraphEdge {
  /** The document that declares the dependency. */
  from: string
  /** The upstream document it leans on. */
  to: string
  fit?: string
}

export interface GraphResult {
  root: string
  direction: Direction
  depth: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Edges leaving the bank root — nested banks in a monorepo. */
  external: { from: string; raw: string }[]
  /** Edges whose target does not exist. */
  broken: { from: string; raw: string }[]
  /** How many documents each layer contributes, for a quick read of blast radius. */
  byLayer: Record<string, number>
  /** True when the traversal hit the node cap before exhausting the depth. */
  truncated: boolean
}

export interface GraphOptions {
  direction?: Direction
  depth?: number
  limit?: number
}

const DEFAULT_DEPTH = 2
const DEFAULT_LIMIT = 60

export function graph(bank: Bank, docPath: string, opts: GraphOptions = {}): GraphResult {
  const root = bank.get(docPath)
  if (!root) throw new Error(`Not a document of this bank: ${docPath}`)

  const direction = opts.direction ?? 'down'
  const depth = Math.max(1, opts.depth ?? DEFAULT_DEPTH)
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)

  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const external: { from: string; raw: string }[] = []
  const broken: { from: string; raw: string }[] = []
  let truncated = false

  const addNode = (path: string, d: number, via: Direction): boolean => {
    const existing = nodes.get(path)
    if (existing) {
      if (d < existing.depth) existing.depth = d
      return false
    }
    if (nodes.size >= limit) {
      truncated = true
      return false
    }
    const doc = bank.get(path)!
    nodes.set(path, {
      path,
      title: doc.title,
      docKind: doc.docKind,
      layer: doc.layer,
      status: doc.status,
      depth: d,
      via,
    })
    return true
  }

  const addEdge = (from: string, to: string, fit?: string): void => {
    const key = `${from} ${to}`
    if (!edges.has(key)) edges.set(key, fit ? { from, to, fit } : { from, to })
  }

  addNode(root.path, 0, direction)

  /** One breadth-first sweep. Cycles are harmless: a visited node is never expanded twice. */
  const sweep = (way: 'up' | 'down'): void => {
    let frontier = [root.path]
    const expanded = new Set<string>()
    for (let d = 1; d <= depth; d++) {
      const next: string[] = []
      for (const current of frontier) {
        if (expanded.has(current)) continue
        expanded.add(current)
        const doc = bank.get(current)
        if (!doc) continue

        if (way === 'up') {
          for (const edge of doc.derivedFrom) {
            if (edge.external) {
              external.push({ from: current, raw: edge.raw })
              continue
            }
            if (!edge.resolved) continue
            if (!bank.docs.has(edge.resolved)) {
              broken.push({ from: current, raw: edge.raw })
              continue
            }
            if (addNode(edge.resolved, d, 'up')) next.push(edge.resolved)
            if (nodes.has(edge.resolved)) addEdge(current, edge.resolved, edge.fit)
          }
        } else {
          for (const dependent of bank.incoming.get(current) ?? []) {
            const edge = bank.get(dependent)?.derivedFrom.find((e) => e.resolved === current)
            if (addNode(dependent, d, 'down')) next.push(dependent)
            if (nodes.has(dependent)) addEdge(dependent, current, edge?.fit)
          }
        }
      }
      frontier = next
      if (frontier.length === 0) break
    }
  }

  if (direction === 'up' || direction === 'both') sweep('up')
  if (direction === 'down' || direction === 'both') sweep('down')

  const byLayer: Record<string, number> = {}
  for (const node of nodes.values()) {
    if (node.path === root.path) continue
    byLayer[node.layer] = (byLayer[node.layer] ?? 0) + 1
  }

  return {
    root: root.path,
    direction,
    depth,
    nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    external,
    broken,
    byLayer,
    truncated,
  }
}

/**
 * One document in a neighbouring bank, read for the graph and nothing else.
 *
 * The bank boundary is real: nothing here is indexed, validated, routed or searched. But in a
 * monorepo the `derived_from` edges that cross it are real too, and stopping at the boundary makes
 * "what else must I touch" knowingly incomplete. So the header — and only the header — is read.
 */
export interface Neighbour {
  /** The document in this bank that declares the edge. */
  from: string
  /** Exactly as written in the frontmatter. */
  raw: string
  /** Where the edge points, relative to the directory the search was allowed to reach. */
  file: string
  title?: string
  docKind?: string
  status?: string
  purpose?: string
  /** What the neighbour claims to own, which is the usual reason the edge exists. */
  canonicalFor?: string[]
  /** Set instead of the header fields when the target could not be read. Says which. */
  unreadable?: string
}

/** How far above the bank root an external edge may reach. Two is what a monorepo needs; three is slack. */
const NEIGHBOUR_CEILING = 3

/** Reading headers is cheap, but an unbounded fan-out into a workspace is not. */
const MAX_NEIGHBOURS = 25

/**
 * Resolves the external edges of a graph result one hop, by reading each target's frontmatter.
 *
 * Kept out of {@link graph} on purpose: that function is pure and synchronous, and every caller that
 * does not want to touch the disk should keep being able to call it.
 */
export async function resolveNeighbours(
  bank: Bank,
  external: { from: string; raw: string }[],
): Promise<Neighbour[]> {
  if (external.length === 0) return []

  const ceiling = nodePath.resolve(bank.root, '../'.repeat(NEIGHBOUR_CEILING))
  const out: Neighbour[] = []

  for (const edge of external.slice(0, MAX_NEIGHBOURS)) {
    const target = edge.raw.split('#')[0]!.trim()
    const abs = nodePath.resolve(nodePath.dirname(bank.abs(edge.from)), target)
    const shown = nodePath.relative(ceiling, abs) || abs

    const record: Neighbour = { from: edge.from, raw: edge.raw, file: shown }
    out.push(record)

    const inside = abs === ceiling || abs.startsWith(ceiling + nodePath.sep)
    if (!inside) {
      record.unreadable = `outside the ${NEIGHBOUR_CEILING} directory levels above this bank, so it was not read`
      continue
    }
    if (!abs.endsWith('.md')) {
      record.unreadable = 'not a markdown file'
      continue
    }

    let raw: string
    try {
      raw = await fs.readFile(abs, 'utf8')
    } catch {
      record.unreadable = 'no such file — the edge is broken, not merely external'
      continue
    }

    const { data } = lenientFrontmatter(raw)
    const str = (key: string): string | undefined => {
      const value = data[key]
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    }
    record.title = str('title') ?? nodePath.basename(abs, '.md')
    record.docKind = str('doc_kind')
    record.status = str('status')
    record.purpose = str('purpose')
    const owns = data['canonical_for']
    if (Array.isArray(owns)) {
      const keys = owns.filter((k): k is string => typeof k === 'string').map((k) => k.trim())
      if (keys.length > 0) record.canonicalFor = keys
    } else if (typeof owns === 'string' && owns.trim()) {
      record.canonicalFor = [owns.trim()]
    }
  }

  return out
}
