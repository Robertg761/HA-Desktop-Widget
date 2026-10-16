#!/bin/bash
# Concatenate rendered segments (out/seg/seg_*.mkv, in name order), then blend, grade, grain, mux.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../out"
SEG="${SEG_DIR:-$OUT/seg}"
ls "$SEG"/seg_*.mkv | sort | sed "s|^|file '|; s|$|'|" > "$SEG/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$SEG/list.txt" -c copy "$OUT/master60.mkv"
ffmpeg -y -loglevel error -i "$OUT/master60.mkv" -i "$HERE/../audio/out/soundtrack.wav" \
  -filter_complex "[0:v]tmix=frames=2:weights='1 1',fps=30,eq=contrast=1.035:saturation=1.06:gamma=0.99,noise=alls=3:allf=t,format=yuv420p[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 20 -tune grain -x264-params aq-mode=3 -profile:v high -movflags +faststart \
  -c:a aac -b:a 320k -ar 48000 -shortest "$OUT/HA-Desktop-Widget-4.0.mp4"
ls -la "$OUT/HA-Desktop-Widget-4.0.mp4"
