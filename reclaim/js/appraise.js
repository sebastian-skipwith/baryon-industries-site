// Appraise: one listing in, a deal report out. Claude (optional) fills in what the
// listing contains; the visitor can edit every line; engine.js does the money.
import { S, on, gradeShort } from "./state.js";
import { $, $$, esc, money, num, lb, range, load, save, debounce, uid, imageToBase64, announce, toast, reducedMotion, ICON, mi } from "./util.js";
import { evaluate, ROAD_FACTOR, haversineMi, oneWayRoadMiles, MIN_TOWN_MI } from "./engine.js";
import { identify, aiReady, aiLabel, currentModel, modelName, usageLine, syncChip } from "./ai.js";
import { reportHTML, VERIFY_NOTICE, noticesFor } from "./report.js";
import { mountWireHelper } from "./wire.js";
import { geocodeCitySt, parseCitySt } from "./geo.js";
import { addDeal } from "./pipeline.js";
import { textFlags } from "./listing.js";
import { relayImageBlob } from "./scan-api.js";

const MAX_PHOTOS = 6;
const blankIdent = () => ({
  source: "manual", listingKind: "for_sale", summary: "", confidence: "", items: [], materials: [],
  resale: null, parts: null, provenanceRisk: "low", provenanceNote: "", refrigerant: "none", refrigerantNote: "",
  hours: { low: 1, est: 1, high: 1 }, vehicle: "pickup", observations: "", questions: [],
});

const A = {
  listing: { title: "", description: "", asking: "", location: "", oneWayMi: "", disposal: "", url: "", image: null },
  distanceNote: "",
  photos: [],
  ident: blankIdent(),
  usage: "",
  searched: [],
  busy: false,
  ctl: null,
};

const persist = debounce(() => save("appraise", { listing: A.listing, ident: A.ident, distanceNote: A.distanceNote }), 400);

function restore() {
  const d = load("appraise", null);
  if (!d) return;
  if (d.listing && typeof d.listing === "object") A.listing = { ...A.listing, ...d.listing };
  if (d.ident && Array.isArray(d.ident.materials)) A.ident = { ...blankIdent(), ...d.ident };
  A.distanceNote = typeof d.distanceNote === "string" ? d.distanceNote : "";
}

