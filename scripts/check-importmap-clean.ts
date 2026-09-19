/**
 * Code review finding: `src/app/(payload)/admin/importMap.js` is a
 * generated file (`pnpm generate:importmap`) that Payload's admin UI reads
 * at build/runtime to resolve every custom component path (e.g.
 * `/components/admin/AnonymizeButton#AnonymizeButton`, registered on
 * Orders/CustomRequests). `next dev` regenerates it on the fly, which hides
 * a stale committed file locally — a production build uses the committed
 * one as-is, so a custom component registered without re-running
 * `generate:importmap` silently doesn't render in the admin (this happened
 * once already: AnonymizeButton, T5.12).
 *
 * This is the automated guard, same shape as check-migrations-clean.ts:
 * regenerate into the real file, diff against what was committed, then
 * restore the original content either way (so *running the check* never
 * itself changes the working tree — only `pnpm generate:importmap` does).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const IMPORT_MAP_PATH = join(process.cwd(), 'src/app/(payload)/admin/importMap.js')

const before = readFileSync(IMPORT_MAP_PATH, 'utf8')

try {
  execFileSync('pnpm', ['generate:importmap'], { stdio: ['ignore', 'pipe', 'pipe'] })
} catch (err) {
  console.error('check-importmap-clean: `pnpm generate:importmap` failed to run')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const after = readFileSync(IMPORT_MAP_PATH, 'utf8')

// Restore the committed content regardless of outcome — this check only
// ever reports drift, it never fixes it (that's `pnpm generate:importmap`,
// run and committed by hand).
writeFileSync(IMPORT_MAP_PATH, before)

if (after !== before) {
  console.error('check-importmap-clean: importMap.js is stale — run `pnpm generate:importmap` and commit the result')
  process.exit(1)
}

console.log('check-importmap-clean: importMap.js matches the current admin component registrations')
