# 安全ゲート一覧

## この文書の目的

- 現在の実装を説明する文書である。コードを読まずに「何が・どこで・どの順序で判定されるか」を確認するために書かれている。
- 売買ルールや安定APIを新設する文書ではない。この文書の追加によって、判定の内容・順序・戻り値は一切変わっていない。
- 文書内の日本語ラベルは説明用であり、APIが返す理由コードではない。機械判定に使ってはならない。

## 用語の区別

この文書では次を明確に区別する。混同すると、止まっていない条件を止まっていると誤読する。

| 区分 | 内容 | 例 |
| --- | --- | --- |
| 実装済みの理由コード・enum | 型または `as const` として実在し、APIやオブジェクトに現れる識別子 | Base preflightの `blockReasons`、`incompleteChecks`、`unpricedCosts` |
| 文書上の説明ラベル | この文書が読みやすさのために付けた日本語の名称 | 「単一資産集中」「往復コストゲート」 |
| health／観測専用の状態 | 監視・表示のために計算されるが、BUY判定へ接続されていない値 | `dataSourceQualityStatus`、`operationalReadiness` |
| BUY停止判定 | 実際に `BUY` を `HOLD` または `BLOCK` へ変える分岐 | `blockNewBuys`、`draftSignal` のearly return |
| SELLの扱い | SELLシグナルが生成されるか、生成後に変換されるか | 後述の「SELLの扱い」 |
| Base paper専用のブロック状態 | Ethereum側の通常エンジンとは別系統で返る状態 | `blockReasons`、`readiness: blocked` |
| 未確認項目 | 費用や前提が確認できていないことを示す印。エラーではない | `incompleteChecks` |
| 参考値・null状態 | 判定していない、または確定していないことを示す値 | `fundingSufficient: null`、`capitalBudgetEvaluated: false` |

Ethereum側の停止理由は、型上 `reasons: string[]` の日本語自由文であり、安定した理由コードは存在しない。
この文書は自由文しか存在しない条件をコード表記しない。

## BUY判定の流れ

実際の呼び出し順は次のとおり。段階Aは銘柄ごとに `src/lib/strategy.ts` の `draftSignal` が上から順に評価し、最初に該当した分岐で確定する（early return）。

| 順序 | 入力 | 判定元 | 該当時の結果 | SELLへの影響 |
| --- | --- | --- | --- | --- |
| A-1 | `asset.tradability` | `portfolio.ts` `classifyMarket` | `HOLD`（ガス残高） | この時点で確定するためSELLは生成されない |
| A-2 | `asset.tradability` | 同上 | `BLOCK` | 同上 |
| A-3 | `asset.tradability` | 同上 | `HOLD`（薄い市場） | 同上 |
| A-4 | `chart.status` | `chart-model.ts` `analyzeChart` | `HOLD` | 同上 |
| A-5 | `chart.direction` | 同上 | **`SELL` で確定** | ここでSELLが生成される |
| A-6 | `asset.contractSafety.status` | `contract-safety.ts` | `HOLD` | A-5で確定済みのため通らない |
| A-7 | `asset.quotePreflight.status` | `quote-preflight-core.ts` | `HOLD` | 同上 |
| A-8 | `asset.onchainPreflight.status` | `ethereum-preflight-core.ts` | `HOLD` | 同上 |
| A-9 | `chart.backtest.robustness.status` | `strategy-robustness.ts` | `HOLD` | 同上 |
| A-10 | `chart.risk.costGatePassed` | `chart-model.ts` `createRiskPlan` | `HOLD` | 同上 |
| A-11 | 上記すべて通過 | — | `BUY` | — |

段階Bは `createStrategyPlan` が全体ゲートを適用する。対象は `draft.action === "BUY"` だけで、それ以外の action はそのまま通過する。

| 順序 | 入力 | 判定元 | 該当時の結果 | SELLへの影響 |
| --- | --- | --- | --- | --- |
| B-1 | `modelDrift.chart.blockNewBuys` | `model-drift.ts` | `BUY` → `HOLD` | 変換しない |
| B-2 | `portfolioRisk.blockNewBuys` | `portfolio-risk.ts` と `safety-control.ts` の合成 | `BUY` → `HOLD` | 変換しない |

