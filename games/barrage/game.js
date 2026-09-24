// The page: menus, rooms and the loop. A turn-based game is kind to a
// network: only one person is acting at a time, so the host runs the rules
// and everyone else draws what it sends and posts their own input while it
// is their turn. Nothing needs predicting.

import {
  createMatch, step, snapshot, view as matchView, DT, TURN_TIME, MAX_PLAYERS, SQUAD,
  DEFAULT_SETTINGS, TEAM_COLOURS, playerOf,
} from './sim.js?v=1';
import { WEAPONS, WEAPON_IDS } from './weapons.js?v=1';
import * as T from './terrain.js?v=1';
import { makeBrain, botInput } from './bots.js?v=1';
import { createRenderer } from './render.js?v=1';
import { openLobby, openGame } from '../shared/net.js?v=1';

const NET_ROOT = 'joshhicks-info/barrage/v1';
const $ = id => document.getElementById(id);
const PROTOCOL = 1;
const REFRESH = 'Refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac)';
const BOT_NAMES = ['Ridge', 'Ember', 'Cinder'];
const SNAP_EVERY = 6;          // 10 snapshots a second: plenty for turns
const RELAY_EVERY = 10;
const INPUT_EVERY = 3;

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

const S = {
  screen: 'title', role: null, net: null, myId: 'me', hostId: null,
  roomName: '', password: '', listed: false, createdAt: 0, session: 0,
  humans: [], settings: { ...DEFAULT_SETTINGS }, stage: 'lobby', roster: [], players: {},
  m: null, brains: {}, acc: 0, paused: false,
  craters: [], evQ: 0, evLog: [],
  inQ: {},                     // guest id -> their latest input
  view: null, craterCount: 0, lastQ: 0, snapK: 0,
  tickN: 0,
};

const input = { left: 0, right: 0, up: 0, down: 0, charge: 0, weapon: null, fire: 0 };
let lobby = null, ads = [], myName = store.get('barrage-name', '') || store.get('derby-name', '') || 'Gunner ' + Math.floor(10 + Math.random() * 90);
let hudKey = '';

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
    $('banner').hidden = true;
    $('scores').innerHTML = '';
    $('dash').innerHTML = '';
    $('clock').textContent = '';
    hudKey = '';
    const first = $(screen).querySelector('input:not([type=checkbox]), .gbtn');
    if (first && screen !== 'room') setTimeout(() => first.focus(), 0);
  }
  updateChrome();
  requestAnimationFrame(() => renderer.resize());
}

function updateChrome() {
  $('context').textContent = S.role === 'solo' ? '· solo' : S.role ? '· ' + S.roomName : '';
  if (S.screen !== 'play') {
    const r = lobby ? lobby.relays() : 0;
    $('netLabel').textContent = S.role === 'host' ? `Hosting · ${S.humans.length} ${S.humans.length === 1 ? 'player' : 'players'}`
      : S.role === 'client' ? 'Connected to host'
      : lobby ? (r ? 'Online' : 'Offline: solo only') : 'Connecting…';
    $('dash').innerHTML = '<span class="muted">A D to walk · W S to aim · hold Space to fire · 1-8 to pick a weapon</span>';
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

// ── Menu and lobby ─────────────────────────────────────────

$('nameIn').value = myName;
$('nameIn').addEventListener('input', e => { myName = cleanName(e.target.value); store.set('barrage-name', myName); });

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
    left.querySelector('.nm').textContent = a.n;
    if (a.l) left.querySelector('.nm').insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 10 11" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="password"><rect x="1" y="5" width="8" height="5.5" rx="1"/><path d="M3 5V3.5a2 2 0 014 0V5"/></svg>');
    left.querySelector('.meta').textContent = `${a.c}/${a.x} players · ${a.s === 'match' ? 'playing' : 'in the lobby'} · host ${a.h}`
      + (a.pv !== PROTOCOL ? (a.pv > PROTOCOL ? ' · newer version: refresh to join' : ' · host needs to refresh') : '');
    const btn = document.createElement('button');
    btn.className = 'gbtn small';
    btn.type = 'button';
    btn.textContent = 'Join';
    btn.disabled = a.c >= a.x || a.pv !== PROTOCOL;
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
    btn.addEventListener('click', () => (a.l ? askPassword().querySelector('input').focus() : startJoin(a.n, '')));
    row.append(left, btn);
    list.appendChild(row);
    if (a.l && typingFor === a.n) { const inp = askPassword().querySelector('input'); inp.value = typed; inp.focus(); }
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
  cancelPending();
  resetSession();
  S.role = 'solo';
  S.myId = 'me';
  S.roomName = 'Solo';
  let saved = {};
  try { saved = JSON.parse(store.get('barrage-solo', '{}')) || {}; } catch { /* ignore */ }
  S.settings = { ...DEFAULT_SETTINGS, ...saved };
  S.humans = [{ id: 'me', name: myName }];
  buildRoster();
  renderRoom();
  show('room');
});
$('hostBtn').addEventListener('click', () => startHost($('hostName').value, $('hostPw').value, $('hostPublic').checked));
$('hostName').addEventListener('keydown', e => e.key === 'Enter' && $('hostBtn').click());
$('joinBtn').addEventListener('click', () => startJoin($('joinName').value, $('joinPw').value));
$('joinPw').addEventListener('keydown', e => e.key === 'Enter' && $('joinBtn').click());

