// The page: menus, rooms, and the loop. Solo games and hosts run the rules
// locally; clients send input and draw what the host sends back, predicting
// only their own tank so driving feels immediate.

import {
  createGame, step, snapshot, unpack, addPlayer, removePlayer, drive,
  POWERUPS, COLORS, TEAM, DEFAULT_SETTINGS, DT, wrap,
} from './sim.js';
import { MAPS, buildMap, mapName } from './maps.js';
import { makeBrain, botInput } from './bots.js';
import { createRenderer, drawIcon } from './render.js';
import { openLobby, openGame, roomKey } from './net.js';

const $ = id => document.getElementById(id);
const MAX = 4;
const BOT_NAMES = ['Rook', 'Bramble', 'Flint', 'Hickory'];
const INTERP_TICKS = 6;       // clients draw about 100 ms behind the host
const SNAP_EVERY = 3;         // host sends 20 snapshots a second
const INPUT_MS = 33;
const TEAM_SHADES = { red: ['#A8453A', '#C87A60'], blue: ['#3F6E9A', '#7298BF'] };

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

// ── State ──────────────────────────────────────────────────

const S = {
  screen: 'menu',
  role: null,              // 'solo' | 'host' | 'client'
  net: null,
  myId: 'me',
  hostId: null,
  roomName: '',
  password: '',
  listed: false,
  createdAt: 0,
  humans: [],              // host: [{ id, name, team }]
  settings: { ...DEFAULT_SETTINGS },
  stage: 'lobby',          // 'lobby' | 'match'
  roster: [],              // players with colours and teams resolved
  players: {},             // id -> player, for drawing
  // host / solo
  g: null,
  brains: {},
  peerInputs: {},
  lastSeq: {},
  outEvents: [],
  acc: 0,
  paused: false,
  // client
  room: null,
  snaps: [],
  evq: [],
  offset: null,
  grid: null,
  gridKey: '',
  pred: null,
  predHist: [],
  seq: 0,
  lastSend: 0,
  joinTimer: 0,
};

const input = { up: 0, down: 0, left: 0, right: 0, fs: 0, mx: null, my: null };
let lobby = null;
let ads = [];
let myName = store.get('tanks-name', '') || 'Tank ' + Math.floor(10 + Math.random() * 90);

// ── Screens ────────────────────────────────────────────────

