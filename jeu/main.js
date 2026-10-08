/* Arène — écran, clavier/souris, salle d'attente, boutique. L'hôte fait aussi tourner Sim. */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const C = Sim.CHAMPS, W = Sim.W, H = Sim.H;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* rien */ } },
};
const ICONS = {
  braise: { a: '✨', q: '☄️', w: '🌠', e: '💨', r: '🔥' },
  rempart: { a: '👊', q: '🪝', w: '🛡️', e: '🐂', r: '🌋' },
  fleche: { a: '🏹', q: '🎯', w: '⚡', e: '🌀', r: '💎' },
  ombre: { a: '🗡️', q: '💨', w: '🌑', e: '🧪', r: '☠️' },
};
const KEYS = { a: 'Clic', q: 'Q', w: 'W', e: 'E', r: 'R' };
const RAR = { commun: 'Commun', rare: 'Rare', legende: 'LÉGENDAIRE', malus: 'Malus' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => performance.now() / 1000;

function makeId() {
  let id = null;
  try { id = sessionStorage.getItem('arene-id'); } catch (e) { /* rien */ }
  if (!id) { id = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('arene-id', id); } catch (e) { /* rien */ } }
  return id;
}

const S = {
  id: makeId(), name: store.get('arene-name') || '', champ: C[store.get('arene-champ')] ? store.get('arene-champ') : 'braise',
  room: null, host: false, solo: false, net: null, match: null, info: null, screen: 'home', joining: false,
  snaps: [], offset: null, delay: 0.13, evq: [], lastInfoAt: 0, round: 0, phase: '',
  fx: [], mouse: { x: W / 2, y: H / 2, cx: 0, cy: 0 }, keys: 0, rdown: false, ldown: false, lastMv: 0, lastAtk: 0,
  bet: 10, tab: 'slots', busy: false, shownCoins: null, abChamp: '', hostTimer: null, pingTimer: null, joinTimer: null, pendingE: [], tickN: 0,
  lastInfoJson: '', lastInfoSent: 0, shake: 0, flash: {},
};

/* ------------------------------------------------------------------ petits outils */
function show(id) {
  for (const s of ['home', 'lobby', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
  S.screen = id;
}
function toast(text, big, ms) {
  const d = document.createElement('div');
  d.className = 'toast' + (big ? ' big' : '');
  d.textContent = text;
  $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), ms || 4500);
  while ($('#toasts').children.length > 5) $('#toasts').firstChild.remove();
}
function player(id) { return S.info && S.info.pl.find(p => p.id === id); }
function me() { return player(S.id); }
function colorOf(id) { const p = player(id); return p ? p.col : '#94a3b8'; }
function nameOf(id) { const p = player(id); return p ? p.name : '?'; }

/* Sons très simples (synthétisés, aucun fichier). */
let AC = null;
function beep(f, d, type, vol, slide) {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d);
  } catch (e) { /* pas de son */ }
}
const SND = {
  hit: () => beep(160, 0.08, 'square', 0.04, 90),
  hurt: () => beep(110, 0.15, 'sawtooth', 0.06, 60),
  kill: () => { beep(520, 0.12, 'triangle', 0.07, 260); setTimeout(() => beep(260, 0.25, 'triangle', 0.07, 120), 100); },
  cast: () => beep(420, 0.1, 'sine', 0.035, 700),
  boom: () => beep(90, 0.35, 'sawtooth', 0.07, 40),
  coin: () => { beep(988, 0.08, 'square', 0.04); setTimeout(() => beep(1319, 0.18, 'square', 0.04), 80); },
  tick: () => beep(1200, 0.02, 'square', 0.02),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.06), i * 110)),
  lose: () => beep(300, 0.35, 'sawtooth', 0.04, 120),
  go: () => beep(880, 0.25, 'triangle', 0.07),
};

/* ------------------------------------------------------------------ réseau */
function code4() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; }

function startNet(room) {
  S.room = room;
  S.net = new Net(room, onNet, st => {
    if (st === 'error') toast('Connexion au serveur impossible. Vérifie Internet et réessaie.', true);
  });
  S.net.connect();
}
function onNet(ev, d) {
  if (S.host) { if (ev === 'h' && d && d.f) hostHandle(d.f, d); return; }
  if (ev === 'i') onInfo(d);
  else if (ev === 's') onSnap(d);
  else if (ev === 'x') onFx(d);
}
function sendHost(t, d) {
  const msg = Object.assign({ t }, d || {});
  if (S.host) hostHandle(S.id, msg);
  else if (S.net) S.net.send('h', Object.assign({ f: S.id }, msg));
}

/* --- côté hôte */
function hostHandle(from, msg) {
  const m = S.match;
  if (!m) return;
  if (msg.t === 'join') {
    const p = Sim.addPlayer(m, { id: from, name: msg.name, champ: msg.champ });
    if (!p) broadcastFx({ k: 'full', id: from });
    pushInfo(true);
  } else if (msg.t === 'bye') {
    Sim.removePlayer(m, from); pushInfo(true);
  } else {
    Sim.input(m, from, msg);
    if (['champ', 'ready', 'slots', 'roul', 'box'].includes(msg.t)) pushInfo(true);
  }
}
function broadcastFx(d) { if (S.net) S.net.send('x', d); onFx(d); }
function pushInfo(force) {
  const d = Sim.info(S.match), j = JSON.stringify(d), t = now();
  if (!force && j === S.lastInfoJson && t - S.lastInfoSent < 1) return;
  S.lastInfoJson = j; S.lastInfoSent = t;
  if (S.net) S.net.send('i', d);
  onInfo(d);
}
/* Le minuteur de l'hôte tourne dans un « worker » : le navigateur le ralentit beaucoup moins
   quand l'onglet n'est pas au premier plan (sinon la partie gèlerait pour tout le monde). */
function everyTick(fn) {
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return { stop: () => w.terminate() };
  } catch (e) {
    const id = setInterval(fn, 1000 / 30);
    return { stop: () => clearInterval(id) };
  }
}
function hostStart() {
  let last = now(), lastSend = 0;
  S.hostTimer = everyTick(() => {
    const m = S.match, t = now(), dt = Math.min(0.25, t - last);
    last = t;
    const before = m.phase;
    Sim.tick(m, dt);
    // joueurs partis sans dire au revoir
    for (const p of m.players.slice()) if (!p.bot && p.id !== S.id && m.clock - p.seen > 12) { Sim.removePlayer(m, p.id); toast(`${p.name} s'est déconnecté.`); }
    if (m.phase === 'fight' && m.st) {
      const s = Sim.snapshot(m);
      S.pendingE.push(...s.E);
      onSnap(s);
      if (t - lastSend >= 0.095 && S.net) { lastSend = t; S.net.send('s', Object.assign({}, s, { E: S.pendingE })); S.pendingE = []; }
    }
    for (const e of m.events) broadcastFx(e);
    m.events = [];
    pushInfo(before !== m.phase);
  });
}

