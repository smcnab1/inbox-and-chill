import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demoInbox, nativeInbox, validateAction, RequestError } from './inbox.mjs';
import { pushService, validateSubscription } from './push.mjs';

const digest = (text) => createHash('sha256').update(text).digest('hex');
const month = 30 * 86400000;
export function database(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const db = new DatabaseSync(join(dir, 'devices.sqlite'));
  chmodSync(join(dir, 'devices.sqlite'), 0o600);
  db.exec(`PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pairing (id INTEGER PRIMARY KEY, hash TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, expires INTEGER, subscription TEXT);
    DELETE FROM devices WHERE expires <= unixepoch()*1000;`);
  return db;
}

export function issueCode(db) {
  const code = randomBytes(8).toString('hex');
  db.prepare('INSERT OR REPLACE INTO pairing VALUES (1, ?, ?)').run(
    digest(code),
    Date.now() + 600000,
  );
  return code.match(/.{4}/g).join('-');
}

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new RequestError(415, 'Send JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new RequestError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new RequestError(400, 'Invalid JSON.');
  }
}

export function companion({ db, origin, inbox, demo, push, port }) {
  const url = new URL(origin);
  const local = '127.0.0.1:' + port;
  if (
    url.origin !== origin ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && url.host === local))
  ) {
    throw new Error('Set ORIGIN to the exact private HTTPS origin or use the local default.');
  }
  const cookie = url.protocol === 'https:' ? '__Host-inchill' : 'inchill-local';
  const flags =
    '; HttpOnly; SameSite=Strict; Path=/' + (url.protocol === 'https:' ? '; Secure' : '');
  const root = fileURLToPath(new URL('./dist/', import.meta.url));
  const assets = new Map(
    readdirSync(root).map((name) => ['/' + name, readFileSync(join(root, name))]),
  );
  assets.set('/', assets.get('/index.html'));
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain',
  };
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      if (![local, url.host].includes(req.headers.host))
        throw new RequestError(403, 'Unexpected host.');
      const path = req.url;
      if (req.method === 'GET' && assets.has(path)) {
        res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/html' });
        return res.end(assets.get(path));
      }
      if (!path.startsWith('/api/')) throw new RequestError(404, 'Not found.');
      const post = req.method === 'POST';
      if (post && req.headers.origin !== origin) throw new RequestError(403, 'Unexpected origin.');
      if (post && path === '/api/pair') {
        const body = await jsonBody(req);
        const hash = digest(
          String(body?.code || '')
            .toLowerCase()
            .replaceAll('-', '')
            .trim(),
        );
        const used = db
          .prepare('DELETE FROM pairing WHERE hash = ? AND expires > ? RETURNING id')
          .get(hash, Date.now());
        if (!used)
          throw new RequestError(
            401,
            'Code expired or incorrect. Generate a new code on your Mac.',
          );
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO devices VALUES (?, ?, NULL)').run(
          digest(token),
          Date.now() + month,
        );
        res.setHeader('Set-Cookie', cookie + '=' + token + flags + '; Max-Age=' + month / 1000);
        return json(200, {});
      }
      const token = (req.headers.cookie || '')
        .split(/;\s*/)
        .find((value) => value.startsWith(cookie + '='))
        ?.slice(cookie.length + 1);
      const device =
        token &&
        db
          .prepare('SELECT * FROM devices WHERE id = ? AND expires > ?')
          .get(digest(token), Date.now());
      if (!device) throw new RequestError(401, 'Pair this device with your Mac.');
      if (req.method === 'GET' && path === '/api/inbox') {
        return json(200, {
          items: await inbox.items(),
          demo,
          publicKey: push.publicKey,
          subscribed: !!device.subscription,
        });
      }
      if (!post) throw new RequestError(404, 'Not found.');
      const body = await jsonBody(req);
      switch (path) {
        case '/api/action':
          await inbox.act(validateAction(body));
          break;
        case '/api/subscribe':
          db.prepare('UPDATE devices SET subscription = ? WHERE id = ?').run(
            JSON.stringify(validateSubscription(body)),
            device.id,
          );
          break;
        case '/api/unsubscribe':
          db.prepare('UPDATE devices SET subscription = NULL WHERE id = ?').run(device.id);
          break;
        case '/api/test-push':
          if (!device.subscription) throw new RequestError(400, 'Enable push first.');
          await push.deliver(device, { test: true });
          break;
        case '/api/sign-out':
          db.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
          res.setHeader('Set-Cookie', cookie + '=' + flags + '; Max-Age=0');
          break;
        default:
          throw new RequestError(404, 'Not found.');
      }
      json(200, {});
    } catch (error) {
      json(error instanceof RequestError ? error.status : 500, {
        error:
          error instanceof RequestError
            ? error.message
            : 'Companion could not complete the request.',
      });
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.umask(0o077);
  const demo = process.argv.includes('--demo');
  const base = join(homedir(), 'Library/Application Support');
  const db = database(
    join(
      process.env.COMPANION_DATA || join(base, 'InboxAndChillCompanion'),
      demo ? 'demo' : 'live',
    ),
  );
  if (process.argv.includes('--pair')) {
    console.log('Single-use pairing code (10 minutes):', issueCode(db));
  } else if (process.argv.includes('--revoke')) {
    db.exec('DELETE FROM devices; DELETE FROM pairing');
    console.log('Revoked all device sessions and pairing codes for this mode.');
  } else {
    const port = Number(process.env.PORT || 8787);
    const origin = process.env.ORIGIN || 'http://127.0.0.1:' + port;
    const inbox = demo ? demoInbox(db) : nativeInbox(join(base, 'InboxAndChill/local-api.json'));
    const push = pushService(
      db,
      process.env.VAPID_SUBJECT ||
        (origin.startsWith('https:') ? origin : 'mailto:companion@example.org'),
    );
    const server = companion({ db, origin, inbox, demo, push, port });
    server.listen(port, '127.0.0.1', () =>
      console.log((demo ? 'Sample inbox' : 'Mac inbox') + ' ready at ' + origin),
    );
    const timer = setInterval(() => push.poll(inbox).catch(() => {}), 15000);
    server.on('close', () => clearInterval(timer));
  }
}
