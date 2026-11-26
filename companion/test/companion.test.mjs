import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createECDH } from 'node:crypto';
import { once } from 'node:events';
import { database, issueCode, companion } from '../server.mjs';
import { demoInbox, nativeInbox, validateAction } from '../inbox.mjs';
import { pushService, validateSubscription } from '../push.mjs';
import { generateRequestDetails } from 'web-push';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'inchill-'));
  const db = database(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, inbox: demoInbox(db) };
}
async function start(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
function subscription() {
  const ecdh = createECDH('prime256v1');
  return {
    endpoint: 'https://web.push.apple.com/example',
    keys: {
      p256dh: ecdh.generateKeys().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
test('private pairing, scoped cookies, archive/undo, same-origin writes and unpair', async (t) => {
  const { db, inbox, dir } = fixture(t);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'devices.sqlite')).mode & 0o777, 0o600);
  const origin = 'https://test.example';
  const push = pushService(db, origin);
  const server = companion({ db, inbox, origin, demo: true, push, port: 8787 });
  const base = await start(t, server);
  // Exercise the private HTTPS proxy's forwarded Host over loopback.
  let cookie = '';
  const call = (route, body, extra) =>
    new Promise((resolve, reject) => {
      const req = request(
        base + '/api/' + route,
        {
          method: body ? 'POST' : 'GET',
          headers: {
            Host: 'test.example',
            Origin: origin,
            Cookie: cookie,
            'Content-Type': 'application/json',
            ...extra,
          },
        },
        async (res) => {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }),
          );
        },
      );
      req.on('error', reject);
      req.end(body && JSON.stringify(body));
    });
  const expired = issueCode(db);
  db.exec('UPDATE pairing SET expires = 0');
  assert.equal((await call('pair', { code: expired })).status, 401);
  assert.equal((await call('inbox')).status, 401);
  const code = issueCode(db);
  assert.equal((await call('pair', { code }, { Origin: 'https://elsewhere.example' })).status, 403);
  const paired = await call('pair', { code });
  assert.equal(paired.status, 200);
  const header = paired.headers.get('set-cookie');
  assert.match(header, /^__Host-inchill=.+HttpOnly; SameSite=Strict; Path=\/; Secure/);
  cookie = header.split(';')[0];
  assert.equal((await call('pair', { code })).status, 401);
  const response = await call('inbox');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.equal(state.items.length, 6);
  assert.equal(state.publicKey, push.publicKey);
  assert.equal((await call('inbox', null, { Host: 'wrong.test' })).status, 403);
  const id = state.items[0].id;
  for (const verb of ['read', 'unread', 'pin', 'unpin', 'snooze', 'archive', 'restore', 'done']) {
    const until = Date.now() + 60000;
    assert.equal((await call('action', { id, verb, until })).status, 200);
    const item = inbox.items().find((i) => i.id === id);
    if (verb === 'snooze') assert.equal(item.until, until);
    if (['restore', 'done', 'archive'].includes(verb))
      assert.equal(item.archived, verb !== 'restore');
  }
  assert.equal((await call('action', { id, verb: 'snooze', until: 1 })).status, 400);
  assert.equal((await call('action', { id: 'absent', verb: 'pin' })).status, 404);
  assert.equal((await call('subscribe', subscription())).status, 200);
  assert.equal((await call('sign-out', {})).status, 200);
  assert.equal((await call('inbox')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
});
test('demo state survives reopening the database', (t) => {
  const { db, inbox, dir } = fixture(t);
  const id = inbox.items()[0].id;
  inbox.act({ id, verb: 'archive' });
  const other = database(dir);
  try {
    assert.ok(
      demoInbox(other)
        .items()
        .find((i) => i.id === id).archived,
    );
  } finally {
    other.close();
  }
  assert.throws(() => validateAction({ id, verb: 'unknown' }));
});
test('native transport re-reads rotating credentials and forwards only the expected action', async (t) => {
  const { dir } = fixture(t);
  const file = join(dir, 'local.json');
  let key = randomBytes(32).toString('hex'),
    lastAction;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + key);
    if (req.url === '/companion/action') {
      let text = '';
      for await (const chunk of req) text += chunk;
      lastAction = JSON.parse(text);
    } else assert.equal(req.url, '/companion/items');
    res.end(req.method === 'GET' ? '[]' : '{}');
  });
  const addr = await start(t, server);
  const update = () =>
    writeFileSync(file, JSON.stringify({ port: Number(new URL(addr).port), companionToken: key }));
  const inbox = nativeInbox(file);
  await assert.rejects(inbox.items(), { status: 503 });
  update();
  assert.deepEqual(await inbox.items(), []);
  key = randomBytes(32).toString('hex');
  update();
  const action = { id: 'linear:1', verb: 'done' };
  await inbox.act(action);
  assert.deepEqual(lastAction, action);
});
test('push uses encrypted generic content, avoids seed floods, coalesces arrivals and removes gone devices', async (t) => {
  const { db, inbox } = fixture(t);
  const sub = validateSubscription(subscription());
  for (const endpoint of [
    'http://web.push.apple.com/no',
    'https://untrusted.example',
    'https://web.push.apple.com:8443/x',
  ]) {
    assert.throws(() => validateSubscription({ ...sub, endpoint }), { status: 400 });
  }
  const calls = [];
  let gone = false;
  const push = pushService(db, 'https://test.example', async (device, payload, options) => {
    const req = generateRequestDetails(device, payload, options);
    assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(!req.body.includes(Buffer.from(payload)));
    calls.push(JSON.parse(payload));
    if (gone) throw Object.assign(new Error(), { statusCode: 410 });
  });
  db.prepare('INSERT INTO devices VALUES (?, ?, ?)').run(
    'mock',
    Date.now() + 60000,
    JSON.stringify(sub),
  );
  const rows = inbox.items();
  const source = { items: () => rows };
  await push.poll(source);
  assert.equal(calls.length, 0);
  rows.push({ ...rows[0], id: 'ntfy:new', title: 'private title' });
  await push.poll(source);
  await push.poll(source);
  assert.deepEqual(calls, [{ count: 6 }]);
  gone = true;
  await assert.rejects(push.deliver(db.prepare('SELECT * FROM devices').get(), { test: true }), {
    status: 502,
  });
  assert.equal(db.prepare('SELECT subscription FROM devices').get().subscription, null);
});
test('the production worker caches only packaged public assets', () => {
  const worker = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  const files = JSON.parse(worker.match(/const assets = (\[.*\]);/)[1]);
  assert.ok(files.includes('/manifest.webmanifest') && files.includes('/icon-180.png'));
  assert.ok(files.every((path) => !path.startsWith('/api')));
  assert.ok(!worker.includes('__VERSION__'));
});
