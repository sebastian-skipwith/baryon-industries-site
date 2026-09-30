// Resources: Baryon's world model of the physical economy on the globe — 102,731
// mines, plants and ports, curated key assets, maritime chokepoints, trade routes
// (sea legs along real shipping lanes, overland legs as approximate road paths),
// commodity balances, consumption and reserves by country, and rock-to-product
// supply chains.
import { app, $, esc, fmt, getJSON, haversineKm, score } from "./core.js";

const TYPE_COLOR = { mine: "#f0a500", deposit: "#a8a888", smelter: "#38bdf8", refinery: "#38bdf8", processing: "#38bdf8", port: "#34d399", storage: "#2dd4bf", factory: "#a78bfa", chokepoint: "#f43f5e" };
const TYPE_LABEL = { mine: "Mine", deposit: "Deposit", smelter: "Smelter", refinery: "Refinery", processing: "Processing plant", port: "Port", storage: "Storage terminal", factory: "Factory", chokepoint: "Maritime chokepoint" };
const MODE_COLOR = { sea: "#f0a500", rail: "#38bdf8", road: "#a8a29e", pipeline: "#34d399", mixed: "#f0a500", unknown: "#f0a500" };
const MATCH_TYPE = ["match", ["get", "t"], "mine", TYPE_COLOR.mine, "deposit", TYPE_COLOR.deposit, "smelter", TYPE_COLOR.smelter, "refinery", TYPE_COLOR.refinery, "processing", TYPE_COLOR.processing, "port", TYPE_COLOR.port, "storage", TYPE_COLOR.storage, "factory", TYPE_COLOR.factory, "#f0a500"];

// Plain-language names people type → the model's commodity names.
const SYNONYMS = {
  aluminum: "Bauxite / aluminum", aluminium: "Bauxite / aluminum", bauxite: "Bauxite / aluminum",
  coal: "Coal (met/thermal)", oil: "Crude oil", petroleum: "Crude oil", crude: "Crude oil",
  gas: "Natural gas / LNG", lng: "Natural gas / LNG", "natural gas": "Natural gas / LNG",
  graphite: "Graphite (natural)", phosphate: "Phosphate rock (P)", potash: "Potash (K)",
  "rare earth": "Rare earths (Nd/Pr/Dy)", "rare earths": "Rare earths (Nd/Pr/Dy)", ree: "Rare earths (Nd/Pr/Dy)",
  pgm: "Platinum Group Metals", platinum: "Platinum Group Metals", palladium: "Platinum Group Metals", iron: "Iron ore",
};
const TYPE_WORDS = { mine: ["mine", "mines", "mining", "deposit", "deposits"], processing: ["smelter", "smelters", "refinery", "refineries", "plant", "plants", "processing"], port: ["port", "ports", "terminal", "terminals", "harbor", "harbour"], factory: ["factory", "factories", "gigafactory"], chokepoint: ["chokepoint", "chokepoints", "strait", "straits", "canal"] };
const TYPE_GROUP = { mine: "mine", deposit: "mine", smelter: "processing", refinery: "processing", processing: "processing", port: "port", storage: "port", factory: "factory", chokepoint: "chokepoint" };

const D = { stats: null, balances: [], shares: {}, products: [], curated: [], flows: [], bulk: null };
const state = { commodity: "", product: "", markers: [] };
let bulkPromise = null;
const BULK_URL = "/data/sites.geojson";
// Seed records carry Baryon's own estimates that no published source has confirmed yet.
const isSeed = (s) => /^seed\b/i.test(s?.source ?? "");

/* ---------------------------------------------------------------- data */
async function loadCore() {
  const [stats, balances, shares, products, curated, flows] = await Promise.all([
    getJSON("/data/stats.json"), getJSON("/data/balances.json"), getJSON("/data/shares.json"),
    getJSON("/data/products.json"), getJSON("/data/curated.json"), getJSON("/data/flows.json"),
  ]);
  Object.assign(D, { stats, balances, shares, products, curated, flows });
}
/** The 102k archive (≈17 MB, gzipped on the wire). The map layer streams it inside the
 *  MapLibre worker; this main-thread copy loads only when search, the agent or a
 *  commodity filter needs to read it. */
function loadBulk() {
  bulkPromise ??= getJSON(BULK_URL, { timeout: 90000 }).then((g) => (D.bulk = g)).catch((err) => { bulkPromise = null; throw err; });
  return bulkPromise;
}

export function commodityName(text) {
  if (!text) return "";
  const t = text.toLowerCase().trim();
  if (SYNONYMS[t]) return SYNONYMS[t];
  let best = "", bestScore = 0;
  for (const b of D.balances) {
    const s = score(b.name, t);
    if (s > bestScore) { best = b.name; bestScore = s; }
  }
  for (const [k, v] of Object.entries(SYNONYMS)) if (t.includes(k) && 60 > bestScore) { best = v; bestScore = 60; }
  return bestScore >= 30 ? best : "";
}

