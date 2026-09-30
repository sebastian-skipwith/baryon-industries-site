// Tools: Google Earth's toolbox. Measure distance and area along great circles with an
// elevation profile; keep My places (pins, saved views, measured paths and areas); bring
// your own GeoJSON / KML / KMZ / GPX; share links and embeds; screenshots; full screen
// and keyboard shortcuts. Everything a visitor saves or imports stays in their browser.
import { app, $, esc, fmt, clamp, getJSON, haversineKm, syncHash } from "./core.js";
import { elevationAt, elevations, ELEVATION_SOURCE } from "./elevation.js";

const R_KM = 6371.0088;
const RAD = Math.PI / 180;
const PLACES_KEY = "baryon.world.places.v1";
const SHOW_KEY = "baryon.world.places.show.v1";
const UNITS_KEY = "baryon.world.units.v1";
const HIDDEN_KEY = "baryon.world.imports.hidden.v1";
const IDB_NAME = "baryon.world.tools";
const IDB_STORE = "imports";
// fflate 0.8.2 (MIT): jsDelivr serves the ESM build with Access-Control-Allow-Origin: *.
const FFLATE = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_PATH_POINTS = 2000;
const EMPTY = { type: "FeatureCollection", features: [] };
// Data colours for imported files: bright on satellite imagery, never the live accent.
const USER_COLORS = ["#ffd60a", "#4cc9f0", "#80ed99", "#ff8fab", "#b8c0ff", "#ffb86b"];
const PIN_DEFAULT = "Dropped pin";
const OSM_NAME = "Name from OpenStreetMap (© contributors, ODbL) via Photon.";
const isPhone = () => matchMedia("(max-width: 720px)").matches;
const coarse = () => matchMedia("(pointer: coarse)").matches;
const canHover = () => matchMedia("(hover: hover)").matches;

const icon = (d, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  ruler: '<path d="M3.8 15.6 15.6 3.8a1 1 0 0 1 1.4 0l3.2 3.2a1 1 0 0 1 0 1.4L8.4 20.2a1 1 0 0 1-1.4 0l-3.2-3.2a1 1 0 0 1 0-1.4z"/><path d="m7.6 12.4 1.8 1.8M10.6 9.4l1.8 1.8M13.6 6.4l1.8 1.8"/>',
  pin: '<path d="M12 21c-3.6-3.5-6.5-6.9-6.5-10.5a6.5 6.5 0 0 1 13 0c0 3.6-2.9 7-6.5 10.5z"/><circle cx="12" cy="10.5" r="2.3"/>',
  share: '<path d="M12 14.8V3.8M8.2 7.4 12 3.6l3.8 3.8"/><path d="M8.2 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5h-1.7"/>',
  camera: '<path d="M3.5 9A1.5 1.5 0 0 1 5 7.5h2.3L8.8 5h6.4l1.5 2.5H19A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/><circle cx="12" cy="13" r="3.4"/>',
  expand: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>',
  bookmark: '<path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21L12 17l-5.5 4z"/>',
  keep: '<path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21L12 17l-5.5 4z"/><path d="M12 7.2v5.6M9.2 10h5.6"/>',
  view: '<path d="M2.8 12s3.4-6.3 9.2-6.3 9.2 6.3 9.2 6.3-3.4 6.3-9.2 6.3S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  path: '<circle cx="5.5" cy="18" r="1.8"/><circle cx="18.5" cy="6" r="1.8"/><path d="M6.8 16.6 11 12l2.6 2.6 3.7-7.2"/>',
  area: '<path d="M5.5 7.5 13 4l6.5 5.5-2.5 9.5H7z"/>',
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m13.5 8.5 3 3"/>',
  trash: '<path d="M4.5 7h15M10 7V4.8h4V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 15.5V4M7.8 8.2 12 4l4.2 4.2"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v11.5M7.8 11.3 12 15.5l4.2-4.2"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  frame: '<path d="M4 8.5v-3A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3"/><circle cx="12" cy="12" r="2.5"/>',
};

/* ================================================================ storage */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

let idbPromise = null;
function idbOpen() {
  idbPromise ??= new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("storage blocked"));
    } catch (err) { reject(err); }
  });
  return idbPromise;
}
async function idb(mode, fn) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("storage aborted"));
  });
}

/* ================================================================ geometry */
const F = (type, coordinates, properties = {}) => ({ type: "Feature", properties, geometry: { type, coordinates } });
const fc = (features) => ({ type: "FeatureCollection", features });
const vec = ([lng, lat]) => { const l = lng * RAD, p = lat * RAD; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
const unvec = ([x, y, z]) => [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];

function greatCircle(a, b, stepKm) {
  const d = haversineKm(a, b);
  const n = Math.min(256, Math.ceil(d / stepKm));
  const omega = d / R_KM, so = Math.sin(omega);
  if (n < 2 || so < 1e-9) return [a, b];
  const va = vec(a), vb = vec(b), out = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n, ka = Math.sin((1 - t) * omega) / so, kb = Math.sin(t * omega) / so;
    out.push(unvec([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]]));
  }
  out.push(b);
  return out;
}
// Consecutive longitudes stay within 180° so a leg across the antimeridian draws the short way.
function unwrap(line) {
  const out = [];
  for (const [lng0, lat] of line) {
    let lng = lng0;
    if (out.length) {
      const prev = out[out.length - 1][0];
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    out.push([lng, lat]);
  }
  return out;
}
/** A path as it lies on the globe: every leg densified along its great circle. */
function geodesic(points, stepKm = 20) {
  if (points.length < 2) return points.map((p) => p.slice());
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) out.push(...greatCircle(points[i - 1], points[i], stepKm).slice(1));
  return unwrap(out);
}
const midpoint = (a, b) => { const va = vec(a), vb = vec(b); return unvec([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]); };
function centroid(pts) {
  const s = [0, 0, 0];
  for (const p of pts) { const v = vec(p); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return unvec(s);
}
const pathKm = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += haversineKm(pts[i - 1], pts[i]); return s; };
/** Area (km²) on the sphere of a ring whose edges follow great circles: the spherical
 *  excess summed over a fan of triangles (Van Oosterom & Strackee), exact for great-circle
 *  edges, across the antimeridian and round a pole. The smaller of the two regions it bounds. */
function areaKm2(pts) {
  if (pts.length < 3) return 0;
  const v = pts.map(vec), a = v[0];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  let e = 0;
  for (let i = 1; i < v.length - 1; i++) {
    const b = v[i], c = v[i + 1];
    const triple = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    e += 2 * Math.atan2(triple, 1 + dot(a, b) + dot(b, c) + dot(c, a));
  }
  e = Math.abs(e);
  return Math.min(e, 4 * Math.PI - e) * R_KM * R_KM;
}
/** A shape's outline for a fill layer; one that winds round a pole is closed over that pole. */
function fillRing(pts) {
  const ring = geodesic([...pts, pts[0]]);
  if (Math.abs(ring[ring.length - 1][0] - ring[0][0]) < 180) return ring;
  const pole = pts.reduce((s, p) => s + p[1], 0) >= 0 ? 90 : -90;
  return [...ring, [ring[ring.length - 1][0], pole], [ring[0][0], pole], ring[0]];
}
function bboxOf(coords, box = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (!Array.isArray(coords)) return box;
  if (typeof coords[0] === "number") {
    if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      box[0] = Math.min(box[0], coords[0]); box[1] = Math.min(box[1], coords[1]);
      box[2] = Math.max(box[2], coords[0]); box[3] = Math.max(box[3], coords[1]);
    }
    return box;
  }
  for (const c of coords) bboxOf(c, box);
  return box;
}
/** Bounding box that takes the short way across the antimeridian when that is tighter
 *  ([west, south, east, north]; east may then exceed 180, which fitBounds understands). */
function geoBox(list) {
  const a = [Infinity, Infinity, -Infinity, -Infinity], b = [Infinity, -Infinity];
  const visit = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] !== "number") { for (const x of c) visit(x); return; }
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
    const lng = ((c[0] + 540) % 360) - 180, alt = lng < 0 ? lng + 360 : lng;
    a[0] = Math.min(a[0], lng); a[2] = Math.max(a[2], lng); a[1] = Math.min(a[1], c[1]); a[3] = Math.max(a[3], c[1]);
    b[0] = Math.min(b[0], alt); b[1] = Math.max(b[1], alt);
  };
  for (const c of list) visit(c);
  if (b[1] - b[0] < a[2] - a[0] - 1e-9) {
    [a[0], a[2]] = b[0] >= 180 ? [b[0] - 360, b[1] - 360] : [b[0], b[1]];
  }
  return a;
}
/** Imported lines and rings keep every step under 180° of longitude, so a route across the
 *  antimeridian is drawn the short way instead of round the whole globe. */
function unwrapGeom(g) {
  const jumps = (l) => l.some((p, i) => i > 0 && Math.abs(p[0] - l[i - 1][0]) > 180);
  const line = (l) => (jumps(l) ? unwrap(l) : l);
  const poly = (rings) => {
    const out = rings.map(line), ref = out[0]?.[0]?.[0];
    return out.map((r, i) => {
      const d = i && ref != null && r.length ? Math.round((ref - r[0][0]) / 360) * 360 : 0;
      return d ? r.map(([x, y]) => [x + d, y]) : r;
    });
  };
  switch (g.type) {
    case "LineString": return { type: g.type, coordinates: line(g.coordinates) };
    case "MultiLineString": return { type: g.type, coordinates: g.coordinates.map(line) };
    case "Polygon": return { type: g.type, coordinates: poly(g.coordinates) };
    case "MultiPolygon": return { type: g.type, coordinates: g.coordinates.map(poly) };
    default: return g;
  }
}
function thin(line, max) {
  if (line.length <= max) return line;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(line[Math.round((i * (line.length - 1)) / (max - 1))]);
  out.push(line[line.length - 1]);
  return out;
}
const okLL = (c) => Array.isArray(c) && Number.isFinite(+c[0]) && Number.isFinite(+c[1]) && Math.abs(+c[1]) <= 90 && Math.abs(+c[0]) <= 540;
const round6 = ([a, b]) => [+(+a).toFixed(6), +(+b).toFixed(6)];

/* ================================================================ units + formatting */
let units = "metric";
const imperial = () => units === "imperial";
const num = (v, d) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function lenParts(km) {
  if (imperial()) {
    const mi = km * 0.621371192;
    if (mi < 0.1) return [num(km * 3280.839895, 0), "ft"];
    return [num(mi, mi < 10 ? 2 : mi < 1000 ? 1 : 0), "mi"];
  }
  if (km < 1) return [num(km * 1000, 0), "m"];
  return [num(km, km < 10 ? 2 : km < 1000 ? 1 : 0), "km"];
}
function areaParts(km2) {
  if (imperial()) {
    const mi2 = km2 * 0.386102159, ac = km2 * 247.105381;
    if (mi2 < 1) return [num(ac, ac < 10 ? 2 : ac < 1000 ? 1 : 0), "acres"];
    return [num(mi2, mi2 < 10 ? 2 : mi2 < 1000 ? 1 : 0), "mi²"];
  }
  if (km2 < 0.01) return [num(km2 * 1e6, 0), "m²"];
  if (km2 < 1) return [num(km2 * 100, 2), "ha"];
  return [num(km2, km2 < 10 ? 2 : km2 < 1000 ? 1 : 0), "km²"];
}
const lenText = (km) => lenParts(km).join(" ");
const areaText = (km2) => areaParts(km2).join(" ");
const elevText = (m) => (m == null || !Number.isFinite(m) ? "—" : imperial() ? `${fmt(m * 3.280839895)} ft` : `${fmt(m)} m`);
const coordText = (lat, lng) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
const eyeText = (m) => (m >= 10000 ? `${fmt(m / 1000)} km` : m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/* ================================================================ camera */
const fov = () => app.map.getVerticalFieldOfView?.() ?? 36.87;
const cleanCam = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === "number" && Number.isNaN(v))));
function currentCamera() {
  const m = app.map, c = m.getCenter();
  return { center: round6([c.lng, c.lat]), zoom: +m.getZoom().toFixed(2), pitch: Math.round(m.getPitch()), bearing: Math.round(m.getBearing()) };
}
/** Camera-to-centre distance in metres for a zoom (what KML calls LookAt range). */
function rangeForZoom(zoom, lat) {
  const mpp = (40075016.686 * Math.cos(clamp(lat, -85, 85) * RAD)) / (512 * 2 ** zoom);
  return (mpp * (app.map.getCanvas().clientHeight || 800)) / (2 * Math.tan((fov() * RAD) / 2));
}
function zoomForRange(range, lat) {
  const h = app.map.getCanvas().clientHeight || 800;
  return clamp(Math.log2((40075016.686 * Math.cos(clamp(lat, -85, 85) * RAD) * h) / (512 * range * 2 * Math.tan((fov() * RAD) / 2))), 0, 19);
}
function framePadding() {
  const w = innerWidth, h = innerHeight;
  const dock = !$("#dock")?.hidden, card = !$("#card")?.hidden;
  const pad = isPhone()
    ? { top: 128, bottom: dock || card ? Math.round(h * 0.62) + 16 : 110, left: 28, right: 64 }
    : { top: 90, bottom: 90, left: dock ? 476 : 90, right: card ? 450 : 90 };
  if (M.on && !UI.sheet.hidden) pad.bottom = Math.max(pad.bottom, Math.round(h - UI.sheet.getBoundingClientRect().top + 28));
  if (pad.left + pad.right > w - 80) { pad.left = 20; pad.right = 20; }
  if (pad.top + pad.bottom > h - 80) { pad.top = 20; pad.bottom = Math.max(20, h - 140); }
  return pad;
}
/** A few points that outline a path or shape on screen: its corners plus some of the curve between. */
const shapeSamples = (vertices, line) => [...thin(vertices, 10), ...thin(line, 6)];
function frameBox(box, maxZoom = 15, pts = null) {
  const m = app.map;
  if (!box || !Number.isFinite(box[0])) return;
  if (box[2] - box[0] < 1e-6 && box[3] - box[1] < 1e-6) {
    m.flyTo(cleanCam({ center: [box[0], box[1]], zoom: Math.max(m.getZoom(), 13), speed: 1.3 }));
    return;
  }
  const seq = ++UI.frameSeq, until = performance.now() + 8000;
  // Refine at the end of this flight only: not the flight it interrupts (whose moveend fires
  // inside fitBounds), nor a later pan by the visitor.
  let armed = false;
  const onEnd = (e) => {
    if (!armed) return;
    m.off("moveend", onEnd);
    if (seq === UI.frameSeq && !e.originalEvent && performance.now() < until) requestAnimationFrame(() => refineFrame(box, maxZoom, pts));
  };
  m.on("moveend", onEnd);
  // fitBounds turns the camera north-up unless told otherwise; keep the visitor's heading.
  m.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: framePadding(), maxZoom, bearing: m.getBearing(), speed: 1.3 });
  armed = true;
  if (!m.isMoving()) onEnd({});
}
// fitBounds frames the box at sea level and, when tilted or turned, around its rotated
// corners: raised terrain overflows, and a diagonal path in a tilted view ends up small.
// Measure where the shape (its points, else the box) really landed and ease until it fits.
function refineFrame(box, maxZoom, pts) {
  const m = app.map;
  if (m.getZoom() < 6 || m.isMoving()) return false;
  const pad = framePadding(), mx = (box[0] + box[2]) / 2, my = (box[1] + box[3]) / 2;
  const s = (pts?.length > 1 ? pts : [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [mx, box[1]], [mx, box[3]], [box[0], my], [box[2], my]]).map(screenOf);
  const xs = s.map((q) => q.x), ys = s.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = innerWidth - pad.left - pad.right, H = innerHeight - pad.top - pad.bottom;
  const k = Math.min(3, W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, tx = pad.left + W / 2, ty = pad.top + H / 2;
  const roomy = k > 1.25 && m.getZoom() < maxZoom - 0.1;
  if (k > 0.97 && !roomy && Math.abs(cx - tx) < W * 0.06 && Math.abs(cy - ty) < H * 0.06) return false;
  // Zooming by k scales offsets from the screen centre by k, so pick the centre that
  // leaves the box centre on the target once the zoom has happened.
  const zoom = Math.min(maxZoom, m.getZoom() + Math.log2(k * 0.96)), f = 2 ** (zoom - m.getZoom());
  const S = { x: innerWidth / 2, y: innerHeight / 2 };
  const c = m.unproject([cx - (tx - S.x) / f, cy - (ty - S.y) / f]);
  m.easeTo({ center: [c.lng, c.lat], zoom, duration: 550 });
  return true;
}

/* ================================================================ map images */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function ensureImages(m) {
  if (!m.hasImage("tl-pill")) {
    // Stretchable pill behind measurement labels (icon-text-fit).
    const s = 2, r = 22, w = r * 2 + 4, h = r * 2 + 4;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    roundRect(g, 1, 1, w - 2, h - 2, r);
    g.fillStyle = "rgba(255,255,255,0.97)"; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "rgba(20,20,20,0.16)"; g.stroke();
    m.addImage("tl-pill", g.getImageData(0, 0, w, h), { pixelRatio: s, stretchX: [[r, w - r]], stretchY: [[r, h - r]], content: [12, 10, w - 12, h - 10] });
  }
  if (!m.hasImage("tl-pin")) {
    const s = 2, W = 30, H = 40;
    const c = document.createElement("canvas"); c.width = W * s; c.height = H * s;
    const g = c.getContext("2d");
    g.scale(s, s);
    const p = new Path2D("M15 36.5C11.2 32.8 4.6 25.9 4.6 17A10.4 10.4 0 0 1 25.4 17C25.4 25.9 18.8 32.8 15 36.5Z");
    g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
    g.fillStyle = "#ffffff"; g.fill(p);
    g.shadowColor = "transparent";
    g.lineWidth = 1.4; g.strokeStyle = "#141414"; g.stroke(p);
    g.beginPath(); g.arc(15, 16.8, 4.1, 0, Math.PI * 2); g.fillStyle = "#141414"; g.fill();
    m.addImage("tl-pin", g.getImageData(0, 0, W * s, H * s), { pixelRatio: s });
  }
}

/* ================================================================ measure */
const M = { on: false, kind: "distance", pts: [], done: false, cursor: null, drag: null, profileOpen: false, profile: null, profSeq: 0, profTimer: 0, dblWas: true, retry: 0, retryKey: "" };

const canFinish = () => M.pts.length >= (M.kind === "area" ? 3 : 2);
const ptsKey = (pts) => pts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");

function ensureMeasureLayers() {
  const m = app.map;
  if (m.getSource("meas-path")) return;
  ensureImages(m);
  m.addSource("meas-path", { type: "geojson", data: EMPTY });
  m.addSource("meas-live", { type: "geojson", data: EMPTY });
  m.addSource("meas-hover", { type: "geojson", data: EMPTY });
  const before = app.layers.anchor("top");
  const k = (v) => ["==", ["get", "k"], v];
  const round = { "line-cap": "round", "line-join": "round" };
  const label = (id, source, extra = {}) => m.addLayer({
    id, type: "symbol", source, filter: ["in", ["get", "k"], ["literal", ["seg", "total"]]],
    layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"],
      "text-size": ["case", ["==", ["get", "k"], "total"], 13, 11],
      "icon-image": "tl-pill", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3],
      "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport",
      "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport",
      "symbol-sort-key": ["coalesce", ["get", "rank"], 0], "text-padding": 4, ...extra,
    },
    paint: { "text-color": "#141414" },
  }, before);
  m.addLayer({ id: "meas-fill", type: "fill", source: "meas-path", filter: k("fill"), paint: { "fill-color": "#ffffff", "fill-opacity": 0.16 } }, before);
  m.addLayer({ id: "meas-live-fill", type: "fill", source: "meas-live", filter: k("fill"), paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 } }, before);
  m.addLayer({ id: "meas-casing", type: "line", source: "meas-path", filter: k("line"), layout: round, paint: { "line-color": "rgba(12,12,14,0.55)", "line-width": 6 } }, before);
  m.addLayer({ id: "meas-line", type: "line", source: "meas-path", filter: k("line"), layout: round, paint: { "line-color": "#ffffff", "line-width": 2.6 } }, before);
  m.addLayer({ id: "meas-live-casing", type: "line", source: "meas-live", filter: k("line"), layout: round, paint: { "line-color": "rgba(12,12,14,0.4)", "line-width": 5 } }, before);
  m.addLayer({ id: "meas-live-line", type: "line", source: "meas-live", filter: k("line"), paint: { "line-color": "#ffffff", "line-width": 2.2, "line-dasharray": [1.6, 1.4] } }, before);
  m.addLayer({
    id: "meas-vertex", type: "circle", source: "meas-path", filter: k("vertex"),
    paint: { "circle-radius": ["case", ["get", "first"], 6.5, 5], "circle-color": "#ffffff", "circle-stroke-color": "#141414", "circle-stroke-width": 2, "circle-pitch-alignment": "viewport" },
  }, before);
  label("meas-label", "meas-path");
  label("meas-live-label", "meas-live", { "text-allow-overlap": true, "icon-allow-overlap": true });
  m.addLayer({ id: "meas-hover", type: "circle", source: "meas-hover", paint: { "circle-radius": 6.5, "circle-color": "#141414", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5, "circle-pitch-alignment": "viewport" } }, before);
}

