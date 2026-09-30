// Earth data: the solid-Earth and environmental science layers — plate boundaries,
// Holocene volcanoes, historical tsunamis and significant earthquakes, the magnetic
// anomaly grid, surveyed seafloor, soils, forest loss, glaciers and USGS mineral
// deposits — with click cards and agent tools. Every value keeps its source and date.
import { app, $, esc, fmt, getJSON, haversineKm } from "./core.js";
import { elevationAt, ELEVATION_SOURCE } from "./elevation.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const LIC = { usgov: "Public domain (U.S. Government work)", ccby: "CC BY 4.0", odcby: "Open Data Commons Attribution License (ODC-By 1.0)" };
const NCEI_API = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1";
const NCEI_VIEW = "https://www.ngdc.noaa.gov/hazel/view/hazards";
const DATA = { plates: "/world/data/earthdata-pb2002.json", mrdsCodes: "/world/data/earthdata-mrds-codes.json" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const titleCase = (s) => String(s ?? "").toLowerCase().replace(/(^|[\s(/-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
// NCEI names are upper case ("SE. ALASKA, AK, USA"); keep abbreviations upper case when title-casing.
const ABBR = new Set(["USA", "US", "UK", "UAE", "PNG", "DRC", "AK", "HI", "CA", "WA", "OR", "NW", "NE", "SE", "SW", "NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"]);
const nceiTitle = (s) => titleCase(s).replace(/\b([A-Za-z]{2,3})\b/g, (w) => (ABBR.has(w.toUpperCase()) ? w.toUpperCase() : w));
function nceiPlace(o) {
  const raw = String(o.locationName ?? "").replace(/\s+/g, " ").trim();
  const i = raw.indexOf(":");
  const country = nceiTitle(o.country ?? (i > 0 ? raw.slice(0, i) : ""));
  const place = nceiTitle(i > 0 ? raw.slice(i + 1).trim() : raw) || country || "Unnamed place";
  const showCountry = country && !place.toLowerCase().endsWith(country.toLowerCase()) ? country : "";
  return { place, country: showCountry, full: [place, showCountry].filter(Boolean).join(", ") };
}
/** Signed figure with a true minus sign, for card titles and badges. */
const signed = (v, d = 0, plus = false) => `${v > 0 && plus ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), d)}`;
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** A readable reason for a failed request ("Failed to fetch" means nothing to a visitor). */
function why(err) {
  const m = String(err?.message ?? "");
  if (/timed out/i.test(m)) return "it timed out";
  const code = m.match(/answered (\d{3})/)?.[1];
  if (code) return `it answered HTTP ${code}`;
  if (/returned an error/i.test(m)) return "it returned an error";
  return "it could not be reached";
}

/* ================================================================ vocabularies */
// PB2002 step classes, as defined by Bird (2003).
const CLASS = {
  OSR: { t: "Oceanic spreading ridge", k: "div", about: "An oceanic boundary where the plates move apart and new sea floor forms." },
  CRB: { t: "Continental rift", k: "div", about: "A continental boundary where the plates move apart." },
  OTF: { t: "Oceanic transform fault", k: "tr", about: "An oceanic boundary where the plates slide past each other." },
  CTF: { t: "Continental transform fault", k: "tr", about: "A continental boundary where the plates slide past each other." },
  SUB: { t: "Subduction zone", k: "sub", about: "A convergent boundary with a Benioff zone of intermediate-to-deep earthquakes and/or a volcanic arc." },
  OCB: { t: "Oceanic convergent boundary", k: "conv", about: "An oceanic boundary where the plates converge without a mapped subduction zone." },
  CCB: { t: "Continental convergent boundary", k: "conv", about: "A continental boundary where the plates converge, as in a collision belt." },
};
const PLATE_C = { div: "#ff5a4f", tr: "#3fdcab", sub: "#63b3ff", conv: "#ffb547" };
const PLATE_COLOR = ["match", ["get", "c"], ["OSR", "CRB"], PLATE_C.div, ["OTF", "CTF"], PLATE_C.tr, "SUB", PLATE_C.sub, PLATE_C.conv];

// NCEI "last known eruption" codes (from the Smithsonian GVP), per NCEI's own legend.
const ERUPT = {
  D1: [1, "1964 or later", 1964, 9999], D2: [2, "1900–1963", 1900, 1963], D3: [3, "1800–1899", 1800, 1899], D4: [4, "1700–1799", 1700, 1799],
  D5: [5, "1500–1699", 1500, 1699], D6: [6, "AD 1–1499", 1, 1499], D7: [7, "Before AD 1 (Holocene)", -12000, 0],
  U: [8, "Undated, but probable Holocene eruption"], Q: [9, "Quaternary eruption(s); only hydrothermal activity known in the Holocene"], "?": [9, "Uncertain Holocene eruption"],
};
const ERUPT_SHORT = { D1: "1964+", D2: "1900–63", D3: "1800s", D4: "1700s", D5: "1500–1699", D6: "AD 1–1499", D7: "BC" };
const VOLC = [
  { g: "strato", label: "Stratovolcano or complex", c: "#ff7847", re: /strato|compound|complex|somma/i },
  { g: "shield", label: "Shield volcano", c: "#ffc247", re: /shield/i },
  { g: "caldera", label: "Caldera", c: "#e070ff", re: /caldera/i },
  { g: "dome", label: "Lava dome", c: "#ff5c8d", re: /dome/i },
  { g: "sub", label: "Submarine", c: "#4cc9ff", re: /submarine/i },
  { g: "field", label: "Cones, fields and fissures", c: "#ffe25c", re: /field|cone|fissure|maar|crater|tuff|scoria|pumice|pyroclastic/i },
  { g: "other", label: "Other or unknown", c: "#d6d6d6", re: /.*/ },
];
const volcGroup = (morph = "") => (/fumarol|hydrotherm|mud|not volcanic|unknown|subglacial/i.test(morph) || !morph ? "other" : VOLC.find((v) => v.re.test(morph)).g);
const volcColor = (g) => VOLC.find((v) => v.g === g)?.c ?? "#d6d6d6";

// NCEI tsunami and effects vocabularies, per NCEI's own legend.
const TS_CAUSE = { 0: "Unknown", 1: "Earthquake", 2: "Questionable earthquake", 3: "Earthquake and landslide", 4: "Volcano and earthquake", 5: "Volcano, earthquake and landslide", 6: "Volcano", 7: "Volcano and landslide", 8: "Landslide", 9: "Meteorological", 10: "Explosion", 11: "Astronomical tide" };
const TS_GROUP = (c) => ([1, 2, 3].includes(c) ? "eq" : [4, 5, 6, 7].includes(c) ? "volc" : c === 8 ? "slide" : c === 9 ? "met" : "other");
const TS_C = { eq: "#56b6ff", volc: "#ff7847", slide: "#d8a25e", met: "#b18cff", other: "#cfcfcf" };
const TS_VALID = { 1: "Very doubtful tsunami", 2: "Questionable tsunami", 3: "Probable tsunami", 4: "Definite tsunami" };
const AMOUNT = { 0: "None", 1: "Few (~1 to 50)", 2: "Some (~51 to 100)", 3: "Many (~101 to 1,000)", 4: "Very many (over 1,000)" };
const DAMAGE = { 0: "None", 1: "Limited (under ~$1 million, 1990 dollars)", 2: "Moderate (~$1–5 million, 1990 dollars)", 3: "Severe (~$5–25 million, 1990 dollars)", 4: "Extreme (~$25 million or more, 1990 dollars)" };
const DEATH_C = { "-1": "#e9e4da", 0: "#fff0a8", 1: "#ffc35e", 2: "#ff9444", 3: "#f2552f", 4: "#b3142f" };

const MRDS_STATUS = [["Producer", "#ffd23f"], ["Past Producer", "#f08c3a"], ["Prospect", "#7cc7ff"], ["Occurrence", "#c9c3e6"], ["Plant", "#c58cff"], ["Unknown", "#9a9a9a"]];
const MRDS_NS = "http://mapserver.gis.umn.edu/mapserver";
const GML_NS = "http://www.opengis.net/gml";

// RGI 7.0 region layers as served by the GLIMS GeoServer (one vector source-layer each).
const RGI_REGIONS = ["01_alaska", "02_western_canada_usa", "03_arctic_canada_north", "04_arctic_canada_south", "05_greenland_periphery", "06_iceland",
  "07_svalbard_jan_mayen", "08_scandinavia", "09_russian_arctic", "10_north_asia", "11_central_europe", "12_caucasus_middle_east", "13_central_asia",
  "14_south_asia_west", "15_south_asia_east", "16_low_latitudes", "17_southern_andes", "18_new_zealand", "19_subantarctic_antarctic_islands"];
// Saturated cyan reads against both bright ice and dark rock (a pale ice tint vanished on snow).
const GLAC = { fill: "#35bdff", line: "#1aa3f5", tint: [40, 178, 255] };
const RGI_TERM = { 0: "Land-terminating", 1: "Marine-terminating", 2: "Lake-terminating", 3: "Shelf-terminating" };
const RGI_SURGE = { 0: "No evidence", 1: "Possible", 2: "Probable", 3: "Observed" };
const RGI_ASPECT = { 1: "North", 2: "North-east", 3: "East", 4: "South-east", 5: "South", 6: "South-west", 7: "West", 8: "North-west" };

// SoilGrids WMS classes, read from ISRIC's GetLegendGraphic (labels in mapped units).
const SOIL_WMS = {
  phh2o: {
    div: 10, unit: "pH",
    labels: [0, 34, 48, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 64, 65, 67, 68, 70, 72, 73, 75, 76, 77, 79, 79, 80, 81, 82, 83, 92],
    colors: ["#f0f63d", "#f0f63d", "#f1ee2d", "#f1e51c", "#ebe51a", "#e0e41b", "#c0df28", "#a5db36", "#8dd645", "#86d44e", "#81d255", "#72c94c", "#62c042", "#54b93a", "#4bb736", "#42b532", "#39b32f", "#36ad31", "#35a536", "#359d3b", "#329a3d", "#2f993f", "#2c9840", "#2a9945", "#2fa45f", "#34b07a", "#36b993", "#30b6a4", "#28b6b5", "#1bc1c7", "#0fccd9"],
    ticks: [2, 6, 11, 18, 26, 30], cap: ["Acidic", "Alkaline"],
  },
  soc: {
    div: 10, unit: "g/kg",
    labels: [0, 6, 27, 38, 43, 53, 64, 85, 106, 127, 142, 163, 184, 210, 236, 268, 299, 330, 362, 398, 445, 492, 560, 633, 727, 832, 962, 1114, 1312, 1521, 1839, 2174, 4471],
    colors: ["#ffffff", "#ffffff", "#fbf9f9", "#f6f3f2", "#f2edec", "#ede7e5", "#e9e1de", "#e4dad8", "#dfd4d1", "#dbceca", "#d6c8c4", "#d2c2bd", "#cdbbb7", "#c9b5b0", "#c4afa9", "#bfa9a3", "#bba39c", "#b69d95", "#b2968f", "#ad9088", "#a98a82", "#a4847b", "#9f7e74", "#9b786e", "#967167", "#926b60", "#8d655a", "#895f53", "#84594d", "#7f5246", "#7b4c3f", "#764639", "#724032"],
    ticks: [2, 9, 16, 23, 32], cap: ["Little carbon", "Carbon-rich (peat)"],
  },
  clay: {
    div: 10, unit: "%",
    labels: [0, 7, 32, 58, 83, 109, 134, 160, 185, 211, 236, 262, 288, 313, 339, 364, 390, 415, 441, 466, 492, 517, 543, 569, 594, 620, 645, 671, 696, 722, 747, 773, 799],
    colors: ["#f2dac1", "#f2dac1", "#eed2b6", "#ebcbab", "#e7c4a0", "#e3bc96", "#e0b58b", "#dcae80", "#d8a775", "#d49f6b", "#d19860", "#cd9155", "#c98c50", "#c5894d", "#c1854a", "#bd8247", "#b97e44", "#b47b41", "#b0773e", "#ac743b", "#a87038", "#a36c35", "#9f6832", "#9b652f", "#97612c", "#935e29", "#8f5a26", "#8b5723", "#875320", "#83501d", "#7e4c1a", "#7a4917", "#764615"],
    ticks: [0, 8, 16, 24, 32], cap: ["", ""],
  },
};
SOIL_WMS.sand = { ...SOIL_WMS.clay };
const SOIL_DP = { phh2o: 1, soc: 1, clay: 1, sand: 1, silt: 1, nitrogen: 2, bdod: 2, cec: 1 };
const SOIL_NAMES = { phh2o: "pH (in water)", soc: "Organic carbon", clay: "Clay", sand: "Sand", silt: "Silt", nitrogen: "Nitrogen", bdod: "Bulk density", cec: "Cation exchange capacity" };

/* ================================================================ icons */
const svg = (paths, size = 20, sw = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
const ICON = {
  volcano: ["M3 20h18", "M5.5 20 10 10.5h4L18.5 20", "M9.5 6.8a2.2 2.2 0 0 1 3.4-1.9 2.4 2.4 0 0 1 3.8 1.6"],
  wave: ["M3 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 3 2 3 2", "M3 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 3 2 3 2", "M5.5 12c0-4.2 4.2-7 8.5-6-2.2.9-3.2 2.6-3.2 4.8"],
  quake: ["M3 12h3.5l2-5 3 10 2.5-7 1.5 2H21"],
  plates: ["M3 8.5c3 1 5.5-1 8.5 0s5 1 9.5-.5", "M3 15.5c3 1 5.5-1 8.5 0s5 1 9.5-.5", "M12 8.8 10.6 15.2"],
  magnet: ["M6.5 4v7.5a5.5 5.5 0 0 0 11 0V4", "M6.5 8h3.5M14 8h3.5"],
  soil: ["M3.5 7.5h17", "M3.5 12h17", "M3.5 16.5h17", "M7 9.8v.01M12 14.3v.01M16.5 9.8v.01M9.5 18.8v.01"],
  tree: ["M12 3 17 10h-3l4 6H6l4-6H7z", "M12 16v5"],
  snow: ["M12 3v18", "M4.2 7.5 19.8 16.5", "M4.2 16.5 19.8 7.5", "M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"],
  gem: ["M6.5 4h11L21 9l-9 11L3 9z", "M3 9h18", "M9.5 4 12 9l2.5-5", "M12 9v11"],
  seafloor: ["M3 8c2.5 0 2.5-1.6 5-1.6S10.5 8 13 8s2.5-1.6 5-1.6S21 8 21 8", "M3 20l4.5-6 3 3.5L14 12l7 8z"],
  mountain: ["M3 19.5 9 9.5l4 6 3-4 5 8z"],
  target: ["M12 3v4M12 17v4M3 12h4M17 12h4", "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"],
  ext: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
};
const ic = (n, size = 20, sw = 1.8) => svg(ICON[n], size, sw);
const extLink = (href, label, primary = false) => `<a class="btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}${svg(ICON.ext, 14, 2)}</a>`;
const kv = (rows) => {
  const r = rows.filter((x) => x && x[1] != null && x[1] !== "");
  return r.length ? `<dl class="kv">${r.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join("")}</dl>` : "";
};
const cardHead = ({ badge, color, eyebrow, title, sub }) => `<div class="ed-head"><div class="ed-badge" style="--c:${color}">${badge}</div>
  <div class="grow"><div class="eyebrow">${esc(eyebrow)}</div><h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div></div>`;

/** Map icons drawn on a 2x canvas; dark outlines keep them legible in thermal and night-vision modes. */
function addIcon(map, id, w, h, draw) {
  if (map.hasImage(id)) return;
  const pr = 2, c = document.createElement("canvas");
  c.width = Math.ceil(w * pr);
  c.height = Math.ceil(h * pr);
  const g = c.getContext("2d");
  g.scale(pr, pr);
  draw(g);
  map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: pr });
}
function ensureIcons(map) {
  for (const v of VOLC) {
    addIcon(map, `ed-volc-${v.g}`, 18, 17, (g) => {
      g.beginPath(); g.moveTo(9, 1.8); g.lineTo(16.6, 15.2); g.lineTo(1.4, 15.2); g.closePath();
      g.fillStyle = v.c; g.fill();
      g.lineJoin = "round"; g.lineWidth = 1.5; g.strokeStyle = "rgba(10,10,12,0.85)"; g.stroke();
    });
  }
  // Subduction teeth: the triangle sits on one side of the line, on the overriding plate.
  for (const side of ["l", "r"]) {
    addIcon(map, `ed-tooth-${side}`, 14, 20, (g) => {
      const up = side === "l";
      g.beginPath();
      g.moveTo(1.5, 10); g.lineTo(12.5, 10); g.lineTo(7, up ? 2.5 : 17.5); g.closePath();
      g.fillStyle = PLATE_C.sub; g.fill();
      g.lineJoin = "round"; g.lineWidth = 1; g.strokeStyle = "rgba(8,16,30,0.8)"; g.stroke();
    });
  }
}

/* ================================================================ status pill */
const statusMsgs = new Map();
const statusTimers = new Map();
let statusEl = null;
function setStatus(key, msg, { busy = false, tone = "", ms = 0 } = {}) {
  clearTimeout(statusTimers.get(key));
  if (!msg) statusMsgs.delete(key);
  else statusMsgs.set(key, { msg, busy, tone });
  if (msg && ms) statusTimers.set(key, setTimeout(() => setStatus(key, null), ms));
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "ed-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    document.body.append(statusEl);
    watchStatusFloor();
  }
  const shown = !statusEl.hidden;
  statusEl.hidden = !statusMsgs.size;
  statusEl.innerHTML = [...statusMsgs.entries()].map(([k, s]) => `<div class="ed-status-row${s.tone ? ` is-${s.tone}` : ""}">
    ${s.busy ? '<span class="ed-spin" aria-hidden="true"></span>' : ""}<span>${esc(s.msg)}</span>
    ${k === "probe" ? '<button type="button" class="btn btn-ghost btn-sm" data-ed-cancel>Cancel</button>' : ""}</div>`).join("");
  placeStatus(!shown);
}
// The time bar, the measure sheet, the pin and Street View hints and a story sheet all
// share the foot of the map with the pill, and their heights vary (a measure profile, a
// story's text), so the pill rides just above whichever of them it would otherwise cover.
// On a wider screen the Layers dock and the place card are side panels: the pill centres
// in the open map between them, as the time bar does. On a phone they are bottom sheets,
// and the pill rides above them like the rest. The map controls count too where they wrap
// into a second row under it (a landscape phone with the dock open).
const STATUS_CLEAR = "#timebar, #tl-measure, .tl-hintpill, .sv-hint, #tour, #dock, #card, #controls";
const PHONE = matchMedia("(max-width: 720px)");
const statusSeen = new WeakSet();
let statusRO = null, statusRaf = 0, statusLate = 0;
const shownBox = (q) => { const o = $(q); return o && !o.hidden && o.getClientRects().length ? o.getBoundingClientRect() : null; };
function placeStatus(instant = false) {
  const el = statusEl;
  if (!el || el.hidden) return;
  el.style.left = el.style.maxWidth = "";
  if (!PHONE.matches) {
    const vw = document.documentElement.clientWidth, dock = shownBox("#dock"), card = shownBox("#card");
    let lo = 84, hi = vw - 72; // clear of the rail and the map-control column
    if (dock) lo = Math.max(lo, dock.right + 14);
    if (card && card.left - 14 - lo >= 240) hi = Math.min(hi, card.left - 14);
    // Off centre only when the centred pill would run under a panel.
    const half = el.offsetWidth / 2, runsUnder = vw / 2 - half < lo || vw / 2 + half > hi;
    if ((dock || card) && runsUnder && hi - lo >= 240) {
      el.style.left = `${Math.round((lo + hi) / 2)}px`;
      el.style.maxWidth = `${Math.min(560, hi - lo)}px`;
    }
  }
  const base = innerHeight - parseFloat(getComputedStyle(el).bottom); // the pill's foot where the stylesheet puts it
  const h = el.offsetHeight, me = el.getBoundingClientRect();
  const under = [];
  for (const o of document.querySelectorAll(STATUS_CLEAR)) {
    if (statusRO && !statusSeen.has(o)) { statusSeen.add(o); statusRO.observe(o); }
    if (o.hidden || !o.getClientRects().length) continue;
    const r = o.getBoundingClientRect();
    // A full-height side panel is cleared across, above; only a lower sheet lifts the pill.
    if (!PHONE.matches && (o.id === "dock" || o.id === "card") && r.top < innerHeight / 2) continue;
    if (r.height > 0 && r.right > me.left && r.left < me.right) under.push(r);
  }
  let foot = base;
  for (let moved = true; moved;) {
    moved = false;
    for (const r of under) if (r.top < foot - 1 && r.bottom > foot - h + 1) { foot = r.top - 10; moved = true; }
  }
  // Never up under the search and mode bars: 16px below whichever of them sits over the
  // pill (a landscape phone's bars end near 60px, a portrait phone's mode bar at 112px).
  let roof = 0;
  for (const q of [".w-top", "#modebar"]) { const r = shownBox(q); if (r && r.right > me.left && r.left < me.right) roof = Math.max(roof, r.bottom + 16); }
  foot = Math.max(foot, Math.min(base, (roof || 128) + h));
  const lift = Math.round(base - foot);
  // No open map left between the panels: the pill rides over their edge rather than under it.
  el.classList.toggle("is-over", !PHONE.matches && ["#dock", "#card"].some((q) => {
    const r = shownBox(q);
    return r && r.right > me.left && r.left < me.right && r.bottom > foot - h && r.top < foot;
  }));
  if (instant) el.style.transition = "none"; // a pill that has just appeared starts in place
  if (lift > 0) el.style.setProperty("--ed-lift", `${lift}px`);
  else el.style.removeProperty("--ed-lift");
  if (instant) { void el.offsetWidth; el.style.transition = ""; }
}
function placeStatusSoon() {
  if (!statusEl || statusEl.hidden) return;
  cancelAnimationFrame(statusRaf);
  statusRaf = requestAnimationFrame(() => placeStatus());
  // Once more after the sheets' rise and slide animations have settled.
  clearTimeout(statusLate);
  statusLate = setTimeout(() => placeStatus(), 360);
}
function watchStatusFloor() {
  if (window.ResizeObserver) statusRO = new ResizeObserver(() => placeStatus());
  // Sheets are added to the body, shown and hidden, and body classes (has-timebar,
  // tl-drawing, is-touring) move them.
  new MutationObserver(placeStatusSoon).observe(document.body, { childList: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", placeStatusSoon, { passive: true });
}

/* ================================================================ raster tiles */
// Every raster goes through one protocol so a slow or failing provider yields blank
// tiles and one quiet status line instead of a console full of tile errors, and so
// EMAG2's grey no-data fill and the GLIMS outline colour can be adjusted per pixel.
const BLANK = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const RASTER = {
  emag: { name: "NOAA EMAG2v3", key: [150, 150, 150], url: (q) => `https://gis.ngdc.noaa.gov/arcgis/rest/services/EMAG2v3/ImageServer/exportImage?bbox=${q.bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image` },
  seafloor: { name: "NOAA NCEI multibeam mosaic", url: (q) => `https://gis.ngdc.noaa.gov/arcgis/rest/services/multibeam_mosaic/ImageServer/exportImage?bbox=${q.bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&f=image` },
  soil: { name: "ISRIC SoilGrids", url: (q) => `https://maps.isric.org/mapserv?map=/map/${q.p}.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${q.p}_0-5cm_mean&STYLES=&SRS=EPSG:3857&BBOX=${q.bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true` },
  gfw: { name: "Global Forest Watch tiles", url: (q) => `https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.13/dynamic/${q.z}/${q.x}/${q.y}.png?render_type=true_color&start_year=${q.from}&end_year=${q.to}&tree_cover_density_threshold=30` },
  glims: { name: "GLIMS map service", tint: GLAC.tint, url: (q) => `https://www.glims.org/geoserver/ows?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=GLIMS:RGI70&STYLES=&SRS=EPSG:3857&BBOX=${q.bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true` },
  glimsvt: { name: "GLIMS map service", vector: true, url: (q) => `https://www.glims.org/geoserver/ows?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=GLIMS:RGI70&STYLES=&SRS=EPSG:3857&BBOX=${q.bbox}&WIDTH=512&HEIGHT=512&FORMAT=application/vnd.mapbox-vector-tile` },
};
const health = new Map(); // kind -> { ok, fail }
// Slow providers (SoilGrids and GLIMS can take 10 s a tile at low zoom) get a quiet
// "still drawing" line while their tiles are in flight, so a half-painted map reads as loading.
const inflight = new Map(); // kind -> { n, timer }
function tileStart(kind) {
  const f = inflight.get(kind) ?? { n: 0, timer: 0 };
  f.n++;
  if (!f.timer) f.timer = setTimeout(() => { if (f.n > 0 && !failing(kind)) setStatus(`draw-${kind}`, `${RASTER[kind].name} is still drawing this area…`, { busy: true }); }, 2500);
  inflight.set(kind, f);
}
function tileEnd(kind) {
  const f = inflight.get(kind);
  if (!f) return;
  f.n = Math.max(0, f.n - 1);
  if (!f.n) { clearTimeout(f.timer); f.timer = 0; setStatus(`draw-${kind}`, null); }
}
const failing = (kind) => { const h = health.get(kind); return Boolean(h && h.fail >= 4 && h.fail > h.ok); };
function tileFailed(kind) {
  const h = health.get(kind) ?? { ok: 0, fail: 0 };
  h.fail++;
  health.set(kind, h);
  if (failing(kind)) {
    setStatus(`draw-${kind}`, null);
    setStatus(`tiles-${kind}`, `${RASTER[kind].name} is not answering right now, so some tiles are missing.`, { tone: "warn", ms: 9000 });
  }
  return RASTER[kind].vector ? { data: new ArrayBuffer(0) } : { data: BLANK.buffer.slice(0) };
}
async function recolor(buf, src) {
  const bmp = await createImageBitmap(new Blob([buf]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  const [kr, kg, kb] = src.key ?? [-1, -1, -1];
  const tint = src.tint;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === kr && px[i + 1] === kg && px[i + 2] === kb) px[i + 3] = 0;
    else if (tint && px[i + 3]) { px[i] = tint[0]; px[i + 1] = tint[1]; px[i + 2] = tint[2]; }
  }
  g.putImageData(img, 0, 0);
  return (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
}
function registerProtocol() {
  app.maplibregl.addProtocol("edtile", async (params, ctrl) => {
    const u = new URL(params.url.replace(/^edtile:\/\//, "https://edtile.invalid/"));
    const kind = u.pathname.split("/").filter(Boolean)[0];
    if (!RASTER[kind]) return { data: BLANK.buffer.slice(0) };
    tileStart(kind);
    try { return await fetchTile(u, ctrl); } finally { tileEnd(kind); }
  });
}
async function fetchTile(u, ctrl) {
  const [kind, z, x, y] = u.pathname.split("/").filter(Boolean);
  const src = RASTER[kind];
  const q = { z, x, y, ...Object.fromEntries(u.searchParams) };
  let res;
  try { res = await fetch(src.url(q), { signal: ctrl.signal }); } catch (err) {
    if (err.name === "AbortError") throw err;
    return tileFailed(kind);
  }
  const type = res.headers.get("content-type") ?? "";
  // WMS servers answer errors with XML and status 200.
  if (!res.ok || !(src.vector ? /vector-tile|protobuf/.test(type) : type.startsWith("image/"))) return tileFailed(kind);
  const h = health.get(kind) ?? { ok: 0, fail: 0 };
  h.ok++;
  health.set(kind, h);
  const buf = await res.arrayBuffer();
  if (!src.key && !src.tint) return { data: buf };
  try { return { data: await recolor(buf, src) }; } catch { return { data: buf }; }
}

/* ================================================================ data loaders */
async function retry(fn) {
  try { return await fn(); } catch { await wait(900); return fn(); }
}
/** Items that have arrived so far for a streamed NCEI list, so layers can draw page by page. */
const streams = {};
const stream = (name) => (streams[name] ??= { items: [], byId: new Map(), subs: new Set(), done: false });
const firstItems = (S) => (S.items.length ? Promise.resolve() : new Promise((r) => { const f = () => { S.subs.delete(f); r(); }; S.subs.add(f); }));
/** Every page of an NCEI Hazard Service list (200 items a page, six pages at a time). */
async function nceiAll(path, label, key, name = null, keep = () => true, prep = (it) => it) {
  const url = (p) => `${NCEI_API}/${path}?page=${p}`;
  let over = false; // once a page fails for good, late pages must not revive the status or the list
  const tick = (done, pages) => { if (!over) setStatus(key, `NOAA NCEI: loading ${label}… ${Math.round((done / pages) * 100)}%`, { busy: true }); };
  const S = name ? Object.assign(stream(name), { items: [], byId: new Map(), done: false }) : null;
  const take = (list) => {
    if (!S) return;
    for (const raw of list) if (keep(raw)) { const it = prep(raw); S.items.push(it); S.byId.set(it.id, it); }
    for (const f of [...S.subs]) f(S);
  };
  setStatus(key, `NOAA NCEI: loading ${label}…`, { busy: true });
  try {
    const first = await retry(() => getJSON(url(1), { timeout: 30000 }));
    const pages = Math.max(1, first.totalPages ?? 1);
    const items = [...(first.items ?? [])];
    take(first.items ?? []);
    let done = 1, next = 2;
    tick(done, pages);
    const worker = async () => {
      while (next <= pages && !over) {
        const p = next++;
        const d = await retry(() => getJSON(url(p), { timeout: 30000 }));
        if (over) return;
        items.push(...(d.items ?? []));
        take(d.items ?? []);
        tick(++done, pages);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pages - 1) }, worker));
    if (S) S.done = true;
    return { items, total: first.totalItems ?? items.length, fetched: new Date() };
  } catch (err) {
    throw new Error(`NOAA NCEI did not answer — ${why(err)}. Try again in a moment.`);
  } finally {
    over = true;
    setStatus(key, null);
  }
}
const cache = {};
function once(name, fn) {
  cache[name] ??= fn().catch((err) => { delete cache[name]; throw err; });
  return cache[name];
}

const loadPlates = () => once("plates", async () => {
  const d = await getJSON(DATA.plates, { timeout: 30000 });
  for (const f of d.boundaries.features) {
    const b = f.properties.b;
    f.properties.p = b[2] === "/" ? "l" : b[2] === "\\" ? "r" : "";
  }
  cache.platesData = d;
  return d;
});

const hasXY = (o) => num(o.latitude) != null && num(o.longitude) != null;
const loadVolcanoes = () => once("volcanoes", async () => {
  const r = await nceiAll("volcanolocs", "Holocene volcanoes", "ncei-volc", "volcanoes", hasXY, (v) => ({ ...v, g: volcGroup(v.morphology), r: ERUPT[v.timeErupt]?.[0] ?? 9 }));
  return (cache.volcSync = { list: stream("volcanoes").items, byId: stream("volcanoes").byId, total: r.total, fetched: r.fetched });
});
const loadEruptions = () => once("eruptions", async () => {
  const r = await nceiAll("volcanoes", "significant eruptions", "ncei-erupt");
  const byLoc = new Map();
  for (const e of r.items) {
    if (e.volcanoLocationId == null) continue;
    if (!byLoc.has(e.volcanoLocationId)) byLoc.set(e.volcanoLocationId, []);
    byLoc.get(e.volcanoLocationId).push(e);
  }
  for (const list of byLoc.values()) list.sort((a, b) => dateKey(b) - dateKey(a));
  return (cache.eruptSync = { byLoc, total: r.total, fetched: r.fetched });
});
const loadTsunamis = () => once("tsunamis", async () => {
  const r = await nceiAll("tsunamis/events", "historical tsunamis", "ncei-ts", "tsunamis", (t) => hasXY(t) && (t.eventValidity ?? 0) >= 1);
  return (cache.tsSync = { list: stream("tsunamis").items, byId: stream("tsunamis").byId, total: r.total, fetched: r.fetched });
});
const loadQuakes = () => once("quakes", async () => {
  const r = await nceiAll("earthquakes", "significant earthquakes", "ncei-eq", "quakes", hasXY);
  return (cache.eqSync = { list: stream("quakes").items, byId: stream("quakes").byId, total: r.total, fetched: r.fetched });
});
/** Adds a streamed NCEI point layer as soon as its first page arrives, then grows it page by page. */
async function streamedLayer(m, id, name, load, toFC, build) {
  const S = stream(name);
  const all = load();
  all.catch(() => {});
  if (!S.done) await Promise.race([firstItems(S), all]);
  if (!S.items.length) await all; // surfaces a load error to the layer toggle
  if (!app.layers.isOn(id) || m.getSource(`${id}-src`)) return;
  m.addSource(`${id}-src`, { type: "geojson", data: toFC(S.items) });
  build(`${id}-src`);
  // Stays subscribed while the layer is on, so a later reload (after a partial failure) refreshes it too.
  let queued = 0;
  const sub = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; m.getSource(`${id}-src`)?.setData(toFC(S.items)); }); };
  S.subs.add(sub);
  layerSubs.set(id, () => { S.subs.delete(sub); cancelAnimationFrame(queued); });
  if (!S.done) all.then(sub, () => { sub(); setStatus(`part-${name}`, `NOAA NCEI stopped answering; showing the ${fmt(S.items.length)} events loaded so far.`, { tone: "warn", ms: 10000 }); });
}
const layerSubs = new Map();
function unsubscribe(id) { layerSubs.get(id)?.(); layerSubs.delete(id); }
const loadMrdsCodes = () => once("mrdsCodes", async () => (cache.mrdsCodesSync = await getJSON(DATA.mrdsCodes, { timeout: 20000 })));

/* ================================================================ formatting */
const dateKey = (o) => (o.year ?? -99999) * 10000 + (o.month ?? 0) * 100 + (o.day ?? 0);
function eventDate(o, withTime = true) {
  if (o.year == null) return "Date not recorded";
  const y = o.year < 0 ? `${-o.year} BC` : String(o.year);
  let s = o.month && o.day ? `${o.day} ${MON[o.month - 1]} ${y}` : o.month ? `${MONTH[o.month - 1]} ${y}` : y;
  if (withTime && o.hour != null) s += `, ${pad(o.hour)}:${pad(o.minute ?? 0)} UTC`;
  return s;
}
const yearText = (y) => (y == null ? "year unknown" : y < 0 ? `${-y} BC` : String(y));
/** A recorded number when NCEI has one, else NCEI's coded description, else "Not recorded". */
function effect(n, order, unit = "") {
  if (n != null) return `${fmt(n)}${unit}`;
  if (order != null && AMOUNT[order]) return `${AMOUNT[order]} (NCEI estimate)`;
  return null;
}
const money = (m) => (m == null ? null : `$${fmt(m, m < 10 ? 1 : 0)} million (NCEI estimate)`);
const retrieved = (d) => `retrieved ${d ? d.toISOString().slice(0, 10) : today()}`;
const roman = (n) => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][n] ?? String(n);
function magScale(q) {
  const m = q.eqMagnitude;
  if (m == null) return "";
  for (const [k, lab] of [["eqMagMw", "Mw"], ["eqMagMs", "Ms"], ["eqMagMb", "mb"], ["eqMagMl", "ML"], ["eqMagMfa", "Mfa"]]) if (q[k] === m) return lab;
  return "M";
}

/* ================================================================ interaction */
const INTERACTIVE = ["res-", "live-", "cat-i-", "pin-", "meas-", "tour-"];
const HANDLERS = []; // [prefix, { hover(f) -> html, click(f, e) }]
const on = (prefix, h) => HANDLERS.push([prefix, h]);
const handlerFor = (id) => HANDLERS.find(([p]) => id.startsWith(p))?.[1];
function topHit(point) {
  const top = app.map.queryRenderedFeatures(point).find((f) => INTERACTIVE.some((p) => f.layer.id.startsWith(p)));
  if (!top) return null;
  const h = handlerFor(top.layer.id);
  return h ? { f: top, h } : null;
}
let popup = null;
function wireInteraction() {
  const map = app.map;
  popup = new app.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "ed-pop", maxWidth: "280px" });
  let raf = 0, mine = false, lastH = null;
  map.on("mousemove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (app.mode && app.mode !== "explore") return;
      const hit = topHit(e.point);
      if (lastH && lastH !== hit?.h) lastH.leave?.();
      lastH = hit?.h ?? null;
      if (hit) {
        map.getCanvas().style.cursor = "pointer";
        mine = true;
        const html = hit.h.hover?.(hit.f);
        if (html) popup.setLngLat(hit.f.geometry.type === "Point" ? hit.f.geometry.coordinates : e.lngLat).setHTML(html).addTo(map);
        else popup.remove();
      } else if (mine) {
        mine = false;
        map.getCanvas().style.cursor = "";
        popup.remove();
      }
    });
  });
  map.on("mouseout", () => { popup.remove(); lastH?.leave?.(); lastH = null; });
  map.on("click", (e) => {
    if (app.mode === "ed-probe") return runProbe(e.lngLat);
    if (probeKind) stopProbe(); // another tool took over the mode
    if (app.mode && app.mode !== "explore") return;
    const hit = topHit(e.point);
    if (!hit) return;
    popup.remove();
    hit.h.click(hit.f, e);
  });
}

