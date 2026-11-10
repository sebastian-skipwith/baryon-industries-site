// Reclaim money engine. Pure functions, no DOM: every dollar figure the app shows
// is computed here from the visitor's prices and settings. The AI only identifies
// materials and weights; it never does arithmetic that reaches the screen.

/** Straight-line miles are multiplied by this to estimate driving miles. */
export const ROAD_FACTOR = 1.2;

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const pos = (v) => Math.max(0, num(v));
export const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/* ------------------------------------------------------------------ prices */

/** Low / mid / high $/lb for one grade from the copper reference, or null when unpriceable. */
export function gradeBand(grade, refUsdPerLb) {
  if (!grade) return null;
  let lo, hi;
  if (grade.kind === "ratio") {
    if (!(refUsdPerLb > 0) || !Array.isArray(grade.ratio)) return null;
    lo = grade.ratio[0] * refUsdPerLb;
    hi = grade.ratio[1] * refUsdPerLb;
  } else if (Array.isArray(grade.usd)) {
    [lo, hi] = grade.usd;
  } else return null;
  return { low: r2(lo), mid: r2((lo + hi) / 2), high: r2(hi) };
}

/**
 * Map of grade id -> { low, mid, high, override } in $/lb. A visitor's yard quote
 * (override) is a firm number, so it replaces the whole band.
 */
