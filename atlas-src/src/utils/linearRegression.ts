export interface RegressionResult {
  /** Gradient, in y-units per x-unit. */
  slope: number;
  /** Intercept at x = 0. */
  intercept: number;
  /** Coefficient of determination. */
  r2: number;
  /** Residual standard deviation, in y-units. */
  sigma: number;
  n: number;
}

export const EMPTY_REGRESSION: RegressionResult = {
  slope: Number.NaN,
  intercept: Number.NaN,
  r2: Number.NaN,
  sigma: Number.NaN,
  n: 0,
};

/**
 * Ordinary least squares.
 *
 *   m = Σ (x_i - x̄)(y_i - ȳ) / Σ (x_i - x̄)²
 *   b = ȳ - m x̄
 */
export function linearRegression(xs: number[], ys: number[]): RegressionResult {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { ...EMPTY_REGRESSION, n };

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }
  if (sxx === 0) return { ...EMPTY_REGRESSION, n };

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i];
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }

  return {
    slope,
    intercept,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    sigma: n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0,
    n,
  };
}

/**
 * Drops points more than `k` residual standard deviations from the fit and
 * refits. One pass is enough to remove a traffic lap that survived the
 * interval filter without eating into genuine degradation.
 */
export function robustRegression(
  xs: number[],
  ys: number[],
  k = 2.5,
): { fit: RegressionResult; keptIndices: number[] } {
  const first = linearRegression(xs, ys);
  if (!Number.isFinite(first.slope) || first.sigma === 0) {
    return { fit: first, keptIndices: xs.map((_, i) => i) };
  }

  const kept: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const residual = Math.abs(ys[i] - (first.intercept + first.slope * xs[i]));
    if (residual <= k * first.sigma) kept.push(i);
  }
  if (kept.length < 3 || kept.length === xs.length) {
    return { fit: first, keptIndices: kept.length >= 3 ? kept : xs.map((_, i) => i) };
  }

  return {
    fit: linearRegression(
      kept.map((i) => xs[i]),
      kept.map((i) => ys[i]),
    ),
    keptIndices: kept,
  };
}
