import "server-only";

import {
  createTrendScoutSnapshot,
  unavailableTrendScoutSnapshot,
} from "@/lib/trend-scout-core";
import { getContractSafetyAssessments } from "@/lib/blockscout";
import { getQuotePreflightAssessments } from "@/lib/kyberswap";
import { getEthereumTrendingPools } from "@/lib/trend-source";
import type { PortfolioSnapshot, TrendScoutSnapshot } from "@/lib/types";

export async function getTrendScoutSnapshot(
  snapshot: PortfolioSnapshot,
): Promise<TrendScoutSnapshot> {
  try {
    const pools = await getEthereumTrendingPools();
    const inspectedPools = pools.slice(0, 8);
    const addresses = inspectedPools.map((pool) => pool.contractAddress);
    const ethPrice =
      snapshot.gasBalanceEth > 0
        ? snapshot.gasBalanceUsd / snapshot.gasBalanceEth
        : 0;
    const [safetyByAddress, preflightByAddress] = await Promise.all([
      getContractSafetyAssessments(addresses),
      getQuotePreflightAssessments(addresses, ethPrice),
    ]);
    return createTrendScoutSnapshot(
      inspectedPools,
      snapshot,
      Date.now(),
      safetyByAddress,
      preflightByAddress,
    );
  } catch {
    return unavailableTrendScoutSnapshot(
      "コミュニティ・トレンド情報を取得できませんでした。紙上ローテーションは停止しています。",
    );
  }
}
