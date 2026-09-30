// Street level: Panoramax, the open federated street-level imagery commons, on the
// globe. A coverage layer (coverage dots when zoomed out, blue sequences and picture
// dots up close), a Street view button that picks a spot, and a full-bleed viewer:
// 360° panoramas through Photo Sphere Viewer (MIT, loaded on first use), flat photos
// with pan and zoom, stepping along each sequence, other capture dates of the same
// spot, and the camera's view cone on a mini-map. Every picture shows its capture
// date, author, licence and a link back to Panoramax.
import { app, $, esc, fmt, clamp, getJSON, haversineKm, syncHash } from "./core.js";

const API = "https://api.panoramax.xyz/api";
// Coverage tiles go through the "svmvt" protocol below (one retry, long lines thinned).
const TILES_V1 = "svmvt://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt";
const TILES_V2 = "svmvt://api.panoramax.xyz/api/map/2/{z}/{x}/{y}.mvt";
const OVERVIEW_URL = "/world/data/streetview-coverage.json";
const PSV_CORE = "https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/core@5.15.1/+esm";
const PSV_TILES = "https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/equirectangular-tiles-adapter@5.15.1/+esm";
const THREE = "https://cdn.jsdelivr.net/npm/three@0.185.1/+esm"; // the build PSV core 5.15.1 is bundled against
const OFM = "https://tiles.openfreemap.org/planet";
const PHOTON = "https://photon.komoot.io"; // /reverse for street names, /api/ for place names

const C360 = "#1a73e8";
const CFLAT = "#58a6ff";
const BY_TYPE = ["match", ["get", "type"], "equirectangular", C360, CFLAT];
const SORT_360 = ["match", ["get", "type"], "equirectangular", 1, 0]; // panoramas draw over photos
const rad = Math.PI / 180;
const EMPTY = { type: "FeatureCollection", features: [] };
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tile budget. Panoramax's v1 grid tiles below z5 weigh 1-2 MB each, so the globe draws a
// pre-aggregated overview and the z5 grid is overzoomed to z10. Sequences then use tiles at
// their natural zoom (an overzoomed tile over Paris holds up to a million line vertices,
// most of them off screen), and the far lighter v2 tiles take over from z15. The v1 line
// tiles carry every GPS fix (a z10 tile over Paris: 740k points, single lines of 13k), so
// they are thinned to half a pixel and cut into short parts before MapLibre sees them.
const Z_GRID = 5, Z_LINES = 9.8, Z_V2 = 15, PIC_MIN_Z = 17.4;
const LINE_BANDS = [
  { key: "lo", tiles: TILES_V1, tileZoom: [10, 14], show: [Z_LINES, Z_V2] },
  { key: "hi", tiles: TILES_V2, tileZoom: [15, 17], show: [Z_V2, null] },
];

const ID = {
  overview: "cat-i-sv-overview",
  grid: "cat-i-sv-grid",
  pic: "cat-i-sv-pic",
  cone: "cat-i-sv-cone", me: "cat-i-sv-me",
};
const HIT_LAYERS = [ID.pic, ...LINE_BANDS.map((b) => `cat-i-sv-hit-${b.key}`)];
const COVERAGE_LAYERS = [ID.overview, ID.grid, ID.pic, ...LINE_BANDS.flatMap((b) => ["seq-casing", "seq", "hit"].map((k) => `cat-i-sv-${k}-${b.key}`))];
const CONE_LAYERS = [ID.cone, ID.me];
const SOURCES = ["sv-overview", "sv-grid", ...LINE_BANDS.map((b) => `sv-${b.key}`), "sv-cone"];

const LICENCES = {
  "etalab-2.0": ["Etalab Open Licence 2.0", "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"],
  "CC-BY-SA-4.0": ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
  "CC-BY-4.0": ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  "CC0-1.0": ["CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
};

const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  person: svg('<circle cx="12" cy="4.9" r="2.3"/><path d="M8.7 21v-5.3l-1.2-1v-4.3a2.7 2.7 0 0 1 2.7-2.7h3.6a2.7 2.7 0 0 1 2.7 2.7v4.3l-1.2 1V21"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 18),
  prev: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  next: svg('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>', 18),
  minus: svg('<path d="M5.5 12h13"/>', 18),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>', 15),
  collapse: svg('<path d="M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6"/>', 15),
  chevron: svg('<path d="M6.5 9.5 12 15l5.5-5.5"/>', 18),
  external: svg('<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>', 15),
};
const COMPASS = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.3" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="1.4"/><g class="sv-needle"><path d="M13 3.6l3.2 9.4H9.8z" fill="currentColor"/><path d="M13 22.4 9.8 13h6.4z" fill="currentColor" fill-opacity=".25"/></g></svg>';

const S = {
  open: false, pic: null, token: 0, busy: false, session: 0, stepTo: null,
  root: null, stage: null, psv: null, flat: null, mini: null, lastFocus: null,
  pick: false, pickLayerAuto: false, coverageAuto: false, afterView: false, afterAt: null, btn: null, hint: null, hintTimer: null,
  place: null, placeAt: null, datesKey: null, datesAt: null, raf: 0, popup: null, hovering: false, cone: null, coneEl: null,
};

/* ---------------------------------------------------------------- geometry */
const norm360 = (d) => ((d % 360) + 360) % 360;
const compass8 = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(norm360(d) / 45) % 8];
const metersPerPixel = (lat, zoom) => (40075016.686 * Math.cos(lat * rad)) / (512 * 2 ** zoom);
const distM = (a, b) => haversineKm(a, b) * 1000;
function bearingTo(a, b) {
  const f1 = a[1] * rad, f2 = b[1] * rad, dl = (b[0] - a[0]) * rad;
  return norm360(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) / rad);
}
/* ---------------------------------------------------------------- dates, licences, people */
function parseStamp(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, off] = m;
  return { wall: new Date(Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0))), hasTime: h != null, off };
}
const fmtUTC = (d, opts) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d);
function tzLabel(off) {
  if (!off) return "";
  if (off === "Z" || /^[+-]00:?00$/.test(off) || off === "+00" || off === "-00") return "UTC";
  const m = off.match(/^([+-])(\d{2}):?(\d{2})?$/);
  return m ? `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] && m[3] !== "00" ? `:${m[3]}` : ""}` : "";
}
/** Capture time as the camera's local wall clock (Panoramax keeps the offset in datetimetz). */
function captured(pic) {
  const p = parseStamp(pic.datetz ?? pic.date);
  if (!p) return null;
  return {
    long: fmtUTC(p.wall, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: p.hasTime ? `${fmtUTC(p.wall, { hour: "numeric", minute: "2-digit" })}${tzLabel(p.off) ? ` ${tzLabel(p.off)}` : ""}` : "",
    medium: fmtUTC(p.wall, { day: "numeric", month: "short", year: "numeric" }),
    short: fmtUTC(p.wall, { month: "short", year: "numeric" }),
  };
}
const dayLabel = (s) => { const p = parseStamp(s); return p ? fmtUTC(p.wall, { day: "numeric", month: "short", year: "numeric" }) : ""; };
function licence(pic) {
  const known = LICENCES[pic.license];
  return { label: known?.[0] ?? pic.license ?? "Licence not stated", url: pic.licenseUrl ?? known?.[1] ?? null };
}
const pageUrl = (pic) => `https://api.panoramax.xyz/#focus=pic&pic=${encodeURIComponent(pic.id)}`;
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return url ?? ""; } };

/* ---------------------------------------------------------------- Panoramax API */
function toPic(f) {
  const p = f.properties ?? {};
  const io = p["pers:interior_orientation"] ?? {};
  const link = (rel) => f.links?.find((l) => l.rel === rel);
  const via = link("via");
  const fov = Number.isFinite(io.field_of_view) ? io.field_of_view : null;
  const make = io.camera_manufacturer ?? "", model = io.camera_model ?? "";
  const tm = p["tiles:tile_matrix_sets"]?.geovisio?.tileMatrix?.[0];
  const tpl = f.asset_templates?.tiles?.href;
  const pow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  const tilesOk = tm && pow2(tm.matrixWidth) && pow2(tm.matrixHeight) && tm.matrixWidth <= 64 && tm.matrixHeight <= 32;
  const [lng, lat] = f.geometry.coordinates;
  const ref = (l) => (l?.id ? { id: l.id, coords: l.geometry?.coordinates ?? null } : null);
  const exif = p.exif ?? {};
  const pitch = Number(p["pers:pitch"] ?? 0), roll = Number(p["pers:roll"] ?? 0);
  return {
    id: f.id, collection: f.collection, lng, lat,
    heading: Number.isFinite(p["view:azimuth"]) ? p["view:azimuth"] : null,
    date: p.datetime ?? null, datetz: p.datetimetz ?? null,
    license: p.license ?? null, licenseUrl: link("license")?.href ?? null,
    authors: [...new Set((f.providers ?? []).map((x) => x.name).filter(Boolean))],
    instance: via ? { name: via.instance_name ?? hostOf(via.href), url: via.href } : null,
    camera: model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim(),
    is360: fov === 360 || exif["Xmp.GPano.ProjectionType"] === "equirectangular",
    fov,
    size: io.sensor_array_dimensions ?? null,
    sd: f.assets?.sd?.href ?? f.assets?.hd?.href ?? null,
    hd: f.assets?.hd?.href ?? null,
    thumb: f.assets?.thumb?.href ?? null,
    hasTiles: !!tilesOk,
    tiles: tilesOk && tpl ? { cols: tm.matrixWidth, rows: tm.matrixHeight, width: tm.matrixWidth * tm.tileWidth, tpl } : null,
    prev: ref(link("prev")), next: ref(link("next")),
    rank: p["geovisio:rank_in_collection"] ?? null,
    sphere: pitch && roll ? { tilt: -pitch * rad, roll: roll * rad } : null,
  };
}

const itemCache = new Map();
const remember = (cache, key, value, max = 80) => {
  cache.set(key, value);
  while (cache.size > max) cache.delete(cache.keys().next().value);
  return value;
};
/** A picture's full item from the meta-catalogue (it carries the HD tile template). */
function fetchItem(collection, id) {
  if (itemCache.has(id)) return itemCache.get(id);
  const p = getJSON(`${API}/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`, { timeout: 15000 });
  p.catch(() => itemCache.delete(id));
  return remember(itemCache, id, p);
}
const seqCache = new Map();
function fetchSequence(collection) {
  if (seqCache.has(collection)) return seqCache.get(collection);
  const p = getJSON(`${API}/collections/${encodeURIComponent(collection)}`, { timeout: 15000 });
  p.catch(() => seqCache.delete(collection));
  return remember(seqCache, collection, p, 30);
}

