import type { ReactNode } from "react";

import { PaperControls } from "@/app/_components/paper-controls";
import { SafetyDecisionSummaryBoard } from "@/app/_components/safety-decision-summary-board";
import { formatAmount, formatUsd } from "@/lib/number";
import { createSafetyDecisionSummaryView } from "@/lib/safety-decision-summary-view";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  DataSourceIncidentItem,
  DataSourceQualityHistoryItem,
  DataSourceQualitySnapshot,
  ModelDriftAssessment,
  ModelDriftSnapshot,
  PaperConfidenceCalibration,
  PaperConfidenceReliability,
  PaperJournalSnapshot,
  PaperModelPerformance,
  PortfolioAsset,
  PortfolioRiskAssessment,
  PortfolioSnapshot,
  SafetyControlSnapshot,
  StrategyPlan,
  StrategySignal,
  TrendCandidate,
  TrendScoutSnapshot,
} from "@/lib/types";

const statusLabels = {
  eligible: "AUTO OK",
  thin: "QUOTE ONLY",
  blocked: "BLOCKED",
  gas: "RESERVE",
} as const;

const actionLabels = {
  BUY: "BUY",
  SELL: "SELL",
  HOLD: "HOLD",
  BLOCK: "BLOCK",
} as const;

const trendLabels = {
  bullish: "上昇",
  neutral: "中立",
  bearish: "下降",
} as const;

const regimeLabels = {
  uptrend: "上昇トレンド",
  downtrend: "下降トレンド",
  range: "レンジ",
  "high-volatility": "高ボラティリティ",
  "low-liquidity": "低流動性",
} as const;

const regimeStrategyLabels = {
  "trend-following": "順張り",
  "mean-reversion": "平均回帰",
  "capital-preservation": "資産保全",
  "risk-off": "リスクオフ",
  blocked: "売買停止",
} as const;

const contractSafetyLabels = {
  pass: "CONTRACT PASS",
  review: "CONTRACT REVIEW",
  blocked: "CONTRACT BLOCK",
  unavailable: "CONTRACT UNKNOWN",
} as const;

const preflightLabels = {
  pass: "ROUTE PASS",
  blocked: "ROUTE BLOCK",
  unavailable: "ROUTE UNKNOWN",
} as const;

const onchainPreflightLabels = {
  pass: "CHAIN PASS",
  blocked: "CHAIN BLOCK",
  unavailable: "CHAIN WAIT",
} as const;

const dataSourceLabels = {
  blockscout: "BLOCKSCOUT",
  dexscreener: "DEXSCREENER",
  geckoterminal: "GECKOTERMINAL",
  "ethereum-rpc": "ETHEREUM RPC",
  kyberswap: "KYBERSWAP",
} as const;

const dataSourceStatusLabels = {
  healthy: "HEALTHY",
  degraded: "PARTIAL",
  unavailable: "NO SAMPLE",
} as const;

const dataSourceHistoryStatusLabels = {
  collecting: "COLLECTING",
  healthy: "STABLE",
  degraded: "DEGRADED",
  stale: "STALE OBSERVATIONS",
} as const;

const dataSourceIncidentStatusLabels = {
  collecting: "WATCH COLLECTING",
  monitoring: "NO INCIDENT",
  incident: "INCIDENT OPEN",
  recovered: "RECOVERED",
} as const;

const decisionDataQualityLabels = {
  complete: "COMPLETE",
  partial: "PARTIAL",
  unavailable: "UNAVAILABLE",
  unknown: "LEGACY / UNKNOWN",
} as const;

const sourceQualityImpactStatusLabels = {
  collecting: "COLLECTING",
  monitoring: "MONITORING",
  "performance-alert": "PERFORMANCE ALERT",
} as const;

const sourceReasonImpactStatusLabels = {
  collecting: "COLLECTING",
  monitoring: "MONITORING",
  "performance-alert": "REASON ALERT",
} as const;

