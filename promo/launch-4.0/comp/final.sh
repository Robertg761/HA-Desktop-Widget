#!/bin/bash
# Render the spot in parallel segments, then grade, blur, grain and mux.
#   comp/final.sh [workers] [from] [to]
set -euo pipefail
cd "$(dirname "$0")"
W=${1:-4}
FROM=${2:-0}
TO=${3:-62}
OUT=../out
SEG=$OUT/seg
mkdir -p "$SEG"
# Segments are overwritten by name; an earlier run with more workers may leave extra seg_*.mkv
# files behind, so render into an empty out/seg.
python3 - "$W" "$FROM" "$TO" > "$SEG/ranges.txt" <<'EOF'
import sys
w, a, b = int(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
frames = round((b - a) * 60)
per = -(-frames // w)
for i in range(w):
    f0 = a * 60 + i * per
    f1 = min(a * 60 + frames, f0 + per)
    if f1 > f0:
        print(f"{f0/60:.6f} {f1/60:.6f} {i:02d}")
EOF
pids=()
while read -r s e i; do
  node render.cjs video "$s" "$e" "$SEG/seg_$i.mkv" > "$SEG/log_$i.txt" 2>&1 &
  pids+=($!)
done < "$SEG/ranges.txt"
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
[ $fail = 0 ] || { echo "a render worker failed"; tail -5 "$SEG"/log_*.txt; exit 1; }
ls "$SEG"/seg_*.mkv | sed "s|^|file '|; s|$|'|; s|$SEG/||" > "$SEG/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$SEG/list.txt" -c copy "$OUT/master60.mkv"
# 60 -> 30 fps with two-frame blending (motion blur), gentle grade, grain, soundtrack.
ffmpeg -y -loglevel error -i "$OUT/master60.mkv" -i ../audio/out/soundtrack.wav \
  -filter_complex "[0:v]tmix=frames=2:weights='1 1',fps=30,eq=contrast=1.035:saturation=1.06:gamma=0.99,noise=alls=3:allf=t,format=yuv420p[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 20 -tune grain -x264-params aq-mode=3 -profile:v high -movflags +faststart \
  -c:a aac -b:a 320k -ar 48000 -shortest "$OUT/HA-Desktop-Widget-4.0.mp4"
ls -la "$OUT/HA-Desktop-Widget-4.0.mp4"
