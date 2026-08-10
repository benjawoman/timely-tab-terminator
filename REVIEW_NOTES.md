# Notes for Mozilla Reviewers

## Source Code

The submitted ZIP file IS the source code. There is no build process, no bundler, no minification, and no compilation step. All files are plain, human-readable HTML, CSS, and JavaScript.

### File Overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Event page — tracks per-tab timestamps, runs periodic cleanup via `browser.alarms`, handles messages from the popup |
| `popup.html` | Toolbar popup markup |
| `popup.css` | Popup styles (CSS custom properties for dark/light mode) |
| `popup.js` | Popup logic — loads/saves settings, renders tab list, handles user interactions |

### To Review

1. Unzip the submitted archive
2. Open any `.js` file in a text editor — no transpilation or deobfuscation needed
3. The extension makes zero network requests; all data is stored in `browser.storage.local`

## AI Assistance Disclosure

This extension was developed with the assistance of Claude (Anthropic), an AI coding assistant. The code was generated collaboratively through an interactive session and reviewed by the developer. All logic, permissions, and data handling reflect the developer's intent and have been verified to match the stated functionality.

The source code is fully readable and auditable as-is.

## Permissions Justification

| Permission | Reason |
|---|---|
| `tabs` | Read tab URLs, titles, and active state to track idle time and match against the whitelist |
| `storage` | Persist per-tab timestamps and user settings (idle limit, threshold, whitelist, theme) in `browser.storage.local` |
| `alarms` | Run the cleanup sweep every minute in the background without requiring a persistent background page |
