// Baryon World Model — core contract. Every feature module imports `app` and
// plugs into it: layers register with app.layers, agent-callable functions
// register with app.tools (the free local command engine and the Claude agent
// both drive the globe through exactly these), panels mount into app.ui.
//
// Module contract:
//   export function init(app) { ... }   // called once, after the map exists
// Layer definition (app.layers.define):
//   { id, title, category, description?, keywords?: string[], source: "who publishes it",
//     attribution?, license?, kind: "raster"|"geojson"|"vector"|"custom",
//     live?: boolean, refreshMs?: number, time?: {min,max,default,step:"day"|"month"|"year"},
//     slot?: "imagery"|"overlay"|"data"|"live"|"top", legend?: string (HTML),
//     add(map, ctx) -> void|Promise, remove(map, ctx) -> void, setTime?(map, isoDate),
//     setOpacity?(map, v) }
// Tool definition (app.tools.define):
//   name, { description, input_schema (JSON Schema object), run: async (input) => JSON-able,
//           local?: { patterns: RegExp[], parse(match, text) -> input } }

const listeners = new Map();

export const app = {
  map: null,
  maplibregl: null,
  version: "2026.09.28",
  config: {
    // Optional hosted agent endpoint (a proxy that holds the API key server-side).
    // Set in /world/config.js; when empty the agent uses a key the visitor supplies,
    // or the free local command engine.
    agentEndpoint: "",
    defaultModel: "claude-opus-5",
  },

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, detail) {
    for (const fn of listeners.get(event) ?? []) {
      try { fn(detail); } catch (err) { console.error(`[world] ${event} listener failed`, err); }
    }
  },
};

/* ------------------------------------------------------------------ utils */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n, digits = 0) => (n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits }));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return isoDay(d); }