export function initAppraise() {
  restore();
  const root = $("#panel-appraise");
  root.innerHTML = `
    <div class="rc-appraise">
      <section class="card rc-pane rc-a-form" aria-labelledby="a-form-title">
        <div class="rc-pane-head"><h2 class="rc-h3" id="a-form-title">The listing</h2><button type="button" class="btn btn-ghost btn-sm" id="a-clear">Clear</button></div>
        <label class="rc-field" for="a-title"><span class="eyebrow">Title</span><input class="input" id="a-title" maxlength="200" placeholder="e.g. Spool of 4/0 copper welding cable"></label>
        <label class="rc-field" for="a-desc"><span class="eyebrow">Description</span><textarea class="input" id="a-desc" rows="4" maxlength="5000" placeholder="Paste the listing text: sizes, lengths, condition, pickup details."></textarea></label>
        <div class="rc-row-2">
          <label class="rc-field" for="a-asking"><span class="eyebrow">Asking price ($)</span><input class="input" id="a-asking" inputmode="decimal" placeholder="0 = free, blank = unknown"></label>
          <label class="rc-field" for="a-disposal"><span class="eyebrow">Disposal & fees ($)</span><input class="input" id="a-disposal" inputmode="decimal" placeholder="0"></label>
        </div>
        <div class="rc-row-2">
          <label class="rc-field" for="a-location"><span class="eyebrow">Listing location</span><input class="input" id="a-location" maxlength="80" placeholder="Town, ST" autocomplete="off"></label>
          <label class="rc-field" for="a-dist"><span class="eyebrow">One-way road miles</span><input class="input" id="a-dist" inputmode="decimal" placeholder="e.g. 18"></label>
        </div>
        <p class="rc-fine" id="a-dist-note" aria-live="polite"></p>
        <label class="rc-field" for="a-url"><span class="eyebrow">Listing URL</span><input class="input" id="a-url" type="url" inputmode="url" maxlength="500" placeholder="https://www.facebook.com/marketplace/item/…"></label>
        <div class="rc-field">
          <span class="eyebrow" id="a-photos-label">Photos (up to ${MAX_PHOTOS}, stay in this browser tab)</span>
          <div class="rc-photos" id="a-photos" aria-labelledby="a-photos-label"></div>
        </div>
        <div class="rc-ai-row">
          <button type="button" class="btn btn-primary" id="a-run">${ICON.sparkle}<span>Appraise with AI</span></button>
          <button type="button" class="btn btn-ghost" id="a-stop" hidden>Stop</button>
          <label class="rc-check"><input type="checkbox" id="a-web"><span>Check resale prices on the web <small>(up to 3 searches)</small></span></label>
        </div>
        <p class="rc-fine" id="a-ai-note"></p>
        <div class="rc-status" id="a-status" role="status" aria-live="polite"></div>
      </section>

      <section class="card rc-pane rc-a-report" aria-labelledby="a-report-title">
        <div class="rc-pane-head"><h2 class="rc-h3" id="a-report-title" tabindex="-1">Deal report</h2>
          <button type="button" class="btn btn-ghost btn-sm" id="a-save" disabled>Save to pipeline</button></div>
        <div id="a-report" aria-live="polite"></div>
      </section>

      <section class="card rc-pane rc-a-mats" aria-labelledby="a-mats-title">
        <div class="rc-pane-head"><h2 class="rc-h3" id="a-mats-title">What's in it</h2><span class="rc-fine" id="a-ident-src"></span></div>
        <div id="a-ident-summary"></div>
        <div class="rc-mat-table" id="a-mats" role="group" aria-label="Materials"></div>
        <div class="rc-mat-actions"><button type="button" class="btn btn-ghost btn-sm" id="a-add">${ICON.plus}<span>Add material</span></button></div>
        <div id="a-wire"></div>
        <details class="rc-more" id="a-more">
          <summary>Time, resale, parts and flags</summary>
          <div class="rc-more-body" id="a-more-body"></div>
        </details>
      </section>
    </div>`;

  // listing fields
  const bind = (id, key) => {
    const el = $(`#${id}`);
    el.value = A.listing[key] ?? "";
    el.addEventListener("input", () => {
      A.listing[key] = el.value; persist();
      if (["asking", "disposal", "oneWayMi"].includes(key)) renderReport();
      else if (key === "title" || key === "description") renderReportSoon(); // safety notices read the text
    });
  };
  bind("a-title", "title");
  bind("a-desc", "description");
  bind("a-asking", "asking");
  bind("a-disposal", "disposal");
  bind("a-location", "location");
  bind("a-dist", "oneWayMi");
  bind("a-url", "url");
  $("#a-dist").addEventListener("input", () => { A.distanceNote = ""; $("#a-dist-note").textContent = ""; });
  $("#a-location").addEventListener("change", locate);
  $("#a-dist-note").textContent = A.distanceNote;
  $("#a-clear").addEventListener("click", clearAll);
  $("#a-run").addEventListener("click", runAI);
  $("#a-stop").addEventListener("click", () => A.ctl?.abort());
  $("#a-add").addEventListener("click", () => {
    A.ident.materials.push({ gradeId: "cu_2", what: "", lbLow: null, lbEst: null, lbHigh: null });
    markEdited();
    renderMaterials();
    renderReport();
    const rows = $$("#a-mats .rc-mrow");
    rows[rows.length - 1]?.querySelector("select")?.focus();
  });
  $("#a-save").addEventListener("click", saveDeal);
  mountWireHelper($("#a-wire"), (m) => {
    A.ident.materials.push(m);
    markEdited();
    persist();
    renderMaterials();
    renderReport();
    toast(`Added ${lb(m.lbEst)} of ${gradeShort(m.gradeId)}.`);
  });
  $("#a-mats").addEventListener("input", onMatInput);
  $("#a-mats").addEventListener("change", onMatInput);
  $("#a-mats").addEventListener("click", onMatClick);
  $("#a-more-body").addEventListener("input", onMoreInput);
  $("#a-more-body").addEventListener("change", onMoreInput);
  initPhotos();
  renderMaterials();
  renderMore();
  renderAINote();
  renderReport();
  on("prices", () => { renderReport(); renderMaterialValues(); });
  on("settings", () => { renderReport(); });
  on("ai", renderAINote);
}