export function priceTable(grades, refUsdPerLb, overrides = {}) {
  const out = new Map();
  for (const g of grades) {
    const o = num(overrides?.[g.id], NaN);
    if (Number.isFinite(o) && o >= 0) out.set(g.id, { low: o, mid: o, high: o, override: true });
    else {
      const b = gradeBand(g, refUsdPerLb);
      if (b) out.set(g.id, { ...b, override: false });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ distance */

export function haversineMi(a, b) {
  if (!a || !b || ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const R = 3958.7613;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Listings are located at their town's centre, so a listing in the visitor's own
 * town measures 0 mi. Trips are counted as at least this far each way.
 */
export const MIN_TOWN_MI = 2;

/** Estimated one-way road miles from a straight-line town-to-town distance. */
export const oneWayRoadMiles = (straightMi) => (Number.isFinite(straightMi) ? r2(Math.max(straightMi, MIN_TOWN_MI) * ROAD_FACTOR) : null);

/** Estimated round-trip driving miles from a straight-line one-way distance. */
export const roundTripRoadMiles = (straightMi) => (Number.isFinite(straightMi) ? r2(Math.max(straightMi, MIN_TOWN_MI) * ROAD_FACTOR * 2) : null);

/* ------------------------------------------------------------------ wire weight */

export const WIRE_SIZES = [
  "18", "16", "14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0",
  "250 kcmil", "300 kcmil", "350 kcmil", "400 kcmil", "500 kcmil", "600 kcmil", "750 kcmil", "1000 kcmil",
];

/** Conductor cross-section in mm² for an AWG size ("12", "4/0") or "350 kcmil". */
export function wireAreaMm2(size) {
  const s = String(size).trim().toLowerCase();
  const k = s.match(/^(\d+(?:\.\d+)?)\s*(kcmil|mcm)$/);
  if (k) return Number(k[1]) * 0.506707479;
  const ought = s.match(/^([1-4])\/0$/);
  const n = ought ? 1 - Number(ought[1]) : Number(s);
  if (!Number.isFinite(n) || n > 40 || n < -3) return null;
  const d = 0.127 * 92 ** ((36 - n) / 39);
  return (Math.PI / 4) * d * d;
}

/** Pounds of copper per foot of one conductor (solid equivalent; ASTM annealed copper, 8.89 g/cm³). */
export function copperLbPerFt(size) {
  const a = wireAreaMm2(size);
  return a == null ? null : a * 1e-6 * 0.3048 * 8890 * 2.20462262;
}

/** Copper pounds in `lengthFt` of cable with `conductors` copper conductors of one size. */
export function wireCopperLb({ size, lengthFt, conductors = 1 }) {
  const per = copperLbPerFt(size);
  if (per == null) return null;
  return r2(per * pos(lengthFt) * Math.max(1, Math.round(num(conductors, 1))));
}

/**
 * From copper pounds and an insulated grade's recovery band, the whole-wire weight
 * range a yard would weigh (low / est / high).
 */
export function grossFromCopper(cuLb, recovery) {
  if (!(cuLb > 0) || !Array.isArray(recovery)) return null;
  const [rLo, rHi] = recovery;
  const mid = (rLo + rHi) / 2;
  return { low: r2(cuLb / rHi), est: r2(cuLb / mid), high: r2(cuLb / rLo) };
}

/* ------------------------------------------------------------------ deal evaluation */

const triple = (lo, mid, hi) => ({ low: r2(lo), mid: r2(mid), high: r2(hi) });

/** Normalises a value range a model or person gave: sorted, non-negative, with a midpoint. */
export function valueRange(v) {
  if (!v || v.available === false) return null;
  let lo = pos(v.low), hi = pos(v.high);
  if (!(lo > 0 || hi > 0)) return null;
  if (hi < lo) [lo, hi] = [hi, lo];
  return triple(lo, (lo + hi) / 2, hi);
}

function weights(m) {
  let lo = pos(m.lbLow), est = pos(m.lbEst), hi = pos(m.lbHigh);
  if (!est) est = lo && hi ? (lo + hi) / 2 : lo || hi;
  if (!lo) lo = est;
  if (!hi) hi = est;
  const s = [lo, est, hi].sort((a, b) => a - b);
  return { lbLow: s[0], lbEst: s[1], lbHigh: s[2] };
}

/**
 * Evaluates a deal.
 *   ident:    { materials:[{gradeId, lbLow, lbEst, lbHigh}], resale, parts, hours:{low,est,high},
 *               provenanceRisk, refrigerant, listingKind }
 *   prices:   Map from priceTable()
 *   settings: { costPerMile, laborPerHour, driveMph, riskPct, targetNet, targetRoi }  (riskPct, targetRoi in %;
 *             driveMph 0 = driving time not counted)
 *   deal:     { asking (null = unknown), roundTripMi, disposal }
 */
export function evaluate({ ident = {}, prices = new Map(), settings = {}, deal = {} }) {
  const reasons = [];
  const mats = (ident.materials ?? []).filter((m) => m && m.gradeId).map((m) => {
    const w = weights(m);
    const p = prices.get(m.gradeId);
    const value = p ? triple(w.lbLow * p.low, w.lbEst * p.mid, w.lbHigh * p.high) : triple(0, 0, 0);
    return { ...m, ...w, price: p ?? null, value, missingPrice: !p };
  });
  const sum = (k) => mats.reduce((a, m) => a + m.value[k], 0);
  const scrap = triple(sum("low"), sum("mid"), sum("high"));
  const weight = {
    low: r2(mats.reduce((a, m) => a + m.lbLow, 0)),
    est: r2(mats.reduce((a, m) => a + m.lbEst, 0)),
    high: r2(mats.reduce((a, m) => a + m.lbHigh, 0)),
  };
  const paths = { scrap, parts: valueRange(ident.parts), resale: valueRange(ident.resale) };

  // Costs that do not depend on the path.
  const askingKnown = deal.asking !== null && deal.asking !== undefined && deal.asking !== "" && Number.isFinite(Number(deal.asking));
  const asking = askingKnown ? pos(deal.asking) : 0;
  const roundTripMi = pos(deal.roundTripMi);
  const mileage = roundTripMi * pos(settings.costPerMile);
  const h = ident.hours ?? {};
  let hEst = pos(h.est), hLo = pos(h.low), hHi = pos(h.high);
  if (!hEst) hEst = hLo && hHi ? (hLo + hHi) / 2 : hLo || hHi;
  if (!hLo) hLo = hEst;
  if (!hHi) hHi = hEst;
  [hLo, hEst, hHi] = [hLo, hEst, hHi].sort((a, b) => a - b);
  const rate = pos(settings.laborPerHour);
  const labour = triple(hLo * rate, hEst * rate, hHi * rate);
  // Hours above are hands-on only; time behind the wheel is paid at the same rate.
  const driveMph = pos(settings.driveMph);
  const driveHours = driveMph > 0 ? roundTripMi / driveMph : 0;
  const driveTime = driveHours * rate;
  const travel = mileage + driveTime;
  const disposal = pos(deal.disposal);
  const risk = Math.min(100, pos(settings.riskPct)) / 100;

  // Net for each path: the low case pairs the low gross with the high labour.
  const netFor = (g) => {
    const riskAmt = triple(g.low * risk, g.mid * risk, g.high * risk);
    const cashOut = triple(asking + travel + labour.high + disposal, asking + travel + labour.mid + disposal, asking + travel + labour.low + disposal);
    const total = triple(cashOut.low + riskAmt.low, cashOut.mid + riskAmt.mid, cashOut.high + riskAmt.high);
    const net = triple(g.low - total.low, g.mid - total.mid, g.high - total.high);
    return { gross: g, risk: riskAmt, cashOut, total, net };
  };
  const byPath = {};
  for (const [k, g] of Object.entries(paths)) if (g) byPath[k] = netFor(g);
  let best = "scrap";
  for (const k of Object.keys(byPath)) if (byPath[k].net.mid > byPath[best].net.mid) best = k;
  const chosen = byPath[best];

  const roiOf = (n, c) => (c > 0 ? r2(n / c) : null);
  const roi = { low: roiOf(chosen.net.low, chosen.cashOut.low), mid: roiOf(chosen.net.mid, chosen.cashOut.mid), high: roiOf(chosen.net.high, chosen.cashOut.high) };

  // Asking price that zeroes the mid net, and the most you can pay and still hit both targets.
  const gAfterRisk = chosen.gross.mid * (1 - risk);
  const otherCosts = travel + labour.mid + disposal;
  const breakEven = r2(gAfterRisk - otherCosts);
  const targetNet = pos(settings.targetNet);
  const targetRoi = pos(settings.targetRoi) / 100;
  const byNet = gAfterRisk - otherCosts - targetNet;
  const byRoi = targetRoi > 0 ? gAfterRisk / (1 + targetRoi) - otherCosts : Infinity;
  const maxOffer = Math.floor(Math.min(byNet, byRoi));

  let verdict;
  if (ident.listingKind === "wanted_ad" || ident.listingKind === "service_ad") {
    verdict = "PASS";
    reasons.push(ident.listingKind === "wanted_ad" ? "This is a wanted ad: the poster is buying, not selling." : "This is a service ad (removal, stripping or hauling), not material for sale.");
  } else if (!mats.length && !paths.parts && !paths.resale) {
    verdict = "PASS";
    reasons.push("No materials identified yet.");
  } else if (chosen.net.mid <= 0) {
    verdict = "PASS";
    reasons.push(`Expected net is ${chosen.net.mid < 0 ? "negative" : "zero"} at this price.`);
  } else {
    const roiOk = targetRoi <= 0 || roi.mid == null || roi.mid >= targetRoi;
    if (chosen.net.mid >= targetNet && roiOk) verdict = "BUY";
    else {
      verdict = "MAYBE";
      if (chosen.net.mid < targetNet) reasons.push(`Expected net is below your $${Math.round(targetNet)} target.`);
      if (!roiOk) reasons.push(`Return on cash is below your ${Math.round(targetRoi * 100)}% target.`);
    }
  }
  if (verdict === "BUY" && ident.provenanceRisk === "high") {
    verdict = "MAYBE";
    reasons.push("High provenance risk: confirm the seller owns it before you buy.");
  }
  // Without an asking price the net is only an upper bound, so it can't earn a BUY on its own.
  if (!askingKnown && verdict === "BUY") verdict = "MAYBE";
  if (chosen.net.low < 0 && verdict !== "PASS") reasons.push("The low case loses money: weigh before you pay.");
  if (!askingKnown) reasons.push("Asking price unknown: the net assumes it is free. Pay no more than the max offer.");
  if (mats.some((m) => m.missingPrice)) reasons.push("Some materials have no price and count as $0.");

  return {
    materials: mats,
    weight,
    paths,
    byPath,
    best,
    gross: chosen.gross,
    costs: {
      asking: r2(asking),
      askingKnown,
      roundTripMi: r2(roundTripMi),
      mileage: r2(mileage),
      driveHours: r2(driveHours),
      driveTime: r2(driveTime),
      hours: { low: r2(hLo), est: r2(hEst), high: r2(hHi) },
      labour,
      disposal: r2(disposal),
      riskPct: r2(risk * 100),
      risk: chosen.risk,
      cashOut: chosen.cashOut,
      total: chosen.total,
    },
    net: chosen.net,
    roi,
    breakEven,
    maxOffer,
    verdict,
    reasons,
  };
}

/** Triage wording for the scanner. */
export const triageLabel = (verdict) => ({ BUY: "GRAB", MAYBE: "MAYBE", PASS: "SKIP" })[verdict] ?? "SKIP";

/* ------------------------------------------------------------------ pipeline */

/**
 * Realised profit for a finished deal: sale amount minus what was paid, the
 * mileage and labour at the visitor's rates, and any other costs.
 */
export function realised({ paid, saleAmount, miles, hours, otherCosts }, settings = {}) {
  if (saleAmount === null || saleAmount === undefined || saleAmount === "") return null;
  const cost = pos(paid) + pos(miles) * pos(settings.costPerMile) + pos(hours) * pos(settings.laborPerHour) + pos(otherCosts);
  return r2(pos(saleAmount) - cost);
}

/* ------------------------------------------------------------------ AI cost estimate */

/** $ per million tokens (input, output). */
export const MODEL_PRICES = {
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

/** Rough cost range for n AI calls of a given size. */
export function estimateCost(model, n, { inLow = 3000, inHigh = 6000, outLow = 800, outHigh = 3000, searches = 0 } = {}) {
  const p = MODEL_PRICES[model];
  if (!p || !(n > 0)) return null;
  const low = n * ((inLow * p[0] + outLow * p[1]) / 1e6);
  const high = n * ((inHigh * p[0] + outHigh * p[1]) / 1e6 + searches * 0.01);
  return { low: r2(low), high: r2(high) };
}
