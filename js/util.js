// Small helpers shared by every view: time in Orlando, distance, storage, DOM.

const TZ = "America/New_York";

// ?now=2026-10-15T10:30 lets you preview a park day before the trip.
const NOW_OVERRIDE = (() => {
  try {
    const v = new URLSearchParams(location.search).get("now");
    return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null;
  } catch { return null; }
})();

export function orlandoNow() {
  if (NOW_OVERRIDE) {
    const [date, time] = NOW_OVERRIDE.split("T");
    return { date, time, minutes: toMinutes(time), simulated: true };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return { date, time, minutes: toMinutes(time), simulated: false };
}

export function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fmtTime(hhmm) {
  if (!hhmm) return "";
  let [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

// ISO timestamp -> "h:mm" in Orlando time
export function isoToOrlandoHHMM(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr ago`;
}

// Straight-line meters, then a walking estimate that allows for paths not being straight.
export function meters(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function walkMinutes(a, b) {
  const m = meters(a, b);
  if (m == null) return null;
  return Math.max(1, Math.round((m * 1.35) / 75)); // ~75 m/min with a group, paths ~35% longer than straight
}

export function directionsLinks(lat, lng, label) {
  const q = encodeURIComponent(label || "");
  return {
    apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w&q=${q}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`,
  };
}

export const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);

// ---------- storage (per phone) ----------
const KEY = "ut26:";
export const store = {
  get(name, fallback) {
    try {
      const v = localStorage.getItem(KEY + name);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(name, value) {
    try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

// ---------- DOM ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function icon(name) {
  const paths = {
    today: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M8 13h3v3H8z"/>',
    now: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    map: '<path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
    eat: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 3v4M17 21V3c-2 1-3 4-3 7 0 2 1 3 3 3"/>',
    explore: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3Z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M7 12l3-4 4 1 2 4 2 1M10 8l-1 5"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    cake: '<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0M12 12V8M12 5.5c.8-.7 1-1.5 0-2.5-1 1-.8 1.8 0 2.5Z"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}
