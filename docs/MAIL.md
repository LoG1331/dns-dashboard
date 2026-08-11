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

Tab **Mail** → add domain → the zone gets its MX record automatically and the mail server starts accepting `*@domain` (catch-all → webhook).

## 5. Test

```bash
journalctl -u postfix -f | grep --line-buffered postfix
# send a mail to anything@your-domain, success looks like:
#   relay=webhook, status=sent
```
