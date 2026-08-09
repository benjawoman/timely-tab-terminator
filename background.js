const DEFAULTS = {
  enabled: true,
  maxAgeMinutes: 60,
  tabThreshold: 20,
  whitelist: [],
  closePinned: false,
  closeAudible: false,
  hardMaxAgeEnabled: false,
  hardMaxAgeMinutes: 10
};

const ALARM_NAME = "tab-cleaner-sweep";
const SWEEP_PERIOD_MINUTES = 1;
const SAVE_DEBOUNCE_MS = 500;

// Per-tab timestamps (ms). Persisted so they survive browser restarts.
let lastActive = {};
let createdAt = {};
let saveDebounceTimer = null;
let stateLoaded = false;

async function loadState() {
  if (stateLoaded) return;
  const stored = await browser.storage.local.get(["lastActive", "createdAt"]);
  lastActive = stored.lastActive || {};
  createdAt = stored.createdAt || {};
  stateLoaded = true;
}

async function saveState() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(async () => {
    await browser.storage.local.set({ lastActive, createdAt });
    saveDebounceTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

// Force immediate save when needed (e.g., before extension suspension)
async function saveStateImmediate() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  await browser.storage.local.set({ lastActive, createdAt });
}

async function getSettings() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function nowMs() {
  return Date.now();
}

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

async function touchTab(tabId) {
  lastActive[tabId] = nowMs();
  saveState(); // Debounced, no await needed for frequent calls
}

async function initializeTabs() {
  const tabs = await browser.tabs.query({});
  const now = nowMs();
  
  for (const t of tabs) {
    if (lastActive[t.id] == null) lastActive[t.id] = now;
    // Preserve createdAt across sessions - only set if not already present
    if (createdAt[t.id] == null) createdAt[t.id] = now;
  }
  
  // Drop stale ids no longer present.
  const liveIds = new Set(tabs.map((t) => t.id));
  for (const id of Object.keys(lastActive)) {
    if (!liveIds.has(Number(id))) delete lastActive[id];
  }
  for (const id of Object.keys(createdAt)) {
    if (!liveIds.has(Number(id))) delete createdAt[id];
  }
  await saveStateImmediate();
}

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

async function removeTabs(ids) {
  if (ids.size === 0) return;
  try {
    await browser.tabs.remove([...ids]);
  } catch (e) {
    console.error("Timely Tab Cleaner: tabs.remove failed", e);
  }
  for (const id of ids) {
    delete lastActive[id];
    delete createdAt[id];
  }
  await saveStateImmediate();
}

// Runs on every alarm tick. Handles the threshold-based auto-cleanup.
// threshold=0 means no floor: close every eligible tab past maxAgeMinutes.
async function sweep() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const tabs = await browser.tabs.query({});
  
  // Early exit if no tabs to process
  if (tabs.length === 0) return;

  const now = nowMs();
  const activeByWindow = new Set(
    tabs.filter((t) => t.active).map((t) => `${t.windowId}:${t.id}`)
  );
  const isExcluded = buildExcluder(settings, activeByWindow);
  const softCutoff = now - settings.maxAgeMinutes * 60 * 1000;
  const toClose = new Set();

  if (settings.tabThreshold === 0) {
    // No minimum: close every eligible tab past the idle limit.
    for (const tab of tabs) {
      if (isExcluded(tab)) continue;
      const last = lastActive[tab.id] ?? now;
      if (last <= softCutoff) toClose.add(tab.id);
    }
  } else if (tabs.length > settings.tabThreshold) {
    // Over threshold: close oldest-idle tabs until back under the limit.
    const candidates = [];
    for (const tab of tabs) {
      if (isExcluded(tab)) continue;
      const last = lastActive[tab.id] ?? now;
      if (last <= softCutoff) candidates.push({ id: tab.id, last });
    }
    candidates.sort((a, b) => a.last - b.last);
    const overage = tabs.length - settings.tabThreshold;
    for (const c of candidates.slice(0, overage)) toClose.add(c.id);
  }

  await removeTabs(toClose);
}

