# NOVA BANK — Guide organisateur

> Fichier **réservé aux organisateurs**. Il n'est jamais servi par l'application
> web (il vit à la racine, hors du dossier `public/`, seul dossier exposé).
> Ne le déployez pas dans un espace public.

Challenge CTF immersif d'intervention sur **incident de production**. Le joueur
n'a pas l'impression de chercher un flag : il doit **sauver une banque** en
réparant un bug dans un service Python et en déployant son correctif.

---

## 1. Scénario

NOVA BANK subit une panne critique. Les clients saisissent un montant et
cliquent sur **Retirer**, mais rien ne se passe : le solde ne bouge pas. La
banque part de **100 000 clients** et en perd **5 000 toutes les 15 secondes** —
soit **0 client en 5 minutes** si l'incident n'est pas résolu. Le joueur,
développeur d'astreinte, doit corriger le **service de retrait Python** et le
**pousser en production** avant l'échéance.

Trois panneaux plein écran, **collés** (sans espacement) :
- **Gauche** : éditeur Monaco avec `withdraw.py`, console de tests, boutons
  *run tests* / *push to production*.
- **Droite haut** : l'application cliente, look **banque en ligne des années
  2000** (aperçu réel du code du joueur).
- **Droite bas** : console de **monitoring** brute (log tail horodaté, compteur
  de clients, ETA avant zéro).

---

## 2. Les bugs volontaires

Fichier : `public/withdraw.default.py`. Le service contient **trois** bugs, à
corriger en cascade (chaque correction révèle le suivant). Difficulté
**débutant**, ~10 à 20 min au total.

### Bug 1 — point-virgule (le module ne se charge plus)

Dans `validate_amount`, un en-tête `if` se termine par `;` au lieu de `:` :

```python
if amount is None;
    raise WithdrawalError("Montant manquant")
```

C'est une `SyntaxError` : le module ne se charge pas du tout → **tous** les
tests échouent (0/4). Réflexe « C/JavaScript » classique.

### Bug 2 — boucle infinie (le service se fige)

Dans `record_in_ledger` (appelée à chaque retrait valide), le compteur de la
boucle n'est **jamais** décrémenté :

```python
restant = int(amount)
while restant > 0:
    controles = controles + 1
    # 'restant' ne change jamais -> boucle infinie
return controles
```

Dès qu'un retrait valide est traité, le service tourne sans fin → la requête
expire (timeout serveur) → « rien ne se passe ». Ce bug n'apparaît qu'une fois
le bug 3 corrigé (sans quoi `process_withdrawal` n'est jamais appelée).

### Bug 3 — mauvais aiguillage (rien ne se passe)

Dans `handle_request`, le routeur compare à `"withdrawal"` alors que
l'application envoie `{"action": "withdraw", ...}` (documenté en haut du
fichier) :

```python
if action != "withdrawal":          # devrait etre "withdraw"
    return build_receipt(False, account["balance"], "")
```

Toute demande tombe dans la branche « action non reconnue » qui ne fait rien et
n'affiche aucun message.

---

## 3. Solution attendue

```python
# Bug 1
if amount is None:

# Bug 2 (dans record_in_ledger, a l'interieur de la boucle)
restant = restant - 1

# Bug 3
if action != "withdraw":
```

---

## 4. Autres solutions acceptées

La validation est **comportementale**, pas textuelle. Tout correctif équivalent
passe, par exemple :

- Bug 2 : n'importe quoi qui fait terminer la boucle (ou une réécriture de
  `record_in_ledger` sans boucle), tant que `process_withdrawal` renvoie une
  réponse.
- Bug 3 : `if action not in ("withdraw", "withdrawal"):`, ou
  `if action == "withdraw": return process_withdrawal(account, amount)`.

Le joueur peut restructurer librement : tant que le comportement observé est
correct (une demande `{"action":"withdraw","amount":n}` débite le compte, les
montants invalides sont refusés, le service répond sans se figer), les tests
passent.

---

## 5. Fonctionnement de la validation

Code partagé : `lib/harness.py` (utilisé par Vercel **et** par le serveur
Docker via `lib/endpoints.py`).

1. Le code du joueur est exécuté dans un **espace de noms Python restreint** :
   builtins dangereux retirés (`open`, `exec`, `eval`, `compile`, `__import__`,
   `input`…), **timeout strict** (2 s) via un thread surveillé.
2. Contrat attendu : `handle_request(account, request) -> dict(ok, balance,
   message)`, où `account` contient `"balance"` et doit être débité en cas de
   succès.
3. Quatre vérifications comportementales :
   - le service se charge sans planter ;
   - `handle_request` existe ;
   - une demande `{"action":"withdraw","amount":100}` débite le compte
     (2450 → 2350) et renvoie `ok=True` ;
   - un montant `0` et un montant supérieur au solde sont refusés **sans**
     toucher au solde.

