import type { ContractSafetyAssessment } from "@/lib/types";

const REQUIRED_ERC20_FUNCTIONS = [
  "allowance",
  "approve",
  "balanceof",
  "totalsupply",
  "transfer",
  "transferfrom",
] as const;

const PRIVILEGED_FUNCTIONS = new Set([
  "addblacklist",
  "blacklist",
  "mint",
  "pause",
  "setblacklist",
  "setbuytax",
  "setfee",
  "setfees",
  "setselltax",
  "settax",
  "unpause",
  "upgradeto",
  "upgradetoandcall",
]);

export interface ContractInspection {
  isContract: boolean;
  isScam: boolean;
  sourceCode: string;
  abi: string;
  isProxy: boolean;
  implementationAddress: string | null;
}

function abiFunctionNames(abi: string): string[] {
  try {
    const parsed: unknown = JSON.parse(abi);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { type: string; name: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          "name" in item &&
          item.type === "function" &&
          typeof item.name === "string",
      )
      .map((item) => item.name.toLowerCase());
  } catch {
    return [];
  }
}

export function unavailableContractSafety(
  reason = "コントラクト情報を取得できないため新規BUYを停止",
): ContractSafetyAssessment {
  return {
    status: "unavailable",
    source: "blockscout",
    verified: null,
    isContract: null,
    isScam: null,
    isProxy: null,
    implementationAddress: null,
    erc20InterfacePassed: null,
    privilegedFunctions: [],
    reasons: [reason],
  };
}

export function assessContractSafety(
  inspection: ContractInspection,
): ContractSafetyAssessment {
  const functions = abiFunctionNames(inspection.abi);
  const functionSet = new Set(functions);
  const verified = inspection.sourceCode.trim().length > 0 && functions.length > 0;
  const erc20InterfacePassed = REQUIRED_ERC20_FUNCTIONS.every((name) =>
    functionSet.has(name),
  );
  const privilegedFunctions = [...new Set(
    functions.filter((name) => PRIVILEGED_FUNCTIONS.has(name)),
  )].toSorted();
  const blockers: string[] = [];
  const reviews: string[] = [];
  const passes: string[] = [];

  if (!inspection.isContract) blockers.push("EOAまたはコントラクト未検出");
  if (inspection.isScam) blockers.push("Blockscoutの詐欺フラグあり");
  if (!verified) blockers.push("ソースコードまたはABIが未検証");
  if (verified && !erc20InterfacePassed) blockers.push("ERC-20必須関数が不足");
  if (inspection.isProxy) reviews.push("Proxyで実装変更の可能性あり");
  if (privilegedFunctions.length > 0) {
    reviews.push(`管理関数を検出: ${privilegedFunctions.join(", ")}`);
  }
  if (verified) passes.push("検証済みソースとABIを確認");
  if (erc20InterfacePassed) passes.push("ERC-20必須関数を確認");

  return {
    status:
      blockers.length > 0
        ? "blocked"
        : reviews.length > 0
          ? "review"
          : "pass",
    source: "blockscout",
    verified,
    isContract: inspection.isContract,
    isScam: inspection.isScam,
    isProxy: inspection.isProxy,
    implementationAddress: inspection.implementationAddress,
    erc20InterfacePassed,
    privilegedFunctions,
    reasons:
      blockers.length > 0
        ? blockers
        : reviews.length > 0
          ? [...passes, ...reviews]
          : passes,
  };
}
