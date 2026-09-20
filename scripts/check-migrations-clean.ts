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
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(process.cwd(), 'src/migrations')
const CHECK_NAME = '__check_migrations_clean__'

/**
 * `migrate:create` is run with stdin at /dev/null so an interactive prompt
 * can't hang CI. Payload answers EOF by exiting 0 having printed nothing,
 * which is indistinguishable here from a real problem — and because the
 * old code used execFileSync (which returns stdout and silently drops
 * stderr on success), whatever Payload actually said was thrown away. That
 * produced four false CI failures on 2026-09-20, every one of which passed
 * on a plain re-run. So: keep stderr, and treat one silent run as
 * inconclusive rather than fatal.
 */
function runMigrateCreate(): { stdout: string; stderr: string } {
  const res = spawnSync('pnpm', ['payload', 'migrate:create', CHECK_NAME], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  if (res.error) {
    console.error('check-migrations-clean: `payload migrate:create` failed to run')
    console.error(res.error.message)
    process.exit(1)
  }
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** A migration file appearing means the snapshot chain really has drifted. */
function createdMigration(before: Set<string>): string | undefined {
  return readdirSync(MIGRATIONS_DIR).find((name) => !before.has(name) && name.startsWith('20'))
}

for (let attempt = 1; attempt <= 2; attempt++) {
  const before = new Set(readdirSync(MIGRATIONS_DIR))
  const { stdout, stderr } = runMigrateCreate()

  const createdFile = createdMigration(before)
  if (createdFile) {
    // Clean up so a failed CI run doesn't leave a stray file behind locally.
    for (const ext of ['.ts', '.json']) {
      const path = join(MIGRATIONS_DIR, createdFile.replace(/\.(ts|json)$/, ext))
      if (existsSync(path)) rmSync(path)
    }
    console.error('check-migrations-clean: schema changes detected — run `pnpm payload migrate:create <name>` and commit it')
    console.error(stdout)
    console.error(stderr)
    process.exit(1)
  }

  if (stdout.includes('No schema changes detected')) {
    console.log('check-migrations-clean: migration snapshot chain matches src/payload.config.ts')
    process.exit(0)
  }

  if (attempt === 1) {
    console.warn('check-migrations-clean: `payload migrate:create` said nothing conclusive — retrying once')
    console.warn(`  stdout: ${JSON.stringify(stdout)}`)
    console.warn(`  stderr: ${JSON.stringify(stderr)}`)
    continue
  }

  console.error('check-migrations-clean: unexpected output from `payload migrate:create` — inspect manually')
  console.error(`  stdout: ${JSON.stringify(stdout)}`)
  console.error(`  stderr: ${JSON.stringify(stderr)}`)
  process.exit(1)
}
