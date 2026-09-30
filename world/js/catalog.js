// Layers: every public dataset about the physical Earth in one panel — curated
// collections, the full NASA GIBS archive, Natural Earth reference vectors, bathymetry,
// land cover and geology — plus the time machine that scrubs any dated layer through
// its archive. Every layer names its source, attribution and licence.
import { app, $, esc, clamp, score, getJSON, readHash, syncHash } from "./core.js";
import { IMAGERY, setImagery } from "./map.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const GIBS_LEGENDS = "https://gibs.earthdata.nasa.gov/legends/";
const GIBS_BUILT = "2026-09-28"; // gibs.json and FEATURED_META were read from GIBS and tile-tested on this date
const NE_CDN = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/";
const DATA_GIBS = new URL("../data/gibs.json", import.meta.url).href;
const DATA_ADMIN1 = new URL("../data/catalog-admin1.json", import.meta.url).href;
const INTERACTIVE = ["res-", "live-", "cat-i-", "pin-", "meas-", "tour-"];
const DAY = 86400000;
const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const PHONE = window.matchMedia("(max-width: 720px)");
const COARSE = window.matchMedia("(pointer: coarse)");
// core's fmt() builds a new number formatter per call (about 0.6 ms); defining 1,172 layers
// formats a few thousand numbers, so the formatters are cached here.
const NF = new Map();
function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  if (!NF.has(digits)) NF.set(digits, new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }));
  return NF.get(digits).format(Number(n));
}
const idle = (fn, timeout = 1500) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 60));

const LIC = {
  nasa: "NASA Earth science data: free and open, no restrictions on reuse (attribution requested)",
  sedac: "NASA SEDAC data; see the dataset's own terms (most SEDAC data are CC BY 4.0)",
  gpw: "CC BY 4.0 (CIESIN, Columbia University)",
  ccby: "CC BY 4.0",
  pd: "Public domain",
  usgov: "Public domain (US Government work)",
  gebco: "GEBCO Grid: public domain, free to use with attribution; not for navigation",
  emodnet: "EMODnet data policy: free and open access, attribution required",
  osm: "Chart tiles CC BY-SA (OpenSeaMap); seamark data © OpenStreetMap contributors, ODbL",
};

/* ---------------------------------------------------------------- icons */
const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  layers: svg('<path d="M12 3.5 3 8l9 4.5L21 8z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16 9 4.5 9-4.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 18),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 16),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>', 18),
  calendar: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>', 14),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 16),
  back: svg('<path d="m15 6-6 6 6 6"/>', 16),
  prev: svg('<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>', 16),
  next: svg('<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>', 16),
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  opacity: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>', 16),
  check: svg('<path d="m6 12.5 4 4 8-9"/>', 14),
  orbit: svg('<circle cx="12" cy="12" r="5.5"/><path d="M3.3 16.6C1.8 14.4 5.5 9.8 11.6 6.6s12.3-4 13.8-1.8"/>'),
  cloud: svg('<path d="M7.5 18.5h9.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11.6 3.5 3.5 0 0 0 7.5 18.5z"/>'),
  drop: svg('<path d="M12 3.5c3.4 4.1 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2.1-5.9 5.5-10z"/>'),
  thermo: svg('<path d="M10 14.3V5.5a2 2 0 1 1 4 0v8.8a4 4 0 1 1-4 0z"/><path d="M12 9.5v6.5"/>'),
  wind: svg('<path d="M3 9h11.5a3 3 0 1 0-3-3"/><path d="M3 15h15a3 3 0 1 1-3 3"/>'),
  flame: svg('<path d="M12 21a6 6 0 0 0 6-6c0-4-2.8-6.3-4-10-2 2-3.2 4.2-3 6.6C9.8 10.6 9.4 9.7 9.3 8.5 7.2 10.5 6 12.6 6 15a6 6 0 0 0 6 6z"/>'),
  leaf: svg('<path d="M5 19.5c0-9 5.5-14.5 15-14.5 0 9.5-5.5 15-14.5 15"/><path d="M5 19.5 13.5 11"/>'),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2"/>'),
  wave: svg('<path d="M3 9c2 0 2.3-1.8 4.5-1.8S9.8 9 12 9s2.3-1.8 4.5-1.8S19 9 21 9"/><path d="M3 15c2 0 2.3-1.8 4.5-1.8S9.8 15 12 15s2.3-1.8 4.5-1.8S19 15 21 15"/>'),
  moon: svg('<path d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>'),
  alert: svg('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
  mountain: svg('<path d="m3 19 6.2-10.5 4.1 6.2 2.4-3.4L21 19z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
  strata: svg('<path d="M3.5 7.5h17M3.5 12h17M3.5 16.5h17"/><path d="M10 4.5 14 19.5"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 5.8a3 3 0 0 1 0 5.4M17.8 14.2a5.5 5.5 0 0 1 2.7 5.3"/>'),
  map: svg('<path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
};
const CAT_ICON = {
  "True colour & imagery": "orbit", "Clouds & storms": "cloud", "Precipitation & water vapour": "drop", Temperature: "thermo",
  "Air quality & aerosols": "wind", Fires: "flame", "Vegetation & land": "leaf", "Snow & ice": "snow", Oceans: "wave",
  "Night lights & people": "moon", Hazards: "alert", "Topography & reference": "mountain", "Radiation & energy": "sun", Other: "grid",
};
// Extra words so plain-language searches ("rain", "smoke", "sst") find the science layers.
const CAT_WORDS = {
  "True colour & imagery": ["satellite", "imagery", "photo", "true colour", "true color", "picture"],
  "Clouds & storms": ["clouds", "storms", "weather", "lightning"],
  "Precipitation & water vapour": ["rain", "rainfall", "precipitation", "humidity", "moisture", "weather"],
  Temperature: ["temperature", "heat", "hot", "cold"],
  "Air quality & aerosols": ["air quality", "pollution", "smoke", "haze", "dust", "aerosols", "gases"],
  Fires: ["fire", "fires", "wildfire", "burning"],
  "Vegetation & land": ["vegetation", "plants", "greenness", "land", "forest", "crops", "soil"],
  "Snow & ice": ["snow", "ice", "polar", "arctic", "antarctic", "glacier", "frozen"],
  Oceans: ["ocean", "sea", "marine", "water"],
  "Night lights & people": ["night", "lights", "people", "population", "cities", "urban"],
  Hazards: ["hazard", "risk", "disaster", "flood"],
  "Topography & reference": ["elevation", "terrain", "reference", "relief"],
  "Radiation & energy": ["radiation", "energy", "solar", "sun", "flux"],
  Other: [],
};
const SEDAC_RE = /GPW_|NDH_|Anthropogenic_Biomes|Human_Footprint|Last_of_the_Wild|GRUMP_|Estimated_Net_Migration|Probabilities_of_Urban|LECZ_|UHI_|Summer_.*_Land_Surface_Temp|Landsat_Human_Built|Landsat_Global_Man-made|Amphibian|Mammal|Croplands|Pastures/;

/* ---------------------------------------------------------------- time */
const pad = (n) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** YYYY, YYYY-MM, YYYY-MM-DD, full ISO datetimes, and the colon-free YYYY-MM-DDTHHMMZ this module stores. */
function toMs(s) {
  if (typeof s === "number") return s;
  const m = String(s ?? "").trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):?(\d{2})(?::?(\d{2}))?(?:\.\d+)?Z?)?)?)?$/i);
  if (!m) return NaN;
  return Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0);
}
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
// Stored times go into the URL hash, whose reader splits "id:time" at the last colon,
// so sub-daily times are kept colon-free (2026-09-28T1610Z).
function store(ms, unit) {
  const d = new Date(ms);
  return unit === "minute" ? `${isoDate(ms)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z` : isoDate(ms);
}
const urlTime = (ms, unit) => (unit === "minute" ? new Date(ms).toISOString().replace(/\.\d+Z$/, "Z") : isoDate(ms));
function parsePeriod(p) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(p ?? "");
  if (!m) return { unit: "day", n: 1 };
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => +x || 0);
  if (y) return { unit: "year", n: y };
  if (mo) return { unit: "month", n: mo };
  if (d) return { unit: "day", n: d };
  return { unit: "minute", n: Math.max(1, Math.round(h * 60 + mi + s / 60)) };
}
const STEP_PERIOD = { minute: "PT10M", day: "P1D", month: "P1M", year: "P1Y" };
const addMonths = (ms, k) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()); };
const monthsBetween = (a, b) => { const x = new Date(a), y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };
function floorUnit(ms, unit, n = 1) {
  const d = new Date(ms);
  if (unit === "minute") return Math.floor(ms / (n * 60000)) * n * 60000;
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (unit === "year") return Date.UTC(d.getUTCFullYear(), 0, 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The slider model for a layer's dates: index <-> time at the layer's real cadence. */
function timeline(def) {
  const t = def?.time;
  if (!t || t.min == null || t.max == null) return null;
  const { unit, n } = parsePeriod(t.period ?? STEP_PERIOD[t.step]);
  if (t.dates?.length > 1) {
    const list = t.dates.map(toMs).filter(Number.isFinite).sort((a, b) => a - b);
    const index = (ms) => list.reduce((best, v, i) => (Math.abs(v - ms) < Math.abs(list[best] - ms) ? i : best), 0);
    return { unit, n, min: list[0], max: list.at(-1), count: list.length, at: (i) => list[clamp(i, 0, list.length - 1)], index };
  }
  const min = toMs(t.min), max = toMs(t.max);
  if (!(max > min)) return null;
  if (unit === "month" || unit === "year") {
    const k = unit === "year" ? n * 12 : n;
    const count = Math.floor(monthsBetween(min, max) / k) + 1;
    return { unit, n, min, max, count, at: (i) => addMonths(min, clamp(i, 0, count - 1) * k), index: (ms) => clamp(Math.round(monthsBetween(min, ms) / k), 0, count - 1) };
  }
  // Day and minute steps count back from the newest date, so "latest" is always reachable.
  const size = (unit === "minute" ? 60000 : DAY) * n;
  const count = Math.floor((max - min) / size) + 1;
  return { unit, n, min, max, count, at: (i) => max - (count - 1 - clamp(i, 0, count - 1)) * size, index: (ms) => clamp(count - 1 - Math.round((max - ms) / size), 0, count - 1) };
}
/** A time on the layer's own grid (nearest step, clamped to its archive). */
function snapTime(def, t) {
  const tl = timeline(def);
  if (!tl || t == null) return t;
  const ms = toMs(t);
  return Number.isFinite(ms) ? store(tl.at(tl.index(ms)), tl.unit) : def.time.default;
}
function timeLabel(ms, unit) {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  if (unit === "year") return String(d.getUTCFullYear());
  if (unit === "month") return `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const day = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return unit === "minute" ? `${day}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : day;
}
function cadence(unit, n) {
  if (unit === "minute") return n === 60 ? "Hourly" : `${n}-minute`;
  if (unit === "day") return n === 1 ? "Daily" : `${n}-day`;
  if (unit === "month") return n === 1 ? "Monthly" : `${n}-month`;
  return n === 1 ? "Yearly" : `${n}-year`;
}
const shortDate = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** "Daily · Feb 2000 – today" style summary of a layer's dates, or null for static layers. */
function datesText(def) {
  const tl = timeline(def);
  if (!tl) return def?.meta?.date ? `Single epoch · ${def.meta.date.slice(0, 4)}` : null;
  if (def.time.dates?.length) return `${def.time.dates.map((d) => d.slice(0, 4)).join(" and ")} editions`;
  return `${cadence(tl.unit, tl.n)} · ${shortDate(tl.min)} – ${def.time.now ? "today" : shortDate(tl.max)}`;
}
const mpp = (z) => { const m = 40075016.686 / (256 * 2 ** z); return m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`; };

/* ---------------------------------------------------------------- state */
const opacity = new Map();   // layer id -> 0..1 chosen by the viewer
const probe = new Map();     // layer id -> { requested, actual, missing } from GIBS's Layer-Time-Actual header
const probeSeq = new Map();
const busy = new Set();      // layers whose data is still loading
const openInfo = new Set();  // "On the map" cards with details expanded
const openColl = new Set(["today"]);
let order = [];              // activation order, newest last
let gibsDoc = null, gibsPromise = null, gibsError = null, gibsDefined = false;
const view = { q: "", cat: null, filter: "all", more: false };
let panelNode = null, refreshQueued = false, detachScroll = null;

/* ---------------------------------------------------------------- tile protocol */
// catx://<key>/<host/path> — fetches https://<host/path>; a missing tile (404 for a date
// without data, or outside a regional service's coverage) and a WMS error document sent
// with status 200 become a transparent tile instead of a map error. Server errors get one
// retry: GIBS answers transient 5xx without CORS headers, which the browser reports as a
// network failure. Tiles that still fail count against the layer's health.
const TRANSPARENT_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const emptyTile = () => ({ data: TRANSPARENT_PNG.buffer.slice(0) });
const isImage = (res) => { const type = res.headers.get("content-type"); return !type || /^image\//i.test(type); };
const TILE_TIMEOUT = 20000; // a map server that has not answered by then counts as down
/** Resolves to a Response with image data, "empty" (no data there), or null (the provider failed). */
async function fetchTile(url, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const cancel = () => ctrl.abort();
    signal.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TILE_TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return isImage(res) ? res : "empty";
      if (res.status < 500) return "empty";
    } catch (err) {
      if (signal.aborted) throw new DOMException("Tile request aborted", "AbortError");
      if (timedOut) return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    }
    if (!attempt) await new Promise((r) => setTimeout(r, 600));
    if (signal.aborted) throw new DOMException("Tile request aborted", "AbortError");
  }
  return null;
}
const rasterDefs = new Map(); // protocol key -> raster layer def
const health = new Map();     // layer id -> { ok, fail } tile outcomes since the layer (or its date) last changed
const FAILS = 4;
const failing = (id) => { const h = health.get(id); return !!h && !h.ok && h.fail >= FAILS; };
function noteTile(def, good) {
  const h = health.get(def.id) ?? { ok: 0, fail: 0 };
  health.set(def.id, h);
  const was = failing(def.id);
  if (good) h.ok++; else h.fail++;
  if (was === failing(def.id) || !app.layers.isOn(def.id)) return;
  if (!was) app.ui.toast(`${def.title}: no answer from the provider right now.`, { tone: "error" });
  refreshSoon();
}
function installProtocol() {
  app.maplibregl.addProtocol("catx", async (params, ctrl) => {
    const cut = params.url.indexOf("/", 7);
    const url = `https://${params.url.slice(cut + 1)}`;
    const def = rasterDefs.get(params.url.slice(7, cut));
    const token = def?.gate?.(url);
    if (token && token !== "default" && !(await checkDate(def, token)).ok) return emptyTile();
    const res = await fetchTile(url, ctrl.signal);
    if (def && res !== "empty") noteTile(def, !!res);
    if (!res || res === "empty") return emptyTile();
    try { return { data: await res.arrayBuffer() }; } catch (err) { if (err.name === "AbortError") throw err; return emptyTile(); }
  });
}
const slug = (id) => id.replace(/[^A-Za-z0-9_-]+/g, "-");
const viaProtocol = (key, url) => `catx://${key}/${url.replace(/^https:\/\//, "")}`;

/* ---------------------------------------------------------------- raster layers */
function rasterDef(o) {
  const key = slug(o.id);
  const boundsList = Array.isArray(o.bounds?.[0]) ? o.bounds : [o.bounds ?? null];
  const lids = boundsList.map((_, i) => (boundsList.length > 1 ? `cat-r-${key}-${i}` : `cat-r-${key}`));
  const tiles = (t) => [viaProtocol(key, o.url(t))];
  let applied = null; // the time the sources currently show
  const def = {
    kind: "raster", slot: "overlay", ...o,
    url: undefined,
    tileUrl: (t, z, x, y) => o.url(t).replace("{z}", z).replace("{x}", x).replace("{y}", y),
    add(map, ctx) {
      let t = ctx?.time ?? def.time?.default ?? null;
      // A shared link or another module may name a date off the layer's grid or outside its archive.
      const snapped = snapTime(def, t);
      if (snapped !== t) { t = snapped; queueMicrotask(() => { if (app.layers.isOn(def.id)) app.layers.setTime(def.id, snapped); }); }
      applied = t;
      const before = app.layers.anchor(def.slot);
      health.delete(def.id);
      lids.forEach((lid, i) => {
        if (!map.getSource(lid)) {
          map.addSource(lid, {
            type: "raster", tiles: tiles(t), tileSize: o.tileSize ?? 256, maxzoom: o.maxzoom ?? 18,
            ...(o.minzoom != null ? { minzoom: o.minzoom } : {}), ...(boundsList[i] ? { bounds: boundsList[i] } : {}),
          });
        }
        if (!map.getLayer(lid)) {
          map.addLayer({
            id: lid, type: "raster", source: lid,
            paint: { "raster-opacity": opacity.get(def.id) ?? o.opacity ?? 0.85, "raster-fade-duration": REDUCED ? 0 : 240, ...(o.resampling ? { "raster-resampling": o.resampling } : {}) },
          }, before);
        }
      });
      o.afterAdd?.(map, lids);
      if (def.probe && def.time) runProbe(def, t);
    },
    remove(map) {
      for (const lid of lids) {
        if (map.getLayer(lid)) map.removeLayer(lid);
        if (map.getSource(lid)) map.removeSource(lid);
      }
    },
    setTime(map, iso) {
      const snapped = snapTime(def, iso);
      if (snapped !== iso) { app.layers.setTime(def.id, snapped); return; }
      if (iso === applied) return;
      applied = iso;
      health.delete(def.id);
      for (const lid of lids) map.getSource(lid)?.setTiles(tiles(iso));
      if (def.probe) runProbe(def, iso);
    },
    setOpacity(map, v) {
      opacity.set(def.id, v);
      for (const lid of lids) if (map.getLayer(lid)) map.setPaintProperty(lid, "raster-opacity", v);
    },
    _lids: lids,
    _setTiles: (map, urlFor) => { for (const lid of lids) map.getSource(lid)?.setTiles([viaProtocol(key, urlFor)]); },
  };
  rasterDefs.set(key, def);
  return def;
}

