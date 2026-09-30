// Boot: create the globe, then initialise every feature module in isolation so a
// single failing data source can never take the whole World Model down.
import { app, $, readHash, withHashSuppressed, syncHash, haversineKm } from "./core.js";
import { config } from "../config.js";

Object.assign(app.config, config);

const MODULES = [
  "map",        // globe, imagery, terrain, labels, 3D buildings, sky, controls, status bar
  "visual",     // standard / night vision / thermal / CRT modes + HUD
  "catalog",    // layer registry UI, curated layers, full NASA GIBS catalog, time machine
  "resources",  // Baryon resource sites, trade routes, chokepoints, commodities, products
  "live",       // earthquakes, natural events, aircraft, satellites, ISS, radar
  "earthdata",  // plates, volcanoes, tsunamis, magnetics, soils, forests, glaciers, mineral deposits
  "place",      // place card: what's here, knowledge, elevation, weather, geology
  "search",     // omnibox: places, sites, layers, commands
  "tools",      // measure, placemarks, share, screenshot, locate, keyboard
  "streetview", // street-level imagery (Panoramax)
  "tours",      // guided stories (Voyager-style)
  "agent",      // natural-language agent: local engine + Claude
];

async function boot() {
  // Before anything can rewrite the URL. A link that cannot be read starts the default view.
  let h;
  try { h = readHash(); } catch (err) {
    console.warn("[world] ignored an unreadable link", err.message);
    h = { camera: null, layers: [], off: [], times: {}, visual: null };
  }
  app.initialView = h.camera;
  app.initialImagery = h.imagery;
  app.hashOff = new Set(h.off);
  app.defaultLayers = new Set();
  app.deferredLayers = new Set();
  const mapMod = await import("./map.js");
  await mapMod.createMap(app);
  app.ui.watchFraming();

  // Fetch every module at once; initialise them one by one in the listed order.
  const loads = Object.fromEntries(MODULES.filter((n) => n !== "map").map((n) => {
    const p = import(`./${n}.js`);
    p.catch(() => {}); // reported when awaited below
    return [n, p];
  }));

  // The rail fills in as each module registers its panel.
  renderRail();
  app.on("ui:panels", renderRail);

  for (const name of MODULES) {
    try {
      const mod = name === "map" ? mapMod : await loads[name];
      await mod.init?.(app);
    } catch (err) {
      console.error(`[world] module ${name} failed to start`, err);
    }
  }
  // What a fresh visit shows; links record only the differences from it.
  for (const id of app.layers.active()) app.defaultLayers.add(id);

  // Wire panel chrome shared by all modules.
  $("#dock-close").addEventListener("click", () => {
    const id = app.ui.current;
    app.ui.closePanel();
    $(`.rail-btn[data-panel="${id}"]`)?.focus();
  });
  $("#card-close").addEventListener("click", () => app.ui.hideCard());
  sheetGrabber();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const t = e.target;
    // Esc in a text field belongs to that field; only the dock's own fields close the dock.
    if (t.closest?.("input, textarea, select, [contenteditable]") && !t.readOnly) {
      if ($("#dock").contains(t)) closeDock(true);
      return;
    }
    if (!$("#card").hidden) app.ui.hideCard();
    else if (!$("#dock").hidden) closeDock($("#dock").contains(document.activeElement));
  });

  // Restore shared state from the URL (#@lat,lng,zoom…&l=…&x=…&t=…&v=…).
  await withHashSuppressed(async () => {
    for (const [id, iso] of Object.entries(h.times)) app.layers.setTime(id, iso);
    for (const id of h.layers) {
      if (app.layers.get(id) && !app.layers.isOn(id)) await app.layers.toggle(id, true).catch(() => {});
    }
    for (const id of h.off) {
      if (app.layers.isOn(id)) await app.layers.toggle(id, false).catch(() => {});
    }
    if (h.visual) app.emit("visual:set", h.visual);
  });
  app.on("streetview:open", syncHash);
  app.on("streetview:close", syncHash);
  if (h.camera) {
    try { app.map.jumpTo(h.camera); } catch (err) { console.warn("[world] ignored the link's camera", err.message); }
  }
  app.ready = true;
  app.map.on("moveend", syncHash);
  // The picture lookup takes longer than syncHash's debounce: sv= stays in the URL meanwhile.
  if (h.streetview && app.tools.get("open_street_view")) app.pendingStreetview = h.streetview;
  syncHash();
  app.emit("app:ready");
  if (app.pendingStreetview) openLinkedStreetView(h.streetview);
  document.body.classList.add("is-ready");
  // A link opened in this tab after boot (pasted into the address bar, or Back and Forward
  // between links) changes only the fragment, so the page does not reload. The app's own
  // URL updates use replaceState, which fires no hashchange.
  addEventListener("hashchange", () => applyLink(mapMod).catch((err) => console.warn("[world] could not apply the link", err.message)));
}

