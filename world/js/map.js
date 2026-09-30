// Map engine: the Google-Earth core. Globe projection, satellite imagery, 3D terrain,
// labels/roads/boundaries, 3D buildings, atmosphere, day/night, camera controls and
// the live status bar (cursor coordinates, ground elevation, eye altitude).
import { app, $, esc, fmt, haversineKm, syncHash } from "./core.js";
import * as maplibregl from "/maplibre/maplibre-gl.mjs";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
app.maplibregl = maplibregl;

// Verified sources (see /world/SOURCES.md for evidence and licences).
export const SRC = {
  dem: {
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    maxzoom: 15,
    attribution: "Terrain: Mapzen / AWS Terrain Tiles (SRTM, GMTED, ETOPO1, others)",
  },
  vector: {
    url: "https://tiles.openfreemap.org/planet",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    attribution: "© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles",
  },
};

const SLOTS = ["base", "imagery", "overlay", "labels", "data", "live", "top"];
export const DEFAULT_VIEW = { center: [-30, 22], zoom: 1.55, pitch: 0, bearing: 0 };
// Opening globe fills ~70% of the shorter side of the window, like Google Earth.
export function defaultView() {
  const el = document.getElementById("map");
  const side = Math.min(el?.clientWidth || innerWidth, el?.clientHeight || innerHeight);
  const zoom = Math.log2((side * 0.7 * Math.PI) / 512);
  return { ...DEFAULT_VIEW, zoom: Math.max(0.3, Math.min(2.4, zoom)) };
}
const TERRAIN_EXAGGERATION = 1.25;
// OpenStreetMap building parts of open lattice structures (OpenMapTiles feature ids): the
// Eiffel Tower's legs, decks, shaft and top.
const OPEN_FRAMES = [3086891640, 41148393, 3081452390, 3086877440, 41148423, 3086877450, 3080213892, 14625977622];

/* ================================================================ base imagery */
// Every default source is open and licensed for commercial use with attribution.
// Esri World Imagery (sub-metre, global) is used only when the site owner configures
// an ArcGIS Location Platform key in /world/config.js — Esri's terms do not allow
// keyless use of its tiles.
const TRANSPARENT_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const blank = () => ({ data: TRANSPARENT_PNG.buffer.slice(0) });
const US_BOUNDS = [[-125, 24.4, -66.8, 49.4], [-170, 51.2, -129.9, 71.5], [-160.4, 18.8, -154.7, 22.4], [-67.4, 17.8, -65.2, 18.6]];
const EU_BOUNDS = [-25, 34, 45, 72];

// wmimg://usgs/{z}/{y}/{x} — USGS orthoimagery answers outside its coverage with
// solid-white JPEGs; key the white out so the global mosaic shows through.
// wmimg://vt/{z}/{x}/{y} — VersaTiles high-res orthophotos 404 outside coverage;
// answer with a transparent tile instead of an error.
maplibregl.addProtocol("wmimg", async (params, ctrl) => {
  const m = params.url.match(/^wmimg:\/\/(usgs|vt)\/(.+)$/);
  if (!m) return blank();
  const url = m[1] === "usgs"
    ? `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${m[2]}`
    : `https://tiles.versatiles.org/tiles/satellite/${m[2]}`;
  let res;
  try { res = await fetch(url, { signal: ctrl.signal }); } catch (err) { if (err.name === "AbortError") throw err; return blank(); }
  if (!res.ok) return blank();
  const buf = await res.arrayBuffer();
  if (m[1] !== "usgs") return { data: buf };
  const bmp = await createImageBitmap(new Blob([buf]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  const px = img.data;
  let white = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] >= 251 && px[i + 1] >= 251 && px[i + 2] >= 251) { px[i + 3] = 0; white++; }
  }
  if (!white) return { data: buf };
  if (white === px.length / 4) return blank();
  g.putImageData(img, 0, 0);
  return { data: await (await c.convertToBlob({ type: "image/png" })).arrayBuffer() };
});

