# scripts/blender/cloche_assets.py — builds every model for /cloche/ in
# Blender and exports glTF into cloche/assets/.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/cloche_assets.py
#
# Coordinates: the page works in millimetres with Y up. Blender is Z up, so
# a page point (x, y, z) is placed at Blender (x, -z, y); the glTF exporter
# turns that back into (x, y, z). Textures are generated with numpy and
# embedded in the .glb files, so nothing here needs Cycles baking.
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Euler

random.seed(7); np.random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'cloche', 'assets'))
TMP = os.path.join(OUT, '_tex'); os.makedirs(TMP, exist_ok=True)

def P(x, y, z): return Vector((x, -z, y))          # page → Blender
def rotX(a): return Euler((a, 0, 0), 'XYZ')
def rotY3(a): return Euler((0, 0, a), 'XYZ')        # rotation about the page's Y is Blender's Z
def rotZ3(a): return Euler((0, -a, 0), 'XYZ')       # rotation about the page's Z is Blender's -Y

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE' if hasattr(bpy.types, 'SceneEEVEE') else 'BLENDER_WORKBENCH'

def new_collection(name):
    c = bpy.data.collections.new(name); scene.collection.children.link(c); return c

# ---------------------------------------------------------------- textures
def save_image(name, arr):
    """arr: float32 HxWx4 in 0..1 → saved PNG → bpy image"""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels = np.clip(arr, 0, 1).astype(np.float32).ravel().tolist()
    path = os.path.join(TMP, name + '.png')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    img = bpy.data.images.load(path); img.name = name
    return img