/* ---------------------------------------------------------------- NASA GIBS */
// Tile metadata for the GIBS layers featured in collections, generated from the same
// capabilities read as gibs.json so featured layers work before the catalogue loads.
const FEATURED_META = {
  VIIRS_NOAA20_CorrectedReflectance_TrueColor: { fmt: "jpg", maxzoom: 9, time: { start: "2018-01-05", end: "2026-09-28", step: "P1D", now: 1 }, cat: "True colour & imagery" },
  VIIRS_SNPP_CorrectedReflectance_TrueColor: { fmt: "jpg", maxzoom: 9, time: { start: "2015-11-24", end: "2026-09-28", step: "P1D", now: 1 }, cat: "True colour & imagery" },
  MODIS_Terra_CorrectedReflectance_TrueColor: { fmt: "jpg", maxzoom: 9, time: { start: "2000-02-24", end: "2026-09-28", step: "P1D", now: 1 }, cat: "True colour & imagery" },
  MODIS_Aqua_CorrectedReflectance_TrueColor: { fmt: "jpg", maxzoom: 9, time: { start: "2002-07-03", end: "2026-09-28", step: "P1D", now: 1 }, cat: "True colour & imagery" },
  "GOES-East_ABI_GeoColor": { fmt: "png", maxzoom: 7, time: { start: "2021-04-29T18:00:00Z", end: "2026-09-28T15:30:00Z", step: "PT10M", now: 1 }, cat: "True colour & imagery" },
  "GOES-West_ABI_GeoColor": { fmt: "png", maxzoom: 7, time: { start: "2021-04-29T18:00:00Z", end: "2026-09-28T15:50:00Z", step: "PT10M", now: 1 }, cat: "True colour & imagery" },
  Himawari_AHI_Band13_Clean_Infrared: { fmt: "png", maxzoom: 6, time: { start: "2020-01-03T00:00:00Z", end: "2026-09-28T16:00:00Z", step: "PT10M", now: 1 }, legend: "Clean_Longwave_Infrared_Window_Band_H.svg", cat: "True colour & imagery" },
  HLS_L30_Nadir_BRDF_Adjusted_Reflectance: { fmt: "png", maxzoom: 12, time: { start: "2013-03-22", end: "2026-09-26", step: "P1D", now: 1 }, cat: "True colour & imagery" },
  IMERG_Precipitation_Rate: { fmt: "png", maxzoom: 6, time: { start: "2000-06-01", end: "2026-09-27", step: "P1D", now: 1 }, legend: "GPM_Precipitation_Rate_H.svg", cat: "Precipitation & water vapour" },
  IMERG_Precipitation_Rate_30min: { fmt: "png", maxzoom: 6, time: { start: "1998-01-01T00:00:00Z", end: "2026-09-28T10:30:00Z", step: "PT30M", now: 1 }, legend: "GPM_Precipitation_Rate_H.svg", cat: "Precipitation & water vapour" },
  MODIS_Terra_Cloud_Top_Temp_Day: { fmt: "png", maxzoom: 6, time: { start: "2000-02-24", end: "2026-09-28", step: "P1D", now: 1 }, legend: "MODIS_Cloud_Top_Temp_H.svg", cat: "Clouds & storms" },
  MODIS_Terra_Cloud_Fraction_Day: { fmt: "png", maxzoom: 6, time: { start: "2000-02-24", end: "2026-09-28", step: "P1D", now: 1 }, legend: "MODIS_Cloud_Fraction_H.svg", cat: "Clouds & storms" },
  MODIS_Combined_Value_Added_AOD: { fmt: "png", maxzoom: 6, time: { start: "2017-04-19", end: "2026-09-27", step: "P1D", now: 1 }, legend: "MODIS_Combined_Value_Added_AOD_H.svg", cat: "Air quality & aerosols" },
  MODIS_Terra_Water_Vapor_5km_Day: { fmt: "png", maxzoom: 6, time: { start: "2000-02-24", end: "2026-09-28", step: "P1D", now: 1 }, legend: "MODIS_Water_Vapor_H.svg", cat: "Precipitation & water vapour" },
  AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day: { fmt: "png", maxzoom: 6, time: { start: "2002-08-30", end: "2026-09-28", step: "P1D", now: 1 }, legend: "AIRS_Carbon_Monoxide_Volume_Mixing_Ratio_H.svg", cat: "Air quality & aerosols" },
  OMPS_Ozone_Total_Column: { fmt: "png", maxzoom: 6, time: { start: "2012-01-26", end: "2026-09-28", step: "P1D", now: 1 }, legend: "OMPS_Ozone_Total_Column_H.svg", cat: "Air quality & aerosols" },
  TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column: { fmt: "png", maxzoom: 6, time: { start: "2018-05-06", end: "2026-09-27", step: "P1D", now: 1 }, legend: "OMI_Nitrogen_Dioxide_Tropo_Column_H.svg", cat: "Air quality & aerosols" },
  GHRSST_L4_MUR_Sea_Surface_Temperature: { fmt: "png", maxzoom: 7, time: { start: "2002-06-01", end: "2026-09-27", step: "P1D", now: 1 }, legend: "GHRSST_Sea_Surface_Temperature_H.svg", cat: "Oceans" },
  GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies: { fmt: "png", maxzoom: 7, time: { start: "2019-07-23", end: "2026-09-27", step: "P1D", now: 1 }, legend: "GHRSST_Sea_Surface_Temperature_Anomalies_H.svg", cat: "Oceans" },
  VIIRS_NOAA20_Chlorophyll_a: { fmt: "png", maxzoom: 7, time: { start: "2017-12-13", end: "2026-09-28", step: "P1D", now: 1 }, legend: "VIIRS_Chlorophyll_H.svg", cat: "Oceans" },
  GHRSST_L4_MUR_Sea_Ice_Concentration: { fmt: "png", maxzoom: 7, time: { start: "2002-06-01", end: "2026-09-27", step: "P1D", now: 1 }, legend: "GHRSST_Sea_Ice_Concentration_H.svg", cat: "Snow & ice" },
  SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean: { fmt: "png", maxzoom: 6, time: { start: "2015-05-08", end: "2026-09-19", step: "P1D", now: 1 }, legend: "SMAP_Sea_Surface_Salinity_H.svg", cat: "Oceans" },
  MODIS_Terra_L3_NDVI_16Day: { fmt: "png", maxzoom: 9, time: { start: "2000-03-05", end: "2026-08-29", step: "P16D", now: 1 }, legend: "MODIS_L3_NDVI_H.svg", cat: "Vegetation & land" },
  MODIS_Terra_NDSI_Snow_Cover: { fmt: "png", maxzoom: 8, time: { start: "2000-02-24", end: "2026-09-28", step: "P1D", now: 1 }, legend: "MODIS_NDSI_Snow_Cover_H.svg", cat: "Snow & ice" },
  MODIS_Terra_L3_Land_Surface_Temp_8Day_Day: { fmt: "png", maxzoom: 7, time: { start: "2000-02-26", end: "2026-09-14", step: "P8D", now: 1 }, legend: "MODIS_Land_Surface_Temp_H.svg", cat: "Temperature" },
  "GOES-East_ABI_FireTemp": { fmt: "png", maxzoom: 7, time: { start: "2024-08-07T13:50:00Z", end: "2026-09-28T15:30:00Z", step: "PT10M", now: 1 }, cat: "Fires" },
  MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual: { fmt: "png", maxzoom: 8, time: { start: "2001-01-01", end: "2024-01-01", step: "P1Y" }, legend: "MODIS_IGBP_Land_Cover_Type_H.svg", cat: "Vegetation & land" },
  SMAP_L4_Analyzed_Root_Zone_Soil_Moisture: { fmt: "png", maxzoom: 6, time: { start: "2015-03-31", end: "2026-09-25", step: "P1D", now: 1 }, legend: "SMAP_Analyzed_Soil_Moisture_H.svg", cat: "Vegetation & land" },
  "MODIS_Combined_Flood_2-Day": { fmt: "png", maxzoom: 9, time: { start: "2021-01-01", end: "2026-09-28", step: "P1D", now: 1 }, legend: "MODIS_Flood_H.svg", cat: "Hazards" },
  GPW_Population_Density_2020: { fmt: "png", maxzoom: 7, legend: "GPW_Population_Density_2020_H.svg", cat: "Night lights & people" },
  VIIRS_Black_Marble: { fmt: "png", maxzoom: 8, time: { start: "2012-01-01", end: "2016-01-01", step: "P1Y", dates: ["2012-01-01", "2016-01-01"] }, cat: "Night lights & people" },
  VIIRS_SNPP_DayNightBand_At_Sensor_Radiance: { fmt: "png", maxzoom: 8, time: { start: "2020-11-18", end: "2026-09-28", step: "P1D", now: 1 }, legend: "VIIRS_DayNightBand_At_Sensor_Radiance_H.svg", cat: "Night lights & people" },
  ASTER_GDEM_Color_Shaded_Relief: { fmt: "jpg", maxzoom: 12, cat: "Topography & reference" },
};

/** Runtime dates for a GIBS layer. Layers still in production extend past the build date:
 *  daily "today" layers open on yesterday (today's swaths are still arriving), others ask
 *  GIBS for their real latest date. */
function gibsTime(m) {
  const t = m.time;
  if (!t) return null;
  const { unit, n } = parsePeriod(t.step);
  let max = toMs(t.end), def = toMs(t.default ?? t.end), latest = false;
  if (t.now) {
    const today = floorUnit(Date.now(), "day");
    if (unit === "day" && n === 1 && t.end === GIBS_BUILT) { max = today; def = today - DAY; }
    else {
      const shift = Math.max(0, Date.now() - toMs(GIBS_BUILT));
      const now = floorUnit(Date.now(), unit, n);
      max = Math.min(now, floorUnit(max + shift, unit, n));
      def = Math.min(max, floorUnit(def + shift, unit, n));
      latest = true;
    }
  }
  if (m.okTime) { def = toMs(m.okTime); latest = false; }
  return { min: store(toMs(t.start), unit), max: store(max, unit), default: store(def, unit), step: unit, period: t.step, dates: t.dates, latest, now: !!t.now };
}
function gibsToken(def, t) {
  if (!def.time) return def.meta.date ?? "default";
  if (t == null || t === "default" || (def.time.latest && t === def.time.default)) return "default";
  const ms = toMs(t);
  return Number.isFinite(ms) ? urlTime(ms, def.time.step) : "default";
}
function gibsDescription(m, time) {
  const bits = [];
  if (time) {
    const tl = timeline({ time });
    if (time.dates?.length) bits.push(`Available for ${time.dates.map((d) => d.slice(0, 4)).join(" and ")}`);
    else if (tl) bits.push(`${cadence(tl.unit, tl.n)} from ${timeLabel(tl.min, tl.unit === "minute" ? "day" : tl.unit)}${time.now ? " to the present" : ` to ${timeLabel(tl.max, tl.unit === "minute" ? "day" : tl.unit)}`}`);
  } else if (m.date) bits.push(`A single epoch (${m.date})`);
  else bits.push("A static layer");
  bits.push(`finest detail about ${mpp(m.maxzoom)} per pixel (zoom ${m.maxzoom})`);
  return `${m.title}. ${bits.join("; ")}. Served by NASA's Global Imagery Browse Services.`;
}
/** A layer's description; a GIBS layer without a written one gets it generated when asked
 *  (generating all ~1,170 up front cost about half a second on a slow phone). */
const describe = (def) => def.description ?? (def.gibsId ? gibsDescription(def.meta, def.time) : null);

function gibsDef(m, cur = {}) {
  const time = gibsTime(m);
  const sedac = SEDAC_RE.test(m.id);
  const cat = m.cat ?? "Other";
  const imagery = cat === "True colour & imagery";
  const tms = m.tms ?? `GoogleMapsCompatible_Level${m.maxzoom}`;
  const tpl = (token) => `${GIBS}/${m.id}/default/${token}/${tms}/{z}/{y}/{x}.${m.fmt}`;
  const def = rasterDef({
    id: `gibs:${m.id}`,
    gibsId: m.id,
    meta: m,
    nasaCat: cat,
    curated: !!cur.title,
    title: cur.title ?? m.title,
    sub: cur.sub,
    category: cur.category ?? `NASA GIBS · ${cat}`,
    description: cur.description,
    keywords: [...(cur.keywords ?? []), m.id.replace(/[_-]+/g, " ").toLowerCase()],
    // Category words only widen the panel's all-words search; as keywords they would
    // outrank real titles in the omnibox and in name matching.
    tags: CAT_WORDS[cat] ?? [],
    source: cur.source ?? (sedac ? "NASA SEDAC (CIESIN) via NASA GIBS" : "NASA EOSDIS GIBS"),
    attribution: cur.attribution ?? (sedac ? "NASA SEDAC / CIESIN, Columbia University · NASA GIBS" : "NASA EOSDIS GIBS"),
    license: cur.license ?? (sedac ? LIC.sedac : LIC.nasa),
    slot: cur.slot ?? (imagery ? "imagery" : "overlay"),
    opacity: cur.opacity ?? (imagery ? 1 : 0.85),
    resampling: cur.resampling,
    maxzoom: m.maxzoom,
    bounds: m.bbox,
    legendUrl: m.legend ? GIBS_LEGENDS + m.legend : null,
    detail: `about ${mpp(m.maxzoom)} per pixel at best (zoom ${m.maxzoom})`,
    time,
    probe: true,
    url: (t) => tpl(gibsToken(def, t)),
    // Tiles of a dated request wait for checkDate() on the date in their path.
    gate: (url) => /\/default\/([^/]+)\//.exec(url)?.[1],
    checkUrl: (token) => tpl(token).replace("{z}/{y}/{x}", "0/0/0"),
  });
  return def;
}

/** Whether GIBS has a date for a layer, from one HEAD request for its z0 tile: 404 means no
 *  data that day, and Layer-Time-Actual names the date it serves (it snaps to the containing
 *  period). For a dated request, a 200 without that header is GIBS's blank placeholder tile:
 *  older 10-minute GOES scans answer that way while every zoomed-in tile is a 404. The
 *  layer's tiles wait for this, so a date without data costs one request instead of a
 *  screenful of 404s. Unknown answers (network, 5xx) let the tiles try. */
const dateChecks = new Map();
function checkDate(def, token) {
  const key = `${def.id}|${token}`;
  if (!dateChecks.has(key)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const dated = !!def.time && token !== "default";
    const p = fetch(def.checkUrl(token), { method: def.checkMethod ?? "HEAD", signal: ctrl.signal })
      .then((res) => {
        const actual = res.headers.get("layer-time-actual");
        // A WMS answers a date it does not have with an XML error document and status 200.
        const blank = res.ok && (!isImage(res) || (def.gibsId && dated && !actual));
        res.body?.cancel().catch(() => {});
        return { ok: (res.ok && !blank) || res.status >= 500, known: res.status < 500, status: blank ? 204 : res.status, actual };
      })
      .catch(() => ({ ok: true, known: false, status: 0, actual: null }))
      .finally(() => clearTimeout(timer));
    dateChecks.set(key, p);
    // "default" moves as new data arrives, recent dates get published during the day, and
    // unknown answers deserve another try.
    const recent = !!def.time?.now && Date.now() - toMs(token) < 2 * DAY;
    p.then((r) => { if (token === "default" || !r.known || (recent && !r.ok)) setTimeout(() => dateChecks.delete(key), 60000); });
  }
  return dateChecks.get(key);
}
function runProbe(def, t) {
  const p = probeOnce(def, t);
  probeWaits.set(def.id, p);
  return p;
}
/** Resolves once the newest probe for a layer has answered (or after `ms`). */
const probeSettled = (id, ms = 6000) => Promise.race([probeWaits.get(id) ?? Promise.resolve(), new Promise((r) => setTimeout(r, ms))]);
const probeWaits = new Map();
async function probeOnce(def, t) {
  const seq = (probeSeq.get(def.id) ?? 0) + 1;
  probeSeq.set(def.id, seq);
  const latestReq = def.time.latest && (t == null || t === def.time.default);
  const r = await checkDate(def, latestReq ? "default" : gibsToken(def, t));
  if (probeSeq.get(def.id) !== seq || !r.known) return;
  const unit = def.time.step;
  if (!r.ok) {
    probe.set(def.id, { requested: t, missing: true, status: r.status });
    if (!latestReq && t === def.time.default && !def.time._fellBack) fallBack(def);
  } else {
    const ms = toMs(r.actual);
    const actual = Number.isFinite(ms) && ms < toMs("2800") ? store(ms, unit) : null;
    if (latestReq && actual) {
      // "default" resolved: this is the newest date GIBS has for the layer.
      def.time.default = actual;
      def.time.max = actual;
      syncHash();
    }
    probe.set(def.id, { requested: latestReq ? actual : t, actual, missing: false });
  }
  renderTimebar();
  refreshSoon();
}
/** A layer's default date turned out to have no data: walk back a few steps to one that does. */
async function fallBack(def) {
  def.time._fellBack = true;
  const tl = timeline(def);
  if (!tl) return;
  let i = tl.index(toMs(def.time.default));
  for (let k = 0; k < 4 && i > 0; k++) {
    i--;
    const t = store(tl.at(i), tl.unit);
    const r = await checkDate(def, gibsToken(def, t));
    if (!r.known) return;
    if (r.ok) {
      def.time.default = t;
      if (app.layers.isOn(def.id) && app.layers.timeOf(def.id) !== t) app.layers.setTime(def.id, t);
      return;
    }
  }
}

