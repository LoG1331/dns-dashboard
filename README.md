# DNS Dashboard

Self-hosted DNS management panel powered by **PowerDNS** — modern web frontend + custom-built backend API, supporting master/slave replication across multiple nameservers.

## Structure

```
.
├── frontend/   # Web UI (Vite + React + Tailwind) — http://localhost:5173
├── backend/    # API backend (Express + SQLite) — http://localhost:5001/api
└── docs/       # PowerDNS master/slave setup docs + E2E results
```

## Features

- Zone management: add/delete, sync from PowerDNS (automatic every 30 minutes + manual sync button)
- Record management: A, AAAA, CNAME, TXT, MX, SRV, CAA — full validation, search
- Zone templates: create preset record sets, apply when adding a domain
- Export zone to BIND zone file
- Verify NS delegation (check whether nameservers have been pointed over)
- Configure PowerDNS / nameservers / secondary servers right from the Settings page
- **Multi-server**: automatically create/delete slave zones on secondaries when adding/deleting zones
- Auth: a single admin account (seeded from env), JWT, change email/password in Settings

## Quick start

### Option 1: npm (simplest)

```bash
npm install -g @log1331/zoner   # or: npx @log1331/zoner
zoner                           # open http://localhost:5001
```

On first run it creates `~/.local/zoner/` and prints the admin password exactly once. Point it at your PowerDNS server from the Settings page after logging in.

> Global install note: if your npm prefix is `/usr` (default on many distros), use `sudo npm i -g @log1331/zoner`. The dashboard stores its data in `~/.local/zoner` of whichever user runs it (run with `sudo` → `/root/.local/zoner`).

### Option 2: one-command bootstrap (rootless)

```bash
curl -fsSL https://raw.githubusercontent.com/LoG1331/dns-dashboard/main/scripts/bootstrap.sh | bash
```

Installs Node 22 into `~/.local` if missing, downloads the release, seeds random secrets (printed once), and runs via a systemd user service or nohup. Optional variables: `INSTALL_DIR`, `REPO_URL`.

### Option 3: from source

```bash
# 1. Spin up 2 test PowerDNS servers (master ns1 + slave ns2) with podman:
cd backend && bash scripts/setup-pdns.sh        # seeds config straight into the DB

# 2. Backend:
cd backend && npm install && npm run dev        # :5001

# 3. Frontend:
cd frontend && npm install && npm run dev       # :5173
```

Default login: `admin@example.com` / `Admin@123` (change in `backend/.env`, then delete `backend/data.sqlite` to re-seed, or change it on the Settings page).

## Deploying to real servers

See [docs/SETUP-PDNS.md](docs/SETUP-PDNS.md) — the `backend/scripts/install-pdns.sh` script runs directly on each Ubuntu VPS:

```bash
sudo bash install-pdns.sh master   # on ns1
sudo bash install-pdns.sh slave    # on ns2
```

> PowerDNS connection (API URL, key, nameservers, zone kind, secondaries) is configured from the Settings page after login — stored in the DB, not read from env.
