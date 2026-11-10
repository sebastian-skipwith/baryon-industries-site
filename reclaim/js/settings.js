// Home base & costs: a compact bar that opens into an inline editor. Saved in this
// browser; every appraisal, triage, scan and calculation reads from it.
import { S, on, setSettings } from "./state.js";
import { $, esc, debounce, money, announce, ICON } from "./util.js";
import { searchPlaces, reversePlace } from "./geo.js";

const FIELDS = [
  ["radiusMi", "Scan radius", "mi", 1, 200, 1, "How far from home a listing may be."],
  ["costPerMile", "Vehicle cost", "$/mi", 0, 10, 0.01, "Fuel and wear per mile. A gas half-ton pickup runs about $0.45–0.55; the 2026 IRS rate, which adds depreciation and insurance, is $0.76."],
  ["laborPerHour", "Your time", "$/h", 0, 500, 1, "What an hour of driving, loading and stripping is worth to you."],
  ["driveMph", "Average driving speed", "mph", 0, 90, 1, "Driving time = round-trip miles ÷ this, paid at your hourly rate. 0 leaves driving time out."],
  ["riskPct", "Risk reserve", "% of gross", 0, 80, 1, "Held back for short weights, rejected material and surprises."],
  ["targetNet", "Buy when net ≥", "$", 0, 100000, 1, "Expected net needed for a BUY or GRAB."],
  ["targetRoi", "and return ≥", "%", 0, 1000, 1, "Net as a share of cash out (price, miles, time, fees). 0 turns it off."],
];

export function settingsSummary() {
  const s = S.settings;
  return `${s.home ? esc(s.home.label) : "No home base"} · ${s.radiusMi} mi · $${Number(s.costPerMile).toFixed(2)}/mi · ${money(s.laborPerHour)}/h${s.driveMph > 0 ? " incl. driving" : ""} · ${s.riskPct}% risk · buy at ${money(s.targetNet)}+${s.targetRoi > 0 ? ` & ${s.targetRoi}%` : ""}`;
}

export function initSettings() {
  const bar = $("#rc-settings");
  bar.innerHTML = `
    <div class="rc-sbar">
      <button type="button" class="rc-sbar-main" id="settings-toggle" aria-expanded="false" aria-controls="settings-panel">
        <span class="rc-sbar-ic">${ICON.pin}</span>
        <span class="rc-sbar-text"><span class="eyebrow">Home base & costs</span><span class="rc-sbar-sum" id="settings-sum"></span></span>
        <span class="rc-sbar-edit">Edit</span>
      </button>
      <button type="button" class="rc-ai-chip" data-open-ai data-ai-state="off" aria-haspopup="dialog">${ICON.sparkle}<span data-ai-label>AI off</span></button>
    </div>
    <div class="rc-spanel" id="settings-panel" hidden>
      <div class="rc-home">
        <label class="eyebrow" for="home-input">Home base</label>
        <div class="rc-home-row">
          <div class="rc-combo">
            <input id="home-input" class="input" type="text" autocomplete="off" spellcheck="false" placeholder="Town or city, e.g. Frederick, MD"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="home-list" aria-describedby="home-status">
            <ul id="home-list" class="rc-listbox" role="listbox" aria-label="Matching places" hidden></ul>
          </div>
          <button type="button" class="btn btn-ghost" id="home-locate">${ICON.locate}<span>Use my location</span></button>
        </div>
        <p class="rc-fine" id="home-status" aria-live="polite"></p>
      </div>
      <div class="rc-sfields">
        ${FIELDS.map(([k, label, unit, min, max, step, hint]) => `
          <label class="rc-sfield" for="set-${k}">
            <span class="rc-sfield-l">${label} <small>${unit}</small></span>
            <input class="input" id="set-${k}" data-key="${k}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}">
            <span class="rc-fine">${hint}</span>
          </label>`).join("")}
      </div>
      <div class="rc-spanel-foot"><p class="rc-fine">Saved in this browser only. Distances are straight-line between town centres; trip costs use that × 1.2 for roads (at least 2 mi each way), there and back.</p><button type="button" class="btn btn-primary btn-sm" id="settings-done">Done</button></div>
    </div>`;

  const toggle = $("#settings-toggle");
  const panel = $("#settings-panel");
  const setOpen = (open, focus = true) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open && focus) (S.settings.home ? $("#set-radiusMi") : $("#home-input")).focus();
    if (!open && focus) toggle.focus();
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  $("#settings-done").addEventListener("click", () => setOpen(false));
  document.addEventListener("click", (e) => { if (e.target.closest("[data-open-settings]")) { e.preventDefault(); setOpen(true); panel.scrollIntoView({ block: "nearest" }); } });

  for (const inp of panel.querySelectorAll("input[data-key]")) {
    inp.value = S.settings[inp.dataset.key];
    inp.addEventListener("change", () => {
      const v = Number(inp.value);
      const min = Number(inp.min), max = Number(inp.max);
      if (inp.value.trim() === "" || !Number.isFinite(v) || v < min || v > max) {
        inp.setCustomValidity(`Enter a number from ${min} to ${max}.`);
        inp.reportValidity();
        return;
      }
      inp.setCustomValidity("");
      setSettings({ [inp.dataset.key]: v });
    });
  }
  initHome();
  renderSummary();
  on("settings", renderSummary);
}

function renderSummary() {
  const el = $("#settings-sum");
  if (el) el.innerHTML = settingsSummary();
  const hi = $("#home-input");
  if (hi && document.activeElement !== hi) hi.value = S.settings.home?.label ?? "";
}

function initHome() {
  const input = $("#home-input");
  const list = $("#home-list");
  const status = $("#home-status");
  let options = [];
  let active = -1;
  let ctl = null;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const choose = (p) => {
    if (!p) return;
    if (p.country && p.country !== "US") status.textContent = `${p.label} is outside the US. Marketplace scans cover US listings only.`;
    else status.textContent = `Home base set to ${p.label}.`;
    setSettings({ home: { label: p.label, city: p.city, st: p.st, lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)), country: p.country ?? "US" } });
    input.value = p.label;
    close();
    announce(`Home base set to ${p.label}.`);
  };
  const paint = () => {
    list.innerHTML = options.map((p, i) => `<li role="option" id="home-opt-${i}" class="rc-option${i === active ? " is-active" : ""}" aria-selected="${i === active}" data-i="${i}"><b>${esc(p.label)}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : ""}</li>`).join("");
    list.hidden = !options.length;
    input.setAttribute("aria-expanded", String(!!options.length));
    if (active >= 0) input.setAttribute("aria-activedescendant", `home-opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const lookup = debounce(async (q) => {
    ctl?.abort();
    ctl = new AbortController();
    try {
      status.textContent = "Searching…";
      options = await searchPlaces(q, { bias: S.settings.home, signal: ctl.signal });
      active = -1;
      status.textContent = options.length ? `${options.length} match${options.length === 1 ? "" : "es"}. Use the arrow keys to choose.` : "No matching place. Try “Town, ST”.";
      paint();
    } catch (e) {
      if (e?.name !== "AbortError") status.textContent = "Place search is unavailable right now. Try again in a moment.";
    }
  }, 400);
  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q.length < 3) { options = []; paint(); status.textContent = ""; return; }
    lookup(q);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && options.length) { e.preventDefault(); active = (active + 1) % options.length; paint(); }
    else if (e.key === "ArrowUp" && options.length) { e.preventDefault(); active = (active - 1 + options.length) % options.length; paint(); }
    else if (e.key === "Enter") { if (options.length) { e.preventDefault(); choose(options[Math.max(0, active)]); } }
    else if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } }
  });
  input.addEventListener("blur", () => setTimeout(close, 180));
  list.addEventListener("pointerdown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) choose(options[Number(li.dataset.i)]); });

  $("#home-locate").addEventListener("click", () => {
    if (!navigator.geolocation) { status.textContent = "This browser can't share its location. Type your town instead."; return; }
    status.textContent = "Asking the browser for your location…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const p = await reversePlace(Number(latitude.toFixed(4)), Number(longitude.toFixed(4)));
        if (p) choose(p);
        else choose({ label: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`, lat: latitude, lng: longitude, country: null });
      } catch {
        status.textContent = "Found your position, but couldn't name the town. Type it instead.";
      }
    }, (err) => {
      status.textContent = err.code === 1 ? "Location permission was declined. Type your town instead." : "Couldn't get your location. Type your town instead.";
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  });
}
