# samkvetlo-backend

Payload CMS ადმინი + `/api/public/*` DTO API სამკვეთლოს საიტისთვის. არქიტექტურა: [`_doc/architecture.md`](../_doc/architecture.md), [`_doc/TECH-STACK.md`](../_doc/TECH-STACK.md), [ADR 0012](../_doc/adr/0012-frontend-backend-split.md).

## ლოკალური გაშვება

მოითხოვს: Node ≥ 22.12 (`.nvmrc` = `22`), pnpm ≥ 10, Docker.

1. `pnpm i`
2. `cp .env.example .env` და შეავსე `PAYLOAD_SECRET` (მაგ. `openssl rand -hex 32`)
3. `pnpm db:up` — უშვებს Postgres 18-ს Docker-ში (`samkvetlo` + `samkvetlo_test` ბაზები)
4. `pnpm dev` → გახსენი [http://localhost:3001/admin](http://localhost:3001/admin) და შექმენი პირველი user
5. **2FA (ADR 0018, T5.17, launch-ის ბლოკერი):** login TOTP კოდსაც ითხოვს — ჩართე პირველი user-ისთვის `pnpm admin:totp --email <შენი user-ის email>` (Docker-ში: `docker compose exec backend pnpm admin:totp --email <e>`). დეტალები: [`docs/runbooks/admin-totp.md`](docs/runbooks/admin-totp.md)

`pnpm db:down` აჩერებს ბაზას. `docker compose down -v` შლის მონაცემებსაც (სუფთა თავიდან დაწყებისთვის).

პარალელურად `samkvetlo/` (frontend) მუშაობს პორტ 3000-ზე და ამ backend-ს HTTP-ით მიმართავს (`BACKEND_URL`, `SERVICE_TOKEN_READ`/`SERVICE_TOKEN_WRITE`) — იხ. [`_doc/TECH-STACK.md`](../_doc/TECH-STACK.md) §4.

## სკრიპტები

| ბრძანება | რას აკეთებს |
|---|---|
| `pnpm dev` / `pnpm start` | dev/prod სერვერი პორტ 3001-ზე |
| `pnpm lint` / `pnpm typecheck` / `pnpm check:ka` | lint, TS, hardcoded ქართული ტექსტის შემოწმება |
| `pnpm test:int` / `pnpm test:e2e` / `pnpm test` | Vitest ინტეგრაცია / Playwright e2e / ორივე |
| `pnpm db:up` / `pnpm db:down` | Postgres 18 Docker-ში |
| `pnpm seed` | სატესტო კატალოგის თესვა (პროდუქტებთან ერთად — მხოლოდ dev/test) |
| `pnpm seed:base` | ბაზისური მონაცემები **პროდუქტების გარეშე** (site-settings, delivery zones, სტატიკური გვერდები) — M4. `NODE_ENV=production`-ზე უარს ამბობს, გარდა `--allow-prod`-ისა (prod-ზე გაშვება ჯერ ღია კითხვაა მფლობელისთვის) |
| `pnpm rates:sync` | ვალუტის კურსის სინქრონიზაცია (NBG) |
| `pnpm admin:totp --email <e> [--create]` | ადმინის 2FA ჩართვა/როტაცია (ADR 0018) — [`docs/runbooks/admin-totp.md`](docs/runbooks/admin-totp.md) |

## სუფთა ბაზა, მხოლოდ migration-ებით (M3)

DB, რომელიც build push-ის (`pnpm dev`-ის default ქცევის) გარეშე, მხოლოდ `src/migrations/`-იდან აიგება — ამოწმებს, რომ migration-ების ჯაჭვი config-ის სქემას ემთხვევა:

```bash
createdb samkvetlo_fresh && createdb samkvetlo_fresh_test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/samkvetlo_fresh PAYLOAD_DB_PUSH=false pnpm payload migrate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/samkvetlo_fresh_test PAYLOAD_DB_PUSH=false pnpm payload migrate
pnpm check:migrations  # config-ის სქემა == migration-ების სქემა (ცალკე DB არ სჭირდება)
DATABASE_URL=.../samkvetlo_fresh pnpm seed   # ბაზისური/სატესტო მონაცემები
DATABASE_URL_TEST=.../samkvetlo_fresh_test PAYLOAD_DB_PUSH=false pnpm test:int   # push drift-ს აღარ ფარავს
DATABASE_URL=.../samkvetlo_fresh PAYLOAD_DB_PUSH=false pnpm exec next dev -p 3021 &   # e2e-სთვის
pnpm test:e2e   # ამ backend-ზე; frontend-იდან იგივეს E2E_BACKEND_URL-ით
```

## შეტყობინებები prod-ში (T5.18, ADR 0019, B3)

`.env`-ში `EMAIL_ADAPTER=console`/`SMS_ADAPTER=console` (dev/staging) რჩება. Prod-ზე Vercel-ში დააყენე `EMAIL_ADAPTER=resend` (fallback `brevo`) და `SMS_ADAPTER=smsoffice` (fallback `senderge`) + შესაბამისი key/from-env `.env.example`-დან — ანგარიშების, key-ების და DNS-ის ჩამონათვალი: [`_doc/runbooks/first-deploy.md`](../_doc/runbooks/first-deploy.md) §1a. ორივე env დაუყენებლად production-ზე `NotifyConfigError('not_configured')` ↦ ⚠ ადმინში + Sentry.

## Prod ბაზა: როლები, backup, restore (T5.13, ADR 0014 §9–10)

**როლები** (`docs/db-roles.sql`, idempotent): `samkvetlo_owner` (DDL, მხოლოდ `DATABASE_URL_MIGRATOR`-ით, `payload migrate`-ისთვის Vercel build-ში — იხ. `vercel.json`), `samkvetlo_app` (CRUD, runtime `DATABASE_URL`), `samkvetlo_backup` (მხოლოდ `SELECT`, ღამის dump-ისთვის). `samkvetlo_app`/`samkvetlo_backup`-ს DDL არ შეუძლია (`CREATE TABLE` → `permission denied for schema public`) — შემოწმებულია throwaway ბაზაზე, შედეგი T5.13-ის ანგარიშშია.

**გაშვების რიგი (სავალდებულო, კოდის მიმოხილვა m2):** ფაილი გაშვებულია **ორჯერ**, პირველი `payload migrate`-ის ორივე მხარეს — (1) migrate-მდე: ქმნის სამივე login role-ს (`samkvetlo_owner` თავად უნდა არსებობდეს, რომ `DATABASE_URL_MIGRATOR`-მა მასზე დაკავშირება შეძლოს); (2) `payload migrate` (როგორც `samkvetlo_owner`) ქმნის ცხრილებს; (3) migrate-ის შემდეგ: ხელახლა გაუშვი იგივე ფაილი — ამ დროისთვის მხოლოდ ეს ხელახალი გაშვება რეალურად ამოქმედებს `audit_events`-ის REVOKE-ს (იხ. ქვემოთ). ყველა დანარჩენი statement ორივე გაშვებაზე idempotent-ია.

`docs/db-roles.sql`-ის ბოლოში `REVOKE UPDATE, DELETE ON audit_events FROM samkvetlo_app` დაცულია `to_regclass`-ით (`audit_events` არ არსებობს პირველ, migrate-მდე გაშვებაზე) — თუ ცხრილი ჯერ არ არსებობს, ფაილი წერს **`RAISE WARNING`**-ს (არა უბრალოდ ჩუმად გამოტოვებს), რომ ეს არასდროს დარჩეს შეუმჩნეველი.

**ღამის backup** (`.github/workflows/backup.yml`): `pg_dump -Fc` (`samkvetlo_backup` როლით) `postgres:18` container-ში, ატვირთვა R2-ში (`samkvetlo-backups/db/YYYY-MM-DD.dump`, S3 API), ყოველ ღამე 02:00 თბილისის დროით (= 22:00 UTC). ატვირთვის შემდეგ workflow ამოწმებს, რომ ობიექტი ნამდვილად არსებობს R2-ში (`aws s3api head-object`), და რომ dump ცარიელი არ არის (`[ -s backup.dump ]`). **R2 lifecycle** (ხელით მიმდინარეობს R2 console-ში, აქედან ვერ კონფიგურდება): წესი `db/`-ზე, რომელიც 35 დღეში შლის ობიექტს.

**`BACKUP_ENABLED` (GitHub repo variable, Settings → Actions → Variables, არა Secret):** სანამ `BACKUP_DATABASE_URL`/`R2_*` secrets არ არის დამატებული, workflow წარმატებით სრულდება და უბრალოდ არაფერს აკეთებს (no-op) — ეს განზრახულია launch-მდე. **launch-ის შემდეგ**, როცა secrets ნამდვილად ემატება, დააყენე `BACKUP_ENABLED=true`: მაშინ ერთი secret-ის დაკარგვაც კი (მაგ. rotation-ის შეცდომით) workflow-ს **ჩავარდნად** აქცევს, ნაცვლად იმისა, რომ 35 დღის განმავლობაში (R2-ის lifecycle-ის გასვლამდე) ჩუმად არაფერი გააკეთოს.

**აღდგენის სავარჯიშო** (launch-მდე და ყოველ კვარტალში):
1. `pg_dump -U postgres -Fc -d <წყარო ბაზა> -f backup.dump` (prod-ში: `samkvetlo_backup` როლი, `pg_dump -Fc --no-owner`)
2. თესვის ბაზა: `psql -U postgres -c "CREATE DATABASE <name>_restore;"`
3. `pg_restore -U postgres -d <name>_restore backup.dump`
4. `DATABASE_URL=postgres://…/<name>_restore pnpm payload migrate:status`
5. smoke query: `SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders;` — შეადარე წყაროს იგივე queries-ს
6. `DROP DATABASE <name>_restore;`

2026-09-16-ის სავარჯიშოს შედეგი (`samkvetlo_p5` → `samkvetlo_p5_restore`, Docker-ის საზიარო `postgres:18`-ზე): dump 201 KB, `pg_restore` შეცდომის გარეშე, `migrate:status` ასახავს ბაზის ნამდვილ მდგომარეობას (3 გატარებული migration, 2 გატარებული არ იყო — თანმხვედრია `samkvetlo_p5`-ის რეალურ მდგომარეობასთან), smoke query აღდგენილზეც და წყაროშიც: `products = 3, orders = 0`. თესვის ბაზა და dump ფაილი წაშლილია.