// Runs only when the user clicks "Run now". Closes every eligible tab
// idle longer than hardMaxAgeMinutes, ignoring the tab count entirely.
async function sweepHardAge(settings, tabs) {
  if (!settings.hardMaxAgeEnabled) return;
  const now = nowMs();
  const hardCutoff = now - settings.hardMaxAgeMinutes * 60 * 1000;
  const activeByWindow = new Set(
    tabs.filter((t) => t.active).map((t) => `${t.windowId}:${t.id}`)
  );
  const isExcluded = buildExcluder(settings, activeByWindow);
  const toClose = new Set();
  for (const tab of tabs) {
    if (isExcluded(tab)) continue;
    const last = lastActive[tab.id] ?? now;
    if (last <= hardCutoff) toClose.add(tab.id);
  }
  await removeTabs(toClose);
}

// Calculate if confirmation is needed based on proportion of tabs to close
const CLOSE_COUNT_THRESHOLD = 5;
const CLOSE_PERCENT_THRESHOLD = 0.2;

function needsConfirmation(tabsToCloseCount, totalTabs) {
  if (tabsToCloseCount === 0) return false;
  // Confirm if closing 5 or more tabs OR more than 20% of total tabs
  return tabsToCloseCount >= CLOSE_COUNT_THRESHOLD || (totalTabs > 0 && tabsToCloseCount / totalTabs > CLOSE_PERCENT_THRESHOLD);
}

browser.runtime.onInstalled.addListener(async () => {
  const stored = await browser.storage.local.get(DEFAULTS);
  const merged = { ...DEFAULTS, ...stored };
  await browser.storage.local.set(merged);
  await initializeTabs();
  browser.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_PERIOD_MINUTES });
});

browser.runtime.onStartup.addListener(async () => {
  await initializeTabs();
  browser.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_PERIOD_MINUTES });
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await sweep();
});

browser.tabs.onCreated.addListener(async (tab) => {
  lastActive[tab.id] = nowMs();
  createdAt[tab.id] = nowMs();
  saveState(); // Debounced
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  touchTab(tabId); // Already debounced
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    touchTab(tabId); // Already debounced
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  delete lastActive[tabId];
  delete createdAt[tabId];
  saveState(); // Debounced
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg) return;
  if (msg.type === "runSweepNow") {
    const settings = await getSettings();
    const tabs = await browser.tabs.query({});
    
    // Calculate which tabs would be closed for confirmation
    const now = nowMs();
    const hardCutoff = settings.hardMaxAgeEnabled ? now - settings.hardMaxAgeMinutes * 60 * 1000 : Infinity;
    const softCutoff = now - settings.maxAgeMinutes * 60 * 1000;
    const activeByWindow = new Set(
      tabs.filter((t) => t.active).map((t) => `${t.windowId}:${t.id}`)
    );
    const isExcluded = buildExcluder(settings, activeByWindow);
    const toClose = new Set();
    
    // Check hard age tabs
    if (settings.hardMaxAgeEnabled) {
      for (const tab of tabs) {
        if (isExcluded(tab)) continue;
        const last = lastActive[tab.id] ?? now;
        if (last <= hardCutoff) toClose.add(tab.id);
      }
    }
    
    // Check threshold-based tabs
    if (settings.tabThreshold === 0) {
      for (const tab of tabs) {
        if (isExcluded(tab)) continue;
        const last = lastActive[tab.id] ?? now;
        if (last <= softCutoff) toClose.add(tab.id);
      }
    } else if (tabs.length > settings.tabThreshold) {
      const candidates = [];
      for (const tab of tabs) {
        if (isExcluded(tab)) continue;
        const last = lastActive[tab.id] ?? now;
        if (last <= softCutoff) candidates.push({ id: tab.id, last });
      }
      candidates.sort((a, b) => a.last - b.last);
      const overage = tabs.length - settings.tabThreshold;
      for (const c of candidates.slice(0, overage)) toClose.add(c.id);
    }
    
    // If confirmation needed, send details back to popup
    if (needsConfirmation(toClose.size, tabs.length)) {
      return { needsConfirmation: true, count: toClose.size, total: tabs.length };
    }
    
    // Proceed with cleanup if no confirmation needed
    await removeTabs(toClose);
    return { ok: true };
  }
  if (msg.type === "confirmAndRunSweep") {
    // User confirmed, proceed with cleanup
    const settings = await getSettings();
    const tabs = await browser.tabs.query({});
    await sweepHardAge(settings, tabs);
    await sweep();
    return { ok: true };
  }
  if (msg.type === "getTabsState") {
    return { lastActive, createdAt };
  }
});
