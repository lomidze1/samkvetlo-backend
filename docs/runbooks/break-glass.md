# Break-glass: ადმინში შესვლა საქართველოს გარეთიდან

ADR: [`_doc/adr/0016-admin-geo-restriction-break-glass.md`](../../../_doc/adr/0016-admin-geo-restriction-break-glass.md)

ადმინი (`admin.samkvetlo.ge`) ჩვეულებრივ ხელმისაწვდომია **მხოლოდ საქართველოდან**
(ორი დამოუკიდებელი ფენა: Vercel Firewall + `src/proxy.ts`). ეს გვერდი აღწერს,
რა ნაბიჯებია საჭირო, თუ მფლობელი ან პარტნიორი საზღვარგარეთაა და ადმინთან
წვდომა სასწრაფოდ სჭირდება.

## Firewall წესები (ერთხელ, წინასწარ)

Vercel dashboard → backend პროექტი → **Firewall** → Custom Rules, ამ თანმიმდევრობით:

| # | სახელი | პირობა | action | ნაგულისხმევი |
|---|---|---|---|---|
| 3 | `admin-break-glass` | IP = `<დროებითი IP>` AND (path `/admin*` OR (path `/api/*` AND NOT `/api/public/*`)) | **bypass** | **გამორთული** |
| 4 | `admin-geo-ge` | country ≠ `GE` AND (path `/admin*` OR (path `/api/*` AND NOT `/api/public/*` AND NOT `/api/cron/*`)) | **deny** | ჩართული |

## ჩართვა (მფლობელი/პარტნიორი საზღვარგარეთაა)

1. **გაიგე შენი მიმდინარე საჯარო IP** (მაგ. https://whatismyipaddress.com — VPN-ის გამორთვით, თუ ის ცვლის IP-ს ყოველ შესვლაზე).
2. **Env ცვლადი** (Vercel dashboard → backend პროექტი → Settings → Environment Variables, **Production**, **Sensitive**):
   - სახელი: `ADMIN_BREAK_GLASS`
   - მნიშვნელობა: `<IP>;<expiresAt ISO-8601 UTC>`, მაგ. `203.0.113.7;2026-10-01T18:00:00Z`
   - **ვადა მაქსიმუმ 72 საათი** ახლანდელი დროიდან — მეტი იგნორირდება (`src/proxy.ts`).
   - შეინახე → **Redeploy** (≈ 2–4 წუთი, env ცვლადი ახალ deployment-ზევე მოქმედებს).
3. **Firewall წესი**: `admin-break-glass` → პირობაში ჩაწერე იგივე IP → **ჩართე** (მოქმედებს მყისიერად, redeploy არ სჭირდება).
4. **შემოწმება**: გახსენი `https://admin.samkvetlo.ge/admin/login` და შედი ჩვეულებრივად. `curl -I https://admin.samkvetlo.ge/api/public/health -H "Authorization: Bearer $SERVICE_TOKEN_READ"` ისევ 200-ს უნდა აბრუნებდეს ნებისმიერი ადგილიდან (ეს წესი მას არ ეხება).

## გამორთვა (სამუშაოს დასრულების შემდეგ — **სავალდებულო**)

1. Env ცვლადი `ADMIN_BREAK_GLASS` **წაშალე** (ან დატოვე ცარიელი) → **Redeploy**.
2. Firewall წესი `admin-break-glass` **გამორთე**.
3. ორივე ცვლილება ჩანს Vercel **Activity Log**-ში (ვინ, როდის).

ვადის ავტომატური გასვლის შემდეგ `src/proxy.ts` ისევ 403-ს დააბრუნებს იმ IP-სთვისაც,
ვინც firewall-ის წესის გამორთვა დაავიწყდა — მაგრამ firewall წესის გამორთვა მაინც
სავალდებულოა, რადგან `bypass`-ს (განსხვავებით deny/challenge-სგან) ვადა არ აქვს.

## რა ხდება ავტომატურად

- `src/proxy.ts`-ის geo-შემოწმება `/api/public/*`-სა და `/api/cron/*`-ს არასოდეს ეხება.
- ყოველი შესვლა წერს ჩანაწერს **`audit-events`** კოლექციაში (`Users.hooks.afterLogin`,
  `src/collections/hooks/loginAudit.ts`) — არა მხოლოდ break-glass-ისას (ADR 0014 §4
  fallback: მოპარული პაროლი საქართველოდანაც უნდა ჩანდეს). სადაც `x-vercel-ip-country ≠ GE`
  (ანუ break-glass-ით მოხდა), ტიპი არის `login.break-glass` და დამატებით იგზავნება email
  `site-settings`-ის ყველა `ownerEmails`-ზე; სხვა შემთხვევაში (`GE` ან header არ არსებობს) —
  `login.success`, email-ის გარეშე. არცერთ ჩანაწერში IP არ ინახება.
- `src/proxy.ts` წერს `console.warn('[break-glass]', { path })`-ს (IP-ის გარეშე) —
  ჩანს Vercel-ის ლოგებში.

## თუ Vercel-ზე წვდომა არ არის

ოპერაციას ასრულებს მეორე პარტნიორი საქართველოდან (dashboard-ზე წვდომა
გეო-შეზღუდული არ არის — მხოლოდ `/admin` და `/api/*` (public/cron-ის გარდა)).
