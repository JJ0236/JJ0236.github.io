# cloche — a fruit fly under glass, run by its real connectome

**Date:** 2026-09-14
**Path:** `/cloche/`
**Status:** design, not built

## Purpose

A glass dome on a wooden base. Inside it, one fruit fly. Its brain is the
FlyWire connectome: every proofread neuron of an adult *Drosophila* brain,
wired the way the electron-microscope scan found it, simulated live in the
visitor's browser. The visitor feeds it, shades it, pokes it, and watches
the reaction travel from sensory neurons to motor neurons and out into the
body.

The site's tools so far are about making things. This one is a specimen
case: a small, quiet exhibit that happens to contain a working brain.

## Why this works at all (research summary)

- **The map.** FlyWire v783 (Dorkenwald et al. 2024; Schlegel et al. 2024,
  both *Nature*): 139,255 neurons, ~54.5 M synapses, 8,453 cell types.
  At the ≥5-synapse cutoff there are 2,700,513 connections between
  134,181 neurons. Class counts: optic 77,873; central 32,381; sensory
  16,938; visual projection 7,684; descending 1,305; ascending 1,750;
  motor 110.
- **The model.** Shiu et al. 2024 (*Nature* 634:210, code MIT at
  `philshiu/Drosophila_brain_model`) ran a leaky integrate-and-fire neuron
  per cell, one free weight per synapse, sign from neurotransmitter
  prediction. Driving the labellar sugar neurons made the proboscis motor
  neuron MN9 fire; adding bitter silenced it; driving antennal mechanosensory
  neurons produced grooming. 91 % of 164 predictions matched experiments.
  Parameters: V_rest = V_reset = −52 mV, threshold −45 mV, membrane τ 20 ms,
  synapse τ 5 ms, refractory 2.2 ms, delay 1.8 ms, weight 0.275 mV per
  synapse, GABA and glutamate inhibitory, everything else excitatory.
- **The data is public with no login.** Codex serves its CSVs from
  `https://storage.googleapis.com/flywire-data/codex/data/fafb/783/`:
  `connections.csv.gz` (48 MB, pre, post, neuropil, syn_count, nt_type),
  `neurons.csv.gz` (nt type per neuron), `classification.csv.gz` (class,
  side), `consolidated_cell_types.csv.gz`, `coordinates.csv.gz` (one
  point per neuron), `labels.csv.gz` (community names, has MN9).
- **Browser cost.** CSR adjacency at ≥5 synapses: Uint32 offsets 0.56 MB,
  Uint32 targets 10.8 MB, Int8 weights 2.7 MB ≈ 14 MB in RAM, 7–9 MB
  gzipped. At rest the network is silent, so an active-set scheduler makes
  real time cheap; existing plain-JS ports run the whole graph at 60 fps
  with sub-millisecond frame cost.
- **Licence.** Zenodo deposits of the connectome are CC BY 4.0; Codex's
  terms mention CC BY-NC for user annotations. joshhicks.info is
  non-commercial, so either is fine. Attribute the FlyWire Consortium,
  Princeton University; cite Dorkenwald 2024, Schlegel 2024, Shiu 2024,
  and Eckstein 2024 for the neurotransmitter predictions.
- **Prior art.** After the male-CNS release this month there are a dozen
  browser fly-brain demos (`cobanov/awesome-fly`). The ones that land share
  three things: a body the brain visibly drives, one-button stimuli with a
  fast reflex, and a small brain window flashing in sync. Nobody has done
  the specimen-under-glass framing with any care, and none matches this
  site's look. That is the gap.

## What is real and what is staged

Say this on the page, in one paragraph, because the public reads these
sims as creatures and the honesty is part of the charm.

**Real:** the wiring, the neuron count, the sign and strength of every
connection, the integrate-and-fire dynamics, and the reflexes that fall out
of them: sugar → proboscis extension, bitter cancelling sugar, water →
extension, touch → antennal grooming, looming → giant-fibre escape.

