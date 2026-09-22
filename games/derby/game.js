// The page: menus, rooms and the loop. Solo games and hosts run the physics
// here; guests send their input, draw what the host sends back, and run a
// small world of their own so their own car answers the keys at once.

import {
  createMatch, step, snapshot, unpackSnap, view as matchView, DT, MAX_CARS, DEFAULT_SETTINGS, PICKUPS,
  addPlayer, removePlayer, createMirror, freeMirror, mirrorSync, mirrorPlace, mirrorStep, mirrorCorrect,
} from './sim.js?v=6';
import { CLASSES, CLASS_IDS, CAR_COLOURS, PART_IDS } from './cars.js?v=6';
import { makeBrain, botInput } from './bots.js?v=6';
import { createRenderer } from './render.js?v=6';
import { openLobby, openGame } from '../shared/net.js?v=6';

const RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.20.0/dist/rapier.mjs';
const NET_ROOT = 'joshhicks-info/derby/v1';
const $ = id => document.getElementById(id);
// Bump when host and guest code stop being compatible. Browsers can hold an
// old copy for a few minutes after a deploy, so the two sides check.
const PROTOCOL = 6;
const REFRESH = 'Refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac)';
const BOT_NAMES = ['Rook', 'Bramble', 'Flint', 'Hickory', 'Sorrel', 'Tamarack'];
const INTERP_MIN = 4;
const INTERP_MAX = 24;
const SNAP_EVERY = 2;         // 30 snapshots a second over a direct channel
const RELAY_EVERY = 8;        // 7.5 a second over the relay
const EVENT_KEEP = 24;        // ticks an event is repeated in snapshots, so a lost one is not missed

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

let R = null;

// ── State ──────────────────────────────────────────────────

const S = {
  screen: 'title',
  role: null,              // 'solo' | 'host' | 'client'
  net: null,
  myId: 'me',
  hostId: null,
  roomName: '',
  password: '',
  listed: false,
  createdAt: 0,
  humans: [],              // [{ id, name, cls }]
  botCls: [],
  settings: { ...DEFAULT_SETTINGS },
  stage: 'lobby',
  roster: [],
  players: {},
  myCls: CLASSES[store.get('derby-car', '')] ? store.get('derby-car', '') : 'sedan',
  // host / solo
  m: null,
  brains: {},
  evLog: [],
  evQ: 0,
  acc: 0,
  paused: false,
  slow: 0,
  // host: per-guest input
  inQ: {}, inTop: {}, inLast: {}, ack: {}, starve: {},
  // client
  room: null,
  snaps: [],
  evq: [],
  lastQ: 0,
  offset: null,
  jit: 2,
  snapGap: 2,
  mirror: null,
  mirrorRound: 0,
  tickN: 0,
  clientAcc: 0,
  lastView: null,
  session: 0,
  // both
  spect: -1,
  lastOut: null,
  outShown: 0,
  goAt: 0,
};

const input = { up: 0, down: 0, left: 0, right: 0, hb: 0, boost: 0, flip: 0, back: 0 };
let lobby = null;
let ads = [];
let hudKey = '';
let myName = store.get('derby-name', '') || store.get('tanks-name', '') || 'Driver ' + Math.floor(10 + Math.random() * 90);

// ── Screens ────────────────────────────────────────────────

const SCREENS = ['title', 'host', 'join', 'how', 'room'];
const win = $('win');

function show(screen) {
  S.screen = screen;
  for (const id of SCREENS) $(id).hidden = id !== screen;
  $('over').hidden = true;
  $('pause').hidden = true;
  S.paused = false;
  if (screen === 'play') {
    if (document.activeElement) document.activeElement.blur();
  } else {
    for (const id of ['banner', 'countBig', 'replayTag', 'spect']) $(id).hidden = true;
    $('scores').innerHTML = '';
    hudKey = '';
    $('roundLabel').textContent = '';
    $('dash').innerHTML = '';
    if (!attract && R) newAttract();
    const first = $(screen).querySelector('input:not([type=checkbox]), .gbtn');
    if (first && screen !== 'room') setTimeout(() => first.focus(), 0);
  }
  updateChrome();
  requestAnimationFrame(() => renderer.resize());
}

function updateChrome() {
  let ctx = '';
  if (S.role === 'solo') ctx = '· solo';
  else if (S.role) ctx = '· ' + S.roomName;
  $('context').textContent = ctx;
  if (S.screen !== 'play') {
    const r = lobby ? lobby.relays() : 0;
    $('netLabel').textContent = S.role === 'host' ? `Hosting · ${S.humans.length} ${S.humans.length === 1 ? 'player' : 'players'}`
      : S.role === 'client' ? 'Connected to host'
      : lobby ? (r ? 'Online' : 'Offline: solo only') : 'Connecting…';
    $('dash').innerHTML = '<span class="muted">W S to drive · A D to steer · Space handbrake · Shift boost</span>';
  }
}

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.hidden = true), 4500);
}

// ── Menu ───────────────────────────────────────────────────

$('nameIn').value = myName;
$('nameIn').addEventListener('input', e => {
  myName = cleanName(e.target.value);
  store.set('derby-name', myName);
});

function renderAds() {
  const list = $('gameList');
  const shown = ads.slice().sort((a, b) => a.n.localeCompare(b.n));
  $('openCount').textContent = shown.length ? String(shown.length) : '';
  if (!shown.length) {
    list.innerHTML = '<p class="empty">No open games right now. Host one, or type a friend\'s room name.</p>';
    return;
  }
  const typing = list.querySelector('.pw input');
  const typingFor = typing && typing.closest('.game-row').dataset.room;
  const typed = typing && typing.value;
  list.innerHTML = '';
  for (const a of shown) {
    const row = document.createElement('div');
    row.className = 'game-row';
    row.dataset.room = a.n;
    const left = document.createElement('div');
    left.innerHTML = '<div class="nm"></div><div class="meta"></div>';
    const nm = left.querySelector('.nm');
    nm.textContent = a.n;
    if (a.l) nm.insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 10 11" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="password"><rect x="1" y="5" width="8" height="5.5" rx="1"/><path d="M3 5V3.5a2 2 0 014 0V5"/></svg>');
    left.querySelector('.meta').textContent =
      `${a.c}/${a.x} players · ${a.s === 'match' ? 'playing' : 'in the lobby'} · host ${a.h}` +
      (a.pv !== PROTOCOL ? (a.pv > PROTOCOL ? ' · newer version: refresh to join' : ' · host needs to refresh') : '');
    const btn = document.createElement('button');
    btn.className = 'gbtn small';
    btn.type = 'button';
    btn.textContent = 'Join';
    btn.disabled = a.c >= a.x || a.pv !== PROTOCOL || !R;
    const askPassword = () => {
      let pw = row.querySelector('.pw');
      if (pw) { pw.querySelector('input').focus(); return pw; }
      pw = document.createElement('div');
      pw.className = 'pw';
      pw.innerHTML = '<input type="password" placeholder="password" aria-label="Room password" /><button class="gbtn small" type="button">Go</button>';
      left.appendChild(pw);
      const go = () => startJoin(a.n, pw.querySelector('input').value);
      pw.querySelector('button').addEventListener('click', go);
      pw.querySelector('input').addEventListener('keydown', e => e.key === 'Enter' && go());
      return pw;
    };
    btn.addEventListener('click', () => {
      if (!a.l) return startJoin(a.n, '');
      askPassword().querySelector('input').focus();
    });
    row.append(left, btn);
    list.appendChild(row);
    if (a.l && typingFor === a.n) {
      const inp = askPassword().querySelector('input');
      inp.value = typed;
      inp.focus();
    }
  }
}