// ── Rooms ──────────────────────────────────────────────────

async function startHost(name, pw, listed) {
  name = name.trim();
  $('hostErr').textContent = '';
  if (!name) { $('hostErr').textContent = 'Give the room a name.'; return; }
  resetSession();
  S.role = 'host';
  S.roomName = name;
  S.password = pw;
  S.listed = listed;
  S.createdAt = Date.now();
  S.settings = { ...DEFAULT_SETTINGS, bots: 1 };
  const session = S.session;
  $('hostBtn').disabled = true;
  $('hostErr').textContent = 'Opening the room…';
  let net;
  try {
    net = await openGame(name, pw, hostHandlers(), { host: true, root: NET_ROOT });
  } catch (e) {
    if (session !== S.session) return;
    $('hostErr').textContent = e.message === 'taken'
      ? 'A room with that name is already open. Pick another name.'
      : 'Could not reach the game relays. Check your connection, or play against bots.';
    $('hostBtn').disabled = false;
    S.role = null;
    return;
  }
  if (session !== S.session) { net.leave(); return; }
  S.net = net;
  $('hostErr').textContent = '';
  $('hostBtn').disabled = false;
  S.myId = S.net.selfId;
  S.hostId = S.myId;
  S.humans = [{ id: S.myId, name: myName }];
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
      if (type === 'in') { S.inQ[peer] = cleanInput(data); return; }
      if (type === 'bye') return hostDrop(peer);
      if (type === 'room' && data && data.hostId === peer) {
        if (data.createdAt < S.createdAt || (data.createdAt === S.createdAt && peer < S.myId)) {
          leave('Someone else already has a room with that name. Pick another.');
        }
      }
    },
  };
}

function cleanInput(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    walk: Math.max(-1, Math.min(1, +d.walk || 0)),
    aim: Math.max(-1, Math.min(1, +d.aim || 0)),
    charge: d.charge ? 1 : 0,
    fire: d.fire ? 1 : 0,
    weapon: WEAPONS[d.weapon] ? d.weapon : null,
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
  const known = S.humans.find(h => h.id === peer);
  if (known) { known.name = name; roomChanged(); return; }
  if (S.humans.length >= MAX_PLAYERS) { S.net.send('full', 1, peer); return; }
  S.humans.push({ id: peer, name });
  roomChanged();
  toast(`${name} joined.` + (S.stage === 'match' ? ' They are in from the next match.' : ''));
}

function hostDrop(peer) {
  const i = S.humans.findIndex(h => h.id === peer);
  if (i < 0) return;
  const [h] = S.humans.splice(i, 1);
  delete S.inQ[peer];
  // Their guns stand down, and the turn moves on if it was theirs.
  if (S.m) {
    for (const u of S.m.units) if (u.owner === peer && u.alive) { u.alive = false; u.hp = 0; }
  }
  roomChanged();
  toast(`${h.name} left.`);
}

