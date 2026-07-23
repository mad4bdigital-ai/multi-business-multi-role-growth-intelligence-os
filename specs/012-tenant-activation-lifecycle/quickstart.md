# Quickstart: Working with Spec 012

## Purpose

This guide explains how contributors and operators use the specification safely. It does not authorize implementation or production mutations.

## 1. Read the authority chain

Before changing this feature, review:

1. `.specify/memory/constitution.md`
2. `AI_Agent_Knowledge_Guide.md`
3. `system_bootstrap.md`
4. `memory_schema.json`
5. `direct_instructions_registry_patch.md`
6. `module_loader.md`
7. `prompt_router.md`
8. `docs/spec-kit-governance.md`
9. this specification directory

SQL/registry authority takes precedence over draft specification contracts at runtime.

## 2. Understand the artifact map

- `spec.md` — goals, scope, requirements, errors, success criteria.
- `research.md` — baseline, standards, decisions, alternatives, gaps.
- `concerns.md` — security, reliability, compatibility, operations, and test risks.
- `operation-paths.md` — complete success/failure/retry/recovery paths.
- `plan.md` — architecture, workstreams, migration, tests, rollout, rollback.
- `data-model.md` — logical entities, states, transitions, retention.
- `contracts/` — proposed non-runtime contracts.
- `tasks.md` — implementation sequence and evidence gates.
- `checklists/` — review gates.
- `completion.json` — delivery evidence status.

## 3. Clarification workflow

For each open question:

1. gather current SQL/registry and production evidence;
2. separate observed behavior from inference;
3. record the decision and rejected alternatives in `research.md`;
4. update affected requirements, paths, contracts, data, plan, tasks, and checklists;
5. do not start implementation if the question affects security, public contract, data ownership, migration, or rollback.

## 4. Planning workflow

Before an implementation PR:

- pass the constitution check in `plan.md`;
- map every implementation task to requirement and operation path;
- inventory canonical source and generated artifact impact;
- identify capability/approval/resource authority for each mutation;
- define tests, rollout, readback, and rollback;
- confirm the PR is one coherent workstream.

## 5. Implementation workflow

Implementation occurs on separate governed branches/PRs.

For each change:

1. pin current `main` and create a dedicated work branch;
2. obtain a capability envelope and approval for the exact mutation;
3. edit source authority, not generated output;
4. add focused tests before or with behavior changes;
5. run generators such as `node build-canonicals.mjs` when required;
6. open a PR with scope, tests, risks, API/database impact, rollout, and rollback;
7. update the branch without force and pass required CI;
8. merge only with fresh head/base evidence and typed confirmation;
9. verify production/main parity, health, migrations, and protected-user-path smoke.

## 6. Required validation examples

### OAuth and gateway

- valid authorize/code/token flow;
- invalid client/callback/state;
- code expiry/replay/concurrent exchange;
- wrong host/resource/audience/issuer/purpose;
- cross-tenant and revoked membership;
- legacy token before/after cutoff.

### Activation lifecycle

- returning user with session reuse;
- first-time JIT and workspace readiness;
- Managed default, Dedicated readiness, mixed modes;
- missing connection versus provider degradation;
- tool visibility versus execution readiness;
- OAuth success with missing first protected call;
- stale deployment attempt classification.

### Retry and evidence

- timeout before dispatch;
- timeout after possible mutation;
- reconcile executed/not-executed/conflicting;
- delivery failure after execution success;
- acknowledgement absence;
- rollback with in-flight operation.

## 7. Completion workflow

Do not set `completion.json.status` to `complete` until:

- all mandatory tasks and checklists pass;
- implementation PRs are merged;
- required migrations and readbacks pass;
- production/main parity is verified;
- service health and Tenant user-path smoke pass;
- rollback readiness is verified;
- no critical/high unresolved concern remains;
- evidence contains no secrets.

## 8. Safety reminders

- Never paste or log OAuth codes, access tokens, client secrets, provider credentials, backend keys, or authorization headers.
- Never invent action or endpoint keys.
- Never treat a draft contract as a registered runtime action.
- Never report activation success from transport success alone.
- Never tell a user to reconnect unless authorization failure is verified.
- Never replay an ambiguous unsafe mutation without reconciliation.
