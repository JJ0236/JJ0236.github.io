// arrange/nest.js — the nesting engine. Pure, no DOM, safe in a worker.
//
// Approach follows `sparrow` (Gardeyn & Wauters 2025) rather than the
// NFP + genetic algorithm of SVGnest/Deepnest: start from a bottom-left fill so
// there is a usable layout immediately, then allow parts to overlap, measure the
// overlap, and run a guided local search that pushes them apart while the sheet
// is squeezed. Improves monotonically, so it can be stopped at any time.

import { area, bounds, boundingCircle, clean, convexDecompose, convexSeparation,
         inscribedCircle, rotate, toCCW, translate } from './geom.js';

// Deterministic RNG so a given seed reproduces a nest exactly.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const ROTATION_SETS = {
  none:  [0],
  grain: [0, 180],
  quarter: [0, 90, 180, 270],
  eighth: [0, 45, 90, 135, 180, 225, 270, 315],
  free: Array.from({ length: 24 }, (_, i) => i * 15),
};

// ── Part preparation ────────────────────────────────────────────────

// Build the immutable, rotation-indexed form the engine works with.
// `outer` and `holes` arrive in sheet units (mm) with arbitrary origin.
export function prepare(part, rotations) {
  const outer = toCCW(clean(part.outer));
  const b = bounds(outer);
  // Re-origin to the shape's bbox centre so rotation is about something stable.
  const ox = -(b.minX + b.maxX) / 2, oy = -(b.minY + b.maxY) / 2;
  const base = translate(outer, ox, oy);
  const baseHoles = (part.holes || []).map(h => translate(toCCW(clean(h)), ox, oy));

  const pieces = convexDecompose(base);
  const ic = inscribedCircle(base, baseHoles);

  const poses = rotations.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const o = rotate(base, rad);
    return {
      deg,
      outer: o,
      holes: baseHoles.map(h => rotate(h, rad)),
      pieces: pieces.map(p => rotate(p, rad)),
      bounds: bounds(o),
      bcirc: boundingCircle(o),
      icirc: { ...rotatePoint(ic, rad), r: ic.r },
    };
  });

  return {
    id: part.id,
    name: part.name,
    area: Math.abs(area(base)) - baseHoles.reduce((s, h) => s + Math.abs(area(h)), 0),
    poses,
  };
}

const rotatePoint = (p, rad) => ({
  x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
  y: p.x * Math.sin(rad) + p.y * Math.cos(rad),
});

// ── Collision ───────────────────────────────────────────────────────

// How deeply two placements violate the required clearance.
// 0 means they are fine; larger means they must move further apart.
export function depth(A, a, B, b, spacing) {
  const pa = A.poses[a.pose], pb = B.poses[b.pose];
  const dx = b.x + pb.bcirc.x - (a.x + pa.bcirc.x);
  const dy = b.y + pb.bcirc.y - (a.y + pa.bcirc.y);
  const reach = pa.bcirc.r + pb.bcirc.r + spacing;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return 0;            // bounding circles clear

  // No inscribed-circle early-accept here: the search needs the exact magnitude,
  // not a yes/no, so a definite-hit shortcut would not save the piece loop.
  // Offsets are passed through rather than materialising translated copies:
  // this is the innermost loop of the whole nester.
  const ox = b.x - a.x, oy = b.y - a.y;
  let worst = 0;
  for (const qa of pa.pieces) {
    for (const qb of pb.pieces) {
      // Only the spacing threshold matters here, never the exact gap.
      const sep = convexSeparation(qa, qb, ox, oy, spacing);
      const viol = spacing - sep;
      if (viol > worst) worst = viol;
    }
  }
  return worst;
}

// How far a placement pokes outside the usable area of the sheet.
export function outside(A, a, sheet, usableH) {
  const p = A.poses[a.pose].bounds;
  const minX = a.x + p.minX, maxX = a.x + p.maxX;
  const minY = a.y + p.minY, maxY = a.y + p.maxY;
  let d = 0;
  if (minX < sheet.margin) d = Math.max(d, sheet.margin - minX);
  if (minY < sheet.margin) d = Math.max(d, sheet.margin - minY);
  if (maxX > sheet.w - sheet.margin) d = Math.max(d, maxX - (sheet.w - sheet.margin));
  if (maxY > usableH - sheet.margin) d = Math.max(d, maxY - (usableH - sheet.margin));
  return d;
}

// ── Spatial index ───────────────────────────────────────────────────

