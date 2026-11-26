import { generateVAPIDKeys, sendNotification } from 'web-push';
import { RequestError } from './inbox.mjs';

export function validateSubscription(sub) {
  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    /* invalid subscription */
  }
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !/^(?:(?:[a-z0-9-]+\.)*push\.apple\.com|fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com)$/.test(
      url.hostname,
    ) ||
    !/^[\w-]{87}$/.test(sub.keys?.p256dh) ||
    !/^[\w-]{22}$/.test(sub.keys?.auth)
  ) {
    throw new RequestError(400, 'Unsupported push subscription.');
  }
  return { endpoint: url.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export function pushService(db, subject, send = sendNotification) {
  let record = db.prepare("SELECT value FROM settings WHERE name = 'vapid'").get();
  if (!record) {
    record = { value: JSON.stringify(generateVAPIDKeys()) };
    db.prepare("INSERT INTO settings VALUES ('vapid', ?)").run(record.value);
  }
  const keys = JSON.parse(record.value);
  let previous;
  let running = false;
  async function deliver(device, payload) {
    try {
      await send(JSON.parse(device.subscription), JSON.stringify(payload), {
        vapidDetails: { ...keys, subject },
        TTL: 300,
        timeout: 10000,
      });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        db.prepare('UPDATE devices SET subscription = NULL WHERE id = ? AND subscription = ?').run(
          device.id,
          device.subscription,
        );
      }
      throw new RequestError(
        502,
        'Push service did not accept delivery. Check notification permission and enable push again.',
      );
    }
  }
  return {
    publicKey: keys.publicKey,
    deliver,
    async poll(inbox) {
      if (running) return;
      running = true;
      try {
        const devices = db
          .prepare('SELECT * FROM devices WHERE subscription IS NOT NULL AND expires > ?')
          .all(Date.now());
        if (!devices.length) {
          previous = undefined;
          return;
        }
        const items = await inbox.items();
        const now = Date.now();
        const active = items.filter((item) => !item.archived && !(item.until > now));
        const fresh =
          previous &&
          active.some((item) => {
            const old = previous.get(item.id);
            return (
              (item.unread && (!old || item.time > old.time)) ||
              (old?.until > old?.checked && old.until <= now)
            );
          });
        previous = new Map(
          items.map((item) => [item.id, { time: item.time, until: item.until, checked: now }]),
        );
        if (fresh) {
          const payload = { count: active.filter((item) => item.unread).length };
          const results = await Promise.allSettled(
            devices.map((device) => deliver(device, payload)),
          );
          if (results.some((result) => result.status === 'rejected'))
            console.error('A push delivery failed. Check the device subscription.');
        }
      } finally {
        running = false;
      }
    },
  };
}
