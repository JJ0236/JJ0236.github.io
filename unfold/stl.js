// unfold/stl.js — STL reader, binary and ASCII. Pure, so node can test it.
//
// Returns a Float64Array of triangle vertices, nine numbers per triangle, in
// file order. Normals in the file are ignored; they are recomputed from the
// winding later, which is what every slicer does too.

export function parseStl(input) {
  if (typeof input === 'string') return parseAscii(input);
  const buf = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  if (isBinary(buf)) return parseBinary(buf);
  return parseAscii(new TextDecoder().decode(buf));
}

// A binary STL is exactly 84 + 50·n bytes. ASCII files that happen to match
// that size are vanishingly rare, but "solid" at the start is not proof of
// ASCII either (some exporters write it into the binary header), so size wins.
export function isBinary(buf) {
  if (buf.byteLength < 84) return false;
  const n = new DataView(buf).getUint32(80, true);
  return buf.byteLength === 84 + 50 * n;
}

function parseBinary(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const out = new Float64Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12;                           // facet normal, ignored
    for (let k = 0; k < 9; k++) { out[i * 9 + k] = dv.getFloat32(o, true); o += 4; }
    o += 2;                            // attribute byte count
  }
  return out;
}

function parseAscii(text) {
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const nums = [];
  let m;
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  const tris = Math.floor(nums.length / 9);
  return Float64Array.from(nums.slice(0, tris * 9));
}

// Writers, used by the verify script to round-trip and by nothing else.
export function writeAscii(positions, name = 'unfold') {
  const lines = [`solid ${name}`];
  for (let i = 0; i < positions.length; i += 9) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 3; k++) lines.push(`      vertex ${positions[i + k * 3]} ${positions[i + k * 3 + 1]} ${positions[i + k * 3 + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

export function writeBinary(positions) {
  const n = positions.length / 9;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, positions[i * 9 + k], true); o += 4; }
    o += 2;
  }
  return buf;
}
