/**
 * Links `react-native-nitro-h3` from `packages/` into this app's `node_modules`.
 *
 * The showcase installs on its own, outside the root workspace, so the package cannot be a
 * `workspace:` dependency; `file:` would copy it and `link:` needs a global `bun link`. A symlink
 * keeps the source live under Metro and lets autolinking find the native code.
 */

import { lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, relative } from 'node:path'

const NODE_MODULES = join(import.meta.dir, '..', 'node_modules')
const PACKAGE = join(import.meta.dir, '..', '..', '..', 'packages', 'react-native-nitro-h3')
const LINK = join(NODE_MODULES, 'react-native-nitro-h3')

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

mkdirSync(NODE_MODULES, { recursive: true })
if (exists(LINK)) rmSync(LINK, { recursive: true, force: true })
symlinkSync(relative(NODE_MODULES, PACKAGE), LINK, 'dir')
console.log(`Linked react-native-nitro-h3 -> ${relative(process.cwd(), PACKAGE)}`)
