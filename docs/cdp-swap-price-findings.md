# CDP getSwapPriceの調査結果（Phase 1d-A）

Phase 1dで、CDPの署名なし価格推定`getSwapPrice`からBase Smart Accountの
実行費用を観測できるかを調べた記録。結論は**今の構成では使わない**。
以下は2026-09-15時点の実測と一次資料に基づく。推測値は記載しない。

## 実測（認証なし、GET各1回）

`GET https://api.cdp.coinbase.com/platform/v2/evm/swaps/quote` に対し、
`network=base`、`taker`にSmart Accountアドレス、`slippageBps=50`、
BUY（ETH→USDC）とSELL（USDC→ETH）をそれぞれ1回だけ実行した。
Authorizationヘッダーは付けず、リトライもしていない。

| 実行 | HTTPステータス | 本文 |
| --- | --- | --- |
| BUY | 401 | なし（`errorType`・`errorMessage`とも取得できず） |
| SELL | 401 | なし |

`liquidityAvailable`、`blockNumber`、`gas`、`gasPrice`、`fees`、`issues`は
いずれも観測できていない。CDPが返すspenderの実値も未観測。

## 一次資料で確認できたこと

- `getSwapPrice`は拘束力のない価格推定で、署名も資金の確保も行わない。
  Smart Accountの場合はSmart Accountのアドレスを`taker`に指定する。
  （CDP docs: server-wallets v2 swaps、trade-api quickstart）
- CDPのSecret API Keyは「全サーバーエンドポイントの基本の認証として必要」。
  SDKの`getEvmSwapPrice`も認証付きAPIクライアント経由で呼ぶ。
  実測の401はこの記述と整合する。
- 応答の型（公開パッケージ`@coinbase/cdp-sdk@1.56.0`の
  `_types/client/evm/evm.types.d.ts`）:
  - `gas`: "The gas estimate for the swap."
  - `gasPrice`: "The gas price in Wei."
  - `SwapFees`は`gasFee`と`protocolFee`の2つのみ。
    `gasFee`: "The estimated gas fee for the swap."
  - `SwapIssues`は`allowance`、`balance`、`simulationIncomplete`。
  - `signerAddress`: "The signer address (only needed if taker is a smart contract)."
- allowanceが必要な場合のspenderは、資料上は「the Permit2 contract」。
  現在の実行計画で使うKyber router（`0x00000000000000000000000000000000000000d2`）
  とは異なる見込みだが、実値は未観測。
- ERC-4337では、未デプロイのアカウントはfactoryで作られ、必要な事前資金は
  UserOperationのガス上限から計算される。正確な費用には
  `verificationGasLimit`や`preVerificationGas`が要る。
- swap priceと`prepareUserOperation`のAPIリファレンスページは404だった。
  フィールドの意味は上記の公開型定義で確認している。

## 判断

1. 認証なしでは利用できないため、Phase 1dで`getSwapPrice`は使わない。
2. `getSwapPrice`はCDP独自経路の見積もりであり、router・承認先・経路・出力量が
   Kyberと異なる。CDPの`gas`や`gasFee`をKyberの実行費用として流用しない。
3. `gasFee`をSmart Accountのデプロイ費、L1費用、署名料金へ分解できる根拠は
   一次資料にない。分解しない。

## Phase 1d-Aの最終判断

- 認証なしのCDP `getSwapPrice`はHTTP 401となり、現在のアプリでは利用できない。
- 認証付き`getSwapPrice`の追加調査は行わない。
- CDP認証情報をVercelへ追加しない。
- CDPとKyberSwapは異なる実行経路なので、CDPの費用値を現在のKyberSwap経路の
  費用証明に使用しない。
- 現在の未確認項目は解除しない。
- CDPを実際の実行経路として採用する将来の設計変更があった場合だけ、認証・費用・
  Permit2・Smart Accountとの統合を別Phaseとして再検討する。

## 公式に確認できなかったこと

- `gasFee`がSmart Accountのデプロイ費を含むか。型定義に言及なし。
- `gasFee`がL1データ費用を含むか。型定義に言及なし。
- 署名・ウォレット操作料金に相当する応答項目。`SwapFees`には存在しない。
- CDPが実際に返すspenderの値（401のため未観測）。

## 引き続きUNVERIFIEDのままにする項目

- `L1_FEE_COVERAGE_UNVERIFIED`
- `SIGNER_FEES_UNVERIFIED`
- `EXECUTION_VALUATION_UNVERIFIED`
- `SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED`（未デプロイの場合）
- `TOKEN_APPROVAL_COST_UNVERIFIED`（SELL allowanceが不足する場合）

`profitabilityVerified`は`false`、`reserveSufficient`は`null`のまま。

## 次に検討する選択肢

- 公開RPCでBaseの`GasPriceOracle`から手数料パラメータを観測する。calldataが
  ないためL1費用のカバーは証明できず、`L1_FEE_COVERAGE_UNVERIFIED`は残る。
- （現時点では採用しない過去の選択肢）認証付きで`getSwapPrice`だけをローカルから
  試す案もあったが、上記「Phase 1d-Aの最終判断」により行わない。

この調査では署名、approve、permit、送信、資金移動、Smart Accountのデプロイ、
`prepareUserOperation`、`quoteSwap`、`createEvmSwapQuote`、POST系のリクエストを
行っていない。
