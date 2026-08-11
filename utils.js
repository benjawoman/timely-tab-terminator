/* Timely Tab Terminator — shared helpers used by both the background
 * script and the popup. Loaded first in both contexts. */

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

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
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
  if (day < 7) return rhr > 0 ? `${day}d ${rhr}h` : `${day}d`;

  const week = Math.floor(day / 7);
  const rday = day % 7;
  return rday > 0 ? `${week}w ${rday}d` : `${week}w`;
}

function parseWhitelist(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}