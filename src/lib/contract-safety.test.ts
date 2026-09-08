import { describe, expect, it } from "vitest";

import { assessContractSafety } from "@/lib/contract-safety";

const STANDARD_ABI = JSON.stringify([
  "allowance",
  "approve",
  "balanceOf",
  "totalSupply",
  "transfer",
  "transferFrom",
].map((name) => ({ type: "function", name })));

function inspection(overrides: Partial<Parameters<typeof assessContractSafety>[0]> = {}) {
  return {
    isContract: true,
    isScam: false,
    sourceCode: "contract SafeToken {}",
    abi: STANDARD_ABI,
    isProxy: false,
    implementationAddress: null,
    ...overrides,
  };
}

describe("contract safety assessment", () => {
  it("passes a verified ERC-20 without privileged surface", () => {
    const result = assessContractSafety(inspection());

    expect(result.status).toBe("pass");
    expect(result.verified).toBe(true);
    expect(result.erc20InterfacePassed).toBe(true);
  });

  it("blocks a contract carrying a public scam flag", () => {
    const result = assessContractSafety(inspection({ isScam: true }));

    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("Blockscoutの詐欺フラグあり");
  });

  it("blocks unverified or non-standard token contracts", () => {
    expect(
      assessContractSafety(inspection({ sourceCode: "", abi: "" })).status,
    ).toBe("blocked");
    expect(
      assessContractSafety(
        inspection({ abi: JSON.stringify([{ type: "function", name: "transfer" }]) }),
      ).status,
    ).toBe("blocked");
  });

  it("requires review for proxy and privileged control functions", () => {
    const abi = JSON.stringify([
      ...JSON.parse(STANDARD_ABI),
      { type: "function", name: "mint" },
      { type: "function", name: "pause" },
    ]);
    const result = assessContractSafety(
      inspection({ isProxy: true, implementationAddress: "0ximpl", abi }),
    );

    expect(result.status).toBe("review");
    expect(result.privilegedFunctions).toEqual(["mint", "pause"]);
  });
});