function DataSourceQualityBoard({
  quality,
  history,
  incidents,
}: {
  quality: DataSourceQualitySnapshot;
  history: DataSourceQualityHistoryItem[];
  incidents: DataSourceIncidentItem[];
}) {
  const historyBySource = new Map(history.map((item) => [item.source, item]));
  const incidentsBySource = new Map(
    incidents.map((item) => [item.source, item]),
  );
  return (
    <section
      className={`data-source-board data-source-${quality.status} shell`}
      aria-labelledby="data-source-title"
    >
      <div className="data-source-heading">
        <div>
          <span className="section-index">DATA SOURCE QUALITY</span>
          <h2 id="data-source-title">判断の前に、データの穴を見る。</h2>
          <p>各取得元の今回スキャン対象・成功数・欠損率を表示します。品質表示は読み取り専用で、既存のFail Closed判定を緩めません。</p>
        </div>
        <span className={`data-source-overall data-source-overall-${quality.status}`}>
          {quality.status === "healthy" ? "ALL HEALTHY" : "SOURCE WATCH"}
        </span>
      </div>
      <div className="data-source-grid">
        {quality.sources.map((source) => {
          const historical = historyBySource.get(source.source);
          const incident = incidentsBySource.get(source.source);
          return (
            <article className={`data-source-card data-source-card-${source.status}`} key={source.source}>
              <div>
                <span>{dataSourceLabels[source.source]}</span>
                <b>{dataSourceStatusLabels[source.status]}</b>
              </div>
              <strong>{source.coveragePercent.toFixed(1)}%</strong>
              <small>{source.successfulCount}/{source.requestedCount} COMPLETE · FETCH MISSING {(100 - source.coveragePercent).toFixed(1)}%</small>
              <small>POLICY BLOCKED {source.policyBlockedCount} · STALE DATA {source.sourceStaleCount}</small>
              <small>{source.dataAgeSeconds === null ? "SOURCE AGE N/A" : `MAX AGE ${source.dataAgeSeconds.toFixed(0)}S`}</small>
              <p>{source.reasons[0]}</p>
              {historical ? (
                <div className={`data-source-history data-source-history-${historical.status}`}>
                  <span>HISTORY 24H · {dataSourceHistoryStatusLabels[historical.status]}</span>
                  <small>AVAILABLE {historical.availabilityPercent.toFixed(1)}% · AVG COVERAGE {historical.averageCoveragePercent.toFixed(1)}%</small>
                  <small>{historical.lastObservedAt ? `LAST OBS ${historical.lastObservedAt}` : "NO OBSERVATIONS"}</small>
                  <small>{historical.observationAgeSeconds === null ? "OBSERVATION AGE N/A" : `OBSERVATION AGE ${Math.floor(historical.observationAgeSeconds / 60)} MIN`}</small>
                  <small>OBS {historical.observationCount}/{historical.minimumObservations} MIN · FAIL STREAK {historical.currentFailureStreak}</small>
                </div>
              ) : null}
              {incident ? (
                <div className={`data-source-incident data-source-incident-${incident.status}`}>
                  <span>{dataSourceIncidentStatusLabels[incident.status]}</span>
                  <small>INCIDENTS 24H {incident.incidentCount24h} · FAIL {incident.currentFailureStreak}/3</small>
                  <small>{incident.status === "incident" ? `RECOVERY ${incident.currentRecoveryStreak}/3 HEALTHY` : incident.latestRecoveredAt ? `RECOVERED ${new Date(incident.latestRecoveredAt).toISOString()}` : "3 CONSECUTIVE FAILURES TO OPEN"}</small>
                  {incident.latestIncidentStartedAt ? (
                    <small>LAST OPEN {new Date(incident.latestIncidentStartedAt).toISOString()}</small>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function OperationalSafetyStrip({ safety }: { safety: SafetyControlSnapshot }) {
  const label = safety.status === "monitoring"
    ? "SAFETY MONITORING"
    : safety.status === "stopped"
      ? "EMERGENCY STOP"
      : "SAFETY DATA WAIT";
  return (
    <section className={`operational-safety operational-safety-${safety.status} shell`} aria-label="運用安全状態">
      <div><i /><strong>{label}</strong><span>{safety.source.toUpperCase()}</span></div>
      <p>{safety.reason}</p>
      <small>{safety.updatedAt ? `UPDATED ${new Date(safety.updatedAt).toISOString()}` : "EXECUTION HARD-LOCKED"}</small>
    </section>
  );
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function AssetRow({
  asset,
  signal,
}: {
  asset: PortfolioAsset;
  signal: StrategySignal | undefined;
}) {
  const change = asset.priceChange24h;
  return (
    <article className="asset-row">
      <div className="asset-identity">
        <span className={`token-mark token-${asset.symbol.toLowerCase()}`}>
          {asset.symbol.slice(0, 2)}
        </span>
        <div>
          <strong>{asset.symbol}</strong>
          <span>{asset.name}</span>
        </div>
      </div>
      <div className="asset-balance">
        <strong>{formatUsd(asset.valueUsd)}</strong>
        <span>{formatAmount(asset.amount)} {asset.symbol}</span>
      </div>
      <div className="asset-market">
        <strong className={change === null ? "muted" : change >= 0 ? "positive" : "negative"}>
          {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </strong>
        <span>24H</span>
      </div>
      <div className="asset-liquidity">
        <strong>{asset.liquidityUsd === null ? "—" : formatUsd(asset.liquidityUsd)}</strong>
        <span>流動性</span>
      </div>
      <div className="asset-decision">
        <span className={`status-chip status-${asset.tradability}`}>
          {statusLabels[asset.tradability]}
        </span>
        <span className={`signal signal-${signal?.action.toLowerCase() ?? "hold"}`}>
          {signal ? actionLabels[signal.action] : "HOLD"}
        </span>
        {asset.contractSafety ? (
          <span className={`contract-chip contract-${asset.contractSafety.status}`}>
            {contractSafetyLabels[asset.contractSafety.status]}
          </span>
        ) : null}
        {asset.quotePreflight ? (
          <span className={`preflight-chip preflight-${asset.quotePreflight.status}`}>
            {preflightLabels[asset.quotePreflight.status]}
          </span>
        ) : null}
        {asset.onchainPreflight ? (
          <span className={`preflight-chip preflight-${asset.onchainPreflight.status}`}>
            {onchainPreflightLabels[asset.onchainPreflight.status]}
          </span>
        ) : null}
      </div>
      <p className="asset-reason">{signal?.reason ?? asset.reason}</p>
      {asset.pairUrl ? (
        <a className="market-link" href={asset.pairUrl} target="_blank" rel="noreferrer">
          市場を確認 ↗
        </a>
      ) : null}
    </article>
  );
}

function PriceSparkline({
  values,
  direction,
}: {
  values: number[];
  direction: ChartAnalysis["direction"];
}) {
  if (values.length < 2) {
    return <div className="sparkline-empty">NO CHART DATA</div>;
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 34 - ((value - minimum) / range) * 30;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className={`sparkline sparkline-${direction.toLowerCase()}`}
      viewBox="0 0 100 38"
      preserveAspectRatio="none"
      role="img"
      aria-label="直近48本の5分足終値"
    >
      <line x1="0" y1="34" x2="100" y2="34" />
      <polyline points={points} />
    </svg>
  );
}

function ModelCard({ analysis }: { analysis: ChartAnalysis }) {
  const directionClass = analysis.direction.toLowerCase();

  return (
    <article className={`model-card model-${directionClass}`}>
      <div className="model-card-head">
        <div>
          <span>MODEL / {analysis.symbol}</span>
          <strong>{analysis.symbol}</strong>
        </div>
        <span className={`signal signal-${directionClass}`}>
          {analysis.status === "ready" ? analysis.direction : "NO DATA"}
        </span>
      </div>

      <div className="model-score-row">
        <div className="model-score">
          <strong>{analysis.score}</strong>
          <span>/ 100</span>
        </div>
        <div className="score-track" aria-label={`複合スコア ${analysis.score}`}>
          <i style={{ width: `${analysis.score}%` }} />
        </div>
        <small>確信度 {analysis.confidence}%</small>
      </div>

      <PriceSparkline values={analysis.sparkline} direction={analysis.direction} />

      {analysis.timeframes.length > 0 ? (
        <div className="timeframe-grid">
          {analysis.timeframes.map((timeframe) => (
            <div key={timeframe.timeframe}>
              <span>{timeframe.timeframe}</span>
              <strong className={`trend-${timeframe.trend}`}>
                {trendLabels[timeframe.trend]}
              </strong>
              <small>
                RSI {timeframe.rsi14 === null ? "—" : timeframe.rsi14.toFixed(1)}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      {analysis.regime ? (
        <div className={`regime-strip regime-${analysis.regime.regime}`}>
          <div>
            <span>MARKET REGIME</span>
            <strong>{regimeLabels[analysis.regime.regime]}</strong>
          </div>
          <div>
            <span>ACTIVE STRATEGY</span>
            <strong>{regimeStrategyLabels[analysis.regime.strategy]}</strong>
          </div>
          <div>
            <span>REGIME CONF.</span>
            <strong>{analysis.regime.confidence.toFixed(0)}%</strong>
          </div>
          <div>
            <span>RISK SCALE</span>
            <strong>×{analysis.regime.riskMultiplier.toFixed(2)}</strong>
          </div>
        </div>
      ) : null}

      <p className="model-summary">{analysis.summary}</p>

      <div className="model-stats">
        <div>
          <span>BACKTEST</span>
          <strong className={analysis.backtest.netReturnPercent >= 0 ? "positive" : "negative"}>
            {analysis.backtest.status === "insufficient"
              ? "—"
              : `${analysis.backtest.netReturnPercent >= 0 ? "+" : ""}${analysis.backtest.netReturnPercent.toFixed(2)}%`}
          </strong>
          <small>{analysis.backtest.tradeCount} trades</small>
        </div>
        <div>
          <span>WIN RATE</span>
          <strong>
            {analysis.backtest.tradeCount > 0
              ? `${analysis.backtest.winRate.toFixed(1)}%`
              : "—"}
          </strong>
          <small>過去約60時間</small>
        </div>
        <div>
          <span>COST GATE</span>
          <strong className={analysis.risk?.costGatePassed ? "positive" : "negative"}>
            {analysis.risk ? (analysis.risk.costGatePassed ? "PASS" : "WAIT") : "—"}
          </strong>
          <small>
            {analysis.risk
              ? `$${analysis.risk.estimatedRoundTripCostUsd.toFixed(2)} 往復`
              : "履歴待ち"}
          </small>
        </div>
      </div>

      <div className="research-stats" aria-label="検証指標">
        <div>
          <span>ROLLING OOS</span>
          <strong className={analysis.backtest.walkForward.netReturnPercent >= 0 ? "positive" : "negative"}>
            {analysis.backtest.walkForward.status === "insufficient"
              ? "—"
              : signedPercent(analysis.backtest.walkForward.netReturnPercent)}
          </strong>
          <small>
            {analysis.backtest.walkForward.windowCount} windows · {analysis.backtest.walkForward.profitableWindowRate.toFixed(0)}% positive
          </small>
        </div>
        <div>
          <span>EXCESS / HOLD</span>
          <strong className={analysis.backtest.excessReturnPercent >= 0 ? "positive" : "negative"}>
            {analysis.backtest.status === "insufficient"
              ? "—"
              : signedPercent(analysis.backtest.excessReturnPercent)}
          </strong>
          <small>cost-adjusted</small>
        </div>
        <div>
          <span>EXPECTANCY</span>
          <strong className={analysis.backtest.expectancyPercent >= 0 ? "positive" : "negative"}>
            {analysis.backtest.tradeCount > 0
              ? signedPercent(analysis.backtest.expectancyPercent)
              : "—"}
          </strong>
          <small>per trade</small>
        </div>
        <div>
          <span>TRADE SHARPE</span>
          <strong>
            {analysis.backtest.tradeSharpeRatio === null
              ? "—"
              : analysis.backtest.tradeSharpeRatio.toFixed(2)}
          </strong>
          <small>
            SORTINO {analysis.backtest.tradeSortinoRatio === null
              ? "—"
              : analysis.backtest.tradeSortinoRatio.toFixed(2)}
          </small>
        </div>
      </div>

      <div
        className={`robustness-strip robustness-${analysis.backtest.robustness.status}`}
        aria-label="戦略耐久試験"
      >
        <div>
          <span>ROBUSTNESS</span>
          <strong>{analysis.backtest.robustness.status.toUpperCase()}</strong>
          <small>
            {analysis.backtest.robustness.simulationCount > 0
              ? `${analysis.backtest.robustness.simulationCount.toLocaleString()} paths`
              : analysis.backtest.robustness.reasons[0]}
          </small>
        </div>
        <div>
          <span>MONTE CARLO P5</span>
          <strong>
            {analysis.backtest.robustness.simulationCount > 0
              ? signedPercent(analysis.backtest.robustness.fifthPercentileReturnPercent)
              : "—"}
          </strong>
          <small>
            {analysis.backtest.robustness.profitablePathRate.toFixed(1)}% profitable
          </small>
        </div>
        <div>
          <span>COST ×2</span>
          <strong>
            {analysis.backtest.robustness.simulationCount > 0
              ? signedPercent(
                  analysis.backtest.robustness.costSensitivity.at(-1)
                    ?.netReturnPercent ?? 0,
                )
              : "—"}
          </strong>
          <small>
            RUIN {analysis.backtest.robustness.riskOfRuinPercent.toFixed(1)}% · DD95 {analysis.backtest.robustness.ninetyFifthPercentileDrawdownPercent.toFixed(1)}%
          </small>
        </div>
      </div>

      {analysis.risk ? (
        <div className="risk-line">
          <span>SIZE {analysis.risk.positionSizePercent}%</span>
          <span>STOP {analysis.risk.stopLossPercent}%</span>
          <span>TAKE {analysis.risk.takeProfitPercent}%</span>
          <span>
            IMPACT {analysis.risk.execution.mode === "liquidity-aware"
              ? `${analysis.risk.execution.estimatedPriceImpactPercent.toFixed(3)}%`
              : "EST."}
          </span>
          <span>
            SLIPPAGE {analysis.risk.execution.estimatedOneWaySlippagePercent.toFixed(3)}%
          </span>
        </div>
      ) : null}
    </article>
  );
}

function ChartModelBoard({ chartModel }: { chartModel: ChartModelSnapshot }) {
  return (
    <section className="model-board shell" aria-labelledby="model-title">
      <div className="model-board-heading">
        <div>
          <span className="section-index">01 / CHART MODEL</span>
          <h2 id="model-title">市場局面を選び、合う戦略だけを使う。</h2>
          <p>市場局面を分類し、ローリングOOS・1,000経路の再標本化・コスト2倍ストレスを通過した戦略だけをBUY候補にします。</p>
        </div>
        <div className="model-coverage">
          <strong>{chartModel.readyAssetCount}/{chartModel.requestedAssetCount}</strong>
          <span>MODELS READY</span>
        </div>
      </div>

      <div className="model-grid">
        {chartModel.analyses.length > 0 ? (
          chartModel.analyses.map((analysis) => (
            <ModelCard key={analysis.symbol} analysis={analysis} />
          ))
        ) : (
          <p className="model-empty">流動性基準を通過したチャート対象がありません。</p>
        )}
      </div>

      {chartModel.warnings.length > 0 ? (
        <div className="model-warning-list">
          {chartModel.warnings.map((warning) => <p key={warning}>! {warning}</p>)}
        </div>
      ) : null}
      <p className="backtest-disclaimer">モンテカルロは過去取引を復元抽出した耐久試験です。バックテストと同様に将来の利益・損失確率を保証しません。</p>
    </section>
  );
}

const strategyComparisonShortLabels = {
  "sumi-regime": "SUMI",
  "ema-trend": "EMA",
  "rsi-reversion": "RSI",
} as const;

const strategyComparisonRegimeLabels = {
  uptrend: "UPTREND",
  downtrend: "DOWNTREND",
  range: "RANGE",
  "high-volatility": "HIGH VOL",
  "low-liquidity": "LOW LIQ",
} as const;

function StrategyComparisonBoard({ chartModel }: { chartModel: ChartModelSnapshot }) {
  const comparable = chartModel.analyses.filter(
    (analysis) => analysis.strategyComparison.status === "ready",
  );

  return (
    <section className="strategy-lab shell" aria-labelledby="strategy-lab-title">
      <div className="strategy-lab-heading">
        <div>
          <span className="section-index">02 / STRATEGY LAB</span>
          <h2 id="strategy-lab-title">同じ相場で、戦略だけを入れ替える。</h2>
          <p>
            SUMIの局面判定、EMA 9/21順張り、RSI 30/70平均回帰を、同じ確定足・次足始値・ガス・スリッページ条件で比較します。
            首位は研究結果であり、運用戦略を自動変更しません。
          </p>
        </div>
        <span className="strategy-lab-mode">RESEARCH ONLY</span>
      </div>

      <div className="strategy-lab-grid">
        {comparable.length > 0 ? (
          comparable.map((analysis) => {
            const comparison = analysis.strategyComparison;
            return (
              <article className="strategy-compare-card" key={analysis.symbol}>
                <div className="strategy-compare-head">
                  <div><span>ASSET</span><strong>{analysis.symbol}</strong></div>
                  <div><span>BUY &amp; HOLD</span><strong>{signedPercent(comparison.benchmarkReturnPercent)}</strong></div>
                </div>
                <div className="strategy-compare-columns" aria-hidden="true">
                  <span />
                  <span>戦略</span>
                  <span>OOS</span>
                  <span>全期間</span>
                  <span>MAX DD</span>
                  <span>PF</span>
                </div>
                <div className="strategy-compare-list">
                  {comparison.results.map((result) => (
                    <div className={result.id === comparison.leaderId ? "is-leader" : ""} key={result.id}>
                      <span className="strategy-rank">#{result.rank}</span>
                      <div><strong>{result.name}</strong><small>{result.family}</small></div>
                      <strong className={result.outOfSampleReturnPercent >= 0 ? "positive" : "negative"}>{signedPercent(result.outOfSampleReturnPercent)}</strong>
                      <strong className={result.netReturnPercent >= 0 ? "positive" : "negative"}>{signedPercent(result.netReturnPercent)}</strong>
                      <strong>{result.maxDrawdownPercent.toFixed(2)}%</strong>
                      <strong>{result.profitFactor === null ? "—" : result.profitFactor.toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
                <div className="strategy-regime-walkforward">
                  <div className="strategy-regime-title">
                    <strong>REGIME WALK-FORWARD</strong>
                    <small>10H TEST WINDOWS · START-ONLY CLASSIFICATION</small>
                  </div>
                  {comparison.walkForwardByRegime.length > 0 ? (
                    comparison.walkForwardByRegime.map((regime) => (
                      <article key={regime.regime}>
                        <div className="strategy-regime-head">
                          <div>
                            <strong>{strategyComparisonRegimeLabels[regime.regime]}</strong>
                            <small>{regime.windowCount} WINDOWS</small>
                          </div>
                          <b>
                            LEADER {regime.leaderId ? strategyComparisonShortLabels[regime.leaderId] : "—"}
                          </b>
                        </div>
                        <div className="strategy-regime-results">
                          {regime.results.map((result) => (
                            <div className={result.id === regime.leaderId ? "is-leader" : ""} key={result.id}>
                              <span>#{result.rank} {strategyComparisonShortLabels[result.id]}</span>
                              <strong className={result.netReturnPercent >= 0 ? "positive" : "negative"}>
                                {signedPercent(result.netReturnPercent)}
                              </strong>
                              <small>{result.tradeCount} TRADES · {result.profitableWindowRate.toFixed(0)}% WIN WINDOWS</small>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p>360本の学習区間と120本のテスト区間を収集中です。</p>
                  )}
                </div>
                <p>{comparison.notes.join(" · ")}</p>
              </article>
            );
          })
        ) : (
          <p className="strategy-lab-empty">比較に必要な確定足を収集中です。</p>
        )}
      </div>
    </section>
  );
}

const trendDecisionLabels = {
  PAPER: "PAPER",
  WATCH: "WATCH",
  BLOCK: "BLOCK",
} as const;

function TrendCandidateCard({ candidate }: { candidate: TrendCandidate }) {
  return (
    <article className={`trend-card trend-card-${candidate.decision.toLowerCase()}`}>
      <div className="trend-card-head">
        <div>
          <span>RANK #{candidate.rank}</span>
          <strong>{candidate.symbol}</strong>
          <small>{candidate.name}</small>
        </div>
        <span className={`trend-decision trend-decision-${candidate.decision.toLowerCase()}`}>
          {trendDecisionLabels[candidate.decision]}
        </span>
      </div>
      <span className={`contract-chip contract-${candidate.contractSafety.status}`}>
        {contractSafetyLabels[candidate.contractSafety.status]}
      </span>
      <span className={`preflight-chip preflight-${candidate.quotePreflight.status}`}>
        {preflightLabels[candidate.quotePreflight.status]}
        {candidate.quotePreflight.roundTripLossPercent !== null
          ? ` · LOSS ${candidate.quotePreflight.roundTripLossPercent.toFixed(2)}%`
          : ""}
      </span>
      <div className="trend-score-row">
        <strong>{candidate.score}</strong><span>/ 100</span>
        <i><b style={{ width: `${candidate.score}%` }} /></i>
      </div>
      <div className="trend-market-grid">
        <div><span>1H</span><strong className={candidate.priceChange1h >= 0 ? "positive" : "negative"}>{candidate.priceChange1h >= 0 ? "+" : ""}{candidate.priceChange1h.toFixed(1)}%</strong></div>
        <div><span>24H</span><strong className={candidate.priceChange24h >= 0 ? "positive" : "negative"}>{candidate.priceChange24h >= 0 ? "+" : ""}{candidate.priceChange24h.toFixed(1)}%</strong></div>
        <div><span>LIQ</span><strong>{formatUsd(candidate.liquidityUsd)}</strong></div>
        <div><span>VOL</span><strong>{formatUsd(candidate.volume24hUsd)}</strong></div>
      </div>
      <p>{candidate.reasons.slice(0, 2).join(" · ") || "安全ゲート評価中"}</p>
    </article>
  );
}

function TrendScoutBoard({ trendScout }: { trendScout: TrendScoutSnapshot }) {
  const rotation = trendScout.paperRotation;

  return (
    <section className="trend-board shell" aria-labelledby="trend-title">
      <div className="trend-heading">
        <div>
          <span className="section-index">03 / COMMUNITY TREND</span>
          <h2 id="trend-title">話題性を拾い、安全ゲートで削る。</h2>
          <p>
            Ethereum注目プールを、コミュニティ反応・契約安全性・BUY／SELL双方向見積・流動性・過熱度で再採点。
            合格しても紙上ローテーションだけを記録します。
          </p>
        </div>
        <div className="trend-coverage">
          <strong>{trendScout.paperCandidateCount}/{trendScout.candidateCount}</strong>
          <span>PAPER CANDIDATES</span>
        </div>
      </div>

      <div className="trend-rotation">
        <div>
          <span>SHADOW ROTATION</span>
          <strong>{rotation ? `${rotation.fromSymbol} → ${rotation.toSymbol}` : "NO SAFE ROTATION"}</strong>
          <small>
            {rotation
              ? `${formatUsd(rotation.amountUsd)} / 資産の${rotation.allocationPercent.toFixed(1)}% · IMPACT ${rotation.estimatedPriceImpactPercent.toFixed(3)}% · COST ${formatUsd(rotation.estimatedRoundTripCostUsd)}`
              : "全ゲート通過銘柄または売却元資産を待っています。"}
          </small>
        </div>
        <span className={`trend-cost-gate ${rotation?.costGatePassed ? "is-pass" : "is-wait"}`}>
          {rotation ? (rotation.costGatePassed ? "COST PASS" : "COST BLOCK") : "PAPER ONLY"}
        </span>
      </div>

      <div className="trend-grid">
        {trendScout.candidates.length > 0 ? (
          trendScout.candidates.map((candidate) => (
            <TrendCandidateCard key={candidate.contractAddress} candidate={candidate} />
          ))
        ) : (
          <p className="trend-empty">トレンド候補を取得できていません。既存モデルは継続します。</p>
        )}
      </div>

      {trendScout.warnings.map((warning) => <p className="trend-warning" key={warning}>! {warning}</p>)}
      <p className="trend-disclaimer">
        トレンド順位は利益予測ではありません。全候補は紙上観測のみで、署名・承認・スワップ送信は実装していません。
      </p>
    </section>
  );
}

const journalStatusLabels = {
  disabled: "STORAGE OFF",
  collecting: "COLLECTING",
  qualified: "MODEL PASS",
  rejected: "MODEL REJECT",
  error: "STORAGE ERROR",
} as const;

function QualificationItem({ passed, children }: { passed: boolean; children: ReactNode }) {
  return (
    <li className={passed ? "qualification-pass" : "qualification-wait"}>
      <i />{children}
    </li>
  );
}

function ModelPerformanceCard({
  label,
  description,
  performance,
}: {
  label: string;
  description: string;
  performance: PaperModelPerformance;
}) {
  const pnlClass =
    performance.netPnlUsd > 0
      ? "positive"
      : performance.netPnlUsd < 0
        ? "negative"
        : "muted";
  const gateLabel = performance.qualification.overallPassed
    ? "METRIC PASS"
    : performance.maturedCount >= performance.qualification.minimumSamples
      ? "REJECT"
      : "COLLECTING";

  return (
    <article className="model-performance-card">
      <div className="model-performance-head">
        <div><span>{label}</span><small>{description}</small></div>
        <strong className={performance.qualification.overallPassed ? "is-ready" : ""}>
          {gateLabel}
        </strong>
      </div>
      <div className="model-performance-stats">
        <div><span>SETTLED</span><strong>{performance.maturedCount}</strong><small>/ {performance.qualification.minimumSamples}</small></div>
        <div><span>WIN RATE</span><strong>{performance.maturedCount ? `${performance.winRate.toFixed(1)}%` : "—"}</strong></div>
        <div><span>NET P/L</span><strong className={pnlClass}>{performance.maturedCount ? formatUsd(performance.netPnlUsd) : "—"}</strong></div>
        <div><span>PF</span><strong>{performance.profitFactor === null ? "—" : performance.profitFactor.toFixed(2)}</strong></div>
        <div><span>MAX DD</span><strong>{performance.maturedCount ? `${performance.maxDrawdownPercent.toFixed(2)}%` : "—"}</strong></div>
      </div>
    </article>
  );
}

const calibrationStatusLabels = {
  collecting: "COLLECTING",
  aligned: "ALIGNED",
  inverted: "OVERCONFIDENT",
} as const;

const confidenceBandLabels = {
  low: "0–49",
  medium: "50–69",
  high: "70–100",
} as const;

const reliabilityStatusLabels = {
  collecting: "COLLECTING",
  informative: "INFORMATIVE",
  inverted: "INVERTED",
  uninformative: "NO EDGE",
} as const;

function ConfidenceCalibrationCard({
  label,
  calibration,
  reliability,
}: {
  label: string;
  calibration: PaperConfidenceCalibration;
  reliability: PaperConfidenceReliability;
}) {
  return (
    <article className={`calibration-card calibration-${calibration.status}`}>
      <div className="calibration-head">
        <div><span>{label}</span><small>30D CONFIDENCE RANKING</small></div>
        <strong>{calibrationStatusLabels[calibration.status]}</strong>
      </div>
      <div className="calibration-bands">
        {calibration.bands.map((band) => (
          <div key={band.band}>
            <span>{confidenceBandLabels[band.band]}</span>
            <strong>{band.maturedCount ? signedPercent(band.averageNetReturnPercent) : "—"}</strong>
            <small>{band.maturedCount} settled · WR {band.maturedCount ? `${band.winRate.toFixed(0)}%` : "—"}</small>
          </div>
        ))}
      </div>
      <p>{calibration.reasons[0]}</p>
      <div className="calibration-head">
        <div>
          <span>WIN PROBABILITY</span>
          <small>
            WALK-FORWARD · {reliability.testCount} OOS · {reliability.independentSampleCount} SCANS
            {reliability.brierSkillScore === null ? "" : ` · BSS ${reliability.brierSkillScore.toFixed(3)}`}
          </small>
        </div>
        <strong>{reliabilityStatusLabels[reliability.status]}</strong>
      </div>
      {reliability.calibratedWinRates.length ? (
        <div className="calibration-bands calibration-probabilities">
          {reliability.calibratedWinRates.map((point) => (
            <div key={point.confidence}>
              <span>CONF {point.confidence}</span>
              <strong>{point.winProbabilityPercent.toFixed(0)}%</strong>
              <small>fitted</small>
            </div>
          ))}
        </div>
      ) : null}
      <p>{reliability.reasons[0]}</p>
      <small className="calibration-note">RESEARCH ONLY · BUYゲートへ自動接続しません</small>
    </article>
  );
}

function ConfidenceCalibrationBoard({ journal }: { journal: PaperJournalSnapshot }) {
  return (
    <section className="calibration-board" aria-label="確信度スコア校正">
      <div className="calibration-board-heading">
        <div><span>CONFIDENCE CALIBRATION</span><strong>高スコアが、本当に強いか。</strong></div>
        <small>HIGH ≥ 70 / LOWER &lt; 70 · MIN 10 EACH</small>
      </div>
      <div className="calibration-grid">
        <ConfidenceCalibrationCard
          label="CORE CHART"
          calibration={journal.confidenceCalibrationByModel.chart}
          reliability={journal.confidenceReliabilityByModel.chart}
        />
        <ConfidenceCalibrationCard
          label="COMMUNITY TREND"
          calibration={journal.confidenceCalibrationByModel["community-trend"]}
          reliability={journal.confidenceReliabilityByModel["community-trend"]}
        />
      </div>
    </section>
  );
}

const regimePerformanceLabels = {
  uptrend: "UPTREND",
  downtrend: "DOWNTREND",
  range: "RANGE",
  "high-volatility": "HIGH VOL",
  "low-liquidity": "LOW LIQ",
} as const;

const regimePerformanceStatusLabels = {
  collecting: "COLLECTING",
  monitoring: "MONITORING",
  alert: "PERFORMANCE ALERT",
} as const;

function RegimePerformanceBoard({ journal }: { journal: PaperJournalSnapshot }) {
  const alertCount = journal.regimePerformance.filter(
    (performance) => performance.alert,
  ).length;

  return (
    <section
      className={`regime-performance-board${alertCount ? " regime-performance-has-alert" : ""}`}
      aria-label="市場局面別の紙上成績と悪化アラート"
    >
      <div className="regime-performance-heading">
        <div><span>REGIME ATTRIBUTION</span><strong>どの相場で、勝ち負けているか。</strong></div>
        <small>{alertCount ? `${alertCount} PERFORMANCE ALERT` : "30D · CORE CHART · RESEARCH ONLY"}</small>
      </div>
      <div className="regime-performance-grid">
        {journal.regimePerformance.map((performance) => (
          <article
            className={`regime-performance-${performance.status}`}
            key={performance.regime}
          >
            <div>
              <span>{regimePerformanceLabels[performance.regime]}</span>
              <small>{performance.maturedCount}/{performance.minimumSamples} SETTLED</small>
            </div>
            <b>{regimePerformanceStatusLabels[performance.status]}</b>
            <strong className={performance.netPnlUsd < 0 ? "negative" : performance.netPnlUsd > 0 ? "positive" : ""}>
              {performance.maturedCount ? signedPercent(performance.averageNetReturnPercent) : "—"}
            </strong>
            <small>WR {performance.maturedCount ? `${performance.winRate.toFixed(0)}%` : "—"} · PF {performance.profitFactor === null ? "—" : performance.profitFactor.toFixed(2)}</small>
            <small>{performance.reasons[0]}</small>
          </article>
        ))}
      </div>
      <p>
        10件以上で、30日損益がマイナスかつ平均リターン≤-1%またはPF&lt;0.80なら警告します。
        分析表示のみで、既存の戦略切替・BUY／SELL判定を自動変更しません。
      </p>
    </section>
  );
}

const scoringStatusLabels = {
  collecting: "COLLECTING",
  "barrier-better": "EXIT RULES BETTER",
  "barrier-worse": "EXIT RULES WORSE",
  similar: "NO CLEAR GAP",
} as const;

const scoringStatusClasses = {
  collecting: "collecting",
  "barrier-better": "monitoring",
  "barrier-worse": "alert",
  similar: "monitoring",
} as const;

function formatInterval(low: number | null, high: number | null): string {
  return low === null || high === null
    ? "—"
    : `${signedPercent(low)} … ${signedPercent(high)}`;
}

function ScoringComparisonBoard({ journal }: { journal: PaperJournalSnapshot }) {
  const comparison = journal.scoringComparison;
  const statusClass = `regime-performance-${scoringStatusClasses[comparison.status]}`;
  const summaries = [
    { key: "fixed", label: "6H FIXED", summary: comparison.fixedHorizon },
    { key: "barrier", label: "EXIT RULES", summary: comparison.barrier },
  ] as const;

  return (
    <section
      className={`regime-performance-board${comparison.status === "barrier-worse" ? " regime-performance-has-alert" : ""}`}
      aria-label="損切り・利確ルールによる採点と保有時間別の成績"
    >
      <div className="regime-performance-heading">
        <div><span>EXIT-RULE SCORING</span><strong>実際の出口で採点すると、どう変わるか。</strong></div>
        <small>30D · CORE CHART · RESEARCH ONLY</small>
      </div>
      <div className="regime-performance-grid">
        {summaries.map(({ key, label, summary }) => (
          <article className={statusClass} key={key}>
            <div>
              <span>{label}</span>
              <small>{comparison.pairedCount}/{comparison.minimumSamples} PAIRED</small>
            </div>
            <b>{key === "barrier" ? scoringStatusLabels[comparison.status] : "PROMOTION BASIS"}</b>
            <strong className={summary.netPnlUsd < 0 ? "negative" : summary.netPnlUsd > 0 ? "positive" : ""}>
              {comparison.pairedCount ? signedPercent(summary.averageNetReturnPercent) : "—"}
            </strong>
            <small>WR {comparison.pairedCount ? `${summary.winRate.toFixed(0)}%` : "—"} · PF {summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}</small>
            {key === "barrier" ? (
              <small>
                TP {comparison.exitMix["take-profit"]} · SL {comparison.exitMix["stop-loss"]} · TRAIL {comparison.exitMix["trailing-stop"]} · 6H {comparison.exitMix.horizon}
              </small>
            ) : (
              <small>{comparison.sparsePathCount} SPARSE PATHS EXCLUDED</small>
            )}
          </article>
        ))}
        <article className={statusClass}>
          <div>
            <span>DIFFERENCE</span>
            <small>{comparison.independentSampleCount}/{comparison.minimumIndependentSamples} SCANS</small>
          </div>
          <b>EXIT RULES − 6H</b>
          <strong>
            {comparison.pairedCount
              ? signedPercent(comparison.barrier.averageNetReturnPercent - comparison.fixedHorizon.averageNetReturnPercent)
              : "—"}
          </strong>
          <small>95% CI {formatInterval(comparison.differenceLowPercent, comparison.differenceHighPercent)}</small>
          <small>{comparison.reasons[0]}</small>
        </article>
        {comparison.horizons.map((horizon) => (
          <article className="regime-performance-monitoring" key={horizon.horizon}>
            <div>
              <span>HOLD {horizon.hours}H</span>
              <small>{horizon.maturedCount} SETTLED · {horizon.independentSampleCount} SCANS</small>
            </div>
            <b>NET RETURN</b>
            <strong className={(horizon.averageNetReturnPercent ?? 0) < 0 ? "negative" : (horizon.averageNetReturnPercent ?? 0) > 0 ? "positive" : ""}>
              {horizon.averageNetReturnPercent === null ? "—" : signedPercent(horizon.averageNetReturnPercent)}
            </strong>
            <small>95% CI {formatInterval(horizon.confidenceLowPercent, horizon.confidenceHighPercent)}</small>
          </article>
        ))}
      </div>
      <p>
        同じシグナルを、6時間後の価格（昇格判定に使用）と、シグナル時点の損切り・トレーリングストップ・利確ルールの両方で採点します。
        5分ごとの価格しか無いため、損切りは観測価格、利確は目標価格で約定したとみなす保守的な計算です。
        分析表示のみで、昇格条件・売買判定を自動変更しません。
      </p>
    </section>
  );
}

const orderFlowFeatureLabels = {
  "buy-share-h1": "BUY SHARE 1H",
  "buy-share-h6": "BUY SHARE 6H",
  "volume-acceleration-h1": "VOLUME PACE 1H",
} as const;

const orderFlowStatusLabels = {
  collecting: "COLLECTING",
  "supports-signal": "HELPS",
  "contradicts-signal": "HURTS",
  "no-edge": "NO EDGE",
} as const;

const orderFlowStatusClasses = {
  collecting: "collecting",
  "supports-signal": "monitoring",
  "contradicts-signal": "alert",
  "no-edge": "monitoring",
} as const;

function OrderFlowAttributionBoard({ journal }: { journal: PaperJournalSnapshot }) {
  const attribution = journal.orderFlowAttribution;
  return (
    <section className="regime-performance-board" aria-label="シグナル時点の売買フローと成績の関係">
      <div className="regime-performance-heading">
        <div><span>ORDER FLOW ATTRIBUTION</span><strong>買いの勢いは、シグナルの当たりを分けるか。</strong></div>
        <small>{attribution.evidencedCount} SIGNALS · 30D · RESEARCH ONLY</small>
      </div>
      <div className="regime-performance-grid">
        {attribution.rows.map((row) => (
          <article
            className={`regime-performance-${orderFlowStatusClasses[row.status]}`}
            key={`${row.feature}-${row.horizon}`}
          >
            <div>
              <span>{orderFlowFeatureLabels[row.feature]} → {row.horizon === "h1" ? "1H" : "6H"}</span>
              <small>{row.favorableCount} / {row.unfavorableCount} · MIN {attribution.minimumSamplesPerGroup} EACH</small>
            </div>
            <b>{orderFlowStatusLabels[row.status]}</b>
            <strong>
              {row.favorableAverageNetReturnPercent === null || row.unfavorableAverageNetReturnPercent === null
                ? "—"
                : signedPercent(row.favorableAverageNetReturnPercent - row.unfavorableAverageNetReturnPercent)}
            </strong>
            <small>CI {formatInterval(row.differenceLowPercent, row.differenceHighPercent)}</small>
            <small>
              {row.feature === "volume-acceleration-h1" ? "BUSY " : "WITH "}
              {row.favorableAverageNetReturnPercent === null ? "—" : signedPercent(row.favorableAverageNetReturnPercent)}
              {row.feature === "volume-acceleration-h1" ? " · QUIET " : " · AGAINST "}
              {row.unfavorableAverageNetReturnPercent === null ? "—" : signedPercent(row.unfavorableAverageNetReturnPercent)}
            </small>
          </article>
        ))}
      </div>
      <p>
        売買シグナルの時点で、DEXの買い取引比率が55%以上（SELLは売り55%以上）の場合と45%以下の場合、
        直近1時間の出来高が24時間平均の1.5倍以上と0.75倍以下の場合で、その後のコスト控除後リターンを比べます。
        6つの比較をまとめて誤検出5%に抑えるため、各区間は{(attribution.familyConfidence * 100).toFixed(2)}%で計算します。
        チャートモデルはこの値を使っていません。
      </p>
    </section>
  );
}

const buyGateLabels = {
  passed: "PASSED",
  "not-tradable": "NOT TRADABLE",
  "contract-safety": "CONTRACT",
  "quote-preflight": "QUOTE",
  "onchain-preflight": "ONCHAIN",
  robustness: "ROBUSTNESS",
  "cost-gate": "COST GATE",
  "model-drift": "MODEL DRIFT",
  "portfolio-risk": "PORTFOLIO RISK",
  budget: "BUDGET",
  "not-in-plan": "NOT IN PLAN",
  unknown: "LEGACY",
} as const;

const buyGateStatusLabels = {
  baseline: "BASELINE",
  collecting: "COLLECTING",
  protective: "PROTECTIVE",
  "missed-profit": "MISSED PROFIT",
  inconclusive: "INCONCLUSIVE",
} as const;

const buyGateStatusClasses = {
  baseline: "monitoring",
  collecting: "collecting",
  protective: "monitoring",
  "missed-profit": "alert",
  inconclusive: "monitoring",
} as const;

function BuyGatePerformanceBoard({ journal }: { journal: PaperJournalSnapshot }) {
  const missedCount = journal.buyGatePerformance.filter(
    (performance) => performance.status === "missed-profit",
  ).length;

  return (
    <section
      className={`regime-performance-board${missedCount ? " regime-performance-has-alert" : ""}`}
      aria-label="見送ったBUYの6時間後成績"
    >
      <div className="regime-performance-heading">
        <div><span>BUY GATE COUNTERFACTUAL</span><strong>止めたBUYは、正しかったか。</strong></div>
        <small>{missedCount ? `${missedCount} MISSED PROFIT` : "30D · CORE CHART · RESEARCH ONLY"}</small>
      </div>
      <div className="regime-performance-grid">
        {journal.buyGatePerformance.map((performance) => (
          <article
            className={`regime-performance-${buyGateStatusClasses[performance.status]}`}
            key={performance.gate}
          >
            <div>
              <span>{buyGateLabels[performance.gate]}</span>
              <small>
                {performance.gate === "passed"
                  ? `${performance.maturedCount} SETTLED`
                  : `SOLE ${performance.maturedCount}/${performance.minimumSamples} · ALL ${performance.blockedCount}`}
              </small>
            </div>
            <b>{buyGateStatusLabels[performance.status]}</b>
            <strong className={performance.netPnlUsd < 0 ? "negative" : performance.netPnlUsd > 0 ? "positive" : ""}>
              {performance.maturedCount ? signedPercent(performance.averageNetReturnPercent) : "—"}
            </strong>
            <small>
              95% CI {performance.confidenceLowPercent === null || performance.confidenceHighPercent === null
                ? "—"
                : `${signedPercent(performance.confidenceLowPercent)} … ${signedPercent(performance.confidenceHighPercent)}`}
              {" "}· {performance.independentSampleCount} SCANS
            </small>
            <small>WR {performance.maturedCount ? `${performance.winRate.toFixed(0)}%` : "—"} · PF {performance.profitFactor === null ? "—" : performance.profitFactor.toFixed(2)}</small>
            <small>{performance.reasons[0]}</small>
          </article>
        ))}
      </div>
      <p>
        見送ったBUYも、買っていた場合の6時間後コスト控除後リターンで採点します。
        各判定は「その判定だけが止めたBUY」で評価し、同じスキャンのBUYは1標本として95%区間を計算します。
        単独10件・5スキャン以上で、区間全体が0の片側にある場合だけ結論を出します。分析表示のみで、判定条件を自動変更しません。
      </p>
    </section>
  );
}

function PerformanceCurve({ journal }: { journal: PaperJournalSnapshot }) {
  const values = journal.performanceTimeline.map(
    (point) => point.cumulativeNetPnlUsd,
  );
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = Math.max(1, maximum - minimum);
  const points = values
    .map((value, index) => {
      const x = values.length > 1 ? (index / (values.length - 1)) * 100 : 0;
      const y = 34 - ((value - minimum) / range) * 30;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const lastPoint = journal.performanceTimeline.at(-1);

  return (
    <article className="performance-curve-card">
      <div className="performance-card-heading">
        <div>
          <span>30D CUMULATIVE P/L</span>
          <strong className={lastPoint && lastPoint.cumulativeNetPnlUsd < 0 ? "negative" : "positive"}>
            {lastPoint ? formatUsd(lastPoint.cumulativeNetPnlUsd) : "—"}
          </strong>
        </div>
        <small>CHART MODEL · COST INCLUDED</small>
      </div>
      {values.length ? (
        <svg className="performance-curve" viewBox="0 0 100 38" role="img" aria-label="30日間の累積ペーパー損益">
          <line x1="0" y1={(34 - ((0 - minimum) / range) * 30).toFixed(2)} x2="100" y2={(34 - ((0 - minimum) / range) * 30).toFixed(2)} />
          <polyline points={points} />
        </svg>
      ) : (
        <p className="performance-empty">30日分析データを収集中です。</p>
      )}
      <div className="performance-axis"><span>30 DAYS AGO</span><span>TODAY</span></div>
    </article>
  );
}

function PerformanceLens({ journal }: { journal: PaperJournalSnapshot }) {
  return (
    <div className="performance-lens" aria-label="ペーパートレード詳細分析">
      <div className="performance-lens-heading">
        <div><span>PERFORMANCE LENS</span><strong>勝率の先まで見る。</strong></div>
        <small>{journal.analyticsWindowDays}D ANALYTICS / {journal.windowDays}D PROMOTION GATE</small>
      </div>

      <div className="period-performance-grid">
        {journal.periodPerformance.map((period) => (
          <article key={period.days}>
            <div><span>{period.days === 1 ? "24H" : `${period.days}D`}</span><small>{period.maturedCount} SETTLED</small></div>
            <strong className={period.netPnlUsd > 0 ? "positive" : period.netPnlUsd < 0 ? "negative" : "muted"}>
              {period.maturedCount ? formatUsd(period.netPnlUsd) : "—"}
            </strong>
            <dl>
              <div><dt>WIN</dt><dd>{period.maturedCount ? `${period.winRate.toFixed(1)}%` : "—"}</dd></div>
              <div><dt>PF</dt><dd>{period.profitFactor === null ? "—" : period.profitFactor.toFixed(2)}</dd></div>
              <div><dt>MAX DD</dt><dd>{period.maturedCount ? `${period.maxDrawdownPercent.toFixed(2)}%` : "—"}</dd></div>
            </dl>
          </article>
        ))}
      </div>

      <section className="data-quality-performance" aria-label="判断時データ品質別の30日成績">
        <div className="performance-card-heading">
          <div><span>ENTRY DATA QUALITY</span><strong>判断時のデータ品質別成績</strong></div>
          <small>30D · CHART MODEL · RESEARCH ONLY</small>
        </div>
        <div className="data-quality-performance-grid">
          {journal.dataQualityPerformance.map((performance) => (
            <article key={performance.band} className={`data-quality-band-${performance.band}`}>
              <div>
                <span>{decisionDataQualityLabels[performance.band]}</span>
                <small>{performance.status.toUpperCase()}</small>
              </div>
              <strong className={performance.netPnlUsd > 0 ? "positive" : performance.netPnlUsd < 0 ? "negative" : "muted"}>
                {performance.maturedCount ? `${performance.netPnlUsd > 0 ? "+" : ""}${formatUsd(performance.netPnlUsd)}` : "—"}
              </strong>
              <small>{performance.maturedCount}/{performance.minimumSamples} SAMPLES · WIN {performance.maturedCount ? `${performance.winRate.toFixed(1)}%` : "—"}</small>
              <small>AVG NET {performance.maturedCount ? signedPercent(performance.averageNetReturnPercent) : "—"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="source-quality-impact" aria-label="取得元別の品質影響分析">
        <div className="performance-card-heading">
          <div><span>SOURCE IMPACT</span><strong>欠損時と正常時の成績差</strong></div>
          <small>30D · MIN 10 + 10 · RESEARCH ONLY</small>
        </div>
        <div className="source-quality-impact-grid">
          {journal.sourceQualityImpact.map((impact) => (
            <article key={impact.source} className={`source-impact-${impact.status}`}>
              <div>
                <span>{dataSourceLabels[impact.source]}</span>
                <small>{sourceQualityImpactStatusLabels[impact.status]}</small>
              </div>
              <strong className={impact.status === "performance-alert" ? "negative" : ""}>
                {impact.cleanCount && impact.impairedCount ? signedPercent(impact.returnGapPercentagePoints) : "—"}
              </strong>
              <small>RETURN GAP · IMPAIRED − CLEAN</small>
              <dl>
                <div><dt>CLEAN</dt><dd>{impact.cleanCount}/{impact.minimumSamples} · {impact.cleanCount ? signedPercent(impact.cleanAverageNetReturnPercent) : "—"}</dd></div>
                <div><dt>IMPAIRED</dt><dd>{impact.impairedCount}/{impact.minimumSamples} · {impact.impairedCount ? signedPercent(impact.impairedAverageNetReturnPercent) : "—"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="source-reason-impact" aria-label="取得元劣化時の判断理由別影響分析">
        <div className="performance-card-heading">
          <div><span>REASON ATTRIBUTION</span><strong>劣化の影響を受けた判断理由</strong></div>
          <small>30D · SAME REASON · MIN 5 + 5 · RESEARCH ONLY</small>
        </div>
        <div className="source-reason-impact-grid">
          {journal.sourceReasonImpact.map((impact) => (
            <article key={impact.source} className={`source-reason-${impact.status}`}>
              <div>
                <span>{dataSourceLabels[impact.source]}</span>
                <small>{sourceReasonImpactStatusLabels[impact.status]}</small>
              </div>
              <strong>{impact.reason ?? "判断理由を収集中"}</strong>
              <p className={impact.status === "performance-alert" ? "negative" : "muted"}>
                {impact.cleanCount && impact.impairedCount
                  ? `${signedPercent(impact.returnGapPercentagePoints)} RETURN GAP`
                  : "比較データ待ち"}
              </p>
              <small>CLEAN {impact.cleanCount}/{impact.minimumSamples} · IMPAIRED {impact.impairedCount}/{impact.minimumSamples}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="performance-detail-grid">
        <PerformanceCurve journal={journal} />
        <article className="asset-performance-card">
          <div className="performance-card-heading">
            <div><span>ASSET LEADERBOARD</span><strong>30D NET P/L</strong></div>
            <small>TOP 6 · CHART MODEL</small>
          </div>
          {journal.assetPerformance.length ? (
            <div className="asset-performance-list">
              {journal.assetPerformance.map((asset, index) => (
                <div key={asset.symbol}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{asset.symbol}</strong>
                  <small>{asset.maturedCount} trades · {asset.winRate.toFixed(0)}% win</small>
                  <strong className={asset.netPnlUsd > 0 ? "positive" : asset.netPnlUsd < 0 ? "negative" : "muted"}>
                    {asset.netPnlUsd > 0 ? "+" : ""}{formatUsd(asset.netPnlUsd)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="performance-empty">銘柄別に集計できる結果はまだありません。</p>
          )}
        </article>
      </div>

      <div className="payoff-strip">
        <div><span>AVG WIN</span><strong>{journal.averageWinPercent ? signedPercent(journal.averageWinPercent) : "—"}</strong></div>
        <div><span>AVG LOSS</span><strong className="negative">{journal.averageLossPercent ? signedPercent(journal.averageLossPercent) : "—"}</strong></div>
        <div><span>PAYOFF RATIO</span><strong>{journal.payoffRatio === null ? "—" : `${journal.payoffRatio.toFixed(2)}x`}</strong></div>
        <p>平均利益 ÷ 平均損失。勝率だけでは見えない、1回の勝ちと負けの釣り合いです。</p>
      </div>
    </div>
  );
}

function PaperJournalBoard({ journal }: { journal: PaperJournalSnapshot }) {
  const progress = Math.min(
    100,
    (journal.maturedCount / journal.qualification.minimumSamples) * 100,
  );
  const netClass =
    journal.netPnlUsd > 0 ? "positive" : journal.netPnlUsd < 0 ? "negative" : "muted";
  const readiness = journal.operationalReadiness;

  return (
    <section className="journal-board shell" aria-labelledby="journal-title">
      <div className="journal-heading">
        <div>
          <span className="section-index">04 / FORWARD TEST</span>
          <h2 id="journal-title">7日間、未来の値動きで採点する。</h2>
          <p>
            同じシグナルの連打を6時間抑制し、6時間後の価格で方向を判定。
            ガス代・スリッページを引いた結果だけを合格判定に使います。
          </p>
        </div>
        <span className={`journal-status journal-status-${journal.status}`}>
          {journalStatusLabels[journal.status]}
        </span>
      </div>

      <nav className="research-export-links" aria-label="紙上分析データのダウンロード">
        <span>RESEARCH EXPORT</span>
        <a href="/api/paper/export">OUTCOMES CSV</a>
        <a href="/api/paper/export?dataset=confidence&amp;format=csv">CONFIDENCE CSV</a>
        <a href="/api/paper/export?dataset=regimes&amp;format=csv">REGIMES CSV</a>
        <a href="/api/paper/export?dataset=data-quality&amp;format=csv">DATA QUALITY CSV</a>
        <a href="/api/paper/export?dataset=source-impact&amp;format=csv">SOURCE IMPACT CSV</a>
        <a href="/api/paper/export?dataset=source-reasons&amp;format=csv">SOURCE REASONS CSV</a>
        <a href="/api/paper/export?dataset=research&amp;format=json">RESEARCH JSON</a>
      </nav>

      <div className="journal-progress" aria-label={`採点済み ${journal.maturedCount} / ${journal.qualification.minimumSamples}`}>
        <div>
          <strong>{journal.maturedCount}</strong>
          <span>/ {journal.qualification.minimumSamples} MINIMUM OUTCOMES</span>
        </div>
        <div className="journal-progress-track"><i style={{ width: `${progress}%` }} /></div>
        <small>{journal.message}</small>
      </div>

      <div className="readiness-grid" aria-label="紙上運用準備度">
        <div>
          <span>OBSERVATION</span>
          <strong className={readiness.observationPassed ? "positive" : ""}>
            {readiness.observationHours.toFixed(1)}H
          </strong>
          <small>/ {readiness.minimumObservationHours}H</small>
        </div>
        <div>
          <span>24H SCAN COVERAGE</span>
          <strong className={readiness.scanCoveragePassed ? "positive" : ""}>
            {readiness.scanCoverage24hPercent.toFixed(1)}%
          </strong>
          <small>target ≥ {readiness.minimumScanCoveragePercent}%</small>
        </div>
        <div>
          <span>LATEST SCAN</span>
          <strong className={readiness.latestScanFresh ? "positive" : "negative"}>
            {readiness.latestScanFresh ? "FRESH" : "STALE"}
          </strong>
          <small>within 12 minutes</small>
        </div>
        <div>
          <span>OPERATIONAL GATE</span>
          <strong className={readiness.overallPassed ? "positive" : ""}>
            {readiness.status.toUpperCase()}
          </strong>
          <small>paper only</small>
        </div>
      </div>

      <div className="journal-metrics">
        <div><span>WIN RATE</span><strong>{journal.maturedCount ? `${journal.winRate.toFixed(1)}%` : "—"}</strong><small>{journal.maturedCount} settled</small></div>
        <div><span>NET PAPER P/L</span><strong className={netClass}>{journal.maturedCount ? formatUsd(journal.netPnlUsd) : "—"}</strong><small>cost included</small></div>
        <div><span>PROFIT FACTOR</span><strong>{journal.profitFactor === null ? "—" : journal.profitFactor.toFixed(2)}</strong><small>target ≥ 1.20</small></div>
        <div><span>MAX DRAWDOWN</span><strong>{journal.maturedCount ? `${journal.maxDrawdownPercent.toFixed(2)}%` : "—"}</strong><small>{journal.maturedCount ? formatUsd(journal.maxDrawdownUsd) : "no outcomes"}</small></div>
        <div><span>CURRENT STREAK</span><strong>{journal.maturedCount ? journal.currentLossStreak : "—"}</strong><small>max {journal.longestLossStreak} losses</small></div>
        <div><span>COST GATE</span><strong>{journal.signalCount ? `${journal.costGatePassRate.toFixed(1)}%` : "—"}</strong><small>{journal.costGatePassedCount}/{journal.signalCount} signals</small></div>
      </div>

      <div className="model-performance-grid" aria-label="モデル別フォワード成績">
        <ModelPerformanceCard
          label="CORE CHART"
          description="保有銘柄・3時間軸モデル"
          performance={journal.modelPerformance.chart}
        />
        <ModelPerformanceCard
          label="COMMUNITY TREND"
          description="外部トレンド・紙上スワップ"
          performance={journal.modelPerformance["community-trend"]}
        />
      </div>

      <ConfidenceCalibrationBoard journal={journal} />

      <RegimePerformanceBoard journal={journal} />
      <BuyGatePerformanceBoard journal={journal} />
      <ScoringComparisonBoard journal={journal} />
      <OrderFlowAttributionBoard journal={journal} />

      <PerformanceLens journal={journal} />

      <div className="journal-lower">
        <div className="qualification-card">
          <span>MODEL PROMOTION GATE</span>
          <ul>
            <QualificationItem passed={readiness.observationPassed}>7日・168時間以上を観測</QualificationItem>
            <QualificationItem passed={readiness.scanCoveragePassed}>24時間スキャン網羅率80%以上</QualificationItem>
            <QualificationItem passed={readiness.latestScanFresh}>最新スキャンが12分以内</QualificationItem>
            <QualificationItem passed={journal.qualification.samplePassed}>30件以上を採点</QualificationItem>
            <QualificationItem passed={journal.qualification.netProfitPassed}>コスト後損益がプラス</QualificationItem>
            <QualificationItem passed={journal.qualification.profitFactorPassed}>PF 1.20以上</QualificationItem>
            <QualificationItem passed={journal.qualification.drawdownPassed}>最大DD 8%以下</QualificationItem>
            <QualificationItem passed={journal.qualification.costCoveragePassed}>コスト通過率70%以上</QualificationItem>
          </ul>
        </div>

        <div className="outcome-card">
          <div className="outcome-heading">
            <span>RECENT 6H OUTCOMES</span>
            <small>{journal.scanCount} SCANS / {journal.pendingCount} PENDING</small>
          </div>
          {journal.recentOutcomes.length ? (
            <div className="outcome-list outcome-audit-list">
              {journal.recentOutcomes.map((outcome) => (
                <article key={outcome.decisionId ?? `${outcome.symbol}-${outcome.signalTime}`}>
                  <div className="outcome-audit-summary">
                    <span className={`signal signal-${outcome.direction.toLowerCase()}`}>{outcome.direction}</span>
                    <div>
                      <strong>{outcome.symbol}</strong>
                      <small>{outcome.model === "community-trend" ? "COMMUNITY TREND" : "CORE CHART"}</small>
                    </div>
                    <span>{outcome.netReturnPercent >= 0 ? "+" : ""}{outcome.netReturnPercent.toFixed(2)}%</span>
                    <strong className={outcome.won ? "positive" : "negative"}>{outcome.netPnlUsd >= 0 ? "+" : ""}{formatUsd(outcome.netPnlUsd)}</strong>
                  </div>
                  <dl className="outcome-audit-metrics">
                    <div><dt>SCORE</dt><dd>{outcome.modelScore.toFixed(0)}</dd></div>
                    <div><dt>CONF.</dt><dd>{outcome.confidence.toFixed(0)}</dd></div>
                    <div><dt>ENTRY</dt><dd>{formatUsd(outcome.entryPriceUsd)}</dd></div>
                    <div><dt>6H EXIT</dt><dd>{formatUsd(outcome.exitPriceUsd)}</dd></div>
                    <div><dt>COST</dt><dd>{formatUsd(outcome.estimatedCostUsd)}</dd></div>
                  </dl>
                  <div className="outcome-audit-reasons">
                    <span>DECISION REASONS</span>
                    {outcome.decisionReasons?.length ? (
                      <ul>{outcome.decisionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    ) : (
                      <small>旧レコードのため判断理由は保存されていません。</small>
                    )}
                  </div>
                  <div className={`outcome-data-quality outcome-data-quality-${outcome.entryDataQuality?.status ?? "unknown"}`}>
                    <span>ENTRY DATA · {decisionDataQualityLabels[outcome.entryDataQuality?.status ?? "unknown"]}</span>
                    {outcome.entryDataQuality ? (
                      <small>
                        AVG COVERAGE {outcome.entryDataQuality.averageCoveragePercent.toFixed(1)}%
                        {outcome.entryDataQuality.unavailableSources.length ? ` · NO SAMPLE ${outcome.entryDataQuality.unavailableSources.join(" / ")}` : ""}
                        {outcome.entryDataQuality.degradedSources.length ? ` · PARTIAL ${outcome.entryDataQuality.degradedSources.join(" / ")}` : ""}
                      </small>
                    ) : (
                      <small>旧レコードのため判断時の取得元品質は保存されていません。</small>
                    )}
                  </div>
                  <small className="outcome-audit-id">{outcome.decisionId ?? "LEGACY DECISION"} · {new Date(outcome.signalTime).toISOString()}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="outcome-empty">採点可能な結果はまだありません。</p>
          )}
        </div>
      </div>

      <p className="journal-disclaimer">
        これは方向シグナルの紙上評価です。実際の約定や利益を保証せず、秘密鍵・署名・トークン承認は一切使用しません。
      </p>
    </section>
  );
}

const portfolioRiskLabels = {
  pass: "PASS",
  blocked: "BLOCKED",
  unavailable: "DATA WAIT",
} as const;

const modelDriftLabels = {
  stable: "STABLE",
  degraded: "BUY BLOCK",
  recovering: "RECOVERY HOLD",
  collecting: "COLLECTING",
  unavailable: "DATA WAIT",
} as const;

function DriftModelCard({
  drift,
  label,
}: {
  drift: ModelDriftAssessment;
  label: string;
}) {
  const gapClass =
    drift.averageReturnDropPercentagePoints >=
    drift.limits.averageReturnDropPercentagePoints
      ? "negative"
      : "";

  return (
    <article className={`model-drift-card model-drift-card-${drift.status}`}>
      <div className="model-drift-card-heading">
        <div><span>{label}</span><strong>RECENT 7D VS PREVIOUS 23D</strong></div>
        <span className={`portfolio-risk-status model-drift-status-${drift.status}`}>
          {modelDriftLabels[drift.status]}
        </span>
      </div>
      <div className="model-drift-metrics">
        <div>
          <span>7D AVG RETURN</span>
          <strong>{drift.recentSamples ? signedPercent(drift.recentAverageNetReturnPercent) : "—"}</strong>
          <small>{drift.recentSamples}/{drift.limits.minimumRecentSamples} SETTLED</small>
        </div>
        <div>
          <span>PREVIOUS 23D</span>
          <strong>{drift.baselineSamples ? signedPercent(drift.baselineAverageNetReturnPercent) : "—"}</strong>
          <small>{drift.baselineSamples}/{drift.limits.minimumBaselineSamples} SETTLED</small>
        </div>
        <div>
          <span>RETURN GAP</span>
          <strong className={gapClass}>{drift.averageReturnDropPercentagePoints.toFixed(2)}PT</strong>
          <small>BLOCK LINE {drift.limits.averageReturnDropPercentagePoints.toFixed(1)}PT + NEGATIVE P/L</small>
        </div>
        <div>
          <span>7D / 30D PF</span>
          <strong>
            {drift.recentProfitFactor === null ? "—" : drift.recentProfitFactor.toFixed(2)} / {drift.baselineProfitFactor === null ? "—" : drift.baselineProfitFactor.toFixed(2)}
          </strong>
          <small>RECENT &lt; {drift.limits.recentProfitFactor.toFixed(1)} / BASE ≥ {drift.limits.baselineProfitFactor.toFixed(1)}</small>
        </div>
      </div>
      <div className="model-drift-reasons">
        <span>{drift.blockNewBuys ? "BUY GATE CLOSED" : "BUY GATE OBSERVE"}</span>
        <ul>{drift.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <small>
          RECOVERY CHECK {drift.recoveryConfirmationHours}H / {drift.recoveryConfirmationPassed ? "PASSED" : "PENDING"}
        </small>
      </div>
    </article>
  );
}

function ModelDriftBoard({ drift }: { drift: ModelDriftSnapshot }) {
  const assessments = [drift.chart, drift["community-trend"]];
  const status = assessments.some((item) => item.status === "unavailable")
    ? "unavailable"
    : assessments.some((item) => item.status === "degraded")
      ? "degraded"
      : assessments.some((item) => item.status === "recovering")
        ? "recovering"
      : assessments.some((item) => item.status === "collecting")
        ? "collecting"
        : "stable";

  return (
    <section
      className={`portfolio-risk-board model-drift-board model-drift-${status} shell`}
      aria-labelledby="model-drift-title"
    >
      <div className="portfolio-risk-heading">
        <div>
          <span className="section-index">05 / MODEL DRIFT</span>
          <h2 id="model-drift-title">悪化したモデルだけを、切り離す。</h2>
          <p>
            チャートとコミュニティトレンドを別々に直近7日対直前23日で比較します。
            悪化した側は12時間の回復確認後にだけ再開し、正常なモデルとSELL経路は維持します。
          </p>
        </div>
        <span className={`portfolio-risk-status model-drift-status-${status}`}>
          {modelDriftLabels[status]}
        </span>
      </div>
      <div className="model-drift-grid">
        <DriftModelCard drift={drift.chart} label="CORE CHART" />
        <DriftModelCard drift={drift["community-trend"]} label="COMMUNITY TREND" />
      </div>
    </section>
  );
}

function PortfolioRiskBoard({ risk }: { risk: PortfolioRiskAssessment }) {
  const pnlClass =
    risk.dailyNetPnlUsd > 0
      ? "positive"
      : risk.dailyNetPnlUsd < 0
        ? "negative"
        : "muted";

  return (
    <section
      className={`portfolio-risk-board portfolio-risk-${risk.status} shell`}
      aria-labelledby="portfolio-risk-title"
    >
      <div className="portfolio-risk-heading">
        <div>
          <span className="section-index">06 / PORTFOLIO RISK</span>
          <h2 id="portfolio-risk-title">銘柄ではなく、資産全体で止める。</h2>
          <p>
            集中・相関・ETH連動・24時間損失・連敗を新規BUYの前に検査します。
            データ不足時もFail ClosedでBUYを止め、保有資産のSELL経路は維持します。
          </p>
        </div>
        <span className={`portfolio-risk-status portfolio-risk-status-${risk.status}`}>
          {portfolioRiskLabels[risk.status]}
        </span>
      </div>

      <div className="portfolio-risk-metrics">
        <div>
          <span>MAX SINGLE ASSET</span>
          <strong className={risk.maxSingleAssetPercent > risk.limits.singleAssetPercent ? "negative" : ""}>
            {risk.maxSingleAssetPercent.toFixed(1)}%
          </strong>
          <small>{risk.maxSingleAssetSymbol ?? "NO ASSET"} · LIMIT {risk.limits.singleAssetPercent}%</small>
        </div>
        <div>
          <span>MAX ETH CORR.</span>
          <strong className={risk.maxEthCorrelation !== null && risk.maxEthCorrelation >= risk.limits.correlation ? "negative" : ""}>
            {risk.maxEthCorrelation === null ? "—" : risk.maxEthCorrelation.toFixed(2)}
          </strong>
          <small>{risk.maxEthCorrelationSymbol ?? "DATA WAIT"} · LIMIT {risk.limits.correlation.toFixed(2)}</small>
          <small>{risk.maxEthCorrelationSampleCount ?? 0} ALIGNED RETURNS</small>
        </div>
        <div>
          <span>24H PAPER P/L</span>
          <strong className={pnlClass}>
            {risk.dailyNetPnlUsd > 0 ? "+" : ""}{formatUsd(risk.dailyNetPnlUsd)}
          </strong>
          <small>LOSS {risk.dailyLossPercent.toFixed(2)}% · LIMIT {risk.limits.dailyLossPercent}%</small>
        </div>
        <div>
          <span>CURRENT LOSS STREAK</span>
          <strong className={risk.currentLossStreak >= risk.limits.lossStreak ? "negative" : ""}>
            {risk.currentLossStreak}
          </strong>
          <small>MAX {risk.longestLossStreak} · LIMIT {risk.limits.lossStreak}</small>
        </div>
      </div>

      <div className="portfolio-risk-reasons">
        <span>
          {risk.blockNewBuys ? "BUY GATE CLOSED" : "BUY GATE OPEN"}<br />
          TIME JOIN · MIN {risk.minimumCorrelationSampleCount ?? 0} RETURNS
        </span>
        <ul>
          {risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
    </section>
  );
}

export function Dashboard({
  snapshot,
  chartModel,
  plan,
  journal,
  trendScout,
  safetyControl,
  dataSourceQuality,
}: {
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
  plan: StrategyPlan;
  journal: PaperJournalSnapshot;
  trendScout: TrendScoutSnapshot;
  safetyControl: SafetyControlSnapshot;
  dataSourceQuality: DataSourceQualitySnapshot;
}) {
  const signals = new Map(plan.signals.map((signal) => [signal.symbol, signal]));
  const actionableSignals = plan.signals.filter((signal) =>
    ["BUY", "SELL"].includes(signal.action),
  );
  const safetyDecisionSummary = createSafetyDecisionSummaryView({ plan, safetyControl });

  return (
    <main>
      <header className="topbar shell">
        <a className="brand" href="#top" aria-label="SUMI TRADE LAB ホーム">
          <span className="brand-mark">S</span>
          <span>
            SUMI <b>TRADE LAB</b>
          </span>
        </a>
        <div className="top-status">
          <span className="mode-pill">PAPER MODE</span>
          <span className="network-pill"><i /> ETHEREUM</span>
        </div>
      </header>

      <section id="top" className="hero shell">
        <div className="hero-copy">
          <span className="eyebrow">MULTI-TIMEFRAME WALLET EXPERIMENT / 02</span>
          <h1><em>条件</em>で売買する。</h1>
          <p>
            コントラクト、流動性、市場局面、5分・15分・1時間の方向を重ね、コスト後も優位性が残る場面だけを評価。
            現在は実資産を動かさず、同じウォレットで判断精度を鍛えます。
          </p>
        </div>
        <div className="wallet-card">
          <span>CONNECTED WALLET</span>
          <strong>{shortAddress(snapshot.walletAddress)}</strong>
          <div className="wallet-lock"><i /> EXECUTION HARD-LOCKED</div>
        </div>
      </section>

      <section className="metrics shell" aria-label="資産概要">
        <div className="metric metric-primary">
          <span>PORTFOLIO VALUE</span>
          <strong>{formatUsd(snapshot.totalUsd)}</strong>
          <small>公開価格による概算</small>
        </div>
        <div className="metric">
          <span>AUTO-ELIGIBLE</span>
          <strong>{formatUsd(snapshot.tradeableUsd)}</strong>
          <small>市場・契約ゲート通過額</small>
        </div>
        <div className="metric">
          <span>GAS RESERVE</span>
          <strong>{snapshot.gasBalanceEth.toFixed(5)} ETH</strong>
          <small>{formatUsd(snapshot.gasBalanceUsd)} / 最低 {snapshot.gasReserveEth} ETH</small>
        </div>
        <div className="metric metric-alert">
          <span>BLOCKED VALUE</span>
          <strong>{formatUsd(snapshot.blockedUsd)}</strong>
          <small>自動注文から隔離</small>
        </div>
      </section>

      <section className="system-strip shell" aria-label="システム構成">
        <div><span>01</span><strong>READ</strong><small>公開残高</small></div>
        <i />
        <div><span>02</span><strong>VERIFY</strong><small>契約・双方向見積</small></div>
        <i />
        <div><span>03</span><strong>TREND</strong><small>話題性</small></div>
        <i />
        <div><span>04</span><strong>MODEL</strong><small>3時間軸</small></div>
        <i />
        <div><span>05</span><strong>LOCK</strong><small>署名禁止</small></div>
      </section>

      {snapshot.warnings.length > 0 ? (
        <section className="warning-stack shell" aria-label="警告">
          {snapshot.warnings.map((warning) => (
            <p key={warning}><span>!</span>{warning}</p>
          ))}
        </section>
      ) : null}

      <OperationalSafetyStrip safety={safetyControl} />

      <SafetyDecisionSummaryBoard view={safetyDecisionSummary} />

      <DataSourceQualityBoard
        quality={dataSourceQuality}
        history={journal.dataSourceQualityHistory24h}
        incidents={journal.dataSourceIncidents24h}
      />

      <ChartModelBoard chartModel={chartModel} />

      <StrategyComparisonBoard chartModel={chartModel} />

      <TrendScoutBoard trendScout={trendScout} />

      <PaperJournalBoard journal={journal} />

      <ModelDriftBoard drift={plan.modelDrift} />

      <PortfolioRiskBoard risk={plan.portfolioRisk} />

      <section className="workspace shell">
        <div className="portfolio-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">07 / WALLET</span>
              <h2>保有資産と実行判定</h2>
            </div>
            <span className="count-badge">{snapshot.assets.length} ASSETS</span>
          </div>
          <div className="asset-header" aria-hidden="true">
            <span>資産</span><span>残高</span><span>24H</span><span>流動性</span><span>判定</span>
          </div>
          <div className="asset-list">
            {snapshot.assets.map((asset) => (
              <AssetRow key={asset.symbol} asset={asset} signal={signals.get(asset.symbol)} />
            ))}
          </div>
        </div>

        <aside className="side-column">
          <div className="panel signal-panel">
            <div className="panel-heading compact">
              <div>
              <span className="section-index">08 / ORDERS</span>
                <h2>紙上オーダー</h2>
              </div>
              <span className="live-indicator"><i /> LIVE DATA</span>
            </div>
            <div className="signal-summary">
              <div><strong>{plan.summary.buyCount}</strong><span>BUY</span></div>
              <div><strong>{plan.summary.sellCount}</strong><span>SELL</span></div>
              <div><strong>{plan.summary.blockedCount}</strong><span>BLOCK</span></div>
            </div>
            <div className="order-list">
              {actionableSignals.length === 0 ? (
                <p className="empty-order">現在の条件では注文候補なし。HOLDを継続します。</p>
              ) : (
                actionableSignals.map((signal) => (
                  <div className="order" key={signal.symbol}>
                    <span className={`signal signal-${signal.action.toLowerCase()}`}>
                      {signal.action}
                    </span>
                    <div><strong>{signal.symbol}</strong><small>{signal.allocationPercent}%</small></div>
                    <strong>{formatUsd(signal.estimatedUsd)}</strong>
                  </div>
                ))
              )}
            </div>
            <p className="strategy-note">
              EMA 9/21 · RSI 14 · ATR 14<br />
              5M / 15M / 1H + REGIME + AMM IMPACT
            </p>
          </div>

          <PaperControls
            observedAt={snapshot.generatedAt}
            lastScanAt={journal.lastScanAt}
            scanCount={journal.scanCount}
            cadenceMinutes={chartModel.cadenceMinutes}
            journalStatus={journal.status}
            journalMessage={journal.message}
          />

          <div className="panel safety-panel">
            <span className="section-index">09 / SAFETY</span>
            <h2>実行ガード</h2>
            <ul>
              <li><i className="checked" />外部送金を禁止</li>
              <li><i className="checked" />未承認トークンを除外</li>
              <li><i className="checked" />BUY／SELL双方向見積</li>
              <li><i className="checked" />価格影響上限超を停止</li>
              <li><i className="checked" />集中・相関・24時間損失ゲート</li>
              <li><i className="checked" />7日対23日・12時間復旧確認ゲート</li>
              <li><i className="checked" />15分超の価格履歴を停止</li>
              <li><i className="checked" />永続緊急停止・決定ID重複防止</li>
              <li><i className="checked" />0.005 ETHを固定</li>
              <li><i className="checked" />オンチェーン署名なし</li>
              <li><i className="pending" />実売買接続は未実装</li>
            </ul>
          </div>
        </aside>
      </section>

      <footer className="footer shell">
        <span>SUMI TRADE LAB / BUILD 1.29</span>
        <span>READ-ONLY · STRATEGY LAB · PORTFOLIO RISK · ETHEREUM</span>
      </footer>
    </main>
  );
}