function renderAINote() {
  const ready = aiReady();
  $("#a-run").disabled = A.busy || !ready;
  $("#a-web").disabled = !ready;
  $("#a-ai-note").innerHTML = ready
    ? `${esc(aiLabel())}. Claude identifies the materials and weights; your prices and costs do the math. <button type="button" class="rc-link" data-open-ai>Change</button>`
    : `AI is off. <button type="button" class="rc-link" data-open-ai>Set up AI</button> with your own Anthropic key${S.hosted ? " or Baryon's hosted AI" : ""}, or list the materials yourself below.`;
}

/* ------------------------------------------------------------------ location -> distance */
function distanceNote(place, straight) {
  const home = S.settings.home?.label ?? "your home base";
  const near = straight < MIN_TOWN_MI;
  return `${near ? `${place} is your town or next door: the trip is counted as ${mi(MIN_TOWN_MI * ROAD_FACTOR)} each way.` : `${place} is ${mi(straight)} from ${home} in a straight line, about ${mi(oneWayRoadMiles(straight))} by road.`}${straight > S.settings.radiusMi ? ` That is outside your ${S.settings.radiusMi} mi radius.` : ""}`;
}
async function locate() {
  const note = $("#a-dist-note");
  const loc = A.listing.location.trim();
  if (!loc) return;
  if (!parseCitySt(loc)) { note.textContent = "Use “Town, ST” to work out the distance, or type the miles yourself."; return; }
  if (!S.settings.home) { note.innerHTML = 'Set your <button type="button" class="rc-link" data-open-settings>home base</button> to work out the distance.'; return; }
  note.textContent = "Locating…";
  try {
    const p = await geocodeCitySt(loc, { bias: S.settings.home });
    if (!p) { note.textContent = `Couldn't find ${loc}. Type the miles yourself.`; return; }
    const straight = haversineMi(S.settings.home, p);
    const road = oneWayRoadMiles(straight);
    A.listing.oneWayMi = String(Math.round(road * 10) / 10);
    $("#a-dist").value = A.listing.oneWayMi;
    A.distanceNote = distanceNote(p.label, straight);
    note.textContent = A.distanceNote;
    persist();
    renderReport();
  } catch {
    note.textContent = "Place lookup is unavailable right now. Type the miles yourself.";
  }
}

/* ------------------------------------------------------------------ photos */
function initPhotos() {
  const box = $("#a-photos");
  box.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) {
      A.photos = A.photos.filter((p) => p.id !== rm.dataset.rm);
      renderPhotos();
      $("#a-photo-input")?.focus();
    }
  });
  box.addEventListener("change", (e) => { if (e.target.id === "a-photo-input") addFiles([...e.target.files]); });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("is-drag"); });
  box.addEventListener("dragleave", () => box.classList.remove("is-drag"));
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("is-drag"); addFiles([...(e.dataTransfer?.files ?? [])]); });
  renderPhotos();
}

