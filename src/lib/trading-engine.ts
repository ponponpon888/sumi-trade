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
import {
  assessDataSourceQuality,
  fetchedChartSourceCheck,
} from "@/lib/data-source-quality";
import { sourceUnavailable } from "@/lib/data-source-failure";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  DataSourceCheckResult,
  DataSourceQualitySnapshot,
  PaperJournalSnapshot,
  PortfolioAsset,
  PortfolioSnapshot,
  StrategyPlan,
  SafetyControlSnapshot,
  TrendScoutSnapshot,
} from "@/lib/types";

function unavailableBenchmark(): ChartModelSnapshot["ethBenchmark"] {
  return { status: "unavailable", sparkline: [], correlationSeries: [] };
}

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
  const [chartResults, benchmarkResult] = await Promise.all([
    Promise.all(
      selected.map(async (asset): Promise<{
        analysis: ChartAnalysis;
        check: DataSourceCheckResult;
      }> => {
        try {
          const candles = await getPoolOhlcv(asset.pairAddress as string);
          const analysis = analyzeChart(
            asset.symbol,
            candles,
            snapshot.totalUsd,
            Math.floor(Date.now() / 1_000),
            {
              liquidityUsd: asset.liquidityUsd,
              volume24hUsd: asset.volume24hUsd,
            },
          );
          return { analysis, check: fetchedChartSourceCheck(analysis.status) };
        } catch (error) {
          return {
            analysis: createUnavailableChartAnalysis(
              asset.symbol,
              "OHLCV履歴を取得できませんでした。",
            ),
            check: sourceUnavailable(error),
          };
        }
      }),
    ),
    (async (): Promise<{
      benchmark: ChartModelSnapshot["ethBenchmark"];
      check: DataSourceCheckResult | null;
    }> => {
      if (!ethPairAddress) {
        // No ETH pair means no benchmark target, matching the quality target count.
        return { benchmark: unavailableBenchmark(), check: null };
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
        if (sparkline.length < 13) {
          return { benchmark: unavailableBenchmark(), check: { outcome: "policy-blocked" } };
        }
        if (!fresh) {
          return { benchmark: unavailableBenchmark(), check: { outcome: "source-stale" } };
        }
        return {
          benchmark: { status: "ready", sparkline, correlationSeries },
          check: { outcome: "success" },
        };
      } catch (error) {
        return { benchmark: unavailableBenchmark(), check: sourceUnavailable(error) };
      }
    })(),
  ]);
  const analyses = chartResults.map((result) => result.analysis);
  const ethBenchmark = benchmarkResult.benchmark;
  const geckoterminalChecks = [
    ...chartResults.map((result) => result.check),
    ...(benchmarkResult.check ? [benchmarkResult.check] : []),
  ];

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
    sourceChecks: { geckoterminal: geckoterminalChecks },
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
