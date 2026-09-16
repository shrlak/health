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
#
# Freshness is judged by the executable inside, not the .app directory itself:
# rebuilding an app that is already on disk only rewrites files under
# Contents/, which does not bump the bundle directory's own mtime, so
# comparing that let a same-day Debug build outrank a just-relinked Release
# one. The binary is rewritten by the linker on every build, Debug or
# Release, so its mtime is the one that actually moves.
APP=""
consider() {
  [ -f "$1/Contents/MacOS/Whoop" ] || return 0
  if [ -z "$APP" ] || [ "$1/Contents/MacOS/Whoop" -nt "$APP/Contents/MacOS/Whoop" ]; then
    APP="$1"
  fi
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

# Xcode registers the widget extension it builds every time the app is run
# from Xcode (Cmd-R), under the same identifier as the copy this script just
# installed. Left registered, a DerivedData build sits there indefinitely —
# including one from before some later change, such as when families were
# last cut down — and the Edit Widgets gallery can end up reading its
# declared sizes instead of this install's. So only the installed copy
# should be left registered.
#
# Matched by pattern rather than an exact string: macOS answers some queries
# about /Applications with /System/Volumes/Data/Applications instead, the
# real path behind the firmlink, and pluginkit is one of them. Comparing for
# exact equality against the /Applications spelling missed that alias and
# unregistered the copy this script had just installed, along with the
# DerivedData ones it was meant to catch.
WIDGET_ID=$(plutil -extract CFBundleIdentifier raw \
  /Applications/Whoop.app/Contents/PlugIns/WhoopWidget.appex/Contents/Info.plist 2>/dev/null) || true
if [ -n "${WIDGET_ID:-}" ]; then
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      /Applications/Whoop.app/*|/System/Volumes/Data/Applications/Whoop.app/*) continue ;;
    esac
    pluginkit -r "$path" 2>/dev/null || true
  done < <(pluginkit -m -v -D -i "$WIDGET_ID" 2>/dev/null | awk '{print $NF}')
fi

# chronod is what backs the Edit Widgets gallery, and it caches each widget's
# declared sizes rather than reading them fresh every time the panel opens. A
# build that changes which families a widget offers — such as cutting it down
# to the large size only — otherwise keeps showing the old list until
# whatever next restarts chronod on its own, which is not on any schedule
# worth waiting for. Killing it is safe: launchd brings it straight back.
killall chronod 2>/dev/null || true

# Launching it once is what registers the widget extension with macOS. But
# `open` on an app that is already running activates that process instead of
# starting a new one, so a Whoop left open from before this build still shows
# the old code, in the window and in whatever it just re-registered from. Quit
# it first so the launch is a real one.
osascript -e 'quit app "Whoop"' 2>/dev/null || true
sleep 1
open /Applications/Whoop.app

echo
echo "Right-click the desktop → Edit Widgets → search Whoop, and drag out a size."
echo "If Edit Widgets was already open, close and reopen it — it reads the gallery"
echo "once rather than watching it live, so a copy open before this ran is still"
echo "showing the old list."
echo "If the desktop still shows the old layout, remove the placed widget and drop"
echo "a fresh one, then check macOS took the new extension:"
echo "  pluginkit -mAvvv -p com.apple.widgetkit-extension | grep -A3 shrlak"
