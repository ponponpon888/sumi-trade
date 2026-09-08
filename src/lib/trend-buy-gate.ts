import type {
  ModelDriftAssessment,
  PortfolioRiskAssessment,
  TrendScoutSnapshot,
} from "@/lib/types";

export function applyTrendBuyGates(
  trendScout: TrendScoutSnapshot,
  portfolioRisk: PortfolioRiskAssessment,
  communityTrendDrift: ModelDriftAssessment,
): TrendScoutSnapshot {
  if (!portfolioRisk.blockNewBuys && !communityTrendDrift.blockNewBuys) {
    return trendScout;
  }

  const warning = communityTrendDrift.blockNewBuys
    ? `コミュニティトレンド劣化${communityTrendDrift.status.toUpperCase()}: ${communityTrendDrift.reasons[0]}`
    : `ポートフォリオリスク${portfolioRisk.status.toUpperCase()}: ${portfolioRisk.reasons[0]}`;

  return {
    ...trendScout,
    paperRotation: null,
    warnings: [...trendScout.warnings, warning],
  };
}
