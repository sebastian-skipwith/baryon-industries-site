// Prices tab: the copper reference (relay -> /data/copper.json -> built-in dated
// fallback), each grade's estimated yard band, and the visitor's own yard quotes.
import { S, on, setGrades, setReference, setOverride, clearOverrides } from "./state.js";
import { $, $$, esc, perLb, fmtDate, daysSince, num, announce, toast } from "./util.js";
import { gradeBand } from "./engine.js";

const validRef = (r) => r && Number.isFinite(Number(r.usdPerLb)) && Number(r.usdPerLb) > 0.5 && Number(r.usdPerLb) < 50 && r.asOf;

async function fetchJSON(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Loads grades and a copper reference: the site's snapshot (/data/copper.json) or the
 * dated built-in fallback first, so the page renders at once; then the relay's live
 * price replaces it when it answers.
 */
export async function loadPrices() {
  const grades = await fetchJSON("/data/reclaim-grades.json?v=2", 15000);
  if (!grades?.grades?.length) throw new Error("Couldn't load the grade table.");
  setGrades(grades);
  const builtin = { ...grades.reference.fallback, origin: "builtin" };
  const file = await fetchJSON("/data/copper.json", 5000);
  // The relay's dated snapshot in the repo wins; the grade table's own price is the last resort.
  const ref = validRef(file) ? { ...file, origin: "file" } : builtin;
  ref.usdPerLb = Number(ref.usdPerLb);
  setReference(ref);
  if (S.relay) {
    fetchJSON(`${S.relay}/reclaim/prices`, 8000).then((r) => {
      // The relay is normally the freshest; a relay answer older than the site's own
      // snapshot (say, a failing refresh) never replaces a newer price.
      if (!(r?.ok && validRef(r))) return;
      const cur = S.reference;
      const newer = !cur || cur.origin === "builtin" || !(Date.parse(cur.asOf) > Date.parse(r.asOf));
      if (newer) setReference({ ...r, usdPerLb: Number(r.usdPerLb), origin: "relay" });
    });
  }
}

export function refStale() {
  const d = daysSince(S.reference?.asOf);
  return d !== null && d > S.staleAfterDays;
}

export function refLine() {
  const r = S.reference;
  if (!r) return "";
  const d = daysSince(r.asOf);
  return `${r.basis ?? "Copper reference"} · ${r.source ?? ""}${r.asOf ? ` · as of ${fmtDate(r.asOf)}` : ""}${d !== null && d > S.staleAfterDays ? ` (${d} days old)` : ""}`;
}

/* ------------------------------------------------------------------ render */
let filter = "all";

export function initPrices() {
  const root = $("#panel-prices");
  root.innerHTML = `
    <h2 class="sr-only">Grade prices</h2>
    <div class="rc-grid-2 rc-prices-top">
      <section class="card rc-pane rc-ref" aria-labelledby="ref-title">
        <div class="eyebrow" id="ref-title">Copper reference</div>
        <div class="rc-ref-v" id="ref-v">—</div>
        <p class="rc-ref-meta" id="ref-meta"></p>
        <p class="rc-warn" id="ref-stale" hidden></p>
      </section>
      <section class="card card-surface rc-pane rc-explain">
        <div class="eyebrow">How these numbers work</div>
        <p>Copper grades are a band of the reference price (a yard pays a share of COMEX). Other metals are fixed bands. Each band names its source and the date it was checked against posted yard boards.</p>
        <p><b>These are estimates.</b> Yards differ by region, volume and the day. Call your yard, then type its quote into “Your yard” and every appraisal, triage and calculation uses it.</p>
      </section>
    </div>
    <div class="rc-toolbar">
      <div class="rc-chips" role="group" aria-label="Filter grades" id="price-filter"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="clear-quotes">Clear my quotes</button>
    </div>
    <div class="card rc-table-card">
      <table class="rc-table rc-price-table">
        <caption class="sr-only">Estimated yard prices by grade, with your own quotes</caption>
        <thead><tr><th scope="col">Grade</th><th scope="col" class="num">Est. yard $/lb</th><th scope="col" class="num">Your yard $/lb</th><th scope="col">Source</th></tr></thead>
        <tbody id="price-rows"></tbody>
      </table>
    </div>`;
  const chips = [["all", "All"], ...S.groups.map((g) => [g.id, g.label])];
  $("#price-filter").innerHTML = chips.map(([id, label]) => `<button type="button" class="chip chip-btn${id === filter ? " chip-on" : ""}" data-filter="${id}" aria-pressed="${id === filter}">${esc(label)}</button>`).join("");
  $("#price-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    $$("#price-filter [data-filter]").forEach((x) => { const onx = x.dataset.filter === filter; x.classList.toggle("chip-on", onx); x.setAttribute("aria-pressed", String(onx)); });
    renderRows();
  });
  $("#clear-quotes").addEventListener("click", () => {
    const n = Object.keys(S.overrides).length;
    if (!n) { toast("No yard quotes to clear."); return; }
    if (!confirm(`Clear your ${n} yard quote${n === 1 ? "" : "s"} and go back to the estimates?`)) return;
    clearOverrides();
    renderRows();
    announce("Your yard quotes were cleared. Estimates are back in use.");
  });
  $("#price-rows").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-grade]");
    if (!inp) return;
    const v = num(inp.value);
    if (inp.value.trim() !== "" && (v === null || v < 0 || v > 100)) { inp.setCustomValidity("Enter a price per pound between 0 and 100."); inp.reportValidity(); return; }
    inp.setCustomValidity("");
    setOverride(inp.dataset.grade, v);
    announce(v === null ? `Quote cleared for ${S.gradeById.get(inp.dataset.grade)?.name}.` : `Your yard quote saved: ${perLb(v)}.`);
  });
  renderRef();
  renderRows();
  on("prices", () => { renderRef(); updateRowValues(); });
}