段階Cは予算判定で、`BUY` にだけ適用される。

| 順序 | 入力 | 判定元 | 該当時の結果 | SELLへの影響 |
| --- | --- | --- | --- | --- |
| C-1 | 売却予定額と余剰ETHから算出した発注額が20ドル未満 | `strategy.ts` `createStrategyPlan` | `BUY` → `HOLD` | 適用されない |

緊急停止は独立した分岐ではなく、`trading-engine.ts` で `applySafetyControlToRisk` によって `portfolioRisk` へ畳み込まれる。停止中は `portfolioRisk.blockNewBuys` が `true` になり、理由配列の先頭に緊急停止の文が入る。したがって画面上はポートフォリオリスクの一部として現れる。

コミュニティトレンドの紙上ローテーションは別経路で、`trend-buy-gate.ts` が `portfolioRisk.blockNewBuys` または `communityTrendDrift.blockNewBuys` のときに `paperRotation` を `null` にする。

**順序未保証**: `trading-engine.ts` は `getChartModelSnapshot`・`getTrendScoutSnapshot`・`getPaperJournalSnapshot`・`getSafetyControlSnapshot` を `Promise.all` で並列実行する。これら4つの完了順序は保証されない。並列取得の後に続く合成順序（ポートフォリオリスク → モデル劣化 → 戦略計画 → トレンドゲート）は決定的である。

## 安全ゲート一覧

「実際の理由コードまたは戻り値」欄には、型または実装に存在する値だけを記載する。Ethereum側は状態を表す enum 値が実在し、停止理由の文言は自由文である。

