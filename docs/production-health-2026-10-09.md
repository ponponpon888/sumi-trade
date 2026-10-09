# SUMI Trade Lab: production health investigation and temporary pause

## 確定結果 — 2026-10-09 16:22 JST

この節は、以下の初期調査で未確定だった保存先の原因と接続状況を更新します。

- **根本原因：Upstash RedisのFixedプラン制限到達。** Vercel Productionの `KV_REST_API_URL` と `KV_REST_API_TOKEN` を使った、認証付きの読み取り専用 `PING` がHTTP 403になりました。返却されたエラーは以下です。制限の種類（容量・通信量等）と具体的な使用量までは、この応答では分かりません。
  > ERR This database has reached current Fixed plan limits. Please upgrade manually or enable auto upgrade on Upstash Console
- この保存先が安全状態と紙上履歴の共通依存先です。リクエスト拒否により `SAFETY_UNAVAILABLE` と `PAPER_ENGINE_NOT_LIVE` になることが、既存コードの失敗経路と一致します。5取得元のcollecting/0件は、読み取りエラー時に作られる代替集計です。
- **Vercelは接続済みで再接続は不要でした。** 接続ユーザーは `ponponpon888`。同一プロジェクトをIDで指定し、teamIdを省略したプロジェクト・デプロイ・環境変数取得は成功しました。チームを明示した呼び出しとログ取得は引き続き403です。Vercel側403とRedis側403は別の拒否です。
- 停止PR #69のコミット `ee6072820b94572edb7cc38b132c0f05fb7b5428` が、Productionデプロイ `dpl_2TVBLR93iGwqyoSD2ZExjiaMw9ND` でREADYになり、本番ドメインに割り当てられていることを確認しました。このコミットは `crons: []` と `SUMI_EMERGENCY_STOP=true` を含みます。
- 16:21 JSTの公開healthは `mode: paper`、`executionLocked: true`、`safetyStatus: stopped`、`emergencyStop: true`。紙上エンジンは依然errorで、保存先の復旧は主張しません。
- Vercelの公式仕様では、Cron設定削除後の再デプロイでCronが削除されます： https://vercel.com/docs/cron-jobs/manage-cron-jobs 。該当する本番デプロイの成功を確認済みです。ダッシュボード上のCron一覧自体は、現在の接続では独立に取得できていません。
- プラン変更、自動アップグレードの有効化、トークン変更、スキャン再実行、実取引切り替えは行っていません。ユーザーの一時停止方針を維持します。
- 再開する場合の適用先は、**Upstash Consoleの当該Redisデータベースの使用量・Fixedプラン上限設定**です。まず制限種類と使用量を確認し、必要な容量・通信量対策を判断します。再開・有料設定変更は今回の作業には含めません。現時点の直接応答は認証失敗を示していないため、VercelのURL/トークンを推測で交換する必要はありません。
- 別件のCI lockfile欠落はPR #70で修正済み（未マージ）。GitHubでlint・型チェック・1077テスト・本番ビルドが成功し、停止設定も維持されています。


Checked on 2026-10-09 (Asia/Tokyo). User authorized a temporary stop. No live trading is authorized.

## Confirmed evidence

