# Taking XtraUnit Estimator live

Plain-language steps to put the app on the internet so partners can use it.
The code is already in git and deploy-ready (`render.yaml`). What's left is the
account setup only you can do, then connecting them.

---

## The pieces (and why each one)

| Piece | Who | Cost | Why |
|---|---|---|---|
| **GitHub** repo | you create, Claude pushes | free | The code's home; the host deploys from it |
| **Render** web service | you create | ~$7/mo (Starter) | Runs the app, stays on 24/7 for the background AI jobs |
| **Supabase** | already have | free now, $25/mo (Pro) later | Database, logins, file storage — already cloud |
| **GoDaddy** domain | already have | already paid | Point `app.xtraunit.com` at Render (one DNS record) |

Don't buy hosting at GoDaddy — its hosting can't run this kind of app. Use it
for the domain name only.

---

## Step 1 — GitHub (you)
1. Make a free account at github.com.
2. Create a new **private** repository named `xtraunit-estimator` (empty — no
   README, no .gitignore; the project already has them).
3. Tell Claude the repo URL. Claude pushes the code up.

## Step 2 — Render (you)
1. Sign up at render.com **using your GitHub account** (the "Sign in with
   GitHub" button) so Render can see the repo.
2. New → **Blueprint** → pick the `xtraunit-estimator` repo. Render reads
   `render.yaml` and sets up the service automatically.
3. In the service's **Environment** tab, add the three secrets (values come
   from your existing `.env.local` — copy them exactly):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
4. Deploy. In a few minutes you get a live URL like
   `xtraunit-estimator.onrender.com`.

## Step 3 — Lock the door BEFORE sharing (you, in Supabase) ‼️
Right now anyone who finds the URL can create an account, and every "Generate"
they click spends **your** Anthropic budget. Before sharing the link:
- Supabase → **Authentication → Sign In / Up → turn OFF "Allow new users to
  sign up."**
- Create each partner's account by hand: **Authentication → Users → Add user.**

## Step 4 — Supabase production touches (you)
- **Redirect URLs:** Supabase → Authentication → URL Configuration → add your
  Render URL (and later `https://app.xtraunit.com`) so email login/confirm links
  point at the live site, not localhost.
- **File size:** the free tier caps uploads at 50 MB. If partners upload big
  plan sets, upgrade to **Supabase Pro ($25/mo)** (also adds backups).

## Step 5 — Custom domain (optional, later)
1. Render → service → **Settings → Custom Domain** → add `app.xtraunit.com`.
   Render shows a DNS target.
2. GoDaddy → your domain → DNS → add the **CNAME** record Render gives you
   (`app` → the Render target). Claude can give you exact values when you're here.

---

## Before each deploy
Run a production build locally to catch anything `tsc` doesn't:
```
npm run build
```
If it succeeds, push — Render auto-deploys. (Don't run `npm run build` while a
`npm run dev` server is mid-generation; it shares the `.next` folder.)

---

## Honest cost picture
- **Feedback phase (now):** Render $7 + Supabase free + AI usage ≈ **$10–15/mo**
  plus AI costs. Budget Supabase Pro ($25) if plan sets are large.
- **Selling phase (later):** ~$100–300/mo infra until revenue, plus Stripe
  billing, real signup, team/company accounts, and the job-queue upgrade that
  unlocks multi-instance scale (see `render.yaml`).

---

## What's deliberately deferred (so we don't over-build now)
- **Company/team accounts** (seats sharing one cost database) — needed before
  real customers, cheaper to build before they exist than to retrofit.
- **Terms of service with the anonymized-data clause** — must exist from the
  first outside user for the future data product to be legitimate.
- **Job queue + background worker** — survives restarts, enables horizontal
  scale, and is the permanent cure for the "generation interrupted" case.
