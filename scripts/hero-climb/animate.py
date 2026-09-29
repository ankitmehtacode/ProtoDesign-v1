# The climb, PLA -> PEEK, baked to keyframes. Re-run any time: it clears and rebuilds.
# Source of the hero film (src/components/home/HeroSequence.tsx). The scene itself,
# hero-climb.blend, is kept outside the repo; see scripts/hero-climb/encode.sh.
#   In Blender: exec(open(os.path.expanduser('~/Documents/protodesign-hero/animate.py')).read())
#
# Everything is physics first, then timed for scroll:
# - Each swing is a real pendulum (phi'' = -g/Rc sin phi) of the hero's centre of mass.
# - Spacing (6 m, +0.9 m per spool), amplitude (1.04 rad), release (0.74 rad) and catch
#   (-0.48 rad) were solved so the gravity arc off one strand meets the next strand
#   tangentially: the catch has no jolt.
# - The body's orientation keeps the centre of mass on the strand line, so pumping
#   (arch at the back, pike through the bottom) visibly shifts the body the way a real
#   swing does.
# - In flight he does a back salto whose spin rate follows angular momentum: fast in the
#   tuck, slow when open. The last flight, onto PEEK, is a double.
# - The waiting strands sway on their own pendulum period, phased to arrive at the catch
#   point with him. Released strands swing back and damp out.
# - Scroll frames are spent unevenly: the flights run in slow motion.
import bpy, math
from mathutils import Vector, Matrix, Quaternion

sc = bpy.context.scene
O = bpy.data.objects
G = 9.81
RC = 4.0             # pivot -> centre of mass, for the pendulum
GAP, RISE = 6.0, 0.9
AMP, REL, CATCH, FLIGHT_T = 1.04, 0.74, -0.48, 0.46
N = 8
KEYS = ['pla', 'petg', 'abs', 'asa', 'pc', 'nylon', 'ultem', 'peek']
STRETCH = {'pla': .06, 'petg': .11, 'abs': .07, 'asa': .07, 'pc': .05, 'nylon': .16, 'ultem': .035, 'peek': .025}
STRAND_R = 0.0095

def pivot(m):
    return Vector((m * GAP, 0.45 if m % 2 else -0.45, 7.25 + m * RISE))

# ---------------------------------------------------------------- layout
for m, k in enumerate(KEYS):
    sp = O[f'spool_{m}_{k}']
    sp.location = pivot(m) + Vector((0, 0, 1.05))
    cab = O[f'cable_{k}']
    z0 = sp.location.z + 0.15
    cab.location = (sp.location.x, sp.location.y, z0 + (20.5 - z0) / 2); cab.scale.z = (20.5 - z0) / 14.0
    lt = O.get(f'spoollight_{k}')
    if lt:
        lt.location = sp.location + Vector((0.5, -2.5, 2.5))
        lt.rotation_euler = (sp.location - lt.location).to_track_quat('-Z', 'Y').to_euler()

# ---------------------------------------------------------------- rig + poses
arm = O['hero_rig']; root = O['hero_root']; body = O['hero_body']
bones = arm.data.bones
REST = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in bones}
ORDER = []
def walk(b):
    ORDER.append(b.name)
    for c in b.children: walk(c)
walk(next(b for b in bones if b.parent is None))

def D(p, s=0.0):
    p = math.radians(p); return Vector((math.sin(p), s, -math.cos(p))).normalized()

UPR, UPL = (178, -0.28), (173, 0.28)   # both hands up on the strand, together
P = {}
P['hang'] = dict(B_ab=D(181), B_ch=D(183), B_nk=D(183), B_hd=D(180),
    B_re=D(*UPR), B_rw=D(180, -.05), B_rh=D(180), B_le=D(*UPL), B_lw=D(178, .05), B_lh=D(178),
    B_rk=D(-4, .03), B_ra=D(-8), B_rt=D(-25), B_lk=D(-1, -.03), B_la=D(-4), B_lt=D(-25))
P['arch'] = dict(P['hang'], B_ab=D(190), B_ch=D(198), B_nk=D(194), B_hd=D(188),
    B_rk=D(-28, .04), B_ra=D(-62), B_rt=D(-80), B_lk=D(-24, -.04), B_la=D(-58), B_lt=D(-78))
P['pike'] = dict(P['hang'], B_ab=D(174), B_ch=D(168), B_nk=D(170), B_hd=D(172),
    B_rk=D(74, .02), B_ra=D(66), B_rt=D(84), B_lk=D(71, -.02), B_la=D(63), B_lt=D(80))
