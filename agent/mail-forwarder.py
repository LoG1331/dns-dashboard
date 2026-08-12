#!/usr/bin/env python3
# mail-forwarder — Postfix pipe that delivers raw RFC822 mail onward.
# Config: /opt/zoner-mail/mail-forwarder.json
#
# Two modes (set in the config):
#   webhook:  { "target_url": "...", "auth_token": "...", "worker_name": "postfix" }
#   command:  { "command": ["/path/to/script", "arg1", ...] }
#             The command receives the raw message on stdin and
#             SENDER/RECIPIENT as env vars (plus X_EMAIL_* headers as
#             EMAIL_ENVELOPE_FROM / EMAIL_ENVELOPE_TO / EMAIL_DOMAIN ...).
# If both are present, the command runs first, then the webhook.

import sys
import os
import json
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone

CONFIG_FILE = os.environ.get(
    "FORWARDER_CONFIG", "/opt/zoner-mail/mail-forwarder.json"
)
MAX_ERROR_BODY_LENGTH = 500


def clean(value):
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


def build_headers(config, sender, recipient, raw):
    domain = ""
    if "@" in recipient:
        domain = recipient.rsplit("@", 1)[1].lower()

    headers = {
        "Content-Type": "message/rfc822",
        "X-Email-Envelope-From": sender,
        "X-Email-Envelope-To": recipient,
        "X-Email-Worker-Name": clean(config.get("worker_name", "postfix")),
        "X-Email-Received-At": datetime.now(
            timezone.utc
        ).isoformat().replace("+00:00", "Z"),
        "X-Email-Processing-Mode": "forward",
        "X-Email-Size": str(len(raw)),
    }
    if domain:
        headers["X-Email-Domain"] = domain
    token = config.get("auth_token")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers, domain


def run_webhook(config, headers, raw, recipient):
    target = config.get("target_url")
    if not target:
        return 0  # no webhook configured — command-only mode
    request = urllib.request.Request(
        target, data=raw, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if 200 <= response.status < 300:
                print(f"Forwarded {recipient} -> {target}", file=sys.stderr)
                return 0
            return 75
    except urllib.error.HTTPError as e:
        body = e.read(MAX_ERROR_BODY_LENGTH).decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        return 75
    except Exception as e:
        print(f"Forward failed: {e}", file=sys.stderr)
        return 75


def run_command(config, sender, recipient, domain, raw):
    cmd = config.get("command")
    if not cmd:
        return 0  # no custom command configured
    if isinstance(cmd, str):
        cmd = [cmd]
    env = os.environ.copy()
    env.update({
        "EMAIL_ENVELOPE_FROM": sender,
        "EMAIL_ENVELOPE_TO": recipient,
        "EMAIL_DOMAIN": domain,
        "EMAIL_SIZE": str(len(raw)),
    })
    try:
        proc = subprocess.run(cmd, input=raw, env=env, timeout=60)
        if proc.returncode != 0:
            print(f"Command {cmd[0]} exited {proc.returncode}", file=sys.stderr)
            return 75
        print(f"Command {cmd[0]} handled {recipient}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"Command failed: {e}", file=sys.stderr)
        return 75


def main():
    if len(sys.argv) != 3:
        return 64  # EX_USAGE

    sender = clean(sys.argv[1])
    recipient = clean(sys.argv[2])

    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 75  # EX_TEMPFAIL — postfix will retry

    raw = sys.stdin.buffer.read()
    headers, domain = build_headers(config, sender, recipient, raw)

    # Custom command first, webhook second; mail is accepted only if
    # every configured handler succeeds (else EX_TEMPFAIL → retry).
    rc = run_command(config, sender, recipient, domain, raw)
    if rc != 0:
        return rc
    return run_webhook(config, headers, raw, recipient)


if __name__ == "__main__":
    sys.exit(main())
