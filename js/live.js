// Live wait times from the public ThemeParks.wiki API, with two fallbacks:
// a copy refreshed by this repo's GitHub Action, and the last good copy saved on this phone.

import { store, isoToOrlandoHHMM } from "./util.js";

const DIRECT = (id) => `https://api.themeparks.wiki/v1/entity/${id}/live`;
const MIRROR = (code) => `https://raw.githubusercontent.com/Gr8whitenorth87/universal-trip/live-data/live/${code}.json`;
const FAST_MS = 2 * 60 * 1000;   // the park you're looking at
const SLOW_MS = 10 * 60 * 1000;  // the other parks

const state = {}; // code -> { byId, fetchedAt, source, error }
const listeners = new Set();
let parks = {};
let focusCode = null;
let timer = null;

// ---------- park hours (ThemeParks.wiki schedule, fetched once a day) ----------
const SCHED = (id) => `https://api.themeparks.wiki/v1/entity/${id}/schedule`;
let sched = store.get("sched", {});

export function scheduleFor(code, date) {
  const s = sched[code];
  return s && s.days ? s.days[date] || null : null;
}

async function refreshSchedule(code, today) {
  const meta = parks[code];
  if (!meta || (sched[code] && sched[code].fetched === today)) return;
  try {
    const raw = await getJSON(SCHED(meta.id), 10000);
    const days = {};
    for (const e of raw.schedule || []) {
      const d = (days[e.date] = days[e.date] || {});
      const o = isoToOrlandoHHMM(e.openingTime), c = isoToOrlandoHHMM(e.closingTime);
      if (e.type === "OPERATING") { d.open = o; d.close = c; }
      else if (e.type === "EXTRA_HOURS") d.early = o;
    }
    sched[code] = { fetched: today, days };
    store.set("sched", sched);
    emit(code);
  } catch { /* keep the researched hours */ }
}

export function initLive(parkMeta, today) {
  parks = parkMeta;
  for (const code of Object.keys(parks)) refreshSchedule(code, today);
  for (const code of Object.keys(parks)) {
    const cached = store.get(`live:${code}`, null);
    if (cached) state[code] = { ...parse(cached.raw), fetchedAt: cached.fetchedAt, source: "saved" };
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(true); });
  window.addEventListener("online", () => tick(true));
  tick(true);
  timer = setInterval(() => tick(false), 30 * 1000);
}

export function setFocusPark(code) {
  if (code === focusCode) return;
  focusCode = code;
  refresh(code);
}

export function onLive(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function live(code) { return state[code] || null; }

export function liveFor(item) {
  const s = state[item.park];
  if (!s || !s.byId || !item.apiId) return null;
  return s.byId[item.apiId] || null;
}

export async function refresh(code) {
  const meta = parks[code];
  if (!meta) return;
  const prev = state[code] || {};
  state[code] = { ...prev, loading: true };
  emit(code);
  let raw = null, source = null, error = null;
  try {
    raw = await getJSON(DIRECT(meta.id), 8000);
    source = "live";
  } catch (e) {
    error = e.message;
    try {
      raw = await getJSON(`${MIRROR(code)}?t=${Math.floor(Date.now() / 60000)}`, 8000);
      source = "mirror";
    } catch (e2) {
      error = `${error}; ${e2.message}`;
    }
  }
  if (raw && Array.isArray(raw.liveData)) {
    const fetchedAt = source === "mirror" && raw.fetchedAt ? Date.parse(raw.fetchedAt) || Date.now() : Date.now();
    store.set(`live:${code}`, { raw, fetchedAt });
    state[code] = { ...parse(raw), fetchedAt, source, error: null, loading: false };
  } else {
    state[code] = { ...prev, error: error || "No data", loading: false };
  }
  emit(code);
}

function tick(force) {
  if (document.hidden || !navigator.onLine || focusCode === "SHIP") return;
  const now = Date.now();
  for (const code of Object.keys(parks)) {
    const s = state[code];
    const age = s && s.fetchedAt && s.source !== "saved" ? now - s.fetchedAt : Infinity;
    const limit = code === focusCode ? FAST_MS : SLOW_MS;
    if (s && s.loading) continue;
    if (force ? age > 60 * 1000 : age >= limit) refresh(code);
  }
}

function emit(code) { for (const fn of listeners) { try { fn(code); } catch (e) { console.error(e); } } }

async function getJSON(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "timed out" : (e.message || "network error"));
  } finally {
    clearTimeout(t);
  }
}

function parse(raw) {
  const byId = {};
  for (const d of raw.liveData || []) {
    const q = d.queue || {};
    const showtimes = (d.showtimes || [])
      .map((s) => isoToOrlandoHHMM(s.startTime))
      .filter(Boolean)
      .sort();
    byId[d.id] = {
      status: d.status || "UNKNOWN",
      wait: numberOrNull(q.STANDBY && q.STANDBY.waitTime),
      single: numberOrNull(q.SINGLE_RIDER && q.SINGLE_RIDER.waitTime),
      express: numberOrNull(q.PAID_STANDBY && q.PAID_STANDBY.waitTime),
      showtimes,
      updated: d.lastUpdated ? Date.parse(d.lastUpdated) : null,
    };
  }
  return { byId };
}

function numberOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }
