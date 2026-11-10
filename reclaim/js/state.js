// Shared app state: public config, the visitor's settings, the grade table, the
// copper reference and the computed price map. Modules listen for changes on `bus`.
import { load, save } from "./util.js";
import { priceTable } from "./engine.js";

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

export const DEFAULT_SETTINGS = {
  home: null, // { label: "Fairfax, VA", city, st, lat, lng }
  radiusMi: 30,
  costPerMile: 0.55,
  laborPerHour: 30,
  driveMph: 50,
  riskPct: 15,
  targetNet: 150,
  targetRoi: 25,
};

export const S = {
  config: {},
  relay: "", // Worker base for /reclaim/* routes ("" = scanner not deployed)
  hosted: "", // hosted Claude proxy base ("" = not deployed)
  settings: { ...DEFAULT_SETTINGS },
  grades: [],
  groups: [],
  sources: {},
  gradeById: new Map(),
  reference: null, // { usdPerLb, basis, source, sourceUrl, asOf, license, origin }
  staleAfterDays: 45,
  overrides: {},
  prices: new Map(),
};

const trimSlash = (u) => String(u ?? "").trim().replace(/\/+$/, "");

export async function loadConfig() {
  try {
    const mod = await import("/world/config.js");
    S.config = mod.config ?? {};
  } catch {
    S.config = {};
  }
  const c = S.config;
  S.relay = trimSlash((c.reclaimRelay ?? "") || c.agentEndpoint || c.liveRelay || "");
  S.hosted = trimSlash(c.agentEndpoint ?? "");
}

export function loadSettings() {
  const saved = load("settings", {});
  const s = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k === "home") {
      const h = saved?.home;
      if (h && Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.label) s.home = h;
    } else if (Number.isFinite(Number(saved?.[k])) && saved[k] !== null && saved[k] !== "") s[k] = Math.max(0, Number(saved[k]));
  }
  S.settings = s;
  S.overrides = load("overrides", {}) ?? {};
}

export function setSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  save("settings", S.settings);
  emit("settings", S.settings);
}

export function setGrades(data) {
  S.grades = data.grades ?? [];
  S.groups = data.groups ?? [];
  S.sources = data.sources ?? {};
  S.gradeById = new Map(S.grades.map((g) => [g.id, g]));
  S.staleAfterDays = data.reference?.staleAfterDays ?? 45;
}

export function setReference(ref) {
  S.reference = ref;
  recompute();
}

export function setOverride(id, value) {
  if (value === null || value === undefined || value === "") delete S.overrides[id];
  else S.overrides[id] = Math.max(0, Number(value));
  save("overrides", S.overrides);
  recompute();
}
export function clearOverrides() {
  S.overrides = {};
  save("overrides", null);
  recompute();
}

export function recompute() {
  S.prices = priceTable(S.grades, S.reference?.usdPerLb, S.overrides);
  emit("prices", S.prices);
}

export const gradeName = (id) => S.gradeById.get(id)?.name ?? id;
export const gradeShort = (id) => S.gradeById.get(id)?.short ?? S.gradeById.get(id)?.name ?? id;
