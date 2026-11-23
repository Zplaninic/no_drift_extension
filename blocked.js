const site = new URLSearchParams(location.search).get('site') ?? '';
const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');

function format(ms) {
  const total = Math.ceil(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

async function unlock() {
  // Make sure the background has dropped the redirect rule before navigating back.
  await chrome.runtime.sendMessage({ type: 'getLocks' });
  location.replace(`https://${site}`);
}

async function main() {
  $('site').textContent = site;
  const { locks = {} } = await chrome.storage.local.get('locks');
  const until = locks[site]?.until;
  if (!site || !until) return site ? unlock() : undefined;

  $('until').textContent = `Unlocks ${new Date(until).toLocaleString()}`;

  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) {
      clearInterval(timer);
      unlock();
      return;
    }
    $('countdown').textContent = format(left);
  };
  const timer = setInterval(tick, 500);
  tick();

  // React to the lock being removed or extended from the popup.
  let handled = false;
  chrome.storage.onChanged.addListener((changes) => {
    if (handled || !changes.locks) return;
    const next = changes.locks.newValue?.[site]?.until;
    if (next === until) return;
    handled = true;
    clearInterval(timer);
    if (next) location.reload();
    else unlock();
  });
}

main();