/* ---------------------------------------------------------------- map layers */
function curatedFC() {
  return {
    type: "FeatureCollection",
    features: D.curated
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !state.commodity || s.commodity === state.commodity || s.type === "chokepoint")
      .map(({ s, i }) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { i, t: s.type, color: TYPE_COLOR[s.type] ?? "#f0a500", label: `${s.name} — ${TYPE_LABEL[s.type] ?? s.type} · ${s.country}` } })),
  };
}
function flowsFC() {
  return {
    type: "FeatureCollection",
    features: D.flows
      .filter((f) => !state.commodity || f.commodity === state.commodity)
      .map((f) => {
        // Overland legs are routed along roads (OSRM), not the real rail or pipeline line.
        const label = f.mode === "sea" || /approx/i.test(f.label) ? f.label : `${f.label} (approximate overland path)`;
        return { type: "Feature", geometry: { type: "LineString", coordinates: f.path ?? [f.from, f.to] }, properties: { label, color: MODE_COLOR[f.mode] ?? "#f0a500", mode: f.mode } };
      }),
  };
}
function bulkFC() {
  if (!D.bulk) return { type: "FeatureCollection", features: [] };
  if (!state.commodity) return D.bulk;
  return { type: "FeatureCollection", features: D.bulk.features.filter((f) => f.properties.c === state.commodity) };
}
let bulkShown = "";
/** Point the archive layer at the full file (parsed in the worker) or at one commodity. */
function setBulkData() {
  const src = app.map.getSource("res-bulk");
  if (!src) return;
  const want = state.commodity && D.bulk ? `c:${state.commodity}` : "all";
  if (want === bulkShown) return;
  bulkShown = want;
  src.setData(want === "all" ? BULK_URL : bulkFC());
}
function refresh() {
  const m = app.map;
  m.getSource("res-curated")?.setData(curatedFC());
  m.getSource("res-flows")?.setData(flowsFC());
  if (state.commodity && !D.bulk && app.layers.isOn("resource-sites")) loadBulk().then(setBulkData, () => {});
  else setBulkData();
}