/** Pictures within `radius` metres of a point, nearest first (search sorts a bbox by distance to its centre). */
async function nearby(lng, lat, radius, { collection = null, limit = 12 } = {}) {
  const dLat = radius / 110574, dLng = Math.min(180, radius / (111320 * Math.max(0.01, Math.cos(lat * rad))));
  // Clamped to the valid range: the far side of the antimeridian or a pole is not searched.
  const bbox = [clamp(lng - dLng, -180, 180), clamp(lat - dLat, -90, 90), clamp(lng + dLng, -180, 180), clamp(lat + dLat, -90, 90)].map((v) => v.toFixed(6)).join(",");
  const d = await getJSON(`${API}/search?bbox=${bbox}&limit=${limit}${collection ? `&collections=${encodeURIComponent(collection)}` : ""}`, { timeout: 15000 });
  return (d.features ?? [])
    .filter((f) => f?.geometry?.type === "Point" && (f.assets?.sd || f.assets?.hd))
    .map((f) => ({ f, d: distM([lng, lat], f.geometry.coordinates) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d);
}
/** How far findNearest looks for a given radius (it widens small searches once). */
const reach = (radius) => Math.max(radius, Math.min(2000, radius * 4));
const distLabel = (m) => (m >= 1000 ? `${fmt(m / 1000, m < 10000 ? 1 : 0)} km` : `${fmt(m)} m`);
/** Nearest picture: the clicked sequence first, then anything close, then a wider ring. */
async function findNearest(lng, lat, radius, { collection = null } = {}) {
  if (collection) {
    const inSeq = await nearby(lng, lat, radius, { collection, limit: 4 }).catch(() => []);
    if (inSeq.length) return inSeq[0];
  }
  const near = await nearby(lng, lat, radius);
  if (near.length) return near[0];
  const wide = reach(radius);
  if (wide <= radius) return null;
  return (await nearby(lng, lat, wide))[0] ?? null;
}
async function pictureById(id) {
  const d = await getJSON(`${API}/search?ids=${encodeURIComponent(id)}&limit=1`, { timeout: 15000 });
  const f = d.features?.[0];
  if (!f) throw new Error(`Panoramax has no picture ${id}`);
  return f;
}

/* ---------------------------------------------------------------- line tiles, thinned */
// Self-contained (it is also stringified into a worker): rewrites the line features of an
// MVT tile, dropping GPS fixes closer than `tolPx` to the last one kept and cutting lines
// into parts of at most 3,000 points, because MapLibre indexes each line part with 16 bits.
// Every other byte of the tile passes through unchanged.
function makeThinner() {
  const MAX_PART = 3000;
  const readVarint = (b, p) => {
    let v = 0, s = 1, x;
    do { x = b[p.i++]; v += (x & 0x7f) * s; s *= 128; } while (x >= 0x80);
    return v;
  };
  const skip = (b, p, wire) => {
    if (wire === 0) readVarint(b, p);
    else if (wire === 1) p.i += 8;
    else if (wire === 2) { const n = readVarint(b, p); p.i += n; }
    else if (wire === 5) p.i += 4;
    else throw new Error(`unexpected protobuf wire type ${wire}`);
  };
  class Out {
    constructor(n) { this.b = new Uint8Array(Math.max(16, n)); this.n = 0; }
    grow(k) {
      if (this.n + k <= this.b.length) return;
      const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
      nb.set(this.b.subarray(0, this.n));
      this.b = nb;
    }
    varint(v) { this.grow(10); while (v >= 0x80) { this.b[this.n++] = (v % 128) | 0x80; v = Math.floor(v / 128); } this.b[this.n++] = v; }
    raw(src, a, z) { this.grow(z - a); this.b.set(src.subarray(a, z), this.n); this.n += z - a; }
    field(key, body) { this.varint(key); this.varint(body.length); this.raw(body, 0, body.length); }
    done() { return this.b.subarray(0, this.n); }
  }
  const unzig = (n) => (n >>> 1) ^ -(n & 1);
  const zig = (n) => ((n << 1) ^ (n >> 31)) >>> 0;
  function parts(b, a, z) {
    const p = { i: a }, out = [];
    let x = 0, y = 0, cur = null;
    while (p.i < z) {
      const c = readVarint(b, p), id = c & 7, count = c >>> 3;
      if (id === 7) continue;
      for (let k = 0; k < count; k++) {
        x += unzig(readVarint(b, p)); y += unzig(readVarint(b, p));
        if (id === 1) out.push((cur = [x, y])); else cur?.push(x, y);
      }
    }
    return out;
  }
  function thin(lines, tol) {
    const t2 = tol * tol, out = [];
    for (const pts of lines) {
      const n = pts.length / 2;
      if (n < 2) continue;
      const keep = [pts[0], pts[1]];
      let lx = pts[0], ly = pts[1];
      for (let k = 1; k < n - 1; k++) {
        const x = pts[2 * k], y = pts[2 * k + 1];
        if ((x - lx) ** 2 + (y - ly) ** 2 >= t2) { keep.push(x, y); lx = x; ly = y; }
      }
      keep.push(pts[2 * n - 2], pts[2 * n - 1]);
      const m = keep.length / 2;
      for (let s = 0; s < m - 1; s += MAX_PART - 1) out.push(keep.slice(2 * s, 2 * Math.min(m, s + MAX_PART)));
    }
    return out;
  }
  function encode(lines) {
    const o = new Out(64);
    let x = 0, y = 0;
    for (const pts of lines) {
      o.varint(9); o.varint(zig(pts[0] - x)); o.varint(zig(pts[1] - y)); x = pts[0]; y = pts[1];
      o.varint(2 | ((pts.length / 2 - 1) << 3));
      for (let k = 2; k < pts.length; k += 2) { o.varint(zig(pts[k] - x)); o.varint(zig(pts[k + 1] - y)); x = pts[k]; y = pts[k + 1]; }
    }
    return o.done();
  }
  function feature(b, a, z, tol) {
    const p = { i: a };
    let type = 0, geom = null;
    while (p.i < z) {
      const key = readVarint(b, p), w = key & 7;
      if (key === 0x18) type = readVarint(b, p);
      else if (key === 0x22) { const n = readVarint(b, p); geom = [p.i, p.i + n]; p.i += n; }
      else skip(b, p, w);
    }
    if (type !== 2 || !geom) return null;
    const lines = thin(parts(b, geom[0], geom[1]), tol);
    if (!lines.length) return new Uint8Array(0);
    const o = new Out(z - a);
    p.i = a;
    while (p.i < z) {
      const s = p.i, key = readVarint(b, p);
      skip(b, p, key & 7);
      if (key === 0x22) o.field(0x22, encode(lines)); else o.raw(b, s, p.i);
    }
    return o.done();
  }
  function layer(b, a, z, tolPx) {
    const p = { i: a };
    let extent = 4096;
    while (p.i < z) { const key = readVarint(b, p); if (key === 0x28) extent = readVarint(b, p); else skip(b, p, key & 7); }
    const tol = (tolPx * extent) / 512;
    const o = new Out(z - a);
    p.i = a;
    while (p.i < z) {
      const s = p.i, key = readVarint(b, p);
      if (key === 0x12) {
        const n = readVarint(b, p), fa = p.i;
        p.i += n;
        const f = feature(b, fa, fa + n, tol);
        if (f === null) o.raw(b, s, p.i); else if (f.length) o.field(0x12, f);
      } else { skip(b, p, key & 7); o.raw(b, s, p.i); }
    }
    return o.done();
  }
  return (buf, tolPx) => {
    const b = new Uint8Array(buf), p = { i: 0 }, o = new Out(b.length);
    while (p.i < b.length) {
      const s = p.i, key = readVarint(b, p);
      if (key === 0x1a) { const n = readVarint(b, p), la = p.i; p.i += n; o.field(0x1a, layer(b, la, la + n, tolPx)); }
      else { skip(b, p, key & 7); o.raw(b, s, p.i); }
    }
    return o.done().slice().buffer;
  };
}

const THIN_PX = 0.6;
let thinWorker = null, thinLocal = null, thinSeq = 0;
const thinJobs = new Map();
/** Thin a tile off the main thread (a blob worker), or inline if workers are unavailable. */
function thinTile(buf) {
  if (thinWorker === null) {
    try {
      const src = `const thin = (${makeThinner})();
onmessage = (e) => {
  const { id, buf, tol } = e.data;
  try { const out = thin(buf, tol); postMessage({ id, buf: out }, [out]); }
  catch { postMessage({ id, buf: null }); }
};`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      thinWorker = new Worker(url);
      URL.revokeObjectURL(url);
      thinWorker.onmessage = (e) => {
        const job = thinJobs.get(e.data.id);
        thinJobs.delete(e.data.id);
        job?.(e.data.buf);
      };
      thinWorker.onerror = (e) => {
        e.preventDefault?.();
        thinWorker.terminate();
        thinWorker = false;
        for (const [id, job] of thinJobs) { thinJobs.delete(id); job(null); }
      };
    } catch { thinWorker = false; }
  }
  if (!thinWorker) {
    thinLocal ??= makeThinner();
    try { return Promise.resolve(thinLocal(buf, THIN_PX)); } catch { return Promise.resolve(buf); }
  }
  const id = ++thinSeq, copy = buf.slice(0); // the original stays here as the fallback
  return new Promise((resolve) => {
    thinJobs.set(id, (out) => resolve(out ?? buf));
    thinWorker.postMessage({ id, buf: copy, tol: THIN_PX }, [copy]);
  });
}
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Tile request cancelled", "AbortError")); }, { once: true });
});
/** One retry for a dropped connection or a busy server, as Panoramax sometimes is. */
async function fetchTile(url, signal) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try { res = await fetch(url, { signal }); } catch (err) { if (signal.aborted || attempt) throw err; }
    if (res && (res.ok || attempt || (res.status < 500 && res.status !== 429))) return res;
    await pause(800, signal);
  }
}
let thinProtocol = false;
function registerThinProtocol() {
  if (thinProtocol) return;
  thinProtocol = true;
  app.maplibregl.addProtocol("svmvt", async (params, ctrl) => {
    const res = await fetchTile(params.url.replace(/^svmvt:\/\//, "https://"), ctrl.signal);
    if (res.status === 204 || res.status === 404) return { data: new ArrayBuffer(0) };
    if (!res.ok) throw new Error(`Panoramax coverage tiles answered ${res.status}`);
    const buf = await res.arrayBuffer();
    return { data: buf.byteLength ? await thinTile(buf) : buf };
  });
}

/* ---------------------------------------------------------------- coverage layer */
let overviewPromise = null;
function loadOverview() {
  overviewPromise ??= getJSON(OVERVIEW_URL, { timeout: 20000 }).then((d) => {
    const [iLng, iLat, iN, iN360] = ["lng", "lat", "pictures", "pictures_360"].map((k) => d.fields.indexOf(k));
    return {
      type: "FeatureCollection",
      features: d.cells.map((c) => ({ type: "Feature", properties: { n: c[iN], n360: c[iN360] }, geometry: { type: "Point", coordinates: [c[iLng], c[iLat]] } })),
    };
  });
  overviewPromise.catch(() => (overviewPromise = null));
  return overviewPromise;
}

const LINE_W = [10, 1.3, 12, 1.8, Z_V2, 2.5, 18, 4, 20, 6.5];
const CASING_W = [10, 2.3, 12, 3.1, Z_V2, 4.4, 18, 6.4, 20, 9];
const lineWidth = (stops) => ["interpolate", ["exponential", 1.5], ["zoom"], ...stops];
const fadeIn = (z, to = 1) => ["interpolate", ["linear"], ["zoom"], z, 0, z + 0.6, to];
// Coverage cells as dots: size follows the zoom (cells are fixed on the ground) and, on a log
// scale, how many pictures the cell holds; deep blue where most of them are 360° panoramas.
const cellScale = (count, full) => ["+", 0.3, ["*", 0.7, ["min", 1, ["/", ["ln", ["+", 1, count]], full]]]];
const cellColor = (n360, n) => ["case", [">=", ["*", 2, n360], n], C360, CFLAT];

// The light variant is the "after view": coverage the viewer switched on stays, faint, around
// the spot it closed on until the map moves on.
function seqPaint(band, light) {
  const hi = band.key === "hi", z = band.show[0];
  return {
    "seq-casing": { "line-opacity": light ? 0 : hi ? 0.7 : fadeIn(z, 0.7) },
    seq: { "line-width": light ? 1.5 : lineWidth(LINE_W), "line-opacity": light ? 0.45 : hi ? 1 : fadeIn(z) },
  };
}
const picPaint = (light) => ({ "circle-opacity": light ? 0.45 : fadeIn(PIC_MIN_Z), "circle-stroke-opacity": light ? 0.45 : fadeIn(PIC_MIN_Z) });
function paintCoverage(m) {
  const set = (id, props) => { if (m.getLayer(id)) for (const [k, v] of Object.entries(props)) m.setPaintProperty(id, k, v); };
  for (const b of LINE_BANDS) for (const [k, props] of Object.entries(seqPaint(b, S.afterView))) set(`cat-i-sv-${k}-${b.key}`, props);
  set(ID.pic, picPaint(S.afterView));
}

function addSequenceLayers(m, band, before) {
  const [minzoom, maxzoom] = band.show;
  const source = `sv-${band.key}`;
  const hi = band.key === "hi";
  // One shared layout lets the three layers share a bucket; round joins on long, dense
  // city sequences would push single features past MapLibre's 65k-vertex segments.
  const layout = { ...(hi ? { "line-cap": "round", "line-join": "round" } : { "line-cap": "butt", "line-join": "bevel" }), "line-sort-key": SORT_360 };
  const common = { source, "source-layer": "sequences", minzoom, ...(maxzoom ? { maxzoom } : {}), layout };
  const paint = seqPaint(band, S.afterView);
  m.addLayer({ id: `cat-i-sv-seq-casing-${band.key}`, type: "line", ...common, paint: { "line-color": "rgba(4,24,66,0.45)", "line-width": lineWidth(CASING_W), ...paint["seq-casing"] } }, before);
  m.addLayer({ id: `cat-i-sv-seq-${band.key}`, type: "line", ...common, paint: { "line-color": BY_TYPE, ...paint.seq } }, before);
  // Invisible, wide twin so thin lines are easy to hit (queries still see zero-opacity lines).
  m.addLayer({ id: `cat-i-sv-hit-${band.key}`, type: "line", ...common, paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0 } }, before);
}

async function addCoverage(m) {
  const before = app.layers.anchor("data");
  const overview = await loadOverview().catch((err) => { console.warn("[streetview] coverage overview unavailable", err); return null; });
  if (!app.layers.isOn("streetview") || m.getSource("sv-grid")) return;
  if (overview) {
    const ov = cellScale(["get", "n"], 13);
    m.addSource("sv-overview", { type: "geojson", data: overview });
    m.addLayer({
      id: ID.overview, type: "circle", source: "sv-overview", maxzoom: Z_GRID + 0.6,
      paint: {
        "circle-color": cellColor(["get", "n360"], ["get", "n"]),
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["*", 2.1, ov], 2, ["*", 3, ov], Z_GRID + 0.6, ["*", 17, ov]],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, ["+", 0.4, ["*", 0.45, ov]], Z_GRID, ["+", 0.35, ["*", 0.45, ov]], Z_GRID + 0.6, 0],
        "circle-blur": ["interpolate", ["linear"], ["zoom"], 0, 0.2, Z_GRID, 0.55],
        "circle-pitch-alignment": "map",
      },
    }, before);
  }
  m.addSource("sv-grid", { type: "vector", tiles: [TILES_V1], minzoom: Z_GRID, maxzoom: Z_GRID });
  const n = ["to-number", ["get", "nb_pictures"], 0];
  const grid = cellScale(n, 11);
  // Cells are 0.1° apart (4.6 px at z5, 146 px at z10): the dots grow slower than the
  // lattice, so a dense texture zoomed out becomes a crisp, airy dot matrix up close.
  m.addLayer({
    id: ID.grid, type: "circle", source: "sv-grid", "source-layer": "grid", minzoom: Z_GRID, maxzoom: Z_LINES + 0.6,
    filter: [">", n, 0],
    paint: {
      "circle-color": cellColor(["to-number", ["get", "nb_360_pictures"], 0], n),
      "circle-radius": ["interpolate", ["linear"], ["zoom"], Z_GRID, ["*", 2.1, grid], 7, ["*", 6.2, grid], 8.5, ["*", 9.5, grid], Z_LINES + 0.6, ["*", 12, grid]],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], Z_GRID, 0, Z_GRID + 0.6, ["+", 0.45, ["*", 0.45, grid]], Z_LINES, ["+", 0.45, ["*", 0.45, grid]], Z_LINES + 0.6, 0],
      "circle-blur": ["interpolate", ["linear"], ["zoom"], Z_GRID, 0.35, 7, 0.05],
      "circle-stroke-color": "rgba(255,255,255,0.75)",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6.5, 0, 7.5, 1],
      "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], Z_LINES, 1, Z_LINES + 0.6, 0],
      "circle-pitch-alignment": "map",
    },
  }, before);
  for (const band of LINE_BANDS) {
    m.addSource(`sv-${band.key}`, { type: "vector", tiles: [band.tiles], minzoom: band.tileZoom[0], maxzoom: band.tileZoom[1] });
    addSequenceLayers(m, band, before);
  }
  m.addLayer({
    id: ID.pic, type: "circle", source: "sv-hi", "source-layer": "pictures", minzoom: PIC_MIN_Z,
    layout: { "circle-sort-key": SORT_360 },
    paint: {
      "circle-color": BY_TYPE,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], PIC_MIN_Z, 2.4, 19, 4.5, 20, 6.5],
      "circle-stroke-color": "#fff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], PIC_MIN_Z, 0.8, 19, 1.6],
      ...picPaint(S.afterView),
    },
  }, before);
}