- GitHub main: `69b74d27cd57928b7e4e8af9854fca4ef31b9cc6`, version 1.37.0.
- [Reported run 37855046287](https://github.com/ponponpon888/sumi-trade-lab/actions/runs/37855046287): health step failed on 2026-10-09 around 07:41 JST, with `SAFETY_UNAVAILABLE` and `PAPER_ENGINE_NOT_LIVE`.
- [Newer run 37881157218](https://github.com/ponponpon888/sumi-trade-lab/actions/runs/37881157218) also failed at 12:51 JST. [Issue #68](https://github.com/ponponpon888/sumi-trade-lab/issues/68) remains open. This is not a recovered incident.
- The reported run logged `configurationStatus: pass`, `safetyStatus: unavailable`, `emergencyStop: true`, `paperEngineStatus: error`, `mode: paper`, `executionLocked: true`, and matching build version 1.37.0.
- All five source summaries were collecting with zero observations and zero recorded request failures.
- [PR #67](https://github.com/ponponpon888/sumi-trade-lab/pull/67) remains unmerged. It decouples community-trend scoring from wallet holdings; it does not fix this storage-read failure. [PR #30](https://github.com/ponponpon888/sumi-trade-lab/pull/30) proposes fewer monitor runs, not a full pause.

## Failure boundary and dependencies

| Boundary | Implementation and evidence |
| --- | --- |
| Schedule | `vercel.json` previously requested a five-minute `/api/cron/scan` and hourly `/api/cron/base-cost`. Configuration establishes intent, not proof of execution. |
| Cron authentication | Both routes require `CRON_SECRET` and a matching Bearer header. Runtime syntax validation passing does not prove Vercel dispatched an authorized request. |
| Collection | Scan calls `getTradingDashboardData`, which fetches portfolio, charts and trends, then `recordPaperScan`. Upstream calls may still happen while persistence fails. |
| Journal | `getPaperJournalSnapshot` uses Redis ZRANGE/MGET and evaluates retained records. Missing credentials returns disabled; an exception during reading/evaluation returns `emptyPaperJournal("error", ...)`. |
| Engine health | `getPaperEngineHealth` maps a disabled/error journal to `error`. A successfully read but empty journal would be waiting, not error. Given `configurationStatus: pass` and this implementation, the observed error identifies failure on the journal reading/evaluation path, rather than merely an idle Cron. |
| Safety | The same Redis URL/token selection is used by `getSafetyControlSnapshot`. Its GET or stored-value validation exception produces unavailable, emergencyStop true, executionLocked true. |
| Source summaries | `emptyPaperJournal` calculates quality/incidents from an empty array, generating collecting/zero placeholders. These are not evidence that five providers made zero successful requests or that their APIs failed. |
| Monitor | GitHub's checker reads `/api/health`; it does not start the scanner. It correctly fails on unavailable safety and a non-live paper engine. Matching the build rules out a version mismatch in the reported run. |

The confirmed common dependency is Redis-backed state. A Redis access/configuration or data-read error is the leading explanation for the simultaneous safety and journal failures. The exact infrastructure cause (expired/incorrect token, unavailable database, quota, network or malformed stored data) is **not confirmed**. The journal catch also covers evaluation exceptions, so this must not be reported as proven Redis downtime.

## Access limitation

The Vercel project lookup identified `sumi-trade-lab` (`prj_M6qr39Qihe9uaguUAPyDy97gY1e7`) in `ponponpon888s-projects` (`team_dhgtT4uqGRBLyrJqqLDEpvs2`). Runtime logs, environment metadata, deployment details and the pause request all returned HTTP 403 for that team. The CLI fallback was unavailable (no installed Vercel CLI or Vercel credential in this workspace). No secrets were retrieved or changed. Production pause/deployment success must not be inferred from a GitHub merge.

## Temporary pause changes

- Remove scheduled and main-push Production health triggers; keep manual `workflow_dispatch` and all safety checks/alert handling.
- Empty Vercel's Cron list, removing both periodic collection jobs on the **next successful production deployment**.
- Set `SUMI_EMERGENCY_STOP=true` in deployment configuration, using the existing fail-closed BUY stop on the **next successful production deployment**.
- Leave all application decisions, signing limitations, paper mode and execution lock unchanged.
- Do not close Issue #68 as recovered.
- GitHub schedule removal takes effect on main. Vercel Cron removal and emergency override require a production deployment and verification. A platform project pause is still required for an immediate complete service stop.

## Required follow-up in the same Vercel project

1. Authorize the Vercel connection for `ponponpon888s-projects` and this project, or use the owner's authenticated dashboard.
2. For an immediate full stop, pause this project and verify it is paused. Do not delete the project, database or historical records.
3. With access restored, inspect production Cron request status codes and the journal/safety Redis errors. Check that the intended Redis database exists, is available and has not exceeded its limits.
4. Check production-scoped paired credentials: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` + `KV_REST_API_TOKEN`, for the same database. Both consumers independently prefer each UPSTASH value, so a partial UPSTASH pair can shadow a valid KV pair; remove obsolete partial overrides or configure a complete consistent pair if inspection confirms this condition. Syntax audit alone does not test connectivity.
5. Keep `SUMI_EMERGENCY_STOP=true` while paused. Keep `CRON_SECRET`, `SAFETY_CONTROL_SECRET`, dashboard authentication and execution locks.
6. Apply the Cron-free deployment when appropriate and verify the platform Cron list is empty. Restoring the old schedules is a separate explicit restart decision, after storage recovery is verified.

No automatic scanner run, recovery assertion, secret replacement or live-trading switch was performed.
