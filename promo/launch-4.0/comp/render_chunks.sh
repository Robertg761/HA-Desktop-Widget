#!/bin/bash
# Resumable render: 4-second chunks into $SEG_DIR, 4 at a time; a chunk with a .done marker is skipped.
#   comp/render_chunks.sh <seg_dir> [workers]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEG="$1"
W="${2:-4}"
mkdir -p "$SEG"
chunk() {
  local i=$1 a b
  a=$((i * 4)); b=$(( a + 4 > 62 ? 62 : a + 4 ))
  local name; name=$(printf 'seg_%02d' "$i")
  [ -f "$SEG/$name.done" ] && return 0
  if node "$HERE/render.cjs" video "$a" "$b" "$SEG/$name.mkv" > "$SEG/$name.log" 2>&1; then
    touch "$SEG/$name.done"
  else
    echo "chunk $i failed" >&2
  fi
}
export -f chunk
export SEG HERE
seq 0 15 | xargs -P "$W" -I{} bash -c 'chunk {}'
ls "$SEG"/*.done | wc -l
