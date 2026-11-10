// Scan: sweep Facebook Marketplace around the home base through Baryon's relay,
// keep only real for-sale listings inside the radius, map them, then triage each
// with Claude and rank by net computed here from the visitor's prices and costs.
import { S, on } from "./state.js";
import { $, $$, esc, money, range, mi, load, save, announce, toast, imageToBase64, ICON, fmtDate } from "./util.js";
import { evaluate, haversineMi, roundTripRoadMiles, oneWayRoadMiles, estimateCost, triageLabel, MIN_TOWN_MI } from "./engine.js";
import { normalizeListing, dedupe, textFlags, isWantedTitle } from "./listing.js";
import { geocodeCitySt, cachedCitySt } from "./geo.js";
import { sweep, relayImageBlob, listingDetail, RelayError, relayMessage } from "./scan-api.js";
import { identify, aiReady, aiMode, TRIAGE_MODEL, modelName, syncChip, usageCost } from "./ai.js";
import { verdictPill, materialSummary, THEFT_NOTICE, REFRIGERANT_NOTICE, PCB_NOTICE, notice } from "./report.js";
import { addDeal, hasDeal } from "./pipeline.js";
import { prefillAppraise } from "./appraise.js";
import { goTab } from "./tabs.js";

export const DEFAULT_QUERIES = ["copper wire", "scrap copper", "copper pipe", "free scrap metal", "wire spool", "air conditioner condenser", "electric motor", "transformer", "welding cable", "radiator"];
const DEFAULT_ON = ["copper wire", "scrap copper", "copper pipe", "free scrap metal", "wire spool"];
const MAX_TRIAGE = 40;
const CONCURRENCY = 3;

const SC = {
  queries: [],
  selected: new Set(),
  listings: [],
  meta: null, // { at, home, location, quota, runs:[{q, n, error, cached}] }
  showHidden: false,
  sort: "net",
  view: "list",
  sweeping: false,
  triaging: false,
  locating: null,
  ctl: null,
  banner: null, // { kind, html }
};

/* ------------------------------------------------------------------ persistence */
function restore() {
  const q = load("queries", null);
  SC.queries = Array.isArray(q?.all) && q.all.length ? q.all.filter((x) => typeof x === "string").slice(0, 30) : [...DEFAULT_QUERIES];
  SC.selected = new Set(Array.isArray(q?.on) ? q.on.filter((x) => SC.queries.includes(x)) : DEFAULT_ON);
  const last = load("lastScan", null);
  if (last && Array.isArray(last.listings)) {
    SC.listings = last.listings.filter((l) => l && l.id && l.flags).map((l) => ({
      ...l,
      geoPending: false,
      // Saved scans pick up the current wanted/service-ad rules.
      flags: { ...l.flags, wanted: l.flags.titleMissing ? false : isWantedTitle(l.title, l.description) },
      triage: l.triage?.ident ? { status: "done", ident: l.triage.ident, at: l.triage.at } : null,
    }));
    SC.meta = last.meta ?? null;
    refreshDistances();
  }
}

const homeKey = (h) => (h ? `${h.lat},${h.lng}` : "");
/**
 * Distances are always measured from the current home base: listings that were
 * located before keep their coordinates, so a new home base only needs arithmetic.
 */
function refreshDistances() {
  const home = S.settings.home;
  SC.home = homeKey(home);
  for (const l of SC.listings) {
    l.distanceMi = home && Number.isFinite(l.lat) && Number.isFinite(l.lng) ? Math.round(haversineMi(home, l) * 10) / 10 : null;
  }
}
const saveQueries = () => save("queries", { all: SC.queries, on: [...SC.selected] });
function saveScan() {
  const slim = SC.listings.slice(0, 300).map((l) => ({ ...l, triage: l.triage?.status === "done" ? { ident: l.triage.ident, at: l.triage.at } : null }));
  if (!save("lastScan", { meta: SC.meta, listings: slim })) save("lastScan", { meta: SC.meta, listings: slim.slice(0, 80) });
}

/* ------------------------------------------------------------------ derived */
function evalFor(l) {
  if (l.triage?.status !== "done") return null;
  return evaluate({
    ident: l.triage.ident,
    prices: S.prices,
    settings: S.settings,
    deal: { asking: l.price, roundTripMi: roundTripRoadMiles(l.distanceMi) ?? 0, disposal: 0 },
  });
}

