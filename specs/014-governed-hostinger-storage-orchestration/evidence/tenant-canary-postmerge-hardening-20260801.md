# Tenant Canary post-merge hardening

Workstream: `tenant-canary`

Base integration SHA: `9e40df9942731c5fbe81006796c9a4bb73e33d2d`

This focused correction preserves the merged Tenant Canary contracts and adds fail-closed pre-consumption checks for:

- the complete governed repository method contract;
- canonical frozen synthetic-memory adapter key, version, flags, and methods;
- immutable-plan authority context, ownership revision, and policy revision parity with the current operation;
- authorization, allowlist, approval, and manual-enablement not-before timestamps;
- never-reusable allowlist revision and approval evidence tokens across ABA sequences.

The regression proves every rejected path leaves the manual one-shot enablement unconsumed and the synthetic item unchanged.

Safety boundary remains `synthetic_only=true`, `production_ready=false`, and `dispatch_allowed=false`. No Hostinger, SSH, filesystem, network, credential, SQL, migration, route, deployment, `main`, or `Production` action is introduced.
