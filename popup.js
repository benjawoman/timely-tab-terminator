/* Timely Tab Terminator — popup script.
 * Uses DEFAULTS, hostnameOf(), formatDuration(), parseWhitelist() and
 * GROUP_COLORS from utils.js. */

const $ = (id) => document.getElementById(id);

// DOM element cache (filled by cacheElements()).
const elements = {};

function cacheElements() {
  elements.themeToggle = $("themeToggle");
  elements.enabled = $("enabled");
  elements.currentTabHost = $("currentTabHost");
  elements.currentTabAge = $("currentTabAge");
  elements.addToWhitelist = $("addToWhitelist");
  elements.maxAge = $("maxAge");
  elements.threshold = $("threshold");
  elements.closePinned = $("closePinned");
  elements.closeAudible = $("closeAudible");
  elements.hardMaxAgeEnabled = $("hardMaxAgeEnabled");
  elements.hardMaxAge = $("hardMaxAge");
  elements.tabCount = $("tabCount");
  elements.tabList = $("tabList");
  elements.groupCount = $("groupCount");
  elements.groupList = $("groupList");
  elements.whitelist = $("whitelist");
  elements.saveBtn = $("save");
  elements.sweepBtn = $("sweep");
  elements.status = $("status");
}

function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  elements.themeToggle.textContent = dark ? "☀️" : "🌙";
}

function isWhitelisted(host, whitelist) {
  if (!host) return false;
  const h = host.toLowerCase();
  return whitelist.some((e) => h === e || h.endsWith("." + e));
}

function flash(msg, isError = false) {
  const el = elements.status;
  el.textContent = msg;
  el.style.color = isError ? "#c4292c" : "#1d8b3a";
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 2000);
}

// Reads a whole number from an input field. Empty/invalid fields fall
// back to the default instead of silently becoming 0.
function readNumber(id, fallback, min) {
  const value = parseInt($(id).value, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, value);
}

// Asks the background for tab open-times / idle times. Never throws:
// if the background is unavailable we fall back to empty maps.
async function getTabsState() {
  try {
    const state = await browser.runtime.sendMessage({ type: "getTabsState" });
    if (state && state.createdAt) return state;
  } catch (e) {
    console.warn("Timely Tab Terminator: could not reach background script", e);
  }
  return { createdAt: {}, idleMs: {}, discarded: {} };
}

async function getGroups() {
  if (!browser.tabGroups) return [];
  try {
    return await browser.tabGroups.query({});
  } catch (e) {
    console.warn("Timely Tab Terminator: tabGroups query failed", e);
    return [];
  }
}

function renderCurrentTab(tab, state) {
  const host = hostnameOf(tab.url);
  elements.currentTabHost.textContent = host || tab.title || tab.url || "—";
  elements.currentTabHost.title = tab.url || "";

  const created = state.createdAt[tab.id];
  const idle = state.idleMs[tab.id];
  const parts = [
    created != null
      ? `Opened ${formatDuration(Date.now() - created)} ago`
      : "Opened recently"
  ];
  if (!tab.active && typeof idle === "number") {
    parts.push(`idle ${formatDuration(idle)}`);
  }
  if (state.discarded[tab.id]) parts.push("unloaded by Firefox");
  elements.currentTabAge.textContent = parts.join(" · ");

  elements.addToWhitelist.disabled = !host;
  elements.addToWhitelist.title = host
    ? `Add ${host} to the whitelist`
    : "Cannot whitelist this page type";
}

