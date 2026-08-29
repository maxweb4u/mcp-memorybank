import type { Bank } from './bank.js'
import type { Layer } from './types.js'

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
