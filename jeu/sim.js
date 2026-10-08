/* Arène — les règles du jeu. Seul l'ordinateur de l'hôte fait tourner la partie ;
   les autres reçoivent des « photos » de l'arène et envoient leurs clics.
   Aucune dépendance : marche dans le navigateur et dans node (tests). */
(function (root) {
'use strict';

const W = 1600, H = 1000, CX = W / 2, CY = H / 2, DT = 1 / 30;
const ROCKS = [{ x: 560, y: 330, r: 58 }, { x: 1040, y: 670, r: 58 }, { x: 1040, y: 330, r: 42 }, { x: 560, y: 670, r: 42 }];
const BUSHES = [{ x: 800, y: 225, r: 82 }, { x: 800, y: 775, r: 82 }, { x: 165, y: 500, r: 72 }, { x: 1435, y: 500, r: 72 }];
const SPAWNS = [{ x: 220, y: 180 }, { x: 1380, y: 820 }, { x: 1380, y: 180 }, { x: 220, y: 820 }];
const RING = { start: 960, end: 120, t0: 12, t1: 70, dps: 45, dps2: 110 };
const ROUND_MAX = 95, COUNTDOWN = 3, END_DELAY = 1.6;
const START_COINS = 100, PAY = { round: 20, kill: 30, win: 60 };
const TOTEM = { at: 22, claim: 1.5, reach: 50 };
const TAPIS_WINDOW = 15, CONSOLATION = 25, MAX_FIGHTERS = 4, MAX_ITEMS = 3, SHOP_TIME = 40;
const COLORS = ['#f5a524', '#3b82f6', '#ec4899', '#22c55e'];

const CHAMPS = {
  braise: {
    name: 'Braise', emoji: '🔥', role: 'Mage', hp: 520, speed: 290, range: 540,
    desc: 'Gros dégâts de loin, mais fragile.',
    a: { name: 'Étincelle', cd: 0.7, desc: 'Tir de base : 32.' },
    q: { name: 'Boule de feu', cd: 4, desc: 'Projectile : 75 dégâts.' },
    w: { name: 'Météore', cd: 9, desc: 'Tombe où tu vises après 0,8 s : 100 dégâts.' },
    e: { name: 'Saut', cd: 10, desc: 'Téléportation courte vers la souris.' },
    r: { name: 'Inferno', cd: 45, desc: 'Cercle de feu autour de toi 3 s : 45/s et ralentit.' },
  },
  rempart: {
    name: 'Rempart', emoji: '🛡️', role: 'Tank', hp: 820, speed: 275, range: 95,
    desc: 'Très solide : attrape et étourdit.',
    a: { name: 'Coup de bouclier', cd: 0.9, desc: 'Corps à corps : 42.' },
    q: { name: 'Grappin', cd: 9, desc: 'Attrape le premier ennemi touché et le tire vers toi (50).' },
    w: { name: 'Bouclier', cd: 12, desc: 'Absorbe 150 dégâts pendant 3 s.' },
    e: { name: 'Charge', cd: 10, desc: 'Fonce : le premier touché prend 40 et est étourdi 0,8 s.' },
    r: { name: 'Séisme', cd: 45, desc: 'Frappe le sol : 120 dégâts et étourdit 1,2 s autour de toi.' },
  },
  fleche: {
    name: 'Flèche', emoji: '🏹', role: 'Tireuse', hp: 460, speed: 300, range: 640,
    desc: 'Tire vite et de très loin.',
    a: { name: 'Flèche', cd: 0.65, desc: 'Tir de base : 45.' },
    q: { name: 'Salve', cd: 6, desc: '5 flèches en éventail (34 chacune).' },
    w: { name: 'Élan', cd: 12, desc: 'Plus rapide et tire 2× plus vite pendant 3 s.' },
    e: { name: 'Roulade', cd: 7, desc: 'Petit bond vers la souris.' },
    r: { name: 'Flèche de cristal', cd: 45, desc: 'Traverse l\'arène et les rochers : 180 + étourdit 1 s.' },
  },
  ombre: {
    name: 'Ombre', emoji: '🗡️', role: 'Assassin', hp: 570, speed: 315, range: 90,
    desc: 'Disparaît, surgit, achève.',
    a: { name: 'Lame', cd: 0.8, desc: 'Corps à corps : 52.' },
    q: { name: 'Lame filante', cd: 6, desc: 'Fonce et blesse tout ce qu\'elle traverse (70).' },
    w: { name: 'Voile', cd: 14, desc: 'Invisible et plus rapide 2,5 s (attaquer te révèle).' },
    e: { name: 'Dague empoisonnée', cd: 8, desc: 'Projectile : 40 + poison 30, ralentit 2 s.' },
    r: { name: 'Exécution', cd: 45, desc: 'Surgit derrière l\'ennemi le plus proche de la souris : 110 + 35 % des PV qui lui manquent.' },
  },
};
const SLOTS = ['a', 'q', 'w', 'e', 'r'];

/* Objets des boîtes surprises : ils ne durent qu'une manche. */
const ITEMS = {
  coeur:    { name: 'Cœur en or', emoji: '💛', rar: 'commun', desc: '+150 PV', fx: m => { m.hp += 150; } },
  bottes:   { name: 'Bottes ailées', emoji: '👟', rar: 'commun', desc: '+15 % de vitesse', fx: m => { m.speed *= 1.15; } },
  fantome:  { name: 'Cape fantôme', emoji: '👻', rar: 'commun', desc: 'Invisible les 5 premières secondes', fx: m => { m.ghost = true; } },
  aimant:   { name: 'Aimant', emoji: '🧲', rar: 'commun', desc: '+50 % de pièces gagnées', fx: m => { m.coin *= 1.5; } },
  rage:     { name: 'Rage', emoji: '😡', rar: 'rare', desc: '+25 % de dégâts', fx: m => { m.dmg *= 1.25; } },
  sablier:  { name: 'Sablier', emoji: '⏳', rar: 'rare', desc: 'Sorts 30 % plus vite rechargés', fx: m => { m.cdm *= 0.7; } },
  crocs:    { name: 'Crocs', emoji: '🧛', rar: 'rare', desc: 'Vol de vie : 25 % des dégâts', fx: m => { m.ls += 0.25; } },
  geant:    { name: 'Champignon géant', emoji: '🍄', rar: 'rare', desc: '+60 % PV, mais plus gros et plus lent', fx: m => { m.hpMult *= 1.6; m.size *= 1.35; m.speed *= 0.9; } },
  bombe:    { name: 'Cœur explosif', emoji: '💣', rar: 'rare', desc: 'Tu exploses en mourant : 180 dégâts', fx: m => { m.bomb = true; } },
  verre:    { name: 'Canon de verre', emoji: '🥂', rar: 'rare', desc: '+40 % dégâts, −35 % PV', fx: m => { m.dmg *= 1.4; m.hpMult *= 0.65; } },
  couronne: { name: 'Couronne', emoji: '👑', rar: 'legende', desc: '+30 % dégâts, +200 PV, +10 % vitesse', fx: m => { m.dmg *= 1.3; m.hp += 200; m.speed *= 1.1; } },
  midas:    { name: 'Main de Midas', emoji: '🤑', rar: 'legende', desc: 'Chaque coup réussi rapporte 2 pièces', fx: m => { m.midas += 2; } },
  enclume:  { name: 'Enclume', emoji: '⚓', rar: 'malus', desc: '−15 % de vitesse', fx: m => { m.speed *= 0.85; } },
  poisse:   { name: 'Chat noir', emoji: '🐈‍⬛', rar: 'malus', desc: '−100 PV', fx: m => { m.hp -= 100; } },
  petard:   { name: 'Pétard mouillé', emoji: '💨', rar: 'malus', desc: 'Rien du tout…', fx: () => {} },
};
const BOXES = {
  boite: { name: 'Boîte surprise', emoji: '🎁', cost: 30, odds: { commun: 55, rare: 25, legende: 3, malus: 17 } },
  coffre: { name: 'Coffre doré', emoji: '🧰', cost: 75, odds: { commun: 28, rare: 47, legende: 18, malus: 7 } },
};
const REELS = [['🍒', 30, 1.5, 5], ['🍋', 24, 1.5, 7], ['🔔', 17, 2, 14], ['💎', 10, 3, 40], ['7️⃣', 5, 5, 250], ['💀', 14, 0, 0]];
const BETS = [10, 25, 50, 100];

const rnd = () => Math.random();
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
function norm(dx, dy) { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
function reach(p, x, y, max) {
  const dx = x - p.x, dy = y - p.y, l = Math.hypot(dx, dy);
  return l > max ? [p.x + dx / l * max, p.y + dy / l * max] : [x, y];
}
function pick(weights) {
  let tot = 0; for (const k in weights) tot += weights[k];
  let r = rnd() * tot;
  for (const k in weights) { r -= weights[k]; if (r < 0) return k; }
  return Object.keys(weights)[0];
}
function bushAt(x, y) { for (let i = 0; i < BUSHES.length; i++) if (dist(x, y, BUSHES[i].x, BUSHES[i].y) < BUSHES[i].r) return i; return -1; }
function rockHit(x, y, r) { return ROCKS.some(k => dist(x, y, k.x, k.y) < k.r + r); }
function ringRadius(t) {
  const f = Math.min(1, Math.max(0, (t - RING.t0) / (RING.t1 - RING.t0)));
  return RING.start - (RING.start - RING.end) * f;
}

function modsOf(items) {
  const m = { hp: 0, hpMult: 1, speed: 1, dmg: 1, cdm: 1, ls: 0, size: 1, coin: 1, midas: 0, bomb: false, ghost: false };
  for (const it of items || []) if (ITEMS[it]) ITEMS[it].fx(m);
  return m;
}

/* ------------------------------------------------------------------ une manche */

function makeFighter(mp, spawn) {
  const c = CHAMPS[mp.champ] || CHAMPS.braise, m = modsOf(mp.items);
  if (mp.bot) m.dmg *= 0.8; // les bots tapent un peu moins fort que les humains
  const maxhp = Math.max(100, Math.round((c.hp + m.hp) * m.hpMult));
  return {
    id: mp.id, name: mp.name, champ: mp.champ, bot: !!mp.bot, x: spawn.x, y: spawn.y, vx: 0, vy: 0,
    r: Math.round(22 * m.size), hp: maxhp, maxhp, speed: c.speed * m.speed, mods: m,
    tx: null, ty: null, keys: 0, face: Math.atan2(CY - spawn.y, CX - spawn.x), faceT: 0,
    cd: { a: 0, q: 0, w: 0, e: 0, r: 0 }, stun: 0, slowT: 0, slowM: 1, shield: 0, shieldT: 0,
    invis: m.ghost ? 5 : 0, revealT: 0, hasteT: 0, hasteM: 1, frenzyT: 0, poisonT: 0, poisonD: 0, poisonSrc: null,
    dash: null, dead: false, kills: 0, dealt: 0, earned: 0, lastHit: null, lastHitT: -99,
    marked: false, tapis: 0, claim: 0, dot: 0, brain: { t: 0, sx: 1 },
  };
}

function newRound(m) {
  const fighters = m.players.slice(0, MAX_FIGHTERS);
  const spawns = SPAWNS.slice().sort(() => rnd() - 0.5);
  const st = {
    match: m, time: -COUNTDOWN, ring: RING.start, P: {}, list: [], projs: [], zones: [], events: [],
    nid: 1, totem: null, totemDone: false, over: false, endAt: 0, winner: null, dotT: 0, n: fighters.length,
  };
  fighters.forEach((mp, i) => { const f = makeFighter(mp, spawns[i]); st.P[f.id] = f; st.list.push(f); });
  return st;
}

function ev(st, e) { e.t = +st.time.toFixed(3); st.events.push(e); }
function announce(st, text, big) { ev(st, { k: 'say', s: text, b: big ? 1 : 0 }); }
function foes(st, p) { return st.list.filter(f => f !== p && !f.dead); }

function visibleTo(v, t) {
  if (t.marked) return true;
  if (t.invis > 0) return false;
  const b = bushAt(t.x, t.y);
  if (b < 0 || t.revealT > 0) return true;
  return !!v && bushAt(v.x, v.y) === b;
}

function hurt(st, src, t, amount, dot) {
  if (t.dead || amount <= 0) return;
  if (src) amount *= src.mods.dmg;
  if (t.shield > 0) { const a = Math.min(t.shield, amount); t.shield -= a; amount -= a; }
  if (!dot) { amount = Math.round(amount); t.claim = 0; }
  if (amount <= 0) { if (!dot) ev(st, { k: 'block', id: t.id, x: t.x | 0, y: t.y | 0 }); return; }
  t.hp -= amount;
  if (src && src !== t) {
    t.lastHit = src.id; t.lastHitT = st.time; src.dealt += amount;
    if (src.mods.ls && !src.dead) src.hp = Math.min(src.maxhp, src.hp + amount * src.mods.ls);
    if (src.mods.midas && !dot) src.earned += src.mods.midas;
  }
  if (dot) t.dot += amount;
  else ev(st, { k: 'hit', id: t.id, x: t.x | 0, y: t.y | 0, d: amount });
  if (t.hp <= 0) die(st, t, src);
}

function die(st, t, src) {
  if (t.dot >= 1) { ev(st, { k: 'hit', id: t.id, x: t.x | 0, y: t.y | 0, d: Math.round(t.dot), o: 1 }); t.dot = 0; }
  t.dead = true; t.hp = 0; t.dash = null; t.tx = null;
  let k = src && src !== t ? src : null;
  if (!k && t.lastHit && st.time - t.lastHitT < 8) k = st.P[t.lastHit] || null;
  if (k) { k.kills++; k.earned += PAY.kill * k.mods.coin; }
  ev(st, { k: 'kill', a: k ? k.id : '', v: t.id, x: t.x | 0, y: t.y | 0 });
  if (t.marked) {
    if (k) {
      const n = steal(st.match, t.id, k.id, 0.5);
      announce(st, `💰 ${k.name} vole ${n} pièces à ${t.name} !`, true);
    } else announce(st, `💰 ${t.name} perd son quitte ou double…`);
  }
  if (t.mods.bomb) zone(st, t, { x: t.x, y: t.y, r: 170, delay: 0.35, dmg: 180, look: 'bomb' });
}

function steal(m, fromId, toId, frac) {
  const a = m.players.find(p => p.id === fromId), b = m.players.find(p => p.id === toId);
  if (!a || !b) return 0;
  const n = Math.floor(a.coins * frac);
  a.coins -= n; b.coins += n;
  return n;
}

/* --- briques des sorts */
function shoot(st, p, x, y, o) {
  const [ux, uy] = norm(x - p.x, y - p.y);
  st.projs.push({
    id: st.nid++, owner: p.id, x: p.x + ux * (p.r + 4), y: p.y + uy * (p.r + 4), dx: ux, dy: uy,
    speed: o.speed, left: o.range, r: o.r, dmg: o.dmg, look: o.look, age: 0, stun: o.stun || 0,
    slow: o.slow || 0, slowT: o.slowT || 0, poison: o.poison || 0, pull: !!o.pull, ghost: !!o.ghost,
  });
}
function melee(st, p, x, y, range, dmg) {
  const a = Math.atan2(y - p.y, x - p.x);
  ev(st, { k: 'swing', id: p.id, a: +a.toFixed(2), r: range });
  for (const f of foes(st, p)) {
    const d = dist(p.x, p.y, f.x, f.y);
    if (d > range + f.r) continue;
    let da = Math.abs(Math.atan2(f.y - p.y, f.x - p.x) - a);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da < 1.05 || d < p.r + f.r + 8) hurt(st, p, f, dmg);
  }
}
function zone(st, p, o) {
  st.zones.push({
    id: st.nid++, owner: p.id, x: o.x != null ? o.x : p.x, y: o.y != null ? o.y : p.y, r: o.r,
    delay: o.delay || 0, delay0: o.delay || 0, dur: o.dur || 0, dmg: o.dmg || 0, dps: o.dps || 0,
    stun: o.stun || 0, slow: o.slow || 0, follow: !!o.follow, look: o.look, fired: !o.delay,
  });
}
function dash(p, x, y, len, speed, on) {
  const [ux, uy] = norm(x - p.x, y - p.y);
  p.dash = { dx: ux, dy: uy, left: len, speed, on, hit: [] };
  p.tx = null; p.face = Math.atan2(uy, ux);
}
function unstick(p) {
  for (const k of ROCKS) {
    const d = dist(p.x, p.y, k.x, k.y), min = k.r + p.r;
    if (d < min) { const [ux, uy] = d > 0 ? norm(p.x - k.x, p.y - k.y) : [1, 0]; p.x = k.x + ux * min; p.y = k.y + uy * min; }
  }
  p.x = Math.min(W - p.r, Math.max(p.r, p.x));
  p.y = Math.min(H - p.r, Math.max(p.r, p.y));
}
function blink(st, p, x, y, len) {
  const [tx, ty] = reach(p, x, y, len), fx = p.x, fy = p.y;
  p.x = tx; p.y = ty; p.tx = null; unstick(p);
  ev(st, { k: 'blink', id: p.id, fx: fx | 0, fy: fy | 0, x: p.x | 0, y: p.y | 0 });
}

const ABIL = {
  braise: {
    a: (st, p, x, y) => shoot(st, p, x, y, { speed: 780, range: 540, r: 9, dmg: 32, look: 'ember' }),
    q: (st, p, x, y) => shoot(st, p, x, y, { speed: 820, range: 700, r: 15, dmg: 75, look: 'fire' }),
    w: (st, p, x, y) => { const [tx, ty] = reach(p, x, y, 600); zone(st, p, { x: tx, y: ty, r: 95, delay: 0.8, dmg: 100, look: 'meteor' }); },
    e: (st, p, x, y) => blink(st, p, x, y, 260),
    r: (st, p) => zone(st, p, { follow: true, r: 210, dur: 3, dps: 45, slow: 0.7, look: 'inferno' }),
  },
  rempart: {
    a: (st, p, x, y) => melee(st, p, x, y, 95, 42),
    q: (st, p, x, y) => shoot(st, p, x, y, { speed: 1000, range: 650, r: 14, dmg: 50, pull: true, look: 'hook' }),
    w: (st, p) => { p.shield = 150; p.shieldT = 3; },
    e: (st, p, x, y) => dash(p, x, y, 320, 1100, { dmg: 40, stun: 0.8, stop: true }),
    r: (st, p) => zone(st, p, { follow: true, r: 240, delay: 0.45, dmg: 120, stun: 1.2, look: 'quake' }),
  },
  fleche: {
    a: (st, p, x, y) => shoot(st, p, x, y, { speed: 1050, range: 640, r: 8, dmg: 45, look: 'arrow' }),
    q: (st, p, x, y) => {
      const a = Math.atan2(y - p.y, x - p.x);
      for (let i = -2; i <= 2; i++) {
        const b = a + i * 0.17;
        shoot(st, p, p.x + Math.cos(b) * 100, p.y + Math.sin(b) * 100, { speed: 900, range: 480, r: 8, dmg: 34, look: 'arrow' });
      }
    },
    w: (st, p) => { p.hasteT = 3; p.hasteM = 1.4; p.frenzyT = 3; },
    e: (st, p, x, y) => dash(p, x, y, 230, 1300, null),
    r: (st, p, x, y) => shoot(st, p, x, y, { speed: 1300, range: 2000, r: 26, dmg: 180, stun: 1, ghost: true, look: 'crystal' }),
  },
  ombre: {
    a: (st, p, x, y) => melee(st, p, x, y, 90, 52),
    q: (st, p, x, y) => dash(p, x, y, 290, 1400, { dmg: 70 }),
    w: (st, p) => { p.invis = 2.5; p.hasteT = 2.5; p.hasteM = 1.2; },
    e: (st, p, x, y) => shoot(st, p, x, y, { speed: 950, range: 560, r: 11, dmg: 40, slow: 0.6, slowT: 2, poison: 30, look: 'dagger' }),
    r: (st, p, x, y) => {
      let best = null, bd = 1e9;
      for (const t of foes(st, p)) {
        if (!visibleTo(p, t) || dist(p.x, p.y, t.x, t.y) > 400) continue;
        const d = dist(x, y, t.x, t.y);
        if (d < bd) { bd = d; best = t; }
      }
      if (!best) return false;
      const [ux, uy] = norm(best.x - p.x, best.y - p.y), fx = p.x, fy = p.y;
      p.x = best.x + ux * (best.r + p.r + 4); p.y = best.y + uy * (best.r + p.r + 4); p.tx = null;
      unstick(p);
      p.face = Math.atan2(best.y - p.y, best.x - p.x);
      ev(st, { k: 'blink', id: p.id, fx: fx | 0, fy: fy | 0, x: p.x | 0, y: p.y | 0 });
      hurt(st, p, best, 110 + 0.35 * (best.maxhp - best.hp));
    },
  },
};

function cast(st, p, slot, x, y) {
  if (st.time < 0 || st.over || p.dead || p.stun > 0 || p.dash || !SLOTS.includes(slot) || p.cd[slot] > 0) return false;
  if (!isFinite(x) || !isFinite(y)) return false;
  const c = CHAMPS[p.champ];
  if (ABIL[p.champ][slot](st, p, x, y) === false) return false;
  p.cd[slot] = slot === 'a' ? c.a.cd * (p.frenzyT > 0 ? 0.5 : 1) : c[slot].cd * p.mods.cdm;
  if (slot === 'a' || slot === 'q' || slot === 'e' || slot === 'r') {
    if (!p.dash) { p.face = Math.atan2(y - p.y, x - p.x); p.faceT = 0.3; }
    if (p.invis > 0) p.invis = 0;
  }
  p.revealT = 1.2;
  if (slot !== 'a') ev(st, { k: 'cast', id: p.id, s: slot });
  return true;
}

/* --- un pas de simulation (1/30 s) */
function speedOf(p) {
  let s = p.speed;
  if (p.slowT > 0) s *= p.slowM;
  if (p.hasteT > 0) s *= p.hasteM;
  return s;
}

function move(st, p) {
  const ox = p.x, oy = p.y;
  if (p.dash) {
    const d = p.dash, s = Math.min(d.left, d.speed * DT);
    p.x += d.dx * s; p.y += d.dy * s; d.left -= s;
    if (d.on) for (const f of foes(st, p)) {
      if (d.hit.includes(f.id) || dist(p.x, p.y, f.x, f.y) > p.r + f.r + 6) continue;
      d.hit.push(f.id);
      hurt(st, p, f, d.on.dmg);
      if (d.on.stun) f.stun = Math.max(f.stun, d.on.stun);
      if (d.on.stop) d.left = 0;
    }
    if (rockHit(p.x, p.y, p.r) || p.x < p.r || p.y < p.r || p.x > W - p.r || p.y > H - p.r) d.left = 0;
    if (d.left <= 0) p.dash = null;
  } else if (p.stun <= 0) {
    let dx = 0, dy = 0;
    if (p.keys) {
      if (p.keys & 1) dy -= 1; if (p.keys & 2) dy += 1; if (p.keys & 4) dx -= 1; if (p.keys & 8) dx += 1;
      if (dx || dy) p.tx = null;
    }
    let len = speedOf(p) * DT;
    if (!dx && !dy && p.tx != null) {
      dx = p.tx - p.x; dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) { p.tx = null; dx = dy = 0; } else len = Math.min(len, d);
    }
    if (dx || dy) {
      const [ux, uy] = norm(dx, dy);
      p.x += ux * len; p.y += uy * len;
      if (p.faceT <= 0) p.face = Math.atan2(uy, ux);
    }
  }
  unstick(p);
  p.vx = (p.x - ox) / DT; p.vy = (p.y - oy) / DT;
}

function timers(st, p) {
  for (const k of SLOTS) if (p.cd[k] > 0) p.cd[k] = Math.max(0, p.cd[k] - DT);
  p.stun = Math.max(0, p.stun - DT);
  p.slowT = Math.max(0, p.slowT - DT);
  p.invis = Math.max(0, p.invis - DT);
  p.hasteT = Math.max(0, p.hasteT - DT);
  p.frenzyT = Math.max(0, p.frenzyT - DT);
  p.revealT = Math.max(0, p.revealT - DT);
  p.faceT = Math.max(0, p.faceT - DT);
  if (p.shieldT > 0) { p.shieldT -= DT; if (p.shieldT <= 0) { p.shieldT = 0; p.shield = 0; } }
  if (p.poisonT > 0) { p.poisonT -= DT; hurt(st, st.P[p.poisonSrc] || null, p, p.poisonD * DT, true); }
}

function updateProjs(st) {
  for (const j of st.projs) {
    const s = j.speed * DT;
    j.x += j.dx * s; j.y += j.dy * s; j.left -= s; j.age += DT;
    if (j.left <= 0 || j.x < -40 || j.y < -40 || j.x > W + 40 || j.y > H + 40) { j.dead = true; continue; }
    if (!j.ghost && rockHit(j.x, j.y, j.r * 0.5)) { j.dead = true; ev(st, { k: 'pop', x: j.x | 0, y: j.y | 0, l: j.look }); continue; }
    for (const f of st.list) {
      if (f.dead || f.id === j.owner || dist(j.x, j.y, f.x, f.y) > j.r + f.r) continue;
      projHit(st, j, f); j.dead = true; break;
    }
  }
  st.projs = st.projs.filter(j => !j.dead);
}

function projHit(st, j, f) {
  const o = st.P[j.owner];
  ev(st, { k: 'pop', x: j.x | 0, y: j.y | 0, l: j.look });
  hurt(st, o, f, j.dmg);
  if (f.dead) return;
  if (j.stun) f.stun = Math.max(f.stun, j.stun);
  if (j.slow) { f.slowM = j.slow; f.slowT = j.slowT; }
  if (j.poison) { f.poisonT = 3; f.poisonD = j.poison / 3; f.poisonSrc = j.owner; }
  if (j.pull && o && !o.dead) {
    const d = dist(f.x, f.y, o.x, o.y) - (o.r + f.r + 8);
    if (d > 0) {
      const [ux, uy] = norm(o.x - f.x, o.y - f.y);
      f.dash = { dx: ux, dy: uy, left: d, speed: 1400, on: null, hit: [] };
      f.stun = Math.max(f.stun, 0.4); f.tx = null;
    }
  }
}

function updateZones(st) {
  for (const z of st.zones) {
    const o = st.P[z.owner];
    if (z.follow) {
      if (!o || o.dead) { z.dead = true; continue; }
      z.x = o.x; z.y = o.y;
    }
    if (!z.fired) {
      z.delay -= DT;
      if (z.delay > 0) continue;
      z.fired = true;
      ev(st, { k: 'boom', x: z.x | 0, y: z.y | 0, r: z.r, l: z.look });
      for (const f of st.list) {
        if (f.dead || f.id === z.owner || dist(z.x, z.y, f.x, f.y) > z.r + f.r * 0.5) continue;
        if (z.dmg) hurt(st, o, f, z.dmg);
        if (z.stun && !f.dead) f.stun = Math.max(f.stun, z.stun);
      }
      if (!z.dur) { z.dead = true; continue; }
    }
    z.dur -= DT;
    for (const f of st.list) {
      if (f.dead || f.id === z.owner || dist(z.x, z.y, f.x, f.y) > z.r + f.r * 0.5) continue;
      if (z.dps) hurt(st, o, f, z.dps * DT, true);
      if (z.slow && !f.dead) { f.slowM = z.slow; f.slowT = Math.max(f.slowT, 0.3); }
    }
    if (z.dur <= 0) z.dead = true;
  }
  st.zones = st.zones.filter(z => !z.dead);
}

function updateTotem(st) {
  const alive = st.list.filter(p => !p.dead);
  if (!st.totem && !st.totemDone && st.time >= TOTEM.at && alive.length >= 2) {
    const R = Math.min(st.ring * 0.45, 260);
    let x = CX, y = CY;
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * R;
      x = CX + Math.cos(a) * d; y = CY + Math.sin(a) * d;
      if (!rockHit(x, y, 40)) break;
    }
    st.totem = { x, y };
    announce(st, '💰 Le QUITTE OU DOUBLE est apparu ! Reste dessus 1,5 s pour le prendre.', true);
  }
  const t = st.totem;
  if (!t) return;
  if (dist(t.x, t.y, CX, CY) > st.ring - 30) { st.totem = null; st.totemDone = true; return; }
  const on = alive.filter(p => dist(p.x, p.y, t.x, t.y) < TOTEM.reach + p.r * 0.3);
  for (const p of alive) if (!on.includes(p)) p.claim = 0;
  if (on.length === 1) {
    const p = on[0];
    p.claim += DT;
    if (p.claim >= TOTEM.claim) {
      p.marked = true; st.totem = null; st.totemDone = true;
      announce(st, `💰 ${p.name} prend le QUITTE OU DOUBLE ! S'il gagne la manche, ses gains doublent. Tuez-le pour lui voler la moitié de ses pièces !`, true);
    }
  }
}

