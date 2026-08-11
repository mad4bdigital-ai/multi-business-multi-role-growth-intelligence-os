# Governed Production Promotion Request

- expected main: `63ca982c1e90fe6646c01ea188fd0a5d99aafa80`
- expected main tree: `5dfcba4e54ae2689522c3cd1273f72d0a1c0c384`
- observed Production: `9ed415e324d8d5187b2c29bdf16aaf77187f0333`
- required governance/runtime source repairs: PR #6896 and PR #6895 are present in the pinned main history
- purpose: prepare a governed source-pinned Production candidate for Issue #6813 closure
- candidate/Production convergence authorization: not granted by this file
- Production DB principal/GRANT/secret mutation: not authorized by this file
- deployment / SQL / Migration 1050 apply / provider mutation / credential disclosure: not authorized by this file
- DB_USER broadening / GRANT ALL / schema-wide write / credential fallback: prohibited

The trusted launcher must live-read `main`, `Production`, and this request head at execution time and fail closed on any drift. Candidate construction may only produce and validate a tree-identical current-main Production candidate. Any protected-ref convergence must remain bound to the exact launcher contract and typed authorization.

After Production convergence, Governance DB writer configuration and exact table-scoped privilege readiness must be determined by the no-secret Production runtime readiness probe. A GitHub-runner configuration result must not be treated as proof of Hostinger runtime configuration state. If the runtime probe fails for missing dedicated Governance credentials or privileges, remediation remains an external authority boundary and must not be replaced by ordinary `DB_USER` broadening or fallback.
