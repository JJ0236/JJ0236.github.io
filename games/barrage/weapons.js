// What you can fire. Ammo is per player, per match; the shell never runs out.

export const WEAPONS = {
  shell: { name: 'Shell', note: 'plain and reliable', ammo: Infinity, kind: 'shot', r: 48, dmg: 34, gravity: 1, key: '1' },
  cluster: { name: 'Cluster', note: 'splits at the top of its arc', ammo: 3, kind: 'cluster', r: 32, dmg: 18, split: 5, gravity: 1, key: '2' },
  mortar: { name: 'Mortar', note: 'drops almost straight down', ammo: 4, kind: 'shot', r: 44, dmg: 30, gravity: 2.1, key: '3' },
  digger: { name: 'Digger', note: 'burrows in before it goes off', ammo: 3, kind: 'digger', r: 30, dmg: 28, burrow: 130, gravity: 1, key: '4' },
  strike: { name: 'Airstrike', note: 'a line of bombs from above', ammo: 2, kind: 'strike', r: 34, dmg: 20, bombs: 5, gravity: 1, key: '5' },
  mine: { name: 'Mine', note: 'left at your feet for later', ammo: 3, kind: 'mine', r: 46, dmg: 32, gravity: 1, key: '6' },
  hop: { name: 'Teleport', note: 'move where the marker lands', ammo: 2, kind: 'teleport', r: 0, dmg: 0, gravity: 1, key: '7' },
  big: { name: 'The big one', note: 'once a match', ammo: 1, kind: 'shot', r: 98, dmg: 72, gravity: 1, key: '8' },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** A player's ammo at the start of a match. */
export function startingAmmo() {
  const out = {};
  for (const [id, w] of Object.entries(WEAPONS)) out[id] = w.ammo;
  return out;
}
