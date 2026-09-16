# Baseの入金計画の参考値

`GET /api/paper/base-preflight?amountYen=500` または `amountYen=1000` のレスポンスに
`fundingPlanning` を追加する。既存の見積・ウォレット観測・実行状態観測の結果だけを使い、
純関数 `evaluateBaseFundingPlanning`（`src/lib/base-funding-planning.ts`）を1回呼ぶ。

## これは必要入金額でも推奨入金額でもない

**`fundingPlanning` のどの値も「これだけ入金すれば取引できる」という意味を持たない。**
未計上の費用が最良の場合でも7項目残るため、必要額・推奨額・最低額・下限のいずれとしても
使ってはならない。表示・記載・口頭説明でもそう述べない。

## 確定している値は1つだけ

- **`principalShortfallWei` だけが確定した元本不足**。
  `max(0, principalWei - nativeBalanceWei)` で、観測したETH残高が見積の入力額に
  満たないという事実を示す。
- それ以外はすべて参考値かnull。

## 各フィールド

| field | 意味 |
| --- | --- |
| `principalWei` | 見積の`amountInWei`をそのまま使う。preflight側で再計算しない |
| `nativeBalanceWei` | ウォレット観測のETH残高 |
| `principalShortfallWei` | **確定した元本不足**。上記のとおり |
| `costBasis` | `WITH_PROVIDER_L1_FEE`か`WITHOUT_PROVIDER_L1_FEE` |
| `estimatedKnownCostYen` | 円建ての既知費用推定。内訳は下記 |
| `estimatedKnownCostWei` | 上記を見積と同じETH/JPYでBigIntの分数により**切り上げ**換算した参考値 |
| `estimatedFundingReferenceWei` | `principalWei + estimatedKnownCostWei`。**比較用の参考値のみ** |
| `estimatedFundingReferenceGapWei` | `max(0, 参考値 - 残高)`。**確定不足額でも必要入金額でも推奨入金額でもない** |
| `planningTargetWei` | 常に`null` |
| `planningShortfallWei` | 常に`null` |
| `policyReserveYen` | 常に`null` |
| `fundingSufficient` | 常に`null` |
| `totalCapitalLimitYen` | `10000`。方針値 |
| `perTradeLimitYen` | `1000`。方針値 |
| `capitalBudgetEvaluated` | 常に`false` |
| `unpricedCosts` | 値段が付いていない費用の固定順リスト |

## estimatedKnownCostYenに含まれるもの

見積の`providerKnownCostEstimateYen`（無ければ`knownCostEstimateYen`）をそのまま使う。
この値には次が含まれる。

- KyberSwapが申告したBUY・SELLのガス推定（`gasUsd`の円換算）
- **往復スワップの目減り**（入力額と逆方向見積の最低受取額の差）
- `providerKnownCostEstimateYen`の場合はKyberSwap申告のL1 fee

**往復の目減りは経済的な損失であって、開始時に追加で必要なETHとは限らない。**
目減りは取引の結果として現れるものであり、入金額に足すべき費用として確定していない。
したがって`principalWei`と合算した`estimatedFundingReferenceWei`を
「確実に必要な下限」と解釈してはならない。比較のための目安にすぎない。

`providerKnownCostEstimateYen`がnullの場合は`costBasis`を
`WITHOUT_PROVIDER_L1_FEE`に切り替え、`unpricedCosts`に`PROVIDER_L1_FEE`を追加する。
**provider L1 feeを0円として扱うことはしない。**

## policyReserveYenがnullである理由

**500円の予備費は承認済みのポリシーではない。** コード・設定・ドキュメントを調べたが、
固定値としての予備費は存在しない。

- `SMALL_CAPITAL_POLICY`（`src/lib/small-capital-paper.ts`）に予備費の項目はない。
- `exitReserveYen`は呼び出し側が渡す入力であり、テストのfixture値は100円。
  `docs/base-small-capital-paper.md`は「Fixture values (JPY 10 and 100) are not newly
  approved live limits」と明記している。
- `docs/base-quote-observation.md`の「500円の予備費」は
  「500円の予備費で足りるとは判定しない」という否定文の中にだけ現れる。

