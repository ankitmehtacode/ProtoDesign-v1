# Custom-print quote estimate

The quote page (`/custom`) prices a print by what it costs us to make:

```
price = setup fee + grams × ₹/g (by material) + hours × machine ₹/h
```

The rates are business decisions and live at the top of `src/lib/quote.ts`
(`SETUP_FEE_INR`, `MACHINE_INR_PER_HOUR`, `inrPerGram` per material). Change them freely.

The grams and hours come from the model's shape, measured in the browser by
`src/lib/mesh.ts`, and from constants fitted to a real slicer. Don't adjust those
constants by hand. Refit them as described below.

## What is measured (`src/lib/mesh.ts`)

All of these follow the orientation the customer picks:

- **Volume** and **surface area** (signed-tetrahedron sum over the triangles).
- **Print height** (gives the layer count).
- **Overhang space**: faces sloping less than 30° from horizontal, multiplied by
  their height above the plate. Support is about 10% of this space.
- **Closed check**, two parts:
  - On every rotation: the area-weighted normals of a closed surface sum to zero.
  - Once per file (`edgesClosed`, up to 500k triangles): every edge must be
    shared by exactly two triangles. This catches holes that cancel out, such
    as a sleeve with both ends open.

  When either check fails, the page and the admin email warn that the price
  needs confirming.

The file is turned Z-up → Y-up on load, so models stand on the viewer's floor
the way a slicer stands them on the bed.

## The model (`estimatePrint` in `src/lib/quote.ts`)

- **Filament** = shell (surface × a fitted thickness, capped at the volume) +
  interior × infill % + support.
- **Time** = per-layer overhead + per-cm³ rates for shell, sparse infill, solid
  infill and support, plus about 6 min of heating and levelling. Sparse infill
  is slower per cm³ than solid infill. Small layers wait for the material's
  cooling time (PLA 4 s, PETG 10 s, ABS 12 s), but the printer never moves
  slower than 20 mm/s.

## Calibration

OrcaSlicer 2.4.2 sliced 12 test shapes on a Bambu Lab P1S with the stock Bambu
profiles, supports on. Each shape was sliced at every quality with 20/50/100%
infill in PLA, and with ABS and PETG at 0.2 mm (168 slices). The shapes are
cubes, a block, a thin tube, a sphere, a pin, a plate, a table, a mushroom, a
torus, a cone and a bowl.

Error of the estimate against the slicer (RMS):

| | filament | time |
|---|---|---|
| PLA, 0.2 mm, 0.6 nozzle | 5.9% | 7.9% |
| PLA, 0.2 mm | 4.2% | 10.5% |
| PLA, 0.15 mm | 3.0% | 11.4% |
| PLA, 0.1 mm | 4.6% | 12.3% |
| PETG, 0.2 mm | 5.8% | 13.8% |
| ABS, 0.2 mm | 5.7% | 12.8% |

Leaving each shape out of the fit and predicting it gives 13–20% time error.
Organic shapes such as figurines aren't in the set, so expect them to be less
accurate. The old formula (solid volume × ₹8) priced a 10 × 10 × 4 cm block at
₹3,670. That block needs 134 g and about 3 h.

`src/lib/quote.test.ts` checks the estimate against seven of the slices, so a
change that breaks agreement with the slicer fails `npm test`.

### Refit

Do this when the printers, profiles or offered qualities change. It needs
OrcaSlicer installed in `/Applications`.

```sh
cd scripts/quote-calibration
node gen.mjs        # test shapes → models/, measured → stats.json
python3 slice.py    # 168 slices (~3 min on 4 threads) → results.json
python3 fit.py      # prints the constants and the error table
```

Copy the printed constants into `PRINTER_QUALITIES`. `models/`, `runs/` and the
JSON outputs are build products and are not committed.

## Limits

- The server stores the price the browser sends. The team reviews every quote
  before sending a payment link, so a tampered price is caught there.
- The estimate assumes one part printed as uploaded. It doesn't auto-orient,
  split oversized models or nest several copies.
- Support is measured down to the plate. When an overhang sits above another
  part of the model (say a table with a lower shelf), the slicer stops the
  support at the shelf, so we overestimate. None of the calibration shapes has
  a stacked overhang.
- Re-measuring after a rotation takes about 0.1 s per million triangles. The
  viewer waits until the rotation input settles before re-measuring.
