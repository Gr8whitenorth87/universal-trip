import { orlandoNow, toMinutes, fmtTime, ago, walkMinutes, meters, directionsLinks, isApple, store, icon } from "./util.js";
import { initLive, setFocusPark, onLive, live, liveFor, refresh, scheduleFor } from "./live.js";
import { savedKey, decryptWith, askPassword, forgetKey } from "./lock.js";
import { initMap, mapReady, invalidate, showLayer, fitPark, flyTo, drawMarkers, drawPlaces, setUser } from "./map.js";
import * as Cruise from "./cruise.js";
import * as Weather from "./weather.js";

// ---------------------------------------------------------------- state
const S = {
  data: null,
  view: "today",
  park: store.get("park", null),
  parkPickedAt: store.get("parkPickedAt", 0),
  day: null,
  riders: store.get("riders", null),
  photos: store.get("bdayPhotos", {}),
  wish: 0,
  rode: store.get("rode", {}),
  hunts: store.get("hunts", {}),
  bb: store.get("bb", {}),
  filters: store.get("filters", { notDone: false, allCan: false, calm: false }),
  sort: store.get("sort", "land"),
  mapLayers: store.get("mapLayers", { rides: true, shows: true, food: false, hunts: false }),
  eatPark: null,
  explorePark: null,
  pos: null,
  geoOn: store.get("geoOn", false),
  sheet: null,
  confirm: null,
};

const RIDE_KINDS = new Set(["coaster", "dark ride", "simulator", "water", "flat", "train"]);
const KIND_LABEL = { show: "Show", meet: "Meet", "play area": "Play", walkthrough: "Walk", train: "Train" };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

// ---------------------------------------------------------------- boot
boot();

async function boot() {
  try {
    const res = await fetch("data/app-data.enc.json", { cache: "no-cache" });
    const blob = await res.json();
    const key = await savedKey();
    let data = null;
    if (key) { try { data = await decryptWith(key, blob); } catch { forgetKey(); } }
    if (!data) data = await askPassword(blob);
    S.data = data;
    document.body.classList.remove("locked");
  } catch (e) {
    document.body.classList.remove("locked");
    $("#view").innerHTML = `<div class="empty"><h2>Couldn't load the trip data</h2><p>Check your connection and reload. Once it loads once, it works offline.</p></div>`;
    return;
  }
  const D = S.data;
  if (!S.riders) S.riders = D.riders || [];
  D.byKey = Object.fromEntries(D.attractions.map((a) => [a.key, a]));
  D.food.forEach((f) => { f.key = slug(`${f.park} ${f.location} ${f.item}`); });
  D.shows.forEach((s, i) => { s.key = `show-${i}`; });
  Cruise.initCruise({ S, openSheet, cantRide, showMap: () => go("map"), weatherCard: (d, k) => Weather.card(d, k) });
  Weather.initWeather(D.cruise && D.cruise.weather);
  Weather.onWeather(() => { if (S.view === "today" || S.view === "now") renderView(); });

  const now = orlandoNow();
  S.wish = Math.floor(Math.random() * 50);
  const planDays = D.plan.days.map((d) => d.date);
  S.day = planDays.includes(now.date) ? now.date : (store.get("day", null) || "2026-10-15");
  if (!S.park || (planDays.includes(now.date) && Date.now() - S.parkPickedAt > 3 * 3600e3)) S.park = parkForNow();
  S.eatPark = S.park;
  S.explorePark = S.park;

  initLive(D.parks, now.date);
  setFocusPark(S.park);
  onLive(() => { renderHeader(); if (["now", "today", "map"].includes(S.view)) renderView(); if (S.sheet) renderSheet(); });

  buildChrome();
  const hashView = location.hash.replace("#", "");
  go(["today", "now", "map", "eat", "explore"].includes(hashView) ? hashView : "today", false);
  if (S.geoOn) startGeo();
  setInterval(() => { renderHeader(); if (S.view === "today" || S.view === "now") renderView(); }, 60 * 1000);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function parkForNow() {
  const now = orlandoNow();
  const day = S.data.plan.days.find((d) => d.date === now.date) || S.data.plan.days.find((d) => d.date === "2026-10-15");
  if (day.mode === "cruise") return "SHIP";
  const steps = day.steps.filter((s) => s.park);
  let park = steps[0] ? steps[0].park : "EPIC";
  for (const s of steps) if (toMinutes(s.time) <= now.minutes) park = s.park;
  return park;
}

// ---------------------------------------------------------------- chrome
function buildChrome() {
  $("#parkSwitch").innerHTML = Object.values(S.data.parks)
    .map((p) => `<button type="button" class="park-btn" data-park="${p.code}" aria-pressed="false">${esc(p.short)}</button>`)
    .join("") + (S.data.cruise ? `<button type="button" class="park-btn" data-park="SHIP" aria-pressed="false">Cruise</button>` : "");
  $("#parkSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("[data-park]");
    if (b) pickPark(b.dataset.park, true);
  });
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) go(b.dataset.view);
  });
  $("#settingsBtn").innerHTML = icon("gear");
  $("#settingsBtn").addEventListener("click", () => openSheet({ type: "settings" }));
  $("#sheetBackdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  $("#view").addEventListener("click", onViewClick);
  $("#view").addEventListener("change", onViewChange);
  $("#sheet").addEventListener("click", onSheetClick);
  $("#sheet").addEventListener("change", onSheetChange);
  for (const b of document.querySelectorAll("#tabs [data-icon]")) b.insertAdjacentHTML("afterbegin", icon(b.dataset.icon));
  const setTop = () => document.documentElement.style.setProperty("--top-h", `${$(".top").offsetHeight}px`);
  setTop();
  if ("ResizeObserver" in window) new ResizeObserver(() => { setTop(); invalidate(); }).observe($(".top"));
  window.addEventListener("hashchange", () => {
    const v = location.hash.replace("#", "");
    if (v && v !== S.view && ["today", "now", "map", "eat", "explore"].includes(v)) go(v, false);
  });
  renderHeader();
}

function pickPark(code, manual) {
  if (!S.data.parks[code] && code !== "SHIP") return;
  S.mapFitFor = null;
  S.park = code;
  S.eatPark = code;
  S.explorePark = code;
  if (manual) { S.parkPickedAt = Date.now(); store.set("parkPickedAt", S.parkPickedAt); }
  store.set("park", code);
  setFocusPark(code);
  renderHeader();
  renderView();
  if (S.view === "map" && code !== "SHIP") fitCurrentPark();
}

// Keep the header mode in step with the day being viewed.
function syncModeToDay(d) {
  if (!d) return;
  if (d.mode === "cruise" && S.park !== "SHIP") pickPark("SHIP", true);
  else if (d.mode !== "cruise" && S.park === "SHIP" && d.parks.length) pickPark(d.parks[0], true);
}

function go(view, push = true) {
  S.view = view;
  if (push) history.replaceState(null, "", `#${view}`);
  for (const b of document.querySelectorAll("#tabs [data-view]")) b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
  document.body.dataset.view = view;
  $("#mapWrap").hidden = view !== "map";
  $("#view").hidden = view === "map";
  if (view === "map") ensureMap();
  renderView();
  if (view !== "map") window.scrollTo(0, 0);
}

