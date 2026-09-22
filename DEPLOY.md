# Deploying to a VPS (smm.staccc.app)

The app is a static frontend plus a tiny Node server (`server.js`) that serves it
**and** proxies TextVerified on the same origin (TextVerified blocks browser CORS, so
it must be proxied). Caddy sits in front for automatic HTTPS.

```
Browser ──HTTPS──> Caddy (:443, smm.staccc.app) ──> Node server (:8080)
                                                     ├─ serves dist/ (the built app)
                                                     └─ /api/textverified/* → textverified.com/api/pub/v2/*
```

## Recommended OS

**Ubuntu 24.04 LTS** — best-documented, LTS support to 2029, and every tool below has
first-class packages. Runs comfortably on the cheapest 1 vCPU / 1 GB VPS. (Debian 12 is a
fine, slightly leaner alternative if you prefer it; the commands are the same.)

## 1. DNS

Point an **A record** for `smm.staccc.app` at the VPS's public IPv4 (and an `AAAA` record
at its IPv6 if it has one). Wait for it to resolve before starting Caddy (Caddy needs it to
issue the TLS certificate).

## 2. Install Node.js 20 LTS + Caddy

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

## 3. Get the code and build

```bash
cd /opt
sudo git clone https://github.com/houshasei/lilay-uxrevamp.git lilay
sudo chown -R "$USER" lilay
cd lilay
npm install
npm run build      # produces dist/
```

## 4. Run the Node server (keep it alive with systemd)

Create `/etc/systemd/system/lilay.service`:

```ini
[Unit]
Description=Lilay app server
After=network.target

[Service]
WorkingDirectory=/opt/lilay
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lilay
sudo systemctl status lilay      # should be "active (running)"
```

## 5. HTTPS with Caddy

Copy the repo's `Caddyfile` to `/etc/caddy/Caddyfile` (it already targets
`smm.staccc.app` → `localhost:8080`), then:

```bash
sudo cp /opt/lilay/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches a Let's Encrypt certificate automatically. Open **https://smm.staccc.app**.

## 6. Updating after a git push

```bash
cd /opt/lilay && git pull && npm install && npm run build && sudo systemctl restart lilay
```

## Notes

- The **other SMS providers are unchanged**: SMSPool/Grizzly are called directly and 5SIM
  still goes through your Cloudflare Worker. Only TextVerified uses this VPS proxy. If you
  later want to consolidate 5SIM here too, that's a small addition to `server.js`.
- TextVerified needs **two credentials** (API key + username/email); enter both in the app's
  SMS Provider panel. The service is hardcoded to `instagram` in `src/api/textverified.js`.
- Local dev (`npm run dev`) proxies `/api/textverified` to TextVerified via `vite.config.js`,
  so you can test without the Node server.