function roomState() {
  return {
    pv: PROTOCOL, name: S.roomName, hostId: S.myId, createdAt: S.createdAt,
    locked: !!S.password, listed: S.listed, stage: S.stage, settings: S.settings,
    roster: S.roster,
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
  S.net.announce({ listed: S.listed, h: myName, pv: PROTOCOL, c: S.humans.length, x: MAX_PLAYERS, m: 'ffa', s: S.stage });
  updateChrome();
}

function buildRoster() {
  const humans = S.humans.slice(0, MAX_PLAYERS);
  const nb = Math.max(0, Math.min(S.settings.bots, MAX_PLAYERS - humans.length));
  const bots = BOT_NAMES.slice(0, nb).map((name, i) => ({ id: 'bot' + (i + 1), name, bot: true }));
  S.roster = [...humans, ...bots].map((p, i) => ({ id: p.id, name: p.name, bot: !!p.bot, colour: TEAM_COLOURS[i % TEAM_COLOURS.length] }));
  refreshPlayers();
}

function refreshPlayers() {
  const list = S.role === 'client' ? (S.room ? S.room.roster : []) : S.roster;
  S.players = Object.fromEntries(list.map(p => [p.id, p]));
}

let helloAt = 0;
function sayHello() {
  const now = performance.now();
  if (!S.net || !S.hostId || now - helloAt < 1500) return;
  helloAt = now;
  S.net.send('hello', { name: myName, pv: PROTOCOL }, S.hostId);
}

async function startJoin(name, pw) {
  name = name.trim();
  $('joinErr').textContent = '';
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
    $('joinErr').textContent = {
      missing: `No open room called "${name}". Check the spelling, or ask the host whether it is still open.`,
      password: 'That password does not match the room.',
    }[e.message] || 'Could not reach the game relays. Check your connection.';
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
    onPeerJoin(peer) { S.net && S.net.send('hello', { name: myName, pv: PROTOCOL }, peer); },
    onPeerLeave(peer) { if (peer === S.hostId) leave('The host left, so the game ended.'); },
    onMessage(type, data, peer, via) {
      if (type === 'version' && !S.hostId) return leave(`You have an out-of-date copy of the game. ${REFRESH}, then join again.`, 'joinErr');
      if (type === 'room') {
        if (!data || data.hostId !== peer) return;
        if (data.pv !== PROTOCOL) {
          return leave(data.pv > PROTOCOL
            ? `You have an out-of-date copy of the game. ${REFRESH}, then join again.`
            : 'The host has an out-of-date copy of the game. Ask them to refresh their page, then join again.', 'joinErr');
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
        if (data.stage === 'match') { if (S.screen !== 'play') { resetClientView(); show('play'); } }
        else { if (S.screen !== 'room' || wasStage === 'match') show('room'); renderRoom(); }
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
  S.view = null; S.craterCount = 0; S.lastQ = 0; S.snapK = 0; S.terrainSeed = null;
}

/** A guest draws from the host's word: the map from its seed, then the holes. */
function clientSnap(data) {
  if (!data || !Array.isArray(data.units)) return;
  if (data.k < S.snapK && S.snapK - data.k < 600) return;        // an old one, overtaken
  S.snapK = data.k;
  if (data.seed !== S.terrainSeed) {
    S.terrainSeed = data.seed;
    S.craterCount = 0;
    const { mask, top } = T.generate(rngFrom(data.seed));
    renderer.setTerrain(mask, top);
  }
  for (const [q, e] of data.ev || []) {
    if (q <= S.lastQ) continue;
    S.lastQ = q;
    renderer.events([e], data);
    feedEvent(e, data);
  }
  // Now and then the host sends every crater, so a lost one heals.
  if (data.cr && data.cr.length > S.craterCount) {
    for (let i = S.craterCount; i < data.cr.length; i++) renderer.hole(data.cr[i][0], data.cr[i][1], data.cr[i][2]);
    S.craterCount = data.cr.length;
  }
  S.view = data;
}

function rngFrom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Room screen ────────────────────────────────────────────

const isBoss = () => S.role === 'host' || S.role === 'solo';

function renderRoom() {
  const boss = isBoss();
  const st = S.settings;
  const roster = S.role === 'client' ? (S.room ? S.room.roster : []) : S.roster;
  $('roomTitle').textContent = S.role === 'solo' ? 'Solo' : S.roomName;
  $('roomMeta').textContent = S.role === 'solo' ? 'Practice against bots'
    : S.role === 'host' ? 'You are hosting' + (S.password ? ' · password set' : '')
    : 'Hosted by ' + ((roster.find(p => p.id === S.hostId) || {}).name || 'someone') + (S.room && S.room.locked ? ' · password set' : '');
  $('roomHint').textContent = S.role === 'host'
    ? `${S.listed ? 'Listed under open games.' : 'Not listed.'} Friends join with the room name${S.password ? ' and password' : ''}. Keep this tab in front while you host: the game runs here.`
    : S.role === 'client' ? 'Waiting for the host to start.' : 'Pick your settings and start. Everyone gets three guns.';

  $('rosterCount').textContent = `${roster.length}/${MAX_PLAYERS}`;
  const box = $('roster');
  box.innerHTML = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = roster[i];
    const row = document.createElement('div');
    row.className = 'slot' + (p ? '' : ' open');
    row.innerHTML = '<span class="swatch"></span><span class="nm"></span><span class="tagx"></span>';
    if (!p) { row.querySelector('.nm').textContent = S.role === 'solo' ? 'empty' : 'open seat'; box.appendChild(row); continue; }
    row.querySelector('.swatch').style.background = p.colour || TEAM_COLOURS[i];
    row.querySelector('.nm').textContent = p.name + (p.id === S.myId ? ' (you)' : '');
    const bits = [`${SQUAD} guns`];
    if (p.bot) bits.push(`bot · ${st.botLevel}`);
    if (S.role !== 'solo' && p.id === S.hostId) bits.push('host');
    row.querySelector('.tagx').textContent = bits.join(' · ');
    box.appendChild(row);
  }
  for (const [id, v] of [['setRounds', String(st.rounds)], ['setBots', String(st.bots)], ['setLevel', st.botLevel]]) {
    $(id).value = v;
    $(id).disabled = !boss;
  }
  [...$('setBots').options].forEach(o => (o.disabled = +o.value > MAX_PLAYERS - (S.role === 'client' ? roster.filter(p => !p.bot).length : S.humans.length)));
  $('setCrates').checked = !!st.crates;
  $('setCrates').disabled = !boss;
  $('startBtn').hidden = !boss;
  const ready = roster.length >= 2;
  $('startBtn').disabled = !ready;
  $('startHint').textContent = boss ? (ready ? '' : 'You need at least two squads. Add a bot, or wait for someone to join.') : '';
}

function changeSetting(k, v) {
  if (!isBoss()) return;
  S.settings = { ...S.settings, [k]: v };
  if (S.role === 'solo') store.set('barrage-solo', JSON.stringify(S.settings));
  roomChanged();
}
$('setRounds').addEventListener('change', e => changeSetting('rounds', +e.target.value));
$('setBots').addEventListener('change', e => changeSetting('bots', +e.target.value));
$('setLevel').addEventListener('change', e => changeSetting('botLevel', e.target.value));
$('setCrates').addEventListener('change', e => changeSetting('crates', e.target.checked));
$('startBtn').addEventListener('click', startMatch);
$('leaveBtn').addEventListener('click', () => leave());
$('rematchBtn').addEventListener('click', startMatch);
$('backBtn').addEventListener('click', backToRoom);

// ── The match ──────────────────────────────────────────────

function startMatch() {
  if (!isBoss()) return;
  if (S.role === 'host' && !S.net) return;
  buildRoster();
  if (S.roster.length < 2) return;
  S.m = createMatch(S.settings, S.roster.map(p => ({ ...p })));
  S.brains = {};
  S.roster.forEach((p, i) => { if (p.bot) S.brains[p.id] = makeBrain(S.settings.botLevel, i / MAX_PLAYERS); });
  S.stage = 'match';
  S.acc = 0;
  S.craters = [];
  S.evLog = [];
  S.evQ = 0;
  renderer.setTerrain(S.m.mask, S.m.top);
  refreshPlayers();
  show('play');
  if (S.role === 'host') S.net.send('room', roomState());
  advertise();
  drainEvents();
}

function backToRoom() {
  if (!isBoss()) return;
  S.stage = 'lobby';
  S.m = null;
  roomChanged();
  show('room');
}

/** Events go to the renderer, the feed, and (as a host) out to the guests. */
function drainEvents() {
  const m = S.m;
  if (!m || !m.events.length) return;
  const v = matchView(m);
  renderer.events(m.events, v);
  for (const e of m.events) {
    feedEvent(e, v);
    if (e.type === 'boom') S.craters.push([e.x, e.y, e.r]);
    if (S.role === 'host') S.evLog.push([++S.evQ, e]);
  }
  while (S.evLog.length > 60) S.evLog.shift();
  m.events.length = 0;
}

function hostTick() {
  const m = S.m;
  const u = m.units[m.active];
  let inp = {};
  if (u && m.phase === 'aim') {
    const owner = u.owner;
    if (S.brains[owner]) inp = botInput(m, S.brains[owner], DT);
    else if (owner === S.myId) inp = localInput();
    else inp = S.inQ[owner] || {};
  }
  step(m, inp);
  drainEvents();
  if (S.role !== 'host' || !S.net) return;
  if (m.tick % SNAP_EVERY === 0 || m.tick % RELAY_EVERY === 0) {
    const snap = snapshot(m);
    snap.seed = m.seed;
    snap.ev = S.evLog.slice(-24);
    if (m.tick % 60 === 0) snap.cr = S.craters;
    if (m.tick % SNAP_EVERY === 0) S.net.sendAllDirect('snap', snap);
    if (m.tick % RELAY_EVERY === 0 && S.net.relayed() > 0) S.net.send('snap', snap);
  }
}

// ── Input ──────────────────────────────────────────────────

const KEYS = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down' };

window.addEventListener('keydown', e => {
  if (S.screen !== 'play') return;
  if (e.target && e.target.tagName === 'INPUT') return;
  if (KEYS[e.code]) { input[KEYS[e.code]] = 1; e.preventDefault(); return; }
  if (e.code === 'Space') { input.charge = 1; e.preventDefault(); return; }
  if (e.code === 'Escape') { togglePause(); return; }
  const n = e.code.startsWith('Digit') ? +e.code.slice(5) : 0;
  if (n >= 1 && n <= WEAPON_IDS.length) pickWeapon(WEAPON_IDS[n - 1]);
});
window.addEventListener('keyup', e => {
  if (KEYS[e.code]) input[KEYS[e.code]] = 0;
  if (e.code === 'Space' && input.charge) { input.charge = 0; input.fire = 1; }
});
window.addEventListener('blur', () => { for (const k of Object.keys(input)) if (k !== 'weapon') input[k] = 0; });

function pickWeapon(id) {
  const v = S.role === 'client' ? S.view : S.m && matchView(S.m);
  const me = v && v.units[v.active];
  if (!v || !me || me.owner !== S.myId || v.phase !== 'aim') return;
  const p = v.players.find(pp => pp.id === S.myId);
  if (!p || !(p.ammo[id] === null || p.ammo[id] > 0 || p.ammo[id] === Infinity || p.ammo[id] === undefined)) {
    if (!p || !p.ammo[id]) return;
  }
  input.weapon = id;
}

function localInput() {
  const out = {
    walk: (input.right - input.left),
    aim: (input.up - input.down),
    charge: input.charge,
    fire: input.fire,
    weapon: input.weapon,
  };
  input.fire = 0;
  input.weapon = null;
  return out;
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
$('quitBtn').addEventListener('click', () => { if (S.role === 'solo') backToRoom(); else leave(); });

// ── The feed and the HUD ───────────────────────────────────

const nameOf = id => (id === S.myId ? 'You' : (S.players[id] || {}).name || 'Someone');

function feed(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  $('feed').appendChild(el);
  setTimeout(() => el.remove(), 5000);
  while ($('feed').children.length > 4) $('feed').firstChild.remove();
}

function feedEvent(e, v) {
  if (!v) return;
  const unit = e.unit !== undefined ? v.units[e.unit] : null;
  const tag = u => {
    const p = v.players.find(pp => pp.id === u.owner);
    return `<span class="sw" style="background:${p ? p.colour : '#888'}"></span>${esc(u.name)}`;
  };
  if (e.type === 'down' && unit) feed(`${tag(unit)} is out`);
  else if (e.type === 'crate' && unit) feed(`${tag(unit)} picked up ${e.kind === 'weapon' ? (WEAPONS[e.what] || {}).name || 'a weapon' : e.kind}`);
  else if (e.type === 'sudden') feed('Sudden death: one hit and you are out');
  else if (e.type === 'timeout') feed('Out of time');
}

function updateHud(v) {
  if (!v) return;
  let html = '';
  for (const p of v.players) {
    const squad = v.units.filter(u => u.owner === p.id);
    const left = squad.filter(u => u.alive).length;
    html += `<span class="score${left ? '' : ' out'}"><span class="swatch" style="background:${p.colour}"></span>${esc(p.id === S.myId ? 'You' : p.name)} <span class="pips">${squad.map(u => `<i class="${u.alive ? 'on' : ''}"></i>`).join('')}</span></span>`;
  }
  if (html !== hudKey) { $('scores').innerHTML = html; hudKey = html; }
  $('roundLabel').textContent = `Round ${v.round}` + (v.sudden ? ' · sudden death' : '');

  const act = v.units[v.active];
  const mine = act && act.owner === S.myId && v.phase === 'aim';
  const me = v.players.find(p => p.id === S.myId);
  let d = '';
  if (me) {
    d += '<span class="weapons">';
    for (const [i, id] of WEAPON_IDS.entries()) {
      const w = WEAPONS[id];
      const ammo = me.ammo[id];
      const out = ammo !== null && ammo !== undefined && ammo !== Infinity && ammo <= 0;
      d += `<button class="wpn${me.weapon === id ? ' on' : ''}${out ? ' empty' : ''}" data-w="${id}" title="${esc(w.note)}"><span class="n">${i + 1}</span><b>${esc(w.name)}</b>${ammo === Infinity || ammo === null ? '' : `<span>${Math.max(0, ammo | 0)}</span>`}</button>`;
    }
    d += '</span>';
  }
  if (act) {
    d += `<span class="aim"><span class="lbl2">Angle</span><b>${Math.round((act.angle * 180) / Math.PI)}°</b>`;
    d += `<span class="lbl2">Power</span><b>${Math.round((act.charge || 0) * 100)}</b></span>`;
  }
  $('dash').innerHTML = d;
  for (const b of $('dash').querySelectorAll('.wpn')) b.addEventListener('click', () => mine && pickWeapon(b.dataset.w));

  $('clock').textContent = v.phase === 'aim' ? `${Math.max(0, Math.ceil(v.timer))}s` : '';
  $('netLabel').textContent = S.role === 'solo' ? `Solo · bots on ${S.settings.botLevel}`
    : S.role === 'host' ? `Hosting ${S.roomName} · ${S.humans.length - 1} ${S.humans.length === 2 ? 'guest' : 'guests'}`
    : S.net && S.net.isDirect(S.hostId) ? `${S.roomName} · direct connection` : `${S.roomName} · via relay (slower)`;

  let title = '', sub = '';
  if (v.phase === 'matchEnd') { /* the card says it */ }
  else if (act) {
    const owner = v.players.find(p => p.id === act.owner);
    title = mine ? 'Your turn' : `${owner ? owner.name : 'Someone'}: ${act.name}`;
    sub = mine ? 'A D to walk · W S to aim · hold Space' : '';
  }
  const showBanner = !!title && v.phase === 'aim' && v.timer > TURN_TIME - 2.2;
  $('banner').hidden = !showBanner;
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;

  if (v.phase === 'matchEnd' && $('over').hidden) showStandings(v);
  if (v.phase !== 'matchEnd' && !$('over').hidden) $('over').hidden = true;
}

function showStandings(v) {
  const w = v.winner ? nameOf(v.winner) : null;
  $('overTitle').textContent = w ? (w === 'You' ? 'You win' : `${w} wins`) : 'Nobody left standing';
  const box = $('standings');
  box.innerHTML = '';
  for (const p of v.players) {
    const squad = v.units.filter(u => u.owner === p.id);
    const el = document.createElement('div');
    el.className = 'spec';
    el.innerHTML = '<div class="spec-head"><span class="spec-name"></span><span class="spec-dim"></span></div>';
    el.querySelector('.spec-name').textContent = p.name + (p.id === S.myId ? ' (you)' : '');
    el.querySelector('.spec-dim').textContent = `${squad.filter(u => u.alive).length} of ${squad.length} left`;
    box.appendChild(el);
  }
  $('rematchBtn').hidden = !isBoss();
  $('backBtn').hidden = !isBoss();
  $('overNote').textContent = isBoss() ? '' : 'Waiting for the host to pick what happens next.';
  $('over').hidden = false;
  $('pause').hidden = true;
}

// ── Leaving ────────────────────────────────────────────────

function cancelPending() {
  if ((S.role === 'client' && !S.hostId) || (S.role === 'host' && !S.net)) resetSession();
  $('hostBtn').disabled = false;
  $('joinBtn').disabled = false;
  $('hostErr').textContent = '';
}

function resetSession() {
  S.session++;
  clearTimeout(S.joinTimer);
  if (S.net) S.net.leave();
  Object.assign(S, {
    role: null, net: null, myId: 'me', hostId: null, roomName: '', password: '', listed: false,
    humans: [], stage: 'lobby', roster: [], players: {}, m: null, brains: {}, inQ: {},
    craters: [], evLog: [], room: null, paused: false,
  });
  resetClientView();
}

function leave(msg, where) {
  resetSession();
  advertise();
  $('joinBtn').disabled = false;
  $('hostBtn').disabled = false;
  show(where === 'joinErr' ? 'join' : 'title');
  if (msg) { if (where) $(where).textContent = msg; else toast(msg); }
}
window.addEventListener('pagehide', () => { if (S.net) S.net.leave(); });

// ── Helpers ────────────────────────────────────────────────

function cleanName(n) { return (typeof n === 'string' ? n : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Gunner'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── The loop ───────────────────────────────────────────────

const field = $('field');
const renderer = createRenderer(field);
new ResizeObserver(() => renderer.resize()).observe(field.parentElement);

const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 60);'], { type: 'text/javascript' })));
let lastSim = performance.now();
ticker.onmessage = () => {
  const now = performance.now();
  const dt = Math.max(0, Math.min(0.25, (now - lastSim) / 1000));
  lastSim = now;
  if (S.screen !== 'play' || !isBoss() || !S.m) return;
  if (S.role === 'solo' && document.hidden && !S.paused && $('over').hidden) togglePause();
  if (S.paused || S.m.phase === 'matchEnd') return;
  S.acc += dt;
  let n = 0;
  while (S.acc >= DT && n < 12) { hostTick(); S.acc -= DT; n++; }
  if (n === 12) S.acc = 0;
};

// A guest posts its input while its own gun is up.
setInterval(() => {
  if (S.role !== 'client' || !S.net || !S.hostId || !S.view) return;
  const act = S.view.units[S.view.active];
  if (!act || act.owner !== S.myId || S.view.phase !== 'aim') return;
  const inp = localInput();
  if (!S.net.sendDirect('in', inp, S.hostId)) S.net.send('in', inp, S.hostId);
}, INPUT_EVERY * 16);

let last = performance.now();
let hudT = 0;
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  let v = null;
  if (S.screen === 'play') {
    v = isBoss() && S.m ? matchView(S.m) : S.view;
    renderer.draw(v, { dt: S.paused ? 0 : dt });
    hudT -= dt;
    if (hudT <= 0) { updateHud(v); hudT = 0.1; }
  } else {
    renderer.draw(null, { dt });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hooks.
window.__barrage = () => (S.m ? { phase: S.m.phase, round: S.m.round, active: S.m.active, units: S.m.units.map(u => ({ hp: Math.round(u.hp), alive: u.alive, x: Math.round(u.x) })) } : null);
window.__barrageView = () => S.view;

// ── Boot ───────────────────────────────────────────────────

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
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { cancelPending(); show('title'); }));
window.addEventListener('keydown', e => {
  if (S.screen === 'play') return;
  if (e.key === 'Escape' && ['host', 'join', 'how'].includes(S.screen)) { cancelPending(); show('title'); }
});

fit();
show('title');
startLobby();