/* ---------------------------------------------------------------- curated datasets */
const US_BOUNDS = [[-125, 24.4, -66.8, 49.4], [-170, 51.2, -129.9, 71.5], [-160.4, 18.8, -154.7, 22.4], [-67.4, 17.8, -65.2, 18.6]];
const WC_SEARCH = "287434fc0e0024667464141a8cb3f231"; // Planetary Computer mosaic search for ESA WorldCover 2021
const WC_CLASSES = [["#006400", "Tree cover"], ["#ffbb22", "Shrubland"], ["#ffff4c", "Grassland"], ["#f096ff", "Cropland"], ["#fa0000", "Built-up"], ["#b4b4b4", "Bare / sparse vegetation"], ["#f0f0f0", "Snow and ice"], ["#0064c8", "Permanent water"], ["#0096a0", "Herbaceous wetland"], ["#00cf75", "Mangroves"], ["#fae6a0", "Moss and lichen"]];
const swatches = (rows, shape = "sq") => `<div class="cat-key">${rows.map(([c, t]) => `<span><i class="${shape}" style="--c:${c}"></i>${esc(t)}</span>`).join("")}</div>`;
let wcSearch = WC_SEARCH, wcRegistered = false;

function curatedRasters() {
  return [
    rasterDef({
      id: "gebco-ncei", curated: true, title: "Ocean floor · GEBCO", sub: "NOAA NCEI tiles · to zoom 10",
      category: "Oceans", keywords: ["bathymetry", "ocean floor", "seafloor", "sea floor", "depth", "gebco", "undersea", "trench", "ridge"],
      description: "Colour-shaded depth of the whole ocean floor from the GEBCO global bathymetric grid, published as fast map tiles by NOAA's National Centers for Environmental Information. Ridges, trenches and seamounts to about zoom 10. Not for navigation.",
      source: "GEBCO Compilation Group · NOAA NCEI", attribution: "GEBCO Compilation Group; NOAA National Centers for Environmental Information (NCEI)", license: LIC.gebco,
      slot: "imagery", opacity: 1, maxzoom: 10, detail: "to zoom 10 (about 150 m per pixel)",
      url: () => "https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_basemap_NCEI/MapServer/tile/{z}/{y}/{x}",
      sample: [3, 2, 3],
    }),
    rasterDef({
      id: "emodnet-bathymetry", curated: true, title: "Seabed relief · EMODnet", sub: "Global base layer · to zoom 12",
      category: "Oceans", keywords: ["bathymetry", "seabed", "seafloor", "ocean floor", "emodnet", "hillshade", "europe"],
      description: "EMODnet Bathymetry's global base layer: hill-shaded seabed and land, sharpest in European seas. Tiles take about a second each.",
      source: "EMODnet Bathymetry Consortium", attribution: "EMODnet Bathymetry Consortium (emodnet-bathymetry.eu)", license: LIC.emodnet,
      slot: "imagery", opacity: 1, maxzoom: 12, detail: "to zoom 12",
      url: () => "https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png",
      sample: [3, 4, 2],
    }),
    rasterDef({
      id: "gebco-wms", curated: true, title: "Bathymetry · GEBCO live grid", sub: "GEBCO map server · slower",
      category: "Oceans", keywords: ["bathymetry", "gebco", "ocean depth", "seafloor", "wms"],
      description: "The latest GEBCO grid rendered on demand by GEBCO's own map server, coloured by depth and height. Slower than cached tiles (about a second per tile) but always the current release. Not for navigation.",
      source: "GEBCO (General Bathymetric Chart of the Oceans)", attribution: "Imagery reproduced from the GEBCO Grid, GEBCO Compilation Group", license: LIC.gebco,
      slot: "imagery", opacity: 1, maxzoom: 10, detail: "rendered on demand; native grid about 450 m",
      url: () => "https://wms.gebco.net/mapserv?service=WMS&request=GetMap&version=1.3.0&layers=GEBCO_LATEST_2&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png",
      sampleUrl: "https://wms.gebco.net/mapserv?service=WMS&request=GetMap&version=1.3.0&layers=GEBCO_LATEST_2&styles=&crs=EPSG:3857&bbox=-10018754.17,0,-5009377.08,5009377.08&width=256&height=256&format=image/png",
    }),
    rasterDef({
      id: "worldcover", curated: true, title: "Land cover 10 m · ESA WorldCover", sub: "2021 · appears from zoom 6",
      category: "Land", keywords: ["land cover", "landcover", "land use", "forest", "cropland", "built-up", "worldcover", "esa", "sentinel"],
      description: "ESA WorldCover 2021: the whole land surface classified into 11 cover types at 10 m from Sentinel-1 and Sentinel-2, served by Microsoft Planetary Computer. Zoom to 6 or closer to see it.",
      source: "ESA WorldCover 2021 via Microsoft Planetary Computer", attribution: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium", license: LIC.ccby,
      slot: "overlay", opacity: 0.85, minzoom: 6, maxzoom: 14, resampling: "nearest", minZoomHint: 6, detail: "10 m per pixel (to zoom 14)",
      legendHtml: swatches(WC_CLASSES),
      url: () => `https://planetarycomputer.microsoft.com/api/data/v1/mosaic/tiles/${wcSearch}/WebMercatorQuad/{z}/{x}/{y}?assets=map&colormap_name=esa-worldcover&collection=esa-worldcover&format=png`,
      sample: [6, 33, 21],
      afterAdd: (map) => registerWorldCover(map),
    }),
    rasterDef({
      id: "macrostrat", curated: true, title: "Bedrock geology · Macrostrat", sub: "Geologic map · most detailed in North America",
      category: "Geology", keywords: ["geology", "bedrock", "rock", "rocks", "lithology", "formations", "geologic map", "macrostrat", "strata", "stratigraphy"],
      description: "Bedrock geology compiled by Macrostrat from published geological maps at several scales, coloured by rock unit. Detail is richest in North America; elsewhere a small-scale world map. Click the map for the rock unit under any point (it appears in the place card).",
      source: "Macrostrat (University of Wisconsin–Madison)", attribution: "Macrostrat (macrostrat.org) and the original map sources", license: LIC.ccby,
      slot: "overlay", opacity: 0.7, tileSize: 512, maxzoom: 15, resampling: "nearest", detail: "compiled maps from about 1:5M to 1:24k",
      // The query string gives Macrostrat's cache a key of its own, so tiles always carry CORS headers.
      url: () => "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png?cors=baryon",
      sample: [3, 1, 2],
    }),
    rasterDef({
      id: "usgs-topo", curated: true, title: "US Topo · USGS", sub: "The National Map · United States only",
      category: "Reference", keywords: ["topo", "topographic", "usgs", "contours", "national map", "united states", "usa", "trails"],
      description: "The National Map's US Topo base map: contours, shaded relief, roads, trails, rivers and place names for the United States, to zoom 16. Outside the US the layer shows nothing.",
      source: "USGS The National Map", attribution: "USGS The National Map", license: LIC.usgov,
      slot: "imagery", opacity: 1, maxzoom: 16, bounds: US_BOUNDS, coverage: "United States", detail: "to zoom 16",
      url: () => "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
      sample: [8, 53, 97],
    }),
    rasterDef({
      id: "openseamap", curated: true, title: "Sea marks · OpenSeaMap", sub: "Buoys, lights, harbours · from zoom 9",
      category: "Reference", keywords: ["nautical", "sea marks", "seamarks", "buoys", "lighthouses", "harbours", "harbors", "marine", "shipping"],
      description: "Buoys, beacons, lighthouses, harbours and other nautical marks mapped by the OpenSeaMap community, drawn over any base map from zoom 9. Not for navigation.",
      source: "OpenSeaMap", attribution: "© OpenSeaMap contributors · data © OpenStreetMap contributors", license: LIC.osm,
      slot: "data", opacity: 1, minzoom: 9, maxzoom: 18, minZoomHint: 9, detail: "from zoom 9",
      url: () => "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
      sample: [12, 1206, 1539],
    }),
    firesDef(),
  ];
}

function firesDef() {
  const today = floorUnit(Date.now(), "day");
  const time = { min: "2020-01-01", max: isoDate(today), default: isoDate(today - DAY), step: "day", period: "P1D", now: true };
  const wms = (bbox, size, day) => `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_Thermal_Anomalies_375m_All&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=true&TIME=${day}`;
  return rasterDef({
    id: "fires-viirs", curated: true, title: "Active fires · VIIRS 375 m", sub: "Daily worldwide · since 2020",
    category: "Land", keywords: ["fire", "fires", "wildfire", "wildfires", "burning", "thermal anomalies", "firms", "hotspots"],
    description: "Fire and thermal-anomaly detections at 375 m from the VIIRS instrument on NOAA-20 (NASA FIRMS), one UTC day at a time since 1 January 2020. Each red mark is a pixel where a fire or other hot source was detected.",
    source: "NASA FIRMS (VIIRS NOAA-20) via NASA GIBS", attribution: "NASA FIRMS · NASA EOSDIS GIBS", license: LIC.nasa,
    slot: "overlay", opacity: 1, maxzoom: 12, detail: "375 m detections",
    overlaps: { id: "fires", note: (live) => `Same VIIRS detections as Live Earth › ${live.title}.` },
    legendHtml: swatches([["#ff2d2d", "Fire / thermal anomaly detection"]], "dot"),
    time,
    url: (t) => wms("{bbox-epsg-3857}", 256, isoDate(Number.isFinite(toMs(t)) ? toMs(t) : today - DAY)),
    sampleUrl: wms(WORLD_BBOX, 256, isoDate(today - DAY)),
    // Today's detections appear during the day; until then the WMS answers with an error
    // document. A 16-pixel world map tells whether a day has been published.
    probe: true,
    gate: (url) => /[?&]TIME=([^&]+)/.exec(url)?.[1],
    checkUrl: (day) => wms(WORLD_BBOX, 16, day),
    checkMethod: "GET",
  });
}
const WORLD_BBOX = "-20037508.34,-20037508.34,20037508.34,20037508.34";

/** Planetary Computer mosaic ids are hashes of the search, so registering is idempotent;
 *  doing it once per visit keeps the tiles working if the stored search ever expires. */
async function registerWorldCover(map) {
  if (wcRegistered) return;
  wcRegistered = true;
  try {
    const res = await fetch("https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ collections: ["esa-worldcover"], "filter-lang": "cql2-json", filter: { op: "anyinteracts", args: [{ property: "datetime" }, { interval: ["2021-01-01T23:59:59Z", "2021-12-31T23:59:59Z"] }] } }),
    });
    const id = (await res.json())?.searchid;
    if (id && id !== wcSearch) {
      wcSearch = id;
      const def = app.layers.get("worldcover");
      if (def && app.layers.isOn("worldcover")) def._setTiles(map, def.tileUrl(null, "{z}", "{x}", "{y}"));
    }
  } catch { /* the stored search id keeps working */ }
}

/* ---------------------------------------------------------------- Natural Earth */
const neCache = new Map();
function loadGeo(url) {
  if (!neCache.has(url)) {
    neCache.set(url, getJSON(url, { timeout: 45000 }).catch((err) => {
      neCache.delete(url);
      const code = /answered (\d+)/.exec(err.message)?.[1];
      const why = /timed out/.test(err.message) ? "timed out" : code ? `server error ${code}` : "network error";
      throw new Error(`the Natural Earth data did not download (${why}). Try again.`);
    }));
  }
  return neCache.get(url);
}
// The same rule as enName(): keep "Lake Superior" whole when name_en is only "Superior".
const NE_NAME = ["let", "n", ["coalesce", ["get", "name"], ""], "en", ["coalesce", ["get", "name_en"], ""],
  ["case", ["any", ["==", ["var", "en"], ""], ["in", ["downcase", ["var", "en"]], ["downcase", ["var", "n"]]]], ["var", "n"], ["var", "en"]]];
const NE_LABEL = { "text-halo-color": "rgba(0,0,0,0.78)", "text-halo-width": 1.3 };
const hoverCase = (on, off) => ["case", ["boolean", ["feature-state", "hover"], false], on, off];
const REGION_COLOR = ["match", ["get", "FEATURECLA"],
  ["Range/mtn", "Foothills"], "#ffc27a", ["Desert"], "#ffe08a", ["Plateau", "Tundra"], "#e6b98f",
  ["Basin", "Valley", "Lowland", "Plain", "Gorge"], "#b5e6a1", ["Delta", "Wetlands", "Lake"], "#8fd0ff", "#e2d6ff"];
// Invisible wide line under a thin one, so rivers and reefs are easy to click and hover.
const hitLine = (id, src) => ({ id, type: "line", source: src, paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 12 } });
const TZ_COLORS = ["match", ["get", "map_color8"], 1, "#8fb8ff", 2, "#ffd28a", 3, "#a8e6a1", 4, "#ffa8a8", 5, "#d0b3ff", 6, "#8fe3e0", 7, "#ffe98a", 8, "#ffb8e0", "#dddddd"];

