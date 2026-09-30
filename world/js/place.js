// "What's here": click anywhere on Earth for a place card — name, ground elevation,
// weather and local time, the bedrock geology underfoot, Wikipedia knowledge, and
// Baryon resource sites nearby. The card fills in as each provider answers, and
// every block cites its source.
import { app, $, esc, fmt, getJSON, haversineKm } from "./core.js";
import { elevationAt } from "./elevation.js";
import { NOT_A_PLACE, osmKind } from "./search.js";

const INTERACTIVE_PREFIXES = ["res-", "live-", "cat-i-", "pin-", "meas-", "tour-"];
const WIKI_HEADERS = { "Api-User-Agent": "BaryonWorldModel/1.0 (https://baryon.industries/world)" };
let seq = 0, pin = null;

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: e.message }));

// Businesses and venues: the nearest one to a bare point is not what the point is.
const POI_KEYS = new Set(["amenity", "shop", "craft", "office", "healthcare", "club"]);
const LODGING = /^(hotel|guest_house|hostel|motel|apartment|chalet|information)$/;
async function reverse(lat, lng) {
  const d = await getJSON(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`, { timeout: 8000 });
  const p = d.features?.[0]?.properties;
  if (!p) return null;
  const parts = [p.city, p.county, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i);
  return {
    name: p.name ?? p.city ?? p.county ?? p.state ?? p.country,
    parts,
    country: p.country,
    kind: p.name ? osmKind(p) : "", // a nameless house or road is titled with its town, not typed
    poi: Boolean(p.name) && (POI_KEYS.has(p.osm_key) || (p.osm_key === "tourism" && LODGING.test(p.osm_value ?? ""))),
    locality: p.city ?? p.district ?? p.county ?? p.state ?? p.country ?? null,
  };
}
// MET Norway Locationforecast (CC BY 4.0 / NLOD, commercial use allowed). Their
// terms ask for at most 4 decimals and cached repeat calls.
const wxCache = new Map();
const SYMBOL_WORDS = [["clearsky", "clear sky"], ["partlycloudy", "partly cloudy"], ["heavy", "heavy "], ["light", "light "], ["andthunder", " and thunder"], ["showers", " showers"], ["rain", "rain"], ["sleet", "sleet"], ["snow", "snow"], ["fog", "fog"], ["fair", "fair"], ["cloudy", "cloudy"]];
function symbolText(code) {
  if (!code) return null;
  let s = code.replace(/_(day|night|polartwilight)$/, "");
  if (s === "partlycloudy") return "Partly cloudy";
  if (s === "clearsky") return "Clear sky";
  for (const [k, v] of SYMBOL_WORDS) s = s.replace(k, v);
  s = s.replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
async function weather(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = wxCache.get(key);
  if (hit && hit.until > Date.now()) return hit.v;
  const d = await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`, { timeout: 8000 });
  const now = d.properties?.timeseries?.[0];
  if (!now) throw new Error("no forecast");
  const i = now.data.instant.details;
  const v = {
    temperature_c: i.air_temperature,
    wind_ms: i.wind_speed,
    wind_from_deg: i.wind_from_direction,
    humidity_pct: i.relative_humidity,
    cloud_pct: i.cloud_area_fraction,
    condition: symbolText(now.data.next_1_hours?.summary?.symbol_code ?? now.data.next_6_hours?.summary?.symbol_code),
    precip_next_hour_mm: now.data.next_1_hours?.details?.precipitation_amount ?? null,
    valid: now.time,
  };
  wxCache.set(key, { v, until: Date.now() + 30 * 60 * 1000 });
  return v;
}
// Time zone from coordinates (tz-lookup, CC0) so the card can show local time.
let tzLookup = null;
async function timeZone(lat, lng) {
  tzLookup ??= import("https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/+esm").then((m) => m.default ?? m);
  const fn = await tzLookup;
  return fn(lat, lng);
}
const compass = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg ?? 0) % 360) / 45) % 8];
/** Macrostrat's lithology string ("Major:{granodiorite}, Minor:{…}" or "clay [5.0%..50.0%]; …") as plain rock names. */
function rockTypes(lith) {
  if (!lith) return "";
  const major = /Major:\s*\{([^}]*)\}/i.exec(lith);
  const names = (major ? major[1] : lith)
    .replace(/\b(Major|Minor|Incidental):/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = [...new Set(names)].slice(0, 4).join(", ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
/** Unit age span, youngest first: thousands of years under 0.1 Ma, else millions. */
function ageSpan(b, t) {
  if (b == null) return "";
  const lo = Math.min(b, t ?? b), hi = Math.max(b, t ?? b);
  if (hi < 0.1) {
    const [a, z] = [fmt(lo * 1000, 1), fmt(hi * 1000, 1)];
    return z === "0" ? "" : `${a}–${z} ka`;
  }
  const [a, z] = [fmt(lo, 1), fmt(hi, 1)];
  return a === "0" && z === "0" ? "" : `${a}–${z} Ma`;
}
// Some national maps in Macrostrat name their units in German, French or Italian
// ("Metamorphe Gesteine, meist Metasedimente") while the lithology is given in English.
const NOT_ENGLISH = /[äöüßàâèéêìîòôùç]|\b(und|mit|meist|oder|der|die|das|et|avec|roches?|rocce|con)\b|\b\w*(gesteine?|sedimente|plutonite|vulkanite|metamorphe|magmatische|sandsteine?|mergel|kalke?|schiefer|gneise?|moränen?|schotter|gletscher)\b/i;
async function geology(lat, lng) {
  const d = await getJSON(`https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lng}&scale=medium`, { timeout: 10000 });
  const u = d.success?.data?.[0];
  if (!u) return null;
  const name = u.name || u.strat_name || "";
  return { name, foreign: NOT_ENGLISH.test(name), age: [u.b_int_name, u.t_int_name].filter((x, i, a) => x && a.indexOf(x) === i).join(" – "), ma: ageSpan(u.b_age, u.t_age), lith: u.lith, rock: rockTypes(u.lith), descrip: u.descrip };
}
/** Geotagged articles near the point, nearest first: places, not events, clubs, broadcasters,
 *  dioceses or hotels, and not articles geotagged here by mistake (a description naming a
 *  place far away: "Palace on the Grand Canal, Venice" beside the Eiffel Tower). `revP`
 *  resolves to the address lookup, which says where the point is. */
const NOT_NEARBY = /\bhotels?\b/i;
async function wikiNearby(lat, lng, revP) {
  const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=10000&ggslimit=30&prop=coordinates%7Cdescription&coprop=type&codistancefrompoint=${lat}%7C${lng}&colimit=max&format=json&formatversion=2&origin=*`, { timeout: 6000, headers: WIKI_HEADERS });
  const list = (d.query?.pages ?? [])
    .map((p) => ({ p, co: p.coordinates?.[0] }))
    .filter(({ co }) => co && Number.isFinite(co.dist))
    .map(({ p, co }) => ({ title: p.title, description: p.description ?? "", lat: co.lat, lon: co.lon, dist: co.dist, type: co.type ?? null }))
    // A year in a title marks an event ("Siege of Paris (1590)"); in a description it is usually a date ("built for the 1878 Exposition").
    .filter((a) => a.type !== "event" && !NOT_A_PLACE.test(`${a.title} ${a.description.replace(/\b\d{4}\b/g, "")}`) && !NOT_NEARBY.test(`${a.title} ${a.description}`))
    .sort((a, b) => a.dist - b.dist);
  const r = await revP;
  const away = await misplaced(list, r?.ok ? r.v : null, lat, lng);
  return list.filter((a) => !away.has(a.title)).slice(0, 8);
}
const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const ALIAS = { us: "united states", usa: "united states", "u.s.": "united states", uk: "united kingdom", "u.k.": "united kingdom" };
/** The place a description ends on ("Palace on the Grand Canal, Venice" -> "Venice"). */
function lastPlace(desc) {
  const i = desc.lastIndexOf(", ");
  if (i < 0) return null;
  const t = desc.slice(i + 2).trim();
  return /^\p{Lu}[\p{L}'\u2019.\- ]{1,40}$/u.test(t) && t.split(/\s+/).length <= 4 ? t : null;
}
const whereCache = new Map();
function whereIs(name) {
  if (!whereCache.has(name)) {
    whereCache.set(name, getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&limit=1&lang=en`, { timeout: 6000 })
      .then((d) => d.features?.[0] ?? null).catch(() => { whereCache.delete(name); return null; }));
  }
  return whereCache.get(name);
}
/** Titles of articles whose description ends on a place that is not this one and lies more
 *  than 150 km away. Places the address lookup already names here are never looked up, and
 *  anything unsure (no address, no answer, a different name) stays in the list. */
