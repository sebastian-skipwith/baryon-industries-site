// Deal report rendering shared by Appraise, Scan and Pipeline. Pure HTML from an
// evaluate() result; never computes money itself.
import { S, gradeName, gradeShort } from "./state.js";
import { esc, money, range, lb, pct, perLb, ICON, fmtDate } from "./util.js";
import { vehicleLabel } from "./ai.js";

export const VERDICT_CLASS = { BUY: "is-buy", GRAB: "is-buy", MAYBE: "is-maybe", PASS: "is-pass", SKIP: "is-pass" };

export const THEFT_NOTICE = "Copper, catalytic converters and utility, telecom or railroad gear are prime theft targets. Many states make yards record your ID, hold payment or refuse cash for them. Buy only from a seller who can show it is theirs.";
export const REFRIGERANT_NOTICE = "Units with refrigerant (AC, fridges, freezers, dehumidifiers) need it dealt with before scrapping: never vent R-22, R-410A or R-32 or cut a charged line. Split systems need an EPA Section 608 certified technician. Factory-sealed small appliances (window units, fridges, dehumidifiers) can be recovered with EPA-certified recovery equipment, a unit that has already leaked out (gauge at 0 psig) can be signed as leaked, and propane (R-290) or isobutane (R-600a) units may be vented outdoors away from any flame. Yards want a signed recovery statement or charge a fee: add it under disposal.";
export const PCB_NOTICE = "Transformers, fluorescent ballasts and capacitors made before 1979 can contain PCBs. Don't scrap one that is unlabelled, leaking oil or older than that (ballasts should say \"No PCBs\"), and leave utility pole transformers alone: they belong to the utility.";
export const VERIFY_NOTICE = "Estimates, not offers. Verify weight on a scale and call your yard before you pay or haul.";

export function notice(kind, text) {
  return `<div class="rc-notice rc-notice-${kind}" role="note">${ICON.alert}<p>${text}</p></div>`;
}

/** Notices that apply to an identification + listing text. */
export function noticesFor({ ident = {}, ev = null, flags = {} }) {
  const out = [];
  const copperish = ev?.materials?.some((m) => S.gradeById.get(m.gradeId)?.copper) || flags.copper;
  if (ident.listingKind === "wanted_ad") out.push(notice("info", "<b>Wanted ad.</b> The poster wants to buy or collect scrap; nothing is for sale here."));
  if (ident.listingKind === "service_ad") out.push(notice("info", "<b>Service ad.</b> This offers removal, hauling or stripping, not material for sale."));
  if (ident.provenanceRisk === "high" || ident.provenanceRisk === "medium" || flags.theft) {
    const note = ident.provenanceNote ? ` ${esc(ident.provenanceNote)}` : "";
    out.push(notice(ident.provenanceRisk === "high" ? "warn" : "info", `<b>Provenance ${ident.provenanceRisk === "high" ? "risk: high" : "check"}.</b>${note} ${THEFT_NOTICE}`));
  } else if (copperish) out.push(notice("info", `<b>Copper law.</b> ${THEFT_NOTICE}`));
  if (ident.refrigerant === "present" || ident.refrigerant === "possible" || flags.refrigerant || ev?.materials?.some((m) => S.gradeById.get(m.gradeId)?.refrigerant)) {
    out.push(notice("info", `<b>Refrigerant${ident.refrigerant === "present" ? "" : " possible"}.</b> ${ident.refrigerantNote ? `${esc(ident.refrigerantNote)} ` : ""}${REFRIGERANT_NOTICE}`));
  }
  if (flags.pcb || ev?.materials?.some((m) => /transformer|ballast/.test(m.gradeId))) out.push(notice("info", `<b>PCBs.</b> ${PCB_NOTICE}`));
  return out.join("");
}

const PATH_LABEL = { scrap: "Scrap", parts: "Parts", resale: "Resale" };

export function verdictPill(v, triage = false) {
  const label = triage ? ({ BUY: "GRAB", MAYBE: "MAYBE", PASS: "SKIP" })[v] : v;
  return `<span class="rc-verdict ${VERDICT_CLASS[v] ?? "is-pass"}">${label}</span>`;
}