/** Runs a tool from a card button; a failed answer shows in the status pill instead of vanishing. */
function runFromCard(name, input) {
  const fail = (msg) => setStatus(`card-${name}`, msg, { tone: "warn", ms: 9000 });
  return app.tools.run(name, input).then((r) => {
    if (r?.ok === false) fail(r.error);
    else if (r?.total_matches === 0) setStatus(`card-${name}`, String(r.summary ?? "Nothing found.").replace(/\*\*/g, ""), { ms: 7000 });
    return r;
  }, (err) => fail(err.message));
}
/** Card chrome shared by every feature card. */
function card(html, bind) {
  app.ui.showCard(`<div class="ed-card">${html}</div>`, { onClose: () => setFocus(null) });
  bind?.($("#card-body"));
}
const flyTo = (lng, lat, zoom = 9, pitch = 50) => app.map.flyTo({ center: [lng, lat], zoom: Math.max(app.map.getZoom(), zoom), pitch, speed: 1.3 });
/** Brings a point a tool answered about into view when it is off screen (agent calls can be anywhere),
 *  or closer when the answer is only visible from `minZoom` (glacier outlines). */
function reveal(lng, lat, zoom = 7, minZoom = 0) {
  const m = app.map;
  const p = m.project([lng, lat]);
  const c = m.getCanvas();
  const onScreen = p.x >= 0 && p.y >= 0 && p.x <= c.clientWidth && p.y <= c.clientHeight && m.getBounds().contains([lng, lat]);
  if (!onScreen || m.getZoom() < minZoom) m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), zoom), speed: 1.3 });
}