async function misplaced(articles, rev, lat, lng) {
  const here = rev ? [rev.name, ...(rev.parts ?? [])].map(fold).filter((k) => k.length >= 3) : [];
  const out = new Set();
  if (!here.length) return out;
  const suspects = new Map();
  for (const a of articles) {
    const t = lastPlace(a.description);
    if (!t) continue;
    const f = ALIAS[fold(t)] ?? fold(t);
    if (here.some((k) => k.includes(f) || f.includes(k))) continue;
    if (!suspects.has(t)) suspects.set(t, []);
    suspects.get(t).push(a.title);
  }
  await Promise.all([...suspects.keys()].slice(0, 3).map(async (t) => {
    const f = await whereIs(t);
    const p = f?.properties, c = f?.geometry?.coordinates;
    if (!p || !c || fold(p.name) !== fold(t)) return;
    const e = p.extent; // [west, north, east, south]
    const inside = e && lng >= e[0] && lng <= e[2] && lat <= e[1] && lat >= e[3];
    if (!inside && haversineKm([lng, lat], c) > 150) for (const title of suspects.get(t)) out.add(title);
  }));
  return out;
}
/** A point without a name borrows the article about that very spot (within 150 m, e.g. the
 *  Eiffel Tower for its coordinates) unless the address lookup names an article itself. */