function measureFC() {
  const pts = M.pts, area = M.kind === "area", feats = [];
  const closed = area && pts.length >= 3 && M.done;
  if (closed) feats.push(F("Polygon", [fillRing(pts)], { k: "fill" }));
  if (pts.length >= 2) {
    const line = closed ? [...pts, pts[0]] : pts;
    feats.push(F("LineString", geodesic(line), { k: "line" }));
    for (let i = 1; i < line.length; i++) {
      const km = haversineKm(line[i - 1], line[i]);
      feats.push(F("Point", midpoint(line[i - 1], line[i]), { k: "seg", label: lenText(km), rank: -km }));
    }
  }
  if (closed) feats.push(F("Point", centroid(pts), { k: "total", label: areaText(areaKm2(pts)), rank: -1e12 }));
  pts.forEach((p, i) => feats.push(F("Point", p, { k: "vertex", i, first: area && i === 0 && !M.done })));
  return fc(feats);
}
function liveFC() {
  if (!M.on || M.done || !M.pts.length) return EMPTY;
  const pts = M.pts, last = pts[pts.length - 1], c = M.cursor, feats = [];
  if (c) {
    feats.push(F("LineString", geodesic([last, c]), { k: "line" }));
    feats.push(F("Point", midpoint(last, c), { k: "seg", label: lenText(haversineKm(last, c)) }));
  }
  if (M.kind === "area") {
    const ring = c ? [...pts, c] : pts;
    if (ring.length >= 2) feats.push(F("LineString", geodesic([ring[ring.length - 1], pts[0]]), { k: "line" }));
    if (ring.length >= 3) feats.push(F("Polygon", [fillRing(ring)], { k: "fill" }));
  }
  return fc(feats);
}

let liveRaf = 0;
const renderLive = () => app.map.getSource("meas-live")?.setData(liveFC());
const scheduleLive = () => {
  if (!liveRaf) liveRaf = requestAnimationFrame(() => {
    liveRaf = 0;
    if (M.cursorPt) { M.cursor = groundAt(M.cursorPt); M.cursorPt = null; }
    renderLive();
  });
};

function renderMeasure() {
  if (!M.on) return;
  app.map.getSource("meas-path")?.setData(measureFC());
  renderLive();
  renderSheet();
  if (M.profileOpen && M.kind === "distance" && M.pts.length >= 2 && M.profile?.key !== ptsKey(M.pts)) {
    clearTimeout(M.profTimer);
    M.profTimer = setTimeout(loadProfile, M.profile ? 350 : 0);
  }
  app.emit("measure:changed", { kind: M.kind, points: M.pts.length, done: M.done });
}

/** A story steps aside (paused, its player hidden) while a tool has the map: say so. */
function notePausedStory(what) {
  const t = app.tours?.state?.();
  if (t?.story && !t.finished && !document.body.classList.contains("tl-drawing")) app.ui.toast(`Story paused while you ${what}`);
}

function startMeasure(kind = "distance", { interactive = true } = {}) {
  notePausedStory("measure");
  app.emit("mode:claim", "measure");
  stopPin();
  closeShare();
  // On a phone the dock is a bottom sheet over the measure sheet; a visitor who picked the
  // ruler wants the map. (An agent's measurement leaves its panel open.)
  if (interactive && isPhone() && app.ui.current) app.ui.closePanel();
  // The sheet sits between the dock and the card; when they leave it no room, the card yields.
  if (!M.on && !$("#card").hidden) {
    const room = innerWidth - ($("#dock").hidden ? 14 : 468) - 440;
    if (isPhone() || room < 460) app.ui.hideCard();
  }
  if (!M.on) {
    ensureMeasureLayers();
    M.on = true;
    M.dblWas = app.map.doubleClickZoom.isEnabled();
    app.map.doubleClickZoom.disable();
    document.body.classList.add("tl-drawing");
  }
  app.mode = "measure";
  if (kind !== M.kind) setKind(kind, false);
  syncToolbar();
  renderMeasure();
  placeSheet();
}
function stopMeasure() {
  if (!M.on) return;
  Object.assign(M, { on: false, pts: [], done: false, cursor: null, drag: null, profile: null, profileOpen: false });
  M.profSeq++;
  if (app.mode === "measure") app.mode = null;
  if (M.dblWas) app.map.doubleClickZoom.enable();
  document.body.classList.remove("tl-drawing", "tl-grab", "tl-grabbing");
  for (const s of ["meas-path", "meas-live", "meas-hover"]) app.map.getSource(s)?.setData(EMPTY);
  UI.sheet.hidden = true;
  placeSheet();
  syncToolbar();
  app.emit("measure:changed", { kind: M.kind, points: 0, done: false, closed: true });
}
function setKind(kind, render = true) {
  M.kind = kind === "area" ? "area" : "distance";
  if (M.kind === "area" && M.pts.length < 3) M.done = false;
  if (M.kind === "area") { M.profileOpen = false; app.map.getSource("meas-hover")?.setData(EMPTY); }
  if (render) renderMeasure();
}
function setUnits(u) {
  units = u === "imperial" ? "imperial" : "metric";
  store.set(UNITS_KEY, units);
  UI.profKey = "";
  renderMeasure();
  renderPlacesList();
}
function finish() {
  if (!canFinish()) return;
  M.done = true;
  M.cursor = null;
  renderMeasure();
}
function undoPoint() {
  if (!M.pts.length) return;
  M.done = false;
  M.pts.pop();
  renderMeasure();
}
function clearMeasure() {
  M.pts = []; M.done = false; M.cursor = null; M.profile = null; M.profSeq++;
  app.map.getSource("meas-hover")?.setData(EMPTY);
  renderMeasure();
}
function onMeasureClick(e) {
  const ll = groundAt(e.point);
  if (!ll) return;
  if (M.done) { M.pts = []; M.done = false; M.profile = null; }
  if (M.pts.length) {
    const frame = localFrame(e.point);
    const near = (p, px) => { const q = frame?.toScreen(p); return !!q && Math.hypot(q.x - e.point.x, q.y - e.point.y) < px; };
    if (M.kind === "area" && M.pts.length >= 3 && near(M.pts[0], 11)) return finish();
    if (near(M.pts[M.pts.length - 1], 8)) { if (canFinish()) finish(); return; }
  }
  M.pts.push(ll);
  renderMeasure();
}
function saveMeasurement() {
  if (!M.done) return;
  const area = M.kind === "area";
  const p = addPlace({
    kind: area ? "area" : "path",
    title: area ? `Area · ${areaText(areaKm2(M.pts))}` : `Path · ${lenText(pathKm(M.pts))}`,
    coords: M.pts.map(round6),
    camera: currentCamera(),
  });
  if (!p) return;
  // The saved copy is drawn by My places from here on, so the ruler steps aside.
  stopMeasure();
  if (!P.show) { P.show = true; store.set(SHOW_KEY, true); drawPlaces(); renderPlacesList(); }
  showPlaceCard(p, { edit: true, fresh: true });
}

function computeDistance(pts) {
  const segments = [];
  for (let i = 1; i < pts.length; i++) {
    const km = haversineKm(pts[i - 1], pts[i]);
    segments.push({ from: pts[i - 1], to: pts[i], km: +km.toFixed(4), mi: +(km * 0.621371192).toFixed(4) });
  }
  const km = pathKm(pts);
  return { total_km: +km.toFixed(4), total_mi: +(km * 0.621371192).toFixed(4), segments };
}
function computeArea(pts) {
  const km2 = areaKm2(pts), per = pathKm([...pts, pts[0]]);
  return {
    area_km2: +km2.toFixed(6), area_mi2: +(km2 * 0.386102159).toFixed(6), area_ha: +(km2 * 100).toFixed(4), area_acres: +(km2 * 247.105381).toFixed(3),
    perimeter_km: +per.toFixed(4), perimeter_mi: +(per * 0.621371192).toFixed(4),
  };
}

/* ---------------------------------------------------------------- measure sheet */
function buildSheet() {
  const el = document.createElement("section");
  el.id = "tl-measure";
  el.className = "tl-sheet wglass";
  el.hidden = true;
  el.setAttribute("aria-label", "Measure");
  el.innerHTML = `
    <div class="tl-sheet-top">
      <div class="tl-readout" aria-live="polite">
        <span class="eyebrow" data-r="label">Distance</span>
        <div class="tl-total"><b data-r="value">—</b><span data-r="unit"></span></div>
        <div class="tl-subline" data-r="sub"></div>
      </div>
      <div class="tl-sheet-ctl">
        <div class="seg" role="group" aria-label="What to measure">
          <button type="button" data-kind="distance" aria-pressed="true">Distance</button><button type="button" data-kind="area" aria-pressed="false">Area</button>
        </div>
        <div class="seg" role="group" aria-label="Units">
          <button type="button" data-units="metric" aria-pressed="true">Metric</button><button type="button" data-units="imperial" aria-pressed="false">Imperial</button>
        </div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close measure (Esc)">${icon(I.close, 14)}</button>
      </div>
    </div>
    <div class="tl-profile" data-r="profile" hidden></div>
    <div class="tl-sheet-foot">
      <p class="tl-hint" data-r="hint"></p>
      <div class="tl-sheet-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="undo">Undo</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="clear">Clear</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="save">${icon(I.bookmark, 15)}Save</button>
        <button type="button" class="btn btn-ghost btn-sm tl-prof-btn" data-act="profile" aria-expanded="false" aria-label="Elevation profile"><span class="tl-long">Elevation profile</span><span class="tl-short">Profile</span></button>
        <button type="button" class="btn btn-primary btn-sm" data-act="done">Done</button>
        <button type="button" class="icon-btn tl-expand" data-act="expand" aria-label="Show the whole measurement">${icon('<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>', 16)}</button>
      </div>
    </div>`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.kind) return setKind(b.dataset.kind);
    if (b.dataset.units) return setUnits(b.dataset.units);
    const act = b.dataset.act;
    if (act === "expand") {
      app.ui.closePanel();
      app.ui.hideCard();
      el.querySelector('.tl-sheet-actions .btn:not([hidden])')?.focus({ preventScroll: true });
    } else if (act === "close") stopMeasure();
    else if (act === "undo") undoPoint();
    else if (act === "clear") clearMeasure();
    else if (act === "done") finish();
    else if (act === "save") saveMeasurement();
    else if (act === "profile") toggleProfile();
    else if (act === "retry") {
      const key = ptsKey(M.pts);
      M.retry = M.retryKey === key ? M.retry + 1 : 1;
      M.retryKey = key;
      M.profile = null;
      loadProfile();
    }
  });
  document.body.append(el);
  UI.sheet = el;
  if (!window.ResizeObserver) return;
  // The sheet growing (the profile opening, or the pill unfolding) can cover the path.
  let lastH = 0;
  new ResizeObserver(() => {
    const h = el.offsetHeight, grew = lastH > 0 && h - lastH > 24;
    lastH = h;
    if (grew) requestAnimationFrame(() => keepPathInView());
  }).observe(el);
  const ro = new ResizeObserver(() => { if (el.classList.contains("is-min")) placeSheet(); });
  for (const q of ["#dock", "#card"]) if ($(q)) ro.observe($(q));
}
/** On a phone the dock and the card are bottom sheets too: while one is open the measure
 *  sheet folds into a pill just above it, and unfolds when it closes. */
function placeSheet() {
  const s = UI.sheet;
  if (!s) return;
  const over = ["#dock", "#card"].map((q) => $(q)).filter((el) => el && !el.hidden);
  const min = M.on && isPhone() && over.length > 0;
  s.classList.toggle("is-min", min);
  s.style.bottom = min ? `${Math.round(innerHeight - Math.min(...over.map((el) => el.getBoundingClientRect().top)) + 8)}px` : "";
  liftCredits();
}
/** On a phone the map credits (i) sits at the foot of the map, where the measure sheet and
 *  the pin hint go: it rides just above whichever is showing (tools.css --tl-foot), and above
 *  the Earth-data status pill, which lifts itself over them the same way. */
function liftCredits() {
  const el = [UI.sheet, UI.hint].find((x) => x && !x.hidden);
  let foot = 0;
  if (el && isPhone()) {
    foot = innerHeight - el.offsetTop + 8; // offsetTop: where it lands, not mid-rise
    const ed = $(".ed-status");
    if (ed && !ed.hidden && ed.offsetHeight) foot += ed.offsetHeight + 10;
  }
  document.body.classList.toggle("tl-credits-up", foot > 0);
  if (foot > 0) document.body.style.setProperty("--tl-foot", `${Math.round(foot)}px`);
  else document.body.style.removeProperty("--tl-foot");
}
function watchCredits() {
  if (!window.ResizeObserver) return;
  const ro = new ResizeObserver(() => liftCredits());
  for (const el of [UI.sheet, UI.hint]) ro.observe(el);
  // The Earth-data pill is added on first use; follow it from then on.
  const follow = () => { const ed = $(".ed-status"); if (ed) ro.observe(ed); return !!ed; };
  if (follow()) return;
  const mo = new MutationObserver(() => { if (follow()) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}

function hintText() {
  const tap = coarse() ? "Tap" : "Click", n = M.pts.length;
  if (M.done) return coarse() ? "Tap the map to start a new measurement." : "Drag a point to adjust it, or click the map to start again.";
  if (!n) return coarse() ? "Tap the map to place the first point." : "Click the map to place the first point, or press Space for the centre of the view.";
  if (M.kind === "area" && n < 3) return `${tap} to add points. A shape needs at least three.`;
  if (M.kind === "area") return coarse() ? "Tap to add points, or tap the first point to close the shape." : "Click to add points. Click the first point, double-click or press Enter to close the shape.";
  return coarse() ? "Tap to add points, then Done." : "Click to add points. Double-click or press Enter to finish.";
}

function renderSheet() {
  const s = UI.sheet;
  s.hidden = !M.on;
  if (!M.on) return;
  const n = M.pts.length, area = M.kind === "area";
  const q = (r) => s.querySelector(`[data-r="${r}"]`);
  for (const b of s.querySelectorAll("[data-kind]")) b.setAttribute("aria-pressed", String(b.dataset.kind === M.kind));
  for (const b of s.querySelectorAll("[data-units]")) b.setAttribute("aria-pressed", String(b.dataset.units === units));
  let value = "0", unit = area ? (imperial() ? "acres" : "km²") : imperial() ? "mi" : "km", sub;
  if (area) {
    if (n >= 3) {
      [value, unit] = areaParts(areaKm2(M.pts));
      sub = `Perimeter ${lenText(pathKm([...M.pts, M.pts[0]]))} · ${n} points`;
    } else sub = n ? `${n} of 3 points` : "Surface area on the globe";
  } else if (n >= 2) {
    [value, unit] = lenParts(pathKm(M.pts));
    sub = `${plural(n - 1, "segment")} · great-circle distance`;
  } else sub = n ? "1 point" : "Great-circle distance";
  q("label").textContent = area ? "Area" : "Distance";
  q("value").textContent = value;
  q("unit").textContent = unit;
  q("value").parentElement.classList.toggle("is-empty", area ? n < 3 : n < 2);
  q("sub").textContent = sub;
  q("hint").textContent = hintText();
  const show = (act, on) => { const b = s.querySelector(`[data-act="${act}"]`); b.hidden = !on; return b; };
  show("undo", !M.done && n > 0);
  show("clear", n > 0);
  show("save", M.done);
  show("done", !M.done && canFinish());
  const prof = show("profile", !area && n >= 2);
  prof.setAttribute("aria-expanded", String(M.profileOpen));
  s.classList.toggle("tl-prof-open", M.profileOpen && !area && n >= 2);
  renderProfile();
}

/* ---------------------------------------------------------------- elevation profile */
function toggleProfile() {
  M.profileOpen = !M.profileOpen;
  if (!M.profileOpen) app.map.getSource("meas-hover")?.setData(EMPTY);
  renderMeasure();
  if (M.profileOpen && M.profile?.key !== ptsKey(M.pts)) loadProfile();
  if (M.profileOpen) requestAnimationFrame(() => keepPathInView());
}
/** Ease the camera out just enough that the whole path sits above the (taller) sheet. */
function keepPathInView(pass = 0) {
  const m = app.map;
  // Mid-flight (an earlier framing, or the visitor dragging) is left to finish undisturbed.
  if (!M.on || M.pts.length < 2 || m.isMoving()) return;
  const pad = framePadding(), top = UI.sheet.getBoundingClientRect().top - 20;
  const hidden = thin(geodesic(M.pts, 50), 10).some((p) => {
    const q = screenOf(p);
    return q.y > top || q.y < pad.top - 12 || q.x < pad.left - 16 || q.x > innerWidth - pad.right + 16;
  });
  if (!hidden) return;
  const line = geodesic(M.pts), box = geoBox([line]), samples = shapeSamples(M.pts, line);
  if (m.getZoom() < 6) return frameBox(box, m.getZoom(), samples);
  // Close up, one measured ease (out, never in) beats a fitBounds flight plus a correction.
  // A tilted view does not scale evenly, so look once more where that ease left the path.
  if (refineFrame(box, m.getZoom(), samples) && !pass) {
    m.once("moveend", (e) => { if (!e.originalEvent) requestAnimationFrame(() => keepPathInView(1)); });
  }
}
async function loadProfile() {
  clearTimeout(M.profTimer);
  const pts = M.pts.slice();
  if (pts.length < 2) return null;
  const my = ++M.profSeq, key = ptsKey(pts), first = !M.profile?.points;
  M.profile = { loading: true, key };
  UI.profKey = "";
  renderProfile();
  try {
    if (pathKm(pts) < 1e-6) throw new Error("The points are all in the same place, so there is no path to profile.");
    const prof = await sampleProfile(pts, 200, M.retryKey === key ? M.retry : 0);
    if (my !== M.profSeq) return null;
    const vals = prof.points.map((p) => p.m).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) throw new Error("The elevation tiles for this path did not load.");
    M.profile = { ...prof, key, id: my };
  } catch (err) {
    if (my !== M.profSeq) return null;
    M.profile = { error: err.message || "Elevation tiles did not load.", key };
  }
  UI.profKey = "";
  renderProfile();
  // The finished chart makes the sheet taller; keep the whole path above it.
  if (first && M.profile.points) requestAnimationFrame(() => keepPathInView());
  return M.profile;
}

/** Evenly spaced samples along the great-circle path plus every clicked point, so a
 *  summit or valley floor someone clicked on is measured rather than stepped over. */
async function sampleProfile(pts, count, attempt = 0) {
  const line = geodesic(pts, 10);
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + haversineKm(line[i - 1], line[i]));
  const total = acc[acc.length - 1];
  const at = (km) => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < km) i++;
    const span = acc[i] - acc[i - 1], t = span ? clamp((km - acc[i - 1]) / span, 0, 1) : 0;
    const a = line[i - 1], b = line[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const samples = Array.from({ length: count }, (_, k) => {
    const km = (total * k) / (count - 1);
    return { km, pos: at(km) };
  });
  let run = 0;
  const verts = pts.slice(0, 300).map((p, i) => {
    if (i) run += haversineKm(pts[i - 1], p);
    return { km: Math.min(run, total), pos: p, vertex: true };
  });
  const eps = total / (count * 4);
  const all = [...samples.filter((s) => !verts.some((v) => Math.abs(v.km - s.km) < eps)), ...verts].sort((a, b) => a.km - b.km);
  // elevation.js remembers a tile that failed to load, so a retry reads neighbouring zoom
  // levels (other tiles of the same data) instead of the same failed ones.
  const z0 = total > 2000 ? 8 : total > 400 ? 10 : total > 60 ? 12 : 14, vz0 = Math.max(z0, 13);
  const z = attempt ? [z0 - 1, z0 + 1][(attempt - 1) % 2] : z0;
  const vz = attempt ? [13, 14, 15].filter((v) => v !== vz0)[(attempt - 1) % 2] : vz0;
  const [even, exact] = await Promise.all([
    elevations(all.filter((s) => !s.vertex).map((s) => s.pos), z),
    elevations(all.filter((s) => s.vertex).map((s) => s.pos), vz),
  ]);
  let ie = 0, ix = 0;
  const points = all.map((s) => ({ km: s.km, lng: s.pos[0], lat: s.pos[1], m: s.vertex ? exact[ix++] : even[ie++], ...(s.vertex ? { vertex: true } : {}) }));
  const vals = points.map((p) => p.m).filter((v) => v != null && Number.isFinite(v));
  let gain = 0, loss = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].m, b = points[i].m;
    if (a == null || b == null) continue;
    if (b > a) gain += b - a; else loss += a - b;
  }
  return { total_km: total, points, min_m: Math.min(...vals), max_m: Math.max(...vals), gain_m: gain, loss_m: loss };
}

