# Shared Canary post-merge hardening

Workstream: `shared-canary`

Integration base SHA: `e30608bc6be4e5442e1c361a678455fdd2e60951`
Functional evidence head: `fe790e6d7f56876d9317bee16e359b22f1ec2e1e`

Functional commits:

- `a73d63ba4b311ec5634feb883d5c3357987da1de` — enforce canonical repository, adapter, Shared authority-store, and one-shot registry provenance.
- `a3fab7add70e3dd898381dc2d0295d7499be760a` — guard the provenance checks and execution ordering.
- `30d31be03e9fa4985f93f1759b58c75fdc5ae203` — add the TypeScript-AST Shared Core import boundary.
- `fe790e6d7f56876d9317bee16e359b22f1ec2e1e` — add forged-dependency and single-read accessor regressions.

The public Shared wrapper accepts only the official factory-owned in-memory control-plane repository and synthetic adapter. Shared authority stores and one-shot enablement registries are authenticated through module-private `WeakSet` ownership, so frozen structural copies with identical fields or methods cannot grant trust.

All execution dependencies are captured exactly once before validation. The captured values are passed to the Shared Core through a frozen input snapshot, preventing getter or accessor substitution between provenance checks, current-authority readback, immutable-plan preflight, and Core dispatch.

A TypeScript-AST repository scanner prevents direct imports of `hostingerStorageSharedCanaryCore` outside the governed public wrapper. It covers static imports, dynamic imports, CommonJS `require`, constant-composed paths, `new URL`, and JavaScript/TypeScript module extensions.

Safety remains synthetic-only, non-production, provider-dispatch-disabled, live-provider-disabled, and reserve-release-disabled. No Hostinger access, filesystem mutation, SSH, credentials, SQL, migration, runtime route, deployment, `main`, or Production authority is introduced.

`secrets_included: false`