function spotArticle(S) {
  if (S.name || !S.near?.ok) return null;
  const articles = S.near.v;
  const t = S.rev?.ok ? S.rev.v?.name?.toLowerCase() : null;
  if (t && articles.some((a) => a.title.toLowerCase().startsWith(t))) return null;
  return articles[0] && articles[0].dist <= 150 ? articles[0] : null;
}
/** Summit height of a peak or volcano from Wikidata (P2044, CC0). The terrain model's
 *  ~30 m cells shave 100–250 m off sharp summits, so a summit card quotes the surveyed
 *  height when the article is about a peak at this very point. */
const PEAK = /\b(mountain|peak|volcano|stratovolcano|summit)\b|^hill\b/i;
async function summitHeight(lead, lat, lng) {
  const q = lead?.wikibase_item, c = lead?.coordinates;
  if (!q || !/^Q\d+$/.test(q) || !PEAK.test(lead.description ?? "") || /\b(range|mountains|ranges)\b/i.test(lead.description)) return null;
  if (c && haversineKm([lng, lat], [c.lon, c.lat]) > 1) return null;
  const d = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${q}&property=P2044&format=json&origin=*`, { timeout: 6000 });
  const claims = (d.claims?.P2044 ?? []).filter((x) => x.rank !== "deprecated" && x.mainsnak?.datavalue?.value);
  const v = (claims.find((x) => x.rank === "preferred") ?? claims[0])?.mainsnak.datavalue.value;
  const per = /Q11573$/.test(v?.unit ?? "") ? 1 : /Q3710$/.test(v?.unit ?? "") ? 0.3048 : null; // metre, foot
  const m = per && Number(v.amount) * per;
  return Number.isFinite(m) ? m : null;
}
const WATERY = /\b(bridge|strait|bay|sea|ocean|gulf|channel|harbou?r|lake|river|reef|lagoon|sound|fjord|canal|reservoir|water)\b/i;
/** Terrain-model heights read to the nearest 10 m (1 m near sea level): the model is not finer. */
const approxM = (m) => Math.round(Math.abs(m) >= 100 ? m / 10 : m) * (Math.abs(m) >= 100 ? 10 : 1);
async function wikiSummary(title) {
  // The REST summary follows redirects ("Eiffel tower" -> Eiffel Tower).
  return getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { timeout: 6000, headers: WIKI_HEADERS });
}

/* ---------------------------------------------------------------- photo licences */
// Same rule as the tours: only public-domain, CC0, CC BY, CC BY-SA and Free Art photos,
// each credited; non-free (fair-use) files and local en-wiki uploads are never shown.
const credits = new Map();
function imageFile(url) {
  const m = /\/wikipedia\/(commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url ?? "");
  return m ? { repo: m[1], name: decodeURIComponent(m[2]).replace(/_/g, " ") } : null;
}
const REUSABLE = /^(public domain|cc0|cc[ -]by(?:-sa)?\b|fal\b|free art)/i;
const plain = (html) => (html ? new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim() : "");
function artistName(html) {
  let s = plain(html)
    .replace(/^No machine-readable author provided\.?\s*/i, "")
    .replace(/\s*assumed \(based on copyright claims\)\.?$/i, "")
    .replace(/^User:/i, "")
    .replace(/^photo:\s*/i, ""); // the card already says "Photo:"
  if (s.length > 48) s = `${s.slice(0, 47).replace(/[\s,;:]+\S*$/, "")}…`;
  return s;
}
function imageCredit(url) {
  const f = imageFile(url);
  if (!f || f.repo !== "commons") return Promise.resolve(null);
  if (!credits.has(f.name)) {
    const q = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|Attribution|LicenseShortName|LicenseUrl|NonFree&titles=${encodeURIComponent(`File:${f.name}`)}`;
    credits.set(f.name, getJSON(q, { timeout: 8000, headers: WIKI_HEADERS }).then((d) => {
      const md = d.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata;
      if (!md) return null;
      const license = plain(md.LicenseShortName?.value);
      const licenseUrl = plain(md.LicenseUrl?.value).replace(/^\/\//, "https://");
      return {
        usable: String(md.NonFree?.value ?? "").toLowerCase() !== "true" && REUSABLE.test(license),
        artist: artistName(md.Attribution?.value || md.Artist?.value),
        license,
        licenseUrl: /^https:\/\//.test(licenseUrl) ? licenseUrl : "",
        page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${f.name.replace(/ /g, "_")}`)}`,
      };
    }).catch(() => { credits.delete(f.name); return null; }));
  }
  return credits.get(f.name);
}
/** Card-sized renditions of the page image, never the multi-megabyte original. Wikimedia
 *  serves thumbnails only at its standard widths (330, 500, 960…). */
