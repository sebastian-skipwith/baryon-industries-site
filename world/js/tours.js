// Explore: Voyager-style guided stories, "I'm feeling lucky" and the first-visit
// welcome. Stories live in /world/data/tours.json. Each stop is centred on the
// coordinates in its live Wikipedia summary (the authoring-time check is the
// fallback), and every excerpt and photo carries its Wikipedia / Commons credit.
import { app, $, esc, clamp, getJSON, haversineKm, score, readHash } from "./core.js";

const DATA_URL = "/world/data/tours.json";
let dwellMs = 12000; // time at each stop before auto-advance
const ORBIT_DEG = 18;
const IDLE_MS = 60000;
const WELCOME_KEY = "baryon.world.welcomed";
// Wikimedia asks browser clients to identify themselves with this header.
const WIKI_HEADERS = { "Api-User-Agent": "BaryonWorldModel/1.0 (https://baryon.industries)" };
const TILE = {
  day: (z, x, y) => `https://tiles.versatiles.org/tiles/satellite/${z}/${x}/${y}`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
};
// VersaTiles satellite merges the Sentinel-2 Global Mosaic (CC BY 4.0), NASA Blue Marble and open
// national orthophotos; its TileJSON attributes them as "VersaTiles sources".
const COVER_CREDIT = {
  day: { text: "VersaTiles satellite (Sentinel-2 and open sources)", url: "https://versatiles.org/sources/" },
  night: { text: "NASA Black Marble (VIIRS) via GIBS", url: "https://blackmarble.gsfc.nasa.gov/" },
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const phone = matchMedia("(max-width: 720px)");
const short = matchMedia("(max-height: 520px)"); // landscape phones: tours.css makes the sheet compact
const coarse = matchMedia("(pointer: coarse)");
// Below these widths there is no room for the story sheet beside the panel / place card.
const roomy = matchMedia("(min-width: 1000px)");
const wide = matchMedia("(min-width: 1360px)");

const svg = (body, { size = 20, fill = "none", sw = 1.8 } = {}) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${fill === "none" ? "currentColor" : "none"}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>'),
  dice: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".9" fill="currentColor"/>', { size: 18 }),
  play: svg('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>', { size: 18, fill: "currentColor" }),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', { size: 18, fill: "currentColor" }),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>', { size: 18, sw: 2 }),
  prev: svg('<path d="M15 5.5L8.5 12l6.5 6.5"/>', { size: 18, sw: 2 }),
  next: svg('<path d="M9 5.5l6.5 6.5L9 18.5"/>', { size: 18, sw: 2 }),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', { size: 14, sw: 2.4 }),
  playSm: svg('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>', { size: 11, fill: "currentColor" }),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  tilt: svg('<path d="M20 12a8 8 0 0 1-13.66 5.66"/><path d="M4 12a8 8 0 0 1 13.66-5.66"/><path d="M17.66 3.5v2.84h-2.84"/><path d="M6.34 20.5v-2.84h2.84"/><circle cx="12" cy="12" r="1.6"/>'),
  layers: svg('<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16 9 4.5 9-4.5"/>'),
  ext: svg('<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>', { size: 11, sw: 2 }),
};

/* ---------------------------------------------------------------- data */
let data = null;
let dataPromise = null;
function loadData() {
  dataPromise ??= getJSON(`${DATA_URL}?v=${app.version}`, { timeout: 15000 })
    .then((d) => (data = d))
    .catch((err) => { dataPromise = null; throw err; });
  return dataPromise;
}

const summaries = new Map();
function wikiSummary(title) {
  if (!summaries.has(title)) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    summaries.set(title, getJSON(url, { timeout: 10000, headers: WIKI_HEADERS }).catch(() => { summaries.delete(title); return null; }));
  }
  return summaries.get(title);
}
const wikiUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

const credits = new Map();
function imageFile(url) {
  const m = /\/wikipedia\/(commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url ?? "");
  return m ? { repo: m[1], name: decodeURIComponent(m[2]).replace(/_/g, " ") } : null;
}
// Photos are shown only under licences that allow commercial reuse with a credit and a link
// (public domain, CC0, CC BY, CC BY-SA, Free Art); GFDL-only and unknown licences are skipped.
const REUSABLE = /^(public domain|cc0|cc[ -]by(?:-sa)?\b|fal\b|free art)/i;
const plain = (html) => (html ? new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim() : "");
/** Commons' Artist field, minus its boilerplate, short enough to sit on one credit line. */
function artistName(html) {
  let s = plain(html)
    .replace(/^No machine-readable author provided\.?\s*/i, "")
    .replace(/\s*assumed \(based on copyright claims\)\.?$/i, "")
    .replace(/^User:/i, "");
  if (s.length > 48) s = `${s.slice(0, 47).replace(/[\s,;:]+\S*$/, "")}…`;
  return s;
}
/** Author, licence and file page of a Wikipedia page image; null when it cannot be checked. */
function imageCredit(url) {
  const f = imageFile(url);
  if (!f) return Promise.resolve(null);
  if (!credits.has(f.name)) {
    const q = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|Attribution|LicenseShortName|LicenseUrl|NonFree&titles=${encodeURIComponent(`File:${f.name}`)}`;
    credits.set(f.name, getJSON(q, { timeout: 10000, headers: WIKI_HEADERS }).then((d) => {
      const md = d.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata;
      if (!md) return null;
      const host = f.repo === "commons" ? "commons.wikimedia.org" : "en.wikipedia.org";
      const license = plain(md.LicenseShortName?.value);
      const licenseUrl = plain(md.LicenseUrl?.value).replace(/^\/\//, "https://");
      return {
        // The Attribution field, when the author set one, is the credit the licence asks for.
        usable: String(md.NonFree?.value ?? "").toLowerCase() !== "true" && REUSABLE.test(license),
        artist: artistName(md.Attribution?.value || md.Artist?.value),
        license,
        licenseUrl: /^https:\/\//.test(licenseUrl) ? licenseUrl : "",
        page: `https://${host}/wiki/${encodeURIComponent(`File:${f.name.replace(/ /g, "_")}`)}`,
      };
    }).catch(() => { credits.delete(f.name); return null; }));
  }
  return credits.get(f.name);
}

