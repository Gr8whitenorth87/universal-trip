// Deck guide: a side view to pick a deck, the official deck plan for that deck (encrypted
// like the rest of the trip data), "where is…" search, our own spots, and directions from
// the cabins. Venue positions (x, y) are in the official plan's coordinates; front is up.
import { icon } from "./util.js";
import { savedKey } from "./lock.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ZONES = ["aft", "mid", "fore"];
const ZONE_NAME = { fore: "front", mid: "middle", aft: "back" };
const ZONE_LABEL = { aft: "Back (aft)", mid: "Middle", fore: "Front (bow)" };
const KIND_LABEL = { food: "Food", pool: "Pool", slide: "Slides", activity: "Activity", show: "Show", kids: "Kids", service: "Service", adult: "Adults only", shop: "Shop", bar: "Bar", cabins: "Cabins", you: "Yours" };
const LEGEND = [["food", "Food"], ["pool", "Pools"], ["slide", "Slides and sports"], ["kids", "Kids"], ["show", "Shows"], ["bar", "Bars"], ["service", "Services"], ["adult", "Adults only"]];
// Plan coordinates: the bow is near y=48 and the stern near y=755 on every deck.
const BOW = 48, LEN = 707;
const ZOOMS = { min: 1, max: 3.2 };

let state = { deck: null, q: "", open: null, zoom: 1, full: false, scroll: null };

function G() { return window.__deckData; }
export function setData(d) { window.__deckData = d; if (state.deck == null && d) state.deck = d.home ? d.home.deck : d.decks[0].n; }

const pad2 = (n) => String(n).padStart(2, "0");
const planMeta = (n) => { const P = G().plans; return P ? P[pad2(n)] : null; };
export function zoneOf(v) {
  if (v.y == null) return v.zone || "mid";
  return v.y < 330 ? "fore" : v.y < 520 ? "mid" : "aft";
}
function bankY(deck) {
  const list = (G().home && G().home.bankY) || [[0, 540]];
  let y = list[0][1];
  for (const [from, val] of list) if (deck >= from) y = val;
  return y;
}

// Plain-language route from the cabins, which sit right beside the back elevator bank.
export function directions(v) {
  if (v.dir != null) return v.dir;
  const h = G().home;
  if (!h || v.deck == null) return "";
  const zone = zoneOf(v);
  if (v.deck === h.deck) return (h.same && h.same[zone]) || `Stay on Deck ${v.deck} and walk toward the ${ZONE_NAME[zone]} of the ship.`;
  const ud = v.deck > h.deck ? "up" : "down";
  if (v.y == null) return `Take the elevators by your cabins ${ud} to Deck ${v.deck}${zone === "aft" ? "" : `, then walk toward the ${ZONE_NAME[zone]}`}.`;
  const d = v.y - bankY(v.deck);
  let tail;
  if (Math.abs(d) <= 45) tail = "; it's right by the elevators.";
  else if (d > 0) tail = ", then walk toward the back.";
  else if (v.y < 300) tail = ", then walk forward to the front of the ship. (Or walk forward through Central Park and take the front elevators.)";
  else tail = ", then walk forward.";
  return `Take the elevators by your cabins ${ud} to Deck ${v.deck}${tail}`;
}

// ---------- official plans ----------
const urls = new Map();
function planURL(n) {
  const key = pad2(n);
  if (urls.has(key)) return urls.get(key);
  const p = (async () => {
    const meta = planMeta(n);
    if (!meta) throw new Error("no plan");
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const k = await savedKey();
    if (!k) throw new Error("locked");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k, buf.slice(12));
    const svg = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    ready.set(key, url);
    return url;
  })();
  urls.set(key, p);
  p.catch(() => urls.delete(key));
  return p;
}
const ready = new Map();

function pct(v, meta) {
  const [x0, y0, w, h] = meta.vb;
  return { l: ((v.x - x0) / w) * 100, t: ((v.y - y0) / h) * 100 };
}

