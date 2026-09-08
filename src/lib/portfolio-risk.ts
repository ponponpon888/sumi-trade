import type {
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PortfolioCorrelationPair,
  PortfolioRiskAssessment,
  PortfolioSnapshot,
} from "@/lib/types";

const SINGLE_ASSET_LIMIT_PERCENT = 35 as const;
const CORRELATED_EXPOSURE_LIMIT_PERCENT = 50 as const;
const CORRELATION_LIMIT = 0.85 as const;
const DAILY_LOSS_LIMIT_PERCENT = 3 as const;
const LOSS_STREAK_LIMIT = 3 as const;
const MINIMUM_RETURN_SAMPLES = 12;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function returns(values: number[]): number[] {
  return values
    .slice(1)
    .map((value, index) => {
      const previous = values[index] ?? 0;
      return previous > 0 ? value / previous - 1 : Number.NaN;
    })
    .filter(Number.isFinite);
}

export function priceCorrelation(
  leftPrices: number[],
  rightPrices: number[],
): number | null {
  const size = Math.min(leftPrices.length, rightPrices.length);
  if (size < MINIMUM_RETURN_SAMPLES + 1) return null;
  const left = returns(leftPrices.slice(-size));
  const right = returns(rightPrices.slice(-size));
  const sampleSize = Math.min(left.length, right.length);
  if (sampleSize < MINIMUM_RETURN_SAMPLES) return null;
  const alignedLeft = left.slice(-sampleSize);
  const alignedRight = right.slice(-sampleSize);
  const leftMean = alignedLeft.reduce((sum, value) => sum + value, 0) / sampleSize;
  const rightMean = alignedRight.reduce((sum, value) => sum + value, 0) / sampleSize;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const leftDelta = (alignedLeft[index] ?? 0) - leftMean;
    const rightDelta = (alignedRight[index] ?? 0) - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return round(covariance / denominator, 3);
}