async function addFiles(files) {
  const imgs = files.filter((f) => /^image\//.test(f.type));
  if (files.length && !imgs.length) { toast("Those files aren't images.", { kind: "error" }); return; }
  const room = MAX_PHOTOS - A.photos.length;
  if (imgs.length > room) toast(`Only ${MAX_PHOTOS} photos fit; ${imgs.length - Math.max(0, room)} skipped.`);
  for (const f of imgs.slice(0, Math.max(0, room))) {
    try {
      const img = await imageToBase64(f, 1568);
      A.photos.push({ id: uid(), name: f.name, ...img });
    } catch (e) { toast(e.message || `Couldn't read ${f.name}.`, { kind: "error" }); }
  }
  renderPhotos();
}

export async function addPhotoBlob(blob, name = "listing photo") {
  if (A.photos.length >= MAX_PHOTOS) return;
  const img = await imageToBase64(blob, 1568);
  A.photos.push({ id: uid(), name, ...img });
  renderPhotos();
}

function renderPhotos() {
  const box = $("#a-photos");
  const full = A.photos.length >= MAX_PHOTOS;
  box.innerHTML = `${A.photos.map((p, i) => `<figure class="rc-thumb"><img src="${p.preview}" alt="Photo ${i + 1}${p.name ? `: ${esc(p.name)}` : ""}"><button type="button" class="rc-thumb-x" data-rm="${p.id}" aria-label="Remove photo ${i + 1}">${ICON.close}</button></figure>`).join("")}
    ${full ? "" : `<label class="rc-drop" for="a-photo-input">${ICON.photo}<span>${A.photos.length ? "Add more" : "Add photos"}</span><small>or drop them here</small><input type="file" id="a-photo-input" accept="image/*" multiple class="sr-only"></label>`}`;
}

/* ------------------------------------------------------------------ materials editor */
function gradeOptions(sel) {
  return S.groups.map((g) => `<optgroup label="${esc(g.label)}">${S.grades.filter((x) => x.group === g.id).map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.short)}</option>`).join("")}</optgroup>`).join("");
}

function renderSource() {
  const src = A.ident.source;
  $("#a-ident-src").textContent = src === "ai" ? `From ${modelName(A.ident.model)}` : src === "edited" ? `From ${modelName(A.ident.model)}, edited by you` : src === "triage" ? "From scan triage" : src === "triage-edited" ? "From scan triage, edited by you" : "Entered by you";
}

function renderMaterials() {
  const box = $("#a-mats");
  renderSource();
  const it = A.ident;
  $("#a-ident-summary").innerHTML = it.summary || it.observations || it.items?.length
    ? `<div class="rc-ident">${it.summary ? `<p><b>${esc(it.summary)}</b>${it.confidence ? ` <span class="rc-tag">${esc(it.confidence)} confidence</span>` : ""}</p>` : ""}
       ${it.items?.length ? `<p class="rc-fine">${it.items.map((x) => `${x.qty > 1 ? `${x.qty} × ` : ""}${esc(x.name)} (${esc(x.condition)})`).join(" · ")}</p>` : ""}
       ${it.observations ? `<p class="rc-fine">${esc(it.observations)}</p>` : ""}
       ${it.questions?.length ? `<p class="rc-fine"><b>Ask the seller:</b> ${it.questions.map(esc).join(" · ")}</p>` : ""}</div>`
    : "";
  if (!it.materials.length) {
    box.innerHTML = `<p class="rc-fine rc-mat-empty">No materials yet. ${aiReady() ? "Run the AI appraisal, or add" : "Add"} each material with its weight in pounds.</p>`;
    return;
  }
  box.innerHTML = `<div class="rc-mhead" aria-hidden="true"><span>Low lb</span><span>Est lb</span><span>High lb</span><span>Value</span></div>` +
    it.materials.map((m, i) => `<div class="rc-mrow" data-i="${i}">
      <label class="sr-only" for="m-g-${i}">Grade, row ${i + 1}</label><select class="input" id="m-g-${i}" data-k="gradeId">${gradeOptions(m.gradeId)}</select>
      <label class="sr-only" for="m-w-${i}">What, row ${i + 1}</label><input class="input" id="m-w-${i}" data-k="what" value="${esc(m.what ?? "")}" placeholder="what it is">
      <label class="sr-only" for="m-l-${i}">Low pounds, row ${i + 1}</label><input class="input num" id="m-l-${i}" data-k="lbLow" inputmode="decimal" value="${m.lbLow ?? ""}" placeholder="low">
      <label class="sr-only" for="m-e-${i}">Estimated pounds, row ${i + 1}</label><input class="input num" id="m-e-${i}" data-k="lbEst" inputmode="decimal" value="${m.lbEst ?? ""}" placeholder="lb">
      <label class="sr-only" for="m-h-${i}">High pounds, row ${i + 1}</label><input class="input num" id="m-h-${i}" data-k="lbHigh" inputmode="decimal" value="${m.lbHigh ?? ""}" placeholder="high">
      <span class="rc-mval" data-val="${i}"></span>
      <button type="button" class="rc-icon-btn" data-del="${i}" aria-label="Remove row ${i + 1}">${ICON.close}</button>
    </div>`).join("");
  renderMaterialValues();
}

function renderMaterialValues() {
  const ev = currentEval();
  ev.materials.forEach((m, i) => {
    const el = document.querySelector(`#a-mats [data-val="${i}"]`);
    if (el) el.textContent = m.missingPrice ? "no price" : range(m.value.low, m.value.high);
  });
}

