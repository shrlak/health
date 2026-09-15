#!/usr/bin/env bash
# Generates the Xcode project and writes in your widget token.
#
# Run it again whenever the token changes; it is safe to repeat.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is not installed. Run:  brew install xcodegen" >&2
  exit 1
fi

if [ ! -f Shared/Config.swift ]; then
  cp Config.example.swift Shared/Config.swift
fi

# Read silently: this is a working credential, and a terminal keeps scrollback.
printf 'Paste the read-only token from the dashboard (Connections → Mac widget).\n'
printf 'Leave blank to keep whatever is already in Shared/Config.swift.\n'
printf 'Token: '
read -r -s TOKEN
printf '\n'

if [ -n "$TOKEN" ]; then
  case "$TOKEN" in
    *[!A-Za-z0-9_-]*)
      echo "That does not look like a token — expected letters, digits, - and _ only." >&2
      exit 1
      ;;
  esac
  # Rewritten from the example each time, so a previous token is replaced
  # rather than appended to.
  sed "s|PASTE_YOUR_TOKEN_HERE|${TOKEN}|" Config.example.swift > Shared/Config.swift
  echo "Wrote Shared/Config.swift (${#TOKEN} characters)."
fi

xcodegen generate
echo
echo "Opening Xcode. Before pressing Run:"
echo "  • Select the Whoop target → Signing & Capabilities → set Team to your name."
echo "  • Do the same for the WhoopWidget target."
echo
open Whoop.xcodeproj