/** A static satellite view composed from map tiles, centred on a point. */
function tileMosaic({ lat, lng, z, night }, maxW, h) {
  const T = 256, n = 2 ** z;
  const x = ((lng + 180) / 360) * n * T;
  const s = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * T;
  const tile = night ? TILE.night : TILE.day;
  let out = "";
  for (let ty = Math.max(0, Math.floor((y - h / 2) / T)); ty <= Math.min(n - 1, Math.floor((y + h / 2) / T)); ty++) {
    for (let tx = Math.floor((x - maxW / 2) / T); tx <= Math.floor((x + maxW / 2) / T); tx++) {
      out += `<img src="${tile(z, ((tx % n) + n) % n, ty)}" alt="" loading="lazy" decoding="async" draggable="false" style="left:calc(50% + ${Math.round(tx * T - x)}px);top:calc(50% + ${Math.round(ty * T - y)}px)">`;
    }
  }
  return out;
}
/** Tiles fade in as they arrive; missing ones are dropped so the placeholder shows through. */
function hideBroken(root) {
  root.querySelectorAll(".tr-mosaic img:not([data-wired])").forEach((img) => {
    img.dataset.wired = "";
    if (img.complete && img.naturalWidth) img.classList.add("on");
    else {
      img.addEventListener("load", () => img.classList.add("on"), { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
    }
  });
}

// "Villarrica (volcano)" reads as "Villarrica"; the Wikipedia link keeps the exact title.
const stopName = (st) => st.name ?? st.wiki.replace(/\s*\([^)]*\)$/, "");
const placeName = stopName;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Cameras are framed for a desktop window; a narrower map zooms out to keep the same ground in view.
 *  On a short map (a landscape phone) a close-up framed on the flat map stays on it: zoomed out onto
 *  the globe (below FLAT_FROM_ZOOM), where the ground clamp is off, the camera's distance follows the
 *  map's height and a steep view of a high mountain (Everest, K2) looks into the terrain and shows
 *  black holes where none is drawn. */
const SHORT_MAP = 560;
function fitCamera({ zoom, pitch }) {
  const c = app.map.getCanvas();
  const w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
  const z = zoom + clamp(Math.log2(w / 1280), -1.4, 0);
  return { zoom: h < SHORT_MAP && zoom >= FLAT_FROM_ZOOM ? Math.max(z, FLAT_FROM_ZOOM) : z, pitch };
}
function flightMs(center, zoom) {
  const m = app.map, c = m.getCenter();
  const km = haversineKm([c.lng, c.lat], center);
  return clamp(2400 + Math.sqrt(km) * 62 + Math.abs(zoom - m.getZoom()) * 90, 3000, 9000);
}
/** Resolves on the moveend of the camera move tagged with `tag`, or after `ms` once the camera
 *  has stopped (a slow device can finish a flight late; a hidden tab never finishes it). */
function moveDone(tag, ms) {
  return new Promise((resolve) => {
    const m = app.map, giveUp = performance.now() + ms + 12000;
    const onEnd = (e) => { if (e.tourTag === tag) finish(); };
    const check = () => { if (m.isMoving() && !document.hidden && performance.now() < giveUp) t = setTimeout(check, 400); else finish(); };
    let t = setTimeout(check, ms);
    function finish() { clearTimeout(t); m.off("moveend", onEnd); resolve(); }
    m.on("moveend", onEnd);
  });
}
// A freezeElevation move ends with MapLibre putting the centre back on the ground, a step it has
// only for the flat projection: on the globe (below zoom 12) it skips it and logs "terrain is not
// fully supported on vertical perspective projection". Every camera move made here (map.js may add
// freezeElevation to the plain ones) runs with the ground clamp on only while the last two frames
// were flat, so a move that ends (lands or is stopped) on the globe skips that step. The clamp (on
// by default) is back at moveend, and the next frame sets the centre on the ground as usual.
const FLAT_FROM_ZOOM = 12; // MapLibre's "globe" projection turns flat between zoom 11 and 12
let groundHold = null;
function moveCamera(kind, opts, data) {
  const m = app.map;
  groundHold?.off();
  const hold = { prev: m.getZoom() };
  groundHold = hold;
  const onMove = () => {
    const z = m.getZoom();
    m.setCenterClampedToGround(Math.min(hold.prev, z) >= FLAT_FROM_ZOOM);
    hold.prev = z;
  };
  // A move's moveend carries its event data whether it finished or was stopped.
  const onEnd = (e) => {
    if (e.groundHold !== hold) return;
    hold.off();
    m.setCenterClampedToGround(true);
  };
  hold.off = () => {
    m.off("move", onMove);
    m.off("moveend", onEnd);
    if (groundHold === hold) groundHold = null;
  };
  m.on("move", onMove);
  m.on("moveend", onEnd);
  // Starting a move stops the one in progress, which then ends without the ground step.
  m.setCenterClampedToGround(false);
  try {
    m[kind](opts, { ...data, groundHold: hold });
  } catch (err) {
    onEnd({ groundHold: hold });
    throw err;
  }
}
const fly = (opts, tag) => moveCamera("flyTo", { ...opts, essential: true, freezeElevation: true }, { tourTag: tag });
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
/** On a phone or a short screen the story sheet covers the lower part of the map, so each stop is framed in the band above it. */
function framePadding() {
  if (!(phone.matches || short.matches) || !el || el.hidden) return NO_PADDING;
  const top = Math.max(0, ...[".w-top", "#modebar"].map((s) => $(s)?.getBoundingClientRect().bottom ?? 0));
  const h = el.getBoundingClientRect().height; // height plus CSS bottom: the entry slide-in (a transform) does not count
  const bottom = h && Math.round(h + (parseFloat(getComputedStyle(el).bottom) || 0));
  if (!bottom || top + bottom > innerHeight * 0.8) return NO_PADDING;
  return { top: Math.round(top), bottom: Math.round(bottom), left: 0, right: 0 };
}
/** On a phone the place card is a bottom sheet (max 62vh), so a lucky place is framed above it. */
function cardPadding() {
  if (!phone.matches) return NO_PADDING;
  const top = Math.max(0, ...[".w-top", "#modebar"].map((s) => $(s)?.getBoundingClientRect().bottom ?? 0));
  return { top: Math.round(top), bottom: Math.round(innerHeight * 0.62), left: 0, right: 0 };
}
const padded = () => { const p = app.map.getPadding(); return Boolean(p.top || p.bottom || p.left || p.right); };
/** Once the sheet or card that the padding made room for is gone, the subject glides back to
 *  the middle of the screen (in one step with reduced motion). Waits for the camera to settle;
 *  retries if a gesture interrupts it. Only the padding changes: re-centring on the ground point
 *  in the middle of the screen would move the camera by that point's height, which on steep
 *  terrain throws the view hundreds of pixels. */
function releasePadding() {
  const m = app.map;
  if (!padded() || T.story || L.tag || (L.padded && !$("#card").hidden)) return;
  if (m.isMoving()) { m.once("idle", releasePadding); return; }
  moveCamera("easeTo", { padding: NO_PADDING, duration: reduceMotion.matches ? 0 : 600, essential: true }, { tourTag: "unpad" });
  if (padded()) m.once("moveend", () => { if (padded()) m.once("idle", releasePadding); });
}
function near(center, zoom) {
  const c = app.map.getCenter();
  return haversineKm([c.lng, c.lat], center) < Math.max(0.5, 40000 / 2 ** zoom) && Math.abs(app.map.getZoom() - zoom) < 0.6;
}
let tagSeq = 0;
const newTag = (kind) => `${kind}-${++tagSeq}`;

/* ---------------------------------------------------------------- tour state */
const T = {
  story: null, i: 0, tag: null, playing: false, finished: false,
  flying: false, arrived: false, displaced: false, orbiting: false,
  dwellLeft: dwellMs, dwellStart: 0, dwellTimer: 0, raf: 0,
  startImagery: null, imageryMine: true, imageryBusy: false,
  touched: new Map(), pending: new Set(), userOwned: new Set(), failed: new Set(), foreignCheck: 0, resized: false,
  invoker: null,
};
let el = null; // player root

async function setLayer(id, on) {
  if (!app.layers.get(id) || T.userOwned.has(id) || (on && T.failed.has(id))) return;
  if (!T.touched.has(id)) T.touched.set(id, app.layers.isOn(id));
  if (app.layers.isOn(id) === on) return;
  T.pending.add(id);
  try {
    await app.layers.toggle(id, on);
  } catch {
    T.failed.add(id); // toggle already toasted the error; later stops do not retry it
  } finally {
    T.pending.delete(id);
  }
}
async function setImagery(id) {
  if (!T.imageryMine || !id || app.baseImagery === id || !app.tools.get("set_base_imagery")) return;
  T.imageryBusy = true;
  try { await app.tools.run("set_base_imagery", { imagery: id }); } catch {} finally { T.imageryBusy = false; }
}
function wantedLayers(story, stop) {
  const want = new Map();
  for (const id of [...(story.hide ?? []), ...(stop.hide ?? [])]) want.set(id, false);
  for (const id of [...(story.layers ?? []), ...(stop.layers ?? [])]) want.set(id, true);
  return want;
}
function applyStop(story, stop) {
  const want = wantedLayers(story, stop);
  for (const [id, was] of T.touched) if (!want.has(id)) setLayer(id, was);
  for (const [id, on] of want) setLayer(id, on);
  setImagery(stop.imagery ?? story.imagery ?? T.startImagery);
}
// Layer changes right after the viewer's own input (outside the story sheet) are theirs; the
// story leaves those layers alone. Other changes come from modules (e.g. a default layer that
// streams in after boot): they become the state to restore, and the stop keeps its view.
let lastInput = -1e9;
function onLayerChanged({ id, on }) {
  if (!T.story || T.pending.has(id)) return;
  if (performance.now() - lastInput < 2500) {
    T.touched.delete(id);
    T.userOwned.add(id);
    return;
  }
  const want = wantedLayers(T.story, T.story.stops[T.i]);
  if (!want.has(id) && !T.touched.has(id)) return;
  T.touched.set(id, on);
  if (want.has(id) && want.get(id) !== on) setTimeout(() => { if (T.story && !T.userOwned.has(id)) setLayer(id, wantedLayers(T.story, T.story.stops[T.i]).get(id) ?? on); }, 0);
}
function restoreWorld() {
  for (const [id, was] of T.touched) setLayer(id, was);
  T.touched = new Map();
  setImagery(T.startImagery);
}

function startTour(story, at = 0) {
  const f = document.activeElement;
  const fromWelcome = Boolean(welcomeEl?.contains(f));
  // The control that started the story gets focus back when it ends (focus inside the player is kept).
  if (!el?.contains(f)) T.invoker = fromWelcome ? null : f;
  stopAttract();
  cancelLucky();
  dismissWelcome(false);
  if (app.streetview?.isOpen?.()) app.streetview.close();
  app.emit("mode:claim", "tour"); // measure, pin, picture pick and probe let go of the map
  if (!T.story) {
    T.startImagery = app.baseImagery ?? "satellite";
    T.imageryMine = true;
    T.touched = new Map();
    T.userOwned = new Set();
    T.failed = new Set();
  }
  T.story = story;
  T.playing = true;
  T.finished = false;
  const takeFocus = !f || fromWelcome || f === document.body || f === app.map.getCanvas() || (app.ui.current === "explore" && $("#dock").contains(f));
  // Where the sheet has no room beside the dock (phones, tablets, landscape phones) the panel
  // closes, so a story asked for in Ask shows at once instead of waiting, paused, behind it.
  if (phone.matches || !roomy.matches || app.ui.current === "explore") app.ui.closePanel();
  app.ui.hideCard();
  mountPlayer();
  el.hidden = false;
  if (takeFocus) el.querySelector('[data-act="play"]').focus({ preventScroll: true });
  document.body.classList.add("is-touring");
  syncCovered();
  renderSegments();
  story.stops.forEach((st) => wikiSummary(st.wiki));
  go(at);
  emitState();
}

async function go(i) {
  const story = T.story;
  if (!story) return;
  i = clamp(i, 0, story.stops.length - 1);
  const tag = newTag("tour");
  Object.assign(T, { i, tag, arrived: false, displaced: false, finished: false, dwellLeft: dwellMs });
  clearDwell();
  stopOrbit();
  const stop = story.stops[i];
  renderStop(stop, tag);
  applyStop(story, stop);
  const sum = await Promise.race([wikiSummary(stop.wiki), wait(2200).then(() => undefined)]);
  if (T.tag !== tag) return;
  const center = centreOf(stop, sum);
  const cam = { center, ...fitCamera(stop.camera), bearing: stop.camera.bearing, padding: framePadding() };
  T.target = cam;
  if (reduceMotion.matches) {
    app.map.jumpTo(cam, { tourTag: tag });
    arrive(tag);
    return;
  }
  const duration = flightMs(center, cam.zoom);
  T.flying = true;
  fly({ ...cam, duration, curve: 1.5 }, tag);
  await moveDone(tag, duration + 2000);
  if (T.tag !== tag) return;
  T.flying = false;
  arrive(tag);
}

/** Live Wikipedia coordinates, unless they moved implausibly far from the verified ones. */
function centreOf(stop, sum) {
  const c = sum?.coordinates;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && haversineKm([stop.lng, stop.lat], [c.lon, c.lat]) < 100) return [c.lon, c.lat];
  return [stop.lng, stop.lat];
}

