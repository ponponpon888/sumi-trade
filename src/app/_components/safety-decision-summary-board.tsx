import type { CSSProperties } from "react";

import type {
  GlobalBuyBlocker,
  SafetyDecisionSummaryView,
} from "@/lib/safety-decision-summary-view";

// 表示専用。ここで表示する内容を売買判定へ戻してはならない。
// "no-blockers-observed" は BUY許可・安全・ready を意味しないため、許可を連想させる文言や色は使わない。

const neutralStatusStyle: CSSProperties = {
  borderColor: "var(--line-strong)",
  color: "var(--muted)",
};

const noteStyle: CSSProperties = {
  color: "var(--muted)",
  display: "block",
  fontSize: 11,
  lineHeight: 1.6,
  marginTop: 8,
};

const sectionStyle: CSSProperties = {
  marginTop: 18,
};

// The bottom border closes the top edge of the first .portfolio-risk-reasons row (which has border-top: 0).
const subheadingStyle: CSSProperties = {
  borderBottom: "1px solid var(--line)",
  color: "var(--text)",
  fontSize: 14,
  margin: 0,
  padding: "0 0 8px",
};

const globalBlockerLabels: Record<GlobalBuyBlocker["origin"], string> = {
  "chart-model-drift": "CHART MODEL DRIFT",
  "portfolio-risk": "PORTFOLIO RISK",
};

const statusBadgeLabels: Record<SafetyDecisionSummaryView["summaryState"], string> = {
  "blockers-observed": "LIMITS OBSERVED",
  indeterminate: "DATA INCOMPLETE",
  "no-blockers-observed": "NONE OBSERVED",
};

function headingFor(view: SafetyDecisionSummaryView): string {
  if (view.summaryState === "blockers-observed") {
    const count = view.globalBuyBlockers.length + view.assetBuyLimitations.length;
    return `現在の制限（${count}件）`;
  }
  if (view.summaryState === "indeterminate") {
    return "判定材料が不足しています（一部データ収集中）";
  }
  return "観測された停止要因はありません";
}

function ReasonList({ reasons }: { reasons: readonly string[] }) {
  return (
    <ul>
      {reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}
    </ul>
  );
}

export function SafetyDecisionSummaryBoard({ view }: { view: SafetyDecisionSummaryView }) {
  return (
    <section
      className="portfolio-risk-board safety-decision-summary-board shell"
      aria-labelledby="safety-decision-summary-title"
    >
      <div className="portfolio-risk-heading">
        <div>
          <span className="section-index">SAFETY GATE SUMMARY / DISPLAY ONLY</span>
          <h2 id="safety-decision-summary-title">{headingFor(view)}</h2>
          {view.summaryState === "no-blockers-observed" ? (
            <small style={noteStyle}>BUY実行を保証するものではありません。</small>
          ) : null}
          <p>
            紙上戦略に適用済みの安全ゲートを表示専用でまとめています。理由は元データの文言をそのまま表示します。
            実売買はロック中です。
          </p>
        </div>
        <span className="portfolio-risk-status" style={neutralStatusStyle}>
          {statusBadgeLabels[view.summaryState]}
        </span>
      </div>

      {view.globalBuyBlockers.length > 0 || view.assetsStoppedByGlobalGate.length > 0 ? (
        <div className="portfolio-risk-blocked" style={sectionStyle}>
          <h3 style={subheadingStyle}>全体ゲート（通常BUY）</h3>
          {view.globalBuyBlockers.map((blocker) => (
            <div className="portfolio-risk-reasons" key={blocker.origin}>
              <span>
                {globalBlockerLabels[blocker.origin]}<br />
                {blocker.status.toUpperCase()}
                {blocker.determinacy === "indeterminate" ? <><br />DATA WAIT</> : null}
              </span>
              <div>
                {blocker.origin === "portfolio-risk" && blocker.safetyControlReason !== null ? (
                  <>
                    <small style={noteStyle}>緊急停止制御（ポートフォリオリスクへ合成済み）</small>
                    <ReasonList reasons={[blocker.safetyControlReason]} />
                  </>
                ) : null}
                <ReasonList reasons={blocker.reasons} />
              </div>
            </div>
          ))}
          {view.assetsStoppedByGlobalGate.length > 0 ? (
            <div className="portfolio-risk-reasons">
              <span>STOPPED ASSETS</span>
              <div>
                <ReasonList reasons={view.assetsStoppedByGlobalGate} />
                <small style={noteStyle}>全体ゲートにより停止（銘柄固有の理由ではありません）</small>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.assetBuyLimitations.length > 0 ? (
        <div className="portfolio-risk-unavailable" style={sectionStyle}>
          <h3 style={subheadingStyle}>銘柄ごとの制限</h3>
          {view.assetBuyLimitations.map((limitation, index) => (
            <div
              className="portfolio-risk-reasons"
              key={`${index}:${limitation.symbol}:${limitation.action}`}
            >
              <span>{limitation.symbol}<br />{limitation.action}</span>
              <ReasonList reasons={[limitation.reason]} />
            </div>
          ))}
        </div>
      ) : null}

      {view.indeterminateInputs.length > 0 ? (
        <div className="portfolio-risk-unavailable" style={sectionStyle}>
          <h3 style={subheadingStyle}>判定材料の不足</h3>
          {view.indeterminateInputs.map((input, index) => (
            <div className="portfolio-risk-reasons" key={`${index}:${input.origin}`}>
              <span>
                {input.origin.toUpperCase()}<br />
                {input.scope === "rotation-only" ? "ROTATION ONLY" : "NORMAL BUY"}
              </span>
              <div>
                <small style={noteStyle}>{input.label}</small>
                <ReasonList reasons={input.reasons} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {view.rotationLimitations.length > 0 ? (
        <div className="model-drift-collecting" style={sectionStyle}>
          <h3 style={subheadingStyle}>ローテーションのみ制限（通常BUYの停止ではありません）</h3>
          {view.rotationLimitations.map((limitation) => (
            <div className="portfolio-risk-reasons" key={limitation.origin}>
              <span>
                ROTATION ONLY<br />
                {limitation.status.toUpperCase()}
                {limitation.determinacy === "indeterminate" ? <><br />DATA WAIT</> : null}
              </span>
              <div>
                <small style={noteStyle}>{limitation.label}</small>
                <ReasonList reasons={limitation.reasons} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
