# Mail integration (Postfix catch-all → webhook)

Zoner can manage the mail receiver from the dashboard (tab **Mail**) when it runs on the same machine as Postfix (e.g. ns1).

## How it works

```
Dashboard "Mail" tab
  → backend API /api/mail/domains
  → sudo -n /usr/local/sbin/mail-domain <add|remove|list>
  → /etc/postfix/transport + relay_domains + postfix reload
```

Adding a mail domain also auto-creates an MX record (`10 <mxHost>`) in the matching zone if that zone is managed in the dashboard.

## Setup (once, on the mail server)

1. Postfix + the mail-domain script as in your notes (`custom_receiver.md`): `mail-forwarder`, webhook pipe in `master.cf`, `/usr/local/sbin/mail-domain`.

2. Allow the user running zoner to call `mail-domain` without a password:

```bash
echo '<zoner-user> ALL=(root) NOPASSWD: /usr/local/sbin/mail-domain' | sudo tee /etc/sudoers.d/zoner-mail
sudo chmod 440 /etc/sudoers.d/zoner-mail
```

3. In the dashboard **Settings** page:
   - **MX Hostname**: e.g. `mx.example.com` (the A record pointing at this server's public IP, DNS-only on Cloudflare)
   - Mail command defaults to `/usr/local/sbin/mail-domain` (changeable via config key `mailCmd`)

## Notes

- Domains are validated with a strict regex and passed via `execFile` (no shell) — no injection.
- DNS side still needs per-domain: `MX @ 10 mx.example.com` (auto-created by the dashboard when the zone exists) and the `mx.` A record.
- If the mail-domain script is missing or sudoers is not configured, the Mail tab shows the error from the command.
