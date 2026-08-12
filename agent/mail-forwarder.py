#!/usr/bin/env python3
# mail-forwarder — Postfix pipe that delivers raw RFC822 mail onward.
# Config: /opt/zoner-mail/mail-forwarder.json
#
# Webhook mode:
#   { "target_url": "...", "auth_token": "...", "worker_name": "postfix",
#     "headers": { "X-Custom": "..." },        # extra headers (optional)
#     "body_format": "raw" }                    # raw | base64 | json
#
# Handler mode (local custom script — managed ONLY on the server, the
# dashboard can only pick one from /opt/zoner-mail/handlers/):
#   { "handler": "my-handler.sh" }
#
# Handler runs first, webhook second; mail is accepted only if every
# configured handler succeeds (else EX_TEMPFAIL → postfix retries).

import sys
import os
import json
import subprocess
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser

CONFIG_FILE = os.environ.get(
    "FORWARDER_CONFIG", "/opt/zoner-mail/mail-forwarder.json"
)
HANDLERS_DIR = os.environ.get("HANDLERS_DIR", "/opt/zoner-mail/handlers")
MAX_ERROR_BODY_LENGTH = 500


def clean(value):
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


def build_headers(config, sender, recipient, raw):
    domain = ""
    if "@" in recipient:
        domain = recipient.rsplit("@", 1)[1].lower()

    headers = {
        "X-Email-Envelope-From": sender,
        "X-Email-Envelope-To": recipient,
        "X-Email-Worker-Name": clean(config.get("worker_name", "postfix")),
        "X-Email-Received-At": datetime.now(
            timezone.utc
        ).isoformat().replace("+00:00", "Z"),
        "X-Email-Size": str(len(raw)),
    }
    if domain:
        headers["X-Email-Domain"] = domain
    token = config.get("auth_token")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # custom headers (optional)
    extra = config.get("headers")
    if isinstance(extra, dict):
        for k, v in extra.items():
            headers[clean(k)] = clean(v)
    return headers, domain


def format_body(config, raw, sender, recipient, domain):
    fmt = config.get("body_format", "raw")
    if fmt == "base64":
        return json.dumps({
            "data": base64.b64encode(raw).decode(),
            "from": sender,
            "to": recipient,
            "domain": domain,
            "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }).encode(), "application/json"
    if fmt == "json":
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        text = ""
        body_part = msg.get_body(preferencelist=("plain",))
        if body_part:
            try:
                text = body_part.get_content()
            except Exception:
                text = ""
        return json.dumps({
            "from": sender,
            "to": recipient,
            "domain": domain,
            "subject": str(msg.get("Subject", "")),
            "date": str(msg.get("Date", "")),
            "text": text,
            "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }).encode(), "application/json"
    return raw, "message/rfc822"  # raw


def run_webhook(config, headers, body, content_type, recipient):
    target = config.get("target_url")
    if not target:
        return 0  # no webhook configured — handler-only mode
    headers = {**headers, "Content-Type": content_type}
    request = urllib.request.Request(target, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if 200 <= response.status < 300:
                print(f"Forwarded {recipient} -> {target}", file=sys.stderr)
                return 0
            return 75
    except urllib.error.HTTPError as e:
        body_err = e.read(MAX_ERROR_BODY_LENGTH).decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {body_err}", file=sys.stderr)
        return 75
    except Exception as e:
        print(f"Forward failed: {e}", file=sys.stderr)
        return 75


def run_handler(config, sender, recipient, domain, raw):
    name = config.get("handler")
    if not name:
        return 0  # no handler configured
    # only plain basenames from the root-managed handlers dir
    if name != os.path.basename(name) or not name:
        print(f"Invalid handler name: {name}", file=sys.stderr)
        return 75
    path = os.path.join(HANDLERS_DIR, name)
    if not os.path.isfile(path) or not os.access(path, os.X_OK):
        print(f"Handler not found: {name}", file=sys.stderr)
        return 75
    env = os.environ.copy()
    env.update({
        "EMAIL_ENVELOPE_FROM": sender,
        "EMAIL_ENVELOPE_TO": recipient,
        "EMAIL_DOMAIN": domain,
        "EMAIL_SIZE": str(len(raw)),
    })
    try:
        proc = subprocess.run([path], input=raw, env=env, timeout=60)
        if proc.returncode != 0:
            print(f"Handler {name} exited {proc.returncode}", file=sys.stderr)
            return 75
        print(f"Handler {name} handled {recipient}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"Handler failed: {e}", file=sys.stderr)
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

    rc = run_handler(config, sender, recipient, domain, raw)
    if rc != 0:
        return rc
    body, content_type = format_body(config, raw, sender, recipient, domain)
    return run_webhook(config, headers, body, content_type, recipient)


if __name__ == "__main__":
    sys.exit(main())
