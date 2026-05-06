const DEFAULTS = {
  enabled: true,
  maxAgeMinutes: 60,
  tabThreshold: 20,
  whitelist: [],
  closePinned: false,
  closeAudible: false,
  hardMaxAgeEnabled: false,
  hardMaxAgeMinutes: 120,
  theme: "light"
};

function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  $("themeToggle").textContent = dark ? "☀️" : "🌙";
}

const $ = (id) => document.getElementById(id);

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "<1m";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rmin = min % 60;
  if (hr < 24) return rmin > 0 ? `${hr}h ${rmin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const rhr = hr % 24;
  return rhr > 0 ? `${day}d ${rhr}h` : `${day}d`;
}

function parseWhitelist(text) {
  return text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

function isWhitelisted(host, whitelist) {
  if (!host) return false;
  const h = host.toLowerCase();
  return whitelist.some((e) => h === e || h.endsWith("." + e));
}

function flash(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = isError ? "#c4292c" : "#1d8b3a";
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2000);
}

function renderCurrentTab(tab, state) {
  const host = hostnameOf(tab.url);
  const hostEl = $("currentTabHost");
  hostEl.textContent = host || tab.title || tab.url || "—";
  hostEl.title = tab.url || "";

  const created = state.createdAt[tab.id];
  $("currentTabAge").textContent = created
    ? `Opened ${formatDuration(Date.now() - created)} ago`
    : "Opened recently";

  const addBtn = $("addToWhitelist");
  addBtn.disabled = !host;
  addBtn.title = host ? `Add ${host} to the whitelist` : "Cannot whitelist this page type";
}

function renderTabList(tabs, state, whitelist) {
  $("tabCount").textContent = `${tabs.length} open`;
  const list = $("tabList");
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

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const allTabs = await browser.tabs.query({});
  const state = await browser.runtime.sendMessage({ type: "getTabsState" });

  if (activeTab) renderCurrentTab(activeTab, state);
  renderTabList(allTabs, state, s.whitelist || []);
}

async function save() {
  const maxAge = Math.max(1, parseInt($("maxAge").value, 10) || DEFAULTS.maxAgeMinutes);
  const threshold = Math.max(0, parseInt($("threshold").value, 10) || 0);
  const hardMaxAgeEnabled = $("hardMaxAgeEnabled").checked;
  const hardMaxAgeMinutes = Math.max(1, parseInt($("hardMaxAge").value, 10) || DEFAULTS.hardMaxAgeMinutes);
  const whitelist = parseWhitelist($("whitelist").value);
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
  // Re-render list so whitelist stars update without reopening the popup.
  const allTabs = await browser.tabs.query({});
  const state = await browser.runtime.sendMessage({ type: "getTabsState" });
  renderTabList(allTabs, state, whitelist);
  flash("Saved");
}

async function sweepNow() {
  await save();
  try {
    await browser.runtime.sendMessage({ type: "runSweepNow" });
    const allTabs = await browser.tabs.query({});
    const state = await browser.runtime.sendMessage({ type: "getTabsState" });
    renderTabList(allTabs, state, parseWhitelist($("whitelist").value));
    flash("Cleanup run");
  } catch (e) {
    flash("Cleanup failed", true);
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
