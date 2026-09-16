# SUMI TRADE LAB

Ethereumウォレットを読み取り、DEXの価格・流動性と5分足を照合して、5分間隔のBUY／SELL判断を紙上で生成する実験用ダッシュボードです。

## 現在できること

- Blockscoutから公開ウォレット残高を取得
- DexscreenerでEthereum上の実取引ペアを確認
- GeckoTerminalから720本の5分足を取得
- 5分足から15分足・1時間足を内部生成
- Ethereumの注目プールをコミュニティ反応・参加者・市場活動で取得
- 流動性75万ドル、24H出来高25万ドル、プール年齢30日などのトレンド安全ゲート
- 現在の保有資産から最大5%だけを回す紙上ローテーション候補
- EMA 9/21、RSI 14、ATR 14、出来高倍率による複合スコア
- 上昇・下降・レンジ・高ボラティリティ・低流動性の5局面を自動判定
- 局面ごとに順張り・平均回帰・資本保全・リスクオフ・売買停止を切り替え
- 局面リスク倍率（100%／50%／25%／0%）で新規ポジション量を制限
- 注文額とDEX流動性からAMM価格影響を推定し、動的スリッページへ反映
- 価格影響1.5%超の注文を期待利益にかかわらず自動停止
- Blockscoutの検証済みソース・ABI・詐欺フラグでトークンを再審査
- ERC-20必須関数、Proxy、mint・pause・blacklist・fee変更権限を検査
- 未検証・取得不能・要レビューのコントラクトは新規BUYを停止（既存SELLは維持）
- KyberSwapの公開Aggregator APIでETH→トークン→ETHの双方向ルートを読み取り専用で事前確認
- 標準50ドルの往復見積で売却ルートなし・異常値・目減り5%超・API取得不能を新規BUY停止
- ガス代・スリッページを差し引いたコストゲート
- 確定足のシグナルを次足始値で約定する未来参照防止バックテスト
- 同一足で損切り・利確の両方に触れた場合は損切りを優先する保守的な足内判定
- 30時間の事前履歴と10時間の評価窓によるローリングOOS検証
- コスト調整後Buy & Hold比較、超過収益、1取引期待値、Trade Sharpeを集計
- 過去取引を決定論的に1,000回再標本化し、利益経路率・下位5%収益・DD95・資産50%割れ確率を算出
- ガス代とスリッページを1.5倍・2倍に悪化させるコスト感度分析
- 最低5取引、利益経路率60%以上、下位5%損失10%以内、資産50%割れ確率1%以内、コスト2倍後プラスをBUY条件に追加
- SUMI局面判定・EMA 9/21順張り・RSI 30/70平均回帰を同一条件で比較
- 全期間収益、ローリングOOS収益、最大DD、PF、Buy & Hold超過収益を戦略別に表示
- 比較首位は研究結果として表示するだけで、運用戦略を自動変更しない
- Ethereum mainnetのchainId、最新ブロック鮮度、対象コントラクトコードを署名なしで確認
- RPC未設定・不完全応答・3分超のブロック遅延・コード不在をFail Closedで新規BUY停止
- 許可した8銘柄だけを評価
- 流動性が薄い市場、価格のない配布トークンを自動除外
- 0.005 ETHをガス残高として固定
- 透明な条件でBUY／SELL／HOLD／BLOCKを生成
- Vercel Cronで5分ごとのドライラン
- Upstash Redisへ5分枠ごとのスキャンを重複なく保存
- 6時間後の実価格でシグナルを採点する7日間フォワードテスト
- 7日昇格判定を維持したまま、記録保持と分析を30日へ拡張
- 24時間・7日・30日の損益、勝率、PF、最大DDを同条件で比較
- 30日累積損益カーブ、銘柄別ランキング、平均勝ち・平均負け・ペイオフ比を表示
- 保有銘柄モデルとコミュニティトレンドを分離した独立成績
- 手数料後損益、勝率、PF、最大ドローダウン、最大連敗を集計
- 各モデルを30件・PF 1.20・最大DD 8%・コスト通過率70%で個別判定
- 全資産に対する単一資産35%超を検出し、新規BUYを停止
- 相関0.85以上の2資産が合計50%超の場合、新規BUYを停止
- 資産間・ETH相関は同一timestampの5分足だけをinner joinして算出
- ETH相関0.85以上かつ対象配分25%以上の場合、新規BUYを停止
- 24時間のコスト後損失3%以上、または3連敗以上で新規BUYを停止
- 連敗停止は過去最大ではなく、最新の採点結果から続く現在連敗を使用
- 相関履歴・ETHベンチマーク・損失記録が不足した場合はFail Closedで新規BUYを停止
- ポートフォリオリスク停止中も保有資産のSELL経路は維持
- 最新確定5分足が15分を超えて遅延した銘柄は新規判断を停止
- 各紙上判断へ決定論的なdecision IDを付与し、同一判断の重複採点を防止
- Redisへ永続緊急停止を保存し、取得不能・設定不正もFail Closed
- 強いBearer secretで保護した緊急停止APIとhealth状態表示
- 168時間の観測、直近24時間80%以上のスキャン網羅率、12分以内の最新記録を昇格前に検証
- health APIで紙上エンジン状態・観測時間・スキャン網羅率を秘密情報なしで確認
- 認証済みダッシュボードから30日分の採点済み紙上取引をCSV出力
- チャートとコミュニティトレンドを別々に監視し、悪化したモデルだけを隔離
- 劣化解除は現在窓と12時間前の確認窓がともに正常な場合だけ許可
- 30日紙上結果を確信度0–49・50–69・70–100に分け、モデルの過信を可視化
- チャートモデルの30日成績を5つの市場局面別に分解
- 10件以上の局面で30日損益と平均リターン・Profit Factorの悪化を研究アラート表示
- シグナル理由・スコア・確信度・6時間後結果を判断ID単位で監査表示・CSV出力
- Blockscout・Dexscreener・GeckoTerminal・Ethereum RPC・KyberSwapの取得率と欠損率を監視
- 取得元別の24時間可用率・平均取得率・連続失敗と障害復旧状態を監視
- 判断時の取得元品質を6時間後結果へ紐付け、品質帯別の30日成績を比較
- 取得元ごとに正常時と欠損時の30日リターン差を比較し、品質影響を分離
- 同じ判断理由を正常時と欠損時で比較し、取得元劣化の影響を受けた理由を表示