function onMatInput(e) {
  const row = e.target.closest(".rc-mrow");
  const k = e.target.dataset.k;
  if (!row || !k) return;
  const m = A.ident.materials[Number(row.dataset.i)];
  if (!m) return;
  m[k] = k === "gradeId" || k === "what" ? e.target.value : num(e.target.value);
  markEdited();
  persist();
  renderMaterialValues();
  renderReport();
}
function markEdited() {
  const s = A.ident.source;
  if (s === "ai") A.ident.source = "edited";
  else if (s === "triage") A.ident.source = "triage-edited";
  renderSource();
}

function onMatClick(e) {
  const del = e.target.closest("[data-del]");
  if (!del) return;
  A.ident.materials.splice(Number(del.dataset.del), 1);
  markEdited();
  persist();
  renderMaterials();
  renderReport();
  ($("#a-mats select") ?? $("#a-add")).focus();
}

function renderMore() {
  const it = A.ident;
  const sel = (id, label, val, opts) => `<label class="rc-field" for="${id}"><span class="eyebrow">${label}</span><select class="input" id="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const inp = (id, label, val, ph = "") => `<label class="rc-field" for="${id}"><span class="eyebrow">${label}</span><input class="input" id="${id}" inputmode="decimal" value="${val ?? ""}" placeholder="${ph}"></label>`;
  $("#a-more-body").innerHTML = `
    <div class="rc-row-3">${inp("x-hl", "Hours low", it.hours?.low)}${inp("x-he", "Hours est", it.hours?.est)}${inp("x-hh", "Hours high", it.hours?.high)}</div>
    <div class="rc-row-3">${inp("x-rl", "Resale low ($)", it.resale?.low, "intact, used")}${inp("x-rh", "Resale high ($)", it.resale?.high)}<label class="rc-field" for="x-rb"><span class="eyebrow">Resale basis</span><input class="input" id="x-rb" value="${esc(it.resale?.basis ?? "")}" placeholder="where the range comes from"></label></div>
    <div class="rc-row-3">${inp("x-pl", "Parts low ($)", it.parts?.low)}${inp("x-ph", "Parts high ($)", it.parts?.high)}<label class="rc-field" for="x-pb"><span class="eyebrow">Parts basis</span><input class="input" id="x-pb" value="${esc(it.parts?.basis ?? "")}" placeholder="where the range comes from"></label></div>
    <div class="rc-row-3">
      ${sel("x-prov", "Provenance risk", it.provenanceRisk, [["low", "Low"], ["medium", "Medium"], ["high", "High"]])}
      ${sel("x-ref", "Refrigerant", it.refrigerant, [["none", "None"], ["possible", "Possible"], ["present", "Present"]])}
      ${sel("x-kind", "Listing kind", it.listingKind, [["for_sale", "For sale"], ["free", "Free"], ["wanted_ad", "Wanted ad"], ["service_ad", "Service ad"], ["unclear", "Unclear"]])}
    </div>
    <p class="rc-fine">Resale and parts values count only when both a low and a high are set. The best of scrap, parts or resale is used.</p>`;
}

function onMoreInput(e) {
  const id = e.target.id;
  const it = A.ident;
  const v = num(e.target.value);
  const rng = (key) => (it[key] ??= { available: true, low: null, high: null, basis: "", sources: [] });
  if (id === "x-hl") it.hours.low = v; else if (id === "x-he") it.hours.est = v; else if (id === "x-hh") it.hours.high = v;
  else if (id === "x-rl") rng("resale").low = v; else if (id === "x-rh") rng("resale").high = v; else if (id === "x-rb") rng("resale").basis = e.target.value;
  else if (id === "x-pl") rng("parts").low = v; else if (id === "x-ph") rng("parts").high = v; else if (id === "x-pb") rng("parts").basis = e.target.value;
  else if (id === "x-prov") it.provenanceRisk = e.target.value;
  else if (id === "x-ref") it.refrigerant = e.target.value;
  else if (id === "x-kind") it.listingKind = e.target.value;
  for (const k of ["resale", "parts"]) if (it[k]) it[k].available = it[k].low > 0 && it[k].high > 0;
  markEdited();
  persist();
  renderReport();
}

/* ------------------------------------------------------------------ report */
function dealInputs() {
  const asking = num(A.listing.asking);
  const oneWay = num(A.listing.oneWayMi);
  return { asking: asking === null ? null : asking, roundTripMi: oneWay === null ? 0 : oneWay * 2, disposal: num(A.listing.disposal) ?? 0 };
}
function currentEval() {
  return evaluate({ ident: A.ident, prices: S.prices, settings: S.settings, deal: dealInputs() });
}

function renderReport() {
  const box = $("#a-report");
  if (!box) return;
  const it = A.ident;
  const has = it.materials.some((m) => (m.lbEst || m.lbLow || m.lbHigh) > 0) || (it.resale?.available) || (it.parts?.available) || it.listingKind === "wanted_ad" || it.listingKind === "service_ad";
  $("#a-save").disabled = !has;
  const flags = textFlags(`${A.listing.title ?? ""} ${A.listing.description ?? ""}`);
  if (!has) {
    // Safety notices (PCBs, refrigerant, copper law) come from the listing text, so show them before anything is priced.
    box.innerHTML = `<div class="rc-empty-report"><p><b>Nothing to price yet.</b></p><p class="rc-fine">${aiReady() ? "Run the AI appraisal, or list" : "List"} the materials and pounds under “What's in it”. The report then shows gross by path, every cost, expected net, the most you should offer and a verdict against your targets.</p>${noticesFor({ ident: it, flags })}<p class="rc-fine">${VERIFY_NOTICE}</p></div>`;
    return;
  }
  const ev = currentEval();
  box.innerHTML = reportHTML(ev, it, { usage: A.usage, searched: A.searched, flags });
}
const renderReportSoon = debounce(renderReport, 250);

