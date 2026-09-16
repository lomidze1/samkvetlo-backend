# samkvetlo-backend

Payload CMS ადმინი + `/api/public/*` DTO API სამკვეთლოს საიტისთვის. არქიტექტურა: [`_doc/architecture.md`](../_doc/architecture.md), [`_doc/TECH-STACK.md`](../_doc/TECH-STACK.md), [ADR 0012](../_doc/adr/0012-frontend-backend-split.md).

## ლოკალური გაშვება

მოითხოვს: Node ≥ 22.12 (`.nvmrc` = `22`), pnpm ≥ 10, Docker.

1. `pnpm i`
2. `cp .env.example .env` და შეავსე `PAYLOAD_SECRET` (მაგ. `openssl rand -hex 32`)
3. `pnpm db:up` — უშვებს Postgres 18-ს Docker-ში (`samkvetlo` + `samkvetlo_test` ბაზები)
4. `pnpm dev` → გახსენი [http://localhost:3001/admin](http://localhost:3001/admin) და შექმენი პირველი user

`pnpm db:down` აჩერებს ბაზას. `docker compose down -v` შლის მონაცემებსაც (სუფთა თავიდან დაწყებისთვის).

პარალელურად `samkvetlo/` (frontend) მუშაობს პორტ 3000-ზე და ამ backend-ს HTTP-ით მიმართავს (`BACKEND_URL`, `SERVICE_TOKEN_READ`/`SERVICE_TOKEN_WRITE`) — იხ. [`_doc/TECH-STACK.md`](../_doc/TECH-STACK.md) §4.

## სკრიპტები

| ბრძანება | რას აკეთებს |
|---|---|
| `pnpm dev` / `pnpm start` | dev/prod სერვერი პორტ 3001-ზე |
| `pnpm lint` / `pnpm typecheck` / `pnpm check:ka` | lint, TS, hardcoded ქართული ტექსტის შემოწმება |
| `pnpm test:int` / `pnpm test:e2e` / `pnpm test` | Vitest ინტეგრაცია / Playwright e2e / ორივე |
| `pnpm db:up` / `pnpm db:down` | Postgres 18 Docker-ში |
| `pnpm seed` | სატესტო კატალოგის თესვა |
| `pnpm rates:sync` | ვალუტის კურსის სინქრონიზაცია (NBG) |

## Prod ბაზა: როლები, backup, restore (T5.13, ADR 0014 §9–10)

**როლები** (`docs/db-roles.sql`, გაშვებულია ერთხელ Neon-ზე, idempotent): `samkvetlo_owner` (DDL, მხოლოდ `DATABASE_URL_MIGRATOR`-ით, `payload migrate`-ისთვის Vercel build-ში — იხ. `vercel.json`), `samkvetlo_app` (CRUD, runtime `DATABASE_URL`), `samkvetlo_backup` (მხოლოდ `SELECT`, ღამის dump-ისთვის). `samkvetlo_app`/`samkvetlo_backup`-ს DDL არ შეუძლია (`CREATE TABLE` → `permission denied for schema public`) — შემოწმებულია throwaway ბაზაზე, შედეგი T5.13-ის ანგარიშშია.

**ღამის backup** (`.github/workflows/backup.yml`): `pg_dump -Fc` (`samkvetlo_backup` როლით) `postgres:18` container-ში, ატვირთვა R2-ში (`samkvetlo-backups/db/YYYY-MM-DD.dump`, S3 API), ყოველ ღამე 02:00 თბილისის დროით (= 22:00 UTC). სანამ `BACKUP_DATABASE_URL`/`R2_*` secrets არ არის დამატებული (GitHub repo secrets), workflow წარმატებით სრულდება, უბრალოდ არაფერს აკეთებს (no-op). **R2 lifecycle** (ხელით მიმდინარეობს R2 console-ში, აქედან ვერ კონფიგურდება): წესი `db/`-ზე, რომელიც 35 დღეში შლის ობიექტს.

**აღდგენის სავარჯიშო** (launch-მდე და ყოველ კვარტალში):
1. `pg_dump -U postgres -Fc -d <წყარო ბაზა> -f backup.dump` (prod-ში: `samkvetlo_backup` როლი, `pg_dump -Fc --no-owner`)
2. თესვის ბაზა: `psql -U postgres -c "CREATE DATABASE <name>_restore;"`
3. `pg_restore -U postgres -d <name>_restore backup.dump`
4. `DATABASE_URL=postgres://…/<name>_restore pnpm payload migrate:status`
5. smoke query: `SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders;` — შეადარე წყაროს იგივე queries-ს
6. `DROP DATABASE <name>_restore;`

2026-09-16-ის სავარჯიშოს შედეგი (`samkvetlo_p5` → `samkvetlo_p5_restore`, Docker-ის საზიარო `postgres:18`-ზე): dump 201 KB, `pg_restore` შეცდომის გარეშე, `migrate:status` ასახავს ბაზის ნამდვილ მდგომარეობას (3 გატარებული migration, 2 გატარებული არ იყო — თანმხვედრია `samkvetlo_p5`-ის რეალურ მდგომარეობასთან), smoke query აღდგენილზეც და წყაროშიც: `products = 3, orders = 0`. თესვის ბაზა და dump ფაილი წაშლილია.
