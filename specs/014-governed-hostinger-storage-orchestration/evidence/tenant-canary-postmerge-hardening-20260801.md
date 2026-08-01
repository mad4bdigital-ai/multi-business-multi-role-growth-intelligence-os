# Tenant Canary post-merge hardening

Workstream: `tenant-canary`

Current Integration base SHA: `2a3820232edf11248e2721b630eb3c9be1195e7d`
Recovery implementation tree SHA before this evidence stamp: `a6b9d45c6c1bb2a482fd046211578a751f69a38b`
Repository-provenance implementation lineage: `2533ee8732f882d61d19cadec9cd33207c00c1de`

This focused correction preserves the merged Tenant Canary contracts and adds fail-closed pre-consumption checks for:

- a control-plane repository created by the Tenant-owned in-memory factory and registered in a private `WeakSet`;
- exact frozen repository version, adapter key, non-production flag, and full governed method contract;
- rejection of a frozen full-shape repository that copies every public method and metadata field but lacks factory provenance;
- a canonical frozen synthetic-memory adapter created by the Tenant-owned factory;
- a Tenant-owned authority store registered in a private `WeakSet`, rejecting structural copies before any authority read;
- a Tenant-owned one-shot enablement registry registered in a private `WeakSet`, rejecting structural copies before `read` or `consume`;
- immutable-plan authority context, ownership revision, and policy revision parity with the current operation;
- authorization, allowlist, approval, and manual-enablement not-before timestamps;
- never-reusable allowlist revision and approval evidence tokens across ABA sequences;
- a TypeScript-AST repository scanner covering static imports, dynamic `import()`, CommonJS `require`, constant-composed strings, `new URL`, and JavaScript/TypeScript module extensions including `.cjs`.

The regressions prove rejected repositories, adapters, authority stores, registries, authority evidence, and time windows leave the genuine one-shot enablement unconsumed and the synthetic item unchanged. The Tenant Canary Guard verifies all four factory-owned provenance checks and immutable-plan authority checks complete before delegated execution.

Safety boundary remains `synthetic_only=true`, `production_ready=false`, and `dispatch_allowed=false`. No Hostinger, SSH, filesystem, network, credential, SQL, migration, route, deployment, `main`, or `Production` action is introduced.