function hiddenReason(l) {
  if (l.flags.shipped) return "Ships to you (not local)";
  if (l.flags.wanted) return "Wanted or service ad";
  if (l.triage?.status === "done" && ["wanted_ad", "service_ad"].includes(l.triage.ident.listingKind)) return "Wanted or service ad (AI)";
  if (l.flags.locationUnknown || !Number.isFinite(l.distanceMi)) return l.geoPending ? "Locating…" : "Location unknown";
  if (l.distanceMi > S.settings.radiusMi) return `${mi(l.distanceMi)} away, outside your ${S.settings.radiusMi} mi radius`;
  return null;
}

function sorted(list) {
  const key = {
    net: (l) => { const ev = evalFor(l); return ev ? -ev.net.mid : 1e9 + (l.distanceMi ?? 1e6); },
    near: (l) => l.distanceMi ?? 1e9,
    price: (l) => (l.price ?? 1e9),
  }[SC.sort];
  return [...list].sort((a, b) => key(a) - key(b));
}

/* ------------------------------------------------------------------ init + layout */
export function initScan() {
  restore();
  const root = $("#panel-scan");
  if (!S.relay) {
    root.innerHTML = `
      <section class="card rc-pane rc-offline" aria-labelledby="scan-off-title">
        <div class="eyebrow">Marketplace scanner</div>
        <h2 class="rc-h2" id="scan-off-title">The scanner isn't deployed yet.</h2>
        <p class="rc-lede-sm">When Baryon's relay goes live, this tab sweeps Facebook Marketplace around your home base for copper wire, pipe, motors and scrap, drops everything outside your radius, maps the rest and ranks each listing by expected net.</p>
        <p class="rc-lede-sm">Everything else works now: paste any listing into Appraise, check the dated grade price estimates, or run the numbers in the calculator.</p>
        <div class="rc-actions"><a class="btn btn-primary" href="#appraise">Appraise a listing</a><a class="btn btn-ghost" href="#prices">See prices</a><a class="btn btn-ghost" href="#calculator">Calculator</a></div>
      </section>`;
    return;
  }
  root.innerHTML = `
    <section class="card rc-pane rc-scan-controls" aria-labelledby="scan-title">
      <div class="rc-pane-head"><h2 class="rc-h3" id="scan-title">Sweep Marketplace near you</h2><span class="rc-fine" id="scan-quota"></span></div>
      <div class="rc-chips rc-query-chips" id="scan-queries" role="group" aria-label="Search terms (press to include or leave out)"></div>
      <form class="rc-add-query" id="scan-add">
        <label class="sr-only" for="scan-new">Add a search term</label>
        <input class="input" id="scan-new" maxlength="60" placeholder="Add a search term, e.g. 4/0 cable">
        <button class="btn btn-ghost btn-sm" type="submit">${ICON.plus}<span>Add</span></button>
        <button class="btn btn-ghost btn-sm" type="button" id="scan-reset">Reset terms</button>
      </form>
      <div class="rc-scan-go">
        <button class="btn btn-primary" type="button" id="scan-run"><span>Run sweep</span></button>
        <button class="btn btn-ghost" type="button" id="scan-stop" hidden>Stop</button>
        <p class="rc-fine" id="scan-where"></p>
      </div>
      <div class="rc-status" id="scan-status" role="status" aria-live="polite"></div>
    </section>
    <div id="scan-banner"></div>
    <section class="rc-results" id="scan-results" aria-labelledby="results-title" hidden>
      <div class="rc-results-head">
        <div><h2 class="rc-h3" id="results-title" tabindex="-1">Results</h2><p class="rc-fine" id="results-sub"></p></div>
        <div class="rc-results-tools">
          <label class="sr-only" for="scan-sort">Sort results</label>
          <select class="input rc-sort" id="scan-sort"><option value="net">Best net first</option><option value="near">Nearest first</option><option value="price">Lowest price first</option></select>
          <div class="rc-seg rc-view-toggle" role="group" aria-label="Show results as">
            <button type="button" class="rc-seg-btn" data-view="list" aria-pressed="true">List</button>
            <button type="button" class="rc-seg-btn" data-view="map" aria-pressed="false">Map</button>
          </div>
        </div>
      </div>
      <div class="rc-triage-bar card card-surface" id="triage-bar"></div>
      <div class="rc-results-grid">
        <div class="rc-cards" id="scan-cards"></div>
        <div class="rc-map-wrap" id="scan-map-wrap"><div class="rc-map" id="scan-map" role="region" aria-label="Map of listings around your home base"></div><p class="rc-map-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a></p></div>
      </div>
      <div class="rc-hidden-toggle"><button type="button" class="btn btn-ghost btn-sm" id="scan-hidden" aria-expanded="false"></button></div>
      <div class="rc-cards rc-cards-hidden" id="scan-hidden-cards" hidden></div>
      <div class="rc-scan-notes" id="scan-notes"></div>
      <p class="rc-fine rc-scan-fine">Listings come from Facebook Marketplace through Baryon's relay and are shown as the sellers posted them. Distances are straight-line between town centres; trip costs use that × 1.2 for roads (at least ${MIN_TOWN_MI} mi each way), there and back. <span id="scan-ref"></span> Estimates, not offers: verify weight on a scale and call your yard.</p>
    </section>`;
  renderQueries();
  $("#scan-queries").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rmq]");
    if (rm) { const q = rm.dataset.rmq; SC.queries = SC.queries.filter((x) => x !== q); SC.selected.delete(q); saveQueries(); renderQueries(); $("#scan-new").focus(); return; }
    const b = e.target.closest("[data-q]");
    if (!b) return;
    const q = b.dataset.q;
    if (SC.selected.has(q)) SC.selected.delete(q); else SC.selected.add(q);
    saveQueries();
    renderQueries();
    document.querySelector(`[data-q="${CSS.escape(q)}"]`)?.focus();
  });
  $("#scan-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#scan-new");
    const v = input.value.replace(/\s+/g, " ").trim().toLowerCase();
    // Same rule as the relay: 2–80 letters, numbers and simple punctuation.
    const bad = v.length < 2 || v.length > 80 || !/^[\p{L}\p{N}\s#&'’.,/+\-()]+$/u.test(v);
    input.setCustomValidity(bad ? "Use 2–80 letters, numbers or simple punctuation, e.g. 4/0 cable." : "");
    if (bad) { input.reportValidity(); return; }
    if (!SC.queries.includes(v)) SC.queries.push(v);
    SC.selected.add(v);
    $("#scan-new").value = "";
    saveQueries();
    renderQueries();
  });
  $("#scan-new").addEventListener("input", (e) => e.target.setCustomValidity(""));
  $("#scan-reset").addEventListener("click", () => { SC.queries = [...DEFAULT_QUERIES]; SC.selected = new Set(DEFAULT_ON); saveQueries(); renderQueries(); });
  $("#scan-run").addEventListener("click", runSweep);
  $("#scan-stop").addEventListener("click", () => SC.ctl?.abort());
  $("#scan-sort").addEventListener("change", (e) => { SC.sort = e.target.value; renderResults(); });
  $$(".rc-view-toggle [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("#scan-hidden").addEventListener("click", () => { SC.showHidden = !SC.showHidden; renderResults(); });
  const cardsClick = (e) => onCardClick(e);
  $("#scan-cards").addEventListener("click", cardsClick);
  $("#scan-hidden-cards").addEventListener("click", cardsClick);
  $("#triage-bar").addEventListener("click", onTriageBar);
  on("settings", () => {
    if (homeKey(S.settings.home) !== SC.home) {
      refreshDistances();
      if (SC.listings.some((l) => l.place && !Number.isFinite(l.lat) && !l.flags.locationUnknown && !l.flags.shipped && !l.flags.wanted) && !SC.locating) locateAll();
    }
    renderWhere();
    renderResults();
  });
  on("prices", () => renderResults());
  on("ai", () => renderTriageBar());
  // A map created while the tab was hidden needs a pass once it is visible.
  on("tab", (t) => { if (t === "scan" && SC.listings.length && (SC.view === "map" || matchMedia("(min-width: 961px)").matches)) showMap(); });
  renderWhere();
  if (SC.meta?.quota) renderQuota(SC.meta.quota);
  if (SC.listings.length) {
    renderResults();
    // Listings saved before geocoding finished pick up where they left off.
    if (SC.listings.some((l) => l.place && !Number.isFinite(l.distanceMi) && !l.flags.locationUnknown)) locateAll();
  }
}

