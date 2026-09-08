import "server-only";

import { MAX_CHART_ASSETS } from "@/lib/config";
import {
  analyzeChart,
  createUnavailableChartAnalysis,
} from "@/lib/chart-model";
import { getPoolOhlcv } from "@/lib/ohlcv";
import { normalizeCandles } from "@/lib/indicators";
import { getPaperJournalSnapshot } from "@/lib/paper-journal";
import { getPortfolioSnapshot } from "@/lib/portfolio";
import { assessPortfolioRisk } from "@/lib/portfolio-risk";
import { createStrategyPlan } from "@/lib/strategy";
import { getTrendScoutSnapshot } from "@/lib/trend-scout";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PortfolioAsset,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
} from "@/lib/types";

function eligibleChartAssets(snapshot: PortfolioSnapshot): PortfolioAsset[] {
  return snapshot.assets
    .filter(
      (asset) =>
        asset.tradability === "eligible" && asset.pairAddress !== null,
    )
    .toSorted((left, right) => right.valueUsd - left.valueUsd);
}

export async function getChartModelSnapshot(
  snapshot: PortfolioSnapshot,
): Promise<ChartModelSnapshot> {
  const eligible = eligibleChartAssets(snapshot);
  const selected = eligible.slice(0, MAX_CHART_ASSETS);
  const ethPairAddress = snapshot.assets.find(
    (asset) => asset.symbol === "ETH",
  )?.pairAddress;
  const [analyses, ethBenchmark] = await Promise.all([
    Promise.all(
      selected.map(async (asset): Promise<ChartAnalysis> => {
        try {
          const candles = await getPoolOhlcv(asset.pairAddress as string);
          return analyzeChart(
            asset.symbol,
            candles,
            snapshot.totalUsd,
            Math.floor(Date.now() / 1_000),
            {
              liquidityUsd: asset.liquidityUsd,
              volume24hUsd: asset.volume24hUsd,
            },
          );
        } catch {
          return createUnavailableChartAnalysis(
            asset.symbol,
            "OHLCV履歴を取得できませんでした。",
          );
        }
      }),
    ),
    (async (): Promise<ChartModelSnapshot["ethBenchmark"]> => {
      if (!ethPairAddress) return { status: "unavailable", sparkline: [] };
      try {
        const candles = await getPoolOhlcv(ethPairAddress);
        const sparkline = normalizeCandles(candles)
          .slice(-48)
          .map((candle) => candle.close);
        return sparkline.length >= 13
          ? { status: "ready", sparkline }
          : { status: "unavailable", sparkline: [] };
      } catch {
        return { status: "unavailable", sparkline: [] };
      }
    })(),
  ]);

  const readyAssetCount = analyses.filter(
    (analysis) => analysis.status === "ready",
  ).length;
  const warnings: string[] = [];
  if (eligible.length > selected.length) {
    warnings.push(
      `API負荷を抑えるため、評価額上位${MAX_CHART_ASSETS}銘柄だけをチャート分析しました。`,
    );
  }
  if (readyAssetCount < selected.length) {
    warnings.push(
      `${selected.length - readyAssetCount}銘柄は履歴不足またはAPI応答なしのためHOLDに固定しました。`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "geckoterminal",
    cadenceMinutes: 5,
    requestedAssetCount: selected.length,
    readyAssetCount,
    analyses,
    ethBenchmark,
    warnings,
  };
}

export async function getTradingDashboardData(): Promise<{
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
  plan: StrategyPlan;
  trendScout: TrendScoutSnapshot;
  journal: PaperJournalSnapshot;
}> {
  const snapshot = await getPortfolioSnapshot();
  const [chartModel, rawTrendScout, journal] = await Promise.all([
    getChartModelSnapshot(snapshot),
    getTrendScoutSnapshot(snapshot),
    getPaperJournalSnapshot(snapshot.walletAddress),
  ]);
  const portfolioRisk = assessPortfolioRisk(snapshot, chartModel, journal);
  const plan = createStrategyPlan(
    snapshot,
    chartModel.analyses,
    portfolioRisk,
  );
  const trendScout = portfolioRisk.blockNewBuys
    ? {
        ...rawTrendScout,
        paperRotation: null,
        warnings: [
          ...rawTrendScout.warnings,
          `ポートフォリオリスク${portfolioRisk.status.toUpperCase()}: ${portfolioRisk.reasons[0]}`,
        ],
      }
    : rawTrendScout;
  return { snapshot, chartModel, plan, trendScout, journal };
}
