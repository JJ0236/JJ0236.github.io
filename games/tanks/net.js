// Networking over public MQTT brokers, reached by secure WebSocket. That
// works from almost any network (campus Wi-Fi, hotspots, offices) because it
// is ordinary HTTPS-port traffic, where direct browser-to-browser WebRTC
// often is not. Nothing here runs on a server of ours.
//
//   ads/<hash of room name>   retained: one per open room, so the list is
//                             there the moment you subscribe. The broker
//                             clears it (last will) if the host vanishes.
//   g/<hash of name+password> the game itself. Every message is AES-GCM
//                             encrypted with a key from the room password.
//
// Every message goes to two brokers at once and duplicates are dropped, so
// the game carries on if one broker is slow or down.

const MQTT_LIB = 'https://cdn.jsdelivr.net/npm/mqtt@5.16.0/dist/mqtt.esm.js';
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const ROOT = 'joshhicks-info/tanks/v2';
const AD_EVERY = 10000;     // host refreshes its listing
const AD_TTL = 35000;       // a listing not refreshed for this long is gone
const AD_MAX_AGE = 90000;   // retained listings older than this are stale
const PING_EVERY = 3000;
const PEER_TTL = 10000;

const te = new TextEncoder();
const td = new TextDecoder();

let libP = null;
const lib = () => (libP ||= import(MQTT_LIB).then(m => m.default || m));

export const roomKey = name => name.trim().toLowerCase().replace(/\s+/g, ' ');
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => (b % 36).toString(36)).join('');

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', te.encode(s));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password, key) {
  const base = await crypto.subtle.importKey('raw', te.encode(password || '(open room)'), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te.encode(ROOT + '|' + key), iterations: 60000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function seal(aes, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

async function open(aes, bytes) {
  const iv = bytes.slice(0, 12), ct = bytes.slice(12);
  return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct)));
}

/** Connections to every broker, used as one. */
async function connect({ will } = {}) {
  const mqtt = await lib();
  const id = newId();
  const handlers = new Set();
  const clients = BROKERS.map((url, i) => {
    const c = mqtt.connect(url, {
      clientId: `jht_${id}_${i}`,
      clean: true,
      keepalive: 20,
      connectTimeout: 8000,
      reconnectPeriod: 2500,
      will: will ? { ...will, qos: 1 } : undefined,
    });
    c.on('message', (topic, payload) => { for (const h of handlers) h(topic, payload); });
    c.on('error', () => {});
    return c;
  });
  const up = () => clients.filter(c => c.connected).length;

  // Ready as soon as one broker answers; give up if none does.
  await new Promise((resolve, reject) => {
    let failed = 0;
    for (const c of clients) {
      c.once('connect', resolve);
      c.once('close', () => { if (++failed === clients.length && !up()) reject(new Error('offline')); });
    }
    setTimeout(() => (up() ? resolve() : reject(new Error('offline'))), 9000);
  });

  return {
    up,
    total: clients.length,
    publish(topic, payload, opts = {}) {
      for (const c of clients) if (c.connected) c.publish(topic, payload, { qos: opts.qos || 0, retain: !!opts.retain });
    },
    subscribe(topic) {
      return Promise.all(clients.map(c => new Promise(r => {
        // A broker that connects later subscribes when it does.
        const sub = () => c.subscribe(topic, { qos: 0 }, () => r());
        if (c.connected) sub(); else { c.once('connect', sub); setTimeout(r, 3000); }
      })));
    },
    onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    emit(topic, payload) { for (const h of handlers) h(topic, payload); },
    close() { for (const c of clients) c.end(false); },
  };
}

// ── Open-games list ────────────────────────────────────────

export async function openLobby(onChange) {
  const link = await connect();
  const ads = new Map();   // topic -> { ad, at }
  const prefix = ROOT + '/ads/';

  const emit = () => {
    const now = Date.now();
    for (const [k, v] of ads) if (now - v.at > AD_TTL) ads.delete(k);
    onChange([...ads.values()].map(v => v.ad));
  };

  link.onMessage((topic, payload) => {
    if (!topic.startsWith(prefix)) return;
    if (!payload.length) { ads.delete(topic); return emit(); }
    let ad;
    try { ad = JSON.parse(td.decode(payload)); } catch { return; }
    if (!ad || !ad.listed || typeof ad.n !== 'string' || Math.abs(Date.now() - (ad.ts || 0)) > AD_MAX_AGE) {
      ads.delete(topic);
      return emit();
    }
    ads.set(topic, { ad: cleanAd(ad), at: Date.now() });
    emit();
  });
  await link.subscribe(prefix + '+');
  const sweep = setInterval(emit, 4000);

  return {
    relays: () => link.up(),
    total: link.total,
    leave() { clearInterval(sweep); link.close(); },
  };
}

function cleanAd(ad) {
  return {
    n: String(ad.n).slice(0, 24),
    h: String(ad.h || '').slice(0, 16),
    l: !!ad.l,
    c: Math.max(0, Math.min(8, ad.c | 0)),
    x: Math.max(0, Math.min(8, ad.x | 0)),
    m: ad.m === 'teams' ? 'teams' : 'ffa',
    s: ad.s === 'match' ? 'match' : 'lobby',
  };
}