**Staged:** the body. There is no muscle model. Motor and descending neuron
firing rates are smoothed and mapped to a rigged low-poly fly. Walking
towards a droplet is a hand-written controller gated by descending-neuron
activity and a hunger drive, not something the connectome computes.

## Interactions

Everything happens by clicking or tapping inside the dome. No panels of
sliders; the sidebar holds only the brain window and a few readouts.

| Visitor does | Neurons driven (Poisson, Hz) | Real readout | Body |
|---|---|---|---|
| Drops **sugar** on the base | labellar sugar GRNs, 100 Hz once the labellum touches the drop | MN9 (rostrum), MN6 (labella) | walks to drop, proboscis extends, drop shrinks, hunger falls |
| Drops **water** | water GRNs, 100 Hz | MN9 | same, smaller reaction |
| Drops **bitter** (quinine) on a sugar drop | bitter GRNs + sugar GRNs | MN9 falls to ~0 | proboscis retracts, fly backs off |
| Passes a **shadow** over the dome (drag across the glass) | LC4 + LPLC2 looming detectors, brief 150 Hz burst | giant fibre pair | jump, wing flick, lands elsewhere |
| **Pokes** the fly (tap it) | JO-C/E Johnston's organ neurons, 140 Hz for 300 ms | aBN1/aBN2 → aDN1/aDN2 | antennal grooming with forelegs |
| Waits | nothing | descending DNa01/DNa02 | hunger rises over minutes; idle wander, occasional grooming |

Cut from version one: smell (geosmin avoidance), courtship, sleep, day and
night, naming the fly. Each is a later revision if the first version earns
it.

## Architecture

All simulation code is pure and runs under node for verification; the page
is a thin shell. This mirrors `/unfold/`.

```
cloche/
  index.html        page: header, dome viewport, sidebar with brain window
  app.js            UI, pointer → stimuli, HUD, worker messaging
  data.js           fetch + decode brain.bin into typed arrays
  brain.js          LIF simulator over CSR (pure, node-testable)
  worker.js         runs brain.js in real-time chunks, posts spikes + rates
  fly.js            procedural low-poly fly, rig, rate → pose mapping
  scene.js          dome, base, glass, lights, orbit limits, droplets
  data/brain.bin    packed connectome (~9 MB gz)
  data/groups.json  named neuron groups (root ids → index)
  data/brain.glb    simplified whole-brain surface (~200 KB)
scripts/
  build-cloche-data.mjs   Codex CSVs → brain.bin + groups.json
  verify-cloche.mjs       headless checks
```

### Data build (`scripts/build-cloche-data.mjs`)

Node script, run once, outputs committed. Downloads the six Codex files to
the scratchpad if missing, then:

