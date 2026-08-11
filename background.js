/* Timely Tab Terminator — background script (Manifest V3 event page).
 *
 * IMPORTANT DESIGN NOTES:
 * - In Manifest V3, Firefox runs this as a NON-PERSISTENT event page:
 *   it is switched off when idle and ALL in-memory variables are lost.
 *   Therefore nothing important is ever kept in memory here.
 * - Tab open-time ("createdAt") is stored ON THE TAB ITSELF using
 *   browser.sessions.setTabValue(). This survives tab unloading,
 *   close/restore (Ctrl+Shift+T), and browser restarts with session
 *   restore.
 * - Idle time comes from Firefox's own tab.lastAccessed timestamp,
 *   which Firefox maintains for us across unloads and restarts.
 */

const ALARM_NAME = "tab-cleaner-sweep";
const SWEEP_PERIOD_MINUTES = 1;
const CREATED_AT_KEY = "ttt.createdAt";

const CLOSE_COUNT_THRESHOLD = 5;
const CLOSE_PERCENT_THRESHOLD = 0.2;

/* ---------- settings ---------- */

async function getSettings() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function nowMs() {
  return Date.now();
}

/* ---------- whitelist ---------- */

function isWhitelisted(url, whitelist) {
  if (!url) return false;
  const host = hostnameOf(url);
  if (!host) {
    // Non-http pages (about:, moz-extension:, file:) are always protected.
    return true;
  }
  return whitelist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    const h = host.toLowerCase();
    return h === e || h.endsWith("." + e);
  });
}

/* ---------- per-tab open-time (survives unload + restart) ---------- */

async function getCreatedAt(tabId) {
  try {
    const value = await browser.sessions.getTabValue(tabId, CREATED_AT_KEY);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  } catch (e) {
    // Tab no longer exists, or the sessions API is unavailable.
  }
  return null;
}

async function setCreatedAt(tabId, timestamp) {
  try {
    await browser.sessions.setTabValue(tabId, CREATED_AT_KEY, timestamp);
  } catch (e) {
    console.warn("Timely Tab Terminator: could not store tab open-time", e);
  }
}

// Makes sure a tab has an open-time. Restored tabs (session restore or
// Ctrl+Shift+T) already carry their original value; only tabs that have
// none get stamped.
async function ensureCreatedAt(tab, now = nowMs()) {
  const existing = await getCreatedAt(tab.id);
  if (existing != null) return existing;

  // Seed value: Firefox's lastAccessed is the best available hint for
  // when an already-existing/restored tab was opened.
  let seed = now;
  if (
    typeof tab.lastAccessed === "number" &&
    tab.lastAccessed > 0 &&
    tab.lastAccessed <= now
  ) {
    seed = tab.lastAccessed;
  }
  await setCreatedAt(tab.id, seed);
  return seed;
}

/* ---------- tab info (open-time + idle time) ---------- */

async function getTabInfo(tabs, now = nowMs()) {
  const info = new Map();
  await Promise.all(
    tabs.map(async (tab) => {
      const created = await getCreatedAt(tab.id);
      const lastAccessed =
        typeof tab.lastAccessed === "number" ? tab.lastAccessed : now;
      info.set(tab.id, {
        createdAt: created ?? now,
        idleMs: tab.active ? 0 : Math.max(0, now - lastAccessed),
        discarded: Boolean(tab.discarded)
      });
    })
  );
  return info;
}

/* ---------- deciding which tabs may be closed ---------- */

function buildExcluder(settings, activeByWindow) {
  return function isExcluded(tab) {
    if (activeByWindow.has(`${tab.windowId}:${tab.id}`)) return true;
    if (!settings.closePinned && tab.pinned) return true;
    if (!settings.closeAudible && tab.audible) return true;
    if (tab.groupId != null && tab.groupId !== -1) return true;
    if (isWhitelisted(tab.url, settings.whitelist)) return true;
    return false;
  };
}

// Single source of truth for "which tabs should close". Used by the
// automatic sweep, the "Run now" preview, and the confirmed run, so the
// number shown in the confirmation dialog always matches the logic that
// actually runs.
async function computeTabsToClose(settings, tabs, now, includeHardAge) {
  const info = await getTabInfo(tabs, now);
  const activeByWindow = new Set(
    tabs.filter((t) => t.active).map((t) => `${t.windowId}:${t.id}`)
  );
  const isExcluded = buildExcluder(settings, activeByWindow);
  const toClose = new Set();

  // 1) Hard age limit: close tabs that have been OPEN longer than the
  //    limit, no matter how recently they were used.
  if (includeHardAge && settings.hardMaxAgeEnabled) {
    const hardCutoff = now - settings.hardMaxAgeMinutes * 60 * 1000;
    for (const tab of tabs) {
      if (isExcluded(tab)) continue;
      if (info.get(tab.id).createdAt <= hardCutoff) toClose.add(tab.id);
    }
  }

  // 2) Idle limit + tab-count threshold.
  //    threshold = 0 means "no floor": close every idle-enough tab.
  const idleLimitMs = settings.maxAgeMinutes * 60 * 1000;

  if (settings.tabThreshold === 0) {
    for (const tab of tabs) {
      if (isExcluded(tab)) continue;
      if (info.get(tab.id).idleMs >= idleLimitMs) toClose.add(tab.id);
    }
  } else if (tabs.length > settings.tabThreshold) {
    const candidates = [];
    for (const tab of tabs) {
      if (isExcluded(tab)) continue;
      const tabInfo = info.get(tab.id);
      if (tabInfo.idleMs >= idleLimitMs) {
        candidates.push({ id: tab.id, idleMs: tabInfo.idleMs });
      }
    }
    candidates.sort((a, b) => b.idleMs - a.idleMs); // most-idle first
    const overage = tabs.length - settings.tabThreshold;
    for (const c of candidates.slice(0, overage)) toClose.add(c.id);
  }

  return toClose;
}

