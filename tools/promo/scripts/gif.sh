#!/usr/bin/env bash
# Encodes a hero render as the GIF a README autoplays, through a palette cut from the loop itself.
#
#   scripts/gif.sh                                  # the wide loop, 600 px
#   scripts/gif.sh out/portrait-hero.mp4 out/showcase-portrait-hero.gif 420
#
# A GIF holds 256 colours at most, so the palette is built from the frames that will use it and the
# dither is kept coarse: the Observatory ground is a near-flat dark blue that a fine dither turns
# into visible noise.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source="${1:-$root/out/hero.mp4}"
target="${2:-$root/out/showcase-hero.gif}"
width="${3:-${GIF_WIDTH:-600}}"
rate="${GIF_FPS:-24}"

ffmpeg -y -v error -i "$source" -vf "fps=$rate,scale=$width:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=128:stats_mode=diff[p];\
[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$target"

ls -lh "$target"
