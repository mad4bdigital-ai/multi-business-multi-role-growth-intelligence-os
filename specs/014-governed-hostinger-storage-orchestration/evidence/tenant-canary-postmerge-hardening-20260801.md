# Tenant Canary post-merge hardening

Workstream: `tenant-canary`

Base integration SHA: `317531aeeca40a00e2eb9de2e00b7ad9fe4f0d4e`
Repository-provenance implementation SHA: `2533ee8732f882d61d19cadec9cd33207c00c1de`

This focused correction preserves the merged Tenant Canary contracts and adds fail-closed pre-consumption checks for:

- a control-plane repository created by the Tenant-owned in-memory factory and registered in a private `WeakSet`;
- exact frozen repository version, adapter key, non-production flag, and full governed method contract;
- rejection of a frozen full-shape repository that copies every public method and metadata field but lacks factory provenance;
- a canonical frozen synthetic-memory adapter created by the Tenant-owned factory;
- immutable-plan authority context, ownership revision, and policy revision parity with the current operation;
- authorization, allowlist, approval, and manual-enablement not-before timestamps;
- never-reusable allowlist revision and approval evidence tokens across ABA sequences;
- repository-wide direct-Base import protection across JavaScript and TypeScript module extensions, including `.cjs`.

The regression proves every rejected repository, adapter, authority, or time-window path leaves the manual one-shot enablement unconsumed and the synthetic item unchanged. The Tenant Canary Guard also verifies that repository and adapter provenance checks run before delegated execution and before one-shot consumption.

Safety boundary remains `synthetic_only=true`, `production_ready=false`, and `dispatch_allowed=false`. No Hostinger, SSH, filesystem, network, credential, SQL, migration, route, deployment, `main`, or `Production` action is introduced.
