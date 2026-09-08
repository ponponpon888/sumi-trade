import "server-only";

import { GECKOTERMINAL_ORIGIN } from "@/lib/config";
import {
  parseEthereumTrendingPools,
  type EthereumTrendingPool,
} from "@/lib/trend-source-core";

export async function getEthereumTrendingPools(): Promise<
  EthereumTrendingPool[]
> {
  const query = new URLSearchParams({
    include: "base_token,quote_token,dex",
    duration: "24h",
    include_gt_community_data: "true",
  });
  const response = await fetch(
    `${GECKOTERMINAL_ORIGIN}/networks/eth/trending_pools?${query}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "SUMI-Trade-Lab/0.4 trend-shadow",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Trend data request failed (${response.status}).`);
  }

  return parseEthereumTrendingPools(await response.json());
}