/** Read a room's retained listing, if it has one. */
async function readAd(link, topic) {
  return new Promise(resolve => {
    let done = false;
    const stop = link.onMessage((t, payload) => {
      if (t !== topic || done || !payload.length) return;
      try {
        const ad = JSON.parse(td.decode(payload));
        if (Math.abs(Date.now() - (ad.ts || 0)) <= AD_MAX_AGE) { done = true; stop(); resolve(ad); }
      } catch { /* not ours */ }
    });
    link.subscribe(topic).then(() => setTimeout(() => { if (!done) { done = true; stop(); resolve(null); } }, 1500));
  });
}

// ── A game room ────────────────────────────────────────────

/**
 * Create (host: true) or join a room. Rejects with Error('taken'),
 * Error('missing') or Error('password') before anything is sent.
 *
 * handlers: { onMessage(type, data, peerId), onPeerJoin(peerId), onPeerLeave(peerId) }
 */
export async function openGame(name, password, handlers, { host = false } = {}) {
  const key = roomKey(name);
  const [nameHash, gameHash, chk, aes] = await Promise.all([
    sha(ROOT + '|name|' + key).then(h => h.slice(0, 24)),
    sha(ROOT + '|game|' + key + '|' + password).then(h => h.slice(0, 24)),
    sha(ROOT + '|check|' + key + '|' + password).then(h => h.slice(0, 16)),
    deriveKey(password, key),
  ]);
  const adTopic = `${ROOT}/ads/${nameHash}`;
  const gTopic = `${ROOT}/g/${gameHash}`;
  const selfId = newId();

  // A host's listing is cleared by the broker if its connection drops.
  const link = await connect({ will: host ? { topic: adTopic, payload: '', retain: true } : undefined });

  const existing = await readAd(link, adTopic);
  if (host && existing) { link.close(); throw new Error('taken'); }
  if (!host) {
    if (!existing) { link.close(); throw new Error('missing'); }
    if (existing.chk !== chk) { link.close(); throw new Error('password'); }
  }

  const peers = new Map();       // peerId -> last heard
  const seen = new Set();
  const seenOrder = [];
  let n = 0;
  let closed = false;
  let ad = null;

  const send = async (type, data, target) => {
    if (closed) return;
    const payload = await seal(aes, { f: selfId, i: ++n, t: type, d: data });
    const control = type !== 'snap' && type !== 'in';
    link.publish(target ? `${gTopic}/to/${target}` : `${gTopic}/all`, payload, { qos: control ? 1 : 0 });
  };

  link.onMessage(async (topic, payload) => {
    if (closed || !topic.startsWith(gTopic + '/')) return;
    // Test hook: simulate a slow, jittery network (set from the console).
    const lag = globalThis.__tanksLag;
    if (lag && !payload.__late) {
      const late = payload.slice(); late.__late = true;
      setTimeout(() => link.emit(topic, late), lag.base + Math.random() * lag.jitter);
      return;
    }
    if (topic !== `${gTopic}/all` && topic !== `${gTopic}/to/${selfId}`) return;
    let m;
    try { m = await open(aes, payload); } catch { return; }
    if (!m || m.f === selfId || typeof m.t !== 'string') return;
    const tag = m.f + ':' + m.i;
    if (seen.has(tag)) return;       // the same message via the other broker
    seen.add(tag); seenOrder.push(tag);
    if (seenOrder.length > 4000) seen.delete(seenOrder.shift());

    const fresh = !peers.has(m.f);
    peers.set(m.f, Date.now());
    if (m.t === '_bye') {
      if (!fresh) { peers.delete(m.f); handlers.onPeerLeave && handlers.onPeerLeave(m.f); }
      else peers.delete(m.f);
      return;
    }
    if (fresh) {
      handlers.onPeerJoin && handlers.onPeerJoin(m.f);
      // Introduce ourselves to someone new, so they know we are here too.
      if (m.t === '_hi') send('_hey', 0, m.f);
    }
    if (m.t[0] === '_') return;
    handlers.onMessage(m.t, m.d, m.f);
  });

  await Promise.all([link.subscribe(`${gTopic}/all`), link.subscribe(`${gTopic}/to/${selfId}`)]);
  send('_hi', 0);

  const ping = setInterval(() => {
    send('_ping', 0);
    const now = Date.now();
    for (const [p, at] of peers) {
      if (now - at > PEER_TTL) { peers.delete(p); handlers.onPeerLeave && handlers.onPeerLeave(p); }
    }
  }, PING_EVERY);

  const publishAd = () => {
    if (!ad || closed) return;
    const body = { v: 2, listed: !!ad.listed, l: !!password, chk, ts: Date.now() };
    if (ad.listed) Object.assign(body, { n: name.trim().slice(0, 24), h: ad.h, c: ad.c, x: ad.x, m: ad.m, s: ad.s });
    link.publish(adTopic, JSON.stringify(body), { retain: true, qos: 1 });
  };
  const adTimer = host ? setInterval(publishAd, AD_EVERY) : 0;

  return {
    selfId,
    send,
    peers: () => [...peers.keys()],
    relays: () => link.up(),
    /** Host only: keep the room's listing current. */
    announce(next) {
      if (!host) return;
      ad = next;
      publishAd();
    },
    leave() {
      if (closed) return;
      send('_bye', 0);
      if (host) link.publish(adTopic, '', { retain: true, qos: 1 });
      closed = true;
      clearInterval(ping);
      clearInterval(adTimer);
      setTimeout(() => link.close(), 400);
    },
  };
}