| 文書上の名称 | 対象 | 判定内容 | 実装箇所 | 実際の理由コードまたは戻り値 | fail closed 条件 | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| ガス残高の固定 | BUY | ETHをガス用として売買対象から除外 | `portfolio.ts` `getPortfolioSnapshot` / `strategy.ts` `draftSignal` | `tradability: "gas"` → `action: "HOLD"` | — | 0.005 ETHを予備として確保し、BUY予算から差し引く |
| 市場適格性（除外） | BUY | 価格経路なし、または流動性・24時間出来高が下限未満 | `portfolio.ts` `classifyMarket` | `tradability: "blocked"` → `action: "BLOCK"` | 価格が取得できない場合も `blocked` | 停止理由は自由文 |
| 市場適格性（薄い市場） | BUY | 流動性・出来高が中間帯 | 同上 | `tradability: "thin"` → `action: "HOLD"` | — | 確定見積なしの自動注文を禁止 |
| チャート履歴の鮮度・十分性 | BUY・SELL | 最新確定足が15分超、またはローソク足不足、取得失敗 | `chart-model.ts` `analyzeChart` / `createUnavailableChartAnalysis` | `status: "unavailable"` / `"insufficient"` | OHLCV取得失敗時も `unavailable` | SELL判定より前にあるため、該当するとSELLも生成されない |
| コントラクト安全性 | BUY | 未検証、詐欺フラグ、ERC-20必須関数不足、EOA、Proxy・管理関数の検出 | `contract-safety.ts` `assessContractSafety` | `status: "blocked"` / `"review"` / `"unavailable"` | 取得不能は `unavailable` で停止 | `review` でも新規BUYは停止 |
| 双方向見積 | BUY | 売却ルートなし、見積値不正、往復目減りが上限超 | `quote-preflight-core.ts` `assessQuotePreflight` | `status: "blocked"` / `"unavailable"` | API接続不能は `unavailable` で停止 | 見積の有効時間は30秒として扱う |
| オンチェーン状態 | BUY | chainIdが1以外、最新ブロックが180秒超の遅延、対象アドレスにコードなし | `ethereum-preflight-core.ts` `assessEthereumState` | `status: "blocked"` / `"unavailable"` | RPC未設定・応答不完全は `unavailable` で停止 | 読み取り専用 |
| 耐久試験 | BUY | 再標本化の利益経路率・下位5%損失・資産半減確率・コスト2倍後の収益、最低取引数 | `strategy-robustness.ts` `analyzeStrategyRobustness` | `status: "review"` / `"insufficient"` | 取引数不足は `insufficient` で停止 | 停止理由は自由文 |
| 往復コストゲート | BUY | 期待利益に対する往復コスト、推定価格影響の上限 | `chart-model.ts` `createRiskPlan` / `execution-cost.ts` `estimateExecutionCost` | `costGatePassed: false`（`priceImpactGatePassed` を含む） | 流動性が不明な場合は価格影響ゲートを通過扱い | ガス代・スリッページは設定値 |
| 市場局面による配分縮小 | BUY | 流動性・出来高が局面下限未満、または高ボラティリティ | `regime.ts` `classifyRegime` | `regime: "low-liquidity"` → `strategy: "blocked"`, `riskMultiplier: 0` / `regime: "high-volatility"` → `riskMultiplier: 0.25` | — | **BUYを直接止める分岐ではない**。後述 |
| モデル劣化（チャート） | BUY | 直近7日と直前23日の平均リターン差・Profit Factor、成績取得可否 | `model-drift.ts` `assessModelDrift` | `blockNewBuys: true`、`status: "degraded"` / `"recovering"` / `"unavailable"` | 成績を取得できない場合は `unavailable` で停止 | `collecting` は停止しない |
| モデル劣化（コミュニティトレンド） | 紙上ローテーション | 同上 | `model-drift.ts` / `trend-buy-gate.ts` `applyTrendBuyGates` | `paperRotation: null` + 警告文追加 | 同上 | 銘柄のBUYシグナルには影響しない |
| 単一資産集中 | BUY | 単一資産の配分が上限超 | `portfolio-risk.ts` `assessPortfolioRisk` | `blockNewBuys: true`、`status: "blocked"` | — | 理由は自由文 |
| 高相関ペア | BUY | 2資産の相関と合計配分が同時に上限超 | 同上 | 同上 | 相関サンプル不足は `unavailable` で停止 | 同一timestampのinner joinで算出 |
| ETH連動集中 | BUY | ETH相関と対象配分が同時に上限超 | 同上 | 同上 | ETHベンチマーク履歴なしは `unavailable` で停止 | — |
| 24時間損失 | BUY | 24時間のコスト後損失率が上限到達 | 同上 | 同上 | 損失記録を確認できない場合は `unavailable` で停止 | — |
| 連敗 | BUY | 現在の連敗数が上限到達 | 同上 | 同上 | 同上 | 最新の勝ちで現在連敗は0へ戻る |
| 緊急停止（環境変数） | BUY | 環境変数が有効値、または不正値 | `safety-control.ts` `getSafetyControlSnapshot` / `applySafetyControlToRisk` | `status: "stopped"` / `"unavailable"`、合成後 `blockNewBuys: true` | 不正値は `unavailable` で停止 | 解除は環境変数側で行う |
| 緊急停止（永続） | BUY | 保存された停止状態が有効 | 同上 | `status: "stopped"`、合成後 `blockNewBuys: true` | ストレージ未設定・取得不能・形式不正は `unavailable` で停止 | 環境変数側が有効な間は永続側を解除しても停止が優先される |
| 最低発注額 | BUY | 売却予定額と余剰ETHから算出した発注額が下限未満 | `strategy.ts` `createStrategyPlan` | `action: "HOLD"` | — | SELLには適用されない |
| トレンド候補ゲート | 紙上ローテーション候補 | 契約安全、双方向見積、流動性、出来高、プール年齢、建値、不審報告、参加者比率、値動き、コミュニティ好感票 | `trend-scout-core.ts` | `decision: "BLOCK"` | 契約情報・見積が未取得の場合も失格 | 保有資産のBUY／SELLとは別系統 |
| 実行ロック | BUY・SELLの実行 | 常時 | `strategy.ts` `createStrategyPlan` ほか | `executionLocked: true` | — | **人間が解除できない。** 署名・送信の実装自体が存在しない |

