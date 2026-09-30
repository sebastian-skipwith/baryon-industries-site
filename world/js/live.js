// Live Earth: real-time feeds on the globe. Earthquakes (USGS), natural events
// (NASA EONET), active fires (NASA FIRMS via GIBS), US weather radar (NEXRAD via
// IEM), global precipitation (GPM IMERG), aurora (NOAA SWPC), US weather alerts
// (NWS), elevated US volcanoes (USGS), tropical cyclones (NOAA NHC), satellites
// propagated in the browser (CelesTrak + satellite.js), Baltic ships (Fintraffic
// AIS), public cameras (TfL, Fintraffic) and, behind the Baryon relay,
// aircraft. Every item keeps its source, licence and as-of time.
//
// The live-layer set and several conventions (magnitude-sized, depth-coloured
// quakes; satellite classes with the crewed stations called out; caching CelesTrak
// groups and falling back to the cache on its 2-hour 403) are adapted from God's
// Eye View by Bilawal Sidhu (MIT licence, https://github.com/bilawalsidhu/gods-eye-view
// — src/layers/earthquakes, src/data/satelliteClass.js, src/layers/satellites,
// src/layers/cctv). See /THIRD_PARTY_NOTICES.md.
import { app, $, esc, fmt, getJSON, clamp } from "./core.js";

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DT_HEADERS = { "Digitraffic-User": "baryon-world-model" };

const SRC = {
  usgsFeed: (f) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${f}.geojson`,
  fdsn: "https://earthquake.usgs.gov/fdsnws/event/1/",
  eonet: "https://eonet.gsfc.nasa.gov/api/v3/events",
  gibsWms: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
  imerg: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default",
  imergLegend: "https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg",
  iemTiles: "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
  iemMeta: "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json",
  celestrak: (q) => `https://celestrak.org/NORAD/elements/gp.php?${q}&FORMAT=json`,
  satjs: "https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm",
  tz: "https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/+esm",
  ais: "https://meri.digitraffic.fi/api/ais/v1/locations",
  aisVessels: "https://meri.digitraffic.fi/api/ais/v1/vessels",
  tfl: "https://api.tfl.gov.uk/Place/Type/JamCam",
  fiCams: "https://tie.digitraffic.fi/api/weathercam/v1/stations",
  fiCamImg: (preset) => `https://weathercam.digitraffic.fi/${preset}.jpg`,
  aurora: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  nws: "https://api.weather.gov/alerts/active",
  wwa: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query",
  volcanoes: "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated",
  hansNotice: (id) => `https://volcanoes.usgs.gov/hans-public/notice/${id}`,
  nhc: "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer",
  ll2: "https://ll.thespacedevs.com/2.3.0/launches/upcoming/",
};

/* ================================================================ small helpers */
const EMPTY = () => ({ type: "FeatureCollection", features: [] });
const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayUTC = (t, withYear = false) => {
  const d = new Date(t), y = d.getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear || y !== new Date().getUTCFullYear() ? ` ${y}` : ""}`;
};
const stamp = (t) => `${dayUTC(t)}, ${hhmm(t)}`;
const stampSec = (t) => { const d = new Date(t); return `${dayUTC(t)}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`; };
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const cap = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase());
function span(ms) {
  const s = Math.abs(ms) / 1000;
  if (s < 45) return null;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 6 * 3600) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return m ? `${h} h ${m} min` : `${h} h`; }
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h`;
  const d = Math.floor(s / 86400), h = Math.round((s % 86400) / 3600);
  if (d < 7) return h ? `${d} d ${h} h` : `${d} d`;
  if (d < 60) return `${d} days`;
  if (d < 730) return `${Math.round(d / 30.44)} months`;
  return `${Math.floor(d / 365.25)} years`;
}
const ago = (t) => { const s = span(Date.now() - t); return s ? `${s} ago` : "just now"; };
const until = (t) => { const s = span(t - Date.now()); return t < Date.now() ? (s ? `${s} ago` : "now") : s ? `in ${s}` : "now"; };
const hostOf = (url) => { try { return new URL(url, location.href).hostname; } catch { return "the provider"; } };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(`baryon-live:${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`baryon-live:${k}`, JSON.stringify(v)); return true; } catch { return false; } },
};

async function getText(url, { timeout = 20000, ...init } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${hostOf(url)} answered ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${hostOf(url)} timed out`);
    if (err instanceof TypeError) throw new Error(`couldn't reach ${hostOf(url)}`);
    throw err;
  } finally { clearTimeout(t); }
}
/** Network-level failures (a fetch, or a module import from a CDN) read as "couldn't reach <host>". */
function reason(err) {
  const msg = String(err?.message ?? "");
  if (err instanceof TypeError && /fetch|import/i.test(msg)) {
    const url = /https?:\/\/[^\s'"]+/.exec(msg)?.[0];
    return `couldn't reach ${url ? hostOf(url) : "the provider"}`;
  }
  return msg || "unavailable";
}
const unreadable = (url) => new Error(`${hostOf(url)} sent an answer that could not be read`);
async function parseJSONText(url, opts) {
  const text = await getText(url, opts);
  try { return JSON.parse(text); } catch { throw unreadable(url); }
}
async function fetchJSON(url, opts) {
  try { return await getJSON(url, opts); } catch (err) {
    if (err instanceof TypeError) throw new Error(`couldn't reach ${hostOf(url)}`);
    if (err instanceof SyntaxError) throw unreadable(url);
    throw err;
  }
}

/** IndexedDB key-value cache (falls back to localStorage when IndexedDB is unavailable). */
const cache = (() => {
  let dbp = null;
  const open = () => (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("baryon-live", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async get(k) { try { return (await run("readonly", (s) => s.get(k))) ?? null; } catch { return store.get(`c:${k}`); } },
    async set(k, v) { try { await run("readwrite", (s) => s.put(v, k)); } catch { store.set(`c:${k}`, v); } },
  };
})();

function drop(map, layers, sources = []) {
  for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of sources) if (map.getSource(id)) map.removeSource(id);
}
// Last data per source, so a feed switched back on inside its refresh window redraws at once.
const GEO = new Map();
function setGeo(map, id, data) { GEO.set(id, data); map.getSource(id)?.setData(data); }
function addGeo(map, id, opts = {}) { map.addSource(id, { type: "geojson", data: GEO.get(id) ?? EMPTY(), ...opts }); }
/** Split a lng/lat path at the antimeridian so it never draws the long way round. */
function splitDateline(coords) {
  const lines = [];
  let cur = [];
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i];
    if (cur.length) {
      const a = cur[cur.length - 1];
      const d = p[0] - a[0];
      if (Math.abs(d) > 180) {
        const edge = d < 0 ? 180 : -180;
        const b = p[0] + (d < 0 ? 360 : -360);
        const f = (edge - a[0]) / (b - a[0] || 1);
        const lat = a[1] + f * (p[1] - a[1]);
        cur.push([edge, lat]);
        if (cur.length > 1) lines.push(cur);
        cur = [[-edge, lat]];
      }
    }
    cur.push(p);
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}
const inView = (lngLat) => { try { return app.map.getBounds().contains(lngLat); } catch { return false; } };
function flyIfAway(center, zoom) {
  if (inView(center) && Math.abs(app.map.getZoom() - zoom) < 3) return;
  app.map.flyTo({ center, zoom, speed: 1.3 });
}
function frame(points, maxZoom = 6) {
  if (!points.length) return;
  if (points.length === 1) return app.map.flyTo({ center: points[0], zoom: Math.max(app.map.getZoom(), 5), speed: 1.3 });
  const b = new app.maplibregl.LngLatBounds();
  points.forEach((p) => b.extend(p));
  const phone = innerWidth <= 720;
  app.map.fitBounds(b, { padding: phone ? { top: 80, bottom: 120, left: 30, right: 30 } : { top: 90, bottom: 90, left: app.ui.current ? 470 : 90, right: 440 }, maxZoom, speed: 1.3 });
}
/** The part of the map left in sight by the dock and the card (bottom sheets on phones), in map pixels. */
function openRect() {
  const box = app.map.getContainer().getBoundingClientRect(), phone = innerWidth <= 720;
  const r = { l: 0, t: phone ? 110 : 0, r: box.width, b: box.height };
  for (const sel of ["#dock", "#card"]) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const c = el.getBoundingClientRect();
    if (phone) r.b = Math.min(r.b, c.top - box.top);
    else if (sel === "#dock") r.l = Math.max(r.l, c.right - box.left);
    else r.r = Math.min(r.r, c.left - box.left);
  }
  return r;
}
/** How many of these points are drawn in the open part of the view (the far side of the globe does not count). */
function countInView(points) {
  const m = app.map, tr = m._camera?.transform ?? m.transform, { LngLat } = app.maplibregl, r = openRect();
  let n = 0;
  for (const [lng, lat] of points) {
    const ll = new LngLat(lng, lat);
    if (tr?.isLocationOccluded?.(ll)) continue;
    const p = m.project(ll);
    if (p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b) n++;
  }
  return n;
}
/** Fly so the point lands in the middle of the open part of the view. */
function flyToOpen(at, zoom) {
  const m = app.map, r = openRect(), box = m.getContainer().getBoundingClientRect(), cx = box.width / 2, cy = box.height / 2;
  let dx = (r.l + r.r) / 2 - cx, dy = (r.t + r.b) / 2 - cy;
  const globe = m.getProjection?.()?.type !== "mercator";
  // A whole globe drawn in the open space needs no offset (an offset only turns the point away from the viewer).
  if (globe && (1024 * 2 ** zoom) / (2 * Math.PI) < Math.min(box.width, box.height) && cx > r.l && cx < r.r && cy > r.t && cy < r.b) dx = dy = 0;
  // As in reveal(): the globe cannot be pushed off-centre further than its own radius.
  const z = globe ? Math.max(zoom, Math.log2(((Math.max(Math.abs(dx), Math.abs(dy)) + 60) * 2 * Math.PI) / 512)) : zoom;
  const center = solveCenter(at, [box.width / 2 + dx, box.height / 2 + dy], z);
  m.flyTo({ center: center ?? at, zoom: z, speed: 1.3 });
}
/** Show every point: fit them when they cluster, else turn the globe to face their mean. */
function frameAll(points) {
  if (!points.length) return;
  const rad = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of points) { x += Math.cos(lat * rad) * Math.cos(lng * rad); y += Math.cos(lat * rad) * Math.sin(lng * rad); z += Math.sin(lat * rad); }
  const c = [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
  // Longitudes unwrapped around the mean, so a cluster across the antimeridian stays one cluster.
  const pts = points.map(([lng, lat]) => [c[0] + ((((lng - c[0]) % 360) + 540) % 360) - 180, lat]);
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [lng, lat] of pts) { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); }
  if (e - w > 100 || n - s > 60) return flyToOpen(c, Math.min(app.map.getZoom(), 1.8));
  const r = openRect(), box = app.map.getContainer().getBoundingClientRect(), pad = 36;
  app.map.fitBounds([[w, s], [e, n]], { padding: { top: r.t + pad, left: r.l + pad, bottom: box.height - r.b + pad, right: box.width - r.r + pad }, maxZoom: 7, speed: 1.3 });
}
/** Chrome remembers a failed module fetch for the page's lifetime, so each retry asks for a fresh URL. */
const importTries = new Map();
function importCDN(url) {
  const n = importTries.get(url) ?? 0;
  importTries.set(url, n + 1);
  return import(n ? `${url}?retry=${n}` : url);
}
let tzLookup = null;
async function localTime(lat, lng, t) {
  try {
    tzLookup ??= importCDN(SRC.tz).then((m) => m.default ?? m).catch((err) => { tzLookup = null; throw err; });
    const zone = (await tzLookup)(lat, lng);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.day} ${MONTHS[p.month - 1]}, ${p.hour}:${p.minute} · ${zoneLabel(zone, t)}`;
  } catch { return null; }
}
/** POSIX "Etc/GMT+1" means UTC−1, so the open-ocean zones are named by their offset (as in place.js). */
function zoneLabel(zone, t) {
  if (!zone.startsWith("Etc/")) return zone.replace(/_/g, " ");
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName");
    return part ? `${part.value.replace(/^GMT/, "UTC").replace(/^UTC$/, "UTC+0")} (nautical time zone)` : zone;
  } catch { return zone; }
}

/* ================================================================ icons */
const circ = (x, y, r) => `M${x} ${y - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0-${2 * r}z`;
const wave = (y) => `M3 ${y}c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0`;
const G = {
  live: [circ(12, 12, 1.8), "M8.2 15.8a5.4 5.4 0 0 1 0-7.6", "M15.8 8.2a5.4 5.4 0 0 1 0 7.6", "M5.1 18.9a9.8 9.8 0 0 1 0-13.8", "M18.9 5.1a9.8 9.8 0 0 1 0 13.8"],
  quake: ["M2 12h3.5l2-5 3 11 3-9 2 5.5 1.5-2.5H22"],
  globe: [circ(12, 12, 9), "M3.5 9h17M3.5 15h17", "M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18"],
  flame: ["M12 3c.6 3.4 5 5.3 5 10.2a5 5 0 0 1-10 .2c0-2.3 1.2-3.7 2.5-5 .2 1.7.9 2.8 2 3.3.7-2.8.1-5.8.5-8.7z"],
  radar: ["M12 3a9 9 0 1 0 9 9", "M12 7.5a4.5 4.5 0 1 0 4.5 4.5", "M12 12l6.5-6.5"],
  rain: ["M7.5 15.5h9a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.3 9.6a3 3 0 0 0 1.2 5.9z", "M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"],
  aurora: ["M6 20c-1.2-5 1.2-8 0-14", "M12 20c-1.2-6 1.2-9 0-16", "M18 20c-1.2-5 1.2-8 0-13", "M3 20h18"],
  alert: ["M10.3 4.3 2.6 17.6a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z", "M12 9.5v4", "M12 17h.01"],
  volcano: ["M3 20l5.5-8.5h7L21 20z", "M10.5 11.5c-.5-2.3.8-3.3 2-4.1 1.1-.8 1.5-2 1-3.4", "M15.3 7.6c1-1 2.4-1.2 3.4-.6"],
  cyclone: [circ(12, 12, 2.5), "M9.6 11.2C9 7 11 4 15.5 3.5c-2 1.5-2.3 3.5-1.2 5.9", "M14.4 12.8C15 17 13 20 8.5 20.5c2-1.5 2.3-3.5 1.2-5.9"],
  satellite: ["M12 8.5 15.5 12 12 15.5 8.5 12z", "M6.2 3.4 9 6.2 6.2 9 3.4 6.2z", "M17.8 15 20.6 17.8 17.8 20.6 15 17.8z", "M8 8l2.2 2.2M13.8 13.8 16 16", "M15.2 5.8a3.2 3.2 0 0 1 3 3"],
  starlink: [circ(5.5, 18.5, 1.5), circ(9.8, 14.2, 1.5), circ(14.2, 9.8, 1.5), circ(18.5, 5.5, 1.5)],
  ship: ["M4 14.5h16l-2.2 4.2a2 2 0 0 1-1.8 1.1H8a2 2 0 0 1-1.8-1.1z", "M12 3.5v11", "M12 5l5 7.5h-5"],
  camera: ["M4 7.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z", "M16 10.5l5-2.8v8.6l-5-2.8"],
  plane: ["M12 2.8c.9 0 1.4.9 1.4 2.3v4.1l7.1 4.3v2l-7.1-2.1v4.2l2 1.5v1.6L12 19.8l-3.4.9v-1.6l2-1.5v-4.2l-7.1 2.1v-2l7.1-4.3V5.1c0-1.4.5-2.3 1.4-2.3z"],
  rocket: ["M12 2.5c3 2.2 4.4 5.5 4.2 9.8L14.5 15h-5l-1.7-2.7C7.6 8 9 4.7 12 2.5z", circ(12, 9.5, 1.6), "M9.5 15 7 19l3.2-1.2M14.5 15l2.5 4-3.2-1.2", "M12 17.5v3"],
  ice: ["M3 15.5 7 9l3 2.5L13.5 5 21 15.5z", "M3 19c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"],
  flood: [wave(8), wave(13), wave(18)],
  wind: ["M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5", "M3 12.5h15a3 3 0 1 1-3 3", "M3 16.5h7"],
  sun: [circ(12, 12, 4), "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"],
  landslide: ["M3 19.5h18L8 5.5z", circ(16, 10.5, 1.3), circ(19, 14, 1)],
  snow: ["M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9", "M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"],
  thermo: ["M10 13.8V5a2 2 0 1 1 4 0v8.8a4 4 0 1 1-4 0z", "M12 9v6.5"],
  drop: ["M12 3.2c3.2 4 6 7.3 6 10.8a6 6 0 0 1-12 0c0-3.5 2.8-6.8 6-10.8z"],
  factory: ["M3 20.5V10.5l5 3v-3l5 3V4h4.5l1 16.5z"],
  target: [circ(12, 12, 5), "M12 3v4M12 17v4M3 12h4M17 12h4"],
  ext: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  play: ["M8 5.5v13l10.5-6.5z"],
};
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[name].map((d) => `<path d="${d}"/>`).join("")}</svg>`;
const extIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G.ext.map((d) => `<path d="${d}"/>`).join("")}</svg>`;

/** Map icons are drawn once on a 2x canvas; dark outlines keep them legible in every visual mode. */
function addIcon(map, id, size, draw) {
  if (map.hasImage(id)) return;
  const pr = 2, c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size * pr);
  const g = c.getContext("2d");
  g.scale(pr, pr);
  draw(g, size);
  map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: pr });
}
function strokeGlyph(g, name, cx, cy, size, color, lw = 2.2) {
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(size / 24, size / 24);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const d of G[name]) g.stroke(new Path2D(d));
  g.restore();
}
function badgeIcon(map, id, glyph, bg, size = 26) {
  const light = luminance(bg) > 0.62;
  addIcon(map, id, size, (g, s) => {
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1.2, 0, Math.PI * 2);
    g.fillStyle = bg; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = "rgba(0,0,0,0.6)"; g.stroke();
    strokeGlyph(g, glyph, s / 2, s / 2, s * 0.6, light ? "#141414" : "#ffffff");
  });
}
function shapeIcon(map, id, path, fill, size, outline = "rgba(0,0,0,0.75)") {
  addIcon(map, id, size, (g, s) => {
    g.save(); g.scale(s / 24, s / 24);
    const p = new Path2D(path);
    g.fillStyle = fill; g.fill(p);
    g.lineWidth = 1.5 * (24 / s) * 1.1; g.lineJoin = "round"; g.strokeStyle = outline; g.stroke(p);
    g.restore();
  });
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/* ================================================================ feed engine */
// A feed = one layer in the registry + a poller. Polls pause while the layer is off
// or the tab is hidden, and never run faster than the feed's refreshMs.
const FEEDS = new Map();
const HITS = [];
const isOn = (f) => app.layers.isOn(typeof f === "string" ? f : f.id);

function defineFeed(f) {
  f.state = { status: "idle", count: null, asOf: null, fetchedAt: 0, attemptAt: 0, error: null, timer: 0, failures: 0, slow: false, pending: null, checkView: false, away: false };
  FEEDS.set(f.id, f);
  if (f.hits) HITS.push(...f.hits.map((h) => ({ ...h, feed: f })));
  app.layers.define({
    id: f.id, title: f.title, category: "Live", description: f.description, keywords: f.keywords ?? [],
    source: f.source, attribution: f.attribution, license: f.license, kind: f.kind ?? "geojson",
    live: true, refreshMs: f.refreshMs, slot: f.slot ?? "live", legend: f.legend,
    add: (map) => startFeed(f, map),
    remove: (map) => stopFeed(f, map),
    ...(f.opacity ? { setOpacity: (map, v) => f.opacity(map, v) } : {}),
  });
}

// add() resolves once the layer is mounted, not when its data lands: a slow provider must not
// hold up the shared-link restore at boot. Tools that need numbers wait with settled().
function startFeed(f, map) {
  f.mount(map);
  f.state.checkView = !!f.points;
  f.state.away = false;
  syncRow(f);
  if (f.state.pending) f.state.pending.then(() => schedule(f));
  else if (!f.state.fetchedAt || (f.state.failures && !f.state.slow) || Date.now() - f.state.attemptAt >= f.refreshMs) refreshFeed(f).then(() => schedule(f));
  else { schedule(f); checkAway(f); }
}
const CARD_FEED = { quake: "earthquakes", event: "natural-events", alert: "alerts-us", volcano: "volcanoes-us", storm: "tropical-cyclones", ship: "ships-baltic", camera: "cameras", aircraft: "aircraft" };
function stopFeed(f, map) {
  clearTimeout(f.state.timer);
  f.state.timer = 0;
  f.state.checkView = f.state.away = false;
  if (CARD_FEED[cardKind] === f.id) app.ui.hideCard();
  f.unmount(map);
  f.off?.();
  syncRow(f);
  renderSummary();
}
/** A load that notices a newer request for the same feed (e.g. a changed window) throws this. */
const SUPERSEDED = new Error("superseded");
function refreshFeed(f) {
  if (!isOn(f)) return Promise.resolve();
  const p = runRefresh(f).finally(() => { if (f.state.pending === p) f.state.pending = null; });
  f.state.pending = p;
  return p;
}
async function runRefresh(f) {
  f.state.attemptAt = Date.now();
  if (f.state.status !== "ok") { f.state.status = "loading"; syncRow(f); }
  try {
    const r = await f.load(app.map, f);
    if (!isOn(f)) return;
    Object.assign(f.state, { status: "ok", error: null, failures: 0, slow: false, fetchedAt: Date.now() });
    if (r) { f.state.count = r.count ?? null; f.state.asOf = r.asOf === null ? null : r.asOf ? new Date(r.asOf).getTime() : Date.now(); }
    checkAway(f);
  } catch (err) {
    if (err === SUPERSEDED || !isOn(f)) return;
    f.state.failures++;
    f.state.error = reason(err);
    f.state.slow = !!err.later;
    f.state.status = f.state.fetchedAt ? "stale" : "error";
    if (f.state.failures === 1) app.ui.toast(`${f.title}: ${f.state.error}. Retrying in ${waitText(retryDelay(f))}.`, { tone: "error", ms: 5200 });
  }
  f.dirty = true;
  syncRow(f);
  renderSummary();
}
// After a failure, try again soon, then settle back to the feed's own period. A provider that
// asked us to wait (err.later) is only asked again on that period.
const BACKOFF = [15000, MIN, 5 * MIN];
function retryDelay(f) {
  const s = f.state;
  if (!s.failures || s.slow) return f.refreshMs;
  return Math.min(f.refreshMs, BACKOFF[s.failures - 1] ?? f.refreshMs);
}
const waitText = (ms) => (ms < MIN ? `${Math.round(ms / 1000)} s` : span(ms) ?? "1 min");
function schedule(f) {
  clearTimeout(f.state.timer);
  f.state.timer = 0;
  if (!isOn(f) || document.hidden || !f.refreshMs) return;
  const wait = Math.max(0, f.state.attemptAt + retryDelay(f) - Date.now());
  f.state.timer = setTimeout(async () => {
    f.state.timer = 0;
    await refreshFeed(f);
    schedule(f);
  }, wait);
}
function retryNow(f) {
  if (!isOn(f) || f.state.pending) return;
  clearTimeout(f.state.timer);
  f.state.timer = 0;
  refreshFeed(f).then(() => schedule(f));
}
/** Once a point feed is switched on, offer to show its data when none of it is in sight. */
function checkAway(f) {
  const s = f.state;
  if (!f.points || !isOn(f) || !(s.checkView || s.away)) return;
  const m = app.map;
  if (m.isMoving()) {
    if (!s.awaitMove) { s.awaitMove = true; m.once("moveend", () => { s.awaitMove = false; checkAway(f); }); }
    return;
  }
  const pts = f.points();
  const away = pts.length > 0 && countInView(pts) === 0;
  s.checkView = false;
  if (away !== s.away) { s.away = away; syncRow(f); }
}
/** Wait (bounded) for a feed's first load so tools can report real numbers. */
async function settled(f, ms = 15000) {
  const t0 = Date.now();
  while (isOn(f) && !f.state.fetchedAt && f.state.status !== "error" && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
}

/* ================================================================ cards */
let cardKind = null, cardCleanups = [];
/** at: [lng, lat] of the item, ringed on the map while its card is open; r: ring radius in px or { mag } for a quake. */
function showLiveCard(kind, html, bind, at = null, r = 13) {
  cleanupCard();
  cardKind = kind;
  app.ui.showCard(`<div class="lv-card" data-live-card="${kind}">${html}</div>`, { onClose: () => cleanupCard() });
  bind?.($("#card-body"));
  if (at) { setPick(at, r); reveal(at); }
}
/** Keep the picked item in sight: the card is a bottom sheet on phones and floats right on desktop. */
function reveal(at) {
  const m = app.map, card = $("#card");
  if (!card || card.hidden || S.follow) return;
  const p = m.project(at), c = card.getBoundingClientRect(), box = m.getContainer().getBoundingClientRect();
  const x = p.x + box.left, y = p.y + box.top;
  const phone = innerWidth <= 720;
  const covered = x > c.left - 24 && x < c.right + 24 && y > c.top - 24 && y < c.bottom + 24;
  if (!covered) return;
  // Centre it in the open space: between the top bar and the sheet, or between the dock/rail and the card.
  const dock = $("#dock"), left = dock && !dock.hidden ? dock.getBoundingClientRect().right : 70;
  const offset = phone ? [0, Math.round((110 + c.top) / 2 - box.top - box.height / 2)] : [Math.round((left + c.left) / 2 - box.left - box.width / 2), 0];
  // The globe cannot be pushed off-centre further than its own radius (512·2^z / 2π px), and
  // MapLibre 6.4's globe easeTo misplaces an offset combined with a zoom change, so solve for the
  // centre on a cloned transform instead.
  const globe = m.getProjection?.()?.type !== "mercator";
  const zoom = globe ? Math.max(m.getZoom(), Math.log2(((Math.abs(offset[0] || offset[1]) + 60) * 2 * Math.PI) / 512)) : m.getZoom();
  const center = solveCenter(at, [box.width / 2 + offset[0], box.height / 2 + offset[1]], zoom);
  m.easeTo(center ? { center, zoom, duration: 650 } : { center: at, duration: 650 });
}
function solveCenter(at, [dx, dy], zoom) {
  try {
    const { LngLat, Point } = app.maplibregl;
    const tr = (app.map.transform ?? app.map._camera?.transform).clone(), target = new LngLat(at[0], at[1]);
    tr.setZoom(zoom);
    let c = target;
    for (let i = 0; i < 5; i++) {
      tr.setCenter(c);
      const p = tr.locationToScreenPoint(target);
      const ex = dx - p.x, ey = dy - p.y;
      if (Math.hypot(ex, ey) < 1.5) return c;
      c = tr.screenPointToLocation(new Point(tr.width / 2 - ex, tr.height / 2 - ey));
      if (!Number.isFinite(c?.lat)) return null;
    }
    tr.setCenter(c);
    const p = tr.locationToScreenPoint(target);
    return Math.hypot(dx - p.x, dy - p.y) < 30 ? c : null;
  } catch { return null; }
}
function onCardClose(fn) { cardCleanups.push(fn); }
function cleanupCard() {
  const fns = cardCleanups;
  cardCleanups = [];
  cardKind = null;
  setPick(null);
  for (const fn of fns) { try { fn(); } catch { /* keep closing */ } }
}
function setPick(at, r = 13) {
  const props = typeof r === "object" ? { r: 13, ...r } : { r };
  const m = app.map;
  if (!at) { GEO.delete("live-pick"); drop(m, ["live-pick", "live-pick-halo"], ["live-pick"]); return; }
  if (!m.getSource("live-pick")) {
    m.addSource("live-pick", { type: "geojson", data: EMPTY() });
    m.addLayer({ id: "live-pick", type: "circle", source: "live-pick", paint: {
      "circle-radius": PICK_RADIUS, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.95 } }, app.layers.anchor("top"));
    m.addLayer({ id: "live-pick-halo", type: "circle", source: "live-pick", paint: {
      "circle-radius": PICK_RADIUS, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "rgba(0,0,0,0.55)", "circle-stroke-width": 5, "circle-stroke-opacity": 0.35 } }, "live-pick");
  }
  setGeo(m, "live-pick", { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: props }] });
}
const kv = (rows) => `<dl class="kv">${rows.filter((r) => r && r[1] != null && r[1] !== "").map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join("")}</dl>`;
const extLink = (href, label, primary = false) => `<a class="btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} ${extIcon}</a>`;
const badge = (label, color) => `<span class="lv-badge"><i style="--c:${color}"></i>${esc(label)}</span>`;

/* ================================================================ earthquakes */
const EQ_WINDOWS = {
  hour: { feed: "all_hour", label: "Hour", phrase: "in the past hour", mag: "All magnitudes", min: null },
  day: { feed: "2.5_day", label: "Day", phrase: "in the past day", mag: "M2.5+", min: 2.5 },
  week: { feed: "2.5_week", label: "Week", phrase: "in the past week", mag: "M2.5+", min: 2.5 },
  month: { feed: "4.5_month", label: "Month", phrase: "in the past month", mag: "M4.5+", min: 4.5 },
};
const EQ = { win: EQ_WINDOWS[store.get("eqWindow")] ? store.get("eqWindow") : "day", feedWin: null, fc: null, meta: null, recent: 0, pulses: new Map(), results: null };
const DEPTH_STOPS = [[0, "#ff3b30"], [35, "#ff8a00"], [70, "#ffc400"], [150, "#b8f335"], [300, "#34d8a0"], [500, "#38bdf8"], [700, "#8b7dff"]];
const DEPTH_COLOR = ["interpolate", ["linear"], ["coalesce", ["get", "depth"], 0], ...DEPTH_STOPS.flat()];
const depthHex = (d) => DEPTH_STOPS.reduce((c, [k, v]) => ((d ?? 0) >= k ? v : c), DEPTH_STOPS[0][1]);
const MAG = ["coalesce", ["get", "mag"], 0];
// Microquakes (the past-hour feed has every magnitude) keep a visible floor.
const magR = (k) => ["interpolate", ["exponential", 1.5], MAG, 0, 2.4 * k, 3, 3.4 * k, 5, 6.5 * k, 7, 12.5 * k, 9, 21 * k];
const EQ_RADIUS = ["interpolate", ["linear"], ["zoom"], 1, magR(0.8), 5, magR(1.1), 10, magR(1.7)];
// Selection ring: fixed size, or hugging a quake circle at every zoom (one top-level zoom interpolate).
const pickR = (k) => ["case", ["has", "mag"], ["max", 12, ["+", magR(k), 6]], ["get", "r"]];
const PICK_RADIUS = ["interpolate", ["linear"], ["zoom"], 1, pickR(0.8), 5, pickR(1.1), 10, pickR(1.7)];
const PAGER = { green: "#1e8e5a", yellow: "#e0b400", orange: "#f07d00", red: "#d0312d" };

function quakeFeature(x, now = Date.now()) {
  const p = x.properties;
  const [lng, lat, depth] = x.geometry.coordinates;
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {
    eid: x.id, mag: p.mag, place: p.place ?? p.title ?? "", time: p.time, depth: depth ?? null, felt: p.felt ?? null,
    tsunami: p.tsunami ?? 0, alert: p.alert ?? null, url: p.url, status: p.status, magType: p.magType ?? "", recent: now - p.time < HOUR ? 1 : 0 } };
}
async function loadQuakes(map) {
  const win = EQ.win;
  const d = await fetchJSON(SRC.usgsFeed(EQ_WINDOWS[win].feed), { timeout: 20000 });
  if (win !== EQ.win) throw SUPERSEDED;
  const now = Date.now();
  const features = (d.features ?? []).filter((x) => x.geometry?.coordinates && x.properties?.mag != null).map((x) => quakeFeature(x, now));
  features.sort((a, b) => a.properties.mag - b.properties.mag);
  EQ.fc = { type: "FeatureCollection", features };
  EQ.meta = d.metadata ?? null;
  EQ.feedWin = win;
  EQ.recent = features.filter((f) => f.properties.recent).length;
  setGeo(map, "live-eq", EQ.fc);
  syncPulses();
  return { count: features.length, asOf: d.metadata?.generated ?? now };
}
const MAG_STOPS = [[0, 2.4], [3, 3.4], [5, 6.5], [7, 12.5], [9, 21]];
/** JS twin of EQ_RADIUS, so the DOM pulse rings match the circles at any zoom. */
function quakeRadius(mag, zoom) {
  const k = zoom <= 1 ? 0.8 : zoom <= 5 ? 0.8 + ((zoom - 1) / 4) * 0.3 : zoom <= 10 ? 1.1 + ((zoom - 5) / 5) * 0.6 : 1.7;
  const m = clamp(mag ?? 0, 0, 9);
  let i = 0;
  while (i < MAG_STOPS.length - 2 && m > MAG_STOPS[i + 1][0]) i++;
  const [x0, y0] = MAG_STOPS[i], [x1, y1] = MAG_STOPS[i + 1];
  const t = (1.5 ** (m - x0) - 1) / (1.5 ** (x1 - x0) - 1);
  return (y0 + (y1 - y0) * t) * k;
}
/** Quakes under an hour old get a CSS pulse ring (compositor-only, so the map is not repainted every frame). */
function syncPulses() {
  const m = app.map, want = new Map();
  if (m.getLayer("live-eq") && EQ.fc) {
    for (const f of EQ.fc.features.filter((x) => x.properties.recent).slice(-25)) want.set(f.properties.eid, f);
  }
  for (const [id, mk] of EQ.pulses) if (!want.has(id)) { mk.remove(); EQ.pulses.delete(id); }
  const z = m.getZoom();
  for (const [id, f] of want) {
    let mk = EQ.pulses.get(id);
    if (!mk) {
      const el = document.createElement("div");
      el.className = "lv-pulse";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = "<i></i>";
      mk = new app.maplibregl.Marker({ element: el, opacityWhenCovered: "0" }).setLngLat(f.geometry.coordinates).addTo(m);
      EQ.pulses.set(id, mk);
    }
    const el = mk.getElement();
    el.style.setProperty("--d", `${Math.round(quakeRadius(f.properties.mag, z) * 2 + 4)}px`);
    el.style.setProperty("--c", depthHex(f.properties.depth));
  }
}
function quakeLayers(map, source, prefix, results = false) {
  const before = app.layers.anchor("live");
  if (!results) {
    map.addLayer({ id: `${prefix}-halo`, type: "circle", source, filter: [">=", MAG, 5], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, magR(1.9), 5, magR(2.5), 10, magR(3.4)],
      "circle-color": DEPTH_COLOR, "circle-opacity": 0.22, "circle-blur": 0.9 } }, before);
  }
  map.addLayer({ id: prefix, type: "circle", source, layout: { "circle-sort-key": MAG }, paint: {
    "circle-radius": EQ_RADIUS, "circle-color": DEPTH_COLOR, "circle-opacity": results ? 0.35 : 0.88,
    "circle-stroke-color": results ? DEPTH_COLOR : "rgba(255,255,255,0.92)", "circle-stroke-width": results ? 2.4 : 0.9 } }, before);
  map.addLayer({ id: `${prefix}-lbl`, type: "symbol", source, filter: [">=", MAG, results ? 4.5 : 5.5], layout: {
    "text-field": ["concat", "M", ["number-format", MAG, { "min-fraction-digits": 1, "max-fraction-digits": 1 }]],
    "text-font": ["Noto Sans Bold"], "text-size": 11, "text-variable-anchor": ["left", "right", "top", "bottom"],
    "text-radial-offset": ["interpolate", ["linear"], MAG, 4.5, 0.8, 6, 1.1, 8, 1.9], "text-allow-overlap": false },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.5 } }, before);
}
function quakeCard(p, coords, fromResults = false) {
  const [lng, lat] = coords;
  const w = EQ_WINDOWS[EQ.feedWin ?? EQ.win];
  const pager = p.alert ? `${badge(`${cap(p.alert)}`, PAGER[p.alert] ?? "#999")}` : "None issued";
  const html = `
    <div class="lv-head">
      <div class="lv-mag" style="--c:${depthHex(p.depth)}"><b>${Number(p.mag).toFixed(1)}</b><span>${esc(p.magType || "mag")}</span></div>
      <div class="grow">
        <div class="eyebrow">Earthquake · ${p.status === "reviewed" ? "reviewed" : "automatic solution"}</div>
        <h3>${esc(p.place || "Unnamed region")}</h3>
        <div class="sub">${esc(ago(p.time))}</div>
      </div>
    </div>
    ${kv([
      ["Time (UTC)", stampSec(p.time)],
      ["Local time", `<span id="lv-eq-local">…</span>`, true],
      ["Depth", p.depth != null ? `${fmt(p.depth, 1)} km` : "Not reported"],
      ["Felt reports", p.felt ? `${fmt(p.felt)} (Did You Feel It?)` : "None yet"],
      ["Tsunami flag", p.tsunami ? "Yes: a large event in an oceanic region. Official warnings: tsunami.gov" : "No"],
      ["PAGER alert", pager, true],
      ["Epicentre", `${lat.toFixed(3)}, ${lng.toFixed(3)}`],
    ])}
    <div class="card-actions">
      ${p.url ? extLink(p.url, "USGS event page", true) : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly to</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="near">Quakes nearby</button>
    </div>
    <p class="note">Source: USGS ComCat${fromResults ? " (search)" : ` ${w.mag} feed, ${w.phrase}`} · public domain${EQ.meta?.generated && !fromResults ? ` · feed generated ${hhmm(EQ.meta.generated)}` : ""}.</p>`;
  showLiveCard(fromResults ? "quake-search" : "quake", html, (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [lng, lat], zoom: Math.max(app.map.getZoom(), 7), speed: 1.3 });
    body.querySelector('[data-act="near"]').onclick = () => app.tools.run("get_earthquakes", { near: { lat, lng, radius_km: 300 }, days: 365, min_magnitude: 3, limit: 200 }).catch(() => {});
    localTime(lat, lng, p.time).then((s) => { const el = $("#lv-eq-local"); if (el) el.textContent = s ?? "Unavailable"; });
  }, [lng, lat], { mag: Number(p.mag) || 0 });
}
function showLargestQuake() {
  const top = EQ.fc?.features[EQ.fc.features.length - 1];
  if (!top) return;
  quakeCard(top.properties, top.geometry.coordinates);
  flyToOpen(top.geometry.coordinates, 3);
}
function showQuakeResults(features) {
  const m = app.map;
  EQ.results = { type: "FeatureCollection", features };
  if (!m.getSource("live-eqq")) {
    m.addSource("live-eqq", { type: "geojson", data: EQ.results });
    quakeLayers(m, "live-eqq", "live-eqq", true);
  } else setGeo(m, "live-eqq", EQ.results);
  FEEDS.get("earthquakes").dirty = true;
  syncRow(FEEDS.get("earthquakes"));
}
function clearQuakeResults() {
  EQ.results = null;
  if (cardKind === "quake-search") app.ui.hideCard();
  drop(app.map, ["live-eqq-lbl", "live-eqq"], ["live-eqq"]);
  FEEDS.get("earthquakes").dirty = true;
  syncRow(FEEDS.get("earthquakes"));
}

