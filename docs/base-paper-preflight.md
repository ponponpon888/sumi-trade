# Baseの署名なしpaper preflight

`GET /api/paper/base-preflight?amountYen=500` または `amountYen=1000` で、
Baseの往復見積（`getBasePaperQuote`）とウォレット残高観測
（`getBaseWalletObservation`）を並列に1回ずつ実行し、スワップ入力額を
現在のETH残高で賄えるかだけを確認する。既存のダッシュボード認証を経由し、
ハンドラでも認証を確認する。`amountYen`の欠落・重複・不正値、未知のクエリは400。

## 外部通信

- 見積側: 外部GETは最大3回（価格1回、購入見積1回、売却見積1回）。
- ウォレット側: JSON-RPCバッチPOSTが1回。応答の`rpcRequests: 1`はこの
  ウォレット側JSON-RPCバッチの回数であり、見積側のGETは含まない。
- 1リクエストあたりの外部HTTPは全体で最大4回。
- `Promise.allSettled`で並列に各1回だけ実行する。自動リトライ、ポーリング、Cron、
  永続化、キャッシュはない。HTTP応答は`Cache-Control: private, no-store`。

## 判定

- 見積の`amountInWei`とウォレットの`nativeBalanceWei`をBigIntのweiで直接比較する。
  円や浮動小数点へ変換しない。
- `swapInputCovered`はスワップ入力額だけの判定。L2ガス、L1掲載費、承認費、
  署名サービス費、exit reserveは含まないため`reserveSufficient`は常にnull。
- 残高が足りても未確認項目が残るため、`status`と`readiness`は常に`blocked`、
  `executionLocked: true`、`profitabilityVerified: false`。
- `blockReasons`には常に`EXECUTION_LOCKED`と`PREFLIGHT_CHECKS_INCOMPLETE`を含む。
  残高不足時は`INSUFFICIENT_NATIVE_BALANCE`、観測時刻が`quoteExpiresAtMs`以上の
  場合は`QUOTE_EXPIRED`を追加する。期限切れでも観測自体は有効として200で返す。
- `incompleteChecks`は次の4項目に固定する。ウォレット残高を実測したため
  `WALLET_BALANCE_UNVERIFIED`だけを解消済みとして除く。
  - `L1_FEE_COVERAGE_UNVERIFIED`
  - `TOKEN_APPROVAL_COST_UNVERIFIED`
  - `SIGNER_FEES_UNVERIFIED`
  - `EXECUTION_VALUATION_UNVERIFIED`

## fail closed

見積・ウォレットの戻り値はスキーマで再検証する。次の場合は503/unavailable。

| error | 条件 |
| --- | --- |
| `BASE_QUOTE_UNAVAILABLE` | 見積の取得失敗。両方失敗した場合もこちらを優先する |
| `BASE_WALLET_UNAVAILABLE` | ウォレット観測の取得失敗 |
| `PREFLIGHT_CHAIN_MISMATCH` | 見積またはウォレットのchainIdが8453以外 |
| `PREFLIGHT_INVALID_OBSERVATION` | 数量・残高の形式不正、uint256超過、`mode`/`executionLocked`/`profitabilityVerified`/`status`/`readiness`の不一致、要求額の不一致、未知の`incompleteChecks`、不正な現在時刻 |
| `BASE_PREFLIGHT_UNAVAILABLE` | 上記以外の想定外エラー |

`sourceError`は、既存ライブラリが返し得る安定コードの許可リストに含まれる場合だけ
見積側・ウォレット側のコードを返し、それ以外はnull。上流URL、認証情報、raw error、
レスポンス本文は返さない。

## 行わないこと

- 見積はcalldataやrecipientを持たないため、実行可能な注文へ変換しない。
- `evaluateSmallCapitalPaper`へ接続しない。累積入金、exit reserve、contract safety等の
  実測値がないため、値を補完・捏造しない。
- 署名、CDP APIキー、Wallet Secret、approve、Permit2、sendTransaction、
  sendUserOperation、自動スワップは実装しない。
- 新しい環境変数はない。`BASE_RPC_URL`と`BASE_WALLET_ADDRESS`は既存のウォレット観測の設定を使う。