/** fetch JSON with a timeout and a readable error. */
export async function getJSON(url, { timeout = 20000, ...init } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url, location.href).hostname} answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${new URL(url, location.href).hostname} timed out`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Loose "did you mean" scoring used by search + local command engine. */
export function score(text, query) {
  const t = text.toLowerCase(), q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const words = q.split(/\s+/).filter(Boolean);
  let hit = 0;
  for (const w of words) if (t.includes(w)) hit++;
  if (!hit) return 0;
  return 20 + Math.round((hit / words.length) * 50) - Math.min(15, Math.abs(t.length - q.length) / 6);
}

/* ------------------------------------------------------------ layers */
const layerDefs = new Map();
const layerOn = new Set();
const layerTime = new Map();

app.layers = {
  define(def) {
    if (!def?.id || typeof def.add !== "function") throw new Error("layer needs id + add()");
    layerDefs.set(def.id, { slot: "data", category: "Other", keywords: [], ...def });
    app.emit("layers:defined", def.id);
    return def.id;
  },
  get: (id) => layerDefs.get(id),
  list: () => [...layerDefs.values()],
  isOn: (id) => layerOn.has(id),
  active: () => [...layerOn],
  async toggle(id, on) {
    const def = layerDefs.get(id);
    if (!def) throw new Error(`No layer "${id}"`);
    const want = on ?? !layerOn.has(id);
    if (want === layerOn.has(id)) return want;
    const ctx = { app, time: layerTime.get(id) ?? def.time?.default ?? null };
    try {
      if (want) {
        layerOn.add(id);
        app.emit("layers:changed", { id, on: true });
        await def.add(app.map, ctx);
      } else {
        layerOn.delete(id);
        def.remove(app.map, ctx);
        app.emit("layers:changed", { id, on: false });
      }
    } catch (err) {
      layerOn.delete(id);
      try { def.remove(app.map, ctx); } catch {}
      app.emit("layers:changed", { id, on: false });
      app.ui.toast(`${def.title}: ${err.message}`, { tone: "error" });
      throw err;
    }
    syncHash();
    return want;
  },
  setTime(id, iso) {
    const def = layerDefs.get(id);
    layerTime.set(id, iso);
    if (def?.setTime && layerOn.has(id)) def.setTime(app.map, iso);
    app.emit("layers:time", { id, iso });
    syncHash();
  },
  timeOf: (id) => layerTime.get(id) ?? layerDefs.get(id)?.time?.default ?? null,
  undefine(id) {
    layerOn.delete(id);
    layerTime.delete(id);
    layerDefs.delete(id);
    app.emit("layers:defined", id);
    syncHash();
  },
  /** beforeId for a slot, so imagery stays under labels and live dots on top. */
  anchor(slot) { return `anchor-${slot}`; },
};

/* ------------------------------------------------------------ agent tools */
const toolDefs = new Map();
app.tools = {
  define(name, def) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) throw new Error(`bad tool name ${name}`);
    toolDefs.set(name, { name, ...def });
  },
  get: (name) => toolDefs.get(name),
  list: () => [...toolDefs.values()],
  async run(name, input = {}) {
    const def = toolDefs.get(name);
    if (!def) throw new Error(`Unknown tool ${name}`);
    app.emit("tool:start", { name, input });
    try {
      const out = await def.run(input ?? {});
      app.emit("tool:end", { name, input, output: out });
      return out;
    } catch (err) {
      app.emit("tool:end", { name, input, error: err.message });
      throw err;
    }
  },
};

/* ------------------------------------------------------------ UI helpers */
app.ui = {
  toast(message, { tone = "info", ms = 3600 } = {}) {
    const host = $("#toasts");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast toast-${tone}`;
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    el.textContent = message;
    host.append(el);
    setTimeout(() => el.classList.add("out"), ms);
    setTimeout(() => el.remove(), ms + 400);
  },

  /** Panels are named sheets inside the left dock; one is open at a time. */
  panels: new Map(),
  definePanel(id, { title, icon, order = 50, render, onOpen, onClose, rail = true }) {
    this.panels.set(id, { id, title, icon, order, render, onOpen, onClose, rail, mounted: false });
    app.emit("ui:panels", id);
  },
  current: null,
  openPanel(id, arg) {
    const p = this.panels.get(id);
    if (!p) return;
    const body = $("#dock-body");
    if (this.current && this.current !== id) this.panels.get(this.current)?.onClose?.();
    $("#dock").hidden = false;
    $("#dock").dataset.panel = id;
    $("#dock-title").textContent = p.title;
    body.replaceChildren();
    // A new view starts at its top (the old content's scroll offset would otherwise carry
    // over); a panel that restores its own place does so in render() or onOpen().
    body.scrollTop = 0;
    const node = document.createElement("div");
    node.className = "panel";
    node.dataset.panel = id;
    body.append(node);
    p.render(node, arg);
    this.current = id;
    for (const b of $$(".rail-btn")) b.setAttribute("aria-pressed", String(b.dataset.panel === id));
    p.onOpen?.(arg);
    if (this.focusDockOnOpen) {
      this.focusDockOnOpen = false;
      const title = $("#dock-title");
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    app.emit("ui:panel", id);
  },
  closePanel() {
    if (this.current) this.panels.get(this.current)?.onClose?.();
    this.current = null;
    $("#dock").hidden = true;
    for (const b of $$(".rail-btn")) b.setAttribute("aria-pressed", "false");
    app.emit("ui:panel", null);
  },

  /** Apple-Maps-style place card (floating, right side on desktop). `point` ({lat,lng})
   *  is the place the card is about; `busy` marks a placeholder still loading. */
  showCard(html, { onClose, point, busy = false } = {}) {
    const card = $("#card"), body = $("#card-body");
    const active = document.activeElement;
    const hadFocus = body.contains(active);
    if (!card.contains(active)) card._invoker = active && active !== document.body ? active : card._invoker;
    body.innerHTML = html;
    card.hidden = false;
    card._onClose = onClose;
    if (point) { card.dataset.lat = point.lat; card.dataset.lng = point.lng; }
    else { delete card.dataset.lat; delete card.dataset.lng; }
    card.setAttribute("aria-busy", String(busy));
    const head = body.querySelector("h1, h2, h3, h4");
    if (head) { head.id = "card-title"; card.setAttribute("aria-labelledby", "card-title"); card.removeAttribute("aria-label"); }
    else { card.removeAttribute("aria-labelledby"); card.setAttribute("aria-label", "Details"); }
    const title = head?.textContent.trim() ?? "";
    if (!busy && title && title !== card._title) {
      card._title = title;
      const st = $("#card-status");
      if (st) st.textContent = `Showing ${title}`;
    }
    // Keyboard users keep their place: a refresh re-focuses the new title, and a card
    // opened from the keyboard takes focus once.
    const typingElsewhere = active && active !== document.body && active.id !== "q" && !card.contains(active);
    if (head && (hadFocus || this.focusCardOnOpen)) {
      const take = hadFocus || !typingElsewhere;
      this.focusCardOnOpen = false;
      if (take) {
        head.tabIndex = -1;
        head.focus({ preventScroll: true });
      }
    }
    app.emit("ui:card", true);
  },
  hideCard() {
    const card = $("#card");
    if (card.hidden) return;
    const active = document.activeElement;
    const restore = card.contains(active) || !active || active === document.body;
    card.hidden = true;
    card._title = null;
    delete card.dataset.lat;
    delete card.dataset.lng;
    card._onClose?.();
    if (restore) {
      let to = card._invoker?.isConnected && !card._invoker.closest("[hidden]") ? card._invoker : app.map?.getCanvas();
      // On touch screens focusing a text field would raise the keyboard.
      if (to?.matches?.("input, textarea") && matchMedia("(pointer: coarse)").matches) to = app.map?.getCanvas();
      to?.focus({ preventScroll: true });
    }
    card._invoker = null;
    app.emit("ui:card", false);
  },

  /** Room the floating chrome leaves for the subject of a camera move: the bottom sheet
   *  on phones, the dock and the card on desktop. `card: true` when a card is about to open. */
  framePadding({ card: opening = false, sheets = true } = {}) {
    const dock = $("#dock"), card = $("#card");
    const dockOn = sheets && dock && !dock.hidden, cardOn = sheets && card && (!card.hidden || opening);
    const ch = app.map?.getCanvas().clientHeight || innerHeight;
    if (innerWidth <= 720) {
      const sheet = Math.max(
        dockOn ? dock.getBoundingClientRect().height : 0,
        cardOn ? (card.hidden ? innerHeight * 0.62 : card.getBoundingClientRect().height) : 0,
      );
      return { top: 110, left: 16, right: 16, bottom: Math.round(Math.max(84, Math.min(sheet + 16, ch - 160))) };
    }
    // Short windows (landscape phones): a narrower dock, and a card that takes the dock's
    // place while both are open (world.css).
    if (innerHeight <= 520) {
      const left = dockOn ? Math.round(dock.getBoundingClientRect().right + 14) : 80;
      return { top: 70, bottom: 64, left, right: cardOn && !dockOn ? (card.hidden ? 388 : Math.round(innerWidth - card.getBoundingClientRect().left + 14)) : 80 };
    }
    // Tablet portrait: beside an open dock the card is a sheet along the foot of the map.
    if (innerWidth <= 920 && dockOn && cardOn) {
      const top = card.hidden ? ch * 0.55 - 58 : card.getBoundingClientRect().top;
      return { top: 130, bottom: Math.round(Math.max(80, ch - top + 16)), left: Math.round(dock.getBoundingClientRect().right + 14), right: 80 };
    }
    return { top: 80, bottom: 80, left: dockOn ? 470 : 80, right: cardOn ? 440 : 80 };
  },
  /** flyTo that lands `center` in the middle of the open part of the map. The subject stays
   *  the camera's centre and the map's padding moves that centre clear of the card, dock or
   *  sheet: an offset would put a different ground point in the middle, and on a mountain
   *  the finer terrain that loads after landing would then lift the subject up the screen.
   *  The padding then follows the card, dock and sheet as they open and close (watchFraming;
   *  see cameraRules in map.js for how other modules' moves treat it). */
  flyFramed(opts, { card = false } = {}) {
    const m = app.map;
    this.watchFraming();
    this.framed = "subject";
    m.flyTo({ ...opts, ...this.steepFit(opts), padding: this.framePadding({ card }) }, { framed: true });
  },
  /** The camera sits closer to the ground on a shorter map (MapLibre's field of view spans its
   *  height), so a steep 3D view over mountains on a landscape phone puts it inside the rock:
   *  a mostly black view. Such a view backs off to a 720 px tall window's camera height. A
   *  move that keeps the current zoom keeps it (repeated flights never creep outward). */
  steepFit(opts) {
    const m = app.map, h = m.getCanvas().clientHeight || innerHeight;
    const pitch = opts.pitch ?? m.getPitch();
    if (h >= 720 || !(opts.zoom >= 10) || pitch < 45 || !m.getTerrain() || Math.abs(opts.zoom - m.getZoom()) < 0.05) return {};
    return { zoom: opts.zoom - Math.log2(720 / h) };
  },
  /** "subject" after flyFramed; "world" while a phone sheet has lifted the whole globe into
   *  the open band above it (worldZoomWas: the zoom to return to); false otherwise. */
  framed: false,
  worldZoomWas: null,
  /** Zoom at which the whole globe fits the open part of the map (MapLibre draws the globe
   *  worldSize / π pixels across). */
  worldZoom(pad = this.framePadding()) {
    const c = app.map.getCanvas();
    const room = Math.min(c.clientWidth - pad.left - pad.right, c.clientHeight - pad.top - pad.bottom);
    return clamp(Math.log2((Math.max(120, room) * 0.94 * Math.PI) / 512), -0.6, 2.4);
  },
  /** Frame a set of [lng, lat] points in the open part of the map. A set spread across the
   *  world shows the whole globe turned to its largest cluster: a box around sites in Chile,
   *  Australia and China would frame the empty Pacific. */
  fitPoints(points, { maxZoom = 10, speed = 1.2, card = false, pitch } = {}) {
    const pts = points.filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
    if (!pts.length) return;
    const m = app.map, pad = this.framePadding({ card }), c = m.getCanvas();
    // The shortest run of longitudes holding every point (it may cross the 180° line).
    const lngs = pts.map((p) => ((((p[0] + 180) % 360) + 360) % 360) - 180).sort((a, b) => a - b);
    let gap = 360 - (lngs[lngs.length - 1] - lngs[0]), west = lngs[0];
    for (let i = 1; i < lngs.length; i++) if (lngs[i] - lngs[i - 1] > gap) { gap = lngs[i] - lngs[i - 1]; west = lngs[i]; }
    const arc = 360 - gap;
    const lats = pts.map((p) => p[1]);
    const south = Math.min(...lats), north = Math.max(...lats);
    if (arc > 150 || north - south > 100) {
      // Turn the globe to the point with the most others within 2,500 km, and show all of it.
      let best = pts[0], most = -1;
      for (const p of pts) {
        let n = 0;
        for (const q of pts) if (haversineKm(p, q) < 2500) n++;
        if (n > most) { most = n; best = p; }
      }
      this.flyFramed({ center: best, zoom: this.worldZoom(pad), pitch: 0, speed }, { card });
      // The globe grows back as the sheet is lowered or closed.
      this.framed = "world";
      this.worldZoomWas = this.worldZoom(this.framePadding({ sheets: false }));
      return;
    }
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (clamp(lat, -85, 85) * Math.PI) / 360)) / (2 * Math.PI);
    const w = Math.max(1e-6, (arc / 360) * 512), h = Math.max(1e-6, (mercY(north) - mercY(south)) * 512);
    const room = [c.clientWidth - pad.left - pad.right, c.clientHeight - pad.top - pad.bottom].map((v) => Math.max(80, v) * 0.85);
    const zoom = clamp(Math.log2(Math.min(room[0] / w, room[1] / h)), this.worldZoom(pad), maxZoom);
    const center = [((((west + arc / 2 + 180) % 360) + 360) % 360) - 180, (south + north) / 2];
    this.flyFramed({ center, zoom, speed, ...(pitch != null ? { pitch } : {}) }, { card });
  },
  /** Keep a framed subject (or a phone's whole globe) in the open part of the map as the
   *  card, the dock and the sheet's height change. */
  watchFraming() {
    if (this.watchingFrame) return;
    this.watchingFrame = true;
    const m = app.map;
    const phone = matchMedia("(max-width: 720px)");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    // The visitor's own gesture, or any other camera move, ends the framing; a resize (a
    // phone's browser bar coming and going) does not.
    let before = null;
    m.on("movestart", (e) => {
      if (e.framed) return;
      before = [this.framed, this.worldZoomWas];
      this.framed = false;
      this.worldZoomWas = null;
    });
    m.on("resize", () => { if (before) [this.framed, this.worldZoomWas] = before; });
    m.on("moveend", () => { before = null; });
    const follow = () => {
      if (m.isMoving()) return;
      const pad = this.framePadding(), cur = m.getPadding();
      const same = ["top", "bottom", "left", "right"].every((k) => Math.abs((cur[k] ?? 0) - pad[k]) < 16);
      // On a phone, a sheet over a zoomed-out view hides most of it: lift the view into the
      // band above the sheet. A globe that fits the screen also shrinks to fit the band, and
      // gets its size back when the sheet goes.
      const sheet = !$("#dock").hidden || !$("#card").hidden;
      if (!this.framed && phone.matches && sheet && m.getZoom() < 3 && !same) {
        this.framed = "world";
        const whole = Math.log2((m.getCanvas().clientWidth * Math.PI) / 512) + 0.2;
        this.worldZoomWas = m.getZoom() <= whole ? m.getZoom() : null;
      }
      // After the visitor has moved on, padding that is still ours keeps following the sheets
      // (so later flights still land in the open part); only the subject's framing has ended.
      if (!this.framed && !app.framedPadding) return;
      const opts = { padding: pad, duration: reduce.matches ? 0 : 450 };
      if (this.framed === "world" && this.worldZoomWas != null) {
        const z = Math.min(this.worldZoomWas, this.worldZoom(pad));
        if (Math.abs(z - m.getZoom()) > 0.05) opts.zoom = z;
      }
      if (same && opts.zoom == null) return;
      m.easeTo(opts, { framed: true });
    };
    // A panel opened during the flight: frame for it once the camera lands.
    m.on("moveend", (e) => { if (e.framed) requestAnimationFrame(follow); });
    for (const ev of ["ui:card", "ui:panel", "ui:sheet"]) app.on(ev, () => requestAnimationFrame(follow));
  },
  /** Pan so `lngLat` sits in the middle of the open part of the map (if it is not already). */
  frameInto(lngLat, pad = this.framePadding()) {
    const m = app.map, c = m.getCanvas();
    const want = [pad.left + (c.clientWidth - pad.left - pad.right) / 2, pad.top + (c.clientHeight - pad.top - pad.bottom) / 2];
    const p = m.project(lngLat);
    // panBy (unlike an offset) also holds under reduced motion, where flights become jumps.
    if (Math.hypot(p.x - want[0], p.y - want[1]) > 40) m.panBy([p.x - want[0], p.y - want[1]], { duration: 500 });
  },
};

