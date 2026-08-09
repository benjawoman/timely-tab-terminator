# Timely Tab Cleaner (TTT)

A Firefox extension that automatically closes idle tabs to keep your browser clean, with a whitelist, tab-count threshold, and dark/light mode.

## Features

- **Auto-cleanup** — closes tabs that have been idle longer than a configurable limit, running silently in the background every minute
- **Tab threshold** — only triggers cleanup when you're over a set number of open tabs; set to `0` to always close idle tabs regardless of count
- **One-time sweep** — "Run Now" button closes all tabs idle beyond a separate hard limit, ignoring the tab count entirely
- **Whitelist** — domains listed here are never closed; subdomains are matched automatically (`example.com` also protects `app.example.com`)
- **Current tab info** — shows the active tab's hostname and how long ago it was opened
- **Open tab list** — scrollable list of all tabs sorted by idle time, with whitelisted tabs marked ★
- **Pinned & audible tab protection** — optionally include or exclude pinned tabs and tabs playing audio
- **Dark / light mode** — toggle with the 🌙 / ☀️ button; preference is saved
- **Support for Tab Groups** *(New!)* — tabs in a tab group are never closed automatically. A collapsible groups section in the popup lets you view each group and how long its tabs have been open.

## Installation

### From Firefox Add-ons (AMO)

Search for **Timely Tab Cleaner** on [addons.mozilla.org](https://addons.mozilla.org) or install directly from the listing page.

### Manual (temporary, for development)

1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select any file inside the `firefox-tab-cleaner/` folder (e.g. `manifest.json`)

Temporary installs are removed when Firefox closes. For a persistent install, use the signed version from AMO.

## Settings

| Setting | Description |
|---|---|
| **Enabled** | Enable or disable all automatic cleanup |
| **Idle limit** | Minutes a tab must be idle before it's eligible for cleanup |
| **Keep at least** | Minimum number of tabs to keep open; set to `0` for no floor |
| **Pinned** | If checked, pinned tabs are eligible for cleanup |
| **Audible** | If checked, tabs playing audio are eligible for cleanup |
| **On Run Now, also close idle** | When manually triggering cleanup, also close any tab idle longer than this many minutes, regardless of tab count |
| **Whitelist** | One hostname per line; matching tabs are never closed |

## Privacy

Timely Tab Cleaner collects no user data. All information (tab timestamps, settings, whitelist) is stored locally in `browser.storage.local` and never transmitted anywhere. No analytics, no external requests.

## Requirements

- Firefox 140 or later

## License

MIT