/* --- côté joueur */
function onInfo(d) {
  const prevPhase = S.phase, prevRound = S.round;
  S.info = d; S.lastInfoAt = now();
  const mine = me();
  if (S.joining) {
    if (!mine) return;
    S.joining = false; clearInterval(S.joinTimer);
  } else if (!mine && !S.host && S.room) { sendHost('join', { name: S.name, champ: S.champ }); }
  S.phase = d.ph; S.round = d.rd;
  if (d.ph === 'lobby') { if (S.screen !== 'lobby') show('lobby'); renderLobby(); return; }
  if (S.screen !== 'game') show('game');
  if (d.ph === 'fight' && (prevPhase !== 'fight' || prevRound !== d.rd)) newRoundView();
  $('#shop').classList.toggle('hidden', d.ph !== 'shop');
  $('#end').classList.toggle('hidden', d.ph !== 'end');
  if (d.ph === 'shop') { if (prevPhase !== 'shop') openShop(); renderShop(); }
  if (d.ph === 'end') renderEnd();
  renderScores();
}
function onSnap(s) {
  const t = now();
  const last = S.snaps[S.snaps.length - 1];
  if (last && s.T < last.T - 0.5) { S.snaps = []; S.offset = null; S.evq = []; }
  s.PM = {};
  for (const r of s.P) s.PM[r[0]] = r;
  s.at = t;
  if (!S.host && last) { // délai d'affichage qui s'adapte à la régularité de la connexion
    S.gap = S.gap ? S.gap * 0.9 + (t - last.at) * 0.1 : 0.1;
    S.delay = Math.min(0.35, Math.max(0.12, S.gap * 1.6 + 0.03));
  }
  S.snaps.push(s);
  if (S.snaps.length > 40) S.snaps.shift();
  const o = s.T - t;
  S.offset = S.offset == null || o > S.offset ? o : S.offset - 0.001;
  for (const e of s.E || []) S.evq.push(e);
}
function onFx(d) {
  if (d.k === 'full') { if (d.id === S.id) { leave(); $('#homeMsg').textContent = 'Salle pleine (4 joueurs maximum).'; } return; }
  if (d.k === 'closed') { if (!S.host) { leave(); toast('L\'hôte a fermé la salle.', true); } return; }
  if (d.k === 'casino') onCasino(d);
}

/* ------------------------------------------------------------------ accueil / salle */
function readName() {
  const n = $('#nameInput').value.trim().slice(0, 16);
  if (!n) { $('#homeMsg').textContent = 'Choisis d\'abord un pseudo.'; $('#nameInput').focus(); return null; }
  S.name = n; store.set('arene-name', n);
  return n;
}
function createRoom(solo) {
  if (!readName()) return;
  S.host = true; S.solo = !!solo;
  S.match = Sim.newMatch();
  Sim.addPlayer(S.match, { id: S.id, name: S.name, champ: S.champ });
  if (solo) { Sim.addBot(S.match); Sim.addBot(S.match); S.room = 'SOLO'; }
  else { startNet(code4()); history.replaceState(null, '', '#' + S.room); }
  S.delay = 0.045;
  hostStart();
  pushInfo(true);
}
function joinRoom() {
  if (!readName()) return;
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { $('#homeMsg').textContent = 'Le code a 4 lettres.'; return; }
  S.host = false; S.delay = 0.13; S.joining = true;
  $('#homeMsg').textContent = 'Connexion…';
  startNet(code);
  history.replaceState(null, '', '#' + code);
  let tries = 0;
  S.joinTimer = setInterval(() => {
    if (!S.joining) return clearInterval(S.joinTimer);
    if (++tries > 10) { leave(); $('#homeMsg').textContent = 'Salle introuvable. Vérifie le code (l\'hôte doit garder la page ouverte).'; return; }
    sendHost('join', { name: S.name, champ: S.champ });
  }, 1000);
  S.pingTimer = setInterval(() => {
    if (S.joining) return;
    sendHost('ping');
    if (now() - S.lastInfoAt > 10) { leave(); toast('L\'hôte ne répond plus : la partie est terminée.', true); }
  }, 3000);
}
function leave() {
  if (S.host && S.net) S.net.send('x', { k: 'closed' });
  else if (S.net) sendHost('bye');
  if (S.hostTimer) S.hostTimer.stop(); S.hostTimer = null; clearInterval(S.pingTimer); clearInterval(S.joinTimer);
  const net = S.net;
  setTimeout(() => net && net.close(), 300);
  Object.assign(S, { net: null, match: null, info: null, host: false, solo: false, joining: false, room: null, snaps: [], evq: [], phase: '', round: 0, offset: null });
  history.replaceState(null, '', location.pathname + location.search);
  $('#homeMsg').textContent = '';
  show('home');
}

function champCard(k, on) {
  const c = C[k];
  return `<div class="champ ${on ? 'on' : ''}" data-c="${k}">
    <div class="ch-top"><span class="ch-emoji">${c.emoji}</span><div><div class="ch-name">${c.name}</div><div class="ch-role">${c.role} · ${c.hp} PV</div></div></div>
    <div class="ch-desc">${c.desc}</div>
    ${Sim.SLOTS.slice(1).map(s => `<div class="ch-ab"><b>${s.toUpperCase()} ${ICONS[k][s]} ${c[s].name}</b> — ${c[s].desc}</div>`).join('')}
  </div>`;
}
function setChamp(k) {
  S.champ = k; store.set('arene-champ', k);
  sendHost('champ', { c: k });
}
function renderLobby() {
  const d = S.info;
  $('#roomCode').textContent = S.solo ? 'SOLO' : S.room;
  $('#btnCopy').classList.toggle('hidden', S.solo);
  $('#lobbyCount').textContent = `(${d.pl.length}/4)`;
  $('#lobbyPlayers').innerHTML = d.pl.map((p, i) => `<div class="pl-row"><span class="pl-dot" style="background:${p.col}"></span>
    <span class="pl-name">${esc(p.name)}${p.id === S.id ? ' (toi)' : ''}</span>
    <span class="pl-champ">${C[p.champ].emoji} ${C[p.champ].name}${i === 0 && !p.bot ? ' · hôte' : ''}</span></div>`).join('');
  $('#hostCtrls').classList.toggle('hidden', !S.host);
  $('#lobbyWait').classList.toggle('hidden', S.host);
  const mine = me();
  if (mine) S.champ = mine.champ;
  $('#champGrid').innerHTML = Object.keys(C).map(k => champCard(k, k === S.champ)).join('');
  $('#btnStart').disabled = d.pl.length < 2;
  $('#btnStart').textContent = d.pl.length < 2 ? 'Il faut au moins 2 joueurs (ajoute un bot)' : 'Lancer la partie';
}