export const IMAGERY = {
  satellite: {
    title: "Satellite",
    sub: "Sentinel-2 mosaic worldwide, aerial photos across the US and much of Europe",
    attribution: "Imagery: Sentinel-2 Global Mosaic (CC BY 4.0) and European orthophotos via VersaTiles · USDA/USGS The National Map (US)",
    layers() {
      const out = [
        { id: "vt-global", source: { type: "raster", tiles: ["https://tiles.versatiles.org/tiles/satellite/{z}/{x}/{y}"], tileSize: 512, maxzoom: 12 } },
        { id: "vt-hires", minzoom: 12.5, source: { type: "raster", tiles: ["wmimg://vt/{z}/{x}/{y}"], tileSize: 512, minzoom: 13, maxzoom: 19, bounds: EU_BOUNDS } },
        ...US_BOUNDS.map((bounds, i) => ({ id: `usgs-${i}`, minzoom: 11, source: { type: "raster", tiles: ["wmimg://usgs/{z}/{y}/{x}"], tileSize: 256, minzoom: 12, maxzoom: 16, bounds } })),
      ];
      const key = app.config.arcgisKey;
      if (key) out.push({ id: "esri", source: { type: "raster", tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(key)}`], tileSize: 256, maxzoom: 19 } });
      return out;
    },
  },
  s2_2016: {
    title: "Sentinel-2 cloudless",
    sub: "EOX cloud-free mosaic of 2016, 10 m",
    attribution: "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0",
    layers: () => [{ id: "eox", source: { type: "raster", tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"], tileSize: 256, maxzoom: 14 } }],
  },
  bluemarble: {
    title: "Blue Marble",
    sub: "NASA's shaded relief with ocean-floor bathymetry",
    attribution: "NASA Blue Marble, shaded relief & bathymetry · NASA EOSDIS GIBS",
    layers: () => [{ id: "bm", source: { type: "raster", tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"], tileSize: 256, maxzoom: 8 } }],
  },
  night: {
    title: "Earth at night",
    sub: "City lights from NASA Black Marble (VIIRS, 2016)",
    attribution: "NASA Black Marble (VIIRS) · NASA EOSDIS GIBS",
    layers: () => [{ id: "night", source: { type: "raster", tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"], tileSize: 256, maxzoom: 8 } }],
  },
  topo: {
    title: "Topographic",
    sub: "OpenTopoMap contours, relief and trails",
    attribution: "Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC BY-SA)",
    layers: () => [{ id: "otm", source: { type: "raster", tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 17 } }],
  },
};
let imageryId = null;
let imageryLayers = [];

export function setImagery(id) {
  const map = app.map;
  const def = IMAGERY[id] ?? IMAGERY.satellite;
  id = IMAGERY[id] ? id : "satellite";
  for (const l of imageryLayers) {
    if (map.getLayer(l)) map.removeLayer(l);
    if (map.getSource(l)) map.removeSource(l);
  }
  imageryLayers = [];
  for (const l of def.layers()) {
    const lid = `base-${l.id}`;
    tileStats.delete(lid);
    map.addSource(lid, l.source);
    map.addLayer({ id: lid, type: "raster", source: lid, ...(l.minzoom ? { minzoom: l.minzoom } : {}), paint: { "raster-fade-duration": 180 } }, "anchor-base");
    imageryLayers.push(lid);
  }
  imageryId = id;
  app.baseImagery = id;
  app.emit("imagery:changed", id);
  syncHash();
  return id;
}
export const imageryAttribution = () => {
  const def = IMAGERY[imageryId] ?? IMAGERY.satellite;
  return imageryId === "satellite" && app.config.arcgisKey ? `${def.attribution} · Powered by Esri: Esri, Maxar, Earthstar Geographics, and the GIS User Community` : def.attribution;
};

/** A camera from a shared link, or null when MapLibre would reject it. */
function usableView(v) {
  if (!v) return null;
  try {
    maplibregl.LngLat.convert(v.center);
    return [v.zoom, v.pitch ?? 0, v.bearing ?? 0].every(Number.isFinite) ? v : null;
  } catch { return null; }
}

const unpadded = (p) => !p || !(p.top || p.bottom || p.left || p.right);
/** House rules for every camera move, whichever module makes it.
 *
 *  Ground height: MapLibre 6.4 pins the ground height under the camera when a flyTo or
 *  easeTo starts on the terrain globe, and lets go only for moves that pass freezeElevation.
 *  Otherwise the camera keeps the start's height for good (the opening Atlantic view sits on
 *  seabed 6 km down), so a flight to a mountain lands inside the rock: a black or fog-grey
 *  view. When a move ends the ground height follows the terrain again.
 *
 *  Framing: app.ui.flyFramed pads the map (eventData `framed`) to the open part of the screen
 *  beside a card or above a sheet, and keeps that padding in step with them
 *  (app.framedPadding is true while it is ours). Other modules' moves keep it too, since
 *  they may have solved their centre on the padded map. fitBounds frames its bounds inside
 *  its own padding plus the map's, so the map's is taken off its own padding first. */
function cameraRules(map) {
  const cam = map._camera; // private in 6.4: without it, moves fall back to freezeElevation
  const canRelease = typeof cam?._prepareElevation === "function";
  map.on("moveend", () => {
    if (map.isMoving()) return;
    if (canRelease && cam.elevationFreeze === true && map.getTerrain()) {
      cam.elevationFreeze = false;
      map.triggerRepaint();
    }
  });
  // MapLibre puts the centre back on the ground when a gesture ends, a step it has only for the
  // flat projection: on the globe (below zoom 12) it only logs "terrain is not fully supported
  // on vertical perspective projection". The *end events fire just before that step.
  let unclamped = false;
  const skipGroundStep = () => {
    if (unclamped || map.getZoom() >= 12 || !map.getCenterClampedToGround?.()) return;
    unclamped = true;
    map.setCenterClampedToGround(false);
    map.once("moveend", () => { unclamped = false; map.setCenterClampedToGround(true); });
  };
  for (const ev of ["dragend", "zoomend", "rotateend", "pitchend", "rollend"]) map.on(ev, skipGroundStep);
  // With the camera at rest, finer terrain still lifts the ground under it; markers and
  // popups follow only camera events, so they get the "terrain" event they listen for.
  let nudge = 0;
  map.on("sourcedata", (e) => {
    if (!e.tile || nudge || e.sourceId !== map.getTerrain()?.source) return;
    nudge = requestAnimationFrame(() => { nudge = 0; if (!map.isMoving()) map.fire("terrain"); });
  });
  app.framedPadding = false;
  const aware = (opts) => (!canRelease && map.getTerrain() && opts.freezeElevation === undefined ? { ...opts, freezeElevation: true } : opts);
  for (const k of ["flyTo", "easeTo", "jumpTo"]) {
    const move = map[k].bind(map);
    map[k] = (opts = {}, data) => {
      if ("padding" in opts) app.framedPadding = Boolean(data?.framed) && !unpadded(opts.padding);
      return move(aware(opts), data);
    };
  }
  const fit = map.fitBounds.bind(map);
  map.fitBounds = (bounds, opts = {}, data) => {
    const cur = map.getPadding();
    if (!unpadded(cur)) {
      const p = typeof opts.padding === "number" ? { top: opts.padding, bottom: opts.padding, left: opts.padding, right: opts.padding } : { top: 0, bottom: 0, left: 0, right: 0, ...opts.padding };
      opts = { ...opts, padding: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.max(0, v - (cur[k] ?? 0))])) };
    }
    return fit(bounds, aware(opts), data);
  };
}

export async function createMap(appRef) {
  appRef.initialView = usableView(appRef.initialView);
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      projection: { type: "globe" },
      glyphs: SRC.vector.glyphs,
      sources: {},
      layers: [
        { id: "space", type: "background", paint: { "background-color": "#050507" } },
      ],
      sky: {
        "sky-color": "#0b1d3a",
        "horizon-color": "#8ec3ff",
        "fog-color": "#bcd8ff",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.5,
        "fog-ground-blend": 0.35,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
      },
    },
    ...(appRef.initialView ?? defaultView()),
    maxZoom: 19.5,
    maxPitch: 85,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    fadeDuration: 150,
  });
  appRef.map = map;
  window.__world = appRef; // console debugging
  cameraRules(map);
  watchProviders();

  // The window can still be settling its size when the map loads (embedded panes,
  // rotating phones); keep the opening globe fitted until the visitor takes over.
  if (!appRef.initialView) {
    const container = map.getContainer();
    let touched = false;
    const take = () => (touched = true);
    for (const ev of ["pointerdown", "wheel", "touchstart", "keydown"]) container.addEventListener(ev, take, { once: true, passive: true });
    map.on("resize", () => {
      if (!touched && !map.isMoving()) map.jumpTo({ zoom: defaultView().zoom });
    });
  }

  await new Promise((resolve) => map.once("load", resolve));

  // Positional anchors so every module's layers stack correctly.
  for (const slot of SLOTS) {
    map.addLayer({ id: `anchor-${slot}`, type: "background", layout: { visibility: "none" }, paint: { "background-color": "#000" } });
  }
  setImagery(appRef.initialImagery ?? "satellite");
  return map;
}

/* ================================================================ base layers */
function defineBaseLayers() {
  const map = app.map;

  app.layers.define({
    id: "terrain",
    base: true,
    title: "3D terrain",
    category: "Base map",
    description: "Mountains, valleys and seafloor in 3D (tilt the view to see relief).",
    keywords: ["relief", "elevation", "mountains", "3d", "dem"],
    source: "AWS Terrain Tiles (Mapzen)",
    attribution: SRC.dem.attribution,
    kind: "custom",
    add(m) {
      if (!m.getSource("dem")) {
        m.addSource("dem", { type: "raster-dem", tiles: SRC.dem.tiles, encoding: SRC.dem.encoding, tileSize: 256, maxzoom: SRC.dem.maxzoom });
      }
      m.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
    },
    remove(m) {
      m.setTerrain(null);
    },
  });

  app.layers.define({
    id: "hillshade",
    base: true,
    title: "Hillshade",
    category: "Base map",
    description: "Shaded relief drawn over the imagery — sharpens ridges and valleys.",
    keywords: ["relief", "shade", "topography"],
    source: "AWS Terrain Tiles (Mapzen)",
    attribution: SRC.dem.attribution,
    kind: "custom",
    add(m) {
      if (!m.getSource("dem-hs")) {
        m.addSource("dem-hs", { type: "raster-dem", tiles: SRC.dem.tiles, encoding: SRC.dem.encoding, tileSize: 256, maxzoom: SRC.dem.maxzoom });
      }
      m.addLayer({
        id: "hillshade", type: "hillshade", source: "dem-hs",
        paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#000", "hillshade-highlight-color": "#fff", "hillshade-accent-color": "#222" },
      }, app.layers.anchor("overlay"));
    },
    remove(m) { if (m.getLayer("hillshade")) m.removeLayer("hillshade"); },
  });

  app.layers.define({
    id: "labels",
    base: true,
    title: "Labels, roads & borders",
    category: "Base map",
    description: "Place names, roads, railways and boundaries from OpenStreetMap.",
    keywords: ["names", "places", "cities", "roads", "borders", "boundaries", "streets"],
    source: "OpenStreetMap via OpenFreeMap",
    attribution: SRC.vector.attribution,
    kind: "vector",
    slot: "labels",
    add(m) {
      ensureVector(m);
      const before = app.layers.anchor("labels");
      const halo = { "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.3, "text-color": "#fff" };
      m.addLayer({
        id: "lbl-boundary-country", type: "line", source: "omt", "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.2] },
      }, before);
      m.addLayer({
        id: "lbl-boundary-state", type: "line", source: "omt", "source-layer": "boundary", minzoom: 3,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "rgba(255,255,255,0.3)", "line-width": 0.6, "line-dasharray": [2, 2] },
      }, before);
      m.addLayer({
        id: "lbl-roads", type: "line", source: "omt", "source-layer": "transportation", minzoom: 5,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "rail"]]],
        paint: {
          "line-color": ["match", ["get", "class"], "rail", "rgba(255,255,255,0.35)", "motorway", "rgba(255,214,120,0.75)", "trunk", "rgba(255,226,160,0.65)", "rgba(255,255,255,0.45)"],
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 5, 0.4, 10, 1.2, 15, 4],
        },
      }, before);
      m.addLayer({
        id: "lbl-water", type: "symbol", source: "omt", "source-layer": "water_name",
        layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Italic"], "text-size": 12, "text-letter-spacing": 0.1 },
        paint: { "text-color": "rgba(200,225,255,0.85)", "text-halo-color": "rgba(0,0,0,0.5)", "text-halo-width": 1 },
      }, before);
      m.addLayer({
        id: "lbl-road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12,
        layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 11 },
        paint: halo,
      }, before);
      m.addLayer({
        id: "lbl-places", type: "symbol", source: "omt", "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "state", "country", "continent", "suburb"]]],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["match", ["get", "class"], ["country", "continent"], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
          // One zoom interpolation at the top level (MapLibre forbids nesting it inside match).
          "text-size": ["interpolate", ["linear"], ["zoom"],
            2, ["match", ["get", "class"], "continent", 14, "country", 11, "city", 10, 10],
            6, ["match", ["get", "class"], "continent", 14, "country", 15, "city", 12, "state", 11, 11],
            10, ["match", ["get", "class"], "country", 16, "city", 16, "town", 13, "state", 12, 12]],
          "text-transform": ["match", ["get", "class"], ["country", "continent", "state"], "uppercase", "none"],
          "text-letter-spacing": ["match", ["get", "class"], ["country", "continent", "state"], 0.12, 0.02],
          "symbol-sort-key": ["get", "rank"],
          "text-max-width": 8,
        },
        paint: { ...halo, "text-color": ["match", ["get", "class"], "state", "rgba(255,255,255,0.7)", "#fff"] },
      }, before);
    },
    remove(m) {
      for (const id of ["lbl-places", "lbl-road-names", "lbl-water", "lbl-roads", "lbl-boundary-state", "lbl-boundary-country"]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
    },
  });

  app.layers.define({
    id: "buildings",
    base: true,
    title: "3D buildings",
    category: "Base map",
    description: "Building footprints extruded to their mapped heights (zoom into a city and tilt).",
    keywords: ["city", "3d", "buildings", "skyline"],
    source: "OpenStreetMap via OpenFreeMap",
    attribution: SRC.vector.attribution,
    kind: "vector",
    add(m) {
      ensureVector(m);
      const height = ["interpolate", ["linear"], ["zoom"], 14, 0, 15, ["coalesce", ["get", "render_height"], 8]];
      const base = ["coalesce", ["get", "render_min_height"], 0];
      const open = ["in", ["id"], ["literal", OPEN_FRAMES]];
      m.addLayer({
        id: "bld-3d", type: "fill-extrusion", source: "omt", "source-layer": "building", minzoom: 14,
        // Outlines whose parts are mapped separately (the Eiffel Tower) would hide those parts.
        filter: ["all", ["!=", ["get", "hide_3d"], true], ["!", open]],
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#d9d6d0", 60, "#c8c4bc", 200, "#b5b0a6"],
          "fill-extrusion-height": height,
          "fill-extrusion-base": base,
          "fill-extrusion-opacity": 0.88,
        },
      }, app.layers.anchor("labels"));
      // Open lattice frames extrude as solid boxes; drawn as a translucent bronze silhouette they
      // read as the tower they are, with the satellite picture showing through.
      m.addLayer({
        id: "bld-3d-open", type: "fill-extrusion", source: "omt", "source-layer": "building", minzoom: 14,
        filter: open,
        paint: {
          "fill-extrusion-color": "#a08c68",
          "fill-extrusion-height": height,
          "fill-extrusion-base": base,
          "fill-extrusion-opacity": 0.5,
        },
      }, app.layers.anchor("labels"));
    },
    remove(m) { for (const id of ["bld-3d-open", "bld-3d"]) if (m.getLayer(id)) m.removeLayer(id); },
  });

  app.layers.define({
    id: "daynight",
    base: true,
    title: "Day & night",
    category: "Base map",
    description: "Shades the half of the Earth in darkness right now; updates every minute.",
    keywords: ["sun", "terminator", "night", "twilight", "shadow"],
    source: "Computed from the Sun's position (NOAA solar equations)",
    kind: "geojson",
    slot: "overlay",
    _timer: null,
    add(m) {
      m.addSource("daynight", { type: "geojson", data: nightPolygon(new Date()) });
      m.addLayer({ id: "daynight", type: "fill", source: "daynight", paint: { "fill-color": "#000814", "fill-opacity": 0.42 } }, app.layers.anchor("overlay"));
      this._timer = setInterval(() => m.getSource("daynight")?.setData(nightPolygon(new Date())), 60000);
    },
    remove(m) {
      clearInterval(this._timer);
      if (m.getLayer("daynight")) m.removeLayer("daynight");
      if (m.getSource("daynight")) m.removeSource("daynight");
    },
  });

  app.layers.define({
    id: "graticule",
    base: true,
    title: "Latitude & longitude grid",
    category: "Base map",
    description: "Graticule every 10° with the equator and tropics emphasised.",
    keywords: ["grid", "equator", "meridian", "coordinates", "tropics"],
    source: "Computed",
    kind: "geojson",
    slot: "overlay",
    add(m) {
      const features = [];
      for (let lng = -180; lng <= 180; lng += 10) {
        features.push({ type: "Feature", properties: { major: lng === 0 }, geometry: { type: "LineString", coordinates: Array.from({ length: 171 }, (_, i) => [lng, -85 + i]) } });
      }
      for (let lat = -80; lat <= 80; lat += 10) {
        features.push({ type: "Feature", properties: { major: lat === 0 }, geometry: { type: "LineString", coordinates: Array.from({ length: 361 }, (_, i) => [-180 + i, lat]) } });
      }
      for (const lat of [23.4367, -23.4367, 66.5633, -66.5633]) {
        features.push({ type: "Feature", properties: { major: false, tropic: true }, geometry: { type: "LineString", coordinates: Array.from({ length: 361 }, (_, i) => [-180 + i, lat]) } });
      }
      m.addSource("graticule", { type: "geojson", data: { type: "FeatureCollection", features } });
      m.addLayer({
        id: "graticule", type: "line", source: "graticule",
        paint: {
          "line-color": ["case", ["==", ["get", "major"], true], "rgba(255,255,255,0.7)", ["has", "tropic"], "rgba(255,210,140,0.55)", "rgba(255,255,255,0.22)"],
          "line-width": ["case", ["==", ["get", "major"], true], 1.1, 0.6],
          "line-dasharray": ["case", ["has", "tropic"], ["literal", [3, 3]], ["literal", [1, 0]]],
        },
      }, app.layers.anchor("overlay"));
    },
    remove(m) {
      if (m.getLayer("graticule")) m.removeLayer("graticule");
      if (m.getSource("graticule")) m.removeSource("graticule");
    },
  });
}

function ensureVector(m) {
  if (!m.getSource("omt")) m.addSource("omt", { type: "vector", url: SRC.vector.url });
}

/* ================================================================ day/night */
// Subsolar point from NOAA's low-precision solar position, then the terminator.
export function subsolarPoint(date) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let lng = (ra / rad - gmst * 15) % 360;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return { lat: decl / rad, lng };
}

export function nightPolygon(date) {
  const sun = subsolarPoint(date);
  const rad = Math.PI / 180;
  const tanDecl = Math.tan(sun.lat * rad) || 1e-9;
  const pts = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lat = Math.atan(-Math.cos((lng - sun.lng) * rad) / tanDecl) / rad;
    pts.push([lng, Math.max(-85, Math.min(85, lat))]);
  }
  const pole = sun.lat > 0 ? -85 : 85; // night side contains the pole opposite the sun
  const ring = [...pts, [180, pole], [-180, pole], pts[0]];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/* ================================================================ controls */
const ICON = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  compass: '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2l3.2 10H8.8z" fill="#e4572e"/><path d="M12 22l-3.2-10h6.4z" fill="#141414"/></svg>',
  locate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  globe: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
};

function buildControls() {
  const map = app.map;
  const host = $("#controls");
  host.innerHTML = `
    <div class="ctl-group wglass">
      <button type="button" class="compass" id="ctl-compass" title="Reset north (drag with right mouse to rotate)" aria-label="Reset north">${ICON.compass}</button>
    </div>
    <div class="ctl-group wglass">
      <button type="button" id="ctl-3d" title="Tilt to 3D (T)" aria-label="Toggle 3D tilt" aria-pressed="false">3D</button>
      <button type="button" id="ctl-proj" title="Switch between globe and flat map" aria-label="Toggle globe or flat map">${ICON.globe}</button>
      <button type="button" id="ctl-locate" title="Fly to my location" aria-label="My location">${ICON.locate}</button>
    </div>
    <div class="ctl-group wglass">
      <button type="button" id="ctl-in" title="Zoom in (+)" aria-label="Zoom in">${ICON.plus}</button>
      <button type="button" id="ctl-out" title="Zoom out (−)" aria-label="Zoom out">${ICON.minus}</button>
    </div>`;

  $("#ctl-in").onclick = () => map.zoomIn();
  $("#ctl-out").onclick = () => map.zoomOut();
  $("#ctl-compass").onclick = () => map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  $("#ctl-3d").onclick = () => {
    const tilted = map.getPitch() > 5;
    map.easeTo({ pitch: tilted ? 0 : 62, duration: 800 });
  };
  $("#ctl-proj").onclick = () => {
    const globe = map.getProjection()?.type !== "mercator";
    map.setProjection({ type: globe ? "mercator" : "globe" });
    app.ui.toast(globe ? "Flat map" : "Globe");
  };
  $("#ctl-locate").onclick = () => {
    if (!navigator.geolocation) return app.ui.toast("Location is not available in this browser.", { tone: "error" });
    navigator.geolocation.getCurrentPosition(
      (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13, pitch: 55, speed: 1.4 }),
      () => app.ui.toast("Location permission was not granted.", { tone: "error" }),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };
  const compass = $("#ctl-compass svg");
  const tilt = $("#ctl-3d");
  const sync = () => {
    compass.style.transform = `rotate(${-map.getBearing()}deg)`;
    tilt.setAttribute("aria-pressed", String(map.getPitch() > 5));
  };
  map.on("rotate", sync);
  map.on("pitch", sync);
  sync();

  // Keyboard shortcuts (ignored while typing).
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "t" || e.key === "T") tilt.click();
    else if (e.key === "n" || e.key === "N") map.easeTo({ bearing: 0, duration: 500 });
    else if (e.key === "+" || e.key === "=") map.zoomIn();
    else if (e.key === "-" || e.key === "_") map.zoomOut();
    else if (e.key === "/") { e.preventDefault(); $("#q")?.focus(); }
  });
}

/* ================================================================ status bar */
function eyeAltitudeMeters(map) {
  const lat = map.getCenter().lat * (Math.PI / 180);
  const mpp = (40075016.686 * Math.cos(lat)) / (512 * 2 ** map.getZoom());
  const fov = (map.transform?.fov ?? 36.87) * (Math.PI / 180);
  return (mpp * map.getCanvas().clientHeight) / (2 * Math.tan(fov / 2));
}
const distLabel = (m) => (m >= 10000 ? `${fmt(m / 1000)} km` : m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`);
function dms(v, pos, neg) {
  const a = Math.abs(v);
  return `${a.toFixed(4)}°${v >= 0 ? pos : neg}`;
}

function buildStatus() {
  const map = app.map;
  const box = $("#status-coords");
  let cursor = null;
  const render = () => {
    const alt = eyeAltitudeMeters(map);
    let where = "";
    if (cursor) {
      let elev = null;
      if (map.getTerrain()) {
        const e = map.queryTerrainElevation(cursor);
        if (e != null) elev = e / TERRAIN_EXAGGERATION;
      }
      where = `<span>${dms(cursor.lat, "N", "S")} ${dms(cursor.lng, "E", "W")}</span>` +
        (elev != null ? `<span>Elev <b>${fmt(elev)} m</b></span>` : "");
    }
    box.innerHTML = `${where}<span>Eye <b>${distLabel(alt)}</b></span>`;
  };
  map.on("mousemove", (e) => { cursor = e.lngLat; render(); });
  map.on("mouseout", () => { cursor = null; render(); });
  map.on("move", render);
  render();

  // Credits: a one-line summary in the pill (a compact (i) on phones) that opens the full list.
  const pill = $("#status-attr");
  pill.setAttribute("role", "button");
  pill.tabIndex = 0;
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-controls", "attr-full");
  pill.setAttribute("aria-label", "Map data credits");
  pill.innerHTML = `<svg class="attr-i" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><span class="attr-text"></span>`;
  const full = document.createElement("div");
  full.id = "attr-full";
  full.className = "attr-full wglass";
  full.hidden = true;
  pill.after(full);
  const setOpen = (open) => {
    full.hidden = !open;
    pill.setAttribute("aria-expanded", String(open));
  };
  pill.addEventListener("click", () => setOpen(full.hidden));
  pill.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(full.hidden); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !full.hidden) { e.preventDefault(); setOpen(false); pill.focus(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!full.hidden && !full.contains(e.target) && !pill.contains(e.target)) setOpen(false);
  });

  const renderAttr = () => {
    // Order: the vector map, then data layers, then imagery and terrain.
    const on = app.layers.active();
    const vector = on.some((id) => app.layers.get(id)?.attribution === SRC.vector.attribution) ? [SRC.vector.attribution] : [];
    const layerParts = on.map((id) => app.layers.get(id)?.attribution).filter((a) => a && a !== SRC.vector.attribution && a !== SRC.dem.attribution);
    const terrain = on.some((id) => app.layers.get(id)?.attribution === SRC.dem.attribution) ? [SRC.dem.attribution] : [];
    // Each credit is a " · " list of names; a name already given by an earlier credit
    // ("NASA EOSDIS GIBS" after "Fires: NASA FIRMS via NASA EOSDIS GIBS") is not repeated.
    const parts = [], seen = [];
    for (const a of [...vector, ...layerParts, imageryAttribution(), ...terrain]) {
      const names = a.split(" · ").filter((n) => {
        const low = n.trim().toLowerCase();
        if (!low || seen.some((s) => s.includes(low))) return false;
        seen.push(low);
        return true;
      });
      if (names.length) parts.push(names.join(" · "));
    }
    pill.querySelector(".attr-text").textContent = parts.join(" · ");
    pill.title = parts.join("\n");
    full.innerHTML = `<span class="eyebrow">Map data credits</span><ul>${parts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <a class="link-ul" href="/world/sources.html" target="_blank" rel="noopener">All sources and licences</a>`;
  };
  app.on("layers:changed", renderAttr);
  app.on("imagery:changed", renderAttr);
  renderAttr();
}

/* ================================================================ failing providers */
// When a tile provider stops answering, say so and fall back instead of leaving a black
// globe. Tile errors are counted per source; only the first one is logged.
const FALLBACK = { satellite: "bluemarble", bluemarble: "satellite", night: "satellite", s2_2016: "bluemarble", topo: "satellite" };
const HOST_NAME = { satellite: "VersaTiles", bluemarble: "NASA GIBS", night: "NASA GIBS", s2_2016: "EOX", topo: "OpenTopoMap" };
const tileStats = new Map();
const statFor = (id) => {
  if (!tileStats.has(id)) tileStats.set(id, { fail: 0, okAt: 0, firstFail: 0, logged: false, told: false });
  return tileStats.get(id);
};
const failedImagery = new Set();

function watchProviders() {
  const map = app.map;
  map.on("sourcedata", (e) => {
    if (!e.tile || !e.sourceId) return;
    const s = statFor(e.sourceId);
    s.okAt = performance.now();
    s.fail = 0;
  });
  map.on("error", (e) => {
    const id = e.sourceId;
    if (!id) { console.error("[world] map error", e.error ?? e); return; }
    const s = statFor(id);
    if (!s.logged) { s.logged = true; console.warn(`[world] ${id}: ${e.error?.message ?? "tile failed"} (later failures from this source are not logged)`); }
    const now = performance.now();
    if (!s.fail) {
      s.firstFail = now;
      // A streak of failures with no tile drawn since it began: the host is down.
      if (id === imageryLayers[0]) setTimeout(() => { if (id === imageryLayers[0] && s.fail >= 3 && s.okAt < s.firstFail) fallBack(imageryId); }, 8000);
    }
    s.fail++;
    const silent = !s.okAt || now - s.okAt > 20000;
    if (id === imageryLayers[0] && s.fail >= 12 && silent) fallBack(imageryId);
    // The vector source failing its TileJSON (no tile) or every tile: labels, roads and buildings are gone.
    if (id === "omt" && !s.told && (!e.tile || (s.fail >= 6 && silent))) {
      s.told = true;
      app.ui.toast("Map labels are unavailable right now (OpenFreeMap is not answering)", { tone: "error", ms: 6000 });
    }
  });
}
function fallBack(from) {
  failedImagery.add(from);
  const to = FALLBACK[from];
  if (!to || failedImagery.has(to)) {
    if (!statFor(`told:${from}`).told) {
      statFor(`told:${from}`).told = true;
      app.ui.toast(`Satellite imagery (${HOST_NAME[from]}) is not answering right now.`, { tone: "error", ms: 6000 });
    }
    return;
  }
  setImagery(to);
  app.ui.toast(`Satellite imagery (${HOST_NAME[from]}) is not answering — switched to ${to === "bluemarble" ? "NASA Blue Marble" : `${IMAGERY[to].title} (${HOST_NAME[to]})`}`, { tone: "error", ms: 6000 });
}
/** Resolves once the new base imagery draws a tile, or rejects when its host fails. */
function imageryAnswers(sourceId, ms = 8000) {
  const map = app.map;
  return new Promise((resolve, reject) => {
    let fails = 0;
    const done = (fn, v) => { clearTimeout(t); map.off("sourcedata", ok); map.off("error", bad); fn(v); };
    const ok = (e) => { if (e.tile && e.sourceId === sourceId) done(resolve, true); };
    const bad = (e) => { if (e.sourceId === sourceId && ++fails >= 3) done(reject, new Error(e.error?.message ?? "tiles failed to load")); };
    const t = setTimeout(() => (fails ? done(reject, new Error("no tiles loaded")) : done(resolve, null)), ms);
    map.on("sourcedata", ok);
    map.on("error", bad);
  });
}

/* ================================================================ agent tools */
function defineTools() {
  const map = app.map;

  app.tools.define("fly_to", {
    description:
      "Move the camera to a location. Give either lat+lng, or a place name to look up (a city, mountain, mine, port, country, address). Optional zoom (0 = whole Earth, 5 = country, 10 = city, 14 = neighbourhood, 17 = building), pitch 0-80 for a tilted 3D view, bearing in degrees.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place to look up if lat/lng are not given." },
        lat: { type: "number" }, lng: { type: "number" },
        zoom: { type: "number" }, pitch: { type: "number" }, bearing: { type: "number" },
      },
    },
    async run({ place, lat, lng, zoom, pitch, bearing }) {
      let label = null, detail = null, bbox = null, hitZoom = null;
      if ((lat == null || lng == null) && place) {
        const hits = await app.tools.run("search_places", { query: place, limit: 6 });
        const list = hits?.results ?? [];
        // Prefer an exact name that is a town or larger (zoom <= 11) over a street or
        // shop that happens to share the name near the current view, and a city over a
        // town or village of that name ("Lima" is Peru's capital, not Lima, Illinois).
        // Photon's own order settles the rest.
        const q = place.trim().toLowerCase();
        const big = (h) => (h.zoom ?? 12) <= 11;
        const LESSER = { town: 1, suburb: 2, village: 2, quarter: 3, neighbourhood: 3, hamlet: 3, locality: 4, isolated_dwelling: 4 };
        const rank = (h) => (big(h) ? 0 : 10) + (h.place_class ? LESSER[h.place_class] ?? 0 : big(h) ? 0 : 5);
        const exact = list.map((h, i) => ({ h, i, r: rank(h) })).filter(({ h }) => h.name?.toLowerCase() === q).sort((a, b) => a.r - b.r || a.i - b.i).map(({ h }) => h);
        const hit = exact[0] ?? list.find((h) => big(h) && h.name?.toLowerCase().startsWith(q)) ?? list[0];
        if (!hit) return { ok: false, error: `Could not find "${place}".` };
        ({ lat, lng } = hit);
        label = hit.name;
        detail = hit.detail ?? null;
        bbox = hit.bbox ?? null;
        hitZoom = hit.zoom ?? null;
      }
      if (lat == null || lng == null) return { ok: false, error: "Need lat/lng or a place." };
      // A card about somewhere else would sit over the new view.
      const card = $("#card");
      if (!card.hidden && card.dataset.lat && haversineKm([lng, lat], [Number(card.dataset.lng), Number(card.dataset.lat)]) > 50) app.ui.hideCard();
      const frame = bbox && zoom == null;
      zoom ??= hitZoom ?? 11;
      const opts = { center: [lng, lat], zoom, pitch: pitch ?? (zoom >= 12 ? 55 : 0), bearing: bearing ?? map.getBearing(), speed: 1.2, curve: 1.5, essential: true };
      // Framed as search frames it: the place lands in the open part of the map, clear of
      // the dock, the card and the time bar's sheet (the framing follows a card that opens later).
      if (frame) {
        try { app.ui.fitPoints([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { maxZoom: 15, speed: 1.2, pitch: opts.pitch }); }
        catch { app.ui.flyFramed(opts); }
      } else app.ui.flyFramed(opts);
      return { ok: true, flewTo: label ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`, detail, lat, lng, zoom: +zoom.toFixed(2) };
    },
    local: {
      patterns: [/^(?:fly|go|take me|zoom|navigate|jump|head)\s+(?:to|into|over)\s+(.+)$/i, /^(?:show me|where is|where's|find)\s+(.+)$/i],
      parse: (m) => ({ place: m[1].replace(/[?.!]+$/, "") }),
    },
  });

  app.tools.define("get_view", {
    description: "Report the current camera (center, zoom, pitch, bearing, approximate eye altitude), the visible bounds, the layers switched on, and the visual mode.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const c = map.getCenter(), b = map.getBounds();
      return {
        center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) },
        zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()),
        eye_altitude_m: Math.round(eyeAltitudeMeters(map)),
        bounds: { west: +b.getWest().toFixed(3), south: +b.getSouth().toFixed(3), east: +b.getEast().toFixed(3), north: +b.getNorth().toFixed(3) },
        layers_on: app.layers.active().map((id) => ({ id, title: app.layers.get(id)?.title, date: app.layers.timeOf(id) })),
        visual_mode: app.visualMode ?? "standard",
      };
    },
  });

  app.tools.define("set_base_imagery", {
    description: `Switch the base picture of the Earth. Options: ${Object.entries(IMAGERY).map(([id, d]) => `"${id}" (${d.title}: ${d.sub})`).join("; ")}.`,
    input_schema: { type: "object", properties: { imagery: { type: "string", enum: Object.keys(IMAGERY) } }, required: ["imagery"] },
    async run({ imagery }) {
      if (!IMAGERY[imagery]) return { ok: false, error: `Unknown imagery "${imagery}". Options: ${Object.keys(IMAGERY).join(", ")}` };
      const before = imageryId;
      failedImagery.delete(imagery);
      setImagery(imagery);
      try {
        await imageryAnswers(imageryLayers[0]);
      } catch (err) {
        if (imageryId === imagery && before && before !== imagery) setImagery(before);
        return { ok: false, error: `${IMAGERY[imagery].title} imagery (${HOST_NAME[imagery]}) is not answering (${err.message}); kept ${IMAGERY[imageryId].title}.` };
      }
      return { ok: true, imagery, title: IMAGERY[imagery].title, attribution: imageryAttribution() };
    },
    local: {
      patterns: [/^(?:show |switch to |use )?(?:the )?(satellite|blue marble|night lights|earth at night|city lights|topo(?:graphic)?(?: map)?|sentinel(?:-2)?(?: cloudless)?)(?: view| imagery| map| mode)?$/i],
      parse: (m) => {
        const t = m[1].toLowerCase();
        return { imagery: t.startsWith("blue") ? "bluemarble" : /night|city/.test(t) ? "night" : t.startsWith("topo") ? "topo" : t.startsWith("sentinel") ? "s2_2016" : "satellite" };
      },
    },
  });

  app.tools.define("set_camera", {
    description: "Adjust the camera without moving the center: tilt (pitch 0-80), rotate (bearing), zoom, or reset to the whole Earth.",
    input_schema: {
      type: "object",
      properties: { pitch: { type: "number" }, bearing: { type: "number" }, zoom: { type: "number" }, reset: { type: "boolean" } },
    },
    async run({ pitch, bearing, zoom, reset }) {
      if (reset) map.flyTo({ ...defaultView(), speed: 1.4 });
      else map.easeTo({ pitch: pitch ?? map.getPitch(), bearing: bearing ?? map.getBearing(), zoom: zoom ?? map.getZoom(), duration: 900 });
      return { ok: true };
    },
    local: {
      patterns: [/^(?:reset|home|whole (?:earth|world|globe)|zoom out all the way)$/i, /^tilt(?: the view)?$/i, /^(?:flat|top[- ]down|north up)$/i, /^zoom (in|out)$/i],
      parse: (m, text) => {
        const z = text.match(/^zoom (in|out)$/i);
        if (z) return { zoom: map.getZoom() + (z[1].toLowerCase() === "in" ? 2 : -2) };
        return /tilt/i.test(text) ? { pitch: 62 } : /flat|top|north/i.test(text) ? { pitch: 0, bearing: 0 } : { reset: true };
      },
    },
  });
}

/* ================================================================ init */
export async function init() {
  defineBaseLayers();
  buildControls();
  buildStatus();
  defineTools();
  // Google-Earth defaults: terrain + labels + 3D buildings on.
  for (const id of ["terrain", "labels", "buildings"]) {
    await app.layers.toggle(id, true).catch((err) => console.warn(`[world] ${id} unavailable`, err));
  }
  app.map.on("moveend", syncHash);
}
