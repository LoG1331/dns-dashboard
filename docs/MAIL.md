# Mail integration (Haraka catch-all → webhook)

Zoner manages the mail receiver remotely from the dashboard (tab **Mail**), the same way it talks to PowerDNS: an HTTP agent on the mail server, URL + Bearer token.

```
Dashboard "Mail" tab
  → zoner backend /api/mail/*
  → HTTP + Bearer token
  → mail-agent (mail server :9099)
  → edits /opt/zoner-mail/haraka/config/host_list → Haraka reads it per-RCPT (no reload needed)
```

## Architecture

- **Haraka** (Node.js) listens on `:25`; the `webhook` plugin accepts any domain in `host_list` (rcpt hook) and POSTs the message onward (queue hook).
- **mail-agent** (Python, stdlib only) manages `host_list` and the forwarder config over HTTP.
- **Everything runs as the invoking user** (`$SUDO_USER`, override with `RUN_USER`) — no root, no sudoers, no Postfix. Port 25 is bound via `AmbientCapabilities=CAP_NET_BIND_SERVICE` in the systemd unit.
- Delivery failure (handler exit ≠ 0 or webhook not 2xx) → Haraka answers **4xx**, the sending MTA retries. Nothing is queued locally.

## 1. Bootstrap the mail server (one command)

On the mail VPS (Ubuntu, sudo):

```bash
sudo MX_HOSTNAME=mx.example.com \
     WEBHOOK_URL=https://your-app/v1/inbound/email \
     bash backend/scripts/install-mail-server.sh
```

The script does everything: installs a self-contained Node LTS into `/opt/zoner-mail/node`, installs Haraka + the webhook plugin + the agent into **`/opt/zoner-mail/`**, opens TCP/25 (ufw and/or iptables), and starts the `zoner-haraka` + `zoner-mail-agent` systemd services. It prints the **agent URL + token** at the end — save them.

Everything lives in `/opt/zoner-mail/`. Clean removal:

```bash
sudo bash backend/scripts/install-mail-server.sh --uninstall
```

## 2. Dashboard Settings

| Field | Value |
|---|---|
| MX Hostname | `mx.example.com` |
| Mail Agent URL | `http://<mail-server-ip>:9099` |
| Agent Token | from the install output |

## 3. DNS

- `A` record: `mx.example.com` → mail server public IP (Cloudflare: **DNS only**)
- MX per domain is **auto-created** by the dashboard when the zone exists

## 4. Use

Tab **Mail** → add domain → the zone gets its MX record automatically and the mail server starts accepting `*@domain` (catch-all → forwarder).

## 5. Custom mail handling (webhook or your own script)

The forwarder is configurable remotely — dashboard **Settings → Mail Forwarder**:

- **Webhook URL (+token)**: POST the mail with `X-Email-*` headers
- **Body format**: `raw` (RFC822 as-is) | `base64` (JSON envelope) | `json` (parsed From/To/Subject/text)
- **Custom headers**: extra headers for the webhook
- **Handler**: pick one of the pre-installed scripts in `/opt/zoner-mail/handlers/` — runs locally with the raw message on stdin and envelope in `EMAIL_*` env vars

## Security model

If the zoner dashboard is compromised, the mail server is NOT:

- Both services run as the invoking (unprivileged) user — there is no root anywhere in the stack: no sudoers rule, no setuid, no root pipe
- The agent service is locked down with systemd `NoNewPrivileges` + `ProtectSystem=strict`; the Haraka service gets only `CAP_NET_BIND_SERVICE`
- The forwarder's `command` is **never settable remotely** — only a handler chosen from `/opt/zoner-mail/handlers/` (managed locally on the server) may be picked
- The agent token is a random 32-char string, shown once at install; stored AES-256-GCM-encrypted in zoner's DB
- Recommended: bind the agent to a private IP (`AGENT_HOST`) and firewall port 9099 to the zoner host only:
  `ufw allow from <zoner-ip> to any port 9099`

Equivalent config file on the server: `/opt/zoner-mail/mail-forwarder.json`

```json
{
  "target_url": "https://your-app/v1/inbound/email",
  "auth_token": "",
  "body_format": "raw",
  "handler": "my-handler.sh"
}
```

## 6. Test

E2E test in a disposable podman container (installer + systemd units + real SMTP → webhook):

```bash
bash backend/scripts/test-mail-server-podman.sh
```

Manual:

```bash
journalctl -u zoner-haraka -f
# send a mail to anything@your-domain, success looks like:
#   [webhook] Forwarded user@your-domain -> https://your-app/v1/inbound/email
```

## Migrating from the old Postfix stack

The previous stack (Postfix + `mail-domain` + `mail-forwarder.py` + sudoers) is **not** removed by this script. To migrate: run the old script's `--uninstall` first (it removes `/opt/zoner-mail`, the sudoers rule, the `zoner` user and the `master.cf` block; Postfix itself can then be purged with `apt purge postfix`), then install the new stack.