/* ------------------------------------------------------------------ boutique */
function openShop() {
  S.busy = false; S.boxBusy = false; S.shownCoins = null;
  $('#casinoMsg').textContent = ''; $('#boxMsg').textContent = '';
  $('#caseStrip').innerHTML = ''; $('#caseStrip').style.transition = 'none'; $('#caseStrip').style.transform = 'translateX(0)';
  buildRoulette(0, false);
  const fin = S.info.fin;
  $('#shopTitle').textContent = fin ? 'Dernière chance au casino ! 🎰' : `Manche ${S.info.rd}/${S.info.rds} terminée`;
  $('#boxPanel').querySelectorAll('.box-btn, .row, .case-win, .muted, .shop-items, h3, .mini-champs').forEach(el => el.classList.toggle('hidden', fin));
  if (fin) $('#boxPanel').querySelector('h3').classList.remove('hidden'), $('#boxPanel').querySelector('h3').textContent = 'Le plus riche à la fin gagne. Tout miser ?';
  else $('#boxPanel').querySelector('h3').innerHTML = 'Boîtes surprises <span class="muted">(pour la prochaine manche)</span>';
  const last = S.info.last;
  $('#roundResult').innerHTML = last ? last.rows.map(r => {
    const t = r.tapis ? ` · tapis <span class="${r.tapis > 0 ? 'plus' : 'minus'}">${r.tapis > 0 ? '+' : ''}${r.tapis}</span>` : '';
    return `<div class="rr" style="border-color:${colorOf(r.id)}">${r.win ? '🏆 ' : ''}${esc(nameOf(r.id))}${r.marked ? ' 💰' : ''} : <span class="plus">+${r.earned}</span>${t} · ${r.kills} 💀</div>`;
  }).join('') : '';
  const w = last && last.winner;
  if (w === S.id) SND.win();
}
function renderShop() {
  const d = S.info, mine = me();
  if (!mine) return;
  if (!S.busy && !S.boxBusy) $('#myCoins').textContent = mine.coins;
  $('#shopTimer').textContent = `⏱ ${d.left}s`;
  const bets = Sim.BETS.concat(['all']);
  if (S.bet !== 'all' && S.bet > mine.coins) S.bet = Sim.BETS.filter(b => b <= mine.coins).pop() || 10;
  $('#bets').innerHTML = 'Mise : ' + bets.map(b => `<button class="bet ${b === 'all' ? 'allin' : ''} ${S.bet === b ? 'on' : ''}" data-b="${b}" ${b !== 'all' && b > mine.coins ? 'disabled' : ''}>${b === 'all' ? 'TOUT (' + mine.coins + ')' : b}</button>`).join('');
  $('#shopItems').innerHTML = mine.items.length ? mine.items.map(it => `<span class="item-chip" title="${esc(Sim.ITEMS[it].desc)}">${Sim.ITEMS[it].emoji} ${esc(Sim.ITEMS[it].name)}</span>`).join('') : '<span class="muted">aucun</span>';
  $('#shopChamps').innerHTML = Object.keys(C).map(k => `<button class="btn ghost ${mine.champ === k ? 'on' : ''}" data-c="${k}">${C[k].emoji} ${C[k].name}</button>`).join('');
  $('#readyList').innerHTML = d.pl.filter(p => !p.bot).map(p => `<span style="border-left:4px solid ${p.col}">${p.ready ? '✅' : '⏳'} ${esc(p.name)} · ${p.coins} 🪙</span>`).join('');
  $('#btnReady').textContent = mine.ready ? 'Pas encore prêt' : (d.fin ? 'Voir le classement ✔' : 'Prêt ✔');
  $('#btnReady').classList.toggle('ghost', mine.ready);
  document.querySelectorAll('.box-btn').forEach(b => { b.disabled = S.boxBusy || mine.items.length >= Sim.MAX_ITEMS || mine.coins < Sim.BOXES[b.dataset.b].cost; });
  $('#btnSpin').disabled = S.busy || mine.coins <= 0;
  document.querySelectorAll('.roul-btns .btn').forEach(b => { b.disabled = S.busy || mine.coins <= 0; });
}
function betValue() { return S.bet; }

let reelTimer = null, busyTimer = null;
function spinSlots() {
  if (S.busy) return;
  S.busy = true; renderShop();
  $('#casinoMsg').textContent = ''; $('#casinoMsg').className = 'casino-msg';
  const syms = Sim.REELS.map(r => r[0]);
  for (let i = 0; i < 3; i++) { $('#reel' + i).classList.add('spin'); $('#reel' + i).classList.remove('hit'); }
  reelTimer = setInterval(() => {
    for (let i = 0; i < 3; i++) if ($('#reel' + i).classList.contains('spin')) $('#reel' + i).textContent = syms[Math.floor(Math.random() * syms.length)];
    SND.tick();
  }, 70);
  S.spinStart = now();
  sendHost('slots', { bet: betValue() });
  busyTimer = setTimeout(() => { if (S.busy) { stopBusy(); clearInterval(reelTimer); document.querySelectorAll('.reel').forEach(r => r.classList.remove('spin')); $('#casinoMsg').textContent = 'Pas de réponse de l\'hôte…'; } }, 5000);
}
function stopBusy() { S.busy = false; clearTimeout(busyTimer); renderShop(); }

function onCasino(d) {
  if (d.id !== S.id) {
    let txt = null, big = false;
    if (d.kind === 'slots' && d.win > 0) { txt = `🎰 ${d.name} : ${d.reels.join('')} +${d.win}`; big = d.mult >= 14; }
    else if (d.kind === 'roul' && d.win > 0) { txt = `🎡 ${d.name} gagne ${d.win} au ${d.color}`; big = d.color === 'vert'; }
    else if (d.kind === 'box') { const it = Sim.ITEMS[d.item]; txt = `${Sim.BOXES[d.b].emoji} ${d.name} ouvre : ${it.emoji} ${it.name}`; big = it.rar === 'legende'; }
    if (d.bet && d.win === 0 && d.bet >= 100) txt = `💸 ${d.name} vient de perdre ${d.bet} pièces`;
    if (txt) setTimeout(() => toast(txt, big), d.kind === 'box' ? 3600 : d.kind === 'roul' ? 3200 : 1200);
    return;
  }
  if (d.kind === 'slots') {
    const wait = Math.max(0, 0.7 - (now() - S.spinStart)) * 1000;
    setTimeout(() => {
      [0, 1, 2].forEach(i => setTimeout(() => {
        const el = $('#reel' + i);
        el.classList.remove('spin'); el.textContent = d.reels[i]; SND.tick();
        if (i === 2) {
          clearInterval(reelTimer);
          const msg = $('#casinoMsg');
          if (d.win > 0) {
            d.reels.forEach((s, k) => { if (d.reels.filter(x => x === s).length >= 2) $('#reel' + k).classList.add('hit'); });
            msg.textContent = d.mult >= 40 ? `JACKPOT !!! +${d.win} 🪙` : `Gagné : +${d.win} 🪙 (×${d.mult})`;
            msg.className = 'casino-msg win'; d.mult >= 14 ? SND.win() : SND.coin();
          } else { msg.textContent = d.reels.includes('💀') ? `💀 Perdu (−${d.bet})` : `Perdu (−${d.bet})`; msg.className = 'casino-msg lose'; SND.lose(); }
          stopBusy();
        }
      }, i * 380));
    }, wait);
  } else if (d.kind === 'roul') {
    buildRoulette(d.n, true);
    setTimeout(() => {
      const msg = $('#casinoMsg');
      if (d.win > 0) { msg.textContent = `${d.color === 'vert' ? 'VERT !!! ' : ''}Gagné : +${d.win} 🪙`; msg.className = 'casino-msg win'; d.color === 'vert' ? SND.win() : SND.coin(); }
      else { msg.textContent = `Tombé sur ${d.color} : perdu (−${d.bet})`; msg.className = 'casino-msg lose'; SND.lose(); }
      stopBusy();
    }, 3300);
  } else if (d.kind === 'box') {
    openCase(d);
  }
}

