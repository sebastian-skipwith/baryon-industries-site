// Pipeline: saved deals with statuses, notes, actual weights and the sale, so
// realised profit can be checked against the estimate. Stored in this browser;
// export and import keep a copy elsewhere.
import { S, on, gradeShort } from "./state.js";
import { $, $$, esc, money, lb, load, save, uid, num, download, announce, toast, fmtDate } from "./util.js";
import { realised } from "./engine.js";
import { verdictPill } from "./report.js";

export const STATUSES = [
  ["watching", "Watching"],
  ["contacted", "Contacted"],
  ["offer", "Offer made"],
  ["picked_up", "Picked up"],
  ["sold", "Sold"],
  ["passed", "Passed"],
];
const OPEN = new Set(["watching", "contacted", "offer", "picked_up"]);
const statusLabel = (s) => STATUSES.find(([k]) => k === s)?.[1] ?? s;

let deals = [];
let filter = "open";
let expanded = new Set();

const persist = () => {
  if (!save("pipeline", { version: 1, deals })) toast("This browser blocked storage: the pipeline will not survive a reload.", { kind: "error" });
  updateBadge();
};

function clean(d) {
  if (!d || typeof d !== "object" || typeof d.title !== "string") return null;
  const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const est = d.estimate ?? {};
  const act = d.actual ?? {};
  return {
    id: typeof d.id === "string" && d.id ? d.id.slice(0, 80) : uid(),
    createdAt: d.createdAt ?? new Date().toISOString(),
    updatedAt: d.updatedAt ?? d.createdAt ?? new Date().toISOString(),
    status: STATUSES.some(([k]) => k === d.status) ? d.status : "watching",
    source: ["scan", "appraise", "calculator", "import"].includes(d.source) ? d.source : "import",
    title: d.title.slice(0, 200) || "Untitled deal",
    url: typeof d.url === "string" && /^https:\/\//.test(d.url) ? d.url.slice(0, 500) : "",
    location: typeof d.location === "string" ? d.location.slice(0, 120) : "",
    distanceMi: n(d.distanceMi),
    asking: n(d.asking),
    image: typeof d.image === "string" && /^https:\/\//.test(d.image) ? d.image.slice(0, 800) : null,
    estimate: {
      verdict: ["BUY", "MAYBE", "PASS"].includes(est.verdict) ? est.verdict : null,
      netLow: n(est.netLow), netMid: n(est.netMid), netHigh: n(est.netHigh),
      grossMid: n(est.grossMid), maxOffer: n(est.maxOffer), weightEst: n(est.weightEst),
      best: typeof est.best === "string" ? est.best : "scrap",
      summary: typeof est.summary === "string" ? est.summary.slice(0, 300) : "",
      materials: Array.isArray(est.materials) ? est.materials.filter((m) => m && typeof m.gradeId === "string").slice(0, 30).map((m) => ({ gradeId: m.gradeId, lbEst: n(m.lbEst) ?? 0 })) : [],
      refUsdPerLb: n(est.refUsdPerLb),
      at: est.at ?? null,
    },
    flags: { provenance: d.flags?.provenance ?? null, refrigerant: d.flags?.refrigerant ?? null },
    notes: typeof d.notes === "string" ? d.notes.slice(0, 4000) : "",
    actual: {
      paid: n(act.paid), miles: n(act.miles), hours: n(act.hours), otherCosts: n(act.otherCosts), saleAmount: n(act.saleAmount),
      weights: Array.isArray(act.weights) ? act.weights.filter((w) => w && typeof w.gradeId === "string").slice(0, 30).map((w) => ({ gradeId: w.gradeId, lb: n(w.lb) })) : [],
    },
  };
}

export function loadPipeline() {
  const raw = load("pipeline", null);
  deals = (Array.isArray(raw?.deals) ? raw.deals : Array.isArray(raw) ? raw : []).map(clean).filter(Boolean);
  updateBadge();
}

