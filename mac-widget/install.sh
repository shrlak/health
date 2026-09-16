#!/usr/bin/env bash
# Copies the built Whoop.app into /Applications.
#
# Xcode builds into DerivedData, a scratch directory whose name carries a hash
# and which gets cleaned. macOS serves a widget from the installed copy of the
# app, so a build that is never moved out of there is a widget that shows
# yesterday's code until the day the directory is emptied and it stops showing
# anything. This does the moving.
#
# Run it after every build you want the desktop to pick up.
set -euo pipefail

cd "$(dirname "$0")"

# The newest real build wins, whichever configuration produced it. Both are
# considered because the Run action's configuration is a per-scheme setting:
# assuming Debug finds nothing on a project set to Release.
APP=""
consider() {
  [ -d "$1" ] || return 0
  if [ -z "$APP" ] || [ "$1" -nt "$APP" ]; then APP="$1"; fi
}

# Ask Xcode where it put the build rather than guessing: the DerivedData
# directory name carries a hash, and a custom build location moves the product
# out of DerivedData altogether.
if command -v xcodebuild >/dev/null 2>&1 && [ -d Whoop.xcodeproj ]; then
  for configuration in Release Debug; do
    dir=$(xcodebuild -project Whoop.xcodeproj -scheme Whoop \
            -configuration "$configuration" -showBuildSettings 2>/dev/null \
          | awk -F' = ' '/ BUILT_PRODUCTS_DIR = /{print $2; exit}') || true
    [ -n "${dir:-}" ] && consider "$dir/Whoop.app"
  done
fi

# Failing that, search DerivedData, for when the project has not been generated
# yet but an earlier build is still on disk.
#
# Index.noindex is excluded deliberately. Xcode's indexer writes its own
# Whoop.app there as a by-product of parsing the code: it is not built to run,
# and it is routinely newer than the real build, so anything picking the first
# or the most recent match without this finds the wrong one.
while IFS= read -r found; do
  consider "$found"
done <<EOF
$(find "$HOME/Library/Developer/Xcode/DerivedData" -type d -name Whoop.app \
     -path '*/Build/Products/*' ! -path '*/Index.noindex/*' 2>/dev/null)
EOF

if [ -z "$APP" ]; then
  echo "No built Whoop.app found." >&2
  echo >&2
  echo "This copies what Xcode builds, so build it first:" >&2
  echo "  ./setup.sh     # if you have not generated the project yet" >&2
  echo "  then press ⌘R in Xcode and wait for it to succeed" >&2
  exit 1
fi

echo "Built app:  $APP"

# Replaced rather than merged into: a stale file left inside the bundle is one
# way a rebuild ends up still serving the old widget.
rm -rf /Applications/Whoop.app
cp -R "$APP" /Applications/Whoop.app
echo "Installed:  /Applications/Whoop.app"

# Launching it once is what registers the widget extension with macOS.
open /Applications/Whoop.app

echo
echo "Right-click the desktop → Edit Widgets → search Whoop, and drag out a size."
echo "If the desktop still shows the old layout, remove the placed widget and drop"
echo "a fresh one, then check macOS took the new extension:"
echo "  pluginkit -mAvvv -p com.apple.widgetkit-extension | grep -A3 shrlak"
