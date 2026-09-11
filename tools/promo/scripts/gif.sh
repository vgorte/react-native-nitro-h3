#!/usr/bin/env bash
# Encodes a hero render as the GIF a README autoplays, through a palette cut from the loop itself.
#
#   scripts/gif.sh                                                     # the wide loop
#   scripts/gif.sh out/portrait-hero.mp4 out/showcase-portrait-hero.gif 320 15
#
# A GIF holds 256 colours at most, so the palette is built from the frames that will use it and the
# dither is kept coarse: the Observatory ground is a near-flat dark blue that a fine dither turns
# into visible noise. Only the rectangle a frame changed is written, which is most of what keeps a
# loop of moving map under a README's weight.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source="${1:-$root/out/hero.mp4}"
target="${2:-$root/out/showcase-hero.gif}"
width="${3:-${GIF_WIDTH:-600}}"
rate="${4:-${GIF_FPS:-24}}"
colours="${5:-64}"

ffmpeg -y -v error -i "$source" -vf "fps=$rate,scale=$width:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=$colours:stats_mode=diff[p];\
[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$target"

ls -lh "$target"
