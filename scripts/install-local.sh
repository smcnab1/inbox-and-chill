#!/bin/bash
#
# Build Inbox & Chill and install it to /Applications like a real user would
# have it — signed in a stable location.
#
# Why not just run it from DerivedData? macOS ties Keychain ACLs, TCC
# permissions, and firewall decisions to a binary's code signature *and*
# path. A DerivedData path contains a random hash and changes whenever
# DerivedData is cleaned, so every rebuild looks like a different app and
# re-prompts for everything. /Applications + Developer ID = decisions stick.
#
# Usage:
#   scripts/install-local.sh            # Release build (the real thing)
#   scripts/install-local.sh --debug    # Debug build (fake connector only with INCHILL_FAKE=1)
#   scripts/install-local.sh --no-launch
#   scripts/install-local.sh --app "/path/to/built/Inbox & Chill.app"
#
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIGURATION="Release"
LAUNCH=1
BUILT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --debug) CONFIGURATION="Debug" ;;
    --release) CONFIGURATION="Release" ;;
    --no-launch) LAUNCH=0 ;;
    --app) BUILT="${2:?Pass a built app bundle after --app}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

APP_NAME="Inbox & Chill.app"
BUNDLE_ID="lol.bgreen.inboxandchill"
INSTALL_DIR="/Applications"
DEST="$INSTALL_DIR/$APP_NAME"

if [ -z "$BUILT" ]; then
  echo "==> Generating Xcode project"
  if ! command -v xcodegen >/dev/null 2>&1; then
    echo "xcodegen not found. Install it with: brew install xcodegen" >&2
    exit 1
  fi
  xcodegen generate >/dev/null

  echo "==> Building ($CONFIGURATION)"
  xcodebuild -project InboxAndChill.xcodeproj -scheme InboxAndChill \
    -configuration "$CONFIGURATION" build >/tmp/inchill-build.log 2>&1 || {
      echo "Build failed. Last 40 lines:" >&2
      tail -40 /tmp/inchill-build.log >&2
      exit 1
    }

  # Ask xcodebuild where it put the app rather than scraping the log or
  # globbing DerivedData. Both of those pick by *text order* or *name order*,
  # and every git worktree gets its own DerivedData directory — so from a
  # worktree they happily resolve to another checkout's stale build and
  # `ditto` installs an app that does not contain your changes.
  BUILT_PRODUCTS_DIR=$(xcodebuild -project InboxAndChill.xcodeproj \
    -scheme InboxAndChill -configuration "$CONFIGURATION" -showBuildSettings 2>/dev/null \
    | awk -F ' = ' '/^ *BUILT_PRODUCTS_DIR = / && !seen {print $2; seen=1}')
  BUILT="$BUILT_PRODUCTS_DIR/$APP_NAME"
fi
[ -d "$BUILT" ] || { echo "No app bundle at $BUILT." >&2; exit 1; }
echo "    built at $BUILT"

scripts/verify-bundle.sh --app "$BUILT"
echo "==> Verifying signature"
codesign --verify --deep --strict "$BUILT"
# Capture once rather than piping codesign into `grep -m1`: grep exits at the
# first match, codesign takes SIGPIPE, and `set -o pipefail` would kill us.
SIGINFO=$(codesign -dvv "$BUILT" 2>&1 || true)
IDENTITY=$(printf '%s\n' "$SIGINFO" | awk '/^Authority=/ && !seen {sub(/^Authority=/, ""); print; seen=1}')
TEAM=$(printf '%s\n' "$SIGINFO" | grep '^TeamIdentifier=' | head -1 | cut -d= -f2)
echo "    $IDENTITY (team $TEAM)"
if [ "$TEAM" = "not set" ]; then
  echo "    WARNING: ad-hoc signed — macOS will re-prompt for permissions on every build." >&2
fi

# Only ever replace a bundle that is actually this app.
if [ -e "$DEST" ]; then
  EXISTING_ID=$(defaults read "$DEST/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo "")
  if [ "$EXISTING_ID" != "$BUNDLE_ID" ]; then
    echo "Refusing to replace $DEST — its bundle id is '$EXISTING_ID', not '$BUNDLE_ID'." >&2
    exit 1
  fi
fi

STAGE=$(mktemp -d "$INSTALL_DIR/.inchill-install.XXXXXX")
finish() {
  if [ -d "$STAGE/previous.app" ]; then
    if [ -e "$DEST" ]; then mv "$DEST" "$STAGE/failed.app"; fi
    mv "$STAGE/previous.app" "$DEST"
  fi
  rm -rf "$STAGE"
}
trap finish EXIT
ditto "$BUILT" "$STAGE/$APP_NAME"
codesign --verify --deep --strict "$STAGE/$APP_NAME"

# Quit the running copy before swapping the bundle and opening its store.
if pgrep -x "Inbox & Chill" >/dev/null 2>&1; then
  echo "==> Quitting the running copy"
  osascript -e 'quit app id "'"$BUNDLE_ID"'"'
  for _ in {1..10}; do
    pgrep -x "Inbox & Chill" >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -x "Inbox & Chill" >/dev/null 2>&1; then
    echo "Inbox & Chill is still running; no files were replaced." >&2
    exit 1
  fi
fi

echo "==> Installing to $DEST"
if [ -e "$DEST" ]; then mv "$DEST" "$STAGE/previous.app"; fi
mv "$STAGE/$APP_NAME" "$DEST"
# Locally built apps aren't quarantined, but strip it if anything set one.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# `ditto` copies the SOURCE directory's mtime onto the installed bundle, so the
# top-level .app timestamp can sit days behind its own contents. LaunchServices
# keys its icon cache on that mtime, which is how a new app icon can be sitting
# correctly inside Contents/Resources and still never appear in Finder, the
# Dock, or Spotlight — for days, across many installs. Touch it and re-register
# so the icon that was just built is the icon macOS shows.
touch "$DEST"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$DEST"; fi

echo "==> Installed"
codesign --verify --deep --strict "$DEST" && echo "    signature valid at the install location"

# Attach the notarization ticket if this signature has one. Notarized-but-not-
# stapled is the trap: Gatekeeper accepts it while the Mac can reach Apple and
# refuses it offline, so the local install silently differs from what ships.
# Non-fatal — an un-notarized dev build simply has no ticket to fetch, which is
# the normal case between releases.
if xcrun stapler staple "$DEST" >/dev/null 2>&1; then
  echo "    notarization ticket stapled"
fi

if [ "$LAUNCH" = "1" ]; then
  echo "==> Launching"
  open "$DEST"
  echo "    Look for the tray icon in the menu bar (this is an LSUIElement app —"
  echo "    no Dock icon until you open the ⌘0 window)."
fi
trap - EXIT
rm -rf "$STAGE"