function arrive(tag) {
  if (T.tag !== tag) return;
  if (T.target && !near(T.target.center, T.target.zoom)) T.displaced = true;
  T.arrived = !T.displaced;
  if (T.arrived && T.playing) startDwell();
  // A flight that never landed (e.g. frames stopped in a background tab) waits for Play to fly again.
  else if (T.displaced && T.playing) return pause();
  renderControls();
}

function startDwell() {
  clearDwell();
  T.dwellStart = performance.now();
  T.dwellTimer = setTimeout(advance, T.dwellLeft);
  startOrbit(T.dwellLeft);
  const tick = () => {
    paintProgress();
    if (T.dwellTimer) T.raf = requestAnimationFrame(tick);
  };
  T.raf = requestAnimationFrame(tick);
}
function holdDwell() {
  if (T.dwellTimer) T.dwellLeft = Math.max(0, T.dwellLeft - (performance.now() - T.dwellStart));
  clearDwell();
  stopOrbit();
  paintProgress();
}
function clearDwell() {
  clearTimeout(T.dwellTimer);
  cancelAnimationFrame(T.raf);
  T.dwellTimer = 0;
}
function dwellFraction() {
  const left = T.dwellTimer ? T.dwellLeft - (performance.now() - T.dwellStart) : T.dwellLeft;
  return clamp(1 - left / dwellMs, 0, 1);
}

