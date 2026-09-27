# Operations runbook

| Situation | Do |
| --- | --- |
| New release | Build images → `migrate` → roll API → roll workers ([DEPLOYMENT](DEPLOYMENT.md)) |
| `/ready` 503 | Read its JSON: `database` (connectivity, pending or modified migrations), `redis`; fix the dependency; liveness stays green |
| Provider outage | Model router health moves traffic to configured fallbacks; check `copilot_runs_total{status="failed"}`; no fallback happens after output or on non-retryable errors |
| Budget exceeded | Platform → Usage (estimated cost); raise the budget, switch its action, or wait for the period |
| Stuck or failed jobs | Dead-letter inspector: inspect the failure, fix, then replay deliberately; never loop retries |
| Suspected key leak | Rotate at the provider, update the secret, restart; run `tools/secret-scan.mjs`; if committed, rewrite history and rotate anyway |
| Rotate platform secret key | Add a new key version, re-put secrets, retire the old version after verification |
| Tenant incident | Platform → Tenants: suspend (platform admin); audit search by tenant and actor |
| Health check | `aicopilot doctor --json` against the environment's configuration |
| Restore | [BACKUP_RECOVERY](BACKUP_RECOVERY.md) |

Configuration changes made in the platform are versioned: roll back by making the previous
version current. Changes apply to new runs within the snapshot cache TTL (15 s).