function removeCoverage(m) {
  for (const id of [...CONE_LAYERS, ...COVERAGE_LAYERS]) if (m.getLayer(id)) m.removeLayer(id);
  for (const s of SOURCES) if (m.getSource(s)) m.removeSource(s);
  hidePopup();
  if (S.pick) cancelPick();
  S.coverageAuto = false;
  if (S.afterView) setAfterView(false);
}

// On the globe the cone is an icon, not a polygon: 2D fills are draped onto the terrain
// and 3D buildings would hide them, while symbols draw on top at a constant screen size.
const CONE_PX = 220;
function coneImage(fov) {
  const c = document.createElement("canvas");
  c.width = c.height = CONE_PX;
  const g = c.getContext("2d");
  const r = CONE_PX / 2, spread = clamp(fov, 8, 340) * rad;
  const a0 = -Math.PI / 2 - spread / 2, a1 = -Math.PI / 2 + spread / 2;
  const grad = g.createRadialGradient(r, r, 6, r, r, r - 4);
  grad.addColorStop(0, "rgba(20,20,20,0.5)");
  grad.addColorStop(1, "rgba(20,20,20,0.12)");
  g.beginPath(); g.moveTo(r, r); g.arc(r, r, r - 4, a0, a1); g.closePath();
  g.fillStyle = grad; g.fill();
  g.lineJoin = "round";
  g.lineWidth = 6; g.strokeStyle = "rgba(255,255,255,0.9)"; g.stroke();
  g.lineWidth = 2.5; g.strokeStyle = "rgba(20,20,20,0.95)"; g.stroke();
  return g.getImageData(0, 0, CONE_PX, CONE_PX);
}
let coneFov = null;
function ensureCone(m) {
  if (m.getSource("sv-cone") || !m.getLayer(app.layers.anchor("live"))) return;
  m.addSource("sv-cone", { type: "geojson", data: EMPTY });
  if (!m.hasImage("sv-cone-img")) { m.addImage("sv-cone-img", coneImage(70), { pixelRatio: 2 }); coneFov = 70; }
  const before = app.layers.anchor("live");
  m.addLayer({
    id: ID.cone, type: "symbol", source: "sv-cone", filter: ["has", "heading"],
    layout: {
      "icon-image": "sv-cone-img", "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true,
    },
  }, before);
  m.addLayer({ id: ID.me, type: "circle", source: "sv-cone", paint: { "circle-radius": 7.5, "circle-color": "#141414", "circle-stroke-color": "#fff", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } }, before);
}

/* ---------------------------------------------------------------- hover + click on the globe */
function hitAt(point) {
  const m = app.map;
  const ids = HIT_LAYERS.filter((id) => m.getLayer(id) && (id !== ID.pic || m.getZoom() >= PIC_MIN_Z));
  if (!ids.length) return null;
  const fs = m.queryRenderedFeatures(point, { layers: ids });
  return fs.find((f) => f.layer.id === ID.pic) ?? fs[0] ?? null;
}
function hidePopup() { S.popup?.remove(); }
function hover(e) {
  const m = app.map;
  if (S.pick && app.mode !== "streetview") cancelPick(); // another tool took the map
  const otherTool = app.mode && app.mode !== "streetview" && app.mode !== "explore"; // measuring, placing a pin…
  const f = S.open || otherTool || !app.layers.isOn("streetview") ? null : hitAt(e.point);
  if (!f) {
    if (S.hovering) { S.hovering = false; m.getCanvas().style.cursor = ""; hidePopup(); }
    return;
  }
  S.hovering = true;
  m.getCanvas().style.cursor = "pointer";
  const p = f.properties;
  const kind = p.type === "equirectangular" ? "360° panorama" : "Photo";
  const html = f.layer.id === ID.pic
    ? `<div class="sv-pop-img" style="background-image:url('${esc(`${API}/pictures/${encodeURIComponent(p.id)}/thumb.jpg`)}')"></div><div class="sv-pop-t">${kind} · ${esc(dayLabel(p.ts))}</div><div class="sv-pop-s">Click to look around</div>`
    : `<div class="sv-pop-t">${p.type === "equirectangular" ? "360° panoramas" : "Photos"}${p.date ? ` · ${esc(dayLabel(p.date))}` : ""}</div><div class="sv-pop-s">${p.model ? `${esc(p.model)} · ` : ""}Click to look around</div>`;
  S.popup ??= new app.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "sv-pop", maxWidth: "240px" });
  S.popup.setLngLat(f.layer.id === ID.pic ? f.geometry.coordinates : e.lngLat).setHTML(html).addTo(m);
}

function onMapClick(e) {
  if (S.pick && app.mode !== "streetview") cancelPick(); // another tool took the map
  if (S.afterView && !S.open && !(app.layers.isOn("streetview") && hitAt(e.point))) endAfterView();
  const picking = app.mode === "streetview";
  if (!picking && app.mode && app.mode !== "explore") return;
  const f = app.layers.isOn("streetview") ? hitAt(e.point) : null;
  if (!f && !picking) return;
  hidePopup();
  const zoom = app.map.getZoom();
  if (f?.layer.id === ID.pic) openPicture(f.properties.id);
  else pickAt(e.lngLat, { zoom, collection: f?.properties.id ?? null, overlayFirst: !!f });
}
function openPicture(id) {
  openOverlay(null, "Opening picture…");
  const session = S.session; // closed while loading: stay closed
  pictureById(id).then(
    (feat) => { if (S.open && S.session === session) show(toPic(feat), { first: true }); },
    (err) => { if (S.session === session) failOpen(err, { api: true, retry: () => openPicture(id) }); },
  );
}

