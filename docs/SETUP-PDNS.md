# Setup 2 PowerDNS servers (ns1 master + ns2 slave) with Podman — full notes

Goal: 2 authoritative PowerDNS servers, ns1 as master, ns2 as slave, replication via NOTIFY + AXFR, with the dashboard backend connecting to ns1.

## The 2 scripts

| Script | Where it runs | When to use |
|---|---|---|
| `scripts/install-pdns.sh` | **inside each server** (Ubuntu VPS, requires sudo) | Real server deployment — installs pdns via apt, writes master/slave config, initializes sqlite, runs via **systemd** (auto-falls back to nohup if systemd is unavailable, e.g. containers), opens UFW, prints the API key + sample backend config |
| `scripts/setup-pdns.sh` | local machine (requires podman) | Local testing — spins up 2 ubuntu:24.04 containers then **runs the exact same install-pdns.sh inside the containers**, and finally writes `backend/.env` automatically |

```bash
# Real server deployment:
sudo bash install-pdns.sh master   # on ns1
sudo bash install-pdns.sh slave    # on ns2
# (prompts for the peer's private IP if PEER_IP is not passed; leaving PDNS_API_KEY empty auto-generates one)

# Local testing with podman:
bash scripts/setup-pdns.sh          # sets up everything + writes .env
bash scripts/setup-pdns.sh --clean  # wipes everything
```

## 1. Architecture

| Container | Role | DNS (host) | API (host) | IP on dnsnet |
|---|---|---|---|---|
| ns1 | Master (primary) | 127.0.0.1:5353 (udp+tcp) | http://127.0.0.1:8081 | 10.89.0.2 |
| ns2 | Slave (secondary) | 127.0.0.1:5454 (udp+tcp) | http://127.0.0.1:8082 | 10.89.0.3 |

- Podman network `dnsnet` lets the 2 containers reach each other by internal name/IP
- Port 53 on the host is taken by systemd-resolved → mapped to 5353/5454
- Shared API key: `e2e-secret-key` (change via the `PDNS_E2E_KEY` variable)

## 2. Setup process (what the script does)

1. `podman network create dnsnet`
2. Run 2 `ubuntu:24.04` containers with `sleep infinity`, publishing DNS + API ports
3. Exec into each container and install from scratch:
   ```bash
   apt-get update && apt-get install -y pdns-server pdns-backend-sqlite3 sqlite3 dnsutils curl
   ```
   (PowerDNS 4.8.3 from the Ubuntu 24.04 repo)
4. Write `/etc/powerdns/pdns.conf` — **note: must use `podman exec -i`** (without `-i` the heredoc never reaches stdin and the config ends up empty — a bug we hit and fixed):

   **ns1 (master):**
   ```ini
   launch=gsqlite3
   gsqlite3-database=/var/lib/powerdns/pdns.sqlite3
   api=yes
   api-key=e2e-secret-key
   webserver=yes
   webserver-address=0.0.0.0
   webserver-port=8081
   webserver-allow-from=0.0.0.0/0
   primary=yes
   allow-axfr-ips=10.89.0.3
   also-notify=10.89.0.3
   local-address=0.0.0.0
   ```

   **ns2 (slave):**
   ```ini
   launch=gsqlite3
   gsqlite3-database=/var/lib/powerdns/pdns.sqlite3
   api=yes
   api-key=e2e-secret-key
   webserver=yes
   webserver-address=0.0.0.0
   webserver-port=8081
   webserver-allow-from=0.0.0.0/0
   secondary=yes
   autosecondary=yes
   allow-notify-from=10.89.0.2
   allow-axfr-ips=
   local-address=0.0.0.0
   ```

5. Initialize the sqlite schema: `sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql`
6. Run directly (containers have no systemd): `podman exec -d <ns> bash -c 'pdns_server --daemon=no'`
7. Wait for the API on both ports to be ready
8. **Automatically writes config into `backend/.env`** (enough for the backend to use immediately, no manual edits needed):
   - `PDNS_API_URL` / `PDNS_API_KEY` / `ZONE_KIND=Master` / `NS1` / `NS2`
   - `PDNS_MASTER_ADDRESS=<ns1 LAN IP>` (fetched dynamically from podman inspect)
   - `PDNS_SECONDARIES=[{"name":"ns2","apiUrl":"http://127.0.0.1:8082","apiKey":...}]`

> Note: values in the DB (saved via Settings) override env — delete `data.sqlite` if you want to go back to the script-provided config.

## 3. Connecting the dashboard backend

