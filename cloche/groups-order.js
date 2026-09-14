// cloche/groups-order.js — the order of the rate vector the worker posts
// each tick, shared by worker.js and app.js.
export const RATE_ORDER = ['MN9', 'MN6', 'GF', 'groom', 'DNa01', 'DNa02', 'sugar', 'bitter', 'JO', 'LC4', 'LPLC2'];
export const RATE_INDEX = Object.fromEntries(RATE_ORDER.map((k, i) => [k, i]));
export const RATE_WINDOW_MS = 100;