P['release'] = dict(P['hang'], B_ab=D(182), B_ch=D(186), B_nk=D(186), B_hd=D(188),
    B_rk=D(58, .02), B_ra=D(50), B_rt=D(70), B_lk=D(55, -.02), B_la=D(48), B_lt=D(68))
P['tuck'] = dict(B_ab=D(160), B_ch=D(146), B_nk=D(138), B_hd=D(128),
    B_re=D(64, -.2), B_rw=D(18, -.1), B_rh=D(10), B_le=D(66, .2), B_lw=D(20, .1), B_lh=D(12),
    B_rk=D(148, .08), B_ra=D(-22), B_rt=D(-40), B_lk=D(146, -.08), B_la=D(-24), B_lt=D(-42))
P['layout'] = dict(P['hang'], B_ab=D(186), B_ch=D(192), B_nk=D(190), B_hd=D(186),
    B_re=D(176, -.26), B_le=D(176, .26),
    B_rk=D(-12, .01), B_ra=D(-14), B_rt=D(-28), B_lk=D(-10, -.01), B_la=D(-12), B_lt=D(-28))

def blend(*pairs):
    """Weighted direction blend of poses: blend(('hang', .3), ('pike', .7))."""
    out = {}
    names = set().union(*(P[p].keys() for p, _ in pairs))
    for n in names:
        v = Vector()
        for p, w in pairs:
            v += P[p].get(n, P['hang'].get(n, (REST[n][1] - REST[n][0]).normalized())) * w
        out[n] = v.normalized()
    return out

MASS = {'B_hd': .08, 'B_ch': .2, 'B_ab': .17, 'B_nk': .05, 'B_re': .028, 'B_le': .028, 'B_rw': .016, 'B_lw': .016,
        'B_rh': .006, 'B_lh': .006, 'B_rk': .1, 'B_lk': .1, 'B_ra': .045, 'B_la': .045, 'B_rt': .015, 'B_lt': .015}

def solve(pose):
    """Pose-bone matrices (armature space) for a pose, plus joint positions and centre of mass."""
    M, tails = {}, {}
    for n in ORDER:
        b = bones[n]; h0, t0 = REST[n]; rest = b.matrix_local
        if b.parent is None:
            M[n] = rest.copy()
        else:
            pn = b.parent.name
            head = tails[pn]
            want = pose.get(n)
            # Unposed bones (shoulders, hips) ride along with their parent's rotation.
            pr = M[pn].to_3x3() @ bones[pn].matrix_local.to_3x3().inverted()
            if want is None:
                rot = pr @ rest.to_3x3()
            else:
                cur = (pr @ rest.to_3x3()).col[1]
                rot = cur.rotation_difference(want).to_matrix() @ pr @ rest.to_3x3()
            M[n] = Matrix.Translation(head) @ rot.to_4x4()
        tails[n] = M[n] @ Vector((0, b.length, 0))
    com = Vector(); tot = 0
    for n, w in MASS.items():
        mid = (M[n].translation + tails[n]) / 2
        com += mid * w; tot += w
    return M, tails, com / tot

def apply(M):
    for n in ORDER:
        pb = arm.pose.bones[n]; b = bones[n]
        if b.parent is None:
            basis = b.matrix_local.inverted() @ M[n]
        else:
            pn = b.parent.name
            basis = (M[pn] @ bones[pn].matrix_local.inverted() @ b.matrix_local).inverted() @ M[n]
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = basis.to_quaternion()

# ---------------------------------------------------------------- physics timeline
def smooth(t): t = max(0, min(1, t)); return t * t * (3 - 2 * t)

def pendulum(phi0, w0, until, damp=0.0, dt=1 / 600):
    """Integrate the COM pendulum; returns [(t, phi, w)] until `until(phi, w, t)`."""
    out = [(0.0, phi0, w0)]; phi, w, t = phi0, w0, 0.0
    while not until(phi, w, t):
        a = -(G / RC) * math.sin(phi) - damp * w
        w += a * dt; phi += w * dt; t += dt
        out.append((t, phi, w))
    return out

def at(samples, t):
    i = min(int(t / (samples[1][0] - samples[0][0])), len(samples) - 1)
    return samples[i]

