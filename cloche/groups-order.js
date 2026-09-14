// cloche/groups-order.js — the order of the rate vector the worker posts
// each tick, shared by worker.js and app.js.
export const RATE_ORDER = ['MN9', 'MN6', 'GF', 'groom', 'DNa01', 'DNa02', 'sugar', 'bitter', 'JO', 'LC4', 'LPLC2',
  'fruit', 'vinegar', 'KC', 'MBON_approach', 'MBON_avoid', 'PAM', 'PPL1', 'DN_L', 'DN_R', 'DNa02_L', 'DNa02_R',
  'JO_A', 'vpoDN', 'oviDN', 'P1', 'pIP10', 'vPR6', 'LC10a', 'tpGRN'];
export const RATE_INDEX = Object.fromEntries(RATE_ORDER.map((k, i) => [k, i]));
export const RATE_WINDOW_MS = 100;
export const BACKGROUND_HZ = 0.3;     // resting firing of every sensory neuron
export const SAVE_VERSION = 3;
