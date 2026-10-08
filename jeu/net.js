/* Arène — le réseau. Un « canal » Supabase Realtime par salle (messages diffusés, rien n'est
   enregistré dans la base). Avec ?local dans l'adresse, les onglets d'un même navigateur se
   parlent entre eux (pour tester sans Internet). */
(function (root) {
'use strict';

const SUPABASE_URL = 'https://fohgoubpaklcqgrkroaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aMBcEMvlge76m49-6Pisfg_clqiXTQK'; // clé publique (comme dans le plugin)

class Net {
  constructor(room, onMsg, onStatus) {
    this.room = room; this.onMsg = onMsg; this.onStatus = onStatus || (() => {});
    this.ch = null; this.bc = null; this.ok = false;
  }
  connect() {
    if (/[?&]local\b/.test(location.search) || !root.supabase) {
      if (!root.BroadcastChannel) { this.onStatus('error'); return; }
      this.bc = new BroadcastChannel('arene-' + this.room);
      this.bc.onmessage = e => this.onMsg(e.data.ev, e.data.d);
      this.ok = true; this.onStatus('ok');
      return;
    }
    if (!Net.client) {
      Net.client = root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 40 } },
      });
    }
    this.ch = Net.client.channel('arene-' + this.room, { config: { broadcast: { self: false, ack: false } } });
    for (const ev of ['h', 'i', 's', 'x']) this.ch.on('broadcast', { event: ev }, m => this.onMsg(ev, m.payload));
    this.ch.subscribe(status => {
      this.ok = status === 'SUBSCRIBED';
      this.onStatus(this.ok ? 'ok' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'wait');
    });
  }
  send(ev, d) {
    if (!this.ok) return;
    if (this.bc) this.bc.postMessage({ ev, d });
    else this.ch.send({ type: 'broadcast', event: ev, payload: d });
  }
  close() {
    if (this.bc) this.bc.close();
    if (this.ch) Net.client.removeChannel(this.ch);
    this.ok = false;
  }
}
root.Net = Net;
})(this);
