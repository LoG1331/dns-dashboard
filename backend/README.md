# DNS Backend

Custom backend for the [frontend](../frontend) — talks **directly to the PowerDNS HTTP API** (modeled on how PowerDNS-Admin forwards requests), with no dependency on PowerDNS-Admin.

## Architecture

- **Express + SQLite** (`node:sqlite`, no native driver needed)
- Auth: JWT (hand-rolled HS256) + passwords hashed with `crypto.scrypt`
- **A single admin account only** — created automatically from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` on startup; no signup, OTP, email, or OAuth
- Admin can change name, email (`PUT /auth/profile`), and password
- Zone ownership stored in SQLite; records read/written directly through the PowerDNS rrsets API
- PowerDNS config (`pdnsApiUrl`, `pdnsApiKey`, `pdnsServerId`) and nameservers (`ns1`, `ns2`) editable **from the Settings page** — stored in SQLite, overriding env values

## Run

```bash
cp .env.example .env   # fill in PDNS_API_URL, PDNS_API_KEY, JWT_SECRET, NS1, NS2
npm install
npm run dev            # http://localhost:5001/api
```

Frontend: in `frontend/`, set `VITE_API_URL=http://localhost:5001/api` in `.env`, then `npm run dev`.

## API endpoints

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | Log in → `{ token }` |
| `GET /api/auth/me` | Admin info |
| `PUT /api/auth/profile` | Change name + email |
| `POST /api/auth/change-password` | Change password (requires old password) |
| `GET/PUT /api/config` | View/edit PowerDNS API + nameservers config from the Settings page |
| `GET/POST/DELETE /api/templates[/:id]` | Zone templates (auto-applied when creating a domain) |
| `GET/POST/DELETE /api/zones[/:id]` | Zone management |
| `GET/POST/DELETE /api/zones/:id/records` | Record management (rrsets) |
| `POST /api/zones/:id/verify` | Check NS delegation via dns.google |
| `GET /api/zones/:id/export` | Export BIND zone file |
| `GET /api/public/stats` | Statistics from PowerDNS `/statistics` (2h cache, rate limit 30/min) |
| `GET /api/dns-checker/check/:domain/:type` | DoH queries: Google, Cloudflare, Quad9 |
| `GET /api/dns-checker/propagation/:domain` | Check NS propagation |

## PowerDNS must have enabled

```ini
api=yes
api-key=<PDNS_API_KEY>
webserver=yes
webserver-address=0.0.0.0
webserver-port=8081
```

Or quickly spin up 2 test servers (master + slave) with podman — see [docs/SETUP-PDNS.md](../docs/SETUP-PDNS.md):

```bash
bash scripts/setup-pdns.sh
```

## Zone flow

1. User creates a zone → backend creates the zone in PowerDNS with NS1/NS2, status `pending_verification`
2. User points the domain's NS to NS1/NS2 and clicks **Check Nameservers** → backend queries dns.google, on match → `active`
3. Only `active` zones can have records added/removed
