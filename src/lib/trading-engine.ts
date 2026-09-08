import "server-only";

import { MAX_CHART_ASSETS } from "@/lib/config";
import {
  analyzeChart,
  createUnavailableChartAnalysis,
  MAX_CHART_DATA_AGE_SECONDS,
} from "@/lib/chart-model";
import { getPoolOhlcv } from "@/lib/ohlcv";
import { normalizeCandles } from "@/lib/indicators";
import { getPaperJournalSnapshot } from "@/lib/paper-journal";
import { assessModelDrifts } from "@/lib/model-drift";
import { getPortfolioSnapshot } from "@/lib/portfolio";
import { assessPortfolioRisk } from "@/lib/portfolio-risk";
import {
  applySafetyControlToRisk,
  getSafetyControlSnapshot,
} from "@/lib/safety-control";
import { createStrategyPlan } from "@/lib/strategy";
import { getTrendScoutSnapshot } from "@/lib/trend-scout";
import { applyTrendBuyGates } from "@/lib/trend-buy-gate";
import { assessDataSourceQuality } from "@/lib/data-source-quality";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  DataSourceQualitySnapshot,
  PaperJournalSnapshot,
  PortfolioAsset,
  PortfolioSnapshot,
  StrategyPlan,
  SafetyControlSnapshot,
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
      if (!ethPairAddress) {
        return { status: "unavailable", sparkline: [], correlationSeries: [] };
      }
      try {
        const candles = await getPoolOhlcv(ethPairAddress);
        const nowSeconds = Math.floor(Date.now() / 1_000);
        const normalized = normalizeCandles(candles, 5 * 60, nowSeconds).slice(-48);
        const sparkline = normalized.map((candle) => candle.close);
        const correlationSeries = normalized.map((candle) => ({
          timestamp: candle.timestamp,
          price: candle.close,
        }));
        const latest = normalized.at(-1);
        const fresh = latest
          ? nowSeconds - (latest.timestamp + 5 * 60) <= MAX_CHART_DATA_AGE_SECONDS
          : false;
        return sparkline.length >= 13 && fresh
          ? { status: "ready", sparkline, correlationSeries }
          : { status: "unavailable", sparkline: [], correlationSeries: [] };
      } catch {
        return { status: "unavailable", sparkline: [], correlationSeries: [] };
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
  safetyControl: SafetyControlSnapshot;
  dataSourceQuality: DataSourceQualitySnapshot;
}> {
  const snapshot = await getPortfolioSnapshot();
  const [chartModel, rawTrendScout, journal, safetyControl] = await Promise.all([
    getChartModelSnapshot(snapshot),
    getTrendScoutSnapshot(snapshot),
    getPaperJournalSnapshot(snapshot.walletAddress),
    getSafetyControlSnapshot(),
  ]);
  const portfolioRisk = applySafetyControlToRisk(
    assessPortfolioRisk(snapshot, chartModel, journal),
    safetyControl,
  );
  const modelDrift = assessModelDrifts(journal);
  const plan = createStrategyPlan(
    snapshot,
    chartModel.analyses,
    portfolioRisk,
    modelDrift,
  );
  const trendDrift = modelDrift["community-trend"];
  const trendScout = applyTrendBuyGates(
    rawTrendScout,
    portfolioRisk,
    trendDrift,
  );
  const dataSourceQuality = assessDataSourceQuality(snapshot, chartModel);
  return {
    snapshot,
    chartModel,
    plan,
    trendScout,
    journal,
    safetyControl,
    dataSourceQuality,
  };
}
