# -*- coding: utf-8 -*-
"""
harness.py
----------
Coeur serveur du challenge NOVA BANK (version Python).

Responsabilites :
  1. run_tests(code)   : execute le code Python du joueur dans un espace de noms
                         restreint, puis verifie le COMPORTEMENT attendu
                         (une demande de retrait debite-t-elle le compte ?).
                         On n'effectue aucune comparaison textuelle du code :
                         plusieurs correctifs valides passent donc.
  2. run_withdrawal(..) : rejoue le code du joueur sur un compte donne pour que
                         l'apercu bancaire reflete VRAIMENT son code Python.
  3. make_flag(id)     : derive un flag unique par joueur via HMAC-SHA256 d'un
                         secret serveur (jamais envoye au navigateur).

Contrat attendu du code joueur :
    handle_request(account, request) -> dict(ok, balance, message)
    - account : dict contenant au moins la cle "balance"
    - request : dict de la forme {"action": "withdraw", "amount": <nombre>}
    - en cas de succes, account["balance"] doit etre debite du montant.

Securite : le code du joueur ne doit jamais s'executer sur l'hote avec des
privileges. Ici on retire les builtins dangereux (open/exec/eval/import/...),
on impose un timeout strict, et cote Docker on ajoute un utilisateur non
privilegie, un filesystem en lecture seule, l'absence de reseau et des limites
CPU/memoire. Le secret du flag n'est jamais injecte dans l'espace d'execution.
"""

import builtins as _builtins
import hashlib
import hmac
import os
import threading

TIMEOUT_SEC = 2.0

# Builtins retires de l'environnement du joueur (durcissement de base).
_BLOCKED = {
    "open", "exec", "eval", "compile", "input", "__import__", "memoryview",
    "globals", "locals", "vars", "breakpoint", "help", "exit", "quit",
    "copyright", "credits", "license",
}


def _safe_builtins():
    return {name: getattr(_builtins, name) for name in dir(_builtins) if name not in _BLOCKED}


def _with_timeout(fn):
    """Execute fn() dans un thread et impose un timeout. Reflechit l'exception."""
    box = {}

    def target():
        try:
            box["value"] = fn()
        except BaseException as exc:  # on capture tout pour le remonter proprement
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(TIMEOUT_SEC)
    if thread.is_alive():
        raise TimeoutError("timeout")
    if "error" in box:
        raise box["error"]
    return box.get("value")


def _load_module(code):
    """Compile et execute le code joueur dans un espace de noms isole."""
    namespace = {"__builtins__": _safe_builtins(), "__name__": "withdrawal_service"}
    compiled = compile(str(code or ""), "withdraw.py", "exec")
    exec(compiled, namespace)  # noqa: S102 - execution volontaire, environnement restreint
    return namespace


def _get_entry(namespace):
    fn = namespace.get("handle_request")
    return fn if callable(fn) else None


def run_tests(code):
    """Renvoie le detail des tests comportementaux (sans jamais le flag)."""
    tests = []

    # 1. Le service se charge sans planter.
    namespace = None
    loaded = False
    try:
        namespace = _with_timeout(lambda: _load_module(code))
        loaded = True
    except BaseException:
        loaded = False
    tests.append(("Le service de retrait se charge", loaded))

    # 2. Le point d'entree attendu existe.
    entry = _get_entry(namespace) if namespace else None
    has_entry = entry is not None
    tests.append(("Point d'entree handle_request disponible", has_entry))

    # 3. Une demande de retrait valide debite le compte.
    debite = False
    if has_entry:
        try:
            def valid_call():
                account = {"balance": 2450}
                res = entry(account, {"action": "withdraw", "amount": 100})
                return account, res
            account, res = _with_timeout(valid_call)
            debite = (
                isinstance(res, dict)
                and res.get("ok") is True
                and account.get("balance") == 2350
            )
        except BaseException:
            debite = False
    tests.append(("Une demande de retrait debite le compte", debite))

    # 4. Les montants invalides et les fonds insuffisants sont refuses
    #    sans toucher au solde.
    refuse = False
    if has_entry:
        try:
            def guard_call():
                acc_zero = {"balance": 2450}
                r_zero = entry(acc_zero, {"action": "withdraw", "amount": 0})
                acc_big = {"balance": 2450}
                r_big = entry(acc_big, {"action": "withdraw", "amount": 999999})
                return acc_zero, r_zero, acc_big, r_big
            acc_zero, r_zero, acc_big, r_big = _with_timeout(guard_call)
            refuse = (
                isinstance(r_zero, dict) and r_zero.get("ok") is False
                and acc_zero.get("balance") == 2450
                and isinstance(r_big, dict) and r_big.get("ok") is False
                and acc_big.get("balance") == 2450
            )
        except BaseException:
            refuse = False
    tests.append(("Les retraits invalides sont refuses", refuse))

    passed = sum(1 for _, ok in tests if ok)
    return {
        "tests": [{"name": name, "passed": ok} for name, ok in tests],
        "passed": passed,
        "failed": len(tests) - passed,
        "ready": passed == len(tests),
    }


def run_withdrawal(code, balance, amount):
    """Rejoue le code du joueur sur un compte reel (pour l'apercu bancaire)."""
    try:
        balance = float(balance)
        amount = float(amount)
    except (TypeError, ValueError):
        return {"ok": False, "balance": 0, "message": "Requete invalide"}

    try:
        namespace = _with_timeout(lambda: _load_module(code))
    except BaseException:
        return {"ok": False, "balance": balance, "message": "Erreur de chargement du service"}

    entry = _get_entry(namespace)
    if entry is None:
        return {"ok": False, "balance": balance, "message": "Service de retrait indisponible"}

    try:
        account = {"balance": balance}
        res = _with_timeout(lambda: entry(account, {"action": "withdraw", "amount": amount}))
    except BaseException:
        return {"ok": False, "balance": balance, "message": "Erreur pendant le retrait"}

    if not isinstance(res, dict):
        return {"ok": False, "balance": balance, "message": "Reponse invalide du service"}

    # Le solde du compte fait foi : c'est lui que voit le client.
    new_balance = account.get("balance", balance)
    try:
        new_balance = float(new_balance)
    except (TypeError, ValueError):
        new_balance = balance
    return {
        "ok": bool(res.get("ok")),
        "balance": new_balance,
        "message": str(res.get("message", "")),
    }


def make_flag(player_id):
    """Flag unique et deterministe par joueur (secret cote serveur uniquement).

    On lit en priorite FLAG_SECRET (le secret partage par tous les challenges et
    par EsaticShare), avec repli sur CHALLENGE_SECRET pour compatibilite.
    """
    secret = (os.environ.get("FLAG_SECRET")
              or os.environ.get("CHALLENGE_SECRET")
              or "nova-bank-dev-secret-change-me")
    pid = str(player_id or "anonymous")[:128]
    digest = hmac.new(secret.encode("utf-8"), ("nova-bank|" + pid).encode("utf-8"),
                      hashlib.sha256).hexdigest()
    return "ESATICSHARE{nova_bank_saved_" + digest[:12] + "}"
