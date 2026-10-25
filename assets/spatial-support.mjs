// Prospective group-count planning only. No source data, seeds or audit APIs.
export const PARTITIONS = Object.freeze(['train', 'validation', 'audit']);
export const LIMITS = Object.freeze({groups: 1000, minimum: 64, weight: 100});

function integer(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer from 0 to ${maximum}.`);
  }
}

function vector(value, maximum, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} needs three entries: train, validation, audit.`);
  value.forEach((v, i) => integer(v, maximum, `${label}[${i}]`));
  return [...value];
}

function fraction(numerator, denominator) {
  // Bounded display approximation; retain exact integer ratios, including tiny tails.
  return {numerator: String(numerator), denominator: String(denominator),
    approximate: Number(numerator * 1000000000000000n / denominator) / 1e15};
}

export function formatProbability(value) {
  const n = BigInt(value.numerator), d = BigInt(value.denominator);
  if (n === 0n) return '0%';
  if (n === d) return '100%';
  if (n * 10000n < d) return '<0.01%';
  if (n * 10000n > d * 9999n) return '>99.99%';
  return `${(Math.round(value.approximate * 10000) / 100).toFixed(2)}%`;
}

export function planSpatialSupport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'groups,minimums,weights') {
    throw new Error('Supply only groups, minimums and weights. Sources and seeds are not accepted.');
  }
  integer(input.groups, LIMITS.groups, 'Group count');
  const n = input.groups;
  const minimums = vector(input.minimums, LIMITS.minimum, 'Minimums');
  const weights = vector(input.weights, LIMITS.weight, 'Weights');
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error('At least one allocation weight must be positive.');
  const powers = new Map();
  function power(base) {
    if (!powers.has(base)) {
      const row = [1n];
      for (let i = 1; i <= n; i++) row.push(row.at(-1) * BigInt(base));
      powers.set(base, row);
    }
    return powers.get(base);
  }
  const denominator = power(total)[n];
  function lowerTail(i) {
    let sum = 0n, choose = 1n;
    for (let k = 0; k < minimums[i] && k <= n; k++) {
      sum += choose * power(weights[i])[k] * power(total - weights[i])[n-k];
      choose = choose * BigInt(n-k) / BigInt(k+1);
    }
    return sum;
  }
  function pairLowerTail(i, j) {
    let sum = 0n, chooseA = 1n;
    for (let a = 0; a < minimums[i] && a <= n; a++) {
      let chooseB = 1n;
      for (let b = 0; b < minimums[j] && a+b <= n; b++) {
        sum += chooseA * chooseB * power(weights[i])[a] * power(weights[j])[b] * power(total-weights[i]-weights[j])[n-a-b];
        chooseB = chooseB * BigInt(n-a-b) / BigInt(b+1);
      }
      chooseA = chooseA * BigInt(n-a) / BigInt(a+1);
    }
    return sum;
  }
  const tails = weights.map((_, i) => lowerTail(i));
  // When n >= sum(minimums), all three lower-tail events cannot intersect.
  // Otherwise success is impossible, so no inclusion-exclusion correction is needed.
  const feasibleByCount = n >= minimums.reduce((a, b) => a + b, 0);
  const success = feasibleByCount ? denominator - tails.reduce((a,b) => a+b, 0n) +
    pairLowerTail(0,1) + pairLowerTail(0,2) + pairLowerTail(1,2) : 0n;
  if (success < 0n || success > denominator) throw new Error('Internal probability accounting failed.');
  return {
    schemaVersion: 1, kind: 'prospective_spatial_support_plan',
    input: {groups:n, minimums, weights},
    assumption: 'Each not-yet-allocated group is independently assigned with probabilities proportional to the supplied integer weights. This is a planning model, not measured randomness or geological independence.',
    method: 'Exact multinomial inclusion-exclusion over integer counts. Decimal display is approximate; integer ratios are exact under the stated assumptions.',
    feasibleByTotalGroupCount: feasibleByCount,
    allMinimumsBeforeBuffers: fraction(success, denominator),
    anyMinimumMissedBeforeBuffers: fraction(denominator-success, denominator),
    partitions: PARTITIONS.map((name,i) => ({name,minimumGroups:minimums[i],
      allocationProbability:fraction(BigInt(weights[i]),BigInt(total)),
      expectedGroups:n*weights[i]/total, belowMinimumBeforeBuffers:fraction(tails[i],denominator)})),
    interpretation: 'Pre-buffer group-count success is an upper bound for a process that only removes memberships. Sample minima, buffer losses, spatial dependence, source eligibility and model power remain unchecked. No pass/fail recommendation or experiment registration is produced.',
    safeguards: {empiricalResult:false,modelImprovement:false,sourceDataRead:false,auditStateChanged:false,
      sampleMinimaChecked:false,postBufferFeasibility:'unknown',scientificIndependence:'not_established'},
    usage: 'Use prospectively before a distinct cohort and protocol are committed. Do not search seeds, retry a stopped design, weaken committed gates, or reuse exposed audits. A deterministic committed split already has fixed counts; this calculator does not assign it a new success probability.'
  };
}
