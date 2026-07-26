# Requirements Checklist

## Pre-merge requirements

- [x] Count semantics are explicit and testable.
- [x] Unknown data remains null rather than zero.
- [x] Blocked surfaces have stable reason codes.
- [x] Metrics are bounded and secret-free.
- [x] Change is additive except for correcting the misleading connected count.
- [x] Existing routes remain backward compatible.
- [x] No database, OpenAPI path, credential, provider-write, or deployment mutation exists.
- [x] Required CI checks passed on the reviewed branch head.
- [x] Governed merge is prepared with expected head/base validation, typed confirmation, and same-cycle ancestry readback.

## Post-merge evidence

The merge SHA, branch cleanup result, production behavior readback, and runtime parity verification are recorded in PR #1896 and the governed platform execution log.
