// Omnibox: one search box for the whole Earth — coordinates, places (Photon /
// OpenStreetMap), Baryon's resource sites, commodities, product chains, map layers
// and commands. Enter picks the best hit; anything that reads like a question goes
// to the agent.
import { app, $, $$, esc, getJSON, haversineKm, score } from "./core.js";

const PHOTON = "https://photon.komoot.io/api/";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_HEADERS = { "Api-User-Agent": "BaryonWorldModel/1.0 (https://baryon.industries/world)" };
let items = [], sel = -1, seq = 0, timer = null;
let cur = null;          // the query being answered: its local hits, place hits and lookups still out
let userMoved = false;   // the visitor picked a row with the arrow keys or the pointer
let chosen = false;      // a row was chosen; late answers must not reopen the list
let bulkAsked = false;
const coarse = matchMedia("(pointer: coarse)");
const photonCache = new Map();
const wikiCache = new Map();
const remember = (cache, key, value) => {
  cache.set(key, value);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return value;
};

/* ---------------------------------------------------------------- places */
const ZOOM_BY_TYPE = { country: 4.5, state: 6, county: 8, city: 10.5, district: 12, locality: 12, street: 15, house: 17, other: 12 };
const WATERS = /^(strait|sea|ocean|gulf)$/;
export async function searchPlaces(query, limit = 6) {
  const c = app.map.getCenter();
  // Location bias is rounded so nearby views share a cache entry.
  const z = Math.round(app.map.getZoom());
  const key = `${query.toLowerCase()}|${limit}|${Math.round(c.lat / 5)}|${Math.round(c.lng / 5)}|${z}`;
  if (photonCache.has(key)) return photonCache.get(key);
  const url = `${PHOTON}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&location_bias_scale=0.5&zoom=${z}`;
  const data = await getJSON(url, { timeout: 12000 });
  return remember(photonCache, key, (data.features ?? []).map((f) => {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const where = [p.city, p.state, p.country].filter((x) => x && x !== p.name).join(", ");
    // Regions that straddle the 180° line (Alaska, Fiji) come back as a whole-world-wide
    // box, and far-flung islands (Tokyo's reach 1,800 km into the Pacific) skew others;
    // framing those would show mostly ocean, so fall back to the point.
    const e = p.extent;
    const skewed = e && haversineKm([(e[0] + e[2]) / 2, (e[1] + e[3]) / 2], [lng, lat]) > 300;
    // A place=city can come back typed "district" (Lima, Peru): it is still framed as a city.
    // A strait or sea seen from zoom 12 is open water with no imagery: frame its shores.
    const typeZoom = p.osm_key === "place" && p.osm_value === "city" ? Math.min(ZOOM_BY_TYPE[p.type] ?? 12, ZOOM_BY_TYPE.city)
      : WATERS.test(p.osm_value ?? "") && (p.osm_key === "natural" || p.osm_key === "place") ? 8 : ZOOM_BY_TYPE[p.type] ?? 12;
    return {
      name: p.name ?? p.street ?? query,
      detail: [osmKind(p), where].filter(Boolean).join(" · "),
      lat, lng,
      bbox: e && e[2] - e[0] < 300 && !skewed ? [e[0], e[3], e[2], e[1]] : null,
      crosses_antimeridian: p.extent ? p.extent[2] - p.extent[0] >= 300 : undefined,
      zoom: p.extent && p.extent[2] - p.extent[0] >= 300 ? Math.min(typeZoom, 4) : typeZoom,
      // OpenStreetMap's settlement class (city, town, village…) for places.
      place_class: p.osm_key === "place" ? p.osm_value : undefined,
      country: p.country,
      osm: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : null,
    };
  }));
}