/* Focus ring on the feature a card describes, and result rings for tool answers. */
function ringSource(id, fc, before = "top") {
  const m = app.map;
  if (m.getSource(id)) return m.getSource(id).setData(fc);
  m.addSource(id, { type: "geojson", data: fc });
  m.addLayer({ id, type: "circle", source: id, paint: {
    "circle-radius": id === "ed-focus" ? 13 : 9, "circle-color": "rgba(255,255,255,0)",
    "circle-stroke-color": "#ffffff", "circle-stroke-width": id === "ed-focus" ? 2.5 : 2, "circle-stroke-opacity": 0.95,
  } }, app.layers.anchor(before));
}
const pointFC = (pts) => ({ type: "FeatureCollection", features: pts.map(([lng, lat]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} })) });
function setFocus(pt) { ringSource("ed-focus", pointFC(pt ? [pt] : [])); }
function showResults(points, owner) {
  ringSource("ed-results", pointFC(points));
  resultsOwner = owner;
  if (!points.length) return;
  if (points.length === 1) return flyTo(points[0][0], points[0][1], 7, 0);
  const b = new app.maplibregl.LngLatBounds();
  points.forEach((p) => b.extend(p));
  const phone = innerWidth <= 720;
  const cardOpen = !$("#card").hidden;
  app.map.fitBounds(b, { padding: phone ? { top: 80, bottom: 120, left: 30, right: 30 } : { top: 100, bottom: 100, left: app.ui.current ? 480 : 100, right: cardOpen ? 460 : 100 }, maxZoom: 8, speed: 1.3 });
}
let resultsOwner = null;
function clearResults(owner) { if (resultsOwner === owner) ringSource("ed-results", pointFC([])); }

/* ================================================================ legends */
const sw = (c, shape = "") => (shape === "teeth"
  ? `<svg class="ed-sw-svg" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 9.5h20" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M3.5 9.5 6 4l2.5 5.5zM13.5 9.5 16 4l2.5 5.5z" fill="${c}"/></svg>`
  : `<i class="ed-sw ${shape}" style="--c:${c}" aria-hidden="true"></i>`);
const keyRow = (rows) => `<div class="ed-key">${rows.map(([c, t, shape]) => `<span>${sw(c, shape)}${esc(t)}</span>`).join("")}</div>`;
const note = (t) => `<p class="ed-note">${t}</p>`;
function ramp(colors, ticks, cap = [], hard = false) {
  const edge = (pos) => (pos <= 4 ? ' class="l"' : pos >= 96 ? ' class="r"' : "");
  const n = colors.length;
  const stops = hard ? colors.map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`) : colors.map((c, i) => `${c} ${((i / (n - 1)) * 100).toFixed(1)}%`);
  return `<div class="ed-ramp"><div class="bar" style="--g:linear-gradient(90deg, ${stops.join(", ")})"></div>
    <div class="ticks">${ticks.map(([pos, t]) => `<span${edge(pos)} style="left:${pos.toFixed(1)}%">${esc(t)}</span>`).join("")}</div>
    ${cap.some(Boolean) ? `<div class="cap"><span>${esc(cap[0])}</span><span>${esc(cap[1])}</span></div>` : ""}</div>`;
}
const probeBtn = (kind, label) => `<button type="button" class="chip chip-soft chip-btn ed-probe" data-ed-probe="${kind}" aria-pressed="false">${ic("target", 14, 2)}${esc(label)}</button>`;
const legendWrap = (inner) => `<div class="ed-legend">${inner}</div>`;
function soilLegend(p) {
  const s = SOIL_WMS[p];
  const n = s.colors.length;
  // ISRIC's class labels are lower bounds, so each tick sits where its class begins.
  const lab = (i, last) => { const v = s.labels[i] / s.div; return `${fmt(v, v >= 100 || !(v % 1) ? 0 : 1)}${s.unit === "%" ? "%" : last && s.unit !== "pH" ? ` ${s.unit}` : ""}`; };
  const ticks = s.ticks.map((i, k) => [(i / n) * 100, lab(i, k === s.ticks.length - 1)]);
  const unit = s.unit === "pH" ? "pH in water" : s.unit === "%" ? "% of the fine earth by mass" : "g of organic carbon per kg";
  return legendWrap(`${ramp(s.colors, ticks, s.cap, true)}
    ${note(`Topsoil 0–5 cm, ${unit}. Mean of the SoilGrids 2.0 prediction at 250 m — modelled, not measured. Classes from ISRIC's <a href="https://maps.isric.org/mapserv?map=/map/${p}.map&version=1.3.0&service=WMS&request=GetLegendGraphic&sld_version=1.1.0&layer=${p}_0-5cm_mean&format=image/png&STYLE=default" target="_blank" rel="noopener">official legend</a>.`)}
    ${probeBtn("soil", "Read soil at a point")}`);
}

/* ================================================================ layer factory */
/** Layers carry their legend under both names: `legend` (core contract) and `legendHtml` (Layers panel). */
const defineLayer = (def) => app.layers.define({ ...def, legendHtml: def.legendHtml ?? def.legend });
const opacity = new Map();
/** A raster layer served through the edtile protocol. `tiles(time)` builds the template. */
function rasterLayer(o) {
  const src = `ed-src-${o.id}`, lid = `${o.id}-r`;
  return {
    id: o.id, title: o.title, sub: o.sub, category: o.category, description: o.description, keywords: o.keywords,
    source: o.source, attribution: o.attribution, license: o.license, kind: "raster", slot: o.slot ?? "overlay",
    opacity: o.opacity, legend: o.legend, legendHtml: o.legend, detail: o.detail, coverage: o.coverage, minZoomHint: o.minZoomHint,
    ...(o.time ? { time: o.time } : {}),
    add(m, ctx) {
      m.addSource(src, { type: "raster", tiles: [o.tiles(ctx?.time)], tileSize: 256, maxzoom: o.maxzoom, ...(o.bounds ? { bounds: o.bounds } : {}) });
      m.addLayer({ id: lid, type: "raster", source: src, ...(o.minzoom ? { minzoom: o.minzoom } : {}), ...(o.layerMaxzoom ? { maxzoom: o.layerMaxzoom } : {}),
        paint: { "raster-opacity": opacity.get(o.id) ?? o.opacity ?? 0.8, "raster-fade-duration": REDUCED ? 0 : 220, ...(o.resampling ? { "raster-resampling": o.resampling } : {}) } }, app.layers.anchor(o.slot ?? "overlay"));
      o.afterAdd?.(m, ctx);
    },
    remove(m) {
      o.beforeRemove?.(m);
      if (m.getLayer(lid)) m.removeLayer(lid);
      if (m.getSource(src)) m.removeSource(src);
    },
    setOpacity(m, v) {
      opacity.set(o.id, v);
      if (m.getLayer(lid)) m.setPaintProperty(lid, "raster-opacity", v);
      o.onOpacity?.(m, v);
    },
    ...(o.time ? { setTime(m, iso) { m.getSource(src)?.setTiles([o.tiles(iso)]); } } : {}),
  };
}
const rm = (m, layers, sources = []) => {
  for (const id of layers) if (m.getLayer(id)) m.removeLayer(id);
  for (const id of sources) if (m.getSource(id)) m.removeSource(id);
};
const hitCircle = (id, source, radius = 9) => ({ id, type: "circle", source, paint: { "circle-radius": radius, "circle-opacity": 0, "circle-stroke-width": 0 } });

/* ================================================================ tectonics */
function defineTectonics() {
  defineLayer({
    id: "ed-plates",
    title: "Tectonic plate boundaries",
    sub: "PB2002 · 52 plates · ridges, trenches, transforms",
    category: "Geology & tectonics",
    description: "Peter Bird's PB2002 model of 52 plates: every boundary classed as a spreading ridge or rift, transform fault, subduction zone (teeth on the overriding plate) or convergent belt, with the model's relative plate velocity. Shaded areas are orogens — broad zones of distributed deformation. Click a boundary for its plates and motion.",
    keywords: ["tectonic", "tectonics", "plates", "plate boundaries", "faults", "subduction", "trench", "trenches", "ridge", "mid-ocean ridge", "rift", "transform", "ring of fire", "orogen", "pb2002", "continental drift"],
    source: "Bird (2003) PB2002, via Hugo Ahlenius / Nordpil (GitHub, pinned commit)",
    attribution: "Plate boundaries: Bird (2003) PB2002; data conversion Hugo Ahlenius, Nordpil (ODC-By 1.0)",
    license: LIC.odcby,
    detail: "5,819 digitised steps merged into 1,683 classed segments; velocities from PB2002 Euler poles",
    kind: "geojson", slot: "data",
    legend: legendWrap(`${keyRow([[PLATE_C.div, "Spreading ridge or rift", "line"], [PLATE_C.tr, "Transform fault", "line"], [PLATE_C.sub, "Subduction zone (teeth on the overriding plate)", "teeth"], [PLATE_C.conv, "Convergent or collision belt", "line"]])}
      ${keyRow([["#6f6c67", "Dashed: continental boundary", "dash"], [PLATE_C.conv, "Orogen (broad deformation zone)", "hatch"]])}
      ${note("Classes and velocities are those of model PB2002 (Bird 2003).")}`),
    async add(m) {
      const d = await loadPlates();
      if (!app.layers.isOn("ed-plates") || m.getSource("ed-plates")) return;
      ensureIcons(m);
      const before = app.layers.anchor("data");
      m.addSource("ed-plates", { type: "geojson", data: d.boundaries });
      m.addSource("ed-orogens", { type: "geojson", data: d.orogens });
      m.addSource("ed-plate-labels", { type: "geojson", data: d.labels });
      m.addLayer({ id: "ed-orogens-fill", type: "fill", source: "ed-orogens", paint: { "fill-color": PLATE_C.conv, "fill-opacity": 0.1 } }, before);
      m.addLayer({ id: "ed-orogens-line", type: "line", source: "ed-orogens", paint: { "line-color": PLATE_C.conv, "line-opacity": 0.45, "line-width": 0.8, "line-dasharray": [2, 2] } }, before);
      m.addLayer({ id: "ed-plates-glow", type: "line", source: "ed-plates", layout: { "line-join": "round", "line-cap": "round" }, paint: {
        "line-color": PLATE_COLOR, "line-opacity": 0.32, "line-blur": 4, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 6, 6, 12, 12, 16] } }, before);
      m.addLayer({ id: "ed-plates-ocean", type: "line", source: "ed-plates", filter: ["in", ["get", "c"], ["literal", ["OSR", "OTF", "OCB", "SUB"]]], layout: { "line-join": "round", "line-cap": "round" }, paint: {
        "line-color": PLATE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.8, 4, 2.6, 8, 3.6, 12, 4.5] } }, before);
      m.addLayer({ id: "ed-plates-cont", type: "line", source: "ed-plates", filter: ["in", ["get", "c"], ["literal", ["CRB", "CTF", "CCB"]]], layout: { "line-join": "round" }, paint: {
        "line-color": PLATE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.8, 4, 2.6, 8, 3.6, 12, 4.5], "line-dasharray": [2.2, 1.3] } }, before);
      m.addLayer({ id: "ed-plates-teeth", type: "symbol", source: "ed-plates", filter: ["all", ["==", ["get", "c"], "SUB"], ["!=", ["get", "p"], ""]], layout: {
        "symbol-placement": "line", "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 1, 26, 6, 44, 10, 60], "icon-image": ["concat", "ed-tooth-", ["get", "p"]],
        "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-keep-upright": false,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.75, 4, 1, 8, 1.3, 12, 1.5] } }, before);
      for (const [rank, minzoom, size] of [[1, 0, 11], [2, 2.6, 10], [3, 4, 9.5]]) {
        m.addLayer({ id: `ed-plate-labels-${rank}`, type: "symbol", source: "ed-plate-labels", minzoom, filter: ["==", ["get", "rank"], rank], layout: {
          "text-field": ["upcase", ["concat", ["get", "name"], " plate"]], "text-font": ["Noto Sans Bold"], "text-size": size, "text-letter-spacing": 0.3, "text-max-width": 8,
          // Region-scale names: always shown, never pushing place names off the map.
          "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "rgba(255,226,170,0.82)", "text-halo-color": "rgba(20,12,0,0.6)", "text-halo-width": 1.4 } }, before);
      }
      m.addLayer({ id: "cat-i-ed-plates", type: "line", source: "ed-plates", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 14 } }, before);
    },
    remove(m) {
      rm(m, ["cat-i-ed-plates", "ed-plate-labels-1", "ed-plate-labels-2", "ed-plate-labels-3", "ed-plates-teeth", "ed-plates-cont", "ed-plates-ocean", "ed-plates-glow", "ed-orogens-line", "ed-orogens-fill"],
        ["ed-plates", "ed-orogens", "ed-plate-labels"]);
      clearResults("plates");
    },
  });
  on("cat-i-ed-plates", {
    hover: (f) => { const d = boundaryText(f.properties); return `<b>${esc(d.cls.t)}</b><span>${esc(d.line)}</span>`; },
    click: (f, e) => plateCard(f.properties, e.lngLat),
  });
}
function boundaryText(p) {
  const P = cache.platesData?.plates ?? {};
  const [a, b] = [p.b.slice(0, 2), p.b.slice(3, 5)];
  const na = P[a] ?? a, nb = P[b] ?? b;
  const cls = CLASS[p.c] ?? { t: "Plate boundary", k: "conv", about: "" };
  let line = `Between the ${na} and ${nb} plates`;
  if (p.c === "SUB" && p.p === "l") line = `${nb} plate subducts beneath the ${na} plate`;
  else if (p.c === "SUB" && p.p === "r") line = `${na} plate subducts beneath the ${nb} plate`;
  return { cls, line, a, b, na, nb };
}
function motionText(p) {
  const parts = [];
  if (Math.abs(p.div) >= 0.5) parts.push(`${p.div > 0 ? "opening" : "closing"} ≈ ${fmt(Math.abs(p.div), 1)} mm/yr`);
  if (Math.abs(p.rl) >= 0.5) parts.push(`${p.rl > 0 ? "right" : "left"}-lateral ≈ ${fmt(Math.abs(p.rl), 1)} mm/yr`);
  return parts.join(" · ");
}
async function plateCard(p, at) {
  await loadPlates();
  const d = boundaryText(p);
  card(`${cardHead({ badge: `<b>${fmt(p.v, 0)}</b><small>mm/yr</small>`, color: PLATE_C[d.cls.k], eyebrow: "Plate boundary · PB2002", title: d.cls.t, sub: d.line })}
    <p class="ed-lead">${esc(d.cls.about)}</p>
    ${kv([
      ["Plates", `${d.na} (${d.a}) · ${d.nb} (${d.b})`],
      ["Relative speed", `≈ ${fmt(p.v, 1)} mm/yr`],
      ["Motion", motionText(p) || "—"],
      ["Setting", /^C/.test(p.c) ? "Continental" : p.c === "SUB" ? "Subduction (not split by crust type)" : "Oceanic"],
      ["This segment", `≈ ${fmt(p.km)} km of boundary ${p.b}`],
    ])}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="volc">Volcanoes nearby</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="eq">Past earthquakes</button>
      ${extLink("https://doi.org/10.1029/2001GC000252", "Bird 2003")}
    </div>
    <p class="note">Model PB2002 (Bird 2003). Speeds are the model's relative velocity of the ${esc(d.na)} plate with respect to the ${esc(d.nb)} plate, averaged along this segment. ODC-By 1.0 via Hugo Ahlenius / Nordpil.</p>`,
  (body) => {
    const near = { lat: +at.lat.toFixed(4), lng: +at.lng.toFixed(4), radius_km: 400 };
    body.querySelector('[data-act="volc"]').onclick = () => runFromCard("find_volcanoes", { near, limit: 40 });
    body.querySelector('[data-act="eq"]').onclick = () => runFromCard("find_historical_earthquakes", { near, limit: 60 });
  });
  setFocus(null);
}

function defineGeophysics() {
  const EMAG = ["#19024f", "#1f1456", "#282763", "#2c327d", "#313d98", "#3e4fa2", "#4b61ad", "#84bde3", "#fffcfd", "#e5e47d", "#e6963e", "#de5e57", "#d52870", "#ca247d", "#bf2389", "#ae2a8e", "#9d3193"];
  app.layers.define(rasterLayer({
    id: "ed-magnetic",
    title: "Magnetic anomalies · EMAG2v3",
    sub: "NOAA NCEI · 2 arc-minute global grid",
    category: "Geology & tectonics",
    description: "The Earth Magnetic Anomaly Grid (EMAG2v3) compiled by NOAA NCEI from satellite, ship and airborne magnetic surveys. Stripes parallel to mid-ocean ridges record reversals of the magnetic field in cooling sea floor; on land, anomalies can trace buried rock bodies and structures. Areas without data are left transparent.",
    keywords: ["magnetic", "magnetism", "magnetic anomaly", "emag2", "geomagnetic", "seafloor stripes", "reversals", "geophysics", "nanotesla"],
    source: "NOAA NCEI Earth Magnetic Anomaly Grid, EMAG2v3",
    attribution: "Magnetic anomalies: NOAA NCEI EMAG2v3",
    license: LIC.usgov,
    detail: "2 arc-minute grid (about 3.7 km), in nanotesla (nT)",
    opacity: 0.7, maxzoom: 8,
    legend: legendWrap(`${ramp(EMAG, [[0, "−200"], [25, "−100"], [50, "0"], [75, "+100"], [100, "+200 nT"]])}
      ${note("Colour scale of NOAA's EMAG2 renderer (values beyond ±200 nT take the end colours).")}
      ${probeBtn("magnetic", "Read the anomaly at a point")}`),
    tiles: () => "edtile://emag/{z}/{x}/{y}?bbox={bbox-epsg-3857}",
  }));

  const SEA = ["#e8e5e5", "#ca9390", "#d16d65", "#e3a068", "#dfc97d", "#aadfa6", "#79d5da", "#4f9ee8", "#434bc0", "#433d80"];
  app.layers.define(rasterLayer({
    id: "ed-seafloor",
    title: "Surveyed seafloor · multibeam",
    sub: "NOAA NCEI mosaic · ship surveys only",
    category: "Geology & tectonics",
    description: "Multibeam sonar surveys archived at NOAA NCEI, mosaicked and hill-shaded: the measured shape of the sea floor where ships have mapped it — ridges, fracture zones, seamounts and canyons. Unsurveyed ocean stays transparent, which shows how much of the sea floor has not been mapped this way.",
    keywords: ["multibeam", "sonar", "bathymetry", "seafloor", "sea floor", "ocean floor", "seamounts", "survey", "ridge", "canyon", "ncei"],
    source: "NOAA NCEI multibeam bathymetry mosaic",
    attribution: "Seafloor: NOAA NCEI multibeam bathymetry mosaic",
    license: LIC.usgov,
    detail: "Native grid about 90 m; coverage follows ship tracks",
    opacity: 1, maxzoom: 11,
    legend: legendWrap(`${ramp(SEA, [[0, "0 m"], [25, "2,000"], [50, "4,000"], [75, "6,000"], [100, "8,000 m"]], ["Shallow", "Deep"])}
      ${note("Approximate colours of NOAA's depth ramp (0 to 8,000 m), shaded for relief. Not for navigation.")}`),
    tiles: () => "edtile://seafloor/{z}/{x}/{y}?bbox={bbox-epsg-3857}",
  }));
}

