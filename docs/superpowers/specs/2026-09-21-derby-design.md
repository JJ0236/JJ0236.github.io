# Derby: design

A 3D demolition derby at `/games/derby/`, the second game on `/games/`.
Up to six cars, bots fill empty seats, online rooms reuse the Tanks room
system. Last car running wins the round.

## Decisions (Josh, 2026-09-21)

- 3D, chase camera. Three.js for drawing, Rapier (WASM) for physics.
- Out of the round if the car is **wrecked** (engine dies) **or falls off**
  the raised arena.
- Destruction: **dents + parts fly off**. Panels deform at the hit, parts
  hang loose at half health and break away at zero.
- Hazards: crumbling edges, falling containers, hydraulic crushers, ramps
  + bowl + pits. All four.
- Up to **6 cars**, bots fill empty seats.
- Chunky low-poly cars **built in code** from separate parts.
- Version one includes car types, boost + handbrake, pickups, slow-mo and
  a kill-cam.
- Netcode: **approach A**. The host runs the physics and streams car state;
  each guest predicts its own car and is corrected toward the host.
- Build order: drive and crash solo → arena hazards → multiplayer → depth.

## Files (`games/derby/`)

| file | job |
|---|---|
| `index.html` | the one game window (same chrome as Tanks) |
| `cars.js` | car classes and their part layout. Pure data |
| `arena.js` | the arena: floor height grid, ramps, pits, crusher and drop spots. Pure data |
| `sim.js` | the rules and physics. Takes Rapier as an argument, no DOM, runs in node |
| `bots.js` | bot driving |
| `render.js` | Three.js scene: arena, car meshes, dents, debris, smoke, fire, camera, kill-cam |
| `game.js` | menus, rooms, the loop |
| `sim.test.mjs` | node tests (`RAPIER=<path to rapier.mjs> node --test games/derby/sim.test.mjs`) |

Networking moves from `games/tanks/net.js` to `games/shared/net.js`, taking
the topic root as an option. `games/tanks/net.js` becomes a thin wrapper, so
Tanks keeps its import path and its topics.

## Car

- One rigid body per car: a cuboid chassis plus a smaller cabin cuboid. It is
  driven by Rapier's `DynamicRayCastVehicleController`: wheels are
  suspension rays, not bodies.
- **What you see is built like a real derby car**, though the physics stays
  one box: a steel frame (rails, cross members, floor pan, firewall,
  engine, fuel cell), panels bolted to it (nose, tail, fenders, quarters,
  rockers, doors, hood, boot), a cabin of pillars with glass between them,
  and a roll cage with door bars. Take a door off and the cage shows.
- A part can be several panels: `parts[id].meshes` all dent, and
  `parts[id].group` is what flies off when the part detaches.
- Parts: front bumper, rear bumper, hood, trunk, left doors, right doors,
  roof, four wheels. Each has health and a zone (front, rear, left, right,
  top).
- A hit is a contact force event above a threshold. Damage scales with the
  force and goes to the zone the contact point is in, in the car's own frame.
  The car doing the ramming takes less than the car being rammed, weighted by
  which zones touched.
- **The engine is in the front.** Front hits hurt the engine a lot, others a
  little. Under 25% it loses a little power (never below 88%), under 40% it
  smokes, under 15% it burns, at 0 the car is wrecked.
- Scenery (poles, ramp sides, landed containers) does a quarter of the
  damage, and never more than about 14% of an engine in one hit. Driving in reverse into people protects the engine,
  as in real derbies.
- Wrecks stay in the arena as heavy obstacles.
- A lost wheel is removed from the controller and replaced by a low-friction
  scraping ball at that corner: the car sags and pulls.
- Dents: a hit event (car, local point, local direction, depth) pushes panel
  vertices within a radius inward with falloff, capped. Every client applies
  the same events, so dents match.
- Parts hang loose at half health (animation only) and detach at zero.
  Detached parts are **drawn only**: the renderer throws them with simple
  ballistics, bounces them off the floor and lets cars kick them. They
  never enter the physics, so they cannot push a car or differ between
  host and guests. At most 60; the oldest go first.
- **The rammer takes less.** When two cars meet, the one driving into the
  other harder takes 0.55× and the one rammed 1.2×; near-equal closing
  speeds split evenly. A crash is gathered per car pair over 6 ticks, so a
  chassis and a cabin touching the same car count once.
- **Ramming never kills the rammer.** One crash does at most 26 damage to
  the rammer before zones and armour (38 to each in an even head-on), so a
  full-speed sedan loses about a fifth of its engine ramming a bus. The car
  being rammed takes the full hit and can be wrecked by one. Contact within 25 ticks of a
  crash between the same pair is a scrape at 40%. A roof hit needs a
  vertical contact with something above you.