/** Find the picture nearest a map point and open it (pick mode, coverage clicks, the mini-map). */
async function pickAt(lngLat, { zoom, collection = null, overlayFirst = false } = {}) {
  const { lng, lat } = lngLat;
  // Zoomed out, a click cannot aim at a street: look for the nearest picture within ~40 px.
  const far = !S.open && zoom < 11 && !collection;
  const radius = far ? clamp(40 * metersPerPixel(lat, zoom), 2000, 100000) : clamp(30 * metersPerPixel(lat, zoom), 12, 400);
  if (overlayFirst) openOverlay(null, "Finding the nearest picture…");
  else if (!S.open) setHint(far ? "Finding the nearest street-level picture…" : "Finding the nearest picture…", { busy: true });
  else setBusy(true);
  // The answer may come back after the viewer was closed or pick mode was cancelled.
  const session = S.session, inViewer = S.open;
  const stale = () => (inViewer ? !S.open || S.session !== session : !S.pick);
  let hit;
  try {
    hit = await findNearest(lng, lat, radius, { collection });
  } catch (err) {
    if (stale()) return;
    if (overlayFirst) failOpen(err, { api: true, retry: () => pickAt(lngLat, { zoom, collection, overlayFirst }) });
    else if (S.open) { setBusy(false); app.ui.toast(`${apiReason(err)}. Try again.`, { tone: "error" }); }
    else setHint(`${apiReason(err)}. Try again.`, { flash: true });
    return;
  }
  if (stale()) return;
  if (!hit) {
    const msg = `No street-level pictures within ${distLabel(reach(radius))} of this spot.`;
    if (overlayFirst) { close(); app.ui.toast(msg); }
    else if (S.open) { setBusy(false); app.ui.toast(msg); }
    else setHint(`${msg} ${far ? "Try where the blue dots are." : "Try a blue line."}`, { flash: true });
    return;
  }
  // Face the clicked spot when it was a near miss; a far pick has nothing to face.
  const lookAt = hit.d > 8 && hit.d < 400 ? [lng, lat] : null;
  const heading = S.open && S.pic ? currentHeading() : null;
  const pic = toPic(hit.f);
  if (!S.open) openOverlay(pic);
  else setBusy(false);
  await show(pic, { first: !S.psv && !S.flat, lookAt, heading });
}

/* ---------------------------------------------------------------- pick mode + control */
function buildControl() {
  const group = document.createElement("div");
  group.className = "ctl-group wglass sv-ctl";
  group.innerHTML = `<button type="button" id="ctl-sv" title="Street view: show where street-level pictures exist, then pick a spot" aria-label="Street view" aria-pressed="false">${ICON.person}</button>`;
  $("#controls")?.append(group);
  S.btn = group.firstElementChild;
  S.btn.addEventListener("click", (e) => {
    if (S.pick) return cancelPick();
    if (S.afterView) return endAfterView();
    setPick(true);
    if (e.detail === 0) S.hint.querySelector(".sv-hint-here").focus(); // keyboard: no pointer to pick with
  });

  const hint = document.createElement("div");
  hint.className = "sv-hint wglass";
  hint.hidden = true;
  hint.innerHTML = `<span class="sv-hint-ic" aria-hidden="true">${ICON.person}</span><span class="sv-hint-t" role="status"></span>
    <button type="button" class="btn btn-ghost btn-sm sv-hint-here" aria-label="Look here, at the picture nearest the centre of the map" title="Open the picture nearest the centre of the map">Look here</button>
    <button type="button" class="btn btn-ghost btn-sm sv-hint-cancel">Cancel</button>`;
  hint.querySelector(".sv-hint-here").addEventListener("click", () => pickAt(app.map.getCenter(), { zoom: app.map.getZoom() }));
  hint.querySelector(".sv-hint-cancel").addEventListener("click", cancelPick);
  // Right after its button in the tab order; the CSS keeps it fixed above the bottom edge.
  if (group.isConnected) group.after(hint); else document.body.append(hint);
  S.hint = hint;
  app.map.on("zoomend", () => { if (S.pick && !S.hint.classList.contains("is-flash")) setHint(); });
}
const touch = () => matchMedia("(pointer: coarse)").matches;
function defaultHint() {
  const verb = touch() ? "Tap" : "Click";
  return app.map.getZoom() < 11 ? `${verb} where the blue dots are to see the nearest street` : `${verb} a blue line to look around`;
}
function setHint(text, { busy = false, flash = false } = {}) {
  if (!S.hint) return;
  clearTimeout(S.hintTimer);
  S.hint.querySelector(".sv-hint-t").textContent = text ?? defaultHint();
  S.hint.classList.toggle("is-busy", busy);
  S.hint.classList.toggle("is-flash", flash);
  S.hint.hidden = !S.pick && !flash;
  if (flash) S.hintTimer = setTimeout(() => { S.hint.classList.remove("is-flash"); if (S.pick) setHint(); else S.hint.hidden = true; }, 4200);
}
function setPick(on) {
  if (on === S.pick) return;
  if (on) app.emit("mode:claim", "streetview"); // measure, pins and probes end first
  S.pick = on;
  syncBtn();
  document.body.classList.toggle("sv-picking", on);
  if (on) {
    app.mode = "streetview";
    if (!app.layers.isOn("streetview")) {
      S.pickLayerAuto = true;
      app.layers.toggle("streetview", true).catch(() => {});
    }
    setHint();
  } else {
    if (app.mode === "streetview") app.mode = null;
    clearTimeout(S.hintTimer);
    if (S.hint?.contains(document.activeElement)) S.btn?.focus({ preventScroll: true });
    if (S.hint) S.hint.hidden = true;
  }
}
function cancelPick() {
  const auto = S.pickLayerAuto;
  S.pickLayerAuto = false;
  setPick(false);
  if (auto && app.layers.isOn("streetview") && !S.open) app.layers.toggle("streetview", false).catch(() => {});
}
/** The pegman reads pressed while picking and while the after-view coverage shows. */
function syncBtn() {
  if (!S.btn) return;
  S.btn.setAttribute("aria-pressed", String(S.pick || S.afterView));
  S.btn.title = S.afterView && !S.pick ? "Hide the street-level coverage" : "Street view: show where street-level pictures exist, then pick a spot";
}
function setAfterView(on, at = null) {
  S.afterView = on;
  S.afterAt = on ? at : null;
  syncBtn();
  paintCoverage(app.map);
}
function endAfterView() {
  if (app.layers.isOn("streetview")) app.layers.toggle("streetview", false).catch(() => {}); // removeCoverage resets the state
  else { S.coverageAuto = false; setAfterView(false); }
}

/* ---------------------------------------------------------------- Photo Sphere Viewer (lazy) */
let psvLoad = null;
function loadPSV() {
  psvLoad ??= (async () => {
    const core = await import(PSV_CORE);
    let Tiles = null;
    try {
      const res = await fetch(PSV_TILES);
      if (!res.ok) throw new Error(`jsDelivr answered ${res.status}`);
      // jsDelivr bundles the tiles adapter against an unversioned three ("/npm/three/+esm");
      // point it at the exact build core uses so both share one pinned three.js instance.
      const code = (await res.text())
        .replace(/(["'])\/npm\/three\/\+esm\1/g, JSON.stringify(THREE))
        .replace(/(["'])\/npm\//g, "$1https://cdn.jsdelivr.net/npm/");
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      try { Tiles = (await import(url)).EquirectangularTilesAdapter ?? null; } finally { URL.revokeObjectURL(url); }
    } catch (err) {
      console.warn("[streetview] tiled HD loading unavailable; panoramas use the standard-definition picture", err);
    }
    return { core, Tiles };
  })();
  psvLoad.catch(() => (psvLoad = null));
  return psvLoad;
}
const webgl = (() => {
  let ok = null;
  return () => {
    if (ok == null) {
      try { const c = document.createElement("canvas"); ok = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { ok = false; }
    }
    return ok;
  };
})();

function ensurePSV({ core, Tiles }) {
  if (S.psv) return S.psv;
  const el = document.createElement("div");
  el.className = "sv-psv";
  S.stage.prepend(el);
  const viewer = new core.Viewer({
    container: el,
    ...(Tiles ? { adapter: Tiles.withConfig({ showErrorTile: false, baseBlur: false, antialias: true }) } : {}),
    navbar: false,
    keyboard: false,
    loadingImg: null,
    loadingTxt: null,
    minFov: 20,
    maxFov: 100,
    defaultZoomLvl: 20,
    moveInertia: reducedMotion() ? false : 0.8,
    mousewheelCtrlKey: false,
    touchmoveTwoFingers: false,
    canvasBackground: "#0b0b0d",
    defaultTransition: { speed: 420, rotation: false, effect: "fade" },
    lang: { loadError: "This picture could not be loaded", webglError: "This browser cannot show 360° pictures" },
  });
  viewer.addEventListener("position-updated", scheduleView);
  viewer.addEventListener("zoom-updated", scheduleView);
  S.psv = viewer;
  return viewer;
}
function destroyPSV() {
  const v = S.psv;
  if (!v) return;
  S.psv = null;
  const el = v.parent, gl = v.renderer?.renderer;
  const free = () => {
    try { v.destroy(); } catch {}
    try { gl?.forceContextLoss?.(); } catch {}
    el?.remove();
  };
  // Destroying mid-load aborts PSV's download, which it reports as a console error: let the
  // picture land out of sight, then free the viewer.
  const loading = v.state?.loadingPromise;
  if (loading) {
    if (el) el.hidden = true;
    loading.then(free, free);
  } else free();
}

/* ---------------------------------------------------------------- flat viewer (pan + zoom) */
function createFlat(host, onView, onHd) {
  const box = document.createElement("div");
  box.className = "sv-flat";
  const img = document.createElement("img");
  img.className = "sv-flat-img";
  img.alt = "";
  img.draggable = false;
  box.append(img);
  host.append(box);
  let nat = { w: 1, h: 1 }, bw = 0, bh = 0, s = 1, x = 0, y = 0, cur = null, hd = "none", pinch = null, lastTap = null;
  const pointers = new Map();
  const size = () => ({ w: box.clientWidth || 1, h: box.clientHeight || 1 });
  const fit = () => {
    const { w, h } = size();
    const r = Math.min(w / nat.w, h / nat.h);
    bw = nat.w * r; bh = nat.h * r;
    img.style.width = `${bw}px`;
    img.style.height = `${bh}px`;
  };
  const apply = (animate) => {
    const { w, h } = size();
    const sw = bw * s, sh = bh * s;
    x = sw <= w ? (w - sw) / 2 : clamp(x, w - sw, 0);
    y = sh <= h ? (h - sh) / 2 : clamp(y, h - sh, 0);
    img.style.transition = animate && !reducedMotion() ? "transform 240ms cubic-bezier(.22,1,.36,1)" : "none";
    img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    box.classList.toggle("is-zoomed", s > 1.01);
    if (s >= 1.6 && hd === "none" && cur?.hd && cur.hd !== cur.sd) {
      hd = "loading";
      onHd(true);
      const want = cur, pre = new Image();
      pre.src = want.hd;
      pre.decode().then(() => { if (cur === want) { img.src = want.hd; hd = "done"; } }, () => { if (cur === want) hd = "failed"; })
        .finally(() => { if (cur === want) onHd(false); });
    }
    onView();
  };
  const zoomAt = (f, px, py, animate) => {
    const ns = clamp(s * f, 1, 8), k = ns / s;
    x = px - (px - x) * k; y = py - (py - y) * k; s = ns;
    apply(animate);
  };
  const local = (e) => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  box.addEventListener("wheel", (e) => { e.preventDefault(); const [px, py] = local(e); zoomAt(Math.exp(-e.deltaY * 0.0018), px, py, false); }, { passive: false });
  box.addEventListener("pointerdown", (e) => {
    box.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), sx: e.clientX, sy: e.clientY });
    if (pointers.size === 2) pinch = pinchState();
    box.classList.add("is-grabbing");
  });
  box.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) { x += dx; y += dy; apply(false); }
    else if (pointers.size === 2 && pinch) {
      const n = pinchState(), r = box.getBoundingClientRect();
      x += n.cx - pinch.cx; y += n.cy - pinch.cy;
      zoomAt(n.d / pinch.d, n.cx - r.left, n.cy - r.top, false);
      pinch = n;
    }
  });
  const end = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) box.classList.remove("is-grabbing");
    // Double tap (touch) toggles zoom; mouse gets the native dblclick below.
    if (p && e.pointerType === "touch" && e.type === "pointerup" && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 12) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { toggleZoom(e); lastTap = null; }
      else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  const toggleZoom = (e) => { const [px, py] = local(e); if (s > 1.05) { s = 1; apply(true); } else zoomAt(2.5, px, py, true); };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("dblclick", (e) => { e.preventDefault(); toggleZoom(e); });
  const ro = new ResizeObserver(() => { fit(); apply(false); });
  ro.observe(box);

  return {
    el: box,
    async load(pic, src = pic.sd ?? pic.hd) {
      if (hd === "loading") onHd(false);
      cur = pic; hd = "none";
      const pre = new Image();
      pre.decoding = "async";
      pre.src = src;
      await pre.decode();
      if (cur !== pic) return false;
      nat = { w: pre.naturalWidth || 1, h: pre.naturalHeight || 1 };
      img.alt = `Street-level photo${captured(pic) ? ` captured ${captured(pic).medium}` : ""}${pic.authors.length ? ` by ${pic.authors[0]}` : ""}`;
      img.src = src;
      s = 1; fit(); apply(false);
      if (!reducedMotion()) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" });
      return true;
    },
    zoomBy(f) { const { w, h } = size(); zoomAt(f, w / 2, h / 2, true); },
    pan(dx, dy) { x += dx; y += dy; apply(true); },
    /** Where the view sits across the picture: offset -0.5..0.5 from its centre, visible width fraction. */
    view() {
      const { w } = size();
      const sw = bw * s || 1;
      return { offset: clamp((w / 2 - x) / sw, 0, 1) - 0.5, frac: Math.min(1, w / sw) };
    },
    destroy() { ro.disconnect(); box.remove(); },
  };
}
function destroyFlat() { S.flat?.destroy(); S.flat = null; }