/* ================================================================ hazards (historical) */
function defineHazards() {
  defineLayer({
    id: "ed-volcanoes",
    title: "Holocene volcanoes",
    sub: "NOAA NCEI · 1,600+ volcanoes worldwide",
    category: "Hazards (historical)",
    description: "About 1,600 volcanoes with known or probable eruptions in the Holocene (roughly the last 11,700 years), from NOAA NCEI's Volcano Location Database (compiled from the Smithsonian Global Volcanism Program). Triangles are coloured by volcano type; larger ones last erupted in 1964 or later. Click one for its last known eruption and the significant volcanic events NCEI has on record.",
    keywords: ["volcano", "volcanoes", "volcanic", "eruption", "eruptions", "holocene", "ring of fire", "stratovolcano", "caldera", "ncei", "lava"],
    source: "NOAA NCEI Volcano Location Database",
    attribution: "Volcanoes: NOAA NCEI/WDS Volcano Location Database",
    license: LIC.usgov,
    detail: "Locations, type, elevation and last-eruption class; fetched live from the NCEI Hazard Service",
    kind: "geojson", slot: "data",
    legend: legendWrap(`${keyRow(VOLC.map((v) => [v.c, v.label, "tri"]))}
      ${note("Larger triangle: last known eruption 1964 or later; medium: 1900–1963.")}`),
    async add(m) {
      ensureIcons(m);
      await streamedLayer(m, "ed-volcanoes", "volcanoes", loadVolcanoes, (list) => ({
        type: "FeatureCollection",
        features: list.map((v) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.longitude, v.latitude] }, properties: { id: v.id, n: v.name, g: v.g, r: v.r } })),
      }), (src) => {
      const before = app.layers.anchor("data");
      const size = (base) => ["match", ["get", "r"], 1, base * 1.25, 2, base, base * 0.8];
      m.addLayer({ id: "ed-volc-tri", type: "symbol", source: src, layout: {
        "icon-image": ["concat", "ed-volc-", ["get", "g"]], "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, size(0.62), 6, size(0.95), 10, size(1.25)], "symbol-sort-key": ["-", 10, ["get", "r"]] } }, before);
      m.addLayer({ id: "ed-volc-label", type: "symbol", source: src, minzoom: 6, layout: {
        "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-optional": true, "text-max-width": 9 },
      paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.78)", "text-halo-width": 1.3 } }, before);
      m.addLayer(hitCircle("cat-i-ed-volc", src, 10), before);
      });
      loadEruptions().catch(() => {});
    },
    remove(m) { unsubscribe("ed-volcanoes"); rm(m, ["cat-i-ed-volc", "ed-volc-label", "ed-volc-tri"], ["ed-volcanoes-src"]); clearResults("volcanoes"); },
  });
  on("cat-i-ed-volc", {
    hover: (f) => {
      const v = stream("volcanoes").byId.get(f.properties.id);
      return v ? `<b>${esc(v.name)}</b><span>${esc(v.morphology || "Volcano")} · ${esc(v.country ?? "")} · last eruption ${esc(ERUPT[v.timeErupt]?.[1]?.toLowerCase() ?? "not coded")}</span>` : `<b>${esc(f.properties.n)}</b>`;
    },
    click: (f) => volcanoCard(stream("volcanoes").byId.get(f.properties.id), cache.volcSync),
  });

  defineLayer({
    id: "ed-tsunamis",
    title: "Historical tsunamis",
    sub: "NOAA NCEI · 2000 BC to today",
    category: "Hazards (historical)",
    description: "Tsunami source events from NOAA NCEI's Global Historical Tsunami Database, from about 2000 BC to the present. Circles are coloured by cause and sized by the maximum water height recorded; faded circles are questionable or very doubtful events. Deaths and damage appear only where NCEI has a record.",
    keywords: ["tsunami", "tsunamis", "tidal wave", "run-up", "runup", "wave", "ncei", "history", "historical"],
    source: "NOAA NCEI/WDS Global Historical Tsunami Database",
    attribution: "Tsunamis: NOAA NCEI/WDS Global Historical Tsunami Database",
    license: LIC.usgov,
    detail: "Source events with validity 1–4; erroneous entries and seiches are left out",
    kind: "geojson", slot: "data",
    legend: legendWrap(`${keyRow([[TS_C.eq, "Earthquake", "dot"], [TS_C.volc, "Volcano", "dot"], [TS_C.slide, "Landslide", "dot"], [TS_C.met, "Meteorological", "dot"], [TS_C.other, "Other or unknown", "dot"]])}
      ${note("Size: maximum water height (tide gauge or run-up). Faded: questionable or very doubtful.")}`),
    async add(m) {
      await streamedLayer(m, "ed-tsunamis", "tsunamis", loadTsunamis, (list) => ({
        type: "FeatureCollection",
        features: list.map((t) => ({ type: "Feature", geometry: { type: "Point", coordinates: [t.longitude, t.latitude] }, properties: { id: t.id, g: TS_GROUP(t.causeCode), h: Math.min(num(t.maxWaterHeight) ?? 0, 300), v: t.eventValidity } })),
      }), (src) => {
      const before = app.layers.anchor("data");
      const r = (a, k) => ["+", a, ["*", k, ["ln", ["+", 1, ["get", "h"]]]]];
      m.addLayer({ id: "ed-ts-dot", type: "circle", source: src, paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, r(2.6, 1.4), 5, r(3.4, 1.9), 10, r(4.8, 2.8)],
        "circle-color": ["match", ["get", "g"], "eq", TS_C.eq, "volc", TS_C.volc, "slide", TS_C.slide, "met", TS_C.met, TS_C.other],
        "circle-opacity": ["case", [">=", ["get", "v"], 3], 0.92, 0.42],
        "circle-stroke-color": "rgba(255,255,255,0.85)", "circle-stroke-opacity": ["case", [">=", ["get", "v"], 3], 1, 0.4], "circle-stroke-width": 0.9 }, layout: { "circle-sort-key": ["get", "h"] } }, before);
      m.addLayer(hitCircle("cat-i-ed-ts", src, 8), before);
      });
    },
    remove(m) { unsubscribe("ed-tsunamis"); rm(m, ["cat-i-ed-ts", "ed-ts-dot"], ["ed-tsunamis-src"]); clearResults("tsunamis"); },
  });
  on("cat-i-ed-ts", {
    hover: (f) => {
      const t = stream("tsunamis").byId.get(f.properties.id);
      return t ? `<b>${esc(nceiPlace(t).full)}</b><span>${esc(eventDate(t, false))} · ${esc(TS_CAUSE[t.causeCode] ?? "Unknown cause")}${t.maxWaterHeight != null ? ` · ${fmt(t.maxWaterHeight, 1)} m` : ""}</span>` : "";
    },
    click: (f) => tsunamiCard(stream("tsunamis").byId.get(f.properties.id), cache.tsSync),
  });

  defineLayer({
    id: "ed-quakes",
    title: "Significant earthquakes in history",
    sub: "NOAA NCEI · 2150 BC to today",
    category: "Hazards (historical)",
    description: "Destructive earthquakes from NOAA NCEI's Global Significant Earthquake Database: events that caused about $1 million or more damage, 10 or more deaths, reached magnitude 7.5 or intensity X, or generated a tsunami. Circles are sized by magnitude and coloured by recorded deaths. For today's earthquakes use the live layer.",
    keywords: ["earthquake", "earthquakes", "quake", "quakes", "seismic", "historical", "history", "significant", "deadliest", "ncei", "disaster"],
    source: "NOAA NCEI/WDS Global Significant Earthquake Database",
    attribution: "Earthquakes: NOAA NCEI/WDS Global Significant Earthquake Database",
    license: LIC.usgov,
    detail: "About 6,700 events; fetched live from the NCEI Hazard Service",
    kind: "geojson", slot: "data",
    legend: legendWrap(`${keyRow([[DEATH_C[4], "Over 1,000 deaths", "dot"], [DEATH_C[3], "101–1,000", "dot"], [DEATH_C[2], "51–100", "dot"], [DEATH_C[1], "1–50", "dot"], [DEATH_C[0], "None", "dot"], [DEATH_C[-1], "Not recorded", "dot"]])}
      ${note("Colour: deaths including secondary effects (tsunami, landslides, fire). Size: magnitude.")}`),
    async add(m) {
      await streamedLayer(m, "ed-quakes", "quakes", loadQuakes, (list) => ({
        type: "FeatureCollection",
        features: list.map((q) => ({ type: "Feature", geometry: { type: "Point", coordinates: [q.longitude, q.latitude] }, properties: { id: q.id, m: num(q.eqMagnitude) ?? 0, d: q.deathsAmountOrderTotal ?? q.deathsAmountOrder ?? -1 } })),
      }), (src) => {
      const before = app.layers.anchor("data");
      const sz = (k) => ["interpolate", ["exponential", 1.7], ["get", "m"], 0, 1.8 * k, 5, 2 * k, 6.5, 3 * k, 7.5, 4.6 * k, 8.5, 7 * k, 9.5, 10.5 * k];
      m.addLayer({ id: "ed-eq-dot", type: "circle", source: src, paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, sz(0.85), 6, sz(1.5), 10, sz(2)],
        "circle-color": ["match", ["get", "d"], 4, DEATH_C[4], 3, DEATH_C[3], 2, DEATH_C[2], 1, DEATH_C[1], 0, DEATH_C[0], DEATH_C[-1]],
        "circle-opacity": 0.85, "circle-stroke-color": "rgba(10,10,12,0.7)", "circle-stroke-width": 0.7 }, layout: { "circle-sort-key": ["get", "m"] } }, before);
      m.addLayer(hitCircle("cat-i-ed-eq", src, 7), before);
      });
    },
    remove(m) { unsubscribe("ed-quakes"); rm(m, ["cat-i-ed-eq", "ed-eq-dot"], ["ed-quakes-src"]); clearResults("quakes"); },
  });
  on("cat-i-ed-eq", {
    hover: (f) => {
      const q = stream("quakes").byId.get(f.properties.id);
      return q ? `<b>${q.eqMagnitude != null ? `M${fmt(q.eqMagnitude, 1)} · ` : ""}${esc(nceiPlace(q).full)}</b><span>${esc(eventDate(q, false))}</span>` : "";
    },
    click: (f) => quakeCard(stream("quakes").byId.get(f.properties.id), cache.eqSync),
  });
}

function volcanoCard(v, V) {
  if (!v) return;
  const last = ERUPT[v.timeErupt]?.[1] ?? (v.timeErupt && v.timeErupt !== "Unknown" ? `Code “${v.timeErupt}” (not in NCEI's legend)` : "Not recorded");
  const erupt = cache.eruptSync?.byLoc.get(v.id) ?? null;
  // NCEI's significant-event list also holds deadly non-eruptive events (landslides, lahars, gas); it flags them eruption:false.
  const eruptBlock = () => {
    if (!cache.eruptSync) return `<p class="note">Loading NCEI's significant volcanic event records…</p>`;
    if (!erupt?.length) return `<p class="note">No event at this volcano is in NCEI's Significant Volcanic Eruption Database.</p>`;
    const shown = erupt.slice(0, 6);
    return `<span class="eyebrow ed-sect">Significant volcanic events on record · ${erupt.length}</span><div class="ed-rows">${shown.map((e) => {
      const deaths = effect(e.deathsTotal ?? e.deaths, e.deathsAmountOrderTotal ?? e.deathsAmountOrder);
      const bits = [e.eruption === false ? "No eruption" : "", e.vei != null ? `VEI ${e.vei}` : "", deaths ? `deaths: ${deaths}` : ""].filter(Boolean);
      return `
      <div class="ed-row"><b>${esc(yearText(e.year))}</b><span>${bits.map(esc).join(" · ") || "Effects not recorded"}</span>
      <a href="${NCEI_VIEW}/volcano/event-more-info/${e.id}" target="_blank" rel="noopener" aria-label="NCEI record of the ${esc(yearText(e.year))} event">Record</a></div>`;
    }).join("")}</div>${erupt.length > shown.length ? `<p class="note">The ${shown.length} most recent of ${erupt.length}. “No eruption” marks deadly events NCEI records without an eruption, such as landslides or lahars.</p>` : erupt.some((e) => e.eruption === false) ? `<p class="note">“No eruption” marks deadly events NCEI records without an eruption, such as landslides or lahars.</p>` : ""}`;
  };
  const render = () => card(`${cardHead({ badge: `${ic("volcano", 22)}<small>${esc(ERUPT_SHORT[v.timeErupt] ?? "Holocene")}</small>`, color: volcColor(v.g), eyebrow: `Volcano · ${v.morphology || "type not recorded"}`, title: v.name, sub: `${[v.location && v.location !== v.country ? v.location : null, v.country].filter(Boolean).join(", ")} · ${v.latitude.toFixed(3)}, ${v.longitude.toFixed(3)}` })}
    ${kv([
      ["Last known eruption", last],
      ["Elevation", v.elevation != null ? `${fmt(v.elevation)} m${v.elevation < 0 ? " (below sea level)" : ""}` : "Not recorded"],
      ["Evidence of activity", v.status || "Not recorded"],
      ["NCEI volcano id", String(v.id)],
    ])}
    ${eruptBlock()}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly in 3D</button>
      ${extLink(`${NCEI_VIEW}/volcano/loc-data?id=${v.id}`, "NCEI record")}
      <button type="button" class="btn btn-ghost btn-sm" data-act="near">Volcanoes nearby</button>
    </div>
    <p class="note">Source: NOAA NCEI/WDS Volcano Location Database (from the Smithsonian GVP <i>Volcanoes of the World</i>) and Significant Volcanic Eruption Database (<a href="https://doi.org/10.7289/V5JW8BSH" target="_blank" rel="noopener">doi:10.7289/V5JW8BSH</a>) · ${retrieved(V?.fetched)} · public domain.</p>`,
  (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [v.longitude, v.latitude], zoom: 12, pitch: 62, bearing: app.map.getBearing() + 20, speed: 1.2 });
    body.querySelector('[data-act="near"]').onclick = () => runFromCard("find_volcanoes", { near: { lat: v.latitude, lng: v.longitude, radius_km: 300 }, limit: 30 });
  });
  render();
  setFocus([v.longitude, v.latitude]);
  if (!cache.eruptSync) loadEruptions().then(() => { if ($("#card-body .ed-card") && !$("#card").hidden && $("#card-body h3")?.textContent === v.name) render(); }).catch(() => {});
}

function tsunamiCard(t, T) {
  if (!t) return;
  const g = TS_GROUP(t.causeCode);
  const h = num(t.maxWaterHeight);
  const pl = nceiPlace(t);
  card(`${cardHead({ badge: h != null ? `<b>${fmt(h, h < 10 ? 1 : 0)}</b><small>m high</small>` : `${ic("wave", 22)}<small>Tsunami</small>`, color: TS_C[g], eyebrow: `Tsunami · ${TS_VALID[t.eventValidity] ?? "validity not coded"}`, title: pl.place, sub: [pl.country, eventDate(t)].filter(Boolean).join(" · ") })}
    ${kv([
      ["Cause", TS_CAUSE[t.causeCode] ?? "Not recorded"],
      t.eqMagnitude != null ? ["Earthquake magnitude", fmt(t.eqMagnitude, 1)] : null,
      ["Maximum water height", h != null ? `${fmt(h, 2)} m` : "Not recorded"],
      t.numRunups ? ["Run-up observations", fmt(t.numRunups)] : null,
      t.tsIntensity != null ? ["Intensity (Soloviev)", fmt(t.tsIntensity, 1)] : null,
      ["Deaths · tsunami", effect(t.deaths, t.deathsAmountOrder) ?? "Not recorded"],
      (t.deathsTotal != null || t.deathsAmountOrderTotal != null) && (t.deathsTotal !== t.deaths || t.deathsAmountOrderTotal !== t.deathsAmountOrder) ? ["Deaths · incl. source event", effect(t.deathsTotal, t.deathsAmountOrderTotal)] : null,
      ["Damage · tsunami", money(t.damageMillionsDollars) ?? (DAMAGE[t.damageAmountOrder] ? `${DAMAGE[t.damageAmountOrder]} (NCEI estimate)` : "Not recorded")],
      t.housesDestroyed != null ? ["Houses destroyed", fmt(t.housesDestroyed)] : null,
      ["Source location", `${t.latitude.toFixed(3)}, ${t.longitude.toFixed(3)}`],
    ])}
    <div class="card-actions">
      ${extLink(`${NCEI_VIEW}/tsunami/event-more-info/${t.id}`, "NCEI event record", true)}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly to source</button>
      ${t.earthquakeEventId ? extLink(`${NCEI_VIEW}/earthquake/event-more-info/${t.earthquakeEventId}`, "Source earthquake") : ""}
    </div>
    <p class="note">Source: NOAA NCEI/WDS Global Historical Tsunami Database (<a href="https://doi.org/10.7289/V5PN93H7" target="_blank" rel="noopener">doi:10.7289/V5PN93H7</a>) · ${retrieved(T?.fetched)} · public domain. Figures are shown only where NCEI records them; “Few/Many” are NCEI's coded estimates.</p>`,
  (body) => { body.querySelector('[data-act="fly"]').onclick = () => flyTo(t.longitude, t.latitude, 6, 0); });
  setFocus([t.longitude, t.latitude]);
}

