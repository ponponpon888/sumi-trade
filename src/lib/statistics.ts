function logGamma(value: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let sum = coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    sum += coefficients[index] / (shifted + index);
  }
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let result = d;
  for (let m = 1; m <= 300; m += 1) {
    const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + even * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + even / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    result *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + odd * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + odd / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    result *= step;
    if (Math.abs(step - 1) < 1e-14) break;
  }
  return result;
}

/** Regularized incomplete beta function I_x(a, b). */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-sided tail probability P(|T| > t) of Student's t distribution. */
function studentTwoSidedTail(t: number, degreesOfFreedom: number): number {
  return regularizedBeta(
    degreesOfFreedom / (degreesOfFreedom + t * t),
    degreesOfFreedom / 2,
    0.5,
  );
}

/**
 * Critical value c with P(|T| > c) = 1 - confidence for Student's t with the
 * given (possibly fractional) degrees of freedom.
 */
export function studentTCritical(confidence: number, degreesOfFreedom: number): number {
  const alpha = 1 - confidence;
  let low = 0;
  let high = 1_000;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTwoSidedTail(middle, degreesOfFreedom) > alpha) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function clusterMeans(values: Array<{ key: string; value: number }>): number[] {
  const byKey = new Map<string, number[]>();
  for (const item of values) {
    const group = byKey.get(item.key) ?? [];
    group.push(item.value);
    byKey.set(item.key, group);
  }
  return [...byKey.values()].map(
    (group) => group.reduce((total, value) => total + value, 0) / group.length,
  );
}

function meanAndVariance(values: number[]): { mean: number; variance: number } {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return { mean, variance };
}

/**
 * Student-t interval of the mean, treating all values that share a key
 * (for example one scan time) as a single sample because they move together.
 */
export function clusteredMeanInterval(
  values: Array<{ key: string; value: number }>,
  confidence = 0.95,
): { independentSampleCount: number; mean: number | null; low: number | null; high: number | null } {
  const means = clusterMeans(values);
  const count = means.length;
  if (count < 2) {
    return {
      independentSampleCount: count,
      mean: count ? means[0] : null,
      low: null,
      high: null,
    };
  }
  const { mean, variance } = meanAndVariance(means);
  const margin = studentTCritical(confidence, count - 1) * Math.sqrt(variance / count);
  return { independentSampleCount: count, mean, low: mean - margin, high: mean + margin };
}

/**
 * Welch interval of mean(left) - mean(right), each side clustered by key as in
 * clusteredMeanInterval.
 */
export function clusteredDifferenceInterval(
  left: Array<{ key: string; value: number }>,
  right: Array<{ key: string; value: number }>,
  confidence = 0.95,
): {
  leftSampleCount: number;
  rightSampleCount: number;
  difference: number | null;
  low: number | null;
  high: number | null;
} {
  const leftMeans = clusterMeans(left);
  const rightMeans = clusterMeans(right);
  const counts = { leftSampleCount: leftMeans.length, rightSampleCount: rightMeans.length };
  if (leftMeans.length < 2 || rightMeans.length < 2) {
    return { ...counts, difference: null, low: null, high: null };
  }
  const l = meanAndVariance(leftMeans);
  const r = meanAndVariance(rightMeans);
  const difference = l.mean - r.mean;
  const leftTerm = l.variance / leftMeans.length;
  const rightTerm = r.variance / rightMeans.length;
  const standardError = Math.sqrt(leftTerm + rightTerm);
  if (standardError === 0) {
    return { ...counts, difference, low: difference, high: difference };
  }
  const degreesOfFreedom =
    (leftTerm + rightTerm) ** 2 /
    (leftTerm ** 2 / (leftMeans.length - 1) + rightTerm ** 2 / (rightMeans.length - 1));
  const margin = studentTCritical(confidence, degreesOfFreedom) * standardError;
  return { ...counts, difference, low: difference - margin, high: difference + margin };
}
