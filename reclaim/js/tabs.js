// Tabs: deep-linkable (#scan, #appraise, #prices, #pipeline, #calculator), one
// tablist that is a segmented control on wide screens and a bottom bar on phones.
import { $$, reducedMotion } from "./util.js";
import { emit } from "./state.js";

export const TABS = ["scan", "appraise", "prices", "pipeline", "calculator"];
let current = null;

export function goTab(name, { push = true, focusTab = false } = {}) {
  if (!TABS.includes(name)) name = TABS[0];
  const changed = name !== current;
  current = name;
  for (const t of $$('[role="tab"][data-tab]')) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focusTab) t.focus();
  }
  for (const p of $$('[role="tabpanel"][data-panel]')) p.hidden = p.dataset.panel !== name;
  if (push && location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
  if (changed) {
    document.title = `${name === "scan" ? "Reclaim" : `${name[0].toUpperCase()}${name.slice(1)} · Reclaim`} | Baryon`;
    // Keep the tab bar in view when switching from far down a long panel.
    const app = document.getElementById("rc-app");
    if (app && app.getBoundingClientRect().top < -40) app.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    emit("tab", name);
  }
}

export function initTabs() {
  const tabs = $$('[role="tab"][data-tab]');
  for (const t of tabs) {
    t.addEventListener("click", (e) => { e.preventDefault(); goTab(t.dataset.tab); });
    t.addEventListener("keydown", (e) => {
      const i = TABS.indexOf(t.dataset.tab);
      let j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % TABS.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = TABS.length - 1;
      if (j === null) return;
      e.preventDefault();
      goTab(TABS[j], { focusTab: true });
    });
  }
  // In-page links to #appraise etc. switch tabs instead of jumping.
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.matches('[role="tab"]')) return;
    const name = a.getAttribute("href").slice(1);
    if (TABS.includes(name)) { e.preventDefault(); goTab(name); }
  });
  // Only tab hashes switch tabs; any other fragment is an in-page anchor.
  const fromHash = () => { const h = location.hash.slice(1); if (!h || TABS.includes(h)) goTab(h || TABS[0], { push: false }); };
  window.addEventListener("popstate", fromHash);
  window.addEventListener("hashchange", fromHash);
  const start = location.hash.slice(1);
  goTab(TABS.includes(start) ? start : TABS[0], { push: false });
}