### 市場局面 `low-liquidity` の扱い

`low-liquidity` は BUY を直接停止する分岐ではない。`riskMultiplier: 0` により配分計算が0になり、その後のBUY予算判定で発注額が下限未満となった場合に `HOLD` へ至る間接的な経路である。
ただし段階Aには他のearly returnも存在するため、「必ずこの経路だけで `HOLD` になる」とは断定できない。

### 別分類：リクエスト失敗・観測失敗のエラーコード

次は**安全ゲートの理由コードではない**。APIリクエスト、外部観測、入力検証の失敗を表すコードであり、上表の「実際の理由コード」欄には含めない。

| 型 | 用途 | 実装箇所 |
| --- | --- | --- |
| `BasePaperPreflightErrorCode` | Base preflightのリクエスト失敗（503応答の `error`） | `base-paper-preflight.ts` |
| `BaseExecutionStateObservationErrorCode` | Base実行状態観測の失敗 | `base-execution-state-observation.ts` |
| `BaseWalletObservationErrorCode` | Baseウォレット観測の失敗 | `base-wallet-observation.ts` |
| `BaseFundingPlanningErrorCode` | funding planning計算の入力不正・桁あふれ | `base-funding-planning.ts` |
| Base見積側のコード群 | 価格・ルート取得と鮮度検証の失敗。preflightは許可リストに含まれるコードだけを `sourceError` として返し、それ以外は `null` にする | `base-paper-quote.ts` / `base-paper-preflight.ts` |

全件の列挙はこの文書の目的ではない。正確な値が必要な場合は各ファイルの型定義を参照する。

## 観測専用で売買判定に接続されていない項目

次は監視・表示・記録のために計算されるが、BUY判定へ接続されていない。これは各項目の呼び出し元と値の受け渡し先を追跡し、いずれの戻り値も `draftSignal` と `createStrategyPlan` の判定へ渡っていないことを確認した結果である（`createStrategyPlan` が受け取るのはポートフォリオスナップショット、チャート分析、ポートフォリオリスク、モデル劣化の4つだけである）。`strategy.ts` が型以外を一切 import していないことは、この追跡結果を裏づける補足にすぎない。したがってこれらが劣化しても、それだけでBUYが止まることはない。

| 項目 | 実装箇所 | 実際の呼び出し元 | BUYへの接続 |
| --- | --- | --- | --- |
| 本番設定監査 | `runtime-config.ts` `auditRuntimeConfiguration` | `/api/health` のみ | なし |
| 現在スキャンのデータ品質 | `data-source-quality.ts` `assessDataSourceQuality` | `trading-engine.ts`、`paper-journal-core.ts` | なし（表示・記録のみ） |
| 24時間データ品質履歴 | `data-source-quality.ts` `calculateDataSourceQualityHistory` | `paper-journal-core.ts`、`/api/health` | なし |
| 取得元の障害・復旧 | `data-source-quality.ts` `calculateDataSourceIncidents` | `paper-journal-core.ts`、`/api/health` | なし |
| 運用準備度 | `paper-journal-core.ts` `calculateOperationalReadiness` | `paper-journal-core.ts`、`/api/health`、ダッシュボード | なし（昇格条件の判定であってBUYゲートではない） |
| 紙上エンジンの稼働状態 | `paper-engine-health.ts` `getPaperEngineHealth` | `/api/health`、ダッシュボード | なし |
| 小額紙上プランナー | `small-capital-paper.ts` `evaluateSmallCapitalPaper` | **自テストのみ** | なし |
| 研究表示（戦略比較、局面別成績、確信度校正、品質帯別成績、取得元影響、判断理由別影響） | `chart-model.ts`、`paper-journal-core.ts` ほか | ダッシュボード表示とエクスポート | なし |

「監視されている」ことと「BUYを止める」ことは別である。本番のhealth監視が停止条件として扱う項目であっても、アプリ内のBUY判定は同じ条件で止まらない。

