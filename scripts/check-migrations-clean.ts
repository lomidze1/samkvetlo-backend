/**
 * Code review finding (backend cc445ce..4b13818): the migration snapshot
 * chain drifted from the real schema more than once — a later `.json`
 * snapshot silently lost tables/columns an earlier one had, even though the
 * matching `.ts` migration never dropped them. The next `migrate:create`
 * then diffs against that wrong "before" state and emits `CREATE TABLE`/
 * `ALTER TABLE ADD COLUMN` for things that already exist in prod ->
 * `relation already exists`, deploy blocked.
 *
 * This is the automated guard: `payload migrate:create` against the
 * current schema, with stdin closed so an interactive prompt defaults to
 * "no" and writes nothing. If the snapshot chain is accurate, Payload
 * prints "No schema changes detected." and creates no file — anything else
 * (a new migration file appearing, or that message missing) means the
 * latest snapshot no longer matches src/payload.config.ts and must be
 * regenerated (see this file's git history for the 2026-09-19 fix).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(process.cwd(), 'src/migrations')
const CHECK_NAME = '__check_migrations_clean__'

const before = new Set(readdirSync(MIGRATIONS_DIR))

let output: string
try {
  output = execFileSync('pnpm', ['payload', 'migrate:create', CHECK_NAME], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
} catch (err) {
  console.error('check-migrations-clean: `payload migrate:create` failed to run')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const createdFile = readdirSync(MIGRATIONS_DIR).find((name) => !before.has(name) && name.startsWith('20'))
if (createdFile) {
  // Clean up so a failed CI run doesn't leave a stray file behind locally.
  for (const ext of ['.ts', '.json']) {
    const path = join(MIGRATIONS_DIR, createdFile.replace(/\.(ts|json)$/, ext))
    if (existsSync(path)) rmSync(path)
  }
  console.error('check-migrations-clean: schema changes detected — run `pnpm payload migrate:create <name>` and commit it')
  console.error(output)
  process.exit(1)
}

if (!output.includes('No schema changes detected')) {
  console.error('check-migrations-clean: unexpected output from `payload migrate:create` — inspect manually')
  console.error(output)
  process.exit(1)
}

console.log('check-migrations-clean: migration snapshot chain matches src/payload.config.ts')
