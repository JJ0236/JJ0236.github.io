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

def tex_wing():
    h, w = 512, 256; yy, xx = np.mgrid[0:h, 0:w]; u = xx / w; v = yy / h
    alpha = np.ones((h, w)) * 0.22
    col = np.ones((h, w, 3)) * np.array([0.90, 0.93, 0.98])
    def vein(f, width=0.012, strength=1.0):
        d = np.abs(u - f(v)); m = np.clip(1 - d / width, 0, 1) * strength
        return m
    veins = np.zeros((h, w))
    for k, (a, b, c) in enumerate([(0.18, 0.05, 0.0), (0.34, 0.08, 0.02), (0.52, 0.12, -0.02), (0.70, 0.10, 0.0), (0.86, 0.06, 0.0)]):
        veins = np.maximum(veins, vein(lambda t, a=a, b=b, c=c: a + b * t + c * t * t, 0.010, 1.0))
    veins = np.maximum(veins, vein(lambda t: 0.5 + 0.45 * np.sin(t * math.pi * 1.0) * 0 + 0.0, 0.0))
    cross = np.clip(1 - np.abs(v - 0.55) / 0.006, 0, 1) * ((u > 0.3) & (u < 0.72))
    veins = np.maximum(veins, cross)
    col = col * (1 - veins[..., None] * 0.75) + np.array([0.25, 0.22, 0.18])[None, None, :] * veins[..., None] * 0.75
    alpha = np.maximum(alpha, veins * 0.95)
    return save_image('wing', np.dstack([col, alpha]))

def tex_abdomen(male):
    h, w = 512, 256; yy, xx = np.mgrid[0:h, 0:w]; v = yy / h   # v runs from thorax (0) to tip (1)
    tan = np.array([0.74, 0.58, 0.32]); black = np.array([0.12, 0.09, 0.07])
    col = tan[None, None, :] * np.ones((h, w, 1))
    band = np.zeros((h, w))
    for k in range(5):
        c = 0.2 + k * 0.17; wdt = 0.022 + 0.004 * k
        b = np.clip(1 - np.abs(v - c) / wdt, 0, 1) ** 0.5
        band = np.maximum(band, b * (0.55 + 0.45 * min(1, k / 3)))
    if male: band = np.maximum(band, np.clip((v - 0.66) * 9, 0, 1))
    col = col * (1 - band[..., None] * 0.9) + black[None, None, :] * band[..., None] * 0.9
    col += (noise2(h, w, 5, 8 + int(male))[..., None] - 0.5) * 0.05
    return save_image('abdomen_' + ('m' if male else 'f'), np.dstack([col, np.ones((h, w))]))

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

def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    objs = [o for o in coll.all_objects]
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO', export_animations=False, export_extras=False)
    print('exported', path, os.path.getsize(path), 'bytes')

# ================================================================ THE SET
setc = new_collection('set')
wood = material('counter', tex=tex_wood(), rough=0.55)
tiles = material('tiles', tex=tex_tiles(), rough=0.35, spec=0.6)
paint = material('paint', color=(0.90, 0.88, 0.82), rough=0.6)
glassM = material('glass', color=(0.95, 0.98, 1.0), rough=0.04, transmission=1.0, ior=1.5, alpha=0.15)

# counter (top at y = 0), front apron, wall, window frame, sill
box('counter', (250, 140, 12), P(0, -6, 2), wood, setc, bevel=1.2, uvscale=250)
box('apron', (250, 6, 60), P(0, -42, 69), paint, setc, bevel=0.8)
box('wall', (600, 2, 300), P(0, 120, -70), tiles, setc, uvscale=110)
W, H, y0 = 230, 190, 18
for nm, (x, y, w, h) in {'frame_l': (-W / 2, y0 + H / 2, 8, H + 8), 'frame_r': (W / 2, y0 + H / 2, 8, H + 8), 'frame_b': (0, y0, W + 8, 10), 'frame_t': (0, y0 + H, W + 8, 8), 'mullion': (0, y0 + H / 2, 6, H), 'transom': (0, y0 + H * 0.55, W, 5)}.items():
    box(nm, (w, 12, h), P(x, y, -69), paint, setc, bevel=0.6)