function planHTML(n) {
  const meta = planMeta(n);
  if (!meta) return "";
  const [, , w, h] = meta.vb;
  const ven = state.open && G().venues.find((x) => x.id === state.open && x.deck === n && x.x != null);
  const pin = ven ? (() => { const p = pct(ven, meta); return `<span class="dk-pin" style="left:${p.l.toFixed(2)}%;top:${p.t.toFixed(2)}%"><i></i><b>${esc(ven.name)}</b></span>`; })() : "";
  const src = ready.get(pad2(n));
  return `<div class="dk-plan${state.full ? " dk-plan-full" : ""}" id="dkPlan">
    <div class="dk-plan-bar">
      <span class="dk-plan-cap">${icon("up")} Front of ship</span>
      <span class="dk-plan-btns">
        <button type="button" class="dk-pbtn" data-dkzoom="-1" aria-label="Zoom out">&minus;</button>
        <button type="button" class="dk-pbtn" data-dkzoom="1" aria-label="Zoom in">+</button>
        <button type="button" class="dk-pbtn dk-pbtn-wide" data-dkfull="1">${state.full ? "Close" : "Full screen"}</button>
      </span>
    </div>
    <div class="dk-plan-frame" id="dkFrame" tabindex="0" aria-label="Official plan of Deck ${n}. Scroll to move, pinch or use the buttons to zoom.">
      <div class="dk-plan-inner" id="dkInner" style="width:${(state.zoom * 100).toFixed(1)}%;aspect-ratio:${w.toFixed(2)} / ${h.toFixed(2)}">
        <img class="dk-plan-img" id="dkImg" alt="Official plan of Deck ${n}"${src ? ` src="${src}"` : ""}>
        ${src ? "" : '<span class="dk-plan-wait">Loading the plan…</span>'}
        ${pin}
      </div>
    </div>
    <p class="dk-plan-foot"><span>Back of ship</span><span>Plan: Royal Caribbean</span></p>
  </div>`;
}

function sideView(sel) {
  const D = G();
  const nums = D.decks.map((d) => d.n);
  const top = Math.max(...nums), bottom = Math.min(...nums);
  const rows = top - bottom + 1, rh = 15, W = 340, padT = 18, H = padT + rows * rh + 26;
  const y = (n) => padT + (top - n) * rh;
  // Hull outline (simplified, not to scale). Bow on the right.
  const hullTop = y(D.hullTop || 6);
  const base = H - 22;
  const hull = `M4 ${hullTop} L${W - 1} ${hullTop - 7} Q${W - 16} ${base - 18} ${W - 40} ${base} L24 ${base} Q10 ${base} 8 ${base - 14} Z`;
  const deckRows = D.decks.map((d) => {
    const yy = y(d.n);
    const meta = planMeta(d.n);
    // Deck length from the official plan when we have it (front at the right).
    let w = d.span || [0, 1];
    if (meta && (meta.vb[1] > BOW + 40 || meta.vb[1] + meta.vb[3] < BOW + LEN - 40)) {
      w = [Math.max(0, 1 - (meta.vb[1] + meta.vb[3] - BOW) / LEN), Math.min(1, 1 - (meta.vb[1] - BOW) / LEN)];
    }
    const x1 = 10 + w[0] * (W - 20), x2 = 10 + w[1] * (W - 20);
    const on = d.n === sel;
    const home = D.home && D.home.deck === d.n;
    const dots = ZONES.map((z, i) => {
      const items = D.venues.filter((v) => v.deck === d.n && zoneOf(v) === z && v.kind !== "you");
      if (!items.length) return "";
      let cx = 10 + ((i + 0.5) / 3) * (W - 20);
      cx = Math.min(Math.max(cx, x1 + 6), x2 - 6);
      return `<circle cx="${cx}" cy="${yy + rh / 2}" r="3.2" class="dk-dot dk-dot-${esc(items[0].kind)}"/>`;
    }).join("");
    const star = home ? (() => { const hx = D.home.y != null ? 1 - (D.home.y - BOW) / LEN : 1 / 6; const cx = 10 + hx * (W - 20) + 10; return `<path class="dk-home" d="M${cx} ${yy + 2.5}l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z"/>`; })() : "";
    return `<g class="dk-row${on ? " dk-on" : ""}" data-deck="${d.n}" role="button" tabindex="0" aria-label="Deck ${d.n}${d.name ? `: ${esc(d.name)}` : ""}">
      <rect x="${x1}" y="${yy + 1}" width="${x2 - x1}" height="${rh - 2}" rx="3"/>
      <text x="${x1 - 4}" y="${yy + rh / 2 + 4}" text-anchor="end" class="dk-num">${d.n}</text>${dots}${star}</g>`;
  }).join("");
  const dividers = [1, 2].map((i) => { const x = 10 + (i / 3) * (W - 20); return `<line x1="${x}" y1="${padT - 4}" x2="${x}" y2="${H - 24}" class="dk-div"/>`; }).join("");
  return `<svg class="dk-svg" viewBox="-14 0 ${W + 16} ${H}" role="group" aria-label="Side view of the ship. Tap a deck.">
    <path d="${hull}" class="dk-hull"/>${dividers}${deckRows}
    <text x="10" y="${H - 6}" class="dk-cap">Back</text><text x="${W / 2}" y="${H - 6}" text-anchor="middle" class="dk-cap">Middle</text><text x="${W - 10}" y="${H - 6}" text-anchor="end" class="dk-cap">Front (bow)</text>
  </svg>`;
}

