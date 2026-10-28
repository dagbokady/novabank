# -*- coding: utf-8 -*-
"""Helpers partages par les fonctions serverless Vercel (api/*.py)."""

import json

MAX_BODY_BYTES = 256 * 1024  # 256 Ko : largement suffisant pour withdraw.py


def read_json_body(handler):
    try:
        length = int(handler.headers.get("content-length") or 0)
    except (TypeError, ValueError):
        length = 0
    if length <= 0 or length > MAX_BODY_BYTES:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def send_json(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
