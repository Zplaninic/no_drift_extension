# No Drift

Chrome extension that time-locks websites. Pick a domain and an unlock time; until then every visit to that domain (and its subdomains) lands on a countdown page. Locks can be extended but not shortened; removing one early takes a deliberate 10-second wait.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Pin the extension so the icon is one click away.

## Use

- Click the icon, type a domain (or **Current tab**), pick a duration or **Until…** for an exact date/time, then **Lock**.
- Click an active lock to load its domain into the form and extend it.
- **Unlock** on a lock starts a 10-second wait, then **Confirm unlock** removes it. Open blocked tabs return to the site.

## Notes

- Incognito windows are only covered if you enable **Allow in Incognito** in the extension's details page.
- Disabling or removing the extension in `chrome://extensions` lifts all blocks.
- No build step: plain JS, Manifest V3. Blocking uses `declarativeNetRequest` redirect rules; expiry uses `chrome.alarms`.
