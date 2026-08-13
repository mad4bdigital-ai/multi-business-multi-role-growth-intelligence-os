# Remote MCP OAuth Path Format Guard

The `Remote MCP OAuth Path Format Guard` is a deterministic, read-only CI contract for future OpenAPI, Custom GPT, and Remote MCP route changes. It does not grant write scopes, apply migrations, invoke provider mutations, or deploy any environment.

## Enforced contract

The local guard is `http-generic-api/scripts/ci-path-format-guard.mjs`, exposed as `npm run ci:path-guard`. It verifies that the canonical OpenAPI source remains covered by a valid `x-custom-gpt-surfaces` marker or an explicit surface-registry exclusion record. Unknown surface markers, missing candidate markers, and invalid candidate policies fail closed.

The guard also recomputes the mutation set from the four registry-owned generated artifacts and compares it with `http-generic-api/openapi/openapi-mutation-policy.generated.json`, including the source SHA-256 fingerprint and every operation field. Any mutation absent from the operation registry fails. All current mutations must remain `unbound`, and `write_activation_allowed` must remain `false`.

The historical source operations that intentionally remain outside the current Custom GPT surfaces are recorded in `http-generic-api/openapi/source-operation-coverage.baseline.json`. This baseline is not an authorization list. It only prevents legacy omissions from being confused with newly introduced omissions. A new unmarked route fails the guard; a deliberate source-boundary change must update the marker, exclusion record, and baseline in the same reviewed change.

The guard verifies surface registry version `2`, the exact reviewed `shared_surface_allowlist`, zero unclassified write routes, stale inventory artifacts, and disabled write activation. The workflow then runs the existing schema, trusted-ingress, mutation-governance, shared-parity, and activation-gateway bundle checks.

## Local verification

From `http-generic-api`, run:

```bash
npm run ci:path-guard
node test-remote-mcp-oauth-path-format-guard.mjs
npm run schemas:check
node test-trusted-ingress-contract.mjs
node test-custom-gpt-mutation-governance-contract.mjs
node test-shared-mutation-policy.mjs
npm run activation-gateway:bundle:check
```

From the repository root, run the inventory and evaluation gates:

```bash
npm run write-scopes:inventory
npm run write-scopes:inventory:test
npm run evaluation:loop
```

## Deliberate baseline update

When a reviewed change intentionally changes the source surface boundary, first add the appropriate marker or exclusion record. Then regenerate the historical baseline explicitly:

```bash
cd http-generic-api
node scripts/ci-path-format-guard.mjs --write-baseline
npm run ci:path-guard
```

The generated baseline must be reviewed with the source OpenAPI diff. It must never be used to authorize a write operation. Any mutation promotion remains subject to the existing independent operation, scope, capability, approval, lease, and readback governance.