box('sill', (W + 30, 22, 6), P(0, 3, -60), paint, setc, bevel=1.0)
gl = box('window_glass', (W, 1, H), P(0, y0 + H / 2, -75), glassM, setc)

# banana: the same curve as world.js, pentagonal ridges, tapered ends
bpts = [P(-105, 9, 10), P(-70, 12, 2), P(-35, 12, 6), P(-4, 9, 18)]
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
lathe('plate', [(0, 0), (26, 0), (30, 1.5), (33, 3.0), (34.5, 4.2), (33.5, 5.0), (31, 4.6), (27, 3.4), (0, 3.2)], 64, ceramic, setc, 1, P(58, 0, 28))
lathe('plate_rim', [(31.5, 4.0), (34.8, 4.4), (34.2, 5.4), (31.2, 4.9), (31.5, 4.0)], 64, blueM, setc, 0, P(58, 0, 28), closed_bottom=False)
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
apple_slice('slice_1', 50, 22, 0.6); apple_slice('slice_2', 68, 36, 2.9)

# jam jar, jam, lid, drip
jar_profile = [(0, 0), (19, 0), (21, 1.5), (21.5, 6), (22.5, 30), (22.5, 50), (20.5, 55), (19.5, 58), (20.5, 61), (20.5, 62)]
jar = lathe('jar', jar_profile, 64, glassM, setc, 1, P(96, 0, -32))
sol = jar.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 1.6; sol.offset = -1
jamM = material('jam', color=(0.42, 0.06, 0.16), rough=0.28, coat=0.3, spec=0.7)
lathe('jam', [(0, 1.5), (18.5, 1.5), (19.5, 6), (20.5, 30), (20.5, 36), (19, 38.5), (12, 39.5), (0, 39.8)], 48, jamM, setc, 1, P(96, 0, -32))
metal = material('lid', color=(0.72, 0.70, 0.66), rough=0.35, metal=0.9)
lid = lathe('lid', [(0, 0), (22, 0), (23, 1), (23, 5), (22, 6), (0, 6)], 64, metal, setc, 0, P(64, 0, -4))
lid.rotation_euler = rotY3(0.1)
dripM = material('drip', color=(0.55, 0.10, 0.22), rough=0.12, coat=0.9)
sphere('drip', 6, P(72, 1.4, -32), (1.4, 1.1, 0.32), dripM, setc, subsurf=1)
sphere('drip2', 3, P(80, 1.0, -28), (1.2, 1.0, 0.3), dripM, setc, subsurf=1)

# spilled juice: a flat glossy puddle
juiceM = material('juice', color=(0.78, 0.42, 0.10), rough=0.06, coat=1.0)
bm = bmesh.new(); pts = []
for k in range(40):
    a = 2 * math.pi * k / 40; rr = 15 * (1 + 0.18 * math.sin(a * 3) + 0.1 * math.cos(a * 5))
    pts.append(bm.verts.new(P(-30 + math.cos(a) * rr * 1.3, 0, 48 + math.sin(a) * rr * 0.85)))
f = bm.faces.new(pts)
sp = make_obj('spill', bm, juiceM, False, setc, 0); sp.location = Vector((0, 0, 0.25))

# cloth: simulated over a hidden block, then frozen
clothM = material('cloth', tex=tex_cloth(), rough=0.95)
blk = box('cloth_block', (40, 30, 9), P(-96, 4.5, -44), None, setc)
blk.hide_render = True
bpy.ops.mesh.primitive_plane_add(size=1, location=P(-96, 18, -44))
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
box('counter_col', (250, 140, 12), P(0, -6, 2), None, setc).modifiers.new('col', 'COLLISION')
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
lathe('bowl', [(0, 0), (14, 0), (18, 1.2), (24, 6), (28, 14), (29, 20), (27.5, 21), (26.5, 20), (23, 14), (18, 7), (14, 4), (0, 3.5)], 64, bowlM, setc, 1, P(100, 0, 45))
orangeM = material('orange', color=(0.95, 0.48, 0.10), rough=0.55)
sphere('orange_1', 12, P(94, 15, 42), (1, 0.92, 1), orangeM, setc, subsurf=1)
sphere('orange_2', 11, P(110, 14, 52), (1, 0.92, 1), orangeM, setc, subsurf=1)

