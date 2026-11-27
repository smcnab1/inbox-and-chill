# Security posture: credentials

For vulnerability reports, see the [security policy](../SECURITY.md). For data and push handling, see the [privacy policy](../PRIVACY.md).

- The Mac app stores provider credentials in the macOS Keychain. The source configuration and inbox are stored locally. The source editor leaves stored credentials out of its edit fields. Deleting a source clears its Keychain entries.
- Connectors send credentials using their provider’s authentication mechanism and configured endpoints. Custom JSON and ntfy can use user-configured hosts. Linear uses a personal API key.
- The local producer and companion share a loopback listener with separate bearer tokens. The owner-readable discovery file is `~/Library/Application Support/InboxAndChill/local-api.json`. The producer token is used by the CLI. Enabling the companion is opt-in, and the relay reads the current companion token locally.
- The companion relay uses single-use pairing codes and revocable sessions. Keep it behind private Tailscale Serve. The [companion guide](../companion/README.md#privacy-and-operation) describes session lifetime, relay state and notification payloads.

## Historical upstream audit notes (2026-08-23)

Two lower-severity findings from the 2026-08-23 audit are recorded here so a
future session can pick them up. Neither is remotely exploitable on its own;
both are brittle patterns worth retiring.

### F3 — Slack/Sentry URLs built by string interpolation (Low)

`SlackConnector.deepLink`/`nativeLink` assemble `slack://` URLs by
interpolating `teamID`/`channel`/`ts` into a raw string
(`Sources/App/Connectors/Slack/SlackConnector.swift:1248,1516`), and
`SentryConnector` interpolates the org slug into
`https://sentry.io/api/0/organizations/\(org)/issues/`
(`Sources/App/Connectors/Sentry/SentryConnector.swift:157,185`). The inputs
come from authenticated API responses / user config and are normally
alphanumeric, so this is not directly exploitable today — but a `?`, `#`, or
space in any of them would silently alter the URL before `URLComponents` sees
it.

**Fix:** build with `URLComponents` and percent-encoded query items (or the
`path`/`queryItems` properties) instead of string interpolation. Mirror the
shape `NtfyConnector.socketURL` already uses.

### F4 — auth-header tokens not sanitized of CR/LF (Very Low, defense in depth)

Tokens read from the Keychain are interpolated straight into
`"Bearer \(token)"` headers (`GitHubConnector:93,170`, `SlackAPI:164`,
`SentryConnector:123,162`, `LinearConnector:76`, `JSONPollerConnector:42`).
Only Slack trims newlines on read (`SlackConnector:284`); the others don't. A
token containing `\r\n` could in principle inject extra headers. The threat
model is self-inflicted (the user pastes their own token), and `URLSession`
likely rejects CRLF anyway, so this is pure defense in depth.

**Fix:** strip whitespace and newlines when reading a token for header use —
either in `Keychain.get`'s callers or in a small `headerToken(_:)` helper.
Keep `Keychain.get` itself raw so non-header uses (e.g. the JSON poller's
`authHeader`, which is a whole header value) aren't over-trimmed.

### Already fixed in this pass

- **F1 (the open-URL scheme gate, Medium):** `AppState.openable` now restricts
  `NSWorkspace.open` to http/https + the app's own deep-links (`slack`,
  `message`), with `file`/`claude` local-source-only. ntfy's `click`/action/
  attachment URLs (and a compromised JSON feed's `url` field) can no longer
  reach `shortcuts://`/`file://`/arbitrary registered handlers. Routed the
  archive's Open button through the same gate. Tests: `OpenSchemeGateTests`.
- **F2 (JSON poller scheme validation, Low):** `JSONPollerConnector.accept`
  refuses non-http(s) feed URLs up front with a named error, so a `file://`
  feed no longer reads a local file into memory each poll. Tests:
  `JSONPollerConnectorTests`.