function linkList(list) {
  return (list ?? []).map((s) => {
    const url = typeof s === "string" ? s : s.url;
    const title = typeof s === "string" ? s : s.title || s.url;
    return /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(title.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70))}</a>` : esc(title);
  }).join(" · ");
}

/** The full report (Appraise tab). */
export function reportHTML(ev, ident, { usage = "", searched = [], flags = {} } = {}) {
  const st = S.settings;
  const c = ev.costs;
  const best = ev.best;
  const kpi = (k, v, sub = "") => `<div class="rc-kpi"><span class="k">${k}</span><span class="v">${v}</span>${sub ? `<span class="s">${sub}</span>` : ""}</div>`;
  const maxOffer = ev.maxOffer > 0 ? money(ev.maxOffer) : "$0";
  const maxSub = ev.maxOffer > 0 ? `to clear ${money(st.targetNet)}${st.targetRoi > 0 ? ` and ${st.targetRoi}%` : ""}` : "misses your target even free";
  const pathRows = ["scrap", "parts", "resale"].filter((k) => ev.byPath[k]).map((k) => {
    const p = ev.byPath[k];
    return `<tr${k === best ? ' class="is-best"' : ""}><th scope="row">${PATH_LABEL[k]}${k === best ? ' <span class="rc-tag">best</span>' : ""}</th><td class="num">${range(p.gross.low, p.gross.high)}</td><td class="num"><b>${money(p.net.mid)}</b></td></tr>`;
  }).join("");
  const matRows = ev.materials.map((m) => `<tr>
      <th scope="row">${esc(gradeShort(m.gradeId))}${m.what ? `<span class="rc-gnote">${esc(m.what)}</span>` : ""}</th>
      <td class="num">${m.lbLow === m.lbHigh ? lb(m.lbEst) : `${lb(m.lbLow).replace(" lb", "")}–${lb(m.lbHigh)}`}</td>
      <td class="num">${m.price ? `${perLb(m.price.mid)}${m.price.override ? '<span class="rc-gnote">your yard</span>' : ""}` : '<span class="rc-gnote">no price</span>'}</td>
      <td class="num">${range(m.value.low, m.value.high)}</td></tr>`).join("");
  const res = ident.resale, parts = ident.parts;
  const srcBits = [];
  if (res?.sources?.length) srcBits.push(`Resale: ${linkList(res.sources)}`);
  if (parts?.sources?.length) srcBits.push(`Parts: ${linkList(parts.sources)}`);
  if (searched.length) srcBits.push(`Searched: ${linkList(searched.slice(0, 6))}`);
  const refNote = S.reference ? `Copper reference ${perLb(S.reference.usdPerLb)} (${esc(S.reference.source ?? "")}, as of ${esc(fmtDate(S.reference.asOf))}).` : "";

  return `
    <div class="rc-report-head">
      ${verdictPill(ev.verdict)}
      <div class="rc-net"><span class="k">Expected net</span><span class="v">${money(ev.net.mid)}</span><span class="s">range ${range(ev.net.low, ev.net.high)}</span></div>
    </div>
    ${ev.reasons.length ? `<ul class="rc-reasons">${ev.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    <div class="rc-kpis">
      ${kpi("Max offer", maxOffer, maxSub)}
      ${kpi("Break-even price", money(Math.max(0, ev.breakEven)), ev.breakEven < 0 ? "loses money even free" : "net is zero here")}
      ${kpi("Return on cash", pct(ev.roi.mid), `range ${pct(ev.roi.low)} to ${pct(ev.roi.high)}`)}
      ${kpi("Weight", ev.weight.low === ev.weight.high ? lb(ev.weight.est) : `${Math.round(ev.weight.low)}–${lb(ev.weight.high)}`, ident.vehicle ? vehicleLabel(ident.vehicle) : "")}
    </div>
    ${noticesFor({ ident, ev, flags })}
    <h3 class="rc-h4">Value by path</h3>
    <table class="rc-table rc-mini"><thead><tr><th scope="col">Path</th><th scope="col" class="num">Gross</th><th scope="col" class="num">Net (mid)</th></tr></thead><tbody>${pathRows}</tbody></table>
    ${(res?.basis || parts?.basis) ? `<p class="rc-fine">${res?.basis ? `Resale: ${esc(res.basis)}. ` : ""}${parts?.basis ? `Parts: ${esc(parts.basis)}.` : ""}</p>` : ""}
    <h3 class="rc-h4">Materials</h3>
    ${ev.materials.length ? `<table class="rc-table rc-mini"><thead><tr><th scope="col">Grade</th><th scope="col" class="num">Weight</th><th scope="col" class="num">$/lb</th><th scope="col" class="num">Value</th></tr></thead><tbody>${matRows}</tbody></table>` : '<p class="rc-fine">No scrap materials listed.</p>'}
    <h3 class="rc-h4">Cost stack <span class="rc-gnote">(${PATH_LABEL[best].toLowerCase()} path, mid case)</span></h3>
    <dl class="rc-costs">
      <div><dt>Asking price${c.askingKnown ? "" : " (unknown)"}</dt><dd>${money(c.asking)}</dd></div>
      <div><dt>Driving: ${Math.round(c.roundTripMi)} mi round trip × $${Number(st.costPerMile).toFixed(2)}</dt><dd>${money(c.mileage)}</dd></div>
      ${c.driveTime > 0 ? `<div><dt>Driving time: ${c.driveHours} h × ${money(st.laborPerHour)}</dt><dd>${money(c.driveTime)}</dd></div>` : ""}
      <div><dt>Time: ${c.hours.est} h × ${money(st.laborPerHour)}${c.hours.low !== c.hours.high ? ` <span class="rc-gnote">(${c.hours.low}–${c.hours.high} h)</span>` : ""}</dt><dd>${money(c.labour.mid)}</dd></div>
      <div><dt>Disposal and fees</dt><dd>${money(c.disposal)}</dd></div>
      <div><dt>Risk reserve: ${c.riskPct}% of gross</dt><dd>${money(c.risk.mid)}</dd></div>
      <div class="rc-costs-total"><dt>Total costs</dt><dd>${money(c.total.mid)}</dd></div>
    </dl>
    ${srcBits.length ? `<p class="rc-fine rc-sources">${srcBits.join("<br>")}</p>` : ""}
    <p class="rc-fine">${VERIFY_NOTICE} ${refNote}${usage ? `<br>${esc(usage)}` : ""}</p>`;
}

/** One-line material summary: "≈45 lb · mostly THHN". */
export function materialSummary(ev) {
  if (!ev?.materials?.length) return "";
  const top = [...ev.materials].sort((a, b) => b.value.mid - a.value.mid)[0];
  return `≈${lb(ev.weight.est)} · mostly ${gradeShort(top.gradeId)}`;
}
export { gradeName };
