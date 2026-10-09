# SUMI Trade Lab: production health investigation and temporary pause

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
