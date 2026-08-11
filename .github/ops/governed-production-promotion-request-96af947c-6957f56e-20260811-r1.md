# Governed Production Promotion Request

- expected main: `96af947ccc17d1ccee5c28c87fd975474283a81b`
- observed Production: `6957f56ead3f720767957dbb7b9b213cc54ed04e`
- required source merge: PR #6877 / `96af947ccc17d1ccee5c28c87fd975474283a81b`
- purpose: prepare a governed source-pinned Production candidate for Issue #6813 closure
- external prerequisite still outstanding: dedicated MariaDB Governance writer principal + exact table-scoped grants + Hostinger Production `GOVERNANCE_DB_USER` / `GOVERNANCE_DB_PASSWORD`
- candidate dispatch authorization: not granted by this file
- Production merge authorization: not granted by this file
- Production DB principal/GRANT/secret mutation: not authorized
- deployment / SQL / Migration 1050 / provider mutation / credential disclosure: not authorized
- Platform Resource Authority and Response Chunk owned paths: untouched

The trusted launcher must live-read `main`, `Production`, and this request head at execution time and fail closed on any drift. Candidate construction may only produce and validate a tree-identical current-main Production candidate. Any Production merge remains separately authorized against the exact resulting candidate SHA. External Governance DB principal/grant/secret provisioning remains a separate authority boundary and must not be replaced with `DB_USER` broadening, `GRANT ALL`, schema-wide write, or credential fallback.