w_catch = math.sqrt(2 * G / RC * (math.cos(CATCH) - math.cos(AMP)))
EV = []   # events: ('swing', spool, samples) / ('fly', from, to, T, double)
# Intro: he hangs still in the PLA light, then pumps. Each pass grows (arch behind, pike
# through the bottom) until he reaches the back of a full swing with the energy to fly.
W0 = math.sqrt(G / RC); T_PUMP = 3 * math.pi / W0          # one and a half periods
def amp_at(t): return AMP * smooth(t / T_PUMP) ** 1.15
pump = []
for i in range(0, 2401):
    t = T_PUMP * i / 2400
    phi = -amp_at(t) * math.cos(W0 * (t - T_PUMP))
    pump.append((t, phi, 0.0))
for i in range(1, len(pump) - 1):
    pump[i] = (pump[i][0], pump[i][1], (pump[i + 1][1] - pump[i - 1][1]) / (pump[i + 1][0] - pump[i - 1][0]))
EV.append(('pump', 0, pump, T_PUMP))
EV.append(('swing', 0, pendulum(-AMP, 0.0, lambda p, w, t: p >= REL)))
for m in range(1, N):
    EV.append(('fly', m - 1, m, FLIGHT_T, m == N - 1))
    if m < N - 1:
        EV.append(('swing', m, pendulum(CATCH, w_catch, lambda p, w, t: p >= REL)))
    else:
        # PEEK: swing through, back, and settle. Damped, it hangs still at the end.
        EV.append(('swing', m, pendulum(CATCH, w_catch, lambda p, w, t: t > 5.2, damp=0.55)))

# Scroll frames per event: flights in slow motion, the finale lingers.
FR = {'pump': 45, 'swing': 26, 'fly': 18, 'final': 44}
frames = []   # (event index, local 0..1)
for i, ev in enumerate(EV):
    n = FR['final'] if (ev[0] == 'swing' and ev[1] == N - 1) else FR[ev[0]]
    for f in range(n):
        frames.append((i, f / n))
frames.append((len(EV) - 1, 1.0))
TOTAL = len(frames)

def pose_swing(u, first):
    # catch (layout) -> absorb into arch -> beat to pike through the bottom -> open to release
    if first:
        a = smooth(u / 0.35); b = smooth((u - 0.4) / 0.25); c = smooth((u - 0.68) / 0.26)
        return blend(('arch', (1 - b) * (1 - c)), ('pike', b * (1 - c)), ('release', c))
    a = smooth(u / 0.18); b = smooth((u - 0.3) / 0.22); c = smooth((u - 0.6) / 0.28)
    return blend(('layout', 1 - a), ('arch', a * (1 - b) * (1 - c)), ('pike', a * b * (1 - c)), ('release', c))

def pose_final(u, phi):
    # On PEEK: pike through, arch on the way back, then relax into a still hang.
    s = smooth(u / 0.12); r = smooth((u - 0.55) / 0.4)
    k = max(0.0, min(1.0, phi / AMP))
    beat = blend(('pike', max(k, 0.0) + 0.001), ('arch', max(-phi / AMP, 0) + 0.001))
    out = {}
    for n in set(beat) | set(P['hang']):
        v = P['layout'].get(n, P['hang'].get(n)) * (1 - s) + beat.get(n, P['hang'].get(n)) * s * (1 - r) + P['hang'].get(n, beat.get(n)) * s * r
        out[n] = v.normalized()
    return out

def pose_pump(phi, w, grow):
    # forward through the bottom: pike (the beat); behind: arch. Scaled by how hard he pumps.
    wmax = math.sqrt(2 * G / RC * (1 - math.cos(AMP)))
    pk = max(0.0, w) / wmax * grow; ar = max(0.0, -phi) / AMP * grow
    return blend(('hang', max(0.0, 1 - pk - ar) + 1e-3), ('pike', pk), ('arch', ar))

def pose_fly(u):
    t = smooth(u / 0.22); o = smooth((u - 0.62) / 0.3)
    return blend(('release', 1 - t), ('tuck', t * (1 - o)), ('layout', o))

def spin_profile(u):
    """Cumulative rotation fraction 0..1 at flight progress u: rate ~ 1/inertia."""
    steps = 200; acc = [0.0]
    for i in range(steps):
        x = (i + 0.5) / steps
        tuck = smooth(x / 0.22) * (1 - smooth((x - 0.62) / 0.3))
        acc.append(acc[-1] + 1.0 / (1.0 - 0.68 * tuck))
    k = min(int(u * steps), steps)
    return acc[k] / acc[-1]

