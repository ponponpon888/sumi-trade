import { describe, expect, it } from "vitest";

import {
  clusteredDifferenceInterval,
  clusteredMeanInterval,
  studentTCritical,
} from "@/lib/statistics";

describe("studentTCritical", () => {
  it.each([
    [1, 12.706],
    [4, 2.776],
    [9, 2.262],
    [30, 2.042],
    [1_000, 1.962],
  ])("matches the 95%% table for %i degrees of freedom", (df, expected) => {
    expect(studentTCritical(0.95, df)).toBeCloseTo(expected, 2);
  });

  it("widens for a stricter confidence level", () => {
    expect(studentTCritical(0.99, 10)).toBeCloseTo(3.169, 2);
    expect(studentTCritical(1 - 0.05 / 6, 20)).toBeGreaterThan(studentTCritical(0.95, 20));
  });

  it("accepts fractional degrees of freedom", () => {
    const value = studentTCritical(0.95, 9.5);
    expect(value).toBeLessThan(studentTCritical(0.95, 9));
    expect(value).toBeGreaterThan(studentTCritical(0.95, 10));
  });
});

describe("clustered intervals", () => {
  it("averages values that share a key before computing the interval", () => {
    const result = clusteredMeanInterval([
      { key: "a", value: 1 },
      { key: "a", value: 3 },
      { key: "b", value: 2 },
    ]);
    expect(result).toMatchObject({ independentSampleCount: 2, mean: 2, low: 2, high: 2 });
  });

  it("compares two groups with a Welch interval", () => {
    const left = Array.from({ length: 10 }, (_, index) => ({ key: `l${index}`, value: 2 + (index % 2) }));
    const right = Array.from({ length: 10 }, (_, index) => ({ key: `r${index}`, value: -1 + (index % 2) }));
    const result = clusteredDifferenceInterval(left, right);
    expect(result.difference).toBeCloseTo(3);
    expect(result.low!).toBeGreaterThan(2);
    expect(result.high!).toBeLessThan(4);
  });

  it("needs two clusters on each side", () => {
    expect(clusteredDifferenceInterval([{ key: "a", value: 1 }], [
      { key: "b", value: 1 },
      { key: "c", value: 2 },
    ])).toMatchObject({ difference: null, low: null });
  });
});
