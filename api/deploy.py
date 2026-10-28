# -*- coding: utf-8 -*-
# Fonction serverless Vercel : POST /api/deploy (delivre le flag si valide)
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.endpoints import deploy             # noqa: E402
from lib.webcommon import read_json_body, send_json  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = read_json_body(self)
        status, payload = deploy(body)
        send_json(self, status, payload)

    def do_GET(self):
        send_json(self, 405, {"error": "method_not_allowed"})