function ticks(min, max, count) {
  const span = max - min || 1, raw = span / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= raw * 0.999) ?? 10 * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const list = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) list.push(+v.toFixed(10));
  return { lo, hi, step, list };
}

// Same wording while loading and loaded, so the sheet keeps its height and the camera settles once.
const srcNote = (n) => `<p class="tl-src">Elevation: ${esc(ELEVATION_SOURCE)} · ${n} samples along the great-circle path<span class="tl-src-more">, including every point you placed; climb and descent add up the rises and falls between samples</span>.</p>`;
function renderProfile() {
  const box = UI.sheet.querySelector('[data-r="profile"]');
  const open = M.on && M.profileOpen && M.kind === "distance" && M.pts.length >= 2;
  box.hidden = !open;
  if (!open) { UI.profKey = ""; return; }
  const prof = M.profile;
  const cs = getComputedStyle(box);
  const width = Math.round(Math.max(0, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) || 560;
  const key = `${prof?.id ?? (prof?.error ? "err" : "load")}|${units}|${width}|${isPhone()}`;
  if (key === UI.profKey) return;
  UI.profKey = key;
  if (!prof || prof.loading) {
    box.innerHTML = `<div class="tl-pstats">${["Lowest", "Highest", "Climb", "Descent"].map((k) => `<div class="tl-pstat"><span>${k}</span><b class="tl-skel">&nbsp;</b></div>`).join("")}</div>
      <div class="tl-chart tl-chart-loading" aria-busy="true"><span>Sampling terrain along the path…</span></div>
      ${srcNote("about 200")}`;
    return;
  }
  if (prof.error) {
    box.innerHTML = `<div class="tl-chart tl-chart-error" role="alert"><span>${esc(prof.error)}</span><button type="button" class="btn btn-ghost btn-sm" data-act="retry">Try again</button></div>`;
    return;
  }
  const pts = prof.points;
  const first = pts.find((p) => p.m != null)?.m, last = [...pts].reverse().find((p) => p.m != null)?.m;
  box.innerHTML = `
    <div class="tl-pstats">
      <div class="tl-pstat"><span>Lowest</span><b>${elevText(prof.min_m)}</b></div>
      <div class="tl-pstat"><span>Highest</span><b>${elevText(prof.max_m)}</b></div>
      <div class="tl-pstat"><span>Climb</span><b>${elevText(prof.gain_m)}</b></div>
      <div class="tl-pstat"><span>Descent</span><b>${elevText(prof.loss_m)}</b></div>
    </div>
    <div class="tl-chart" tabindex="0" role="slider" aria-label="Elevation along the path; use the arrow keys to read points" aria-valuemin="0" aria-valuemax="${+prof.total_km.toFixed(3)}" aria-valuenow="0" aria-valuetext="${esc(`${lenText(prof.total_km)} path: starts at ${elevText(first)}, ends at ${elevText(last)}, lowest ${elevText(prof.min_m)}, highest ${elevText(prof.max_m)}`)}"></div>
    ${srcNote(fmt(pts.length))}`;
  drawChart(box.querySelector(".tl-chart"), prof, width);
}

function drawChart(el, prof, W) {
  const H = Math.round(el.clientHeight || 168), Rt = 12, T = 30, B = 24;
  const fE = imperial() ? 3.280839895 : 1, fD = imperial() ? 0.621371192 : 1;
  const uE = imperial() ? "ft" : "m", uD = imperial() ? "mi" : "km";
  const pts = prof.points, n = pts.length;
  let lo = prof.min_m * fE, hi = prof.max_m * fE;
  if (hi - lo < 20) { const c = (hi + lo) / 2; lo = c - 10; hi = c + 10; }
  const yt = ticks(lo, hi, 4);
  const yLabels = yt.list.map((v, i) => `${fmt(v)}${i === yt.list.length - 1 ? ` ${uE}` : ""}`);
  // Room for the widest elevation label (about 5.6 px a character at 0.68rem).
  const L = Math.max(46, Math.round(Math.max(...yLabels.map((s) => s.length)) * 5.6) + 10);
  const total = prof.total_km * fD;
  const xt = ticks(0, total, 5);
  const xs = xt.list.filter((v) => v <= total * 1.0001);
  const iw = W - L - Rt, ih = H - T - B;
  const x = (d) => L + (d / total) * iw;
  const y = (v) => T + ih - ((v - yt.lo) / (yt.hi - yt.lo)) * ih;
  let line = "", area = "", run = [];
  const flush = () => {
    if (run.length > 1) {
      line += `M${run.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")}`;
      area += `M${run[0][0].toFixed(1)},${(T + ih).toFixed(1)}L${run.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")}L${run[run.length - 1][0].toFixed(1)},${(T + ih).toFixed(1)}Z`;
    }
    run = [];
  };
  for (const p of pts) {
    if (p.m == null || !Number.isFinite(p.m)) { flush(); continue; }
    run.push([x(p.km * fD), y(p.m * fE)]);
  }
  flush();
  const dec = xt.step < 0.1 ? 2 : xt.step < 1 ? 1 : 0;
  const sea = yt.lo < 0 && yt.hi > 0 ? `<line x1="${L}" x2="${W - Rt}" y1="${y(0)}" y2="${y(0)}" class="tl-sea"/>` : "";
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">
      <defs><linearGradient id="tl-pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141414" stop-opacity="0.22"/><stop offset="1" stop-color="#141414" stop-opacity="0.03"/></linearGradient></defs>
      ${yt.list.map((v, i) => `<line class="tl-grid" x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}"/><text class="tl-ax" x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end">${yLabels[i]}</text>`).join("")}
      ${sea}
      <path d="${area}" fill="url(#tl-pg)"/>
      <path d="${line}" fill="none" stroke="#141414" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      ${xs.map((v, i) => `<text class="tl-ax" x="${x(v)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "middle"}">${num(v, dec)}${i === xs.length - 1 ? ` ${uD}` : ""}</text>`).join("")}
      <g class="tl-cross" visibility="hidden"><line x1="0" x2="0" y1="${T}" y2="${T + ih}"/><circle r="4.5" cx="0" cy="0"/></g>
    </svg>
    <div class="tl-ch-tip" hidden></div>`;
  const svg = el.querySelector("svg"), cross = svg.querySelector(".tl-cross"), vline = cross.querySelector("line"), dot = cross.querySelector("circle"), tip = el.querySelector(".tl-ch-tip");
  let idx = null;
  const show = (i) => {
    idx = clamp(i, 0, n - 1);
    const p = pts[idx], px = x(p.km * fD);
    vline.setAttribute("x1", px); vline.setAttribute("x2", px);
    if (p.m != null && Number.isFinite(p.m)) { dot.setAttribute("cx", px); dot.setAttribute("cy", y(p.m * fE)); dot.style.display = ""; } else dot.style.display = "none";
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = `${lenText(p.km)} · ${elevText(p.m)}`;
    el.setAttribute("aria-valuenow", String(+p.km.toFixed(3)));
    el.setAttribute("aria-valuetext", `${lenText(p.km)} along the path: ${elevText(p.m)}`);
    tip.style.left = `${clamp(px, 64, W - 64)}px`;
    app.map.getSource("meas-hover")?.setData(F("Point", [p.lng, p.lat]));
  };
  const hide = () => { idx = null; cross.setAttribute("visibility", "hidden"); tip.hidden = true; app.map.getSource("meas-hover")?.setData(EMPTY); };
  el.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const km = (clamp((((e.clientX - r.left) * W) / r.width - L) / iw, 0, 1) * total) / fD;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].km < km) lo = mid; else hi = mid; }
    show(km - pts[lo].km <= pts[hi].km - km ? lo : hi);
  });
  el.addEventListener("pointerleave", () => { if (document.activeElement !== el) hide(); });
  el.addEventListener("blur", hide);
  el.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") show((idx ?? -1) + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") show((idx ?? n) - step);
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(n - 1);
    else if (e.key === "Escape") { hide(); el.blur(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}

/* ================================================================ my places */
const P = { list: [], show: true, storage: true, warned: false, editing: null, node: null };
const KINDS = ["pin", "view", "path", "area"];
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const findPlace = (id) => P.list.find((p) => p.id === id);

function cleanPlace(p) {
  if (!p || typeof p !== "object" || !KINDS.includes(p.kind)) return null;
  const out = {
    id: typeof p.id === "string" && /^[\w-]{1,40}$/.test(p.id) ? p.id : newId(),
    kind: p.kind,
    title: String(p.title ?? "").trim().slice(0, 200) || "Untitled",
    notes: String(p.notes ?? "").slice(0, 4000),
    created: typeof p.created === "string" && !Number.isNaN(Date.parse(p.created)) ? p.created : new Date().toISOString(),
  };
  if (p.named === "osm") out.named = "osm";
  if (p.kind === "path" || p.kind === "area") {
    const coords = thin((Array.isArray(p.coords) ? p.coords : []).filter(okLL).map(([x, y]) => round6([((+x + 540) % 360) - 180, +y])), MAX_PATH_POINTS);
    if (coords.length < (p.kind === "area" ? 3 : 2)) return null;
    out.coords = coords;
    [out.lng, out.lat] = p.kind === "area" ? round6(centroid(coords)) : coords[0];
  } else {
    if (!okLL([p.lng, p.lat])) return null;
    [out.lng, out.lat] = round6([((+p.lng + 540) % 360) - 180, +p.lat]);
  }
  const c = p.camera;
  if (c && okLL(c.center) && Number.isFinite(+c.zoom)) {
    out.camera = { center: round6(c.center), zoom: clamp(+c.zoom, 0, 20), pitch: clamp(Number(c.pitch) || 0, 0, 85), bearing: Number(c.bearing) || 0 };
  }
  return out;
}
function loadPlaces() {
  const raw = store.get(PLACES_KEY, []);
  P.list = Array.isArray(raw) ? raw.map(cleanPlace).filter(Boolean) : [];
}
function savePlaces() {
  P.storage = store.set(PLACES_KEY, P.list);
  if (!P.storage && !P.warned) {
    P.warned = true;
    app.ui.toast("This browser is blocking storage, so places last only until you close the tab.", { tone: "error", ms: 6000 });
  }
  drawPlaces();
  renderPlacesList();
  app.emit("places:changed", { count: P.list.length });
}
function addPlace(obj) {
  const p = cleanPlace({ ...obj, id: undefined, created: new Date().toISOString() });
  if (!p) return null;
  P.list.unshift(p);
  savePlaces();
  return p;
}
function removePlace(id, { undo = true } = {}) {
  const i = P.list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [p] = P.list.splice(i, 1);
  if (P.editing === id) P.editing = null;
  savePlaces();
  if ($(`#card-body [data-tl-place="${CSS.escape(id)}"]`)) app.ui.hideCard();
  if (undo) {
    undoToast(`Deleted “${p.title}”`, () => {
      if (findPlace(p.id)) return;
      P.list.splice(Math.min(i, P.list.length), 0, p);
      savePlaces();
    });
  }
  return p;
}

function placesFC() {
  if (!P.show) return EMPTY;
  const feats = [];
  for (const p of P.list) {
    if (p.kind === "pin") feats.push(F("Point", [p.lng, p.lat], { id: p.id, k: "pin", title: p.title }));
    else if (p.kind === "path") {
      feats.push(F("LineString", geodesic(p.coords), { id: p.id, k: "path" }));
      feats.push(F("Point", p.coords[Math.floor((p.coords.length - 1) / 2)], { id: p.id, k: "label", title: p.title }));
    } else if (p.kind === "area") {
      feats.push(F("Polygon", [fillRing(p.coords)], { id: p.id, k: "area" }));
      feats.push(F("LineString", geodesic([...p.coords, p.coords[0]]), { id: p.id, k: "path" }));
      feats.push(F("Point", [p.lng, p.lat], { id: p.id, k: "label", title: p.title }));
    }
  }
  return fc(feats);
}
function ensurePlacesLayers() {
  const m = app.map;
  if (m.getSource("pin-places")) return;
  ensureImages(m);
  m.addSource("pin-places", { type: "geojson", data: EMPTY });
  const before = app.layers.anchor("top");
  const k = (v) => ["==", ["get", "k"], v];
  const text = { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.78)", "text-halo-width": 1.4 };
  m.addLayer({ id: "pin-places-fill", type: "fill", source: "pin-places", filter: k("area"), paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 } }, before);
  m.addLayer({ id: "pin-places-casing", type: "line", source: "pin-places", filter: k("path"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "rgba(12,12,14,0.5)", "line-width": 5 } }, before);
  m.addLayer({ id: "pin-places-line", type: "line", source: "pin-places", filter: k("path"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 2.2 } }, before);
  m.addLayer({ id: "pin-places-hit", type: "line", source: "pin-places", filter: k("path"), paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 14 } }, before);
  m.addLayer({
    id: "pin-places-label", type: "symbol", source: "pin-places", filter: k("label"),
    layout: { "text-field": ["get", "title"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-max-width": 12, "text-optional": true },
    paint: text,
  }, before);
  m.addLayer({
    id: "pin-places-icon", type: "symbol", source: "pin-places", filter: k("pin"),
    layout: {
      "icon-image": "tl-pin", "icon-anchor": "bottom", "icon-offset": [0, 3.5], "icon-allow-overlap": true, "icon-ignore-placement": true,
      "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport",
      "text-field": ["get", "title"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-anchor": "left", "text-offset": [1.05, -1.55],
      "text-max-width": 14, "text-optional": true,
    },
    paint: text,
  }, before);
}
function drawPlaces() { app.map.getSource("pin-places")?.setData(placesFC()); }
/** Soft white halo around the imported feature whose card is open. */
function highlight(geom) {
  const m = app.map;
  if (!m.getSource("pin-sel")) {
    if (!geom) return;
    m.addSource("pin-sel", { type: "geojson", data: EMPTY });
    const before = "pin-places-fill";
    m.addLayer({ id: "pin-sel-line", type: "line", source: "pin-sel", filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.5, "line-blur": 3 } }, before);
    m.addLayer({ id: "pin-sel-pt", type: "circle", source: "pin-sel", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 12, "circle-color": "rgba(255,255,255,0.18)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-pitch-alignment": "viewport" } }, before);
  }
  const lines = !geom ? [] : geom.type === "Polygon" ? geom.coordinates : geom.type === "MultiPolygon" ? geom.coordinates.flat() : null;
  const data = !geom ? EMPTY
    : lines ? fc(lines.map((r) => F("LineString", r)))
      : geom.type === "MultiPoint" ? fc(geom.coordinates.map((c) => F("Point", c)))
        : fc([{ type: "Feature", properties: {}, geometry: geom }]);
  m.getSource("pin-sel").setData(data);
}

function placeSub(p) {
  const note = p.notes.split("\n").find((l) => l.trim())?.trim();
  if (p.kind === "path" || p.kind === "area") {
    const stat = p.kind === "path" ? `Path · ${lenText(pathKm(p.coords))}` : `Area · ${areaText(areaKm2(p.coords))}`;
    // A measurement saved under its own reading ("Path · 3.21 mi") does not repeat it underneath.
    return p.title === stat ? note || `${plural(p.coords.length, "point")} · saved ${new Date(p.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : stat;
  }
  if (p.kind === "view") return `Saved view${p.camera ? ` · eye ${eyeText(rangeForZoom(p.camera.zoom, p.lat))}` : ""}`;
  return note || coordText(p.lat, p.lng);
}

function flyToPlace(p) {
  const m = app.map, cam = p.camera;
  if (p.kind === "path" || p.kind === "area") { const line = geodesic(p.kind === "area" ? [...p.coords, p.coords[0]] : p.coords); return frameBox(geoBox([line]), 15, shapeSamples(p.coords, line)); }
  if (p.kind === "view" && cam) {
    m.flyTo(cleanCam({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, speed: 1.2, curve: 1.42 }));
  } else {
    m.flyTo(cleanCam({ center: [p.lng, p.lat], zoom: cam?.zoom ?? Math.max(m.getZoom(), 13), pitch: cam?.pitch ?? m.getPitch(), bearing: cam?.bearing ?? m.getBearing(), speed: 1.2, curve: 1.42 }));
  }
}

async function dropPin(lng, lat, { title, notes = "", edit = true } = {}) {
  const p = addPlace({ kind: "pin", lng, lat, title: title || PIN_DEFAULT, notes, camera: currentCamera() });
  if (!p) return null;
  showPlaceCard(p, { edit, fresh: true });
  if (!title) suggestTitle(p);
  return p;
}
// Photon lists the named OpenStreetMap objects nearest the point, closest first. On the
// Eiffel Tower that starts with its restaurants, so a landmark, street or address wins
// over a business, and the town over nothing.
const BUSINESS = new Set(["amenity", "shop", "office", "craft", "healthcare", "emergency"]);
function pinName(features = [], at) {
  const props = features.map((f) => ({ ...(f.properties ?? {}), _km: f.geometry?.coordinates ? haversineKm(at, f.geometry.coordinates) : Infinity }));
  const landmark = props.find((pr) => pr.name && pr._km < 0.08 && !BUSINESS.has(pr.osm_key) && !(pr.osm_key === "tourism" && /^(?:viewpoint|information)$/.test(pr.osm_value ?? "")));
  if (landmark) return landmark.name;
  const addr = props.find((pr) => pr.street && pr._km < 0.3);
  if (addr) return addr.city && addr.city !== addr.street ? `${addr.street}, ${addr.city}` : addr.street;
  // Out in the open the nearest named thing can be kilometres away: fall back to the area it is in.
  const first = props[0];
  if (!first) return null;
  if (first.name && (first._km < 1 || (first.osm_key === "place" && first._km < 5))) return first.name;
  return first.city ?? first.county ?? first.state ?? first.country ?? null;
}
// Name a fresh pin after the place it sits on (Photon / OpenStreetMap), unless the visitor already typed one.
async function suggestTitle(p) {
  try {
    const d = await getJSON(`${PHOTON_REVERSE}?lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}&lang=en&limit=8`, { timeout: 8000 });
    const name = pinName(d.features, [p.lng, p.lat]);
    const cur = findPlace(p.id);
    if (!name || !cur || cur.title !== PIN_DEFAULT) return;
    const input = $(`#card-body [data-tl-place="${CSS.escape(p.id)}"] [data-f="title"]`);
    if (input?.dataset.touched) return;
    cur.title = String(name).slice(0, 200);
    cur.named = "osm";
    savePlaces();
    if (input) {
      input.value = cur.title;
      const credit = $(`#card-body [data-tl-place="${CSS.escape(p.id)}"] [data-credit]`);
      if (credit) credit.textContent = ` ${OSM_NAME}`;
    }
    else if ($(`#card-body [data-tl-place="${CSS.escape(p.id)}"]`)) showPlaceCard(cur);
  } catch {}
}

