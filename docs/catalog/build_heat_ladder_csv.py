"""Writes heat-ladder-materials.csv for Admin > Bulk Upload (POST /api/products/bulk).

Prices and their sources are in heat-ladder-materials.md. Run: python3 build_heat_ladder_csv.py
"""
import csv
from pathlib import Path

IMG = "https://www.protodesignstudio.com/assets/"
COMMON_SPECS = "Filament Diameter: 1.75 mm; Net Weight: 1 kg spool"

def describe(material, intro, features, uses, nozzle, bed, needs):
    return "\n".join([
        f"ProtoDesign {material} 3D Printing Filament", "",
        intro, "",
        "Key Features", *features, "",
        "Recommended Applications", ", ".join(uses) + ".", "",
        "Printing Profile",
        f"Material: {material}", "Filament Diameter: 1.75 mm", "Net Weight: 1 kg",
        f"Recommended Nozzle Temperature: approximately {nozzle}",
        f"Recommended Bed Temperature: approximately {bed}",
        f"Printer Requirements: {needs}", "",
        "Actual temperatures vary with the printer, nozzle, build surface, enclosure, print speed and part geometry. "
        "Keep the spool dry and sealed when not in use.", "",
        "ProtoDesign: Additive Manufacturing.",
        "Precision materials. Reliable prints. Built for real-world applications.",
    ])

