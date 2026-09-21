# Production Recovery authority preflight

This preflight makes the Production Recovery activation boundary observable without loading the deployment-owned authority module, opening the Recovery control database, issuing an approval, issuing an execution ticket, dispatching Host Breakglass, or mutating Production.

## Purpose

The Recovery source tree already contains the Production composition factory, durable Recovery control-store implementation, approval/ticket lifecycle, and Host Breakglass contracts. Production activation still depends on deployment-owned authorities that are not synthesized from repository source or caller input.

The preflight therefore reports only whether the runtime is configured far enough to attempt candidate resolution. It never marks Production Recovery activation eligible.

## Required configuration gates

The preflight requires all of the following before candidate resolution can even be attempted:

- explicit Production runtime identity using the `production_hostinger_autodeploy` runtime variant;
- a configured `RECOVERY_SERVER_MANAGED_BINDING_MODULE`;
- `RECOVERY_SERVER_MANAGED_BINDING_MODE=production_live`;
- a separately configured `RECOVERY_CONTROL_DB_*` identity that remains independent from runtime, governance, and runtime-persistence target databases.

Even when those configuration gates are satisfied, the preflight remains blocked on `production_authority_graph_resolution_required`.

## Authority graph that must still be evaluated

The deployment-owned module must provide the complete Recovery composition graph, including:

- deployment identity provider;
- independent durable Recovery store;
- approval issuer, verifier, and store with server-side approved-execution resolution;
- fenced Recovery lock;
- mutation executor and Hostinger host-local mutation executor;
- independent role-aware same-cycle readback verifier;
- execution-ticket signer and verifier;
- immutable partial-receipt store;
- proof resolver;
- migration ledger.

The seven live-authority components remain the minimum activation-critical subset: Recovery store, execution-ticket signer, approval verifier, Recovery lock, readback verifier, Hostinger host-local mutation executor, and deployment identity provider.

## Safety boundary

The preflight:

- does not load the deployment-owned binding module;
- does not evaluate or expose adapter objects;
- does not connect to the Recovery control database;
- does not access a provider;
- does not issue approvals or execution tickets;
- does not dispatch a workflow;
- does not perform database, provider, deployment, or Production mutation;
- never returns database host, user, password, database name, module path, or other secret-bearing configuration.

A successful configuration preflight is not execution authority and is not equivalent to `activation_eligible=true`.