function saveView(title) {
  const cam = currentCamera();
  const p = addPlace({ kind: "view", lng: cam.center[0], lat: cam.center[1], title: title || `View · ${coordText(cam.center[1], cam.center[0])}`, camera: cam });
  if (!p) return null;
  if (!title) {
    getJSON(`${PHOTON_REVERSE}?lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}&lang=en&limit=1`, { timeout: 8000 })
      .then((d) => {
        const pr = d.features?.[0]?.properties;
        // Name the view at the scale it shows: a town close up, a region or country from afar.
        const z = cam.zoom;
        const name = pr && (z >= 10 ? pr.city ?? pr.name ?? pr.county ?? pr.state : z >= 6 ? pr.county ?? pr.state ?? pr.city : pr.country ?? pr.state);
        const cur = findPlace(p.id);
        if (name && cur && cur.title === p.title) { cur.title = `View of ${String(name).slice(0, 180)}`; cur.named = "osm"; savePlaces(); }
      })
      .catch(() => {});
  }
  return p;
}

/* ---------------------------------------------------------------- place card */
function showPlaceCard(p, { edit = false, fresh = false, focus = false } = {}) {
  if (!p) return;
  app.ui.hideCard();
  const kindLabel = { pin: "Saved place", view: "Saved view", path: "Saved path", area: "Saved area" }[p.kind];
  const stat = p.kind === "path" ? lenText(pathKm(p.coords)) : p.kind === "area" ? areaText(areaKm2(p.coords)) : "";
  // A measurement titled by its own reading ("Path · 3.21 mi") does not repeat it underneath.
  const own = !edit && p.title === `${p.kind === "path" ? "Path" : "Area"} · ${stat}`;
  const where = `${stat && !own ? `${stat} · ` : ""}${coordText(p.lat, p.lng)}`;
  const saved = new Date(p.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  let commit = () => {};
  const html = edit
    ? `<div class="tl-card" data-tl-place="${esc(p.id)}">
        <div class="eyebrow">${fresh ? `New ${p.kind === "pin" ? "pin" : p.kind}` : `Edit ${kindLabel.toLowerCase()}`}</div>
        <div class="tl-form">
          <label class="tl-field"><span>Title</span><input class="input" data-f="title" maxlength="200" value="${esc(p.title)}" autocomplete="off"></label>
          <label class="tl-field"><span>Notes</span><textarea class="input" data-f="notes" rows="3" maxlength="4000" placeholder="Add a note">${esc(p.notes)}</textarea></label>
        </div>
        <div class="sub">${esc(where)}<span data-elev></span></div>
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="done">Done</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="del">Delete</button>
        </div>
        <p class="note">Saved in this browser only. Export from My places to keep a copy.<span data-credit>${p.named ? ` ${OSM_NAME}` : ""}</span></p>
      </div>`
    : `<div class="tl-card" data-tl-place="${esc(p.id)}">
        <div class="eyebrow">${kindLabel}</div>
        <h3>${esc(p.title)}</h3>
        <div class="sub">${esc(where)}<span data-elev></span></div>
        ${p.notes ? `<p class="tl-notes">${esc(p.notes)}</p>` : ""}
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="fly">${p.kind === "view" ? "Go to view" : "Fly here"}</button>
          ${p.kind === "pin" || p.kind === "view" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="here">What's here</button>` : ""}
          ${p.kind === "path" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="profile" aria-label="Elevation profile">Elevation</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm tl-iconbtn" data-act="edit" aria-label="Rename or add notes" title="Edit">${icon(I.edit, 16)}</button>
          <button type="button" class="btn btn-ghost btn-sm tl-iconbtn" data-act="del" aria-label="Delete ${esc(p.title)}" title="Delete">${icon(I.trash, 16)}</button>
        </div>
        <p class="note">In My places · saved ${esc(saved)} in this browser.${p.named ? ` ${OSM_NAME}` : ""}</p>
      </div>`;
  app.ui.showCard(html, { onClose: () => commit() });
  const root = $(`#card-body [data-tl-place="${CSS.escape(p.id)}"]`);
  if (!root) return;
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener("click", fn);
  on("del", () => { commit = () => {}; removePlace(p.id); });
  if (edit) {
    const t = root.querySelector('[data-f="title"]'), n = root.querySelector('[data-f="notes"]');
    let timer = 0;
    commit = () => {
      clearTimeout(timer);
      const cur = findPlace(p.id);
      if (!cur) return;
      const title = t.value.trim().slice(0, 200) || "Untitled", notes = n.value.slice(0, 4000);
      if (cur.title === title && cur.notes === notes) return;
      if (cur.title !== title) delete cur.named;
      cur.title = title; cur.notes = notes;
      savePlaces();
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(commit, 300); };
    t.addEventListener("input", () => { t.dataset.touched = "1"; later(); });
    n.addEventListener("input", later);
    const done = () => { commit(); commit = () => {}; showPlaceCard(findPlace(p.id), { focus: true }); };
    t.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } });
    n.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); } });
    on("done", done);
    // A fresh pin on a phone keeps its suggested name without throwing up the keyboard.
    if (!(fresh && coarse())) {
      t.focus({ preventScroll: true });
      if (fresh) t.select();
    }
  } else {
    on("fly", () => flyToPlace(p));
    on("edit", () => showPlaceCard(findPlace(p.id), { edit: true }));
    on("here", () => app.tools.run("get_place_info", { lat: p.lat, lng: p.lng, name: p.kind === "pin" ? p.title : undefined }).catch(() => {}));
    on("profile", () => { app.ui.hideCard(); showMeasurement("distance", thin(p.coords, 300), { profile: true, interactive: true }); });
    if (focus) root.querySelector('[data-act="fly"]')?.focus({ preventScroll: true });
  }
  if (p.kind === "pin") {
    elevationAt(p.lng, p.lat, 13).then((v) => {
      const card = $(`#card-body [data-tl-place="${CSS.escape(p.id)}"]`);
      const span = card?.querySelector("[data-elev]");
      if (!span || v == null || !Number.isFinite(v)) return;
      // Metres, as on every place card, with feet alongside for a visitor measuring in imperial.
      const a = Math.abs(v), h = `${fmt(a)} m${imperial() ? ` (${fmt(a * 3.280839895)} ft)` : ""}`;
      span.textContent = Math.round(a) === 0 ? " · at sea level" : ` · ${h} ${v < 0 ? "below" : "above"} sea level`;
      // The terrain model includes bathymetry: a pin on water reads the seabed.
      card.querySelector(".note")?.append(` Elevation: AWS Terrain Tiles (Mapzen)${v <= -5 ? "; on water this is the seabed" : ""}.`);
    }).catch(() => {});
  }
}

/* ---------------------------------------------------------------- panel */
function renderPanel(node) {
  P.node = node;
  P.editing = null;
  node.innerHTML = `
    <p>Pins, saved views, measurements and your own map files. They stay in this browser and are never uploaded.</p>
    <div class="tl-quick">
      <button type="button" class="tl-qbtn" data-act="pin" aria-pressed="${app.mode === "pin"}">${icon(I.pin)}<span>Drop pin</span></button>
      <button type="button" class="tl-qbtn" data-act="view">${icon(I.view)}<span>Save view</span></button>
      <button type="button" class="tl-qbtn" data-act="measure" aria-pressed="${M.on}">${icon(I.ruler)}<span>Measure</span></button>
    </div>
    <div class="tl-head">
      <span class="eyebrow" data-r="count">Places</span>
      <button type="button" class="tl-switchbtn" data-act="show" aria-pressed="${P.show}" aria-label="Show my places on the map"><span class="tl-switch-l">On map</span><span class="switch"></span></button>
    </div>
    <div class="tl-list" data-r="list"></div>
    <div class="tl-head"><span class="eyebrow">Your data</span></div>
    <div class="tl-list" data-r="imports"></div>
    <button type="button" class="tl-dropzone" data-act="import">
      <span class="tl-ico">${icon(I.upload, 18)}</span>
      <span class="grow"><span class="t">Import a file</span><span class="s">GeoJSON, KML, KMZ or GPX. You can also drop files on the globe.</span></span>
    </button>
    <input type="file" data-r="file" multiple hidden accept=".geojson,.json,.kml,.kmz,.gpx,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/gpx+xml">
    <div class="tl-head"><span class="eyebrow">Export my places</span></div>
    <div class="tl-export">
      <button type="button" class="btn btn-ghost btn-sm" data-exp="kml">${icon(I.download, 16)}KML</button>
      <button type="button" class="btn btn-ghost btn-sm" data-exp="geojson">${icon(I.download, 16)}GeoJSON</button>
    </div>
    <p class="note" data-r="note"></p>`;
  node.addEventListener("click", onPanelClick);
  node.addEventListener("submit", onPanelSubmit);
  node.addEventListener("keydown", (e) => {
    const form = e.target.closest?.("form.tl-edit");
    if (!form) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("textarea")) { e.preventDefault(); form.requestSubmit(); }
    else if (e.key === "Escape") {
      // Esc leaves the rename, not the whole panel.
      e.stopPropagation();
      P.editing = null;
      renderPlacesList();
      focusRow("list", form.dataset.id);
    }
  });
  node.querySelector('[data-r="file"]').addEventListener("change", (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length) importFiles(files, { frame: true });
  });
  renderPlacesList();
  renderImportsList();
}

// openPanel() renders before it records app.ui.current, so connection is the test.
function panelLive() { return P.node?.isConnected ? P.node : null; }
/** Keep keyboard focus in a list after its rows re-render or one is removed. */
function focusRow(list, idOrIndex) {
  const node = panelLive();
  if (!node) return;
  const rows = [...node.querySelectorAll(`[data-r="${list}"] .tl-row`)];
  const row = typeof idOrIndex === "number" ? rows[Math.min(idOrIndex, rows.length - 1)] : rows.find((r) => (r.dataset.id ?? r.dataset.imp) === idOrIndex);
  const fallback = list === "list" ? '.tl-qbtn[data-act="pin"]' : '[data-act="import"]';
  (row?.querySelector('[data-act="fly"], [data-act="zoom"]') ?? node.querySelector(fallback))?.focus();
}

/** Replace a list's rows without dropping keyboard focus or a rename in progress. */
function rerender(box, html) {
  const a = document.activeElement, inside = box.contains(a);
  const row = inside ? a.closest(".tl-row") : null;
  const form = box.querySelector("form.tl-edit");
  const draft = form && { id: form.dataset.id, title: form.elements.title.value, notes: form.elements.notes.value, field: inside && form.contains(a) ? a.name : null };
  box.innerHTML = html;
  if (row) {
    const attr = row.dataset.id ? "id" : "imp";
    box.querySelector(`.tl-row[data-${attr}="${CSS.escape(row.dataset[attr])}"] [data-act="${a.dataset.act}"]`)?.focus();
  }
  const f = draft && box.querySelector(`form.tl-edit[data-id="${CSS.escape(draft.id)}"]`);
  if (f) {
    f.elements.title.value = draft.title;
    f.elements.notes.value = draft.notes;
    if (draft.field) f.elements[draft.field]?.focus();
  }
}
function renderPlacesList() {
  const node = panelLive();
  if (!node) return;
  const list = node.querySelector('[data-r="list"]');
  node.querySelector('[data-r="count"]').textContent = P.list.length ? `Places · ${P.list.length}` : "Places";
  const sw = node.querySelector('[data-act="show"]');
  sw.setAttribute("aria-pressed", String(P.show));
  sw.hidden = !P.list.length;
  const opening = P.editing && !list.querySelector(`form.tl-edit[data-id="${CSS.escape(P.editing)}"]`);
  rerender(list, P.list.length
    ? P.list.map(placeRow).join("")
    : `<div class="tl-empty"><span class="tl-ico">${icon(I.bookmark, 18)}</span><div><div class="t">No saved places yet</div><div class="s">Drop a pin${coarse() ? "" : " (P)"}, save this view, or measure a path and save it.</div></div></div>`);
  for (const b of node.querySelectorAll("[data-exp]")) b.disabled = !P.list.length;
  node.querySelector('[data-r="note"]').textContent = P.storage
    ? `Places are kept in this browser's local storage and imported files in its IndexedDB. Clearing site data removes them, so export anything you want to keep.${coarse() ? "" : " Press ? for keyboard shortcuts."}`
    : "This browser is blocking storage, so places last only until you close the tab. Export them to keep a copy.";
  if (opening) {
    const input = list.querySelector(`form.tl-edit[data-id="${CSS.escape(P.editing)}"] input`);
    input?.focus();
    input?.select();
  }
}
function placeRow(p) {
  if (P.editing === p.id) {
    return `<form class="tl-edit" data-id="${esc(p.id)}">
      <label class="tl-field"><span>Title</span><input class="input" name="title" maxlength="200" value="${esc(p.title)}" autocomplete="off" required></label>
      <label class="tl-field"><span>Notes</span><textarea class="input" name="notes" rows="3" maxlength="4000" placeholder="Add a note">${esc(p.notes)}</textarea></label>
      <div class="tl-edit-actions"><button type="submit" class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button></div>
    </form>`;
  }
  const ico = { pin: I.pin, view: I.view, path: I.path, area: I.area }[p.kind];
  return `<div class="tl-row" data-id="${esc(p.id)}">
    <button type="button" class="row-btn" data-act="fly" aria-label="${esc(`${p.title}: fly there`)}">
      <span class="tl-ico">${icon(ico, 18)}</span>
      <span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(placeSub(p))}</span></span>
    </button>
    <button type="button" class="icon-btn" data-act="edit" aria-label="Rename or add notes to ${esc(p.title)}">${icon(I.edit, 15)}</button>
    <button type="button" class="icon-btn" data-act="del" aria-label="Delete ${esc(p.title)}">${icon(I.trash, 15)}</button>
  </div>`;
}

function renderImportsList() {
  const node = panelLive();
  if (!node) return;
  const box = node.querySelector('[data-r="imports"]');
  const recs = [...imports.values()];
  rerender(box, recs.map((r) => {
    const on = app.layers.isOn(r.id);
    return `<div class="tl-row" data-imp="${esc(r.id)}">
      <button type="button" class="row-btn" data-act="zoom" aria-label="${esc(`${r.title}: zoom to`)}">
        <span class="tl-ico"><span class="tl-swatch" style="--c:${esc(r.color)}"></span></span>
        <span class="grow"><span class="t">${esc(r.title)}</span><span class="s">${esc(statsText(r.stats))} · ${esc(r.fileName)}${r.volatile ? " · not saved" : ""}</span></span>
      </button>
      <button type="button" class="tl-switchbtn" data-act="vis" aria-pressed="${on}" aria-label="Show ${esc(r.title)} on the map"><span class="switch"></span></button>
      <button type="button" class="icon-btn" data-act="keep" aria-label="Copy ${esc(r.title)} into My places">${icon(I.keep, 15)}</button>
      <button type="button" class="icon-btn" data-act="rm" aria-label="Remove ${esc(r.title)}">${icon(I.trash, 15)}</button>
    </div>`;
  }).join(""));
  box.hidden = !recs.length;
}

function onPanelClick(e) {
  const b = e.target.closest("button");
  if (!b || !P.node?.contains(b)) return;
  const act = b.dataset.act;
  if (b.dataset.exp) return exportPlaces(b.dataset.exp);
  if (act === "pin") return app.mode === "pin" ? stopPin() : startPin();
  if (act === "view") {
    const p = saveView();
    if (p) app.ui.toast("View saved to My places");
    return;
  }
  if (act === "measure") return M.on ? stopMeasure() : startMeasure("distance");
  if (act === "import") return P.node.querySelector('[data-r="file"]').click();
  if (act === "show") {
    P.show = !P.show;
    store.set(SHOW_KEY, P.show);
    drawPlaces();
    b.setAttribute("aria-pressed", String(P.show));
    return;
  }
  if (act === "cancel") {
    const id = b.closest("form")?.dataset.id;
    P.editing = null;
    renderPlacesList();
    return focusRow("list", id);
  }
  const row = b.closest("[data-id]");
  if (row && !row.matches("form")) {
    const p = findPlace(row.dataset.id);
    if (!p) return;
    if (act === "fly") { flyToPlace(p); showPlaceCard(p); }
    else if (act === "edit") { P.editing = p.id; renderPlacesList(); }
    else if (act === "del") {
      const at = [...row.parentElement.children].indexOf(row);
      removePlace(p.id);
      focusRow("list", at);
    }
    return;
  }
  const imp = b.closest("[data-imp]");
  if (imp) {
    const rec = imports.get(imp.dataset.imp);
    if (!rec) return;
    if (act === "zoom") { if (!app.layers.isOn(rec.id)) app.layers.toggle(rec.id, true).catch(() => {}); frameBox(rec.bbox); }
    else if (act === "vis") app.layers.toggle(rec.id).catch(() => {});
    else if (act === "keep") keepImport(rec);
    else if (act === "rm") {
      const at = [...imp.parentElement.children].indexOf(imp);
      removeImport(rec.id).then(() => focusRow("imports", at));
    }
  }
}
function onPanelSubmit(e) {
  const form = e.target.closest("form.tl-edit");
  if (!form) return;
  e.preventDefault();
  const p = findPlace(form.dataset.id);
  if (p) {
    const title = form.elements.title.value.trim().slice(0, 200) || "Untitled";
    if (p.title !== title) delete p.named;
    p.title = title;
    p.notes = form.elements.notes.value.slice(0, 4000);
  }
  P.editing = null;
  savePlaces();
  P.node?.querySelector(`.tl-row[data-id="${CSS.escape(form.dataset.id)}"] [data-act="fly"]`)?.focus();
}

/* ---------------------------------------------------------------- pin mode */
function startPin() {
  notePausedStory("drop a pin");
  app.emit("mode:claim", "pin");
  if (M.on) stopMeasure();
  closeShare();
  // Phone sheets cover the lower map and the hint; get them out of the way to aim the pin.
  if (isPhone()) { if (app.ui.current) app.ui.closePanel(); app.ui.hideCard(); }
  app.mode = "pin";
  document.body.classList.add("tl-drawing");
  // On a phone the pill leaves the map-control column clear, so it says it in fewer words.
  UI.hint.querySelector("span").textContent = coarse()
    ? isPhone() ? "Tap to drop a pin" : "Tap the map to drop a pin"
    : "Click the map to drop a pin, or press Space for the centre";
  UI.hint.hidden = false;
  syncToolbar();
}
function dropPinAt(point) {
  const ll = groundAt(point, 6);
  if (!ll) { app.ui.toast(`${coarse() ? "Tap" : "Click"} on the Earth to drop the pin.`); return; }
  stopPin();
  dropPin(ll[0], ll[1]);
}
function stopPin() {
  if (app.mode !== "pin" && UI.hint?.hidden !== false) return;
  if (app.mode === "pin") app.mode = null;
  if (!M.on) document.body.classList.remove("tl-drawing");
  UI.hint.hidden = true;
  syncToolbar();
}
function buildHint() {
  const el = document.createElement("div");
  el.className = "tl-hintpill wglass";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.innerHTML = `${icon(I.pin, 16)}<span></span><button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>`;
  el.querySelector("button").addEventListener("click", stopPin);
  document.body.append(el);
  UI.hint = el;
  // Centre crosshair for keyboard drawing (shown only after a key press while a tool is on).
  const ret = document.createElement("div");
  ret.className = "tl-reticle";
  ret.setAttribute("aria-hidden", "true");
  ret.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 4v8M16 20v8M4 16h8M20 16h8" stroke="#fff" stroke-width="4"/><path d="M16 4v8M16 20v8M4 16h8M20 16h8" stroke="#141414" stroke-width="1.8"/><circle cx="16" cy="16" r="1.8" fill="#141414" stroke="#fff" stroke-width="1.2"/></svg>`;
  document.body.append(ret);
  addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") document.body.classList.remove("tl-keynav"); }, { passive: true });
  addEventListener("pointerdown", () => document.body.classList.remove("tl-keynav"), { passive: true });
}