function venueRow(v) {
  const dir = directions(v);
  const z = zoneOf(v);
  const onPlan = v.x != null && planMeta(v.deck);
  return `<li class="dk-v dk-v-${esc(v.kind)}"><button type="button" class="dk-v-btn" data-dkv="${esc(v.id)}" aria-expanded="${state.open === v.id}">
    <span class="dk-v-dot" aria-hidden="true"></span>
    <span class="dk-v-body"><b>${esc(v.name)}</b><span>Deck ${v.deck}, ${esc(ZONE_NAME[z] || "")}${v.paid ? ", costs extra" : ""}${v.kind === "adult" ? ", adults only" : ""}</span>
    ${state.open === v.id ? `<span class="dk-v-more">${v.note ? `${esc(v.note)} ` : ""}${dir ? `<b>From your cabin:</b> ${esc(dir)}` : ""}</span>` : ""}</span></button>
    ${state.open === v.id && onPlan ? `<button type="button" class="dk-v-onplan" data-dkpin="${esc(v.id)}">${icon("map")} Show on the plan</button>` : ""}</li>`;
}

export function render(el) {
  const D = G();
  if (!D) { el.innerHTML = '<p class="empty">Deck guide not loaded.</p>'; return; }
  rememberScroll();
  const sel = state.deck;
  const deck = D.decks.find((d) => d.n === sel) || D.decks[0];
  const q = state.q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const hits = q ? D.venues.filter((v) => { const t = `${v.name} ${v.kind} ${KIND_LABEL[v.kind] || ""} ${v.note || ""} ${v.alias || ""}`.toLowerCase(); return words.every((re) => re.test(t)); }) : [];
  const mine = (D.mine || []).map((m) => {
    const v = m.id ? D.venues.find((x) => x.id === m.id) : null;
    if (!v) return `<li class="dk-mine-wide"><div class="dk-mine dk-mine-static"><span class="dk-mine-k">${esc(m.label)}</span><b>${esc(m.name)}</b><span>${esc(m.detail)}</span></div></li>`;
    const where = m.where || `Deck ${v.deck}, ${ZONE_NAME[zoneOf(v)] || ""}`;
    return `<li${m.wide ? ' class="dk-mine-wide"' : ""}><button type="button" class="dk-mine dk-v-${esc(v.kind)}" data-dkv="${esc(v.id)}" data-dkmine="1"><span class="dk-mine-k">${esc(m.label)}</span><b>${esc(m.name)}</b><span>${esc(where)}</span></button></li>`;
  }).join("");
  el.innerHTML = `<div class="dk">
    <section class="block dk-find">
      <label for="dkSearch" class="dk-label">Where is…</label>
      <input id="dkSearch" class="dk-search" type="search" placeholder="Try: pizza, slides, Guest Services" value="${esc(state.q)}" autocomplete="off" enterkeyhint="search">
      ${q ? `<ul class="dk-list dk-hits">${hits.map(venueRow).join("") || '<li class="muted">Nothing matches. Try another word.</li>'}</ul>` : ""}
    </section>
    <section class="block">
      <h2>Our spots</h2>
      <ul class="dk-mines">${mine}</ul>
    </section>
    <section class="block">
      <div class="block-head"><h2>Deck by deck</h2><span class="count">Tap a deck</span></div>
      ${sideView(deck.n)}
      <div class="dk-legend">${LEGEND.map(([k, label]) => `<span class="dk-lg dk-v-${k}"><i></i>${label}</span>`).join("")}<span class="dk-lg"><svg viewBox="0 0 12 12" class="dk-lg-star" aria-hidden="true"><path class="dk-home" d="M6 .5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 8.7 2.8 10.4l.6-3.6L.8 4.3l3.6-.5z"/></svg>Your cabins</span></div>
      <div class="dk-deck">
        <div class="dk-deck-head"><button type="button" class="icon-btn" data-dkstep="1" aria-label="Deck above">${icon("up")}</button><div><h3>Deck ${deck.n}</h3><p>${esc(deck.name || "")}</p></div><button type="button" class="icon-btn" data-dkstep="-1" aria-label="Deck below">${icon("down")}</button></div>
        ${planHTML(deck.n)}
        ${ZONES.slice().reverse().map((z) => {
          const items = D.venues.filter((v) => v.deck === deck.n && zoneOf(v) === z).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
          return items.length ? `<h4 class="dk-zone">${ZONE_LABEL[z]}</h4><ul class="dk-list">${items.map(venueRow).join("")}</ul>` : "";
        }).join("") || '<p class="muted">Staterooms. Nothing to visit on this deck.</p>'}
      </div>
    </section>
    <p class="fine">${esc(D.note || "")}</p>
  </div>`;
  afterRender();
}