function renderHeader() {
  const p = S.data.parks[S.park];
  document.documentElement.dataset.park = S.park;
  for (const b of document.querySelectorAll(".park-btn")) b.setAttribute("aria-pressed", b.dataset.park === S.park ? "true" : "false");
  if (S.park === "SHIP") { $("#status").innerHTML = Cruise.headerStatus(orlandoNow()); return; }
  const L = live(S.park);
  const now = orlandoNow();
  const hrs = parkHours(S.park, now.date);
  let status = "";
  if (L && L.loading && !L.fetchedAt) status = "Loading wait times…";
  else if (L && L.fetchedAt) {
    const label = L.source === "mirror" ? "Backup wait times" : L.source === "saved" ? "Saved wait times" : "Live wait times";
    status = `${label}, ${ago(L.fetchedAt)}`;
    if (L.error && L.source !== "live") status += navigator.onLine ? "" : " (offline)";
  } else if (L && L.error) status = navigator.onLine ? "Wait times unavailable right now" : "Offline: wait times will load when you're back online";
  else status = "Loading wait times…";
  const hoursTxt = hrs ? `${p.short} ${hrs.early ? `early entry ${fmtTime(hrs.early)}, ` : ""}${fmtTime(hrs.open)}–${fmtTime(hrs.close)}` : "";
  $("#status").innerHTML = `<span>${esc(status)}</span>${hoursTxt ? `<span class="status-hours">${esc(hoursTxt)}</span>` : ""}${now.simulated ? `<span class="status-sim">Preview ${esc(now.date)} ${esc(fmtTime(now.time))}</span>` : ""}`;
}

function renderView() {
  const v = S.view;
  if (v === "today") renderToday();
  else if (v === "now") renderNow();
  else if (v === "map") renderMap();
  else if (v === "eat") renderEat();
  else if (v === "explore") renderExplore();
}

// ---------------------------------------------------------------- rider logic
function cantRide(a) {
  if (!a.minHeight) return [];
  return S.riders.filter((r) => Number(r.height) < a.minHeight).map((r) => r.name);
}
// Park hours for a date: the live schedule when we have it, otherwise the researched hours.
function parkHours(code, date) {
  return scheduleFor(code, date) || S.data.parks[code].hours[date] || null;
}

function parkState(code) {
  const now = orlandoNow();
  const h = parkHours(code, now.date);
  if (!h || !h.open) return { open: true, label: "" }; // unknown hours: trust the live feed
  const start = toMinutes(h.early || h.open), end = toMinutes(h.close);
  const name = S.data.parks[code].short;
  if (now.minutes < start) return { open: false, label: `${name} opens at ${fmtTime(h.early || h.open)}${h.early ? " (early entry)" : ""}`, opensAt: h.early || h.open };
  if (now.minutes >= end) return { open: false, label: `${name} closed at ${fmtTime(h.close)}` };
  return { open: true, label: "", closesAt: h.close };
}

function isIntense(a) { return (a.thrill || 0) >= 4 || (a.scary || 0) >= 3; }
function rodeCount(a) { return S.rode[a.key] || 0; }

function expressKey() { return `express:${orlandoNow().date}`; }
function expressUsed(a) { return !!store.get(expressKey(), {})[a.key]; }
function setExpressUsed(a, on) {
  const m = store.get(expressKey(), {});
  if (on) m[a.key] = true; else delete m[a.key];
  store.set(expressKey(), m);
}

// What the wait board shows for any attraction.
function waitInfo(a) {
  const L = liveFor(a);
  const isRide = RIDE_KINDS.has(a.kind);
  if (a.status === "closed") return { tone: "closed", short: "Closed", label: "Closed on your dates", open: false };
  const ps = parkState(a.park);
  if (!ps.open && a.kind !== "show") return { tone: "closed", short: "Closed", label: ps.label, open: false, parkClosed: true };
  if (L) {
    if (L.status === "DOWN") return { tone: "down", short: "Down", label: "Temporarily down", open: false, live: L };
    if (L.status === "CLOSED" || L.status === "REFURBISHMENT") return { tone: "closed", short: "Closed", label: L.status === "REFURBISHMENT" ? "Closed for refurbishment" : "Closed right now", open: false, live: L };
    if (L.wait != null) {
      const w = L.wait, t = a.typicalWait || 30;
      const tone = w <= 15 || w <= t * 0.5 ? "good" : w <= Math.max(30, t) ? "ok" : "bad";
      return { tone, short: String(w), unit: "min", label: `${w} min standby`, open: true, wait: w, live: L };
    }
    if (L.status === "OPERATING") return { tone: isRide ? "ok" : "show", short: isRide ? "Open" : (KIND_LABEL[a.kind] || "Open"), label: "Open (no posted wait)", open: true, live: L };
  }
  if (!isRide) return { tone: "show", short: KIND_LABEL[a.kind] || "See", label: KIND_LABEL[a.kind] || "", open: true };
  return { tone: "na", short: a.typicalWait ? `~${a.typicalWait}` : "–", unit: a.typicalWait ? "min" : "", label: a.typicalWait ? `Usually up to ~${a.typicalWait} min (estimate)` : "No wait data", open: true, estimate: true };
}

function board(a, size = "") {
  const w = waitInfo(a);
  return `<span class="board board-${w.tone} ${size}" title="${esc(w.label)}"><b>${esc(w.short)}</b>${w.unit ? `<small>${w.unit}</small>` : ""}</span>`;
}

function walkFrom(item) {
  if (!S.pos || item.lat == null) return null;
  const m = meters(S.pos, item);
  if (m > 4000) return null; // not in this park
  return walkMinutes(S.pos, item);
}

