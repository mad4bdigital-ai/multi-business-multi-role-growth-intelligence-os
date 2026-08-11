# Governed Production synchronization request

Issue: #6813

Pinned request state:
- main: `cd8fe0deaf7f4a49551604829c64bad18247b419`
- main tree: `eca725d47556dd72b00bae8d6774fe4cac59130b`
- observed Production: `9ed415e324d8d5187b2c29bdf16aaf77187f0333`
- request branch: `gpt/request-production-promotion-cd8fe0de-9ed415e3-20260811-r1`
- stale prior candidate: `b9cc9fc6abac36d353c530cb264a212ce788e1f5` (exact validation succeeded, then main advanced via #6925 before release gates)

Authorization boundary:
- this file prepares only a governed request surface;
- a fresh exact `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` is required against the live request head and these live main / Production pins before candidate dispatch;
- prior authorization consumed by the stale #6923 cycle is not reusable;
- no Production merge, deployment, SQL, MariaDB principal or GRANT mutation, secret mutation, Migration 1050 readiness/apply, provider mutation, credential payload access, restart, force-push, DB_USER broadening, GRANT ALL, schema-wide write, or credential fallback is authorized here.

The trusted dispatch path must re-read the request head, main, and Production immediately before dispatch and fail closed on any drift.