function botThink(st, p) {
  const b = p.brain;
  b.t -= DT;
  if (b.t > 0 || p.stun > 0 || p.dash) return;
  b.t = 0.25 + rnd() * 0.2;
  const c = CHAMPS[p.champ], ranged = c.range > 200;
  const vis = foes(st, p).filter(f => visibleTo(p, f));
  const dc = dist(p.x, p.y, CX, CY);
  let target = null, td = 1e9;
  for (const f of vis) { const d = dist(p.x, p.y, f.x, f.y) * (f.marked ? 0.6 : 1); if (d < td) { td = d; target = f; } }
  if (dc > st.ring - 90) { p.tx = CX + (rnd() - 0.5) * 120; p.ty = CY + (rnd() - 0.5) * 120; }
  else if (st.totem && (!target || dist(p.x, p.y, st.totem.x, st.totem.y) < 260)) { p.tx = st.totem.x; p.ty = st.totem.y; }
  if (!target) {
    if (p.tx == null && !st.totem) { p.tx = CX + (rnd() - 0.5) * 500; p.ty = CY + (rnd() - 0.5) * 300; }
    return;
  }
  const d = dist(p.x, p.y, target.x, target.y);
  const lead = d / 900;
  const ax = target.x + target.vx * lead + (rnd() - 0.5) * 50, ay = target.y + target.vy * lead + (rnd() - 0.5) * 50;
  if (dc <= st.ring - 90 && !(st.totem && dist(p.x, p.y, st.totem.x, st.totem.y) < 260)) {
    const ideal = ranged ? 380 : 50;
    const [ux, uy] = norm(target.x - p.x, target.y - p.y);
    if (rnd() < 0.08) b.sx = -b.sx;
    if (d > ideal + 40) { p.tx = target.x; p.ty = target.y; }
    else if (ranged && d < ideal - 100) { p.tx = p.x - ux * 120 - uy * 80 * b.sx; p.ty = p.y - uy * 120 + ux * 80 * b.sx; }
    else { p.tx = p.x - uy * 90 * b.sx; p.ty = p.y + ux * 90 * b.sx; }
  }
  const low = p.hp < p.maxhp * 0.4, want = {
    braise: { q: d < 650, w: d < 600, e: low && d < 250, r: d < 200 },
    rempart: { q: d < 600, w: p.hp < p.maxhp * 0.75 && d < 300, e: d < 320, r: d < 200 },
    fleche: { q: d < 450, w: d < 500, e: d < 180, r: d < 1100 && rnd() < 0.2 },
    ombre: { q: d < 290, w: d > 450 && rnd() < 0.3, e: d < 520, r: d < 380 && target.hp < target.maxhp * 0.55 },
  }[p.champ];
  for (const s of ['r', 'q', 'e', 'w']) {
    if (p.cd[s] > 0 || !want[s] || rnd() > 0.3) continue;
    if (p.champ === 'fleche' && s === 'e' || p.champ === 'braise' && s === 'e') {
      cast(st, p, s, p.x - (target.x - p.x), p.y - (target.y - p.y)); // fuir
    } else cast(st, p, s, ax, ay);
    return;
  }
  if (d < c.range + target.r) cast(st, p, 'a', ax, ay);
}