function startOrbit(ms) {
  if (reduceMotion.matches || ms < 400) return;
  const m = app.map;
  T.orbiting = true;
  moveCamera("easeTo", { bearing: m.getBearing() + ORBIT_DEG * (ms / dwellMs), duration: ms, easing: (t) => t, essential: true }, { tourTag: T.tag });
}
function stopOrbit() {
  if (!T.orbiting) return;
  T.orbiting = false;
  if (app.map.isMoving()) app.map.stop();
}

function advance() {
  clearDwell();
  if (!T.story) return;
  if (T.i < T.story.stops.length - 1) return go(T.i + 1);
  stopOrbit();
  T.playing = false;
  T.finished = true;
  T.dwellLeft = 0;
  renderControls();
  announce(`End of ${T.story.title}.`);
  emitState();
}

function pause() {
  if (!T.playing) return;
  T.playing = false;
  holdDwell();
  renderControls();
  emitState();
}
function play() {
  if (!T.story) return;
  if (T.finished) {
    T.playing = true;
    go(0);
  } else {
    T.playing = true;
    if (T.displaced) go(T.i);
    else if (T.arrived) startDwell();
  }
  renderControls();
  emitState();
}
const toggle = () => (T.playing ? pause() : play());
function step(d) {
  if (!T.story) return;
  const i = T.i + d;
  if (i < 0 || i >= T.story.stops.length) return;
  go(i);
}
/** Street View or a map tool took the map: the story pauses, and a flight stops where it is
 *  (Play flies to the stop again). */
function yieldMap() {
  if (!T.story) return;
  pause();
  if (T.flying && app.map.isMoving()) app.map.stop();
}

/** Keyboard focus returns to the control that started things, else the Explore button, else search. */
function focusBack(node) {
  const shown = (n) => n?.isConnected && n !== document.body && n !== app.map.getCanvas() && !n.disabled && !n.closest("[hidden]") && n.getClientRects().length > 0;
  [node, $('.rail-btn[data-panel="explore"]'), $("#q")].find(shown)?.focus({ preventScroll: true });
}

function endTour() {
  if (!T.story) return null;
  const title = T.story.title;
  T.tag = null;
  clearDwell();
  stopOrbit();
  if (T.flying && app.map.isMoving()) app.map.stop();
  T.flying = false;
  restoreWorld();
  T.story = null;
  T.playing = false;
  releasePadding();
  if (el?.contains(document.activeElement)) focusBack(T.invoker);
  T.invoker = null;
  if (el) el.hidden = true;
  document.body.classList.remove("is-touring");
  emitState();
  return title;
}

function emitState() {
  app.emit("tour:state", T.story ? { story: T.story.id, title: T.story.title, stop: T.i + 1, stops: T.story.stops.length, playing: T.playing } : null);
  refreshPanelBadges();
}

/* ---------------------------------------------------------------- player UI */
function mountPlayer() {
  if (el) return;
  el = document.createElement("section");
  el.id = "tour";
  el.className = "tour wglass";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Story player");
  el.hidden = true;
  el.innerHTML = `
    <div class="tour-segs" role="group" aria-label="Stops"></div>
    <div class="tour-head">
      <div class="tour-meta"><span class="eyebrow tour-story"></span><span class="tour-count"></span><span class="tour-state"></span></div>
      <div class="tour-ctl">
        <button type="button" class="tour-btn" data-act="prev" aria-label="Previous stop">${ICON.prev}</button>
        <button type="button" class="tour-btn tour-play" data-act="play" aria-label="Pause story">${ICON.pause}</button>
        <button type="button" class="tour-btn" data-act="next" aria-label="Next stop">${ICON.next}</button>
        <button type="button" class="icon-btn tour-close" data-act="close" aria-label="End story">${ICON.close}</button>
      </div>
    </div>
    <div class="tour-main">
      <div class="tour-thumb"><span class="tr-mosaic" aria-hidden="true"></span><img class="photo" alt=""></div>
      <div class="tour-text">
        <h3 class="tour-title"></h3>
        <p class="tour-caption"></p>
        <p class="tour-extract"></p>
      </div>
    </div>
    <p class="tour-credit"><span class="tc-text"></span><span class="tc-img"></span></p>
    <p class="tour-sr" aria-live="polite"></p>`;
  document.body.append(el);
  // The text block has a fixed height; the excerpt takes whatever whole lines the caption leaves.
  new ResizeObserver(fitExtract).observe(el.querySelector(".tour-text"));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) ({ prev: () => step(-1), next: () => step(1), play: toggle, close: endTour })[b.dataset.act]?.();
    const seg = e.target.closest("[data-seg]");
    if (seg) go(Number(seg.dataset.seg));
  });
  const photo = el.querySelector(".photo");
  photo.addEventListener("load", () => photo.classList.add("on"));
  photo.addEventListener("error", () => photo.classList.remove("on"));
}

function renderSegments() {
  const s = T.story;
  el.querySelector(".tour-segs").innerHTML = s.stops
    .map((st, i) => `<button type="button" class="tour-seg" data-seg="${i}" aria-label="Stop ${i + 1} of ${s.stops.length}: ${esc(stopName(st))}"><i></i></button>`)
    .join("");
  el.querySelector(".tour-story").textContent = s.title;
}

function paintProgress() {
  if (!el || !T.story) return;
  const f = T.finished ? 1 : dwellFraction();
  // Runs every frame while dwelling, so only touch what changed.
  el.querySelectorAll(".tour-seg").forEach((b, i) => {
    const p = i < T.i || T.finished ? 1 : i === T.i ? Math.round(f * 1000) / 1000 : 0;
    if (b._p !== p) { b._p = p; b.style.setProperty("--p", p); }
    const cur = i === T.i;
    if (b._cur !== cur) { b._cur = cur; if (cur) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); }
  });
}