class Grid {
  // `pad` widens neighbour queries by the required clearance. Without it, two
  // parts that violate `spacing` while their bounding boxes are still apart are
  // invisible to near(), and the clearance goes silently unenforced.
  constructor(w, h, cell, pad = 0) {
    this.pad = pad;
    this.cell = Math.max(cell, 1);
    this.cols = Math.max(1, Math.ceil(w / this.cell));
    this.rows = Math.max(1, Math.ceil(h / this.cell));
    this.buckets = new Map();
    // near() runs hundreds of thousands of times per nest. Allocating a Set per
    // call dominated the profile, so dedupe with a generation stamp into a
    // reused array instead.
    this._stamp = new Int32Array(64);
    this._gen = 0;
    this._out = [];
  }
  _grow(n) {
    if (n < this._stamp.length) return;
    const bigger = new Int32Array(Math.max(n + 1, this._stamp.length * 2));
    bigger.set(this._stamp);
    this._stamp = bigger;
  }
  key(cx, cy) { return cy * this.cols + cx; }
  range(parts, placement, pad = 0) {
    const p = parts[placement.part].poses[placement.pose].bounds;
    return {
      x0: Math.max(0, Math.floor((placement.x + p.minX - pad) / this.cell)),
      x1: Math.min(this.cols - 1, Math.floor((placement.x + p.maxX + pad) / this.cell)),
      y0: Math.max(0, Math.floor((placement.y + p.minY - pad) / this.cell)),
      y1: Math.min(this.rows - 1, Math.floor((placement.y + p.maxY + pad) / this.cell)),
    };
  }
  insert(parts, placement, idx) {
    const r = this.range(parts, placement);
    for (let cy = r.y0; cy <= r.y1; cy++)
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const k = this.key(cx, cy);
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push(idx);
      }
  }
  remove(parts, placement, idx) {
    const r = this.range(parts, placement);
    for (let cy = r.y0; cy <= r.y1; cy++)
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (!b) continue;
        const i = b.indexOf(idx);
        if (i >= 0) b.splice(i, 1);
      }
  }
  // Returns a REUSED array — valid only until the next near() call.
  near(parts, placement, skip) {
    const r = this.range(parts, placement, this.pad);
    const gen = ++this._gen;
    const out = this._out;
    out.length = 0;
    for (let cy = r.y0; cy <= r.y1; cy++)
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const i = b[k];
          if (i === skip) continue;
          this._grow(i);
          if (this._stamp[i] === gen) continue;
          this._stamp[i] = gen;
          out.push(i);
        }
      }
    return out;
  }
}

// ── Bottom-left fill ────────────────────────────────────────────────

// Lexicographic bottom-left placement: scan y upward and, within a row, x
// rightward, taking the first legal pose/position. Unlike a corner-point BLF
// this tests real geometry on a lattice, so a part can drop into another
// part's notch — which is the whole game with concave outlines.
// `noise` randomises the greedy choice (GRASP). With noise 0 this is a plain
// deterministic bottom-left fill, which converges to one layout and makes ruin
// & recreate pointless; with noise > 0 each rebuild explores a different one.
function blf(parts, queue, sheet, spacing, usableH, placements, grid, step,
             deadline = Infinity, noise = 0, rand = Math.random) {
  const skipped = [];

  for (const item of queue) {
    const A = parts[item.part];
    let best = null;
    // Past the budget we degrade to a fast path — first pose that fits, no
    // slide refinement — rather than refusing to place. The budget caps how
    // long this spends looking for a *good* spot, never whether a part is
    // placed at all; bailing out entirely would strand every remaining sheet.
    const rushed = Date.now() > deadline;
    const poseCount = rushed ? 1 : A.poses.length;

    for (let pose = 0; pose < poseCount; pose++) {
      const bb = A.poses[pose].bounds;
      const x0 = sheet.margin - bb.minX;
      const y0 = sheet.margin - bb.minY;
      const xMax = sheet.w - sheet.margin - bb.maxX;
      const yMax = usableH - sheet.margin - bb.maxY;
      if (xMax < x0 - 1e-9 || yMax < y0 - 1e-9) continue;   // pose cannot fit

      let found = null;
      for (let y = y0; y <= yMax + 1e-9 && !found; y += step) {
        let x = x0, guard = 0;
        while (x <= xMax + 1e-9 && guard++ < 5000) {
          const cand = { part: item.part, pose, x, y, inst: item.inst };
          let jump = x, clash = false;
          for (const j of grid.near(parts, cand, -1)) {
            const P = parts[placements[j].part];
            if (depth(A, cand, P, placements[j], spacing) > 1e-9) {
              clash = true;
              // Nothing left of this blocker's right edge can fit, so step past
              // it rather than crawling the lattice. Heuristic — a concave
              // profile might clear sooner — and slideDownLeft recovers those.
              const bj = P.poses[placements[j].pose].bounds;
              const past = placements[j].x + bj.maxX + spacing - bb.minX;
              if (past > jump) jump = past;
            }
          }
          if (!clash) { found = cand; break; }
          x = Math.max(x + step, jump);
        }
      }
      if (!found) continue;

      // Pick the pose on its raw landing spot and slide only the winner.
      // Sliding all four rotations quadrupled the cost of the initial fill and
      // left no budget at all for the improvement loop.
      const fb = A.poses[found.pose].bounds;
      const wobble = noise > 0 ? rand() * noise * 1000 : 0;
      const score = (found.y + fb.maxY) * 1000 + (found.x + fb.minX) + wobble;
      if (!best || score < best.score) best = { cand: found, score };
    }

    if (best) {
      let cand = best.cand;
      if (!rushed) {
        const bb = A.poses[cand.pose].bounds;
        cand = slideDownLeft(parts, placements, grid, A, cand, sheet, spacing, usableH,
                             Math.max(step, bb.h * 0.3));
      }
      placements.push(cand);
      grid.insert(parts, cand, placements.length - 1);
    } else {
      skipped.push(item);
    }
  }
  return skipped;
}