function heroImage(sum) {
  const t = sum?.thumbnail?.source;
  if (!t) return null;
  const full = sum.originalimage?.width ?? 0;
  const at = (w) => t.replace(/\/\d+px-/, `/${w}px-`);
  if (full <= 500 || !/\/\d+px-/.test(t)) return { src: t, srcset: "" };
  return { src: at(500), srcset: full > 960 ? `${at(500)} 500w, ${at(960)} 960w` : "" };
}

function resourcesNearby(lat, lng, km = 30) {
  const D = app.resources?.D;
  if (!D) return null;
  const out = [];
  for (const s of D.curated) if (haversineKm([lng, lat], [s.lng, s.lat]) <= km) out.push({ name: s.name, commodity: s.commodity, type: s.type, curated: true });
  // The 102k archive is counted only once something else has loaded it.
  let archive = null;
  if (D.bulk) {
    archive = 0;
    for (const f of D.bulk.features) if (Math.abs(f.geometry.coordinates[1] - lat) < km / 100 && haversineKm([lng, lat], f.geometry.coordinates) <= km) archive++;
  }
  return { curated: out, archive, km };
}

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

function setPin(lat, lng) {
  if (!pin) {
    const el = document.createElement("div");
    el.className = "here-pin";
    pin = new app.maplibregl.Marker({ element: el, anchor: "bottom" });
  }
  pin.setLngLat([lng, lat]).addTo(app.map);
}
/** Keep the pin clear of the card: on a phone the card is a bottom sheet. */
function revealPin(lat, lng) {
  const m = app.map, card = $("#card");
  if (card.hidden || m.isMoving()) return;
  const p = m.project([lng, lat]), r = card.getBoundingClientRect();
  const covered = innerWidth <= 720 ? p.y > r.top - 24 : p.x > r.left - 24 && p.x < r.right && p.y > r.top && p.y < r.bottom;
  if (covered) app.ui.frameInto([lng, lat]);
}

