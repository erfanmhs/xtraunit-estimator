# XtraUnit Estimator

A web app for turning construction plans into priced scopes and proposals.

This page is the technical home base for the project. It explains what every
folder is for, how to run the app on your computer, and how it will go live on
the web. It is written for a non-technical reader — no prior coding knowledge
assumed.

---

## What this project is built with

- **Next.js** — the framework that runs the website (both the pages people see
  and the behind-the-scenes server code).
- **React** — the tool Next.js uses to build the on-screen interface.
- **TypeScript** — a stricter version of JavaScript that catches mistakes
  early, before they reach a user.
- **Tailwind CSS** — how the app is styled (colors, spacing, layout).
- **Supabase** — the database and user-login system (added, not yet connected).
- **Anthropic Claude** — the AI that will do the estimating (added, not yet
  connected).

You don't need to understand these to use the project. They're listed so anyone
new can get oriented.

---

## Folder structure, in plain language

```
Project estimator APP/
├── src/                  ← All of OUR code lives here. This is the part we build.
│   ├── app/              ← The PAGES and routes of the website.
│   │   ├── page.tsx          The homepage (currently "Coming Soon").
│   │   ├── layout.tsx        The shared frame wrapped around every page.
│   │   ├── globals.css       App-wide styling.
│   │   └── favicon.ico       The little icon in the browser tab.
│   │
│   ├── components/       ← Reusable pieces of interface (buttons, headers,
│   │                       cards). Build once, use on many pages. (Empty for now.)
│   │
│   ├── lib/              ← The "engine room" — code that connects to outside
│   │   │                   services and shared helper logic.
│   │   ├── supabase/
│   │   │   ├── client.ts     Talks to the database FROM THE BROWSER.
│   │   │   └── server.ts     Talks to the database FROM THE SERVER.
│   │   └── anthropic.ts      Talks to Claude (server-only, keeps the key secret).
│   │
│   ├── config/          ← App-wide settings in one place.
│   │   └── site.ts          The app name, company name, and tagline.
│   │
│   └── types/           ← Shared definitions of what our data looks like.
│       └── index.ts         Starting point; grows as features are built.
│
├── public/              ← Files served as-is (images, logos, etc.).
├── .env.local.example   ← TEMPLATE listing the secret keys the app needs.
├── .env.local           ← YOUR real secret keys (you create this; never shared).
├── package.json         ← The project's ID card + list of installed libraries.
├── next.config.ts       ← Settings for how Next.js builds and serves the app.
└── README.md            ← This file.
```

**The one rule worth remembering:** everything we build goes inside `src/`.
Pages go in `src/app/`, reusable interface pieces go in `src/components/`, and
connections to outside services go in `src/lib/`.

---

## Running the app on your computer

You need **Node.js** installed (it already is on this machine). Then:

1. Open a terminal in this folder.
2. Install the libraries (only needed the first time, or after new ones are
   added):
   ```
   npm install
   ```
3. Start the app in development mode:
   ```
   npm run dev
   ```
4. Open your browser to **http://localhost:3000**. You should see
   **"XtraUnit Estimator — Coming Soon"**.

To stop the app, go back to the terminal and press `Ctrl + C`.

### The other commands

- `npm run build` — packages the app for going live. Also a good way to check
  for errors.
- `npm run start` — runs the packaged ("production") version locally.
- `npm run lint` — checks the code for common mistakes and style issues.

---

## Setting up the secret keys

The app needs credentials for Supabase and Claude. These are kept out of the
code so they never leak.

1. Make a copy of `.env.local.example` and name the copy `.env.local`.
2. Open `.env.local` and fill in the real values:
   - **Supabase** keys come from your Supabase project under
     *Settings → API*.
   - **Claude** key comes from the Anthropic Console at
     <https://console.anthropic.com> under *API Keys*.
3. Save the file and restart the app (`Ctrl + C`, then `npm run dev` again).

`.env.local` is automatically ignored by git, so your secrets never get
uploaded anywhere. The `.env.local.example` template has no secrets in it and is
safe to keep.

> Note: keys starting with `NEXT_PUBLIC_` are sent to the browser and are not
> secret. Everything else stays on the server. The Claude key is server-only on
> purpose.

---

## Going live, and embedding as a tab

The app was set up from day one to be deployed to the web and embedded inside a
larger company platform.

- **Deploying:** Next.js apps deploy cleanly to hosts like Vercel (made by the
  same team). The `npm run build` command produces what the host needs.
- **Embedding as a tab:** because the app is a normal website, the larger
  platform can show it inside a tab (usually via an iframe or a link). If the
  platform needs to serve this app under a sub-path (for example
  `company.com/estimator`), that is set with a `basePath` value in
  `next.config.ts`. We'll set that when the platform details are known — no
  rebuild required.

---

## Where things stand

- ✅ Project created and running.
- ✅ Tailwind styling ready.
- ✅ Supabase and Claude libraries installed and wired up to connect.
- ✅ Placeholder homepage.
- ⬜ Real Supabase and Claude credentials (add to `.env.local`).
- ⬜ User login (Supabase auth + session middleware).
- ⬜ The actual estimator features.
