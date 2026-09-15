# Baseの署名なしpaper preflight

`GET /api/paper/base-preflight?amountYen=500` または `amountYen=1000` で、
Baseの往復見積（`getBasePaperQuote`）、ウォレット残高観測
（`getBaseWalletObservation`）、実行状態観測（`getBaseExecutionStateObservation`）を
1回ずつ実行し、スワップ入力額をETH残高で賄えるか、Smart Accountのデプロイ状態、
SELL legのUSDC allowanceを署名なしで観測する。既存のダッシュボード認証を経由し、
ハンドラでも認証を確認する。`amountYen`の欠落・重複・不正値、未知のクエリは400。

## 外部通信

- 見積側: 外部GETは最大3回（価格1回、購入見積1回、売却見積1回）。
- ウォレット側: JSON-RPCバッチPOSTが1回（chainId、最新ブロック、ETH残高、USDC残高）。
- 実行状態側: JSON-RPCバッチPOSTが1回（chainId、最新ブロック、`eth_getCode`、
  USDC `allowance(owner, router)`）。見積の`routerAddress`が必要なため、見積と
  ウォレットの両方が成功し、検証を通過した後にだけ実行する。
- 見積とウォレットは`Promise.allSettled`で並列に各1回、その後に実行状態を1回だけ実行する。
  自動リトライ、ポーリング、Cron、永続化、キャッシュはない。HTTP応答は`Cache-Control: private, no-store`。
- 成功時の外部HTTPは5回（GET 3回 + POST 2回）。見積が失敗した場合は最大4回、
  ウォレットだけが失敗した場合は4回で、どちらの場合も実行状態は観測しない。

成功レスポンスの通信回数フィールド:

| field | 値 | 意味 |
| --- | --- | --- |
| `walletRpcRequests` | 1 | ウォレット側JSON-RPCバッチの回数 |
| `executionStateRpcRequests` | 1 | 実行状態側JSON-RPCバッチの回数 |
| `totalRpcRequests` | 2 | JSON-RPCバッチの合計 |
| `externalHttpRequests` | 5 | 見積GETを含む外部HTTPの合計 |
| `rpcRequests` | 1 | 互換用の旧名。`walletRpcRequests`と同じ意味で、合計ではない |

## 判定

- 見積の`amountInWei`とウォレットの`nativeBalanceWei`をBigIntのweiで直接比較する。
  円や浮動小数点へ変換しない。
- `swapInputCovered`はスワップ入力額だけの判定。L2ガス、L1掲載費、承認費、
  署名サービス費、exit reserveは含まないため`reserveSufficient`は常にnull。
- `smartAccountDeployed`は`eth_getCode`が`0x`ならfalse。EIP-7702の委任コードは
  実行状態側でfail closedにする。
- BUY legはネイティブETH入力のため`buyLegAllowanceRequired: false`。
- `sellLegInputUsdcUnits`は現在のSELL見積で実際に入力するUSDC量（見積の
  `buyMinimumOutUsdcUnits`）。`sellLegAllowanceCovered`は`usdcAllowanceUnits`との
  BigInt比較で、preflight側でも再計算し、実行状態の値と一致しなければ拒否する。
- `routerAddress`はKyberSwapが返したrouterで、固定アドレスとは照合していない。
  読取専用のallowance照会だけに使う。
- 未デプロイやallowance不足は報告するだけで、デプロイ、approve、permit、署名、送信で修復しない。
- 残高やallowanceが足りても未確認項目が残るため、`status`と`readiness`は常に`blocked`、
  `executionLocked: true`、`profitabilityVerified: false`、`reserveSufficient: null`。
- `blockReasons`は次の固定順。5と6は常に含む。
  1. `INSUFFICIENT_NATIVE_BALANCE`: ETH残高が見積の入力額未満
  2. `SMART_ACCOUNT_UNDEPLOYED`: Smart Accountが未デプロイ
  3. `SELL_ALLOWANCE_INSUFFICIENT`: USDC allowanceがSELL入力量未満
  4. `QUOTE_EXPIRED`: 実行状態の観測完了時刻が`quoteExpiresAtMs`以上。
     期限切れでも観測自体は有効として200で返す
  5. `EXECUTION_LOCKED`
  6. `PREFLIGHT_CHECKS_INCOMPLETE`