function renderTabList(tabs, state, whitelist) {
  elements.tabCount.textContent = `${tabs.length} open`;
  const list = elements.tabList;
  list.innerHTML = "";

  const now = Date.now();
  const rows = tabs.map((t) => {
    const created = state.createdAt[t.id];
    return {
      tab: t,
      openMs: created != null ? Math.max(0, now - created) : null,
      idleMs: t.active ? 0 : (state.idleMs[t.id] ?? 0)
    };
  });

  // Active tab last; otherwise longest-open first.
  rows.sort((a, b) => {
    if (a.tab.active !== b.tab.active) return a.tab.active ? 1 : -1;
    return (b.openMs ?? -1) - (a.openMs ?? -1);
  });

  for (const { tab, openMs, idleMs } of rows) {
    const li = document.createElement("li");
    if (tab.active) li.classList.add("active-tab");
    if (state.discarded[tab.id]) li.classList.add("discarded");

    const host = hostnameOf(tab.url);
    if (isWhitelisted(host, whitelist)) li.classList.add("whitelisted");
    if (tab.groupId != null && tab.groupId !== -1) li.classList.add("grouped-tab");

    const hostEl = document.createElement("span");
    hostEl.className = "tab-host";
    hostEl.textContent = host || tab.title || tab.url || "(blank)";
    hostEl.title = tab.title ? `${tab.title}\n${tab.url || ""}` : tab.url || "";

    const ageEl = document.createElement("span");
    ageEl.className = "tab-age";
    ageEl.textContent = tab.active
      ? "active"
      : openMs != null
        ? formatDuration(openMs)
        : "—";
    ageEl.title = tab.active
      ? "This is the currently selected tab"
      : `open: ${openMs != null ? formatDuration(openMs) : "unknown"}\nidle: ${formatDuration(idleMs)}${state.discarded[tab.id] ? "\nunloaded by Firefox (still open)" : ""}`;

    li.appendChild(hostEl);
    li.appendChild(ageEl);
    list.appendChild(li);
  }
}