/** Adds a deal (from Scan, Appraise or the calculator). Returns the stored deal. */
export function addDeal({ title, url, location, distanceMi, asking, image, source, ev, ident, summary }) {
  const existing = url ? deals.find((d) => d.url && d.url === url) : null;
  const est = ev ? {
    verdict: ev.verdict, netLow: ev.net.low, netMid: ev.net.mid, netHigh: ev.net.high, grossMid: ev.gross.mid,
    maxOffer: ev.maxOffer, weightEst: ev.weight.est, best: ev.best, summary: summary ?? ident?.summary ?? "",
    materials: ev.materials.map((m) => ({ gradeId: m.gradeId, lbEst: m.lbEst })), refUsdPerLb: S.reference?.usdPerLb ?? null, at: new Date().toISOString(),
  } : {};
  const base = {
    title, url, location, distanceMi, asking, image, source,
    estimate: est,
    flags: { provenance: ident?.provenanceRisk ?? null, refrigerant: ident?.refrigerant ?? null },
  };
  if (existing) {
    Object.assign(existing, clean({ ...existing, ...base, id: existing.id, status: existing.status, notes: existing.notes, actual: existing.actual, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }));
    persist();
    render();
    return existing;
  }
  const d = clean({ ...base, id: uid(), status: "watching", createdAt: new Date().toISOString() });
  deals.unshift(d);
  persist();
  render();
  return d;
}

export const hasDeal = (url) => !!url && deals.some((d) => d.url === url);

function updateBadge() {
  const n = deals.filter((d) => OPEN.has(d.status)).length;
  for (const el of $$("[data-pipeline-count]")) { el.textContent = n ? String(n) : ""; el.hidden = !n; }
}

/* ------------------------------------------------------------------ UI */
export function initPipeline() {
  const root = $("#panel-pipeline");
  root.innerHTML = `
    <h2 class="sr-only">Your deal pipeline</h2>
    <div class="rc-kpis rc-pipe-kpis" id="pipe-kpis"></div>
    <div class="rc-toolbar">
      <div class="rc-chips" role="group" aria-label="Filter deals" id="pipe-filter">
        ${[["open", "Open"], ["sold", "Sold"], ["passed", "Passed"], ["all", "All"]].map(([k, l]) => `<button type="button" class="chip chip-btn${k === filter ? " chip-on" : ""}" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join("")}
      </div>
      <div class="rc-toolbar-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="pipe-csv">Export CSV</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pipe-json">Export JSON</button>
        <label class="btn btn-ghost btn-sm rc-file-btn">Import JSON<input type="file" accept="application/json,.json" id="pipe-import" class="sr-only"></label>
      </div>
    </div>
    <div id="pipe-list" class="rc-pipe-list"></div>`;
  $("#pipe-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    $$("#pipe-filter [data-f]").forEach((x) => { const o = x.dataset.f === filter; x.classList.toggle("chip-on", o); x.setAttribute("aria-pressed", String(o)); });
    render();
  });
  $("#pipe-csv").addEventListener("click", exportCSV);
  $("#pipe-json").addEventListener("click", () => {
    if (!deals.length) { toast("Nothing to export yet."); return; }
    download(`reclaim-pipeline-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), deals }, null, 2));
  });
  $("#pipe-import").addEventListener("change", importJSON);
  const list = $("#pipe-list");
  list.addEventListener("click", onClick);
  list.addEventListener("change", onChange);
  on("settings", render);
  render();
}

function realisedFor(d) { return realised(d.actual, S.settings); }