// ---------- plan behaviour ----------
function afterRender() {
  const img = document.getElementById("dkImg");
  const frame = document.getElementById("dkFrame");
  if (!img || !frame) return;
  const n = state.deck;
  if (!img.getAttribute("src")) {
    planURL(n).then((url) => {
      if (state.deck !== n) return;
      const i = document.getElementById("dkImg");
      if (i) { i.src = url; const w = i.parentElement.querySelector(".dk-plan-wait"); if (w) w.remove(); }
    }).catch((e) => {
      const w = document.querySelector(".dk-plan-wait");
      if (w) w.textContent = e && e.message === "locked" ? "Unlock the app to see the plan." : navigator.onLine ? "Couldn't load this plan. Try again in a moment." : "This plan loads the first time you're online.";
    });
  }
  // Keep the reading position when the list below changes.
  if (state.scroll && state.scroll.deck === n) { frame.scrollLeft = state.scroll.left; frame.scrollTop = state.scroll.top; }
  frame.addEventListener("scroll", () => { state.scroll = { deck: state.deck, left: frame.scrollLeft, top: frame.scrollTop }; }, { passive: true });
  bindPinch(frame);
  if (state.pendingPin) { const id = state.pendingPin; state.pendingPin = null; requestAnimationFrame(() => centerPin(id, true)); }
}
function rememberScroll() {
  const f = document.getElementById("dkFrame");
  if (f) state.scroll = { deck: state.deck, left: f.scrollLeft, top: f.scrollTop };
}

function setZoom(z, ax, ay) {
  const frame = document.getElementById("dkFrame"), inner = document.getElementById("dkInner");
  if (!frame || !inner) return;
  z = Math.min(ZOOMS.max, Math.max(ZOOMS.min, z));
  const w0 = inner.offsetWidth, h0 = inner.offsetHeight;
  if (ax == null) { ax = frame.clientWidth / 2; ay = frame.clientHeight / 2; }
  const cx = (frame.scrollLeft + ax) / w0, cy = (frame.scrollTop + ay) / h0;
  state.zoom = z;
  inner.style.width = `${(z * 100).toFixed(1)}%`;
  const w1 = inner.offsetWidth, h1 = inner.offsetHeight;
  frame.scrollLeft = cx * w1 - ax;
  frame.scrollTop = cy * h1 - ay;
}

function bindPinch(frame) {
  let start = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  frame.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const r = frame.getBoundingClientRect();
      start = { d: dist(e.touches), z: state.zoom, ax: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, ay: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
    }
  }, { passive: true });
  frame.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !start) return;
    e.preventDefault();
    setZoom(start.z * (dist(e.touches) / start.d), start.ax, start.ay);
  }, { passive: false });
  frame.addEventListener("touchend", (e) => { if (e.touches.length < 2) start = null; });
  // Safari's own page zoom would otherwise take over the gesture.
  frame.addEventListener("gesturestart", (e) => e.preventDefault());
  frame.addEventListener("dblclick", (e) => {
    const r = frame.getBoundingClientRect();
    setZoom(state.zoom >= 2 ? 1 : 2.2, e.clientX - r.left, e.clientY - r.top);
  });
}

function centerPin(id, scrollPage) {
  const v = G().venues.find((x) => x.id === id);
  const meta = v && planMeta(v.deck);
  const frame = document.getElementById("dkFrame"), inner = document.getElementById("dkInner");
  if (!v || !meta || v.x == null || !frame || !inner) return;
  state.zoom = 1.6; inner.style.width = "160%";
  const p = pct(v, meta);
  frame.scrollLeft = (p.l / 100) * inner.offsetWidth - frame.clientWidth / 2;
  frame.scrollTop = (p.t / 100) * inner.offsetHeight - frame.clientHeight / 2;
  if (scrollPage && !state.full) document.getElementById("dkPlan").scrollIntoView({ block: "start", behavior: "smooth" });
}