function renderQueries() {
  $("#scan-queries").innerHTML = SC.queries.map((q) => {
    const onq = SC.selected.has(q);
    const custom = !DEFAULT_QUERIES.includes(q);
    return `<span class="rc-qchip"><button type="button" class="chip chip-btn${onq ? " chip-on" : ""}" data-q="${esc(q)}" aria-pressed="${onq}">${esc(q)}</button>${custom ? `<button type="button" class="rc-qchip-x" data-rmq="${esc(q)}" aria-label="Remove search term ${esc(q)}">${ICON.close}</button>` : ""}</span>`;
  }).join("");
  const n = SC.selected.size;
  const run = $("#scan-run");
  run.disabled = SC.sweeping || SC.triaging || !n;
  run.querySelector("span").textContent = n ? `Run sweep · ${n} term${n === 1 ? "" : "s"}` : "Pick a search term";
}

function renderWhere() {
  const h = S.settings.home;
  const el = $("#scan-where");
  if (!el) return;
  el.innerHTML = h
    ? `Around <b>${esc(h.label)}</b> within ${S.settings.radiusMi} mi. <button type="button" class="rc-link" data-open-settings>Change</button>`
    : `<button type="button" class="rc-link" data-open-settings>Set your home base</button> first: listings are filtered by distance from it.`;
}