function step(st) {
  st.time += DT;
  if (st.time < 0) return;
  st.ring = ringRadius(st.time);
  for (const p of st.list) if (!p.dead && p.bot && !st.over) botThink(st, p);
  for (const p of st.list) if (!p.dead) timers(st, p);
  for (const p of st.list) if (!p.dead) move(st, p);
  updateProjs(st);
  updateZones(st);
  if (!st.over) updateTotem(st);
  const ringDps = st.time > RING.t1 ? RING.dps2 : RING.dps;
  for (const p of st.list) {
    if (!p.dead && dist(p.x, p.y, CX, CY) > st.ring) hurt(st, null, p, ringDps * DT, true);
  }
  st.dotT += DT;
  if (st.dotT >= 0.5) {
    st.dotT = 0;
    for (const p of st.list) if (p.dot >= 1) { ev(st, { k: 'hit', id: p.id, x: p.x | 0, y: p.y | 0, d: Math.round(p.dot), o: 1 }); p.dot = 0; }
  }
  if (!st.over) {
    const alive = st.list.filter(p => !p.dead);
    let winner, done = false;
    if (alive.length <= 1) { done = true; winner = alive[0]; }
    else if (st.time >= ROUND_MAX) { done = true; winner = alive.sort((a, b) => b.hp / b.maxhp - a.hp / a.maxhp)[0]; }
    if (done) {
      st.over = true; st.endAt = st.time + END_DELAY; st.winner = winner ? winner.id : null;
      st.totem = null;
      announce(st, winner ? `🏆 ${winner.name} gagne la manche !` : 'Personne ne gagne cette manche…', true);
    }
  }
}