function quakeCard(q, Q) {
  if (!q) return;
  const pl = nceiPlace(q);
  const scale = magScale(q);
  const others = [["eqMagMw", "Mw"], ["eqMagMs", "Ms"], ["eqMagMb", "mb"], ["eqMagMl", "ML"]].filter(([k]) => q[k] != null && q[k] !== q.eqMagnitude).map(([k, l]) => `${l} ${fmt(q[k], 1)}`);
  const dOrd = q.deathsAmountOrderTotal ?? q.deathsAmountOrder ?? -1;
  card(`${cardHead({ badge: q.eqMagnitude != null ? `<b>${fmt(q.eqMagnitude, 1)}</b><small>${esc(scale)}</small>` : `${ic("quake", 22)}<small>Quake</small>`, color: DEATH_C[dOrd] ?? DEATH_C[-1], eyebrow: "Significant earthquake · NCEI", title: pl.place, sub: [pl.country, eventDate(q)].filter(Boolean).join(" · ") })}
    ${kv([
      ["Magnitude", q.eqMagnitude != null ? `${fmt(q.eqMagnitude, 1)} ${scale}${others.length ? ` (also ${others.join(", ")})` : ""}` : "Not recorded"],
      ["Depth", q.eqDepth != null ? `${fmt(q.eqDepth)} km` : "Not recorded"],
      q.intensity != null ? ["Max intensity", `MMI ${roman(q.intensity)}`] : null,
      ["Deaths · earthquake", effect(q.deaths, q.deathsAmountOrder) ?? "Not recorded"],
      (q.deathsTotal != null || q.deathsAmountOrderTotal != null) && (q.deathsTotal !== q.deaths || q.deathsAmountOrderTotal !== q.deathsAmountOrder) ? ["Deaths · incl. secondary effects", effect(q.deathsTotal, q.deathsAmountOrderTotal)] : null,
      q.injuries != null ? ["Injuries", fmt(q.injuries)] : null,
      ["Damage", money(q.damageMillionsDollars) ?? (q.damageAmountOrder != null ? `${DAMAGE[q.damageAmountOrder]} (NCEI estimate)` : "Not recorded")],
      q.housesDestroyed != null ? ["Houses destroyed", fmt(q.housesDestroyed)] : null,
      ["Epicentre", `${q.latitude.toFixed(3)}, ${q.longitude.toFixed(3)}`],
    ])}
    <div class="card-actions">
      ${extLink(`${NCEI_VIEW}/earthquake/event-more-info/${q.id}`, "NCEI event record", true)}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly to epicentre</button>
      ${q.tsunamiEventId ? extLink(`${NCEI_VIEW}/tsunami/event-more-info/${q.tsunamiEventId}`, "Tsunami record") : ""}
    </div>
    <p class="note">Source: NOAA NCEI/WDS Global Significant Earthquake Database (<a href="https://doi.org/10.7289/V5TD9V7K" target="_blank" rel="noopener">doi:10.7289/V5TD9V7K</a>) · ${retrieved(Q?.fetched)} · public domain. Times are UTC. Figures appear only where NCEI records them.</p>`,
  (body) => { body.querySelector('[data-act="fly"]').onclick = () => flyTo(q.longitude, q.latitude, 7, 40); });
  setFocus([q.longitude, q.latitude]);
}

/* ================================================================ soils */
function defineSoils() {
  const SOILS = [
    ["phh2o", "Soil pH", "How acidic or alkaline the topsoil is (pH measured in water)", ["ph", "acidity", "alkaline", "acid soil", "lime"]],
    ["soc", "Soil organic carbon", "Organic carbon in the topsoil, in grams per kilogram — highest in peat, forests and cold wet soils", ["carbon", "organic carbon", "soc", "humus", "peat", "carbon stock"]],
    ["clay", "Clay content", "Share of clay particles (under 0.002 mm) in the topsoil's fine earth", ["clay", "texture", "fine"]],
    ["sand", "Sand content", "Share of sand particles (0.05–2 mm) in the topsoil's fine earth", ["sand", "sandy", "texture", "coarse"]],
  ];
  for (const [p, title, what, words] of SOILS) {
    app.layers.define(rasterLayer({
      id: `ed-soil-${p === "phh2o" ? "ph" : p}`,
      title: `${title} · SoilGrids`,
      sub: "ISRIC · 250 m · topsoil 0–5 cm",
      category: "Soils",
      description: `${what}. Modelled at 250 m worldwide by ISRIC's SoilGrids 2.0 from soil profile observations and environmental covariates, so values are estimates, not measurements. Use “Read soil at a point” for a full profile to 30 cm.`,
      keywords: ["soil", "soils", "soilgrids", "isric", "topsoil", "agriculture", "farming", ...words],
      source: "ISRIC SoilGrids 2.0 (Poggio et al. 2021)",
      attribution: "Soil: ISRIC SoilGrids 2.0 (CC BY 4.0)",
      license: LIC.ccby,
      detail: "250 m prediction, mean, 0–5 cm depth",
      opacity: 0.8, maxzoom: 11, resampling: "nearest",
      legend: soilLegend(p),
      tiles: () => `edtile://soil/{z}/{x}/{y}?bbox={bbox-epsg-3857}&p=${p}`,
    }));
  }
}

/* ================================================================ forests */
function defineForests() {
  const FIRST = 2001, LAST = 2025;
  const yearOf = (iso) => Math.min(LAST, Math.max(FIRST, Number(String(iso ?? LAST).slice(0, 4)) || LAST));
  app.layers.define(rasterLayer({
    id: "ed-forest-loss",
    title: "Tree cover loss · Hansen / UMD",
    sub: "Global Forest Watch · 30 m · 2001–2025",
    category: "Forests & land change",
    description: "Where trees taller than 5 m were cleared or destroyed (stand-replacing disturbance) since 2001, mapped at 30 m from Landsat by the University of Maryland's GLAD lab (Hansen et al. 2013, version 1.13), counted only where canopy cover was at least 30% in 2000. Loss includes logging, clearing for farms, fire, storms and disease. The date control sets the last year shown: loss from 2001 up to that year.",
    keywords: ["forest", "forests", "deforestation", "tree cover loss", "logging", "hansen", "glad", "global forest watch", "gfw", "amazon", "rainforest", "clearing"],
    source: "Hansen et al. (2013) / UMD GLAD, v1.13, via Global Forest Watch",
    attribution: "Tree cover loss: Hansen/UMD/Google/USGS/NASA, via Global Forest Watch (CC BY 4.0)",
    license: LIC.ccby,
    detail: "30 m Landsat analysis; canopy cover ≥30% in 2000; one year per step",
    opacity: 0.9, maxzoom: 12,
    time: { min: `${FIRST}-01-01`, max: `${LAST}-01-01`, default: `${LAST}-01-01`, step: "year" },
    legend: legendWrap(`${keyRow([["#e46298", "Tree cover lost between 2001 and the selected year", ""]])}
      ${note("Loss is shown where tree canopy covered at least 30% of a 30 m pixel in 2000. Brighter pink marks denser loss at low zoom.")}`),
    tiles: (iso) => `edtile://gfw/{z}/{x}/{y}?from=${FIRST}&to=${yearOf(iso)}`,
  }));
}

/* ================================================================ ice */
function defineGlaciers() {
  const vt = "edtile://glimsvt/{z}/{x}/{y}?bbox={bbox-epsg-3857}";
  defineLayer({
    id: "ed-glaciers",
    title: "Glaciers · RGI 7.0",
    sub: "GLIMS / NSIDC · global glacier outlines",
    category: "Ice",
    description: "Outlines of the world's glaciers outside the two ice sheets, from the Randolph Glacier Inventory 7.0 served by GLIMS at NSIDC. The inventory targets the year 2000, so today's glaciers are often smaller. From zoom 9 the outlines become clickable, with each glacier's area, elevation range, length and outline date.",
    keywords: ["glacier", "glaciers", "ice", "rgi", "randolph", "glims", "nsidc", "ice cap", "alps", "himalaya", "cryosphere", "melting"],
    source: "RGI 7.0 Consortium (2023), via the GLIMS map service (NSIDC)",
    attribution: "Glaciers: RGI 7.0 Consortium (2023), GLIMS/NSIDC (CC BY 4.0)",
    license: LIC.ccby,
    detail: "Outlines target the year 2000; clickable from zoom 9",
    kind: "custom", slot: "overlay", opacity: 1,
    legend: legendWrap(`${keyRow([[GLAC.fill, "Glacier (RGI 7.0 outline)", ""]])}${note("Clickable from zoom 9. Outlines are a snapshot for about the year 2000, so many glaciers are smaller today.")}`),
    add(m) {
      const before = app.layers.anchor("overlay");
      const op = opacity.get("ed-glaciers") ?? 1;
      m.addSource("ed-glac-r", { type: "raster", tiles: ["edtile://glims/{z}/{x}/{y}?bbox={bbox-epsg-3857}"], tileSize: 256, maxzoom: 9 });
      m.addLayer({ id: "ed-glac-r", type: "raster", source: "ed-glac-r", maxzoom: 9, paint: { "raster-opacity": op, "raster-fade-duration": REDUCED ? 0 : 220 } }, before);
      m.addSource("ed-glac-v", { type: "vector", tiles: [vt], tileSize: 512, minzoom: 9, maxzoom: 13, promoteId: "rgi_id" });
      for (const r of RGI_REGIONS) {
        const sl = `RGI2000-v7.0-G-${r}_epsg3857`;
        m.addLayer({ id: `cat-i-ed-glac-${r.slice(0, 2)}`, type: "fill", source: "ed-glac-v", "source-layer": sl, minzoom: 9, paint: {
          "fill-color": GLAC.fill, "fill-opacity": ["*", op, ["case", ["boolean", ["feature-state", "hover"], false], 0.42, 0.2]] } }, before);
        m.addLayer({ id: `ed-glac-line-${r.slice(0, 2)}`, type: "line", source: "ed-glac-v", "source-layer": sl, minzoom: 9, paint: {
          "line-color": GLAC.line, "line-opacity": op, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.9, 13, 1.8] } }, before);
      }
    },
    remove(m) {
      rm(m, [...RGI_REGIONS.flatMap((r) => [`ed-glac-line-${r.slice(0, 2)}`, `cat-i-ed-glac-${r.slice(0, 2)}`]), "ed-glac-r"], ["ed-glac-v", "ed-glac-r"]);
      glacierHover(null);
    },
    setOpacity(m, v) {
      opacity.set("ed-glaciers", v);
      if (m.getLayer("ed-glac-r")) m.setPaintProperty("ed-glac-r", "raster-opacity", v);
      for (const r of RGI_REGIONS) {
        const id = `cat-i-ed-glac-${r.slice(0, 2)}`;
        if (m.getLayer(id)) m.setPaintProperty(id, "fill-opacity", ["*", v, ["case", ["boolean", ["feature-state", "hover"], false], 0.42, 0.2]]);
        if (m.getLayer(`ed-glac-line-${r.slice(0, 2)}`)) m.setPaintProperty(`ed-glac-line-${r.slice(0, 2)}`, "line-opacity", v);
      }
    },
  });
  on("cat-i-ed-glac-", {
    hover: (f) => {
      glacierHover(f);
      const p = f.properties;
      return `<b>${esc(p.glac_name ? titleCase(p.glac_name) : "Unnamed glacier")}</b><span>${fmt(p.area_km2, p.area_km2 < 10 ? 2 : 1)} km² · ${esc(p.rgi_id)}</span>`;
    },
    click: (f) => glacierCard(f.properties),
    leave: () => glacierHover(null),
  });
}
let hoverGlacier = null;
function glacierHover(f) {
  const m = app.map;
  const next = f && f.id != null ? { source: "ed-glac-v", sourceLayer: f.sourceLayer, id: f.id } : null;
  if (hoverGlacier && next && hoverGlacier.id === next.id && hoverGlacier.sourceLayer === next.sourceLayer) return;
  if (hoverGlacier && m.getSource("ed-glac-v")) m.setFeatureState(hoverGlacier, { hover: false });
  hoverGlacier = next;
  if (hoverGlacier) m.setFeatureState(hoverGlacier, { hover: true });
}
function glacierCard(p) {
  const name = p.glac_name ? titleCase(p.glac_name) : "Unnamed glacier";
  const date = p.src_date ? String(p.src_date).slice(0, 10) : null;
  card(`${cardHead({ badge: `<b>${fmt(p.area_km2, p.area_km2 < 10 ? 1 : 0)}</b><small>km²</small>`, color: GLAC.fill, eyebrow: "Glacier · RGI 7.0", title: name, sub: `${p.rgi_id}${num(p.cenlat) != null ? ` · ${(+p.cenlat).toFixed(3)}, ${(+p.cenlon).toFixed(3)}` : ""}` })}
    ${kv([
      ["Area", `${fmt(p.area_km2, 2)} km²`],
      num(p.zmin_m) != null ? ["Elevation", `${fmt(p.zmin_m)}–${fmt(p.zmax_m)} m (median ${fmt(p.zmed_m)} m)`] : null,
      num(p.lmax_m) ? ["Length", `${fmt(p.lmax_m / 1000, 1)} km (longest centreline)`] : null,
      num(p.slope_deg) != null ? ["Mean slope", `${fmt(p.slope_deg, 1)}°`] : null,
      RGI_ASPECT[p.aspect_sec] ? ["Faces", `${RGI_ASPECT[p.aspect_sec]} (${fmt(p.aspect_deg)}°)`] : null,
      RGI_TERM[p.term_type] ? ["Terminus", RGI_TERM[p.term_type]] : null,
      RGI_SURGE[p.surge_type] ? ["Surging", RGI_SURGE[p.surge_type]] : null,
      ["Outline dated", date ?? "Not recorded"],
      p.glims_id ? ["GLIMS id", p.glims_id] : null,
    ])}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly in 3D</button>
      ${extLink("https://doi.org/10.5067/F6JMOVY5NAVZ", "RGI 7.0 dataset")}
    </div>
    <p class="note">Source: RGI 7.0 Consortium (2023), Randolph Glacier Inventory v7.0, via the GLIMS map service at NSIDC · CC BY 4.0. The inventory targets the year 2000${date ? `; this outline is dated ${esc(date)}` : ""}. Elevations from the ${esc(p.dem_source ?? "RGI")} DEM.</p>`,
  (body) => {
    const lng = num(p.cenlon), lat = num(p.cenlat);
    body.querySelector('[data-act="fly"]').onclick = () => { if (lng != null) app.map.flyTo({ center: [lng, lat], zoom: 12.5, pitch: 64, bearing: app.map.getBearing() + 25, speed: 1.2 }); };
  });
}