function renderQuota(q) {
  const el = $("#scan-quota");
  if (!el || !q) return;
  const bits = [];
  if (Number.isFinite(q.ipLeft)) bits.push(`${q.ipLeft} scan${q.ipLeft === 1 ? "" : "s"} left today on this network`);
  if (Number.isFinite(q.dayLeft)) bits.push(`${q.dayLeft} left for everyone`);
  el.textContent = bits.join(" · ");
}

function setBanner(kind, html) {
  SC.banner = html ? { kind, html } : null;
  const el = $("#scan-banner");
  if (el) el.innerHTML = html ? `<div class="rc-banner rc-banner-${kind}" role="${kind === "error" ? "alert" : "status"}">${ICON.alert}<div>${html}</div></div>` : "";
}

/* ------------------------------------------------------------------ sweep */
async function runSweep() {
  if (SC.sweeping || SC.triaging) return;
  const home = S.settings.home;
  if (!home) { setBanner("info", 'Set your <button type="button" class="rc-link" data-open-settings>home base</button> first: the scanner searches around it and drops anything outside your radius.'); return; }
  if (home.country && home.country !== "US") { setBanner("info", "Marketplace scans cover US listings only. Pick a US home base."); return; }
  if (!home.city || !home.st) { setBanner("info", 'Marketplace searches by town. <button type="button" class="rc-link" data-open-settings>Type your town</button> under Home base (for example “Fairfax, VA”).'); return; }
  const queries = SC.queries.filter((q) => SC.selected.has(q));
  if (!queries.length) return;
  setBanner(null);
  SC.sweeping = true;
  SC.ctl = new AbortController();
  $("#scan-stop").hidden = false;
  renderQueries();
  renderTriageBar();
  const status = $("#scan-status");
  const location = `${home.city}, ${home.st}`;
  const runs = [];
  const found = [];
  let quota = SC.meta?.quota ?? null;
  let stopped = null;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    status.innerHTML = `<span class="rc-spinner" aria-hidden="true"></span><span>Searching “${esc(q)}” (${i + 1} of ${queries.length})…</span>`;
    try {
      const j = await sweep({ q, location, lat: home.lat, lng: home.lng, limit: 40, signal: SC.ctl.signal });
      if (j.quota) { quota = j.quota; renderQuota(quota); }
      const ls = j.listings.map((x) => normalizeListing(x, q)).filter(Boolean);
      found.push(...ls);
      runs.push({ q, n: ls.length, cached: !!j.cached, at: j.fetchedAt ?? null });
    } catch (err) {
      if (err?.name === "AbortError") { stopped = "Stopped."; break; }
      const code = err instanceof RelayError ? err.code : "upstream";
      if (err?.quota) { quota = err.quota; renderQuota(quota); }
      runs.push({ q, n: 0, error: err?.message || relayMessage(code), code });
      if (["quota_ip", "quota_day", "not_configured", "network", "forbidden"].includes(code)) {
        stopped = err.message || relayMessage(code);
        if (queries.length - i - 1 > 0) stopped += ` ${queries.length - i - 1} search${queries.length - i - 1 === 1 ? " was" : "es were"} not run.`;
        break;
      }
    }
  }
  // Keep triage for listings seen before.
  const prev = new Map(SC.listings.map((l) => [l.id, l]));
  const merged = dedupe(found).map((l) => {
    const old = prev.get(l.id);
    return { ...l, distanceMi: old?.distanceMi ?? null, lat: old?.lat ?? null, lng: old?.lng ?? null, triage: old?.triage?.status === "done" ? old.triage : null, description: l.description ?? old?.description ?? null };
  });
  const failed = runs.filter((r) => r.error);
  // A sweep where every search failed keeps the previous results instead of claiming "nothing for sale".
  const ran = runs.some((r) => !r.error);
  if (ran) {
    SC.listings = merged;
    SC.meta = { at: new Date().toISOString(), home: home.label, radius: S.settings.radiusMi, quota, runs };
    refreshDistances();
  } else if (SC.meta && quota) SC.meta.quota = quota;
  SC.sweeping = false;
  SC.ctl = null;
  $("#scan-stop").hidden = true;
  renderQueries();
  status.innerHTML = "";
  if (stopped) setBanner(ran ? "info" : "error", esc(stopped));
  else if (failed.length) setBanner(ran ? "info" : "error", `${ran ? `${failed.length} search${failed.length === 1 ? "" : "es"} failed` : "The sweep failed"}: ${failed.map((r) => `“${esc(r.q)}” (${esc(r.error)})`).join("; ")}`);
  saveScan();
  renderResults();
  renderTriageBar();
  if (!ran) return;
  if (SC.listings.length) {
    announce(`Found ${SC.listings.length} listings. Locating them…`);
    await locateAll();
    const vis = SC.listings.filter((l) => !hiddenReason(l)).length;
    announce(`${vis} listing${vis === 1 ? "" : "s"} within ${S.settings.radiusMi} miles of ${home.label}.`);
    $("#results-title")?.focus({ preventScroll: true });
  } else if (!stopped) {
    announce("No listings found.");
  }
}