const ROUL_ORDER = [0, 1, 8, 2, 9, 3, 10, 4, 11, 5, 12, 6, 13, 7, 14];
function buildRoulette(n, spin) {
  const strip = $('#roulStrip'), reps = 9, tw = 64;
  if (!strip.children.length) {
    let h = '';
    for (let r = 0; r < reps; r++) for (const k of ROUL_ORDER) h += `<div class="rt ${k === 0 ? 'vert' : k % 2 ? 'rouge' : 'noir'}">${k}</div>`;
    strip.innerHTML = h;
  }
  const box = $('#roulStrip').parentElement.clientWidth || 400;
  const at = (rep, k) => -(rep * ROUL_ORDER.length + ROUL_ORDER.indexOf(k)) * tw - 30 + box / 2;
  strip.style.transition = 'none';
  strip.style.transform = `translateX(${at(1, 0)}px)`;
  if (!spin) return;
  void strip.offsetWidth;
  strip.style.transition = 'transform 3s cubic-bezier(.12,.8,.22,1)';
  strip.style.transform = `translateX(${at(7, n) + (Math.random() * 40 - 20)}px)`;
}
function spinRoulette(c) {
  if (S.busy) return;
  S.busy = true; renderShop();
  $('#casinoMsg').textContent = ''; $('#casinoMsg').className = 'casino-msg';
  sendHost('roul', { c, bet: betValue() });
  busyTimer = setTimeout(() => { if (S.busy) { stopBusy(); $('#casinoMsg').textContent = 'Pas de réponse de l\'hôte…'; } }, 6000);
}
function buyBox(b) {
  if (S.boxBusy) return;
  S.boxBusy = true; renderShop();
  $('#boxMsg').textContent = ''; $('#boxMsg').className = 'casino-msg';
  sendHost('box', { b });
  S.boxTimer = setTimeout(() => { if (S.boxBusy) { S.boxBusy = false; renderShop(); $('#boxMsg').textContent = 'Pas de réponse de l\'hôte…'; } }, 6000);
}
function openCase(d) {
  const odds = Sim.BOXES[d.b].odds, keys = Object.keys(Sim.ITEMS), strip = $('#caseStrip'), N = 40, WIN = 34, tw = 96;
  const rand = () => { let t = 0; for (const k in odds) t += odds[k]; let r = Math.random() * t, rar = 'commun'; for (const k in odds) { r -= odds[k]; if (r < 0) { rar = k; break; } } const pool = keys.filter(k => Sim.ITEMS[k].rar === rar); return pool[Math.floor(Math.random() * pool.length)]; };
  let h = '';
  for (let i = 0; i < N; i++) { const k = i === WIN ? d.item : rand(), it = Sim.ITEMS[k]; h += `<div class="ct ${it.rar}">${it.emoji}<small>${esc(it.name)}</small></div>`; }
  strip.innerHTML = h;
  const box = strip.parentElement.clientWidth || 400;
  strip.style.transition = 'none'; strip.style.transform = `translateX(${box / 2 - 46}px)`;
  void strip.offsetWidth;
  strip.style.transition = 'transform 3.4s cubic-bezier(.1,.75,.2,1)';
  strip.style.transform = `translateX(${box / 2 - WIN * tw - 46 + (Math.random() * 60 - 30)}px)`;
  let ticks = 0; const tk = setInterval(() => { SND.tick(); if (++ticks > 22) clearInterval(tk); }, 140);
  setTimeout(() => {
    const it = Sim.ITEMS[d.item], msg = $('#boxMsg');
    msg.textContent = `${it.emoji} ${it.name} (${RAR[it.rar]}) : ${it.desc}`;
    msg.className = 'casino-msg ' + (it.rar === 'malus' ? 'lose' : 'win');
    it.rar === 'legende' ? SND.win() : it.rar === 'malus' ? SND.lose() : SND.coin();
    S.boxBusy = false; clearTimeout(S.boxTimer); renderShop();
  }, 3500);
}

/* ------------------------------------------------------------------ fin */
function renderEnd() {
  const pl = S.info.pl.slice().sort((a, b) => b.coins - a.coins);
  const medals = ['🥇', '🥈', '🥉'], heights = [150, 115, 90];
  const order = pl.length >= 3 ? [1, 0, 2] : pl.length === 2 ? [1, 0] : [0];
  $('#podium').innerHTML = order.map(i => pl[i] ? `<div class="pod" style="height:${heights[i]}px;border-top:4px solid ${pl[i].col}"><span class="medal">${medals[i]}</span><b>${esc(pl[i].name)}</b><span>${pl[i].coins} 🪙</span></div>` : '').join('');
  $('#endTable').innerHTML = `<table><tr><th></th><th>Pièces</th><th>Manches</th><th>Kills</th><th>Casino</th></tr>${pl.map((p, i) => `<tr><td style="text-align:left"><span class="pl-dot" style="display:inline-block;background:${p.col}"></span> ${i + 1}. ${esc(p.name)}</td><td>${p.coins}</td><td>${p.wins}</td><td>${p.kills}</td><td style="color:${p.casino >= 0 ? 'var(--green)' : 'var(--red)'}">${p.casino >= 0 ? '+' : ''}${p.casino}</td></tr>`).join('')}</table>`;
  $('#btnAgain').classList.toggle('hidden', !S.host);
  $('#endWait').textContent = S.host ? '' : 'L\'hôte peut lancer une revanche.';
  if (!S.endSound && pl[0] && pl[0].id === S.id) SND.win();
  S.endSound = true;
}