`small-capital-paper.ts` には `SmallCapitalBlockReason` という union 型が実在するが、`evaluateSmallCapitalPaper` は現在の実行経路から呼ばれていない。したがってこの型の値を、現在稼働中のBUYゲートの理由として扱ってはならない。この型を使う判定は現在動作していない。なお同ファイルの定数 `SMALL_CAPITAL_POLICY` は `base-funding-planning.ts` が方針値として参照している。

## SELLの扱い

SELLシグナルは、`tradability` が `gas`・`blocked`・`thin` のいずれにも該当せず、チャートが `ready` で、かつ `chart.direction === "SELL"` の場合に生成される。

SELL判定（段階A-5）より前のearly return（A-1からA-4）に該当した場合、SELLシグナルは生成されない。つまり、流動性基準を満たさない銘柄、価格経路が見つからない銘柄、チャート履歴が不足または陳腐化した銘柄は、SELL判定に到達しない。

SELLが生成された後は、契約安全・双方向見積・オンチェーン状態・耐久試験・往復コストというBUY向けの判定を通らない。

モデル劣化、ポートフォリオリスク、緊急停止による `blockNewBuys` は `draft.action === "BUY"` のときだけ適用されるため、生成済みのSELLを変換しない。20ドルの最低発注額も `BUY` にだけ適用され、SELLには適用されない。

**「SELLは常に可能」とは言えない。** 正確には「ポートフォリオリスク・モデル劣化・緊急停止は、生成済みのSELLを止めない」であり、SELLが生成されるかどうかは段階A-1からA-4の結果に依存する。

## Base paper preflight

Base paper系は、Ethereum側の通常エンジンとは**別系統**である。`base-*` の各モジュールは自身のAPIルートと `base-paper-preflight.ts` からのみ参照されており、`trading-engine.ts`・`page.tsx`・ダッシュボードからは参照されていない。ダッシュボードの表示内容とBase preflightの結果は連動しない。

`GET /api/paper/base-preflight` の成功応答では次が固定される。

| フィールド | 値 | 意味 |
| --- | --- | --- |
| `mode` | `"paper"` | 紙上モード |
| `executionLocked` | `true` | 実行ロック。解除されない |
| `status` | `"blocked"` | 観測は成功しているが実行は許可されない |
| `readiness` | `"blocked"` | 同上 |
| `profitabilityVerified` | `false` | 収益性は検証されていない |
| `reserveSufficient` | `null` | 予備費の十分性は判定していない |

### `blockReasons`（実際に返るブロック理由）

型に存在する識別子は次の6つで、固定順で返る。`EXECUTION_LOCKED` と `PREFLIGHT_CHECKS_INCOMPLETE` は常に含まれる。

`INSUFFICIENT_NATIVE_BALANCE` / `SMART_ACCOUNT_UNDEPLOYED` / `SELL_ALLOWANCE_INSUFFICIENT` / `QUOTE_EXPIRED` / `EXECUTION_LOCKED` / `PREFLIGHT_CHECKS_INCOMPLETE`

### `incompleteChecks`（未確認項目。エラーコードではない）

費用や前提が確認できていないことを示す印であり、リクエストの失敗を表すものではない。preflightの応答に現れる識別子は次の5つ。

`L1_FEE_COVERAGE_UNVERIFIED` / `TOKEN_APPROVAL_COST_UNVERIFIED` / `SIGNER_FEES_UNVERIFIED` / `EXECUTION_VALUATION_UNVERIFIED` / `SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED`

`TOKEN_APPROVAL_COST_UNVERIFIED` はSELL入力を満たすallowanceがある場合に外れ、`SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED` は未デプロイの場合にだけ加わる。他の3つは常に残る。
入力検証用の定義には `WALLET_BALANCE_UNVERIFIED` も含まれるが、preflightの応答には現れない。

### funding planningの参考値

`fundingPlanning` は、既に取得済みの観測結果に対する計算だけで求められる。通信は増えない。

`principalShortfallWei` は確定した元本不足である。観測したETH残高が見積の入力額に満たないという事実を示す。