function show(screen) {
  S.screen = screen;
  for (const id of ['menu', 'room', 'play']) $(id).hidden = id !== screen;
  if (screen === 'play') {
    if (document.activeElement) document.activeElement.blur();
    $('over').hidden = true;
    $('pause').hidden = true;
    S.paused = false;
    requestAnimationFrame(() => renderer.resize());
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
$('nameIn').addEventListener('input', () => {
  myName = $('nameIn').value.trim().slice(0, 14) || 'Tank';
  store.set('tanks-name', myName);
});

function buildPowerupList() {
  const groups = { weapon: 'Weapons', defense: 'Defence', chaos: 'Chaos' };
  const ring = { weapon: '--pu-weapon', defense: '--pu-defense', chaos: '--pu-chaos' };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const host = $('puList');
  host.innerHTML = '';
  for (const [g, label] of Object.entries(groups)) {
    const h = document.createElement('div');
    h.className = 'pu-group';
    h.textContent = label;
    host.appendChild(h);
    for (const [id, def] of Object.entries(POWERUPS)) {
      if (def.group !== g) continue;
      const row = document.createElement('div');
      row.className = 'spec';
      const cv = document.createElement('canvas');
      cv.width = 60; cv.height = 60;
      const c = cv.getContext('2d');
      c.scale(2, 2);
      c.fillStyle = css('--surface');
      c.strokeStyle = css(ring[g]);
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(15, 15, 12, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = c.fillStyle = css('--ink');
      c.lineWidth = 1.6;
      drawIcon(c, id, 15, 15, 1);
      const txt = document.createElement('div');
      const amount = def.buff ? `${def.buff} s` : `${def.charges} ${def.charges === 1 ? 'shot' : 'shots'}`;
      txt.innerHTML = `<div class="spec-head"><span class="spec-name"></span><span class="spec-dim"></span></div><span class="spec-note"></span>`;
      txt.querySelector('.spec-name').textContent = def.name;
      txt.querySelector('.spec-dim').textContent = amount;
      txt.querySelector('.spec-note').textContent = def.note;
      row.append(cv, txt);
      host.appendChild(row);
    }
  }
}

function renderAds() {
  const list = $('gameList');
  const shown = ads.filter(a => !a.gone);
  if (!shown.length) {
    list.innerHTML = '<p class="empty">No open games right now. Make one, or join a friend\'s room by name.</p>';
    return;
  }
  list.innerHTML = '';
  for (const a of shown) {
    const row = document.createElement('div');
    row.className = 'spec game-row';
    const left = document.createElement('div');
    left.innerHTML = `<div class="spec-head"><span class="spec-name"></span></div><span class="spec-note"></span>`;
    const nm = left.querySelector('.spec-name');
    nm.textContent = a.n;
    if (a.l) nm.insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 10 11" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="password"><rect x="1" y="5" width="8" height="5.5" rx="1"/><path d="M3 5V3.5a2 2 0 014 0V5"/></svg>');
    const mode = a.m === 'teams' ? 'red v blue' : 'free-for-all';
    left.querySelector('.spec-note').textContent =
      `${a.c}/${a.x} players · ${mode} · ${a.s === 'match' ? 'match under way' : 'in the lobby'} · host ${a.h}`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline';
    btn.type = 'button';
    btn.textContent = 'Join';
    btn.disabled = a.c >= a.x;
    btn.addEventListener('click', () => {
      if (!a.l) return startJoin(a.n, '');
      let pw = row.querySelector('.pw');
      if (pw) { pw.querySelector('input').focus(); return; }
      pw = document.createElement('div');
      pw.className = 'pw';
      pw.innerHTML = '<input type="password" placeholder="password" aria-label="Room password" /><button class="btn" type="button">Go</button>';
      left.appendChild(pw);
      const go = () => startJoin(a.n, pw.querySelector('input').value);
      pw.querySelector('button').addEventListener('click', go);
      pw.querySelector('input').addEventListener('keydown', e => e.key === 'Enter' && go());
      pw.querySelector('input').focus();
    });
    row.append(left, btn);
    list.appendChild(row);
  }
}

async function startLobby() {
  try {
    lobby = await openLobby(list => { ads = list; renderAds(); });
    const tick = () => {
      const r = lobby.relays();
      $('relayState').textContent = r === null ? 'listening' : r > 0 ? `${r} relay${r === 1 ? '' : 's'} connected` : 'connecting to relays…';
    };
    tick();
    setInterval(tick, 3000);
  } catch (e) {
    console.error(e);
    $('relayState').textContent = 'offline';
    $('gameList').innerHTML = '<p class="empty">Could not reach the relays, so online play is unavailable. Solo still works.</p>';
  }
}

$('soloBtn').addEventListener('click', () => {
  resetSession();
  S.role = 'solo';
  S.myId = 'me';
  S.roomName = 'Solo';
  S.settings = { ...DEFAULT_SETTINGS, bots: 2, ...JSON.parse(store.get('tanks-solo', '{}')) };
  S.humans = [{ id: 'me', name: myName, team: null }];
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
  if (!name) { $('hostErr').textContent = 'Give the room a name.'; return; }
  if (ads.some(a => roomKey(a.n) === roomKey(name))) {
    $('hostErr').textContent = 'A listed room already has that name. Pick another.';
    return;
  }
  resetSession();
  S.role = 'host';
  S.roomName = name;
  S.password = pw;
  S.listed = listed;
  S.createdAt = Date.now();
  S.settings = { ...DEFAULT_SETTINGS, bots: 0 };
  $('hostBtn').disabled = true;
  try {
    S.net = await openGame(name, pw, hostHandlers());
  } catch (e) {
    console.error(e);
    $('hostErr').textContent = 'Could not reach the relays. Solo still works.';
    $('hostBtn').disabled = false;
    S.role = null;
    return;
  }
  $('hostBtn').disabled = false;
  S.myId = S.net.selfId;
  S.hostId = S.myId;
  S.humans = [{ id: S.myId, name: myName, team: null }];
  buildRoster();
  renderRoom();
  show('room');
  advertise();
}

function hostHandlers() {
  return {
    onPeerJoin(peer) {
      // Tell everyone who arrives what this room is. A second host that
      // picked the same name will hear it and back off.
      S.net && S.net.send('room', roomState(), peer);
    },
    onPeerLeave(peer) { hostDrop(peer); },
    onMessage(type, data, peer) {
      if (type === 'hello') return hostHello(peer, data);
      if (type === 'in') {
        if (!data || typeof data !== 'object') return;
        S.peerInputs[peer] = {
          th: clamp(+data.th || 0, -1, 1), tu: clamp(+data.tu || 0, -1, 1),
          ax: +data.ax || 0, ay: +data.ay || 0, fs: data.fs | 0,
        };
        S.lastSeq[peer] = data.q | 0;
        return;
      }
      if (type === 'team') {
        const h = S.humans.find(h => h.id === peer);
        if (h && S.stage === 'lobby' && (data === 'red' || data === 'blue')) { h.team = data; roomChanged(); }
        return;
      }
      if (type === 'bye') return hostDrop(peer);
      if (type === 'room' && data && data.hostId === peer) {
        // Two hosts, one name: the younger room gives way.
        if (data.createdAt < S.createdAt || (data.createdAt === S.createdAt && peer < S.myId)) {
          leave('Someone else already has a room with that name. Pick another.');
        }
      }
    },
  };
}

function hostHello(peer, data) {
  const name = cleanName(data && data.name);
  const known = S.humans.find(h => h.id === peer);
  if (known) { known.name = name; roomChanged(); return; }
  if (S.humans.length >= MAX) { S.net.send('full', 1, peer); return; }
  const h = { id: peer, name, team: null };
  S.humans.push(h);
  if (S.stage === 'match' && S.g) joinMidMatch(h);
  roomChanged();
  toast(`${name} joined.`);
}

function joinMidMatch(h) {
  const g = S.g;
  let live = g.players.filter(p => !p.left);
  if (live.length >= MAX) {
    // Hand over a bot's seat.
    const bot = live.find(p => p.bot);
    if (bot) { removePlayer(g, bot.id); delete S.brains[bot.id]; }
    live = g.players.filter(p => !p.left);
  }
  let team = null, color;
  if (g.settings.mode === 'teams') {
    const n = t => live.filter(p => p.team === t).length;
    team = n('red') <= n('blue') ? 'red' : 'blue';
    color = TEAM_SHADES[team][n(team) % 2];
  } else {
    color = COLORS.find(c => !live.some(p => p.color === c)) || COLORS[0];
  }
  h.team = team;
  addPlayer(g, { id: h.id, name: h.name, team, color, bot: false });
  refreshPlayers();
}

function hostDrop(peer) {
  const i = S.humans.findIndex(h => h.id === peer);
  if (i < 0) return;
  const [h] = S.humans.splice(i, 1);
  delete S.peerInputs[peer];
  if (S.g) removePlayer(S.g, peer);
  roomChanged();
  toast(`${h.name} left.`);
}

function roomState() {
  return {
    name: S.roomName,
    hostId: S.myId,
    createdAt: S.createdAt,
    locked: !!S.password,
    listed: S.listed,
    stage: S.stage,
    settings: S.settings,
    roster: S.stage === 'match' && S.g ? S.g.players : S.roster,
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
  if (!lobby) return;
  if (S.role === 'host' && S.listed) {
    lobby.advertise({
      n: S.roomName, h: myName, l: !!S.password,
      c: S.humans.length, x: MAX, m: S.settings.mode, s: S.stage,
    });
  } else {
    lobby.advertise(null);
  }
}

/** Resolve humans + bots into a roster with teams and colours. */
function buildRoster() {
  const humans = S.humans.slice(0, MAX);
  const nb = Math.max(0, Math.min(S.settings.bots, MAX - humans.length));
  const bots = BOT_NAMES.slice(0, nb).map((name, i) => ({ id: 'bot' + (i + 1), name, bot: true, team: null }));
  const all = [...humans, ...bots];
  if (S.settings.mode === 'teams') {
    const count = t => all.filter(p => p.team === t).length;
    for (const p of all) {
      if (p.bot || !p.team) {
        p.team = null;
      }
    }
    for (const p of all) {
      if (!p.team) p.team = count('red') <= count('blue') ? 'red' : 'blue';
    }
    const seen = { red: 0, blue: 0 };
    S.roster = all.map(p => ({ id: p.id, name: p.name, team: p.team, bot: !!p.bot, color: TEAM_SHADES[p.team][seen[p.team]++ % 2] }));
  } else {
    S.roster = all.map((p, i) => ({ id: p.id, name: p.name, team: null, bot: !!p.bot, color: COLORS[i % COLORS.length] }));
  }
  refreshPlayers();
}

function refreshPlayers() {
  const list = S.role === 'client'
    ? (S.room ? S.room.roster : [])
    : (S.stage === 'match' && S.g ? S.g.players : S.roster);
  S.players = Object.fromEntries(list.map(p => [p.id, p]));
}

// ── Rooms: client ──────────────────────────────────────────

async function startJoin(name, pw) {
  name = name.trim();
  $('joinErr').textContent = '';
  if (!name) { $('joinErr').textContent = 'Type the room name.'; return; }
  resetSession();
  S.role = 'client';
  S.roomName = name;
  S.password = pw;
  $('joinErr').textContent = 'Looking for the room…';
  $('joinBtn').disabled = true;
  try {
    S.net = await openGame(name, pw, clientHandlers());
  } catch (e) {
    console.error(e);
    $('joinErr').textContent = 'Could not reach the relays.';
    $('joinBtn').disabled = false;
    S.role = null;
    return;
  }
  S.myId = S.net.selfId;
  S.joinTimer = setTimeout(() => {
    if (!S.hostId) leave(`No answer from a room called "${name}". Check the name and the password.`, 'joinErr');
  }, 16000);
}

function clientHandlers() {
  return {
    onPeerJoin(peer) { S.net && S.net.send('hello', { name: myName }, peer); },
    onPeerLeave(peer) {
      if (peer === S.hostId) leave('The host left, so the game ended.');
    },
    onError(kind) {
      if (kind === 'password' && !S.hostId) leave('Could not get in. Usually the password does not match; sometimes a network blocks direct connections.', 'joinErr');
    },
    onMessage(type, data, peer) {
      if (type === 'room') {
        if (!data || data.hostId !== peer) return;
        if (!S.hostId) {
          S.hostId = peer;
          clearTimeout(S.joinTimer);
          $('joinErr').textContent = '';
          $('joinBtn').disabled = false;
          S.roomName = data.name;
        }
        if (peer !== S.hostId) return;
        const wasStage = S.room && S.room.stage;
        S.room = data;
        S.settings = data.settings;
        S.stage = data.stage;
        refreshPlayers();
        if (data.stage === 'match') {
          if (S.screen !== 'play') { resetClientView(); show('play'); }
        } else {
          if (S.screen !== 'room' || wasStage === 'match') show('room');
          renderRoom();
        }
        return;
      }
      if (peer !== S.hostId) return;
      if (type === 'snap') return clientSnap(data);
      if (type === 'full') return leave('That room is full.', 'joinErr');
    },
  };
}

function resetClientView() {
  S.snaps = []; S.evq = []; S.offset = null; S.pred = null; S.predHist = []; S.gridKey = '';
}

function clientSnap(data) {
  if (!data || !Array.isArray(data.T)) return;
  const v = unpack(data);
  const now = performance.now();
  // A rematch restarts the host's clock: drop the old match's pictures.
  const prev = S.snaps[S.snaps.length - 1];
  if (prev && v.tick < prev.tick) { resetClientView(); }
  const sample = v.tick - now * 0.06;
  if (S.offset === null || Math.abs(sample - S.offset) > 30) S.offset = sample;
  else S.offset += (sample - S.offset) * 0.05;

  const key = v.map.id + ':' + v.map.seed + ':' + v.destroyed.length;
  if (key !== S.gridKey) {
    const m = buildMap(v.map.id, v.map.seed);
    for (const i of v.destroyed) m.grid[i] = 0;
    S.grid = m.grid;
    S.gridKey = key;
  }
  S.snaps.push(v);
  if (S.snaps.length > 40) S.snaps.shift();
  if (v.events.length) S.evq.push({ tick: v.tick, events: v.events });

  // Anything that moves my tank without my input: start prediction afresh.
  if (v.events.some(e => (e.type === 'tp' || e.type === 'freeze') && e.id === S.myId || e.type === 'round')) S.pred = null;

  // Reconcile: compare where the host has me with where I thought I was
  // when I sent the input it has just acknowledged.
  const me = v.tanks.find(t => t.id === S.myId);
  const ack = data.ak && data.ak[S.myId];
  if (S.pred && me && ack) {
    const h = S.predHist.find(p => p.q === ack);
    if (h) {
      const ex = me.x - h.x, ey = me.y - h.y;
      if (Math.hypot(ex, ey) > 48) { S.pred.x = me.x; S.pred.y = me.y; S.pred.a = me.a; }
      else { S.pred.x += ex * 0.3; S.pred.y += ey * 0.3; S.pred.a = wrap(S.pred.a + wrap(me.a - h.a) * 0.3); }
    }
  }
}

function clientView(now, dt) {
  if (!S.snaps.length) return null;
  const latest = S.snaps[S.snaps.length - 1];
  const rt = now * 0.06 + S.offset - INTERP_TICKS;
  let s0 = S.snaps[0], s1 = latest;
  for (let i = S.snaps.length - 1; i >= 0; i--) {
    if (S.snaps[i].tick <= rt) { s0 = S.snaps[i]; s1 = S.snaps[i + 1] || S.snaps[i]; break; }
  }
  const k = s1.tick > s0.tick ? Math.max(0, Math.min(1, (rt - s0.tick) / (s1.tick - s0.tick))) : 1;
  const lerp = (a, b) => a + (b - a) * k;
  const byId = arr => Object.fromEntries(arr.map(o => [o.id, o]));
  const t1 = byId(s1.tanks), sh1 = byId(s1.shells);

  const tanks = s0.tanks.map(a => {
    const b = t1[a.id];
    if (!b) return a;
    return { ...b, x: lerp(a.x, b.x), y: lerp(a.y, b.y), a: a.a + wrap(b.a - a.a) * k, ta: a.ta + wrap(b.ta - a.ta) * k };
  });
  for (const b of s1.tanks) if (!tanks.some(t => t.id === b.id)) tanks.push(b);
  const shells = s0.shells.filter(a => sh1[a.id]).map(a => {
    const b = sh1[a.id];
    return { ...b, x: lerp(a.x, b.x), y: lerp(a.y, b.y) };
  });

  // Release effects in step with the delayed picture.
  while (S.evq.length && S.evq[0].tick <= rt) renderer.addEvents(S.evq.shift().events, { players: S.players });
  if (S.evq.length > 60) S.evq.splice(0, S.evq.length - 60);

  // My own tank: predicted, and aimed from the local mouse.
  const serverMe = latest.tanks.find(t => t.id === S.myId);
  const playing = latest.phase === 'play' || latest.phase === 'ending';
  if (serverMe && serverMe.alive && serverMe.frozen <= 0 && playing) {
    if (!S.pred) S.pred = { x: serverMe.x, y: serverMe.y, a: serverMe.a, buffs: serverMe.buffs };
    S.pred.buffs = serverMe.buffs;
    drive(S.grid, S.pred, localInput(S.pred), dt);
  } else {
    S.pred = null;
  }
  const mine = tanks.find(t => t.id === S.myId);
  if (mine && mine.alive) {
    if (S.pred) { mine.x = S.pred.x; mine.y = S.pred.y; mine.a = S.pred.a; }
    const aim = aimPoint(mine);
    if (!(mine.frozen > 0)) mine.ta = Math.atan2(aim.y - mine.y, aim.x - mine.x);
  }

  return {
    grid: S.grid,
    tanks, shells,
    mines: s1.mines, pickups: s1.pickups, beams: s1.beams,
    players: S.players,
    phase: latest.phase, timer: latest.timer, round: latest.round, map: latest.map,
    scores: latest.scores, kills: latest.kills, lastWinner: latest.lastWinner, matchWinner: latest.matchWinner,
    settings: S.settings,
  };
}

function sendInput(now) {
  if (!S.net || !S.hostId || now - S.lastSend < INPUT_MS) return;
  S.lastSend = now;
  const me = S.pred || (S.snaps.length && S.snaps[S.snaps.length - 1].tanks.find(t => t.id === S.myId));
  const inp = localInput(me);
  const q = ++S.seq;
  S.net.send('in', { ...inp, ax: Math.round(inp.ax), ay: Math.round(inp.ay), q }, S.hostId);
  if (S.pred) {
    S.predHist.push({ q, x: S.pred.x, y: S.pred.y, a: S.pred.a });
    if (S.predHist.length > 90) S.predHist.shift();
  }
}

// ── Room screen ────────────────────────────────────────────

const isBoss = () => S.role === 'host' || S.role === 'solo';

function buildMapSelect() {
  const sel = $('setMap');
  sel.innerHTML = '<option value="rotation">Rotation (every map in turn)</option><option value="random">Random each round</option>' +
    MAPS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

function renderRoom() {
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
    hint = S.listed
      ? `Listed under open games. Friends can also type ${how} to join.`
      : `Not listed. Friends join by typing ${how}.`;
    hint += ' Keep this tab in front while you host: the game runs here.';
  } else if (S.role === 'client') {
    hint = 'Waiting for the host to start the match.';
  } else {
    hint = 'Pick your settings and start.';
  }
  $('roomHint').textContent = hint;

  // Roster
  const humans = roster.filter(p => !p.bot).length;
  $('rosterCount').textContent = `${roster.length}/${MAX}`;
  const box = $('roster');
  box.innerHTML = '';
  for (const p of roster) {
    const row = document.createElement('div');
    row.className = 'spec player';
    const head = document.createElement('div');
    head.className = 'spec-head';
    const nm = document.createElement('span');
    nm.className = 'spec-name';
    nm.innerHTML = '<span class="swatch"></span><span></span>';
    nm.firstChild.style.background = p.color;
    nm.lastChild.textContent = p.name + (p.id === S.myId ? ' (you)' : '');
    const dim = document.createElement('span');
    dim.className = 'spec-dim';
    const bits = [];
    if (p.bot) bits.push(`bot · ${st.botLevel}`);
    if (p.id === (S.role === 'solo' ? 'me' : S.hostId) && S.role !== 'solo') bits.push('host');
    dim.textContent = bits.join(' · ');
    if (st.mode === 'teams') {
      const canSwap = !p.bot && (boss || p.id === S.myId);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-quiet';
      b.textContent = TEAM[p.team] ? TEAM[p.team].name : '';
      b.disabled = !canSwap;
      b.title = canSwap ? 'Switch team' : '';
      b.addEventListener('click', () => swapTeam(p.id));
      dim.append(' ', b);
    }
    head.append(nm, dim);
    row.appendChild(head);
    box.appendChild(row);
  }
  if (S.role !== 'solo' && humans < 2 && S.role === 'host') {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Waiting for players. Bots can fill the empty seats.';
    box.appendChild(p);
  }

  // Settings
  const setSeg = (id, v) => $(id).querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.v === v));
    b.disabled = !boss;
  });
  setSeg('setMode', st.mode);
  setSeg('setPickups', st.pickups);
  for (const [id, v] of [['setMap', st.map], ['setRounds', String(st.rounds)], ['setBots', String(st.bots)], ['setLevel', st.botLevel]]) {
    $(id).value = v;
    $(id).disabled = !boss;
  }
  // Bots can only fill seats the humans have left.
  [...$('setBots').options].forEach(o => (o.disabled = +o.value > MAX - (S.role === 'client' ? humans : S.humans.length)));
  $('setFF').checked = !!st.ff;
  $('setFF').disabled = !boss;
  $('ffRow').hidden = st.mode !== 'teams';

  $('startBtn').hidden = !boss;
  const ready = roster.length >= 2;
  $('startBtn').disabled = !ready;
  $('startHint').textContent = boss
    ? (ready ? '' : 'You need at least two tanks. Add a bot, or wait for someone to join.')
    : '';
}

function swapTeam(id) {
  if (S.role === 'client') {
    if (id !== S.myId) return;
    const me = S.room.roster.find(p => p.id === id);
    S.net.send('team', me && me.team === 'red' ? 'blue' : 'red', S.hostId);
    return;
  }
  const h = S.humans.find(h => h.id === id);
  if (!h) return;
  const cur = S.roster.find(p => p.id === id);
  h.team = cur && cur.team === 'red' ? 'blue' : 'red';
  roomChanged();
}

function changeSetting(k, v) {
  if (!isBoss()) return;
  S.settings = { ...S.settings, [k]: v };
  if (S.role === 'solo') store.set('tanks-solo', JSON.stringify(S.settings));
  if (k === 'mode') for (const h of S.humans) h.team = null;
  roomChanged();
}

for (const id of ['setMode', 'setPickups']) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) changeSetting(id === 'setMode' ? 'mode' : 'pickups', b.dataset.v);
  });
}
$('setMap').addEventListener('change', e => changeSetting('map', e.target.value));
$('setRounds').addEventListener('change', e => changeSetting('rounds', +e.target.value));
$('setBots').addEventListener('change', e => changeSetting('bots', +e.target.value));
$('setLevel').addEventListener('change', e => changeSetting('botLevel', e.target.value));
$('setFF').addEventListener('change', e => changeSetting('ff', e.target.checked));
$('startBtn').addEventListener('click', startMatch);
$('leaveBtn').addEventListener('click', () => leave());