// ---------------------------------------------------------------- suggestions
function suggestions(code, limit = 4) {
  const now = orlandoNow();
  const out = [];
  for (const a of S.data.attractions) {
    if (a.park !== code) continue;
    const ride = RIDE_KINDS.has(a.kind) || (a.kind === "meet" && a.mustDo);
    if (!ride) continue;
    const w = waitInfo(a);
    if (!w.open) continue;
    const blocked = cantRide(a);
    const done = rodeCount(a) > 0;
    const xAvail = a.express && !expressUsed(a);
    const walk = walkFrom(a);
    const t = a.typicalWait || 30;
    let score = 0;
    const why = [];
    if (!done) { score += 15; if (a.mustDo) { score += 25; why.push("Must-do you haven't done"); } else why.push("Not done yet"); }
    if (w.wait != null) {
      const rel = Math.max(-1, Math.min(1, (t - w.wait) / t));
      score += rel * 30;
      if (w.wait <= 10) { score += 10; why.unshift(`Walk-on: ${w.wait} min`); }
      else if (w.wait <= t * 0.6) why.unshift(`${w.wait} min, usually ~${t}`);
      if (!xAvail) score -= w.wait * 0.4;
    }
    if (xAvail) { score += 18; why.push("Express unused today"); }
    if (walk != null) { score -= walk * 1.2; why.push(`${walk} min walk`); }
    if (blocked.length) score -= 12;
    if (done && rodeCount(a) >= 2) score -= 15;
    out.push({ a, score, why, blocked, walk, w });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

function showsSoon(code, withinMin = 120) {
  const now = orlandoNow();
  const list = [];
  for (const a of S.data.attractions) {
    if (a.park !== code || !(a.kind === "show")) continue;
    const L = liveFor(a);
    let times = L && L.showtimes && L.showtimes.length ? L.showtimes : null;
    let estimate = false;
    if (!times) {
      const s = S.data.shows.find((x) => x.park === code && normName(x.name) === normName(a.name));
      if (s && s.times && s.times.length) { times = s.times; estimate = true; }
    }
    if (!times) continue;
    const next = times.find((t) => toMinutes(t) >= now.minutes - 2 && toMinutes(t) <= now.minutes + withinMin);
    if (next) list.push({ a, next, estimate });
  }
  return list.sort((x, y) => toMinutes(x.next) - toMinutes(y.next));
}

function normName(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

// ---------------------------------------------------------------- BIRTHDAY
function birthdayCard(isTheDay) {
  const B = S.data.birthday;
  const msgs = B.messages || [];
  const msg = msgs.length ? msgs[S.wish % msgs.length] : "";
  const photos = (B.photos || []).map((p, i) => `<li><button type="button" class="photo-chk${S.photos[i] ? " photo-on" : ""}" data-photo="${i}" aria-pressed="${!!S.photos[i]}">${icon("check")}<span>${esc(p)}</span></button></li>`).join("");
  const got = (B.photos || []).filter((_, i) => S.photos[i]).length;
  return `<section class="bday" aria-label="Birthday">
    <div class="bday-top">
      <span class="bday-cake" aria-hidden="true">${icon("cake")}</span>
      <div><p class="bday-kicker">${isTheDay ? "Today is the day" : "Friday, October 16"}</p><h2>${esc(B.headline)}</h2></div>
    </div>
    <p class="bday-msg" aria-live="polite">${esc(msg)}</p>
    <button type="button" class="btn btn-bday" data-wish="1">Another birthday wish</button>
    <details class="bday-more">
      <summary>Birthday photo challenge <span class="count">${got} of ${(B.photos || []).length}</span></summary>
      <ul class="photo-list">${photos}</ul>
    </details>
    <details class="bday-more">
      <summary>Make it a birthday to remember</summary>
      <ul class="plain">${(B.tips || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </details>
  </section>`;
}

function confetti(big = false) {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.append(c);
  const ctx = c.getContext("2d");
  const colors = ["#F5B700", "#FF5D8F", "#2C6BED", "#0B8F7C", "#7446DB", "#FF8A3D"];
  const n = big ? 160 : 70;
  const parts = Array.from({ length: n }, () => ({
    x: (big ? Math.random() : 0.3 + Math.random() * 0.4) * c.width,
    y: big ? -Math.random() * c.height * 0.4 : c.height * 0.35,
    vx: (Math.random() - 0.5) * (big ? 4 : 14) * devicePixelRatio,
    vy: (big ? 2 + Math.random() * 3 : -6 - Math.random() * 8) * devicePixelRatio,
    s: (5 + Math.random() * 6) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.25 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - start < 3200) requestAnimationFrame(frame); else c.remove();
  })(start);
}

function birthdayBanner() {
  const B = S.data.birthday;
  if (!B || orlandoNow().date !== B.date) return "";
  const msgs = B.messages || [];
  return `<button type="button" class="bday-banner" data-day="${B.date}" data-goto="today">${icon("cake")}<span><b>${esc(B.headline)}</b> ${esc(msgs[S.wish % msgs.length] || "")}</span></button>`;
}

// ---------------------------------------------------------------- TODAY
function renderToday() {
  const D = S.data;
  const now = orlandoNow();
  const day = D.plan.days.find((d) => d.date === S.day) || D.plan.days[1];
  const isToday = day.date === now.date;
  const B = D.birthday;
  const isBday = !!(B && day.date === B.date);
  document.documentElement.dataset.bday = isBday ? "1" : "";
  if (isBday && now.date === B.date && !store.get(`confetti:${B.date}`, false)) {
    store.set(`confetti:${B.date}`, true);
    setTimeout(() => confetti(true), 400);
  }
  let currentIdx = -1;
  if (isToday) day.steps.forEach((s, i) => { if (toMinutes(s.time) <= now.minutes) currentIdx = i; });

  const chips = D.plan.days.map((d, i) => {
    const dt = new Date(`${d.date}T12:00:00`);
    const label = `${d.label} ${dt.getDate()}`;
    const cake = D.birthday && d.date === D.birthday.date ? `<span class="chip-cake" aria-label="birthday">${icon("cake")}</span>` : "";
    const kind = d.mode === "cruise" ? `<span class="chip-kind" aria-label="${d.kind === "sea" ? "sea day" : "port day"}">${icon(d.kind === "sea" ? "waves" : "anchor")}</span>` : "";
    const sep = d.mode === "cruise" && (i === 0 || D.plan.days[i - 1].mode !== "cruise") ? '<span class="chip-sep" aria-hidden="true"></span>' : "";
    return `${sep}<button type="button" class="chip${d.date === day.date ? " chip-on" : ""}" data-day="${d.date}" aria-pressed="${d.date === day.date}">${esc(label)}${cake}${kind}${d.date === now.date ? '<span class="chip-dot" aria-label="today"></span>' : ""}</button>`;
  }).join("");

  const hours = day.parks.map((code) => {
    const p = D.parks[code], hr = parkHours(code, day.date);
    if (!hr) return "";
    return `<div class="hours hours-${code}"><b>${esc(p.short)}</b><span>${hr.early ? `Early entry ${fmtTime(hr.early)}<br>` : ""}${fmtTime(hr.open)}–${fmtTime(hr.close)}</span></div>`;
  }).join("");

  const res = D.plan.reservations.filter((r) => r.date === day.date)
    .map((r) => `<li><b>${fmtTime(r.time)} ${esc(r.place)}</b> ${esc(r.note)}</li>`).join("");

  const steps = day.steps.map((s, i) => {
    const targets = (s.targets || []).map((k) => D.byKey[k]).filter(Boolean);
    const first = targets.find((t) => t.lat != null);
    const state = !isToday ? "" : i < currentIdx ? " step-past" : i === currentIdx ? " step-now" : "";
    const tlist = targets.map((t) => {
      const blocked = cantRide(t);
      return `<li><button type="button" class="target" data-open="${t.key}">${board(t, "board-sm")}<span class="target-name">${esc(t.name)}${blocked.length ? `<em class="note-warn">${esc(blocked.join(", "))}: too short</em>` : isIntense(t) ? `<em class="note-soft">Intense</em>` : ""}</span>${rodeCount(t) ? `<span class="tick" aria-label="done">${icon("check")}</span>` : ""}</button></li>`;
    }).join("");
    return `<li class="step step-${s.kind}${state}">
      <div class="step-time">${esc(fmtTime(s.time))}</div>
      <div class="step-body">
        ${i === currentIdx ? '<span class="now-flag">Now</span>' : ""}
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.detail)}</p>
        ${tlist ? `<ul class="targets">${tlist}</ul>` : ""}
        ${s.birthday && isBday ? `<p class="bday-note">${icon("cake")} ${esc(s.birthday)}</p>` : ""}
        ${day.mode === "cruise" ? Cruise.stepExtras(s) : ""}
        ${first ? `<div class="step-actions"><button type="button" class="btn btn-quiet" data-mapto="${first.key}">${icon("map")} Show on map</button><a class="btn btn-quiet" href="${directionsLinks(first.lat, first.lng, first.name)[isApple ? "apple" : "google"]}" target="_blank" rel="noopener">${icon("walk")} Walk there</a></div>`
          : s.query && day.mode !== "cruise" ? `<div class="step-actions"><a class="btn btn-quiet" href="${queryLinks(s.query)[isApple ? "apple" : "google"]}" target="_blank" rel="noopener">${icon("walk")} Directions</a></div>` : ""}
      </div>
    </li>`;
  }).join("");

  const guide = ((day.mode === "cruise" ? D.cruise.tips : D.guide) || []).map((g) => `<details class="guide"><summary>${esc(g.title)}</summary><p>${esc(g.body)}</p></details>`).join("");

  $("#view").innerHTML = `
    <section class="today">
      <div class="chips" role="group" aria-label="Trip day">${chips}</div>
      ${isBday ? birthdayCard(now.date === B.date) : ""}
      <header class="day-head">
        <h1>${esc(day.title)}</h1>
        <p>${esc(day.summary)}</p>
        ${hours ? `<div class="hours-row">${hours}</div>` : ""}
        ${res ? `<div class="res"><h2>Reservations</h2><ul>${res}</ul></div>` : ""}
        ${Cruise.dayHead(day, now)}
        ${Weather.card(day.date, day.mode === "cruise" ? (day.kind === "sea" ? "sea" : "port") : "park")}
      </header>
      <ol class="timeline">${steps}</ol>
      ${Cruise.dayFoot(day)}
      <section class="guide-wrap">
        ${Weather.tripList(D.plan.days.map((d) => d.date), day.date, (d) => { const x = D.plan.days.find((y) => y.date === d); return `${x.label} ${Number(d.slice(8))}`; })}
        <h2>Need to know</h2>
        ${guide}
      </section>
    </section>`;
  const on = document.querySelector(".today .chip-on");
  const row = on && on.parentElement;
  if (row && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - row.clientWidth / 2 + on.offsetWidth / 2);
}

// ---------------------------------------------------------------- NOW
function renderNow() {
  if (S.park === "SHIP") { Cruise.renderNow($("#view")); return; }
  const D = S.data, code = S.park, p = D.parks[code];
  const L = live(code);
  const sug = suggestions(code);
  const soon = showsSoon(code);

  const ps = parkState(code);
  const closedBanner = !ps.open ? `<div class="banner banner-closed"><p><b>${esc(ps.label)}.</b> Suggestions start when the park opens. The plan for the day is on the Today tab.</p></div>` : "";
  const geoBanner = !S.pos ? `<div class="banner"><p>Turn on location to sort by walking distance and see how far each ride is.</p><button type="button" class="btn" data-action="geo">${icon("locate")} Use my location</button></div>` : "";

  const sugHtml = sug.length ? sug.map((s) => `
    <li><button type="button" class="move" data-open="${s.a.key}">
      ${board(s.a, "board-lg")}
      <span class="move-body"><b>${esc(s.a.name)}</b><span class="move-why">${esc(s.why.slice(0, 3).join(". "))}</span>
      ${s.blocked.length ? `<span class="note-warn">${esc(s.blocked.join(", "))} too short${s.a.alternatives ? `: ${esc(s.a.alternatives[0].name)} nearby` : ""}</span>` : ""}</span>
    </button></li>`).join("") : `<li class="muted">${ps.open ? "Nothing to suggest right now. Try another park above." : "Nothing to suggest until the park opens."}</li>`;

  const soonHtml = soon.length ? `<section class="block"><h2>Shows starting soon</h2><ul class="soon">${soon.map((x) => `<li><button type="button" class="soon-row" data-open="${x.a.key}"><span class="soon-time">${esc(fmtTime(x.next))}</span><span>${esc(x.a.name)}${x.estimate ? ' <em class="note-soft">estimated time</em>' : ""}</span></button></li>`).join("")}</ul></section>` : "";

  const f = S.filters;
  let rides = D.attractions.filter((a) => a.park === code && a.status !== "closed" && a.kind !== "show");
  if (f.notDone) rides = rides.filter((a) => !rodeCount(a));
  if (f.allCan) rides = rides.filter((a) => !cantRide(a).length);
  if (f.calm) rides = rides.filter((a) => !isIntense(a));

  let listHtml = "";
  const row = (a) => {
    const w = waitInfo(a);
    const blocked = cantRide(a);
    const walk = walkFrom(a);
    const isRide = RIDE_KINDS.has(a.kind);
    const badges = [
      !isRide ? `<span class="tag">${esc(KIND_LABEL[a.kind] || "Experience")}</span>`
        : a.express ? (expressUsed(a) ? '<span class="tag tag-used">Express used</span>' : '<span class="tag tag-x">Express</span>') : '<span class="tag tag-nox">No Express</span>',
      a.minHeight ? `<span class="tag${blocked.length ? " tag-warn" : ""}">${a.minHeight}"</span>` : "",
      isIntense(a) ? '<span class="tag">Intense</span>' : "",
      w.live && w.live.single != null ? `<span class="tag">Single rider ${w.live.single}</span>` : "",
      walk != null ? `<span class="tag tag-walk">${walk} min walk</span>` : "",
    ].join("");
    return `<li class="ride${rodeCount(a) ? " ride-done" : ""}">
      <button type="button" class="ride-main" data-open="${a.key}">${board(a)}<span class="ride-body"><b>${esc(a.name)}</b><span class="tags">${badges}</span></span></button>
      <button type="button" class="done-btn" data-done="${a.key}" aria-pressed="${!!rodeCount(a)}" aria-label="${rodeCount(a) ? "Done" : "Mark done"}: ${esc(a.name)}">${icon("check")}${rodeCount(a) > 1 ? `<small>${rodeCount(a)}</small>` : ""}</button>
    </li>`;
  };
  if (S.sort === "land") {
    for (const land of p.lands) {
      const inLand = rides.filter((a) => a.land === land);
      if (!inLand.length) continue;
      inLand.sort((x, y) => (RIDE_KINDS.has(y.kind) - RIDE_KINDS.has(x.kind)) || (y.mustDo - x.mustDo));
      listHtml += `<h3 class="land land-${code}">${esc(land)}</h3><ul class="rides">${inLand.map(row).join("")}</ul>`;
    }
  } else {
    const val = (a) => {
      const w = waitInfo(a);
      if (S.sort === "walk") return walkFrom(a) ?? 999;
      return w.wait != null ? w.wait : w.open ? (RIDE_KINDS.has(a.kind) ? 500 + (a.typicalWait || 0) : 900) : 999;
    };
    listHtml = `<ul class="rides">${rides.slice().sort((x, y) => val(x) - val(y)).map(row).join("")}</ul>`;
  }

  const closed = !ps.open ? [] : D.attractions.filter((a) => a.park === code && (a.status === "closed" || ["DOWN"].includes(liveFor(a)?.status)) && a.kind !== "show");

  $("#view").innerHTML = `
    <section class="now">
      ${Weather.compact(orlandoNow().date, orlandoNow().time)}
      ${birthdayBanner()}
      ${closedBanner}
      ${geoBanner}
      <section class="block">
        <div class="block-head"><h2>Best moves right now</h2><button type="button" class="icon-btn" data-action="refresh" aria-label="Refresh wait times">${icon("refresh")}</button></div>
        <ul class="moves">${sugHtml}</ul>
        ${!L || !L.fetchedAt ? `<p class="fine">Until live waits load, numbers with ~ are typical peak waits, not live.</p>` : ""}
      </section>
      ${soonHtml}
      <section class="block">
        <div class="block-head"><h2>All rides in ${esc(p.short)}</h2></div>
        <div class="chips chips-wrap" role="group" aria-label="Filters">
          <button type="button" class="chip${f.notDone ? " chip-on" : ""}" data-filter="notDone" aria-pressed="${f.notDone}">Not done yet</button>
          <button type="button" class="chip${f.allCan ? " chip-on" : ""}" data-filter="allCan" aria-pressed="${f.allCan}">Everyone can ride</button>
          <button type="button" class="chip${f.calm ? " chip-on" : ""}" data-filter="calm" aria-pressed="${f.calm}">Skip intense</button>
        </div>
        <div class="seg" role="group" aria-label="Sort">
          ${["land", "wait", "walk"].map((k) => `<button type="button" data-sort="${k}" aria-pressed="${S.sort === k}">${{ land: "By land", wait: "Shortest wait", walk: "Closest" }[k]}</button>`).join("")}
        </div>
        ${listHtml || '<p class="muted">No rides match these filters.</p>'}
      </section>
      ${closed.length ? `<section class="block"><h2>Down or closed</h2><ul class="plain">${closed.map((a) => `<li><button type="button" class="link" data-open="${a.key}">${esc(a.name)}</button> <span class="muted">${esc(waitInfo(a).label)}</span></li>`).join("")}</ul></section>` : ""}
    </section>`;
}

// ---------------------------------------------------------------- MAP
let mapBuilt = false;
function ensureMap() {
  if (mapBuilt) { invalidate(); return; }
  if (typeof L === "undefined") { $("#mapEl").innerHTML = '<p class="empty">The map library didn\'t load. Reconnect and reopen this tab.</p>'; return; }
  initMap($("#mapEl"), { onSelect: (sel) => openSheet(sel), waitInfo: (a) => waitInfo(a) });
  mapBuilt = true;
  const tools = $("#mapTools");
  renderMapTools();
  tools.addEventListener("click", (e) => {
    const mp = e.target.closest("[data-mapport]");
    if (mp) { S.mapPort = mp.dataset.mapport; renderMap(); return; }
    if (e.target.closest("[data-action=offline]")) { saveOfflineMap(); return; }
    const b = e.target.closest("[data-layer]");
    if (b) {
      const k = b.dataset.layer;
      S.mapLayers[k] = !S.mapLayers[k];
      store.set("mapLayers", S.mapLayers);
      b.classList.toggle("chip-on", S.mapLayers[k]);
      b.setAttribute("aria-pressed", S.mapLayers[k]);
      showLayer(k, S.mapLayers[k]);
      return;
    }
    if (e.target.closest("[data-action=locate]")) {
      if (!S.geoOn) startGeo();
      if (S.pos) flyTo(S.pos.lat, S.pos.lng, 18);
    }
  });
  for (const [k, on] of Object.entries(S.mapLayers)) showLayer(k, on);
  if (S.park !== "SHIP") fitCurrentPark();
}

function renderMapTools() {
  const tools = $("#mapTools");
  if (S.park === "SHIP") {
    S.mapPort = S.mapPort || Cruise.defaultPort(orlandoNow().date);
    tools.innerHTML = Cruise.mapTools(S.mapPort);
    return;
  }
  tools.innerHTML = `
    <div class="chips" role="group" aria-label="Map layers">
      ${[["rides", "Rides"], ["shows", "Shows"], ["food", "Food"], ["hunts", "Hunts"]].map(([k, l]) => `<button type="button" class="chip${S.mapLayers[k] ? " chip-on" : ""}" data-layer="${k}" aria-pressed="${!!S.mapLayers[k]}">${l}</button>`).join("")}
    </div>
    <button type="button" class="fab" data-action="locate" aria-label="Show my location">${icon("locate")}</button>`;
}

async function saveOfflineMap() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) { toast("Close and reopen the app once, then try again."); return; }
  if (!navigator.onLine) { toast("Connect to Wi-Fi first, then save the map."); return; }
  const name = S.data.cruise.ports[S.mapPort].short;
  toast(`Saving the ${name} map…`);
  const ok = await Cruise.saveOffline(S.mapPort, (n) => toast(`Saving the ${name} map… ${n}`));
  toast(ok ? `Saved the ${name} map (${ok} pieces). It works offline now.` : "Couldn't save the map. Try again on Wi-Fi.");
}

function fitCurrentPark() {
  const pts = S.data.attractions.filter((a) => a.park === S.park && a.lat != null);
  fitPark(pts);
}

function renderMap() {
  if (!mapBuilt) return;
  if (S.park === "SHIP") {
    renderMapTools();
    const pts = Cruise.mapPlaces(S.mapPort);
    drawPlaces(pts);
    if (S.mapFitFor !== S.mapPort) { fitPark(pts.filter((p) => !p.nofit), true); S.mapFitFor = S.mapPort; }
    if (S.pendingPlace) { const p = Cruise.place(S.pendingPlace); S.pendingPlace = null; if (p && p.lat != null) setTimeout(() => flyTo(p.lat, p.lng, 17), 150); }
    if (S.pos) setUser(S.pos);
    return;
  }
  if (S.mapFitFor) { S.mapFitFor = null; renderMapTools(); fitCurrentPark(); }
  else renderMapTools();
  const code = S.park;
  drawMarkers({
    rides: S.data.attractions.filter((a) => a.park === code && RIDE_KINDS.has(a.kind)).map((a) => Object.assign(a, { done: rodeCount(a) > 0 })),
    shows: S.data.attractions.filter((a) => a.park === code && !RIDE_KINDS.has(a.kind) && a.status !== "closed"),
    food: S.data.food.filter((f) => f.park === code),
    hunts: S.data.hunts.filter((x) => x.park === code).map((x) => Object.assign(x, { found: !!S.hunts[x.key] })),
  });
  if (S.pos) setUser(S.pos);
  if (S.pendingFly) { const k = S.pendingFly; S.pendingFly = null; const a = S.data.byKey[k]; if (a && a.lat != null) flyTo(a.lat, a.lng, 19); }
}

// ---------------------------------------------------------------- EAT
function renderEat() {
  if (S.park === "SHIP") { Cruise.renderEat($("#view")); return; }
  const D = S.data;
  const code = S.eatPark;
  const inPark = (f) => code === "ALL" || f.park === code || (code === "USF" && f.park === "CityWalk");
  const bb = D.food.filter((f) => f.category === "butterbeer");
  const bbDone = bb.filter((f) => S.bb[f.key]).length;
  const bbList = bb.filter(inPark);

  const parkTabs = ["USF", "IOA", "EPIC", "ALL"].map((c) => `<button type="button" data-eatpark="${c}" aria-pressed="${code === c}">${c === "ALL" ? "All" : esc(D.parks[c].short)}</button>`).join("");

  const foodRow = (f, check) => `<li class="food${check && S.bb[f.key] ? " food-done" : ""}">
    <button type="button" class="food-main" data-food="${f.key}"><b>${esc(f.item)}</b><span>${esc(f.location)}${f.land && f.park !== "ALL" ? `, ${esc(f.land)}` : ""}${f.price ? ` <em>${esc(f.price)}</em>` : ""}</span></button>
    ${check ? `<button type="button" class="done-btn" data-bb="${f.key}" aria-pressed="${!!S.bb[f.key]}" aria-label="Tried ${esc(f.item)}">${icon("check")}</button>` : ""}
  </li>`;

  const sect = (title, list, note = "") => list.length ? `<section class="block"><h2>${esc(title)}</h2>${note ? `<p class="fine">${esc(note)}</p>` : ""}<ul class="foods">${list.map((f) => foodRow(f, false)).join("")}</ul></section>` : "";

  const by = (sectionStart) => D.food.filter((f) => (f.section || "").startsWith(sectionStart) && inPark(f));
  const DN = D.dining || { picks: [], alternates: [] };
  const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
  const today = orlandoNow().date;
  const picksHtml = DN.picks.map((d, i) => `<li class="meal${d.date === today ? " meal-today" : ""}${S.data.birthday && d.date === S.data.birthday.date && d.meal.includes("Birthday") ? " meal-bday" : ""}">
      <button type="button" class="meal-main" data-dining="pick-${i}">
        <span class="meal-when"><b>${esc(dayName(d.date))}</b><span>${esc(d.meal)}</span></span>
        <span class="meal-body"><b>${esc(d.name)}</b><span>${esc(d.area)}. ${esc(d.type)}</span>${/reserv|Resy|call/i.test(d.booking) && !/^No reservations/i.test(d.booking) ? '<span class="tag tag-warn">Book ahead</span>' : ""}</span>
      </button></li>`).join("");
  const alts = DN.alternates.map((d, i) => ({ d, i })).filter(({ d }) => code === "ALL" || d.park === code || (d.park == null && code === "USF"));

  $("#view").innerHTML = `
    <section class="eat">
      <section class="block">
        <h2>Our meals</h2>
        <p class="fine">Tap a meal for menu highlights, prices and how to book.</p>
        <ul class="meals">${picksHtml}</ul>
      </section>
      <div class="seg seg-park" role="group" aria-label="Park">${parkTabs}</div>
      <section class="block passport">
        <div class="block-head"><h2>Butterbeer passport</h2><span class="count">${bbDone} of ${bb.length} tried</span></div>
        <div class="meter" role="img" aria-label="${bbDone} of ${bb.length} tried"><span style="width:${Math.round((bbDone / bb.length) * 100)}%"></span></div>
        <p class="fine">Every Butterbeer form in the resort, with where to find it. Tap the check each time one gets tried.</p>
        <ul class="foods">${bbList.map((f) => foodRow(f, true)).join("") || '<li class="muted">No Butterbeer in this park. Switch parks above.</li>'}</ul>
      </section>
      ${alts.length ? `<section class="block"><h2>Other casual options${code === "USF" ? " (Studios and CityWalk)" : ""}</h2><ul class="foods">${alts.map(({ d, i }) => `<li class="food"><button type="button" class="food-main" data-dining="alt-${i}"><b>${esc(d.name)}</b><span>${esc(d.area)}. ${esc(d.highlights.slice(0, 3).join(", "))}${d.price ? ` <em>${esc(d.price)}</em>` : ""}</span></button></li>`).join("")}</ul></section>` : ""}
      ${sect("Churros", by("Churros"))}
      ${sect("Dole Whip and pineapple soft-serve", by("Dole Whip"))}
      ${sect("Macarons", by("Macarons"))}
      ${sect("Snacks worth finding", by("Iconic snacks"))}
      ${sect("Quick meals by land", by("5."), "Mobile order status changes; check the Universal app before you walk over.")}
      ${sect("Other Wizarding World treats", by("2."))}
      ${sect("Halloween season only", by("6."))}
    </section>`;
}

// ---------------------------------------------------------------- EXPLORE
function renderExplore() {
  if (S.park === "SHIP") { Cruise.renderExplore($("#view")); return; }
  const D = S.data, code = S.explorePark, p = D.parks[code];
  const now = orlandoNow();
  const parkTabs = ["USF", "IOA", "EPIC"].map((c) => `<button type="button" data-explorepark="${c}" aria-pressed="${code === c}">${esc(D.parks[c].short)}</button>`).join("");
  const hunts = D.hunts.filter((x) => x.park === code);
  const found = hunts.filter((x) => S.hunts[x.key]).length;
  let huntHtml = "";
  const lands = [...new Set(hunts.map((x) => x.land))];
  lands.sort((a, b) => p.lands.indexOf(a) - p.lands.indexOf(b));
  for (const land of lands) {
    const list = hunts.filter((x) => x.land === land);
    huntHtml += `<h3 class="land land-${code}">${esc(land)}</h3><ul class="hunts">${list.map((x) => `
      <li class="hunt${S.hunts[x.key] ? " hunt-found" : ""}">
        <button type="button" class="hunt-main" data-hunt-open="${x.key}"><b>${esc(x.title)}</b><span>${esc(x.where)}</span>${x.timed ? `<span class="timed">${esc(x.timed)}</span>` : ""}${x.verified === false ? '<em class="note-soft">Might have changed</em>' : ""}</button>
        <button type="button" class="done-btn" data-hunt="${x.key}" aria-pressed="${!!S.hunts[x.key]}" aria-label="Found: ${esc(x.title)}">${icon("check")}</button>
      </li>`).join("")}</ul>`;
  }

  const shows = D.shows.filter((s) => s.park === code);
  const showHtml = shows.map((s) => {
    const a = D.attractions.find((x) => x.park === code && normName(x.name) === normName(s.name));
    const L = a ? liveFor(a) : null;
    const times = L && L.showtimes && L.showtimes.length ? L.showtimes : s.times || [];
    const est = !(L && L.showtimes && L.showtimes.length);
    const tHtml = times.map((t) => `<span class="time${toMinutes(t) < now.minutes && now.date >= "2026-10-15" ? " time-past" : ""}">${fmtTime(t)}</span>`).join("");
    return `<li class="show"><b>${esc(s.name)}</b>${s.land ? `<span class="muted">${esc(s.land)}</span>` : ""}
      ${tHtml ? `<div class="times">${tHtml}</div>${est ? '<em class="note-soft">Estimated from recent schedules; the Universal app has the day\'s times.</em>' : ""}` : ""}
      ${s.notes ? `<p>${esc(s.notes)}</p>` : ""}</li>`;
  }).join("");

  const inter = D.interactive.filter((x) => x.park === code || x.park === "ALL");
  const photos = D.photos.filter((x) => x.park === code);

  $("#view").innerHTML = `
    <section class="explore">
      <div class="seg seg-park" role="group" aria-label="Park">${parkTabs}</div>
      <section class="block">
        <div class="block-head"><h2>Hidden details hunt</h2><span class="count">${found} of ${hunts.length} found</span></div>
        <div class="meter" role="img" aria-label="${found} of ${hunts.length} found"><span style="width:${hunts.length ? Math.round((found / hunts.length) * 100) : 0}%"></span></div>
        <p class="fine">Things for the kids to spot. Tap the check when someone finds it.</p>
        ${huntHtml || '<p class="muted">Nothing listed for this park yet.</p>'}
      </section>
      <section class="block"><h2>Shows and characters</h2><ul class="shows">${showHtml}</ul></section>
      <section class="block"><h2>Hands-on fun</h2><ul class="cards">${inter.map((x) => `<li><b>${esc(x.title)}</b>${x.cost ? `<span class="cost">${esc(x.cost)}</span>` : ""}<p>${esc(x.detail)}</p>${x.tip ? `<p class="fine">${esc(x.tip)}</p>` : ""}</li>`).join("")}</ul></section>
      ${photos.length ? `<section class="block"><h2>Photo spots</h2><ul class="plain">${photos.map((x) => `<li><b>${esc(x.title)}</b> <span class="muted">${esc(x.where)}</span></li>`).join("")}</ul></section>` : ""}
    </section>`;
}

// ---------------------------------------------------------------- events
function onViewClick(e) {
  const t = e.target.closest("button, a");
  if (!t) return;
  const ds = t.dataset;
  if (ds.day) {
    S.day = ds.day; store.set("day", S.day);
    syncModeToDay(S.data.plan.days.find((d) => d.date === ds.day));
    if (ds.goto) go(ds.goto); else renderToday();
    return;
  }
  if (Cruise.handleClick(ds)) return;
  if (ds.wish) { S.wish += 1; renderToday(); confetti(false); return; }
  if (ds.photo != null) { const i = ds.photo; S.photos[i] = !S.photos[i]; if (!S.photos[i]) delete S.photos[i]; store.set("bdayPhotos", S.photos); renderToday(); const d = document.querySelector(".bday-more"); if (d) d.open = true; if (S.photos[i]) confetti(false); return; }
  if (ds.dining) { const d = diningItem(ds.dining); if (d) openSheet({ type: "dining", item: d }); return; }
  if (ds.open) { const a = S.data.byKey[ds.open]; if (a) openSheet({ type: "ride", item: a }); return; }
  if (ds.done) { toggleDone(ds.done); return; }
  if (ds.filter) { S.filters[ds.filter] = !S.filters[ds.filter]; store.set("filters", S.filters); renderNow(); return; }
  if (ds.sort) { S.sort = ds.sort; store.set("sort", S.sort); if (S.sort === "walk" && !S.pos) startGeo(); renderNow(); return; }
  if (ds.mapto) { S.pendingFly = ds.mapto; const a = S.data.byKey[ds.mapto]; if (a && a.park !== S.park) pickPark(a.park, true); go("map"); return; }
  if (ds.action === "geo") { startGeo(); return; }
  if (ds.action === "refresh") { refresh(S.park); return; }
  if (ds.eatpark) { S.eatPark = ds.eatpark; renderEat(); return; }
  if (ds.explorepark) { S.explorePark = ds.explorepark; renderExplore(); return; }
  if (ds.food) { const f = S.data.food.find((x) => x.key === ds.food); if (f) openSheet({ type: "food", item: f }); return; }
  if (ds.bb) { S.bb[ds.bb] = !S.bb[ds.bb]; if (!S.bb[ds.bb]) delete S.bb[ds.bb]; store.set("bb", S.bb); renderEat(); return; }
  if (ds.hunt) { S.hunts[ds.hunt] = !S.hunts[ds.hunt]; if (!S.hunts[ds.hunt]) delete S.hunts[ds.hunt]; store.set("hunts", S.hunts); renderExplore(); return; }
  if (ds.huntOpen) { const x = S.data.hunts.find((h) => h.key === ds.huntOpen); if (x) openSheet({ type: "hunt", item: x }); return; }
}
function onViewChange() {}

function toggleDone(key) {
  if (rodeCount({ key })) delete S.rode[key]; else S.rode[key] = 1;
  store.set("rode", S.rode);
  renderView();
  if (S.sheet) renderSheet();
}

// ---------------------------------------------------------------- sheet
function openSheet(sel) {
  S.sheet = sel;
  S.confirm = null;
  renderSheet();
  $("#sheetWrap").hidden = false;
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => { $("#sheetWrap").classList.add("open"); $("#sheet").focus(); });
}
function closeSheet() {
  if (!S.sheet) return;
  S.sheet = null;
  $("#sheetWrap").classList.remove("open");
  document.body.classList.remove("sheet-open");
  setTimeout(() => { if (!S.sheet) $("#sheetWrap").hidden = true; }, 200);
}