/* ------------------------------------------------------------ URL state */
// #@lat,lng,zoomz,pitchp,bearingb&l=layer1,layer2&x=defaultOff1&t=layerId:YYYY-MM-DD&v=mode
// l= lists layers switched on beyond the defaults, x= default layers switched off.
let hashTimer = null;
let suppressHash = false;
export function syncHash() {
  // Never write the URL before boot has read it (a shared link would be clobbered).
  if (!app.map || suppressHash || !app.ready) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const m = app.map;
    const c = m.getCenter();
    const cam = `@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${m.getZoom().toFixed(2)}z,${m.getPitch().toFixed(0)}p,${m.getBearing().toFixed(0)}b`;
    const parts = [cam];
    // Imported files (user: true) live only in this browser, so they stay out of links.
    const defaults = app.defaultLayers ?? new Set();
    const active = app.layers.active().filter((id) => !app.layers.get(id)?.user);
    const on = active.filter((id) => !defaults.has(id));
    if (on.length) parts.push(`l=${on.map(encodeURIComponent).join(",")}`);
    // A default still waiting to load (resource sites on a phone) is not "switched off".
    const off = [...defaults].filter((id) => !app.layers.isOn(id) && app.layers.get(id) && !app.deferredLayers?.has(id));
    if (off.length) parts.push(`x=${off.map(encodeURIComponent).join(",")}`);
    const times = active.filter((id) => app.layers.get(id)?.time).map((id) => `${encodeURIComponent(id)}:${app.layers.timeOf(id)}`);
    if (times.length) parts.push(`t=${times.join(",")}`);
    if (app.visualMode && app.visualMode !== "standard") parts.push(`v=${app.visualMode}`);
    if (app.baseImagery && app.baseImagery !== "satellite") parts.push(`b=${app.baseImagery}`);
    // A linked picture still being looked up (main.js) keeps its place in the URL.
    const sv = app.streetview?.isOpen() ? app.streetview.current()?.id : app.pendingStreetview ?? null;
    if (sv) parts.push(`sv=${encodeURIComponent(sv)}`);
    history.replaceState(null, "", `#${parts.join("&")}`);
  }, 250);
}

