// Calculator: the quick manual version. Pounds per grade, the trip, and the same
// engine as everything else. Editing a price here saves it as your yard's quote.
import { S, on, setOverride } from "./state.js";
import { $, $$, esc, money, range, pct, perLb, num, load, save, debounce, announce, toast, fmtDate } from "./util.js";
import { evaluate } from "./engine.js";
import { verdictPill, VERIFY_NOTICE } from "./report.js";
import { mountWireHelper } from "./wire.js";
import { addDeal } from "./pipeline.js";

const C = { lbs: {}, asking: "", rtMiles: "", hours: "", disposal: "", showAll: false };
const persist = debounce(() => save("calc", C), 300);
const COPPER_GROUPS = new Set(["copper", "insulated", "coils", "brass"]);

export function initCalculator() {
  const saved = load("calc", null);
  if (saved && typeof saved === "object") Object.assign(C, saved, { lbs: saved.lbs && typeof saved.lbs === "object" ? saved.lbs : {} });
  const root = $("#panel-calculator");
  root.innerHTML = `
    <div class="rc-calc">
      <section class="card rc-pane" aria-labelledby="c-title">
        <div class="rc-pane-head"><h2 class="rc-h3" id="c-title">What's in the load</h2>
          <label class="rc-check"><input type="checkbox" id="c-all"${C.showAll ? " checked" : ""}><span>Show other metals</span></label></div>
        <p class="rc-fine">Pounds per grade. Prices are estimates from the copper reference; type your yard's quote to replace one (it saves to Prices too).</p>
        <table class="rc-table rc-calc-table">
          <caption class="sr-only">Pounds and price per grade</caption>
          <thead><tr><th scope="col">Grade</th><th scope="col" class="num">Your yard $/lb</th><th scope="col" class="num">Pounds</th><th scope="col" class="num">Value</th></tr></thead>
          <tbody id="c-rows"></tbody>
        </table>
        <div id="c-wire"></div>
      </section>
      <div class="rc-calc-side">
        <section class="card rc-pane" aria-labelledby="c-costs-title">
          <h2 class="rc-h3" id="c-costs-title">Trip & costs</h2>
          <label class="rc-crow" for="c-asking"><span>Purchase price ($)</span><input class="input" id="c-asking" inputmode="decimal" placeholder="0"></label>
          <label class="rc-crow" for="c-rt"><span>Round-trip miles</span><input class="input" id="c-rt" inputmode="decimal" placeholder="0"></label>
          <label class="rc-crow" for="c-hours"><span>Hours (load, strip, sort)</span><input class="input" id="c-hours" inputmode="decimal" placeholder="0"></label>
          <label class="rc-crow" for="c-disp"><span>Disposal & fees ($)</span><input class="input" id="c-disp" inputmode="decimal" placeholder="0"></label>
          <p class="rc-fine" id="c-rates"></p>
          <div class="rc-calc-result" id="c-result" aria-live="polite"></div>
          <div class="rc-actions"><button type="button" class="btn btn-ghost btn-sm" id="c-save">Save to pipeline</button><button type="button" class="btn btn-ghost btn-sm" id="c-reset">Reset</button></div>
        </section>
      </div>
      <button type="button" class="rc-calc-mini" id="c-mini" hidden></button>
    </div>`;
  const bind = (id, key) => {
    const el = $(`#${id}`);
    el.value = C[key] ?? "";
    el.addEventListener("input", () => { C[key] = el.value; persist(); renderResult(); });
  };
  bind("c-asking", "asking");
  bind("c-rt", "rtMiles");
  bind("c-hours", "hours");
  bind("c-disp", "disposal");
  $("#c-all").addEventListener("change", (e) => { C.showAll = e.target.checked; persist(); renderRows(); });
  // Phone: a compact net bar above the tab bar; tapping it jumps to the costs and verdict.
  $("#c-mini").addEventListener("click", () => {
    $("#c-costs-title").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("#c-asking").focus({ preventScroll: true });
  });
  const io = "IntersectionObserver" in window ? new IntersectionObserver(([e]) => { $("#c-mini").classList.toggle("is-away", e.isIntersecting); }) : null;
  io?.observe($("#c-result"));
  $("#c-rows").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.lb) { C.lbs[t.dataset.lb] = t.value; persist(); updateValues(); renderResult(); }
  });
  $("#c-rows").addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset.price) return;
    const v = num(t.value);
    if (t.value.trim() !== "" && (v === null || v < 0 || v > 100)) { t.setCustomValidity("Enter a price per pound between 0 and 100."); t.reportValidity(); return; }
    t.setCustomValidity("");
    setOverride(t.dataset.price, v);
  });
  $("#c-reset").addEventListener("click", () => {
    C.lbs = {}; C.asking = ""; C.rtMiles = ""; C.hours = ""; C.disposal = "";
    for (const id of ["c-asking", "c-rt", "c-hours", "c-disp"]) $(`#${id}`).value = "";
    persist(); renderRows(); renderResult();
    announce("Calculator cleared.");
  });
  $("#c-save").addEventListener("click", () => {
    const ev = currentEval();
    if (!ev.materials.length) { toast("Enter some pounds first."); return; }
    const d = addDeal({ title: `Load: ${ev.materials.map((m) => S.gradeById.get(m.gradeId)?.short).slice(0, 3).join(", ")}`, url: "", location: "", distanceMi: num(C.rtMiles) !== null ? num(C.rtMiles) / 2 : null, asking: num(C.asking), source: "calculator", ev, ident: null });
    toast(`Saved “${d.title}” to your pipeline.`);
  });
  mountWireHelper($("#c-wire"), (m) => {
    const cur = num(C.lbs[m.gradeId]) ?? 0;
    C.lbs[m.gradeId] = String(Math.round((cur + m.lbEst) * 10) / 10);
    if (!COPPER_GROUPS.has(S.gradeById.get(m.gradeId)?.group)) C.showAll = true;
    persist(); renderRows(); renderResult();
    toast(`Added ${m.lbEst} lb of ${S.gradeById.get(m.gradeId)?.short}.`);
  });
  renderRows();
  renderResult();
  on("prices", () => { refreshPrices(); renderResult(); });
  on("settings", renderResult);
}