// Each Natural Earth layer: where the data lives, how it is drawn, how its card reads.
// `layers(src, v)` returns MapLibre layers at opacity v; ids starting "cat-i-" are clickable.
const NE_LAYERS = [
  {
    id: "ne-countries", title: "Countries", scale: "1:50m", files: ["ne_50m_admin_0_countries"], sub: "Borders, population, GDP",
    keywords: ["countries", "borders", "boundaries", "nations", "political", "admin 0"],
    description: "Every country and dependency (Natural Earth 1:50m) with its population estimate, GDP, region and income group. Click a country for its card.",
    legend: [["#ffffff", "Country border"]],
    layers: (src, v) => [
      { id: "cat-i-ne-countries-fill", type: "fill", source: src, paint: { "fill-color": "#ffffff", "fill-opacity": hoverCase(0.16 * v, 0.02 * v) } },
      { id: "cat-i-ne-countries-line", type: "line", source: src, paint: { "line-color": "#ffffff", "line-opacity": 0.85 * v, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.6] } },
    ],
  },
  {
    id: "ne-admin1", title: "States & provinces", scale: "1:10m", url: DATA_ADMIN1, sub: "First-level divisions worldwide",
    keywords: ["states", "provinces", "regions", "admin 1", "subdivisions", "counties", "prefectures", "boundaries"],
    description: "4,500+ first-level divisions (states, provinces, regions) of every country, from Natural Earth 1:10m, simplified by Baryon for fast loading. Click one for its card.",
    note: "geometry simplified by Baryon for fast loading",
    legend: [["rgba(255,255,255,0.7)", "State / province boundary"]],
    layers: (src, v) => [
      { id: "cat-i-ne-admin1-fill", type: "fill", source: src, paint: { "fill-color": "#ffffff", "fill-opacity": hoverCase(0.16 * v, 0.02 * v) } },
      { id: "cat-i-ne-admin1-line", type: "line", source: src, paint: { "line-color": "#ffffff", "line-opacity": 0.55 * v, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 7, 1.1], "line-dasharray": [3, 2] } },
    ],
  },
  {
    id: "ne-rivers", title: "Rivers & lake centrelines", scale: "1:50m", files: ["ne_50m_rivers_lake_centerlines"], sub: "Major rivers worldwide",
    keywords: ["rivers", "river", "streams", "waterways", "hydrology", "lake centerlines", "lake centrelines"],
    description: "The world's major rivers and the centrelines of large lakes (Natural Earth 1:50m), named where known. Click a river for its card.",
    legend: [["#5fb6ff", "River"]],
    layers: (src, v) => [
      hitLine("cat-i-ne-rivers-hit", src),
      { id: "cat-i-ne-rivers-line", type: "line", source: src, layout: { "line-cap": "round", "line-join": "round" }, paint: {
        "line-color": hoverCase("#bfe4ff", "#5fb6ff"), "line-opacity": 0.95 * v,
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, ["max", 0.5, ["-", 1.6, ["*", 0.18, ["get", "scalerank"]]]], 7, ["max", 1.2, ["-", 3.6, ["*", 0.35, ["get", "scalerank"]]]]] } },
      { id: "cat-i-ne-rivers-label", type: "symbol", source: src, minzoom: 4, layout: { "symbol-placement": "line", "text-field": NE_NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-letter-spacing": 0.05 }, paint: { "text-color": "#cfeaff", "text-opacity": v, ...NE_LABEL } },
    ],
  },
  {
    id: "ne-lakes", title: "Lakes & reservoirs", scale: "1:50m", files: ["ne_50m_lakes"], sub: "Named lakes worldwide",
    keywords: ["lakes", "lake", "reservoirs", "inland water", "freshwater"],
    description: "Large lakes and reservoirs (Natural Earth 1:50m) with their names and a link to Wikidata. Click a lake for its card.",
    legend: [["#3d8fd6", "Lake"]],
    layers: (src, v) => [
      { id: "cat-i-ne-lakes-fill", type: "fill", source: src, paint: { "fill-color": "#3d8fd6", "fill-opacity": hoverCase(0.8 * v, 0.55 * v), "fill-outline-color": "#9fd3ff" } },
      { id: "cat-i-ne-lakes-label", type: "symbol", source: src, minzoom: 3.5, layout: { "text-field": NE_NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-max-width": 7 }, paint: { "text-color": "#d6ecff", "text-opacity": v, ...NE_LABEL } },
    ],
  },
  {
    id: "ne-glaciers", title: "Glaciated areas", scale: "1:50m", files: ["ne_50m_glaciated_areas"], sub: "Ice caps and glaciers",
    keywords: ["glaciers", "glacier", "ice caps", "ice sheet", "glaciated", "ice"],
    description: "Glaciers, ice caps and ice sheets on land (Natural Earth 1:50m).",
    legend: [["#e3f4ff", "Glaciated area"]],
    layers: (src, v) => [
      { id: "cat-i-ne-glaciers-fill", type: "fill", source: src, paint: { "fill-color": "#e3f4ff", "fill-opacity": hoverCase(0.85 * v, 0.6 * v), "fill-outline-color": "#ffffff" } },
    ],
  },
  {
    id: "ne-reefs", title: "Coral reefs", scale: "1:10m", files: ["ne_10m_reefs"], sub: "Reef lines worldwide",
    keywords: ["reefs", "reef", "coral", "coral reefs", "atolls", "great barrier reef"],
    description: "Coral and other reefs drawn as lines (Natural Earth 1:10m). Zoom into the tropics to see them.",
    legend: [["#ff8a7a", "Reef"]],
    layers: (src, v) => [
      hitLine("cat-i-ne-reefs-hit", src),
      { id: "cat-i-ne-reefs-line", type: "line", source: src, layout: { "line-cap": "round" }, paint: { "line-color": hoverCase("#ffd0c8", "#ff8a7a"), "line-opacity": v, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 8, 2.6] } },
    ],
  },
  {
    id: "ne-timezones", title: "Time zones", scale: "1:10m", files: ["ne_10m_time_zones"], sub: "Offsets from UTC",
    keywords: ["time zones", "timezones", "time zone", "utc", "gmt", "offset", "clock"],
    description: "Standard time zones and their offsets from UTC (Natural Earth 1:10m). Daylight-saving rules change; check official sources for legal time.",
    legend: [["#8fb8ff", "Time zone (colours only separate neighbours)"]],
    layers: (src, v) => [
      { id: "cat-i-ne-tz-fill", type: "fill", source: src, paint: { "fill-color": TZ_COLORS, "fill-opacity": hoverCase(0.34 * v, 0.16 * v) } },
      { id: "cat-i-ne-tz-line", type: "line", source: src, paint: { "line-color": "#ffffff", "line-opacity": 0.4 * v, "line-width": 0.8 } },
      { id: "cat-i-ne-tz-label", type: "symbol", source: src, layout: { "text-field": ["get", "utc_format"], "text-font": ["Noto Sans Bold"], "text-size": 11, "symbol-placement": "point" }, paint: { "text-color": "#ffffff", "text-opacity": v, ...NE_LABEL } },
    ],
  },
  {
    id: "ne-regions", title: "Mountains, deserts & regions", scale: "1:50m", sub: "Named physical regions and peaks",
    files: ["ne_50m_geography_regions_polys", "ne_50m_geography_regions_points", "ne_50m_geography_regions_elevation_points"],
    keywords: ["mountains", "mountain ranges", "ranges", "deserts", "basins", "plateaus", "plains", "peninsulas", "peaks", "physical geography", "regions", "landforms"],
    description: "Named physical regions from Natural Earth 1:50m: mountain ranges, deserts, basins, plateaus, plains, deltas and peninsulas, plus major peaks with their elevations, capes and waterfalls.",
    legend: [["#ffc27a", "Mountain range"], ["#ffe08a", "Desert"], ["#e6b98f", "Plateau"], ["#b5e6a1", "Basin / plain"], ["#8fd0ff", "Delta / wetland"], ["#e2d6ff", "Island, coast, other"]],
    layers: (src, v) => {
      const polys = ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "FEATURECLA"], "Continent"]];
      return [
        { id: "cat-i-ne-regions-fill", type: "fill", source: src, filter: polys, paint: { "fill-color": REGION_COLOR, "fill-opacity": hoverCase(0.28 * v, 0.07 * v) } },
        { id: "cat-i-ne-regions-line", type: "line", source: src, filter: polys, paint: { "line-color": REGION_COLOR, "line-opacity": 0.75 * v, "line-width": 1, "line-dasharray": [2, 2] } },
        { id: "cat-i-ne-regions-label", type: "symbol", source: src, filter: polys, layout: {
          "text-field": ["coalesce", ["get", "NAME_EN"], ["get", "NAME"]], "text-font": ["Noto Sans Italic"], "text-transform": "uppercase", "text-letter-spacing": 0.14,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 6, 13], "text-max-width": 9, "symbol-sort-key": ["get", "SCALERANK"] },
          paint: { "text-color": REGION_COLOR, "text-opacity": v, ...NE_LABEL } },
        { id: "cat-i-ne-regions-dot", type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 8, 4.5], "circle-color": ["case", ["has", "elevation"], "#ffc27a", "#e2d6ff"],
          "circle-stroke-color": "rgba(0,0,0,0.7)", "circle-stroke-width": 1, "circle-opacity": v, "circle-stroke-opacity": v } },
        { id: "cat-i-ne-regions-peak", type: "symbol", source: src, filter: ["==", ["geometry-type"], "Point"], minzoom: 2.5, layout: {
          "text-field": ["case", ["has", "elevation"], ["format", ["coalesce", ["get", "name_en"], ["get", "name"]], {}, "\n", {}, ["concat", ["number-format", ["get", "elevation"], { locale: "en-US" }], " m"], { "font-scale": 0.85 }], ["coalesce", ["get", "name_en"], ["get", "name"]]],
          "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8 },
          paint: { "text-color": "#fff4e0", "text-opacity": v, ...NE_LABEL } },
      ];
    },
  },
  {
    id: "ne-places", title: "Cities & towns", scale: "1:10m", files: ["ne_10m_populated_places_simple"], sub: "7,342 places with populations",
    keywords: ["cities", "towns", "populated places", "capitals", "settlements", "urban", "population", "megacities"],
    description: "7,342 cities, towns and capitals from Natural Earth 1:10m with population estimates; the largest show first as you zoom in. Click a place for its card.",
    legend: [["#ffffff", "City (size by population)"], ["#ffd166", "National capital"]],
    layers: (src, v) => {
      const circle = (id, filter, minzoom) => ({ id, type: "circle", source: src, filter, minzoom, paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["step", ["get", "pop_max"], 1.6, 1e6, 2.6, 5e6, 3.6, 1e7, 4.6], 8, ["step", ["get", "pop_max"], 3, 1e5, 4, 1e6, 5.5, 1e7, 7]],
        "circle-color": ["case", ["==", ["get", "adm0cap"], 1], "#ffd166", "#ffffff"], "circle-opacity": hoverCase(v, 0.9 * v),
        "circle-stroke-color": "rgba(0,0,0,0.75)", "circle-stroke-width": 1, "circle-stroke-opacity": v } });
      return [
        circle("cat-i-ne-places-major", ["<=", ["get", "scalerank"], 2], 0),
        circle("cat-i-ne-places-mid", ["all", [">", ["get", "scalerank"], 2], ["<=", ["get", "scalerank"], 5]], 3.5),
        circle("cat-i-ne-places-minor", [">", ["get", "scalerank"], 5], 5.5),
        { id: "cat-i-ne-places-label", type: "symbol", source: src, filter: ["<=", ["get", "scalerank"], 7], layout: {
          "text-field": ["get", "name"], "text-font": ["case", ["==", ["get", "adm0cap"], 1], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, ["-", 13, ["*", 0.4, ["get", "scalerank"]]], 8, ["-", 16, ["*", 0.4, ["get", "scalerank"]]]],
          "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.7, "text-justify": "auto", "symbol-sort-key": ["get", "scalerank"] },
          paint: { "text-color": "#ffffff", "text-opacity": v, ...NE_LABEL } },
      ];
    },
  },
];

function neDef(o) {
  const src = `cat-ne-${o.id.slice(3)}`;
  const urls = o.url ? [o.url] : o.files.map((f) => `${NE_CDN}${f}.geojson`);
  const def = {
    id: o.id, curated: true, title: o.title, sub: o.sub, category: "Reference", description: o.description, keywords: [...o.keywords, "natural earth"],
    source: `Natural Earth ${o.scale}`, attribution: "Made with Natural Earth", license: LIC.pd, kind: "geojson", slot: "data",
    legendHtml: swatches(o.legend, "line"), detail: `Natural Earth ${o.scale}, v5.1.2`, ne: o, sampleUrl: urls[0],
    async add(map) {
      const data = await neData(o, urls);
      if (!app.layers.isOn(o.id) || map.getSource(src)) return;
      map.addSource(src, { type: "geojson", data, promoteId: "_i", tolerance: 0.45 });
      const v = opacity.get(o.id) ?? 1;
      // Fills and lines sit just above the imagery and science overlays, under the place labels;
      // symbols and points go above the labels so they stay readable.
      for (const l of o.layers(src, v)) map.addLayer(l, l.type === "symbol" || l.type === "circle" ? app.layers.anchor("data") : neBefore(map, l.type));
    },
    remove(map) {
      for (const l of o.layers(src, 1)) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(src)) map.removeSource(src);
    },
    setOpacity(map, v) {
      opacity.set(o.id, v);
      for (const l of o.layers(src, v)) {
        if (!map.getLayer(l.id)) continue;
        for (const [k, val] of Object.entries(l.paint ?? {})) if (k.endsWith("-opacity")) map.setPaintProperty(l.id, k, val);
      }
    },
  };
  return def;
}
async function neData(o, urls) {
  const parts = await Promise.all(urls.map(loadGeo));
  if (o._fc) return o._fc;
  const features = [];
  for (const fc of parts) for (const f of fc.features ?? []) if (f.geometry) features.push({ ...f, properties: { ...f.properties, _i: features.length } });
  o._fc = { type: "FeatureCollection", features };
  return o._fc;
}
/** Natural Earth fills and lines form one band right above the overlay anchor: fills under
 *  lines (so a river over a country stays clickable), the newest of each kind on top. */
function neBefore(map, type) {
  const rank = type === "fill" ? 0 : 1;
  const layers = map.getStyle().layers;
  for (let i = layers.findIndex((l) => l.id === app.layers.anchor("overlay")) + 1; i < layers.length; i++) {
    const l = layers[i];
    if (!l.id.startsWith("cat-i-ne-") || (l.type === "fill" ? 0 : 1) > rank) return l.id;
  }
  return app.layers.anchor("labels");
}

/* ---------------------------------------------------------------- Natural Earth cards */
const stripRank = (s) => String(s ?? "").replace(/^\d+\.\s*/, "");
const REGION_WORD = { "Range/mtn": "Mountain range", "Pen/cape": "Peninsula or cape", Geoarea: "Geographic area", mountain: "Mountain", depression: "Depression", pass: "Mountain pass", waterfall: "Waterfall", cape: "Cape", island: "Island", pole: "Pole", plain: "Plain" };
const PLACE_WORD = { "Admin-0 capital": "National capital", "Admin-0 capital alt": "National capital (alternate)", "Admin-1 capital": "State or provincial capital", "Admin-1 region capital": "Regional capital", "Admin-0 region capital": "Regional capital", "Populated place": "City or town", "Populated Place": "City or town" };
const money = (musd) => (musd >= 1e6 ? `US$${fmt(musd / 1e6, 2)} trillion` : musd >= 1e3 ? `US$${fmt(musd / 1e3, 1)} billion` : `US$${fmt(musd)} million`);
const signed = (s) => String(s ?? "").replace(/-/g, "−");
/** Natural Earth's name_en is sometimes a fragment of name ("Superior" / "Lake Superior"). */
function enName(p) {
  const n = p.name || null, en = p.name_en || null;
  if (!en || (n && n.toLowerCase().includes(en.toLowerCase()))) return { title: n ?? en, local: null };
  return { title: en, local: n && n !== en ? n : null };
}

function neCardContent(defId, p) {
  const rows = [];
  const add = (k, v) => { if (v != null && v !== "" && v !== -99 && v !== "-99") rows.push([k, v]); };
  let eyebrow = "Natural Earth", title = p.name ?? p.NAME ?? "Unnamed", sub = "", wikidata = p.wikidataid ?? p.WIKIDATAID ?? null;
  if (defId === "ne-countries") {
    eyebrow = p.TYPE ?? "Country"; title = p.NAME_LONG ?? p.NAME; sub = p.FORMAL_EN && p.FORMAL_EN !== title ? p.FORMAL_EN : "";
    if (p.SOVEREIGNT && p.ADMIN && p.SOVEREIGNT !== p.ADMIN) add("Sovereign state", p.SOVEREIGNT);
    add("Continent", p.CONTINENT); add("Region", p.SUBREGION);
    if (p.POP_EST > 0) add("Population", `${fmt(p.POP_EST)} (${p.POP_YEAR} est.)`);
    if (p.GDP_MD > 0) add("GDP", `${money(p.GDP_MD)} (${p.GDP_YEAR})`);
    if (p.POP_EST > 0 && p.GDP_MD > 0) add("GDP per person", `US$${fmt((p.GDP_MD * 1e6) / p.POP_EST)}`);
    add("Economy", stripRank(p.ECONOMY)); add("Income group", stripRank(p.INCOME_GRP));
    add("ISO codes", [p.ISO_A3_EH ?? p.ISO_A3, p.ISO_A2_EH ?? p.ISO_A2].filter((x) => x && x !== "-99").join(" · "));
  } else if (defId === "ne-admin1") {
    eyebrow = p.t ?? "First-level division"; title = p.n; sub = p.e ? p.e : "";
    add("Country", p.c); add("Region", p.r); add("ISO 3166-2", p.i);
  } else if (defId === "ne-rivers") {
    const n = enName(p);
    eyebrow = p.featurecla ?? "River"; title = n.title ?? "Unnamed river";
    add("Local name", n.local); add("Also called", p.name_alt);
  } else if (defId === "ne-lakes") {
    const n = enName(p);
    eyebrow = p.featurecla === "Reservoir" ? "Reservoir" : "Lake"; title = n.title ?? "Unnamed lake";
    add("Local name", n.local); add("Also called", p.name_alt);
  } else if (defId === "ne-glaciers") {
    eyebrow = "Glaciated area"; title = p.name ?? "Glacier or ice cap";
  } else if (defId === "ne-reefs") {
    eyebrow = "Reef"; title = p.name ?? "Reef";
  } else if (defId === "ne-timezones") {
    eyebrow = "Time zone"; title = signed(p.utc_format ?? `UTC${p.zone >= 0 ? "+" : ""}${p.zone}`);
    const list = (s) => (s ? String(s).replace(/[\s,;]+$/, "") : null);
    add("Offset", `${p.zone >= 0 ? "+" : "−"}${Math.abs(p.zone)} h from UTC`); add("Places", list(p.places)); add("Daylight saving", list(p.dst_places));
  } else if (defId === "ne-regions") {
    const cls = p.FEATURECLA ?? p.featurecla;
    eyebrow = REGION_WORD[cls] ?? cls ?? "Region"; title = p.NAME_EN ?? p.name_en ?? p.NAME ?? p.name ?? "Unnamed";
    title = title === title.toUpperCase() ? title.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : title;
    if (p.elevation != null) add(cls === "depression" ? "Elevation (below sea level)" : "Elevation", `${fmt(p.elevation)} m`);
    add("Region", p.REGION ?? p.region); add("Subregion", p.SUBREGION ?? p.subregion); add("Note", p.comment);
  } else if (defId === "ne-places") {
    eyebrow = PLACE_WORD[p.featurecla] ?? p.featurecla ?? "Place"; title = p.name;
    sub = [p.adm1name, p.adm0name].filter(Boolean).join(", ");
    if (p.pop_max > 0) add("Population", p.pop_min > 0 && p.pop_min < p.pop_max ? `${fmt(p.pop_min)} – ${fmt(p.pop_max)} (Natural Earth estimates)` : `${fmt(p.pop_max)} (Natural Earth estimate)`);
    if (p.megacity === 1) add("Megacity", "Yes (10 million or more)");
    add("Coordinates", p.latitude != null ? `${(+p.latitude).toFixed(4)}, ${(+p.longitude).toFixed(4)}` : null);
  }
  return { eyebrow, title, sub, rows, wikidata };
}

