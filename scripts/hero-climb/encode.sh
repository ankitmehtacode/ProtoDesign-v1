#!/usr/bin/env bash
# Encode the rendered climb into the frame sets HeroSequence plays.
#   scripts/hero-climb/encode.sh ~/Documents/protodesign-hero
# Expects <dir>/frames/NNNN.png (1920x1080, from hero-climb.blend), <dir>/frames_tall/NNNN.png
# (900x1600, from hero-climb-tall.blend; encoded at every TALL_STRIDE-th frame) and <dir>/climb.json (written by animate.py).
# q72 + sharp_yuv keeps the dark gradients free of banding; the densified climb (398 frames) stays a few MB.
set -euo pipefail
src="${1:?render directory}"
out="$(cd "$(dirname "$0")/../.." && pwd)/src/assets/hero-climb"
command -v cwebp >/dev/null || { echo "cwebp not found (brew install webp)" >&2; exit 1; }
wide=$(ls "$src/frames" | wc -l | tr -d ' '); tall=$(ls "$src/frames_tall" | wc -l | tr -d ' ')
[ "$wide" = "$tall" ] || { echo "frame counts differ: wide $wide, tall $tall" >&2; exit 1; }
rm -rf "$out" && mkdir -p "$out/w1920" "$out/w960" "$out/t900"
for f in "$src"/frames/*.png; do
    n=$(basename "$f" .png)
    cwebp -quiet -q 72 -m 6 -sharp_yuv -af "$f" -o "$out/w1920/$n.webp"
    cwebp -quiet -q 72 -m 6 -sharp_yuv -af -resize 960 0 "$f" -o "$out/w960/$n.webp"
done
# Phones get every TALL_STRIDE-th frame (plus the last, so the finale lands): half the
# frames to fetch, decode and hold in memory, which is what kept the climb smooth there.
# HeroSequence maps scroll progress, not frame numbers, so a shorter set plays in step.
TALL_STRIDE=2
tall_frames=("$src"/frames_tall/*.png)
last=$(( ${#tall_frames[@]} - 1 )); k=0
for (( i = 0; i <= last; i++ )); do
    (( i % TALL_STRIDE == 0 || i == last )) || continue
    cwebp -quiet -q 72 -m 6 -sharp_yuv -af "${tall_frames[$i]}" -o "$out/t900/$(printf %04d $k).webp"
    k=$(( k + 1 ))
done
cp "$src/climb.json" "$out/climb.json"
du -sh "$out"/*
