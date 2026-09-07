#!/usr/bin/env bash
# Cuts the scene clips the composition plays out of the raw takes.
#
# Every clip keeps the pace of the take it came from: no clip is sped up, slowed down or joined, so
# what the video shows is one unbroken window of what the app did. The windows are chosen around the
# one interaction each act was driven through, and the caption's keys are timed against them.
#
# The takes are 1206 by 2622 at 60 fps; the clips are scaled to 1080 high, which is a little over
# the 940 the composition draws them at, and re-encoded so a seek lands on the frame it names.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
takes="$root/takes"
clips="$root/public/clips"

mkdir -p "$clips"

# Cuts one window out of a take.
cut() {
  local source="$1" start="$2" length="$3" target="$4"
  ffmpeg -y -v error -ss "$start" -t "$length" -i "$takes/$source" \
    -vf 'scale=-2:1080:flags=lanczos' -r 60 -an \
    -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p "$target"
}

cut atlas-ios.mp4 11.45 5.00 "$clips/atlas.mp4"
cut engine-ios.mp4 10.75 4.30 "$clips/engine.mp4"
cut fractal-ios.mp4 7.70 4.20 "$clips/fractal.mp4"
cut grid-ios.mp4 8.50 4.60 "$clips/grid.mp4"
cut heatmap7-ios.mp4 28.65 4.20 "$clips/heatmap.mp4"
cut trail-ios.mp4 15.00 4.50 "$clips/trail.mp4"

ls -l "$clips"