async function startLobby() {
  try {
    lobby = await openLobby(list => { ads = list; renderAds(); }, { root: NET_ROOT });
    const tick = () => {
      const r = lobby.relays();
      $('relayState').textContent = r ? `online · ${r} of ${lobby.total} relays` : 'reconnecting…';
      updateChrome();
    };
    tick();
    setInterval(tick, 3000);
  } catch (e) {
    console.error(e);
    $('relayState').textContent = 'offline';
    $('gameList').innerHTML = '<p class="empty">Could not reach the game relays, so online play is unavailable right now. Playing against bots still works.</p>';
    updateChrome();
  }
}

$('soloBtn').addEventListener('click', () => {
  if (!R) return;
  cancelPending();
  resetSession();
  S.role = 'solo';
  S.myId = 'me';
  S.roomName = 'Solo';
  let saved = {};
  try { saved = JSON.parse(store.get('derby-solo', '{}')) || {}; } catch { /* ignore */ }
  S.settings = { ...DEFAULT_SETTINGS, bots: 5, ...saved };
  S.humans = [{ id: 'me', name: myName, cls: S.myCls }];
  buildRoster();
  renderRoom();
  show('room');
});

$('hostBtn').addEventListener('click', () => startHost($('hostName').value, $('hostPw').value, $('hostPublic').checked));
$('hostName').addEventListener('keydown', e => e.key === 'Enter' && $('hostBtn').click());
$('joinBtn').addEventListener('click', () => startJoin($('joinName').value, $('joinPw').value));
$('joinPw').addEventListener('keydown', e => e.key === 'Enter' && $('joinBtn').click());

// ── Rooms: host ────────────────────────────────────────────

async function startHost(name, pw, listed) {
  name = name.trim();
  $('hostErr').textContent = '';
  if (!R) { $('hostErr').textContent = 'Still loading the physics engine. One moment.'; return; }
  if (!name) { $('hostErr').textContent = 'Give the room a name.'; return; }
  resetSession();
  S.role = 'host';
  S.roomName = name;
  S.password = pw;
  S.listed = listed;
  S.createdAt = Date.now();
  S.settings = { ...DEFAULT_SETTINGS, bots: 3 };
  $('hostBtn').disabled = true;
  $('hostErr').textContent = 'Opening the room…';
  const session = S.session;
  let net;
  try {
    net = await openGame(name, pw, hostHandlers(), { host: true, root: NET_ROOT });
  } catch (e) {
    if (session !== S.session) return;      // cancelled while it was opening
    $('hostErr').textContent = e.message === 'taken'
      ? 'A room with that name is already open. Pick another name.'
      : 'Could not reach the game relays. Check your connection, or play against bots.';
    $('hostBtn').disabled = false;
    S.role = null;
    return;
  }
  // Backed out (or started something else) while the room was opening.
  if (session !== S.session) { net.leave(); return; }
  S.net = net;
  $('hostErr').textContent = '';
  $('hostBtn').disabled = false;
  S.myId = S.net.selfId;
  S.hostId = S.myId;
  S.humans = [{ id: S.myId, name: myName, cls: S.myCls }];
  buildRoster();
  renderRoom();
  show('room');
  advertise();
}

function hostHandlers() {
  return {
    onPeerJoin(peer) { S.net && S.net.send('room', roomState(), peer); },
    onPeerLeave(peer) { hostDrop(peer); },
    onMessage(type, data, peer) {
      if (type === 'hello') return hostHello(peer, data);
      if (type === 'in') {
        if (!data || !Array.isArray(data.b)) return;
        const q = (S.inQ[peer] ||= []);
        for (const e of data.b) {
          if (!Array.isArray(e) || (e[0] | 0) <= (S.inTop[peer] || 0)) continue;
          q.push({ n: e[0] | 0, t: clamp(+e[1] || 0, -1, 1), s: clamp(+e[2] || 0, -1, 1), hb: e[3] ? 1 : 0, b: e[4] ? 1 : 0, f: e[5] ? 1 : 0 });
          S.inTop[peer] = e[0] | 0;
        }
        return;
      }
      if (type === 'cls') {
        const h = S.humans.find(h => h.id === peer);
        if (h && CLASSES[data]) {
          h.cls = data;
          if (S.m) { const p = S.m.players.find(p => p.id === peer); if (p) p.cls = data; }
          roomChanged();
        }
        return;
      }
      if (type === 'bye') return hostDrop(peer);
      if (type === 'room' && data && data.hostId === peer) {
        if (data.createdAt < S.createdAt || (data.createdAt === S.createdAt && peer < S.myId)) {
          leave('Someone else already has a room with that name. Pick another.');
        }
      }
    },
  };
}

function hostHello(peer, data) {
  const name = cleanName(data && data.name);
  if (!data || data.pv !== PROTOCOL) {
    S.net.send('version', { pv: PROTOCOL }, peer);
    if (!S.warned) S.warned = {};
    if (!S.warned[peer]) { S.warned[peer] = 1; toast(`${name} has an out-of-date copy of the game and needs to refresh.`); }
    return;
  }
  const cls = CLASSES[data.cls] ? data.cls : 'sedan';
  const known = S.humans.find(h => h.id === peer);
  if (known) { known.name = name; roomChanged(); return; }
  if (S.humans.length >= MAX_CARS) { S.net.send('full', 1, peer); return; }
  const h = { id: peer, name, cls };
  S.humans.push(h);
  // Mid-match: a seat from the next round, taken from a bot if need be.
  if (S.stage === 'match' && S.m) {
    addPlayer(S.m, { id: h.id, name: h.name, cls: h.cls, bot: false });
  }
  roomChanged();
  toast(`${name} joined.`);
}

function hostDrop(peer) {
  const i = S.humans.findIndex(h => h.id === peer);
  if (i < 0) return;
  const [h] = S.humans.splice(i, 1);
  delete S.inQ[peer]; delete S.inTop[peer]; delete S.inLast[peer]; delete S.ack[peer]; delete S.starve[peer];
  if (S.m) removePlayer(S.m, peer);
  roomChanged();
  toast(`${h.name} left.`);
}

function roomState() {
  return {
    pv: PROTOCOL,
    name: S.roomName,
    hostId: S.myId,
    createdAt: S.createdAt,
    locked: !!S.password,
    listed: S.listed,
    stage: S.stage,
    settings: S.settings,
    roster: S.stage === 'match' && S.m ? S.m.players.map(p => ({ id: p.id, name: p.name, cls: p.cls, bot: p.bot, color: p.color })) : S.roster,
  };
}

function roomChanged() {
  if (S.stage === 'lobby') buildRoster();
  refreshPlayers();
  if (S.screen === 'room') renderRoom();
  if (S.role === 'host' && S.net) S.net.send('room', roomState());
  advertise();
}