/** Geocodes every listing town (cached, one request at a time) and works out distances. */
async function locateAll() {
  const home = S.settings.home;
  if (!home) return;
  // Shipped and wanted ads stay hidden wherever they are, so they are not looked up.
  const todo = SC.listings.filter((l) => l.place && !Number.isFinite(l.distanceMi) && !l.flags.locationUnknown && !l.flags.shipped && !l.flags.wanted);
  const towns = [...new Set(todo.map((l) => l.location))];
  const status = $("#scan-status");
  let done = 0;
  todo.forEach((l) => (l.geoPending = true));
  SC.locating = towns.length ? { done: 0, total: towns.length } : null;
  renderTriageBar();
  for (const town of towns) {
    const cached = cachedCitySt(town);
    if (cached === undefined) status.innerHTML = `<span class="rc-spinner" aria-hidden="true"></span><span>Locating towns: ${done + 1} of ${towns.length}…</span>`;
    let p = null;
    try { p = await geocodeCitySt(town, { bias: home }); } catch { p = undefined; }
    done++;
    SC.locating = { done, total: towns.length };
    for (const l of todo.filter((x) => x.location === town)) {
      l.geoPending = false;
      if (p) { l.lat = p.lat; l.lng = p.lng; l.distanceMi = Math.round(haversineMi(home, p) * 10) / 10; }
      else if (p === null) l.flags.locationUnknown = true;
    }
    if (done % 4 === 0 || done === towns.length) renderResults();
  }
  todo.forEach((l) => (l.geoPending = false));
  SC.locating = null;
  status.innerHTML = "";
  saveScan();
  renderResults();
}