/* ================================================================ minerals (USGS MRDS) */
const MR = { feats: new Map(), areas: [], busy: false, pending: false };
async function mrdsQuery(b, max = 1500) {
  const url = `https://mrdata.usgs.gov/services/wfs/mrds?service=WFS&version=1.0.0&request=GetFeature&typename=mrds&maxfeatures=${max}&bbox=${b.map((v) => v.toFixed(4)).join(",")}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`mrdata.usgs.gov answered ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw err.name === "AbortError" ? new Error("mrdata.usgs.gov timed out") : err;
  } finally { clearTimeout(t); }
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("ServiceException").length || xml.getElementsByTagName("parsererror").length) throw new Error("the MRDS service returned an error");
  const out = [];
  for (const el of xml.getElementsByTagNameNS(MRDS_NS, "mrds")) {
    const get = (n) => el.getElementsByTagNameNS(MRDS_NS, n)[0]?.textContent?.trim() ?? "";
    // The record's first gml:coordinates is its bounding box ("x,y x,y"); the location is the gml:Point.
    const pt = el.getElementsByTagNameNS(GML_NS, "Point")[0] ?? el;
    const c = pt.getElementsByTagNameNS(GML_NS, "coordinates")[0]?.textContent?.trim().split(/\s+/)[0].split(",").map(Number);
    if (!c || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    out.push({ id: get("dep_id"), name: get("site_name") || "Unnamed site", status: get("dev_stat") || "Unknown", url: get("url"), codes: get("code_list").split(/\s+/).filter(Boolean), lng: c[0], lat: c[1] });
  }
  return { items: out, capped: out.length >= max, fetched: new Date() };
}
/** Splits a box that crosses the antimeridian (east > 180 or west < -180) into two WFS queries. */
async function mrdsQueryBox([w, s, e, n], max) {
  const parts = e > 180 ? [[w, s, 180, n], [-180, s, e - 360, n]] : w < -180 ? [[w + 360, s, 180, n], [-180, s, e, n]] : [[w, s, e, n]];
  const rs = await Promise.all(parts.map((b) => mrdsQuery(b.map((v, i) => (i % 2 ? Math.max(-90, Math.min(90, v)) : Math.max(-180, Math.min(180, v)))), max)));
  return { items: rs.flatMap((r) => r.items), capped: rs.some((r) => r.capped), fetched: rs[0].fetched };
}
const mrdsFC = () => ({ type: "FeatureCollection", features: [...MR.feats.values()].map((d) => ({ type: "Feature", geometry: { type: "Point", coordinates: [d.lng, d.lat] }, properties: { id: d.id, s: d.status } })) });
const covers = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
function addMrds(items) {
  for (const it of items) MR.feats.set(it.id, it);
  if (MR.feats.size > 40000) { const keep = [...MR.feats.entries()].slice(-30000); MR.feats = new Map(keep); MR.areas = []; }
  app.map.getSource("ed-mrds")?.setData(mrdsFC());
}
async function mrdsView() {
  const m = app.map;
  if (!app.layers.isOn("ed-mrds")) return;
  if (m.getZoom() < 7) { setStatus("mrds", "USGS MRDS: zoom in (to zoom 7) to load mineral deposits here."); return; }
  const b = m.getBounds();
  const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  if (e - w > 60 || e < w) { setStatus("mrds", null); return; }
  const pw = (e - w) * 0.15, ph = (n - s) * 0.15;
  const view = [w - pw, Math.max(-85, s - ph), e + pw, Math.min(85, n + ph)];
  if (MR.areas.some((a) => a.complete && covers(a.bbox, [w, s, e, n]))) { setStatus("mrds", null); return; }
  if (MR.busy) { MR.pending = true; return; }
  MR.busy = true;
  setStatus("mrds", "USGS MRDS: loading deposits in view… this service can take 30–40 seconds.", { busy: true });
  try {
    const r = await mrdsQueryBox(view, 1500);
    MR.areas.push({ bbox: view, complete: !r.capped });
    addMrds(r.items);
    setStatus("mrds", r.capped ? `USGS MRDS: showing the first ${fmt(r.items.length)} records the service returned here — zoom in for complete coverage.` : `USGS MRDS: ${fmt(r.items.length)} deposit record${r.items.length === 1 ? "" : "s"} in this area.`, { ms: 7000 });
  } catch (err) {
    setStatus("mrds", `USGS MRDS did not answer — ${why(err)}. Move the map to try again.`, { tone: "warn", ms: 10000 });
  } finally {
    MR.busy = false;
    if (MR.pending) { MR.pending = false; mrdsView(); }
  }
}
let mrdsTimer = 0;
const mrdsMoved = () => { clearTimeout(mrdsTimer); mrdsTimer = setTimeout(mrdsView, 450); };
function defineMinerals() {
  defineLayer({
    id: "ed-mrds",
    title: "Mineral deposits · USGS MRDS",
    sub: "Historical, US-focused, not maintained since 2011",
    category: "Minerals",
    description: "USGS Mineral Resources Data System (historical, US-focused, not maintained since 2011): mines, prospects and mineral occurrences with their commodities and development status. Deposits load for the area in view from zoom 7; the USGS service can take 30–40 seconds to answer. Click a deposit for its commodities and MRDS record.",
    keywords: ["mineral", "minerals", "mineral deposits", "deposits", "mines", "prospects", "occurrences", "mrds", "usgs", "gold", "copper", "silver", "mining history"],
    source: "USGS Mineral Resources Data System (MRDS) web feature service",
    attribution: "Mineral deposits: USGS MRDS",
    license: LIC.usgov,
    detail: "Loads from zoom 7 for the view, up to 1,500 records per request",
    coverage: "Mostly the United States; sparse elsewhere",
    minZoomHint: 7,
    kind: "geojson", slot: "data",
    legend: legendWrap(`${keyRow(MRDS_STATUS.map(([s, c]) => [c, s, "dot"]))}${note("Development status as recorded in MRDS. Historical, US-focused, not maintained since 2011.")}`),
    add(m) {
      const before = app.layers.anchor("data");
      m.addSource("ed-mrds", { type: "geojson", data: mrdsFC() });
      m.addLayer({ id: "ed-mrds-dot", type: "circle", source: "ed-mrds", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 10, 4.6, 14, 7],
        "circle-color": ["match", ["get", "s"], ...MRDS_STATUS.flatMap(([s, c]) => [s, c]), "#9a9a9a"],
        "circle-stroke-color": "rgba(10,10,12,0.8)", "circle-stroke-width": 0.9 },
      layout: { "circle-sort-key": ["match", ["get", "s"], "Producer", 5, "Past Producer", 4, "Plant", 3, "Prospect", 2, 1] } }, before);
      m.addLayer(hitCircle("cat-i-ed-mrds", "ed-mrds", 8), before);
      m.on("moveend", mrdsMoved);
      loadMrdsCodes().catch(() => {});
      mrdsView();
    },
    remove(m) {
      m.off("moveend", mrdsMoved);
      clearTimeout(mrdsTimer);
      rm(m, ["cat-i-ed-mrds", "ed-mrds-dot"], ["ed-mrds"]);
      setStatus("mrds", null);
      clearResults("mrds");
    },
  });
  on("cat-i-ed-mrds", {
    hover: (f) => { const d = MR.feats.get(f.properties.id); return d ? `<b>${esc(d.name)}</b><span>${esc(d.status)} · ${esc(commodityNames(d.codes).slice(0, 4).join(", ") || "commodities not recorded")}</span>` : ""; },
    click: (f) => { const d = MR.feats.get(f.properties.id); if (d) mrdsCard(d); },
  });
}
function commodityNames(codes) {
  const C = cache.mrdsCodesSync?.codes ?? {};
  return codes.map((c) => (C[c] ? C[c][0].toUpperCase() + C[c].slice(1) : c)); // two names are lower-case in the USGS list
}
// The badge names the main commodity in a word or two ("Stone, Crushed/Broken" → Stone, "Barium-Barite" →
// Barium, "Petroleum (Oil), Oil Shale" → Petroleum); PGE and REE keep their usual abbreviations.
// The chips and the table below give every name in full.
const BADGE_WORD = { PGE: "PGE", REE: "REE", CO2: "CO₂", MPG: "Pigments", SDG: "Sand & gravel", VOL: "Volcanic" };
function commodityBadge(code) {
  const n = BADGE_WORD[code] ?? cache.mrdsCodesSync?.codes?.[code];
  return n ? n.split(",")[0].replace(/\s*\(.*?\)/, "").split("-")[0] : "Deposit";
}
async function mrdsCard(d) {
  await loadMrdsCodes().catch(() => null);
  const names = commodityNames(d.codes);
  const color = MRDS_STATUS.find(([s]) => s === d.status)?.[1] ?? "#9a9a9a";
  card(`${cardHead({ badge: `${ic("gem", 22)}<small>${esc(commodityBadge(d.codes[0]))}</small>`, color, eyebrow: `Mineral deposit · ${d.status}`, title: d.name, sub: `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}` })}
    ${names.length ? `<div class="ed-chips">${names.slice(0, 14).map((n) => `<span class="chip chip-soft">${esc(n)}</span>`).join("")}</div>` : ""}
    ${kv([
      ["Development status", d.status],
      ["Commodities", names.length ? names.join(", ") : "Not recorded"],
      ["MRDS deposit id", d.id],
    ])}
    <div class="card-actions">
      ${d.url ? extLink(d.url, "MRDS record", true) : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly in 3D</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="here">What's here</button>
    </div>
    <p class="note">Source: USGS Mineral Resources Data System — historical, US-focused, not maintained since 2011; locations and status vary in accuracy. Public domain.</p>`,
  (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [d.lng, d.lat], zoom: 14, pitch: 62, speed: 1.2 });
    body.querySelector('[data-act="here"]').onclick = () => app.tools.run("get_place_info", { lat: d.lat, lng: d.lng }).catch(() => {});
  });
  setFocus([d.lng, d.lat]);
}

/* ================================================================ point readings */
const SOIL_LIMIT = { calls: [], cache: new Map() };
async function soilAt(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (SOIL_LIMIT.cache.has(key)) return SOIL_LIMIT.cache.get(key);
  const now = Date.now();
  SOIL_LIMIT.calls = SOIL_LIMIT.calls.filter((t) => now - t < 60000);
  if (SOIL_LIMIT.calls.length >= 5) {
    const waitS = Math.ceil((60000 - (now - SOIL_LIMIT.calls[0])) / 1000);
    throw new Error(`SoilGrids allows 5 point queries a minute; try again in ${waitS} s.`);
  }
  SOIL_LIMIT.calls.push(now);
  const props = ["phh2o", "soc", "clay", "sand", "silt", "nitrogen", "bdod", "cec"];
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng.toFixed(4)}&lat=${lat.toFixed(4)}&${props.map((p) => `property=${p}`).join("&")}&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`;
  const d = await getJSON(url, { timeout: 60000 });
  const depths = ["0-5cm", "5-15cm", "15-30cm"];
  const layers = (d.properties?.layers ?? []).map((L) => {
    const f = L.unit_measure?.d_factor || 1;
    // The API double-encodes "³" (arrives as "Â³"); unitless pH arrives as "-".
    const unit = String(L.unit_measure?.target_units ?? "").replace(/Â/g, "").replace(/^-$/, "");
    const vals = depths.map((lab) => { const v = L.depths?.find((x) => x.label === lab)?.values?.mean; return v == null ? null : +(v / f).toFixed(f >= 100 ? 2 : 1); });
    return { name: L.name, label: SOIL_NAMES[L.name] ?? L.name, unit, values: Object.fromEntries(depths.map((lab, i) => [lab, vals[i]])) };
  }).sort((a, b) => props.indexOf(a.name) - props.indexOf(b.name));
  const out = { lat: +lat.toFixed(4), lng: +lng.toFixed(4), layers, empty: layers.every((l) => Object.values(l.values).every((v) => v == null)), queried: new Date().toISOString() };
  SOIL_LIMIT.cache.set(key, out);
  return out;
}
function soilCard(r, name) {
  const depths = ["0-5cm", "5-15cm", "15-30cm"];
  const ph = r.layers.find((l) => l.name === "phh2o")?.values["0-5cm"];
  card(`${cardHead({ badge: ph != null ? `<b>${ph.toFixed(1)}</b><small>pH</small>` : `${ic("soil", 22)}<small>Soil</small>`, color: "#b98a5e", eyebrow: "Soil · SoilGrids 2.0 · modelled", title: name ?? "Soil at this point", sub: `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` })}
    ${r.empty ? `<p class="ed-flag">SoilGrids has no prediction here — water, ice, bare rock or built-up land are left out of the model.</p>` : `
    <table class="ed-table"><thead><tr><th scope="col">Depth, cm</th>${depths.map((d) => `<th scope="col">${d.replace("cm", "").replace("-", "–")}</th>`).join("")}</tr></thead>
    <tbody>${r.layers.map((l) => `<tr><th scope="row">${esc(l.label)}${l.unit ? `<span class="u">${esc(l.unit)}</span>` : ""}</th>${depths.map((d) => `<td>${l.values[d] == null ? "—" : l.values[d].toFixed(SOIL_DP[l.name] ?? 1)}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
    <div class="card-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="here">What's here</button>
      ${extLink(`https://soilgrids.org/`, "SoilGrids")}
    </div>
    <p class="note">Modelled estimates from ISRIC SoilGrids 2.0 (250 m, mean of the prediction), not field measurements · CC BY 4.0 · queried ${esc(r.queried.slice(0, 16).replace("T", " "))} UTC.</p>`,
  (body) => { body.querySelector('[data-act="here"]').onclick = () => app.tools.run("get_place_info", { lat: r.lat, lng: r.lng }).catch(() => {}); });
  setFocus([r.lng, r.lat]);
  reveal(r.lng, r.lat);
}

async function magneticAt(lat, lng) {
  const g = encodeURIComponent(JSON.stringify({ x: lng, y: lat }));
  const d = await getJSON(`https://gis.ngdc.noaa.gov/arcgis/rest/services/EMAG2v3/ImageServer/identify?geometry=${g}&geometryType=esriGeometryPoint&sr=4326&returnGeometry=false&returnCatalogItems=false&f=json`, { timeout: 20000 });
  const v = num(d.value);
  return { lat: +lat.toFixed(4), lng: +lng.toFixed(4), anomaly_nT: v == null ? null : +v.toFixed(1) };
}
function magneticCard(r) {
  card(`${cardHead({ badge: r.anomaly_nT != null ? `<b>${signed(r.anomaly_nT, 0, true)}</b><small>nT</small>` : `${ic("magnet", 22)}<small>nT</small>`, color: r.anomaly_nT == null ? "#999" : r.anomaly_nT >= 0 ? "#d52870" : "#313d98", eyebrow: "Magnetic anomaly · EMAG2v3", title: r.anomaly_nT == null ? "No data here" : `${signed(r.anomaly_nT, 1, true)} nT`, sub: `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` })}
    <p class="ed-lead">${r.anomaly_nT == null ? "The EMAG2v3 grid has no value at this point." : "The crustal magnetic anomaly at this point from the EMAG2v3 grid: how much the measured field differs from the main (core) field. Anomalies come from magnetised rocks in the crust; the stripes along ocean ridges record past reversals of the field."}</p>
    <p class="note">Source: NOAA NCEI EMAG2v3, 2 arc-minute grid · public domain.</p>`);
  setFocus([r.lng, r.lat]);
  reveal(r.lng, r.lat);
}

// Lower 48, Alaska, Hawaii, Puerto Rico + US Virgin Islands, Guam + Northern Marianas, American Samoa.
const US_BOXES = [[-125, 24.4, -66.8, 49.4], [-170, 51.2, -129.9, 71.5], [-160.4, 18.8, -154.7, 22.4], [-67.4, 17.6, -64.5, 18.6], [144.5, 13.2, 146.1, 20.6], [-171.2, -14.6, -168.1, -11]];
const inUS = (lat, lng) => US_BOXES.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n);
/** EPQS reports geographic DEM cells in degrees (1/3 arc-second = 0.0000926) and projected ones in metres. */
function epqsResolution(res) {
  const r = num(res);
  if (r == null || r <= 0) return { m: null, text: null };
  if (r >= 0.01) return { m: +r.toFixed(2), text: `${fmt(r, r < 1 ? 2 : 0)} m` };
  const arcsec = r * 3600, m = Math.round(r * 111320);
  const frac = [[1 / 9, "1/9"], [1 / 3, "1/3"], [1, "1"], [2, "2"]].find(([v]) => Math.abs(arcsec - v) / v < 0.02)?.[1];
  return { m, text: `${frac ?? fmt(arcsec, 2)} arc-second (≈${fmt(m)} m)` };
}
/** EPQS dates are M/D/YYYY with 0 for an unknown month or day ("4/0/2023", "0/5/2013"). */
function epqsDate(s) {
  const m = String(s ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s || null;
  const [mo, d, y] = [+m[1], +m[2], m[3]];
  if (mo < 1 || mo > 12) return y;
  return d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : `${MONTH[mo - 1]} ${y}`;
}
async function preciseElevation(lat, lng) {
  const global = await elevationAt(lng, lat, 14).catch(() => null);
  const globalRow = global != null && Number.isFinite(global) ? { elevation_m: +global.toFixed(1), source: ELEVATION_SOURCE } : null;
  if (!inUS(lat, lng)) return { ok: true, available: false, lat, lng, reason: "USGS EPQS covers the United States only.", global_terrain: globalRow };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res, text;
  try {
    res = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lng.toFixed(6)}&y=${lat.toFixed(6)}&units=Meters&wkid=4326&includeDate=true`, { signal: ctrl.signal });
    text = await res.text();
  } catch (err) {
    throw err.name === "AbortError" ? new Error("epqs.nationalmap.gov timed out") : err;
  } finally { clearTimeout(timer); }
  let d = null;
  try { d = JSON.parse(text); } catch { /* EPQS answers plain text outside its data */ }
  const v = num(d?.value);
  if (!res.ok || v == null || v < -10000) return { ok: true, available: false, lat, lng, reason: "USGS EPQS has no 3DEP value at this point (often water or outside coverage).", global_terrain: globalRow };
  const cell = epqsResolution(d.resolution);
  return { ok: true, available: true, lat, lng, elevation_m: +v.toFixed(2), resolution_m: cell.m, resolution: cell.text, acquisition_date: epqsDate(d.attributes?.AcquisitionDate), source: "USGS 3DEP via the Elevation Point Query Service (EPQS)", global_terrain: globalRow };
}
const aboveSea = (m) => (m < 0 ? `${fmt(-m, 1)} m below sea level` : `${fmt(m, 1)} m above sea level`);
function elevationCard(r) {
  card(`${cardHead({ badge: `${ic("mountain", 22)}<small>${r.available ? "3DEP" : "Global"}</small>`, color: r.available ? "#7fd18b" : "#bbb", eyebrow: r.available ? "Precise elevation · USGS 3DEP" : "Precise elevation · not available here", title: r.available ? `${signed(r.elevation_m, 1)} m` : r.global_terrain ? `≈ ${signed(r.global_terrain.elevation_m)} m` : "No value", sub: `${(+r.lat).toFixed(5)}, ${(+r.lng).toFixed(5)}` })}
    ${kv([
      r.available && r.elevation_m < 0 ? ["Sea level", aboveSea(r.elevation_m)] : null,
      r.available ? ["DEM resolution", r.resolution ?? "Not reported"] : ["USGS EPQS", r.reason],
      r.available && r.acquisition_date ? ["Source data acquired", r.acquisition_date] : null,
      r.global_terrain ? ["Global terrain tiles", `${signed(r.global_terrain.elevation_m, 1)} m`] : null,
    ])}
    <p class="note">${r.available ? "USGS 3D Elevation Program via EPQS · public domain. " : ""}Global value: ${esc(ELEVATION_SOURCE)} (about 30 m outside the US).</p>`);
  setFocus([r.lng, r.lat]);
  reveal(r.lng, r.lat);
}

async function glacierAt(lat, lng) {
  const R = 6378137, x = (lng * Math.PI * R) / 180, y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const bbox = [x - 256, y - 256, x + 256, y + 256].map((v) => v.toFixed(2)).join(",");
  const d = await getJSON(`https://www.glims.org/geoserver/ows?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=GLIMS:RGI70&QUERY_LAYERS=GLIMS:RGI70&STYLES=&SRS=EPSG:3857&BBOX=${bbox}&WIDTH=256&HEIGHT=256&X=128&Y=128&INFO_FORMAT=application/json&FEATURE_COUNT=1`, { timeout: 25000 });
  return d.features?.[0]?.properties ?? null;
}

/* Probe mode: the next map click reads a raster value instead of opening a place card. */
let probeKind = null;
const pressProbeButtons = () => document.querySelectorAll("[data-ed-probe]").forEach((b) => {
  const on = String(b.dataset.edProbe === probeKind);
  if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
});
let probeWatch = null;
const syncProbeButtons = () => {
  // The Layers panel re-renders its legends from static HTML: the body attribute keeps the
  // armed look and, while armed, an observer keeps aria-pressed true on the fresh button.
  if (probeKind) document.body.dataset.edProbing = probeKind; else delete document.body.dataset.edProbing;
  pressProbeButtons();
  if (probeKind && !probeWatch) (probeWatch = new MutationObserver(pressProbeButtons)).observe($("#dock-body") ?? document.body, { childList: true, subtree: true });
  else if (!probeKind && probeWatch) { probeWatch.disconnect(); probeWatch = null; }
};
function startProbe(kind) {
  if (probeKind === kind && app.mode === "ed-probe") return stopProbe();
  if (kind === "soil") {
    const anyOn = ["ed-soil-ph", "ed-soil-soc", "ed-soil-clay", "ed-soil-sand"].some((id) => app.layers.isOn(id));
    if (!anyOn) app.layers.toggle("ed-soil-ph", true).catch(() => {});
  }
  app.emit("mode:claim", "ed-probe");
  probeKind = kind;
  app.mode = "ed-probe";
  document.body.classList.add("ed-probing");
  if (innerWidth <= 720) app.ui.closePanel();
  const verb = matchMedia("(pointer: coarse)").matches ? "Tap" : "Click";
  setStatus("probe", kind === "soil" ? `${verb} the map to read the soil there.` : `${verb} the map to read the magnetic anomaly there.`);
  syncProbeButtons();
}
function stopProbe() {
  if (app.mode === "ed-probe") app.mode = null;
  probeKind = null;
  document.body.classList.remove("ed-probing");
  setStatus("probe", null);
  syncProbeButtons();
}
function runProbe(ll) {
  const kind = probeKind;
  // Keep the mode until every click listener has run, or place.js would open its card over ours.
  setTimeout(stopProbe, 0);
  const at = { lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5) };
  const tool = kind === "soil" ? "get_soil_properties" : kind === "magnetic" ? "get_magnetic_anomaly" : null;
  if (!tool) return;
  // The tools answer failures as { ok: false }; a click needs to say so on screen.
  const fail = (msg) => setStatus(`probe-${kind}`, msg, { tone: "warn", ms: 9000 });
  app.tools.run(tool, at).then((r) => { if (r?.ok === false) fail(r.error); }, (err) => fail(err.message));
}

/* ================================================================ place resolution */
const COUNTRY_ALIAS = {
  usa: ["usa", "united states"], us: ["usa", "united states"], america: ["usa", "united states"], "united states": ["usa", "united states"], "united states of america": ["usa", "united states"],
  uk: ["uk", "united kingdom"], britain: ["uk", "united kingdom"], "great britain": ["uk", "united kingdom"], "united kingdom": ["uk", "united kingdom"],
  russia: ["russia"], "south korea": ["south korea", "korea"], "north korea": ["north korea", "korea"], png: ["papua new guinea"],
};
/** "Indonesia" → a country filter when the dataset uses that name; anything else is geocoded. */
async function resolveWhere(where, countries, defaultKm) {
  const w = String(where ?? "").trim().replace(/^the\s+/i, "").toLowerCase();
  if (!w) return null;
  const cands = COUNTRY_ALIAS[w] ?? [w];
  for (const c of cands) if (countries.has(c)) return { country: c, label: titleCase(where) };
  const hit = (await app.tools.get("search_places")?.run({ query: where, limit: 1 }).catch(() => null))?.results?.[0];
  if (!hit) return { error: `Could not find “${where}”.` };
  if (hit.bbox) {
    const [w0, s0, e0, n0] = hit.bbox;
    if (e0 - w0 >= 180) {
      // Geocoders give regions that straddle the antimeridian (Alaska, the Aleutians) a full-width box;
      // its latitude band plus the region's country still pins them down.
      const hc = String(hit.country ?? "").toLowerCase();
      const c = (COUNTRY_ALIAS[hc] ?? [hc]).find((x) => countries.has(x));
      if (c) return { band: [s0 - 1.5, n0 + 1.5], bandCountry: c, label: hit.name, center: [hit.lng, hit.lat] };
      return { near: { lat: hit.lat, lng: hit.lng, radius_km: defaultKm * 2 }, label: hit.name };
    }
    const diag = haversineKm([w0, s0], [e0, n0]);
    if (diag > defaultKm * 1.2) return { bbox: [w0 - 1.5, s0 - 1.5, e0 + 1.5, n0 + 1.5], label: hit.name, center: [hit.lng, hit.lat] };
  }
  return { near: { lat: hit.lat, lng: hit.lng, radius_km: defaultKm }, label: hit.name };
}
// A box whose west edge is east of its east edge crosses the antimeridian.
const inBox = (b, lng, lat) => lat >= b[1] && lat <= b[3] && (b[0] <= b[2] ? lng >= b[0] && lng <= b[2] : lng >= b[0] || lng <= b[2]);
/** Shared filter for near / bbox / where; returns [keep(lat, lng, item), label, error, origin]. */
async function placeFilter({ near, where, bbox }, countryOf, countries, defaultKm) {
  if (near && Number.isFinite(+near.lat) && Number.isFinite(+near.lng)) {
    const r = +near.radius_km || defaultKm;
    return [(lat, lng) => haversineKm([+near.lng, +near.lat], [lng, lat]) <= r, `within ${fmt(r)} km of ${(+near.lat).toFixed(2)}, ${(+near.lng).toFixed(2)}`, null, [+near.lng, +near.lat]];
  }
  if (Array.isArray(bbox) && bbox.length === 4) return [(lat, lng) => inBox(bbox, lng, lat), "in the box given", null, null];
  if (where) {
    const r = await resolveWhere(where, countries, defaultKm);
    if (r?.error) return [null, null, r.error];
    if (r.country) return [(lat, lng, item) => countryOf(item) === r.country, `in ${r.label}`, null, null, true];
    if (r.band) return [(lat, lng, item) => lat >= r.band[0] && lat <= r.band[1] && countryOf(item) === r.bandCountry, `in or near ${r.label}`, null, r.center];
    if (r.bbox) return [(lat, lng) => inBox(r.bbox, lng, lat), `in or near ${r.label}`, null, r.center];
    return [(lat, lng) => haversineKm([r.near.lng, r.near.lat], [lng, lat]) <= r.near.radius_km, `within ${fmt(r.near.radius_km)} km of ${r.label}`, null, [r.near.lng, r.near.lat]];
  }
  return [() => true, "worldwide", null, null];
}

/* ================================================================ agent tools */
const nearSchema = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, radius_km: { type: "number" } }, required: ["lat", "lng"] };
const center = () => { const c = app.map.getCenter(); return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) }; };
const paren = (bits) => { const b = bits.filter(Boolean); return b.length ? ` (${b.join(", ")})` : ""; };
const listText = (rows) => rows.map((r) => `- ${r}`).join("\n");
/** "…and N more" after the first rows of a summary, saying what the globe shows. */
function moreText(total, listed, returned, onMap) {
  const rest = total - listed;
  if (rest <= 0) return "";
  const ringed = onMap && returned > listed ? `; ${fmt(returned)} are ringed on the globe` : "";
  return `\n- …and ${fmt(rest)} more${ringed}${returned < total ? " (raise the limit to list more)" : ""}`;
}