export(setc, 'set.glb')

# ================================================================ FLIES
def build_fly(male):
    coll = new_collection('fly_m' if male else 'fly_f')
    cuticle = material('cuticle_' + ('m' if male else 'f'), color=(0.62, 0.46, 0.26), rough=0.55, coat=0.08)
    thoraxM = material('thorax_' + ('m' if male else 'f'), color=(0.50, 0.40, 0.28), rough=0.5, coat=0.1)
    darkM = material('dark_' + ('m' if male else 'f'), color=(0.12, 0.09, 0.07), rough=0.5)
    legM = material('leg_' + ('m' if male else 'f'), color=(0.55, 0.42, 0.24), rough=0.6)
    eyeM = material('eye_' + ('m' if male else 'f'), color=(0.78, 0.09, 0.03), rough=0.35, coat=0.4)
    abdoM = material('abdomen_' + ('m' if male else 'f'), tex=tex_abdomen(male), rough=0.5, coat=0.1)
    wingM = material('wingmat_' + ('m' if male else 'f'), tex=tex_wing(), alpha='tex', rough=0.12, spec=1.0)
    root = empty('root', Vector((0, 0, 0)), coll=coll)
    body = empty('body', Vector((0, 0, 0)), parent=root, coll=coll)
    # thorax
    th = sphere('thorax', 0.68, P(0, 1.02, 0.25), (1.0, 1.3, 0.95), thoraxM, coll, subsurf=1); th.parent = body
    sc = sphere('scutellum', 0.28, P(0, 1.25, -0.45), (1.1, 0.6, 1.0), thoraxM, coll, subsurf=1); sc.parent = body
    # abdomen on a pivot; a tube tapering to the tip (built in the pivot's frame)
    abd = empty('abdomen', P(0, 0.85, -0.55), parent=body, coll=coll)
    L = 1.55 if male else 1.95
    apts = [P(0, 0, 0.1), P(0, 0.02, 0.1 - L * 0.5), P(0, -0.08, 0.1 - L)]
    def abd_r(t, thta):
        base = 0.66 if male else 0.74
        prof = math.sin(math.pi * (0.06 + 0.94 * t)) ** (0.55 if male else 0.5)
        return base * max(0.05, prof) * (1 + 0.12 * math.cos(thta * 2))
    ab = tube('abdomen_mesh', apts, abd_r, sides=20, rings=24, mat=abdoM, coll=coll, subsurf=1); ab.parent = abd
    # head, in its own frame
    head = empty('head', P(0, 1.02, 1.12), parent=body, coll=coll)
    hm = sphere('head_mesh', 0.4, Vector((0, 0, 0)), (1.25, 0.95, 0.8), cuticle, coll, subsurf=1); hm.parent = head
    for s, nm in ((-1, 'L'), (1, 'R')):
        e = sphere('eye_' + nm, 0.36, P(s * 0.36, 0.02, 0.08), (0.75, 1.1, 1.0), eyeM, coll, subsurf=1); e.parent = head
        ant = empty('ant' + nm, P(s * 0.16, 0.22, 0.41), rot=rotX(-0.6), parent=head, coll=coll)
        seg = cylinder('ant_seg_' + nm, 0.07, 0.04, 0.5, Vector((0, 0, 0)), axis='z', mat=darkM, coll=coll); seg.parent = ant
        ar = cylinder('arista_' + nm, 0.015, 0.008, 0.55, Vector((0, 0, 0.48)), axis=Vector((s * 0.6, 0, 0.8)), mat=darkM, coll=coll); ar.parent = ant
    # proboscis: rostrum pivot under the head, tucked at rest by +1.25 rad about X
    ros = empty('rostrum', P(0, -0.30, 0.30), rot=rotX(1.25), parent=head, coll=coll)
    rs = cylinder('rostrum_mesh', 0.15, 0.11, 0.62, Vector((0, 0, 0)), axis='-z', mat=darkM, coll=coll, subsurf=1); rs.parent = ros
    lab = empty('labella', Vector((0, 0, -0.62)), parent=ros, coll=coll)
    for s, nm in ((-1, 'L'), (1, 'R')):
        piv = empty('lab' + nm, Vector((0, 0, 0)), parent=lab, coll=coll)
        lb = sphere('lab' + nm + '_mesh', 0.15, Vector((s * 0.1, 0, 0)), (1.0, 1.3, 0.6), cuticle, coll, subsurf=1); lb.parent = piv
    # legs
    legz = [0.85, 0.25, -0.35]
    for i in range(3):
        for s, nm in ((-1, 'L'), (1, 'R')):
            hip = empty(f'hip_{nm}{i + 1}', P(s * 0.5, 0.62, legz[i]), rot=rotY3(-s * (i - 1) * 0.35), parent=body, coll=coll)
            fp = empty(f'femur_{nm}{i + 1}', Vector((0, 0, 0)), rot=rotZ3(s * 1.25), parent=hip, coll=coll)
            fe = cylinder(f'femur_mesh_{nm}{i + 1}', 0.075, 0.055, 1.05, Vector((0, 0, 0)), axis='-z', mat=legM, coll=coll, subsurf=1); fe.parent = fp
            kn = empty(f'knee_{nm}{i + 1}', Vector((0, 0, -1.05)), rot=rotZ3(-s * 1.7), parent=fp, coll=coll)
            ti = cylinder(f'tibia_mesh_{nm}{i + 1}', 0.05, 0.035, 1.0, Vector((0, 0, 0)), axis='-z', mat=legM, coll=coll, subsurf=1); ti.parent = kn
            ta = cylinder(f'tarsus_mesh_{nm}{i + 1}', 0.032, 0.018, 0.65, Vector((0, 0, 0)), axis='-z', mat=legM, coll=coll, subsurf=1); ta.parent = kn
            ta.location = Vector((0, 0, -1.0)); ta.rotation_euler = rotZ3(s * 0.35)
            kj = sphere(f'knee_joint_{nm}{i + 1}', 0.06, Vector((0, 0, 0)), (1, 1, 1), legM, coll, subsurf=0); kj.parent = kn
            hj = sphere(f'hip_joint_{nm}{i + 1}', 0.085, Vector((0, 0, 0)), (1, 1, 1), legM, coll, subsurf=0); hj.parent = fp
            if male and i == 0:
                comb = box(f'sexcomb_{nm}', (0.09, 0.06, 0.16), Vector((0, 0.05, -0.5)), darkM, coll); comb.parent = kn
    # wings
    for s, nm in ((-1, 'L'), (1, 'R')):
        wp = empty('wing' + nm, P(s * 0.22, 1.55, 0.05), rot=rotY3(s * 0.1), parent=body, coll=coll)
        bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new('UVMap')
        outline = []
        for k in range(28):
            t = k / 27; ang = math.pi * t
            wdt = 0.42 * math.sin(ang) ** 0.8 * (1 + 0.15 * math.sin(2 * ang))
            outline.append((s * (0.18 + wdt), -0.05 - 2.45 * (1 - math.cos(ang)) / 2 * 2 / 2))
        pts = [(s * 0.1, 0.0)] + [(s * (0.12 + 0.5 * math.sin(math.pi * k / 27) ** 0.65 * (1.0 + 0.35 * (k / 27))), -3.0 * k / 27) for k in range(28)] + [(s * 0.08, -3.0)]
        verts = [bm.verts.new(P(x, 0, z)) for (x, z) in pts]
        f = bm.faces.new(verts)
        for l in f.loops:
            c = l.vert.co; l[uv_layer].uv = (0.5 + s * (c.x - s * 0.1) / 1.3, -c.y / 3.0)
        w = make_obj('wing_mesh_' + nm, bm, wingM, True, coll, 0); w.parent = wp
        # halteres
        hal = cylinder('haltere_' + nm, 0.03, 0.06, 0.35, P(s * 0.45, 1.25, -0.35), axis=Vector((s * 0.7, -0.5, -0.5)), mat=darkM, coll=coll); hal.parent = body
    export(coll, 'fly_male.glb' if male else 'fly_female.glb')
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
    cam.location = P(40, 120, 205); cam.rotation_euler = Euler((math.radians(62), 0, math.radians(11)), 'XYZ'); cam_data.lens = 38
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