/* ------------------------------------------------------------------ la partie */

function newMatch() {
  return { players: [], phase: 'lobby', round: 0, rounds: 5, st: null, clock: 0, acc: 0, shopEnd: 0, last: null, final: false, events: [] };
}
function freeColor(m) { return COLORS.find(c => !m.players.some(p => p.col === c)) || '#94a3b8'; }
function cleanName(s) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Joueur'; }

function addPlayer(m, o) {
  const old = m.players.find(p => p.id === o.id);
  if (old) { old.name = cleanName(o.name); old.seen = m.clock; return old; }
  if (m.players.length >= MAX_FIGHTERS) return null;
  const p = {
    id: o.id, name: cleanName(o.name), champ: CHAMPS[o.champ] ? o.champ : 'braise', bot: !!o.bot, col: freeColor(m),
    coins: START_COINS, items: [], ready: !!o.bot, kills: 0, wins: 0, casino: 0, seen: m.clock,
  };
  m.players.push(p);
  return p;
}
const BOT_NAMES = ['Bot Pipette', 'Bot Scalpel', 'Bot Stétho', 'Bot Mitochondrie'];
function addBot(m) {
  const n = BOT_NAMES.find(b => !m.players.some(p => p.name === b)) || 'Bot';
  return addPlayer(m, { id: 'bot' + Math.floor(rnd() * 1e9), name: n, champ: Object.keys(CHAMPS)[Math.floor(rnd() * 4)], bot: true });
}
function removePlayer(m, id) {
  m.players = m.players.filter(p => p.id !== id);
  if (m.st && m.st.P[id] && !m.st.P[id].dead) {
    const f = m.st.P[id];
    f.dead = true; f.hp = 0;
    ev(m.st, { k: 'kill', a: '', v: id, x: f.x | 0, y: f.y | 0 });
  }
}

