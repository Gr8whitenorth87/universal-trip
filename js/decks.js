// Deck guide: an original side-view of the ship, tap a deck to see what's on it,
// "where is…" search, and the family's own spots with simple directions.
import { icon } from "./util.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ZONES = ["aft", "mid", "fore"];
const ZONE_NAME = { fore: "front", mid: "middle", aft: "back" };
const ZONE_LABEL = { aft: "Back (aft)", mid: "Middle", fore: "Front (bow)" };
const KIND_LABEL = { food: "Food", pool: "Pool", slide: "Slides", activity: "Activity", show: "Show", kids: "Kids", service: "Service", adult: "Adults only", shop: "Shop", bar: "Bar", cabins: "Cabins", you: "Yours" };

let state = { deck: null, q: "" };

function G() { return window.__deckData; }
export function setData(d) { window.__deckData = d; if (state.deck == null && d) state.deck = d.home ? d.home.deck : d.decks[0].n; }

export function directions(v) {
  const h = G().home;
  if (!h || v.deck == null) return "";
  const zone = v.zone || "mid";
  if (v.deck === h.deck && zone === h.zone) return `On your deck, near your cabins.`;
  if (v.deck === h.deck) return `Stay on Deck ${v.deck} and walk toward the ${ZONE_NAME[zone]} of the ship.`;
  const bank = h.banks && h.banks[zone] ? zone : h.zone;
  const walk = bank === zone ? `it's at the ${ZONE_NAME[zone]}` : `then walk toward the ${ZONE_NAME[zone]}`;
  return `Take the ${ZONE_NAME[bank]} elevators or stairs ${v.deck > h.deck ? "up" : "down"} to Deck ${v.deck}; ${walk}.`;
}

