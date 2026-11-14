"""Slice every test shape with OrcaSlicer and record filament and time.

Run after gen.mjs, from this folder: python3 slice.py  (writes results.json).
Uses OrcaSlicer's own Bambu Lab profiles, flattened, with the settings the
quote page offers. Profiles keep their system names: the CLI only accepts a
process for a printer it lists by name.
"""
import json, os, re, subprocess
from concurrent.futures import ThreadPoolExecutor

ORCA = "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer"
PROFILES = "/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL"

# Quote page quality id -> (printer, closest stock process, overrides)
QUALITIES = {
    "0.2-std-0.6-nozzle": ("Bambu Lab P1S 0.6 nozzle", "0.24mm Standard @BBL X1C 0.6 nozzle", {"layer_height": "0.2"}),
    "0.2-std": ("Bambu Lab P1S 0.4 nozzle", "0.20mm Standard @BBL X1C", {}),
    "0.15-med": ("Bambu Lab P1S 0.4 nozzle", "0.16mm Optimal @BBL X1C", {"layer_height": "0.15"}),
    "0.1-high": ("Bambu Lab P1S 0.4 nozzle", "0.12mm Fine @BBL X1C", {"layer_height": "0.1"}),
}
FILAMENTS = {"pla": "Bambu PLA Basic @BBL X1C", "abs": "Bambu ABS @BBL X1C", "petg": "Bambu PETG HF @BBL X1C"}


def load(kind, name):
    d = json.load(open(os.path.join(PROFILES, kind, name + ".json")))
    if d.get("inherits"):
        base = load(kind, d["inherits"])
        base.update(d)
        d = base
    return d


def flat(kind, name, **over):
    d = load(kind, name)
    d.pop("inherits", None)
    d.update(over, name=name, **{"from": "system"})
    return d


def seconds(text):
    return sum(int(v) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[u] for v, u in re.findall(r"(\d+)([dhms])", text))


def run(job):
    model, quality, infill, fil = job
    tag = f"{model}__{quality}__{infill}__{fil}"
    out = f"runs/{tag}"
    if os.path.exists(f"{out}/result.json"):
        return json.load(open(f"{out}/result.json"))
    os.makedirs(out, exist_ok=True)
    machine, process, over = QUALITIES[quality]
    filament = flat("filament", FILAMENTS[fil], compatible_printers=[])
    proc = flat("process", process, sparse_infill_density=f"{infill}%", enable_support="1",
                curr_bed_type="Textured PEI Plate", **over)
    for d, n in [(flat("machine", machine), "m"), (proc, "p"), (filament, "f")]:
        json.dump(d, open(f"{out}/{n}.json", "w"))
    r = subprocess.run([ORCA, "--arrange", "1", "--slice", "0", "--load-settings", f"{out}/m.json;{out}/p.json",
                        "--load-filaments", f"{out}/f.json", "--outputdir", out, f"models/{model}.stl"],
                       capture_output=True, text=True, timeout=900)
    gcode = f"{out}/plate_1.gcode"
    if not os.path.exists(gcode):
        raise RuntimeError(f"{tag}: {r.stdout[-300:]} {r.stderr[-300:]}")
    text = open(gcode).read()
    text = text[:6000] + text[-40000:]  # the header has times; the Bambu flavour puts filament at the end
    times = re.search(r"model printing time: ([^;]+); total estimated time: (.+)", text)
    res = {"model": model, "quality": quality, "infill": infill, "fil": fil,
           "model_s": seconds(times.group(1)), "total_s": seconds(times.group(2)),
           "cm3": float(re.search(r"filament used \[cm3\] = ([\d.]+)", text).group(1))}
    json.dump(res, open(f"{out}/result.json", "w"))
    os.remove(gcode)
    return res


if __name__ == "__main__":
    models = sorted(f[:-4] for f in os.listdir("models"))
    jobs = [(m, q, i, "pla") for m in models for q in QUALITIES for i in (20, 50, 100)]
    jobs += [(m, "0.2-std", 20, f) for m in models for f in ("abs", "petg")]
    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(run, jobs))
    json.dump(results, open("results.json", "w"), indent=0)
    print(len(results), "slices")
