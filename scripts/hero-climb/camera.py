# Cinematography and light for the baked climb (run after animate.py).
# - Camera: trails the hero's centre of mass on a critically damped spring, framed like the
#   studio still (hero on the right third, room for the headline on the left), with a slight
#   lean into each salto and a whisper of handheld drift. On PEEK it pulls back and up to
#   reveal the whole ladder he climbed.
# - Light: every spool has its own falling mint shaft; he swings out of one pool of light,
#   through the dark, into the next. The PEEK shaft blooms at the summit.
# - Dust hangs in every shaft.
import bpy, math, random
from mathutils import Vector, Euler

sc = bpy.context.scene
O = bpy.data.objects
track = bpy.app.driver_namespace['hero_track']
TOTAL = len(track)
KEYS = ['pla', 'petg', 'abs', 'asa', 'pc', 'nylon', 'ultem', 'peek']
FINAL = 34

def srgb(h):
    c = tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

stc = bpy.data.collections['Studio']
for n in ('green_fall', 'green_halo'):
    if n in O: bpy.data.objects.remove(O[n])
for o in [o for o in O if o.name.startswith(('beam_', 'dust'))]:
    bpy.data.objects.remove(o)

def pivot(m):
    return Vector((m * 6.0, 0.45 if m % 2 else -0.45, 7.25 + m * 0.9))

# ---------------------------------------------------------------- shafts of light
beams = []
for m, k in enumerate(KEYS):
    c = pivot(m) + Vector((0.6, 0, -3.6))           # centre of the swing, where he hangs
    ld = bpy.data.lights.new(f'beam_{k}', 'SPOT'); ld.color = srgb('#5cd6a0')
    ld.energy = 38000; ld.spot_size = math.radians(15); ld.spot_blend = 0.3; ld.shadow_soft_size = 0.15
    o = bpy.data.objects.new(f'beam_{k}', ld); stc.objects.link(o)
    o.location = c + Vector((-0.4, 0.6, 16)); o.rotation_euler = (c - o.location).to_track_quat('-Z', 'Y').to_euler()
    o.visible_volume_scatter = True; o.visible_camera = False
    beams.append((o, c))

# dust: one mesh, specks scattered through every shaft
import bmesh
bm = bmesh.new(); random.seed(8)
for o, c in beams:
    top = o.location; ax = (c + Vector((0, 0, -3))) - top
    for i in range(170):
        t = random.random() ** 0.75
        r = math.tan(math.radians(7)) * ax.length * t * math.sqrt(random.random()); a = random.random() * math.tau
        p = top + ax * t + Vector((math.cos(a) * r, math.sin(a) * r, 0))
        s = random.uniform(0.003, 0.009)
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s, matrix=__import__('mathutils').Matrix.Translation(p))
me = bpy.data.meshes.new('dust'); bm.to_mesh(me); bm.free()
me.materials.append(bpy.data.materials['dust'])
dust = bpy.data.objects.new('dust', me); stc.objects.link(dust)

# ---------------------------------------------------------------- camera path
cam = sc.camera
cam.animation_data_clear(); cam.data.animation_data_clear()
# f/5.6: the hero sharp head to toe, the background still falls away.
cam.data.dof.use_dof = True; cam.data.dof.aperture_fstop = 5.6
# Framing: the current reel peeks in at the top (its lower ~38% in shot), the hero swings
# below it. Vertically the camera is locked to the reel and glides to the next one during
# each flight; sideways it follows the hero. The shot is level: no tilt, like a dolly on a rail.
# Portrait (phones) is its own render: a taller frame, hero kept near the centre.
PORTRAIT = bpy.app.driver_namespace.get('portrait', False)
spool_of = bpy.app.driver_namespace['hero_spool']
REEL_R, SHOW = 1.3, 0.38                   # flange radius; share of the reel's height in shot
if PORTRAIT:
    LENS0, LENS1, DIST = 38, 30, 7.6
    VHALF = 18 / 38                        # sensor fit AUTO: the 36 mm side is the frame's height
    AIMX, TOWARD_REEL = 0.0, 0.15
    REVEAL_OFF, REVEAL_AIM = Vector((-4.0, -24.0, 2.0)), Vector((-3.5, 0, 0.5))