function renderControls() {
  if (!el || !T.story) return;
  const n = T.story.stops.length;
  el.querySelector(".tour-count").textContent = `${T.i + 1} / ${n}`;
  const f = document.activeElement;
  el.querySelector('[data-act="prev"]').disabled = T.i === 0;
  el.querySelector('[data-act="next"]').disabled = T.i === n - 1;
  const btn = el.querySelector('[data-act="play"]');
  if (f?.disabled && el.contains(f)) btn.focus({ preventScroll: true }); // a disabled button drops focus to the page
  btn.innerHTML = T.finished ? ICON.replay : T.playing ? ICON.pause : ICON.play;
  btn.setAttribute("aria-label", T.finished ? "Replay story" : T.playing ? "Pause story" : "Play story");
  el.querySelector(".tour-state").textContent = T.finished ? "Complete" : T.playing ? "" : "Paused";
  el.classList.toggle("is-paused", !T.playing);
  paintProgress();
}

function announce(text) {
  const sr = el?.querySelector(".tour-sr");
  if (sr) sr.textContent = text;
}

function fitExtract() {
  const ex = el?.querySelector(".tour-extract");
  if (!ex || el.hidden) return;
  const box = el.querySelector(".tour-text");
  const lh = parseFloat(getComputedStyle(ex).lineHeight) || 18;
  const lines = clamp(Math.floor((box.clientHeight - ex.offsetTop) / lh), 1, 6);
  if (ex.style.getPropertyValue("--lines") !== String(lines)) ex.style.setProperty("--lines", lines);
}

const wikiLink = (href) => `<a href="${esc(href)}" target="_blank" rel="noopener">Read on Wikipedia ${ICON.ext}</a>`;
const TEXT_LICENSE = ' · Text <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>';
function imageCreditHtml(night) {
  const c = night ? COVER_CREDIT.night : COVER_CREDIT.day;
  return `Image:&nbsp;<a class="tc-who" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a>`;
}

function renderStop(stop, tag) {
  const s = T.story;
  const night = (stop.imagery ?? s.imagery) === "night";
  el.querySelector(".tour-title").textContent = stopName(stop);
  el.querySelector(".tour-caption").textContent = stop.caption;
  el.querySelector(".tour-extract").innerHTML = '<span class="tour-skel"></span><span class="tour-skel"></span><span class="tour-skel" style="width:62%"></span>';
  el.querySelector(".tc-text").innerHTML = wikiLink(wikiUrl(stop.wiki));
  el.querySelector(".tc-img").innerHTML = imageCreditHtml(night);
  el.querySelector(".tour-credit").removeAttribute("title");
  fitExtract();
  const thumb = el.querySelector(".tour-thumb");
  thumb.querySelector(".tr-mosaic").classList.toggle("is-night", night);
  thumb.querySelector(".tr-mosaic").innerHTML = tileMosaic({ lat: stop.lat, lng: stop.lng, z: clamp(Math.round(stop.camera.zoom) - 2, 2, night ? 7 : 12), night }, 140, 140);
  hideBroken(thumb);
  const photo = thumb.querySelector(".photo");
  photo.classList.remove("on");
  photo.removeAttribute("src");
  renderControls();
  announce(`Stop ${T.i + 1} of ${s.stops.length}: ${stopName(stop)}. ${stop.caption}`);
  fillStop(stop, tag, night);
}