function advertise() {
  if (S.role !== 'host' || !S.net) return;
  S.net.announce({ listed: S.listed, h: myName, pv: PROTOCOL, c: S.humans.length, x: MAX_CARS, m: 'ffa', s: S.stage });
  updateChrome();
}

/** Humans first, then bots in the seats left over. */
function buildRoster() {
  const humans = S.humans.slice(0, MAX_CARS);
  const nb = Math.max(0, Math.min(S.settings.bots, MAX_CARS - humans.length));
  while (S.botCls.length < MAX_CARS) S.botCls.push(CLASS_IDS[(Math.random() * CLASS_IDS.length) | 0]);
  const bots = BOT_NAMES.slice(0, nb).map((name, i) => ({ id: 'bot' + (i + 1), name, cls: S.botCls[i], bot: true }));
  S.roster = [...humans, ...bots].map((p, i) => ({ id: p.id, name: p.name, cls: p.cls, bot: !!p.bot, color: CAR_COLOURS[i % CAR_COLOURS.length] }));
  refreshPlayers();
}

function refreshPlayers() {
  const list = S.role === 'client'
    ? (S.room ? S.room.roster : [])
    : (S.stage === 'match' && S.m ? S.m.players : S.roster);
  S.players = Object.fromEntries(list.map(p => [p.id, p]));
}

// ── Rooms: client ──────────────────────────────────────────

let helloAt = 0;
function sayHello() {
  const now = performance.now();
  if (!S.net || !S.hostId || now - helloAt < 1500) return;
  helloAt = now;
  S.net.send('hello', { name: myName, pv: PROTOCOL, cls: S.myCls }, S.hostId);
}

async function startJoin(name, pw) {
  name = name.trim();
  $('joinErr').textContent = '';
  if (!R) { $('joinErr').textContent = 'Still loading the physics engine. One moment.'; return; }
  if (!name) { $('joinErr').textContent = 'Type the room name.'; return; }
  resetSession();
  S.role = 'client';
  S.roomName = name;
  S.password = pw;
  if (S.screen !== 'join') show('join');
  $('joinErr').textContent = 'Looking for the room…';
  $('joinBtn').disabled = true;
  const session = S.session;
  let net;
  try {
    net = await openGame(name, pw, clientHandlers(), { root: NET_ROOT });
  } catch (e) {
    if (session !== S.session) return;
    const why = {
      missing: `No open room called "${name}". Check the spelling, or ask the host whether it is still open.`,
      password: 'That password does not match the room.',
    }[e.message] || 'Could not reach the game relays. Check your connection.';
    $('joinErr').textContent = why;
    $('joinBtn').disabled = false;
    S.role = null;
    return;
  }
  if (session !== S.session) { net.leave(); return; }
  S.net = net;
  S.myId = S.net.selfId;
  const retry = setInterval(() => {
    if (session !== S.session || S.role !== 'client' || !S.net) return clearInterval(retry);
    if (S.room && S.room.roster.some(p => p.id === S.myId)) return clearInterval(retry);
    sayHello();
  }, 2000);
  S.joinTimer = setTimeout(() => {
    if (session === S.session && !S.hostId) leave(`The room "${name}" is listed but its host is not answering. It may have just closed.`, 'joinErr');
  }, 12000);
}

function clientHandlers() {
  return {
    onPeerJoin(peer) { S.net && S.net.send('hello', { name: myName, pv: PROTOCOL, cls: S.myCls }, peer); },
    onPeerLeave(peer) { if (peer === S.hostId) leave('The host left, so the game ended.'); },
    onMessage(type, data, peer, via) {
      if (type === 'version' && !S.hostId) {
        return leave(`You have an out-of-date copy of the game. ${REFRESH}, then join again.`, 'joinErr');
      }
      if (type === 'room') {
        if (!data || data.hostId !== peer) return;
        if (data.pv !== PROTOCOL) {
          const older = !(data.pv > PROTOCOL);
          return leave(older
            ? 'The host has an out-of-date copy of the game. Ask them to refresh their page, then join again.'
            : `You have an out-of-date copy of the game. ${REFRESH}, then join again.`, 'joinErr');
        }
        if (!S.hostId) {
          S.hostId = peer;
          S.net.connectDirect(peer);
          clearTimeout(S.joinTimer);
          $('joinErr').textContent = '';
          $('joinBtn').disabled = false;
          S.roomName = data.name;
        }
        if (peer !== S.hostId) return;
        const wasStage = S.room && S.room.stage;
        S.room = data;
        if (!data.roster.some(p => p.id === S.myId)) sayHello();
        S.settings = data.settings;
        S.stage = data.stage;
        refreshPlayers();
        if (data.stage === 'match') {
          if (S.screen !== 'play') { resetClientView(); renderer.resetRound(); show('play'); }
        } else {
          if (S.screen !== 'room' || wasStage === 'match') { renderer.resetRound(); show('room'); }
          renderRoom();
        }
        return;
      }
      if (peer !== S.hostId) return;
      if (type === 'snap') {
        if (via === 'relay' && S.net.isDirect(peer)) return;
        return clientSnap(data);
      }
      if (type === 'full') return leave('That room is full.', 'joinErr');
    },
  };
}

function resetClientView() {
  S.snaps = []; S.evq = []; S.lastQ = 0; S.offset = null; S.jit = 2; S.snapGap = 2;
  freeMirror(S.mirror); S.mirror = null; S.mirrorRound = 0;
  S.lastView = null; S.spect = -1; S.lastOut = null;
}

const myIdxIn = v => v ? v.cars.findIndex(c => c.id === S.myId) : -1;

function clientSnap(data) {
  if (!data || !Array.isArray(data.c) || !Array.isArray(data.p)) return;
  const v = unpackSnap(data);
  v.wins = data.wn || {};
  v.kills = data.kl || {};
  const now = performance.now();
  const prev = S.snaps[S.snaps.length - 1];
  if (data.mid !== S.snapMid) {
    // A new match (a rematch restarts the host's clock).
    if (S.snapMid !== undefined) resetClientView();
    S.snapMid = data.mid;
  } else if (prev && v.tick <= prev.tick) return;   // late or duplicate
  // Clock: follow the earliest-arriving snapshots and measure how late the
  // rest are, so the picture is drawn just far enough behind to stay smooth.
  const sample = v.tick - now * 0.06;
  if (S.offset === null || Math.abs(sample - S.offset) > 60) { S.offset = sample; S.jit = 2; }
  else if (sample > S.offset) S.offset = sample;
  else { S.jit = S.jit * 0.9 + (S.offset - sample) * 0.1; S.offset += (sample - S.offset) * 0.01; }
  if (prev) S.snapGap = S.snapGap * 0.8 + Math.min(30, v.tick - prev.tick) * 0.2;
  S.snaps.push(v);
  if (S.snaps.length > 40) S.snaps.shift();

  for (const [q, k, e] of data.e || []) {
    if (q <= S.lastQ) continue;
    S.lastQ = q;
    S.evq.push({ tick: k, e });
  }
  trimEvents(300);

  // My own car: a local world for it, rebuilt each round.
  const me = myIdxIn(v);
  if (me < 0) { freeMirror(S.mirror); S.mirror = null; return; }
  if (!S.mirror || S.mirrorRound !== v.round) {
    freeMirror(S.mirror);
    const pose = c => ({ x: c.pos[0], y: c.pos[1], z: c.pos[2], q: { x: c.quat[0], y: c.quat[1], z: c.quat[2], w: c.quat[3] } });
    S.mirror = createMirror(R, v.cars[me].cls, pose(v.cars[me]), v.cars.map((c, i) => (i === me ? null : { cls: c.cls, pose: pose(c) })));
    S.mirrorRound = v.round;
  }
  mirrorSync(S.mirror, v, me);
  const ack = data.ak && data.ak[S.myId];
  if (ack && !v.cars[me].out) {
    const r = mirrorCorrect(S.mirror, v.cars[me], ack);
    const d = (S.dbg ||= { none: 0, snap: 0, blend: 0, noack: 0 });
    d[r]++;
  } else (S.dbg ||= { none: 0, snap: 0, blend: 0, noack: 0 }).noack++;
}

