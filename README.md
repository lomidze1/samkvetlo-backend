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