defineFeed({
  id: "earthquakes", title: "Earthquakes", glyph: "quake", group: "hazards",
  description: "Earthquakes worldwide from the USGS real-time feeds (past hour, day, week or month), sized by magnitude and coloured by depth; events from the last hour pulse. Click one for time, depth, felt reports, tsunami flag and PAGER alert.",
  keywords: ["earthquake", "earthquakes", "quake", "seismic", "tremor", "usgs", "live"],
  source: "USGS Earthquake Hazards Program — real-time GeoJSON feeds (ComCat)",
  attribution: "Earthquakes: U.S. Geological Survey",
  license: "Public domain (US Government work)",
  sourceShort: "USGS Earthquake Hazards Program", licenseShort: "Public domain",
  refreshMs: 60000,
  legend: `<div class="lv-grad" style="background:linear-gradient(90deg,${DEPTH_STOPS.map(([, c]) => c).join(",")})"></div><div class="lv-ends"><span>Shallow</span><span>700 km deep</span></div>`,
  blurb: () => `${EQ_WINDOWS[EQ.win].mag} worldwide, ${EQ_WINDOWS[EQ.win].phrase.replace("in the ", "")}`,
  countText: (f) => (f.state.count != null ? plural(f.state.count, "event") : null),
  mount(map) {
    map.addSource("live-eq", { type: "geojson", data: EQ.fc ?? EMPTY() });
    quakeLayers(map, "live-eq", "live-eq");
    syncPulses();
  },
  unmount(map) {
    drop(map, ["live-eq-lbl", "live-eq", "live-eq-halo"], ["live-eq"]);
    syncPulses();
  },
  load: loadQuakes,
  summary() {
    if (!EQ.fc) return null;
    const w = EQ_WINDOWS[EQ.feedWin];
    const n = EQ.fc.features.length;
    const top = EQ.fc.features[n - 1]?.properties;
    return `${plural(n, "earthquake")}${w.min ? ` M${w.min}+` : ""} ${w.phrase}${top ? ` (largest M${top.mag.toFixed(1)})` : ""}`;
  },
  summaryHTML(f) {
    const s = esc(this.summary(f) ?? "");
    const top = EQ.fc?.features[EQ.fc.features.length - 1]?.properties;
    if (!top) return s;
    const label = `largest M${top.mag.toFixed(1)}`;
    return s.replace(`(${label})`, `<span class="lv-nw">(<button type="button" class="lv-link" data-act="eq-largest" title="${esc(top.place || "Show on the globe")}">${label}</button>)</span>`);
  },
  points: () => (EQ.fc?.features ?? []).map((x) => x.geometry.coordinates),
  alwaysOpts: () => !!EQ.results,
  opts(f) {
    const w = EQ_WINDOWS[EQ.win];
    const results = EQ.results ? `<div class="lv-inline"><span>${plural(EQ.results.features.length, "search result")} on the map</span><button type="button" class="btn btn-ghost btn-sm" data-act="clear-eq">Clear</button></div>` : "";
    if (!isOn(f)) return results;
    return `
      <div class="seg" role="group" aria-label="Earthquake time window">${Object.entries(EQ_WINDOWS).map(([k, x]) => `<button type="button" data-win="${k}" aria-pressed="${k === EQ.win}">${x.label}</button>`).join("")}</div>
      <p class="lv-note">${esc(w.mag)} worldwide ${esc(w.phrase)}. Size shows magnitude, colour shows depth; events from the last hour pulse.</p>
      <div class="lv-legend"><div class="lv-grad" style="background:linear-gradient(90deg,${DEPTH_STOPS.map(([, c]) => c).join(",")})"></div>
      <div class="lv-ends"><span>Shallow</span><span>70 km</span><span>300 km</span><span>700 km deep</span></div></div>
      ${results}`;
  },
  bindOpts(el, f) {
    el.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => {
      if (EQ.win === b.dataset.win) return;
      EQ.win = b.dataset.win;
      store.set("eqWindow", EQ.win);
      f.dirty = true;
      if (isOn(f)) { f.state.status = "loading"; refreshFeed(f).then(() => schedule(f)); }
      syncRow(f);
    }));
    el.querySelector('[data-act="clear-eq"]')?.addEventListener("click", clearQuakeResults);
  },
  hits: [{
    layers: ["live-eq", "live-eq-halo", "live-eq-lbl", "live-eqq", "live-eqq-lbl"],
    click: (f) => quakeCard(f.properties, f.geometry.coordinates, f.layer.id.startsWith("live-eqq")),
    hover: (f) => `M${Number(f.properties.mag).toFixed(1)} · ${f.properties.place} · ${ago(f.properties.time)}`,
  }],
});

/* ================================================================ natural events (EONET) */
const EV_CATS = {
  wildfires: { label: "Wildfires", glyph: "flame", color: "#ff6b35" },
  severeStorms: { label: "Severe storms", glyph: "cyclone", color: "#8b8cff" },
  volcanoes: { label: "Volcanoes", glyph: "volcano", color: "#ff3d6e" },
  seaLakeIce: { label: "Sea & lake ice", glyph: "ice", color: "#5fd4e8" },
  floods: { label: "Floods", glyph: "flood", color: "#3b82f6" },
  dustHaze: { label: "Dust & haze", glyph: "wind", color: "#c9a26b" },
  drought: { label: "Drought", glyph: "sun", color: "#f4a340" },
  landslides: { label: "Landslides", glyph: "landslide", color: "#b07a52" },
  snow: { label: "Snow", glyph: "snow", color: "#dbeafe" },
  tempExtremes: { label: "Temperature extremes", glyph: "thermo", color: "#ef4444" },
  waterColor: { label: "Water colour", glyph: "drop", color: "#14b8a6" },
  manmade: { label: "Man-made", glyph: "factory", color: "#a3a3a3" },
  earthquakes: { label: "Earthquakes", glyph: "quake", color: "#f59e0b" },
  other: { label: "Other", glyph: "globe", color: "#cbd5e1" },
};
const CHIP_CATS = ["wildfires", "severeStorms", "volcanoes", "seaLakeIce", "floods", "dustHaze", "drought", "landslides", "snow", "tempExtremes", "waterColor", "manmade"];
const EV = { events: [], counts: {}, off: new Set(store.get("evOff") ?? []) };
const EV_SYNONYMS = [
  [/wild ?fires?|fires?|bush ?fires?/i, "wildfires"], [/storms?|hurricanes?|cyclones?|typhoons?|tropical/i, "severeStorms"],
  [/volcan/i, "volcanoes"], [/ice|iceberg/i, "seaLakeIce"], [/flood/i, "floods"], [/dust|haze|smoke/i, "dustHaze"],
  [/drought/i, "drought"], [/landslide|mudslide/i, "landslides"], [/snow|blizzard/i, "snow"],
  [/heat|cold|temperature/i, "tempExtremes"], [/water ?colou?r|algae|bloom/i, "waterColor"], [/man-?made|industrial/i, "manmade"],
  [/earthquake|quake/i, "earthquakes"],
];
const evCat = (text) => (!text ? null : EV_CATS[text] ? text : EV_SYNONYMS.find(([re]) => re.test(text))?.[1] ?? null);

