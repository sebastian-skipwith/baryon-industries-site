// Geocoding through Photon (photon.komoot.io, OpenStreetMap data). Fair use: one
// request at a time with a gap between them, debounced typing, and every answer
// cached in this browser so a place is looked up once.
import { load, save, sleep } from "./util.js";

const PHOTON = "https://photon.komoot.io";
const GAP_MS = 450;
const CACHE_KEY = "geocache";
const CACHE_DAYS = 120;
const MISS_DAYS = 3;

export const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const ST_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));
export const stateAbbr = (name) => ST_BY_NAME[String(name ?? "").toLowerCase()] ?? (STATES[String(name ?? "").toUpperCase()] ? String(name).toUpperCase() : null);

/** "Chesapeake, VA" or "Chesapeake, Virginia" -> { city, st }; anything else -> null. */
export function parseCitySt(s) {
  const m = String(s ?? "").trim().match(/^(\p{L}[\p{L}\p{M} .'’\-]{1,60}),\s*([A-Za-z .]{2,30})$/u);
  if (!m) return null;
  const st = stateAbbr(m[2].trim());
  if (!st) return null;
  return { city: m[1].trim(), st };
}

/* ------------------------------------------------------------------ polite request queue */
let chain = Promise.resolve();
let last = 0;
function photon(path, signal) {
  const run = async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    last = Date.now();
    const res = await fetch(`${PHOTON}${path}`, { signal });
    if (!res.ok) throw new Error(`Photon answered ${res.status}`);
    return res.json();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function placeFrom(f) {
  const p = f?.properties ?? {};
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const st = p.countrycode === "US" ? stateAbbr(p.state) : null;
  const city = p.osm_key === "place" ? p.name : p.city || p.town || p.village || p.name;
  const label = st ? `${city}, ${st}` : [city, p.state, p.country].filter(Boolean).join(", ");
  const detail = [p.osm_key === "place" ? null : p.name, p.county, p.state, p.country].filter(Boolean).join(", ");
  return { label, city, st, lat, lng, country: p.countrycode ?? null, detail, kind: p.osm_value ?? p.type ?? "" };
}

/** Place suggestions for a typed query (towns and cities first), biased toward `bias`. */
export async function searchPlaces(q, { bias, signal } = {}) {
  const query = String(q ?? "").trim();
  if (query.length < 2) return [];
  const b = bias && Number.isFinite(bias.lat) ? `&lat=${bias.lat.toFixed(3)}&lon=${bias.lng.toFixed(3)}` : "";
  const j = await photon(`/api/?q=${encodeURIComponent(query)}&limit=7&lang=en&osm_tag=place${b}`, signal);
  const seen = new Set();
  return (j.features ?? []).map(placeFrom).filter((p) => p && !seen.has(p.label) && seen.add(p.label));
}

/** Nearest town for a coordinate (used after browser geolocation). */
export async function reversePlace(lat, lng) {
  const j = await photon(`/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`);
  const f = j.features?.[0];
  if (!f) return null;
  const p = placeFrom(f);
  if (!p) return null;
  // Keep the visitor's own coordinates; use the town only for the label.
  return { ...p, lat, lng };
}

/* ------------------------------------------------------------------ cached "City, ST" lookup */
let cache = null;
const getCache = () => (cache ??= load(CACHE_KEY, {}) ?? {});
const putCache = (k, v) => {
  const c = getCache();
  c[k] = { ...v, t: Date.now() };
  const keys = Object.keys(c);
  if (keys.length > 800) keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 800).forEach((x) => delete c[x]);
  save(CACHE_KEY, c);
};

/** Cached result for "City, ST" without a network call: a place, null (known miss), or undefined (unknown). */
export function cachedCitySt(label) {
  const parsed = parseCitySt(label);
  if (!parsed) return null;
  const k = `${parsed.city.toLowerCase()}|${parsed.st}`;
  const hit = getCache()[k];
  if (!hit) return undefined;
  const age = (Date.now() - hit.t) / 86400000;
  if (hit.miss) return age < MISS_DAYS ? null : undefined;
  return age < CACHE_DAYS ? { label: hit.label, city: parsed.city, st: parsed.st, lat: hit.lat, lng: hit.lng } : undefined;
}

/** Geocodes "City, ST" (state checked), caching hits and misses. */
export async function geocodeCitySt(label, { bias } = {}) {
  const parsed = parseCitySt(label);
  if (!parsed) return null;
  const known = cachedCitySt(label);
  if (known !== undefined) return known;
  const k = `${parsed.city.toLowerCase()}|${parsed.st}`;
  const b = bias && Number.isFinite(bias.lat) ? `&lat=${bias.lat.toFixed(2)}&lon=${bias.lng.toFixed(2)}` : "";
  const j = await photon(`/api/?q=${encodeURIComponent(`${parsed.city}, ${STATES[parsed.st]}`)}&limit=6&lang=en&osm_tag=place${b}`);
  const hit = (j.features ?? []).map((f) => ({ f, p: placeFrom(f) }))
    .find(({ p }) => p && p.country === "US" && p.st === parsed.st);
  if (!hit) { putCache(k, { miss: true }); return null; }
  const out = { label: `${parsed.city}, ${parsed.st}`, city: parsed.city, st: parsed.st, lat: hit.p.lat, lng: hit.p.lng };
  putCache(k, { label: out.label, lat: out.lat, lng: out.lng });
  return out;
}