function diningItem(key) {
  const [kind, i] = key.split("-");
  const DN = S.data.dining;
  return DN && (kind === "pick" ? DN.picks : DN.alternates)[Number(i)];
}

function walkButtons(item, label) {
  if (item.lat == null && !item.query) return "";
  const d = item.query ? queryLinks(item.query) : directionsLinks(item.lat, item.lng, label);
  const walk = walkFrom(item);
  return `<div class="sheet-actions">
    <a class="btn" href="${isApple ? d.apple : d.google}" target="_blank" rel="noopener">${icon("walk")} Walk there${walk != null ? ` (${walk} min)` : ""}</a>
    <a class="btn btn-quiet" href="${isApple ? d.google : d.apple}" target="_blank" rel="noopener">${isApple ? "Google Maps" : "Apple Maps"}</a>
    ${S.view !== "map" && item.lat != null ? `<button type="button" class="btn btn-quiet" data-sheet-map="1">${icon("map")} Show on map</button>` : ""}
  </div>`;
}

function renderSheet() {
  const sel = S.sheet;
  if (!sel) return;
  const el = $("#sheet");
  if (Cruise.renderSheet(sel, el)) return;
  if (sel.type === "ride") {
    const a = sel.item;
    const w = waitInfo(a);
    const blocked = cantRide(a);
    const L = w.live;
    const facts = [
      a.minHeight ? `${a.minHeight}" minimum` : "No height minimum",
      a.minutes ? `About ${a.minutes} min` : "",
      a.wet && a.wet !== "no" ? (a.wet === "soaked" ? "You will get soaked" : "You may get wet") : "",
      a.locker ? "Locker required" : "",
      a.motion === "high" ? "Hard on motion sickness" : "",
      a.singleRider ? "Single rider line" : "",
    ].filter(Boolean);
    const alts = (a.alternatives || []).map((x) => `<li><button type="button" class="link" ${x.key ? `data-sheet-open="${x.key}"` : "disabled"}>${esc(x.name)}</button> <span class="muted">${x.walk} min walk. ${esc(x.why)}</span></li>`).join("");
    const show = S.data.shows.find((x) => x.park === a.park && normName(x.name) === normName(a.name));
    const times = L && L.showtimes && L.showtimes.length ? L.showtimes : show ? show.times : [];
    el.innerHTML = `
      <div class="sheet-head">
        ${board(a, "board-xl")}
        <div><h2 id="sheetTitle">${esc(a.name)}</h2><p class="muted">${esc(S.data.parks[a.park].short)}, ${esc(a.land || "")}</p></div>
        <button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button>
      </div>
      <p class="sheet-status">${esc(w.label)}${a.typicalWait && w.wait != null ? `. Usually up to ~${a.typicalWait} min` : ""}${L && L.single != null ? `. Single rider ${L.single} min` : ""}</p>
      ${RIDE_KINDS.has(a.kind) || a.kind === "meet" ? `<div class="toggles">
        <button type="button" class="toggle${rodeCount(a) ? " toggle-on" : ""}" data-sheet-done="${a.key}" aria-pressed="${!!rodeCount(a)}">${icon("check")} ${rodeCount(a) ? "Done" : "Mark done"}</button>
        ${a.express ? `<button type="button" class="toggle${expressUsed(a) ? " toggle-on" : ""}" data-sheet-express="${a.key}" aria-pressed="${expressUsed(a)}">${expressUsed(a) ? "Express used today" : "Used Express today?"}</button>` : `<span class="tag tag-nox">No Express here</span>`}
      </div>` : ""}
      ${blocked.length ? `<div class="callout callout-warn"><b>${esc(blocked.join(" and "))} can't ride this one (${a.minHeight}" minimum).</b>${alts ? `<p>Nearby while the others ride:</p><ul class="plain">${alts}</ul>` : ""}<p class="fine">Use Rider Switch so the second adult doesn't line up again.</p></div>`
        : isIntense(a) && alts ? `<div class="callout"><b>Intense ride.</b> If anyone sits it out, nearby options:<ul class="plain">${alts}</ul></div>` : ""}
      ${times && times.length ? `<div class="times">${times.map((t) => `<span class="time">${fmtTime(t)}</span>`).join("")}</div>` : ""}
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${a.kidNote ? `<p><b>For the kids:</b> ${esc(a.kidNote)}</p>` : ""}
      ${a.tip ? `<p><b>Tip:</b> ${esc(a.tip)}</p>` : ""}
      ${walkButtons(a, a.name)}`;
  } else if (sel.type === "dining") {
    const d = sel.item;
    const when = d.date ? `${new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })} ${d.meal.toLowerCase()}${d.time ? `, ${fmtTime(d.time)}` : ""}` : "";
    el.innerHTML = `
      <div class="sheet-head"><div><h2 id="sheetTitle">${esc(d.name)}</h2><p class="muted">${esc(d.area)}. ${esc(d.type)}</p>${when ? `<p class="sheet-status">${esc(when)}</p>` : ""}</div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
      <ul class="facts">${(d.highlights || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${d.price ? `<p><b>Price:</b> ${esc(d.price)}</p>` : ""}
      ${d.kids ? `<p><b>Kids:</b> ${esc(d.kids)}</p>` : ""}
      ${d.booking ? `<p><b>Booking:</b> ${esc(d.booking)}</p>` : ""}
      ${d.birthday ? `<div class="callout callout-bday">${icon("cake")} <span>${esc(d.birthday)}</span></div>` : ""}
      ${d.note ? `<p>${esc(d.note)}</p>` : ""}
      ${d.backup ? `<div class="callout"><b>Backup:</b> ${esc(d.backup)}</div>` : ""}
      ${walkButtons(d, d.name)}`;
  } else if (sel.type === "food") {
    const f = sel.item;
    el.innerHTML = `
      <div class="sheet-head"><div><h2 id="sheetTitle">${esc(f.item)}</h2><p class="muted">${esc(f.location)}${f.land ? `, ${esc(f.land)}` : ""}</p></div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
      ${f.price ? `<p><b>${esc(f.price)}</b></p>` : ""}
      ${f.note ? `<p>${esc(f.note)}</p>` : ""}
      ${f.mobileOrder === true ? '<p class="fine">Mobile order available in the Universal app (check before walking over).</p>' : ""}
      ${f.exactPoint === false && f.lat != null ? '<p class="fine">Map point is the land, not the exact shop.</p>' : ""}
      ${walkButtons(f, f.location)}`;
  } else if (sel.type === "hunt") {
    const x = sel.item;
    el.innerHTML = `
      <div class="sheet-head"><div><h2 id="sheetTitle">${esc(x.title)}</h2><p class="muted">${esc(x.land || "")}</p></div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
      <p><b>Where:</b> ${esc(x.where)}</p>
      <p><b>Look for:</b> ${esc(x.look_for)}</p>
      ${x.timed ? `<p><b>When:</b> ${esc(x.timed)}</p>` : ""}
      <div class="toggles"><button type="button" class="toggle${S.hunts[x.key] ? " toggle-on" : ""}" data-sheet-hunt="${x.key}" aria-pressed="${!!S.hunts[x.key]}">${icon("check")} ${S.hunts[x.key] ? "Found it" : "Mark found"}</button></div>
      ${walkButtons(x, x.title)}`;
  } else if (sel.type === "settings") {
    renderSettings(el);
  }
}

