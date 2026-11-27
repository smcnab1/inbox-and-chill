#!/bin/bash
# Install the live relay for this macOS login, without touching device state.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../companion"

origin="${1:-}"
if [ "$#" -ne 1 ] || ! node -e '
  const input = process.argv[1];
  const url = URL.parse(input);
  process.exit(url?.protocol === "https:" && url.origin === input ? 0 : 1);
' "$origin"; then
  echo "Usage (Node 22.13+): $0 https://your-existing-private-origin:8443" >&2
  exit 2
fi
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error("Node 22.13 or newer is required.");
'
node_bin=$(command -v node)
label=lol.bgreen.inboxandchill.companion
domain="gui/$(id -u)"
job="$domain/$label"
base="$HOME/Library/Application Support/InboxAndChillCompanion"
relay="$base/relay"
agents="$HOME/Library/LaunchAgents"
plist="$agents/$label.plist"
mkdir -p "$base" "$agents"
stage=$(mktemp -d "$base/install.XXXXXX")
switched=0
had_job=0
new_relay=0
finish() {
  local result=$?
  if [ "$result" -ne 0 ] && [ "$switched" = 1 ]; then
    echo "Relay did not start; restoring the previous installation." >&2
    launchctl bootout "$job" 2>/dev/null || true
    if [ "$new_relay" = 1 ]; then rm -rf "$relay"; fi
    if [ -d "$stage/previous-relay" ]; then mv "$stage/previous-relay" "$relay"; fi
    if [ -f "$stage/previous.plist" ]; then
      mv -f "$stage/previous.plist" "$plist"
    else
      rm -f "$plist"
    fi
    if [ "$had_job" = 1 ]; then launchctl bootstrap "$domain" "$plist"; fi
  fi
  rm -rf "$stage"
}
trap finish EXIT

mkdir "$stage/relay"
cp package.json package-lock.json server.mjs inbox.mjs push.mjs "$stage/relay/"
npm run build
ditto dist "$stage/relay/dist"
npm --prefix "$stage/relay" ci --omit=dev --no-audit

node -e '
  const [label, node, relay, origin, log] = process.argv.slice(1);
  console.log(JSON.stringify({
    Label: label, ProgramArguments: [node, relay + "/server.mjs"],
    EnvironmentVariables: { ORIGIN: origin }, KeepAlive: true, ThrottleInterval: 10,
    StandardErrorPath: log
  }));
' "$label" "$node_bin" "$relay" "$origin" "$base/relay-error.log" |
  plutil -convert xml1 -o "$stage/agent.plist" -
plutil -lint "$stage/agent.plist"

if [ -f "$plist" ]; then cp -p "$plist" "$stage/previous.plist"; fi
if launchctl print "$job" >/dev/null 2>&1; then
  launchctl bootout "$job"
  had_job=1
elif lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8787 is already in use. Stop the terminal relay before installing." >&2
  exit 1
fi
switched=1
if [ -d "$relay" ]; then mv "$relay" "$stage/previous-relay"; fi
mv "$stage/relay" "$relay"
new_relay=1
mv -f "$stage/agent.plist" "$plist"
launchctl bootstrap "$domain" "$plist"

for _ in {1..15}; do
  pid=$(launchctl print "$job" | awk '$1 == "pid" && $2 == "=" && !seen {print $3; seen=1}')
  if [ -n "$pid" ] && lsof -a -p "$pid" -nP -iTCP@127.0.0.1:8787 -sTCP:LISTEN >/dev/null 2>&1 &&
    curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:8787/ >/dev/null; then
    echo "Live relay installed and running under launchd."
    exit 0
  fi
  sleep 1
done
echo "Check $base/relay-error.log and whether port 8787 is free." >&2
exit 1
