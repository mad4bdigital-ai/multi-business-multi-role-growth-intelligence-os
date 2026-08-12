# Governed Production synchronization request

Issue: #6813

Pinned request state:
- main: `05cf34298f41fb7e384b5fb6949be7c20e53fbd2`
- main tree: `e046dac237711e275b1267efbe0788f6794012db`
- observed Production: `9ed415e324d8d5187b2c29bdf16aaf77187f0333`
- request branch: `gpt/request-production-promotion-05cf3429-9ed415e3-20260812-r1`
- superseded request surface: `#6928` pinned to stale `main@cd8fe0deaf7f4a49551604829c64bad18247b419`
- source repair now included in main: `#6934` merged at `05cf34298f41fb7e384b5fb6949be7c20e53fbd2`

Authorization boundary:
- this file prepares only a governed request surface;
- a fresh exact `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` is required against the live request head and these live main / Production pins before candidate dispatch;
- no prior authorization or stale candidate/request surface is reusable;
- no Production merge, deployment, SQL, MariaDB principal or GRANT mutation, secret mutation, Migration 1050 readiness/apply, provider mutation, credential payload access, restart, force-push, DB_USER broadening, GRANT ALL, schema-wide write, or credential fallback is authorized here.

The trusted dispatch path must re-read the request head, main, and Production immediately before dispatch and fail closed on any drift.