function needsConfirmation(tabsToCloseCount, totalTabs) {
  if (tabsToCloseCount === 0) return false;
  return (
    tabsToCloseCount >= CLOSE_COUNT_THRESHOLD ||
    (totalTabs > 0 && tabsToCloseCount / totalTabs > CLOSE_PERCENT_THRESHOLD)
  );
}

/* ---------- closing tabs ---------- */

async function removeTabs(ids) {
  if (ids.size === 0) return 0;
  const idArray = [...ids];
  const results = await Promise.allSettled(
    idArray.map((id) => browser.tabs.remove(id))
  );
  let closed = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      closed += 1;
    } else {
      console.warn(
        "Timely Tab Terminator: failed to close tab",
        idArray[i],
        result.reason
      );
    }
  });
  // NOTE: we deliberately do NOT erase session values for closed tabs.
  // Keeping them means a tab restored with Ctrl+Shift+T keeps its age.
  return closed;
}

/* ---------- automatic sweep (runs on the alarm) ---------- */

async function sweep() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const tabs = await browser.tabs.query({});
  if (tabs.length === 0) return;

  // Automatic sweeps use only the idle/threshold rules (no hard age).
  const toClose = await computeTabsToClose(settings, tabs, nowMs(), false);
  await removeTabs(toClose);
}

/* ---------- startup / install ---------- */

async function initializeTabs() {
  const tabs = await browser.tabs.query({});
  const now = nowMs();
  await Promise.all(tabs.map((tab) => ensureCreatedAt(tab, now)));
}

async function ensureAlarm() {
  const existing = await browser.alarms.get(ALARM_NAME);
  if (!existing) {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_PERIOD_MINUTES });
  }
}

browser.runtime.onInstalled.addListener(async () => {
  const stored = await browser.storage.local.get(DEFAULTS);
  await browser.storage.local.set({ ...DEFAULTS, ...stored });
  // Remove leftovers from the old implementation, which stored
  // timestamps keyed by tab id (unreliable; no longer used).
  await browser.storage.local.remove(["lastActive", "createdAt"]);
  await initializeTabs();
  await ensureAlarm();
});

browser.runtime.onStartup.addListener(async () => {
  await initializeTabs();
  await ensureAlarm();
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await sweep();
});

// New tabs — including tabs being restored after a restart or via
// Ctrl+Shift+T. Restored tabs already carry their original open-time,
// so ensureCreatedAt() only stamps genuinely new tabs.
browser.tabs.onCreated.addListener(async (tab) => {
  await ensureCreatedAt(tab);
});

// Tabs moved between windows can lose their session data; re-stamp.
browser.tabs.onAttached.addListener(async (tabId) => {
  try {
    const tab = await browser.tabs.get(tabId);
    await ensureCreatedAt(tab);
  } catch (e) {
    // Tab already gone; nothing to do.
  }
});

/* ---------- messages from the popup ---------- */

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object" || !msg.type) return;

  if (msg.type === "getTabsState") {
    return (async () => {
      const tabs = await browser.tabs.query({});
      const info = await getTabInfo(tabs, nowMs());
      const createdAt = {};
      const idleMs = {};
      const discarded = {};
      for (const tab of tabs) {
        const tabInfo = info.get(tab.id);
        createdAt[tab.id] = tabInfo.createdAt;
        idleMs[tab.id] = tabInfo.idleMs;
        discarded[tab.id] = tabInfo.discarded;
      }
      return { createdAt, idleMs, discarded };
    })();
  }

  // Manual "Run now". This works even when the automatic "Enabled"
  // switch is off — the switch only controls the automatic sweep.
  // Hard-age closing only ever happens here, never automatically.
  if (msg.type === "runSweepNow" || msg.type === "confirmAndRunSweep") {
    return (async () => {
      const settings = await getSettings();
      const tabs = await browser.tabs.query({});
      const now = nowMs();
      const toClose = await computeTabsToClose(settings, tabs, now, true);

      if (
        msg.type === "runSweepNow" &&
        needsConfirmation(toClose.size, tabs.length)
      ) {
        return { needsConfirmation: true, count: toClose.size, total: tabs.length };
      }

      const closed = await removeTabs(toClose);
      return { ok: true, closed };
    })();
  }

  // Unknown message type: no response.
});