// Wikipedia title prefix search with coordinates: answers in a few hundred ms
// (Photon can take several seconds uncached) and knows mines, peaks, landmarks.
const WIKI_ZOOM_BY_TYPE = { country: 5, adm1st: 7, adm2nd: 9, city: 11, isle: 10, mountain: 12, waterbody: 9, river: 9, glacier: 11, landmark: 14, airport: 13, railwaystation: 15, edu: 15 };
const PLACE_TYPES = ["city", "adm1st", "adm2nd", "adm3rd", "country", "mountain", "river", "waterbody", "isle", "glacier", "landmark"];
// Geotagged articles that are not places: clubs, events, rides, institutions, broadcasters,
// works. ("Commune in …" is a French municipality; "Paris Commune" is not.) Shared with the
// place card's "Nearby on Wikipedia".
export const NOT_A_PLACE = /\b(clubs?|teams?|conference|collision|crash|election|university|college|school|album|film|song|band|season|roller coasters?|rides?|company|treaty|battle|war|revolution|commune(?! in)|marathon|festival|f[êe]tes?|celebrations?|ceremon(?:y|ies)|protests?|tournament|championships?|attack|bombing|shooting|massacre|riot|siege|uprising|assassination|eruptions?|avalanche|disaster|ascents?|expeditions?|flight \d+(?! national)|broadcast\w*|television|tv (?:station|channel|network)|radio station|newspaper|magazine|(?:arch)?dioces[ae]s?|(?:arch)?eparch(?:y|ies)|(?:timeline|history|list|outline|economy|politics|culture|demographics) of)\b|\b\d{4}\b/i;
/** The kind of an OpenStreetMap object in plain words: a road is a street and a footway a
 *  path (not "pedestrian" or "residential"), and an untyped building ("yes") a building. */
const ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street", "pedestrian", "road", "busway", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const PATHS = new Set(["footway", "path", "cycleway", "bridleway", "steps", "track", "corridor"]);
export function osmKind(p) {
  const k = p?.osm_key, v = p?.osm_value;
  if (!v) return "";
  if (k === "highway" && ROADS.has(v)) return "street";
  if (k === "highway" && PATHS.has(v)) return "path";
  if (v === "yes") return k === "building" ? "building" : "";
  return v.replace(/_/g, " ");
}
const PLACE_WORDS = /\b(city|town|village|capital|municipality|commune in|suburb|neighbou?rhood|district|county|state|province|region|country|island|archipelago|mountain|peak|volcano|range|river|lake|bay|sea|ocean|strait|glacier|desert|valley|canyon|plateau|park|airport|station|port|harbou?r|landmark|building|tower|bridge|square|monument|mine)\b/i;
export async function searchWikipediaPlaces(query, limit = 5) {
  const key = `${query.toLowerCase()}|${limit}`;
  if (wikiCache.has(key)) return wikiCache.get(key);
  const url = `${WIKI_API}?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(query)}&gpslimit=${Math.min(20, limit * 3)}&prop=coordinates%7Cdescription&coprop=type%7Cdim%7Ccountry&coprimary=all&colimit=max&format=json&formatversion=2&origin=*`;
  const data = await getJSON(url, { timeout: 6000, headers: WIKI_HEADERS });
  const ql = query.trim().toLowerCase();
  // The exact title keeps its place at the top; typed places then lead the rest.
  const rank = (p) => (p.title.toLowerCase() === ql ? 0 : PLACE_TYPES.includes(p.co.type) ? 1 : 2);
  const pages = (data.query?.pages ?? [])
    .filter((p) => p.coordinates?.length)
    .map((p) => ({ ...p, co: p.coordinates.find((x) => x.primary) ?? p.coordinates[0] }))
    .filter((p) => p.title.toLowerCase() === ql || (p.co.type !== "event" && !NOT_A_PLACE.test(`${p.title} ${(p.description ?? "").replace(/\b\d{4}\b/g, "")}`)))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return remember(wikiCache, key, pages.slice(0, limit).map((p) => {
    const co = p.co;
    const dim = Number(co.dim);
    // Untyped coordinates on a city article ("London") would otherwise frame one street.
    const d = p.description ?? "";
    const type = co.type || (/\b(capital|city)\b/i.test(d) ? "city" : /\b(town|village)\b/i.test(d) ? "town" : null);
    const zoom = { ...WIKI_ZOOM_BY_TYPE, town: 12 }[type] ?? (dim > 0 ? Math.log2(40075016 / (dim * 3)) : 12);
    const placeLike = PLACE_TYPES.includes(co.type) || co.type === "airport" || co.type === "railwaystation" || (!co.type && PLACE_WORDS.test(p.description ?? ""));
    return { name: p.title, detail: p.description ?? "Wikipedia", lat: co.lat, lng: co.lon, zoom: Math.max(3, Math.min(15, zoom)), bbox: null, wiki: true, placeLike };
  }));
}

/* ---------------------------------------------------------------- coordinates */
export function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lng = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lng = -Math.abs(lng);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const looksLikeQuestion = (q) => /\?$|^(what|why|how|which|who|when|where|is|are|can|could|should|does|do|tell|explain|compare|show me|find|list)\b/i.test(q.trim());