/* ------------------------------------------------------------------ manche : HUD */
function newRoundView() {
  S.snaps = []; S.offset = null; S.evq = []; S.fx = []; S.endSound = false;
  $('#killfeed').innerHTML = ''; $('#announce').innerHTML = '';
  S.keys = 0;
  buildAbilities();
}
function buildAbilities() {
  const mine = me();
  const k = mine ? mine.champ : S.champ;
  S.abChamp = k;
  $('#abilities').innerHTML = Sim.SLOTS.map(s => `<div class="ab ${s === 'r' ? 'ult' : ''}" id="ab-${s}">${ICONS[k][s]}<div class="cdov"></div><div class="cdtx"></div><span class="key">${KEYS[s]}</span>
    <div class="tip"><b>${KEYS[s]} · ${C[k][s].name}</b><br>${C[k][s].desc}<br><span class="muted">Recharge : ${C[k][s].cd} s</span></div></div>`).join('');
  $('#myItems').innerHTML = mine ? mine.items.map(it => `<span class="item-chip" title="${esc(Sim.ITEMS[it].desc)}">${Sim.ITEMS[it].emoji} ${esc(Sim.ITEMS[it].name)}</span>`).join('') : '';
}
function renderScores() {
  if (!S.info) return;
  const s = S.snaps[S.snaps.length - 1];
  $('#roundInfo').textContent = `Manche ${S.info.rd}/${S.info.rds}`;
  $('#scores').innerHTML = S.info.pl.map(p => {
    const r = s && s.PM[p.id], dead = r && r[6] & 1;
    return `<div class="score ${dead ? 'dead' : ''}" style="border-color:${p.col}">${C[p.champ].emoji} ${esc(p.name)} <b>${p.coins}</b>🪙${r && r[6] & 16 ? ' 💰' : ''}${r && r[6] & 32 ? ' 🎲' : ''}</div>`;
  }).join('');
}
function announce(text, big) {
  const d = document.createElement('div');
  d.className = 'ann' + (big ? '' : ' small');
  d.textContent = text;
  $('#announce').appendChild(d);
  setTimeout(() => d.remove(), big ? 5000 : 3500);
  while ($('#announce').children.length > 3) $('#announce').firstChild.remove();
}
function killfeed(a, v) {
  const d = document.createElement('div');
  d.className = 'kf';
  d.innerHTML = a ? `<span style="color:${colorOf(a)}">${esc(nameOf(a))}</span> 💀 <span style="color:${colorOf(v)}">${esc(nameOf(v))}</span>` : `💀 <span style="color:${colorOf(v)}">${esc(nameOf(v))}</span>`;
  $('#killfeed').appendChild(d);
  setTimeout(() => d.remove(), 6000);
}