`backend/.env`:
```ini
PDNS_API_URL=http://127.0.0.1:8081
PDNS_API_KEY=e2e-secret-key
ZONE_KIND=Master        # Native does NOT replicate — Master is required for master/slave
NS1=ns1.dnstest.local
NS2=ns2.dnstest.local
```

`ZONE_KIND` is a newly added env var (`pdns.js`): zones created through the dashboard get this kind. Use `Master` when you have secondaries, `Native` for standalone operation.

## 4. Replication ns1 → ns2: mechanism & caveats

**Standard mechanism**: a Master zone on ns1 changes → ns1 sends NOTIFY (to the zone's NS records + IPs in `also-notify`) → ns2 checks the serial → transfers via AXFR/IXFR.

**Caveat 1 — autosecondary won't auto-create slave zones for local domains**: `autosecondary=yes` requires pdns to **resolve the zone's NS records via DNS** (using a recursor, NOT reading `/etc/hosts`) to confirm it has been delegated. With test `.local` domains, ns2 logs:

```
Received NOTIFY for test1.local ... trying supermaster
Unable to find backend willing to host test1.local ... Remote nameservers: (empty)
```

→ **Solved in the backend**: when creating/deleting a zone, the backend automatically calls each secondary's API (configured in Settings → "Secondary Servers" + "Master Address") to create/delete the corresponding slave zone — the same way PowerDNS-Admin does it. No manual steps needed.

```
# equivalent manual command if needed:
curl -X POST -H "X-API-Key: e2e-secret-key" -H 'Content-Type: application/json' \
  http://127.0.0.1:8082/api/v1/servers/localhost/zones \
  -d '{"name":"test1.local.","kind":"Slave","masters":["10.89.0.2"],"nameservers":[]}'
```

**Caveat 2 — notify delay**: NOTIFY by NS name fails ("nameserver does not resolve") for fake domains — but `also-notify=<ns2 IP>` (direct IP) still works. NOTIFY is processed by pdns through a queue, so ns2 updates with a ~5–40 second delay; if you're in a hurry, run `podman exec ns1 pdns_control notify <zone>`.

**Caveat 3**: old slave zones on ns2 (created manually before auto-provisioning existed) are not removed automatically — delete them manually via the ns2 API if needed.

## 5. E2E test results (actually executed)

| # | Test | Result |
|---|---|---|
| 1 | `GET /api/config` — connection badge | ✅ `pdnsConnected: true` |
| 2 | Create template "web" (A + CNAME) | ✅ |
| 3 | Create zone `test1.local` with template via backend | ✅ zone kind Master on ns1, records present immediately |
| 4 | `dig @127.0.0.1 -p 5353` ns1 | ✅ A 192.0.2.10, CNAME www → apex |
| 5 | Create slave zone on ns2 + replication | ✅ ns2 answers identically to ns1 (AXFR) |
| 6 | Add record `api.test1.local A 192.0.2.99` via backend | ✅ ns1 immediately, ns2 after NOTIFY+AXFR (serial bumped to 103) |
| 7 | Export BIND via backend | ✅ correct zone file format |
| 8 | List/search records via backend | ✅ |
| 9 | Delete record via backend | ✅ gone on ns1 immediately, gone on ns2 after AXFR (serial 104) |
| 10 | Create zone `legacy.local` directly on ns1 → click **Sync** | ✅ `imported: ["legacy.local"]`, status active, shows on dashboard |
| 11 | Delete zone via backend | ✅ removed from ns1 + DB **and the slave zone on ns2 is auto-deleted** (auto-provision) |
| 12 | Create zone `test2.local` via backend | ✅ slave zone **auto-created on ns2**, SOA present after AXFR |
| 13 | Delete zone `test2.local` via backend | ✅ gone from both ns1 and ns2 |

**Note**: the "Check Nameservers" button (NS verification via dns.google) only works with real delegated domains — local test domains fail as designed. For internal testing, set the status to `active` manually:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('data.sqlite').prepare(\"UPDATE zones SET status='active'\").run()"
```

(or create the zone directly on PowerDNS and click Sync — imported zones are already `active`)

## 6. Useful commands

```bash
# pdns logs (if running with file redirect)
podman exec ns2 tail -f /var/log/pdns.log

# list zones
podman exec ns1 pdns_control list-zones

# re-trigger notify
podman exec ns1 pdns_control notify <zone>

# dig tests
dig @127.0.0.1 -p 5353 <zone> A     # ns1
dig @127.0.0.1 -p 5454 <zone> A     # ns2
```