function visibleGrades() {
  return S.grades.filter((g) => C.showAll || COPPER_GROUPS.has(g.group) || num(C.lbs[g.id]) > 0);
}

function renderRows() {
  const shown = new Set(visibleGrades().map((g) => g.id));
  $("#c-rows").innerHTML = S.groups.map((grp) => {
    const rows = S.grades.filter((g) => g.group === grp.id && shown.has(g.id));
    if (!rows.length) return "";
    return `<tr class="rc-group"><th colspan="4" scope="colgroup">${esc(grp.label)}</th></tr>` + rows.map((g) => {
      const p = S.prices.get(g.id);
      return `<tr data-g="${g.id}">
        <th scope="row"><span class="rc-gname">${esc(g.short)}</span>${g.recovery ? `<span class="rc-gnote">${Math.round(g.recovery[0] * 100)}–${Math.round(g.recovery[1] * 100)}% copper</span>` : ""}</th>
        <td class="num" data-label="Your yard $/lb"><label class="sr-only" for="cp-${g.id}">Price per pound for ${esc(g.name)}</label><input class="input rc-quote${p?.override ? " is-set" : ""}" id="cp-${g.id}" data-price="${g.id}" inputmode="decimal" value="${p?.override ? p.mid : ""}" placeholder="${p && !p.override ? p.mid.toFixed(2) : ""}"></td>
        <td class="num" data-label="Pounds"><label class="sr-only" for="cl-${g.id}">Pounds of ${esc(g.name)}</label><input class="input rc-lbin" id="cl-${g.id}" data-lb="${g.id}" inputmode="decimal" value="${esc(C.lbs[g.id] ?? "")}" placeholder="0"></td>
        <td class="num rc-cval" data-v="${g.id}"></td></tr>`;
    }).join("");
  }).join("");
  updateValues();
}