/* ------------------------------------------------------------------ results */
function setView(v) {
  SC.view = v;
  $$(".rc-view-toggle [data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  $("#scan-results").dataset.view = v;
  if (v === "map") showMap();
}

let mapMod = null;
async function showMap() {
  const wrap = $("#scan-map-wrap");
  if (!wrap || wrap.offsetParent === null) return;
  try {
    mapMod ??= await import("./map.js");
    await mapMod.renderMap($("#scan-map"), { home: S.settings.home, radiusMi: S.settings.radiusMi, points: mapPoints(), onPick: focusCard });
  } catch (e) {
    $("#scan-map").innerHTML = `<p class="rc-fine rc-map-err">The map couldn't load (${esc(e?.message || "WebGL unavailable")}). The list has everything.</p>`;
  }
}

function mapPoints() {
  return SC.listings.filter((l) => !hiddenReason(l) && Number.isFinite(l.lat)).map((l) => {
    const ev = evalFor(l);
    return { id: l.id, lat: l.lat, lng: l.lng, title: l.title, price: l.priceText, verdict: ev ? triageLabel(ev.verdict) : "NEW", net: ev ? money(ev.net.mid) : null };
  });
}

function focusCard(id) {
  const card = document.querySelector(`.rc-lcard[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  if (SC.view === "map" && matchMedia("(max-width: 960px)").matches) setView("list");
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.classList.add("is-flash");
  setTimeout(() => card.classList.remove("is-flash"), 1600);
  card.querySelector(".rc-ltitle a, .rc-ltitle")?.focus?.();
}

function cardHTML(l, reason) {
  const ev = evalFor(l);
  const t = l.triage;
  const tf = textFlags(`${l.title} ${l.description ?? ""}`);
  const flags = [];
  if (l.flags.titleMissing) flags.push('<span class="rc-tag" title="The marketplace source lost this title; open the listing to see it">title missing</span>');
  else if (l.flags.repaired) flags.push('<span class="rc-tag" title="The scraper put the title in the wrong field; Reclaim moved it back">title repaired</span>');
  if (reason) flags.push(`<span class="rc-tag rc-tag-hidden">${esc(reason)}</span>`);
  if (ev && t.ident.provenanceRisk === "high") flags.push('<span class="rc-tag rc-tag-warn">provenance: high</span>');
  else if (tf.theft || (ev && t.ident.provenanceRisk === "medium")) flags.push('<span class="rc-tag rc-tag-warn">check provenance</span>');
  if ((ev && t.ident.refrigerant !== "none") || tf.refrigerant) flags.push('<span class="rc-tag">refrigerant</span>');
  let tri = "";
  if (t?.status === "done" && ev) {
    tri = `<div class="rc-tri">
      ${verdictPill(ev.verdict, true)}
      <div class="rc-tri-net"><b>${money(ev.net.mid)}</b><span>net · ${range(ev.net.low, ev.net.high)}</span></div>
      <div class="rc-tri-meta">${esc(materialSummary(ev) || "no scrap materials")} · max offer ${ev.maxOffer > 0 ? money(ev.maxOffer) : "$0"}</div>
      ${t.ident.summary ? `<p class="rc-tri-sum">${esc(t.ident.summary)}</p>` : ""}
    </div>`;
  } else if (t?.status === "running" || t?.status === "queued") {
    tri = `<div class="rc-tri rc-tri-wait"><span class="rc-spinner" aria-hidden="true"></span><span>${t.status === "running" ? "Triaging…" : "Waiting to triage"}</span></div>`;
  } else if (t?.status === "error") {
    tri = `<div class="rc-tri rc-tri-err">${ICON.alert}<span>${esc(t.error)}</span>${t.retry ? `<button type="button" class="rc-link" data-act="retry">Retry</button>` : ""}</div>`;
  }
  const saved = hasDeal(l.url);
  return `<article class="rc-lcard card${reason ? " is-hidden-item" : ""}" data-id="${esc(l.id)}">
    <div class="rc-lthumb">${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async" onerror="this.remove()">` : ""}<span class="rc-lthumb-ph" aria-hidden="true">${ICON.photo}</span></div>
    <div class="rc-lhead">
      <h3 class="rc-ltitle">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>` : esc(l.title)}</h3>
      <p class="rc-lmeta"><b>${l.price === 0 ? "Free" : l.price != null ? money(l.price) : esc(l.priceText || "No price")}</b>${l.location ? ` · ${esc(l.location)}` : ""}${Number.isFinite(l.distanceMi) ? ` · ${l.distanceMi < 1 ? "your town" : mi(l.distanceMi)}` : ""}</p>
      ${flags.length ? `<p class="rc-lflags">${flags.join("")}</p>` : ""}
    </div>
    ${tri}
    <div class="rc-lactions">
      ${l.url ? `<a class="btn btn-ghost btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Open listing ${ICON.ext}</a>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="save"${saved ? " disabled" : ""}>${saved ? "In pipeline" : "Save"}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="appraise">Full appraisal</button>
    </div>
  </article>`;
}

function renderResults() {
  const box = $("#scan-results");
  if (!box) return;
  box.hidden = !SC.listings.length && !SC.meta;
  if (box.hidden) return;
  const visible = [], hidden = [];
  for (const l of SC.listings) { const r = hiddenReason(l); (r ? hidden : visible).push([l, r]); }
  const moved = SC.meta?.home && S.settings.home && SC.meta.home !== S.settings.home.label;
  const sub = SC.meta ? `${SC.listings.length} found${SC.meta.home ? ` around ${esc(SC.meta.home)}` : ""} · ${visible.length} within ${S.settings.radiusMi} mi of ${esc(S.settings.home?.label ?? "your home base")} · swept ${esc(fmtDate(SC.meta.at))}${SC.meta.runs?.some((r) => r.cached) ? " (some from the relay's cache)" : ""}${moved ? `<br><b>Your home base changed since this sweep.</b> Distances are from ${esc(S.settings.home.label)} now; run a new sweep to search around it.` : ""}` : "";
  $("#results-sub").innerHTML = sub;
  const cards = $("#scan-cards");
  const sortedVis = sorted(visible.map(([l]) => l));
  cards.innerHTML = sortedVis.length ? sortedVis.map((l) => cardHTML(l, null)).join("") : `<div class="card card-surface rc-empty"><p><b>Nothing for sale within ${S.settings.radiusMi} mi.</b></p><p class="rc-fine">${hidden.length ? `${hidden.length} listing${hidden.length === 1 ? " was" : "s were"} hidden: shipped, wanted or service ads, unknown places, or too far. Widen your radius or show them below.` : "Try more search terms or a wider radius."}</p></div>`;
  const hb = $("#scan-hidden");
  hb.hidden = !hidden.length;
  hb.textContent = SC.showHidden ? `Hide ${hidden.length} filtered listing${hidden.length === 1 ? "" : "s"}` : `Show ${hidden.length} filtered listing${hidden.length === 1 ? "" : "s"}`;
  hb.setAttribute("aria-expanded", String(SC.showHidden));
  const hc = $("#scan-hidden-cards");
  hc.hidden = !SC.showHidden || !hidden.length;
  hc.innerHTML = SC.showHidden ? hidden.map(([l, r]) => cardHTML(l, r)).join("") : "";
  renderTriageBar();
  const anyRefrigerant = visible.some(([l]) => textFlags(`${l.title} ${l.description ?? ""}`).refrigerant || (l.triage?.status === "done" && l.triage.ident.refrigerant !== "none"));
  const anyPcb = visible.some(([l]) => textFlags(`${l.title} ${l.description ?? ""}`).pcb);
  $("#scan-notes").innerHTML = notice("info", `<b>Copper law.</b> ${THEFT_NOTICE}`) + (anyRefrigerant ? notice("info", `<b>Refrigerant.</b> ${REFRIGERANT_NOTICE}`) : "") + (anyPcb ? notice("info", `<b>PCBs.</b> ${PCB_NOTICE}`) : "");
  $("#scan-ref").textContent = S.reference ? `Nets use your yard quotes or estimates from the copper reference of $${S.reference.usdPerLb.toFixed(2)}/lb (${S.reference.source}, as of ${fmtDate(S.reference.asOf)}).` : "";
  if (SC.view === "map" || matchMedia("(min-width: 961px)").matches) showMap();
}

function updateCard(l) {
  const el = document.querySelector(`.rc-lcard[data-id="${CSS.escape(l.id)}"]`);
  if (!el) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = cardHTML(l, hiddenReason(l));
  el.replaceWith(tmp.firstElementChild);
}

/* ------------------------------------------------------------------ triage */
const triageable = () => SC.listings.filter((l) => !hiddenReason(l) && l.triage?.status !== "done" && l.triage?.status !== "running").slice(0, MAX_TRIAGE);

function renderTriageBar(confirming = false) {
  const bar = $("#triage-bar");
  if (!bar) return;
  const todo = triageable();
  const done = SC.listings.filter((l) => l.triage?.status === "done" && !hiddenReason(l)).length;
  if (SC.triaging) {
    const running = SC.listings.filter((l) => l.triage?.status === "running" || l.triage?.status === "queued").length;
    bar.innerHTML = `<div class="rc-tbar-text"><span class="rc-spinner" aria-hidden="true"></span><span><b>Triaging with ${modelName(TRIAGE_MODEL)}</b> · ${running} to go · ${done} done</span></div><button type="button" class="btn btn-ghost btn-sm" data-tb="stop">Stop triage</button>`;
    return;
  }
  if (SC.sweeping) {
    bar.innerHTML = `<div class="rc-tbar-text"><span class="rc-spinner" aria-hidden="true"></span><span><b>Sweeping Marketplace.</b> Triage opens when the sweep and the town lookups finish.</span></div>`;
    return;
  }
  if (SC.locating) {
    bar.innerHTML = `<div class="rc-tbar-text"><span class="rc-spinner" aria-hidden="true"></span><span><b>Locating listings</b> · ${SC.locating.done} of ${SC.locating.total} towns. Triage opens once every listing has a distance.</span></div>`;
    return;
  }
  if (!aiReady()) {
    bar.innerHTML = `<div class="rc-tbar-text"><span><b>AI triage is off.</b> Turn on AI to have Claude look at each listing's photo and estimate weight, material and net. Without it, open any listing in Full appraisal and enter the pounds yourself.</span></div><button type="button" class="btn btn-primary btn-sm" data-open-ai>Set up AI</button>`;
    return;
  }
  if (!todo.length) {
    bar.innerHTML = `<div class="rc-tbar-text"><span>${done ? `<b>${done} listing${done === 1 ? "" : "s"} triaged.</b> Ranked by expected net from your prices and costs.` : "No visible listings to triage."}</span></div>`;
    return;
  }
  const hosted = aiMode() === "hosted";
  const cost = estimateCost(TRIAGE_MODEL, todo.length);
  if (confirming) {
    bar.innerHTML = `<div class="rc-tbar-text"><span><b>Triage ${todo.length} listing${todo.length === 1 ? "" : "s"} with ${modelName(TRIAGE_MODEL)}?</b> ${hosted ? "This uses Baryon's hosted AI: each listing counts as one of your network's daily hosted requests." : `Approximate cost on your key: ${money(cost.low, { cents: true })} to ${money(cost.high, { cents: true })}.`} Each listing's photo goes through Baryon's relay to Claude, three at a time.</span></div>
      <div class="rc-tbar-actions"><button type="button" class="btn btn-primary btn-sm" data-tb="go">Run triage</button><button type="button" class="btn btn-ghost btn-sm" data-tb="cancel">Cancel</button></div>`;
    bar.querySelector('[data-tb="go"]').focus();
    return;
  }
  bar.innerHTML = `<div class="rc-tbar-text"><span><b>${todo.length} listing${todo.length === 1 ? "" : "s"} ready for AI triage.</b> ${done ? `${done} already triaged. ` : ""}Claude reads the photo and text; your prices and costs set the net.</span></div><button type="button" class="btn btn-primary btn-sm" data-tb="ask">Triage ${todo.length}</button>`;
}

function onTriageBar(e) {
  const b = e.target.closest("[data-tb]");
  if (!b) return;
  const act = b.dataset.tb;
  if (act === "ask") renderTriageBar(true);
  else if (act === "cancel") { renderTriageBar(); $('#triage-bar [data-tb="ask"]')?.focus(); }
  else if (act === "go") runTriage(triageable());
  else if (act === "stop") SC.ctl?.abort();
}

async function triageOne(l, signal) {
  l.triage = { status: "running" };
  updateCard(l);
  const images = [];
  let description = l.description;
  const detail = await listingDetail(l.id, { signal }).catch((e) => { if (e?.name === "AbortError") throw e; return null; });
  if (detail?.description && !description) { description = detail.description; l.description = description; }
  const photoUrls = [...new Set([l.image, ...(detail?.photos ?? []), ...(l.photos ?? [])].filter(Boolean))].slice(0, 2);
  for (const u of photoUrls) {
    try { images.push(await imageToBase64(await relayImageBlob(u, { signal }), 1092, 0.82)); }
    catch (e) { if (e?.name === "AbortError") throw e; }
  }
  const { ident, usage } = await identify({
    listing: { title: l.title, description, price: l.price, location: l.location, url: l.url, distanceMi: l.distanceMi },
    images,
    model: TRIAGE_MODEL,
    triage: true,
    signal,
  });
  l.triage = { status: "done", ident, at: new Date().toISOString() };
  return usage;
}

async function runTriage(list) {
  if (SC.triaging || SC.sweeping || SC.locating || !list.length) return;
  SC.triaging = true;
  renderQueries();
  SC.ctl = new AbortController();
  const signal = SC.ctl.signal;
  setBanner(null);
  list.forEach((l) => { l.triage = { status: "queued" }; });
  renderResults();
  let fatal = null;
  let ok = 0, failed = 0, spent = 0;
  const queue = [...list];
  const worker = async () => {
    while (queue.length && !fatal && !signal.aborted) {
      const l = queue.shift();
      try {
        spent += usageCost(await triageOne(l, signal)) ?? 0;
        ok++;
      } catch (err) {
        if (signal.aborted || err?.code === "aborted" || err?.name === "AbortError") { l.triage = null; }
        else {
          failed++;
          l.triage = { status: "error", error: err?.message || "Triage failed.", retry: err?.retry !== false };
          if (err?.fatal) { fatal = err; SC.ctl.abort(); }
        }
      }
      updateCard(l);
      renderTriageBar();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  list.forEach((l) => { if (l.triage?.status === "queued" || l.triage?.status === "running") l.triage = null; });
  SC.triaging = false;
  SC.ctl = null;
  renderQueries();
  saveScan();
  syncChip();
  renderResults();
  if (fatal) setBanner("error", `${esc(fatal.message)}${fatal.settings ? ' <button type="button" class="rc-link" data-open-ai>AI settings</button>' : ""}`);
  const cost = ok && aiMode() === "key" && spent > 0 ? ` About ${money(spent, { cents: true })} on your key.` : "";
  const msg = `Triage ${fatal ? "stopped" : signal.aborted ? "stopped" : "finished"}: ${ok} done${failed ? `, ${failed} failed` : ""}.${cost}`;
  announce(msg);
  if (!fatal) toast(msg);
}

/* ------------------------------------------------------------------ card actions */
function onCardClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const l = SC.listings.find((x) => x.id === b.closest("[data-id]")?.dataset.id);
  if (!l) return;
  const act = b.dataset.act;
  if (act === "save") {
    const ev = evalFor(l);
    addDeal({ title: l.title, url: l.url, location: l.location, distanceMi: oneWayRoadMiles(l.distanceMi), asking: l.price, image: l.image, source: "scan", ev, ident: l.triage?.ident });
    updateCard(l);
    toast(`Saved “${l.title}” to your pipeline.`);
  } else if (act === "appraise") {
    goTab("appraise");
    prefillAppraise(l, l.triage?.status === "done" ? l.triage.ident : null);
  } else if (act === "retry") {
    runTriage([l]);
  }
}