function parseEvent(e) {
  const geoms = (e.geometry ?? []).map((g) => {
    let c = null;
    if (g.type === "Point") c = g.coordinates;
    else if (g.type === "Polygon" && g.coordinates?.[0]?.length) {
      const ring = g.coordinates[0];
      c = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
    }
    return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { t: Date.parse(g.date), c: [c[0], c[1]], mag: g.magnitudeValue, unit: g.magnitudeUnit } : null;
  }).filter((g) => g && Number.isFinite(g.t)).sort((a, b) => a.t - b.t);
  if (!geoms.length) return null;
  const cat0 = e.categories?.[0]?.id;
  const last = geoms[geoms.length - 1];
  return { id: e.id, title: e.title, desc: e.description, cat: EV_CATS[cat0] ? cat0 : "other", catTitle: e.categories?.[0]?.title ?? "Event", closed: e.closed, sources: e.sources ?? [], geoms, first: geoms[0].t, last: last.t, pos: last.c, mag: last.mag, unit: last.unit };
}
async function eonetEvents(query) {
  const d = await parseJSONText(`${SRC.eonet}?${query}`, { timeout: 25000 });
  return (d.events ?? []).map(parseEvent).filter(Boolean);
}
function evFilter() {
  const on = Object.keys(EV_CATS).filter((c) => !EV.off.has(c));
  return ["in", ["get", "cat"], ["literal", on]];
}
async function loadEvents(map) {
  const [recent, volcanoes] = await Promise.all([
    eonetEvents("status=open&days=30&limit=500"),
    eonetEvents("status=open&category=volcanoes&limit=100").catch(() => []),
  ]);
  const byId = new Map();
  for (const e of [...recent, ...volcanoes]) byId.set(e.id, e);
  EV.events = [...byId.values()].sort((a, b) => b.last - a.last);
  EV.counts = {};
  for (const e of EV.events) EV.counts[e.cat] = (EV.counts[e.cat] ?? 0) + 1;
  drawEvents(map);
  return { count: EV.events.length, asOf: EV.events.length ? Math.max(...EV.events.map((e) => e.last)) : Date.now() };
}
function drawEvents(map) {
  const pts = [], tracks = [];
  EV.events.forEach((e, k) => {
    pts.push({ type: "Feature", geometry: { type: "Point", coordinates: e.pos }, properties: { k, cat: e.cat } });
    if (e.geoms.length > 1) {
      for (const line of splitDateline(e.geoms.map((g) => g.c))) tracks.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { k, cat: e.cat } });
    }
  });
  setGeo(map, "live-ev", { type: "FeatureCollection", features: pts });
  setGeo(map, "live-ev-track", { type: "FeatureCollection", features: tracks });
}
/** persist: only the visitor's own chip choices are remembered; a tool's one-off filter is not. */
function applyEvFilter(persist = true) {
  const m = app.map;
  for (const id of ["live-ev", "live-ev-track"]) if (m.getLayer(id)) m.setFilter(id, evFilter());
  if (persist) store.set("evOff", [...EV.off]);
}
function eventCard(e) {
  const c = EV_CATS[e.cat];
  const sources = e.sources.filter((s) => /^https?:/.test(s.url ?? ""));
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${c.color}">${icon(c.glyph, 22)}</div>
      <div class="grow">
        <div class="eyebrow">${esc(e.catTitle)} · ${e.closed ? "closed" : "open"}</div>
        <h3>${esc(e.title)}</h3>
        <div class="sub">Last update ${esc(ago(e.last))}</div>
      </div>
    </div>
    ${e.desc ? `<p style="margin-top:12px">${esc(e.desc)}</p>` : ""}
    ${kv([
      ["Latest position", `${e.pos[1].toFixed(3)}, ${e.pos[0].toFixed(3)}`],
      ["Latest report", stamp(e.last)],
      ["First report", stamp(e.first)],
      e.mag != null ? ["Magnitude", `${fmt(e.mag, 1)} ${e.unit ?? ""}`.trim()] : null,
      ["Observations", fmt(e.geoms.length)],
    ])}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly to</button>
      ${sources.slice(0, 3).map((s) => extLink(s.url, s.id)).join("")}
    </div>
    <p class="note">NASA EONET v3 · public domain · event record ${esc(e.id)}${sources.length ? `, compiled from ${esc(sources.map((s) => s.id).join(", "))}` : ""}.</p>`;
  showLiveCard("event", html, (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: e.pos, zoom: Math.max(app.map.getZoom(), e.cat === "severeStorms" ? 4.5 : 7), speed: 1.3 });
  }, e.pos, 16);
}

defineFeed({
  id: "natural-events", title: "Natural events", glyph: "globe", group: "hazards",
  description: "Open natural events tracked by NASA EONET: wildfires, severe storms with their tracks, volcanoes, icebergs, floods, dust, drought, landslides and more, filterable by category.",
  keywords: ["natural events", "eonet", "wildfires", "storms", "volcanoes", "icebergs", "floods", "hazards", "disasters", "live"],
  source: "NASA Earth Observatory Natural Event Tracker (EONET) v3",
  attribution: "Natural events: NASA EONET",
  license: "NASA open data (no copyright; attribution requested)",
  sourceShort: "NASA EONET", licenseShort: "Public domain",
  refreshMs: 15 * MIN,
  blurb: () => "Wildfires, storms, volcanoes, ice and more",
  countText: (f) => (f.state.count != null ? `${fmt(f.state.count)} open` : null),
  mount(map) {
    for (const [id, c] of Object.entries(EV_CATS)) badgeIcon(map, `live-ev-${id}`, c.glyph, c.color);
    addGeo(map, "live-ev");
    addGeo(map, "live-ev-track");
    const before = app.layers.anchor("live");
    const color = ["match", ["get", "cat"], ...Object.entries(EV_CATS).flatMap(([k, c]) => [k, c.color]), "#cbd5e1"];
    map.addLayer({ id: "live-ev-track", type: "line", source: "live-ev-track", filter: evFilter(), layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 6, 2.4], "line-opacity": 0.75, "line-dasharray": [1.5, 1.5] } }, before);
    map.addLayer({ id: "live-ev", type: "symbol", source: "live-ev", filter: evFilter(), layout: {
      "icon-image": ["concat", "live-ev-", ["get", "cat"]], "icon-allow-overlap": true, "icon-ignore-placement": true,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 5, 0.95, 9, 1.1], "symbol-sort-key": ["get", "k"] } }, before);
    if (EV.events.length) drawEvents(map);
  },
  unmount(map) { drop(map, ["live-ev", "live-ev-track"], ["live-ev", "live-ev-track"]); },
  points: () => EV.events.filter((e) => !EV.off.has(e.cat)).map((e) => e.pos),
  load: loadEvents,
  summary() {
    if (!EV.events.length) return null;
    const out = [plural(EV.events.length, "open natural event")];
    if (EV.counts.volcanoes) out.push(plural(EV.counts.volcanoes, "open volcano event"));
    return out;
  },
  opts(f) {
    const loaded = !!f.state.fetchedAt;
    const all = [...CHIP_CATS, "earthquakes", "other"];
    // Once loaded, chips are the categories with open events (plus any the visitor has hidden);
    // the empty ones are named in one line instead of a row of zeros.
    const cats = loaded ? all.filter((k) => EV.counts[k] || EV.off.has(k)) : [];
    const empty = loaded ? CHIP_CATS.filter((k) => !EV.counts[k] && !EV.off.has(k)) : [];
    cats.sort((a, b) => (EV.counts[b] ?? 0) - (EV.counts[a] ?? 0));
    const hidden = loaded ? cats.filter((k) => EV.off.has(k)).length : all.filter((k) => EV.off.has(k)).length;
    return `
      ${!cats.length ? "" : `<div class="lv-chips lv-filter" role="group" aria-label="Show event categories">${cats.map((k) => {
        const on = !EV.off.has(k), n = EV.counts[k] ?? 0;
        return `<button type="button" class="chip chip-btn lv-chip" data-cat="${k}" aria-pressed="${on}"${loaded && !n ? " data-empty" : ""}><i style="--c:${EV_CATS[k].color}"></i>${esc(EV_CATS[k].label)}${loaded ? `<span class="n">${n}</span>` : ""}</button>`;
      }).join("")}</div>`}
      ${hidden ? `<div class="lv-inline"><span>${plural(hidden, "category", "categories")} hidden</span><button type="button" class="btn btn-ghost btn-sm" data-act="ev-all">Show all</button></div>` : ""}
      <p class="lv-note">${empty.length ? `Nothing open right now in ${esc(empty.map((k) => EV_CATS[k].label.toLowerCase()).join(", "))}. ` : ""}Open events with a report in the past 30 days, plus every open volcano event. Dashed lines trace storm and iceberg tracks.</p>`;
  },
  bindOpts(el, f) {
    el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.cat;
      if (EV.off.has(k)) EV.off.delete(k); else EV.off.add(k);
      applyEvFilter();
      f.dirty = true;
      syncRow(f, `[data-cat="${k}"]`);
    }));
    el.querySelector('[data-act="ev-all"]')?.addEventListener("click", () => {
      EV.off.clear();
      applyEvFilter();
      f.dirty = true;
      syncRow(f, '[data-cat]');
    });
  },
  hits: [{
    layers: ["live-ev", "live-ev-track"],
    click: (f) => { const e = EV.events[f.properties.k]; if (e) eventCard(e); },
    hover: (f) => { const e = EV.events[f.properties.k]; return e ? `${e.title} · ${ago(e.last)}` : null; },
  }],
});

/* ================================================================ fires (GIBS WMS) */
const FIRE_SATS = [["VIIRS_NOAA20_Thermal_Anomalies_375m_All", "NOAA-20"], ["VIIRS_NOAA21_Thermal_Anomalies_375m_All", "NOAA-21"], ["VIIRS_SNPP_Thermal_Anomalies_375m_All", "Suomi NPP"]];
// days: { a: today, b: yesterday } as UTC dates; avail: the satellites GIBS has published for each day.
const FIRE = { mode: store.get("fireMode") === "yesterday" ? "yesterday" : "both", urls: {}, days: null, avail: {} };
const utcDay = (offset = 0) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
const wmsGetMap = (layers, day, bbox, size) => `${SRC.gibsWms}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layers}&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=true&TIME=${day}`;
const fireUrl = (day, layers, bucket) => `${wmsGetMap(layers.join(","), day, "{bbox-epsg-3857}", 256)}&_=${bucket}`;
/** GIBS answers an unpublished day with an XML error (HTTP 200), which MapLibre cannot decode, so ask first. */
async function fireProbe(day, layer) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(wmsGetMap(layer, day, "-20037508.34,-20037508.34,20037508.34,20037508.34", 8), { signal: ctrl.signal });
    return res.ok && /^image\//.test(res.headers.get("content-type") ?? "");
  } catch { return null; } finally { clearTimeout(t); }
}
function fireTiles(map) {
  if (!FIRE.days) return;
  const bucket = Math.floor(Date.now() / (30 * MIN));
  for (const [id, key] of [["live-fires-a", "a"], ["live-fires-b", "b"]]) {
    const day = FIRE.days[key], layers = FIRE.avail[day] ?? [];
    const show = layers.length > 0 && (key === "b" || FIRE.mode === "both");
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    if (!show) continue;
    const url = fireUrl(day, layers, bucket);
    const src = map.getSource(id);
    if (src && FIRE.urls[id] !== url) { src.setTiles([url]); FIRE.urls[id] = url; }
  }
}
/** The UTC days actually on the map, e.g. "28 Sep + 29 Sep (UTC)"; null before the first probe. */
function fireDays() {
  if (!FIRE.days) return null;
  const shown = [FIRE.days.b, ...(FIRE.mode === "both" ? [FIRE.days.a] : [])].filter((d) => FIRE.avail[d]?.length);
  if (!shown.length) return "No detections published yet";
  return `${shown.map((d) => dayUTC(Date.parse(d))).join(" + ")} (UTC)`;
}
const fireTodayMissing = () => FIRE.days && FIRE.mode === "both" && !FIRE.avail[FIRE.days.a]?.length;
/** Names of the satellites whose detections for today are published so far, when not all of them are. */
function fireTodayPartial() {
  const got = FIRE.days && FIRE.mode === "both" ? FIRE.avail[FIRE.days.a] ?? [] : [];
  if (!got.length || got.length === FIRE_SATS.length) return null;
  return FIRE_SATS.filter(([l]) => got.includes(l)).map(([, n]) => n).join(" and ");
}

defineFeed({
  id: "fires", title: "Active fires · last 48 h", glyph: "flame", group: "hazards", kind: "raster", slot: "overlay",
  description: "Thermal anomalies (active fires, also gas flares and volcanoes) detected by the VIIRS 375 m sensors on NOAA-20, NOAA-21 and Suomi NPP, for today plus yesterday or yesterday only (UTC days). For earlier dates use Layers › Active fires · VIIRS 375 m.",
  keywords: ["fires", "wildfires", "active fires", "firms", "viirs", "thermal anomalies", "hotspots", "burning", "live"],
  source: "NASA FIRMS / LANCE VIIRS 375 m thermal anomalies via NASA GIBS WMS",
  attribution: "Fires: NASA FIRMS (LANCE) via NASA EOSDIS GIBS",
  license: "NASA open data (no copyright; attribution requested)",
  sourceShort: "NASA FIRMS via GIBS", licenseShort: "Public domain",
  refreshMs: 30 * MIN,
  blurb: () => "VIIRS 375 m heat detections, worldwide",
  countText: () => fireDays(),
  summary: () => (fireDays() && FIRE.days && Object.values(FIRE.avail).some((x) => x.length) ? `VIIRS fire detections for ${fireDays()}` : null),
  mount(map) {
    FIRE.urls = {};
    for (const id of ["live-fires-b", "live-fires-a"]) {
      // Tiles are set once GIBS confirms the day is published; until then the layer stays hidden.
      map.addSource(id, { type: "raster", tiles: [fireUrl(utcDay(id.endsWith("a") ? 0 : 1), FIRE_SATS.map(([l]) => l), 0)], tileSize: 256, maxzoom: 12, attribution: this.attribution });
      // GIBS draws each detection at a fixed pixel size, so thin it out at world scale.
      map.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.62, 4, 0.8, 7, 0.95], "raster-fade-duration": 200 } }, app.layers.anchor("labels"));
    }
    fireTiles(map);
  },
  unmount(map) { drop(map, ["live-fires-a", "live-fires-b"], ["live-fires-a", "live-fires-b"]); },
  opacity(map, v) { for (const id of ["live-fires-a", "live-fires-b"]) if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", v); },
  async load(map) {
    const days = { a: utcDay(0), b: utcDay(1) };
    const checks = await Promise.all([days.a, days.b].flatMap((day) => FIRE_SATS.map(([layer]) => fireProbe(day, layer).then((ok) => ({ day, layer, ok })))));
    if (checks.every((c) => c.ok === null)) throw new Error("couldn't reach gibs.earthdata.nasa.gov");
    const avail = {};
    for (const c of checks) {
      avail[c.day] ??= [];
      // A failed probe for yesterday is a network hiccup, not a gap: yesterday is always published.
      if (c.ok || (c.ok === null && c.day === days.b)) avail[c.day].push(c.layer);
    }
    FIRE.days = days;
    FIRE.avail = avail;
    fireTiles(map);
    return { count: null, asOf: null };
  },
  opts() {
    return `
      <div class="seg" role="group" aria-label="Fire detection days">
        <button type="button" data-fire="both" aria-pressed="${FIRE.mode === "both"}">Today + yesterday</button>
        <button type="button" data-fire="yesterday" aria-pressed="${FIRE.mode === "yesterday"}">Yesterday</button>
      </div>
      <p class="lv-note">Each red dot is a satellite detection of heat: mostly vegetation fires, also gas flares, volcanoes and industry. ${fireTodayMissing() ? `NASA has not published detections for ${esc(dayUTC(Date.parse(FIRE.days.a)))} (UTC) yet, so only the previous day is shown.` : `Today's map fills in as satellites pass over, so the latest UTC day is incomplete${fireTodayPartial() ? ` (so far only from ${esc(fireTodayPartial())})` : ""}.`}</p>`;
  },
  bindOpts(el, f) {
    el.querySelectorAll("[data-fire]").forEach((b) => (b.onclick = () => {
      FIRE.mode = b.dataset.fire;
      store.set("fireMode", FIRE.mode);
      if (isOn(f)) fireTiles(app.map);
      f.dirty = true;
      syncRow(f);
    }));
  },
});

/* ================================================================ US radar (IEM NEXRAD) */
const RADAR = { valid: null, quorum: null };
const radarUrl = (v) => `${SRC.iemTiles}?v=${v}`;
defineFeed({
  id: "radar-us", title: "Weather radar (US)", glyph: "radar", group: "weather", kind: "raster", slot: "overlay",
  description: "NEXRAD base-reflectivity composite over the continental United States, refreshed every 5 minutes.",
  keywords: ["radar", "weather radar", "nexrad", "rain", "storms", "precipitation", "united states", "live"],
  source: "NOAA/NWS NEXRAD composite, tiled by the Iowa Environmental Mesonet (IEM)",
  attribution: "NEXRAD via Iowa Environmental Mesonet",
  license: "NOAA NEXRAD data: public domain; tiles courtesy of Iowa State University IEM",
  sourceShort: "NEXRAD via Iowa Environmental Mesonet", licenseShort: "Public domain",
  refreshMs: 5 * MIN,
  blurb: () => "Continental US, every 5 minutes",
  countText: () => (RADAR.valid && RADAR.quorum ? `${RADAR.quorum} radars` : null),
  mount(map) {
    map.addSource("live-radar", { type: "raster", tiles: [radarUrl(RADAR.valid ?? 0)], tileSize: 256, maxzoom: 9, bounds: [-128, 21, -64, 51], attribution: this.attribution });
    map.addLayer({ id: "live-radar", type: "raster", source: "live-radar", paint: { "raster-opacity": 0.78, "raster-fade-duration": 250 } }, app.layers.anchor("labels"));
  },
  unmount(map) { drop(map, ["live-radar"], ["live-radar"]); },
  opacity(map, v) { if (map.getLayer("live-radar")) map.setPaintProperty("live-radar", "raster-opacity", v); },
  async load(map) {
    const d = await fetchJSON(SRC.iemMeta, { timeout: 15000 });
    const valid = Date.parse(d.meta?.valid);
    if (!Number.isFinite(valid)) throw new Error("IEM returned no scan time");
    if (valid !== RADAR.valid) {
      RADAR.valid = valid;
      map.getSource("live-radar")?.setTiles([radarUrl(valid)]);
    }
    RADAR.quorum = d.meta?.radar_quorum ?? null;
    return { count: null, asOf: valid };
  },
  summary: () => (RADAR.valid ? `US radar ${hhmm(RADAR.valid)}` : null),
  opts: () => `
    <div class="lv-legend"><div class="lv-grad" style="background:linear-gradient(90deg,#9be7ff,#1f9ed1,#16c616,#0b8a0b,#ffe000,#ff9a00,#ff1a1a,#b0006e,#f0f)"></div>
    <div class="lv-ends"><span>Light</span><span>Moderate</span><span>Heavy · hail</span></div></div>
    <p class="lv-note">Base reflectivity mosaic of the NEXRAD network. Coverage is the lower 48 states; the image updates about every 5 minutes.</p>`,
});

/* ================================================================ precipitation (GPM IMERG) */
const PRECIP = { time: null };
const imergUrl = (t) => `${SRC.imerg}/${t}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
defineFeed({
  id: "precipitation", title: "Precipitation (global)", glyph: "rain", group: "weather", kind: "raster", slot: "overlay",
  description: "Global precipitation rate from NASA GPM IMERG (30-minute Early run), the latest half-hour available in NASA GIBS.",
  keywords: ["precipitation", "rain", "snow", "rainfall", "imerg", "gpm", "global", "weather", "live"],
  source: "NASA GPM IMERG Early 30-minute precipitation rate via NASA GIBS",
  attribution: "Precipitation: NASA GPM IMERG via NASA EOSDIS GIBS",
  license: "NASA open data (no copyright; attribution requested)",
  sourceShort: "NASA GPM IMERG via GIBS", licenseShort: "Public domain",
  refreshMs: 30 * MIN,
  blurb: () => "Worldwide, 30-minute rate (about 5 h behind)",
  summary: (f) => (PRECIP.time ? `global rain rate for ${f.countText().replace(/^Rate for /, "")}` : null),
  countText: () => {
    if (!PRECIP.time) return null;
    const day = dayUTC(PRECIP.time) === dayUTC(Date.now()) ? "" : `${dayUTC(PRECIP.time)}, `;
    return `Rate for ${day}${hhmm(PRECIP.time).replace(" UTC", "")}–${hhmm(PRECIP.time + 30 * MIN)}`;
  },
  mount(map) {
    map.addSource("live-precip", { type: "raster", tiles: [imergUrl(PRECIP.time ? new Date(PRECIP.time).toISOString().slice(0, 19) + "Z" : "default")], tileSize: 256, maxzoom: 6, attribution: this.attribution });
    map.addLayer({ id: "live-precip", type: "raster", source: "live-precip", paint: { "raster-opacity": 0.8, "raster-fade-duration": 250 } }, app.layers.anchor("labels"));
  },
  unmount(map) { drop(map, ["live-precip"], ["live-precip"]); },
  opacity(map, v) { if (map.getLayer("live-precip")) map.setPaintProperty("live-precip", "raster-opacity", v); },
  async load(map) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try { res = await fetch(imergUrl("default").replace("{z}/{y}/{x}", "0/0/0"), { signal: ctrl.signal }); }
    catch { throw new Error("couldn't reach gibs.earthdata.nasa.gov"); }
    finally { clearTimeout(to); }
    const actual = res.headers.get("layer-time-actual");
    const t = Date.parse(actual ?? "");
    if (!res.ok || !Number.isFinite(t)) throw new Error("GIBS did not report the latest IMERG time");
    if (t !== PRECIP.time) {
      PRECIP.time = t;
      map.getSource("live-precip")?.setTiles([imergUrl(actual)]);
    }
    return { count: null, asOf: t };
  },
  opts: () => `
    <div class="lv-legend"><img class="lv-legend-img" src="${SRC.imergLegend}" alt="Precipitation rate colour scale in millimetres per hour" loading="lazy" onerror="this.remove()"></div>
    <p class="lv-note">Satellite estimate of rain and snow rate (mm/h), merged from the GPM constellation. The Early run arrives about 4 to 6 hours after the fact.</p>`,
});