function refreshPrices() {
  for (const g of S.grades) {
    const inp = document.getElementById(`cp-${g.id}`);
    if (!inp || document.activeElement === inp) continue;
    const p = S.prices.get(g.id);
    inp.value = p?.override ? p.mid : "";
    inp.placeholder = p && !p.override ? p.mid.toFixed(2) : "";
    inp.classList.toggle("is-set", !!p?.override);
  }
  updateValues();
}

function updateValues() {
  const ev = currentEval();
  const byId = new Map(ev.materials.map((m) => [m.gradeId, m]));
  for (const el of $$("#c-rows [data-v]")) {
    const m = byId.get(el.dataset.v);
    el.textContent = m && m.lbEst > 0 ? money(m.value.mid) : "";
  }
}

function currentEval() {
  const materials = Object.entries(C.lbs).map(([gradeId, v]) => ({ gradeId, lb: num(v) })).filter((m) => m.lb > 0 && S.gradeById.has(m.gradeId))
    .map((m) => ({ gradeId: m.gradeId, lbLow: m.lb, lbEst: m.lb, lbHigh: m.lb }));
  const h = num(C.hours) ?? 0;
  return evaluate({
    ident: { materials, hours: { low: h, est: h, high: h }, listingKind: "for_sale" },
    prices: S.prices,
    settings: S.settings,
    deal: { asking: num(C.asking) ?? 0, roundTripMi: num(C.rtMiles) ?? 0, disposal: num(C.disposal) ?? 0 },
  });
}

function renderResult() {
  const st = S.settings;
  $("#c-rates").innerHTML = `At $${Number(st.costPerMile).toFixed(2)}/mi, ${money(st.laborPerHour)}/h, ${st.riskPct}% risk reserve; buy at ${money(st.targetNet)}+${st.targetRoi > 0 ? ` and ${st.targetRoi}% return` : ""}. <button type="button" class="rc-link" data-open-settings>Edit</button>`;
  const ev = currentEval();
  const box = $("#c-result");
  const mini = $("#c-mini");
  mini.hidden = !ev.materials.length;
  if (ev.materials.length) mini.innerHTML = `<span class="k">Expected net</span><b>${money(ev.net.mid)}</b>${verdictPill(ev.verdict)}<span class="rc-calc-mini-go">Costs ↓</span>`;
  if (!ev.materials.length) {
    box.innerHTML = `<div class="rc-calc-empty"><span class="k">Expected net</span><span class="v soft">$0</span><p class="rc-fine">Enter pounds for at least one grade.</p></div>`;
    return;
  }
  const c = ev.costs;
  box.innerHTML = `
    <div class="rc-pair"><div><span class="k">Gross</span><span class="v">${money(ev.gross.mid)}</span><span class="s">${range(ev.gross.low, ev.gross.high)}</span></div>
      <div><span class="k">Total costs</span><span class="v">${money(-c.total.mid)}</span><span class="s">incl. ${money(c.risk.mid)} risk</span></div></div>
    <div class="rc-calc-net"><span class="k">Expected net</span><span class="v">${money(ev.net.mid)}</span><span class="s">range ${range(ev.net.low, ev.net.high)} · return ${pct(ev.roi.mid)}</span>${verdictPill(ev.verdict)}</div>
    ${ev.reasons.length ? `<ul class="rc-reasons">${ev.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    <dl class="rc-costs rc-costs-tight">
      <div><dt>Most you should pay</dt><dd>${ev.maxOffer > 0 ? money(ev.maxOffer) : "$0"}</dd></div>
      <div><dt>Break-even price</dt><dd>${money(Math.max(0, ev.breakEven))}</dd></div>
    </dl>
    <p class="rc-fine">${VERIFY_NOTICE} Copper reference ${perLb(S.reference?.usdPerLb)} as of ${esc(fmtDate(S.reference?.asOf))}.</p>`;
}
