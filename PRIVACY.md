# Privacy

## On the Mac

Inbox & Chill keeps queue content, triage state and source configuration in a local database under `~/Library/Application Support/InboxAndChill/` for the direct build. It stores provider credentials in the macOS Keychain. Enabled connectors contact their configured services to fetch data and carry out source actions. Apple Mail and Reminders use macOS permissions.

Diagnostics are stored locally. The app can prepare a report for you to review and share. Review it for private information before posting or emailing it. The inherited About and diagnostics contact points to the original project. Use this fork’s [issue tracker](https://github.com/smcnab1/inbox-and-chill/issues) or [private reporting channel](SECURITY.md) for fork support.

## On the iPhone and relay

The optional companion runs through a relay on your Mac. Tailscale Serve supplies HTTPS inside your private network. The HTTPS host name can appear in public certificate transparency logs. [Tailscale HTTPS documentation](https://tailscale.com/docs/how-to/set-up-https-certificates)

The paired Home Screen app holds live queue items in memory and caches the public app shell. The relay stores device-session hashes, push subscriptions and keys, and hashed item IDs and timestamps under `~/Library/Application Support/InboxAndChillCompanion/live/`. It fetches live inbox content from the Mac app as needed. Provider credentials stay on the Mac.

If you enable notifications, the relay sends encrypted Web Push through the browser’s push service. Push payloads contain a count or a test marker. Notifications use generic text. Your browser and operating system manage delivery and display.

Use **Unpair device** in companion Settings to revoke that session and its subscription, or [revoke all sessions](companion/README.md#privacy-and-operation) from the Mac. You can also disable live companion access in Mac Settings.

[Companion setup and operation](companion/README.md)