## 現在できないこと

このバージョンはオンチェーン署名・トークン承認・スワップ送信を実装していません。画面上の注文はすべてペーパートレードです。秘密鍵やリカバリーフレーズを環境変数へ保存しないでください。

v1.3のオンチェーン状態プリフライトは `eth_chainId`、`eth_getBlockByNumber`、`eth_getCode` だけを使用します。スワップ取引の生成、`eth_call`、`eth_estimateGas`、署名、送信は行いません。

## ローカル起動

```powershell
npm install
$env:WALLET_ADDRESS="0xYourPublicAddress"
$env:CRON_SECRET="a-long-random-secret"
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 検証

```powershell
npm run check
npm run build
```

## GitHubでの自動検証

`Application quality`はすべてのPRとmainへのpushで、Node.js 24・lockfile固定の依存関係を使い、lint・型チェック・全アプリテスト・本番用ビルドを順に実行します。実データの取得や本番シークレットは不要です。同じPRへの更新が続いた場合は古い検証を中止し、最新の変更を検証します。

本番監視スクリプトの回帰テストと本番health監視は別のワークフローとして継続します。このCIの追加だけでは、GitHubのマージ必須チェック設定は変更されません。

## 実売買接続前の必須条件

1. ペーパートレードのシグナルと約定想定を最低7日・30件保存する
2. DEXの確定見積もりで価格影響・スリッページ・ガスを検査する
3. MetaMask Advanced Permissionsでスワップだけを許可する
4. 外部送金、借入、レバレッジ、未知コントラクトを拒否する
5. 永続的な緊急停止フラグと注文IDの重複防止をDBで実装する
6. 最初の実注文は1件ずつ人間が最終承認する

現在、1はデータ収集中、2・4・5は紙上モードで実装済みです。3と6は実売買接続を判断する将来段階まで意図的に未実装です。7日・30件を通過しても安全や利益は保証されず、自動的に実売買へ移行しません。

## 環境変数

| 変数 | 必須 | 内容 |
| --- | --- | --- |
| `WALLET_ADDRESS` | Yes | 読み取る公開EVMアドレス |
| `CRON_SECRET` | Cron利用時 | Vercel CronのBearer認証 |
| `UPSTASH_REDIS_REST_URL` | 記録・安全停止時 | Upstash RedisのREST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 記録・安全停止時 | Upstash RedisのRESTトークン（サーバー専用） |
| `KV_REST_API_URL` | 記録・安全停止時 | Vercel連携が作る同等のUpstash URL（上記URLの代替） |
| `KV_REST_API_TOKEN` | 記録・安全停止時 | Vercel連携が作る同等のUpstashトークン（上記トークンの代替） |
| `DASHBOARD_USER` | No | 本番ダッシュボードのBasic認証ユーザー（標準 `sumi`） |
| `DASHBOARD_PASSWORD` | Vercel利用時 | 本番ダッシュボードの長いランダムパスワード。未設定時はHTTP 503で閉鎖 |
| `SAFETY_CONTROL_SECRET` | 緊急停止API利用時 | 16文字以上のランダムBearer secret（サーバー専用） |
| `SUMI_EMERGENCY_STOP` | No | `true` で環境レベルの新規BUY緊急停止。不正値もFail Closed |
| `BLOCKSCOUT_ORIGIN` | No | 公開チェーンデータ取得元 |
| `DEXSCREENER_ORIGIN` | No | 公開DEX市場データ取得元 |
| `GECKOTERMINAL_ORIGIN` | No | 5分足OHLCV取得元 |
| `KYBERSWAP_ORIGIN` | No | BUY／SELL双方向の読み取り専用ルート見積元 |
| `PREFLIGHT_QUOTE_USD` | No | 双方向見積に使う試験額（標準50ドル） |
| `MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT` | No | 許容する往復目減りの上限（標準5%） |
| `ESTIMATED_SWAP_GAS_USD` | No | 片道スワップの想定ガス代（標準4ドル） |
| `ESTIMATED_SLIPPAGE_PERCENT` | No | 片道の想定スリッページ（標準0.35%） |
| `MAX_PRICE_IMPACT_PERCENT` | No | 許容する推定価格影響の上限（標準1.5%） |
| `RISK_PER_TRADE_PERCENT` | No | 1注文の許容損失率（標準1%） |
| `MAX_POSITION_PERCENT` | No | 1注文の最大配分率（標準20%） |
| `ETHEREUM_RPC_URL` | v1.3状態確認時 | Ethereum mainnet JSON-RPC URL（サーバー専用）。未設定時は新規BUY停止 |

Keyless GeckoTerminal APIは試作・教育用途向けで、公式には本番の高頻度ポーリング用途を想定していません。この実験ではOHLCVを5分、トレンド一覧を15分キャッシュし、呼び出し回数を抑えています。実売買接続前に専用レート制限のあるデータプランへ切り替えてください。

KyberSwap Aggregator APIのルート照会にはAPIキーを保存せず、公開エンドポイントへ`X-Client-Id`を付けてアクセスします。ルート情報からトランザクションやcalldataを生成せず、判定材料だけに使用します。

## セキュリティ方針

- 実行用秘密情報はクライアントへ渡さない
- 署名経路を追加するまでは、コード上も実資産を動かせない
- Vercel上ではBasic認証を必須化し、未設定時は失敗側へ閉じる
- ERC-20の無期限・無制限承認を使わない

## データ取得元の監視

### Source freshness across the statistics window

Source freshness uses the latest retained observation at or before the evaluation time, even when older than 24 hours. Availability, coverage, observation counts and failure streaks still use only the 24-hour window. A stopped source therefore remains stale while its last observation is retained; a source with no retained observation remains collecting. Future observations are ignored.

### Health API source quality summary

`/api/health` exposes `dataSourceQualityStatus` with precedence `stale`, `degraded`, `collecting`, then `healthy`. Separate `staleDataSources`, `degradedDataSources` and `collectingDataSources` arrays retain all affected source IDs. Missing history is collecting; an empty incident history is also collecting rather than monitoring. These fields describe observed source quality and do not change the service liveness response or execution lock.

### Automated source monitoring

The production health checker blocks on stale/degraded source quality and open source incidents. Missing or unknown quality/incident states also block. Collecting observations produces a `DATA_SOURCE_COLLECTING` report warning without failing the check; recovered incidents are accepted. Reports retain only known source IDs and recognized source status values. These checks take effect when the integration branch is deployed to production.

The health checker also examines affected-source lists independently of summary statuses: known stale/degraded/open-incident entries block even if the summary says healthy or recovered. Collecting entries preserve the collection warning. Missing, non-array or unknown-ID lists block with `DATA_SOURCE_LIST_INVALID`; reports still filter unknown values.

## ドキュメント

- 変更履歴: [CHANGELOG.md](CHANGELOG.md)
- Base paper preflight: [docs/base-paper-preflight.md](docs/base-paper-preflight.md)
- Base funding planning: [docs/base-funding-planning.md](docs/base-funding-planning.md)
- Base quote observation: [docs/base-quote-observation.md](docs/base-quote-observation.md)
- Base wallet observation: [docs/base-wallet-observation.md](docs/base-wallet-observation.md)
- Base small-capital paper: [docs/base-small-capital-paper.md](docs/base-small-capital-paper.md)
- CDP swap price findings: [docs/cdp-swap-price-findings.md](docs/cdp-swap-price-findings.md)