// True when a part genuinely cannot go on an empty sheet at any rotation —
// the only honest reason to report something unplaced.
export function fitsOnSheet(part, sheet) {
  return part.poses.some(p => {
    const b = p.bounds;
    return b.w <= sheet.w - 2 * sheet.margin + 1e-9 && b.h <= sheet.h - 2 * sheet.margin + 1e-9;
  });
}

// Greedy descent toward the bottom-left corner, halving the step as it sticks.
function slideDownLeft(parts, pl, grid, A, start, sheet, spacing, usableH, step0, skipIdx = -1) {
  const legal = cand => {
    if (outside(A, cand, sheet, usableH) > 1e-9) return false;
    for (const j of grid.near(parts, cand, skipIdx))
      if (depth(A, cand, parts[pl[j].part], pl[j], spacing) > 1e-9) return false;
    return true;
  };
  const score = c => c.y * 1000 + c.x;

  let cur = start;
  for (let step = step0; step > 0.15; step *= 0.5) {
    let progress = true, guard = 0;
    while (progress && guard++ < 60) {
      progress = false;
      for (const [dx, dy] of [[0, -1], [-1, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
        const cand = { ...cur, x: cur.x + dx * step, y: cur.y + dy * step };
        if (score(cand) < score(cur) - 1e-9 && legal(cand)) { cur = cand; progress = true; }
      }
    }
  }
  return cur;
}

// ── Gravity settle ──────────────────────────────────────────────────

// Pull each part down-and-left, trying every pose. Poses are explored by
// sliding from the part's current spot rather than requiring the rotated pose
// to already be legal there, so "rotate, then drop into the notch" is reachable.
function settle(parts, pl, sheet, spacing, usableH, grid, sweeps = 2, deadline = Infinity) {
  const score = c => c.y * 1000 + c.x;
  let moved = false;

  for (let sweep = 0; sweep < sweeps; sweep++) {
    const order = pl.map((_, i) => i).sort((a, b) => pl[a].y - pl[b].y);

    for (const i of order) {
      // Checked per part, not per sweep: settling 100 parts across four poses
      // each is easily seconds of work and used to blow the whole budget.
      if (Date.now() > deadline) return moved;
      const A = parts[pl[i].part];
      grid.remove(parts, pl[i], i);

      let best = pl[i], bestScore = score(best);
      const bb = A.poses[best.pose].bounds;
      const step0 = Math.max(0.6, Math.max(bb.w, bb.h) * 0.4);

      for (let pose = 0; pose < A.poses.length; pose++) {
        const seed = pose === pl[i].pose ? pl[i] : { ...pl[i], pose };
        const landed = slideDownLeft(parts, pl, grid, A, seed, sheet, spacing, usableH, step0, i);
        // slideDownLeft only ever accepts legal positions, but its seed may be
        // illegal for a rotated pose, in which case it returns that seed.
        if (!isLegal(parts, pl, grid, A, landed, sheet, spacing, usableH, i)) continue;
        if (score(landed) < bestScore - 1e-9) { best = landed; bestScore = score(landed); moved = true; }
      }

      pl[i] = best;
      grid.insert(parts, best, i);
    }
  }
  return moved;
}

function isLegal(parts, pl, grid, A, cand, sheet, spacing, usableH, skipIdx) {
  if (outside(A, cand, sheet, usableH) > 1e-9) return false;
  for (const j of grid.near(parts, cand, skipIdx))
    if (depth(A, cand, parts[pl[j].part], pl[j], spacing) > 1e-9) return false;
  return true;
}

// ── Public entry point ──────────────────────────────────────────────

/**
 * Nest `items` onto sheets.
 * items:  [{ part: <index into parts>, inst: <instance id> }]
 * parts:  output of prepare()
 * Returns { sheets: [[placement]], density, unplaced }
 */
export function nest({ parts, items, sheet, spacing = 0, timeMs = 8000,
                       seed = 1, onProgress, shouldStop, contactReward = 0,
                       jitterSamples = 6, teleportSamples = 2 } = {}) {
  const rand = rng(seed);
  const opts = { jitterSamples, teleportSamples };
  const deadline = Date.now() + timeMs;

  // Big parts first: they are the hard ones to fit later.
  let queue = items.slice().sort((a, b) => parts[b.part].area - parts[a.part].area);

  const sheets = [];
  let guard = 0;

  while (queue.length && guard++ < 200) {
    // Out of time but parts remain: keep filling sheets, just stop optimising.
    // Returning a fast mediocre nest beats returning an incomplete one, so
    // there is no break here — sheetDeadline below lands in the past and the
    // improvement loop skips itself.

    const cell = Math.max(
      8,
      Math.max(...queue.map(q => {
        const b = parts[q.part].poses[0].bounds;
        return Math.max(b.w, b.h);
      })) / 2
    );
    const grid = new Grid(sheet.w, sheet.h, cell, spacing);
    const placements = [];
    let usableH = sheet.h;

    const step = Math.max(1, Math.min(spacing || Infinity, 2));
    let skipped = blf(parts, queue, sheet, spacing, usableH, placements, grid, step, deadline);

    if (!placements.length) break;                    // nothing fits at all

    settle(parts, placements, sheet, spacing, usableH, grid, 2, deadline);

    // Incumbent = the best feasible layout seen for this sheet.
    let incumbent = placements.map(p => ({ ...p }));
    let incumbentH = usedHeight(parts, placements, sheet);

    // Improvement is ruin & recreate rather than sparrow's overlap-repair.
    // Sparrow reaches its published densities by evaluating millions of
    // samples a second in Rust; in JS over a few seconds, random-jitter repair
    // of a globally squeezed layout almost never converges. Tearing out a
    // subset and rebuilding it with the bottom-left sweep is far more
    // effective here, and has the property that every candidate it ever
    // produces is already feasible, so an invalid nest cannot be returned.
    const sheetDeadline = Math.min(deadline, Date.now() + remainingFor(sheets.length, queue, parts, sheet, deadline));

    // Working layout wanders; `incumbent` only ever records the best seen.
    // Accepting equal-height candidates is what makes this work: it lets the
    // search drift sideways across a plateau instead of rejecting everything
    // that is not an immediate improvement.
    const scoreOf = pl => {
      const c = compactness(parts, pl, sheet);
      return c.height * 10000 + c.mean;
    };
    const startedSheet = Date.now();
    let cur = incumbent.map(p => ({ ...p }));
    let curScore = scoreOf(cur);
    let iters = 0, accepts = 0;

    while (Date.now() < sheetDeadline) {
      if (shouldStop && shouldStop()) break;
      iters++;

      const keep = [], torn = [];
      const noise = rand() < 0.5 ? 0 : 0.5 + rand() * 4;
      const ruinFrac = 0.10 + rand() * 0.30;
      for (const p of cur) {
        if (rand() < ruinFrac) torn.push({ part: p.part, inst: p.inst });
        else keep.push({ ...p });
      }
      if (!torn.length) continue;

      // Largest first rebuilds better, but not always — shuffling sometimes
      // is what finds the arrangements a pure greedy order cannot.
      torn.sort((a, b) => parts[b.part].area - parts[a.part].area);
      if (rand() < 0.35) {
        for (let k = torn.length - 1; k > 0; k--) {
          const j = (rand() * (k + 1)) | 0;
          [torn[k], torn[j]] = [torn[j], torn[k]];
        }
      }

      rebuild(grid, parts, keep);
      const failed = blf(parts, torn, sheet, spacing, sheet.h, keep, grid, step, sheetDeadline, noise, rand);
      if (failed.length) { if(globalThis.__LOG) globalThis.__fails=(globalThis.__fails||0)+1; continue; }

      settle(parts, keep, sheet, spacing, sheet.h, grid, 1, sheetDeadline);
      const sc = scoreOf(keep);

      // Accepting only non-worsening moves leaves the search stuck on a
      // plateau once every rebuild ties. A little annealing lets it climb out.
      const worse = sc - curScore;
      const temp = Math.max(1e-6, 400 * (sheetDeadline - Date.now()) / Math.max(1, sheetDeadline - startedSheet));
      const accept = worse <= 1e-6 || rand() < Math.exp(-worse / temp);
      if (accept) {
        cur = keep.map(p => ({ ...p }));
        curScore = sc;
        accepts++;
        const h = usedHeight(parts, keep, sheet);
        if (h < incumbentH - 1e-6) {
          incumbent = keep.map(p => ({ ...p }));
          incumbentH = h;
          if (onProgress) onProgress(snapshot(parts, sheets, incumbent, sheet, items.length));
        }
      }
    }
    if (globalThis.__LOG) console.error(`    sheet ${sheets.length}: ${iters} iters, ${globalThis.__fails||0} rebuild-fails, ${accepts} accepted, h ${usedHeight(parts, incumbent, sheet).toFixed(1)}`);

    for (let i = 0; i < placements.length; i++) placements[i] = { ...incumbent[i] };
    placements.length = incumbent.length;
    rebuild(grid, parts, placements);

    // The compression freed room at the top — try the rejects again.
    if (skipped.length) {
      for (let i = 0; i < placements.length; i++) placements[i] = { ...incumbent[i] };
      rebuild(grid, parts, placements);
      const still = blf(parts, skipped, sheet, spacing, sheet.h, placements, grid, step, deadline + 2000);
      incumbent = placements.map(p => ({ ...p }));
      skipped = still;
    }

    sheets.push(incumbent);
    if (onProgress) onProgress(snapshot(parts, sheets.slice(0, -1), incumbent, sheet, items.length));

    if (skipped.length >= queue.length) break;        // no progress, stop looping
    queue = skipped;
  }

  const placedCount = sheets.reduce((s, sh) => s + sh.length, 0);
  return {
    sheets,
    unplaced: items.length - placedCount,
    ...density(parts, sheets, sheet),
  };
}

// Rough share of the remaining budget for the sheet being worked on, so a
// single-sheet job spends everything and a ten-sheet job still finishes.
function remainingFor(done, queue, parts, sheet, deadline) {
  const left = Math.max(0, deadline - Date.now());
  const areaLeft = queue.reduce((s, q) => s + parts[q.part].area, 0);
  const perSheet = sheet.w * sheet.h * 0.7;
  const expect = Math.max(1, Math.ceil(areaLeft / perSheet));
  return Math.max(500, left / expect);
}

function rebuild(grid, parts, placements) {
  grid.buckets.clear();
  placements.forEach((p, i) => grid.insert(parts, p, i));
}

// usedHeight alone is a terrible search objective: it is a max over parts, so
// nearly every rebuild ties and the search has no gradient. Blending in the
// summed top edge gives continuous downward pressure — the layout settles, and
// the height drop follows once the top part finally has somewhere to go.
function compactness(parts, placements, sheet) {
  let top = 0, sum = 0;
  for (const p of placements) {
    const bb = parts[p.part].poses[p.pose].bounds;
    const t = p.y + bb.maxY;
    if (t > top) top = t;
    sum += t;
  }
  const n = placements.length || 1;
  return { height: top + sheet.margin, mean: sum / n };
}

function usedHeight(parts, placements, sheet) {
  let maxY = sheet.margin;
  for (const p of placements) {
    const bb = parts[p.part].poses[p.pose].bounds;
    if (p.y + bb.maxY > maxY) maxY = p.y + bb.maxY;
  }
  return maxY + sheet.margin;
}

// The tallest single part sets a hard floor on how far we can compress.
function minHeight(parts, placements, sheet) {
  let tallest = 0;
  for (const p of placements) {
    const bb = parts[p.part].poses[p.pose].bounds;
    if (bb.h > tallest) tallest = bb.h;
  }
  return tallest + 2 * sheet.margin;
}

function density(parts, sheets, sheet) {
  const used = sheets.reduce((s, sh) =>
    s + sh.reduce((t, p) => t + parts[p.part].area, 0), 0);
  const total = sheets.length * sheet.w * sheet.h;
  return { density: total > 0 ? used / total : 0, usedArea: used, sheetArea: total };
}

function snapshot(parts, done, current, sheet, totalItems) {
  const sheets = [...done, current];
  return { sheets, ...density(parts, sheets, sheet), totalItems };
}
