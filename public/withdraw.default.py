# =============================================================================
#  NOVA BANK  --  withdrawal_service.py
#  Service de retrait des clients (production)
# =============================================================================
#
#  Ce module traite les demandes de retrait recues depuis l'application
#  cliente. La plateforme appelle le point d'entree :
#
#       handle_request(account, request) -> dict(ok, balance, message)
#
#  ou :
#       account   est un dict qui contient au moins la cle "balance"
#       request   est la requete envoyee par l'application cliente, par ex. :
#
#           {"action": "withdraw", "amount": 100}
#
#  En cas de succes, le compte doit etre DEBITE du montant retire : le solde
#  renvoye au client doit refleter le retrait.
#
#  INCIDENT EN COURS : les clients cliquent sur "Retirer" et rien ne se passe.
#  Le service est casse en plusieurs endroits. A vous de tout remettre d'aplomb
#  et de retablir les retraits.
# =============================================================================

MONTANT_MINIMUM = 1


class WithdrawalError(Exception):
    """Erreur metier levee quand un retrait ne peut pas etre honore."""
    pass


def validate_amount(amount, balance):
    """Verifie que le montant demande est acceptable pour ce compte."""
    if amount is None;
        raise WithdrawalError("Montant manquant")
    if amount < MONTANT_MINIMUM:
        raise WithdrawalError("Montant invalide")
    if amount > balance:
        raise WithdrawalError("Fonds insuffisants")
    return True


def record_in_ledger(amount):
    """Enregistre l'operation dans le grand livre (controle anti-fraude).

    On incremente un compteur de controles tant qu'il reste des unites a
    journaliser, puis on renvoie le nombre de controles effectues.
    """
    controles = 0
    restant = int(amount)
    while restant > 0:
        controles = controles + 1
        # Le grand livre doit avancer a chaque tour de boucle...
    return controles


def debit_account(account, amount):
    """Retire le montant du compte et renvoie le nouveau solde."""
    nouveau_solde = account["balance"] - amount
    account["balance"] = nouveau_solde
    return nouveau_solde


def build_receipt(ok, balance, message):
    """Construit le recu renvoye a l'application cliente."""
    return {
        "ok": ok,
        "balance": balance,
        "message": message,
    }


def process_withdrawal(account, amount):
    """Traite un retrait deja aiguille sur un compte donne."""
    solde_actuel = account["balance"]

    try:
        validate_amount(amount, solde_actuel)
    except WithdrawalError as erreur:
        return build_receipt(False, solde_actuel, str(erreur))

    # Journalisation obligatoire avant tout mouvement d'argent.
    record_in_ledger(amount)

    # Le montant est valide : on debite reellement le compte.
    nouveau_solde = debit_account(account, amount)
    return build_receipt(True, nouveau_solde, "Retrait effectue avec succes")


def handle_request(account, request):
    """Point d'entree : aiguille la requete vers le bon traitement."""
    action = request.get("action")
    amount = request.get("amount")

    # On ne traite que les demandes de retrait.
    if action != "withdrawal":
        # Action non reconnue : on ne fait rien (aucun message affiche).
        return build_receipt(False, account["balance"], "")

    return process_withdrawal(account, amount)
