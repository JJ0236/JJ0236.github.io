// The four kinds of car and the pieces each is built from. Pure data: the
// sim reads the sizes and handling, the renderer builds meshes from the
// parts, and both agree on part ids because they come from here.
//
// A car's own frame: +x forward, +y up, +z to the right. The origin is the
// middle of the chassis box.

export const CLASSES = {
  compact: {
    name: 'Compact', note: 'quick and fragile',
    mass: 950, power: 5200, armour: 0.8, maxSpeed: 27, steer: 0.62,
    L: 3.7, W: 1.72, H: 0.62,                 // chassis box
    cabin: { L: 1.9, H: 0.62, x: -0.25, inset: 0.1 },
    wheel: { r: 0.34, front: 1.2, rear: -1.2, z: 0.78, rest: 0.32 },
    bumper: 0.22,
  },
  sedan: {
    name: 'Sedan', note: 'the all-rounder',
    mass: 1350, power: 6600, armour: 1.0, maxSpeed: 25, steer: 0.56,
    L: 4.5, W: 1.86, H: 0.66,
    cabin: { L: 2.25, H: 0.66, x: -0.2, inset: 0.12 },
    wheel: { r: 0.37, front: 1.45, rear: -1.45, z: 0.84, rest: 0.34 },
    bumper: 0.26,
  },
  pickup: {
    name: 'Pickup', note: 'heavy and tough',
    mass: 1900, power: 8400, armour: 1.25, maxSpeed: 23, steer: 0.5,
    L: 5.0, W: 2.0, H: 0.8,
    cabin: { L: 1.7, H: 0.8, x: 0.55, inset: 0.1 },
    wheel: { r: 0.44, front: 1.7, rear: -1.55, z: 0.9, rest: 0.38 },
    bumper: 0.3,
    bed: true,
  },
  bus: {
    name: 'School bus', note: 'a slow battering ram',
    mass: 3600, power: 13500, armour: 1.6, maxSpeed: 19, steer: 0.44,
    L: 7.4, W: 2.3, H: 1.0,
    cabin: { L: 5.9, H: 1.25, x: -0.55, inset: 0.04 },
    wheel: { r: 0.5, front: 2.5, rear: -2.1, z: 1.0, rest: 0.4 },
    bumper: 0.34,
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

// Part ids, in a fixed order: snapshots pack one digit per part in this order.
export const PART_IDS = ['bumperF', 'hood', 'bumperR', 'trunk', 'doorL', 'doorR', 'roof', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
export const WHEEL_PARTS = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

/**
 * The pieces of a car, in its own frame. Each has a box (size, pos), a
 * zone that hits in that zone wear down, and a hinge: the point it swings
 * about when it hangs loose, and the axis it swings around.
 */
export function partsFor(clsId) {
  const c = CLASSES[clsId];
  const hl = c.L / 2, hw = c.W / 2, hh = c.H / 2;
  const cab = c.cabin;
  const cabFront = cab.x + cab.L / 2, cabRear = cab.x - cab.L / 2;
  const b = c.bumper;
  const w = c.wheel;
  const top = hh;                       // top of the chassis box
  const skin = 0.06;
  const parts = [];
  const add = p => parts.push({ hp: 100, ...p });

  // The fixed tub the loose parts hang on. Never comes off, still dents.
  add({ id: 'body', zone: null, size: [c.L - 0.1, c.H - 0.12, c.W - 0.1], pos: [0, -0.04, 0], fixed: true });
  // The cabin block with its glass. Also fixed; the roof panel sits on it.
  add({ id: 'cabin', zone: null, size: [cab.L, cab.H - skin, c.W - cab.inset * 2], pos: [cab.x, top + (cab.H - skin) / 2, 0], fixed: true, glass: true });

  add({ id: 'bumperF', zone: 'front', size: [b, 0.28, c.W + 0.04], pos: [hl + b / 2 - 0.04, -hh + 0.2, 0], hinge: { p: [hl, -hh + 0.2, -hw], axis: [1, 0, 0], sign: 1 } });
  add({ id: 'bumperR', zone: 'rear', size: [b, 0.28, c.W + 0.04], pos: [-hl - b / 2 + 0.04, -hh + 0.2, 0], hinge: { p: [-hl, -hh + 0.2, hw], axis: [1, 0, 0], sign: -1 } });

  const hoodL = hl - cabFront - 0.02;
  add({ id: 'hood', zone: 'front', size: [hoodL, skin, c.W - 0.08], pos: [cabFront + hoodL / 2 + 0.01, top + skin / 2, 0], hinge: { p: [cabFront, top, 0], axis: [0, 0, 1], sign: 1 } });

  if (c.bed) {
    // A pickup's tailgate: the bed behind the cab is open.
    add({ id: 'trunk', zone: 'rear', size: [skin, 0.5, c.W - 0.08], pos: [-hl + 0.05, top + 0.25, 0], hinge: { p: [-hl + 0.05, top, 0], axis: [0, 0, 1], sign: 1 } });
  } else {
    const trunkL = cabRear + hl - 0.02;
    add({ id: 'trunk', zone: 'rear', size: [trunkL, skin, c.W - 0.08], pos: [cabRear - trunkL / 2 - 0.01, top + skin / 2, 0], hinge: { p: [cabRear, top, 0], axis: [0, 0, 1], sign: -1 } });
  }

  const doorL = Math.min(cab.L * 0.9, c.L * 0.55);
  const doorX = cab.x + (c.bed ? 0 : 0.05);
  const doorH = c.H * 0.8 + cab.H * 0.45;
  const doorY = top - c.H * 0.8 + doorH / 2;
  add({ id: 'doorL', zone: 'left', size: [doorL, doorH, skin], pos: [doorX, doorY, -hw - skin / 2], hinge: { p: [doorX + doorL / 2, doorY, -hw], axis: [0, 1, 0], sign: -1 } });
  add({ id: 'doorR', zone: 'right', size: [doorL, doorH, skin], pos: [doorX, doorY, hw + skin / 2], hinge: { p: [doorX + doorL / 2, doorY, hw], axis: [0, 1, 0], sign: 1 } });

  add({ id: 'roof', zone: 'top', size: [cab.L + 0.08, skin, c.W - cab.inset * 2 + 0.08], pos: [cab.x, top + cab.H - skin / 2, 0], hinge: { p: [cab.x - cab.L / 2, top + cab.H, 0], axis: [0, 0, 1], sign: 1 } });

  // Wheels: drawn where the suspension puts them, so pos is only the rest spot.
  const wy = -hh + 0.12 - w.rest;
  for (const [id, x, z] of [['wheelFL', w.front, -w.z], ['wheelFR', w.front, w.z], ['wheelRL', w.rear, -w.z], ['wheelRR', w.rear, w.z]]) {
    add({ id, zone: null, wheel: true, size: [w.r * 2, w.r * 2, w.r * 0.9], pos: [x, wy, z] });
  }
  return parts;
}

/** Where each wheel's suspension is fixed to the chassis, in the car frame. */
export function wheelMounts(clsId) {
  const c = CLASSES[clsId];
  const w = c.wheel;
  const y = -c.H / 2 + 0.12;
  return [[w.front, y, -w.z], [w.front, y, w.z], [w.rear, y, -w.z], [w.rear, y, w.z]];
}

export const CAR_COLOURS = ['#C2452F', '#2F6FA8', '#D9A21B', '#4E8A3E', '#8C4FA3', '#D56F21'];