// Layer event handlers, kept so remove() can take them off again: every re-add (tours
// switch these layers off and on) would otherwise stack another copy of each.
const handlers = [];
function listen(m, type, layer, fn) {
  m.on(type, layer, fn);
  handlers.push({ type, layer, fn });
}
function unlisten(m, layers) {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (!layers.includes(h.layer)) continue;
    m.off(h.type, h.layer, h.fn);
    handlers.splice(i, 1);
  }
}
// Measure, pin and Street View own the map click while they run.
const busy = () => Boolean(app.mode && app.mode !== "explore");
const CHAIN_HIDES = ["res-bulk-clusters", "res-bulk-count", "res-bulk-dot"];
function setArchiveVisible(on) {
  for (const id of CHAIN_HIDES) if (app.map.getLayer(id)) app.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function defineLayers() {
  const popup = new app.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  const hover = (m, layer, get) => {
    listen(m, "mouseenter", layer, (e) => {
      if (busy()) return;
      m.getCanvas().style.cursor = "pointer";
      const f = e.features[0];
      popup.setLngLat(f.geometry.type === "Point" ? f.geometry.coordinates : e.lngLat).setHTML(esc(get(f))).addTo(m);
    });
    listen(m, "mouseleave", layer, () => { m.getCanvas().style.cursor = ""; popup.remove(); });
  };
  const dropHandlers = (m, layers) => {
    unlisten(m, layers);
    popup.remove();
    if (m.getCanvas().style.cursor === "pointer") m.getCanvas().style.cursor = "";
  };

  app.layers.define({
    id: "resource-sites",
    title: `Mines, plants & ports (${fmt(D.stats?.sites ?? 102731)})`,
    category: "Resources",
    description: "Every site in Baryon's world model: USGS MRDS mines and plants, Global Energy Monitor coal, steel, oil & gas and LNG assets, and the World Port Index. Clusters expand as you zoom.",
    keywords: ["mines", "mining", "plants", "ports", "resource", "deposits", "sites", "usgs", "mrds"],
    source: "USGS MRDS · Global Energy Monitor · NGA World Port Index (via Baryon)",
    attribution: "Sites: USGS MRDS, Global Energy Monitor (CC BY 4.0), NGA World Port Index",
    kind: "geojson",
    async add(m) {
      if (state.commodity) await loadBulk().catch(() => {});
      if (!app.layers.isOn("resource-sites") || m.getSource("res-bulk")) return;
      bulkShown = state.commodity && D.bulk ? `c:${state.commodity}` : "all";
      // A URL, not the parsed object: the worker fetches and parses the 17 MB file off the main thread.
      m.addSource("res-bulk", { type: "geojson", data: bulkShown === "all" ? BULK_URL : bulkFC(), cluster: true, clusterMaxZoom: 9, clusterRadius: 44 });
      const before = app.layers.anchor("data");
      m.addLayer({ id: "res-bulk-clusters", type: "circle", source: "res-bulk", filter: ["has", "point_count"], paint: {
        "circle-color": "rgba(20,20,20,0.55)", "circle-stroke-color": "rgba(255,255,255,0.75)", "circle-stroke-width": 1,
        "circle-radius": ["step", ["get", "point_count"], 9, 25, 12, 100, 16, 500, 21, 2000, 27] } }, before);
      m.addLayer({ id: "res-bulk-count", type: "symbol", source: "res-bulk", filter: ["has", "point_count"], layout: {
        "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 10.5 }, paint: { "text-color": "#fff" } }, before);
      m.addLayer({ id: "res-bulk-dot", type: "circle", source: "res-bulk", filter: ["!", ["has", "point_count"]], paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 10, 4.5, 15, 6], "circle-color": MATCH_TYPE,
        "circle-stroke-color": "rgba(0,0,0,0.6)", "circle-stroke-width": 0.8 } }, before);
      hover(m, "res-bulk-dot", (f) => `${f.properties.n} — ${f.properties.c} ${TYPE_LABEL[f.properties.t]?.toLowerCase() ?? f.properties.t} · ${f.properties.k}`);
      hover(m, "res-bulk-clusters", (f) => `${fmt(f.properties.point_count)} sites — click to expand`);
      listen(m, "click", "res-bulk-clusters", async (e) => {
        if (busy()) return;
        const f = e.features[0];
        const z = await m.getSource("res-bulk").getClusterExpansionZoom(f.properties.cluster_id);
        m.easeTo({ center: f.geometry.coordinates, zoom: z + 0.4 });
      });
      listen(m, "click", "res-bulk-dot", (e) => {
        if (busy()) return;
        const p = e.features[0].properties;
        showSite({ name: p.n, type: p.t, country: p.k, commodity: p.c, lng: e.features[0].geometry.coordinates[0], lat: e.features[0].geometry.coordinates[1], archive: true });
      });
      if (state.product) setArchiveVisible(false);
    },
    remove(m) {
      dropHandlers(m, CHAIN_HIDES);
      for (const id of ["res-bulk-dot", "res-bulk-count", "res-bulk-clusters"]) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource("res-bulk")) m.removeSource("res-bulk");
      bulkShown = "";
    },
  });

  app.layers.define({
    id: "key-assets",
    title: "Key assets & chokepoints",
    category: "Resources",
    description: `158 curated assets with production, capacity, operator and sources (seed estimates marked unverified) — including 28 maritime chokepoints with average daily AIS transits from IMF PortWatch (to ${chokepointAsOf()}).`,
    keywords: ["key", "curated", "chokepoints", "straits", "canals", "suez", "panama", "hormuz", "malacca"],
    source: "Baryon Resource Intelligence (sources per record; seed records unverified)",
    attribution: "Key assets: Baryon; chokepoints: IMF PortWatch",
    kind: "geojson",
    add(m) {
      m.addSource("res-curated", { type: "geojson", data: curatedFC() });
      const before = app.layers.anchor("data");
      m.addLayer({ id: "res-cur-glow", type: "circle", source: "res-curated", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 8, 8, 16], "circle-color": ["get", "color"], "circle-opacity": 0.22 } }, before);
      m.addLayer({ id: "res-cur-dot", type: "circle", source: "res-curated", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.6, 8, 7], "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 } }, before);
      hover(m, "res-cur-dot", (f) => f.properties.label);
      listen(m, "click", "res-cur-dot", (e) => {
        if (busy()) return;
        const s = D.curated[e.features[0].properties.i];
        showSite(s);
        app.ui.flyFramed({ center: [s.lng, s.lat], ...siteView(s, Math.max(m.getZoom(), 11.5), 55), speed: 1.4 });
      });
    },
    remove(m) {
      dropHandlers(m, ["res-cur-dot"]);
      for (const id of ["res-cur-dot", "res-cur-glow"]) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource("res-curated")) m.removeSource("res-curated");
    },
  });

  app.layers.define({
    id: "trade-routes",
    title: "Trade routes (traced)",
    category: "Resources",
    description: "Sea legs follow the global shipping-lane network (searoute/marnet). Overland legs are approximate paths along the road network (OSRM), not the actual rail or pipeline alignment.",
    keywords: ["trade", "routes", "shipping", "flows", "supply chain", "logistics", "rail", "pipeline"],
    source: "Baryon Resource Intelligence; paths via searoute (marnet) and OSRM",
    attribution: "Routes: searoute (Eurostat, EUPL-1.2) · © OpenStreetMap contributors via OSRM",
    kind: "geojson",
    add(m) {
      m.addSource("res-flows", { type: "geojson", data: flowsFC() });
      const line = (id, filter, dash) => m.addLayer({ id, type: "line", source: "res-flows", filter, layout: { "line-cap": dash ? "butt" : "round", "line-join": "round" }, paint: {
        "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.3, 6, 2.6], "line-opacity": 0.8, ...(dash ? { "line-dasharray": [2, 2] } : {}) } }, app.layers.anchor("data"));
      line("res-flows", ["==", ["get", "mode"], "sea"], false);
      line("res-flows-land", ["!=", ["get", "mode"], "sea"], true);
      hover(m, "res-flows", (f) => f.properties.label);
      hover(m, "res-flows-land", (f) => f.properties.label);
    },
    remove(m) {
      dropHandlers(m, ["res-flows", "res-flows-land"]);
      for (const id of ["res-flows-land", "res-flows"]) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource("res-flows")) m.removeSource("res-flows");
    },
  });
}
/** "9 Aug 2026" from the chokepoint records' "(avg to 2026-08-09, AIS)". */
function chokepointAsOf() {
  const iso = D.curated.map((s) => /avg to (\d{4}-\d{2}-\d{2})/.exec(s.production ?? "")?.[1]).filter(Boolean).sort().pop();
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "the latest snapshot";
}

/* ---------------------------------------------------------------- cards */
/** The model's notes write chain steps as "ore -> concentrate"; shown with a real arrow. */
const arrows = (v) => String(v ?? "").replace(/\s*->\s*/g, " → ");
/** Camera for a site. A strait is framed with both shores in view: close up it is open water,
 *  where the satellite imagery has no tiles past zoom 11. */
function siteView(s, zoom, pitch) {
  return s.type === "chokepoint" ? { zoom: Math.min(9, Math.max(7.5, Math.min(zoom, app.map.getZoom()))), pitch: Math.min(pitch, 30) } : { zoom, pitch };
}
const kvList = (rows) => (rows.length ? `<dl class="kv" style="margin-top:14px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "");
/** Site card. `chain` names the example product chain the visitor came from. */
function showSite(s, { chain } = {}) {
  const seed = isSeed(s);
  const facts = [s.operator && ["Operator", s.operator], s.status && ["Status", s.status]].filter(Boolean);
  // A strait moves ships, not ore: its AIS figures are traffic and its "capacity" the main cargo.
  const strait = s.type === "chokepoint";
  const figures = [
    s.production && [strait ? "Traffic" : "Production", s.production],
    s.capacity && (strait ? ["Main cargo", s.capacity.replace(/^Key cargo:\s*/i, "")] : ["Capacity", s.capacity]),
  ].filter(Boolean);
  const note = s.archive
    ? "Archive tier — a bulk public-dataset row (USGS MRDS, Global Energy Monitor or World Port Index); not individually verified."
    : seed
      ? "Unverified record — location and figures are Baryon estimates not yet checked against a published source."
      : s.source ? `Source: ${esc(s.source)} · confidence ${esc(s.confidence ?? "—")}` : "";
  app.ui.showCard(`
    <div class="eyebrow">${esc(TYPE_LABEL[s.type] ?? s.type)} · ${esc(s.commodity)}</div>
    <h3>${esc(s.name)}</h3>
    <div class="sub">${esc(s.country)} · ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</div>
    ${kvList(seed ? facts : [...facts, ...figures])}
    ${seed && figures.length ? `<span class="eyebrow" style="display:block;margin:14px 0 0">Unverified estimate · confidence low</span>${kvList(figures).replace("margin-top:14px", "margin-top:6px")}` : ""}
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" data-act="fly">Fly in 3D</button>
      <button class="btn btn-ghost btn-sm" data-act="near">Sites nearby</button>
      <button class="btn btn-ghost btn-sm" data-act="here">What's here</button>
    </div>
    ${chain ? `<p class="note">Shown as an example producer of ${esc(s.commodity)} in the “${esc(chain)}” chain, not a confirmed supplier.</p>` : ""}
    ${note ? `<p class="note">${note}</p>` : ""}`, { point: { lat: s.lat, lng: s.lng } });
  const body = $("#card-body");
  body.querySelector('[data-act="fly"]').onclick = () => app.ui.flyFramed({ center: [s.lng, s.lat], ...(s.type === "chokepoint" ? { zoom: 8.5, pitch: 45 } : { zoom: 14, pitch: 62 }), bearing: app.map.getBearing() + 30, speed: 1.2 });
  body.querySelector('[data-act="near"]').onclick = () => app.tools.run("query_resource_sites", { near: { lat: s.lat, lng: s.lng, radius_km: 50 }, show_on_map: true });
  body.querySelector('[data-act="here"]').onclick = () => app.tools.run("get_place_info", { lat: s.lat, lng: s.lng }).catch(() => {});
}

/* ---------------------------------------------------------------- results layer */
function showResults(results) {
  const m = app.map;
  const fc = { type: "FeatureCollection", features: results.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lng, r.lat] }, properties: { label: `${r.name} — ${r.commodity} · ${r.country}` } })) };
  if (m.getSource("res-results")) m.getSource("res-results").setData(fc);
  else {
    m.addSource("res-results", { type: "geojson", data: fc });
    m.addLayer({ id: "res-results", type: "circle", source: "res-results", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#141414", "circle-stroke-width": 2.5 } }, app.layers.anchor("live"));
  }
  if (results.length) fitView(results.map((r) => [r.lng, r.lat]), 10, 1.3);
}

/* ---------------------------------------------------------------- panel */
function yearsClass(y) { return y == null ? "" : y < 25 ? "red" : y < 60 ? "amber" : "green"; }
function shareBars(rows) {
  if (!rows?.length) return `<p class="note">No breakdown in the model yet.</p>`;
  return rows.map((r) => `
    <div style="display:grid;grid-template-columns:118px 1fr;gap:10px;align-items:center;margin:7px 0">
      <span style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.country)}</span>
      <div><div class="bar-track"><i style="width:${Math.max(2, (r.share ?? 0) * 100)}%"></i></div><div class="src">${esc(r.amount)}</div></div>
    </div>`).join("") + `<p class="src">${esc(rows[0].source)} · as of ${esc(rows[0].asOf)}</p>`;
}

function renderPanel(node, arg) {
  if (arg?.commodity) return renderCommodity(node, arg.commodity);
  if (arg?.product) return renderProduct(node, arg.product);
  const s = D.stats ?? {};
  node.innerHTML = `
    <p>Baryon's world model of the physical economy: where resources come from, how they move, and what they become. Figures show their source and date; unverified records are marked.</p>
    <div class="tiles">
      <div class="tile"><div class="v">${fmt(s.sites)}</div><div class="k">Resource sites</div></div>
      <div class="tile"><div class="v">${fmt(s.commodities)}</div><div class="k">Commodities</div></div>
      <div class="tile"><div class="v">${fmt(s.chokepoints)}</div><div class="k">Chokepoints (AIS averages to ${esc(chokepointAsOf())})</div></div>
      <div class="tile"><div class="v">${fmt(D.flows.length)}</div><div class="k">Traced trade routes</div></div>
    </div>
    <span class="eyebrow">Product chains — rock to finished good</span>
    <div id="res-products">${D.products.map((p, i) => {
      const n = new Set(p.materials.map((m) => m.site?.country).filter(Boolean)).size;
      const where = p.basis === "illustrative" ? (n === 1 ? "country (example producer)" : "countries (example producers)") : n === 1 ? "source country" : "source countries";
      return `
      <button class="row-btn" data-product="${i}"><span class="grow"><div class="t">${esc(p.name)}</div>
      <div class="s">${p.materials.length} material${p.materials.length === 1 ? "" : "s"} · ${n} ${where}</div></span><span aria-hidden="true">›</span></button>`;
    }).join("")}</div>
    <span class="eyebrow">Commodities — years of known reserves</span>
    <div id="res-commodities">${D.balances.map((b) => `
      <button class="row-btn" data-commodity="${esc(b.name)}"><span class="grow"><div class="t">${esc(b.name)}</div>
      <div class="bar-track" style="margin-top:6px"><i class="${yearsClass(b.years)}" style="width:${b.years == null ? 0 : Math.min(100, (b.years / 150) * 100)}%"></i></div></span>
      <span class="yrs ${yearsClass(b.years)}">${b.years == null ? "n/a" : `≈${b.years}y`}</span></button>`).join("")}</div>
    <p class="note">"Years left" = known reserves ÷ current annual production — a static snapshot, not a forecast. Baselines ≈ USGS Mineral Commodity Summaries, IEA, worldsteel, WNA (2025).</p>
    <span class="eyebrow">Earth evidence</span>
    <p>Measured soil chemistry, drill cores, subduction-zone structure, a regional bedrock model and copper supply scenarios — with checksummed sources.</p>
    <div class="card-actions"><a class="btn btn-ghost btn-sm" href="/resource-intelligence#soil">Earth evidence</a><a class="btn btn-ghost btn-sm" href="/resource-intelligence#supply">Supply decisions</a><a class="btn btn-ghost btn-sm" href="/resource-intelligence#flows">Copper flows</a></div>`;
  node.querySelectorAll("[data-product]").forEach((b) => (b.onclick = () => app.ui.openPanel("resources", { product: D.products[Number(b.dataset.product)].name })));
  node.querySelectorAll("[data-commodity]").forEach((b) => (b.onclick = () => app.ui.openPanel("resources", { commodity: b.dataset.commodity })));
}

function renderCommodity(node, name) {
  app.ui.hideCard();
  setCommodity(name);
  const b = D.balances.find((x) => x.name === name);
  const sh = D.shares[name] ?? {};
  const inView = D.curated.filter((s) => s.commodity === name);
  node.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-back>‹ All resources</button>
    <h3 class="display-wide" style="font-size:1.6rem;margin:14px 0 4px">${esc(name)}</h3>
    ${b ? `<dl class="kv" style="margin-top:12px">
      <dt>Production</dt><dd>${esc(b.production)}</dd>
      ${b.consumption ? `<dt>Consumption</dt><dd>${esc(b.consumption)}</dd>` : ""}
      ${b.reserves ? `<dt>Reserves</dt><dd>${esc(b.reserves)}</dd>` : ""}
      ${b.years != null ? `<dt>Years left</dt><dd class="${yearsClass(b.years)}">≈${b.years} years at current production</dd>` : ""}
    </dl>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}<p class="src">${esc(b.source)} · as of ${esc(b.asOf)}</p>` : `<p class="note">No balance row yet.</p>`}
    <span class="eyebrow">Consumption by country</span>${shareBars(sh.consumption)}
    <span class="eyebrow">Reserves by country</span>${shareBars(sh.reserves)}
    <span class="eyebrow">Key assets (${inView.length})</span>
    ${inView.slice(0, 30).map((s, i) => `<button class="row-btn" data-site="${i}"><span class="grow"><div class="t">${esc(s.name)}</div><div class="s">${esc(TYPE_LABEL[s.type] ?? s.type)} · ${esc(s.country)}</div></span></button>`).join("") || `<p class="note">No curated assets for this commodity yet.</p>`}
    <p class="note">The map is filtered to ${esc(name)} sites and routes.</p>`;
  node.querySelector("[data-back]").onclick = () => { setCommodity(""); app.ui.openPanel("resources"); };
  node.querySelectorAll("[data-site]").forEach((btn) => (btn.onclick = () => {
    const s = inView[Number(btn.dataset.site)];
    showSite(s);
    app.ui.flyFramed({ center: [s.lng, s.lat], ...siteView(s, 11.5, 55), speed: 1.4 });
  }));
  if (inView.length) fitView(inView.map((s) => [s.lng, s.lat]), 5);
}

