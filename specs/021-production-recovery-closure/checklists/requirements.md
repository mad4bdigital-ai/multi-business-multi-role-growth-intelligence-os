# Requirements checklist

- [x] Closure is exact-SHA bound.
- [x] Caller may supply only expected_sha.
- [x] Recovery truth requires a server-injected evidence resolver.
- [x] Durable same-cycle inspection evidence is mandatory.
- [x] Verified all-role backup evidence is mandatory.
- [x] Governance and runtime-persistence baseline readiness are core gates.
- [x] Canonical grants and bootstrap ledger readiness are core gates.
- [x] MCP catalog schema plus Admin/Device functional readback are core gates.
- [x] Governed response-chunk durable smoke is a core gate.
- [x] Production activation readiness is a core gate.
- [x] Unknown outcome forces reconciliation and forbids automatic retry.
- [x] Connector auth and 429 attribution remain non-DB degradation.
- [x] Closure evaluation performs no database/provider/Production mutation.
- [~] Live Production recovery execution — N/A for this repository-only PR; requires separate exact-SHA deployment and approval.
- [~] Production migration/grant apply — N/A for this repository-only PR; remains separately governed.
