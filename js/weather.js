// Daily forecasts for each trip stop from Open-Meteo (free, no key). Refreshed hourly when
// online and saved on the phone, so the last forecast still shows at sea without signal.
import { store, ago, toMinutes, fmtTime } from "./util.js";

const URL = "https://api.open-meteo.com/v1/forecast";
const REFRESH_MS = 60 * 60 * 1000;
let cfg = null, data = store.get("wx", null), loading = false;
const listeners = new Set();

export function initWeather(config) {
  cfg = config;
  if (!cfg) return;
  refresh(false);
  setInterval(() => refresh(false), 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  window.addEventListener("online", () => refresh(true));
}
export function onWeather(fn) { listeners.add(fn); }

export async function refresh(force) {
  if (!cfg || loading || !navigator.onLine) return;
  if (!force && data && Date.now() - data.fetchedAt < REFRESH_MS) return;
  const keys = Object.keys(cfg.locations);
  const locs = keys.map((k) => cfg.locations[k]);
  const q = new URLSearchParams({
    latitude: locs.map((l) => l.lat).join(","),
    longitude: locs.map((l) => l.lng).join(","),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max",
    hourly: "precipitation_probability,temperature_2m,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "America/New_York",
    forecast_days: "16",
  });
  loading = true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${URL}?${q}`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let raw = await res.json();
    if (!Array.isArray(raw)) raw = [raw];
    const byLoc = {};
    raw.forEach((r, i) => {
      const d = r.daily, h = r.hourly, days = {};
      d.time.forEach((date, j) => {
        days[date] = {
          code: d.weather_code[j], hi: d.temperature_2m_max[j], lo: d.temperature_2m_min[j],
          rain: d.precipitation_probability_max[j], uv: d.uv_index_max[j],
          wind: d.wind_speed_10m_max[j], gust: d.wind_gusts_10m_max[j], hours: [],
        };
      });
      h.time.forEach((ts, j) => {
        const day = days[ts.slice(0, 10)];
        if (day) day.hours.push([ts.slice(11, 16), h.precipitation_probability[j], h.temperature_2m[j], h.weather_code[j]]);
      });
      byLoc[keys[i]] = days;
    });
    data = { fetchedAt: Date.now(), byLoc };
    store.set("wx", data);
    for (const fn of listeners) fn();
  } catch { /* keep the saved forecast */ } finally { loading = false; }
}

// ---------- reading ----------
const CODES = [
  [[0], "Sunny", "sun"], [[1], "Mostly sunny", "sun"], [[2], "Partly cloudy", "partly"], [[3], "Cloudy", "cloud"],
  [[45, 48], "Foggy", "cloud"], [[51, 53, 55, 56, 57], "Drizzle", "rain"], [[61, 63, 66, 80], "Showers", "rain"],
  [[65, 67, 81, 82], "Heavy rain", "rain"], [[71, 73, 75, 77, 85, 86], "Snow", "cloud"], [[95, 96, 99], "Thunderstorms", "storm"],
];
function describe(code) {
  for (const [list, label, kind] of CODES) if (list.includes(code)) return { label, kind };
  return { label: "Mixed", kind: "partly" };
}
const ICON = {
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  partly: '<path d="M8 3v1.5M3.5 7.5H2M4.6 4.6l1 1M12 4.6l-1 1"/><path d="M5.2 11A3.5 3.5 0 0 1 11 7.4"/><path d="M8 20h9a4 4 0 1 0-1-7.9A5 5 0 0 0 7 14a3 3 0 0 0 1 6Z"/>',
  cloud: '<path d="M7 19h10a4.5 4.5 0 1 0-1.2-8.8A6 6 0 0 0 4.5 13 3.5 3.5 0 0 0 7 19Z"/>',
  rain: '<path d="M7 15h10a4 4 0 1 0-1-7.9A5.5 5.5 0 0 0 5 10a3 3 0 0 0 2 5Z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  storm: '<path d="M7 14h10a4 4 0 1 0-1-7.9A5.5 5.5 0 0 0 5 9a3 3 0 0 0 2 5Z"/><path d="m12 15-2 4h3l-2 4"/>',
};
export function wxIcon(kind) {
  return `<svg class="icon wx-icon wxi-${kind}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[kind] || ICON.partly}</svg>`;
}
const uvLabel = (uv) => (uv >= 11 ? "extreme" : uv >= 8 ? "very high" : uv >= 6 ? "high" : uv >= 3 ? "moderate" : "low");
const r0 = (n) => Math.round(n);

// Everything a card needs for one trip day.
export function forDay(date) {
  if (!cfg || !cfg.days[date]) return null;
  const plan = cfg.days[date], loc = cfg.locations[plan.loc];
  const f = data && data.byLoc[plan.loc] ? data.byLoc[plan.loc][date] : null;
  const base = { date, loc, place: loc.name, short: loc.short || loc.name, approx: !!loc.approx, from: plan.from, to: plan.to };
  if (!f) {
    const avail = new Date(`${date}T12:00:00`); avail.setDate(avail.getDate() - 15);
    return { ...base, typical: loc.typical, availableFrom: avail.toLocaleDateString("en-US", { month: "short", day: "numeric" }), fetchedAt: data && data.fetchedAt };
  }
  const inWin = f.hours.filter(([t]) => toMinutes(t) >= toMinutes(plan.from) && toMinutes(t) <= toMinutes(plan.to));
  const winRain = inWin.length ? Math.max(...inWin.map((h) => h[1] ?? 0)) : f.rain;
  const wet = inWin.filter((h) => (h[1] ?? 0) >= 40).map((h) => h[0]);
  const d = describe(f.code);
  return {
    ...base, ...d, hi: r0(f.hi), lo: r0(f.lo), rain: f.rain, winRain, wetFrom: wet[0] || null,
    uv: f.uv != null ? Math.round(f.uv) : null, uvLabel: f.uv != null ? uvLabel(f.uv) : "", wind: r0(f.wind), gust: r0(f.gust),
    hours: f.hours, fetchedAt: data.fetchedAt,
  };
}

// Current-hour line for the Now screens.
export function nowLine(date, time) {
  const w = forDay(date);
  if (!w || !w.hours) return null;
  const m = toMinutes(time);
  const next = w.hours.filter(([t]) => toMinutes(t) >= m - 59 && toMinutes(t) <= m + 180);
  if (!next.length) return null;
  const temp = r0(next[0][2]);
  const rain = Math.max(...next.map((h) => h[1] ?? 0));
  const d = describe(next[0][3]);
  return { temp, rain, ...d, place: w.place };
}

export function updatedLabel() {
  if (!data) return navigator.onLine ? "Loading forecast…" : "Forecast loads when you're online.";
  return `Forecast updated ${ago(data.fetchedAt)}${navigator.onLine ? "" : " (offline)"}`;
}

export function windowLabel(w) { return `${fmtTime(w.from)}–${fmtTime(w.to)}`; }

// ---------- rendering ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function tipFor(w, dayKind) {
  const tips = [];
  if (w.winRain >= 50) tips.push(dayKind === "park" ? "Rain likely. Most rides keep running in light rain, but coasters pause for lightning. Pack ponchos and keep indoor rides in reserve." : dayKind === "sea" ? "Rain likely. Indoor options: the Royal Promenade, ice skating, Adventure Ocean." : "Rain likely. Tropical showers are usually short; bring a dry bag for phones.");
  if (w.gust >= 30 && dayKind !== "park") tips.push("Windy: the top-deck slides and FlowRider may close.");
  if (w.uv >= 8) tips.push(dayKind === "park" ? "Strong sun: reapply sunscreen every 2 hours." : "Strong sun: reapply sunscreen every 2 hours and after swimming.");
  return tips;
}