function renderGroupList(tabs, groups, state) {
  const container = elements.groupList;
  container.innerHTML = "";

  const groupedTabs = tabs.filter((t) => t.groupId != null && t.groupId !== -1);
  if (groupedTabs.length === 0) {
    elements.groupCount.textContent = "0";
    const empty = document.createElement("p");
    empty.className = "group-empty";
    empty.textContent = "No tab groups";
    container.appendChild(empty);
    return;
  }

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const buckets = new Map();

  for (const tab of groupedTabs) {
    const list = buckets.get(tab.groupId) || [];
    list.push(tab);
    buckets.set(tab.groupId, list);
  }

  const now = Date.now();
  const entries = [...buckets.entries()].map(([groupId, groupTabs]) => {
    const meta = groupById.get(groupId);
    return {
      groupId,
      title: meta?.title || "Untitled group",
      color: meta?.color || "grey",
      tabs: groupTabs.sort((a, b) => {
        const aOpen = now - (state.createdAt[a.id] ?? now);
        const bOpen = now - (state.createdAt[b.id] ?? now);
        return bOpen - aOpen;
      })
    };
  });

  entries.sort((a, b) => a.title.localeCompare(b.title));
  elements.groupCount.textContent = `${entries.length}`;

  for (const entry of entries) {
    const details = document.createElement("details");
    details.className = "group-item";

    const summary = document.createElement("summary");
    summary.className = "group-summary";

    const swatch = document.createElement("span");
    swatch.className = "group-swatch";
    swatch.style.backgroundColor = GROUP_COLORS[entry.color] || GROUP_COLORS.grey;
    swatch.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "group-title";
    title.textContent = entry.title;

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${entry.tabs.length}`;

    summary.appendChild(swatch);
    summary.appendChild(title);
    summary.appendChild(count);
    details.appendChild(summary);

    const tabList = document.createElement("ul");
    tabList.className = "group-tab-list";

    for (const tab of entry.tabs) {
      const li = document.createElement("li");
      const host = hostnameOf(tab.url);

      const hostEl = document.createElement("span");
      hostEl.className = "tab-host";
      hostEl.textContent = host || tab.title || tab.url || "(blank)";
      hostEl.title = tab.title ? `${tab.title}\n${tab.url || ""}` : tab.url || "";

      const ageEl = document.createElement("span");
      ageEl.className = "tab-age";
      const created = state.createdAt[tab.id];
      ageEl.textContent = created != null ? formatDuration(now - created) : "recent";

      li.appendChild(hostEl);
      li.appendChild(ageEl);
      tabList.appendChild(li);
    }

    details.appendChild(tabList);
    container.appendChild(details);
  }
}

async function refreshViews(whitelist) {
  const [allTabs, state, groups] = await Promise.all([
    browser.tabs.query({}),
    getTabsState(),
    getGroups()
  ]);
  renderTabList(allTabs, state, whitelist ?? parseWhitelist(elements.whitelist.value));
  renderGroupList(allTabs, groups, state);
}

async function load() {
  cacheElements();

  const stored = await browser.storage.local.get(DEFAULTS);
  const s = { ...DEFAULTS, ...stored };

  applyTheme(s.theme === "dark");
  elements.enabled.checked = s.enabled;
  elements.maxAge.value = s.maxAgeMinutes;
  elements.threshold.value = s.tabThreshold;
  elements.closePinned.checked = s.closePinned;
  elements.closeAudible.checked = s.closeAudible;
  elements.hardMaxAgeEnabled.checked = s.hardMaxAgeEnabled;
  elements.hardMaxAge.value = s.hardMaxAgeMinutes;
  elements.hardMaxAge.disabled = !s.hardMaxAgeEnabled;
  elements.whitelist.value = (s.whitelist || []).join("\n");

  try {
    const [activeTabResult, allTabs, state, groups] = await Promise.all([
      browser.tabs.query({ active: true, currentWindow: true }),
      browser.tabs.query({}),
      getTabsState(),
      getGroups()
    ]);
    const activeTab = activeTabResult[0];

    if (activeTab) renderCurrentTab(activeTab, state);
    renderTabList(allTabs, state, s.whitelist || []);
    renderGroupList(allTabs, groups, state);
  } catch (e) {
    flash(`Could not load tab data: ${e.message}`, true);
  }
}

async function save() {
  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = "Saving...";

  try {
    const whitelist = parseWhitelist(elements.whitelist.value);
    await browser.storage.local.set({
      enabled: elements.enabled.checked,
      maxAgeMinutes: readNumber("maxAge", DEFAULTS.maxAgeMinutes, 1),
      tabThreshold: readNumber("threshold", DEFAULTS.tabThreshold, 0),
      closePinned: elements.closePinned.checked,
      closeAudible: elements.closeAudible.checked,
      hardMaxAgeEnabled: elements.hardMaxAgeEnabled.checked,
      hardMaxAgeMinutes: readNumber("hardMaxAge", DEFAULTS.hardMaxAgeMinutes, 1),
      whitelist
    });
    flash("Saved");
    await refreshViews(whitelist);
  } catch (e) {
    flash(`Save failed: ${e.message}`, true);
  } finally {
    elements.saveBtn.disabled = false;
    elements.saveBtn.textContent = "Save";
  }
}

async function sweepNow() {
  elements.sweepBtn.disabled = true;
  elements.sweepBtn.textContent = "Running...";

  try {
    await save();
    const result = await browser.runtime.sendMessage({ type: "runSweepNow" });

    if (result && result.needsConfirmation) {
      const pct = result.total > 0 ? Math.round((result.count / result.total) * 100) : 0;
      const confirmed = window.confirm(
        `About to close ${result.count} of ${result.total} tabs (${pct}%).\n\nDo you want to proceed?`
      );

      if (!confirmed) {
        flash("Cleanup cancelled");
        return;
      }

      await browser.runtime.sendMessage({ type: "confirmAndRunSweep" });
    }

    await refreshViews();
    if (result && typeof result.closed === "number") {
      flash(`Cleanup run — closed ${result.closed} tab${result.closed === 1 ? "" : "s"}`);
    } else {
      flash("Cleanup run");
    }
  } catch (e) {
    flash(`Cleanup failed: ${e.message}`, true);
  } finally {
    elements.sweepBtn.disabled = false;
    elements.sweepBtn.textContent = "Run now";
  }
}

async function addCurrentSiteToWhitelist() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const host = hostnameOf(tab.url);
  if (!host) return;

  const current = parseWhitelist(elements.whitelist.value);
  const lower = host.toLowerCase();
  if (current.includes(lower)) {
    flash(`${host} is already whitelisted`);
    return;
  }

  current.push(lower);
  elements.whitelist.value = current.join("\n");
  try {
    await browser.storage.local.set({ whitelist: current });
    flash(`Added ${host} and saved`);
    await refreshViews(current);
  } catch (e) {
    flash(`Added ${host} — click Save to keep it`, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();

  elements.saveBtn.addEventListener("click", save);
  elements.sweepBtn.addEventListener("click", sweepNow);
  elements.addToWhitelist.addEventListener("click", addCurrentSiteToWhitelist);
  elements.hardMaxAgeEnabled.addEventListener("change", (e) => {
    elements.hardMaxAge.disabled = !e.target.checked;
  });
  elements.themeToggle.addEventListener("click", async () => {
    const dark = !document.body.classList.contains("dark");
    applyTheme(dark);
    await browser.storage.local.set({ theme: dark ? "dark" : "light" });
  });

  load();
});