`estimatedFundingReferenceWei` と `estimatedFundingReferenceGapWei` は、**必要入金額でも推奨入金額でも送金指示でもない**。既知のプロバイダー費用と往復目減りの推定を加えた比較用の参考値にすぎない。往復の目減りは経済的な損失であって、開始時に追加で必要なETHとは限らない。
これらを読む場合は、**`unpricedCosts` を必ず同時に参照する**。値段が付いていない費用が残っている限り、参考値を満たしても実行できるとは言えない。

`unpricedCosts` は**未価格化の費用区分**であり、ブロック理由ではない。型に存在する識別子は次の10種で、固定順で返る。

`SMART_ACCOUNT_DEPLOYMENT` / `USER_OPERATION_GAS` / `BUNDLER_FEE` / `PAYMASTER_FEE` / `SIGNER_FEE` / `APPROVAL_TRANSACTION` / `BUNDLE_L1_FEE_ALLOCATION` / `EXECUTION_TIME_OPERATOR_FEE` / `PRICE_AND_GAS_MOVEMENT` / `PROVIDER_L1_FEE`

このうち `SMART_ACCOUNT_DEPLOYMENT`・`APPROVAL_TRANSACTION`・`PROVIDER_L1_FEE` は条件付きで、残りは常に含まれる。

次は**ゲートの理由コードではなく、未評価または未確定の状態値**である。

| 値 | 意味 |
| --- | --- |
| `fundingSufficient: null` | 資金が足りるかどうかを判定していない。`true` にも `false` にもしない |
| `capitalBudgetEvaluated: false` | 累積入金額を保持していないため、総資金上限を評価していない |
| `policyReserveYen: null` | 承認された予備費がコード上に存在しないため、値を置いていない |
| `planningTargetWei: null` | 予備費が未確定のため算出できない |
| `planningShortfallWei: null` | 同上 |

`costBasis` は、参考値がプロバイダー申告のL1 feeを含むかどうかを示す。含まない場合は `unpricedCosts` に `PROVIDER_L1_FEE` が加わる。欠落したL1 feeを0として扱うことはない。

## 運用時の読み方

**BUY停止時に最初に見る場所**。銘柄ごとの結果は資産一覧の判定欄に出る。全体で止まっている場合は、ポートフォリオリスクとモデル劣化の表示を見る。緊急停止はポートフォリオリスクの理由配列の先頭に現れるため、ポートフォリオリスクが停止していても原因が緊急停止であることがある。

**health状態と売買判定を混同しない方法**。`/api/health` が返す設定監査・データ品質・障害・運用準備度は、いずれもBUY判定へ接続されていない。healthが正常でもBUYは止まることがあり、healthが劣化していてもBUYは止まらない。逆も同様である。healthは運用監視のための値であって、売買の可否を表さない。

**Base paperレスポンスを読む際の注意**。Base preflightはEthereum側のダッシュボードと連動しない。`blockReasons` はブロック理由、`incompleteChecks` は未確認項目、`unpricedCosts` は未価格化の費用区分であり、それぞれ別の意味を持つ。`executionLocked: true` と `status: "blocked"` は常に返るため、これらが出ていること自体は新しい情報ではない。

**理由が複数ある場合の扱い**。Ethereum側の `reasons` と Base側の `blockReasons` はいずれも配列で、先頭だけが画面に出ることがある。先頭が解消しても、残りの理由が残っていれば停止は続く。停止が解けない場合は配列全体を確認する。

## 現在の限界

- この文書の日本語ラベルは機械判定に使用できない。Ethereum側の停止理由は自由文であり、文言は実装の変更で変わりうる。
- 将来コード側の理由コードを統一する場合は、別フェーズで設計する。この文書はその設計を先取りしない。
- 記載内容は作成時点の実装に基づく。コードが変わればこの文書は古くなる。差異を見つけた場合はコードを正とする。
- **この文書だけを根拠に実売買を許可しない。** すべてのゲートを通過しても `executionLocked: true` は解除されず、署名・送信の実装自体が存在しない。
