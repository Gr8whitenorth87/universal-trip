// Cruise mode: the ship guide, port days and the all-aboard countdown.
import { orlandoNow, toMinutes, fmtTime, icon, store, isApple } from "./util.js";

let ctx = null; // { S, openSheet, rerender, toast, flyTo }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PORT_ORDER = ["COCO", "STT", "SKB"];

export function initCruise(c) { ctx = c; }
const C = () => ctx.S.data.cruise;

export function isCruiseDate(date) { const c = C(); return !!c && date >= c.start && date <= c.end; }
export function cruiseDays() { return ctx.S.data.plan.days.filter((d) => d.mode === "cruise"); }
export function dayFor(date) { return cruiseDays().find((d) => d.date === date) || null; }
export function place(key) { return C().places.find((p) => p.key === key) || null; }
export function spot(key) { return C().ship_spots.find((p) => p.key === key) || null; }

// The port the map should show: today's port, else the next one, else the last one.
export function defaultPort(date) {
  const days = cruiseDays();
  const today = days.find((d) => d.date === date);
  if (today && PORT_ORDER.includes(today.port)) return today.port;
  const next = days.find((d) => d.date >= date && PORT_ORDER.includes(d.port));
  return next ? next.port : "SKB";
}

function links(lat, lng, travel = "walk", q = "") {
  const a = travel === "drive" ? "d" : "w", g = travel === "drive" ? "driving" : "walking";
  const dest = lat != null ? `${lat},${lng}` : encodeURIComponent(q);
  return {
    apple: `https://maps.apple.com/?daddr=${dest}&dirflg=${a}${q && lat != null ? `&q=${encodeURIComponent(q)}` : ""}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${g}`,
  };
}
export function directionsHref(p) { const l = links(p.lat, p.lng, p.travel, p.name); return isApple ? l.apple : l.google; }