def noise2(h, w, octaves=4, seed=0):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(octaves):
        s = 2 ** o
        small = rng.random((max(2, h // (8 * s)), max(2, w // (8 * s))))
        ys = np.linspace(0, small.shape[0] - 1, h); xs = np.linspace(0, small.shape[1] - 1, w)
        yi = ys.astype(int); xi = xs.astype(int); yf = ys - yi; xf = xs - xi
        yi2 = np.minimum(yi + 1, small.shape[0] - 1); xi2 = np.minimum(xi + 1, small.shape[1] - 1)
        a = small[yi][:, xi] * (1 - xf) + small[yi][:, xi2] * xf
        b = small[yi2][:, xi] * (1 - xf) + small[yi2][:, xi2] * xf
        out += (a * (1 - yf)[:, None] + b * yf[:, None]) * amp; tot += amp; amp *= 0.5
    return out / tot

def tex_wood():
    h, w = 512, 1024
    y = np.linspace(0, 1, h)[:, None]; x = np.linspace(0, 1, w)[None, :]
    wob = noise2(h, w, 2, 1) * 1.8
    grain = np.sin((y * 46 + wob + x * 0.3) * math.pi) * 0.5 + 0.5
    grain = grain ** 3
    base = np.array([0.91, 0.86, 0.76]); dark = np.array([0.82, 0.74, 0.60])
    col = base[None, None, :] * (1 - grain[..., None] * 0.28) + dark[None, None, :] * grain[..., None] * 0.28
    fine = np.sin(y * 900 + wob * 20) * 0.5 + 0.5
    col -= (fine[..., None] * 0.02)
    col += (noise2(h, w, 5, 2)[..., None] - 0.5) * 0.025
    return save_image('wood', np.dstack([col, np.ones((h, w))]))

def tex_tiles():
    h = w = 512; arr = np.ones((h, w, 3)) * np.array([0.80, 0.83, 0.82])
    yy, xx = np.mgrid[0:h, 0:w]; ty = (yy // 128) % 2; tx = (xx // 128) % 2
    tile = np.where((ty + tx) % 2 == 0, 0.97, 0.93)[..., None] * np.array([1, 1, 0.98])
    grout = ((yy % 128) < 5) | ((xx % 128) < 5)
    arr = np.where(grout[..., None], np.array([0.72, 0.75, 0.74]), tile)
    arr += (noise2(h, w, 4, 3)[..., None] - 0.5) * 0.03
    return save_image('tiles', np.dstack([arr, np.ones((h, w))]))

def tex_banana():
    h, w = 256, 1024
    x = np.linspace(0, 1, w)[None, :]
    yellow = np.array([0.93, 0.80, 0.25]); green = np.array([0.72, 0.75, 0.30]); brown = np.array([0.32, 0.20, 0.08])
    col = yellow[None, None, :] * np.ones((h, w, 1))
    col = col * (1 - 0.35 * np.clip(1 - x * 8, 0, 1)[..., None]) + green[None, None, :] * 0.35 * np.clip(1 - x * 8, 0, 1)[..., None]
    spots = noise2(h, w, 5, 4); mask = (spots > 0.62)[..., None] * np.clip((spots - 0.62) * 6, 0, 1)[..., None]
    col = col * (1 - mask * 0.8) + brown[None, None, :] * mask * 0.8
    bruise = np.clip((x - 0.82) * 6, 0, 1)[..., None]
    col = col * (1 - bruise * 0.7) + brown[None, None, :] * bruise * 0.7
    col += (noise2(h, w, 6, 5)[..., None] - 0.5) * 0.08
    return save_image('banana', np.dstack([col, np.ones((h, w))]))

def tex_apple_flesh():
    h = w = 512; yy, xx = np.mgrid[0:h, 0:w]; r = np.hypot(yy - h / 2, xx - w / 2) / (h / 2)
    a = np.arctan2(yy - h / 2, xx - w / 2)
    cream = np.array([0.96, 0.90, 0.72]); col = cream[None, None, :] * np.ones((h, w, 1))
    rays = (np.sin(a * 10) * 0.5 + 0.5) * np.clip(1 - r, 0, 1)
    col -= rays[..., None] * 0.05
    col += (noise2(h, w, 5, 6)[..., None] - 0.5) * 0.05
    core = np.clip(1 - r * 5, 0, 1)[..., None]; col = col * (1 - core * 0.15) + np.array([0.80, 0.70, 0.45])[None, None, :] * core * 0.15
    return save_image('apple_flesh', np.dstack([col, np.ones((h, w))]))

def tex_cloth():
    h = w = 512; yy, xx = np.mgrid[0:h, 0:w]
    base = np.array([0.95, 0.94, 0.90]); blue = np.array([0.45, 0.58, 0.78])
    stripe = (((yy // 64) % 2 == 0) | ((xx // 64) % 2 == 0)).astype(float)
    both = (((yy // 64) % 2 == 0) & ((xx // 64) % 2 == 0)).astype(float)
    col = base[None, None, :] * (1 - stripe[..., None] * 0.45) + blue[None, None, :] * stripe[..., None] * 0.45
    col = col * (1 - both[..., None] * 0.35) + blue[None, None, :] * both[..., None] * 0.35
    weave = (np.sin(yy * 0.9) * np.sin(xx * 0.9)) * 0.03
    col += weave[..., None]
    return save_image('cloth', np.dstack([col, np.ones((h, w))]))

_fly_tex = {}
def fly_textures():
    """Compound-eye facets (colour + normal map), cuticle, abdomen tergites, wing veins."""
    if _fly_tex: return _fly_tex
    # compound eye: hexagonal ommatidia, each a tiny dome
    h = w = 512; n = 46
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    sx = w / n; sy = sx * math.sqrt(3) / 2
    row = np.floor(yy / sy)
    best = np.full((h, w), 1e9); bcx = np.zeros((h, w)); bcy = np.zeros((h, w))
    for dr in (-1, 0, 1):
        r2 = row + dr; off = np.mod(r2, 2) * sx / 2
        c2 = np.floor((xx - off) / sx)
        for dc in (-1, 0, 1):
            ccx = (c2 + dc + 0.5) * sx + off; ccy = (r2 + 0.5) * sy
            dd = np.hypot(xx - ccx, yy - ccy); m = dd < best
            best = np.where(m, dd, best); bcx = np.where(m, ccx, bcx); bcy = np.where(m, ccy, bcy)
    R = sx * 0.58; rn = np.clip(best / R, 0, 1); dome = np.sqrt(np.clip(1 - rn ** 2, 0, 1))
    base = np.array([0.34, 0.03, 0.02]); hi = np.array([0.55, 0.06, 0.03]); edge = np.array([0.10, 0.008, 0.006])
    col = base * (1 - dome[..., None] * 0.55) + hi * dome[..., None] * 0.55
    col = np.where((rn > 0.84)[..., None], edge * np.ones_like(col), col)
    col *= (0.85 + 0.3 * noise2(h, w, 3, 21))[..., None]
    _fly_tex['eye'] = save_image('fly_eye', np.dstack([col, np.ones((h, w))]))
    rx = (xx - bcx) / R; ry = (yy - bcy) / R
    nrm = np.dstack([rx * 0.85, ry * 0.85, np.ones((h, w))]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    _fly_tex['eye_n'] = save_image('fly_eye_n', np.dstack([nrm * 0.5 + 0.5, np.ones((h, w))]))
    _fly_tex['eye_n'].colorspace_settings.name = 'Non-Color'
    # cuticle: tan-brown with fine mottling (pollinose thorax is a little greyer and darker)
    def cuticle(name, rgb, seed):
        hh = ww = 256
        c = np.array(rgb)[None, None] * (0.86 + 0.28 * noise2(hh, ww, 5, seed))[..., None]
        return save_image(name, np.dstack([c, np.ones((hh, ww))]))
    _fly_tex['thorax'] = cuticle('fly_thorax', (0.47, 0.35, 0.21), 22)
    _fly_tex['head'] = cuticle('fly_head', (0.66, 0.47, 0.25), 23)
    # abdomen: u runs base → tip, v runs ventral → dorsal
    def abdomen(male):
        hh, ww = 256, 512
        vv, uu = np.mgrid[0:hh, 0:ww].astype(np.float64); u = uu / ww; v = vv / hh
        tan = np.array([0.72, 0.55, 0.30]); pale = np.array([0.86, 0.78, 0.58]); dark = np.array([0.09, 0.06, 0.04])
        dors = np.clip((v - 0.38) / 0.36, 0, 1)
        col = pale * (1 - dors[..., None]) + tan * dors[..., None]
        segs = 6; t = np.clip((u - 0.05) / 0.9, 0, 0.99999) * segs; k = np.floor(t); fr = t - k
        wdt = 0.24 + 0.05 * k
        band = np.clip((fr - (1 - wdt)) / 0.05, 0, 1)
        if male: band = np.maximum(band, (k >= 4).astype(float))
        band *= dors ** 1.6
        memb = np.clip(1 - fr / 0.035, 0, 1)
        col = col * (1 - band[..., None] * 0.9) + dark * band[..., None] * 0.9
        col = col * (1 - memb[..., None] * 0.3) + pale * memb[..., None] * 0.3
        col *= (0.9 + 0.2 * noise2(hh, ww, 5, 30 + int(male)))[..., None]
        return save_image('fly_abdomen_' + ('m' if male else 'f'), np.dstack([col, np.ones((hh, ww))]))
    _fly_tex['abdomen_f'] = abdomen(False); _fly_tex['abdomen_m'] = abdomen(True)
    # wing: u runs from the inner (posterior) edge to the costal edge, v from hinge to tip
    hh, ww = 512, 256
    vv, uu = np.mgrid[0:hh, 0:ww].astype(np.float64); c = uu / ww; a = vv / hh
    veins = np.zeros((hh, ww))
    def vein(cfun, a0, a1, wd=0.011):
        cc = cfun(a); m = (a >= a0) & (a <= a1)
        return np.where(m, np.clip(1 - np.abs(c - cc) / wd, 0, 1), 0)
    for f, a0, a1, wd in [
        (lambda a: 0.968 + 0 * a, 0.0, 0.86, 0.03),                                   # costa
        (lambda a: 0.88 + 0.09 * np.clip(a / 0.36, 0, 1), 0.03, 0.36, 0.010),           # subcosta
        (lambda a: 0.76 + 0.21 * np.clip(a / 0.70, 0, 1) ** 1.7, 0.04, 0.70, 0.011),    # L2
        (lambda a: 0.60 + 0.16 * a, 0.04, 0.97, 0.011),                                 # L3
        (lambda a: 0.45 - 0.02 * a, 0.07, 0.97, 0.011),                                 # L4
        (lambda a: 0.27 - 0.20 * np.clip(a / 0.82, 0, 1) ** 1.3, 0.09, 0.82, 0.011),    # L5
    ]:
        veins = np.maximum(veins, vein(f, a0, a1, wd * 1.45))
    acv = (np.abs(a - 0.40) < 0.007) & (c > 0.442) & (c < 0.664)
    pcv = (np.abs(a - 0.63) < 0.007) & (c > 0.13) & (c < 0.437)
    veins = np.maximum(veins, (acv | pcv).astype(float))
    margin = np.clip(1 - np.minimum(c, 1 - c) / 0.025, 0, 1) * 0.35
    memb = np.array([0.60, 0.62, 0.64]); vc = np.array([0.24, 0.17, 0.10])
    col = memb * (1 - veins[..., None]) + vc * veins[..., None]
    alpha = np.maximum(0.30 + 0.06 * noise2(hh, ww, 3, 40), np.maximum(veins * 0.95, margin * 1.6))
    _fly_tex['wing'] = save_image('fly_wing', np.dstack([col, alpha]))
    return _fly_tex

# ---------------------------------------------------------------- materials
def material(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, tex=None, transmission=0.0, ior=1.45, alpha=None, emission=None, coat=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if 'IOR' in bsdf.inputs: bsdf.inputs['IOR'].default_value = ior
    if transmission and 'Transmission Weight' in bsdf.inputs: bsdf.inputs['Transmission Weight'].default_value = transmission
    if coat and 'Coat Weight' in bsdf.inputs: bsdf.inputs['Coat Weight'].default_value = coat
    if 'Specular IOR Level' in bsdf.inputs: bsdf.inputs['Specular IOR Level'].default_value = spec
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1); bsdf.inputs['Emission Strength'].default_value = 0.6
    if tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha == 'tex':
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if alpha is not None and alpha != 'tex':
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'blend_method'): m.blend_method = 'BLEND'
    return m

# ---------------------------------------------------------------- mesh helpers
def make_obj(name, bm, mat=None, smooth=True, coll=None, subsurf=0, bevel=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or scene.collection).objects.link(ob)
    if mat: ob.data.materials.append(mat)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 3
    if subsurf:
        s = ob.modifiers.new('subsurf', 'SUBSURF'); s.levels = subsurf; s.render_levels = subsurf
    return ob

def catmull(pts, t):
    n = len(pts) - 1; s = t * n; i = min(n - 1, int(math.floor(s))); f = s - i
    p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(n, i + 2)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)

def tube(name, pts, radius_fn, sides=24, rings=60, mat=None, coll=None, subsurf=1, caps=True, uv=True, profile=None):
    """A tube along a Catmull-Rom curve through pts (Blender coords). radius_fn(t, theta) → radius."""
    bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new('UVMap') if uv else None
    ringverts = []
    up = Vector((0, 0, 1))
    for r in range(rings + 1):
        t = r / rings; c = catmull(pts, t); d = (catmull(pts, min(1, t + 0.002)) - catmull(pts, max(0, t - 0.002))).normalized()
        side = d.cross(up).normalized() if abs(d.dot(up)) < 0.95 else d.cross(Vector((1, 0, 0))).normalized()
        n2 = side.cross(d).normalized()
        ring = []
        for s in range(sides):
            th = s / sides * 2 * math.pi; rad = radius_fn(t, th)
            ring.append(bm.verts.new(c + side * (math.cos(th) * rad) + n2 * (math.sin(th) * rad)))
        ringverts.append(ring)
    bm.verts.ensure_lookup_table()
    for r in range(rings):
        for s in range(sides):
            a, b = ringverts[r][s], ringverts[r][(s + 1) % sides]; c2, d2 = ringverts[r + 1][(s + 1) % sides], ringverts[r + 1][s]
            f = bm.faces.new((a, b, c2, d2))
            if uv_layer:
                for l, (uu, vv) in zip(f.loops, [(s / sides, r / rings), ((s + 1) / sides, r / rings), ((s + 1) / sides, (r + 1) / rings), (s / sides, (r + 1) / rings)]): l[uv_layer].uv = (uu, vv)
    if caps:
        for ring in (ringverts[0], ringverts[-1][::-1]):
            try: bm.faces.new(ring)
            except ValueError: pass
    return make_obj(name, bm, mat, True, coll, subsurf)

def lathe(name, profile, segments=48, mat=None, coll=None, subsurf=1, center=Vector((0, 0, 0)), closed_bottom=True):
    """profile: list of (r, h) with h along Blender Z; revolved about Z."""
    bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new('UVMap')
    rings = []
    for (r, hgt) in profile:
        ring = [bm.verts.new(center + Vector((math.cos(2 * math.pi * s / segments) * r, math.sin(2 * math.pi * s / segments) * r, hgt))) for s in range(segments)] if r > 1e-6 else None
        rings.append(ring)
    prev = None; prev_h = None
    for k, ring in enumerate(rings):
        if ring is None:
            if prev is not None and k == len(rings) - 1:
                v = bm.verts.new(center + Vector((0, 0, profile[k][1])))
                for s in range(segments): bm.faces.new((prev[s], prev[(s + 1) % segments], v))
            prev = None; continue
        if prev is None and k > 0 and rings[k - 1] is None and profile[k - 1][0] <= 1e-6:
            v = bm.verts.new(center + Vector((0, 0, profile[k - 1][1])))
            for s in range(segments): bm.faces.new((v, ring[(s + 1) % segments], ring[s]))
        if prev is not None:
            for s in range(segments):
                f = bm.faces.new((prev[s], prev[(s + 1) % segments], ring[(s + 1) % segments], ring[s]))
                for l, (uu, vv) in zip(f.loops, [(s / segments, (k - 1) / len(rings)), ((s + 1) / segments, (k - 1) / len(rings)), ((s + 1) / segments, k / len(rings)), (s / segments, k / len(rings))]): l[uv_layer].uv = (uu, vv)
        prev = ring
    if closed_bottom and rings[0] is not None:
        bm.faces.new(rings[0][::-1])
    return make_obj(name, bm, mat, True, coll, subsurf)

def sphere(name, r, at, scale=(1, 1, 1), mat=None, coll=None, seg=24, rings=16, subsurf=0):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + at
    return make_obj(name, bm, mat, True, coll, subsurf)

def box(name, size, at, mat=None, coll=None, bevel=None, uvscale=1.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    uv_layer = bm.loops.layers.uv.new('UVMap')
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + at
    for f in bm.faces:
        n = f.normal
        for l in f.loops:
            c = l.vert.co
            if abs(n.z) > 0.5: l[uv_layer].uv = (c.x / uvscale, c.y / uvscale)
            elif abs(n.x) > 0.5: l[uv_layer].uv = (c.y / uvscale, c.z / uvscale)
            else: l[uv_layer].uv = (c.x / uvscale, c.z / uvscale)
    return make_obj(name, bm, mat, False, coll, 0, bevel)

def cylinder(name, r1, r2, length, at, axis='z', mat=None, coll=None, seg=16, subsurf=0):
    """cylinder along local axis from at to at+length·axis (Blender coords). axis 'z' or '-z' or a Vector."""
    bm = bmesh.new()
    a = Vector((0, 0, 1)) if axis == 'z' else Vector((0, 0, -1)) if axis == '-z' else Vector(axis).normalized()
    side = a.cross(Vector((0, 1, 0))).normalized() if abs(a.y) < 0.9 else a.cross(Vector((1, 0, 0))).normalized(); n2 = side.cross(a)
    r0 = [bm.verts.new(at + side * math.cos(2 * math.pi * s / seg) * r1 + n2 * math.sin(2 * math.pi * s / seg) * r1) for s in range(seg)]
    r1v = [bm.verts.new(at + a * length + side * math.cos(2 * math.pi * s / seg) * r2 + n2 * math.sin(2 * math.pi * s / seg) * r2) for s in range(seg)]
    for s in range(seg): bm.faces.new((r0[s], r0[(s + 1) % seg], r1v[(s + 1) % seg], r1v[s]))
    bm.faces.new(r0[::-1]); bm.faces.new(r1v)
    return make_obj(name, bm, mat, True, coll, subsurf)

def empty(name, at, rot=None, parent=None, coll=None):
    e = bpy.data.objects.new(name, None); (coll or scene.collection).objects.link(e)
    e.empty_display_size = 0.2; e.location = at
    if rot is not None: e.rotation_euler = rot
    if parent is not None: e.parent = parent
    return e

def parent_keep(child, parent):
    child.parent = parent; child.matrix_parent_inverse = parent.matrix_world.inverted()

def export(coll, filename, extras=False):
    bpy.ops.object.select_all(action='DESELECT')
    objs = [o for o in coll.all_objects]
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO', export_animations=False, export_extras=extras)
    print('exported', path, os.path.getsize(path), 'bytes')

# ================================================================ THE SET
setc = new_collection('set')
wood = material('counter', tex=tex_wood(), rough=0.55)
tiles = material('tiles', tex=tex_tiles(), rough=0.35, spec=0.6)
paint = material('paint', color=(0.90, 0.88, 0.82), rough=0.6)
glassM = material('glass', color=(0.95, 0.98, 1.0), rough=0.04, transmission=1.0, ior=1.5, alpha=0.15)

# counter (top at y = 0), front apron, wall, window frame, sill
box('counter', (360, 200, 12), P(0, -6, 2), wood, setc, bevel=1.2, uvscale=360)
box('apron', (360, 6, 60), P(0, -42, 99), paint, setc, bevel=0.8)
W, H, y0 = 330, 200, 18
# tiled wall built around the window opening so the sky shows through
box('wall_l', (400 - W / 2 - 4, 2, 320), P(-(W / 2 + 4) - (400 - W / 2 - 4) / 2, 120, -100), tiles, setc, uvscale=110)
box('wall_r', (400 - W / 2 - 4, 2, 320), P((W / 2 + 4) + (400 - W / 2 - 4) / 2, 120, -100), tiles, setc, uvscale=110)
box('wall_b', (W + 8, 2, y0 + 40), P(0, (y0 - 40) / 2, -100), tiles, setc, uvscale=110)
box('wall_t', (W + 8, 2, 320 - (y0 + H + 4) + 40), P(0, (y0 + H + 4) + (320 - (y0 + H + 4) + 40) / 2 - 40, -100), tiles, setc, uvscale=110)
for nm, (x, y, w, h) in {'frame_l': (-W / 2, y0 + H / 2, 8, H + 8), 'frame_r': (W / 2, y0 + H / 2, 8, H + 8), 'frame_b': (0, y0, W + 8, 10), 'frame_t': (0, y0 + H, W + 8, 8), 'mullion': (0, y0 + H / 2, 6, H), 'transom': (0, y0 + H * 0.55, W, 5)}.items():
    box(nm, (w, 12, h), P(x, y, -99), paint, setc, bevel=0.6)
box('sill', (W + 30, 22, 6), P(0, 3, -90), paint, setc, bevel=1.0)
gl = box('window_glass', (W, 1, H), P(0, y0 + H / 2, -105), glassM, setc)

# banana: the same curve as world.js, pentagonal ridges, tapered ends
bpts = [P(-150, 9, 15), P(-115, 12, 7), P(-80, 12, 11), P(-49, 9, 23)]
def banana_r(t, th):
    taper = min(1, t / 0.12) ** 0.5 * min(1, (1 - t) / 0.10) ** 0.6
    return 11 * (1 + 0.07 * math.cos(5 * th)) * (0.35 + 0.65 * taper)
bananaM = material('banana', tex=tex_banana(), rough=0.42, coat=0.15)
tube('banana', bpts, banana_r, sides=30, rings=70, mat=bananaM, coll=setc, subsurf=1)
p0 = catmull(bpts, 0.0); stem_dir = (catmull(bpts, 0.0) - catmull(bpts, 0.03)).normalized()
cylinder('banana_stem', 3.2, 2.2, 14, p0 - stem_dir * 2, axis=stem_dir, mat=material('stem', color=(0.36, 0.28, 0.14), rough=0.8), coll=setc, subsurf=1)

# plate with a blue rim, two apple slices
ceramic = material('ceramic', color=(0.96, 0.97, 0.95), rough=0.18, coat=0.4)
blueM = material('rim', color=(0.35, 0.52, 0.78), rough=0.25, coat=0.4)
lathe('plate', [(0, 0), (26, 0), (30, 1.5), (33, 3.0), (34.5, 4.2), (33.5, 5.0), (31, 4.6), (27, 3.4), (0, 3.2)], 64, ceramic, setc, 1, P(60, 0, 40))
lathe('plate_rim', [(31.5, 4.0), (34.8, 4.4), (34.2, 5.4), (31.2, 4.9), (31.5, 4.0)], 64, blueM, setc, 0, P(60, 0, 40), closed_bottom=False)
fleshM = material('apple_flesh', tex=tex_apple_flesh(), rough=0.55)
skinM = material('apple_skin', color=(0.72, 0.12, 0.10), rough=0.35, coat=0.6)
def apple_slice(name, x, z, rot):
    bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new('UVMap')
    n = 22; pts = [Vector((0, 0, 0))] + [Vector((math.cos(-0.75 + 1.5 * k / n) * 22, -math.sin(-0.75 + 1.5 * k / n) * 22, 0)) for k in range(n + 1)]
    bot = [bm.verts.new(p) for p in pts]; top = [bm.verts.new(p + Vector((0, 0, 10))) for p in pts]
    fb = bm.faces.new(bot[::-1]); ft = bm.faces.new(top)
    for f in (fb, ft):
        for l in f.loops: l[uv_layer].uv = (l.vert.co.x / 44 + 0.5, l.vert.co.y / 44 + 0.5)
    for k in range(len(pts)):
        a, b = bot[k], bot[(k + 1) % len(pts)]; c, d = top[(k + 1) % len(pts)], top[k]
        f = bm.faces.new((a, b, c, d))
        for l in f.loops: l[uv_layer].uv = (l.vert.co.x / 44 + 0.5, l.vert.co.y / 44 + 0.5)
    ob = make_obj(name, bm, fleshM, False, setc, 0, bevel=1.4)
    ob.location = P(x, 4, z); ob.rotation_euler = rotY3(rot)
    # skin: a thin band on the arc
    bm2 = bmesh.new(); arc = [Vector((math.cos(-0.75 + 1.5 * k / n) * 22.3, -math.sin(-0.75 + 1.5 * k / n) * 22.3, 0)) for k in range(n + 1)]
    lo = [bm2.verts.new(p + Vector((0, 0, -0.2))) for p in arc]; hi = [bm2.verts.new(p + Vector((0, 0, 10.2))) for p in arc]
    for k in range(n): bm2.faces.new((lo[k], lo[k + 1], hi[k + 1], hi[k]))
    sk = make_obj(name + '_skin', bm2, skinM, True, setc, 0)
    sk.location = P(x, 4, z); sk.rotation_euler = rotY3(rot)
    sol = sk.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 1.2; sol.offset = 1
apple_slice('slice_1', 52, 34, 0.6); apple_slice('slice_2', 70, 48, 2.9)

# jam jar, jam, lid, drip
jar_profile = [(0, 0), (19, 0), (21, 1.5), (21.5, 6), (22.5, 30), (22.5, 50), (20.5, 55), (19.5, 58), (20.5, 61), (20.5, 62)]
jar = lathe('jar', jar_profile, 64, glassM, setc, 1, P(140, 0, -60))
sol = jar.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 1.6; sol.offset = -1
jamM = material('jam', color=(0.42, 0.06, 0.16), rough=0.28, coat=0.3, spec=0.7)
lathe('jam', [(0, 1.5), (18.5, 1.5), (19.5, 6), (20.5, 30), (20.5, 36), (19, 38.5), (12, 39.5), (0, 39.8)], 48, jamM, setc, 1, P(140, 0, -60))
metal = material('lid', color=(0.72, 0.70, 0.66), rough=0.35, metal=0.9)
lid = lathe('lid', [(0, 0), (22, 0), (23, 1), (23, 5), (22, 6), (0, 6)], 64, metal, setc, 0, P(108, 0, -30))
lid.rotation_euler = rotY3(0.1)
dripM = material('drip', color=(0.55, 0.10, 0.22), rough=0.12, coat=0.9)
sphere('drip', 6, P(116, 1.4, -60), (1.4, 1.1, 0.32), dripM, setc, subsurf=1)
sphere('drip2', 3, P(124, 1.0, -56), (1.2, 1.0, 0.3), dripM, setc, subsurf=1)

# spilled juice: a flat glossy puddle
juiceM = material('juice', color=(0.78, 0.42, 0.10), rough=0.06, coat=1.0)
bm = bmesh.new(); pts = []
for k in range(40):
    a = 2 * math.pi * k / 40; rr = 15 * (1 + 0.18 * math.sin(a * 3) + 0.1 * math.cos(a * 5))
    pts.append(bm.verts.new(P(-40 + math.cos(a) * rr * 1.3, 0, 72 + math.sin(a) * rr * 0.85)))
f = bm.faces.new(pts)
sp = make_obj('spill', bm, juiceM, False, setc, 0); sp.location = Vector((0, 0, 0.25))

# cloth: simulated over a hidden block, then frozen
clothM = material('cloth', tex=tex_cloth(), rough=0.95)
blk = box('cloth_block', (40, 30, 9), P(-150, 4.5, -70), None, setc)
blk.hide_render = True
bpy.ops.mesh.primitive_plane_add(size=1, location=P(-150, 18, -70))
cl = bpy.context.active_object; cl.name = 'cloth'; cl.scale = (64, 52, 1)
bpy.ops.object.transform_apply(scale=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=34); bpy.ops.object.mode_set(mode='OBJECT')
for p in cl.data.polygons: p.use_smooth = True
cl.data.materials.append(clothM)
# uvs
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.collection.objects):
    if o.name == 'cloth': scene.collection.objects.unlink(o); setc.objects.link(o)
cmod = cl.modifiers.new('cloth', 'CLOTH'); cmod.settings.quality = 6; cmod.settings.mass = 0.3; cmod.settings.tension_stiffness = 6; cmod.settings.bending_stiffness = 0.4
cmod.collision_settings.use_self_collision = True; cmod.collision_settings.distance_min = 0.4
blk.modifiers.new('col', 'COLLISION')
box('counter_col', (360, 200, 12), P(0, -6, 2), None, setc).modifiers.new('col', 'COLLISION')
bpy.data.objects['counter_col'].hide_render = True
scene.frame_start = 1; scene.frame_end = 45
for fr in range(1, 46): scene.frame_set(fr)
bpy.context.view_layer.objects.active = cl; cl.select_set(True)
bpy.ops.object.modifier_apply(modifier='cloth')
sol = cl.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 0.7
cl.modifiers.new('subsurf', 'SUBSURF').levels = 1
for nm in ('cloth_block', 'counter_col'):
    o = bpy.data.objects[nm]; bpy.data.objects.remove(o)

# fruit bowl with two oranges (obstacle at (100, 45) r 30 in world.js)
bowlM = material('bowl', color=(0.20, 0.32, 0.40), rough=0.3, coat=0.5)
lathe('bowl', [(0, 0), (14, 0), (18, 1.2), (24, 6), (28, 14), (29, 20), (27.5, 21), (26.5, 20), (23, 14), (18, 7), (14, 4), (0, 3.5)], 64, bowlM, setc, 1, P(150, 0, 55))
orangeM = material('orange', color=(0.95, 0.48, 0.10), rough=0.55)
sphere('orange_1', 12, P(144, 15, 52), (1, 0.92, 1), orangeM, setc, subsurf=1)
sphere('orange_2', 11, P(160, 14, 62), (1, 0.92, 1), orangeM, setc, subsurf=1)
sphere('lemon', 9, P(152, 13, 42), (1.25, 0.9, 0.95), material('lemon', color=(0.95, 0.82, 0.12), rough=0.5), setc, subsurf=1)

# coffee mug with a bitter coffee ring at its foot
mugM = material('mug', color=(0.24, 0.30, 0.36), rough=0.35, coat=0.5)
mug = lathe('mug', [(0, 0), (20, 0), (22, 1.5), (23, 8), (23.5, 40), (23, 44), (22, 45), (21, 44), (21, 6), (0, 5)], 56, mugM, setc, 1, P(-100, 0, -55))
coffeeM = material('coffee', color=(0.22, 0.12, 0.06), rough=0.15, coat=1.0)
lathe('coffee', [(0, 30), (20.6, 30), (20.6, 31), (0, 31)], 48, coffeeM, setc, 0, P(-100, 0, -55))
handle = bpy.data.objects.new('mug_handle', bpy.data.meshes.new('mug_handle_me'))
bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=False, radius=1, segments=8)
bm.to_mesh(handle.data); bm.free()
# handle as a torus segment
hbm = bmesh.new(); R, r = 13, 3.2
for i in range(0, 25):
    pass
hbm.free()
bpy.data.objects.remove(handle)
def torus_segment(name, R, r, a0, a1, at, mat, seg=24, ring=10):
    bm = bmesh.new(); rings = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg; c = Vector((math.cos(a) * R, 0, math.sin(a) * R))
        ring_v = []
        for j in range(ring):
            t = 2 * math.pi * j / ring
            n = Vector((math.cos(a), 0, math.sin(a))) * (math.cos(t) * r) + Vector((0, 1, 0)) * (math.sin(t) * r)
            ring_v.append(bm.verts.new(c + n))
        rings.append(ring_v)
    for i in range(seg):
        for j in range(ring): bm.faces.new((rings[i][j], rings[i][(j + 1) % ring], rings[i + 1][(j + 1) % ring], rings[i + 1][j]))
    ob = make_obj(name, bm, mat, True, setc, 1); ob.location = at; return ob
torus_segment('mug_handle', 14, 3.4, -math.pi * 0.5, math.pi * 0.5, P(-100 + 23, 22, -55), mugM)
bpy.data.objects['mug_handle'].rotation_euler = rotY3(math.pi / 2)
# the coffee ring: a thin glossy dark puddle
bm = bmesh.new(); pts = []
for k in range(48):
    a = 2 * math.pi * k / 48; rr = 21 + 3 * math.sin(a * 4) + 1.5 * math.cos(a * 7)
    pts.append(bm.verts.new(P(-80 + math.cos(a) * rr * 1.1, 0, -36 + math.sin(a) * rr * 0.8)))
bm.faces.new(pts)
cr = make_obj('coffee_ring', bm, material('coffee_ring', color=(0.30, 0.17, 0.08), rough=0.12, coat=1.0), False, setc, 0); cr.location = Vector((0, 0, 0.2))

# sugar bowl with a spill of sugar
sugarBowlM = material('sugar_bowl', color=(0.94, 0.94, 0.92), rough=0.2, coat=0.4)
lathe('sugar_bowl', [(0, 0), (16, 0), (19, 2), (22, 10), (23, 20), (21.5, 22), (20.5, 21), (20, 10), (17, 3), (0, 2.5)], 56, sugarBowlM, setc, 1, P(20, 0, -70))
sugarM = material('sugar', color=(0.98, 0.97, 0.94), rough=0.55, spec=0.9)
lathe('sugar_pile', [(0, 2.5), (17, 2.5), (16, 6), (10, 12), (0, 14)], 40, sugarM, setc, 1, P(20, 0, -70))
bm = bmesh.new(); pts = []
for k in range(40):
    a = 2 * math.pi * k / 40; rr = 12 + 2.5 * math.sin(a * 3) + 1.2 * math.cos(a * 6)
    pts.append(bm.verts.new(P(38 + math.cos(a) * rr * 1.3, 0, -52 + math.sin(a) * rr)))
bm.faces.new(pts)
sp2 = make_obj('sugar_spill', bm, sugarM, False, setc, 0); sp2.location = Vector((0, 0, 0.6))
sp2.modifiers.new('solid', 'SOLIDIFY').thickness = -1.0
for i in range(18):
    a = random.random() * 6.28; rr = 14 + random.random() * 12
    g = sphere(f'sugar_grain_{i}', 0.9 + random.random() * 0.6, P(38 + math.cos(a) * rr * 1.3, 0.8, -52 + math.sin(a) * rr), (1, 0.7, 1), sugarM, setc)

# a cut orange half, flesh up
def tex_orange_flesh():
    h = w = 512; yy, xx = np.mgrid[0:h, 0:w]; r = np.hypot(yy - h / 2, xx - w / 2) / (h / 2); a = np.arctan2(yy - h / 2, xx - w / 2)
    flesh = np.array([0.98, 0.58, 0.12]); pith = np.array([0.98, 0.92, 0.78])
    seg = np.abs(np.sin(a * 5)) < 0.06
    col = flesh[None, None, :] * np.ones((h, w, 1)); col = np.where((seg | (r > 0.86) | (r < 0.06))[..., None], pith, col)
    col += (noise2(h, w, 5, 9)[..., None] - 0.5) * 0.08
    return save_image('orange_flesh', np.dstack([col, np.ones((h, w))]))
orangeFleshM = material('orange_flesh', tex=tex_orange_flesh(), rough=0.35, coat=0.4)
half = lathe('orange_half', [(0, 0), (16, 0), (20, 3), (22.5, 9), (23, 17), (22.6, 18.5), (0, 18.5)], 56, orangeM, setc, 1, P(-10, 0, 8))
# flesh disc on top with its own material and UVs
bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new('UVMap'); ring_v = [bm.verts.new(P(-10 + math.cos(2 * math.pi * k / 56) * 22.4, 18.6, 8 + math.sin(2 * math.pi * k / 56) * 22.4)) for k in range(56)]
f = bm.faces.new(ring_v)
for l in f.loops: l[uv_layer].uv = ((l.vert.co.x + 10) / 44.8 + 0.5, (l.vert.co.y - (-8)) / 44.8 + 0.5)
make_obj('orange_face', bm, orangeFleshM, False, setc, 0)

# grapes on a stem
grapeM = material('grape', color=(0.45, 0.16, 0.36), rough=0.3, coat=0.6)
stemM = material('grape_stem', color=(0.45, 0.42, 0.25), rough=0.8)
gx, gz = 100, 5
for i in range(14):
    a = i * 2.4; rr = 3 + (i % 5) * 5.5; x = gx + math.cos(a) * rr; z = gz + math.sin(a) * rr * 0.7
    yy_ = 7 + (i % 3) * 5 - (i % 5) * 0.8
    sphere(f'grape_{i}', 7 + (i % 3) * 0.6, P(x, yy_, z), (1, 1.15, 1), grapeM, setc, subsurf=1)
cylinder('grape_stem', 1.6, 1.0, 42, P(gx - 12, 18, gz + 3), axis=Vector((1, 0.15, -0.2)), mat=stemM, coll=setc)

# potted herb with soil
potM = material('pot', color=(0.72, 0.42, 0.28), rough=0.7)
lathe('pot', [(0, 0), (22, 0), (24, 2), (28, 42), (30, 43), (30.5, 47), (28.5, 47.5), (26, 43), (25, 41), (0, 40)], 56, potM, setc, 1, P(-160, 0, 45))
soilM = material('soil', color=(0.20, 0.13, 0.08), rough=0.95)
lathe('soil', [(0, 39), (25.5, 39), (24, 41.5), (16, 43), (0, 43.5)], 40, soilM, setc, 1, P(-160, 0, 45))
leafM = material('leaf', color=(0.22, 0.48, 0.18), rough=0.55)
def leaf(name, at, yaw, tilt, L=22, Wd=11):
    bm = bmesh.new(); pts_ = []
    for k in range(20):
        t = k / 19; pts_.append((math.sin(math.pi * t) ** 0.8 * Wd * 0.5 * (1 if k < 10 else 1), t * L))
    verts = [bm.verts.new(Vector((x, 0, y))) for (x, y) in pts_] + [bm.verts.new(Vector((-x, 0, y))) for (x, y) in reversed(pts_[1:-1])]
    bm.faces.new(verts)
    ob = make_obj(name, bm, leafM, True, setc, 1); ob.location = at; ob.rotation_euler = Euler((tilt, 0, yaw), 'XYZ')
    ob.modifiers.new('solid', 'SOLIDIFY').thickness = 0.6
for i in range(9):
    yaw = i * 0.75; tilt = 0.45 + (i % 3) * 0.25
    leaf(f'leaf_{i}', P(-160 + math.cos(yaw) * 5, 42 + (i % 2) * 6, 45 - math.sin(yaw) * 5), yaw, tilt, 20 + (i % 4) * 4, 10 + (i % 3) * 2)
    cylinder(f'stem_{i}', 0.8, 0.6, 12 + (i % 2) * 6, P(-160, 40, 45), axis=Vector((math.cos(yaw) * 0.4, 1, -math.sin(yaw) * 0.4)), mat=leafM, coll=setc)

# crumbs
crumbM = material('crumb', color=(0.78, 0.62, 0.36), rough=0.9)
for i in range(16):
    x = -60 + random.random() * 50 - 25; z = -22 + random.random() * 30 - 15
    sphere(f'crumb_{i}', 1.2 + random.random() * 2.0, P(x, 0.8, z), (1, 0.55, 0.8 + random.random() * 0.4), crumbM, setc)

# a curtain at the left of the window: cloth hung from a rod
curtainM = material('curtain', color=(0.93, 0.90, 0.80), rough=0.9)
bpy.ops.mesh.primitive_plane_add(size=1, location=P(-W / 2 - 25, y0 + H / 2 + 20, -86))
cu = bpy.context.active_object; cu.name = 'curtain'; cu.scale = (60, 1, H + 40); cu.rotation_euler = Euler((math.radians(90), 0, 0), 'XYZ')
bpy.ops.object.transform_apply(scale=True, rotation=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=30); bpy.ops.object.mode_set(mode='OBJECT')
for p_ in cu.data.polygons: p_.use_smooth = True
cu.data.materials.append(curtainM)
scene.collection.objects.unlink(cu); setc.objects.link(cu)
vg = cu.vertex_groups.new(name='pin')
top = max(v.co.z for v in cu.data.vertices)
vg.add([v.index for v in cu.data.vertices if abs(v.co.z - top) < 1.0], 1.0, 'REPLACE')
cm = cu.modifiers.new('cloth', 'CLOTH'); cm.settings.vertex_group_mass = 'pin'; cm.settings.quality = 5; cm.settings.mass = 0.2; cm.settings.bending_stiffness = 0.3
cm.settings.effector_weights.gravity = 1.0
for fr in range(1, 30): scene.frame_set(fr)
bpy.context.view_layer.objects.active = cu; cu.select_set(True); bpy.ops.object.modifier_apply(modifier='cloth')
cu.modifiers.new('solid', 'SOLIDIFY').thickness = 0.8
rod = cylinder('curtain_rod', 2.2, 2.2, W + 90, P(-W / 2 - 45, y0 + H + 22, -84), axis=Vector((1, 0, 0)), mat=metal, coll=setc, seg=16)

export(setc, 'set.glb')

# ================================================================ FLIES
# bmesh builders: several parts per object keep draw calls down
def bm_ellipsoid(bm, c, rad, useg=24, vseg=16, uvl=None, uscale=1.0, mat_index=0):
    cx, cy, cz = c; rx, ry, rz = rad
    top = bm.verts.new((cx, cy, cz + rz)); bot = bm.verts.new((cx, cy, cz - rz))
    rings = []
    for j in range(1, vseg):
        th = math.pi * j / vseg
        rings.append([bm.verts.new((cx + rx * math.sin(th) * math.cos(2 * math.pi * i / useg), cy + ry * math.sin(th) * math.sin(2 * math.pi * i / useg), cz + rz * math.cos(th))) for i in range(useg)])
    faces = []
    def add(verts, uvs):
        f = bm.faces.new(verts); f.material_index = mat_index; faces.append(f)
        if uvl is not None:
            for l, (u, v) in zip(f.loops, uvs): l[uvl].uv = (u * uscale, v)
    for i in range(useg):
        i2 = (i + 1) % useg; u0 = i / useg; u1 = (i + 1) / useg
        add((top, rings[0][i], rings[0][i2]), [((u0 + u1) / 2, 1), (u0, 1 - 1 / vseg), (u1, 1 - 1 / vseg)])
        for j in range(vseg - 2):
            v0 = 1 - (j + 1) / vseg; v1 = 1 - (j + 2) / vseg
            add((rings[j][i], rings[j + 1][i], rings[j + 1][i2], rings[j][i2]), [(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
        add((bot, rings[-1][i2], rings[-1][i]), [((u0 + u1) / 2, 0), (u1, 1 / vseg), (u0, 1 / vseg)])
    return faces

def bm_tube(bm, a, b, r1, r2, seg=8, cap=True, mat_index=0):
    a = Vector(a); b = Vector(b); d = b - a
    if d.length < 1e-6: return
    d.normalize()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    s1 = d.cross(ref).normalized(); s2 = d.cross(s1)
    ring = lambda c, r: [bm.verts.new(c + (s1 * math.cos(2 * math.pi * i / seg) + s2 * math.sin(2 * math.pi * i / seg)) * r) for i in range(seg)]
    r0 = ring(a, r1)
    if r2 < 1e-5:
        tip = bm.verts.new(b)
        for i in range(seg): bm.faces.new((r0[i], r0[(i + 1) % seg], tip)).material_index = mat_index
    else:
        rb = ring(b, r2)
        for i in range(seg): bm.faces.new((r0[i], r0[(i + 1) % seg], rb[(i + 1) % seg], rb[i])).material_index = mat_index
        if cap: bm.faces.new(rb).material_index = mat_index
    if cap: bm.faces.new(r0[::-1]).material_index = mat_index

def build_fly(male):
    T = fly_textures()
    tag = 'm' if male else 'f'
    coll = new_collection('fly_' + tag)
    def texmat(name, img, rough, normal=None, alpha=False):
        m = material(name, tex=img, rough=rough, alpha='tex' if alpha else None, spec=0.35)
        if normal is not None:
            nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
            ni = nt.nodes.new('ShaderNodeTexImage'); ni.image = normal
            nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
            nt.links.new(ni.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        return m
    thoraxM = texmat('fly_thorax_' + tag, T['thorax'], 0.72)
    headM = texmat('fly_head_' + tag, T['head'], 0.66)
    eyeM = texmat('fly_eye_' + tag, T['eye'], 0.42, normal=T['eye_n'])
    abdoM = texmat('fly_abdomen_' + tag, T['abdomen_' + tag], 0.6)
    wingM = texmat('fly_wing_' + tag, T['wing'], 0.2, alpha=True)
    legM = material('fly_leg_' + tag, color=(0.24, 0.14, 0.055), rough=0.62, spec=0.3)
    darkM = material('fly_bristle_' + tag, color=(0.06, 0.045, 0.035), rough=0.5, spec=0.35)
    ocelM = material('fly_ocellus_' + tag, color=(0.25, 0.06, 0.03), rough=0.2, spec=0.6)

    def obj(name, build, mats, parent, uv=False, recalc=True):
        bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap') if uv else None
        build(bm, uvl)
        if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = make_obj(name, bm, mats[0], True, coll, 0)
        for m in mats[1:]: o.data.materials.append(m)
        o.parent = parent
        return o

    root = empty('root', Vector((0, 0, 0)), coll=coll)
    body = empty('body', Vector((0, 0, 0)), parent=root, coll=coll)

    # ---- thorax: a domed mesonotum, the scutellum behind it, halteres
    TC, TR = (0, 1.0, 0.18), (0.6, 0.58, 0.84)          # page centre, radii (width, height, length)
    def thorax(bm, uvl):
        bm_ellipsoid(bm, P(*TC), (TR[0], TR[2], TR[1]), 30, 20, uvl, 2.0)
        bm_ellipsoid(bm, P(0, 1.3, -0.64), (0.27, 0.2, 0.13), 16, 10, uvl, 2.0)
        bm_ellipsoid(bm, P(0, 0.62, 0.3), (0.42, 0.62, 0.22), 16, 10, uvl, 2.0)          # sternum under the legs
    obj('thorax', thorax, [thoraxM], body, uv=True)
    def halteres(bm, uvl):
        for sd in (-1, 1):
            bm_tube(bm, P(sd * 0.4, 1.02, -0.52), P(sd * 0.6, 1.08, -0.72), 0.028, 0.02, 6)
            bm_ellipsoid(bm, P(sd * 0.62, 1.09, -0.75), (0.07, 0.06, 0.065), 8, 6)
    obj('halteres', halteres, [legM], body)

    def on_thorax(xf, zf):
        cx, cy, cz = TC; ax, ay, az = TR
        y = cy + ay * math.sqrt(max(0.0, 1 - xf * xf - zf * zf))
        p = Vector((xf * ax, y, cz + zf * az))
        n = Vector((xf / ax, (y - cy) / (ay * ay), zf / az)).normalized()
        return p, n
    def bristles_thorax(bm, uvl):
        macro = [(0.26, 0.22, 0.42), (0.26, -0.18, 0.5), (0.6, 0.3, 0.34), (0.55, -0.28, 0.4), (0.45, 0.62, 0.3), (0.42, -0.58, 0.36), (0.7, 0.0, 0.3)]
        for xf, zf, ln in macro:
            for sd in (-1, 1):
                p, n = on_thorax(sd * xf, zf)
                d = (n * 0.3 + Vector((sd * 0.16, 0.05, -1.0))).normalized()
                bm_tube(bm, P(*p), P(*(p + d * ln)), 0.0095, 0.0, 5, cap=False)
        for xf in (-0.19, -0.07, 0.07, 0.19):          # acrostichal hairs
            for k in range(6):
                zf = -0.45 + k * 0.19
                p, n = on_thorax(xf, zf)
                d = (n * 0.25 + Vector((0, 0.0, -1.0))).normalized()
                bm_tube(bm, P(*p), P(*(p + d * 0.09)), 0.0038, 0.0, 4, cap=False)
        for sd in (-1, 1):                              # scutellars
            for bx, bz, ln in ((0.1, -0.74, 0.62), (0.22, -0.58, 0.42)):
                p = Vector((sd * bx, 1.4, bz)); d = Vector((sd * 0.12, 0.28, -1.0)).normalized()
                bm_tube(bm, P(*p), P(*(p + d * ln)), 0.0105, 0.0, 5, cap=False)
    obj('thorax_bristles', bristles_thorax, [darkM], body)

    # ---- head: a capsule, two huge faceted eyes, ocelli, bristles, antennae, proboscis
    head = empty('head', P(0, 1.02, 1.1), parent=body, coll=coll)
    def headcap(bm, uvl):
        bm_ellipsoid(bm, P(0, 0.0, 0.0), (0.32, 0.3, 0.36), 26, 18, uvl, 2.0)
    obj('head_mesh', headcap, [headM], head, uv=True)
    def eyes(bm, uvl):
        for sd in (-1, 1):
            bm_ellipsoid(bm, P(sd * 0.25, 0.03, 0.08), (0.23, 0.33, 0.39), 36, 26, uvl, 2.0)
    obj('eyes', eyes, [eyeM], head, uv=True)
    def headbits(bm, uvl):
        for q in ((0, 0.37, 0.0), (0.055, 0.355, -0.07), (-0.055, 0.355, -0.07)):
            bm_ellipsoid(bm, P(*q), (0.028, 0.028, 0.02), 8, 6, mat_index=1)
        for x, y, z, ln, dx, dy, dz in ((0.13, 0.34, 0.14, 0.26, 0.2, 0.6, -0.9), (0.17, 0.33, 0.02, 0.3, 0.3, 0.5, -1.0),
                                        (0.25, 0.28, -0.12, 0.34, 0.6, 0.4, -1.0), (0.05, 0.37, -0.03, 0.24, 0.4, 0.8, -0.7),
                                        (0.21, 0.2, -0.24, 0.22, 0.7, 0.2, -1.0)):
            for sd in (-1, 1):
                p = Vector((sd * x, y, z)); d = Vector((sd * dx, dy, dz)).normalized()
                bm_tube(bm, P(*p), P(*(p + d * ln)), 0.0085, 0.0, 5, cap=False)
    obj('head_bristles', headbits, [darkM, ocelM], head)

    for sd, nm in ((-1, 'L'), (1, 'R')):
        ant = empty('ant' + nm, P(sd * 0.085, 0.13, 0.33), parent=head, coll=coll)
        def antenna(bm, uvl, sd=sd):
            bm_tube(bm, P(0, 0, 0), P(sd * 0.01, -0.05, 0.05), 0.035, 0.03, 8)                # scape
            bm_ellipsoid(bm, P(sd * 0.012, -0.08, 0.07), (0.055, 0.05, 0.055), 10, 8)          # pedicel
            bm_ellipsoid(bm, P(sd * 0.02, -0.19, 0.1), (0.065, 0.085, 0.12), 12, 10)            # funiculus
        obj('antenna_' + nm, antenna, [headM], ant)
        def arista(bm, uvl, sd=sd):
            pts = [Vector((sd * 0.07, -0.13, 0.15)), Vector((sd * 0.1, -0.04, 0.22)), Vector((sd * 0.13, 0.06, 0.28)), Vector((sd * 0.15, 0.16, 0.32))]
            for k in range(3):
                bm_tube(bm, P(*pts[k]), P(*pts[k + 1]), 0.006 - 0.0015 * k, 0.0045 - 0.0015 * k, 5, cap=False)
            for k in range(7):
                t = (k + 0.5) / 7; q = pts[0].lerp(pts[3], t)
                for up in (1, -1):
                    br = Vector((0, 0.012, 0.035)) if up > 0 else Vector((0, -0.02, -0.012))
                    bm_tube(bm, P(*q), P(*(q + br)), 0.0022, 0.0, 4, cap=False)
        obj('arista_' + nm, arista, [darkM], ant)

    ros = empty('rostrum', P(0, -0.28, 0.2), rot=rotX(1.25), parent=head, coll=coll)
    def rostrum(bm, uvl): bm_tube(bm, Vector((0, 0, 0)), Vector((0, 0, -0.5)), 0.12, 0.09, 10)
    obj('rostrum_mesh', rostrum, [legM], ros)
    lab = empty('labella', Vector((0, 0, -0.5)), parent=ros, coll=coll)
    for sd, nm in ((-1, 'L'), (1, 'R')):
        piv = empty('lab' + nm, Vector((0, 0, 0)), parent=lab, coll=coll)
        def lobe(bm, uvl, sd=sd): bm_ellipsoid(bm, Vector((sd * 0.08, 0, -0.03)), (0.1, 0.13, 0.06), 12, 8)
        obj('lab' + nm + '_mesh', lobe, [headM], piv)

    # ---- abdomen: six tergites with ridges, a pointed tip (female) or a blunt dark one (male)
    abd = empty('abdomen', P(0, 0.95, -0.6), parent=body, coll=coll)
    L = 1.3 if male else 1.72; W = 0.56 if male else 0.68; droop = 0.24 if male else 0.1
    def abdomen(bm, uvl):
        Rn, S = 36, 24; rings = []; ctr = []
        for r in range(Rn + 1):
            t = r / Rn
            zc = 0.1 - L * t; yc = -droop * t * t - 0.04 * t
            if male: prof = math.sqrt(max(0.0, math.sin(math.pi * (0.12 + 0.88 * t)))) * max(0.0, 1 - t ** 5) ** 0.5
            else: prof = max(0.0, math.sin(math.pi * (0.1 + 0.9 * t))) ** 0.55 * (1 - 0.12 * t)
            tt = (t - 0.05) / 0.9 * 6; fr = tt - math.floor(tt)
            dip = (math.exp(-(fr / 0.06) ** 2) + math.exp(-((1 - fr) / 0.06) ** 2)) if 0 < tt < 6 else 0
            wdt = max(0.015, W * prof * (1 - 0.05 * dip))
            ring = []
            for k in range(S):
                th = 2 * math.pi * k / S
                v = bm.verts.new(P(math.cos(th) * wdt, yc + math.sin(th) * wdt * 0.8, zc))
                ring.append((v, (t, (math.sin(th) + 1) / 2)))
            rings.append(ring); ctr.append((yc, zc))
        for r in range(Rn):
            for k in range(S):
                q = [rings[r][k], rings[r + 1][k], rings[r + 1][(k + 1) % S], rings[r][(k + 1) % S]]
                f = bm.faces.new([v for v, _ in q])
                for l, (_, uvp) in zip(f.loops, q): l[uvl].uv = uvp
        for r, endt in ((0, 0.0), (Rn, 1.0)):
            cv = bm.verts.new(P(0, ctr[r][0], ctr[r][1] + (0.02 if r == 0 else -0.02)))
            for k in range(S):
                a_, b_ = rings[r][k], rings[r][(k + 1) % S]
                f = bm.faces.new((a_[0], b_[0], cv))
                for l, uvp in zip(f.loops, (a_[1], b_[1], (endt, 0.5))): l[uvl].uv = uvp
    obj('abdomen_mesh', abdomen, [abdoM], abd, uv=True)
    def abdomen_hairs(bm, uvl):
        for kseg in range(6):
            t = 0.05 + (kseg + 0.88) / 6 * 0.9
            zc = 0.1 - L * t; yc = -droop * t * t - 0.04 * t
            if male: prof = math.sqrt(max(0.0, math.sin(math.pi * (0.12 + 0.88 * t)))) * max(0.0, 1 - t ** 5) ** 0.5
            else: prof = max(0.0, math.sin(math.pi * (0.1 + 0.9 * t))) ** 0.55 * (1 - 0.12 * t)
            wdt = W * prof
            for k in range(9):
                th = math.pi * (0.2 + 0.6 * k / 8)
                p = Vector((math.cos(th) * wdt, yc + math.sin(th) * wdt * 0.8, zc))
                d = Vector((math.cos(th) * 0.4, math.sin(th) * 0.5, -1.0)).normalized()
                bm_tube(bm, P(*p), P(*(p + d * 0.1)), 0.0042, 0.0, 4, cap=False)
        if not male:
            tip = Vector((0, -droop - 0.04, 0.1 - L))
            for sd in (-1, 1): bm_tube(bm, P(*(tip + Vector((sd * 0.03, 0, 0.06)))), P(*(tip + Vector((sd * 0.02, -0.03, -0.1)))), 0.035, 0.0, 6)
    obj('abdomen_hairs', abdomen_hairs, [darkM], abd)

    # ---- wings: longer than the body, held flat over the abdomen, one overlapping the other
    Lw = 2.5
    for sd, nm in ((-1, 'L'), (1, 'R')):
        wp = empty('wing' + nm, P(sd * 0.16, 1.66, -0.1), rot=rotY3(sd * 0.1), parent=body, coll=coll)
        def wing(bm, uvl, sd=sd):
            A, C = 32, 8; grid = []
            for i in range(A + 1):
                a = i / A
                wprof = (a ** 0.38) * max(0.0, 1 - a ** 5) ** 0.5
                xo = 0.03 + 0.62 * wprof; xi = 0.03 - 0.15 * wprof
                row = []
                for j in range(C + 1):
                    c = j / C
                    y = 0.05 - 0.62 * a ** 1.4 + 0.03 * math.sin(math.pi * c) * wprof + (0.02 if sd < 0 else 0)
                    row.append((bm.verts.new(P(sd * (xi + (xo - xi) * c), y, -Lw * a)), (c, a)))
                grid.append(row)
            for i in range(A):
                for j in range(C):
                    q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
                    f = bm.faces.new([v for v, _ in q])
                    for l, (_, uvp) in zip(f.loops, q): l[uvl].uv = uvp
        obj('wing_mesh_' + nm, wing, [wingM], wp, uv=True, recalc=False)

    # ---- legs: coxa, femur, tibia, five tarsomeres and claws; the tarsus bends outward to lie flat
    LF, TIB, TARS, BEND = 0.95, 0.88, 0.72, 0.5
    legz = [0.62, 0.22, -0.2]
    tars_len = [0.32, 0.17, 0.15, 0.14, 0.22]
    for i in range(3):
        for sd, nm in ((-1, 'L'), (1, 'R')):
            hip = empty(f'hip_{nm}{i + 1}', P(sd * 0.34, 0.55, legz[i]), rot=rotY3(-sd * (i - 1) * 0.45), parent=body, coll=coll)
            def coxa(bm, uvl, sd=sd):
                bm_tube(bm, Vector((0, 0, 0.05)), Vector((sd * 0.1, 0, -0.1)), 0.065, 0.052, 10)
                bm_ellipsoid(bm, Vector((sd * 0.1, 0, -0.1)), (0.05, 0.05, 0.05), 10, 8)
            obj(f'coxa_{nm}{i + 1}', coxa, [legM], hip)
            fp = empty(f'femur_{nm}{i + 1}', Vector((0, 0, 0)), rot=rotZ3(sd * 1.2), parent=hip, coll=coll)
            def femur(bm, uvl):
                bm_tube(bm, Vector((0, 0, 0)), Vector((0, 0, -LF * 0.5)), 0.058, 0.066, 10)
                bm_tube(bm, Vector((0, 0, -LF * 0.5)), Vector((0, 0, -LF)), 0.066, 0.046, 10)
                bm_ellipsoid(bm, Vector((0, 0, -LF)), (0.043, 0.043, 0.043), 10, 8)
                for k in range(4):                       # a row of fine hairs along the femur
                    z = -LF * (0.2 + 0.18 * k)
                    bm_tube(bm, Vector((0.05, 0, z)), Vector((0.12, 0, z - 0.06)), 0.006, 0.0, 4, cap=False, mat_index=1)
            obj(f'femur_mesh_{nm}{i + 1}', femur, [legM, darkM], fp)
            kn = empty(f'knee_{nm}{i + 1}', Vector((0, 0, -LF)), rot=rotZ3(-sd * 1.6), parent=fp, coll=coll)
            def lower(bm, uvl, sd=sd, i=i):
                bm_tube(bm, Vector((0, 0, 0)), Vector((0, 0, -TIB)), 0.042, 0.032, 10)
                for k in range(5):
                    z = -TIB * (0.15 + 0.17 * k)
                    bm_tube(bm, Vector((0.035, 0, z)), Vector((0.09, 0, z - 0.07)), 0.005, 0.0, 4, cap=False, mat_index=1)
                d = Vector((sd * math.sin(BEND), 0, -math.cos(BEND)))
                p = Vector((0, 0, -TIB)); r = 0.03
                for k, ln in enumerate(tars_len):
                    q = p + d * (ln * TARS)
                    bm_tube(bm, p, q, r, r * 0.86, 8)
                    bm_ellipsoid(bm, q, (r * 0.8, r * 0.8, r * 0.8), 8, 6)
                    if male and i == 0 and k == 0:        # sex comb: a row of dark teeth on the first tarsomere
                        for c in range(6):
                            cc = p.lerp(q, 0.2 + 0.12 * c)
                            bm_tube(bm, cc, cc + Vector((0, -0.07, 0.0)), 0.009, 0.0, 4, cap=False, mat_index=1)
                    p = q; r *= 0.84
                for cy_ in (-1, 1):                       # claws
                    bm_tube(bm, p, p + d * 0.05 + Vector((0, cy_ * 0.035, -0.03)), 0.008, 0.0, 4, cap=False, mat_index=1)
            obj(f'tibia_mesh_{nm}{i + 1}', lower, [legM, darkM], kn)

    # rig numbers for fly.js: femur length, knee-to-claw reach, and the reach's angle off the tibia
    tipx = TARS * math.sin(BEND); tipy = TIB + TARS * math.cos(BEND)
    root['legLF'] = LF; root['legLT'] = math.hypot(tipx, tipy); root['legDelta'] = math.atan2(tipx, tipy)
    export(coll, 'fly_male.glb' if male else 'fly_female.glb', extras=True)
    return coll

fcoll = build_fly(False)
# the two flies share node names, so the female must leave the scene before the male is built
for o in list(fcoll.objects): bpy.data.objects.remove(o)
mcoll = build_fly(True)

# ================================================================ BROOD
brood = new_collection('brood')
eggM = material('egg', color=(0.94, 0.92, 0.86), rough=0.55, spec=0.3)
eg = sphere('egg', 0.28, Vector((0, 0, 0)), (1.0, 1.9, 0.9), eggM, brood, subsurf=1)
for s in (-1, 1):
    fl = cylinder(f'filament_{s}', 0.03, 0.015, 0.55, Vector((s * 0.1, 0.5, 0.15)), axis=Vector((s * 0.35, 0.8, 0.5)), mat=eggM, coll=brood); fl.parent = eg
export(brood, 'egg.glb')
for o in list(brood.objects): bpy.data.objects.remove(o)
larvaM = material('larva', color=(0.93, 0.90, 0.80), rough=0.4, coat=0.6)
lroot = empty('larva', Vector((0, 0, 0)), coll=brood)
for i in range(9):
    sgm = sphere(f'seg{i}', 0.24 if 1 <= i <= 6 else 0.19, Vector((0, -i * 0.3, 0)), (1, 1.1, 0.95), larvaM, brood, subsurf=1); sgm.parent = lroot
hooks = cylinder('hooks', 0.05, 0.01, 0.16, Vector((0, 0.2, -0.05)), axis=Vector((0, 0.7, -0.7)), mat=material('hooks', color=(0.15, 0.1, 0.06), rough=0.5), coll=brood); hooks.parent = lroot
export(brood, 'larva.glb')
for o in list(brood.objects): bpy.data.objects.remove(o)
pupaM = material('pupa', color=(0.55, 0.35, 0.16), rough=0.5, coat=0.3)
pp = lathe('pupa', [(0, 0), (0.25, 0.05), (0.42, 0.3), (0.46, 0.6), (0.44, 0.9), (0.47, 1.2), (0.45, 1.5), (0.47, 1.8), (0.42, 2.1), (0.3, 2.4), (0, 2.55)], 24, pupaM, brood, 1)
pp.rotation_euler = rotX(-math.pi / 2)
export(brood, 'pupa.glb')

# ================================================================ PREVIEW RENDER
try:
    cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
    cam.location = P(50, 140, 280); cam.rotation_euler = Euler((math.radians(62), 0, math.radians(11)), 'XYZ'); cam_data.lens = 32
    scene.camera = cam
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5; so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so)
    so.rotation_euler = Euler((math.radians(50), math.radians(-20), math.radians(160)), 'XYZ')
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.85, 0.95, 1); world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
    # place a female and a male on the counter for the preview
    for cname, at in (('fly_m', P(30, 0, -6)),):
        r = [o for o in bpy.data.collections[cname].objects if o.parent is None][0]; r.location = at; r.scale = (2.8, 2.8, 2.8)
    # a closer second render of the flies
    
    scene.render.resolution_x = 1400; scene.render.resolution_y = 900; scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = os.path.join(OUT, '_preview.png')
    bpy.ops.render.render(write_still=True)
    print('preview rendered', scene.render.filepath)
    r = [o for o in bpy.data.collections['fly_m'].objects if o.parent is None][0]; r.location = P(0, 0, 0); r.scale = (2.8, 2.8, 2.8)
    cam_data.lens = 85
    cam.location = P(9, 12, 16); cam.rotation_euler = Euler((math.radians(55), 0, math.radians(30)), 'XYZ')
    scene.render.filepath = os.path.join(OUT, '_preview_fly.png'); bpy.ops.render.render(write_still=True)
    cam.location = P(20, 4, 3); cam.rotation_euler = Euler((math.radians(82), 0, math.radians(90)), 'XYZ')
    scene.render.filepath = os.path.join(OUT, '_preview_fly_side.png'); bpy.ops.render.render(write_still=True)
    print('fly preview rendered')
except Exception as e:
    print('preview failed:', repr(e)[:300])