function featureBBox(f) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  walk(f.geometry.coordinates);
  return b;
}

let hovered = null;
function setHover(next) {
  const map = app.map;
  if (hovered && (!next || hovered.source !== next.source || hovered.id !== next.id)) {
    if (map.getSource(hovered.source)) map.setFeatureState(hovered, { hover: false });
    hovered = null;
  }
  if (next && !hovered) { hovered = next; map.setFeatureState(next, { hover: true }); }
}
const neLayerIds = () => NE_LAYERS.filter((o) => app.layers.isOn(o.id)).flatMap((o) => o.layers(`cat-ne-${o.id.slice(3)}`, 1).map((l) => l.id)).filter((id) => app.map.getLayer(id));
function neHit(point) {
  const layers = neLayerIds();
  if (!layers.length) return null;
  // Only the topmost clickable feature answers, so a volcano or aircraft drawn over a
  // country opens its own card rather than both.
  const top = app.map.queryRenderedFeatures(point).find((f) => INTERACTIVE.some((p) => f.layer.id.startsWith(p)));
  return top && layers.includes(top.layer.id) ? top : null;
}
function wireNaturalEarthInteraction() {
  const map = app.map;
  let raf = 0, cursorMine = false;
  map.on("mousemove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const f = neHit(e.point);
      if (f) {
        map.getCanvas().style.cursor = "pointer";
        cursorMine = true;
        setHover(f.id != null ? { source: f.source, id: f.id } : null);
      } else {
        if (cursorMine) map.getCanvas().style.cursor = "";
        cursorMine = false;
        setHover(null);
      }
    });
  });
  map.on("mouseout", () => { setHover(null); });
  map.on("click", (e) => {
    if (app.mode && app.mode !== "explore") return;
    const f = neHit(e.point);
    if (f) showNeCard(f, e.lngLat);
  });
}
function showNeCard(f, lngLat) {
  const o = NE_LAYERS.find((x) => f.source === `cat-ne-${x.id.slice(3)}`);
  if (!o) return;
  const full = o._fc?.features[f.properties._i] ?? f;
  const c = neCardContent(o.id, full.properties);
  const at = { lat: +lngLat.lat.toFixed(5), lng: +lngLat.lng.toFixed(5) };
  app.ui.showCard(`
    <div class="eyebrow">${esc(c.eyebrow)}</div>
    <h3>${esc(c.title)}</h3>
    ${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}
    ${c.rows.length ? `<dl class="kv" style="margin-top:14px">${c.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" type="button" data-act="zoom">Zoom to</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="here">What's here</button>
      ${c.wikidata ? `<a class="btn btn-ghost btn-sm" href="https://www.wikidata.org/wiki/${encodeURIComponent(c.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ""}
    </div>
    <p class="note">Source: Natural Earth ${esc(o.scale)} (public domain), v5.1.2${o.note ? ` · ${esc(o.note)}` : ""}.</p>`);
  const body = $("#card-body");
  body.querySelector('[data-act="zoom"]').onclick = () => {
    const b = featureBBox(full);
    if (b[0] === b[2] && b[1] === b[3]) app.map.flyTo({ center: [b[0], b[1]], zoom: Math.max(app.map.getZoom(), 8), speed: 1.3 });
    else app.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 9, speed: 1.3 });
  };
  body.querySelector('[data-act="here"]').onclick = () => app.tools.run("get_place_info", at).catch(() => {});
}

/* ---------------------------------------------------------------- collections */
// A featured GIBS layer: GIBS id + curated title and copy. Plain strings are curated ids.
const G = (gibsId, o) => ({ gibsId, ...o });
const COLLECTIONS = [
  { id: "today", title: "Today from space", sub: "Yesterday's whole planet, and geostationary views every 10 minutes", icon: "orbit", items: [
    G("VIIRS_NOAA20_CorrectedReflectance_TrueColor", { title: "True colour · VIIRS NOAA-20", keywords: ["satellite", "true colour", "true color", "today", "yesterday", "clouds", "photo", "viirs", "noaa-20"],
      description: "A natural-colour picture of the whole Earth assembled from one day of passes by the VIIRS instrument on NOAA-20. Today's mosaic fills in during the day, so the layer opens on yesterday; use the time slider to go back to January 2018." }),
    G("VIIRS_SNPP_CorrectedReflectance_TrueColor", { title: "True colour · VIIRS Suomi NPP", keywords: ["satellite", "true colour", "true color", "viirs", "suomi npp"],
      description: "Daily natural-colour mosaic from VIIRS on Suomi NPP, the longest VIIRS record (since 24 November 2015). Wide swaths leave almost no gaps between orbits." }),
    G("MODIS_Terra_CorrectedReflectance_TrueColor", { title: "True colour · MODIS Terra", keywords: ["satellite", "true colour", "true color", "modis", "terra", "history", "archive"],
      description: "MODIS on Terra, crossing the equator around 10:30 local time each morning, daily since 24 February 2000 — the longest daily true-colour record and the best layer for going back in time. Thin wedges between orbits near the equator have no data." }),
    G("MODIS_Aqua_CorrectedReflectance_TrueColor", { title: "True colour · MODIS Aqua", keywords: ["satellite", "true colour", "true color", "modis", "aqua"],
      description: "MODIS on Aqua, the afternoon pass (around 13:30 local time), daily since 3 July 2002." }),
    G("GOES-East_ABI_GeoColor", { title: "Live Earth · GOES-East GeoColor", keywords: ["goes-east", "goes east", "live", "geostationary", "goes", "americas", "atlantic", "hurricane", "now", "real time", "weather satellite"],
      description: "NOAA's GOES-East geostationary satellite images the Americas and the Atlantic every 10 minutes: true colour by day, infrared clouds and city lights by night. Opens on the latest scan. GIBS keeps older 10-minute scans only with gaps, so many past times have no imagery." }),
    G("GOES-West_ABI_GeoColor", { title: "Live Earth · GOES-West GeoColor", keywords: ["goes-west", "goes west", "live", "geostationary", "goes", "pacific", "now", "real time", "weather satellite"],
      description: "GOES-West covers the eastern Pacific and western Americas every 10 minutes, with the same day/night GeoColor rendering as GOES-East. GIBS keeps older 10-minute scans only with gaps, so many past times have no imagery." }),
    G("Himawari_AHI_Band13_Clean_Infrared", { title: "Clouds · Himawari infrared", keywords: ["live", "himawari", "japan", "asia", "pacific", "typhoon", "infrared", "geostationary"],
      description: "Japan's Himawari geostationary satellite over East Asia, Australia and the western Pacific: 10.3 µm infrared every 10 minutes, so clouds show day and night. GIBS has no Himawari true-colour layer. GIBS keeps older 10-minute scans only with gaps, so many past times have no imagery." }),
    G("HLS_L30_Nadir_BRDF_Adjusted_Reflectance", { title: "Landsat 30 m · HLS", keywords: ["landsat", "30 m", "high resolution", "hls", "sentinel"],
      description: "NASA's Harmonized Landsat Sentinel-2 product: 30 m Landsat 8/9 surface reflectance, the sharpest NASA true colour (to zoom 12). Each day covers only that day's swaths, so step back a few days if your area is empty." }),
  ] },
  { id: "weather", title: "Weather & atmosphere", sub: "Rain, clouds, vapour, smoke and air quality", icon: "cloud", items: [
    G("IMERG_Precipitation_Rate", { title: "Rain & snow · IMERG daily", keywords: ["rain", "rainfall", "precipitation", "snowfall", "gpm", "imerg", "storms"],
      description: "Precipitation rate from NASA's GPM IMERG, which merges microwave and infrared satellite estimates, daily since June 2000." }),
    G("IMERG_Precipitation_Rate_30min", { title: "Rain & snow · IMERG 30-minute", keywords: ["rain", "precipitation", "live", "storm tracking", "gpm", "imerg", "radar"],
      description: "Near-real-time precipitation every half hour from GPM IMERG — useful for following storms." }),
    G("MODIS_Terra_Cloud_Top_Temp_Day", { title: "Cloud-top temperature", keywords: ["clouds", "cloud top", "storms", "convection", "thunderstorms"],
      description: "How cold the tops of clouds are (MODIS Terra, daytime). Colder tops are higher, often stormier clouds." }),
    G("MODIS_Terra_Cloud_Fraction_Day", { title: "Cloud cover", keywords: ["clouds", "cloud cover", "cloudiness", "overcast"],
      description: "The fraction of each area covered by cloud, from MODIS Terra's daytime pass." }),
    G("MODIS_Terra_Water_Vapor_5km_Day", { title: "Water vapour", keywords: ["water vapour", "water vapor", "humidity", "moisture"],
      description: "Total column water vapour from MODIS Terra's infrared retrievals, daytime, at about 5 km." }),
    G("MODIS_Combined_Value_Added_AOD", { title: "Aerosols · smoke, dust & haze", keywords: ["aerosols", "aerosol", "aerosol optical depth", "smoke", "dust", "haze", "air quality", "wildfire smoke", "pollution", "aod"],
      description: "Aerosol optical depth merged from MODIS on Terra and Aqua: how much sunlight smoke, dust, haze and pollution block." }),
    G("AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day", { title: "Carbon monoxide · AIRS", keywords: ["carbon monoxide", "co", "smoke", "pollution", "air quality", "airs"],
      description: "Carbon monoxide in the mid-troposphere (500 hPa) from AIRS on Aqua — traces smoke and pollution as they travel between continents." }),
    G("OMPS_Ozone_Total_Column", { title: "Ozone · OMPS total column", keywords: ["ozone", "ozone hole", "ozone layer", "total ozone", "omps", "dobson"],
      description: "Total column ozone from the OMPS Nadir Mapper on Suomi NPP, daily since January 2012 — the ozone layer and, each southern spring, the Antarctic ozone hole." }),
    G("TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column", { title: "Nitrogen dioxide · TROPOMI", keywords: ["no2", "nitrogen dioxide", "pollution", "air quality", "traffic", "power plants", "tropomi", "sentinel-5p"],
      description: "Tropospheric nitrogen dioxide from TROPOMI on Sentinel-5P — cities, power plants, industry and shipping lanes stand out." }),
  ] },
  { id: "oceans", title: "Oceans", sub: "Sea temperature, ocean colour, ice and the shape of the seafloor", icon: "wave", items: [
    G("GHRSST_L4_MUR_Sea_Surface_Temperature", { title: "Sea surface temperature · MUR", keywords: ["sst", "sea surface temperature", "ocean temperature", "sea temperature", "gulf stream", "mur", "ghrsst"],
      description: "Gap-free daily sea-surface temperature at about 1 km from the GHRSST MUR analysis, since June 2002." }),
    G("GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies", { title: "Sea temperature anomaly", keywords: ["sst anomaly", "marine heatwave", "el nino", "la nina", "ocean warming", "anomaly"],
      description: "How much warmer or cooler the sea surface is than normal for the date — marine heatwaves, El Niño and La Niña." }),
    G("VIIRS_NOAA20_Chlorophyll_a", { title: "Ocean chlorophyll · VIIRS", keywords: ["chlorophyll", "phytoplankton", "algae", "ocean colour", "ocean color", "algal bloom"],
      description: "Chlorophyll-a concentration, a measure of phytoplankton, from VIIRS on NOAA-20. Daily swaths have gaps under cloud." }),
    G("GHRSST_L4_MUR_Sea_Ice_Concentration", { title: "Sea ice", keywords: ["sea ice", "arctic", "antarctic", "polar", "ice extent", "ice concentration"],
      description: "Daily sea-ice concentration around both poles from the GHRSST MUR analysis." }),
    G("SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean", { title: "Sea surface salinity · SMAP", keywords: ["salinity", "salt", "sss", "smap"],
      description: "Sea-surface salinity from NASA's SMAP satellite, as an 8-day running mean." }),
    "gebco-ncei", "emodnet-bathymetry", "gebco-wms",
  ] },
  { id: "land", title: "Land", sub: "Land cover, vegetation, snow, heat and fire", icon: "leaf", items: [
    "worldcover",
    G("MODIS_Terra_L3_NDVI_16Day", { title: "Vegetation greenness · NDVI", keywords: ["ndvi", "vegetation", "greenness", "plants", "crops", "drought", "forest"],
      description: "Normalised Difference Vegetation Index from MODIS Terra in 16-day composites since 2000 — how green and dense vegetation is. Any date shows the composite that contains it." }),
    G("MODIS_Terra_NDSI_Snow_Cover", { title: "Snow cover", keywords: ["snow", "snow cover", "winter", "ndsi"],
      description: "Daily snow cover (NDSI) from MODIS Terra since 2000. Clouds hide the ground, so daily maps have gaps." }),
    G("MODIS_Terra_L3_Land_Surface_Temp_8Day_Day", { title: "Land surface temperature", keywords: ["land surface temperature", "lst", "heat", "ground temperature", "heatwave", "urban heat"],
      description: "Daytime temperature of the ground surface itself (not the air), 8-day composites from MODIS Terra since 2000." }),
    "fires-viirs",
    G("GOES-East_ABI_FireTemp", { title: "Fire temperature · GOES-East", keywords: ["fire", "fires", "wildfire", "live", "goes", "americas"],
      description: "GOES-East fire-temperature RGB every 10 minutes over the Americas: active fires glow from red to yellow and white as they burn hotter." }),
    G("MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual", { title: "Land cover by year · MODIS", keywords: ["land cover", "land use", "igbp", "annual", "change", "deforestation"],
      description: "MODIS land-cover type (IGBP classes), one map per year from 2001 to 2024 — step through the years to see change." }),
    G("SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", { title: "Soil moisture · SMAP", keywords: ["soil moisture", "drought", "agriculture", "smap", "wetness"],
      description: "Modelled root-zone soil moisture from NASA's SMAP Level 4 analysis, daily since March 2015 — a drought and farming indicator." }),
    G("MODIS_Combined_Flood_2-Day", { title: "Floods · 2-day", keywords: ["flood", "floods", "flooding", "inundation", "disaster"],
      description: "Near-real-time flood water mapped from MODIS Terra and Aqua over a 2-day window, since 2021." }),
  ] },
  { id: "geology", title: "Geology & terrain", sub: "Bedrock, elevation and named landforms", icon: "strata", items: [
    "macrostrat",
    G("ASTER_GDEM_Color_Shaded_Relief", { title: "Elevation · ASTER 30 m relief", keywords: ["elevation", "relief", "dem", "terrain", "altitude", "height", "aster", "topography"],
      description: "The ASTER global digital elevation model (30 m) as colour shaded relief, to zoom 12." }),
    "ne-regions",
  ] },
  { id: "people", title: "People & night", sub: "Where people live, seen by census and by night lights", icon: "people", items: [
    G("GPW_Population_Density_2020", { title: "Population density 2020", keywords: ["population", "people", "density", "census", "gpw", "demographics"],
      source: "CIESIN GPW v4 (NASA SEDAC) via NASA GIBS", attribution: "CIESIN, Columbia University: Gridded Population of the World v4 (NASA SEDAC) · NASA GIBS", license: LIC.gpw,
      description: "People per square kilometre in 2020 from CIESIN's Gridded Population of the World, version 4, distributed by NASA SEDAC." }),
    G("VIIRS_Black_Marble", { title: "Night lights · Black Marble", keywords: ["night lights", "city lights", "black marble", "night", "electricity", "lights"],
      description: "NASA's cloud-free composite of Earth at night from VIIRS. Step between the 2012 and 2016 editions to see change." }),
    G("VIIRS_SNPP_DayNightBand_At_Sensor_Radiance", { title: "Last night · VIIRS day/night band", keywords: ["night", "last night", "power outage", "blackout", "moonlight", "day/night band"],
      description: "Last night's lights, moonlit clouds and power outages from the VIIRS day/night band on Suomi NPP, daily since November 2020." }),
    "ne-places",
  ] },
  { id: "reference", title: "Topographic & reference", sub: "Topo maps, sea marks, borders, rivers, lakes, reefs and time zones", icon: "map", items: [
    "usgs-topo", "openseamap", "ne-countries", "ne-admin1", "ne-rivers", "ne-lakes", "ne-glaciers", "ne-reefs", "ne-timezones",
  ] },
];
const itemId = (it) => (typeof it === "string" ? it : `gibs:${it.gibsId}`);
const FEATURED_IDS = new Set(COLLECTIONS.flatMap((c) => c.items.map(itemId)));