/** decodeURIComponent that returns null for a broken escape (a link cut off after "%3"). */
const decodePart = (s) => { try { return decodeURIComponent(s); } catch { return null; } };
const idList = (s) => s.split(",").map(decodePart).filter(Boolean);

/** The state in a shared link. Never throws: a clipped or hand-edited link starts the globe
 *  with whatever parts still read, and skips the rest. */
export function readHash() {
  const out = { camera: null, layers: [], off: [], times: {}, visual: null };
  let raw = "";
  try { raw = location.hash.slice(1); } catch {}
  if (!raw) return out;
  // A fragment that an app escaped as a whole ("%40-13.1,…%26l%3D…") is read unescaped.
  if (!/[@=]/.test(raw)) raw = decodePart(raw) ?? raw;
  // Each part is decoded on its own (ids are encoded one by one, so an encoded "&" or ","
  // inside one never splits it).
  for (const part of raw.split("&")) {
    if (part.startsWith("@")) {
      const m = part.slice(1).match(/^(-?[\d.]+),(-?[\d.]+),([\d.]+)z(?:,([\d.]+)p)?(?:,(-?[\d.]+)b)?/);
      const [lat, lng, zoom, pitch, bearing] = m ? [m[1], m[2], m[3], m[4] ?? 0, m[5] ?? 0].map(Number) : [];
      // A hand-edited or corrupted link must never stop the globe from starting.
      if (m && [lat, lng, zoom].every(Number.isFinite) && Math.abs(lat) <= 90) {
        out.camera = {
          center: [((((lng + 180) % 360) + 360) % 360) - 180, lat],
          zoom: clamp(zoom, 0, 22),
          pitch: Number.isFinite(pitch) ? clamp(pitch, 0, 85) : 0,
          bearing: Number.isFinite(bearing) ? bearing % 360 : 0,
        };
      }
    } else if (part.startsWith("l=")) out.layers = idList(part.slice(2));
    else if (part.startsWith("x=")) out.off = idList(part.slice(2));
    else if (part.startsWith("t=")) {
      for (const pair of idList(part.slice(2))) {
        const i = pair.lastIndexOf(":");
        if (i > 0) out.times[pair.slice(0, i)] = pair.slice(i + 1);
      }
    } else if (part.startsWith("v=")) out.visual = decodePart(part.slice(2));
    else if (part.startsWith("b=")) out.imagery = decodePart(part.slice(2));
    else if (part.startsWith("sv=")) out.streetview = decodePart(part.slice(3));
  }
  return out;
}

export function withHashSuppressed(fn) {
  suppressHash = true;
  try { return fn(); } finally { suppressHash = false; }
}