function queryLinks(q) {
  const e = encodeURIComponent(q);
  return { apple: `https://maps.apple.com/?daddr=${e}&dirflg=w`, google: `https://www.google.com/maps/dir/?api=1&destination=${e}&travelmode=walking` };
}

function renderSettings(el) {
  const L = Object.entries(S.data.parks).map(([c, p]) => {
    const s = live(c);
    return `<li><b>${esc(p.short)}:</b> ${s && s.fetchedAt ? `${esc(s.source)} data, ${ago(s.fetchedAt)}` : "no data yet"}${s && s.error ? ` <span class="muted">(${esc(s.error)})</span>` : ""}</li>`;
  }).join("");
  const done = Object.keys(S.rode).length;
  el.innerHTML = `
    <div class="sheet-head"><div><h2 id="sheetTitle">Settings</h2></div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
    <section class="block">
      <h3>Riders</h3>
      <p class="fine">Heights in inches with shoes. The app flags rides anyone here is too short for. Saved on this phone only.</p>
      <ul class="riders">${S.riders.map((r, i) => `<li><label class="sr" for="rn${i}">Name</label><input id="rn${i}" data-rider-name="${i}" value="${esc(r.name)}" maxlength="24"><label class="sr" for="rh${i}">Height</label><input id="rh${i}" data-rider-height="${i}" type="number" inputmode="decimal" step="0.5" min="30" max="80" value="${esc(r.height)}"><span>in</span><button type="button" class="icon-btn" data-rider-del="${i}" aria-label="Remove ${esc(r.name)}">×</button></li>`).join("")}</ul>
      <button type="button" class="btn btn-quiet" data-rider-add="1">Add a rider</button>
    </section>
    <section class="block">
      <h3>Password</h3>
      <p class="fine">This phone stays unlocked. Lock it if you hand the phone to someone outside the family.</p>
      <button type="button" class="btn btn-quiet" data-lock="1">Lock this phone</button>
    </section>
    <section class="block">
      <h3>Progress on this phone</h3>
      <p>${done} rides done, ${Object.keys(S.hunts).length} details found, ${Object.keys(S.bb).length} Butterbeer forms tried.</p>
      ${S.confirm === "reset" ? `<div class="callout callout-warn"><p>Clear all rides done, details found and Butterbeer checks on this phone?</p><button type="button" class="btn btn-danger" data-reset-yes="1">Clear progress</button> <button type="button" class="btn btn-quiet" data-reset-no="1">Keep it</button></div>`
        : `<button type="button" class="btn btn-quiet" data-reset="1">Clear progress…</button>`}
    </section>
    <section class="block">
      <h3>Wait time data</h3>
      <ul class="plain">${L}</ul>
      <p class="fine">Live waits come from ThemeParks.wiki, a free public feed of Universal's posted times. Map data © OpenStreetMap contributors. Hours, closures, prices and show times were researched Oct 6, 2026 and can change; the official Universal app is the final word.</p>
    </section>`;
}

