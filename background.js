const ALARM = 'next-unlock';
const BLOCKED_PATH = '/blocked.html';

const getLocks = async () => (await chrome.storage.local.get('locks')).locks ?? {};
const setLocks = (locks) => chrome.storage.local.set({ locks });

function normalizeDomain(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

const matchLock = (locks, hostname) =>
  Object.keys(locks).find((d) => hostname === d || hostname.endsWith(`.${d}`));

const blockedUrl = (domain) =>
  chrome.runtime.getURL(`${BLOCKED_PATH}?site=${encodeURIComponent(domain)}`);

// Serialize mutations so concurrent syncs can't produce clashing rule ids.
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

async function syncNow() {
  const locks = await getLocks();
  const now = Date.now();
  for (const [domain, lock] of Object.entries(locks)) {
    if (lock.until <= now) delete locks[domain];
  }
  await setLocks(locks);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: Object.keys(locks).map((domain, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: `${BLOCKED_PATH}?site=${encodeURIComponent(domain)}` },
      },
      // requestDomains also matches subdomains
      condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
    })),
  });

  await chrome.alarms.clear(ALARM);
  const untils = Object.values(locks).map((l) => l.until);
  if (untils.length) chrome.alarms.create(ALARM, { when: Math.min(...untils) });

  return locks;
}

const sync = () => enqueue(syncNow);

async function sweepTabs(locks) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) redirectIfLocked(tab.id, tab.url, locks);
}

function redirectIfLocked(tabId, url, locks) {
  if (!url?.startsWith('http')) return;
  const domain = matchLock(locks, new URL(url).hostname);
  if (domain) chrome.tabs.update(tabId, { url: blockedUrl(domain) }).catch(() => {});
}

// `until` is epoch ms. Existing locks can only be extended, never shortened.
async function addLock(input, until) {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, error: 'Invalid domain' };
  if (!Number.isFinite(until) || until <= Date.now()) {
    return { ok: false, error: 'Unlock time must be in the future' };
  }

  const locks = await enqueue(async () => {
    const current = await getLocks();
    current[domain] = { until: Math.max(until, current[domain]?.until ?? 0) };
    await setLocks(current);
    return syncNow();
  });
  await sweepTabs(locks);
  return { ok: true, domain, until: locks[domain].until };
}

async function removeLock(domain) {
  const removed = await enqueue(async () => {
    const current = await getLocks();
    if (!current[domain]) return false;
    delete current[domain];
    await setLocks(current);
    await syncNow();
    return true;
  });
  return removed ? { ok: true } : { ok: false, error: 'No such lock' };
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) sync();
});

// Catches tabs that were already open and pages served without a network request.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  redirectIfLocked(tabId, changeInfo.url, await getLocks());
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'addLock') {
    addLock(msg.domain, msg.until).then(sendResponse);
    return true;
  }
  if (msg?.type === 'removeLock') {
    removeLock(msg.domain).then(sendResponse);
    return true;
  }
  if (msg?.type === 'getLocks') {
    sync().then(sendResponse);
    return true;
  }
});

// Exposed for debugging from the service worker console.
Object.assign(self, { addLock, removeLock, getLocks, sync });