/* ---------------------------------------------------------------- the viewer overlay */
function buildOverlay() {
  const root = document.createElement("div");
  root.className = "sv";
  root.id = "sv";
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "sv-title");
  root.innerHTML = `
    <div class="sv-stage" id="sv-stage"></div>
    <div class="sv-veil" id="sv-veil">
      <div class="sv-veil-img" id="sv-veil-img"></div>
      <div class="sv-veil-box"><span class="sv-spin" aria-hidden="true"></span><p id="sv-veil-msg">Loading street view…</p><div class="sv-veil-actions" id="sv-veil-actions"></div></div>
    </div>
    <section class="sv-info wglass" id="sv-info" aria-label="About this picture">
      <div class="sv-info-head">
        <div class="sv-info-title">
          <div class="eyebrow" id="sv-kind">Street level</div>
          <h2 id="sv-title">Street level</h2>
          <div class="sub" id="sv-sub"></div>
        </div>
        <button type="button" class="icon-btn sv-more" id="sv-more" aria-expanded="false" aria-controls="sv-details" aria-label="Show picture details" title="Details">${ICON.chevron}</button>
      </div>
      <div class="sv-dates" id="sv-dates" hidden><span class="eyebrow">Other dates here</span><div class="sv-chips" id="sv-chips"></div></div>
      <div class="sv-details" id="sv-details">
        <dl class="kv" id="sv-kv"></dl>
        <div class="card-actions"><a class="btn btn-ghost btn-sm" id="sv-link" target="_blank" rel="noopener">Open on Panoramax ${ICON.external}</a></div>
        <p class="note" id="sv-note"></p>
      </div>
    </section>
    <button type="button" class="sv-close wglass" id="sv-close" aria-label="Close street view (Esc)" title="Close (Esc)">${ICON.close}</button>
    <div class="sv-mini" id="sv-mini">
      <div class="sv-mini-map" id="sv-mini-map" role="img" aria-label="Map of the surroundings with the camera's view cone"></div>
      <button type="button" class="sv-mini-size" id="sv-mini-size" aria-label="Enlarge map" aria-pressed="false" title="Enlarge map">${ICON.expand}</button>
      <a class="sv-mini-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" title="Map data © OpenStreetMap contributors, tiles OpenFreeMap / OpenMapTiles">© OpenStreetMap</a>
    </div>
    <div class="sv-nav wglass" role="toolbar" aria-label="Street view controls">
      <button type="button" id="sv-prev" aria-label="Previous picture in sequence" title="Previous picture (←)">${ICON.prev}</button>
      <button type="button" class="sv-heading" id="sv-heading" aria-label="Face north" title="Face north">${COMPASS}<span id="sv-heading-t">—</span></button>
      <span class="sv-sep" aria-hidden="true"></span>
      <button type="button" id="sv-zout" aria-label="Zoom out" title="Zoom out (−)">${ICON.minus}</button>
      <button type="button" id="sv-zin" aria-label="Zoom in" title="Zoom in (+)">${ICON.plus}</button>
      <span class="sv-sep" aria-hidden="true"></span>
      <button type="button" id="sv-next" aria-label="Next picture in sequence" title="Next picture (→)">${ICON.next}</button>
    </div>
    <p class="sv-credit" id="sv-credit"></p>
    <div class="sv-sr" id="sv-live" aria-live="polite"></div>`;
  document.body.append(root);
  S.root = root;
  S.stage = root.querySelector("#sv-stage");
  root.querySelector("#sv-close").onclick = () => close();
  root.querySelector("#sv-prev").onclick = () => step("prev");
  root.querySelector("#sv-next").onclick = () => step("next");
  root.querySelector("#sv-zin").onclick = () => zoom(1);
  root.querySelector("#sv-zout").onclick = () => zoom(-1);
  root.querySelector("#sv-heading").onclick = () => faceNorth();
  root.querySelector("#sv-more").onclick = () => {
    const open = !root.classList.contains("details-open");
    setDetails(open);
    try { localStorage.setItem("world.sv.details", open ? "1" : "0"); } catch {}
  };
  root.querySelector("#sv-mini-size").onclick = (e) => {
    const big = !root.classList.contains("mini-big");
    root.classList.toggle("mini-big", big);
    e.currentTarget.setAttribute("aria-pressed", String(big));
    e.currentTarget.setAttribute("aria-label", big ? "Shrink map" : "Enlarge map");
    e.currentTarget.title = big ? "Shrink map" : "Enlarge map";
    e.currentTarget.innerHTML = big ? ICON.collapse : ICON.expand;
    setTimeout(() => { S.mini?.resize(); updateView(); }, reducedMotion() ? 0 : 260);
  };
}

