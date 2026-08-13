# Contract Compatibility — Spec 019

PR-A adds documentation and schemas only. It does not alter existing routes, migrations, database tables, admin tools, or runtime behavior. Future public/admin API changes must use explicit OpenAPI 3.1 contracts, additive fields where possible, structured errors, and a compatibility review. Existing read-only database lifecycle reporting and retention-plan surfaces remain authoritative until a future implementation PR proves parity and migration/readback readiness.
