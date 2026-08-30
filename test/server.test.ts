import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixture-bank')
const ENTRY = path.join(here, '..', 'dist', 'cli.js')

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [ENTRY, '--root', FIXTURE] }),
  )
  return client
}

describe('stdio server', () => {
  it('exposes the tools, resources and prompt, and answers a call', async () => {
    const client = await connect()
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        'bank_changed',
        'bank_create',
        'bank_graph',
        'bank_init',
        'bank_promote',
        'bank_read',
        'bank_route',
        'bank_search',
        'bank_validate',
      ])

      const resources = await client.listResources()
      expect(resources.resources.map((r) => r.uri).sort()).toEqual([
        'memorybank://health',
        'memorybank://inbox',
        'memorybank://index',
        'memorybank://schema/frontmatter',
      ])

      const prompts = await client.listPrompts()
      expect(prompts.prompts.map((p) => p.name).sort()).toEqual([
        'check-before-commit',
        'record-adr',
        'review-inbox',
        'route-then-read',
      ])

      const routed = await client.callTool({ name: 'bank_route', arguments: { question: 'filter thresholds' } })
      const payload = JSON.parse((routed.content as { text: string }[])[0]!.text)
      expect(payload.results[0].path).toBe('domain/rules.md')

      const section = await client.callTool({
        name: 'bank_read',
        arguments: { path: 'domain/rules.md', section: 'Thresholds' },
      })
      const doc = JSON.parse((section.content as { text: string }[])[0]!.text)
      expect(doc.section).toBe('Thresholds')
      expect(doc.frontmatter.doc_kind).toBe('domain')

      const index = await client.readResource({ uri: 'memorybank://index' })
      const listed = JSON.parse((index.contents[0] as { text: string }).text)
      expect(listed.count).toBe(15) // 17 files minus two templates
      expect(listed.documents.map((d: { path: string }) => d.path)).not.toContain(
        'flows/templates/feature/brief.md',
      )

      const schema = await client.readResource({ uri: 'memorybank://schema/frontmatter' })
      expect((schema.contents[0] as { text: string }).text).toContain('# Frontmatter Schema')

      const checked = await client.callTool({ name: 'bank_validate', arguments: { rule: 'ssot-conflict' } })
      const report = JSON.parse((checked.content as { text: string }[])[0]!.text)
      expect(report.total).toBe(1)
      expect(report.findings[0].message).toContain('filter_thresholds')

      const walked = await client.callTool({
        name: 'bank_graph',
        arguments: { path: 'domain/rules.md', direction: 'down', depth: 1 },
      })
      const g = JSON.parse((walked.content as { text: string }[])[0]!.text)
      expect(g.nodes.map((n: { path: string }) => n.path)).toContain('features/FT-001/brief.md')

      const found = await client.callTool({ name: 'bank_search', arguments: { query: 'rejects below 60' } })
      const results = JSON.parse((found.content as { text: string }[])[0]!.text).results
      expect(results[0].path).toBe('domain/rules.md')
      expect(results[0].excerpt).toContain('rejects below 60')

      const delta = await client.callTool({ name: 'bank_changed', arguments: { since: 'not-a-ref' } })
      expect(delta.isError).toBe(true)

      const health = await client.readResource({ uri: 'memorybank://health' })
      const state = JSON.parse((health.contents[0] as { text: string }).text)
      expect(state.documents).toBe(17)
      expect(state.byRule['broken-derived-from']).toBe(1)
    } finally {
      await client.close()
    }
  }, 20_000)

  it('reports a bad path as a tool error rather than crashing', async () => {
    const client = await connect()
    try {
      const bad = await client.callTool({ name: 'bank_read', arguments: { path: 'nope.md' } })
      expect(bad.isError).toBe(true)
      expect((bad.content as { text: string }[])[0]!.text).toContain('Not a document of this bank')
    } finally {
      await client.close()
    }
  }, 20_000)
})