function openLinkedStreetView(id) {
  app.pendingStreetview = id;
  app.tools.run("open_street_view", { picture_id: id }).catch(() => {}).finally(() => {
    if (app.pendingStreetview === id) app.pendingStreetview = null;
    syncHash();
  });
}

/** Bring the globe to the state in the current URL, as boot does for a fresh visit: camera,
 *  layers (l= on beyond the defaults, x= defaults off), dates, visual mode, imagery and
 *  Street View picture. A fragment without a camera is not a share link and is ignored. */
let linkSeq = 0;
async function applyLink(mapMod) {
  const h = readHash();
  if (!h.camera) return;
  const my = ++linkSeq;
  const sv = app.streetview;
  if (!h.streetview && sv?.isOpen()) sv.close();
  const want = new Set([...app.defaultLayers].filter((id) => !h.off.includes(id)));
  for (const id of h.layers) want.add(id);
  for (const [id, iso] of Object.entries(h.times)) if (app.layers.get(id)) app.layers.setTime(id, iso);
  // Files the visitor imported live only in this browser and stay out of links.
  for (const id of app.layers.active()) {
    if (!want.has(id) && !app.layers.get(id)?.user) await app.layers.toggle(id, false).catch(() => {});
    if (my !== linkSeq) return;
  }
  for (const id of want) {
    // A default still waiting to stream in (the archive on phones) keeps waiting.
    if (app.layers.get(id) && !app.layers.isOn(id) && !app.deferredLayers?.has(id)) await app.layers.toggle(id, true).catch(() => {});
    if (my !== linkSeq) return;
  }
  const card = $("#card");
  if (!card.hidden && card.dataset.lat && haversineKm(h.camera.center, [Number(card.dataset.lng), Number(card.dataset.lat)]) > 50) app.ui.hideCard();
  try { app.map.jumpTo(h.camera); } catch (err) { console.warn("[world] ignored the link's camera", err.message); }
  if ((h.visual ?? "standard") !== (app.visualMode ?? "standard")) app.emit("visual:set", h.visual ?? "standard");
  if ((h.imagery ?? "satellite") !== (app.baseImagery ?? "satellite")) mapMod.setImagery(h.imagery ?? "satellite");
  if (h.streetview && app.tools.get("open_street_view") && sv?.current()?.id !== h.streetview) openLinkedStreetView(h.streetview);
  syncHash();
}

/** Phones: the dock is a bottom sheet, and its grabber really drags. The sheet snaps to
 *  full (62% of the screen), half, or just its title bar; a tap on the title bar toggles
 *  full and title bar. The globe's framing follows (ui:sheet). Every panel opens full. */
