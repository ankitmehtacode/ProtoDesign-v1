"""Fit the quote estimate's physics constants to the slicer results.

Run after slice.py: python3 fit.py. Prints the constants for PRINTER_QUALITIES
in src/lib/quote.ts and the error of the estimate against the slicer.
Standard library only.

Filament  = min(V, A*shell) + rest*infill + SUPPORT_FILL*overhangSpace
Time      = max(per-layer + per-cm3 terms, layers * cooling floor) + start
"""
import json, math

R = json.load(open("results.json"))
ST = json.load(open("stats.json"))
LAYER = {"0.2-std-0.6-nozzle": 0.2, "0.2-std": 0.2, "0.15-med": 0.15, "0.1-high": 0.1}
LINE = {"0.2-std-0.6-nozzle": 0.62}
COOL = {"pla": 4, "petg": 10, "abs": 12}  # slow_down_layer_time in the Bambu filament profiles
SUPPORT_FILL = 0.10
MIN_SPEED = 20  # slow_down_min_speed, mm/s


def lstsq(rows, target):
    n = len(rows[0])
    m = [[sum(r[i] * r[j] for r in rows) for j in range(n)] + [sum(r[i] * t for r, t in zip(rows, target))] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def parts(r, shell_cm):
    s = ST[r["model"]]
    shell = min(s["volume"], s["area"] * shell_cm)
    return shell, (s["volume"] - shell) * r["infill"] / 100, s["overhangSpace"] * SUPPORT_FILL


def rms(errs):
    return math.sqrt(sum(e * e for e in errs) / len(errs)) * 100


pla = [r for r in R if r["fil"] == "pla"]

# 1. Shell thickness per quality: the one free parameter of the filament model.
shell_cm = {}
for q in LAYER:
    rows = [r for r in pla if r["quality"] == q]
    shell_cm[q] = min((sum(math.log(sum(parts(r, t / 1000)) / r["cm3"]) ** 2 for r in rows), t / 1000) for t in range(40, 200))[1]

# 2. Time terms per quality, least squares on relative error.
def feats(r):
    q = r["quality"]
    shell, inner, support = parts(r, shell_cm[q])
    solid = r["infill"] >= 100
    return [ST[r["model"]]["dimensions"]["z"] * 10 / LAYER[q], shell, 0 if solid else inner, inner if solid else 0, support]


def predict(c, r):
    f = feats(r)
    layers, filament = f[0], sum(f[1:]) * 1000
    q = r["quality"]
    floor = min(COOL[r["fil"]], filament / layers / (LAYER[q] * LINE.get(q, 0.42) * MIN_SPEED))
    return max(sum(a * x for a, x in zip(c, f)), layers * floor)


coef = {}
for q in LAYER:
    rows = [r for r in pla if r["quality"] == q]
    c = lstsq([[x / r["model_s"] for x in feats(r)] for r in rows], [1.0] * len(rows))
    # Refit on the slices the cooling floor does not decide.
    rows = [r for r in rows if sum(a * x for a, x in zip(c, feats(r))) >= feats(r)[0] * COOL["pla"]]
    coef[q] = lstsq([[x / r["model_s"] for x in feats(r)] for r in rows], [1.0] * len(rows))

start = sum(r["total_s"] - r["model_s"] for r in R) / len(R)
print(f"START_SECONDS ~ {start:.0f}; SUPPORT_FILL = {SUPPORT_FILL}")
for q in LAYER:
    c = coef[q]
    print(f'{q}: shellCm: {shell_cm[q]:.3f}, secPerLayer: {c[0]:.2f}, '
          f'secPerCm3: {{ shell: {c[1]:.1f}, sparse: {c[2]:.1f}, solid: {c[3]:.1f}, support: {c[4]:.0f} }}')
for fil in COOL:
    for q in LAYER:
        rows = [r for r in R if r["fil"] == fil and r["quality"] == q]
        if rows:
            fe = [sum(parts(r, shell_cm[q])) / r["cm3"] - 1 for r in rows]
            te = [predict(coef[q], r) / r["model_s"] - 1 for r in rows]
            print(f"  {fil:4} {q:20} filament rms {rms(fe):4.1f}%   time rms {rms(te):4.1f}%  (n={len(rows)})")
