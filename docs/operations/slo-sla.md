# FMD Operations SLO/SLA

## Targets
- Daily pipeline success rate: **>= 99%**.
- P95 end-to-end entity latency: **< 60 minutes**.
- Retry budget: **<= 3 retries/activity/day** for transient failures.

## Weekly reporting queries
- Failed entities by connection type.
- Time-to-recovery by run ID.
- Top recurring failure signatures.
