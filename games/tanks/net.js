// Tanks' rooms: the shared relay code, on Tanks' own topics.

import * as net from '../shared/net.js?v=1';

const ROOT = 'joshhicks-info/tanks/v2';

export const roomKey = net.roomKey;
export const openLobby = onChange => net.openLobby(onChange, { root: ROOT });
export const openGame = (name, password, handlers, opts = {}) => net.openGame(name, password, handlers, { ...opts, root: ROOT });
