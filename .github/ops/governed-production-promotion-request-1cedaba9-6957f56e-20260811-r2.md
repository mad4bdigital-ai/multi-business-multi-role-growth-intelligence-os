# Governed Production Promotion Request

- expected main: `1cedaba909fb31f68c144ea06494b8c0f3259412`
- expected main tree: `9d42f5d43a57600f542044f88d1405d1b221e6a0`
- observed Production: `6957f56ead3f720767957dbb7b9b213cc54ed04e`
- required source repair: PR #6877 is present in the pinned main tree
- corrective repository incident: PR #6898 merged; pinned main restores the pre-drift tree
- purpose: prepare a governed source-pinned Production candidate for Issue #6813 closure
- candidate dispatch authorization: not granted by this file
- Production merge authorization: not granted by this file
- Production DB principal/GRANT/secret mutation: not authorized
- deployment / SQL / Migration 1050 / provider mutation / credential disclosure: not authorized
- DB_USER broadening / GRANT ALL / schema-wide write / credential fallback: prohibited
- `platformResourceAuthorityGrantTool.js` and `governedToolResponseChunkStore.js`: untouched

The trusted launcher must live-read `main`, `Production`, and this request head at execution time and fail closed on any drift. Candidate construction may only produce and validate a tree-identical current-main Production candidate. Any Production merge remains separately authorized against the exact resulting candidate SHA.

Governance DB writer configuration and exact table-scoped privilege readiness must be determined by the no-secret Production runtime readiness probe after the repaired source reaches Production. A previous GitHub-runner `GOVERNANCE_DB_CONFIG_MISSING` result must not be treated as proof of Hostinger runtime configuration state. If the runtime probe fails for missing dedicated Governance credentials or privileges, remediation remains an external authority boundary and must not be replaced by ordinary `DB_USER` broadening or fallback.