/** Guest: sample input at the host's tick rate, predict, and send. */
function clientTick(dt) {
  S.clientAcc = Math.min(0.25, S.clientAcc + dt);
  let sent = false;
  const latest = S.snaps[S.snaps.length - 1];
  const frozen = !latest || latest.phase === 'countdown';
  while (S.clientAcc >= DT) {
    S.clientAcc -= DT;
    const inp = localInput();
    const n = ++S.tickN;
    const h = { n, ...inp };
    (S.inHist ||= []).push(h);
    if (S.inHist.length > 60) S.inHist.shift();
    if (S.mirror && !S.mirror.me.out) {
      // Stand-ins only from a picture of the mirror's own round.
      if (S.lastView && S.lastView.round === S.mirrorRound) mirrorPlace(S.mirror, S.lastView.cars, myIdxIn(S.lastView));
      mirrorStep(S.mirror, inp, n, frozen);
    }
    if (n % (S.net && S.net.isDirect(S.hostId) ? 1 : RELAY_EVERY) === 0) sent = true;
  }
  if (sent && S.net && S.hostId) {
    const pack = h => [h.n, +h.t.toFixed(2), +h.s.toFixed(2), h.hb, h.b, h.f];
    if (!S.net.sendDirect('in', { b: S.inHist.slice(-8).map(pack) }, S.hostId)) {
      S.net.send('in', { b: S.inHist.slice(-20).map(pack) }, S.hostId);
    }
  }
}

function slerpArr(a, b, k) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const out = [0, 1, 2, 3].map(i => a[i] + (b[i] * s - a[i]) * k);
  const l = Math.hypot(...out) || 1;
  return out.map(x => x / l);
}

/** Keep the guest's queue of effects short, holding on to the newest round. */
function trimEvents(max) {
  if (S.evq.length <= max) return;
  const cut = S.evq.splice(0, S.evq.length - max);
  const round = cut.filter(x => x.e.type === 'round').pop();
  if (round && !S.evq.some(x => x.e.type === 'round')) S.evq.unshift(round);
}

function clientView(now) {
  if (!S.snaps.length) return null;
  const latest = S.snaps[S.snaps.length - 1];
  const delay = Math.max(INTERP_MIN, Math.min(INTERP_MAX, S.snapGap + 2 + S.jit * 1.5));
  const rt = now * 0.06 + S.offset - delay;
  let s0 = S.snaps[0], s1 = latest;
  for (let i = S.snaps.length - 1; i >= 0; i--) {
    if (S.snaps[i].tick <= rt) { s0 = S.snaps[i]; s1 = S.snaps[i + 1] || S.snaps[i]; break; }
  }
  if (s0.round !== s1.round) s0 = s1;
  const k = s1.tick > s0.tick ? Math.max(0, Math.min(1, (rt - s0.tick) / (s1.tick - s0.tick))) : 1;
  const lerp = (a, b) => a + (b - a) * k;
  const cars = s1.cars.map((b, i) => {
    const a = s0.cars[i] && s0.cars[i].id === b.id ? s0.cars[i] : b;
    return { ...b, pos: b.pos.map((v, j) => lerp(a.pos[j], v)), quat: slerpArr(a.quat, b.quat, k), vel: b.vel.map((v, j) => lerp(a.vel[j], v)), steer: lerp(a.steer, b.steer) };
  });
  const byId = Object.fromEntries(s0.boxes.map(b => [b.id, b]));
  const boxes = s1.boxes.map(b => {
    const a = byId[b.id] || b;
    return { ...b, pos: b.pos.map((v, j) => lerp(a.pos[j], v)), quat: slerpArr(a.quat, b.quat, k) };
  });
  // Effects, in step with the delayed picture. Back from a hidden tab, the
  // ones long past are skipped, but a new round still resets the scene.
  const released = [];
  let lastRound = null;
  while (S.evq.length && S.evq[0].tick <= rt) {
    const x = S.evq.shift();
    if (x.tick >= rt - 60) released.push(x.e);
    else if (x.e.type === 'round') lastRound = x.e;
  }
  if (lastRound && !released.some(e => e.type === 'round')) released.unshift(lastRound);
  trimEvents(200);

  // My own car comes from my own world, not the delayed picture.
  const me = cars.findIndex(c => c.id === S.myId);
  const mine = latest.cars.find(c => c.id === S.myId);
  if (me >= 0 && S.mirror && s1.round === latest.round && S.mirrorRound === latest.round && !cars[me].out && mine && !mine.out) {
    const b = S.mirror.me.body;
    const p = b.translation(), q = b.rotation(), vv = b.linvel();
    cars[me] = { ...mine, idx: me, pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], vel: [vv.x, vv.y, vv.z], steer: S.mirror.me.steer,
      susp: [0, 1, 2, 3].map(i => S.mirror.me.vc.wheelSuspensionLength(i) ?? mine.susp[i]) };
  }
  const v = {
    t: lerp(s0.t, s1.t), phase: latest.phase, round: latest.round, fallen: s1.fallen, winner: latest.winner,
    cars, boxes, pickups: s1.pickups, wins: latest.wins, kills: latest.kills,
  };
  S.lastView = v;
  return { view: v, events: released };
}

// ── Room screen ────────────────────────────────────────────

const isBoss = () => S.role === 'host' || S.role === 'solo';

function buildClassCards() {
  const box = $('classes');
  box.innerHTML = '';
  const max = { speed: 27, tough: 1.6, mass: 3600 };
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cls';
    b.dataset.cls = id;
    const bar = v => `<i><s style="width:${Math.round(v * 100)}%"></s></i>`;
    b.innerHTML = `<img class="pic" alt="" hidden><b>${c.name}</b><span>${c.note}</span><div class="bars">speed ${bar(c.maxSpeed / max.speed)} armour ${bar(c.armour / max.tough)} weight ${bar(c.mass / max.mass)}</div>`;
    b.addEventListener('click', () => pickClass(id));
    box.appendChild(b);
  }
}

/** Pictures of the cars, drawn the first time the room is opened. */
let picsDrawn = false;
function drawClassPictures() {
  if (picsDrawn) return;
  picsDrawn = true;
  for (const img of document.querySelectorAll('#classes .cls')) {
    const id = img.dataset.cls;
    try {
      const el = img.querySelector('.pic');
      el.src = renderer.thumbnail(id, CLASS_IDS.indexOf(id));
      el.hidden = false;
    } catch { /* no picture, still a card */ }
  }
}

