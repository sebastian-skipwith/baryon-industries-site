// Deterministic scenario arithmetic. Percent inputs use 0–100; masses are metric tonnes.
// Payability is a commercial basis, not a downstream physical recovery.
export const SUPPLY_MODEL_VERSION = 'copper-balance-v1';
export const INPUTS = Object.freeze({
  tonnesPerDay: { label: 'Ore throughput', unit: 't/day', min: 0, max: 1e9 },
  availabilityPct: { label: 'Plant availability', unit: '%', min: 0, max: 100 },
  headGradePct: { label: 'Ore copper grade', unit: '% Cu', min: 0, max: 100 },
  recoveryPct: { label: 'Copper recovery', unit: '%', min: 0, max: 100 },
  concentrateGradePct: { label: 'Concentrate grade', unit: '% Cu', min: 0, max: 100, exclusiveMin: true },
  payablePct: { label: 'Effective payability', unit: '%', min: 0, max: 100 },
  targetTonnes: { label: 'Annual payable copper target', unit: 't Cu/year', min: 0, max: 1e12 },
});

export function calculateCopperSupply(input) {
  const errors = [];
  for (const [key, rule] of Object.entries(INPUTS)) {
    const value = input?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max || (rule.exclusiveMin && value === rule.min)) {
      errors.push(`${rule.label}: enter a finite number ${rule.exclusiveMin ? 'greater than' : 'at least'} ${rule.min} and at most ${rule.max}.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  if (input.concentrateGradePct < input.headGradePct) return { ok: false, errors: ['This concentrator scenario requires concentrate grade at least as high as ore grade.'] };
  const oreTonnes = input.tonnesPerDay * 365 * input.availabilityPct / 100;
  const containedCopperTonnes = oreTonnes * input.headGradePct / 100;
  const recoveredCopperTonnes = containedCopperTonnes * input.recoveryPct / 100;
  const concentrateDryTonnes = recoveredCopperTonnes / (input.concentrateGradePct / 100);
  // No externally added dry solids are represented by this simplified flowsheet.
  if (concentrateDryTonnes > oreTonnes + 1e-8) return { ok: false, errors: ['These grades and recovery imply more dry concentrate than ore feed. Revise the assumptions.'] };
  const payableCopperTonnes = recoveredCopperTonnes * input.payablePct / 100;
  const ceiling = containedCopperTonnes * input.payablePct / 100;
  const requiredRecoveryPct = ceiling > 0 ? input.targetTonnes / ceiling * 100 : input.targetTonnes === 0 ? 0 : null;
  return {
    ok: true, kind: 'scenario', modelVersion: SUPPLY_MODEL_VERSION, calendarDays: 365,
    oreTonnes, containedCopperTonnes, recoveredCopperTonnes, concentrateDryTonnes,
    residualCopperTonnes: containedCopperTonnes - recoveredCopperTonnes,
    payableCopperTonnes, targetTonnes: input.targetTonnes,
    targetGapTonnes: payableCopperTonnes - input.targetTonnes,
    targetMet: payableCopperTonnes >= input.targetTonnes,
    requiredRecoveryPct,
    targetPossibleAtFullRecovery: input.targetTonnes <= ceiling,
    actualProductionTonnes: null, deliverableRefinedTonnes: null, firstDeliveryDate: null,
  };
}

export function scenarioPreset(evidence, preset = 'later') {
  if (!['early', 'later', 'optimization'].includes(preset)) throw new Error('Unknown supply preset');
  const f = evidence.facts;
  return {
    tonnesPerDay: f[preset === 'early' ? 'earlyThroughput' : 'laterThroughput'].value,
    availabilityPct: f[preset === 'early' ? 'earlyAvailability' : 'laterAvailability'].value,
    headGradePct: f.reserveGrade.value,
    recoveryPct: f[preset === 'optimization' ? 'proposedRecovery' : 'studyRecovery'].value,
    concentrateGradePct: f[preset === 'optimization' ? 'proposedConcentrateGrade' : 'studyConcentrateGrade'].value,
    payablePct: f.payability.value,
    targetTonnes: 30000,
  };
}

// Transparent investigation ordering; no learned utility score or automated acquisition claim.
export function nextSupplyInvestigations(result) {
  if (!result.ok) return [];
  return [
    { id: 'development', question: 'When could any supply become available?', action: 'Reconcile dated permit records, financing milestones and the construction schedule.', reason: 'A mass balance does not establish an operating date.' },
    { id: 'delivery', question: 'Can concentrate become usable delivered copper?', action: 'Verify smelter/refinery acceptance, offtake terms, transport capacity and product specifications.', reason: 'Payable copper is not refined metal delivered to a buyer.' },
    { id: 'process', question: result.targetMet ? 'Is this scenario sustainable across the mine plan?' : 'What would close the scenario target gap?', action: result.targetPossibleAtFullRecovery ? 'Review the annual mine schedule and representative metallurgical variability tests.' : 'Review throughput and feed grade: recovery alone cannot meet this target.', reason: 'Reserve-average grade and study design values do not establish annual operating performance.' },
  ];
}
