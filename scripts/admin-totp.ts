// ADR 0018 §4: enroll/rotate an admin's TOTP secret, or create a new admin
// and enroll it. Run from a developer machine, pointed at whichever
// database's DATABASE_URL is set — local Docker or (for prod) a Neon
// connection string. Re-running for an existing secret rotates it (the old
// authenticator entry stops working).
import { createInterface } from 'node:readline'

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { PASSWORD_MIN_LENGTH } from '../src/collections/hooks/passwordPolicy'
import { buildOtpauthUri, generateTotpSecret } from '../src/server/security/totp'

interface ParsedArgs {
  email?: string
  create: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  let email: string | undefined
  let create = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') {
      email = argv[i + 1]
      i += 1
    } else if (argv[i] === '--create') {
      create = true
    }
  }
  return { email, create }
}

/**
 * Reads one line from stdin without echoing it — Node's `readline` has no
 * built-in "hidden input" mode, so this mutes `_writeToOutput` for the
 * duration of the prompt (the documented workaround, no new dependency).
 * The password never touches `process.argv` or any log line.
 */
function readHiddenLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write(prompt)
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

async function main(): Promise<void> {
  const { email, create } = parseArgs(process.argv.slice(2))
  if (!email) {
    console.error('Usage: pnpm admin:totp --email <email> [--create]')
    process.exit(1)
  }

  const payload = await getPayload({ config })

  const { docs: existing } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })

  let userId: number | string
  if (existing[0]) {
    if (create) {
      console.error(`admin:totp: ${email} already exists — omit --create to rotate its secret.`)
      process.exit(1)
      return
    }
    userId = existing[0].id
  } else {
    if (!create) {
      console.error(`admin:totp: ${email} does not exist — pass --create to create it.`)
      process.exit(1)
      return
    }
    const password = await readHiddenLine(`New password for ${email} (>= ${PASSWORD_MIN_LENGTH} chars): `)
    if (password.length < PASSWORD_MIN_LENGTH) {
      console.error(`admin:totp: password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
      process.exit(1)
      return
    }
    const created = await payload.create({
      collection: 'users',
      data: { email, password },
      overrideAccess: true,
    })
    userId = created.id
  }

  const secret = generateTotpSecret()
  await payload.update({
    collection: 'users',
    id: userId,
    data: { totpSecret: secret, totpLastStep: null, totpEnabledAt: new Date().toISOString() },
    overrideAccess: true,
  })

  const uri = buildOtpauthUri(secret, email)
  console.log(`\nTOTP enrolled for ${email}. Add it to your authenticator app now — this is printed only once:\n`)
  console.log(`  URI:    ${uri}`)
  console.log(`  Secret: ${secret}\n`)
  process.exit(0)
}

main().catch((error) => {
  console.error('admin:totp failed', error)
  process.exit(1)
})
