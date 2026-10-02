# Heat-ladder materials: pricing and import

The home page heat ladder (`src/components/home/materials.ts`) names materials we did not
sell. Customers land on those rungs with no Buy button. `heat-ladder-materials.csv` lists the
missing ones as 1 kg, 1.75 mm spools.

**Before importing:** set `stock` in `build_heat_ladder_csv.py` to real inventory and rebuild.
The placeholder is 10 of each, and the Buy button shows whatever the stock.

## Pricing rule

Market price is the median of 1 kg, 1.75 mm listings at Indian retailers, as listed on
2026-10-03 (GST-inclusive retail). Our price is 5–6% below that, rounded to end in 9.

| Product | Indian 1 kg listings (₹) | Median | Ours | Below market |
| --- | --- | --- | --- | --- |
| ASA | Numakers 699 · Elegoo 999 · Tesseract 1,899 · FabToLab 2,485 · Bambu Lab 4,089 · Polymaker 4,493 | 2,192 | **2,069** | 5.6% |
| Polycarbonate | Dream Polymers 1,499 · Tesseract 1,799 · FabToLab 2,985 · Polymaker (Ideal3D) 3,000 · Bambu Lab 3,299 · Polymaker (Amazon) 3,499 | 2,993 | **2,829** | 5.5% |
| Nylon | Tesseract 2,199 · FabToLab 2,985 | 2,592 | **2,449** | 5.5% |
| PETG-CF | Numakers 1,149 (MRP 1,800) | 1,149 | **1,089** | 5.2% |
| PEI (sold as ULTEM elsewhere) | ThermaX PEI 9085, 1 kg (ThinkRobotics) 23,750 | 23,750 | **22,449** | 5.5% |
| PEEK | T3D Labs (IndiaMART) 64,000 · ThermaX (ThinkRobotics) 75,100 | 69,550 | **65,699** | 5.5% |

Confidence: ASA and PC have six listings each. Nylon and PEEK have two, and PETG-CF and PEI
have one each, so recheck those before a big promotion. Retail prices move weekly; rerun the
comparison before changing prices.

Not listed: glass fibre (no Indian 1 kg listing found) and PPA (Indian listings are only
0.5–0.75 kg Bambu Lab spools, so there is no 1 kg comparison).

Naming: "ULTEM" is SABIC's trademark for its PEI resin, so the product is listed as PEI. Only
call it ULTEM if the stock is SABIC ULTEM. The spool shot and the home-page rung still say
ULTEM. The Nylon product is generic nylon, but its home-page rung reads "150 °C+ (PAHT, PPA)".
If your nylon is PA6 or PA12, name the grade, or reword the rung, so the 150 °C figure isn't
read as this spool's rating.

## Images

ASA, Nylon, PEI and PEEK use the heat-ladder spool shots (`src/assets/home/material-*.webp`,
labelled with the material and "1 kg"). The CSV points at their live URLs. On import, the
backend copies them into Cloudinary. Polycarbonate and PETG-CF have no shot of their own yet,
so they import without an image. Add one in the admin product editor.

## Importing

1. Admin dashboard → Bulk Upload → choose `heat-ladder-materials.csv`. Upload it **once**. The
   import does not dedupe, so a second upload (or a retry after a timeout) creates six
   duplicates. If you're unsure whether it ran, check the catalogue first.
2. Check the result shows `success: 6`. The import skips image failures and only logs them on
   the server, so open the four products that should have photos and check each one shows.

To change a row, edit `build_heat_ladder_csv.py` and run `python3 build_heat_ladder_csv.py`.
Do not hand-edit the CSV.

Sources: india.numakers.com, tesseract3d.com, fabtolab.com, 3dmasterindia.in, amazon.in,
ideal3d.in, indiamart.com, thinkrobotics.com, wol3d.com.