def place_on_strand(m, phi, pose, stretch=0.0):
    """Root transform with the COM on the strand line of spool m at angle phi."""
    M, tails, com = solve(pose)
    hand = tails['B_rh']
    c = com - hand
    alpha = math.atan2(c.x, -c.z)
    theta = alpha - phi
    R = Matrix.Rotation(theta, 4, 'Y')
    comW = pivot(m) + Vector((math.sin(phi), 0, -math.cos(phi))) * (RC + stretch)
    loc = comW - (R @ com.to_4d()).to_3d()
    return M, loc, theta, comW, (R @ hand.to_4d()).to_3d() + loc

def com_vel(m, phi, w):
    return Vector((math.cos(phi), 0, math.sin(phi))) * RC * w

# ---------------------------------------------------------------- strands
def strand_mat(k):
    name = 'strand_' + k
    if name in bpy.data.materials: return bpy.data.materials[name]
    m = bpy.data.materials['fil_' + k].copy(); m.name = name
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Emission Color'].default_value = p.inputs['Base Color'].default_value
    p.inputs['Emission Strength'].default_value = 0.6 if k in ('asa',) else 2.0
    p.inputs['Transmission Weight'].default_value = 0.0
    return m

scol = bpy.data.collections['Spools']
if 'strand_unit' not in bpy.data.meshes:
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=STRAND_R, depth=1, location=(0, 0, -0.5))
    t = bpy.context.active_object; me = t.data; me.name = 'strand_unit'
    for v in me.vertices: v.co.z -= 0.5   # top at origin, hangs down one unit
    bpy.data.objects.remove(t)
for o in ('strand', 'strand_tail'):
    if o in O: bpy.data.objects.remove(O[o])
STR = []
for m, k in enumerate(KEYS):
    o = O.get(f'strand_{k}') or bpy.data.objects.new(f'strand_{k}', bpy.data.meshes['strand_unit'])
    if o.name not in scol.objects: scol.objects.link(o)
    o.data.materials.clear() if False else None
    if not o.material_slots: o.data.materials.append(None)
    o.material_slots[0].link = 'OBJECT'; o.material_slots[0].material = strand_mat(k)
    for p in o.data.polygons: p.use_smooth = True
    STR.append(o)

L_FREE = RC - 0.85
W_FREE = math.sqrt(G / L_FREE)

def aim(o, top, end):
    d = end - top
    o.location = top
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(d.normalized())
    o.scale = (1, 1, d.length)

# ---------------------------------------------------------------- bake
for o in [root, arm] + STR + [O[f'spool_{m}_{k}'] for m, k in enumerate(KEYS)]:
    o.animation_data_clear()
arm.animation_data_clear()
sc.frame_start, sc.frame_end = 0, TOTAL - 1

# Real time at each event start (for the free strands' pendulum clocks)
t_start = []; tt = 0.0
for ev in EV:
    t_start.append(tt)
    tt += (ev[2][-1][0] if ev[0] == 'swing' else ev[3])
catch_time = {ev[2]: t_start[i] + ev[3] for i, ev in enumerate(EV) if ev[0] == 'fly'}
release_time = {EV[i][1]: t_start[i] + EV[i][2][-1][0] for i in range(len(EV)) if EV[i][0] == 'swing'}

