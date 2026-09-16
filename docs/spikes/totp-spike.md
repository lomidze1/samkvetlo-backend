# T5.9 spike: `payload-totp` — FAIL

**Date:** 2026-09-16
**Versions tested:** `payload@3.89.0`, `@payloadcms/*@3.89.0`, `next@16.3.3`, `payload-totp@3.0.3` (exact, as specified), `otpauth@9.5.2` (payload-totp's own dependency)

## Verdict

**FAIL on criterion (c).** The plugin was installed, wired up exactly per its
README (`payloadTotp({ collection: 'users', forceSetup: true })` as the last
plugin, `disableAccessWrapper: { read: true }` added to every public-read
collection/global so anonymous storefront reads keep working, `src/proxy.ts`
created to forward `x-pathname` as the plugin's docs require), and it has
been **removed completely** per the task's FAIL instruction (package.json,
lockfile, `payload.config.ts`, the per-collection `custom.totp` entries, the
migration, the generated import map, `src/proxy.ts`, and the test helpers
that computed TOTP codes). No fallback was built — ADR 0016's `proxy.ts`
geo-restriction (T5.14) is a separate, still-open task.

## Criteria checked

| # | Criterion | Result |
|---|---|---|
| a | ADR 0005 T1/T2/T3 + access tests, `public-api.e2e.spec.ts`, `/api/public/*` 401 tests stay green with the plugin installed | **PASS** — full `pnpm test:int` (133/133, including `tests/int/secrecy.int.spec.ts` and `tests/int/serviceAuth.int.spec.ts`) was green with the plugin installed, once every public-read collection (`Categories`, `DeliveryZones`, `Media`, `Pages`, `Portfolio`, `Products`, `PublicFiles`, `Variants`) and the `SiteSettings` global got `custom: { totp: { disableAccessWrapper: { read: true } } }`. Without that, the plugin's access wrapper (`totpAccess`, `if (!user) return false`) would 403 every anonymous storefront read. |
| b | Admin login demands TOTP | **PASS** — verified in the browser (not just read from source): a fresh admin login redirects straight to `/admin/setup-totp` (QR code + hidden `input[name="secret"]`), and submitting a code computed with `otpauth.TOTP` (resolved via `otpauth`'s package boundary, not a new dependency) against that secret completes setup and lands on the dashboard. `src/proxy.ts` forwarding `x-pathname` was required — without it the plugin's server-side redirect can't tell it's already on `/admin/setup-totp` and loops forever (documented plugin gotcha, confirmed by testing without it first). |
| c | REST `POST /api/users/login` without TOTP cannot reach `/api/orders`, `/api/suppliers`, `/api/costings`, `/api/users` | **FAIL — see reproduction below.** True only for a user who has *already* completed TOTP setup once. A user who has **never** completed setup (`hasTotp: false`, e.g. right after `payload.create`) can log in via plain REST and read every admin-only collection with **no TOTP step at all**. |
| d | Seed + service-token public API still works | **PASS** — `tests/e2e/public-api.e2e.spec.ts`-equivalent checks pass through `pnpm test:int`'s `publicApiAuth`/`serviceAuth` suites; not separately re-run since (c) already fails the spike. |
| e | Peers resolve cleanly against payload 3.89.0 exact | **PASS** — `payload-totp@3.0.3`'s peers (`payload@^3.88.0`, `@payloadcms/{next,translations,ui}@^3.88.0`) are satisfied by 3.89.0; `pnpm install` printed no peer-dependency warnings. |

## Reproduction of the (c) failure

Root cause (`node_modules/payload-totp/dist/totpAccess.js`):

```js
if (pluginOptions.forceSetup && user._strategy === 'totp' || user._strategy === 'api-key') {
  return innerAccess ? innerAccess(args) : true;
} else {
  if (user.hasTotp) {
    if (user._strategy === 'totp') return innerAccess ? innerAccess(args) : true;
    else return false;                 // enrolled user, wrong strategy → blocked (this part works)
  } else {
    return innerAccess ? innerAccess(args) : true;   // <-- not yet enrolled → falls through, TOTP not required at all
  }
}
```

`forceSetup: true` only forces the **admin UI** to redirect an unenrolled
user to `/admin/setup-totp` (`TOTPProvider`, a client-side/RSC redirect). It
does **not** change `totpAccess`, so a REST client never touches that
redirect and sails straight through to `innerAccess` (`isAdmin`) as long as
`hasTotp` is `false`. There is no plugin option to close this — the
`disableAccessWrapper` knob goes the other way (opts a collection *out* of
the wrapper for public reads).

Live reproduction against a Postgres-backed dev server (`next dev -p 3021`,
`.env`'s seeded admin plus one freshly created second admin):

```
$ curl -s -X POST http://localhost:3021/api/users/login -H 'Content-Type: application/json' \
    -d '{"email":"fresh-admin@samkvetlo.local","password":"fresh-admin-password-16"}'
{"message":"Authentication Passed", ..., "user": {..., "_strategy":"local-jwt","hasTotp":false}}

$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/orders -H "Authorization: JWT <token>"
200      # expected 401/403 — this is the criterion (c) violation

$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/users  -H "Authorization: JWT <token>"
200      # same
```

For comparison, the **enrolled** admin account (`hasTotp: true`, completed
setup once via the browser) behaves correctly on a plain REST login without
`verify-totp`:

```
$ curl -s -X POST http://localhost:3021/api/users/login ... # admin@samkvetlo.local, hasTotp:true
{"user": {..., "_strategy":"local-jwt","hasTotp":true}}

$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/orders    -H "Authorization: JWT <token>"  # 403
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/users     -H "Authorization: JWT <token>"  # 403
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/suppliers -H "Authorization: JWT <token>"  # 403
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/costings  -H "Authorization: JWT <token>"  # 403
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3021/api/products  -H "Authorization: JWT <token>"  # 200 (public-read, correct)
```

## Why this matters here (not just a theoretical gap)

Our threat model (ADR 0014 §4) is exactly "stolen/leaked partner
credentials." The gap is largest at the moment it matters most: a freshly
created admin account (e.g. a second/emergency account, or a service
account someone forgets to lock down) is fully usable over REST with only a
password, indefinitely, until *someone* happens to complete the browser
setup flow. Nothing in the plugin or Payload prompts that to happen quickly
for an account that is only ever used over REST/API, so `forceSetup` does
not deliver the "every admin account is 2FA-gated" guarantee ADR 0014 §4
asks for.

## What would close it (not attempted — out of scope for a spike)

Writing fully custom `access` functions per admin-gated collection (using
the exported `totpAccess` combined with an inner check that also rejects
`hasTotp === false`, bypassing the plugin's own wrapper via
`disableAccessWrapper`) would close the gap, but at that point the plugin
is contributing little beyond the enrollment UI and login-time cookie
strategy — most of the actual access-control logic would be hand-rolled
per collection anyway, which is the "build a fallback" the task explicitly
said not to do.

## Recommendation for chief-architect

Per ADR 0016's already-written fallback: keep the geo-restriction + lockout
(T5.9's other changes, already committed) and turn the break-glass
mechanism (T5.14) into a permanent IP allowlist for the two partner
accounts, as ADR 0014 §4 / ADR 0016 already anticipate for exactly this
outcome. `payload-totp` can be re-evaluated after a Payload/plugin update.
