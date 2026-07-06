# Deploying the web app to Vercel (free)

The Next.js app lives in `web/`. Vercel + Neon free tiers make this $0.

## Prerequisites (all free)
- A **GitHub** account (Vercel deploys from a Git repo).
- A **Vercel** account (sign in with GitHub).
- A **Neon** account (free serverless Postgres).

## 1. Push the repo to GitHub
From the project root:
```bash
git add .
git commit -m "Add web app"
git remote add origin https://github.com/<you>/media-tracker.git
git push -u origin main
```

## 2. Create the database (Neon)
- New project at neon.tech → copy the **connection string** (looks like
  `postgres://user:pass@host/db?sslmode=require`). That's your `DATABASE_URL`.
- No manual schema step: the app runs `CREATE TABLE IF NOT EXISTS` on first use.

## 3. Generate Web Push keys
```bash
npx web-push generate-vapid-keys
```
Keep the public + private key for the env vars below.

## 4. Import into Vercel
- Vercel → **Add New → Project** → import the GitHub repo.
- **IMPORTANT: set Root Directory = `web`** (the app is in a subfolder, not repo root).
- Framework preset auto-detects **Next.js**. Leave build/output defaults.

## 5. Environment variables (Vercel → Project → Settings → Environment Variables)
```
TMDB_API_KEY              = ...
IGDB_CLIENT_ID            = ...
IGDB_CLIENT_SECRET        = ...
DATABASE_URL              = <Neon connection string>
VAPID_PUBLIC_KEY          = ...
VAPID_PRIVATE_KEY         = ...
VAPID_SUBJECT             = mailto:you@example.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY = <same as VAPID_PUBLIC_KEY>
CRON_SECRET               = <any long random string>
```
Add them for Production (and Preview if you want previews to work).

## 6. Deploy
Click **Deploy**. You get a `https://<project>.vercel.app` URL. Search works
immediately; follow/push work once the DB + VAPID vars are set.

## 7. The scheduled poller
- `vercel.json` already declares the cron: `GET /api/poll` daily at 08:00 UTC.
- Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to cron
  invocations, which `/api/poll` checks — so set `CRON_SECRET` in step 5.
- **Hobby (free) plan:** cron runs at most **once per day**, which our daily
  schedule fits. (Release dates don't change hourly, so daily is fine.)

## Notes / gotchas
- The poll + push routes need the **Node.js runtime** (they use `web-push`); we
  didn't set `runtime = "edge"`, so that's already correct.
- `maxDuration = 60` on the poll route is within the Hobby limit; fine at personal scale.
- **iOS notifications** require installing the PWA via **Add to Home Screen** first.
- Add `public/icon-192.png` and `public/icon-512.png` for a proper install icon
  (referenced by `manifest.json`).
- Redeploy happens automatically on every push to `main`.
