#!/bin/bash
# Lightweight previews of the spot with each soundtrack option, for choosing between them.
#   comp/preview.sh <option> [<option> ...]   -> out/previews/HA-Desktop-Widget-4.0_<option>.mp4
# The 720p picture is encoded once (out/previews/video720.mp4) and reused for every option.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../out"
mkdir -p "$OUT/previews"
V="$OUT/previews/video720.mp4"
if [ ! -f "$V" ] || [ "$OUT/HA-Desktop-Widget-4.0.mp4" -nt "$V" ]; then
  ffmpeg -y -loglevel error -i "$OUT/HA-Desktop-Widget-4.0.mp4" -an -vf scale=1280:720:flags=lanczos \
    -c:v libx264 -preset slow -crf 23 -profile:v high -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart "$V"
fi
for opt in "$@"; do
  ffmpeg -y -loglevel error -i "$V" -i "$HERE/../audio/out/soundtrack_$opt.wav" -map 0:v -map 1:a -c:v copy \
    -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$OUT/previews/HA-Desktop-Widget-4.0_$opt.mp4"
  ls -la "$OUT/previews/HA-Desktop-Widget-4.0_$opt.mp4"
done
