/* Arène — le réseau. Trois façons de se parler, essayées dans cet ordre :
   1. ?local dans l'adresse : les onglets d'un même navigateur (pour tester sans Internet) ;
   2. publié sur claude.ai (Artifact) : le « room » de claude.ai, une salle par code ;
   3. sinon (fichier ouvert sur l'ordinateur, ou site web) : Supabase Realtime, un canal par salle.
   Rien n'est enregistré : les messages passent, c'est tout. */
(function (root) {
'use strict';

const SUPABASE_URL = 'https://fohgoubpaklcqgrkroaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aMBcEMvlge76m49-6Pisfg_clqiXTQK'; // clé publique (comme dans le plugin)
const TOPICS = ['h', 'i', 's', 'x', 'e'];
const ROOM_MAX = 3800; // un message du « room » de claude.ai fait au plus 4 Kio
const enc = root.TextEncoder ? new TextEncoder() : null;
const bytes = d => { const s = JSON.stringify(d); return enc ? enc.encode(s).length : s.length * 2; };

class Net {
  constructor(room, onMsg, onStatus) {
    this.room = room; this.onMsg = onMsg; this.onStatus = onStatus || (() => {});
    this.ch = null; this.bc = null; this.r = null; this.ok = false; this.mode = '';
  }
  connect() {
    if (/[?&]local\b/.test(location.search)) return this.useLocal();
    const c = root.claude;
    const use = c && typeof c.use === 'function' ? Promise.resolve(c.use('room')).catch(() => null) : Promise.resolve(null);
    use.then(room => (room ? this.useRoom(room) : this.useSupabase()));
  }
  useLocal() {
    if (!root.BroadcastChannel) { this.onStatus('error'); return; }
    this.mode = 'local';
    this.bc = new BroadcastChannel('arene-' + this.room);
    this.bc.onmessage = e => this.onMsg(e.data.ev, e.data.d);
    this.ok = true; this.onStatus('ok');
  }
  async useRoom(room) {
    this.mode = 'room';
    try { this.r = await room.join('arene-' + this.room.toLowerCase()); }
    catch (e) { this.onStatus('error'); return; }
    if (this.closed) { this.r.leave(); return; }
    for (const ev of TOPICS) this.r.on(ev, m => { if (!m.sameTab) this.onMsg(ev, m.data); });
    this.r.onConnection(ok => { this.ok = ok; this.onStatus(ok ? 'ok' : 'wait'); });
    this.ok = this.r.connected();
  }
  useSupabase() {
    if (!root.supabase) { this.onStatus('error'); return; }
    this.mode = 'supabase';
    if (!Net.client) {
      Net.client = root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 40 } },
      });
    }
    this.ch = Net.client.channel('arene-' + this.room, { config: { broadcast: { self: false, ack: false } } });
    for (const ev of TOPICS) this.ch.on('broadcast', { event: ev }, m => this.onMsg(ev, m.payload));
    this.ch.subscribe(status => {
      this.ok = status === 'SUBSCRIBED';
      this.onStatus(this.ok ? 'ok' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'wait');
    });
  }
  send(ev, d) {
    if (!this.ok) return;
    if (this.bc) return this.bc.postMessage({ ev, d });
    if (this.ch) return this.ch.send({ type: 'broadcast', event: ev, payload: d });
    if (!this.r) return;
    if (ev === 's' && bytes(d) > ROOM_MAX) {
      // photo trop grosse : les événements partent à part, et on coupe des projectiles s'il le faut
      const E = d.E || [];
      for (let i = 0; i < E.length; i += 8) this.emit('e', { E: E.slice(i, i + 8) });
      d = Object.assign({}, d, { E: [] });
      while (bytes(d) > ROOM_MAX && d.J.length) d = Object.assign({}, d, { J: d.J.slice(0, -4) });
    }
    if (bytes(d) <= ROOM_MAX) this.emit(ev, d);
  }
  emit(ev, d) { this.r.emit(ev, d).catch(() => { /* message perdu : le suivant le remplace */ }); }
  close() {
    this.closed = true;
    if (this.bc) this.bc.close();
    if (this.ch) Net.client.removeChannel(this.ch);
    if (this.r) this.r.leave();
    this.ok = false;
  }
}
Net.TOPICS = TOPICS;
root.Net = Net;
})(this);