function startGame(m) {
  if (m.players.length < 2) return false;
  for (const p of m.players) { p.coins = START_COINS; p.items = []; p.kills = 0; p.wins = 0; p.casino = 0; p.ready = !!p.bot; }
  m.round = 0; m.final = false; m.last = null;
  startRound(m);
  return true;
}
function startRound(m) {
  m.round++; m.phase = 'fight'; m.acc = 0;
  m.st = newRound(m);
}
function endRound(m) {
  const st = m.st, rows = [];
  for (const f of st.list) {
    const mp = m.players.find(p => p.id === f.id);
    if (!mp) continue;
    const win = f.id === st.winner;
    let earned = f.earned + PAY.round * f.mods.coin + (win ? PAY.win * f.mods.coin : 0);
    if (win && f.marked) earned *= 2;
    earned = Math.round(earned);
    mp.coins += earned; mp.kills += f.kills; if (win) mp.wins++;
    let tapis = 0;
    if (f.tapis) {
      if (win) { tapis = f.tapis * (st.n - 1); mp.coins += tapis; }
      else { tapis = -Math.min(f.tapis, mp.coins); mp.coins = Math.max(CONSOLATION, mp.coins + tapis); }
    }
    rows.push({ id: f.id, earned, tapis, kills: f.kills, win, marked: f.marked });
  }
  m.last = { round: m.round, winner: st.winner, rows };
  m.final = m.round >= m.rounds;
  for (const p of m.players) { p.items = []; p.ready = !!p.bot; }
  m.phase = 'shop'; m.shopEnd = m.clock + SHOP_TIME;
  for (const p of m.players) if (p.bot) botShop(m, p);
}
function botShop(m, p) {
  if (!m.final && p.coins >= 70 && rnd() < 0.6) shopAction(m, p, { t: 'box', b: 'boite' });
  if (p.coins >= 40 && rnd() < 0.4) shopAction(m, p, { t: 'slots', bet: 10 });
}

