# Baseの少額・往復見積の観測

`GET /api/paper/base-quote?amountYen=500` または `amountYen=1000` で、
BaseのETH→USDC→ETHを読取専用で見積もる。既存のダッシュボード認証を
経由し、ハンドラでも認証を確認する。Vercel以外での開発時は既存認証関数の
開発用バイパスに従うため、自己ホストする場合は別途認証設定が必要。

外部通信は要求ごとに最大3回のGET。価格1回、購入見積1回、売却見積1回。
エラー時の自動リトライ、定期実行、ウォレット照会、署名、承認、送信はない。
HTTP・外部fetchともno-store。ブラウザの自動ポーリングには接続しない。
リクエストごとにAPI枠を消費するため手動観測用であり、分散レート制限を
実装した大量アクセス向けのAPIではない。URL・チェーン・トークンは固定し、
クエリから外部接続先や銘柄を変更できない。

## 計算と限界

- CoinGeckoのETH/JPYで500円・1,000円相当をweiへ切り下げる。価格は概算用。
- `last_updated_at`を保持し、取得時刻で上書きしない。3分超・未来・欠損は拒否。
- KyberSwapのBase専用経路を使用。買いの保守的な出力数量で逆方向を見積もる。
- 各方向0.5%のスリッページを想定した研究用計算。実発注の承認済み設定ではない。
- 経路のトークン・数量・元の時刻を検証。10秒超の古い経路は両方向とも拒否。
- `providerSwapGasEstimateYen`はAPIが返したgasUsdの円換算（切上げ）。確定支払額ではない。
- `knownCostEstimateYen`は見積の往復目減りとプロバイダーのガス推定の合計。
- `totalCostYen`と`reserveSufficient`は常にnull。L1掲載費の網羅性、承認、署名サービス費、
  残高は未検証であり、500円の予備費で足りるとは判定しない。
- `readiness: blocked`、`executionLocked: true`を維持。観測成功を取引許可に変換しない。

この表示用価格の3分鮮度は、small-capital-paperの実行前提となる10秒の価格鮮度と
異なる。既存paper判定へこの観測値を自動投入しない。ライブ接続には、信頼できる
価格・ガス・残高・承認・calldata検証、atomicな予算予約、外部署名制限が必要。
買い・売りの見積が得られても、将来の売却や利益を保証しない。

CoinGecko公開API、KyberSwapの既存gatewayは接続・レート制限等で利用できない場合がある。
その場合は503/unavailableにする。有料APIの契約、キー発行、制限回避は行わない。
実取引に進む際は正式gatewayと利用条件も再確認する。

## 仕様根拠（2026-09-14確認）

- [Base Network Fees](https://docs.base.org/specifications/transactions/network-fees): L2実行費とL1掲載費を区別。
- [KyberSwap EVM API](https://docs.kyberswap.com/developer-guide/aggregator-api/aggregator-api-specification/evm-swaps): Base専用パス、GET routes、5〜10秒の鮮度。既存gatewayはレート制限付きで利用可能と記載。
- [CoinGecko Demo Simple Price](https://docs.coingecko.com/demo/reference/simple-price): 法定通貨価格と元の更新時刻。
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): BaseのUSDCを固定。

実ネットワークへの初回接続確認では、開発環境から両APIとも8秒でタイムアウトした。
この時点では実際のガス代・売却費用の取得成功を確認できていない。fixtureでの成功と
本番実測は区別する。