function renderKPIs() {
  const open = deals.filter((d) => OPEN.has(d.status));
  const sold = deals.filter((d) => d.status === "sold");
  const openNet = open.reduce((a, d) => a + (d.estimate.netMid ?? 0), 0);
  const soldReal = sold.map(realisedFor).filter((x) => x !== null);
  const realTotal = soldReal.reduce((a, b) => a + b, 0);
  const estOfSold = sold.filter((d) => realisedFor(d) !== null).reduce((a, d) => a + (d.estimate.netMid ?? 0), 0);
  const k = (label, v, s = "") => `<div class="rc-kpi"><span class="k">${label}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ""}</div>`;
  $("#pipe-kpis").innerHTML = [
    k("Open deals", String(open.length), `${money(openNet)} expected net`),
    k("Sold", String(sold.length), soldReal.length ? `${soldReal.length} with a sale amount` : "add sale amounts to track"),
    k("Realised profit", soldReal.length ? money(realTotal) : "—", soldReal.length ? `vs ${money(estOfSold)} estimated` : ""),
    k("Passed", String(deals.filter((d) => d.status === "passed").length)),
  ].join("");
}

function dealHTML(d) {
  const open = expanded.has(d.id);
  const real = realisedFor(d);
  const e = d.estimate;
  const a = d.actual;
  const field = (key, label, unit = "$") => `<label class="rc-pfield"><span>${label}</span><span class="rc-unit-in"><span aria-hidden="true">${unit === "$" ? "$" : ""}</span><input class="input" inputmode="decimal" data-actual="${key}" value="${a[key] ?? ""}" placeholder="—" aria-label="${label}${unit !== "$" ? ` (${unit})` : " in dollars"}">${unit !== "$" ? `<small>${unit}</small>` : ""}</span></label>`;
  const variance = real !== null && e.netMid !== null ? real - e.netMid : null;
  const weightValue = a.weights.reduce((sum, w) => { const p = S.prices.get(w.gradeId); return sum + (p && w.lb ? p.mid * w.lb : 0); }, 0);
  return `<article class="card rc-deal${open ? " is-open" : ""}" data-id="${esc(d.id)}">
    <div class="rc-deal-head">
      <h3 class="rc-deal-h"><button type="button" class="rc-deal-toggle" data-act="toggle" aria-expanded="${open}" aria-controls="deal-body-${esc(d.id)}">
        <span class="rc-deal-title">${esc(d.title)}</span>
        <span class="rc-deal-meta">${[d.location, d.asking != null ? (d.asking === 0 ? "free" : `asking ${money(d.asking)}`) : null, `saved ${fmtDate(d.createdAt)}`].filter(Boolean).map(esc).join(" · ")}</span>
      </button></h3>
      <div class="rc-deal-nums">
        ${e.verdict ? verdictPill(e.verdict) : ""}
        <span class="rc-deal-net"><span class="k">${real !== null ? "Realised" : "Est. net"}</span><b>${money(real !== null ? real : e.netMid)}</b></span>
      </div>
      <label class="sr-only" for="st-${esc(d.id)}">Status of ${esc(d.title)}</label>
      <select class="input rc-dstatus" id="st-${esc(d.id)}" data-act="status">${STATUSES.map(([k, l]) => `<option value="${k}"${k === d.status ? " selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    <div class="rc-deal-body" id="deal-body-${esc(d.id)}"${open ? "" : " hidden"}>
      <div class="rc-deal-cols">
        <div>
          <h4 class="rc-h4">Estimate</h4>
          <p class="rc-fine">${e.netMid !== null ? `Net ${money(e.netLow)} to ${money(e.netHigh)} (mid ${money(e.netMid)}) · max offer ${money(Math.max(0, e.maxOffer ?? 0))}` : "No estimate saved."}${e.summary ? `<br>${esc(e.summary)}` : ""}</p>
          ${e.materials.length ? `<p class="rc-fine">${e.materials.map((m) => `${esc(gradeShort(m.gradeId))} ${lb(m.lbEst)}`).join(" · ")}</p>` : ""}
          ${d.url ? `<a class="link-ul" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open listing</a>` : ""}
          <label class="rc-pfield rc-notes"><span>Notes</span><textarea class="input" data-act="notes" rows="3" placeholder="Seller name, pickup time, what you agreed…">${esc(d.notes)}</textarea></label>
        </div>
        <div>
          <h4 class="rc-h4">Actuals</h4>
          <div class="rc-pgrid">
            ${field("paid", "Paid")}
            ${field("saleAmount", "Sold for")}
            ${field("miles", "Miles driven", "mi")}
            ${field("hours", "Hours spent, incl. driving", "h")}
            ${field("otherCosts", "Other costs")}
          </div>
          <div class="rc-weights">
            <span class="eyebrow">Weights on the scale</span>
            ${a.weights.map((w, i) => `<div class="rc-wrow"><label class="sr-only" for="wg-${esc(d.id)}-${i}">Grade</label><select class="input" id="wg-${esc(d.id)}-${i}" data-w="${i}" data-wk="gradeId">${S.grades.map((g) => `<option value="${g.id}"${g.id === w.gradeId ? " selected" : ""}>${esc(g.short)}</option>`).join("")}</select><label class="sr-only" for="wl-${esc(d.id)}-${i}">Pounds</label><input class="input" id="wl-${esc(d.id)}-${i}" inputmode="decimal" data-w="${i}" data-wk="lb" value="${w.lb ?? ""}" placeholder="lb"><button type="button" class="rc-icon-btn" data-act="wdel" data-w="${i}" aria-label="Remove weight row">×</button></div>`).join("")}
            <button type="button" class="btn btn-ghost btn-sm" data-act="wadd">Add weight</button>
            ${weightValue > 0 ? `<p class="rc-fine rc-weight-value">At your current prices these weights are worth ≈ ${money(weightValue)}.</p>` : ""}
          </div>
          <p class="rc-real">${real !== null ? `Realised profit <b>${money(real)}</b>${variance !== null ? ` · ${variance >= 0 ? "beat" : "missed"} the estimate by ${money(Math.abs(variance))}` : ""}` : "Enter what you paid and sold for to see realised profit (miles and hours use your current rates)."}</p>
        </div>
      </div>
      <div class="rc-deal-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="delete">Delete deal</button></div>
    </div>
  </article>`;
}

export function render() {
  const list = $("#pipe-list");
  if (!list) return;
  renderKPIs();
  const shown = deals.filter((d) => filter === "all" || (filter === "open" ? OPEN.has(d.status) : d.status === filter));
  list.innerHTML = shown.length ? shown.map(dealHTML).join("") : `<div class="card card-surface rc-empty"><p><b>${deals.length ? "No deals in this view." : "No saved deals yet."}</b></p><p class="rc-fine">Save a listing from Scan, an appraisal, or the calculator, then move it through Watching → Contacted → Offer made → Picked up → Sold.</p></div>`;
}

const dealOf = (el) => deals.find((d) => d.id === el.closest("[data-id]")?.dataset.id);
const touch = (d) => { d.updatedAt = new Date().toISOString(); persist(); };

function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.tagName === "SELECT" || btn.tagName === "TEXTAREA") return;
  const d = dealOf(btn);
  if (!d) return;
  const act = btn.dataset.act;
  if (act === "toggle") {
    if (expanded.has(d.id)) expanded.delete(d.id); else expanded.add(d.id);
    render();
    document.querySelector(`[data-id="${CSS.escape(d.id)}"] [data-act="toggle"]`)?.focus();
  } else if (act === "wadd") {
    d.actual.weights.push({ gradeId: d.estimate.materials[d.actual.weights.length]?.gradeId ?? "cu_2", lb: null });
    touch(d); render();
    const rows = document.querySelectorAll(`[data-id="${CSS.escape(d.id)}"] input[data-wk="lb"]`);
    rows[rows.length - 1]?.focus();
  } else if (act === "wdel") {
    d.actual.weights.splice(Number(btn.dataset.w), 1);
    touch(d); render();
  } else if (act === "delete") {
    if (!confirm(`Delete “${d.title}” from your pipeline?`)) return;
    deals = deals.filter((x) => x !== d);
    expanded.delete(d.id);
    persist(); render();
    announce("Deal deleted.");
  }
}

function onChange(e) {
  const el = e.target;
  const d = dealOf(el);
  if (!d) return;
  if (el.dataset.act === "status") {
    d.status = el.value;
    touch(d);
    announce(`${d.title}: ${statusLabel(d.status)}.`);
    render();
    document.getElementById(`st-${d.id}`)?.focus();
  } else if (el.dataset.act === "notes") {
    d.notes = el.value.slice(0, 4000);
    touch(d);
  } else if (el.dataset.actual) {
    const v = num(el.value);
    d.actual[el.dataset.actual] = v === null ? null : Math.max(0, v);
    touch(d); refreshDeal(d);
  } else if (el.dataset.wk) {
    const w = d.actual.weights[Number(el.dataset.w)];
    if (!w) return;
    if (el.dataset.wk === "gradeId") w.gradeId = el.value;
    else w.lb = num(el.value);
    touch(d); refreshDeal(d);
  }
}

/**
 * Updates a deal's computed figures in place. Typing in an actuals field must not
 * rebuild the card: the blur "change" would swap a button out from under a click.
 */
function refreshDeal(d) {
  renderKPIs();
  const card = document.querySelector(`.rc-deal[data-id="${CSS.escape(d.id)}"]`);
  if (!card) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = dealHTML(d);
  const fresh = tmp.firstElementChild;
  for (const sel of [".rc-deal-nums", ".rc-real", ".rc-weight-value"]) {
    const a = card.querySelector(sel), b = fresh.querySelector(sel);
    if (a && b) a.replaceWith(b);
    else if (!a && b && sel === ".rc-weight-value") card.querySelector('[data-act="wadd"]')?.after(b);
    else if (a && !b) a.remove();
  }
}

/* ------------------------------------------------------------------ export / import */
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCSV() {
  if (!deals.length) { toast("Nothing to export yet."); return; }
  const cols = ["id", "status", "title", "url", "location", "distanceMi", "asking", "verdict", "estNetLow", "estNetMid", "estNetHigh", "maxOffer", "paid", "milesDriven", "hours", "otherCosts", "saleAmount", "realised", "notes", "createdAt", "updatedAt"];
  const rows = deals.map((d) => [d.id, statusLabel(d.status), d.title, d.url, d.location, d.distanceMi, d.asking, d.estimate.verdict, d.estimate.netLow, d.estimate.netMid, d.estimate.netHigh, d.estimate.maxOffer, d.actual.paid, d.actual.miles, d.actual.hours, d.actual.otherCosts, d.actual.saleAmount, realisedFor(d), d.notes, d.createdAt, d.updatedAt]);
  download(`reclaim-pipeline-${new Date().toISOString().slice(0, 10)}.csv`, [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"), "text/csv");
}

async function importJSON(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 5_000_000) { toast("That file is too large to be a Reclaim export.", { kind: "error" }); return; }
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast("That file isn't valid JSON.", { kind: "error" }); return; }
  const incoming = Array.isArray(data) ? data : Array.isArray(data?.deals) ? data.deals : null;
  if (!incoming) { toast("No deals found in that file.", { kind: "error" }); return; }
  let added = 0, updated = 0, skipped = 0;
  for (const raw of incoming.slice(0, 2000)) {
    const d = clean(raw);
    if (!d) { skipped++; continue; }
    const i = deals.findIndex((x) => x.id === d.id);
    if (i < 0) { deals.push(d); added++; }
    else if (Date.parse(d.updatedAt) > Date.parse(deals[i].updatedAt)) { deals[i] = d; updated++; }
    else skipped++;
  }
  persist();
  render();
  const msg = `Imported ${added} new deal${added === 1 ? "" : "s"}${updated ? `, updated ${updated}` : ""}${skipped ? `, skipped ${skipped}` : ""}.`;
  toast(msg);
  announce(msg);
}