/* ================================================================ aurora (SWPC OVATION) */
const AURORA = { obs: null, fcst: null, max: null, kp: null, kpTime: null, url: null };
const AURORA_STOPS = [[4, [70, 255, 140, 0]], [10, [70, 255, 140, 100]], [20, [120, 255, 90, 160]], [40, [255, 238, 70, 200]], [65, [255, 140, 40, 215]], [90, [255, 50, 60, 230]]];
function auroraColor(v) {
  if (v <= AURORA_STOPS[0][0]) return null;
  for (let i = 1; i < AURORA_STOPS.length; i++) {
    const [k1, c1] = AURORA_STOPS[i];
    if (v <= k1) {
      const [k0, c0] = AURORA_STOPS[i - 1];
      const f = (v - k0) / (k1 - k0);
      return c0.map((x, j) => x + (c1[j] - x) * f);
    }
  }
  return AURORA_STOPS[AURORA_STOPS.length - 1][1];
}
/** OVATION's 1-degree lon/lat grid, resampled into a Web Mercator image for an image source. */
function auroraImage(coords) {
  const grid = new Float32Array(360 * 181);
  for (const [lon, lat, v] of coords) {
    const i = ((Math.round(lon) % 360) + 360) % 360, j = Math.round(lat) + 90;
    if (j >= 0 && j <= 180) grid[i * 181 + j] = v;
  }
  const at = (i, j) => grid[(((i % 360) + 360) % 360) * 181 + clamp(j, 0, 180)];
  const W = 720, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const px = img.data;
  for (let y = 0; y < H; y++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / H))) * 180) / Math.PI;
    if (Math.abs(lat) < 30) continue;
    const la = lat + 90, j0 = Math.floor(la), fj = la - j0;
    for (let x = 0; x < W; x++) {
      const lo = ((((x + 0.5) / W) * 360 - 180) + 360) % 360, i0 = Math.floor(lo), fi = lo - i0;
      const v = (at(i0, j0) * (1 - fi) + at(i0 + 1, j0) * fi) * (1 - fj) + (at(i0, j0 + 1) * (1 - fi) + at(i0 + 1, j0 + 1) * fi) * fj;
      const col = auroraColor(v);
      if (!col) continue;
      const k = (y * W + x) * 4;
      px[k] = col[0]; px[k + 1] = col[1]; px[k + 2] = col[2]; px[k + 3] = col[3];
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
/** Legend drawn from the same stops as the image, so its positions are true percentages. */
const auroraGradient = () => `linear-gradient(90deg,${AURORA_STOPS.map(([v, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.12, c[3] / 255).toFixed(2)}) ${v}%`).join(",")})`;
const MERC_MAX = 85.05113;
const AURORA_CORNERS = [[-180, MERC_MAX], [180, MERC_MAX], [180, -MERC_MAX], [-180, -MERC_MAX]];
defineFeed({
  id: "aurora", title: "Aurora forecast", glyph: "aurora", group: "weather", kind: "raster", slot: "overlay",
  description: "NOAA SWPC OVATION short-term aurora forecast: the chance of seeing an aurora overhead, with the latest planetary Kp index.",
  keywords: ["aurora", "northern lights", "southern lights", "aurora borealis", "space weather", "kp", "swpc", "live"],
  source: "NOAA Space Weather Prediction Center — OVATION aurora model and planetary K-index",
  attribution: "Aurora: NOAA Space Weather Prediction Center",
  license: "Public domain (US Government work)",
  sourceShort: "NOAA SWPC", licenseShort: "Public domain",
  refreshMs: 10 * MIN,
  legend: `<div class="lv-grad" style="background:${auroraGradient()}"></div><div class="lv-ends"><span>0%</span><span>50%</span><span>100% chance</span></div>`,
  blurb: () => "Where an aurora may be visible, next ~30–90 min",
  countText: () => (AURORA.max != null ? `Up to ${AURORA.max}%${AURORA.kp != null ? ` · Kp ${fmt(AURORA.kp, 2)}` : ""}` : null),
  mount(map) {
    if (!AURORA.url) return;
    map.addSource("live-aurora", { type: "image", url: AURORA.url, coordinates: AURORA_CORNERS });
    map.addLayer({ id: "live-aurora", type: "raster", source: "live-aurora", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } }, app.layers.anchor("labels"));
  },
  unmount(map) { drop(map, ["live-aurora"], ["live-aurora"]); },
  opacity(map, v) { if (map.getLayer("live-aurora")) map.setPaintProperty("live-aurora", "raster-opacity", v); },
  async load(map) {
    const [d, kp] = await Promise.all([fetchJSON(SRC.aurora, { timeout: 20000 }), fetchJSON(SRC.kp, { timeout: 15000 }).catch(() => null)]);
    if (!Array.isArray(d.coordinates)) throw new Error("SWPC returned no aurora grid");
    AURORA.obs = Date.parse(d["Observation Time"]);
    AURORA.fcst = Date.parse(d["Forecast Time"]);
    AURORA.max = d.coordinates.reduce((m, c) => Math.max(m, c[2]), 0);
    const lastKp = Array.isArray(kp) ? kp[kp.length - 1] : null;
    AURORA.kp = lastKp?.Kp ?? null;
    AURORA.kpTime = lastKp ? Date.parse(`${lastKp.time_tag}Z`) : null;
    AURORA.url = auroraImage(d.coordinates);
    if (!isOn("aurora")) return { count: null, asOf: AURORA.obs };
    const src = map.getSource("live-aurora");
    if (src) src.updateImage({ url: AURORA.url, coordinates: AURORA_CORNERS });
    else this.mount(map);
    return { count: null, asOf: AURORA.obs };
  },
  summary: () => (AURORA.max != null ? `aurora chance up to ${AURORA.max}%${AURORA.kp != null ? ` (Kp ${fmt(AURORA.kp, 1)})` : ""}` : null),
  opts: () => `
    <div class="lv-legend"><div class="lv-grad" style="background:${auroraGradient()}"></div>
    <div class="lv-ends"><span>0%</span><span>50%</span><span>100% chance overhead</span></div></div>
    <p class="lv-note">${AURORA.fcst ? `Forecast valid ${esc(stamp(AURORA.fcst))}; model run from ${esc(stamp(AURORA.obs))} solar-wind data. ` : ""}${AURORA.kp != null ? `Planetary Kp ${fmt(AURORA.kp, 2)} for the 3 h from ${esc(stamp(AURORA.kpTime))}. ` : ""}Poleward of 85° is off the map.</p>
    <button type="button" class="btn btn-ghost btn-sm" data-act="pole">View the ${app.map.getCenter().lat < -10 ? "south" : "north"} pole</button>`,
  bindOpts(el) {
    el.querySelector('[data-act="pole"]')?.addEventListener("click", () => {
      const south = app.map.getCenter().lat < -10;
      app.map.flyTo({ center: south ? [140, -72] : [-100, 72], zoom: 2.2, pitch: 0, speed: 1.3 });
    });
  },
});

/* ================================================================ US weather alerts (NWS) */
const SEV = { Extreme: { c: "#d946ef", r: 4 }, Severe: { c: "#ff453a", r: 3 }, Moderate: { c: "#ff9f0a", r: 2 }, Minor: { c: "#ffd60a", r: 1 }, Unknown: { c: "#98a2b3", r: 0 } };
const ALERTS = { list: [], updated: null, bySev: {} };
async function loadAlerts(map) {
  const shapesUrl = `${SRC.wwa}?where=1%3D1&outFields=cap_id&returnGeometry=true&geometryPrecision=2&maxAllowableOffset=0.02&outSR=4326&f=geojson`;
  const [nws, shapes] = await Promise.all([
    fetchJSON(`${SRC.nws}?status=actual`, { headers: { Accept: "application/geo+json" }, timeout: 30000 }),
    fetchJSON(shapesUrl, { timeout: 30000 }).catch(() => null),
  ]);
  const byCap = new Map();
  for (const f of shapes?.features ?? []) {
    const id = f.properties?.cap_id;
    if (!id || !f.geometry) continue;
    if (!byCap.has(id)) byCap.set(id, []);
    byCap.get(id).push(f.geometry);
  }
  const list = [], feats = [], bySev = {};
  for (const a of nws.features ?? []) {
    const p = a.properties ?? {};
    const sev = SEV[p.severity] ? p.severity : "Unknown";
    const geoms = a.geometry ? [a.geometry] : byCap.get(p.id) ?? [];
    const i = list.length;
    list.push({ id: p.id, event: p.event, severity: sev, certainty: p.certainty, urgency: p.urgency, headline: p.headline, description: p.description, instruction: p.instruction,
      area: p.areaDesc, sender: p.senderName, onset: p.onset, effective: p.effective, expires: p.expires, ends: p.ends, url: p["@id"] ?? a.id, mapped: geoms.length > 0 });
    bySev[sev] = (bySev[sev] ?? 0) + 1;
    for (const g of geoms) feats.push({ type: "Feature", geometry: g, properties: { i, sev: SEV[sev].r } });
  }
  feats.sort((a, b) => a.properties.sev - b.properties.sev);
  Object.assign(ALERTS, { list, bySev, updated: Date.parse(nws.updated) || Date.now(), shapes: !!shapes });
  setGeo(map, "live-al", { type: "FeatureCollection", features: feats });
  return { count: list.length, asOf: ALERTS.updated };
}
/** NWS text is hard-wrapped at ~70 columns; keep paragraph breaks only. */
const unwrap = (t) => String(t ?? "").replace(/\r/g, "").replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/\n{2,}/g, "\n\n").trim();
function alertCard(a, lngLat) {
  const instr = unwrap(a.instruction);
  const html = `
    <div class="eyebrow">NWS alert · ${esc(a.severity)}</div>
    <h3>${esc(a.event)}</h3>
    <div class="sub">${esc(a.sender ?? "National Weather Service")}</div>
    <div class="lv-badges">${badge(a.severity, SEV[a.severity].c)}${a.urgency ? `<span class="lv-badge">${esc(a.urgency)}</span>` : ""}${a.certainty ? `<span class="lv-badge">${esc(a.certainty)}</span>` : ""}</div>
    ${a.headline ? `<p style="margin-top:12px">${esc(a.headline)}</p>` : ""}
    ${kv([
      a.onset ? ["Onset", stamp(a.onset)] : null,
      ["Message expires", a.expires ? `${stamp(a.expires)} (${until(Date.parse(a.expires))})` : "Not stated"],
      a.ends && a.ends !== a.expires ? ["Event ends", stamp(a.ends)] : null,
      ["Area", a.area ? (a.area.length > 220 ? `${a.area.slice(0, 218)}…` : a.area) : null],
    ])}
    ${instr ? `<p class="lv-quote">${esc(instr.length > 380 ? `${instr.slice(0, 378).trimEnd()}…` : instr)}</p>` : ""}
    <div class="card-actions">
      ${extLink(`https://forecast.weather.gov/MapClick.php?lat=${lngLat.lat.toFixed(4)}&lon=${lngLat.lng.toFixed(4)}`, "Forecast & hazards here", true)}
      ${a.url ? extLink(a.url, "Full alert (NWS API)") : ""}
    </div>
    <p class="note">NOAA National Weather Service · public domain · active alerts as of ${esc(hhmm(ALERTS.updated))}. Official alerts only; always follow local authorities.</p>`;
  showLiveCard("alert", html);
}
defineFeed({
  id: "alerts-us", title: "Weather alerts (US)", glyph: "alert", group: "hazards",
  description: "Active National Weather Service watches, warnings and advisories across the United States, shaded by severity.",
  keywords: ["weather alerts", "warnings", "watches", "advisories", "nws", "severe weather", "tornado", "flood warning", "united states", "live"],
  source: "NOAA National Weather Service — api.weather.gov active alerts; zone shapes from NOAA mapservices (WWA)",
  attribution: "Alerts: NOAA National Weather Service",
  license: "Public domain (US Government work)",
  sourceShort: "NOAA National Weather Service", licenseShort: "Public domain",
  refreshMs: 5 * MIN,
  blurb: () => "Watches, warnings and advisories, US only",
  countText: (f) => (f.state.count != null ? `${plural(f.state.count, "alert")}${ALERTS.bySev.Severe || ALERTS.bySev.Extreme ? `, ${fmt((ALERTS.bySev.Severe ?? 0) + (ALERTS.bySev.Extreme ?? 0))} severe or extreme` : ""}` : null),
  mount(map) {
    addGeo(map, "live-al", { tolerance: 0.6 });
    const color = ["match", ["get", "sev"], 4, SEV.Extreme.c, 3, SEV.Severe.c, 2, SEV.Moderate.c, 1, SEV.Minor.c, SEV.Unknown.c];
    map.addLayer({ id: "live-al-fill", type: "fill", source: "live-al", layout: { "fill-sort-key": ["get", "sev"] }, paint: { "fill-color": color, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 8, 0.2] } }, app.layers.anchor("labels"));
    map.addLayer({ id: "live-al-line", type: "line", source: "live-al", layout: { "line-sort-key": ["get", "sev"] }, paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 9, 1.6], "line-opacity": 0.9 } }, app.layers.anchor("labels"));
  },
  unmount(map) { drop(map, ["live-al-line", "live-al-fill"], ["live-al"]); },
  load: loadAlerts,
  summary: () => (ALERTS.list.length ? `${plural(ALERTS.list.length, "US weather alert")}${ALERTS.bySev.Severe || ALERTS.bySev.Extreme ? ` (${fmt((ALERTS.bySev.Severe ?? 0) + (ALERTS.bySev.Extreme ?? 0))} severe)` : ""}` : null),
  opts: () => `
    <div class="lv-keys">${["Extreme", "Severe", "Moderate", "Minor"].map((s) => `<span class="lv-key"><i style="--c:${SEV[s].c}"></i>${s}${ALERTS.bySev[s] ? ` <b>${fmt(ALERTS.bySev[s])}</b>` : ""}</span>`).join("")}</div>
    <p class="lv-note">United States and territories only.${(() => { const n = ALERTS.list.filter((a) => !a.mapped).length; return n ? ` ${fmt(n)} of ${fmt(ALERTS.list.length)} alerts have no map shape and are counted but not drawn.` : ""; })()}</p>`,
  hits: [{
    layers: ["live-al-fill", "live-al-line"],
    click: (f, e) => { const a = ALERTS.list[f.properties.i]; if (a) alertCard(a, e.lngLat); },
    hover: (f) => { const a = ALERTS.list[f.properties.i]; return a ? `${a.event} · ${a.severity}` : null; },
  }],
});

/* ================================================================ US volcanoes (USGS HANS) */
const VCOLOR = { GREEN: "#22c55e", YELLOW: "#facc15", ORANGE: "#f97316", RED: "#ef4444", UNASSIGNED: "#9ca3af" };
const OBS = { avo: "Alaska Volcano Observatory", cvo: "Cascades Volcano Observatory", hvo: "Hawaiian Volcano Observatory", yvo: "Yellowstone Volcano Observatory", calvo: "California Volcano Observatory", nmi: "CNMI Emergency Management Office" };
const VOLC = { list: [] };
function volcanoCard(v) {
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${VCOLOR[v.color] ?? VCOLOR.UNASSIGNED}">${icon("volcano", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Volcano · United States</div>
        <h3>${esc(v.name)}</h3>
        <div class="sub">${esc(OBS[v.obs] ?? v.obs?.toUpperCase() ?? "USGS")}</div>
      </div>
    </div>
    <div class="lv-badges">${badge(`${v.color ?? "—"} · aviation`, VCOLOR[v.color] ?? VCOLOR.UNASSIGNED)}${badge(`${v.level ?? "—"} · ground`, VCOLOR[v.color] ?? VCOLOR.UNASSIGNED)}</div>
    ${v.synopsis ? `<p style="margin-top:12px">${esc(v.synopsis)}</p>` : ""}
    ${kv([
      ["Notice sent", v.sent ? `${stamp(v.sent)} (${ago(v.sent)})` : null],
      ["Level since", v.since ? dayUTC(v.since, true) : null],
      ["Previous level", v.prev],
      ["Threat ranking", v.threat],
      ["Summit", `${v.lat.toFixed(3)}, ${v.lng.toFixed(3)}`],
    ])}
    <div class="card-actions">
      ${v.notice ? extLink(SRC.hansNotice(v.notice), "USGS notice", true) : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly in 3D</button>
    </div>
    <p class="note">USGS Volcano Hazards Program (HANS) · public domain. Aviation colour code and volcano alert level as issued; only US volcanoes above normal are listed.</p>`;
  showLiveCard("volcano", html, (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [v.lng, v.lat], zoom: 11.5, pitch: 60, bearing: 20, speed: 1.2 });
  }, [v.lng, v.lat], 15);
}
defineFeed({
  id: "volcanoes-us", title: "Volcano alerts (US)", glyph: "volcano", group: "hazards",
  description: "US volcanoes currently above normal, with the USGS aviation colour code, alert level and latest notice.",
  keywords: ["volcano", "volcanoes", "eruption", "usgs", "hans", "alaska", "hawaii", "cascades", "live"],
  source: "USGS Volcano Hazards Program — HANS elevated volcanoes (vsc/api/volcanoApi/elevated)",
  attribution: "Volcanoes: USGS Volcano Hazards Program",
  license: "Public domain (US Government work)",
  sourceShort: "USGS Volcano Hazards Program", licenseShort: "Public domain",
  refreshMs: 30 * MIN,
  blurb: () => "US volcanoes above normal alert level",
  countText: (f) => (f.state.count != null ? `${fmt(f.state.count)} above normal` : null),
  mount(map) {
    for (const [k, c] of Object.entries(VCOLOR)) shapeIcon(map, `live-vo-${k}`, "M12 3.2 21.6 20.4H2.4z", c, 22);
    addGeo(map, "live-vo");
    map.addLayer({ id: "live-vo", type: "symbol", source: "live-vo", layout: {
      "icon-image": ["concat", "live-vo-", ["get", "c"]], "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 8, 1.1],
      "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.25], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.4 } }, app.layers.anchor("live"));
    if (VOLC.list.length) drawVolcanoes(map);
  },
  unmount(map) { drop(map, ["live-vo"], ["live-vo"]); },
  points: () => VOLC.list.map((v) => [v.lng, v.lat]),
  async load(map) {
    const arr = await parseJSONText(SRC.volcanoes, { timeout: 20000 });
    VOLC.list = (Array.isArray(arr) ? arr : []).filter((v) => Number.isFinite(+v.lat) && Number.isFinite(+v.long)).map((v) => ({
      name: v.vName, lat: +v.lat, lng: +v.long, color: String(v.colorCode ?? "UNASSIGNED").toUpperCase(), level: v.alertLevel, synopsis: v.noticeSynopsis,
      sent: v.sentUtc ? Date.parse(`${v.sentUtc.replace(" ", "T")}Z`) : null, obs: v.obs, threat: v.nvewsThreat, notice: v.noticeId,
      prev: v.colorCodePrev || v.alertLevelPrev ? `${v.colorCodePrev ?? "—"} / ${v.alertLevelPrev ?? "—"}` : null,
      since: v.codeChangeDate ? Date.parse(`${v.codeChangeDate.replace(" ", "T")}Z`) : null,
    }));
    const rank = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
    VOLC.list.sort((a, b) => (rank[a.color] ?? 4) - (rank[b.color] ?? 4));
    drawVolcanoes(map);
    return { count: VOLC.list.length, asOf: Date.now() };
  },
  summary: () => {
    if (!VOLC.list.length) return null;
    const hot = VOLC.list.filter((v) => v.color === "ORANGE" || v.color === "RED").length;
    return `${plural(VOLC.list.length, "US volcano", "US volcanoes")} above normal${hot ? ` (${fmt(hot)} orange or red)` : ""}`;
  },
  opts: () => (VOLC.list.length ? `<div class="lv-list">${VOLC.list.map((v, i) => `
    <button type="button" class="row-btn lv-mini" data-v="${i}"><span class="lv-tri" style="--c:${VCOLOR[v.color] ?? VCOLOR.UNASSIGNED}"></span>
    <span class="grow"><span class="t">${esc(v.name)}</span><span class="s">${esc(v.color)} / ${esc(v.level ?? "—")} · ${esc(v.sent ? ago(v.sent) : "")}</span></span></button>`).join("")}</div>` : ""),
  bindOpts(el) {
    el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
      const v = VOLC.list[Number(b.dataset.v)];
      volcanoCard(v);
      app.map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(app.map.getZoom(), 7), speed: 1.3 });
    }));
  },
  hits: [{
    layers: ["live-vo"],
    click: (f) => { const v = VOLC.list[f.properties.i]; if (v) volcanoCard(v); },
    hover: (f) => { const v = VOLC.list[f.properties.i]; return v ? `${v.name} · ${v.color} / ${v.level}` : null; },
  }],
});
function drawVolcanoes(map) {
  setGeo(map, "live-vo", { type: "FeatureCollection", features: VOLC.list.map((v, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.lng, v.lat] }, properties: { i, c: VCOLOR[v.color] ? v.color : "UNASSIGNED", n: v.name } })) });
}

/* ================================================================ tropical cyclones (NHC) */
const TC = { storms: [], pts: null, fetched: null };
const BASIN = { AL: "Atlantic", EP: "Eastern Pacific", CP: "Central Pacific" };
const tcClass = (kt) => (kt == null ? "TD" : kt < 34 ? "TD" : kt < 64 ? "TS" : kt < 83 ? "C1" : kt < 96 ? "C2" : kt < 113 ? "C3" : kt < 137 ? "C4" : "C5");
const TC_COLOR = { TD: "#5ebaff", TS: "#00f0e0", C1: "#fff7a8", C2: "#ffe066", C3: "#ffb340", C4: "#ff7a1a", C5: "#ff4d4d" };
const TC_LABEL = { TD: "Tropical depression", TS: "Tropical storm", C1: "Category 1 hurricane", C2: "Category 2 hurricane", C3: "Category 3 hurricane", C4: "Category 4 hurricane", C5: "Category 5 hurricane" };
const compass16 = (deg) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
async function loadCyclones(map) {
  const q = (layer) => fetchJSON(`${SRC.nhc}/${layer}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&geometryPrecision=3&f=geojson`, { timeout: 25000 });
  const [pts, trk, cone, past] = await Promise.all([q(5), q(6).catch(() => null), q(7).catch(() => null), q(11).catch(() => null)]);
  if (!Array.isArray(pts?.features)) throw new Error("NHC returned no forecast points");
  const storms = new Map();
  for (const f of pts.features) {
    const p = f.properties;
    const key = p.binnumber ?? `${p.basin}${p.stormnum}`;
    // The product bin says which centre issues the advisories: a storm born in the East Pacific keeps
    // basin "EP" after crossing 140°W, but its bin becomes CPn and CPHC takes over.
    if (!storms.has(key)) storms.set(key, { key, name: p.stormname, basin: /^CP/.test(p.binnumber ?? "") ? "CP" : p.basin, points: [] });
    storms.get(key).points.push({ ...p, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
  }
  const list = [...storms.values()].map((s) => {
    s.points.sort((a, b) => a.tau - b.tau);
    s.now = s.points[0];
    s.cls = tcClass(s.now.maxwind);
    return s;
  });
  list.sort((a, b) => (b.now.maxwind ?? 0) - (a.now.maxwind ?? 0));
  TC.storms = list;
  const keys = new Set(list.map((s) => s.key));
  const ptFeatures = list.flatMap((s, si) => s.points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    properties: { si, tau: p.tau, cls: tcClass(p.maxwind), n: p.tau === 0 ? String(s.name ?? "").replace(/^(Tropical|Subtropical|Post-Tropical|Potential Tropical)\s+(Depression|Storm|Cyclone)\s+|^Hurricane\s+|^Major Hurricane\s+/i, "") : "" } })));
  setGeo(map, "live-tc-pt", { type: "FeatureCollection", features: ptFeatures });
  const withKey = (fc) => ({ type: "FeatureCollection", features: (fc?.features ?? []).filter((f) => f.geometry && keys.has(f.properties?.binnumber)).map((f) => ({ ...f, properties: { si: list.findIndex((s) => s.key === f.properties.binnumber) } })) });
  setGeo(map, "live-tc-cone", withKey(cone));
  setGeo(map, "live-tc-track", withKey(trk));
  setGeo(map, "live-tc-past", withKey(past));
  const filed = Math.max(0, ...pts.features.map((f) => f.properties.idp_filedate ?? 0));
  TC.fetched = filed || Date.now();
  return { count: list.length, asOf: TC.fetched };
}
function stormCard(s, tau = 0) {
  const p = s.points.find((x) => x.tau === tau) ?? s.now;
  const cls = tcClass(p.maxwind);
  const mph = (kt) => Math.round(kt * 1.15078);
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${TC_COLOR[cls]}">${icon("cyclone", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Tropical cyclone · ${esc(BASIN[s.basin] ?? s.basin ?? "")}</div>
        <h3>${esc(s.name)}</h3>
        <div class="sub">${tau ? `Forecast for ${esc(p.fldatelbl ?? p.datelbl ?? `+${tau} h`)}` : `Advisory ${esc(p.advisnum)} · ${esc(p.advdate)}`}</div>
      </div>
    </div>
    ${kv([
      ["Intensity", `${TC_LABEL[cls]}${tau ? " (forecast)" : ""}`],
      ["Max sustained wind", p.maxwind != null ? `${fmt(p.maxwind)} kt (${fmt(mph(p.maxwind))} mph)` : null],
      ["Gusts", p.gust ? `${fmt(p.gust)} kt (${fmt(mph(p.gust))} mph)` : null],
      ["Pressure", p.mslp && p.mslp < 1100 ? `${fmt(p.mslp)} mb` : null],
      ["Moving", !tau && p.tcspd != null && p.tcdir != null && p.tcdir < 900 ? `${compass16(p.tcdir)} at ${fmt(p.tcspd)} kt` : null],
      ["Centre", `${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}`],
      ["Forecast points", `${s.points.length} over ${fmt(Math.max(...s.points.map((x) => x.tau)))} h`],
    ])}
    <div class="card-actions">
      ${extLink(s.basin === "CP" ? "https://www.nhc.noaa.gov/?cpac" : s.basin === "EP" ? "https://www.nhc.noaa.gov/?epac" : "https://www.nhc.noaa.gov/?atlc", s.basin === "CP" ? "CPHC advisories" : "NHC advisories", true)}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly to</button>
    </div>
    <p class="note">NOAA National Hurricane Center / CPHC · public domain. The cone shows the probable track of the centre, not the storm's size; hazards extend outside it.</p>`;
  showLiveCard("storm", html, (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => frame(s.points.map((x) => [x.lng, x.lat]), 5);
  }, [p.lng, p.lat], tau ? 10 : 14);
}
defineFeed({
  id: "tropical-cyclones", title: "Tropical cyclones", glyph: "cyclone", group: "hazards",
  description: "Active Atlantic and Pacific tropical cyclones from the US National Hurricane Center: current position, intensity, 5-day forecast track and cone.",
  keywords: ["hurricane", "hurricanes", "tropical storm", "cyclone", "typhoon", "nhc", "forecast cone", "storm track", "live"],
  source: "NOAA National Hurricane Center / Central Pacific Hurricane Center via NOAA mapservices (NHC_tropical_weather_summary)",
  attribution: "Tropical cyclones: NOAA National Hurricane Center",
  license: "Public domain (US Government work)",
  sourceShort: "NOAA National Hurricane Center", licenseShort: "Public domain",
  refreshMs: 30 * MIN,
  blurb: () => "Atlantic, East & Central Pacific (NHC basins)",
  countText: (f) => (f.state.count != null ? (f.state.count ? `${plural(f.state.count, "active storm")}` : "No active storms") : null),
  mount(map) {
    for (const id of ["live-tc-cone", "live-tc-track", "live-tc-past", "live-tc-pt"]) addGeo(map, id);
    const lbl = app.layers.anchor("labels"), top = app.layers.anchor("live");
    map.addLayer({ id: "live-tc-cone", type: "fill", source: "live-tc-cone", paint: { "fill-color": "#ffffff", "fill-opacity": 0.13 } }, lbl);
    map.addLayer({ id: "live-tc-cone-line", type: "line", source: "live-tc-cone", paint: { "line-color": "rgba(255,255,255,0.8)", "line-width": 1.2, "line-dasharray": [2, 2] } }, lbl);
    map.addLayer({ id: "live-tc-past", type: "line", source: "live-tc-past", layout: { "line-cap": "round" }, paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": 2 } }, top);
    map.addLayer({ id: "live-tc-track", type: "line", source: "live-tc-track", layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 1.8, "line-dasharray": [1.5, 1.5] } }, top);
    const cls = ["match", ["get", "cls"], ...Object.entries(TC_COLOR).flat(), "#5ebaff"];
    map.addLayer({ id: "live-tc-pt", type: "circle", source: "live-tc-pt", paint: {
      "circle-radius": ["case", ["==", ["get", "tau"], 0], 8, 4.5], "circle-color": cls, "circle-stroke-color": "rgba(0,0,0,0.8)", "circle-stroke-width": 1.4 } }, top);
    map.addLayer({ id: "live-tc-lbl", type: "symbol", source: "live-tc-pt", filter: ["==", ["get", "tau"], 0], layout: {
      "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0.9, 0], "text-anchor": "left", "text-allow-overlap": true },
      paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.5 } }, top);
  },
  unmount(map) { drop(map, ["live-tc-lbl", "live-tc-pt", "live-tc-track", "live-tc-past", "live-tc-cone-line", "live-tc-cone"], ["live-tc-cone", "live-tc-track", "live-tc-past", "live-tc-pt"]); },
  load: loadCyclones,
  points: () => TC.storms.map((s) => [s.now.lng, s.now.lat]),
  summary: () => (TC.storms.length ? `${plural(TC.storms.length, "active tropical cyclone")}` : null),
  opts: () => (TC.storms.length ? `<div class="lv-list">${TC.storms.map((s, i) => `
    <button type="button" class="row-btn lv-mini" data-s="${i}"><span class="lv-dot" style="--c:${TC_COLOR[s.cls]}"></span>
    <span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${esc(BASIN[s.basin] ?? s.basin)} · ${fmt(s.now.maxwind)} kt · advisory ${esc(s.now.advisnum)}</span></span></button>`).join("")}</div>`
    : `<p class="lv-note">No active storms in the NHC basins right now. Western Pacific typhoons and other basins appear under Natural events (from JTWC via EONET).</p>`),
  bindOpts(el) {
    el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => {
      const s = TC.storms[Number(b.dataset.s)];
      stormCard(s);
      frame(s.points.map((x) => [x.lng, x.lat]), 5);
    }));
  },
  hits: [{
    layers: ["live-tc-pt", "live-tc-lbl", "live-tc-track", "live-tc-past", "live-tc-cone", "live-tc-cone-line"],
    click: (f) => { const s = TC.storms[f.properties.si]; if (s) stormCard(s, f.properties.tau ?? 0); },
    hover: (f) => { const s = TC.storms[f.properties.si]; return s ? `${s.name} · ${fmt((s.points.find((p) => p.tau === (f.properties.tau ?? 0)) ?? s.now).maxwind)} kt${f.properties.tau ? ` (+${f.properties.tau} h)` : ""}` : null; },
  }],
});

/* ================================================================ satellites (CelesTrak + SGP4) */
const SAT_GROUPS = [["stations", "Space stations"], ["visual", "Brightest"], ["gps-ops", "GPS"], ["galileo", "Galileo"], ["weather", "Weather"], ["resource", "Earth observation"], ["science", "Science"], ["geo", "Geostationary"]];
const HIGHLIGHT = { 25544: "ISS", 48274: "Tiangong" };
const SAT_ALIASES = [[/^(?:the\s+)?(?:iss|international space station|zarya|space station)$/i, 25544], [/^(?:the\s+)?(?:tiangong|css|chinese space station|tianhe)$/i, 48274], [/^(?:the\s+)?(?:hubble|hst|hubble space telescope)$/i, 20580]];
const STARLINK_C = "#a9c4dd";
const ORBIT = {
  LEO: { label: "Low Earth orbit", c: "#5ee7ff" }, MEO: { label: "Medium Earth orbit", c: "#b69cff" },
  GEO: { label: "Geosynchronous", c: "#ffd166" }, HEO: { label: "Highly elliptical", c: "#ff7eb6" },
};
const S = { followEased: false, lib: null, libMod: null, core: [], starlink: [], starText: null, extra: [], list: [], byNorad: new Map(), groupInfo: {}, coreAt: null, starAt: null, timer: 0, tick: 0, sel: null, follow: false, raf: 0, selAt: 0, trackAt: 0, lastCenter: null, stale: false, pointers: new Map() };
// A failed import must not stick, or no retry could recover without a reload.
const satLib = () => (S.lib ??= importCDN(SRC.satjs).catch((err) => {
  S.lib = null;
  throw new Error(err instanceof TypeError ? `couldn't reach ${hostOf(SRC.satjs)}` : `couldn't load the orbit library from ${hostOf(SRC.satjs)}`);
}));

