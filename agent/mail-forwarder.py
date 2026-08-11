#!/usr/bin/env python3
# mail-forwarder — Postfix pipe that forwards raw RFC822 mail to a webhook.
# Config: /opt/zoner-mail/mail-forwarder.json
#   { "target_url": "...", "auth_token": "...", "worker_name": "postfix" }

import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

CONFIG_FILE = "/opt/zoner-mail/mail-forwarder.json"
MAX_ERROR_BODY_LENGTH = 500


def clean(value):
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


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

    target = config.get("target_url")
    if not target:
        print("target_url missing", file=sys.stderr)
        return 75

    raw = sys.stdin.buffer.read()

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

    request = urllib.request.Request(
        target,
        data=raw,
        headers=headers,
        method="POST"
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


if __name__ == "__main__":
    sys.exit(main())