/* ================================================================ import */
const imports = new Map();
const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
const stripExt = (name) => String(name).replace(/\.[a-z0-9]+$/i, "") || "Imported data";
function slugify(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "data";
}
function uniqueSlug(title) {
  const base = slugify(title);
  let slug = base, i = 2;
  while (imports.has(`user:${slug}`)) slug = `${base}-${i++}`;
  return slug;
}
function countGeoms(col) {
  const s = { points: 0, lines: 0, polygons: 0 };
  for (const f of col.features) {
    const t = f.geometry.type;
    if (t === "Point") s.points++;
    else if (t === "MultiPoint") s.points += f.geometry.coordinates.length;
    else if (t === "LineString" || t === "MultiLineString") s.lines++;
    else if (t === "Polygon" || t === "MultiPolygon") s.polygons++;
  }
  return s;
}
function statsText(s) {
  const parts = [];
  if (s.points) parts.push(plural(s.points, "point"));
  if (s.lines) parts.push(plural(s.lines, "line"));
  if (s.polygons) parts.push(plural(s.polygons, "area"));
  return parts.join(" · ") || "No features";
}

// XML helpers that ignore namespace prefixes (kml:Placemark, gx:Track, …).
function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("the file is not valid XML");
  return doc;
}
const byTag = (el, name) => [...el.getElementsByTagNameNS("*", name)];
const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
const kid = (el, name) => [...el.children].find((c) => c.localName === name) ?? null;
const kidText = (el, name) => (el && kid(el, name)?.textContent.trim()) || "";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// simplestyle-spec properties → sanitised internal style keys the map layers read.
function simpleStyle(p) {
  const out = {};
  const col = (v) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : undefined);
  const unit = (v) => (v !== "" && v != null && Number.isFinite(+v) ? clamp(+v, 0, 1) : undefined);
  const w = +p["stroke-width"];
  const s = { _stroke: col(p.stroke), _fill: col(p.fill), _marker: col(p["marker-color"]), _so: unit(p["stroke-opacity"]), _fo: unit(p["fill-opacity"]), _sw: Number.isFinite(w) && w > 0 ? clamp(w, 0.5, 12) : undefined };
  for (const [k, v] of Object.entries(s)) if (v !== undefined) out[k] = v;
  return out;
}

const GEO_DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
function validCoords(c, depth) {
  let x = c;
  for (let i = 0; i < depth; i++) { if (!Array.isArray(x) || !x.length) return false; x = x[0]; }
  return Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]);
}
function checkLonLat(feats) {
  let bad = 0, seen = 0;
  for (const f of feats) {
    const b = bboxOf(f.geometry.coordinates);
    if (Math.abs(b[0]) > 540 || Math.abs(b[2]) > 540 || Math.abs(b[1]) > 90.5 || Math.abs(b[3]) > 90.5) bad++;
    if (++seen >= 300) break;
  }
  if (bad && bad * 2 >= seen) throw new Error("its coordinates are not longitude/latitude in degrees; re-export it as WGS 84 (EPSG:4326)");
}

function parseGeoJSON(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error("the file is not valid JSON"); }
  const feats = [];
  const push = (geom, props) => {
    if (!geom || typeof geom !== "object") return;
    if (geom.type === "GeometryCollection") { for (const g of geom.geometries ?? []) push(g, props); return; }
    if (!(geom.type in GEO_DEPTH) || !validCoords(geom.coordinates, GEO_DEPTH[geom.type])) return;
    const pr = props && typeof props === "object" ? { ...props } : {};
    feats.push({ type: "Feature", properties: { ...pr, ...simpleStyle(pr), ...(pr.baryon_kind ? { _plain: 1 } : {}) }, geometry: { type: geom.type, coordinates: geom.coordinates } });
  };
  const take = (f) => (f?.type === "Feature" ? push(f.geometry, f.properties) : push(f, {}));
  if (Array.isArray(obj)) obj.forEach(take);
  else if (obj?.type === "FeatureCollection") (Array.isArray(obj.features) ? obj.features : []).forEach(take);
  else take(obj);
  checkLonLat(feats);
  return { name: typeof obj?.name === "string" ? obj.name : "", fc: fc(feats), skipped: "" };
}

