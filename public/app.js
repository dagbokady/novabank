/* NOVA BANK — moteur du challenge (client).
 * Le code du joueur est en Python et s'execute cote serveur : l'apercu bancaire
 * appelle /api/run a chaque retrait pour refleter VRAIMENT le code courant.
 * Aucun flag ni solution ici : le flag vient du backend apres validation. */

(function () {
  'use strict';

  // --------------------------------------------------------------- Parametres
  var TOTAL_SECONDS = 300;       // 5 minutes jusqu'a 0 client (echeance fixe)
  var START_CUSTOMERS = 100000;

  // --------------------------------------------------------------- Etat
  var state = {
    playerId: ensurePlayerId(),
    // Token EsaticShare present dans le lien `?p=...` (si le joueur vient de la
    // plateforme). Permet de delivrer un flag rattache a son compte.
    token: new URLSearchParams(location.search).get('p') || null,
    editor: null,
    fallbackEl: null,
    bankBalance: 0,
    customers: START_CUSTOMERS,
    schedule: [],
    dropIndex: 0,
    elapsed: 0,
    resolved: false,
    interrompu: false,
    perdu: false,
    wasFullscreen: false,
    armed: false,          // anti-triche actif seulement apres le 1er geste
    startTime: Date.now(),
    deployments: 0,
    testsExecuted: 0,
    withdrawBusy: false,
  };

  function ensurePlayerId() {
    try {
      var id = localStorage.getItem('novabank.playerId');
      if (!id) {
        id = 'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem('novabank.playerId', id);
      }
      return id;
    } catch (e) { return 'p_' + Math.random().toString(36).slice(2); }
  }

  var $ = function (s) { return document.querySelector(s); };
  function fmt(n) { return Number(n).toLocaleString('fr-FR').replace(/ /g, ' '); }
  function money(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function getCode() {
    if (state.editor) return state.editor.getValue();
    if (state.fallbackEl) return state.fallbackEl.value;
    return '';
  }

  // --------------------------------------------------------------- Save state
  function markUnsaved() {
    if (state.resolved) return;
    var el = $('#saveState'); el.dataset.state = 'unsaved'; el.textContent = 'unsaved changes';
  }
  function markSaved() {
    var el = $('#saveState'); el.dataset.state = 'saved'; el.textContent = 'changes saved';
  }

  // --------------------------------------------------------------- Console
  function clearConsole() { $('#console').innerHTML = ''; }
  function logLine(text, cls) {
    var div = document.createElement('div');
    div.className = 'console-line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    $('#console').appendChild(div);
    $('#console').scrollTop = $('#console').scrollHeight;
  }

  // --------------------------------------------------------------- Apercu bancaire
  function initBank() {
    // Solde et montant a retirer tires au hasard a chaque session.
    state.bankBalance = randInt(1200, 7400) + Math.random() * 0.99;
    var amount = randInt(40, Math.min(900, Math.floor(state.bankBalance) - 200));
    $('#balance').textContent = money(state.bankBalance);
    $('#amount').value = String(amount);
    setBankMessage('', '');
    $('#withdraw-btn').addEventListener('click', onWithdraw);
  }

  function setBankMessage(text, kind) {
    var m = $('#message');
    m.textContent = text || ' ';
    m.className = 'b-msg' + (kind ? ' ' + kind : '');
  }

  // Chaque clic rejoue le code Python courant du joueur cote serveur.
  async function onWithdraw() {
    if (state.withdrawBusy) return;
    state.withdrawBusy = true;
    markSaved();
    var amount = Number(String($('#amount').value).replace(',', '.'));
    if (!isFinite(amount)) amount = 0;
    try {
      var res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: getCode(), balance: state.bankBalance, amount: amount }),
      });
      var data = await res.json();
      state.bankBalance = Number(data.balance);
      $('#balance').textContent = money(state.bankBalance);
      if (data.message) setBankMessage(data.message, data.ok ? 'ok' : 'err');
      else setBankMessage('', '');
    } catch (e) {
      setBankMessage('Service injoignable', 'err');
    } finally {
      state.withdrawBusy = false;
    }
  }

  // --------------------------------------------------------------- Tests
  async function runTests() {
    markSaved();
    state.testsExecuted += 1;
    $('#btnTests').disabled = true;
    clearConsole();
    logLine('$ pytest withdrawal_service', 'console-head');
    logLine('');
    await sleep(400);
    try {
      var res = await fetch('/api/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: getCode() }),
      });
      var data = await res.json();
      for (var i = 0; i < data.tests.length; i++) {
        await sleep(240);
        var t = data.tests[i];
        logLine((t.passed ? 'PASS  ' : 'FAIL  ') + t.name, t.passed ? 'console-ok' : 'console-fail');
      }
      logLine('');
      logLine(data.passed + ' passed, ' + data.failed + ' failed', data.failed === 0 ? 'console-ok' : 'console-fail');
      if (data.ready) { logLine(''); logLine('==> READY FOR DEPLOYMENT', 'console-ready'); }
    } catch (e) {
      logLine('erreur reseau pendant les tests', 'console-fail');
    } finally {
      $('#btnTests').disabled = false;
    }
  }

  // --------------------------------------------------------------- Deploiement
  async function deploy() {
    if (state.resolved) return;
    markSaved();
    state.deployments += 1;
    $('#btnDeploy').disabled = true;
    $('#btnTests').disabled = true;

    var overlay = $('#deployOverlay'), log = $('#deployLog'), closeBtn = $('#deployClose');
    $('#deployTitle').textContent = '$ deploy withdrawal-service';
    log.innerHTML = ''; closeBtn.hidden = true; overlay.hidden = false;

    var apiPromise = fetch('/api/deploy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: getCode(), playerId: state.playerId, p: state.token, stats: liveStats() }),
    }).then(function (r) { return r.json(); }).catch(function () { return { success: false }; });

    await deployStep(log, 'building image...');
    await deployStep(log, 'running production tests...');
    await deployStep(log, 'rolling out withdrawal-service...');
    await deployStep(log, 'health check...');

    var data = await apiPromise;
    if (data && data.success) {
      appendDeploy(log, 'deployment successful.', 'l-ok');
      await sleep(800);
      overlay.hidden = true;
      resolveIncident(data);
    } else {
      appendDeploy(log, '', '');
      appendDeploy(log, 'DEPLOYMENT FAILED', 'l-fail');
      appendDeploy(log, 'production health check failed.', 'l-fail');
      appendDeploy(log, 'withdrawal transaction unsuccessful.', 'l-fail');
      appendDeploy(log, 'rollback completed.', 'l-fail');
      closeBtn.hidden = false;
      $('#btnDeploy').disabled = false;
      $('#btnTests').disabled = false;
    }
  }
  function deployStep(log, text) { appendDeploy(log, text, 'l-run'); return sleep(650); }
  function appendDeploy(log, text, cls) {
    var d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; log.appendChild(d);
  }

  // --------------------------------------------------------------- Incident resolu
  function resolveIncident(data) {
    state.resolved = true;
    $('#monStatus').textContent = 'state: HEALTHY';
    $('#monStatus').style.color = 'var(--ok)';
    $('#nextDrop').textContent = '--';
    monLog('ok', 'withdrawal-service retabli');
    monLog('ok', 'incident resolu, perte de clients stoppee');

    var stats = (data && data.stats) || {};
    $('#winCustomers').textContent = fmt(stats.customersRemaining != null ? stats.customersRemaining : state.customers);
    $('#winDuration').textContent = stats.incidentDuration || mmss(Date.now() - state.startTime);
    $('#winDeploys').textContent = stats.deployments != null ? stats.deployments : state.deployments;
    $('#winTests').textContent = stats.testsExecuted != null ? stats.testsExecuted : state.testsExecuted;
    $('#flagValue').textContent = data.flag;
    $('#winOverlay').hidden = false;
  }

  function liveStats() {
    return {
      customersRemaining: state.customers,
      incidentDuration: mmss(Date.now() - state.startTime),
      deployments: state.deployments,
      testsExecuted: state.testsExecuted,
    };
  }

  // --------------------------------------------------------------- Monitoring (log brut)
  var COMPLAINTS = [
    'cust#8291 ticket opened: "le retrait ne marche pas"',
    'cust#1842 note: closing account, moving funds',
    'cust#7721 ticket opened: "bouton Retirer sans effet"',
    'cust#3098 retry withdraw amount=120 result=noop',
    'cust#5540 ticket opened: "mon solde ne bouge pas"',
    'cust#9123 retry withdraw amount=60 result=noop',
  ];
  var complaintIdx = 0;

  function nowClock() {
    var d = new Date();
    return d.toTimeString().slice(0, 8);
  }
  function monLog(level, text) {
    var feed = $('#feed');
    var cls = level === 'alert' ? 'lv-alert' : level === 'warn' ? 'lv-warn' : level === 'ok' ? 'lv-ok' : 'lv-info';
    var line = document.createElement('span');
    line.className = cls;
    line.textContent = '[' + nowClock() + '] ' + level.toUpperCase().padEnd(5) + ' ' + text + '\n';
    feed.appendChild(line);
    // garde l'historique borne
    while (feed.childNodes.length > 60) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
  }

  // Construit un planning de chutes : intervalles ET montants aleatoires, mais
  // calibre pour atteindre exactement 0 client a la fin des 5 minutes.
  function buildSchedule() {
    var times = [];
    var t = 0;
    while (true) {
      t += randInt(7, 20);                 // intervalle variable entre deux chutes
      if (t >= TOTAL_SECONDS) break;
      times.push(t);
    }
    times.push(TOTAL_SECONDS);             // derniere chute pile a l'echeance
    // Chaque palier recoit un poids aleatoire : la perte de clients varie d'un
    // palier a l'autre, tout en finissant exactement a 0.
    var weights = times.map(function () { return 0.5 + Math.random(); });
    var totalW = weights.reduce(function (a, b) { return a + b; }, 0);
    var plan = [];
    var cum = 0;
    for (var i = 0; i < times.length; i++) {
      cum += weights[i];
      var value = (i === times.length - 1)
        ? 0                                // fin du compte a rebours => 0 client
        : Math.round(START_CUSTOMERS * (1 - cum / totalW));
      plan.push({ t: times[i], customers: value });
    }
    return plan;
  }

  function startSimulation() {
    state.schedule = buildSchedule();
    $('#customerCount').textContent = fmt(state.customers);
    $('#nextDrop').textContent = state.schedule.length ? state.schedule[0].t : '--';
    monLog('alert', 'withdrawal-service DOWN - les retraits echouent');
    monLog('info', 'pager: ingenieur d astreinte alerte pour l incident retraits');

    setInterval(function () {
      if (stopped()) return;
      state.elapsed += 1;
      var next = state.schedule[state.dropIndex];
      if (next && state.elapsed >= next.t) {
        var delta = state.customers - next.customers;
        state.customers = next.customers;
        var el = $('#customerCount');
        el.textContent = fmt(state.customers);
        el.classList.remove('drop'); void el.offsetWidth; el.classList.add('drop');
        monLog('alert', 'clients=' + fmt(state.customers) + ' delta=-' + fmt(delta) + ' service=withdrawals');
        state.dropIndex += 1;
        next = state.schedule[state.dropIndex];
        if (state.customers === 0) { gameOver(); return; }
      }
      $('#nextDrop').textContent = next ? Math.max(0, next.t - state.elapsed) : '--';
    }, 1000);

    setInterval(function () {
      if (stopped()) return;
      var c = COMPLAINTS[complaintIdx % COMPLAINTS.length]; complaintIdx += 1;
      monLog('info', c);
    }, 5200);
  }

  // --------------------------------------------------------------- Immersion
  function setupImmersion() {
    var askedFs = false;
    function goFullscreen() {
      if (askedFs) return; askedFs = true;
      var el = document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) { try { req.call(el); } catch (e) { /* ignore */ } }
    }
    // Le 1er geste du joueur passe en plein ecran ET arme l'anti-triche :
    // tant qu'il n'a pas commence, quitter la fenetre n'interrompt rien (sinon
    // un onglet ouvert en arriere-plan se couperait tout seul).
    function demarrer() {
      goFullscreen();
      // petit delai : le geste de demarrage ne doit pas s'auto-interrompre.
      setTimeout(function () { state.armed = true; }, 400);
    }
    document.addEventListener('pointerdown', demarrer, { once: true });
    document.addEventListener('keydown', demarrer, { once: true });

    var inFlag = function (t) { return !!(t && t.closest && t.closest('.flag-block')); };
    document.addEventListener('copy', function (e) { if (!inFlag(e.target)) e.preventDefault(); });
    document.addEventListener('cut', function (e) { if (!inFlag(e.target)) e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) { if (!inFlag(e.target)) e.preventDefault(); });
    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      var k = e.key.toLowerCase();
      if ((k === 'c' || k === 'x') && !inFlag(document.activeElement)) e.preventDefault();
    }, true);

    // 4) Anti-triche / immersion : quitter la fenetre (changer d'onglet,
    //    reduire, passer a une autre application) ou sortir du plein ecran
    //    avant la fin interrompt la partie.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) interrompre();
    });
    window.addEventListener('blur', interrompre);
    document.addEventListener('fullscreenchange', function () {
      if (document.fullscreenElement) state.wasFullscreen = true;
      else if (state.wasFullscreen) interrompre();
    });
  }

  // Partie terminee (gagnee, perdue ou interrompue) : plus rien ne tourne.
  function stopped() { return state.resolved || state.perdu || state.interrompu; }

  function verrouiller() {
    $('#btnTests').disabled = true;
    $('#btnDeploy').disabled = true;
    try { if (state.editor && state.editor.updateOptions) state.editor.updateOptions({ readOnly: true }); } catch (e) {}
    if (state.fallbackEl) state.fallbackEl.readOnly = true;
  }

  // Termine la partie quand le joueur quitte la fenetre avant d'avoir fini.
  function interrompre() {
    if (!state.armed || stopped()) return;
    state.interrompu = true;
    verrouiller();
    $('#interruptOverlay').hidden = false;
  }

  // Echec : la banque a perdu tous ses clients avant la resolution.
  function gameOver() {
    if (stopped()) return;
    state.perdu = true;
    $('#monStatus').textContent = 'state: DOWN';
    monLog('alert', 'base clients epuisee - incident non resolu, service perdu');
    verrouiller();
    $('#gameoverOverlay').hidden = false;
  }

  // --------------------------------------------------------------- Editeur
  function initFallbackEditor(code) {
    var host = $('#editor'); host.innerHTML = '';
    var ta = document.createElement('textarea');
    ta.className = 'fallback'; ta.spellcheck = false; ta.value = code;
    ta.addEventListener('input', markUnsaved);
    host.appendChild(ta); state.fallbackEl = ta;
  }
  function initMonaco(code) {
    if (!window.require || !window.require.config) { initFallbackEditor(code); return; }
    try {
      window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs' } });
      window.require(['vs/editor/editor.main'], function () {
        state.editor = monaco.editor.create($('#editor'), {
          value: code, language: 'python', theme: 'vs-dark', fontSize: 13,
          minimap: { enabled: false }, scrollBeyondLastLine: false,
          automaticLayout: true, padding: { top: 10 }, contextmenu: false,
        });
        state.editor.onDidChangeModelContent(markUnsaved);
      }, function () { initFallbackEditor(code); });
    } catch (e) { initFallbackEditor(code); }
  }

  // --------------------------------------------------------------- Boot
  async function boot() {
    var code = '';
    try { code = await (await fetch('withdraw.default.py')).text(); } catch (e) { code = ''; }
    initMonaco(code);
    initBank();
    startSimulation();
    setupImmersion();

    window.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); markSaved(); }
    });
    $('#btnTests').addEventListener('click', runTests);
    $('#btnDeploy').addEventListener('click', deploy);
    $('#deployClose').addEventListener('click', function () { $('#deployOverlay').hidden = true; });
    $('#restartBtn').addEventListener('click', function () { location.reload(); });
    $('#restartBtn3').addEventListener('click', function () { location.reload(); });
    $('#copyFlag').addEventListener('click', async function () {
      try { await navigator.clipboard.writeText($('#flagValue').textContent); $('#copyFlag').textContent = 'Copie !'; }
      catch (e) { /* copie manuelle possible */ }
    });
  }

  boot();
})();
