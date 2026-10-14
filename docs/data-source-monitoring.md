# データ取得元の監視

取得元の鮮度・可用性と、health API および本番ヘルスチェッカーの判定仕様です。原文（英語）のまま収録しています。概要は [README](../README.md) を参照してください。

### Source freshness across the statistics window

Source freshness uses the latest retained observation at or before the evaluation time, even when older than 24 hours. Availability, coverage, observation counts and failure streaks still use only the 24-hour window. A stopped source therefore remains stale while its last observation is retained; a source with no retained observation remains collecting. Future observations are ignored.

### Health API source quality summary

`/api/health` exposes `dataSourceQualityStatus` with precedence `stale`, `degraded`, `collecting`, then `healthy`. Separate `staleDataSources`, `degradedDataSources` and `collectingDataSources` arrays retain all affected source IDs. Missing history is collecting; an empty incident history is also collecting rather than monitoring. These fields describe observed source quality and do not change the service liveness response or execution lock. They are returned only when dashboard Basic authentication succeeds; without credentials `/api/health` returns `ok`, `service` and `mode` only.

### Automated source monitoring

The production health checker blocks on stale/degraded source quality and open source incidents. Missing or unknown quality/incident states also block. Collecting observations produces a `DATA_SOURCE_COLLECTING` report warning without failing the check; recovered incidents are accepted. Reports retain only known source IDs and recognized source status values. These checks take effect when the integration branch is deployed to production. `scripts/check-production-health.mjs` reads `DASHBOARD_USER` and `DASHBOARD_PASSWORD` and sends Basic authentication, so it sees these fields. Without credentials it exits with `HEALTH_CHECK_CREDENTIALS_MISSING` before making a request; an unauthenticated or rejected response exits with `HEALTH_CHECK_UNAUTHENTICATED` without retrying.

The health checker also examines affected-source lists independently of summary statuses: known stale/degraded/open-incident entries block even if the summary says healthy or recovered. Collecting entries preserve the collection warning. Missing, non-array or unknown-ID lists block with `DATA_SOURCE_LIST_INVALID`; reports still filter unknown values.