function defineTools() {
  app.tools.define("list_earth_datasets", {
    description: "List the solid-Earth and environmental science layers in the World Model (plate boundaries, magnetic anomalies, surveyed seafloor, Holocene volcanoes, historical tsunamis, significant historical earthquakes, SoilGrids soil maps, tree cover loss, RGI glaciers, USGS MRDS mineral deposits) with their source, licence and whether each is on, plus the tools that query them.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const layers = app.layers.list().filter((d) => d.id.startsWith("ed-")).map((d) => ({ id: d.id, title: d.title, category: d.category, on: app.layers.isOn(d.id), source: d.source, license: d.license, detail: d.detail ?? null }));
      const tools = app.tools.list().filter((t) => EARTH_TOOLS.includes(t.name)).map((t) => t.name);
      const cats = [...new Set(layers.map((l) => l.category))];
      return { ok: true, layers, tools, summary: `**Earth-science datasets** (switch any on in Layers, or ask):\n${cats.map((c) => `- **${c}:** ${layers.filter((l) => l.category === c).map((l) => `${l.title}${l.on ? " (on)" : ""}`).join("; ")}`).join("\n")}\n\nAsk for things like “volcanoes in Indonesia”, “tsunamis near Japan since 1900”, “soil here” or “mineral deposits near Butte”.` };
    },
    local: { patterns: [/^(?:list |show )?(?:earth(?: science)?|science|geology|geoscience) (?:datasets|layers|data)$/i], parse: () => ({}), examples: ["earth science datasets"] },
  });

  app.tools.define("find_volcanoes", {
    description: "Find Holocene volcanoes (NOAA NCEI Volcano Location Database, about 1,600 worldwide) by place, country, name or distance, optionally only those that erupted since a given year (eruption dates are coded in ranges such as 1964-or-later, 1900–1963). Returns name, country, type, elevation, last known eruption and coordinates; highlights them on the globe.",
    input_schema: { type: "object", properties: {
      where: { type: "string", description: "Country or place name, e.g. Indonesia, Iceland, Naples" },
      near: nearSchema, name: { type: "string" },
      erupted_since: { type: "number", description: "Keep volcanoes whose last known eruption range reaches this year or later (e.g. 1900)" },
      limit: { type: "number", description: "default 25, max 200" }, show_on_map: { type: "boolean" },
    } },
    async run({ where, near, name, erupted_since, limit = 25, show_on_map = true }) {
      let V;
      try { V = await loadVolcanoes(); } catch (err) { return { ok: false, error: err.message }; }
      const countries = new Set(V.list.map((v) => String(v.country ?? "").toLowerCase()));
      const [keep, label, error, origin, byCountry] = await placeFilter({ near, where }, (v) => String(v.country ?? "").toLowerCase(), countries, 400);
      if (error) return { ok: false, error };
      const nm = name?.toLowerCase().trim();
      const since = num(erupted_since);
      let rows = V.list.filter((v) => keep(v.latitude, v.longitude, v) && (!nm || v.name.toLowerCase().includes(nm)) && (since == null || (ERUPT[v.timeErupt]?.[3] ?? -Infinity) >= since));
      rows = rows.map((v) => ({ v, km: origin ? haversineKm(origin, [v.longitude, v.latitude]) : null }));
      rows.sort((a, b) => (a.km != null && b.km != null ? a.km - b.km : a.v.r - b.v.r || a.v.name.localeCompare(b.v.name)));
      const max = Math.min(200, Math.max(1, limit || 25));
      const out = rows.slice(0, max).map(({ v, km }) => ({ name: v.name, country: v.country, type: v.morphology || null, elevation_m: v.elevation ?? null, last_known_eruption: ERUPT[v.timeErupt]?.[1] ?? null, lat: v.latitude, lng: v.longitude, ncei_id: v.id, ncei_url: `${NCEI_VIEW}/volcano/loc-data?id=${v.id}`, ...(km != null ? { distance_km: Math.round(km) } : {}) }));
      if (show_on_map) {
        if (!app.layers.isOn("ed-volcanoes")) await app.layers.toggle("ed-volcanoes", true).catch(() => {});
        if (where || near || nm || since != null) showResults(out.map((r) => [r.lng, r.lat]), "volcanoes");
      }
      const recent = rows.filter(({ v }) => v.timeErupt === "D1").length;
      return {
        ok: true, total_matches: rows.length, returned: out.length, erupted_1964_or_later: recent, results: out,
        source: "NOAA NCEI/WDS Volcano Location Database", retrieved: V.fetched.toISOString().slice(0, 10),
        summary: rows.length ? `**${fmt(rows.length)} Holocene volcano${rows.length === 1 ? "" : "es"}** ${label}${recent ? ` — ${fmt(recent)} last erupted in 1964 or later` : ""}:\n${listText(out.slice(0, 8).map((r) => `**${r.name}**${paren([byCountry ? null : r.country, r.type?.toLowerCase(), r.last_known_eruption ? `last eruption ${r.last_known_eruption.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}` : null, r.distance_km != null ? `${fmt(r.distance_km)} km` : null])}`))}${moreText(rows.length, Math.min(8, out.length), out.length, show_on_map && Boolean(where || near || nm || since != null))}\n\nSource: NOAA NCEI Volcano Location Database.` : `No Holocene volcanoes ${label} in NOAA NCEI's database.`,
      };
    },
    local: {
      patterns: [/^(?:show |find |list |where are (?:the )?)?(?:(?:the )?(?:active|recent) )?volcano(?:es)?(?:\s+(?:in|near|around|on|of)\s+(.+))?$/i],
      parse: (m, t) => ({ ...(m[1] ? { where: m[1] } : {}), ...(/active|recent/i.test(t) ? { erupted_since: 1964 } : {}), limit: 60 }),
      examples: ["volcanoes in Indonesia", "active volcanoes in Japan"],
    },
  });

  const eventSort = (sort, heightKey) => (a, b) => {
    if (sort === "deadliest") return (b.deathsTotal ?? b.deaths ?? -1) - (a.deathsTotal ?? a.deaths ?? -1) || (b.deathsAmountOrderTotal ?? -1) - (a.deathsAmountOrderTotal ?? -1);
    if (sort === "largest") return (num(b[heightKey]) ?? -1) - (num(a[heightKey]) ?? -1);
    return dateKey(b) - dateKey(a);
  };
  const deathsOut = (e) => (e.deathsTotal ?? e.deaths ?? null);

  app.tools.define("find_tsunamis", {
    description: "Find historical tsunami source events (NOAA NCEI Global Historical Tsunami Database, about 2000 BC to today) by place or country, year range and cause; sort by most recent, largest (maximum water height) or deadliest. Returns date, place, cause, validity, maximum water height and deaths where recorded; highlights them on the globe. Probable and definite events only unless include_doubtful is true.",
    input_schema: { type: "object", properties: {
      where: { type: "string", description: "Country or place, e.g. Japan, Chile, Lisbon" }, near: nearSchema,
      min_year: { type: "number" }, max_year: { type: "number" },
      cause: { type: "string", enum: ["earthquake", "volcano", "landslide", "meteorological", "other"] },
      sort: { type: "string", enum: ["recent", "largest", "deadliest"] }, include_doubtful: { type: "boolean" },
      limit: { type: "number" }, show_on_map: { type: "boolean" },
    } },
    async run({ where, near, min_year, max_year, cause, sort = "recent", include_doubtful = false, limit = 25, show_on_map = true }) {
      let T;
      try { T = await loadTsunamis(); } catch (err) { return { ok: false, error: err.message }; }
      const countries = new Set(T.list.map((t) => String(t.country ?? "").toLowerCase()));
      const [keep, label, error] = await placeFilter({ near, where }, (t) => String(t.country ?? "").toLowerCase(), countries, 600);
      if (error) return { ok: false, error };
      const cg = cause ? { earthquake: "eq", volcano: "volc", landslide: "slide", meteorological: "met", other: "other" }[cause] : null;
      const rows = T.list.filter((t) => keep(t.latitude, t.longitude, t) && (include_doubtful || t.eventValidity >= 3) && (min_year == null || (t.year ?? -99999) >= min_year) && (max_year == null || (t.year ?? 99999) <= max_year) && (!cg || TS_GROUP(t.causeCode) === cg))
        .sort(eventSort(sort, "maxWaterHeight"));
      const max = Math.min(200, Math.max(1, limit || 25));
      const out = rows.slice(0, max).map((t) => ({ date: eventDate(t), place: nceiPlace(t).full, cause: TS_CAUSE[t.causeCode] ?? null, validity: TS_VALID[t.eventValidity] ?? null, max_water_height_m: num(t.maxWaterHeight), earthquake_magnitude: num(t.eqMagnitude), deaths: deathsOut(t), deaths_description: deathsOut(t) == null ? AMOUNT[t.deathsAmountOrderTotal ?? t.deathsAmountOrder] ?? null : null, lat: t.latitude, lng: t.longitude, ncei_url: `${NCEI_VIEW}/tsunami/event-more-info/${t.id}` }));
      if (show_on_map) {
        if (!app.layers.isOn("ed-tsunamis")) await app.layers.toggle("ed-tsunamis", true).catch(() => {});
        showResults(out.map((r) => [r.lng, r.lat]), "tsunamis");
      }
      const yrs = [min_year != null ? `since ${yearText(min_year)}` : "", max_year != null ? `up to ${yearText(max_year)}` : ""].filter(Boolean).join(" ");
      return {
        ok: true, total_matches: rows.length, returned: out.length, results: out, source: "NOAA NCEI/WDS Global Historical Tsunami Database", retrieved: T.fetched.toISOString().slice(0, 10),
        summary: rows.length ? `**${fmt(rows.length)} ${include_doubtful ? "" : "probable or definite "}tsunami${rows.length === 1 ? "" : "s"}** ${label}${yrs ? ` ${yrs}` : ""}, ${sort === "largest" ? "largest" : sort === "deadliest" ? "deadliest" : "most recent"} first:\n${listText(out.slice(0, 8).map((r) => `**${r.date.split(",")[0]}** · ${r.place}${paren([r.cause?.toLowerCase(), r.max_water_height_m != null ? `${fmt(r.max_water_height_m, 1)} m` : null, r.deaths != null ? `${fmt(r.deaths)} deaths` : r.deaths_description ? `deaths: ${r.deaths_description.toLowerCase()}` : null])}`))}${moreText(rows.length, Math.min(8, out.length), out.length, show_on_map)}\n\nSource: NOAA NCEI Global Historical Tsunami Database.` : `No matching tsunamis ${label} in NOAA NCEI's database.`,
      };
    },
    local: {
      patterns: [/^(?:show |find |list )?(?:(?:the )?(?:historic(?:al)?|past|deadliest|biggest|largest) )?tsunamis?(?:\s+(?:in|near|around|off|of)\s+(.+?))?(?:\s+since\s+(\d{3,4}))?$/i],
      parse: (m, t) => ({ ...(m[1] ? { where: m[1] } : {}), ...(m[2] ? { min_year: +m[2] } : {}), ...(/deadliest/i.test(t) ? { sort: "deadliest" } : /biggest|largest/i.test(t) ? { sort: "largest" } : {}), limit: 80 }),
      examples: ["tsunamis near Japan since 1900", "deadliest tsunamis"],
    },
  });

  app.tools.define("find_historical_earthquakes", {
    description: "Find significant earthquakes in history (NOAA NCEI Global Significant Earthquake Database, 2150 BC to today — events with notable damage, 10+ deaths, magnitude 7.5+, intensity X+ or a tsunami) by place or country, year range and minimum magnitude; sort by most recent, largest or deadliest. For earthquakes of the last days use get_earthquakes instead.",
    input_schema: { type: "object", properties: {
      where: { type: "string" }, near: nearSchema, min_year: { type: "number" }, max_year: { type: "number" }, min_magnitude: { type: "number" },
      sort: { type: "string", enum: ["recent", "largest", "deadliest"] }, limit: { type: "number" }, show_on_map: { type: "boolean" },
    } },
    async run({ where, near, min_year, max_year, min_magnitude, sort = "recent", limit = 25, show_on_map = true }) {
      let Q;
      try { Q = await loadQuakes(); } catch (err) { return { ok: false, error: err.message }; }
      const countries = new Set(Q.list.map((q) => String(q.country ?? "").toLowerCase()));
      const [keep, label, error] = await placeFilter({ near, where }, (q) => String(q.country ?? "").toLowerCase(), countries, 400);
      if (error) return { ok: false, error };
      const rows = Q.list.filter((q) => keep(q.latitude, q.longitude, q) && (min_year == null || (q.year ?? -99999) >= min_year) && (max_year == null || (q.year ?? 99999) <= max_year) && (min_magnitude == null || (num(q.eqMagnitude) ?? -1) >= min_magnitude))
        .sort(eventSort(sort, "eqMagnitude"));
      const max = Math.min(200, Math.max(1, limit || 25));
      const out = rows.slice(0, max).map((q) => ({ date: eventDate(q), place: nceiPlace(q).full, magnitude: num(q.eqMagnitude), depth_km: num(q.eqDepth), deaths: deathsOut(q), deaths_description: deathsOut(q) == null ? AMOUNT[q.deathsAmountOrderTotal ?? q.deathsAmountOrder] ?? null : null, lat: q.latitude, lng: q.longitude, ncei_url: `${NCEI_VIEW}/earthquake/event-more-info/${q.id}` }));
      if (show_on_map) {
        if (!app.layers.isOn("ed-quakes")) await app.layers.toggle("ed-quakes", true).catch(() => {});
        showResults(out.map((r) => [r.lng, r.lat]), "quakes");
      }
      return {
        ok: true, total_matches: rows.length, returned: out.length, results: out, source: "NOAA NCEI/WDS Global Significant Earthquake Database", retrieved: Q.fetched.toISOString().slice(0, 10),
        summary: rows.length ? `**${fmt(rows.length)} significant earthquake${rows.length === 1 ? "" : "s"}** ${label}${min_year != null ? ` since ${yearText(min_year)}` : ""}, ${sort === "largest" ? "largest" : sort === "deadliest" ? "deadliest" : "most recent"} first:\n${listText(out.slice(0, 8).map((r) => `**${r.date.split(",")[0]}** · ${r.place}${paren([r.magnitude != null ? `M${fmt(r.magnitude, 1)}` : null, r.deaths != null ? `${fmt(r.deaths)} deaths` : r.deaths_description ? `deaths: ${r.deaths_description.toLowerCase()}` : null])}`))}${moreText(rows.length, Math.min(8, out.length), out.length, show_on_map)}\n\nSource: NOAA NCEI Global Significant Earthquake Database.` : `No matching significant earthquakes ${label} in NOAA NCEI's database.`,
      };
    },
    local: {
      patterns: [/^(?:show |find |list )?(?:the )?(?:historic(?:al)?|significant|past|deadliest|biggest|largest|major) earthquakes?(?:\s+(?:in|near|around|of)\s+(.+?))?(?:\s+since\s+(\d{3,4}))?$/i],
      parse: (m, t) => ({ ...(m[1] ? { where: m[1] } : {}), ...(m[2] ? { min_year: +m[2] } : {}), ...(/deadliest/i.test(t) ? { sort: "deadliest" } : /biggest|largest|major/i.test(t) ? { sort: "largest" } : {}), limit: 80 }),
      examples: ["deadliest earthquakes in Turkey", "historical earthquakes near Lisbon"],
    },
  });

  app.tools.define("find_mineral_deposits", {
    description: "Query the USGS Mineral Resources Data System (MRDS: historical, US-focused, not maintained since 2011) for mines, prospects and occurrences in an area — give bbox [west,south,east,north] (at most about 3° a side), near {lat,lng,radius_km} (up to 150 km) or where (a place name) — optionally filtered by commodity (e.g. gold, copper, uranium, rare earth) and development status. The USGS service can take 30–40 s. Returns names, status, commodities, coordinates and MRDS record links; highlights them on the globe.",
    input_schema: { type: "object", properties: {
      bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 }, near: nearSchema, where: { type: "string" },
      commodity: { type: "string" }, status: { type: "string", enum: ["Producer", "Past Producer", "Prospect", "Occurrence", "Plant", "Unknown"] },
      limit: { type: "number", description: "default 50, max 300" }, show_on_map: { type: "boolean" },
    } },
    async run({ bbox, near, where, commodity, status, limit = 50, show_on_map = true }) {
      let box = null, origin = null, label = "", centre = "";
      if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)) { box = bbox.slice(); label = "in the box given"; centre = "at the centre of the box given"; }
      else if (near && Number.isFinite(+near.lat) && Number.isFinite(+near.lng)) {
        const r = Math.min(150, +near.radius_km || 40);
        const dLat = r / 111, dLng = r / (111 * Math.max(0.1, Math.cos((near.lat * Math.PI) / 180)));
        box = [+near.lng - dLng, +near.lat - dLat, +near.lng + dLng, +near.lat + dLat];
        origin = [+near.lng, +near.lat];
        label = `within ${fmt(r)} km of ${(+near.lat).toFixed(2)}, ${(+near.lng).toFixed(2)}`;
        centre = `centred on ${(+near.lat).toFixed(2)}, ${(+near.lng).toFixed(2)}`;
      } else if (where) {
        const hit = (await app.tools.get("search_places")?.run({ query: where, limit: 1 }).catch(() => null))?.results?.[0];
        if (!hit) return { ok: false, error: `Could not find “${where}”.` };
        origin = [hit.lng, hit.lat];
        // A town's small box is padded; a state- or country-sized one is trimmed below, and the label says so.
        box = hit.bbox && haversineKm([hit.bbox[0], hit.bbox[1]], [hit.bbox[2], hit.bbox[3]]) > 60 ? [...hit.bbox] : [hit.lng - 0.5, hit.lat - 0.4, hit.lng + 0.5, hit.lat + 0.4];
        label = `in and around ${hit.name}`;
        centre = `at the centre of ${hit.name}`;
      } else if (app.map.getZoom() >= 6) {
        const b = app.map.getBounds();
        box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        label = "in the current view";
        centre = "at the centre of the view";
      } else return { ok: false, error: "Give a place (where), near {lat,lng} or a bbox — MRDS queries are limited to about 300 km across. Or zoom in and ask again." };
      let note = "";
      const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      if (box[2] - box[0] > 3 || box[3] - box[1] > 3) {
        box = [cx - Math.min(1.5, (box[2] - box[0]) / 2), cy - Math.min(1.5, (box[3] - box[1]) / 2), cx + Math.min(1.5, (box[2] - box[0]) / 2), cy + Math.min(1.5, (box[3] - box[1]) / 2)];
        note = "The area was trimmed to 3° × 3° around its centre to stay within what the MRDS service can answer.";
        label = `in a 3° × 3° area ${centre}`;
      }
      origin ??= [cx, cy];
      const codesDoc = await loadMrdsCodes().catch(() => null);
      let wanted = null;
      if (commodity) {
        const C = codesDoc?.codes ?? {};
        const q = commodity.toLowerCase().trim().replace(/s$/, "");
        wanted = new Set(Object.entries(C).filter(([code, name]) => code.toLowerCase() === q || name.toLowerCase().includes(q)).map(([code]) => code));
        if (!wanted.size) return { ok: false, error: `No MRDS commodity like “${commodity}”. Examples: gold, silver, copper, lead, zinc, uranium, rare earth elements, lithium, tungsten.` };
      }
      setStatus("mrds-q", "USGS MRDS: querying deposits… this service can take 30–40 seconds.", { busy: true });
      let r;
      try { r = await mrdsQueryBox(box, 2000); } catch (err) { return { ok: false, error: `USGS MRDS did not answer — ${why(err)}.` }; } finally { setStatus("mrds-q", null); }
      const rows = r.items.filter((d) => (!wanted || d.codes.some((c) => wanted.has(c))) && (!status || d.status === status))
        .map((d) => ({ d, km: haversineKm(origin, [d.lng, d.lat]) })).sort((a, b) => a.km - b.km);
      const max = Math.min(300, Math.max(1, limit || 50));
      const names = (codes) => codes.map((c) => codesDoc?.codes?.[c] ?? c);
      const out = rows.slice(0, max).map(({ d, km }) => ({ name: d.name, status: d.status, commodities: names(d.codes), lat: d.lat, lng: d.lng, distance_km: Math.round(km * 10) / 10, dep_id: d.id, mrds_url: d.url }));
      if (show_on_map) {
        if (!app.layers.isOn("ed-mrds")) await app.layers.toggle("ed-mrds", true).catch(() => {});
        addMrds(r.items);
        MR.areas.push({ bbox: box, complete: !r.capped });
        showResults(out.map((x) => [x.lng, x.lat]), "mrds");
      }
      return {
        ok: true, records_in_area: r.items.length, service_limit_reached: r.capped, total_matches: rows.length, returned: out.length, results: out,
        source: "USGS Mineral Resources Data System (historical, US-focused, not maintained since 2011)", queried: r.fetched.toISOString(), note: note || undefined,
        summary: rows.length ? `**${fmt(rows.length)} MRDS record${rows.length === 1 ? "" : "s"}**${commodity ? ` with ${commodity}` : ""}${status ? ` (${status.toLowerCase()})` : ""} ${label}${r.capped ? " (the service's 2,000-record limit was reached; narrow the area for the rest)" : ""}:\n${listText(out.slice(0, 8).map((x) => `**${x.name}** — ${x.status.toLowerCase()}, ${x.commodities.slice(0, 4).join(", ") || "commodities not recorded"} (${fmt(x.distance_km, 1)} km)`))}${moreText(rows.length, Math.min(8, out.length), out.length, show_on_map)}\n\nSource: USGS MRDS — historical, US-focused, not maintained since 2011.${note ? ` ${note}` : ""}` : `No MRDS records${commodity ? ` with ${commodity}` : ""} ${label}.${note ? ` ${note}` : ""}`,
      };
    },
    local: {
      patterns: [/^(?:show |find |list )?(?:usgs |mrds |historic(?:al)? )?(?:mineral (?:deposits|occurrences|sites|prospects)|mrds(?: deposits| sites| records)?)(?:\s+(?:of|for|with)\s+([a-z ]+?))?(?:\s+(?:in|near|around)\s+(.+))?$/i],
      parse: (m) => ({ ...(m[1] ? { commodity: m[1] } : {}), ...(m[2] ? { where: m[2] } : {}), limit: 150 }),
      examples: ["mineral deposits near Butte", "mrds deposits of gold near Tonopah"],
    },
  });

  app.tools.define("get_soil_properties", {
    description: "Soil at a point from ISRIC SoilGrids 2.0 (modelled 250 m estimates, not measurements): pH, organic carbon, clay, sand, silt, nitrogen, bulk density and cation exchange capacity at 0–5, 5–15 and 15–30 cm, in their target units. SoilGrids allows 5 queries a minute; answers can take up to a minute. Shows a soil card.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, name: { type: "string" }, show_card: { type: "boolean" } }, required: ["lat", "lng"] },
    async run({ lat, lng, name, show_card = true }) {
      setStatus("soil", "ISRIC SoilGrids: reading the soil profile… this can take up to a minute.", { busy: true });
      let r;
      try { r = await soilAt(+lat, +lng); } catch (err) { return { ok: false, error: err.message.startsWith("SoilGrids") ? err.message : `ISRIC SoilGrids did not answer — ${why(err)}. Its point service is in beta and sometimes slow; try again shortly.` }; } finally { setStatus("soil", null); }
      if (show_card) soilCard(r, name);
      const top = Object.fromEntries(r.layers.map((l) => [l.name, l.values["0-5cm"]]));
      return {
        ok: true, lat: r.lat, lng: r.lng, modelled: true, empty: r.empty, properties: r.layers, source: "ISRIC SoilGrids 2.0 (250 m, mean prediction)", license: LIC.ccby, queried: r.queried,
        summary: r.empty ? `SoilGrids has no soil prediction at ${r.lat}, ${r.lng} (water, ice, rock or built-up land).` : `**Topsoil (0–5 cm) at ${r.lat}, ${r.lng}**, modelled by SoilGrids 2.0: pH ${fmt(top.phh2o, 1)}, organic carbon ${fmt(top.soc, 1)} g/kg, clay ${fmt(top.clay, 1)}%, sand ${fmt(top.sand, 1)}%, silt ${fmt(top.silt, 1)}%. These are 250 m model estimates, not measurements; the card has 5–30 cm too.`,
      };
    },
    local: {
      patterns: [/^(?:what'?s the |show (?:me )?the |read the )?soil(?: properties| data| profile| ph| type)?(?: here| at the cent(?:er|re))?$/i],
      parse: () => center(),
      examples: ["soil here"],
    },
  });

  app.tools.define("get_precise_elevation", {
    description: "Exact ground elevation at a point in the United States from the USGS 3D Elevation Program (EPQS, often 1 m lidar), with its resolution and acquisition date. Outside the US it reports that EPQS is unavailable and gives the global terrain-tile value (about 30 m) instead.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, show_card: { type: "boolean" } }, required: ["lat", "lng"] },
    async run({ lat, lng, show_card = true }) {
      let r;
      try { r = await preciseElevation(+lat, +lng); } catch (err) { return { ok: false, error: `USGS EPQS did not answer — ${why(err)}.` }; }
      if (show_card) elevationCard(r);
      return { ...r, summary: r.available ? `**${aboveSea(r.elevation_m)}** at ${(+lat).toFixed(5)}, ${(+lng).toFixed(5)} — USGS 3DEP${r.resolution ? ` (${r.resolution} DEM)` : ""}${r.acquisition_date ? `, source data acquired ${r.acquisition_date}` : ""}.` : `${r.reason}${r.global_terrain ? ` The global terrain tiles give about **${fmt(r.global_terrain.elevation_m)} m** here (≈30 m resolution).` : ""}` };
    },
    local: { patterns: [/^(?:exact|precise|usgs|lidar|3dep) elevation(?: here)?$/i, /^(?:how high|what'?s the (?:exact )?elevation) (?:exactly )?here$/i], parse: () => center(), examples: ["precise elevation here"] },
  });

  app.tools.define("get_magnetic_anomaly", {
    description: "Magnetic anomaly in nanotesla at a point from NOAA NCEI's EMAG2v3 global grid (2 arc-minute). Shows a card.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, show_card: { type: "boolean" } }, required: ["lat", "lng"] },
    async run({ lat, lng, show_card = true }) {
      let r;
      try { r = await magneticAt(+lat, +lng); } catch (err) { return { ok: false, error: `NOAA EMAG2v3 did not answer — ${why(err)}.` }; }
      if (show_card) magneticCard(r);
      return { ok: true, ...r, source: "NOAA NCEI EMAG2v3", license: LIC.usgov, summary: r.anomaly_nT == null ? "EMAG2v3 has no value at this point." : `Magnetic anomaly at ${r.lat}, ${r.lng}: **${r.anomaly_nT > 0 ? "+" : ""}${fmt(r.anomaly_nT, 1)} nT** (NOAA EMAG2v3).` };
    },
    local: { patterns: [/^magnetic (?:anomaly|field)(?: here)?$/i], parse: () => center(), examples: ["magnetic anomaly here"] },
  });

  app.tools.define("get_tectonic_setting", {
    description: "The nearest tectonic plate boundary to a point from Bird's PB2002 model: its class (spreading ridge, transform, subduction zone, convergent belt), the two plates and which one subducts, the distance, and the model's relative plate velocity. Switches the plate-boundary layer on and marks the nearest boundary point.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, show_on_map: { type: "boolean" } }, required: ["lat", "lng"] },
    async run({ lat, lng, show_on_map = true }) {
      const d = await loadPlates();
      const P = [+lng, +lat];
      let best = null;
      const k = Math.cos((lat * Math.PI) / 180);
      for (const f of d.boundaries.features) {
        const c = f.geometry.coordinates;
        for (let i = 1; i < c.length; i++) {
          const [ax, ay] = c[i - 1], [bx, by] = c[i];
          if (Math.abs(ax - bx) > 180) continue;
          const dx = (bx - ax) * k, dy = by - ay;
          let lx = P[0] - ax;
          if (lx > 180) lx -= 360; else if (lx < -180) lx += 360;
          const t = Math.max(0, Math.min(1, ((lx * k) * dx + (P[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
          const q = [ax + (bx - ax) * t, ay + (by - ay) * t];
          const km = haversineKm(P, q);
          if (!best || km < best.km) best = { km, q, p: f.properties };
        }
      }
      if (!best) return { ok: false, error: "No plate boundary found." };
      const txt = boundaryText(best.p);
      if (show_on_map) {
        if (!app.layers.isOn("ed-plates")) await app.layers.toggle("ed-plates", true).catch(() => {});
        showResults([P, best.q], "plates");
      }
      const motion = motionText(best.p);
      return {
        ok: true, lat: +lat, lng: +lng, distance_km: Math.round(best.km), boundary: best.p.b, class: txt.cls.t, description: txt.line, plates: [txt.na, txt.nb],
        relative_velocity_mm_yr: best.p.v, motion: motion || null, nearest_point: { lat: +best.q[1].toFixed(3), lng: +best.q[0].toFixed(3) }, source: "Bird (2003) PB2002", license: LIC.odcby,
        summary: `The nearest plate boundary is ${/^[aeiou]/i.test(txt.cls.t) ? "an" : "a"} **${txt.cls.t.toLowerCase()}** about **${fmt(best.km)} km** away: ${txt.line.replace(/^Between/, "between")}. Relative plate speed ≈ ${fmt(best.p.v, 1)} mm/yr${motion ? ` (${motion})` : ""} in model PB2002 (Bird 2003).`,
      };
    },
    local: {
      patterns: [/^(?:what|which) (?:tectonic )?plate(?: boundary)? (?:is (?:this|near here|here)|am i on|is nearest)$/i, /^(?:nearest |closest )?(?:tectonic )?plate boundary(?: here| nearby)?$/i, /^tectonic setting(?: here)?$/i],
      parse: () => center(),
      examples: ["nearest plate boundary", "tectonic setting here"],
    },
  });

  app.tools.define("get_glacier_info", {
    description: "The glacier at a point from the Randolph Glacier Inventory 7.0 (via GLIMS/NSIDC): name, RGI id, area, elevation range, length, slope, terminus type and outline date. Returns found:false when the point is not on a glacier. Shows a glacier card.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, show_card: { type: "boolean" } }, required: ["lat", "lng"] },
    async run({ lat, lng, show_card = true }) {
      let p;
      try { p = await glacierAt(+lat, +lng); } catch (err) { return { ok: false, error: `The GLIMS service did not answer — ${why(err)}.` }; }
      if (!p) return { ok: true, found: false, lat, lng, summary: `No RGI 7.0 glacier outline at ${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}.` };
      if (show_card) { glacierCard(p); reveal(+lng, +lat, 10.5, 8); }
      const rnd = (v, d = 0) => (num(v) == null ? null : +num(v).toFixed(d));
      const out = { name: p.glac_name ? titleCase(p.glac_name) : null, rgi_id: p.rgi_id, area_km2: rnd(p.area_km2, 3), elevation_min_m: rnd(p.zmin_m), elevation_max_m: rnd(p.zmax_m), elevation_median_m: rnd(p.zmed_m), length_m: rnd(p.lmax_m), slope_deg: rnd(p.slope_deg, 1), terminus: RGI_TERM[p.term_type] ?? null, surging: RGI_SURGE[p.surge_type] ?? null, outline_date: p.src_date ? String(p.src_date).slice(0, 10) : null };
      return { ok: true, found: true, glacier: out, source: "RGI 7.0 Consortium (2023), via GLIMS/NSIDC", license: LIC.ccby, summary: `**${out.name ?? "Unnamed glacier"}** (${out.rgi_id}): ${fmt(out.area_km2, 2)} km², ${fmt(out.elevation_min_m)}–${fmt(out.elevation_max_m)} m${out.length_m ? `, ${fmt(out.length_m / 1000, 1)} km long` : ""}; outline dated ${out.outline_date ?? "—"} (RGI 7.0).` };
    },
    local: { patterns: [/^(?:what |which )?glacier(?: is)? (?:here|this)$/i, /^glacier info(?: here)?$/i], parse: () => center(), examples: ["glacier here"] },
  });
}
const EARTH_TOOLS = ["list_earth_datasets", "find_volcanoes", "find_tsunamis", "find_historical_earthquakes", "find_mineral_deposits", "get_soil_properties", "get_precise_elevation", "get_magnetic_anomaly", "get_tectonic_setting", "get_glacier_info"];

/* ================================================================ init */
export function init() {
  registerProtocol();
  wireInteraction();
  defineTectonics();
  defineGeophysics();
  defineHazards();
  defineSoils();
  defineForests();
  defineGlaciers();
  defineMinerals();
  defineTools();
  // Legend buttons live in the Layers panel, which another module renders.
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-ed-probe]");
    if (b) { e.preventDefault(); startProbe(b.dataset.edProbe); }
    if (e.target.closest?.("[data-ed-cancel]")) stopProbe();
  });
  // Escape only cancels the probe; the shared handler registered after init would also close the panel or card.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || app.mode !== "ed-probe" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopProbe();
  });
  // Measure, Drop pin and Street View claim the map click the same way; the probe yields.
  app.on("mode:claim", (n) => { if (n !== "ed-probe" && probeKind) stopProbe(); });
  app.earthdata = { loadVolcanoes, loadTsunamis, loadQuakes, loadPlates, soilAt, magneticAt, preciseElevation, glacierAt };
}
