import { describe, expect, it } from "vitest";

import {
  applySafetyControlToRisk,
  environmentEmergencyStop,
} from "@/lib/safety-control";
import type { PortfolioRiskAssessment } from "@/lib/types";

const passingRisk: PortfolioRiskAssessment = {
  status: "pass",
  blockNewBuys: false,
  maxSingleAssetSymbol: null,
  maxSingleAssetPercent: 0,
  maxEthCorrelation: null,
  maxEthCorrelationSymbol: null,
  maxEthCorrelationSampleCount: null,
  minimumCorrelationSampleCount: null,
  correlationMethod: "timestamp-inner-join",
  highCorrelationPairs: [],
  dailyNetPnlUsd: 0,
  dailyLossPercent: 0,
  longestLossStreak: 0,
  currentLossStreak: 0,
  limits: {
    singleAssetPercent: 35,
    correlatedExposurePercent: 50,
    correlation: 0.85,
    dailyLossPercent: 3,
    lossStreak: 3,
  },
  reasons: ["pass"],
};

describe("safety control", () => {
  it.each(["1", "true", "TRUE", "on", "yes"])(
    "recognizes %s as an emergency stop",
    (value) => expect(environmentEmergencyStop(value)).toBe(true),
  );

  it.each([undefined, "", "0", "false", "off", "no"])(
    "recognizes %s as released",
    (value) => expect(environmentEmergencyStop(value)).toBe(false),
  );

  it("fails closed for an unknown environment value", () => {
    expect(environmentEmergencyStop("maybe")).toBeNull();
  });

  it("closes the BUY gate when the persistent stop is active", () => {
    const result = applySafetyControlToRisk(passingRisk, {
      status: "stopped",
      emergencyStop: true,
      source: "redis",
      executionLocked: true,
      reason: "manual stop",
      updatedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(result.status).toBe("blocked");
    expect(result.blockNewBuys).toBe(true);
    expect(result.reasons[0]).toBe("manual stop");
  });

  it("preserves a passing risk assessment while monitoring", () => {
    expect(
      applySafetyControlToRisk(passingRisk, {
        status: "monitoring",
        emergencyStop: false,
        source: "redis",
        executionLocked: true,
        reason: "released",
        updatedAt: null,
      }),
    ).toBe(passingRisk);
  });
});
