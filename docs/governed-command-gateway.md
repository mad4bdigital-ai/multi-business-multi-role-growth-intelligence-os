# Governed Command Gateway

## Purpose

The Governed Command Gateway is the repository-automation routing layer for bounded GitHub operations. It reduces repeated GitHub Actions orchestration without creating a second authorization or workflow-runtime kernel.

It composes with the existing platform governance model. The platform remains authoritative for capability, policy, approval, state, audit, and readback. Repository command metadata does not grant authority and cannot become arbitrary executable code.

## Architecture

```text
Command Request
      |
      v
Governed Command Gateway
      |
      v
Command Registry + Parameter Schema
      |
      v
Fixed Validator / Resolver Core
      |
      v
Code-Allowlisted Adapter
      |
      v
Existing Governed Workflow
```

The gateway is intentionally stable. Normal command growth occurs through a registry entry and parameter schema, reusing an existing adapter when possible. A new adapter is required only when the execution target or bounded parameter mapping is materially different.

## Fixed safety boundary

The following remain code-owned rather than registry-owned:

- allowed adapter keys;
- allowed authority classes;
- allowed risk classes;
- allowed permission profiles;
- allowed audit policies;
- exact workflow targets;
- exact target ref (`main`);
- typed authorization values;
- bounded adapter parameter keys;
- recursive-dispatch prohibition;
- direct Production mutation prohibition;
- arbitrary workflow/path execution prohibition;
- arbitrary shell/code execution prohibition;
- exact gateway SHA validation.

The registry therefore cannot select an arbitrary workflow or shell command. Unknown fields fail validation.

## Registry contract

`.github/contracts/governed-command-registry.v1.json` describes command identity and policy metadata only:

```json
{
  "id": "spec_kit_work_map_recovery",
  "adapter": "spec-kit-work-map-recovery",
  "authority": "spec-kit-governance",
  "risk_class": "elevated",
  "requires_sha_pin": true,
  "parameter_schema": ".github/contracts/governed-command-parameters/spec-kit-work-map-recovery.v1.json",
  "audit_policy": "workflow-run-evidence",
  "permission_profile": "dispatch-only",
  "enabled": true
}
```

There is deliberately no workflow path, shell command, executable code, permission wildcard, or Production ref in registry data.

## Reference adapters

### `spec_kit_work_map_recovery`

The adapter maps only to the existing authoritative workflow:

`spec-kit-work-map-autofix-recovery-dispatch.yml`

The downstream workflow keeps its own exact PR/head validation, one-time authorization marker consumption, bounded writer delegation, and Work Map evidence contract. The gateway does not duplicate or weaken those checks.

### `production_promotion_request`

The adapter maps only to the existing authoritative workflow:

`governed-production-promotion-request-launcher.yml`

The gateway does not mutate `Production`. It dispatches the existing governed launcher from trusted `main`; the downstream launcher remains responsible for source pins, request PR validation, candidate construction, exact validation, evidence, and any protected-ref convergence rules.

## Request contract

The gateway accepts four inputs:

- `command` — registered command id;
- `parameters_json` — JSON object matching the registered parameter schema;
- `expected_gateway_sha` — exact lowercase 40-character SHA of trusted `main` containing the gateway;
- `authorization` — exact typed confirmation fixed by the code-side adapter.

The resolver fails closed when the workflow is not executing from `main`, the current workflow SHA does not equal `expected_gateway_sha`, the command is unknown/disabled, authorization differs, the schema is invalid, parameters are incomplete or contain unknown fields, or the adapter does not resolve to a code-allowlisted target.

## Evidence

Each accepted gateway run emits bounded evidence containing command identity, adapter, authority, risk class, target workflow/ref, input key names, and validation flags. Parameter values and the authorization value are not copied into the uploaded evidence artifact.

Downstream authoritative workflows continue to produce their own operation-specific evidence.

## Adding a command

For an existing adapter:

1. Add a unique registry entry.
2. Add a bounded parameter schema under `.github/contracts/governed-command-parameters/`.
3. Add/update contract tests.
4. Run registry validation and tests.

For a genuinely new execution behavior, additionally add one small code-side adapter definition with an exact existing governed workflow target, authority compatibility, minimum risk class, typed confirmation, and parameter allowlist. Extending the adapter allowlist is a reviewed code change by design.

A new command must not create a new workflow when an authoritative existing workflow already implements the operation.

## Validation

```bash
node .github/scripts/validate-governed-command-registry.mjs
node --test .github/tests/governed-command-gateway.test.mjs
```

The PR validation workflow runs both commands on the exact candidate head.

## Non-goals

This foundation does not migrate all repository operations, replace Spec 006 Dynamic Workflow Runtime, replace current capability/resource/approval authorities, execute tenant-authored code, introduce arbitrary workflow dispatch, merge to `main`, or promote `Production`.
