// cloche/data.js — decoder for cloche/data/brain.bin, shared by the page and
// the node scripts. Layout (little-endian):
//   "CLO1"  Uint8[4]
//   N, E    Uint32
//   bbox    Float32[6]  minx miny minz maxx maxy maxz, nanometres
//   offsets Uint32[N+1] CSR row starts by presynaptic neuron
//   targets Uint32[E]   postsynaptic index, ascending within a row
//   weights Int8[E]     signed synapse count, clipped to ±127; sign is the
//                       presynaptic neuron's neurotransmitter (GABA/GLUT −)
//   pos     Uint16[3N]  position quantised into bbox
//   cls     Uint8[N]    index into CLASS_NAMES

export const MAGIC = 'CLO1';
export const CLASS_NAMES = ['optic', 'central', 'sensory', 'visual_projection', 'descending', 'ascending', 'motor', 'endocrine', 'other'];

export function decodeBrain(buffer) {
  const u8 = new Uint8Array(buffer);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== MAGIC) throw new Error(`brain.bin: bad magic "${magic}"`);
  const dv = new DataView(buffer);
  const n = dv.getUint32(4, true);
  const e = dv.getUint32(8, true);
  const bbox = new Float32Array(6);
  for (let i = 0; i < 6; i++) bbox[i] = dv.getFloat32(12 + 4 * i, true);
  let p = 36;
  const offsets = new Uint32Array(buffer, p, n + 1); p += 4 * (n + 1);
  const targets = new Uint32Array(buffer, p, e); p += 4 * e;
  const weights = new Int8Array(buffer, p, e); p += e;
  p = (p + 1) & ~1;
  const pos = new Uint16Array(buffer, p, 3 * n); p += 6 * n;
  const cls = new Uint8Array(buffer, p, n); p += n;
  if (p > buffer.byteLength) throw new Error('brain.bin: truncated');
  return { n, e, bbox, offsets, targets, weights, pos, cls };
}

export function encodeBrain({ n, e, bbox, offsets, targets, weights, pos, cls }) {
  let size = 36 + 4 * (n + 1) + 4 * e + e;
  size = (size + 1) & ~1;
  size += 6 * n + n;
  const buffer = new ArrayBuffer(size);
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
  const dv = new DataView(buffer);
  dv.setUint32(4, n, true); dv.setUint32(8, e, true);
  for (let i = 0; i < 6; i++) dv.setFloat32(12 + 4 * i, bbox[i], true);
  let p = 36;
  new Uint32Array(buffer, p, n + 1).set(offsets); p += 4 * (n + 1);
  new Uint32Array(buffer, p, e).set(targets); p += 4 * e;
  new Int8Array(buffer, p, e).set(weights); p += e;
  p = (p + 1) & ~1;
  new Uint16Array(buffer, p, 3 * n).set(pos); p += 6 * n;
  new Uint8Array(buffer, p, n).set(cls);
  return buffer;
}

/** Dequantise positions to Float32 nanometres, centred on the bbox middle. */
export function positionsNm({ n, bbox, pos }) {
  const out = new Float32Array(3 * n);
  const cx = (bbox[0] + bbox[3]) / 2, cy = (bbox[1] + bbox[4]) / 2, cz = (bbox[2] + bbox[5]) / 2;
  const sx = (bbox[3] - bbox[0]) / 65535, sy = (bbox[4] - bbox[1]) / 65535, sz = (bbox[5] - bbox[2]) / 65535;
  for (let i = 0; i < n; i++) {
    out[3 * i] = bbox[0] + pos[3 * i] * sx - cx;
    out[3 * i + 1] = bbox[1] + pos[3 * i + 1] * sy - cy;
    out[3 * i + 2] = bbox[2] + pos[3 * i + 2] * sz - cz;
  }
  return out;
}