else:
    LENS0, LENS1, DIST = 42, 24, 13.0
    VHALF = (36 * 9 / 16 / 2) / 42
    AIMX, TOWARD_REEL = -2.2, 0.0          # hero on the right third, room for the headline
    REVEAL_OFF = Vector((-12.0, -35.0, 3.0))
    REVEAL_AIM = Vector((-14.0, 0, -1.5))
HALF_H = DIST * VHALF

# Critically damped follow, run twice (forward then back) so it leads nothing and lags evenly.
def follow(xs, k):
    out = [xs[0].copy()]
    v = Vector()
    for x in xs[1:]:
        p = out[-1]
        a = (x - p) * k * k - v * 2 * k
        v = v + a; out.append(p + v)
    return out
def smooth2(xs, k):
    f1 = follow(xs, k); f2 = follow(list(reversed(f1)), k)[::-1]
    return [a.lerp(b, 0.5) for a, b in zip(f1, f2)]
path = smooth2(track, 0.5)
LEASH = 0.7
for i, (p_, t_) in enumerate(zip(path, track)):
    d = t_ - p_
    if d.length > LEASH: path[i] = t_ - d.normalized() * LEASH
reel = smooth2([pivot(m) + Vector((0, 0, 1.05)) for m in spool_of], 0.2)

random.seed(2)
nx = [random.uniform(-1, 1) for _ in range(TOTAL // 12 + 3)]
ny = [random.uniform(-1, 1) for _ in range(TOTAL // 12 + 3)]
def drift(arr, f):
    i = f / 12; a = int(i); t = smooth(i - a)
    return arr[a] * (1 - t) + arr[a + 1] * t

for f in range(TOTAL):
    com = path[f]; r = reel[f]
    reveal = smooth((f - (TOTAL - FINAL + 8)) / (FINAL - 10))
    top = r.z - REEL_R + SHOW * 2 * REEL_R  # frame's top edge cuts the reel here
    cx = com.x + (r.x - com.x) * TOWARD_REEL + AIMX
    look0 = Vector((cx, com.y, top - HALF_H))
    loc0 = look0 + Vector((-0.8, -DIST, 0))
    cam.location = loc0.lerp(com + REVEAL_OFF, reveal)
    look = look0.lerp(com + REVEAL_AIM, reveal)
    rot = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    # lean into flights: the hero's own vertical speed tells us when he's airborne and rising
    vy = (track[min(f + 1, TOTAL - 1)].z - track[max(f - 1, 0)].z)
    rot.y += 0.0                                         # (Euler y is roll for this track axis setup)
    q = rot.to_quaternion()
    roll = math.radians(-2.2) * max(-1, min(1, vy * 2.0)) * (1 - reveal)
    hand = (math.radians(0.18) * drift(nx, f), math.radians(0.12) * drift(ny, f))
    q = q @ Euler((hand[1], hand[0], roll)).to_quaternion()
    cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = q
    cam.data.dof.focus_distance = (track[f] - cam.location).length
    cam.data.lens = LENS0 + (LENS1 - LENS0) * reveal
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_quaternion', frame=f)
    cam.data.keyframe_insert('dof.focus_distance', frame=f); cam.data.keyframe_insert('lens', frame=f)
    # key and rim ride with him
    for n, o2, e in (('key', Vector((4.5, -6.5, 1.6)), None), ('rim', Vector((-2.5, 5, 2.0)), None)):
        L = O[n]; L.location = track[f] + o2
        L.rotation_euler = (track[f] - L.location).to_track_quat('-Z', 'Y').to_euler()
        L.keyframe_insert('location', frame=f); L.keyframe_insert('rotation_euler', frame=f)
    # the summit: PEEK's shaft blooms as he settles
    pk = O['beam_peek'].data
    pk.energy = 38000 + 50000 * smooth((f - (TOTAL - FINAL)) / 20)
    pk.keyframe_insert('energy', frame=f)

for o in (cam, cam.data, O['key'], O['rim'], O['beam_peek'].data):
    ad = o.animation_data
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
print('camera keyed', TOTAL)