// ── Match ──────────────────────────────────────────────────

function startMatch() {
  if (!isBoss()) return;
  buildRoster();
  if (S.roster.length < 2) return;
  S.g = createGame(S.settings, S.roster.map(p => ({ ...p })));
  S.brains = {};
  for (const p of S.roster) if (p.bot) S.brains[p.id] = makeBrain(S.settings.botLevel);
  S.stage = 'match';
  S.acc = 0;
  S.outEvents = [];
  refreshPlayers();
  renderer.addEvents([{ type: 'round' }], {});
  show('play');
  if (S.role === 'host') S.net.send('room', roomState());
  advertise();
}

function backToRoom() {
  if (!isBoss()) return;
  S.stage = 'lobby';
  S.g = null;
  roomChanged();
  show('room');
}

$('rematchBtn').addEventListener('click', startMatch);
$('backBtn').addEventListener('click', backToRoom);

function hostTick() {
  const g = S.g;
  const inputs = { [S.myId]: localInput(g.tanks.find(t => t.id === S.myId)) };
  for (const [id, inp] of Object.entries(S.peerInputs)) inputs[id] = inp;
  for (const t of g.tanks) if (S.brains[t.id]) inputs[t.id] = botInput(g, t, S.brains[t.id], DT);
  step(g, inputs);
  if (g.events.length) {
    renderer.addEvents(g.events, { players: S.players });
    if (S.role === 'host') S.outEvents.push(...g.events);
    g.events = [];
  }
  if (S.role === 'host' && g.tick % SNAP_EVERY === 0) {
    const snap = snapshot(g, S.outEvents);
    snap.ak = S.lastSeq;
    S.net.send('snap', snap);
    S.outEvents = [];
  }
}