function defineCurated() {
  for (const c of COLLECTIONS) {
    for (const it of c.items) {
      if (typeof it === "string") continue;
      const m = { id: it.gibsId, title: it.title, ...FEATURED_META[it.gibsId] };
      app.layers.define(gibsDef(m, { ...it, category: c.title }));
    }
  }
  const collOf = (id) => COLLECTIONS.find((c) => c.items.includes(id))?.title;
  for (const def of curatedRasters()) app.layers.define({ ...def, category: collOf(def.id) ?? def.category });
  for (const o of NE_LAYERS) { const def = neDef(o); app.layers.define({ ...def, category: collOf(o.id) ?? def.category }); }
}

/* ---------------------------------------------------------------- full GIBS catalogue */
function loadGibs() {
  gibsPromise ??= getJSON(DATA_GIBS, { timeout: 30000 })
    .then((doc) => {
      gibsDoc = doc;
      doc.counts = {};
      for (const m of doc.layers) doc.counts[m.cat] = (doc.counts[m.cat] ?? 0) + 1;
      gibsError = null;
      return doc;
    })
    .catch((err) => { gibsPromise = null; gibsError = err.message; refreshSoon(); throw err; });
  return gibsPromise;
}
function defineGibs(ids) {
  for (const m of gibsDoc.layers) {
    const id = `gibs:${m.id}`;
    if ((!ids || ids.has(id)) && !app.layers.get(id)) app.layers.define(gibsDef(m));
  }
}
/** Define all ~1,170 layers in idle time so the omnibox and agent can find them. */
function defineGibsWhenIdle() {
  const list = gibsDoc.layers.filter((m) => !app.layers.get(`gibs:${m.id}`));
  let i = 0;
  const slice = (deadline) => {
    // Stop with ~2 ms of the idle period left; a slice forced by the timeout (or the
    // setTimeout fallback, which has no deadline) does at most 50.
    const open = deadline && !deadline.didTimeout, stop = i + 50;
    while (i < list.length) {
      const m = list[i++];
      if (!app.layers.get(`gibs:${m.id}`)) app.layers.define(gibsDef(m));
      if (open ? deadline.timeRemaining() <= 2 : i >= stop) break;
    }
    if (i < list.length) idle(slice, 2000);
    else { gibsDefined = true; refreshSoon(); app.emit("catalog:ready", { layers: gibsDoc.layers.length }); }
  };
  idle(slice, 2000);
}
async function ensureGibs() {
  await loadGibs();
  if (!gibsDefined) { defineGibs(); gibsDefined = true; }
  return gibsDoc;
}

