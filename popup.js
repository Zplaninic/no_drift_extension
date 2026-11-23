const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const UNLOCK_DELAY = 10_000;

let locks = {};
let selected = '60';
let pending = null; // { domain, readyAt } while an early unlock is counting down
let pointerDown = false;

function button(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function formatLeft(ms) {
  const total = Math.ceil(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatAt(ts) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

// datetime-local wants local "YYYY-MM-DDTHH:mm"
const toLocalInput = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function targetTime() {
  if (selected !== 'custom') return Date.now() + Number(selected) * 60_000;
  const value = $('until').value;
  return value ? new Date(value).getTime() : NaN;
}

function renderSubmit() {
  const until = targetTime();
  $('submit').textContent = Number.isFinite(until) ? `Lock until ${formatAt(until)}` : 'Lock';
}

function selectDuration(value) {
  selected = value;
  for (const btn of $('durations').children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.min === value));
  }
  const custom = value === 'custom';
  $('until').hidden = !custom;
  if (custom) {
    $('until').min = toLocalInput(Date.now());
    if (!$('until').value) $('until').value = toLocalInput(Date.now() + 3600_000);
    $('until').focus();
  }
  renderSubmit();
}

function renderLocks() {
  const now = Date.now();
  const entries = Object.entries(locks)
    .filter(([, l]) => l.until > now)
    .sort((a, b) => a[1].until - b[1].until);

  $('empty').hidden = entries.length > 0;
  $('locks').replaceChildren(
    ...entries.map(([domain, { until }]) => {
      const li = document.createElement('li');
      li.title = 'Click to extend';
      li.addEventListener('click', () => {
        $('domain').value = domain;
        $('domain').focus();
      });

      const name = document.createElement('span');
      name.className = 'domain';
      name.textContent = domain;

      const left = document.createElement('span');
      left.className = 'left';
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = formatLeft(until - now);
      const at = document.createElement('div');
      at.className = 'at';
      at.textContent = `until ${formatAt(until)}`;
      left.append(time, at);

      const actions = document.createElement('span');
      actions.className = 'actions';
      if (pending?.domain === domain) {
        const wait = Math.ceil((pending.readyAt - now) / 1000);
        const confirm = button(wait > 0 ? `Wait ${wait}s` : 'Confirm unlock', async () => {
          pending = null;
          await chrome.runtime.sendMessage({ type: 'removeLock', domain });
          await refresh();
        });
        confirm.className = 'danger';
        confirm.disabled = wait > 0;
        const cancel = button('Cancel', () => {
          pending = null;
          renderLocks();
        });
        actions.append(confirm, cancel);
        li.append(name, actions);
      } else {
        actions.append(
          button('Unlock', () => {
            pending = { domain, readyAt: Date.now() + UNLOCK_DELAY };
            renderLocks();
          }),
        );
        li.append(name, left, actions);
      }
      return li;
    }),
  );

  // An entry just expired: let the background drop it.
  if (entries.length !== Object.keys(locks).length) refresh();
}

async function refresh() {
  locks = (await chrome.runtime.sendMessage({ type: 'getLocks' })) ?? {};
  renderLocks();
}

async function currentTabDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  const url = new URL(tab.url);
  // On our own blocked page the real site is in the query string.
  if (url.origin === location.origin) return url.searchParams.get('site');
  return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, '') : null;
}

$('durations').addEventListener('click', (e) => {
  const value = e.target.dataset?.min;
  if (value) selectDuration(value);
});

$('until').addEventListener('input', renderSubmit);

$('current').addEventListener('click', async () => {
  const domain = await currentTabDomain();
  if (domain) $('domain').value = domain;
  else $('error').textContent = 'Current tab is not a website';
});

$('domain').addEventListener('input', () => {
  $('error').textContent = '';
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').textContent = '';
  const res = await chrome.runtime.sendMessage({
    type: 'addLock',
    domain: $('domain').value,
    until: targetTime(),
  });
  if (!res?.ok) {
    $('error').textContent = res?.error ?? 'Something went wrong';
    return;
  }
  $('domain').value = '';
  await refresh();
});

selectDuration(selected);
refresh();
// The list is rebuilt every tick; skip while a press is in progress so clicks aren't lost.
document.addEventListener('pointerdown', () => (pointerDown = true));
document.addEventListener('pointerup', () => (pointerDown = false));
document.addEventListener('pointercancel', () => (pointerDown = false));

setInterval(() => {
  if (!pointerDown) renderLocks();
  renderSubmit();
}, 1000);