export function card(date, dayKind) {
  const w = forDay(date);
  if (!w) return "";
  if (w.typical) {
    return `<section class="wx wx-typical" aria-label="Weather">
      <div class="wx-main">${wxIcon("partly")}<div><b>${w.typical.hi}° / ${w.typical.lo}°</b><span>Typical for late October, ${esc(w.place)}</span></div></div>
      <p class="wx-note">${esc(w.typical.note)} The day's forecast shows up around ${esc(w.availableFrom)}.</p>
    </section>`;
  }
  const tips = tipFor(w, dayKind);
  return `<section class="wx" aria-label="Weather">
    <div class="wx-main">${wxIcon(w.kind)}<div><b>${w.hi}° / ${w.lo}°</b><span>${esc(w.label)}, ${esc(w.place)}</span></div>
      <div class="wx-rain-${w.winRain >= 60 ? "hi" : w.winRain >= 30 ? "mid" : "lo"}"><b>${w.winRain}%</b><span>rain ${esc(windowLabel(w))}</span></div></div>
    <ul class="wx-facts">${w.uv != null ? `<li>UV ${w.uv}, ${esc(w.uvLabel)}</li>` : ""}<li>Wind ${w.wind} mph, gusts ${w.gust}</li>${w.wetFrom ? `<li>Showers most likely from ${esc(fmtTime(w.wetFrom))}</li>` : ""}</ul>
    ${tips.map((t) => `<p class="wx-note">${esc(t)}</p>`).join("")}
    <p class="fine">${w.approx ? "Forecast for the ship's rough position. " : ""}${esc(updatedLabel())}. Forecasts more than a few days out often change.</p>
  </section>`;
}

export function tripList(dates, current, labelFor) {
  const rows = dates.map((d) => {
    const w = forDay(d);
    if (!w) return "";
    const hi = w.typical ? `${w.typical.hi}°` : `${w.hi}°`;
    const lo = w.typical ? `${w.typical.lo}°` : `${w.lo}°`;
    const rain = w.typical ? "typical" : `${w.winRain}%`;
    return `<li class="${d === current ? "wx-row-on" : ""}"><button type="button" class="wx-row" data-day="${d}">
      <span class="wx-row-day">${esc(labelFor(d))}</span>${wxIcon(w.typical ? "partly" : w.kind)}
      <span class="wx-row-place">${esc(w.short)}</span>
      <span class="wx-row-temp">${hi} / ${lo}</span><span class="wx-row-rain">${rain}</span></button></li>`;
  }).join("");
  return `<details class="guide wx-trip"><summary>Forecast for the whole trip</summary><ul class="wx-rows">${rows}</ul><p class="fine">Rain chance is the highest hourly chance during your time there. ${esc(updatedLabel())}.</p></details>`;
}

export function compact(date, time) {
  const n = nowLine(date, time);
  if (!n) return "";
  return `<div class="wx-now">${wxIcon(n.kind)}<span><b>${n.temp}°</b> ${esc(n.label.toLowerCase())}. Rain chance next 3 hours: <b>${n.rain}%</b></span></div>`;
}