function dur(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function openNow(s, mins) {
  if (!s.hours) return false;
  return s.hours.some(([a, b]) => mins >= toMinutes(a) && mins < toMinutes(b));
}
function nextWindow(s, mins) {
  if (!s.hours) return null;
  const cur = s.hours.find(([a, b]) => mins >= toMinutes(a) && mins < toMinutes(b));
  if (cur) return { open: true, until: cur[1] };
  const nxt = s.hours.map(([a]) => a).filter((a) => toMinutes(a) > mins).sort()[0];
  return nxt ? { open: false, from: nxt } : null;
}
const untilLabel = (t) => (t === "23:59" ? "midnight" : fmtTime(t));

// ---------------------------------------------------------------- header + countdown
export function headerStatus(now) {
  const d = dayFor(now.date);
  const parts = [`<span>Ship time ${esc(fmtTime(now.time))}</span>`];
  if (!d) {
    const first = cruiseDays()[0];
    if (first && now.date < first.date) parts.push(`<span class="status-hours">Boarding ${esc(new Date(`${first.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</span>`);
  } else if (d.kind === "sea") parts.push(`<span class="status-hours">Sea day</span>`);
  else if (d.port && C().ports[d.port]) {
    const p = C().ports[d.port];
    parts.push(`<span class="status-hours">${esc(p.short)}${d.allAboard ? `, all aboard ${esc(fmtTime(d.allAboard))}` : ""}</span>`);
  }
  if (now.simulated) parts.push(`<span class="status-sim">Preview ${esc(now.date)} ${esc(fmtTime(now.time))}</span>`);
  return parts.join("");
}

export function countdown(day, now) {
  if (!day || !day.allAboard || day.date !== now.date) return "";
  const m = now.minutes, aa = toMinutes(day.allAboard), gw = day.gangway ? toMinutes(day.gangway) : null;
  const leave = day.leaveBy ? toMinutes(day.leaveBy) : null;
  let big, small, tone = "";
  if (gw != null && m < gw) {
    big = `Gangway opens in ${dur(gw - m)}`;
    small = `Off the ship from ${fmtTime(day.gangway)}. All aboard ${fmtTime(day.allAboard)}.`;
  } else if (m < aa) {
    const left = aa - m;
    big = `All aboard in ${dur(left)}`;
    small = day.kind === "embark" ? `Be on the ship by ${fmtTime(day.allAboard)}.` : `Back on the ship by ${fmtTime(day.allAboard)}.${leave != null ? (m < leave ? ` Head back by ${fmtTime(day.leaveBy)}.` : " Time to head back now.") : ""}`;
    tone = left <= 60 ? " cd-urgent" : leave != null && m >= leave ? " cd-warn" : "";
  } else {
    big = "All aboard has passed";
    small = "Everyone back on board? Enjoy the sail away.";
    tone = " cd-done";
  }
  return `<section class="countdown${tone}" aria-live="polite"><span class="cd-icon" aria-hidden="true">${icon("anchor")}</span><div><b>${esc(big)}</b><span>${esc(small)}</span></div></section>`;
}

export function dayHead(day, now) {
  if (!day || day.mode !== "cruise") return "";
  const p = day.port ? C().ports[day.port] : null;
  const times = day.gangway ? `<div class="port-times"><span><small>Gangway</small><b>${fmtTime(day.gangway)}</b></span><span><small>All aboard</small><b>${fmtTime(day.allAboard)}</b></span></div>`
    : day.allAboard ? `<div class="port-times"><span><small>All aboard</small><b>${fmtTime(day.allAboard)}</b></span></div>` : "";
  const info = p && day.kind === "port" ? `<ul class="port-facts">${p.currency ? `<li><b>Money:</b> ${esc(p.currency)}</li>` : ""}${p.phone ? `<li><b>Phones:</b> ${esc(p.phone)}</li>` : ""}</ul>` : "";
  return `${countdown(day, now)}
    ${p || times ? `<div class="port-card port-${esc(day.kind)}">${p ? `<div><b>${esc(p.name)}</b><span>${esc(p.where || "")}</span></div>` : ""}${times}</div>` : ""}
    ${info}`;
}

export function dayFoot(day) {
  if (!day || day.mode !== "cruise") return "";
  return `${day.skip ? `<div class="callout"><b>Skip list:</b> ${esc(day.skip)}</div>` : ""}${day.alt ? `<div class="callout"><b>Other option:</b> ${esc(day.alt)}</div>` : ""}`;
}

// Extra content inside a Today step: port places, ship spots, beach choices.
export function stepExtras(s) {
  let out = "";
  if (s.choices) {
    out += `<div class="choices">${s.choices.map((c) => {
      const pl = (c.places || []).map(place).filter(Boolean)[0];
      return `<div class="choice"><div class="choice-head"><b>${esc(c.title)}</b>${c.tag ? `<span class="tag">${esc(c.tag)}</span>` : ""}</div>
        <p>${esc(c.detail)}</p><p class="choice-cost">${esc(c.cost)}</p><p class="fine">${esc(c.leave || "")}</p>
        ${pl ? `<div class="step-actions"><button type="button" class="btn btn-quiet" data-place="${pl.key}">Details</button><a class="btn btn-quiet" href="${directionsHref(pl)}" target="_blank" rel="noopener">${icon("map")} Directions</a></div>` : ""}
      </div>`;
    }).join("")}</div>`;
    if (s.fallback) out += `<p class="fine">${esc(s.fallback)}${(s.fallbackPlaces || []).map((k) => place(k)).filter(Boolean).map((p) => ` <button type="button" class="link" data-place="${p.key}">${esc(p.name)}</button>`).join("")}</p>`;
  }
  const pls = (s.places || []).map(place).filter(Boolean);
  if (pls.length) {
    out += `<ul class="chiplist">${pls.map((p) => `<li><button type="button" class="pchip pchip-${esc(p.type)}" data-place="${p.key}">${esc(p.name)}${p.free === false ? ' <em>$</em>' : ""}</button></li>`).join("")}</ul>`;
    const first = pls.find((p) => p.lat != null);
    if (first) out += `<div class="step-actions"><button type="button" class="btn btn-quiet" data-portmap="${first.port}" data-flyto="${first.key}">${icon("map")} Show on map</button><a class="btn btn-quiet" href="${directionsHref(first)}" target="_blank" rel="noopener">${icon(first.travel === "drive" ? "map" : "walk")} Directions</a></div>`;
  }
  const sps = (s.ship || []).map(spot).filter(Boolean);
  if (sps.length) {
    out += `<ul class="chiplist">${sps.map((p) => {
      const blocked = ctx.cantRide(p);
      return `<li><button type="button" class="pchip pchip-ship${blocked.length ? " pchip-warn" : ""}" data-ship="${p.key}">${esc(p.name)}<span>${esc(p.where.split(",")[0])}</span>${blocked.length ? `<em>${esc(blocked.join(", "))}: too short</em>` : ""}</button></li>`;
    }).join("")}</ul>`;
  }
  if (s.query && !pls.length) {
    const l = links(null, null, s.travel, s.query);
    out += `<div class="step-actions"><a class="btn btn-quiet" href="${isApple ? l.apple : l.google}" target="_blank" rel="noopener">${icon("map")} Directions</a></div>`;
  }
  return out;
}

// ---------------------------------------------------------------- NOW
export function renderNow(el) {
  const now = orlandoNow();
  const day = dayFor(now.date);
  const first = cruiseDays()[0];
  if (!day) {
    const before = first && now.date < first.date;
    el.innerHTML = `<section class="now">
      <div class="banner banner-closed"><p><b>${before ? `The cruise starts ${esc(new Date(`${first.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}.` : "The cruise is over. Welcome home!"}</b> ${before ? "This screen turns into the ship guide on boarding day: what's open on board, the kids club, and the all-aboard countdown on port days." : ""}</p></div>
      ${before ? `<button type="button" class="btn btn-quiet" data-day="${first.date}" data-goto="today">See boarding day</button>` : ""}
      ${foodNow(now, true)}
    </section>`;
    return;
  }
  const steps = day.steps;
  let idx = -1;
  steps.forEach((s, i) => { if (toMinutes(s.time) <= now.minutes) idx = i; });
  const upcoming = steps.slice(Math.max(idx, 0), Math.max(idx, 0) + 3);
  const ao = spot("adventure-ocean");
  let kids = "";
  if (ao) {
    if (day.kind === "port" && day.gangway && now.minutes >= toMinutes(day.gangway) && now.minutes < toMinutes(day.allAboard)) kids = "Open the whole time the ship is in port.";
    else {
      const w = nextWindow(ao, now.minutes);
      kids = w ? (w.open ? `Session on now, until ${untilLabel(w.until)}.` : `Next session at ${fmtTime(w.from)}.`) : "Done for today. The late-night session (10pm–1am) costs $15 an hour per child.";
    }
  }
  const dinner = steps.find((s) => s.kind === "meal" && toMinutes(s.time) >= 17 * 60);
  const ashore = day.kind === "port" && day.gangway && now.minutes >= toMinutes(day.gangway) && now.minutes < toMinutes(day.allAboard);
  const todaysPlaces = [...new Set(steps.flatMap((s) => [...(s.places || []), ...(s.choices || []).flatMap((c) => c.places || [])]))].map(place).filter((p) => p && p.lat != null);
  el.innerHTML = `<section class="now">
    ${countdown(day, now)}
    <section class="block">
      <div class="block-head"><h2>${esc(day.title)}</h2></div>
      <ul class="upnext">${upcoming.map((s, i) => `<li class="${i === 0 && idx >= 0 ? "upnext-now" : ""}"><span class="soon-time">${esc(fmtTime(s.time))}</span><span><b>${esc(s.title)}</b><span class="muted">${esc(s.detail)}</span></span></li>`).join("")}</ul>
      <button type="button" class="btn btn-quiet" data-day="${day.date}" data-goto="today">Full plan for today</button>
    </section>
    ${ashore && todaysPlaces.length ? `<section class="block"><h2>Ashore today</h2>
      <ul class="foods">${todaysPlaces.map((p) => `<li class="food"><button type="button" class="food-main" data-place="${p.key}"><b>${esc(p.name)}</b><span>${esc(p.detail)}</span></button><a class="done-btn dir-btn" href="${directionsHref(p)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(p.name)}">${icon("map")}</a></li>`).join("")}</ul>
      <button type="button" class="btn btn-quiet" data-portmap="${day.port}">Open the ${esc(C().ports[day.port].short)} map</button></section>` : foodNow(now, false)}
    <section class="block">
      <h2>Kids club</h2>
      <button type="button" class="info-row" data-ship="adventure-ocean"><b>Adventure Ocean</b><span>${esc(kids)}</span><span class="muted">Deck 7, next to Surfside</span></button>
    </section>
    ${dinner ? `<section class="block"><h2>Tonight</h2><button type="button" class="info-row" data-ship="dining-room"><b>${esc(fmtTime(dinner.time))}: ${esc(dinner.title.replace(/^Dinner: /, ""))}</b><span>${esc(dinner.detail)}</span></button>
      <p class="fine">Kids hungry early? Surfside Eatery serves dinner from about 5pm, then Adventure Ocean runs 7–10pm.</p></section>` : ""}
    <p class="fine">Show times, trivia and parties change daily: check the Royal Caribbean app's planner. It works on ship Wi-Fi without a package.</p>
  </section>`;
}

function foodNow(now, all) {
  const food = C().ship_spots.filter((s) => s.type === "food" && s.included);
  const rows = food.map((s) => ({ s, w: nextWindow(s, now.minutes) }))
    .filter((x) => all || (x.w && x.w.open))
    .sort((a, b) => (b.w?.open ? 1 : 0) - (a.w?.open ? 1 : 0));
  if (!rows.length) return "";
  return `<section class="block">
    <div class="block-head"><h2>${all ? "Free food on board" : "Free food open now"}</h2></div>
    <ul class="foods">${rows.map(({ s, w }) => `<li class="food"><button type="button" class="food-main" data-ship="${s.key}"><b>${esc(s.name)}</b><span>${esc(s.where)}. ${esc((s.kid || []).slice(0, 2).join(", "))}${w ? ` <em>${w.open ? `until ${untilLabel(w.until)}` : `opens ${fmtTime(w.from)}`}</em>` : ""}</span></button></li>`).join("")}</ul>
    <p class="fine">Hours are approximate; the Royal Caribbean app has each day's times.</p>
  </section>`;
}

// ---------------------------------------------------------------- EAT
export function renderEat(el) {
  const c = C();
  const now = orlandoNow();
  const onShip = isCruiseDate(now.date);
  const food = c.ship_spots.filter((s) => s.type === "food");
  const coco = c.places.filter((p) => p.type === "food");
  el.innerHTML = `<section class="eat">
    <section class="block">
      <h2>Dinner every night</h2>
      <button type="button" class="info-row info-row-hl" data-ship="dining-room"><b>${esc(c.dinner.title)}</b><span>${esc(c.dinner.detail)}</span></button>
      <p class="fine">${esc(c.dinner.note)}</p>
    </section>
    <section class="block">
      <div class="block-head"><h2>Free food on board</h2></div>
      <ul class="foods">${food.map((s) => {
        const w = onShip ? nextWindow(s, now.minutes) : null;
        return `<li class="food"><button type="button" class="food-main" data-ship="${s.key}"><b>${esc(s.name)}</b><span>${esc(s.where)}. ${esc((s.kid || []).slice(0, 3).join(", "))}${w ? ` <em>${w.open ? `open until ${untilLabel(w.until)}` : `opens ${fmtTime(w.from)}`}</em>` : ""}</span></button></li>`;
      }).join("")}</ul>
      <p class="fine">${esc(c.free_drinks)}</p>
    </section>
    <section class="block">
      <h2>Port day food</h2>
      <ul class="foods">${coco.map((p) => `<li class="food"><button type="button" class="food-main" data-place="${p.key}"><b>${esc(p.name)} (${esc(c.ports[p.port].short)})</b><span>${esc(p.detail)}</span></button></li>`).join("")}
        ${(c.port_food || []).map((f) => `<li class="food"><div class="food-main"><b>${esc(f.title)}</b><span>${esc(f.detail)}</span></div></li>`).join("")}
      </ul>
    </section>
    <details class="guide"><summary>Costs extra (skip these)</summary><ul class="plain">${c.extras.map((x) => `<li><b>${esc(x.name)}</b> <span class="muted">${esc(x.note)}</span></li>`).join("")}</ul></details>
  </section>`;
}

// ---------------------------------------------------------------- EXPLORE
export function renderExplore(el) {
  const c = C(), S = ctx.S;
  const hunt = c.hunt.map((h, i) => ({ ...h, key: `ship-hunt-${i}` }));
  const finds = c.port_finds.map((h, i) => ({ ...h, key: `port-find-${i}` }));
  const found = hunt.filter((h) => S.hunts[h.key]).length;
  const huntRow = (h, sub) => `<li class="hunt${S.hunts[h.key] ? " hunt-found" : ""}">
      <div class="hunt-main"><b>${esc(h.title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}<span>${esc(h.look_for)}</span>${h.verified === false ? '<em class="note-soft">Might not be on this ship</em>' : ""}</div>
      <button type="button" class="done-btn" data-hunt="${h.key}" aria-pressed="${!!S.hunts[h.key]}" aria-label="Found: ${esc(h.title)}">${icon("check")}</button></li>`;
  const thrills = c.ship_spots.filter((s) => ["slide", "activity", "kids", "pool"].includes(s.type));
  const thrillRow = (s) => {
    const blocked = ctx.cantRide(s);
    return `<li class="ride"><button type="button" class="ride-main" data-ship="${s.key}"><span class="ride-body"><b>${esc(s.name)}</b><span class="tags">
      <span class="tag">${esc(s.where.split(",")[0])}</span>
      ${s.minHeight ? `<span class="tag${blocked.length ? " tag-warn" : ""}">${s.minHeight}"${blocked.length ? `: ${esc(blocked.join(", "))} too short` : ""}</span>` : ""}
      ${s.included ? '<span class="tag tag-x">Free</span>' : '<span class="tag tag-warn">Costs extra</span>'}</span></span></button></li>`;
  };
  el.innerHTML = `<section class="explore">
    <section class="block">
      <div class="block-head"><h2>Ship scavenger hunt</h2><span class="count">${found} of ${hunt.length} found</span></div>
      <div class="meter" role="img" aria-label="${found} of ${hunt.length} found"><span style="width:${Math.round((found / hunt.length) * 100)}%"></span></div>
      <ul class="hunts">${hunt.map((h) => huntRow(h, h.where)).join("")}</ul>
    </section>
    <section class="block">
      <h2>Port finds</h2>
      ${PORT_ORDER.map((p) => `<h3 class="land">${esc(c.ports[p].short)}</h3><ul class="hunts">${finds.filter((f) => f.port === p).map((f) => huntRow(f)).join("")}</ul>`).join("")}
    </section>
    <section class="block">
      <h2>Slides, sports and the kids club</h2>
      <p class="fine">Heights are usually measured barefoot, so allow about half an inch less than with shoes.</p>
      <ul class="rides">${thrills.map(thrillRow).join("")}</ul>
    </section>
    <section class="block">
      <h2>Shows</h2>
      <div class="callout callout-warn">${esc(c.showNote)}</div>
      <ul class="cards">${c.shows.map((s) => `<li><b>${esc(s.name)}</b><span class="cost">${s.reserve ? "Reserve in the app" : "No reservation"}</span><p>${esc(s.where)}. ${esc(s.detail)}</p></li>`).join("")}</ul>
    </section>
    <section class="block"><h2>Halloween on board</h2><p>${esc(c.halloween)}</p></section>
    <section class="block"><h2>Adults only</h2><p class="fine">Good to know before the kids run over:</p><ul class="plain">${c.adults_only.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>
    <section class="guide-wrap"><h2>Need to know</h2>${c.tips.map((t) => `<details class="guide"><summary>${esc(t.title)}</summary><p>${esc(t.body)}</p></details>`).join("")}</section>
  </section>`;
}

// ---------------------------------------------------------------- map
export function mapTools(port) {
  const c = C();
  return `<div class="chips" role="group" aria-label="Port">
      ${PORT_ORDER.map((p) => `<button type="button" class="chip${p === port ? " chip-on" : ""}" data-mapport="${p}" aria-pressed="${p === port}">${esc(c.ports[p].short)}</button>`).join("")}
    </div>
    <div class="map-side"><button type="button" class="fab" data-action="locate" aria-label="Show my location">${icon("locate")}</button><button type="button" class="fab" data-action="offline" aria-label="Save this port's map for offline">${icon("download")}</button></div>`;
}
export function mapPlaces(port) { return C().places.filter((p) => p.port === port && p.lat != null); }

// Save a modest set of map tiles around each spot so the port map works without signal.
export async function saveOffline(port, onProgress) {
  const pts = mapPlaces(port);
  if (!pts.length) return 0;
  const tile = (lat, lng, z) => {
    const n = 2 ** z, r = (lat * Math.PI) / 180;
    return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
  };
  const set = new Set();
  const box = (la1, ln1, la2, ln2, z) => {
    const [x1, y1] = tile(Math.max(la1, la2), Math.min(ln1, ln2), z), [x2, y2] = tile(Math.min(la1, la2), Math.max(ln1, ln2), z);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) set.add(`${z}/${x}/${y}`);
  };
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  for (const z of [12, 13, 14]) box(Math.min(...lats) - 0.01, Math.min(...lngs) - 0.01, Math.max(...lats) + 0.01, Math.max(...lngs) + 0.01, z);
  for (const p of pts) for (const z of [15, 16]) box(p.lat - 0.004, p.lng - 0.004, p.lat + 0.004, p.lng + 0.004, z);
  const list = [...set].slice(0, 400);
  let done = 0, ok = 0;
  const worker = async () => {
    while (list.length) {
      const t = list.shift();
      try { const r = await fetch(`https://tile.openstreetmap.org/${t}.png`, { mode: "cors", credentials: "omit" }); if (r.ok) ok++; } catch { /* offline */ }
      done++;
      if (done % 10 === 0) onProgress && onProgress(done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return ok;
}

// ---------------------------------------------------------------- sheets + clicks
export function renderSheet(sel, el) {
  if (sel.type === "place") {
    const p = sel.item;
    el.innerHTML = `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(p.name)}</h2><p class="muted">${esc(C().ports[p.port].short)}${p.free === false ? ". Costs extra" : p.free ? ". Free" : ""}</p></div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
      <p>${esc(p.detail)}</p>
      ${p.approx ? '<p class="fine">Map point is approximate.</p>' : ""}
      ${p.lat != null ? `<div class="sheet-actions"><a class="btn" href="${directionsHref(p)}" target="_blank" rel="noopener">${icon("map")} Directions${p.travel === "drive" ? " (taxi)" : ""}</a>${ctx.S.view !== "map" ? `<button type="button" class="btn btn-quiet" data-portmap="${p.port}" data-flyto="${p.key}">Show on map</button>` : ""}</div>` : ""}`;
    return true;
  }
  if (sel.type === "ship") {
    const s = sel.item;
    const blocked = ctx.cantRide(s);
    const now = orlandoNow();
    const w = isCruiseDate(now.date) ? nextWindow(s, now.minutes) : null;
    el.innerHTML = `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(s.name)}</h2><p class="muted">${esc(s.where)}${s.included === false ? ". Costs extra" : ". Included"}</p></div><button type="button" class="icon-btn close" data-close="1" aria-label="Close">×</button></div>
      ${w ? `<p class="sheet-status">${w.open ? `Open now, until ${untilLabel(w.until)}` : `Opens at ${fmtTime(w.from)}`} (approximate)</p>` : ""}
      ${s.kid && s.kid.length ? `<ul class="facts">${s.kid.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
      ${s.minHeight ? `<p><b>${s.minHeight}" minimum.</b></p>` : ""}
      ${blocked.length ? `<div class="callout callout-warn"><b>${esc(blocked.join(" and "))} can't do this one.</b>${s.alternatives ? `<p>${esc(s.alternatives)}</p>` : ""}</div>` : ""}
      <p>${esc(s.detail)}</p>
      <p class="fine">Deck maps are in the Royal Caribbean app.</p>`;
    return true;
  }
  return false;
}

export function handleClick(ds) {
  const S = ctx.S;
  if (ds.place) { const p = place(ds.place); if (p) ctx.openSheet({ type: "place", item: p }); return true; }
  if (ds.ship) { const s = spot(ds.ship); if (s) ctx.openSheet({ type: "ship", item: s }); return true; }
  if (ds.portmap) { S.mapPort = ds.portmap; S.pendingPlace = ds.flyto || null; ctx.showMap(); return true; }
  return false;
}
