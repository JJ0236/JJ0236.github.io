// Networking over Trystero: WebRTC between browsers, introduced to each other
// through public Nostr relays. Nothing here runs on a server of ours.
//
// Two kinds of room:
//   lobby   one shared room where hosts announce their games
//   game    one room per game, named by its players, optionally passworded.
//           The password encrypts the WebRTC handshake, so a peer with the
//           wrong one never connects at all.

const LIB = 'https://cdn.jsdelivr.net/npm/trystero@0.25.4/+esm';
const APP = 'joshhicks.info/games/tanks/v1';
const AD_EVERY = 4000;
const AD_TTL = 13000;
// Public relays rate-limit and drop out routinely; Trystero uses the others.
const QUIET = { warnOnRelayFailure: false };

let libPromise = null;
export function lib() {
  if (!libPromise) libPromise = import(LIB);
  return libPromise;
}

export const roomKey = name => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The open-games list. Every visitor joins; hosts of public games announce
 * themselves every few seconds and answer anyone who arrives.
 */
export async function openLobby(onChange) {
  const T = await lib();
  const room = T.joinRoom({ appId: APP, relayConfig: QUIET }, 'open-games', {
    onJoinError: () => {},
  });
  const adAct = room.makeAction('ad');
  const askAct = room.makeAction('ask');
  const ads = new Map();          // peerId -> { ad, at }
  let mine = null;
  let timer = null;

  const emit = () => {
    const now = Date.now();
    for (const [k, v] of ads) if (now - v.at > AD_TTL) ads.delete(k);
    onChange([...ads.entries()].map(([peer, v]) => ({ peer, ...v.ad })));
  };

  adAct.onMessage = (ad, { peerId }) => {
    if (!ad || typeof ad.n !== 'string') return;
    if (ad.gone) ads.delete(peerId);
    else ads.set(peerId, { ad: clean(ad), at: Date.now() });
    emit();
  };
  askAct.onMessage = (_, { peerId }) => {
    if (mine) adAct.send(mine, { target: peerId });
  };
  room.onPeerJoin = peerId => askAct.send(1, { target: peerId });
  room.onPeerLeave = peerId => { ads.delete(peerId); emit(); };

  const sweep = setInterval(emit, 3000);

  return {
    advertise(ad) {
      const had = mine;
      mine = ad ? clean(ad) : null;
      clearInterval(timer);
      if (mine) {
        adAct.send(mine);
        timer = setInterval(() => mine && adAct.send(mine), AD_EVERY);
      } else if (had) {
        adAct.send({ n: had.n, gone: true });
      }
    },
    peers() { return Object.keys(room.getPeers()).length; },
    relays() {
      try { return Object.values(T.getRelaySockets()).filter(s => s.readyState === 1).length; } catch { return null; }
    },
    leave() { clearInterval(timer); clearInterval(sweep); room.leave(); },
  };
}

function clean(ad) {
  return {
    n: String(ad.n).slice(0, 24),
    h: String(ad.h || '').slice(0, 16),
    l: !!ad.l,
    c: Math.max(0, Math.min(8, ad.c | 0)),
    x: Math.max(0, Math.min(8, ad.x | 0)),
    m: ad.m === 'teams' ? 'teams' : 'ffa',
    s: ad.s === 'match' ? 'match' : 'lobby',
    gone: !!ad.gone,
  };
}

/**
 * Join (or create) a game room.
 * handlers: { onMessage(type, data, peerId), onPeerJoin(peerId), onPeerLeave(peerId), onError(kind) }
 */
export async function openGame(name, password, handlers) {
  const T = await lib();
  const cfg = { appId: APP, relayConfig: QUIET };
  if (password) cfg.password = password;
  const room = T.joinRoom(cfg, 'game:' + roomKey(name), {
    onJoinError: details => handlers.onError && handlers.onError('password', details),
  });
  const act = room.makeAction('m');
  act.onMessage = (msg, { peerId }) => {
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') return;
    handlers.onMessage(msg[0], msg[1], peerId);
  };
  room.onPeerJoin = peerId => handlers.onPeerJoin && handlers.onPeerJoin(peerId);
  room.onPeerLeave = peerId => handlers.onPeerLeave && handlers.onPeerLeave(peerId);
  return {
    selfId: T.selfId,
    send(type, data, target) {
      act.send([type, data], target ? { target } : undefined).catch(() => {});
    },
    peers() { return Object.keys(room.getPeers()); },
    leave() { try { room.leave(); } catch { /* already gone */ } },
  };
}
