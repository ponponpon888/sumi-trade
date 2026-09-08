import { z } from "zod";

import { BLOCKSCOUT_ORIGIN } from "@/lib/config";
import {
  assessContractSafety,
  unavailableContractSafety,
} from "@/lib/contract-safety";
import type { ContractSafetyAssessment } from "@/lib/types";

const addressSchema = z.object({
  hash: z.string(),
  coin_balance: z.string(),
  exchange_rate: z.string().nullable(),
  is_contract: z.boolean(),
  is_scam: z.boolean(),
});

const tokenBalanceSchema = z.array(
  z.object({
    value: z.string(),
    token: z.object({
      address_hash: z.string(),
      decimals: z.string(),
      exchange_rate: z.string().nullable(),
      name: z.string(),
      reputation: z.string().nullable(),
      symbol: z.string(),
      type: z.string(),
      volume_24h: z.string().nullable(),
    }),
  }),
);

const contractSourceSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.array(
    z.object({
      SourceCode: z.string().catch(""),
      ABI: z.string().catch(""),
      Proxy: z.string().catch("0"),
      Implementation: z.string().catch(""),
    }),
  ),
});

export type BlockscoutAddress = z.infer<typeof addressSchema>;
export type BlockscoutTokenBalance = z.infer<typeof tokenBalanceSchema>[number];

async function readPublicJson<T>(
  url: string,
  schema: z.ZodType<T>,
  revalidate = 60,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SUMI-Trade-Lab/0.1 read-only",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Public chain data request failed (${response.status}).`);
  }

  return schema.parse(await response.json());
}

async function getContractSafety(
  contractAddress: string,
): Promise<ContractSafetyAssessment> {
  try {
    const encodedAddress = encodeURIComponent(contractAddress);
    const [address, source] = await Promise.all([
      readPublicJson(
        `${BLOCKSCOUT_ORIGIN}/api/v2/addresses/${encodedAddress}`,
        addressSchema,
        86_400,
      ),
      readPublicJson(
        `${BLOCKSCOUT_ORIGIN}/api/?module=contract&action=getsourcecode&address=${encodedAddress}`,
        contractSourceSchema,
        86_400,
      ),
    ]);
    const result = source.result[0];
    if (!result || source.status !== "1") {
      return unavailableContractSafety("検証済みコントラクト情報が見つからないため新規BUYを停止");
    }

    return assessContractSafety({
      isContract: address.is_contract,
      isScam: address.is_scam,
      sourceCode: result.SourceCode,
      abi: result.ABI,
      isProxy: result.Proxy === "1",
      implementationAddress: result.Implementation.trim() || null,
    });
  } catch {
    return unavailableContractSafety();
  }
}

export async function getContractSafetyAssessments(
  contractAddresses: string[],
): Promise<Map<string, ContractSafetyAssessment>> {
  const unique = [...new Set(contractAddresses.map((address) => address.toLowerCase()))];
  const assessments = await Promise.all(
    unique.map(async (address) => [address, await getContractSafety(address)] as const),
  );
  return new Map(assessments);
}

export async function getBlockscoutPortfolio(address: string): Promise<{
  account: BlockscoutAddress;
  tokenBalances: BlockscoutTokenBalance[];
}> {
  const encodedAddress = encodeURIComponent(address);
  const [account, tokenBalances] = await Promise.all([
    readPublicJson(
      `${BLOCKSCOUT_ORIGIN}/api/v2/addresses/${encodedAddress}`,
      addressSchema,
    ),
    readPublicJson(
      `${BLOCKSCOUT_ORIGIN}/api/v2/addresses/${encodedAddress}/token-balances`,
      tokenBalanceSchema,
    ),
  ]);

  if (account.is_contract || account.is_scam) {
    throw new Error("Configured wallet did not pass the public address checks.");
  }

  return { account, tokenBalances };
}
