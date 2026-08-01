# Tenant Canary Base runtime provenance

Workstream: `tenant-canary`

Integration base SHA: `da3f8eeafabc53fc17fc89480175b64d590b960e`
Implementation lineage:

- `04c7e7db197a44a26530ed1c8fb923df4e32cf09` — move Tenant-owned provenance enforcement into the Base runtime.
- `9396df473a845c27adedd469e742272a7389588d` — align repository provenance evidence taxonomy without weakening validation.

This correction closes the direct or dynamically imported Base-executor bypass. The Base runtime now owns and verifies:

- the canonical synthetic adapter plus Tenant-factory provenance;
- the canonical Control Plane repository plus Tenant-factory provenance;
- Tenant-factory-owned Authority Store provenance;
- Tenant-factory-owned one-shot Enablement Registry provenance;
- accessor-safe, single-read token normalization and never-reusable ABA histories;
- immutable-plan authority context, ownership revision, and policy revision parity before one-shot consumption.

`hostingerStorageTenantCanary.js` is a compatibility re-export only. The permanent Tenant Canary Guard verifies Base runtime ordering and retains the TypeScript-AST static/dynamic import boundary, Store provenance regressions, and all existing Tenant Canary tests.

Safety remains `synthetic_only=true`, `production_ready=false`, and `dispatch_allowed=false`. This change introduces no Hostinger, SSH, credential, filesystem, provider dispatch, SQL, migration, runtime route, deployment, `main`, or `Production` action.
