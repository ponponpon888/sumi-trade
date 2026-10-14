# 依存関係の脆弱性監査 — 2026-10-15

`npm audit` が報告する 6 件（high 5・critical 1）の内容と、`npm audit fix` で直らない理由の記録です。`--force` は実行していません。

**この節の時点の記録です。**同日に `next` を `16.3.8` へ上げて critical 1 件（advisory 7 件）を解消しました。現在の状態は末尾の「更新」を参照してください。

## 監査時点

- npm 11.6.2 / Node v24.11.1
- 依存関係 458（prod 17・dev 401・optional 92・peer 14）
- `npm audit fix`（`--force` なし）の実行後も **6 件のまま**。解決数は 0 です

## 2 つの経路

### 1. next（critical 1・high 1・moderate 4・low 1 → 集約表示は critical）

`package.json` は `"next": "16.3.4"` と**完全固定**です。報告されている 7 件の advisory はいずれも `<16.3.8` が対象で、`16.3.8` 以降で解消します。

| advisory | 深刻度 | 対象範囲 |
| --- | --- | --- |
| [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) RCE in `next/og` ImageResponse | critical | >=16.2.0 <16.3.6 |
| [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) SSRF in Image Optimization | high | >=16.0.0 <16.3.8 |
| [GHSA-3w37-wq28-93x7](https://github.com/advisories/GHSA-3w37-wq28-93x7) `use cache` が Draft Mode の内容を漏らす | moderate | >=16.3.0 <16.3.8 |
| [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676) 自己ホスト時の SSG/ISR キャッシュ汚染 | moderate | >=16.0.0 <16.3.8 |
| [GHSA-f87g-xv8r-7p7x](https://github.com/advisories/GHSA-f87g-xv8r-7p7x) metadata image route の dynamicParams 迂回 | moderate | >=16.0.0 <16.3.8 |
| [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p) SSG/ISR キャッシュ汚染 | moderate | >=16.0.0 <16.3.8 |
| [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv) 開発サーバー MCP エンドポイントの情報開示 | low | >=16.0.0 <16.3.8 |

`npm audit fix` が提案するのは `next@16.4.0` で、固定値 `16.3.4` の範囲外になるため `--force` が必要です。semver major ではありません（`isSemVerMajor: false`）。`16.3.8` も `16.4.0` も 7 件すべてを解消しますが、どちらも `package.json` の固定値の変更を伴うため、このPRには含めていません。

### 2. braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next（high 5）

起点は [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)（`braces` <=3.0.3 の深いネストによるスタック枯渇 DoS）1 件で、依存の連鎖で 5 件として数えられています。直接依存は `eslint-config-next`（devDependencies、`16.3.4` 固定）だけです。

`npm audit fix` が提案する修正は `eslint-config-next@14.2.35` への**ダウングレード**（`isSemVerMajor: true`）です。Next 16 を使っているこのリポジトリで lint 設定だけを 14 系へ落とすのは適切でないため、適用していません。

この経路は devDependencies のみで、本番バンドルには入りません。

## この構成での到達性（評価であり、advisory の仕組みの検証ではありません）

リポジトリを検索した結果です。

- `next/og` / `ImageResponse` — 使用箇所なし。critical の RCE はこのアプリのコードからは到達しません
- `next/image` / `<Image>` — 使用箇所なし。`next.config.ts` に `images` 設定（`remotePatterns` / `domains`）もないため、最適化エンドポイントは外部 URL を受け付けません
- `use cache` / `draftMode` / `unstable_cache` — 使用箇所なし
- SSG/ISR — `npm run build` の出力は `/robots.txt` と `/_not-found` のみ静的で、ISR ページはありません。`revalidate` の記述は `fetch` のオプションであってルートセグメント設定ではありません。advisory の対象は「self-hosted」で、本番は Vercel です
- 開発サーバー MCP エンドポイント — 本番には存在しません

いずれも「このリポジトリのコードから呼んでいない」という確認です。Next 本体が提供するエンドポイントがデプロイ上に存在するかどうかまでは確認していません。

## 残っているもの

6 件すべて未修正です。解消するには以下のどちらかが必要で、いずれも `package.json` の固定値の変更です。

- `next` を `16.3.8` 以上へ上げる（7 件すべて解消。`16.3.4` → `16.3.8` は patch 相当）
- `eslint-config-next` の `braces` 経路は、ダウングレード以外の修正が提供されていないため、上流が `fast-glob` を更新するまで残ります

このPRでは `npm audit fix` の実行結果（`package-lock.json` のルートへ `"license": "MIT"` が同期された 1 行）だけを含めています。

## 更新 — 2026-10-15（next 16.3.8）

`next` と `eslint-config-next` を `16.3.4` → `16.3.8` へ固定で上げました。

- **6 件 → 5 件。** critical が消え、`next` の advisory 7 件すべてが対象外になりました
- 残る 5 件は `braces` 起点の連鎖（dev のみ）で、内容は変わっていません
- 16.3.5〜16.3.8 はいずれもバグ修正とセキュリティ修正の backport で、リリースノートに破壊的変更の記載はありません
- critical の [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)（`next/og` の RCE）は対象範囲が `<16.3.6` なので 16.3.6 で修正済みです。16.3.8 のリリースノートには残り 6 件が載っています
- 16.3.8 のリリースノートには、監査に出ていなかった [GHSA-h694-7cp9-m8p3](https://github.com/advisories/GHSA-h694-7cp9-m8p3)（入れ子の `use cache` で root param を跨いでキャッシュが漏れる）も含まれます

### lockfile 再生成についての注意

`node_modules` を残したまま `npm install` を実行すると、Windows では `wasm32` 向けの optional 依存が刈られ、**`@emnapi/runtime@1.11.3` と `@emnapi/core@1.10.0` の top-level エントリが lockfile から消えます**。`@img/sharp-wasm32` が `@emnapi/runtime: ^1.11.3` を要求するため、この状態では Linux の `npm ci` が `Missing: @emnapi/runtime@1.11.3 from lock file` で失敗します。PR #2 で直したのと同じ不整合です。

`node_modules` と `package-lock.json` の両方を消してから `npm install` すると、459 エントリ・`resolved`/`integrity` 欠落 0 で再生成され、`next`・`@next/*`・`eslint-config-next` 以外のバージョンは動きません。Windows でこのリポジトリの lockfile を更新するときは、この手順を使ってください。