/** CelesTrak asks for at most one download per group per 2 hours; reuse the cache and fall back to it on 403.
 *  Concurrent asks for one group share a request, so a quick off/on never downloads twice. */
const GP_INFLIGHT = new Map();
function loadGP(key, query) {
  if (!GP_INFLIGHT.has(key)) GP_INFLIGHT.set(key, fetchGP(key, query).finally(() => GP_INFLIGHT.delete(key)));
  return GP_INFLIGHT.get(key);
}
async function fetchGP(key, query) {
  const c = await cache.get(key);
  const cached = (stale) => ({ rows: JSON.parse(c.text), text: c.text, t: c.t, cached: true, stale });
  if (c && Date.now() - c.t < 2 * HOUR) return cached(false);
  let res, text;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 60000);
    try { res = await fetch(SRC.celestrak(query), { signal: ctrl.signal }); text = await res.text(); } finally { clearTimeout(to); }
  } catch {
    if (c) return cached(true);
    throw new Error("couldn't reach celestrak.org");
  }
  if (res.ok) {
    let rows;
    try { rows = JSON.parse(text); } catch { rows = null; }
    if (!Array.isArray(rows) || !rows.length) {
      if (c) return cached(true);
      if (Array.isArray(rows) || /no gp data/i.test(text)) throw new Error("no match in CelesTrak's catalogue");
      throw new Error("CelesTrak returned no element sets");
    }
    const t = Date.now();
    await cache.set(key, { t, text });
    return { rows, text, t };
  }
  if (c) return cached(true);
  if (res.status === 404 || /no gp data/i.test(text ?? "")) throw new Error("no match in CelesTrak's catalogue");
  if (res.status !== 403) throw new Error(`celestrak.org answered ${res.status}`);
  throw Object.assign(new Error("CelesTrak allows one download per 2 hours per network, and none is cached here yet"), { later: true });
}
/** Orbit metadata straight from the OMM fields; the SGP4 record is built lazily (main thread) or in the worker. */
function buildSats(rows, group) {
  const out = [];
  rows.forEach((r, row) => {
    const n = Number(r.MEAN_MOTION), e = Number(r.ECCENTRICITY);
    if (!(n > 0) || !(e >= 0 && e < 1)) return;
    const period = 1440 / n;
    const a = Math.cbrt(398600.4418 * ((period * 60) / (2 * Math.PI)) ** 2);
    const apogee = a * (1 + e) - 6378.137, perigee = a * (1 - e) - 6378.137;
    const klass = e >= 0.25 ? "HEO" : apogee < 2000 ? "LEO" : period >= 1300 && period <= 1600 ? "GEO" : "MEO";
    const norad = Number(r.NORAD_CAT_ID);
    out.push({ norad, name: r.OBJECT_NAME, cospar: r.OBJECT_ID, epoch: Date.parse(/Z$/.test(r.EPOCH) ? r.EPOCH : `${r.EPOCH}Z`), group, klass, inc: Number(r.INCLINATION), period, apogee, perigee, omm: r, row, satrec: undefined, label: HIGHLIGHT[norad] ?? null, starlink: group === "starlink", pos: null });
  });
  return out;
}
function rebuildSats() {
  const list = new Map();
  if (isOn("satellites")) for (const s of S.core) list.set(s.norad, s);
  for (const s of S.extra) if (!list.has(s.norad)) list.set(s.norad, s);
  if (S.sel && !list.has(S.sel.norad)) list.set(S.sel.norad, S.sel);
  S.list = [...list.values()];
  const all = new Map(list);
  if (isOn("starlink")) for (const s of S.starlink) if (!all.has(s.norad)) all.set(s.norad, s);
  S.byNorad = all;
  sendSet("core");
}
function satRec(s) {
  if (s.satrec === undefined) {
    try { const r = S.libMod.json2satrec(s.omm); s.satrec = r && !r.error ? r : null; } catch { s.satrec = null; }
  }
  return s.satrec;
}
function satPos(s, date, gmst) {
  const lib = S.libMod, rec = lib && satRec(s);
  if (!rec) return null;
  const pv = lib.propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position !== "object") return null;
  const gd = lib.eciToGeodetic(pv.position, gmst ?? lib.gstime(date));
  const lat = lib.degreesLat(gd.latitude), lng = lib.degreesLong(gd.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(gd.height)) return null;
  const v = pv.velocity;
  return { lat, lng, alt: gd.height, speed: v ? Math.hypot(v.x, v.y, v.z) : null };
}

// SGP4 for thousands of objects runs in a module worker so the globe stays smooth; positions come
// back as one transferable Float64Array [lng, lat, alt km, speed km/s] per satellite.
const SAT_WORKER = `import * as sat from "${SRC.satjs}";
const sets = {};
const rec = (r) => { try { const s = sat.json2satrec(r); return s && !s.error ? s : null; } catch { return null; } };
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === "set") {
    const rows = d.text ? JSON.parse(d.text) : d.rows;
    sets[d.name] = { gen: d.gen, recs: d.idx ? Array.from(d.idx, (i) => rec(rows[i])) : rows.map(rec) };
    return;
  }
  const set = sets[d.name];
  if (!set || set.gen !== d.gen) { self.postMessage({ type: "pos", name: d.name, gen: d.gen, buf: null }); return; }
  const t = new Date(d.t), g = sat.gstime(t), n = set.recs.length, out = new Float64Array(n * 4).fill(NaN);
  for (let i = 0; i < n; i++) {
    const r = set.recs[i];
    if (!r) continue;
    const pv = sat.propagate(r, t);
    if (!pv || !pv.position || typeof pv.position !== "object") continue;
    const gd = sat.eciToGeodetic(pv.position, g), v = pv.velocity;
    out[i * 4] = sat.degreesLong(gd.longitude); out[i * 4 + 1] = sat.degreesLat(gd.latitude); out[i * 4 + 2] = gd.height;
    out[i * 4 + 3] = v ? Math.hypot(v.x, v.y, v.z) : NaN;
  }
  self.postMessage({ type: "pos", name: d.name, gen: d.gen, t: d.t, buf: out }, [out.buffer]);
};
self.postMessage({ type: "ready" });`;
const SW = { w: null, failed: false, gen: { core: 0, sl: 0 }, sent: { core: [], sl: [] }, busy: { core: false, sl: false } };
function satWorker() {
  if (SW.w || SW.failed) return SW.w;
  try {
    const url = URL.createObjectURL(new Blob([SAT_WORKER], { type: "text/javascript" }));
    SW.w = new Worker(url, { type: "module" });
    SW.w.onmessage = (e) => {
      const d = e.data;
      if (d.type !== "pos") return;
      SW.busy[d.name] = false;
      if (d.buf && d.gen === SW.gen[d.name]) applyPositions(d.name, SW.sent[d.name], d.buf);
    };
    SW.w.onerror = (e) => {
      e.preventDefault?.();
      SW.failed = true;
      stopSatWorker();
      satTick();
    };
    sendSet("core");
    sendSet("sl");
  } catch { SW.failed = true; SW.w = null; }
  return SW.w;
}
function stopSatWorker() {
  SW.w?.terminate();
  SW.w = null;
  SW.busy = { core: false, sl: false };
}
/** Tell the worker which satellites each set holds; a new generation discards replies for the old one. */
function sendSet(name) {
  const sats = name === "core" ? S.list : isOn("starlink") ? S.starlink : [];
  SW.gen[name]++;
  SW.sent[name] = sats;
  SW.busy[name] = false;
  if (!SW.w) return;
  if (name === "sl" && sats.length && S.starText) SW.w.postMessage({ type: "set", name, gen: SW.gen[name], text: S.starText, idx: Int32Array.from(sats, (s) => s.row) });
  else SW.w.postMessage({ type: "set", name, gen: SW.gen[name], rows: sats.map((s) => s.omm) });
}
function propagateHere(sats, t) {
  const out = new Float64Array(sats.length * 4).fill(NaN), date = new Date(t), g = S.libMod.gstime(date);
  sats.forEach((s, i) => {
    const p = satPos(s, date, g);
    if (p) { out[i * 4] = p.lng; out[i * 4 + 1] = p.lat; out[i * 4 + 2] = p.alt; out[i * 4 + 3] = p.speed ?? NaN; }
  });
  return out;
}
function applyPositions(name, sats, buf) {
  const map = app.map, feats = [];
  if (!map.getSource("live-sat")) return;
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i], lng = buf[i * 4], lat = buf[i * 4 + 1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) { s.pos = null; continue; }
    const sp = buf[i * 4 + 3];
    s.pos = { lng, lat, alt: buf[i * 4 + 2], speed: Number.isFinite(sp) ? sp : null };
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: name === "sl" ? { k: s.norad } : { k: s.norad, c: s.klass, h: s.label ? 1 : 0, n: s.label ?? "", sl: s.starlink ? 1 : 0 } });
  }
  setGeo(map, SAT_SRC[name], { type: "FeatureCollection", features: feats });
  satLoadSent(name);
  if (name === "core" && S.sel) {
    if (Date.now() - S.trackAt > 20000) drawTrack();
    updateSatCard();
  }
}
/** 1 Hz for the ~1,000 core satellites; the Starlink shell every 2 s (sub-pixel motion at globe scale). */
// Every setData is re-indexed in a MapLibre worker that the other GeoJSON layers share. Wait for the
// last update to finish and leave that worker idle for as long as it took (twice as long for the
// Starlink shell), so a slow device thins out satellite updates instead of starving other layers.
const SAT_LOAD = { core: { busy: false, at: 0, done: 0, cost: 0, idle: 1 }, sl: { busy: false, at: 0, done: 0, cost: 0, idle: 2 } };
const SAT_SRC = { core: "live-sat", sl: "live-sat-sl" };
function satLoadReady(name, now) {
  const b = SAT_LOAD[name];
  if (b.busy && now - b.at > 15000) b.busy = false;
  return !b.busy && now - b.done >= b.idle * b.cost;
}
function satLoadSent(name) { Object.assign(SAT_LOAD[name], { busy: true, at: performance.now() }); }
function satLoadDone(e) {
  const name = e.sourceDataType === "content" ? (e.sourceId === SAT_SRC.core ? "core" : e.sourceId === SAT_SRC.sl ? "sl" : null) : null;
  const b = name && SAT_LOAD[name];
  if (!b?.busy) return;
  b.busy = false;
  b.done = performance.now();
  b.cost = b.done - b.at;
}
function satTick() {
  const map = app.map;
  if (!S.libMod || !map.getSource("live-sat")) return;
  const now = Date.now(), t = performance.now(), w = satWorker(), starlink = isOn("starlink") && S.starlink.length && S.tick % 2 === 0 && satLoadReady("sl", t);
  const core = satLoadReady("core", t);
  S.tick++;
  if (w) {
    if (core && !SW.busy.core) { SW.busy.core = true; w.postMessage({ type: "tick", name: "core", gen: SW.gen.core, t: now }); }
    if (starlink && !SW.busy.sl && SW.sent.sl.length) { SW.busy.sl = true; w.postMessage({ type: "tick", name: "sl", gen: SW.gen.sl, t: now }); }
  } else {
    if (core) applyPositions("core", S.list, propagateHere(S.list, now));
    if (starlink && S.tick % 4 === 1) applyPositions("sl", S.starlink, propagateHere(S.starlink, now));
  }
}
function satTimer() {
  clearInterval(S.timer);
  S.timer = 0;
  if ((isOn("satellites") || isOn("starlink")) && !document.hidden && S.libMod) S.timer = setInterval(satTick, 1000);
}
function ensureSatLayers(map) {
  if (map.getSource("live-sat")) return;
  map.addSource("live-sat", { type: "geojson", data: EMPTY(), maxzoom: 8 });
  map.addSource("live-sat-sl", { type: "geojson", data: EMPTY(), maxzoom: 7 });
  map.addSource("live-sat-track", { type: "geojson", data: EMPTY() });
  map.addSource("live-sat-sel", { type: "geojson", data: EMPTY() });
  const before = app.layers.anchor("live");
  const color = ["case", ["==", ["get", "h"], 1], "#ffffff", ["==", ["get", "sl"], 1], STARLINK_C, ["match", ["get", "c"], "LEO", ORBIT.LEO.c, "MEO", ORBIT.MEO.c, "GEO", ORBIT.GEO.c, "HEO", ORBIT.HEO.c, "#ffffff"]];
  map.addLayer({ id: "live-sat-sl-hit", type: "circle", source: "live-sat-sl", paint: { "circle-radius": 4, "circle-opacity": 0, "circle-stroke-width": 0 } }, before);
  map.addLayer({ id: "live-sat-sl", type: "circle", source: "live-sat-sl", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.25, 6, 2.2, 10, 3], "circle-color": STARLINK_C, "circle-opacity": 0.78 } }, before);
  map.addLayer({ id: "live-sat-track-past", type: "line", source: "live-sat-track", filter: ["==", ["get", "part"], "past"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "rgba(255,255,255,0.7)", "line-width": 1.6, "line-blur": 0.2 } }, before);
  map.addLayer({ id: "live-sat-track", type: "line", source: "live-sat-track", filter: ["==", ["get", "part"], "future"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 2.2, "line-dasharray": [2, 1.4] } }, before);
  map.addLayer({ id: "live-sat-hit", type: "circle", source: "live-sat", paint: { "circle-radius": 8, "circle-opacity": 0, "circle-stroke-width": 0 } }, before);
  map.addLayer({ id: "live-sat", type: "circle", source: "live-sat", layout: { "circle-sort-key": ["case", ["==", ["get", "h"], 1], 2, 1] }, paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["case", ["==", ["get", "h"], 1], 4.6, 2.3], 6, ["case", ["==", ["get", "h"], 1], 6.5, 3.6]],
    "circle-color": color,
    "circle-stroke-color": ["case", ["==", ["get", "h"], 1], "#e4572e", "rgba(0,0,0,0.55)"], "circle-stroke-width": ["case", ["==", ["get", "h"], 1], 2, 0.6] } }, before);
  map.addLayer({ id: "live-sat-lbl", type: "symbol", source: "live-sat", filter: ["==", ["get", "h"], 1], layout: {
    "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0.9, 0], "text-anchor": "left", "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.6 } }, before);
  map.addLayer({ id: "live-sat-sel", type: "circle", source: "live-sat-sel", paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } }, before);
  map.addLayer({ id: "live-sat-sel-lbl", type: "symbol", source: "live-sat-sel", layout: {
    "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.55], "text-anchor": "bottom", "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.6 } }, before);
}
function removeSatLayers(map) {
  deselectSat();
  clearInterval(S.timer);
  S.timer = 0;
  stopSatWorker();
  for (const b of Object.values(SAT_LOAD)) Object.assign(b, { busy: false, done: 0, cost: 0 });
  drop(map, ["live-sat-sel-lbl", "live-sat-sel", "live-sat-lbl", "live-sat", "live-sat-hit", "live-sat-track", "live-sat-track-past", "live-sat-sl", "live-sat-sl-hit"], ["live-sat", "live-sat-sl", "live-sat-track", "live-sat-sel"]);
}
async function loadCoreSats() {
  S.libMod = await satLib();
  const results = await Promise.allSettled(SAT_GROUPS.map(([g]) => loadGP(`gp:${g}`, `GROUP=${g}`)));
  const byNorad = new Map();
  let firstErr = null, oldest = Infinity, stale = false;
  results.forEach((r, i) => {
    const g = SAT_GROUPS[i][0];
    if (r.status === "rejected") { S.groupInfo[g] = { error: r.reason?.message ?? "unavailable" }; firstErr ??= r.reason; return; }
    oldest = Math.min(oldest, r.value.t);
    stale ||= !!r.value.stale;
    const sats = buildSats(r.value.rows, g);
    S.groupInfo[g] = { count: sats.length, t: r.value.t, stale: !!r.value.stale };
    for (const s of sats) if (!byNorad.has(s.norad)) byNorad.set(s.norad, s);
  });
  if (!byNorad.size) throw firstErr ?? new Error("no satellites loaded");
  S.core = [...byNorad.values()];
  S.coreAt = oldest;
  S.stale = stale;
  if (S.sel) S.sel = byNorad.get(S.sel.norad) ?? S.sel;
  rebuildSats();
  satTick();
  satTimer();
  return { count: S.core.length, asOf: oldest };
}
async function loadStarlink() {
  S.libMod = await satLib();
  const r = await loadGP("gp:starlink", "GROUP=starlink");
  S.starlink = buildSats(r.rows, "starlink");
  S.starText = r.text;
  S.starAt = r.t;
  rebuildSats();
  sendSet("sl");
  S.tick = 0;
  satTick();
  satTimer();
  return { count: S.starlink.length, asOf: r.t };
}
const satFeedCommon = {
  group: "orbit", kind: "geojson",
  source: "CelesTrak GP element sets (18th Space Defense Squadron data) propagated in the browser with SGP4 (satellite.js 7.1.0, MIT)",
  attribution: "Orbital data: CelesTrak (celestrak.org)",
  license: "CelesTrak public GP data, free with attribution; satellite.js MIT",
  sourceShort: "CelesTrak · positions computed with SGP4", licenseShort: "Free with attribution",
  refreshMs: 2 * HOUR + MIN,
  unmount(map) {
    if (S.sel && ((S.sel.starlink && !isOn("starlink")) || (!isOn("satellites") && S.core.includes(S.sel)))) deselectSat();
    if (!isOn("satellites") && !isOn("starlink")) removeSatLayers(map);
    else {
      rebuildSats();
      sendSet("sl");
      if (!isOn("starlink")) setGeo(map, "live-sat-sl", EMPTY());
      satTick();
    }
  },
};
defineFeed({
  ...satFeedCommon,
  id: "satellites", title: "Satellites", glyph: "satellite",
  description: "More than a thousand satellites (space stations, the brightest objects, GPS, Galileo, weather, Earth-observation, science and geostationary) positioned every second from CelesTrak elements. The ISS and Tiangong are labelled; click any satellite for its orbit, ground track and follow mode.",
  keywords: ["satellites", "satellite", "iss", "space station", "tiangong", "orbit", "gps", "galileo", "geostationary", "celestrak", "live"],
  blurb: () => "Stations, GPS, weather, GEO and more",
  countText: (f) => (f.state.count != null ? `${fmt(f.state.count)} tracked${S.stale ? " · cached elements" : ""}` : null),
  freshMs: 3 * HOUR,
  mount(map) { ensureSatLayers(map); rebuildSats(); sendSet("sl"); if (S.libMod) satTick(); satTimer(); },
  load: loadCoreSats,
  summary: () => (S.core.length ? `${plural(S.core.length, "satellite")} tracked` : null),
  opts() {
    const counts = {};
    for (const s of S.core) counts[s.klass] = (counts[s.klass] ?? 0) + 1;
    const missing = SAT_GROUPS.filter(([g]) => S.groupInfo[g]?.error).map(([, l]) => l);
    if (!S.core.length) return `<p class="lv-note">Positions are computed in your browser from CelesTrak's published orbital elements once they arrive.${missing.length && missing.length < SAT_GROUPS.length ? ` Unavailable right now: ${esc(missing.join(", "))}.` : ""}</p>`;
    return `
      <div class="lv-keys">${Object.entries(ORBIT).map(([k, o]) => `<span class="lv-key" title="${esc(o.label)}"><i style="--c:${o.c}"></i>${k}${counts[k] ? ` <b>${fmt(counts[k])}</b>` : ""}</span>`).join("")}</div>
      <div class="lv-chips" role="group" aria-label="Find a spacecraft">
        <button type="button" class="chip chip-btn lv-chip" data-sat="25544">${icon("target", 14)}ISS</button>
        <button type="button" class="chip chip-btn lv-chip" data-sat="48274">${icon("target", 14)}Tiangong</button>
        <button type="button" class="chip chip-btn lv-chip" data-sat="20580">${icon("target", 14)}Hubble</button>
      </div>
      <p class="lv-note">Positions are computed in your browser every second from published orbital elements (accurate to a few km for fresh elements).${missing.length ? ` Unavailable right now: ${esc(missing.join(", "))}.` : ""}</p>`;
  },
  bindOpts(el) {
    el.querySelectorAll("[data-sat]").forEach((b) => (b.onclick = () => app.tools.run("track_satellite", { norad_id: Number(b.dataset.sat), follow: true }).catch(() => {})));
  },
  hits: [{
    layers: ["live-sat", "live-sat-hit", "live-sat-lbl", "live-sat-sel", "live-sat-sel-lbl", "live-sat-track", "live-sat-track-past", "live-sat-sl", "live-sat-sl-hit"],
    click: (f) => {
      const s = f.layer.id.startsWith("live-sat-track") || f.layer.id.startsWith("live-sat-sel") ? S.sel : S.byNorad.get(f.properties.k);
      if (s) selectSat(s);
    },
    hover: (f) => {
      const s = f.layer.id.startsWith("live-sat-track") || f.layer.id.startsWith("live-sat-sel") ? S.sel : S.byNorad.get(f.properties.k);
      return s ? `${s.name}${s.pos ? ` · ${fmt(s.pos.alt)} km` : ""}` : null;
    },
  }],
});
defineFeed({
  ...satFeedCommon,
  id: "starlink", title: "Starlink constellation", glyph: "starlink",
  description: "Every Starlink satellite CelesTrak lists (several thousand), drawn as a faint shell. Large download (about 5 MB), cached for two hours.",
  keywords: ["starlink", "spacex", "constellation", "megaconstellation", "satellites", "live"],
  blurb: () => "Thousands of objects · ~5 MB download",
  countText: (f) => (f.state.count != null ? `${fmt(f.state.count)} tracked` : null),
  freshMs: 3 * HOUR,
  mount(map) { ensureSatLayers(map); rebuildSats(); sendSet("sl"); if (S.libMod) satTick(); satTimer(); },
  load: loadStarlink,
  summary: () => (S.starlink.length ? `${plural(S.starlink.length, "Starlink satellite")}` : null),
  opts: () => `<p class="lv-note">The full Starlink shell is a one-off download of about 5 MB, then cached in this browser for 2 hours (CelesTrak's refresh cycle).</p>`,
});