/* ------------------------------------------------------------------ AI */
function setBusy(b) {
  A.busy = b;
  $("#a-run").disabled = b || !aiReady();
  $("#a-run").querySelector("span").textContent = b ? "Appraising…" : "Appraise with AI";
  $("#a-stop").hidden = !b;
  $(".rc-a-form").setAttribute("aria-busy", String(b));
  $(".rc-a-report").setAttribute("aria-busy", String(b));
}
const STATUS_TEXT = { reading: "Reading the listing and photos…", thinking: "Thinking…", searching: "Checking resale prices on the web…", writing: "Writing up the materials…", continuing: "Still working…" };

async function runAI() {
  if (A.busy) return;
  const l = A.listing;
  if (!l.title.trim() && !l.description.trim() && !A.photos.length) {
    toast("Add a title, description or photo first.", { kind: "error" });
    $("#a-title").focus();
    return;
  }
  const status = $("#a-status");
  status.className = "rc-status";
  status.innerHTML = `<span class="rc-spinner" aria-hidden="true"></span><span>${STATUS_TEXT.reading}</span>`;
  setBusy(true);
  A.ctl = new AbortController();
  const asking = num(l.asking);
  const oneWay = num(l.oneWayMi);
  try {
    const { ident, usage, sources } = await identify({
      listing: { title: l.title.trim(), description: l.description.trim(), price: asking, location: l.location.trim(), url: l.url.trim(), distanceMi: oneWay !== null ? oneWay / ROAD_FACTOR : undefined },
      images: A.photos,
      model: currentModel(),
      webSearch: $("#a-web").checked,
      signal: A.ctl.signal,
      onStatus: (s) => { const t = status.querySelector("span:last-child"); if (t && STATUS_TEXT[s]) t.textContent = STATUS_TEXT[s]; },
    });
    A.ident = ident;
    A.usage = usageLine(usage);
    A.searched = sources;
    status.innerHTML = "";
    persist();
    renderMaterials();
    renderMore();
    renderReport();
    const ev = currentEval();
    announce(`Appraisal ready: ${ev.verdict}, expected net ${money(ev.net.mid)}.`);
    const h = $("#a-report-title");
    h.focus({ preventScroll: true });
    h.closest("section").scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  } catch (err) {
    if (err?.code === "aborted") { status.innerHTML = '<span>Stopped.</span>'; }
    else {
      status.className = "rc-status is-error";
      status.innerHTML = `${ICON.alert}<span>${esc(err?.message || "Something went wrong.")}</span>${err?.settings ? ' <button type="button" class="rc-link" data-open-ai>AI settings</button>' : ""}${err?.retry ? ' <button type="button" class="rc-link" id="a-retry">Try again</button>' : ""}`;
      $("#a-retry")?.addEventListener("click", runAI);
    }
  } finally {
    setBusy(false);
    A.ctl = null;
    syncChip();
  }
}