/* ---------------------------------------------------------------- search */
const SYN = { colour: ["color"], color: ["colour"], vapour: ["vapor"], vapor: ["vapour"], sst: ["sea surface temperature"], rain: ["precip"], rainfall: ["precip"], smoke: ["aerosol", "smoke"], borders: ["countries", "border"], lights: ["light"], pollution: ["nitrogen", "aerosol", "pollution", "monoxide"], seafloor: ["bathymetry", "seafloor"], bathymetry: ["bathymetry", "seafloor"] };
const hayCache = new Map();
// Diagnostic variants rank below the headline version of the same quantity.
const TECHNICAL = /\b(?:QA|RFI|Uncertainty|Standard Error|Standard Deviation|Granules?|Vertical Profile|Count|Mask|Number of|Kernel)\b/i;
// Words match at word starts, so "rain" finds "rain rate" but not "terrain".
const norm = (s) => ` ${String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
function haystack(def) {
  let h = hayCache.get(def.id);
  if (!h) {
    h = { main: norm(`${def.title} ${def.keywords?.join(" ") ?? ""} ${def.id} ${def.source ?? ""}`), wide: norm(`${def.tags?.join(" ") ?? ""} ${def.category ?? ""}`) };
    hayCache.set(def.id, h);
  }
  return h;
}
function searchLayers(q) {
  const words = norm(q).trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const alts = words.map((w) => [w, ...(w.length > 3 && w.endsWith("s") ? [w.slice(0, -1)] : []), ...(SYN[w] ?? [])]);
  const out = [];
  for (const def of app.layers.list()) {
    if (def.hiddenFromSearch) continue;
    const h = haystack(def);
    // A layer found only through its category's words ranks below one that names the thing.
    let viaCategory = false;
    const hit = alts.every((a) => {
      if (a.some((w) => h.main.includes(` ${w}`))) return true;
      if (a.some((w) => h.wide.includes(` ${w}`))) return (viaCategory = true);
      return false;
    });
    if (!hit) continue;
    const named = Math.max(score(def.title, q), ...(def.keywords ?? []).map((k) => score(k, q) - 22));
    const s = named + (def.curated ? 25 : 0) + (app.layers.isOn(def.id) ? 8 : 0) + (def.time?.now ? 5 : 0) + (def.base ? 10 : 0) - (TECHNICAL.test(def.title) ? 12 : 0) - (viaCategory ? 40 : 0);
    out.push({ def, s });
  }
  return out.sort((a, b) => b.s - a.s || a.def.title.localeCompare(b.def.title)).map((x) => x.def);
}
/** Best layer for a free-text name (tools and the local command engine); `timed` keeps
 *  only layers with dates to choose from. */
function resolveLayer(ref, { timed = false } = {}) {
  if (!ref) return null;
  const exact = app.layers.get(ref) ?? app.layers.get(`gibs:${ref}`);
  if (exact && (!timed || timeline(exact))) return { def: exact, by: "id", score: 100 };
  const q = String(ref).toLowerCase().replace(/\b(?:layer|overlay|map|data(?:set)?|the)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  let best = null;
  for (const def of app.layers.list()) {
    if (timed && !def.time) continue;
    let s = Math.max(score(def.title, q), score(def.id.replace(/^gibs:/, "").replace(/[_-]+/g, " "), q) - 6, ...(def.keywords ?? []).map((k) => score(k, q) - 6));
    if (s <= 0 || (timed && !timeline(def))) continue;
    if (def.curated) s += 12;
    if (def.time?.now) s += 2;
    if (!best || s > best.score) best = { def, by: "name", score: s };
  }
  return best && best.score >= 38 ? best : null;
}

/* ---------------------------------------------------------------- panel */
function rowSub(def) {
  if (def.sub) return def.sub;
  const d = datesText(def);
  if (def.gibsId) return d ?? "Static";
  return [def.category, d].filter(Boolean).join(" · ");
}
const spinner = '<span class="cat-spin" aria-hidden="true"></span>';
const BASE_SUB = {
  terrain: "Mountains and seafloor in 3D", hillshade: "Shaded relief over the imagery", labels: "Places, roads and borders",
  buildings: "Extruded footprints in cities", daynight: "Night side of the Earth, live", graticule: "10° grid, equator and tropics",
};
function layerRow(def, { sub, title } = {}) {
  const on = app.layers.isOn(def.id);
  return `<button type="button" class="row-btn cat-row" data-layer="${esc(def.id)}" aria-pressed="${on}" title="${esc(def.title)}">
    <span class="grow"><div class="t">${esc(title ?? def.title)}</div><div class="s">${esc(sub ?? rowSub(def))}</div></span>
    ${busy.has(def.id) ? spinner : ""}<span class="switch" aria-hidden="true"></span></button>`;
}

const BASE_SHORT = { s2_2016: "Cloudless 2016" };
function thumbFor(id) {
  try {
    const first = IMAGERY[id].layers().find((l) => /^https:/.test(l.source?.tiles?.[0] ?? ""));
    return first ? first.source.tiles[0].replace("{z}", "3").replace("{x}", "4").replace("{y}", "2") : null;
  } catch { return null; }
}

function activeCard(id) {
  const def = app.layers.get(id);
  if (!def) return "";
  const tl = timeline(def);
  const v = Math.round((opacity.get(id) ?? def.opacity ?? 1) * 100);
  const info = openInfo.has(id);
  const p = probe.get(id);
  const cur = tl ? toMs(app.layers.timeOf(id)) : NaN;
  const actualNote = p && !p.missing && p.actual && p.requested === app.layers.timeOf(id) && p.actual !== p.requested ? `Showing ${timeLabel(toMs(p.actual), tl?.unit)}` : "";
  const missing = p?.missing && p.requested === app.layers.timeOf(id);
  const legend = def.legendUrl ? `<div class="cat-legend"><img src="${esc(def.legendUrl)}" alt="Legend for ${esc(def.title)}" loading="lazy" decoding="async"></div>` : def.legendHtml ?? "";
  const ctl = [
    tl ? `<button type="button" class="chip chip-soft chip-btn cat-date${missing ? " is-missing" : ""}" data-act="date" aria-label="Date: ${esc(timeLabel(cur, tl.unit))}. Open the time slider">${ICON.calendar}<span>${esc(timeLabel(cur, tl.unit))}</span></button>` : "",
    def.setOpacity ? `<label class="cat-op">${ICON.opacity}<input type="range" class="cat-range" min="0" max="100" step="1" value="${v}" data-act="opacity" aria-label="Opacity of ${esc(def.title)}" style="--p:${v}%"><output aria-hidden="true">${v}%</output></label>` : "",
  ].join("");
  return `<div class="cat-live${busy.has(id) ? " is-busy" : ""}" data-id="${esc(id)}">
    <div class="cat-live-head">
      <div class="grow"><div class="t">${esc(def.title)}</div><div class="s">${esc(def.source ?? def.category ?? "")}</div></div>
      ${busy.has(id) ? spinner : ""}
      <button type="button" class="icon-btn cat-ic" data-act="info" aria-expanded="${info}" aria-label="About ${esc(def.title)}">${ICON.info}</button>
      <button type="button" class="icon-btn cat-ic" data-act="remove" aria-label="Remove ${esc(def.title)}">${ICON.close}</button>
    </div>
    ${ctl ? `<div class="cat-live-ctl">${ctl}</div>` : ""}
    ${tooFar(def) ? `<p class="cat-flag soft">Appears from zoom ${def.minZoomHint}. Zoom in to see it.</p>` : ""}
    ${def.overlaps && app.layers.isOn(def.overlaps.id) ? `<p class="cat-flag soft">${esc(def.overlaps.note(app.layers.get(def.overlaps.id)))}</p>` : ""}
    ${failing(id) ? `<p class="cat-flag">${esc(def.source ?? "The provider")} is not answering right now, so the map may stay empty. Try again later.</p>` : ""}
    ${missing ? `<p class="cat-flag">${esc(missingText(def, tl, cur))}</p>` : actualNote ? `<p class="cat-flag soft">${esc(actualNote)}</p>` : ""}
    ${legend}
    ${info ? infoBlock(def) : ""}
  </div>`;
}
const tooFar = (def) => !!def.minZoomHint && app.map.getZoom() < def.minZoomHint - 0.2;
/** Why a dated layer shows nothing: a recent date not published yet, or no data at all. */
function missingText(def, tl, ms, short = false) {
  const minute = tl?.unit === "minute", what = def.gibsId ? "imagery" : "data";
  if (def.time?.now && Number.isFinite(ms) && Date.now() - ms < 2 * DAY) {
    return short ? "Not published yet" : `NASA has not published this ${minute ? "time" : "date"} yet. Try an earlier one.`;
  }
  return short ? `No ${what} ${minute ? "at this time" : "on this date"}` : `No ${what} ${minute ? "at this time" : "on this date"}. Try another ${minute ? "time" : "day"}.`;
}
function infoBlock(def) {
  const tl = timeline(def);
  const rows = [
    ["Source", def.source], ["Licence", def.license], ["Attribution", def.attribution],
    tl ? ["Dates", def.time.dates?.length ? def.time.dates.join(", ") : `${timeLabel(tl.min, tl.unit === "minute" ? "day" : tl.unit)} – ${def.time.now ? "today" : timeLabel(tl.max, tl.unit === "minute" ? "day" : tl.unit)} (${cadence(tl.unit, tl.n).toLowerCase()})`] : def.meta?.date ? ["Date", def.meta.date] : null,
    def.detail ? ["Detail", def.detail] : null,
    def.coverage ? ["Coverage", def.coverage] : null,
    def.gibsId ? ["GIBS layer", def.gibsId] : null,
  ].filter((r) => r && r[1]);
  const about = describe(def);
  return `<div class="cat-info">${about ? `<p>${esc(about)}</p>` : ""}<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>`;
}

function renderActive() {
  const ids = order.filter((id) => app.layers.isOn(id) && !app.layers.get(id)?.base).reverse();
  if (!ids.length) return `<p class="cat-empty">Nothing on the map yet. Switch on a dataset below, or search for one.</p>`;
  return ids.map(activeCard).join("");
}

function renderHome() {
  const bases = Object.keys(IMAGERY).map((id) => {
    const on = app.baseImagery === id;
    const thumb = thumbFor(id);
    return `<button type="button" class="cat-base" data-imagery="${esc(id)}" aria-pressed="${on}" aria-label="${esc(IMAGERY[id].title)}" title="${esc(IMAGERY[id].sub ?? "")}">
      <span class="cat-base-img"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ""}>${on ? `<i class="cat-base-check">${ICON.check}</i>` : ""}</span>
      <span class="cat-base-t" aria-hidden="true">${esc(BASE_SHORT[id] ?? IMAGERY[id].title)}</span></button>`;
  }).join("");
  const baseLayers = app.layers.list().filter((d) => d.base).map((d) => layerRow(d, { sub: BASE_SUB[d.id] ?? d.source })).join("");
  const colls = COLLECTIONS.map((c) => {
    const open = openColl.has(c.id);
    const ids = c.items.map(itemId).filter((id) => app.layers.get(id));
    const n = ids.filter((id) => app.layers.isOn(id)).length;
    return `<section class="cat-coll${open ? " is-open" : ""}">
      <button type="button" class="cat-coll-head" data-coll="${c.id}" aria-expanded="${open}" aria-controls="cat-coll-${c.id}">
        <span class="cat-coll-ic">${ICON[c.icon]}</span>
        <span class="grow"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.sub)}</div></span>
        ${n ? `<span class="cat-count is-on">${n} on</span>` : `<span class="cat-count">${ids.length}</span>`}
        <span class="cat-chev">${ICON.chevron}</span></button>
      <div class="cat-coll-body" id="cat-coll-${c.id}"${open ? "" : " hidden"}>${open ? ids.map((id) => layerRow(app.layers.get(id))).join("") : ""}</div>
    </section>`;
  }).join("");
  return `
    <span class="eyebrow">On the map</span>
    <div class="cat-active" id="cat-active">${renderActive()}</div>
    <span class="eyebrow">Base map</span>
    <div class="cat-bases" role="group" aria-label="Base imagery">${bases}</div>
    <div class="cat-baselayers">${baseLayers}</div>
    <span class="eyebrow">Featured collections</span>
    <div class="cat-colls">${colls}</div>
    <div id="cat-nasa">${renderNasaHome()}</div>
    <p class="note">Every layer on the map lists its source, licence and attribution behind its info button. Imagery dates are the ones NASA reports for each tile request.</p>`;
}
function renderNasaHome() {
  const head = (n) => `<span class="eyebrow">All NASA Earth data${n ? ` · ${fmt(n)} layers` : ""}</span>`;
  if (!gibsDoc) {
    if (gibsError) return `${head()}<p class="cat-empty">The NASA catalogue did not load (${esc(gibsError)}). <button type="button" class="btn btn-ghost btn-sm" data-act="retry-gibs">Try again</button></p>`;
    return `${head()}<div class="cat-skel" aria-label="Loading the NASA catalogue">${"<i></i>".repeat(6)}</div>`;
  }
  return `${head(gibsDoc.layers.length)}
    <p class="cat-lede">Every layer NASA's Global Imagery Browse Services publish for web maps — from 10-minute weather satellites to 40-year climate records.</p>
    <div class="cat-cats">${gibsDoc.cats.map((c) => `<button type="button" class="row-btn cat-catrow" data-cat="${esc(c)}">
      <span class="cat-coll-ic">${ICON[CAT_ICON[c] ?? "grid"]}</span><span class="grow"><div class="t">${esc(c)}</div></span>
      <span class="cat-count">${fmt(gibsDoc.counts[c])}</span><span class="cat-chev">${ICON.chevron}</span></button>`).join("")}</div>`;
}
function renderCategory(cat) {
  const all = (gibsDoc?.layers ?? []).filter((m) => m.cat === cat);
  const list = all.filter((m) => view.filter === "all" || (view.filter === "now" ? m.time?.now : !m.time?.now));
  const seg = [["all", "All"], ["now", "Updating"], ["archive", "Archive"]].map(([k, t]) => `<button type="button" data-filter="${k}" aria-pressed="${view.filter === k}">${t}</button>`).join("");
  const rows = list.map((m) => {
    const def = app.layers.get(`gibs:${m.id}`);
    return def ? layerRow(def, { title: m.title, sub: datesText(def) ?? "Static" }) : "";
  }).join("");
  return `<button type="button" class="btn btn-ghost btn-sm cat-back" data-act="back">${ICON.back}All layers</button>
    <div class="cat-cathead"><span class="cat-coll-ic">${ICON[CAT_ICON[cat] ?? "grid"]}</span><div><h3>${esc(cat)}</h3><div class="src">${fmt(all.length)} NASA GIBS layers</div></div></div>
    <div class="seg cat-seg" role="group" aria-label="Filter">${seg}</div>
    <div class="cat-list">${rows || `<p class="cat-empty">No layers in this view.</p>`}</div>`;
}
function renderResults() {
  const q = view.q.trim();
  const hits = searchLayers(q);
  const cap = view.more ? 400 : 60;
  const waiting = !gibsDefined && !gibsError;
  if (!hits.length) {
    return waiting ? `<div class="cat-skel">${"<i></i>".repeat(4)}</div>` : `<p class="cat-empty">No layers match “${esc(q)}”. Try <button type="button" class="cat-sugg" data-q="rain">rain</button>, <button type="button" class="cat-sugg" data-q="sea ice">sea ice</button> or <button type="button" class="cat-sugg" data-q="night lights">night lights</button>.</p>`;
  }
  const groups = new Map();
  for (const def of hits.slice(0, cap)) {
    const g = def.base ? "Base map" : def.category ?? "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(def);
  }
  return `<p class="cat-resn">${fmt(hits.length)} layer${hits.length === 1 ? "" : "s"}${waiting ? " so far — still loading the NASA catalogue" : ""}</p>
    ${[...groups].map(([g, defs]) => `<span class="eyebrow">${esc(g)}</span>${defs.map((d) => layerRow(d, { sub: rowSub(d) })).join("")}`).join("")}
    ${hits.length > cap ? `<button type="button" class="btn btn-ghost btn-sm cat-more" data-act="more">Show all ${fmt(hits.length)}</button>` : ""}`;
}

function renderPanel(node) {
  panelNode = node;
  node.classList.add("cat");
  node.innerHTML = `
    <div class="cat-top">
      <div class="cat-search" role="search">${ICON.search}
        <input type="search" class="cat-q" placeholder="${gibsDefined ? `Search ${fmt(app.layers.list().length)} layers` : "Search every Earth dataset"}" value="${esc(view.q)}" autocomplete="off" spellcheck="false" aria-label="Search layers">
        <button type="button" class="cat-clear" aria-label="Clear search"${view.q ? "" : " hidden"}>${ICON.close}</button>
      </div>
    </div>
    <div class="cat-main"></div>`;
  paintMain();
  const input = node.querySelector(".cat-q");
  const clearBtn = node.querySelector(".cat-clear");
  let t = 0;
  const clear = () => { clearTimeout(t); input.value = ""; view.q = ""; clearBtn.hidden = true; paintMain(); };
  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    clearTimeout(t);
    t = setTimeout(() => { view.q = input.value; view.more = false; if (view.q.trim() && !gibsDefined) ensureGibs().then(refreshSoon).catch(() => {}); paintMain(); }, 90);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) { e.stopPropagation(); clear(); }
  });
  clearBtn.addEventListener("click", () => { clear(); input.focus(); });
  detachScroll?.();
  const scroller = $("#dock-body"), top = node.querySelector(".cat-top");
  const onScroll = () => top.classList.toggle("is-stuck", scroller.scrollTop > 2);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  detachScroll = () => scroller.removeEventListener("scroll", onScroll);
  input.addEventListener("focus", () => { if (!gibsDoc) loadGibs().then(refreshSoon).catch(() => {}); }, { once: true });
  node.addEventListener("click", onPanelClick);
  node.addEventListener("input", onPanelInput);
}
function paintMain() {
  if (!panelNode) return;
  const main = panelNode.querySelector(".cat-main");
  const scroller = $("#dock-body");
  const keep = scroller?.scrollTop ?? 0;
  const focus = document.activeElement && panelNode.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  main.innerHTML = view.q.trim() ? renderResults() : view.cat ? renderCategory(view.cat) : renderHome();
  if (scroller) scroller.scrollTop = keep;
  if (focus) restoreFocus(focus);
}
function focusKey(el) {
  const host = el.closest("[data-layer],[data-act],[data-coll],[data-cat],[data-imagery],[data-filter],.cat-q");
  if (!host) return null;
  const live = el.closest(".cat-live")?.dataset.id;
  return { live, sel: ["data-layer", "data-act", "data-coll", "data-cat", "data-imagery", "data-filter"].map((a) => (host.hasAttribute(a) ? `[${a}="${CSS.escape(host.getAttribute(a))}"]` : "")).join("") || ".cat-q" };
}
function restoreFocus({ live, sel }) {
  const root = live ? panelNode.querySelector(`.cat-live[data-id="${CSS.escape(live)}"]`) : panelNode;
  root?.querySelector(sel)?.focus({ preventScroll: true });
}
function refreshSoon() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!panelNode?.isConnected || app.ui.current !== "layers") return;
    // Never repaint under a slider the viewer is dragging.
    if (panelNode.contains(document.activeElement) && document.activeElement.matches('input[type="range"]') && pointerDown) return;
    paintMain();
  });
}
let pointerDown = false;
addEventListener("pointerdown", () => { pointerDown = true; }, true);
addEventListener("pointerup", () => { if (pointerDown) { pointerDown = false; refreshSoon(); } }, true);

async function toggleFromUi(id, on) {
  const def = app.layers.get(id);
  if (!def) return;
  busy.add(id);
  refreshSoon();
  try {
    const now = await app.layers.toggle(id, on);
    if (now) hintFor(def);
  } catch { /* core already showed a toast */ } finally {
    busy.delete(id);
    refreshSoon();
  }
}
function hintFor(def) {
  const map = app.map;
  if (def.minZoomHint && map.getZoom() < def.minZoomHint - 0.2) app.ui.toast(`${def.title} appears from zoom ${def.minZoomHint} — zoom in to see it.`);
  else if (def.coverage && Array.isArray(def.bounds?.[0])) {
    const b = map.getBounds();
    const seen = def.bounds.some(([w, s, e, n]) => !(e < b.getWest() || w > b.getEast() || n < b.getSouth() || s > b.getNorth()));
    if (!seen) app.ui.toast(`${def.title} covers the ${def.coverage} only — fly there to see it.`);
  }
}
function onPanelClick(e) {
  const t = e.target;
  const row = t.closest("[data-layer]");
  if (row) return toggleFromUi(row.dataset.layer);
  const base = t.closest("[data-imagery]");
  if (base) { setImagery(base.dataset.imagery); return; }
  const coll = t.closest("[data-coll]");
  if (coll) { const id = coll.dataset.coll; openColl.has(id) ? openColl.delete(id) : openColl.add(id); paintMain(); return; }
  const cat = t.closest("[data-cat]");
  if (cat) { view.cat = cat.dataset.cat; view.filter = "all"; paintMain(); $("#dock-body").scrollTop = 0; return; }
  const filter = t.closest("[data-filter]");
  if (filter) { view.filter = filter.dataset.filter; paintMain(); return; }
  const sugg = t.closest("[data-q]");
  if (sugg) { const input = panelNode.querySelector(".cat-q"); input.value = sugg.dataset.q; view.q = sugg.dataset.q; panelNode.querySelector(".cat-clear").hidden = false; paintMain(); input.focus(); return; }
  const act = t.closest("[data-act]")?.dataset.act;
  if (!act) return;
  const id = t.closest(".cat-live")?.dataset.id;
  if (act === "back") { view.cat = null; paintMain(); $("#dock-body").scrollTop = 0; }
  else if (act === "more") { view.more = true; paintMain(); }
  else if (act === "retry-gibs") { gibsError = null; paintMain(); loadGibs().then(() => { defineGibsWhenIdle(); refreshSoon(); }).catch(() => {}); }
  else if (act === "remove" && id) toggleFromUi(id, false);
  else if (act === "info" && id) { openInfo.has(id) ? openInfo.delete(id) : openInfo.add(id); paintMain(); }
  else if (act === "date" && id) {
    // On a phone the panel is a bottom sheet over the time bar: lower it to show the map.
    if (PHONE.matches) app.ui.closePanel();
    openTimebar(id, { focus: true });
  }
}
function onPanelInput(e) {
  const el = e.target;
  if (el.dataset.act !== "opacity") return;
  const id = el.closest(".cat-live")?.dataset.id;
  const v = +el.value / 100;
  el.style.setProperty("--p", `${el.value}%`);
  el.nextElementSibling.textContent = `${el.value}%`;
  setOpacity(id, v);
}
function setOpacity(id, v) {
  const def = app.layers.get(id);
  opacity.set(id, v);
  if (def?.setOpacity && app.layers.isOn(id)) def.setOpacity(app.map, v);
}

/* ---------------------------------------------------------------- time machine */
const tb = { owner: null, closed: false, playing: false, dragging: false, timer: 0 };
let tbEl = null;
function setupTimebar() {
  const bar = $("#timebar"), range = $("#time-range");
  if (!bar || !range) return;
  const mk = (cls, label, html) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `icon-btn tb-btn ${cls}`;
    b.setAttribute("aria-label", label);
    b.innerHTML = html;
    return b;
  };
  const prev = mk("tb-prev", "Previous date", ICON.prev);
  const next = mk("tb-next", "Next date", ICON.next);
  const play = mk("tb-play", "Play through time", ICON.play);
  play.setAttribute("aria-pressed", "false");
  const steps = document.createElement("div");
  steps.className = "tb-steps";
  range.replaceWith(steps);
  steps.append(prev, range, next, play);
  range.classList.add("cat-range", "tb-range");
  range.step = "1";
  bar.classList.add("cat-timebar");
  tbEl = { bar, range, prev, next, play, label: $("#time-label"), sub: $("#time-sub") };
  range.addEventListener("input", () => { stopPlay(); tb.dragging = true; showIndex(+range.value); });
  range.addEventListener("change", () => { tb.dragging = false; scheduleApply(+range.value, 200); });
  prev.addEventListener("click", () => { stopPlay(); stepBy(-1); });
  next.addEventListener("click", () => { stopPlay(); stepBy(1); });
  play.addEventListener("click", () => (tb.playing ? stopPlay() : startPlay()));
  $("#time-close")?.addEventListener("click", () => { tb.closed = true; stopPlay(); renderTimebar(); });
  app.on("ui:panel", placeTimebar);
  app.on("ui:card", () => requestAnimationFrame(placeTimebar));
  addEventListener("resize", placeTimebar, { passive: true });
  if (window.ResizeObserver && $("#card")) new ResizeObserver(() => placeTimebar()).observe($("#card"));
}
/** Centre the bar in the open stretch of map between the dock, the place card and the map
 *  controls. Phones keep world.css's full-width placement. */
function placeTimebar() {
  const bar = tbEl?.bar;
  if (!bar) return;
  bar.classList.remove("is-over", "is-compact");
  bar.style.bottom = "";
  document.body.classList.remove("tb-over");
  if (bar.hidden || PHONE.matches) { bar.style.left = bar.style.width = ""; return; }
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const dock = $("#dock"), card = $("#card");
  const dockOpen = dock && !dock.hidden, cardOpen = card && !card.hidden;
  // Short windows (landscape phones) have width to spare but little height: there the bar
  // folds onto two rows (is-compact) to fit a narrower gap rather than shorten the dock.
  const short = vh <= 520, min = short ? 320 : 380;
  const fold = COARSE.matches ? 420 : 380; // narrower than this, one row squeezes the slider out
  let lo = 84, hi = vw - 72; // clear of the rail and the map-control column
  if (dockOpen) lo = Math.max(lo, dock.getBoundingClientRect().right + 14);
  // Beside a side card the bar may fold, so a narrower gap (a tablet's, about 300 px) still
  // takes it rather than leaving its buttons under the card.
  const side = Math.min(min, 280);
  let beside = false;
  if (cardOpen) {
    const r = card.getBoundingClientRect(), top = bar.getBoundingClientRect().top;
    if (r.bottom > top - 8 && r.left - 14 - lo >= side) { hi = Math.min(hi, r.left - 14); beside = true; }
  }
  const hits = (r, b) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top - 8;
  const put = () => {
    const w = Math.min(700, hi - lo), x = (lo + hi) / 2;
    bar.style.width = `${w}px`;
    bar.style.left = `${x}px`;
    // the final box (left and width animate, so the live rect lags behind)
    const { top, bottom } = bar.getBoundingClientRect();
    return { left: x - w / 2, right: x + w / 2, top, bottom };
  };
  let over = hi - lo < (beside ? side : min);
  if (!over && hi - lo < fold) {
    bar.classList.add("is-compact");
    // Folded beside the dock but still under the place card: no room here after all.
    if (cardOpen && hits(card.getBoundingClientRect(), put())) { bar.classList.remove("is-compact"); over = true; }
  }
  // Too little open map beside the dock (tablet portrait): span the map's width below the
  // dock, and end the dock above the bar instead of covering its last rows.
  if (over) { lo = 84; hi = vw - 72; bar.classList.add("is-over"); }
  let box = put();
  // Short windows lay the map controls along the bottom edge, two rows high beside an open
  // dock, so the bar at its usual height would cover the upper row (and the card's foot).
  // There it takes the bottom edge instead, between the credits and the controls, and the
  // dock ends above it; failing that it rises above the controls it would cover.
  const ctls = short ? [...document.querySelectorAll("#controls > *")].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height) : [];
  if (ctls.length && (over || ctls.some((r) => hits(r, box)))) {
    const keep = { lo, hi, compact: bar.classList.contains("is-compact") };
    const st = $("#status")?.getBoundingClientRect();
    bar.style.bottom = "calc(10px + env(safe-area-inset-bottom))";
    bar.classList.remove("is-compact");
    lo = 84; hi = vw - 72;
    for (let i = 0; i < 3; i++) { // the bar's height depends on whether it folds
      const b = put();
      for (const r of ctls) if (r.top < b.bottom && r.bottom > b.top - 8) hi = Math.min(hi, r.left - 10);
      if (st?.width && st.top < b.bottom && st.bottom > b.top - 8) lo = Math.max(lo, st.right + 10);
      bar.classList.toggle("is-compact", hi - lo < fold);
    }
    if (hi - lo >= 300) { over = true; bar.classList.add("is-over"); box = put(); }
    else {
      bar.style.bottom = "";
      ({ lo, hi } = keep);
      bar.classList.toggle("is-compact", keep.compact);
      box = put();
      const under = over ? [] : ctls.filter((r) => hits(r, box));
      if (under.length) {
        bar.style.bottom = `${Math.round(vh - Math.min(...under.map((r) => r.top)) + 8)}px`;
        box = put();
        if (box.top < 70 || (cardOpen && hits(card.getBoundingClientRect(), box))) { bar.style.bottom = ""; box = put(); }
      }
    }
  }
  if (!over || !dockOpen) return;
  // A place card docked along the bottom (a sheet beside or below the dock) would hide
  // the bar: lift the bar onto the card's top edge.
  if (cardOpen) {
    const r = card.getBoundingClientRect();
    if (r.top > vh / 2 && hits(r, box)) { bar.style.bottom = `${Math.round(vh - r.top + 10)}px`; box = put(); }
  }
  // The dock ends 10 px above the bar (catalog.css reads --tb-clear), keeping any higher
  // bottom world.css already gives it.
  const natural = parseFloat(getComputedStyle(dock).bottom) || 0;
  document.body.style.setProperty("--tb-clear", `${Math.max(natural, Math.round(vh - box.top + 10))}px`);
  document.body.classList.add("tb-over");
}
function ownerDef() {
  if (tb.owner && app.layers.isOn(tb.owner) && timeline(app.layers.get(tb.owner))) return app.layers.get(tb.owner);
  for (let i = order.length - 1; i >= 0; i--) {
    const def = app.layers.get(order[i]);
    if (app.layers.isOn(order[i]) && timeline(def)) { tb.owner = order[i]; return def; }
  }
  tb.owner = null;
  return null;
}
function renderTimebar() {
  if (!tbEl) return;
  const def = ownerDef();
  const show = !!def && !tb.closed;
  const was = !tbEl.bar.hidden;
  tbEl.bar.hidden = !show;
  document.body.classList.toggle("has-timebar", show);
  if (show !== was) placeTimebar();
  if (!show) { stopPlay(); return; }
  const tl = timeline(def);
  tbEl.range.min = "0";
  tbEl.range.max = String(tl.count - 1);
  tbEl.range.setAttribute("aria-label", `Date for ${def.title}`);
  if (!tb.dragging) tbEl.range.value = String(tl.index(toMs(app.layers.timeOf(def.id))));
  showIndex(+tbEl.range.value);
}
function showIndex(i) {
  const def = ownerDef();
  if (!def) return;
  const tl = timeline(def);
  const ms = tl.at(i);
  const label = timeLabel(ms, tl.unit);
  tbEl.label.textContent = label;
  tbEl.range.setAttribute("aria-valuetext", label);
  tbEl.range.style.setProperty("--p", `${tl.count > 1 ? (i / (tl.count - 1)) * 100 : 100}%`);
  tbEl.prev.disabled = i <= 0;
  tbEl.next.disabled = i >= tl.count - 1;
  tbEl.play.disabled = tl.count < 2;
  const p = probe.get(def.id);
  const applied = store(ms, tl.unit) === app.layers.timeOf(def.id);
  let note = `${def.title} · ${cadence(tl.unit, tl.n)}`;
  if (applied && p?.requested === app.layers.timeOf(def.id)) {
    if (p.missing) note = `${missingText(def, tl, ms, true)} · ${def.title}`;
    else if (p.actual && p.actual !== p.requested) note = `Showing ${timeLabel(toMs(p.actual), tl.unit)} · ${def.title}`;
  }
  tbEl.sub.textContent = note;
  tbEl.sub.title = note;
  tbEl.bar.classList.toggle("is-missing", applied && !!p?.missing && p.requested === app.layers.timeOf(def.id));
}
function scheduleApply(i, ms) {
  clearTimeout(tb.timer);
  tb.timer = setTimeout(() => applyIndex(i), ms);
}
function applyIndex(i) {
  const def = ownerDef();
  if (!def) return;
  const tl = timeline(def);
  const iso = store(tl.at(i), tl.unit);
  if (iso !== app.layers.timeOf(def.id)) app.layers.setTime(def.id, iso);
}
function stepBy(d) {
  const def = ownerDef();
  if (!def) return;
  const tl = timeline(def);
  const i = clamp(+tbEl.range.value + d, 0, tl.count - 1);
  tbEl.range.value = String(i);
  showIndex(i);
  scheduleApply(i, 260);
}
/** Show the time bar for a dated layer. Only an explicit user action (the layer's date
 *  button) moves focus to the slider; the agent and layer toggles leave focus where it is. */
function openTimebar(id, { focus = false } = {}) {
  if (!timeline(app.layers.get(id))) return;
  tb.owner = id;
  tb.closed = false;
  renderTimebar();
  if (focus) tbEl?.range.focus({ preventScroll: true });
}
const waitIdle = (max) => new Promise((resolve) => {
  const t = setTimeout(resolve, max);
  app.map.once("idle", () => { clearTimeout(t); resolve(); });
});
async function startPlay() {
  const def = ownerDef();
  if (!def) return;
  tb.playing = true;
  tbEl.play.setAttribute("aria-pressed", "true");
  tbEl.play.setAttribute("aria-label", "Pause");
  tbEl.play.innerHTML = ICON.pause;
  let tl = timeline(def);
  if (+tbEl.range.value >= tl.count - 1) { tbEl.range.value = "0"; applyIndex(0); }
  while (tb.playing) {
    await waitIdle(4000);
    await new Promise((r) => setTimeout(r, REDUCED ? 1500 : 900));
    if (!tb.playing || !ownerDef()) break;
    tl = timeline(ownerDef());
    const i = +tbEl.range.value + 1;
    if (i > tl.count - 1) break;
    tbEl.range.value = String(i);
    showIndex(i);
    applyIndex(i);
  }
  stopPlay();
}
function stopPlay() {
  if (!tb.playing && tbEl?.play.getAttribute("aria-pressed") !== "true") return;
  tb.playing = false;
  if (!tbEl) return;
  tbEl.play.setAttribute("aria-pressed", "false");
  tbEl.play.setAttribute("aria-label", "Play through time");
  tbEl.play.innerHTML = ICON.play;
}

/* ---------------------------------------------------------------- agent tools */
function layerSummary(def) {
  return {
    id: def.id, title: def.title, category: def.category, source: def.source ?? null,
    dates: datesText(def), date: def.time ? app.layers.timeOf(def.id) : undefined, on: app.layers.isOn(def.id),
  };
}
function defineTools() {
  app.tools.define("list_layers", {
    description: "List map layers (datasets) that can be switched on: curated collections, the full NASA GIBS archive (1,100+ satellite and climate layers), Natural Earth reference layers, bathymetry, land cover and geology. Filter by a search query (e.g. 'sea surface temperature', 'aerosol', 'snow'), a category, or on:true for the layers currently on. Returns id, title, category, source, dates and whether each is on.",
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "Words to match in the title, keywords or category." },
      category: { type: "string", description: "Category name or part of one, e.g. 'Oceans', 'Fires', 'Reference'." },
      on: { type: "boolean", description: "true = only layers currently on the map." },
      limit: { type: "number", description: "Max results, default 25, max 200." },
    } },
    async run({ query, category, on, limit = 25 } = {}) {
      await ensureGibs().catch(() => {});
      let defs = query ? searchLayers(query) : app.layers.list().slice().sort((a, b) => (b.curated ? 1 : 0) - (a.curated ? 1 : 0));
      if (category) { const c = category.toLowerCase(); defs = defs.filter((d) => `${d.category} ${d.nasaCat ?? ""}`.toLowerCase().includes(c)); }
      if (on != null) defs = defs.filter((d) => app.layers.isOn(d.id) === on && !d.base);
      const max = clamp(Math.round(limit) || 25, 1, 200);
      const list = defs.slice(0, max).map(layerSummary);
      const summary = on && !query && !category
        ? (list.length ? `On the map: ${list.map((l) => `**${l.title}**${l.date ? ` (${l.date})` : ""}`).join(", ")}.` : "No data layers are on — only the base map.")
        : `${fmt(defs.length)} layer${defs.length === 1 ? "" : "s"}${query ? ` match “${query}”` : ""}${list.length ? `:\n${list.slice(0, 8).map((l) => `- **${l.title}**${l.dates ? ` — ${l.dates}` : ""}${l.on ? " (on)" : ""}`).join("\n")}` : "."}`;
      return { total: defs.length, returned: list.length, layers: list, summary };
    },
    local: {
      patterns: [/^(?:layers|list(?: all)?(?: the)? layers|show(?: all)?(?: the)? layers|available layers|(?:what|which) layers are (?:on|active|visible|showing)|active layers|layers on)$/i],
      parse: (m, text) => (/\b(?:on|active|visible|showing)\b/i.test(text) ? { on: true } : { limit: 25 }),
      examples: ["what layers are on"],
    },
  });

  app.tools.define("toggle_layer", {
    description: "Switch a map layer on or off. Give its exact id (from list_layers) or a plain-language name in query (e.g. 'sea surface temperature', 'active fires', 'countries', 'GOES-East'); the best match is used and reported. on: true/false, omit to flip. Time-enabled layers open the time slider.",
    input_schema: { type: "object", properties: { id: { type: "string" }, query: { type: "string" }, on: { type: "boolean" } } },
    async run({ id, query, on } = {}) {
      const ref = id ?? query;
      if (!ref) return { ok: false, error: "Give a layer id or a name to look for." };
      let hit = resolveLayer(ref);
      if (!hit || hit.by !== "id") { await ensureGibs().catch(() => {}); hit = resolveLayer(ref) ?? hit; }
      if (!hit) return { ok: false, error: `No layer like “${ref}”. Try list_layers with a query.` };
      const def = hit.def;
      const want = on ?? !app.layers.isOn(def.id);
      busy.add(def.id);
      try { await app.layers.toggle(def.id, want); } catch (err) { return { ok: false, error: `${def.title}: ${err.message}` }; } finally { busy.delete(def.id); refreshSoon(); }
      if (want) hintFor(def);
      const out = { ok: true, id: def.id, title: def.title, on: want, matched: hit.by === "id" ? "exact id" : `best match for “${ref}”`, source: def.source, license: def.license };
      if (want && def.time) out.date = app.layers.timeOf(def.id);
      out.summary = `**${def.title}** ${want ? "on" : "off"}${out.date ? ` · ${timeLabel(toMs(out.date), timeline(def)?.unit)}` : ""}. Source: ${def.source ?? "—"}.`;
      return out;
    },
    local: {
      patterns: [
        /^(?:show|turn on|switch on|add|enable|display|overlay)\s+(?!me\b|all\b|layers?\s*$)(?:the\s+)?(.+?)(?:\s+(?:layer|overlay|data(?:set)?))?$/i,
        /^(?:hide|turn off|switch off|remove|disable)\s+(?:the\s+)?(.+?)(?:\s+(?:layer|overlay|data(?:set)?))?$/i,
      ],
      parse: (m, text) => {
        const q = m[1].trim();
        if (!((resolveLayer(q)?.score ?? 0) >= 55)) return null;
        return { query: q, on: !/^(?:hide|turn off|switch off|remove|disable)\b/i.test(text) };
      },
      examples: ["show sea surface temperature", "hide countries"],
    },
  });

  app.tools.define("set_layer_date", {
    description: "Show a time-enabled layer (daily satellite imagery, climate records, fires...) for a given date or date-time (YYYY-MM-DD, YYYY-MM, or ISO date-time for 10-minute layers). The date is snapped to the layer's real cadence and clamped to its archive; the layer is switched on and the time slider opens. Returns the date NASA actually serves.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "Layer id or name." }, date: { type: "string" } }, required: ["id", "date"] },
    async run({ id, date } = {}) {
      let hit = resolveLayer(id);
      if (!hit || hit.by !== "id") { await ensureGibs().catch(() => {}); hit = resolveLayer(id) ?? hit; }
      if (!hit) return { ok: false, error: `No layer like “${id}”.` };
      let def = hit.def, instead = null;
      if (!timeline(def)) {
        // "fires" names the undated Live Earth layer; its dated counterpart takes the date.
        const twin = app.layers.list().find((d) => d.overlaps?.id === def.id && timeline(d));
        if (!twin) await ensureGibs().catch(() => {});
        const dated = twin ? { def: twin, score: 100 } : resolveLayer(id, { timed: true });
        // Below 80 a dated match only shares a word with the request ("terrain" finds a SAR
        // product's "Terrain Corrected"), so it is offered, not swapped in.
        if (!(dated?.score >= 80)) {
          if (!(dated?.score >= 55 && dated.def.curated)) return { ok: false, error: `${def.title} has no dates to choose from — it is a static layer.` };
          const t = timeline(dated.def);
          return { ok: false, error: `${def.title} has no dates; “${dated.def.title}” has ${dated.def.time.dates?.length ? "dated editions" : `${cadence(t.unit, t.n).toLowerCase()} history`}.` };
        }
        instead = { title: def.title, twin: !!twin };
        def = dated.def;
      }
      const tl = timeline(def);
      const ms = toMs(date);
      if (!Number.isFinite(ms)) return { ok: false, error: `Could not read the date “${date}”. Use YYYY-MM-DD.` };
      const snapped = tl.at(tl.index(ms));
      const iso = store(snapped, tl.unit);
      const clamped = ms < tl.min - DAY || ms > tl.max + DAY;
      app.layers.setTime(def.id, iso);
      if (!app.layers.isOn(def.id)) await app.layers.toggle(def.id, true).catch(() => {});
      openTimebar(def.id);
      if (def.probe) await probeSettled(def.id);
      const p = probe.get(def.id);
      const actual = p?.requested === iso ? p : null;
      const notes = [instead && `${instead.title} has no dates, so ${instead.twin ? "its dated counterpart" : "the closest dated layer"} was used.`, clamped && "Outside the archive; used the nearest available date.", actual?.missing && missingText(def, tl, snapped)].filter(Boolean);
      const out = {
        ok: true, id: def.id, title: def.title, requested: date, date: iso, label: timeLabel(snapped, tl.unit),
        range: `${store(tl.min, tl.unit)} to ${store(tl.max, tl.unit)}`, cadence: cadence(tl.unit, tl.n),
        ...(actual?.missing ? { available: false } : actual?.actual ? { served: actual.actual } : {}),
        ...(notes.length ? { note: notes.join(" ") } : {}),
      };
      out.summary = `**${def.title}** set to ${out.label}${actual?.actual && actual.actual !== iso ? ` (NASA serves the period starting ${timeLabel(toMs(actual.actual), tl.unit)})` : ""}.${out.note ? ` ${out.note}` : ""}`;
      return out;
    },
    local: {
      patterns: [/^(?:show|set)\s+(.+?)\s+(?:on|for|at|from)\s+(\d{4}-\d{2}(?:-\d{2})?)$/i],
      parse: (m) => ((resolveLayer(m[1])?.score ?? 0) >= 55 ? { id: m[1], date: m[2] } : null),
      examples: ["show true colour MODIS Terra on 2021-08-15"],
    },
  });

  app.tools.define("set_layer_opacity", {
    description: "Set how opaque a layer is on the map, from 0 (invisible) to 1 (solid).",
    input_schema: { type: "object", properties: { id: { type: "string" }, opacity: { type: "number" } }, required: ["id", "opacity"] },
    async run({ id, opacity: v } = {}) {
      const hit = resolveLayer(id);
      if (!hit) return { ok: false, error: `No layer like “${id}”.` };
      const def = hit.def;
      if (!def.setOpacity) return { ok: false, error: `${def.title} does not support opacity.` };
      const val = clamp(Number(v) > 1 ? Number(v) / 100 : Number(v), 0, 1);
      if (!Number.isFinite(val)) return { ok: false, error: "Opacity must be a number from 0 to 1." };
      setOpacity(def.id, val);
      refreshSoon();
      return { ok: true, id: def.id, title: def.title, opacity: val, on: app.layers.isOn(def.id), summary: `**${def.title}** opacity ${Math.round(val * 100)}%.` };
    },
  });

  app.tools.define("describe_layer", {
    description: "Everything known about one layer: description, source, licence, attribution, legend image URL, date range and cadence, current date, finest detail, and whether it is on.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async run({ id } = {}) {
      let hit = resolveLayer(id);
      if (!hit || hit.by !== "id") { await ensureGibs().catch(() => {}); hit = resolveLayer(id) ?? hit; }
      if (!hit) return { ok: false, error: `No layer like “${id}”.` };
      const def = hit.def;
      const tl = timeline(def);
      const p = probe.get(def.id);
      return {
        ok: true, id: def.id, title: def.title, category: def.category, description: describe(def),
        source: def.source ?? null, attribution: def.attribution ?? null, license: def.license ?? null,
        legend_url: def.legendUrl ?? null, detail: def.detail ?? null, coverage: def.coverage ?? "global",
        on: app.layers.isOn(def.id), opacity: def.setOpacity ? opacity.get(def.id) ?? def.opacity ?? 1 : null,
        time: tl ? { first: store(tl.min, tl.unit), last: store(tl.max, tl.unit), updating: !!def.time.now, cadence: cadence(tl.unit, tl.n), current: app.layers.timeOf(def.id), ...(p?.actual ? { served: p.actual } : {}), ...(def.time.dates ? { dates: def.time.dates } : {}) } : null,
        gibs_layer: def.gibsId ?? null,
      };
    },
  });
}

/* ---------------------------------------------------------------- checks */
/** One real request per featured layer (used by tests and for debugging). */
async function verifyFeatured() {
  const out = [];
  for (const id of FEATURED_IDS) {
    const def = app.layers.get(id);
    if (!def) { out.push({ id, ok: false, error: "not defined" }); continue; }
    const url = def.sampleUrl ?? (def.gibsId ? def.tileUrl(def.time?.default ?? null, 0, 0, 0) : def.sample ? def.tileUrl(null, ...def.sample) : null);
    if (!url) { out.push({ id, ok: false, error: "no sample" }); continue; }
    try {
      const res = await fetch(url, { method: def.gibsId || def.ne ? "HEAD" : "GET" });
      out.push({ id, ok: res.ok, status: res.status, type: res.headers.get("content-type"), actual: res.headers.get("layer-time-actual") ?? undefined });
    } catch (err) { out.push({ id, ok: false, error: err.message }); }
  }
  return out;
}

/* ---------------------------------------------------------------- init */
export async function init() {
  installProtocol();
  defineCurated();

  // Shared links may name any GIBS layer; define those before boot restores the hash.
  const h = readHash();
  const wanted = new Set([...h.layers, ...Object.keys(h.times)].filter((id) => id.startsWith("gibs:") && !app.layers.get(id)));
  if (wanted.size) {
    try { await loadGibs(); defineGibs(wanted); } catch (err) { console.warn("[world] NASA catalogue unavailable", err.message); }
  }

  defineTools();
  setupTimebar();
  wireNaturalEarthInteraction();
  app.ui.definePanel("layers", {
    title: "Layers",
    order: 10,
    icon: ICON.layers,
    render: renderPanel,
    onClose: () => { panelNode = null; detachScroll?.(); detachScroll = null; },
  });

  app.on("layers:changed", ({ id, on }) => {
    order = order.filter((x) => x !== id);
    if (on) {
      order.push(id);
      if (timeline(app.layers.get(id))) { tb.owner = id; tb.closed = false; }
    } else {
      openInfo.delete(id);
      if (tb.owner === id) { tb.owner = null; stopPlay(); }
    }
    renderTimebar();
    refreshSoon();
  });
  app.on("layers:time", ({ id }) => { if (id === tb.owner || !tb.owner) renderTimebar(); refreshSoon(); });
  app.on("imagery:changed", refreshSoon);
  // Layers that only draw from a minimum zoom say so in their card; repaint when that flips.
  let farKey = "";
  app.map.on("zoomend", () => {
    const key = order.filter((id) => app.layers.isOn(id) && tooFar(app.layers.get(id))).join();
    if (key !== farKey) { farKey = key; refreshSoon(); }
  });
  app.on("app:ready", () => idle(() => loadGibs().then(() => { defineGibsWhenIdle(); refreshSoon(); }).catch(() => refreshSoon())));

  app.catalog = { ensureGibs, loadGibs, timeline, openTimebar, verifyFeatured, resolveLayer, searchLayers, probe };
}
