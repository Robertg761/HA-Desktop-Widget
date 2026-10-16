#!/bin/bash
# Concatenate rendered segments (out/seg/seg_*.mkv, in name order), then grade, grain, convert to
# BT.709 and mux.
#   A 30 fps master (render.cjs mb) already carries its motion blur.
#   A 60 fps master (render.cjs video) is blended two frames at a time, each pair inside one 1/30 s.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../out"
SEG="${SEG_DIR:-$OUT/seg}"
ls "$SEG"/seg_*.mkv | sort | sed "s|^|file '|; s|$|'|" > "$SEG/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$SEG/list.txt" -c copy "$OUT/master.mkv"
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$OUT/master.mkv")
PRE=""
[ "$FPS" = "60/1" ] && PRE="tmix=frames=2:weights='1 1',select='not(mod(n\,2))',setpts=N/(30*TB),"
# The renders are BT.601 (Chromium's JPEG); players assume BT.709 for HD, so convert and tag it.
# Contrast is an S-curve on luma that keeps black at 16 and white at 235 (slope 1.035 at mid-grey).
X="(clip(val,16,235)-16)/219"
GRADE="lutyuv=y='16+219*($X-0.035*sin(2*PI*$X)/(2*PI))',eq=saturation=1.06"
ffmpeg -y -loglevel error -i "$OUT/master.mkv" -i "$HERE/../audio/out/soundtrack.wav" \
  -filter_complex "[0:v]${PRE}scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv444p,${GRADE},noise=alls=3:allf=t,format=yuv420p[v]" \
  -map "[v]" -map 1:a -r 30 -c:v libx264 -preset slow -crf 20 -tune grain -x264-params aq-mode=3 -profile:v high -level:v 4.1 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart \
  -c:a aac -b:a 320k -ar 48000 -shortest "$OUT/HA-Desktop-Widget-4.0.mp4"
ls -la "$OUT/HA-Desktop-Widget-4.0.mp4"
