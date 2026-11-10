// Small shared helpers: DOM, formatting, storage (always try/catch), toasts.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** "$1,234", "−$80", or "—" for missing values. */
export function money(n, { cents = false } = {}) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const s = cents && abs < 100 ? abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(abs).toLocaleString("en-US");
  return `${v < 0 && (cents ? abs >= 0.005 : Math.round(abs) !== 0) ? "−" : ""}$${s}`;
}
export const perLb = (n) => (Number.isFinite(n) ? `$${Number(n).toFixed(2)}/lb` : "—");
export const range = (lo, hi, f = money) => (Math.round(lo) === Math.round(hi) ? f(lo) : `${f(lo)} to ${f(hi)}`);
export const lb = (n) => (Number.isFinite(n) ? `${n >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(1))} lb` : "—");
export const pct = (f) => (f === null || f === undefined || !Number.isFinite(f) ? "—" : `${Math.round(f * 100)}%`);
export const mi = (n) => (Number.isFinite(n) ? `${n < 10 ? n.toFixed(1) : Math.round(n)} mi` : "—");

export function daysSince(iso) {
  const t = Date.parse(String(iso ?? "").length === 7 ? `${iso}-01` : iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
}
export function fmtDate(iso) {
  const t = Date.parse(String(iso ?? "").length === 7 ? `${iso}-01` : iso);
  if (!Number.isFinite(t)) return String(iso ?? "");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return String(v ?? "").trim() === "" || !Number.isFinite(n) ? null : n;
};
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ storage */
const NS = "baryon.reclaim.";
export function load(key, fallback = null, { raw = false } = {}) {
  try {
    const v = localStorage.getItem(raw ? key : NS + key);
    if (v === null) return fallback;
    return raw ? v : JSON.parse(v);
  } catch { return fallback; }
}
export function save(key, value, { raw = false } = {}) {
  try {
    const k = raw ? key : NS + key;
    if (value === null || value === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, raw ? String(value) : JSON.stringify(value));
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ toasts + live region */
export function announce(text) {
  const el = document.getElementById("rc-live");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}
export function toast(text, { kind = "info", ms = 3600 } = {}) {
  const box = document.getElementById("rc-toasts");
  if (!box) return;
  const t = document.createElement("div");
  t.className = `rc-toast${kind === "error" ? " is-error" : ""}`;
  t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.textContent = text;
  box.append(t);
  setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 300); }, ms);
}

/** Downloads text as a file (export). */
export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shrinks an image Blob to a JPEG no longer than maxEdge, returned as {data (base64), mediaType, width, height}. */
export async function imageToBase64(blob, maxEdge = 1568, quality = 0.85) {
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file is not an image this browser can read.")); };
      img.src = url;
    });
  }
  const w0 = bmp.width, h0 = bmp.height;
  const s = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const url = c.toDataURL("image/jpeg", quality);
  return { data: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg", width: w, height: h, preview: url };
}

export const ICON = {
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  locate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  sparkle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3.5l1.7 5a2.4 2.4 0 0 0 1.5 1.5l5 1.7-5 1.7a2.4 2.4 0 0 0-1.5 1.5l-1.7 5-1.7-5a2.4 2.4 0 0 0-1.5-1.5l-5-1.7 5-1.7a2.4 2.4 0 0 0 1.5-1.5z"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 5.22L10.43 2.83L13.57 2.83L14.1 5.22L15.31 5.72L17.37 4.41L19.59 6.63L18.28 8.69L18.78 9.9L21.17 10.43L21.17 13.57L18.78 14.1L18.28 15.31L19.59 17.37L17.37 19.59L15.31 18.28L14.1 18.78L13.57 21.17L10.43 21.17L9.9 18.78L8.69 18.28L6.63 19.59L4.41 17.37L5.72 15.31L5.22 14.1L2.83 13.57L2.83 10.43L5.22 9.9L5.72 8.69L4.41 6.63L6.63 4.41L8.69 5.72Z"/><circle cx="12" cy="12" r="3"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  ext: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  photo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10.5" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
  // tab icons
  scan: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  appraise: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3.5l1.7 5a2.4 2.4 0 0 0 1.5 1.5l5 1.7-5 1.7a2.4 2.4 0 0 0-1.5 1.5l-1.7 5-1.7-5a2.4 2.4 0 0 0-1.5-1.5l-5-1.7 5-1.7a2.4 2.4 0 0 0 1.5-1.5z"/></svg>',
  prices: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M7.5 15l3.5-4 3 2.5L19 8"/></svg>',
  pipeline: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="5" height="16" rx="1.6"/><rect x="10" y="4" width="5" height="11" rx="1.6"/><rect x="16.5" y="4" width="4" height="7" rx="1.6"/></svg>',
  calculator: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
};
