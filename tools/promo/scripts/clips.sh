#!/usr/bin/env bash
# Cuts the scene clips the composition plays out of the raw takes.
#
# Every clip keeps the pace of the take it came from: no clip is sped up or slowed down, so what the
# video shows is what the app did. Where an act needed a longer beat than a scene can hold, the
# waiting between two moments is cut out and the moments are joined, never compressed.
#
# The takes are 1206 by 2622 at 60 fps; the clips are scaled to 1080 high, which is a little over
# the 940 the composition draws them at, and re-encoded so a seek lands on the frame it names.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
takes="$root/takes"
clips="$root/public/clips"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$clips"

# Cuts one window out of a take.
cut() {
  local source="$1" start="$2" length="$3" target="$4"
  ffmpeg -y -v error -ss "$start" -t "$length" -i "$takes/$source" \
    -vf 'scale=-2:1080:flags=lanczos' -r 60 -an \
    -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p "$target"
}

cut atlas-ios.mp4 4.8 4.0 "$clips/atlas.mp4"
cut engine-ios.mp4 49.5 4.0 "$clips/engine.mp4"
cut grid-ios.mp4 7.0 4.5 "$clips/grid.mp4"
cut heatmap-ios.mp4 15.0 4.5 "$clips/heatmap.mp4"
cut trail-gap-ios.mp4 10.0 4.0 "$clips/trail.mp4"

# The fractal act splits a cell every few seconds; the scene joins two splits and leaves the waiting
# between them out.
cut fractal-ios.mp4 10.0 2.2 "$work/split-two.mp4"
cut fractal-ios.mp4 16.0 2.2 "$work/split-three.mp4"
for piece in split-two split-three; do
  echo "file '$work/$piece.mp4'" >>"$work/fractal.txt"
done
ffmpeg -y -v error -f concat -safe 0 -i "$work/fractal.txt" -c copy "$clips/fractal.mp4"

ls -l "$clips"