/** A command the free local engine runs whole ("earthquakes this week", "copper mines in
 *  Chile", "satellite"): Enter hands it to the assistant instead of geocoding its words.
 *  Place lookups ("fly to …") stay with search. */
function commandFor(q) {
  const t = q.trim().replace(/[?.!]+$/, "");
  if (!t) return null;
  for (const tool of app.tools.list()) {
    if (tool.name === "fly_to" || tool.name === "search_places") continue;
    for (const re0 of tool.local?.patterns ?? []) {
      const re = re0.global || re0.sticky ? new RegExp(re0.source, re0.flags.replace(/[gy]/g, "")) : re0;
      const m = t.match(re);
      if (m && m[0].trim().length >= t.length - 1) return tool.name;
    }
  }
  return null;
}

/* ---------------------------------------------------------------- local hits */
function localHits(q) {
  const out = [];
  const R = app.resources;
  if (R?.D) {
    for (const b of R.D.balances) {
      const s = score(b.name, q);
      if (s >= 40) out.push({ group: "Commodities", score: s + 5, icon: "◆", title: b.name, sub: `${b.production}${b.years != null ? ` · ≈${b.years} years of reserves` : ""}`, run: () => app.tools.run("get_commodity", { name: b.name }) });
    }
    for (const p of R.D.products) {
      const s = score(p.name, q);
      if (s >= 40) out.push({ group: "Supply chains", score: s + 5, icon: "⛓", title: p.name, sub: `${p.materials.length} materials, rock to finished good`, run: () => app.tools.run("get_product_chain", { name: p.name }) });
    }
    const pool = [...R.D.curated.map((s) => ({ ...s, curated: true }))];
    if (R.D.bulk) for (const f of R.D.bulk.features) pool.push({ name: f.properties.n, type: f.properties.t, country: f.properties.k, commodity: f.properties.c, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], archive: true });
    const ql = q.toLowerCase();
    const sites = [];
    for (const s of pool) {
      if (!s.name?.toLowerCase().includes(ql)) continue;
      sites.push({ s, sc: score(s.name, q) + (s.curated ? 12 : 0) });
      if (sites.length > 400) break;
    }
    sites.sort((a, b) => b.sc - a.sc);
    for (const { s, sc } of sites.slice(0, 6)) {
      // Bulk archive rows (USGS MRDS, GEM, World Port Index) share names with half the
      // world's towns ("Paris #25", "Tokyo Ko"), so they rank after places.
      out.push({
        group: s.archive ? "Archive sites" : "Resource sites", archive: Boolean(s.archive), card: true, score: sc, icon: "⛏", title: s.name,
        sub: `${s.commodity} · ${s.type} · ${s.country}`,
        run: () => { R.showSite(s); app.ui.flyFramed({ center: [s.lng, s.lat], ...(R.siteView?.(s, 13, 55) ?? { zoom: 13, pitch: 55 }), speed: 1.4 }); },
      });
    }
  }
  for (const def of app.layers.list()) {
    if (def.hiddenFromSearch) continue;
    const s = Math.max(score(def.title, q), ...(def.keywords ?? []).map((k) => score(k, q) - 8));
    if (s >= 45) out.push({ group: "Layers", score: s, icon: app.layers.isOn(def.id) ? "●" : "○", title: def.title, sub: `${def.category}${app.layers.isOn(def.id) ? " · on" : ""}`, run: () => app.layers.toggle(def.id).then((on) => app.ui.toast(`${def.title} ${on ? "on" : "off"}`)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 10);
}

/* ---------------------------------------------------------------- render */
const NO_CARD = new Set(["Commodities", "Supply chains", "Layers", "Ask"]);
/** Rows grouped under their headings, in the order they appear on screen. */
function grouped(list) {
  const groups = [];
  for (const it of list) {
    let g = groups.find((x) => x.name === it.group);
    if (!g) groups.push((g = { name: it.group, list: [] }));
    g.list.push(it);
  }
  return groups;
}
function hideBox() {
  $("#omni-results").hidden = true;
  const input = $("#q");
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}
function paintSel() {
  const input = $("#q");
  for (const el of $$("#omni-results .omni-item")) el.setAttribute("aria-selected", String(Number(el.dataset.i) === sel));
  if (sel >= 0 && !$("#omni-results").hidden) input.setAttribute("aria-activedescendant", `omni-opt-${sel}`);
  else input.removeAttribute("aria-activedescendant");
}
function render() {
  const box = $("#omni-results");
  const live = cur && cur.my === seq;
  const searching = live && !items.length && cur.pending > 0;
  const nothing = live && !cur.pending && !cur.head.length && !cur.ask.command && items.length > 0 && items.every((it) => it.group === "Ask");
  if (chosen || (!items.length && !searching)) { hideBox(); return; }
  let idx = 0;
  box.innerHTML = (searching ? `<div class="omni-empty" role="presentation"><span class="omni-spin" aria-hidden="true"></span>Searching places…</div>` : "")
    + (nothing ? `<div class="omni-empty" role="presentation">No places match</div>` : "")
    + grouped(items).map((g, gi) => `<div role="group" aria-labelledby="omni-g-${gi}">
    <div class="omni-group eyebrow" id="omni-g-${gi}">${esc(g.name)}</div>
    ${g.list.map((it) => `<div class="omni-item" role="option" id="omni-opt-${idx}" data-i="${idx}" tabindex="-1" aria-selected="${idx++ === sel}">
      <span class="ic" aria-hidden="true">${esc(it.icon)}</span>
      <span style="min-width:0"><div class="t">${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ""}</span>
    </div>`).join("")}</div>`).join("");
  box.hidden = false;
  $("#q").setAttribute("aria-expanded", "true");
  paintSel();
}

/** Build the list for the current query from whatever has answered so far. */
function compose() {
  const c = cur;
  if (!c || c.my !== seq) return;
  const { q, wiki } = c;
  const ql = q.toLowerCase();
  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lng - b.lng) < 0.05;
  const exact = (x) => x.name.toLowerCase() === ql;
  // Photon favours places near the current view ("Denver" seen from London is a Norfolk
  // village). Wikipedia's exact title is the notable one, so its namesake leads.
  const notable = wiki.find((w) => exact(w) && w.placeLike);
  const closeTo = (p, w) => haversineKm([p.lng, p.lat], [w.lng, w.lat]) < 50;
  let places = c.places;
  const lead = notable ? places.findIndex((p) => exact(p) && closeTo(p, notable)) : -1;
  if (lead > 0) places = [places[lead], ...places.filter((_, i) => i !== lead)];
  const perName = new Map();
  const placeItems = places
    .filter((p) => { const n = (perName.get(p.name) ?? 0) + 1; perName.set(p.name, n); return n <= 2; })
    .slice(0, 5)
    .map((p, i) => ({ group: "Places", card: true, score: 60 - i, icon: "⌂", title: p.name, sub: p.detail, run: () => goToPlace(p) }));
  const wikiList = wiki.filter((w) => !places.some((p) => near(p, w) && p.name.toLowerCase() === w.name.toLowerCase())).slice(0, 4);
  const wikiGroup = wikiList.every((w) => w.placeLike) ? "Places on Wikipedia" : "On Wikipedia";
  const wikiItems = wikiList.map((w, i) => ({ group: wikiGroup, card: true, score: 55 - i, icon: "◎", title: w.name, sub: w.detail, run: () => goToPlace(w) }));
  // Unless OpenStreetMap has the exact name, Wikipedia's best title match (which
  // also follows redirects, e.g. "Kiliman" -> Mount Kilimanjaro) usually beats
  // partial street and suburb matches.
  const photonAgrees = places[0] && exact(places[0]) && (!notable || closeTo(places[0], notable));
  const wikiFirst = wiki.length > 0 && (!places.some(exact) || (notable && !photonAgrees));
  // A strong match on a dataset, commodity or Baryon key asset ("sea surface temperature",
  // "copper", "Escondida") outranks places that only share some of the words; archive
  // rows never do, and only two show unless the query asks for mines, ports or plants.
  const main = c.local.filter((it) => !it.archive);
  const archive = c.local.filter((it) => it.archive).slice(0, /\b(mines?|ports?|plants?|smelters?|deposits?)\b/i.test(q) ? 6 : 2);
  const exactPlace = places.some((p) => p.name.toLowerCase() === ql) || wiki.some((w) => w.name.toLowerCase() === ql);
  const best = main[0]?.score ?? 0;
  const localFirst = best >= 75 && (best >= 100 || !exactPlace);
  const placeBlock = wikiFirst ? [...wikiItems, ...placeItems] : [...placeItems, ...wikiItems];
  const ask = c.ask.score > 0 ? [c.ask] : [];
  // A command waits behind a place of exactly that name ("Kiruna mine" is a mine, not a query).
  const late = c.ask.command && exactPlace;
  let list = [...c.head, ...(late ? [] : ask), ...(localFirst ? [...main, ...placeBlock] : [...placeBlock, ...main]), ...(late ? ask : []), ...archive];
  if (!c.head.length && !ask.length && !c.pending) list.push({ ...c.ask, score: 0 });
  const before = items[sel];
  items = grouped(list).flatMap((g) => g.list);
  // Until the visitor picks a row, the first row stays the default as better answers arrive.
  const keep = userMoved && before ? items.findIndex((it) => it.title === before.title && it.group === before.group) : -1;
  sel = keep >= 0 ? keep : items.length ? 0 : -1;
  render();
}

function update(raw) {
  const my = ++seq;
  const q = raw.trim();
  userMoved = false;
  if (q.length < 2) { cur = null; items = []; sel = -1; render(); return; }
  const R = app.resources;
  if (R?.loadBulk && !R.D?.bulk && !bulkAsked) {
    // The 102k archive joins the local hits once it has loaded.
    bulkAsked = true;
    R.loadBulk().then(() => { if (cur && cur.my === seq) { cur.local = localHits(cur.q); compose(); } }, () => { bulkAsked = false; });
  }
  const coords = parseCoords(q);
  const question = looksLikeQuestion(q);
  const command = !coords && !question && commandFor(q);
  const c = cur = {
    my, q, places: [], wiki: [], pending: 0, local: coords ? [] : localHits(q),
    head: coords ? [{ group: "Go to", card: true, score: 1000, icon: "⌖", title: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, sub: "Coordinates", run: () => goToPlace({ ...coords, zoom: 13, pitch: 0 }) }] : [],
    ask: command
      ? { group: "Ask", command: true, score: 950, icon: "✦", title: q, sub: "Run command", run: () => app.emit("agent:ask", q) }
      : { group: "Ask", score: question ? 900 : -1, icon: "✦", title: `Ask: “${q}”`, sub: "The World Model agent searches, flies and explains", run: () => app.emit("agent:ask", q) },
  };
  // Coordinates need no lookup: Photon's free-text match on digits is noise.
  const lookups = coords ? [] : [
    [searchWikipediaPlaces(q, 5), (v) => (c.wiki = v)],
    [searchPlaces(q, 6), (v) => (c.places = v)],
  ];
  c.pending = lookups.length;
  // Photon (OpenStreetMap) and Wikipedia race; the list refreshes as each answers.
  c.done = Promise.all(lookups.map(([p, set]) => p.then(set, () => {}).finally(() => {
    c.pending--;
    compose();
    if (!c.pending && c.my === seq) announce();
  })));
  compose();
}
function announce() {
  const n = items.filter((it) => it.group !== "Ask").length;
  $("#omni-status").textContent = n ? `${n} result${n === 1 ? "" : "s"}` : "No places match";
}

export function goToPlace(p) {
  const m = app.map;
  const zoom = p.zoom ?? 12;
  // The place card opens when the camera lands, so the frame leaves room for it.
  if (p.bbox && zoom < 12) app.ui.fitPoints([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { maxZoom: 14, speed: 1.3, card: true });
  else app.ui.flyFramed({ center: [p.lng, p.lat], zoom, pitch: p.pitch ?? (zoom >= 12 ? 55 : 0), speed: 1.3, curve: 1.5 }, { card: true });
  const info = () => app.tools.run("get_place_info", { lat: p.lat, lng: p.lng, name: p.name }).catch(() => {});
  // Reduced motion turns the flight into a jump that has already ended.
  if (m.isMoving()) m.once("moveend", info);
  else info();
}

function choose(i, { keyboard = false } = {}) {
  const it = items[i];
  if (!it) return;
  close();
  chosen = true;
  if (NO_CARD.has(it.group)) app.ui.hideCard();
  if (keyboard && it.card) app.ui.focusCardOnOpen = true;
  // On touch screens the keyboard would otherwise stay up over the result.
  if (coarse.matches) $("#q").blur();
  it.run();
}
function close() {
  seq++; // drop late Photon / Wikipedia answers
  clearTimeout(timer);
  cur = null;
  items = [];
  sel = -1;
  hideBox();
}

export function init() {
  const input = $("#q");
  const clear = $("#omni-clear");
  const box = $("#omni-results");
  const syncClear = () => { if (clear) clear.hidden = !input.value; };
  // The longest hint that fits the box; phones under 380px always get the short one.
  const HINTS = ["Search places, sites and layers, or ask…", "Search places and sites, or ask…", "Search or ask…"];
  const measure = document.createElement("canvas").getContext("2d");
  const placeholder = () => {
    if (innerWidth <= 380) { input.placeholder = HINTS[2]; return; }
    measure.font = getComputedStyle(input).font;
    const room = input.clientWidth - 4;
    input.placeholder = HINTS.find((h) => measure.measureText(h).width <= room) ?? HINTS[2];
  };
  if (window.ResizeObserver) new ResizeObserver(placeholder).observe(input);
  addEventListener("resize", placeholder, { passive: true });
  placeholder();

  input.addEventListener("input", () => {
    chosen = false;
    app.ui.focusCardOnOpen = false;
    syncClear();
    clearTimeout(timer);
    timer = setTimeout(() => update(input.value), 180);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      chosen = false;
      userMoved = true;
      if (box.hidden) render();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      paintSel();
      $(`#omni-opt-${sel}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      // One step at a time: close the list, then clear the text, then leave the box.
      if (!box.hidden) { e.preventDefault(); close(); }
      else if (input.value) { e.preventDefault(); input.value = ""; syncClear(); close(); }
      else input.blur();
    }
  });
  $("#omnibox").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    clearTimeout(timer);
    if (!cur || cur.q !== q) update(input.value);
    // Enter straight after typing: give Photon and Wikipedia a moment so a city is not
    // beaten by a same-named mine that happened to answer first.
    if (cur?.pending && !userMoved) {
      const my = seq;
      await Promise.race([cur.done, new Promise((r) => setTimeout(r, 1500))]);
      if (my !== seq) return;
    }
    if (items.length && sel >= 0) return choose(userMoved ? sel : 0, { keyboard: true });
    if (looksLikeQuestion(q)) { close(); return app.emit("agent:ask", q); }
    const coords = parseCoords(q);
    if (coords) { close(); return goToPlace({ ...coords, zoom: 13, pitch: 0 }); }
    close();
    const [first] = await Promise.any([
      searchPlaces(q, 1).then((r) => (r.length ? r : Promise.reject())),
      searchWikipediaPlaces(q, 1).then((r) => (r.length ? r : Promise.reject())),
    ]).catch(() => []);
    if (first) goToPlace(first);
    else app.emit("agent:ask", q);
  });
  box.addEventListener("mousedown", (e) => {
    const b = e.target.closest(".omni-item");
    if (b) { e.preventDefault(); choose(Number(b.dataset.i)); }
  });
  box.addEventListener("pointermove", (e) => {
    const b = e.target.closest(".omni-item");
    // Real pointer motion only: a list re-rendering under a resting cursor is not a choice.
    if (!b || (!e.movementX && !e.movementY)) return;
    const i = Number(b.dataset.i);
    if (i === sel && userMoved) return;
    userMoved = true;
    sel = i;
    paintSel();
  });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) hideBox(); }, 150));
  input.addEventListener("focus", () => { if (items.length && !chosen) render(); });
  clear?.addEventListener("click", () => {
    input.value = "";
    syncClear();
    close();
    input.focus();
  });
  $("#ask").addEventListener("click", () => app.emit("agent:ask", input.value.trim()));
  // Shown once the tours module has registered feeling_lucky.
  app.on("app:ready", () => {
    const lucky = $("#lucky");
    if (!lucky || !app.tools.get("feeling_lucky")) return;
    lucky.hidden = false;
    lucky.addEventListener("click", () => app.tools.run("feeling_lucky", {}).catch(() => {}));
  });

  app.tools.define("search_places", {
    description: "Look up places on Earth by name or address (cities, countries, mountains, rivers, landmarks, streets, mines, ports) via OpenStreetMap. Returns names, coordinates, suggested zoom and bounding boxes. Does not move the camera.",
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    async run({ query, limit = 5 }) {
      const coords = parseCoords(query);
      if (coords) return { results: [{ name: query, ...coords, zoom: 12 }] };
      const n = Math.min(10, limit || 5);
      const [osm, wiki] = await Promise.all([searchPlaces(query, n).catch(() => []), searchWikipediaPlaces(query, 3).catch(() => [])]);
      const extra = wiki.filter((w) => !osm.some((p) => p.name.toLowerCase() === w.name.toLowerCase()));
      const results = [...osm, ...extra].slice(0, Math.max(n, osm.length ? n : 3));
      if (!results.length) return { results: [], note: "No match in OpenStreetMap (Photon) or Wikipedia." };
      return { results, sources: "OpenStreetMap via Photon; Wikipedia coordinates" };
    },
  });
}