function hostView() {
  const g = S.g;
  return {
    grid: g.grid, tanks: g.tanks, shells: g.shells, mines: g.mines, pickups: g.pickups, beams: g.beams,
    players: S.players, phase: g.phase, timer: g.timer, round: g.round, map: g.map,
    scores: g.scores, kills: g.kills, lastWinner: g.lastWinner, matchWinner: g.matchWinner, settings: g.settings,
  };
}

// ── Input ──────────────────────────────────────────────────

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

window.addEventListener('keydown', e => {
  if (S.screen !== 'play') return;
  if (KEYS[e.code]) { input[KEYS[e.code]] = 1; e.preventDefault(); }
  else if (e.code === 'Space') { if (!e.repeat) input.fs++; e.preventDefault(); }
  else if (e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', e => { if (KEYS[e.code]) input[KEYS[e.code]] = 0; });
window.addEventListener('blur', () => { input.up = input.down = input.left = input.right = 0; });

const field = $('field');
window.addEventListener('mousemove', e => { input.mx = e.clientX; input.my = e.clientY; });
field.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  input.mx = e.clientX; input.my = e.clientY;
  input.fs++;
  e.preventDefault();
});
field.addEventListener('contextmenu', e => e.preventDefault());

function aimPoint(t) {
  if (input.mx === null) return t ? { x: t.x + Math.cos(t.ta) * 100, y: t.y + Math.sin(t.ta) * 100 } : { x: 0, y: 0 };
  return renderer.toWorld(input.mx, input.my);
}

function localInput(t) {
  const aim = aimPoint(t);
  return {
    th: input.up - input.down,
    tu: input.right - input.left,
    ax: aim.x, ay: aim.y,
    fs: input.fs,
  };
}

function togglePause() {
  if (!$('over').hidden) return;
  const p = $('pause');
  p.hidden = !p.hidden;
  if (S.role === 'solo') S.paused = !p.hidden;
  $('pauseTitle').textContent = S.role === 'solo' ? 'Paused' : 'Menu';
  $('pauseNote').textContent = S.role === 'solo'
    ? 'Esc to carry on.'
    : 'The match keeps going for everyone else. Esc to go back.';
}
$('resumeBtn').addEventListener('click', togglePause);
$('quitBtn').addEventListener('click', () => {
  if (S.role === 'solo') { S.stage = 'lobby'; S.g = null; renderRoom(); show('room'); return; }
  leave();
});

// ── HUD ────────────────────────────────────────────────────

function nameOf(id) {
  if (id === S.myId) return 'You';
  const p = S.players[id];
  return p ? p.name : 'Someone';
}

function winnerText(w, view) {
  if (w === null || w === undefined) return null;
  if (view.settings && view.settings.mode === 'teams') return TEAM[w] ? TEAM[w].name : w;
  return nameOf(w);
}

let hudKey = '';
function updateHud(view) {
  if (!view) {
    $('scores').innerHTML = '';
    $('banner').hidden = false;
    $('bannerTitle').textContent = 'Joining';
    $('bannerSub').textContent = 'Waiting for the first picture from the host…';
    return;
  }
  const teams = view.settings && view.settings.mode === 'teams';
  const rounds = (view.settings && view.settings.rounds) || 5;
  const alive = new Set(view.tanks.filter(t => t.alive).map(t => t.id));
  const pips = n => '<span class="pips">' + Array.from({ length: rounds }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + '</span>';

  let html = '';
  if (teams) {
    for (const tm of ['red', 'blue']) {
      const members = Object.values(S.players).filter(p => p.team === tm && !p.left);
      const up = members.some(p => alive.has(p.id));
      html += `<span class="score${up ? '' : ' out'}"><span class="swatch" style="background:${TEAM[tm].color}"></span>${TEAM[tm].name} ${pips(view.scores[tm] || 0)}</span>`;
    }
  } else {
    for (const p of Object.values(S.players)) {
      if (p.left) continue;
      html += `<span class="score${alive.has(p.id) ? '' : ' out'}"><span class="swatch" style="background:${p.color}"></span>${esc(p.id === S.myId ? 'You' : p.name)} ${pips(view.scores[p.id] || 0)}</span>`;
    }
  }
  if (html !== hudKey) { $('scores').innerHTML = html; hudKey = html; }
  $('roundLabel').textContent = view.map ? `Round ${view.round} · ${mapName(view.map.id)}` : '';

  // Loadout
  const me = view.tanks.find(t => t.id === S.myId);
  let lo = '';
  if (!me) lo = '<span class="muted">You join at the start of the next round.</span>';
  else if (!me.alive) lo = '<span class="muted">Knocked out. Next round soon.</span>';
  else {
    if (me.weapon) {
      const def = POWERUPS[me.weapon];
      lo += `<span class="w">${def.name}</span> <span>${me.weapon === 'laser' ? (me.charging > 0 ? 'charging' : 'ready') : '×' + me.charges}</span>`;
    } else {
      lo += '<span class="muted">Plain shells</span>';
    }
    const buffs = Object.entries(me.buffs).filter(([, v]) => v > 0)
      .map(([k, v]) => `${POWERUPS[k].name} ${Math.ceil(v)}s`);
    if (me.frozen > 0) buffs.unshift('Frozen');
    if (buffs.length) lo += `<span class="buffs">${buffs.join('<span>·</span>')}</span>`;
  }
  $('loadout').innerHTML = lo;

  if (S.role === 'solo') $('netLabel').textContent = `Solo · bots on ${S.settings.botLevel}`;
  else if (S.role === 'host') $('netLabel').textContent = `Hosting ${S.roomName} · ${S.humans.length} ${S.humans.length === 1 ? 'player' : 'players'}`;
  else $('netLabel').textContent = `${S.roomName}`;

  // Banner
  let title = '', sub = '';
  if (view.phase === 'countdown') {
    title = `Round ${view.round}`;
    sub = view.map ? mapName(view.map.id) : '';
    if (!me) sub += ' · you are in from next round';
  } else if (view.phase === 'roundEnd') {
    const w = winnerText(view.lastWinner, view);
    title = w ? (w === 'You' ? 'You take the round' : `${w} takes the round`) : 'Draw';
    sub = w ? '' : 'Nobody left standing';
  }
  $('banner').hidden = !title;
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;

  // Match over
  if (view.phase === 'matchEnd' && $('over').hidden) showStandings(view);
  if (view.phase !== 'matchEnd' && !$('over').hidden) $('over').hidden = true;
}

function showStandings(view) {
  const w = winnerText(view.matchWinner, view);
  $('overTitle').textContent = w === 'You' ? 'You win the match' : `${w} wins the match`;
  const teams = view.settings.mode === 'teams';
  const rows = Object.values(S.players).map(p => ({
    name: p.id === S.myId ? p.name + ' (you)' : p.name,
    rounds: teams ? null : (view.scores[p.id] || 0),
    kills: (view.kills && view.kills[p.id]) || 0,
    team: p.team,
  })).sort((a, b) => (b.rounds ?? 0) - (a.rounds ?? 0) || b.kills - a.kills);
  const box = $('standings');
  box.innerHTML = '';
  if (teams) {
    for (const tm of ['red', 'blue']) {
      box.insertAdjacentHTML('beforeend', `<div class="spec"><div class="spec-head"><span class="spec-name">${TEAM[tm].name}</span><span class="spec-dim">${view.scores[tm] || 0} rounds</span></div></div>`);
    }
  }
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'spec';
    el.innerHTML = '<div class="spec-head"><span class="spec-name"></span><span class="spec-dim"></span></div>';
    el.querySelector('.spec-name').textContent = r.name + (teams && TEAM[r.team] ? ` · ${TEAM[r.team].name}` : '');
    el.querySelector('.spec-dim').textContent = (r.rounds !== null ? `${r.rounds} rounds · ` : '') + `${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}`;
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
  clearTimeout(S.joinTimer);
  if (S.net) { try { S.net.send('bye', 1); } catch { /* gone */ } S.net.leave(); }
  Object.assign(S, {
    role: null, net: null, myId: 'me', hostId: null, roomName: '', password: '', listed: false,
    humans: [], stage: 'lobby', roster: [], players: {}, g: null, brains: {}, peerInputs: {}, lastSeq: {},
    outEvents: [], room: null, paused: false,
  });
  resetClientView();
}

function leave(msg, where) {
  resetSession();
  advertise();
  $('joinBtn').disabled = false;
  $('hostBtn').disabled = false;
  show('menu');
  if (msg) {
    if (where) $(where).textContent = msg;
    toast(msg);
  }
}

window.addEventListener('pagehide', () => { if (S.net) S.net.leave(); if (lobby) lobby.leave(); });

// ── Helpers ────────────────────────────────────────────────

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function cleanName(n) { return (typeof n === 'string' ? n : '').replace(/[ -]/g, '').trim().slice(0, 14) || 'Tank'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── Loop ───────────────────────────────────────────────────

const renderer = createRenderer(field);
new ResizeObserver(() => renderer.resize()).observe(field.parentElement);

// The rules run off a worker's clock, not the animation frame: browsers stop
// animation frames in a background tab, and a host that switches tabs must
// not freeze everyone else's game.
const ticker = new Worker(URL.createObjectURL(new Blob(
  ['setInterval(() => postMessage(0), 1000 / 60);'], { type: 'text/javascript' })));
let lastSim = performance.now();
ticker.onmessage = () => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastSim) / 1000);
  lastSim = now;
  if (S.screen !== 'play' || !isBoss() || !S.g) return;
  // A solo game pauses itself rather than play on without you.
  if (S.role === 'solo' && document.hidden && !S.paused && $('over').hidden) togglePause();
  if (S.paused) return;
  S.acc += dt;
  let n = 0;
  while (S.acc >= DT && n < 15) { hostTick(); S.acc -= DT; n++; }
  if (n === 15) S.acc = 0;
};

let last = performance.now();
let hudT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.screen === 'play') {
    let view = null;
    if (isBoss() && S.g) {
      view = hostView();
    } else if (S.role === 'client') {
      sendInput(now);
      view = clientView(now, dt);
    }
    renderer.draw(view, { me: S.myId, dt: S.paused ? 0 : dt, time: now / 1000 });
    hudT -= dt;
    if (hudT <= 0) { updateHud(view); hudT = 0.1; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Boot ───────────────────────────────────────────────────

buildMapSelect();
buildPowerupList();
if (window.siteTheme) {
  window.siteTheme.onChange(() => { renderer.readTheme(); buildPowerupList(); });
}
startLobby();

// Test hook for driving the page from automation.
window.__tanks = { S, input };