function onSheetClick(e) {
  const t = e.target.closest("button, a");
  if (!t) return;
  const ds = t.dataset;
  if (ds.close) { closeSheet(); return; }
  if (ds.portmap) { closeSheet(); if (S.park !== "SHIP") pickPark("SHIP", true); Cruise.handleClick(ds); return; }
  if (ds.sheetOpen) { const a = S.data.byKey[ds.sheetOpen]; if (a) openSheet({ type: "ride", item: a }); return; }
  if (ds.sheetDone) { toggleDone(ds.sheetDone); return; }
  if (ds.sheetExpress) { const a = S.data.byKey[ds.sheetExpress]; setExpressUsed(a, !expressUsed(a)); renderSheet(); renderView(); return; }
  if (ds.sheetHunt) { S.hunts[ds.sheetHunt] = !S.hunts[ds.sheetHunt]; if (!S.hunts[ds.sheetHunt]) delete S.hunts[ds.sheetHunt]; store.set("hunts", S.hunts); renderSheet(); renderView(); return; }
  if (ds.sheetMap) {
    const it = S.sheet.item;
    closeSheet();
    if (it.park && S.data.parks[it.park] && it.park !== S.park) pickPark(it.park, true);
    go("map");
    if (it.lat != null) setTimeout(() => flyTo(it.lat, it.lng, 19), 150);
    return;
  }
  if (ds.riderAdd) { S.riders.push({ name: "Rider", height: 48 }); store.set("riders", S.riders); renderSheet(); renderView(); return; }
  if (ds.riderDel) { S.riders.splice(Number(ds.riderDel), 1); store.set("riders", S.riders); renderSheet(); renderView(); return; }
  if (ds.reset) { S.confirm = "reset"; renderSheet(); return; }
  if (ds.resetNo) { S.confirm = null; renderSheet(); return; }
  if (ds.lock) { forgetKey(); location.reload(); return; }
  if (ds.resetYes) {
    S.rode = {}; S.hunts = {}; S.bb = {};
    store.set("rode", {}); store.set("hunts", {}); store.set("bb", {});
    S.confirm = null; renderSheet(); renderView(); return;
  }
}
function onSheetChange(e) {
  const t = e.target;
  if (t.dataset.riderName != null) { S.riders[Number(t.dataset.riderName)].name = t.value.trim() || "Rider"; }
  else if (t.dataset.riderHeight != null) { const v = parseFloat(t.value); if (isFinite(v)) S.riders[Number(t.dataset.riderHeight)].height = v; }
  else return;
  store.set("riders", S.riders);
  renderView();
}

