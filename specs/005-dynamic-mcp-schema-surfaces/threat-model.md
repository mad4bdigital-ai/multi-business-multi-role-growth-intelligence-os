# Threat Model

## Threats

Tenant sees admin tool; client selects raw endpoint/provider; schema or proxy drifts; stale schema changes meaning; stale policy permits mutation; cookies/headers leak; output bypasses contract; DB changes public topology; Git silently enables dynamic tool; read-only SQL is misclassified; credentials cross tenant/brand boundaries.

## Controls

Signed identity and forced tenant scope; SQL binding resolution; schema/registry versions; input/output validation; canonical hash parity; signed manifests; stale mutation fail-closed; strict path/query/header policy; no DB/secrets at edge; approval/readback; secret-safe evidence; dual-principal tests.

## Residual risk

Discovery projection lag, edge-origin dependency, dual-run complexity, and incomplete lifecycle backfill remain visible readiness warnings.
