// Scan map: vendored MapLibre (loaded only when a map is shown) on OpenFreeMap
// vector tiles. Home base, radius circle and one dot per listing.
let maplibregl = null;
let map = null;
let ready = null;
let lastPick = null;
let popup = null;

const STYLE = "https://tiles.openfreemap.org/styles/positron";

function loadCSS() {
  if (document.querySelector('link[data-maplibre]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "/maplibre/maplibre-gl.css";
  l.dataset.maplibre = "";
  document.head.append(l);
}

function circle(lat, lng, miles, steps = 96) {
  const R = 3958.7613;
  const d = miles / R;
  const la = (lat * Math.PI) / 180, lo = (lng * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lng2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

const fc = (features) => ({ type: "FeatureCollection", features });

export async function renderMap(el, { home, radiusMi, points, onPick }) {
  lastPick = onPick;
  if (!home) {
    el.innerHTML = '<p class="rc-fine rc-map-err">Set a home base to see the map.</p>';
    return;
  }
  if (!map) {
    loadCSS();
    maplibregl ??= await import("/maplibre/maplibre-gl.mjs");
    maplibregl.setWorkerUrl?.("/maplibre/maplibre-gl-worker.mjs");
    el.innerHTML = "";
    map = new maplibregl.Map({
      container: el,
      style: STYLE,
      center: [home.lng, home.lat],
      zoom: 8.6,
      attributionControl: false,
      cooperativeGestures: matchMedia("(pointer: coarse)").matches,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    ready = new Promise((res) => map.once("load", res));
    await ready;
    map.addSource("radius", { type: "geojson", data: fc([]) });
    map.addSource("home", { type: "geojson", data: fc([]) });
    map.addSource("pts", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#141414", "fill-opacity": 0.04 } });
    map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#141414", "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [3, 2] } });
    map.addLayer({
      id: "pts", type: "circle", source: "pts",
      paint: {
        "circle-radius": ["match", ["get", "verdict"], "GRAB", 8, "MAYBE", 7, 6],
        "circle-color": ["match", ["get", "verdict"], "GRAB", "#141414", "MAYBE", "#6f6c67", "SKIP", "#ffffff", "#ffffff"],
        "circle-stroke-color": "#141414",
        "circle-stroke-width": ["match", ["get", "verdict"], "GRAB", 2, 1.5],
      },
    });
    map.addLayer({ id: "home-halo", type: "circle", source: "home", paint: { "circle-radius": 14, "circle-color": "#141414", "circle-opacity": 0.12 } });
    map.addLayer({ id: "home", type: "circle", source: "home", paint: { "circle-radius": 6, "circle-color": "#141414", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
    map.on("click", "pts", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      popup?.remove();
      const box = document.createElement("div");
      box.className = "rc-pop";
      const t = document.createElement("b");
      t.textContent = p.title;
      const meta = document.createElement("span");
      meta.textContent = [p.price, p.net ? `net ${p.net}` : null, p.verdict !== "NEW" ? p.verdict : null].filter(Boolean).join(" · ");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rc-link";
      btn.textContent = "Show listing";
      btn.addEventListener("click", () => { popup?.remove(); lastPick?.(p.id); });
      box.append(t, meta, btn);
      popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 10 }).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(map);
    });
    map.on("mouseenter", "pts", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "pts", () => { map.getCanvas().style.cursor = ""; });
  }
  await ready;
  map.resize();
  map.getSource("radius").setData(fc([circle(home.lat, home.lng, radiusMi)]));
  map.getSource("home").setData(fc([{ type: "Feature", geometry: { type: "Point", coordinates: [home.lng, home.lat] }, properties: {} }]));
  map.getSource("pts").setData(fc(points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: p.id, title: p.title, price: p.price ?? "", verdict: p.verdict, net: p.net ?? "" } }))));
  const key = `${home.lat},${home.lng},${radiusMi}`;
  if (el.dataset.fit !== key) {
    el.dataset.fit = key;
    const dLat = radiusMi / 69;
    const dLng = radiusMi / (69 * Math.cos((home.lat * Math.PI) / 180));
    map.fitBounds([[home.lng - dLng, home.lat - dLat], [home.lng + dLng, home.lat + dLat]], { padding: 24, duration: 0 });
  }
}