function tick(m, dt) {
  m.clock += dt;
  if (m.phase === 'fight' && m.st) {
    m.acc = Math.min(m.acc + dt, 0.25);
    while (m.acc >= DT) {
      m.acc -= DT;
      step(m.st);
      if (m.st.over && m.st.time >= m.st.endAt) { endRound(m); break; }
    }
  } else if (m.phase === 'shop') {
    const humans = m.players.filter(p => !p.bot);
    if (m.clock >= m.shopEnd || humans.length && humans.every(p => p.ready)) {
      if (m.final) { m.phase = 'end'; m.st = null; } else startRound(m);
    }
  }
}

function shopAction(m, mp, msg) {
  const res = { k: 'casino', id: mp.id, name: mp.name, kind: msg.t };
  if (msg.t === 'slots') {
    const bet = msg.bet === 'all' ? mp.coins : (BETS.includes(msg.bet) ? msg.bet : 0);
    if (!bet || bet > mp.coins) return null;
    const tot = REELS.reduce((a, s) => a + s[1], 0);
    const roll = () => { let r = rnd() * tot; for (const s of REELS) { r -= s[1]; if (r < 0) return s; } return REELS[0]; };
    const reels = [roll(), roll(), roll()];
    let mult = 0;
    if (!reels.some(s => s[0] === '💀')) {
      if (reels[0] === reels[1] && reels[1] === reels[2]) mult = reels[0][3];
      else for (const s of reels) if (reels.filter(x => x === s).length === 2) { mult = s[2]; break; }
    }
    const win = Math.floor(bet * mult);
    mp.coins += win - bet; mp.casino += win - bet;
    Object.assign(res, { reels: reels.map(s => s[0]), bet, win, mult });
  } else if (msg.t === 'roul') {
    const bet = msg.bet === 'all' ? mp.coins : (BETS.includes(msg.bet) ? msg.bet : 0);
    if (!bet || bet > mp.coins || !['rouge', 'noir', 'vert'].includes(msg.c)) return null;
    const n = Math.floor(rnd() * 15), color = n === 0 ? 'vert' : n % 2 ? 'rouge' : 'noir';
    const win = color === msg.c ? bet * (color === 'vert' ? 14 : 2) : 0;
    mp.coins += win - bet; mp.casino += win - bet;
    Object.assign(res, { n, color, c: msg.c, bet, win });
  } else if (msg.t === 'box') {
    const box = BOXES[msg.b];
    if (!box || m.final || mp.coins < box.cost || mp.items.length >= MAX_ITEMS) return null;
    const rar = pick(box.odds), pool = Object.keys(ITEMS).filter(k => ITEMS[k].rar === rar);
    const item = pool[Math.floor(rnd() * pool.length)];
    mp.coins -= box.cost; mp.items.push(item);
    Object.assign(res, { b: msg.b, item });
  } else return null;
  m.events.push(res);
  return res;
}