/* ------------------------------------------------------------------ actions */
function saveDeal() {
  const ev = currentEval();
  const l = A.listing;
  const d = addDeal({
    title: l.title.trim() || A.ident.summary || "Appraised load",
    url: l.url.trim(),
    location: l.location.trim(),
    distanceMi: num(l.oneWayMi),
    asking: num(l.asking),
    image: l.image ?? null,
    source: "appraise",
    ev,
    ident: A.ident,
  });
  toast(`Saved “${d.title}” to your pipeline.`);
  announce("Saved to pipeline.");
}

function clearAll() {
  A.listing = { title: "", description: "", asking: "", location: "", oneWayMi: "", disposal: "", url: "", image: null };
  A.photos = [];
  A.ident = blankIdent();
  A.usage = "";
  A.searched = [];
  A.distanceNote = "";
  for (const [id, k] of [["a-title", "title"], ["a-desc", "description"], ["a-asking", "asking"], ["a-disposal", "disposal"], ["a-location", "location"], ["a-dist", "oneWayMi"], ["a-url", "url"]]) $(`#${id}`).value = A.listing[k];
  $("#a-dist-note").textContent = "";
  $("#a-status").innerHTML = "";
  persist();
  renderPhotos();
  renderMaterials();
  renderMore();
  renderReport();
  $("#a-title").focus();
}

/**
 * Prefills Appraise from a scanned listing (and its triage identification, if any).
 * The photo comes through the relay so it can be read by the AI.
 */
export async function prefillAppraise(listing, ident) {
  clearAll();
  A.listing = {
    title: listing.title ?? "",
    description: listing.description ?? "",
    asking: listing.price == null ? "" : String(listing.price),
    location: listing.location ?? "",
    oneWayMi: Number.isFinite(listing.distanceMi) ? String(Math.round(oneWayRoadMiles(listing.distanceMi) * 10) / 10) : "",
    disposal: "",
    url: listing.url ?? "",
    image: listing.image ?? null,
  };
  A.distanceNote = Number.isFinite(listing.distanceMi) && S.settings.home ? distanceNote(listing.location, listing.distanceMi) : "";
  if (ident) A.ident = { ...blankIdent(), ...JSON.parse(JSON.stringify(ident)), source: "triage" };
  for (const [id, k] of [["a-title", "title"], ["a-desc", "description"], ["a-asking", "asking"], ["a-disposal", "disposal"], ["a-location", "location"], ["a-dist", "oneWayMi"], ["a-url", "url"]]) $(`#${id}`).value = A.listing[k];
  $("#a-dist-note").textContent = A.distanceNote;
  persist();
  renderMaterials();
  renderMore();
  renderReport();
  const urls = [listing.image, ...(listing.photos ?? [])].filter(Boolean);
  const unique = [...new Set(urls)].slice(0, 3);
  if (unique.length) {
    const status = $("#a-status");
    status.innerHTML = `<span class="rc-spinner" aria-hidden="true"></span><span>Fetching the listing photo…</span>`;
    // Hold the AI button until the photos are in, so the appraisal sees them.
    $("#a-run").disabled = true;
    let got = 0;
    for (const u of unique) {
      try { await addPhotoBlob(await relayImageBlob(u), "listing photo"); got++; } catch { /* photo optional */ }
    }
    status.innerHTML = got ? "" : "<span>The listing photo couldn't be fetched; add it yourself if you have it.</span>";
    renderAINote();
  }
}
