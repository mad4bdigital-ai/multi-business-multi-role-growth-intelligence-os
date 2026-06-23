# Effective Resolution Algorithm

## Inputs

- authenticated tenant and user;
- workspace;
- brand;
- business activity type;
- active roles;
- asset type/ref or discovery request;
- selected composition profile.

## Algorithm

1. Resolve tenant and membership from the signed principal.
2. Resolve workspace, brand, activity type, and roles from registry authority.
3. Load the platform-base catalog record and reject non-adoptable assets.
4. Load the tenant instance and current published version, creating no rows during read-only resolution.
5. Load applicable scope bindings for tenant root and all resolved dimensions.
6. Reject expired, revoked, cross-tenant, or structurally invalid bindings.
7. Apply mandatory platform deny and safety-floor policies.
8. Resolve inclusion:
   - `union`: one applicable allow is sufficient unless a mandatory deny applies;
   - `intersection`: every configured required dimension must have an applicable allow.
9. Rank configuration overlays by:
   - number of matching scope dimensions;
   - explicit binding priority;
   - profile tie-break precedence;
   - version timestamp only as a final deterministic tie-break.
10. Resolve scalar conflicts using the highest-ranked binding. Equal-ranked conflicting values produce `composition_conflict` and block.
11. Resolve collections using the selected composition mode:
   - union mode: unique union;
   - intersection mode: common values only.
12. Apply tenant version content to the platform base:
   - overlay: apply bounded validated JSON Patch;
   - fork: use tenant snapshot.
13. Evaluate grants for `view`, `edit`, `grant`, `execute`, and credential configuration independently.
14. Resolve connection, tenant-owned credential reference, installation, provider binding, runtime certification, quotas, and approval requirements.
15. Produce an effective asset and readiness vector with source/version evidence.
16. Persist a no-secret resolution ledger row when the operation is executable or changes state.

## Important invariants

- Explicit mandatory deny always wins.
- Union never means bypass.
- Intersection never accepts missing evidence as approval.
- Platform-base rows are immutable.
- A tenant version cannot reference another tenant's asset instance or connection.
- Asset visibility, editability, and executability are separate decisions.
- Credential readiness and approval readiness remain independent dimensions.

## Example

Context:

- workspace allows Workflow A;
- brand allows Workflow A with a brand-specific prompt overlay;
- activity type allows Workflow A;
- role denies execution but permits edit.

Under union, Workflow A is visible and editable, but execution is denied because execution permission is evaluated separately and the role deny applies.

Under intersection, Workflow A is included only if workspace, brand, activity type, and required role scopes all allow inclusion. The execution deny still blocks dispatch.
