/* Anki Multijoueur - the group window. Renders the snapshot from api.py;
 * talks to Python through QWebChannel inside Anki, or to tools/dev_server.py
 * over HTTP in a normal browser.
 * Screens: Accueil (duel, today, points, together) · Classement · Stats ·
 * Activité, and the profile behind the avatar button. */
(function () {
  'use strict';

  let S = window.MJ_BOOT || {};
  let tab = 'accueil';
  let draftAvatar = null;
  let sortBy = 'points';
  let showLogin = false;

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

  window.MJ = { update(snap) { S = snap; render(); } };

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
  const dot = (p, cls = '') => `<div class="dot ${cls}" style="background:${color(p)}">${esc(p.avatar)}</div>`;
  const name = (p) => `<b>${esc(p.pseudo)}</b>${p.me ? ' <span class="tiny muted">(toi)</span>' : ''}${p.live ? ' <span class="live">· en train d\'étudier</span>' : ''}`;
  const bar = (pct, col, cls = '') => `<div class="bar ${cls}"><div style="width:${Math.max(0, Math.min(100, pct))}%;background:${col}"></div></div>`;
  function ring(p) {
    const C = 213.6, pct = Math.min(100, p.today_pct);
    return `<div class="ring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="34" fill="none" stroke="var(--line)" stroke-width="7"/>
      <circle cx="42" cy="42" r="34" fill="none" stroke="${color(p)}" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 42 42)"/></svg>
      <div class="face">${esc(p.avatar)}</div></div>`;
  }

  // ---------------------------------------------------------------- frame
  function render() {
    const app = $('#app');
    const top = header() + (S.error ? `<div class="err">⚠️ ${esc(S.error)}</div>` : '') + updateBanner();
    if (!S.profile) { app.innerHTML = top + profileForm(true) + loginCard(); bindProfile(); bindAccount(); return; }
    if (!S.group) { app.innerHTML = top + groupChoice(); bindGroup(); return; }
    const tabs = [['accueil', 'Accueil'], ['classement', 'Classement'], ['stats', 'Stats'], ['activite', 'Activité']];
    const screens = { accueil: screenHome, classement: screenRanking, stats: screenStats, activite: screenFeed, profil: screenProfile };
    app.innerHTML = top + `<nav class="tabs">${tabs.map(([id, l]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}</nav>` + screens[tab]();
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    bindCommon();
    if (tab === 'accueil') bindHome();
    if (tab === 'classement') bindRanking();
    if (tab === 'activite') bindFeed();
    if (tab === 'profil') { bindProfile(); bindLeave(); bindAccount(); }
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
    return duelCard(v) + `<div class="grid g2">${[me, ...others].filter(Boolean).map(todayCard).join('')}</div>`
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
      <div class="tiny muted" style="text-align:center">L'anneau montre la journée d'aujourd'hui · les points comptent depuis lundi</div></div>`;
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
      <div class="body"><div class="split"><div>${name(p)}</div><div class="num" style="font-size:15px">${crit[3](p)}</div></div>
      ${bar(100 * crit[2](p) / top, color(p))}
      <div class="tiny muted">${p.week.points} pts · ${p.week.pct} % de sa semaine · série ${p.streak} j${p.week.retention == null ? '' : ` · rétention ${p.week.retention} %`}</div></div></div>`).join('');
    const rule = (val, text) => `<div class="well"><div class="num" style="font-size:15px;color:var(--me)">${val}</div><div class="label">${text}</div></div>`;
    const gr = v.group_records;
    const best = (label, val, who) => `<div class="card" style="gap:4px"><div class="label">${label}</div><div class="num">${val}</div><div class="tiny muted">${who}</div></div>`;
    return `<div class="chips">${CRITERIA.map((c) => `<button class="chip ${c[0] === crit[0] ? 'on' : ''}" data-sort="${c[0]}">${c[1]}</button>`).join('')}</div>
      <div class="card list">${rows}</div>
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
      default: return esc(e.kind);
    }
  }

  function screenFeed() {
    if (!S.feed.length) return '<div class="card muted">Rien pour l\'instant. Les journées finies, records, séries et encouragements apparaîtront ici.</div>';
    return `<div class="card list">${S.feed.map((e) => {
      const p = player(e.user_id);
      return `<div class="feed-item"><div class="dot sm" style="background:${p ? color(p) : 'var(--card2)'}">${esc(e.who.avatar)}</div><div style="flex:1;min-width:0">
      <div><b>${esc(e.who.pseudo)}</b> ${eventText(e)} <span class="tiny muted">· ${ago(e.at)}</span></div>
      <div class="react">${S.emojis.map((em) => { const n = (e.reactions[em] || []).length; const on = e.my_reactions.includes(em);
        return `<button class="${on ? 'on' : ''}" data-react="${e.id}" data-emoji="${em}" title="${esc((e.reactions[em] || []).join(', '))}">${em}${n ? ' ' + n : ''}</button>`; }).join('')}</div>
      </div></div>`;
    }).join('')}</div>`;
  }

  function bindFeed() {
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
      <div class="card list"><h2 style="padding-top:8px">Records</h2>${recs}</div>`;
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
    return profileForm(false) + `<div class="card"><h2>Mon groupe</h2>
      <div>« ${esc(S.group.name)} » · code à donner à tes amis : <span class="code">${esc(S.group.code)}</span></div>
      <div><button class="btn small" id="g-leave">Quitter le groupe</button></div></div>` + accountCard();
  }

  function bindLeave() {
    const b = $('#g-leave');
    if (b) b.onclick = () => { if (confirm('Quitter le groupe ? Tes chiffres restent sur le serveur, tu pourras revenir avec le code.')) api('leave_group'); };
  }

  render();
  ready.then(() => { if (!S.last_sync) api('refresh'); });
})();
