# Inbox & Chill on iPhone

Install a private Home Screen app from Safari. The sample inbox runs on a Mac with Node 22.13 or newer. Live mode also needs this branch's **direct** macOS build running with the Local source enabled. The Mac hosts the relay and must be awake for sync and push. There is no Apple membership, domain registration or hosted database to buy. Tailscale Personal is free for personal use. [Tailscale pricing](https://tailscale.com/pricing) · [WebKit Home Screen support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## Install and test with sample data

1. Connect the Mac and iPhone to the same private Tailscale network. On the Mac, run these commands from the repository root. They start a private HTTPS proxy on port 8443 and the sample server on loopback. The first Serve invocation may ask you to enable HTTPS in your own tailnet. Leave the terminal running.

   ```sh
   cd companion
   npm ci --omit=dev
   npm run build
   ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   "$ts" serve --bg --https=8443 http://127.0.0.1:8787
   name=$("$ts" status --json | node -p "JSON.parse(require('fs').readFileSync(0)).Self.DNSName.replace(/\.$/,'')")
   ORIGIN="https://${name}:8443" npm run demo
   ```

   Use an unused Serve port if 8443 already hosts another service. Keep Serve limited to your tailnet. Its public counterpart, Funnel, would expose the login surface to the internet. The host name used for a TLS certificate can appear in public certificate transparency logs. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) · [HTTPS certificates](https://tailscale.com/kb/1153/enabling-https)

2. On iPhone **iOS 16.4 or later**, open the HTTPS address printed by the server in Safari. Tap **Share → Add to Home Screen → Add**. Some Safari versions put Share in the page menu and Add to Home Screen under **View More**. Leave **Open as Web App** enabled when offered.
3. Open **Inbox & Chill** from the new icon. In a second Mac terminal, from the repository root, run `npm --prefix companion run pair -- --demo`. Enter the displayed code in the Home Screen app. It works once for ten minutes.
4. Tap a GitHub row. **Open source** follows its web link. **Mark read / unread**, **Pin**, **Snooze**, **Archive** and **Undo** update the sample queue. Change the source or repository filter, then close and reopen the app to check persistence. A snooze of 15 minutes returns to Inbox when due.
5. Tap **Settings → Enable push → Allow → Send test push**. Check Notification Centre for “Your test notification arrived.” Return to Inbox and compare its unread count to the Home Screen badge. Allow badges in iOS notification settings if needed.

To test on the Mac alone, run `npm run demo` without `ORIGIN` and open `http://127.0.0.1:8787`. The iPhone needs trusted HTTPS. A LAN IP over plain HTTP cannot supply its service worker and push.

## Connect the live Mac inbox

Build the direct candidate from the repository root with Xcode and XcodeGen installed. This creates a review app under `build/`. Quit any already-running Inbox & Chill before opening the candidate, since both use the same SwiftData store. Ad-hoc review builds can prompt for access to existing Keychain entries. The normal app in Applications is preserved.

```sh
xcodegen generate
xcodebuild -project InboxAndChill.xcodeproj -scheme InboxAndChill \
  -configuration Debug -destination 'platform=macOS' -derivedDataPath build/companion-mac \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= \
  ENABLE_HARDENED_RUNTIME=NO OTHER_CODE_SIGN_FLAGS=--timestamp=none build
open "build/companion-mac/Build/Products/Debug/Inbox & Chill.app" --args --web-companion
```

In Mac **Settings → Sources**, enable **Local** and the desired GitHub, Linear or ntfy sources. Existing Claude Code and Codex hooks feed their usual Local rows. Local file links and terminal sessions open on the Mac only. Credentials are entered on the Mac. [Source setup](../docs/setup-sources.md) · [Local hooks](../docs/shell-integration.md)

Stop the demo relay with Control-C. In the same terminal, start live mode with `ORIGIN="https://${name}:8443" npm start`. Pair in the Home Screen app using a fresh code from `npm --prefix companion run pair` at the repository root. Live and sample sessions, keys and state are separate.

For a disposable cross-device check, run the following from the repository root, refresh the phone, pin the row and verify the pin on the Mac. Archive it on the phone and restore it from Archive on the Mac. **Done** uses the existing connector's remote action, including GitHub mark-read or Linear archive. **Archive** only dismisses the shared queue row. **Restore / Undo** brings back the local row. Linear also writes snoozes through to the source.

```sh
"build/companion-mac/Build/Products/Debug/Inbox & Chill.app/Contents/MacOS/inchill" \
  notify --id companion-review --title "Companion review" --body "Disposable test row"
```

## Privacy and operation

- The relay binds to IPv4 loopback. A paired device receives a 30-day HttpOnly, SameSite session cookie, marked Secure over HTTPS. Every mutation checks the configured origin. On the Mac, the discovery file is owner-readable and the companion bearer is separate from the existing producer bearer. Live reads and writes require the opt-in launch flag.
- Live notification state stays in the Mac app. The phone holds rows in memory and caches only the public app shell. Fresh data and triage require a connection. The relay stores device-session hashes, push subscriptions and the VAPID signing key under `~/Library/Application Support/InboxAndChillCompanion/{demo,live}/` with owner-only permissions. Provider secrets stay in macOS Keychain.
- The open inbox refreshes every 30 seconds and when it regains focus. With push subscribers, the relay checks for arrivals and snooze wakes every 15 seconds. It starts from the current snapshot on startup. Encrypted pushes carry a count and display generic lock-screen text. The badge updates on refresh or an activity push. Changes on another device during a quiet period reach the badge when the app next refreshes.
- **Settings → Unpair device** revokes this session and its push registration. For a lost device, run `node server.mjs --revoke` in `companion/` to revoke all live sessions. Add `--demo` for sample sessions. To stop hosting, interrupt the Node process and run `"$ts" serve --https=8443 off` in the first terminal. Quit the review app and reopen your usual Mac app to return to normal use.

## Development

From `companion/`, run `npm ci && npm test` for the production package and relay tests. Run `npx playwright install chromium webkit && npm run test:browser` for the isolated demo flow at 320, 390 and 1280 pixels. Set `SCREENSHOTS` to an output directory to retain the captures. CI uploads the screenshots with the PR checks. The Swift tests exercise a temporary listener and in-memory store.

Project code and the Fluent Emoji icon retain their MIT notices. Syne and Space Grotesk retain their SIL Open Font Licences. The build copies all four notices into the web distribution. [Project licence](../LICENSE) · [Icon attribution](../docs/brand/vendor/README.md)
