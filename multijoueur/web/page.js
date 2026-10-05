/* Anki Multijoueur - the group window. Renders the snapshot from api.py;
 * talks to Python through QWebChannel inside Anki, or to tools/dev_server.py
 * over HTTP in a normal browser.
 * Screens: Accueil (duel, pomodoro, today, points, together) · Défis (défis,
 * boss, course, paris) · Classement (saison) · Stats (bilan, badges) ·
 * Activité (messages), and the profile (titre, cadre, trophées) behind the
 * avatar button. The game data (S.game) is computed by games.py. */
(function () {
  'use strict';

  let S = window.MJ_BOOT || {};
  let tab = 'accueil';
  let draftAvatar = null;
  let sortBy = 'points';
  let showLogin = false;
  let reportMonth = null;
  let pendingRender = false;
  let form = null;          // the "Nouveau défi" form, kept across re-renders

  // ---------------------------------------------------------------- bridge
  let callPy = null;
  const ready = new Promise((resolve) => {
    if (window.qt && window.qt.webChannelTransport && window.QWebChannel) {
      new QWebChannel(window.qt.webChannelTransport, (ch) => {
        const py = ch.objects.py;
        callPy = (name, payload) => new Promise((res) => py.call(name, JSON.stringify(payload || {}), (r) => res(JSON.parse(r))));
        resolve();
      });
    } else {
      callPy = (name, payload) => fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, payload: payload || {} }) }).then((r) => r.json());
      resolve();
    }
  });

  async function api(name, payload) {
    await ready;
    const res = await callPy(name, payload);
    if (res.snapshot) S = res.snapshot;
    if (!res.ok && res.error) toast('⚠️ ' + res.error);
    render();
    return res;
  }

  // a background refresh must not wipe what the player is typing
  const typing = () => { const a = document.activeElement; return a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName); };
  function softRender() { if (typing()) pendingRender = true; else render(); }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 50));
  function go(t) {
    tab = t;
    if (t === 'activite' && S.unread) { S.unread = 0; callPy && callPy('feed_seen', {}); }
    render();
    window.scrollTo(0, 0);
  }
  window.MJ = { update(snap) { S = snap; softRender(); }, go };

  // ---------------------------------------------------------------- helpers
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' '));
  const plural = (n, a, b) => (n > 1 ? b : a);
  const frDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }
  function ago(isoTime) {
    const s = (Date.now() - new Date(isoTime).getTime()) / 1000;
    if (s < 90) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return `il y a ${Math.round(s / 86400)} j`;
  }
  const ICON_SYNC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';

  // one color per player: me = amber, the others in a fixed order
  const OTHERS = ['#7C9CFF', '#C792EA', '#5FD3D3', '#FF9F7A', '#9BE07C', '#F28FB1'];
  const players = () => (S.view ? S.view.players : []);
  const player = (id) => players().find((p) => p.id === id);
  function color(p) {
    if (!p || p.me) return 'var(--me)';
    const others = players().filter((o) => !o.me);
    return OTHERS[Math.max(0, others.findIndex((o) => o.id === p.id)) % OTHERS.length];
  }
  const G = () => S.game || null;
  const gp = (id) => ((G() || {}).players || {})[id] || null;
  const frameOf = (id) => (gp(id) || {}).frame || 'aucun';
  const pseudo = (id) => { const p = player(id); return p ? esc(p.pseudo) : 'Ancien membre'; };
  const dot = (p, cls = '') => `<div class="dot ${cls} frame-${frameOf(p.id)}" style="background:${color(p)}">${esc(p.avatar)}</div>`;
  const levelTag = (id) => { const g = gp(id); return g ? `<span class="lvl" title="${g.xp} points gagnés">${g.level.icon} ${esc(g.level.title)}</span>` : ''; };
  const name = (p) => `<b>${esc(p.pseudo)}</b>${p.me ? ' <span class="tiny muted">(toi)</span>' : ''}${p.live ? ' <span class="live">· en train d\'étudier</span>' : ''}`;
  const bar = (pct, col, cls = '') => `<div class="bar ${cls}"><div style="width:${Math.max(0, Math.min(100, pct))}%;background:${col}"></div></div>`;
  function ring(p) {
    const C = 213.6, pct = Math.min(100, p.today_pct);
    return `<div class="ring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="34" fill="none" stroke="var(--line)" stroke-width="7"/>
      <circle cx="42" cy="42" r="34" fill="none" stroke="${color(p)}" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 42 42)"/></svg>
      <div class="face frame-${frameOf(p.id)}">${esc(p.avatar)}</div></div>`;
  }

  // ---------------------------------------------------------------- frame
  function render() {
    const app = $('#app');
    const top = header() + (S.error ? `<div class="err">⚠️ ${esc(S.error)}</div>` : '') + updateBanner();
    if (!S.profile) { app.innerHTML = top + profileForm(true) + loginCard(); bindProfile(); bindAccount(); return; }
    if (!S.group) { app.innerHTML = top + groupChoice(); bindGroup(); return; }
    const tabs = [['accueil', 'Accueil'], ['defis', 'Défis'], ['classement', 'Classement'], ['stats', 'Stats'], ['activite', 'Activité']];
    const screens = { accueil: screenHome, defis: screenChallenges, classement: screenRanking, stats: screenStats, activite: screenFeed, profil: screenProfile };
    const unread = tab === 'activite' ? 0 : (S.unread || 0);
    const badge = (id) => (id === 'activite' && unread ? `<span class="unread">${unread > 9 ? '9+' : unread}</span>` : '')
      + (id === 'defis' && todo().length ? '<span class="unread dotonly"></span>' : '');
    app.innerHTML = top + `<nav class="tabs">${tabs.map(([id, l]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${l}${badge(id)}</button>`).join('')}</nav>` + screens[tab]();
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
    bindCommon();
    if (tab === 'accueil') { bindHome(); bindPomodoro(); }
    if (tab === 'defis') bindChallenges();
    if (tab === 'stats') bindStats();
    if (tab === 'classement') bindRanking();
    if (tab === 'activite') bindFeed();
    if (tab === 'profil') { bindProfile(); bindLeave(); bindAccount(); bindFrames(); bindSettings(); }
  }

  function header() {
    const sub = [S.group ? esc(S.group.name) : 'Anki Multijoueur',
      S.syncing ? 'synchronisation…' : (S.last_sync ? `à jour ${ago(S.last_sync)}` : '')].filter(Boolean).join(' · ');
    const me = S.profile && S.group ? `<button class="me-btn ${tab === 'profil' ? 'on' : ''}" id="go-profile" aria-label="Mon profil" title="Mon profil">${esc(S.profile.avatar || '🙂')}</button>` : '';
    return `<div class="top"><div class="grow"><h1>Multijoueur</h1><div class="sub">${sub}</div></div>
      <button class="icon-btn ${S.syncing ? 'spin' : ''}" id="refresh" aria-label="Synchroniser" title="Synchroniser">${ICON_SYNC}</button>${me}</div>`;
  }

  function updateBanner() {
    if (!S.update) return '';
    return `<div class="update"><div><b>Mise à jour disponible</b>
      ${S.update.nouveautes ? `<div class="small">${esc(S.update.nouveautes)}</div>` : ''}</div>
      <button class="btn primary small" id="install-update">Installer</button></div>`;
  }

  function bindCommon() {
    const r = $('#refresh');
    if (r) r.onclick = () => api('refresh');
    const u = $('#install-update');
    if (u) u.onclick = async () => { u.disabled = true; u.textContent = 'Téléchargement…'; await api('install_update'); };
    const pr = $('#go-profile');
    if (pr) pr.onclick = () => { tab = tab === 'profil' ? 'accueil' : 'profil'; render(); };
  }

  // ---------------------------------------------------------------- first steps
  function profileForm(first) {
    const p = S.profile || {};
    const av = draftAvatar || p.avatar || S.avatars[0];
    return `<div class="card">
      <h2>${first ? 'Bienvenue ! Crée ton profil' : 'Mon profil'}</h2>
      ${first ? '<p class="small muted" style="margin:0">Seuls ton pseudo et tes chiffres d\'étude (cartes, minutes, rétention…) sont partagés avec ton groupe. Jamais le contenu de tes cartes.</p>' : ''}
      <div class="row"><label for="pf-pseudo">Pseudo</label><input id="pf-pseudo" maxlength="24" value="${esc(p.pseudo || '')}" placeholder="Ton pseudo"></div>
      <div class="row"><label>Avatar</label><div class="avatars">${S.avatars.map((a) => `<button class="av ${a === av ? 'on' : ''}" data-av="${a}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div></div>
      <div class="row"><label for="pf-program">Programme (facultatif)</label><input id="pf-program" maxlength="40" value="${esc(p.program || '')}" placeholder="Médecine, bac en biologie…"></div>
      <div class="row"><label for="pf-goal">Objectif de secours</label><input id="pf-goal" type="number" min="10" max="5000" value="${p.daily_goal || 100}" style="width:110px"></div>
      <div class="tiny muted">Ton objectif est <b>automatique</b> : ce qu'Anki te donne chaque jour. Ce nombre sert seulement les jours où Anki sur cet ordinateur n'a rien vu (tout fait sur téléphone, anciens jours).</div>
      <div class="row"><button class="btn primary" id="pf-save">${first ? 'Créer mon profil' : 'Enregistrer'}</button></div></div>`;
  }

  function bindProfile() {
    document.querySelectorAll('[data-av]').forEach((b) => { b.onclick = () => { draftAvatar = b.dataset.av; document.querySelectorAll('[data-av]').forEach((o) => o.classList.toggle('on', o === b)); }; });
    const save = $('#pf-save');
    if (save) save.onclick = async () => {
      save.disabled = true;
      const res = await api('save_profile', { pseudo: $('#pf-pseudo').value, avatar: draftAvatar || (S.profile || {}).avatar || S.avatars[0],
        daily_goal: $('#pf-goal').value, program: $('#pf-program').value });
      if (res.ok) toast('✅ Profil enregistré');
    };
    bindCommon();
  }

  function groupChoice() {
    return `<div class="grid g2">
      <div class="card"><h2>Créer un groupe</h2>
        <div class="small muted">Tu recevras un code à 6 caractères à donner à tes amis.</div>
        <div class="row"><input id="g-name" maxlength="40" placeholder="Nom du groupe" aria-label="Nom du groupe" style="flex:1"><button class="btn primary" id="g-create">Créer</button></div></div>
      <div class="card"><h2>Rejoindre un groupe</h2>
        <div class="small muted">Entre le code que ton ami t'a donné.</div>
        <div class="row"><input id="g-code" maxlength="6" placeholder="ABC123" aria-label="Code du groupe" style="text-transform:uppercase;width:120px"><button class="btn primary" id="g-join">Rejoindre</button></div></div></div>`;
  }

  function bindGroup() {
    $('#g-create').onclick = async () => { const r = await api('create_group', { name: $('#g-name').value }); if (r.ok) toast(`🎉 Groupe créé ! Code : ${r.code}`); };
    $('#g-join').onclick = async () => { const r = await api('join_group', { code: $('#g-code').value }); if (r.ok) toast(`🎉 Bienvenue dans « ${r.name} » !`); };
    bindCommon();
  }

  // ---------------------------------------------------------------- Accueil
  function screenHome() {
    const v = S.view;
    if (!v) return '<div class="card muted">Chargement du groupe…</div>';
    const me = players().find((p) => p.me);
    const others = players().filter((p) => !p.me);
    return todoCard() + duelCard(v) + pomodoroCard() + `<div class="grid g2">${[me, ...others].filter(Boolean).map(todayCard).join('')}</div>`
      + (me ? pointsCard(me) : '') + togetherCards(v);
  }

  function duelCard(v) {
    if (!v.duel) return '<div class="card hero"><h2>Duel de la semaine</h2><div class="small muted">Il faut au moins 2 joueurs : donne le code du groupe à un ami (bouton de profil en haut).</div></div>';
    const [a, b] = v.duel.map(player);
    const left = 7 - (new Date(v.today + 'T12:00:00').getDay() + 6) % 7 - 1;
    const side = (p) => `<div class="side">${ring(p)}<div>${name({ ...p, live: false })}</div>
      <div class="pts" style="color:${color(p)}">${p.week.points}<small> pts</small></div></div>`;
    return `<div class="card hero"><h2>Duel de la semaine <span class="right">${left > 0 ? `se termine dimanche · ${left} ${plural(left, 'jour', 'jours')}` : 'dernier jour !'}</span></h2>
      <div class="duel">${side(a)}<div class="vs">VS</div>${side(b)}</div>
      <div class="split-bar"><div style="flex-grow:${a.week.points || 1};background:${color(a)}"></div><div style="flex-grow:${b.week.points || 1};background:${color(b)}"></div></div>
      <div class="tiny muted" style="text-align:center">L'anneau montre la journée d'aujourd'hui · les points comptent depuis lundi</div>
      ${duelHistory(a, b)}</div>`;
  }

  function duelHistory(a, b) {
    const d = G() && G().duels;
    if (!d || !d.weeks.length) return '';
    const last = d.weeks[0];
    const lastText = last.winner ? `Semaine dernière : <b>${pseudo(last.winner)}</b> a gagné (${Object.entries(last.scores).map(([id, v]) => `${pseudo(id)} ${v}`).join(' – ')})`
      : 'Semaine dernière : égalité';
    const marks = d.weeks.slice(0, 8).reverse().map((w) => { const p = w.winner && player(w.winner);
      return `<span class="wk" title="Semaine du ${frDate(w.monday)}" style="background:${p ? color(p) : 'var(--line)'}"></span>`; }).join('');
    return `<div class="duel-hist"><div class="small"><b style="color:${color(a)}">${d.wins[a.id] || 0}</b> – <b style="color:${color(b)}">${d.wins[b.id] || 0}</b>
      <span class="tiny muted">duels gagnés</span> <span class="wks">${marks}</span></div><div class="tiny muted">${lastText}</div></div>`;
  }

  // things waiting for me, on top of Accueil (and a dot on the Défis tab)
  function todo() {
    const g = G();
    if (!g || !S.view) return [];
    const out = [];
    g.bets.filter((b) => b.status === 'pending' && b.opponent === S.me).forEach((b) => out.push({ kind: 'bet', b }));
    if (g.pomodoro && !g.pomodoro.players.includes(S.me)) out.push({ kind: 'pomo', p: g.pomodoro });
    g.challenges.filter((c) => c.status === 'active' && c.days_left <= 2 && c.type !== 'race').forEach((c) => {
      const mine = c.players.find((x) => x.id === S.me);
      if (c.type === 'boss' ? c.hp_left > 0 : mine && !mine.done) out.push({ kind: 'challenge', c });
    });
    return out;
  }

  function todoCard() {
    const items = todo();
    if (!items.length) return '';
    const row = (it) => {
      if (it.kind === 'bet') return `<div class="todo-row"><div class="small">💰 <b>${pseudo(it.b.by)}</b> te propose un pari de <b>${it.b.stake} pts</b></div>
        <div class="row"><button class="btn primary small" data-bet="${it.b.id}" data-yes="1">Accepter</button><button class="btn small" data-bet="${it.b.id}" data-yes="0">Refuser</button><button class="btn small" data-go="defis">Voir</button></div></div>`;
      if (it.kind === 'pomo') return `<div class="todo-row"><div class="small">🍅 <b>${pseudo(it.p.by)}</b> a lancé un pomodoro</div>
        <div class="row"><button class="btn primary small" data-pomo-join="${it.p.id}">Rejoindre</button></div></div>`;
      const c = it.c;
      const left = c.type === 'boss' ? `encore ${fmt(c.hp_left)} PV` : (() => { const m = c.players.find((x) => x.id === S.me); return `${fmt(m.value)} / ${fmt(c.target)}`; })();
      return `<div class="todo-row"><div class="small">${TYPE_ICON[c.type]} <b>${esc(challengeTitle(c))}</b> se termine ${c.days_left <= 1 ? "aujourd'hui" : 'demain'} · ${left}</div>
        <div class="row"><button class="btn small" data-go="defis">Voir</button></div></div>`;
    };
    return `<div class="card todo"><h2>À faire <span class="right">${items.length}</span></h2>${items.map(row).join('')}</div>`;
  }

  function todayCard(p) {
    const pct = Math.min(150, p.today_pct);
    let action = '';
    if (p.me) {
      if (p.today_done) action = '<div class="tiny">Journée finie, bravo !</div>';
      else if (p.yesterday_done) action = '<div class="tiny">Finis ta journée pour <b>+3 régularité</b></div>';
      else action = '<div class="tiny">Finis ta journée pour lancer ta série</div>';
    } else if (p.today_done && p.goal_event) {
      const mine = (S.feed.find((e) => e.id === p.goal_event) || { my_reactions: [] }).my_reactions.includes('👏');
      action = `<button class="btn small" data-cheer="${p.goal_event}" ${mine ? 'disabled' : ''}>${mine ? 'Félicité 👏' : 'Féliciter'}</button>`;
    } else if (!p.today_done) {
      action = `<button class="btn small" data-nudge="${p.id}" ${p.encouraged ? 'disabled' : ''}>${p.encouraged ? 'Encouragé 💪' : 'Encourager'}</button>`;
    }
    return `<div class="card"><div class="split"><div class="label">${p.me ? 'Ta journée' : esc(p.pseudo)}${!p.me && p.live ? ' <span class="live">· étudie</span>' : ''}</div>
      ${p.today_done ? '<span class="badge">fini</span>' : ''}</div>
      <div class="num-big">${pct} %</div>
      <div class="small muted">${fmt(p.today_cards)} ${plural(p.today_cards, 'carte', 'cartes')} · ${p.today_points} pts aujourd'hui</div>
      ${bar(pct, color(p))}${action}</div>`;
  }

  function pointsCard(me) {
    const d = me.today_detail;
    const cell = (val, label, max) => `<div class="well"><div class="num" style="color:${val ? 'var(--me)' : 'var(--muted)'}">${max ? val : '+' + val}${max ? `<span class="tiny muted">/${max}</span>` : ''}</div><div class="label">${label}</div></div>`;
    return `<div class="card"><h2>Tes points aujourd'hui <span class="right">${me.today_points} pts</span></h2>
      <div class="grid g4">${cell(d.day + d.extra, 'Journée', 10)}${cell(d.regular, 'Régularité')}${cell(d.no_backlog, 'Zéro retard')}${cell(d.retention, 'Rétention')}</div></div>`;
  }

  function togetherCards(v) {
    const squares = (p) => `<div class="row" style="gap:10px"><div class="tiny" style="width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.pseudo)}</div>
      <div class="squares">${Array.from({ length: v.week_goal.days }, (_, i) => `<div class="sq ${i < p.week.validated ? 'on' : ''}"></div>`).join('')}</div></div>`;
    return `<div class="grid g2">
      <div class="card"><div class="label">Série de groupe</div><div class="num-big" style="font-size:22px">${v.group_streak} ${plural(v.group_streak, 'jour', 'jours')}</div>
        <div class="tiny muted">Jours où tout le monde a fini sa journée</div></div>
      <div class="card"><div class="label">Objectif commun · ${v.week_goal.days} jours chacun ${v.week_goal.done ? '🎉' : ''}</div>${players().map(squares).join('')}</div></div>`;
  }

  function bindHome() {
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
    document.querySelectorAll('[data-bet]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; const r = await api('answer_bet', { ref: parseInt(b.dataset.bet, 10), accept: b.dataset.yes === '1' }); if (r.ok) toast(b.dataset.yes === '1' ? '🤝 Pari accepté' : 'Pari refusé'); };
    });
    document.querySelectorAll('[data-nudge]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; const r = await api('encourage', { player_id: b.dataset.nudge }); if (r.ok) toast('💪 Encouragement envoyé'); };
    });
    document.querySelectorAll('[data-cheer]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; await api('react', { event_id: parseInt(b.dataset.cheer, 10), emoji: '👏', on: true }); };
    });
  }

  // ---------------------------------------------------------------- Classement
  const CRITERIA = [
    ['points', 'Points', (p) => p.week.points, (p) => p.week.points + ' pts'],
    ['streak', 'Régularité', (p) => p.streak, (p) => `série ${p.streak} j`],
    ['retention', 'Rétention', (p) => p.week.retention || 0, (p) => (p.week.retention == null ? '—' : p.week.retention + ' %')],
    ['pct', '% de sa semaine', (p) => p.week.pct, (p) => p.week.pct + ' %'],
    ['minutes', 'Minutes', (p) => p.week.minutes, (p) => fmt(p.week.minutes) + ' min'],
    ['cards', 'Cartes', (p) => p.week.cards, (p) => fmt(p.week.cards) + ' cartes'],
  ];

  function screenRanking() {
    const v = S.view;
    if (!v) return '<div class="card muted">Chargement…</div>';
    const crit = CRITERIA.find((c) => c[0] === sortBy) || CRITERIA[0];
    const ranked = players().slice().sort((a, b) => crit[2](b) - crit[2](a) || b.week.points - a.week.points);
    const top = Math.max(1, ...ranked.map(crit[2]));
    const rows = ranked.map((p, i) => `<div class="rank-row"><div class="rank ${i === 0 ? 'first' : ''}">${i + 1}</div>${dot(p)}
      <div class="body"><div class="split"><div>${name(p)} ${levelTag(p.id)}</div><div class="num" style="font-size:15px">${crit[3](p)}</div></div>
      ${bar(100 * crit[2](p) / top, color(p))}
      <div class="tiny muted">${p.week.points} pts · ${p.week.pct} % de sa semaine · série ${p.streak} j${p.week.retention == null ? '' : ` · rétention ${p.week.retention} %`}</div></div></div>`).join('');
    const rule = (val, text) => `<div class="well"><div class="num" style="font-size:15px;color:var(--me)">${val}</div><div class="label">${text}</div></div>`;
    const gr = v.group_records;
    const best = (label, val, who) => `<div class="card" style="gap:4px"><div class="label">${label}</div><div class="num">${val}</div><div class="tiny muted">${who}</div></div>`;
    return `<div class="chips">${CRITERIA.map((c) => `<button class="chip ${c[0] === crit[0] ? 'on' : ''}" data-sort="${c[0]}">${c[1]}</button>`).join('')}</div>
      <div class="card list">${rows}</div>
      ${seasonCard()}
      ${crit[0] === 'cards' ? '<div class="tiny muted">Programmes différents : le nombre de cartes est là pour info, il ne fait pas gagner.</div>' : ''}
      <div class="card"><h2>Comment on gagne des points</h2>
        <div class="small muted">Ton objectif = ce qu'Anki te donne chaque jour. Faire plus de cartes que l'autre ne rapporte rien en soi : c'est <b>ta</b> journée bien faite qui compte.</div>
        <div class="grid g2" style="gap:8px">${rule("jusqu'à 10", 'la part de ta journée faite (+3 si tu dépasses)')}${rule('+3', "régularité : fini hier et aujourd'hui")}${rule('+3', 'zéro carte en retard')}${rule('+2', "rétention d'au moins 85 %")}</div></div>
      <div class="grid g2">
        ${best('Meilleure journée', gr.best_day ? fmt(gr.best_day[1].cards) + ' cartes' : '—', gr.best_day ? `${esc(gr.best_day[0])} · ${frDate(gr.best_day[1].day)}` : '')}
        ${best('Plus longue série', gr.longest_streak && gr.longest_streak[1] ? `${gr.longest_streak[1]} jours` : '—', gr.longest_streak && gr.longest_streak[1] ? esc(gr.longest_streak[0]) : '')}</div>`;
  }

  function bindRanking() {
    document.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { sortBy = b.dataset.sort; render(); }; });
  }

  // ---------------------------------------------------------------- Activité
  function eventText(e) {
    const p = e.payload || {};
    switch (e.kind) {
      case 'joined': return 'a rejoint le groupe 👋';
      case 'goal': return `a fini sa journée : <b>${fmt(p.cards)}</b> cartes ✅`;
      case 'record': return `a battu son record : <b>${fmt(p.cards)}</b> cartes en une journée 🏅`;
      case 'streak': return `est à <b>${p.days} jours</b> de série 🔥`;
      case 'encourage': return `encourage <b>${esc(e.to || '?')}</b> à finir sa journée 💪`;
      case 'msg': return `<span class="bubble">${esc(p.text || ((S.messages || []).find((m) => m.code === p.code) || { text: '…' }).text)}</span>`;
      case 'challenge': return `lance ${p.solo ? 'un défi perso' : 'un défi'} : <b>${esc(challengeTitle(p))}</b> ${TYPE_ICON[p.type] || '🎯'}`;
      case 'bet': return `propose un pari de <b>${p.stake} pts</b> à <b>${pseudo(p.opponent)}</b> 💰`;
      case 'pomo': return `lance un pomodoro (${p.work} min × ${p.rounds}) 🍅`;
      default: return esc(e.kind);
    }
  }

  let draft = '';
  function messagesCard() {
    const left = S.messages_left == null ? 30 : S.messages_left;
    return `<div class="card"><h2>Messages</h2>
      <form class="chat" id="chat-form"><textarea id="chat-text" rows="1" maxlength="${S.message_max || 300}" placeholder="Écris ce que tu veux…" ${left ? '' : 'disabled'}>${esc(draft)}</textarea>
        <button class="btn primary small" id="chat-send" ${left ? '' : 'disabled'}>Envoyer</button></form>
      <div class="tiny muted" style="margin:2px 0 8px">Entrée pour envoyer · Maj + Entrée pour aller à la ligne${left < 20 ? ` · encore ${left} aujourd'hui` : ''}</div>
      <div class="chips">${(S.messages || []).map((m) => `<button class="chip" data-msg="${m.code}" ${left ? '' : 'disabled'}>${esc(m.text)}</button>`).join('')}</div></div>`;
  }

  function momentText(m) {
    if (m.type === 'challenge') {
      const t = `${TYPE_ICON[m.challenge]} <b>${esc(challengeTitle({ ...m, type: m.challenge }))}</b>`;
      if (m.challenge === 'boss') return m.status === 'won' ? `${t} : vaincu ensemble ! 🎉` : `${t} : le boss a survécu`;
      if (m.challenge === 'race') return m.winners.length ? `${t} : <b>${m.winners.map(pseudo).join(' et ')}</b> gagne la course 🏁` : `${t} : personne n'a fini la course`;
      return m.winners.length ? `${t} : réussi par <b>${m.winners.map(pseudo).join(', ')}</b> ✅` : `${t} : raté cette fois`;
    }
    if (m.type === 'bet') return m.winner ? `💰 Pari : <b>${pseudo(m.winner)}</b> gagne ${m.stake} pts` : '💰 Pari : égalité, personne ne perd';
    if (m.type === 'duel') return `⚔️ Duel de la semaine gagné par <b>${pseudo(m.winner)}</b> (${Object.entries(m.scores).map(([id, v]) => `${pseudo(id)} ${v}`).join(' – ')})`;
    if (m.type === 'season') return `🥇 <b>${pseudo(m.winner)}</b> : ${esc(m.label)}`;
    return '';
  }

  function resultsCard() {
    const ms = (G() && G().moments) || [];
    if (!ms.length) return '';
    return `<div class="card"><h2>Résultats <span class="right">défis, paris, duels, saisons</span></h2>
      ${ms.slice(0, 6).map((m) => `<div class="small result"><span class="tiny muted">${frDate(m.day)}</span> ${momentText(m)}</div>`).join('')}</div>`;
  }

  function screenFeed() {
    if (!S.feed.length) return messagesCard() + resultsCard() + '<div class="card muted">Rien pour l\'instant. Les journées finies, records, séries, défis et messages apparaîtront ici.</div>';
    return messagesCard() + resultsCard() + `<div class="card list">${S.feed.map((e) => {
      const p = player(e.user_id);
      return `<div class="feed-item"><div class="dot sm" style="background:${p ? color(p) : 'var(--card2)'}">${esc(e.who.avatar)}</div><div style="flex:1;min-width:0">
      <div><b>${esc(e.who.pseudo)}</b> ${eventText(e)} <span class="tiny muted">· ${ago(e.at)}</span></div>
      <div class="react">${S.emojis.map((em) => { const n = (e.reactions[em] || []).length; const on = e.my_reactions.includes(em);
        return `<button class="${on ? 'on' : ''}" data-react="${e.id}" data-emoji="${em}" title="${esc((e.reactions[em] || []).join(', '))}">${em}${n ? ' ' + n : ''}</button>`; }).join('')}</div>
      </div></div>`;
    }).join('')}</div>`;
  }

  function bindFeed() {
    document.querySelectorAll('[data-msg]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; const r = await api('send_message', { code: b.dataset.msg }); if (r.ok) toast('💬 Message envoyé'); };
    });
    const box = $('#chat-text'), form = $('#chat-form');
    if (box && form) {
      const grow = () => { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 120) + 'px'; };
      grow();
      box.oninput = () => { draft = box.value; grow(); };
      box.onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); } };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (!box.value.trim()) return;
        $('#chat-send').disabled = true;
        const text = box.value;
        draft = '';
        box.blur();
        const r = await api('send_message', { text });
        if (r.ok) toast('💬 Message envoyé'); else { draft = text; render(); }
        const again = $('#chat-text'); if (again) again.focus();
      };
    }
    document.querySelectorAll('[data-react]').forEach((b) => {
      b.onclick = () => api('react', { event_id: parseInt(b.dataset.react, 10), emoji: b.dataset.emoji, on: !b.classList.contains('on') });
    });
  }

  // ---------------------------------------------------------------- Stats
  function chartSvg(chart) {
    const W = 640, H = 200, L = 34, B = 22, T = 10;
    const n = chart.days.length;
    const max = 150;
    const x = (i) => L + (i * (W - L - 10)) / Math.max(1, n - 1);
    const y = (v) => T + (H - T - B) * (1 - Math.min(v, max) / max);
    const grid = [0, 50, 100, 150].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 100 ? '#4a5785' : '#222a44'}" stroke-dasharray="${v === 100 ? '4 3' : ''}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v} %</text>`).join('');
    const labels = [0, Math.floor(n / 2), n - 1].map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${frDate(chart.days[i])}</text>`).join('');
    const col = (s) => color(player(s.id));
    const lines = chart.series.map((s) => `<polyline fill="none" stroke="${col(s)}" stroke-width="2.2" stroke-linejoin="round" points="${s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"><title>${esc(s.pseudo)}</title></polyline>`).join('');
    const legend = chart.series.map((s) => `<span class="tiny" style="margin-right:14px"><span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${col(s)};vertical-align:middle"></span> ${esc(s.pseudo)}</span>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${grid}${labels}${lines}</svg><div>${legend}</div>`;
  }

  function screenStats() {
    const v = S.view;
    if (!v) return '<div class="card muted">Chargement…</div>';
    const heat = v.heatmap.map((c) => {
      let cls = 'hc';
      if (c.future) cls += ' future';
      else if (c.total && c.done === c.total) cls += ' all';
      else if (c.done >= 2) cls += ' l2';
      else if (c.done === 1) cls += ' l1';
      return `<div class="${cls}" title="${c.day} : ${c.done}/${c.total} journée finie"></div>`;
    }).join('');
    const recs = players().map((p) => `<div class="rank-row">${dot(p, 'sm')}<div class="body"><div>${name({ ...p, live: false })}</div>
      <div class="tiny muted">meilleure journée ${p.records.best_day ? `<b>${fmt(p.records.best_day.cards)}</b> (${frDate(p.records.best_day.day)})` : '—'}
      · meilleure semaine ${p.records.best_week ? `<b>${fmt(p.records.best_week.cards)}</b>` : '—'} · plus longue série <b>${p.records.longest_streak} j</b></div></div></div>`).join('');
    return `<div class="card"><h2>Les 30 derniers jours <span class="right">% de sa journée, chaque jour</span></h2>${chartSvg(v.chart)}</div>
      <div class="card"><h2>Carte de chaleur du groupe <span class="right">26 semaines</span></h2><div class="heat">${heat}</div>
        <div class="legend">journée finie par : <span class="hc"></span> personne <span class="hc l1"></span> 1 joueur <span class="hc l2"></span> plusieurs <span class="hc all"></span> tout le monde</div></div>
      <div class="card list"><h2 style="padding-top:8px">Records</h2>${recs}</div>
      ${reportCard()}${badgesCard()}`;
  }

  // ---------------------------------------------------------------- account
  function loginCard() {
    return `<div class="card"><h2>Déjà un compte ?</h2>
      ${showLogin ? `<div class="row"><input id="ac-user" placeholder="Nom d'utilisateur" aria-label="Nom d'utilisateur" autocomplete="username"><input id="ac-pass" type="password" placeholder="Mot de passe" aria-label="Mot de passe" autocomplete="current-password">
        <button class="btn primary" id="ac-login">Se connecter</button></div>`
      : '<div><button class="btn small" id="ac-show">Se connecter avec mon nom d\'utilisateur</button></div>'}</div>`;
  }

  function accountCard() {
    const a = S.account || {};
    if (a.secured) {
      return `<div class="card"><h2>Mon compte</h2><div class="small">Connecté en tant que <b>${esc(a.username)}</b> ✅ · sur un autre ordinateur, connecte-toi avec ce nom et ton mot de passe.</div></div>`;
    }
    return `<div class="card"><h2>Sécuriser mon compte <span class="right">facultatif</span></h2>
      <div class="small muted">Pour retrouver ta progression sur un autre ordinateur ou après une réinstallation. Pas de courriel.</div>
      <div class="row"><input id="ac-user" maxlength="24" placeholder="Nom d'utilisateur" aria-label="Nom d'utilisateur" autocomplete="username">
        <input id="ac-pass" type="password" placeholder="Mot de passe (8+)" aria-label="Mot de passe" autocomplete="new-password">
        <button class="btn primary" id="ac-secure">Sécuriser</button></div></div>` + loginCard();
  }

  function bindAccount() {
    const show = $('#ac-show');
    if (show) show.onclick = () => { showLogin = true; render(); };
    const creds = () => ({ username: $('#ac-user').value, password: $('#ac-pass').value });
    const sec = $('#ac-secure');
    if (sec) sec.onclick = async () => { const r = await api('secure_account', creds()); if (r.ok) toast('🔒 Compte sécurisé !'); };
    const login = $('#ac-login');
    if (login) login.onclick = async () => {
      if (S.profile && !confirm('Te connecter à ce compte ? Ce profil-ci sera remplacé sur cet ordinateur (sécurise-le d\'abord si tu veux le garder).')) return;
      const r = await api('sign_in', creds());
      if (r.ok) { showLogin = false; toast('✅ Connecté'); }
    };
  }

  // -- profile (avatar button)
  function screenProfile() {
    return levelCard() + settingsCard() + profileForm(false) + `<div class="card"><h2>Mon groupe</h2>
      <div>« ${esc(S.group.name)} » · code à donner à tes amis : <span class="code">${esc(S.group.code)}</span></div>
      <div><button class="btn small" id="g-leave">Quitter le groupe</button></div></div>` + accountCard();
  }

  const CORNER_NAME = { 'haut-gauche': 'En haut à gauche', 'bas-gauche': 'En bas à gauche', 'haut-droite': 'En haut à droite', 'bas-droite': 'En bas à droite' };
  function settingsCard() {
    const st = S.settings || {};
    const sw = (key, label, help) => `<label class="switch-row"><input type="checkbox" data-set="${key}" ${st[key] ? 'checked' : ''}>
      <span><b>${label}</b><br><span class="tiny muted">${help}</span></span></label>`;
    return `<div class="card"><h2>Réglages <span class="right">sur cet ordinateur</span></h2>
      <div class="small muted">Pendant tes révisions, dans un coin de l'écran :</div>
      ${sw('presence', 'Point « il révise »', 'un petit point quand un ami révise en même temps que toi')}
      ${sw('bubbles', 'Bulles', 'messages, encouragements, nouveaux défis, paris et pomodoros (clique dessus pour ouvrir)')}
      ${sw('pomo_pill', 'Minuteur du pomodoro', 'le temps restant quand tu es dans un pomodoro')}
      ${sw('sound', 'Son du pomodoro', 'un petit bip quand vient la pause ou la reprise')}
      <div class="row"><label for="set-corner">Coin de l'écran</label><select id="set-corner">${(S.corners || []).map((c) => `<option value="${c}" ${st.corner === c ? 'selected' : ''}>${CORNER_NAME[c] || c}</option>`).join('')}</select></div>
      <div class="tiny muted">À gauche par défaut, pour ne pas cacher ton casino.</div></div>`;
  }

  function bindSettings() {
    document.querySelectorAll('[data-set]').forEach((el) => { el.onchange = async () => { const r = await api('save_settings', { [el.dataset.set]: el.checked }); if (r.ok) toast('✅ Réglage enregistré'); }; });
    const c = $('#set-corner');
    if (c) c.onchange = async () => { const r = await api('save_settings', { corner: c.value }); if (r.ok) toast('✅ ' + CORNER_NAME[c.value]); };
  }

  function bindLeave() {
    const b = $('#g-leave');
    if (b) b.onclick = () => { if (confirm('Quitter le groupe ? Tes chiffres restent sur le serveur, tu pourras revenir avec le code.')) api('leave_group'); };
  }

  // ---------------------------------------------------------------- Défis (games.py)
  const TYPE_ICON = { custom: '🎯', zero: '🧹', race: '🏁', boss: '🐉' };
  const TYPE_NAME = { custom: 'Défi sur mesure', zero: 'Défi zéro retard', race: 'Course', boss: "Boss d'équipe" };
  const METRIC = { points: 'points', days: 'journées finies', cards: 'cartes', zero: 'jours sans retard' };
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const today = () => (S.view ? S.view.today : new Date().toISOString().slice(0, 10));
  const sunday = () => addDays(today(), (7 - new Date(today() + 'T12:00:00').getDay()) % 7);
  const span = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
  function challengeTitle(c) {
    if (c.title) return c.title;
    if (c.type === 'boss') return `Boss de ${fmt(c.target)} PV`;
    if (c.type === 'race') return `Premier à ${fmt(c.target)} points`;
    if (c.type === 'zero') return `${c.target} ${plural(c.target, 'jour', 'jours')} sans retard`;
    return `${fmt(c.target)} ${METRIC[c.metric] || ''}`;
  }
  function when(c) {
    if (c.status === 'upcoming') return `commence ${frDate(c.start)}`;
    if (c.status === 'active') return c.days_left <= 1 ? 'dernier jour !' : `encore ${c.days_left} jours · jusqu'au ${frDate(c.end)}`;
    if (c.status === 'won') return 'réussi 🎉';
    if (c.status === 'lost') return 'raté';
    return `fini le ${frDate(c.end)}`;
  }

  function walletCard() {
    const me = gp(S.me);
    if (!me) return '';
    return `<div class="card"><div class="split"><div><div class="label">Tes points multijoueur</div>
      <div class="num-big">${fmt(me.wallet)} <small class="small muted">pts</small></div></div>
      <div style="text-align:right">${levelTag(S.me)}<div class="tiny muted">${me.level.next ? `${fmt(me.level.next - me.xp)} pts avant le titre suivant` : 'titre maximum !'}</div></div></div>
      <div class="tiny muted">Tu les gagnes en faisant <b>ta</b> journée (mêmes points que le duel) et en réussissant des défis. Tout le monde commence avec 50 pts pour parier.</div></div>`;
  }

  function challengeCard(c) {
    const head = `<h2>${TYPE_ICON[c.type]} ${esc(challengeTitle(c))} <span class="right">${when(c)}</span></h2>
      <div class="tiny muted">${TYPE_NAME[c.type]}${c.solo ? ' perso' : ''} · lancé par ${pseudo(c.by)}${c.reward ? ` · +${c.reward} pts à qui réussit` : ''}${c.type === 'boss' ? ` · +${Math.round(c.target * 0.05)} pts chacun s'il tombe` : ''}${c.type === 'race' ? ` · +${Math.round(c.target * 0.2)} pts au gagnant` : ''}</div>`;
    let body = '';
    if (c.type === 'boss') {
      const pct = 100 * c.hp_left / c.target;
      body = `<div class="split"><div class="small">${c.status === 'won' ? '🐉 Vaincu !' : `<b>${fmt(c.hp_left)}</b> / ${fmt(c.target)} PV`}</div><div class="tiny muted">chaque point gagné = 1 coup</div></div>
        ${bar(pct, 'var(--boss)', 'thick')}
        <div class="row">${c.players.map((pl) => { const p = player(pl.id); return p ? `<span class="tiny">${dot(p, 'xs')} ${fmt(pl.value)} dégâts</span>` : ''; }).join('')}</div>`;
    } else {
      body = c.players.map((pl) => {
        const p = player(pl.id);
        if (!p) return '';
        const won = c.type === 'race' ? (c.winners || []).includes(pl.id) : pl.done;
        return `<div class="row" style="gap:10px;flex-wrap:nowrap">${dot(p, 'xs')}<div style="flex:1;min-width:0">${bar(100 * pl.value / c.target, color(p))}</div>
          <div class="tiny" style="min-width:86px;text-align:right">${fmt(pl.value)} / ${fmt(c.target)} ${won ? '✅' : ''}</div></div>`;
      }).join('');
    }
    const cancel = c.by === S.me && (c.status === 'upcoming' || (c.status === 'active' && c.created === today()))
      ? `<div><button class="btn small" data-cancel="${c.id}">Annuler ce défi</button></div>` : '';
    return `<div class="card ${c.type === 'boss' ? 'boss' : ''}">${head}${body}${cancel}</div>`;
  }

  function betText(b) {
    const range = b.start === b.end ? `le ${frDate(b.start)}` : `du ${frDate(b.start)} au ${frDate(b.end)}`;
    if (b.type === 'duel') return `<b>${pseudo(b.by)}</b> parie de faire plus de points que <b>${pseudo(b.opponent)}</b> ${range}`;
    return `<b>${pseudo(b.by)}</b> parie de finir sa journée chaque jour ${range} (contre <b>${pseudo(b.opponent)}</b>)`;
  }

  function betCard(b) {
    let foot = '';
    if (b.status === 'pending') {
      if (b.opponent === S.me) foot = `<div class="row"><button class="btn primary small" data-bet="${b.id}" data-yes="1">Accepter (${b.stake} pts)</button><button class="btn small" data-bet="${b.id}" data-yes="0">Refuser</button></div>`;
      else if (b.by === S.me) foot = `<div class="row"><span class="tiny muted">En attente de ${pseudo(b.opponent)}…</span><button class="btn small" data-cancel="${b.id}">Annuler</button></div>`;
      else foot = `<div class="tiny muted">En attente de ${pseudo(b.opponent)}</div>`;
    } else if (b.status === 'active' || b.status === 'settled') {
      const sc = b.score || {};
      const score = b.type === 'duel' ? `${pseudo(b.by)} ${sc[b.by] || 0} pts · ${pseudo(b.opponent)} ${sc[b.opponent] || 0} pts`
        : `${sc.done || 0} / ${sc.days || 0} journées finies`;
      const result = b.status === 'settled' ? (b.winner ? ` · 🏆 ${pseudo(b.winner)} gagne ${b.stake} pts` : ' · égalité, personne ne perd') : '';
      foot = `<div class="tiny">${score}${result}</div>`;
    } else {
      foot = `<div class="tiny muted">${{ declined: 'Refusé', canceled: 'Annulé', expired: 'Pas accepté à temps' }[b.status]}</div>`;
    }
    return `<div class="card"><h2>💰 Pari · ${b.stake} pts <span class="right">${b.status === 'active' ? 'en cours' : b.status === 'pending' ? 'proposé' : ''}</span></h2>
      <div class="small">${betText(b)}</div>${foot}</div>`;
  }

  function defaultForm(kind) {
    const n = Math.max(1, players().length);
    const f = { kind, start: today(), end: sunday() === today() ? addDays(today(), 7) : sunday(), metric: 'days', target: '', solo: false, title: '',
      betType: 'duel', opponent: (players().find((p) => !p.me) || {}).id || '', stake: 20 };
    const days = span(f.start, f.end);
    f.target = { custom: Math.max(1, days - 1), zero: Math.max(1, Math.ceil(days / 2)), race: 100, boss: n * days * 12 }[kind] || '';
    if (kind === 'bet') { f.start = addDays(today(), 1); f.end = sunday() <= f.start ? addDays(f.start, 6) : sunday(); }
    return f;
  }

  function formCard() {
    if (!form) form = defaultForm('boss');
    const f = form;
    const opt = (v, l, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
    const kinds = [['boss', "🐉 Boss d'équipe"], ['custom', '🎯 Défi sur mesure'], ['zero', '🧹 Zéro retard'], ['race', '🏁 Course'], ['bet', '💰 Pari']];
    const dates = (endToo = true) => `<div class="row"><label>Du</label><input type="date" data-f="start" value="${f.start}">${endToo ? `<span class="tiny muted">au</span><input type="date" data-f="end" value="${f.end}">` : ''}</div>`;
    const days = span(f.start, f.end);
    let fields = '', help = '';
    if (f.kind === 'boss') {
      fields = `<div class="row"><label>Points de vie</label><input type="number" data-f="target" value="${f.target}" min="50" style="width:110px">
        <button class="btn small" id="suggest">Suggérer</button></div>${dates()}`;
      help = `Chaque point que vous gagnez (journée, régularité, zéro retard, rétention) enlève 1 PV. Une bonne journée ≈ 15 pts par joueur. Suggestion : ${fmt(players().length * days * 12)} PV pour ${days} jours.`;
    } else if (f.kind === 'custom') {
      const solo = f.metric === 'cards' || f.solo;
      fields = `<div class="row"><label>Atteindre</label><input type="number" data-f="target" value="${f.target}" min="1" style="width:100px">
        <select data-f="metric">${opt('days', 'journées finies', f.metric)}${opt('points', 'points', f.metric)}${opt('cards', 'cartes (juste moi)', f.metric)}</select></div>
        ${dates()}<div class="row"><label>Pour</label><select data-f="solo" ${f.metric === 'cards' ? 'disabled' : ''}>${opt('false', 'tout le groupe', solo)}${opt('true', 'juste moi', solo)}</select></div>
        <div class="row"><label>Nom (facultatif)</label><input data-f="title" maxlength="40" value="${esc(f.title)}" placeholder="Ex. : semaine de feu"></div>`;
      help = f.metric === 'cards' ? 'Programmes différents : un objectif en cartes, c\'est seulement pour toi (pas de points à gagner).'
        : `Chacun doit atteindre l'objectif. ${f.metric === 'days' ? `Il y a ${days} jours.` : `Une bonne journée ≈ 15 pts.`}`;
    } else if (f.kind === 'zero') {
      fields = `<div class="row"><label>Jours sans retard</label><input type="number" data-f="target" value="${f.target}" min="1" max="${days}" style="width:90px"><span class="tiny muted">sur ${days} jours</span></div>${dates()}`;
      help = 'Un jour compte si tu finis ta journée et qu\'il ne reste aucune carte en retard. +3 pts par jour visé à qui réussit.';
    } else if (f.kind === 'race') {
      fields = `<div class="row"><label>Premier à</label><input type="number" data-f="target" value="${f.target}" min="20" style="width:100px"><span class="tiny muted">points</span></div>${dates(false)}`;
      help = 'Les points comptent à partir du début. Le premier qui atteint le total gagne (30 jours max).';
    } else {
      const others = players().filter((p) => !p.me);
      fields = `<div class="row"><label>Pari</label><select data-f="betType">${opt('duel', 'Je ferai plus de points que…', f.betType)}${opt('objectif', 'Je finirai ma journée chaque jour', f.betType)}</select></div>
        <div class="row"><label>${f.betType === 'duel' ? 'Contre' : 'Qui parie contre moi'}</label><select data-f="opponent">${others.map((p) => opt(p.id, esc(p.pseudo), f.opponent)).join('')}</select></div>
        <div class="row"><label>Mise</label><input type="number" data-f="stake" value="${f.stake}" min="5" max="200" style="width:90px"><span class="tiny muted">pts (tu as ${fmt((gp(S.me) || {}).wallet || 0)})</span></div>${dates()}`;
      help = "L'autre doit accepter avant le début. Le gagnant prend la mise au perdant. Égalité : personne ne perd.";
    }
    return quickCard() + `<div class="card"><h2>Nouveau défi</h2>
      <div class="chips">${kinds.map(([k, l]) => `<button class="chip ${f.kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
      ${fields}<div class="tiny muted">${help}</div>
      <div><button class="btn primary" id="launch">${f.kind === 'bet' ? 'Proposer le pari' : 'Lancer le défi'}</button></div></div>`;
  }

  // one click: ready-made défis, sized for the group
  function quick() {
    const n = Math.max(1, players().length), t = today();
    const sun = sunday() === t ? addDays(t, 7) : sunday();
    const d = span(t, sun);
    return [
      { id: 'boss', icon: '🐉', label: `Boss jusqu'à dimanche`, p: { type: 'boss', target: n * d * 12, start: t, end: sun } },
      { id: 'zero', icon: '🧹', label: 'Semaine zéro retard', p: { type: 'zero', target: Math.min(5, d), start: t, end: addDays(t, 6) } },
      { id: 'days', icon: '🎯', label: '5 journées finies en 7 jours', p: { type: 'custom', metric: 'days', target: 5, start: t, end: addDays(t, 6) } },
      { id: 'race', icon: '🏁', label: 'Course à 100 points', p: { type: 'race', target: 100, start: t } },
    ];
  }

  function quickCard() {
    return `<div class="card"><h2>Défis rapides <span class="right">un clic, tout le groupe</span></h2>
      <div class="chips">${quick().map((q) => `<button class="chip" data-quick="${q.id}">${q.icon} ${esc(q.label)}</button>`).join('')}</div></div>`;
  }

  function screenChallenges() {
    const g = G();
    if (!g || !S.view) return '<div class="card muted">Chargement…</div>';
    const live = (c) => ['active', 'upcoming'].includes(c.status) || (c.status === 'won' && c.end >= today());
    const now = g.challenges.filter(live);
    const past = g.challenges.filter((c) => !live(c)).slice(0, 6);
    const bets = g.bets.filter((b) => ['pending', 'active'].includes(b.status) || (b.status === 'settled' && b.end >= addDays(today(), -3)));
    const old = g.bets.filter((b) => !bets.includes(b)).slice(0, 5);
    return walletCard()
      + (now.length ? now.map(challengeCard).join('') : '<div class="card muted small">Aucun défi en cours. Lance un boss d\'équipe ou un défi juste en dessous 👇</div>')
      + bets.map(betCard).join('')
      + formCard()
      + (past.length || old.length ? `<details class="card"><summary>Défis et paris terminés</summary>${past.map(challengeCard).join('')}${old.map(betCard).join('')}</details>` : '');
  }

  function bindChallenges() {
    document.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { form = defaultForm(b.dataset.kind); render(); }; });
    document.querySelectorAll('[data-f]').forEach((el) => {
      const set = () => {
        const k = el.dataset.f;
        form[k] = k === 'solo' ? el.value === 'true' : el.value;
        if (k === 'metric' || k === 'betType' || ((k === 'start' || k === 'end') && form.kind === 'zero')) render();
      };
      el.oninput = set; el.onchange = set;
    });
    document.querySelectorAll('[data-quick]').forEach((b) => {
      b.onclick = async () => {
        const q = quick().find((x) => x.id === b.dataset.quick);
        if (!confirm(`Lancer « ${q.label} » pour tout le groupe ?`)) return;
        b.disabled = true;
        const r = await api('create_challenge', q.p);
        if (r.ok) toast('🚀 Défi lancé !');
      };
    });
    const sug = $('#suggest');
    if (sug) sug.onclick = () => { form.target = players().length * span(form.start, form.end) * 12; render(); };
    const go = $('#launch');
    if (go) go.onclick = async () => {
      const f = form;
      go.disabled = true;
      let r;
      if (f.kind === 'bet') r = await api('create_bet', { type: f.betType, opponent: f.opponent, stake: f.stake, start: f.start, end: f.end });
      else r = await api('create_challenge', { type: f.kind, metric: f.metric, target: f.target, start: f.start, end: f.kind === 'race' ? null : f.end,
        solo: f.metric === 'cards' || f.solo, title: f.title });
      if (r.ok) { toast(f.kind === 'bet' ? '💰 Pari proposé' : '🚀 Défi lancé !'); form = null; render(); }
    };
    document.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = () => { if (confirm('Annuler ?')) api('cancel', { ref: parseInt(b.dataset.cancel, 10) }); };
    });
    document.querySelectorAll('[data-bet]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; const r = await api('answer_bet', { ref: parseInt(b.dataset.bet, 10), accept: b.dataset.yes === '1' }); if (r.ok) toast(b.dataset.yes === '1' ? '🤝 Pari accepté' : 'Pari refusé'); };
    });
  }

  // ---------------------------------------------------------------- Pomodoro
  function pomoPhase(p, nowMs) {
    const elapsed = (nowMs - new Date(p.start).getTime()) / 1000, cycle = (p.work + p.rest) * 60;
    if (elapsed < 0) return { phase: 'work', round: 1, left: -elapsed };
    if (elapsed >= cycle * p.rounds) return { phase: 'over', round: p.rounds, left: 0 };
    const n = Math.floor(elapsed / cycle), into = elapsed - n * cycle;
    return into < p.work * 60 ? { phase: 'work', round: n + 1, left: p.work * 60 - into } : { phase: 'rest', round: n + 1, left: cycle - into };
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function pomodoroCard() {
    const g = G();
    if (!g) return '';
    const p = g.pomodoro;
    if (!p) {
      return `<div class="card"><div class="split"><div><h2>🍅 Pomodoro ensemble</h2><div class="tiny muted">Le même minuteur pour tout le groupe, même à distance.</div></div>
        <div class="row" style="flex-wrap:nowrap"><select id="pomo-kind" aria-label="Durée">
          <option value="25,5,4">25 min × 4</option><option value="50,10,2">50 min × 2</option><option value="45,15,3">45 min × 3</option></select>
        <button class="btn primary small" id="pomo-start">Lancer</button></div></div></div>`;
    }
    const ph = pomoPhase(p, Date.now());
    const inIt = p.players.includes(S.me);
    const who = p.players.map((id) => player(id)).filter(Boolean).map((x) => dot(x, 'xs')).join('');
    return `<div class="card pomo ${ph.phase}"><div class="split"><div><h2>🍅 Pomodoro de ${pseudo(p.by)}</h2>
        <div class="tiny muted" id="pomo-phase">${ph.phase === 'work' ? 'Travail' : ph.phase === 'rest' ? 'Pause' : 'Terminé'} · tour ${ph.round}/${p.rounds}</div></div>
        <div class="num-big" id="pomo-clock">${clock(ph.left)}</div></div>
      <div class="split"><div class="row" style="gap:4px">${who}</div><div class="row">
        ${inIt ? '' : `<button class="btn primary small" data-pomo-join="${p.id}">Rejoindre</button>`}
        ${p.by === S.me ? `<button class="btn small" data-pomo-stop="${p.id}">Arrêter</button>` : ''}</div></div></div>`;
  }

  function bindPomodoro() {
    const st = $('#pomo-start');
    if (st) st.onclick = async () => {
      const [work, rest, rounds] = $('#pomo-kind').value.split(',').map(Number);
      st.disabled = true;
      const r = await api('start_pomodoro', { work, rest, rounds });
      if (r.ok) toast('🍅 Pomodoro lancé : ton groupe le voit');
    };
    document.querySelectorAll('[data-pomo-join]').forEach((b) => { b.onclick = () => api('join_pomodoro', { ref: parseInt(b.dataset.pomoJoin, 10) }); });
    document.querySelectorAll('[data-pomo-stop]').forEach((b) => { b.onclick = () => { if (confirm('Arrêter le pomodoro pour tout le monde ?')) api('stop_pomodoro', { ref: parseInt(b.dataset.pomoStop, 10) }); }; });
  }

  function beep() {
    if (S.settings && S.settings.sound === false) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.08;
        o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15); });
    } catch (e) { /* no sound: fine */ }
  }

  let lastPhase = null;
  setInterval(() => {
    const p = G() && G().pomodoro;
    if (!p) { lastPhase = null; return; }
    const ph = pomoPhase(p, Date.now());
    const c = $('#pomo-clock'), l = $('#pomo-phase');
    if (c) c.textContent = clock(ph.left);
    if (l) l.textContent = `${ph.phase === 'work' ? 'Travail' : ph.phase === 'rest' ? 'Pause' : 'Terminé'} · tour ${ph.round}/${p.rounds}`;
    const key = `${p.id}:${ph.phase}:${ph.round}`;
    if (lastPhase && key !== lastPhase && p.players.includes(S.me)) {
      beep();
      toast(ph.phase === 'rest' ? `☕ Pause ! ${p.rest} min` : ph.phase === 'work' ? `📚 Au travail ! Tour ${ph.round}/${p.rounds}` : '🍅 Pomodoro terminé, bravo !');
      if (ph.phase === 'over') poll();
    }
    lastPhase = key;
  }, 1000);

  // live while the window is open: pomodoro, messages, paris
  async function poll() {
    if (!S.group || document.hidden) return;
    await ready;
    const res = await callPy('poll', {});
    if (res && res.snapshot) { S = res.snapshot; softRender(); }
  }
  setInterval(poll, 30000);

  // ---------------------------------------------------------------- Saison (Classement)
  function seasonCard() {
    const g = G();
    if (!g) return '';
    const s = g.season;
    const rows = s.ranking.map((r, i) => { const p = player(r.id); return p ? `<div class="rank-row"><div class="rank ${i === 0 ? 'first' : ''}">${i === 0 && r.points ? '👑' : i + 1}</div>${dot(p, 'sm')}
      <div class="body"><div class="split"><div>${name({ ...p, live: false })}</div><div class="num" style="font-size:15px">${fmt(r.points)} pts</div></div>
      <div class="tiny muted">${r.finished} ${plural(r.finished, 'journée finie', 'journées finies')} ce mois-ci</div></div></div>` : ''; }).join('');
    const hall = players().map((p) => ({ p, t: (gp(p.id) || {}).trophies || [] })).filter((x) => x.t.length);
    return `<div class="card list"><h2 style="padding-top:8px">Saison de ${esc(s.name)} <span class="right">encore ${s.days_left} ${plural(s.days_left, 'jour', 'jours')}</span></h2>${rows}
      <div class="tiny muted" style="padding:8px 0">À la fin du mois : 🥇🥈🥉 pour le podium, 📅 au plus régulier, 🧠 à la meilleure rétention. Le 🥇 débloque le cadre « Champion·ne ».</div></div>
      ${hall.length ? `<div class="card"><h2>Trophées</h2>${hall.map((x) => `<div class="row">${dot(x.p, 'xs')}<span class="trophies">${x.t.map((t) => `<span title="${esc(t.label)}">${t.medal}</span>`).join('')}</span></div>`).join('')}</div>` : ''}`;
  }

  // ---------------------------------------------------------------- Bilan mensuel + badges (Stats)
  function reportCard() {
    const g = G();
    if (!g || !g.months.length) return '';
    const key = g.reports[reportMonth] ? reportMonth : g.months[g.months.length - 1];
    const r = g.reports[key];
    const who = (id) => (id ? pseudo(id) : '—');
    const rows = r.players.map((x) => { const p = player(x.id); return p ? `<tr><td>${dot(p, 'xs')} ${esc(p.pseudo)}</td><td>${fmt(x.points)}</td><td>${x.finished}/${r.days}</td>
      <td>${fmt(x.cards)}</td><td>${fmt(x.minutes / 60)} h</td><td>${x.retention == null ? '—' : x.retention + ' %'}</td></tr>` : ''; }).join('');
    return `<div class="card"><h2>Bilan de ${esc(r.name)} <span class="right">${r.complete ? 'mois terminé' : 'en cours'}</span></h2>
      ${g.months.length > 1 ? `<div class="chips">${g.months.map((m) => `<button class="chip ${m === key ? 'on' : ''}" data-month="${m}">${esc(g.reports[m].name)}</button>`).join('')}</div>` : ''}
      <div class="grid g4">
        <div class="well"><div class="num">${fmt(r.cards)}</div><div class="label">cartes ensemble</div></div>
        <div class="well"><div class="num">${fmt(r.minutes / 60)} h</div><div class="label">d'étude</div></div>
        <div class="well"><div class="num">${r.all_done_days}</div><div class="label">jours tous au rendez-vous</div></div>
        <div class="well"><div class="num">${r.challenges_won}</div><div class="label">défis réussis</div></div></div>
      <div class="small">⭐ Joueur du mois : <b>${who(r.mvp)}</b> · 📅 Plus régulier : <b>${who(r.most_regular)}</b> · 🧠 Meilleure rétention : <b>${who(r.best_retention)}</b></div>
      <table class="tbl"><thead><tr><th></th><th>Points</th><th>Jours finis</th><th>Cartes</th><th>Temps</th><th>Rétention</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function badgesCard() {
    const g = G();
    if (!g) return '';
    return `<div class="card"><h2>Badges du groupe <span class="right">gagnés ensemble</span></h2><div class="grid g2" style="gap:8px">${g.badges.map((b) => `
      <div class="well badge-cell ${b.level ? '' : 'locked'}"><div class="split"><div class="num" style="font-size:15px">${b.icon} ${esc(b.name)}</div>
        <div class="stars" aria-label="niveau ${b.level} sur ${b.tiers.length}">${'★'.repeat(b.level)}<span class="muted">${'☆'.repeat(b.tiers.length - b.level)}</span></div></div>
        <div class="tiny muted">${fmt(b.value)} ${esc(b.desc)}${b.next ? ` · prochain : ${fmt(b.next)}` : ' · niveau max !'}</div>
        ${bar(b.pct, 'var(--done)')}</div>`).join('')}</div></div>`;
  }

  function bindStats() {
    document.querySelectorAll('[data-month]').forEach((b) => { b.onclick = () => { reportMonth = b.dataset.month; render(); }; });
  }

  // ---------------------------------------------------------------- Titre, cadres, trophées (profil)
  function levelCard() {
    const me = gp(S.me);
    if (!me) return '';
    const lv = me.level;
    return `<div class="card"><div class="split"><div><div class="label">Ton titre</div><div class="num-big" style="font-size:22px">${lv.icon} ${esc(lv.title)}</div></div>
        <div style="text-align:right"><div class="num">${fmt(me.xp)} pts</div><div class="tiny muted">gagnés depuis le début du groupe</div></div></div>
      ${lv.next ? `${bar(lv.pct, 'var(--me)')}<div class="tiny muted">${fmt(lv.next - me.xp)} pts avant le titre suivant</div>` : '<div class="tiny">Titre maximum 👑</div>'}
      <div class="label">Cadre de ton avatar</div>
      <div class="chips">${me.frames.map((f) => `<button class="chip frame-chip ${f.id === me.frame ? 'on' : ''}" data-frame="${f.id}" ${f.open ? '' : 'disabled'}
        title="${f.open ? '' : f.need ? `Débloqué à ${fmt(f.need)} pts` : 'Gagne une saison'}"><span class="dot xs frame-${f.id}" style="background:var(--me)">${esc(S.profile.avatar)}</span> ${esc(f.name)}${f.open ? '' : ' 🔒'}</button>`).join('')}</div>
      ${me.trophies.length ? `<div class="label">Tes trophées</div><div>${me.trophies.map((t) => `<div class="small">${t.medal} ${esc(t.label)}</div>`).join('')}</div>` : '<div class="tiny muted">Pas encore de trophée : ils arrivent à la fin de chaque saison (mois).</div>'}</div>`;
  }

  function bindFrames() {
    document.querySelectorAll('[data-frame]').forEach((b) => { b.onclick = async () => { const r = await api('set_frame', { frame: b.dataset.frame }); if (r.ok) toast('🖼️ Cadre changé'); }; });
  }

  if (S.open_tab) tab = S.open_tab;
  render();
  ready.then(() => { if (!S.last_sync) api('refresh'); if (tab === 'activite') callPy('feed_seen', {}); });
})();