let hudT = 0;
function updateHud(t, mine, last) {
  const row = last && last.PM[S.id];
  const ago = last ? t - last.at : 0;
  if (row) {
    const [, , , hp, maxhp, , fl, shield] = row;
    $('#hpfill').style.width = (hp / maxhp * 100) + '%';
    $('#hpshield').style.width = Math.min(100, shield / maxhp * 100) + '%';
    $('#hptext').textContent = `${hp} / ${maxhp}${shield ? ' (+' + shield + ')' : ''}`;
    Sim.SLOTS.forEach((s, i) => {
      const el = $('#ab-' + s);
      if (!el) return;
      const cd = Math.max(0, row[10 + i] - ago), base = C[S.abChamp][s].cd;
      el.querySelector('.cdov').style.height = Math.min(100, cd / base * 100) + '%';
      el.querySelector('.cdov').style.top = 'auto'; el.querySelector('.cdov').style.bottom = '0';
      el.querySelector('.cdtx').textContent = cd > 0.05 && s !== 'a' ? (cd >= 1 ? Math.ceil(cd) : cd.toFixed(1)) : '';
      el.style.borderColor = S.flash[s] && t - S.flash[s] < 0.25 ? '#ef4444' : '';
    });
    const T = last.T;
    const center = $('#center');
    if (T < 0) center.innerHTML = `${Math.ceil(-T)}<small>${C[S.abChamp].emoji} ${C[S.abChamp].name} — clic droit pour bouger</small>`;
    else if (T < 0.8) center.innerHTML = 'GO !';
    else if (fl & 1 && !last.O) center.innerHTML = '💀<small>Tu es mort — attends la fin de la manche</small>';
    else center.innerHTML = '';
    if (T >= 0 && T < 0.1 && !S.goPlayed) { S.goPlayed = true; SND.go(); }
    if (T < 0) S.goPlayed = false;
    const tapisLeft = Sim.TAPIS_WINDOW - T;
    if (fl & 32) $('#tapisHint').textContent = `🎲 TAPIS en cours : gagne la manche !`;
    else if (!(fl & 1) && T >= 0 && tapisLeft > 0 && mine && mine.coins > 0) $('#tapisHint').textContent = `T : TAPIS — mise tes ${mine.coins} 🪙 sur ta victoire (gain ×${Math.max(1, last.P.length - 1)}) · ${Math.ceil(tapisLeft)} s`;
    else $('#tapisHint').textContent = '';
    $('#timer').textContent = T < 0 ? '0:00' : fmtTime(Math.max(0, Sim.ROUND_MAX - T));
  } else if (last) {
    $('#center').innerHTML = '<small>Tu joueras à la prochaine manche</small>';
  }
  if (t - hudT > 0.25) { hudT = t; renderScores(); }
}
function fmtTime(s) { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* ------------------------------------------------------------------ dessin */
const cv = $('#cv'), ctx = cv.getContext('2d');
const V = { s: 1, ox: 0, oy: 0, dpr: 1 };
function resize() {
  V.dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * V.dpr; cv.height = innerHeight * V.dpr;
  const top = 50, bot = 112;
  const aw = innerWidth - 16, ah = innerHeight - top - bot;
  const s = Math.max(0.3, Math.min(aw / W, ah / H));
  V.s = s * V.dpr; V.ox = (innerWidth - W * s) / 2 * V.dpr; V.oy = (top + (ah - H * s) / 2) * V.dpr;
}
addEventListener('resize', resize);
resize();

const BG = document.createElement('canvas'), BUSH = document.createElement('canvas');
function prerender() {
  BG.width = W; BG.height = H; BUSH.width = W; BUSH.height = H;
  const g = BG.getContext('2d');
  const grd = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 900);
  grd.addColorStop(0, '#24452c'); grd.addColorStop(1, '#122219');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  let seed = 7; const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.04})`; g.fillRect(r() * W, r() * H, 2 + r() * 4, 2 + r() * 4); }
  g.strokeStyle = 'rgba(255,255,255,.04)'; g.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 80) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,213,74,.12)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, 160, 0, Math.PI * 2); g.stroke();
  for (const k of Sim.ROCKS) {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(k.x + 8, k.y + 12, k.r, k.r * 0.85, 0, 0, Math.PI * 2); g.fill();
    const rg = g.createRadialGradient(k.x - k.r * 0.35, k.y - k.r * 0.35, 4, k.x, k.y, k.r);
    rg.addColorStop(0, '#8b97a6'); rg.addColorStop(1, '#3f4854');
    g.fillStyle = rg; g.beginPath(); g.arc(k.x, k.y, k.r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a3038'; g.lineWidth = 3; g.stroke();
  }
  g.strokeStyle = '#0a1310'; g.lineWidth = 10; g.strokeRect(0, 0, W, H);
  const b = BUSH.getContext('2d');
  for (const k of Sim.BUSHES) {
    let s2 = k.x * 13 + k.y; const rr = () => (s2 = (s2 * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 26; i++) {
      const a = rr() * Math.PI * 2, d = rr() * k.r * 0.75, rad = k.r * (0.25 + rr() * 0.2);
      b.fillStyle = `hsl(${120 + rr() * 25}, ${45 + rr() * 15}%, ${20 + rr() * 12}%)`;
      b.beginPath(); b.arc(k.x + Math.cos(a) * d, k.y + Math.sin(a) * d, rad, 0, Math.PI * 2); b.fill();
    }
  }
}
prerender();

const LOOK = {
  ember: '#ffb347', fire: '#ff5a1f', arrow: '#e9e3c9', hook: '#9ca3af', crystal: '#67e8f9', dagger: '#84cc16',
  meteor: '#ff5a1f', quake: '#c08a4a', bomb: '#ef4444', inferno: '#ff7a1a',
};
function lerp(a, b, f) { return a + (b - a) * f; }
function lerpAng(a, b, f) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; }
function pair(rt) {
  const sn = S.snaps;
  let a = sn[0], b = sn[0];
  for (let i = sn.length - 1; i >= 0; i--) if (sn[i].T <= rt) { a = sn[i]; b = sn[i + 1] || sn[i]; break; }
  const f = b.T > a.T ? Math.min(1, Math.max(0, (rt - a.T) / (b.T - a.T))) : 0;
  return { a, b, f };
}
function interpRow(p, id) {
  const rb = p.b.PM[id], ra = p.a.PM[id] || rb;
  if (!rb) return null;
  const jump = Math.hypot(rb[1] - ra[1], rb[2] - ra[2]) > 120;
  const f = jump ? 1 : p.f;
  return { row: rb, x: lerp(ra[1], rb[1], f), y: lerp(ra[2], rb[2], f), face: lerpAng(ra[5], rb[5], f) };
}

function addFx(o) { S.fx.push(Object.assign({ life: 0 }, o)); if (S.fx.length > 400) S.fx.shift(); }
function burst(x, y, col, n, sp) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * (sp || 160); addFx({ k: 'p', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: 0.35 + Math.random() * 0.3, col, size: 2 + Math.random() * 3 }); }
}
function runEvent(e, P) {
  const mineId = S.id;
  switch (e.k) {
    case 'hit':
      addFx({ k: 'txt', x: e.x + (Math.random() * 20 - 10), y: e.y - 30, vy: -60, max: 0.9, s: '-' + e.d, col: e.id === mineId ? '#f87171' : e.o ? '#fdba74' : '#fff', size: e.o ? 15 : 13 + Math.min(14, e.d / 10) });
      if (!e.o) { burst(e.x, e.y, '#fff3c4', 6, 140); e.id === mineId ? (SND.hurt(), S.shake = Math.max(S.shake, 6)) : SND.hit(); }
      break;
    case 'kill': {
      killfeed(e.a, e.v);
      burst(e.x, e.y, colorOf(e.v), 30, 260);
      addFx({ k: 'ring', x: e.x, y: e.y, r0: 10, r1: 90, max: 0.5, col: colorOf(e.v) });
      SND.kill();
      if (e.a === mineId) announce('Élimination ! +' + Sim.PAY.kill + ' 🪙');
      break;
    }
    case 'say': announce(e.s, e.b); if (e.b) SND.coin(); break;
    case 'swing': {
      const r = P[e.id];
      if (r) addFx({ k: 'arc', id: e.id, x: r.x, y: r.y, a: e.a, r: e.r, max: 0.18, col: colorOf(e.id) });
      break;
    }
    case 'blink':
      burst(e.fx, e.fy, '#c4b5fd', 14, 120); burst(e.x, e.y, '#c4b5fd', 14, 120);
      break;
    case 'pop': burst(e.x, e.y, LOOK[e.l] || '#fff', 8, 120); break;
    case 'boom': {
      const col = LOOK[e.l] || '#fff';
      addFx({ k: 'ring', x: e.x, y: e.y, r0: e.r * 0.3, r1: e.r, max: 0.45, col, fill: true });
      burst(e.x, e.y, col, 26, e.r * 2);
      const r = P[mineId];
      if (r && Math.hypot(r.x - e.x, r.y - e.y) < e.r + 200) S.shake = Math.max(S.shake, 10);
      SND.boom();
      break;
    }
    case 'cast': if (e.id === mineId) SND.cast(); break;
    case 'block': addFx({ k: 'txt', x: e.x, y: e.y - 30, vy: -50, max: 0.8, s: 'bloqué', col: '#e5e7eb', size: 13 }); break;
  }
}

function drawPlayer(p, isMe, t) {
  const [id, , , hp, maxhp, , fl, shield, r] = p.row;
  const pl = player(id), col = pl ? pl.col : '#999', ch = C[pl ? pl.champ : 'braise'];
  const x = p.x, y = p.y;
  ctx.save();
  if (fl & 2) ctx.globalAlpha = 0.4;
  if (fl & 16) { // quitte ou double
    const k = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.fillStyle = `rgba(255,213,74,${0.18 + k * 0.15})`; ctx.beginPath(); ctx.arc(x, y, r + 16 + k * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 3, y + r * 0.7, r * 0.95, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  if (fl & 64) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { const a = p.face + Math.PI + i * 0.35; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4)); ctx.lineTo(x + Math.cos(a) * (r + 18), y + Math.sin(a) * (r + 18)); ctx.stroke(); } }
  // corps
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
  g.addColorStop(0, '#3a4656'); g.addColorStop(1, '#151b24');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = isMe ? 5 : 4; ctx.strokeStyle = col; ctx.stroke();
  if (fl & 8) { ctx.strokeStyle = 'rgba(96,165,250,.8)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  if (fl & 512) { ctx.fillStyle = 'rgba(132,204,22,.25)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  // direction
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(p.face) * (r + 9), y + Math.sin(p.face) * (r + 9));
  ctx.lineTo(x + Math.cos(p.face + 0.35) * (r + 1), y + Math.sin(p.face + 0.35) * (r + 1));
  ctx.lineTo(x + Math.cos(p.face - 0.35) * (r + 1), y + Math.sin(p.face - 0.35) * (r + 1));
  ctx.fill();
  ctx.font = `${Math.round(r * 1.05)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch.emoji, x, y + 1);
  if (shield > 0) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.stroke(); }
  // barre de vie
  const bw = 70, bx = x - bw / 2, by = y - r - 22;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 9);
  ctx.fillStyle = isMe ? '#22c55e' : '#ef4444'; ctx.fillRect(bx, by, bw * Math.max(0, hp) / maxhp, 7);
  if (shield > 0) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(bx, by, Math.min(bw, bw * shield / maxhp), 3); }
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
  for (let k = 100; k < maxhp; k += 100) { const lx = bx + bw * k / maxhp; ctx.beginPath(); ctx.moveTo(lx, by); ctx.lineTo(lx, by + 7); ctx.stroke(); }
  ctx.font = '700 12px Sora, system-ui'; ctx.fillStyle = col; ctx.textBaseline = 'bottom';
  const icons = (fl & 16 ? '💰' : '') + (fl & 32 ? '🎲' : '');
  ctx.fillText((pl ? pl.name : '') + (icons ? ' ' + icons : ''), x, by - 2);
  if (fl & 4) { ctx.font = '16px system-ui'; for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; ctx.fillText('💫', x + Math.cos(a) * 14, y - r - 30 + Math.sin(a) * 4); } }
  ctx.restore();
}