const kmlCoords = (s) => s.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => [a[0], a[1]]);
const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
function kmlGeoms(el) {
  const out = [];
  for (const c of el.children) {
    const t = c.localName;
    if (t === "Point") {
      const p = kmlCoords(kidText(c, "coordinates"))[0];
      if (p) out.push({ type: "Point", coordinates: p });
    } else if (t === "LineString" || t === "LinearRing") {
      const l = kmlCoords(kidText(c, "coordinates"));
      if (l.length >= 2) out.push({ type: "LineString", coordinates: l });
    } else if (t === "Polygon") {
      const outer = kid(c, "outerBoundaryIs");
      const ringsOf = (b) => kids(b, "LinearRing").map((r) => closeRing(kmlCoords(kidText(r, "coordinates"))));
      const shell = outer ? ringsOf(outer)[0] : null;
      if (!shell || shell.length < 4) continue;
      const holes = kids(c, "innerBoundaryIs").flatMap(ringsOf).filter((r) => r.length >= 4);
      out.push({ type: "Polygon", coordinates: [shell, ...holes] });
    } else if (t === "MultiGeometry" || t === "MultiTrack") out.push(...kmlGeoms(c));
    else if (t === "Track") {
      const l = kids(c, "coord").map((e) => e.textContent.trim().split(/\s+/).map(Number)).filter((a) => Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => [a[0], a[1]]);
      if (l.length >= 2) out.push({ type: "LineString", coordinates: l });
    }
  }
  return out;
}
function kmlColor(el) {
  const t = kidText(el, "color").replace(/^#/, "");
  if (!/^[0-9a-f]{8}$/i.test(t)) return null;
  return { hex: `#${t.slice(6, 8)}${t.slice(4, 6)}${t.slice(2, 4)}`, a: parseInt(t.slice(0, 2), 16) / 255 };
}
function kmlStyle(s) {
  const out = {};
  const ls = kid(s, "LineStyle"), ps = kid(s, "PolyStyle"), is = kid(s, "IconStyle");
  if (ls) {
    const c = kmlColor(ls);
    if (c) { out._stroke = c.hex; out._so = c.a; }
    const w = parseFloat(kidText(ls, "width"));
    if (w > 0) out._sw = clamp(w, 0.5, 12);
  }
  if (ps) {
    const c = kmlColor(ps);
    if (c) { out._fill = c.hex; out._fo = c.a; }
    if (kidText(ps, "fill") === "0") out._fo = 0;
    if (kidText(ps, "outline") === "0") out._so = 0;
  }
  if (is) { const c = kmlColor(is); if (c) out._marker = c.hex; }
  return out;
}
function kmlStyleResolver(doc) {
  const styles = new Map();
  for (const s of byTag(doc, "Style")) { const id = s.getAttribute("id"); if (id) styles.set(id, kmlStyle(s)); }
  for (const sm of byTag(doc, "StyleMap")) {
    const id = sm.getAttribute("id");
    const pairs = kids(sm, "Pair");
    const pair = pairs.find((p) => kidText(p, "key") === "normal") ?? pairs[0];
    if (!id || !pair) continue;
    const inline = kid(pair, "Style");
    styles.set(id, inline ? kmlStyle(inline) : { ref: kidText(pair, "styleUrl").replace(/^.*#/, "") });
  }
  return (url) => {
    let s = styles.get(String(url || "").replace(/^.*#/, ""));
    for (let i = 0; s?.ref && i < 6; i++) s = styles.get(s.ref);
    return s && !s.ref ? s : {};
  };
}
function parseKML(text) {
  const doc = parseXML(text);
  if (!byTag(doc, "kml").length && !byTag(doc, "Placemark").length) throw new Error("the file is XML but not KML");
  const styleOf = kmlStyleResolver(doc);
  const feats = [];
  let empty = 0;
  for (const pm of byTag(doc, "Placemark")) {
    const props = {};
    const name = kidText(pm, "name"), desc = kidText(pm, "description");
    if (name) props.name = name;
    if (desc) props.description = desc;
    for (const d of byTag(pm, "Data")) { const k = d.getAttribute("name"); if (k && !(k in props)) props[k] = kidText(d, "value"); }
    for (const d of byTag(pm, "SimpleData")) { const k = d.getAttribute("name"); if (k && !(k in props)) props[k] = d.textContent.trim(); }
    for (let a = pm.parentElement; a; a = a.parentElement) {
      if (a.localName === "Folder") { const fn = kidText(a, "name"); if (fn) props.folder = fn; break; }
    }
    const look = kid(pm, "LookAt");
    if (look) {
      const v = (n) => parseFloat(kidText(look, n));
      const la = { lng: v("longitude"), lat: v("latitude"), range: v("range"), tilt: v("tilt") || 0, heading: v("heading") || 0 };
      if (Number.isFinite(la.lng) && Number.isFinite(la.lat) && la.range > 0) props._lookat = la;
    }
    Object.assign(props, styleOf(kidText(pm, "styleUrl")), kid(pm, "Style") ? kmlStyle(kid(pm, "Style")) : {});
    const geoms = kmlGeoms(pm);
    if (!geoms.length) { empty++; continue; }
    for (const g of geoms) feats.push({ type: "Feature", properties: { ...props }, geometry: g });
  }
  const other = [["NetworkLink", "network link"], ["GroundOverlay", "image overlay"], ["ScreenOverlay", "screen overlay"], ["PhotoOverlay", "photo overlay"]]
    .map(([tag, word]) => [byTag(doc, tag).length, word]).filter(([n]) => n).map(([n, word]) => plural(n, word));
  if (empty) other.push(`${plural(empty, "placemark")} without coordinates`);
  checkLonLat(feats);
  const docEl = byTag(doc, "Document")[0];
  return { name: (docEl && kidText(docEl, "name")) || "", fc: fc(feats), skipped: other.join(", ") };
}

function parseGPX(text) {
  const doc = parseXML(text);
  const feats = [];
  const ll = (el) => { const lat = parseFloat(el.getAttribute("lat")), lon = parseFloat(el.getAttribute("lon")); return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null; };
  const info = (el) => {
    const o = {};
    for (const k of ["name", "type", "sym"]) { const v = kidText(el, k); if (v) o[k] = v; }
    const d = kidText(el, "desc") || kidText(el, "cmt");
    if (d) o.description = d;
    return o;
  };
  for (const w of byTag(doc, "wpt")) {
    const c = ll(w);
    if (!c) continue;
    const p = info(w);
    const ele = parseFloat(kidText(w, "ele"));
    if (Number.isFinite(ele)) p.elevation_m = +ele.toFixed(1);
    const t = kidText(w, "time");
    if (t) p.time = t;
    feats.push(F("Point", c, p));
  }
  const track = (el, segs) => {
    const lines = segs.map((s) => s.map(ll).filter(Boolean)).filter((l) => l.length >= 2);
    if (!lines.length) return;
    const p = info(el);
    let lo = Infinity, hi = -Infinity, first = "", last = "";
    for (const pt of segs.flat()) {
      const e = parseFloat(kidText(pt, "ele"));
      if (Number.isFinite(e)) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
      const t = kidText(pt, "time");
      if (t) { first ||= t; last = t; }
    }
    p.length_km = +lines.reduce((s, l) => s + pathKm(l), 0).toFixed(3);
    if (Number.isFinite(lo)) { p.elevation_min_m = Math.round(lo); p.elevation_max_m = Math.round(hi); }
    if (first) { p.start = first; p.end = last; }
    feats.push(lines.length === 1 ? F("LineString", lines[0], p) : F("MultiLineString", lines, p));
  };
  for (const t of byTag(doc, "trk")) track(t, kids(t, "trkseg").map((s) => kids(s, "trkpt")));
  for (const r of byTag(doc, "rte")) track(r, [kids(r, "rtept")]);
  const meta = byTag(doc, "metadata")[0], trk = byTag(doc, "trk")[0], rte = byTag(doc, "rte")[0];
  return { name: (meta && kidText(meta, "name")) || (trk && kidText(trk, "name")) || (rte && kidText(rte, "name")) || "", fc: fc(feats), skipped: "" };
}

function parseAny(text, hint) {
  const head = text.slice(0, 4000).replace(/^﻿/, "").trimStart();
  if (hint === "gpx" || /<gpx[\s>]/i.test(head)) return parseGPX(text);
  if (hint === "kml" || /<kml[\s>]/i.test(head)) return parseKML(text);
  if (hint === "geojson" || hint === "json" || head.startsWith("{") || head.startsWith("[")) return parseGeoJSON(text.replace(/^﻿/, ""));
  throw new Error("Baryon reads GeoJSON, KML, KMZ and GPX files");
}

async function importFile(file, opts = {}) {
  const name = file.name || "file";
  const ext = extOf(name);
  if (file.size > MAX_FILE_BYTES) throw new Error(`the file is ${fmt(file.size / 1048576)} MB; the limit is 60 MB`);
  if (ext === "kmz") {
    let fflate;
    try { fflate = await import(FFLATE); } catch { throw new Error("the unzip library for KMZ could not load; unzip the file and import the .kml inside"); }
    let files;
    try { files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => /\.kml$/i.test(f.name) }); } catch { throw new Error("the KMZ archive is damaged"); }
    const keys = Object.keys(files);
    const key = keys.find((k) => /(^|\/)doc\.kml$/i.test(k)) ?? keys.sort()[0];
    if (!key) throw new Error("there is no KML inside the KMZ");
    return importText(name, fflate.strFromU8(files[key]), { ...opts, hint: "kml" });
  }
  return importText(name, await file.text(), opts);
}

async function importText(fileName, text, { hint = extOf(fileName), frame = true } = {}) {
  const parsed = parseAny(String(text ?? ""), hint);
  if (!parsed.fc.features.length) throw new Error(parsed.skipped ? `it has nothing that can be drawn (${parsed.skipped})` : "it has no features with coordinates");
  const rec = await addImport({ fileName, title: parsed.name || stripExt(fileName), fc: parsed.fc });
  if (frame) {
    if (!isPhone() && app.ui.current !== "places") app.ui.openPanel("places");
    frameBox(rec.bbox, 14);
  }
  app.ui.toast(`Added “${rec.title}”: ${statsText(rec.stats)}. It stays in this browser.${parsed.skipped ? ` Skipped ${parsed.skipped}.` : ""}`, { ms: 5200 });
  return rec;
}

async function importFiles(files, opts = {}) {
  const out = [];
  for (const f of files) {
    try { out.push(await importFile(f, opts)); }
    catch (err) { app.ui.toast(`Could not import ${f.name}: ${err.message}.`, { tone: "error", ms: 6500 }); }
  }
  return out;
}

async function addImport({ fileName, title, fc: col, color, id, added, persist = true, on = true }) {
  const slug = id ? id.slice(5) : uniqueSlug(title || stripExt(fileName));
  col.features.forEach((f, i) => { f.properties = { ...(f.properties ?? {}), _i: i }; f.geometry = unwrapGeom(f.geometry); });
  const box = geoBox(col.features.map((f) => f.geometry.coordinates));
  const rec = {
    id: `user:${slug}`, slug, title: String(title || stripExt(fileName)).slice(0, 120), fileName: String(fileName).slice(0, 160), fc: col,
    color: color && HEX.test(color) ? color : USER_COLORS[imports.size % USER_COLORS.length],
    stats: countGeoms(col), bbox: box, added: added ?? new Date().toISOString(), volatile: false,
  };
  imports.set(rec.id, rec);
  defineUserLayer(rec);
  if (persist) {
    idb("readwrite", (s) => s.put({ id: rec.id, title: rec.title, fileName: rec.fileName, color: rec.color, added: rec.added, fc: rec.fc }))
      .catch(() => { rec.volatile = true; renderImportsList(); });
  }
  if (on) await app.layers.toggle(rec.id, true).catch(() => {});
  renderImportsList();
  return rec;
}

function defineUserLayer(rec) {
  app.layers.define({
    id: rec.id,
    title: rec.title,
    category: "My data",
    description: `${statsText(rec.stats)} from your file ${rec.fileName}. Read on this device and kept in this browser; never uploaded.`,
    keywords: ["my data", "my file", "import", "imported", rec.fileName.toLowerCase()],
    source: `Your file ${rec.fileName}`,
    attribution: `Your data: ${rec.fileName}`,
    license: "Your own data",
    kind: "geojson",
    slot: "data",
    user: true,
    add(m) {
      if (imports.get(rec.id) !== rec) throw new Error("this file was removed; import it again to show it");
      addUserLayers(m, rec);
    },
    remove(m) { removeUserLayers(m, rec); },
  });
}
const USER_PARTS = ["fill", "outline", "casing", "line", "hit", "pt", "lbl"];
function removeUserLayers(m, rec) {
  const b = `pin-u-${rec.slug}`;
  for (const part of [...USER_PARTS].reverse()) if (m.getLayer(`${b}-${part}`)) m.removeLayer(`${b}-${part}`);
  if (m.getSource(b)) m.removeSource(b);
}
function addUserLayers(m, rec) {
  const b = `pin-u-${rec.slug}`;
  removeUserLayers(m, rec);
  m.addSource(b, { type: "geojson", data: rec.fc });
  const before = app.layers.anchor("data"), c = rec.color;
  const is = (...types) => ["in", ["geometry-type"], ["literal", types]];
  const POLY = is("Polygon", "MultiPolygon"), LINE = is("LineString", "MultiLineString"), PT = is("Point", "MultiPoint");
  const val = (key, dflt) => ["to-number", ["coalesce", ["get", key], dflt]];
  const stroke = ["to-color", ["coalesce", ["get", "_stroke"], c]];
  const round = { "line-cap": "round", "line-join": "round" };
  m.addLayer({ id: `${b}-fill`, type: "fill", source: b, filter: POLY, paint: { "fill-color": ["to-color", ["coalesce", ["get", "_fill"], c]], "fill-opacity": ["min", val("_fo", 0.24), 0.6] } }, before);
  m.addLayer({ id: `${b}-outline`, type: "line", source: b, filter: POLY, layout: round, paint: { "line-color": stroke, "line-width": val("_sw", 2), "line-opacity": val("_so", 1) } }, before);
  m.addLayer({ id: `${b}-casing`, type: "line", source: b, filter: LINE, layout: round, paint: { "line-color": "rgba(10,10,12,0.5)", "line-width": ["+", val("_sw", 3), 3], "line-opacity": val("_so", 1) } }, before);
  m.addLayer({ id: `${b}-line`, type: "line", source: b, filter: LINE, layout: round, paint: { "line-color": stroke, "line-width": val("_sw", 3), "line-opacity": val("_so", 1) } }, before);
  m.addLayer({ id: `${b}-hit`, type: "line", source: b, filter: ["any", LINE, POLY], paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 14 } }, before);
  m.addLayer({
    id: `${b}-pt`, type: "circle", source: b, filter: PT,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 4, 10, 6.5], "circle-color": ["to-color", ["coalesce", ["get", "_marker"], c]], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.8 },
  }, before);
  m.addLayer({
    id: `${b}-lbl`, type: "symbol", source: b, filter: ["all", PT, ["has", "name"]], minzoom: rec.stats.points > 150 ? 8 : 0,
    layout: { "text-field": ["to-string", ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-anchor": "left", "text-offset": [0.9, 0], "text-max-width": 12, "text-optional": true },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.78)", "text-halo-width": 1.4 },
  }, before);
}

async function removeImport(id, { undo = true } = {}) {
  const rec = imports.get(id);
  if (!rec) return null;
  const at = [...imports.keys()].indexOf(id);
  if (app.layers.isOn(id)) await app.layers.toggle(id, false).catch(() => {});
  imports.delete(id);
  if (app.layers.undefine) app.layers.undefine(id);
  else {
    const def = app.layers.get(id);
    if (def) Object.assign(def, { hidden: true, hiddenFromSearch: true, removed: true });
  }
  app.emit("layers:removed", id);
  idb("readwrite", (s) => s.delete(id)).catch(() => {});
  if ($(`#card-body [data-tl-imp="${CSS.escape(id)}"]`)) app.ui.hideCard();
  renderImportsList();
  if (undo) {
    undoToast(`Removed “${rec.title}”`, async () => {
      if (imports.has(id)) return;
      await addImport({ fileName: rec.fileName, title: rec.title, fc: rec.fc, color: rec.color, id: rec.id, added: rec.added });
      // Back to where it was in the list.
      const rows = [...imports.entries()], back = rows.findIndex(([k]) => k === id);
      if (back < 0 || back === at) return;
      rows.splice(at, 0, ...rows.splice(back, 1));
      imports.clear();
      for (const [k, v] of rows) imports.set(k, v);
      renderImportsList();
    });
  }
  return rec;
}

// KML descriptions are HTML (Google Earth renders them, and so do our KML exports); a
// GeoJSON export of ours carries plain-text notes that may contain "<" or "&".
const descText = (pr) => (pr._plain ? String(pr.description ?? "").trim() : htmlToText(pr.description ?? ""));
function htmlToText(s) {
  const str = String(s ?? "");
  if (!/[<&]/.test(str)) return str.trim();
  const doc = new DOMParser().parseFromString(`<body>${str.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "$&\n")}</body>`, "text/html");
  return (doc.body.textContent ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Copy an imported file's features into My places (pins, paths and areas), skipping ones already there. */
function keepImport(rec) {
  const have = new Set(P.list.map((p) => `${p.kind}|${p.title}|${p.lng.toFixed(5)}|${p.lat.toFixed(5)}`));
  const add = [];
  for (const f of rec.fc.features) {
    if (P.list.length + add.length >= 1000) break;
    const pr = f.properties ?? {};
    const title = String(pr.name ?? pr.title ?? "").trim();
    const notes = descText(pr);
    const g = f.geometry;
    const parts = g.type.startsWith("Multi") ? g.coordinates.map((c) => ({ type: g.type.slice(5), coordinates: c })) : [g];
    for (const part of parts) {
      let obj = null;
      if (part.type === "Point") {
        const [lng, lat] = part.coordinates;
        let camera;
        const cam = typeof pr.camera === "string" ? (() => { try { return JSON.parse(pr.camera); } catch { return null; } })() : pr.camera;
        if (cam && okLL(cam.center)) camera = cam;
        else if (pr._lookat) {
          const la = pr._lookat;
          const z = Number.isFinite(+pr.baryon_zoom) ? +pr.baryon_zoom : zoomForRange(la.range, la.lat);
          camera = { center: [la.lng, la.lat], zoom: z, pitch: la.tilt, bearing: la.heading };
        }
        obj = { kind: pr.baryon_kind === "view" ? "view" : "pin", lng, lat, title: title || (pr.baryon_kind === "view" ? "Saved view" : "Imported point"), notes, camera };
      } else if (part.type === "LineString") obj = { kind: "path", coords: part.coordinates, title: title || "Imported path", notes };
      else if (part.type === "Polygon") obj = { kind: "area", coords: part.coordinates[0].slice(0, -1), title: title || "Imported area", notes };
      const p = obj && cleanPlace({ ...obj, created: new Date().toISOString() });
      if (!p) continue;
      const key = `${p.kind}|${p.title}|${p.lng.toFixed(5)}|${p.lat.toFixed(5)}`;
      if (have.has(key)) continue;
      have.add(key);
      add.push(p);
    }
  }
  if (!add.length) {
    app.ui.toast(`Everything in “${rec.title}” is already in My places.`);
    return 0;
  }
  P.list.unshift(...add.reverse());
  savePlaces();
  app.ui.toast(`Copied ${plural(add.length, "item")} into My places.`);
  return add.length;
}

function showFeatureCard(rec, f) {
  app.ui.hideCard();
  const pr = f.properties ?? {};
  const g = f.geometry;
  const title = String(pr.name ?? pr.title ?? "").trim() || { Point: "Point", MultiPoint: "Points", LineString: "Line", MultiLineString: "Line", Polygon: "Area", MultiPolygon: "Area" }[g.type];
  let sub = "";
  if (g.type === "Point") sub = coordText(g.coordinates[1], g.coordinates[0]);
  else if (g.type === "LineString" || g.type === "MultiLineString") {
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    sub = `Length ${lenText(lines.reduce((s, l) => s + pathKm(l), 0))}`;
  } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    sub = `Area ${areaText(polys.reduce((s, p) => s + areaKm2(p[0].slice(0, -1)) - p.slice(1).reduce((h, r) => h + areaKm2(r.slice(0, -1)), 0), 0))}`;
  } else if (g.type === "MultiPoint") sub = plural(g.coordinates.length, "point");
  const desc = descText(pr);
  const SKIP = new Set(["name", "title", "description", "desc", "styleUrl", "styleHash", "stroke", "stroke-width", "stroke-opacity", "fill", "fill-opacity", "marker-color", "marker-size", "marker-symbol", "camera", "baryon_kind", "baryon_zoom", "length_km"]);
  const LABEL = { elevation_m: "Elevation (from file)", elevation_min_m: "Lowest (from file)", elevation_max_m: "Highest (from file)", start: "Started", end: "Ended", folder: "Folder", type: "Type", time: "Time", created: "Created" };
  const when = (v) => {
    const t = Date.parse(v);
    return Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}T/.test(v) ? v : `${new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  };
  const rows = Object.entries(pr)
    .filter(([k, v]) => !k.startsWith("_") && !SKIP.has(k) && v != null && v !== "" && typeof v !== "object")
    .slice(0, 12)
    .map(([k, v]) => {
      let val = String(v);
      if (/^elevation/.test(k)) val = elevText(+v);
      else if (["time", "start", "end", "created"].includes(k)) val = when(val);
      return [LABEL[k] ?? k.replace(/_/g, " "), val.length > 160 ? `${val.slice(0, 157)}…` : val];
    });
  app.ui.showCard(`<div class="tl-card" data-tl-imp="${esc(rec.id)}">
    <div class="eyebrow">Your data · ${esc(rec.fileName)}</div>
    <h3>${esc(title)}</h3>
    <div class="sub">${esc(sub)}</div>
    ${desc ? `<p class="tl-notes">${esc(desc.length > 900 ? `${desc.slice(0, 897)}…` : desc)}</p>` : ""}
    ${rows.length ? `<dl class="kv" style="margin-top:14px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="zoom">Zoom to</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="keep">Save to My places</button>
      ${g.type === "Point" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="here">What's here</button>` : ""}
    </div>
    <p class="note">From your file. It stays in this browser and is never uploaded.</p>
  </div>`, { onClose: () => highlight(null) });
  highlight(g);
  const root = $(`#card-body [data-tl-imp="${CSS.escape(rec.id)}"]`);
  root.querySelector('[data-act="zoom"]').onclick = () => frameBox(geoBox([g.coordinates]), 16);
  root.querySelector('[data-act="keep"]').onclick = () => keepImport({ ...rec, title, fc: fc([f]) });
  root.querySelector('[data-act="here"]')?.addEventListener("click", () => app.tools.run("get_place_info", { lat: g.coordinates[1], lng: g.coordinates[0], name: pr.name || undefined }).catch(() => {}));
}

/* ================================================================ export */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const kmlXY = (coords) => coords.map(([x, y]) => `${x},${y},0`).join(" ");
function placesToKML(list) {
  const now = new Date().toISOString();
  const marks = list.map((p) => {
    const cam = p.camera;
    const look = cam && (p.kind === "pin" || p.kind === "view")
      ? `\n      <LookAt><longitude>${p.kind === "view" ? cam.center[0] : p.lng}</longitude><latitude>${p.kind === "view" ? cam.center[1] : p.lat}</latitude><altitude>0</altitude><heading>${cam.bearing}</heading><tilt>${cam.pitch}</tilt><range>${Math.round(rangeForZoom(cam.zoom, p.lat))}</range><altitudeMode>relativeToGround</altitudeMode></LookAt>`
      : "";
    const geom = p.kind === "path"
      ? `<LineString><tessellate>1</tessellate><coordinates>${kmlXY(p.coords)}</coordinates></LineString>`
      : p.kind === "area"
        ? `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${kmlXY([...p.coords, p.coords[0]])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        : `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>`;
    const data = [["baryon_kind", p.kind], ["created", p.created], ...(cam ? [["baryon_zoom", cam.zoom]] : [])]
      .map(([k, v]) => `<Data name="${k}"><value>${esc(v)}</value></Data>`).join("");
    return `    <Placemark id="${esc(p.id)}">
      <name>${esc(p.title)}</name>${p.notes ? `\n      <description>${esc(esc(p.notes).replace(/\n/g, "<br>"))}</description>` : ""}${look}
      <styleUrl>#baryon-${p.kind === "pin" || p.kind === "view" ? "point" : "shape"}</styleUrl>
      <ExtendedData>${data}</ExtendedData>
      ${geom}
    </Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Baryon World Model — My places</name>
    <description>Exported from Baryon World Model (https://baryon.industries/world) on ${now}.</description>
    <Style id="baryon-point"><IconStyle><color>ffffffff</color><scale>1.1</scale></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>
    <Style id="baryon-shape"><LineStyle><color>ffffffff</color><width>3</width></LineStyle><PolyStyle><color>40ffffff</color></PolyStyle></Style>
${marks.join("\n")}
  </Document>
</kml>
`;
}
function placesToGeoJSON(list) {
  return JSON.stringify({
    type: "FeatureCollection",
    name: "Baryon World Model — My places",
    generator: "Baryon World Model (https://baryon.industries/world)",
    exported: new Date().toISOString(),
    features: list.map((p) => ({
      type: "Feature",
      id: p.id,
      properties: {
        name: p.title, ...(p.notes ? { description: p.notes } : {}), baryon_kind: p.kind, created: p.created,
        ...(p.camera ? { camera: p.camera } : {}),
        ...(p.kind === "path" || p.kind === "area" ? { stroke: "#ffffff", "stroke-width": 3, ...(p.kind === "area" ? { fill: "#ffffff", "fill-opacity": 0.25 } : {}) } : { "marker-color": "#ffffff" }),
      },
      geometry: p.kind === "path" ? { type: "LineString", coordinates: p.coords }
        : p.kind === "area" ? { type: "Polygon", coordinates: [[...p.coords, p.coords[0]]] }
          : { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  }, null, 2);
}
function exportPlaces(format) {
  if (!P.list.length) { app.ui.toast("Nothing to export yet."); return null; }
  const kml = format === "kml";
  const text = kml ? placesToKML(P.list) : placesToGeoJSON(P.list);
  const name = `baryon-my-places-${localDate()}.${kml ? "kml" : "geojson"}`;
  saveBlob(new Blob([text], { type: kml ? "application/vnd.google-earth.kml+xml" : "application/geo+json" }), name);
  app.ui.toast(`Exported ${plural(P.list.length, "place")} as ${kml ? "KML" : "GeoJSON"}`);
  return { name, text };
}

/* ================================================================ share */
function shareURL() {
  const u = new URL(location.href);
  const h = u.hash.slice(1);
  if (h) {
    const parts = h.split("&").map((part) => {
      if (!/^[lt]=/.test(part)) return part;
      const items = part.slice(2).split(",").filter((x) => { try { return !decodeURIComponent(x).startsWith("user:"); } catch { return true; } });
      return items.length ? `${part.slice(0, 2)}${items.join(",")}` : null;
    }).filter(Boolean);
    u.hash = parts.join("&");
  }
  return u.toString();
}
const embedCode = (url) => `<iframe src="${esc(url)}" width="960" height="600" style="border:0;border-radius:20px" loading="lazy" allow="fullscreen; geolocation" allowfullscreen title="Baryon World Model"></iframe>`;
async function freshShareURL() {
  syncHash();
  await new Promise((r) => setTimeout(r, 300));
  return shareURL();
}

function buildShare() {
  const el = document.createElement("div");
  el.id = "tl-share";
  el.className = "tl-pop wglass";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "tl-share-title");
  el.innerHTML = `
    <div class="tl-pop-head">
      <div><span class="eyebrow">Share</span><h2 id="tl-share-title">This view</h2></div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close share">${icon(I.close, 14)}</button>
    </div>
    <p class="tl-pop-sub" data-r="sub"></p>
    <label class="tl-label" for="tl-share-url">Link</label>
    <div class="tl-copyrow">
      <input id="tl-share-url" class="input" readonly spellcheck="false">
      <button type="button" class="btn btn-primary btn-sm" data-act="copy">Copy</button>
    </div>
    <div class="tl-pop-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="native" hidden>${icon(I.share, 15)}Share…</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="shot">${icon(I.camera, 15)}Screenshot</button>
    </div>
    <label class="tl-label" for="tl-share-embed">Embed on a website</label>
    <textarea id="tl-share-embed" class="input tl-embed" readonly rows="3" spellcheck="false"></textarea>
    <div class="tl-pop-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="copy-embed">Copy embed code</button></div>
    <p class="note">The link opens this camera with the same layers, dates and visual mode. Your saved places and imported files stay in your browser and are not part of it.</p>`;
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "close") closeShare(true);
    else if (act === "copy") {
      const ok = await copyText(el.querySelector("#tl-share-url").value, el.querySelector("#tl-share-url"));
      flashLabel(b, ok ? "Copied" : "Copy");
      app.ui.toast(ok ? "Link copied" : "Could not copy. Select the link and copy it.", { tone: ok ? "info" : "error" });
    } else if (act === "copy-embed") {
      const ok = await copyText(el.querySelector("#tl-share-embed").value, el.querySelector("#tl-share-embed"));
      flashLabel(b, ok ? "Copied" : b.textContent);
      app.ui.toast(ok ? "Embed code copied" : "Could not copy. Select the code and copy it.", { tone: ok ? "info" : "error" });
    } else if (act === "native") {
      try { await navigator.share({ title: "Baryon World Model", text: el.querySelector('[data-r="sub"]').textContent, url: el.querySelector("#tl-share-url").value }); }
      catch (err) { if (err?.name !== "AbortError") app.ui.toast("Sharing was not available.", { tone: "error" }); }
    } else if (act === "shot") screenshot().catch((err) => app.ui.toast(`Screenshot failed: ${err.message}`, { tone: "error" }));
  });
  // The popover is appended to <body> (the tool column is its own stacking context), so Tab
  // is routed as if it sat right after the Share button: in from it, back to it, on to Screenshot.
  const stops = () => [...el.querySelectorAll("button, input, textarea")].filter((x) => !x.disabled && x.getClientRects().length);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = stops();
    if (e.shiftKey && e.target === list[0]) { e.preventDefault(); UI.tb.share.focus(); }
    else if (!e.shiftKey && e.target === list[list.length - 1]) { e.preventDefault(); UI.tb.shot.focus(); closeShare(); }
  });
  UI.tb.share.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || el.hidden) return;
    e.preventDefault();
    stops()[0]?.focus();
  });
  document.body.append(el);
  UI.share = el;
}
function flashLabel(b, text) {
  const was = b.dataset.label ?? b.textContent;
  b.dataset.label = was;
  b.textContent = text;
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.textContent = was; }, 1600);
}
function fillShare() {
  const el = UI.share, url = shareURL(), m = app.map, c = m.getCenter();
  const layers = app.layers.active().filter((id) => !app.layers.get(id)?.base && !id.startsWith("user:")).length;
  el.querySelector("#tl-share-url").value = url;
  el.querySelector("#tl-share-embed").value = embedCode(url);
  el.querySelector('[data-r="sub"]').textContent = `${coordText(c.lat, c.lng)} · eye ${eyeText(rangeForZoom(m.getZoom(), c.lat))}${layers ? ` · ${plural(layers, "layer")} on` : ""}`;
  el.querySelector('[data-act="native"]').hidden = typeof navigator.share !== "function";
}
function placeShare() {
  const el = UI.share;
  if (isPhone()) { el.style.bottom = ""; return; }
  const r = UI.tb.share.getBoundingClientRect();
  el.style.bottom = `${Math.max(14, innerHeight - r.bottom)}px`;
}
function openShare() {
  stopPin();
  syncHash();
  fillShare();
  UI.share.hidden = false;
  placeShare();
  syncToolbar();
  setTimeout(() => { if (!UI.share.hidden) fillShare(); }, 320);
  UI.share.querySelector('[data-act="copy"]').focus({ preventScroll: true });
}
function closeShare(restoreFocus = false) {
  if (!UI.share || UI.share.hidden) return;
  const inside = UI.share.contains(document.activeElement);
  UI.share.hidden = true;
  syncToolbar();
  if (restoreFocus || inside) UI.tb.share.focus({ preventScroll: true });
}
async function copyText(text, field) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const el = field ?? Object.assign(document.createElement("textarea"), { value: text });
    if (!field) { el.style.cssText = "position:fixed;opacity:0;top:0;left:0"; document.body.append(el); }
    el.focus({ preventScroll: true });
    el.select();
    const ok = document.execCommand("copy");
    if (!field) el.remove();
    return ok;
  } catch { return false; }
}

/* ================================================================ screenshot */
function wrapText(g, text, width, maxLines) {
  const words = text.split(" "), lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last && g.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    keep[maxLines - 1] = `${last}…`;
    return keep;
  }
  return lines;
}
function drawStrip(g, W, H, s) {
  const pad = 16 * s, font = `"Poppins", "Segoe UI", Arial, sans-serif`;
  const c = app.map.getCenter();
  const brand = "Baryon World Model";
  // The capture date, said as such so nobody reads it as the imagery date; it matches the file name.
  const meta = `${coordText(c.lat, c.lng)} · captured ${localDate()}`;
  const attr = ($("#status-attr")?.textContent ?? "").replace(/\s+/g, " ").trim();
  g.font = `600 ${13 * s}px ${font}`;
  const bw = g.measureText(brand).width;
  g.font = `400 ${11 * s}px ${font}`;
  const mw = g.measureText(meta).width;
  g.font = `400 ${10 * s}px ${font}`;
  const room = W - pad * 2 - bw - mw - 34 * s;
  const oneLine = !attr || g.measureText(attr).width <= room;
  const lines = oneLine ? [] : wrapText(g, attr, W - pad * 2, 3);
  const lh = 14 * s, base = H - 13 * s;
  const top = base - 16 * s - lines.length * lh;
  const grad = g.createLinearGradient(0, top - 40 * s, 0, H);
  grad.addColorStop(0, "rgba(5,5,7,0)");
  grad.addColorStop(0.45, "rgba(5,5,7,0.55)");
  grad.addColorStop(1, "rgba(5,5,7,0.82)");
  g.fillStyle = grad;
  g.fillRect(0, top - 40 * s, W, H - top + 40 * s);
  const row = base - lines.length * lh;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = "#ffffff";
  g.font = `600 ${13 * s}px ${font}`;
  g.fillText(brand, pad, row);
  g.fillStyle = "rgba(255,255,255,0.78)";
  g.font = `400 ${11 * s}px ${font}`;
  g.fillText(meta, pad + bw + 12 * s, row);
  g.font = `400 ${10 * s}px ${font}`;
  g.fillStyle = "rgba(255,255,255,0.72)";
  if (oneLine && attr) { g.textAlign = "right"; g.fillText(attr, W - pad, row); g.textAlign = "left"; }
  lines.forEach((l, i) => g.fillText(l, pad, row + (i + 1) * lh));
}
// The visual-mode canvas has no preserved drawing buffer, so read it in the same frame
// it renders: visual.js schedules its frame from the map's "render" event before ours.
function captureEffect(fx) {
  return new Promise((resolve) => {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 8;
    const pg = probe.getContext("2d", { willReadFrequently: true });
    let tries = 0, settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const attempt = () => {
      if (settled) return;
      pg.clearRect(0, 0, 8, 8);
      pg.drawImage(fx, fx.width * 0.3, fx.height * 0.3, fx.width * 0.4, fx.height * 0.4, 0, 0, 8, 8);
      const d = pg.getImageData(0, 0, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] > 30) {
          const copy = document.createElement("canvas");
          copy.width = fx.width; copy.height = fx.height;
          copy.getContext("2d").drawImage(fx, 0, 0);
          return done(copy);
        }
      }
      if (++tries > 24) return done(null);
      next();
    };
    const next = () => { app.map.once("render", () => requestAnimationFrame(attempt)); app.map.triggerRepaint(); };
    next();
    setTimeout(() => done(null), 8000);
  });
}
async function composeScreenshot() {
  const m = app.map, src = m.getCanvas();
  const W = src.width, H = src.height;
  if (!W || !H) throw new Error("the map is not ready yet");
  const s = W / (src.clientWidth || W);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d");
  g.fillStyle = "#050507";
  g.fillRect(0, 0, W, H);
  g.drawImage(src, 0, 0, W, H);
  let effect = "standard";
  const fx = document.querySelector("#fx canvas");
  if (fx && fx.width && getComputedStyle(fx).display !== "none") {
    const shot = await captureEffect(fx);
    if (shot) { g.drawImage(shot, 0, 0, W, H); effect = app.visualMode ?? "effect"; }
    else effect = "unavailable";
  }
  try { await document.fonts?.load(`600 ${Math.round(13 * s)}px Poppins`); } catch {}
  drawStrip(g, W, H, s);
  return { canvas: out, effect };
}
async function screenshot({ save = true } = {}) {
  const { canvas, effect } = await composeScreenshot();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("the browser could not encode the image");
  const c = app.map.getCenter();
  const name = `baryon-world-${c.lat.toFixed(4)}_${c.lng.toFixed(4)}-${localDate()}.png`;
  if (save) saveBlob(blob, name);
  shutter();
  app.ui.toast(effect === "unavailable" ? "Screenshot saved (without the visual-mode effect)" : "Screenshot saved");
  return { ok: true, filename: name, width: canvas.width, height: canvas.height, bytes: blob.size, visual_mode: effect === "unavailable" ? "standard (effect not captured)" : effect };
}
function shutter() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = document.createElement("div");
  el.className = "tl-flash";
  el.setAttribute("aria-hidden", "true");
  document.body.append(el);
  setTimeout(() => el.remove(), 600);
}

/* ================================================================ full screen */
const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
const fsSupported = () => {
  const el = document.documentElement;
  return !!(document.fullscreenEnabled ?? document.webkitFullscreenEnabled) && typeof (el.requestFullscreen ?? el.webkitRequestFullscreen) === "function";
};
async function toggleFullscreen(on) {
  const want = on ?? !fsElement();
  if (!fsSupported()) {
    app.ui.toast("Full screen isn't available in this browser.");
    return { ok: false, error: "Full screen isn't available in this browser." };
  }
  const el = document.documentElement;
  try {
    if (want && !fsElement()) await (el.requestFullscreen ?? el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
    else if (!want && fsElement()) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
  } catch (err) {
    app.ui.toast("The browser did not allow full screen.", { tone: "error" });
    return { ok: false, error: `The browser did not allow full screen (${err.message}). It needs a click or key press from the visitor.` };
  }
  return { ok: true, fullscreen: !!fsElement() };
}

/* ================================================================ toolbar, tooltips, help, drop */
const UI = { tb: {}, profKey: "", pointer: false, frameSeq: 0 };

function buildToolbar() {
  const g = document.createElement("div");
  g.className = "ctl-group wglass tl-group";
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", "Tools");
  const btn = (id, ic, tip, key, attrs = "") =>
    `<button type="button" id="tlb-${id}" data-tip="${tip}"${key ? ` data-key="${key}" aria-keyshortcuts="${key.replace(" ", "+")}"` : ""} aria-label="${tip}" ${attrs}>${icon(ic, 18)}</button>`;
  g.innerHTML = [
    btn("measure", I.ruler, "Measure distance and area", "M", 'aria-pressed="false"'),
    btn("pin", I.pin, "Drop a pin", "P", 'aria-pressed="false"'),
    btn("share", I.share, "Share this view", "", 'aria-expanded="false" aria-haspopup="dialog" aria-controls="tl-share"'),
    btn("shot", I.camera, "Save a screenshot", "Shift S"),
    btn("full", I.expand, "Full screen", "F", 'aria-pressed="false"'),
  ].join("");
  $("#controls").append(g);
  UI.tb = { group: g, measure: $("#tlb-measure"), pin: $("#tlb-pin"), share: $("#tlb-share"), shot: $("#tlb-shot"), full: $("#tlb-full") };
  UI.tb.measure.onclick = () => (M.on ? stopMeasure() : startMeasure("distance"));
  UI.tb.pin.onclick = () => (app.mode === "pin" ? stopPin() : startPin());
  UI.tb.share.onclick = () => (UI.share.hidden ? openShare() : closeShare());
  UI.tb.shot.onclick = () => screenshot().catch((err) => app.ui.toast(`Screenshot failed: ${err.message}`, { tone: "error" }));
  UI.tb.full.onclick = () => toggleFullscreen();
  UI.tb.full.hidden = !fsSupported();

  const tip = document.createElement("div");
  tip.className = "tl-tip";
  tip.setAttribute("aria-hidden", "true");
  document.body.append(tip);
  const show = (b) => {
    const keys = (b.dataset.key ?? "").split(" ").filter(Boolean).map((k) => `<kbd>${esc(k)}</kbd>`).join("");
    tip.innerHTML = `<span>${esc(b.dataset.tip)}</span>${keys}`;
    const r = b.getBoundingClientRect();
    tip.style.top = `${r.top + r.height / 2}px`;
    tip.style.right = `${innerWidth - r.left + 10}px`;
    tip.classList.add("on");
  };
  const hide = () => tip.classList.remove("on");
  for (const b of g.querySelectorAll("button")) {
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(b); });
    b.addEventListener("pointerleave", hide);
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) show(b); });
    b.addEventListener("blur", hide);
    b.addEventListener("click", hide);
  }
  UI.tip = tip;
}
function syncToolbar() {
  const tb = UI.tb;
  if (!tb.measure) return;
  tb.measure.setAttribute("aria-pressed", String(M.on));
  tb.pin.setAttribute("aria-pressed", String(app.mode === "pin"));
  tb.share.setAttribute("aria-expanded", String(!!UI.share && !UI.share.hidden));
  const fs = !!fsElement();
  tb.full.setAttribute("aria-pressed", String(fs));
  tb.full.dataset.tip = fs ? "Exit full screen" : "Full screen";
  tb.full.setAttribute("aria-label", tb.full.dataset.tip);
  tb.full.innerHTML = icon(fs ? I.shrink : I.expand, 18);
  const node = panelLive();
  node?.querySelector('.tl-qbtn[data-act="pin"]')?.setAttribute("aria-pressed", String(app.mode === "pin"));
  node?.querySelector('.tl-qbtn[data-act="measure"]')?.setAttribute("aria-pressed", String(M.on));
}

function buildHelp() {
  const rows = (items) => items.map(([keys, what]) => `<div class="tl-key-row"><span>${what}</span><span class="tl-kbds">${keys.map((k) => `<kbd class="tl-kbd">${k}</kbd>`).join("")}</span></div>`).join("");
  const group = (title, items) => `<section><span class="eyebrow">${title}</span>${rows(items)}</section>`;
  const el = document.createElement("div");
  el.className = "tl-modal";
  el.hidden = true;
  el.innerHTML = `<div class="tl-modal-card wglass" role="dialog" aria-modal="true" aria-labelledby="tl-help-title">
    <div class="tl-pop-head">
      <div><span class="eyebrow">Keyboard</span><h2 id="tl-help-title">Shortcuts</h2></div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close shortcuts">${icon(I.close, 14)}</button>
    </div>
    <div class="tl-keys">
      ${group("Move around", [[["T"], "Tilt to 3D or back to flat"], [["N"], "North up"], [["+"], "Zoom in"], [["−"], "Zoom out"], [["Drag"], "Pan the globe"], [["Right-drag"], "Tilt and rotate"]])}
      ${group("Tools", [[["M"], "Measure distance or area"], [["P"], "Drop a pin"], [["Shift", "S"], "Save a screenshot"], [["F"], "Full screen"], [["?"], "Show these shortcuts"]])}
      ${group("Find", [[["/"], "Search the Earth"], [["Esc"], "Close the card or panel"]])}
      ${group("While measuring", [[["Space"], "Add the centre of the view"], [["Enter"], "Finish the line or shape"], [["Double-click"], "Finish at that point"], [["Backspace"], "Remove the last point"], [["Esc"], "Cancel"]])}
    </div>
  </div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest('[data-act="close"]')) closeHelp(); });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeHelp(); return; }
    if (e.key === "Tab") {
      const f = [...el.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    e.stopPropagation();
  });
  document.body.append(el);
  UI.help = el;
}
function openHelp() {
  if (!UI.help.hidden) return;
  UI.helpReturn = document.activeElement;
  UI.help.hidden = false;
  UI.help.querySelector('[data-act="close"]').focus();
}
function closeHelp() {
  if (UI.help.hidden) return;
  UI.help.hidden = true;
  const back = UI.helpReturn;
  if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
}

function buildDrop() {
  const el = document.createElement("div");
  el.className = "tl-drop";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="tl-drop-card wglass"><span class="tl-ico">${icon(I.upload, 20)}</span><div class="t">Drop to add it to the globe</div><div class="s">GeoJSON, KML, KMZ or GPX · read on this device, never uploaded</div></div>`;
  document.body.append(el);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.hidden = false; });
  window.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) el.hidden = true; });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.hidden = true;
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length) importFiles(files, { frame: true });
  });
}

function undoToast(message, onUndo, ms = 8000) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast tl-undo";
  el.setAttribute("role", "status");
  el.innerHTML = `<span></span><button type="button">Undo</button>`;
  el.querySelector("span").textContent = message;
  let gone = false, timer = 0;
  const close = () => { if (gone) return; gone = true; el.classList.add("out"); setTimeout(() => el.remove(), 400); };
  // The countdown waits while the pointer or keyboard focus is on the toast.
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  const hold = () => clearTimeout(timer);
  el.addEventListener("pointerenter", hold);
  el.addEventListener("pointerleave", arm);
  el.addEventListener("focusin", hold);
  el.addEventListener("focusout", arm);
  el.querySelector("button").addEventListener("click", () => { if (!gone) { onUndo(); close(); } });
  host.append(el);
  arm();
}

/* ================================================================ map + keyboard wiring */
// With 3D terrain on the globe, MapLibre 6.4's project() drifts from the picture (about
// 10 px looking straight down, 100+ px tilted), while unproject() reads the rendered
// terrain and lands exactly where things are drawn. Every screen/ground conversion here
// is therefore built on unproject().
const unwrapLng = (lng) => ((lng + 540) % 360) - 180;
// Off the globe (space, or sky in a tilted view) every pixel unprojects to the same
// horizon point, so nudging the point outward or upward changes nothing.
function onGlobe(point) {
  const m = app.map, c = m.getCanvas();
  const a = m.unproject([point.x, point.y]);
  const dx = point.x - c.clientWidth / 2, dy = point.y - c.clientHeight / 2, len = Math.hypot(dx, dy);
  const dirs = len > 1 ? [[0, -1], [dx / len, dy / len]] : [[0, -1]];
  return !dirs.some(([ux, uy]) => {
    const b = m.unproject([point.x + ux * 12, point.y + uy * 12]);
    return Math.abs(b.lng - a.lng) < 1e-9 && Math.abs(b.lat - a.lat) < 1e-9;
  });
}
function groundAt(point, d = 7) {
  if (!onGlobe(point)) return null;
  const ll = app.map.unproject([point.x, point.y]);
  return [+unwrapLng(ll.lng).toFixed(d), +ll.lat.toFixed(d)];
}
/** unproject() linearised around a screen point: maps nearby ground back to the screen. */
function localFrame(point) {
  const m = app.map, h = 8;
  const g = m.unproject([point.x, point.y]), gx = m.unproject([point.x + h, point.y]), gy = m.unproject([point.x, point.y + h]);
  const a = unwrapLng(gx.lng - g.lng) / h, b = unwrapLng(gy.lng - g.lng) / h, c = (gx.lat - g.lat) / h, d = (gy.lat - g.lat) / h;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-20) return null;
  return {
    lng: unwrapLng(g.lng), lat: g.lat, degPerPx: [Math.abs(a) + Math.abs(b), Math.abs(c) + Math.abs(d)],
    toScreen: (ll) => {
      const dl = unwrapLng(ll[0] - g.lng), dp = ll[1] - g.lat;
      return { x: point.x + (d * dl - b * dp) / det, y: point.y + (a * dp - c * dl) / det };
    },
  };
}
/** Where a ground point is drawn: Newton steps on unproject(), seeded by project(). */
function screenOf(ll) {
  let s = app.map.project(ll);
  for (let i = 0; i < 4; i++) {
    const f = localFrame(s);
    if (!f) break;
    const n = f.toScreen(ll);
    const moved = Math.hypot(n.x - s.x, n.y - s.y);
    s = n;
    if (moved < 0.5) break;
  }
  return s;
}

const featBox = new WeakMap(), placeGeoms = new WeakMap();
function placeGeom(p) {
  let g = placeGeoms.get(p);
  if (!g) {
    g = p.kind === "path" ? { type: "LineString", coordinates: geodesic(p.coords) } : { type: "Polygon", coordinates: [geodesic([...p.coords, p.coords[0]])] };
    placeGeoms.set(p, g);
  }
  return g;
}
function boxOf(obj, coords) {
  let b = featBox.get(obj);
  if (!b) { b = geoBox([coords]); featBox.set(obj, b); }
  return b;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Screen distance from a point to a GeoJSON geometry (0 inside a polygon), or Infinity. */
function geomDist(pt, g, proj) {
  const dot = (c) => { const q = proj(c); return Math.hypot(q.x - pt.x, q.y - pt.y); };
  const line = (coords) => {
    let best = Infinity, prev = null;
    for (const c of coords) { const q = proj(c); if (prev) best = Math.min(best, segDist(pt, prev, q)); prev = q; }
    return best;
  };
  const poly = (rings) => {
    const scr = rings.map((r) => r.map(proj));
    if (inRing(pt, scr[0]) && !scr.slice(1).some((h) => inRing(pt, h))) return 0;
    return Math.min(...rings.map(line));
  };
  switch (g.type) {
    case "Point": return dot(g.coordinates);
    case "MultiPoint": return Math.min(...g.coordinates.map(dot));
    case "LineString": return line(g.coordinates);
    case "MultiLineString": return Math.min(...g.coordinates.map(line));
    case "Polygon": return poly(g.coordinates);
    case "MultiPolygon": return Math.min(...g.coordinates.map(poly));
    default: return Infinity;
  }
}
/** What of mine is under a screen point: a saved place or an imported feature, top-most first. */
function hitTest(point) {
  const mine = (P.show && P.list.length) || [...imports.keys()].some((id) => app.layers.isOn(id));
  if (!mine || !onGlobe(point)) return null;
  const frame = localFrame(point);
  if (!frame) return null;
  const { lng, lat } = frame, proj = frame.toScreen;
  const padX = clamp(44 * frame.degPerPx[0], 1e-7, 60), padY = clamp(44 * frame.degPerPx[1], 1e-7, 25);
  const near = (b) => lat >= b[1] - padY && lat <= b[3] + padY && [lng, lng + 360, lng - 360].some((x) => x >= b[0] - padX && x <= b[2] + padX);
  if (P.show) {
    for (const p of P.list) {
      if (p.kind !== "pin" || !near([p.lng, p.lat, p.lng, p.lat])) continue;
      const q = proj([p.lng, p.lat]);
      if (Math.abs(point.x - q.x) <= 12 && point.y - q.y <= 3 && q.y - point.y <= 36) return { place: p };
    }
    for (const p of P.list) {
      if (p.kind !== "path" && p.kind !== "area") continue;
      const g = placeGeom(p);
      if (near(boxOf(p, g.coordinates)) && geomDist(point, g, proj) <= 7) return { place: p };
    }
  }
  const recs = [...imports.values()].filter((r) => app.layers.isOn(r.id)).reverse();
  for (const rank of [["Point", "MultiPoint"], ["LineString", "MultiLineString"], ["Polygon", "MultiPolygon"]]) {
    for (const rec of recs) {
      for (let i = rec.fc.features.length - 1; i >= 0; i--) {
        const f = rec.fc.features[i];
        if (!rank.includes(f.geometry.type) || !near(boxOf(f, f.geometry.coordinates))) continue;
        if (geomDist(point, f.geometry, proj) <= (rank[0] === "Point" ? 9 : 7)) return { rec, feature: f };
      }
    }
  }
  return null;
}
/** Cheap first look while hovering (no terrain read-backs): is anything of mine roughly near
 *  this ground point? Tilted views stretch the ground per pixel, hence the generous margin. */
function anythingNear(ll) {
  if (!ll) return false;
  const m = app.map, deg = ((60 * 360) / (512 * 2 ** m.getZoom())) * (1 + m.getPitch() / 15);
  const lat = ll.lat, lng = ((ll.lng + 540) % 360) - 180;
  const padY = Math.min(90, deg), padX = Math.min(180, deg / Math.max(0.05, Math.cos(lat * RAD)));
  const near = (b) => lat >= b[1] - padY && lat <= b[3] + padY && [lng, lng + 360, lng - 360].some((x) => x >= b[0] - padX && x <= b[2] + padX);
  if (P.show) {
    for (const p of P.list) {
      if (p.kind === "pin" ? near([p.lng, p.lat, p.lng, p.lat]) : p.kind !== "view" && near(boxOf(p, placeGeom(p).coordinates))) return true;
    }
  }
  for (const rec of imports.values()) if (app.layers.isOn(rec.id) && near(rec.bbox)) return true;
  return false;
}
function openHit(hit) {
  if (hit.place) showPlaceCard(hit.place);
  else if (hit.rec) showFeatureCard(hit.rec, hit.feature);
}
function vertexAt(point) {
  const frame = M.pts.length ? localFrame(point) : null;
  if (!frame) return -1;
  let best = -1, dist = 10;
  M.pts.forEach((p, i) => {
    const q = frame.toScreen(p);
    const d = Math.hypot(q.x - point.x, q.y - point.y);
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

function wireMap() {
  const m = app.map;
  m.on("click", (e) => {
    // Another tool (Street View, probes) took over the map since ours started: step aside.
    if (M.on && app.mode !== "measure") stopMeasure();
    if (UI.hint && !UI.hint.hidden && app.mode !== "pin") stopPin();
    if (app.mode === "measure") return onMeasureClick(e);
    if (app.mode === "pin") return dropPinAt(e.point);
    if (app.mode === "tools-select") {
      const hit = UI.claimed;
      app.mode = null;
      UI.claimed = null;
      if (hit) openHit(hit);
    }
  });
  // Claim clicks on my features before any map click handler runs, so the "What's here"
  // card (place.js ignores clicks while app.mode is set) stays out of it.
  $("#map").addEventListener("click", (e) => {
    if (app.mode || e.button !== 0) return;
    const r = m.getCanvasContainer().getBoundingClientRect();
    const hit = hitTest({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!hit) return;
    UI.claimed = hit;
    app.mode = "tools-select";
    setTimeout(() => { if (app.mode === "tools-select") { app.mode = null; UI.claimed = null; } }, 0);
  }, true);
  m.on("dblclick", (e) => {
    if (app.mode !== "measure") return;
    e.preventDefault();
    if (!M.done && canFinish()) finish();
  });
  let hoverRaf = 0, hoverPt = null, hoverLL = null, grabRaf = 0, grabPt = null;
  m.on("mousemove", (e) => {
    if (M.drag) {
      if (!M.drag.moved && Math.hypot(e.point.x - M.drag.start.x, e.point.y - M.drag.start.y) < 3) return;
      M.drag.moved = true;
      M.drag.pt = e.point;
      M.drag.raf ||= requestAnimationFrame(() => {
        const d = M.drag;
        if (!d) return;
        d.raf = 0;
        const ll = groundAt(d.pt);
        if (!ll) return;
        M.pts[d.i] = ll;
        app.map.getSource("meas-path")?.setData(measureFC());
        renderSheet();
      });
      return;
    }
    if (app.mode === "measure") {
      // Touch screens report the tap itself as a move: no rubber band without a hovering pointer.
      if (!M.done && M.pts.length && canHover()) { M.cursorPt = e.point; scheduleLive(); }
      if (!coarse() && M.pts.length) {
        grabPt = e.point;
        grabRaf ||= requestAnimationFrame(() => { grabRaf = 0; document.body.classList.toggle("tl-grab", app.mode === "measure" && vertexAt(grabPt) >= 0); });
      }
      return;
    }
    if (app.mode) return;
    hoverPt = e.point;
    hoverLL = e.lngLat;
    if (!hoverRaf) {
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const hit = !!(hoverPt && anythingNear(hoverLL) && hitTest(hoverPt));
        const c = m.getCanvas();
        if (hit) { c.style.cursor = "pointer"; UI.pointer = true; }
        else if (UI.pointer) { c.style.cursor = ""; UI.pointer = false; }
      });
    }
  });
  m.on("mouseout", () => { if (M.on && (M.cursor || M.cursorPt)) { M.cursor = null; M.cursorPt = null; scheduleLive(); } });
  m.on("mousedown", (e) => {
    if (app.mode !== "measure") return;
    const i = vertexAt(e.point);
    if (i < 0) return;
    e.preventDefault();
    M.drag = { i, start: e.point, moved: false, raf: 0 };
    document.body.classList.add("tl-grabbing");
  });
  window.addEventListener("mouseup", () => {
    const d = M.drag;
    if (!d) return;
    M.drag = null;
    document.body.classList.remove("tl-grabbing");
    if (!d.moved) return;
    cancelAnimationFrame(d.raf);
    const ll = d.pt && groundAt(d.pt);
    if (ll) M.pts[d.i] = ll;
    renderMeasure();
  });
  app.on("layers:changed", ({ id }) => {
    if (!id?.startsWith("user:") || !imports.has(id)) return;
    const hidden = new Set(store.get(HIDDEN_KEY, []));
    if (app.layers.isOn(id)) hidden.delete(id); else hidden.add(id);
    store.set(HIDDEN_KEY, [...hidden]);
    renderImportsList();
  });
  m.on("moveend", () => { if (UI.share && !UI.share.hidden) setTimeout(fillShare, 320); });
  addEventListener("resize", () => { if (UI.share && !UI.share.hidden) placeShare(); if (M.profileOpen) renderProfile(); placeSheet(); });
  // Street View, the probes and tours claim the map the same way: one tool owns clicks at a time.
  app.on("mode:claim", (who) => {
    if (who !== "measure" && M.on) stopMeasure();
    if (who !== "pin" && (app.mode === "pin" || (UI.hint && !UI.hint.hidden))) stopPin();
  });
  app.on("ui:panel", (id) => {
    // On a phone the panel covers the lower map: an empty ruler or an unplaced pin just ends.
    if (id && isPhone() && app.mode === "pin") stopPin();
    if (id && isPhone() && M.on && !M.pts.length) stopMeasure();
    placeSheet();
  });
  app.on("ui:card", (open) => {
    placeSheet();
    if (!open || !$("#card-body [data-tl-imp]")) highlight(null);
    // A hidden card can keep focus (and so swallow the next Esc); hand it back to the page.
    if (!open && $("#card").contains(document.activeElement)) document.activeElement.blur();
  });
  document.addEventListener("fullscreenchange", syncToolbar);
  document.addEventListener("webkitfullscreenchange", syncToolbar);
  document.addEventListener("pointerdown", (e) => {
    if (!UI.share || UI.share.hidden) return;
    if (UI.share.contains(e.target) || UI.tb.share.contains(e.target)) return;
    closeShare();
  }, true);
  addEventListener("storage", (e) => {
    if (e.key !== PLACES_KEY) return;
    loadPlaces();
    drawPlaces();
    renderPlacesList();
  });
}

const stopKey = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
function neutralFocus() {
  const a = document.activeElement;
  return !a || a === document.body || !!a.closest?.("#map");
}
function onKey(e) {
  if (e.defaultPrevented || (UI.help && !UI.help.hidden)) return;
  if (e.key === "Escape" && UI.share && !UI.share.hidden && UI.share.contains(e.target)) return stopKey(e), closeShare(true);
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]") && !e.target.readOnly;
  if (e.key === "Escape") {
    if (typing) return;
    if (UI.share && !UI.share.hidden) return stopKey(e), closeShare(true);
    if (app.mode === "pin") return stopKey(e), stopPin();
    if (M.on) {
      stopKey(e);
      if (!M.done && M.pts.length) clearMeasure();
      else stopMeasure();
    }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  // Keyboard-only drawing: pan with the arrow keys, then Space takes the centre of the view.
  if ((M.on || app.mode === "pin") && e.key === " " && neutralFocus()) {
    e.preventDefault();
    document.body.classList.add("tl-keynav");
    const c = app.map.getCanvas(), point = { x: c.clientWidth / 2, y: c.clientHeight / 2 };
    if (app.mode === "measure") onMeasureClick({ point });
    else if (app.mode === "pin") dropPinAt(point);
    return;
  }
  if (M.on || app.mode === "pin") document.body.classList.add("tl-keynav");
  if (M.on && !M.done) {
    if ((e.key === "Backspace" || e.key === "Delete") && M.pts.length) { e.preventDefault(); undoPoint(); return; }
    if (e.key === "Enter" && neutralFocus() && canFinish()) { e.preventDefault(); finish(); return; }
  }
  const k = e.key;
  if (k === "?") { e.preventDefault(); openHelp(); }
  else if ((k === "m" || k === "M") && !e.shiftKey) { e.preventDefault(); M.on ? stopMeasure() : startMeasure("distance"); }
  else if ((k === "p" || k === "P") && !e.shiftKey) { e.preventDefault(); app.mode === "pin" ? stopPin() : startPin(); }
  else if (k === "S" && e.shiftKey) { e.preventDefault(); screenshot().catch((err) => app.ui.toast(`Screenshot failed: ${err.message}`, { tone: "error" })); }
  else if ((k === "f" || k === "F") && !e.shiftKey) { e.preventDefault(); toggleFullscreen(); }
}

/* ================================================================ agent tools */
function readPoints(input, min) {
  const raw = input?.points;
  if (!Array.isArray(raw)) return null;
  const pts = raw.map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : p && typeof p === "object" ? [Number(p.lng ?? p.lon ?? p.longitude), Number(p.lat ?? p.latitude)] : [NaN, NaN]));
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[1]) > 90 || Math.abs(p[0]) > 360)) {
    throw new Error("points must be [longitude, latitude] pairs in degrees");
  }
  if (pts.length < min) throw new Error(`need at least ${min} points`);
  return pts.map(([lng, lat]) => round6([((lng + 540) % 360) - 180, lat]));
}
function showMeasurement(kind, pts, { profile = false, interactive = false } = {}) {
  startMeasure(kind, { interactive });
  M.pts = pts.map(round6);
  M.done = true;
  M.cursor = null;
  if (profile) M.profileOpen = true;
  renderMeasure();
  const line = geodesic(kind === "area" ? [...pts, pts[0]] : pts);
  frameBox(geoBox([line]), 14, shapeSamples(pts, line));
}
const POINTS_SCHEMA = { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "Vertices as [longitude, latitude] pairs in degrees (longitude first)." };
const placeOut = (p) => ({ id: p.id, kind: p.kind, title: p.title, ...(p.named ? { title_source: "OpenStreetMap (ODbL) via Photon reverse geocoding" } : {}), notes: p.notes || undefined, lat: p.lat, lng: p.lng, created: p.created, ...(p.kind === "path" ? { length_km: +pathKm(p.coords).toFixed(3) } : {}), ...(p.kind === "area" ? { area_km2: +areaKm2(p.coords).toFixed(4) } : {}) });

function defineTools() {
  app.tools.define("measure_distance", {
    description: "Measure the great-circle distance along a path of points and draw it on the globe with a label on every segment (the measure sheet shows the total). Give points as [lng, lat] pairs; with no points it switches the visitor into interactive distance measuring.",
    input_schema: { type: "object", properties: { points: POINTS_SCHEMA } },
    async run(input) {
      let pts;
      try { pts = readPoints(input, 2); } catch (err) { return { ok: false, error: err.message }; }
      if (!pts) { startMeasure("distance"); return { ok: true, interactive: true, message: "Measure mode is on: click the map to add points, double-click or press Enter to finish." }; }
      showMeasurement("distance", pts);
      return { ok: true, ...computeDistance(pts), method: "Great-circle (haversine) on a sphere of radius 6371.0088 km" };
    },
    local: { patterns: [/^measure(?: (?:a |the )?(?:distance|length|path|line))?$/i], parse: () => ({}) },
  });

  app.tools.define("measure_area", {
    description: "Measure the surface area and perimeter of a polygon (at least 3 [lng, lat] points; it closes automatically) on the sphere, and draw it on the globe. With no points it switches the visitor into interactive area measuring.",
    input_schema: { type: "object", properties: { points: POINTS_SCHEMA } },
    async run(input) {
      let pts;
      try { pts = readPoints(input, 3); } catch (err) { return { ok: false, error: err.message }; }
      if (!pts) { startMeasure("area"); return { ok: true, interactive: true, message: "Area mode is on: click at least three points on the map, then double-click or press Enter." }; }
      showMeasurement("area", pts);
      return { ok: true, points: pts.length, ...computeArea(pts), method: "Spherical polygon area (R = 6371.0088 km) with great-circle edges" };
    },
    local: { patterns: [/^measure(?: (?:an |the )?(?:area|surface|polygon|shape))$/i], parse: () => ({}) },
  });

  app.tools.define("elevation_profile", {
    description: "Ground elevation along a path of [lng, lat] points (land and sea floor) from open terrain tiles: total length, lowest, highest, total climb and descent, plus evenly spaced samples. Also draws the path and opens the profile chart.",
    input_schema: {
      type: "object",
      properties: { points: POINTS_SCHEMA, every_km: { type: "number", description: "Spacing of the returned samples in km (default: about 20 samples along the path)." } },
      required: ["points"],
    },
    async run(input) {
      let pts;
      try { pts = readPoints(input, 2); } catch (err) { return { ok: false, error: err.message }; }
      if (!pts) return { ok: false, error: "Give at least two [lng, lat] points." };
      showMeasurement("distance", pts, { profile: true });
      const prof = M.profile?.key === ptsKey(M.pts) && !M.profile.loading ? M.profile : await loadProfile();
      if (!prof || prof.error) return { ok: false, error: prof?.error ?? "The profile was replaced by a newer measurement." };
      const every = Number(input.every_km) > 0 ? Number(input.every_km) : prof.total_km / 20;
      const out = (p) => ({ km: +p.km.toFixed(3), elevation_m: p.m == null ? null : Math.round(p.m), lat: +p.lat.toFixed(5), lng: +(((p.lng + 540) % 360) - 180).toFixed(5) });
      const samples = [];
      let nextKm = 0;
      for (const p of prof.points) {
        if (p.km + 1e-9 < nextKm) continue;
        samples.push(out(p));
        nextKm = p.km + every;
        if (samples.length >= 200) break;
      }
      const known = prof.points.filter((p) => p.m != null);
      return {
        ok: true, total_km: +prof.total_km.toFixed(3), total_mi: +(prof.total_km * 0.621371192).toFixed(3),
        start_m: known.length ? Math.round(known[0].m) : null, end_m: known.length ? Math.round(known[known.length - 1].m) : null,
        min_m: Math.round(prof.min_m), max_m: Math.round(prof.max_m), gain_m: Math.round(prof.gain_m), loss_m: Math.round(prof.loss_m),
        vertices: prof.points.filter((p) => p.vertex).map(out),
        samples, sampled_points: prof.points.length, source: ELEVATION_SOURCE,
        method: "Terrain tiles sampled evenly along the great-circle path plus at every given point; climb and descent sum the rises and falls between samples.",
      };
    },
  });

  app.tools.define("add_placemark", {
    description: "Save a pin to the visitor's My places (kept in their browser) and show it on the globe. Without lat/lng it drops the pin at the centre of the current view.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, title: { type: "string" }, notes: { type: "string" } } },
    async run({ lat, lng, title, notes, _edit }) {
      const c = app.map.getCenter();
      const la = Number.isFinite(+lat) && lat !== null && lat !== "" ? +lat : c.lat;
      const ln = Number.isFinite(+lng) && lng !== null && lng !== "" ? +lng : c.lng;
      if (Math.abs(la) > 90) return { ok: false, error: "lat must be between -90 and 90" };
      const p = await dropPin(+ln.toFixed(6), +la.toFixed(6), { title: title ? String(title) : undefined, notes: notes ? String(notes) : "", edit: !!_edit });
      if (!p) return { ok: false, error: "Could not save the pin." };
      if (!app.map.getBounds().contains([p.lng, p.lat])) app.map.flyTo(cleanCam({ center: [p.lng, p.lat], zoom: Math.max(app.map.getZoom(), 10), speed: 1.3 }));
      return { ok: true, saved_in: "this browser (My places)", ...placeOut(p) };
    },
    local: { patterns: [/^(?:drop (?:a )?pin|add (?:a )?(?:placemark|pin))(?: here)?$/i], parse: () => ({ _edit: true }) },
  });

  app.tools.define("save_view", {
    description: "Save the current camera (centre, zoom, tilt, heading) to the visitor's My places so they can return to it.",
    input_schema: { type: "object", properties: { title: { type: "string" } } },
    async run({ title } = {}) {
      const p = saveView(title ? String(title) : undefined);
      if (!p) return { ok: false, error: "Could not save the view." };
      app.ui.toast("View saved to My places");
      return { ok: true, ...placeOut(p), camera: p.camera };
    },
    local: { patterns: [/^(?:save|bookmark) (?:this )?(?:view|place|spot|camera)$/i], parse: () => ({}) },
  });

  app.tools.define("list_placemarks", {
    description: "List the visitor's My places (pins, saved views, saved paths and areas) with ids, titles, notes and coordinates.",
    input_schema: { type: "object", properties: { open_panel: { type: "boolean", description: "Also open the My places panel." } } },
    async run({ open_panel } = {}) {
      if (open_panel) app.ui.openPanel("places");
      return { count: P.list.length, stored_in: "this browser", places: P.list.map(placeOut), imported_files: [...imports.values()].map((r) => ({ id: r.id, title: r.title, file: r.fileName, ...r.stats, on: app.layers.isOn(r.id) })) };
    },
    local: { patterns: [/^(?:show |open |list )?my (?:places|pins|placemarks|saved places)$/i], parse: () => ({ open_panel: true }) },
  });

  app.tools.define("remove_placemark", {
    description: "Delete one of the visitor's My places by id, or by title (exact match first, then a unique partial match).",
    input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } },
    async run({ id, title } = {}) {
      let p = id ? findPlace(String(id)) : null;
      if (!p && title) {
        const t = String(title).trim().toLowerCase();
        const exact = P.list.filter((x) => x.title.toLowerCase() === t);
        const partial = exact.length ? exact : P.list.filter((x) => x.title.toLowerCase().includes(t));
        if (partial.length > 1) return { ok: false, error: `${partial.length} places match "${title}". Give the id.`, matches: partial.map(placeOut) };
        p = partial[0];
      }
      if (!p) return { ok: false, error: "No saved place matches." };
      removePlace(p.id);
      return { ok: true, removed: placeOut(p) };
    },
  });

  app.tools.define("share_view", {
    description: "Get a link to exactly this view (camera, layers, dates, visual mode) and an iframe embed code, and open the share sheet for the visitor.",
    input_schema: { type: "object", properties: { open: { type: "boolean", description: "Open the share sheet (default true)." } } },
    async run({ open = true } = {}) {
      const url = await freshShareURL();
      if (open) openShare();
      return { ok: true, url, embed: embedCode(url), note: "Imported files and saved places are not included in links." };
    },
    local: { patterns: [/^share(?: this)?(?: view| link| map| location)?$/i, /^(?:copy|get) (?:a |the )?link$/i], parse: () => ({}) },
  });

  app.tools.define("take_screenshot", {
    description: "Save a PNG of the globe as it looks now (including the visual mode and on-map labels), with the data attribution burned into a strip at the bottom.",
    input_schema: { type: "object", properties: {} },
    async run() {
      try { return await screenshot(); } catch (err) { return { ok: false, error: err.message }; }
    },
    local: { patterns: [/^(?:take |save |grab )?(?:a )?(?:screenshot|screen ?shot|snapshot)$/i], parse: () => ({}) },
  });

  app.tools.define("toggle_fullscreen", {
    description: "Enter or leave full screen. Browsers only allow this right after a visitor's click or key press.",
    input_schema: { type: "object", properties: { on: { type: "boolean" } } },
    async run({ on } = {}) { return toggleFullscreen(typeof on === "boolean" ? on : undefined); },
    local: { patterns: [/^(?:go |enter |exit |leave |toggle )?full ?screen(?: mode)?$/i], parse: (m, text) => ({ on: /exit|leave/i.test(text) ? false : undefined }) },
  });
}

/* ================================================================ init */
async function restoreImports() {
  const rows = await idb("readonly", (s) => s.getAll());
  const hidden = new Set(store.get(HIDDEN_KEY, []));
  for (const r of (rows ?? []).sort((a, b) => String(a.added).localeCompare(String(b.added)))) {
    if (!r?.id?.startsWith("user:") || !r.fc?.features?.length) continue;
    await addImport({ fileName: r.fileName ?? "file", title: r.title, fc: r.fc, color: r.color, id: r.id, added: r.added, persist: false, on: !hidden.has(r.id) });
  }
}

export async function init() {
  const u = store.get(UNITS_KEY, null);
  units = u === "imperial" || u === "metric" ? u : /-(US|LR|MM)$/i.test(navigator.language ?? "") ? "imperial" : "metric";
  P.show = store.get(SHOW_KEY, true) !== false;
  loadPlaces();
  P.storage = store.set(PLACES_KEY, P.list);

  buildToolbar();
  buildSheet();
  buildHint();
  watchCredits();
  buildShare();
  buildHelp();
  buildDrop();
  ensurePlacesLayers();
  drawPlaces();
  wireMap();
  document.addEventListener("keydown", onKey);

  app.ui.definePanel("places", {
    title: "My places",
    order: 40,
    icon: icon(I.bookmark),
    render: renderPanel,
    onClose: () => { P.editing = null; },
  });
  defineTools();

  app.myPlaces = {
    list: () => P.list.map((p) => ({ ...p })),
    add: addPlace, remove: removePlace, dropPin, saveView, flyTo: (id) => flyToPlace(findPlace(id)),
    importFile, importFiles, importText, removeImport, keepImport: (id) => keepImport(imports.get(id)),
    imports: () => [...imports.values()].map((r) => ({ id: r.id, title: r.title, fileName: r.fileName, stats: r.stats, bbox: r.bbox, color: r.color })),
    exportKML: () => placesToKML(P.list), exportGeoJSON: () => placesToGeoJSON(P.list), exportPlaces,
    shareURL, composeScreenshot, screenshot,
    measure: { start: startMeasure, stop: stopMeasure, finish, state: () => ({ on: M.on, kind: M.kind, points: M.pts.map((p) => p.slice()), done: M.done, profile: M.profile && !M.profile.loading && !M.profile.error ? { total_km: M.profile.total_km, min_m: M.profile.min_m, max_m: M.profile.max_m, gain_m: M.profile.gain_m, loss_m: M.profile.loss_m } : null }) },
  };

  try { await Promise.race([restoreImports(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
}
