import { webkit, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companion, database, issueCode } from '../server.mjs';
import { demoInbox } from '../inbox.mjs';
import { pushService } from '../push.mjs';

const dir = mkdtempSync(join(tmpdir(), 'inchill-browser-'));
const out = process.env.SCREENSHOTS || dir;
mkdirSync(out, { recursive: true });
const db = database(dir);
const port = 18789;
const url = 'http://127.0.0.1:' + port;
const server = companion({
  db,
  origin: url,
  port,
  inbox: demoInbox(db),
  demo: true,
  push: pushService(db, 'mailto:test@example.org'),
});
server.listen(port, '127.0.0.1');
await once(server, 'listening');
try {
  for (const [engine, name, width, height] of [
    [webkit, 'mobile', 390, 844],
    [chromium, 'desktop', 1280, 800],
    [webkit, 'small', 320, 667],
  ]) {
    const browser = await engine.launch(
      name === 'desktop' && process.env.CHROME_CHANNEL
        ? { channel: process.env.CHROME_CHANNEL }
        : {},
    );
    try {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: name !== 'desktop',
        hasTouch: name !== 'desktop',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (
          ['error', 'warning'].includes(message.type()) &&
          !/401|ERR_INTERNET_DISCONNECTED/.test(message.text())
        ) {
          errors.push(message.text());
        }
      });
      await page.goto(url);
      await page.locator('#code').fill(issueCode(db));
      await page.getByRole('button', { name: 'Pair device', exact: true }).click();
      const review = page.getByRole('button', { name: /GitHub, Review the new command palette/ });
      await review.waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.title(), 'Inbox & Chill');
      assert.equal(new URL(page.url()).origin, url);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      const before = errors.length;
      await page.screenshot({ caret: 'initial', path: join(out, name + '.png') });
      // Playwright WebKit injects a stylesheet during capture. Our CSP rejects it.
      const captureErrors = errors.splice(before);
      assert.ok(
        captureErrors.every((e) => engine === webkit && e.includes('Content Security Policy')),
      );
      if (name === 'small') continue;
      await review.click();
      await page.getByRole('button', { name: 'Unpin', exact: true }).click();
      await page.getByText('Unpinned.', { exact: true }).waitFor();
      await review.click();
      await page.getByRole('button', { name: 'Pin', exact: true }).click();
      await page.getByText('Pinned.', { exact: true }).waitFor();
      await review.click();
      const source = page.getByRole('link', { name: /Open source/ });
      assert.equal(await source.getAttribute('href'), 'https://github.com/notifications');
      await context.route('https://github.com/notifications', (route) =>
        route.fulfill({ body: 'Source destination fixture' }),
      );
      const popup = page.waitForEvent('popup');
      await source.click();
      const dest = await popup;
      await dest.waitForLoadState();
      assert.equal(dest.url(), 'https://github.com/notifications');
      await dest.close();
      await page.getByText('Marked read.', { exact: true }).waitFor();
      await review.click();
      await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
      await page.getByText('Marked unread.', { exact: true }).waitFor();
      await page.locator('#repo').selectOption('studio/toolkit');
      assert.equal(await page.locator('.row').count(), 1);
      await page.locator('#repo').selectOption('');
      await page.locator('#source').selectOption('linear');
      assert.equal(await page.locator('.row').count(), 1);
      await page.locator('#source').selectOption('');
      await review.click();
      await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await review.waitFor();
      await review.click();
      await page.getByRole('button', { name: 'Mark done', exact: true }).click();
      await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
      await review.click();
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await page.getByText('Restored.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      await review.click();
      await page.getByLabel('Snooze', { exact: true }).selectOption('15');
      await page.getByRole('button', { name: 'Snoozed', exact: true }).click();
      await review.click();
      await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      await review.waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings' }).waitFor();
      await page.getByRole('button', { name: 'Close settings' }).click();
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await review.waitFor();
      assert.ok(
        await page.evaluate(async () => {
          const c = await caches.open((await caches.keys())[0]);
          return (await c.keys()).every((k) => !k.url.includes('/api/'));
        }),
      );
      if (name === 'desktop') {
        await context.grantPermissions(['notifications']);
        const cdp = await context.newCDPSession(page);
        const updated = once(cdp, 'ServiceWorker.workerRegistrationUpdated', {
          signal: AbortSignal.timeout(12000),
        });
        await cdp.send('ServiceWorker.enable');
        const [event] = await updated;
        const registrationID = event.registrations.find(
          (reg) => reg.scopeURL === url + '/',
        )?.registrationId;
        assert.ok(registrationID);
        await cdp.send('ServiceWorker.deliverPushMessage', {
          origin: url,
          registrationId: registrationID,
          data: JSON.stringify({ test: true }),
        });
        await page.waitForFunction(async () => {
          const registration = await navigator.serviceWorker.ready;
          return (await registration.getNotifications()).some(
            (n) => n.body === 'Your test notification arrived.',
          );
        });
        await context.setOffline(true);
        await page.reload();
        await page.getByRole('button', { name: 'Try again' }).waitFor();
        await context.setOffline(false);
        try {
          await review.waitFor({ timeout: 2000 });
        } catch {
          await page.getByRole('button', { name: 'Try again' }).click();
          await review.waitFor();
        }
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Unpair device' }).click();
      await page.getByRole('button', { name: 'Pair device', exact: true }).waitFor();
      assert.equal(await page.locator('.row').count(), 0);
      assert.deepEqual(errors, []);
      console.log(name + ' triage flow passed');
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
