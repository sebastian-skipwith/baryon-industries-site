// Ground elevation from the same open terrain tiles that draw the 3D globe
// (AWS Terrain Tiles, terrarium encoding: metres = R*256 + G + B/256 - 32768).
// Works with terrain switched off, includes ocean depths, and needs no API.
// Resolution follows the source data: ~10 m in the US (3DEP), ~30 m (SRTM)
// elsewhere on land, coarser (ETOPO1/GEBCO) at sea.
import { haversineKm } from "./core.js";

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const MAX_Z = 15;
const cache = new Map(); // key -> Promise<Float32Array|null>
const CACHE_MAX = 96;

function tileXY(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y, n };
}

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) {
    const p = cache.get(key);
    cache.delete(key);
    cache.set(key, p); // LRU bump
    return p;
  }
  const p = (async () => {
    const res = await fetch(TILE_URL(z, x, y));
    if (!res.ok) { cache.delete(key); return null; }
    const bmp = await createImageBitmap(await res.blob());
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = new Float32Array(bmp.width * bmp.height);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
    out.size = bmp.width;
    return out;
  })().catch(() => { cache.delete(key); return null; });
  cache.set(key, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

/** Elevation in metres at a point (negative = below sea level), or null. */
export async function elevationAt(lng, lat, z = 14) {
  z = Math.min(MAX_Z, Math.max(0, Math.round(z)));
  const { x, y, n } = tileXY(((lng + 540) % 360) - 180, lat, z);
  const tx = Math.floor(x) % n, ty = Math.min(n - 1, Math.floor(y));
  const data = await loadTile(z, tx, ty);
  if (!data) return null;
  const s = data.size;
  // Bilinear sample inside the tile (edges clamp).
  const fx = Math.min(s - 1.001, (x - Math.floor(x)) * s - 0.5), fy = Math.min(s - 1.001, (y - Math.floor(y)) * s - 0.5);
  const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
  const x1 = Math.min(s - 1, x0 + 1), y1 = Math.min(s - 1, y0 + 1);
  const ax = Math.max(0, fx - x0), ay = Math.max(0, fy - y0);
  const v = (xx, yy) => data[yy * s + xx];
  const top = v(x0, y0) * (1 - ax) + v(x1, y0) * ax;
  const bot = v(x0, y1) * (1 - ax) + v(x1, y1) * ax;
  return top * (1 - ay) + bot * ay;
}

/** Elevations for many points, choosing a tile zoom that suits the spread. */
export async function elevations(points, z) {
  if (!points.length) return [];
  if (z == null) {
    let span = 0;
    for (let i = 1; i < points.length; i++) span += haversineKm(points[i - 1], points[i]);
    z = span > 2000 ? 8 : span > 400 ? 10 : span > 60 ? 12 : 14;
  }
  return Promise.all(points.map(([lng, lat]) => elevationAt(lng, lat, z)));
}

/** Sample a path (array of [lng,lat]) into `samples` evenly spaced points with distances and elevations. */
export async function elevationProfile(path, samples = 160) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineKm(path[i - 1], path[i]);
    legs.push(d);
    total += d;
  }
  if (!total) return { total_km: 0, points: [] };
  const pts = [];
  for (let k = 0; k < samples; k++) {
    const target = (total * k) / (samples - 1);
    let acc = 0, i = 0;
    while (i < legs.length - 1 && acc + legs[i] < target) acc += legs[i++];
    const t = legs[i] ? (target - acc) / legs[i] : 0;
    const a = path[i], b = path[i + 1] ?? path[i];
    pts.push({ km: target, lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t });
  }
  const elev = await elevations(pts.map((p) => [p.lng, p.lat]), total > 2000 ? 8 : total > 400 ? 10 : total > 60 ? 12 : 14);
  pts.forEach((p, i) => (p.m = elev[i]));
  const vals = elev.filter((e) => e != null);
  let gain = 0, loss = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].m == null || pts[i - 1].m == null) continue;
    const d = pts[i].m - pts[i - 1].m;
    if (d > 0) gain += d; else loss -= d;
  }
  return { total_km: total, points: pts, min_m: Math.min(...vals), max_m: Math.max(...vals), gain_m: gain, loss_m: loss };
}

export const ELEVATION_SOURCE = "AWS Terrain Tiles (Mapzen): 3DEP, SRTM, GMTED, ETOPO1 and others";