根拠のない金額を埋めないため`policyReserveYen`はnullのままにし、これに依存する
`planningTargetWei`と`planningShortfallWei`もnullにする。予備費を決めるには
別途の明示的な方針決定が必要。

## fundingSufficientがnullである理由

未計上の費用が残る限り、足りるとも足りないとも判定できないため常に`null`にする。
booleanにはしない。不足の方向だけは`principalShortfallWei`で確定できるが、
充足の方向は証明できない。

## totalCapitalLimitYenとcapitalBudgetEvaluated

`totalCapitalLimitYen: 10000`と`perTradeLimitYen: 1000`は
`SMALL_CAPITAL_POLICY`の`maxFundingYen`・`maxOrderYen`を参照した方針値。
値を新しくハードコードしてはいない。

ただし**累積入金額を保持していないため、1万円の上限を満たしているかは判定していない**。
永続化を行わない方針のため累積額を知る手段がない。これを明示するために
`capitalBudgetEvaluated: false`を返す。

## unpricedCostsの各項目

固定順で返す。条件付きは3項目。

| 項目 | 意味 | 条件 |
| --- | --- | --- |
| `SMART_ACCOUNT_DEPLOYMENT` | Smart Accountの初回デプロイ費用 | 未デプロイのときだけ |
| `USER_OPERATION_GAS` | ERC-4337 UserOperationの実行ガス | 常に |
| `BUNDLER_FEE` | bundlerの手数料 | 常に |
| `PAYMASTER_FEE` | paymasterの手数料 | 常に |
| `SIGNER_FEE` | 署名サービス／CDPの利用料 | 常に |
| `APPROVAL_TRANSACTION` | SELL前のapprove取引の費用 | allowanceが不足のときだけ |
| `BUNDLE_L1_FEE_ALLOCATION` | 1本のbundleに複数UserOperationが載る場合のL1掲載費の按分 | 常に |
| `EXECUTION_TIME_OPERATOR_FEE` | 実行時点のoperator fee | 常に |
| `PRICE_AND_GAS_MOVEMENT` | 観測時点から実行時点までの価格・ガスの変動 | 常に |
| `PROVIDER_L1_FEE` | KyberSwap申告のL1 feeが得られなかった分 | provider合計がnullのときだけ |

## 見積の鮮度

**この計画値は10秒で失効する見積とCoinGeckoの評価値に基づく。**
`quoteExpiresAtMs`を過ぎた観測は`blockReasons`に`QUOTE_EXPIRED`が入る。
入金の判断や操作は分〜時間の単位で行われるため、**入金を判断する時点の価格を保証しない**。
再度観測してから判断すること。

## 行わないこと

- 送金先アドレス、QRコード、送金リンク、自動送金を提供しない。
- 署名、approve、permit、Permit2、Smart Accountのデプロイ、sendTransaction、
  sendUserOperation、eth_sendRawTransaction、資金移動を行わない。
- KyberSwapの`route/build`、calldata、CDP API、bundlerを使わない。
- 外部通信を追加しない。`externalHttpRequests: 5`と`totalRpcRequests: 2`を維持する。
- 新しい環境変数、DB、キャッシュ、永続化、リトライ、タイマー、Cronを追加しない。
- `fundingPlanning`の結果で`blockReasons`や`incompleteChecks`を増減しない。
- `executionLocked: true`を解除しない。`readiness: blocked`、
  `profitabilityVerified: false`、`reserveSufficient: null`も維持する。
- `L1_FEE_COVERAGE_UNVERIFIED`と`EXECUTION_VALUATION_UNVERIFIED`は解消しない。

## fail closed

見積が`valuation.ethJpy`、`knownCostEstimateYen`、`providerKnownCostEstimateYen`を
内部契約どおり返さない場合は`PREFLIGHT_INVALID_OBSERVATION`で503にする。
`ethJpy`は有限かつ正、費用は非負のsafe integer、provider合計はnullのみ許容する。

純関数が例外を投げた場合も内部観測の不整合として`PREFLIGHT_INVALID_OBSERVATION`に変換し、
入力値・stack・RPCのURL・上流本文は返さない。部分的に成功したpreflightは返さず、
`unavailableReason`による縮退も行わない。
