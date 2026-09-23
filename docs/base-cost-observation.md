# Baseの往復コストの定期観測

Baseへ移すかどうかを判断するために、Base上の少額取引の往復コストを1時間ごとに記録する。
観測だけで、署名・承認・送信・資金移動・ウォレット照会は行わない。

## 実行

- Vercel Cron `/api/cron/base-cost`を毎時17分に実行する（5分スキャンと重ならない時刻）。
- 認証は`/api/cron/scan`と同じ`CRON_SECRET`のBearerで、比較は定数時間。未設定なら503。
  ダッシュボードのBasic認証（proxy）の対象外にし、ルート側で秘密値を確認する。
- 1回の実行で`getBasePaperQuote(500)`を1回だけ呼ぶ。外部GETは最大3回
  （CoinGecko価格1回、KyberSwapの買い見積1回、売り見積1回）で、1日あたり最大72回。
- 見積を呼ぶ前に、Redisへその時間帯の予約キーを`SET NX`（2時間で失効）で書く。
  予約できなければ見積を呼ばずに`skipped-duplicate`を返す。Cronの再試行や重複起動でも、
  1時間に見積を2回取ることはない。
- 新しい環境変数はない。Redisは既存の`UPSTASH_REDIS_REST_URL`／`KV_REST_API_URL`を使う。

## 保存するもの

キーは`sumi:base-cost:v1:*`、保持は32日。1時間に1件。

| field | 意味 |
| --- | --- |
| `status` | `observed`または`unavailable` |
| `errorCode` | 失敗時だけ。見積関数の安定コード12種類以外は`UNKNOWN`（生のエラー文は保存しない） |
| `ethJpy`・`ethUsd` | 見積に使ったCoinGeckoの評価値 |
| `swapShortfallEstimateYen` | 各方向0.5%のスリッページ控除後の最低受取量で見た往復の目減り |
| `swapGasEstimateYen` | 買い・売りのプロバイダーガス推定の合計 |
| `knownCostEstimateYen` | 上の2つの合計（L1費用を含まない既存の定義） |
| `providerL1FeeEstimateYen` | KyberSwapがL1費用を報告した場合の往復合計。無ければnull |
| `providerKnownCostEstimateYen` | `knownCostEstimateYen`＋L1費用。L1費用が無ければnull |

ルーター・経路・calldata・ウォレットアドレスは保存しない。

## 集計

24時間・7日・30日ごとに、試行数、成功数、成功率、`knownCostEstimateYen`の500円に対する
割合の中央値・90パーセンタイル・最大、L1費用込みの中央値、失敗コード別件数を出す。

比較用に、チャートエンジンがEthereumで使う費用モデル（固定ガス×2＋スリッページ、流動性項なし）を
同じ500円・最新の観測ETH価格で計算して並べる。これはモデルの推定で、観測ではない。

## 限界

- 見積であり約定ではない。実際の約定価格やガスとは異なる。
- 各方向0.5%のスリッページは研究用の想定で、承認済みの実行設定ではない。
- Smart Accountのデプロイ、UserOperation／bundler、paymaster、署名サービス、approveの費用は含まない。
  `L1_FEE_COVERAGE_UNVERIFIED`などの未確認項目は解消しない。
- 観測結果はBUY／SELL判定、Base paper preflight、`evaluateSmallCapitalPaper`へ接続しない。
