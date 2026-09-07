import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * How much of the server a project should see.
 *
 * A user-scoped MCP entry runs in *every* project, and the tool definitions sit in the context of
 * every request whether or not anything calls them — measured at roughly 6,600 tokens. A project
 * with no bank was paying all of it for a surface it could not use, and there is no per-project
 * switch for a user-scoped server on the client side. So the server decides for itself.
 *
 * - `off`     nothing is registered. The project said so explicitly with a marker file.
 * - `seed`    only `bank_init` is listed — there is no bank yet, and that is the one useful call.
 *             The rest are registered but disabled, and come back the moment a bank exists.
 * - `full`    everything.
 */
export type Surface = 'off' | 'seed' | 'full'

/** Dropped next to the bank — i.e. in the project root — to keep the server out of a project. */
export const OFF_MARKER = '.memorybank-off'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * A bank is "there" when the root holds at least one document. An empty or missing directory is
 * not an error — it is the normal state of a project that has never had a bank, and the answer to
 * it is `bank_init`, not a failure.
 */
export async function hasBank(root: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.some((e) => (e.isDirectory() && e.name !== '_inbox') || e.name.endsWith('.md'))
  } catch {
    return false
  }
}

export async function surfaceFor(root: string): Promise<Surface> {
  const abs = path.resolve(root)
  if (await exists(path.join(path.dirname(abs), OFF_MARKER))) return 'off'
  return (await hasBank(abs)) ? 'full' : 'seed'
}
