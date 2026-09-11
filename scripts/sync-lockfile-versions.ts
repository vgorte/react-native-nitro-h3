/**
 * Writes the version of every workspace `package.json` into its entry in `bun.lock`.
 *
 * bun 1.3 rewrites the workspace entries of the lockfile only when a dependency changes, so a
 * bare version bump leaves `bun.lock` one release behind (oven-sh/bun#18906, fixed in bun 1.4.1).
 * The root `after:bump` release hook runs this right after `bun install`.
 *
 * Usage:
 *   bun run scripts/sync-lockfile-versions.ts
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCKFILE = join(ROOT, 'bun.lock')

const WORKSPACE_HEAD = /^ {4}"([^"]*)": \{$/
const WORKSPACE_END = /^ {4}\},?$/
const VERSION_LINE = /^( {6}"version": ")([^"]*)(",?)$/

const lines = (await readFile(LOCKFILE, 'utf8')).split('\n')
const changes: string[] = []
let inWorkspaces = false
let workspace: string | null = null

for (let i = 0; i < lines.length; i++) {
  const line = lines[i] ?? ''
  if (line === '  "workspaces": {') {
    inWorkspaces = true
    continue
  }
  if (!inWorkspaces) continue
  if (line === '  },') break

  const head = WORKSPACE_HEAD.exec(line)
  if (head) {
    workspace = head[1] ?? ''
    continue
  }
  if (WORKSPACE_END.test(line)) {
    workspace = null
    continue
  }
  if (workspace === null) continue

  const version = VERSION_LINE.exec(line)
  if (!version) continue
  const [, prefix = '', current = '', suffix = ''] = version
  const manifest = JSON.parse(await readFile(join(ROOT, workspace, 'package.json'), 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version === current) continue

  lines[i] = `${prefix}${manifest.version}${suffix}`
  changes.push(`${workspace || '.'}: ${current} to ${manifest.version}`)
}

if (changes.length === 0) {
  console.log('bun.lock already carries the workspace versions')
} else {
  await writeFile(LOCKFILE, lines.join('\n'))
  for (const change of changes) console.log(`bun.lock ${change}`)
}