const q = (sel) => S.root.querySelector(sel);
function setDetails(open) {
  S.root.classList.toggle("details-open", open);
  const b = q("#sv-more");
  b.setAttribute("aria-expanded", String(open));
  b.setAttribute("aria-label", open ? "Hide picture details" : "Show picture details");
}
function announce(text) { const el = q("#sv-live"); if (el) el.textContent = text; }
function setBusy(on) { S.busy = on; q(".sv-nav")?.classList.toggle("is-busy", on); }
function veil(state, msg, { thumb, actions } = {}) {
  const v = q("#sv-veil");
  if (state === "off") { v.classList.add("is-off"); q("#sv-veil-actions").replaceChildren(); return; }
  v.classList.remove("is-off");
  v.classList.toggle("is-error", state === "error");
  q("#sv-veil-msg").textContent = msg;
  if (thumb !== undefined) q("#sv-veil-img").style.backgroundImage = thumb ? `url("${thumb.replace(/"/g, "%22")}")` : "";
  const box = q("#sv-veil-actions");
  box.replaceChildren(...(actions ?? []).map(([label, fn, primary]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-sm ${primary ? "sv-btn-light" : "sv-btn-dim"}`;
    b.textContent = label;
    b.onclick = fn;
    return b;
  }));
  if (actions?.length) box.firstElementChild.focus();
}

function openOverlay(pic, message = "Loading street view…") {
  if (!S.root) buildOverlay();
  if (S.pick) { S.coverageAuto ||= S.pickLayerAuto; S.pickLayerAuto = false; setPick(false); }
  if (!S.open) {
    S.open = true;
    S.pic = pic ?? null;
    S.lastFocus = document.activeElement;
    S.root.hidden = false;
    let open = false;
    try { open = localStorage.getItem("world.sv.details") === "1"; } catch {}
    setDetails(open);
    requestAnimationFrame(() => S.root.classList.add("is-open"));
    S.root.focus({ preventScroll: true });
    hidePopup();
    app.emit("streetview:open", { id: pic?.id ?? null });
  }
  if (pic) renderInfo(pic);
  else renderInfo(null);
  veil("loading", message, { thumb: pic?.thumb ?? null });
  requestAnimationFrame(() => ensureMini(pic));
}
/** A failure in words: which host let us down and how, without URLs or stack text. */
function failReason(err) {
  const msg = String(err?.message ?? err ?? "");
  const api = msg.match(/^([\w.-]+\.[a-z]{2,}) (?:answered (\d{3})|timed out)/i); // getJSON's wording
  const host = api?.[1] ?? (S.pic?.sd ? hostOf(S.pic.sd) : "the picture's host");
  const status = api?.[2] ?? msg.match(/responded with (\d{3})/)?.[1];
  if (status) return `${host} answered with error ${status}`;
  if (api) return `${host} did not answer in time`;
  if (err?.name === "EncodingError" || /decod|fetch|network|load|image/i.test(msg)) return `${host} did not send the image`;
  return msg.replace(/[.\s]+$/, "");
}
/** A search or metadata failure, in words. */
function apiReason(err) {
  const msg = String(err?.message ?? "");
  const code = msg.match(/answered (\d{3})/)?.[1];
  if (code) return `Panoramax answered with error ${code}`;
  if (/timed out/.test(msg)) return "Panoramax did not answer in time";
  return "Panoramax could not be reached";
}
function failOpen(err, { api = false, retry = null } = {}) {
  if (!S.open) return;
  setBusy(false);
  const reason = api ? apiReason(err) : failReason(err);
  const again = retry ?? (S.pic ? () => show(S.pic, { first: true, heading: null }) : null);
  veil("error", `This picture could not be loaded${reason ? `: ${reason}` : ""}.`, {
    actions: [...(again ? [["Try again", again, true]] : []), ["Close", () => close(), !again]],
  });
  announce("The picture could not be loaded.");
}

function close() {
  if (!S.open) return;
  S.open = false;
  S.token++;
  S.session++;
  S.stepTo = null;
  S.datesKey = S.datesAt = null;
  setBusy(false);
  const pic = S.pic;
  if (pic) {
    // Land where the viewer ended, with the coverage around and the cone showing where you were looking.
    const view = currentView();
    if (!app.layers.isOn("streetview")) S.coverageAuto = true;
    if (S.coverageAuto) setAfterView(true, [pic.lng, pic.lat]); // before the jump: its moveend measures from here
    app.map.jumpTo({ center: [pic.lng, pic.lat], zoom: Math.max(app.map.getZoom(), 17) });
    if (!app.layers.isOn("streetview")) app.layers.toggle("streetview", true).catch(() => {});
    updateMainCone(pic, view);
  } else if (S.coverageAuto) endAfterView();
  S.root.classList.remove("is-open");
  const done = () => {
    if (S.open) return;
    S.root.hidden = true;
    destroyPSV();
    destroyFlat();
    destroyMini();
  };
  if (reducedMotion()) done(); else setTimeout(done, 220);
  const back = S.lastFocus;
  S.lastFocus = null;
  if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
  app.emit("streetview:close", { id: pic?.id ?? null });
}

/* ---------------------------------------------------------------- showing a picture */
function tiledPanorama(pic) {
  const t = pic.tiles;
  if (!t) return { width: pic.size?.[0] ?? 2048, cols: 2, rows: 1, baseUrl: pic.sd, tileUrl: () => null };
  return { width: t.width, cols: t.cols, rows: t.rows, baseUrl: pic.sd, tileUrl: (col, row) => t.tpl.replace(/\{TileCol\}/g, col).replace(/\{TileRow\}/g, row) };
}

async function show(pic, { lookAt = null, heading = null, first = false, stepping = false } = {}) {
  const my = ++S.token;
  if (!stepping) S.stepTo = null;
  S.pic = pic;
  // The link (sv=) follows the picture: a date chip, a step, a mini-map pick, or the first
  // picture of a viewer that opened before it knew which one (a coverage click).
  syncHash();
  q("#sv-note").dataset.fallback = "";
  renderInfo(pic);
  setBusy(true);
  if (first) veil("loading", "Loading street view…", { thumb: pic.thumb });
  const when = captured(pic);
  announce(`Loading ${pic.is360 ? "360° panorama" : "photo"}${when ? ` from ${when.medium}` : ""}`);
  try {
    let ok;
    if (pic.is360 && webgl()) ok = await show360(pic, { lookAt, heading, first }, my);
    else ok = await showFlat(pic, my, pic.is360 ? "This browser cannot draw 360° pictures, so the panorama is shown flat." : "");
    if (!ok || my !== S.token) return;
    veil("off");
    setBusy(false);
    updateView();
    centerMini(pic);
    followOnMap(pic);
    afterShow(pic, my);
    announce(`${pic.is360 ? "360° panorama" : "Photo"}${when ? ` from ${when.medium}` : ""} loaded`);
  } catch (err) {
    if (my !== S.token) return;
    failOpen(err);
  }
}

async function show360(pic, { lookAt, heading, first }, my) {
  let mods;
  try { mods = await loadPSV(); } catch (err) {
    console.warn("[streetview] Photo Sphere Viewer failed to load", err);
    return showFlat(pic, my, "The 360° viewer could not load, so the panorama is shown flat.");
  }
  if (my !== S.token) return false;
  if (mods.Tiles && pic.hasTiles && !pic.tiles) {
    const full = await Promise.race([fetchItem(pic.collection, pic.id), new Promise((r) => setTimeout(r, 5000))]).catch(() => null);
    if (full) pic.tiles = toPic(full).tiles;
    if (my !== S.token) return false;
  }
  const viewer = ensurePSV(mods);
  let yaw = 0;
  const az = pic.heading; // without it no compass direction can be turned into a yaw
  if (az != null && lookAt) yaw = bearingTo([pic.lng, pic.lat], lookAt) - az;
  else if (az != null && heading != null) yaw = heading - az;
  yaw = (((yaw + 180) % 360) + 360) % 360 - 180;
  const pitch = !first && viewer.state.ready ? viewer.getPosition().pitch : 0;
  const res = await viewer.setPanorama(mods.Tiles ? tiledPanorama(pic) : pic.sd, {
    position: { yaw: yaw * rad, pitch },
    ...(first ? { zoom: 20 } : {}),
    transition: first || reducedMotion() || !viewer.state.ready ? false : { speed: 420, rotation: false, effect: "fade" },
    showLoader: false,
    sphereCorrection: pic.sphere ?? {},
  });
  if (res === false || my !== S.token) return false;
  destroyFlat();
  q("#sv-note").dataset.fallback = "";
  renderNote(pic);
  return true;
}

async function showFlat(pic, my, fallbackNote) {
  // The sharper picture loads when zooming in; the nav's loading bar shows it is on its way.
  S.flat ??= createFlat(S.stage, scheduleView, (on) => q(".sv-nav")?.classList.toggle("is-busy", on || S.busy));
  const ok = await S.flat.load(pic);
  if (!ok || my !== S.token) return false;
  destroyPSV();
  q("#sv-note").dataset.fallback = fallbackNote ?? "";
  renderNote(pic);
  return true;
}

const placeCache = new Map();
/** The street name at a picture's spot (Photon reverse), asked once per spot. */
function placeOf(pic) {
  const key = `${pic.lat.toFixed(5)},${pic.lng.toFixed(5)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const req = getJSON(`${PHOTON}/reverse?lat=${pic.lat.toFixed(5)}&lon=${pic.lng.toFixed(5)}&lang=en&limit=1`, { timeout: 8000 }).then((d) => {
    const p = d.features?.[0]?.properties;
    return p ? { title: p.street ?? p.name ?? null, area: [p.district ?? p.locality, p.city, p.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== (p.street ?? p.name)).join(", ") } : null;
  });
  req.catch(() => placeCache.delete(key));
  return remember(placeCache, key, req, 200);
}
/** The globe behind the viewer follows the picture (unseen), so the link's camera matches its
 *  sv= and closing lands on a map that has already loaded. */
function followOnMap(pic) {
  const m = app.map, c = m.getCenter();
  if (m.getZoom() >= 17 && distM([c.lng, c.lat], [pic.lng, pic.lat]) < 1) return;
  m.jumpTo({ center: [pic.lng, pic.lat], zoom: Math.max(m.getZoom(), 17) });
}

/** Background work once a picture is on screen: neighbours, other dates, the street name, sequence size. */
function afterShow(pic, my) {
  for (const dir of ["next", "prev"]) {
    const ref = pic[dir];
    if (!ref) continue;
    fetchItem(pic.collection, ref.id).then((f) => {
      if (dir === "next" && my === S.token) { const n = toPic(f); if (n.sd) new Image().src = n.sd; }
    }).catch(() => {});
  }
  const key = datesKey(pic);
  if (key !== S.datesKey) {
    S.datesKey = key;
    otherDates(pic);
  }
  // The street name is looked up for every picture, so a step and a reload of the same
  // picture agree; until it answers, the last name (if near) stays.
  placeOf(pic).then((place) => {
    if (!S.open || S.pic?.id !== pic.id) return;
    S.place = place;
    S.placeAt = [pic.lng, pic.lat];
    renderTitle(pic);
  }).catch(() => {});
  if (pic.rank != null) {
    fetchSequence(pic.collection).then((c) => {
      const n = c?.["stats:items"]?.count;
      if (!S.open || S.pic?.id !== pic.id || !n) return;
      const dd = q('[data-row="sequence"]');
      const km = Number(c["geovisio:length_km"]);
      if (dd) dd.textContent = `Picture ${fmt(pic.rank)} of ${fmt(n)}${km > 0 ? ` · ${distLabel(km * 1000)}` : ""}`;
    }).catch(() => {});
  }
}

function setDatesStale(on) {
  q("#sv-dates").classList.toggle("is-stale", on);
  for (const b of q("#sv-chips").children) b.disabled = on;
}
/** Other dates are looked up again after moving ~10 m or switching to another sequence. */
const datesKey = (pic) => `${pic.collection}|${pic.lng.toFixed(4)},${pic.lat.toFixed(4)}`;
async function otherDates(pic) {
  const key = datesKey(pic), box = q("#sv-dates");
  // Chips from the previous spot stay in place, inert, until the answer: no jump in the card.
  setDatesStale(true);
  const near = await nearby(pic.lng, pic.lat, 18, { limit: 60 }).catch(() => null);
  if (!S.open || S.datesKey !== key) return;
  setDatesStale(false);
  if (!near) { S.datesKey = null; box.hidden = true; return; }
  // One chip per capture day (the nearest picture of that day); another sequence shot the
  // same day as this picture is not another date.
  const day = (p) => { const s = parseStamp(p.datetz ?? p.date); return s ? s.wall.toISOString().slice(0, 10) : null; };
  const here = day(pic), byDay = new Map();
  for (const x of near) {
    if (x.f.collection === pic.collection) continue;
    const p = toPic(x.f), d = day(p);
    if (d && d !== here && !byDay.has(d)) byDay.set(d, p);
  }
  const list = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([, p]) => p);
  S.datesAt = [pic.lng, pic.lat];
  box.hidden = !list.length;
  if (!list.length) return;
  const chips = q("#sv-chips");
  const month = (p) => captured(p)?.short ?? p.date.slice(0, 7);
  const months = [...list.map(month), month(pic)]; // a month shared with another chip or this picture shows the day
  chips.replaceChildren(...list.map((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip chip-btn chip-soft";
    const c = captured(p);
    const label = months.indexOf(months[i]) !== months.lastIndexOf(months[i]) ? c?.medium ?? p.date.slice(0, 10) : months[i];
    b.textContent = `${label}${p.is360 ? " · 360°" : ""}`;
    b.title = `${p.is360 ? "360° panorama" : "Photo"} captured ${c?.medium ?? p.date}${p.authors.length ? ` by ${p.authors.join(", ")}` : ""}`;
    b.onclick = () => show(p, { heading: currentHeading() });
    return b;
  }));
}

function sequenceEnd(dir) {
  announce(dir === "next" ? "This is the last picture of the sequence." : "This is the first picture of the sequence.");
  q(`#sv-${dir}`)?.animate?.([{ transform: "translateX(0)" }, { transform: `translateX(${dir === "next" ? 3 : -3}px)` }, { transform: "translateX(0)" }], { duration: reducedMotion() ? 0 : 220 });
}
/** Steps chain from the picture the previous step is heading to, so quick presses add up
 *  (three taps move three pictures) and only the last one is drawn. */
function step(dir) {
  if (!S.open || !S.pic) return;
  if (!S.stepTo && !S.pic[dir]) return sequenceEnd(dir);
  const heading = currentHeading();
  const my = ++S.token;
  setBusy(true);
  const target = (S.stepTo ?? Promise.resolve(S.pic)).then(async (base) => {
    const from = base ?? S.pic;
    const ref = from[dir];
    return ref ? { pic: toPic(await fetchItem(from.collection, ref.id)) } : { end: from };
  });
  const chain = target.then((t) => t.pic ?? t.end, () => null);
  S.stepTo = chain;
  chain.then(() => { if (S.stepTo === chain) S.stepTo = null; });
  target.then(async (t) => {
    if (my !== S.token) return;
    if (t.end) { setBusy(false); if (t.end !== S.pic) show(t.end, { heading, stepping: true }); else sequenceEnd(dir); return; }
    await show(t.pic, { heading, stepping: true });
  }, (err) => {
    if (my !== S.token) return;
    setBusy(false);
    app.ui.toast(`Could not load the ${dir === "next" ? "next" : "previous"} picture: ${failReason(err)}.`, { tone: "error" });
  });
}

/* ---------------------------------------------------------------- info panel */
function renderTitle(pic) {
  const title = S.place && S.placeAt && distM(S.placeAt, [pic.lng, pic.lat]) < 120 ? S.place : null;
  q("#sv-title").textContent = title?.title ?? (pic.is360 ? "360° panorama" : "Street-level photo");
  const when = captured(pic)?.medium;
  const date = document.createElement("span");
  date.className = "sv-nw"; // the date wraps as a whole
  date.textContent = when ?? "";
  q("#sv-sub").replaceChildren(title?.area || `${pic.lat.toFixed(5)}, ${pic.lng.toFixed(5)}`, ...(when ? [" · ", date] : []));
}
function renderNote(pic) {
  const fb = q("#sv-note").dataset.fallback;
  const sphere = pic.is360 && !fb;
  q("#sv-note").textContent = `${fb ? `${fb} ` : ""}${sphere ? "Drag to look around, scroll or pinch to zoom." : "Drag to pan, scroll or pinch to zoom."} Imagery: Panoramax contributors.${sphere ? " Viewer: Photo Sphere Viewer (MIT)." : ""} Map: © OpenStreetMap contributors, OpenFreeMap, OpenMapTiles. Street name: Photon (OpenStreetMap).`;
}
function renderInfo(pic) {
  if (!S.root) return;
  if (!pic) {
    q("#sv-kind").textContent = "Street level";
    q("#sv-title").textContent = "Street level";
    q("#sv-sub").textContent = "Panoramax";
    q("#sv-kv").replaceChildren();
    q("#sv-dates").hidden = true;
    q("#sv-link").hidden = true;
    q("#sv-credit").textContent = "";
    q("#sv-prev").disabled = q("#sv-next").disabled = true;
    return;
  }
  const when = captured(pic);
  const lic = licence(pic);
  q("#sv-kind").textContent = `Street level · ${pic.is360 ? "360° panorama" : "Photo"}`;
  renderTitle(pic);
  const rows = [
    ["Captured", when ? `${when.long}${when.time ? `, ${when.time}` : ""}` : "Date not recorded"],
    ["By", pic.authors.join(" · ") || "Not stated"],
    ["Licence", lic.url ? `<a class="link-ul" href="${esc(lic.url)}" target="_blank" rel="noopener">${esc(lic.label)}</a>` : esc(lic.label), true],
    pic.camera && ["Camera", pic.camera],
    pic.instance && ["Hosted by", `<a class="link-ul" href="${esc(pic.instance.url)}" target="_blank" rel="noopener">${esc(hostOf(pic.instance.url))}</a>`, true],
    pic.rank != null && ["Sequence", `Picture ${fmt(pic.rank)}`, false, "sequence"],
    ["Position", `${pic.lat.toFixed(5)}, ${pic.lng.toFixed(5)}${pic.heading != null ? ` · camera heading ${Math.round(pic.heading)}°` : ""}`],
  ].filter(Boolean);
  q("#sv-kv").innerHTML = rows.map(([k, v, html, key]) => `<dt>${esc(k)}</dt><dd${key ? ` data-row="${key}"` : ""}>${html ? v : esc(v)}</dd>`).join("");
  const link = q("#sv-link");
  link.hidden = false;
  link.href = pageUrl(pic);
  q("#sv-credit").textContent = `© ${pic.authors[0] ?? "Panoramax contributor"} · ${lic.label} · Panoramax${when ? ` · ${when.medium}` : ""}`;
  q("#sv-prev").disabled = !pic.prev;
  q("#sv-next").disabled = !pic.next;
  if (!S.datesAt || distM(S.datesAt, [pic.lng, pic.lat]) > 60) q("#sv-dates").hidden = true;
  renderNote(pic);
}

/* ---------------------------------------------------------------- heading, cone, controls */
/** Where the viewer looks. heading is null when the picture carries no camera direction:
 *  the compass then says so and the cones shrink to a position dot. */
function currentView() {
  const pic = S.pic;
  if (!pic) return null;
  const az = pic.heading;
  const toward = (offset) => (az == null ? null : norm360(az + offset));
  if (S.psv?.state?.ready) {
    const p = S.psv.getPosition();
    return { heading: toward(p.yaw / rad), fov: S.psv.state.hFov ?? 90, pitch: p.pitch };
  }
  if (S.flat) {
    const v = S.flat.view();
    const fov = pic.is360 ? 360 : pic.fov ?? 70;
    return { heading: toward(v.offset * fov), fov: fov * v.frac, pitch: 0 };
  }
  return { heading: toward(0), fov: pic.is360 ? 90 : pic.fov ?? 70, pitch: 0 };
}
const currentHeading = () => currentView()?.heading ?? null;

function scheduleView() {
  if (S.raf) return;
  S.raf = requestAnimationFrame(() => { S.raf = 0; updateView(); });
}
function updateView() {
  if (!S.pic || !S.root) return;
  const v = currentView();
  if (!v) return;
  const h = v.heading, known = h != null;
  const btn = q("#sv-heading");
  q(".sv-needle")?.setAttribute("transform", `rotate(${known ? (-h).toFixed(1) : 0} 13 13)`);
  btn.classList.toggle("is-unknown", !known);
  q("#sv-heading-t").textContent = known ? `${compass8(h)} ${Math.round(h)}°` : "—";
  btn.setAttribute("aria-label", known ? `Facing ${compass8(h)}, ${Math.round(h)} degrees. Face north` : "Camera direction not recorded");
  btn.title = known ? "Face north" : "This picture does not record which way the camera faced";
  btn.disabled = !S.psv || !known;
  if (S.mini) {
    // A DOM marker, not a GeoJSON source: it follows every drag without a worker round trip.
    S.coneEl ??= miniConeEl();
    S.cone ??= new app.maplibregl.Marker({ element: S.coneEl, rotationAlignment: "map", pitchAlignment: "map" });
    const r = Math.min(52, S.mini.getContainer().clientHeight * 0.34);
    S.coneEl.querySelector("path").setAttribute("d", known ? wedgePath(v.fov, r) : "");
    S.cone.setLngLat([S.pic.lng, S.pic.lat]).setRotation(known ? h : 0).addTo(S.mini);
  }
}
function miniConeEl() {
  const el = document.createElement("div");
  el.className = "sv-mini-cone";
  el.innerHTML = '<svg width="120" height="120" viewBox="-60 -60 120 120" aria-hidden="true"><path/><circle r="6.5"/></svg>';
  return el;
}
function wedgePath(fov, r) {
  const a = (clamp(fov, 8, 340) * rad) / 2, x = Math.sin(a) * r, y = -Math.cos(a) * r;
  return `M0 0L${(-x).toFixed(1)} ${y.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 ${a > Math.PI / 2 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)}Z`;
}
function updateMainCone(pic, v) {
  const m = app.map;
  if (!pic || !v || !app.layers.isOn("streetview")) return;
  ensureCone(m);
  if (!m.getSource("sv-cone")) return;
  if (coneFov == null || Math.abs(coneFov - v.fov) > 3) { m.updateImage("sv-cone-img", coneImage(v.fov)); coneFov = v.fov; }
  const props = v.heading == null ? {} : { heading: v.heading }; // no direction, no cone: just the dot
  m.getSource("sv-cone").setData({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [pic.lng, pic.lat] } });
}

function look(dx, dy) {
  if (S.psv?.state?.ready) {
    const p = S.psv.getPosition();
    const to = { yaw: p.yaw + dx * 30 * rad, pitch: clamp(p.pitch + dy * 15 * rad, -Math.PI / 2, Math.PI / 2) };
    if (reducedMotion()) S.psv.rotate(to); else S.psv.animate({ ...to, speed: 320 });
  } else S.flat?.pan(-dx * 120, dy * 120);
}
function zoom(dir) {
  if (S.psv?.state?.ready) {
    const z = clamp(S.psv.getZoomLevel() + dir * 18, 0, 100);
    if (reducedMotion()) S.psv.zoom(z); else S.psv.animate({ zoom: z, speed: 260 });
  } else S.flat?.zoomBy(dir > 0 ? 1.5 : 1 / 1.5);
}
function faceNorth() {
  if (!S.psv?.state?.ready || S.pic?.heading == null) return;
  const yaw = -(S.pic.heading ?? 0) * rad;
  if (reducedMotion()) S.psv.rotate({ yaw, pitch: 0 }); else S.psv.animate({ yaw, pitch: 0, speed: 600 });
}

/* ---------------------------------------------------------------- mini-map */
function miniStyle() {
  const roads = ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "street", "path", "track"], true, false];
  const roadWidth = (k) => ["interpolate", ["exponential", 1.6], ["zoom"], 13, 0.6 * k, 16, 3.2 * k, 19, 16 * k];
  const seq = (extra) => ["interpolate", ["exponential", 1.5], ["zoom"], 13, 1.4 + extra, 16, 3 + extra, 19, 6 + extra];
  return {
    version: 8,
    sources: {
      ofm: { type: "vector", url: OFM },
      ...Object.fromEntries(LINE_BANDS.map((b) => [b.key, { type: "vector", tiles: [b.tiles], minzoom: b.tileZoom[0], maxzoom: b.tileZoom[1] }])),
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f6f5f2" } }, // --surface
      { id: "green", type: "fill", source: "ofm", "source-layer": "park", paint: { "fill-color": "#dfe9d6" } },
      { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": "#c6d9e6" } },
      { id: "bld", type: "fill", source: "ofm", "source-layer": "building", minzoom: 14.5, paint: { "fill-color": "#e3e0da", "fill-outline-color": "#d6d2ca" } },
      { id: "road-case", type: "line", source: "ofm", "source-layer": "transportation", filter: roads, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d9d5cd", "line-width": roadWidth(1.25) } },
      { id: "road", type: "line", source: "ofm", "source-layer": "transportation", filter: roads, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": roadWidth(1) } },
      ...LINE_BANDS.flatMap((b) => {
        const common = { type: "line", source: b.key, "source-layer": "sequences", minzoom: b.show[0], ...(b.show[1] ? { maxzoom: b.show[1] } : {}), layout: { ...(b.key === "hi" ? { "line-cap": "round", "line-join": "round" } : { "line-join": "bevel" }), "line-sort-key": SORT_360 } };
        return [
          { id: `sv-${b.key}`, ...common, paint: { "line-color": BY_TYPE, "line-width": seq(0), "line-opacity": 0.9 } },
          { id: `sv-hit-${b.key}`, ...common, paint: { "line-color": "#000", "line-width": 16, "line-opacity": 0 } },
        ];
      }),
    ],
  };
}
function ensureMini(pic) {
  if (!S.open || S.mini) { if (pic) centerMini(pic); return; }
  const el = q("#sv-mini-map");
  if (!el?.clientWidth) return;
  const c = pic ? [pic.lng, pic.lat] : app.map.getCenter().toArray();
  const mini = new app.maplibregl.Map({
    container: el, style: miniStyle(), center: c, zoom: 17.2, minZoom: 13, maxZoom: 19,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false,
    fadeDuration: 0, canvasContextAttributes: { antialias: true },
  });
  mini.touchZoomRotate.disableRotation();
  // Pointer-only (its keyboard handler is off); the container carries the description.
  const cv = mini.getCanvas();
  cv.tabIndex = -1;
  cv.setAttribute("aria-hidden", "true");
  mini.on("zoom", scheduleView);
  mini.on("click", (e) => pickAt(e.lngLat, { zoom: mini.getZoom() }));
  mini.on("mousemove", (e) => {
    const hit = mini.queryRenderedFeatures(e.point, { layers: LINE_BANDS.map((b) => `sv-hit-${b.key}`).filter((id) => mini.getLayer(id)) }).length;
    mini.getCanvas().style.cursor = hit ? "pointer" : "";
  });
  S.mini = mini;
}
function centerMini(pic) {
  if (!S.mini || !pic) return;
  const to = [pic.lng, pic.lat];
  if (reducedMotion()) S.mini.jumpTo({ center: to }); else S.mini.easeTo({ center: to, duration: 450 });
}
function destroyMini() {
  S.cone?.remove();
  S.cone = null;
  try { S.mini?.remove(); } catch {}
  S.mini = null;
}

/* ---------------------------------------------------------------- keyboard */
function trapTab(e) {
  const sel = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const f = [...S.root.querySelectorAll(sel)].filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden");
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
}
function onKey(e) {
  if (S.open) {
    // The rest of the app (map shortcuts, Esc closing cards) stays inert under the viewer.
    e.stopPropagation();
    if (e.key === "Tab") return trapTab(e);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case "Escape": close(); break;
      case "ArrowLeft": if (e.shiftKey) look(-1, 0); else if (!(e.repeat && S.busy)) step("prev"); break;
      case "ArrowRight": if (e.shiftKey) look(1, 0); else if (!(e.repeat && S.busy)) step("next"); break;
      case "ArrowUp": look(0, 1); break;
      case "ArrowDown": look(0, -1); break;
      case "+": case "=": zoom(1); break;
      case "-": case "_": zoom(-1); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    return;
  }
  if (S.pick && e.key === "Escape") { e.stopPropagation(); e.preventDefault(); cancelPick(); }
}

/* ---------------------------------------------------------------- agent tools */
function summary(pic, from) {
  const lic = licence(pic);
  return {
    id: pic.id,
    lat: +pic.lat.toFixed(6), lng: +pic.lng.toFixed(6),
    ...(from ? { distance_m: Math.round(distM(from, [pic.lng, pic.lat])) } : {}),
    captured: pic.datetz ?? pic.date ?? null,
    kind: pic.is360 ? "360° panorama" : "flat photo",
    heading_deg: pic.heading,
    field_of_view_deg: pic.fov,
    camera: pic.camera || null,
    author: pic.authors.join(", ") || null,
    licence: pic.license ?? null,
    licence_name: lic.label,
    licence_url: lic.url,
    hosted_by: pic.instance?.url ?? null,
    sequence_id: pic.collection,
    view_url: pageUrl(pic),
    image_url: pic.sd,
    thumbnail_url: pic.thumb,
  };
}
/** A place name to a point. Photon is asked without a location bias: search_places favours the
 *  current view, so from Paris "Lyon" would be an artwork on a Paris street, not the city. */
async function geocode(place) {
  try {
    const d = await getJSON(`${PHOTON}/api/?q=${encodeURIComponent(place)}&limit=1&lang=en`, { timeout: 10000 });
    const f = d.features?.[0];
    if (f) {
      const p = f.properties ?? {};
      const where = [p.city, p.state, p.country].filter((x, i, a) => x && x !== p.name && a.indexOf(x) === i).join(", ");
      return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: `${p.name ?? place}${where ? `, ${where}` : ""}` };
    }
  } catch {}
  const hit = (await app.tools.run("search_places", { query: place, limit: 1 }).catch(() => null))?.results?.[0];
  return hit ? { lat: hit.lat, lng: hit.lng, label: hit.name } : null;
}
async function resolvePoint({ lat, lng, place }) {
  if (lat != null || lng != null) {
    const la = Number(lat), lo = Number(lng);
    if (lat == null || lng == null || lat === "" || lng === "" || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      throw new Error("lat and lng must both be numbers (lat -90 to 90, lng -180 to 180).");
    }
    return { lat: la, lng: lo, label: null };
  }
  if (place && String(place).trim()) {
    const hit = await geocode(String(place).trim());
    if (!hit) throw new Error(`Could not find "${place}".`);
    return hit;
  }
  const c = app.map.getCenter();
  return { lat: c.lat, lng: c.lng, label: "the centre of the view" };
}
const SOURCE_NOTE = "Panoramax meta-catalogue search API (api.panoramax.xyz); licence per picture";
/** Why a requested heading could not be honoured, if it could not. */
function headingNote(pic, heading) {
  if (heading == null) return {};
  if (pic.heading == null) return { heading_note: "This picture does not record which way the camera faced, so heading_deg was not applied." };
  if (!pic.is360) return { heading_note: `heading_deg only turns 360° panoramas; this flat photo faces ${Math.round(pic.heading)}°.` };
  return {};
}

function defineTools() {
  const placeWords = "(?:\\s+(?:of|at|in|near|on|for|around|from)\\s+(.+?))?";
  app.tools.define("find_street_imagery", {
    description:
      "Find street-level pictures near a point from Panoramax, the open federated street-level imagery commons. Returns the nearest pictures (nearest first) with capture date, 360° panorama or flat photo, heading, camera, author, licence, a link to view each on panoramax.xyz and image URLs. Give lat+lng, or a place name to look up; with neither it searches around the centre of the view. radius_m defaults to 100 (max 2000). Does not open the viewer: use open_street_view for that.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" }, lng: { type: "number" },
        place: { type: "string", description: "Place to look up when lat/lng are not given." },
        radius_m: { type: "number", description: "Search radius in metres (default 100, max 2000)." },
        limit: { type: "number", description: "Max pictures to return (default 10, max 50)." },
      },
    },
    async run({ lat, lng, place, radius_m = 100, limit = 10 }) {
      let pt;
      try { pt = await resolvePoint({ lat, lng, place }); } catch (err) { return { ok: false, error: err.message }; }
      const radius = clamp(Number(radius_m) || 100, 5, 2000);
      const max = clamp(Math.round(Number(limit) || 10), 1, 50);
      let hits;
      try { hits = await nearby(pt.lng, pt.lat, radius, { limit: Math.min(100, max * 2) }); } catch (err) { return { ok: false, error: `${apiReason(err)} (${err.message}).` }; }
      const pictures = hits.slice(0, max).map((h) => summary(toPic(h.f), [pt.lng, pt.lat]));
      return {
        ok: true,
        near: { lat: +pt.lat.toFixed(6), lng: +pt.lng.toFixed(6), ...(pt.label ? { place: pt.label } : {}) },
        radius_m: radius,
        count: pictures.length,
        pictures,
        ...(pictures.length ? {} : { note: `No Panoramax pictures within ${fmt(radius)} m. Try a larger radius_m.` }),
        source: SOURCE_NOTE,
        retrieved_at: new Date().toISOString(),
      };
    },
    local: {
      examples: ["is there street view in Lyon?"],
      patterns: [new RegExp(`^(?:find|search(?: for)?|list|any|is there|are there)\\s+(?:any\\s+)?street[- ]?(?:view|level)\\s*(?:imagery|photos?|pictures?|coverage)?${placeWords}(?:\\s+here)?\\s*[?.!]*$`, "i")],
      parse: (m) => (m[1] ? { place: m[1].trim(), radius_m: 250 } : { radius_m: 250 }),
    },
  });

  app.tools.define("open_street_view", {
    description:
      "Open the full-screen street-level viewer (Panoramax) at the picture nearest a point: a 360° panorama to look around in, or a flat photo to pan and zoom. Steps along the picture's sequence with the arrow keys and draws the camera's view cone on the map. Give lat+lng, a place name, or a picture_id from find_street_imagery; with none it uses the centre of the view. Optional heading_deg faces a compass direction (0 = north). Searches up to radius_m (default 250, max 2000).",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" }, lng: { type: "number" },
        place: { type: "string", description: "Place to look up when lat/lng are not given." },
        picture_id: { type: "string", description: "A Panoramax picture id (from find_street_imagery)." },
        heading_deg: { type: "number" },
        radius_m: { type: "number" },
      },
    },
    async run({ lat, lng, place, picture_id, heading_deg, radius_m = 250 }) {
      const heading = heading_deg != null && heading_deg !== "" && Number.isFinite(Number(heading_deg)) ? norm360(Number(heading_deg)) : null;
      if (picture_id) {
        let f;
        try { f = await pictureById(picture_id); } catch (err) { return { ok: false, error: err.message }; }
        const pic = toPic(f);
        openOverlay(pic);
        show(pic, { first: true, heading });
        return { ok: true, opened: summary(pic), ...headingNote(pic, heading), source: SOURCE_NOTE };
      }
      let pt;
      try { pt = await resolvePoint({ lat, lng, place }); } catch (err) { return { ok: false, error: err.message }; }
      const radius = clamp(Number(radius_m) || 250, 5, 2000);
      let hit;
      try { hit = await findNearest(pt.lng, pt.lat, radius); } catch (err) { return { ok: false, error: `${apiReason(err)} (${err.message}).` }; }
      if (!hit) return { ok: false, error: `No street-level pictures within ${distLabel(reach(radius))} of ${pt.label ?? `${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}`}.` };
      const pic = toPic(hit.f);
      openOverlay(pic);
      show(pic, { first: true, heading, lookAt: heading == null && hit.d > 8 && hit.d < 400 ? [pt.lng, pt.lat] : null });
      return { ok: true, near: pt.label ?? undefined, opened: summary(pic, [pt.lng, pt.lat]), ...headingNote(pic, heading), source: SOURCE_NOTE };
    },
    local: {
      examples: ["street view of Montmartre", "street view here", "street view"],
      patterns: [
        new RegExp(`^(?:open |show(?: me)? |enter |start |launch |go to |take me to )?(?:the |a )?street[- ]?(?:view|level)(?:\\s+(?:view|imagery|photos?|pictures?|mode))?${placeWords}(?:\\s+here)?\\s*[?.!]*$`, "i"),
        new RegExp(`^show me the streets?${placeWords}(?:\\s+here)?\\s*[?.!]*$`, "i"),
        /^look around(?:\s+here)?\s*[?.!]*$/i,
      ],
      parse: (m) => (m[1] ? { place: m[1].trim() } : {}),
    },
  });

  app.tools.define("close_street_view", {
    description: "Close the street-level viewer if it is open (the map lands where the viewer ended).",
    input_schema: { type: "object", properties: {} },
    async run() {
      const was = S.open;
      const pic = S.pic;
      close();
      return { ok: true, was_open: was, ...(was && pic ? { last_picture: { id: pic.id, lat: pic.lat, lng: pic.lng } } : {}) };
    },
    local: { examples: ["close street view"], patterns: [/^(?:close|exit|leave|quit)\s+(?:the\s+)?street[- ]?(?:view|level)\s*[.!]*$/i], parse: () => ({}) },
  });
}