function sideView(sel) {
  const D = G();
  const nums = D.decks.map((d) => d.n);
  const top = Math.max(...nums), bottom = Math.min(...nums);
  const rows = top - bottom + 1, rh = 15, W = 340, padT = 18, H = padT + rows * rh + 26;
  const y = (n) => padT + (top - n) * rh;
  // Hull and superstructure outline (simplified, not to scale). Bow on the right.
  const hullTop = y(D.hullTop || 6);
  const hull = `M8 ${hullTop} L${W - 6} ${hullTop} L${W - 30} ${H - 22} L22 ${H - 22} Z`;
  const deckRows = D.decks.map((d) => {
    const yy = y(d.n);
    const w = d.span || [0, 1];
    const x1 = 10 + w[0] * (W - 20), x2 = 10 + w[1] * (W - 20);
    const on = d.n === sel;
    const home = D.home && D.home.deck === d.n;
    const dots = ZONES.map((z, i) => {
      const items = D.venues.filter((v) => v.deck === d.n && v.zone === z);
      if (!items.length) return "";
      const cx = 10 + ((i + 0.5) / 3) * (W - 20);
      if (cx < x1 || cx > x2) return "";
      return `<circle cx="${cx}" cy="${yy + rh / 2}" r="3.2" class="dk-dot dk-dot-${esc(items[0].kind)}"/>`;
    }).join("");
    const star = home ? (() => { const i = ZONES.indexOf(D.home.zone); const cx = 10 + ((i + 0.5) / 3) * (W - 20) + 12; return `<path class="dk-home" d="M${cx} ${yy + 2.5}l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z"/>`; })() : "";
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
  return `<li class="dk-v dk-v-${esc(v.kind)}"><button type="button" class="dk-v-btn" data-dkv="${esc(v.id)}">
    <span class="dk-v-dot" aria-hidden="true"></span>
    <span class="dk-v-body"><b>${esc(v.name)}</b><span>Deck ${v.deck}, ${esc(ZONE_NAME[v.zone] || "")}${v.paid ? ", costs extra" : ""}${v.kind === "adult" ? ", adults only" : ""}</span>
    ${state.open === v.id ? `<span class="dk-v-more">${v.note ? `${esc(v.note)} ` : ""}${dir ? `<b>From your cabin:</b> ${esc(dir)}` : ""}</span>` : ""}</span></button></li>`;
}

export function render(el) {
  const D = G();
  if (!D) { el.innerHTML = '<p class="empty">Deck guide not loaded.</p>'; return; }
  const sel = state.deck;
  const deck = D.decks.find((d) => d.n === sel) || D.decks[0];
  const q = state.q.trim().toLowerCase();
  const hits = q ? D.venues.filter((v) => `${v.name} ${v.kind} ${KIND_LABEL[v.kind] || ""} ${v.note || ""} ${v.alias || ""}`.toLowerCase().includes(q)) : [];
  const mine = (D.mine || []).map((m) => `<li><button type="button" class="dk-mine" data-dkdeck="${m.deck}"${m.id ? ` data-dkv="${esc(m.id)}"` : ""}>
      <span class="dk-mine-k">${esc(m.label)}</span><b>${esc(m.name)}</b><span>${esc(m.detail)}</span>${m.directions ? `<span class="dk-mine-dir">${esc(m.directions)}</span>` : ""}</button></li>`).join("");
  el.innerHTML = `<div class="dk">
    <section class="block">
      <h2>Our spots on the ship</h2>
      <ul class="dk-mines">${mine}</ul>
    </section>
    <section class="block">
      <label for="dkSearch" class="dk-label">Where is…</label>
      <input id="dkSearch" class="dk-search" type="search" placeholder="Try: pizza, slides, Guest Services" value="${esc(state.q)}" autocomplete="off">
      ${q ? `<ul class="dk-list">${hits.map(venueRow).join("") || '<li class="muted">Nothing matches. Try another word.</li>'}</ul>` : ""}
    </section>
    <section class="block">
      <div class="block-head"><h2>Deck by deck</h2><span class="count">Tap a deck</span></div>
      ${sideView(deck.n)}
      <div class="dk-legend">${["food", "pool", "slide", "kids", "show", "service", "adult"].map((k) => `<span class="dk-lg dk-v-${k}"><i></i>${KIND_LABEL[k]}</span>`).join("")}<span class="dk-lg"><svg viewBox="0 0 12 12" class="dk-lg-star" aria-hidden="true"><path class="dk-home" d="M6 .5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 8.7 2.8 10.4l.6-3.6L.8 4.3l3.6-.5z"/></svg>Your cabins</span></div>
      <div class="dk-deck">
        <div class="dk-deck-head"><button type="button" class="icon-btn" data-dkstep="1" aria-label="Deck above">${icon("up")}</button><div><h3>Deck ${deck.n}</h3><p>${esc(deck.name || "")}</p></div><button type="button" class="icon-btn" data-dkstep="-1" aria-label="Deck below">${icon("down")}</button></div>
        ${ZONES.slice().reverse().map((z) => {
          const items = D.venues.filter((v) => v.deck === deck.n && v.zone === z);
          return items.length ? `<h4 class="dk-zone">${ZONE_LABEL[z]}</h4><ul class="dk-list">${items.map(venueRow).join("")}</ul>` : "";
        }).join("") || '<p class="muted">Mostly staterooms.</p>'}
      </div>
    </section>
    <p class="fine">${esc(D.note || "")}</p>
  </div>`;
}

// Returns true if the event was handled.
export function onClick(e, rerender) {
  const D = G();
  const row = e.target.closest("[data-deck]");
  if (row) { state.deck = Number(row.dataset.deck); state.open = null; rerender(); scrollToDeck(); return true; }
  const v = e.target.closest("[data-dkv]");
  if (v) {
    const id = v.dataset.dkv;
    const ven = D.venues.find((x) => x.id === id);
    if (v.classList.contains("dk-mine") && ven) { state.deck = ven.deck; state.open = id; state.q = ""; rerender(); scrollToDeck(); return true; }
    state.open = state.open === id ? null : id;
    rerender();
    return true;
  }
  const md = e.target.closest("[data-dkdeck]");
  if (md) { state.deck = Number(md.dataset.dkdeck); state.open = null; rerender(); scrollToDeck(); return true; }
  const st = e.target.closest("[data-dkstep]");
  if (st) {
    const nums = D.decks.map((d) => d.n).sort((a, b) => a - b);
    const i = nums.indexOf(state.deck) + Number(st.dataset.dkstep);
    if (i >= 0 && i < nums.length) { state.deck = nums[i]; state.open = null; rerender(); }
    return true;
  }
  return false;
}
export function onKey(e, rerender) {
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
export function focusVenue(id) {
  const v = G() && G().venues.find((x) => x.id === id);
  if (v) { state.deck = v.deck; state.open = id; state.q = ""; }
}
function scrollToDeck() { const d = document.querySelector(".dk-deck"); if (d) d.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