/* Un message d'un joueur (déjà identifié par l'hôte). */
function input(m, id, msg) {
  const mp = m.players.find(p => p.id === id);
  if (!mp || !msg) return;
  mp.seen = m.clock;
  const st = m.st, f = st && m.phase === 'fight' ? st.P[id] : null;
  switch (msg.t) {
    case 'mv': if (f && msg.x < 0) f.tx = null; else if (f && !f.dead && isFinite(msg.x) && isFinite(msg.y)) { f.tx = Math.min(W, Math.max(0, +msg.x)); f.ty = Math.min(H, Math.max(0, +msg.y)); } break;
    case 'k': if (f) f.keys = (msg.b | 0) & 15; break;
    case 'c': if (f) cast(st, f, msg.s, +msg.x, +msg.y); break;
    case 'tapis':
      if (f && !f.dead && !f.tapis && !st.over && st.time >= 0 && st.time <= TAPIS_WINDOW && mp.coins > 0) {
        f.tapis = mp.coins;
        announce(st, `🎲 ${mp.name} fait TAPIS : ${mp.coins} pièces sur sa victoire !`, true);
      }
      break;
    case 'champ': if (CHAMPS[msg.c] && m.phase !== 'fight') mp.champ = msg.c; break;
    case 'ready': if (m.phase === 'shop') mp.ready = !!msg.v; break;
    case 'slots': case 'roul': case 'box': if (m.phase === 'shop') shopAction(m, mp, msg); break;
  }
}