track = []  # per-frame COM, for the camera
prev_theta = None
for f, (i, u) in enumerate(frames):
    ev = EV[i]
    if ev[0] == 'pump':
        S = ev[2]; tr = u * ev[3]; _, phi, w = at(S, tr)
        M, loc, theta, comW, handW = place_on_strand(0, phi, pose_pump(phi, w, smooth(tr / ev[3] * 1.6)))
        now = t_start[i] + tr; held = 0
    elif ev[0] == 'swing':
        m, S = ev[1], ev[2]
        tr = u * S[-1][0]; _, phi, w = at(S, tr)
        final = (m == N - 1)
        pose = pose_final(u, phi) if final else pose_swing(u, m == 0)
        # the catch loads the strand: it stretches and rings, stiffer materials less
        ring = 0.0 if m == 0 else STRETCH[KEYS[m]] * math.exp(-tr * 5.0) * math.sin(tr * 26.0)
        M, loc, theta, comW, handW = place_on_strand(m, phi, pose, ring)
        now = t_start[i] + tr; held = m
    else:
        a, b, T, double = ev[1], ev[2], ev[3], ev[4]
        S0 = EV[i - 1][2]; _, pr, wr = S0[-1]
        _, _, th0, P0, _ = place_on_strand(a, pr, pose_swing(1.0, a == 0))
        _, _, th1, P1, _ = place_on_strand(b, CATCH, P['layout'])
        V0 = com_vel(a, pr, wr); V1 = com_vel(b, CATCH, w_catch)
        tr = u * T; s = u
        # Hermite in position with the true end velocities: an exact gravity arc to the eye
        h00 = 2*s**3 - 3*s**2 + 1; h10 = s**3 - 2*s**2 + s; h01 = -2*s**3 + 3*s**2; h11 = s**3 - s**2
        comW = P0 * h00 + V0 * (h10 * T) + P1 * h01 + V1 * (h11 * T)
        comW.y = P0.y + (P1.y - P0.y) * smooth(s)
        pose = pose_fly(u)
        M, tails, com = solve(pose)
        turns = 2 if double else 1
        target = th1 - 2 * math.pi * turns       # back salto: theta decreases
        while target > th0 - 2 * math.pi * turns + math.pi: target -= 2 * math.pi
        theta = th0 + (target - th0) * spin_profile(u)
        R = Matrix.Rotation(theta, 4, 'Y')
        loc = comW - (R @ com.to_4d()).to_3d()
        handW = (R @ tails['B_rh'].to_4d()).to_3d() + loc
        now = t_start[i] + tr; held = None
    if prev_theta is not None:   # keep rotation continuous for motion blur
        while theta - prev_theta > math.pi: theta -= 2 * math.pi
        while theta - prev_theta < -math.pi: theta += 2 * math.pi
    prev_theta = theta
    sc.frame_set(f)
    apply(M)
    for n in ORDER: arm.pose.bones[n].keyframe_insert('rotation_quaternion', frame=f)
    root.location = loc; root.rotation_mode = 'XYZ'; root.rotation_euler = (0, theta, 0)
    root.keyframe_insert('location', frame=f); root.keyframe_insert('rotation_euler', frame=f)
    track.append(comW.copy())
    # strands
    for m, o in enumerate(STR):
        top = pivot(m)
        if held == m:
            end = handW
        else:
            if m in release_time and now > release_time[m]:
                # let go: it swings back and damps out
                dt = now - release_time[m]
                a0 = REL * 0.9
                ang = a0 * math.exp(-dt * 0.9) * math.cos(W_FREE * dt)
                length = L_FREE
            else:
                # waiting: sways on its own period, phased to meet him at the catch
                ct = catch_time.get(m, 0.0)
                amp = abs(CATCH) * (0.35 + 0.65 * smooth(1 - (ct - now) / 3.0)) if m else 0.0
                ang = amp * math.cos(W_FREE * (now - ct) + math.pi * 0) * (1 if m else 0)
                ang = -abs(amp) * math.cos(W_FREE * (now - ct))
                length = L_FREE
            end = top + Vector((math.sin(ang), 0, -math.cos(ang))) * length
        aim(o, top, end)
        o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_quaternion', frame=f); o.keyframe_insert('scale', frame=f)
    # spools pay out filament as their strand is worked
    for m, k in enumerate(KEYS):
        sp = O[f'spool_{m}_{k}']
        work = max(0.0, min(1.0, (now - (catch_time.get(m, 0.0) - 0.5)) / 2.0))
        sp.rotation_mode = 'XYZ'
        base = (math.pi / 2, 0, (-1.0 if m % 2 == 0 else 1.0) * 0.95 + 0.15)
        wind = O[f'wind_{k}']
        wind.rotation_euler.z = m * 0.9 + work * 1.6
        wind.keyframe_insert('rotation_euler', frame=f)

# Linear interpolation: every frame is baked, nothing should overshoot between them.
for o in [root, arm] + STR + [O[f'wind_{k}'] for k in KEYS]:
    if o.animation_data and o.animation_data.action:
        for fc in o.animation_data.action.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'

bpy.app.driver_namespace['hero_track'] = track
print('baked frames', TOTAL, 'events', len(EV))

# Which spool each frame belongs to, for the page's caption: the one in hand, or during a
# flight the one he left until he passes halfway.
import json, os
spool_of = []
for i, u in frames:
    ev = EV[i]
    spool_of.append(ev[1] if ev[0] != 'fly' else (ev[1] if u < 0.5 else ev[2]))
bpy.app.driver_namespace['hero_spool'] = spool_of
with open(os.path.expanduser('~/Documents/protodesign-hero/climb.json'), 'w') as fh:
    json.dump({'frames': TOTAL, 'spool': spool_of}, fh, separators=(',', ':'))
