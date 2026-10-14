# SUMI TRADE LAB

Ethereumウォレットを読み取り、DEXの価格・流動性と5分足を照合して、5分間隔のBUY／SELL判断を紙上で生成する実験用ダッシュボードです。

**これは紙上の実験です。** オンチェーン署名・トークン承認・スワップ送信を実装していません。画面上の注文はすべてペーパートレードで、実資産は動きません。秘密鍵やリカバリーフレーズを環境変数へ保存しないでください。読み取るのは公開アドレスだけです。

## 普通のbotと違うところ

儲けを大きくする仕組みではなく、根拠が足りないときに判断を出さない仕組みを選んでいます。

- **未来参照防止の約定** — シグナルは確定足で判定し、約定は次足の始値で行います。確定していない足の値段で約定したことにして、バックテストの成績を良く見せるのを止めます。
- **同一足での損切り優先** — 1本の足が損切り値幅と利確値幅の両方に触れた場合、どちらが先に起きたかは5分足からは分かりません。常に損切り側を採用し、都合のよい順序を仮定するのを止めます。
- **1,000回リサンプリングの下位5%収益** — 過去取引を決定論的に1,000回再標本化し、下位5%の収益と資産50%割れ確率を見ます。1本の運の良い履歴だけで「勝てる」と判断するのを止めます。
- **コスト2倍の感度分析** — ガス代とスリッページを1.5倍・2倍に悪化させて再計算し、コスト2倍でもプラスでなければBUY条件を通しません。手数料の見積りが甘いだけの利益を止めます。
- **取得元劣化時のFail Closed** — RPC未設定、ブロック遅延、足の遅延、相関履歴や損失記録の不足、取得元の鮮度劣化は、すべて新規BUYの停止側に倒します。データが欠けたまま推測で判断を出すのを止めます（保有資産のSELL経路は維持します）。

判断の根拠・スコア・確信度は判断ID単位で記録し、6時間後の実価格で採点します。戦略比較の首位は研究結果として表示するだけで、運用戦略を自動で切り替えません。

## ローカル起動

```powershell
npm install
$env:WALLET_ADDRESS="0xYourPublicAddress"
$env:CRON_SECRET="a-long-random-secret"
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。`WALLET_ADDRESS` は残高を読むだけの公開アドレスです。

## 検証

```powershell
npm run check
npm run build
```

`npm run check` は lint・型チェック・テストを順に実行します。実行結果（終了コード 0）:

```text
> sumi-trade-lab@ check
> npm run lint && npm run typecheck && npm run test

> lint
> eslint .

> typecheck
> tsc --noEmit

> test
> vitest run

 RUN  v5.0.0 C:/Dev/sumi-trade

 Test Files  [件数は実行ごとに変わるため省略] passed
      Tests  [件数は実行ごとに変わるため省略] passed
```

lint・型チェック・テストの3段すべてがエラーなしで完了します。件数を固定値で書くとコードの増減で必ず古くなるため、実際の件数はこのコマンドの出力で確認してください。

## 現在できること

観測・算出できることの一覧は [docs/capabilities.md](docs/capabilities.md) にまとめています。

## 現在できないこと

このバージョンはオンチェーン署名・トークン承認・スワップ送信を実装していません。画面上の注文はすべてペーパートレードです。秘密鍵やリカバリーフレーズを環境変数へ保存しないでください。

v1.3のオンチェーン状態プリフライトは `eth_chainId`、`eth_getBlockByNumber`、`eth_getCode` だけを使用します。スワップ取引の生成、`eth_call`、`eth_estimateGas`、署名、送信は行いません。

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

## ドキュメント

- 現在できること: [docs/capabilities.md](docs/capabilities.md)
- データ取得元の監視: [docs/data-source-monitoring.md](docs/data-source-monitoring.md)
- 変更履歴: [CHANGELOG.md](CHANGELOG.md)
- 依存関係の脆弱性監査: [docs/dependency-audit-2026-10-15.md](docs/dependency-audit-2026-10-15.md)
- 安全ゲート一覧: [docs/safety-gates.md](docs/safety-gates.md)
- Base paper preflight: [docs/base-paper-preflight.md](docs/base-paper-preflight.md)
- Base funding planning: [docs/base-funding-planning.md](docs/base-funding-planning.md)
- Base quote observation: [docs/base-quote-observation.md](docs/base-quote-observation.md)
- Base cost observation: [docs/base-cost-observation.md](docs/base-cost-observation.md)
- Base wallet observation: [docs/base-wallet-observation.md](docs/base-wallet-observation.md)
- Base small-capital paper: [docs/base-small-capital-paper.md](docs/base-small-capital-paper.md)
- CDP swap price findings: [docs/cdp-swap-price-findings.md](docs/cdp-swap-price-findings.md)

## ライセンス

[MIT](LICENSE)
