# -*- coding: utf-8 -*-
"""Logique des endpoints, independante du serveur (Vercel ou Docker)."""

from .harness import run_tests, run_withdrawal, make_flag


def validate(body):
    """POST /api/validate  { code } -> detail des tests (jamais le flag)."""
    code = body.get("code") if isinstance(body.get("code"), str) else ""
    result = run_tests(code)
    return 200, {
        "tests": result["tests"],
        "passed": result["passed"],
        "failed": result["failed"],
        "ready": result["ready"],
    }


def run(body):
    """POST /api/run  { code, balance, amount } -> resultat du retrait (apercu)."""
    code = body.get("code") if isinstance(body.get("code"), str) else ""
    balance = body.get("balance", 0)
    amount = body.get("amount", 0)
    return 200, run_withdrawal(code, balance, amount)


def deploy(body):
    """POST /api/deploy  { code, playerId, stats } -> flag si le correctif passe."""
    code = body.get("code") if isinstance(body.get("code"), str) else ""
    player_id = body.get("playerId") if isinstance(body.get("playerId"), str) else ""
    token = body.get("p") if isinstance(body.get("p"), str) else None
    stats = body.get("stats") if isinstance(body.get("stats"), dict) else {}

    result = run_tests(code)
    if not result["ready"]:
        return 200, {
            "success": False,
            "tests": result["tests"],
            "passed": result["passed"],
            "failed": result["failed"],
            "reason": "health_check_failed",
        }

    return 200, {
        "success": True,
        "tests": result["tests"],
        "passed": result["passed"],
        "failed": result["failed"],
        "flag": make_flag(player_id, token=token),
        "stats": {
            "customersRemaining": _as_int(stats.get("customersRemaining")),
            "incidentDuration": (stats.get("incidentDuration")[:12]
                                 if isinstance(stats.get("incidentDuration"), str) else None),
            "deployments": _as_int(stats.get("deployments")),
            "testsExecuted": _as_int(stats.get("testsExecuted")),
        },
    }


def _as_int(value):
    try:
        n = int(value)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None
