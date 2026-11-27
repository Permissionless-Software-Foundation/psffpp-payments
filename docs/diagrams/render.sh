#!/usr/bin/env bash
# Regenerate the workflow diagram PNGs from their .mmd Mermaid sources.
#
# Requirements (not sold with this repo):
#   - Node.js + npx
#   - @mermaid-js/mermaid-cli  (npx will fetch it on demand if missing)
#   - a Chrome/Chromium binary (mermaid-cli uses Puppeteer). Renderer falls
#     back to the system chrome if found, else to the bundled one.
#
# Usage:
#   ./render.sh                 # regenerate all diagrams (high resolution)
#   ./render.sh end-user        # regenerate just one (basename, no extension)
#
# Output: <name>.png at 3x scale, max dimension 2400 px (crisp at full size;
# the 800px default is too blurry for text).

set -euo pipefail

cd "$(dirname "$0")"

CHROME_CANDIDATES=(
  /usr/bin/google-chrome
  /usr/bin/google-chrome-stable
  /usr/bin/chromium
  /usr/bin/chromium-browser
)

for c in "${CHROME_CANDIDATES[@]}"; do
  if [[ -x "$c" ]]; then
    export PUPPETEER_EXECUTABLE_PATH="$c"
    break
  fi
done

export PUPPETEER_SKIP_DOWNLOAD=true

# Max dimension (px) and scale factor. 2400/3 gives 7200px-wide PNGs with
# readable text. Lower to --size 1600 -s 2 for quicker test renders.
SIZE=2400
SCALE=3

render_one () {
  local name="$1"
  echo "Rendering $name ..."
  npx mmdc \
    -i "${name}.mmd" \
    -o "${name}.png" \
    --size "$SIZE" \
    -s "$SCALE" \
    -b white
}

if [[ $# -eq 0 ]]; then
  render_one end-user-perspective
  render_one node-runner-perspective
  render_one operator-perspective
else
  for name in "$@"; do
    render_one "$name"
  done
fi

echo "Done. (PNG sources: *.mmd — PNG outputs: *.png)"