const PROVIDERS = { rev: "OpenStreetMap (Photon)", wx: "MET Norway", geo: "Macrostrat", wiki: "Wikipedia", ele: "AWS Terrain Tiles" };
const utcOffset = (zone) => {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName");
    return part ? part.value.replace(/^GMT/, "UTC").replace(/^UTC$/, "UTC+0") : zone;
  } catch { return zone; }
};

/** Everything known so far about the point, as card HTML plus the agent-facing data. */
function compose(S) {
  const { lat, lng, name } = S;
  const place = S.rev?.ok ? S.rev.v : null;
  const spot = spotArticle(S);
  const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  // The nearest shop or café is not what a bare point is: without an article about this spot
  // (or one about that business), the card is titled with the locality instead.
  const own = place?.name && S.near?.ok && S.near.v.some((a) => a.title.toLowerCase().startsWith(place.name.toLowerCase()));
  const placeName = place?.poi && !own ? place.locality ?? coords : place?.name;
  const title = name ?? spot?.title ?? placeName ?? (!S.rev ? "Looking…" : !S.rev.ok ? coords : "Unnamed place");
  const area = (place?.parts ?? []).filter((x) => x !== title).join(", ");
  const lead = S.lead?.ok ? S.lead.v : null;
  const aboutPlace = lead && !S.leadNearby;

  let elev = S.ele?.ok && S.ele.v != null && Number.isFinite(S.ele.v) ? S.ele.v : null;
  if (elev == null && S.ele && app.map.getTerrain()) {
    const e = app.map.queryTerrainElevation([lng, lat]);
    if (e != null) elev = e / (app.map.getTerrain().exaggeration || 1);
  }
  const zone = S.tz?.ok ? S.tz.v : null;
  let localTime = null;
  if (zone) {
    try { localTime = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date()); } catch {}
  }
  const zoneLabel = zone ? (zone.startsWith("Etc/") ? `${utcOffset(zone)} (nautical time zone)` : zone.replace(/_/g, " ")) : "";
  const wx = S.wx?.ok ? S.wx.v : null;
  const geo = S.geo?.ok ? S.geo.v : null;
  const res = resourcesNearby(lat, lng);
  // The card's own article is its headline, not a neighbour.
  const articles = (S.near?.ok ? S.near.v : []).filter((a) => a.title.toLowerCase() !== title.toLowerCase());

  const rows = [];
  const summit = S.summit ?? null;
  // The terrain model includes bathymetry: under a bridge, a strait or open sea it gives the seabed.
  const seabed = elev != null && elev <= -5 && (!place?.name || WATERY.test(`${title} ${place?.kind ?? ""} ${lead?.description ?? ""}`));
  if (summit != null) rows.push(["Elevation", `${fmt(summit)} m above sea level`, `Summit height, Wikidata${elev != null ? ` · terrain model ≈${fmt(approxM(elev))} m` : ""}`]);
  else if (seabed) rows.push(["Seabed", `≈${fmt(Math.abs(approxM(elev)))} m below sea level`, "Water depth from the terrain model's bathymetry"]);
  else if (elev != null) rows.push(["Elevation", `≈${fmt(Math.abs(approxM(elev)))} m ${elev < 0 ? "below" : "above"} sea level`]);
  if (wx) {
    // A forecast, not an observation: say for which hour.
    let at = "";
    try { at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone ?? "UTC" }).format(new Date(wx.valid)); } catch {}
    rows.push(["Weather", `${wx.condition ? `${wx.condition}, ` : ""}${fmt(wx.temperature_c, 1)}°C, wind ${fmt(wx.wind_ms * 3.6)} km/h ${compass(wx.wind_from_deg)}${wx.humidity_pct != null ? `, humidity ${fmt(wx.humidity_pct)}%` : ""}`, `MET Norway forecast${at ? ` for ${at} ${zone ? "local" : "UTC"}` : ""}`]);
  }
  if (localTime) rows.push(["Local time", `${localTime} · ${zoneLabel}`]);
  if (geo) {
    // A unit named in another language reads as its English lithology; the map's own
    // name stays, labelled, underneath.
    const local = geo.foreign && geo.rock;
    const bed = [local ? geo.rock : geo.name, geo.age].filter(Boolean).join(" · ");
    if (bed || geo.ma) rows.push(["Bedrock", `${bed}${geo.ma ? `${bed ? " " : ""}(${geo.ma})` : ""}`, local ? `Source map unit: ${geo.name}` : ""]);
    if (geo.rock && !local) rows.push(["Rock type", geo.rock]);
  }
  if (res && (res.curated.length || res.archive)) {
    rows.push(["Resource sites", `${res.curated.length} key asset${res.curated.length === 1 ? "" : "s"}${res.archive != null ? ` + ${fmt(res.archive)} archive site${res.archive === 1 ? "" : "s"}` : ""} within ${res.km} km`]);
  }

  // Eyebrow: the article's own description when there is one ("Capital and largest city of
  // France"), else the kind of thing when the address lookup found this very place (Photon
  // can match a namesake: a clock called "Paris").
  const sameName = place?.name && place.name.toLowerCase() === title.toLowerCase();
  let eyebrow = (name || spot) && aboutPlace && lead.description ? lead.description : sameName && place.kind ? place.kind : name || spot ? "Place" : "What's here";
  if (eyebrow.length > 48) eyebrow = `${eyebrow.slice(0, 47).replace(/\s+\S*$/, "")}…`;

  const credit = S.credit;
  const hero = aboutPlace && credit?.usable ? heroImage(lead) : null;
  const shown = [];
  const failed = [];
  if (place) shown.push("Place: OpenStreetMap (Photon)");
  if (wx) shown.push("Weather: MET Norway (CC BY 4.0)");
  if (geo) shown.push("Geology: Macrostrat (CC BY 4.0)");
  if (lead || articles.length) shown.push("Wikipedia (CC BY-SA)");
  if (summit != null) shown.push("Summit height: Wikidata (CC0)");
  if (elev != null) shown.push("Elevation: AWS Terrain Tiles terrain model");
  if (res && (res.curated.length || res.archive)) shown.push("Baryon");
  for (const [k, label] of Object.entries(PROVIDERS)) {
    const r = k === "wiki" ? S.near : S[k];
    if (r && !r.ok) failed.push(`${label} did not answer`);
  }
  const waiting = [S.rev, S.wx, S.geo, S.near, S.ele].some((r) => !r) || (S.leadPending ?? false);
  const extract = lead?.extract ? `${lead.extract.slice(0, 420)}${lead.extract.length > 420 ? "…" : ""}` : "";

  const html = `
    ${hero ? `<figure class="hero-img"><img src="${esc(hero.src)}"${hero.srcset ? ` srcset="${esc(hero.srcset)}" sizes="360px"` : ""} alt="" decoding="async" loading="lazy"></figure>
      <p class="hero-credit">Photo: <a href="${esc(credit.page)}" target="_blank" rel="noopener">${esc(credit.artist || "Wikimedia Commons")}</a> · ${credit.licenseUrl ? `<a href="${esc(credit.licenseUrl)}" target="_blank" rel="noopener">${esc(credit.license)}</a>` : esc(credit.license)}</p>` : ""}
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h3>${esc(title)}</h3>
    <div class="sub">${esc(area)}${area ? " · " : ""}${coords}</div>
    ${S.rev && !S.rev.ok ? `<p class="note" style="margin-top:6px">Address lookup unavailable.</p>` : ""}
    ${rows.length ? `<dl class="kv" style="margin-top:14px">${rows.map(([k, v, note]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${note ? `<div class="src">${esc(note)}</div>` : ""}</dd>`).join("")}</dl>` : ""}
    ${extract ? `<p style="margin-top:14px">${S.leadNearby ? `<b>Nearby: ${esc(lead.title)}.</b> ` : ""}${esc(extract)} <a class="link-ul" href="${esc(lead.content_urls?.desktop?.page ?? "#")}" target="_blank" rel="noopener">Wikipedia</a></p>` : ""}
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" data-act="fly">Fly in 3D</button>
      <button class="btn btn-ghost btn-sm" data-act="ask">Ask about this place</button>
      ${res && (res.curated.length || res.archive) ? `<button class="btn btn-ghost btn-sm" data-act="sites">Show sites</button>` : ""}
    </div>
    ${articles.length > 1 ? `<span class="eyebrow" style="display:block;margin:16px 0 4px">Nearby on Wikipedia</span>
      ${articles.slice(0, 6).map((a, i) => `<button class="row-btn" data-wiki="${i}"><span class="grow"><div class="t">${esc(a.title)}</div><div class="s">${fmt(a.dist / 1000, 1)} km away</div></span></button>`).join("")}` : ""}
    <p class="note">${waiting ? "Still asking the other sources… " : ""}${shown.length ? `Sources: ${shown.join(" · ")}.` : ""}${failed.length ? ` ${failed.join(" · ")}.` : ""}</p>`;

  const data = {
    name: title, area: area || undefined, country: place?.country, lat, lng,
    elevation_m: summit != null ? Math.round(summit) : elev != null ? Math.round(elev) : null,
    elevation_source: summit != null ? "Wikidata summit height" : elev != null ? `terrain model (AWS Terrain Tiles), approximate${seabed ? "; seabed under water" : ""}` : undefined,
    ...(summit != null && elev != null ? { terrain_model_m: Math.round(elev) } : {}),
    weather: wx ? { ...wx, source: "MET Norway Locationforecast", note: "forecast for the time in `valid`" } : null,
    time_zone: zone, local_time: localTime,
    geology: geo,
    wikipedia: lead ? { title: lead.title, extract: lead.extract, url: lead.content_urls?.desktop?.page, ...(S.leadNearby ? { relation: "nearest article, not about this point" } : {}) } : null,
    nearby_articles: articles.slice(0, 8).map((a) => ({ title: a.title, km: +(a.dist / 1000).toFixed(1) })),
    resource_sites_nearby: res ? { key_assets: res.curated.slice(0, 20), ...(res.archive != null ? { archive_sites: res.archive } : {}), radius_km: res.km } : null,
    unavailable: failed.length ? failed : undefined,
  };
  return { html, data, title, articles };
}

export async function placeInfo({ lat, lng, name }) {
  const my = ++seq;
  const S = { lat, lng, name };
  setPin(lat, lng);
  const point = { lat, lng };
  app.ui.showCard(`<div class="eyebrow">What's here</div><h3>${esc(name ?? "Looking…")}</h3><div class="sub">${lat.toFixed(5)}, ${lng.toFixed(5)}</div><p class="note">Asking OpenStreetMap, MET Norway, Macrostrat and Wikipedia…</p>`, { onClose: () => pin?.remove(), point, busy: true });

  let shown = false, raf = 0, revealed = false;
  const paint = () => {
    raf = 0;
    if (my !== seq || !shown) return;
    // The visitor may have closed this card, or another module may have replaced it.
    const card = $("#card");
    if (card.hidden || card.dataset.lat !== String(lat) || card.dataset.lng !== String(lng)) return;
    const { html, title, articles } = compose(S);
    app.ui.showCard(html, { onClose: () => pin?.remove(), point, busy: !name && !S.rev });
    const body = $("#card-body");
    body.querySelector(".hero-img img")?.addEventListener("error", () => { S.credit = null; body.querySelector(".hero-img")?.remove(); body.querySelector(".hero-credit")?.remove(); });
    body.querySelector('[data-act="fly"]').onclick = () => app.ui.flyFramed({ center: [lng, lat], zoom: Math.max(13, app.map.getZoom()), pitch: 62, speed: 1.2 });
    body.querySelector('[data-act="ask"]').onclick = () => app.emit("agent:ask", `Tell me about ${title} (${lat.toFixed(4)}, ${lng.toFixed(4)}): what is here, its geology, and anything notable about its resources or environment.`);
    body.querySelector('[data-act="sites"]')?.addEventListener("click", () => app.tools.run("query_resource_sites", { near: { lat, lng, radius_km: 30 }, show_on_map: true }));
    body.querySelectorAll("[data-wiki]").forEach((b) => (b.onclick = () => {
      const a = articles[Number(b.dataset.wiki)];
      placeInfo({ lat: a.lat, lng: a.lon, name: a.title });
      app.ui.flyFramed({ center: [a.lon, a.lat], zoom: Math.max(13, app.map.getZoom()), speed: 1.3 });
    }));
    if (!revealed) { revealed = true; requestAnimationFrame(() => revealPin(lat, lng)); }
  };
  const repaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const track = (key, p) => settle(p).then((r) => { S[key] = r; repaint(); return r; });

  const rev = track("rev", reverse(lat, lng));
  const ele = track("ele", elevationAt(lng, lat, 14));
  const jobs = [rev, ele, track("wx", weather(lat, lng)), track("geo", geology(lat, lng)), track("tz", timeZone(lat, lng))];
  const near = track("near", wikiNearby(lat, lng, rev));
  const named = name ? track("named", wikiSummary(name)) : Promise.resolve(null);

  // The article the card leads with. A named place gets its own article (if it is about
  // somewhere near this point) or an exact title match nearby, never just the nearest
  // one; an anonymous click may borrow the nearest article, labelled as nearby.
  S.leadPending = true;
  const leadJob = (async () => {
    const [n, nr] = await Promise.all([named, near]);
    const articles = nr.ok ? nr.v : [];
    let title = null;
    if (name) {
      const sum = n?.ok ? n.v : null;
      const c = sum?.coordinates;
      // About this point: its coordinates lie close by (big natural features get more room).
      const BIG = /\b(canyon|desert|sea|ocean|lake|river|range|mountains|forest|basin|plateau|national park|island|glacier|bay|gulf)\b/i;
      const reach = BIG.test(sum?.description ?? "") ? 400 : 60;
      if (sum && sum.type !== "disambiguation" && (!c || haversineKm([lng, lat], [c.lon, c.lat]) <= reach)) {
        S.lead = n;
      } else {
        const t = name.toLowerCase();
        title = (articles.find((a) => a.title.toLowerCase() === t) ?? articles.find((a) => a.title.toLowerCase().startsWith(t)))?.title ?? null;
      }
    } else {
      const r = await rev;
      const t = r.ok && r.v?.name ? r.v.name.toLowerCase() : null;
      const own = t && (articles.find((a) => a.title.toLowerCase() === t) ?? articles.find((a) => a.title.toLowerCase().startsWith(t)));
      const spot = own ? null : spotArticle(S);
      title = (own ?? spot ?? articles[0])?.title ?? null;
      S.leadNearby = Boolean(!own && !spot && articles[0]);
    }
    if (title) S.lead = await settle(wikiSummary(title));
    S.leadPending = false;
    const lead = S.lead?.ok ? S.lead.v : null;
    const about = lead && !S.leadNearby;
    const [credit, summit] = await Promise.all([
      about && heroImage(lead) ? imageCredit(lead.thumbnail.source) : null,
      about ? summitHeight(lead, lat, lng).catch(() => null) : null,
    ]);
    S.credit = credit;
    S.summit = summit;
    repaint();
  })();

  // First paint once the address and the ground are known (or after 2.5 s); then the
  // card fills in as each remaining provider answers.
  await Promise.race([Promise.all([rev, ele]), new Promise((r) => setTimeout(r, 2500))]);
  if (my !== seq) return null;
  shown = true;
  paint();
  await Promise.all([...jobs, near, named, leadJob]);
  if (my !== seq) return null;
  paint();
  return compose(S).data;
}

export function init() {
  app.map.on("click", (e) => {
    if (app.mode && app.mode !== "explore") return; // measure / placemark tools own the click
    if (!onGlobe(e.point)) return; // space beside the globe, or sky
    const hit = app.map.queryRenderedFeatures(e.point).some((f) => INTERACTIVE_PREFIXES.some((p) => f.layer.id.startsWith(p)));
    if (hit) return;
    placeInfo({ lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) });
  });
  app.tools.define("get_place_info", {
    description: "Everything the World Model knows about a point on Earth: place name, ground elevation, the MET Norway forecast for the current hour, time zone and local time, bedrock geology (Macrostrat), the Wikipedia article about it (or the nearest article, marked as such) and notable places within 10 km, and Baryon resource sites within 30 km. Also shows a place card and pin on the globe.",
    input_schema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, name: { type: "string" } }, required: ["lat", "lng"] },
    async run(input) { return placeInfo(input); },
    local: {
      patterns: [/^(?:what'?s here|what is here|what am i looking at|where am i|info here|about here|this place)\??$/i],
      parse: () => { const c = app.map.getCenter(); return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) }; },
    },
  });
}
