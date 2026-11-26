const $ = (id) => document.getElementById(id);
const labels = { github: 'GitHub', linear: 'Linear', ntfy: 'ntfy', local: 'Local' };
const marks = { github: 'Gh', linear: 'Li', ntfy: 'nt', local: '>_' };
let data,
  tab = 'Inbox',
  busy = false,
  revision = 0,
  registration;
const elem = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const signal = (text) => {
  $('message').textContent = text;
};
function groupOf(item) {
  return item.archived ? 'Archive' : item.until > Date.now() ? 'Snoozed' : 'Inbox';
}
function label(item) {
  if (item.source === 'local' && item.kind.startsWith('claude_')) return 'Claude Code';
  if (item.source === 'local' && item.kind.startsWith('codex_')) return 'Codex';
  return labels[item.source] || item.source;
}
function safeLink(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function age(time) {
  const min = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (min === 0) return 'now';
  if (min < 60) return min + 'm';
  if (min < 1440) return Math.floor(min / 60) + 'h';
  return Math.floor(min / 1440) + 'd';
}
async function api(route, body) {
  const response = await fetch('/api/' + route, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) unpaired();
    throw new Error(value.error);
  }
  return value;
}
function unpaired() {
  revision++;
  data = undefined;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['rows', 'detail-content', 'repo', 'source', 'mode']) $(id).replaceChildren();
  $('inbox').hidden = $('settings').hidden = true;
  $('pair').hidden = false;
  navigator.clearAppBadge?.().catch(() => {});
}
function choices(select, choices, all) {
  const saved = select.value;
  select.replaceChildren(new Option(all, ''));
  for (const [value, title] of choices) select.add(new Option(title, value));
  if (choices.some(([value]) => value === saved)) select.value = saved;
}
function render() {
  if (!data) return;
  $('pair').hidden = true;
  $('inbox').hidden = $('settings').hidden = false;
  $('mode').textContent = data.demo ? 'Sample inbox' : 'Mac companion';
  $('heading').replaceChildren(tab, elem('span', '.'));
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
  }
  const total = data.items.filter((i) => i.unread && groupOf(i) === 'Inbox').length;
  $('count').textContent = total;
  navigator.setAppBadge?.(total).catch(() => {});
  choices($('source'), Object.entries(labels), 'All sources');
  const repos = [
    ...new Set(data.items.filter((i) => i.source === 'github' && i.group).map((i) => i.group)),
  ].sort();
  choices(
    $('repo'),
    repos.map((r) => [r, r]),
    'All repos',
  );
  const useRepo = !$('source').value || $('source').value === 'github';
  $('repo-label').hidden = !useRepo;
  const rows = data.items.filter(
    (i) =>
      groupOf(i) === tab &&
      (!$('source').value || i.source === $('source').value) &&
      (!useRepo || !$('repo').value || (i.source === 'github' && i.group === $('repo').value)),
  );
  rows.sort((a, b) => (tab === 'Snoozed' ? a.until - b.until : b.time - a.time));
  const focused = document.activeElement?.dataset.item;
  const container = $('rows');
  container.replaceChildren();
  if (!rows.length) container.append(elem('p', 'No items in this view.', 'empty'));
  for (const pinned of [true, false]) {
    const group = rows.filter((i) => i.pinned === pinned);
    if (!group.length) continue;
    const header = elem('h2', pinned ? 'Pinned' : tab === 'Inbox' ? 'Queue' : tab, 'section-title');
    header.append(elem('b', group.length));
    container.append(header);
    for (const item of group) {
      const row = elem('button', null, 'row' + (pinned ? ' pinned' : ''));
      row.dataset.item = item.id;
      row.setAttribute(
        'aria-label',
        [label(item), item.title, item.unread ? 'unread' : 'read'].join(', '),
      );
      const mark = elem('span', marks[item.source], 'mark ' + item.source);
      mark.setAttribute('aria-hidden', 'true');
      const middle = elem('span');
      middle.append(elem('span', label(item), 'source-line'), elem('strong', item.title));
      if (item.group) middle.append(elem('small', item.group));
      const tail = elem('span', tab === 'Snoozed' ? 'Later' : age(item.time), 'row-end');
      if (item.unread) tail.append(elem('span', null, 'dot'));
      row.append(mark, middle, tail);
      row.onclick = () => showDetail(item);
      container.append(row);
      if (focused === item.id) row.focus({ preventScroll: true });
    }
  }
}
async function refresh(manual = false) {
  const request = ++revision;
  try {
    const result = await api('inbox');
    if (request !== revision) return;
    data = result;
    render();
    if (manual || !$('retry').hidden) signal(manual ? 'Inbox refreshed.' : '');
    $('retry').hidden = true;
  } catch (error) {
    if (request !== revision) return;
    signal(
      error.message === 'Failed to fetch' || !navigator.onLine
        ? 'Offline. Reconnect to your Mac to triage.'
        : error.message,
    );
    $('retry').hidden = false;
    // A failed fetch must never look like an empty inbox.
    if (data) $('rows').inert = true;
  } finally {
    if (request === revision && data && $('retry').hidden) $('rows').inert = false;
  }
}
function showDetail(item) {
  const content = $('detail-content');
  content.replaceChildren(elem('div', label(item), 'eyebrow'), elem('h2', item.title));
  if (item.group) content.append(elem('p', item.group, 'source-line'));
  if (item.body) content.append(elem('p', item.body));
  if (item.until > Date.now())
    content.append(elem('p', 'Snoozed until ' + new Date(item.until).toLocaleString()));
  if (!safeLink(item.url) && item.source === 'local')
    content.append(elem('p', 'Continue this session on your Mac.', 'fine'));
  const actions = elem('div', null, 'actions');
  const add = (title, verb) => {
    const button = elem('button', title);
    button.onclick = () => act(item.id, verb);
    actions.append(button);
  };
  const url = safeLink(item.url);
  if (url) {
    const link = elem('a', 'Open source ↗', 'primary');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.onclick = () => {
      if (item.unread) act(item.id, 'read');
    };
    actions.append(link);
  }
  if (item.archived) add('Restore', 'restore');
  else {
    add('Mark done', 'done');
    add('Archive', 'archive');
  }
  add(item.unread ? 'Mark read' : 'Mark unread', item.unread ? 'read' : 'unread');
  add(item.pinned ? 'Unpin' : 'Pin', item.pinned ? 'unpin' : 'pin');
  content.append(actions);
  if (!item.archived) {
    const wrap = elem('label', 'Snooze');
    const select = elem('select');
    select.setAttribute('aria-label', 'Snooze');
    for (const [title, value] of [
      ['Choose a time', ''],
      ['15 minutes', '15'],
      ['1 hour', '60'],
      ['Tomorrow at 09:00', 'tomorrow'],
    ])
      select.add(new Option(title, value));
    select.onchange = () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      if (select.value)
        act(
          item.id,
          'snooze',
          select.value === 'tomorrow' ? +tomorrow : Date.now() + Number(select.value) * 60000,
        );
    };
    wrap.append(select);
    content.append(wrap);
  }
  if (!$('detail').open) $('detail').showModal();
}
async function act(id, verb, until) {
  if (busy) return;
  busy = true;
  revision++;
  $('detail-content').inert = true;
  try {
    await api('action', { id, verb, until });
    $('detail').close();
    await refresh();
    if ($('retry').hidden && data) {
      const text = {
        read: 'Marked read.',
        unread: 'Marked unread.',
        archive: 'Archived.',
        done: 'Marked done.',
        pin: 'Pinned.',
        unpin: 'Unpinned.',
        snooze: 'Snoozed.',
        restore: 'Restored.',
      };
      signal(text[verb]);
      if (['archive', 'done'].includes(verb)) {
        const undo = elem('button', 'Undo');
        undo.onclick = () => act(id, 'restore');
        $('message').append(undo);
        undo.focus({ preventScroll: true });
      }
    }
  } catch (error) {
    $('detail').close();
    await refresh();
    signal(error.message);
  } finally {
    busy = false;
    $('detail-content').inert = false;
  }
}
$('pair-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api('pair', { code: $('code').value });
    $('code').value = '';
    $('pair').hidden = true;
    signal('');
    await refresh();
  } catch (error) {
    signal(error.message);
  }
};
document.querySelectorAll('.close').forEach((button) => {
  button.onclick = () => button.closest('dialog').close();
});
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.onclick = () => {
    tab = button.dataset.tab;
    signal('');
    render();
  };
});
$('refresh').onclick = $('retry').onclick = () => refresh(true);
$('source').onchange = $('repo').onchange = render;
if ('serviceWorker' in navigator)
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      registration = reg;
    })
    .catch(() => {});
