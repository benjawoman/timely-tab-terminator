const DEFAULTS = {
  enabled: true,
  maxAgeMinutes: 60,
  tabThreshold: 20,
  whitelist: [],
  closePinned: false,
  closeAudible: false,
  hardMaxAgeEnabled: false,
  hardMaxAgeMinutes: 10,
  theme: "light"
};

const GROUP_COLORS = {
  blue: "#1c71d8",
  purple: "#9141ac",
  cyan: "#0c8c8c",
  green: "#26a269",
  yellow: "#c89800",
  orange: "#e66100",
  red: "#e01b24",
  pink: "#c061cb",
  grey: "#77767b"
};

function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  $("themeToggle").textContent = dark ? "☀️" : "🌙";
}

const $ = (id) => document.getElementById(id);

// Cache DOM elements to avoid repeated queries
const elements = {};
function cacheElements() {
  elements.currentTabHost = $("currentTabHost");
  elements.currentTabAge = $("currentTabAge");
  elements.addToWhitelist = $("addToWhitelist");
  elements.tabCount = $("tabCount");
  elements.tabList = $("tabList");
  elements.groupList = $("groupList");
  elements.groupCount = $("groupCount");
  elements.status = $("status");
  elements.saveBtn = $("save");
  elements.sweepBtn = $("sweep");
}

function parseWhitelist(text) {
  return text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

function flash(msg, isError = false) {
  const el = elements.status;
  el.textContent = msg;
  el.style.color = isError ? "#c4292c" : "#1d8b3a";
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2000);
}

function isWhitelisted(host, whitelist) {
  if (!host) return false;
  const h = host.toLowerCase();
  return whitelist.some((e) => h === e || h.endsWith("." + e));
}

function renderCurrentTab(tab, state) {
  const host = hostnameOf(tab.url);
  const hostEl = elements.currentTabHost;
  hostEl.textContent = host || tab.title || tab.url || "—";
  hostEl.title = tab.url || "";

  const created = state.createdAt[tab.id];
  elements.currentTabAge.textContent = created
    ? `Opened ${formatDuration(Date.now() - created)} ago`
    : "Opened recently";

  const addBtn = elements.addToWhitelist;
  addBtn.disabled = !host;
  addBtn.title = host ? `Add ${host} to the whitelist` : "Cannot whitelist this page type";
}

function renderTabList(tabs, state, whitelist) {
  elements.tabCount.textContent = `${tabs.length} open`;
  const list = elements.tabList;
  list.innerHTML = "";

  const now = Date.now();
  const rows = tabs.map((t) => {
    const idleMs = t.active ? 0 : now - (state.lastActive[t.id] || now);
    return { tab: t, idleMs };
  });
  // Oldest-idle first; active tabs sink to the bottom.
  rows.sort((a, b) => {
    if (a.tab.active !== b.tab.active) return a.tab.active ? 1 : -1;
    return b.idleMs - a.idleMs;
  });

  for (const { tab, idleMs } of rows) {
    const li = document.createElement("li");
    if (tab.active) li.classList.add("active-tab");
    const host = hostnameOf(tab.url);
    if (isWhitelisted(host, whitelist)) li.classList.add("whitelisted");
    if (tab.groupId != null && tab.groupId !== -1) li.classList.add("grouped-tab");

    const hostEl = document.createElement("span");
    hostEl.className = "tab-host";
    hostEl.textContent = host || tab.title || tab.url || "(blank)";
    hostEl.title = tab.title ? `${tab.title}\n${tab.url || ""}` : tab.url || "";

    const ageEl = document.createElement("span");
    ageEl.className = "tab-age";
    ageEl.textContent = tab.active ? "active" : formatDuration(idleMs);

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
        const aOpen = now - (state.createdAt[a.id] || now);
        const bOpen = now - (state.createdAt[b.id] || now);
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
      ageEl.textContent = created
        ? formatDuration(now - created)
        : "recent";

      li.appendChild(hostEl);
      li.appendChild(ageEl);
      tabList.appendChild(li);
    }

    details.appendChild(tabList);
    container.appendChild(details);
  }
}