function toggleFull(on) {
  state.full = on;
  const plan = document.getElementById("dkPlan");
  if (!plan) return;
  const f = document.getElementById("dkFrame");
  const keep = f ? { x: (f.scrollLeft + f.clientWidth / 2) / f.scrollWidth, y: (f.scrollTop + f.clientHeight / 2) / f.scrollHeight } : null;
  plan.classList.toggle("dk-plan-full", on);
  document.body.classList.toggle("dk-full-open", on);
  const b = plan.querySelector("[data-dkfull]");
  if (b) b.textContent = on ? "Close" : "Full screen";
  if (f && keep) requestAnimationFrame(() => { f.scrollLeft = keep.x * f.scrollWidth - f.clientWidth / 2; f.scrollTop = keep.y * f.scrollHeight - f.clientHeight / 2; });
}
export function closeFull() { if (state.full) { toggleFull(false); return true; } return false; }

// ---------- events ----------
// Returns true if the event was handled.
export function onClick(e, rerender) {
  const D = G();
  const zb = e.target.closest("[data-dkzoom]");
  if (zb) { const steps = [1, 1.6, 2.4, 3.2]; const dir = Number(zb.dataset.dkzoom); const next = dir > 0 ? steps.find((s) => s > state.zoom + 0.05) : steps.slice().reverse().find((s) => s < state.zoom - 0.05); setZoom(next ?? state.zoom); return true; }
  const fb = e.target.closest("[data-dkfull]");
  if (fb) { toggleFull(!state.full); return true; }
  const pb = e.target.closest("[data-dkpin]");
  if (pb) { centerPin(pb.dataset.dkpin, true); return true; }
  const row = e.target.closest("[data-deck]");
  if (row) { state.deck = Number(row.dataset.deck); state.open = null; state.scroll = null; state.zoom = 1; rerender(); scrollToDeck(); return true; }
  const v = e.target.closest("[data-dkv]");
  if (v) {
    const id = v.dataset.dkv;
    const ven = D.venues.find((x) => x.id === id);
    if ((v.dataset.dkmine || v.closest(".dk-hits")) && ven) { focus(ven); rerender(); scrollToOpen(); return true; }
    state.open = state.open === id ? null : id;
    rerender();
    return true;
  }
  const md = e.target.closest("[data-dkdeck]");
  if (md) { state.deck = Number(md.dataset.dkdeck); state.open = null; state.scroll = null; state.zoom = 1; rerender(); scrollToDeck(); return true; }
  const st = e.target.closest("[data-dkstep]");
  if (st) {
    const nums = D.decks.map((d) => d.n).sort((a, b) => a - b);
    const i = nums.indexOf(state.deck) + Number(st.dataset.dkstep);
    if (i >= 0 && i < nums.length) { state.deck = nums[i]; state.open = null; state.scroll = null; state.zoom = 1; rerender(); }
    return true;
  }
  return false;
}
export function onKey(e, rerender) {
  if (e.key === "Escape" && closeFull()) return true;
  if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-deck]")) { e.preventDefault(); return onClick(e, rerender); }
  return false;
}
export function onInput(e, rerender) {
  if (e.target.id !== "dkSearch") return false;
  state.q = e.target.value;
  const pos = e.target.selectionStart;
  rerender();
  const inp = document.getElementById("dkSearch");
  if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* ignore */ } }
  return true;
}
function focus(v) {
  state.deck = v.deck; state.open = v.id; state.q = ""; state.scroll = null; state.zoom = 1;
  if (v.x != null && planMeta(v.deck)) state.pendingPin = v.id;
  else state.pendingScroll = true;
}
export function focusVenue(id) {
  const v = G() && G().venues.find((x) => x.id === id || (x.keys || []).includes(id));
  if (v) { focus(v); return true; }
  return false;
}
export function hasVenue(id) { return !!(G() && G().venues.some((x) => x.id === id || (x.keys || []).includes(id))); }
function scrollToDeck() { const d = document.querySelector(".dk-deck"); if (d) d.scrollIntoView({ block: "start", behavior: "smooth" }); }
export function scrollToOpen() {
  if (state.pendingScroll) {
    state.pendingScroll = false;
    const o = document.querySelector(".dk-deck .dk-v-more");
    const t = o ? o.closest("li") : document.querySelector(".dk-deck");
    if (t) t.scrollIntoView({ block: "center" });
  }
}
// Warm the decryption for the deck that will most likely be opened first.
export function prefetch() { if (G() && G().plans) planURL(state.deck).catch(() => {}); }