function preferences() {
  const capable = registration && 'PushManager' in window && 'Notification' in window;
  $('push-info').textContent = !capable
    ? 'For iPhone notifications, add this app to your Home Screen and open it there.'
    : data.subscribed
      ? 'Push is enabled for this device.'
      : 'Receive a private alert when an unread item arrives.';
  $('push').hidden = !capable;
  $('push').textContent = data.subscribed ? 'Disable push' : 'Enable push';
  $('test-push').hidden = !capable || !data.subscribed;
}
$('settings').onclick = () => {
  preferences();
  $('preferences').showModal();
};
$('push').onclick = async () => {
  $('push').disabled = true;
  try {
    if (data.subscribed) {
      await api('unsubscribe', {});
      data.subscribed = false;
      await (await registration.pushManager.getSubscription())?.unsubscribe();
    } else {
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error('Allow notifications in system settings to receive push.');
      const key = Uint8Array.from(
        atob(data.publicKey.replaceAll('-', '+').replaceAll('_', '/')),
        (c) => c.charCodeAt(0),
      );
      let sub = await registration.pushManager.getSubscription();
      if (
        sub &&
        !new Uint8Array(sub.options.applicationServerKey).every((byte, i) => byte === key[i])
      ) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ||= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await api('subscribe', sub.toJSON());
      data.subscribed = true;
    }
    preferences();
  } catch (error) {
    $('push-info').textContent = error.message;
  } finally {
    $('push').disabled = false;
  }
};
$('test-push').onclick = async () => {
  try {
    await api('test-push', {});
    $('push-info').textContent = 'Push service accepted the test. Check Notification Centre.';
  } catch (error) {
    $('push-info').textContent = error.message;
  }
};
$('signout').onclick = async () => {
  try {
    await api('sign-out', {});
    unpaired();
    signal('Device unpaired.');
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch (error) {
    if ($('preferences').open) $('push-info').textContent = error.message;
  }
};
function resume() {
  if (!document.hidden && !busy && !$('detail').open && !$('preferences').open && $('pair').hidden)
    refresh();
}
document.addEventListener('visibilitychange', resume);
window.addEventListener('online', resume);
setInterval(resume, 30000);
refresh();