function pickClass(id) {
  S.myCls = id;
  store.set('derby-car', id);
  if (S.role === 'client') { S.net && S.net.send('cls', id, S.hostId); }
  else {
    const h = S.humans.find(h => h.id === S.myId);
    if (h) h.cls = id;
    if (S.m) { const p = S.m.players.find(p => p.id === S.myId); if (p) p.cls = id; }
    roomChanged();
  }
  renderRoom();
}

function renderRoom() {
  drawClassPictures();
  const boss = isBoss();
  const st = S.settings;
  const roster = S.role === 'client' ? (S.room ? S.room.roster : []) : S.roster;

  $('roomTitle').textContent = S.role === 'solo' ? 'Solo' : S.roomName;
  if (S.role === 'solo') $('roomMeta').textContent = 'Practice against bots';
  else if (S.role === 'host') $('roomMeta').textContent = 'You are hosting' + (S.password ? ' · password set' : '');
  else {
    const host = roster.find(p => p.id === S.hostId);
    $('roomMeta').textContent = 'Hosted by ' + (host ? host.name : 'someone') + (S.room && S.room.locked ? ' · password set' : '');
  }
  let hint = '';
  if (S.role === 'host') {
    const how = S.password ? 'the room name and password' : 'the room name';
    hint = (S.listed ? `Listed under open games. Friends can also type ${how} to join.` : `Not listed. Friends join by typing ${how}.`)
      + ' Keep this tab in front while you host: the game runs here.';
  } else if (S.role === 'client') hint = 'Pick your car. The host starts the match.';
  else hint = 'Pick your car and the settings, then start.';
  $('roomHint').textContent = hint;

  const humans = roster.filter(p => !p.bot).length;
  $('rosterCount').textContent = `${roster.length}/${MAX_CARS}`;
  const box = $('roster');
  box.innerHTML = '';
  for (let i = 0; i < MAX_CARS; i++) {
    const p = roster[i];
    const row = document.createElement('div');
    row.className = 'slot' + (p ? '' : ' open');
    row.innerHTML = '<span class="swatch"></span><span class="nm"></span><span class="tagx"></span>';
    if (!p) {
      row.querySelector('.nm').textContent = S.role === 'solo' ? 'empty' : 'open seat';
      box.appendChild(row);
      continue;
    }
    row.querySelector('.swatch').style.background = p.color || CAR_COLOURS[i];
    row.querySelector('.nm').textContent = p.name + (p.id === S.myId ? ' (you)' : '');
    const bits = [CLASSES[p.cls] ? CLASSES[p.cls].name : ''];
    if (p.bot) bits.push(`bot · ${st.botLevel}`);
    if (S.role !== 'solo' && p.id === S.hostId) bits.push('host');
    row.querySelector('.tagx').textContent = bits.filter(Boolean).join(' · ');
    box.appendChild(row);
  }

  for (const [id, v] of [['setRounds', String(st.rounds)], ['setBots', String(st.bots)], ['setLevel', st.botLevel]]) {
    $(id).value = v;
    $(id).disabled = !boss;
  }
  [...$('setBots').options].forEach(o => (o.disabled = +o.value > MAX_CARS - (S.role === 'client' ? humans : S.humans.length)));
  $('setHazards').checked = !!st.hazards; $('setHazards').disabled = !boss;
  $('setPickups').checked = !!st.pickups; $('setPickups').disabled = !boss;
  $('classes').querySelectorAll('.cls').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cls === S.myCls)));

  $('startBtn').hidden = !boss;
  const ready = roster.length >= 2;
  $('startBtn').disabled = !ready || !R;
  $('startHint').textContent = boss ? (ready ? '' : 'You need at least two cars. Add a bot, or wait for someone to join.') : '';
}

function changeSetting(k, v) {
  if (!isBoss()) return;
  S.settings = { ...S.settings, [k]: v };
  if (S.role === 'solo') store.set('derby-solo', JSON.stringify(S.settings));
  roomChanged();
}
$('setRounds').addEventListener('change', e => changeSetting('rounds', +e.target.value));
$('setBots').addEventListener('change', e => changeSetting('bots', +e.target.value));
$('setLevel').addEventListener('change', e => changeSetting('botLevel', e.target.value));
$('setHazards').addEventListener('change', e => changeSetting('hazards', e.target.checked));
$('setPickups').addEventListener('change', e => changeSetting('pickups', e.target.checked));
$('startBtn').addEventListener('click', startMatch);
$('leaveBtn').addEventListener('click', () => leave());

// ── Match ──────────────────────────────────────────────────

function startMatch() {
  if (!isBoss() || !R) return;
  if (S.role === 'host' && !S.net) return;      // the room is still opening
  buildRoster();
  if (S.roster.length < 2) return;
  renderer.resetRound();
  freeMatch();
  S.matchId = (S.matchId || 0) + 1;
  S.m = createMatch(R, S.settings, S.roster.map(p => ({ ...p })));
  S.brains = {};
  S.roster.forEach((p, i) => { if (p.bot) S.brains[p.id] = makeBrain(S.settings.botLevel, i / MAX_CARS); });
  S.stage = 'match';
  S.acc = 0;
  S.evLog = [];
  S.slow = 0;
  S.spect = -1;
  S.lastOut = null;
  refreshPlayers();
  show('play');
  if (S.role === 'host') S.net.send('room', roomState());
  advertise();
}

/** A match's physics lives in WASM memory: it has to be freed, not dropped. */
function freeMatch() {
  if (S.m && S.m.world) { S.m.world.free(); S.m.queue.free(); }
  S.m = null;
}

function backToRoom() {
  if (!isBoss()) return;
  S.stage = 'lobby';
  freeMatch();
  renderer.resetRound();
  roomChanged();
  show('room');
}
$('rematchBtn').addEventListener('click', startMatch);
$('backBtn').addEventListener('click', backToRoom);

function hostTick() {
  const m = S.m;
  const inputs = { [S.myId]: localInput() };
  for (const [id, q] of Object.entries(S.inQ)) inputs[id] = nextGuestInput(id, q);
  for (const car of m.cars) {
    if (S.brains[car.id]) inputs[car.id] = botInput(m, car, S.brains[car.id], DT);
  }
  step(m, inputs);
  if (m.events.length) {
    for (const e of m.events) S.evLog.push([++S.evQ, m.tick, e]);
    // Drawn on the next frame. A hidden tab draws no frames, so keep only
    // the latest: the round and parts are carried in the picture anyway.
    const pend = (S.pending ||= []);
    pend.push(...m.events);
    if (pend.length > 400) {
      const cut = pend.splice(0, pend.length - 400);
      // A new round must still reach the renderer, or last round's dents stay.
      const round = cut.filter(e => e.type === 'round').pop();
      if (round && !pend.some(e => e.type === 'round')) pend.unshift(round);
    }
    m.events = [];
  }
  while (S.evLog.length && S.evLog[0][1] < m.tick - 60) S.evLog.shift();
  if (S.role !== 'host' || !S.net) return;
  const recent = () => S.evLog.filter(e => e[1] > m.tick - EVENT_KEEP);
  if (m.tick % SNAP_EVERY === 0) {
    const snap = snapshot(m);
    snap.ak = S.ack; snap.wn = m.wins; snap.kl = m.kills; snap.mid = S.matchId;
    snap.e = recent();
    S.net.sendAllDirect('snap', snap);
  }
  if (m.tick % RELAY_EVERY === 0 && S.net.relayed() > 0) {
    const snap = snapshot(m);
    snap.ak = S.ack; snap.wn = m.wins; snap.kl = m.kills; snap.mid = S.matchId;
    snap.e = S.evLog.filter(e => e[1] > m.tick - RELAY_EVERY * 3);
    S.net.send('snap', snap);
  }
}