function sheetGrabber() {
  const dock = $("#dock"), head = dock.querySelector(".dock-head");
  const phone = matchMedia("(max-width: 720px)");
  const detents = () => {
    const bar = Math.round(head.getBoundingClientRect().height + parseFloat(getComputedStyle(dock).paddingBottom || "0"));
    // Full is 62% of the screen, or less when the panel's content is shorter.
    const full = Math.round(Math.min(innerHeight * 0.62, bar + $("#dock-body").scrollHeight));
    return [bar, Math.round(Math.min(full, Math.max(bar + 80, innerHeight * 0.36))), full];
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let settle = 0;
  const setHeight = (h) => {
    const [bar, , full] = detents();
    const sheet = h >= full - 2 ? "full" : h <= bar + 2 ? "bar" : "half";
    dock.dataset.sheet = sheet;
    dock.style.height = `${Math.round(h)}px`;
    // Once the sheet has arrived: full height goes back to fitting the content, and the
    // globe's framing follows the new height.
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (dock.dataset.sheet !== sheet) return;
      if (sheet === "full") dock.style.height = "";
      app.emit("ui:sheet", sheet);
    }, reduce.matches ? 0 : 300);
  };
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (!phone.matches || e.button > 0 || e.target.closest("button, a, input")) return;
    drag = { id: e.pointerId, y: e.clientY, h: dock.getBoundingClientRect().height, t: performance.now(), moved: false };
    head.setPointerCapture?.(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) { drag.moved = true; dock.classList.add("is-dragging"); }
    const [bar, , full] = detents();
    dock.style.height = `${Math.round(Math.min(full, Math.max(bar, drag.h - dy)))}px`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    dock.classList.remove("is-dragging");
    const stops = detents();
    const now = dock.getBoundingClientRect().height;
    if (!d.moved) {
      // A tap on the title bar: open fully, or fold down to the bar.
      if (e.type === "pointerup") setHeight(now < stops[2] - 2 ? stops[2] : stops[0]);
      return;
    }
    // A flick carries on to the next stop in its direction; a slow drag settles on the nearest.
    const v = (d.h - now) / Math.max(1, performance.now() - d.t); // px per ms, up is positive
    let to = stops.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
    if (Math.abs(v) > 0.5) to = v > 0 ? stops.find((s) => s > now + 1) ?? stops[2] : [...stops].reverse().find((s) => s < now - 1) ?? stops[0];
    setHeight(to);
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
  // Each panel opens at full height.
  app.on("ui:panel", () => { if (dock.style.height) { dock.style.height = ""; dock.dataset.sheet = "full"; } });
  phone.addEventListener?.("change", () => { dock.style.height = ""; dock.dataset.sheet = "full"; });
}

function closeDock(refocus) {
  const id = app.ui.current;
  app.ui.closePanel();
  if (refocus) $(`.rail-btn[data-panel="${id}"]`)?.focus();
}

const SHORT = matchMedia("(max-height: 520px) and (min-width: 721px)");
function renderRail() {
  const rail = $("#rail");
  const focused = rail.contains(document.activeElement) ? document.activeElement.dataset.panel : null;
  const panels = [...app.ui.panels.values()].filter((p) => p.rail).sort((a, b) => a.order - b.order);
  rail.replaceChildren(
    ...panels.map((p) => {
      const b = document.createElement("button");
      b.className = "rail-btn";
      b.type = "button";
      b.dataset.panel = p.id;
      b.setAttribute("aria-pressed", String(app.ui.current === p.id));
      b.setAttribute("aria-label", p.title);
      b.innerHTML = `${p.icon}<span class="tip">${p.title}</span>`;
      b.addEventListener("click", () => {
        // A short window shows the place card in the dock's place (world.css): a rail button
        // brings its panel back to the front.
        if (SHORT.matches && !$("#card").hidden) { app.ui.hideCard(); if (app.ui.current === p.id) return; }
        app.ui.current === p.id ? app.ui.closePanel() : app.ui.openPanel(p.id);
      });
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") app.ui.focusDockOnOpen = true;
      });
      return b;
    }),
  );
  if (focused) $(`.rail-btn[data-panel="${focused}"]`)?.focus();
}

boot().catch((err) => {
  console.error(err);
  const t = document.getElementById("toasts");
  if (t) t.innerHTML = `<div class="toast toast-error" role="alert">The World Model could not start: ${String(err.message).replace(/</g, "&lt;")}</div>`;
});