Endpoints :
- `POST /api/validate` `{ code }` → détail des tests (**jamais** le flag).
- `POST /api/run` `{ code, balance, amount }` → rejoue le code du joueur sur un
  compte, pour que **l'aperçu bancaire reflète vraiment son Python** à chaque
  clic sur *Retirer*.
- `POST /api/deploy` `{ code, playerId, stats }` → rejoue la validation et ne
  renvoie le flag que si les quatre tests passent.

---

## 6. Configuration du flag

Flag **dérivé côté serveur** et **unique par joueur** :

```
ESATICSHARE{nova_bank_saved_<hmac12>}
```

`<hmac12>` = 12 premiers hex de
`HMAC-SHA256(FLAG_SECRET, "nova-bank|" + playerId)`.

- `FLAG_SECRET` : **variable d'environnement serveur**, jamais envoyée au
  navigateur (défaut `nova-bank-dev-secret-change-me` en dev).
- `playerId` : identifiant anonyme généré côté client (localStorage).
- Le flag **n'apparaît jamais** côté client (HTML, JS, commentaires, source
  maps, fichiers statiques). Seul `/api/deploy` le renvoie, après correctif
  valide. Le code Python du joueur n'a pas accès au secret.

**Avant un événement réel** : définir un `FLAG_SECRET` long et secret
(Docker : `docker-compose.yml` ; Vercel : *Settings → Environment Variables*).

**Vérifier un flag soumis** (script organisateur) :

```bash
FLAG_SECRET=... python3 -c 'import hmac,hashlib,os,sys;s=os.environ["FLAG_SECRET"];i=sys.argv[1];print("ESATICSHARE{nova_bank_saved_"+hmac.new(s.encode(),("nova-bank|"+i).encode(),hashlib.sha256).hexdigest()[:12]+"}")' <playerId>
```

---

## 7. Lancement Docker

```bash
docker compose up --build
```

Puis <http://localhost:8080>. (Les limites de sécurité sont dans
`docker-compose.yml` — voir §9.)

---

## 8. Réinitialiser une session

L'état d'un joueur vit uniquement dans son navigateur (le serveur est sans
état, sans base de données) :
- vider le `localStorage` du site ou ouvrir une fenêtre privée donne un
  **nouveau `playerId`**, donc un **nouveau flag** et une **nouvelle session** ;
- clé concernée : `novabank.playerId` ;
- le solde du compte et le montant à retirer sont **tirés au hasard** à chaque
  chargement.

---

## 9. Sécurité de l'exécution du code

La vulnérabilité **simulée** (le bug de retrait) est distincte de la sécurité de
**l'infrastructure**. Mesures :

- Le code du joueur **ne s'exécute jamais sur l'hôte avec des privilèges**.
- Exécution dans un **espace de noms Python restreint** (builtins dangereux
  retirés) avec **timeout 2 s**. Le secret du flag n'y est jamais injecté.
- Corps de requête plafonné (256 Ko).
- Conteneur Docker durci : utilisateur **non privilégié**, `read_only`, `tmpfs`
  pour `/tmp`, `cap_drop: ALL`, `no-new-privileges`, mémoire 256 Mo, CPU et PIDs
  limités, pas d'accès au Docker socket, pas de service externe.

> L'espace de noms restreint n'est pas une frontière de sécurité absolue : pour
> cette v1 (bug simple, validation purement comportementale), c'est suffisant.
> Pour aller plus loin (exécution de code arbitraire riche), isolez dans un
> sandbox dédié : conteneur jetable sans réseau, seccomp, gVisor/Firecracker,
> avec les mêmes limites CPU/mémoire/timeout.

---

## Architecture

```
public/              servi statiquement (Vercel) / par server.py (Docker)
  index.html         interface plein écran 3 panneaux (collés)
  styles.css         appli bancaire 2003 + monitoring brut
  app.js             éditeur, aperçu live via /api/run, simulation, déploiement
  withdraw.default.py  code de départ (buggé) — AUCUN flag
api/                 fonctions serverless Vercel (Python)
  validate.py        POST /api/validate
  run.py             POST /api/run     (aperçu bancaire)
  deploy.py          POST /api/deploy  (délivre le flag)
lib/                 logique partagée Vercel + Docker (NON servie)
  harness.py         bac à sable + tests comportementaux + run + flag
  endpoints.py       logique des endpoints
  webcommon.py       lecture/réponse JSON pour les fonctions Vercel
server.py            serveur Python natif (Docker/local)
Dockerfile, docker-compose.yml, vercel.json, requirements.txt
```

### Déploiement Vercel

Zéro configuration : `public/` sert le front, `api/*.py` deviennent des
fonctions serverless Python (bibliothèque standard uniquement ; `vercel.json`
inclut `lib/` dans le bundle). Importer le dépôt dans Vercel, définir
`FLAG_SECRET`, déployer.

```bash
vercel        # ou: vercel --prod
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
