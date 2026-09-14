/**
 * ADR 0004: user-facing text must live in src/i18n/ka.ts, not hardcoded in JSX.
 * Scans src/server/** and src/endpoints/** (.ts/.tsx) for Georgian characters.
 * Exceptions: src/i18n/** (the translation file itself) and
 * src/shared/configurator/scripts/** (ADR 0010 script/alphabet tables).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const GEORGIAN_RE = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/

const EXCLUDED_PREFIXES = ['src/i18n/', 'src/shared/configurator/scripts/']

// Payload's own admin template (src/app/(payload)) and Georgian collection
// field labels (src/collections/**) are out of scope for this scanner — they
// are admin-only UI text, not storefront copy (ADR 0004).
const SCAN_ROOTS = ['src/server', 'src/endpoints']

const cwd = process.cwd()

function listFiles(dir: string): string[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

let hasViolation = false

for (const root of SCAN_ROOTS) {
  const absRoot = join(cwd, root)
  try {
    statSync(absRoot)
  } catch {
    continue
  }

  for (const file of listFiles(absRoot)) {
    const relPath = relative(cwd, file)
    if (EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) continue

    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (GEORGIAN_RE.test(line)) {
        hasViolation = true
        console.error(`${relPath}:${index + 1}: hardcoded Georgian text found — move it to src/i18n/ka.ts`)
        console.error(`  ${line.trim()}`)
      }
    })
  }
}

if (hasViolation) {
  process.exit(1)
}
