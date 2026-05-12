# Lilay UX Revamp

A React + Vite revamp of the Lilay profile manager, optimized for iPhone Safari and Cloudflare Pages.

## Features

- Mobile-first dark neon blue UI
- Google Apps Script sheet loading for Accounts, Posts, Reply, Comments, Caption, and Follow
- Profile navigation with remembered last profile
- Copy helpers with Safari-friendly clipboard fallback
- Instagram/Threads opening and iOS Shortcuts links
- TOTP generation with live countdown using Web Crypto
- SMSPool ordering, balance, stock, cancel, resend, and polling
- 5SIM support through a Cloudflare Worker proxy
- Browser-remembered settings and user-entered API keys via `localStorage`

## Local Development

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
```

The production output is generated in `dist`.

## Environment Variables

Create `.env.local` if you need to override the 5SIM proxy URL:

```bash
VITE_FIVESIM_PROXY_URL=https://your-worker.your-subdomain.workers.dev
```

The app does not hardcode SMS provider API keys. Users enter SMSPool API keys or 5SIM bearer tokens in the UI, and the browser remembers them with `localStorage`.

## Cloudflare Pages Deployment

### Option 1: Deploy from GitHub

1. Push this project to your `lilay-uxrevamp` GitHub repository.
2. Open Cloudflare Dashboard.
3. Go to **Workers & Pages**.
4. Select **Create application**.
5. Select **Pages**.
6. Select **Connect to Git**.
7. Choose the `lilay-uxrevamp` repository.
8. Use these build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** leave blank if the app is at the repository root
9. Add this environment variable only if you want to override the included 5SIM proxy fallback:
   - `VITE_FIVESIM_PROXY_URL=https://your-worker.your-subdomain.workers.dev`
10. Click **Save and Deploy**.

### Option 2: Deploy with Wrangler

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name lilay-uxrevamp
```

## Push to a New GitHub Repository

Create an empty repository on GitHub named `lilay-uxrevamp`, then run these commands from this project folder:

```bash
git init
git add .
git commit -m "Initial React Vite revamp"
git branch -M main
git remote add origin https://github.com/<your-username>/lilay-uxrevamp.git
git push -u origin main
```

Replace `<your-username>` with your GitHub username or organization.

## Notes for iPhone Safari

- Clipboard write/read requires HTTPS and usually a direct button tap.
- `shortcuts://` links only work on Apple devices with matching Shortcuts installed.
- Add the Cloudflare Pages site to your iPhone Home Screen for the best app-like experience.