async function fillStop(stop, tag, night) {
  const sum = await wikiSummary(stop.wiki);
  if (T.tag !== tag) return;
  const ex = el.querySelector(".tour-extract");
  const page = sum?.content_urls?.desktop?.page;
  const credit = el.querySelector(".tour-credit");
  const textCredit = el.querySelector(".tc-text");
  if (!sum?.extract) {
    ex.textContent = "Wikipedia could not be reached just now, so this stop shows only the view.";
    return;
  }
  ex.textContent = sum.extract;
  textCredit.innerHTML = wikiLink(/^https:\/\//.test(page ?? "") ? page : wikiUrl(stop.wiki)) + TEXT_LICENSE;
  const src = sum.thumbnail?.source;
  if (!src) return;
  const c = await imageCredit(src);
  if (T.tag !== tag || !c?.usable) return;
  el.querySelector(".tour-thumb .photo").src = src;
  // The licence never truncates; a long author name does, and the link leads to the full record.
  const lic = c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener license">${esc(c.license)}</a>` : esc(c.license);
  el.querySelector(".tc-img").innerHTML = `Image:&nbsp;<a class="tc-who" href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.artist || "see file page")}</a><span class="tc-lic">, ${lic}</span>`;
  credit.title = `Text: Wikipedia, CC BY-SA 4.0. Image: ${[c.artist, c.license].filter(Boolean).join(", ")}.`;
}

/** The sheet moves beside an open panel / place card, or steps aside (paused) when there is no room,
 *  and while Street View or a map tool (measure, pin, picture pick, probe) has the map. */
function syncCovered() {
  if (!el) return;
  const dock = !$("#dock").hidden, card = !$("#card").hidden;
  const tool = Boolean(app.streetview?.isOpen?.()) || document.body.matches(".tl-drawing, .sv-picking, .ed-probing");
  const covered = tool || ((dock || card) && (phone.matches || !roomy.matches || (dock && card && !wide.matches)));
  if (tool) yieldMap();
  else if (covered && !el.classList.contains("is-covered")) pause();
  el.classList.toggle("is-covered", covered);
  el.classList.toggle("beside-dock", !covered && dock);
  el.classList.toggle("beside-card", !covered && card);
}

/* ---------------------------------------------------------------- interaction */
function onForeignMove() {
  if (!T.story) return;
  T.orbiting = false;
  T.displaced = true;
  T.arrived = false;
  pause();
}
function watchCamera() {
  const m = app.map;
  m.on("movestart", (e) => {
    if (e.tourTag || e.attract) return;
    if (attract.on) stopAttract(true);
    if (!T.story) return;
    // map.resize() also fires movestart while the camera is idle; ignore those, and moves
    // that began before the current stop was requested.
    const tag = T.tag;
    T.resized = false;
    clearTimeout(T.foreignCheck);
    T.foreignCheck = setTimeout(() => { if (!T.resized && T.tag === tag) onForeignMove(); }, 0);
  });
  m.on("resize", () => { T.resized = true; });
  const box = m.getCanvasContainer();
  const userInput = () => { if (T.story && T.playing) pause(); };
  box.addEventListener("pointerdown", userInput, { capture: true, passive: true });
  box.addEventListener("wheel", userInput, { capture: true, passive: true });
}

// Places whose own keyboard handling (lists, sliders, dialogs, text) must keep Left/Right/Space.
const KEY_OWNERS = "input, textarea, select, [contenteditable]:not([contenteditable='false']), #dock, #card, .omni, [role='dialog'], [aria-modal='true'], [role='listbox'], [role='tablist'], [role='radiogroup'], [role='slider'], [role='menu'], [role='grid']";
let escBlocked = false;
function onKey(e) {
  if (e.key === "Escape") {
    // Decided now, before main.js closes the card / panel on this same key press.
    escBlocked = Boolean(welcomeEl) || !$("#card").hidden || !$("#dock").hidden ||
      Boolean(app.mode && app.mode !== "explore") || Boolean(app.streetview?.isOpen?.());
    if (welcomeEl) { dismissWelcome(); e.preventDefault(); }
    return;
  }
  if (!T.story || e.defaultPrevented || e.cancelBubble || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  // While the sheet is stepped aside, the keys belong to what covers it (a tool's keyboard drawing, Street View).
  if (app.streetview?.isOpen?.() || el?.classList.contains("is-covered")) return;
  const t = e.target instanceof Element ? e.target : document.body;
  const inPlayer = Boolean(el?.contains(t));
  if (!inPlayer && t.closest(KEY_OWNERS)) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    e.stopPropagation(); // keep the map's own arrow-key panning out of it
    step(e.key === "ArrowLeft" ? -1 : 1);
  } else if (e.key === " ") {
    // In the player Space always plays / pauses (the play button does it by native activation).
    if (inPlayer ? t.closest('[data-act="play"]') : t.closest("button, a[href], summary, [role='button'], [role='checkbox'], [role='switch']")) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }
}
/** Esc ends the story last, only when nothing else (card, panel, tool mode, dialog) used it. */
function onKeyLate(e) {
  if (e.key !== "Escape" || !T.story || escBlocked || e.defaultPrevented) return;
  if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
  endTour();
}

/* ---------------------------------------------------------------- I'm feeling lucky */
const L = { tag: null, recent: [], padded: false };
function cancelLucky() { L.tag = null; }
async function feelingLucky() {
  await loadData();
  if (T.story) endTour();
  stopAttract();
  dismissWelcome();
  if (app.streetview?.isOpen?.()) app.streetview.close();
  const pool = data.lucky.filter((p) => !L.recent.includes(p.wiki));
  const p = pool[Math.floor(Math.random() * pool.length)] ?? data.lucky[0];
  L.recent = [...L.recent, p.wiki].slice(-Math.min(20, data.lucky.length - 1));
  const tag = newTag("lucky");
  L.tag = tag;
  app.ui.hideCard();
  if (phone.matches) app.ui.closePanel();
  const name = placeName(p);
  app.ui.toast(`Flying to ${name}`);
  const cam = { center: [p.lng, p.lat], ...fitCamera(p.camera), bearing: p.camera.bearing, padding: cardPadding() };
  L.padded = phone.matches;
  (async () => {
    if (reduceMotion.matches) app.map.jumpTo(cam, { tourTag: tag });
    else {
      const duration = flightMs(cam.center, cam.zoom);
      fly({ ...cam, duration, curve: 1.6 }, tag);
      await moveDone(tag, duration + 2000);
    }
    if (L.tag !== tag) return;
    L.tag = null;
    if (!near(cam.center, cam.zoom)) return releasePadding(); // the flight was interrupted
    app.tools.run("get_place_info", { lat: p.lat, lng: p.lng, name }).catch(() => {});
  })();
  return { ...p, name };
}

/* ---------------------------------------------------------------- welcome */
let welcomeEl = null, welcomeFrom = null;
function welcomed() {
  try { return localStorage.getItem(WELCOME_KEY) === "1"; } catch { return false; }
}
function showWelcome() {
  if (welcomeEl || T.story) return;
  const small = phone.matches || coarse.matches;
  welcomeEl = document.createElement("div");
  welcomeEl.className = "wl";
  welcomeEl.innerHTML = `
    <div class="wl-card wglass" role="dialog" aria-modal="false" aria-labelledby="wl-title" aria-describedby="wl-lede" tabindex="-1">
      <span class="eyebrow">Baryon World Model</span>
      <h2 id="wl-title">Explore a living Earth</h2>
      <p id="wl-lede" class="wl-lede">Fly anywhere, switch on scientific and live layers, and ask questions of the planet.</p>
      <ul class="wl-tips">
        <li><span class="wl-ic">${ICON.search}</span><span><b>Search or ask</b><small>Type a place or coordinates in the top bar${small ? "" : " (or press&nbsp;/)"}. For a command like “earthquakes this week”, ${small ? "tap" : "press"}&nbsp;Ask.</small></span></li>
        <li><span class="wl-ic">${ICON.tilt}</span><span><b>Tilt and rotate</b><small>${small ? "Drag with two fingers to tilt, twist to turn, or tap the 3D button." : "Right-drag or Ctrl-drag to tilt and turn the globe, or press the 3D button."}</small></span></li>
        <li><span class="wl-ic">${ICON.layers}</span><span><b>Layers and Live Earth</b><small>Open the panels ${phone.matches ? "along the bottom" : "on the left"} for datasets, live feeds and guided stories.</small></span></li>
      </ul>
      <div class="wl-actions">
        <button type="button" class="btn btn-primary" data-act="tour">${ICON.playSm} Take a tour</button>
        <button type="button" class="btn btn-ghost" data-act="explore">Start exploring</button>
      </div>
    </div>`;
  welcomeFrom = document.activeElement;
  document.body.append(welcomeEl);
  // startTour dismisses the card itself, so focus can go straight to the player.
  welcomeEl.querySelector('[data-act="tour"]').onclick = async () => {
    const d = await loadData().catch(() => null);
    if (d?.stories?.length) return startTour(d.stories[0]);
    dismissWelcome();
    app.ui.openPanel("explore");
  };
  welcomeEl.querySelector('[data-act="explore"]').onclick = () => dismissWelcome();
  welcomeEl.querySelector(".wl-card").focus({ preventScroll: true });
  app.map.getCanvasContainer().addEventListener("pointerdown", dismissWelcome, { once: true, passive: true });
  $("#q")?.addEventListener("focus", dismissWelcome, { once: true });
}
function dismissWelcome(refocus = true) {
  if (!welcomeEl) return;
  try { localStorage.setItem(WELCOME_KEY, "1"); } catch {}
  const node = welcomeEl;
  welcomeEl = null;
  app.map.getCanvasContainer().removeEventListener("pointerdown", dismissWelcome);
  const hadFocus = node.contains(document.activeElement);
  node.classList.add("out");
  setTimeout(() => node.remove(), reduceMotion.matches ? 0 : 220);
  if (hadFocus && refocus) focusBack(welcomeFrom);
  welcomeFrom = null;
}

/* ---------------------------------------------------------------- idle attract */
// After a minute without input on a desktop globe view, the Earth turns slowly.
const attract = { on: false, idle: 0, last: 0 };
function bumpIdle() {
  const now = performance.now();
  if (attract.on) stopAttract();
  if (now - attract.last < 1000) return;
  attract.last = now;
  clearTimeout(attract.idle);
  attract.idle = setTimeout(maybeAttract, IDLE_MS);
}
function maybeAttract() {
  const m = app.map;
  const busy = phone.matches || coarse.matches || reduceMotion.matches || document.hidden || T.story || L.tag || welcomeEl ||
    app.ui.current || !$("#card").hidden || (app.mode && app.mode !== "explore") || app.streetview?.isOpen?.() ||
    m.isMoving() || m.getZoom() > 3.5;
  if (busy) { attract.last = 0; return bumpIdle(); }
  attract.on = true;
  spin();
}
function spin() {
  if (!attract.on) return;
  const m = app.map, c = m.getCenter();
  moveCamera("easeTo", { center: [c.lng - 24, c.lat + (18 - c.lat) * 0.12], duration: 12000, easing: (t) => t, essential: true }, { attract: true });
  m.once("moveend", (e) => {
    // A moveend from an interrupted spin arrives before the interrupting move starts.
    if (e.attract) setTimeout(() => { if (attract.on && !m.isMoving()) spin(); }, 0);
  });
}
function stopAttract(interrupted = false) {
  if (!attract.on) return;
  attract.on = false;
  if (!interrupted && app.map.isMoving()) app.map.stop();
}

/* ---------------------------------------------------------------- Explore panel */
let panelNode = null;
const cardLabel = (s, playing) => `${playing ? "Restart" : "Play"} story: ${s.title}, ${s.stops.length} stops`;
const playLabel = (playing) => (playing ? '<span class="xp-eq"><i></i><i></i><i></i></span> Playing' : `${ICON.playSm} Play`);
function storyCard(s, i, all) {
  const hero = i === 0;
  // After the full-width hero, cards pair up; a last card left alone spans the row, cover beside text.
  const wide = !hero && i === all.length - 1 && (all.length - 1) % 2 === 1;
  const playing = T.story?.id === s.id;
  return `<button type="button" class="xp-card${hero ? " xp-hero" : ""}${wide ? " xp-wide" : ""}${playing ? " is-playing" : ""}" data-story="${esc(s.id)}" aria-label="${esc(cardLabel(s, playing))}">
    <span class="xp-cover tr-mosaic${s.cover.night ? " is-night" : ""}" aria-hidden="true">${tileMosaic(s.cover, hero ? 420 : 230, hero ? 168 : wide ? 170 : 104)}<span class="xp-count">${s.stops.length} stops</span></span>
    <span class="xp-body">
      <span class="xp-title">${esc(s.title)}</span>
      <span class="xp-teaser">${esc(s.teaser)}</span>
      <span class="xp-play" aria-hidden="true">${playLabel(playing)}</span>
    </span>
  </button>`;
}
function renderPanel(node) {
  panelNode = node;
  const lucky = `<button type="button" class="btn btn-primary xp-lucky" data-lucky>${ICON.dice}<span>I'm feeling lucky</span></button>`;
  if (!data) {
    node.innerHTML = `${lucky}<span class="eyebrow">Stories</span><div class="xp-grid" aria-busy="true">${'<div class="xp-card xp-skel"><span class="xp-cover"></span><span class="xp-body"><span class="tour-skel"></span><span class="tour-skel" style="width:70%"></span></span></div>'.repeat(4)}</div>`;
    wirePanel(node);
    loadData().then(() => { if (node.isConnected) renderPanel(node); }).catch(() => {
      if (!node.isConnected) return;
      node.querySelector(".xp-grid").outerHTML = `<div class="xp-empty"><p>Stories could not be loaded. Check your connection and try again.</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Try again</button></div>`;
      node.querySelector("[data-retry]").onclick = () => renderPanel(node);
    });
    return;
  }
  node.innerHTML = `
    ${lucky}
    <p class="xp-sub">Fly to one of ${data.lucky.length} remarkable places, picked at random.</p>
    <span class="eyebrow">Stories</span>
    <div class="xp-grid">${data.stories.map(storyCard).join("")}</div>
    <p class="note xp-note">Stories fly the camera and switch on the layers each stop needs; your imagery and layers come back when a story ends. Place text comes live from Wikipedia (CC BY-SA 4.0); each image is credited on its stop. Covers: <a href="${COVER_CREDIT.day.url}" target="_blank" rel="noopener">VersaTiles satellite</a> (Sentinel-2 Global Mosaic, CC BY 4.0, and other open sources) and <a href="${COVER_CREDIT.night.url}" target="_blank" rel="noopener">NASA Black Marble</a>.</p>`;
  wirePanel(node);
  hideBroken(node);
}
function wirePanel(node) {
  node.querySelector("[data-lucky]").onclick = () => feelingLucky().catch(() => app.ui.toast("Places could not be loaded.", { tone: "error" }));
  node.querySelectorAll("[data-story]").forEach((b) => (b.onclick = () => {
    const s = data.stories.find((x) => x.id === b.dataset.story);
    if (s) startTour(s);
  }));
}
/** Updates the "Playing" badges in place, so keyboard focus and loaded covers survive. */
function refreshPanelBadges() {
  if (!panelNode?.isConnected || !data) return;
  for (const b of panelNode.querySelectorAll("[data-story]")) {
    const s = data.stories.find((x) => x.id === b.dataset.story);
    const playing = T.story?.id === b.dataset.story;
    if (!s || b.classList.contains("is-playing") === playing) continue;
    b.classList.toggle("is-playing", playing);
    b.setAttribute("aria-label", cardLabel(s, playing));
    b.querySelector(".xp-play").innerHTML = playLabel(playing);
  }
}

/* ---------------------------------------------------------------- tools */
function matchStory(name) {
  const raw = String(name).trim().toLowerCase();
  const exact = data.stories.find((s) => s.id === raw || s.title.toLowerCase() === raw);
  if (exact) return exact;
  const q = raw.replace(/[-_:]+/g, " ").replace(/\b(the|a|an|tour|tours|story|stories|of)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  let best = null, bestScore = 0;
  for (const s of data.stories) {
    const sc = Math.max(
      score(s.title, q), score(s.id.replace(/-/g, " "), q),
      ...(s.keywords ?? []).map((k) => score(k, q) - 4),
      ...s.stops.map((st) => score(stopName(st), q) - 20),
    );
    if (sc > bestScore) { best = s; bestScore = sc; }
  }
  return bestScore >= 30 ? best : null;
}
const storyList = () => data.stories.map((s) => ({ name: s.title, id: s.id, about: s.teaser, stops: s.stops.map(stopName) }));

function defineTools() {
  app.tools.define("list_tours", {
    description: "List the guided stories (Voyager-style tours) in the Explore panel, with each story's stops. Set open_panel to also show the Explore panel.",
    input_schema: { type: "object", properties: { open_panel: { type: "boolean" } } },
    async run({ open_panel } = {}) {
      if (!(await loadData().catch(() => null))) return { ok: false, error: "The stories could not be loaded right now." };
      if (open_panel) app.ui.openPanel("explore");
      return { tours: storyList(), playing: T.story ? { name: T.story.title, stop: T.i + 1, of: T.story.stops.length } : null };
    },
    local: {
      patterns: [/^(?:list|show(?: me)?|what are)(?: the| all| your)?(?: available)? (?:tours|stories|guided tours)\??$/i, /^(?:tours|stories)$/i],
      parse: () => ({ open_panel: true }),
    },
  });

  app.tools.define("start_tour", {
    description: "Play a guided story: the camera flies from stop to stop with a slow orbit, switches on the layers each stop needs, and shows live Wikipedia text. The name is fuzzy-matched against the stories (see list_tours); without a name a story is picked at random. Optional stop is 1-based.",
    input_schema: { type: "object", properties: { name: { type: "string" }, stop: { type: "number" } } },
    async run({ name, stop } = {}) {
      if (!(await loadData().catch(() => null))) return { ok: false, error: "The stories could not be loaded right now." };
      const s = name ? matchStory(name) : data.stories[Math.floor(Math.random() * data.stories.length)];
      if (!s) return { ok: false, error: `No story like "${name}". Stories: ${data.stories.map((x) => x.title).join("; ")}` };
      const at = Math.round(Number(stop));
      startTour(s, Number.isFinite(at) ? at - 1 : 0);
      const note = coarse.matches
        ? "Playing. Tap the arrows on the story card to step, pause to stay on a stop, or × to end the story."
        : "Playing. Left/Right step, Space pauses, Esc ends the story.";
      return { ok: true, tour: s.title, stops: s.stops.map(stopName), note };
    },
    local: {
      patterns: [
        /^(?:take me on |start |play |begin |give me )?(?:a |the )?(?:guided )?tour(?: of (.+?))?[.!?]*$/i,
        /^(?:play|start|take me on) (?:the )?(.+?) (?:tour|story)[.!?]*$/i,
      ],
      parse: (m) => (m[1] ? { name: m[1] } : {}),
    },
  });

  app.tools.define("stop_tour", {
    description: "Stop the guided story that is playing and put back the imagery and layers from before it started. The camera stays where it is.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const was = endTour();
      return { ok: true, stopped: was };
    },
    local: { patterns: [/^(?:stop|end|exit|quit|close)(?: the)? (?:tour|story)[.!]*$/i], parse: () => ({}) },
  });

  app.tools.define("feeling_lucky", {
    description: "I'm feeling lucky: fly to a random remarkable place on Earth (a curated list of geotagged landmarks and landscapes, each checked against Wikipedia) and open its place card on arrival.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const p = await feelingLucky().catch(() => null);
      if (!p) return { ok: false, error: "The list of places could not be loaded right now." };
      return { ok: true, place: p.name, wikipedia: wikiUrl(p.wiki), lat: p.lat, lng: p.lng, note: "Flying there now; the place card opens on arrival." };
    },
    local: { patterns: [/^(?:i'?m feeling lucky|feeling lucky|surprise me|random place|take me somewhere(?: random)?)[.!?]*$/i], parse: () => ({}) },
  });
}

/* ---------------------------------------------------------------- init */
export function init() {
  const sharedLink = Boolean(readHash().camera);
  app.ui.definePanel("explore", {
    title: "Explore",
    order: 15,
    icon: ICON.compass,
    render: renderPanel,
    onClose: () => { panelNode = null; },
  });
  defineTools();
  loadData().then(() => {
    const def = app.tools.get("start_tour");
    if (def) def.description += ` Stories: ${data.stories.map((s) => s.title).join("; ")}.`;
  }).catch((err) => console.warn("[world] stories unavailable", err));
  watchCamera();
  window.addEventListener("keydown", onKey, { capture: true });
  window.addEventListener("keydown", onKeyLate);
  app.on("ui:panel", (id) => { if (id) dismissWelcome(); syncCovered(); });
  app.on("ui:card", (open) => {
    if (open) dismissWelcome();
    else if (L.padded && !L.tag && !T.story) { L.padded = false; releasePadding(); }
    syncCovered();
  });
  for (const q of [phone, roomy, wide]) q.addEventListener?.("change", syncCovered);
  // Street View and the map tools cover the sheet; it comes back paused when they end.
  app.on("streetview:open", syncCovered);
  app.on("streetview:close", syncCovered);
  app.on("mode:claim", (mode) => { if (mode !== "tour") { yieldMap(); syncCovered(); } });
  new MutationObserver(syncCovered).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  app.on("layers:changed", onLayerChanged);
  const input = (e) => { if (!(e.target instanceof Node && el?.contains(e.target))) lastInput = performance.now(); };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, input, { passive: true, capture: true });
  app.on("tool:start", ({ name }) => { if (!T.imageryBusy && !/^(start_tour|stop_tour|list_tours|feeling_lucky)$/.test(name)) lastInput = performance.now(); });
  app.on("imagery:changed", () => { if (T.story && !T.imageryBusy) T.imageryMine = false; });
  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, bumpIdle, { passive: true, capture: true });
  // Map animations stop in a background tab, so the story waits there and picks up on return.
  let pausedByTab = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAttract();
      if (T.story && T.playing) { pausedByTab = true; pause(); }
    } else if (pausedByTab) {
      pausedByTab = false;
      if (T.story && !T.playing && !T.finished) play();
    }
  });
  // Someone who is already driving the globe by the time boot finishes skips the welcome this visit.
  let acted = false;
  const act = () => { acted = true; };
  for (const ev of ["pointerdown", "keydown", "wheel"]) window.addEventListener(ev, act, { once: true, passive: true, capture: true });
  app.on("app:ready", () => {
    bumpIdle();
    if (sharedLink || welcomed()) return;
    setTimeout(() => { if (!acted && !app.ui.current && !T.story) showWelcome(); }, reduceMotion.matches ? 0 : 500);
  });
  app.tours = {
    start: (name) => app.tools.run("start_tour", { name }),
    stop: endTour,
    lucky: feelingLucky,
    setDwell: (ms) => { dwellMs = clamp(Number(ms) || 12000, 3000, 120000); },
    state: () => ({ story: T.story?.id ?? null, i: T.i, playing: T.playing, arrived: T.arrived, finished: T.finished, displaced: T.displaced, flying: T.flying }),
  };
}