function drawTrack() {
  const map = app.map, s = S.sel;
  S.trackAt = Date.now();
  if (!s || !S.libMod) return setGeo(map, "live-sat-track", EMPTY());
  const P = s.period * MIN, steps = 240, now = Date.now();
  const past = [], fut = [];
  for (let k = 0; k <= steps; k++) {
    const t = now - P + (k * 2 * P) / steps;
    const p = satPos(s, new Date(t));
    if (!p) continue;
    (t <= now ? past : fut).push([p.lng, p.lat]);
  }
  if (past.length && fut.length) fut.unshift(past[past.length - 1]);
  const feats = [];
  for (const [part, coords] of [["past", past], ["future", fut]]) {
    for (const line of splitDateline(coords)) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { part } });
  }
  setGeo(map, "live-sat-track", { type: "FeatureCollection", features: feats });
}
function selLabelFilter() {
  const m = app.map;
  if (m.getLayer("live-sat-lbl")) m.setFilter("live-sat-lbl", ["all", ["==", ["get", "h"], 1], ["!=", ["get", "k"], S.sel?.norad ?? -1]]);
}
function selectSat(s, { follow = false } = {}) {
  const already = S.sel?.norad === s.norad;
  S.sel = s;
  selLabelFilter();
  if (!S.byNorad.has(s.norad)) rebuildSats();
  drawTrack();
  if (!already || cardKind !== "sat") satCard();
  if (follow) startFollow();
  if (!S.raf) S.raf = requestAnimationFrame(satFrame);
}
function deselectSat() {
  stopFollow(false);
  S.sel = null;
  selLabelFilter();
  cancelAnimationFrame(S.raf);
  S.raf = 0;
  const m = app.map;
  setGeo(m, "live-sat-track", EMPTY());
  setGeo(m, "live-sat-sel", EMPTY());
  if (cardKind === "sat") app.ui.hideCard();
}
/** Per-frame: move the selection ring (10 Hz) and, when following, keep the camera on it. */
function satFrame() {
  S.raf = 0;
  const s = S.sel, m = app.map;
  if (!s || !S.libMod) return;
  const now = Date.now();
  const p = satPos(s, new Date(now));
  if (p) {
    if (now - S.selAt > 100) {
      S.selAt = now;
      setGeo(m, "live-sat-sel", { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { n: s.label ?? s.name } }] });
    }
    if (S.follow) followCamera(p);
  }
  S.raf = requestAnimationFrame(satFrame);
}
function followCamera(p) {
  const m = app.map;
  // jumpTo stops in-flight gestures, so stay hands-off while a pointer is down or the map is moving.
  if (S.pointers.size || m.isMoving()) return;
  if (S.lastCenter) {
    const c = m.getCenter();
    const a = m.project(c), b = m.project(S.lastCenter);
    if (Math.hypot(a.x - b.x, a.y - b.y) > 60) return stopFollow(true);
  }
  const off = openSpaceOffset();
  if (!S.followEased) {
    // First frame: glide into the open space once, then track frame by frame.
    S.followEased = true;
    S.lastCenter = null;
    m.easeTo({ center: [p.lng, p.lat], offset: off, duration: 450 });
    return;
  }
  // Same zoom, so the offset is safe on the globe (only a combined zoom change misplaces it).
  if (off[0] || off[1]) m.easeTo({ center: [p.lng, p.lat], offset: off, duration: 0 });
  else m.jumpTo({ center: [p.lng, p.lat] });
  S.lastCenter = m.getCenter().toArray();
}
/** Pixel offset from the map centre to the middle of the space the open card leaves free. */
function openSpaceOffset() {
  const card = $("#card");
  if (!card || card.hidden) return [0, 0];
  const c = card.getBoundingClientRect(), box = app.map.getContainer().getBoundingClientRect();
  if (innerWidth <= 720) return [0, Math.round((110 + c.top) / 2 - box.top - box.height / 2)];
  const dock = $("#dock"), left = dock && !dock.hidden ? dock.getBoundingClientRect().right : 70;
  const x = (left + c.left) / 2 - box.left - box.width / 2;
  return [Math.abs(x) < 40 ? 0 : Math.round(x), 0];
}
function startFollow() {
  const m = app.map;
  S.follow = true;
  S.followEased = false;
  S.lastCenter = null;
  m.scrollZoom.disable();
  m.scrollZoom.enable({ around: "center" });
  m.touchZoomRotate.enable({ around: "center" });
  document.body.dataset.liveFollow = "true";
  syncFollowButton();
}
function stopFollow(notify) {
  if (!S.follow) return;
  const m = app.map;
  S.follow = false;
  S.lastCenter = null;
  m.scrollZoom.disable();
  m.scrollZoom.enable();
  m.touchZoomRotate.enable();
  delete document.body.dataset.liveFollow;
  syncFollowButton();
  if (notify) app.ui.toast("Stopped following");
}
function syncFollowButton() {
  const b = $("#card-body [data-act='follow']");
  if (!b) return;
  b.setAttribute("aria-pressed", String(S.follow));
  b.querySelector("span").textContent = S.follow ? "Following" : "Follow";
}
function satCard() {
  const s = S.sel;
  const p = s.pos ?? satPos(s, new Date());
  const o = ORBIT[s.klass];
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${s.label ? "#ffffff" : s.starlink ? "#a9c4dd" : o.c}">${icon("satellite", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Satellite · ${esc(o.label)}</div>
        <h3>${esc(s.name)}</h3>
        <div class="sub">NORAD ${s.norad}${s.cospar ? ` · COSPAR ${esc(s.cospar)}` : ""}</div>
      </div>
    </div>
    ${kv([
      ["Altitude", `<span id="lv-sat-alt">${p ? `${fmt(p.alt)} km` : "—"}</span>`, true],
      ["Speed", `<span id="lv-sat-spd">${p?.speed ? `${fmt(p.speed, 2)} km/s` : "—"}</span>`, true],
      ["Over", `<span id="lv-sat-pos">${p ? `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}` : "—"}</span>`, true],
      ["Inclination", `${fmt(s.inc, 1)}°`],
      ["Period", s.period > 300 ? `${fmt(s.period / 60, 2)} h` : `${fmt(s.period, 1)} min`],
      ["Perigee × apogee", `${fmt(s.perigee)} × ${fmt(s.apogee)} km`],
      ["Elements epoch", `${stamp(s.epoch)} (${ago(s.epoch)})`],
    ])}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="follow" aria-pressed="${S.follow}">${icon("target", 16)}<span>${S.follow ? "Following" : "Follow"}</span></button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="fly">Fly to</button>
      ${extLink(`https://celestrak.org/satcat/table-satcat.php?CATNR=${s.norad}`, "CelesTrak")}
    </div>
    <p class="note">Ground track shows one orbit back (solid) and ahead (dashed). Position computed with SGP4 (satellite.js) from CelesTrak elements${S.coreAt && !s.starlink ? ` fetched ${hhmm(S.coreAt)}` : ""}; accuracy degrades by roughly 1–3 km a day after the epoch. Following stops when you drag the map.</p>`;
  showLiveCard("sat", html, (body) => {
    body.querySelector('[data-act="follow"]').onclick = () => (S.follow ? stopFollow(false) : (startFollow(), flyToSat(s)));
    body.querySelector('[data-act="fly"]').onclick = () => flyToSat(s);
  });
  onCardClose(() => { if (S.sel === s) deselectSat(); });
}
function updateSatCard() {
  if (cardKind !== "sat" || !S.sel?.pos) return;
  const p = S.sel.pos;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("lv-sat-alt", `${fmt(p.alt)} km`);
  set("lv-sat-spd", p.speed ? `${fmt(p.speed, 2)} km/s` : "—");
  set("lv-sat-pos", `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`);
}
function flyToSat(s) {
  const p = satPos(s, new Date(Date.now() + 2000));
  if (!p) return;
  const zoom = s.klass === "LEO" ? Math.max(3, Math.min(app.map.getZoom(), 4.2)) : 1.8;
  S.lastCenter = null;
  S.followEased = false;
  app.map.flyTo({ center: [p.lng, p.lat], zoom, pitch: 0, duration: 2000 });
}
function findSat(q) {
  const t = String(q).trim().toLowerCase();
  if (!t) return null;
  const pool = [...S.core, ...S.starlink, ...S.extra];
  return pool.find((s) => s.name.toLowerCase() === t) ??
    pool.find((s) => s.name.toLowerCase().startsWith(t)) ??
    pool.find((s) => s.name.toLowerCase().includes(t)) ?? null;
}

/* ================================================================ ships (Fintraffic AIS, Baltic) */
const SHIP_CLASS = {
  cargo: { label: "Cargo", c: "#34d399" }, tanker: { label: "Tanker", c: "#f87171" }, passenger: { label: "Passenger", c: "#60a5fa" },
  fishing: { label: "Fishing", c: "#fbbf24" }, hsc: { label: "High-speed craft", c: "#22d3ee" }, service: { label: "Tug & service", c: "#c084fc" },
  leisure: { label: "Sailing & pleasure", c: "#f472b6" }, other: { label: "Other / unknown", c: "#cbd5e1" },
};
const NAV = ["Under way using engine", "At anchor", "Not under command", "Restricted manoeuvrability", "Constrained by draught", "Moored", "Aground", "Engaged in fishing", "Under way sailing"];
function shipClass(t) {
  if (t == null) return "other";
  if (t >= 70 && t < 80) return "cargo";
  if (t >= 80 && t < 90) return "tanker";
  if (t >= 60 && t < 70) return "passenger";
  if (t === 30) return "fishing";
  if (t >= 40 && t < 50) return "hsc";
  if ([31, 32, 33, 34, 35, 50, 51, 52, 53, 54, 55, 58].includes(t)) return "service";
  if (t === 36 || t === 37) return "leisure";
  return "other";
}
const SHIPS = { pos: new Map(), meta: new Map(), metaAt: 0, counts: {}, updated: null, sel: null };
function decodeEta(v) {
  if (!v) return null;
  const mo = (v >> 16) & 15, d = (v >> 11) & 31, h = (v >> 6) & 31, mi = v & 63;
  if (!mo || !d || h > 23 || mi > 59) return null;
  return `${d} ${MONTHS[mo - 1]}, ${pad2(h)}:${pad2(mi)} UTC`;
}
async function loadShips(map) {
  const needMeta = Date.now() - SHIPS.metaAt > 30 * MIN;
  const [loc, meta] = await Promise.all([
    fetchJSON(SRC.ais, { headers: DT_HEADERS, timeout: 25000 }),
    needMeta ? fetchJSON(SRC.aisVessels, { headers: DT_HEADERS, timeout: 25000 }).catch(() => null) : null,
  ]);
  if (Array.isArray(meta)) { SHIPS.meta = new Map(meta.map((v) => [v.mmsi, v])); SHIPS.metaAt = Date.now(); }
  const now = Date.now(), feats = [], counts = {};
  SHIPS.pos = new Map();
  for (const f of loc.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const v = SHIPS.meta.get(p.mmsi);
    const cls = shipClass(v?.shipType);
    const moving = p.sog >= 0.5 && p.sog < 102.3;
    const hdg = p.heading >= 0 && p.heading < 360 ? p.heading : p.cog >= 0 && p.cog < 360 ? p.cog : 0;
    counts[cls] = (counts[cls] ?? 0) + 1;
    SHIPS.pos.set(p.mmsi, { ...p, lng: c[0], lat: c[1] });
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [c[0], c[1]] }, properties: { m: p.mmsi, c: cls, h: hdg, mv: moving ? 1 : 0, old: now - (p.timestampExternal ?? now) > HOUR ? 1 : 0 } });
  }
  SHIPS.counts = counts;
  SHIPS.updated = Date.parse(loc.dataUpdatedTime) || now;
  const sel = SHIPS.sel != null && cardKind === "ship" ? SHIPS.pos.get(SHIPS.sel) : null;
  if (sel) setPick([sel.lng, sel.lat], 13);
  setGeo(map, "live-ship", { type: "FeatureCollection", features: feats });
  return { count: feats.length, asOf: SHIPS.updated };
}
function shipCard(mmsi) {
  const p = SHIPS.pos.get(mmsi);
  if (!p) return;
  const v = SHIPS.meta.get(mmsi) ?? {};
  const cls = shipClass(v.shipType);
  const name = (v.name ?? "").trim();
  const dest = (v.destination ?? "").trim();
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${SHIP_CLASS[cls].c}">${icon("ship", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Vessel · ${esc(SHIP_CLASS[cls].label)}</div>
        <h3>${esc(name || `MMSI ${mmsi}`)}</h3>
        <div class="sub">MMSI ${mmsi}${v.callSign?.trim() ? ` · call sign ${esc(v.callSign.trim())}` : ""}${v.imo ? ` · IMO ${v.imo}` : ""}</div>
      </div>
    </div>
    ${kv([
      ["Speed", p.sog != null && p.sog < 102.3 ? `${fmt(p.sog, 1)} kn` : "Not reported"],
      ["Course", p.cog != null && p.cog < 360 ? `${fmt(p.cog, 1)}°` : "Not reported"],
      ["Heading", p.heading != null && p.heading < 360 ? `${p.heading}°` : "Not reported"],
      ["Status", NAV[p.navStat] ?? "Not defined"],
      ["Destination", dest || "Not reported"],
      ["ETA", decodeEta(v.eta)],
      ["Draught", v.draught ? `${fmt(v.draught / 10, 1)} m` : null],
      ["Position", `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)} · ${p.timestampExternal ? ago(p.timestampExternal) : "time unknown"}`],
    ])}
    <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly to</button></div>
    <p class="note">Source: Fintraffic / digitraffic.fi, CC BY 4.0. AIS positions around Finland and the Baltic Sea only; name, destination and ETA are entered by the crew.</p>`;
  showLiveCard("ship", html, (body) => {
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(app.map.getZoom(), 11), speed: 1.3 });
  }, [p.lng, p.lat], 13);
  SHIPS.sel = mmsi;
  onCardClose(() => { SHIPS.sel = null; });
}
defineFeed({
  id: "ships-baltic", title: "Ships (Baltic Sea only)", glyph: "ship", group: "traffic",
  description: "Live AIS positions of ships around Finland and the Baltic Sea from Fintraffic's Digitraffic service, pointed along their heading and coloured by vessel type.",
  keywords: ["ships", "vessels", "ais", "baltic", "finland", "shipping", "marine traffic", "boats", "live"],
  source: "Fintraffic Digitraffic Marine — AIS locations and vessel metadata (Baltic Sea)",
  attribution: "Source: Fintraffic / digitraffic.fi, licence CC BY 4.0",
  license: "CC BY 4.0",
  sourceShort: "Fintraffic / digitraffic.fi", licenseShort: "CC BY 4.0",
  refreshMs: 60000,
  blurb: () => "AIS around Finland and the Baltic Sea",
  countText: (f) => (f.state.count != null ? plural(f.state.count, "vessel") : null),
  mount(map) {
    for (const [k, c] of Object.entries(SHIP_CLASS)) {
      shapeIcon(map, `live-ship-${k}`, "M12 2.5 18.5 20.5 12 16.8 5.5 20.5z", c.c, 18);
      addIcon(map, `live-ship-${k}-s`, 12, (g, s) => { g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,0.35)"; g.fill(); g.lineWidth = 2.2; g.strokeStyle = c.c; g.stroke(); });
    }
    addGeo(map, "live-ship");
    map.addLayer({ id: "live-ship", type: "symbol", source: "live-ship", layout: {
      "icon-image": ["concat", "live-ship-", ["get", "c"], ["case", ["==", ["get", "mv"], 1], "", "-s"]],
      "icon-rotate": ["case", ["==", ["get", "mv"], 1], ["get", "h"], 0], "icon-rotation-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 7, 0.85, 12, 1.1],
      "symbol-sort-key": ["get", "mv"] },
      paint: { "icon-opacity": ["case", ["==", ["get", "old"], 1], 0.5, 1] } }, app.layers.anchor("live"));
  },
  unmount(map) { drop(map, ["live-ship"], ["live-ship"]); },
  load: loadShips,
  points: () => [...SHIPS.pos.values()].map((p) => [p.lng, p.lat]),
  summary: () => (SHIPS.pos.size ? `${plural(SHIPS.pos.size, "vessel")} in the Baltic` : null),
  opts: () => `
    <div class="lv-keys">${Object.entries(SHIP_CLASS).map(([k, c]) => `<span class="lv-key"><i style="--c:${c.c}"></i>${esc(c.label)}${SHIPS.counts[k] ? ` <b>${fmt(SHIPS.counts[k])}</b>` : ""}</span>`).join("")}</div>
    <p class="lv-note">Arrows point along the heading; rings are ships stopped, moored or at anchor; faded markers have not reported for over an hour. No free, open, browser-accessible AIS feed covers the rest of the world yet.</p>
    <button type="button" class="btn btn-ghost btn-sm" data-act="baltic">Go to the Baltic</button>`,
  bindOpts(el) { el.querySelector('[data-act="baltic"]')?.addEventListener("click", () => app.map.flyTo({ center: [21.5, 59.6], zoom: 5.4, speed: 1.3 })); },
  hits: [{
    layers: ["live-ship"],
    click: (f) => shipCard(f.properties.m),
    hover: (f) => { const v = SHIPS.meta.get(f.properties.m); const p = SHIPS.pos.get(f.properties.m); return `${(v?.name ?? "").trim() || `MMSI ${f.properties.m}`}${p?.sog != null && p.sog < 102.3 ? ` · ${fmt(p.sog, 1)} kn` : ""}`; },
  }],
});

/* ================================================================ cameras */
const CAM_PROV = {
  tfl: { area: "London", op: "Transport for London", kind: "Traffic camera", lic: "Powered by TfL Open Data" },
  fi: { area: "Finland", op: "Fintraffic", kind: "Road weather camera", lic: "Source: Fintraffic / digitraffic.fi, CC BY 4.0" },
};
const CAMS = { list: [], counts: {}, errors: {} };
function prettyFi(name) {
  const m = /^(vt|kt|st|mt|yt)(\d+)_(.+)$/i.exec(name ?? "");
  return m ? `${m[3].replace(/_/g, " ")} · road ${m[2]}` : String(name ?? "Camera").replace(/_/g, " ");
}
async function loadCameras(map) {
  const [tfl, fi] = await Promise.allSettled([
    fetchJSON(SRC.tfl, { timeout: 25000 }),
    fetchJSON(SRC.fiCams, { headers: DT_HEADERS, timeout: 25000 }),
  ]);
  const list = [], errors = {};
  if (tfl.status === "fulfilled" && Array.isArray(tfl.value)) {
    for (const c of tfl.value) {
      const a = Object.fromEntries((c.additionalProperties ?? []).map((x) => [x.key, x.value]));
      if (a.available === "false" || !a.imageUrl || !Number.isFinite(c.lat)) continue;
      list.push({ p: "tfl", id: c.id, name: c.commonName, lat: c.lat, lng: c.lon, img: a.imageUrl, video: a.videoUrl, view: a.view });
    }
  } else errors.tfl = tfl.reason?.message ?? "unavailable";
  if (fi.status === "fulfilled") {
    for (const f of fi.value.features ?? []) {
      const pr = f.properties ?? {};
      const presets = (pr.presets ?? []).filter((x) => x.inCollection).map((x) => x.id);
      if (pr.collectionStatus !== "GATHERING" || !presets.length || !f.geometry) continue;
      list.push({ p: "fi", id: f.id, name: prettyFi(pr.name), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], presets });
    }
  } else errors.fi = fi.reason?.message ?? "unavailable";
  if (!list.length) throw new Error(Object.values(errors)[0] ?? "no cameras available");
  CAMS.list = list;
  CAMS.errors = errors;
  CAMS.counts = list.reduce((m, c) => ((m[c.p] = (m[c.p] ?? 0) + 1), m), {});
  setGeo(map, "live-cam", { type: "FeatureCollection", features: list.map((c, k) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { k, p: c.p } })) });
  return { count: list.length, asOf: Date.now() };
}
function cameraCard(cam) {
  const prov = CAM_PROV[cam.p];
  let preset = 0, timer = 0, clip = false;
  const url = () => (cam.p === "fi" ? SRC.fiCamImg(cam.presets[preset]) : cam.img);
  const html = `
    <div class="lv-cam" data-state="loading">
      <img alt="Latest image from the ${esc(cam.name)} camera" decoding="async">
      <div class="lv-cam-msg" aria-live="polite">Loading the latest image…</div>
      <span class="lv-live-badge"><span class="live-dot" aria-hidden="true"></span>Live</span>
    </div>
    <div class="eyebrow">${esc(prov.kind)} · ${esc(prov.area)}</div>
    <h3>${esc(cam.name)}</h3>
    <div class="sub">${esc(prov.op)}${cam.p === "tfl" && cam.view ? ` · view: ${esc(cam.view)}` : ""}</div>
    ${cam.presets?.length > 1 ? `<div class="lv-chips" role="group" aria-label="Camera views">${cam.presets.map((p, i) => `<button type="button" class="chip chip-btn lv-chip${i ? "" : " chip-on"}" data-preset="${i}" aria-pressed="${!i}">View ${i + 1}</button>`).join("")}</div>` : ""}
    ${kv([["Image", `<span id="lv-cam-time">loading…</span>`, true], ["Location", `${cam.lat.toFixed(4)}, ${cam.lng.toFixed(4)}`]])}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly to</button>
      ${cam.video ? `<button type="button" class="btn btn-ghost btn-sm" data-act="clip">${icon("play", 14)}Latest clip</button>` : ""}
      <a class="btn btn-ghost btn-sm" data-act="full" href="${esc(url())}" target="_blank" rel="noopener">Full size ${extIcon}</a>
    </div>
    <p class="note">${esc(prov.lic)}. The image refreshes every 60 seconds while this card is open.</p>`;
  showLiveCard("camera", html, (body) => {
    const box = body.querySelector(".lv-cam"), img = box.querySelector("img"), msg = box.querySelector(".lv-cam-msg");
    const setTime = (t) => { const el = body.querySelector("#lv-cam-time"); if (el) el.textContent = t; };
    const load = (first) => {
      if (clip || document.hidden) return;
      const next = new Image();
      next.decoding = "async";
      next.onload = () => {
        img.src = next.src;
        box.dataset.state = "ok";
        const d = new Date();
        setTime(`Fetched ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`);
      };
      next.onerror = () => {
        if (first || box.dataset.state !== "ok") { box.dataset.state = "error"; msg.textContent = "This camera isn't sending an image right now."; setTime("Unavailable"); }
        else setTime("Last refresh failed; showing the previous image");
      };
      next.src = `${url()}${url().includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 1000)}`;
    };
    load(true);
    timer = setInterval(() => load(false), 60000);
    onCardClose(() => clearInterval(timer));
    body.querySelector('[data-act="fly"]').onclick = () => app.map.flyTo({ center: [cam.lng, cam.lat], zoom: Math.max(app.map.getZoom(), 15), pitch: 55, speed: 1.3 });
    body.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
      preset = Number(b.dataset.preset);
      body.querySelectorAll("[data-preset]").forEach((x) => { x.classList.toggle("chip-on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      body.querySelector('[data-act="full"]').href = url();
      box.dataset.state = "loading";
      msg.textContent = "Loading the latest image…";
      load(true);
    }));
    body.querySelector('[data-act="clip"]')?.addEventListener("click", (e) => {
      clip = true;
      const v = document.createElement("video");
      Object.assign(v, { src: cam.video, autoplay: true, muted: true, loop: true, playsInline: true, controls: true });
      v.setAttribute("aria-label", `Latest video clip from ${cam.name}`);
      v.onerror = () => { box.dataset.state = "error"; msg.textContent = "The clip could not be loaded."; };
      img.replaceWith(v);
      box.dataset.state = "ok";
      setTime("Latest clip from TfL (a few seconds, updated every few minutes)");
      e.currentTarget.remove();
      v.focus({ preventScroll: true });
    });
  }, [cam.lng, cam.lat], 15);
}
defineFeed({
  id: "cameras", title: "Public cameras", glyph: "camera", group: "traffic",
  description: "Public live cameras: TfL JamCams across London and Fintraffic road-weather cameras across Finland. Click one for the latest image.",
  keywords: ["cameras", "webcams", "cctv", "traffic cameras", "jamcams", "live view", "london", "finland", "live"],
  source: "Transport for London JamCams (TfL Unified API) · Fintraffic Digitraffic weather cameras",
  attribution: "Cameras: Powered by TfL Open Data · Fintraffic / digitraffic.fi (CC BY 4.0)",
  license: "TfL Open Data licence; Fintraffic CC BY 4.0",
  sourceShort: "TfL · Fintraffic", licenseShort: "Open data, attribution",
  refreshMs: 30 * MIN,
  blurb: () => "London and Finland",
  countText: (f) => (f.state.count != null ? plural(f.state.count, "camera") : null),
  mount(map) {
    addIcon(map, "live-cam-ic", 24, (g, s) => {
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1.5, 0, Math.PI * 2);
      g.fillStyle = "#141414"; g.fill(); g.lineWidth = 1.6; g.strokeStyle = "#ffffff"; g.stroke();
      strokeGlyph(g, "camera", s / 2, s / 2, s * 0.56, "#ffffff", 2.4);
    });
    addGeo(map, "live-cam", { cluster: true, clusterRadius: 42, clusterMaxZoom: 11, maxzoom: 14 });
    const before = app.layers.anchor("live");
    map.addLayer({ id: "live-cam-cluster", type: "circle", source: "live-cam", filter: ["has", "point_count"], paint: {
      "circle-color": "rgba(20,20,20,0.82)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
      "circle-radius": ["step", ["get", "point_count"], 11, 20, 14, 100, 18, 500, 23] } }, before);
    map.addLayer({ id: "live-cam-count", type: "symbol", source: "live-cam", filter: ["has", "point_count"], layout: {
      "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } }, before);
    map.addLayer({ id: "live-cam", type: "symbol", source: "live-cam", filter: ["!", ["has", "point_count"]], layout: {
      "icon-image": "live-cam-ic", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 14, 1.05] } }, before);
    if (CAMS.list.length) setGeo(map, "live-cam", { type: "FeatureCollection", features: CAMS.list.map((c, k) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { k, p: c.p } })) });
  },
  unmount(map) { drop(map, ["live-cam", "live-cam-count", "live-cam-cluster"], ["live-cam"]); },
  load: loadCameras,
  points: () => CAMS.list.map((c) => [c.lng, c.lat]),
  summary: () => (CAMS.list.length ? `${plural(CAMS.list.length, "public camera")}` : null),
  opts: () => `
    <div class="lv-chips" role="group" aria-label="Go to a camera network">${[["tfl", "-0.118,51.509,10.5"], ["fi", "25.5,63.2,5"]].map(([k, go]) => `
      <button type="button" class="chip chip-btn lv-chip" data-go="${go}">${esc(CAM_PROV[k].area)}<span class="n">${CAMS.counts[k] ? fmt(CAMS.counts[k]) : CAMS.errors[k] ? "offline" : ""}</span></button>`).join("")}
    </div>
    <p class="lv-note">Public cameras run by transport agencies; images load straight from each operator. There is no open worldwide camera index, so coverage is limited to these networks.</p>`,
  bindOpts(el) {
    el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
      const [lng, lat, z] = b.dataset.go.split(",").map(Number);
      app.map.flyTo({ center: [lng, lat], zoom: z, pitch: 0, speed: 1.3 });
    }));
  },
  hits: [{
    layers: ["live-cam", "live-cam-cluster", "live-cam-count"],
    click: async (f) => {
      if (f.properties.cluster_id != null) {
        const z = await app.map.getSource("live-cam").getClusterExpansionZoom(f.properties.cluster_id);
        return app.map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 });
      }
      const c = CAMS.list[f.properties.k];
      if (c) cameraCard(c);
    },
    hover: (f) => (f.properties.cluster_id != null ? `${fmt(f.properties.point_count)} cameras · click to expand` : CAMS.list[f.properties.k]?.name ?? null),
  }],
});