function drawProj(j, x, y, P) {
  const [, look, , , vx, vy, r] = j, a = Math.atan2(vy, vx), col = LOOK[look] || '#fff';
  ctx.save();
  if (look === 'arrow') {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 22, y - Math.sin(a) * 22); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); ctx.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6); ctx.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6); ctx.fill();
  } else if (look === 'hook') {
    const o = P[j[8]];
    if (o) { ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🪝', x, y);
  } else if (look === 'crystal') {
    ctx.shadowColor = col; ctx.shadowBlur = 25; ctx.fillStyle = col;
    ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(r * 1.8, 0); ctx.lineTo(0, r * 0.6); ctx.lineTo(-r * 2.5, 0); ctx.lineTo(0, -r * 0.6); ctx.fill();
  } else {
    ctx.shadowColor = col; ctx.shadowBlur = look === 'fire' ? 22 : 12;
    const tail = look === 'fire' ? 30 : 14;
    const lg = ctx.createLinearGradient(x - Math.cos(a) * tail, y - Math.sin(a) * tail, x, y);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, col);
    ctx.strokeStyle = lg; ctx.lineWidth = r * 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = look === 'fire' ? '#ffd27a' : col; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawZone(z, P, t) {
  const [, look, zx, zy, r, delay, follow] = z;
  let x = zx, y = zy;
  if (follow && P[follow]) { x = P[follow].x; y = P[follow].y; }
  const col = LOOK[look] || '#fff';
  ctx.save();
  if (delay > 0) {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.3; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * (1 - delay), 0, Math.PI * 2); ctx.fill();
    if (look === 'meteor') { ctx.globalAlpha = 1; ctx.font = `${30 + (1 - delay) * 20}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☄️', x - delay * 120, y - delay * 200); }
  } else if (look === 'inferno') {
    ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 12); ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.stroke();
    if (Math.random() < 0.6) { const a = Math.random() * Math.PI * 2; addFx({ k: 'p', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: -60, max: 0.5, col: '#ffb347', size: 3 + Math.random() * 3 }); }
  }
  ctx.restore();
}

function draw(t) {
  if (!S.snaps.length) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const base = t + S.offset;
  const pw = pair(base - S.delay), ps = pair(base - Math.min(S.delay, 0.035));
  const last = S.snaps[S.snaps.length - 1];
  // positions de tout le monde
  const P = {};
  for (const r of pw.b.P) { const ip = interpRow(r[0] === S.id ? ps : pw, r[0]); if (ip) P[r[0]] = ip; }
  // événements arrivés à l'heure
  const rt = base - S.delay;
  S.evq = S.evq.filter(e => { if (e.t <= rt) { runEvent(e, P); return false; } return true; });
  const mine = P[S.id], myBush = mine ? mine.row[9] : -1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, cv.width, cv.height);
  let sx = 0, sy = 0;
  if (S.shake > 0) { sx = (Math.random() - 0.5) * S.shake; sy = (Math.random() - 0.5) * S.shake; S.shake *= 0.86; if (S.shake < 0.3) S.shake = 0; }
  ctx.setTransform(V.s, 0, 0, V.s, V.ox + sx * V.dpr, V.oy + sy * V.dpr);
  ctx.drawImage(BG, 0, 0);

  for (const z of pw.b.Z) drawZone(z, P, t);
  // quitte ou double
  if (pw.b.K) {
    const [kx, ky] = pw.b.K, k = Math.sin(t * 4);
    ctx.save();
    ctx.fillStyle = 'rgba(255,213,74,.15)'; ctx.beginPath(); ctx.arc(kx, ky, Sim.TOTEM.reach, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,213,74,.6)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = t * 30; ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowColor = '#ffd54a'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffd54a'; ctx.beginPath(); ctx.ellipse(kx, ky - 6 + k * 4, 22 * Math.abs(Math.cos(t * 2)) + 4, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.font = '800 12px Sora'; ctx.fillStyle = '#ffd54a'; ctx.textAlign = 'center'; ctx.fillText('QUITTE OU DOUBLE', kx, ky + 42);
    for (const id in P) {
      const c = P[id].row[15];
      if (c > 0) { ctx.strokeStyle = colorOf(id); ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(kx, ky, Sim.TOTEM.reach + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, c / Sim.TOTEM.claim)); ctx.stroke(); }
    }
    ctx.restore();
  }
  // joueurs
  for (const id in P) {
    const p = P[id], fl = p.row[6], isMe = id === S.id;
    if (fl & 1) { ctx.globalAlpha = 0.5; ctx.font = '26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🪦', p.x, p.y); ctx.globalAlpha = 1; continue; }
    if (!isMe && !(fl & 16)) {
      if (fl & 2) continue;
      if (p.row[9] >= 0 && !(fl & 128) && p.row[9] !== myBush) continue;
    }
    drawPlayer(p, isMe, t);
  }
  // projectiles (à la même heure que les joueurs)
  for (const j of pw.b.J) {
    const dt = Math.max(rt - pw.b.T, -j[7]);
    drawProj(j, j[2] + j[4] * dt, j[3] + j[5] * dt, P);
  }
  ctx.globalAlpha = 0.82; ctx.drawImage(BUSH, 0, 0); ctx.globalAlpha = 1;
  if (mine && myBush >= 0 && !(mine.row[6] & 1)) { ctx.globalAlpha = 0.6; drawPlayer(mine, true, t); ctx.globalAlpha = 1; }
  // cercle qui rétrécit
  const R = lerp(pw.a.R, pw.b.R, pw.f);
  ctx.save();
  ctx.beginPath(); ctx.rect(-50, -50, W + 100, H + 100); ctx.arc(Sim.CX, Sim.CY, R, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(76,29,149,.42)'; ctx.fill();
  ctx.beginPath(); ctx.arc(Sim.CX, Sim.CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 4; ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 18; ctx.stroke();
  ctx.restore();
  // effets
  const dtf = Math.min(0.05, t - (S.lastFrame || t)); S.lastFrame = t;
  S.fx = S.fx.filter(f => (f.life += dtf) < f.max);
  for (const f of S.fx) {
    const k = f.life / f.max;
    ctx.globalAlpha = 1 - k;
    if (f.k === 'p') { f.x += f.vx * dtf; f.y += f.vy * dtf; f.vx *= 0.92; f.vy *= 0.92; ctx.fillStyle = f.col; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); }
    else if (f.k === 'txt') { f.y += f.vy * dtf; ctx.font = `800 ${f.size}px Sora, system-ui`; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(f.s, f.x, f.y); ctx.fillStyle = f.col; ctx.fillText(f.s, f.x, f.y); }
    else if (f.k === 'ring') { const rr = lerp(f.r0, f.r1, k); ctx.strokeStyle = f.col; ctx.lineWidth = 6 * (1 - k) + 1; ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, Math.PI * 2); ctx.stroke(); if (f.fill) { ctx.globalAlpha = (1 - k) * 0.3; ctx.fillStyle = f.col; ctx.fill(); } }
    else if (f.k === 'arc') { const o = P[f.id] || f; ctx.strokeStyle = f.col; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(o.x, o.y, f.r * (0.7 + 0.3 * k), f.a - 1, f.a + 1); ctx.stroke(); }
    else if (f.k === 'click') { ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, 14 * (1 - k) + 3, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  updateHud(t, me(), last);
}

function frame() {
  requestAnimationFrame(frame);
  if (S.screen !== 'game') return;
  const t = now();
  try { draw(t); } catch (e) { console.error(e); }
  if (S.ldown && S.phase === 'fight') tryCast('a');
}
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ commandes */
function toWorld(e) {
  const r = cv.getBoundingClientRect();
  S.mouse.x = ((e.clientX - r.left) * V.dpr - V.ox) / V.s;
  S.mouse.y = ((e.clientY - r.top) * V.dpr - V.oy) / V.s;
}
function myCd(slot) {
  const last = S.snaps[S.snaps.length - 1], row = last && last.PM[S.id];
  if (!row) return 99;
  return row[10 + Sim.SLOTS.indexOf(slot)] - (now() - last.at);
}
function tryCast(slot) {
  if (S.phase !== 'fight') return;
  const t = now();
  if (slot === 'a') { if (t - S.lastAtk < 0.12) return; S.lastAtk = t; }
  if (myCd(slot) > 0.06) { if (slot !== 'a') S.flash[slot] = t; return; }
  sendHost('c', { s: slot, x: Math.round(S.mouse.x), y: Math.round(S.mouse.y) });
}
function sendMove() {
  S.lastMv = now();
  sendHost('mv', { x: Math.round(S.mouse.x), y: Math.round(S.mouse.y) });
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  toWorld(e);
  if (e.button === 2) { S.rdown = true; sendMove(); addFx({ k: 'click', x: S.mouse.x, y: S.mouse.y, max: 0.35 }); }
  else if (e.button === 0) { S.ldown = true; S.lastAtk = 0; tryCast('a'); }
});
addEventListener('mousemove', e => {
  if (S.screen !== 'game') return;
  toWorld(e);
  if (S.rdown && now() - S.lastMv > 0.09) sendMove();
});
addEventListener('mouseup', e => { if (e.button === 2) S.rdown = false; if (e.button === 0) S.ldown = false; });
addEventListener('blur', () => { S.rdown = S.ldown = false; if (S.keys) { S.keys = 0; sendHost('k', { b: 0 }); } });

const ARROWS = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8 };
const CAST = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r' };
addEventListener('keydown', e => {
  if (S.screen !== 'game' || S.phase !== 'fight' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (ARROWS[e.code]) { e.preventDefault(); const k = S.keys | ARROWS[e.code]; if (k !== S.keys) { S.keys = k; sendHost('k', { b: k }); } return; }
  if (e.repeat && e.code !== 'Space') return;
  if (CAST[e.code]) { e.preventDefault(); tryCast(CAST[e.code]); }
  else if (e.code === 'Space') { e.preventDefault(); tryCast('a'); }
  else if (e.code === 'KeyT') sendHost('tapis');
  else if (e.code === 'KeyS') sendHost('mv', { x: -1, y: -1 });
});
addEventListener('keyup', e => {
  if (ARROWS[e.code]) { const k = S.keys & ~ARROWS[e.code]; if (k !== S.keys) { S.keys = k; sendHost('k', { b: k }); } }
});

/* ------------------------------------------------------------------ boutons */
$('#nameInput').value = S.name;
function codeFromLink() {
  const c = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z]{4}$/.test(c) && !S.room) $('#codeInput').value = c;
}
codeFromLink();
addEventListener('hashchange', codeFromLink);
$('#btnCreate').onclick = () => createRoom(false);
$('#btnSolo').onclick = () => createRoom(true);
$('#btnJoin').onclick = joinRoom;
$('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('#btnLeave').onclick = leave;
$('#btnHome').onclick = leave;
$('#btnCopy').onclick = () => {
  const url = location.protocol === 'file:' ? null : location.origin + location.pathname + '#' + S.room;
  const text = url || ('Code de la salle : ' + S.room);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(url ? 'Lien copié : envoie-le à tes amis !' : 'Code copié.'), () => toast(text));
};
$('#champGrid').addEventListener('click', e => { const c = e.target.closest('.champ'); if (c) setChamp(c.dataset.c); });
$('#shopChamps').addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) setChamp(c.dataset.c); });
$('#btnBotAdd').onclick = () => { if (S.match) { Sim.addBot(S.match); pushInfo(true); } };
$('#btnBotDel').onclick = () => { if (!S.match) return; const b = S.match.players.filter(p => p.bot).pop(); if (b) { Sim.removePlayer(S.match, b.id); pushInfo(true); } };
$('#btnStart').onclick = () => {
  const m = S.match;
  if (!m) return;
  m.rounds = +$('#roundsSel').value || 5;
  if (Sim.startGame(m)) pushInfo(true);
};
$('#btnAgain').onclick = () => { if (S.match) { S.match.phase = 'lobby'; S.match.st = null; pushInfo(true); } };
$('#btnReady').onclick = () => { const m = me(); if (m) sendHost('ready', { v: !m.ready }); };
$('#btnSpin').onclick = spinSlots;
document.querySelectorAll('.roul-btns .btn').forEach(b => { b.onclick = () => spinRoulette(b.dataset.c); });
document.querySelectorAll('.box-btn').forEach(b => { b.onclick = () => buyBox(b.dataset.b); });
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    S.tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
    $('#tab-slots').classList.toggle('hidden', S.tab !== 'slots');
    $('#tab-roul').classList.toggle('hidden', S.tab !== 'roul');
    if (S.tab === 'roul' && !S.busy) buildRoulette(0, false);
  };
});
$('#bets').addEventListener('click', e => {
  const b = e.target.closest('.bet');
  if (!b || b.disabled) return;
  S.bet = b.dataset.b === 'all' ? 'all' : +b.dataset.b;
  renderShop();
});
addEventListener('beforeunload', () => { if (S.room) leave(); });

window.__arene = S; // pour les tests
})();