function renderProduct(node, name) {
  const p = D.products.find((x) => x.name === name);
  if (!p) return renderPanel(node);
  clearMarkers();
  app.ui.hideCard();
  state.product = name;
  setArchiveVisible(false); // numbered stops must not be mistaken for archive clusters
  const example = p.basis === "illustrative";
  node.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-back>‹ All resources</button>
    <h3 class="display-wide" style="font-size:1.6rem;margin:14px 0 2px">${esc(p.name)}</h3>
    ${p.maker ? `<div class="src">${esc(p.maker)}</div>` : ""}
    ${p.description ? `<p style="margin-top:10px">${esc(arrows(p.description))}</p>` : ""}
    ${p.note ? `<p class="note">${esc(arrows(p.note))}</p>` : ""}
    <span class="eyebrow">Material chain — ${matchMedia("(pointer: coarse)").matches ? "tap" : "click"} a row to fly to ${example ? "an example producer" : "its source"}</span>
    ${p.materials.map((m, i) => `
      <button class="row-btn" data-mat="${i}" style="align-items:flex-start">
        <span class="pm-num">${i + 1}</span>
        <span class="grow"><div class="t">${esc(arrows(m.component))}</div>
        <div class="s">${esc(m.commodity)}${m.site ? ` · ${example ? "e.g. " : ""}${esc(m.site.name)}, ${esc(m.site.country)}` : " · source not yet mapped"}</div>
        <div class="s">${example ? "" : `${esc(arrows(m.source))} · `}Confidence: ${esc(m.confidence)}</div></span>
      </button>`).join("")}
    <p class="note">${example
      ? "Markers show example producers of each material, not confirmed suppliers. Real chains use many suppliers."
      : "Numbered markers show each material's documented source. Real chains use many suppliers."}</p>`;
  node.querySelector("[data-back]").onclick = () => { clearMarkers(); app.ui.openPanel("resources"); };
  const open = (m) => {
    const rec = D.curated.find((c) => c.name === m.site.name && Math.abs(c.lat - m.site.lat) < 0.5)
      ?? { ...m.site, commodity: m.commodity, source: example ? null : m.source, confidence: m.confidence };
    showSite(rec, { chain: example ? p.name : null });
    app.ui.flyFramed({ center: [m.site.lng, m.site.lat], zoom: 11, pitch: 50, speed: 1.5 });
  };
  const stops = [];
  p.materials.forEach((m, i) => {
    if (!m.site) return;
    const el = document.createElement("button");
    el.className = "pm-marker";
    el.type = "button";
    el.textContent = String(i + 1);
    el.title = `${m.component} — ${example ? "example producer: " : ""}${m.site.name}, ${m.site.country}`;
    el.setAttribute("aria-label", `Stop ${i + 1}: ${el.title}`);
    el.onclick = () => open(m);
    state.markers.push(new app.maplibregl.Marker({ element: el }).setLngLat([m.site.lng, m.site.lat]).addTo(app.map));
    stops.push([m.site.lng, m.site.lat]);
  });
  node.querySelectorAll("[data-mat]").forEach((btn) => (btn.onclick = () => {
    const m = p.materials[Number(btn.dataset.mat)];
    if (m.site) open(m);
  }));
  if (stops.length) fitView(stops, 4);
}
// Frame [lng, lat] points in the part of the globe the panels leave visible (above the
// bottom sheet on phones); a world-wide set shows the whole globe, turned to its largest cluster.
function fitView(points, maxZoom, speed = 1.2) {
  app.ui.fitPoints(points, { maxZoom, speed });
}
function clearMarkers() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];
  if (state.product) setArchiveVisible(true);
  state.product = "";
}
function setCommodity(name) { state.commodity = name; refresh(); app.emit("resources:commodity", name); }

/* ---------------------------------------------------------------- agent tools */
function defineTools() {
  app.tools.define("query_resource_sites", {
    description:
      "Search Baryon's database of 102,731 mines, processing plants, factories and ports (plus 158 curated key assets; production figures marked unverified: true are Baryon seed estimates, not published data). Filter by commodity (e.g. copper, lithium, gold, aluminum, coal, oil, uranium), type (mine, processing, port, factory, chokepoint), country, a name fragment, or near a point within radius_km. Returns matching sites with coordinates; set show_on_map to highlight them and frame the camera.",
    input_schema: {
      type: "object",
      properties: {
        commodity: { type: "string" }, type: { type: "string", enum: ["mine", "processing", "port", "factory", "chokepoint"] },
        country: { type: "string" }, name: { type: "string" },
        near: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, radius_km: { type: "number" } }, required: ["lat", "lng"] },
        limit: { type: "number", description: "max results, default 25, max 200" },
        show_on_map: { type: "boolean" },
      },
    },
    async run({ commodity, type, country, name, near, limit = 25, show_on_map = true }) {
      await loadBulk();
      const c = commodity ? commodityName(commodity) : "";
      if (commodity && !c) return { ok: false, error: `No commodity like "${commodity}" in the model. Known: ${D.balances.map((b) => b.name).join(", ")}` };
      const cty = country?.toLowerCase().trim();
      const nm = name?.toLowerCase().trim();
      const max = Math.min(200, limit || 25);
      const out = [];
      let total = 0;
      const keep = (r) => {
        if (c && r.commodity !== c) return false;
        if (type && TYPE_GROUP[r.type] !== type) return false;
        if (cty && !r.country?.toLowerCase().includes(cty)) return false;
        if (nm && !r.name.toLowerCase().includes(nm)) return false;
        if (near && haversineKm([near.lng, near.lat], [r.lng, r.lat]) > (near.radius_km ?? 50)) return false;
        return true;
      };
      for (const s of D.curated) {
        const r = { name: s.name, type: s.type, country: s.country, commodity: s.commodity, lat: s.lat, lng: s.lng, curated: true, production: s.production ?? undefined, ...(isSeed(s) && (s.production || s.capacity) ? { unverified: true, note: "Baryon seed estimate, not yet checked against a published source" } : {}) };
        if (keep(r)) { total++; if (out.length < max) out.push(r); }
      }
      for (const f of D.bulk.features) {
        const p = f.properties;
        const r = { name: p.n, type: p.t, country: p.k, commodity: p.c, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
        if (keep(r)) { total++; if (out.length < max) out.push(r); }
      }
      if (near) out.sort((a, b) => haversineKm([near.lng, near.lat], [a.lng, a.lat]) - haversineKm([near.lng, near.lat], [b.lng, b.lat]));
      if (show_on_map) {
        if (c && c !== state.commodity) setCommodity(c);
        if (!app.layers.isOn("resource-sites")) await app.layers.toggle("resource-sites", true).catch(() => {});
        showResults(out);
      }
      return { ok: true, total_matches: total, returned: out.length, commodity: c || undefined, results: out };
    },
    local: {
      patterns: [
        /^(?:show |find |list |where are (?:the )?)?(?:all )?([a-z /]+?)\s+(mines?|mining|deposits?|smelters?|refiner(?:y|ies)|plants?|ports?|terminals?|factor(?:y|ies))(?:\s+(?:in|near|around)\s+(.+))?$/i,
      ],
      parse: (m) => {
        const w = m[2].toLowerCase();
        const type = Object.entries(TYPE_WORDS).find(([, words]) => words.some((x) => w.startsWith(x.replace(/s$/, ""))))?.[0];
        return { commodity: m[1], type, country: m[3]?.replace(/[?.!]+$/, ""), limit: 200, show_on_map: true };
      },
    },
  });

  app.tools.define("get_commodity", {
    description: "Global balance for a commodity from Baryon's model: annual production, consumption, known reserves, years of reserves at current production, consumption by country and reserves by country — each with source and as-of date. Also filters the globe to that commodity and, unless open_panel is false, opens its panel (pass false to keep the conversation in view).",
    input_schema: { type: "object", properties: { name: { type: "string" }, open_panel: { type: "boolean", description: "Default true." } }, required: ["name"] },
    async run({ name, open_panel = true }) {
      const c = commodityName(name);
      if (!c) return { ok: false, error: `Unknown commodity "${name}". Known: ${D.balances.map((b) => b.name).join(", ")}` };
      if (open_panel) app.ui.openPanel("resources", { commodity: c });
      else setCommodity(c);
      return { ok: true, commodity: c, balance: D.balances.find((b) => b.name === c) ?? null, shares: D.shares[c] ?? null };
    },
    local: {
      patterns: [/^(?:tell me about|what about|info on|facts on|how much|balance(?: of| for)?)\s+(.+?)(?:\s+(?:is left|reserves|production|supply|demand))?\??$/i, /^(copper|lithium|cobalt|nickel|gold|silver|uranium|aluminum|aluminium|zinc|iron ore|coal|oil|gas|graphite|tin|tungsten|rare earths?|potash|phosphate|platinum|manganese|vanadium|titanium|antimony|niobium|molybdenum|chromium|lead|steel|silicon)\??$/i],
      parse: (m) => ({ name: m[1] }),
    },
  });

  app.tools.define("get_product_chain", {
    description: "Show the rock-to-product supply chain for a product in the model (true-wireless earbuds such as AirPods Pro, lithium-ion battery cell, NPK fertilizer, high-nickel NMC cathode): each material, its commodity, a source or example producer site, and a numbered marker on the globe. Chains with basis 'illustrative' name example producers, not confirmed suppliers. Opens the Resources panel unless open_panel is false.",
    input_schema: { type: "object", properties: { name: { type: "string" }, open_panel: { type: "boolean", description: "Default true." } }, required: ["name"] },
    async run({ name, open_panel = true }) {
      const p = D.products.map((x) => ({ x, s: score(x.name, name) })).sort((a, b) => b.s - a.s)[0];
      if (!p || p.s < 20) return { ok: false, error: `No product chain like "${name}". Available: ${D.products.map((x) => x.name).join(", ")}` };
      if (open_panel) app.ui.openPanel("resources", { product: p.x.name });
      else renderProduct(document.createElement("div"), p.x.name);
      const example = p.x.basis === "illustrative";
      return {
        ok: true, product: p.x.name, basis: p.x.basis ?? "documented", ...(p.x.note ? { note: p.x.note } : {}),
        materials: p.x.materials.map((m) => ({ component: m.component, commodity: m.commodity, [example ? "example_producer" : "site"]: m.site?.name, country: m.site?.country, confidence: m.confidence })),
      };
    },
    local: { patterns: [/^(?:what'?s in|materials? (?:in|of)|supply chain (?:of|for)|where does my|where do)\s+(.+?)(?:\s+come from)?\??$/i, /\b(airpods?|battery cell|fertili[sz]er|cathode)\b/i], parse: (m) => ({ name: m[1] }) },
  });

  app.tools.define("list_commodities", {
    description: "List the commodities in Baryon's model with years of known reserves at current production.",
    input_schema: { type: "object", properties: {} },
    async run() { return { commodities: D.balances.map((b) => ({ name: b.name, years_of_reserves: b.years })) }; },
  });
}

/* ---------------------------------------------------------------- init */
export async function init() {
  await loadCore();
  defineLayers();
  defineTools();
  app.ui.definePanel("resources", {
    title: "Resources",
    order: 30,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
    render: renderPanel,
    onClose: () => { clearMarkers(); if (state.commodity) setCommodity(""); },
  });
  app.resources = { D, commodityName, loadBulk, showSite, siteView };
  // Default layers; a shared link can switch any of them off (x=).
  const off = app.hashOff ?? new Set();
  for (const id of ["key-assets", "trade-routes", "resource-sites"]) app.defaultLayers?.add(id);
  for (const id of ["key-assets", "trade-routes"]) if (!off.has(id)) await app.layers.toggle(id, true).catch(() => {});
  if (!off.has("resource-sites")) deferArchive();
}

// The 102k archive streams in once the app is idle so first paint stays fast. Phones
// and data-saver connections wait until the visitor zooms in or opens Resources.
function deferArchive() {
  const id = "resource-sites";
  app.deferredLayers?.add(id);
  let done = false;
  const stopWatching = [];
  const go = () => {
    if (done) return;
    done = true;
    stopWatching.forEach((f) => f());
    app.deferredLayers?.delete(id);
    if (!app.layers.isOn(id)) app.layers.toggle(id, true).catch(() => {});
  };
  // Any explicit switch by the visitor (Layers panel, agent, tour) settles it.
  const offChanged = app.on("layers:changed", (e) => {
    if (e?.id !== id) return;
    done = true;
    stopWatching.forEach((f) => f());
    app.deferredLayers?.delete(id);
  });
  stopWatching.push(offChanged);
  const lite = innerWidth <= 720 || navigator.connection?.saveData;
  app.on("app:ready", () => {
    if (done) return;
    if (!lite) {
      const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
      idle(go, { timeout: 4000 });
      return;
    }
    const onZoom = () => { if (app.map.getZoom() >= 4) go(); };
    app.map.on("zoomend", onZoom);
    stopWatching.push(() => app.map.off("zoomend", onZoom));
    stopWatching.push(app.on("ui:panel", (p) => { if (p === "resources") go(); }));
    onZoom();
  });
}
