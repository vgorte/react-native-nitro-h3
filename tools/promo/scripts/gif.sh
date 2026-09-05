#!/usr/bin/env bash
# Encodes the hero loop as the GIF the README autoplays, through a palette cut from the loop itself.
#
# A GIF holds 256 colours at most, so the palette is built from the frames that will use it and the
# dither is kept coarse: the Observatory ground is a near-flat dark blue that a fine dither turns
# into visible noise.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source="$root/out/hero.mp4"
target="$root/out/showcase-hero.gif"
rate="${GIF_FPS:-24}"
width="${GIF_WIDTH:-600}"

ffmpeg -y -v error -i "$source" -vf "fps=$rate,scale=$width:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=128:stats_mode=diff[p];\
[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$target"

ls -lh "$target"
