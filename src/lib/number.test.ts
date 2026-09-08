import { describe, expect, it } from "vitest";

import { unitsToNumber } from "@/lib/number";

describe("unitsToNumber", () => {
  it("formats an ERC-20 integer without losing the decimal boundary", () => {
    expect(unitsToNumber("23799420179007823759230803", 18)).toBeCloseTo(
      23_799_420.179007825,
      6,
    );
  });

  it("formats an ETH balance", () => {
    expect(unitsToNumber("8875262267999319", 18)).toBeCloseTo(
      0.008875262267999319,
      12,
    );
  });
});