export function assessPortfolioRisk(
  snapshot: PortfolioSnapshot,
  chartModel: ChartModelSnapshot,
  journal: PaperJournalSnapshot,
): PortfolioRiskAssessment {
  const exposures = snapshot.assets
    .filter((asset) => asset.contractAddress !== null && asset.valueUsd > 0)
    .map((asset) => ({
      symbol: asset.symbol,
      percent:
        snapshot.totalUsd > 0 ? (asset.valueUsd / snapshot.totalUsd) * 100 : 0,
    }))
    .toSorted((left, right) => right.percent - left.percent);
  const exposureBySymbol = new Map(
    exposures.map((exposure) => [exposure.symbol, exposure.percent]),
  );
  const analysisBySymbol = new Map(
    chartModel.analyses
      .filter((analysis) => analysis.status === "ready")
      .map((analysis) => [analysis.symbol, analysis]),
  );
  const reasons: string[] = [];
  const unavailableReasons: string[] = [];
  const maxExposure = exposures[0] ?? null;

  if (maxExposure && maxExposure.percent > SINGLE_ASSET_LIMIT_PERCENT) {
    reasons.push(
      `${maxExposure.symbol}が全資産の${round(maxExposure.percent, 1)}%で上限${SINGLE_ASSET_LIMIT_PERCENT}%超`,
    );
  }

  const missingAnalysis = exposures.filter(
    (exposure) => !analysisBySymbol.has(exposure.symbol),
  );
  if (missingAnalysis.length > 0) {
    unavailableReasons.push(
      `${missingAnalysis.map((item) => item.symbol).join("・")}の相関履歴なし`,
    );
  }
  if (chartModel.ethBenchmark.status !== "ready") {
    unavailableReasons.push("ETHベンチマーク履歴なし");
  }
  if (!journal.storageConfigured || journal.status === "error") {
    unavailableReasons.push("24時間損失記録を確認できない");
  }

  const highCorrelationPairs: PortfolioCorrelationPair[] = [];
  const analyses = [...analysisBySymbol.values()];
  const missingPairCorrelations: string[] = [];
  for (let leftIndex = 0; leftIndex < analyses.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < analyses.length; rightIndex += 1) {
      const left = analyses[leftIndex];
      const right = analyses[rightIndex];
      const correlation = priceCorrelation(left.sparkline, right.sparkline);
      const combinedExposurePercent =
        (exposureBySymbol.get(left.symbol) ?? 0) +
        (exposureBySymbol.get(right.symbol) ?? 0);
      if (correlation === null) {
        missingPairCorrelations.push(`${left.symbol}・${right.symbol}`);
      } else if (
        correlation >= CORRELATION_LIMIT &&
        combinedExposurePercent > CORRELATED_EXPOSURE_LIMIT_PERCENT
      ) {
        highCorrelationPairs.push({
          leftSymbol: left.symbol,
          rightSymbol: right.symbol,
          correlation,
          combinedExposurePercent: round(combinedExposurePercent, 1),
        });
      }
    }
  }
  if (missingPairCorrelations.length > 0) {
    unavailableReasons.push(
      `${missingPairCorrelations.join("・")}の相関サンプル不足`,
    );
  }
  if (highCorrelationPairs.length > 0) {
    const pair = highCorrelationPairs[0];
    reasons.push(
      `${pair.leftSymbol}・${pair.rightSymbol}の相関${pair.correlation.toFixed(2)}、合計${pair.combinedExposurePercent}%`,
    );
  }

  const ethCorrelations = analyses
    .map((analysis) => ({
      symbol: analysis.symbol,
      correlation: priceCorrelation(
        analysis.sparkline,
        chartModel.ethBenchmark.sparkline,
      ),
    }))
    .filter(
      (item): item is { symbol: string; correlation: number } =>
        item.correlation !== null,
    )
    .toSorted((left, right) => right.correlation - left.correlation);
  const correlatedWithEth = new Set(ethCorrelations.map((item) => item.symbol));
  const missingEthCorrelations = exposures.filter(
    (exposure) => !correlatedWithEth.has(exposure.symbol),
  );
  if (
    chartModel.ethBenchmark.status === "ready" &&
    missingEthCorrelations.length > 0
  ) {
    unavailableReasons.push(
      `${missingEthCorrelations.map((item) => item.symbol).join("・")}のETH相関サンプル不足`,
    );
  }
  const maxEthCorrelation = ethCorrelations[0] ?? null;
  if (
    maxEthCorrelation &&
    maxEthCorrelation.correlation >= CORRELATION_LIMIT &&
    (exposureBySymbol.get(maxEthCorrelation.symbol) ?? 0) >= 25
  ) {
    reasons.push(
      `${maxEthCorrelation.symbol}はETH相関${maxEthCorrelation.correlation.toFixed(2)}かつ配分25%以上`,
    );
  }
  if (journal.dailyLossPercent >= DAILY_LOSS_LIMIT_PERCENT) {
    reasons.push(
      `24時間損失${journal.dailyLossPercent.toFixed(2)}%が上限${DAILY_LOSS_LIMIT_PERCENT}%到達`,
    );
  }
  if (journal.longestLossStreak >= LOSS_STREAK_LIMIT) {
    reasons.push(`${journal.longestLossStreak}連敗のため新規BUY停止`);
  }

  const status = unavailableReasons.length > 0
    ? "unavailable"
    : reasons.length > 0
      ? "blocked"
      : "pass";
  const allReasons = [...unavailableReasons, ...reasons];
  if (allReasons.length === 0) {
    allReasons.push("集中・相関・24時間損失ゲートを通過");
  }

  return {
    status,
    blockNewBuys: status !== "pass",
    maxSingleAssetSymbol: maxExposure?.symbol ?? null,
    maxSingleAssetPercent: round(maxExposure?.percent ?? 0, 1),
    maxEthCorrelation: maxEthCorrelation?.correlation ?? null,
    maxEthCorrelationSymbol: maxEthCorrelation?.symbol ?? null,
    highCorrelationPairs,
    dailyNetPnlUsd: journal.dailyNetPnlUsd,
    dailyLossPercent: journal.dailyLossPercent,
    longestLossStreak: journal.longestLossStreak,
    limits: {
      singleAssetPercent: SINGLE_ASSET_LIMIT_PERCENT,
      correlatedExposurePercent: CORRELATED_EXPOSURE_LIMIT_PERCENT,
      correlation: CORRELATION_LIMIT,
      dailyLossPercent: DAILY_LOSS_LIMIT_PERCENT,
      lossStreak: LOSS_STREAK_LIMIT,
    },
    reasons: allReasons,
  };
}
