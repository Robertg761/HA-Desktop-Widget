#!/bin/bash
# Resumable render: 4-second chunks into $SEG_DIR, 4 at a time; a chunk with a .done marker is skipped.
#   comp/render_chunks.sh <seg_dir> [workers]
#   MODE=mb (default) renders 30 fps with motion blur (needs comp/samples.json from
#   comp/motion_schedule.py); MODE=video renders plain 60 fps.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEG="$1"
W="${2:-4}"
MODE="${MODE:-mb}"
# Chunks are video; render.cjs's stills mode would read the chunk times as a list and a folder.
case "$MODE" in mb | video) ;; *) echo "MODE must be mb or video, not $MODE" >&2; exit 2 ;; esac
# The spot's length, or the edit's with NOWARP=1.
DUR=$(node -p "const w = JSON.parse(require('fs').readFileSync('$HERE/warp.json')); process.env.NOWARP === '1' ? w.points[w.points.length - 1][0] : w.duration")
mkdir -p "$SEG"
chunk() {
  local i=$1 a b
  a=$((i * 4)); b=$(( a + 4 > DUR ? DUR : a + 4 ))
  local name; name=$(printf 'seg_%02d' "$i")
  [ -f "$SEG/$name.done" ] && return 0
  if node "$HERE/render.cjs" "$MODE" "$a" "$b" "$SEG/$name.mkv" > "$SEG/$name.log" 2>&1; then
    touch "$SEG/$name.done"
  else
    echo "chunk $i failed (see $SEG/$name.log)" >&2
    return 1
  fi
}
export -f chunk
export SEG HERE MODE DUR
# xargs runs every chunk, then exits nonzero if any of them failed; so does this script.
seq 0 $(( (DUR + 3) / 4 - 1 )) | xargs -P "$W" -I{} bash -c 'chunk {}'
status=$?
ls "$SEG"/*.done 2>/dev/null | wc -l
exit $status
