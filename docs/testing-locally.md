# Testing Inbox & Chill locally

## 1. Build and install

For a local install, use the [direct build and installer](../README.md#build-and-install). The menu bar icon appears after launch. macOS asks for notification permission when you first use a feature that needs it.

Use a stable installation path and the same local signing identity for updates. An ad-hoc signature can prompt again for Keychain or macOS permissions after each rebuild. An existing copy in `/Applications` with the same bundle identifier is replaced by the installer.

For contributor checks, build and test using the ad-hoc signing flags in [CI](../.github/workflows/ci.yml). To try the fake connector below, use a separate macOS user or a disposable test environment so it starts with an empty store.

## 2. Ride the fake connector (no accounts needed)

In a Debug build, set `INCHILL_FAKE=1` in the scheme's environment (Xcode:
Product → Scheme → Edit Scheme → Run → Arguments) and configure no real
source: a **fake connector** then feeds a rotating queue of items so the
whole triage loop can be exercised without an account.

It is **opt-in on purpose** (since 2026-09-04). It used to register itself in
any Debug build with no real source, and once a fresh install meant zero
sources that put fakes on the welcome screen — and, through the test host
that `xcodebuild test` launches, into the live store the installed app reads
(Debug and Release share one `store.sqlite`). The test host no longer starts
any connector, and the fake one has to be asked for.

## 3. Test the local pipeline (terminal + Claude Code)

Add the "Local coding agents" source in Settings › Sources (nothing is
pre-added on a fresh install); it starts a localhost listener. The CLI lives inside the app bundle:

```sh
alias inchill='/Applications/Inbox & Chill.app/Contents/MacOS/inchill'
```

```sh
inchill notify --title "Hello from the terminal" --url "https://example.org/"
```

The item appears in the panel instantly (banners default ON for this
source). Clear it:

```sh
inchill notify --id my-task --title "Long build running"
inchill done my-task
```

**Claude Code:** Settings → General → Claude Code → "Set Up Integration"
(backs up `~/.claude/settings.json` first, merge is additive). Then start
any Claude Code session: when it waits for permission or input, a
high-signal "Claude Code needs your input" item appears — and clears
itself the moment the session moves on, leaving a quiet "Claude finished
in <project>" breadcrumb. Simulate without a real session:

```sh
echo '{"session_id":"demo","cwd":"'$PWD'","message":"Needs permission"}' | inchill claude-hook notification
echo '{"session_id":"demo","cwd":"'$PWD'"}' | inchill claude-hook stop
```

## 4. Connect real sources (Settings → Sources → +)

Fastest first:

1. **Linear** (~2 min): linear.app → Settings → Security & Access → personal key. Items
   mirror your Linear inbox; mark-done archives there; snoozes sync.
2. **GitHub** (~3 min): classic PAT with `notifications` scope
   (github.com/settings/tokens — fine-grained tokens don't work), authorize
   SSO for your organisation if prompted.
3. **Slack**: create the app from `docs/slack-app-manifest.yml` (see
   `docs/setup-sources.md`), install to the workspace (may need admin
   approval), paste the xoxp + xapp tokens. Then: have someone @-mention
   you, watch it arrive live; react to any message with 📌 and watch it
   become a saved item; remove the reaction and watch it clear.

## 5. Run the test suite

```sh
xcodebuild -project InboxAndChill.xcodeproj -scheme InboxAndChill test
```

The tests use an in-memory app store and temporary fixtures. Use the signing flags in [CI](../.github/workflows/ci.yml) when building without a Developer ID certificate.

## 6. Repeat first-run testing

Use a disposable macOS account. Run `scripts/reset-first-run.sh --dry-run` to preview the reset. Then run `scripts/reset-first-run.sh` and type `reset` if you are ready to delete that account’s local queue and archive, app preferences and saved tokens. The script also attempts to reset the app’s Automation permission. Reopen the installed app to repeat first-run testing.

The reset retains notification permission. Use a fresh macOS account to test that prompt.