async function load() {
  const stored = await browser.storage.local.get(DEFAULTS);
  const s = { ...DEFAULTS, ...stored };
  applyTheme(s.theme === "dark");
  $("enabled").checked = s.enabled;
  $("maxAge").value = s.maxAgeMinutes;
  $("threshold").value = s.tabThreshold;
  $("closePinned").checked = s.closePinned;
  $("closeAudible").checked = s.closeAudible;
  $("hardMaxAgeEnabled").checked = s.hardMaxAgeEnabled;
  $("hardMaxAge").value = s.hardMaxAgeMinutes;
  $("hardMaxAge").disabled = !s.hardMaxAgeEnabled;
  $("whitelist").value = (s.whitelist || []).join("\n");

  cacheElements();

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const allTabs = await browser.tabs.query({});
  const groups = browser.tabGroups ? await browser.tabGroups.query({}) : [];
  const state = await browser.runtime.sendMessage({ type: "getTabsState" });

  if (activeTab) renderCurrentTab(activeTab, state);
  renderTabList(allTabs, state, s.whitelist || []);
  renderGroupList(allTabs, groups, state);
}

async function save() {
  const maxAge = Math.max(1, parseInt($("maxAge").value, 10) || DEFAULTS.maxAgeMinutes);
  const threshold = Math.max(0, parseInt($("threshold").value, 10) || 0);
  const hardMaxAgeEnabled = $("hardMaxAgeEnabled").checked;
  const hardMaxAgeMinutes = Math.max(1, parseInt($("hardMaxAge").value, 10) || DEFAULTS.hardMaxAgeMinutes);
  const whitelist = parseWhitelist($("whitelist").value);
  
  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = "Saving...";
  
  try {
    await browser.storage.local.set({
      enabled: $("enabled").checked,
      maxAgeMinutes: maxAge,
      tabThreshold: threshold,
      closePinned: $("closePinned").checked,
      closeAudible: $("closeAudible").checked,
      hardMaxAgeEnabled,
      hardMaxAgeMinutes,
      whitelist
    });
    const allTabs = await browser.tabs.query({});
    const groups = browser.tabGroups ? await browser.tabGroups.query({}) : [];
    const state = await browser.runtime.sendMessage({ type: "getTabsState" });
    renderTabList(allTabs, state, whitelist);
    renderGroupList(allTabs, groups, state);
    flash("Saved");
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
    
    // Handle confirmation request
    if (result && result.needsConfirmation) {
      const confirmed = confirm(
        `About to close ${result.count} of ${result.total} tabs.\n\n` +
        `This is ${(result.count / result.total * 100).toFixed(0)}% of your open tabs.\n\n` +
        `Do you want to proceed?`
      );
      
      if (!confirmed) {
        elements.sweepBtn.disabled = false;
        elements.sweepBtn.textContent = "Run now";
        flash("Cleanup cancelled");
        return;
      }
      
      // User confirmed, run the cleanup
      await browser.runtime.sendMessage({ type: "confirmAndRunSweep" });
    }
    
    const allTabs = await browser.tabs.query({});
    const groups = browser.tabGroups ? await browser.tabGroups.query({}) : [];
    const state = await browser.runtime.sendMessage({ type: "getTabsState" });
    renderTabList(allTabs, state, parseWhitelist($("whitelist").value));
    renderGroupList(allTabs, groups, state);
    flash("Cleanup run");
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
  const current = parseWhitelist($("whitelist").value);
  const lower = host.toLowerCase();
  if (current.includes(lower)) {
    flash(`${host} already whitelisted`);
    return;
  }
  current.push(lower);
  $("whitelist").value = current.join("\n");
  flash(`Added ${host}`);
}

document.addEventListener("DOMContentLoaded", load);
$("save").addEventListener("click", save);
$("sweep").addEventListener("click", sweepNow);
$("addToWhitelist").addEventListener("click", addCurrentSiteToWhitelist);
$("hardMaxAgeEnabled").addEventListener("change", (e) => {
  $("hardMaxAge").disabled = !e.target.checked;
});
$("themeToggle").addEventListener("click", async () => {
  const dark = !document.body.classList.contains("dark");
  applyTheme(dark);
  await browser.storage.local.set({ theme: dark ? "dark" : "light" });
});