/* ================================================================ aircraft (relay only) */
const AIR = { list: new Map(), note: null, sel: null };
const AIR_BANDS = [["ground", "#9ca3af"], ["low", "#4ade80"], ["mid", "#facc15"], ["high", "#fb923c"], ["cruise", "#38bdf8"]];
const airBand = (ft, ground) => (ground ? "ground" : ft < 10000 ? "low" : ft < 20000 ? "mid" : ft < 30000 ? "high" : "cruise");
function relayBase() { return String(app.config.liveRelay ?? "").trim().replace(/\/+$/, ""); }
function defineAircraft() {
  if (FEEDS.has("aircraft") || !relayBase()) return;
  defineFeed({
    id: "aircraft", title: "Aircraft", glyph: "plane", group: "traffic",
    description: "Live aircraft positions from ADS-B around the centre of the view (zoom in to 5 or closer), via the Baryon relay, pointed along their track and coloured by altitude.",
    keywords: ["aircraft", "planes", "flights", "ads-b", "air traffic", "live"],
    source: "adsb.lol v2 API (community ADS-B network) via the Baryon relay",
    attribution: "ADS-B data © adsb.lol contributors (ODbL)",
    license: "ODbL 1.0",
    sourceShort: "adsb.lol via the Baryon relay", licenseShort: "ODbL",
    refreshMs: 10000, freshMs: 40000,
    blurb: () => "Around the view centre, zoom 5+",
    countText: (f) => (AIR.note ? AIR.note : f.state.count != null ? plural(f.state.count, "aircraft", "aircraft") : null),
    idle: () => !!AIR.note,
    mount(map) {
      for (const [k, c] of AIR_BANDS) shapeIcon(map, `live-air-${k}`, G.plane[0], c, 22);
      addGeo(map, "live-air");
      map.addLayer({ id: "live-air", type: "symbol", source: "live-air", layout: {
        "icon-image": ["concat", "live-air-", ["get", "b"]], "icon-rotate": ["get", "trk"], "icon-rotation-alignment": "map",
        "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1] } }, app.layers.anchor("live"));
    },
    unmount(map) { drop(map, ["live-air"], ["live-air"]); },
    async load(map) {
      if (map.getZoom() < 5) {
        AIR.note = "Zoom in closer (zoom 5+) to load aircraft";
        AIR.list = new Map();
        setGeo(map, "live-air", EMPTY());
        return { count: null, asOf: null };
      }
      const c = map.getCenter(), b = map.getBounds();
      const km = Math.max(...[b.getNorthEast(), b.getSouthWest()].map((p) => c.distanceTo(p) / 1000));
      const nm = clamp(Math.ceil(km / 1.852), 5, 250);
      const d = await fetchJSON(`${relayBase()}/adsb/v2/point/${c.lat.toFixed(3)}/${c.lng.toFixed(3)}/${nm}`, { timeout: 12000 });
      AIR.note = null;
      AIR.list = new Map();
      const feats = [];
      for (const a of d.ac ?? []) {
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !a.hex) continue;
        const ground = a.alt_baro === "ground";
        const ft = ground ? 0 : Number(a.alt_baro) || 0;
        AIR.list.set(a.hex, a);
        feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { hex: a.hex, b: airBand(ft, ground), trk: Number(a.track) || 0 } });
      }
      setGeo(map, "live-air", { type: "FeatureCollection", features: feats });
      const sel = AIR.sel && cardKind === "aircraft" ? AIR.list.get(AIR.sel) : null;
      if (sel) setPick([sel.lon, sel.lat], 15);
      // readsb-style "now" is in seconds; accept milliseconds too.
      const now = Number(d.now);
      return { count: feats.length, asOf: Number.isFinite(now) && now > 0 ? (now < 1e12 ? now * 1000 : now) : Date.now() };
    },
    summary: () => (AIR.list.size ? `${plural(AIR.list.size, "aircraft", "aircraft")} near the view` : null),
    opts: () => `
      <div class="lv-keys">${[["ground", "On ground"], ["low", "< 10k ft"], ["mid", "10–20k"], ["high", "20–30k"], ["cruise", "> 30k ft"]].map(([k, l]) => `<span class="lv-key"><i style="--c:${AIR_BANDS.find((x) => x[0] === k)[1]}"></i>${l}</span>`).join("")}</div>
      <p class="lv-note">Aircraft within up to 250 nautical miles of the view centre, refreshed every 10 seconds while zoomed in to 5 or closer.</p>`,
    hits: [{
      layers: ["live-air"],
      click: (f) => aircraftCard(f.properties.hex),
      hover: (f) => { const a = AIR.list.get(f.properties.hex); return a ? `${(a.flight ?? "").trim() || a.hex.toUpperCase()}${a.alt_baro === "ground" ? " · on ground" : a.alt_baro != null ? ` · ${fmt(a.alt_baro)} ft` : ""}` : null; },
    }],
  });
  app.map.on("moveend", () => {
    const f = FEEDS.get("aircraft");
    if (f && isOn(f) && !document.hidden && Date.now() - f.state.attemptAt >= f.refreshMs) refreshFeed(f).then(() => schedule(f));
  });
}
function aircraftCard(hex) {
  const a = AIR.list.get(hex);
  if (!a) return;
  const ground = a.alt_baro === "ground";
  const call = (a.flight ?? "").trim();
  const asOf = FEEDS.get("aircraft")?.state.asOf;
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:${AIR_BANDS.find(([k]) => k === airBand(Number(a.alt_baro) || 0, ground))[1]}">${icon("plane", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Aircraft · ADS-B</div>
        <h3>${esc(call || hex.toUpperCase())}</h3>
        <div class="sub">ICAO ${esc(hex.toUpperCase())}${a.r ? ` · ${esc(a.r)}` : ""}${a.t ? ` · ${esc(a.t)}` : ""}</div>
      </div>
    </div>
    ${kv([
      ["Altitude", ground ? "On the ground" : a.alt_baro != null ? `${fmt(a.alt_baro)} ft (${fmt(Number(a.alt_baro) * 0.3048)} m)` : "Not reported"],
      ["Ground speed", a.gs != null ? `${fmt(a.gs)} kt (${fmt(a.gs * 1.852)} km/h)` : "Not reported"],
      ["Track", a.track != null ? `${fmt(a.track)}°` : "Not reported"],
      ["Aircraft", a.desc],
      ["Operator", a.ownOp],
      ["Squawk", a.squawk],
      ["Category", a.category],
      ["Position", `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`],
      ["Reported", Number.isFinite(asOf) ? stampSec(asOf - (Number(a.seen_pos ?? a.seen) || 0) * 1000) : null],
    ])}
    <p class="note">ADS-B data © adsb.lol contributors (ODbL) via the Baryon relay.</p>`;
  showLiveCard("aircraft", html, null, [a.lon, a.lat], 15);
  AIR.sel = hex;
  onCardClose(() => { AIR.sel = null; });
}

/* ================================================================ launches (Launch Library 2) */
const LAUNCH = { data: null, at: 0, pending: null, sel: null };
async function getLaunches() {
  if (LAUNCH.data && Date.now() - LAUNCH.at < 10 * MIN) return LAUNCH;
  const saved = store.get("ll2");
  if (!LAUNCH.data && saved?.data && Date.now() - saved.at < 10 * MIN) { Object.assign(LAUNCH, saved); return LAUNCH; }
  LAUNCH.pending ??= (async () => {
    try {
      const d = await fetchJSON(`${SRC.ll2}?limit=12&hide_recent_previous=true&mode=normal`, { timeout: 20000 });
      LAUNCH.data = (d.results ?? []).map((r) => ({
        id: r.id, name: r.name, status: r.status?.abbrev ?? null, status_name: r.status?.name ?? null, net: r.net, net_precision: r.net_precision?.name ?? null,
        window_start: r.window_start, window_end: r.window_end, provider: r.launch_service_provider?.name ?? null,
        rocket: r.rocket?.configuration?.full_name ?? null, mission: r.mission?.name ?? null, mission_type: r.mission?.type ?? null,
        mission_description: r.mission?.description ?? null, orbit: r.mission?.orbit?.name ?? null, pad: r.pad?.name ?? null,
        location: r.pad?.location?.name ?? null, lat: parseFloat(r.pad?.latitude), lng: parseFloat(r.pad?.longitude), webcast_live: !!r.webcast_live,
      }));
      LAUNCH.at = Date.now();
      store.set("ll2", { data: LAUNCH.data, at: LAUNCH.at });
    } catch (err) {
      if (!LAUNCH.data && saved?.data) Object.assign(LAUNCH, saved);
      if (!LAUNCH.data) throw new Error(/429/.test(err.message) ? "Launch Library's free tier allows 15 requests an hour and that limit is used up; try again later" : err.message);
    } finally { LAUNCH.pending = null; }
  })();
  await LAUNCH.pending;
  return LAUNCH;
}
/** Launch Library NETs carry a precision; never print a clock time the schedule does not have. */
const launchPrecision = (l) => {
  const p = String(l.net_precision ?? "").toLowerCase();
  return !p || /^(second|minute|hour)$/.test(p) ? "time" : /^(day|morning|afternoon)$/.test(p) ? "day" : "coarse";
};
function netLabel(l, rel = true) {
  const t = Date.parse(l.net);
  if (!Number.isFinite(t)) return "Date to be determined";
  const k = launchPrecision(l);
  if (k === "time") return `${stamp(t)}${rel ? ` (${until(t)})` : ""}`;
  if (k === "day") return `${dayUTC(t)}, time to be confirmed`;
  return `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()} at the earliest (${String(l.net_precision).toLowerCase()} precision)`;
}
function launchCard(l) {
  LAUNCH.sel = l;
  const html = `
    <div class="lv-head">
      <div class="lv-glyph" style="--c:#ffffff">${icon("rocket", 22)}</div>
      <div class="grow">
        <div class="eyebrow">Launch · ${esc(l.status_name ?? l.status ?? "scheduled")}</div>
        <h3>${esc(l.mission ?? l.name)}</h3>
        <div class="sub">${esc([l.rocket, l.provider].filter(Boolean).join(" · "))}</div>
      </div>
    </div>
    ${kv([
      ["No earlier than", netLabel(l)],
      l.window_start && l.window_end && l.window_start !== l.window_end ? ["Window", `${hhmm(l.window_start)} – ${hhmm(l.window_end)}`] : null,
      ["Mission type", l.mission_type],
      ["Target orbit", l.orbit],
      ["Pad", [l.pad, l.location].filter(Boolean).join(", ")],
    ])}
    ${l.mission_description ? `<p style="margin-top:12px">${esc(l.mission_description.length > 360 ? `${l.mission_description.slice(0, 358)}…` : l.mission_description)}</p>` : ""}
    <div class="card-actions">${Number.isFinite(l.lat) ? `<button type="button" class="btn btn-primary btn-sm" data-act="fly">Fly to the pad</button>` : ""}</div>
    <p class="note">The Space Devs, Launch Library 2 · times are "no earlier than" and often slip · listing as of ${esc(hhmm(LAUNCH.at))}.</p>`;
  showLiveCard("launch", html, (body) => {
    body.querySelector('[data-act="fly"]')?.addEventListener("click", () => app.map.flyTo({ center: [l.lng, l.lat], zoom: 14, pitch: 55, speed: 1.2 }));
  });
  if (Number.isFinite(l.lat)) {
    const m = app.map;
    shapeIcon(m, "live-launch-ic", "M12 2.5c3 2.2 4.4 5.5 4.2 9.8L14.5 15h-5l-1.7-2.7C7.6 8 9 4.7 12 2.5z", "#ffffff", 22);
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [l.lng, l.lat] }, properties: { n: l.pad ?? "" } }] };
    if (m.getSource("live-launch")) setGeo(m, "live-launch", fc);
    else {
      m.addSource("live-launch", { type: "geojson", data: fc });
      m.addLayer({ id: "live-launch", type: "symbol", source: "live-launch", layout: { "icon-image": "live-launch-ic", "icon-allow-overlap": true, "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.4 } }, app.layers.anchor("live"));
    }
    onCardClose(() => drop(m, ["live-launch"], ["live-launch"]));
  }
}
HITS.push({ layers: ["live-launch"], click: () => LAUNCH.sel && launchCard(LAUNCH.sel), hover: (f) => f.properties.n || "Launch pad" });

/* ================================================================ map interaction */
let popup = null, hovering = false, moveRaf = 0, lastMove = null;
function hitLayers() { const m = app.map; return HITS.flatMap((h) => h.layers).filter((id) => m.getLayer(id)); }
function hitAt(point) {
  const layers = hitLayers();
  if (!layers.length) return null;
  const f = app.map.queryRenderedFeatures(point, { layers })[0];
  if (!f) return null;
  return { f, h: HITS.find((h) => h.layers.includes(f.layer.id)) };
}
function bindMap() {
  const m = app.map;
  popup = new app.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "lv-pop", maxWidth: "280px" });
  m.on("click", (e) => {
    if (app.mode && app.mode !== "explore") return;
    const hit = hitAt(e.point);
    if (!hit) return;
    cancelAnimationFrame(moveRaf);
    moveRaf = 0;
    popup.remove();
    hit.h.click(hit.f, e);
  });
  // Touch screens synthesise a mousemove before each tap; hover labels there would just linger.
  const touchOnly = matchMedia("(hover: none)").matches;
  m.on("mousemove", (e) => {
    if (touchOnly) return;
    lastMove = e;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      const ev = lastMove;
      const hit = hitAt(ev.point);
      if (hit) {
        m.getCanvas().style.cursor = "pointer";
        const label = hit.h.hover?.(hit.f);
        if (label) popup.setLngLat(hit.f.geometry.type === "Point" ? hit.f.geometry.coordinates : ev.lngLat).setText(label).addTo(m);
        else popup.remove();
        hovering = true;
      } else if (hovering) {
        m.getCanvas().style.cursor = "";
        popup.remove();
        hovering = false;
      }
    });
  });
  m.getCanvas().addEventListener("mouseleave", () => { if (hovering) { popup.remove(); m.getCanvas().style.cursor = ""; hovering = false; } });
  m.on("dragstart", () => { if (S.follow) stopFollow(true); });
  const box = m.getCanvasContainer();
  box.addEventListener("pointerdown", (e) => S.pointers.set(e.pointerId, [e.clientX, e.clientY]));
  window.addEventListener("pointermove", (e) => {
    const start = S.pointers.get(e.pointerId);
    if (start && S.follow && S.pointers.size === 1 && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) stopFollow(true);
  }, { passive: true });
  for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, (e) => S.pointers.delete(e.pointerId), { passive: true });
  app.on("ui:card", () => { if (cardKind && !$("#card-body [data-live-card]")) cleanupCard(); });
  app.on("layers:changed", ({ id }) => {
    const f = FEEDS.get(id);
    if (f) { f.dirty = true; syncRow(f); }
    document.body.dataset.liveOn = String([...FEEDS.keys()].some((k) => isOn(k)));
    renderSummary();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      for (const f of FEEDS.values()) { clearTimeout(f.state.timer); f.state.timer = 0; }
      clearInterval(S.timer);
      S.timer = 0;
    } else {
      for (const f of FEEDS.values()) if (isOn(f)) schedule(f);
      satTimer();
      if (S.sel && !S.raf) S.raf = requestAnimationFrame(satFrame);
    }
  });
  window.addEventListener("online", () => { for (const f of FEEDS.values()) if (f.state.failures && !f.state.slow) retryNow(f); });
  m.on("moveend", () => { for (const f of FEEDS.values()) if (f.state.away) checkAway(f); });
  m.on("zoomend", syncPulses);
  m.on("sourcedata", satLoadDone);
}

/* ================================================================ panel */
const GROUPS = [
  { id: "hazards", title: "Hazards" },
  { id: "weather", title: "Weather & sky" },
  { id: "orbit", title: "Orbit" },
  { id: "traffic", title: "Traffic & cameras" },
];
const SUMMARY_ORDER = ["earthquakes", "tropical-cyclones", "volcanoes-us", "natural-events", "alerts-us", "fires", "aurora", "satellites", "starlink", "ships-baltic", "aircraft", "cameras", "radar-us", "precipitation"];
let panel = null, panelTimer = 0;

// Imagery feeds (fires, radar, precipitation) have no counts, so they only speak when nothing else does.
const QUIET_SUMMARY = new Set(["fires", "radar-us", "precipitation"]);
/** html: escaped parts for the panel, with a feed's summaryHTML (e.g. a button) where it has one. */
function summaryParts(html = false) {
  const out = [], quiet = [];
  for (const id of SUMMARY_ORDER) {
    const f = FEEDS.get(id);
    if (!f || !isOn(f) || !f.state.fetchedAt || !f.summary) continue;
    const s = html && f.summaryHTML ? f.summaryHTML(f) : html ? [].concat(f.summary(f) ?? []).map(esc) : f.summary(f);
    if (s && s.length) (QUIET_SUMMARY.has(id) ? quiet : out).push(...[].concat(s));
  }
  return out.length ? out : quiet;
}
function renderSummary() {
  const el = panel?.querySelector("#lv-summary");
  if (!el) return;
  const parts = summaryParts(true);
  const anyOn = [...FEEDS.keys()].some((k) => isOn(k));
  const loading = [...FEEDS.values()].some((f) => isOn(f) && !f.state.fetchedAt && f.state.status !== "error");
  const text = parts.map((p, i) => (i ? p : cap(p))).join(" · ");
  // Re-rendered every 20 s: leave the markup (and a focused button) alone when nothing changed.
  if (el._text === text && text) return;
  el._text = text;
  const had = el.contains(document.activeElement) && document.activeElement.dataset.act;
  el.classList.toggle("is-idle", !parts.length);
  el.innerHTML = parts.length
    ? `<span class="live-dot" aria-hidden="true"></span><p>${text}</p>`
    : `<span class="lv-sum-ic" aria-hidden="true">${icon("live", 18)}</span><p>${!anyOn ? "Switch on a feed to see what is happening on Earth right now. Every item links to its source and shows when it was last updated." : loading ? "Connecting to live feeds…" : "The feeds you switched on have not answered yet; each retries on its own schedule."}</p>`;
  el.querySelector('[data-act="eq-largest"]')?.addEventListener("click", showLargestQuake);
  if (had) el.querySelector(`[data-act="${had}"]`)?.focus();
}
function statusHTML(f) {
  const s = f.state;
  if (!isOn(f)) return `<span>${esc(f.blurb())}</span>`;
  if (!s.fetchedAt) return s.status === "error" ? `<span class="lv-err">${esc(/^couldn't/i.test(s.error) ? cap(s.error) : `Couldn't load: ${s.error}`)}</span>` : `<span class="lv-spin" aria-hidden="true"></span><span>Loading…</span>`;
  if (s.status === "loading") return `<span class="lv-spin" aria-hidden="true"></span><span>Updating…</span>`;
  const fresh = s.status === "ok" && Date.now() - s.fetchedAt < (f.freshMs ?? f.refreshMs * 2.5) && !f.idle?.();
  const bits = [];
  const c = f.countText?.(f);
  if (c) bits.push(c);
  if (s.asOf && !/UTC/.test(c ?? "")) bits.push(`updated ${hhmm(s.asOf)}`);
  const tail = s.status === "stale" ? `<span class="lv-err"> · refresh failed, retrying</span>` : "";
  // Keep "02:07 UTC" on one line when the status wraps.
  return `${fresh ? `<span class="live-dot" aria-hidden="true"></span>` : ""}<span>${esc(bits.join(" · ")).replace(/ (UTC|\(UTC\))/g, " $1").replace(/updated /g, "updated ")}</span>${tail}`;
}
/** One inline action under a feed's row: retry a failed load, or show data that is all out of sight. */
function actHTML(f) {
  const s = f.state;
  if (!isOn(f) || s.status === "loading") return "";
  const line = (text, act, label) => `<div class="lv-inline"><span>${text}</span><button type="button" class="btn btn-ghost btn-sm" data-act="${act}" aria-label="${esc(`${label}: ${f.title}`)}">${label}</button></div>`;
  if (s.failures && !s.slow && (s.status === "error" || s.status === "stale")) return line("Retries automatically", "retry", "Retry now");
  if (s.away) return line("None in the current view", "show-all", "Show all");
  return "";
}
function rowHTML(f) {
  return `
    <div class="lv-feed" data-feed="${f.id}" data-on="false">
      <button type="button" class="lv-row" aria-pressed="false" aria-label="${esc(f.title)}" aria-describedby="lv-st-${f.id}">
        <span class="lv-ic">${icon(f.glyph)}</span>
        <span class="grow">
          <span class="t">${esc(f.title)}</span>
          <span class="lv-st" id="lv-st-${f.id}"></span>
          <span class="lv-src">${esc(f.sourceShort)} · ${esc(f.licenseShort)}</span>
        </span>
        <span class="switch" aria-hidden="true"></span>
      </button>
      <div class="lv-act" hidden></div>
      <div class="lv-opts" id="lv-opts-${f.id}" hidden></div>
    </div>`;
}
function syncRow(f, focusSel) {
  const row = panel?.querySelector(`.lv-feed[data-feed="${f.id}"]`);
  if (!row) return;
  const on = isOn(f);
  row.dataset.on = String(on);
  row.querySelector(".lv-row").setAttribute("aria-pressed", String(on));
  row.querySelector(".lv-st").innerHTML = statusHTML(f);
  const act = row.querySelector(".lv-act"), actHtml = actHTML(f);
  if (act._html !== actHtml) {
    const had = act.contains(document.activeElement);
    act._html = actHtml;
    act.innerHTML = actHtml;
    act.hidden = !actHtml;
    act.querySelector('[data-act="retry"]')?.addEventListener("click", () => retryNow(f));
    act.querySelector('[data-act="show-all"]')?.addEventListener("click", () => { f.state.away = false; frameAll(f.points()); syncRow(f); });
    // The action goes away once used; keep focus on the feed rather than dropping it to the page.
    if (had) row.querySelector(".lv-row").focus();
  }
  const opts = row.querySelector(".lv-opts");
  const show = (on || !!f.alwaysOpts?.()) && !!f.opts;
  if (show && (f.dirty || opts.hidden || !opts.childElementCount)) {
    const focused = focusSel ?? (opts.contains(document.activeElement) ? keyOf(document.activeElement) : null);
    opts.innerHTML = f.opts(f);
    f.bindOpts?.(opts, f);
    if (focused) (opts.querySelector(focused) ?? opts.querySelector("button"))?.focus();
  }
  f.dirty = false;
  opts.hidden = !show;
}
function keyOf(el) {
  for (const a of ["data-win", "data-cat", "data-fire", "data-v", "data-s", "data-sat", "data-go", "data-act"]) if (el.hasAttribute?.(a)) return `[${a}="${el.getAttribute(a)}"]`;
  return null;
}
function relayRow() {
  if (relayBase()) return "";
  return `
    <div class="lv-feed lv-feed-muted" aria-disabled="true">
      <div class="lv-row" role="note">
        <span class="lv-ic">${icon("plane")}</span>
        <span class="grow"><span class="t">Live aircraft</span><span class="lv-st">Needs the Baryon relay (not deployed yet)</span>
        <span class="lv-src">No open ADS-B feed allows browser access</span></span>
      </div>
    </div>`;
}
function renderPanel(node) {
  defineAircraft();
  panel = node;
  node.innerHTML = `
    <div class="lv-summary" id="lv-summary"></div>
    ${GROUPS.map((g) => `
      <span class="eyebrow">${esc(g.title)}</span>
      <div class="lv-group">${[...FEEDS.values()].filter((f) => f.group === g.id).map(rowHTML).join("")}${g.id === "traffic" ? relayRow() : ""}</div>`).join("")}
    <span class="eyebrow">Upcoming launches</span>
    <div class="lv-launches" id="lv-launches" aria-busy="true"><div class="lv-skel"></div><div class="lv-skel"></div><div class="lv-skel"></div></div>
    <p class="note">Feeds refresh on each provider's schedule (earthquakes and ships every minute, radar every 5 minutes, aurora every 10) and pause while a feed is off or this tab is hidden. Nothing is simulated: satellite positions are computed from published orbital elements, everything else is shown as the provider reports it.</p>`;
  node.querySelectorAll(".lv-feed[data-feed] .lv-row").forEach((b) => (b.onclick = () => {
    const id = b.closest(".lv-feed").dataset.feed;
    app.layers.toggle(id).catch(() => {});
  }));
  for (const f of FEEDS.values()) { f.dirty = true; syncRow(f); }
  renderSummary();
  renderLaunches();
}
async function renderLaunches() {
  const box = panel?.querySelector("#lv-launches");
  if (!box) return;
  try {
    const L = await getLaunches();
    const el = panel?.querySelector("#lv-launches");
    if (!el) return;
    const rows = (L.data ?? []).filter((l) => !l.net || Date.parse(l.net) > Date.now() - 3 * HOUR).slice(0, 4);
    el.removeAttribute("aria-busy");
    el.innerHTML = rows.length ? rows.map((l, i) => {
      const t = Date.parse(l.net), ok = Number.isFinite(t), k = launchPrecision(l);
      const when = !ok ? "Date TBD" : k === "time" ? `${hhmm(t)} · ${until(t)}` : k === "day" ? "Time TBC" : `NET ${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;
      return `
        <button type="button" class="row-btn lv-launch" data-l="${i}">
          <span class="lv-date"><b>${ok && k !== "coarse" ? new Date(t).getUTCDate() : "—"}</b><span>${ok ? MONTHS[new Date(t).getUTCMonth()] : "TBD"}</span></span>
          <span class="grow"><span class="t">${esc(l.mission ?? l.name)}</span>
          <span class="s">${esc([l.rocket, when].filter(Boolean).join(" · "))}</span>
          <span class="s">${esc([l.status === "Go" ? "Go for launch" : l.status_name, l.location].filter(Boolean).join(" · "))}</span></span>
        </button>`;
    }).join("") + `<div class="lv-src lv-src-foot">The Space Devs · Launch Library 2 · as of ${esc(hhmm(L.at))}</div>` : `<p class="lv-note">No upcoming launches listed.</p>`;
    el.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => launchCard(rows[Number(b.dataset.l)])));
  } catch (err) {
    const el = panel?.querySelector("#lv-launches");
    if (el) { el.removeAttribute("aria-busy"); el.innerHTML = `<p class="lv-note">Launch schedule unavailable: ${esc(err.message)}.</p>`; }
  }
}

/* ================================================================ agent tools */
const FEED_IDS = () => [...FEEDS.keys()];
const FEED_REGION = {
  "radar-us": () => [[-97, 38.5], 3.4], "alerts-us": () => [[-97, 38.5], 3.2], "ships-baltic": () => [[21.5, 59.6], 5.2],
  aurora: () => (app.map.getCenter().lat < -10 ? [[140, -72], 2.2] : [[-100, 72], 2.2]),
};
function feedStatus(f) {
  return { feed: f.id, title: f.title, on: isOn(f), status: isOn(f) ? f.state.status : "off", count: f.state.count, updated_utc: f.state.asOf ? new Date(f.state.asOf).toISOString() : null,
    detail: isOn(f) && f.state.fetchedAt ? f.countText?.(f) ?? null : null, error: f.state.error, source: f.source, license: f.license };
}
const ISS_WORDS = "iss|international space station|space station|tiangong|chinese space station|css|hubble(?: space telescope)?|hst";
const SAT_FAMILIES = "(?:starlink|oneweb|iridium|noaa|goes|gps|navstar|galileo|glonass|beidou|landsat|sentinel|metop|meteosat|himawari|fengyun|jpss|suomi npp|terra|aqua|aura|tdrs|cosmos|kosmos)";
function aliasNorad(text) { for (const [re, id] of SAT_ALIASES) if (re.test(String(text).trim())) return id; return null; }
async function fetchSatBy(norad, name) {
  S.libMod = await satLib();
  const key = norad ? `gp:catnr:${norad}` : `gp:name:${String(name).toLowerCase()}`;
  const r = await loadGP(key, norad ? `CATNR=${norad}` : `NAME=${encodeURIComponent(name)}`);
  const sats = buildSats(r.rows, "search");
  if (!sats.length) return null;
  const want = name ? String(name).toLowerCase() : null;
  const s = (want && sats.find((x) => x.name.toLowerCase() === want)) ?? sats[0];
  if (!S.extra.some((x) => x.norad === s.norad)) S.extra.push(s);
  rebuildSats();
  return s;
}
function satReport(s) {
  const p = s.pos ?? satPos(s, new Date());
  return {
    ok: true, name: s.name, norad_id: s.norad, cospar_id: s.cospar ?? null, orbit_class: s.klass,
    lat: p ? +p.lat.toFixed(4) : null, lng: p ? +p.lng.toFixed(4) : null, altitude_km: p ? +p.alt.toFixed(1) : null, speed_km_s: p?.speed ? +p.speed.toFixed(3) : null,
    inclination_deg: +s.inc.toFixed(2), period_min: +s.period.toFixed(2), perigee_km: Math.round(s.perigee), apogee_km: Math.round(s.apogee),
    elements_epoch_utc: new Date(s.epoch).toISOString(), elements_age_h: +((Date.now() - s.epoch) / HOUR).toFixed(1),
    following: S.follow, source: "CelesTrak GP elements, propagated with SGP4 (satellite.js)",
  };
}

function defineTools() {
  app.tools.define("get_earthquakes", {
    description: "Search the USGS earthquake catalogue (ComCat, FDSN event API): earthquakes above a magnitude over the past N days, optionally near a point (radius_km) or inside a bounding box. Returns the total count, the events (magnitude, place, UTC time, depth, felt reports, tsunami flag, PAGER alert, USGS link) and the exact query URL; also marks them on the globe.",
    input_schema: {
      type: "object",
      properties: {
        min_magnitude: { type: "number", description: "Default 2.5" },
        days: { type: "number", description: "Look back this many days (default 7, max 3650)" },
        near: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, radius_km: { type: "number" } }, required: ["lat", "lng"] },
        bbox: { type: "object", description: "Bounding box in degrees", properties: { west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" } } },
        limit: { type: "number", description: "Max events returned (default 50, max 500)" },
        order_by: { type: "string", enum: ["time", "magnitude"] },
        show_on_map: { type: "boolean", description: "Default true" },
      },
    },
    async run({ min_magnitude = 2.5, days = 7, near, bbox, limit = 50, order_by = "time", show_on_map = true } = {}) {
      const d = clamp(Number(days) || 7, 1 / 24, 3650);
      const mag = Number.isFinite(Number(min_magnitude)) && min_magnitude !== null && min_magnitude !== "" ? clamp(Number(min_magnitude), -1, 10) : 2.5;
      const params = new URLSearchParams({ format: "geojson", starttime: new Date(Date.now() - d * DAY).toISOString().slice(0, 19), minmagnitude: String(mag), orderby: order_by === "magnitude" ? "magnitude" : "time" });
      if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
        params.set("latitude", String(near.lat));
        params.set("longitude", String(near.lng));
        params.set("maxradiuskm", String(clamp(Number(near.radius_km) || 250, 1, 20001)));
      }
      if (bbox) {
        const [w, s, e, n] = Array.isArray(bbox) ? bbox : [bbox.west, bbox.south, bbox.east, bbox.north];
        // A box across the antimeridian (west > east) is sent as east + 360; the FDSN service takes -360..360.
        if ([w, s, e, n].every(Number.isFinite)) { params.set("minlongitude", w); params.set("minlatitude", Math.min(s, n)); params.set("maxlongitude", e < w ? e + 360 : e); params.set("maxlatitude", Math.max(s, n)); }
      }
      const lim = clamp(Math.round(Number(limit) || 50), 1, 500);
      const queryUrl = `${SRC.fdsn}query?${params}&limit=${lim}`;
      const [data, cnt] = await Promise.all([fetchJSON(queryUrl, { timeout: 30000 }), fetchJSON(`${SRC.fdsn}count?${params}`, { timeout: 20000 }).catch(() => null)]);
      const feats = (data.features ?? []).filter((x) => x.geometry?.coordinates && x.properties?.mag != null);
      const events = feats.map((x) => ({
        id: x.id, magnitude: x.properties.mag, magnitude_type: x.properties.magType, place: x.properties.place, time_utc: new Date(x.properties.time).toISOString(),
        depth_km: x.geometry.coordinates[2] ?? null, lat: x.geometry.coordinates[1], lng: x.geometry.coordinates[0], felt_reports: x.properties.felt ?? 0,
        tsunami_flag: !!x.properties.tsunami, pager_alert: x.properties.alert ?? null, status: x.properties.status, url: x.properties.url,
      }));
      if (show_on_map !== false) {
        if (feats.length) {
          showQuakeResults(feats.map((x) => quakeFeature(x)));
          frame(events.map((e) => [e.lng, e.lat]), 7);
        } else if (EQ.results) clearQuakeResults();
      }
      const total = cnt?.count ?? events.length;
      let top = events.reduce((m, e) => (!m || e.magnitude > m.magnitude ? e : m), null);
      // When only part of the list came back, ask the catalogue for the true largest event.
      if (total > events.length && order_by !== "magnitude") {
        const p2 = new URLSearchParams(params);
        p2.set("orderby", "magnitude");
        const big = await fetchJSON(`${SRC.fdsn}query?${p2}&limit=1`, { timeout: 20000 }).catch(() => null);
        const x = big?.features?.[0];
        if (x?.properties?.mag != null && x.properties.mag >= (top?.magnitude ?? -Infinity)) top = { magnitude: x.properties.mag, place: x.properties.place, time_utc: new Date(x.properties.time).toISOString() };
        else if (!x) top = null;
      }
      const where = near ? ` within ${fmt(Number(params.get("maxradiuskm")))} km of ${(+near.lat).toFixed(2)}, ${(+near.lng).toFixed(2)}` : bbox ? " in that box" : " worldwide";
      const period = `in the past ${d < 1 ? `${fmt(d * 24, 1)} hour${d * 24 === 1 ? "" : "s"}` : `${fmt(d, 1)} day${d === 1 ? "" : "s"}`}`;
      return {
        ok: true, count: total, returned: events.length, query_url: queryUrl, earthquakes: events, largest: top,
        summary: total
          ? `**${fmt(total)}** earthquake${total === 1 ? "" : "s"} M${mag}+${where} ${period}${total > events.length ? ` (showing ${fmt(events.length)})` : ""}.${top ? ` Largest: **M${top.magnitude.toFixed(1)}** ${top.place ?? ""} on ${stamp(top.time_utc)}.` : ""} Source: USGS ComCat (public domain).`
          : `No earthquakes M${mag}+${where} ${period} in the USGS catalogue.`,
      };
    },
  });

  app.tools.define("get_natural_events", {
    description: `Open natural events from NASA EONET (wildfires, severe storms and tropical cyclones, volcanoes, sea and lake ice, floods, dust and haze, drought, landslides, snow, temperature extremes, water colour, man-made). Optional category and days (events with a report in the last N days, default 30). Returns each event with its latest position, date, magnitude and source links, and shows them on the globe.`,
    input_schema: { type: "object", properties: { category: { type: "string", description: `One of ${CHIP_CATS.join(", ")}, or a plain word like fires, storms, volcanoes` }, days: { type: "number", description: "Events with a report in the last N days (default 30; for volcanoes the default is every open eruption, since EONET reports them rarely)" }, show_on_map: { type: "boolean" } } },
    async run({ category, days, show_on_map = true } = {}) {
      const cat = category ? evCat(category) : null;
      if (category && !cat) return { ok: false, error: `Unknown category "${category}". Options: ${CHIP_CATS.join(", ")}.` };
      // Volcano events stay open for months between reports, so the map lists every open one; do the same here.
      const d = days == null && cat === "volcanoes" ? null : clamp(Math.round(Number(days) || 30), 1, 3650);
      const url = `${SRC.eonet}?status=open${d ? `&days=${d}` : ""}&limit=300${cat ? `&category=${cat}` : ""}`;
      const events = await eonetEvents(url.split("?")[1]);
      events.sort((a, b) => b.last - a.last);
      if (show_on_map !== false) {
        if (cat) { EV.off = new Set(Object.keys(EV_CATS).filter((k) => k !== cat)); applyEvFilter(false); }
        if (!isOn("natural-events")) await app.layers.toggle("natural-events", true).catch(() => {});
        FEEDS.get("natural-events").dirty = true;
        syncRow(FEEDS.get("natural-events"));
      }
      const label = cat ? EV_CATS[cat].label.toLowerCase() : "natural events";
      return {
        ok: true, count: events.length, category: cat, query_url: url,
        events: events.slice(0, 100).map((e) => ({ id: e.id, title: e.title, category: e.cat, latest_utc: new Date(e.last).toISOString(), first_utc: new Date(e.first).toISOString(),
          lat: +e.pos[1].toFixed(4), lng: +e.pos[0].toFixed(4), magnitude: e.mag ?? null, magnitude_unit: e.unit ?? null, sources: e.sources.map((s) => s.url).filter(Boolean) })),
        summary: events.length ? `**${fmt(events.length)}** open ${label}${d ? ` with a report in the past ${d} day${d === 1 ? "" : "s"}` : ""}${events[0] ? `; most recent report: **${events[0].title}** (${ago(events[0].last)})` : ""}. Source: NASA EONET.` : `No open ${label}${d ? ` with a report in the past ${d} day${d === 1 ? "" : "s"}` : ""} (NASA EONET).`,
      };
    },
  });

  app.tools.define("track_satellite", {
    description: "Find a satellite by name (ISS, Tiangong, Hubble, NOAA 20, a Starlink number…) or NORAD catalog number, fly to it, show its ground track and (by default) follow it. Returns its current position, altitude, speed, inclination, period and element epoch.",
    input_schema: { type: "object", properties: { name: { type: "string" }, norad_id: { type: "number" }, follow: { type: "boolean", description: "Keep the camera on it (default true)" } } },
    async run({ name, norad_id, follow = true } = {}) {
      let norad = Number(norad_id) || (name ? aliasNorad(name) : null);
      if (!norad && !name) return { ok: false, error: "Give a satellite name (e.g. ISS, Hubble, NOAA 20) or a NORAD catalog number." };
      if (!isOn("satellites")) await app.layers.toggle("satellites", true).catch(() => {});
      await settled(FEEDS.get("satellites"), 30000);
      S.libMod ??= await satLib();
      let s = norad ? S.core.find((x) => x.norad === norad) ?? S.starlink.find((x) => x.norad === norad) ?? S.extra.find((x) => x.norad === norad) : findSat(name);
      if (!s) {
        try { s = await fetchSatBy(norad, norad ? null : name); } catch (err) {
          return { ok: false, error: /no match/.test(err.message) ? `No satellite matching ${norad ? `NORAD ${norad}` : `"${name}"`} in CelesTrak's catalogue.` : `Could not look up ${norad ? `NORAD ${norad}` : `"${name}"`} on CelesTrak: ${err.message}.` };
        }
      }
      if (!s) return { ok: false, error: `No satellite matching ${norad ? `NORAD ${norad}` : `"${name}"`} in CelesTrak's catalogue.` };
      s.pos = satPos(s, new Date());
      selectSat(s);
      flyToSat(s);
      if (follow) startFollow();
      const r = satReport(s);
      r.following = !!follow;
      r.summary = `**${s.name}** (NORAD ${s.norad}) is over ${r.lat?.toFixed(2)}, ${r.lng?.toFixed(2)} at **${fmt(r.altitude_km)} km**, moving ${fmt(r.speed_km_s, 2)} km/s${follow ? "; the camera is following it (drag the map to stop)" : ""}. Elements from CelesTrak, epoch ${ago(s.epoch)}.`;
      return r;
    },
    local: {
      patterns: [
        new RegExp(`^(?:where(?: is|'s)|find|locate|show(?: me)?)\\s+(?:the\\s+)?(${ISS_WORDS})(?:\\s+(?:now|right now))?$`, "i"),
        new RegExp(`^(?:follow|track|chase)\\s+(?:the\\s+)?(${ISS_WORDS})$`, "i"),
        // Anything else needs the word "satellite", a NORAD number or a well-known satellite family,
        // so "track the hurricane" or "follow the coast" are left to other commands.
        /^(?:follow|track|find|where(?: is|'s))\s+(?:the\s+)?(?:satellite\s+(.+)|norad\s*(?:id\s*)?#?\s*(\d{1,6}))$/i,
        new RegExp(`^(?:follow|track|find|where(?: is|'s))\\s+(?:the\\s+)?(${SAT_FAMILIES}[\\s-]*[a-z0-9-]*)$`, "i"),
      ],
      parse: (m, text) => {
        const follow = /^(?:follow|track|chase)/i.test(text);
        const q = (m[1] ?? m[2] ?? "").trim();
        const id = aliasNorad(q);
        return id ? { norad_id: id, follow } : /^\d{1,6}$/.test(q) ? { norad_id: Number(q), follow } : { name: q, follow };
      },
      examples: ["where is the ISS", "follow the ISS"],
    },
  });

  app.tools.define("get_weather_alerts", {
    description: "Active US National Weather Service alerts (warnings, watches, advisories) for a point: event, severity, headline, onset, expiry and link. The NWS covers the United States and its territories only.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"] },
    async run({ lat, lng } = {}) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "Need lat and lng." };
      const US = [[-125, 24.3, -66.9, 49.5], [-180, 51, -129.9, 71.6], [172, 51, 180, 53.1], [-160.6, 18.7, -154.6, 22.5], [-67.4, 17.6, -64.4, 18.6], [144.5, 13.2, 146.2, 20.6], [-171.2, -14.6, -168.1, -10.9]];
      const note = "The US National Weather Service issues alerts only for the United States and its territories.";
      if (!US.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n)) return { ok: true, count: 0, alerts: [], note, summary: `No NWS alerts: ${note} This point (${lat.toFixed(2)}, ${lng.toFixed(2)}) is outside that coverage.` };
      let d;
      try { d = await fetchJSON(`${SRC.nws}?point=${lat.toFixed(4)},${lng.toFixed(4)}`, { headers: { Accept: "application/geo+json" }, timeout: 20000 }); }
      catch (err) { if (/answered (400|404)/.test(err.message)) return { ok: true, count: 0, alerts: [], note, summary: `No NWS alerts: ${note}` }; throw err; }
      const alerts = (d.features ?? []).map((a) => a.properties).map((p) => ({ event: p.event, severity: p.severity, certainty: p.certainty, urgency: p.urgency, headline: p.headline, area: p.areaDesc, onset: p.onset, expires: p.expires, sender: p.senderName, url: p["@id"] }));
      return {
        ok: true, count: alerts.length, alerts, source: "NOAA National Weather Service (public domain)",
        summary: alerts.length ? `**${alerts.length}** active NWS alert${alerts.length === 1 ? "" : "s"} here:\n${alerts.slice(0, 6).map((a) => `- **${a.event}** (${a.severity}) until ${a.expires ? stamp(a.expires) : "further notice"}`).join("\n")}` : "No active NWS alerts at this point right now.",
      };
    },
    local: {
      // Plain "weather alerts" switches the US alerts layer on (show_live_feed); this one asks about a point.
      patterns: [/^(?:are there\s+)?(?:any\s+)?(?:weather\s+)?(?:alerts|warnings)\s+(?:here|for here|at this (?:spot|place|point))$/i],
      parse: () => { const c = app.map.getCenter(); return { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4) }; },
    },
  });

  app.tools.define("get_upcoming_launches", {
    description: "Upcoming orbital rocket launches worldwide from The Space Devs' Launch Library 2: mission, rocket, provider, NET time (no earlier than), status, pad and location. Cached for 10 minutes.",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Default 5, max 12" } } },
    async run({ limit = 5 } = {}) {
      const L = await getLaunches();
      const n = clamp(Math.round(Number(limit) || 5), 1, 12);
      const rows = (L.data ?? []).slice(0, n);
      return {
        ok: true, as_of_utc: new Date(L.at).toISOString(), launches: rows, source: "The Space Devs, Launch Library 2",
        summary: rows.length ? `Next ${rows.length} launch${rows.length === 1 ? "" : "es"}:\n${rows.map((l) => `- **${l.mission ?? l.name}** · ${l.rocket ?? ""} · ${netLabel(l)} · ${l.location ?? l.pad ?? ""}${l.status ? ` · ${l.status}` : ""}`).join("\n")}\n\nTimes are "no earlier than" and often slip. Source: Launch Library 2.` : "No upcoming launches listed.",
      };
    },
    local: {
      patterns: [/^(?:(?:show|list|when is|when's)\s+)?(?:the\s+)?(?:next|upcoming)\s+(?:rocket\s+)?launch(?:es)?$/i],
      parse: () => ({ limit: 5 }),
      examples: ["next launches"],
    },
  });

  app.tools.define("show_live_feed", {
    description: `Switch a real-time Live Earth feed on or off. Feeds: ${FEED_IDS().map((id) => `"${id}" (${FEEDS.get(id).title})`).join(", ")}. For earthquakes, window can be hour, day, week or month; for natural-events, category filters to one kind. Returns the feed's count and update time once loaded.`,
    input_schema: {
      type: "object",
      properties: {
        feed: { type: "string", enum: FEED_IDS() },
        on: { type: "boolean", description: "Default true" },
        window: { type: "string", enum: Object.keys(EQ_WINDOWS) },
        category: { type: "string", enum: CHIP_CATS },
        fly: { type: "boolean", description: "Frame the region the feed covers (default true for regional feeds)" },
      },
      required: ["feed"],
    },
    async run({ feed, on = true, window, category, fly = true } = {}) {
      defineAircraft();
      const f = FEEDS.get(feed);
      if (!f) return { ok: false, error: `Unknown feed "${feed}". Options: ${FEED_IDS().join(", ")}${relayBase() ? "" : " (live aircraft need the Baryon relay, which is not deployed yet)"}.` };
      if (window && EQ_WINDOWS[window] && feed === "earthquakes" && window !== EQ.win) {
        EQ.win = window;
        store.set("eqWindow", window);
        f.dirty = true;
        if (isOn(f)) { f.state.status = "loading"; syncRow(f); await refreshFeed(f).then(() => schedule(f)); }
      }
      if (category && feed === "natural-events" && EV_CATS[category]) { EV.off = new Set(Object.keys(EV_CATS).filter((k) => k !== category)); applyEvFilter(false); f.dirty = true; }
      await app.layers.toggle(feed, on !== false).catch(() => {});
      if (on !== false) {
        if (fly && FEED_REGION[feed]) { const [c, z] = FEED_REGION[feed](); flyIfAway(c, z); }
        await settled(f);
      }
      const st = feedStatus(f);
      const summ = f.summary && isOn(f) && f.state.fetchedAt ? [].concat(f.summary(f) ?? []).join("; ") : null;
      return { ok: true, ...st, summary: !isOn(f) ? `**${f.title}** off.` : f.state.status === "error" ? `**${f.title}** is on, but the source did not answer: ${f.state.error}.` : `**${f.title}** on${summ ? `: ${summ}` : st.detail ? `: ${st.detail}` : ""}${f.state.asOf ? `, updated ${hhmm(f.state.asOf)}` : ""}. Source: ${f.sourceShort} (${f.licenseShort}).` };
    },
    local: {
      patterns: [
        /^(?:show(?: me)?|display|turn on|switch on|live)?\s*(?:the\s+)?(?:live\s+|latest\s+|recent\s+)?(earthquakes?|quakes?)(?:\s+(today|now|this week|this month|in the (?:past|last) (?:hour|day|24 hours|week|month)|(?:past|last) (?:hour|day|24 hours|week|month)))?$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:live\s+)?(satellites?|starlink(?: constellation)?)$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:active\s+|live\s+)?((?:wild)?fires?)$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:live\s+|us\s+|weather\s+)*(radar)$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(aurora(?: forecast)?|northern lights|southern lights)$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:live\s+|public\s+|traffic\s+|road\s+)?(cameras?|webcams?|cctv|jam ?cams?)$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:live\s+)?(ships?|vessels?|ais|boats?)(?:\s+in the baltic)?$/i,
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?(?:active\s+|live\s+)?(natural events|eonet|hurricanes?|cyclones?|tropical storms?|typhoons?|weather alerts|storm warnings|precipitation|rainfall|rain)$/i,
        // Plain "volcanoes" is left to the volcano catalogue; these ask for what is erupting or on alert now.
        /^(?:show(?: me)?|display|turn on|switch on)?\s*(?:the\s+)?((?:active|erupting|live)\s+volcano(?:es)?|volcano(?:es)? erupting(?: now)?|(?:us\s+)?volcano alerts|us volcanoes)$/i,
      ],
      parse: (m, text) => {
        const w = m[1].toLowerCase();
        if (/quake/.test(w)) {
          const t = (m[2] ?? "").toLowerCase();
          return { feed: "earthquakes", ...(t ? { window: /hour|now/.test(t) ? "hour" : /week/.test(t) ? "week" : /month/.test(t) ? "month" : "day" } : {}) };
        }
        if (/starlink/.test(w)) return { feed: "starlink" };
        if (/satellite/.test(w)) return { feed: "satellites" };
        if (/fire/.test(w)) return { feed: "fires" };
        if (/radar/.test(w)) return { feed: "radar-us" };
        if (/aurora|lights/.test(w)) return { feed: "aurora" };
        if (/cam|cctv/.test(w)) return { feed: "cameras" };
        if (/ship|vessel|ais|boat/.test(w)) return { feed: "ships-baltic" };
        if (/hurricane|cyclone|tropical|typhoon/.test(w)) return { feed: "tropical-cyclones" };
        if (/us volcano|volcano alerts/.test(w)) return { feed: "volcanoes-us" };
        if (/volcano/.test(w)) return { feed: "natural-events", category: "volcanoes" };
        if (/alert|warning/.test(w)) return { feed: "alerts-us" };
        if (/precip|rain/.test(w)) return { feed: "precipitation" };
        return /natural|eonet/.test(text) ? { feed: "natural-events" } : null;
      },
      examples: ["earthquakes today", "show satellites", "fires", "radar", "aurora", "cameras"],
    },
  });

  app.tools.define("get_live_summary", {
    description: "What is happening on Earth right now according to the Live Earth feeds that are switched on: a one-line summary plus each feed's status, count, update time, source and licence.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const parts = summaryParts();
      return { ok: true, summary: parts.length ? `${cap(parts.join(" · "))}.` : "No live feeds are on yet. Try “earthquakes today”, “show satellites” or “radar”.", feeds: [...FEEDS.values()].map(feedStatus) };
    },
    local: { patterns: [/^(?:what'?s happening(?:\s+(?:now|right now|on earth|in the world))?|live earth|live (?:summary|feeds?|status)|what'?s live)$/i], parse: () => ({}), examples: ["what's happening now"] },
  });
}

/* ================================================================ init */
export function init() {
  defineAircraft();
  bindMap();
  defineTools();
  app.ui.definePanel("live", {
    title: "Live Earth",
    order: 20,
    icon: icon("live"),
    render: renderPanel,
    onOpen: () => {
      clearInterval(panelTimer);
      panelTimer = setInterval(() => { for (const f of FEEDS.values()) if (isOn(f)) syncRow(f); renderSummary(); }, 20000);
    },
    onClose: () => { clearInterval(panelTimer); panelTimer = 0; panel = null; },
  });
  app.live = {
    feeds: FEEDS,
    summary: summaryParts,
    refresh: (id) => (FEEDS.has(id) ? refreshFeed(FEEDS.get(id)) : null),
    trackSatellite: (input) => app.tools.run("track_satellite", input),
    enableRelay: defineAircraft,
    satEngine: () => (SW.w ? "worker" : "main thread"),
  };
}
