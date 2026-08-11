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

```bash
# 1. Spin up 2 test PowerDNS servers (master ns1 + slave ns2) with podman:
cd backend && bash scripts/setup-pdns.sh        # automatically writes config to backend/.env

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

## One-command deploy (bootstrap — dashboard only, ROOTLESS)

Host the `scripts/bootstrap.sh` file + a release tarball somewhere (GitHub raw, object storage...), then on a clean Ubuntu server (**no sudo required**):

```bash
curl -fsSL <URL>/bootstrap.sh | bash
```

The script automatically: checks for node — skips if node ≥ 22 is present, otherwise downloads the official build to `~/.local/bin` → extracts the release into `~/.local/share/dns-dashboard` → builds the frontend → **seeds `.env` with a random JWT_SECRET + admin password** (printed exactly once) → runs via a systemd **user service** (if available) or nohup. The production backend also serves the built frontend (single port, `SERVE_FRONTEND=true`).

> PowerDNS is installed separately via `backend/scripts/install-pdns.sh` on the nameservers — bootstrap does not touch it. If PowerDNS is on another machine, pass `PDNS_API_URL=http://<ns1-ip>:8081` and `PDNS_API_KEY=<ns1 key>` when running (or edit later on the Settings page).

Optional variables: `INSTALL_DIR`, `PDNS_API_URL`, `PDNS_API_KEY`, `NS1_HOST`, `NS2_HOST`.
