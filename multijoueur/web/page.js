/* Anki Multijoueur - the group window. Renders the snapshot from api.py;
 * talks to Python through QWebChannel inside Anki, or to tools/dev_server.py
 * over HTTP in a normal browser. */
(function () {
  'use strict';

  let S = window.MJ_BOOT || {};
  let tab = 'groupe';
  let draftAvatar = null;
  let sortBy = 'pct';
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
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' '));
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
  const player = (id) => (S.view ? S.view.players.find((p) => p.id === id) : null);
  const who = (p) => `<span class="who">${esc(p.avatar)} <b>${esc(p.pseudo)}</b>${p.me ? ' <span class="tiny muted">(toi)</span>' : ''}${p.live ? ' <span class="live">● en train d\'étudier</span>' : ''}</span>`;

  // ---------------------------------------------------------------- screens
  function render() {
    const app = $('#app');
    const err = S.error ? `<div class="err">⚠️ ${esc(S.error)}</div>` : '';
    if (!S.profile) { app.innerHTML = header() + err + profileForm(true) + loginCard(); bindProfile(); bindAccount(); return; }
    if (!S.group) { app.innerHTML = header() + err + groupChoice(); bindGroup(); return; }
    const tabs = [['groupe', '🏆 Groupe'], ['activite', '💬 Activité'], ['stats', '📊 Stats'], ['profil', '👤 Profil']];
    const body = { groupe: screenGroup, activite: screenFeed, stats: screenStats, profil: screenProfile }[tab]();
    app.innerHTML = header() + err + `<div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>` + body;
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    ({ groupe: bindSort, activite: bindFeed, stats: () => {}, profil: () => { bindProfile(); bindLeave(); bindAccount(); } })[tab]();
  }

  function header() {
    const g = S.group ? `<span class="pill">👥 ${esc(S.group.name)}</span>` : '';
    const sync = S.syncing ? '⏳ synchronisation…' : (S.last_sync ? `à jour ${ago(S.last_sync)}` : '');
    return `<div class="top"><h1>👥 Anki Multijoueur</h1>${g}<span class="grow"></span>
      <span class="small muted">${sync}</span><button class="btn small" id="refresh">🔄</button></div>`;
  }

  function profileForm(first) {
    const p = S.profile || {};
    const av = draftAvatar || p.avatar || S.avatars[0];
    return `<div class="card">
      <h2>${first ? '👋 Bienvenue ! Crée ton profil' : '👤 Mon profil'}</h2>
      ${first ? '<p class="small muted">Seuls ton pseudo et tes chiffres d\'étude (cartes, minutes, rétention…) sont partagés avec ton groupe. Jamais le contenu de tes cartes.</p>' : ''}
      <div class="row"><label>Pseudo</label><input id="pf-pseudo" maxlength="24" value="${esc(p.pseudo || '')}" placeholder="Ton pseudo"></div>
      <div class="row"><label>Avatar</label><div class="avatars">${S.avatars.map((a) => `<button class="av ${a === av ? 'on' : ''}" data-av="${a}">${a}</button>`).join('')}</div></div>
      <div class="row"><label>Programme (facultatif)</label><input id="pf-program" maxlength="40" value="${esc(p.program || '')}" placeholder="Médecine, bac en biologie…"></div>
      <div class="row"><label>Objectif de cartes par jour</label><input id="pf-goal" type="number" min="10" max="5000" value="${p.daily_goal || 100}" style="width:110px">
        <span class="small muted">Les classements comparent surtout le % de <b>ton propre</b> objectif : choisis-le honnêtement.</span></div>
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
      <div class="card"><h2>➕ Créer un groupe</h2>
        <p class="small muted">Tu recevras un code à 6 caractères à donner à tes amis.</p>
        <div class="row"><input id="g-name" maxlength="40" placeholder="Nom du groupe"><button class="btn primary" id="g-create">Créer</button></div></div>
      <div class="card"><h2>🔑 Rejoindre un groupe</h2>
        <p class="small muted">Entre le code que ton ami t'a donné.</p>
        <div class="row"><input id="g-code" maxlength="6" placeholder="ABC123" style="text-transform:uppercase;width:120px"><button class="btn primary" id="g-join">Rejoindre</button></div></div></div>`;
  }

  function bindGroup() {
    $('#g-create').onclick = async () => { const r = await api('create_group', { name: $('#g-name').value }); if (r.ok) toast(`🎉 Groupe créé ! Code : ${r.code}`); };
    $('#g-join').onclick = async () => { const r = await api('join_group', { code: $('#g-code').value }); if (r.ok) toast(`🎉 Bienvenue dans « ${r.name} » !`); };
    bindCommon();
  }

  function bindCommon() {
    const r = $('#refresh');
    if (r) r.onclick = () => api('refresh');
  }

  // -- 🏆 group
  const CRITERIA = [
    ['pct', '% de son objectif', (p) => p.week.pct, (p) => p.week.pct + ' %'],
    ['validated', 'jours objectif atteint', (p) => p.week.validated, (p) => p.week.validated + '/7'],
    ['streak', 'série 🔥', (p) => p.streak, (p) => p.streak + ' j'],
    ['retention', 'rétention', (p) => p.week.retention || 0, (p) => (p.week.retention == null ? '—' : p.week.retention + ' %')],
    ['minutes', 'minutes', (p) => p.week.minutes, (p) => fmt(p.week.minutes)],
    ['new_cards', 'nouvelles cartes', (p) => p.week.new_cards, (p) => fmt(p.week.new_cards)],
    ['cards', 'cartes (pour info)', (p) => p.week.cards, (p) => fmt(p.week.cards)],
  ];

  function screenGroup() {
    const v = S.view;
    if (!v) return '<div class="card muted">Chargement du groupe…</div>';
    const crit = CRITERIA.find((c) => c[0] === sortBy) || CRITERIA[0];
    const ranked = v.players.slice().sort((a, b) => crit[2](b) - crit[2](a) || b.week.pct - a.week.pct);
    const rows = ranked.map((p, i) => `<tr class="${p.me ? 'me' : ''}"><td class="rank">${i + 1}</td><td>${who(p)}</td>
      <td class="num"><b>${crit[3](p)}</b></td>${crit[0] === 'pct' ? '' : `<td class="num muted">${p.week.pct} %</td>`}</tr>`).join('');
    const today = v.players.map((p) => `<div class="today-row"><div class="small">${who(p)} <span class="muted">${fmt(p.today_cards)}/${fmt(p.goal)}</span> ${p.today_done ? '✅' : ''}</div>
      <div class="bar ${p.today_done ? 'green' : ''}"><div style="width:${Math.min(100, p.today_pct)}%"></div></div></div>`).join('');
    let duel = '<span class="small muted">Il faut au moins 2 joueurs.</span>';
    if (v.duel) {
      const [a, b] = v.duel.map(player);
      duel = `<div class="duel"><div>${esc(a.avatar)} <b>${esc(a.pseudo)}</b><div class="big gold">${a.week.pct} %</div></div>
        <div class="vs">VS</div><div>${esc(b.avatar)} <b>${esc(b.pseudo)}</b><div class="big">${b.week.pct} %</div></div></div>`;
    }
    const weekDone = v.players.filter((p) => p.week.validated >= v.week_goal.days).length;
    return `<div class="card"><h2>☀️ Aujourd'hui</h2>${today}</div>
    <div class="grid g2 mt">
      <div class="card"><h2>⚔️ Duel <span class="right">% de son objectif depuis lundi</span></h2>${duel}</div>
      <div class="card"><h2>🤝 Ensemble</h2>
        <div class="small">Objectif de la semaine (${v.week_goal.days} jours chacun) : <b>${weekDone}/${v.players.length}</b> ${v.week_goal.done ? '🎉' : ''}</div>
        <div class="small" style="margin-top:4px">Série de groupe : <b>${v.group_streak} ${plural(v.group_streak, 'jour', 'jours')} 🔥</b> <span class="muted">(tout le monde à son objectif)</span></div></div>
    </div>
    <div class="card mt"><div class="split"><h2 style="margin:0">🏆 Classement de la semaine</h2>
      <select class="sel" id="sort">${CRITERIA.map((c) => `<option value="${c[0]}" ${c[0] === crit[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></div>
      <table>${rows}</table>
      <div class="tiny muted">Programmes différents : on compare d'abord le % de <b>son propre</b> objectif (max 150 % par jour).</div></div>`;
  }

  function bindSort() {
    const s = $('#sort');
    if (s) s.onchange = () => { sortBy = s.value; render(); };
    bindCommon();
  }

  // -- 💬 feed
  function eventText(e) {
    const p = e.payload || {};
    switch (e.kind) {
      case 'joined': return 'a rejoint le groupe 👋';
      case 'goal': return `a atteint son objectif du jour : <b>${fmt(p.cards)}</b> cartes ✅`;
      case 'record': return `a battu son record : <b>${fmt(p.cards)}</b> cartes en une journée 🏅`;
      case 'streak': return `est à <b>${p.days} jours</b> de série 🔥`;
      default: return esc(e.kind);
    }
  }

  function screenFeed() {
    if (!S.feed.length) return '<div class="card muted">Rien pour l\'instant. Les objectifs atteints, records et séries apparaîtront ici.</div>';
    return `<div class="card">${S.feed.map((e) => `<div class="feed-item"><div class="av-big">${esc(e.who.avatar)}</div><div style="flex:1">
      <div><b>${esc(e.who.pseudo)}</b> ${eventText(e)} <span class="tiny muted">· ${ago(e.at)}</span></div>
      <div class="react">${S.emojis.map((em) => { const n = (e.reactions[em] || []).length; const on = e.my_reactions.includes(em);
        return `<button class="${on ? 'on' : ''}" data-react="${e.id}" data-emoji="${em}" title="${esc((e.reactions[em] || []).join(', '))}">${em}${n ? ' ' + n : ''}</button>`; }).join('')}</div>
      </div></div>`).join('')}</div>`;
  }

  function bindFeed() {
    document.querySelectorAll('[data-react]').forEach((b) => {
      b.onclick = () => api('react', { event_id: parseInt(b.dataset.react, 10), emoji: b.dataset.emoji, on: !b.classList.contains('on') });
    });
    bindCommon();
  }

  // -- 📊 stats
  function chartSvg(chart) {
    const W = 640, H = 200, L = 34, B = 22, T = 10;
    const n = chart.days.length;
    const max = 150;
    const x = (i) => L + (i * (W - L - 10)) / Math.max(1, n - 1);
    const y = (v) => T + (H - T - B) * (1 - Math.min(v, max) / max);
    const colors = ['#7aa2ff', '#f2c45a', '#4fd18b', '#ff7b7b', '#c792ea', '#5fd3d3'];
    const grid = [0, 50, 100, 150].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 100 ? '#4a5785' : '#222c48'}" stroke-dasharray="${v === 100 ? '4 3' : ''}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v} %</text>`).join('');
    const labels = [0, Math.floor(n / 2), n - 1].map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${frDate(chart.days[i])}</text>`).join('');
    const lines = chart.series.map((s, k) => `<polyline fill="none" stroke="${colors[k % colors.length]}" stroke-width="2" stroke-linejoin="round" points="${s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"><title>${esc(s.pseudo)}</title></polyline>`).join('');
    const legend = chart.series.map((s, k) => `<span class="small" style="margin-right:12px"><span style="display:inline-block;width:12px;height:3px;background:${colors[k % colors.length]};vertical-align:middle"></span> ${esc(s.avatar)} ${esc(s.pseudo)}</span>`).join('');
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
      return `<div class="${cls}" title="${c.day} : ${c.done}/${c.total} objectif atteint"></div>`;
    }).join('');
    const recs = v.players.map((p) => `<tr class="${p.me ? 'me' : ''}"><td>${who(p)}</td>
      <td class="num">${p.records.best_day ? `${fmt(p.records.best_day.cards)} <span class="tiny muted">(${frDate(p.records.best_day.day)})</span>` : '—'}</td>
      <td class="num">${p.records.best_week ? fmt(p.records.best_week.cards) : '—'}</td>
      <td class="num">${p.records.longest_streak} j</td><td class="num">${p.streak} j</td></tr>`).join('');
    const gr = v.group_records;
    return `<div class="card"><h2>📈 Les 30 derniers jours <span class="right">% de son propre objectif chaque jour</span></h2>${chartSvg(v.chart)}</div>
      <div class="card mt"><h2>🗓️ Carte de chaleur du groupe <span class="right">26 semaines</span></h2><div class="heat">${heat}</div>
        <div class="legend">objectif atteint par : <span class="hc"></span> personne <span class="hc l1"></span> 1 joueur <span class="hc l2"></span> plusieurs <span class="hc all"></span> tout le monde</div></div>
      <div class="card mt"><h2>🏅 Records</h2>
        <table><tr><th>Joueur</th><th class="num">Meilleure journée</th><th class="num">Meilleure semaine</th><th class="num">Plus longue série</th><th class="num">Série actuelle</th></tr>${recs}</table>
        <p class="small" style="margin-bottom:0">Records du groupe : ${gr.best_day ? `meilleure journée <b>${fmt(gr.best_day[1].cards)}</b> cartes (${esc(gr.best_day[0])})` : '—'}${gr.longest_streak && gr.longest_streak[1] ? ` · plus longue série <b>${gr.longest_streak[1]} j</b> (${esc(gr.longest_streak[0])})` : ''}</p></div>`;
  }

  // -- 🔒 account
  function loginCard() {
    return `<div class="card mt"><h2>🔑 Déjà un compte ?</h2>
      ${showLogin ? `<div class="row"><input id="ac-user" placeholder="Nom d'utilisateur" autocomplete="username"><input id="ac-pass" type="password" placeholder="Mot de passe" autocomplete="current-password">
        <button class="btn primary" id="ac-login">Se connecter</button></div>`
      : '<button class="btn small" id="ac-show">Se connecter avec mon nom d\'utilisateur</button>'}</div>`;
  }

  function accountCard() {
    const a = S.account || {};
    if (a.secured) {
      return `<div class="card mt"><h2>🔒 Mon compte</h2><div class="small">Connecté en tant que <b>${esc(a.username)}</b> ✅ · sur un autre ordinateur, connecte-toi avec ce nom et ton mot de passe.</div></div>`;
    }
    return `<div class="card mt"><h2>🔒 Sécuriser mon compte <span class="right">facultatif</span></h2>
      <div class="small muted">Pour retrouver ta progression sur un autre ordinateur ou après une réinstallation. Pas de courriel.</div>
      <div class="row"><input id="ac-user" maxlength="24" placeholder="Nom d'utilisateur" autocomplete="username">
        <input id="ac-pass" type="password" placeholder="Mot de passe (8+)" autocomplete="new-password">
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

  // -- 👤 profile
  function screenProfile() {
    return profileForm(false) + accountCard() + `<div class="card mt"><h2>👥 Mon groupe</h2>
      <p>« ${esc(S.group.name)} » · code à donner à tes amis : <span class="code">${esc(S.group.code)}</span></p>
      <button class="btn small" id="g-leave">Quitter le groupe</button></div>`;
  }

  function bindLeave() {
    const b = $('#g-leave');
    if (b) b.onclick = () => { if (confirm('Quitter le groupe ? Tes chiffres restent sur le serveur, tu pourras revenir avec le code.')) api('leave_group'); };
  }

  render();
  ready.then(() => { if (!S.last_sync) api('refresh'); });
})();