ROWS = [
    dict(
        name="ASA Filament", sub_category="ASA", price=2069, stock=10,
        short_description="ASA Filament: ABS-level strength with UV and weather resistance, for outdoor parts that should not yellow or turn brittle in the sun.",
        description=describe(
            "ASA",
            "ProtoDesign ASA is an engineering filament for functional parts that live outdoors. It matches ABS for strength and heat resistance (around 100 °C) while resisting UV light and weather, so parts keep their colour and toughness in the sun.",
            ["UV Stable: resists yellowing and embrittlement outdoors.",
             "Weatherproof: holds up to rain, heat and temperature swings.",
             "Heat Resistant: softens at around 100 °C, well above PLA and PETG.",
             "Matte Finish: a clean, low-gloss surface straight off the printer."],
            ["Outdoor mounts", "exterior trim", "signage", "garden and automotive exterior parts", "enclosures used outside"],
            "240–260 °C", "90–110 °C", "Enclosure and heated bed"),
        specifications=f"Material Type: ASA (Acrylonitrile Styrene Acrylate); {COMMON_SPECS}; Nozzle Temperature: 240–260 °C; Bed Temperature: 90–110 °C",
        images=IMG + "material-asa-DlC9Fmms.webp",
    ),
    dict(
        name="Polycarbonate (PC) Filament", sub_category="PC", price=2829, stock=10,
        short_description="Polycarbonate Filament: extremely tough and rigid, holding its shape at 110–135 °C. Where printed parts start replacing machined ones.",
        description=describe(
            "Polycarbonate (PC)",
            "ProtoDesign Polycarbonate is one of the toughest materials an FDM printer can run. It is rigid, takes heavy impacts and holds its shape well past boiling point, which makes it the first step from printed prototypes to printed end-use parts.",
            ["Very High Toughness: absorbs impacts that crack most filaments.",
             "Rigid: holds dimensions under load.",
             "High Heat Resistance: typically 110–135 °C, depending on grade and print settings.",
             "Strong Layer Bonding when printed hot in an enclosure."],
            ["Machine guards", "load-bearing brackets", "light metal part replacements", "electrical housings", "jigs and fixtures"],
            "260–300 °C", "100–120 °C", "All-metal hotend (260–300 °C) and an enclosure"),
        specifications=f"Material Type: PC (Polycarbonate); {COMMON_SPECS}; Nozzle Temperature: 260–300 °C; Bed Temperature: 100–120 °C",
        images="",
    ),
    dict(
        name="Nylon Filament", sub_category="Nylon", price=2449, stock=10,
        short_description="Nylon Filament: wear, oil and fuel resistant with low friction. For gears, bushings and clips that keep running.",
        description=describe(
            "Nylon",
            "ProtoDesign Nylon is an engineering filament for moving and wearing parts. It is tough, slightly flexible and slippery, and resists oil, fuel and abrasion, so gears, bushings and clips keep working long after other plastics have worn out.",
            ["Wear Resistant: built for parts that rub and slide.",
             "Oil and Fuel Resistant: suitable for machinery and automotive use.",
             "Low Friction: runs smoothly against itself and metal.",
             "Tough and Fatigue Resistant: flexes instead of snapping."],
            ["Gears", "bushings", "clips and snap fits", "living hinges", "machine and automotive components"],
            "250–270 °C", "70–90 °C", "All-metal hotend and dry storage (nylon absorbs moisture; dry before printing)"),
        specifications=f"Material Type: Nylon (Polyamide); {COMMON_SPECS}; Nozzle Temperature: 250–270 °C; Bed Temperature: 70–90 °C",
        images=IMG + "material-nylon-BJ6A1KRR.webp",
    ),
    dict(
        name="PETG-CF Carbon Fibre Filament", sub_category="PETG-CF", price=1089, stock=10,
        short_description="PETG-CF Filament: carbon-fibre reinforced PETG for stiff, dimensionally stable parts with a clean matte finish.",
        description=describe(
            "PETG-CF",
            "ProtoDesign PETG-CF is PETG reinforced with chopped carbon fibre. The fibre makes parts noticeably stiffer and more dimensionally stable than plain PETG and gives a clean, matte finish that hides layer lines, while staying as easy to print as PETG.",
            ["High Stiffness: carbon fibre keeps parts from flexing.",
             "Dimensional Stability: low warp and shrink.",
             "Matte Finish: hides layer lines for a professional look.",
             "Easy to Print: PETG temperatures, no enclosure required."],
            ["Drone frames", "brackets", "jigs that must not flex", "camera and sensor mounts", "functional prototypes"],
            "240–260 °C", "70–80 °C", "Heated bed and a hardened steel nozzle (carbon fibre wears brass nozzles)"),
        specifications=f"Material Type: PETG-CF (Carbon Fibre Reinforced PETG); {COMMON_SPECS}; Nozzle Temperature: 240–260 °C; Bed Temperature: 70–80 °C; Nozzle: Hardened steel required",
        images="",
    ),
    dict(
        name="PEI (Polyetherimide) Filament", sub_category="PEI", price=22449, stock=10,
        short_description="PEI Filament: inherently flame-retardant, heat- and chemical-stable to around 200 °C. For aerospace, electrical and sterilisable parts.",
        description=describe(
            "PEI (Polyetherimide)",
            "ProtoDesign PEI (polyetherimide) is a high-performance polymer for industrial printers. It is inherently flame-retardant, stays stable at around 200 °C and resists chemicals and repeated sterilisation, which is why PEI is used in aircraft cabins, electrical housings and medical tooling.",
            ["Flame Retardant: inherently self-extinguishing.",
             "High Heat Resistance: stable at around 200 °C.",
             "Chemical Stable: resists fuels, oils and cleaning agents.",
             "Sterilisable: suited to repeated sterilisation cycles."],
            ["Cabin components", "electrical housings", "medical fixtures", "high-temperature jigs and tooling"],
            "350–400 °C", "140–160 °C", "350–400 °C hotend and a heated chamber"),
        specifications=f"Material Type: PEI (Polyetherimide); {COMMON_SPECS}; Nozzle Temperature: 350–400 °C; Bed Temperature: 140–160 °C",
        images=IMG + "material-ultem-BKv1M7Bk.webp",
    ),
    dict(
        name="PEEK Filament", sub_category="PEEK", price=65699, stock=10,
        short_description="PEEK Filament: a super-polymer for continuous use at around 250 °C, resisting almost every chemical. For aerospace and medical engineering.",
        description=describe(
            "PEEK",
            "ProtoDesign PEEK (polyether ether ketone) sits at the top of the printable plastics. It works continuously at around 250 °C, resists almost every chemical and is strong enough to replace metal in demanding parts, which is why it is used in aerospace and medical engineering.",
            ["Extreme Heat Resistance: continuous use at around 250 °C.",
             "Near-Universal Chemical Resistance.",
             "Very Strong and Stiff: a metal replacement for many parts.",
             "Low Wear: holds up in sliding and bearing applications."],
            ["High-temperature metal part replacements", "aerospace components", "medical engineering parts", "chemical processing parts"],
            "380–420 °C", "120–150 °C", "Industrial printer: 400 °C+ hotend and a heated chamber"),
        specifications=f"Material Type: PEEK (Polyether Ether Ketone); {COMMON_SPECS}; Nozzle Temperature: 380–420 °C; Bed Temperature: 120–150 °C",
        images=IMG + "material-peek-CaJ7TYZt.webp",
    ),
]

FIELDS = ["name", "category", "sub_category", "price", "stock", "short_description", "description", "specifications", "images"]
out = Path(__file__).with_name("heat-ladder-materials.csv")
with out.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writeheader()
    for r in ROWS:
        w.writerow({"category": "filament", **r})
print(f"wrote {len(ROWS)} rows to {out}")
