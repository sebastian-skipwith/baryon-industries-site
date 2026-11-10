// Reclaim app entry: config, settings, prices, then every tab.
import { S, loadConfig, loadSettings } from "./state.js";
import { loadPrices, initPrices } from "./prices.js";
import { initSettings } from "./settings.js";
import { initAISettings, syncChip } from "./ai.js";
import { initCalculator } from "./calculator.js";
import { loadPipeline, initPipeline } from "./pipeline.js";
import { initAppraise } from "./appraise.js";
import { initScan } from "./scan.js";
import { initTabs } from "./tabs.js";
import { esc } from "./util.js";

async function boot() {
  await loadConfig();
  loadSettings();
  loadPipeline();
  try {
    await loadPrices();
  } catch (e) {
    document.getElementById("rc-boot").innerHTML = `<p><b>Reclaim couldn't load its price table.</b> ${esc(e?.message ?? "")} Reload the page to try again.</p>`;
    return;
  }
  initSettings();
  initAISettings();
  initPrices();
  initCalculator();
  initPipeline();
  initAppraise();
  initScan();
  initTabs();
  syncChip();
  document.getElementById("rc-boot")?.remove();
  document.documentElement.dataset.relay = S.relay ? "on" : "off";
  document.getElementById("rc-app").removeAttribute("aria-busy");
}

boot();
