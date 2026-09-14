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

## Revision, 2026-09-14 (build)

Built and verified the same day. What changed against the design above:

- **Water is cut.** Codex v783 has one `sugar/water` sensory class and no
  separate water label set, so the water GRNs could not be picked out
  cleanly. Sugar and bitter carry the feeding demo.
- **No brain surface mesh.** `navis` does not build on this machine's Python
  3.14 (h5py wheel). The 139,255-point cloud carries the brain's shape well
  enough on its own; the glTF surface stays a later option.
- **Sugar drive is 200 Hz**, the default in Shiu's notebook. At the
  ≥5-synapse cutoff, 100 Hz gives MN9 only ~10 Hz; 200 Hz gives ~40 Hz.
- **Poisson input is Shiu's own** (w_syn × 250 = 68.75 mV per event, no
  refractory period on driven cells), not the calibrated `W_in` the design
  proposed. Driven GRNs then fire at roughly the requested rate.
- **Spike-frequency adaptation added**, 0.4 mV per spike decaying over
  150 ms. Without it the thresholded graph has a ~300-neuron loop of central,
  descending and motor cells that rings at 200 Hz forever after sugar ends.
  With it MN9 sits at 40.8 Hz under sugar (Shiu's reference level), bitter
  still silences it, the giant fibre still fires at 7 ms, and the network is
  silent within half a second of a stimulus ending. The page discloses this.
- **Grooming readout** is the six descending neurons that answer Johnston's
  organ drive most strongly in the model (the DNpe014, DNp73 and DNb06
  pairs, 69 Hz under 140 Hz JO drive). The two community "putative aDN"
  labels never fire and are kept only as a group.
- **One sugar GRN dropped**: root 720575940623172843 is labelled sugar but
  predicted glutamatergic, so the sugar group is the 22 labelled cells with
  excitatory output (19 of Shiu's 21 among them).
- **Data on disk:** `brain.bin` 15.0 MB raw, 10.0 MB gzipped;
  `groups.json` 23 KB. Build takes 10 s.
- **Speed:** at rest the brain costs nothing. Under sugar drive the active
  set is ~2,400 neurons and node runs 2.7× real time; under the full
  no-adaptation loop it was 16,000 and 0.75×. The page shows measured speed
  and never skips biological steps.
- **Rendering:** Three.js draws the transmissive dome from a buffer of
  opaque objects only, so droplets, wings and the poke ripple are opaque
  materials on purpose; transparent ones vanish behind the glass.
- **Body:** the fly is drawn at 2.8× life size so the specimen reads; a
  real fly would be a 3 mm speck on a 40 mm base.
- Headless end-to-end run (Chrome over CDP): sugar drop → walk → MN9 35–60 Hz
  → droplet shrinks; bitter on the drop → MN9 0 → drop rejected, fly walks
  off; shadow → giant fibre → jump; poke → grooming DNs 65 Hz → grooming.
  No console errors. Phone layout at 400 px checked.

## Revision, 2026-09-14 (evening): think, learn, and do

Josh asked for the fly to think, learn and do more, chose the real options
when asked, and asked for it pushed live. Decisions and what the data forced.

### What was added

- **Smells.** Two chips, Fruit and Vinegar, puff a scent onto the base: a
  stain with rising motes, a Gaussian cloud (σ 9 mm) that fades over two
  minutes. The fly smells through its real receptor neurons: fruit is the
  DM2, VM2, VM7d, VA6, DL5 and DC1 glomeruli (265 ORNs), vinegar is DM1 and
  VA2 (135). Drive is 100 Hz scaled by the cloud's intensity at the fly.
  Each smell recruits about 2.3 % of the 5,177 Kenyon cells and the two
  sets share one cell: a sparse, smell-specific code, as in the animal.
- **Learning is the fly's own rule.** Kenyon-cell → output-neuron synapses
  are depressed when the Kenyon cell fired recently (eligibility, τ 2 s)
  and dopamine reaches that output neuron's compartment (τ 200 ms). Which
  dopamine neurons teach which output neurons is the Aso et al. 2014
  compartment map, written into the build by type name: PAM reward neurons
  onto the glutamatergic avoidance-driving MBONs (01–07), PPL1 punishment
  neurons onto the approach-driving MBONs (11–18). Sugar while a smell is
  present drives the reward neurons at 20 Hz; bitter drives punishment.
  Dopamine per output neuron is normalised by the number of neurons
  teaching it, so ten PPL1 cells teach as strongly as 232 PAM cells. One
  feeding takes a smell's avoidance synapses to ~0.4 of naive; the other
  smell is untouched (1.00). Punishment takes approach synapses to ~0.7.
- **Memory panel** reads the synapses directly: for the Kenyon cells each
  smell has recruited, how far their synapses onto avoidance neurons have
  been weakened minus how far those onto approach neurons have. Positive
  is "likes", negative "avoids". The bias also steers the body: a liked
  smell pulls the heading up its gradient, a disliked one pushes it away.
- **Always-on brain.** Every sensory neuron fires at 0.3 Hz in the
  background (a sparse Poisson sampler, O(events) per step), about 5,000
  spikes a second and 4,000 active neurons at rest. Exploration pace comes
  from the mean rate of the 1,305 descending neurons and turning from their
  left–right asymmetry, with the DNa02 steering pair weighted extra; a
  wander term keeps the fly moving when they are quiet, which at this
  background they mostly are.
- **Flight bursts.** Every 35–85 s, when idle, a 3–4 s Catmull-Rom loop
  around the dome with beating wings. Body only; disclosed.
- **Persistence.** Learned synapses (sparse list of edge and multiplier),
  each smell's Kenyon-cell set and hunger are saved to localStorage every
  15 s and on page hide; about 1.4 KB after one lesson. A Forget button
  resets the mushroom body.

### What the data forced

- **The antennal lobe's local neurons had no transmitter prediction** (99
  of 159 unpredicted, some predicted cholinergic) and the build treated
  unpredicted as excitatory. That turned the first olfactory relay into a
  runaway loop: any smell, at a tenth of the taste drive, lit 53 % of the
  Kenyon cells and 470,000 spikes a second, identically for every odour.
  These neurons are GABAergic or glutamatergic in every published account
  (Chou et al. 2010), so their sign is forced negative. Ignition gone.
  19,658 neurons overall have no prediction; only this family is corrected.
- **Neuromodulators were fast excitation.** After a smell the central
  complex (PFR, hΔ, PFN, FR1) rang at over 100 Hz per cell; most of them
  use dopamine or serotonin, which act through slow receptors. Their
  synaptic effect is scaled to a tenth. That alone cleared the after-state
  in some seeds but not all.
- **Adaptation is now rate-dependent.** Each spike adds 0.4 mV of
  adaptation times (1 + a / 6 mV), so cells at 150 Hz self-limit while
  MN9 at 35 Hz barely notices. This cleared every after-state without
  touching the reflexes. A slow homeostatic ceiling (400 spikes per 10 ms
  averaged over 600 ms, 3 mV per excess 100) stays as a safety net; a
  faster, lower ceiling was tried and rejected because it silenced MN9
  whenever a smell was present.
- **Plasticity is on KC → MBON edges only** (21,438 of them). Delivery for
  Kenyon-cell spikes multiplies by a per-edge Float32; everything else is
  untouched, so the hot loop cost is one branch per spiking source.

### Numbers

- Verify: 56 checks. Sugar → MN9 33 Hz, bitter 0, GF 7 ms, grooming DNs
  53 Hz; fruit 98–115 Kenyon cells, vinegar ~120, one shared; no spikes one
  second after a smell; reward → avoidance synapses 0.40, other smell
  1.00; punishment → approach synapses 0.70; resting hum stable at ~5,000
  spikes a second over four seconds; learned state survives save and load.
- Cost: rest ~0.7 s of wall per biological second in node; sugar alone
  ~0.5; smell + sugar + reward ~3 s (14,000 active neurons). The page
  shows the measured speed; in the headless browser it read 1.0× at rest
  and 0.2–0.3× while learning. Never skips steps.
- Headless end-to-end: fruit puff + sugar drop → walk → tasting → 68
  synapses changed within 3 s → "likes" → saved 1.4 KB → survives reload →
  flight → vinegar puff recruits Kenyon cells at 200–330 a second.

### Cut

Sleep and wake (not chosen). Water (still no class). Live MBON firing as
the valence readout: fruit barely drives the output neurons in this model
(0.3 Hz), so the synapses themselves are the honest readout.

## Revision, 2026-09-15: a windowsill, friends, and eggs

Josh asked for an environment to explore, less dreary, friends "as real as
possible, eggs and everything". Chosen when asked: a sunny kitchen
windowsill; every fly with its own full brain; the real male connectome for
males; the life cycle in minutes per stage.

### The world

A kitchen windowsill in morning light. A rectangular counter (240 × 140 mm
walkable) under a window: sky and a blurred garden outside, warm key light
from the window, bright soft fill, pale painted wood and a tiled splash-
back. On it: a fruit bowl with a banana and two apple slices, an open jam
jar with a drip on its rim, a spilled drop of juice, a folded cloth. Every
object is a scent source and some are food:

| Object | Smell | Food | Egg site |
|---|---|---|---|
| banana | fruit, strong | sugar on its bruised end | yes |
| apple slices | fruit, mild | sugar on the cut face | yes |
| jam jar drip | fruit + vinegar | sugar | no |
| spilled juice | vinegar | sugar | no |

Objects are obstacles (circles in the walking plane); flies walk on the
counter and up onto the fruit (a height map so they visibly climb the
banana). The dome is gone. The old chips stay: sugar, bitter, fruit,
vinegar puffs anywhere on the counter, shadow, poke. New chip: **Add a
fly** (male or female) while the budget allows.

### Friends

Each fly is a full brain in its own worker: female flies run FlyWire v783
(`brain.bin`), males run the Janelia male CNS v1.0 (`male.bin`, CC BY
4.0, 166,701 neurons including the nerve cord). Budget: one fly per spare
core, `min(4, hardwareConcurrency − 1)`, at least one. Phones get one.
When the population would exceed the budget, the oldest adult "flies out
the window" (the window is ajar). Click a fly to select it: the brain
window, readouts, pathway and memory panel follow the selected fly.

Male brain positions: the male table has no coordinates, so each male
neuron is drawn at the centroid of its cell type in the female map;
neurons with no female match (mostly the nerve cord) are laid out below
the brain in a schematic cord. Disclosed in the brain panel.

### Courtship, mating, eggs, larvae, pupae

Real routes wherever the wiring has them; the rest is staged and says so.

- **Male notices female.** Within 20 mm and roughly facing her, the male's
  LC10a visual neurons are driven in proportion to how centred she is
  (real: LC10a → P1 is the female-tracking pathway). Touching her drives
  his tarsal pheromone gustatory neurons. Readout: **P1** firing rate is
  his courtship state.
- **Song.** With P1 up, the readout **pIP10** (the descending song command)
  gates a wing-extension song: one wing out, vibrating, pulses drawn as a
  ripple. Song intensity = pIP10 rate.
- **Female hears.** Song within 25 mm drives her **JO-A** auditory neurons
  at a rate set by song intensity and distance. Readout: **vpoDN**
  (vaginal plate opening) is her acceptance signal. A virgin whose vpoDN
  fires above threshold for two seconds accepts; a mated female's
  acceptance path is simply not driven (post-mating state is a page flag;
  the sex-peptide route is not simulated).
- **Mating.** Staged: he mounts, 20 s scaled, both brains keep running;
  then she is mated.
- **Eggs.** A mated female on an egg site: her **oviDN** neurons are driven
  (page trigger standing in for the sex-peptide → SAG → oviDN route), and
  when they fire she bends her abdomen and leaves an egg. About one egg a
  minute while on fruit, up to 12 live eggs.
- **Egg** (2 min): a 0.5 mm white ovoid with two filaments, on the fruit.
- **Larva** (6 min, three instars): a segmented pale maggot that crawls
  with peristalsis, grows ×3, stays on and around the fruit, burrows in
  briefly. No brain: the larval connectome is a different animal and a
  different dataset; staged, disclosed.
- **Pupa** (4 min): it crawls off the fruit, darkens into a brown capsule
  on the counter or jar, stays still.
- **Eclosion.** A pale soft adult of random sex climbs out, wings unfold
  over 20 s, then it gets its own brain if the budget allows (else the
  oldest adult leaves through the window first).

### Bodies

Sexes differ: males are smaller with a dark blunt abdomen tip and sex
combs on the forelegs; females larger with a pointed, striped abdomen.
Newly eclosed adults are pale for a minute. Better proportions all round.
Everything remains procedural in Three.js; Blender is on this machine and
could replace the fruit and jar with nicer meshes later.

### Files

```
cloche/world.js       the windowsill: geometry, lights, objects, height map,
                      scent sources, obstacles, egg sites, picking
cloche/flies.js       population manager: brains, budget, selection, spawn,
                      leave, per-fly stimuli, courtship coupling
cloche/lifecycle.js   eggs, larvae, pupae, eclosion (pure timers + meshes)
cloche/fly.js         sexed body, song, mount, oviposit poses
cloche/data/male.bin, male-groups.json
scripts/build-cloche-data.mjs --dataset mcns
```

### Verification additions

Male brain: format; sugar → proboscis MN; GF; sparse odour code; LC10a +
pheromone drive → P1 fires; P1 drive → pIP10 fires. Female: JO-A drive →
vpoDN fires; oviDN drive → fires. Budget logic and life-cycle timers in
node.

### Build notes, 2026-09-15

- **Male brain** (`cloche/data/male.bin`, 33 MB raw, 21 MB gzipped;
  `male-groups.json`): 166,700 neurons, 6,242,118 connections at ≥5
  synapses, from the Codex bucket's `mcns/1.0` tables. Silent at rest,
  giant fibre at 5 ms, sugar → MN9 37 Hz, bitter cancels it, fruit and
  vinegar recruit 145 and 174 Kenyon cells with none shared, no
  after-state, LC10a + tarsal pheromone → pIP10 19 Hz, P1 drive → pIP10
  70 Hz. Corrections specific to the male table: Kenyon cells are
  predicted dopaminergic there and are set cholinergic (else the modulator
  scaling would silence learning); the 163 labellar taste neurons carry no
  sugar/bitter label and are sorted by connectivity homology: each one's
  downstream cell types scored against the female sugar and bitter
  neurons' downstream types, 15 sugar, 36 bitter, 112 left unclassified.
  The male's background hum is 0.15 Hz over its 10,966 brain sensory
  neurons only; the cord's sensory neurons are left quiet.
- **Male cost.** Any strong drive touches 30,000–45,000 male neurons
  (6.2 M edges fan out further than the female's 2.7 M), so the male runs
  at roughly 0.1–0.4× real time when busy and ~1× at rest. Ceiling and
  adaptation do not shrink the active set; accepted and displayed.
- **Hearing → acceptance is bridged.** Driving the female's 94 JO-A
  neurons at any rate leaves vpoDN silent in the model. After three
  seconds of heard song the page drives vpoDN at 40 Hz for 2.5 s and reads
  its firing as acceptance. Egg laying is the same shape: oviDN is driven
  on fruit and read. Both are disclosed in the What-is-real panel.
- **Courtship in the browser** (headless run): male within 9 mm → LC10a
  26–59 Hz, pIP10 10–20 Hz, wing song; female JO-A 40–70 Hz, vpoDN pulses
  20–40 Hz; mating at 42 s; 20 s mount; she is mated. Egg laid on the
  banana through oviDN 44 Hz. No console errors. The male spent the
  courtship at 0.1× real time.
- **Bug found and fixed:** leaving food when full dereferenced a null and
  killed the frame loop; everything after it silently froze.
- **Verify:** 93 checks, none failing, including the male brain and the
  female courtship groups (hearing → vpoDN reported as soft).
- Blender is installed but unused: fruit, jar and cloth stay procedural.

### Blender models, 2026-09-15

`scripts/blender/cloche_assets.py` builds every model headlessly in
Blender 5.1 and exports glTF into `cloche/assets/`: the set (counter,
window, tiles, banana on the same curve world.js uses for climbing, plate
with two apple slices, jam jar with jam, lid and drips, spilled juice, a
cloth-simulated napkin, a fruit bowl with two oranges), a female and a
male fly, an egg, a nine-segment larva and a pupa. Textures are generated
with numpy and embedded, so there is no baking step; the whole build takes
about a minute. The fly is exported as a node hierarchy whose pivot names
(`body`, `head`, `rostrum`, `labella`, `labL/R`, `antL/R`, `abdomen`,
`hip_/femur_/knee_{L,R}{1..3}`, `wingL/R`) are the rig contract; `fly.js`
clones the model, records each pivot's rest rotation and animates offsets
from it, so the same code drives the procedural fallback body. Pitfalls
met: two flies built in one scene get suffixed node names (the first is
removed before the second is built); meshes parented to freshly created
empties must be built in the pivot's own frame, because Blender has not
evaluated the empty's world matrix yet. The page loads the models in
parallel with the brains and runs without them if any fail.

### Physical contact, 2026-09-15

Josh saw the flies passing through objects. The cause was the approximate
surface: a few hand-written height rules, circle obstacles, a body on a
flat plane and legs that never touched anything. Replaced with the real
geometry:

- **Surface by raycast.** `world.surfaceAt(x, z)` casts straight down onto
  the Blender meshes (all but wall, window and frame) with three-mesh-bvh
  accelerating it to ~0.01 ms a query, returning height and normal.
  `world.walkable(a → b)` refuses faces steeper than 58° and cliffs, so the
  jar, the bowl, the plate rim's edge and the cloth's sides are walls found
  from the geometry itself; the old circle obstacles stay as a cheap
  pre-check. Droplets, scent stains, eggs, larvae and pupae all sit on the
  surface and align to its normal.
- **Bodies follow the surface.** Each fly's root sits on the surface point
  and its up vector is the smoothed normal, so it tilts on the banana's
  curve and the plate rim.
- **Feet are planted.** Six feet live in world space; a foot stays where it
  was put until it has drifted more than a step length from its nominal
  spot under the body, then swings to a new surface point ahead of the
  motion in 55–90 ms with a lift arc, tripod groups alternating. Every
  frame a two-bone inverse-kinematics solve (hip yaw, femur, knee) reaches
  each foot, with the knee up as in insects. Feet are clamped below the
  hip and outboard so the solver never folds a leg upward.
- **Flies push apart** instead of overlapping. Feeding lowers the body and
  pitches it toward the food.
- Cost: population update 0.1 ms a frame for two flies; the headless
  software renderer needs over a second a frame for the 100 k-triangle set
  with shadows, which a GPU does in a millisecond or two.
