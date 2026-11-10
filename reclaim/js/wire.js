// Wire weight helper: gauge × length × conductors -> pounds of copper, then the
// whole-wire weight for an insulation grade and what it is worth stripped or not.
import { S } from "./state.js";
import { esc, money, lb, num, uid } from "./util.js";
import { WIRE_SIZES, wireCopperLb, grossFromCopper } from "./engine.js";

const INSULATED = ["ins_thhn", "ins_romex", "ins_1", "ins_2", "ins_low", "ins_comm"];

/** Mounts the helper into `root`; onAdd({gradeId, lbLow, lbEst, lbHigh, what}) adds a material row. */
export function mountWireHelper(root, onAdd) {
  const id = uid().slice(0, 6);
  root.innerHTML = `
    <details class="rc-wire">
      <summary><span>Wire weight helper</span><small>gauge × length × conductors → pounds of copper</small></summary>
      <div class="rc-wire-body">
        <div class="rc-wire-grid">
          <label for="w-size-${id}"><span class="eyebrow">Size (AWG / kcmil)</span>
            <select class="input" id="w-size-${id}">${WIRE_SIZES.map((s) => `<option${s === "12" ? " selected" : ""}>${s}</option>`).join("")}</select></label>
          <label for="w-len-${id}"><span class="eyebrow">Length (ft)</span>
            <input class="input" id="w-len-${id}" inputmode="decimal" placeholder="250"></label>
          <label for="w-cond-${id}"><span class="eyebrow">Copper conductors</span>
            <input class="input" id="w-cond-${id}" inputmode="numeric" value="1"></label>
          <label for="w-ins-${id}"><span class="eyebrow">Sold as</span>
            <select class="input" id="w-ins-${id}">${INSULATED.filter((g) => S.gradeById.has(g)).map((g) => `<option value="${g}">${esc(S.gradeById.get(g).short)}</option>`).join("")}<option value="bare">Bare (already stripped)</option></select></label>
        </div>
        <p class="rc-fine">Count every copper conductor: 12/2 with ground is 3. Solid-equivalent weight; stranded runs about 2% heavier.</p>
        <div class="rc-wire-out" id="w-out-${id}" aria-live="polite"></div>
      </div>
    </details>`;
  const q = (s) => root.querySelector(`#${s}-${id}`);
  const out = q("w-out");
  let current = null;
  let lastKey = "";
  // Re-render only when an input really changed: a blur "change" that rebuilt the
  // output would swap the Add button out from under the pointer mid-click.
  const sizeText = () => (/kcmil/.test(q("w-size").value) ? q("w-size").value : `${q("w-size").value} AWG`);
  const calc = (force = false) => {
    const key = [q("w-size").value, q("w-len").value, q("w-cond").value, q("w-ins").value, S.prices.get("cu_bare_bright")?.mid, S.prices.get(q("w-ins").value)?.mid].join("|");
    if (key === lastKey && !force) return;
    lastKey = key;
    const len = num(q("w-len").value);
    const cond = num(q("w-cond").value) ?? 1;
    const cu = wireCopperLb({ size: q("w-size").value, lengthFt: len ?? 0, conductors: cond });
    const r1 = (n) => Math.round(n * 10) / 10;
    if (!cu || !(len > 0)) { out.innerHTML = '<p class="rc-fine">Enter a length to see the copper weight.</p>'; current = null; return; }
    const ins = q("w-ins").value;
    const bb = S.prices.get("cu_bare_bright");
    const strippedVal = bb ? cu * bb.mid : null;
    if (ins === "bare") {
      current = { gradeId: "cu_bare_bright", lbLow: r1(cu), lbEst: r1(cu), lbHigh: r1(cu), what: `${sizeText()} × ${len} ft × ${cond}, bare` };
      out.innerHTML = `<p><b>${lb(cu)}</b> of copper${strippedVal != null ? ` · as bare bright ≈ ${money(strippedVal)}` : ""}</p><button type="button" class="btn btn-ghost btn-sm" data-add>Add to materials</button>`;
    } else {
      const g = S.gradeById.get(ins);
      const gross = grossFromCopper(cu, g.recovery);
      const p = S.prices.get(ins);
      const insVal = p && gross ? gross.est * p.mid : null;
      current = { gradeId: ins, lbLow: r1(gross.low), lbEst: r1(gross.est), lbHigh: r1(gross.high), what: `${sizeText()} × ${len} ft × ${cond}` };
      out.innerHTML = `<p><b>${lb(cu)}</b> of copper ≈ <b>${lb(gross.est)}</b> of ${esc(g.short)} on the scale <span class="soft">(${lb(gross.low)}–${lb(gross.high)})</span></p>
        <p class="rc-fine">Sold insulated ≈ ${money(insVal)} · stripped to bare bright ≈ ${money(strippedVal)}${insVal != null && strippedVal != null ? ` · stripping adds ≈ ${money(strippedVal - insVal)} before your time` : ""}.</p>
        <button type="button" class="btn btn-ghost btn-sm" data-add>Add to materials</button>`;
    }
  };
  root.addEventListener("input", () => calc());
  root.addEventListener("change", () => calc());
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]") && current) onAdd({ ...current });
  });
  calc(true);
}