/**
 * One guest input per tick, in order, so the host drives a guest's car
 * exactly as the guest's own screen did. Late input: hold the last one for
 * a few ticks, then ease off. Only a long stall's backlog is dropped.
 */
function nextGuestInput(id, q) {
  const last = S.inLast[id];
  if (!q.length) {
    S.starve[id] = (S.starve[id] || 0) + 1;
    if (!last) return { t: 0, s: 0, hb: 0, b: 0, f: 0 };
    return S.starve[id] < 12 ? { ...last, f: 0 } : { ...last, t: 0, b: 0, f: 0 };
  }
  S.starve[id] = 0;
  const backlog = S.net && S.net.isDirect(id) ? 24 : 40;
  while (q.length > backlog) S.ack[id] = q.shift().n;
  const inp = q.shift();
  S.inLast[id] = inp;
  S.ack[id] = inp.n;
  return inp;
}

function hostView() {
  const v = matchView(S.m);
  v.wins = S.m.wins;
  v.kills = S.m.kills;
  return v;
}

// ── Input ──────────────────────────────────────────────────

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'hb', ShiftLeft: 'boost', ShiftRight: 'boost', KeyR: 'flip', KeyC: 'back',
};

window.addEventListener('keydown', e => {
  if (S.screen !== 'play') return;
  if (e.target && e.target.tagName === 'INPUT') return;
  // A replay can be skipped once you are out or the round is over.
  if ((e.code === 'Space' || e.code === 'Enter') && renderer.replay()) {
    const v = S.lastView, me = myIdxIn(v);
    if (!v || me < 0 || v.cars[me].out || v.phase !== 'play') { renderer.stopReplay(); e.preventDefault(); return; }
  }
  if (KEYS[e.code]) { input[KEYS[e.code]] = 1; e.preventDefault(); }
  else if (e.code === 'Escape') togglePause();
  else if (e.code === 'KeyQ' || e.code === 'KeyE') cycleSpectate(e.code === 'KeyE' ? 1 : -1);
});
window.addEventListener('keyup', e => { if (KEYS[e.code]) input[KEYS[e.code]] = 0; });
window.addEventListener('blur', () => { for (const k in input) input[k] = 0; });

function localInput() {
  if (!$('pause').hidden) return { t: 0, s: 0, hb: 1, b: 0, f: 0 };
  return { t: input.up - input.down, s: input.right - input.left, hb: input.hb, b: input.boost, f: input.flip };
}

function togglePause() {
  if (!$('over').hidden) return;
  const p = $('pause');
  p.hidden = !p.hidden;
  if (S.role === 'solo') S.paused = !p.hidden;
  $('pauseTitle').textContent = S.role === 'solo' ? 'Paused' : 'Menu';
  $('pauseNote').textContent = S.role === 'solo' ? 'Esc to carry on.' : 'The match keeps going for everyone else. Esc to go back.';
}
$('resumeBtn').addEventListener('click', togglePause);
$('quitBtn').addEventListener('click', () => {
  if (S.role === 'solo') { backToRoom(); return; }
  leave();
});

function cycleSpectate(dir) {
  const v = S.lastView;
  if (!v) return;
  const alive = v.cars.filter(c => !c.out).map(c => c.idx);
  if (!alive.length) return;
  const at = alive.indexOf(S.spect);
  S.spect = alive[(at + dir + alive.length) % alive.length];
}

// ── What happens: feed, kill-cam, slow motion ──────────────

function nameOf(id) {
  if (id === S.myId) return 'You';
  const p = S.players[id];
  return p ? p.name : 'Someone';
}

function feed(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  $('feed').appendChild(el);
  setTimeout(() => el.remove(), 5000);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
}

const tagOf = (v, idx) => {
  const c = v.cars[idx];
  if (!c) return '';
  return `<span class="sw" style="background:${CAR_COLOURS[idx % CAR_COLOURS.length]}"></span>${esc(nameOf(c.id))}`;
};

function onEvents(events, v, time) {
  if (!events.length || !v) return;
  renderer.addEvents(events, v);
  const me = myIdxIn(v);
  for (const e of events) {
    if (e.type === 'round') { S.spect = -1; S.lastOut = null; S.outShown = 0; }
    if (e.type === 'go') S.goAt = time;
    if (e.type === 'wreck' || e.type === 'fell') {
      const byIdx = e.by ? v.cars.findIndex(c => c.id === e.by) : -1;
      S.lastOut = { idx: e.c, by: byIdx, time };
      const how = e.type === 'fell' ? 'went over the edge' : 'is wrecked';
      feed(byIdx >= 0 ? `${tagOf(v, byIdx)} ${e.type === 'fell' ? 'shoved' : 'wrecked'} ${tagOf(v, e.c)}${e.type === 'fell' ? ' off' : ''}` : `${tagOf(v, e.c)} ${how}`);
      if (e.c === me) {
        renderer.startReplay(me, byIdx >= 0 ? byIdx : me, 'KILL CAM', time);
        S.outShown = time;
        S.outHow = e.type;
      }
    }
    if (e.type === 'crush' && e.c === me) feed(e.by === 'press' ? 'The crusher got you' : 'A container landed on you');
    if (e.type === 'pickup' && e.c === me) feed(`${PICKUPS[e.kind].name}: ${PICKUPS[e.kind].note}`);
    if (e.type === 'roundEnd' && S.lastOut && !renderer.replay()) {
      const w = e.winner ? v.cars.findIndex(c => c.id === e.winner) : -1;
      renderer.startReplay(S.lastOut.idx, w >= 0 ? w : S.lastOut.by, 'REPLAY', time);
    }
    // Solo: only the hardest hits on or by you slow time, and not twice in a row.
    if (S.role === 'solo' && e.type === 'hit' && e.s >= 0.38 && (e.c === me || e.by === me) && time - (S.slowAt || 0) > 8) {
      S.slow = 0.6;
      S.slowAt = time;
    }
  }
}

// ── HUD ────────────────────────────────────────────────────

