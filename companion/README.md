# Inbox & Chill on iPhone

Install a private Home Screen app from Safari. The sample inbox runs on a Mac with Node 22.13 or newer. Live mode uses the **direct** macOS build. The Mac hosts the relay and must be awake, with your macOS session logged in, for sync and push. There is no Apple membership, domain registration or hosted database to buy. Tailscale Personal is free for personal use. [Tailscale pricing](https://tailscale.com/pricing) · [WebKit Home Screen support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

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

   Use an unused Serve port if 8443 already hosts another service. Keep Serve limited to your tailnet. Its public counterpart, Funnel, would expose the login surface to the internet. The host name used for a TLS certificate can appear in public certificate transparency logs. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) · [HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates)

2. On iPhone **iOS 16.4 or later**, open the HTTPS address printed by the server in Safari. Tap **Share → Add to Home Screen → Add**. Some Safari versions put Share in the page menu and Add to Home Screen under **View More**. Leave **Open as Web App** enabled when offered.
3. Open **Inbox & Chill** from the new icon. In a second Mac terminal, from the repository root, run `npm --prefix companion run pair -- --demo`. Enter the displayed code in the Home Screen app. It works once for ten minutes.
4. Tap a GitHub row. **Open source** follows its web link. **Mark read / unread**, **Pin**, **Snooze**, **Archive** and **Undo** update the sample queue. Change the source or repository filter, then close and reopen the app to check persistence. A snooze of 15 minutes returns to Inbox when due.
5. Tap **Settings → Enable push → Allow → Send test push**. Check Notification Centre for “Your test notification arrived.” Return to Inbox and compare its unread count to the Home Screen badge. Allow badges in iOS notification settings if needed.

To test on the Mac alone, run `npm run demo` without `ORIGIN` and open `http://127.0.0.1:8787`. The iPhone needs trusted HTTPS. A LAN IP over plain HTTP cannot supply its service worker and push.

## Connect the live Mac inbox

1. [Build and install the direct Mac app from this fork](../README.md#build-and-install). If you already use a local signing identity, keep it for repeat installs.
2. In Mac **Settings → General**, turn on **Enable iPhone companion** and **Launch at login**. In **Settings → Sources**, enable **Local coding agents** and the GitHub, Linear or ntfy sources you want on the phone. Existing local hooks keep working when the companion is off. Local files and terminal sessions open on the Mac only. Enter provider credentials only on the Mac. [Source setup](../docs/setup-sources.md) · [Local hooks](../docs/shell-integration.md)

3. If the private Tailscale Serve proxy is already working, keep its **exact HTTPS address and port**. Otherwise, create the persistent Serve mapping in the sample instructions above. Stop any terminal relay listening on port 8787; then, from the repository root, install the live LaunchAgent:

   ```sh
   scripts/install-companion-relay.sh 'https://your-mac.your-tailnet.ts.net:8443'
   ```

   This copies the relay into Application Support. macOS starts it at login and relaunches it if it exits, without a terminal or checkout running. Keep Tailscale set to launch at login and use Serve, not Funnel. Rerun the same installer to update the relay. For a Node version manager, select a Node 22.13+ executable available outside the project at login.

4. An existing live pairing at this address keeps working. To pair a new Home Screen app or renew an expired session:

   ```sh
   relay="$HOME/Library/Application Support/InboxAndChillCompanion/relay"
   node "$relay/server.mjs" --pair
   ```

   The pairing code is single-use and expires in ten minutes. Demo state and pairing are separate from live.

## Update an existing install

1. [Update your checkout and reinstall the direct Mac app](../README.md#update-the-mac-app) with your usual signing identity.
2. From the updated checkout, rerun `scripts/install-companion-relay.sh` with the exact existing HTTPS origin, including its port. The installer replaces the relay and restarts its LaunchAgent. It keeps the live database and VAPID keys in place.
3. Reopen the existing Home Screen app while connected to your tailnet. Refresh the inbox and, if you use push, send a test notification from **Settings**.

Keep the same origin so the existing session cookie and push subscription still apply. Pair again if the session expired or you intentionally changed the origin.

## Check and operate the live setup

- **Restart:** Quit and reopen the Mac app from Applications. Refresh the existing Home Screen app. It should reconnect without a new code. The relay runs independently; `launchctl print "gui/$(id -u)/lol.bgreen.inboxandchill.companion"` shows its state. Details for startup failures are in `~/Library/Application Support/InboxAndChillCompanion/relay-error.log`.
- **Notification and badge:** Leave the Home Screen app in the background and send a disposable arrival from the Mac:

  ```sh
  cli='/Applications/Inbox & Chill.app/Contents/MacOS/inchill'
  "$cli" notify --id companion-review --title "Companion review" --body "Disposable test row"
  ```

  Look for a generic Inbox & Chill notification and compare its badge with the unread count after opening the app. Archiving on the phone should remove the row from the Mac inbox; restoring it from the Mac Archive should bring it back on the phone. Remove the test row with `"$cli" clear companion-review`. For push setup use the Home Screen app's **Settings → Enable push**, followed by **Send test push**.
- **Triage:** **Archive** only dismisses the shared queue row. **Restore / Undo** brings it back. **Done** uses the existing source action, such as GitHub mark-read or Linear archive. Linear also writes snoozes through to the source.
- **Turn off:** Switch off **Enable iPhone companion** to block live reads and actions without changing the Local source or pairing. To stop hosting entirely, boot out the relay with `launchctl bootout "gui/$(id -u)/lol.bgreen.inboxandchill.companion"`, move its plist out of `~/Library/LaunchAgents/`, and turn off the matching Tailscale Serve mapping with `tailscale serve --https=8443 off`. Leave the device database in place if you intend to use the same pairing again.

## Privacy and operation

- The relay binds to IPv4 loopback. A paired device receives a 30-day HttpOnly, SameSite session cookie, marked Secure over HTTPS. Every mutation checks the configured origin. The native discovery file is owner-readable, and the companion bearer is separate from the producer bearer. The native bridge is off by default.
- The phone holds live rows in memory and caches only the public app shell. The relay stores device-session hashes, push subscriptions, the VAPID signing key, and hashed item IDs and timestamps used to detect arrivals after a restart. It does not store live titles, links or message content. Live relay state stays under `~/Library/Application Support/InboxAndChillCompanion/live/` with owner-only permissions. Provider secrets stay in macOS Keychain.
- The open inbox refreshes every 30 seconds and on return to the foreground. The relay checks for new activity about every 15 seconds. Encrypted pushes carry a count and show generic lock-screen text. The badge updates on arrival or when you reopen or refresh the inbox. A Mac-side read or archive alone does not send a new notification just to update a background badge.
- **Settings → Unpair device** revokes this session and its push registration. For a lost device, use `node "$relay/server.mjs" --revoke` to revoke all live sessions and pairing codes.

## Development

From `companion/`, run `npm ci && npm test` for the production package and relay tests. Run `npx playwright install chromium webkit && npm run test:browser` for the isolated demo flow at 320, 390 and 1280 pixels. Set `SCREENSHOTS` to an output directory to retain the captures. CI uploads the screenshots with the PR checks. The Swift tests exercise a temporary listener and in-memory store.

Project code and the Fluent Emoji icon retain their MIT notices. Syne and Space Grotesk retain their SIL Open Font Licences. The build copies all four notices into the web distribution. [Project licence](../LICENSE) · [Icon attribution](../docs/brand/vendor/README.md)