const r1 = v => Math.round(v * 10) / 10;
function snapshot(m) {
  const st = m.st;
  if (!st) return null;
  const P = st.list.map(p => {
    const fl = (p.dead ? 1 : 0) | (p.invis > 0 ? 2 : 0) | (p.stun > 0 ? 4 : 0) | (p.slowT > 0 ? 8 : 0) | (p.marked ? 16 : 0) |
      (p.tapis ? 32 : 0) | (p.hasteT > 0 ? 64 : 0) | (p.revealT > 0 ? 128 : 0) | (p.claim > 0 ? 256 : 0) | (p.poisonT > 0 ? 512 : 0);
    return [p.id, Math.round(p.x), Math.round(p.y), Math.ceil(p.hp), p.maxhp, r1(p.face), fl, Math.ceil(p.shield), p.r,
      bushAt(p.x, p.y), r1(p.cd.a), r1(p.cd.q), r1(p.cd.w), r1(p.cd.e), r1(p.cd.r), r1(p.claim)];
  });
  const J = st.projs.map(j => [j.id, j.look, Math.round(j.x), Math.round(j.y), Math.round(j.dx * j.speed), Math.round(j.dy * j.speed), j.r, r1(j.age), j.owner]);
  const Z = st.zones.map(z => [z.id, z.look, Math.round(z.x), Math.round(z.y), z.r, z.fired ? 0 : r1(z.delay / z.delay0), z.follow ? z.owner : '']);
  const s = { T: +st.time.toFixed(3), R: Math.round(st.ring), P, J, Z, K: st.totem ? [Math.round(st.totem.x), Math.round(st.totem.y)] : null, O: st.over ? 1 : 0, E: st.events };
  st.events = [];
  return s;
}

function info(m) {
  return {
    ph: m.phase, rd: m.round, rds: m.rounds, fin: m.final, left: m.phase === 'shop' ? Math.max(0, Math.ceil(m.shopEnd - m.clock)) : 0,
    last: m.last, pl: m.players.map(p => ({ id: p.id, name: p.name, champ: p.champ, bot: p.bot, col: p.col, coins: p.coins, items: p.items, ready: p.ready, kills: p.kills, wins: p.wins, casino: p.casino })),
  };
}

const Sim = {
  W, H, CX, CY, DT, ROCKS, BUSHES, RING, ROUND_MAX, TAPIS_WINDOW, TOTEM, CHAMPS, SLOTS, ITEMS, BOXES, REELS, BETS, MAX_ITEMS, MAX_FIGHTERS, PAY, START_COINS,
  newMatch, addPlayer, addBot, removePlayer, startGame, tick, input, snapshot, info, bushAt, visibleTo, ringRadius,
  _: { newRound, step, cast, hurt, endRound, shopAction },
};
if (typeof module !== 'undefined' && module.exports) module.exports = Sim; else root.Sim = Sim;
})(this);