- `incompleteChecks`は次の固定順。ウォレット残高を実測したため`WALLET_BALANCE_UNVERIFIED`は含まない。
  1. `L1_FEE_COVERAGE_UNVERIFIED`: 常に含む。見積のproviderEstimateはEOA前提の推定であり、
     Smart AccountのUserOperation費用を証明しない
  2. `TOKEN_APPROVAL_COST_UNVERIFIED`: `sellLegAllowanceCovered: false`の場合だけ含む。
     allowanceが現在のSELL入力量（`sellLegInputUsdcUnits`）以上なら、今回のSELLで新しい
     approve取引は不要で承認コストは0と確定できるため含めない
  3. `SIGNER_FEES_UNVERIFIED`: 常に含む
  4. `EXECUTION_VALUATION_UNVERIFIED`: 常に含む
  5. `SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED`: 未デプロイの場合だけ含む
- 常に残る未確認項目があるため、`PREFLIGHT_CHECKS_INCOMPLETE`はallowanceが足りても必ず含む。
- 見積、ウォレット、実行状態は別時刻・別ブロックの観測であり、単一のスナップショットではない。

## fail closed

見積・ウォレット・実行状態の戻り値はスキーマで再検証する。次の場合は503/unavailable。
判定は、見積の取得 → ウォレットの取得 → 見積・ウォレットの検証 → 実行状態の取得 →
実行状態の検証 → 突合せの順に行い、最初に失敗した段階のエラーを返す。

| error | 条件 |
| --- | --- |
| `BASE_QUOTE_UNAVAILABLE` | 見積の取得失敗。ウォレットと両方失敗した場合もこちらを優先する |
| `BASE_WALLET_UNAVAILABLE` | ウォレット観測の取得失敗 |
| `PREFLIGHT_CHAIN_MISMATCH` | 見積、ウォレット、実行状態のいずれかのchainIdが8453以外 |
| `PREFLIGHT_INVALID_OBSERVATION` | 数量・残高・allowanceの形式不正、uint256超過、`mode`/`executionLocked`/`profitabilityVerified`/`status`/`readiness`の不一致、要求額の不一致、未知の`incompleteChecks`、allowance判定の不整合、不正な現在時刻、実行状態側の入力拒否 |
| `BASE_EXECUTION_STATE_UNAVAILABLE` | 実行状態観測の取得失敗（見積とウォレットが成功した後だけ発生） |
| `PREFLIGHT_OBSERVATION_MISMATCH` | ウォレットと実行状態の`walletAddress`、見積と実行状態の`routerAddress`、見積の`buyMinimumOutUsdcUnits`と実行状態の`sellLegInputUsdcUnits`の不一致 |
| `BASE_PREFLIGHT_UNAVAILABLE` | 上記以外の想定外エラー |

`sourceError`は、既存ライブラリが返し得る安定コードの許可リストに含まれる場合だけ返し、
それ以外はnull。

| error | 許可する`sourceError` |
| --- | --- |
| `BASE_QUOTE_UNAVAILABLE` | 見積側の12コード。見積の形式不正は`PRICE_RESPONSE_INVALID`、`BUY_ROUTE_RESPONSE_INVALID`、`SELL_ROUTE_RESPONSE_INVALID`のいずれかで段階だけを示す |
| `BASE_WALLET_UNAVAILABLE` | ウォレット側の5コード |
| `BASE_EXECUTION_STATE_UNAVAILABLE` | `BASE_WALLET_CONFIGURATION_MISSING`、`BASE_RPC_UNAVAILABLE`、`BASE_RPC_INVALID_RESPONSE`、`BASE_RPC_WRONG_CHAIN`、`BASE_RPC_STALE_BLOCK`、`BASE_EXECUTION_STATE_UNEXPECTED_CODE` |
| `PREFLIGHT_INVALID_OBSERVATION` | `BASE_EXECUTION_STATE_INPUT_INVALID`のみ |

上流URL、認証情報、raw error、レスポンス本文、stackは返さない。

## 行わないこと

- 見積はcalldataやrecipientを持たないため、実行可能な注文へ変換しない。
- `evaluateSmallCapitalPaper`へ接続しない。累積入金、exit reserve、contract safety等の
  実測値がないため、値を補完・捏造しない。
- 署名、CDP APIキー、Wallet Secret、approve、permit、Permit2、Smart Accountのデプロイ、
  calldata/build API、sendTransaction、sendUserOperation、eth_sendRawTransaction、
  資金移動、自動スワップは実装しない。
- 見積の`providerEstimate`はpreflightに含めない。推定値は`/api/paper/base-quote`で確認する。
- 新しい環境変数はない。`BASE_RPC_URL`と`BASE_WALLET_ADDRESS`は既存のウォレット観測の設定を使う。