1. Index neurons 0…N−1 in `neurons.csv` order. Sign per neuron: −1 if
   `nt_type` is GABA or GLUT, else +1 (Shiu's rule).
2. Sum `connections.csv` rows to (pre, post) pairs; keep pairs with total
   ≥5. Assert 2,700,513 pairs. Weight = min(syn_count, 127) × sign(pre),
   stored Int8. Build CSR by presynaptic index.
3. Position per neuron from `coordinates.csv` (first row per root id),
   quantised to Uint16 in the brain's bounding box. Class per neuron as
   Uint8 from `classification.csv` `super_class`.
4. `groups.json`: index lists for sugar GRNs, water GRNs, bitter GRNs,
   Ir94e GRNs, JO-C/E, LC4, LPLC2, GF, MN9, MN6, aBN1/2, aDN1/2, DNa01/02.
   Sources: `consolidated_cell_types.csv` primary types and
   `classification.csv` sub_class (`sugar/water` is one class in Codex, 129
   cells; split using the root-id lists in Shiu's MIT repo, which names the
   sugar, water, bitter and Ir94e sets it used). Assert every group is
   non-empty and MN9 resolves to exactly two neurons.
5. Write `brain.bin`: little-endian header (magic, N, E, bbox) then
   offsets Uint32[N+1], targets Uint32[E] (delta-encoded within a row,
   varint), weights Int8[E], positions Uint16[3N], classes Uint8[N].
   GitHub Pages gzips on the wire; no custom compression.

The brain surface comes from `navis-flybrains` (`FLYWIRE.mesh_whole_brain`,
ships in the pip package, no token), decimated to ~10 k faces with trimesh
and exported as glTF. That is the one Python step; it is documented in the
script header, not automated.

### Simulator (`cloche/brain.js`)

Exact Shiu dynamics, dt = 0.1 ms, Float32 state:

```
v[i]  += dt/τm · (g[i] − (v[i] − Vrest))
g[i]  += −dt/τs · g[i]
spike when v ≥ Vth and not refractory → v = Vreset, refractory 2.2 ms,
  push i into delay ring slot (t + 1.8 ms)
deliver: for each spiking j in the current ring slot,
  for k in offsets[j]…offsets[j+1]:  g[targets[k]] += weights[k] · 0.275 mV
```

An **active set** holds neurons whose g or v differs from rest by more than
1e-4 mV; only those are integrated. Neurons drop out when they settle.
At rest the set is empty and a step costs nothing. External drive is a
Poisson source per stimulated neuron: each step, with probability
rate·dt, add W_in to g. W_in is one constant for the whole page, starting
at ten synapse-equivalents (2.75 mV) and calibrated once by the verify
script so 100 Hz sugar drive puts MN9 in the 20–80 Hz band.

API: `createBrain(data)`, `brain.stimulate(indices, hz)`,
`brain.clearStimulus(indices)`, `brain.step(nSteps) → spikes` (Uint32
indices of neurons that fired this chunk), `brain.rate(indices, windowMs)`.

### Worker (`cloche/worker.js`)

Runs the brain in 5 ms biological chunks, targeting wall-clock real time.
Each chunk posts a transferable `Uint32Array` of spiking neuron indices and
a small `Float32Array` of smoothed rates for the readout groups. If a chunk
takes longer than 5 ms wall time, the worker keeps going and reports the
slowdown; the page shows "brain at 0.7× real time" rather than dropping
biological steps. Inline fallback when workers are unavailable, as in
`/unfold/`.

### Body (`cloche/fly.js`)

A procedural low-poly fly built from primitives in code (no external
asset): thorax and abdomen as scaled icosahedra, head with two red
compound-eye hemispheres, six three-segment legs, two flat wing planes,
antennae, and a two-segment proboscis (rostrum + labella). Materials use
the site's slate and soil tones with a faint sheen. Around 1,200 triangles.

Rate → pose mapping, all exponentially smoothed over ~50 ms:

- MN9 rate → rostrum extension angle (0 at 0 Hz, full at 40 Hz, the
  reference level in Shiu). MN6 rate → labella spread.
- GF spike (either neuron) → a 120 ms jump arc with wing flick, landing at
  a random spot on the base, 600 ms cooldown.
- aDN1/aDN2 rate above 10 Hz → foreleg grooming loop over the antennae.
- DNa01/DNa02 rate → walking gain for the controller below.

Walking controller (staged, says so on the page): a hunger scalar rises
0→1 over ~4 minutes; when hunger × nearest-droplet-attraction exceeds a
threshold the fly steers to the droplet at a speed scaled by descending
rate; otherwise it wanders in short random walks with pauses. Tripod gait
from a phase clock. When the labellum reaches a droplet the page starts
driving the matching GRNs; the drop's radius shrinks while MN9 is above
5 Hz; the stimulus stops when the drop is gone.

### Scene (`cloche/scene.js`)

Three.js 0.165 from the same CDN import map as `/unfold/`. A wooden disc
base (cylinder, soil tone, subtle ring grain via a canvas texture), a glass
cloche (`MeshPhysicalMaterial`, transmission 0.9, roughness 0.05, thin
Fresnel rim), a soft key light and a cool fill so the glass reads. Orbit
controls limited to above the base, zoom clamped so the dome never clips.
Droplets are flattened spheres: sugar amber, water clear-blue, bitter a
dull green; bitter dropped onto sugar recolours the drop. The shadow
gesture is a drag across the glass while a modifier is held (or a
"Shadow" chip in the header on touch): a dark disc sweeps across the dome
from the drag direction and casts a real shadow on the base.

### Brain window

Sidebar panel, ~300 px square, expandable to fill the viewport. One
`THREE.Points` draw call of all 139,255 positions coloured by class in
dim tones, plus the brain surface at 6 % opacity. Spikes light their point
to full brightness for a frame and decay over 150 ms via a per-point
Float32 attribute updated from the worker's spike arrays. Under the
window: live counts — neurons active, spikes per second, MN9 Hz, GF last
fired — and, while a stimulus runs, the pathway name it is exercising
("sugar GRNs → SEZ interneurons → MN9"). Clicking a named group in the
readout highlights those neurons in the window.

### Page layout

Same header and sidebar frame as `/crease/` and `/unfold/`. Viewport is
the dome; sidebar holds five chips (Sugar, Water, Bitter, Shadow, Poke; on touch
devices the base or fly is tapped after picking a chip), the brain
window, the readouts, and a short "What is real" paragraph with the
citations. Works at phone width: the sidebar collapses under the dome and
the brain window becomes a strip.

Loading: the 9 MB fetch shows a progress bar over a dark dome with the
brain surface fading in as points arrive. The file is cached by the
browser afterwards.

Project card on `/projects/` and an OG image (the dome, lit, with the brain
window inset) follow the existing pattern from `scripts/og`.

## Verification (`scripts/verify-cloche.mjs`)

Runs on the committed `brain.bin` and `groups.json` under node, no DOM:

- Header decodes; N = 139,255; E = 2,700,513; every offset row is
  monotonic; no target ≥ N; every group index resolves; MN9 has 2 members.
- At rest, 1 s of simulation produces 0 spikes and the active set is empty.
- Sugar GRNs at 100 Hz for 1 s: MN9 fires; mean rate over the last 500 ms is
  between 20 and 80 Hz (Shiu calibrated ~80 % of max at 100 Hz; accept a
  broad band, the point is qualitative agreement).
- Sugar + bitter GRNs together: MN9 rate below 5 Hz.
- Water GRNs at 100 Hz: MN9 fires.
- JO-C/E at 140 Hz: aDN1 or aDN2 fires above 10 Hz.
- LC4 + LPLC2 burst: at least one GF spike within 30 ms.
- Determinism: a seeded run reproduces its spike count.
- Throughput: 1 s of biological time with sugar drive runs in under 3 s of
  wall time on the build machine, printed, not asserted.

## Phases

1. **Brain on the bench.** Data build, `brain.js`, verify script passing
   the taste, grooming and escape checks. Nothing visual. This is where the
   project is proven or abandoned, and it is a day's work.
2. **Under glass.** Scene, fly, sugar/water/bitter droplets, brain window,
   loading. Ship this as version one.
3. **Reflexes.** Shadow escape, poke grooming, hunger and idle wander,
   project card, OG image.
4. **Maybe later.** Geosmin avoidance via Or56a ORNs, resampled skeletons
   of the featured neurons drawn as lines inside the brain window, naming
   the fly and remembering it in localStorage, a "silence this neuron"
   experiment mode.

## Open questions for Josh

- **Name and path.** `cloche` fits the one-word tool names and the glass
  dome image; `/dome/` is the plainer alternative. Recommendation: cloche.
- **Whole brain or subnet.** The full ≥5-synapse graph is ~9 MB and lets
  the page say "every neuron". A "neurons that ever fire" subset (~46 k
  neurons, ~9 MB at the unthresholded cutoff) is the same size and a
  harder story to tell. Recommendation: whole brain at ≥5.
- **The body.** Procedural in code keeps the page self-contained. A
  low-poly fly modelled in Blender and exported as glTF would look better
  and is your kind of work; the rig contract in `fly.js` (named bones:
  rostrum, labella, six legs, two wings, two antennae) would not change.
- **Tone.** The public's favourite thing to do with these sims is torment
  the fly. Shadow and poke are in; nothing crueller. Say the word if the
  line should sit elsewhere.