function renderRef() {
  const r = S.reference;
  if (!r || !$("#ref-v")) return;
  $("#ref-v").innerHTML = `${perLb(r.usdPerLb)}<span class="rc-ref-unit">${esc(r.basis ?? "")}</span>`;
  const origin = { relay: "Fetched through Baryon's relay", file: "Snapshot in this site", builtin: "Built-in fallback" }[r.origin] ?? "";
  $("#ref-meta").innerHTML = `${/^https:\/\//.test(r.sourceUrl ?? "") ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.source ?? "Source")}</a>` : esc(r.source ?? "")} · as of ${esc(fmtDate(r.asOf))} · ${esc(origin)}${r.license ? `<br><span class="soft">${esc(r.license)}</span>` : ""}<br><span class="soft">An exchange price for refined copper, not what a yard pays: the bands below turn it into yard estimates.${(r.basis ?? "").includes("LME") ? " Those bands are shares of COMEX and this reference is LME-based, so treat them as approximate." : ""}</span>`;
  const d = daysSince(r.asOf);
  const stale = $("#ref-stale");
  stale.hidden = !(d !== null && d > S.staleAfterDays);
  stale.textContent = stale.hidden ? "" : `This reference is ${d} days old. Copper moves fast: check today's COMEX price and your yard before you rely on it.`;
}

/** "$5.05 – 5.56" estimate band for a grade (ignores the visitor's quote). */
function estText(g) {
  const b = gradeBand(g, S.reference?.usdPerLb);
  return b ? `$${b.low.toFixed(2)} – ${b.high.toFixed(2)}` : "—";
}

/** "mid $5.33 · " for a grade's estimate band (ignores the visitor's quote). */
function midText(g) {
  const b = gradeBand(g, S.reference?.usdPerLb);
  return b && b.high > 0 ? `mid $${b.mid.toFixed(2)} · ` : "";
}

function rowHTML(g) {
  const p = S.prices.get(g.id);
  const src = S.sources[g.source] ?? {};
  return `<tr data-row="${g.id}">
    <th scope="row"><span class="rc-gname">${esc(g.name)}</span>${g.confidence === "derived" ? ' <span class="rc-tag" title="Derived estimate, not a published band">derived</span>' : ""}<span class="rc-gnote">${esc(g.notes ?? "")}</span></th>
    <td class="num"><span class="rc-est">${estText(g)}</span><span class="rc-gnote"><span class="rc-mid">${midText(g)}</span>${g.kind === "ratio" ? `${Math.round(g.ratio[0] * 100)}–${Math.round(g.ratio[1] * 100)}% of copper ref.` : "fixed band"}${g.recovery ? ` · ${Math.round(g.recovery[0] * 100)}–${Math.round(g.recovery[1] * 100)}% recovery` : ""}</span></td>
    <td class="num"><label class="sr-only" for="q-${g.id}">Your yard's quote for ${esc(g.name)}, dollars per pound</label>
      <input class="input rc-quote${p?.override ? " is-set" : ""}" id="q-${g.id}" data-grade="${g.id}" inputmode="decimal" placeholder="${p && !p.override ? p.mid.toFixed(2) : ""}" value="${p?.override ? p.mid : ""}" autocomplete="off"></td>
    <td><span class="rc-src">${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src.name ?? "")}</span><span class="rc-gnote">${esc(g.basis ?? "")}${src.checked ? ` · checked ${esc(fmtDate(src.checked))}` : ""}</span></td>
  </tr>`;
}

function renderRows() {
  const body = $("#price-rows");
  if (!body) return;
  const groups = S.groups.filter((g) => filter === "all" || g.id === filter);
  body.innerHTML = groups.map((grp) => {
    const rows = S.grades.filter((g) => g.group === grp.id);
    return `<tr class="rc-group"><th colspan="4" scope="colgroup">${esc(grp.label)}</th></tr>${rows.map(rowHTML).join("")}`;
  }).join("");
}

function updateRowValues() {
  for (const g of S.grades) {
    const row = document.querySelector(`[data-row="${g.id}"]`);
    if (!row) continue;
    const p = S.prices.get(g.id);
    const est = row.querySelector(".rc-est");
    if (est) est.textContent = estText(g);
    const mid = row.querySelector(".rc-mid");
    if (mid) mid.textContent = midText(g);
    const inp = row.querySelector("input");
    if (inp && document.activeElement !== inp) {
      inp.value = p?.override ? p.mid : "";
      inp.placeholder = p && !p.override ? p.mid.toFixed(2) : "";
    }
    inp?.classList.toggle("is-set", !!p?.override);
  }
}