/* ---------------------------------------------------------------- init */
export function init() {
  registerThinProtocol();
  app.layers.define({
    id: "streetview",
    title: "Street-level imagery",
    category: "Street level",
    description: "Where open street-level pictures exist, from Panoramax. Zoomed out, dots mark where pictures exist (larger where there are more); from regional zoom, lines are picture sequences and dots are single pictures up close. Deep blue: 360° panoramas, light blue: flat photos. Click a line, or use the Street view button, to look around.",
    keywords: ["street view", "street level", "streetview", "panorama", "panoramas", "360", "photos", "pictures", "panoramax", "look around", "pegman", "streets"],
    source: "Panoramax — the open, federated street-level imagery commons (api.panoramax.xyz)",
    attribution: "Street-level imagery: Panoramax contributors (licence per picture)",
    license: "Per picture, mostly Etalab Open Licence 2.0 or CC BY-SA 4.0; coverage tiles by Panoramax",
    kind: "vector",
    slot: "data",
    legend: `<div class="sv-legend"><span><i class="sv-sw" style="background:${C360}"></i>360° panoramas</span><span><i class="sv-sw" style="background:${CFLAT}"></i>Flat photos</span><span><i class="sv-sw sv-sw-dot" style="background:${C360}"></i>Pictures in the area (zoomed out)</span></div>`,
    add: (m) => addCoverage(m),
    remove: (m) => removeCoverage(m),
  });
  defineTools();
  buildControl();

  const m = app.map;
  m.on("click", onMapClick);
  let pending = null;
  m.on("mousemove", (e) => {
    if (!pending) requestAnimationFrame(() => { const ev = pending; pending = null; hover(ev); });
    pending = e;
  });
  // The after view ends once the map has moved on from the spot.
  m.on("moveend", () => {
    if (!S.afterView || S.open || !S.afterAt) return;
    const c = m.getCenter();
    if (m.getZoom() < 12 || distM(S.afterAt, [c.lng, c.lat]) > 1000) endAfterView();
  });
  m.on("mouseout", () => { if (S.hovering) { S.hovering = false; m.getCanvas().style.cursor = ""; } hidePopup(); });
  window.addEventListener("keydown", onKey, true);
  app.on("mode:claim", (name) => { if (name !== "streetview" && S.pick) cancelPick(); });

  app.streetview = {
    openAt: (lat, lng, opts) => app.tools.run("open_street_view", { lat, lng, ...opts }),
    close,
    isOpen: () => S.open,
    current: () => (S.pic ? summary(S.pic) : null),
  };
}
