# Mail integration (Postfix catch-all → webhook)

Zoner manages the mail receiver remotely from the dashboard (tab **Mail**), the same way it talks to PowerDNS: an HTTP agent on the mail server, URL + Bearer token.

```
Dashboard "Mail" tab
  → zoner backend /api/mail/*
  → HTTP + Bearer token
  → mail-agent (mail server :9099)
  → mail-domain → /opt/zoner-mail/transport → postmap + reload postfix
```

## 1. Bootstrap the mail server (one command)

On the mail VPS (Ubuntu, sudo):

```bash
sudo MX_HOSTNAME=mx.example.com \
     WEBHOOK_URL=https://your-app/v1/inbound/email \
     bash backend/scripts/install-mail-server.sh
```

The script does everything: opens TCP/25, installs Postfix (Internet Site) + Python, installs the forwarder + mail-domain + agent into **`/opt/zoner-mail/`**, registers the webhook pipe in `master.cf` (marked block), and starts the `zoner-mail-agent` systemd service. It prints the **agent URL + token** at the end — save them.

Everything custom lives in `/opt/zoner-mail/`. Clean removal:

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

- The agent runs as the unprivileged `zoner` user (systemd `NoNewPrivileges`, `ProtectSystem=strict`); it can only run `mail-domain` as root via a narrow sudoers rule (`NOPASSWD` on that exact script)
- The forwarder's `command` is **never settable remotely** — only a handler chosen from `/opt/zoner-mail/handlers/` (root-managed directory) may be picked
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

```bash
journalctl -u postfix -f | grep --line-buffered postfix
# send a mail to anything@your-domain, success looks like:
#   relay=webhook, status=sent
```