function damageSvg(parts) {
  const col = s => (s === 2 ? 'none' : s === 1 ? 'var(--gauge-warn)' : 'var(--chrome-ink)');
  const stroke = s => (s === 2 ? 'var(--gauge-bad)' : 'none');
  const r = (x, y, w, h, s) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${col(s)}" stroke="${stroke(s)}" stroke-width="1" opacity="${s === 0 ? 0.55 : 1}"/>`;
  const [bF, hood, bR, trunk, dL, dR, roof, wFL, wFR, wRL, wRR] = parts;
  return `<svg class="dmg" viewBox="0 0 44 24" aria-label="Damage">
    ${r(40.5, 3, 3, 18, bF)}${r(29, 5, 10.5, 14, hood)}${r(15, 5, 13, 14, roof)}${r(4, 5, 10, 14, trunk)}${r(0.5, 3, 3, 18, bR)}
    ${r(15, 1, 13, 3, dL)}${r(15, 20, 13, 3, dR)}
    ${r(31, 0, 6, 2.5, wFL)}${r(31, 21.5, 6, 2.5, wFR)}${r(6, 0, 6, 2.5, wRL)}${r(6, 21.5, 6, 2.5, wRR)}
  </svg>`;
}

function updateHud(v, time) {
  if (!v) {
    $('banner').hidden = false;
    $('bannerTitle').textContent = 'Joining';
    $('bannerSub').textContent = 'Waiting for the first picture from the host…';
    return;
  }
  const rounds = S.settings.rounds || 3;
  const pips = n => '<span class="pips">' + Array.from({ length: rounds }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + '</span>';
  let html = '';
  for (const c of v.cars) {
    html += `<span class="score${c.out ? ' out' : ''}"><span class="swatch" style="background:${CAR_COLOURS[c.idx % CAR_COLOURS.length]}"></span>${esc(c.id === S.myId ? 'You' : nameOf(c.id))} ${pips((v.wins && v.wins[c.id]) || 0)}</span>`;
  }
  if (html !== hudKey) { $('scores').innerHTML = html; hudKey = html; }
  $('roundLabel').textContent = `Round ${v.round} · first to ${rounds}`;

  const me = v.cars.find(c => c.id === S.myId);
  let d = '';
  if (!me) d = '<span class="muted">You join at the start of the next round.</span>';
  else {
    const e = Math.max(0, me.engine);
    const ec = e < 15 ? 'var(--gauge-bad)' : e < 40 ? 'var(--gauge-warn)' : 'var(--gauge-ok)';
    d += `<span class="gauge"><span class="lbl2">Engine</span><span class="meter"><i style="width:${e}%;background:${ec}"></i></span><b>${me.out ? '-' : Math.round(e) + '%'}</b></span>`;
    d += `<span class="gauge"><span class="lbl2">Speed</span><b class="spd">${me.out ? '-' : Math.round(Math.hypot(me.vel[0], me.vel[2]) * 3.6)}</b><span class="unit">km/h</span></span>`;
    d += `<span class="gauge"><span class="lbl2">Boost</span><span class="meter boost"><i style="width:${Math.round(me.boost * 100)}%"></i></span></span>`;
    d += damageSvg(me.parts);
    const buffs = [];
    if (me.armour) buffs.push('Armour');
    if (me.plough) buffs.push('Plough');
    if (buffs.length) d += `<span class="buffs">${buffs.join(' · ')}</span>`;
  }
  $('dash').innerHTML = d;

  if (S.role === 'solo') $('netLabel').textContent = `Solo · bots on ${S.settings.botLevel}`;
  else if (S.role === 'host') {
    const guests = S.humans.length - 1;
    const relayed = S.net ? S.net.relayed() : 0;
    $('netLabel').textContent = `Hosting ${S.roomName} · ${guests} ${guests === 1 ? 'guest' : 'guests'}` + (guests ? (relayed ? ` · ${relayed} via relay` : ' · all direct') : '');
  } else $('netLabel').textContent = S.net && S.net.isDirect(S.hostId) ? `${S.roomName} · direct connection` : `${S.roomName} · via relay (slower)`;

  // Countdown
  const cb = $('countBig');
  if (v.phase === 'countdown') { cb.hidden = false; cb.textContent = String(Math.max(1, Math.ceil(-v.t))); }
  else if (v.phase === 'play' && v.t < 0.8) { cb.hidden = false; cb.textContent = 'GO'; }
  else cb.hidden = true;

  // Replay tag
  const rp = renderer.replay();
  $('replayTag').hidden = !rp;
  $('replayTag').textContent = rp ? rp + (me && (me.out || v.phase !== 'play') ? ' · Space to skip' : '') : '';

  // Banner
  let title = '', sub = '';
  if (v.phase === 'countdown') { title = `Round ${v.round}`; sub = me ? `${CLASSES[me.cls].name} · last car running wins` : 'You are in from next round'; }
  else if (v.phase === 'roundEnd' || v.phase === 'matchEnd') {
    const w = v.winner ? nameOf(v.winner) : null;
    title = w ? (w === 'You' ? 'You take the round' : `${w} takes the round`) : 'Nobody left running';
    sub = w ? '' : 'A draw';
  } else if (me && me.out && !rp && time - S.outShown < 4) {
    title = me.out === 'fell' ? 'Over the edge' : 'Wrecked';
    sub = 'Q and E to watch the others';
  }
  $('banner').hidden = !title || rp === 'KILL CAM';
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;

  const spectating = me && me.out && v.phase === 'play' && !rp;
  $('spect').hidden = !(spectating || (!me && v.phase === 'play'));
  if (!$('spect').hidden) {
    const f = v.cars[followIdx(v)];
    $('spect').textContent = f ? `Watching ${nameOf(f.id)} · Q and E to switch` : '';
  }

  if (v.phase === 'matchEnd' && $('over').hidden && !rp) showStandings(v);
  // A rematch: on a guest nothing else takes the results card down.
  if (v.phase !== 'matchEnd' && !$('over').hidden) $('over').hidden = true;
}

function followIdx(v) {
  const me = myIdxIn(v);
  if (me >= 0 && (!v.cars[me].out || v.phase !== 'play')) {
    if (!v.cars[me].out) return me;
  }
  if (S.spect < 0 || !v.cars[S.spect] || v.cars[S.spect].out) {
    const alive = v.cars.find(c => !c.out);
    S.spect = alive ? alive.idx : me;
  }
  return S.spect;
}

function showStandings(v) {
  const w = v.winner ? nameOf(v.winner) : 'Nobody';
  $('overTitle').textContent = w === 'You' ? 'You win the match' : `${w} wins the match`;
  const rows = Object.values(S.players).map(p => ({
    name: p.id === S.myId ? p.name + ' (you)' : p.name,
    rounds: (v.wins && v.wins[p.id]) || 0,
    kills: (v.kills && v.kills[p.id]) || 0,
  })).sort((a, b) => b.rounds - a.rounds || b.kills - a.kills);
  const box = $('standings');
  box.innerHTML = '';
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'spec';
    el.innerHTML = '<div class="spec-head"><span class="spec-name"></span><span class="spec-dim"></span></div>';
    el.querySelector('.spec-name').textContent = r.name;
    el.querySelector('.spec-dim').textContent = `${r.rounds} ${r.rounds === 1 ? 'round' : 'rounds'} · ${r.kills} ${r.kills === 1 ? 'wreck' : 'wrecks'}`;
    box.appendChild(el);
  }
  const boss = isBoss();
  $('rematchBtn').hidden = !boss;
  $('backBtn').hidden = !boss;
  $('overNote').textContent = boss ? '' : 'Waiting for the host to pick what happens next.';
  $('over').hidden = false;
  $('pause').hidden = true;
}

// ── Leaving ────────────────────────────────────────────────