// ---------------------------------------------------------------- location
let geoWatch = null;
function startGeo() {
  if (!("geolocation" in navigator)) { toast("This browser can't share location."); return; }
  if (geoWatch != null) return;
  geoWatch = navigator.geolocation.watchPosition((p) => {
    const first = !S.pos;
    S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
    if (!S.geoOn) { S.geoOn = true; store.set("geoOn", true); }
    autoPark();
    if (mapBuilt) setUser(S.pos);
    if (first || S.view === "now") throttleRender();
  }, (err) => {
    geoWatch = null;
    if (err.code === 1) { S.geoOn = false; store.set("geoOn", false); toast("Location is off for this site. Turn it on in your browser settings to sort by distance."); }
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
}

let renderTimer = null;
function throttleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; if (S.view !== "map") renderView(); }, 4000);
}

function autoPark() {
  if (S.park === "SHIP" || Cruise.isCruiseDate(orlandoNow().date)) return;
  if (Date.now() - S.parkPickedAt < 30 * 60 * 1000) return;
  let best = null;
  for (const p of Object.values(S.data.parks)) {
    const d = meters(S.pos, { lat: p.center[0], lng: p.center[1] });
    if (d < 700 && (!best || d < best.d)) best = { code: p.code, d };
  }
  if (best && best.code !== S.park) pickPark(best.code, false);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4500);
}
