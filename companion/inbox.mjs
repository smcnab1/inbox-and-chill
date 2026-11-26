import { readFile } from 'node:fs/promises';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function nativeInbox(discoveryFile) {
  async function request(route, action) {
    try {
      const { port, companionToken } = JSON.parse(await readFile(discoveryFile, 'utf8'));
      if (
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !/^[a-f0-9]{64}$/.test(companionToken)
      ) {
        throw new Error('Invalid discovery file');
      }
      const response = await fetch(`http://127.0.0.1:${port}/companion/${route}`, {
        method: action ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${companionToken}`, 'Content-Type': 'application/json' },
        body: action && JSON.stringify(action),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (action && response.status === 404)
        throw new RequestError(404, 'This item is no longer on the Mac.');
      if (action && response.status === 400)
        throw new RequestError(400, 'Choose a future snooze time.');
      if (response.status === 502)
        throw new RequestError(
          502,
          'Check the source status on your Mac. The local action may already have saved.',
        );
      if (!response.ok) throw new Error('Mac unavailable');
      return await response.json();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(
        503,
        'Launch the Mac build with --web-companion and enable its Local source.',
      );
    }
  }
  return { items: () => request('items'), act: (action) => request('action', action) };
}

export function demoInbox(db) {
  db.exec('CREATE TABLE IF NOT EXISTS demo (id TEXT PRIMARY KEY, item TEXT NOT NULL)');
  if (!db.prepare('SELECT id FROM demo LIMIT 1').get()) {
    const examples = [
      [
        'github',
        'review_requested',
        'Review the new command palette',
        'studio/fieldnotes',
        'The keyboard shortcuts and search results are ready for review.',
      ],
      [
        'linear',
        'mention',
        'Mobile navigation polish',
        'DES-128',
        'Mira mentioned you in the handoff for the new tab bar.',
      ],
      [
        'ntfy',
        'ntfy_message',
        'Nightly backup complete',
        'homelab',
        'All four volumes finished successfully.',
      ],
      [
        'local',
        'claude_waiting',
        'Claude is waiting in fieldnotes',
        'fieldnotes',
        'Review the proposed changes on your Mac.',
      ],
      [
        'github',
        'assign',
        'Tighten the release checklist',
        'studio/toolkit',
        'You were assigned to this issue.',
      ],
      [
        'local',
        'codex_done',
        'Codex finished in studio',
        'studio',
        'The test run is ready on your Mac.',
      ],
    ];
    db.exec('BEGIN');
    try {
      for (const [i, [source, kind, title, group, body]] of examples.entries()) {
        const id = source + ':' + i;
        const url = source === 'github' ? 'https://github.com/notifications' : null;
        const row = {
          id,
          source,
          kind,
          title,
          group,
          body,
          url,
          time: Date.now() - (i + 1) * 540000,
          pinned: i === 0,
          unread: i !== 2,
          archived: false,
          until: null,
        };
        db.prepare('INSERT INTO demo VALUES (?, ?)').run(id, JSON.stringify(row));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    items: () =>
      db
        .prepare('SELECT item FROM demo')
        .all()
        .map((row) => JSON.parse(row.item)),
    act({ id, verb, until }) {
      const found = db.prepare('SELECT item FROM demo WHERE id = ?').get(id);
      if (!found) throw new RequestError(404, 'Item no longer available.');
      const row = JSON.parse(found.item);
      switch (verb) {
        case 'read':
        case 'unread':
          row.unread = verb === 'unread';
          break;
        case 'pin':
        case 'unpin':
          row.pinned = verb === 'pin';
          break;
        case 'archive':
        case 'done':
          row.archived = true;
          row.until = null;
          break;
        case 'restore':
          row.archived = false;
          break;
        case 'snooze':
          row.until = until;
          break;
        default:
          throw new RequestError(400, 'Unknown action.');
      }
      db.prepare('UPDATE demo SET item = ? WHERE id = ?').run(JSON.stringify(row), id);
    },
  };
}

export function validateAction(action) {
  if (
    !action ||
    typeof action.id !== 'string' ||
    !action.id ||
    action.id.length > 4096 ||
    !['read', 'unread', 'pin', 'unpin', 'done', 'archive', 'restore', 'snooze'].includes(
      action.verb,
    )
  ) {
    throw new RequestError(400, 'Invalid inbox action.');
  }
  if (
    action.verb === 'snooze' &&
    !(
      Number.isFinite(action.until) &&
      action.until > Date.now() &&
      action.until <= Date.now() + 366 * 86400000
    )
  )
    throw new RequestError(400, 'Choose a future snooze time.');
  return {
    id: action.id,
    verb: action.verb,
    until: action.verb === 'snooze' ? action.until : undefined,
  };
}