- Engine share by zone: front 1.0, top 0.65, sides 0.3, rear 0.22. A side
  hit tears doors off more than it kills the engine.
- Cars never sleep in Rapier: the vehicle controller's engine force does not
  wake a sleeping body.

## Car classes

| class | mass | power | armour | note |
|---|---|---|---|---|
| compact | light | high | 0.8 | quick, fragile |
| sedan | medium | medium | 1.0 | balanced |
| pickup | heavy | medium | 1.25 | tough, slow to turn |
| bus | very heavy | low | 1.6 | a battering ram |

## Arena: "The Quarry"

- A raised square platform, 120 m across (30 cells of 4 m), over a drop. A car below
  `y = -8` is out.
- The floor is a height grid (trimesh collider): a shallow bowl in the
  middle, four pits near the corners, and four ramps facing the bowl.
- **Crumbling edges.** From 45 s into a round, the outer ring of floor cells
  cracks (red warning, 3 s) then falls away, one ring every 12 s, down to a
  minimum. The trimesh is rebuilt when cells drop. The falling slab is debris.
- **Falling containers.** Every 7–10 s a spot is picked, biased toward cars.
  A shadow and ring show for 2.5 s, then a heavy container drops from 30 m.
  It crushes whatever it lands on (big top damage) and stays as an obstacle.
  At most four exist; the oldest sinks away.
- **Crushers.** Four hydraulic presses near the corners on a cycle: up,
  shaking warning, slam, hold, rise. A car under the plate at the bottom
  takes heavy top damage and a flattened roof.

## Driving

W/S throttle and reverse, A/D steer, Space handbrake (rear wheels lose grip
for drift turns), Shift boost (a meter that refills slowly), C look back,
R flip the car upright when stuck (3 s cooldown), Esc menu. Desktop only,
like Tanks.

## Pickups

At most three on the floor, respawning: **repair** (+40 engine),
**armour** (half damage, 12 s), **plough** (front damage dealt ×2, taken ×0.3,
15 s, a blade appears on the bumper), **boost** (fills the meter).

## Rounds

3 s countdown, then last car running wins. Once every person in the match
is out, the round ends 3 s later (time for the kill-cam) and the bot with
the healthiest engine takes it: nobody has to watch bots circle. A match is first to N round wins
(3 by default). Crumbling guarantees an end; if two cars are still running
at 4 minutes, the healthier engine wins.

## Slow-mo and kill-cam

Solo: a big hit involving the player slows time to 30% for about a second.
Online the sim cannot slow down, so the renderer keeps the last four seconds
of car positions and plays a slow **kill-cam** replay when the player is
wrecked or wins the round. Both work in solo.

## Netcode (approach A)

- Host (or solo) runs the sim at 60 Hz on the main thread, driven by a
  worker's clock as in Tanks, so a background host tab keeps going. (A
  tick costs well under a millisecond, so moving Rapier itself into a
  worker was not needed.)
- Guest input: the host consumes one per tick in order; when input is
  late it holds the last one for 12 ticks, then eases off; only a backlog
  over 24 (direct) or 40 (relay) is dropped.
- A correction nudges position, velocity and rotation, and the same nudge
  is applied to the guest's stored predictions, so the next snapshot does
  not measure and correct the same miss again.
- Snapshots at 30 Hz over the direct WebRTC channel, 7.5 Hz over the relay.
  A car's state is position, rotation, linear and angular velocity, steering,
  engine health, boost and flags. Containers and crushers ride along.
- Events (dent, detach, eliminate, crumble, drop, pickup, round) are sent
  once and repeated in the next few snapshots so a lost packet does not lose
  them.
- Guests number their inputs per tick; the host consumes one per tick and
  acks the last used. The guest runs its own local Rapier world (the arena,
  its own car as a real body, other cars as kinematic stand-ins at their
  interpolated positions). When a snapshot arrives, the guest compares the
  host's state of its car with what it predicted at the acked tick and
  blends the difference in, snapping when it is large (a big hit).
- `PROTOCOL` constant checked on join, `?v=` on every import, as in Tanks.

## UI

The Tanks window: title bar (wordmark, cars left, round), 3D view, status bar
(engine, boost, damage, connection). Title screen over a bot match with an
orbiting camera. Host, join, how to play, room (with a car class choice for
each player), pause, match-over screens. No em dashes in any copy.

## Testing

`sim.test.mjs` in node: a car drives and turns, a ram damages the rammed
car's zone, parts detach at zero, an engine at zero wrecks the car, a car
off the edge is out, crumbling removes rings, a crusher wrecks a car under
it, bots finish a round, snapshots round-trip. Browser checks in headless
Chrome: the page loads with no console errors, a solo round plays through,
and two tabs play online.
