# ადმინის 2FA: TOTP-ის ჩართვა, როტაცია და აღდგენა

ADR: [`_doc/adr/0018-admin-totp-in-house.md`](../../../_doc/adr/0018-admin-totp-in-house.md)

ადმინის ყველა login (`admin.samkvetlo.ge/admin/login`) მოითხოვს პაროლის გარდა
6-ციფრიან TOTP კოდსაც (Google Authenticator, 1Password, Bitwarden და
ა.შ. ნებისმიერი TOTP-თავსებადი აპლიკაცია). ჩართვა/როტაცია ხდება მხოლოდ CLI-ით
(`pnpm admin:totp`) — ადმინის UI-ში ამის გასაკეთებელი ღილაკი არ არსებობს.

## ახალი ადმინის შექმნა + ჩართვა

```bash
pnpm admin:totp --email partner@example.com --create
```

- სთხოვს პაროლს (stdin-იდან, არ ჩანს ეკრანზე, ≥ 16 სიმბოლო).
- ბეჭდავს `otpauth://` URI-სა და base32 secret-ს **ერთხელ**. ორივე დაუყოვნებლივ
  დაამატე authenticator აპლიკაციაში (URI-ის სკანირება ან QR-ის ნაცვლად „manual
  entry“ → secret ხელით).

## არსებული ადმინის ჩართვა/როტაცია (ტელეფონის დაკარგვა, ახალი პარტნიორი, ეჭვი კომპრომეტაციაზე)

```bash
pnpm admin:totp --email owner@samkvetlo.ge
```

`--create`-ის გარეშე — არსებულ მომხმარებელს უცვლის (ან უქმნის პირველად) TOTP
secret-ს. ძველი authenticator-ის ჩანაწერი **დაუყოვნებლივ წყვეტს მუშაობას** ამ
წამიდან. ხელახლა გაუშვი ნებისმიერ დროს ტელეფონის დაკარგვის, ან ეჭვის
შემთხვევაში, რომ secret-ი გაჟონა.

## Recovery codes არ არსებობს

MVP-ში (ADR 0018 §4) recovery codes არ იწერება — ტელეფონის დაკარგვისას
დეველოპერი უშვებს ზემოთა ბრძანებას იმავე email-ით, რომელიც ახალ secret-ს
გასცემს. ორი პარტნიორისთვის და ერთი დეველოპერისთვის ეს საკმარისია.

## გაშვება environment-ების მიხედვით

### ლოკალური Docker

```bash
docker compose exec backend pnpm admin:totp --email admin@samkvetlo.local --create
```

### Prod (Neon)

გაუშვი დეველოპერის მანქანიდან, `DATABASE_URL`-ით Neon-ის connection string-ზე
დროებით მიმართული (არასოდეს `DATABASE_URL_MIGRATOR`-ით):

```bash
DATABASE_URL="<Neon connection string>" PAYLOAD_SECRET="<prod secret>" pnpm admin:totp --email owner@samkvetlo.ge
```

`PAYLOAD_SECRET` აუცილებელია — მისი გარეშე Payload ვერ ინიციალიზდება. ორივე
მნიშვნელობა Vercel-ის env-ებშია (Settings → Environment Variables).

## dev seed

ლოკალურად `pnpm seed` თუ `SEED_ADMIN_TOTP_SECRET` (`.env`) დაყენებულია,
seed-ის ადმინი ამ secret-ით ირთვება (ტესტებისა და ლოკალური demo-სთვის
გამეორებადი მნიშვნელობა). თუ არაა — seed ქმნის ახალს და URI-ს ბეჭდავს.

## რა ხდება ავტომატურად

- login-ის ველი `totp` მოწმდება იმავე request-ში, სადაც პაროლი (`src/collections/hooks/requireTotp.ts`) — ცალკე „ნახევრად შესული“ სესია არ არსებობს.
- 5 არასწორი კოდი 15 წუთში → შემდეგი მცდელობებიც უარყოფილია, სწორი კოდითაც, სანამ 15 წუთი არ გავა (`audit-events` `login.totp-failed`).
- `totpSecret`/`totpLastStep` არასოდეს ჩანს API-ში, ადმინის UI-ში თუ ლოგში.
- `password reset` კოდის გარეშე ვერ დასრულდება (ADR 0018 §7 — შეგნებულად).