function resetSession() {
  S.session++;            // anything still opening from before now stands down
  clearTimeout(S.joinTimer);
  if (S.net) S.net.leave();
  freeMatch();
  Object.assign(S, {
    role: null, net: null, myId: 'me', hostId: null, roomName: '', password: '', listed: false,
    humans: [], stage: 'lobby', roster: [], players: {}, m: null, brains: {}, inQ: {}, inTop: {}, inLast: {}, ack: {}, starve: {},
    evLog: [], pending: [], room: null, paused: false, slow: 0, snapMid: undefined,
  });
  resetClientView();
}

function leave(msg, where) {
  resetSession();
  advertise();
  renderer.resetRound();
  $('joinBtn').disabled = false;
  $('hostBtn').disabled = false;
  show(where === 'joinErr' ? 'join' : 'title');
  if (msg) {
    if (where) $(where).textContent = msg;
    else toast(msg);
  }
}

window.addEventListener('pagehide', () => { if (S.net) S.net.leave(); });

// ── Helpers ────────────────────────────────────────────────

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function cleanName(n) { return (typeof n === 'string' ? n : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Driver'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── Loop ───────────────────────────────────────────────────

const field = $('field');
const renderer = createRenderer(field);
new ResizeObserver(() => renderer.resize()).observe(field.parentElement);

// The physics runs off a worker's clock, not the animation frame: a host
// that switches tabs must not freeze everyone else's game.
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 60);'], { type: 'text/javascript' })));
let lastSim = performance.now();
ticker.onmessage = () => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastSim) / 1000);
  lastSim = now;
  if (S.screen !== 'play' || !isBoss() || !S.m) return;
  if (S.role === 'solo' && document.hidden && !S.paused && $('over').hidden) togglePause();
  if (S.paused) return;
  let scale = 1;
  if (S.slow > 0) { S.slow -= dt; scale = 0.3; }
  S.acc += dt * scale;
  let n = 0;
  while (S.acc >= DT && n < 15) { hostTick(); S.acc -= DT; n++; }
  if (n === 15) S.acc = 0;
};

// ── Attract mode: bots behind the menus ────────────────────

let attract = null;
let attractBrains = {};
let attractAcc = 0;
let attractEvents = [];

function newAttract() {
  const ps = BOT_NAMES.map((name, i) => ({ id: 'a' + i, name, cls: CLASS_IDS[(i + (Math.random() * 4 | 0)) % 4], bot: true }));
  if (attract && attract.world) { attract.world.free(); attract.queue.free(); }
  attract = createMatch(R, { rounds: 99, hazards: true, pickups: true }, ps);
  attractBrains = Object.fromEntries(ps.map((p, i) => [p.id, makeBrain(i % 2 ? 'normal' : 'hard', i / 6)]));
  renderer.resetRound();
}

function stepAttract(dt) {
  if (!attract) return null;
  attractAcc = Math.min(0.2, attractAcc + dt);
  while (attractAcc >= DT) {
    const inputs = {};
    for (const c of attract.cars) inputs[c.id] = botInput(attract, c, attractBrains[c.id], DT);
    step(attract, inputs);
    if (attract.events.length) { attractEvents.push(...attract.events); attract.events = []; }
    attractAcc -= DT;
  }
  if (attract.round > 12) newAttract();
  return matchView(attract);
}

// ── Window: size, full screen, menu keys ───────────────────

const BARS = 76 + 4;
const FIELD_RATIO = 16 / 9;
function fit() {
  if (document.fullscreenElement) { win.style.width = win.style.height = ''; return; }
  const stage = win.parentElement;
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let w = Math.min(aw, (ah - BARS) * FIELD_RATIO);
  w = Math.max(w, Math.min(aw, 760));
  win.style.width = Math.floor(w) + 'px';
  win.style.height = Math.floor(w / FIELD_RATIO + BARS) + 'px';
}
window.addEventListener('resize', fit);
document.addEventListener('fullscreenchange', () => { fit(); requestAnimationFrame(() => renderer.resize()); });
$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (win.requestFullscreen) win.requestFullscreen().catch(() => {});
});

document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
/** Leaving the host or join screen drops a room that is still opening. */
function cancelPending() {
  if ((S.role === 'client' && !S.hostId) || (S.role === 'host' && !S.net)) resetSession();
  $('hostBtn').disabled = false;
  $('joinBtn').disabled = false;
  $('hostErr').textContent = '';
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
  cancelPending();
  show('title');
}));

window.addEventListener('keydown', e => {
  if (S.screen === 'play') return;
  if (e.key === 'Escape' && ['host', 'join', 'how'].includes(S.screen)) { cancelPending(); show('title'); return; }
  if (S.screen === 'title' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = [...document.querySelectorAll('#mainMenu .gbtn')];
    const at = items.indexOf(document.activeElement);
    const next = at < 0 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    e.preventDefault();
  }
});

let last = performance.now();
let hudT = 0;
function frame(now) {
  // Never negative: a frame's timestamp can predate a long task that ran before it.
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  if (S.screen === 'play') {
    let v = null, events = [];
    if (isBoss() && S.m) {
      v = hostView();
      events = S.pending || [];
      S.pending = [];
    } else if (S.role === 'client') {
      clientTick(dt);
      const cv = clientView(now);
      if (cv) { v = cv.view; events = cv.events; }
    }
    S.lastView = v || S.lastView;
    onEvents(events, v, time);
    const me = myIdxIn(v);
    const slowK = S.slow > 0 ? 0.3 : 1;
    renderer.draw(v, {
      dt: S.paused ? 0 : dt * slowK, time, players: S.players,
      follow: v ? followIdx(v) : -1, back: !!input.back && me >= 0 && v && !v.cars[me].out, meIdx: me,
    });
    hudT -= dt;
    if (hudT <= 0) { updateHud(v, time); hudT = 0.08; }
  } else {
    const v = R ? stepAttract(dt) : null;
    if (attractEvents.length) { renderer.addEvents(attractEvents, v); attractEvents = []; }
    renderer.draw(v, { dt, time, players: {}, follow: -1, labels: false });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook: where the host has every car (read from the console or a test).
window.__derbyDebug = () => S.m && S.m.cars.map(c => { const p = c.body.translation(); return { id: c.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), out: c.out }; });
window.__derbyStats = () => ({ ...S.dbg, hist: S.mirror && S.mirror.hist.length, tickN: S.tickN, ack: S.snaps.length });
window.__derbyInfo = () => renderer.info();
window.__derbyMine = () => { const v = S.lastView, i = myIdxIn(v); return i >= 0 ? v.cars[i] : null; };

// ── Boot ───────────────────────────────────────────────────

buildClassCards();
fit();
show('title');
for (const b of document.querySelectorAll('#mainMenu .gbtn')) b.disabled = true;
import(RAPIER_URL).then(async mod => {
  const r = mod.default || mod;
  await r.init();
  R = r;
  $('loading').textContent = '';
  for (const b of document.querySelectorAll('#mainMenu .gbtn')) b.disabled = false;
  newAttract();
  renderAds();
}).catch(err => {
  console.error(err);
  $('loading').textContent = 'The physics engine did not load. Check your connection and refresh the page.';
});
startLobby();
